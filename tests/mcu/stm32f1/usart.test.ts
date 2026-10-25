/**
 * USART (RM0008 ch. 27), asynchronous mode: the TX waveform on the AF pin
 * with exact edge cycles at 9600 and 115200 baud, frame formats (parity,
 * 9-bit, stop bits, break), TXE/TC timing and the SR→DR clear sequences, RX
 * decoding from pin edges (incl. framing error, noise, overrun, IDLE), the
 * UartTap paths, interrupts, remap and the unsupported-mode reporting.
 */
import { describe, expect, it } from 'vitest'
import type { UartTap } from '../../../src/mcu/mcu-api'
import type { Stm32f103 } from '../../../src/mcu/stm32f1/soc'
import { AFIO, clock72, GPIOA, GPIOB, makeSoc, r32, RCC_APB1ENR, RCC_APB2ENR, recordPins, runToCycle, USART1, USART2, w32 } from './helpers'

const SR = 0x00
const DR = 0x04
const BRR = 0x08
const CR1 = 0x0c
const CR2 = 0x10
const CR3 = 0x14
const S_PE = 1
const S_FE = 2
const S_NE = 4
const S_ORE = 8
const S_IDLE = 0x10
const S_RXNE = 0x20
const S_TC = 0x40
const S_TXE = 0x80
const UE = 1 << 13
const TE = 1 << 3
const RE = 1 << 2
const PA9 = 9
const PA10 = 10

/** USART1 on PA9/PA10 with the given BRR; returns tap + recorded PA9 edges */
function usart1(brr: number, opts: { fast?: boolean } = {}) {
  const t = makeSoc()
  const { soc } = t
  if (opts.fast) clock72(soc)
  w32(soc, RCC_APB2ENR, (1 << 2) | (1 << 14) | 1)
  w32(soc, GPIOA + 0x04, (0x44444444 & ~0xf0) | 0xb0) // PA9 AF push-pull, PA10 floating input
  w32(soc, USART1 + BRR, brr)
  const pins = recordPins(soc)
  const tap = soc.uart('USART1') as UartTap
  const tx: { byte: number; cycle: number }[] = []
  tap.onTx = (byte, cycle) => tx.push({ byte, cycle })
  return { ...t, tap, tx, edges: () => pins.filter((e) => e.pin === PA9 && e.mode === 4).map((e) => ({ cycle: e.cycle, level: e.level })) }
}

/** expected edges of an 8N1 frame for `byte` starting at c0 */
function frameEdges(c0: number, B: number, byte: number, nbits = 8) {
  const out: { cycle: number; level: number }[] = []
  const lv = [0]
  for (let i = 0; i < nbits; i++) lv.push((byte >> i) & 1)
  lv.push(1)
  let prev = 1
  lv.forEach((l, i) => {
    if (l !== prev) out.push({ cycle: c0 + i * B, level: l })
    prev = l
  })
  return out
}

/** drive an RX frame onto `pin` with exact edge cycles */
function sendOnPin(soc: Stm32f103, pin: number, c0: number, B: number, word: number, nbits = 8, stopLevel: 0 | 1 = 1) {
  const lv: number[] = [0]
  for (let i = 0; i < nbits; i++) lv.push((word >> i) & 1)
  lv.push(stopLevel)
  let prev: number = soc.pins.level(pin)
  lv.forEach((l, i) => {
    if (l !== prev) {
      runToCycle(soc, c0 + i * B)
      soc.pins.setInput(pin, l as 0 | 1, l ? 3.3 : 0)
      prev = l
    }
  })
}

