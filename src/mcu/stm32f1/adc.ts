/**
 * ADC1 / ADC2 — the 12-bit successive-approximation converters of RM0008
 * ch. 11 (registers §11.12). Analog and timing figures: DS5319 §5.3.18
 * Table 46 (ADC characteristics), Table 50 (temperature sensor) and Table 12
 * (embedded reference voltage).
 *
 * Power and calibration (§11.3.1, §11.4):
 *   - the first ADON = 1 write powers the converter up; it is usable after
 *     tSTAB = 1 µs (Table 46). A conversion started earlier still runs but is
 *     reported (silicon results are not guaranteed).
 *   - writing ADON = 1 AGAIN while ADON is already 1 starts a regular
 *     conversion — unless any other CR2 bit changes in the same write
 *     (§11.12.3, ADON note). ADON = 0 powers down: a running conversion or
 *     calibration is abandoned.
 *   - RSTCAL clears itself after RSTCAL_ADCCLK ADC clock cycles (ST gives no
 *     figure), CAL after tCAL = 83 ADCCLK (Table 46: 5.9 µs at 14 MHz). The
 *     calibration code then sits in DR; the simulated converter has no
 *     capacitor mismatch, so the code is 0 and conversions are exact with or
 *     without calibration (an uncalibrated conversion is reported once).
 *
 * Conversion (§11.3.4–§11.3.10, §11.6):
 *   - each conversion takes (SMPx + 12.5) ADCCLK cycles, ADCCLK =
 *     PCLK2 / ADCPRE (`clocks.adcclk()`; > 14 MHz or < 0.6 MHz is reported,
 *     Table 46). A group starts tlatr = 2 (regular) / tlat = 3 (injected)
 *     ADCCLK after its trigger, plus one PCLK2 cycle for timer / EXTI
 *     triggers (Table 46 and its footnote). The ADCCLK phase relative to the
 *     trigger is not modelled (starts are not snapped to ADCCLK edges).
 *   - the input is sampled at the END of the sampling window from
 *     SocContext.pinVoltage (the coordinator refreshes it after every analog
 *     step): code = clamp(round(Vin / VDDA × 4095), 0, 4095). VDDA is the MCU
 *     supply as reported to the SoC (Stm32f103.setSupplyVoltage, default
 *     3.3 V); on the LQFP48 VREF+/VREF− are bonded to VDDA/VSSA inside the
 *     package. The sample-and-hold charge sharing with the source impedance
 *     (RAIN / CADC, Table 46 eq. 1) is not modelled: the pin voltage is
 *     converted as if the source were ideal.
 *   - channels: IN0–IN7 = PA0–PA7, IN8/IN9 = PB0/PB1 (DS5319 Table 5);
 *     IN10–IN15 = PC0–PC5 are not bonded on the LQFP48 (reported, read 0);
 *     ADC1 IN16 = temperature sensor, V_SENSE = V25 − (T − 25 °C) ×
 *     Avg_Slope with the Table 50 typical values (1.43 V, 4.3 mV/°C) at the
 *     die temperature (Stm32f103.setDieTemperature, default 25 °C); ADC1
 *     IN17 = VREFINT 1.20 V (Table 12 typ). Both need CR2.TSVREFE (§11.10);
 *     their start-up time (tSTART ≤ 10 µs) and the 17.1 µs minimum sampling
 *     time of the sensor are checked and reported, the simulated outputs are
 *     ideal. ADC2 IN16/IN17 are VSS (§11.12.4 note).
 *   - a channel pin that is not in analog mode still converts its voltage,
 *     like silicon, but is reported once (RM0008 §9.1.11 wants analog mode
 *     for ADC inputs). The pin mode is read from GPIOx_CRL/CRH through the
 *     bus (diagnostic only; skipped while the GPIO port clock is off).
 *   - regular group (SQR1–3, L): single, continuous (CONT), scan (SCAN: all
 *     L + 1 ranks, else rank 1 only), discontinuous (DISCEN: DISCNUM + 1
 *     ranks per trigger, no roll-over inside the sequence). EOC is set after
 *     the LAST rank in scan mode (CR1.SCAN note; HAL relies on it), after
 *     every conversion otherwise and in discontinuous mode (§11.3.10
 *     example). Every regular result updates DR (ALIGN right / left) and,
 *     with CR2.DMA (ADC1 only, §11.8), raises the DMA1 channel 1 request
 *     until DR is read (by the DMA or the CPU).
 *   - injected group (JSQR, JL): converted in the order JSQ(4−JL)…JSQ4
 *     (§11.12.12), the k-th conversion goes to JDRk minus JOFRk, sign
 *     extended (Figures 27/28). A trigger during a regular conversion resets
 *     it; the regular sequence resumes at the interrupted rank after the
 *     injected group (§11.3.9). JAUTO converts the injected group after the
 *     regular sequence (with a 1 ADCCLK switch delay, 2 at ADCPRE = /2);
 *     JDISCEN converts one injected channel per trigger. At the end of the
 *     injected group JEOC AND EOC are set (§11.12.1 EOC, §11.3.10 example).
 *   - triggers (CR2 EXTSEL/EXTTRIG, JEXTSEL/JEXTTRIG, §11.7 Tables 67/68):
 *     SWSTART / JSWSTART (EXTSEL / JEXTSEL = 111) and the timer events through
 *     SocContext.onTrigger ('TIM1_CC1', 'TIM3_TRGO', …: the rising edge = one
 *     emitted event). The EXTI line 11 / 15 triggers are not routed (logged).
 *   - analog watchdog (§11.3.7, Table 66): AWDEN / JAWDEN / AWDSGL / AWDCH
 *     against HTR / LTR on the raw 12-bit result (before alignment / offset).
 *   - SR flags AWD, EOC, JEOC, JSTRT, STRT (rc_w0; reading DR clears EOC),
 *     interrupt EOC·EOCIE | JEOC·JEOCIE | AWD·AWDIE on IRQ 18, shared with
 *     the other ADC (the SoC ORs the two lines).
 *   - writing SQR1–3 / JSQR during a conversion of that group restarts the
 *     group from its first rank (§11.3.3).
 *
 * Not simulated (reported): the dual modes (ADC1 CR1.DUALMOD ≠ 0 — both ADCs
 * keep converting independently; ADC1 DR[31:16] stays 0), the EXTI 11/15
 * triggers, ADC2 DMA (silicon has none outside dual mode). A clock-gated or
 * reset ADC abandons its conversion / calibration.
 */
