/**
 * Logic-analyzer protocol decoder registry. A decoder turns the RAW edge
 * lists of a capture into annotation rows that the analyzer draws under
 * the traces; it never sees peripheral state — decoding works from the
 * wire exactly like a real analyzer, so a mis-wired bus decodes as
 * garbage, not as success.
 *
 * The decoders themselves are pure functions in src/instruments/decoders
 * (UART, I²C, SPI, 1-Wire); this module adapts them to the analyzer: a
 * decoder INSTANCE (LogicDecoderConfig) maps the decoder's channel roles
 * to analyzer channels and carries its parameters, and its rows are laid
 * out under the channel of the row's role.
 */
import type { LogicCapture, LogicTrace } from '../../sim/coordinator/api'
import { DECODERS, defaultParams, type DecoderSpec } from '../../instruments/decoders'
import type { Annotation, DecodeResult } from '../../instruments/types'
import { fmtHex } from '../../instruments/format'
import { t } from '../../i18n'

export type { Annotation }

/** One decoded span (a byte, a START, an ACK …) on the time axis. */
export interface LogicAnnotation {
  t0: number
  t1: number
  text: string
  /** compact label for narrow spans */
  short?: string
  /** semantic tone; the view maps it to a palette color */
  tone?: 'data' | 'addr' | 'control' | 'ack' | 'nack' | 'error'
}

/** A horizontal lane of annotations drawn under the traces. */
export interface LogicAnnotationRow {
  /** stable id (decoder instance + lane) */
  id: string
  label: string
  /** channel index this row belongs to (rows group under their channel) */
  channel: number
  items: LogicAnnotation[]
  /**
   * The same lane one level up (UART: whole lines, "Hello from STM32F103!\r\n"),
   * drawn instead of `items` when those are too narrow to carry a label at
   * the current zoom (UX IS-8: a revealed line is readable). Additive.
   */
  coarse?: LogicAnnotation[]
}

/** User configuration of one decoder instance (channels mapped by role). */
export interface LogicDecoderConfig {
  /** instance id (stable across edits; defaults to the decoder id) */
  id?: string
  decoder: string
  /** role → channel index, e.g. { data: 0 } or { scl: 2, sda: 3 } */
  channels: Record<string, number>
  options?: Record<string, number | string | boolean>
}

export interface LogicDecoder {
  id: string
  label: string
  /** channel roles the user can map, e.g. ['scl', 'sda'] */
  roles: string[]
  /** roles that must be mapped before the decoder runs */
  required?: string[]
  /** parameter / role metadata for configuration UIs */
  spec?: DecoderSpec
  decode(capture: LogicCapture, config: LogicDecoderConfig): LogicAnnotationRow[]
}

/** Full result of one decoder instance (rows + raw annotations + notes). */
export interface DecoderRun {
  config: LogicDecoderConfig
  decoder: LogicDecoder
  rows: LogicAnnotationRow[]
  /** raw annotations (exports) — empty when roles are unmapped */
  annotations: Annotation[]
  /** row id → label */
  rowLabels: Record<string, string>
  info: string[]
  /** required roles without a channel */
  missing: string[]
}

const registry = new Map<string, LogicDecoder>()

export function registerDecoder(d: LogicDecoder): void {
  registry.set(d.id, d)
}

export function decoders(): LogicDecoder[] {
  return [...registry.values()]
}

export function getDecoder(id: string): LogicDecoder | undefined {
  return registry.get(id)
}

const TONES: Record<Annotation['kind'], LogicAnnotation['tone']> = {
  data: 'data',
  addr: 'addr',
  ctrl: 'control',
  error: 'error',
}

/**
 * An SPI transfer's words as the UI shows them (UX IS-14): 「MOSI 0x02 0x80 ·
 * MISO 0xFF」 — every word through fmtHex, one format with the byte lanes.
 */
export function transferText(tr: NonNullable<Annotation['transfer']>): string {
  const parts: string[] = []
  const line = (name: string, words: number[] | undefined) => {
    if (words) parts.push(`${name} ${words.map((v) => fmtHex(v, tr.bits)).join(' ') || '—'}`)
  }
  line('MOSI', tr.mosi)
  line('MISO', tr.miso)
  return parts.join(' · ')
}

/**
 * The decoders' English wire texts a person reads in the lanes, in the UI
 * language (UX IS-14 — 「準位不明」, 「不完整字組（3 位元）」, the SPI mode
 * error); everything technical (addresses, bytes, START / ACK) stays as is.
 * Display only: exports and tests keep the decoders' own `text`.
 */
