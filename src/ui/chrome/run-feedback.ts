/**
 * Run requests from the chrome with honest feedback (UX fix SH-13 (3) —
 * N22): an empty breadboard has nothing to simulate, so Space / a tap on
 * the capsule does not start a clock that measures nothing. Instead a toast
 * says what to do first (「麵包板是空的——先開啟範例或放元件」) and the empty
 * state's 「開啟範例」 pulses once, so the eye lands on the way forward.
 *
 * The classic chrome keeps its pre-wave behaviour (an empty board runs).
 * toggleRun itself (run-control.ts) stays free of UI side effects; this is
 * the chrome's wrapper around it.
 */
import { useStore } from '../../state/store'
import { dismissToast, showToast } from '../kit'
import { t } from '../../i18n'
import { isLegacyChrome } from './legacy'
import { toggleRun } from './run-control'

/** Would a run request start nothing useful? (new chrome: an empty board, stopped) */
export function runBlockedByEmptyBoard(): boolean {
  const st = useStore.getState()
  return !isLegacyChrome() && !st.running && st.layout.components.length === 0
}

const pulseSubs = new Set<() => void>()

/** EmptyState: pulse 「開啟範例」 when a run was asked for on an empty board. */
export function subscribeEmptyPulse(fn: () => void): () => void {
  pulseSubs.add(fn)
  return () => {
    pulseSubs.delete(fn)
  }
}

let emptyToastId: number | null = null

/**
 * The capsule tap / Space: toggleRun, unless the board is empty (new
 * chrome) — then the toast + the 「開啟範例」 pulse. Returns whether the run
 * state was toggled.
 */
export function toggleRunWithFeedback(): boolean {
  if (runBlockedByEmptyBoard()) {
    if (emptyToastId != null) dismissToast(emptyToastId)
    emptyToastId = showToast(t('The breadboard is empty — open an example or place parts first'), { duration: 3200 })
    for (const fn of pulseSubs) fn()
    return false
  }
  toggleRun()
  return true
}
