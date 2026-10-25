/**
 * Wave-3 integration follow-ups in the STM32F1 peripheral contract
 * (src/mcu/stm32f1/periph-api.ts):
 *  - SocContext.setAfOutput(owner, pin, 'z'): an AF owner switches its output
 *    buffer off; the GPIO tri-states the pin (PinController.setAf) — SPI uses
 *    it for BIDIMODE receive (RM0008 §25.3.4: BIDIOE = 0 "output disabled");
 *  - DMA end-of-transfer signals: after every peripheral-requested transfer
 *    dma.ts emits 'DMA1_CH<n>_EOT_1' (CNDTR left at 1) / 'DMA1_CH<n>_EOT'
 *    (CNDTR left at 0) BEFORE the acknowledge, and passes the remaining count
 *    to dmaServed; the I2C LAST/NACK logic listens to EOT_1 instead of reading
 *    CNDTR through the bus (RM0008 §26.3.7).
 */
import { describe, expect, it } from 'vitest'
import { PIN_IN_FLOAT, PIN_OUT_PP } from '../src/mcu/pins'
import type { AccessSize } from '../src/mcu/core/types'
import type { CreateCortexM3 } from '../src/mcu/core/cpu-api'
import type { SocBlock } from '../src/mcu/stm32f1/block'
import type { AfioRemap, SocContext } from '../src/mcu/stm32f1/periph-api'
import { PERIPHERALS } from '../src/mcu/stm32f1/peripherals'
import { Stm32f103 } from '../src/mcu/stm32f1/soc'
import { I2c, I2C1_CONFIG, I2C_NOTES } from '../src/mcu/stm32f1/i2c'
import { SPI_NOTES } from '../src/mcu/stm32f1/spi'
import { EventQueue } from '../src/mcu/core/scheduler'
import {
  clock72,
  GPIOA,
  makeSoc,
  r32,
  RCC_AHBENR,
  RCC_APB2ENR,
  runFor,
  runToCycle,
  set32,
  StubCore,
  w32,
} from './mcu/stm32f1/helpers'
import { __setLangForTests } from '../src/i18n'
import { hasMessageTranslation, tMessage } from '../src/i18n/messages'

const PA7 = 7
const SPI1 = 0x40013000
const CR1 = 0x00
const SR = 0x08
const DR = 0x0c
const MSTR = 1 << 2
const SPE = 1 << 6
const SSI = 1 << 8
const SSM = 1 << 9
const BIDIOE = 1 << 14
const BIDIMODE = 1 << 15
const BR = (n: number) => n << 3
const RXNE = 1

// ------------------------------------------------------------ GPIO / SPI

function spiSoc() {
  const { soc } = makeSoc({ firmware: true })
  clock72(soc)
  set32(soc, RCC_APB2ENR, (1 << 0) | (1 << 2) | (1 << 12)) // AFIO, GPIOA, SPI1
  // PA5 SCK / PA7 MOSI AF push-pull 50 MHz, PA6 MISO input floating
  w32(soc, GPIOA + 0x00, (r32(soc, GPIOA + 0x00) & 0x000fffff) | 0xb4b00000)
  return soc
}

function waitRxne(soc: Stm32f103): boolean {
  for (let i = 0; i < 2000; i++) {
    if (r32(soc, SPI1 + SR) & RXNE) return true
    runFor(soc, 1e-6)
  }
  return false
}

