/**
 * TIM1 (advanced-control, RM0008 ch. 14) and TIM2–TIM4 (general-purpose,
 * ch. 15) of the STM32F103.
 *
 * Registers (§14.4 / §15.4): CR1, CR2, SMCR, DIER, SR (rc_w0), EGR, CCMR1/2
 * (output and input layouts), CCER, CNT, PSC, ARR, RCR (TIM1), CCR1–4, BDTR
 * (TIM1), DCR, DMAR. Reserved offsets read 0. ARR resets to 0xFFFF (what F1
 * silicon reads back; some RM0008 revisions print 0x0000).
 *
 * LAZY COUNTER. Nothing ticks. The counter state (CNT, direction,
 * prescaler counter) is known at an anchor cycle; CK_PSC edges fall every
 * `k` core cycles (k = HCLK / TIMxCLK from SocContext.clocks.timclk1/2),
 * CK_CNT every PSC + 1 of them (§15.3.1). `advanceTo(cycle)` moves the state
 * forward with the closed forms of tim-counter.ts and stops exactly at every
 * RELEVANT step on the way — an overflow/underflow someone observes (UIE,
 * UDE, OPM, TRGO = update, a pending ARR/PSC/CCR preload, AOE, an
 * edge-aligned PWM output) or a compare match of a channel in an active
 * output mode (or with CCxIE/CCxDE) — and processes that step at its exact
 * cycle. Only the next relevant step is ever scheduled on ctx.scheduler, so
 * a 100 kHz PWM channel costs two events per period. Steps nobody observes
 * are skipped and their side effects applied in bulk (UIF/CCxIF set,
 * repetition counter), so SR/CNT read exactly as if the timer had ticked.
 * Every register access, input edge and clock change first brings the
 * counter up to date with the clock in force until then.
 *
 * Time base (§15.3.2, §14.3.3): edge-aligned up/down (DIR), center-aligned
 * modes 1–3 (overflow at CNT = ARR, underflow at 0, DIR read-only), ARR = 0
 * blocks the counter, PSC always preloaded, ARR preloaded with ARPE, UEV on
 * overflow/underflow (TIM1: when the repetition counter is 0, both
 * directions count in center-aligned mode), UG, or a slave reset; UDIS
 * suppresses it (the counter still restarts), URS keeps UG/slave updates
 * from setting UIF. One-pulse mode clears CEN at the update event.
 *
 * Output compare (§15.3.8–15.3.9, §14.3.9–14.3.11): frozen, active /
 * inactive / toggle on match, force inactive / active, PWM mode 1/2 (up:
 * active while CNT < CCR; down: while CNT ≤ CCR), CCxP polarity, CCRx
 * preload (OCxPE, transferred at UEV), center-aligned compare-flag rules
 * (CMS 1/2/3). OCx reaches its pin through ctx.setAfOutput with the exact
 * edge cycle; a disabled output releases the pin (the GPIO's AF default,
 * low). TIM1: MOE (outputs only when set; AOE sets it at the next UEV; a
 * one-time hint is logged when TIM1 counts with CCxE/CCxNE set but
 * MOE = 0), complementary outputs CHxN with dead-time insertion (DTG and
 * CKD, §14.3.11: the rising edge of OCx and of OCxN is delayed, pulses
 * shorter than the dead time vanish), OSSR/OSSI off-states and the OISx /
 * OISxN idle levels (the idle level is applied at once — the asynchronous
 * CCxP phase and its dead time before it are not modelled), break input
 * (BKIN pin with BKE/BKP, or BG: MOE cleared, BIF, level-sensitive — MOE
 * cannot be set while the break is active), COM preload of CCxE/CCxNE/OCxM
 * (CCPC, COMG or TRGI with CCUS), LOCK levels 1–3 (write-once). Debug freeze
 * of TIM1 also disables its outputs (§31.16.3, as if MOE were 0).
 *
 * Input (§15.3.4–15.3.6, §15.3.12–15.3.14): TI1..TI4 from the CHx pins
 * (TI1S: CH1 ⊕ CH2 ⊕ CH3), digital filter ICxF/ETF approximated as a
 * sampling-time hold — an edge is accepted N·t_SAMPLING after it happened if
 * the input did not change back meanwhile (silicon: N consecutive samples,
 * i.e. up to one sampling period earlier); direct / indirect / TRC capture
 * with CCxP edge selection, ICxPSC (reset when CCxE = 0), CCxIF/CCxOF,
 * CCRx read clears CCxIF. The capture latches the counter BEFORE an
 * increment that falls on the edge cycle, so in PWM input mode (slave reset
 * on TI1FP1) CCR1 = period − 1 and CCR2 = high time − 1 ticks (RM0008
 * Figure 113: CCR1 = 0004 for a five-tick period). Encoder modes 1–3 count
 * every TI1FP1/TI2FP2 edge per Table 79/87 (through PSC), DIR follows.
 * Slave modes reset / gated / trigger / external clock 1 with TRGI = ITRx,
 * TI1F_ED, TI1FP1, TI2FP2, ETRF; external clock mode 2 (ECE) with ETP, ETPS,
 * ETF. Master mode TRGO per MMS (reset, enable, update, compare pulse,
 * OC1REF..OC4REF) is emitted as 'TIMn_TRGO' on every rising edge through
 * ctx.emitTrigger, plus 'TIMn_TRGO_FALL' on its falling edge (pulses rise
 * and fall in the same cycle) so a GATED slave can follow a level; slaves
 * subscribe through ctx.onTrigger. Compare/capture events are emitted as
 * 'TIMn_CCx' (ADC external triggers, §11.12.9) when CCxIF is set by a match
 * or capture (or CCxG). Limitation: a channel in FROZEN mode without
 * CCxIE/CCxDE is matched lazily (its CCxIF is still set) and emits no
 * 'TIMn_CCx' — an ADC triggered by it would not start; any active output
 * mode (e.g. CubeMX "PWM Generation No Output") does emit.
 *
 * Interrupts (level: flag AND enable): TIM1_BRK 24, TIM1_UP 25,
 * TIM1_TRG_COM 26, TIM1_CC 27, TIM2 28, TIM3 29, TIM4 30. DMA requests
 * (UDE, CCxDE with CCDS, TDE, COMDE) on the Table 78 channels, held until
 * the DMA acknowledges (dmaAck) or the enable bit is cleared. DMA burst
 * (DCR/DMAR) is partial: DMAR accesses walk DBA … DBA + DBL, restarting at
 * each update event, without the multi-request burst sequencing.
 *
 * Not simulated (logged once when used): OCxREF clear by ETRF (OCxCE),
 * output-compare fast enable (OCxFE — there is no trigger-to-output latency
 * to shorten). Approximations (documented, not logged): the 1-cycle CNT_EN
 * and input resynchronisation latencies are not modelled; a counter above
 * ARR rolls over at 0xFFFF without an update event; MSM has no effect (all
 * trigger paths are already zero-latency); a gated slave on ITRx starts with
 * the master's TRGO assumed low until its next edge.
 */
import type { AccessSize, EventHandle } from '../core/types'
import type { RccGate, SocContext, Stm32Peripheral } from './periph-api'
import { laneMask, laneShift } from './block'
import { advance, type CountMode, type MatchDir, pwm1Active, stepOnce, stepsToEnter, stepsToWrap } from './tim-counter'
import type { TimConfig, TimName } from './tim-config'

export { TIM1_CONFIG, TIM2_CONFIG, TIM3_CONFIG, TIM4_CONFIG } from './tim-config'

const GP_NOTES =
  'Lazy 16-bit counter (events only at relevant steps, never per tick): edge-aligned up/down, center-aligned 1–3, PSC/ARR/CCRx preloads, UG/UDIS/URS, one-pulse mode; output compare (frozen, active/inactive/toggle on match, forced, PWM 1/2, CCxP) with exact edge cycles on the AFIO-remapped LQFP48 pins; input capture (direct/indirect/TRC, edge polarity, ICxPSC, CCxOF; the ICxF/ETF digital filter is approximated as an N-sample hold), PWM input via slave reset, encoder modes 1–3, slave reset/gated/trigger/external clock 1 (TI1F_ED, TI1FP1, TI2FP2, ETRF, ITRx via TRGO), external clock mode 2 (ETR, ETPS, ETF), TRGO (reset/enable/update/compare pulse/OCxREF) and TIMx_CCx trigger events, level interrupts, DMA requests per RM0008 Table 78, DBG_TIMx_STOP. ' +
  'Unit-tested only (no firmware yet): center-aligned and down-counting, one-pulse, gated/trigger/external-clock slave modes, ITR chaining, ETR, Hall-sensor XOR + TRC capture, update DMA through DMA1. ' +
  'Partial: DMA burst (DMAR walks DBA…DBA+DBL, no multi-transfer sequencing); OCxCE (OCxREF clear on ETRF) and OCxFE are not simulated (logged); the 1-cycle CNT_EN and input-resynchronisation latencies are not modelled; a frozen-mode channel without CCxIE/CCxDE emits no TIMx_CCx trigger; a gated slave on ITRx assumes the master TRGO low until its next edge.'

