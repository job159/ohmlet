/**
 * FAKE McuDevice (test double implementing src/mcu/mcu-api.ts) for the
 * coordinator tests: no CPU — pin activity is SCRIPTED at exact core cycles,
 * so edge timestamps are known in advance and every coordinator behavior
 * (exact-edge stops, duty averaging, input pushes, power/reset handling) can
 * be asserted against closed-form expectations.
 *
 * Semantics mirror the real Stm32f103 where the coordinator depends on them:
 *  - runUntil(t) runs to the first cycle c with c/hz >= t; a pending
 *    requestSync() made from inside pinDriveChanged stops the run right
 *    after the "instruction" (one cycle) that produced the edge;
 *  - sync requests made outside a run are discarded at the next run start;
 *  - unpowered / held in reset / no firmware: time advances, pins are
 *    released (input floating) and no script runs.
 */
import type {
  McuDebugState,
  McuDevice,
  McuLogEvent,
  PeripheralSupport,
  UartLineConfig,
  UartTap,
} from '../../src/mcu/mcu-api'
import type { FirmwareImage } from '../../src/mcu/firmware'
import type { StopReason } from '../../src/mcu/core/types'
import { PIN_IN_FLOAT, PIN_OUT_PP } from '../../src/mcu/pins'
import type { McuPinListener, McuPinPort, PinDriveState, PinMode } from '../../src/mcu/pins'

export const FAKE_FIRMWARE: FirmwareImage = {
  name: 'fake.elf',
  format: 'elf',
  segments: [],
  entry: null,
  symbols: [],
  sha256: 'f'.repeat(64),
  fileSize: 0,
  warnings: [],
}

/** One scripted drive change. */
export interface PinEvent {
  cycle: number
  pin: number
  mode: PinMode
  level: 0 | 1
}

/** A source of scripted pin events. */
export interface PinProgram {
  /** earliest event cycle >= c (Infinity when exhausted) */
  nextAt(c: number): number
  /** events exactly at `cycle` */
  eventsAt(cycle: number): PinEvent[]
}

/** Periodic push-pull square wave: rising at start + k·period, falling `high` cycles later. */
export class PwmProgram implements PinProgram {
  constructor(
    readonly pin: number,
    readonly period: number,
    readonly high: number,
    readonly start: number,
    readonly stopAfter = Infinity,
  ) {}

  nextAt(c: number): number {
    const { start, period, high } = this
    let best = Infinity
    if (c <= start) best = start
    else {
      const k = Math.floor((c - start) / period)
      for (const cand of [start + k * period, start + k * period + high, start + (k + 1) * period]) {
        if (cand >= c && cand < best) best = cand
      }
    }
    return best >= this.stopAfter ? Infinity : best
  }

  eventsAt(cycle: number): PinEvent[] {
    const ph = (cycle - this.start) % this.period
    if (ph !== 0 && ph !== this.high) return []
    return [{ cycle, pin: this.pin, mode: PIN_OUT_PP, level: ph === 0 ? 1 : 0 }]
  }
}

/** Events added while running (reactions to inputs). */
export class DynamicProgram implements PinProgram {
  readonly events: PinEvent[] = []
  add(e: PinEvent): void {
    this.events.push(e)
    this.events.sort((a, b) => a.cycle - b.cycle)
  }
  nextAt(c: number): number {
    for (const e of this.events) if (e.cycle >= c) return e.cycle
    return Infinity
  }
  eventsAt(cycle: number): PinEvent[] {
    return this.events.filter((e) => e.cycle === cycle)
  }
}

/** An explicit, sorted list of events. */
export class ListProgram implements PinProgram {
  readonly events: PinEvent[]
  constructor(events: PinEvent[]) {
    this.events = events.slice().sort((a, b) => a.cycle - b.cycle)
  }
  nextAt(c: number): number {
    for (const e of this.events) if (e.cycle >= c) return e.cycle
    return Infinity
  }
  eventsAt(cycle: number): PinEvent[] {
    return this.events.filter((e) => e.cycle === cycle)
  }
}

