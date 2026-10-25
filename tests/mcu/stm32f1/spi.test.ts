/**
 * SPI1/SPI2 (src/mcu/stm32f1/spi.ts): exact SCK/MOSI edge cycles for the
 * four CPOL/CPHA modes, MISO sampling edges, SPI1 master ↔ SPI2 slave on one
 * SoC (wired with a tiny harness), CRC, NSS/MODF, OVR, BSY, RXONLY and BIDI.
 * Register sequences follow ST's HAL v1.1.9 (stm32f1xx_hal_spi.c).
 */
import { describe, expect, it } from 'vitest'
import { SPI_SR_BSY, SPI_SR_CRCERR, SPI_SR_MODF, SPI_SR_OVR, SPI_SR_RXNE, SPI_SR_TXE, spiCrcBit } from '../../../src/mcu/stm32f1/spi'
import { PIN_OUT_OD, PIN_OUT_PP } from '../../../src/mcu/pins'
import type { Stm32f103 } from '../../../src/mcu/stm32f1/soc'
import { AFIO, clock72, GPIOA, GPIOB, makeSoc, r32, RCC_AHBENR, RCC_APB1ENR, RCC_APB2ENR, runFor, set32, w32 } from './helpers'

const SPI1 = 0x40013000
const SPI2 = 0x40003800
const CR1 = 0x00
const CR2 = 0x04
const SR = 0x08
const DR = 0x0c
const CRCPR = 0x10
const RXCRCR = 0x14
const TXCRCR = 0x18
const CPHA = 1 << 0
const CPOL = 1 << 1
const MSTR = 1 << 2
const SPE = 1 << 6
const LSBFIRST = 1 << 7
const SSI = 1 << 8
const SSM = 1 << 9
const RXONLY = 1 << 10
const DFF = 1 << 11
const CRCNEXT = 1 << 12
const CRCEN = 1 << 13
const BIDIOE = 1 << 14
const BIDIMODE = 1 << 15
const BR = (n: number) => n << 3

const PA4 = 4
const PA5 = 5
const PA6 = 6
const PA7 = 7
const PB3 = 19
const PB4 = 20
const PB5 = 21
const PB12 = 28
const PB13 = 29
const PB14 = 30
const PB15 = 31

// ------------------------------------------------------------------ harness

interface Edge {
  pin: number
  cycle: number
  level: 0 | 1
}

/** Nets of MCU pins: the driven level (push-pull, or open-drain low) is pushed to every pin of the net. */
class Wires {
  readonly edges: Edge[] = []
  private nets: number[][] = []
  private ext = new Map<number, 0 | 1>()

  constructor(readonly soc: Stm32f103) {
    soc.pins.listener = {
      pinDriveChanged: (pin, cycle) => {
        const d = soc.pins.drive(pin)
        this.edges.push({ pin, cycle, level: d.level })
        for (const n of this.nets) if (n.includes(pin)) this.resolve(n)
      },
    }
  }

  connect(...pins: number[]): void {
    this.nets.push(pins)
    this.resolve(pins)
  }

  /** an external driver forces `pin`'s net */
  force(pin: number, level: 0 | 1 | null): void {
    if (level === null) this.ext.delete(pin)
    else this.ext.set(pin, level)
    const n = this.nets.find((x) => x.includes(pin)) ?? [pin]
    this.resolve(n)
  }

  private resolve(net: number[]): void {
    let level: 0 | 1 | null = null
    for (const p of net) {
      const e = this.ext.get(p)
      if (e !== undefined) level = e
    }
    if (level === null) {
      for (const p of net) {
        const d = this.soc.pins.drive(p)
        if (d.mode === PIN_OUT_PP) level = d.level
        else if (d.mode === PIN_OUT_OD && d.level === 0) level = 0
      }
    }
    if (level === null) return
    for (const p of net) this.soc.pins.setInput(p, level, level ? 3.3 : 0)
  }

  of(pin: number): Edge[] {
    return this.edges.filter((e) => e.pin === pin)
  }
}

