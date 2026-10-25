/**
 * Logic analyzer — raw digital traces of up to 16 channels, protocol
 * decoders, trigger, cursor measurements and exports.
 *
 * Channels come from placed `logic_probe` parts, MCU board pins, buses
 * (channels + decoder in one step) or any wired net (LogicChannelConfig via
 * lab.setLogicChannels). The view PULLS a window of edges from the
 * simulation host (lab.queryLogic(t0, t1)) — the recorder lives next to the
 * coordinator, so no sample stream ever crosses into React. Exact channels
 * (MCU-driven / logic-resolvable nets) carry cycle-accurate edge times;
 * thresholded analog nets are marked "≈". A frozen window that reaches past
 * the last simulated instant is drawn only up to it (hatched beyond) —
 * nothing is extrapolated.
 *
 * Shows the signal by default (UX IS-1): "Auto" fits the window to the
 * busiest channel (4–10 periods, live) or to the newest decoded frame, when
 * channels change and when the first edges appear, until the user zooms or
 * pans. The view state (window, markers, results pane) lives in a session
 * store (instruments/la-view.ts) so switching tray tabs keeps it.
 *
 * Decoders (UART / I²C / SPI / 1-Wire) and the trigger live in the lab
 * store (lab.logicView — the single source of truth, UX IS-3); their full
 * editors open in popovers from summary chips (UX IS-5) so they never push
 * the waveform out of the tray. 「解碼結果」 lists the decoded transactions
 * of the recording, searchable; ⏮ / ⏭ step through frames (or edges of the
 * focused channel without decoders), ⤢ shows the whole recording (UX IS-6).
 *
 * Interaction (desktop + touch): wheel / buttons zoom around the pointer,
 * drag pans (and leaves Live and Auto), the hairline cursor reads time +
 * levels, clicks drop markers A then B (a third click moves the nearer
 * one); the footer shows Δt, 1/Δt and frequency / duty / edges of the
 * hovered channel between the markers (or over the visible window).
 * Marker A is also the instruments' shared time cursor (lab.labCursor).
 * Export: VCD (logic levels) and CSV (edges, decoded annotations) of the
 * visible window or of everything recorded.
 */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { CloseIcon, EllipsisIcon, MinusIcon, PlusIcon, showToast, tick } from '../kit'
import { useStore } from '../../state/store'
import type { LogicCapture, LogicChannelConfig, LogicSource } from '../../sim/coordinator/api'
import { measureEdges, recentEdgeMeasurements, type EdgeMeasurements, type PulseStats } from '../../instruments/measure'
import { findLogicTrigger, type LogicTriggerSpec } from '../../instruments/trigger'
import { annotationsCsv, logicEdgesCsv, toVcd } from '../../instruments/export'
import { fmtBaud, fmtFreq, fmtSi, fmtSimTimeAt, fmtSpan, fmtTickAnchor, fmtTimeRange, fmtVoltage } from '../../instruments/format'
import { laAxisLabels } from './instruments/la-axis'
import { useLegacyChrome } from '../chrome/legacy'
import { fitLogicSpan, spanAtLeast, type LogicFit } from '../../instruments/autofit'
import { logicSourcePresent, useLab } from './lab'
import { ChipButton, EmptyNote, IconButton, SelectField, ToggleChip, type SelectGroup } from './controls'
import {
  decodedFrames,
  decoders as decoderList,
  runDecoder,
  type DecodedFrame,
  type DecoderRun,
  type LogicAnnotationRow,
  type LogicDecoderConfig,
} from './logic-decoders'
import { CHANNEL_COLORS } from './instruments/colors'
import { TICK_SPACE } from './instruments/scope-engine'
import { DecoderEditor } from './instruments/DecoderPanel'
import { DecodeResults } from './instruments/DecodeResults'
import { Popover } from './instruments/Popover'
import { KeyHelp } from './instruments/KeyHelp'
import { TriggerPanel, type TriggerStatus } from './instruments/TriggerPanel'
import { drawAnnotationLane } from './instruments/draw-annotations'
import { downloadText, exportName } from './instruments/download'
import {
  decoderSummary,
  measuredBaudOf,
  newDecoderConfig,
  sanitizeDecoderConfigs,
  sanitizeTrigger,
  triggerCondition,
  TRIGGER_DEFAULTS,
  type LogicTriggerPrefs,
} from './instruments/la-config'
import { analysisAutoOpen, isAnalysisArrangement, manualLaView, requestLaFit, setLaView, stepSpan, useLaView, watchLaInputs } from './instruments/la-view'
import { collectFrames, findEdge, overwrittenBefore, stepFrame } from './instruments/la-frames'
import { giveLogicPlotRoom } from './instruments/lab-watchers'
import { EMPTY_RECHECK_MS, autoFitFallback, firstRecordedChange } from './instruments/la-no-signal'
import { channelPickerGroups } from './instruments/channel-picker'
import { dutyText, isClockChannel, isDataChannel, serialLineOfChannel, timingCell, type SerialLine, type TimingCell } from './instruments/signal-readout'
import { InstrumentTerm } from './instruments/InstrumentTerm'
import { buildNetlist, type Netlist } from '../../sim/netlist'
import { boardConfigOf } from '../../model/types'
import { getEntry } from '../../model/catalog'
import { componentPinHoles, formatHole } from '../../model/breadboard'
import { USART_RX, rxPinOf } from './instruments/uart-sent'
import { addBusFor, addLogicChannelFor, addScopeProbeFor, logicSourceEndpoint, useLogicFlash, type ProbeTarget } from './probe-actions'
import { channelDisplayName, displayLabels, type ChannelName } from './instruments/channel-name'
import { focusInScene, highlightSource, problemLevelSupported } from '../workspace/scene-bridge'
import { focusInspector } from './problems'
import { BlockerNote, boardFor, useInstrumentBlocker } from './instruments/BlockerNote'
import { DutyTerm } from './instruments/DutyTerm'
import { t, useLang } from '../../i18n'
import { tMessage } from '../../i18n/messages'
import { pinModeLabel, tc } from './text'
import './embedded.css'
import './instruments/instruments.css'

export { CHANNEL_COLORS }

watchLaInputs()

const AXIS_H = 20
/** a tray at least this wide gives the decode results their full 380 px (UX QA IS-F4) */
const ROOMY_RESULTS_PX = 900
/** trace row height range (rows grow with the free height, UX IS-5) */
const ROW_MIN = 28
/** rows at least this tall show the source line under the name */
const ROW_TWO_LINES = 34
/** the plot (axis + traces) keeps at least this much height (UX IS-5) */
const PLOT_MIN = 120
const ROW_MAX = 56
const ANN_H = 20
const POLL_MS = 100
/** auto-fit re-check while waiting for edges / following frames */
const FIT_MS = 1000
/** extra history the decoders see left of the window (s, at least) */
const DECODE_LOOKBACK = 5e-3
/** the window has 10 divisions, like the scope (UX IS-8) */
const DIVS = 10
/** markers snap to an edge this close (px; a finger gets more — UX IS-15) */
const SNAP_PX = 12
const SNAP_PX_TOUCH = 20
/** a decoded byte narrower than this (px) cannot carry its label: the lane shows lines instead */
const COARSE_BELOW_PX = 22
/** toolbar gaps (instruments.css .lai-tb-group / .lai-toolbar) */
const TB_ITEM_GAP = 6
const TB_GROUP_GAP = 12

function sourceKey(s: LogicSource): string {
  switch (s.kind) {
    case 'probe':
      return `probe|${s.componentId}`
    case 'mcu-pin':
      return `mcu|${s.componentId}|${s.pin}`
    case 'net':
      return `net|${s.ref}`
  }
}

/** The part a channel reads (null for a plain net / hole). */
function sourceComponent(s: LogicSource): string | null {
  if (s.kind === 'net') {
    const m = /^([^:]+):/.exec(s.ref)
    return m ? m[1] : null
  }
  return s.componentId
}

/**
 * Axis label for absolute simulation time `t`. The unit follows the
 * MAGNITUDE of the window (s past one second, else ms / µs) and the
 * decimals follow the tick step, so labels stay short at every zoom:
 * "3.5205 s", "412.5 ms", "86.81 µs".
 */
function fmtTick(t: number, step: number, windowEnd: number): string {
  const [scale, unit] = windowEnd >= 1 ? [1, 's'] : windowEnd >= 1e-3 ? [1e3, 'ms'] : [1e6, 'µs']
  const decimals = Math.max(0, Math.min(7, -Math.floor(Math.log10(step * scale) + 1e-9)))
  // the scope's axis spacing (H3, UX IS-17): number, thin space, unit
  return `${(t * scale).toFixed(decimals)}${TICK_SPACE}${unit}`
}

/**
 * Lane caption: a UART's line settings ("115200 Bd"), from the decoder
 * options or — auto baud — from "auto: 115200 Bd (measured 115207 Bd)".
 */
function laneCaption(run: DecoderRun | undefined, classic = true): string {
  const baud = run?.config.decoder === 'uart' ? run.config.options?.baud : undefined
  // product chrome: the one baud format (H3 fmtBaud, UX QA IS-F17) — 「115 200 Bd」 like the chip and the footer
  if (baud !== undefined && baud !== 'auto' && Number(baud) > 0) return classic ? `${baud} Bd` : fmtBaud(Number(baud))
  const s = run?.info[0]
  if (!s) return ''
  const bd = /^auto: ((\d+) Bd)/.exec(s)
  return bd ? (classic ? bd[1] : fmtBaud(Number(bd[2]))) : s.startsWith('auto-baud') ? t('baud ?') : ''
}


/** the last automatic-fit toast (channel:span) — said once per session and choice */
let lastFitToast = ''

/** How far back a channel's recent recording is read (s, QA clarity LA-FIT — 3 periods of a 1 Hz blink fit). */
const RECENT_LOOKBACK_S = 5

/** Edges with a time in [t0, t1] (times ascending; two binary searches). */
function edgesBetween(times: ArrayLike<number>, t0: number, t1: number): number {
  const lower = (x: number) => {
    let lo = 0
    let hi = times.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (times[m] < x) lo = m + 1
      else hi = m
    }
    return lo
  }
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (times[m] <= t1) lo = m + 1
    else hi = m
  }
  return Math.max(0, lo - lower(t0))
}

/** A marker interval: "501.0 ms", "−391.0 ns" (B before A). */
function fmtDelta(dt: number): string {
  const s = fmtSi(Math.abs(dt), 's')
  return dt < 0 && s !== '—' ? `−${s}` : s
}

/** Pulse widths for the measurement column: "501 ms", "8.68–86.8 µs" (min–max), "—". */
function fmtWidths(p: PulseStats | null | undefined): string {
  return !p || p.count === 0 ? '—' : fmtTimeRange(p.min, p.max)
}

/** What the hairline's level letter means (QA clarity LA-MEAS-NAMES): 1 / 0 / X / ·. */
function levelTitle(level: string): string {
  if (level === '1') return t('High|la-level')
  if (level === '0') return t('Low|la-level')
  if (level === 'X') return t('Undefined level (floating or two drivers fighting)')
  return t('Not recorded yet')
}

/** A width RANGE says what its two ends are (QA clarity LA-MEAS-NAMES): 「最短–最長」. */
function rangeTitle(p: PulseStats | null | undefined): string | undefined {
  return p && p.count > 0 && p.max > p.min * 1.001 ? t('shortest–longest') : undefined
}

type ExportKind = 'vcd' | 'csv-edges' | 'csv-ann'
type Pop = { kind: 'trigger' } | { kind: 'decoder'; id: string } | { kind: 'channel'; index: number } | { kind: 'more' } | null

/** Below this width the analyzer's export moves into a ⋯ menu (UX IS-20). */
const COMPACT_TOOLBAR_PX = 640
/** Bins of the activity band over the whole recording (UX IS-20). */
const BAND_BINS = 240
const BAND_H = 10

/** A swing smaller than this (V) is noise, not a signal the thresholds hide. */
const THRESHOLD_HINT_SWING = 0.3

/**
 * An analog net whose swing never crosses one of the analyzer's thresholds
 * (UX IS-16): 「訊號 0–1.75 V，未達高電位門檻 2.0 V」. null when the trace
 * is exact, unknown, flat or crosses both.
 */
function thresholdHint(tr: { exact: boolean; vmin?: number; vmax?: number; vil?: number; vih?: number } | undefined): string | null {
  if (!tr || tr.exact || tr.vmin === undefined || tr.vmax === undefined) return null
  const vil = tr.vil ?? 0.8
  const vih = tr.vih ?? 2.0
  if (!(tr.vmax - tr.vmin > THRESHOLD_HINT_SWING)) return null
  const lo = fmtVoltage(tr.vmin)
  const hi = fmtVoltage(tr.vmax)
  // one unit for the range when both read in volts: 「0–1.75 V」
  const range = / V$/.test(lo) && / V$/.test(hi) && !/ mV$/.test(lo) ? `${lo.slice(0, -2)}–${hi}` : `${lo}–${hi}`
  if (tr.vmax < vih) return t('Signal {range}, never reaches the {vih} high threshold', { range, vih: fmtVoltage(vih) })
  if (tr.vmin > vil) return t('Signal {range}, never falls below the {vil} low threshold', { range, vil: fmtVoltage(vil) })
  return null
}

/** What a scope probe for a channel's source should measure. */
function probeTargetOf(ch: LogicChannelConfig, n: ChannelName): ProbeTarget | null {
  const s = ch.source
  if (s.kind === 'mcu-pin') return { kind: 'mcu-pin', componentId: s.componentId, pin: s.pin }
  if (s.kind === 'net') return /^[^:]+:/.test(s.ref) ? { kind: 'terminal', ref: s.ref } : { kind: 'hole', ref: s.ref }
  return n.hole ? { kind: 'hole', ref: n.hole } : null
}

/** The 3D spot a channel name points at (its hole and part). */
function sceneSpec(n: ChannelName): { holes: string[]; components: string[] } {
  return { holes: n.hole ? [n.hole] : [], components: n.componentId ? [n.componentId] : [] }
}

/**
 * Show where a channel comes from (UX IS-13): frame its hole and part, mark
 * them (blue 'info' rings where the scene draws them), select the part so
 * the inspector shows it.
 */
function locateChannel(n: ChannelName): void {
  const spec = sceneSpec(n)
  if (spec.holes.length + spec.components.length === 0) return
  focusInScene(spec, problemLevelSupported('info') ? { kind: 'problem', level: 'info' } : { kind: 'guide' })
  if (n.componentId) useStore.getState().select(n.componentId)
}