/** Support-table entries (peripherals.ts): what is implemented, what real firmware verified, what is partial. */
export const TIM_SUPPORT: Record<TimName, { notes: string; verifiedBy: string[] }> = {
  TIM1: {
    notes:
      'Advanced-control timer: everything listed for TIM2–4, plus the repetition counter, BDTR (MOE/AOE — a hint is logged when TIM1 counts with outputs enabled but MOE = 0; complementary CHxN outputs with DTG/CKD dead time; OSSR/OSSI off-states and OISx/OISxN idle levels, applied at once without the asynchronous CCxP phase; break input BKIN on PB12 / PA6 and BG, level-sensitive; LOCK 1–3, write-once), COM preload (CCPC, COMG, CCUS) and outputs disabled during the debug freeze. ' +
      'Firmware-verified: PWM on PA8 with MOE set by HAL_TIM_PWM_Start (hal-tim-pwm). Unit-tested only: repetition counter, dead time, break, AOE, COM, LOCK. ' +
      GP_NOTES.slice(GP_NOTES.indexOf('Partial:')) +
      ' The full remap (port E) is not bonded on the LQFP48 (reported).',
    verifiedBy: ['hal-tim-pwm'],
  },
  TIM2: {
    notes: GP_NOTES + ' Firmware-verified on TIM2: PWM output (hal-tim-pwm 1 kHz on PA0; hal-servo 50 Hz on PA1 with preloaded CCR2 steps) and PWM input capture with slave reset mode and URS (hal-tim-capture on PA0).',
    verifiedBy: ['hal-tim-pwm', 'hal-servo', 'hal-tim-capture'],
  },
  TIM3: {
    notes:
      GP_NOTES +
      ' Firmware-verified on TIM3: PWM output (hal-tim-pwm 20 kHz on PA6, also through the circuit coordinator driving an LED; hal-pwm-fade with the update interrupt and preloaded CCR1; hal-tim-capture generator with preloaded ARR/CCR1 changes). TIM3_ETR (PD2) and the full remap (PC6–PC9) are not bonded on the LQFP48 (reported).',
    verifiedBy: ['hal-tim-pwm', 'hal-pwm-fade', 'hal-tim-capture'],
  },
  TIM4: {
    notes:
      GP_NOTES +
      ' Firmware-verified on TIM4: update-interrupt time base (hal-tim-irq) and encoder mode 3 with the input filter (hal-tim-encoder on PB6/PB7). TIM4_ETR (PE0) and the remap (PD12–PD15) are not bonded on the LQFP48 (reported).',
    verifiedBy: ['hal-tim-irq', 'hal-tim-encoder'],
  },
}

// CR1
const CEN = 1 << 0
const UDIS = 1 << 1
const URS = 1 << 2
const OPM = 1 << 3
const DIR = 1 << 4
const ARPE = 1 << 7
// CR2
const CCPC = 1 << 0
const CCUS = 1 << 2
const CCDS = 1 << 3
const TI1S = 1 << 7
// SMCR
const ECE = 1 << 14
const ETP = 1 << 15
// DIER / SR / EGR
const UIF = 1 << 0
const CC1IF = 1 << 1
const COMIF = 1 << 5
const TIF = 1 << 6
const BIF = 1 << 7
const CC1OF = 1 << 9
const UDE = 1 << 8
const CC1DE = 1 << 9
const COMDE = 1 << 13
const TDE = 1 << 14
// BDTR
const MOE = 1 << 15
const AOE = 1 << 14
const BKP = 1 << 13
const BKE = 1 << 12
const OSSR = 1 << 11
const OSSI = 1 << 10

/** ICxF / ETF: [t_SAMPLING in CK_INT periods (negative = in t_DTS units), N] (§15.4.7) */
const FILTER: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 2],
  [1, 4],
  [1, 8],
  [-2, 6],
  [-2, 8],
  [-4, 6],
  [-4, 8],
  [-8, 6],
  [-8, 8],
  [-16, 5],
  [-16, 6],
  [-16, 8],
  [-32, 5],
  [-32, 6],
  [-32, 8],
]

/** nested trigger deliveries (TRGO → slave → TRGO …) beyond this are dropped */
const MAX_TRIGGER_DEPTH = 8
let triggerDepth = 0

type UpdateSource = 'counter' | 'ug' | 'slave'

export class Tim implements Stm32Peripheral {
  readonly name: TimName
  readonly base: number
  readonly size = 0x400
  readonly gate: RccGate

  private ctx!: SocContext
  private readonly adv: boolean

  // ---- registers as software sees them
  private cr1 = 0
  private cr2 = 0
  private smcr = 0
  private dier = 0
  private sr = 0
  private ccmr = [0, 0]
  private ccer = 0
  private psc = 0
  private arr = 0xffff
  private rcr = 0
  private ccr = [0, 0, 0, 0]
  private bdtr = 0
  private dcr = 0
  private lockFrozen = false

  // ---- active (shadow) registers
  private pscAct = 0
  private arrAct = 0xffff
  private ccrAct = [0, 0, 0, 0]
  private repCnt = 0
  /** CCER as used by the outputs (CCxE/CCxNE of CH1–3 are COM-preloaded when CCPC = 1) */
  private ccerAct = 0
  /** OCxM in force (COM-preloaded for CH1–3 when CCPC = 1) */
  private ocmAct = [0, 0, 0, 0]

  // ---- counter
  private cnt = 0
  private down = false
  private psCnt = 0
  private anchor = 0
  /** core cycles per CK_INT (TIMxCLK) period */
  private k = 1

  // ---- run conditions
  private clockOn = false
  private frozen = false
  private gateOpen = false
  private breakActive = false

  // ---- scheduling
  private ev: EventHandle = 0
  private evAt = -1

  // ---- outputs: 0..3 = OC1..OC4, 4..6 = OC1N..OC3N
  private ref = [0, 0, 0, 0]
  private dtP = [0, 0, 0, 0]
  private dtN = [1, 1, 1, 1]
  private dtEv: EventHandle[] = [0, 0, 0, 0]
  private outPin = [-1, -1, -1, -1, -1, -1, -1]
  private outLvl: (0 | 1 | null)[] = [null, null, null, null, null, null, null]

  // ---- inputs
  private chPin = [-1, -1, -1, -1]
  private etrPin = -1
  private bkinPin = -1
  private pinNames: { ch: string[]; chn: string[]; etr: string; bkin: string | null } = { ch: [], chn: [], etr: '', bkin: null }
  private subs = new Map<number, () => void>()
  private pinLv = new Map<number, 0 | 1>()
  private tiRaw = [0, 0, 0, 0]
  private tiF = [0, 0, 0, 0]
  private tiEv: EventHandle[] = [0, 0, 0, 0]
  private tiOn = [false, false, false, false]
  private icps = [0, 0, 0, 0]
  private etrOn = false
  private etrRaw = 0
  private etrF = 0
  private etrEv: EventHandle = 0
  private etpsCnt = 0
  private bkinOn = false
  private itrKey = ''
  private itrUnsub: (() => void)[] = []
  private itrLevel = 0

  // ---- irq / dma / trgo
  private irqOn = new Map<number, boolean>()
  private dmaPend = 0
  private dmaOn = new Set<number>()
  private trgoHigh = 0
  private burstIdx = 0
  private moeHintEv: EventHandle = 0
  private warned = new Set<string>()

  constructor(private cfg: TimConfig) {
    this.name = cfg.name
    this.base = cfg.base
    this.gate = cfg.gate
    this.adv = cfg.advanced
  }

  attach(ctx: SocContext): void {
    this.ctx = ctx
    this.k = this.cyclesPerTick()
    this.resolvePins()
  }

  // ================================================================ bus

  read(offset: number, size: AccessSize): number {
    const w = this.read32(offset & ~3)
    if (size === 4) return w >>> 0
    return (w >>> laneShift(offset)) & (size === 2 ? 0xffff : 0xff)
  }

  write(offset: number, value: number, size: AccessSize): void {
    if (size === 4) this.write32(offset & ~3, value >>> 0, 0xffffffff)
    else this.write32(offset & ~3, (value << laneShift(offset)) >>> 0, laneMask(offset, size))
  }

