/**
 * 「解碼結果」 — the decoded transactions of the whole recording as a
 * searchable table (UX IS-6): 時間 · 解碼器 · 內容 · 狀態, e.g.
 * "3.56 ms · I²C · Addr 0x27 W · NACK". Rows come from the analyzer's
 * decode runs (logic-decoders.ts decodedFrames); clicking one centres the
 * waveform on it at 1.5× its width and drops marker A there. Virtualized
 * (fixed-height rows, only the visible slice is in the DOM), so a long UART
 * log stays cheap. Content cells are wire data (translate="no").
 *
 * Product chrome (UX QA IS-F4 / F13 / F14 / F17):
 *  - the columns size to their content (one width per table, so every row
 *    lines up) and 內容 keeps at least 10 characters; below a 360 px pane
 *    the rows take two lines — 時間 · 狀態 above, the whole 內容 below (the
 *    decoder shrinks to its colour dot and the line's short name);
 *  - hovering 內容 shows the whole text (and the frame's note);
 *  - a UART row offers 「在 UART 終端機中顯示」: the shared cursor goes to the
 *    line and the terminal marks it;
 *  - the search also matches a UART line's bytes (「0x31」 finds 「tick 1」);
 *  - an I²C address frame reads ACK / NACK like its lane.
 * QA clarity DECODE-SUMMARY / UART-RX:
 *  - a summary line above the table answers the first question at a glance:
 *    I²C 「112 筆 · 回應 ACK 的位址：0x3C、0x50、0x76」 (each address filters
 *    the table), UART 「PA9 TX 10 行 · PA10 RX 0 行」, SPI 「24 筆 · 1 筆開機雜訊」;
 *  - status filters 全部 / 只看 ACK / 只看錯誤;
 *  - the decoder column names the line (「UART · PA9 TX」 vs 「UART · PA10 RX」);
 *  - 內容 reads 「位址 0x3C 寫」 (bytes unchanged);
 *  - what the UART terminal sends is an ordinary row of its RX line: the
 *    terminal's USB-TTL adapter puts real frames on PA10 (release close-out
 *    UART-RX), so 「UART · PA10 RX "hi ohmlet\n" OK」 comes before the
 *    firmware's 「UART · PA9 TX "echo: hi ohmlet\r\n" OK」 — no row of its own.
 * The classic chrome keeps its fixed columns and the decoders' own words.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CloseIcon, TerminalIcon, tick } from '../../kit'
import { IconButton } from '../controls'
import { fmtSimTime } from '../format'
import { fmtSimTimeAt } from '../../../instruments/format'
import { useLegacyChrome } from '../../chrome/legacy'
import { showInstrument } from '../../chrome/instrument-sheet'
import { frameDisplayText, type DecodedFrame } from '../logic-decoders'
import { useLab } from '../lab'
import { CHANNEL_COLORS } from './colors'
import { InstrumentTerm } from './InstrumentTerm'
import { t, useLang } from '../../../i18n'
import { tc } from '../text'
import './instruments.css'

const ROW_H = 26
/** a two-line row (narrow pane): 時間 · 狀態, then the whole 內容 */
const ROW_H_TWO = 44
/** below this pane width the rows take two lines */
export const RESULTS_TWO_LINE_BELOW_PX = 360

/** The status filter of the table (QA clarity DECODE-SUMMARY). */
export type ResultsFilter = 'all' | 'ack' | 'error'

/** Does `f` match the search `q` (lower-case, trimmed)? Text (as shown too), bytes, decoder or status. */
export function frameMatches(f: DecodedFrame, q: string, status: string, shown?: string): boolean {
  if (q === '') return true
  return (
    f.text.toLowerCase().includes(q) ||
    (shown !== undefined && shown.toLowerCase().includes(q)) ||
    (f.bytes !== undefined && f.bytes.toLowerCase().includes(q)) ||
    f.decoder.toLowerCase().includes(q) ||
    status.toLowerCase().includes(q) ||
    f.status.includes(q)
  )
}

/** Does `f` pass the status filter? 'ack' = an I²C address the bus answered; 'error' = NACK or a decode error. */
export function frameFilter(f: DecodedFrame, filter: ResultsFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'error') return f.status === 'nack' || f.status === 'error'
  return statusText(f) === 'ACK'
}