describe('USART transmitter', () => {
  it('9600 baud @ PCLK2 = 8 MHz: idle preamble, then a bit-exact 8N1 frame on PA9', () => {
    const B = 833 // BRR = 833 → 8 MHz / 833 = 9603.8 baud, one bit = 833 PCLK2 = 833 core cycles
    const { soc, tap, tx, edges } = usart1(B)
    runToCycle(soc, 1000)
    w32(soc, USART1 + CR1, UE | TE)
    expect(edges()).toEqual([{ cycle: 1000, level: 1 }]) // TX idles high as soon as TE is set
    expect(tap.config()).toEqual({ enabled: true, baud: 8e6 / 833, dataBits: 8, parity: 'none', stopBits: 1 })
    runToCycle(soc, 20000)
    expect(r32(soc, USART1 + SR) & (S_TXE | S_TC)).toBe(S_TXE | S_TC)
    w32(soc, USART1 + DR, 0x55) // after the SR read: clears TC
    expect(r32(soc, USART1 + SR) & (S_TXE | S_TC)).toBe(S_TXE) // TDR moved straight into the shift register
    runToCycle(soc, 20000 + 10 * B - 1)
    expect(r32(soc, USART1 + SR) & S_TC).toBe(0)
    expect(tx).toEqual([])
    runToCycle(soc, 20000 + 10 * B)
    expect(tx).toEqual([{ byte: 0x55, cycle: 20000 + 10 * B }])
    expect(r32(soc, USART1 + SR) & S_TC).toBe(S_TC)
    expect(edges().slice(1)).toEqual(frameEdges(20000, B, 0x55))
    // 0x55 alternates every bit: 10 edges (start … stop), one per bit time of 104.125 µs
    const e = edges().slice(1)
    expect(e.length).toBe(10)
    for (let i = 1; i < e.length; i++) expect(soc.timeOfCycle(e[i].cycle) - soc.timeOfCycle(e[i - 1].cycle)).toBeCloseTo(833 / 8e6, 12)
  })

  it('115200 baud @ 72 MHz (BRR = 0x271): edges at exact multiples of 8.6806 µs', () => {
    const { soc, tx, edges } = usart1(0x271, { fast: true })
    expect(soc.hclkHz).toBe(72e6)
    w32(soc, USART1 + CR1, UE | TE)
    const c0 = soc.clock.cycles + 200_000
    runToCycle(soc, c0)
    w32(soc, USART1 + DR, 0xa5)
    w32(soc, USART1 + DR, 0x0d) // queued in TDR: TXE = 0 until the first frame ends
    expect(r32(soc, USART1 + SR) & S_TXE).toBe(0)
    runToCycle(soc, c0 + 20 * 625 + 1)
    const e = edges().filter((x) => x.cycle >= c0)
    expect(e).toEqual([...frameEdges(c0, 625, 0xa5), ...frameEdges(c0 + 10 * 625, 625, 0x0d)])
    for (const x of e) {
      const k = (x.cycle - c0) / 625
      expect(Number.isInteger(k)).toBe(true)
      expect(soc.timeOfCycle(x.cycle) - soc.timeOfCycle(c0)).toBeCloseTo((k * 625) / 72e6, 12)
    }
    expect(tx.map((t) => t.byte)).toEqual([0xa5, 0x0d])
    expect(tx[1].cycle - tx[0].cycle).toBe(10 * 625) // back to back
    expect(r32(soc, USART1 + SR) & (S_TXE | S_TC)).toBe(S_TXE | S_TC)
  })

  it('USART2 runs from PCLK1: 36 MHz APB1 at 72 MHz HCLK → 2 core cycles per PCLK1 tick', () => {
    const { soc } = makeSoc()
    clock72(soc)
    w32(soc, RCC_APB2ENR, 1 << 2)
    w32(soc, RCC_APB1ENR, 1 << 17)
    w32(soc, GPIOA, (0x44444444 & ~0xf00) | 0xb00) // PA2 AF PP
    const ev = recordPins(soc)
    w32(soc, USART2 + BRR, 312) // 36 MHz / 312 = 115384.6 baud
    w32(soc, USART2 + CR1, UE | TE)
    const c0 = soc.clock.cycles + 20000
    runToCycle(soc, c0)
    w32(soc, USART2 + DR, 0x01)
    runToCycle(soc, c0 + 10 * 624)
    const e = ev.filter((x) => x.pin === 2 && x.cycle >= c0).map((x) => ({ cycle: x.cycle, level: x.level }))
    expect(e).toEqual(frameEdges(c0, 624, 0x01))
    expect((soc.uart('USART2') as UartTap).config().baud).toBeCloseTo(36e6 / 312, 6)
  })

  it('9 data bits + odd parity + 2 stop bits; the frame length and parity bit are right', () => {
    const B = 100
    const { soc, tx, edges } = usart1(B)
    w32(soc, USART1 + CR2, 2 << 12) // STOP = 2
    w32(soc, USART1 + CR1, UE | TE | (1 << 12) | (1 << 10) | (1 << 9)) // M, PCE, PS = odd
    const c0 = 5000
    runToCycle(soc, c0)
    w32(soc, USART1 + DR, 0x0f3) // 6 ones → odd parity bit = 1
    runToCycle(soc, c0 + 12 * B)
    expect(tx).toEqual([{ byte: 0xf3, cycle: c0 + 12 * B }])
    // bits: start, 1,1,0,0,1,1,1,1, parity 1, stop, stop
    expect(edges().filter((x) => x.cycle >= c0)).toEqual([
      { cycle: c0, level: 0 },
      { cycle: c0 + B, level: 1 },
      { cycle: c0 + 3 * B, level: 0 },
      { cycle: c0 + 5 * B, level: 1 },
    ])
  })

  it('SBK sends a break (10 low bit times + a high stop bit) and clears itself', () => {
    const B = 50
    const { soc, edges } = usart1(B)
    w32(soc, USART1 + CR1, UE | TE)
    runToCycle(soc, 2000)
    w32(soc, USART1 + CR1, UE | TE | 1)
    runToCycle(soc, 2000 + 11 * B)
    expect(edges().filter((x) => x.cycle >= 2000)).toEqual([
      { cycle: 2000, level: 0 },
      { cycle: 2000 + 10 * B, level: 1 },
    ])
    expect(r32(soc, USART1 + CR1) & 1).toBe(0)
  })

  it('TXE / TC interrupts on IRQ 37, DMAT raises the DMA1 channel 4 request', () => {
    const B = 40
    const { soc, core } = usart1(B)
    w32(soc, USART1 + CR1, UE | TE | (1 << 7)) // TXEIE
    expect(core.irqLines[37]).toBe(1)
    runToCycle(soc, 1000)
    w32(soc, USART1 + DR, 1)
    w32(soc, USART1 + DR, 2)
    expect(core.irqLines[37]).toBe(0) // TXE = 0
    runToCycle(soc, 1000 + 10 * B)
    expect(core.irqLines[37]).toBe(1)
    w32(soc, USART1 + CR1, UE | TE | (1 << 6)) // TCIE only
    runToCycle(soc, 1000 + 20 * B)
    expect(core.irqLines[37]).toBe(1)
    r32(soc, USART1 + SR)
    w32(soc, USART1 + DR, 3) // SR read → DR write clears TC
    expect(core.irqLines[37]).toBe(0)
    // DMAT with TXE = 1 raises USART1_TX → DMA1 channel 4 (RM0008 Table 78);
    // the SoC routes the OR-ed request line to the DMA1 block
    const dma = soc.block('DMA1') as unknown as { dmaRequestChanged(ch: number, a: boolean): void }
    const seen: [number, boolean][] = []
    const orig = dma.dmaRequestChanged.bind(dma)
    dma.dmaRequestChanged = (ch, a) => {
      seen.push([ch, a])
      orig(ch, a)
    }
    runToCycle(soc, 1000 + 30 * B) // TXE back to 1
    w32(soc, USART1 + CR3, 1 << 7) // DMAT
    expect(seen).toContainEqual([4, true])
  })

  it('AFIO remap moves TX to PB6', () => {
    const { soc } = makeSoc()
    w32(soc, RCC_APB2ENR, (1 << 3) | (1 << 14) | 1)
    w32(soc, AFIO + 4, 1 << 2)
    w32(soc, GPIOB, (0x44444444 & ~0x0f000000) | 0x0b000000) // PB6 AF PP
    w32(soc, USART1 + BRR, 100)
    w32(soc, USART1 + CR1, UE | TE)
    expect(soc.pins.drive(22)).toEqual({ mode: 4, level: 1, af: true })
  })

  it('unsupported modes are reported, the UART keeps working', () => {
    const { soc } = usart1(100)
    w32(soc, USART1 + CR2, 1 << 11) // CLKEN
    w32(soc, USART1 + CR3, 1 << 3) // HDSEL
    const msgs = soc.drainLog().map((e) => e.message).join('\n')
    expect(msgs).toMatch(/synchronous mode \(CLKEN, CK pin\) is not simulated/)
    expect(msgs).toMatch(/half-duplex mode \(HDSEL\) is not simulated/)
  })
})

