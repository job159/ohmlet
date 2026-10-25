/**
 * GPIO ports (RM0008 §9.2) and the McuPinPort the coordinator sees.
 *
 * Registers per port: CRL/CRH (reset 0x4444_4444 = floating inputs), IDR,
 * ODR, BSRR (set wins over reset), BRR, LCKR with the lock key sequence
 * (§9.2.7: write LCKK=1, 0, 1 with the same LCK[15:0], then read 0, read 1;
 * any deviation aborts; once locked, CRL/CRH bits of locked pins are frozen
 * until reset). Ports A–E exist on the medium-density die; the C8's LQFP48
 * bonds only PA0–15, PB0–15, PC13–15 and PD0–1 (DS5319 Table 5) — the other
 * port bits keep their registers but have no pin.
 *
 * Pin drive (pins.ts) is DERIVED from: power, debug-port ownership
 * (SWJ_CFG, §9.3.5), oscillator pins (PD0/PD1 = OSC_IN/OUT unless
 * AFIO_MAPR.PD01_REMAP and HSE off, §9.3.1; PC14/PC15 = OSC32 while LSEON,
 * §9.3.2), PWR_CSR.EWUP (PA0 forced pull-down, §5.4.2), then CRx/ODR and
 * the alternate-function owner's level (Table 20). Every change is
 * reported to the listener with the exact core cycle.
 *
 * Input: `level` is the Schmitt-trigger output. A pin under a strong drive
 * of its own (push-pull, or open-drain pulling low) reads its own level
 * until the coordinator reports the resolved net; weak or no drive keeps the
 * last externally reported level (so re-configuring a pull does not invent
 * edges). Analog mode disconnects the Schmitt trigger: IDR reads 0.
 */
import type { CycleClock } from '../core/types'
import {
  PIN_ANALOG,
  PIN_IN_FLOAT,
  PIN_IN_PULLDOWN,
  PIN_IN_PULLUP,
  PIN_OUT_OD,
  PIN_OUT_PP,
  type McuPinListener,
  type McuPinPort,
  type PinDriveState,
  type PinMode,
} from '../pins'
import { merge, RegisterBlock } from './block'

export const PORT_NAMES = ['A', 'B', 'C', 'D', 'E'] as const
const NPORTS = 5

/** LQFP48 bonded pins per port (DS5319 Table 5), bit masks. */
export const BONDED: readonly number[] = [0xffff, 0xffff, 0xe000, 0x0003, 0x0000]

/** Preallocated drive states: index = mode*4 + level*2 + af. Compared by identity. */
const DRIVES: PinDriveState[] = []
for (let m = 0; m < 6; m++)
  for (let l = 0; l < 2; l++)
    for (let a = 0; a < 2; a++) DRIVES.push(Object.freeze({ mode: m as PinMode, level: l as 0 | 1, af: a === 1 }))
const drv = (mode: PinMode, level = 0, af = false): PinDriveState => DRIVES[mode * 4 + level * 2 + (af ? 1 : 0)]
const FLOAT = drv(PIN_IN_FLOAT)

export interface PinHost {
  readonly clock: CycleClock
  powered(): boolean
  /** AFIO_MAPR.SWJ_CFG state */
  swj(): 0 | 1 | 2 | 4
  pd01Remap(): boolean
  hseOn(): boolean
  lseOn(): boolean
  /** PWR_CSR.EWUP forces PA0 to input pull-down */
  wkupEnabled(): boolean
  /** Schmitt output of `pin` changed (EXTI edge detection) */
  inputEdge(pin: number, level: 0 | 1, cycle: number): void
  logOnce(key: string, level: 'info' | 'warning' | 'error', source: string, msg: string): void
}

export class GpioPort extends RegisterBlock {
  readonly name: string
  crl = 0x44444444
  crh = 0x44444444
  odr = 0
  private lck = 0
  private lckk = false
  private seq = 0 // lock key sequence progress (0..3)
  private seqLck = 0

  constructor(
    readonly index: number,
    private pins: PinController,
  ) {
    super()
    this.name = 'GPIO' + PORT_NAMES[index]
  }

  get locked(): number {
    return this.lckk ? this.lck : 0
  }

  reset(): void {
    this.crl = this.crh = 0x44444444
    this.odr = 0
    this.lck = 0
    this.lckk = false
    this.seq = 0
  }

