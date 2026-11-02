/**
 * SelectionPill — floating glass pill centered above the dock while the
 * multi-select holds 2+ items: "3 selected · Delete · Clear". Delete is the
 * destructive (red) action and removes the whole selection; Clear just drops
 * the selection. Product chrome (operation simplification): Delete acts at
 * once — one undo step brings everything back and the toast carries
 * 〔復原〕 (edit-feedback removeSelectedWithFeedback). The classic chrome
 * keeps its ActionSheet confirmation above 3 selected parts. Springs in/out on the house spring (transform/opacity only;
 * reduced motion collapses via the kit duration tokens), 44px touch targets,
 * haptics on press, safe-area aware. Portaled to <body> like the
 * UndoPill/Dock so it z-stacks predictably over the app shell.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../state/store'
import { ActionSheet, pressProps, tick, useIsDesktop } from '../kit'
import { t, useLang } from '../../i18n'
import { useLegacyChrome } from './legacy'
import { removeSelectedWithFeedback } from './edit-feedback'
import './SelectionPill.css'

/** Matches the exit transition (--lg-dur-control 200ms) with a little slack. */
const UNMOUNT_DELAY_MS = 240

/** Classic chrome: confirm group deletes via ActionSheet above this many selected parts. */
export const CONFIRM_THRESHOLD = 3

/** Does a group delete of `count` items ask first? Only the classic chrome, above the threshold. */
export function groupDeleteConfirms(count: number, legacy: boolean): boolean {
  return legacy && count > CONFIRM_THRESHOLD
}

/**
 * Contract bridge — the concurrent store work widens `AppState.selection`
 * to a multi-select. Count either shape (id | id[] | null) so this file
 * compiles and behaves before and after the contract lands (with the
 * single-id contract the count never exceeds 1, so the pill stays hidden).
 */
function selectionCount(sel: unknown): number {
  if (Array.isArray(sel)) return sel.length
  return typeof sel === 'string' ? 1 : 0
}

export function SelectionPill() {
  const count = useStore((s) => selectionCount(s.selection))
  const select = useStore((s) => s.select)
  const removeSelected = useStore((s) => s.removeSelected)
  const desktop = useIsDesktop()
  const legacy = useLegacyChrome()
  useLang()

  const [confirm, setConfirm] = useState(false)
  const visible = count > 1

  // keep the last multi-count for the label while the pill springs out
  const shownRef = useRef(count)
  if (visible) shownRef.current = count
  const shown = shownRef.current

  // keep the pill mounted through its exit spring (UndoPill pattern)
  const [mounted, setMounted] = useState(visible)
  useEffect(() => {
    if (visible) {
      setMounted(true)
      return
    }
    setConfirm(false) // selection gone — never leave a stale confirm up
    const t = setTimeout(() => setMounted(false), UNMOUNT_DELAY_MS)
    return () => clearTimeout(t)
  }, [visible])

  if (typeof document === 'undefined') return null

  const onDown = (e: ReactPointerEvent<HTMLElement>) => {
    pressProps.onPointerDown(e)
    tick() // haptic on pointerdown, like the kit buttons
  }

  const deleteAll = () => {
    // product chrome: the toast names what went, with 〔復原〕; the classic chrome stays silent
    if (legacy) removeSelected()
    else removeSelectedWithFeedback()
    tick(16) // delete haptic (DESIGN.md §1)
  }

  const onDelete = () => {
    if (groupDeleteConfirms(count, legacy)) setConfirm(true)
    else deleteAll()
  }

  return (
    <>
      {mounted &&
        createPortal(
          // lg-card = the nested-glass slab (rim + insets, no backdrop-filter)
          <div
            className={`app-sel-pill lg-card${visible ? ' is-in' : ''}`}
            // new chrome: the 3D hover chip keeps clear of it (scene CHIP_AVOID_SELECTOR)
            data-scene-avoid={legacy || !visible ? undefined : ''}
            role="toolbar"
            aria-label={t('Selection actions')}
          >
            <span className="app-sel-count lg-tabular">{t('{n} selected', { n: shown })}</span>
            <span className="app-sel-dot" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              className="app-sel-btn app-sel-delete lg-pressable lg-specular lg-gel"
              aria-label={t('Delete {n} selected parts', { n: shown })}
              {...pressProps}
              onPointerDown={onDown}
              onClick={onDelete}
            >
              {t('Delete')}
            </button>
            <span className="app-sel-dot" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              className="app-sel-btn lg-pressable lg-specular lg-gel"
              aria-label={t('Clear the selection')}
              {...pressProps}
              onPointerDown={onDown}
              onClick={() => select(null)}
            >
              {t('Clear')}
            </button>
          </div>,
          document.body,
        )}

      <ActionSheet
        open={confirm}
        onDismiss={() => setConfirm(false)}
        title={t('Delete {n} parts?', { n: shown })}
        message={t('Removes every selected component and wire and disconnects them from the circuit.')}
        desktop={desktop}
        anchor="right"
        actions={[
          {
            label: t('Delete {n} parts', { n: shown }),
            destructive: true,
            onSelect: deleteAll,
          },
        ]}
      />
    </>
  )
}
