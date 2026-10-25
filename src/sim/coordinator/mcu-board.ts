/**
 * MCU board chip adapter — catalog parts with sim {kind:'chip', model:'mcu-board'}
 * and an `entry.mcu` spec (STM32 Blue Pill …).
 *
 * The adapter is the ELECTRICAL face of an `McuDevice` inside SimEngine:
 *  - stamps every mapped GPIO as a CMOS output stage against the board's own
 *    rails (VDD = entry.mcu.vddPin, VSS = gndPin) from McuPinPort.drive()
 *    with STM32F1_GPIO: push-pull 50 Ω to VDD / VSS, open-drain 50 Ω to VSS
 *    or released, 40 kΩ pull-up/down, high-Z for input/analog
 *    (DS5319 §5.3.13–5.3.14); duty-weighted averaging for edges denser than
 *    the analog step (see ./stage);
 *  - resolves inputs from the solved pin voltages with the datasheet VIL/VIH
 *    and Schmitt hysteresis and calls pins.setInput(level, volts);
 *  - supervises power: POR at VDD ≥ 2.0 V rising, PDR at VDD < 1.8 V falling
 *    (DS5319 Table 10 bounds: V_POR rising ≤ 2.0 V, V_PDR falling ≥ 1.8 V);
 *  - NRST: internal 40 kΩ pull-up (R_PU, DS5319 Table 47) + Schmitt input
 *    (VIL 0.8 V / VIH 2.0 V) → McuDevice.setResetPin;
 *  - BOOT0 jumper: sampled at reset (RM0008 §3.4). Models that model the
 *    boot straps (an optional `setBootPins(boot0, boot1)`, e.g. Stm32f103)
 *    get the jumper and decide themselves (the STM32 model idles in a stub
 *    and logs that the system-memory bootloader is not emulated); for any
 *    other model BOOT0 = 1 holds the MCU in reset with an explicit warning —
 *    user code never silently runs from the wrong boot space;
 *  - analog reference: models with `setSupplyVoltage` (the STM32 model's
 *    ADC VDDA = VREF+) get the solved VDD whenever it moves by > 20 µV;
 *  - test fixture: an external stimulus driver on a header pin (./stimulus)
 *    is stamped as an extra stage against the same rails (`setFixture`);
 *  - the UART terminal's USB-TTL adapter (./uart-adapter) on a USART RX pin
 *    is stamped as a Norton source of 3.3 V above the board's GND
 *    (`setSource`) — powered from USB, not from the board's regulator;
 *  - warnings (deduplicated, once per pin and condition): overvoltage
 *    (> VDD+0.3 V standard / > 5.5 V FT, DS5319 Table 7), driver
 *    overcurrent / short (> 25 mA from the solved pin voltage and the drive
 *    Thevenin), floating input, MCU unpowered, no firmware.
 *
 * The McuDevice itself is owned by the SimulationCoordinator and survives
 * engine rebuilds: the chip factory runs on EVERY SimEngine construction and
 * creates an unbound adapter; the coordinator binds it by component id.
 * Unbound (plain SimEngine, or no MCU model registered) the board still
 * works electrically — regulator and LEDs come from CatalogEntry.subcircuit —
 * and reports 'no-firmware'.
 */
import { registerChip } from '../chip-api'
import type { ChipInstance, ChipStepCtx } from '../chip-api'
import type {
  ComponentInstance,
  ComponentTelemetry,
  McuTelemetry,
  ParamValue,
} from '../../model/types'
import { getEntry, paramOf } from '../../model/catalog'
import type { CatalogEntry, McuBoardSpec } from '../../model/catalog'
import type { McuDevice } from '../../mcu/mcu-api'
import {
  PIN_ANALOG,
  PIN_IN_FLOAT,
  PIN_IN_PULLDOWN,
  PIN_IN_PULLUP,
  PIN_OUT_OD,
  PIN_OUT_PP,
  STM32F1_GPIO,
} from '../../mcu/pins'
import type { GpioElectrical, PinMode } from '../../mcu/pins'
import { StageHistory } from './stage'

export const MCU_BOARD_MODEL = 'mcu-board'