  read32(off: number): number {
    switch (off) {
      case 0x00:
        return this.crl
      case 0x04:
        return this.crh
      case 0x08:
        return this.pins.idr(this.index)
      case 0x0c:
        return this.odr
      case 0x18: {
        if (this.seq === 3) {
          // the mandatory "read 0" completes the sequence (§9.2.7)
          this.seq = 0
          this.lckk = true
          return this.lck
        }
        return (this.lck | (+this.lckk << 16)) >>> 0
      }
      default:
        return 0 // BSRR / BRR are write-only
    }
  }

  write32(off: number, v: number, m: number): void {
    switch (off) {
      case 0x00:
      case 0x04: {
        const hi = off === 4
        const old = hi ? this.crh : this.crl
        let nv = merge(old, v, m, 0xffffffff)
        const lk = (this.locked >>> (hi ? 8 : 0)) & 0xff
        if (lk) {
          // locked pins keep their 4 configuration bits
          let keep = 0
          for (let b = 0; b < 8; b++) if ((lk >>> b) & 1) keep |= 0xf << (b * 4)
          if ((nv & keep) !== (old & keep)) {
            this.pins.logOnce(`lck-${this.name}`, 'warning', this.name, `${this.name}_${hi ? 'CRH' : 'CRL'} write to a locked pin ignored (GPIOx_LCKR is active until reset)`)
          }
          nv = ((nv & ~keep) | (old & keep)) >>> 0
        }
        if (hi) this.crh = nv
        else this.crl = nv
        this.pins.portChanged(this.index, (old ^ nv) >>> 0, hi)
        return
      }
      case 0x0c: {
        const old = this.odr
        this.odr = merge(old, v, m, 0xffff)
        if (old !== this.odr) this.pins.odrChanged(this.index, old ^ this.odr)
        return
      }
      case 0x10: {
        const w = v & m
        const old = this.odr
        // BSy has priority over BRy (§9.2.5)
        this.odr = ((this.odr & ~(w >>> 16)) | (w & 0xffff)) & 0xffff
        if (old !== this.odr) this.pins.odrChanged(this.index, old ^ this.odr)
        return
      }
      case 0x14: {
        const old = this.odr
        this.odr &= ~(v & m & 0xffff)
        if (old !== this.odr) this.pins.odrChanged(this.index, old ^ this.odr)
        return
      }
      case 0x18:
        return this.writeLckr(merge(this.lck | (+this.lckk << 16), v, m, 0x1ffff))
    }
  }

  private writeLckr(v: number): void {
    if (this.lckk) return // locked until reset
    const k = (v >>> 16) & 1
    const l = v & 0xffff
    this.lck = l
    switch (this.seq) {
      case 0:
        if (k) {
          this.seq = 1
          this.seqLck = l
        }
        break
      case 1:
        this.seq = !k && l === this.seqLck ? 2 : k ? 1 : 0
        if (k) this.seqLck = l
        break
      case 2:
        this.seq = k && l === this.seqLck ? 3 : 0
        break
      default:
        this.seq = k ? 1 : 0 // a write instead of the read aborts
        this.seqLck = l
    }
  }
}

export class PinController implements McuPinPort {
  readonly pinCount = 64
  listener: McuPinListener | null = null
  readonly ports: GpioPort[] = []

  private drives: PinDriveState[] = new Array(80).fill(FLOAT)
  private input = new Uint8Array(80)
  private ext = new Uint8Array(80)
  private extValid = new Uint8Array(80)
  private volts = new Float64Array(80).fill(NaN)
  /** AF owners per pin and their output: a level, or 'z' = output buffer off (RM0008 §25.3.4 BIDIOE) */
  private af: (Map<string, 0 | 1 | 'z'> | undefined)[] = new Array(80)
  private subs: (Set<(level: 0 | 1, cycle: number) => void> | undefined)[] = new Array(80)

  constructor(private host: PinHost) {
    for (let p = 0; p < NPORTS; p++) this.ports.push(new GpioPort(p, this))
  }

  // ---------------------------------------------------------- McuPinPort

  pinName(pin: number): string {
    if (!this.bonded(pin)) return ''
    return 'P' + PORT_NAMES[pin >> 4] + (pin & 15)
  }

  pinIndex(name: string): number {
    const m = /^P([A-E])(\d{1,2})$/.exec(name.trim().toUpperCase())
    if (!m) return -1
    const bit = +m[2]
    if (bit > 15) return -1
    const pin = PORT_NAMES.indexOf(m[1] as (typeof PORT_NAMES)[number]) * 16 + bit
    return this.bonded(pin) ? pin : -1
  }