export class FakeUart implements UartTap {
  onTx: ((byte: number, cycle: number) => void) | null = null
  readonly received: number[] = []
  constructor(readonly name: string) {}
  send(bytes: Uint8Array): void {
    for (const b of bytes) this.received.push(b)
  }
  config(): UartLineConfig {
    return { enabled: true, baud: 115200, dataBits: 8, parity: 'none', stopBits: 1 }
  }
}

const PORTS = 'ABC'

export class FakePinPort implements McuPinPort {
  readonly pinCount = 48
  listener: McuPinListener | null = null
  readonly drives: PinDriveState[] = []
  /** every setInput call: pin, level, volts and the MCU cycle it arrived at */
  readonly inputs: { pin: number; level: 0 | 1; volts: number; cycle: number }[] = []
  readonly lastInput: (0 | 1 | undefined)[] = []
  readonly lastVolts: number[] = []

  constructor(private readonly owner: FakeMcu) {
    for (let i = 0; i < this.pinCount; i++) this.drives.push({ mode: PIN_IN_FLOAT, level: 0, af: false })
  }

  pinName(pin: number): string {
    return pin >= 0 && pin < this.pinCount ? `P${PORTS[pin >> 4]}${pin & 15}` : ''
  }

  pinIndex(name: string): number {
    const m = /^P([ABC])(\d{1,2})$/.exec(name)
    if (!m) return -1
    const bit = Number(m[2])
    return bit < 16 ? PORTS.indexOf(m[1]) * 16 + bit : -1
  }

  drive(pin: number): PinDriveState {
    if (!this.owner.live) return { mode: PIN_IN_FLOAT, level: 0, af: false }
    return this.drives[pin]
  }

  setInput(pin: number, level: 0 | 1, volts: number): void {
    const prev = this.lastInput[pin]
    this.lastInput[pin] = level
    this.lastVolts[pin] = volts
    this.inputs.push({ pin, level, volts, cycle: this.owner.cycles })
    if (prev !== level) this.owner.inputChanged(pin, level)
  }

  /** Input level the MCU saw for `pin` at cycle `c` (latest push at or before c). */
  inputAt(pin: number, c: number): 0 | 1 | undefined {
    let v: 0 | 1 | undefined
    for (const e of this.inputs) {
      if (e.pin === pin && e.cycle <= c) v = e.level
    }
    return v
  }
}

export class FakeMcu implements McuDevice {
  readonly model: string
  readonly pins: FakePinPort
  readonly uarts: FakeUart[]
  readonly support: readonly PeripheralSupport[] = [
    { name: 'GPIO', status: 'partial', notes: 'scripted test double' },
  ]
  firmware: FirmwareImage | null = FAKE_FIRMWARE
  cycles = 0
  powered = true
  resetHeld = false
  halted = false
  readonly programs: PinProgram[] = []
  /** "firmware" reactions: when input `from` changes, drive `to` push-pull to that level `delay` cycles later */
  readonly echoes: { from: number; to: number; delay: number }[] = []
  private readonly dynamic = new DynamicProgram()
  /** scripted UART bytes: [cycle, byte] */
  readonly uartScript: [number, number][] = []
  // instrumentation
  powerOnCount = 0
  powerOffCount = 0
  readonly resets: ('power-on' | 'pin')[] = []
  readonly resetPinCalls: boolean[] = []
  runCalls = 0
  syncStops = 0
  private syncRequested = false
  private running = false
  private log: McuLogEvent[] = []

  constructor(
    readonly hz = 8e6,
    model = 'stm32f103c8',
  ) {
    this.model = model
    this.pins = new FakePinPort(this)
    this.uarts = [new FakeUart('USART1')]
    this.programs.push(this.dynamic)
  }

  /** pins drive and scripts run */
  get live(): boolean {
    return this.powered && !this.resetHeld && this.firmware !== null
  }

  // ---- test helpers
  /** Change a drive NOW (at the current cycle) and notify the listener. */
  setDrive(pin: number, mode: PinMode, level: 0 | 1 = 0): void {
    this.pins.drives[pin] = { mode, level, af: false }
    if (this.live) this.pins.listener?.pinDriveChanged(pin, this.cycles)
  }