  private now(): number {
    return this.ctx.clock.cycles
  }

  private read32(off: number): number {
    switch (off) {
      case 0x00:
        return (this.cr1 & ~DIR) | (this.down ? DIR : 0)
      case 0x04:
        return this.cr2
      case 0x08:
        return this.smcr
      case 0x0c:
        return this.dier
      case 0x10:
        this.advanceTo(this.now())
        this.updateIrqDma()
        return this.sr
      case 0x18:
        return this.ccmr[0]
      case 0x1c:
        return this.ccmr[1]
      case 0x20:
        return this.ccer
      case 0x24:
        this.advanceTo(this.now())
        return this.cnt
      case 0x28:
        return this.psc
      case 0x2c:
        return this.arr
      case 0x30:
        return this.adv ? this.rcr : 0
      case 0x34:
      case 0x38:
      case 0x3c:
      case 0x40: {
        const i = (off - 0x34) >> 2
        if (this.ccs(i) !== 0 && this.sr & (CC1IF << i)) {
          // input capture: reading CCRx clears CCxIF (§15.4.5)
          this.advanceTo(this.now())
          this.sr &= ~(CC1IF << i)
          this.updateIrqDma()
        }
        return this.ccr[i]
      }
      case 0x44:
        return this.adv ? this.bdtr : 0
      case 0x48:
        return this.dcr
      case 0x4c: {
        const o = this.burstOffset()
        return o === 0x4c ? 0 : this.read32(o)
      }
      default:
        return 0 // EGR is write-only; reserved offsets
    }
  }

  private write32(off: number, v: number, m: number): void {
    if (!this.ctx) return
    const now = this.now()
    this.advanceTo(now)
    switch (off) {
      case 0x00:
        this.writeCr1(now, ((this.cr1 & ~m) | (v & m)) & 0x3ff, v, m)
        break
      case 0x04:
        this.writeCr2(now, ((this.cr2 & ~m) | (v & m)) & (this.adv ? 0x7ffd : 0xf8))
        break
      case 0x08:
        this.writeSmcr(now, ((this.smcr & ~m) | (v & m)) & 0xfff7)
        break
      case 0x0c: {
        this.dier = ((this.dier & ~m) | (v & m)) & (this.adv ? 0x7fff : 0x5f5f)
        this.dmaPend &= this.dier
        break
      }
      case 0x10: {
        // rc_w0; BIF cannot be cleared while the break input is active (§14.3.12)
        let clr = ~v & m & (this.adv ? 0x1eff : 0x1e5f)
        if (this.breakActive) clr &= ~BIF
        this.sr &= ~clr
        break
      }
      case 0x14:
        this.writeEgr(now, v & m & (this.adv ? 0xff : 0x5f))
        break
      case 0x18:
      case 0x1c:
        this.writeCcmr(now, (off - 0x18) >> 2, v, m)
        break
      case 0x20:
        this.writeCcer(now, ((this.ccer & ~m) | (v & m)) & (this.adv ? 0x3fff : 0x3333))
        break
      case 0x24:
        this.cnt = ((this.cnt & ~m) | (v & m)) & 0xffff
        this.refreshRefs(now)
        break
      case 0x28:
        this.psc = ((this.psc & ~m) | (v & m)) & 0xffff
        break
      case 0x2c:
        this.arr = ((this.arr & ~m) | (v & m)) & 0xffff
        if (!(this.cr1 & ARPE)) {
          this.arrAct = this.arr
          this.refreshRefs(now)
        }
        break
      case 0x30:
        if (this.adv) this.rcr = ((this.rcr & ~m) | (v & m)) & 0xff
        break
      case 0x34:
      case 0x38:
      case 0x3c:
      case 0x40: {
        const i = (off - 0x34) >> 2
        if (this.ccs(i) !== 0) break // input capture: CCRx is read-only
        this.ccr[i] = ((this.ccr[i] & ~m) | (v & m)) & 0xffff
        if (!this.ocpe(i)) {
          this.ccrAct[i] = this.ccr[i]
          this.refreshRefs(now)
        }
        break
      }
      case 0x44:
        if (this.adv) this.writeBdtr(now, v, m)
        break
      case 0x48:
        this.dcr = ((this.dcr & ~m) | (v & m)) & 0x1f1f
        this.burstIdx = 0
        break
      case 0x4c: {
        const o = this.burstOffset()
        if (o !== 0x4c) this.write32(o, v, m)
        return
      }
    }
    this.reschedule()
    this.updateIrqDma()
  }

  private writeCr1(now: number, nv: number, v: number, m: number): void {
    const old = this.cr1
    const enc = this.encoder()
    const center = ((nv >> 5) & 3) !== 0
    if (((nv >> 8) & 3) === 3) this.warnOnce('ckd', `${this.name}_CR1.CKD = 11 is reserved (RM0008 §15.4.1): t_DTS is taken as 4 × t_CK_INT`)
    if (center && !((old >> 5) & 3) && old & CEN) {
      this.warnOnce('cms', `${this.name}: switching from edge-aligned to center-aligned mode while the counter is enabled is not allowed (RM0008 §15.4.1 CMS)`)
    }
    // DIR is read-only in center-aligned and encoder modes (it shows the counting direction)
    if (!center && !enc && m & DIR) this.down = (v & DIR) !== 0
    if (center && !((old >> 5) & 3)) this.down = this.cnt === this.arrAct && this.cnt !== 0
    this.cr1 = nv
    if ((old ^ nv) & CEN) this.cntEnChanged(now)
    this.refreshRefs(now)
    this.moeHint()
  }

  private writeCr2(now: number, nv: number): void {
    let w = nv
    if (this.adv && this.lockLevel() >= 1) w = (w & ~0x7f00) | (this.cr2 & 0x7f00) // OISx/OISxN locked
    const old = this.cr2
    this.cr2 = w
    if (this.adv && (old ^ w) & CCPC && !(w & CCPC)) {
      // preload off: the registers are in force again
      const before = [0, 1, 2, 3].map((i) => this.complementary(i))
      this.ccerAct = this.ccer
      this.complementChanged(before)
      for (let i = 0; i < 3; i++) this.ocmAct[i] = this.ocm(i)
    }
    if ((old ^ w) & 0x70) this.trgoRecompute(now)
    if ((old ^ w) & TI1S) this.rewireInputs()
    this.rewireTriggers()
    this.applyOutputs(now)
  }

  private writeSmcr(now: number, nv: number): void {
    const old = this.smcr
    this.smcr = nv
    if ((old ^ nv) & 0x7077 || (old ^ nv) & ECE) {
      this.rewireInputs()
      this.rewireTriggers()
    }
    if ((old ^ nv) & ETP) this.etrRawChanged(now)
    this.gateOpen = this.sms() === 5 && this.trgiLevel() === 1
    if (this.trgoMms() === 1) this.trgoRecompute(now)
  }

  private writeEgr(now: number, v: number): void {
    if (v & 1) this.reinit(now, 'ug')
    for (let i = 0; i < 4; i++) {
      if (!(v & (CC1IF << i))) continue
      if (this.ccs(i) === 0) this.ccEvent(i, now, false)
      else {
        // CCxG on an input channel: capture now (no prescaler)
        this.ccr[i] = this.ccrAct[i] = this.cnt
        this.ccEvent(i, now, true)
      }
    }
    if (v & TIF) this.triggerFlag()
    if (this.adv && v & COMIF) this.comEvent(now)
    if (this.adv && v & BIF) this.breakEvent(now)
  }

  private writeCcmr(now: number, r: number, v: number, m: number): void {
    const old = this.ccmr[r]
    let nv = ((old & ~m) | (v & m)) & 0xffff
    for (let h = 0; h < 2; h++) {
      const i = r * 2 + h
      const sh = h * 8
      const ob = (old >> sh) & 0xff
      let nb = (nv >> sh) & 0xff
      // CCxS is writable only while the channel is off (§15.4.7)
      if ((nb & 3) !== (ob & 3) && (this.ccer >> (4 * i)) & 1) nb = (nb & ~3) | (ob & 3)
      // LOCK level 3: OCxM / OCxPE of output channels frozen (§14.4.18)
      if (this.adv && this.lockLevel() >= 3 && (ob & 3) === 0) nb = (nb & ~0x78) | (ob & 0x78)
      nv = (nv & ~(0xff << sh)) | (nb << sh)
    }
    this.ccmr[r] = nv
    for (let h = 0; h < 2; h++) {
      const i = r * 2 + h
      const ob = (old >> (h * 8)) & 0xff
      const nb = (nv >> (h * 8)) & 0xff
      if (!this.comPreloaded(i)) this.ocmAct[i] = (nb & 3) === 0 ? (nb >> 4) & 7 : 0
      if ((ob & 3) !== (nb & 3)) {
        this.icps[i] = 0
        if ((nb & 3) !== 0) this.ocmAct[i] = 0
      }
      if ((nb & 3) === 0) {
        if (nb & 0x80) this.warnOnce(`occe${i}`, `${this.name} OC${i + 1}CE (OC${i + 1}REF clear on ETRF) is not simulated: the reference is never cleared by ETR`)
        if (nb & 0x04) this.warnOnce(`ocfe${i}`, `${this.name} OC${i + 1}FE (output-compare fast enable) is not simulated: a trigger does not force OC${i + 1}REF early`)
      }
    }
    this.rewireInputs()
    this.rewireTriggers()
    this.refreshRefs(now)
    this.applyOutputs(now)
  }