import type { EventHandle } from '../core/types'
import type { RccGate, SocContext, Stm32Peripheral } from './periph-api'
import { APB2, merge, RegisterBlock } from './block'

// SR
const AWD = 1 << 0
const EOC = 1 << 1
const JEOC = 1 << 2
const JSTRT = 1 << 3
const STRT = 1 << 4
// CR1
const AWDCH = 0x1f
const EOCIE = 1 << 5
const AWDIE = 1 << 6
const JEOCIE = 1 << 7
const SCAN = 1 << 8
const AWDSGL = 1 << 9
const JAUTO = 1 << 10
const DISCEN = 1 << 11
const JDISCEN = 1 << 12
const DUALMOD = 0xf << 16
const JAWDEN = 1 << 22
const AWDEN = 1 << 23
// CR2
const ADON = 1 << 0
const CONT = 1 << 1
const CAL = 1 << 2
const RSTCAL = 1 << 3
const DMA = 1 << 8
const ALIGN = 1 << 11
const JEXTSEL = 7 << 12
const JEXTTRIG = 1 << 15
const EXTSEL = 7 << 17
const EXTTRIG = 1 << 20
const JSWSTART = 1 << 21
const SWSTART = 1 << 22
const TSVREFE = 1 << 23

/** ADC1_2 global interrupt (RM0008 Table 63) */
export const ADC_IRQ = 18
/** SMP[2:0] → sampling time in ADCCLK cycles (§11.12.4) */
export const SMP_CYCLES = [1.5, 7.5, 13.5, 28.5, 41.5, 55.5, 71.5, 239.5] as const
/** successive-approximation part of a conversion (§11.6) */
export const SAR_CYCLES = 12.5
/** tSTAB, ADC power-up time (DS5319 Table 46, max) */
export const T_STAB_S = 1e-6
/** tCAL in ADCCLK cycles (DS5319 Table 46: 5.9 µs at 14 MHz = 83 / fADC) */
export const T_CAL_ADCCLK = 83
/** RSTCAL duration — ST specifies none; any positive value satisfies HAL's polling */
export const T_RSTCAL_ADCCLK = 2
/** regular / injected trigger conversion latency (DS5319 Table 46: tlatr, tlat) */
export const T_LAT_REG_ADCCLK = 2
export const T_LAT_INJ_ADCCLK = 3
/** temperature sensor (DS5319 Table 50, typical) */
export const V25 = 1.43
export const AVG_SLOPE = 4.3e-3
/** sensor start-up time after TSVREFE (Table 50 tSTART max) */
export const T_START_TS_S = 10e-6
/** recommended sampling time of the temperature sensor (RM0008 §11.10) */
export const TS_TEMP_S = 17.1e-6
/** embedded reference voltage (DS5319 Table 12, typical) */
export const VREFINT = 1.2
/** ADCCLK limits (DS5319 Table 46 fADC) */
const ADCCLK_MAX = 14e6
const ADCCLK_MIN = 0.6e6
/** VDDA operating range for the ADC (DS5319 Table 46 VDDA) */
const VDDA_MIN = 2.4
/** calibration code left in DR: the model has no capacitor mismatch */
const CAL_CODE = 0

/** Regular / injected external trigger sources (RM0008 Tables 67 / 68). */
export const REG_TRIGGERS = ['TIM1_CC1', 'TIM1_CC2', 'TIM1_CC3', 'TIM2_CC2', 'TIM3_TRGO', 'TIM4_CC4', 'EXTI11', 'SWSTART'] as const
export const INJ_TRIGGERS = ['TIM1_TRGO', 'TIM1_CC4', 'TIM2_TRGO', 'TIM2_CC1', 'TIM3_CC4', 'TIM4_TRGO', 'EXTI15', 'JSWSTART'] as const

export interface AdcConfig {
  name: 'ADC1' | 'ADC2'
  base: number
  gate: RccGate
  /** ADC1: temperature sensor / VREFINT on IN16/IN17, CR2.TSVREFE, CR1.DUALMOD (§11.9, §11.10) */
  master: boolean
  /** DMA1 channel of the regular-data request (Table 78); null: no DMA capability (§11.8) */
  dma: number | null
}

export const ADC1_CONFIG: AdcConfig = { name: 'ADC1', base: 0x40012400, gate: APB2(9), master: true, dma: 1 }
export const ADC2_CONFIG: AdcConfig = { name: 'ADC2', base: 0x40012800, gate: APB2(10), master: false, dma: null }