describe('USART receiver (pin edges)', () => {
  function rx(B: number) {
    const t = usart1(B)
    t.soc.pins.setInput(PA10, 1, 3.3) // idle line high
    w32(t.soc, USART1 + CR1, UE | RE | TE)
    return t
  }

  it('decodes a frame; RXNE at the stop bit sample point; DR read clears it', () => {
    const B = 160
    const { soc, core } = rx(B)
    w32(soc, USART1 + CR1, UE | RE | TE | (1 << 5)) // RXNEIE
    const c0 = 10_000
    sendOnPin(soc, PA10, c0, B, 0x4b)
    const decide = c0 + 9 * B + (B * 10) / 16
    runToCycle(soc, decide - 1)
    expect(r32(soc, USART1 + SR) & S_RXNE).toBe(0)
    runToCycle(soc, decide)
    expect(r32(soc, USART1 + SR) & (S_RXNE | S_FE | S_NE | S_PE)).toBe(S_RXNE)
    expect(core.irqLines[37]).toBe(1)
    expect(r32(soc, USART1 + DR)).toBe(0x4b)
    expect(r32(soc, USART1 + SR) & S_RXNE).toBe(0)
    expect(core.irqLines[37]).toBe(0)
  })

  it('framing error: stop bit sampled low → FE + RXNE, cleared by SR read then DR read', () => {
    const B = 160
    const { soc } = rx(B)
    const c0 = 10_000
    sendOnPin(soc, PA10, c0, B, 0x81, 8, 0)
    runToCycle(soc, c0 + 11 * B)
    soc.pins.setInput(PA10, 1, 3.3)
    runToCycle(soc, c0 + 12 * B)
    const sr = r32(soc, USART1 + SR)
    expect(sr & (S_RXNE | S_FE)).toBe(S_RXNE | S_FE)
    expect(r32(soc, USART1 + DR)).toBe(0x81)
    expect(r32(soc, USART1 + SR) & (S_FE | S_RXNE)).toBe(0)
  })

  it('a glitch inside a bit sets NE; a too-short start pulse is ignored', () => {
    const B = 160
    const { soc } = rx(B)
    // false start: low for 1/4 bit
    runToCycle(soc, 5000)
    soc.pins.setInput(PA10, 0, 0)
    runToCycle(soc, 5040)
    soc.pins.setInput(PA10, 1, 3.3)
    runToCycle(soc, 9000)
    expect(r32(soc, USART1 + SR) & S_RXNE).toBe(0)
    // frame 0xFF with a glitch at sample 9 of bit 3
    const c0 = 10_000
    runToCycle(soc, c0)
    soc.pins.setInput(PA10, 0, 0)
    runToCycle(soc, c0 + B)
    soc.pins.setInput(PA10, 1, 3.3)
    const g = c0 + 4 * B + (B * 9) / 16 - 2
    runToCycle(soc, g)
    soc.pins.setInput(PA10, 0, 0)
    runToCycle(soc, g + 4)
    soc.pins.setInput(PA10, 1, 3.3)
    runToCycle(soc, c0 + 11 * B)
    const sr = r32(soc, USART1 + SR)
    expect(sr & (S_RXNE | S_NE)).toBe(S_RXNE | S_NE)
    expect(r32(soc, USART1 + DR)).toBe(0xff) // majority vote kept the 1
  })

  it('overrun: a second frame while RXNE is set sets ORE and is lost; IDLE after one idle frame', () => {
    const B = 160
    const { soc, core } = rx(B)
    sendOnPin(soc, PA10, 10_000, B, 0x31)
    sendOnPin(soc, PA10, 10_000 + 10 * B, B, 0x32)
    runToCycle(soc, 10_000 + 20 * B)
    expect(r32(soc, USART1 + SR) & (S_RXNE | S_ORE)).toBe(S_RXNE | S_ORE)
    expect(r32(soc, USART1 + DR)).toBe(0x31)
    expect(r32(soc, USART1 + SR) & S_ORE).toBe(0) // cleared by the SR→DR sequence above
    w32(soc, USART1 + CR1, UE | RE | TE | (1 << 4)) // IDLEIE
    runToCycle(soc, 10_000 + 30 * B + 1)
    expect(r32(soc, USART1 + SR) & S_IDLE).toBe(S_IDLE)
    expect(core.irqLines[37]).toBe(1)
    r32(soc, USART1 + DR)
    expect(r32(soc, USART1 + SR) & S_IDLE).toBe(0)
    runToCycle(soc, 10_000 + 60 * B)
    expect(r32(soc, USART1 + SR) & S_IDLE).toBe(0) // not re-armed without a new RXNE
  })

  it('parity error with PCE (even parity)', () => {
    const B = 160
    const { soc } = rx(B)
    w32(soc, USART1 + CR1, UE | RE | (1 << 10)) // PCE even, M = 0: 7 data bits + parity
    sendOnPin(soc, PA10, 10_000, B, 0x03 | 0x80) // 2 ones + parity 1 → odd total → PE
    runToCycle(soc, 10_000 + 11 * B)
    expect(r32(soc, USART1 + SR) & (S_PE | S_RXNE)).toBe(S_PE | S_RXNE)
    expect(r32(soc, USART1 + DR)).toBe(0x83) // the parity bit is read in the MSB
  })
})