  drive(pin: number): PinDriveState {
    return this.drives[pin] ?? FLOAT
  }

  setInput(pin: number, level: 0 | 1, volts: number): void {
    if (!this.bonded(pin)) return
    this.volts[pin] = volts
    this.ext[pin] = level ? 1 : 0
    this.extValid[pin] = 1
    this.updateInput(pin, this.host.clock.cycles)
  }

  // ---------------------------------------------------------- SoC side

  bonded(pin: number): boolean {
    return pin >= 0 && pin < this.pinCount && ((BONDED[pin >> 4] >>> (pin & 15)) & 1) === 1
  }

  level(pin: number): 0 | 1 {
    return (this.input[pin] ?? 0) as 0 | 1
  }

  voltage(pin: number): number {
    return this.volts[pin] ?? NaN
  }

  idr(port: number): number {
    let v = 0
    for (let b = 0; b < 16; b++) {
      const pin = port * 16 + b
      if (this.input[pin] && this.drives[pin].mode !== PIN_ANALOG) v |= 1 << b
    }
    return v
  }

  subscribe(pin: number, cb: (level: 0 | 1, cycle: number) => void): () => void {
    if (pin < 0 || pin >= 80) return () => {}
    const s = (this.subs[pin] ??= new Set())
    s.add(cb)
    return () => s.delete(cb)
  }

  /**
   * Alternate-function output of `owner` on `pin`: a level, 'z' (the owner
   * keeps the pin but its output enable is off — e.g. SPI bidirectional
   * receive), or null (released). Only used while the pin is configured AF.
   */
  setAf(owner: string, pin: number, level: 0 | 1 | 'z' | null, cycle: number): void {
    if (pin < 0 || pin >= 80) return
    let m = this.af[pin]
    if (level === null) {
      if (!m || !m.delete(owner)) return
    } else {
      m ??= this.af[pin] = new Map()
      if (m.get(owner) === level) return
      m.set(owner, level)
      let driving = 0
      for (const l of m.values()) if (l !== 'z') driving++
      if (driving > 1) {
        const owners = [...m].filter(([, l]) => l !== 'z').map(([o]) => o)
        this.host.logOnce(`afconflict-${pin}`, 'warning', 'GPIO', `${owners.join(' and ')} both drive ${this.pinName(pin) || 'pin ' + pin} as an alternate function: conflicting AF outputs (the low level wins)`)
      }
    }
    this.recompute(pin, cycle)
  }

  /** Port configuration bits changed (`diff` = changed CRL or CRH bits). */
  portChanged(port: number, diff: number, hi: boolean): void {
    const cyc = this.host.clock.cycles
    for (let b = 0; b < 8; b++) {
      if ((diff >>> (b * 4)) & 0xf) {
        const bit = b + (hi ? 8 : 0)
        this.checkCfg(port, bit)
        this.recompute(port * 16 + bit, cyc)
      }
    }
  }

  odrChanged(port: number, diff: number): void {
    const cyc = this.host.clock.cycles
    for (let b = 0; b < 16; b++) if ((diff >>> b) & 1) this.recompute(port * 16 + b, cyc)
  }

  /** Recompute every pin (reset, power, remap, oscillator changes). */
  recomputeAll(cycle = this.host.clock.cycles): void {
    for (let pin = 0; pin < 80; pin++) this.recompute(pin, cycle)
  }

  /** Drop all AF claims (system reset releases every peripheral output). */
  clearAf(): void {
    this.af = new Array(80)
  }