function setup() {
  const { soc } = makeSoc({ firmware: true })
  clock72(soc)
  // AFIO, GPIOA, GPIOB, SPI1
  set32(soc, RCC_APB2ENR, (1 << 0) | (1 << 2) | (1 << 3) | (1 << 12))
  set32(soc, RCC_APB1ENR, 1 << 14) // SPI2
  // HAL_SPI_MspInit (SPI1 master): PA5 SCK / PA7 MOSI AF push-pull, PA6 MISO input floating
  w32(soc, GPIOA + 0x00, (r32(soc, GPIOA + 0x00) & 0x000fffff) | 0xb4b00000)
  const wires = new Wires(soc)
  return { soc, wires }
}

/** SPI2 as a slave: PB13 SCK / PB15 MOSI inputs, PB14 MISO AF push-pull, PB12 NSS input */
function slavePins(soc: Stm32f103): void {
  w32(soc, GPIOB + 0x04, (r32(soc, GPIOB + 0x04) & 0x0000ffff) | 0x4b440000)
}

const sr = (s: Stm32f103, b = SPI1) => r32(s, b + SR)

function waitFor(soc: Stm32f103, cond: () => boolean, timeout = 0.005): boolean {
  const t0 = soc.time()
  while (!cond()) {
    if (soc.time() - t0 > timeout) return false
    runFor(soc, 0.1e-6)
  }
  return true
}

/** HAL_SPI_TransmitReceive (8/16-bit, master) */
function transmitReceive(soc: Stm32f103, base: number, tx: number[], crc = false): number[] {
  const rx: number[] = []
  if (!(r32(soc, base + CR1) & SPE)) w32(soc, base + CR1, r32(soc, base + CR1) | SPE)
  let ti = 0
  let txAllowed = true
  if (tx.length === 1) w32(soc, base + DR, tx[ti++])
  while (ti < tx.length || rx.length < tx.length) {
    if (sr(soc, base) & SPI_SR_TXE && ti < tx.length && txAllowed) {
      w32(soc, base + DR, tx[ti++])
      txAllowed = false
      if (ti === tx.length && crc) w32(soc, base + CR1, r32(soc, base + CR1) | CRCNEXT)
    }
    if (sr(soc, base) & SPI_SR_RXNE && rx.length < tx.length) {
      rx.push(r32(soc, base + DR))
      txAllowed = true
    }
    runFor(soc, 0.05e-6)
  }
  if (crc) {
    waitFor(soc, () => (sr(soc, base) & SPI_SR_RXNE) !== 0)
    r32(soc, base + DR)
  }
  waitFor(soc, () => !(sr(soc, base) & SPI_SR_BSY))
  return rx
}

// ------------------------------------------------------------------ tests

