/**
 * The SoC's simulation log: deduplicated and rate-limited so a firmware bug
 * in a tight loop (a write to a gated peripheral every microsecond) yields
 * one readable line, not a million.
 *
 *  - identical (level, source, message) within DEDUP_WINDOW_S of simulation
 *    time are counted, and the next emission says how many were folded;
 *  - at most RATE_LIMIT events per simulated second, the overflow is
 *    summarised in one line when the window rolls over;
 *  - `once(key, …)` for one-shot hints ("GPIOA clock is off").
 */
import type { McuLogEvent } from '../mcu-api'

const DEDUP_WINDOW_S = 1
const RATE_LIMIT = 200
const MAX_BUFFER = 2000

type Level = McuLogEvent['level']

export class SocLog {
  private buf: McuLogEvent[] = []
  private seen = new Map<string, { last: number; folded: number }>()
  private onceKeys = new Set<string>()
  private windowStart = -Infinity
  private windowCount = 0
  private dropped = 0

  constructor(private now: () => number) {}

  log(level: Level, source: string, message: string): void {
    const t = this.now()
    const key = level + '\u0000' + source + '\u0000' + message
    const s = this.seen.get(key)
    if (s && t - s.last < DEDUP_WINDOW_S) {
      s.folded++
      return
    }
    if (t - this.windowStart >= 1) {
      if (this.dropped > 0) {
        this.push({ time: t, level: 'warning', source: 'log', message: `${this.dropped} log messages suppressed (more than ${RATE_LIMIT} per simulated second)` })
      }
      this.windowStart = t
      this.windowCount = 0
      this.dropped = 0
    }
    if (this.windowCount >= RATE_LIMIT) {
      this.dropped++
      return
    }
    this.windowCount++
    const folded = s?.folded ?? 0
    if (this.seen.size > 5000) this.seen.clear()
    this.seen.set(key, { last: t, folded: 0 })
    this.push({ time: t, level, source, message: folded > 0 ? `${message} (repeated ${folded}× since the last report)` : message })
  }

  /** Log only the first time `key` is seen (until `resetOnce`). */
  once(key: string, level: Level, source: string, message: string): void {
    if (this.onceKeys.has(key)) return
    this.onceKeys.add(key)
    this.log(level, source, message)
  }

  hasOnce(key: string): boolean {
    return this.onceKeys.has(key)
  }

  resetOnce(): void {
    this.onceKeys.clear()
  }

  drain(): McuLogEvent[] {
    const out = this.buf
    this.buf = []
    return out
  }

  private push(e: McuLogEvent): void {
    if (this.buf.length >= MAX_BUFFER) this.buf.shift()
    this.buf.push(e)
  }
}
