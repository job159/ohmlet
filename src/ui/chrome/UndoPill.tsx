/**
 * UndoPill — small floating glass pill on the left edge above the dock with
 * Undo / Redo icon buttons (44px hits, kit press feedback + haptic tick).
 * Renders only while an undo or redo step exists, springing in/out
 * (transform/opacity only); each button disables when its direction is
 * unavailable. Portaled to <body> like the Dock so it z-stacks predictably
 * over the app shell's stacking context.
 *
 * New chrome (UX wave SH-7 — not the classic chrome): a third button
 * 「對準電路（F）」 frames the whole circuit (scene bridge frameCircuit), and
 * the pill also shows whenever the board holds something to frame (undo /
 * redo then simply sit disabled). Shortcuts are in the tooltips. On an empty
 * board 「對準電路」 frames the whole breadboard (release QA SH-F4 — the
 * scene's content framing falls back to the home view), and undo / redo say
 * which step they took (「已復原：放上 R1」 — SH-F9, edit-feedback.ts).
 */
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../state/store'
import { TargetIcon, pressProps, tick } from '../kit'
import { t, useLang } from '../../i18n'
import { frameCircuit } from '../workspace/scene-bridge'
import { redoWithFeedback, undoWithFeedback } from './edit-feedback'
import { useLegacyChrome } from './legacy'
import { withKey } from './ShortcutsSheet'
import './UndoPill.css'

/** Matches the exit transition (--lg-dur-control 200ms) with a little slack. */
const UNMOUNT_DELAY_MS = 240

function UndoIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 5.5 3.5 10 8 14.5" />
      <path d="M3.5 10h10a6.5 6.5 0 0 1 6.5 6.5v1" />
    </svg>
  )
}

function RedoIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m16 5.5 4.5 4.5L16 14.5" />
      <path d="M20.5 10h-10A6.5 6.5 0 0 0 4 16.5v1" />
    </svg>
  )
}

export function UndoPill() {
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)
  const legacy = useLegacyChrome()
  const hasContent = useStore((s) => s.layout.components.length > 0 || s.layout.wires.length > 0)
  useLang()

  const visible = canUndo || canRedo || (!legacy && hasContent)

  // keep the pill mounted through its exit spring
  const [mounted, setMounted] = useState(visible)
  useEffect(() => {
    if (visible) {
      setMounted(true)
      return
    }
    const t = setTimeout(() => setMounted(false), UNMOUNT_DELAY_MS)
    return () => clearTimeout(t)
  }, [visible])

  // new chrome: phones lift the toasts above the (wider) pill's row
  useEffect(() => {
    if (legacy || !visible) return
    document.body.classList.add('app-undo-visible')
    return () => document.body.classList.remove('app-undo-visible')
  }, [legacy, visible])

  if (typeof document === 'undefined' || !mounted) return null

  const onDown = (e: ReactPointerEvent<HTMLElement>) => {
    pressProps.onPointerDown(e)
    tick() // haptic on pointerdown, like the kit buttons
  }

  const undoKey = withKey(t('Undo'), 'undo')
  const redoKey = withKey(t('Redo'), 'redo')
  const frameKey = withKey(t('Frame the circuit'), 'frame')
  return createPortal(
    // lg-card = the nested-glass slab (bent-light rim + inset shadows, no
    // backdrop-filter); the pill CSS layers its darker over-scene tint on top
    <div
      className={`app-undo-pill lg-card${visible ? ' is-in' : ''}`}
      // new chrome: the 3D hover chip keeps clear of it (scene CHIP_AVOID_SELECTOR)
      data-scene-avoid={legacy || !visible ? undefined : ''}
      role="group"
      aria-label={t('Undo and redo')}
    >
      <button
        type="button"
        className="app-undo-btn lg-pressable lg-specular lg-gel"
        aria-label={t('Undo')}
        // the key as the shortcuts list prints it (H6 withKey — ⌘Z on a Mac)
        title={legacy ? undefined : undoKey.title}
        aria-keyshortcuts={legacy ? undefined : undoKey.ariaKeyshortcuts}
        disabled={!canUndo}
        {...pressProps}
        onPointerDown={onDown}
        onClick={undoWithFeedback}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        className="app-undo-btn lg-pressable lg-specular lg-gel"
        aria-label={t('Redo')}
        title={legacy ? undefined : redoKey.title}
        aria-keyshortcuts={legacy ? undefined : redoKey.ariaKeyshortcuts}
        disabled={!canRedo}
        {...pressProps}
        onPointerDown={onDown}
        onClick={redoWithFeedback}
      >
        <RedoIcon />
      </button>
      {!legacy && (
        <>
          <span className="app-undo-divider" aria-hidden="true" />
          <button
            type="button"
            className="app-undo-btn lg-pressable lg-specular lg-gel"
            aria-label={t('Frame the circuit')}
            title={frameKey.title}
            aria-keyshortcuts={frameKey.ariaKeyshortcuts}
            // never disabled: an empty board frames the whole breadboard (SH-F4)
            {...pressProps}
            onPointerDown={onDown}
            onClick={() => frameCircuit()}
          >
            <TargetIcon size={22} />
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
