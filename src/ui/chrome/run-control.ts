/**
 * Run control (UX wave contract K2 — SH-1 / IN-2): the ONE place that knows
 * how "run", "pause" and "resume a debugger halt" map onto the two stores.
 *
 *   useSimPhase(): 'idle' | 'running' | 'paused' | 'halted' | 'fault'
 *     fault   — an MCU in the circuit is locked up (lab mcus state 'lockup')
 *     halted  — an MCU is stopped by the debugger (state 'halted'); the
 *               coordinator freezes the whole world on it
 *     running — store.running
 *     paused  — !running && simTime > 0
 *     idle    — !running && simTime === 0 (nothing has run yet)
 *   (first match wins in that order, so a lockup never reads as "running")
 *
 *   runOrResume() — resume every debugger-halted MCU (lab.mcuResume, which
 *     also restarts the world the halt froze) AND start the simulation;
 *     the capsule / Space / F5 / the MCU panel's "▶ 繼續執行" all use it.
 *   toggleRun()   — halted → runOrResume(); running → stopSim(); otherwise
 *     startSim(). The capsule tap and the Space key.
 *
 *   STATE_TONE / stateColor(state) — the one state → colour table (UX
 *     helper H6) for the capsule, the status pill and the MCU badge.
 *
 * MCU states come from the lab's ≤ 10 Hz frame snapshot (useLab.mcus),
 * filtered to the boards that are in the current layout so a deleted
 * board's last frame never decides the phase. useSimPhase() re-renders only
 * when the phase value changes (primitive selectors). Callers add their own
 * haptic tick() — these functions have no UI side effects.
 */
import { useMemo } from 'react'
import { getEntry } from '../../model/catalog'
import type { CircuitLayout } from '../../model/types'
import type { McuFrameInfo } from '../../sim/coordinator/api'
import { useStore } from '../../state/store'
import { useLab } from '../embedded/lab'

export type SimPhase = 'idle' | 'running' | 'paused' | 'halted' | 'fault'

/** MCU board ids in `layout` (cached per layout identity — selectors call this at 10 Hz). */
let idsCache: { layout: CircuitLayout; ids: readonly string[]; key: string } | null = null
function mcuIdsOf(layout: CircuitLayout): { ids: readonly string[]; key: string } {
  if (idsCache?.layout === layout) return idsCache
  const ids = layout.components.filter((c) => getEntry(c.type)?.mcu).map((c) => c.id)
  idsCache = { layout, ids, key: ids.join('\u0000') }
  return idsCache
}

/** MCU part of the phase: 'fault' / 'halted' / null, over the boards in `ids`. */
function mcuPhase(mcus: Record<string, McuFrameInfo>, ids: readonly string[]): 'fault' | 'halted' | null {
  let halted = false
  for (const id of ids) {
    const s = mcus[id]?.state
    if (s === 'lockup') return 'fault'
    if (s === 'halted') halted = true
  }
  return halted ? 'halted' : null
}

/**
 * Pure phase derivation (tests, non-React callers): `mcuIds` = the boards in
 * the circuit (default: every id present in `mcus`).
 */
export function simPhaseOf(
  sim: { running: boolean; simTime: number },
  mcus: Record<string, McuFrameInfo>,
  mcuIds: readonly string[] = Object.keys(mcus),
): SimPhase {
  const m = mcuPhase(mcus, mcuIds)
  if (m) return m
  if (sim.running) return 'running'
  return sim.simTime > 0 ? 'paused' : 'idle'
}

/** The current phase (non-reactive). */
export function getSimPhase(): SimPhase {
  const s = useStore.getState()
  return simPhaseOf(s, useLab.getState().mcus, mcuIdsOf(s.layout).ids)
}

/** Reactive phase; re-renders only when the phase changes. */
export function useSimPhase(): SimPhase {
  const base = useStore((s): SimPhase => (s.running ? 'running' : s.simTime > 0 ? 'paused' : 'idle'))
  // a string key keeps the selector result stable across unrelated store updates
  const idsKey = useStore((s) => mcuIdsOf(s.layout).key)
  const ids = idsKey === '' ? [] : idsKey.split('\u0000')
  const mcu = useLab((s) => mcuPhase(s.mcus, ids))
  return mcu ?? base
}

/** MCU board ids in the current circuit (layout order). */
export function mcuIdsInLayout(): readonly string[] {
  return mcuIdsOf(useStore.getState().layout).ids
}

/**
 * MCU board ids in the current circuit (reactive; the same array until the
 * set of boards changes — the capsule's blocker suffix, release QA SH-F3).
 */
