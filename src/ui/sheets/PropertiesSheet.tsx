/**
 * PropertiesSheet — iOS-grade component/wire inspector (DESIGN.md §2/§3).
 *
 * Self-contained: renders the kit <Sheet> itself (snaps half 0.55 / full
 * 0.92; desktop = floating glass panel anchored right). Ports the old
 * PropertiesPanel semantics onto kit controls:
 *
 *   ParamDef editors    — Switch (booleans), Segmented (selects ≤4 options,
 *                         + scope channel), dropdown row (larger selects),
 *                         SliderIOS (fully-ranged numbers), Stepper + numeric
 *                         field (precise numbers), E12 chip-scroller for the
 *                         resistor, giant circular HOLD button (pushbutton,
 *                         pointer capture + haptics), 8-switch bank for the
 *                         DIP switch. Runtime params carry a green LIVE badge
 *                         and flow through store.setParam mid-sim.
 *   Pins                — pin → hole table with live voltages.
 *   Live                — telemetry readouts (current/power/brightness/…)
 *                         and the burned-LED banner.
 *   Remove              — red destructive row: acts at once in the product
 *                         chrome (a toast with 〔復原〕), confirmed via
 *                         ActionSheet in the classic chrome.
 *   Multi-select        — 2+ selected ids render the group view instead:
 *                         count header + one destructive group-delete row.
 *
 * Embedded-lab sections (shared with the desktop workspace inspector, from
 * src/ui/embedded): MCU boards get Firmware + Execution (load / run /
 * reset / debug) right under the header and the Peripherals support table;
 * parts with `pinInfo` get the Pinout table instead of the plain pin list;
 * board sub-circuits (on-board LEDs, regulator) and the part's simulation
 * support level + live issues follow the telemetry readouts.
 *
 * `PropertiesBody` is exported so the workspace inspector renders exactly
 * the same editors inside its own (Tier-S) panel.
 *
 * Classic chrome (useLegacyChrome — English without the workspace, IN-18):
 * the body renders as it did before the UX wave (commit 6d01968) — the old
 * header (`type · placement`), FirmwareGroup + McuRunGroup on top, the plain
 * pin table, PeripheralsGroup — from src/ui/embedded/legacy-inspector.tsx,
 * with none of the wave's surfaces (problems, readout, MCU tabs, net group).
 *
 * Usage:
 *   <PropertiesSheet open={selection != null} onDismiss={() => select(null)}
 *     desktop={isDesktop} />
 */
import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  ActionSheet,
  ListGroup,
  ListRow,
  Segmented,
  Sheet,
  SliderIOS,
  Stepper,
  Switch,
  LogicIcon,
  TrashIcon,
  WaveformIcon,
  pressProps,
  tick,
} from '../kit'
import { canSwapLeads, useStore } from '../../state/store'
import { getEntry, paramOf, type CatalogEntry, type ComponentCategory, type ParamDef } from '../../model/catalog'
import { componentPinHoles, formatHole, parseHole, parseTerminalRef } from '../../model/breadboard'
import { boardConfigOf } from '../../model/types'
import type { CircuitLayout, ComponentInstance, ComponentTelemetry, Wire } from '../../model/types'
import { clamp, fmtEng, fmtVolts, tc, toNumber } from '../format'
import { wireColorHex, wireColorLabel } from '../wire-colors'
import { wireRoleOf } from '../wire-roles'
import { t, useLang } from '../../i18n'
import { tidyCjkSpaces } from '../../i18n/tidy'
import { partLabel, partOptionLabel, partParamLabel, pinDisplayName, pinLabel } from '../../i18n/parts'
import {
  FirmwareGroup,
  FirmwareSetupGroup,
  FirmwareSummary,
  McuStatsGroup,
  McuStatusGroup,
  PeripheralsGroup,
  rememberMcuTab,
  rememberedMcuTab,
  useMcuView,
} from '../embedded/McuPanel'
import { swapLeadsWithFeedback, useInspectorFocus, type InspectorTab } from '../embedded/problems'
import {
  PinProbeButtons,
  PinoutGroup,
  SimulationGroup,
  SubcircuitGroup,
  WrapParts,
  heldParts,
  netIndexOf,
  terminalDestination,
  terminalWired,
  type NetMember,
} from '../embedded/PartInfo'
import type { ProbeTarget } from '../embedded/probe-actions'
import { ProblemsList } from '../embedded/ProblemsList'
import { ChipButton, LatchToggle, Term, sourceHoverProps, useSourceHoverRelease } from '../embedded/controls'
import { canPress, pressMomentary, setLatched, useLatched } from '../embedded/latch'
import { addLogicChannelFor, addScopeProbeFor, findScopeProbe, flashScopeChannel, nextScopeChannel } from '../embedded/probe-actions'
import { endpointName } from '../workspace/hole-chip'
import { getNetLive, netLiveText, netLiveTitle, useNetLive } from '../embedded/instruments/net-activity'
import { useLegacyChrome } from '../chrome/legacy'
import { removeSelectedWithFeedback } from '../chrome/edit-feedback'
import { placementMeta } from './PartsSheet'
import {
  LegacyFirmwareGroup,
  LegacyMcuRunGroup,
  LegacyPeripheralsGroup,
  LegacyPinoutGroup,
  LegacySimulationGroup,
  LegacySubcircuitGroup,
} from '../embedded/legacy-inspector'
import { fmtBrightness, fmtReadingCurrent, fmtReadingPower, fmtReadingVoltage, isNoLoad } from '../embedded/format'
import { DamageBanner, damageText, fmtHeat } from '../embedded/DamageBanner'
import { classicLedBrightness, isAveragedLed, ledLightParts, LED_LIGHT_RATED_A } from '../../instruments/led-light'
import { isMeterPart, isWaveformSourcePart, meterReading, waveformLiveText } from '../embedded/instruments/meter-readout'
import { expectationText, meetsExpectation, useStepExpectation, type StepExpectation } from '../lessons/expectation'
import '../embedded/inspector.css'
import './PropertiesSheet.css'

/**
 * The classic chrome renders the pre-wave inspector (IN-18): read by the
 * rows the wave changed (labels, the HOLD button, pin rows, live values).
 */
const ClassicBody = createContext(false)

// ---------------------------------------------------------------------------
// Sheet root
// ---------------------------------------------------------------------------

/** half (auto-present) / full (scroll + edit everything) */
const SNAPS = [0.55, 0.92] as const

/**
 * Contract bridge — the concurrent store work widens `AppState.selection`
 * to a multi-select. Normalize either shape (id | id[] | null) to a list so
 * this sheet renders correctly before and after the contract lands.
 */
function selectionList(sel: unknown): readonly string[] {
  if (Array.isArray(sel)) return sel.filter((x): x is string => typeof x === 'string')
  return typeof sel === 'string' ? [sel] : []
}

export interface PropertiesSheetProps {
  open: boolean
  /** Called when the user dismisses the sheet (swipe down / scrim / Esc). */
  onDismiss: () => void
  /** Render as the desktop floating panel (anchored right) instead. */
  desktop?: boolean
}

export function PropertiesSheet({ open, onDismiss, desktop = false }: PropertiesSheetProps) {
  useLang()
  const [snap, setSnap] = useState(0)
  useEffect(() => {
    if (open) setSnap(0) // re-present at half each time
  }, [open])

  return (
    <Sheet
      open={open}
      onDismiss={onDismiss}
      snapPoints={SNAPS}
      activeSnap={snap}
      onSnapChange={setSnap}
      desktop={desktop}
      anchor="right"
      ariaLabel={t('Properties')}
      className="prs"
    >
      <PropertiesBody desktop={desktop} onDone={onDismiss} />
    </Sheet>
  )
}

/**
 * The inspector body for the current selection (group view, component
 * editor, wire editor or the empty state). Rendered by PropertiesSheet and
 * by the desktop workspace inspector; `empty` overrides the nothing-selected
 * view (the inspector shows its own hint there).
 */
