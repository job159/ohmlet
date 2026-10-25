/**
 * Finding things in the logic recording (UX IS-6), on demand — never per
 * frame: the decoded transactions of the recording (results table,
 * previous / next frame, auto-fit), and the next / previous edge of one
 * channel. Both search the recorder in windows that grow backwards (or
 * forwards) from where the user is, so a busy bus costs one small query and
 * a quiet one a few cheap large ones.
 */
import type { LogicCapture } from '../../../sim/coordinator/api'
import { adjacentEdge } from '../../../instruments/autofit'
import { decodedFrames, runDecoder, type DecodedFrame, type DecoderRun, type LogicDecoderConfig } from '../logic-decoders'

type Query = (t0: number, t1: number) => Promise<LogicCapture>

/** decoders need this much signal before a frame to decode it (a cut first frame is dropped) */
const LEAD = 5e-3
const WINDOWS = [1, 10, 100, Infinity]

export interface FrameCollection {
  frames: DecodedFrame[]
  /** older frames exist that are not listed */
  capped: boolean
  /** the decode runs over the last window searched */
  runs: DecoderRun[]
}

/**
 * Decoded transactions of [0, now] — the newest `max` of them. Searches the
 * last 1 s, 10 s, 100 s, then everything, until `max` frames are found or
 * the start of the recording is reached.
 */
export async function collectFrames(
  query: Query,
  configs: readonly LogicDecoderConfig[],
  now: number,
  max = 3000,
): Promise<FrameCollection> {
  if (configs.length === 0 || !(now > 0)) return { frames: [], capped: false, runs: [] }
  let out: FrameCollection = { frames: [], capped: false, runs: [] }
  for (const w of WINDOWS) {
    const t0 = Math.max(0, now - w)
    const cap = await query(t0, now)
    const runs = configs.map((c) => runDecoder(cap, c)).filter((r): r is DecoderRun => r !== null)
    let frames = decodedFrames(runs)
    if (t0 > 0) frames = frames.filter((f) => f.t0 >= t0 + LEAD)
    out = { frames, capped: false, runs }
    if (frames.length >= max) return { frames: frames.slice(frames.length - max), capped: true, runs }
    if (t0 === 0) return out
  }
  return out
}

/**
 * The edge of channel `index` nearest after (dir 1) or before (dir -1) time
 * `t` within [0, now]; null when the channel has none there.
 */
export async function findEdge(query: Query, index: number, t: number, dir: 1 | -1, now: number): Promise<number | null> {
  for (const d of [0.01, 0.1, 1, 10, 100, Infinity]) {
    const t0 = dir === 1 ? t : Math.max(0, t - d)
    const t1 = dir === 1 ? Math.min(now, t + d) : t
    if (!(t1 > t0)) return null
    const cap = await query(t0, t1)
    const tr = cap.traces.find((x) => x.index === index)
    if (tr) {
      const e = adjacentEdge(tr, t, dir, 1e-12)
      if (e !== null && e >= t0 && e <= t1) return e
    }
    if ((dir === 1 && t1 >= now) || (dir === -1 && t0 <= 0)) return null
  }
  return null
}

/** The frame after (dir 1) / before (dir -1) time `t` (frames sorted by t0). */
export function adjacentFrame(frames: readonly DecodedFrame[], t: number, dir: 1 | -1): DecodedFrame | null {
  const eps = 1e-12
  if (dir === 1) {
    for (const f of frames) if (f.t0 > t + eps) return f
    return null
  }
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i].t0 < t - eps) return frames[i]
  return null
}

/**
 * The frame ⏮ / ⏭ moves to (UX QA IS-F3): searched from the frame the user
 * is on — the picked one, else marker A — never from the window centre
 * (centreOn puts a frame's MIDDLE there, so ⏮ from the centre found the
 * current frame again). The whole recording on screen (⤢): ⏭ starts at the
 * first frame, ⏮ at the end (`mid` = now). null = none that way.
 */
export function stepFrame(
  frames: readonly DecodedFrame[],
  dir: 1 | -1,
  at: { picked: string | null; markerA: number | null; mid: number; whole: boolean },
): DecodedFrame | null {
  if (at.whole && dir === 1) return frames[0] ?? null
  const pickedT0 = at.picked ? frames.find((f) => f.id === at.picked)?.t0 : undefined
  const ref = at.whole ? at.mid : pickedT0 ?? at.markerA ?? at.mid
  return adjacentFrame(frames, ref, dir)
}

/**
 * The recorder's ring wrapped (capture.overflow) and the window ending at
 * `t1` lies before channel `index`'s oldest kept edge: its level there is
 * unknown because the edges were overwritten (UX QA IS-F12) — not 「邊緣數 0」.
 */
export function overwrittenBefore(capture: LogicCapture | null, index: number, t1: number): boolean {
  if (!capture?.overflow) return false
  const tr = capture.traces.find((x) => x.index === index)
  if (!tr || tr.initial !== 2) return false
  const first = tr.times.length > 0 ? tr.times[0] : Infinity
  return t1 < first
}
