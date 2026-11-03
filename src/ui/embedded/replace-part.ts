/**
 * 〔換新〕 (round 5 — damage): a part the simulation destroyed — an LED or an
 * RGB die burned out, a resistor burned open, an electrolytic vented — is
 * replaced by a new one in ONE click, in place: no edit, no rebuild, no
 * 重置模擬, its parameters kept (SimHost.repairParts → SimEngine.repairParts).
 * Offered by the inspector's damage banner (DamageBanner), the part's
 * Problems row (problems.ts) and its long-press action sheet (App.tsx) —
 * product chrome only.
 *
 * Honest: the toast says the part was replaced, never that the fault is
 * fixed — when the cause is still there the running simulation burns the
 * new part again (a new burst, a new issue, the banner back). Not a
 * document edit: nothing goes into the undo history, so the toast has no
 * 〔復原〕.
 *
 * Board on-board LEDs (a Blue Pill's LED_PC13 / LED_PWR) are sub-circuit
 * elements of their board: 換新 on the board replaces them.
 *
 * Only what the readings show destroyed is replaced: a click on a row or a
 * banner that is a moment stale (the part was replaced or rebuilt already)
 * says so instead of announcing a replacement that did not happen. While
 * the simulation is paused the new part gets no power yet (it shows dark):
 * the toast says the simulation is paused and offers 〔繼續執行〕.
 */
import type { ComponentTelemetry, SimTelemetry } from '../../model/types'
import { t } from '../../i18n'
import { peekSimHost, simStopReason, useStore } from '../../state/store'
import { playMech } from '../fx/sound'
import { dismissToast, showToast, tick } from '../kit'
import { TIER } from '../chrome/explain'
import { useExplainView } from '../chrome/useExplanation'

/** Latched damage a new part takes away ('overheating' is not latched: the part cools down by itself). */
function latched(tele: ComponentTelemetry | undefined | null): boolean {
  if (!tele) return false
  const kind = tele.damage?.kind
  return tele.burned === true || kind === 'burned' || kind === 'vented'
}

/**
 * Can 換新 replace part `tele` (its telemetry)? Its own model latched
 * damage, or one of its sub-circuit elements did (a board's on-board LED).
 */
export function isReplaceable(tele: ComponentTelemetry | undefined | null): boolean {
  if (!tele) return false
  if (latched(tele)) return true
  const sub = tele.sub
  if (sub) for (const k in sub) if (latched(sub[k])) return true
  return false
}

/** The parts of a telemetry snapshot 換新 can replace (insertion order). */
export function replaceableParts(telemetry: SimTelemetry | null | undefined): string[] {
  const out: string[] = []
  const comps = telemetry?.components
  if (comps) for (const id in comps) if (isReplaceable(comps[id])) out.push(id)
  return out
}

/**
 * The part a damage fact's 〔換新〕 replaces: 'burned:LED1' / 'vented:C1' →
 * that part; 'burned:U1.LED_PC13' (a board's on-board LED, the simulator's
 * own id) → its board 'U1'. Null for any other fact.
 */
export function replaceTargetOf(fact: string | undefined): string | null {
  const m = fact ? /^(?:burned|vented):([^.:\s]+)/.exec(fact) : null
  return m ? m[1] : null
}

/**
 * The feedback of new parts going in (〔換新〕 and the automatic 換新 of
 * auto-heal.ts): haptic tick, the insert sound of a part going in, and the
 * toast `text`. Paused: the new part gets no power until the simulation
 * runs again, so the toast says so and offers 〔繼續執行〕 (not while the
 * debugger holds the core or after a failed start — those have their own
 * way back).
 */
export function announceReplaced(text: string): void {
  tick()
  playMech('insert', { count: 2 })
  if (useStore.getState().running) {
    lastReplacedToast = showToast(text)
    return
  }
  const why = simStopReason()
  const resumable = why !== 'debugger' && why !== 'failed'
  showToast(
    t('{text} — the simulation is paused|damage', { text }),
    resumable ? { action: { label: t('Resume|capsule'), run: () => useStore.getState().startSim() } } : {},
  )
}

/**
 * The parts of `layout` its readings show destroyed, in layout order (the
 * ids 〔全部換新〕 replaces; a part no longer on the board never counts).
 */
export function damagedPartIds(telemetry: SimTelemetry | null | undefined, layout: { components: readonly { id: string }[] }): string[] {
  const comps = telemetry?.components
  if (!comps) return []
  return layout.components.filter((c) => isReplaceable(comps[c.id])).map((c) => c.id)
}

/** 「LED1、R2」 — the ids a toast / label names. */
function idList(ids: readonly string[]): string {
  return ids.join(t(', |damage-list'))
}

/**
 * Replace parts `ids` by new ones in ONE host call (〔換新〕 on a row, a
 * banner or the selection pill; 〔全部換新〕): one haptic tick, one insert
 * sound, one toast 「已換上新的 LED1」 / 「已換上新的 LED1、R2」. Only the
 * ids the readings show destroyed go in; false when none does: no
 * simulation to replace them in (silent), or the readings show them whole
 * (a stale row, banner or pill: 「LED1 沒有損壞，不用換新」 / 「沒有損壞的元
 * 件，不用換新」, no sound).
 */