describe("setAfOutput 'z': AF output enable off → tri-stated pin", () => {
  it('the GPIO floats an AF pin whose every owner is at z; a driving owner still wins; release → AF default', () => {
    const soc = spiSoc()
    const pins = soc.pins
    const cyc = () => soc.clock.cycles
    pins.setAf('OWNER_A', PA7, 1, cyc())
    expect(pins.drive(PA7)).toMatchObject({ mode: PIN_OUT_PP, level: 1, af: true })
    pins.setAf('OWNER_A', PA7, 'z', cyc())
    expect(pins.drive(PA7)).toMatchObject({ mode: PIN_IN_FLOAT, af: true })
    // the input path reads the circuit while tri-stated
    pins.setInput(PA7, 1, 3.3)
    expect(pins.level(PA7)).toBe(1)
    pins.setInput(PA7, 0, 0)
    expect(pins.level(PA7)).toBe(0)
    // another owner driving low: the pin is driven again
    pins.setAf('OWNER_B', PA7, 0, cyc())
    expect(pins.drive(PA7)).toMatchObject({ mode: PIN_OUT_PP, level: 0, af: true })
    pins.setAf('OWNER_B', PA7, null, cyc())
    expect(pins.drive(PA7).mode).toBe(PIN_IN_FLOAT)
    pins.setAf('OWNER_A', PA7, null, cyc()) // released: the AF output idles low
    expect(pins.drive(PA7)).toMatchObject({ mode: PIN_OUT_PP, level: 0, af: true })
    // z owners are not "conflicting drivers"
    expect(soc.drainLog().some((e) => /conflicting AF outputs/.test(e.message))).toBe(false)
  })

  it('SPI1 BIDIMODE receive master: MOSI (PA7) is high-impedance and the frame is sampled from it', () => {
    const soc = spiSoc()
    soc.pins.setInput(PA7, 1, 3.3) // the slave drives the shared data line high
    w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(1) | BIDIMODE | SPE) // BIDIOE = 0: receive
    expect(soc.pins.drive(PA7)).toMatchObject({ mode: PIN_IN_FLOAT, af: true })
    expect(waitRxne(soc)).toBe(true)
    expect(r32(soc, SPI1 + DR)).toBe(0xff)
    soc.pins.setInput(PA7, 0, 0)
    // a frame that started before the change may still carry ones: read until a 0x00 frame
    let got = -1
    for (let k = 0; k < 4 && got !== 0; k++) {
      expect(waitRxne(soc)).toBe(true)
      got = r32(soc, SPI1 + DR)
    }
    expect(got).toBe(0x00)
    // no "configure that pin as an input" workaround warning any more
    expect(soc.drainLog().some((e) => /bidirectional receive mode/.test(e.message))).toBe(false)
    // BIDIOE = 1: the same pin is driven again (transmit)
    w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(1) | BIDIMODE | BIDIOE | SPE)
    expect(soc.pins.drive(PA7)).toMatchObject({ mode: PIN_OUT_PP, af: true })
    // SPE = 0 releases it
    w32(soc, SPI1 + CR1, MSTR | SSI | SSM | BR(1) | BIDIMODE | BIDIOE)
    runFor(soc, 20e-6)
    expect(soc.pins.drive(PA7)).toMatchObject({ mode: PIN_OUT_PP, level: 0, af: true })
  })

  it('the SPI support note states the tri-state (and has a zh-TW text)', () => {
    expect(SPI_NOTES).toContain('bidirectional receive tri-states the data pin')
    expect(SPI_NOTES).not.toContain('GPIO model limitation')
    __setLangForTests('zh-TW')
    for (const n of [SPI_NOTES, SPI_NOTES + ' Same model as SPI1; slave mode unit-tested on SPI2.']) {
      expect(hasMessageTranslation(n), n.slice(0, 40)).toBe(true)
      expect(tMessage(n)).toMatch(/三態|高阻抗/)
    }
  })
})

// ------------------------------------------------------- DMA EOT signals

const DMA1 = 0x40020000
const CCR = (n: number) => DMA1 + 0x08 + 20 * (n - 1)
const CNDTR = (n: number) => DMA1 + 0x0c + 20 * (n - 1)
const CPAR = (n: number) => DMA1 + 0x10 + 20 * (n - 1)
const CMAR = (n: number) => DMA1 + 0x14 + 20 * (n - 1)

/** A register block in the TIM2 slot that requests DMA channel 2 while it holds data and records signals. */
class EotProbe implements SocBlock {
  readonly name = 'PROBE'
  ctx!: SocContext
  queue: number[] = []
  events: string[] = []
  attach(ctx: SocContext): void {
    this.ctx = ctx
    ctx.onTrigger?.('DMA1_CH2_EOT_1', (c) => this.events.push(`EOT_1@${c}`))
    ctx.onTrigger?.('DMA1_CH2_EOT', (c) => this.events.push(`EOT@${c}`))
  }
  push(...v: number[]): void {
    this.queue.push(...v)
    this.ctx.dmaRequest(2, this.queue.length > 0)
  }
  read(off: number): number {
    if (off !== 0) return 0
    const v = this.queue.shift() ?? 0
    this.ctx.dmaRequest(2, this.queue.length > 0)
    return v
  }
  write(_off: number, _value: number, _size: AccessSize): void {}
  dmaAck(): void {
    this.events.push('ack')
  }
  reset(): void {}
}

function socWithEotProbe() {
  const probe = new EotProbe()
  const specs = PERIPHERALS.filter((p) => p.name !== 'TIM2')
  specs.push({ name: 'PROBE', base: 0x40000000, gate: null, make: () => probe, status: 'unsupported', notes: '' })
  const createCore: CreateCortexM3 = (bus, sched, clock, hooks, config) => new StubCore(bus, sched, clock, hooks, config)
  const soc = new Stm32f103({ createCore, peripherals: specs })
  w32(soc, RCC_AHBENR, 0x15)
  return { soc, probe }
}

