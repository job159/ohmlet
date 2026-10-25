/**
 * ScopeSheet — the oscilloscope in a half-height bottom sheet (snap 0.4/0.8),
 * plus the embedded lab's other instruments on narrow screens: a Segmented
 * (Scope | Logic | UART | Log) swaps the sheet body between the scope, the
 * logic analyzer, the UART terminal and the simulation log — the SAME view
 * components the desktop workspace tray hosts (src/ui/embedded).
 *
 * Canvas-rendered scope (the old ScopePanel screen: dark grid, up to 4
 * traces in classic scope channel colors, DPR capped at 2) fed by the
 * high-resolution recorder (lab.queryScope; the 1 kHz feed is the
 * fallback), with a front panel — timebase, V/div, trigger (level, slope,
 * Auto / Normal / Single, holdoff), cursors, CSV export — and automatic
 * measurements per channel (src/ui/embedded/instruments). The acquisition
 * poll and the rAF loop run ONLY while the view is shown, and skip work
 * when nothing changed (paused sim → near-zero cost). Channel legend chips
 * light up per live probe presence.
 *
 * Exports `ScopeView` / `ScopeCanvas` / `drawScope` for the workspace tray.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useStore } from '../../state/store'
import type { ScopeSample } from '../../model/types'
import type { ScopeCapture } from '../../sim/coordinator/api'
import { Segmented, Sheet, type SegmentedOption } from '../kit'
import { LogicAnalyzer } from '../embedded/LogicAnalyzer'
import { UartTerminal } from '../embedded/UartTerminal'
import { SimLog } from '../embedded/SimLog'
import { MeasureView } from '../embedded/instruments/MeasureView'
import { useLab } from '../embedded/lab'
import {
  ANALOG_FINE_SAMPLES,
  NET_LIVE_WINDOW_S,
  measureEdges,
  measureWave,
  type EdgeMeasurements,
  type WaveMeasurements,
} from '../../instruments/measure'
import { showInstrument } from '../chrome/instrument-sheet'
import { amplitudeWindow, averagesOf, shortestPulse, type FullStats } from '../embedded/instruments/scope-engine'
import { approx as approxText, fmtFreq, fmtPercent, fmtSi, fmtSiSigned, fmtSimTimeAt, fmtSpan, fmtVoltage } from '../../instruments/format'
import { InstrumentTerm } from '../embedded/instruments/InstrumentTerm'
import { buildNetlist } from '../../sim/netlist'
import {
  decoderLineOf,
  isDataChannel,
  serialLineText,
  timingCell,
  usartLineOnNet,
  type SerialLine,
} from '../embedded/instruments/signal-readout'
import { sanitizeDecoderConfigs } from '../embedded/instruments/la-config'
import { scopeCsv } from '../../instruments/export'
import { ScopeControls, ScopeTools } from '../embedded/instruments/ScopeControls'
import { SCOPE_DEFAULTS, useScopeSettings, type ScopeSettings } from '../embedded/instruments/scope-settings'
import { runScopeAutoSetup, scopeLogicLinks } from '../embedded/instruments/scope-autoset'
import { useLogicReveal, useScopeFlash } from '../embedded/probe-actions'
import { scopeProbeNames, type ScopeProbeName } from '../embedded/instruments/channel-name'
import { focusInScene, highlightSource, problemLevelSupported } from '../workspace/scene-bridge'
import { Popover } from '../embedded/instruments/Popover'
import { BlockerNote, boardOnNet, useInstrumentBlocker } from '../embedded/instruments/BlockerNote'
import { KeyHelp } from '../embedded/instruments/KeyHelp'
import { DutyTerm } from '../embedded/instruments/DutyTerm'
import { useLegacyChrome } from '../chrome/legacy'
import '../embedded/instruments/lab-watchers'
import {
  MAX_POINTS,
  buildFrame,
  drawScopeFrame,
  frameHasSamplesInWindow,
  queryLead,
  legacyCapture,
  queryWindow,
  traceDecimated,
  valueAt,
  type ScopeCursors,
  type ScopeFrame,
  type ScopeLayout,
  type ScopeStatus,
} from '../embedded/instruments/scope-engine'
import { downloadText, exportName } from '../embedded/instruments/download'
import { tc } from '../embedded/text'
import '../embedded/instruments/instruments.css'
import './asm-sheets.css'
import { t, useLang } from '../../i18n'

const SNAP_POINTS = [0.4, 0.8] as const

export const TRACE_COLORS = ['#ffd84a', '#43d9f6', '#ff5dd8', '#62e979'] // ch1..4

/** The phone "Lab" views (the desktop tray's tabs; 'measure' only in the product chrome). */
export type LabView = 'scope' | 'logic' | 'uart' | 'log' | 'measure'

/** English sources; labels / titles go through t() at render. */
const LAB_VIEW_OPTIONS: readonly SegmentedOption<LabView>[] = [
  { value: 'scope', label: 'Scope' },
  { value: 'logic', label: 'Logic' },
  { value: 'uart', label: 'UART' },
  { value: 'log', label: 'Log' },
]

/**
 * Product chrome (UX QA IS-F16): the desktop tray's order and names
 * (Tray.tsx) in their short forms — 「UART · 邏輯 · 示波器 · 日誌 · 量測」 —
 * each with its long name as the title. The classic chrome keeps the
 * Scope-first sheet above.
 */
export const PRODUCT_VIEW_OPTIONS: readonly { value: LabView; label: string; title: string; ctx?: string }[] = [
  { value: 'uart', label: 'UART', title: 'UART Terminal' },
  { value: 'logic', label: 'Logic', title: 'Logic Analyzer' },
  { value: 'scope', label: 'Scope', title: 'Oscilloscope' },
  { value: 'log', label: 'Log', title: 'Simulation Log' },
  { value: 'measure', label: 'Readings', ctx: 'tray', title: 'Readings|tray' },
]

const LAB_VIEW_TITLES: Record<LabView, string> = {
  scope: 'Oscilloscope',
  logic: 'Logic analyzer',
  uart: 'UART terminal',
  log: 'Simulation log',
  measure: 'Readings|tray',
}

export interface ScopeSheetProps {
  open: boolean
  onDismiss: () => void
  desktop?: boolean
}