export function replacePartsWithFeedback(ids: readonly string[]): boolean {
  const h = peekSimHost()
  if (!h || typeof h.repairParts !== 'function') return false
  const comps = useStore.getState().telemetry?.components
  const wanted = [...new Set(ids)]
  const live = wanted.filter((id) => isReplaceable(comps?.[id]))
  if (live.length === 0) {
    showToast(wanted.length === 1 ? t('{id} is not damaged — nothing to replace', { id: wanted[0] }) : t('Nothing is damaged — nothing to replace|damage'))
    return false
  }
  try {
    h.repairParts(live)
  } catch {
    return false // a dead host: the store's own error path reports it
  }
  announceReplaced(live.length === 1 ? t('Replaced {id} with a new one', { id: live[0] }) : t('Replaced {ids} with new ones|damage', { ids: idList(live) }))
  if (useStore.getState().running) watchReburn(live)
  return true
}

// ---------------------------------------------------------------------------
// the new part burned again (persona fix)
// ---------------------------------------------------------------------------

/** After 〔換新〕 while running, the new parts are watched this long (ms): one that burns again is said so. */
export const REBURN_WATCH_MS = 2500
/** readings that arrive this soon after the click may still predate the new part (ms) */
export const REBURN_SETTLE_MS = 250

/** the toast 「已換上新的 LED1」 last shown (a re-burn replaces it) */
let lastReplacedToast: number | null = null
let reburnStop: (() => void) | null = null

const wallMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * 〔換新〕 on a circuit that still has the fault: the running simulation
 * burns the new part again at once, and the toast 「已換上新的 LED1」 alone
 * looked as if the button did nothing (persona fix). For REBURN_WATCH_MS
 * the new parts are watched; one the readings show destroyed again (no edit
 * in between — an edit is its own story: auto-heal, a rebuild) replaces
 * that toast with 「新的 LED1 又燒掉了：…」 and the fix the 電路說明 card
 * gives for it (「改用至少 180 Ω 的限流電阻；改好就會自動換上新的 LED1」).
 */
function watchReburn(ids: readonly string[]): void {
  reburnStop?.()
  const t0 = wallMs()
  const layout0 = useStore.getState().layout
  let timer: ReturnType<typeof setTimeout> | null = null
  const stop = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    unsub()
    if (reburnStop === stop) reburnStop = null
  }
  const unsub = useStore.subscribe((s, prev) => {
    if (s.layout !== layout0) return stop()
    if (s.telemetry === prev.telemetry || !s.telemetry || !s.running || wallMs() - t0 < REBURN_SETTLE_MS) return
    const comps = s.telemetry.components
    const again = ids.filter((id) => isReplaceable(comps[id]))
    if (again.length === 0) return
    stop()
    sayReburned(again)
  })
  timer = setTimeout(stop, REBURN_WATCH_MS)
  reburnStop = stop
}

/** The 電路說明 card's fix for part `id` while its damage is the card's subject (line 2), else null. */
function cardFix(id: string): string | null {
  try {
    const e = useExplainView.getState().explanation
    if (!e || e.tier !== TIER.damage || !e.subjectIds.includes(id) || e.lines.length < 2) return null
    return e.lines[1] ?? null
  } catch {
    return null
  }
}

function sayReburned(ids: readonly string[]): void {
  if (lastReplacedToast !== null) dismissToast(lastReplacedToast)
  lastReplacedToast = null
  const id = ids[0]
  const fix = ids.length === 1 ? cardFix(id) : null
  const text =
    ids.length > 1
      ? t('The new {ids} burned out again: the fault that burned them is still in the circuit|damage', { ids: idList(ids) })
      : fix
        ? t('The new {id} burned out again: {fix}|damage', { id, fix })
        : t('The new {id} burned out again: the fault that burned it is still in the circuit|damage', { id })
  showToast(text, { duration: 5200 })
}

/** Tests: stop a running re-burn watch. */
export function __stopReburnWatchForTests(): void {
  reburnStop?.()
  lastReplacedToast = null
}

/**
 * Replace part `id` by a new one (the 〔換新〕 button): haptic tick, the
 * insert sound of a part going in, and 「已換上新的 LED1」. False when
 * there is nothing to replace: no simulation to replace it in (silent), or
 * the readings show the part whole (a stale row or banner: 「LED1 沒有損壞，
 * 不用換新」, no sound).
 */
export function replaceDamagedWithFeedback(id: string): boolean {
  return replacePartsWithFeedback([id])
}

/**
 * 〔全部換新〕 (the Problems list header, two or more destroyed parts): every
 * part on the board the readings show destroyed, in one call — one sound,
 * one toast 「已換上新的 LED1、R2」.
 */
export function replaceAllDamagedWithFeedback(): boolean {
  const s = useStore.getState()
  const ids = damagedPartIds(s.telemetry, s.layout)
  if (ids.length === 0) {
    if (peekSimHost()?.repairParts) showToast(t('Nothing is damaged — nothing to replace|damage'))
    return false
  }
  return replacePartsWithFeedback(ids)
}

/** The aria label of a 〔換新〕 that replaces `ids`: 「把 LED1 換成新的」, 「把 LED1、R2 換成新的」. */
export function replaceLabel(ids: readonly string[]): string {
  return ids.length === 1 ? t('Replace {id} with a new one', { id: ids[0] }) : t('Replace {ids} with new ones|damage', { ids: idList(ids) })
}