export function useMcuIds(): readonly string[] {
  const key = useStore((s) => mcuIdsOf(s.layout).key)
  return useMemo(() => (key === '' ? [] : key.split('\u0000')), [key])
}

/**
 * The first board in the circuit whose lab state is `state` (reactive; null
 * = none) — the capsule names the faulted / halted board. Re-renders only
 * when that id changes.
 */
export function useMcuIdIn(state: McuFrameInfo['state']): string | null {
  const idsKey = useStore((s) => mcuIdsOf(s.layout).key)
  return useLab((s) => {
    if (idsKey === '') return null
    for (const id of idsKey.split('\u0000')) if (s.mcus[id]?.state === state) return id
    return null
  })
}

/**
 * The board a debugger key acts on: the selected board when exactly one
 * board is selected, else the only board in the circuit; null when that is
 * ambiguous (several boards, none selected) or there is none.
 */
export function targetMcuId(): string | null {
  const st = useStore.getState()
  const ids = mcuIdsOf(st.layout).ids
  const selected = st.selection.filter((id) => ids.includes(id))
  if (selected.length === 1) return selected[0]
  return ids.length === 1 ? ids[0] : null
}

/** Ids of the boards in the circuit that the debugger has halted. */
export function haltedMcuIds(): string[] {
  const mcus = useLab.getState().mcus
  return mcuIdsOf(useStore.getState().layout).ids.filter((id) => mcus[id]?.state === 'halted')
}

/**
 * Resume every debugger-halted MCU, then make sure the simulation runs.
 * (lab.mcuResume restarts a world the halt froze; startSim is a no-op when
 * that already happened, and starts a fresh / paused session otherwise.)
 */
export function runOrResume(): void {
  const lab = useLab.getState()
  for (const id of haltedMcuIds()) lab.mcuResume(id)
  const st = useStore.getState()
  if (!st.running) st.startSim()
}

// ---------------------------------------------------------------------------
// One state → one colour (UX helper H6)
// ---------------------------------------------------------------------------

/** The colour families a run / board state is shown in. */
export type StateTone = 'neutral' | 'green' | 'blue' | 'orange' | 'red' | 'teal' | 'yellow' | 'muted'

/**
 * Every state a surface can show: the simulation phases (SimPhase) and the
 * MCU board states (McuUiState in src/ui/embedded/format.ts).
 */
export type ToneState =
  | SimPhase
  | 'lockup'
  | 'unpowered'
  | 'boot-sysmem'
  | 'no-firmware'
  | 'sleeping'
  | 'reset'
  | 'no-data'

/**
 * THE state-colour table (UX helper H6): the capsule's state dot and label,
 * the status pill's dot and the MCU state badge all read it, so one state
 * never has two colours (「未供電」 was purple in the panel, red in the pill):
 * idle neutral · running green · paused blue · halted orange · fault / lockup
 * red · unpowered red · BOOT0 system-memory boot orange · no firmware orange.
 * (sleeping teal, in reset yellow, no data yet muted — states the spec does
 * not name keep their colours.) The capsule's green ▶ is the ACTION, not a
 * state, and stays green.
 */
export const STATE_TONE: Readonly<Record<ToneState, StateTone>> = {
  idle: 'neutral',
  running: 'green',
  paused: 'blue',
  halted: 'orange',
  fault: 'red',
  lockup: 'red',
  unpowered: 'red',
  'boot-sysmem': 'orange',
  'no-firmware': 'orange',
  sleeping: 'teal',
  reset: 'yellow',
  'no-data': 'muted',
}

/** CSS colour of each tone (kit palette tokens). */
export const TONE_COLOR: Readonly<Record<StateTone, string>> = {
  neutral: 'var(--label-2)',
  green: 'var(--ios-green)',
  blue: 'var(--ios-blue)',
  orange: 'var(--ios-orange)',
  red: 'var(--ios-red)',
  teal: 'var(--ios-teal)',
  yellow: 'var(--ios-yellow)',
  muted: 'var(--label-3)',
}

/** The CSS colour of `state` (STATE_TONE → TONE_COLOR). */
export function stateColor(state: ToneState): string {
  return TONE_COLOR[STATE_TONE[state]]
}

/** Capsule tap / Space: halted → resume + run; running → pause; else run. */
export function toggleRun(): void {
  if (haltedMcuIds().length > 0) {
    runOrResume()
    return
  }
  const st = useStore.getState()
  if (st.running) st.stopSim()
  else st.startSim()
}
