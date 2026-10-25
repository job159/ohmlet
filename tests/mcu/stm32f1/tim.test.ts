/**
 * TIM1–TIM4 register-level tests (src/mcu/stm32f1/tim.ts) through the SoC
 * with the stub core: firmware-style bus accesses, exact cycles via
 * runToCycle, pin edges via the pin listener, injected input edges via
 * pins.setInput at exact cycles. HCLK = HSI 8 MHz after reset, APB1 = APB2
 * = /1, so TIMxCLK = HCLK and one timer kernel tick = one core cycle.
 */
import { describe, expect, it } from 'vitest'
import { EventQueue } from '../../../src/mcu/core/scheduler'
import { PIN_OUT_PP } from '../../../src/mcu/pins'
import type { SocContext } from '../../../src/mcu/stm32f1/periph-api'
import type { Stm32f103 } from '../../../src/mcu/stm32f1/soc'
import { Tim, TIM1_CONFIG, TIM2_CONFIG } from '../../../src/mcu/stm32f1/tim'
import { clock72, GPIOA, GPIOB, makeSoc, r32, RCC_APB1ENR, RCC_APB2ENR, recordPins, runFor, runToCycle, set32, w32 } from './helpers'

const TIM1 = 0x40012c00
const TIM2 = 0x40000000
const TIM3 = 0x40000400
const TIM4 = 0x40000800
const CR1 = 0x00
const CR2 = 0x04
const SMCR = 0x08
const DIER = 0x0c
const SR = 0x10
const EGR = 0x14
const CCMR1 = 0x18
const CCMR2 = 0x1c
const CCER = 0x20
const CNT = 0x24
const PSC = 0x28
const ARR = 0x2c
const RCR = 0x30
const CCR1 = 0x34
const CCR2 = 0x38
const BDTR = 0x44
const DCR = 0x48
const DMAR = 0x4c
const DBGMCU_CR = 0xe0042004
const AFIO_MAPR = 0x40010004

const PA0 = 0
const PA6 = 6
const PA8 = 8
const PB12 = 28
const PB13 = 29
const PB6 = 22
const PB7 = 23

/** clocks for TIM1–4, GPIOA/B, AFIO */
function setup() {
  const t = makeSoc({ firmware: true })
  set32(t.soc, RCC_APB1ENR, 0b111)
  set32(t.soc, RCC_APB2ENR, (1 << 11) | (1 << 2) | (1 << 3) | 1)
  return t
}

/** GPIO pin `bit` of the port at `base` → configuration nibble (0xB = AF push-pull 50 MHz, 0x4 = floating input) */
function cfgPin(s: Stm32f103, port: number, bit: number, nibble: number) {
  const reg = port + (bit < 8 ? 0 : 4)
  const sh = (bit & 7) * 4
  w32(s, reg, (r32(s, reg) & ~(0xf << sh)) | (nibble << sh))
}

const edgesOf = (log: { pin: number; cycle: number; mode: number; level: number }[], pin: number) => log.filter((e) => e.pin === pin)

describe('TIM registers', () => {
  it('reset values, write masks, reserved and TIM1-only offsets', () => {
    const { soc } = setup()
    expect(r32(soc, TIM2 + ARR)).toBe(0xffff)
    for (const off of [CR1, CR2, SMCR, DIER, SR, CCMR1, CCMR2, CCER, CNT, PSC, CCR1, DCR]) expect(r32(soc, TIM2 + off), off.toString(16)).toBe(0)
    w32(soc, TIM2 + CR1, 0xffffff9f) // edge-aligned: DIR is read/write
    expect(r32(soc, TIM2 + CR1)).toBe(0x39f)
    w32(soc, TIM2 + CR1, 0xffffffff) // center-aligned: DIR is read-only (counting up)
    expect(r32(soc, TIM2 + CR1)).toBe(0x3ef)
    w32(soc, TIM2 + CR1, 0)
    w32(soc, TIM2 + CR2, 0xffffffff)
    expect(r32(soc, TIM2 + CR2)).toBe(0xf8)
    w32(soc, TIM2 + DIER, 0xffffffff)
    expect(r32(soc, TIM2 + DIER)).toBe(0x5f5f)
    w32(soc, TIM2 + DIER, 0)
    w32(soc, TIM2 + CCER, 0xffffffff)
    expect(r32(soc, TIM2 + CCER)).toBe(0x3333)
    w32(soc, TIM2 + RCR, 5)
    expect(r32(soc, TIM2 + RCR)).toBe(0) // TIM2 has no RCR / BDTR
    w32(soc, TIM2 + BDTR, 0x8000)
    expect(r32(soc, TIM2 + BDTR)).toBe(0)
    w32(soc, TIM1 + CR2, 0xfffffffb) // all but CCUS (COM on TRGI = ITR0, which has no master here)
    expect(r32(soc, TIM1 + CR2)).toBe(0x7ff9)
    w32(soc, TIM1 + RCR, 0x1ff)
    expect(r32(soc, TIM1 + RCR)).toBe(0xff)
    expect(r32(soc, TIM1 + EGR)).toBe(0) // write-only
    // 16-bit halfword access to CNT / byte lanes
    soc.bus.write16(TIM3 + PSC, 0x1234)
    expect(soc.bus.read16(TIM3 + PSC)).toBe(0x1234)
    // the all-ones CR1 write is reported: reserved CKD = 11, edge → center-aligned while enabled
    expect(soc.drainLog().filter((e) => e.level !== 'info').map((e) => e.message.slice(0, 30))).toEqual([
      'TIM2_CR1.CKD = 11 is reserved ',
      'TIM2: switching from edge-alig',
    ])
  })

  it('CCxS is writable only while the channel is off; SR is rc_w0', () => {
    const { soc } = setup()
    w32(soc, TIM2 + CCER, 1)
    w32(soc, TIM2 + CCMR1, 1)
    expect(r32(soc, TIM2 + CCMR1) & 3).toBe(0)
    w32(soc, TIM2 + CCER, 0)
    w32(soc, TIM2 + CCMR1, 1)
    expect(r32(soc, TIM2 + CCMR1) & 3).toBe(1)
    w32(soc, TIM2 + EGR, 0b11111) // UG + CC1G..CC4G
    expect(r32(soc, TIM2 + SR)).toBe(0x1f)
    w32(soc, TIM2 + SR, ~0b10 >>> 0) // write 0 to CC1IF only
    expect(r32(soc, TIM2 + SR)).toBe(0x1d)
  })
})