export function annotationDisplayText(a: Annotation): string {
  if (a.transfer) {
    const words = transferText(a.transfer)
    return a.transfer.modeError ? `${t('SCK idle ≠ CPOL {cpol}', { cpol: a.transfer.modeError.cpol })} · ${words}` : words
  }
  if (a.text === 'undefined level') return t('undefined level|decode')
  const inc = /^incomplete word \((\d+) bits?\)$/.exec(a.text)
  if (inc) return t('incomplete word ({n} bits)', { n: Number(inc[1]) })
  return a.text
}

function toLogic(a: Annotation): LogicAnnotation {
  const out: LogicAnnotation = { t0: a.t0, t1: a.t1, text: annotationDisplayText(a), tone: a.tone ?? TONES[a.kind] }
  if (a.short !== undefined) out.short = a.short
  return out
}

function instanceId(cfg: LogicDecoderConfig): string {
  return cfg.id ?? cfg.decoder
}

/** Run one spec-backed decoder over a capture (shared by decode / runDecoder). */
function runSpec(spec: DecoderSpec, capture: LogicCapture, cfg: LogicDecoderConfig) {
  const traces: Record<string, LogicTrace | undefined> = {}
  const missing: string[] = []
  // a capture without any trace = nothing recorded yet (before the first run):
  // a mapped role is then waiting for data, not missing its channel
  let noData = false
  for (const role of spec.roles) {
    const ch = cfg.channels[role.id]
    const tr = typeof ch === 'number' ? capture.traces.find((t) => t.index === ch) : undefined
    traces[role.id] = tr
    if (tr || role.optional) continue
    if (typeof ch === 'number' && capture.traces.length === 0) noData = true
    else missing.push(role.id)
  }
  const params = defaultParams(spec)
  for (const [k, v] of Object.entries(cfg.options ?? {})) params[k] = String(v)
  const result: DecodeResult | null = missing.length === 0 && !noData ? spec.run(traces, params, capture.t1) : null
  return { result, missing }
}

function rowsOf(spec: DecoderSpec, cfg: LogicDecoderConfig, result: DecodeResult): LogicAnnotationRow[] {
  const id = instanceId(cfg)
  const fallback = Object.values(cfg.channels).find((c) => typeof c === 'number') ?? 0
  return result.rows.map((row) => {
    const anns = result.annotations.filter((a) => a.row === row.id)
    const out: LogicAnnotationRow = {
      id: `${id}:${row.id}`,
      label: row.label,
      channel: cfg.channels[row.role] ?? fallback,
      items: anns.map(toLogic),
    }
    if (spec.id === 'uart' && row.id === 'data' && anns.length > 0) out.coarse = uartLines(anns)
    return out
  })
}

/** UART bytes as lines (the decoded-results grouping): one span per line / burst, its text escaped. */
function uartLines(anns: readonly Annotation[]): LogicAnnotation[] {
  const out: LogicAnnotation[] = []
  for (const g of burstsOf([...anns], 2, (a) => a.value === 0x0a)) {
    const vals = g.filter((a) => typeof a.value === 'number').map((a) => a.value as number)
    const text = vals.length > 0 ? escapeBytes(vals).slice(1, -1) : g.map((a) => a.short ?? a.text).join(' ')
    const err = g.some((a) => a.kind === 'error')
    out.push({ t0: g[0].t0, t1: g[g.length - 1].t1, text, short: text.length > 6 ? `${text.slice(0, 5)}…` : text, tone: err ? 'error' : 'data' })
  }
  return out
}

function specDecoder(spec: DecoderSpec): LogicDecoder {
  return {
    id: spec.id,
    label: spec.label,
    roles: spec.roles.map((r) => r.id),
    required: spec.roles.filter((r) => !r.optional).map((r) => r.id),
    spec,
    decode(capture, cfg) {
      const { result } = runSpec(spec, capture, cfg)
      return result ? rowsOf(spec, cfg, result) : []
    },
  }
}

for (const spec of DECODERS) registerDecoder(specDecoder(spec))

/** Run one decoder instance with its notes and raw annotations (null: unknown decoder). */
export function runDecoder(capture: LogicCapture, cfg: LogicDecoderConfig): DecoderRun | null {
  const decoder = registry.get(cfg.decoder)
  if (!decoder) return null
  if (!decoder.spec) {
    return { config: cfg, decoder, rows: decoder.decode(capture, cfg), annotations: [], rowLabels: {}, info: [], missing: [] }
  }
  const { result, missing } = runSpec(decoder.spec, capture, cfg)
  const rowLabels: Record<string, string> = {}
  for (const r of result?.rows ?? []) rowLabels[r.id] = r.label
  return {
    config: cfg,
    decoder,
    rows: result ? rowsOf(decoder.spec, cfg, result) : [],
    annotations: result?.annotations ?? [],
    rowLabels,
    info: result?.info ?? [],
    missing,
  }
}

