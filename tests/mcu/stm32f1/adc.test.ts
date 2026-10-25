/**
 * ADC1/ADC2 (RM0008 ch. 11) driven through the system bus like firmware:
 * power-up and the second-ADON start quirk, RSTCAL/CAL timing, conversion
 * timing (trigger latency + SMPx + 12.5 ADCCLK) with the sample taken at the
 * end of the sampling window, scan order and EOC placement, continuous and
 * discontinuous modes, the injected group (JSQ order, offsets, sign
 * extension, interruption of a regular conversion, JAUTO), the analog
 * watchdog, the shared IRQ 18, internal channels, VDDA from the SoC, timer
 * triggers through the SoC trigger routing and the DMA request line.
 *
 * Clocks: HSI 8 MHz → PCLK2 = 8 MHz, ADCPRE /2 → ADCCLK = 4 MHz, i.e. one
 * ADCCLK = 2 core cycles (T below), unless a test switches to 72 MHz.
 */
import { describe, expect, it } from 'vitest'
import type { CreateCortexM3 } from '../../../src/mcu/core/cpu-api'
import type { SocBlock } from '../../../src/mcu/stm32f1/block'
import type { Dma1 } from '../../../src/mcu/stm32f1/dma'
import type { SocContext } from '../../../src/mcu/stm32f1/periph-api'
import { PERIPHERALS } from '../../../src/mcu/stm32f1/peripherals'
import { Stm32f103 } from '../../../src/mcu/stm32f1/soc'
import { clock72, GPIOA, makeSoc, r32, RCC_APB2ENR, RCC_CFGR, runToCycle, StubCore, w32 } from './helpers'

const ADC1 = 0x40012400
const ADC2 = 0x40012800
const SR = 0x00
const CR1 = 0x04
const CR2 = 0x08
const SMPR1 = 0x0c
const SMPR2 = 0x10
const JOFR1 = 0x14
const HTR = 0x24
const LTR = 0x28
const SQR1 = 0x2c
const SQR3 = 0x34
const JSQR = 0x38
const JDR1 = 0x3c
const DR = 0x4c

const AWD = 1
const EOC = 2
const JEOC = 4
const JSTRT = 8
const STRT = 16

const EOCIE = 1 << 5
const AWDIE = 1 << 6
const SCAN = 1 << 8
const AWDSGL = 1 << 9
const JAUTO = 1 << 10
const DISCEN = 1 << 11
const AWDEN = 1 << 23

const ADON = 1
const CONT = 2
const CAL = 4
const RSTCAL = 8
const DMA = 1 << 8
const ALIGN = 1 << 11
const JEXTSEL_SW = 7 << 12
const JEXTTRIG = 1 << 15
const EXTSEL_SW = 7 << 17
const EXTTRIG = 1 << 20
const JSWSTART = 1 << 21
const SWSTART = 1 << 22
const TSVREFE = 1 << 23

/** core cycles per ADCCLK at reset clocks (8 MHz / ADCPRE 2) */
const T = 2
const SMP = [1.5, 7.5, 13.5, 28.5, 41.5, 55.5, 71.5, 239.5]

const code = (v: number, vdda = 3.3) => Math.min(4095, Math.max(0, Math.round((v / vdda) * 4095)))

/** ADC1/ADC2 + GPIOA clocked, PA0–PA7 analog, pin voltages applied */
function setup(volts: Record<number, number> = {}) {
  const t = makeSoc()
  const { soc } = t
  w32(soc, RCC_APB2ENR, (1 << 2) | (1 << 9) | (1 << 10) | 1)
  w32(soc, GPIOA, 0) // PA0..PA7 analog (CNF = 00, MODE = 00)
  for (const [pin, v] of Object.entries(volts)) soc.pins.setInput(+pin, v > 1.6 ? 1 : 0, v)
  return t
}

/** ADON, then run past tSTAB (1 µs = 8 cycles at 8 MHz) */
function powerUp(soc: Stm32f103, base = ADC1, at = 100) {
  runToCycle(soc, at)
  w32(soc, base + CR2, r32(soc, base + CR2) | ADON)
  runToCycle(soc, at + 20)
}

const warnings = (soc: Stm32f103) => soc.drainLog().filter((e) => e.level !== 'info' && e.source.startsWith('ADC'))

