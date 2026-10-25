/**
 * UART terminal — a peripheral-level serial monitor on any MCU USART
 * (the virtual "USB-serial adapter" of the lab).
 *
 * Data source: the lab's module-level UART ring buffers (labBuffers), read
 * whenever `uartVersion` bumps (≤ 10 Hz) — bytes never pass through React
 * state. The port list is USART1–3 of every MCU board in the layout, the
 * host-side ports of modules in the simulated world (SimFrame.serialPorts:
 * a CH340's 'COM' = the PC's virtual COM port, an HC-05's 'BT' = the paired
 * phone) and any other port that has received data — so a user can open a
 * port before anything prints. The line-settings chip shows the
 * configuration the FIRMWARE programmed (USART_BRR / CR1 M+PCE / CR2 STOP,
 * RM0008 §27.6) or, for a module port, the settings the module uses on its
 * pins — straight from the SimFrame; the terminal never assumes a baud rate.
 * Local echo is done by the lab store (sent bytes join the port's ring).
 *
 * Time (UX IS-8): the lab stamps every received chunk with the simulation-
 * time window of the frame that delivered it, so EVERY line knows when it
 * arrived — the 時間 toggle only shows or hides the stamp ("≈2.59 s", to
 * the resolution of that window). Hovering a line offers 「在邏輯分析儀中
 * 檢視」: the analyzer centres on the line's bytes on the TX wire (exact,
 * from the recorder's edges) with marker A on the first start bit. Firmware
 * loads and MCU resets insert a dim separator line ("── 2.35 s · U1 載入
 * hal-i2c-scan.elf（4ac5dbd5）· 重置 ──"), or clear the transcript with
 * 「載入時清除」.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { EllipsisIcon, PressableButton, Segmented, TrashIcon } from '../kit'
import { peekSimHost, useStore } from '../../state/store'
import { encodeTerminalLine } from '../../state/lab'
import { decodeUart } from '../../instruments/decoders'
import { getEntry } from '../../model/catalog'
import type { LineEnding, TerminalMark, UartChunk } from '../../state/lab-types'
import type { UartLineConfig } from '../../mcu/mcu-api'
import type { McuFrameInfo, SerialPortInfo } from '../../sim/coordinator/api'
import type { ComponentInstance } from '../../model/types'
import { labBuffers, useLab } from './lab'
import { ChipButton, EmptyNote, SelectField, ToggleChip } from './controls'
import { fmtSimTime } from './format'
import { approx, fmtBaud, fmtSimTimeAt } from '../../instruments/format'
import { useLegacyChrome } from '../chrome/legacy'
import { BlockerNote, boardFor, useInstrumentBlocker } from './instruments/BlockerNote'
import { Popover } from './instruments/Popover'

/** Below this width the terminal's secondary toggles move into a ⋯ menu (UX IS-20). */
const COMPACT_TOOLBAR_PX = 640
import { USART_TX, findByteRun, revealLineTitle, revealUartLine } from './instruments/uart-reveal'
import { recordUartSend, rxPinOf, rxWireNote } from './instruments/uart-sent'
import { TONE_COLOR } from '../chrome/run-control'
import { findLogicChannel } from './probe-actions'
import { InstrumentTerm } from './instruments/InstrumentTerm'
import { t, useLang } from '../../i18n'
import { tc } from './text'
import './embedded.css'
import './instruments/instruments.css'

const MCU_USARTS = ['USART1', 'USART2', 'USART3'] as const
/** rendered line cap (DOM cost); older lines stay in the ring */
const MAX_LINES = 2000

/** English sources; shown through t(). */
const EOL_OPTIONS: { value: LineEnding; label: string }[] = [
  { value: 'none', label: 'No line ending' },
  { value: 'lf', label: 'LF (\\n)' },
  { value: 'cr', label: 'CR (\\r)' },
  { value: 'crlf', label: 'CR LF' },
]

function portKey(componentId: string, port: string): string {
  return `${componentId}\u0000${port}`
}

// ---- a request to show one port (release close-out): 「開啟 UART 終端機」 on a board's
// USART2 row opens THAT board's USART2, not whichever port has data. Module-level (the
// terminal may mount after the request); each request is applied once, when the terminal
// next lists its ports.
let portRequest: { key: string; seq: number } | null = null
let appliedPortRequest = 0
const portRequestListeners = new Set<() => void>()
const subscribePortRequest = (cb: () => void): (() => void) => {
  portRequestListeners.add(cb)
  return () => void portRequestListeners.delete(cb)
}
const getPortRequest = () => portRequest

