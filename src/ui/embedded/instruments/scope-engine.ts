/**
 * Oscilloscope acquisition + drawing (used by ScopeView / ScopeCanvas in
 * src/ui/sheets/ScopeSheet.tsx).
 *
 * Acquisition works on what the recorder solved — lab.queryScope's
 * variable-step samples (high resolution), or the 1 kHz legacy feed when
 * the host has no high-resolution recorder — and never invents samples:
 *   - trigger off: a rolling window ending at the current simulation time;
 *   - trigger on: level crossings (src/instruments/trigger.ts, with
 *     hysteresis and holdoff) are searched in the last 2 windows + holdoff;
 *     the newest crossing whose post-trigger half window is complete is
 *     placed at the screen centre. Auto falls back to the rolling window
 *     when nothing triggers, Normal keeps the last triggered frame, Single
 *     captures the first crossing after arming and stops.
 * Queries are min/max decimated above MAX_POINTS per channel; a frame
 * that may be decimated is flagged so averaged measurements are marked
 * approximate.
 *
 * Drawing keeps the legacy scope screen (old ScopePanel): #0a0c10 glass,
 * 10 time divisions, autoscaled or fixed V/div grid, 10px mono labels,
 * classic channel colors, DPR ≤ 2.
 */
import type { ScopeSample } from '../../../model/types'
import type { ScopeCapture, ScopeTrace } from '../../../sim/coordinator/api'
import { findScopeTriggers } from '../../../instruments/trigger'
import { measureWave, type EdgeMeasurements } from '../../../instruments/measure'
import type { ScopeSettings } from './scope-settings'
import { t } from '../../../i18n'

/** classic scope channel colors, CH1..CH4 (= ScopeSheet's legacy TRACE_COLORS export) */
export const TRACE_COLORS = ['#ffd84a', '#43d9f6', '#ff5dd8', '#62e979']

/** per-channel point budget of one scope query (min/max decimated above it) */
export const MAX_POINTS = 8192

export const MONO_FONT = "10px 'SF Mono', 'Fira Code', monospace"

export type ScopeStatus = 'roll' | 'trig' | 'auto' | 'ready' | 'armed' | 'stop'

export interface ScopeFrame {
  /** attached channels only */
  traces: ScopeTrace[]
  /** displayed window (absolute simulation time) */
  t0: number
  t1: number
  /** time shown as 0 on the axis (trigger instant, or the window end when rolling) */
  ref: number
  trigger: { t: number; level: number; source: number } | null
  status: ScopeStatus
  /** samples may be min/max decimated (averages approximate) */
  decimated: boolean
  /** built from the 1 kHz legacy feed */
  legacy: boolean
}

export const windowOf = (s: ScopeSettings) => 10 * s.tdiv

/** The trace's samples were min/max decimated (crossing times lost — no timing measurements). */
export function traceDecimated(tr: Pick<ScopeTrace, 't' | 'decimated'>): boolean {
  return tr.decimated ?? tr.t.length >= MAX_POINTS / 2
}

/** The averages of one channel over a window, measured at full resolution (UX QA IS-F7). */
export interface FullStats {
  vavg: number | null
  vrms: number | null
  /** the median analog sample interval of the full recording (s) — the undersampling guard's (IS-F6) */
  dt: number | null
  t0: number
  t1: number
}

/**
 * Average and RMS of the channels `indices` over [t0, t1] from a
 * FULL-resolution capture (lab.queryScope without maxPoints): the min/max
 * pairs of a decimated window bias both (a 34 % PWM's mean reads high).
 * Pure.
 */
export function averagesOf(cap: ScopeCapture, indices: readonly number[], t0: number, t1: number): Map<number, FullStats> {
  const out = new Map<number, FullStats>()
  for (const i of indices) {
    const tr = cap.traces.find((x) => x.index === i)
    if (!tr || tr.t.length < 2 || tr.decimated) continue
    const m = measureWave(tr.t, tr.v, t0, t1)
    out.set(i, { vavg: m.vavg, vrms: m.vrms, dt: m.sampleInterval, t0, t1 })
  }
  return out
}

/**
 * How much of [t0, t1] the probe's own samples cover (s): from its first to
 * its last sample in the window — a probe placed a moment ago covers less
 * than the screen (UX QA IS-F10). Pure.
 */