/** POR threshold, VDD rising (V) — DS5319 Table 10 V_POR/PDR rising max. */
export const MCU_POR_V = 2.0
/** PDR threshold, VDD falling (V) — DS5319 Table 10 V_POR/PDR falling min. */
export const MCU_PDR_V = 1.8
/** NRST input thresholds (V) — DS5319 Table 47 VIL(NRST) max / VIH(NRST) min. */
const NRST_VIL = 0.8
const NRST_VIH = 2.0
/** NRST internal pull-up (Ω) — DS5319 Table 47 R_PU typ. */
const NRST_RPU = 40_000
/** Below this many siemens to anything but the pin itself, a net is floating (> 1 MΩ). */
const FLOAT_G = 1e-6
/** A connected input must stay floating this long (s, MCU running) before it is reported —
 * every GPIO is a floating input out of reset until firmware configures it. */
const FLOAT_REPORT_AFTER = 0.1
/** Pin under-voltage limit relative to VSS (V) — DS5319 Table 7 VIN min. */
const VIN_MIN = -0.3

// per-pin reported-condition bits
const R_OVER = 1
const R_UNDER = 2
const R_CURRENT = 4
const R_FLOAT = 8

/** State that must outlive one adapter (kept by the coordinator per MCU). */
export interface McuBoardState {
  /** McuDevice.setResetPin level last applied (null = unknown → re-apply) */
  resetHeld: boolean | null
  /** BOOT0 value latched at the last reset */
  boot0Latched: boolean
  /** NRST Schmitt state (true = pin reads high) */
  nrstHigh: boolean
  /**
   * GPIO Schmitt-trigger state per catalog pin (the adapter's `inLevel`):
   * a rebuilt adapter continues from it, so a hot rewire neither loses the
   * hysteresis state nor starts every input at 0.
   */
  inLevel?: Uint8Array
}

/** Optional McuDevice extension: boot strap pins sampled at the next reset. */
interface BootStrapped {
  setBootPins(boot0: 0 | 1, boot1?: 0 | 1): void
}

function bootStrapsOf(mcu: McuDevice | null): BootStrapped | null {
  const m = mcu as (McuDevice & Partial<BootStrapped>) | null
  return m && typeof m.setBootPins === 'function' ? (m as unknown as BootStrapped) : null
}

/**
 * Optional McuDevice extension: the solved board supply (V). On a Blue Pill
 * VDDA is tied to VDD and the LQFP48 bonds VREF+ to VDDA (RM0008 §11.1), so
 * this is the ADC full-scale reference (Stm32f103.setSupplyVoltage).
 */
interface SupplySensing {
  setSupplyVoltage(vdd: number): void
}

function supplySensingOf(mcu: McuDevice | null): SupplySensing | null {
  const m = mcu as (McuDevice & Partial<SupplySensing>) | null
  return m && typeof m.setSupplyVoltage === 'function' ? (m as unknown as SupplySensing) : null
}

/** Report VDD to the model when it moved by more than this (V): 0.025 LSB of a 12-bit ADC at 3.3 V. */
const VDD_REPORT_STEP = 20e-6

/** Services the SimulationCoordinator provides to a bound adapter. */
export interface McuBoardEnv {
  /** exact interval [t0, t1] of the analog step about to run */
  readonly t0: number
  readonly t1: number
  /** the logic layer pushes this catalog pin's input (logic-resolvable net) */
  logicManaged(index: number): boolean
  /** resolved voltage of a logic-managed pin's net (NaN when floating / contention) */
  logicVoltage(index: number): number
  /** re-publish every logic-managed pin's stage drive to the logic layer */
  syncLogicDrives(): void
  /** something besides this pin and probes is attached to the pin's net */
  hasExternal(index: number): boolean
  /** stamped conductance of the pin's net in the last step, NaN when not diagnosed */
  conductance(index: number): number
  /** current coordinator realtime factor (telemetry) */
  realtime(): number
  /** coordinator log (info lines, e.g. power events) */
  log(level: 'info' | 'warning' | 'error', message: string): void
  /** the analog step ending at t1 diagnosed node conductances */
  readonly diagFresh: boolean
}