describe('ADC power-up and calibration', () => {
  it('RSTCAL clears after 2 ADCCLK, CAL after tCAL = 83 ADCCLK, the calibration code (0) lands in DR', () => {
    const { soc } = setup()
    powerUp(soc)
    runToCycle(soc, 200)
    w32(soc, ADC1 + CR2, ADON | RSTCAL)
    expect(r32(soc, ADC1 + CR2) & RSTCAL).toBe(RSTCAL)
    runToCycle(soc, 200 + 2 * T - 1)
    expect(r32(soc, ADC1 + CR2) & RSTCAL).toBe(RSTCAL)
    // a read-modify-write with RSTCAL = 0 cannot clear it early
    w32(soc, ADC1 + CR2, ADON)
    expect(r32(soc, ADC1 + CR2) & RSTCAL).toBe(RSTCAL)
    runToCycle(soc, 200 + 2 * T)
    expect(r32(soc, ADC1 + CR2) & RSTCAL).toBe(0)
    runToCycle(soc, 300)
    w32(soc, ADC1 + CR2, ADON | CAL)
    runToCycle(soc, 300 + 83 * T - 1)
    expect(r32(soc, ADC1 + CR2) & CAL).toBe(CAL)
    runToCycle(soc, 300 + 83 * T)
    expect(r32(soc, ADC1 + CR2)).toBe(ADON)
    expect(r32(soc, ADC1 + DR)).toBe(0)
    expect(warnings(soc)).toEqual([])
  })

  it('CAL with ADON = 0 does nothing (reported); calibration right after power-up is reported', () => {
    const { soc } = setup()
    runToCycle(soc, 100)
    w32(soc, ADC1 + CR2, CAL)
    runToCycle(soc, 1000)
    expect(r32(soc, ADC1 + CR2) & CAL).toBe(CAL)
    expect(warnings(soc).some((e) => /CAL set while ADON = 0/.test(e.message))).toBe(true)
    w32(soc, ADC1 + CR2, 0)
    w32(soc, ADC1 + CR2, ADON)
    w32(soc, ADC1 + CR2, ADON | CAL) // same cycle as power-up: < 2 ADCCLK
    expect(warnings(soc).some((e) => /at least 2 ADCCLK/.test(e.message))).toBe(true)
    runToCycle(soc, 1000 + 83 * T)
    expect(r32(soc, ADC1 + CR2) & CAL).toBe(0)
  })

  it('ADON = 0 abandons a running calibration', () => {
    const { soc } = setup()
    powerUp(soc)
    w32(soc, ADC1 + CR2, ADON | CAL)
    runToCycle(soc, 200)
    w32(soc, ADC1 + CR2, 0)
    expect(r32(soc, ADC1 + CR2)).toBe(0)
    expect(warnings(soc).some((e) => /powered down \(ADON = 0\) during calibration/.test(e.message))).toBe(true)
  })
})