export function ScopeSheet({ open, onDismiss, desktop = false }: ScopeSheetProps) {
  // classic chrome: present at the half (0.4) detent every time; user can
  // drag to 0.8. The product chrome presents at the tall detent: at 0.4 on
  // a phone the title, view switch and front-panel rows fill the sheet and
  // the waveform sits under the dock (UX IS-9) — the board stays in view
  // above the sheet either way
  const classic = useLegacyChrome()
  const [snap, setSnap] = useState(0)
  // product chrome: the sheet opens on the instrument the circuit is about — an
  // opened example's main instrument (examples.ts showExampleInstrument sets the
  // tray tab on phones too), else the last one used (IS-14); classic: the scope
  const [view, setViewState] = useState<LabView>(() => (classic ? 'scope' : useLab.getState().workspace.tray.tab))
  const setView = (v: LabView) => {
    setViewState(v)
    if (classic) return
    const lab = useLab.getState()
    if (lab.workspace.tray.tab !== v) lab.setWorkspace({ tray: { ...lab.workspace.tray, tab: v } })
  }
  useEffect(() => {
    if (open) setSnap(classic || desktop ? 0 : 1)
    if (open && !classic) setViewState(useLab.getState().workspace.tray.tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  // product chrome: the tray tab IS the current instrument — while the sheet is
  // open it follows a probe action, a problem's 「在模擬日誌中檢視」 or a lesson
  // step that points the instruments elsewhere (revealInstrument)
  useEffect(() => {
    if (!open || classic) return
    return useLab.subscribe((s, p) => {
      const tab = s.workspace.tray.tab
      if (tab === p.workspace.tray.tab) return
      setViewState(tab)
      if (tab !== 'scope' && !desktop) setSnap(1)
    })
  }, [open, classic, desktop])
  // 「在邏輯分析儀中檢視」 from the UART / log view (UX IS-8, contract K7):
  // the sheet follows to its logic view, at the tall detent
  useEffect(
    () =>
      useLogicReveal.subscribe((s, p) => {
        if (!s.request || s.request === p.request) return
        setView('logic')
        if (!desktop) setSnap(1)
      }),
    [desktop],
  )
  useLang()
  const title = classic ? t(LAB_VIEW_TITLES[view]) : t('Instruments')
  const viewOptions: SegmentedOption<LabView>[] = classic
    ? LAB_VIEW_OPTIONS.map((o) => ({ ...o, label: t(String(o.label)) }))
    : PRODUCT_VIEW_OPTIONS.map((o) => ({
        value: o.value,
        label: <span title={t(o.title)}>{o.ctx ? tc(o.label, o.ctx) : t(o.label)}</span>,
      }))

  return (
    <Sheet
      open={open}
      onDismiss={onDismiss}
      snapPoints={SNAP_POINTS}
      activeSnap={snap}
      onSnapChange={setSnap}
      desktop={desktop}
      anchor="right"
      ariaLabel={title}
      className="asm-sheet"
    >
      <div className={`asm-content ${desktop ? '' : 'sco-sheet-content'}`}>
        <div className="asm-sheet-head">
          <span className="lg-title">{title}</span>
        </div>

        <Segmented<LabView>
          value={view}
          onChange={(v) => {
            setView(v)
            // the text-heavy instruments want the tall detent
            if (v !== 'scope' && !desktop) setSnap(1)
          }}
          options={viewOptions}
          aria-label={t('Instrument')}
        />

        {view === 'scope' && <ScopeView active={open} />}
        {view === 'logic' && (
          <div className="emb-sheet-view">
            <LogicAnalyzer active={open} />
          </div>
        )}
        {view === 'uart' && (
          <div className="emb-sheet-view">
            <UartTerminal active={open} />
          </div>
        )}
        {view === 'log' && (
          <div className="emb-sheet-view">
            <SimLog active={open} />
          </div>
        )}
        {view === 'measure' && !classic && (
          <div className="emb-sheet-view">
            <MeasureView active={open} />
          </div>
        )}
      </div>
    </Sheet>
  )
}

/**
 * The oscilloscope body (legend chips + trigger status, the screen with
 * its measurement strip, the front panel) — shared by the Scope sheet and
 * the desktop workspace tray.
 */
export function ScopeView({ active }: { active: boolean }) {
  const setScopeWindow = useStore((s) => s.setScopeWindow)
  const components = useStore((s) => s.layout.components)
  const span = useScopeSettings((s) => 10 * s.tdiv)
  const holdoff = useScopeSettings((s) => s.holdoff)
  const trigMode = useScopeSettings((s) => s.trigMode)
  const [armedAt, setArmedAt] = useState<number | null>(null)
  const [frameInfo, setFrameInfo] = useState<{ status: ScopeStatus; legacy: boolean } | null>(null)
  const [exporting, setExporting] = useState(false)
  const frameRef = useRef<ScopeFrame | null>(null)
  const queryScope = useLab((s) => s.queryScope)
  const language = useLang()
  const classic = useLegacyChrome()
  const layout = useStore((s) => s.layout)
  // the probes by channel, named after their net (IS-13): 「CH1 · P1 · U1 PA6 網路」
  const probeNames = useMemo(
    () => (classic ? new Map<number, ScopeProbeName>() : scopeProbeNames(layout)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [classic, layout, language],
  )
  const [menu, setMenu] = useState<number | null>(null)
  const chipEls = useRef(new Map<number, HTMLElement>())
  // the board on the probed nets: when it is unpowered / without firmware / halted, the
  // readout says so first (IS-14, H5)
  const scopeBoard = useMemo(() => {
    if (classic) return null
    try {
      const netlist = buildNetlist(layout)
      for (const c of layout.components) {
        const hole = c.type === 'scope_probe' ? c.holes?.[0] : undefined
        const net = hole ? netlist.netOf(hole) : null
        const b = net ? boardOnNet(layout, netlist, net) : null
        if (b) return b
      }
    } catch {
      // an unreadable layout: no board to blame
    }
    return null
  }, [classic, layout])
  const blocker = useInstrumentBlocker(scopeBoard)
  // a probe action pointed at a channel that already shows the net: flash its chip
  const flashSeq = useScopeFlash((s) => s.seq)
  const [flashing, setFlashing] = useState<number | null>(null)
  useEffect(() => {
    const { channel: ch, at } = useScopeFlash.getState()
    // a fresh request only (the scope tab opening a minute later does not flash)
    if (!flashSeq || ch === null || Date.now() - at > 2000) return
    setFlashing(ch - 1)
    const id = window.setTimeout(() => setFlashing(null), 1600)
    return () => window.clearTimeout(id)
  }, [flashSeq])

  // which channels have a probe assigned (for the legend)
  const attached = [false, false, false, false]
  for (const c of components) {
    if (c.type === 'scope_probe') {
      const ch = Math.round(Number(c.params?.channel ?? 1))
      if (ch >= 1 && ch <= 4) attached[ch - 1] = true
    }
  }

  // the legacy 1 kHz feed (fallback) keeps enough history for the window
  // and the trigger search
  useEffect(() => {
    setScopeWindow(Math.min(40, Math.max(0.1, 2 * span + holdoff)))
  }, [span, holdoff, setScopeWindow])
  // leaving Single mode disarms
  useEffect(() => {
    if (trigMode !== 'single') setArmedAt(null)
  }, [trigMode])
  // an opened example / project asked for 自動設定 (no preset of its own):
  // run it the first time the scope is shown with enough of the signal
  const autoPending = useScopeSettings((s) => s.autoPending)
  useEffect(() => {
    if (!active || !autoPending) return
    let done = false
    const id = window.setInterval(() => {
      if (done || useStore.getState().simTime < 0.05) return
      done = true
      window.clearInterval(id)
      void runScopeAutoSetup()
    }, 250)
    return () => window.clearInterval(id)
  }, [active, autoPending])

  const exportCsv = async () => {
    const f = frameRef.current
    if (!f || exporting) return
    setExporting(true)
    try {
      let cap: ScopeCapture
      if (f.legacy) cap = legacyCapture(useStore.getState().scope.samples, f.t0, f.t1)
      else {
        // full resolution for the export (the display query may be decimated)
        const full = await queryScope(Math.max(0, f.t0), f.t1)
        cap = full.traces.length > 0 ? full : { t0: f.t0, t1: f.t1, traces: f.traces }
      }
      const traces = cap.traces.filter((tr) => attached[tr.index])
      downloadText(exportName('ohmlet-scope', f.t0, f.t1, 'csv'), scopeCsv({ ...cap, traces }), 'text/csv')
    } finally {
      setExporting(false)
    }
  }

  const status = frameInfo?.status
  const statusLabel: Record<ScopeStatus, string> = {
    roll: tc('Roll', 'scope-status'),
    trig: tc("Trig'd", 'scope-status'),
    auto: tc('Auto', 'scope-status'),
    ready: tc('Ready', 'scope-status'),
    armed: tc('Armed', 'scope-status'),
    stop: tc('Stop', 'scope-status'),
  }

  return (
    <>
      <div className="asm-scope-legend">
        {TRACE_COLORS.map((color, i) => {
          const pn = probeNames.get(i)
          if (!pn || !attached[i]) {
            return (
              <span
                key={i}
                className={`asm-scope-chip ${attached[i] ? '' : 'is-off'}`}
                title={attached[i] ? t('Channel {n}', { n: i + 1 }) : t('Channel {n} — no probe placed', { n: i + 1 })}
              >
                <span className="asm-scope-chip-dot" style={{ background: color }} />
                CH{i + 1}
              </span>
            )
          }
          // product chrome: the chip names its probe and net, and leads to it (IS-13)
          const spec = { holes: [pn.hole], components: [pn.id] }
          return (
            <button
              key={i}
              type="button"
              ref={(el) => {
                if (el) chipEls.current.set(i, el)
                else chipEls.current.delete(i)
              }}
              className={`asm-scope-chip sco-chip-btn ${flashing === i ? 'is-flash' : ''}`}
              title={t('CH{n}: probe {id} at {hole} — click to show it on the board; right-click for more', { n: i + 1, id: pn.id, hole: pn.hole })}
              aria-haspopup="menu"
              onClick={() => {
                focusInScene(spec, problemLevelSupported('info') ? { kind: 'problem', level: 'info' } : { kind: 'guide' })
                useStore.getState().select(pn.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu(i)
              }}
              onPointerEnter={() => highlightSource(spec)}
              onPointerLeave={() => highlightSource(null)}
            >
              <span className="asm-scope-chip-dot" style={{ background: color }} />
              <span className="sco-chip-text">
                CH{i + 1} · {pn.id} · {t('{name} net', { name: pn.net })}
              </span>
            </button>
          )
        })}
        {(() => {
          const pn = menu !== null ? probeNames.get(menu) : undefined
          return (
            <Popover anchor={menu !== null ? chipEls.current.get(menu) ?? null : null} open={!!pn} onClose={() => setMenu(null)} label={t('Channel {n}', { n: (menu ?? 0) + 1 })} width={260}>
              {pn && (
                <div className="lai-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="lai-menu-item"
                    onClick={() => {
                      setMenu(null)
                      focusInScene({ holes: [pn.hole], components: [pn.id] }, problemLevelSupported('info') ? { kind: 'problem', level: 'info' } : { kind: 'guide' })
                      useStore.getState().select(pn.id)
                    }}
                  >
                    {t('Show {id} ({hole}) on the board', { id: pn.id, hole: pn.hole })}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="lai-menu-item is-danger"
                    onClick={() => {
                      setMenu(null)
                      useStore.getState().removeComponent(pn.id)
                    }}
                  >
                    {t('Remove probe {id}', { id: pn.id })}
                  </button>
                </div>
              )}
            </Popover>
          )
        })()}
        <span className="emb-toolbar-spacer" />
        <ScopeTools onExport={() => void exportCsv()} exporting={exporting} attached={attached} />
        {frameInfo?.legacy && (
          <span className="sco-status" title={t('High-resolution recorder unavailable')}>
            {t('1 kHz feed')}
          </span>
        )}
        {status && (
          <span
            className={`sco-status ${status === 'trig' ? 'is-trig' : status === 'ready' || status === 'armed' ? 'is-wait' : status === 'stop' ? 'is-stop' : ''}`}
            aria-live="polite"
          >
            {statusLabel[status]}
          </span>
        )}
      </div>

      <ScopeCanvas
        active={active}
        attached={attached}
        armedAt={armedAt}
        onCaptured={() => setArmedAt(null)}
        onFrame={(f) => {
          frameRef.current = f
          setFrameInfo((prev) =>
            prev && f && prev.status === f.status && prev.legacy === f.legacy ? prev : f ? { status: f.status, legacy: f.legacy } : null,
          )
        }}
      />

      {blocker && (
        <div className="sco-blocker">
          <BlockerNote blocker={blocker} what="probe" />
        </div>
      )}
      {/* front panel under the screen, where the legacy window picker sat */}
      <ScopeControls armed={armedAt !== null} onSingle={() => setArmedAt(useStore.getState().simTime)} attached={attached} />
    </>
  )
}

const POLL_MS = 60
/** below this plot height the measurement rows after the first fold away (UX QA IS-F18) */
const MIN_PLOT_PX = 120

/**
 * Scope screen — mounted only while its host's content exists, so its refs
 * are always live. `active=false` (sheet closing / tray tab hidden) cancels
 * the acquisition poll and the rAF loop immediately: nothing runs while the
 * scope is not shown, and a paused simulation is neither re-queried nor
 * redrawn (the frame key does not change).
 */
export function ScopeCanvas({
  active,
  attached = [true, true, true, true],
  armedAt = null,
  onCaptured,
  onFrame,
}: {
  active: boolean
  attached?: readonly boolean[]
  armedAt?: number | null
  onCaptured?: () => void
  onFrame?: (f: ScopeFrame | null) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const queryScope = useLab((s) => s.queryScope)
  const queryLogic = useLab((s) => s.queryLogic)
  const logicChannels = useLab((s) => s.logicChannels)
  const layout = useStore((s) => s.layout)
  const sharedCursor = useLab((s) => s.labCursor.t)
  const settings = useScopeSettings()
  const language = useLang() // the canvas' placeholder text is localized: redraw on a switch
  // product chrome: thin out colliding time labels (a phone-width screen)
  const fitLabels = !useLegacyChrome()
  const frameRef = useRef<ScopeFrame | null>(null)
  const [frameRev, setFrameRev] = useState(0)
  const layoutRef = useRef<ScopeLayout | null>(null)
  const productRef = useRef(fitLabels)
  productRef.current = fitLabels
  /** the solver's typical step near the end of the recording (s; null = not measured) */
  const [stepEst, setStepEst] = useState<number | null>(null)
  const stepForRef = useRef<number | null>(null)
  const [cursorX, setCursorX] = useState<[number, number]>([0.3, 0.7])
  const [cursorY, setCursorY] = useState<[number, number] | null>(null)
  /** product chrome: the hover hairline's position (0…1 of the screen; null = none) — QA clarity SCOPE-CURSORS */
  const [hoverF, setHoverF] = useState<number | null>(null)
  const armedRef = useRef(armedAt)
  armedRef.current = armedAt
  const cbRef = useRef({ onCaptured, onFrame })
  cbRef.current = { onCaptured, onFrame }
  const attachedKey = attached.map((a) => (a ? 1 : 0)).join('')

  // ---- acquisition: pull the window from the recorder when anything changed
  useEffect(() => {
    if (!active) return
    let alive = true
    let inflight = false
    let lastKey = ''
    const att = attachedKey.split('').map((c) => c === '1')
    const poll = () => {
      if (inflight) return
      const st = useStore.getState()
      const s = useScopeSettings.getState()
      const now = st.simTime
      const armed = armedRef.current
      const frozen = s.trigSource !== null && s.trigMode === 'single' && armed === null && frameRef.current !== null
      const key = frozen
        ? 'frozen'
        : `${now}:${s.tdiv}:${s.trigSource}:${s.trigSlope}:${s.trigLevel}:${s.trigMode}:${s.holdoff}:${armed}:${st.scope.samples.length}`
      if (key === lastKey) return
      lastKey = key
      if (frozen) {
        // Single captured: keep the frame (re-built once for the new settings)
        const f = buildFrame({ cap: { t0: 0, t1: 0, traces: [] }, settings: s, now, attached: att, legacy: false, prev: frameRef.current, armedAt: null })
        frameRef.current = f
        cbRef.current.onFrame?.(f)
        setFrameRev((r) => r + 1)
        return
      }
      const { q0, q1 } = queryWindow(s, now, armed)
      inflight = true
      queryScope(Math.max(0, q0 - (productRef.current ? queryLead(s) : 0)), q1, MAX_POINTS)
        .then((res) => {
          if (!alive) return
          let cap = res
          let legacy = false
          const samples = useStore.getState().scope.samples
          if (cap.traces.length === 0 && samples.length > 0) {
            cap = legacyCapture(samples, q0, q1)
            legacy = true
          }
          const f = buildFrame({ cap, settings: s, now, attached: att, legacy, prev: frameRef.current, armedAt: armed })
          frameRef.current = f
          cbRef.current.onFrame?.(f)
          // a window between two solver steps (IS-14): learn the step once per timebase, to say it
          if (productRef.current && !legacy && now > 0 && att.some(Boolean) && !frameHasSamplesInWindow(f) && stepForRef.current !== s.tdiv) {
            stepForRef.current = s.tdiv
            queryScope(Math.max(0, now - 1e-3), now, MAX_POINTS)
              .then((wide) => {
                const tr = wide.traces.find((x) => att[x.index] && x.t.length > 2 && !traceDecimated(x))
                if (!tr || !alive) return
                const d: number[] = []
                for (let i = 1; i < tr.t.length; i++) if (tr.t[i] > tr.t[i - 1]) d.push(tr.t[i] - tr.t[i - 1])
                d.sort((a, b) => a - b)
                if (d.length > 0) setStepEst(d[d.length >> 1])
              })
              .catch(() => {})
          }
          if (s.trigMode === 'single' && armed !== null && f.status === 'stop') cbRef.current.onCaptured?.()
          setFrameRev((r) => r + 1)
        })
        .catch(() => {
          // host gone: the next poll retries
          lastKey = ''
        })
        .finally(() => {
          inflight = false
        })
    }
    poll()
    const t = window.setInterval(poll, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [active, queryScope, attachedKey])

  // ---- drawing: own rAF only while shown, redraw on change ----
  const cursors: ScopeCursors | undefined =
    settings.cursors === 'off'
      ? undefined
      : {
          mode: settings.cursors,
          x: [
            (frameRef.current ? frameRef.current.t0 - frameRef.current.ref : 0) + cursorX[0] * 10 * settings.tdiv,
            (frameRef.current ? frameRef.current.t0 - frameRef.current.ref : 0) + cursorX[1] * 10 * settings.tdiv,
          ],
          y: cursorY ?? defaultY(layoutRef.current),
        }
  // what the screen says without a sample in its window (product chrome, IS-14)
  const anyProbe = attached.some(Boolean)
  const started = useStore((st) => st.simTime > 0)
  const emptyText = !fitLabels
    ? undefined
    : !anyProbe
      ? coarsePointer()
        ? t('Long-press the hole or pin to measure, then choose “Place a scope probe”')
        : t('No scope probe in the circuit — right-click a pin → “Place a scope probe”')
      : !started
        ? t('Press “▶ Run simulation” (Space)')
        : stepEst !== null
          ? t('This timebase is faster than the simulation’s sample interval (about {dt}) — press “Auto setup”', { dt: fmtSi(stepEst, 's', 2) })
          : t('This timebase is faster than the simulation’s sample interval — press “Auto setup”')
  // product chrome (QA clarity SCOPE-CURSORS): the hover hairline while no cursor mode is on
  const hoverT =
    fitLabels && settings.cursors === 'off' && hoverF !== null && frameRef.current ? frameRef.current.t0 + hoverF * 10 * settings.tdiv : null
  const drawKey = `${frameRev}:${settings.tdiv}:${settings.vdiv}:${settings.vpos}:${settings.trigSource}:${settings.trigLevel}:${settings.cursors}:${settings.absTime}:${sharedCursor}:${cursorX.join()}:${cursorY?.join()}:${language}:${fitLabels}:${emptyText}:${hoverT}`
  const drawKeyRef = useRef(drawKey)
  drawKeyRef.current = drawKey
  const drawRef = useRef(() => {})
  drawRef.current = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const s = useScopeSettings.getState()
    layoutRef.current = drawScopeFrame(canvas, frameRef.current, s, cursors, {
      absTime: s.absTime,
      sharedCursor,
      fitLabels,
      units: fitLabels,
      emptyText,
      // the logic analyzer's marker names (A / B) and plain words for the voltage cursors
      cursorNames: fitLabels ? { time: ['A', 'B'], volt: [t('Voltage 1|cursor'), t('Voltage 2|cursor')] } : undefined,
      hoverT,
    })
  }

  useEffect(() => {
    if (!active) return
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    let resizeStamp = 0
    const ro = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      // a sheet still scaling in (transform) reports a shrunken box here and
      // no resize follows when the animation ends — the canvas then stays
      // stretched and blurry; use the layout size whenever they disagree
      const w = Math.abs(rect.width - wrap.offsetWidth) > 1 ? wrap.offsetWidth : rect.width
      const h = Math.abs(rect.height - wrap.offsetHeight) > 1 ? wrap.offsetHeight : rect.height
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      resizeStamp++
    })
    ro.observe(wrap)
    let raf = 0
    let lastKey = ''
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const key = `${drawKeyRef.current}:${resizeStamp}:${canvas.width}x${canvas.height}`
      if (key === lastKey) return // nothing changed since last draw — skip
      lastKey = key
      drawRef.current()
    }
    raf = requestAnimationFrame(loop)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [active])

  // ---- cursors: drag the nearer line ----
  const dragRef = useRef<{ k: 0 | 1; id: number } | null>(null)
  const place = (e: ReactPointerEvent<HTMLDivElement>, pick: boolean) => {
    const L = layoutRef.current
    const r = wrapRef.current?.getBoundingClientRect()
    if (!L || !r || settings.cursors === 'off') return
    const px = e.clientX - r.left
    const py = e.clientY - r.top
    if (settings.cursors === 'time') {
      const f = Math.max(0, Math.min(1, (px - L.padL) / L.pw))
      let k = dragRef.current?.k ?? 0
      if (pick) k = Math.abs(f - cursorX[0]) <= Math.abs(f - cursorX[1]) ? 0 : 1
      activeCursorRef.current = k
      setCursorX((c) => (k === 0 ? [f, c[1]] : [c[0], f]))
      return k
    }
    const v = L.vmax - ((Math.max(L.padT, Math.min(L.padT + L.ph, py)) - L.padT) / L.ph) * (L.vmax - L.vmin)
    const cur = cursorY ?? defaultY(L)
    let k = dragRef.current?.k ?? 0
    if (pick) k = Math.abs(v - cur[0]) <= Math.abs(v - cur[1]) ? 0 : 1
    activeCursorRef.current = k
    setCursorY(k === 0 ? [v, cur[1]] : [cur[0], v])
    return k
  }
  // keyboard, like the logic analyzer's markers (UX IS-9): A / B (or 1 / 2) pick the
  // cursor, ← → (time) or ↑ ↓ (voltage) move it 1 % of the screen (Shift: 10 %),
  // Esc puts both back
  const activeCursorRef = useRef<0 | 1>(0)
  /** the screen has KEYBOARD focus: the cursor keys are listed under the readout */
  const [keyFocus, setKeyFocus] = useState(false)
  const onCursorKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (settings.cursors === 'off') return
    const L = layoutRef.current
    const step = e.shiftKey ? 0.1 : 0.01
    const k = activeCursorRef.current
    let handled = true
    if (e.key === 'a' || e.key === 'A' || e.key === '1') activeCursorRef.current = 0
    else if (e.key === 'b' || e.key === 'B' || e.key === '2') activeCursorRef.current = 1
    else if (settings.cursors === 'time' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const d = e.key === 'ArrowLeft' ? -step : step
      setCursorX((c) => (k === 0 ? [clamp01(c[0] + d), c[1]] : [c[0], clamp01(c[1] + d)]))
    } else if (settings.cursors === 'volt' && L && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const d = (e.key === 'ArrowDown' ? -step : step) * (L.vmax - L.vmin)
      const cur = cursorY ?? defaultY(L)
      const lim = (v: number) => Math.max(L.vmin, Math.min(L.vmax, v))
      setCursorY(k === 0 ? [lim(cur[0] + d), cur[1]] : [cur[0], lim(cur[1] + d)])
    } else if (e.key === 'Escape') {
      setCursorX([0.3, 0.7])
      setCursorY(null)
    } else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // cursor voltages in the app's one format (H3) — classic keeps its own
  const cursorVolts = (v: number) => (fitLabels ? fmtVoltage(v, { precision: 'reading' }) : fmtSi(v, 'V'))

  const frame = frameRef.current
  const approx = frame?.decimated ? '≈' : ''

  // digital-exact timing: a probe on a net the logic analyzer records reads
  // frequency / duty from the cycle-exact edges (≤ 4 Hz, only with such a
  // link). The edges are read over the screen window, but never less than
  // the last NET_LIVE_WINDOW_S (100 ms) — a fast timebase still knows the
  // net's frequency, so 自動設定 and every V/div or timebase change keep the
  // exact reading instead of dropping to the analog estimate (UX IS-11). The
  // classification is measureEdges': a UART / SDA net gets no frequency, an
  // I²C / SPI clock its burst clock.
  const links = useMemo(() => scopeLogicLinks(layout, logicChannels), [layout, logicChannels])
  const [exact, setExact] = useState<Map<number, ExactTiming>>(() => new Map())
  const [analogLinks, setAnalogLinks] = useState<ReadonlySet<number>>(() => new Set())
  const exactAtRef = useRef(0)
  const [exactTick, setExactTick] = useState(0)
  useEffect(() => {
    const f = frameRef.current
    if (!active || !f || links.size === 0) {
      if (links.size === 0 && exact.size > 0) setExact(new Map())
      return
    }
    const nowMs = performance.now()
    const wait = 250 - (nowMs - exactAtRef.current)
    if (wait > 0) {
      // throttled: one trailing update so the last frame gets its exact values
      const id = window.setTimeout(() => setExactTick((x) => x + 1), wait)
      return () => window.clearTimeout(id)
    }
    exactAtRef.current = nowMs
    let alive = true
    const e1 = f.t1
    const e0 = Math.max(0, e1 - Math.max(f.t1 - f.t0, NET_LIVE_WINDOW_S))
    queryLogic(e0, e1)
      .then((cap) => {
        if (!alive) return
        // a link to a THRESHOLDED analog net has no exact edges: that channel keeps the analog path
        const analog = new Set<number>()
        for (const [sc, li] of links) if (cap.traces.some((x) => x.index === li && !x.exact)) analog.add(sc)
        setAnalogLinks((prev) => (prev.size === analog.size && [...analog].every((x) => prev.has(x)) ? prev : analog))
        setExact((prev) => {
          const next = new Map<number, ExactTiming>()
          for (const [sc, li] of links) {
            const tr = cap.traces.find((x) => x.index === li && x.exact)
            if (!tr) continue
            const m = measureEdges(tr, e0, e1)
            const old = prev.get(sc)
            // too few edges this time (the query raced a reset, or a slow signal at a
            // fast timebase): the last reading stays for up to a second, never longer
            next.set(sc, m.periodicity === 'unknown' && old && old.m.periodicity !== 'unknown' && e1 - old.e1 < 1 ? old : { m, e0, e1 })
          }
          return next
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRev, links, active, exactTick])

  // the serial line on each probed net (a USART pin of the firmware, or the UART
  // decoder of the linked logic channel): 「115 200 Bd · 8N1（由 USART1 設定）」
  // instead of a frequency. Re-read ≤ 1 Hz (pin modes and USART settings come
  // with the run) — never per frame.
  const rawDecoders = useLab((s) => s.logicView.decoders)
  const serialPorts = useLab((s) => s.serialPorts)
  const [lines, setLines] = useState<ReadonlyMap<number, { line: SerialLine | null; data: boolean }>>(() => new Map())
  useEffect(() => {
    if (!active) return
    const compute = () => {
      const st = useStore.getState()
      const lab = useLab.getState()
      const lay = st.layout
      let netlist: ReturnType<typeof buildNetlist>
      try {
        netlist = buildNetlist(lay)
      } catch {
        return
      }
      const decoders = sanitizeDecoderConfigs(lab.logicView.decoders)
      const linked = scopeLogicLinks(lay, lab.logicChannels)
      const ctx = { layout: lay, telemetry: st.telemetry, mcus: lab.mcus }
      const next = new Map<number, { line: SerialLine | null; data: boolean }>()
      for (const c of lay.components) {
        if (c.type !== 'scope_probe' || !c.holes?.[0]) continue
        const ch = Math.round(Number(c.params?.channel ?? 1)) - 1
        if (ch < 0 || ch > 3 || next.has(ch)) continue
        const net = netlist.netOf(c.holes[0])
        const li = linked.get(ch)
        const line = (net ? usartLineOnNet(net, netlist, ctx) : null) ?? (li !== undefined ? decoderLineOf(li, decoders) : null)
        next.set(ch, { line, data: li !== undefined && isDataChannel(li, decoders) })
      }
      setLines((prev) => (sameLines(prev, next) ? prev : next))
    }
    compute()
    const id = window.setInterval(compute, 1000)
    return () => window.clearInterval(id)
  }, [active, layout, logicChannels, rawDecoders, serialPorts])

  // the average / RMS of a min/max-decimated window from the FULL-resolution
  // recording of the same window (UX QA IS-F7 — the decimated pairs bias
  // them): at most 2 Hz while running (slower when the query is big), once
  // per window when paused or frozen. Product chrome only; until it arrives
  // the row says 「—（已抽樣，無法計算平均）」, never a biased ≈ value.
  const [fullStats, setFullStats] = useState<ReadonlyMap<number, FullStats>>(() => new Map())
  const [fullTick, setFullTick] = useState(0)
  const fullRef = useRef({ at: 0, key: '', seq: 0, every: 500 })
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  useEffect(() => {
    const f = frameRef.current
    if (!active || !fitLabels || !f || f.legacy) return
    const dec = f.traces.filter((tr) => tr.t.length > 0 && traceDecimated(tr)).map((tr) => tr.index)
    if (dec.length === 0) {
      if (fullStats.size > 0) setFullStats(new Map())
      return
    }
    const st = fullRef.current
    const key = `${f.t0}:${f.t1}:${dec.join()}`
    const running = useStore.getState().running
    if (!running && key === st.key) return
    const wait = running ? st.every - (performance.now() - st.at) : 0
    if (wait > 0) {
      const id = window.setTimeout(() => setFullTick((x) => x + 1), wait)
      return () => window.clearTimeout(id)
    }
    st.at = performance.now()
    st.key = key
    const seq = ++st.seq
    const started = performance.now()
    queryScope(Math.max(0, f.t0), f.t1)
      .then((cap) => {
        if (!mountedRef.current || seq !== fullRef.current.seq) return
        // never more often than 2 Hz, and at most a fifth of the time spent querying
        fullRef.current.every = Math.max(500, 4 * (performance.now() - started))
        setFullStats(averagesOf(cap, dec, f.t0, f.t1))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRev, active, fullTick])

  // ---- measurements of the displayed window (UX IS-2: never a wrong number) ----
  const meas = useMemo(() => {
    const f = frameRef.current
    if (!f) return []
    const L = layoutRef.current
    const pxPerSecond = L ? L.pw / (10 * useScopeSettings.getState().tdiv) : undefined
    const rows = f.traces
      .filter((tr) => tr.t.length > 0)
      .map((tr) => {
        const decimated = !f.legacy && traceDecimated(tr)
        // product chrome: the net's shortest known pulse (a serial bit, the exact edges)
        // against the analog sampling — a line faster than the samples gets no levels (IS-F6)
        const minPulse = fitLabels ? shortestPulse(lines.get(tr.index)?.line ?? null, exact.get(tr.index)?.m ?? null) : null
        const sampleInterval = fitLabels ? fullStats.get(tr.index)?.dt ?? stepEst : null
        return {
          index: tr.index,
          m: measureWave(tr.t, tr.v, f.t0, f.t1, { decimated, pxPerSecond, minPulse, sampleInterval }),
          // the stretch the probe's own samples cover (IS-F10)
          covered: amplitudeWindow(tr, f.t0, f.t1),
          decimated,
        }
      })
    // product chrome: every probed channel keeps its row while the window holds no
    // sample (a timebase faster than the solver's step, a frame between settings) —
    // its exact timing / serial line stays, the readout never blinks away
    if (fitLabels && !f.legacy) {
      for (let i = 0; i < 4; i++) {
        if (attachedKey[i] === '1' && !rows.some((r) => r.index === i)) rows.push({ index: i, m: measureWave([], []), covered: 0, decimated: false })
      }
      rows.sort((a, b) => a.index - b.index)
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRev, attachedKey, lines, exact, fullStats, stepEst])

  // a short screen (UX QA IS-F18): when every channel's row would leave the plot
  // under 120 px, the rows after the first fold into 「量測 ▾」
  const screenRef = useRef<HTMLDivElement>(null)
  const [screenH, setScreenH] = useState(0)
  const [rowH, setRowH] = useState(0)
  useEffect(() => {
    const el = screenRef.current
    if (!el || !fitLabels) return
    const ro = new ResizeObserver(() => {
      setScreenH(Math.round(el.getBoundingClientRect().height))
      const row = el.querySelector('.sco-meas-row')
      if (row) setRowH(Math.round(row.getBoundingClientRect().height))
    })
    ro.observe(el)
    const strip = el.querySelector('.sco-meas')
    if (strip) ro.observe(strip)
    return () => ro.disconnect()
  }, [fitLabels, meas.length > 0])
  const [measOpen, setMeasOpen] = useState(false)
  const cursorH = cursors ? 20 : 0
  const fold = fitLabels && meas.length > 1 && screenH > 0 && rowH > 0 && screenH - cursorH - 8 - meas.length * rowH < MIN_PLOT_PX
  const shownMeas = fold && !measOpen ? meas.slice(0, 1) : meas

  return (
    <div ref={screenRef} className="asm-scope-body sco-screen">
      <div
        ref={wrapRef}
        className="sco-canvas-wrap"
        style={{ cursor: settings.cursors === 'off' ? 'default' : 'crosshair' }}
        onPointerDown={(e) => {
          if (e.button !== 0 || settings.cursors === 'off') return
          e.currentTarget.setPointerCapture(e.pointerId)
          const k = place(e, true)
          if (k !== undefined) dragRef.current = { k, id: e.pointerId }
        }}
        onPointerMove={(e) => {
          if (dragRef.current?.id === e.pointerId) place(e, false)
          // product chrome: a hairline that reads every channel at the pointer (like the logic analyzer)
          if (fitLabels && settings.cursors === 'off' && e.pointerType === 'mouse') {
            const L = layoutRef.current
            const r = wrapRef.current?.getBoundingClientRect()
            if (L && r) {
              const f = (e.clientX - r.left - L.padL) / L.pw
              setHoverF(f >= 0 && f <= 1 ? f : null)
            }
          }
        }}
        onPointerLeave={() => setHoverF(null)}
        onPointerUp={() => (dragRef.current = null)}
        onPointerCancel={() => (dragRef.current = null)}
        tabIndex={settings.cursors === 'off' ? undefined : 0}
        onKeyDown={onCursorKey}
        title={
          settings.cursors === 'off'
            ? undefined
            : t('Cursors: drag a line, or pick one with A / B and move it with the arrow keys')
        }
        onFocus={(e) => setKeyFocus(e.currentTarget.matches(':focus-visible'))}
        onBlur={() => setKeyFocus(false)}
      >
        <canvas ref={canvasRef} className="asm-scope-canvas" />
      </div>
      {fitLabels && (cursors || hoverT !== null) && frame ? (
        <CursorReadout frame={frame} cursors={cursors ?? null} hoverT={cursors ? null : hoverT} absTime={settings.absTime} span={10 * settings.tdiv} keyFocus={keyFocus} />
      ) : cursors && (
        <div className="sco-cursor-line" aria-label={t('Cursor readout')}>
          {cursors.mode === 'time' ? (
            <>
              <span className="sco-meas-k">X1</span>
              {fmtSi(cursors.x[0], 's')}
              <span className="sco-meas-k"> X2</span>
              {fmtSi(cursors.x[1], 's')}
              <span className="sco-meas-k"> Δt</span>
              {fmtSi(cursors.x[1] - cursors.x[0], 's')}
              {cursors.x[1] !== cursors.x[0] && (
                <>
                  <span className="sco-meas-k"> 1/Δt</span>
                  {fmtFreq(1 / Math.abs(cursors.x[1] - cursors.x[0]))}
                </>
              )}
            </>
          ) : (
            <>
              <span className="sco-meas-k">Y1</span>
              {cursorVolts(cursors.y[0])}
              <span className="sco-meas-k"> Y2</span>
              {cursorVolts(cursors.y[1])}
              <span className="sco-meas-k"> ΔV</span>
              {cursorVolts(cursors.y[1] - cursors.y[0])}
            </>
          )}
          {keyFocus && (
            <KeyHelp
              items={[
                { keys: ['A', 'B'], text: t('pick a cursor') },
                { keys: cursors.mode === 'time' ? ['←', '→'] : ['↑', '↓'], text: t('move it') },
                { keys: ['Shift'], text: tc('faster', 'keys') },
                { keys: ['Esc'], text: tc('reset', 'keys') },
              ]}
            />
          )}
        </div>
      )}
      {meas.length > 0 && (
        <div className={`sco-meas ${fitLabels ? 'is-rows' : ''}`} aria-label={t('Measurements')}>
          {shownMeas.map(({ index, m, covered, decimated }) => (
            <MeasRow
              key={index}
              index={index}
              m={m}
              approx={approx}
              exact={exact.get(index)}
              line={lines.get(index)?.line ?? null}
              data={lines.get(index)?.data ?? false}
              linked={links.has(index) && !analogLinks.has(index)}
              frame={frame}
              legacy={!!frame?.legacy}
              covered={covered}
              decimated={decimated}
              full={fullStats.get(index)}
              started={started}
            />
          ))}
          {fold && (
            <button type="button" className="sco-meas-fold" aria-expanded={measOpen} onClick={() => setMeasOpen((o) => !o)}>
              {measOpen ? t('Readings ▴') : t('Readings ▾')}
              {!measOpen && <span className="sco-meas-fold-n">{t('{n} more channels', { n: meas.length - 1 })}</span>}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Product chrome (QA clarity SCOPE-CURSORS): what the cursors measure, in the
 * logic analyzer's words — 「A −4.000 ms · CH1 0 V · CH2 1.87 V ｜ B 4.000 ms ·
 * CH1 5.00 V · CH2 4.86 V ｜ Δt 8.000 ms · 1/Δt 125.0 Hz」: every channel's
 * voltage interpolated at each cursor; the voltage cursors 「電壓 1 · 電壓 2 ·
 * ΔV」; without a cursor mode the hover hairline 「游標 −1.234 ms · CH1 3.30 V」.
 */
function CursorReadout({
  frame,
  cursors,
  hoverT,
  absTime,
  span,
  keyFocus,
}: {
  frame: ScopeFrame
  cursors: ScopeCursors | null
  hoverT: number | null
  absTime: boolean
  span: number
  keyFocus: boolean
}) {
  const k = (label: React.ReactNode) => <span className="sco-meas-k">{label}</span>
  /** a cursor's time: relative to the screen's 0 (the trigger, or the newest sample) — or the simulation clock */
  const when = (rel: number) => (absTime ? fmtSimTimeAt(frame.ref + rel, span / 1000) : fmtSiSigned(rel, 's'))
  const volts = (at: number) =>
    frame.traces.map((tr) => (
      <span key={tr.index} className="sco-cur-ch">
        <span className="sco-meas-dot" style={{ background: TRACE_COLORS[tr.index] }} aria-hidden="true" />
        CH{tr.index + 1} {fmtVoltage(valueAt(tr, at))}
      </span>
    ))
  return (
    <div className="sco-cursor-line is-product" aria-label={t('Cursor readout')}>
      {cursors?.mode === 'time' ? (
        <>
          <span className="sco-cur-part">
            <span className="sco-cur-name is-a">A</span>
            {when(cursors.x[0])}
            {volts(frame.ref + cursors.x[0])}
          </span>
          <span className="sco-cur-sep" aria-hidden="true">｜</span>
          <span className="sco-cur-part">
            <span className="sco-cur-name is-b">B</span>
            {when(cursors.x[1])}
            {volts(frame.ref + cursors.x[1])}
          </span>
          <span className="sco-cur-sep" aria-hidden="true">｜</span>
          <span className="sco-cur-part">
            {k(<InstrumentTerm id="dt">Δt</InstrumentTerm>)}
            {fmtSiSigned(cursors.x[1] - cursors.x[0], 's')}
            {cursors.x[1] !== cursors.x[0] && (
              <>
                {' · '}
                {k('1/Δt')}
                {fmtFreq(1 / Math.abs(cursors.x[1] - cursors.x[0]))}
              </>
            )}
          </span>
        </>
      ) : cursors?.mode === 'volt' ? (
        <>
          <span className="sco-cur-part">
            <span className="sco-cur-name is-a">{t('Voltage 1|cursor')}</span>
            {fmtVoltage(cursors.y[0], { precision: 'reading' })}
          </span>
          <span className="sco-cur-part">
            <span className="sco-cur-name is-b">{t('Voltage 2|cursor')}</span>
            {fmtVoltage(cursors.y[1], { precision: 'reading' })}
          </span>
          <span className="sco-cur-part">
            {k('ΔV')}
            {fmtVoltage(cursors.y[1] - cursors.y[0], { precision: 'reading' })}
          </span>
        </>
      ) : hoverT !== null ? (
        <span className="sco-cur-part">
          {k(tc('Cursor', 'la-foot'))}
          {when(hoverT - frame.ref)}
          {volts(hoverT)}
        </span>
      ) : null}
      {keyFocus && cursors && (
        <KeyHelp
          items={[
            { keys: ['A', 'B'], text: t('pick a cursor') },
            { keys: cursors.mode === 'time' ? ['←', '→'] : ['↑', '↓'], text: t('move it') },
            { keys: ['Shift'], text: tc('faster', 'keys') },
            { keys: ['Esc'], text: tc('reset', 'keys') },
          ]}
        />
      )}
    </div>
  )
}

/** A touch-first device (the long-press wording). */
function coarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function defaultY(L: ScopeLayout | null): [number, number] {
  if (!L) return [0, 3.3]
  const r = L.vmax - L.vmin
  return [L.vmin + 0.25 * r, L.vmin + 0.75 * r]
}

/** The exact edges of a probed net over [e0, e1] (the scope's digital-exact path). */
interface ExactTiming {
  m: EdgeMeasurements
  e0: number
  e1: number
}

function sameLines(
  a: ReadonlyMap<number, { line: SerialLine | null; data: boolean }>,
  b: ReadonlyMap<number, { line: SerialLine | null; data: boolean }>,
): boolean {
  if (a.size !== b.size) return false
  for (const [k, x] of a) {
    const y = b.get(k)
    if (!y || x.data !== y.data || JSON.stringify(x.line) !== JSON.stringify(y.line)) return false
  }
  return true
}

interface MeasRowProps {
  index: number
  m: WaveMeasurements
  /** '≈' when the samples may be min/max decimated (averages approximate) */
  approx: string
  /** frequency / period / duty from the logic recorder's exact edges of the same net */
  exact?: ExactTiming
  /** the net is a serial line (USART pin / UART decoder): its baud rate, not a frequency */
  line?: SerialLine | null
  /** the linked logic channel carries bus data (SDA, MOSI …) */
  data?: boolean
  /** a logic channel records this net (the exact path owns the timing — never the analog estimate) */
  linked?: boolean
  frame?: ScopeFrame | null
  legacy: boolean
  /** s: the stretch of the window the probe's own samples cover (IS-F10) */
  covered?: number
  /** the window's samples were min/max decimated (the averages need the full recording, IS-F7) */
  decimated?: boolean
  /** the averages of the same window at full resolution (IS-F7) */
  full?: FullStats
  /** the simulation has run (product chrome: before it, the row says 「尚未執行」 — QA clarity SCOPE-READOUT-TRIGGER) */
  started?: boolean
}

function MeasRow(props: MeasRowProps) {
  return useLegacyChrome() ? <MeasRowClassic {...props} /> : <MeasRowProduct {...props} />
}

/**
 * Product chrome (UX IS-11 / IS-17): one wrapping row per channel, H3
 * formats, and honest timing — the serial line of a UART pin, the exact
 * frequency of a recorded net (kept through setting changes), the burst
 * clock of a bus clock, 「—（非週期訊號）」 for data; an analog-only
 * frequency is always 「≈」 with at most the digits the samples resolve.
 */
function MeasRowProduct({ index, m, approx, exact, line, data = false, linked = false, frame, legacy, covered = 0, decimated = false, full, started = true }: MeasRowProps) {
  // before the first run there is nothing to measure — a neutral word, never the orange 「取樣不足」
  if (!started) {
    return (
      <div className="sco-meas-row">
        <span className="sco-meas-ch">
          <span className="sco-meas-dot" style={{ background: TRACE_COLORS[index] }} aria-hidden="true" />
          CH{index + 1}
        </span>
        <span className="sco-meas-idle" role="note">
          {t('Not run yet — press “▶ Run simulation” (Space)')}
        </span>
      </div>
    )
  }
  const title =
    t('CH{n}: {count} samples', { n: index + 1, count: m.samples }) +
    (m.rise !== null ? t(' · rise 10–90 % {time}', { time: fmtSi(m.rise, 's') }) : '') +
    (m.fall !== null ? t(' · fall 90–10 % {time}', { time: fmtSi(m.fall, 's') }) : '') +
    (approx ? t(' · min/max-decimated: averages approximate') : '')
  const volts = (x: number | null, estimate = false) => {
    if (empty) return '—'
    const s = fmtVoltage(x, { precision: 'reading' })
    return estimate ? approxText(s) : s
  }
  const k = (label: React.ReactNode) => <span className="sco-meas-k">{label}</span>
  const cells: React.ReactNode[] = []
  const empty = m.samples < 2 && m.amplitude === null
  const flat = !empty && m.vpp !== null && m.vpp <= 0.01
  if (line) {
    cells.push(
      <span key="line" className="sco-meas-line" title={t('A serial line has no frequency — this is its baud rate.')}>
        {k(tc('baud', 'meas'))}
        {serialLineText(line)}
      </span>,
    )
  } else if (exact || linked) {
    const em = exact?.m ?? null
    const cell = timingCell(em, null, data)
    const span = exact ? exact.e1 - exact.e0 : 0
    const sameWindow = !!exact && !!frame && Math.abs(span - (frame.t1 - frame.t0)) <= 0.01 * span && Math.abs(exact.e1 - frame.t1) <= 0.01 * span
    const fromEdges = sameWindow ? t('From the exact edges the logic analyzer records on this net') : t('From the exact edges the logic analyzer recorded on this net in the last {span}', { span: fmtSpan(span) })
    if (cell.kind === 'freq' && em) {
      cells.push(
        <span key="f" title={[fromEdges, cell.title].filter(Boolean).join(' · ')}>
          {k(cell.label)}
          {cell.value}
          <span className="sco-exact">{t('(digital, exact)')}</span>
        </span>,
        <span key="T">
          {k(<InstrumentTerm id="period">{tc('T', 'meas')}</InstrumentTerm>)}
          {em.period !== null ? fmtSi(em.period, 's') : '—'}
        </span>,
      )
      // the duty next to the levels: the screen's own when its samples hold it
      // (the same window as the average); else the exact one, named by its window
      if (m.timing === null && m.duty !== null) {
        cells.push(
          <span key="duty">
            {k(<DutyTerm />)}
            {fmtPercent(m.duty)}
          </span>,
        )
      } else if (em.duty !== null) {
        cells.push(
          <span key="duty" title={fromEdges}>
            {k(<DutyTerm label={sameWindow ? undefined : t('duty (last {span})', { span: fmtSpan(span) })} />)}
            {fmtPercent(em.duty)}
          </span>,
        )
      }
    } else if (cell.kind === 'burst') {
      cells.push(
        <span key="f" title={[fromEdges, cell.title].join(' · ')}>
          {k(cell.label)}
          {cell.value}
          <span className="sco-exact">{t('(digital, exact)')}</span>
        </span>,
      )
    } else if (cell.kind === 'aperiodic') {
      cells.push(
        <span key="f" title={cell.title}>
          {k(cell.label)}
          {cell.value}
        </span>,
      )
    } else if (flat || empty) {
      cells.push(
        <span key="note" className="sco-meas-note" role="note">
          {empty ? t('Not enough samples in this window') : t('No change in the window')}
        </span>,
      )
    } else {
      // recorded, but no complete period yet: never the analog estimate instead
      cells.push(
        <span key="f" title={t('Waiting for the exact edges of this net')}>
          {k(cell.label)}—
        </span>,
      )
    }
  } else if (empty) {
    cells.push(
      <span key="note" className="sco-meas-note" role="note">
        {t('Not enough samples in this window')}
      </span>,
    )
  } else if (m.timing === 'aperiodic') {
    cells.push(
      <span key="f" title={t('The edges do not repeat, so there is no frequency or duty to measure.')}>
        {k(tc('f', 'meas'))}
        {t('— (not periodic)')}
      </span>,
    )
  } else if (m.timing !== null) {
    cells.push(
      <span key="note" className="sco-meas-note" role="note">
        {legacy ? t('Too few samples (1 kHz backup feed) to measure frequency') : t('Timebase too slow to measure frequency — press “Auto setup”')}
      </span>,
    )
  } else if (flat) {
    cells.push(
      <span key="note" className="sco-meas-note" role="note">
        {t('No change in the window')}
      </span>,
    )
  } else if (m.frequency === null && m.vpp !== null && m.vpp > 0.01) {
    cells.push(
      <span key="note" className="sco-meas-note" role="note">
        {t('No complete cycle in the window — press “Auto setup”')}
      </span>,
    )
  } else if (m.frequency !== null) {
    // an analog estimate: always ≈, and no more digits than the samples resolve
    const digits = m.samplesPerPeriod !== null && m.samplesPerPeriod < ANALOG_FINE_SAMPLES ? 3 : 4
    cells.push(
      <span key="f" title={t('Estimated from the sampled waveform (mean crossings)')}>
        {k(tc('f', 'meas'))}
        {approxText(fmtFreq(m.frequency, digits))}
      </span>,
      <span key="T">
        {k(<InstrumentTerm id="period">{tc('T', 'meas')}</InstrumentTerm>)}
        {m.period !== null ? approxText(fmtSi(m.period, 's', digits)) : '—'}
      </span>,
    )
    // a duty cycle only for a signal with two levels — an RC curve or a sine has none (QA clarity SCOPE-READOUT-TRIGGER)
    if (m.shape !== 'analog') {
      cells.push(
        <span key="duty">
          {k(<DutyTerm />)}
          {m.duty !== null ? approxText(fmtPercent(m.duty)) : '—'}
        </span>,
      )
    }
  }
  // ---- the levels (UX QA IS-F6 / F7 / F10) ----
  const em = exact?.m ?? null
  const frameSpan = frame ? frame.t1 - frame.t0 : 0
  // the linked net's frequency is known, but the probe's samples do not hold one
  // period of it yet (a probe placed a moment ago): no level from a part of a cycle
  const capturing = !empty && m.amplitude === null && !!em && em.frequency !== null && em.frequency > 0 && covered < 1 / em.frequency
  // the amplitude's window, named when the duty next to it is the exact edges' one
  // with a window of its own (「工作週期（最近 2.83 s）」) and the probe's samples
  // cover another stretch (「峰對峰值（最近 1.20 s）」); the screen's duty shares the samples
  const exactSpan = exact ? exact.e1 - exact.e0 : 0
  const exactSameWindow = !!exact && !!frame && Math.abs(exactSpan - frameSpan) <= 0.01 * exactSpan && Math.abs(exact.e1 - frame.t1) <= 0.01 * exactSpan
  const exactDutyLabelled =
    !line && !!em && em.periodicity === 'periodic' && em.frequency !== null && em.duty !== null && !(m.timing === null && m.duty !== null) && !exactSameWindow
  const levelsShown = m.amplitude === null && !capturing && !empty
  const ampLabel = (label: string, labelled: string) =>
    levelsShown && exactDutyLabelled && covered > 0 && Math.abs(covered - exactSpan) > 0.02 * exactSpan ? t(labelled, { span: fmtSpan(covered) }) : label
  const amp: { vpp: string; vavg: string; vrms: string; avgTitle?: string } =
    m.amplitude === 'undersampled'
      ? { vpp: t('— (undersampled)'), vavg: '—', vrms: '—' }
      : capturing
        ? { vpp: t('— (capturing)'), vavg: t('— (capturing)'), vrms: t('— (capturing)') }
        : decimated
          ? full && full.vavg !== null && full.vrms !== null
            ? { vpp: volts(m.vpp), vavg: volts(full.vavg), vrms: volts(full.vrms), avgTitle: t('From the full-resolution recording of this window') }
            : { vpp: volts(m.vpp), vavg: t('— (decimated, no average)'), vrms: t('— (decimated, no average)') }
          : { vpp: volts(m.vpp), vavg: volts(m.vavg, !!approx), vrms: volts(m.vrms, !!approx) }
  const sampled = m.amplitude === 'undersampled' && m.sampleInterval !== null
  // the readout adapts to the signal (QA clarity SCOPE-READOUT-TRIGGER): two levels → 峰對峰值 · 平均值;
  // an analog shape → 最大 · 最小 · 峰對峰值 · 平均值 · 均方根 · 上升時間（10–90 %）
  const digital = !!line || !!exact || linked
  const analog = !digital && m.shape === 'analog' && levelsShown && !decimated
  return (
    <div className="sco-meas-row" title={title}>
      <span className="sco-meas-ch">
        <span className="sco-meas-dot" style={{ background: TRACE_COLORS[index] }} aria-hidden="true" />
        CH{index + 1}
      </span>
      {cells}
      {analog && (
        <>
          <span>
            {k(tc('max', 'meas'))}
            {volts(m.vmax)}
          </span>
          <span>
            {k(tc('min', 'meas'))}
            {volts(m.vmin)}
          </span>
        </>
      )}
      <span>
        {k(<InstrumentTerm id="vpp">{ampLabel(tc('Vpp', 'meas'), 'Vpp (last {span})')}</InstrumentTerm>)}
        {amp.vpp}
      </span>
      <span title={amp.avgTitle}>
        {k(<InstrumentTerm id="avg">{ampLabel(tc('Vavg', 'meas'), 'Vavg (last {span})')}</InstrumentTerm>)}
        {amp.vavg}
      </span>
      {(analog || !digital) && m.shape !== 'two-level' && (
        <span title={amp.avgTitle}>
          {k(<InstrumentTerm id="rms">{ampLabel(tc('Vrms', 'meas'), 'Vrms (last {span})')}</InstrumentTerm>)}
          {amp.vrms}
        </span>
      )}
      {analog && m.rise !== null && (
        <span title={t('From the sampled waveform: 10 % → 90 % of the swing')}>
          {k(<InstrumentTerm id="rise">{t('Rise time (10–90 %)|meas')}</InstrumentTerm>)}
          {approxText(fmtSi(m.rise, 's', 3))}
        </span>
      )}
      {sampled && (
        <span className="sco-meas-note sco-meas-under" role="note">
          {line
            ? t('This line’s bits are only {bit} long and the simulation samples the analog value about every {dt}: the waveform and its peak-to-peak are not reliable — use the logic analyzer instead', {
                bit: fmtSi(1 / line.baud, 's', 3),
                dt: fmtSi(m.sampleInterval!, 's', 2),
              })
            : t('This line’s pulses are typically only {pulse} long and the simulation samples the analog value about every {dt}: the waveform and its peak-to-peak are not reliable — use the logic analyzer instead', {
                pulse: fmtSi(shortestPulse(null, em) ?? 0, 's', 3),
                dt: fmtSi(m.sampleInterval!, 's', 2),
              })}
          <button type="button" className="lai-hint-btn" onClick={() => showInstrument('logic')}>
            {t('Open the logic analyzer')}
          </button>
        </span>
      )}
    </div>
  )
}

/** Classic chrome: the measurement strip as before (a grid of one row per channel). */
function MeasRowClassic({ index, m, approx, exact, legacy }: MeasRowProps) {
  const v = (x: number | null, unit: string, a = '') => (x === null ? '—' : `${a}${fmtSi(x, unit)}`)
  const title =
    t('CH{n}: {count} samples', { n: index + 1, count: m.samples }) +
    (m.rise !== null ? t(' · rise 10–90 % {time}', { time: fmtSi(m.rise, 's') }) : '') +
    (m.fall !== null ? t(' · fall 90–10 % {time}', { time: fmtSi(m.fall, 's') }) : '') +
    (approx ? t(' · min/max-decimated: averages approximate') : '')
  const em = exact?.m
  const exactKnown = !!em && em.frequency !== null
  return (
    <>
      <span className="sco-meas-ch" title={title}>
        <span className="sco-meas-dot" style={{ background: TRACE_COLORS[index] }} aria-hidden="true" />
        CH{index + 1}
      </span>
      {exactKnown ? (
        <>
          <span title={t('From the exact edges the logic analyzer records on this net')}>
            <span className="sco-meas-k">{tc('f', 'meas')}</span>
            {fmtFreq(em!.frequency!)}
            <span className="sco-exact">{t('(digital, exact)')}</span>
          </span>
          <span>
            <span className="sco-meas-k">{tc('T', 'meas')}</span>
            {v(em!.period, 's')}
          </span>
          <span>
            <span className="sco-meas-k">{tc('duty', 'meas')}</span>
            {m.timing === null && m.duty !== null ? fmtPercent(m.duty) : em!.duty === null ? '—' : fmtPercent(em!.duty)}
          </span>
        </>
      ) : m.timing === 'decimated' || m.timing === 'undersampled' ? (
        <span className="sco-meas-note" role="note">
          {legacy
            ? t('Too few samples (1 kHz backup feed) to measure frequency')
            : t('Timebase too slow to measure frequency — press “Auto setup”')}
        </span>
      ) : (
        <>
          <span>
            <span className="sco-meas-k">{tc('f', 'meas')}</span>
            {m.frequency === null ? '—' : `${approx}${fmtFreq(m.frequency)}`}
          </span>
          <span>
            <span className="sco-meas-k">{tc('T', 'meas')}</span>
            {v(m.period, 's', approx)}
          </span>
          <span>
            <span className="sco-meas-k">{tc('duty', 'meas')}</span>
            {m.duty === null ? '—' : `${approx}${fmtPercent(m.duty)}`}
          </span>
        </>
      )}
      <span>
        <span className="sco-meas-k">{tc('Vpp', 'meas')}</span>
        {v(m.vpp, 'V')}
      </span>
      <span>
        <span className="sco-meas-k">{tc('Vavg', 'meas')}</span>
        {v(m.vavg, 'V', approx)}
      </span>
      <span>
        <span className="sco-meas-k">{tc('Vrms', 'meas')}</span>
        {v(m.vrms, 'V', approx)}
      </span>
    </>
  )
}

// ---------------------------------------------------------------------------
// Canvas rendering (src/ui/embedded/instruments/scope-engine.ts keeps the
// legacy ScopePanel look; this is the legacy-signature entry point)
// ---------------------------------------------------------------------------

/**
 * Draw the legacy 1 kHz feed as a rolling window of `timeWindow` seconds
 * ending at the newest sample (the old ScopePanel behaviour).
 */
export function drawScope(canvas: HTMLCanvasElement, samples: ScopeSample[], timeWindow: number): void {
  const tEnd = samples.length > 0 ? samples[samples.length - 1].t : timeWindow
  const cap = legacyCapture(samples, tEnd - timeWindow, tEnd)
  const settings: ScopeSettings = { ...SCOPE_DEFAULTS, tdiv: timeWindow / 10 }
  const frame: ScopeFrame = {
    traces: cap.traces,
    t0: tEnd - timeWindow,
    t1: tEnd,
    ref: tEnd,
    trigger: null,
    status: 'roll',
    decimated: false,
    legacy: true,
  }
  drawScopeFrame(canvas, frame, settings)
}
