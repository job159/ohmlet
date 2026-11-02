/**
 * 顯示電流 (current-flow view) preference — CONTRACT C2 (owner: flow).
 *
 * One boolean, OFF by default, persisted per browser (localStorage 'bb.flow',
 * every access wrapped in try/catch). The FlowToggle chip next to the run
 * capsule (and the 更多 → 模擬 row) flips it; the 3D scene's current-flow
 * layer (src/three/internal/current-flow.ts) shows glowing particles along
 * every wire / strip / part body that REALLY carries current while it is on.
 * Particle speed, density and direction come from SimTelemetry.wireCurrents
 * and ComponentTelemetry.pinCurrents — never invented (NO FAKE SIMULATION).
 *
 * `visible` is what the page shows NOW; the learner's choice (`flowPreference`)
 * is kept apart from it because the classic chrome has no 顯示電流 control
 * (no chip, no 更多 row, no C key): App applies the chrome (applyFlowChrome)
 * on mount and on every chrome switch, so the stored choice never carries into
 * a chrome that cannot turn it off, and comes back with the product chrome.
 */
import { create } from 'zustand'
import { setCurrentTrackingDefault } from '../../sim/coordinator/tracking'

export const LS_FLOW = 'bb.flow'

function load(): boolean {
  try {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(LS_FLOW) === '1'
  } catch {
    return false
  }
}

export interface FlowViewState {
  /** particles visible while a simulation runs (off in the classic chrome — applyFlowChrome) */
  visible: boolean
  setVisible(v: boolean): void
}

/**
 * The learner's 顯示電流 choice: 'bb.flow' at boot, then the last setVisible —
 * kept in memory too, so a page without storage (private window) still
 * remembers it across a chrome switch.
 */
let pref = load()

export const useFlowView = create<FlowViewState>()((set) => ({
  visible: pref,
  setVisible(v) {
    pref = v
    set({ visible: v })
    try {
      if (v) window.localStorage.setItem(LS_FLOW, '1')
      else window.localStorage.removeItem(LS_FLOW)
    } catch {
      /* storage unavailable: the toggle still works for this page */
    }
  },
}))

/** The learner's 顯示電流 choice (stored in 'bb.flow'), whatever the current chrome shows. */
export function flowPreference(): boolean {
  return pref
}

/**
 * Apply the chrome the page shows (review THREE-2 / UI-3). The classic chrome
 * (isLegacyChrome) has no 顯示電流 control, so there the view — and with it
 * the simulation's current tracking — is off for this page; 'bb.flow' is left
 * as it is. The product chrome shows the learner's choice again. Changes the
 * store only when the value differs (no spurious legend / scene update).
 * setVisible() keeps working in either chrome (programmatic use).
 */
export function applyFlowChrome(legacy: boolean): void {
  const want = !legacy && pref
  if (useFlowView.getState().visible !== want) useFlowView.setState({ visible: want })
}

// the simulation measures element currents only while the view wants them
// (tracking costs a few % of sim speed; solutions are bit-identical either way)
setCurrentTrackingDefault(useFlowView.getState().visible)
useFlowView.subscribe((s) => setCurrentTrackingDefault(s.visible))