describe('UartTap', () => {
  it('send() delivers one byte per frame time at the programmed baud', () => {
    const B = 833
    const { soc, tap } = usart1(B)
    w32(soc, USART1 + CR1, UE | RE)
    runToCycle(soc, 1000)
    tap.send(new Uint8Array([0x68, 0x69]))
    const first = 1000 + 9 * B + (B * 10) / 16
    runToCycle(soc, Math.floor(first) - 1)
    expect(r32(soc, USART1 + SR) & S_RXNE).toBe(0)
    runToCycle(soc, Math.ceil(first))
    expect(r32(soc, USART1 + DR)).toBe(0x68)
    runToCycle(soc, Math.ceil(first + 10 * B))
    expect(r32(soc, USART1 + DR)).toBe(0x69)
  })

  it('bytes overrun like on a wire when firmware does not read; dropped while RE = 0', () => {
    const { soc, tap } = usart1(100)
    tap.send(new Uint8Array([1]))
    expect(soc.drainLog().some((e) => /dropped: the receiver is disabled/.test(e.message))).toBe(true)
    w32(soc, USART1 + CR1, UE | RE)
    tap.send(new Uint8Array([1, 2, 3]))
    runToCycle(soc, soc.clock.cycles + 40 * 100)
    expect(r32(soc, USART1 + SR) & (S_RXNE | S_ORE)).toBe(S_RXNE | S_ORE)
    expect(r32(soc, USART1 + DR)).toBe(1)
  })
})