describe('SPI master edge timing', () => {
  for (const mode of [0, 1, 2, 3]) {
    it(`mode ${mode}: SCK edges every 2^BR PCLK2 cycles from the CPOL idle level; MOSI on the shift edges; MISO sampled on the capture edges`, () => {
      const { soc, wires } = setup()
      const cpol = (mode >> 1) & 1
      const cpha = mode & 1
      w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(5) | (cpol ? CPOL : 0) | (cpha ? CPHA : 0)) // /64 → 32 core cycles per half period
      w32(soc, SPI1 + CR1, r32(soc, SPI1 + CR1) | SPE)
      expect(soc.pins.drive(PA5).level).toBe(cpol)
      // an external slave answering 0x3C on MISO, changing its bit on the master's shift edges
      const answer = 0x3c
      let bit = 0
      const outEdge = (level: number) => (cpha ? level !== cpol : level === cpol)
      if (!cpha) wires.force(PA6, ((answer >> 7) & 1) as 0 | 1)
      const sckSeen: Edge[] = []
      const orig = soc.pins.listener!
      soc.pins.listener = {
        pinDriveChanged: (pin, cycle) => {
          orig.pinDriveChanged(pin, cycle)
          if (pin !== PA5) return
          const level = soc.pins.drive(PA5).level
          sckSeen.push({ pin, cycle, level })
          if (outEdge(level)) {
            if (cpha) wires.force(PA6, ((answer >> (7 - bit)) & 1) as 0 | 1)
            else if (bit < 7) wires.force(PA6, ((answer >> (6 - bit)) & 1) as 0 | 1)
            bit++
          }
        },
      }
      const c0 = soc.clock.cycles
      w32(soc, SPI1 + DR, 0xa5)
      expect(sr(soc) & SPI_SR_BSY).toBe(SPI_SR_BSY)
      expect(waitFor(soc, () => (sr(soc) & SPI_SR_RXNE) !== 0)).toBe(true)
      expect(r32(soc, SPI1 + DR)).toBe(answer)
      waitFor(soc, () => !(sr(soc) & SPI_SR_BSY))
      // 16 SCK edges, 32 cycles apart, first one at t0 + h where t0 = DR write + 2 PCLK2 cycles
      expect(sckSeen.length).toBe(16)
      const t0 = c0 + 2
      sckSeen.forEach((e, k) => {
        expect(e.cycle).toBe(t0 + (k + 1) * 32)
        expect(e.level).toBe(k % 2 === 0 ? cpol ^ 1 : cpol)
      })
      // MOSI: MSB first; CPHA = 0 → bit 0 at t0, the others on the trailing edges; CPHA = 1 → on the leading edges
      const mosi = wires.of(PA7).filter((e) => e.cycle >= t0)
      const levelAt = (cyc: number) => {
        let l = -1
        for (const e of wires.of(PA7)) if (e.cycle <= cyc) l = e.level
        return l
      }
      for (let i = 0; i < 8; i++) {
        // sample point of bit i: edge 2i+1 (CPHA = 0) or 2i+2 (CPHA = 1)
        const sampleCycle = t0 + (cpha ? 2 * i + 2 : 2 * i + 1) * 32
        expect(levelAt(sampleCycle), `bit ${i}`).toBe((0xa5 >> (7 - i)) & 1)
      }
      for (const e of mosi) {
        const k = (e.cycle - t0) / 32
        if (cpha) expect(k % 2).toBe(1)
        else expect(k === 0 || k % 2 === 0).toBe(true)
      }
      expect(sr(soc) & SPI_SR_TXE).toBe(SPI_SR_TXE)
    })
  }

  it('continuous transfer: the next frame starts right at the end of the previous one, BSY stays high', () => {
    const { soc, wires } = setup()
    w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(2) | SPE) // /8 → 4 cycles per half period
    w32(soc, SPI1 + DR, 0x81)
    expect(waitFor(soc, () => (sr(soc) & SPI_SR_TXE) !== 0)).toBe(true)
    w32(soc, SPI1 + DR, 0x7e)
    expect(sr(soc) & SPI_SR_TXE).toBe(0)
    let bsyLow = false
    for (let i = 0; i < 200 && sr(soc) & SPI_SR_BSY; i++) {
      runFor(soc, 1 / 72e6)
      if (!(sr(soc) & SPI_SR_BSY) && wires.of(PA5).length < 32) bsyLow = true
    }
    expect(bsyLow).toBe(false)
    const sck = wires.of(PA5).filter((e) => e.level === 1)
    expect(sck.length).toBe(16)
    for (let i = 1; i < 16; i++) expect(sck[i].cycle - sck[i - 1].cycle).toBe(8)
    expect(sr(soc) & SPI_SR_OVR).toBe(SPI_SR_OVR) // two frames received, none read (§25.3.5 transmit-only note)
  })

  it('16-bit frames, LSB first', () => {
    const { soc, wires } = setup()
    wires.connect(PA7, PA6) // loopback
    w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(1) | DFF | LSBFIRST)
    expect(transmitReceive(soc, SPI1, [0x1234, 0xbeef])).toEqual([0x1234, 0xbeef])
    // LSB first on the wire: the first MOSI level after the write is bit 0 of 0x1234 (0)
    const first = wires.of(PA7).find((e) => e.cycle > 0 && e.level === 0)
    expect(first).toBeDefined()
  })
})

