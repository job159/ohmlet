/**
 * FlowToggle — the 「顯示電流」 checkbox chip beside the run capsule
 * (owner: flow; contract C2 — src/ui/fx/flow.ts useFlowView).
 *
 * Product chrome only (the classic chrome keeps its original top bar and,
 * having no control for it, shows no dots from the stored preference —
 * applyFlowChrome in src/ui/fx/flow.ts; the flow layer itself still works
 * there when useFlowView is set programmatically). Shown while a simulation session exists (run phase ≠
 * idle), right of the capsule: the full chip (☑ 顯示電流) when there is
 * room, a short one (☑ 電流) on a phone (see the placement note below). The
 * preference is remembered ('bb.flow') and also lives in 更多 → 模擬
 * (FlowViewRow) and on Shift+C (product chrome; a plain C picks up a
 * capacitor — part-keys.ts, whose App.tsx branch toggles this view).
 *
 * Feedback is honest: the first time the dots can be SEEN (the view on while
 * the simulation runs), a toast gives the legend
 * 「光點越快越密＝電流越大，方向＝由正到負」 (the dots have one colour:
 * magnitude is speed and density only). Turned on while the simulation is
 * paused or not started (the chip, the 更多 row or the key), the toast says
 * the currents appear once it runs (「模擬繼續後」 after the learner's pause,
 * else 「模擬執行時」 — auto-run starts every circuit, so no Run button is
 * named; they are measured only while it runs — nothing is invented
 * meanwhile) and the legend waits for that run — on a phone there is no
 * tooltip, so the toast is where the legend is learnt.
 *
 * Material: Tier-S (the UndoPill recipe, NO backdrop-filter). Placement is
 * CSS-anchored to the capsule's own centre (50 % / the workspace's free
 * column) plus half its measured width, so the chip glides with it; the
 * width is measured only when the capsule resizes (ResizeObserver) or the
 * window does — never per frame. Where the full label does not fit (a
 * phone), the chip keeps a visible short label (☑ 電流); where even that
 * does not fit (a capsule that shows 倍速), the 40 px chip stacks the box
 * over a small 「電流」 — never an unlabelled box.
 *
 * Honest about what it cannot show: a circuit whose current loop the
 * simulation cannot close (SimTelemetry.flowConcealed — e.g. a legacy chip
 * fed through a resistor) shows no dots there, and once per run, while the
 * view is on, a toast names it: 「U1 的電流迴路無法完整追蹤，暫不顯示它的光點」
 * (watchFlowConcealed — a store subscription, no per-frame React work).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { CheckIcon, ListRow, Switch, showToast, tick } from '../kit'
import { t, useLang } from '../../i18n'
import { useFlowView } from '../fx/flow'
import { useStore } from '../../state/store'
import { getEntry } from '../../model/catalog'
import type { CircuitLayout } from '../../model/types'
import { useLegacyChrome, isLegacyChrome } from './legacy'
import { getSimPhase, useSimPhase } from './run-control'
import { SHORTCUTS, withKey, type ShortcutId, type ShortcutRow } from './ShortcutsSheet'
import './FlowToggle.css'

/** The key that flips 顯示電流 (product chrome). */
export const FLOW_KEY = 'Shift+C'
/** SHORTCUTS id of the key (listed by the shortcuts sheet once the table has it). */
const FLOW_SHORTCUT = 'current-flow'
/** localStorage: the legend toast was shown once. */
const LS_FLOW_HINT = 'bb.flowHint'
/** gap between the capsule and the chip (px) */
const GAP = 8
/** the screen edge margin the chip keeps (px) */
const EDGE = 8
/** compact chip width (px, FlowToggle.css) */
const COMPACT_W = 40
/** the chip's box + paddings around a label (px): 9 + 17 + 7 + … + 12, FlowToggle.css */
const LABEL_PAD = 46
/** how long the 「無法完整追蹤」 note stays (ms) */
const CONCEALED_MS = 5200
/**
 * The 40 px chip (no room beside the capsule even for ☑ 電流 — a capsule that
 * shows 倍速 on a 375 px phone) keeps its words: the box over a small 「電流」,
 * the dock's icon-over-label pattern — never an unlabelled □⚡ (P2).
 */
const STACK_STYLE: CSSProperties = { flexDirection: 'column', gap: 2 }
const STACK_LABEL_STYLE: CSSProperties = { fontSize: 10, lineHeight: '11px', letterSpacing: 0 }

/** The legend (one sentence, the same in the tooltip, the toast and the More row). */
export function flowLegend(): string {
  return t('Faster, denser dots = more current; direction = from + to −')
}