  private writeCcer(now: number, nv: number): void {
    const old = this.ccer
    if (this.adv && this.lockLevel() >= 2) {
      // LOCK level 2: CCxP / CCxNP of output channels frozen
      for (let i = 0; i < 4; i++) if (this.ccs(i) === 0) nv = (nv & ~(0xa << (4 * i))) | (old & (0xa << (4 * i)))
    }
    this.ccer = nv
    const before = [0, 1, 2, 3].map((i) => this.complementary(i))
    const pre = this.adv && this.cr2 & CCPC ? 0x555 : 0 // CCxE/CCxNE of CH1–3
    this.ccerAct = (this.ccerAct & pre) | (nv & ~pre)
    for (let i = 0; i < 4; i++) if (!((this.ccerAct >> (4 * i)) & 1)) this.icps[i] = 0
    this.complementChanged(before)
    this.applyOutputs(now)
    this.moeHint()
  }

  private writeBdtr(now: number, v: number, m: number): void {
    const lock = this.lockLevel()
    let wm = m & 0xffff
    if (this.lockFrozen) wm &= ~0x300
    if (lock >= 1) wm &= ~(0xff | AOE | BKP | BKE)
    if (lock >= 2) wm &= ~(OSSR | OSSI)
    let nv = (this.bdtr & ~wm) | (v & wm)
    if (this.breakActive) nv &= ~MOE // MOE cannot be set while the break input is active (§14.3.12)
    this.lockFrozen = true
    this.bdtr = nv
    this.rewireInputs()
    this.bkinChanged(now)
    this.applyOutputs(now)
    this.moeHint()
  }

  // ================================================================ SoC hooks

  reset(): void {
    const s = this.ctx?.scheduler
    if (s) {
      for (const h of [this.ev, this.etrEv, this.moeHintEv, ...this.dtEv, ...this.tiEv]) if (h) s.cancel(h)
    }
    this.ev = this.etrEv = this.moeHintEv = 0
    this.evAt = -1
    this.dtEv = [0, 0, 0, 0]
    this.tiEv = [0, 0, 0, 0]
    for (const u of this.subs.values()) u()
    this.subs.clear()
    this.pinLv.clear()
    for (const u of this.itrUnsub) u()
    this.itrUnsub = []
    this.itrKey = ''
    this.itrLevel = 0
    if (this.ctx) {
      for (let o = 0; o < 7; o++) if (this.outLvl[o] !== null && this.outPin[o] >= 0) this.ctx.setAfOutput(this.name, this.outPin[o], null)
      for (const [irq, on] of this.irqOn) if (on) this.ctx.setIrq(irq, false)
      for (const ch of this.dmaOn) this.ctx.dmaRequest(ch, false)
      if (this.trgoHigh) this.ctx.emitTrigger?.(this.name + '_TRGO_FALL')
    }
    this.outLvl = [null, null, null, null, null, null, null]
    this.irqOn.clear()
    this.dmaOn.clear()
    this.dmaPend = 0
    this.trgoHigh = 0
    this.cr1 = this.cr2 = this.smcr = this.dier = this.sr = 0
    this.ccmr = [0, 0]
    this.ccer = this.ccerAct = 0
    this.psc = this.pscAct = 0
    this.arr = this.arrAct = 0xffff
    this.rcr = this.repCnt = 0
    this.ccr = [0, 0, 0, 0]
    this.ccrAct = [0, 0, 0, 0]
    this.ocmAct = [0, 0, 0, 0]
    this.bdtr = this.dcr = 0
    this.lockFrozen = false
    this.cnt = this.psCnt = 0
    this.down = false
    this.anchor = this.ctx ? this.now() : 0
    this.frozen = false
    this.gateOpen = false
    this.breakActive = false
    this.ref = [0, 0, 0, 0]
    this.dtP = [0, 0, 0, 0]
    this.dtN = [1, 1, 1, 1]
    this.tiRaw = [0, 0, 0, 0]
    this.tiF = [0, 0, 0, 0]
    this.tiOn = [false, false, false, false]
    this.icps = [0, 0, 0, 0]
    this.etrOn = this.bkinOn = false
    this.etrRaw = this.etrF = this.etpsCnt = 0
    this.burstIdx = 0
    this.warned.clear()
    if (this.ctx) this.resolvePins()
  }

  clockEnabled(on: boolean): void {
    if (on === this.clockOn) return
    const now = this.now()
    this.advanceTo(now)
    this.clockOn = on
    this.anchor = now
    this.reschedule()
    this.moeHint()
  }

  clockChanged(): void {
    if (!this.ctx) return
    const now = this.now()
    this.advanceTo(now) // with the clock that was in force until now
    const k = this.cyclesPerTick()
    if (k !== this.k) {
      this.k = k
      this.anchor = now
      this.reschedule()
    }
  }

  remapChanged(): void {
    this.resolvePins()
  }

  dmaAck(channel: number): void {
    let clr = 0
    for (const bit of [UDE, CC1DE, CC1DE << 1, CC1DE << 2, CC1DE << 3, COMDE, TDE]) if (this.dmaChannel(bit) === channel) clr |= bit
    if (!(this.dmaPend & clr)) return
    this.dmaPend &= ~clr
    this.updateIrqDma()
  }

  debugHalt(halted: boolean): void {
    const now = this.now()
    this.advanceTo(now)
    this.frozen = halted
    this.anchor = now
    if (this.adv) this.applyOutputs(now) // TIM1 outputs are disabled while frozen (§31.16.3)
    this.reschedule()
  }

  // ================================================================ field helpers

  private cyclesPerTick(): number {
    const hz = this.cfg.apb === 2 ? this.ctx.clocks.timclk2() : this.ctx.clocks.timclk1()
    return hz > 0 ? this.ctx.cyclesPerTick(hz) : Infinity
  }

  private ccs(i: number): number {
    return (this.ccmr[i >> 1] >> ((i & 1) * 8)) & 3
  }

  private ccmrByte(i: number): number {
    return (this.ccmr[i >> 1] >> ((i & 1) * 8)) & 0xff
  }

  /** OCxM as written (the preload view when CCPC = 1) */
  private ocm(i: number): number {
    return this.ccs(i) === 0 ? (this.ccmrByte(i) >> 4) & 7 : 0
  }

  private ocpe(i: number): boolean {
    return this.ccs(i) === 0 && (this.ccmrByte(i) & 8) !== 0
  }

  private comPreloaded(i: number): boolean {
    return this.adv && i < 3 && (this.cr2 & CCPC) !== 0
  }

  private sms(): number {
    return this.smcr & 7
  }

  private ts(): number {
    return (this.smcr >> 4) & 7
  }

  private trgoMms(): number {
    return (this.cr2 >> 4) & 7
  }

  private encoder(): boolean {
    const s = this.sms()
    return s >= 1 && s <= 3
  }

  private lockLevel(): number {
    return (this.bdtr >> 8) & 3
  }

  private ccp(i: number): number {
    return (this.ccer >> (4 * i + 1)) & 1
  }

  private mode(): CountMode {
    if (((this.cr1 >> 5) & 3) !== 0 && !this.encoder()) return 'center'
    return this.down ? 'down' : 'up'
  }

  /** the counter is clocked by CK_INT (not by external edges or the encoder) */
  private internalClock(): boolean {
    const s = this.sms()
    return !(this.smcr & ECE) && s !== 7 && !(s >= 1 && s <= 3)
  }

  private active(): boolean {
    return this.clockOn && !this.frozen
  }

  private enabled(): boolean {
    return this.active() && (this.cr1 & CEN) !== 0 && this.arrAct !== 0 && (this.sms() !== 5 || this.gateOpen)
  }