describe('TIM time base (lazy counter)', () => {
  it('CNT = elapsed / (PSC + 1) mod (ARR + 1); UIF from overflows nobody scheduled', () => {
    const { soc } = setup()
    w32(soc, TIM2 + PSC, 7)
    w32(soc, TIM2 + ARR, 99)
    w32(soc, TIM2 + EGR, 1) // load PSC
    w32(soc, TIM2 + SR, 0)
    const c0 = soc.clock.cycles
    w32(soc, TIM2 + CR1, 1)
    runToCycle(soc, c0 + 8 * 57 + 3)
    expect(r32(soc, TIM2 + CNT)).toBe(57)
    expect(r32(soc, TIM2 + SR) & 1).toBe(0)
    runToCycle(soc, c0 + 8 * 100)
    expect(r32(soc, TIM2 + CNT)).toBe(0)
    expect(r32(soc, TIM2 + SR) & 1).toBe(1) // overflow at step 100
    runToCycle(soc, c0 + 8 * 1234 + 7)
    expect(r32(soc, TIM2 + CNT)).toBe(34)
    // CNT write keeps the prescaler phase
    w32(soc, TIM2 + CNT, 90)
    runToCycle(soc, c0 + 8 * 1235)
    expect(r32(soc, TIM2 + CNT)).toBe(91)
  })

  it('PSC is preloaded until the next update event; ARR preload follows ARPE', () => {
    const { soc } = setup()
    w32(soc, TIM2 + ARR, 9)
    w32(soc, TIM2 + EGR, 1)
    const c0 = soc.clock.cycles
    w32(soc, TIM2 + CR1, 1)
    runToCycle(soc, c0 + 5)
    w32(soc, TIM2 + PSC, 1) // takes effect at the overflow at c0 + 10
    runToCycle(soc, c0 + 10)
    expect(r32(soc, TIM2 + CNT)).toBe(0)
    runToCycle(soc, c0 + 14)
    expect(r32(soc, TIM2 + CNT)).toBe(2)
    // ARPE = 0: a new ARR applies at once
    w32(soc, TIM2 + ARR, 3)
    runToCycle(soc, c0 + 14 + 2 * 2)
    expect(r32(soc, TIM2 + CNT)).toBe(0)
    // ARPE = 1: ARR changes only at the next update
    w32(soc, TIM2 + CR1, 0x81)
    w32(soc, TIM2 + ARR, 7)
    runToCycle(soc, c0 + 18 + 2 * 4) // wraps at old ARR 3
    expect(r32(soc, TIM2 + CNT)).toBe(0)
    runToCycle(soc, c0 + 26 + 2 * 6)
    expect(r32(soc, TIM2 + CNT)).toBe(6)
  })

  it('down-counting and center-aligned sequences, DIR read-only in center mode', () => {
    const { soc } = setup()
    w32(soc, TIM3 + ARR, 4)
    w32(soc, TIM3 + CR1, 0x10) // DIR = down
    w32(soc, TIM3 + EGR, 1) // UG: counter ← ARR when counting down
    expect(r32(soc, TIM3 + CNT)).toBe(4)
    const c0 = soc.clock.cycles
    w32(soc, TIM3 + SR, 0)
    w32(soc, TIM3 + CR1, 0x11)
    const seq: number[] = []
    for (let i = 1; i <= 6; i++) {
      runToCycle(soc, c0 + i)
      seq.push(r32(soc, TIM3 + CNT))
    }
    expect(seq).toEqual([3, 2, 1, 0, 4, 3])
    expect(r32(soc, TIM3 + SR) & 1).toBe(1)

    // center-aligned mode 1
    w32(soc, TIM4 + ARR, 3)
    w32(soc, TIM4 + CR1, 0x20)
    w32(soc, TIM4 + EGR, 1)
    const c1 = soc.clock.cycles
    w32(soc, TIM4 + CR1, 0x21)
    const cs: string[] = []
    for (let i = 1; i <= 8; i++) {
      runToCycle(soc, c1 + i)
      cs.push(`${r32(soc, TIM4 + CNT)}${r32(soc, TIM4 + CR1) & 0x10 ? 'd' : 'u'}`)
    }
    expect(cs).toEqual(['1u', '2u', '3d', '2d', '1d', '0u', '1u', '2u'])
    w32(soc, TIM4 + CR1, 0x31) // DIR write ignored
    expect(r32(soc, TIM4 + CR1) & 0x10).toBe(0)
  })

  it('UG re-initialises, URS hides it from UIF, UDIS suppresses updates, OPM stops at the update', () => {
    const { soc } = setup()
    w32(soc, TIM2 + ARR, 99)
    w32(soc, TIM2 + CR1, 1)
    runFor(soc, 1e-5)
    w32(soc, TIM2 + CR1, 0x5) // URS
    w32(soc, TIM2 + PSC, 3)
    w32(soc, TIM2 + EGR, 1)
    expect(r32(soc, TIM2 + CNT)).toBe(0)
    expect(r32(soc, TIM2 + SR) & 1).toBe(0) // URS: no UIF from UG
    const c0 = soc.clock.cycles
    runToCycle(soc, c0 + 8)
    expect(r32(soc, TIM2 + CNT)).toBe(2) // the new PSC was transferred by UG
    // UDIS: overflow restarts the counter but transfers nothing and sets no flag
    w32(soc, TIM2 + CR1, 0x3)
    w32(soc, TIM2 + PSC, 0)
    runToCycle(soc, c0 + 8 + 4 * 98)
    expect(r32(soc, TIM2 + CNT)).toBe(0)
    expect(r32(soc, TIM2 + SR) & 1).toBe(0)
    // OPM: counter stops (CEN cleared) at the next update event
    w32(soc, TIM3 + ARR, 49)
    w32(soc, TIM3 + CR1, 0x9)
    const c1 = soc.clock.cycles
    runToCycle(soc, c1 + 49)
    expect(r32(soc, TIM3 + CR1) & 1).toBe(1)
    runToCycle(soc, c1 + 50)
    expect(r32(soc, TIM3 + CR1) & 1).toBe(0)
    runToCycle(soc, c1 + 80)
    expect(r32(soc, TIM3 + CNT)).toBe(0)
  })

  it('update interrupt: IRQ 28 asserted at the exact overflow cycle, level until UIF is cleared', () => {
    const { soc, core } = setup()
    w32(soc, TIM2 + PSC, 7)
    w32(soc, TIM2 + ARR, 999) // 1 kHz at 8 MHz
    w32(soc, TIM2 + EGR, 1)
    w32(soc, TIM2 + SR, 0)
    w32(soc, TIM2 + DIER, 1)
    const c0 = soc.clock.cycles
    w32(soc, TIM2 + CR1, 1)
    runToCycle(soc, c0 + 8000 + 10)
    const on = core.irqLog.filter((e) => e.irq === 28 && e.on)
    expect(on.map((e) => e.cycle)).toEqual([c0 + 8000])
    expect(core.irqLines[28]).toBe(1)
    w32(soc, TIM2 + SR, 0)
    expect(core.irqLines[28]).toBe(0)
    runToCycle(soc, c0 + 16000)
    expect(core.irqLines[28]).toBe(1)
  })

  it('a clock switch re-derives the counter rate (8 MHz → 72 MHz PLL, APB1 /2 → TIMXCLK 72 MHz)', () => {
    const { soc } = setup()
    w32(soc, TIM2 + PSC, 7)
    w32(soc, TIM2 + EGR, 1)
    w32(soc, TIM2 + CR1, 1)
    runFor(soc, 1e-3)
    const before = r32(soc, TIM2 + CNT)
    expect(Math.abs(before - 1000)).toBeLessThanOrEqual(1) // 1 MHz
    clock72(soc)
    const a = r32(soc, TIM2 + CNT)
    runFor(soc, 1e-3)
    const b = r32(soc, TIM2 + CNT)
    expect(b - a).toBe(9000) // 72 MHz / 8
  })

  it('DBG_TIM2_STOP freezes the counter while the core is halted', () => {
    const { soc } = setup()
    w32(soc, DBGMCU_CR, 1 << 11)
    w32(soc, TIM2 + CR1, 1)
    runFor(soc, 1e-4)
    soc.halt()
    const a = r32(soc, TIM2 + CNT)
    runFor(soc, 1e-4)
    expect(r32(soc, TIM2 + CNT)).toBe(a)
    soc.resume()
    runToCycle(soc, soc.clock.cycles + 800)
    expect(r32(soc, TIM2 + CNT) - a).toBe(800)
  })
})

