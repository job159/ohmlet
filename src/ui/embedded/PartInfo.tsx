/**
 * Part information groups shared by the phone Properties sheet and the
 * desktop workspace inspector:
 *
 *   SupportBadge     — Full / Partial / Visual only / In development, from
 *                      supportOf(entry) (catalog honesty field)
 *   SimulationGroup  — support level + what is / is not modeled; when the
 *                      problems list has rows about this part, 「見上方 n 則問題」
 *                      leads to them (the list's 「未發現問題」 is the only
 *                      all-clear — IN-19)
 *   PinoutGroup      — CatalogEntry.pinInfo table: the pin's one name
 *                      (「PA9（板上 A9）」, UX helper H1), FT badge, the
 *                      firmware-programmed pin mode (telemetry.mcu.pinModes)
 *                      and the board hole below it, function chips (the one in
 *                      use from H10 activePinFunction — the same answer as the
 *                      logic analyzer's picker), and what the net is doing
 *                      (H4: 「PWM 1.000 kHz · 34.0 %」, 「3.10 V」, 「3.10 V（瞬時）」);
 *                      filterable; the row under the hovered board hole lights up
 *   SubcircuitGroup  — board-level elements (on-board LEDs, regulator …)
 *                      from telemetry.sub
 *
 * Everything renders from catalog data + live telemetry only; absent data
 * shows an em dash, never a placeholder value.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { ListGroup, ListRow, ChevronDownIcon, ChevronUpIcon, LogicIcon, WaveformIcon } from '../kit'
import { useStore } from '../../state/store'
import { getEntry, type CatalogEntry, type PinInfo, type SubcircuitElement, type SupportLevel } from '../../model/catalog'
import { t, useLang } from '../../i18n'
import { partSupport, pinDisplayName, pinLabel, supportLevelLabel } from '../../i18n/parts'
import { pinFunctionText, pinModeLabel, pinNameText, tc, tText } from './text'
import { fmtEng } from '../format'
import { componentPinHoles, formatHole } from '../../model/breadboard'
import { boardConfigOf } from '../../model/types'
import type { CircuitLayout, ComponentInstance, ComponentTelemetry } from '../../model/types'
import { buildNetlist } from '../../sim/netlist'
import { focusInScene } from '../workspace/scene-bridge'
import { addLogicChannelFor, addScopeProbeFor, type ProbeTarget } from './probe-actions'
import { useLab } from './lab'
import { endpointName } from '../workspace/hole-chip'
import { Term, ToggleChip, sourceHoverProps, useSourceHoverRelease } from './controls'
import { glossaryText, pinModeTerm } from './glossary'
import { useInspectorFocus, useProblems } from './problems'
import { activePinFunction, pinFunctionContext, remapActive } from './instruments/pin-function'
import { getNetLive, netLiveText, netLiveTitle } from './instruments/net-activity'
import type { NetLive } from '../../instruments/measure'
import type { UartRxInfo } from '../../sim/coordinator/api'
import { fmtBrightness, fmtReadingCurrent, fmtReadingPower, fmtReadingVoltage } from './format'
import './embedded.css'
import './inspector.css'

// ---------------------------------------------------------------------------
// Support level badge
// ---------------------------------------------------------------------------

/** English names (data); the UI shows supportLevelLabel(level) (src/i18n/parts). */
export const SUPPORT_LABELS: Record<SupportLevel, string> = {
  full: 'Full',
  partial: 'Partial',
  visual: 'Visual only',
  dev: 'In development',
}

const SUPPORT_HINTS: Record<SupportLevel, string> = {
  full: 'Fully simulated within its documented model',
  partial: 'A stated subset of its behavior is simulated',
  visual: 'Placement, wiring and netlist only — no behavior beyond its connections',
  dev: 'Under development — not simulated yet',
}