  private counting(): boolean {
    return this.enabled() && this.internalClock() && this.k !== Infinity
  }

  private moeEff(): boolean {
    return (this.bdtr & MOE) !== 0 && !this.frozen
  }

  // ================================================================ lazy counter

  /** Bring the counter to `c`, processing every relevant step on the way at its exact cycle. */
  private advanceTo(c: number): void {
    if (c <= this.anchor) return
    if (!this.counting()) {
      this.anchor = c
      return
    }
    for (;;) {
      const P = this.pscAct + 1
      const e = Math.floor((c - this.anchor) / this.k + 1e-9)
      const total = this.psCnt + e
      const avail = Math.floor(total / P)
      if (avail === 0) {
        this.psCnt = total
        this.anchor += e * this.k
        return
      }
      const rel = this.nextRelevant()
      if (rel > avail) {
        this.lazySteps(avail)
        this.psCnt = total - avail * P
        this.anchor += e * this.k
        return
      }
      if (rel > 1) this.lazySteps(rel - 1)
      const at = this.anchor + (rel * P - this.psCnt) * this.k
      this.anchor = at
      this.psCnt = 0
      this.fullStep(at, null)
      if (!this.counting()) {
        this.anchor = c
        return
      }
    }
  }

  /** CK_CNT steps until the next step that must be processed exactly (Infinity: none). */
  private nextRelevant(): number {
    const m = this.mode()
    const st = { cnt: this.cnt, down: this.down }
    const arr = this.arrAct
    let best = this.wrapRelevant() ? stepsToWrap(m, st, arr) : Infinity
    for (let i = 0; i < 4; i++) if (this.matchRelevant(i)) best = Math.min(best, stepsToEnter(m, st, arr, this.ccrAct[i], 'any'))
    return best
  }

  private refObserved(i: number): boolean {
    return ((this.ccerAct >> (4 * i)) & 0x5) !== 0 || this.trgoMms() === 4 + i
  }

  private wrapRelevant(): boolean {
    if (this.dier & (UIF | UDE)) return true
    if (this.cr1 & OPM) return true
    if (this.trgoMms() === 2) return true
    if (this.preloadPending()) return true
    if (this.adv && this.bdtr & AOE && !(this.bdtr & MOE)) return true
    if (this.cr2 & CCDS && this.dier & 0x1e00) return true
    const pwmEdges = this.mode() !== 'center' || this.cnt > this.arrAct
    if (pwmEdges) {
      for (let i = 0; i < 4; i++) {
        const o = this.ocmAct[i]
        if (this.ccs(i) === 0 && (o === 6 || o === 7) && this.refObserved(i)) return true
      }
    }
    return false
  }

  private preloadPending(): boolean {
    if (this.psc !== this.pscAct) return true
    if (this.cr1 & ARPE && this.arr !== this.arrAct) return true
    for (let i = 0; i < 4; i++) if (this.ocpe(i) && this.ccr[i] !== this.ccrAct[i]) return true
    return false
  }

  private matchRelevant(i: number): boolean {
    if (this.ccs(i) !== 0) return false
    const o = this.ocmAct[i]
    if (o === 1 || o === 2 || o === 3 || o === 6 || o === 7) return true
    if (this.dier & (CC1IF << i)) return true
    if (this.dier & (CC1DE << i) && !(this.cr2 & CCDS)) return true
    return i === 0 && this.trgoMms() === 3
  }

  /** `n` steps nobody observes: move the counter, set the flags they would have set. */
  private lazySteps(n: number): void {
    const m = this.mode()
    const c = { cnt: this.cnt, down: this.down }
    const arr = this.arrAct
    const cms = (this.cr1 >> 5) & 3
    const dir: MatchDir = m === 'center' && cms === 1 ? 'down' : m === 'center' && cms === 2 ? 'up' : 'any'
    for (let i = 0; i < 4; i++) {
      if (this.ccs(i) !== 0 || this.sr & (CC1IF << i) || this.matchRelevant(i)) continue
      if (stepsToEnter(m, c, arr, this.ccrAct[i], dir) <= n) this.sr |= CC1IF << i
    }
    const wraps = advance(m, c, arr, n)
    this.cnt = c.cnt
    this.down = c.down
    if (wraps === 0) return
    let uevs = wraps
    if (this.adv) {
      if (wraps <= this.repCnt) {
        this.repCnt -= wraps
        uevs = 0
      } else {
        const r = wraps - this.repCnt - 1
        const L = this.rcr + 1
        uevs = 1 + Math.floor(r / L)
        this.repCnt = this.rcr - (r % L)
      }
    }
    if (uevs > 0 && !(this.cr1 & UDIS)) this.sr |= UIF
  }

  /** One counter step processed in full at `at` (`dir`: encoder direction). */
  private fullStep(at: number, dir: CountMode | null): void {
    const m = dir ?? this.mode()
    const c = { cnt: this.cnt, down: this.down }
    const r = stepOnce(m, c, this.arrAct)
    this.cnt = c.cnt
    this.down = c.down
    if (r.wrap === 'ovf' || r.wrap === 'unf') this.counterWrap(at)
    for (let i = 0; i < 4; i++) if (this.ccs(i) === 0 && this.cnt === this.ccrAct[i]) this.compareMatch(i, at, r.up)
    this.refreshRefs(at)
    this.updateIrqDma()
  }

  private counterWrap(at: number): void {
    if (this.adv) {
      if (this.repCnt !== 0) {
        this.repCnt--
        return
      }
      this.repCnt = this.rcr
    }
    if (!(this.cr1 & UDIS)) this.updateEvent(at, 'counter')
  }

  /** UEV (§15.3.2): preload transfers, UIF (URS), DMA, TRGO, OPM, AOE. */
  private updateEvent(at: number, src: UpdateSource): void {
    this.pscAct = this.psc
    if (this.cr1 & ARPE) this.arrAct = this.arr
    for (let i = 0; i < 4; i++) if (this.ocpe(i)) this.ccrAct[i] = this.ccr[i]
    if (this.adv && src !== 'counter') this.repCnt = this.rcr
    if (src === 'counter' || !(this.cr1 & URS)) {
      this.sr |= UIF
      if (this.dier & UDE) this.dmaRaise(UDE)
    }
    if (this.cr2 & CCDS) for (let i = 0; i < 4; i++) if (this.dier & (CC1DE << i)) this.dmaRaise(CC1DE << i)
    this.burstIdx = 0
    if (this.trgoMms() === 2) this.trgoPulse(at)
    if (this.adv && this.bdtr & AOE && !(this.bdtr & MOE) && !this.breakActive) {
      this.bdtr |= MOE
      this.applyOutputs(at)
    }
    if (this.cr1 & OPM && this.cr1 & CEN) {
      this.cr1 &= ~CEN
      this.cntEnChanged(at)
    }
  }

  /** UG / slave reset: counter and prescaler re-initialised, update unless UDIS (§15.4.6). */
  private reinit(at: number, src: UpdateSource): void {
    this.psCnt = 0
    this.anchor = at
    if (!(this.cr1 & UDIS)) this.updateEvent(at, src)
    const m = this.mode()
    this.cnt = m === 'down' ? this.arrAct : 0
    if (m === 'center') this.down = false
    if (this.trgoMms() === 0) this.trgoPulse(at)
    this.refreshRefs(at)
  }

  private compareMatch(i: number, at: number, up: boolean): void {
    const o = this.ocmAct[i]
    if (o === 1) this.setRef(i, 1, at)
    else if (o === 2) this.setRef(i, 0, at)
    else if (o === 3) this.setRef(i, this.ref[i] ^ 1, at)
    const cms = this.mode() === 'center' ? (this.cr1 >> 5) & 3 : 0
    // a frozen channel without CCxIE/CCxDE is matched lazily elsewhere: never emit for it, so the
    // TIMn_CCx signal does not depend on which other events happen to be processed exactly
    if (cms === 0 || cms === 3 || (cms === 1 && !up) || (cms === 2 && up)) this.ccEvent(i, at, false, this.matchRelevant(i))
  }

  /** CCx event: CCxIF (CCxOF on a capture over an unread one), DMA, TRGO compare pulse, 'TIMn_CCx'. */
  private ccEvent(i: number, at: number, capture: boolean, signal = true): void {
    const f = CC1IF << i
    if (capture && this.sr & f) this.sr |= CC1OF << i
    this.sr |= f
    if (this.dier & (CC1DE << i) && !(this.cr2 & CCDS)) this.dmaRaise(CC1DE << i)
    if (i === 0 && this.trgoMms() === 3) this.trgoPulse(at)
    if (signal) this.emit(`${this.name}_CC${i + 1}`, at)
  }

