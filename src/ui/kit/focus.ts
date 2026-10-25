/**
 * Pointer-click focus policy (UX fix SH-9): after a mouse / touch click a
 * kit control (PressableButton, Segmented, ListRow) drops its focus, so the
 * next Space runs / pauses the simulation instead of pressing the control
 * again, and no focus ring lingers on it — StatusPill's releaseFocus,
 * shared. A keyboard activation (click.detail === 0) keeps the focus.
 *
 * Off by default: the host turns it on (App.tsx: the new chrome only — the
 * classic chrome keeps its pre-wave focus behaviour, SH-10).
 */
import type { MouseEvent as ReactMouseEvent } from 'react'

let releaseEnabled: () => boolean = () => false

/** Host switch: when should a pointer click release the control's focus? */
export function setPointerFocusRelease(enabled: () => boolean): void {
  releaseEnabled = enabled
}

/** Call at the end of a control's click handler. */
export function releaseAfterPointerClick(e: ReactMouseEvent<HTMLElement>): void {
  if (e.detail <= 0 || typeof document === 'undefined') return
  const el = e.currentTarget
  if (document.activeElement === el && releaseEnabled()) el.blur()
}