export const ADC_NOTES =
  'Independent mode: ADON power-up (tSTAB 1 µs) and the second-ADON-write start quirk, RSTCAL/CAL with timed self-clearing (tCAL 83 ADCCLK), (SMPx + 12.5) ADCCLK conversions with trigger latency, sampling of the pin voltage at the end of the sampling window, code = Vin/VDDA × 4095 (VDDA = MCU supply), IN0–IN9 on PA0–PA7/PB0–PB1, temperature sensor (V25 1.43 V, 4.3 mV/°C, settable die temperature) and VREFINT 1.20 V on ADC1 IN16/IN17, single / continuous / scan / discontinuous regular groups, injected groups (triggered, JAUTO, JDISCEN, JOFRx offsets, sign extension), left/right alignment, analog watchdog, EOC/JEOC/AWD interrupts on IRQ 18, SWSTART/JSWSTART and timer triggers (TRGO/CCx via the SoC trigger routing), ADC1 DMA requests. Real HAL firmware exercises calibration, single and continuous scan conversions, software start, DMA and the internal channels (hal-adc-pot, hal-adc-dma); the injected group, discontinuous mode, the analog watchdog and timer triggers are unit-tested only. Not simulated (logged): dual modes (DUALMOD), EXTI line 11/15 triggers, sample-and-hold source-impedance error; IN10–IN15 are not bonded on the LQFP48.'

type Group = 'reg' | 'inj'

interface Conversion {
  group: Group
  ch: number
  raw: number
}

/** GPIO pin (port*16 + bit) of an external ADC channel, -1 for internal / reserved ones. */
export function adcChannelPin(ch: number): number {
  if (ch < 8) return ch // PA0..PA7
  if (ch < 10) return 16 + ch - 8 // PB0, PB1
  if (ch < 16) return 32 + ch - 10 // PC0..PC5
  return -1
}

const PORT = ['A', 'B', 'C', 'D', 'E']
const pinName = (pin: number) => `P${PORT[pin >> 4]}${pin & 15}`
const RCC_APB2ENR = 0x40021018
const GPIO_BASE = 0x40010800

export class Adc extends RegisterBlock implements Stm32Peripheral {
  readonly name: string
  readonly base: number
  readonly size = 0x400
  readonly gate: RccGate

  private ctx!: SocContext
  // registers
  private sr = 0
  private cr1 = 0
  private cr2 = 0
  private smpr1 = 0
  private smpr2 = 0
  private readonly jofr = [0, 0, 0, 0]
  private htr = 0xfff
  private ltr = 0
  private sqr1 = 0
  private sqr2 = 0
  private sqr3 = 0
  private jsqr = 0
  private readonly jdr = [0, 0, 0, 0]
  private dr = 0
  // analog environment (not registers: survive resets)
  private vdda = 3.3
  private dieC = 25
  // converter state
  private clocked = false
  private powered = false
  private powerOnAt = 0
  private stabReported = false
  private calibrated = false
  private calRunning: 0 | typeof CAL | typeof RSTCAL = 0
  private calEv: EventHandle = 0
  private tsOnAt = -Infinity
  private conv: Conversion | null = null
  private convEv: EventHandle = 0
  private regRunning = false
  private regPos = 0
  private discLeft = 0
  /** a regular trigger arrived during an injected group: start the regular group afterwards */
  private regPending = false
  /** a regular conversion was reset by an injected trigger: resume at regPos afterwards */
  private regResume = false
  private injRunning = false
  private injPos = 0
  /** the injected group runs because of JAUTO (after a regular sequence) */
  private injAuto = false
  /** DR holds a regular result the DMA has not read yet (CR2.DMA) */
  private dmaPending = false
  // outputs
  private irqOn = false
  private dmaOn = false
  // trigger subscriptions
  private regSig: string | null = null
  private injSig: string | null = null
  private regUnsub: (() => void) | null = null
  private injUnsub: (() => void) | null = null
  private readonly reported = new Set<string>()

  constructor(private cfg: AdcConfig) {
    super()
    this.name = cfg.name
    this.base = cfg.base
    this.gate = cfg.gate
  }

  attach(ctx: SocContext): void {
    this.ctx = ctx
  }

  // ------------------------------------------------------------ environment

  /** Analog supply VDDA = VREF+ (V). Set by the SoC from the board supply. */
  setVdda(v: number): void {
    if (!(Number.isFinite(v) && v > 0)) return
    this.vdda = v
    if (v < VDDA_MIN) this.report('vdda', 'warning', `VDDA = ${v.toFixed(2)} V is below the ADC operating range (2.4 V, DS5319 Table 46): silicon conversions are not specified`)
  }

  /** Die temperature (°C) seen by the temperature sensor on ADC1 IN16. */
  setDieTemperature(c: number): void {
    if (Number.isFinite(c)) this.dieC = c
  }

  get supplyVolts(): number {
    return this.vdda
  }

  get dieTemperature(): number {
    return this.dieC
  }

  // ------------------------------------------------------------ bus

