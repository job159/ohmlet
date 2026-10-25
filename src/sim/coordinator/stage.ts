/**
 * Piecewise-constant history of CMOS output-stage drives, per pin, and its
 * duty-weighted average over an analog interval.
 *
 * An MCU / digital-device pin drive is two conductances: `up` (S, pin → the
 * part's high rail) and `down` (S, pin → its low rail). Push-pull high =
 * (1/rout, 0), low = (0, 1/rout), pull-up = (1/rPull, 0), released = (0, 0).
 *
 * Drives change at exact virtual times (MCU cycles, device events) while the
 * analog solver advances in intervals [t0, t1]. For each interval the solver
 * stamps the TIME AVERAGE of each conductance. Averaging the two
 * conductances separately is exact for linear loads in the sense that a pin
 * toggling with duty d between high and low becomes a Thevenin source of
 * d·VDD behind the unchanged rout — the PWM average a low-pass filter sees —
 * while one interval that contains no edge stamps the drive exactly. With the
 * coordinator ending intervals AT analog-coupled edges, averaging only kicks
 * in for edges denser than the minimum analog step.
 */
export class StageHistory {
  /** latest (current) conductances per pin */
  readonly up: Float64Array
  readonly down: Float64Array
  /** conductances at the start of the open interval */
  private readonly baseUp: Float64Array
  private readonly baseDown: Float64Array
  // event list (insertion order == time order per pin)
  private evPin: Int32Array
  private evT: Float64Array
  private evUp: Float64Array
  private evDown: Float64Array
  private count = 0
  // averaging scratch
  private readonly accUp: Float64Array
  private readonly accDown: Float64Array
  private readonly lastT: Float64Array
  private readonly curUp: Float64Array
  private readonly curDown: Float64Array
  private readonly touched: Uint8Array
  private readonly touchedList: Int32Array

  constructor(readonly pinCount: number) {
    this.up = new Float64Array(pinCount)
    this.down = new Float64Array(pinCount)
    this.baseUp = new Float64Array(pinCount)
    this.baseDown = new Float64Array(pinCount)
    this.evPin = new Int32Array(16)
    this.evT = new Float64Array(16)
    this.evUp = new Float64Array(16)
    this.evDown = new Float64Array(16)
    this.accUp = new Float64Array(pinCount)
    this.accDown = new Float64Array(pinCount)
    this.lastT = new Float64Array(pinCount)
    this.curUp = new Float64Array(pinCount)
    this.curDown = new Float64Array(pinCount)
    this.touched = new Uint8Array(pinCount)
    this.touchedList = new Int32Array(pinCount)
  }

  /** Force a pin's state with no history (binding / initialization). */
  set(pin: number, up: number, down: number): void {
    this.up[pin] = up
    this.down[pin] = down
    this.baseUp[pin] = up
    this.baseDown[pin] = down
    // drop pending events of this pin
    let w = 0
    for (let k = 0; k < this.count; k++) {
      if (this.evPin[k] === pin) continue
      this.copyEvent(k, w++)
    }
    this.count = w
  }

  /** The drive of `pin` changes to (up, down) at virtual time `t`. */
  record(pin: number, t: number, up: number, down: number): void {
    if (this.up[pin] === up && this.down[pin] === down) return
    this.up[pin] = up
    this.down[pin] = down
    if (this.count === this.evPin.length) this.grow()
    const k = this.count++
    this.evPin[k] = pin
    this.evT[k] = t
    this.evUp[k] = up
    this.evDown[k] = down
  }

  /** True when a change of any pin is pending inside (t0, t1). */
  hasEvents(): boolean {
    return this.count > 0
  }

  /**
   * Duty-weighted average of every pin's conductances over [t0, t1]
   * (t1 > t0). Changes after t1 are ignored; a change exactly at t1
   * contributes zero duration.
   */
  average(t0: number, t1: number, outUp: Float64Array, outDown: Float64Array): void {
    outUp.set(this.baseUp)
    outDown.set(this.baseDown)
    if (this.count === 0) return
    const span = t1 - t0
    if (!(span > 0)) return
    let nTouched = 0
    for (let k = 0; k < this.count; k++) {
      const te0 = this.evT[k]
      if (te0 > t1) continue
      const te = te0 > t0 ? te0 : t0
      const p = this.evPin[k]
      if (this.touched[p] === 0) {
        this.touched[p] = 1
        this.touchedList[nTouched++] = p
        this.lastT[p] = t0
        this.curUp[p] = this.baseUp[p]
        this.curDown[p] = this.baseDown[p]
        this.accUp[p] = 0
        this.accDown[p] = 0
      }
      const d = te - this.lastT[p]
      this.accUp[p] += this.curUp[p] * d
      this.accDown[p] += this.curDown[p] * d
      this.lastT[p] = te
      this.curUp[p] = this.evUp[k]
      this.curDown[p] = this.evDown[k]
    }
    for (let j = 0; j < nTouched; j++) {
      const p = this.touchedList[j]
      const d = t1 - this.lastT[p]
      outUp[p] = (this.accUp[p] + this.curUp[p] * d) / span
      outDown[p] = (this.accDown[p] + this.curDown[p] * d) / span
      this.touched[p] = 0
    }
  }

  /** Close the interval at t1: changes at or before t1 become the new base. */
  commit(t1: number): void {
    if (this.count === 0) return
    let w = 0
    for (let k = 0; k < this.count; k++) {
      if (this.evT[k] <= t1) {
        const p = this.evPin[k]
        this.baseUp[p] = this.evUp[k]
        this.baseDown[p] = this.evDown[k]
      } else {
        this.copyEvent(k, w++)
      }
    }
    this.count = w
  }

  private copyEvent(from: number, to: number): void {
    if (from === to) return
    this.evPin[to] = this.evPin[from]
    this.evT[to] = this.evT[from]
    this.evUp[to] = this.evUp[from]
    this.evDown[to] = this.evDown[from]
  }

  private grow(): void {
    const n = this.evPin.length * 2
    const pin = new Int32Array(n)
    pin.set(this.evPin)
    const t = new Float64Array(n)
    t.set(this.evT)
    const up = new Float64Array(n)
    up.set(this.evUp)
    const down = new Float64Array(n)
    down.set(this.evDown)
    this.evPin = pin
    this.evT = t
    this.evUp = up
    this.evDown = down
  }
}