function tagOf(mode: PinMode, af: boolean): string {
  switch (mode) {
    case PIN_ANALOG:
      return 'an'
    case PIN_IN_FLOAT:
      return 'in'
    case PIN_IN_PULLUP:
      return 'in↑'
    case PIN_IN_PULLDOWN:
      return 'in↓'
    case PIN_OUT_PP:
      return af ? 'af' : 'out'
    case PIN_OUT_OD:
      return af ? 'af-od' : 'od'
    default:
      return 'in'
  }
}

export class McuBoardChip implements ChipInstance {
  readonly entry: CatalogEntry | null
  readonly spec: McuBoardSpec | null
  readonly gpio: GpioElectrical = STM32F1_GPIO
  /** catalog pin indices of the GPIO pins mapped by spec.pinMap */
  readonly mapped: Int32Array
  /** MCU port pin name per catalog pin ('' when not an MCU pin) */
  readonly portName: string[]
  readonly vddIdx: number
  readonly gndIdx: number
  readonly nrstIdx: number
  /** catalog pin is five-volt tolerant (pinInfo.ft) */
  readonly ft: Uint8Array
  readonly hist: StageHistory

  mcu: McuDevice | null = null
  /** catalog index → MCU pin index (-1 = not an MCU pin) */
  mcuPinOf: Int32Array
  /** MCU pin index → catalog index (-1 = not on the board headers) */
  catalogOf: Int32Array = new Int32Array(0)

  /** cached drive per catalog pin (updated from pinDriveChanged) */
  readonly mode: Uint8Array
  readonly level: Uint8Array
  readonly af: Uint8Array
  /** Schmitt-trigger input level per catalog pin */
  readonly inLevel: Uint8Array
  /** stage conductances stamped in the last step (duty-averaged) */
  readonly stampUp: Float64Array
  readonly stampDown: Float64Array
  /**
   * External test-fixture drive per catalog pin (./stimulus.ts): a stage
   * against the board's VDD / VSS rails stamped IN ADDITION to the MCU's own
   * stage. Kept apart so driver-current checks see only the MCU's stage.
   */
  readonly fixture: StageHistory
  private readonly fixUp: Float64Array
  private readonly fixDown: Float64Array
  private fixtureUsed = false
  /**
   * External SOURCE drive per catalog pin — the UART terminal's USB-TTL
   * adapter (./uart-adapter): `up` (S) to a fixed level `sourceVoh` above
   * the board's GND, `down` (S) to that GND, stamped as a Norton drive
   * (ChipStepCtx.drivePinAt) in addition to the MCU's stage and the
   * fixture. The adapter is powered from USB, not from the board's
   * regulator, so its current never flows through the board's VDD.
   */
  readonly source: StageHistory
  private readonly srcUp: Float64Array
  private readonly srcDown: Float64Array
  private sourceUsed = false
  /** high level of the source drive above the board's GND (V) */
  sourceVoh = 3.3

  /** last solved VDD − VSS of the board (V) */
  vdd = 0
  /** VDD last reported to the model (SupplySensing), NaN = never */
  private vddReported = NaN
  powered = false
  private state: McuBoardState = { resetHeld: null, boot0Latched: false, nrstHigh: true }
  private boot0 = false
  private env: McuBoardEnv | null = null
  private coordinated = false
  private ctx: ChipStepCtx | null = null
  private solves = 0
  private readonly reported: Uint8Array
  private readonly floatSince: Float64Array
  private boardFlags = 0