  /** CK_PSC edge from an external source (ETR, TRGI, encoder) at `at`. */
  private extTick(at: number, dir: CountMode | null): void {
    if (!this.enabled()) return
    this.advanceTo(at)
    if (++this.psCnt <= this.pscAct) return
    this.psCnt = 0
    this.fullStep(at, dir)
  }

  // ================================================================ scheduling

  private reschedule(): void {
    if (!this.ctx) return
    let at = Infinity
    if (this.counting()) {
      const s = this.nextRelevant()
      if (s !== Infinity) at = this.anchor + (s * (this.pscAct + 1) - this.psCnt) * this.k
    }
    if (at === this.evAt && this.ev) return
    if (this.ev) this.ctx.scheduler.cancel(this.ev)
    this.ev = 0
    this.evAt = at
    if (at !== Infinity) this.ev = this.ctx.scheduler.schedule(at, this.onEvent)
  }

  private onEvent = (c: number): void => {
    this.ev = 0
    this.evAt = -1
    this.advanceTo(c)
    this.reschedule()
    this.updateIrqDma()
  }

  // ================================================================ outputs

  private refreshRefs(at: number): void {
    const m = this.mode()
    const st = { cnt: this.cnt, down: this.down }
    for (let i = 0; i < 4; i++) {
      if (this.ccs(i) !== 0) continue
      const o = this.ocmAct[i]
      if (o === 4) this.setRef(i, 0, at)
      else if (o === 5) this.setRef(i, 1, at)
      else if (o === 6 || o === 7) {
        const a = pwm1Active(m, st, this.arrAct, this.ccrAct[i])
        this.setRef(i, a !== (o === 7) ? 1 : 0, at)
      }
    }
  }

  private complementary(i: number): boolean {
    return this.adv && i < 3 && ((this.ccerAct >> (4 * i)) & 0x5) === 0x5
  }

  /** dead time in core cycles (§14.4.18 DTG, t_DTS from CKD) */
  private deadTime(): number {
    const dtg = this.bdtr & 0xff
    const ckd = Math.min((this.cr1 >> 8) & 3, 2)
    let n: number
    if ((dtg & 0x80) === 0) n = dtg
    else if ((dtg & 0xc0) === 0x80) n = (64 + (dtg & 0x3f)) * 2
    else if ((dtg & 0xe0) === 0xc0) n = (32 + (dtg & 0x1f)) * 8
    else n = (32 + (dtg & 0x1f)) * 16
    return n * this.k * (1 << ckd)
  }

  private setRef(i: number, level: number, at: number): void {
    if (this.ref[i] === level) return
    this.ref[i] = level
    const dt = this.complementary(i) ? this.deadTime() : 0
    if (dt > 0) {
      if (this.dtEv[i]) this.ctx.scheduler.cancel(this.dtEv[i])
      // the rising edge of each output is delayed by the dead time; a shorter pulse vanishes
      if (level) {
        this.dtN[i] = 0
        this.dtEv[i] = this.ctx.scheduler.schedule(at + dt, (c) => {
          this.dtEv[i] = 0
          this.dtP[i] = 1
          this.applyChannel(i, c)
        })
      } else {
        this.dtP[i] = 0
        this.dtEv[i] = this.ctx.scheduler.schedule(at + dt, (c) => {
          this.dtEv[i] = 0
          this.dtN[i] = 1
          this.applyChannel(i, c)
        })
      }
    } else {
      this.dtP[i] = level
      this.dtN[i] = level ^ 1
    }
    if (this.trgoMms() === 4 + i) this.trgoSet(level, at)
    this.applyChannel(i, at)
  }

  /** CCER / COM changed which channels are complementary: their dead-time stages restart from OCxREF. */
  private complementChanged(before: boolean[]): void {
    for (let i = 0; i < 4; i++) {
      if (before[i] === this.complementary(i)) continue
      if (this.dtEv[i]) {
        this.ctx.scheduler.cancel(this.dtEv[i])
        this.dtEv[i] = 0
      }
      this.dtP[i] = this.ref[i]
      this.dtN[i] = this.ref[i] ^ 1
    }
  }

  private applyOutputs(at: number): void {
    for (let i = 0; i < 4; i++) this.applyChannel(i, at)
  }

  /** OCx / OCxN levels per RM0008 Table 83 (TIM1) / Table 87 (TIM2–4). */
  private applyChannel(i: number, at: number): void {
    let oc: 0 | 1 | null = null
    let ocn: 0 | 1 | null = null
    if (this.ccs(i) === 0) {
      const ce = (this.ccerAct >> (4 * i)) & 1
      const cne = this.adv && i < 3 ? (this.ccerAct >> (4 * i + 2)) & 1 : 0
      const p = (this.ccer >> (4 * i + 1)) & 1
      const np = (this.ccer >> (4 * i + 3)) & 1
      const ref = this.ref[i]
      if (!this.adv) {
        if (ce) oc = (ref ^ p) as 0 | 1
      } else if (this.moeEff()) {
        const comp = ce && cne
        const ossr = (this.bdtr & OSSR) !== 0
        if (ce) oc = ((comp ? this.dtP[i] : ref) ^ p) as 0 | 1
        else if (ossr && cne) oc = p as 0 | 1
        if (cne) ocn = ((comp ? this.dtN[i] : ref) ^ np) as 0 | 1
        else if (ossr && ce && i < 3) ocn = np as 0 | 1
      } else if (this.bdtr & OSSI && (ce || cne)) {
        oc = ((this.cr2 >> (8 + 2 * i)) & 1) as 0 | 1
        if (i < 3) ocn = ((this.cr2 >> (9 + 2 * i)) & 1) as 0 | 1
      }
    }
    this.drive(i, oc, at)
    if (this.adv && i < 3) this.drive(4 + i, ocn, at)
  }

  private drive(o: number, level: 0 | 1 | null, at: number): void {
    if (this.outLvl[o] === level) return
    this.outLvl[o] = level
    const pin = this.outPin[o]
    if (pin < 0) {
      if (level !== null) {
        const pn = o < 4 ? this.pinNames.ch[o] : this.pinNames.chn[o - 4]
        const what = o < 4 ? `CH${o + 1}` : `CH${o - 3}N`
        this.warnOnce(`unbonded-${o}-${pn}`, `${this.name}_${what} is mapped to ${pn} in the current AFIO remap, which is not bonded out on the STM32F103C8 (LQFP48): the output goes nowhere`)
      }
      return
    }
    this.ctx.setAfOutput(this.name, pin, level, at)
  }

  private resolvePins(): void {
    const p = this.cfg.pins(this.ctx.remap())
    const out = [...p.ch, ...(p.chn ?? [])].map((n) => this.ctx.pin(n))
    while (out.length < 7) out.push(-1)
    this.pinNames = { ch: p.ch, chn: p.chn ?? [], etr: p.etr, bkin: p.bkin }
    const changed = out.some((pin, o) => pin !== this.outPin[o]) || p.ch.some((n, i) => this.ctx.pin(n) !== this.chPin[i])
    const etr = this.ctx.pin(p.etr)
    const bkin = p.bkin ? this.ctx.pin(p.bkin) : -1
    if (!changed && etr === this.etrPin && bkin === this.bkinPin) return
    const now = this.now()
    for (let o = 0; o < 7; o++) {
      if (out[o] === this.outPin[o]) continue
      if (this.outLvl[o] !== null && this.outPin[o] >= 0) this.ctx.setAfOutput(this.name, this.outPin[o], null, now)
      this.outLvl[o] = null
      this.outPin[o] = out[o]
    }
    this.chPin = p.ch.map((n) => this.ctx.pin(n))
    this.etrPin = etr
    this.bkinPin = bkin
    // inputs restart from the levels of their new pins (no phantom edge)
    this.tiOn = [false, false, false, false]
    this.etrOn = false
    this.applyOutputs(now)
    this.rewireInputs()
  }

  // ================================================================ inputs