// ---------------------------------------------------------------------------
// decoded frames (UX IS-6: results table, previous / next frame, auto-fit)
// ---------------------------------------------------------------------------

/**
 * One decoded TRANSACTION of a decoder instance — the unit a person looks
 * for: an I²C transfer (START … STOP), an SPI transfer (CS low … high), a
 * UART line / burst, a 1-Wire reset-delimited exchange.
 */
export interface DecodedFrame {
  /** stable within one decode: instance id + start time */
  id: string
  /** decoder instance id (LogicDecoderConfig.id) */
  instance: string
  /** decoder label ('UART', 'I²C' …) — technical, not translated */
  decoder: string
  /** channel the frame's lane sits under (swatch color) */
  channel: number
  t0: number
  t1: number
  /** content, technical ("Addr 0x27 W", "\"tick 3\\r\\n\"", "MOSI 0x01 0x80") */
  text: string
  /** 'hint': not a fault of the bus — noise before the first valid transfer (boot) */
  status: 'ok' | 'nack' | 'error' | 'hint'
  /** what a view words in the UI language (SPI: the mode error, boot noise) */
  note?: { kind: 'mode-error'; cpol: 0 | 1 } | { kind: 'boot-noise' }
  /**
   * A UART line's bytes as upper-case hex ("0x74 0x69 0x63 0x6B 0x20 0x31 0x0D 0x0A"),
   * so the results search finds 「0x31」 in 「tick 1」 (UX QA IS-F14). Other decoders: absent.
   */
  bytes?: string
}

/** The I²C address frame of the decoders (「Addr 0x3C W · 0x00 0xAF」). */
const ADDR_FRAME = /^Addr (\S+) ([RW])(.*)$/

/**
 * A frame's content as the results table shows it (QA clarity
 * DECODE-SUMMARY): an I²C address in words — 「位址 0x3C 寫 · 0x00 0xAF」,
 * 「位址 0x76 讀」 — bytes and quoted text unchanged. `classic` keeps the
 * decoders' own text.
 */
export function frameDisplayText(f: Pick<DecodedFrame, 'decoder' | 'text'>, classic = false): string {
  if (classic) return f.text
  const m = f.decoder === 'I²C' ? ADDR_FRAME.exec(f.text) : null
  if (!m) return f.text
  return `${t(m[2] === 'W' ? 'Address {addr} write' : 'Address {addr} read', { addr: m[1] })}${m[3]}`
}