describe('ADC regular conversions', () => {
  it('the second ADON = 1 write starts a conversion; ADON together with another changed bit does not', () => {
    const { soc } = setup({ 0: 1.0 })
    runToCycle(soc, 100)
    w32(soc, ADC1 + CR2, ADON) // power-up only
    runToCycle(soc, 400)
    expect(r32(soc, ADC1 + SR)).toBe(0)
    w32(soc, ADC1 + CR2, ADON) // ADON again, nothing else changed → start
    expect(r32(soc, ADC1 + SR)).toBe(STRT)
    // latency 2 ADCCLK + (1.5 + 12.5) ADCCLK
    runToCycle(soc, 400 + 16 * T - 1)
    expect(r32(soc, ADC1 + SR) & EOC).toBe(0)
    runToCycle(soc, 400 + 16 * T)
    expect(r32(soc, ADC1 + SR) & EOC).toBe(EOC)
    expect(r32(soc, ADC1 + DR)).toBe(code(1.0))
    expect(r32(soc, ADC1 + SR) & EOC).toBe(0) // DR read clears EOC
    w32(soc, ADC1 + SR, 0)
    w32(soc, ADC1 + CR2, ADON | CONT) // CONT changes in the same write: no conversion
    runToCycle(soc, 1000)
    expect(r32(soc, ADC1 + SR)).toBe(0)
    expect(warnings(soc)).toEqual([])
  })

  it('conversion time = 2 ADCCLK latency + (SMPx + 12.5) ADCCLK for every SMP code (72 MHz, ADCCLK 12 MHz)', () => {
    const { soc } = setup({ 3: 2.5 })
    clock72(soc)
    w32(soc, RCC_CFGR, (r32(soc, RCC_CFGR) & ~(3 << 14)) | (2 << 14)) // ADCPRE = /6
    expect(soc.rcc.adcclk()).toBe(12e6)
    const T72 = 6
    let c = soc.clock.cycles + 100
    powerUp(soc, ADC1, c)
    w32(soc, ADC1 + SQR3, 3)
    w32(soc, ADC1 + CR2, ADON | EXTSEL_SW | EXTTRIG)
    for (let k = 0; k < 8; k++) {
      c = soc.clock.cycles + 50
      runToCycle(soc, c)
      w32(soc, ADC1 + SMPR2, k << 9) // SMP3
      w32(soc, ADC1 + CR2, ADON | EXTSEL_SW | EXTTRIG | SWSTART)
      expect(r32(soc, ADC1 + CR2) & SWSTART).toBe(0) // cleared as the conversion starts
      const end = c + (2 + SMP[k] + 12.5) * T72
      runToCycle(soc, end - 1)
      expect(r32(soc, ADC1 + SR) & EOC, `SMP ${k}`).toBe(0)
      runToCycle(soc, end)
      expect(r32(soc, ADC1 + SR) & EOC, `SMP ${k}`).toBe(EOC)
      expect(r32(soc, ADC1 + DR)).toBe(code(2.5))
    }
  })

  it('the input is sampled at the END of the sampling window', () => {
    const { soc } = setup({ 0: 1.0 })
    powerUp(soc)
    w32(soc, ADC1 + SMPR2, 7) // 239.5 cycles
    const run = (changeAt: number, v: number) => {
      soc.pins.setInput(0, 0, 1.0)
      const c = soc.clock.cycles + 10
      runToCycle(soc, c)
      w32(soc, ADC1 + CR2, ADON) // ADON start
      const sampleEnd = c + (2 + 239.5) * T
      runToCycle(soc, sampleEnd + changeAt)
      soc.pins.setInput(0, 0, v)
      runToCycle(soc, c + (2 + 252) * T)
      return r32(soc, ADC1 + DR)
    }
    expect(run(-1, 2.0)).toBe(code(2.0)) // changed just before the sample instant
    expect(run(+1, 2.0)).toBe(code(1.0)) // changed just after it: the held sample stays
  })

  it('scan mode converts SQ1..SQ(L+1) in order; EOC only after the last rank', () => {
    const { soc } = setup({ 3: 2.0, 0: 0.5 })
    w32(soc, ADC1 + CR2, TSVREFE)
    powerUp(soc)
    runToCycle(soc, 400) // TSVREFE start-up (10 µs = 80 cycles) long over
    w32(soc, ADC1 + SMPR2, (7 << 0) | (7 << 9))
    w32(soc, ADC1 + SMPR1, (7 << 18) | (7 << 21)) // SMP16, SMP17
    w32(soc, ADC1 + SQR3, 3 | (0 << 5) | (17 << 10) | (16 << 15))
    w32(soc, ADC1 + SQR1, 3 << 20) // L = 3: 4 conversions
    w32(soc, ADC1 + CR1, SCAN)
    const c = 500
    runToCycle(soc, c)
    w32(soc, ADC1 + CR2, ADON | TSVREFE)
    const want = [code(2.0), code(0.5), code(1.2), code(1.43)]
    const conv = 252 * T
    for (let k = 0; k < 4; k++) {
      runToCycle(soc, c + 2 * T + (k + 1) * conv)
      expect(r32(soc, ADC1 + SR) & EOC, `rank ${k + 1}`).toBe(k === 3 ? EOC : 0)
      expect(r32(soc, ADC1 + DR), `rank ${k + 1}`).toBe(want[k])
    }
    runToCycle(soc, c + 2 * T + 6 * conv)
    expect(r32(soc, ADC1 + SR) & EOC).toBe(0) // single scan: stopped
    expect(warnings(soc)).toEqual([])
  })

  it('continuous mode restarts the group with no gap; left alignment shifts by 4', () => {
    const { soc } = setup({ 1: 3.0 })
    powerUp(soc)
    w32(soc, ADC1 + SQR3, 1)
    const c = 200
    runToCycle(soc, c)
    w32(soc, ADC1 + CR2, ADON | CONT | ALIGN)
    w32(soc, ADC1 + CR2, ADON | CONT | ALIGN) // start
    for (let k = 1; k <= 5; k++) {
      runToCycle(soc, c + 2 * T + k * 14 * T)
      expect(r32(soc, ADC1 + SR) & EOC).toBe(EOC)
      expect(r32(soc, ADC1 + DR)).toBe((code(3.0) << 4) & 0xffff)
    }
    w32(soc, ADC1 + CR2, ADON | ALIGN) // CONT off: the running conversion is the last
    runToCycle(soc, c + 2 * T + 6 * 14 * T)
    r32(soc, ADC1 + DR)
    runToCycle(soc, c + 2 * T + 9 * 14 * T)
    expect(r32(soc, ADC1 + SR) & EOC).toBe(0)
  })

  it('discontinuous mode: DISCNUM + 1 ranks per trigger, EOC after each, no roll-over inside the sequence', () => {
    const volts = { 0: 0.1, 1: 0.2, 2: 0.3, 3: 0.4, 4: 0.5 }
    const { soc } = setup(volts)
    powerUp(soc)
    w32(soc, ADC1 + SQR3, 0 | (1 << 5) | (2 << 10) | (3 << 15) | (4 << 20))
    w32(soc, ADC1 + SQR1, 4 << 20) // 5 ranks
    w32(soc, ADC1 + CR1, SCAN | DISCEN | (1 << 13)) // 2 per trigger
    const bursts: number[][] = []
    for (let b = 0; b < 4; b++) {
      const c = soc.clock.cycles + 10
      runToCycle(soc, c)
      w32(soc, ADC1 + CR2, ADON | EXTSEL_SW | EXTTRIG | SWSTART)
      const got: number[] = []
      for (let k = 1; k <= 3; k++) {
        runToCycle(soc, c + 2 * T + k * 14 * T)
        if (r32(soc, ADC1 + SR) & EOC) got.push(r32(soc, ADC1 + DR))
      }
      w32(soc, ADC1 + CR2, ADON | EXTSEL_SW | EXTTRIG)
      bursts.push(got)
    }
    const v = (ch: number) => code(volts[ch as keyof typeof volts])
    expect(bursts).toEqual([[v(0), v(1)], [v(2), v(3)], [v(4)], [v(0), v(1)]])
  })

  it('writing SQR3 during a conversion restarts the group from rank 1', () => {
    const { soc } = setup({ 0: 1.0, 5: 2.0 })
    powerUp(soc)
    w32(soc, ADC1 + SQR3, 0)
    const c = 200
    runToCycle(soc, c)
    w32(soc, ADC1 + CR2, ADON)
    runToCycle(soc, c + 10)
    w32(soc, ADC1 + SQR3, 5)
    runToCycle(soc, c + 2 * T + 14 * T)
    expect(r32(soc, ADC1 + SR) & EOC).toBe(0)
    runToCycle(soc, c + 10 + 16 * T)
    expect(r32(soc, ADC1 + SR) & EOC).toBe(EOC)
    expect(r32(soc, ADC1 + DR)).toBe(code(2.0))
  })
})