// ---------------------------------------------------------------------------
// Toolbar (IS-5) — memoised: the analyzer re-renders on every capture poll
// (POLL_MS) for its plot and readouts; the toolbar and its chip popovers only
// when one of their own inputs changes (all primitives, memoised lists and a
// stable actions object). Same markup, same handlers as before.
// ---------------------------------------------------------------------------

/** A decoder's summary chip in the toolbar. */
interface LaDecoderChip {
  /** decoder config id */
  id: string
  /** first channel's colour */
  color: string
  summary: string
  /** a channel the decoder needs is not set */
  missing: boolean
}

/** Everything the toolbar and its popovers do — called with the analyzer's current state. */
interface LaToolbarActions {
  live(on: boolean): void
  zoom(dir: 1 | -1): void
  auto(): void
  showAll(): void
  navigate(dir: 1 | -1): void
  toggleTrigger(): void
  toggleDecoder(id: string): void
  addDecoder(decoder: string): void
  results(on: boolean): void
  addProbes(): void
  pickerOpening(): void
  addSource(key: string): void
  toggleMore(): void
  exportCapture(choice: string): void
  closePop(): void
  trigPrefs(p: LogicTriggerPrefs): void
  arm(): void
  cancelTrigger(): void
  changeDecoder(next: LogicDecoderConfig): void
  removeDecoder(): void
}

/** A stable actions object whose methods call `ref.current`'s (the latest render's closures). */
function useStableActions(ref: { readonly current: LaToolbarActions | null }): LaToolbarActions {
  return useMemo(() => {
    const call =
      <K extends keyof LaToolbarActions>(k: K) =>
      (...args: Parameters<LaToolbarActions[K]>) =>
        (ref.current![k] as (...a: Parameters<LaToolbarActions[K]>) => void)(...args)
    return {
      live: call('live'),
      zoom: call('zoom'),
      auto: call('auto'),
      showAll: call('showAll'),
      navigate: call('navigate'),
      toggleTrigger: call('toggleTrigger'),
      toggleDecoder: call('toggleDecoder'),
      addDecoder: call('addDecoder'),
      results: call('results'),
      addProbes: call('addProbes'),
      pickerOpening: call('pickerOpening'),
      addSource: call('addSource'),
      toggleMore: call('toggleMore'),
      exportCapture: call('exportCapture'),
      closePop: call('closePop'),
      trigPrefs: call('trigPrefs'),
      arm: call('arm'),
      cancelTrigger: call('cancelTrigger'),
      changeDecoder: call('changeDecoder'),
      removeDecoder: call('removeDecoder'),
    }
  }, [ref])
}

/** The previous list while its content is unchanged (decoder chips: a few short strings). */
function useStableList<T>(list: T[]): T[] {
  const ref = useRef<{ key: string; list: T[] } | null>(null)
  const key = JSON.stringify(list)
  if (ref.current?.key !== key) ref.current = { key, list }
  return ref.current.list
}

interface LaToolbarProps {
  toolbarRef: RefObject<HTMLDivElement>
  /** UI language: the labels are translated at render */
  lang: string
  /** the product chrome (not the classic one) */
  product: boolean
  stacked: boolean
  live: boolean
  running: boolean
  zoomLabel: string
  zoomShort: string
  auto: boolean
  results: boolean
  channelCount: number
  simStarted: boolean
  hasDecoders: boolean
  trigTitle: string
  trigStatus: TriggerStatus['status']
  trigLabel: string
  decoderChips: readonly LaDecoderChip[]
  probeCount: number
  groups: SelectGroup[]
  compact: boolean
  exporting: boolean
  exportGroups: SelectGroup[]
  chipRef: (key: string) => (el: HTMLElement | null) => void
  actions: LaToolbarActions
}

const LaToolbar = memo(function LaToolbar(p: LaToolbarProps) {
  const { actions: a, channelCount } = p
  return (
    <div
      ref={p.toolbarRef}
      className={`emb-toolbar lai-toolbar ${p.stacked ? 'is-stacked' : ''}`}
      role="toolbar"
      aria-label={t('Logic analyzer')}
    >
      <span className="lai-tb-group lai-tb-view">
        <ToggleChip pressed={p.live} onChange={a.live} title={t('Follow the simulation clock')}>
          <span className={`emb-live-dot ${p.live && p.running ? 'is-on' : ''}`} aria-hidden="true" />
          {t('Live')}
        </ToggleChip>
        <span className="emb-zoom" role="group" aria-label={t('Zoom')}>
          <IconButton aria-label={t('Zoom out')} onClick={() => a.zoom(1)}>
            <MinusIcon size={16} />
          </IconButton>
          <span className="emb-zoom-val emb-mono lg-tabular" aria-live="polite" title={t('Visible window (time per division)')}>
            <span className="emb-zoom-full">{p.zoomLabel}</span>
            <span className="emb-zoom-short" aria-hidden="true">
              {p.zoomShort}
            </span>
          </span>
          <IconButton aria-label={t('Zoom in')} onClick={() => a.zoom(-1)}>
            <PlusIcon size={16} />
          </IconButton>
        </span>
        <ToggleChip
          pressed={p.auto}
          onChange={a.auto}
          title={
            p.product
              ? t('Auto: show every channel’s signal (at least 2 periods of the slowest one, or the newest decoded frame)')
              : t('Auto: zoom to the signal (4–10 periods, or the newest decoded frame)')
          }
          disabled={channelCount === 0}
        >
          {tc('Auto', 'zoom')}
        </ToggleChip>
        <span className="lai-nav" role="group" aria-label={t('Find the signal')}>
          <IconButton aria-label={t('Show the whole recording')} title={t('Show the whole recording')} onClick={a.showAll} disabled={!p.simStarted || channelCount === 0}>
            <span className="lai-glyph" aria-hidden="true">⤢</span>
          </IconButton>
          <IconButton
            aria-label={p.hasDecoders ? t('Previous decoded frame') : t('Previous edge')}
            title={p.hasDecoders ? t('Previous decoded frame') : t('Previous edge')}
            onClick={() => a.navigate(-1)}
            disabled={!p.simStarted || channelCount === 0}
          >
            <span className="lai-glyph" aria-hidden="true">⏮</span>
          </IconButton>
          <IconButton
            aria-label={p.hasDecoders ? t('Next decoded frame') : t('Next edge')}
            title={p.hasDecoders ? t('Next decoded frame') : t('Next edge')}
            onClick={() => a.navigate(1)}
            disabled={!p.simStarted || channelCount === 0}
          >
            <span className="lai-glyph" aria-hidden="true">⏭</span>
          </IconButton>
        </span>
      </span>
      <span className="lai-tb-group lai-tb-chips">
        {channelCount > 0 && (
          <span ref={p.chipRef('trigger')} className="lai-chip-wrap">
            <ChipButton onClick={a.toggleTrigger} title={p.trigTitle}>
              <span
                className={`lai-dot ${p.trigStatus === 'armed' ? 'is-armed' : p.trigStatus === 'triggered' ? 'is-hit' : ''}`}
                aria-hidden="true"
              />
              <span className="lai-chip-text">{p.trigLabel}</span>
              <span className="lai-caret" aria-hidden="true">▾</span>
            </ChipButton>
          </span>
        )}
        {p.decoderChips.map((d) => (
          <span key={d.id} ref={p.chipRef(`dec:${d.id}`)} className="lai-chip-wrap">
            <ChipButton onClick={() => a.toggleDecoder(d.id)} title={t('Decoder settings')}>
              <span className="lai-tag-dot" style={{ background: d.color }} aria-hidden="true" />
              <span className="lai-chip-text">{d.summary}</span>
              {d.missing && <span className="lai-chip-warn" aria-label={t('needs a channel')}>!</span>}
              <span className="lai-caret" aria-hidden="true">▾</span>
            </ChipButton>
          </span>
        ))}
        {channelCount > 0 && (
          <SelectField
            aria-label={t('Add decoder')}
            className="emb-select-add lai-add-dec"
            value=""
            onChange={a.addDecoder}
            options={[{ value: '', label: t('+ Decoder…') }, ...decoderList().map((d) => ({ value: d.id, label: d.label }))]}
          />
        )}
        {p.hasDecoders && (
          <ToggleChip pressed={p.results} onChange={a.results} title={t('List every decoded frame of the recording')}>
            {t('Decoded results')}
          </ToggleChip>
        )}
      </span>
      <span className="lai-tb-group lai-tb-end">
        {p.probeCount > 0 && (
          <ChipButton onClick={a.addProbes} title={t('Add every placed logic probe')}>
            {t('+ Probes')}
          </ChipButton>
        )}
        <span className="lai-add-wrap" onPointerDownCapture={a.pickerOpening} onFocusCapture={a.pickerOpening}>
          <SelectField
            aria-label={t('Add channel')}
            className="emb-select-add lai-add-ch"
            value=""
            onChange={a.addSource}
            options={[{ value: '', label: t('+ Channel…') }]}
            groups={p.groups}
          />
        </span>
        {p.compact ? (
          // a narrow analyzer keeps its toolbar short: 匯出 in a ⋯ menu (IS-20)
          <span ref={p.chipRef('more')} className="lai-chip-wrap">
            <ChipButton aria-label={t('More analyzer options')} title={t('More analyzer options')} onClick={a.toggleMore}>
              <EllipsisIcon size={15} />
            </ChipButton>
          </span>
        ) : (
          <SelectField
            aria-label={t('Export capture')}
            className="lai-export"
            value=""
            onChange={a.exportCapture}
            options={[{ value: '', label: p.exporting ? t('Exporting…') : t('Export…') }]}
            groups={p.exportGroups}
            disabled={channelCount === 0 || p.exporting}
          />
        )}
      </span>
    </div>
  )
})

interface LaToolbarPopoversProps {
  /** UI language: the labels are translated at render */
  lang: string
  moreAnchor: HTMLElement | null
  moreOpen: boolean
  trigAnchor: HTMLElement | null
  trigOpen: boolean
  /** the decoder whose settings are open */
  decoder: LogicDecoderConfig | undefined
  decoderAnchor: HTMLElement | null
  decoderRun: DecoderRun | undefined
  exportGroups: SelectGroup[]
  channels: LogicChannelConfig[]
  exporting: boolean
  trigPrefs: LogicTriggerPrefs
  trig: TriggerStatus
  actions: LaToolbarActions
}