  read32(off: number): number {
    switch (off) {
      case 0x00:
        return this.sr
      case 0x04:
        return this.cr1
      case 0x08:
        return this.cr2
      case 0x0c:
        return this.smpr1
      case 0x10:
        return this.smpr2
      case 0x14:
      case 0x18:
      case 0x1c:
      case 0x20:
        return this.jofr[(off - 0x14) >> 2]
      case 0x24:
        return this.htr
      case 0x28:
        return this.ltr
      case 0x2c:
        return this.sqr1
      case 0x30:
        return this.sqr2
      case 0x34:
        return this.sqr3
      case 0x38:
        return this.jsqr
      case 0x3c:
      case 0x40:
      case 0x44:
      case 0x48:
        return this.jdr[(off - 0x3c) >> 2]
      case 0x4c: {
        // DR read: clears EOC (§11.12.1) and acknowledges the DMA request
        const v = this.dr
        this.sr &= ~EOC
        this.dmaPending = false
        this.update()
        return v
      }
      default:
        return 0
    }
  }

  write32(off: number, v: number, m: number): void {
    const now = this.ctx.clock.cycles
    switch (off) {
      case 0x00:
        // rc_w0: writing 0 clears, 1 has no effect
        this.sr &= ~(~v & m & 0x1f)
        this.update()
        return
      case 0x04: {
        const old = this.cr1
        this.cr1 = merge(old, v, m, this.cfg.master ? 0x00cfffff : 0x00c0ffff)
        this.checkModes(old)
        this.update()
        return
      }
      case 0x08:
        this.writeCr2(v, m, now)
        return
      case 0x0c:
        this.smpr1 = merge(this.smpr1, v, m, 0x00ffffff)
        return
      case 0x10:
        this.smpr2 = merge(this.smpr2, v, m, 0x3fffffff)
        return
      case 0x14:
      case 0x18:
      case 0x1c:
      case 0x20: {
        const i = (off - 0x14) >> 2
        this.jofr[i] = merge(this.jofr[i], v, m, 0xfff)
        return
      }
      case 0x24:
        this.htr = merge(this.htr, v, m, 0xfff)
        return
      case 0x28:
        this.ltr = merge(this.ltr, v, m, 0xfff)
        return
      case 0x2c:
      case 0x30:
      case 0x34: {
        const nv = merge(off === 0x2c ? this.sqr1 : off === 0x30 ? this.sqr2 : this.sqr3, v, m, off === 0x2c ? 0x00ffffff : 0x3fffffff)
        const old = off === 0x2c ? this.sqr1 : off === 0x30 ? this.sqr2 : this.sqr3
        if (off === 0x2c) this.sqr1 = nv
        else if (off === 0x30) this.sqr2 = nv
        else this.sqr3 = nv
        if (nv !== old && this.conv?.group === 'reg') this.restartGroup('reg', now)
        return
      }
      case 0x38: {
        const old = this.jsqr
        this.jsqr = merge(old, v, m, 0x003fffff)
        if (this.jsqr !== old && this.conv?.group === 'inj') this.restartGroup('inj', now)
        return
      }
      default:
        return // JDRx / DR are read-only
    }
  }

  reset(): void {
    this.abortAll()
    this.regUnsub?.()
    this.injUnsub?.()
    this.regUnsub = this.injUnsub = null
    this.regSig = this.injSig = null
    this.sr = this.cr1 = this.cr2 = this.smpr1 = this.smpr2 = 0
    this.jofr.fill(0)
    this.jdr.fill(0)
    this.htr = 0xfff
    this.ltr = this.sqr1 = this.sqr2 = this.sqr3 = this.jsqr = this.dr = 0
    this.powered = false
    this.calibrated = false
    this.stabReported = false
    this.tsOnAt = -Infinity
    this.dmaPending = false
    this.reported.clear()
    this.update()
  }

  clockEnabled(on: boolean): void {
    this.clocked = on
    if (!on && (this.conv || this.calRunning)) {
      this.ctx.log('warning', this.name, `${this.name} clock disabled (RCC_APB2ENR) during a ${this.calRunning ? 'calibration' : 'conversion'}: it is abandoned`)
      this.abortAll()
      this.cr2 &= ~(CAL | RSTCAL)
      this.update()
    }
  }

  clockChanged(): void {
    // conversions in flight keep the timing they started with; the next one uses the new ADCCLK
    this.reported.delete('adcclk')
  }

  // ------------------------------------------------------------ CR2