describe('TIM output compare and PWM', () => {
  function pwm(soc: Stm32f103, base: number, ocm: number, ccer: number, ccr: number, arr: number) {
    w32(soc, base + ARR, arr)
    w32(soc, base + CCR1, ccr)
    w32(soc, base + CCMR1, (ocm << 4) | 0x8)
    w32(soc, base + EGR, 1)
    w32(soc, base + CCER, ccer)
  }

  it('PWM mode 1/2 × CC1P on PA0: edges at the exact compare and overflow cycles', () => {
    for (const [ocm, ccp] of [
      [6, 0],
      [6, 1],
      [7, 0],
      [7, 1],
    ]) {
      const { soc } = setup()
      cfgPin(soc, GPIOA, 0, 0xb)
      const log = recordPins(soc)
      pwm(soc, TIM2, ocm, 1 | (ccp << 1), 25, 99)
      const c0 = soc.clock.cycles
      w32(soc, TIM2 + CR1, 1)
      runToCycle(soc, c0 + 350)
      const active = ocm === 6 ? 1 : 0
      const lvl = (ref: number) => ref ^ (ocm === 6 ? 0 : 1) ^ ccp
      const e = edgesOf(log, PA0).filter((x) => x.cycle > c0 && x.mode === PIN_OUT_PP)
      expect(e.map((x) => [x.cycle - c0, x.level]), `OCM ${ocm} CC1P ${ccp}`).toEqual([
        [25, lvl(0)],
        [100, lvl(1)],
        [125, lvl(0)],
        [200, lvl(1)],
        [225, lvl(0)],
        [300, lvl(1)],
        [325, lvl(0)],
      ])
      expect(soc.pins.drive(PA0).level).toBe(lvl(0))
      void active
    }
  })

  it('PWM boundary duties: CCR = 0 → always inactive, CCR > ARR → always active; preloaded CCR changes at the update', () => {
    const { soc } = setup()
    cfgPin(soc, GPIOA, 0, 0xb)
    const log = recordPins(soc)
    pwm(soc, TIM2, 6, 1, 0, 99)
    const c0 = soc.clock.cycles
    w32(soc, TIM2 + CR1, 1)
    runToCycle(soc, c0 + 250)
    expect(edgesOf(log, PA0).filter((x) => x.cycle > c0)).toEqual([])
    expect(soc.pins.drive(PA0).level).toBe(0)
    w32(soc, TIM2 + CCR1, 100) // preloaded: applies at the overflow at c0 + 300
    runToCycle(soc, c0 + 299)
    expect(soc.pins.drive(PA0).level).toBe(0)
    runToCycle(soc, c0 + 500)
    expect(edgesOf(log, PA0).filter((x) => x.cycle > c0).map((x) => [x.cycle - c0, x.level])).toEqual([[300, 1]])
  })

  it('center-aligned PWM is symmetric about the top; CMS 1 flags compare matches only counting down', () => {
    const { soc } = setup()
    cfgPin(soc, GPIOA, 6, 0xb)
    const log = recordPins(soc)
    w32(soc, TIM3 + CR1, 0x20)
    pwm(soc, TIM3, 6, 1, 30, 100)
    const c0 = soc.clock.cycles
    w32(soc, TIM3 + SR, 0)
    w32(soc, TIM3 + CR1, 0x21)
    runToCycle(soc, c0 + 60)
    expect(r32(soc, TIM3 + SR) & 2).toBe(0) // the up-counting match at 30 does not set CC1IF in mode 1
    runToCycle(soc, c0 + 420)
    expect(edgesOf(log, PA6).filter((x) => x.cycle > c0).map((x) => [x.cycle - c0, x.level])).toEqual([
      [30, 0],
      [170, 1], // 200 − 30
      [230, 0],
      [370, 1],
    ])
    expect(r32(soc, TIM3 + SR) & 2).toBe(2)
  })

  it('toggle mode: OC1 toggles at every match (half the update rate), force active/inactive', () => {
    const { soc } = setup()
    cfgPin(soc, GPIOA, 0, 0xb)
    const log = recordPins(soc)
    w32(soc, TIM2 + ARR, 49)
    w32(soc, TIM2 + CCR1, 10)
    w32(soc, TIM2 + CCMR1, 3 << 4)
    w32(soc, TIM2 + CCER, 1)
    const c0 = soc.clock.cycles
    w32(soc, TIM2 + CR1, 1)
    runToCycle(soc, c0 + 200)
    expect(edgesOf(log, PA0).filter((x) => x.cycle > c0).map((x) => [x.cycle - c0, x.level])).toEqual([
      [10, 1],
      [60, 0],
      [110, 1],
      [160, 0],
    ])
    w32(soc, TIM2 + CCMR1, 5 << 4) // force active
    expect(soc.pins.drive(PA0).level).toBe(1)
    w32(soc, TIM2 + CCMR1, 4 << 4)
    expect(soc.pins.drive(PA0).level).toBe(0)
  })

  it('100 kHz PWM costs about two scheduled events per period', () => {
    const { soc } = setup()
    cfgPin(soc, GPIOA, 0, 0xb)
    const log = recordPins(soc)
    let n = 0
    const sched = soc.scheduler
    const orig = sched.schedule.bind(sched)
    sched.schedule = (at, fn) => {
      n++
      return orig(at, fn)
    }
    pwm(soc, TIM2, 6, 1, 40, 79) // 8 MHz / 80 = 100 kHz, 50 %
    w32(soc, TIM2 + CR1, 1)
    n = 0
    runFor(soc, 10e-3) // 1000 periods
    const edges = edgesOf(log, PA0).length
    expect(edges).toBeGreaterThanOrEqual(1999)
    expect(n).toBeLessThanOrEqual(2 * 1000 + 5)
  })
})

