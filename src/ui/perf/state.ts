/**
 * 效能診斷 (performance diagnostics) preference: one boolean, off by default,
 * persisted per browser (localStorage 'bb.perfDiag'). The More sheet's
 * Settings group toggles it (PerfDiagnosticsRow); PerfOverlay mounts its
 * collectors only while it is on, so a normal session pays nothing.
 */
import { create } from 'zustand'

export const LS_PERF_DIAG = 'bb.perfDiag'

function load(): boolean {
  try {
    if (typeof window === 'undefined') return false
    const q = new URLSearchParams(window.location.search)
    // the profiling rig (?perfrig) and an explicit ?perf turn it on for the page
    if (q.has('perf') || q.has('perfrig')) return true
    return window.localStorage.getItem(LS_PERF_DIAG) === '1'
  } catch {
    return false
  }
}

interface PerfDiagState {
  enabled: boolean
  setEnabled(enabled: boolean): void
}

export const usePerfDiag = create<PerfDiagState>()((set) => ({
  enabled: load(),
  setEnabled(enabled) {
    set({ enabled })
    try {
      if (enabled) window.localStorage.setItem(LS_PERF_DIAG, '1')
      else window.localStorage.removeItem(LS_PERF_DIAG)
    } catch {
      /* storage unavailable: the toggle still works for this page */
    }
  },
}))