  private writeCr2(v: number, m: number, now: number): void {
    const old = this.cr2
    let nv = merge(old, v, m, this.cfg.master ? 0x00fef90f : 0x007ef90f)
    // the ADON start rule compares the WRITTEN value with the register (a 0 written to a running CAL counts as a change)
    const wroteOther = ((old ^ nv) & ~ADON) !== 0
    // CAL / RSTCAL are set by software and cleared by hardware only
    if (this.calRunning) nv |= old & (CAL | RSTCAL)
    this.cr2 = nv
    const changed = (old ^ nv) >>> 0
    const wroteAdon = (m & ADON) !== 0 && (v & ADON) !== 0

    if (!(nv & ADON)) {
      if (old & ADON) this.powerDown()
    } else if (!(old & ADON)) {
      this.powered = true
      this.powerOnAt = now
      this.stabReported = false
    } else if (wroteAdon && !wroteOther) {
      // second ADON = 1 write with no other change: start a regular conversion (§11.12.3)
      this.trigger('reg', now, 'ADON', false)
    }

    if (changed & nv & TSVREFE) this.tsOnAt = now
    if (changed & (EXTSEL | EXTTRIG | JEXTSEL | JEXTTRIG)) this.resubscribe()

    if (changed & nv & RSTCAL) this.startCalibration(RSTCAL, now)
    if (changed & nv & CAL) this.startCalibration(CAL, now)

    // software triggers: the rising edge of SWSTART · EXTTRIG · (EXTSEL = 111)
    if (nv & SWSTART && changed & (SWSTART | EXTTRIG | EXTSEL) && (nv & EXTTRIG) !== 0 && ((nv & EXTSEL) >>> 17) === 7) {
      this.trigger('reg', now, 'SWSTART', false)
    }
    if (nv & JSWSTART && changed & (JSWSTART | JEXTTRIG | JEXTSEL) && (nv & JEXTTRIG) !== 0 && ((nv & JEXTSEL) >>> 12) === 7) {
      this.trigger('inj', now, 'JSWSTART', false)
    }

    if (changed & DMA) {
      if (!(nv & DMA)) this.dmaPending = false
      else if (this.cfg.dma === null) {
        this.report('dma', 'warning', `${this.name}_CR2.DMA = 1 has no effect: only ADC1 generates DMA requests (RM0008 §11.8); ADC2 data reach the DMA only through ADC1 in dual mode, which is not simulated`)
      }
    }
    if (changed & CONT && nv & CONT && this.cr1 & DISCEN) this.checkModes(this.cr1)
    this.update()
  }

  private powerDown(): void {
    if (this.calRunning) this.ctx.log('warning', this.name, `${this.name} powered down (ADON = 0) during ${this.calRunning === CAL ? 'calibration' : 'calibration reset'}: it is abandoned`)
    this.abortAll()
    this.cr2 &= ~(CAL | RSTCAL)
    this.powered = false
    this.regPos = 0
    this.injPos = 0
  }

  /** stop every conversion / calibration event (registers keep their values) */
  private abortAll(): void {
    const s = this.ctx?.scheduler
    if (s) {
      s.cancel(this.convEv)
      s.cancel(this.calEv)
    }
    this.convEv = this.calEv = 0
    this.calRunning = 0
    this.conv = null
    this.regRunning = this.injRunning = false
    this.regPending = this.regResume = this.injAuto = false
  }

  // ------------------------------------------------------------ calibration

  private startCalibration(bit: typeof CAL | typeof RSTCAL, now: number): void {
    const what = bit === CAL ? 'CAL' : 'RSTCAL'
    if (!this.powered) {
      this.ctx.log('warning', this.name, `${this.name}_CR2.${what} set while ADON = 0: calibration needs the ADC powered on for at least 2 ADCCLK cycles (RM0008 §11.4) — nothing happens and ${what} stays set`)
      return
    }
    if (this.calRunning) return // the other phase is running; this one starts when it ends
    const T = this.adcCycles()
    if (now - this.powerOnAt < 2 * T) {
      this.ctx.log('warning', this.name, `${this.name} calibration started ${((now - this.powerOnAt) / T).toFixed(1)} ADCCLK cycles after power-up: RM0008 §11.4 requires ADON = 1 for at least 2 ADCCLK cycles first`)
    }
    if (this.conv) this.abortConversionFor(what)
    this.calRunning = bit
    const n = bit === CAL ? T_CAL_ADCCLK : T_RSTCAL_ADCCLK
    this.calEv = this.ctx.scheduler.schedule(now + n * T, (c) => {
      this.calEv = 0
      this.calRunning = 0
      this.cr2 &= ~bit
      if (bit === CAL) {
        this.dr = CAL_CODE // calibration code stored in DR (§11.4)
        this.calibrated = true
      }
      // the other phase was requested while this one ran
      if (bit === RSTCAL && this.cr2 & CAL) this.startCalibration(CAL, c)
      this.update()
    })
  }

  private abortConversionFor(what: string): void {
    this.ctx.log('warning', this.name, `${this.name}_CR2.${what} set during a conversion: the conversion is abandoned`)
    this.ctx.scheduler.cancel(this.convEv)
    this.convEv = 0
    this.conv = null
    this.regRunning = this.injRunning = false
    this.regPending = this.regResume = this.injAuto = false
  }

  // ------------------------------------------------------------ triggers

  private resubscribe(): void {
    const cr2 = this.cr2
    const extsel = (cr2 & EXTSEL) >>> 17
    const jextsel = (cr2 & JEXTSEL) >>> 12
    const reg = cr2 & EXTTRIG && extsel !== 7 ? REG_TRIGGERS[extsel] : null
    const inj = cr2 & JEXTTRIG && jextsel !== 7 ? INJ_TRIGGERS[jextsel] : null
    if (reg !== this.regSig) {
      this.regUnsub?.()
      this.regUnsub = null
      this.regSig = reg
      if (reg) this.regUnsub = this.subscribe(reg, 'reg')
    }
    if (inj !== this.injSig) {
      this.injUnsub?.()
      this.injUnsub = null
      this.injSig = inj
      if (inj) this.injUnsub = this.subscribe(inj, 'inj')
    }
  }

  private subscribe(signal: string, group: Group): (() => void) | null {
    const field = group === 'reg' ? 'EXTSEL' : 'JEXTSEL'
    if (signal.startsWith('EXTI')) {
      this.report(`exti-${group}`, 'warning', `${this.name}_CR2.${field} selects EXTI line ${signal.slice(4)} as the ${group === 'reg' ? 'regular' : 'injected'} trigger: EXTI → ADC trigger routing is not simulated, no conversion will start from it`)
      return null
    }
    const on = this.ctx.onTrigger
    if (!on) {
      this.report(`notrig-${group}`, 'warning', `${this.name} ${group === 'reg' ? 'regular' : 'injected'} trigger ${signal}: this SoC model does not route peripheral triggers, no conversion will start from it`)
      return null
    }
    return on(signal, (cycle) => this.trigger(group, cycle, signal, true))
  }