  constructor(readonly comp: ComponentInstance) {
    const entry = getEntry(comp.type) ?? null
    this.entry = entry
    this.spec = entry?.mcu ?? null
    const pins = entry?.pins ?? []
    const n = pins.length
    this.portName = pins.map((p) => this.spec?.pinMap[p] ?? '')
    const mapped: number[] = []
    for (let i = 0; i < n; i++) if (this.portName[i]) mapped.push(i)
    this.mapped = Int32Array.from(mapped)
    this.vddIdx = this.spec ? pins.indexOf(this.spec.vddPin) : -1
    this.gndIdx = this.spec ? pins.indexOf(this.spec.gndPin) : -1
    this.nrstIdx = this.spec?.resetPin ? pins.indexOf(this.spec.resetPin) : -1
    this.ft = new Uint8Array(n)
    for (const info of entry?.pinInfo ?? []) {
      const i = pins.indexOf(info.pin)
      if (i >= 0 && info.ft) this.ft[i] = 1
    }
    this.hist = new StageHistory(n)
    this.mcuPinOf = new Int32Array(n).fill(-1)
    this.mode = new Uint8Array(n).fill(PIN_IN_FLOAT)
    this.level = new Uint8Array(n)
    this.af = new Uint8Array(n)
    this.inLevel = new Uint8Array(n)
    this.stampUp = new Float64Array(n)
    this.stampDown = new Float64Array(n)
    this.fixture = new StageHistory(n)
    this.fixUp = new Float64Array(n)
    this.fixDown = new Float64Array(n)
    this.source = new StageHistory(n)
    this.srcUp = new Float64Array(n)
    this.srcDown = new Float64Array(n)
    this.reported = new Uint8Array(n)
    this.floatSince = new Float64Array(n).fill(NaN)
    this.boot0 = entry ? paramOf(comp.params, entry, 'boot0') === '1' : false
    this.state.boot0Latched = this.boot0
  }

  // ------------------------------------------------------------- binding

  /**
   * Attach the coordinator-owned McuDevice (null = no model available) and
   * the coordinator services. `state` persists across engine rebuilds.
   */
  bind(mcu: McuDevice | null, env: McuBoardEnv, state: McuBoardState, t: number): void {
    this.mcu = mcu
    this.env = env
    this.coordinated = true
    this.state = state
    // continue the Schmitt state of the previous adapter (hot rewire)
    if (state.inLevel && state.inLevel.length === this.inLevel.length) this.inLevel.set(state.inLevel)
    state.inLevel = this.inLevel
    this.catalogOf = new Int32Array(mcu ? mcu.pins.pinCount : 0).fill(-1)
    this.mcuPinOf.fill(-1)
    if (mcu) {
      for (let j = 0; j < this.mapped.length; j++) {
        const i = this.mapped[j]
        const p = mcu.pins.pinIndex(this.portName[i])
        if (p < 0 || p >= this.catalogOf.length) continue
        this.mcuPinOf[i] = p
        this.catalogOf[p] = i
      }
      this.powered = mcu.powered
      bootStrapsOf(mcu)?.setBootPins(this.boot0 ? 1 : 0)
    } else {
      this.powered = false
    }
    this.refreshDrives(t, true)
  }

  get bound(): boolean {
    return this.coordinated
  }

  /** Stage conductances of a drive state (released while unpowered). */
  private stageOf(mode: number, level: number): [number, number] {
    const gs = 1 / this.gpio.routStrong
    const gp = 1 / this.gpio.rPull
    switch (mode) {
      case PIN_IN_PULLUP:
        return [gp, 0]
      case PIN_IN_PULLDOWN:
        return [0, gp]
      case PIN_OUT_PP:
        return level ? [gs, 0] : [0, gs]
      case PIN_OUT_OD:
        return level ? [0, 0] : [0, gs]
      default:
        return [0, 0]
    }
  }

  /** Re-read every pin drive (power transitions, binding). */
  refreshDrives(t: number, initial = false): void {
    const mcu = this.mcu
    const live = mcu !== null && this.powered && mcu.powered
    for (let j = 0; j < this.mapped.length; j++) {
      const i = this.mapped[j]
      const p = this.mcuPinOf[i]
      let up = 0
      let down = 0
      if (mcu && p >= 0) {
        const d = mcu.pins.drive(p)
        this.mode[i] = d.mode
        this.level[i] = d.level
        this.af[i] = d.af ? 1 : 0
        if (live) [up, down] = this.stageOf(d.mode, d.level)
      } else {
        this.mode[i] = PIN_IN_FLOAT
        this.level[i] = 0
        this.af[i] = 0
      }
      if (initial) this.hist.set(i, up, down)
      else this.hist.record(i, t, up, down)
    }
    // models need not report every pin on power transitions: resync the logic layer
    if (!initial) this.env?.syncLogicDrives()
  }