export function SupportBadge({ level, className }: { level: SupportLevel; className?: string }) {
  useLang()
  const label = supportLevelLabel(level)
  return (
    <span
      className={`emb-support is-${level} ${className ?? ''}`}
      title={t(SUPPORT_HINTS[level])}
      aria-label={t('Simulation support: {level}', { level: label })}
    >
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Simulation status + part issues
// ---------------------------------------------------------------------------

/**
 * 「見上方 n 則問題」: the part's own problem rows sit right under its header
 * (#insp-{id}, the anchor the status pill and focusInspector use too): scroll
 * the header into view and move the focus to that problems block, so the
 * keyboard continues from the problem, not from this link.
 */
function scrollToPart(componentId: string): void {
  if (typeof document === 'undefined') return
  const el = document.getElementById(`insp-${componentId}`)
  if (!el) return
  el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  const block = el.nextElementSibling
  if (block instanceof HTMLElement && block.classList.contains('insp-part-problems')) block.focus({ preventScroll: true })
}

export function SimulationGroup({ entry, componentId }: { entry: CatalogEntry; componentId: string }) {
  useLang()
  const support = partSupport(entry)
  // the problems list is the one place that says what is wrong (or 「未發現問題」): no second all-clear here
  // a board STATE (the debugger halt) is not a problem (QA IN-F3): not counted here either
  const mine = useProblems((s) => s.problems.reduce((n, p) => (!p.state && p.componentIds.includes(componentId) ? n + 1 : n), 0))
  const [open, setOpen] = useState(false)
  const hasDetail = (support.simulated?.length ?? 0) + (support.limits?.length ?? 0) > 0

  return (
    <ListGroup header={tc('Simulation', 'section')}>
      <ListRow
        title={tc('Support', 'section')}
        trailing={
          <span className="emb-row-trail">
            <SupportBadge level={support.level} />
            {hasDetail && (
              <span className="emb-disclose" aria-hidden="true">
                {open ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
              </span>
            )}
          </span>
        }
        onPress={hasDetail ? () => setOpen((o) => !o) : undefined}
      />
      {open && hasDetail && (
        <div className="lg-row emb-support-detail" role="listitem">
          {support.simulated && support.simulated.length > 0 && (
            <div className="emb-support-col">
              <span className="emb-mini-head">{t('Simulated')}</span>
              <ul>
                {support.simulated.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {support.limits && support.limits.length > 0 && (
            <div className="emb-support-col">
              <span className="emb-mini-head">{t('Not modeled')}</span>
              <ul>
                {support.limits.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {mine > 0 && (
        <ListRow
          title={mine === 1 ? t('See the problem above') : t('See the {n} problems above', { n: mine })}
          onPress={() => scrollToPart(componentId)}
        />
      )}
    </ListGroup>
  )
}

// ---------------------------------------------------------------------------
// Net index (which pins / wires share a net) — per layout identity
// ---------------------------------------------------------------------------

export type NetMember =
  | { kind: 'pin'; id: string; pin: string; ref: string }
  | { kind: 'wire'; id: string; ref: string }

export interface NetIndex {
  /** merged net of a hole / terminal ref (null: not on any net) */
  netOf(ref: string): string | null
  /** every part pin and wire end on `net` */
  members(net: string): readonly NetMember[]
}

const netIndexCache = new WeakMap<CircuitLayout, NetIndex>()

/** The layout's nets with their members (one netlist build per layout edit, then map reads). */
export function netIndexOf(layout: CircuitLayout): NetIndex {
  const hit = netIndexCache.get(layout)
  if (hit) return hit
  const netlist = buildNetlist(layout)
  const byNet = new Map<string, NetMember[]>()
  const add = (ref: string | null, m: NetMember) => {
    const net = ref ? netlist.netOf(ref) : null
    if (!net) return
    const list = byNet.get(net)
    if (list) list.push(m)
    else byNet.set(net, [m])
  }
  const board = boardConfigOf(layout)
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry) continue
    if (entry.placement === 'offboard') {
      for (const pin of entry.pins) {
        const ref = `${comp.id}:${pin}`
        add(ref, { kind: 'pin', id: comp.id, pin, ref })
      }
      continue
    }
    componentPinHoles(comp, entry, board)?.forEach((h, i) => {
      if (!h) return
      const ref = formatHole(h)
      add(ref, { kind: 'pin', id: comp.id, pin: entry.pins[i], ref })
    })
  }
  for (const w of layout.wires) {
    add(w.from, { kind: 'wire', id: w.id, ref: w.from })
    add(w.to, { kind: 'wire', id: w.id, ref: w.to })
  }
  const index: NetIndex = {
    netOf: (ref) => netlist.netOf(ref),
    members: (net) => byNet.get(net) ?? [],
  }
  netIndexCache.set(layout, index)
  return index
}

/** Is anything besides `componentId` itself (another part's pin, a wire) on the net of `ref`? */
export function refConnected(index: NetIndex, ref: string | null, componentId: string): boolean {
  const net = ref ? index.netOf(ref) : null
  if (!net) return false
  return index.members(net).some((m) => m.kind === 'wire' || m.id !== componentId)
}

// ---------------------------------------------------------------------------
// Pinout table
// ---------------------------------------------------------------------------

/** Colors by pin kind: supply rails stand out, grounds recede. */
const KIND_CLASS: Record<PinInfo['kind'], string> = {
  power: 'is-power',
  ground: 'is-ground',
  control: 'is-control',
  io: '',
  analog: '',
  input: '',
  output: '',
  passive: '',
  nc: 'is-nc',
}

/** Firmware pin modes that drive the pin (a GPIO in one of these is "in use" even when nothing is wired yet). */
const DRIVEN_MODES = new Set(['out', 'od', 'af', 'af-od'])
/** Mode tags of a board's non-GPIO pins — the pin's own name already says it (5V, GND, NRST). */
const BOARD_MODES = new Set(['pwr', 'gnd', 'rst', 'nc'])

/** "USART1_TX (remap)" → { periph: 'USART1', remap: true } */
function fnPeripheral(fn: string): { periph: string; remap: boolean } {
  const remap = / \(remap\)$/.test(fn)
  const base = fn.replace(/ \(remap\)$/, '')
  return { periph: base.split('_')[0], remap }
}

/**
 * How a pin function chip reads (IN-7 / IN-20): 'active' — the function UX
 * helper H10 (activePinFunction) says the pin carries, the very answer the
 * logic analyzer's channel picker gives; 'possible' — the pin is in
 * alternate-function mode but the peripheral behind it cannot be told
 * (H10 never guesses); 'dim' — not that function, or the pin is not in AF
 * mode (GPIO / analog: the functions are just what it could do). `active` is
 * activePinFunction(functions, mode, pinFunctionContext(<the board's MCU
 * frame>)) and `mapr` that context's AFIO_MAPR (undefined = not reported:
 * the reset mapping), so a remapped function reads as the picker names it.
 */
export function pinFunctionChipState(
  fn: string,
  mode: string | undefined,
  active: string | null,
  enabledUarts: ReadonlySet<string>,
  mapr: number | undefined,
): 'active' | 'possible' | 'dim' | 'plain' {
  if (mode === undefined) return 'plain'
  if (mode !== 'af' && mode !== 'af-od') return 'dim'
  const { periph, remap } = fnPeripheral(fn)
  // H10 names the function without the catalog's ' (remap)' tag ('USART1_TX' for 'USART1_TX (remap)')
  if (active !== null) return fn.replace(/ \(remap\)$/, '') === active ? 'active' : 'dim'
  // an enabled USART is on this pin in the reset mapping, or where a known AFIO_MAPR puts it (H10's facts)
  const onThisPin = mapr === undefined ? !remap : remap === remapActive(fn, mapr)
  if (/^U(S)?ART\d$/.test(periph)) return enabledUarts.has(periph) && onThisPin ? 'active' : 'dim'
  if (/^ADC/.test(periph)) return 'dim'
  return 'possible'
}

// ---------------------------------------------------------------------------
// Long live statements (release polish): readable whole, never cut at the edge
// ---------------------------------------------------------------------------

/**
 * A live statement that wraps only between its 「 · 」 parts (release polish):
 * 「PWM 1.000 kHz ·」 / 「72.5 %（平均 2.25 V）」 — a number never loses its unit
 * to the next line, and nothing runs past the card's edge or hides behind an
 * ellipsis. Default: each part is a no-wrap span (the pin rows' setting
 * 「方波 100 Hz ·」 / 「0–5.00 V」). `fit`: each part is an inline block that
 * wraps inside itself only when it is wider than the whole line (the wire
 * card's 17 px reading in a 280 px panel).
 */
export function WrapParts({ text, fit = false }: { text: string; fit?: boolean }) {
  const parts = text.split(' · ')
  if (parts.length < 2) return <>{text}</>
  return (
    <>
      {parts.map((part, k) => (
        <Fragment key={k}>
          <span className={fit ? 'insp-part-fit' : undefined} style={fit ? undefined : { whiteSpace: 'nowrap' }}>
            {k < parts.length - 1 ? `${part} ·` : part}
          </span>
          {k < parts.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </>
  )
}

/**
 * A held moving net's summary (H4 netLiveText, QA MEASURE-COHERENCE) in its
 * two parts (release polish): the level NOW, 「目前 低（105 mV）」 — the value
 * slot — and what the signal did before, 「核心停住前：有訊號變化」 — a line of
 * its own under the row, so the whole statement is readable in a narrow
 * panel. null for anything that is not a held pwm / toggling net.
 */
export function heldParts(live: NetLive | null | undefined, text: string): { now: string; before: string } | null {
  if (!live || (live.kind !== 'pwm' && live.kind !== 'toggling') || !live.held) return null
  const cut = text.indexOf(' · ')
  return cut > 0 ? { now: text.slice(0, cut), before: text.slice(cut + 3).trim() } : null
}

/**
 * The RX port pins ('PA10', or a remapped 'PB7') the UART terminal's USB-TTL
 * adapter is plugged into right now (McuFrameInfo.uartRx[].attached — it
 * idles the pin at 3.3 V between frames), as one string: a useLab selector
 * on it re-renders only when the set changes, never per frame.
 */
export function adapterRxPins(rx: readonly UartRxInfo[] | undefined): string {
  if (!rx) return ''
  let key = ''
  for (const u of rx) if (u.attached) key += `${key ? '\n' : ''}${u.pin}`
  return key
}

/** The probe target of a pin row: an MCU GPIO channel, an off-board terminal, or the pin's hole. */
function probeTargetOf(comp: ComponentInstance, entry: CatalogEntry, pin: string, hole: string | null): ProbeTarget | null {
  if (entry.mcu?.pinMap[pin]) return { kind: 'mcu-pin', componentId: comp.id, pin }
  if (entry.placement === 'offboard') return { kind: 'terminal', ref: `${comp.id}:${pin}` }
  return hole ? { kind: 'hole', ref: hole } : null
}

/** ⎍ / ∿ — add the pin to the logic analyzer, place a scope probe on its net (contract K7). */
export function PinProbeButtons({ target, name }: { target: ProbeTarget | null; name: string }) {
  if (!target) return null
  return (
    <span className="insp-pin-acts">
      <button
        type="button"
        className="insp-pin-act lg-pressable"
        aria-label={t('Add {pin} to the logic analyzer', { pin: name })}
        title={t('Add {pin} to the logic analyzer', { pin: name })}
        onClick={(e) => {
          e.stopPropagation()
          addLogicChannelFor(target)
        }}
      >
        <LogicIcon size={18} />
      </button>
      <button
        type="button"
        className="insp-pin-act lg-pressable"
        aria-label={t('Place a scope probe on {pin}', { pin: name })}
        title={t('Place a scope probe on {pin}', { pin: name })}
        onClick={(e) => {
          e.stopPropagation()
          void addScopeProbeFor(target)
        }}
      >
        <WaveformIcon size={18} />
      </button>
    </span>
  )
}

export function PinoutGroup({
  comp,
  entry,
  tele,
  variant = 'full',
}: {
  comp: ComponentInstance
  entry: CatalogEntry
  tele: ComponentTelemetry | undefined
  /**
   * 'full'   — every pin, the search field and 「只看有接線的腳」
   * 'in-use' — 「使用中的腳位」: pins wired to something or driven by the firmware
   */
  variant?: 'full' | 'in-use'
}) {
  // board-aware (module-2+ / board-row-2+ parts must still resolve)
  const layout = useStore((s) => s.layout)
  const hoverHole = useStore((s) => s.hoverHole)
  const uarts = useLab((s) => s.mcus[comp.id]?.uarts)
  // AFIO_MAPR as the firmware programmed it (a number: re-renders only when it changes)
  const mapr = useLab((s) => s.mcus[comp.id]?.mapr)
  // the RX pins the UART terminal's adapter drives (a string: re-renders only when the set changes)
  const adapterKey = useLab((s) => adapterRxPins(s.mcus[comp.id]?.uartRx))
  const [filter, setFilter] = useState('')
  const [wiredOnly, setWiredOnly] = useState(false)
  // focusInspector(id, { pin }) (the probe menu's 「在屬性面板查看這支腳」): light that row up for a moment
  const focus = useInspectorFocus((s) => s.request)
  const [flash, setFlash] = useState<string | null>(null)
  // a row under the mouse marks its hole on the board (H7 highlightSource); cleared if the list goes away under it
  useSourceHoverRelease()
  useEffect(() => {
    if (!focus?.pin || focus.componentId !== comp.id) return
    setFilter('')
    setWiredOnly(false)
    setFlash(focus.pin)
    const h = setTimeout(() => setFlash(null), 1800)
    return () => clearTimeout(h)
  }, [focus, comp.id])
  useLang()

  const holes = useMemo(() => componentPinHoles(comp, entry, boardConfigOf(layout)), [comp, entry, layout])
  const index = useMemo(() => netIndexOf(layout), [layout])
  const infoByPin = useMemo(() => {
    const m = new Map<string, PinInfo>()
    for (const p of entry.pinInfo ?? []) m.set(p.pin, p)
    return m
  }, [entry])
  const enabledUarts = useMemo(() => new Set((uarts ?? []).filter((u) => u.config.enabled).map((u) => u.name)), [uarts])
  // H10's context: the very facts the logic analyzer's channel picker passes (remapped functions included)
  const pfc = useMemo(() => pinFunctionContext({ uarts, mapr }), [uarts, mapr])

  const pinModes = tele?.mcu?.pinModes
  const q = filter.trim().toLowerCase()
  const showNum = entry.placement === 'dip' || entry.placement === 'footprint'
  const inUseView = variant === 'in-use'

  const adapterPins = adapterKey ? new Set(adapterKey.split('\n')) : null
  const rows = entry.pins
    .map((pin, i) => {
      const info = infoByPin.get(pin)
      const h = holes?.[i] ?? null
      const ref = entry.placement === 'offboard' ? `${comp.id}:${pin}` : h ? formatHole(h) : null
      const mode = pinModes?.[pin]
      const wired = refConnected(index, ref, comp.id)
      // the terminal's adapter drives this RX pin (close-sim UART-RX): in use even without a wire
      const port = entry.mcu?.pinMap[pin]
      const byAdapter = !!port && !!adapterPins?.has(port)
      return { pin, i, info, ref, mode, wired, byAdapter, used: wired || byAdapter || (mode !== undefined && DRIVEN_MODES.has(mode)) }
    })
    .filter(({ pin, info, ref, used, wired }) => {
      if (inUseView) return used && info?.kind !== 'nc'
      if (wiredOnly && !wired) return false
      if (q === '') return true
      const port = entry.mcu?.pinMap[pin] ?? ''
      if (pin.toLowerCase().includes(q) || port.toLowerCase().includes(q) || (ref ?? '').toLowerCase() === q) return true
      if (info?.label?.toLowerCase().includes(q)) return true
      if (pinNameText(info?.label ?? pin).toLowerCase().includes(q)) return true
      return info?.functions?.some((f) => f.toLowerCase().includes(q)) ?? false
    })

  const total = entry.pins.length
  return (
    <ListGroup
      header={inUseView ? t('Pins in use') : t('Pinout')}
      footer={
        inUseView ? undefined : pinModes ? (
          <span className="insp-pin-legend">
            {t('Mode = how the firmware set up the pin:')} <Term id="push-pull">{pinModeLabel('out')}</Term>{' '}
            <Term id="open-drain">{pinModeLabel('od')}</Term> <Term id="af">{pinModeLabel('af')}</Term>{' '}
            <Term id="pull">{pinModeLabel('in↑')}</Term> <Term id="floating">{pinModeLabel('in')}</Term>
            {entry.pinInfo?.some((p) => p.ft) && (
              <>
                {' '}
                <Term id="ft">FT</Term>
              </>
            )}
          </span>
        ) : holes === null && entry.placement !== 'offboard' ? (
          t('Placement is incomplete or invalid for this part.')
        ) : undefined
      }
    >
      {!inUseView && total > 8 && (
        <div className="lg-row emb-pin-filter insp-pin-filter" role="listitem">
          <input
            className="emb-field"
            type="search"
            placeholder={t('Filter pins — A5, USART1, SPI…')}
            aria-label={t('Filter pins')}
            value={filter}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="none"
            onChange={(e) => setFilter(e.target.value)}
          />
          <ToggleChip pressed={wiredOnly} onChange={setWiredOnly} title={t('Only pins that are wired to something')}>
            {t('Wired pins only')}
          </ToggleChip>
        </div>
      )}
      {rows.length === 0 && (
        <div className="lg-row" role="listitem">
          <span className="lg-caption">
            {inUseView
              ? t('No pin is wired or driven yet.')
              : q
                ? t('No pin matches “{q}”', { q: filter.trim() })
                : t('No pin is wired yet.')}
          </span>
        </div>
      )}
      {rows.map(({ pin, i, info, ref, mode, byAdapter }) => {
        // the pin's ONE name (UX helper H1): 「PA9（板上 A9）」, 「3V3（板上 3.3）」, 「陽極（長腳）」
        const name = pinLabel(entry, pin)
        const hot = (hoverHole != null && ref === hoverHole) || flash === pin
        const target = probeTargetOf(comp, entry, pin, entry.placement === 'offboard' ? null : ref)
        const active = mode && info?.functions ? activePinFunction(info.functions, mode, pfc) : null
        // what the net is doing (UX helper H4): a PWM reads as PWM, never as one instant's 「0 mV」;
        // an off-board terminal without a wire has no net to read (QA IN-F4: 「未接線」, no 「0 V」)
        const unwiredTerminal = entry.placement === 'offboard' && ref !== null && !terminalWired(layout, ref)
        const live = tele && !unwiredTerminal ? getNetLive({ componentId: comp.id, pin }) : null
        const value = live ? netLiveText(live, { form: 'compact' }) : ''
        const instantaneous = live?.kind === 'unknown' && live.v !== null
        const valueTitle = live ? `${netLiveText(live)} — ${netLiveTitle(live)}` : undefined
        // a held net (paused / core halted): the level now beside the name, its history on a line of its own
        const held = heldParts(live, value)
        const showMode = !!mode && !BOARD_MODES.has(mode)
        return (
          <div
            key={pin}
            id={`pin-${comp.id}-${pin}`}
            className={`emb-pin ${hot ? 'is-hot' : ''}`}
            role="listitem"
            title={info?.note ? tText(info.note) : undefined}
            {...sourceHoverProps(ref ? { holes: [ref] } : null)}
          >
            {showNum && <span className="emb-pin-num lg-tabular">{i + 1}</span>}
            <span className="emb-pin-main">
              <span className="emb-pin-line insp-pin-line">
                <span className="insp-pin-id">
                  <span className={`emb-pin-label insp-pin-name ${info ? KIND_CLASS[info.kind] : ''}`}>{name}</span>
                  {info?.ft && (
                    <span className="emb-tag is-ft" title={glossaryText('ft').body}>
                      FT
                    </span>
                  )}
                </span>
                <span className="insp-pin-right">
                  <span
                    className={`emb-pin-v lg-tabular ${live?.kind === 'pwm' || live?.kind === 'toggling' || live?.kind === 'source' ? 'is-signal' : ''}`}
                    title={valueTitle}
                  >
                    {held ? held.now : value === '—' ? '' : value}
                    {instantaneous && <span className="insp-pin-instant">{t('instantaneous|reading')}</span>}
                  </span>
                  <PinProbeButtons target={target} name={pinLabel(entry, pin, { id: comp.id })} />
                </span>
              </span>
              {held && (
                <span className="insp-pin-history" title={valueTitle}>
                  <WrapParts text={held.before} fit />
                </span>
              )}
              {byAdapter && (
                <span className="insp-pin-history is-adapter">{t('Driven by the UART terminal’s USB-TTL adapter (3.3 V)')}</span>
              )}
              {(showMode || ref) && (
                <span className="emb-pin-line insp-pin-sub">
                  {showMode && (
                    <span
                      className="emb-tag is-mode"
                      title={`${t('Pin mode programmed by firmware: {mode}', { mode: tc(mode!, 'pin-mode-long') })}${
                        pinModeTerm(mode!) ? ` — ${glossaryText(pinModeTerm(mode!)!).body}` : ''
                      }`}
                    >
                      {pinModeLabel(mode!)}
                    </span>
                  )}
                  {ref && entry.placement !== 'offboard' ? (
                    <button
                      type="button"
                      className="emb-pin-hole emb-mono insp-pin-hole"
                      title={t('Show {pin} on the board', { pin: pinLabel(entry, pin, { id: comp.id }) })}
                      onClick={() => focusInScene({ holes: [ref] }, { kind: 'guide' })}
                    >
                      {ref}
                    </button>
                  ) : entry.placement === 'offboard' && ref ? (
                    // an off-board terminal: where its wire goes (UX helper H2), never "BT1:+" (QA IN-F4)
                    <span className="emb-pin-hole insp-pin-dest" title={terminalDestination(layout, ref)}>
                      {terminalDestination(layout, ref)}
                    </span>
                  ) : (
                    <span className="emb-pin-hole emb-mono">{ref ?? '—'}</span>
                  )}
                </span>
              )}
              {info?.functions && info.functions.length > 0 && (
                <span className="emb-pin-fns">
                  {info.functions.map((f) => {
                    const st = pinFunctionChipState(f, mode, active, enabledUarts, pfc.mapr)
                    return (
                      <span
                        key={f}
                        className={`emb-fn ${st === 'active' ? 'is-active' : st === 'possible' ? 'is-possible' : st === 'dim' ? 'is-dim' : ''}`}
                        title={st === 'active' ? t('In use by the firmware') : st === 'possible' ? t('The pin is in alternate-function mode: possibly this one') : undefined}
                      >
                        {pinFunctionText(f)}
                      </span>
                    )
                  })}
                </span>
              )}
            </span>
          </div>
        )
      })}
    </ListGroup>
  )
}

// ---------------------------------------------------------------------------
// Board-level sub-circuit telemetry (on-board LEDs, regulator, pull-ups)
// ---------------------------------------------------------------------------

export function SubcircuitGroup({
  entry,
  tele,
}: {
  entry: CatalogEntry
  tele: ComponentTelemetry | undefined
}) {
  useLang()
  const elements = entry.subcircuit ?? []
  if (elements.length === 0) return null
  const supply = entry.supplyPins?.plus ?? []
  return (
    <ListGroup header={t('On-board')} footer={tele ? undefined : t('Run the simulation to see live values.')}>
      {supply.map((pin) => (
        <ListRow
          key={`v:${pin}`}
          title={t('{pin} pin', { pin: pinLabel(entry, pin) })}
          trailing={<span className="emb-mono lg-tabular">{fmtReadingVoltage(tele?.pinVoltages?.[pin])}</span>}
        />
      ))}
      {elements.map((el) => {
        const st = tele?.sub?.[el.id]
        let value = '—'
        if (st) {
          if (st.ledBrightness !== undefined) {
            value = fmtBrightness(st.ledBrightness)
          } else if (st.current !== undefined) {
            value = fmtReadingCurrent(st.current)
            if (st.power !== undefined) value += ` · ${fmtReadingPower(st.power, st.current)}`
          }
        }
        return (
          <ListRow
            key={el.id}
            // a readable name first (「PC13 板載 LED」), the element id as a small tag (QA IN-F5)
            title={
              <span className="insp-sub-title">
                <span className="insp-sub-name">{subcircuitName(entry, el)}</span>
                <span className="insp-sub-id emb-mono" translate="no">
                  {el.id}
                </span>
              </span>
            }
            trailing={<span className="emb-mono lg-tabular">{value}</span>}
          />
        )
      })}
    </ListGroup>
  )
}

/** A nominal catalog value with its unit (the app's engineering format): 510 Ω, 10 kΩ, 3.3 V — never a guess. */
function nominal(v: unknown, unit: string): string | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? fmtEng(v, unit) : null
}

/** 「板載電阻」, 「板載 NPN 電晶體」 (a Latin word after Chinese text gets a space). */
function onBoard(model: string): string {
  return t('On-board {model}', { model: tc(model, 'model') }).replace(/([㐀-鿿])(?=[A-Za-z0-9])/g, '$1 ')
}

/**
 * The name of an on-board element as a person reads it (QA IN-F5), its
 * values taken from the catalog params: the Blue Pill's REG 「3.3 V 穩壓器
 * （LDO）」, LED_PWR 「電源指示 LED」, R_PWR 「電源 LED 限流電阻」, LED_PC13
 * 「PC13 板載 LED」, R_PC13 「PC13 LED 限流電阻（510 Ω）」, R_USB_DP 「USB D+
 * 上拉電阻（10 kΩ）」 (the real board's 10 kΩ R10); anything else 「板載 {元件}」.
 */
export function subcircuitName(entry: CatalogEntry, el: SubcircuitElement): string {
  const params = el.params ?? {}
  if (entry.type === 'stm32_bluepill') {
    const r = nominal(params.resistance, 'Ω')
    const vout = nominal(params.vout, 'V')
    switch (el.id) {
      case 'REG':
        return vout ? t('{v} regulator (LDO)', { v: vout }) : onBoard(el.model)
      case 'LED_PWR':
        return t('Power indicator LED')
      case 'R_PWR':
        return t('Power LED current-limiting resistor')
      case 'LED_PC13':
        return t('PC13 on-board LED')
      case 'R_PC13':
        return r ? t('PC13 LED current-limiting resistor ({r})', { r }) : t('PC13 LED current-limiting resistor')
      case 'R_USB_DP':
        return r ? t('USB D+ pull-up resistor ({r})', { r }) : t('USB D+ pull-up resistor')
    }
  }
  return onBoard(el.model)
}

/** Does a wire end on off-board terminal `ref` ("PS1:+")? (Unwired: its node reads nothing worth showing.) */
export function terminalWired(layout: CircuitLayout, ref: string): boolean {
  return layout.wires.some((w) => w.from === ref || w.to === ref)
}

/**
 * Where an off-board terminal's wire goes (QA IN-F4), named as a person reads
 * it (UX helper H2 endpointName): 「→ 下方 + 電源軌 第 0 孔」, 「→ a25（U1 PA0
 * 這一排） 等 2 處」 for several wires (n counts them all), 「未接線」 without one.
 */
export function terminalDestination(layout: CircuitLayout, ref: string): string {
  const ends: string[] = []
  for (const w of layout.wires) {
    if (w.from === ref && w.to !== ref) ends.push(w.to)
    else if (w.to === ref && w.from !== ref) ends.push(w.from)
  }
  if (ends.length === 0) return t('not wired|terminal')
  const first = t('→ {where}', { where: endpointName(layout, ends[0]) })
  return ends.length > 1 ? t('{first} and {n} more places', { first, n: ends.length }) : first
}
