/**
 * Workspace runtime state that is NOT a persisted preference:
 *
 *  - `useWorkspaceActive()` — the desktop workspace shows only when the user
 *    enabled it (lab.workspace.enabled, persisted under `bb.workspace`) AND
 *    the viewport is ≥ 1100 px wide with a fine pointer. Phones, tablets and
 *    touch laptops keep the classic sheet chrome.
 *  - the hovered scene object (SceneCallbacks.onObjectHover → inspector
 *    hint), a tiny module-level external store so hover never re-renders
 *    the App root.
 *  - geometry: effective panel sizes for the current viewport (stored
 *    sizes clamped so the 3D centre column keeps at least MIN_CENTER px).
 */
import { useSyncExternalStore } from 'react'
import { useMediaQuery } from '../kit'
import { WORKSPACE_MEDIA_QUERY, useLab } from '../embedded/lab'
import type { WorkspacePrefs } from '../../state/lab-types'

export function useWorkspaceActive(): boolean {
  const wide = useMediaQuery(WORKSPACE_MEDIA_QUERY)
  const enabled = useLab((s) => s.workspace.enabled)
  return wide && enabled
}

// ---------------------------------------------------------------------------
// hovered scene object
// ---------------------------------------------------------------------------

let hovered: string | null = null
const hoverSubs = new Set<() => void>()

export function setHoveredObject(id: string | null): void {
  if (id === hovered) return
  hovered = id
  for (const fn of hoverSubs) fn()
}

export function useHoveredObject(): string | null {
  return useSyncExternalStore(
    (fn) => {
      hoverSubs.add(fn)
      return () => hoverSubs.delete(fn)
    },
    () => hovered,
    () => null,
  )
}

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

/** px from the viewport's left edge where workspace chrome may start (the dock rail: 12 + 70 + 14). */
export const RAIL_EDGE = 96
export const EDGE = 16
export const GAP = 12
/** collapsed side handle width / collapsed tray bar height */
export const HANDLE_W = 22
export const TRAY_BAR_H = 44
const MIN_CENTER = 420

export const LIMITS = {
  left: { min: 240, max: 520 },
  right: { min: 280, max: 560 },
  tray: { min: 140, max: 640 },
} as const

export interface WorkspaceGeometry {
  leftW: number
  rightW: number
  trayH: number
  /** occupied px from each viewport edge (chrome re-flow + tray placement) */
  insetLeft: number
  insetRight: number
  insetBottom: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function computeGeometry(p: WorkspacePrefs, vw: number, vh: number): WorkspaceGeometry {
  let leftW = clamp(p.left.width, LIMITS.left.min, LIMITS.left.max)
  let rightW = clamp(p.right.width, LIMITS.right.min, LIMITS.right.max)
  const sideBudget =
    vw - RAIL_EDGE - EDGE - 2 * GAP - MIN_CENTER - (p.left.open ? 0 : HANDLE_W) - (p.right.open ? 0 : HANDLE_W)
  const used = (p.left.open ? leftW : 0) + (p.right.open ? rightW : 0)
  if (used > sideBudget && used > 0) {
    // squeeze both open panels proportionally, never below their minimums
    const k = Math.max(0, sideBudget) / used
    if (p.left.open) leftW = Math.max(LIMITS.left.min, Math.floor(leftW * k))
    if (p.right.open) rightW = Math.max(LIMITS.right.min, Math.floor(rightW * k))
  }
  const trayMax = Math.max(LIMITS.tray.min, Math.min(LIMITS.tray.max, Math.round(vh * 0.6)))
  const trayH = clamp(p.tray.height, LIMITS.tray.min, trayMax)
  return {
    leftW,
    rightW,
    trayH,
    insetLeft: RAIL_EDGE + (p.left.open ? leftW : HANDLE_W) + GAP,
    insetRight: EDGE + (p.right.open ? rightW : HANDLE_W) + GAP,
    insetBottom: EDGE + (p.tray.open ? trayH : TRAY_BAR_H) + GAP,
  }
}