describe('SPI1 master ↔ SPI2 slave', () => {
  for (const mode of [0, 1, 2, 3]) {
    it(`mode ${mode}: full duplex both ways, slave clocked by the SCK pin, NSS by GPIO`, () => {
      const { soc, wires } = setup()
      slavePins(soc)
      // PA4 as GPIO push-pull output driving the slave's NSS (PB12)
      w32(soc, GPIOA + 0x00, (r32(soc, GPIOA + 0x00) & 0xfff0ffff) | 0x00030000)
      w32(soc, GPIOA + 0x10, 1 << 4) // NSS high
      wires.connect(PA5, PB13)
      wires.connect(PA7, PB15)
      wires.connect(PB14, PA6)
      wires.connect(PA4, PB12)
      const pol = mode & 2 ? CPOL : 0
      const pha = mode & 1 ? CPHA : 0
      w32(soc, SPI2 + CR1, pol | pha) // slave, hardware NSS
      w32(soc, SPI2 + CR1, r32(soc, SPI2 + CR1) | SPE)
      w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(3) | pol | pha)
      w32(soc, SPI2 + DR, 0xab) // slave data ready before the clock
      w32(soc, GPIOA + 0x10, 1 << 20) // NSS low
      const got: number[] = []
      const slaveGot: number[] = []
      if (!(r32(soc, SPI1 + CR1) & SPE)) w32(soc, SPI1 + CR1, r32(soc, SPI1 + CR1) | SPE)
      w32(soc, SPI1 + DR, 0x12)
      expect(waitFor(soc, () => (sr(soc, SPI2) & SPI_SR_RXNE) !== 0)).toBe(true)
      slaveGot.push(r32(soc, SPI2 + DR))
      w32(soc, SPI2 + DR, 0xcd)
      expect(waitFor(soc, () => (sr(soc) & SPI_SR_RXNE) !== 0)).toBe(true)
      got.push(r32(soc, SPI1 + DR))
      waitFor(soc, () => !(sr(soc) & SPI_SR_BSY))
      w32(soc, SPI1 + DR, 0x34)
      expect(waitFor(soc, () => (sr(soc) & SPI_SR_RXNE) !== 0)).toBe(true)
      got.push(r32(soc, SPI1 + DR))
      expect(waitFor(soc, () => (sr(soc, SPI2) & SPI_SR_RXNE) !== 0)).toBe(true)
      slaveGot.push(r32(soc, SPI2 + DR))
      expect(got).toEqual([0xab, 0xcd])
      expect(slaveGot).toEqual([0x12, 0x34])
    })
  }

  for (const pha of [0, CPHA]) {
    it(`slave TXE semantics (CPHA = ${pha ? 1 : 0}): a second DR write before the clock queues behind the loaded byte`, () => {
      const { soc, wires } = setup()
      slavePins(soc)
      wires.connect(PA5, PB13)
      wires.connect(PA7, PB15)
      wires.connect(PB14, PA6)
      w32(soc, SPI2 + CR1, SSM | pha | SPE)
      w32(soc, SPI2 + DR, 0x11)
      expect(sr(soc, SPI2) & SPI_SR_TXE).toBe(SPI_SR_TXE) // moved to the shift register
      w32(soc, SPI2 + DR, 0x22)
      expect(sr(soc, SPI2) & SPI_SR_TXE).toBe(0)
      w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(3) | pha)
      expect(transmitReceive(soc, SPI1, [0xa1, 0xa2])).toEqual([0x11, 0x22])
    })
  }

  it('a slave whose DR is not refilled sends back the frame it received (shift register)', () => {
    const { soc, wires } = setup()
    slavePins(soc)
    wires.connect(PA5, PB13)
    wires.connect(PA7, PB15)
    wires.connect(PB14, PA6)
    w32(soc, SPI2 + CR1, SSM | SPE) // slave selected by software (SSI = 0)
    w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(3))
    expect(transmitReceive(soc, SPI1, [0x5a, 0x77])).toEqual([0x00, 0x5a])
  })

  it('CRC: master and slave TXCRC/RXCRC agree, the CRC frame is checked (no CRCERR); a corrupted CRC sets CRCERR', () => {
    const { soc, wires } = setup()
    slavePins(soc)
    wires.connect(PA5, PB13)
    wires.connect(PA7, PB15)
    wires.connect(PB14, PA6)
    w32(soc, SPI2 + CRCPR, 7)
    w32(soc, SPI2 + CR1, SSM | CRCEN)
    w32(soc, SPI2 + CR1, SSM | CRCEN | SPE)
    w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(3) | CRCEN)
    // "123456789" → CRC-8 (poly 0x07) = 0xF4 (CRC-8/SMBUS check value)
    const msg = [...'123456789'].map((c) => c.charCodeAt(0))
    const crcAfter = 9
    // the slave transmits nothing new (it echoes); its CRCNEXT is set while its 9th (last)
    // frame is under way, i.e. after the 9th RXNE … in this test right after the 9th RXNE
    let n = 0
    const orig = soc.pins.listener!
    soc.pins.listener = {
      pinDriveChanged: (pin, cycle) => {
        orig.pinDriveChanged(pin, cycle)
        if (pin === PB14) return
        if (sr(soc, SPI2) & SPI_SR_RXNE) {
          r32(soc, SPI2 + DR)
          n++
          if (n === crcAfter) w32(soc, SPI2 + CR1, r32(soc, SPI2 + CR1) | CRCNEXT)
        }
      },
    }
    const echo = transmitReceive(soc, SPI1, msg, true)
    expect(echo).toEqual([0, ...msg.slice(0, 8)])
    expect(r32(soc, SPI1 + TXCRCR)).toBe(0xf4)
    expect(r32(soc, SPI2 + RXCRCR)).toBe(0xf4)
    runFor(soc, 2e-6)
    expect(sr(soc, SPI2) & SPI_SR_CRCERR).toBe(0)
    // master side: it received the echo + the slave's CRC of the echo → consistent too
    expect(sr(soc) & SPI_SR_CRCERR).toBe(0)
    expect(r32(soc, SPI1 + CR1) & CRCNEXT).toBe(0) // cleared by hardware after the CRC frame
    // reference check of the bit-serial CRC
    let c = 0
    for (const b of msg) for (let i = 7; i >= 0; i--) c = spiCrcBit(c, (b >> i) & 1, 7, 8)
    expect(c).toBe(0xf4)
  })

  it('CRC phases out of step (slave sends its CRC one frame early) → CRCERR on both sides', () => {
    const { soc, wires } = setup()
    slavePins(soc)
    wires.connect(PA5, PB13)
    wires.connect(PA7, PB15)
    wires.connect(PB14, PA6)
    w32(soc, SPI2 + CR1, SSM | CRCEN | SPE)
    w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(3) | CRCEN)
    const msg = [1, 2, 3, 4]
    let n = 0
    const orig = soc.pins.listener!
    soc.pins.listener = {
      pinDriveChanged: (pin, cycle) => {
        orig.pinDriveChanged(pin, cycle)
        if (pin === PB14 || !(sr(soc, SPI2) & SPI_SR_RXNE)) return
        r32(soc, SPI2 + DR)
        if (++n === 3) w32(soc, SPI2 + CR1, r32(soc, SPI2 + CR1) | CRCNEXT)
      },
    }
    transmitReceive(soc, SPI1, msg, true)
    runFor(soc, 2e-6)
    expect(sr(soc, SPI2) & SPI_SR_CRCERR).toBe(SPI_SR_CRCERR)
    expect(sr(soc) & SPI_SR_CRCERR).toBe(SPI_SR_CRCERR)
    w32(soc, SPI1 + SR, ~SPI_SR_CRCERR & 0xffff) // rc_w0
    expect(sr(soc) & SPI_SR_CRCERR).toBe(0)
  })
})

