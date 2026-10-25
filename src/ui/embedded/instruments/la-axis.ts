/**
 * The logic analyzer's time-axis labels (QA clarity LA-AXIS) — pure, so
 * the stride / overlap rules are unit-tested without a canvas.
 */
import { fmtTickAnchor, fmtTickOffset } from '../../../instruments/format'

/** The window has 10 divisions, like the scope (UX IS-8). */
export const LA_DIVS = 10

/** Air between two axis labels (px). */
const AXIS_LABEL_GAP = 8
/** Label strides in divisions, tried in this order (QA clarity LA-AXIS — the scope's fitLabels rule). */
const AXIS_STRIDES = [1, 2, 5, 10] as const

/**
 * Product chrome (QA clarity LA-AXIS): the time-axis labels of a window
 * [t0, t0 + DIVS·step] drawn `width` px wide. The first label is the
 * ANCHOR — absolute simulation time in the footer's format (「2.104 361 8 s」)
 * — and every later one its offset (「+1 µs」「+0.5 s」), so the division
 * step reads at a glance. The stride (1, 2, 5 or 10 divisions) is the
 * smallest whose offsets never touch; a label a marker flag would cover is
 * left out (the next one becomes the anchor), and an offset the wide anchor
 * would run into is skipped — no two label boxes overlap. `measure` gives a
 * label's width in px (the canvas' measureText). Pure apart from it.
 */
export function laAxisLabels(
  t0: number,
  step: number,
  width: number,
  measure: (s: string) => number,
  flagXs: readonly number[] = [],
): { k: number; x: number; text: string; w: number }[] {
  const divs = LA_DIVS
  const divW = width / divs
  const xOfK = (k: number) => Math.round(k * divW) + 0.5
  const maxOff = (divs - 1) * step
  let widest = 0
  for (let k = 1; k < divs; k++) widest = Math.max(widest, measure(fmtTickOffset(k * step, step, maxOff)))
  const stride = AXIS_STRIDES.find((s) => s * divW >= widest + AXIS_LABEL_GAP) ?? divs
  const out: { k: number; x: number; text: string; w: number }[] = []
  let anchorK: number | null = null
  for (let k = 0; k < divs; k += stride) {
    const x = xOfK(k)
    const text = anchorK === null ? fmtTickAnchor(t0 + k * step, step) : fmtTickOffset((k - anchorK) * step, step, maxOff)
    const w = measure(text)
    // a label a flag would cover (its 12 px box + a 2 px gap) is left out
    if (flagXs.some((fx) => fx + 8 > x + 3 && fx - 8 < x + 3 + w)) continue
    // never past the plot's right edge, never into the label before it
    if (x + 3 + w > width) continue
    const prev = out[out.length - 1]
    if (prev && x + 3 < prev.x + 3 + prev.w + AXIS_LABEL_GAP) continue
    if (anchorK === null) anchorK = k
    out.push({ k, x, text, w })
  }
  return out
}
