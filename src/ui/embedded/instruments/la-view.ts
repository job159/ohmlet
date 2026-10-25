/**
 * Logic-analyzer VIEW state for this session (UX IS-1 / IS-6): the visible
 * window, auto-fit, markers, the decode-results pane. A module-level store
 * instead of component state, so switching tray tabs (which unmounts the
 * analyzer) or moving between the desktop tray and the phone sheet keeps
 * the zoom, the markers and the pane exactly where they were. Not persisted
 * (a new session starts on "Auto").
 */
import { create } from 'zustand'
import { LA_SPANS } from '../../../instruments/autofit'
import type { LogicChannelConfig } from '../../../sim/coordinator/api'
import { useStore } from '../../../state/store'
import { useLab } from '../lab'
import { useLogicReveal } from '../probe-actions'

/** span shown before anything was fitted */
export const LA_DEFAULT_SPAN = 0.01

export interface LaMarkers {
  a: number | null
  b: number | null
}

export interface LaViewState {
  /** visible span (s) */
  span: number
  /** right edge (s); null = follow the simulation clock (Live) */
  end: number | null
  /** auto-fit active: re-fits on channel / decoder changes and while waiting for the first edges */
  auto: boolean
  /** the last auto-fit found nothing to fit (no edges, no frames) */
  autoEmpty: boolean
  /** bumps when "Auto" is pressed (forces a re-fit even when nothing else changed) */
  fitSeq: number
  markers: LaMarkers
  /** a marker was placed this session — the how-to caption has done its job */
  markerUsed: boolean
  /** channel hovered or clicked last (edge navigation, measurements) */
  focusCh: number | null
  /** decode-results pane open */
  results: boolean
  /** decode-results search text */
  query: string
  /** the next click on the plot places this marker (footer A / B buttons, UX IS-9); null = A then B */
  armed: 'a' | 'b' | null
  /** per-channel measurement column shown (stays for the session, UX IS-9) */
  measCol: boolean
  /**
   * The user toggled 各通道量測 / 解碼結果 themselves this session: an
   * automatic opening (a fit too dense to read, the analysis layout's empty
   * plot — QA clarity LA-FIT / ANALYSIS-LAYOUT-SPACE) never overrides them.
   */
  measColByUser?: boolean
  resultsByUser?: boolean
  /** the decode results' status filter (QA clarity DECODE-SUMMARY) */
  resFilter?: 'all' | 'ack' | 'error'
}

const INITIAL: LaViewState = {
  span: LA_DEFAULT_SPAN,
  end: null,
  auto: true,
  autoEmpty: false,
  fitSeq: 0,
  markers: { a: null, b: null },
  markerUsed: false,
  focusCh: null,
  results: false,
  query: '',
  armed: null,
  measCol: false,
}

export const useLaView = create<LaViewState>()(() => ({ ...INITIAL }))

export function setLaView(p: Partial<LaViewState>): void {
  useLaView.setState(p)
}

/** A zoom / pan / live toggle by the user: the window is theirs now (auto off). */
export function manualLaView(p: Partial<Pick<LaViewState, 'span' | 'end'>>): void {
  useLaView.setState({ ...p, auto: false, autoEmpty: false })
}

/** Turn auto-fit on and fit now. */
export function requestLaFit(): void {
  const s = useLaView.getState()
  useLaView.setState({ auto: true, autoEmpty: false, fitSeq: s.fitSeq + 1 })
}

/** One step along the 1-2-5 ladder from `span` (dir 1 = wider). */
export function stepSpan(span: number, dir: 1 | -1): number {
  if (dir === 1) {
    for (const s of LA_SPANS) if (s > span * (1 + 1e-9)) return s
    return LA_SPANS[LA_SPANS.length - 1]
  }
  for (let i = LA_SPANS.length - 1; i >= 0; i--) if (LA_SPANS[i] < span * (1 - 1e-9)) return LA_SPANS[i]
  return LA_SPANS[0]
}

// ---------------------------------------------------------------------------
// module-level reactions (work while the analyzer is not even mounted — the
// tray may show another tab when an example replaces the channels or a UART
// line asks to be shown)
// ---------------------------------------------------------------------------

function channelsKey(chs: readonly LogicChannelConfig[]): string {
  return chs
    .map((c) => `${c.index}:${c.source.kind === 'net' ? c.source.ref : `${c.source.componentId}.${c.source.kind === 'mcu-pin' ? c.source.pin : ''}`}`)
    .join(',')
}

let watching = false