/** title + aria-keyshortcuts of the chip (the shared table once it lists the key). */
function chipTitle(): { title: string; ariaKeyshortcuts?: string } {
  const label = t('Show current')
  const listed = (SHORTCUTS as Readonly<Record<string, ShortcutRow>>)[FLOW_SHORTCUT]
  const k = listed
    ? withKey(label, FLOW_SHORTCUT as ShortcutId)
    : isLegacyChrome()
      ? { title: label }
      : { title: t('{label} ({keys})', { label, keys: FLOW_KEY }), ariaKeyshortcuts: FLOW_KEY }
  return { title: `${k.title} — ${flowLegend()}`, ariaKeyshortcuts: k.ariaKeyshortcuts }
}

/**
 * Flip the preference with honest feedback (the chip, the More row, the key).
 * `announce`: also say on / off in a toast (the key — the chip may be hidden).
 */
export function toggleFlowView(announce = false): void {
  const s = useFlowView.getState()
  const on = !s.visible
  s.setVisible(on)
  tick(on ? 12 : 8)
  if (!on) {
    if (announce) showToast(t('Current flow hidden'))
    return
  }
  const phase = getSimPhase()
  if (phase !== 'running') {
    // currents are measured only while the simulation runs — none to show
    // yet; the legend waits for the run (FlowToggle's effect). Auto-run
    // starts every circuit by itself, so the toast sends nobody to a Run
    // button: a pause the learner made resumes, anything else just runs
    showToast(
      phase === 'paused'
        ? t('Current flow on — resume the simulation to see it|autosim')
        : t('Current flow on — the dots show while the simulation runs|autosim'),
      { duration: 3200 },
    )
    return
  }
  showFlowLegend(announce)
}

/**
 * The legend toast: once ever ('bb.flowHint'), or always when `force` (the
 * key's on / off announcement). Only while the dots can be seen — callers
 * check that the simulation runs. True = shown now.
 */
export function showFlowLegend(force = false): boolean {
  let first = false
  try {
    first = window.localStorage.getItem(LS_FLOW_HINT) !== '1'
  } catch {
    first = false
  }
  if (!first && !force) return false
  showToast(t('Show current: {legend}', { legend: flowLegend() }), { duration: 4200 })
  try {
    window.localStorage.setItem(LS_FLOW_HINT, '1')
  } catch {
    /* private window: the legend may show again next time */
  }
  return true
}

/**
 * The parts a telemetry's flowConcealed names in the note: the chips at its
 * head (the cause — their output current has no honest return path), else
 * its first part. At most 3.
 */
export function concealedNames(concealed: readonly string[] | undefined, layout: CircuitLayout): string[] {
  if (!concealed || concealed.length === 0) return []
  const isChip = (id: string) => getEntry(layout.components.find((c) => c.id === id)?.type ?? '')?.sim.kind === 'chip'
  const roots: string[] = []
  for (const id of concealed) {
    if (!isChip(id)) break
    roots.push(id)
  }
  return (roots.length > 0 ? roots : [concealed[0]]).slice(0, 3)
}

/** 「U1 的電流迴路無法完整追蹤，暫不顯示它的光點」 (one part) / 「U1、U2 的…它們的光點」; null for none. */
export function flowConcealedNote(names: readonly string[]): string | null {
  if (names.length === 0) return null
  if (names.length === 1) return t('The current loop of {id} cannot be traced completely — its dots are hidden for now', { id: names[0] })
  return t('The current loops of {ids} cannot be traced completely — their dots are hidden for now', { ids: names.join(t(', |flow-list')) })
}

/**
 * Watch the store's telemetry (its ≤ 10 Hz React push) for loops the
 * simulation cannot close while the view is on and the simulation runs: one
 * toast per set of named parts per call (FlowToggle calls it once per
 * simulation session). Returns the unsubscribe.
 */
export function watchFlowConcealed(): () => void {
  const said = new Set<string>()
  return useStore.subscribe((s, prev) => {
    if (s.telemetry === prev.telemetry || !s.running || !s.telemetry?.flowConcealed) return
    if (!useFlowView.getState().visible) return
    const names = concealedNames(s.telemetry.flowConcealed, s.layout)
    const key = names.join(',')
    if (names.length === 0 || said.has(key)) return
    said.add(key)
    const note = flowConcealedNote(names)
    if (note) showToast(note, { duration: CONCEALED_MS })
  })
}

/** Once per simulation session (product chrome): the 「無法完整追蹤」 note. */
function useFlowConcealedNote(enabled: boolean): void {
  useEffect(() => (enabled ? watchFlowConcealed() : undefined), [enabled])
}

/** The first run with the view on shows the legend (turned on while paused / before a run). */
function useFlowLegendOnRun(enabled: boolean, visible: boolean, running: boolean): void {
  useEffect(() => {
    if (enabled && visible && running) showFlowLegend(false)
  }, [enabled, visible, running])
}