describe('ADC injected group', () => {
  it('JL = 2 converts JSQ2, JSQ3, JSQ4 into JDR1..3 minus JOFR1..3 (sign-extended), then JEOC and EOC', () => {
    const { soc } = setup({ 0: 3.0, 1: 1.0, 2: 1.5, 3: 2.0 })
    powerUp(soc)
    w32(soc, ADC1 + JSQR, (2 << 20) | 0 | (1 << 5) | (2 << 10) | (3 << 15))
    w32(soc, ADC1 + JOFR1, 100)
    w32(soc, ADC1 + JOFR1 + 4, 3000)
    w32(soc, ADC1 + CR1, SCAN)
    const c = 200
    runToCycle(soc, c)
    w32(soc, ADC1 + CR2, ADON | JEXTSEL_SW | JEXTTRIG | JSWSTART)
    expect(r32(soc, ADC1 + CR2) & JSWSTART).toBe(0)
    expect(r32(soc, ADC1 + SR)).toBe(JSTRT)
    runToCycle(soc, c + 3 * T + 3 * 14 * T - 1)
    expect(r32(soc, ADC1 + SR) & JEOC).toBe(0)
    runToCycle(soc, c + 3 * T + 3 * 14 * T)
    expect(r32(soc, ADC1 + SR)).toBe(JSTRT | JEOC | EOC)
    expect(r32(soc, ADC1 + JDR1)).toBe(code(1.0) - 100)
    expect(r32(soc, ADC1 + JDR1 + 4)).toBe((code(1.5) - 3000) & 0xffff) // negative: SEXT bits set
    expect(r32(soc, ADC1 + JDR1 + 8)).toBe(code(2.0))
    // left alignment: SEXT D11..D0 000
    w32(soc, ADC1 + CR2, ADON | ALIGN | JEXTSEL_SW | JEXTTRIG | JSWSTART)
    runToCycle(soc, soc.clock.cycles + 3 * T + 3 * 14 * T)
    expect(r32(soc, ADC1 + JDR1 + 4)).toBe(((code(1.5) - 3000) << 3) & 0xffff)
    expect(r32(soc, ADC1 + JDR1)).toBe((code(1.0) - 100) << 3)
  })

  it('an injected trigger resets the running regular conversion; the sequence resumes at that rank', () => {
    const { soc } = setup({ 0: 0.5, 1: 1.0, 2: 1.5, 3: 2.5 })
    powerUp(soc)
    w32(soc, ADC1 + SMPR2, 7 | (7 << 3) | (7 << 6)) // ranks of 252 ADCCLK, ch3 1.5 cycles
    w32(soc, ADC1 + SQR3, 0 | (1 << 5) | (2 << 10))
    w32(soc, ADC1 + SQR1, 2 << 20)
    w32(soc, ADC1 + JSQR, 3 << 15) // JL = 0: JSQ4 = ch3
    w32(soc, ADC1 + CR1, SCAN)
    const c = 200
    runToCycle(soc, c)
    w32(soc, ADC1 + CR2, ADON | JEXTSEL_SW | JEXTTRIG)
    w32(soc, ADC1 + CR2, ADON | JEXTSEL_SW | JEXTTRIG) // regular start
    const conv = 252 * T
    const tj = c + 2 * T + conv + 200 // in the middle of rank 2
    runToCycle(soc, tj)
    expect(r32(soc, ADC1 + DR)).toBe(code(0.5))
    w32(soc, ADC1 + CR2, ADON | JEXTSEL_SW | JEXTTRIG | JSWSTART)
    const jend = tj + 3 * T + 14 * T
    runToCycle(soc, jend)
    expect(r32(soc, ADC1 + SR) & JEOC).toBe(JEOC)
    expect(r32(soc, ADC1 + JDR1)).toBe(code(2.5))
    // regular rank 2 is redone from the start after a 2-ADCCLK switch (ADCPRE /2), then rank 3
    const end = jend + 2 * T + 2 * conv
    w32(soc, ADC1 + SR, 0)
    runToCycle(soc, end - 1)
    expect(r32(soc, ADC1 + SR) & EOC).toBe(0)
    expect(r32(soc, ADC1 + DR)).toBe(code(1.0))
    runToCycle(soc, end)
    expect(r32(soc, ADC1 + SR) & EOC).toBe(EOC)
    expect(r32(soc, ADC1 + DR)).toBe(code(1.5))
  })

  it('JAUTO converts the injected group after the regular one; CONT repeats both', () => {
    const { soc } = setup({ 0: 0.7, 6: 2.2 })
    powerUp(soc)
    w32(soc, ADC1 + SQR3, 0)
    w32(soc, ADC1 + JSQR, 6 << 15)
    w32(soc, ADC1 + CR1, JAUTO)
    const c = 200
    runToCycle(soc, c)
    w32(soc, ADC1 + CR2, ADON | CONT)
    w32(soc, ADC1 + CR2, ADON | CONT)
    const reg = c + 2 * T + 14 * T
    const inj = reg + 2 * T + 14 * T
    runToCycle(soc, reg)
    expect(r32(soc, ADC1 + SR) & (EOC | JEOC)).toBe(EOC)
    runToCycle(soc, inj)
    expect(r32(soc, ADC1 + SR) & JEOC).toBe(JEOC)
    expect(r32(soc, ADC1 + JDR1)).toBe(code(2.2))
    w32(soc, ADC1 + SR, 0)
    runToCycle(soc, inj + 2 * T + 14 * T)
    expect(r32(soc, ADC1 + SR) & (EOC | JEOC)).toBe(EOC) // regular again
    expect(r32(soc, ADC1 + DR)).toBe(code(0.7))
  })
})