describe('TIM input capture, PWM input, encoder, external clock', () => {
  it('input capture latches CNT at the edge cycle; CC1OF on an unread capture; reading CCR1 clears CC1IF; ICPSC', () => {
    const { soc } = setup()
    cfgPin(soc, GPIOA, 0, 0x4)
    w32(soc, TIM2 + CCMR1, 1) // CC1S = TI1
    w32(soc, TIM2 + CCER, 1)
    const c0 = soc.clock.cycles
    w32(soc, TIM2 + CR1, 1)
    runToCycle(soc, c0 + 1000)
    soc.pins.setInput(PA0, 1, 3.3)
    expect(r32(soc, TIM2 + SR) & 2).toBe(2)
    expect(r32(soc, TIM2 + CCR1)).toBe(999) // before the increment that falls on the edge cycle
    expect(r32(soc, TIM2 + SR) & 2).toBe(0) // cleared by the CCR1 read
    runToCycle(soc, c0 + 1500)
    soc.pins.setInput(PA0, 0, 0) // falling: not the active edge
    expect(r32(soc, TIM2 + SR) & 2).toBe(0)
    runToCycle(soc, c0 + 3000)
    soc.pins.setInput(PA0, 1, 3.3)
    runToCycle(soc, c0 + 3100)
    soc.pins.setInput(PA0, 0, 0)
    runToCycle(soc, c0 + 3200)
    soc.pins.setInput(PA0, 1, 3.3) // second capture with CC1IF still set → overcapture
    expect(r32(soc, TIM2 + SR) & 0x202).toBe(0x202)
    expect(r32(soc, TIM2 + CCR1)).toBe(3199)
    // ICPSC = /4: one capture every 4 active edges
    w32(soc, TIM2 + SR, 0)
    w32(soc, TIM2 + CCER, 0)
    w32(soc, TIM2 + CCMR1, 1 | (2 << 2))
    w32(soc, TIM2 + CCER, 1)
    let caps = 0
    for (let i = 0; i < 8; i++) {
      runToCycle(soc, soc.clock.cycles + 50)
      soc.pins.setInput(PA0, 0, 0)
      runToCycle(soc, soc.clock.cycles + 50)
      soc.pins.setInput(PA0, 1, 3.3)
      if (r32(soc, TIM2 + SR) & 2) {
        caps++
        r32(soc, TIM2 + CCR1)
      }
    }
    expect(caps).toBe(2)
  })

  it('IC1F filter: an edge is accepted N sampling periods later, a shorter glitch is rejected', () => {
    const { soc } = setup()
    cfgPin(soc, GPIOA, 0, 0x4)
    w32(soc, TIM2 + CCMR1, 1 | (3 << 4)) // IC1F = 0011: f_CK_INT, N = 8
    w32(soc, TIM2 + CCER, 1)
    const c0 = soc.clock.cycles
    w32(soc, TIM2 + CR1, 1)
    runToCycle(soc, c0 + 100)
    soc.pins.setInput(PA0, 1, 3.3)
    runToCycle(soc, c0 + 105)
    soc.pins.setInput(PA0, 0, 0) // 5-cycle glitch
    runToCycle(soc, c0 + 200)
    expect(r32(soc, TIM2 + SR) & 2).toBe(0)
    soc.pins.setInput(PA0, 1, 3.3)
    runToCycle(soc, c0 + 207)
    expect(r32(soc, TIM2 + SR) & 2).toBe(0)
    runToCycle(soc, c0 + 208)
    expect(r32(soc, TIM2 + SR) & 2).toBe(2)
    expect(r32(soc, TIM2 + CCR1)).toBe(207)
  })

  it('PWM input mode (slave reset on TI1FP1): CCR1 = period − 1, CCR2 = high time − 1', () => {
    const { soc } = setup()
    cfgPin(soc, GPIOA, 0, 0x4)
    w32(soc, TIM2 + CCMR1, 1 | (2 << 8)) // IC1 ← TI1, IC2 ← TI1 (indirect)
    w32(soc, TIM2 + CCER, 1 | (1 << 4) | (1 << 5)) // CC1 rising, CC2 falling
    w32(soc, TIM2 + SMCR, (5 << 4) | 4) // TS = TI1FP1, SMS = reset
    const c0 = soc.clock.cycles
    w32(soc, TIM2 + CR1, 1)
    let t = c0 + 100
    for (let k = 0; k < 3; k++) {
      runToCycle(soc, t)
      soc.pins.setInput(PA0, 1, 3.3)
      runToCycle(soc, t + 300)
      soc.pins.setInput(PA0, 0, 0)
      t += 1000
    }
    runToCycle(soc, t)
    soc.pins.setInput(PA0, 1, 3.3)
    expect(r32(soc, TIM2 + CCR1)).toBe(999)
    expect(r32(soc, TIM2 + CCR2)).toBe(299)
    expect(r32(soc, TIM2 + SR) & 0x40).toBe(0x40) // TIF from the trigger
    runToCycle(soc, t + 10)
    expect(r32(soc, TIM2 + CNT)).toBe(10) // reset at the rising edge
  })

  it('encoder mode 3 counts ×4 up and down with DIR; mode 1 counts TI2 edges only', () => {
    const { soc } = setup()
    cfgPin(soc, GPIOB, 6, 0x4)
    cfgPin(soc, GPIOB, 7, 0x4)
    w32(soc, TIM4 + CCMR1, 1 | (1 << 8))
    w32(soc, TIM4 + CCER, 0x11)
    w32(soc, TIM4 + SMCR, 3)
    w32(soc, TIM4 + CR1, 1)
    let a = 0
    let b = 0
    const step = (pin: number, level: 0 | 1) => {
      runToCycle(soc, soc.clock.cycles + 100)
      soc.pins.setInput(pin, level, level * 3.3)
      if (pin === PB6) a = level
      else b = level
    }
    // A leads B: up
    const fwd = () => {
      step(PB6, 1)
      step(PB7, 1)
      step(PB6, 0)
      step(PB7, 0)
    }
    const back = () => {
      step(PB7, 1)
      step(PB6, 1)
      step(PB7, 0)
      step(PB6, 0)
    }
    fwd()
    fwd()
    expect(r32(soc, TIM4 + CNT)).toBe(8)
    expect(r32(soc, TIM4 + CR1) & 0x10).toBe(0)
    back()
    expect(r32(soc, TIM4 + CNT)).toBe(4)
    expect(r32(soc, TIM4 + CR1) & 0x10).toBe(0x10)
    back()
    back()
    expect(r32(soc, TIM4 + CNT)).toBe(0xfffc) // wraps through 0 to ARR
    w32(soc, TIM4 + CNT, 0)
    w32(soc, TIM4 + SMCR, 1) // encoder mode 1: TI2 edges only → ×2
    fwd()
    expect(r32(soc, TIM4 + CNT)).toBe(2)
    void a
    void b
  })

  it('external clock mode 2 counts ETR edges through ETPS; external clock mode 1 from TI2FP2', () => {
    const { soc } = setup()
    cfgPin(soc, GPIOA, 0, 0x4)
    cfgPin(soc, GPIOA, 1, 0x4)
    w32(soc, TIM2 + SMCR, (1 << 14) | (1 << 12)) // ECE, ETPS = /2
    w32(soc, TIM2 + CR1, 1)
    for (let i = 0; i < 10; i++) {
      runToCycle(soc, soc.clock.cycles + 20)
      soc.pins.setInput(PA0, 1, 3.3)
      runToCycle(soc, soc.clock.cycles + 20)
      soc.pins.setInput(PA0, 0, 0)
    }
    runFor(soc, 1e-4) // no internal counting
    expect(r32(soc, TIM2 + CNT)).toBe(5)
    w32(soc, TIM2 + SMCR, 0)
    w32(soc, TIM2 + CR1, 0)
    w32(soc, TIM2 + CNT, 0)
    w32(soc, TIM2 + CCMR1, 1 << 8) // CC2S = TI2
    w32(soc, TIM2 + SMCR, (6 << 4) | 7) // TS = TI2FP2, external clock mode 1
    w32(soc, TIM2 + CR1, 1)
    for (let i = 0; i < 7; i++) {
      runToCycle(soc, soc.clock.cycles + 20)
      soc.pins.setInput(1, 1, 3.3)
      runToCycle(soc, soc.clock.cycles + 20)
      soc.pins.setInput(1, 0, 0)
    }
    expect(r32(soc, TIM2 + CNT)).toBe(7)
  })
})