export function PropertiesBody({
  desktop,
  onDone,
  empty,
}: {
  desktop: boolean
  /** after a removal (dismiss the sheet / clear the selection) */
  onDone: () => void
  empty?: ReactNode
}) {
  const selection = useStore((s) => s.selection)
  const components = useStore((s) => s.layout.components)
  const wires = useStore((s) => s.layout.wires)
  useLang() // the workspace inspector hosts this body without the sheet

  // group view for a 2+ multi-select; the single-selection editors below
  // are unchanged
  const selected = selectionList(selection)
  const single = selected.length === 1 ? selected[0] : null
  const comp = single ? components.find((c) => c.id === single) : undefined
  const wire = !comp && single ? wires.find((w) => w.id === single) : undefined
  const classic = useLegacyChrome()

  return (
    <ClassicBody.Provider value={classic}>
      <div className={classic ? 'prs-body prs-classic' : 'prs-body'}>
        {selected.length > 1 ? (
          <MultiEditor ids={selected} components={components} wires={wires} desktop={desktop} onDone={onDone} />
        ) : comp ? (
          classic ? (
            <ClassicComponentEditor comp={comp} desktop={desktop} onDone={onDone} />
          ) : (
            <ComponentEditor comp={comp} desktop={desktop} onDone={onDone} />
          )
        ) : wire ? (
          <WireEditor wire={wire} desktop={desktop} onDone={onDone} />
        ) : (
          (empty ?? <EmptyEditor />)
        )}
      </div>
    </ClassicBody.Provider>
  )
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function LiveBadge() {
  return (
    <span className="prs-live" title={t('Adjustable while the simulation runs')}>
      {t('live')}
    </span>
  )
}

/** Localised parameter label (the catalog itself stays English). */
function paramLabel(entry: CatalogEntry, def: ParamDef): string {
  return partParamLabel(entry, def.key, def.label)
}

function Label({ entry, def }: { entry: CatalogEntry; def: ParamDef }) {
  const classic = useContext(ClassicBody)
  // BOOT0 is sampled by the MCU at reset (RM0008 §3.4): "live" would promise too much
  const atReset = !classic && entry.mcu != null && def.key === 'boot0'
  return (
    <span className="prs-label-wrap">
      {atReset ? <Term id="boot0">{paramLabel(entry, def)}</Term> : paramLabel(entry, def)}
      {def.runtime &&
        (atReset ? (
          <span className="prs-live is-at-reset" title={t('Sampled when the MCU resets')}>
            {t('takes effect at the next reset')}
          </span>
        ) : (
          <LiveBadge />
        ))}
    </span>
  )
}

/** Big title header: component label + monospace id + type subtitle. */
function SheetHeader({
  title,
  id,
  subtitle,
  trailing,
  anchor,
}: {
  title: string
  id: string
  subtitle: ReactNode
  trailing?: ReactNode
  /** DOM id (focusInspector scrolls to `insp-{id}`) */
  anchor?: string
}) {
  return (
    <header className="prs-head" id={anchor}>
      <div className="prs-head-main">
        <span className="prs-head-title lg-title">{title}</span>
        <span className="prs-head-id">{id}</span>
        {trailing != null && <span className="prs-head-trailing">{trailing}</span>}
      </div>
      <div className="prs-head-sub lg-caption">{subtitle}</div>
    </header>
  )
}

/**
 * Stacked parameter row inside a ListGroup: label line (with optional
 * right-aligned value readout) + a full-width control line. Reuses the
 * kit's .lg-row class so the inset hairline separators come for free.
 */
function StackRow({
  entry,
  def,
  value,
  children,
}: {
  entry: CatalogEntry
  def: ParamDef
  value?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="lg-row prs-stack" role="listitem">
      <div className="prs-stack-top">
        <Label entry={entry} def={def} />
        {value != null && <span className="prs-stack-value lg-tabular">{value}</span>}
      </div>
      <div className="prs-stack-ctl">{children}</div>
    </div>
  )
}

/** Stops the Sheet from hijacking drags aimed at capturing controls
 *  (slider knob, stepper hold-repeat, HOLD button). */
const stopSheetDrag = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => e.stopPropagation(),
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyEditor() {
  return (
    <div className="prs-empty">
      <div className="lg-headline">{t('Nothing selected')}</div>
      <p className="lg-caption">{t('Tap a component or wire on the board to edit it here.')}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component editor
// ---------------------------------------------------------------------------

function ComponentEditor({
  comp,
  desktop,
  onDone,
}: {
  comp: ComponentInstance
  desktop: boolean
  onDone: () => void
}) {
  const telemetry = useStore((s) => s.telemetry)
  const entry = getEntry(comp.type)

  if (!entry) {
    return (
      <>
        <SheetHeader title={t('Unknown component')} id={comp.id} subtitle={<span translate="no">{comp.type}</span>} />
        <ListGroup footer={t('This type is not in the catalog — it cannot be edited.')}>
          <ListRow title={t('Type')} trailing={<span className="prs-mono">{comp.type}</span>} />
        </ListGroup>
        <RemoveGroup
          label={t('Remove {id}', { id: comp.id })}
          confirmTitle={comp.id}
          desktop={desktop}
          onDone={onDone}
        />
      </>
    )
  }

  const tele = telemetry?.components[comp.id]
  const isPushbutton = comp.type === 'pushbutton'
  const isDip = comp.type === 'dip_switch_8'
  const generalParams = (entry.params ?? []).filter(
    (p) => !(isPushbutton && p.key === 'pressed') && !(isDip && p.key === 'on'),
  )

  const partNumber = entry.meta?.partNumber
  const isMcu = entry.mcu != null
  const label = partLabel(entry)

  return (
    <>
      <SheetHeader
        title={label}
        id={comp.id}
        anchor={`insp-${comp.id}`}
        subtitle={
          <>
            {/* a real part number is an identifier: never translated */}
            {partNumber && !label.includes(partNumber) && <span translate="no">{`${partNumber} · `}</span>}
            {partKindText(entry)}
          </>
        }
        trailing={<HeaderDelete id={comp.id} onDone={onDone} />}
      />
      {/* focusable: 「見上方 n 則問題」 moves the focus here (PartInfo scrollToPart); an MCU board's
          own state facts read as their title + 「見下方執行狀態」 — the sentence is in its 執行狀態 card (QA IN-F3) */}
      <div className="insp-part-problems" tabIndex={-1}>
        <ProblemsList variant="compact" componentId={comp.id} boardState={isMcu ? comp.id : undefined} />
      </div>
      <ReadoutGroup comp={comp} entry={entry} tele={tele} />

      {isMcu ? (
        <McuInspector comp={comp} entry={entry} tele={tele} generalParams={generalParams} />
      ) : (
        <PartSections
          comp={comp}
          entry={entry}
          tele={tele}
          generalParams={generalParams}
          isPushbutton={isPushbutton}
          isDip={isDip}
        />
      )}

      <RemoveGroup
        label={t('Remove {id}', { id: comp.id })}
        confirmTitle={`${comp.id} · ${label}`}
        desktop={desktop}
        onDone={onDone}
      />
    </>
  )
}

/**
 * The classic chrome's component editor, as before the UX wave (IN-18): the
 * header `type · placement`, firmware + execution on top for MCU boards, the
 * plain pin table or the pinout, live values, on-board parts, support and
 * peripherals — none of the wave's surfaces.
 */
function ClassicComponentEditor({
  comp,
  desktop,
  onDone,
}: {
  comp: ComponentInstance
  desktop: boolean
  onDone: () => void
}) {
  const telemetry = useStore((s) => s.telemetry)
  const entry = getEntry(comp.type)

  if (!entry) {
    return (
      <>
        <SheetHeader title={t('Unknown component')} id={comp.id} subtitle={<span translate="no">{comp.type}</span>} />
        <ListGroup footer={t('This type is not in the catalog — it cannot be edited.')}>
          <ListRow title={t('Type')} trailing={<span className="prs-mono">{comp.type}</span>} />
        </ListGroup>
        <RemoveGroup
          label={t('Remove {id}', { id: comp.id })}
          confirmTitle={comp.id}
          desktop={desktop}
          onDone={onDone}
        />
      </>
    )
  }

  const tele = telemetry?.components[comp.id]
  const isPushbutton = comp.type === 'pushbutton'
  const isDip = comp.type === 'dip_switch_8'
  const generalParams = (entry.params ?? []).filter(
    (p) => !(isPushbutton && p.key === 'pressed') && !(isDip && p.key === 'on'),
  )

  const partNumber = entry.meta?.partNumber
  const isMcu = entry.mcu != null
  const label = partLabel(entry)

  return (
    <>
      <SheetHeader
        title={label}
        id={comp.id}
        subtitle={
          <>
            {/* part number / catalog type key: identifiers, never translated */}
            <span translate="no">{partNumber && !label.includes(partNumber) ? partNumber : comp.type}</span>
            {` · ${placementMeta(entry)}`}
          </>
        }
      />

      {isMcu && <LegacyFirmwareGroup componentId={comp.id} />}
      {isMcu && <LegacyMcuRunGroup componentId={comp.id} />}

      {isPushbutton && <HoldGroup comp={comp} />}
      {isDip && <DipSwitchGroup comp={comp} entry={entry} />}

      {generalParams.length > 0 && (
        <ListGroup header={t('Parameters')}>
          {generalParams.map((def) => (
            <ParamControl key={def.key} comp={comp} entry={entry} def={def} />
          ))}
        </ListGroup>
      )}

      {entry.pinInfo ? (
        <LegacyPinoutGroup comp={comp} entry={entry} tele={tele} />
      ) : (
        <PinsGroup comp={comp} entry={entry} tele={tele} />
      )}
      {tele && <LiveGroup tele={tele} />}
      <LegacySubcircuitGroup entry={entry} tele={tele} />
      <LegacySimulationGroup entry={entry} componentId={comp.id} />
      {isMcu && <LegacyPeripheralsGroup componentId={comp.id} />}

      <RemoveGroup
        label={t('Remove {id}', { id: comp.id })}
        confirmTitle={`${comp.id} · ${label}`}
        desktop={desktop}
        onDone={onDone}
      />
    </>
  )
}

/** The editor body of an ordinary part: controls, parameters, pins, live values, support. */
function PartSections({
  comp,
  entry,
  tele,
  generalParams,
  isPushbutton,
  isDip,
}: {
  comp: ComponentInstance
  entry: CatalogEntry
  tele: ComponentTelemetry | undefined
  generalParams: ParamDef[]
  isPushbutton: boolean
  isDip: boolean
}) {
  return (
    <>
      {isPushbutton && <HoldGroup comp={comp} />}
      {isDip && <DipSwitchGroup comp={comp} entry={entry} />}

      {generalParams.length > 0 && (
        <ListGroup header={t('Parameters')}>
          {generalParams.map((def) => (
            <ParamControl key={def.key} comp={comp} entry={entry} def={def} />
          ))}
        </ListGroup>
      )}

      {entry.pinInfo ? (
        <PinoutGroup comp={comp} entry={entry} tele={tele} />
      ) : (
        <PinsGroup comp={comp} entry={entry} tele={tele} />
      )}
      {tele && (
        <LiveGroup
          tele={tele}
          supply={entry.sim.kind === 'device' && entry.sim.model === 'power_supply'}
          waveformOut={isWaveformSourcePart(entry) ? `${comp.id}:${entry.pins[0]}` : undefined}
          // a meter / supply shows the lesson's expectation in its 讀數 card instead (one place)
          expectFor={isMeterPart(entry) ? undefined : comp.id}
          partId={comp.id}
          entry={entry}
        />
      )}
      <SubcircuitGroup entry={entry} tele={tele} />
      <SimulationGroup entry={entry} componentId={comp.id} />
    </>
  )
}

// ---------------------------------------------------------------------------
// MCU boards: status on top, then 概況｜腳位｜韌體｜周邊 (IN-6)
// ---------------------------------------------------------------------------

type McuTab = InspectorTab

/** The last useInspectorFocus request an MCU inspector applied (each request switches the tab once). */
let appliedFocusSeq = 0

/**
 * An MCU board's inspector. Always on top: the status card (state chip +
 * reason, ▶ Run / ▶ 繼續執行, Reset MCU) with the firmware summary row. Then
 * a segmented control —
 *   概況  core readouts + 偵錯, the pins in use, parameters (BOOT0)
 *   腳位  the full pinout with its search and 「只看有接線的腳」, on-board parts
 *   韌體  the full firmware card (picker, file, drop zone, warnings)
 *   周邊  「韌體目前的設定」 (what the firmware set up: serial ports, buses, PWM,
 *         analog inputs — each with its instrument; QA clarity PERIPH-LIVE-CONFIG),
 *         the board's simulation support level + the peripheral support table
 * remembered per session; focusInspector() picks the tab (and scrolls to a
 * pin row) through useInspectorFocus.
 */
function McuInspector({
  comp,
  entry,
  tele,
  generalParams,
}: {
  comp: ComponentInstance
  entry: CatalogEntry
  tele: ComponentTelemetry | undefined
  generalParams: ParamDef[]
}) {
  const view = useMcuView(comp.id)
  const request = useInspectorFocus((s) => s.request)
  // a focusInspector request for this board that no inspector applied yet (it selected the board,
  // so this inspector mounts AFTER it — IN-19: 「U1 PA5」 opens the 腳位 tab at PA5)
  const fresh = request && request.componentId === comp.id && request.seq > appliedFocusSeq ? request : null
  const requestedTab = (r: typeof request): McuTab | undefined => (r ? (r.tab ?? (r.pin ? 'pins' : undefined)) : undefined)
  // otherwise the tab last chosen for this kind of board (IN-21): reselecting U1 returns to it
  const [tab, setTabState] = useState<McuTab>(() => requestedTab(fresh) ?? rememberedMcuTab(comp.type))
  const setTab = (next: McuTab) => {
    rememberMcuTab(comp.type, next)
    setTabState(next)
  }
  useEffect(() => {
    if (!request || request.componentId !== comp.id || request.seq <= appliedFocusSeq) return
    appliedFocusSeq = request.seq
    const next = requestedTab(request)
    if (next) setTab(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, comp.id])
  useLang()

  const tabs: { value: McuTab; label: string }[] = [
    { value: 'overview', label: t('Overview|mcu-tab') },
    { value: 'pins', label: t('Pins|mcu-tab') },
    { value: 'firmware', label: t('Firmware|mcu-tab') },
    { value: 'peripherals', label: t('Peripherals|mcu-tab') },
  ]
  return (
    <>
      <McuStatusGroup
        componentId={comp.id}
        view={view}
        firmwareRow={<FirmwareSummary componentId={comp.id} onDetails={() => setTab('firmware')} />}
      />
      <div className="insp-tabs" role="presentation">
        <Segmented options={tabs} value={tab} onChange={setTab} aria-label={t('{id} sections', { id: comp.id })} />
      </div>
      {tab === 'overview' && (
        <>
          <McuStatsGroup componentId={comp.id} view={view} header={t('Core|section')} />
          {entry.pinInfo && <PinoutGroup comp={comp} entry={entry} tele={tele} variant="in-use" />}
          {generalParams.length > 0 && (
            <ListGroup header={t('Parameters')}>
              {generalParams.map((def) => (
                <ParamControl key={def.key} comp={comp} entry={entry} def={def} />
              ))}
            </ListGroup>
          )}
        </>
      )}
      {tab === 'pins' && (
        <>
          {entry.pinInfo ? (
            <PinoutGroup comp={comp} entry={entry} tele={tele} />
          ) : (
            <PinsGroup comp={comp} entry={entry} tele={tele} />
          )}
          <SubcircuitGroup entry={entry} tele={tele} />
        </>
      )}
      {tab === 'firmware' && <FirmwareGroup componentId={comp.id} />}
      {tab === 'peripherals' && (
        <>
          <FirmwareSetupGroup componentId={comp.id} onShowPins={() => setTab('pins')} />
          <SimulationGroup entry={entry} componentId={comp.id} />
          <PeripheralsGroup componentId={comp.id} />
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Header subtitle: what kind of part this is, in words (IN-9)
// ---------------------------------------------------------------------------

/** Part kinds per catalog category (English sources through tc(…, 'part-kind')). */
const PART_KIND: Record<ComponentCategory, string> = {
  passive: 'Passive component',
  semiconductor: 'Semiconductor',
  switch: 'Switch',
  display: 'Display',
  ic: 'Integrated circuit',
  power: 'Power source',
  instrument: 'Instrument',
  mcu: 'Microcontroller',
  sensor: 'Sensor',
  module: 'Module',
  motor: 'Motor / actuator',
}

/** 「微控制器 · 40 腳」, 「被動元件 · 2 腳」, 「儀器 · 板外」 — never a catalog type key. */
function partKindText(entry: CatalogEntry): string {
  const kind = tc(PART_KIND[entry.category] ?? 'Component', 'part-kind')
  const n = entry.pins.length
  const where = entry.placement === 'offboard' ? t('off-board') : t('{n} pins|count', { n })
  return `${kind} · ${where}`
}

// ---------------------------------------------------------------------------
// Meter readout (IN-5): the reading a lesson asks for, big, on the first screen
// ---------------------------------------------------------------------------

/** aria-live announcements of a changing reading: at most one per 2 s. */
function useThrottledAnnouncement(text: string, ms = 2000): string {
  const [said, setSaid] = useState(text)
  const last = useRef(0)
  useEffect(() => {
    const now = Date.now()
    const wait = last.current + ms - now
    if (wait <= 0) {
      last.current = now
      setSaid(text)
      return
    }
    const h = setTimeout(() => {
      last.current = Date.now()
      setSaid(text)
    }, wait)
    return () => clearTimeout(h)
  }, [text, ms])
  return said
}

/**
 * 「讀數」 for meters and bench supplies: a 30 px value from the part's own
 * telemetry (the multimeter's display text, the supply's output current) and
 * what it measures — the very text the 量測 tab lists (meterReading, shared
 * with src/ui/embedded/instruments/meter-readout.ts, so the two never
 * disagree). No telemetry → 「—」 and how to get one; a paused simulation
 * says the value is the last reading. While the lesson coach shows a step
 * that measures this part, its expectation sits under the value with ✓ / ✕
 * (UX LS-15). Updates at the store's telemetry rate (≤ 10 Hz) — no
 * per-frame work.
 */
function ReadoutGroup({
  comp,
  entry,
  tele,
}: {
  comp: ComponentInstance
  entry: CatalogEntry
  tele: ComponentTelemetry | undefined
}) {
  const running = useStore((s) => s.running)
  // the probes' wires are part of the reading (UX QA IS-F11): wiring one while paused updates the card
  const layout = useStore((s) => s.layout)
  const meter = isMeterPart(entry)
  const { value, sub, unwired } = meterReading(comp, entry, tele, layout)
  const announce = useThrottledAnnouncement(value ? `${value} ${sub}` : unwired ? sub : '')
  const expected = useStepExpectation(meter ? comp.id : null)
  if (!meter) return null
  return (
    <ListGroup header={t('Reading')}>
      <div className="lg-row insp-readout" role="listitem">
        <span className={`insp-readout-value ${value ? '' : 'is-empty'}`} translate="no">
          {value ?? '—'}
        </span>
        <span className={`insp-readout-sub${unwired ? ' is-open' : ''}`}>
          {unwired
            ? // a probe has no wire: nothing to wait for — what is missing and the next step (the 量測 tab's words)
              sub
            : value
              ? !running
                ? t('{what} · paused (last reading)', { what: sub })
                : sub
              : running
                ? t('Waiting for the first reading…')
                : t('Shown once you press “▶ Run simulation” above')}
        </span>
        {expected && <ExpectationLine expected={expected} value={value ? meterNumber(entry, tele, expected.quantity) : null} />}
        <span className="emb-visually-hidden" aria-live="polite">
          {announce}
        </span>
      </div>
    </ListGroup>
  )
}

/**
 * The number a meter / supply reading stands for, in the quantity a lesson
 * step expects (null: this reading does not measure that quantity — a meter
 * in A mode under a voltage step — or there is none / it is over range).
 */
function meterNumber(entry: CatalogEntry, tele: ComponentTelemetry | undefined, quantity: StepExpectation['quantity']): number | null {
  if (!tele) return null
  const model = entry.sim.kind === 'device' ? entry.sim.model : ''
  if (model === 'multimeter') {
    const r = tele.values?.reading
    if (typeof r !== 'number' || !Number.isFinite(r)) return null
    const mode = tele.text?.[1]
    if (quantity === 'voltage' && mode === 'DC V') return r
    if (quantity === 'current' && mode === 'DC A') return r
    return null
  }
  if (model === 'power_supply') {
    const vp = tele.pinVoltages?.['+']
    const vm = tele.pinVoltages?.['-']
    if (quantity === 'voltage') return vp !== undefined && vm !== undefined ? vp - vm : null
    if (quantity === 'current') return tele.current ?? null
  }
  return null
}

/**
 * 「本課預期 1.7 V – 1.9 V ✓」 under a reading (UX LS-15): the guided step's
 * range and whether the live value is inside it — ✓ / ✕, or no mark when
 * there is no comparable value. Changes only with the reading and the step.
 */
function ExpectationLine({ expected, value }: { expected: StepExpectation; value: number | null | undefined }) {
  const ok = meetsExpectation(expected, value)
  const verdict = ok === null ? null : ok ? t('Within the expected range') : t('Outside the expected range')
  return (
    <span className={`insp-expect ${ok === true ? 'is-ok' : ok === false ? 'is-off' : ''}`}>
      {expectationText(expected)}
      {verdict !== null && (
        <span className="insp-expect-mark" role="img" aria-label={verdict} title={verdict}>
          {ok ? '✓' : '✕'}
        </span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Multi-select group view: count header + one destructive group-delete row
// (the single-selection editors above/below are untouched)
// ---------------------------------------------------------------------------

function MultiEditor({
  ids,
  components,
  wires,
  desktop,
  onDone,
}: {
  ids: readonly string[]
  components: readonly ComponentInstance[]
  wires: readonly Wire[]
  desktop: boolean
  onDone: () => void
}) {
  const nComp = ids.reduce((n, id) => (components.some((c) => c.id === id) ? n + 1 : n), 0)
  const nWire = ids.reduce((n, id) => (wires.some((w) => w.id === id) ? n + 1 : n), 0)
  const kinds: string[] = []
  if (nComp > 0) kinds.push(nComp === 1 ? t('{n} component', { n: nComp }) : t('{n} components', { n: nComp }))
  if (nWire > 0) kinds.push(nWire === 1 ? t('{n} wire', { n: nWire }) : t('{n} wires', { n: nWire }))
  const idLine =
    ids.length > 5 ? `${ids.slice(0, 5).join(' · ')} +${ids.length - 5}` : ids.join(' · ')
  return (
    <>
      <SheetHeader
        title={t('{n} selected', { n: ids.length })}
        id={idLine}
        subtitle={kinds.join(' · ') || t('group selection')}
      />
      <RemoveGroup
        label={t('Delete {n} parts', { n: ids.length })}
        confirmTitle={t('{n} selected', { n: ids.length })}
        message={t('Removes every selected part and disconnects them from the circuit.')}
        desktop={desktop}
        onDone={onDone}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Param dispatch
// ---------------------------------------------------------------------------

interface ParamRowProps {
  comp: ComponentInstance
  entry: CatalogEntry
  def: ParamDef
}

function ParamControl({ comp, entry, def }: ParamRowProps) {
  const classic = useContext(ClassicBody)
  // product chrome (operation simplification): the common values are one tap
  if (!classic) {
    const picks = quickPicksFor(comp.type, def.key)
    if (picks) return <QuickPickRow comp={comp} entry={entry} def={def} picks={picks} />
    if (comp.type === 'led' && def.key === 'color') return <LedColorRow comp={comp} entry={entry} def={def} />
    // a pressable part's button (KY-040 push, joystick SW): the pushbutton's 「保持按下」 —
    // same words, look and latch semantics everywhere (latch.ts), not a generic switch
    if (def.key === 'pressed' && canPress(entry)) return <LatchParamRow comp={comp} entry={entry} def={def} />
  }
  if (comp.type === 'resistor' && def.key === 'resistance') {
    return <ResistanceRow comp={comp} entry={entry} def={def} />
  }
  if (comp.type === 'scope_probe' && def.key === 'channel') {
    return <ChannelRow comp={comp} entry={entry} def={def} />
  }
  switch (def.kind) {
    case 'boolean':
      return <BooleanRow comp={comp} entry={entry} def={def} />
    case 'select': {
      const options = def.options ?? []
      return options.length <= 4 ? (
        <SegmentedRow comp={comp} entry={entry} def={def} />
      ) : (
        <DropdownRow comp={comp} entry={entry} def={def} />
      )
    }
    case 'text':
      return <TextRow comp={comp} entry={entry} def={def} />
    case 'number': {
      const ranged = def.min !== undefined && def.max !== undefined && def.step !== undefined
      return ranged ? (
        <SliderRow comp={comp} entry={entry} def={def} />
      ) : (
        <PreciseNumberRow comp={comp} entry={entry} def={def} />
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Generic editors
// ---------------------------------------------------------------------------

function BooleanRow({ comp, entry, def }: ParamRowProps) {
  const setParam = useStore((s) => s.setParam)
  const value = paramOf(comp.params, entry, def.key) === true
  return (
    <ListRow
      title={<Label entry={entry} def={def} />}
      trailing={
        <Switch
          checked={value}
          onChange={(next) => setParam(comp.id, def.key, next)}
          aria-label={paramLabel(entry, def)}
        />
      }
    />
  )
}

function SegmentedRow({ comp, entry, def }: ParamRowProps) {
  const setParam = useStore((s) => s.setParam)
  const value = String(paramOf(comp.params, entry, def.key) ?? def.default)
  const options = (def.options ?? []).map((o) => ({ value: o, label: partOptionLabel(entry, def.key, o) }))
  return (
    <StackRow entry={entry} def={def}>
      <Segmented
        options={options}
        value={value}
        onChange={(v) => setParam(comp.id, def.key, v)}
        aria-label={paramLabel(entry, def)}
      />
    </StackRow>
  )
}

/** Scope probe channel 1–4 as a segmented control (number-valued). */
function ChannelRow({ comp, entry, def }: ParamRowProps) {
  const setParam = useStore((s) => s.setParam)
  const value = String(toNumber(paramOf(comp.params, entry, def.key), 1))
  const options = ['1', '2', '3', '4'].map((v) => ({ value: v, label: `CH ${v}` }))
  return (
    <StackRow entry={entry} def={def}>
      <Segmented
        options={options}
        value={value}
        onChange={(v) => setParam(comp.id, def.key, Number(v))}
        aria-label={paramLabel(entry, def)}
      />
    </StackRow>
  )
}

/** Selects with >4 options: an iOS detail row driving the native picker. */
function DropdownRow({ comp, entry, def }: ParamRowProps) {
  const setParam = useStore((s) => s.setParam)
  const value = String(paramOf(comp.params, entry, def.key) ?? def.default)
  return (
    <div className="lg-row prs-selectrow" role="listitem">
      <Label entry={entry} def={def} />
      <span className="prs-select-value" aria-hidden="true">
        {comp.type === 'led' && def.key === 'color' && (
          <span className="prs-swatch" style={{ background: wireColorHex(value) }} />
        )}
        {partOptionLabel(entry, def.key, value)}
        <svg
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 5 6.5 2l3 3M3.5 8l3 3 3-3" />
        </svg>
      </span>
      <select
        className="prs-select-cover"
        value={value}
        aria-label={paramLabel(entry, def)}
        onChange={(e) => {
          tick()
          setParam(comp.id, def.key, e.target.value)
        }}
      >
        {(def.options ?? []).map((o) => (
          <option key={o} value={o}>
            {partOptionLabel(entry, def.key, o)}
          </option>
        ))}
      </select>
    </div>
  )
}

function TextRow({ comp, entry, def }: ParamRowProps) {
  const setParam = useStore((s) => s.setParam)
  const value = String(paramOf(comp.params, entry, def.key) ?? def.default)
  return (
    <StackRow entry={entry} def={def}>
      <input
        className="prs-input prs-input-text prs-mono"
        type="text"
        value={value}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="none"
        aria-label={paramLabel(entry, def)}
        onChange={(e) => setParam(comp.id, def.key, e.target.value)}
      />
    </StackRow>
  )
}

/** Fully-ranged numbers (min+max+step): the iOS slider with value bubble. */
function SliderRow({ comp, entry, def, children }: ParamRowProps & { children?: ReactNode }) {
  const setParam = useStore((s) => s.setParam)
  const value = toNumber(paramOf(comp.params, entry, def.key), toNumber(def.default, 0))
  const min = def.min ?? 0
  const max = def.max ?? 1
  const fmt = (v: number) => {
    if (min === 0 && max === 1) return `${Math.round(v * 100)}%`
    const s = parseFloat(v.toFixed(3))
    return def.unit ? `${s} ${def.unit}` : String(s)
  }
  return (
    <StackRow entry={entry} def={def} value={fmt(value)}>
      <div className="prs-nodrag" {...stopSheetDrag}>
        <SliderIOS
          value={clamp(value, min, max)}
          min={min}
          max={max}
          step={def.step}
          onChange={(v) => setParam(comp.id, def.key, v)}
          formatValue={fmt}
          aria-label={paramLabel(entry, def)}
        />
      </div>
      {children}
    </StackRow>
  )
}

/** Number input that keeps the user's text while typing, commits live. */
function NumberField({
  value,
  onCommit,
  step,
  ariaLabel,
}: {
  value: number
  onCommit: (n: number) => void
  step?: number
  ariaLabel?: string
}) {
  const [text, setText] = useState(String(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(String(value))
  }, [value, focused])

  return (
    <input
      className="prs-input prs-mono"
      type="number"
      inputMode="decimal"
      step={step ?? 'any'}
      value={text}
      aria-label={ariaLabel}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onCommit(n)
      }}
      onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

/** A decade-aware increment so the stepper is useful at any magnitude
 *  (1000 Ω steps by 100; 10 µF steps by 1 µF; 1 Hz steps by 0.1). */
function decadeStep(value: number): number {
  const mag = Math.abs(value)
  if (!Number.isFinite(mag) || mag === 0) return 1
  return Math.pow(10, Math.floor(Math.log10(mag)) - 1)
}

/** Precise numbers (open-ended ranges): numeric field + unit + stepper. */
function PreciseNumberRow({
  comp,
  entry,
  def,
  children,
}: ParamRowProps & { children?: ReactNode }) {
  const setParam = useStore((s) => s.setParam)
  const value = toNumber(paramOf(comp.params, entry, def.key), toNumber(def.default, 0))
  const commit = (n: number) => setParam(comp.id, def.key, clamp(n, def.min, def.max))
  return (
    <StackRow entry={entry} def={def} value={def.unit ? fmtEng(value, def.unit) : undefined}>
      <div className="prs-numline">
        <NumberField value={value} onCommit={commit} step={def.step} ariaLabel={paramLabel(entry, def)} />
        {def.unit && <span className="prs-unit lg-caption">{def.unit}</span>}
        <span className="prs-nodrag prs-numline-stepper" {...stopSheetDrag}>
          <Stepper
            value={value}
            onChange={commit}
            min={def.min ?? -Infinity}
            max={def.max ?? Infinity}
            step={def.step ?? decadeStep(value)}
            aria-label={paramLabel(entry, def)}
          />
        </span>
      </div>
      {children}
    </StackRow>
  )
}

// ---------------------------------------------------------------------------
// Special editors
// ---------------------------------------------------------------------------

const E12_QUICK = [
  100, 220, 330, 470, 680, 1000, 2200, 3300, 4700, 10000, 22000, 47000, 100000, 220000, 470000,
  1000000,
]

/** Resistor: precise number row + the E12 horizontal chip-scroller. */
function ResistanceRow({ comp, entry, def }: ParamRowProps) {
  const setParam = useStore((s) => s.setParam)
  const value = toNumber(paramOf(comp.params, entry, def.key), 1000)
  const commit = (n: number) => setParam(comp.id, def.key, clamp(n, def.min, def.max))
  return (
    <PreciseNumberRow comp={comp} entry={entry} def={def}>
      <div className="prs-chips" role="group" aria-label={t('E12 quick picks')}>
        {E12_QUICK.map((v) => (
          <button
            key={v}
            type="button"
            className="prs-chip lg-gel lg-tabular"
            aria-pressed={value === v}
            {...pressProps}
            onClick={() => {
              tick()
              commit(v)
            }}
          >
            {fmtEng(v, 'Ω')}
          </button>
        ))}
      </div>
    </PreciseNumberRow>
  )
}

/**
 * The common values of a part parameter, one tap each (product chrome —
 * operation simplification): the resistor values the lessons and examples
 * use (LED series 220 / 330 Ω, pull-ups 4.7 / 10 kΩ), a capacitor's usual
 * sizes and the bench supply's usual voltages. Anything else is still typed
 * / stepped / slid in the same row.
 */
export const QUICK_PICKS: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>> = {
  resistor: { resistance: [220, 330, 1000, 4700, 10000] },
  capacitor: { capacitance: [100e-9, 1e-6, 10e-6, 100e-6] },
  power_supply: { voltage: [3.3, 5, 9, 12] },
}

/** The quick picks of `type`'s `key` (undefined = none). */
export function quickPicksFor(type: string, key: string): readonly number[] | undefined {
  return QUICK_PICKS[type]?.[key]
}

/** A value equals a pick (float-tolerant: 1e-7 vs 100e-9). */
function samePick(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.abs(b) * 1e-9
}

/** The number row (field / stepper, or the slider of a ranged one) with the common values as one-tap chips. */
function QuickPickRow({ comp, entry, def, picks }: ParamRowProps & { picks: readonly number[] }) {
  const setParam = useStore((s) => s.setParam)
  const value = toNumber(paramOf(comp.params, entry, def.key), toNumber(def.default, 0))
  const commit = (n: number) => setParam(comp.id, def.key, clamp(n, def.min, def.max))
  const chips = (
    <div className="prs-chips prs-chips-wrap" role="group" aria-label={t('Common values')}>
      {picks.map((v) => (
        <button
          key={v}
          type="button"
          className="prs-chip lg-gel lg-tabular"
          aria-pressed={samePick(value, v)}
          {...pressProps}
          onClick={() => {
            tick()
            commit(v)
          }}
        >
          {fmtEng(v, def.unit ?? '')}
        </button>
      ))}
    </div>
  )
  const ranged = def.min !== undefined && def.max !== undefined && def.step !== undefined
  return ranged ? (
    <SliderRow comp={comp} entry={entry} def={def}>
      {chips}
    </SliderRow>
  ) : (
    <PreciseNumberRow comp={comp} entry={entry} def={def}>
      {chips}
    </PreciseNumberRow>
  )
}

/** LED colour (product chrome): the five colours as one-tap swatches instead of a picker. */
function LedColorRow({ comp, entry, def }: ParamRowProps) {
  const setParam = useStore((s) => s.setParam)
  const value = String(paramOf(comp.params, entry, def.key) ?? def.default)
  return (
    <StackRow entry={entry} def={def} value={partOptionLabel(entry, def.key, value)}>
      <div className="prs-colors" role="radiogroup" aria-label={paramLabel(entry, def)}>
        {(def.options ?? []).map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={value === o}
            aria-label={partOptionLabel(entry, def.key, o)}
            title={partOptionLabel(entry, def.key, o)}
            className={`prs-color lg-pressable${value === o ? ' is-on' : ''}`}
            style={{ ['--prs-color' as string]: wireColorHex(o) }}
            {...pressProps}
            onClick={() => {
              tick()
              setParam(comp.id, def.key, o)
            }}
          >
            <span className="prs-color-dot" aria-hidden="true" />
            <span className="prs-color-name">{partOptionLabel(entry, def.key, o)}</span>
          </button>
        ))}
      </div>
    </StackRow>
  )
}

/** Pushbutton: the giant circular HOLD button (pointer capture + haptics). */
/** A press shorter than this is a "click" (IN-12)… */
const QUICK_PRESS_MS = 150
/** …and is held until the simulation has advanced this far, so firmware polling / EXTI sees it. */
const QUICK_PRESS_SIM_S = 0.05

function HoldGroup({ comp }: { comp: ComponentInstance }) {
  const setParam = useStore((s) => s.setParam)
  const classic = useContext(ClassicBody)
  const pressed = comp.params?.pressed === true
  // 保持按下 (latch.ts): pressed while nobody holds it — the 按住 puck is a momentary hold
  const kept = useLatched(comp.id)
  const downAt = useRef<{ wall: number; sim: number } | null>(null)
  const latch = useRef<(() => void) | null>(null)
  useEffect(() => () => latch.current?.(), [])
  const press = (down: boolean) => {
    if (classic) {
      setParam(comp.id, 'pressed', down)
      return
    }
    if (down) {
      latch.current?.()
      downAt.current = { wall: performance.now(), sim: useStore.getState().simTime }
      pressMomentary(comp.id, true)
      return
    }
    const d = downAt.current
    downAt.current = null
    const st = useStore.getState()
    // a quick click while running: keep the contacts closed until 50 ms of simulated time passed
    if (d && st.running && performance.now() - d.wall < QUICK_PRESS_MS && st.simTime < d.sim + QUICK_PRESS_SIM_S) {
      const until = d.sim + QUICK_PRESS_SIM_S
      const release = () => {
        unsub()
        latch.current = null
        pressMomentary(comp.id, false)
      }
      const unsub = useStore.subscribe((s) => {
        if (s.simTime >= until || !s.running) release()
      })
      latch.current = release
      return
    }
    pressMomentary(comp.id, false) // (a part kept pressed is released by it)
  }

  return (
    <ListGroup
      header={
        <>
          {t('Button')}
          <LiveBadge />
        </>
      }
      footer={
        classic
          ? t('The contacts stay closed while you hold the button.')
          : kept
            ? t('{id} is kept pressed: the contacts stay closed until you turn “Keep pressed” off or press “HOLD” once.|latch', { id: comp.id })
            : t('The contacts stay closed while you hold the button; “Keep pressed” keeps them closed.|latch')
      }
    >
      <div className={`lg-row prs-holdrow${classic ? '' : ' latch-holdrow'}`} role="listitem">
        <button
          type="button"
          className={`prs-hold lg-card ${pressed ? 'is-down' : ''}`}
          aria-pressed={pressed}
          aria-label={t('Press and hold the pushbutton')}
          onPointerDown={(e) => {
            e.stopPropagation() // the sheet must not steal this gesture
            e.currentTarget.setPointerCapture(e.pointerId)
            tick()
            press(true)
          }}
          onPointerUp={() => {
            tick()
            press(false)
          }}
          onPointerCancel={() => press(false)}
          onKeyDown={(e) => {
            if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
              e.preventDefault()
              tick()
              press(true)
            }
          }}
          onKeyUp={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              tick()
              press(false)
            }
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {pressed ? t('PRESSED') : t('HOLD')}
        </button>
        {!classic && <LatchToggle on={kept} onChange={(on) => setLatched(comp.id, on)} />}
      </div>
    </ListGroup>
  )
}

/**
 * The 'pressed' param of a pressable part other than the pushbutton (the
 * KY-040's push switch, the joystick's button — product chrome): its name
 * (「按鈕（SW）」) and the same 「保持按下」 toggle as the pushbutton's
 * HoldGroup — on keeps it pressed until turned off (the 3D badge, the hover
 * chip and the status pill follow it, 重置模擬 lets go: latch.ts).
 */
function LatchParamRow({ comp, entry, def }: ParamRowProps) {
  const kept = useLatched(comp.id)
  return (
    <ListRow
      title={<Label entry={entry} def={def} />}
      trailing={<LatchToggle on={kept} onChange={(on) => setLatched(comp.id, on)} />}
    />
  )
}

/** DIP switch ×8: a bank of eight iOS switches. */
function DipSwitchGroup({ comp, entry }: { comp: ComponentInstance; entry: CatalogEntry }) {
  const setParam = useStore((s) => s.setParam)
  const raw = String(paramOf(comp.params, entry, 'on') ?? '00000000')
  const bits = (raw + '00000000').slice(0, 8)
  const flip = (i: number) => {
    let next = ''
    for (let j = 0; j < 8; j++) {
      const on = bits[j] === '1'
      next += (j === i ? !on : on) ? '1' : '0'
    }
    setParam(comp.id, 'on', next)
  }
  return (
    <ListGroup
      header={
        <>
          {t('Switches')}
          <LiveBadge />
        </>
      }
      footer={t('Switch n connects pin nA to pin nB while on.')}
    >
      {Array.from({ length: 8 }, (_, i) => (
        <ListRow
          key={i}
          title={t('Switch {n}', { n: i + 1 })}
          trailing={
            <Switch
              checked={bits[i] === '1'}
              onChange={() => flip(i)}
              aria-label={t('Switch {n}', { n: i + 1 })}
            />
          }
        />
      ))}
    </ListGroup>
  )
}

// ---------------------------------------------------------------------------
// Pins + telemetry
// ---------------------------------------------------------------------------

function PinsGroup({
  comp,
  entry,
  tele,
}: {
  comp: ComponentInstance
  entry: CatalogEntry
  tele: ComponentTelemetry | undefined
}) {
  // board-aware: far-column Lab XL / module-2+ / board-row-2+ parts must
  // still resolve (boardRows was missing here — review defect B2)
  const board = useStore((s) => s.layout.board)
  const boardCount = useStore((s) => s.layout.boardCount)
  const boardRows = useStore((s) => s.layout.boardRows)
  const holes = componentPinHoles(comp, entry, boardConfigOf({ board, boardCount, boardRows }))
  const showNum = entry.placement === 'dip' || entry.placement === 'footprint'
  const incomplete = holes === null && entry.placement !== 'offboard'
  const classic = useContext(ClassicBody)
  const layout = useStore((s) => s.layout)
  // a pin row under the mouse marks its hole on the board (H7); cleared if the list goes away under it
  useSourceHoverRelease()
  if (classic) {
    return (
      <ListGroup
        header={t('Pins')}
        footer={incomplete ? t('Placement is incomplete or invalid for this part.') : undefined}
      >
        {entry.pins.map((pin, i) => {
          const hole = holes?.[i] ?? null
          const where =
            entry.placement === 'offboard' ? `${comp.id}:${pin}` : hole ? formatHole(hole) : '—'
          const v = tele?.pinVoltages?.[pin]
          return (
            <div key={pin} className="prs-pin" role="listitem">
              {showNum && <span className="prs-pin-num lg-tabular">{i + 1}</span>}
              {/* pin names / hole refs are identifiers (wires use them): never
                  translated; zh-TW adds a short gloss for word-like names */}
              <span className="prs-pin-name prs-mono" translate="no">
                {pin}
              </span>
              {pinGloss(pin) && <span className="prs-pin-gloss lg-caption">{pinGloss(pin)}</span>}
              <span className="prs-pin-hole prs-mono" translate="no">
                {where}
              </span>
              <span className="prs-pin-v lg-tabular">{v !== undefined ? fmtVolts(v) : ''}</span>
            </div>
          )
        })}
      </ListGroup>
    )
  }
  return (
    <ListGroup
      header={t('Pins')}
      footer={incomplete ? t('Placement is incomplete or invalid for this part.') : undefined}
    >
      {entry.pins.map((pin, i) => {
        const hole = holes?.[i] ?? null
        const offboard = entry.placement === 'offboard'
        const ref = offboard ? `${comp.id}:${pin}` : hole ? formatHole(hole) : null
        const name = pinDisplayName(entry, pin)
        // the raw terminal ref ("PS1:+") stays inside the probe target, never on screen (QA IN-F4)
        const target: ProbeTarget | null = offboard ? { kind: 'terminal', ref: `${comp.id}:${pin}` } : ref ? { kind: 'hole', ref } : null
        // what the net is doing (UX helper H4) — a PWM net reads as PWM, an unrecorded one says 「瞬時」;
        // an off-board terminal without a wire has no net to read (QA IN-F4: 「未接線」, no 「0 V」)
        const live = tele && !(offboard && !terminalWired(layout, `${comp.id}:${pin}`)) ? getNetLive({ componentId: comp.id, pin }) : null
        const value = live ? netLiveText(live, { form: 'compact' }) : ''
        const valueTitle = live ? `${netLiveText(live)} — ${netLiveTitle(live)}` : undefined
        // a held net (paused / core halted): the level now in the value slot, its history on a line below
        const held = heldParts(live, value)
        return (
          <div
            key={pin}
            id={`pin-${comp.id}-${pin}`}
            className={`prs-pin${held ? ' has-history' : ''}`}
            role="listitem"
            {...sourceHoverProps(ref ? { holes: [ref] } : null)}
          >
            {showNum && <span className="prs-pin-num lg-tabular">{i + 1}</span>}
            <span className="prs-pin-name">{name}</span>
            {offboard ? (
              // an off-board terminal: where its wire goes (UX helper H2), 「→ 下方 + 電源軌 第 0 孔」 / 「未接線」
              <span className="prs-pin-hole prs-pin-dest" title={terminalDestination(layout, `${comp.id}:${pin}`)}>
                {terminalDestination(layout, `${comp.id}:${pin}`)}
              </span>
            ) : (
              /* hole refs are identifiers (wires use them): never translated */
              <span className="prs-pin-hole prs-mono" translate="no">
                {ref ?? '—'}
              </span>
            )}
            <span
              className="prs-pin-v lg-tabular"
              title={valueTitle}
              // a generator's setting is long (「方波 100 Hz · 0–5.00 V」): it may wrap, so where the
              // output is wired (「→ a10（R1 第 1 腳這一排）」) keeps its room beside it
              style={live?.kind === 'source' ? { flexShrink: 1, whiteSpace: 'normal' } : undefined}
            >
              {live?.kind === 'source'
                ? // wrap between the setting's parts only: 「方波 100 Hz ·」 / 「0–5.00 V」
                  <WrapParts text={value} />
                : held
                  ? held.now
                  : value === '—'
                    ? ''
                    : value}
              {live?.kind === 'unknown' && live.v !== null && <span className="insp-pin-instant">{t('instantaneous|reading')}</span>}
            </span>
            <PinProbeButtons target={target} name={pinLabel(entry, pin, { id: comp.id })} />
            {held && (
              <span className={`insp-pin-history prs-pin-history${showNum ? ' has-num' : ''}`} title={valueTitle}>
                <WrapParts text={held.before} fit />
              </span>
            )}
          </div>
        )
      })}
      {polarized(comp, entry) && canSwapLeads(layout, comp.id) && (
        <div className="lg-row insp-swap-row" role="listitem">
          <ChipButton onClick={() => void swapLeadsWithFeedback(comp.id)} title={t('Swap the two leads (one undo step)')}>
            {t('Swap the leads')}
          </ChipButton>
        </div>
      )}
    </ListGroup>
  )
}

/** A two-lead part whose orientation matters (LED, diode, Zener, electrolytic capacitor): it gets 「對調兩腳」 (IN-19). */
function polarized(comp: ComponentInstance, entry: CatalogEntry): boolean {
  if (entry.sim.kind !== 'device' || entry.pins.length !== 2) return false
  const model = entry.sim.model
  if (model === 'led' || model === 'diode' || model === 'zener') return true
  return model === 'capacitor' && paramOf(comp.params, entry, 'polarized') === true
}

/**
 * Localised gloss for a word-like pin name ("anode" → 陽極), or null (the
 * classic pin row). Never the name a second time: t() drops the 「|pin」
 * context when there is no translation, so English reads back the pin
 * itself — the classic row then showed 「anode anode b40」 instead of the
 * 6d01968 「anode b40」 (release triage IN-18).
 */
function pinGloss(pin: string): string | null {
  const key = `${pin}|pin`
  const g = t(key)
  return g === key || g === pin ? null : g
}

/**
 * Live values of a part. Every quantity through the app's one unit formatter
 * (UX helper H3, IN-14): 「0 A」 below 1 nA (a reversed LED, never 「−0 pA」),
 * 「> 2 A（短路）」 and 「—（短路）」 for a short (never 「267 A / 622 W」), an
 * unloaded bench supply 「≈ 0 A（未接負載）」 / 「≈ 0 W」. The classic chrome
 * keeps its pre-wave numbers and copy.
 */
function LiveGroup({
  tele,
  supply = false,
  waveformOut,
  expectFor,
  partId,
  entry,
}: {
  tele: ComponentTelemetry
  supply?: boolean
  /**
   * a waveform source's output terminal ("FG1:out" — a function generator,
   * QA clarity FG-RAIL): its current and power jump with the wave, so the
   * row says so and offers the scope on that output instead of printing
   * one instant of them
   */
  waveformOut?: string
  /** this part's id: the guided lesson step's expected current / brightness goes under the values (UX LS-15) */
  expectFor?: string
  /** the part (product chrome): its damage banner and the LED brightness rating (honesty F4 / damage banner) */
  partId?: string
  entry?: CatalogEntry
}) {
  const classic = useContext(ClassicBody)
  const expected = useStepExpectation(!classic && expectFor ? expectFor : null)
  // a lesson's LED brightness is on the app's one scale (F4): telemetry `light` = I / rated 20 mA
  const expectedValue =
    expected?.quantity === 'current' ? tele.current : expected?.quantity === 'led-brightness' ? tele.light : undefined
  const rows: [string, string][] = []
  /** a row's note under its title (an LED above its rating: 「超過額定 20 mA」 — F4) */
  const rowSubs: Record<string, string> = {}
  /** a waveform source's 電流 / 功率 row title (its text is the subtitle: it is a note, not a value) */
  let acTitle: string | null = null
  const noLoad = supply && isNoLoad(tele.current)
  if (classic) {
    if (tele.current !== undefined) rows.push([tc('Current', 'telemetry'), fmtEng(tele.current, 'A')])
    // plain "Power" is the parts category (電源); this readout is 功率
    if (tele.power !== undefined) rows.push([tc('Power', 'telemetry'), fmtEng(tele.power, 'W')])
    // an LED: the old I / 10 mA percent of the same eye-averaged current as the Current row (led-light.ts)
    const b = classicLedBrightness(tele)
    if (b !== undefined) rows.push([t('Brightness'), `${Math.round(Math.max(0, Math.min(1, b)) * 100)}%`])
  } else if (waveformOut) {
    // one instant of an AC current is no reading (QA clarity FG-RAIL (3)): say so, and where to look
    const what = [
      tele.current !== undefined ? tc('Current', 'telemetry') : null,
      tele.power !== undefined ? tc('Power', 'telemetry') : null,
    ].filter((x): x is string => x !== null)
    if (what.length > 0) acTitle = what.length === 2 ? t('{a} and {b}|quantities', { a: what[0], b: what[1] }) : what[0]
  } else {
    // an LED whose eye-averaged current averages a switching (PWM) current says so: 「平均 2.98 mA」,
    // its on-current 「峰值 4.07 mA」 under the title (a single LED; an RGB LED's row is the common lead's sum)
    const avg = typeof tele.light === 'number' && isAveragedLed(tele)
    const avgText = (v: string) => (avg ? t('average {v}|reading', { v }) : v)
    if (tele.current !== undefined) rows.push([tc('Current', 'telemetry'), noLoad ? t('≈ 0 A (no load)') : avgText(fmtReadingCurrent(tele.current))])
    if (avg && !tele.leds) rowSubs[tc('Current', 'telemetry')] = t('peak {v}|reading', { v: fmtReadingCurrent(tele.values?.iPeak) })
    // plain "Power" is the parts category (電源); this readout is 功率
    if (tele.power !== undefined) rows.push([tc('Power', 'telemetry'), noLoad ? t('≈ 0 W') : avgText(fmtReadingPower(tele.power, tele.current))])
    if (typeof tele.light === 'number') {
      const b = ledBrightnessValue(tele, entry)
      rows.push([t('Brightness'), b.value])
      if (b.over) rowSubs[t('Brightness')] = b.over
    } else if (tele.ledBrightness !== undefined) rows.push([t('Brightness'), fmtBrightness(tele.ledBrightness)])
    // a part with a thermal model (resistor, LED): its temperature rise relative to the rated one
    if (typeof tele.heat === 'number') rows.push([t('Temperature (relative to rated)'), fmtHeat(tele.heat)])
  }
  if (tele.sounding !== undefined) rows.push([t('Sounding'), tele.sounding ? t('Yes') : t('No')])
  const banner = !classic && partId ? damageText(partId, entry, tele) !== null : false
  if (rows.length === 0 && acTitle === null && !tele.burned && !banner) return null
  return (
    <>
      {classic
        ? tele.burned && (
            <div className="prs-burned" role="alert">
              {t('Burned out — replace this LED and add a series resistor.')}
            </div>
          )
        : partId
          ? <DamageBanner id={partId} entry={entry} tele={tele} />
          : tele.burned && (
              <div className="prs-burned" role="alert">
                {t('Burned out — add a series resistor and run the simulation again: the simulated LED recovers.')}
              </div>
            )}
      {(rows.length > 0 || acTitle !== null) && (
        <ListGroup header={tc('Live', 'telemetry')}>
          {acTitle !== null && <ListRow title={acTitle} subtitle={waveformLiveText()} />}
          {acTitle !== null && waveformOut && <ScopeOnOutput terminal={waveformOut} />}
          {rows.map(([k, v]) => (
            <ListRow key={k} title={k} subtitle={rowSubs[k]} trailing={<span className="prs-mono lg-tabular">{v}</span>} />
          ))}
          {expected && (expected.quantity === 'current' || expected.quantity === 'led-brightness') && (
            <div className="lg-row insp-expect-row" role="listitem">
              <ExpectationLine expected={expected} value={expectedValue} />
            </div>
          )}
        </ListGroup>
      )}
    </>
  )
}

/**
 * An LED's 亮度 value on the app's one scale (F4): telemetry `light` = I /
 * its rated current (catalog ifMax, 20 mA), with that current — 「20 %（4.07
 * mA）」, 「106 %（21.1 mA）」 with 「超過額定 20 mA」 under the row title,
 * 「0 %（已燒毀）」. An RGB LED's light is its brightest INTACT die, so the
 * current shown is that die's (light × rated), not the common lead's sum;
 * its `burned` means any die burned while the others may still light (the
 * burned die keeps conducting): it shows the lit dies' brightness, and
 * 「0 %（有晶粒燒毀）」 only when nothing lights.
 */
function ledBrightnessValue(tele: ComponentTelemetry, entry: CatalogEntry | undefined): { value: string; over: string | null } {
  const ifMax = entry?.ratings?.ifMax
  const rated = typeof ifMax === 'number' && ifMax > 0 ? ifMax : LED_LIGHT_RATED_A
  const rgb = entry?.sim.kind === 'device' && entry.sim.model === 'rgb_led'
  // a PWM LED's current is the eye mean of a switching current: 「15 %（平均 2.98 mA）」
  const average = isAveragedLed(tele)
  if (rgb) {
    const light = typeof tele.light === 'number' ? tele.light : 0
    if (tele.burned === true && !(light > 0)) return { value: t('0 % (a die burned out)|led'), over: null }
    return ledLightParts(tele.light, light * rated, { rated, average })
  }
  return ledLightParts(tele.light, tele.current, { rated, burned: tele.burned === true, average })
}

/**
 * 「請用示波器看」 as one tap (release close-out): the scope on a waveform
 * source's output — 「在示波器中檢視（CH1）」 when a probe already measures
 * that net (the probe menu's words), else 「放示波器探棒（CH n）」 (one undo
 * step, the scope opens); nothing when every channel is taken. Re-renders
 * with the layout only.
 */
function ScopeOnOutput({ terminal }: { terminal: string }) {
  const layout = useStore((s) => s.layout)
  const target: ProbeTarget = { kind: 'terminal', ref: terminal }
  // once per layout (the parent re-renders with the telemetry)
  const { onScope, ch } = useMemo(() => {
    const on = findScopeProbe({ kind: 'terminal', ref: terminal }, layout)
    return { onScope: on, ch: on ? null : nextScopeChannel(layout) }
  }, [layout, terminal])
  if (!onScope && ch === null) return null
  return (
    <div className="lg-row insp-net-acts" role="listitem">
      <ChipButton onClick={() => (onScope ? flashScopeChannel(onScope.channel) : void addScopeProbeFor(target))}>
        <WaveformIcon size={16} />
        {onScope ? t('Show in the oscilloscope (CH{n})', { n: onScope.channel }) : t('Place a scope probe (CH{n})', { n: ch! })}
      </ChipButton>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Remove (product chrome: at once with 〔復原〕; classic: confirmed via ActionSheet)
// ---------------------------------------------------------------------------

/**
 * The header's trash button (product chrome — operation simplification):
 * delete the selected part / wire in one tap from where its name is — on a
 * phone the Properties sheet rests at half height and the 「移除」 row sits
 * below the fold. Same action and toast (〔復原〕) as the Delete key.
 */
function HeaderDelete({ id, wire = false, onDone }: { id: string; wire?: boolean; onDone: () => void }) {
  const name = wire ? t('Wire {id}', { id }) : id
  // 「刪除導線 W3」: no space between two Chinese words (release QA SH-F11)
  const label = tidyCjkSpaces(t('Delete {name}|header', { name }))
  return (
    <button
      type="button"
      className="prs-head-del lg-pressable"
      aria-label={label}
      title={tidyCjkSpaces(t('Delete {name} — undo brings it back|header', { name }))}
      {...pressProps}
      onClick={() => {
        removeSelectedWithFeedback()
        tick(16)
        onDone()
      }}
    >
      <TrashIcon size={18} />
    </button>
  )
}

function RemoveGroup({
  label,
  confirmTitle,
  message,
  desktop,
  onDone,
}: {
  label: string
  confirmTitle: string
  /** ActionSheet fine print (defaults to the single-part copy). */
  message?: string
  desktop: boolean
  onDone: () => void
}) {
  const removeSelected = useStore((s) => s.removeSelected)
  const classic = useContext(ClassicBody)
  const [confirm, setConfirm] = useState(false)
  // product chrome (operation simplification): 「移除」 acts at once — one undo
  // step brings it back (its wires and firmware binding too) and the toast
  // carries 〔復原〕; the classic chrome keeps its confirmation
  const removeNow = () => {
    removeSelectedWithFeedback()
    tick(16)
    onDone()
  }
  return (
    <>
      <ListGroup>
        <ListRow
          destructive
          leading={<TrashIcon size={20} />}
          title={label}
          onPress={classic ? () => setConfirm(true) : removeNow}
        />
      </ListGroup>
      <ActionSheet
        open={confirm && classic}
        onDismiss={() => setConfirm(false)}
        title={confirmTitle}
        message={message ?? t('This also disconnects it from the circuit.')}
        desktop={desktop}
        anchor="right"
        actions={[
          {
            label,
            destructive: true,
            onSelect: () => {
              removeSelected()
              tick(16)
              onDone()
            },
          },
        ]}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Wire editor
// ---------------------------------------------------------------------------

/** One net member in words (UX helper H1): 「U1 PA5（板上 A5）」, 「R1 第 1 腳」, 「導線 W3」. */
function memberText(layout: CircuitLayout, m: NetMember): string {
  if (m.kind === 'wire') return t('Wire {id}', { id: m.id })
  const comp = layout.components.find((c) => c.id === m.id)
  const entry = comp ? getEntry(comp.type) : undefined
  return entry ? pinLabel(entry, m.pin, { id: m.id }) : `${m.id} ${m.pin}`
}

/**
 * 「U1 PA6（板上 A6）、R1 第 1 腳、PRB1 探棒」 with line breaks between the
 * members only (release polish): 「PRB1 探棒」 never splits into 「PRB1 探」 / 「棒」.
 */
function MemberList({ parts }: { parts: string[] }) {
  const sep = t(', ')
  const mark = sep.trimEnd()
  return (
    <>
      {parts.map((p, k) => (
        <Fragment key={k}>
          <span className="insp-net-member">{k < parts.length - 1 ? `${p}${mark}` : p}</span>
          {k < parts.length - 1 && mark !== sep ? ' ' : null}
        </Fragment>
      ))}
    </>
  )
}

/**
 * The electrical net a wire belongs to (IN-10): every part pin and wire on
 * it, its solved voltage while the simulation runs (「—」 + how to get one
 * otherwise) and the two one-click measurements of contract K7.
 */
function WireNetGroup({ wire }: { wire: Wire }) {
  const layout = useStore((s) => s.layout)
  const running = useStore((s) => s.running)
  const index = netIndexOf(layout)
  const net = index.netOf(wire.from) ?? index.netOf(wire.to)
  const members = net ? index.members(net) : []
  const pins = members.filter((m): m is Extract<NetMember, { kind: 'pin' }> => m.kind === 'pin')
  const wires = [...new Set(members.filter((m) => m.kind === 'wire' && m.id !== wire.id).map((m) => m.id))]
  // what the net is doing (UX helper H4, ≤ 4 Hz): 「PWM 1.000 kHz · 34.0 %（平均 1.12 V）」, never one instant's 0 mV
  const live = useNetLive(net ? { net } : null)
  const reading = live ? netLiveText(live) : '—'
  // a held net (paused / core halted): the level now as the reading, what it did before under it
  const held = heldParts(live, reading)
  const note =
    reading === '—'
      ? running
        ? t('Waiting for the first reading…')
        : t('Shown once you press “▶ Run simulation” above')
      : !running
        ? t('paused (last reading)')
        : null
  const parts = [...pins.map((m) => memberText(layout, m)), ...wires.map((id) => t('Wire {id}', { id }))]
  const target: ProbeTarget | null = parseHole(wire.from)
    ? { kind: 'hole', ref: wire.from }
    : parseHole(wire.to)
      ? { kind: 'hole', ref: wire.to }
      : parseTerminalRef(wire.from)
        ? { kind: 'terminal', ref: wire.from }
        : null
  return (
    <ListGroup header={t('Net')}>
      <div className="lg-row insp-net-members" role="listitem">
        <span className="insp-net-label">{t('Connected here')}</span>
        <span className="insp-net-list">
          {parts.length > 0 ? <MemberList parts={parts} /> : t('Nothing else is connected to this wire yet')}
        </span>
      </div>
      {/* the reading under its label, like 「接在這裡的」 above (release polish): a long summary
          (「PWM 1.000 kHz · 72.5 %（平均 2.25 V）」, a held net's history) wraps between its parts
          over the card's whole width — never cut at the panel's edge */}
      <div className="lg-row insp-net-members insp-net-reading" role="listitem">
        <span className="insp-net-label">{t('Voltage')}</span>
        <span className="insp-net-v lg-tabular" translate="no" title={live ? netLiveTitle(live) : undefined}>
          {held ? held.now : <WrapParts text={reading} fit />}
        </span>
        {held && (
          <span className="insp-net-history" translate="no">
            <WrapParts text={held.before} fit />
          </span>
        )}
        {note && <span className="insp-net-note">{note}</span>}
      </div>
      {target && (
        <div className="lg-row insp-net-acts" role="listitem">
          <ChipButton onClick={() => addLogicChannelFor(target)}>
            <LogicIcon size={16} />
            {t('Add to logic analyzer')}
          </ChipButton>
          <ChipButton onClick={() => void addScopeProbeFor(target)}>
            <WaveformIcon size={16} />
            {t('Place a scope probe')}
          </ChipButton>
        </div>
      )}
    </ListGroup>
  )
}

function WireEditor({
  wire,
  desktop,
  onDone,
}: {
  wire: Wire
  desktop: boolean
  onDone: () => void
}) {
  const layout = useStore((s) => s.layout)
  const classic = useContext(ClassicBody)
  if (classic) {
    return (
      <>
        <SheetHeader
          title={t('Wire')}
          id={wire.id}
          subtitle={wire.color ? wireColorLabel(wire.color) : t('default color')}
          trailing={
            <span
              className="prs-swatch prs-swatch-lg"
              style={{ background: wireColorHex(wire.color) }}
              title={wire.color ? wireColorLabel(wire.color) : t('default')}
            />
          }
        />
        <ListGroup header={t('Endpoints')}>
          <ListRow title={t('From')} trailing={<span className="prs-mono">{wire.from}</span>} />
          <ListRow title={t('To')} trailing={<span className="prs-mono">{wire.to}</span>} />
        </ListGroup>
        <RemoveGroup
          label={t('Remove wire')}
          confirmTitle={`${wire.id} · ${t('Wire')}`}
          desktop={desktop}
          onDone={onDone}
        />
      </>
    )
  }
  // product chrome: the colour follows the net (contract C1) — the header
  // says what it means (「紅色：電源正極（5 V 網路）」), nothing to pick
  const role = wireRoleOf(layout, wire.id)
  return (
    <>
      <SheetHeader
        title={t('Wire')}
        id={wire.id}
        anchor={`insp-${wire.id}`}
        subtitle={<span className="prs-wire-role">{role.reason}</span>}
        trailing={
          <>
            <span
              className="prs-swatch prs-swatch-lg"
              style={{ background: wireColorHex(role.color) }}
              title={wireColorLabel(role.color)}
            />
            <HeaderDelete id={wire.id} wire onDone={onDone} />
          </>
        }
      />
      <WireNetGroup wire={wire} />
      <ListGroup header={t('Endpoints')}>
        <ListRow title={t('From')} trailing={<span className="insp-end">{endpointName(layout, wire.from)}</span>} />
        <ListRow title={t('To')} trailing={<span className="insp-end">{endpointName(layout, wire.to)}</span>} />
      </ListGroup>
      <RemoveGroup
        label={t('Remove wire')}
        confirmTitle={`${wire.id} · ${t('Wire')}`}
        desktop={desktop}
        onDone={onDone}
      />
    </>
  )
}