/** The I²C addresses that answered ACK, in address order (「0x3C」, 「0x50」, 「0x76」). */
export function ackedAddresses(frames: readonly DecodedFrame[]): string[] {
  const out = new Set<string>()
  for (const f of frames) {
    if (f.decoder !== 'I²C' || f.status !== 'ok') continue
    const m = /^Addr (0x[0-9A-Fa-f]+)/.exec(f.text)
    if (m) out.add(m[1])
  }
  return [...out].sort((a, b) => parseInt(a, 16) - parseInt(b, 16))
}

/** A decoder instance of the analyzer, for the summary (one entry per UART line, even one with no rows). */
export interface ResultsDecoder {
  instance: string
  /** 'UART', 'I²C' … */
  decoder: string
  /** the analyzer channel its lane sits under */
  channel: number
}

/** Display width of a short label in `ch` of the row font (a CJK character takes about two). */
function widthCh(s: string): number {
  let w = 0
  for (const c of s) w += /[⺀-鿿＀-￯]/.test(c) ? 1.75 : 1
  return w
}

export function DecodeResults({
  frames,
  busy,
  capped,
  query,
  onQuery,
  onPick,
  onClose,
  selected,
  lineNames,
  decoders,
  filter = 'all',
  onFilter,
}: {
  frames: readonly DecodedFrame[]
  /** a refresh is running and nothing was collected yet */
  busy: boolean
  /** only the newest frames are listed (the recording holds more) */
  capped: boolean
  query: string
  onQuery: (q: string) => void
  onPick: (f: DecodedFrame) => void
  onClose: () => void
  /** id of the frame last picked (highlighted) */
  selected: string | null
  /** product chrome: the analyzer channels' short names (「PA9 TX」), for the decoder column and the summary */
  lineNames?: ReadonlyMap<number, string>
  /** product chrome: the configured decoders (the summary counts every UART line, even an empty one) */
  decoders?: readonly ResultsDecoder[]
  filter?: ResultsFilter
  onFilter?: (f: ResultsFilter) => void
}) {
  useLang()
  // frame times in seconds to the microsecond — the analyzer's markers and the UART stamps read the same (H3)
  const classic = useLegacyChrome()
  const stamp = (time: number) => (classic ? fmtSimTime(time) : fmtSimTimeAt(time, 1e-6))
  const status = (f: DecodedFrame) => statusText(f, classic)
  const shown = (f: DecodedFrame) => frameDisplayText(f, classic)
  const lineOf = (ch: number) => lineNames?.get(ch) ?? `D${ch}`
  /** the decoder column: 「UART · PA9 TX」 (classic: the decoder) */
  const decoderText = (f: DecodedFrame) => (classic ? f.decoder : `${f.decoder} · ${lineOf(f.channel)}`)
  const q = query.trim().toLowerCase()
  const activeFilter: ResultsFilter = classic ? 'all' : filter
  const rows = useMemo(
    () => frames.filter((f) => frameFilter(f, activeFilter) && (q === '' || frameMatches(f, q, status(f), shown(f)))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frames, q, classic, activeFilter],
  )

  const rootRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [height, setHeight] = useState(0)
  const [paneW, setPaneW] = useState(0)
  useEffect(() => {
    const el = listRef.current
    const root = rootRef.current
    if (!el || !root) return
    const ro = new ResizeObserver(() => {
      setHeight(el.clientHeight)
      setPaneW(root.clientWidth)
    })
    ro.observe(el)
    ro.observe(root)
    return () => ro.disconnect()
  }, [])
  const twoLine = !classic && paneW > 0 && paneW < RESULTS_TWO_LINE_BELOW_PX
  const rowH = twoLine ? ROW_H_TWO : ROW_H
  const first = Math.max(0, Math.floor(scroll / rowH) - 4)
  const last = Math.min(rows.length, Math.ceil((scroll + height) / rowH) + 4)

  // one column width per table (every row lines up), sized to what the rows hold (IS-F4)
  const cols = useMemo(() => {
    if (classic) return undefined
    let tw = 0
    let dw = 0
    let sw = 0
    for (const f of rows) {
      tw = Math.max(tw, stamp(f.t0).length)
      dw = Math.max(dw, widthCh(decoderText(f)))
      sw = Math.max(sw, widthCh(status(f)))
    }
    if (rows.length === 0) return undefined
    // every column also fits its header (時間 · 解碼器 · 狀態 never wrap)
    tw = Math.max(tw, widthCh(t('Time')))
    sw = Math.max(sw, widthCh(t('Status')) + 2)
    // the decoder cell holds its colour dot and a gap before the label
    return `${tw + 0.5}ch ${Math.ceil(Math.max(dw + 2.5, widthCh(t('Decoder'))))}ch minmax(10ch, 1fr) ${Math.ceil(sw + 0.5)}ch`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, classic, lineNames])

  const setLabCursor = useLab((s) => s.setLabCursor)
  const showInTerminal = (f: DecodedFrame) => {
    setLabCursor(f.t0)
    showInstrument('uart')
  }

  // ---- the summary line and the status filters (QA clarity DECODE-SUMMARY) ----
  const acked = useMemo(() => (classic ? [] : ackedAddresses(frames)), [classic, frames])
  const summary = useMemo((): ReactNode[] => {
    if (classic || frames.length === 0) return []
    const out: ReactNode[] = []
    const i2c = frames.filter((f) => f.decoder === 'I²C')
    if (i2c.length > 0) out.push(<span key="i2c">{t('I²C: {n} transfers', { n: i2c.length })}</span>)
    const uartDecoders = (decoders ?? []).filter((d) => d.decoder === 'UART')
    if (uartDecoders.length > 0) {
      const parts = uartDecoders.map((d) => t('{line} {n} lines', { line: lineOf(d.channel), n: frames.filter((f) => f.instance === d.instance).length }))
      out.push(<span key="uart">{parts.join(' · ')}</span>)
    }
    const spi = frames.filter((f) => f.decoder === 'SPI')
    if (spi.length > 0) {
      const noise = spi.filter((f) => f.status === 'hint').length
      out.push(<span key="spi">{noise > 0 ? t('SPI: {n} transfers · {k} boot noise', { n: spi.length, k: noise }) : t('SPI: {n} transfers', { n: spi.length })}</span>)
    }
    const ow = frames.filter((f) => f.decoder === '1-Wire')
    if (ow.length > 0) out.push(<span key="ow">{t('1-Wire: {n} exchanges', { n: ow.length })}</span>)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classic, frames, decoders, lineNames])
  const hasAck = !classic && frames.some((f) => f.decoder === 'I²C')
  const hasErrors = !classic && frames.some((f) => f.status === 'nack' || f.status === 'error')
  const filters: { id: ResultsFilter; label: string }[] = [
    { id: 'all', label: tc('All', 'results-filter') },
    ...(hasAck ? [{ id: 'ack' as const, label: t('ACK only') }] : []),
    ...(hasErrors || filter === 'error' ? [{ id: 'error' as const, label: t('Errors only') }] : []),
  ]
  const narrowed = q !== '' || activeFilter !== 'all'

  return (
    <section
      ref={rootRef}
      className={`lai-results ${classic ? '' : 'is-product'} ${twoLine ? 'is-two-line' : ''}`}
      aria-label={t('Decoded results')}
      style={cols ? ({ '--lai-res-cols': cols } as React.CSSProperties) : undefined}
    >
      <div className="lai-results-head">
        <span className="lai-results-title">
          {t('Decoded results')}
          <span className="lai-results-count lg-tabular">
            {narrowed ? t('{shown} of {n}', { shown: rows.length, n: frames.length }) : frames.length}
          </span>
        </span>
        <input
          className="emb-field lai-results-search"
          type="search"
          value={query}
          placeholder={t('Search (e.g. NACK, 0x50)')}
          aria-label={t('Search the decoded results')}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          onChange={(e) => onQuery(e.target.value)}
        />
        <IconButton aria-label={t('Close decoded results')} onClick={onClose}>
          <CloseIcon size={14} />
        </IconButton>
      </div>
      {(summary.length > 0 || acked.length > 0 || filters.length > 1) && (
        <div className="lai-results-sum" role="group" aria-label={t('Summary of the decoded results')}>
          {summary.map((part, k) => (
            <span key={k} className="lai-results-sum-part">
              {part}
            </span>
          ))}
          {acked.length > 0 && (
            <span className="lai-results-sum-part lai-results-acks">
              {t('Addresses that answered (ACK):')}
              {acked.map((a) => {
                const on = q === a.toLowerCase()
                return (
                  <button
                    key={a}
                    type="button"
                    className={`lai-results-addr ${on ? 'is-on' : ''}`}
                    aria-pressed={on}
                    title={on ? t('Show every row again') : t('Show only the rows of {addr}', { addr: a })}
                    onClick={() => {
                      tick()
                      onQuery(on ? '' : a)
                    }}
                  >
                    {a}
                  </button>
                )
              })}
            </span>
          )}
          {filters.length > 1 && onFilter && (
            <span className="lai-results-filters" role="group" aria-label={t('Status filter')}>
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`lai-results-filter ${activeFilter === f.id ? 'is-on' : ''}`}
                  aria-pressed={activeFilter === f.id}
                  onClick={() => {
                    tick()
                    onFilter(f.id)
                  }}
                >
                  {f.label}
                </button>
              ))}
            </span>
          )}
        </div>
      )}
      {!twoLine && (
        <div className="lai-results-cols" aria-hidden={classic ? 'true' : undefined}>
          <span>{t('Time')}</span>
          <span>{t('Decoder')}</span>
          <span>{t('Content')}</span>
          <span>{classic || !hasAck ? t('Status') : <InstrumentTerm id="ack">{t('Status')}</InstrumentTerm>}</span>
        </div>
      )}
      <div
        ref={listRef}
        className="lai-results-list"
        role="list"
        tabIndex={-1}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      >
        {rows.length === 0 ? (
          <p className="lai-results-empty">
            {busy
              ? t('Decoding the recording…')
              : frames.length === 0
                ? t('Nothing decoded yet — run the simulation, or check the decoder’s channels.')
                : q
                  ? t('No result matches “{q}”.', { q: query.trim() })
                  : t('No row has this status — choose “All”.')}
          </p>
        ) : (
          <div style={{ height: rows.length * rowH, position: 'relative' }}>
            {rows.slice(first, last).map((f, k) => {
              const note = noteText(f)
              const text = shown(f)
              const full = note ? `${text} — ${note}` : text
              const uart = !classic && f.decoder === 'UART'
              const dec = decoderText(f)
              return (
                <div
                  key={f.id}
                  role="listitem"
                  className={`lai-results-item ${uart ? 'has-act' : ''}`}
                  style={{ top: (first + k) * rowH, height: rowH }}
                >
                  <button
                    type="button"
                    className={`lai-results-row ${f.id === selected ? 'is-sel' : ''} is-${f.status}`}
                    title={classic ? t('Show this frame in the waveform') : `${t('Show this frame in the waveform')} · ${dec} · ${full}`}
                    onClick={() => onPick(f)}
                  >
                    <span className="lai-results-t lg-tabular">{stamp(f.t0)}</span>
                    <span className="lai-results-dec" title={dec}>
                      <span
                        className="lai-tag-dot"
                        style={{ background: CHANNEL_COLORS[f.channel % CHANNEL_COLORS.length] }}
                        aria-hidden="true"
                      />
                      <span className="lai-results-dec-name">{dec}</span>
                      {/* a narrow pane hides the decoder's name: the line's short name stays (TX vs RX without the dot) */}
                      {twoLine && <span className="lai-results-dec-line">{lineOf(f.channel)}</span>}
                    </span>
                    <span className="lai-results-txt" translate="no" title={classic ? note ?? undefined : full}>
                      {f.note?.kind === 'mode-error' && <span className="lai-results-note">{note} · </span>}
                      {text}
                    </span>
                    <span className="lai-results-st">{status(f)}</span>
                  </button>
                  {uart && (
                    <button
                      type="button"
                      className="lai-results-act"
                      aria-label={t('Show in the UART terminal')}
                      title={t('Show in the UART terminal')}
                      onClick={() => showInTerminal(f)}
                    >
                      <TerminalIcon size={14} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {capped && rows.length > 0 && <p className="lai-results-cap">{t('Showing the newest results only.')}</p>}
      </div>
    </section>
  )
}

/** A frame's status word: an I²C address frame reads ACK / NACK like its lane (product chrome). */
export function statusText(f: DecodedFrame, classic = false): string {
  const s = f.status
  if (s === 'nack') return 'NACK'
  if (s === 'error') return tc('Error', 'decode')
  if (s === 'hint') return t('boot noise')
  return !classic && f.decoder === 'I²C' && /^Addr\b/.test(f.text) ? 'ACK' : 'OK'
}

/** The frame's note in the UI language (UX IS-14): the SPI mode error, boot noise. */
function noteText(f: DecodedFrame): string | null {
  if (f.note?.kind === 'mode-error') return t('SCK idle level does not match CPOL {cpol} (the MCU’s pins may be floating during a reset)', { cpol: f.note.cpol })
  if (f.note?.kind === 'boot-noise') return t('Before the first valid transfer: the pins settling while the MCU boots')
  return null
}