/** Show port `port` ('USART2') of board `componentId` in the UART terminal (call before / after showInstrument('uart')). */
export function requestTerminalPort(componentId: string, port: string): void {
  portRequest = { key: portKey(componentId, port), seq: (portRequest?.seq ?? 0) + 1 }
  for (const l of portRequestListeners) l()
}

/**
 * English sources (shown through t()) naming the host side of a module's
 * virtual serial port; a port name not listed here is shown as is.
 */
const MODULE_PORT_NAMES: Record<string, string> = {
  COM: 'COM port (USB-to-TTL)',
  BT: 'Bluetooth (paired phone)',
}

/** One port the terminal can open. */
export interface TerminalPort {
  componentId: string
  port: string
  /** 'mcu' = a USART of an MCU board, 'module' = a module's host-side port, 'data' = any other port with bytes */
  kind: 'mcu' | 'module' | 'data'
  /** line settings (absent = not known yet) */
  config?: UartLineConfig
}

/**
 * The terminal's port list: USART1–3 of every MCU board (layout order), the
 * module ports of the current world (frame order), then any other port that
 * has received data. Pure (the view passes the store snapshots in).
 */
export function terminalPorts(
  components: readonly ComponentInstance[],
  mcus: Readonly<Record<string, McuFrameInfo>>,
  serialPorts: readonly SerialPortInfo[],
  bufferPorts: readonly { componentId: string; port: string }[],
): TerminalPort[] {
  const out: TerminalPort[] = []
  const seen = new Set<string>()
  const add = (p: TerminalPort) => {
    const k = portKey(p.componentId, p.port)
    if (seen.has(k)) return
    seen.add(k)
    out.push(p)
  }
  for (const c of components) {
    if (!getEntry(c.type)?.mcu) continue
    for (const u of MCU_USARTS) {
      add({ componentId: c.id, port: u, kind: 'mcu', config: mcus[c.id]?.uarts.find((x) => x.name === u)?.config })
    }
  }
  for (const s of serialPorts) add({ componentId: s.componentId, port: s.name, kind: 'module', config: s.config })
  for (const p of bufferPorts) {
    const mcu = mcus[p.componentId]
    add({ ...p, kind: 'data', config: mcu?.uarts.find((x) => x.name === p.port)?.config })
  }
  return out
}

/** What the port is called in the UI ("U1 · USART1", "U2 · COM port (USB-to-TTL)" translated). */
export function terminalPortName(p: Pick<TerminalPort, 'port' | 'kind'>): string {
  const src = p.kind !== 'mcu' ? MODULE_PORT_NAMES[p.port] : undefined
  return src ? t(src) : p.port
}

export function terminalPortLabel(p: Pick<TerminalPort, 'componentId' | 'port' | 'kind'>): string {
  return `${p.componentId} · ${terminalPortName(p)}`
}

/**
 * "115200 8N1" from the firmware-programmed line config ('not configured'
 * / 'disabled' are English sources — the view shows them through t()).
 */
export function fmtUartConfig(c: UartLineConfig | undefined): string {
  if (!c) return 'not configured'
  if (!c.enabled || c.baud <= 0) return 'disabled'
  // with parity enabled the MSB of the M-bit word carries the parity bit
  // (RM0008 USART_CR1 M/PCE), so an 8-bit word + parity = 7 data bits
  const data = c.dataBits - (c.parity !== 'none' ? 1 : 0)
  const par = c.parity === 'none' ? 'N' : c.parity === 'even' ? 'E' : 'O'
  return `${Math.round(c.baud)} ${data}${par}${c.stopBits}`
}

/**
 * Product chrome (UX QA IS-F17): the line in the analyzer's one baud format,
 * 「115 200 Bd · 8N1」 (H3 fmtBaud); 'not configured' / 'disabled' as
 * fmtUartConfig. The classic badge keeps "115200 8N1".
 */
export function fmtUartLine(c: UartLineConfig | undefined): string {
  if (!c) return 'not configured'
  if (!c.enabled || c.baud <= 0) return 'disabled'
  const data = c.dataBits - (c.parity !== 'none' ? 1 : 0)
  const par = c.parity === 'none' ? 'N' : c.parity === 'even' ? 'E' : 'O'
  return `${fmtBaud(c.baud)} · ${data}${par}${c.stopBits}`
}