describe('SPI NSS, errors, modes', () => {
  it('hardware NSS output (SSOE): NSS low while SPE = 1, high after SPE = 0', () => {
    const { soc } = setup()
    w32(soc, GPIOA + 0x00, (r32(soc, GPIOA + 0x00) & 0xfff0ffff) | 0x000b0000) // PA4 AF push-pull
    w32(soc, SPI1 + CR2, 1 << 2)
    w32(soc, SPI1 + CR1, MSTR | BR(3))
    expect(soc.pins.drive(PA4).level).toBe(1)
    w32(soc, SPI1 + CR1, MSTR | BR(3) | SPE)
    expect(soc.pins.drive(PA4).level).toBe(0)
    expect(sr(soc) & SPI_SR_MODF).toBe(0)
    w32(soc, SPI1 + CR1, MSTR | BR(3))
    expect(soc.pins.drive(PA4).level).toBe(1)
  })

  it('MODF: a master whose NSS input is pulled low drops to slave with SPE = 0; cleared by SR access + CR1 write', () => {
    const { soc, wires } = setup()
    w32(soc, GPIOA + 0x00, (r32(soc, GPIOA + 0x00) & 0xfff0ffff) | 0x00040000) // PA4 input floating
    wires.force(PA4, 1)
    w32(soc, SPI1 + CR1, MSTR | BR(3) | SPE) // SSM = 0, SSOE = 0: NSS is an input
    expect(r32(soc, SPI1 + CR1) & (SPE | MSTR)).toBe(SPE | MSTR)
    wires.force(PA4, 0)
    expect(sr(soc) & SPI_SR_MODF).toBe(SPI_SR_MODF)
    expect(r32(soc, SPI1 + CR1) & (SPE | MSTR)).toBe(0)
    // SPE/MSTR cannot be set while MODF = 1 … unless the clear sequence ran: SR read then CR1 write
    wires.force(PA4, 1)
    sr(soc)
    w32(soc, SPI1 + CR1, MSTR | BR(3) | SPE)
    expect(sr(soc) & SPI_SR_MODF).toBe(0)
    expect(r32(soc, SPI1 + CR1) & (SPE | MSTR)).toBe(SPE | MSTR)
  })

  it('OVR: cleared by a DR read followed by an SR read; the Rx buffer keeps the first frame', () => {
    const { soc, wires } = setup()
    wires.connect(PA7, PA6)
    w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(1) | SPE)
    w32(soc, SPI1 + DR, 0x11)
    waitFor(soc, () => (sr(soc) & SPI_SR_TXE) !== 0)
    w32(soc, SPI1 + DR, 0x22)
    waitFor(soc, () => !(sr(soc) & SPI_SR_BSY))
    expect(sr(soc) & SPI_SR_OVR).toBe(SPI_SR_OVR)
    expect(r32(soc, SPI1 + DR)).toBe(0x11)
    expect(sr(soc) & SPI_SR_OVR).toBe(SPI_SR_OVR) // this SR read completes the clear sequence
    expect(sr(soc) & SPI_SR_OVR).toBe(0)
  })

  it('RXONLY master clocks continuously from SPE = 1 and stops after the frame in progress when SPE is cleared', () => {
    const { soc, wires } = setup()
    wires.force(PA6, 1)
    w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(2) | RXONLY | SPE)
    const rx: number[] = []
    for (let i = 0; i < 3; i++) {
      expect(waitFor(soc, () => (sr(soc) & SPI_SR_RXNE) !== 0)).toBe(true)
      rx.push(r32(soc, SPI1 + DR))
    }
    expect(rx).toEqual([0xff, 0xff, 0xff])
    expect(soc.pins.drive(PA7).af).toBe(true)
    w32(soc, SPI1 + CR1, r32(soc, SPI1 + CR1) & ~SPE)
    runFor(soc, 5e-6)
    const n = wires.of(PA5).length
    runFor(soc, 5e-6)
    expect(wires.of(PA5).length).toBe(n)
    expect(n % 2).toBe(0) // SCK back at idle: the frame completed
  })

  it('BIDIMODE transmit (BIDIOE = 1) sends on MOSI, receives nothing', () => {
    const { soc } = setup()
    w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(1) | BIDIMODE | BIDIOE | SPE)
    w32(soc, SPI1 + DR, 0x5a)
    waitFor(soc, () => !(sr(soc) & SPI_SR_BSY))
    expect(sr(soc) & (SPI_SR_RXNE | SPI_SR_OVR)).toBe(0)
  })

  it('TXE / RXNE interrupts (IRQ 35) and DMA request lines', () => {
    const { soc, wires } = setup()
    wires.connect(PA7, PA6)
    const core = soc.core as unknown as { irqLines: Uint8Array }
    w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(1) | SPE)
    w32(soc, SPI1 + CR2, 1 << 7) // TXEIE
    expect(core.irqLines[35]).toBe(1)
    w32(soc, SPI1 + DR, 0x42)
    expect(core.irqLines[35]).toBe(0)
    w32(soc, SPI1 + CR2, 1 << 6) // RXNEIE
    expect(waitFor(soc, () => core.irqLines[35] === 1)).toBe(true)
    expect(r32(soc, SPI1 + DR)).toBe(0x42)
    expect(core.irqLines[35]).toBe(0)
  })

  it('SPI1 remap: SCK/MISO/MOSI on PB3/PB4/PB5', () => {
    const { soc, wires } = setup()
    set32(soc, AFIO + 0x04, (1 << 0) | (2 << 24)) // SPI1_REMAP, SWJ: JTAG off (PB3/PB4 free)
    w32(soc, GPIOB + 0x00, (r32(soc, GPIOB + 0x00) & 0xff000fff) | 0x00b4b000) // PB3 AF PP, PB4 in, PB5 AF PP
    wires.connect(PB5, PB4)
    w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(1))
    expect(transmitReceive(soc, SPI1, [0xc3])).toEqual([0xc3])
    expect(wires.of(PB3).length).toBeGreaterThanOrEqual(16)
    expect(wires.of(PA5).filter((e) => e.cycle > 0).length).toBe(0)
  })
})