  /** The full 80-pin space (5 ports) is tracked; only bonded pins are ever driven. */
  private computeDrive(pin: number): PinDriveState {
    if (!this.bonded(pin) || !this.host.powered()) return FLOAT
    const port = pin >> 4
    const bit = pin & 15
    // Serial-wire / JTAG ownership (RM0008 §9.3.5, Table 39 and the reset pulls of §9.1.1)
    const swj = this.host.swj()
    if (swj !== 4) {
      if (pin === 13) return drv(PIN_IN_PULLUP) // PA13 JTMS/SWDIO
      if (pin === 14) return drv(PIN_IN_PULLDOWN) // PA14 JTCK/SWCLK
      if (swj <= 1) {
        if (pin === 15) return drv(PIN_IN_PULLUP) // PA15 JTDI
        if (pin === 19) return FLOAT // PB3 JTDO: tri-stated by the TAP outside Shift-DR/IR
        if (pin === 20 && swj === 0) return drv(PIN_IN_PULLUP) // PB4 NJTRST
      }
    }
    if (port === 3 && bit <= 1 && (!this.host.pd01Remap() || this.host.hseOn())) return FLOAT // OSC_IN/OSC_OUT
    if (port === 2 && bit >= 14 && this.host.lseOn()) return FLOAT // OSC32_IN/OUT
    if (pin === 0 && this.host.wkupEnabled()) return drv(PIN_IN_PULLDOWN)

    const p = this.ports[port]
    const cfg = bit < 8 ? (p.crl >>> (bit * 4)) & 0xf : (p.crh >>> ((bit - 8) * 4)) & 0xf
    const mode = cfg & 3
    const cnf = cfg >> 2
    if (mode === 0) {
      if (cnf === 0) return drv(PIN_ANALOG)
      if (cnf === 2) return drv((p.odr >>> bit) & 1 ? PIN_IN_PULLUP : PIN_IN_PULLDOWN)
      return FLOAT // 01 floating, 11 reserved (warned in checkCfg)
    }
    const od = (cnf & 1) === 1
    if (cnf < 2) return drv(od ? PIN_OUT_OD : PIN_OUT_PP, (p.odr >>> bit) & 1)
    const lvl = this.afLevel(pin)
    // every owner switched its output buffer off: the AF pin is high-impedance
    // (no drive; the Schmitt input keeps reading the circuit)
    if (lvl < 0) return drv(PIN_IN_FLOAT, 0, true)
    return drv(od ? PIN_OUT_OD : PIN_OUT_PP, lvl, true)
  }

  /** Resolved AF output: 0 / 1 (wired-AND of the driving owners), −1 = all owners at 'z'. */
  private afLevel(pin: number): number {
    const m = this.af[pin]
    if (!m || m.size === 0) return 0 // no peripheral driving: AF output idles low
    let lvl = 1
    let driving = false
    for (const l of m.values()) {
      if (l === 'z') continue
      driving = true
      lvl &= l
    }
    return driving ? lvl : -1
  }

  private checkCfg(port: number, bit: number): void {
    const p = this.ports[port]
    const cfg = bit < 8 ? (p.crl >>> (bit * 4)) & 0xf : (p.crh >>> ((bit - 8) * 4)) & 0xf
    const name = 'P' + PORT_NAMES[port] + bit
    if (cfg === 0xc) this.host.logOnce(`cnf11-${name}`, 'warning', 'GPIO' + PORT_NAMES[port], `${name}: input CNF=11 is reserved (RM0008 Table 20) — treated as floating`)
    if (!this.bonded(port * 16 + bit) && (cfg & 3) !== 0) {
      this.host.logOnce(`unbonded-${name}`, 'warning', 'GPIO' + PORT_NAMES[port], `${name} is configured as an output but is not bonded out on the STM32F103C8 (LQFP48)`)
    }
  }

  private recompute(pin: number, cycle: number): void {
    const d = this.computeDrive(pin)
    if (d === this.drives[pin]) return
    this.drives[pin] = d
    // A strong own drive defines the pin level until the circuit says otherwise.
    if (d.mode === PIN_OUT_PP || (d.mode === PIN_OUT_OD && d.level === 0)) this.extValid[pin] = 0
    if (this.bonded(pin)) this.listener?.pinDriveChanged(pin, cycle)
    this.updateInput(pin, cycle)
  }

  private updateInput(pin: number, cycle: number): void {
    const d = this.drives[pin]
    let lvl: number
    if (d.mode === PIN_ANALOG) lvl = 0
    else if (this.extValid[pin]) lvl = this.ext[pin]
    else if (d.mode === PIN_OUT_PP || d.mode === PIN_OUT_OD) lvl = d.level
    else lvl = d.mode === PIN_IN_PULLUP ? 1 : 0
    if (lvl === this.input[pin]) return
    this.input[pin] = lvl
    const l = lvl as 0 | 1
    this.host.inputEdge(pin, l, cycle)
    const s = this.subs[pin]
    if (s) for (const cb of s) cb(l, cycle)
  }

  logOnce(key: string, level: 'info' | 'warning' | 'error', source: string, msg: string): void {
    this.host.logOnce(key, level, source, msg)
  }
}