  /** A start event for `group` at core cycle `at` (from ADON, SWSTART/JSWSTART or an external trigger). */
  private trigger(group: Group, at: number, source: string, external: boolean): void {
    if (!this.clocked) return
    if (!this.powered) {
      this.report(`off-${source}`, 'warning', `${this.name} ${source} trigger ignored: the ADC is powered down (CR2.ADON = 0)`)
      return
    }
    if (this.calRunning) {
      this.report(`cal-${source}`, 'warning', `${this.name} ${source} trigger during calibration ignored`)
      return
    }
    const T = this.adcCycles()
    const ext = external ? this.ctx.cyclesPerTick(this.ctx.clocks.pclk2()) : 0
    if (group === 'reg') {
      this.cr2 &= ~SWSTART // cleared by hardware as soon as the conversion starts (§11.12.3)
      if (this.regRunning) return // a sequence is in progress: the event is lost
      if (this.injRunning) {
        this.regPending = true // executed at the end of the injected sequence (§11.3.9)
        return
      }
      this.beginRegular(at + T_LAT_REG_ADCCLK * T + ext)
    } else {
      this.cr2 &= ~JSWSTART
      if (this.cr1 & JAUTO) {
        this.report('jauto-trig', 'warning', `${this.name} injected trigger ${source} ignored: with CR1.JAUTO = 1 the injected group follows the regular one and its external trigger must be disabled (RM0008 §11.3.9)`)
        return
      }
      if (this.injRunning) return
      if (this.conv?.group === 'reg') {
        // the regular conversion in progress is reset; it is redone after the injected group
        this.ctx.scheduler.cancel(this.convEv)
        this.convEv = 0
        this.conv = null
        this.regResume = true
      }
      this.beginInjected(at + T_LAT_INJ_ADCCLK * T + ext)
    }
    this.update()
  }

  // ------------------------------------------------------------ sequencing

  private regLen(): number {
    return this.cr1 & (SCAN | DISCEN) ? ((this.sqr1 >>> 20) & 0xf) + 1 : 1
  }

  /** channel of regular rank `rank` (0-based: SQ1 = 0) */
  private regChannel(rank: number): number {
    const reg = rank < 6 ? this.sqr3 : rank < 12 ? this.sqr2 : this.sqr1
    return (reg >>> ((rank % 6) * 5)) & 0x1f
  }

  private injLen(): number {
    return this.cr1 & SCAN ? ((this.jsqr >>> 20) & 3) + 1 : 1
  }

  /** channel of the k-th injected conversion: JSQ(4−JL) … JSQ4 (§11.12.12) */
  private injChannel(k: number): number {
    const first = 3 - ((this.jsqr >>> 20) & 3)
    return (this.jsqr >>> (Math.min(first + k, 3) * 5)) & 0x1f
  }

  /** regular ↔ injected switch delay (JAUTO / resume): 1 ADCCLK, 2 at ADCPRE = /2 (§11.3.9) */
  private switchDelay(): number {
    const pre = Math.round(this.ctx.clocks.pclk2() / this.ctx.clocks.adcclk())
    return (pre <= 2 ? 2 : 1) * this.adcCycles()
  }

  private beginRegular(at: number): void {
    this.regRunning = true
    if (this.cr1 & DISCEN) {
      if (this.regPos >= this.regLen()) this.regPos = 0
      this.discLeft = ((this.cr1 >>> 13) & 7) + 1
    } else this.regPos = 0
    this.sr |= STRT
    this.startConversion('reg', at)
  }

  private beginInjected(at: number): void {
    this.injRunning = true
    if (!(this.cr1 & JDISCEN) || this.injPos >= this.injLen()) this.injPos = 0
    this.sr |= JSTRT
    this.startConversion('inj', at)
  }

  private restartGroup(group: Group, now: number): void {
    this.ctx.scheduler.cancel(this.convEv)
    this.convEv = 0
    this.conv = null
    if (group === 'reg') {
      this.regPos = 0
      this.discLeft = ((this.cr1 >>> 13) & 7) + 1
    } else this.injPos = 0
    this.startConversion(group, now + (group === 'reg' ? T_LAT_REG_ADCCLK : T_LAT_INJ_ADCCLK) * this.adcCycles())
  }

  private startConversion(group: Group, at: number): void {
    const ch = group === 'reg' ? this.regChannel(this.regPos) : this.injChannel(this.injPos)
    const T = this.adcCycles()
    this.checkTiming(at)
    const smp = SMP_CYCLES[this.smpCode(ch)]
    const sampleAt = at + smp * T
    const end = at + (smp + SAR_CYCLES) * T
    const conv: Conversion = { group, ch, raw: 0 }
    this.conv = conv
    this.convEv = this.ctx.scheduler.schedule(sampleAt, (c) => {
      conv.raw = this.sample(ch, c, smp * T)
      this.convEv = this.ctx.scheduler.schedule(end, (c2) => this.conversionDone(c2))
    })
  }