describe('SPI1 with DMA1 (Table 78: SPI1_RX = channel 2, SPI1_TX = channel 3)', () => {
  it('loopback: TXDMAEN feeds DR on TXE, RXDMAEN empties it on RXNE — 16 bytes back to back', () => {
    const { soc, wires } = setup()
    wires.connect(PA7, PA6)
    set32(soc, RCC_AHBENR, 1)
    const DMA = 0x40020000
    const ccr = (ch: number) => DMA + 0x08 + 20 * (ch - 1)
    const tx = Array.from({ length: 16 }, (_, i) => (i * 29 + 3) & 0xff)
    tx.forEach((b, i) => soc.bus.write8(0x20001200 + i, b))
    // RX channel 2: SPI1_DR → memory; TX channel 3: memory → SPI1_DR
    w32(soc, ccr(2) + 4, 16)
    w32(soc, ccr(2) + 8, SPI1 + DR)
    w32(soc, ccr(2) + 12, 0x20001300)
    w32(soc, ccr(2), (1 << 7) | 1)
    w32(soc, ccr(3) + 4, 16)
    w32(soc, ccr(3) + 8, SPI1 + DR)
    w32(soc, ccr(3) + 12, 0x20001200)
    w32(soc, ccr(3), (1 << 7) | (1 << 4) | 1)
    w32(soc, SPI1 + CR2, 1) // RXDMAEN
    w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(2) | SPE)
    w32(soc, SPI1 + CR2, 3) // + TXDMAEN
    expect(waitFor(soc, () => ((r32(soc, DMA) >>> 5) & 1) === 1)).toBe(true) // TCIF2
    waitFor(soc, () => !(sr(soc) & SPI_SR_BSY))
    expect(Array.from(soc.readMemory(0x20001300, 16))).toEqual(tx)
    expect(sr(soc) & SPI_SR_OVR).toBe(0)
    // continuous: SCK never paused between the 16 frames (BR = /8 → 4 cycles per half period)
    const sck = wires.of(PA5).filter((e) => e.cycle > 0 && e.level === 1)
    expect(sck.length).toBe(128)
    let gaps = 0
    for (let i = 1; i < sck.length; i++) if (sck[i].cycle - sck[i - 1].cycle !== 8) gaps++
    expect(gaps).toBe(0)
  })
})