  addProgram(p: PinProgram): this {
    this.programs.push(p)
    return this
  }

  /** Called by the pin port when an input level changes. */
  inputChanged(pin: number, level: 0 | 1): void {
    if (!this.live) return
    for (const e of this.echoes) {
      if (e.from === pin) this.dynamic.add({ cycle: this.cycles + e.delay, pin: e.to, mode: PIN_OUT_PP, level })
    }
  }

  // ---- McuDevice
  loadFirmware(img: FirmwareImage): { ok: boolean; errors: string[]; warnings: string[] } {
    this.firmware = img
    return { ok: true, errors: [], warnings: [] }
  }

  reset(kind: 'power-on' | 'pin'): void {
    this.resets.push(kind)
  }

  setPowered(on: boolean): void {
    if (on === this.powered) return
    this.powered = on
    if (on) this.powerOnCount++
    else this.powerOffCount++
  }

  setResetPin(asserted: boolean): void {
    this.resetPinCalls.push(asserted)
    this.resetHeld = asserted
  }

  time(): number {
    return this.cycles / this.hz
  }

  timeOfCycle(cycle: number): number {
    return cycle / this.hz
  }

  /** first cycle whose time is >= t */
  cycleAtOrAfter(t: number): number {
    let c = Math.ceil(t * this.hz)
    while (c > 0 && (c - 1) / this.hz >= t) c--
    while (c / this.hz < t) c++
    return c
  }

  runUntil(t: number): StopReason {
    this.runCalls++
    this.syncRequested = false
    const target = this.cycleAtOrAfter(t)
    if (this.halted) return 'halted'
    this.running = true
    try {
      while (this.cycles < target) {
        if (!this.live) {
          this.cycles = target
          break
        }
        let next = Infinity
        for (const p of this.programs) next = Math.min(next, p.nextAt(this.cycles))
        for (const [c] of this.uartScript) if (c >= this.cycles && c < next) next = c
        if (next >= target) {
          this.cycles = target
          break
        }
        this.cycles = next
        for (const p of this.programs) {
          for (const e of p.eventsAt(next)) {
            this.pins.drives[e.pin] = { mode: e.mode, level: e.level, af: false }
            this.pins.listener?.pinDriveChanged(e.pin, next)
          }
        }
        for (const [c, b] of this.uartScript) if (c === next) this.uarts[0].onTx?.(b, c)
        this.cycles = next + 1 // the instruction that made the edge completes
        if (this.syncRequested) {
          this.syncRequested = false
          if (this.cycles < target) {
            this.syncStops++
            return 'sync'
          }
        }
      }
      return 'target'
    } finally {
      this.running = false
    }
  }

  requestSync(): void {
    if (this.running) this.syncRequested = true
  }

  drainLog(): McuLogEvent[] {
    const l = this.log
    this.log = []
    return l
  }

  pushLog(message: string): void {
    this.log.push({ time: this.time(), level: 'info', source: 'fake', message })
  }

  debugState(): McuDebugState {
    return {
      state: !this.powered
        ? 'unpowered'
        : this.resetHeld
          ? 'reset'
          : !this.firmware
            ? 'no-firmware'
            : this.halted
              ? 'halted'
              : 'running',
      registers: {
        r: new Array(16).fill(0),
        xpsr: 0,
        msp: 0,
        psp: 0,
        primask: 0,
        basemask: 0,
        faultmask: 0,
        control: 0,
      },
      faults: { cfsr: 0, hfsr: 0, mmfar: 0, bfar: 0 },
      cycles: this.cycles,
      instructions: this.cycles,
      hclkHz: this.hz,
      ipsr: 0,
    }
  }

  halt(): void {
    this.halted = true
  }
  resume(): void {
    this.halted = false
  }
  stepInstruction(): void {
    this.cycles++
  }
  setBreakpoints(): void {}
  readMemory(_addr: number, length: number): Uint8Array {
    return new Uint8Array(length)
  }
}
