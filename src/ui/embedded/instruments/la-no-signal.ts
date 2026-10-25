/**
 * The logic analyzer's 「這些通道到目前為止都沒有訊號變化。」 must be TRUE
 * (release polish): 「自動」 found nothing to fit is not the same as "the
 * recorder holds nothing". In blink's first second the recorder already
 * holds PA5's edges (out of reset low at 0.000 05 s, high at 0.001 33 s, the
 * first toggle at 0.502 s) — too few for a period, so fitLogicSpan returns
 * 'none' — while the hover chip says 「訊號變化中」. The analyzer then shows those edges (the window follows the
 * clock over everything recorded so far) instead of claiming there are none;
 * the overlay's claim is kept only for a recorder that holds no change on
 * any channel, and it is withdrawn the moment one is recorded.
 *
 * Pure (no React, no store): the analyzer's auto-fit effect calls it with
 * the captures it queried anyway.
 */
import type { LogicCapture } from '../../../sim/coordinator/api'
import { spanAtLeast } from '../../../instruments/autofit'

/** The span shown before anything was fitted (la-view.ts LA_DEFAULT_SPAN). */
const MIN_SPAN = 0.01

/**
 * The earliest signal change of any channel in `caps`: a change between two
 * defined levels (0 ↔ 1, as the auto-fit counts edges). A pin coming out of
 * reset (undefined → low at 0.000 05 s, like an unused PB0) is not a signal
 * change — its channel is still 「沒有訊號變化」. null = none.
 */
export function firstRecordedChange(caps: readonly Pick<LogicCapture, 'traces'>[]): number | null {
  let first = Infinity
  for (const cap of caps) {
    for (const tr of cap.traces) {
      let prev: number = tr.initial
      for (let i = 0; i < tr.times.length && tr.times[i] < first; i++) {
        const next = tr.levels[i]
        if (next !== prev && prev !== 2 && next !== 2) {
          first = tr.times[i]
          break
        }
        prev = next
      }
    }
  }
  return Number.isFinite(first) ? first : null
}

/**
 * What 「自動」 shows when fitLogicSpan found no period and no frame:
 *  - 'empty'     — the recorder holds no change at all: the overlay may say
 *                  「這些通道到目前為止都沒有訊號變化。」 (paused: 「記錄中…」);
 *  - 'recording' — it holds a few: follow the clock over all of them
 *                  (`span` ≥ now − first change, on the zoom ladder, at
 *                  least the default 10 ms), no overlay.
 */
export function autoFitFallback(caps: readonly Pick<LogicCapture, 'traces'>[], now: number): { kind: 'empty' } | { kind: 'recording'; span: number } {
  const first = firstRecordedChange(caps)
  if (first === null) return { kind: 'empty' }
  // a little room left of the first change, so it is not drawn on the window's edge
  return { kind: 'recording', span: spanAtLeast(Math.max(MIN_SPAN, (now - first) * 1.05)) }
}

/** How often a quiet recorder is re-checked while the overlay says 「沒有訊號變化」 (ms). */
export const EMPTY_RECHECK_MS = 250