  private conversionDone(c: number): void {
    const cv = this.conv
    this.conv = null
    this.convEv = 0
    if (!cv) return
    if (cv.group === 'reg') this.regularDone(cv, c)
    else this.injectedDone(cv, c)
    this.update()
  }

  private regularDone(cv: Conversion, c: number): void {
    this.dr = this.cr2 & ALIGN ? (cv.raw << 4) & 0xffff : cv.raw
    if (this.cr2 & DMA && this.cfg.dma !== null) this.dmaPending = true
    this.watchdog(cv.ch, cv.raw, 'reg')
    const len = this.regLen()
    const disc = (this.cr1 & DISCEN) !== 0
    if (disc || this.regPos >= len - 1) this.sr |= EOC
    this.regPos++
    if (disc) {
      this.discLeft--
      if (this.regPos >= len) this.regPos = 0
      if (this.discLeft > 0 && this.regPos !== 0) this.startConversion('reg', c)
      else this.regRunning = false
      return
    }
    if (this.regPos < len) {
      this.startConversion('reg', c)
      return
    }
    this.regPos = 0
    if (this.cr1 & JAUTO) {
      this.injAuto = true
      this.beginInjected(c + this.switchDelay())
      return
    }
    if (this.cr2 & CONT) {
      this.sr |= STRT
      this.startConversion('reg', c)
      return
    }
    this.regRunning = false
  }

  private injectedDone(cv: Conversion, c: number): void {
    const k = this.injPos
    const v = cv.raw - this.jofr[k]
    // Figures 27/28: right = sign-extended 16 bit, left = SEXT + D11..D0 + 000
    this.jdr[k] = this.cr2 & ALIGN ? (v << 3) & 0xffff : v & 0xffff
    this.watchdog(cv.ch, cv.raw, 'inj')
    this.injPos++
    const len = this.injLen()
    const groupEnd = this.injPos >= len
    if (groupEnd) {
      this.sr |= JEOC | EOC
      this.injPos = 0
    }
    if (!groupEnd && !(this.cr1 & JDISCEN)) {
      this.startConversion('inj', c)
      return
    }
    this.injRunning = false
    const auto = this.injAuto
    this.injAuto = false
    if (auto) {
      if (this.cr2 & CONT && this.powered) {
        this.sr |= STRT
        this.startConversion('reg', c + this.switchDelay())
      } else this.regRunning = false
      return
    }
    if (this.regResume) {
      this.regResume = false
      this.startConversion('reg', c + this.switchDelay())
      return
    }
    if (this.regPending) {
      this.regPending = false
      this.beginRegular(c + this.switchDelay())
    }
  }

  private watchdog(ch: number, raw: number, group: Group): void {
    const c1 = this.cr1
    if (!(c1 & (group === 'reg' ? AWDEN : JAWDEN))) return
    if (c1 & AWDSGL && (c1 & AWDCH) !== ch) return
    if (raw > this.htr || raw < this.ltr) this.sr |= AWD
  }

  // ------------------------------------------------------------ analog input

  private smpCode(ch: number): number {
    if (ch < 10) return (this.smpr2 >>> (ch * 3)) & 7
    if (ch < 18) return (this.smpr1 >>> ((ch - 10) * 3)) & 7
    return 0
  }

  /** Convert the input of channel `ch` at the end of its sampling window (cycle c). */
  private sample(ch: number, c: number, sampleCycles: number): number {
    const v = this.inputVolts(ch, c, sampleCycles)
    const code = Math.round((v / this.vdda) * 4095)
    return code < 0 ? 0 : code > 4095 ? 4095 : code
  }

  private inputVolts(ch: number, c: number, sampleCycles: number): number {
    if (ch > 17) {
      this.report(`ch${ch}`, 'warning', `${this.name} channel ${ch} does not exist (channels 0–17): it converts 0`)
      return 0
    }
    if (ch >= 16) {
      const what = ch === 16 ? 'temperature sensor' : 'VREFINT'
      if (!this.cfg.master) return 0 // ADC2 IN16/IN17 are connected to VSS
      if (!(this.cr2 & TSVREFE)) {
        this.report(`tsoff${ch}`, 'warning', `${this.name} IN${ch} (${what}) converted with CR2.TSVREFE = 0: the sensor and VREFINT are powered down (RM0008 §11.10) — the simulated input is 0 V, silicon reads an undefined value`)
        return 0
      }
      const sinceOn = this.ctx.timeOfCycle(c - sampleCycles) - this.ctx.timeOfCycle(this.tsOnAt)
      if (sinceOn < T_START_TS_S) {
        this.report(`tsstart${ch}`, 'warning', `${this.name} IN${ch} (${what}) sampled ${(sinceOn * 1e6).toFixed(1)} µs after TSVREFE was set: the start-up time is up to 10 µs (DS5319 Table 50 tSTART), silicon output is not settled yet — the simulated one is`)
      }
      if (ch === 16) {
        const ts = this.ctx.timeOfCycle(c) - this.ctx.timeOfCycle(c - sampleCycles)
        if (ts < TS_TEMP_S - 1e-12) {
          this.report('tssmp', 'warning', `${this.name} temperature sensor sampled for ${(ts * 1e6).toFixed(2)} µs: RM0008 §11.10 / DS5319 Table 50 require 17.1 µs (SMP16 = 239.5 cycles at ADCCLK ≤ 14 MHz) — silicon reads too low, the simulated sensor is ideal`)
        }
        return V25 - (this.dieC - 25) * AVG_SLOPE
      }
      return VREFINT
    }
    const pin = adcChannelPin(ch)
    if (ch >= 10) {
      this.report(`ch${ch}`, 'warning', `${this.name} IN${ch} is ${pinName(pin)}, which is not bonded out on the STM32F103C8 (LQFP48, DS5319 Table 5): it converts 0`)
      return 0
    }
    this.checkAnalogMode(pin, ch)
    const v = this.ctx.pinVoltage(pin)
    if (!Number.isFinite(v)) {
      this.report(`nan${pin}`, 'warning', `${this.name} IN${ch} (${pinName(pin)}): the pin voltage is unknown (nothing drives it) — converted as 0 V; silicon converts whatever charge is left on the pin`)
      return 0
    }
    return v
  }