/** Install the reactions once (the analyzer module calls this at import). */
export function watchLaInputs(): void {
  if (watching) return
  watching = true
  // channels added or replaced → auto-fit again (IS-1: "until the user zooms")
  let key = channelsKey(useLab.getState().logicChannels)
  useLab.subscribe((s, p) => {
    if (s.logicChannels !== p.logicChannels) {
      const k = channelsKey(s.logicChannels)
      if (k !== key) {
        // a different circuit's channels (nothing in common): its markers mean nothing here
        const before = new Set(key.split(',').map((x) => x.slice(x.indexOf(':') + 1)))
        const shared = k.split(',').some((x) => x !== '' && before.has(x.slice(x.indexOf(':') + 1)))
        key = k
        if (!shared) {
          // another circuit: its window and markers mean nothing here (UX IS-15 —
          // never the old 182.9 s axis over a new example)
          resetLaWindow()
          if (s.labCursor.t !== null) queueMicrotask(() => useLab.getState().setLabCursor(null))
        }
        // a channel added to the SAME circuit keeps the window the user is looking at
        // (a revealed line, marker A, a frozen window): only a live view re-fits (IS-15)
        const v = useLaView.getState()
        if (s.logicChannels.length > 0 && (!shared || (v.end === null && v.markers.a === null))) requestLaFit()
      }
    }
    // other decoders / firmware: re-fit when auto is on (the period may change) —
    // not while the user looks at a marked moment
    if ((s.logicView.decoders !== p.logicView.decoders || s.firmware !== p.firmware) && useLaView.getState().auto) {
      if (useLaView.getState().markers.a === null) requestLaFit()
    }
  })
  // a simulation reset / power cycle restarts the clock: the old window and
  // markers point at times that no longer exist (IS-15)
  useStore.subscribe((s, p) => {
    if (s.simTime < p.simTime) {
      resetLaWindow()
      const lab = useLab.getState()
      if (lab.labCursor.t !== null) queueMicrotask(() => useLab.getState().setLabCursor(null))
    }
  })
  // "show this moment" (UART line, log entry, probe menu): centre, marker A
  useLogicReveal.subscribe((s, p) => {
    const r = s.request
    if (!r || r === p.request) return
    useLaView.setState({
      auto: false,
      autoEmpty: false,
      span: r.span,
      // centred, but never reaching before time 0
      end: Math.max(r.t + r.span / 2, r.span),
      markers: { a: r.marker ?? r.t, b: null },
      markerUsed: true,
    })
  })
}

/**
 * The workspace is in the analysis arrangement (分析版面, Shift+A — Tray.tsx
 * toggleAnalysisLayout): both side panels folded and the instrument tray
 * open at half the window or more (QA clarity ANALYSIS-LAYOUT-SPACE).
 */
export function isAnalysisArrangement(
  ws: { left: { open: boolean }; right: { open: boolean }; tray: { open: boolean; height: number } },
  viewportH: number = typeof window !== 'undefined' ? window.innerHeight : 0,
): boolean {
  return !ws.left.open && !ws.right.open && ws.tray.open && viewportH > 0 && ws.tray.height >= 0.5 * viewportH - 1
}

/** A plot whose trace rows leave more than this share of its height empty gets the measurements beside it. */
export const EMPTY_PLOT_SHARE = 0.4

/**
 * What the analysis layout opens by itself when the traces leave the plot
 * mostly empty (QA clarity ANALYSIS-LAYOUT-SPACE): 各通道量測, and 解碼結果
 * when decoders exist — never against the user's own toggle this session.
 */
export function analysisAutoOpen(
  v: Pick<LaViewState, 'measCol' | 'results' | 'measColByUser' | 'resultsByUser'>,
  plotH: number,
  rowsH: number,
  hasDecoders: boolean,
): Partial<Pick<LaViewState, 'measCol' | 'results'>> {
  if (!(plotH > 0) || (plotH - rowsH) / plotH <= EMPTY_PLOT_SHARE) return {}
  const out: Partial<Pick<LaViewState, 'measCol' | 'results'>> = {}
  if (!v.measCol && !v.measColByUser) out.measCol = true
  if (hasDecoders && !v.results && !v.resultsByUser) out.results = true
  return out
}

/** Back to a live, auto-fitting window without markers (a new circuit, a reset). */
export function resetLaWindow(): void {
  const s = useLaView.getState()
  useLaView.setState({
    span: LA_DEFAULT_SPAN,
    end: null,
    auto: true,
    autoEmpty: false,
    fitSeq: s.fitSeq + 1,
    markers: { a: null, b: null },
    focusCh: null,
    armed: null,
  })
}

/** TEST-ONLY: back to the session defaults. */
export function __resetLaViewForTests(): void {
  useLaView.setState({ ...INITIAL, markers: { a: null, b: null } })
}