describe('TIM Hall-sensor interface (TI1S XOR, TI1F_ED, TRC capture)', () => {
  it('every change of CH1 ⊕ CH2 ⊕ CH3 captures the time since the previous one and resets the counter', () => {
    const { soc } = setup()
    for (const bit of [0, 1, 2]) cfgPin(soc, GPIOA, bit, 0x4)
    w32(soc, TIM2 + CR2, 1 << 7) // TI1S: TI1 = CH1 ⊕ CH2 ⊕ CH3
    w32(soc, TIM2 + CCMR1, 3) // CC1S = TRC
    w32(soc, TIM2 + CCER, 1)
    w32(soc, TIM2 + SMCR, (4 << 4) | 4) // TS = TI1F_ED, SMS = reset
    const c0 = soc.clock.cycles
    w32(soc, TIM2 + CR1, 1)
    const caps: number[] = []
    for (const [dt, pin, level] of [
      [100, 0, 1],
      [350, 1, 1],
      [700, 2, 1],
      [760, 0, 0],
    ] as const) {
      runToCycle(soc, c0 + dt)
      soc.pins.setInput(pin, level, level * 3.3)
      caps.push(r32(soc, TIM2 + CCR1))
    }
    expect(caps).toEqual([99, 249, 349, 59])
    expect(r32(soc, TIM2 + SR) & 0x40).toBe(0x40) // TIF from each TI1F_ED pulse
  })
})

describe('TIM master/slave (ITRx via TRGO)', () => {
  it('TIM1 COM event on TRGI (CCPC + CCUS, ITR1 = TIM2 update) applies the preloaded CCxE / OCxM at the exact update', () => {
    const { soc } = setup()
    cfgPin(soc, GPIOA, 8, 0xb)
    const log = recordPins(soc)
    w32(soc, TIM1 + CR2, 0b101) // CCPC, CCUS
    w32(soc, TIM1 + SMCR, 1 << 4) // TS = ITR1 (TIM2); no slave mode needed for COM
    w32(soc, TIM1 + CCMR1, 5 << 4) // preloaded: OC1 forced active
    w32(soc, TIM1 + CCER, 1) // preloaded: CC1E
    w32(soc, TIM1 + BDTR, 0x8000)
    expect(soc.pins.drive(PA8).level).toBe(0)
    w32(soc, TIM2 + ARR, 99)
    w32(soc, TIM2 + CR2, 2 << 4) // MMS = update
    const c0 = soc.clock.cycles
    w32(soc, TIM2 + CR1, 1)
    runToCycle(soc, c0 + 150)
    expect(edgesOf(log, PA8).filter((e) => e.cycle > c0).map((e) => [e.cycle - c0, e.level])).toEqual([[100, 1]])
    expect(r32(soc, TIM1 + SR) & 0x20).toBe(0x20) // COMIF
  })


  it('TIM2 in external clock mode 1 on ITR2 counts TIM3 update events (TIM3 as prescaler)', () => {
    const { soc } = setup()
    w32(soc, TIM3 + ARR, 9)
    w32(soc, TIM3 + CR2, 2 << 4) // MMS = update
    w32(soc, TIM2 + SMCR, (2 << 4) | 7) // TS = ITR2 (TIM3), SMS = external clock 1
    w32(soc, TIM2 + CR1, 1)
    const c0 = soc.clock.cycles
    w32(soc, TIM3 + CR1, 1)
    runToCycle(soc, c0 + 1005)
    expect(r32(soc, TIM2 + CNT)).toBe(100)
  })

  it('gated mode follows the master OC1REF level (TRGO rising and falling)', () => {
    const { soc } = setup()
    w32(soc, TIM3 + ARR, 99)
    w32(soc, TIM3 + CCR1, 25)
    w32(soc, TIM3 + CCMR1, 6 << 4)
    w32(soc, TIM3 + CR2, 4 << 4) // MMS = OC1REF
    w32(soc, TIM3 + EGR, 1)
    w32(soc, TIM2 + SMCR, (2 << 4) | 5) // gated by ITR2
    w32(soc, TIM2 + CR1, 1)
    w32(soc, TIM3 + CR1, 1)
    runFor(soc, 1e-3) // 8000 cycles = 80 periods, 25 % open
    const n = r32(soc, TIM2 + CNT)
    expect(Math.abs(n - 2000)).toBeLessThanOrEqual(25)
  })

  it('trigger mode starts the slave on the master enable (MMS = enable)', () => {
    const { soc } = setup()
    w32(soc, TIM4 + CR2, 1 << 4) // MMS = enable
    w32(soc, TIM3 + SMCR, (3 << 4) | 6) // TIM3: TS = ITR3 (TIM4), trigger mode
    runFor(soc, 1e-5)
    expect(r32(soc, TIM3 + CR1) & 1).toBe(0)
    w32(soc, TIM4 + CR1, 1)
    expect(r32(soc, TIM3 + CR1) & 1).toBe(1)
    expect(r32(soc, TIM3 + SR) & 0x40).toBe(0x40)
  })
})