export function amplitudeWindow(tr: Pick<ScopeTrace, 't' | 'v'>, t0: number, t1: number): number {
  let a = Infinity
  let b = -Infinity
  for (let i = 0; i < tr.t.length; i++) {
    const x = tr.t[i]
    if (x < t0 || x > t1 || !Number.isFinite(tr.v[i])) continue
    if (x < a) a = x
    if (x > b) b = x
  }
  return b > a ? b - a : 0
}

/**
 * The shortest pulse the net is known to carry (s; null = unknown): a
 * serial line's bit time (1 / baud), else the narrower polarity's typical
 * (mean) pulse of the exact edges the logic analyzer recorded (UX QA
 * IS-F6). The mean, not the single narrowest pulse: a PWM sweeping through
 * 1 % keeps its levels while its pulses are mostly wide, a UART line (pulses
 * of 1–3 bits) or a fast PWM loses them. Pure.
 */
export function shortestPulse(
  line: { baud: number } | null,
  exact: Pick<EdgeMeasurements, 'high' | 'low'> | null,
): number | null {
  if (line && line.baud > 0) return 1 / line.baud
  const widths = [exact?.high?.avg, exact?.low?.avg].filter((x): x is number => typeof x === 'number' && x > 0)
  return widths.length > 0 ? Math.min(...widths) : null
}

/**
 * A channel's voltage at time `t`, linearly interpolated between the two
 * samples around it (QA clarity SCOPE-CURSORS — the cursor readout's
 * 「CH2 1.87 V」); null outside the trace, or next to a gap (NaN) / an
 * undecimated hole. Pure.
 */
export function valueAt(tr: Pick<ScopeTrace, 't' | 'v'>, t: number): number | null {
  const n = tr.t.length
  if (n === 0 || !Number.isFinite(t) || t < tr.t[0] || t > tr.t[n - 1]) return null
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (tr.t[m] <= t) lo = m
    else hi = m
  }
  const a = tr.v[lo]
  const b = tr.v[hi]
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  const ta = tr.t[lo]
  const tb = tr.t[hi]
  if (!(tb > ta)) return a
  return a + ((t - ta) / (tb - ta)) * (b - a)
}

/**
 * The time-axis divisions that carry a label (QA clarity
 * SCOPE-READOUT-TRIGGER): every `stride`-th of 0…10, aligned so the one at
 * the reference time (the trigger instant, t = 0) is always among them —
 * with the trigger at the centre and a stride of 2: 1, 3, 5, 7, 9.
 */
export function labelledDivisions(stride: number, refDiv: number | null): number[] {
  const offset = refDiv !== null && Number.isInteger(refDiv) && refDiv >= 0 && refDiv <= 10 ? refDiv % stride : 0
  const out: number[] = []
  for (let i = offset; i <= 10; i += stride) out.push(i)
  return out
}

/** The query window for the current settings at simulation time `now`. */
export function queryWindow(s: ScopeSettings, now: number, armedAt: number | null): { q0: number; q1: number } {
  const W = windowOf(s)
  if (s.trigSource === null) return { q0: Math.max(0, now - W), q1: now }
  let q0 = now - 2 * W - s.holdoff
  if (s.trigMode === 'single' && armedAt !== null) q0 = Math.max(q0, armedAt - W)
  return { q0: Math.max(0, q0), q1: now }
}

/** Legacy 1 kHz feed → a ScopeCapture over [t0, t1] (NaN = channel unattached). */
export function legacyCapture(samples: readonly ScopeSample[], t0: number, t1: number): ScopeCapture {
  const traces: ScopeTrace[] = []
  for (let c = 0; c < 4; c++) {
    const t: number[] = []
    const v: number[] = []
    for (const s of samples) {
      if (s.t < t0 || s.t > t1) continue
      const x = s.v[c]
      if (!Number.isFinite(x)) continue
      t.push(s.t)
      v.push(x)
    }
    if (t.length) traces.push({ index: c, label: `CH${c + 1}`, t: Float64Array.from(t), v: Float32Array.from(v) })
  }
  return { t0, t1, traces }
}