  /** Subscribe exactly the pins the current configuration listens to. */
  private rewireInputs(): void {
    if (!this.ctx) return
    const sms = this.sms()
    const ts = this.ts()
    const ti = [false, false, false, false]
    for (let i = 0; i < 4; i++) {
      const s = this.ccs(i)
      if (s === 1) ti[i] = true
      else if (s === 2) ti[i ^ 1] = true
    }
    if (sms >= 1 && sms <= 3) ti[0] = ti[1] = true
    const trgUser = sms !== 0 || this.trcUsed() || (this.adv && (this.cr2 & (CCPC | CCUS)) === (CCPC | CCUS))
    if (trgUser && (ts === 4 || ts === 5)) ti[0] = true
    if (trgUser && ts === 6) ti[1] = true
    const etr = (this.smcr & ECE) !== 0 || (trgUser && ts === 7)
    const bk = this.adv && (this.bdtr & BKE) !== 0
    const want = new Set<number>()
    for (let x = 0; x < 4; x++) {
      if (!ti[x]) continue
      if (x === 0 && this.cr2 & TI1S) for (const pin of this.chPin.slice(0, 3)) want.add(pin)
      else want.add(this.chPin[x])
    }
    if (etr) {
      if (this.etrPin < 0) this.warnOnce(`etr-${this.pinNames.etr}`, `${this.name}_ETR is on ${this.pinNames.etr}, which is not bonded out on the STM32F103C8 (LQFP48): ETR stays low`)
      want.add(this.etrPin)
    }
    if (bk) want.add(this.bkinPin)
    want.delete(-1)
    for (const [pin, u] of this.subs) {
      if (!want.has(pin)) {
        u()
        this.subs.delete(pin)
        this.pinLv.delete(pin)
      }
    }
    for (const pin of want) {
      if (this.subs.has(pin)) continue
      this.pinLv.set(pin, this.ctx.pinLevel(pin))
      this.subs.set(pin, this.ctx.onPinInput(pin, (l, c) => this.pinInput(pin, l, c)))
    }
    // inputs that just became used start from the current level (no edge)
    for (let x = 0; x < 4; x++) {
      if (ti[x] && !this.tiOn[x]) {
        this.tiRaw[x] = this.tiF[x] = this.tiRawLevel(x)
        if (this.tiEv[x]) this.ctx.scheduler.cancel(this.tiEv[x])
        this.tiEv[x] = 0
      }
      this.tiOn[x] = ti[x]
    }
    if (etr && !this.etrOn) this.etrRaw = this.etrF = this.etrRawLevel()
    this.etrOn = etr
    this.bkinOn = bk
  }

  private trcUsed(): boolean {
    for (let i = 0; i < 4; i++) if (this.ccs(i) === 3) return true
    return false
  }

  private pinInput(pin: number, level: 0 | 1, cycle: number): void {
    this.pinLv.set(pin, level)
    for (let x = 0; x < 4; x++) {
      if (!this.tiOn[x]) continue
      const uses = x === 0 && this.cr2 & TI1S ? this.chPin.slice(0, 3).includes(pin) : this.chPin[x] === pin
      if (uses) this.tiRawChanged(x, cycle)
    }
    if (this.etrOn && pin === this.etrPin) this.etrRawChanged(cycle)
    if (this.bkinOn && pin === this.bkinPin) this.bkinChanged(cycle)
  }

  private lv(pin: number): number {
    return pin < 0 ? 0 : (this.pinLv.get(pin) ?? this.ctx.pinLevel(pin))
  }

  private tiRawLevel(x: number): number {
    if (x === 0 && this.cr2 & TI1S) return this.lv(this.chPin[0]) ^ this.lv(this.chPin[1]) ^ this.lv(this.chPin[2])
    return this.lv(this.chPin[x])
  }

  /** filter delay in core cycles for an ICxF / ETF code (sampling-time hold approximation) */
  private filterDelay(code: number): number {
    const [ts, n] = FILTER[code & 15]
    if (n === 0) return 0
    const ckd = Math.min((this.cr1 >> 8) & 3, 2)
    const sample = ts > 0 ? ts : -ts * (1 << ckd)
    return n * sample * this.k
  }

  private tiFilterCode(x: number): number {
    return this.ccs(x) !== 0 ? (this.ccmrByte(x) >> 4) & 15 : 0
  }

  private tiRawChanged(x: number, cycle: number): void {
    const raw = this.tiRawLevel(x)
    if (raw === this.tiRaw[x]) return
    this.tiRaw[x] = raw
    if (this.tiEv[x]) {
      this.ctx.scheduler.cancel(this.tiEv[x])
      this.tiEv[x] = 0
    }
    const d = this.filterDelay(this.tiFilterCode(x))
    if (d === 0 || d === Infinity) this.tiFiltered(x, raw, cycle)
    else if (raw !== this.tiF[x]) {
      this.tiEv[x] = this.ctx.scheduler.schedule(cycle + d, (c) => {
        this.tiEv[x] = 0
        this.tiFiltered(x, raw, c)
      })
    }
  }

  /** a filtered edge on TIx at `at`: captures first (they latch the pre-reset count), then encoder and TRGI */
  private tiFiltered(x: number, level: number, at: number): void {
    if (this.tiF[x] === level) return
    this.tiF[x] = level
    if (!this.active()) return
    for (let i = 0; i < 4; i++) {
      const s = this.ccs(i)
      if ((s === 1 && i === x) || (s === 2 && (i ^ 1) === x)) {
        if ((level ^ this.ccp(i)) === 1) this.capture(i, at)
      }
    }
    const sms = this.sms()
    if (sms >= 1 && sms <= 3 && x <= 1) this.encoderEdge(x, level, at)
    const ts = this.ts()
    if (x === 0 && ts === 4) this.trgiEdge(1, at) // TI1F_ED: a pulse on every TI1F edge
    else if (x === 0 && ts === 5) this.trgiEdge(level ^ this.ccp(0), at)
    else if (x === 1 && ts === 6) this.trgiEdge(level ^ this.ccp(1), at)
    this.reschedule()
    this.updateIrqDma()
  }

  private capture(i: number, at: number): void {
    if (!((this.ccerAct >> (4 * i)) & 1)) return
    const psc = (this.ccmrByte(i) >> 2) & 3
    if (++this.icps[i] < 1 << psc) return
    this.icps[i] = 0
    // the counter as it was before an increment falling on this very cycle
    if (at - 1 > this.anchor) this.advanceTo(at - 1)
    this.ccr[i] = this.ccrAct[i] = this.cnt
    this.ccEvent(i, at, true)
  }

  /** Encoder interface (§15.3.12, Table 87): count on TI1FP1 / TI2FP2 edges by the other signal's level. */
  private encoderEdge(x: number, level: number, at: number): void {
    const sms = this.sms()
    const a = this.tiF[0] ^ this.ccp(0)
    const b = this.tiF[1] ^ this.ccp(1)
    const rising = (level ^ this.ccp(x)) === 1
    let down: boolean | null = null
    if (x === 0 && (sms === 2 || sms === 3)) down = rising ? b === 1 : b === 0
    if (x === 1 && (sms === 1 || sms === 3)) down = rising ? a === 0 : a === 1
    if (down === null) return
    this.extTick(at, down ? 'down' : 'up')
  }

  private etrRawLevel(): number {
    return this.lv(this.etrPin) ^ (this.smcr & ETP ? 1 : 0)
  }

  private etrRawChanged(cycle: number): void {
    if (!this.etrOn) return
    const raw = this.etrRawLevel()
    if (raw === this.etrRaw) return
    this.etrRaw = raw
    if (this.etrEv) {
      this.ctx.scheduler.cancel(this.etrEv)
      this.etrEv = 0
    }
    const d = this.filterDelay((this.smcr >> 8) & 15)
    if (d === 0 || d === Infinity) this.etrFiltered(raw, cycle)
    else if (raw !== this.etrF) {
      this.etrEv = this.ctx.scheduler.schedule(cycle + d, (c) => {
        this.etrEv = 0
        this.etrFiltered(raw, c)
      })
    }
  }

  private etrFiltered(level: number, at: number): void {
    if (this.etrF === level) return
    this.etrF = level
    if (!this.active()) return
    const ts = this.ts()
    const sms = this.sms()
    if (level && ++this.etpsCnt >= 1 << ((this.smcr >> 12) & 3)) {
      this.etpsCnt = 0
      if (this.smcr & ECE) this.extTick(at, null) // external clock mode 2
      if (ts === 7 && sms !== 5) this.trgiEdge(1, at)
    }
    if (ts === 7 && sms === 5) this.trgiEdge(level, at)
    this.reschedule()
    this.updateIrqDma()
  }

  private trgiLevel(): number {
    const ts = this.ts()
    if (ts <= 3) return this.itrLevel
    if (ts === 5) return this.tiF[0] ^ this.ccp(0)
    if (ts === 6) return this.tiF[1] ^ this.ccp(1)
    if (ts === 7) return this.etrF
    return 0
  }