describe('TIM1 advanced features', () => {
  function tim1Pwm(soc: Stm32f103, ccr: number, ccer: number, bdtr: number) {
    w32(soc, TIM1 + ARR, 99)
    w32(soc, TIM1 + CCR1, ccr)
    w32(soc, TIM1 + CCMR1, (6 << 4) | 8)
    w32(soc, TIM1 + EGR, 1)
    w32(soc, TIM1 + CCER, ccer)
    w32(soc, TIM1 + BDTR, bdtr)
  }

  it('outputs stay disabled until MOE; a hint is logged once when TIM1 runs with CCxE but MOE = 0', () => {
    const { soc } = setup()
    cfgPin(soc, GPIOA, 8, 0xb)
    const log = recordPins(soc)
    tim1Pwm(soc, 40, 1, 0)
    w32(soc, TIM1 + CR1, 1)
    runFor(soc, 2e-3)
    expect(edgesOf(log, PA8).filter((e) => e.level === 1)).toEqual([])
    const hint = soc.drainLog().filter((e) => e.source === 'TIM1')
    expect(hint.length).toBe(1)
    expect(hint[0].message).toMatch(/MOE = 0/)
    w32(soc, TIM1 + BDTR, 0x8000)
    runFor(soc, 1e-4)
    expect(edgesOf(log, PA8).filter((e) => e.level === 1).length).toBeGreaterThan(5)
  })

  it('complementary outputs with dead time (DTG = 10): rising edges delayed on PA8 and PB13', () => {
    const { soc } = setup()
    cfgPin(soc, GPIOA, 8, 0xb)
    cfgPin(soc, GPIOB, 13, 0xb)
    const log = recordPins(soc)
    tim1Pwm(soc, 40, 0b101, 0x8000 | 10)
    const c0 = soc.clock.cycles
    w32(soc, TIM1 + CR1, 1)
    runToCycle(soc, c0 + 250)
    const ev = (pin: number) => edgesOf(log, pin).filter((e) => e.cycle > c0).map((e) => [e.cycle - c0, e.level])
    expect(ev(PA8)).toEqual([
      [40, 0],
      [110, 1],
      [140, 0],
      [210, 1],
      [240, 0],
    ])
    expect(ev(PB13)).toEqual([
      [50, 1],
      [100, 0],
      [150, 1],
      [200, 0],
      [250, 1],
    ])
    // a pulse shorter than the dead time vanishes: CCR1 = 5 → OC1 never rises
    w32(soc, TIM1 + CCR1, 5)
    runToCycle(soc, c0 + 600)
    expect(ev(PA8).filter(([c]) => c > 400)).toEqual([])
  })

  it('repetition counter: UEV every RCR + 1 overflows (IRQ 25)', () => {
    const { soc, core } = setup()
    w32(soc, TIM1 + ARR, 99)
    w32(soc, TIM1 + RCR, 2)
    w32(soc, TIM1 + EGR, 1)
    w32(soc, TIM1 + SR, 0)
    w32(soc, TIM1 + DIER, 1)
    const c0 = soc.clock.cycles
    w32(soc, TIM1 + CR1, 1)
    for (const k of [1, 2, 3]) {
      runToCycle(soc, c0 + 300 * k)
      expect(core.irqLines[25], `${k}`).toBe(1)
      w32(soc, TIM1 + SR, 0)
      runToCycle(soc, c0 + 300 * k + 250)
      expect(core.irqLines[25]).toBe(0)
    }
    expect(core.irqLog.filter((e) => e.irq === 25 && e.on).map((e) => e.cycle - c0)).toEqual([300, 600, 900])
  })

  it('break input PB12 (active low): MOE cleared, BIF + IRQ 24, outputs to the OSSI idle level', () => {
    const { soc, core } = setup()
    cfgPin(soc, GPIOA, 8, 0xb)
    cfgPin(soc, GPIOB, 12, 0x8)
    w32(soc, GPIOB + 0x0c, 1 << 12) // pull-up
    w32(soc, TIM1 + CR2, 1 << 8) // OIS1 = 1
    tim1Pwm(soc, 40, 1, 0x8000 | (1 << 12) | (1 << 10)) // MOE, BKE, OSSI
    w32(soc, TIM1 + DIER, 1 << 7)
    w32(soc, TIM1 + CR1, 1)
    runFor(soc, 1e-5)
    soc.pins.setInput(PB12, 0, 0)
    expect(r32(soc, TIM1 + BDTR) & 0x8000).toBe(0)
    expect(r32(soc, TIM1 + SR) & 0x80).toBe(0x80)
    expect(core.irqLines[24]).toBe(1)
    runFor(soc, 1e-4)
    expect(soc.pins.drive(PA8).level).toBe(1) // OIS1
    // level-sensitive: MOE cannot be set and BIF not cleared while the break is active
    w32(soc, TIM1 + BDTR, r32(soc, TIM1 + BDTR) | 0x8000)
    w32(soc, TIM1 + SR, 0)
    expect(r32(soc, TIM1 + BDTR) & 0x8000).toBe(0)
    expect(r32(soc, TIM1 + SR) & 0x80).toBe(0x80)
    soc.pins.setInput(PB12, 1, 3.3)
    w32(soc, TIM1 + SR, 0)
    w32(soc, TIM1 + BDTR, r32(soc, TIM1 + BDTR) | 0x8000)
    expect(r32(soc, TIM1 + BDTR) & 0x8000).toBe(0x8000)
  })

  it('LOCK is write-once; level 1 freezes DTG', () => {
    const { soc } = setup()
    w32(soc, TIM1 + BDTR, (1 << 8) | 20)
    w32(soc, TIM1 + BDTR, (3 << 8) | 40)
    expect(r32(soc, TIM1 + BDTR)).toBe((1 << 8) | 20)
  })

  it('AOE sets MOE at the next update event; COM preload of CCxE (CCPC + COMG)', () => {
    const { soc } = setup()
    cfgPin(soc, GPIOA, 8, 0xb)
    tim1Pwm(soc, 40, 0, 1 << 14)
    w32(soc, TIM1 + CR2, 1) // CCPC
    w32(soc, TIM1 + CCER, 1) // preloaded: not in force yet
    w32(soc, TIM1 + CR1, 1)
    runFor(soc, 1e-4)
    expect(r32(soc, TIM1 + BDTR) & 0x8000).toBe(0x8000) // AOE
    expect(soc.pins.drive(PA8).level).toBe(0)
    w32(soc, TIM1 + EGR, 1 << 5) // COMG
    expect(r32(soc, TIM1 + SR) & 0x20).toBe(0x20)
    runFor(soc, 1e-4)
    expect(soc.drainLog().filter((e) => e.source === 'TIM1')).toEqual([])
  })
})

