/**
 * Capture exporters — pure text builders (the browser download lives in
 * the UI layer, src/ui/embedded/instruments/download.ts).
 *
 * VCD (IEEE Std 1364-2005 §18.2, four-state value change dump): header
 * ($date, $version, $comment, $timescale 1 ns, one `wire 1` per logic
 * channel inside $scope module, $enddefinitions), the initial values in
 * $dumpvars at #0, then value changes at integer nanosecond timestamps
 * RELATIVE TO THE CAPTURE START (the absolute start is in $comment).
 * Levels: 0, 1, x (= undefined: floating / contention). Several edges of
 * one channel that round to the same nanosecond collapse to the last level
 * (a < 1 ns pulse — the simulated MCUs clock at ≤ 72 MHz, ≥ 13.9 ns).
 *
 * CSV (RFC 4180: comma separated, CRLF line ends, fields with a comma,
 * quote or line break quoted with doubled quotes), times in seconds with 9
 * decimals (1 ns):
 *   - scope:  time_s, then one voltage column per channel; rows are the
 *             union of every channel's sample times (a channel without a
 *             sample at that time leaves its cell empty),
 *   - logic:  time_s,channel,label,level — the level of every channel at
 *             the capture start, then every edge in time order,
 *   - decoder annotations: start_s,end_s,decoder,row,kind,text.
 */
import type { LogicCapture, ScopeCapture } from '../sim/coordinator/api'
import type { Annotation } from './types'

// ------------------------------------------------------------------ VCD

export interface VcdOptions {
  /** $date text (omitted when undefined — keeps the output reproducible) */
  date?: string
  /** extra $comment text */
  comment?: string
  /** $version text (default "ohmlet logic analyzer") */
  version?: string
}

/** VCD identifier code n: printable ASCII 33..126, base 94. */
export function vcdId(n: number): string {
  let s = ''
  let k = n
  do {
    s += String.fromCharCode(33 + (k % 94))
    k = Math.floor(k / 94) - 1
  } while (k >= 0)
  return s
}

/** A VCD-safe reference name (no whitespace; letters, digits, _ and . kept). */
export function vcdName(label: string): string {
  const s = label.trim().replace(/[^A-Za-z0-9_.]+/g, '_')
  return s.length > 0 ? s : 'ch'
}

const VCD_LEVEL = ['0', '1', 'x'] as const

export function toVcd(capture: LogicCapture, opts: VcdOptions = {}): string {
  const lines: string[] = []
  if (opts.date !== undefined) lines.push('$date', `  ${opts.date}`, '$end')
  lines.push('$version', `  ${opts.version ?? 'ohmlet logic analyzer'}`, '$end')
  lines.push(
    '$comment',
    `  capture window ${capture.t0.toFixed(9)} s .. ${capture.t1.toFixed(9)} s (simulation time); #0 = window start`,
  )
  if (capture.overflow) lines.push('  WARNING: the edge buffer wrapped - the oldest edges of this window are missing')
  if (opts.comment) lines.push(`  ${opts.comment}`)
  lines.push('$end', '$timescale 1 ns $end', '$scope module ohmlet $end')
  const traces = capture.traces.slice().sort((a, b) => a.index - b.index)
  const used = new Set<string>()
  traces.forEach((tr, k) => {
    let name = vcdName(tr.label || `D${tr.index}`)
    if (used.has(name)) name = `${name}_D${tr.index}`
    used.add(name)
    lines.push(`$var wire 1 ${vcdId(k)} ${name} $end`)
  })
  lines.push('$upscope $end', '$enddefinitions $end')
  lines.push('#0', '$dumpvars')
  traces.forEach((tr, k) => lines.push(`${VCD_LEVEL[tr.initial] ?? 'x'}${vcdId(k)}`))
  lines.push('$end')

  // merge every channel's edges, grouped by integer nanosecond
  const events: { ns: number; k: number; level: number; seq: number }[] = []
  let seq = 0
  traces.forEach((tr, k) => {
    for (let i = 0; i < tr.times.length; i++) {
      const ns = Math.max(0, Math.round((tr.times[i] - capture.t0) * 1e9))
      events.push({ ns, k, level: tr.levels[i], seq: seq++ })
    }
  })
  events.sort((a, b) => a.ns - b.ns || a.seq - b.seq)
  const current = traces.map((tr) => tr.initial as number)
  let e = 0
  while (e < events.length) {
    const ns = events[e].ns
    const last = new Map<number, number>()
    while (e < events.length && events[e].ns === ns) {
      last.set(events[e].k, events[e].level)
      e++
    }
    const changes: string[] = []
    for (const [k, level] of [...last.entries()].sort((a, b) => a[0] - b[0])) {
      if (current[k] === level) continue
      current[k] = level
      changes.push(`${VCD_LEVEL[level] ?? 'x'}${vcdId(k)}`)
    }
    if (changes.length === 0) continue
    // (changes at #0 continue the initial #0 block — time never repeats)
    if (ns > 0) lines.push(`#${ns}`)
    lines.push(...changes)
  }
  const endNs = Math.max(0, Math.round((capture.t1 - capture.t0) * 1e9))
  const lastStamp = events.length ? events[events.length - 1].ns : 0
  if (endNs > lastStamp) lines.push(`#${endNs}`)
  return lines.join('\n') + '\n'
}