export interface BuildInput {
  cap: ScopeCapture
  settings: ScopeSettings
  now: number
  attached: readonly boolean[]
  legacy: boolean
  /** previous frame (Normal mode keeps it while nothing triggers) */
  prev: ScopeFrame | null
  /** Single mode: arm instant (null = not armed) */
  armedAt: number | null
}

function rolling(traces: ScopeTrace[], now: number, W: number, status: ScopeStatus, decimated: boolean, legacy: boolean): ScopeFrame {
  return { traces, t0: now - W, t1: now, ref: now, trigger: null, status, decimated, legacy }
}

export function buildFrame(inp: BuildInput): ScopeFrame {
  const { settings: s, now, legacy } = inp
  const W = windowOf(s)
  const traces = inp.cap.traces.filter((tr) => inp.attached[tr.index])
  // the recorder says when it decimated (ScopeTrace.decimated); older hosts: the point budget
  const decimated = !legacy && traces.some((tr) => traceDecimated(tr))
  if (s.trigSource === null) return rolling(traces, now, W, 'roll', decimated, legacy)

  const src = traces.find((tr) => tr.index === s.trigSource)
  const hold = (status: ScopeStatus): ScopeFrame =>
    inp.prev && inp.prev.trigger ? { ...inp.prev, status } : { ...rolling([], now, W, status, false, legacy) }
  if (s.trigMode === 'single' && inp.armedAt === null) return hold('stop')
  let hit: number | null = null
  if (src && src.t.length > 1) {
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < src.v.length; i++) {
      const x = src.v[i]
      if (x < lo) lo = x
      if (x > hi) hi = x
    }
    const hysteresis = Number.isFinite(hi - lo) ? 0.02 * (hi - lo) : 0
    const trigs = findScopeTriggers(src.t, src.v, {
      level: s.trigLevel,
      slope: s.trigSlope,
      hysteresis,
      holdoff: s.holdoff,
      to: now - W / 2,
    })
    const from = s.trigMode === 'single' ? Math.max(inp.armedAt ?? -Infinity, inp.cap.t0 + W / 2) : inp.cap.t0 + W / 2
    const ok = trigs.filter((t) => t >= from)
    if (ok.length) hit = s.trigMode === 'single' ? ok[0] : ok[ok.length - 1]
  }
  if (hit === null) {
    if (s.trigMode === 'auto') return rolling(traces, now, W, 'auto', decimated, legacy)
    if (s.trigMode === 'single') return { ...rolling(traces, now, W, 'armed', decimated, legacy) }
    return hold('ready')
  }
  return {
    traces,
    t0: hit - W / 2,
    t1: hit + W / 2,
    ref: hit,
    trigger: { t: hit, level: s.trigLevel, source: s.trigSource },
    status: s.trigMode === 'single' ? 'stop' : 'trig',
    decimated,
    legacy,
  }
}

// ------------------------------------------------------------------ drawing

function niceStep(rough: number): number {
  if (!(rough > 0) || !Number.isFinite(rough)) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const m = rough / pow
  if (m <= 1) return pow
  if (m <= 2) return 2 * pow
  if (m <= 5) return 5 * pow
  return 10 * pow
}

function fmtVTick(v: number, step: number): string {
  const decimals = Math.max(0, Math.min(3, -Math.floor(Math.log10(step))))
  return `${v.toFixed(decimals)}V`
}

/** Axis time label relative to the reference (legacy format for ≥ 10 ms windows). */
export function fmtTimeOffset(dt: number, window: number): string {
  if (Math.abs(dt) < window * 1e-9) return '0'
  if (window >= 1) return `${dt.toFixed(1)}s`
  if (window >= 0.01) return `${Math.round(dt * 1000)}ms`
  if (window >= 1e-3) return `${(dt * 1000).toFixed(1)}ms`
  if (window >= 1e-5) return `${Math.round(dt * 1e6)}µs`
  return `${(dt * 1e6).toFixed(1)}µs`
}