describe('TIM pins, remap and DMA burst', () => {
  it('TIM2 remap 2 moves CH3 to PB10; TIM4 remap onto port D is reported (not bonded)', () => {
    const { soc } = setup()
    cfgPin(soc, GPIOB, 10, 0xb)
    w32(soc, AFIO_MAPR, 2 << 8)
    w32(soc, TIM2 + CCMR2, 5 << 4) // OC3 force active
    w32(soc, TIM2 + CCER, 1 << 8)
    expect(soc.pins.drive(26).level).toBe(1)
    w32(soc, AFIO_MAPR, 1 << 12)
    w32(soc, TIM4 + CCMR1, 5 << 4)
    w32(soc, TIM4 + CCER, 1)
    expect(soc.drainLog().some((e) => e.source === 'TIM4' && /PD12.*not bonded/.test(e.message))).toBe(true)
  })

  it('update DMA (UDE → DMA1 channel 2) feeds CCR1 from a table: PWM widths follow it one period later', () => {
    const { soc } = setup()
    set32(soc, 0x40021014, 1) // RCC_AHBENR.DMA1EN
    cfgPin(soc, GPIOA, 0, 0xb)
    const log = recordPins(soc)
    const table = [10, 20, 30, 40]
    table.forEach((v, i) => w32(soc, 0x20001000 + 4 * i, v))
    const DMA1 = 0x40020000
    w32(soc, DMA1 + 0x24, TIM2 + CCR1) // CPAR2
    w32(soc, DMA1 + 0x28, 0x20001000) // CMAR2
    w32(soc, DMA1 + 0x20, table.length) // CNDTR2
    w32(soc, DMA1 + 0x1c, 0x10 | 0x20 | 0x80 | 0x200 | 0x800 | 1) // mem→periph, circular, MINC, 32-bit, EN
    w32(soc, TIM2 + ARR, 99)
    w32(soc, TIM2 + CCR1, 50)
    w32(soc, TIM2 + CCMR1, (6 << 4) | 8)
    w32(soc, TIM2 + EGR, 1)
    w32(soc, TIM2 + CCER, 1)
    w32(soc, TIM2 + DIER, 1 << 8) // UDE
    const c0 = soc.clock.cycles
    w32(soc, TIM2 + CR1, 1)
    runToCycle(soc, c0 + 100 * 10)
    const e = edgesOf(log, PA0).filter((x) => x.cycle > c0)
    const widths: number[] = []
    for (let i = 0; i + 1 < e.length; i++) if (e[i].level === 1 && e[i + 1].level === 0) widths.push(e[i + 1].cycle - e[i].cycle)
    // CCR1 = 50 for periods 1 and 2: the value DMA writes right after update n is loaded (preload) at update n + 1
    expect(widths.slice(0, 8)).toEqual([50, 10, 20, 30, 40, 10, 20, 30])
  })

  it('DMAR walks DBA … DBA + DBL', () => {
    const { soc } = setup()
    w32(soc, TIM3 + DCR, (2 << 8) | (CCR1 >> 2)) // 3 transfers from CCR1
    w32(soc, TIM3 + DMAR, 11)
    w32(soc, TIM3 + DMAR, 22)
    w32(soc, TIM3 + DMAR, 33)
    w32(soc, TIM3 + DMAR, 44)
    expect([r32(soc, TIM3 + CCR1), r32(soc, TIM3 + CCR2), r32(soc, TIM3 + 0x3c)]).toEqual([44, 22, 33])
  })
})

/**
 * A bare SocContext around one or two timers (8 MHz everywhere, k = 1): DMA
 * request lines, trigger signals and pin drives recorded with their cycles.
 */
function fakeSoc() {
  const clock = { cycles: 0 }
  const scheduler = new EventQueue()
  const dma: { ch: number; on: boolean; cycle: number }[] = []
  const irq: { irq: number; on: boolean; cycle: number }[] = []
  const af: { pin: number; level: 0 | 1 | 'z' | null; cycle: number }[] = []
  const trig: { signal: string; cycle: number }[] = []
  const subs = new Map<string, Set<(c: number) => void>>()
  const logs: string[] = []
  const hz = () => 8e6
  const ctx: SocContext = {
    clock,
    scheduler,
    clocks: { sysclk: hz, hclk: hz, pclk1: hz, pclk2: hz, timclk1: hz, timclk2: hz, adcclk: hz, lsi: () => 40e3, lse: () => 32768 },
    cyclesPerTick: (f) => 8e6 / f,
    timeOfCycle: (c) => c / 8e6,
    setIrq: (n, on) => irq.push({ irq: n, on, cycle: clock.cycles }),
    setAfOutput: (_o, pin, level, cycle) => af.push({ pin, level, cycle: cycle ?? clock.cycles }),
    pinLevel: () => 0,
    pinVoltage: () => NaN,
    onPinInput: () => () => {},
    pin: (name) => {
      const m = /^P([A-E])(\d+)$/.exec(name)
      return m ? 'ABCDE'.indexOf(m[1]) * 16 + Number(m[2]) : -1
    },
    remap: () => ({ spi1: false, i2c1: false, usart1: false, usart2: false, usart3: 0, tim1: 0, tim2: 0, tim3: 0, tim4: false, swj: 0 }),
    dmaRequest: (ch, on) => dma.push({ ch, on, cycle: clock.cycles }),
    emitTrigger: (signal, cycle) => {
      trig.push({ signal, cycle: cycle ?? clock.cycles })
      for (const cb of subs.get(signal) ?? []) cb(cycle ?? clock.cycles)
    },
    onTrigger: (signal, cb) => {
      let s = subs.get(signal)
      if (!s) subs.set(signal, (s = new Set()))
      s.add(cb)
      return () => s.delete(cb)
    },
    bus: undefined as never,
    log: (_l, src, msg) => logs.push(`${src}: ${msg}`),
    requestSync: () => {},
  }
  const mount = (t: Tim) => {
    t.attach(ctx)
    t.reset()
    t.clockEnabled(true)
    return {
      w: (off: number, v: number) => t.write(off, v, 4),
      r: (off: number) => t.read(off, 4),
    }
  }
  const runTo = (c: number) => {
    for (;;) {
      const n = scheduler.nextAt()
      if (n > c) break
      clock.cycles = Math.max(clock.cycles, n)
      scheduler.runDue(clock.cycles)
    }
    clock.cycles = c
  }
  return { ctx, clock, scheduler, dma, irq, af, trig, logs, mount, runTo }
}