describe('DMA end-of-transfer signals (EOT_1 / EOT)', () => {
  it('fire on the transfers that leave CNDTR at 1 and 0, each before its acknowledge, every circular lap', () => {
    const { soc, probe } = socWithEotProbe()
    w32(soc, CPAR(2), 0x40000000)
    w32(soc, CMAR(2), 0x20000000)
    w32(soc, CNDTR(2), 3)
    w32(soc, CCR(2), (1 << 8) | (1 << 10) | (1 << 7) | (1 << 5) | 1) // 16-bit, MINC, CIRC, EN
    probe.push(1, 2, 3, 4, 5, 6)
    runToCycle(soc, 400)
    const kinds = probe.events.map((e) => e.replace(/@\d+$/, ''))
    expect(kinds).toEqual(['ack', 'EOT_1', 'ack', 'EOT', 'ack', 'ack', 'EOT_1', 'ack', 'EOT', 'ack'])
    expect(r32(soc, CNDTR(2))).toBe(3) // reloaded
  })

  it('mem-to-mem transfers (no requester) emit nothing', () => {
    const { soc, probe } = socWithEotProbe()
    w32(soc, CPAR(2), 0x20000000)
    w32(soc, CMAR(2), 0x20000100)
    w32(soc, CNDTR(2), 2)
    w32(soc, CCR(2), (2 << 8) | (2 << 10) | (1 << 6) | (1 << 7) | (1 << 14) | 1) // 32-bit, PINC, MINC, MEM2MEM, EN
    runToCycle(soc, 200)
    expect(r32(soc, CNDTR(2))).toBe(0)
    expect(probe.events).toEqual([])
  })
})

describe('I2C LAST takes EOT_1 from the DMA signal, never from CNDTR over the bus', () => {
  function fakeCtx(): { ctx: SocContext; subscribed: string[]; busReads: number[] } {
    const subscribed: string[] = []
    const busReads: number[] = []
    const clock = { cycles: 0 }
    const hz = () => 36e6
    const remap: AfioRemap = { spi1: false, i2c1: false, usart1: false, usart2: false, usart3: 0, tim1: 0, tim2: 0, tim3: 0, tim4: false, swj: 0 }
    const bus = {
      read8: (a: number) => (busReads.push(a), 0),
      read16: (a: number) => (busReads.push(a), 0),
      read32: (a: number) => (busReads.push(a), 0),
      write8: () => {},
      write16: () => {},
      write32: () => {},
    }
    const ctx = {
      clock,
      scheduler: new EventQueue(),
      clocks: { sysclk: hz, hclk: hz, pclk1: hz, pclk2: hz, timclk1: hz, timclk2: hz, adcclk: hz, lsi: () => 40e3, lse: () => 32768 },
      cyclesPerTick: (f: number) => 36e6 / f,
      timeOfCycle: (c: number) => c / 36e6,
      setIrq: () => {},
      setAfOutput: () => {},
      pinLevel: () => 1 as const,
      pinVoltage: () => NaN,
      onPinInput: () => () => {},
      pin: (name: string) => {
        const m = /^P([A-E])(\d+)$/.exec(name)
        return m ? 'ABCDE'.indexOf(m[1]) * 16 + Number(m[2]) : -1
      },
      remap: () => remap,
      dmaRequest: () => {},
      onTrigger: (signal: string) => {
        subscribed.push(signal)
        return () => {}
      },
      emitTrigger: () => {},
      bus,
      log: () => {},
      requestSync: () => {},
    } as unknown as SocContext
    return { ctx, subscribed, busReads }
  }

  it('I2C1 subscribes to channel 7 EOT_1 (Table 78: I2C1_RX) and an acknowledge reads nothing', () => {
    const { ctx, subscribed, busReads } = fakeCtx()
    const i2c = new I2c(I2C1_CONFIG)
    i2c.attach(ctx)
    expect(subscribed).toEqual(['DMA1_CH7_EOT_1'])
    i2c.dmaAck(7)
    i2c.dmaAck(6)
    expect(busReads).toEqual([])
  })

  it('the I2C support note names the EOT_1 signal (and has a zh-TW text)', () => {
    expect(I2C_NOTES).toContain('LAST (EOT_1 signalled by the DMA controller)')
    expect(I2C_NOTES).not.toContain('read from the DMA counter')
    __setLangForTests('zh-TW')
    for (const n of [I2C_NOTES, I2C_NOTES + ' Same model as I2C1; slave mode unit-tested on I2C2.']) {
      expect(hasMessageTranslation(n), n.slice(0, 40)).toBe(true)
      expect(tMessage(n)).toContain('由 DMA 控制器送出的 EOT_1 訊號')
    }
  })
})