/** Vertical range of the screen for a frame (auto: legacy autoscale). */
export function verticalRange(frame: ScopeFrame | null, s: ScopeSettings): { vmin: number; vmax: number } {
  if (s.vdiv !== 'auto') {
    const vmin = -s.vpos * s.vdiv
    return { vmin, vmax: vmin + 8 * s.vdiv }
  }
  let vmin = Infinity
  let vmax = -Infinity
  if (frame) {
    for (const tr of frame.traces) {
      for (let i = 0; i < tr.t.length; i++) {
        if (tr.t[i] < frame.t0 || tr.t[i] > frame.t1) continue
        const x = tr.v[i]
        if (Number.isFinite(x)) {
          if (x < vmin) vmin = x
          if (x > vmax) vmax = x
        }
      }
    }
  }
  if (!Number.isFinite(vmin) || vmax - vmin < 1e-6) {
    if (Number.isFinite(vmin) && (vmin < -1 || vmax > 6)) {
      // flat trace outside the default range: center on it
      const mid = (vmin + vmax) / 2
      return { vmin: mid - 1, vmax: mid + 1 }
    }
    return { vmin: -1, vmax: 6 }
  }
  const pad = (vmax - vmin) * 0.08
  return { vmin: vmin - pad, vmax: vmax + pad }
}

export interface ScopeLayout {
  W: number
  H: number
  padL: number
  padT: number
  pw: number
  ph: number
  vmin: number
  vmax: number
}

export const PAD = { l: 46, r: 8, t: 8, b: 18 }

export interface ScopeCursors {
  mode: 'off' | 'time' | 'volt'
  /** time cursors relative to frame.ref (s) */
  x: [number, number]
  /** voltage cursors (V) */
  y: [number, number]
}

/** Absolute-time axis label (the logic analyzer's clock): "3.52 s", "412.5 ms". */
export function fmtAbsTime(t: number, window: number): string {
  if (window >= 1 || Math.abs(t) >= 10) return `${t.toFixed(window >= 10 ? 1 : window >= 1 ? 2 : 3)}s`
  if (Math.abs(t) >= 1) return `${t.toFixed(window >= 0.01 ? 3 : window >= 1e-4 ? 5 : 6)}s`
  if (window >= 1e-3) return `${(t * 1e3).toFixed(window >= 0.01 ? 1 : 2)}ms`
  return `${(t * 1e6).toFixed(window >= 1e-5 ? 0 : 1)}µs`
}

export interface DrawOptions {
  /** axis labels in absolute simulation time (UX IS-8) */
  absTime?: boolean
  /** the instruments' shared cursor (lab.labCursor), drawn when inside the window */
  sharedCursor?: number | null
  /** thin the time-axis labels out when they would overlap (product chrome; classic keeps every 2nd division) */
  fitLabels?: boolean
  /**
   * H3 spacing on the axis labels (product chrome, UX IS-17): a space
   * before the unit and the typographic minus — 「−5.0 s」「6 V」, like the
   * logic analyzer's ticks. Classic keeps 「-5.0s」「6V」.
   */
  units?: boolean
  /**
   * Product chrome (UX IS-14): what to say when the window holds no sample
   * — no probe / not running / a timebase faster than the solver's step.
   * Set = the screen judges "no data" by the samples INSIDE the window (a
   * window between two solver steps is not black and silent any more).
   */
  emptyText?: string
  /**
   * Product chrome (QA clarity SCOPE-CURSORS): the cursor flags' names — the
   * logic analyzer's 「A」「B」 for time, 「電壓 1」「電壓 2」 for voltage.
   * Absent: the classic X1 / X2 / Y1 / Y2.
   */
  cursorNames?: { time: [string, string]; volt: [string, string] }
  /** Product chrome: the hover hairline's time (absolute; null / absent = none) */
  hoverT?: number | null
}

/** Some trace of `frame` has at least two samples inside its displayed window (enough to show and measure). */
export function frameHasSamplesInWindow(frame: ScopeFrame | null): boolean {
  if (!frame) return false
  for (const tr of frame.traces) {
    let lo = 0
    let hi = tr.t.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tr.t[mid] < frame.t0) lo = mid + 1
      else hi = mid
    }
    if (lo + 1 < tr.t.length && tr.t[lo + 1] <= frame.t1) return true
  }
  return false
}

/**
 * Product chrome: how much earlier than the window to query (s) so the
 * segment of the solver's last step before a very short window is there to
 * draw (the longest analog step is 50 µs) — never for windows long enough
 * to be decimated by a doubled query.
 */
export function queryLead(s: ScopeSettings): number {
  return windowOf(s) < 1e-3 ? 1e-4 : 0
}