  /** TRGI edge (rising = 1) at `at`: slave mode controller, TRC captures, COM (§15.3.14, §14.3.14). */
  private trgiEdge(level: number, at: number): void {
    if (!this.active()) return
    // TRC captures latch the count before the slave mode acts (as TI1/TI2 captures do)
    if (level === 1) for (let i = 0; i < 4; i++) if (this.ccs(i) === 3) this.capture(i, at)
    this.advanceTo(at)
    const sms = this.sms()
    if (sms === 5) {
      this.triggerFlag()
      if (this.gateOpen !== (level === 1)) {
        this.gateOpen = level === 1
        this.anchor = at
        this.cntEnChanged(at)
      }
    } else if (level === 1) {
      if (sms >= 4) this.triggerFlag()
      if (sms === 4) this.reinit(at, 'slave')
      else if (sms === 6 && !(this.cr1 & CEN)) {
        this.cr1 |= CEN
        this.anchor = at
        this.cntEnChanged(at)
      } else if (sms === 7 && !(this.smcr & ECE)) this.extTick(at, null)
      if (this.adv && (this.cr2 & (CCPC | CCUS)) === (CCPC | CCUS)) this.comEvent(at)
    }
    this.reschedule()
    this.updateIrqDma()
  }

  private triggerFlag(): void {
    this.sr |= TIF
    if (this.dier & TDE) this.dmaRaise(TDE)
  }

  /** Subscribe to the master selected by TS when a slave function uses ITRx. */
  private rewireTriggers(): void {
    if (!this.ctx) return
    const ts = this.ts()
    const need = ts <= 3 && (this.sms() !== 0 || this.trcUsed() || (this.adv && (this.cr2 & (CCPC | CCUS)) === (CCPC | CCUS)))
    const master = need ? this.cfg.itr[ts] : null
    const key = need ? `${ts}:${master ?? '-'}` : ''
    if (key === this.itrKey) return
    for (const u of this.itrUnsub) u()
    this.itrUnsub = []
    this.itrKey = key
    this.itrLevel = 0
    if (!need) return
    if (!master) {
      this.warnOnce(`itr${ts}`, `${this.name} ITR${ts} is not connected on the STM32F103C8 (its master would be TIM5 or TIM8, which this device does not have): no trigger will arrive`)
      return
    }
    if (!this.ctx.onTrigger) {
      this.warnOnce('itr-routing', `${this.name} slave mode on ITR${ts} (${master}_TRGO) needs inter-peripheral trigger routing, which this SoC model does not provide`)
      return
    }
    this.itrUnsub.push(
      this.ctx.onTrigger(`${master}_TRGO`, (c) => {
        this.itrLevel = 1
        this.trgiEdge(1, c)
      }),
      this.ctx.onTrigger(`${master}_TRGO_FALL`, (c) => {
        this.itrLevel = 0
        if (this.sms() === 5) this.trgiEdge(0, c)
      }),
    )
  }

  // ================================================================ TIM1 break / COM / MOE hint

  private bkinChanged(cycle: number): void {
    if (!this.adv) return
    const on = this.bkinOn && this.bkinPin >= 0 && this.lv(this.bkinPin) === (this.bdtr & BKP ? 1 : 0)
    if (on === this.breakActive) return
    this.breakActive = on
    if (on) this.breakEvent(cycle)
    this.updateIrqDma()
  }

  private breakEvent(at: number): void {
    this.bdtr &= ~MOE
    this.sr |= BIF
    this.applyOutputs(at)
    this.updateIrqDma()
  }

  private comEvent(at: number): void {
    if (this.cr2 & CCPC) {
      const before = [0, 1, 2, 3].map((i) => this.complementary(i))
      this.ccerAct = (this.ccerAct & ~0x555) | (this.ccer & 0x555)
      for (let i = 0; i < 3; i++) this.ocmAct[i] = this.ocm(i)
      this.complementChanged(before)
      this.refreshRefs(at)
      this.applyOutputs(at)
    }
    this.sr |= COMIF
    if (this.dier & COMDE) this.dmaRaise(COMDE)
  }

  private moeHintCond(): boolean {
    if (!this.adv || !this.clockOn || !(this.cr1 & CEN) || this.bdtr & (MOE | AOE) || this.breakActive) return false
    for (let i = 0; i < 4; i++) if (this.ccs(i) === 0 && (this.ccerAct >> (4 * i)) & 0x5) return true
    return false
  }

  /** The classic TIM1 mistake: outputs enabled, counter running, MOE never set. Logged once, 1 ms after. */
  private moeHint(): void {
    if (!this.ctx || this.moeHintEv || this.warned.has('moe') || !this.moeHintCond()) return
    this.moeHintEv = this.ctx.scheduler.schedule(this.now() + this.ctx.cyclesPerTick(1000), () => {
      this.moeHintEv = 0
      if (!this.moeHintCond()) return
      this.warnOnce(
        'moe',
        `${this.name} is counting with CCxE/CCxNE set but BDTR.MOE = 0: an advanced-control timer keeps its outputs disabled until the main output enable is set (RM0008 §14.4.18). HAL_TIM_PWM_Start() sets it; register-level code needs TIM1->BDTR |= TIM_BDTR_MOE.`,
      )
    })
  }

  // ================================================================ TRGO / IRQ / DMA

  private emit(signal: string, at: number): void {
    if (!this.ctx.emitTrigger) return
    if (triggerDepth >= MAX_TRIGGER_DEPTH) {
      this.warnOnce('trg-loop', `${this.name}: trigger chain deeper than ${MAX_TRIGGER_DEPTH} timers (a master/slave loop?) — further triggers in this cycle are dropped`)
      return
    }
    triggerDepth++
    try {
      this.ctx.emitTrigger(signal, at)
    } finally {
      triggerDepth--
    }
  }

  private trgoPulse(at: number): void {
    if (this.trgoHigh) return
    this.emit(this.name + '_TRGO', at)
    this.emit(this.name + '_TRGO_FALL', at)
  }

  private trgoSet(level: number, at: number): void {
    if (level === this.trgoHigh) return
    this.trgoHigh = level
    this.emit(this.name + (level ? '_TRGO' : '_TRGO_FALL'), at)
  }

  private trgoRecompute(at: number): void {
    const mms = this.trgoMms()
    if (mms === 1) this.trgoSet(this.cr1 & CEN || (this.sms() === 5 && this.gateOpen) ? 1 : 0, at)
    else if (mms >= 4) this.trgoSet(this.ref[mms - 4], at)
    else this.trgoSet(0, at)
  }

  private cntEnChanged(at: number): void {
    if (this.trgoMms() === 1) this.trgoRecompute(at)
    this.moeHint()
  }

  private dmaChannel(bit: number): number {
    const d = this.cfg.dma
    if (bit === UDE) return d.up
    if (bit === TDE) return d.trig
    if (bit === COMDE) return d.com
    for (let i = 0; i < 4; i++) if (bit === CC1DE << i) return d.cc[i]
    return 0
  }

  private dmaRaise(bit: number): void {
    if (!this.dmaChannel(bit)) return
    this.dmaPend |= bit
  }

  private updateIrqDma(): void {
    if (!this.ctx) return
    const f = this.sr & this.dier & 0xff
    const q = this.cfg.irq
    if (this.adv) {
      this.line(q.brk, (f & BIF) !== 0)
      this.line(q.up, (f & UIF) !== 0)
      this.line(q.trgCom, (f & (TIF | COMIF)) !== 0)
      this.line(q.cc, (f & 0x1e) !== 0)
    } else this.line(q.up, f !== 0)
    const want = new Set<number>()
    for (let b = 8; b <= 14; b++) if (this.dmaPend & (1 << b)) want.add(this.dmaChannel(1 << b))
    want.delete(0)
    for (const ch of this.dmaOn) {
      if (!want.has(ch)) {
        this.dmaOn.delete(ch)
        this.ctx.dmaRequest(ch, false)
      }
    }
    for (const ch of want) {
      if (!this.dmaOn.has(ch)) {
        this.dmaOn.add(ch)
        this.ctx.dmaRequest(ch, true)
      }
    }
  }

  private line(irq: number, on: boolean): void {
    if ((this.irqOn.get(irq) ?? false) === on) return
    this.irqOn.set(irq, on)
    this.ctx.setIrq(irq, on)
  }

  /** DMAR: the register DBA + index of the current burst (§15.4.18; partial — see header). */
  private burstOffset(): number {
    const dba = this.dcr & 0x1f
    const dbl = (this.dcr >> 8) & 0x1f
    const off = (dba + this.burstIdx) * 4
    this.burstIdx = this.burstIdx >= dbl ? 0 : this.burstIdx + 1
    return off
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.ctx.log('warning', this.name, msg)
  }
}