/** The toolbar chips' popovers: ⋯ (export), trigger settings, decoder settings. */
const LaToolbarPopovers = memo(function LaToolbarPopovers(p: LaToolbarPopoversProps) {
  const { actions: a, channels } = p
  return (
    <>
      <Popover anchor={p.moreAnchor} open={p.moreOpen} onClose={a.closePop} label={t('More analyzer options')} width={260}>
        <div className="lai-menu" role="menu">
          {p.exportGroups.map((g) => (
            <div key={g.label} role="group" aria-label={g.label}>
              <div className="lai-menu-head">{t('Export…')} {g.label}</div>
              {g.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="menuitem"
                  className="lai-menu-item"
                  disabled={o.disabled || channels.length === 0 || p.exporting}
                  onClick={() => {
                    a.closePop()
                    a.exportCapture(o.value)
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </Popover>

      <Popover anchor={p.trigAnchor} open={p.trigOpen} onClose={a.closePop} label={t('Trigger settings')} width={560}>
        <TriggerPanel prefs={p.trigPrefs} channels={channels} state={p.trig} onPrefs={a.trigPrefs} onArm={a.arm} onCancel={a.cancelTrigger} />
      </Popover>
      <Popover anchor={p.decoderAnchor} open={!!p.decoder} onClose={a.closePop} label={t('Decoder settings')} width={460}>
        {p.decoder && (
          <DecoderEditor cfg={p.decoder} channels={channels} run={p.decoderRun} onChange={a.changeDecoder} onRemove={a.removeDecoder} />
        )}
      </Popover>
    </>
  )
})

/**
 * Product chrome (QA clarity LA-MEAS-NAMES): the hovered channel's timing in
 * the lessons' and the scope's words — 頻率 · 週期 · 工作週期 ⓘ · 高電位時間 ·
 * 低電位時間 · 邊緣數 — every value named, a range titled 「最短–最長」, and a
 * reading taken over the recent recording labelled 「頻率（最近 100 ms）」.
 */
function FootReadout({ cell, m, recentSpan, edgesText }: { cell: TimingCell; m: EdgeMeasurements; recentSpan: number | null; edgesText: string }) {
  const recent = recentSpan !== null ? fmtSpan(recentSpan) : null
  const label =
    cell.kind === 'burst' ? (
      <InstrumentTerm id="burst">{cell.label}</InstrumentTerm>
    ) : cell.kind === 'line' ? (
      <InstrumentTerm id="baud">{cell.label}</InstrumentTerm>
    ) : (
      cell.label
    )
  return (
    <>
      <span
        className="lai-foot-cell"
        title={[cell.title, recent ? t('Measured over the last {span} of the recording: the window holds less than one period', { span: recent }) : ''].filter(Boolean).join(' · ') || undefined}
      >
        <span className="lai-foot-k">
          {label}
          {recent && <span className="lai-foot-recent">{t('(last {span})', { span: recent })}</span>}
        </span>
        {cell.value}
      </span>
      {cell.periodic && m.period !== null && (
        <span className="lai-foot-cell">
          <span className="lai-foot-k">
            <InstrumentTerm id="period">{tc('T', 'meas')}</InstrumentTerm>
          </span>
          {fmtSi(m.period, 's')}
        </span>
      )}
      {cell.periodic && (
        <span className="lai-foot-cell">
          <span className="lai-foot-k">
            <DutyTerm />
          </span>
          {dutyText(m, cell)}
        </span>
      )}
      {m.high && (
        <span className="lai-foot-cell" title={rangeTitle(m.high)}>
          <span className="lai-foot-k">{tc('high', 'meas')}</span>
          {fmtTimeRange(m.high.min, m.high.max)}
        </span>
      )}
      {m.low && (
        <span className="lai-foot-cell" title={rangeTitle(m.low)}>
          <span className="lai-foot-k">{tc('low', 'meas')}</span>
          {fmtTimeRange(m.low.min, m.low.max)}
        </span>
      )}
      <span className="lai-foot-cell">
        <span className="lai-foot-k">
          <InstrumentTerm id="edges">{tc('edges', 'meas')}</InstrumentTerm>
        </span>
        {edgesText}
      </span>
    </>
  )
}

export function LogicAnalyzer({ active = true }: { active?: boolean }) {
  const layout = useStore((s) => s.layout)
  const components = layout.components
  const running = useStore((s) => s.running)
  const simStarted = useStore((s) => s.simTime > 0)
  const channels = useLab((s) => s.logicChannels)
  const setLogicChannels = useLab((s) => s.setLogicChannels)
  const queryLogic = useLab((s) => s.queryLogic)
  const setLogicView = useLab((s) => s.setLogicView)
  const rawDecoders = useLab((s) => s.logicView.decoders)
  const rawTrigger = useLab((s) => s.logicView.trigger)
  const labCursor = useLab((s) => s.labCursor.t)
  const setLabCursor = useLab((s) => s.setLabCursor)
  const language = useLang()
  // the classic chrome keeps its formats (axis ticks, baud spelling — UX QA IS-F17)
  const classic = useLegacyChrome()
  const lv = useLaView()
  const view = { span: lv.span, end: lv.end }
  const markers = lv.markers

  const [error, setError] = useState<string | null>(null)
  /** hairline position in plot px (the time under it follows zoom/pan) */
  const [cursorX, setCursorX] = useState<number | null>(null)
  /** channel of the row under the pointer (measurement readout) */
  const [hoverCh, setHoverCh] = useState<number | null>(null)
  /** the pointer is over the time-axis band (its tooltip explains the anchor + offsets) */
  const [overAxis, setOverAxis] = useState(false)
  const captureRef = useRef<LogicCapture | null>(null)
  /** simulation time when the current capture was taken (draw limit) */
  const capturedAtRef = useRef(0)
  const [captureRev, setCaptureRev] = useState(0)

  // ---- decoders + trigger: the lab store is the single source of truth (IS-3) ----
  const decoderCfgs = useMemo(() => sanitizeDecoderConfigs(rawDecoders), [rawDecoders])
  const trigPrefs = useMemo(() => sanitizeTrigger(rawTrigger), [rawTrigger])
  const trigPrefsRef = useRef(trigPrefs)
  trigPrefsRef.current = trigPrefs
  const setDecoderCfgs = useCallback(
    (next: LogicDecoderConfig[]) => setLogicView({ decoders: next as unknown as Record<string, unknown>[] }),
    [setLogicView],
  )
  const setTrigPrefs = (p: LogicTriggerPrefs) => setLogicView({ trigger: { ...p } as unknown as Record<string, unknown> })
  const [trig, setTrig] = useState<TriggerStatus>({ status: 'off' })
  const [pop, setPop] = useState<Pop>(null)
  const chipRefs = useRef(new Map<string, HTMLElement>())
  const labelRefs = useRef(new Map<number, HTMLElement>())
  const labelRef = (index: number) => (el: HTMLElement | null) => {
    if (el) labelRefs.current.set(index, el)
    else labelRefs.current.delete(index)
  }
  // one ref callback per chip key, kept for the component's life: the memoised
  // toolbar gets the same function every render (no detach / re-attach churn)
  const chipRefFns = useRef(new Map<string, (el: HTMLElement | null) => void>())
  const chipRef = useCallback((key: string) => {
    let fn = chipRefFns.current.get(key)
    if (!fn) {
      fn = (el: HTMLElement | null) => {
        if (el) chipRefs.current.set(key, el)
        else chipRefs.current.delete(key)
      }
      chipRefFns.current.set(key, fn)
    }
    return fn
  }, [])
  // a probe action pointed at a channel the analyzer already has (the probe
  // menu's 「在邏輯分析儀中顯示」, a duplicate add): bring its row into view and
  // flash it — a fresh request only (opening the tab a minute later does not flash)
  const flashSeq = useLogicFlash((s) => s.seq)
  const [flashing, setFlashing] = useState<number | null>(null)
  useEffect(() => {
    const { index, at } = useLogicFlash.getState()
    if (!flashSeq || index === null || Date.now() - at > 2000) return
    setFlashing(index)
    const raf = window.requestAnimationFrame(() => labelRefs.current.get(index)?.scrollIntoView({ block: 'nearest' }))
    const id = window.setTimeout(() => setFlashing(null), 1600)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(id)
    }
  }, [flashSeq])

  // ---- channel picker (IS-7): rebuilt when the menu is about to open ----
  const [pickerRev, setPickerRev] = useState(0)
  const groups = useMemo<SelectGroup[]>(
    () =>
      channelPickerGroups({
        layout,
        telemetry: useStore.getState().telemetry,
        mcus: useLab.getState().mcus,
        channels,
        tr: t,
        modeLabel: pinModeLabel,
      }),
    // language: captions follow the UI language; pickerRev: live pin modes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, channels, language, pickerRev],
  )
  const probes = useMemo(
    () => components.filter((c) => c.type === 'logic_probe').map((c) => ({ id: c.id, ch: String(c.params?.channel ?? 'D0') })),
    [components],
  )

  const addSource = useCallback(
    (key: string) => {
      if (!key) return
      const parts = key.split('|')
      if (parts[0] === 'bus' && parts.length === 3) {
        addBusFor(parts[1], parts[2])
        return
      }
      if (parts[0] === 'mcu' && parts.length === 3) {
        addLogicChannelFor({ kind: 'mcu-pin', componentId: parts[1], pin: parts[2] })
        return
      }
      if (parts[0] === 'net' && parts.length === 2) {
        addLogicChannelFor({ kind: 'hole', ref: parts[1] })
        return
      }
      if (parts[0] === 'probe' && parts.length === 2) {
        const p = probes.find((x) => x.id === parts[1])
        if (!p) return
        const used = new Set(channels.map((c) => c.index))
        const d = /^D(\d+)$/.exec(p.ch)
        const preferred = d ? Number(d[1]) : -1
        let index = preferred >= 0 && preferred < 16 && !used.has(preferred) ? preferred : -1
        for (let i = 0; index < 0 && i < 16; i++) if (!used.has(i)) index = i
        if (index < 0) {
          showToast(t('All 16 logic analyzer channels are in use — remove one first'), { duration: 3600 })
          return
        }
        const source: LogicSource = { kind: 'probe', componentId: p.id }
        setLogicChannels([...channels, { index, label: p.ch, source }].sort((a, b) => a.index - b.index))
      }
    },
    [channels, probes, setLogicChannels],
  )

  const removeChannel = (index: number) => setLogicChannels(channels.filter((c) => c.index !== index))
  // what each channel is called and where it sits (IS-13; the persisted label stays language-neutral)
  const names = useMemo(
    () => new Map(channels.map((c) => [c.index, channelDisplayName(layout, c)] as const)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, channels, language],
  )
  /** the channels' short names for the decode results (「PA9 TX」 — QA clarity DECODE-SUMMARY) */
  const lineNames = useMemo(() => new Map([...names].map(([i, n]) => [i, n.name] as const)), [names])
  /** the channels as the toolbar summaries name them (trigger chip, decoder chips) */
  const shownChannels = useMemo(() => displayLabels(layout, channels), [layout, channels, language])
  const renameChannel = (index: number, label: string) => {
    const v = label.trim()
    // unchanged: keep the language-neutral default (its display name is computed)
    if (!v || v === names.get(index)?.name) return
    setLogicChannels(channels.map((c) => (c.index === index ? { ...c, label: v } : c)))
  }
  const [renaming, setRenaming] = useState<string | null>(null)
  const missingProbes = probes.filter((p) => !channels.some((c) => sourceKey(c.source) === `probe|${p.id}`))

  // ---- pull loop: query the visible window (+ decoder look-back) ----
  const hasDecoders = decoderCfgs.length > 0
  useEffect(() => {
    if (!active || channels.length === 0) return
    let alive = true
    let inflight = false
    let lastKey = ''
    let lastSim = -1
    const poll = () => {
      if (inflight) return
      const v = useLaView.getState()
      const st = useStore.getState()
      const end = v.end ?? st.simTime
      const t1 = Math.max(end, v.span)
      const t0 = t1 - v.span
      const q0 = hasDecoders ? Math.max(0, t0 - Math.max(v.span, DECODE_LOOKBACK)) : t0
      const key = `${q0}:${t1}:${channels.length}`
      // re-query while new edges can still land inside the window: Live
      // follows the clock, a frozen window ahead of the clock fills up
      const growing = st.running && (v.end === null || t1 > lastSim)
      if (key === lastKey && !growing) return
      lastKey = key
      const simAt = st.simTime
      inflight = true
      queryLogic(q0, t1)
        .then((cap) => {
          if (!alive) return
          captureRef.current = cap
          capturedAtRef.current = simAt
          lastSim = simAt
          setError(null)
          setCaptureRev((r) => r + 1)
        })
        .catch((err: unknown) => {
          if (!alive) return
          captureRef.current = null
          setError(err instanceof Error ? err.message : String(err))
          setCaptureRev((r) => r + 1)
        })
        .finally(() => {
          inflight = false
        })
    }
    poll()
    const id = window.setInterval(poll, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [active, channels, queryLogic, lv.span, lv.end, hasDecoders])

  // ---- auto-fit (IS-1): the busiest channel's period, or the newest frame ----
  const channelsKey = channels.map((c) => `${c.index}:${sourceKey(c.source)}`).join(',')
  const decodersKey = JSON.stringify(decoderCfgs)
  const decoderCfgsRef = useRef(decoderCfgs)
  decoderCfgsRef.current = decoderCfgs
  const classicRef = useRef(classic)
  classicRef.current = classic
  const namesRef = useRef(names)
  namesRef.current = names
  /**
   * Say what an automatic fit chose when it was a choice (QA clarity LA-FIT):
   * the slowest of several periodic channels — 「已自動調整：顯示 PA0 的 2 個週期
   * （最慢的通道）」 — once per (channel, span); a fastest channel too dense to
   * read in that window opens 各通道量測 (unless the user set it this session).
   */
  const announceFit = (r: Extract<LogicFit, { kind: 'period' }>, changed: boolean) => {
    const v = useLaView.getState()
    let opened = false
    if (r.measCol && !v.measCol && !v.measColByUser) {
      setLaView({ measCol: true })
      opened = true
    }
    if (!r.slowest || (!changed && !opened)) return
    const key = `${r.channel}:${r.span}`
    if (lastFitToast === key) return
    lastFitToast = key
    // the channel's own short label (「PA0」), as the toolbar chips name it
    const name = useLab.getState().logicChannels.find((c) => c.index === r.channel)?.label ?? namesRef.current.get(r.channel)?.name ?? `D${r.channel}`
    const what = t('Adjusted automatically: {n} periods of {name} (the slowest channel)', { n: r.periods ?? 2, name })
    showToast(opened ? t('{what} — the faster channels are measured in “Every channel”', { what }) : what, { duration: 4200 })
  }
  useEffect(() => {
    if (!active || !lv.auto || channels.length === 0) return
    let alive = true
    let busy = false
    let settled = false // a period fit is final until the inputs change
    // release polish NO-SIGNAL: the captures the fit looked at, and the simulation time up to
    // which the recorder was found quiet (「沒有訊號變化」 is only said of a quiet recorder)
    let looked: LogicCapture[] = []
    let quietTo = -1
    const fit = async () => {
      if (busy || settled) return
      busy = true
      try {
        const now = useStore.getState().simTime
        let result: LogicFit = { kind: 'none' }
        looked = []
        if (now > 0) {
          const cfgs = decoderCfgsRef.current
          // the last 2 s first (busy signals), then 20 s, then everything (a boot-time bus);
          // a channel with too few edges to judge yet may be the slow one: look further back
          // once before settling on the faster ones (QA clarity LA-FIT)
          let best: LogicFit = { kind: 'none' }
          for (const w of [2, 20, Infinity]) {
            const t0 = Math.max(0, now - w)
            const cap = await queryLogic(t0, now)
            if (!alive) return
            looked.push(cap)
            const runs = cfgs.map((c) => runDecoder(cap, c)).filter((r): r is DecoderRun => r !== null)
            const frames = decodedFrames(runs).filter((f) => t0 === 0 || f.t0 >= t0 + DECODE_LOOKBACK)
            result = fitLogicSpan(cap, frames, { t0, t1: now, slowest: !classicRef.current })
            if (result.kind !== 'none') best = result
            const undecided = result.kind === 'period' && !!result.undecided && !classicRef.current
            if ((result.kind !== 'none' && !undecided) || t0 === 0 || w === 20) break
          }
          result = best
          // quiet for the last 20 s: 「沒有訊號變化」 may only be said when the WHOLE recording is quiet
          if (result.kind === 'none' && !classicRef.current && now > 20 && firstRecordedChange(looked) === null) {
            const all = await queryLogic(0, now)
            if (!alive) return
            looked.push(all)
          }
        }
        if (!alive) return
        const cur = useLaView.getState()
        if (!cur.auto) return
        if (result.kind === 'none' && !classicRef.current) {
          const fb = autoFitFallback(looked, now)
          if (now <= 0) {
            // nothing simulated yet (「還沒有資料」 says so): no claim about the recording either
            if (cur.autoEmpty) setLaView({ autoEmpty: false })
          } else if (fb.kind === 'recording') {
            // a few changes, no period yet (blink's first second): show them, never 「沒有訊號變化」
            quietTo = -1
            if (cur.span !== fb.span || cur.end !== null || cur.autoEmpty) setLaView({ span: fb.span, end: null, autoEmpty: false })
          } else {
            quietTo = now
            if (!cur.autoEmpty) setLaView({ autoEmpty: true })
          }
          return
        }
        if (result.kind === 'period') {
          // final once a whole rising-to-rising period was seen; a span from a
          // single edge-to-edge interval is re-checked while the run goes on
          settled = result.complete
          const changed = cur.span !== result.span || cur.end !== null || cur.autoEmpty
          if (changed) setLaView({ span: result.span, end: null, autoEmpty: false })
          if (!classicRef.current) announceFit(result, changed)
        } else if (result.kind === 'frame') {
          if (cur.span !== result.span || cur.end !== result.end || cur.autoEmpty) {
            setLaView({ span: result.span, end: result.end, autoEmpty: false })
          }
        } else if (!cur.autoEmpty) {
          setLaView({ autoEmpty: true })
        }
      } catch {
        // host gone / failed query: the next tick retries
      } finally {
        busy = false
      }
    }
    void fit()
    const id = window.setInterval(() => {
      if (useStore.getState().running) void fit()
    }, FIT_MS)
    // while the overlay says 「沒有訊號變化」 the recorder is re-checked often (only what was
    // recorded since it was last found quiet): the first change withdraws the claim at once
    let checking = false
    const quiet = window.setInterval(() => {
      const now = useStore.getState().simTime
      if (checking || busy || quietTo < 0 || now <= quietTo || !useStore.getState().running || !useLaView.getState().autoEmpty) return
      checking = true
      queryLogic(quietTo, now)
        .then((cap) => {
          if (!alive) return
          if (firstRecordedChange([cap]) === null) quietTo = now
          else {
            quietTo = -1
            setLaView({ autoEmpty: false })
            void fit()
          }
        })
        .catch(() => {})
        .finally(() => {
          checking = false
        })
    }, EMPTY_RECHECK_MS)
    return () => {
      alive = false
      window.clearInterval(id)
      window.clearInterval(quiet)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lv.auto, lv.fitSeq, channelsKey, decodersKey, queryLogic])
  // a power cycle restarts the clock: fit again on the new run's edges
  useEffect(
    () =>
      useStore.subscribe((s, p) => {
        if (s.simTime < p.simTime && useLaView.getState().auto) requestLaFit()
      }),
    [],
  )

  // ---- trigger search: the recorder's edges from the arm instant on ----
  const armedAt = trig.status === 'armed' ? trig.armedAt : null
  useEffect(() => {
    if (!active || armedAt === null) return
    let alive = true
    let inflight = false
    let from = armedAt
    const poll = () => {
      if (inflight) return
      const now = useStore.getState().simTime
      if (now < from) from = 0 // power cycle: time restarted
      if (now <= from) return
      inflight = true
      queryLogic(from, now)
        .then((cap) => {
          if (!alive) return
          const p = trigPrefsRef.current
          const spec: LogicTriggerSpec =
            p.kind === 'edge' ? { kind: 'edge', channel: p.channel, slope: p.slope } : { kind: 'pattern', pattern: p.pattern }
          const at = findLogicTrigger(cap, spec, from)
          if (at === null) {
            from = Math.max(from, cap.t1)
            return
          }
          alive = false
          setTrig({ status: 'triggered', at })
          const span = useLaView.getState().span
          manualLaView({ span, end: at + (1 - p.pre) * span })
        })
        .catch(() => {
          // host gone / failed query: keep waiting (the next poll retries)
        })
        .finally(() => {
          inflight = false
        })
    }
    poll()
    const id = window.setInterval(poll, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [active, armedAt, queryLogic])

  const arm = () => setTrig({ status: 'armed', armedAt: useStore.getState().simTime })

  // ---- decoders over the capture ----
  const runs: DecoderRun[] = useMemo(() => {
    const cap = captureRef.current
    if (!cap) return []
    const out: DecoderRun[] = []
    for (const cfg of decoderCfgs) {
      const r = runDecoder(cap, cfg)
      if (r) out.push(r)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureRev, decoderCfgs])
  /** an annotation lane of an I²C decoder (its letters get a legend) */
  const i2cLane = (annId: string): boolean =>
    // the lane with the letters (S / Sr / A / N / P) — not the transfers lane under it
    runs.some((r) => r.decoder.id === 'i2c' && r.rows.some((x) => x.id === annId && annId.endsWith(':frames')))
  const runOf = (cfg: LogicDecoderConfig) => runs.find((r) => (r.config.id ?? r.config.decoder) === (cfg.id ?? cfg.decoder))
  /** every configured decoder for the results summary (a UART line with no rows still counts: 「PA10 RX 0 行」) */
  const resultsDecoders = useMemo(
    () =>
      decoderCfgs.map((cfg) => ({
        instance: cfg.id ?? cfg.decoder,
        decoder: decoderList().find((d) => d.id === cfg.decoder)?.label ?? cfg.decoder,
        channel: Number(cfg.channels.data ?? Object.values(cfg.channels)[0] ?? 0),
      })),
    [decoderCfgs],
  )

  // ---- decoded results of the recording (IS-6): on open, then ≤ 1 Hz while running ----
  const [results, setResults] = useState<{ frames: DecodedFrame[]; capped: boolean; busy: boolean }>({
    frames: [],
    capped: false,
    busy: false,
  })
  const [picked, setPicked] = useState<string | null>(null)
  /** the picked frame for ⏮ / ⏭ — read at click time, so two quick clicks never use a stale render */
  const pickedRef = useRef<string | null>(null)
  pickedRef.current = picked
  const netlist = useMemo((): Netlist | null => {
    try {
      return buildNetlist(layout)
    } catch {
      return null
    }
  }, [layout])

  // ---- the USARTs' RX pins on the analyzer (close-out UART-RX): the terminal's typed bytes are
  // real frames on that wire (its USB-TTL adapter drives it) — a quiet RX lane says how to get some ----
  /** "U1|USART1" → the RX pin (remap-aware, from the MCU frame) and the analyzer channels recording its net */
  const rxChannels = useMemo(() => {
    const out = new Map<string, { pin: string; channels: number[] }>()
    if (classic || !netlist) return out
    const config = boardConfigOf(layout)
    // the remap rarely changes: read at layout / channel changes, never subscribed (no per-frame work)
    const mcus = useLab.getState().mcus
    for (const comp of layout.components) {
      const entry = getEntry(comp.type)
      if (!entry?.mcu) continue
      const holes = componentPinHoles(comp, entry, config)
      for (const port of Object.keys(USART_RX)) {
        const pin = rxPinOf(port, mcus[comp.id]?.uartRx)
        const i = pin ? entry.pins.indexOf(pin) : -1
        const h = i >= 0 ? holes?.[i] : null
        const net = h ? netlist.netOf(formatHole(h)) : null
        if (!pin || !net) continue
        const chs = channels
          .filter((c) => {
            const ref = logicSourceEndpoint(c.source, layout)
            return !!ref && netlist.netOf(ref) === net
          })
          .map((c) => c.index)
        if (chs.length > 0) out.set(`${comp.id}|${port}`, { pin, channels: chs })
      }
    }
    return out
  }, [classic, netlist, layout, channels])
  const allFrames = results.frames
  const framesRef = useRef<DecodedFrame[]>([])
  framesRef.current = allFrames
  const refreshFrames = useCallback(async (): Promise<DecodedFrame[]> => {
    const cfgs = decoderCfgsRef.current
    const now = useStore.getState().simTime
    setResults((r) => ({ ...r, busy: true }))
    try {
      const c = await collectFrames(queryLogic, cfgs, now)
      setResults({ frames: c.frames, capped: c.capped, busy: false })
      return c.frames
    } catch {
      setResults((r) => ({ ...r, busy: false }))
      return framesRef.current
    }
  }, [queryLogic])
  const resultsOpen = lv.results && hasDecoders
  useEffect(() => {
    if (!active || !resultsOpen) return
    void refreshFrames()
    const id = window.setInterval(() => {
      if (useStore.getState().running) void refreshFrames()
    }, 1000)
    return () => window.clearInterval(id)
  }, [active, resultsOpen, decodersKey, refreshFrames])

  // ---- row layout (traces + their decoder lanes), rows grow with the free height ----
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollH, setScrollH] = useState(0)
  const [rootW, setRootW] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setRootW(Math.floor(el.getBoundingClientRect().width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // toolbar: one row when everything fits; otherwise the view controls and
  // export / ＋通道 share the first row and the trigger / decoder chips get
  // the second — never a third row holding just two buttons (UX IS-5)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [stacked, setStacked] = useState(false)
  useLayoutEffect(() => {
    const el = toolbarRef.current
    if (!el) return
    const groups = [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains('lai-tb-group'))
    /** a group's one-line width: its items side by side (items never shrink) */
    const natural = (g: HTMLElement) => {
      let w = 0
      let n = 0
      for (const c of g.children) {
        const cw = c.getBoundingClientRect().width
        if (cw > 0) {
          w += cw
          n++
        }
      }
      return w + Math.max(0, n - 1) * TB_ITEM_GAP
    }
    const measure = () => {
      const [a = 0, b = 0, c = 0] = groups.map(natural)
      const W = el.clientWidth
      const next = b > 0 && a + b + c + 2 * TB_GROUP_GAP > W && a + c + TB_GROUP_GAP <= W
      setStacked((s) => (s === next ? s : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const g of groups) ro.observe(g)
    return () => ro.disconnect()
  }, [])

  const hasChannels = channels.length > 0
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setScrollH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasChannels, resultsOpen])
  // a wrapped toolbar in a short tray: ask for room once (never below 120 px of waveform)
  useEffect(() => {
    if (active && hasChannels && scrollH > 0 && scrollH < PLOT_MIN) giveLogicPlotRoom(PLOT_MIN - scrollH)
  }, [active, hasChannels, scrollH])

  const rows = useMemo(() => {
    let lanes = 0
    for (const ch of channels) for (const run of runs) for (const a of run.rows) if (a.channel === ch.index) lanes++
    const free = scrollH - AXIS_H - 4 - lanes * ANN_H
    const rowH = Math.max(ROW_MIN, Math.min(ROW_MAX, Math.floor(free / Math.max(1, channels.length))))
    const out: {
      kind: 'trace' | 'ann'
      channel: LogicChannelConfig
      ann?: LogicAnnotationRow
      caption?: string
      y: number
      h: number
    }[] = []
    let y = AXIS_H
    for (const ch of channels) {
      out.push({ kind: 'trace', channel: ch, y, h: rowH })
      y += rowH
      for (const run of runs) {
        run.rows.forEach((a, k) => {
          if (a.channel !== ch.index) return
          out.push({ kind: 'ann', channel: ch, ann: a, caption: k === 0 ? laneCaption(run, classic) : '', y, h: ANN_H })
          y += ANN_H
        })
      }
    }
    return { rows: out, height: y + 4 }
  }, [channels, runs, scrollH, classic])
  // the analysis layout with the traces leaving the plot mostly empty: the measurements (and the
  // decoded results) open beside it by themselves — the user's own toggles win (QA clarity ANALYSIS-LAYOUT-SPACE)
  const analysis = useLab((s) => !classic && isAnalysisArrangement(s.workspace))
  const rowsHeight = rows.height
  useEffect(() => {
    if (!active || !analysis || !hasChannels) return
    const p = analysisAutoOpen(useLaView.getState(), scrollH, rowsHeight, hasDecoders)
    if (Object.keys(p).length > 0) setLaView(p)
  }, [active, analysis, hasChannels, scrollH, rowsHeight, hasDecoders])

  // ---- canvas ----
  const plotRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  /** the plot's left edge inside the analyzer (the activity band lines up with it) */
  const [plotLeft, setPlotLeft] = useState(0)
  useEffect(() => {
    // the plot only exists while channels are configured
    const el = plotRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setWidth(Math.floor(r.width))
      const b = rootRef.current?.getBoundingClientRect()
      if (b) setPlotLeft(Math.round(r.left - b.left))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasChannels, resultsOpen])

  // ---- activity band (UX IS-20): where the edges of the whole recording are ----
  const bandRef = useRef<HTMLCanvasElement>(null)
  const [density, setDensity] = useState<{ counts: number[]; t1: number } | null>(null)
  useEffect(() => {
    if (!active || channels.length === 0) return
    let alive = true
    let inflight = false
    let last: { t1: number; total: number } | null = null
    let at = 0
    const refresh = () => {
      if (inflight) return
      const st = useStore.getState()
      const now = st.simTime
      if (!(now > 0)) {
        if (last) setDensity(null)
        last = null
        return
      }
      // the whole recording at most every 3 s while it runs (a heavy one every 10 s); once when paused
      if (last && (st.running ? performance.now() - at < (last.total > 200_000 ? 10_000 : 3000) : last.t1 >= now)) return
      inflight = true
      at = performance.now()
      queryLogic(0, now)
        .then((c) => {
          if (!alive) return
          const counts = new Array<number>(BAND_BINS).fill(0)
          let total = 0
          for (const tr of c.traces) {
            for (let i = 0; i < tr.times.length; i++) {
              counts[Math.min(BAND_BINS - 1, Math.max(0, Math.floor((tr.times[i] / now) * BAND_BINS)))]++
              total++
            }
          }
          last = { t1: now, total }
          setDensity({ counts, t1: now })
        })
        .catch(() => {})
        .finally(() => {
          inflight = false
        })
    }
    refresh()
    const id = window.setInterval(refresh, 1000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, channelsKey, queryLogic])

  const windowOf = (v: { span: number; end: number | null }, cap: LogicCapture | null) => {
    const end = v.end ?? (cap ? cap.t1 : Math.max(useStore.getState().simTime, v.span))
    return { t0: end - v.span, t1: end }
  }

  const win = windowOf(view, captureRef.current)
  const cursor = cursorX !== null && width > 0 ? win.t0 + (cursorX / width) * (win.t1 - win.t0) : null
  const trigAt = trig.status === 'triggered' ? trig.at : null
  /** last simulated instant inside the window (traces end there) */
  const tLimit = Math.min(win.t1, captureRef.current ? Math.max(capturedAtRef.current, captureRef.current.t0) : win.t1)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const H = Math.max(rows.height, scrollH)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(H * dpr)
    canvas.style.height = `${H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0a0c10'
    ctx.fillRect(0, 0, width, H)

    const cap = captureRef.current
    const { t0, t1 } = windowOf(view, cap)
    const xOf = (t: number) => ((t - t0) / (t1 - t0)) * width
    const xLimit = Math.min(width, xOf(tLimit))

    // grid: 10 divisions (classic: labels on every division, or every 2nd when narrow)
    const hasData = !!cap && useStore.getState().simTime > 0
    const step = (t1 - t0) / DIVS
    const every = width / DIVS >= 70 ? 1 : 2
    ctx.font = "10.5px 'SF Mono', ui-monospace, Menlo, Consolas, monospace"
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    // product chrome: never under a marker flag (A / B / T are drawn on the axis band) — UX QA IS-F17
    const flagXs = classic
      ? []
      : [markers.a, markers.b, trigAt].filter((x): x is number => x !== null && x >= t0 && x <= t1).map((x) => Math.round(xOf(x)) + 0.5)
    // product chrome (QA clarity LA-AXIS): an absolute anchor, then offsets at a stride whose labels never touch
    const productLabels = !classic && hasData ? laAxisLabels(t0, step, width, (s) => ctx.measureText(s).width, flagXs) : null
    for (let k = 0; k <= DIVS; k++) {
      const t = t0 + k * step
      const x = Math.round(xOf(t)) + 0.5
      ctx.strokeStyle = k % 5 === 0 ? '#232935' : '#1a1f27'
      ctx.beginPath()
      ctx.moveTo(x, AXIS_H)
      ctx.lineTo(x, H)
      ctx.stroke()
      ctx.strokeStyle = '#3a414d'
      ctx.beginPath()
      ctx.moveTo(x, AXIS_H - 5)
      ctx.lineTo(x, AXIS_H)
      ctx.stroke()
      // no recording yet (a new circuit, a reset): no clock to label — 「—」, never an old time (IS-15)
      if (!productLabels && k % every === 0 && k < DIVS && (hasData || k === 0)) {
        const label = !hasData ? '—' : fmtTick(t, step, t1)
        const lw = ctx.measureText(label).width
        // a label a flag would cover (its 12 px box + a 2 px gap) is left out
        if (flagXs.some((fx) => fx + 8 > x + 3 && fx - 8 < x + 3 + lw)) continue
        ctx.fillStyle = '#8e97a5'
        ctx.fillText(label, x + 3, AXIS_H / 2)
      }
    }
    if (productLabels) {
      for (const l of productLabels) {
        // the anchor (absolute time) a shade brighter than the offsets after it
        ctx.fillStyle = l === productLabels[0] ? '#b4bcc8' : '#8e97a5'
        ctx.fillText(l.text, l.x + 3, AXIS_H / 2)
      }
      // the labels' boxes, for the e2e overlap check (never read by the app)
      canvas.dataset.axis = productLabels.map((l) => `${Math.round(l.x + 3)}:${Math.round(l.w)}:${l.text}`).join('|')
    } else if (canvas.dataset.axis) delete canvas.dataset.axis
    ctx.strokeStyle = '#2a303b'
    ctx.beginPath()
    ctx.moveTo(0, AXIS_H + 0.5)
    ctx.lineTo(width, AXIS_H + 0.5)
    ctx.stroke()

    // traces
    for (const row of rows.rows) {
      if (row.kind !== 'trace') continue
      const color = CHANNEL_COLORS[row.channel.index % CHANNEL_COLORS.length]
      const pad = Math.max(6, Math.round(row.h * 0.22))
      const yHi = row.y + pad
      const yLo = row.y + row.h - pad
      // row separator
      ctx.strokeStyle = '#151920'
      ctx.beginPath()
      ctx.moveTo(0, row.y + row.h + 0.5)
      ctx.lineTo(width, row.y + row.h + 0.5)
      ctx.stroke()
      const tr = cap?.traces.find((x) => x.index === row.channel.index)
      if (!tr) continue
      const yOfLevel = (l: number) => (l === 1 ? yHi : yLo)
      // undefined (floating / contention) spans: hatched band
      const drawUndef = (xa: number, xb: number) => {
        if (xb <= xa) return
        ctx.fillStyle = 'rgba(160, 168, 184, 0.16)'
        ctx.fillRect(xa, yHi, xb - xa, yLo - yHi)
        ctx.strokeStyle = 'rgba(160, 168, 184, 0.35)'
        ctx.beginPath()
        for (let x = xa - (yLo - yHi); x < xb; x += 6) {
          ctx.moveTo(Math.max(xa, x), yLo - Math.max(0, xa - x))
          ctx.lineTo(Math.min(xb, x + (yLo - yHi)), yHi + Math.max(0, x + (yLo - yHi) - xb))
        }
        ctx.stroke()
      }
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.lineJoin = 'miter'
      let level: number = tr.initial
      let x = 0
      let busyCol = -1
      ctx.beginPath()
      // edges before the window only set the starting level
      let i = 0
      while (i < tr.times.length && tr.times[i] < t0) level = tr.levels[i++]
      if (level !== 2) ctx.moveTo(0, yOfLevel(level))
      for (; i < tr.times.length; i++) {
        const t = tr.times[i]
        if (t > t1) break
        const xe = xOf(t)
        const next = tr.levels[i]
        const col = Math.floor(xe)
        if (col === busyCol) {
          // several edges inside one pixel column: draw the column as "busy"
          // and park the pen on the new level, so the next segment starts
          // level instead of slanting from the column's far end
          ctx.moveTo(col + 0.5, yHi)
          ctx.lineTo(col + 0.5, yLo)
          if (next !== 2) ctx.moveTo(xe, yOfLevel(next))
          level = next
          x = xe
          continue
        }
        busyCol = col
        if (level === 2) {
          ctx.stroke()
          drawUndef(x, xe)
          ctx.strokeStyle = color
          ctx.beginPath()
        } else {
          ctx.lineTo(xe, yOfLevel(level))
        }
        if (next !== 2) {
          if (level !== 2) ctx.lineTo(xe, yOfLevel(next))
          else ctx.moveTo(xe, yOfLevel(next))
        }
        level = next
        x = xe
      }
      // the level holds up to the last simulated instant, not beyond
      if (level === 2) {
        ctx.stroke()
        drawUndef(x, Math.max(x, xLimit))
      } else {
        ctx.lineTo(Math.max(x, xLimit), yOfLevel(level))
        ctx.stroke()
      }
      ctx.lineWidth = 1
    }

    // decoder lanes (a UART lane zoomed out too far to label its bytes shows whole lines)
    for (const row of rows.rows) {
      if (row.kind !== 'ann' || !row.ann) continue
      const fine = row.ann.items
      const unit = fine.length > 0 ? fine[0].t1 - fine[0].t0 : 0
      const items = row.ann.coarse && (unit / (t1 - t0)) * width < COARSE_BELOW_PX ? row.ann.coarse : fine
      drawAnnotationLane(ctx, items, row.y, row.h, width, t0, t1)
    }

    // shared cursor, trigger, markers, hairline
    const vline = (t: number, color: string, flag?: string, dashed = false) => {
      if (t < t0 || t > t1) return
      const x = Math.round(xOf(t)) + 0.5
      ctx.strokeStyle = color
      ctx.setLineDash(dashed ? [4, 3] : [])
      ctx.beginPath()
      ctx.moveTo(x, AXIS_H)
      ctx.lineTo(x, H)
      ctx.stroke()
      ctx.setLineDash([])
      if (flag) {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(x - 6, 2)
        ctx.lineTo(x + 6, 2)
        ctx.lineTo(x + 6, AXIS_H - 6)
        ctx.lineTo(x, AXIS_H - 1)
        ctx.lineTo(x - 6, AXIS_H - 6)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#0a0c10'
        ctx.textAlign = 'center'
        ctx.font = "bold 10px 'SF Mono', ui-monospace, Menlo, Consolas, monospace"
        ctx.fillText(flag, x, 9)
        ctx.font = "10px 'SF Mono', ui-monospace, Menlo, Consolas, monospace"
        ctx.textAlign = 'left'
      }
    }
    if (labCursor !== null && labCursor !== markers.a) vline(labCursor, 'rgba(191, 90, 242, 0.9)', undefined, true)
    if (trigAt !== null) vline(trigAt, 'rgba(255, 159, 10, 0.95)', 'T', true)
    if (markers.a !== null) vline(markers.a, 'rgba(100, 181, 255, 0.95)', 'A')
    if (markers.b !== null) vline(markers.b, 'rgba(94, 224, 200, 0.95)', 'B')
    if (cursor !== null) vline(cursor, 'rgba(255, 255, 255, 0.55)')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, rows, captureRev, cursor, markers, lv.span, lv.end, trigAt, tLimit, scrollH, labCursor, classic, language])

  // the band: edge density of the whole recording (log scale) + where the window is
  useEffect(() => {
    const canvas = bandRef.current
    if (!canvas || width <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(BAND_H * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, BAND_H)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
    ctx.fillRect(0, 0, width, BAND_H)
    if (!density) return
    const max = Math.max(1, ...density.counts)
    const bw = width / density.counts.length
    for (let k = 0; k < density.counts.length; k++) {
      const n = density.counts[k]
      if (n === 0) continue
      const a = 0.25 + 0.75 * (Math.log1p(n) / Math.log1p(max))
      ctx.fillStyle = `rgba(100, 181, 255, ${a.toFixed(3)})`
      ctx.fillRect(Math.floor(k * bw), 1, Math.max(1, Math.ceil(bw)), BAND_H - 2)
    }
    // the visible window
    const { t0, t1 } = windowOf(view, captureRef.current)
    const xa = Math.max(0, (t0 / density.t1) * width)
    const xb = Math.min(width, (t1 / density.t1) * width)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(xa) + 0.5, 0.5, Math.max(2, Math.round(xb - xa) - 1), BAND_H - 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density, width, lv.span, lv.end, captureRev])

  // ---- pointer: cursor / pan / markers / wheel zoom ----
  const dragRef = useRef<{ x: number; end: number; moved: boolean; id: number } | null>(null)
  const timeAt = (clientX: number) => {
    const el = plotRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const { t0, t1 } = windowOf(useLaView.getState(), captureRef.current)
    return t0 + ((clientX - r.left) / r.width) * (t1 - t0)
  }
  const rowAt = (clientY: number) => {
    const r = plotRef.current?.getBoundingClientRect()
    if (!r) return null
    const y = clientY - r.top
    return rows.rows.find((rw) => y >= rw.y && y < rw.y + rw.h) ?? null
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { t1 } = windowOf(useLaView.getState(), captureRef.current)
    dragRef.current = { x: e.clientX, end: t1, moved: false, id: e.pointerId }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (d && d.id === e.pointerId) {
      const dx = e.clientX - d.x
      if (Math.abs(dx) > 3) d.moved = true
      if (d.moved && width > 0) {
        const span = useLaView.getState().span
        manualLaView({ span, end: d.end - (dx / width) * span })
      }
    }
    const r = plotRef.current?.getBoundingClientRect()
    if (r) {
      setCursorX(e.clientX - r.left)
      const row = rowAt(e.clientY)
      if (row) setHoverCh(row.channel.index)
      const axis = e.clientY - r.top < AXIS_H
      if (axis !== overAxis) setOverAxis(axis)
    }
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d || d.moved) return
    const raw = timeAt(e.clientX)
    if (raw === null) return
    const row = rowAt(e.clientY)
    // markers snap to the nearest edge within 12 px (20 px by touch; Alt: place exactly where clicked)
    const t = e.altKey ? raw : snapToEdge(raw, row?.channel.index ?? null, e.pointerType === 'touch' ? SNAP_PX_TOUCH : SNAP_PX)
    freezeForMarker()
    const { markers: m, armed } = useLaView.getState()
    let next: typeof m
    // a footer A / B button chose the marker; otherwise A, then B, then the nearer one
    if (armed === 'a') next = { a: t, b: m.b }
    else if (armed === 'b') next = { a: m.a, b: t }
    else if (m.a === null) next = { a: t, b: m.b }
    else if (m.b === null) next = { a: m.a, b: t }
    // both placed: move the nearer one
    else next = Math.abs(t - m.a) <= Math.abs(t - m.b) ? { a: t, b: m.b } : { a: m.a, b: t }
    setLaView({ markers: next, markerUsed: true, armed: null, ...(row ? { focusCh: row.channel.index } : {}) })
    if (next.a !== m.a) setLabCursor(next.a)
  }
  /**
   * The edge nearest to time t within `px` pixels — of channel `index` first,
   * else of any channel — else t itself.
   */
  const snapToEdge = (t: number, index: number | null, px = SNAP_PX): number => {
    const cap = captureRef.current
    if (!cap || width <= 0) return t
    const { t0, t1 } = windowOf(useLaView.getState(), cap)
    const tol = (px / width) * (t1 - t0)
    const nearest = (only: number | null): number | null => {
      let best: number | null = null
      let bestD = tol
      for (const tr of cap.traces) {
        if (only !== null && tr.index !== only) continue
        for (let i = 0; i < tr.times.length; i++) {
          const d = Math.abs(tr.times[i] - t)
          if (d <= bestD) {
            best = tr.times[i]
            bestD = d
          }
        }
      }
      return best
    }
    return (index !== null ? nearest(index) : null) ?? nearest(null) ?? t
  }
  /**
   * A marker is being placed: a following window (Live / Auto) would carry
   * it away — stop following, say how to resume (UX IS-15).
   */
  const freezeForMarker = () => {
    const v = useLaView.getState()
    if (!v.auto && v.end !== null) return
    manualLaView({ span: v.span, end: windowOf(v, captureRef.current).t1 })
    showToast(t('Stopped following — press “Auto” or “Live” to resume'), { duration: 3200 })
  }
  const placeMarker = (which: 'a' | 'b', t: number) => {
    freezeForMarker()
    const m = useLaView.getState().markers
    setLaView({ markers: which === 'a' ? { a: t, b: m.b } : { a: m.a, b: t }, markerUsed: true, armed: null })
    if (which === 'a') setLabCursor(t)
  }
  // keyboard on the focused plot (UX IS-9): ←/→ pan, +/− zoom, [ ] (or , .) previous / next,
  // a / b marker at the hairline (else the window centre), Esc clears the markers
  const onPlotKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const v = useLaView.getState()
    const { t0, t1 } = windowOf(v, captureRef.current)
    const at = cursor ?? (t0 + t1) / 2
    const key = e.key
    let handled = true
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const f = (e.shiftKey ? 0.5 : 0.1) * (key === 'ArrowLeft' ? -1 : 1)
      manualLaView({ span: v.span, end: t1 + f * v.span })
    } else if (key === '+' || key === '=') zoom(-1, at)
    else if (key === '-' || key === '_') zoom(1, at)
    else if (key === '[' || key === ',') void navigate(-1)
    else if (key === ']' || key === '.') void navigate(1)
    else if (key === 'a' || key === 'A') placeMarker('a', snapToEdge(at, v.focusCh))
    else if (key === 'b' || key === 'B') placeMarker('b', snapToEdge(at, v.focusCh))
    else if (key === 'Escape' && (v.markers.a !== null || v.markers.b !== null || v.armed !== null)) {
      if (labCursor !== null && labCursor === v.markers.a) setLabCursor(null)
      setLaView({ markers: { a: null, b: null }, armed: null })
    } else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  const zoom = (dir: 1 | -1, anchorT?: number) => {
    const v = useLaView.getState()
    const span = stepSpan(v.span, dir)
    if (span === v.span) return
    if (anchorT === undefined) {
      // no anchor (toolbar buttons off-plot): keep the right edge (and Live)
      manualLaView({ span, end: v.end })
      return
    }
    // keep the anchor time under the pointer (this leaves Live mode)
    const { t0, t1 } = windowOf(v, captureRef.current)
    const frac = (anchorT - t0) / (t1 - t0)
    manualLaView({ span, end: anchorT + (1 - frac) * span })
  }
  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const v = useLaView.getState()
        const { t1 } = windowOf(v, captureRef.current)
        const d = (e.shiftKey ? e.deltaY : e.deltaX) / Math.max(1, el.clientWidth)
        manualLaView({ span: v.span, end: t1 + d * v.span })
        return
      }
      zoom(e.deltaY > 0 ? 1 : -1, timeAt(e.clientX) ?? undefined)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, hasChannels])

  // ---- find the signal (IS-6): whole recording, previous / next frame or edge ----
  const showAll = () => {
    const now = useStore.getState().simTime
    if (!(now > 0)) return
    tick()
    manualLaView({ span: now, end: now })
  }
  const centreOn = (t0: number, t1: number, opts: { zoomTo?: boolean; marker?: number } = {}) => {
    const v = useLaView.getState()
    const span = opts.zoomTo ? spanAtLeast(Math.max((t1 - t0) * 1.5, 2e-6)) : v.span
    const p: Parameters<typeof setLaView>[0] = { auto: false, autoEmpty: false, span, end: (t0 + t1) / 2 + span / 2 }
    if (opts.marker !== undefined) {
      p.markers = { a: opts.marker, b: null }
      p.markerUsed = true
      setLabCursor(opts.marker)
    }
    setLaView(p)
  }
  const [navBusy, setNavBusy] = useState(false)
  /** the plot has KEYBOARD focus: the footer lists its keys */
  const [keyHelp, setKeyHelp] = useState(false)
  const navigate = async (dir: 1 | -1) => {
    if (navBusy) return
    const v = useLaView.getState()
    const { t0, t1 } = windowOf(v, captureRef.current)
    const now = useStore.getState().simTime
    // the window shows the whole recording (⤢): ⏭ starts at its beginning, ⏮ at its end (IS-15)
    // (the simulation runs on after ⤢ — often faster than real time — so the
    // window counts as the whole recording while it starts at 0 and spans most of it)
    const whole = t0 <= 1e-9 && t1 - t0 >= 0.5 * now
    const mid = whole ? (dir === 1 ? 0 : now) : (t0 + t1) / 2
    setNavBusy(true)
    try {
      if (hasDecoders) {
        const frames = framesRef.current.length > 0 && !running ? framesRef.current : await refreshFrames()
        // from the frame the user is on (the picked one, else marker A), never the
        // window centre (UX QA IS-F3, la-frames.ts stepFrame)
        const f = stepFrame(frames, dir, { picked: pickedRef.current, markerA: v.markers.a, mid, whole })
        if (!f) {
          showToast(dir === 1 ? t('No later decoded frame') : t('No earlier decoded frame'))
          return
        }
        pickedRef.current = f.id
        setPicked(f.id)
        centreOn(f.t0, f.t1, { zoomTo: true, marker: f.t0 })
        return
      }
      const ch = channels.find((c) => c.index === v.focusCh) ?? measureCh
      if (!ch) return
      const e = await findEdge(queryLogic, ch.index, mid, dir, now)
      if (e === null) {
        showToast(
          dir === 1 ? t('{label}: no later edge', { label: ch.label }) : t('{label}: no earlier edge', { label: ch.label }),
        )
        return
      }
      centreOn(e, e)
    } finally {
      setNavBusy(false)
    }
  }

  const levelAt = (index: number, t: number): string => {
    const tr = captureRef.current?.traces.find((x) => x.index === index)
    if (!tr) return '·'
    if (t > tLimit) return '·'
    let l: number = tr.initial
    for (let i = 0; i < tr.times.length && tr.times[i] <= t; i++) l = tr.levels[i]
    return l === 2 ? 'X' : String(l)
  }

  // ---- measurement readout: markers / cursor / hovered channel ----
  const cap = captureRef.current
  const measureCh = channels.find((c) => c.index === hoverCh) ?? channels.find((c) => c.index === lv.focusCh) ?? channels[0]
  const region = useMemo((): { t0: number; t1: number; label: string } => {
    const { a, b } = markers
    if (a !== null && b !== null) return { t0: Math.min(a, b), t1: Math.max(a, b), label: 'A↔B' }
    if (a !== null && cursor !== null) return { t0: Math.min(a, cursor), t1: Math.max(a, cursor), label: 'A↔t' }
    return { t0: win.t0, t1: Math.min(win.t1, tLimit), label: 'window' }
  }, [markers, cursor, win.t0, win.t1, tLimit])
  // the serial line of each channel (UX IS-11): a UART pin / UART decoder reads
  // 「115 200 Bd · 8N1（由 USART1 設定）」, never a frequency
  const lines = useMemo(() => {
    const out = new Map<number, SerialLine | null>()
    const ctx = {
      layout,
      telemetry: useStore.getState().telemetry,
      mcus: useLab.getState().mcus,
      netlist,
      netOf: (c: LogicChannelConfig) => {
        const ref = logicSourceEndpoint(c.source, layout)
        return ref && netlist ? netlist.netOf(ref) : null
      },
    }
    for (const c of channels) out.set(c.index, serialLineOfChannel(c, ctx, decoderCfgs, runs))
    return out
    // captureRev: the firmware's pin modes / USART settings arrive with the run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, netlist, channels, decoderCfgs, runs, captureRev])
  // ---- a channel whose window holds no complete period: its recent recording (QA clarity LA-FIT) ----
  /** channels with too few edges in the window to judge a period (≤ 3 edges: fewer than two of either polarity) */
  const needRecentKey = useMemo(() => {
    if (classic || !cap) return ''
    const t1w = Math.min(win.t1, tLimit)
    const out: number[] = []
    // a serial line's figure is its baud rate (the firmware's / the decoder's), never a recent period
    for (const tr of cap.traces) if (!lines.get(tr.index) && edgesBetween(tr.times, win.t0, t1w) <= 3) out.push(tr.index)
    return out.join(',')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureRev, win.t0, win.t1, tLimit, classic, lines])
  const [recent, setRecent] = useState<ReadonlyMap<number, { m: EdgeMeasurements; span: number }>>(() => new Map())
  useEffect(() => {
    if (!active || needRecentKey === '') {
      setRecent((r) => (r.size === 0 ? r : new Map()))
      return
    }
    const want = needRecentKey.split(',').map(Number)
    let alive = true
    let inflight = false
    let readAt = -1
    const read = () => {
      const st = useStore.getState()
      const now = st.simTime
      // ≤ 2 Hz while running, once when paused
      if (inflight || !(now > 0) || (!st.running && readAt >= now)) return
      inflight = true
      readAt = now
      queryLogic(Math.max(0, now - RECENT_LOOKBACK_S), now)
        .then((c) => {
          if (!alive) return
          const t1 = Math.min(c.t1, c.tNow ?? c.t1)
          const next = new Map<number, { m: EdgeMeasurements; span: number }>()
          for (const i of want) {
            const tr = c.traces.find((x) => x.index === i)
            if (!tr) continue
            // never before the channel's binding, nor before the oldest edge a wrapped ring still holds
            const from = Math.max(c.t0, tr.since ?? c.t0, c.overflow && tr.times.length > 0 ? tr.times[0] : c.t0)
            const r = recentEdgeMeasurements(tr, from, t1)
            if (r) next.set(i, r)
          }
          setRecent(next)
        })
        .catch(() => {})
        .finally(() => {
          inflight = false
        })
    }
    read()
    const id = window.setInterval(read, 500)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [active, needRecentKey, queryLogic])

  /**
   * whole-window measurement under the markers when A–B holds no complete period (UX IS-15);
   * product chrome (QA clarity LA-FIT): a window that holds none either reads the channel's
   * recent recording (`recentSpan`, 「（最近 100 ms）」) — never 「—」 for a pin that is periodic
   */
  const [meas, shortAB, recentSpan] = useMemo((): [EdgeMeasurements | null, boolean, number | null] => {
    const tr = measureCh ? cap?.traces.find((x) => x.index === measureCh.index) : undefined
    if (!tr) return [null, false, null]
    const m = measureEdges(tr, region.t0, region.t1)
    if (m.periodicity !== 'unknown') return [m, false, null]
    const whole = region.label === 'window' ? m : measureEdges(tr, win.t0, Math.min(win.t1, tLimit))
    if (whole.periodicity !== 'unknown') return [whole, true, null]
    const r = classic ? undefined : recent.get(measureCh!.index)
    return r ? [r.m, false, r.span] : [m, false, null]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureRev, measureCh, region, recent, classic])
  /** a marker sits exactly on a recorded edge (it snapped, or a decoded frame put it there) */
  const onEdge = useMemo(() => {
    const at = (time: number | null): boolean => {
      if (time === null || !cap) return false
      const eps = 1e-12 + Math.abs(time) * 1e-12
      for (const tr of cap.traces) {
        // times are ascending: binary search for the first edge ≥ time − eps
        let lo = 0
        let hi = tr.times.length
        while (lo < hi) {
          const m = (lo + hi) >> 1
          if (tr.times[m] < time - eps) lo = m + 1
          else hi = m
        }
        if (lo < tr.times.length && tr.times[lo] <= time + eps) return true
      }
      return false
    }
    return { a: at(markers.a), b: at(markers.b) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureRev, markers])
  /** every channel at once for the measurement column (UX IS-9), over the same region (a channel without a period there: its recent recording, QA clarity LA-FIT) */
  const measAll = useMemo(() => {
    const out = new Map<number, EdgeMeasurements>()
    const spans = new Map<number, number>()
    if (!lv.measCol || !cap) return { m: out, recent: spans }
    for (const tr of cap.traces) {
      const m = measureEdges(tr, region.t0, region.t1)
      const r = !classic && m.periodicity === 'unknown' ? recent.get(tr.index) : undefined
      out.set(tr.index, r ? r.m : m)
      if (r) spans.set(tr.index, r.span)
    }
    return { m: out, recent: spans }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureRev, region, lv.measCol, recent, classic])
  const cellOf = (index: number, m: EdgeMeasurements | null | undefined) =>
    timingCell(m ?? null, lines.get(index) ?? null, isDataChannel(index, decoderCfgs), view.span / DIVS / 10, !classic && isClockChannel(index, decoderCfgs))
  const delta =
    markers.a !== null && markers.b !== null
      ? markers.b - markers.a
      : markers.a !== null && cursor !== null
        ? cursor - markers.a
        : null
  /** the capture holds the whole visible window (else a fetch for it is still pending) */
  const capCovers = !!cap && cap.t0 <= win.t0 + 1e-9 + 1e-6 * view.span && cap.t1 >= Math.min(win.t1, tLimit) - 1e-6 * view.span - 1e-9
  // the board these channels depend on, and what blocks it (IS-14, helper H5)
  const blockerBoard = useMemo(
    () => boardFor(layout, channels.map((c) => (c.source.kind === 'mcu-pin' ? c.source.componentId : null))),
    [layout, channels],
  )
  const blocker = useInstrumentBlocker(blockerBoard)
  /** any edge drawn in the visible window */
  const windowEdges = useMemo(() => {
    if (!cap) return 0
    let n = 0
    for (const tr of cap.traces) for (let i = 0; i < tr.times.length; i++) if (tr.times[i] >= win.t0 && tr.times[i] <= win.t1) n++
    return n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureRev, win.t0, win.t1])
  /**
   * The recorder's ring wrapped and the visible window ends before the
   * channel's oldest kept edge (UX QA IS-F12): its level there is unknown
   * because the edges were OVERWRITTEN — never 「邊緣數 0」 / 「沒有訊號變化」.
   */
  const overwritten = (index: number): boolean => overwrittenBefore(cap, index, win.t1)
  const allOverwritten = !!cap?.overflow && windowEdges === 0 && channels.length > 0 && channels.every((c) => overwritten(c.index))
  /**
   * An RX pin's channel without an edge in the window, of a USART the
   * firmware enabled, whose net the terminal's adapter is free to drive and
   * has not been plugged into yet (close-out UART-RX): 「PA10 上還沒有訊框——
   * 在 UART 終端機送出文字，USB 轉 TTL 轉接器就會把它以 UART 訊框送上這條導線」
   * — the next step, not a fault. null = no note (a module or another output
   * drives the net: its own frames show here; an idle plugged-in adapter is
   * simply high).
   */
  const rxQuietNote = (index: number): string | null => {
    if (classic || !cap) return null
    const tr = cap.traces.find((x) => x.index === index)
    if (tr && edgesBetween(tr.times, win.t0, win.t1) > 0) return null
    for (const [key, rx] of rxChannels) {
      if (!rx.channels.includes(index)) continue
      const [id, port] = key.split('|')
      const m = useLab.getState().mcus[id]
      if (!m?.uarts.some((u) => u.name === port && u.config.enabled)) continue
      const wire = m.uartRx?.find((u) => u.port === port)
      if (wire && (wire.state !== 'free' || wire.attached)) continue
      return t('No frames on {pin} yet — send text from the UART terminal: its USB-TTL adapter puts it on this wire as UART frames', { pin: rx.pin })
    }
    return null
  }

  // ---- export ----
  const [exporting, setExporting] = useState(false)
  const doExport = async (choice: string) => {
    const [kind, scope] = choice.split(':') as [ExportKind, 'view' | 'all']
    if (!kind || exporting) return
    const st = useStore.getState()
    const { t0, t1 } = scope === 'all' ? { t0: 0, t1: st.simTime } : { t0: win.t0, t1: Math.min(win.t1, Math.max(tLimit, win.t0)) }
    if (!(t1 > t0)) return
    setExporting(true)
    try {
      if (kind === 'csv-ann') {
        // decoders see a look-back before the window; spans outside are dropped
        const q0 = scope === 'all' ? 0 : Math.max(0, t0 - Math.max(t1 - t0, DECODE_LOOKBACK))
        const full = await queryLogic(q0, t1)
        const groupsCsv = decoderCfgs
          .map((cfg) => runDecoder(full, cfg))
          .filter((r): r is DecoderRun => r !== null)
          .map((r) => {
            const names = Object.entries(r.config.channels)
              .map(([, ch]) => channels.find((c) => c.index === ch)?.label ?? `D${ch}`)
              .join('/')
            return {
              decoder: `${r.decoder.label} ${names}`,
              rowLabels: r.rowLabels,
              annotations: r.annotations.filter((a) => a.t1 >= t0 && a.t0 <= t1),
            }
          })
        downloadText(exportName('ohmlet-decoded', t0, t1, 'csv'), annotationsCsv(groupsCsv), 'text/csv')
        return
      }
      const capture = await queryLogic(t0, t1)
      if (kind === 'vcd') {
        downloadText(
          exportName('ohmlet-logic', t0, t1, 'vcd'),
          toVcd(capture, { date: new Date().toUTCString() }),
          'text/x-vcd',
        )
      } else {
        downloadText(exportName('ohmlet-logic-edges', t0, t1, 'csv'), logicEdgesCsv(capture), 'text/csv')
      }
    } finally {
      setExporting(false)
    }
  }

  const live = view.end === null
  /**
   * time readouts (H3 fmtSimTimeAt): a tenth of a division for the hairline and
   * a free marker (「2.704 391 0 s」 at 1 µs/格 — A and B 391 ns apart never read
   * alike); a marker ON an edge is exact, so it shows the microsecond
   */
  const timeRes = view.span / DIVS / 10
  const markerRes = (k: 'a' | 'b') => (onEdge[k] ? Math.min(1e-6, timeRes) : timeRes)
  const xFuture = width > 0 && tLimit < win.t1 ? Math.max(0, ((tLimit - win.t0) / (win.t1 - win.t0)) * width) : null

  const noDecoders = decoderCfgs.length === 0
  const exportGroups = useMemo<SelectGroup[]>(
    () => [
      {
        label: t('Visible window'),
        options: [
          { value: 'vcd:view', label: t('VCD — logic levels') },
          { value: 'csv-edges:view', label: t('CSV — edges') },
          { value: 'csv-ann:view', label: t('CSV — decoded'), disabled: noDecoders },
        ],
      },
      {
        label: t('Everything recorded'),
        options: [
          { value: 'vcd:all', label: t('VCD — logic levels') },
          { value: 'csv-edges:all', label: t('CSV — edges') },
          { value: 'csv-ann:all', label: t('CSV — decoded'), disabled: noDecoders },
        ],
      },
    ],
    // language: the labels follow the UI language
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noDecoders, language],
  )

  // ---- toolbar summaries (IS-5) ----
  const trigCond = triggerCondition(trigPrefs, shownChannels)
  // the settings summary: the condition, plus the pre-trigger share when it is
  // not the default 10 % (the chip's title always names it)
  const preShare = Math.round(trigPrefs.pre * 100)
  const trigSettings = trigCond
    ? trigPrefs.pre === TRIGGER_DEFAULTS.pre
      ? t('Trigger · {cond}', { cond: trigCond })
      : t('Trigger · {cond} · {pre} % before', { cond: trigCond, pre: preShare })
    : null
  const trigLabel =
    trig.status === 'armed'
      ? t('Waiting for trigger: {cond}', { cond: trigCond ?? '—' })
      : trig.status === 'triggered'
        ? t('Triggered · {time}', { time: fmtSimTimeAt(trig.at, view.span / DIVS) })
        : trigSettings ?? t('Trigger')
  const popCfg = pop?.kind === 'decoder' ? decoderCfgs.find((c) => (c.id ?? c.decoder) === pop.id) : undefined
  // decode results: beside the plot from 760 px, a 280 px pane OVER the plot's
  // right side below that — never stacked under the plot, where it pushed the
  // footer out of a short tray (UX IS-15, E2-06)
  const sideResults = rootW >= 760
  const zoomLabel = t('{span} ({div}/div)', { span: fmtSpan(view.span), div: fmtSpan(view.span / DIVS) })
  // phones show the window length only (the per-division part is in the title)
  const zoomShort = fmtSpan(view.span)

  // ---- the toolbar as memoised children: the 10 Hz capture poll re-renders the
  // plot, never the toolbar's ~20 controls while their inputs stay the same ----
  const decoderChips = useStableList(
    decoderCfgs.map((cfg): LaDecoderChip => {
      const run = runOf(cfg)
      const first = Object.values(cfg.channels)[0]
      return {
        id: cfg.id ?? cfg.decoder,
        color: typeof first === 'number' ? CHANNEL_COLORS[first % CHANNEL_COLORS.length] : 'var(--label-3)',
        summary: decoderSummary(cfg, shownChannels, t, measuredBaudOf(run?.info), { product: !classic }),
        missing: !!run && run.missing.length > 0,
      }
    }),
  )
  // the toolbar's handlers: one stable object calling this render's closures
  const actionsRef = useRef<LaToolbarActions | null>(null)
  actionsRef.current = {
    live: (on) => manualLaView({ span: view.span, end: on ? null : windowOf(view, captureRef.current).t1 }),
    zoom: (dir) => zoom(dir, cursor ?? undefined),
    auto: () => requestLaFit(),
    showAll: () => showAll(),
    navigate: (dir) => void navigate(dir),
    toggleTrigger: () => setPop(pop?.kind === 'trigger' ? null : { kind: 'trigger' }),
    toggleDecoder: (id) => setPop(pop?.kind === 'decoder' && pop.id === id ? null : { kind: 'decoder', id }),
    addDecoder: (v) => {
      if (!v) return
      const cfg = newDecoderConfig(v, channels, decoderCfgs)
      if (!cfg) return
      setDecoderCfgs([...decoderCfgs, cfg])
      setPop({ kind: 'decoder', id: cfg.id ?? cfg.decoder })
    },
    results: (on) => setLaView({ results: on, resultsByUser: true }),
    addProbes: () => missingProbes.forEach((p) => addSource(`probe|${p.id}`)),
    pickerOpening: () => setPickerRev((r) => r + 1),
    addSource: (key) => addSource(key),
    toggleMore: () => setPop(pop?.kind === 'more' ? null : { kind: 'more' }),
    exportCapture: (choice) => void doExport(choice),
    closePop: () => setPop(null),
    trigPrefs: (p) => setTrigPrefs(p),
    arm: () => arm(),
    cancelTrigger: () => setTrig({ status: 'off' }),
    changeDecoder: (next) => {
      if (!popCfg) return
      setDecoderCfgs(decoderCfgs.map((c) => ((c.id ?? c.decoder) === (popCfg.id ?? popCfg.decoder) ? next : c)))
    },
    removeDecoder: () => {
      setPop(null)
      setDecoderCfgs(decoderCfgs.filter((c) => c !== popCfg))
    },
  }
  const actions = useStableActions(actionsRef)

  return (
    <div
      ref={rootRef}
      className={`emb-view emb-la ${sideResults ? 'is-wide' : rootW > 0 ? 'is-narrow' : ''} ${!classic && rootW >= ROOMY_RESULTS_PX ? 'is-roomy' : ''} ${classic ? '' : 'is-product'}`}
    >
      <LaToolbar
        toolbarRef={toolbarRef}
        lang={language}
        product={!classic}
        stacked={stacked}
        live={live}
        running={running}
        zoomLabel={zoomLabel}
        zoomShort={zoomShort}
        auto={lv.auto}
        results={lv.results}
        channelCount={channels.length}
        simStarted={simStarted}
        hasDecoders={hasDecoders}
        trigTitle={trigCond ? t('Trigger settings: {cond} · {pre} % before', { cond: trigCond, pre: preShare }) : t('Trigger settings')}
        trigStatus={trig.status}
        trigLabel={trigLabel}
        decoderChips={decoderChips}
        probeCount={missingProbes.length}
        groups={groups}
        compact={rootW > 0 && rootW < COMPACT_TOOLBAR_PX}
        exporting={exporting}
        exportGroups={exportGroups}
        chipRef={chipRef}
        actions={actions}
      />
      <LaToolbarPopovers
        lang={language}
        moreAnchor={pop?.kind === 'more' ? chipRefs.current.get('more') ?? null : null}
        moreOpen={pop?.kind === 'more'}
        trigAnchor={pop?.kind === 'trigger' ? chipRefs.current.get('trigger') ?? null : null}
        trigOpen={pop?.kind === 'trigger'}
        decoder={popCfg}
        decoderAnchor={popCfg ? chipRefs.current.get(`dec:${popCfg.id ?? popCfg.decoder}`) ?? null : null}
        decoderRun={popCfg ? runOf(popCfg) : undefined}
        exportGroups={exportGroups}
        channels={channels}
        exporting={exporting}
        trigPrefs={trigPrefs}
        trig={trig}
        actions={actions}
      />

      {(() => {
        const ch = pop?.kind === 'channel' ? channels.find((c) => c.index === pop.index) : undefined
        const nm = ch ? names.get(ch.index) ?? channelDisplayName(layout, ch) : null
        return (
          <Popover
            anchor={ch ? labelRefs.current.get(ch.index) ?? null : null}
            open={!!ch}
            onClose={() => {
              setPop(null)
              setRenaming(null)
            }}
            label={nm ? t('Channel {name}', { name: nm.name }) : t('Channel')}
            width={280}
          >
            {ch && nm && (
              <div className="lai-menu" role="menu">
                <div className="lai-menu-head">{nm.title}</div>
                {renaming !== null ? (
                  <form
                    className="lai-menu-rename"
                    onSubmit={(e) => {
                      e.preventDefault()
                      renameChannel(ch.index, renaming)
                      setRenaming(null)
                      setPop(null)
                    }}
                  >
                    <input
                      className="emb-field"
                      aria-label={t('Channel name')}
                      value={renaming}
                      maxLength={32}
                      onChange={(e) => setRenaming(e.target.value)}
                    />
                    <button type="submit" className="lai-menu-item is-primary">
                      {t('Rename')}
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="lai-menu-item"
                      disabled={!nm.hole && !nm.componentId}
                      onClick={() => {
                        setPop(null)
                        locateChannel(nm)
                      }}
                    >
                      {t('Show on the board')}
                    </button>
                    {nm.componentId && (
                      <button
                        type="button"
                        role="menuitem"
                        className="lai-menu-item"
                        onClick={() => {
                          setPop(null)
                          const mcu = ch.source.kind === 'mcu-pin'
                          focusInspector(nm.componentId!, mcu ? { tab: 'pins', ...(nm.pin ? { pin: nm.pin } : {}) } : {})
                        }}
                      >
                        {t('See this pin in the inspector')}
                      </button>
                    )}
                    <button type="button" role="menuitem" className="lai-menu-item" onClick={() => setRenaming(nm.name)}>
                      {t('Rename…')}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="lai-menu-item is-danger"
                      onClick={() => {
                        setPop(null)
                        removeChannel(ch.index)
                      }}
                    >
                      {t('Remove channel')}
                    </button>
                  </>
                )}
              </div>
            )}
          </Popover>
        )
      })()}

      {channels.length === 0 ? (
        <EmptyNote title={t('No channels')}>
          {t('Add a pin, a bus or a net with “+ Channel…”, or right-click a pin on the board → Add to logic analyzer.')}
        </EmptyNote>
      ) : (
        <>
        {density && width > 0 && (
          <div className="lai-band-row" style={{ paddingLeft: plotLeft }}>
            <canvas
              ref={bandRef}
              className="lai-band"
              style={{ width, height: BAND_H }}
              role="img"
              aria-label={t('Activity of the whole recording — click to zoom there')}
              title={t('Activity of the whole recording — click to zoom there')}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
                const bin = density.t1 / BAND_BINS
                const t = f * density.t1
                tick()
                centreOn(Math.max(0, t - bin / 2), Math.min(density.t1, t + bin / 2), { zoomTo: true })
              }}
            />
          </div>
        )}
        <div className={`lai-body ${resultsOpen ? 'has-results' : ''}`}>
          <div ref={scrollRef} className="emb-la-scroll">
            <div className={`emb-la-grid ${lv.measCol ? 'has-meas' : ''}`} style={{ height: Math.max(rows.height, scrollH) }}>
              <div className="emb-la-labels" style={{ paddingTop: AXIS_H }}>
                {rows.rows.map((row) => {
                  if (row.kind === 'ann') {
                    return (
                      <div key={row.ann!.id} className="emb-la-label is-ann" style={{ height: row.h }}>
                        <span className="emb-la-src">
                          {!classic && i2cLane(row.ann!.id) ? (
                            // the lane's letters S / Sr / P / A / N explained (QA clarity DECODE-SUMMARY)
                            <InstrumentTerm id="i2c-lane" className="lai-ann-name">
                              {tc(row.ann!.label, 'decoder')}
                            </InstrumentTerm>
                          ) : (
                            <span className="lai-ann-name">{tc(row.ann!.label, 'decoder')}</span>
                          )}
                          {row.caption ? ` · ${row.caption}` : ''}
                        </span>
                      </div>
                    )
                  }
                  const ch = row.channel
                  const present = logicSourcePresent(layout, ch)
                  const approx = cap?.traces.find((x) => x.index === ch.index)?.exact === false
                  const nm = names.get(ch.index) ?? channelDisplayName(layout, ch)
                  const full = `${nm.title}${approx ? ` · ${t('Analog net turned into logic levels at the 0.8 / 2.0 V thresholds')}` : ''}`
                  return (
                    <div
                      key={`t${ch.index}`}
                      ref={labelRef(ch.index)}
                      className={`emb-la-label ${present ? '' : 'is-stale'} ${row.h < ROW_TWO_LINES ? 'is-compact' : ''} ${
                        flashing === ch.index ? 'is-flash' : ''
                      }`}
                      style={{ height: row.h }}
                      title={present ? full : t('Source {id} no longer exists', { id: sourceComponent(ch.source) ?? '' })}
                      onContextMenu={(e) => {
                        if (!present) return
                        e.preventDefault()
                        setRenaming(null)
                        setPop({ kind: 'channel', index: ch.index })
                      }}
                    >
                      <span
                        className="emb-la-swatch"
                        style={{ background: CHANNEL_COLORS[ch.index % CHANNEL_COLORS.length] }}
                        aria-hidden="true"
                      />
                      <button
                        type="button"
                        className="emb-la-text lai-label-btn"
                        disabled={!present}
                        aria-label={t('{name}: show it on the board', { name: nm.name })}
                        aria-haspopup="menu"
                        onClick={() => {
                          tick()
                          locateChannel(nm)
                        }}
                        onPointerEnter={() => present && highlightSource(sceneSpec(nm))}
                        onPointerLeave={() => highlightSource(null)}
                        onFocus={() => present && highlightSource(sceneSpec(nm))}
                        onBlur={() => highlightSource(null)}
                        onKeyDown={(e) => {
                          // the keyboard's context menu: Shift+F10 / the menu key
                          if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
                            e.preventDefault()
                            setPop({ kind: 'channel', index: ch.index })
                          }
                        }}
                      >
                        <span className="emb-la-name">
                          {nm.name}
                          {approx && row.h < ROW_TWO_LINES && <span className="lai-approx"> ≈</span>}
                        </span>
                        <span className="emb-la-short emb-mono" aria-hidden="true">
                          {/* the phone row: the channel's name like the desktop (「PA5 LED」, as its trigger and footer say — UX QA IS-F16); classic: the pin */}
                          {!classic ? nm.name : ch.source.kind === 'mcu-pin' ? ch.source.pin : nm.name.split(/\s+/)[0]}
                        </span>
                        {present ? (
                          <span className="emb-la-src">
                            {nm.sub}
                            {approx && ' ≈'}
                          </span>
                        ) : (
                          <span className="emb-la-stale">{t('Source {id} no longer exists', { id: sourceComponent(ch.source) ?? '' })}</span>
                        )}
                      </button>
                      {cursor !== null && present && (
                        <span className="emb-la-level emb-mono" title={classic ? undefined : levelTitle(levelAt(ch.index, cursor))}>
                          {levelAt(ch.index, cursor)}
                        </span>
                      )}
                      <button
                        type="button"
                        className={`emb-la-remove ${present ? '' : 'is-visible'}`}
                        aria-label={t('Remove channel {label}', { label: nm.name })}
                        title={t('Remove channel {label}', { label: nm.name })}
                        onClick={() => removeChannel(ch.index)}
                      >
                        <CloseIcon size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
              <div
                ref={plotRef}
                className="emb-la-plot"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => (dragRef.current = null)}
                onPointerLeave={() => {
                  setCursorX(null)
                  setOverAxis(false)
                }}
                role="img"
                tabIndex={0}
                onKeyDown={onPlotKey}
                aria-keyshortcuts="ArrowLeft ArrowRight + - [ ] A B Escape"
                title={
                  !classic && overAxis
                    ? t('The first tick is the simulation time; the others are the time since it')
                    : t('Click: marker A, then B (snaps to the nearest edge)')
                }
                onFocus={(e) => setKeyHelp(e.currentTarget.matches(':focus-visible'))}
                onBlur={() => setKeyHelp(false)}
                aria-label={t(channels.length === 1 ? 'Logic traces, {n} channel' : 'Logic traces, {n} channels', {
                  n: channels.length,
                })}
              >
                <canvas ref={canvasRef} className="emb-la-canvas" />
                {xFuture !== null && <div className="lai-future" style={{ left: xFuture }} aria-hidden="true" />}
                {flashing !== null &&
                  rows.rows.map((row) =>
                    row.kind === 'trace' && row.channel.index === flashing ? (
                      <div key={`flash${flashing}`} className="lai-row-flash" style={{ top: row.y, height: row.h }} aria-hidden="true" />
                    ) : null,
                  )}
                {rows.rows.map((row) => {
                  if (row.kind !== 'trace') return null
                  const rxNote = rxQuietNote(row.channel.index)
                  if (rxNote) {
                    return (
                      <div key={`rx${row.channel.index}`} className="lai-thr is-rx" style={{ top: row.y, height: row.h }} role="note">
                        <span className="lai-thr-text">{rxNote}</span>
                      </div>
                    )
                  }
                  const hint = thresholdHint(cap?.traces.find((x) => x.index === row.channel.index))
                  if (!hint) return null
                  const nm = names.get(row.channel.index) ?? channelDisplayName(layout, row.channel)
                  const target = probeTargetOf(row.channel, nm)
                  return (
                    <div key={`thr${row.channel.index}`} className="lai-thr" style={{ top: row.y, height: row.h }} role="note">
                      <span className="lai-thr-text">{hint}</span>
                      {target && (
                        <button
                          type="button"
                          className="lai-hint-btn"
                          title={t('Place a scope probe on this net to see its real voltage')}
                          onPointerDown={(e) => e.stopPropagation()}
                          onPointerUp={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            tick()
                            void addScopeProbeFor(target)
                          }}
                        >
                          {t('Use the scope')}
                        </button>
                      )}
                    </div>
                  )
                })}
                {error && (
                  <div className="emb-la-overlay">
                    <EmptyNote title={t('Capture unavailable')}>{tMessage(error)}</EmptyNote>
                  </div>
                )}
                {!error && (!cap || windowEdges === 0) && blocker ? (
                  // the real reason first (IS-14): the board is unpowered / has no firmware / is halted
                  <div className="emb-la-overlay is-soft">
                    <BlockerNote blocker={blocker} what="channels" />
                  </div>
                ) : (
                  !error &&
                  cap &&
                  windowEdges === 0 &&
                  // auto is fitting, or the capture of this window is still on its way: the
                  // previous trace stays, no "press Auto" over a window that has edges (IS-14)
                  !(lv.auto && !lv.autoEmpty) &&
                  capCovers && (
                    <div className="emb-la-overlay is-soft">
                      <span className="lai-hint">
                        {!simStarted ? (
                          t('No data yet — press ▶ Run simulation (Space).')
                        ) : allOverwritten ? (
                          <>
                            {t('The recording of this stretch was overwritten (the buffer keeps only the newest 65 536 edges) — press “Auto” to go back to the newest signal')}
                            <button type="button" className="lai-hint-btn" onClick={() => requestLaFit()}>
                              {tc('Auto', 'zoom')}
                            </button>
                          </>
                        ) : lv.auto && lv.autoEmpty ? (
                          running ? t('No signal changes on these channels yet.') : t('These channels have no signal changes in the recording.')
                        ) : (
                          <>
                            {t('No signal changes in this window. Press “Auto” to zoom to the signal.')}
                            <button type="button" className="lai-hint-btn" onClick={() => requestLaFit()}>
                              {tc('Auto', 'zoom')}
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                  )
                )}
                {cap?.overflow && <span className="emb-la-overflow">{t('buffer wrapped — oldest edges dropped')}</span>}
              </div>
              {lv.measCol && (
                <div
                  className="lai-meas"
                  role="table"
                  aria-label={t('Measurements per channel')}
                  title={t('Measured over {region}', { region: t(region.label) })}
                >
                  <div className="lai-meas-row is-head" role="row" style={{ height: AXIS_H }}>
                    <span role="columnheader">{tc('f', 'meas')}</span>
                    {!classic && (
                      <span role="columnheader">
                        <InstrumentTerm id="period">{tc('T', 'meas')}</InstrumentTerm>
                      </span>
                    )}
                    <span role="columnheader">
                      <DutyTerm />
                    </span>
                    <span role="columnheader">{tc('high', 'meas')}</span>
                    <span role="columnheader">{tc('low', 'meas')}</span>
                    {!classic && (
                      <span role="columnheader">
                        <InstrumentTerm id="edges">{tc('edges', 'meas')}</InstrumentTerm>
                      </span>
                    )}
                  </div>
                  {rows.rows.map((row) => {
                    if (row.kind === 'ann') return <div key={row.ann!.id} className="lai-meas-row is-ann" style={{ height: row.h }} />
                    const m = measAll.m.get(row.channel.index)
                    const cell = cellOf(row.channel.index, m)
                    if (classic) {
                      return (
                        <div key={`m${row.channel.index}`} className="lai-meas-row" role="row" style={{ height: row.h }}>
                          <span role="cell" title={cell.kind === 'freq' ? cell.title || undefined : `${cell.label} ${cell.value}`}>
                            {cell.short}
                          </span>
                          <span role="cell">{dutyText(m ?? null, cell)}</span>
                          <span role="cell">{fmtWidths(m?.high)}</span>
                          <span role="cell">{fmtWidths(m?.low)}</span>
                        </div>
                      )
                    }
                    // a channel without a period in the region reads its recent recording, named (QA clarity LA-FIT)
                    const rs = measAll.recent.get(row.channel.index)
                    const recentNote = rs !== undefined ? t('(last {span})', { span: fmtSpan(rs) }) : null
                    const cellTitle = [cell.kind === 'freq' ? cell.title : `${cell.label} ${cell.value}`, recentNote ? t('Measured over the last {span} of the recording: the window holds less than one period', { span: fmtSpan(rs!) }) : '']
                      .filter(Boolean)
                      .join(' · ')
                    return (
                      <div
                        key={`m${row.channel.index}`}
                        className={`lai-meas-row ${recentNote ? 'is-recent' : ''} ${row.h >= ROW_TWO_LINES ? 'is-tall' : ''}`}
                        role="row"
                        style={{ height: row.h }}
                      >
                        <span role="cell" className="lai-meas-f" title={cellTitle || undefined}>
                          <span>{cell.short}</span>
                          {recentNote && <span className="lai-meas-recent">{recentNote}</span>}
                        </span>
                        <span role="cell">{cell.periodic && m?.period != null ? fmtSi(m.period, 's') : '—'}</span>
                        <span role="cell">{dutyText(m ?? null, cell)}</span>
                        <span role="cell" title={rangeTitle(m?.high)}>
                          {fmtWidths(m?.high)}
                        </span>
                        <span role="cell" title={rangeTitle(m?.low)}>
                          {fmtWidths(m?.low)}
                        </span>
                        <span role="cell">{m ? m.edges : '—'}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          {resultsOpen && (
            <DecodeResults
              frames={allFrames}
              busy={results.busy}
              capped={results.capped}
              query={lv.query}
              onQuery={(q) => setLaView({ query: q })}
              lineNames={lineNames}
              decoders={resultsDecoders}
              filter={lv.resFilter ?? 'all'}
              onFilter={(f) => setLaView({ resFilter: f })}
              onClose={() => setLaView({ results: false, resultsByUser: true })}
              selected={picked}
              onPick={(f) => {
                tick()
                setPicked(f.id)
                centreOn(f.t0, f.t1, { zoomTo: true, marker: f.t0 })
              }}
            />
          )}
        </div>
        </>
      )}
      {channels.length > 0 && (
        <div className="lai-foot" aria-live="off">
          <span className="lai-foot-cell">
            {/* product chrome (QA clarity LA-AXIS): the window range and the hover readout have their own names */}
            <span className="lai-foot-k">{classic ? 't' : cursor !== null ? tc('Cursor', 'la-foot') : tc('Window', 'la-foot')}</span>
            {cursor !== null
              ? fmtSimTimeAt(cursor, timeRes)
              : cap
                ? classic
                  ? `${fmtSimTimeAt(win.t0, timeRes)} → ${fmtSimTimeAt(win.t1, timeRes)}`
                  : // the axis anchor's format: no dangling zero group (QA clarity LA-AXIS)
                    `${fmtTickAnchor(win.t0, view.span / DIVS)} → ${fmtTickAnchor(win.t1, view.span / DIVS)}`
                : '—'}
          </span>
          {(['a', 'b'] as const).map((k) => {
            const name = k.toUpperCase()
            const at = markers[k]
            const armed = lv.armed === k
            // the marker readout doubles as its placement toggle (UX IS-9): touch and mouse users
            // pick which marker the next click on the waveform moves
            return (
              <button
                key={k}
                type="button"
                className={`lai-foot-cell lai-foot-mk lai-foot-${k} ${armed ? 'is-armed' : ''}`}
                aria-pressed={armed}
                title={t('Place marker {m} with the next click on the waveform', { m: name })}
                onClick={() => {
                  tick()
                  setLaView({ armed: armed ? null : k })
                }}
              >
                <span className="lai-foot-k">{name}</span>
                {armed ? t('click the waveform') : at !== null ? fmtSimTimeAt(at, markerRes(k)) : '—'}
                {!armed && at !== null && onEdge[k] && <span className="lai-foot-snap">{t('on an edge')}</span>}
              </button>
            )
          })}
          {(markers.a !== null || markers.b !== null) && (
            <button
              type="button"
              className="lai-foot-x"
              aria-label={t('Clear markers')}
              title={t('Clear markers')}
              onClick={() => {
                if (labCursor !== null && labCursor === markers.a) setLabCursor(null)
                setLaView({ markers: { a: null, b: null } })
              }}
            >
              <CloseIcon size={10} />
            </button>
          )}
          {delta !== null && (
            <span className="lai-foot-cell lai-foot-d">
              <span className="lai-foot-k">{classic ? 'Δt' : <InstrumentTerm id="dt">Δt</InstrumentTerm>}</span>
              {fmtDelta(delta)}
              {Math.abs(delta) > 0 &&
                (classic ? (
                  <> · {fmtFreq(1 / Math.abs(delta))}</>
                ) : (
                  <>
                    {' · '}
                    <span className="lai-foot-k">1/Δt</span>
                    {fmtFreq(1 / Math.abs(delta))}
                  </>
                ))}
              {markers.a !== null && markers.b !== null && (!onEdge.a || !onEdge.b) && (
                <span className="lai-foot-snap is-off" title={t('Alt + click places a marker exactly where you click; a plain click snaps it to the nearest edge')}>
                  {t('(not on an edge)')}
                </span>
              )}
            </span>
          )}
          {measureCh && meas && shortAB && (
            <span className="lai-foot-note">{t('Less than one full period between A and B — the readings are for the whole window')}</span>
          )}
          {measureCh && meas && (
            <span
              className="lai-foot-ch"
              title={t('{label}, measured over {region}', { label: measureCh.label, region: t(shortAB ? 'window' : region.label) })}
            >
              <span
                className="lai-foot-sw"
                style={{ background: CHANNEL_COLORS[measureCh.index % CHANNEL_COLORS.length] }}
                aria-hidden="true"
              />
              <span className="lai-foot-name">{names.get(measureCh.index)?.name ?? measureCh.label}</span>
              {!classic ? (
                <FootReadout
                  cell={cellOf(measureCh.index, meas)}
                  m={meas}
                  recentSpan={recentSpan}
                  edgesText={meas.edges === 0 && overwritten(measureCh.index) ? t('— (this stretch was overwritten)') : String(meas.edges)}
                />
              ) : (
                <>
              {(() => {
                const cell = cellOf(measureCh.index, meas)
                return (
                  <>
                    <span className="lai-foot-cell" title={cell.title || undefined}>
                      <span className="lai-foot-k">{cell.label}</span>
                      {cell.value}
                    </span>
                    {cell.periodic && (
                      <span className="lai-foot-cell">
                        <span className="lai-foot-k">
                          <DutyTerm />
                        </span>
                        {dutyText(meas, cell)}
                      </span>
                    )}
                  </>
                )
              })()}
              <span className="lai-foot-cell">
                <span className="lai-foot-k">{tc('edges', 'meas')}</span>
                {meas.edges === 0 && overwritten(measureCh.index) ? t('— (this stretch was overwritten)') : meas.edges}
              </span>
              {meas.high && (
                <span className="lai-foot-cell">
                  <span className="lai-foot-k">{tc('high', 'meas')}</span>
                  {fmtTimeRange(meas.high.min, meas.high.max)}
                </span>
              )}
                </>
              )}
            </span>
          )}
          {/* the per-channel column (UX IS-9) opens from the measurement readout it extends */}
          <button
            type="button"
            className={`lai-foot-cell lai-foot-mk lai-meas-toggle ${lv.measCol ? 'is-armed' : ''}`}
            aria-pressed={lv.measCol}
            title={t('Frequency, duty and pulse widths of every channel (between A and B, or over the window)')}
            onClick={() => {
              tick()
              setLaView({ measCol: !lv.measCol, measColByUser: true })
            }}
          >
            {t('Every channel')}
          </button>
          {keyHelp ? (
            <KeyHelp
              items={[
                { keys: ['←', '→'], text: t('pan') },
                { keys: ['+', '−'], text: tc('zoom', 'keys') },
                { keys: ['[', ']'], text: t('previous / next') },
                { keys: ['A', 'B'], text: t('place a marker') },
                { keys: ['Esc'], text: tc('clear', 'keys') },
                { keys: ['Alt'], text: t('+ click: no snapping') },
              ]}
            />
          ) : !lv.markerUsed && markers.a === null && windowEdges > 0 && (
            <span className="lai-foot-tip">{t('Click the waveform to place marker A, click again for B — then read Δt and the frequency.')}</span>
          )}
        </div>
      )}
    </div>
  )
}