  /**
   * McuPinListener path (called by the coordinator inside McuDevice.runUntil):
   * MCU pin `pin` changed drive at virtual time `t`. Returns the catalog pin
   * index, or -1 when the pin is not on the board headers.
   */
  onDrive(pin: number, t: number): number {
    const i = pin >= 0 && pin < this.catalogOf.length ? this.catalogOf[pin] : -1
    if (i < 0 || !this.mcu) return -1
    const d = this.mcu.pins.drive(pin)
    this.mode[i] = d.mode
    this.level[i] = d.level
    this.af[i] = d.af ? 1 : 0
    let up = 0
    let down = 0
    if (this.powered && this.mcu.powered) [up, down] = this.stageOf(d.mode, d.level)
    this.hist.record(i, t, up, down)
    return i
  }

  /**
   * External fixture drive on catalog pin i from virtual time `t` on: `up`
   * (S, to the board VDD) / `down` (S, to VSS). `initial` = binding (no
   * history). The coordinator owns the stimulus state; this only stamps it.
   */
  setFixture(i: number, t: number, up: number, down: number, initial = false): void {
    if (!(i >= 0 && i < this.fixUp.length)) return
    if (up > 0 || down > 0) this.fixtureUsed = true
    if (initial) this.fixture.set(i, up, down)
    else this.fixture.record(i, t, up, down)
  }

  /**
   * External source drive on catalog pin i from virtual time `t` on (the
   * terminal's USB-TTL adapter): `up` (S, to `sourceVoh` above the board's
   * GND) / `down` (S, to the GND); (0, 0) = released. `initial` = binding.
   */
  setSource(i: number, t: number, up: number, down: number, initial = false): void {
    if (!(i >= 0 && i < this.srcUp.length)) return
    if (up > 0 || down > 0) this.sourceUsed = true
    if (initial) this.source.set(i, up, down)
    else this.source.record(i, t, up, down)
  }

  /** Current stage conductances of catalog pin i (logic layer). */
  stageUp(i: number): number {
    return this.hist.up[i]
  }
  stageDown(i: number): number {
    return this.hist.down[i]
  }

  /**
   * The level a logic analyzer sees on catalog pin i: the driven level for
   * an active output, otherwise the Schmitt input level. 2 = undefined
   * (analog mode, MCU unpowered).
   */
  pinLevel(i: number): 0 | 1 | 2 {
    if (!this.mcu || !this.powered) return 2
    const m = this.mode[i]
    if (m === PIN_OUT_PP) return this.level[i] ? 1 : 0
    if (m === PIN_OUT_OD && this.level[i] === 0) return 0
    if (m === PIN_ANALOG) return 2
    return this.inLevel[i] ? 1 : 0
  }

  /** True when catalog pin i actively drives its net (push-pull, or open-drain low). */
  drivesStrongly(i: number): boolean {
    if (!this.mcu || !this.powered) return false
    const m = this.mode[i]
    return m === PIN_OUT_PP || (m === PIN_OUT_OD && this.level[i] === 0)
  }

  // ------------------------------------------------------------ stepping

  step(ctx: ChipStepCtx): void {
    this.ctx = ctx
    if (!ctx.drivePinStageAt || !ctx.setRailPins) {
      ctx.reportIssue?.('error', `${this.comp.id}: MCU board needs the SimEngine chip context — excluded`)
      return
    }
    ctx.setRailPins(this.vddIdx, this.gndIdx)
    if (!this.coordinated) {
      // plain SimEngine: observe the previous solution (none before the first solve)
      if (this.solves > 0) this.observe(ctx.time)
      this.solves++
    }
    const env = this.env
    const t0 = env ? env.t0 : ctx.time
    const t1 = env ? env.t1 : ctx.time + ctx.dt
    this.hist.average(t0, t1, this.stampUp, this.stampDown)
    if (this.fixtureUsed) {
      // an external fixture drive (test stimulus) on the same node, same rails
      this.fixture.average(t0, t1, this.fixUp, this.fixDown)
      for (let j = 0; j < this.mapped.length; j++) {
        const i = this.mapped[j]
        ctx.drivePinStageAt(i, this.stampUp[i] + this.fixUp[i], this.stampDown[i] + this.fixDown[i])
      }
      this.fixture.commit(t1)
    } else {
      for (let j = 0; j < this.mapped.length; j++) {
        const i = this.mapped[j]
        ctx.drivePinStageAt(i, this.stampUp[i], this.stampDown[i])
      }
    }
    if (this.sourceUsed && ctx.drivePinAt) {
      // the terminal's USB-TTL adapter: a Norton drive of the duty-averaged
      // level (sourceVoh · up / (up + down) above the board's GND) behind
      // the averaged conductance — exact when no edge falls inside the step
      this.source.average(t0, t1, this.srcUp, this.srcDown)
      const vg = this.read(this.gndIdx)
      const vGnd = Number.isFinite(vg) ? vg : 0
      for (let j = 0; j < this.mapped.length; j++) {
        const i = this.mapped[j]
        const g = this.srcUp[i] + this.srcDown[i]
        if (g > 0) ctx.drivePinAt(i, vGnd + (this.sourceVoh * this.srcUp[i]) / g, 1 / g)
        else ctx.drivePinAt(i, 0, 0)
      }
      this.source.commit(t1)
    }
    if (this.nrstIdx >= 0) ctx.drivePinStageAt(this.nrstIdx, 1 / NRST_RPU, 0)
    this.hist.commit(t1)
  }