/**
 * half the capsule's width + how the chip fits beside it: 'full' (☑ 顯示電流),
 * 'short' (☑ 電流 — a phone), 'compact' (the box + a bolt), 'below' (the
 * right edge under it).
 */
type Spot = { half: number; mode: 'full' | 'short' | 'compact' | 'below' } | null

/** Measure the capsule's collapsed first line against the window (`full` / `short`: the chip widths with each label). */
function measure(full: number, short: number): Spot {
  if (typeof document === 'undefined') return null
  const pill = document.querySelector<HTMLElement>('.lg-capsule-wrap .lg-capsule:not(.is-expanded)')
  const r = pill?.getBoundingClientRect()
  if (!r || r.width === 0) return null
  const vw = window.innerWidth
  const half = Math.round(r.width / 2)
  if (r.right + GAP + full + EDGE <= vw) return { half, mode: 'full' }
  if (r.right + GAP + short + EDGE <= vw) return { half, mode: 'short' }
  if (r.right + GAP + COMPACT_W + EDGE <= vw) return { half, mode: 'compact' }
  return { half, mode: 'below' }
}

export function FlowToggle() {
  const legacy = useLegacyChrome()
  const phase = useSimPhase()
  const visible = useFlowView((s) => s.visible)
  useLang()
  useFlowLegendOnRun(!legacy, visible, phase === 'running')
  const session = phase !== 'idle'
  const show = !legacy && session
  useFlowConcealedNote(show)

  const fullRef = useRef<HTMLSpanElement | null>(null)
  const shortRef = useRef<HTMLSpanElement | null>(null)
  const [spot, setSpot] = useState<Spot>(null)
  useLayoutEffect(() => {
    if (!show) return
    const wrap = document.querySelector('.lg-capsule-wrap')
    let raf = 0
    const place = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const full = (fullRef.current?.offsetWidth ?? 0) + LABEL_PAD // box + paddings around the label
        const short = (shortRef.current?.offsetWidth ?? 0) + LABEL_PAD
        const next = measure(Math.max(full, 112), Math.max(short, 64))
        setSpot((prev) => (prev && next && prev.half === next.half && prev.mode === next.mode ? prev : next))
      })
    }
    place()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    if (ro && wrap) {
      ro.observe(wrap)
      for (const el of Array.from(wrap.querySelectorAll('.lg-capsule'))) ro.observe(el)
    }
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [show])

  if (!show) return null
  const { title, ariaKeyshortcuts } = chipTitle()
  // the 40 px chip where not even ☑ 電流 fits beside the capsule (a 倍速 capsule on a phone): box over 「電流」
  const compact = spot != null && (spot.mode === 'compact' || spot.mode === 'below')
  const short = spot?.mode === 'short'
  const style = (spot ? { '--app-flow-half': `${spot.half}px`, ...(compact ? STACK_STYLE : null) } : { visibility: 'hidden' }) as CSSProperties
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={visible}
      aria-label={t('Show current')}
      aria-keyshortcuts={ariaKeyshortcuts}
      title={title}
      data-scene-avoid=""
      className={`app-flow-chip lg-rim${visible ? ' is-on' : ''}${compact ? ' is-compact' : ''}${spot?.mode === 'below' ? ' is-below' : ''}${phase === 'running' ? ' is-running' : ''}`}
      style={style}
      onClick={(e) => {
        toggleFlowView(false)
        // keyboard users keep focus; a pointer click must not leave a focus ring on the chip
        if (e.detail > 0) (e.currentTarget as HTMLButtonElement).blur()
      }}
    >
      <span className="app-flow-box" aria-hidden="true">
        {visible ? <CheckIcon size={13} /> : null}
      </span>
      {compact ? (
        <span className="app-flow-label" aria-hidden="true" style={STACK_LABEL_STYLE}>
          {t('Current|flow-chip')}
        </span>
      ) : (
        <span className="app-flow-label" aria-hidden="true">
          {short ? t('Current|flow-chip') : t('Show current')}
        </span>
      )}
      {/* hidden measurers: the two labels' widths decide full / short / compact */}
      <span ref={fullRef} className="app-flow-label app-flow-measure" aria-hidden="true">
        {t('Show current')}
      </span>
      <span ref={shortRef} className="app-flow-label app-flow-measure" aria-hidden="true">
        {t('Current|flow-chip')}
      </span>
    </button>
  )
}

/** 更多 → 模擬: the same preference as a switch row (product chrome). */
export function FlowViewRow() {
  const visible = useFlowView((s) => s.visible)
  useLang()
  return (
    <ListRow
      title={t('Show current')}
      subtitle={t('While the simulation runs, moving dots show the current: {legend}', { legend: flowLegend() })}
      trailing={<Switch checked={visible} onChange={(on) => on !== useFlowView.getState().visible && toggleFlowView(false)} aria-label={t('Show current')} />}
    />
  )
}