describe('ADC watchdog, interrupts, internal channels, supply', () => {
  it('analog watchdog on a single channel (AWDSGL) raises AWD and IRQ 18', () => {
    const { soc, core } = setup({ 0: 3.0, 1: 3.0 })
    powerUp(soc)
    w32(soc, ADC1 + HTR, 2000)
    w32(soc, ADC1 + LTR, 1000)
    w32(soc, ADC1 + CR1, AWDEN | AWDSGL | AWDIE | 1) // guard channel 1 only
    w32(soc, ADC1 + SQR3, 0)
    w32(soc, ADC1 + CR2, ADON)
    runToCycle(soc, soc.clock.cycles + 16 * T)
    expect(r32(soc, ADC1 + SR) & AWD).toBe(0)
    w32(soc, ADC1 + SQR3, 1)
    w32(soc, ADC1 + CR2, ADON)
    runToCycle(soc, soc.clock.cycles + 16 * T)
    expect(r32(soc, ADC1 + SR) & AWD).toBe(AWD)
    expect(core.irqLines[18]).toBe(1)
    w32(soc, ADC1 + SR, ~AWD)
    expect(core.irqLines[18]).toBe(0)
  })

  it('EOC interrupts of ADC1 and ADC2 share IRQ 18 (level OR)', () => {
    const { soc, core } = setup({ 0: 1.0 })
    powerUp(soc, ADC1, 100)
    powerUp(soc, ADC2, 200)
    w32(soc, ADC1 + CR1, EOCIE)
    w32(soc, ADC2 + CR1, EOCIE)
    w32(soc, ADC1 + CR2, ADON)
    w32(soc, ADC2 + CR2, ADON)
    runToCycle(soc, soc.clock.cycles + 16 * T)
    expect(core.irqLines[18]).toBe(1)
    expect(r32(soc, ADC2 + DR)).toBe(code(1.0))
    expect(core.irqLines[18]).toBe(1) // ADC1 still has EOC
    r32(soc, ADC1 + DR)
    expect(core.irqLines[18]).toBe(0)
  })

  it('temperature sensor follows the die temperature, VREFINT is 1.20 V; TSVREFE = 0 and ADC2 IN16 read 0', () => {
    const { soc } = setup()
    w32(soc, ADC1 + SMPR1, (7 << 18) | (7 << 21))
    w32(soc, ADC2 + SMPR1, 7 << 18)
    w32(soc, ADC1 + CR2, TSVREFE)
    powerUp(soc, ADC1, 100)
    powerUp(soc, ADC2, 200)
    runToCycle(soc, 400)
    const convert = (base: number, ch: number) => {
      w32(soc, base + SQR3, ch)
      w32(soc, base + CR2, r32(soc, base + CR2) | ADON)
      runToCycle(soc, soc.clock.cycles + (2 + 252) * T)
      return r32(soc, base + DR)
    }
    expect(convert(ADC1, 16)).toBe(code(1.43))
    expect(convert(ADC1, 17)).toBe(code(1.2))
    soc.setDieTemperature(85)
    expect(convert(ADC1, 16)).toBe(code(1.43 - 60 * 0.0043))
    soc.setDieTemperature(-20)
    expect(convert(ADC1, 16)).toBe(code(1.43 + 45 * 0.0043))
    expect(convert(ADC2, 16)).toBe(0)
    expect(warnings(soc)).toEqual([])
    w32(soc, ADC1 + CR2, ADON) // TSVREFE off
    expect(convert(ADC1, 17)).toBe(0)
    expect(warnings(soc).some((e) => /TSVREFE = 0/.test(e.message))).toBe(true)
  })

  it('a short temperature-sensor sampling time and an unsettled sensor are reported', () => {
    const { soc } = setup()
    powerUp(soc)
    w32(soc, ADC1 + SQR3, 16)
    w32(soc, ADC1 + CR2, ADON | TSVREFE) // TSVREFE changes: no start
    w32(soc, ADC1 + CR2, ADON | TSVREFE) // start immediately: tSTART not met, 1.5 cycles < 17.1 µs
    runToCycle(soc, soc.clock.cycles + 16 * T)
    const w = warnings(soc).map((e) => e.message)
    expect(w.some((m) => /tSTART/.test(m))).toBe(true)
    expect(w.some((m) => /require 17\.1 µs/.test(m))).toBe(true)
  })

  it('VDDA is the supply reported to the SoC', () => {
    const { soc } = setup({ 0: 1.5 })
    soc.setSupplyVoltage(3.0)
    powerUp(soc)
    w32(soc, ADC1 + CR2, ADON)
    runToCycle(soc, soc.clock.cycles + 16 * T)
    expect(r32(soc, ADC1 + DR)).toBe(code(1.5, 3.0))
    soc.setSupplyVoltage(3.6)
    w32(soc, ADC1 + CR2, ADON)
    runToCycle(soc, soc.clock.cycles + 16 * T)
    expect(r32(soc, ADC1 + DR)).toBe(code(1.5, 3.6))
  })

  it('pin checks: a non-analog pin still converts (reported), IN10 is not bonded, an undriven pin is reported', () => {
    const { soc } = setup({ 0: 2.0 })
    w32(soc, GPIOA, 0x44444444) // PA0 floating input
    powerUp(soc)
    w32(soc, ADC1 + CR2, ADON)
    runToCycle(soc, soc.clock.cycles + 16 * T)
    expect(r32(soc, ADC1 + DR)).toBe(code(2.0))
    let w = warnings(soc).map((e) => e.message)
    expect(w.some((m) => /PA0 is not in analog mode/.test(m))).toBe(true)
    for (const [ch, re] of [[10, /PC0, which is not bonded/], [5, /PA5\): the pin voltage is unknown/]] as const) {
      w32(soc, ADC1 + SQR3, ch)
      w32(soc, ADC1 + CR2, ADON)
      runToCycle(soc, soc.clock.cycles + 16 * T)
      expect(r32(soc, ADC1 + DR)).toBe(0)
      w = warnings(soc).map((e) => e.message)
      expect(w.some((m) => re.test(m)), String(re)).toBe(true)
    }
  })

  it('conversions before tSTAB and with ADCCLK above 14 MHz are reported', () => {
    const { soc } = setup({ 0: 1.0 })
    clock72(soc) // ADCPRE /2 → 36 MHz
    w32(soc, ADC1 + CR2, ADON)
    w32(soc, ADC1 + CR2, ADON) // 0 µs after power-up
    runToCycle(soc, soc.clock.cycles + 200)
    const w = warnings(soc).map((e) => e.message)
    expect(w.some((m) => /before|tSTAB/.test(m) && /1 µs/.test(m))).toBe(true)
    expect(w.some((m) => /ADCCLK = 36\.000 MHz, outside 0\.6–14 MHz/.test(m))).toBe(true)
  })
})