  private read(i: number): number {
    const ctx = this.ctx
    if (!ctx || !ctx.readPinAt || i < 0) return NaN
    return ctx.readPinAt(i)
  }

  /**
   * Consume the latest analog solution (the coordinator calls this right
   * after every engine step; the MCU is at virtual time `now`): power
   * supervision, NRST, inputs, electrical checks.
   */
  observe(now: number): void {
    const ctx = this.ctx
    if (!ctx || !this.spec) return
    const vGndRaw = this.read(this.gndIdx)
    const vGnd = Number.isFinite(vGndRaw) ? vGndRaw : 0
    const vddRaw = this.read(this.vddIdx) - vGnd
    const vdd = Number.isFinite(vddRaw) ? vddRaw : 0
    this.vdd = vdd
    const mcu = this.mcu
    const id = this.comp.id

    // ---- power supervisor (POR / PDR with hysteresis)
    if (!this.powered && vdd >= MCU_POR_V) {
      this.powered = true
      this.state.boot0Latched = this.boot0 // BOOT pins are sampled on reset exit
      if (mcu) {
        mcu.setPowered(true)
        this.env?.log('info', `${id}: VDD ${vdd.toFixed(2)} V — power-on reset`)
      }
      this.refreshDrives(now)
    } else if (this.powered && vdd < MCU_PDR_V) {
      this.powered = false
      if (mcu) {
        mcu.setPowered(false)
        this.env?.log('warning', `${id}: VDD fell to ${vdd.toFixed(2)} V — brown-out, MCU held in reset`)
      }
      this.refreshDrives(now)
    }
    // ---- analog reference: the solved VDD (VDDA = VREF+ on this board)
    if (mcu && this.powered && !(Math.abs(vdd - this.vddReported) <= VDD_REPORT_STEP)) {
      const sink = supplySensingOf(mcu)
      if (sink) {
        this.vddReported = vdd
        sink.setSupplyVoltage(vdd)
      }
    }

    // ---- NRST (internal pull-up + Schmitt) and the BOOT0 hold
    if (this.nrstIdx >= 0) {
      const vr = this.read(this.nrstIdx) - vGnd
      if (Number.isFinite(vr)) {
        const wasHigh = this.state.nrstHigh
        if (wasHigh && vr < NRST_VIL) this.state.nrstHigh = false
        else if (!wasHigh && vr > NRST_VIH) {
          this.state.nrstHigh = true
          this.state.boot0Latched = this.boot0
        }
      }
    }
    const nativeBoot = bootStrapsOf(mcu) !== null
    const hold = !this.state.nrstHigh || (!nativeBoot && this.state.boot0Latched)
    if (mcu && hold !== this.state.resetHeld) {
      this.state.resetHeld = hold
      mcu.setResetPin(hold)
      if (!nativeBoot && this.state.boot0Latched && this.state.nrstHigh) {
        ctx.reportIssue?.(
          'warning',
          `${id}: BOOT0 = 1 selects the system-memory bootloader, which is not emulated — MCU held in reset (set BOOT0 = 0 and reset)`,
        )
      }
    }

    // ---- board-level status warnings (once)
    if (!mcu) {
      if ((this.boardFlags & 1) === 0) {
        this.boardFlags |= 1
        ctx.reportIssue?.(
          'warning',
          this.coordinated
            ? `${id}: MCU model "${this.spec.model}" is not available in this build — board simulated electrically only`
            : `${id}: no firmware loaded — board simulated electrically only`,
        )
      }
    } else if (!mcu.firmware) {
      if ((this.boardFlags & 2) === 0) {
        this.boardFlags |= 2
        ctx.reportIssue?.(
          'warning',
          `${id}: no firmware loaded — load an ELF/BIN/HEX; the board is simulated electrically only`,
        )
      }
    } else if (!this.powered && (this.boardFlags & 4) === 0) {
      this.boardFlags |= 4
      ctx.reportIssue?.(
        'warning',
        `${id}: MCU unpowered (VDD ${vdd.toFixed(2)} V) — feed 5V (on-board regulator) or 3V3, and connect GND`,
      )
    }

    // ---- inputs (Schmitt trigger with hysteresis, DS5319 §5.3.13)
    const env = this.env
    const live = mcu !== null && this.powered && mcu.powered
    const vil = this.gpio.vil(vdd)
    const vih = this.gpio.vih(vdd)
    for (let j = 0; j < this.mapped.length; j++) {
      const i = this.mapped[j]
      const vRaw = this.read(i)
      const v = vRaw - vGnd
      if (live && env && env.logicManaged(i)) {
        // logic nets push exact edges through their listeners; re-asserting
        // the resolved level here (idempotent) also covers power-up/rebuilds
        this.pushLogicInput(i, env.logicVoltage(i))
      } else if (live) {
        if (Number.isFinite(v)) {
          if (this.inLevel[i] && v < vil) this.inLevel[i] = 0
          else if (!this.inLevel[i] && v > vih) this.inLevel[i] = 1
        }
        const p = this.mcuPinOf[i]
        if (p >= 0) mcu.pins.setInput(p, this.inLevel[i] ? 1 : 0, Number.isFinite(v) ? v : NaN)
      }
      if (Number.isFinite(v)) this.checkPin(i, v, vRaw, vdd, vGnd, now, live)
    }
  }

