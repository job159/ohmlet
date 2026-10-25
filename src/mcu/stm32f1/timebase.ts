/**
 * Core-cycle ↔ simulation-time mapping (ARCHITECTURE_REVIEW §10.3).
 *
 * The core counts HCLK cycles. Each HCLK change (SW switch, HPRE write)
 * starts a new piecewise-linear SEGMENT at the exact cycle of the change, so
 * every cycle maps to one exact instant even across clock switches: a GPIO
 * edge at cycle c always reports the same time, before or after later
 * switches. Old segments are kept (bounded) so slightly-late events
 * (scheduled cycle < current cycle) still convert exactly.
 *
 * `TimedEvents` schedules callbacks at absolute TIMES for blocks clocked
 * independently of HCLK (oscillator start-up, LSI-driven IWDG, flash
 * program/erase) and re-derives their cycle on every rebase.
 */
import type { EventHandle, Scheduler } from '../core/types'

interface Seg {
  cycle: number
  time: number
  hz: number
}

const MAX_SEGS = 64

export class TimeBase {
  private segs: Seg[]

  constructor(hz: number) {
    this.segs = [{ cycle: 0, time: 0, hz }]
  }

  get hz(): number {
    return this.segs[this.segs.length - 1].hz
  }

  timeOf(cycle: number): number {
    const s = this.segs
    for (let i = s.length - 1; i > 0; i--) {
      if (cycle >= s[i].cycle) return s[i].time + (cycle - s[i].cycle) / s[i].hz
    }
    return s[0].time + (cycle - s[0].cycle) / s[0].hz
  }

  /** Fractional cycle at which time `t` occurs (t at or after the current segment start). */
  cycleAt(t: number): number {
    const s = this.segs[this.segs.length - 1]
    return s.cycle + (t - s.time) * s.hz
  }

  /** First integer cycle whose time is >= t. */
  cycleAtOrAfter(t: number): number {
    let c = Math.ceil(this.cycleAt(t) - 1e-6)
    if (this.timeOf(c) < t) c++
    return c
  }

  /** HCLK becomes `hz` from `cycle` on. */
  rebase(cycle: number, hz: number): boolean {
    const last = this.segs[this.segs.length - 1]
    if (hz === last.hz) return false
    const seg = { cycle, time: this.timeOf(cycle), hz }
    if (cycle === last.cycle) this.segs[this.segs.length - 1] = seg
    else this.segs.push(seg)
    if (this.segs.length > MAX_SEGS) this.segs.splice(0, this.segs.length - MAX_SEGS)
    return true
  }
}

interface TimedEv {
  t: number
  fn: (cycle: number) => void
  h: EventHandle
}

export class TimedEvents {
  private pending = new Map<number, TimedEv>()
  private nextId = 1

  constructor(
    private sched: Scheduler,
    private tb: TimeBase,
  ) {}

  at(t: number, fn: (cycle: number) => void): number {
    const id = this.nextId++
    const ev: TimedEv = { t, fn, h: 0 }
    ev.h = this.arm(id, ev)
    this.pending.set(id, ev)
    return id
  }

  cancel(id: number): void {
    const ev = this.pending.get(id)
    if (!ev) return
    this.sched.cancel(ev.h)
    this.pending.delete(id)
  }

  /** HCLK changed: re-derive every pending event's cycle from its absolute time. */
  rebaseAll(): void {
    for (const [id, ev] of this.pending) {
      this.sched.cancel(ev.h)
      ev.h = this.arm(id, ev)
    }
  }

  /** Forget everything (the scheduler itself is cleared by the caller). */
  clear(): void {
    this.pending.clear()
  }

  private arm(id: number, ev: TimedEv): EventHandle {
    return this.sched.schedule(this.tb.cycleAt(ev.t), (c) => {
      this.pending.delete(id)
      ev.fn(c)
    })
  }
}