describe('ADC triggers and DMA request', () => {
  /** SoC whose TIM2 slot holds a probe block that can emit internal triggers */
  function socWithTrigger() {
    let ctx: SocContext | null = null
    let core: StubCore | null = null
    const probe: SocBlock = { name: 'TRIG', read: () => 0, write: () => {}, reset: () => {}, attach: (c) => (ctx = c) }
    const specs = PERIPHERALS.filter((p) => p.name !== 'TIM2')
    specs.push({ name: 'TRIG', base: 0x40000000, gate: null, make: () => probe, status: 'unsupported', notes: '' })
    const createCore: CreateCortexM3 = (bus, sched, clock, hooks, config) => (core = new StubCore(bus, sched, clock, hooks, config))
    const soc = new Stm32f103({ createCore, peripherals: specs })
    w32(soc, RCC_APB2ENR, (1 << 2) | (1 << 9) | 1)
    w32(soc, GPIOA, 0)
    return { soc, core: core as unknown as StubCore, emit: (s: string, c?: number) => (ctx as unknown as SocContext).emitTrigger?.(s, c) }
  }

  it('EXTSEL = TIM3_TRGO: an emitted trigger starts a conversion 2 ADCCLK + 1 PCLK2 cycle later; EXTTRIG = 0 ignores it', () => {
    const { soc, emit } = socWithTrigger()
    soc.pins.setInput(0, 0, 0.8)
    powerUp(soc)
    w32(soc, ADC1 + CR2, ADON | (4 << 17) | EXTTRIG)
    const c = 300
    runToCycle(soc, c)
    emit('TIM3_TRGO', c)
    expect(r32(soc, ADC1 + SR) & STRT).toBe(STRT)
    const end = c + 2 * T + 1 + 14 * T
    runToCycle(soc, end - 1)
    expect(r32(soc, ADC1 + SR) & EOC).toBe(0)
    runToCycle(soc, end)
    expect(r32(soc, ADC1 + DR)).toBe(code(0.8))
    w32(soc, ADC1 + SR, 0)
    emit('TIM2_CC2') // not selected
    w32(soc, ADC1 + CR2, ADON | (4 << 17)) // EXTTRIG off
    emit('TIM3_TRGO')
    runToCycle(soc, soc.clock.cycles + 100)
    expect(r32(soc, ADC1 + SR)).toBe(0)
  })

  it('JEXTSEL = TIM2_TRGO starts the injected group; EXTI line 11 is reported as not routed', () => {
    const { soc, emit } = socWithTrigger()
    soc.pins.setInput(2, 0, 2.2)
    powerUp(soc)
    w32(soc, ADC1 + JSQR, 2 << 15)
    w32(soc, ADC1 + CR2, ADON | (2 << 12) | JEXTTRIG)
    const c = 300
    runToCycle(soc, c)
    emit('TIM2_TRGO', c)
    runToCycle(soc, c + 3 * T + 1 + 14 * T)
    expect(r32(soc, ADC1 + SR) & JEOC).toBe(JEOC)
    expect(r32(soc, ADC1 + JDR1)).toBe(code(2.2))
    w32(soc, ADC1 + CR2, ADON | (6 << 17) | EXTTRIG)
    expect(warnings(soc).some((e) => /EXTI line 11/.test(e.message))).toBe(true)
  })

  it('CR2.DMA raises the DMA1 channel 1 request at every regular result until DR is read; ADC2 has none', () => {
    const { soc } = setup({ 0: 1.0 })
    const dma = soc.block('DMA1') as unknown as Dma1
    powerUp(soc)
    w32(soc, ADC1 + CR2, ADON | DMA)
    expect(dma.requestLine(1)).toBe(false)
    w32(soc, ADC1 + CR2, ADON | DMA)
    runToCycle(soc, soc.clock.cycles + 16 * T)
    expect(dma.requestLine(1)).toBe(true)
    r32(soc, ADC1 + DR)
    expect(dma.requestLine(1)).toBe(false)
    w32(soc, ADC1 + CR2, ADON | DMA)
    runToCycle(soc, soc.clock.cycles + 16 * T)
    expect(dma.requestLine(1)).toBe(true)
    w32(soc, ADC1 + CR2, ADON) // DMA bit cleared drops the request
    expect(dma.requestLine(1)).toBe(false)
    powerUp(soc, ADC2, soc.clock.cycles + 10)
    w32(soc, ADC2 + CR2, ADON | DMA)
    expect(warnings(soc).some((e) => /only ADC1 generates DMA requests/.test(e.message))).toBe(true)
  })

  it('RCC ADC1RST resets the registers; a gated clock abandons the conversion', () => {
    const { soc } = setup({ 0: 1.0 })
    powerUp(soc)
    w32(soc, ADC1 + SMPR2, 7)
    w32(soc, ADC1 + CR2, ADON)
    runToCycle(soc, soc.clock.cycles + 20)
    w32(soc, RCC_APB2ENR, (1 << 2) | 1) // ADC1 clock off
    expect(warnings(soc).some((e) => /clock disabled .* during a conversion/.test(e.message))).toBe(true)
    w32(soc, RCC_APB2ENR, (1 << 2) | (1 << 9) | 1)
    runToCycle(soc, soc.clock.cycles + 600)
    expect(r32(soc, ADC1 + SR) & EOC).toBe(0)
    w32(soc, 0x4002100c, 1 << 9) // RCC_APB2RSTR.ADC1RST
    w32(soc, 0x4002100c, 0)
    expect(r32(soc, ADC1 + CR2)).toBe(0)
    expect(r32(soc, ADC1 + HTR)).toBe(0xfff)
  })
})
