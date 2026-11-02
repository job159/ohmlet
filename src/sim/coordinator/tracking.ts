/**
 * 顯示電流 → simulation hosts: whether every live (and every future) host
 * tracks element currents (SimulationCoordinator.setCurrentTracking). The UI's
 * flow preference (src/ui/fx/flow.ts, useFlowView) sets it; hosts register
 * on construction and adopt the current value. Dependency-free on purpose:
 * importing it never pulls in the coordinator.
 */
export interface CurrentTrackingTarget {
  setCurrentTracking(on: boolean): void
}

let enabled = false
const targets = new Set<CurrentTrackingTarget>()

/** The value new hosts start with. */
export function currentTrackingDefault(): boolean {
  return enabled
}

/** Turn current tracking on / off for every live host and every host created later. */
export function setCurrentTrackingDefault(on: boolean): void {
  if (on === enabled) return
  enabled = on
  for (const t of [...targets]) {
    try {
      t.setCurrentTracking(on)
    } catch {
      /* a disposed host ignores it */
    }
  }
}

/** A host joins (it is told the current value at once); returns the leave function. */
export function registerTrackingTarget(t: CurrentTrackingTarget): () => void {
  targets.add(t)
  if (enabled) t.setCurrentTracking(true)
  return () => {
    targets.delete(t)
  }
}