// ------------------------------------------------------------------ CSV

/** One CSV field (RFC 4180 quoting). */
export function csvField(v: string | number): string {
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n'
}

const ts = (t: number) => t.toFixed(9)

/** Scope samples: time_s + one column per channel ("CH1 (PRB1) V"). */
export function scopeCsv(capture: ScopeCapture): string {
  const traces = capture.traces.slice().sort((a, b) => a.index - b.index)
  const header = ['time_s', ...traces.map((tr) => `CH${tr.index + 1}${tr.label && tr.label !== `CH${tr.index + 1}` ? ` (${tr.label})` : ''} V`)]
  const rows: (string | number)[][] = [header]
  const idx = traces.map(() => 0)
  for (;;) {
    let tNext = Infinity
    traces.forEach((tr, k) => {
      if (idx[k] < tr.t.length && tr.t[idx[k]] < tNext) tNext = tr.t[idx[k]]
    })
    if (tNext === Infinity) break
    const row: (string | number)[] = [ts(tNext)]
    traces.forEach((tr, k) => {
      if (idx[k] < tr.t.length && tr.t[idx[k]] === tNext) {
        const v = tr.v[idx[k]++]
        row.push(Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '')
      } else row.push('')
    })
    rows.push(row)
  }
  return csv(rows)
}

/** Logic edges: initial levels at the capture start, then every edge. */
export function logicEdgesCsv(capture: LogicCapture): string {
  const lvl = (l: number) => (l === 0 ? '0' : l === 1 ? '1' : 'x')
  const traces = capture.traces.slice().sort((a, b) => a.index - b.index)
  const rows: (string | number)[][] = [['time_s', 'channel', 'label', 'level']]
  for (const tr of traces) rows.push([ts(capture.t0), `D${tr.index}`, tr.label, lvl(tr.initial)])
  const events: { t: number; ch: number; label: string; level: number; seq: number }[] = []
  let seq = 0
  for (const tr of traces) {
    for (let i = 0; i < tr.times.length; i++) {
      events.push({ t: tr.times[i], ch: tr.index, label: tr.label, level: tr.levels[i], seq: seq++ })
    }
  }
  events.sort((a, b) => a.t - b.t || a.seq - b.seq)
  for (const e of events) rows.push([ts(e.t), `D${e.ch}`, e.label, lvl(e.level)])
  return csv(rows)
}

export interface AnnotationGroup {
  /** decoder instance label, e.g. "UART · PA9" */
  decoder: string
  /** row id → row label */
  rowLabels?: Record<string, string>
  annotations: readonly Annotation[]
}

/** Decoder annotations of several decoders, sorted by start time. */
export function annotationsCsv(groups: readonly AnnotationGroup[]): string {
  const all: { a: Annotation; g: AnnotationGroup; seq: number }[] = []
  let seq = 0
  for (const g of groups) for (const a of g.annotations) all.push({ a, g, seq: seq++ })
  all.sort((x, y) => x.a.t0 - y.a.t0 || x.seq - y.seq)
  const rows: (string | number)[][] = [['start_s', 'end_s', 'decoder', 'row', 'kind', 'text']]
  for (const { a, g } of all) rows.push([ts(a.t0), ts(a.t1), g.decoder, g.rowLabels?.[a.row] ?? a.row, a.kind, a.text])
  return csv(rows)
}