function hexDump(bytes: Uint8Array): string {
  const lines: string[] = []
  for (let off = 0; off < bytes.length; off += 16) {
    let hex = ''
    let ascii = ''
    for (let i = 0; i < 16; i++) {
      const k = off + i
      if (k >= bytes.length) {
        hex += '   '
        continue
      }
      const b = bytes[k]
      hex += b.toString(16).padStart(2, '0') + ' '
      ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·'
    }
    lines.push(`${off.toString(16).padStart(6, '0')}  ${hex} ${ascii}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// transcript model (pure — exported for tests)
// ---------------------------------------------------------------------------

export interface TerminalTextLine {
  kind: 'text'
  /** stream offset of the line's first byte (stable React key) */
  at: number
  bytes: number[]
  text: string
  /** the frame window the line's first byte arrived in (null: unknown) */
  t0: number | null
  t1: number | null
  /** the end of the frame window its last byte arrived in (null: unknown) */
  end?: number | null
  /** locally echoed sent text */
  echo: boolean
}

export interface TerminalMarkLine {
  kind: 'mark'
  mark: TerminalMark
}

export type TerminalLine = TerminalTextLine | TerminalMarkLine

let utf8: TextDecoder | null = null

/**
 * Lines of a port's transcript: the retained bytes (stream offsets
 * `first` … `first + bytes.length`) split at CR LF / CR / LF, each with the
 * arrival window of its first byte, and the board's firmware-load / reset
 * separators at the stream offsets they happened at. The newest `max` lines.
 */
export function buildTerminalLines(
  bytes: Uint8Array,
  first: number,
  chunks: readonly UartChunk[],
  marks: readonly TerminalMark[],
  port: string,
  max = MAX_LINES,
): TerminalLine[] {
  utf8 ??= new TextDecoder('utf-8')
  const out: TerminalLine[] = []
  const pending = marks
    .map((m) => ({ m, at: m.offsets[port] ?? 0 }))
    .filter((x) => x.at >= first)
    .sort((a, b) => a.at - b.at || a.m.id - b.m.id)
  let mk = 0
  let ck = 0
  const stampOf = (at: number): { t0: number | null; t1: number | null; echo: boolean } => {
    while (ck < chunks.length && chunks[ck].at + chunks[ck].n <= at) ck++
    const c = chunks[ck]
    return c && c.at <= at ? { t0: c.t0, t1: c.t1, echo: !!c.echo } : { t0: null, t1: null, echo: false }
  }
  let cur: number[] | null = null
  let curAt = 0
  const close = (endAt: number) => {
    const at = cur ? curAt : endAt
    const b = cur ?? []
    const s = stampOf(at)
    const e = b.length > 1 ? stampOf(at + b.length - 1) : s
    out.push({ kind: 'text', at, bytes: b, text: utf8!.decode(Uint8Array.from(b)), t0: s.t0, t1: s.t1, end: e.t1, echo: s.echo })
    cur = null
  }
  for (let i = 0; i < bytes.length; i++) {
    const at = first + i
    while (mk < pending.length && pending[mk].at <= at) {
      if (cur) close(at)
      out.push({ kind: 'mark', mark: pending[mk++].m })
    }
    const b = bytes[i]
    if (b === 0x0d || b === 0x0a) {
      close(at)
      if (b === 0x0d && bytes[i + 1] === 0x0a) i++ // CR LF ends one line
      continue
    }
    if (!cur) {
      cur = []
      curAt = at
    }
    cur.push(b)
  }
  if (cur) close(first + bytes.length)
  while (mk < pending.length) out.push({ kind: 'mark', mark: pending[mk++].m })
  return out.length > max ? out.slice(out.length - max) : out
}

/**
 * The decimals a time stamp can honestly carry for an arrival window `res`
 * seconds wide (QA clarity UART-TIMESTAMPS): floor(−log10 res), 0…6 — a
 * 9 ms window gives 2 (「≈ 1.00 s」), never the 3 that printed 「≈ 0.997 s」.
 */
export function arrivalDecimals(res: number): number {
  if (!(res > 0) || !Number.isFinite(res)) return 6
  return Math.max(0, Math.min(6, Math.floor(-Math.log10(res) + 1e-9)))
}

/**
 * One decimal count for a whole transcript (QA clarity UART-TIMESTAMPS):
 * 6 (the microsecond) when every received line has an exact start-bit time
 * (`exact`: the recorder's, by line offset — NaN = looked up, not on the
 * wire) or arrived in an instant, else the coarsest window's count — every
 * line then prints the same number of decimals.
 */
export function transcriptDecimals(lines: readonly TerminalLine[], exact: ReadonlyMap<number, number> = new Map()): number {
  let d = 6
  for (const l of lines) {
    if (l.kind !== 'text' || l.t1 === null || l.echo) continue
    const e = exact.get(l.at)
    if (e !== undefined && Number.isFinite(e)) continue
    const res = l.t0 !== null ? Math.max(0, l.t1 - l.t0) : 0
    if (res <= 2e-6) continue
    d = Math.min(d, arrivalDecimals(Math.min(res, 1)))
  }
  return d
}

/**
 * A line's time stamp at the resolution of its frame window (no invented
 * digits). Product chrome (UX IS-17 / IS-20): the START of the line — the
 * first start bit, one character time (`frameTime`) before its first byte
 * arrived, the instant the analyzer's decode table and marker A use — in
 * seconds like every simulation time (H3): "2.585 914 s" when exact,
 * "≈ 2.6 s" otherwise (QA clarity UART-TIMESTAMPS: the decimals the window
 * can carry, floor(−log10 window); `decimals` = the transcript's one count,
 * `exact` = the recorder's start-bit time of the line, 「1.001 420 s」).
 * Classic: the arrival of the first byte, "2.586 s" / "≈2.59 s" / "≈412 ms".
 */
export function fmtArrival(
  t0: number | null,
  t1: number | null,
  opts: { classic?: boolean; frameTime?: number; decimals?: number; exact?: number } = {},
): string {
  if (t1 === null) return '—'
  const res = t0 !== null ? Math.max(0, t1 - t0) : 0
  if (opts.classic) {
    if (res <= 2e-6) return fmtSimTime(t1)
    const dec = (unit: number) => Math.max(0, Math.min(6, Math.ceil(-Math.log10(res / unit) - 1e-9)))
    if (t1 >= 1) return `≈${t1.toFixed(dec(1))} s`
    return `≈${(t1 * 1e3).toFixed(dec(1e-3))} ms`
  }
  const at = (d: number) => 10 ** -d
  if (opts.exact !== undefined && Number.isFinite(opts.exact)) return fmtSimTimeAt(Math.max(0, opts.exact), at(opts.decimals ?? 6))
  const back = opts.frameTime !== undefined && opts.frameTime > 0 ? opts.frameTime : 0
  if (res <= 2e-6) return fmtSimTimeAt(Math.max(0, t1 - back), at(opts.decimals ?? 6))
  const mid = (t0 !== null ? (t0 + t1) / 2 : t1) - back
  return approx(fmtSimTimeAt(Math.max(0, mid), at(opts.decimals ?? arrivalDecimals(Math.min(res, 1)))))
}

const EMPTY_EXACT: ReadonlyMap<number, number> = new Map()

/** the shared cursor value the terminal last scrolled to (module-level: a tab switch remounts the view) */
let appliedCursor: number | null = null

/**
 * The stream offset (`at`) of the received line the shared cursor `t` falls
 * in: from its first start bit (one character time `frameTime` before its
 * first byte's arrival window) to its last byte's arrival. null = none.
 * Pure (exported for tests).
 */
export function lineAtTime(lines: readonly TerminalLine[], t: number | null, frameTime: number | undefined): number | null {
  if (t === null || !Number.isFinite(t)) return null
  const back = frameTime !== undefined && frameTime > 0 ? frameTime : 0
  const eps = 1e-6
  for (const l of lines) {
    if (l.kind !== 'text' || l.echo || l.t1 === null || l.bytes.length === 0) continue
    const start = (l.t0 ?? l.t1) - back - eps
    const end = (l.end ?? l.t1) + eps
    if (t >= start && t <= end) return l.at
  }
  return null
}

/** One character on the wire (start + data + parity + stop bits) of a line config, s (undefined = unknown). */
export function uartFrameTime(c: UartLineConfig | undefined): number | undefined {
  if (!c || !(c.baud > 0)) return undefined
  return (1 + c.dataBits + c.stopBits) / c.baud
}

export function UartTerminal({ active = true }: { active?: boolean }) {
  const components = useStore((s) => s.layout.components)
  const uartVersion = useLab((s) => s.uartVersion)
  const mcus = useLab((s) => s.mcus)
  const serialPorts = useLab((s) => s.serialPorts)
  const terminal = useLab((s) => s.terminal)
  const setTerminal = useLab((s) => s.setTerminal)
  const sendUart = useLab((s) => s.sendUart)
  const classic = useLegacyChrome()
  const clearUart = useLab((s) => s.clearUart)
  // a narrow terminal keeps one toolbar row: 時間 / 回顯 / 載入時清除 in a ⋯ menu (IS-20)
  const rootRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const moreRef = useRef<HTMLSpanElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => {
    const el = rootRef.current
    if (!el || classic) return
    const ro = new ResizeObserver(() => setCompact(el.getBoundingClientRect().width < COMPACT_TOOLBAR_PX))
    ro.observe(el)
    return () => ro.disconnect()
  }, [classic])
  useLang()

  // ---- ports: every MCU's USART1-3 + module ports + anything that received data ----
  const ports = useMemo(
    () => terminalPorts(components, mcus, serialPorts, labBuffers.uartPorts()),
    // uartVersion: a port can appear with its first bytes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [components, mcus, serialPorts, uartVersion],
  )

  const [selected, setSelected] = useState('')
  // keep a valid selection: prefer a port that has data, else the first MCU's USART1
  useEffect(() => {
    if (ports.some((p) => portKey(p.componentId, p.port) === selected)) return
    const withData = labBuffers.uartPorts().find((p) => labBuffers.uartText(p.componentId, p.port) !== '')
    const pick = withData ?? ports[0]
    setSelected(pick ? portKey(pick.componentId, pick.port) : '')
  }, [ports, selected])
  // …unless a row asked for a port (requestTerminalPort): that one, once
  const request = useSyncExternalStore(subscribePortRequest, getPortRequest, getPortRequest)
  useEffect(() => {
    if (!request || request.seq === appliedPortRequest) return
    appliedPortRequest = request.seq
    if (ports.some((p) => portKey(p.componentId, p.port) === request.key)) setSelected(request.key)
  }, [request, ports])

  const current = ports.find((p) => portKey(p.componentId, p.port) === selected) ?? null
  const config = current?.config
  const isModule = current !== null && current.kind !== 'mcu' && !mcus[current.componentId]
  // the terminal's USB-TTL adapter on the port's RX pin (close-out UART-RX): how typed bytes travel,
  // or who already drives that net — 「PA10 已由 CH1 的 TXD 驅動，終端機不另外送出」 + the module's own port
  const rxNote =
    classic || !current || current.kind !== 'mcu'
      ? null
      : rxWireNote(
          current.componentId,
          current.port,
          mcus[current.componentId]?.uartRx?.find((u) => u.port === current.port),
          config && config.baud > 0 ? fmtUartLine({ ...config, enabled: true }) : null,
          components,
        )
  const currentName = current ? terminalPortName(current) : ''
  // the port's board unpowered / without firmware / halted: say that first (IS-14, H5)
  const blockerBoard = useMemo(
    () => (current && !isModule ? boardFor(useStore.getState().layout, [current.componentId]) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current?.componentId, isModule, components],
  )
  const blocker = useInstrumentBlocker(classic ? null : blockerBoard)

  // ---- transcript: lines from the ring's bytes + arrival stamps + separators ----
  const lines = useMemo((): TerminalLine[] => {
    if (!active || !current) return []
    const id = current.componentId
    const marks = labBuffers.terminalMarks().filter((m) => m.componentId === id)
    return buildTerminalLines(
      labBuffers.uartBytes(id, current.port),
      labBuffers.uartFirstOffset(id, current.port),
      labBuffers.uartChunks(id, current.port),
      marks,
      current.port,
    )
    // the ring is module-level; uartVersion is the change signal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, current?.componentId, current?.port, uartVersion])
  const hasText = lines.some((l) => l.kind === 'text')

  // ---- exact start-bit stamps (QA clarity UART-TIMESTAMPS): when the port's TX pin is on the
  // logic analyzer, a line's time is its first start bit on the wire — the instant 解碼結果 and
  // 「在邏輯分析儀中檢視」 use (1.001 420 s) — looked up ≤ 1 Hz for lines that have none yet ----
  const queryLogic = useLab((s) => s.queryLogic)
  const logicChannels = useLab((s) => s.logicChannels)
  const portKeyNow = current ? portKey(current.componentId, current.port) : ''
  const [exact, setExact] = useState<{ port: string; at: ReadonlyMap<number, number> }>({ port: '', at: new Map() })
  const exactAt = exact.port === portKeyNow ? exact.at : EMPTY_EXACT
  const [exactTick, setExactTick] = useState(0)
  const exactBusy = useRef(false)
  const exactLast = useRef(0)
  // a power cycle restarts the stream offsets: the stamps belong to the old run
  useEffect(() => useStore.subscribe((st, p) => (st.simTime < p.simTime ? setExact({ port: '', at: new Map() }) : undefined)), [])
  const txChannel = useMemo(() => {
    if (classic || !current || current.kind !== 'mcu') return null
    const tx = USART_TX[current.port]?.pin
    return tx ? findLogicChannel({ kind: 'mcu-pin', componentId: current.componentId, pin: tx }) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classic, current?.componentId, current?.port, current?.kind, logicChannels, components])
  useEffect(() => {
    if (classic || !active || !terminal.timestamps || terminal.hex || !current || !txChannel) return
    const cfg = config
    if (!cfg || !cfg.enabled || !(cfg.baud > 0)) return
    const todo = lines.filter((l): l is TerminalTextLine => l.kind === 'text' && !l.echo && l.t1 !== null && l.bytes.length > 0 && !exactAt.has(l.at)).slice(-200)
    if (todo.length === 0 || exactBusy.current) return
    const wait = 1000 - (performance.now() - exactLast.current)
    if (wait > 0) {
      const id = window.setTimeout(() => setExactTick((x) => x + 1), wait)
      return () => window.clearTimeout(id)
    }
    exactBusy.current = true
    exactLast.current = performance.now()
    const ft = uartFrameTime(cfg) ?? 10 / cfg.baud
    const longest = Math.max(...todo.map((l) => l.bytes.length))
    const to = Math.max(...todo.map((l) => l.end ?? l.t1!)) + ft + 0.001
    // never more than 10 s of the recorder per lookup (older lines keep their approximate stamp)
    const from = Math.max(0, to - 10, Math.min(...todo.map((l) => l.t0 ?? l.t1!)) - ft * (longest + 1) - 0.002)
    const key = portKeyNow
    const ch = txChannel.index
    void queryLogic(from, to)
      .then((cap) => {
        const tr = cap.traces.find((x) => x.index === ch)
        const found = new Map<number, number>()
        if (tr) {
          const res = decodeUart(
            tr,
            { baud: cfg.baud, dataBits: cfg.dataBits - (cfg.parity !== 'none' ? 1 : 0), parity: cfg.parity, stopBits: cfg.stopBits >= 1 ? cfg.stopBits : 1 },
            cap.t1,
          )
          for (const l of todo) {
            const lf = (l.t0 ?? l.t1!) - ft * (l.bytes.length + 1) - 0.002
            const run = l.t1! >= from ? findByteRun(res.frames, l.bytes, Math.max(from, lf), l.t1! + 0.001) : null
            found.set(l.at, run ? run.t0 : Number.NaN)
          }
        } else for (const l of todo) found.set(l.at, Number.NaN)
        setExact((prev) => ({ port: key, at: new Map([...(prev.port === key ? prev.at : []), ...found]) }))
      })
      .catch(() => {})
      .finally(() => {
        exactBusy.current = false
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classic, active, terminal.timestamps, terminal.hex, lines, txChannel, exactTick, portKeyNow])
  const stampDecimals = useMemo(() => (classic ? undefined : transcriptDecimals(lines, exactAt)), [classic, lines, exactAt])

  // ---- auto-scroll ----
  const [follow, setFollow] = useState(true)
  const outRef = useRef<HTMLPreElement>(null)
  useLayoutEffect(() => {
    const el = outRef.current
    if (el && follow) el.scrollTop = el.scrollHeight
  })

  // ---- the shared instrument cursor (UX QA IS-F13): the line it falls in is
  // marked in the analyzer's purple, scrolled into view once, and following
  // pauses (「回到最新」 brings it back) — the decode table's 「tick 2」 IS this line
  const labCursor = useLab((s) => s.labCursor.t)
  const frameTime = uartFrameTime(config)
  const cursorAt = useMemo(() => (classic ? null : lineAtTime(lines, labCursor, frameTime)), [classic, lines, labCursor, frameTime])
  useEffect(() => {
    if (classic || labCursor === null || cursorAt === null || appliedCursor === labCursor) return
    appliedCursor = labCursor
    setFollow(false)
    const el = outRef.current?.querySelector<HTMLElement>(`[data-at="${cursorAt}"]`)
    el?.scrollIntoView({ block: 'center' })
  }, [classic, labCursor, cursorAt])

  // ---- send ----
  const [draft, setDraft] = useState('')
  const send = () => {
    if (!current || draft === '' || rxNote?.canSend === false) return
    const accepted = !!peekSimHost()
    sendUart(current.componentId, current.port, draft)
    // the record of what was sent (the frames themselves travel on the RX wire, close-out UART-RX)
    if (accepted && current.kind === 'mcu' && !classic) {
      recordUartSend({
        componentId: current.componentId,
        port: current.port,
        t: useStore.getState().simTime,
        bytes: Array.from(encodeTerminalLine(draft, terminal.lineEnding)),
        frameTime: uartFrameTime(config),
      })
    }
    setDraft('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      send()
    }
  }

  // ---- render model ----
  const hex = useMemo(
    () => (current && terminal.hex ? hexDump(labBuffers.uartBytes(current.componentId, current.port)) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current?.componentId, current?.port, terminal.hex, uartVersion],
  )

  // separators carry the simulation clock in seconds (H3, like the analyzer and the log)
  const markTime = (time: number) => (classic ? fmtSimTime(time) : fmtSimTimeAt(time, 1e-3))
  const markText = (m: TerminalMark) =>
    m.kind === 'load'
      ? t('── {time} · {id} loaded {file} ({sha}) · reset ──', {
          time: markTime(m.t),
          id: m.componentId,
          file: m.name ?? '',
          sha: m.sha ?? '',
        })
      : t('── {time} · {id} reset ──', { time: markTime(m.t), id: m.componentId })

  const secondary = (
    <>
      <ToggleChip
        pressed={terminal.timestamps}
        onChange={(v) => setTerminal({ timestamps: v })}
        title={t('Show when each line arrived (simulation time, to the resolution of the frame that delivered it)')}
      >
        {tc('Time', 'uart')}
      </ToggleChip>
      <ToggleChip
        pressed={terminal.localEcho}
        onChange={(v) => setTerminal({ localEcho: v })}
        title={t('Show what you send in the transcript')}
      >
        {t('Echo')}
      </ToggleChip>
      <ToggleChip
        pressed={!!terminal.clearOnLoad}
        onChange={(v) => setTerminal({ clearOnLoad: v })}
        title={t('Clear this board’s transcript when new firmware is loaded (otherwise a separator line marks the load)')}
      >
        {t('Clear on load')}
      </ToggleChip>
    </>
  )

  return (
    <div ref={rootRef} className="emb-view emb-term">
      <div className="emb-toolbar" role="toolbar" aria-label={t('Terminal options')}>
        <SelectField
          aria-label={t('Serial port')}
          value={selected}
          onChange={setSelected}
          disabled={ports.length === 0}
          options={
            ports.length === 0
              ? [{ value: '', label: t('No serial ports') }]
              : ports.map((p) => ({ value: portKey(p.componentId, p.port), label: terminalPortLabel(p) }))
          }
        />
        {current && (
          <span
            className={`emb-tag ${config?.enabled ? 'is-on' : ''}`}
            title={isModule ? t('Line settings the module uses on its pins') : t('Line settings programmed by the firmware')}
          >
            {classic ? (
              t(fmtUartConfig(config))
            ) : config?.enabled ? (
              <InstrumentTerm id="baud">{fmtUartLine(config)}</InstrumentTerm>
            ) : (
              t(fmtUartLine(config))
            )}
          </span>
        )}
        <span className="emb-toolbar-spacer" />
        <Segmented
          className="emb-seg-sm"
          value={terminal.hex ? 'hex' : 'text'}
          onChange={(v) => setTerminal({ hex: v === 'hex' })}
          options={[
            { value: 'text', label: tc('Text', 'uart') },
            { value: 'hex', label: tc('Hex', 'uart') },
          ]}
          aria-label={tc('Display', 'uart')}
        />
        {compact ? (
          <>
            <span ref={moreRef} className="lai-chip-wrap">
              <ChipButton aria-label={t('More terminal options')} title={t('More terminal options')} onClick={() => setMoreOpen((o) => !o)}>
                <EllipsisIcon size={15} />
              </ChipButton>
            </span>
            <Popover anchor={moreRef.current} open={moreOpen} onClose={() => setMoreOpen(false)} label={t('More terminal options')} width={260}>
              <div className="emb-more-opts">{secondary}</div>
            </Popover>
          </>
        ) : (
          secondary
        )}
        <ToggleChip pressed={follow} onChange={setFollow} title={t('Scroll with new output')}>
          {t('Follow')}
        </ToggleChip>
        <ChipButton
          aria-label={t('Clear terminal')}
          title={t("Clear this port's buffer")}
          disabled={!current}
          onClick={() => {
            if (!current) return
            clearUart(current.componentId, current.port)
          }}
        >
          <TrashIcon size={15} />
        </ChipButton>
      </div>

      {blocker && ports.length > 0 && (
        <div className="emb-term-blocker">
          <BlockerNote blocker={blocker} what="port" />
        </div>
      )}
      {ports.length === 0 ? (
        <EmptyNote title={t('No serial ports')}>
          {t('Place an MCU board (Library → MCU) and load firmware that prints over a USART.')}
        </EmptyNote>
      ) : (
        <pre
          ref={outRef}
          className="emb-term-out emb-mono"
          tabIndex={0}
          role="log"
          aria-label={
            current ? t('Received from {id} {port}', { id: current.componentId, port: currentName }) : t('Serial output')
          }
          onScroll={(e) => {
            const el = e.currentTarget
            const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 8
            if (atEnd !== follow) setFollow(atEnd)
          }}
        >
          {terminal.hex ? (
            // received bytes are data, never UI copy (translate="no")
            hex ? (
              <span className="emb-term-hex" translate="no">
                {hex}
              </span>
            ) : (
              <span className="emb-term-dim">{t('no bytes yet')}</span>
            )
          ) : !hasText && lines.length === 0 ? (
            blocker ? null : <span className="emb-term-dim">
              {config && !config.enabled
                ? isModule
                  ? t('{port}: the module is not passing data right now (e.g. HC-05 in AT command mode)', { port: currentName })
                  : t('{port} is not enabled by the firmware (yet)', { port: current?.port ?? '' })
                : t('no data yet')}
            </span>
          ) : (
            lines.map((l) =>
              l.kind === 'mark' ? (
                <span key={`m${l.mark.id}`} className="emb-term-mark" role="separator">
                  {markText(l.mark)}
                </span>
              ) : (
                <span
                  key={l.at}
                  data-at={l.at}
                  className={`emb-term-line ${l.echo ? 'is-echo' : ''} ${cursorAt === l.at ? 'is-cursor' : ''}`}
                  tabIndex={-1}
                >
                  {terminal.timestamps && (
                    <span
                      className="emb-term-ts"
                      title={
                        classic || l.end == null
                          ? undefined
                          : t('Start bit time; line end {time}', { time: approx(fmtSimTimeAt(l.end, 1e-3)) })
                      }
                    >
                      {fmtArrival(l.t0, l.t1, {
                        classic,
                        // an echoed send is stamped at the send itself (no character time before it)
                        frameTime: l.echo ? undefined : uartFrameTime(config),
                        decimals: stampDecimals,
                        exact: exactAt.get(l.at),
                      })}
                    </span>
                  )}
                  <span className="emb-term-txt" translate="no">
                    {l.text}
                  </span>
                  {l.t1 !== null && l.bytes.length > 0 && current && (!l.echo || current.kind === 'mcu') && (
                    // a received line: its bytes on the TX wire; a sent (echoed) line: its frames on the RX pin
                    <button
                      type="button"
                      className="emb-term-reveal"
                      title={revealLineTitle(!!l.echo, l.echo ? rxPinOf(current.port, mcus[current.componentId]?.uartRx) : undefined)}
                      onClick={() =>
                        void revealUartLine(
                          { t0: l.t0 ?? l.t1!, t1: l.t1!, bytes: l.bytes, echo: l.echo },
                          { componentId: current.componentId, port: current.port, config },
                        )
                      }
                    >
                      {t('Show in logic analyzer')}
                    </button>
                  )}
                </span>
              ),
            )
          )}
          {!classic && !follow && !terminal.hex && hasText && (
            // following paused (a scroll up, the shared cursor on an older line): one tap back to the newest output
            <button
              type="button"
              className="emb-term-latest"
              onClick={() => {
                setFollow(true)
                const el = outRef.current
                if (el) el.scrollTop = el.scrollHeight
              }}
            >
              {t('Back to the newest')}
            </button>
          )}
        </pre>
      )}

      <div className="emb-term-send">
        <input
          className="emb-field emb-mono emb-term-input"
          type="text"
          placeholder={
            current ? t('Send to {id} {port}…', { id: current.componentId, port: currentName }) : t('No port selected')
          }
          aria-label={t('Text to send')}
          value={draft}
          disabled={!current}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          enterKeyHint="send"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <SelectField
          aria-label={t('Line ending')}
          className="emb-select-eol"
          value={terminal.lineEnding}
          onChange={(v) => setTerminal({ lineEnding: v as LineEnding })}
          options={EOL_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
        />
        <PressableButton size="sm" variant="filled" disabled={!current || draft === '' || rxNote?.canSend === false} onClick={send}>
          {t('Send')}
        </PressableButton>
      </div>
      {rxNote && !(blocker && rxNote.kind === 'no-baud') && (
        // close-out UART-RX: how typed bytes reach the RX pin as frames, or who already drives it
        // (a stopped board's missing baud is the blocker note's story, shown above)
        <p className="emb-term-hint" role="note" style={rxNote.tone === 'warn' ? { color: TONE_COLOR.orange } : undefined}>
          {rxNote.text}
          {rxNote.offer && (
            <>
              {' '}
              <ChipButton accent onClick={() => setSelected(portKey(rxNote.offer!.componentId, rxNote.offer!.port))}>
                {rxNote.offer.label}
              </ChipButton>
            </>
          )}
        </p>
      )}
    </div>
  )
}