/** Printable UART text: "tick 3\r\n" shown with visible escapes. */
export function escapeBytes(bytes: readonly number[]): string {
  let s = ''
  for (const b of bytes) {
    if (b === 0x0a) s += '\\n'
    else if (b === 0x0d) s += '\\r'
    else if (b === 0x09) s += '\\t'
    else if (b === 0x5c) s += '\\\\'
    else if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b)
    else s += `\\x${b.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return `"${s}"`
}

/** Bytes back to back (gap below `factor` × the previous byte's length) form one burst. */
function burstsOf(items: Annotation[], factor: number, breakAfter?: (a: Annotation) => boolean): Annotation[][] {
  const out: Annotation[][] = []
  let cur: Annotation[] = []
  for (const a of [...items].sort((x, y) => x.t0 - y.t0)) {
    const prev = cur[cur.length - 1]
    if (prev && (a.t0 - prev.t1 > factor * Math.max(prev.t1 - prev.t0, 1e-9) || cur.length >= 64)) {
      out.push(cur)
      cur = []
    }
    cur.push(a)
    if (breakAfter?.(a)) {
      out.push(cur)
      cur = []
    }
  }
  if (cur.length) out.push(cur)
  return out
}

const I2C_TRANSFER = /^(R|W) (\S+)( NACK)?(?::\s*(.*))?$/

/**
 * Transactions of the decoder runs, sorted by time. Built from the runs' raw
 * annotations (no re-decoding): I²C 'transfers', SPI 'transfers' (bytes
 * grouped into bursts when CS is not mapped), UART bytes grouped into lines
 * (a gap of more than two byte times, or a line feed, ends one), 1-Wire
 * bytes grouped between resets.
 */
export function decodedFrames(runs: readonly DecoderRun[]): DecodedFrame[] {
  const out: DecodedFrame[] = []
  for (const run of runs) {
    const inst = instanceId(run.config)
    const label = run.decoder.label
    const chOf = (rowId: string) => run.rows.find((r) => r.id === `${inst}:${rowId}`)?.channel ?? run.rows[0]?.channel ?? 0
    const push = (
      t0: number,
      t1: number,
      rowId: string,
      text: string,
      status: DecodedFrame['status'],
      note?: DecodedFrame['note'],
      bytes?: string,
    ) => {
      const f: DecodedFrame = { id: `${inst}@${t0}`, instance: inst, decoder: label, channel: chOf(rowId), t0, t1, text, status }
      if (note) f.note = note
      if (bytes) f.bytes = bytes
      out.push(f)
    }
    const anns = run.annotations
    switch (run.decoder.id) {
      case 'i2c': {
        for (const a of anns) {
          if (a.row !== 'transfers') continue
          const m = I2C_TRANSFER.exec(a.text)
          if (!m) {
            push(a.t0, a.t1, 'transfers', a.text, a.kind === 'error' ? 'error' : 'ok')
            continue
          }
          const [, dir, addr, nack, data] = m
          const text = `Addr ${addr} ${dir}${data ? ` · ${data}` : ''}`
          const err = anns.some((e) => e.kind === 'error' && e.t0 >= a.t0 && e.t1 <= a.t1)
          push(a.t0, a.t1, 'transfers', text, err ? 'error' : nack ? 'nack' : 'ok')
        }
        break
      }
      case 'spi': {
        const transfers = anns.filter((a) => a.row === 'transfers')
        if (transfers.length > 0) {
          // a wrong SCK idle level BEFORE the first clean transfer is the MCU's pins
          // floating through reset / init — boot noise (a hint), not a bus fault (IS-14)
          let clean = false
          for (const a of transfers) {
            const mode = a.transfer?.modeError
            const text = a.transfer ? transferText(a.transfer) : a.text
            if (!mode) clean = true
            if (mode && !clean) push(a.t0, a.t1, 'transfers', text, 'hint', { kind: 'boot-noise' })
            else if (mode) push(a.t0, a.t1, 'transfers', text, 'error', { kind: 'mode-error', cpol: mode.cpol })
            else push(a.t0, a.t1, 'transfers', text, a.kind === 'error' ? 'error' : 'ok')
          }
          break
        }
        const rowId = anns.some((a) => a.row === 'mosi') ? 'mosi' : 'miso'
        const bits = Number(run.config.options?.wordSize ?? 8) || 8
        for (const g of burstsOf(anns.filter((a) => a.row === rowId), 4)) {
          const words = g.map((a) => (typeof a.value === 'number' ? fmtHex(a.value, bits) : annotationDisplayText(a))).join(' ')
          push(g[0].t0, g[g.length - 1].t1, rowId, `${rowId.toUpperCase()} ${words}`, g.some((a) => a.kind === 'error') ? 'error' : 'ok')
        }
        break
      }
      case 'uart': {
        const bytes = anns.filter((a) => a.row === 'data')
        for (const g of burstsOf(bytes, 2, (a) => a.value === 0x0a)) {
          const vals = g.filter((a) => typeof a.value === 'number').map((a) => a.value as number)
          const text = vals.length > 0 ? escapeBytes(vals) : g.map((a) => a.text).join(' ')
          const hex = vals.map((v) => `0x${v.toString(16).toUpperCase().padStart(2, '0')}`).join(' ')
          push(g[0].t0, g[g.length - 1].t1, 'data', text, g.some((a) => a.kind === 'error') ? 'error' : 'ok', undefined, hex || undefined)
        }
        break
      }
      case 'onewire': {
        const bytes = anns.filter((a) => a.row === 'bytes').sort((x, y) => x.t0 - y.t0)
        let cur: Annotation[] = []
        const flush = () => {
          if (!cur.length) return
          push(cur[0].t0, cur[cur.length - 1].t1, 'bytes', cur.map((a) => a.text).join(' · '), cur.some((a) => a.kind === 'error') ? 'error' : 'ok')
          cur = []
        }
        for (const a of bytes) {
          if (a.text.startsWith('Reset')) flush()
          cur.push(a)
        }
        flush()
        break
      }
      default: {
        const first = run.rows[0]
        const rowId = first ? first.id.slice(inst.length + 1) : ''
        for (const a of anns) if (a.row === rowId) push(a.t0, a.t1, rowId, a.text, a.kind === 'error' ? 'error' : 'ok')
      }
    }
  }
  return out.sort((a, b) => a.t0 - b.t0 || (a.instance < b.instance ? -1 : 1))
}

/** Run every configured decoder over a capture (unknown ids are skipped). */
export function runDecoders(capture: LogicCapture, configs: readonly LogicDecoderConfig[]): LogicAnnotationRow[] {
  const rows: LogicAnnotationRow[] = []
  for (const cfg of configs) {
    const d = registry.get(cfg.decoder)
    if (d) rows.push(...d.decode(capture, cfg))
  }
  return rows
}