  /** Diagnostic: is the channel pin configured as analog input (CNF = 00, MODE = 00)? */
  private checkAnalogMode(pin: number, ch: number): void {
    const port = pin >> 4
    const bit = pin & 15
    try {
      if (!((this.ctx.bus.read32(RCC_APB2ENR) >>> (2 + port)) & 1)) return // port registers unreachable
      const cr = this.ctx.bus.read32(GPIO_BASE + port * 0x400 + (bit < 8 ? 0 : 4))
      const cfg = (cr >>> ((bit & 7) * 4)) & 0xf
      if (cfg === 0) {
        this.reported.delete(`mode${pin}`)
        return
      }
      this.report(`mode${pin}`, 'warning', `${this.name} IN${ch}: ${pinName(pin)} is not in analog mode (GPIO${PORT[port]}_${bit < 8 ? 'CRL' : 'CRH'} CNF/MODE = 0b${cfg.toString(2).padStart(4, '0')}). The ADC still converts the pin voltage, but RM0008 §9.1.11 requires analog mode for ADC inputs (GPIO_MODE_ANALOG): the input Schmitt trigger and any pull or output stay connected`)
    } catch {
      // diagnostic only
    }
  }

  private checkTiming(at: number): void {
    const f = this.ctx.clocks.adcclk()
    if (f > ADCCLK_MAX || f < ADCCLK_MIN) {
      this.report('adcclk', 'warning', `${this.name} converting with ADCCLK = ${(f / 1e6).toFixed(3)} MHz, outside 0.6–14 MHz (DS5319 Table 46 fADC): silicon accuracy is not guaranteed — set RCC_CFGR.ADCPRE (PCLK2/6 at 72 MHz)`)
    }
    if (!this.stabReported) {
      const dt = this.ctx.timeOfCycle(at) - this.ctx.timeOfCycle(this.powerOnAt)
      if (dt < T_STAB_S - 1e-12) {
        this.stabReported = true
        this.ctx.log('warning', this.name, `${this.name} conversion started ${(dt * 1e6).toFixed(2)} µs after power-up (ADON): the ADC needs tSTAB = 1 µs first (DS5319 Table 46) — silicon results are not guaranteed`)
      }
    }
    if (!this.calibrated) {
      this.report('uncal', 'info', `${this.name} converting without a calibration since reset (RM0008 §11.4 recommends HAL_ADCEx_Calibration_Start after each power-up); the simulated converter has no mismatch to calibrate, so results are unaffected`)
    }
  }

  private checkModes(oldCr1: number): void {
    const c1 = this.cr1
    if (this.cfg.master && c1 & DUALMOD && (c1 & DUALMOD) !== (oldCr1 & DUALMOD)) {
      this.ctx.log('warning', this.name, `ADC1_CR1.DUALMOD = ${(c1 & DUALMOD) >>> 16}: dual ADC modes are not simulated — ADC1 and ADC2 keep converting independently (ADC1_DR[31:16] stays 0)`)
    }
    if (c1 & DISCEN && this.cr2 & CONT) {
      this.report('disc-cont', 'warning', `${this.name}: discontinuous mode (DISCEN) together with continuous mode (CONT) is not allowed (RM0008 §11.3.10) — the model converts discontinuous bursts and ignores CONT`)
    }
    if (c1 & JAUTO && c1 & (DISCEN | JDISCEN)) {
      this.report('jauto-disc', 'warning', `${this.name}: auto-injection (JAUTO) cannot be combined with discontinuous mode (RM0008 §11.3.9) — results are not specified`)
    }
  }

  private adcCycles(): number {
    return this.ctx.cyclesPerTick(this.ctx.clocks.adcclk())
  }

  private report(key: string, level: 'info' | 'warning', msg: string): void {
    if (this.reported.has(key)) return
    this.reported.add(key)
    this.ctx.log(level, this.name, msg)
  }

  // ------------------------------------------------------------ outputs

  private update(): void {
    if (!this.ctx) return
    const s = this.sr
    const c1 = this.cr1
    const irq = ((s & EOC) !== 0 && (c1 & EOCIE) !== 0) || ((s & JEOC) !== 0 && (c1 & JEOCIE) !== 0) || ((s & AWD) !== 0 && (c1 & AWDIE) !== 0)
    if (irq !== this.irqOn) {
      this.irqOn = irq
      this.ctx.setIrq(ADC_IRQ, irq)
    }
    const ch = this.cfg.dma
    const dma = ch !== null && this.dmaPending && (this.cr2 & DMA) !== 0
    if (dma !== this.dmaOn && ch !== null) {
      this.dmaOn = dma
      this.ctx.dmaRequest(ch, dma)
    }
  }
}