  /**
   * Logic-layer input (net is logic-resolvable): the resolved net voltage
   * relative to ground, or NaN when floating/contention (level held).
   */
  pushLogicInput(i: number, vNet: number): void {
    const mcu = this.mcu
    if (!mcu || !this.powered || !mcu.powered) return
    // Before this engine's first solve (a rebuild: load() resolves the logic
    // nets against an all-zero solution, i.e. 0 V rails) a resolved voltage
    // means nothing — pushing it would put a phantom low pulse on every
    // pulled-up input. The first observe() pushes the real level.
    if (!this.ctx) return
    const p = this.mcuPinOf[i]
    if (p < 0) return
    const vGndRaw = this.read(this.gndIdx)
    const v = vNet - (Number.isFinite(vGndRaw) ? vGndRaw : 0)
    if (Number.isFinite(v)) {
      if (this.inLevel[i] && v < this.gpio.vil(this.vdd)) this.inLevel[i] = 0
      else if (!this.inLevel[i] && v > this.gpio.vih(this.vdd)) this.inLevel[i] = 1
    }
    mcu.pins.setInput(p, this.inLevel[i] ? 1 : 0, Number.isFinite(v) ? v : NaN)
  }

  private checkPin(
    i: number,
    v: number,
    vAbs: number,
    vdd: number,
    vGnd: number,
    now: number,
    live: boolean,
  ): void {
    const ctx = this.ctx
    if (!ctx) return
    const id = this.comp.id
    const name = this.portName[i]
    const rep = this.reported[i]
    // absolute maximum ratings (DS5319 Table 7)
    const vMax = this.ft[i] ? this.gpio.vMaxFt(vdd) : this.gpio.vMaxStandard(Math.max(vdd, 0))
    if ((rep & R_OVER) === 0 && v > vMax) {
      this.reported[i] |= R_OVER
      ctx.reportIssue?.(
        'warning',
        this.ft[i]
          ? `${id} ${name}: ${v.toFixed(2)} V exceeds the 5.5 V limit of a 5 V-tolerant pin`
          : `${id} ${name}: ${v.toFixed(2)} V exceeds VDD + 0.3 V (${vMax.toFixed(2)} V) — ${name} is not 5 V tolerant`,
      )
    }
    if ((rep & R_UNDER) === 0 && v < VIN_MIN) {
      this.reported[i] |= R_UNDER
      ctx.reportIssue?.('warning', `${id} ${name}: ${v.toFixed(2)} V is below VSS − 0.3 V`)
    }
    if (!live) return
    // driver current from the solved pin voltage and the stamped stage
    const vHi = this.read(this.vddIdx)
    const iPin = this.stampUp[i] * (vHi - vAbs) - this.stampDown[i] * (vAbs - vGnd)
    if ((rep & R_CURRENT) === 0 && Math.abs(iPin) > this.gpio.iMaxPin) {
      this.reported[i] |= R_CURRENT
      ctx.reportIssue?.(
        'warning',
        `${id} ${name}: driver ${iPin > 0 ? 'sources' : 'sinks'} ${(Math.abs(iPin) * 1000).toFixed(1)} mA (> ${(this.gpio.iMaxPin * 1000).toFixed(0)} mA) — short circuit or missing series resistor`,
      )
    }
    // floating input: connected net with > 1 MΩ to everything but this pin
    const env = this.env
    if (env && env.diagFresh && (rep & R_FLOAT) === 0) {
      let floating = false
      if (this.mode[i] === PIN_IN_FLOAT && env.hasExternal(i)) {
        const g = env.conductance(i)
        floating = Number.isFinite(g) && g - this.stampUp[i] - this.stampDown[i] < FLOAT_G
      }
      if (!floating) this.floatSince[i] = NaN
      else if (Number.isNaN(this.floatSince[i])) this.floatSince[i] = now
      else if (now - this.floatSince[i] >= FLOAT_REPORT_AFTER) {
        this.reported[i] |= R_FLOAT
        ctx.reportIssue?.(
          'warning',
          `${id} ${name}: floating input — nothing drives its net and no pull-up/down is enabled; reads are undefined`,
        )
      }
    }
  }