/** The space between a tick's number and its unit (thin: axis labels are tight; the logic analyzer uses the same). */
export const TICK_SPACE = ' '

/** "-5.0s" → "−5.0 s", "6V" → "6 V", "412ms" → "412 ms" (H3 spacing with a thin space; "0" stays). */
export function spacedLabel(label: string): string {
  const m = /^(-?)([\d.]+)([a-zµA-Z]*)$/.exec(label)
  if (!m) return label
  const num = m[1] && !/^0(?:\.0*)?$/.test(m[2]) ? `−${m[2]}` : m[2]
  return m[3] ? `${num}${TICK_SPACE}${m[3]}` : num
}

export function drawScopeFrame(
  canvas: HTMLCanvasElement,
  frame: ScopeFrame | null,
  s: ScopeSettings,
  cursors?: ScopeCursors,
  opts: DrawOptions = {},
): ScopeLayout | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const W = canvas.width / dpr
  const H = canvas.height / dpr
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#0a0c10'
  ctx.fillRect(0, 0, W, H)

  const padL = PAD.l
  const padT = PAD.t
  const pw = W - PAD.l - PAD.r
  const ph = H - PAD.t - PAD.b
  if (pw < 20 || ph < 20) {
    ctx.restore()
    return null
  }
  const span = windowOf(s)
  const t0 = frame ? frame.t0 : -span
  const ref = frame ? frame.ref : 0
  const { vmin, vmax } = verticalRange(frame, s)
  const yOf = (v: number) => padT + (1 - (v - vmin) / (vmax - vmin)) * ph
  const xOf = (t: number) => padL + ((t - t0) / span) * pw

  // ---- grid ----
  ctx.lineWidth = 1
  ctx.strokeStyle = '#1c212a'
  ctx.beginPath()
  for (let i = 0; i <= 10; i++) {
    const x = padL + (pw * i) / 10
    ctx.moveTo(x, padT)
    ctx.lineTo(x, padT + ph)
  }
  ctx.stroke()

  const ticks: { y: number; v: number }[] = []
  let step: number
  ctx.beginPath()
  if (s.vdiv === 'auto') {
    step = niceStep((vmax - vmin) / 5)
    const firstTick = Math.ceil(vmin / step) * step
    for (let v = firstTick; v <= vmax + step * 1e-6; v += step) {
      const y = yOf(v)
      ctx.moveTo(padL, y)
      ctx.lineTo(padL + pw, y)
      ticks.push({ y, v: Math.abs(v) < step * 1e-6 ? 0 : v })
    }
  } else {
    step = s.vdiv
    const every = ph / 8 < 14 ? 2 : 1
    for (let i = 0; i <= 8; i++) {
      const v = vmin + i * s.vdiv
      const y = yOf(v)
      ctx.moveTo(padL, y)
      ctx.lineTo(padL + pw, y)
      if (i % every === 0) ticks.push({ y, v: Math.abs(v) < step * 1e-6 ? 0 : v })
    }
  }
  ctx.stroke()

  // emphasized zero line
  if (vmin < 0 && vmax > 0) {
    ctx.strokeStyle = '#39414f'
    ctx.beginPath()
    const y0 = yOf(0)
    ctx.moveTo(padL, y0)
    ctx.lineTo(padL + pw, y0)
    ctx.stroke()
  }

  // frame
  ctx.strokeStyle = '#2a303b'
  ctx.strokeRect(padL + 0.5, padT + 0.5, pw - 1, ph - 1)

  // ---- axis labels ----
  ctx.fillStyle = '#7d8694'
  ctx.font = MONO_FONT
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const unitLabel = (s: string) => (opts.units ? spacedLabel(s) : s)
  for (const t of ticks) {
    const raw = fmtVTick(t.v, step)
    let label = unitLabel(raw)
    // the volt column is 46 px: a label that does not fit loses its space, never its digits
    if (opts.units && ctx.measureText(label).width > padL - 6) label = label.replace(TICK_SPACE, '')
    ctx.fillText(label, padL - 5, t.y)
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const timeLabel = (i: number) =>
    unitLabel(opts.absTime && frame ? fmtAbsTime(t0 + (span * i) / 10, span) : fmtTimeOffset(t0 + (span * i) / 10 - ref, span))
  // a label every 2 divisions; with fitLabels, every 5 or 10 when they would
  // run into each other (a phone-width screen: '-0.6ms0.2ms…' is unreadable)
  let stride = 2
  if (opts.fitLabels) {
    let widest = 0
    for (let i = 0; i <= 10; i += 1) widest = Math.max(widest, ctx.measureText(timeLabel(i)).width)
    while (stride < 10 && (pw * stride) / 10 < widest + 10) stride = stride === 2 ? 5 : 10
  }
  // product chrome: the reference time (the trigger instant, 0) always carries its label (QA clarity SCOPE-READOUT-TRIGGER)
  const refPos = ((ref - t0) / span) * 10
  const refDiv = opts.fitLabels && Math.abs(refPos - Math.round(refPos)) < 1e-6 ? Math.round(refPos) : null
  for (const i of opts.fitLabels ? labelledDivisions(stride, refDiv) : labelledDivisions(stride, null)) {
    const x = padL + (pw * i) / 10
    const label = timeLabel(i)
    // the right-most label stays inside the canvas
    const half = ctx.measureText(label).width / 2
    ctx.fillText(label, Math.min(x, W - 2 - half), padT + ph + 4)
  }

  const layout: ScopeLayout = { W, H, padL, padT, pw, ph, vmin, vmax }
  const anySample = !!frame && frame.traces.some((tr) => tr.t.length > 0)
  const hasData = opts.emptyText !== undefined ? frameHasSamplesInWindow(frame) : anySample
  if (!hasData) {
    // the one sentence that says what to do next: body-size, readable (UX IS-9)
    ctx.fillStyle = 'rgba(235, 238, 245, 0.78)'
    ctx.font = "13px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Noto Sans TC', 'PingFang TC', sans-serif"
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const msg =
      frame && (frame.status === 'ready' || frame.status === 'armed')
        ? t('waiting for trigger')
        : opts.emptyText ?? t('no samples — place a scope probe and press Run')
    ctx.fillText(msg, padL + pw / 2, padT + ph / 2, pw - 16)
  }

  // ---- traces (clipped to the graticule) ----
  ctx.save()
  ctx.beginPath()
  ctx.rect(padL, padT, pw, ph)
  ctx.clip()
  // (a window between two solver steps: the line segment crossing it is still drawn)
  if (frame && (hasData || (opts.emptyText !== undefined && anySample))) {
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    for (const tr of frame.traces) {
      ctx.strokeStyle = TRACE_COLORS[tr.index] ?? '#f2f2f7'
      drawTrace(ctx, tr, frame.t0, frame.t1, xOf, yOf, pw)
    }
  }
  ctx.restore()

  // ---- trigger markers ----
  if (s.trigSource !== null) {
    const color = TRACE_COLORS[s.trigSource]
    const yl = yOf(s.trigLevel)
    if (yl >= padT && yl <= padT + ph) {
      // level arrow on the left edge of the graticule
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(padL + 7, yl)
      ctx.lineTo(padL + 1, yl - 4)
      ctx.lineTo(padL + 1, yl + 4)
      ctx.closePath()
      ctx.fill()
    }
    if (frame?.trigger) {
      const xt = xOf(frame.trigger.t)
      ctx.fillStyle = '#ff9f0a'
      ctx.beginPath()
      ctx.moveTo(xt, padT + 7)
      ctx.lineTo(xt - 4, padT + 1)
      ctx.lineTo(xt + 4, padT + 1)
      ctx.closePath()
      ctx.fill()
    }
  }

  // ---- product chrome: the hover hairline (QA clarity SCOPE-CURSORS — like the logic analyzer's) ----
  if (frame && opts.hoverT !== null && opts.hoverT !== undefined && opts.hoverT >= frame.t0 && opts.hoverT <= frame.t1) {
    const x = Math.round(xOf(opts.hoverT)) + 0.5
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.beginPath()
    ctx.moveTo(x, padT)
    ctx.lineTo(x, padT + ph)
    ctx.stroke()
  }

  // ---- the instruments' shared time cursor (marker A of the analyzer, a UART line …) ----
  const shared = opts.sharedCursor
  if (frame && shared !== null && shared !== undefined && shared >= frame.t0 && shared <= frame.t1) {
    const x = Math.round(xOf(shared)) + 0.5
    ctx.strokeStyle = 'rgba(191, 90, 242, 0.9)'
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(x, padT)
    ctx.lineTo(x, padT + ph)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // ---- cursors ----
  if (cursors && cursors.mode !== 'off') {
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 1
    ctx.font = MONO_FONT
    ctx.textBaseline = 'top'
    const colors = ['rgba(100, 181, 255, 0.95)', 'rgba(94, 224, 200, 0.95)']
    for (let k = 0; k < 2; k++) {
      ctx.strokeStyle = colors[k]
      ctx.fillStyle = colors[k]
      ctx.beginPath()
      if (cursors.mode === 'time') {
        const x = Math.round(xOf(ref + cursors.x[k])) + 0.5
        if (x < padL || x > padL + pw) continue
        ctx.moveTo(x, padT)
        ctx.lineTo(x, padT + ph)
        ctx.stroke()
        ctx.textAlign = 'left'
        ctx.fillText(opts.cursorNames ? opts.cursorNames.time[k] : k === 0 ? 'X1' : 'X2', x + 3, padT + 2 + k * 12)
      } else {
        const y = Math.round(yOf(cursors.y[k])) + 0.5
        if (y < padT || y > padT + ph) continue
        ctx.moveTo(padL, y)
        ctx.lineTo(padL + pw, y)
        ctx.stroke()
        ctx.textAlign = 'right'
        ctx.fillText(opts.cursorNames ? opts.cursorNames.volt[k] : k === 0 ? 'Y1' : 'Y2', padL + pw - 3, y + 2)
      }
    }
    ctx.setLineDash([])
  }
  ctx.restore()
  return layout
}

/** One trace: a polyline, or per-pixel-column min/max bars when denser than 2 samples/px. */
function drawTrace(
  ctx: CanvasRenderingContext2D,
  tr: ScopeTrace,
  t0: number,
  t1: number,
  xOf: (t: number) => number,
  yOf: (v: number) => number,
  pw: number,
): void {
  const n = tr.t.length
  // first sample at/after t0 (keep one before for continuity)
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (tr.t[mid] < t0) lo = mid + 1
    else hi = mid
  }
  const i0 = Math.max(0, lo - 1)
  let i1 = i0
  while (i1 < n && tr.t[i1] <= t1) i1++
  i1 = Math.min(n, i1 + 1)
  const count = i1 - i0
  if (count <= 0) return
  ctx.beginPath()
  if (count <= pw * 2) {
    let pen = false
    for (let i = i0; i < i1; i++) {
      const v = tr.v[i]
      if (!Number.isFinite(v)) {
        pen = false // NaN = gap → lift the pen
        continue
      }
      const x = xOf(tr.t[i])
      const y = yOf(v)
      if (pen) ctx.lineTo(x, y)
      else {
        ctx.moveTo(x, y)
        pen = true
      }
    }
    ctx.stroke()
    return
  }
  // dense: one vertical min/max bar per pixel column, joined in order
  let col = Math.floor(xOf(tr.t[i0]))
  let cmin = Infinity
  let cmax = -Infinity
  let first = NaN
  let last = NaN
  let pen = false
  const flush = () => {
    if (!Number.isFinite(cmin)) return
    const x = col + 0.5
    if (pen) ctx.lineTo(x, yOf(first))
    else ctx.moveTo(x, yOf(first))
    ctx.lineTo(x, yOf(cmin))
    ctx.lineTo(x, yOf(cmax))
    ctx.lineTo(x, yOf(last))
    pen = true
  }
  for (let i = i0; i < i1; i++) {
    const v = tr.v[i]
    if (!Number.isFinite(v)) {
      flush()
      cmin = Infinity
      cmax = -Infinity
      first = NaN
      pen = false
      continue
    }
    const c = Math.floor(xOf(tr.t[i]))
    if (c !== col) {
      flush()
      col = c
      cmin = Infinity
      cmax = -Infinity
      first = v
    }
    if (!Number.isFinite(first)) first = v
    if (v < cmin) cmin = v
    if (v > cmax) cmax = v
    last = v
  }
  flush()
  ctx.stroke()
}