describe('TIM DMA requests and trigger outputs (bare SocContext)', () => {
  it('UDE raises DMA1 channel 2 (TIM2_UP) at the update until acknowledged; CC1DE → channel 5; CCDS moves it to the update', () => {
    const f = fakeSoc()
    const t = new Tim(TIM2_CONFIG)
    const { w } = f.mount(t)
    w(ARR, 99)
    w(DIER, 1 << 8) // UDE
    w(CR1, 1)
    f.runTo(150)
    expect(f.dma).toEqual([{ ch: 2, on: true, cycle: 100 }])
    t.dmaAck(2)
    expect(f.dma[1]).toEqual({ ch: 2, on: false, cycle: 150 })
    f.runTo(200)
    expect(f.dma[2]).toEqual({ ch: 2, on: true, cycle: 200 })
    t.dmaAck(2)
    // CC1DE: request at the compare match (channel 5), or at the update with CCDS
    w(DIER, 1 << 9)
    w(CCR1, 30)
    f.dma.length = 0
    f.runTo(240)
    expect(f.dma).toEqual([{ ch: 5, on: true, cycle: 230 }])
    t.dmaAck(5)
    w(CR2, 1 << 3) // CCDS
    f.dma.length = 0
    f.runTo(330)
    expect(f.dma.filter((d) => d.on)).toEqual([{ ch: 5, on: true, cycle: 300 }])
    // clearing the DMA enable drops a pending request
    w(DIER, 0)
    expect(f.dma[f.dma.length - 1]).toEqual({ ch: 5, on: false, cycle: 330 })
  })

  it('TRGO per MMS and TIMn_CCx compare events are emitted at their exact cycles', () => {
    const f = fakeSoc()
    const t = new Tim(TIM1_CONFIG)
    const { w } = f.mount(t)
    w(ARR, 49)
    w(CCR1, 20)
    w(CCMR1, 6 << 4) // PWM1 on CH1 (no output enabled): its matches are still CC1 events
    w(CR2, 2 << 4) // MMS = update
    f.trig.length = 0
    w(CR1, 1)
    f.runTo(120)
    expect(f.trig.filter((x) => !x.signal.endsWith('_FALL'))).toEqual([
      { signal: 'TIM1_CC1', cycle: 20 },
      { signal: 'TIM1_TRGO', cycle: 50 },
      { signal: 'TIM1_CC1', cycle: 70 },
      { signal: 'TIM1_TRGO', cycle: 100 },
      { signal: 'TIM1_CC1', cycle: 120 },
    ])
    // MMS = OC1REF: TRGO follows the reference level (rise at the update, fall at the match)
    w(CR2, 4 << 4)
    f.trig.length = 0
    f.runTo(220)
    expect(f.trig.filter((x) => x.signal.startsWith('TIM1_TRGO'))).toEqual([
      { signal: 'TIM1_TRGO', cycle: 150 },
      { signal: 'TIM1_TRGO_FALL', cycle: 170 },
      { signal: 'TIM1_TRGO', cycle: 200 },
      { signal: 'TIM1_TRGO_FALL', cycle: 220 },
    ])
  })

  it('one-pulse mode in trigger mode: a trigger (ITR0 = TIM1_TRGO) starts one delayed pulse (PWM2 + OPM)', () => {
    const f = fakeSoc()
    const t = new Tim(TIM2_CONFIG)
    const { w, r } = f.mount(t)
    // CH1 PWM2: inactive until CNT reaches CCR1 (30-tick delay), active until the update (ARR 79)
    w(ARR, 79)
    w(CCR1, 30)
    w(CCMR1, 7 << 4)
    w(CCER, 1)
    w(SMCR, (0 << 4) | 6) // TS = ITR0 (TIM1), SMS = trigger mode
    w(CR1, 1 << 3) // OPM; CEN stays 0 until the trigger
    w(EGR, 1)
    f.af.length = 0
    f.runTo(1000)
    expect(r(CR1) & 1).toBe(0)
    f.ctx.emitTrigger!('TIM1_TRGO', 1000)
    expect(r(CR1) & 1).toBe(1) // started by the trigger
    expect(r(SR) & 0x40).toBe(0x40) // TIF
    f.runTo(1300)
    expect(r(CR1) & 1).toBe(0) // stopped by the update event
    expect(f.af.map((x) => [x.cycle, x.level])).toEqual([
      [1030, 1],
      [1080, 0],
    ])
  })
})

describe('TIM support table', () => {
  it('TIM1–4 are partial, verified only by firmware images that exist, notes state what is partial', async () => {
    const { existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { soc } = setup()
    const dist = join(__dirname, '..', '..', '..', 'firmware', 'dist')
    for (const n of ['TIM1', 'TIM2', 'TIM3', 'TIM4']) {
      const row = soc.support.find((s) => s.name === n)
      expect(row?.status, n).toBe('partial')
      expect(row?.verifiedBy?.length, n).toBeGreaterThan(0)
      for (const fw of row?.verifiedBy ?? []) expect(existsSync(join(dist, `${fw}.elf`)), `${n}: ${fw}.elf`).toBe(true)
      expect(row?.notes).toMatch(/Partial:/)
      expect(row?.notes).toMatch(/Firmware-verified/)
    }
    expect(soc.support.find((s) => s.name === 'TIM1')?.notes).toMatch(/MOE/)
  })
})