  // ------------------------------------------------------- params / UI

  setRuntimeParam(key: string, value: ParamValue): void {
    if (key !== 'boot0') return
    const next = value === '1' || value === 1 || value === true
    if (next !== this.boot0) {
      this.boot0 = next
      bootStrapsOf(this.mcu)?.setBootPins(next ? 1 : 0)
      this.env?.log('info', `${this.comp.id}: BOOT0 = ${next ? 1 : 0} — sampled at the next reset`)
    }
  }

  fillTelemetry(tele: ComponentTelemetry): void {
    const mcu = this.mcu
    let t: McuTelemetry
    if (mcu) {
      const ds = mcu.debugState()
      t = { state: ds.state, pc: ds.registers.r[15] ?? 0, hclkHz: ds.hclkHz, cycles: ds.cycles }
      if (mcu.firmware) t.firmware = mcu.firmware.name
    } else {
      t = { state: 'no-firmware', pc: 0, hclkHz: 0, cycles: 0 }
    }
    const modes: Record<string, string> = {}
    const pins = this.entry?.pins ?? []
    const infoKind = new Map<string, string>()
    for (const info of this.entry?.pinInfo ?? []) infoKind.set(info.pin, info.kind)
    for (let i = 0; i < pins.length; i++) {
      if (this.portName[i]) {
        modes[pins[i]] = mcu ? tagOf(this.mode[i] as PinMode, this.af[i] === 1) : 'in'
      } else if (i === this.nrstIdx) {
        modes[pins[i]] = 'rst'
      } else {
        const k = infoKind.get(pins[i])
        modes[pins[i]] = k === 'ground' ? 'gnd' : k === 'power' ? 'pwr' : 'nc'
      }
    }
    t.pinModes = modes
    if (this.env) t.realtime = this.env.realtime()
    tele.mcu = t
  }
}

registerChip(MCU_BOARD_MODEL, (comp) => new McuBoardChip(comp))
