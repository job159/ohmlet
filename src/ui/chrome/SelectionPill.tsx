/**
 * SelectionPill — floating glass pill centered above the dock while the
 * multi-select holds 2+ items: "3 selected · Delete · Clear" (product chrome:
 * 「已選取 3 項 · 複製 · 刪除 · 清除」 — 複製 puts a copy of the group beside
 * it at once, settings and all; copy-paste.ts). Delete is the
 * destructive (red) action and removes the whole selection; Clear just drops
 * the selection. Product chrome (operation simplification): Delete acts at
 * once — one undo step brings everything back and the toast carries
 * 〔復原〕 (edit-feedback removeSelectedWithFeedback). The classic chrome
 * keeps its ActionSheet confirmation above 3 selected parts. Springs in/out on the house spring (transform/opacity only;
 * reduced motion collapses via the kit duration tokens), 44px touch targets,
 * haptics on press, safe-area aware. Portaled to <body> like the
 * UndoPill/Dock so it z-stacks predictably over the app shell.
 *
 * 〔換新〕 where the learner is (product chrome, round 5 polish): when the
 * readings show a selected part destroyed (an LED burned out, a resistor
 * burned open, an electrolytic vented — replace-part.ts isReplaceable), the
 * pill carries 〔換新〕 first — 「已選取 3 項 · 換新 · 複製 · 刪除 · 清除」,
 * which replaces the destroyed ones among the selection in one call — and
 * it shows for ONE selected part too, then only its state and the button:
 * 「LED1 已燒毀 · 換新」. One host call, one insert sound, one toast
 * (replacePartsWithFeedback). The classic chrome has no 換新 anywhere.
 *
 * Narrow phones (320 px): the separators drop and the buttons tighten, so
 * four buttons and the count fit inside the screen (never clipped).
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../state/store'
import { getEntry } from '../../model/catalog'
import type { SimTelemetry } from '../../model/types'
import { ActionSheet, pressProps, tick, useIsDesktop } from '../kit'
import { t, useLang } from '../../i18n'
import { useLegacyChrome } from './legacy'
import { removeSelectedWithFeedback } from './edit-feedback'
import { duplicateWithFeedback } from './copy-paste'
import { isReplaceable, replaceLabel, replacePartsWithFeedback } from '../embedded/replace-part'
import { damageText } from '../embedded/DamageBanner'
import './SelectionPill.css'

/** Matches the exit transition (--lg-dur-control 200ms) with a little slack. */
const UNMOUNT_DELAY_MS = 240

/** <body> class while the product pill shows: the phone toasts take the row above it (SelectionPill.css). */
export const SEL_VISIBLE_CLASS = 'app-sel-visible'

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

/** The selected ids, either shape (id | id[] | null). */
function selectionIds(sel: unknown): string[] {
  if (Array.isArray(sel)) return sel.filter((x): x is string => typeof x === 'string')
  return typeof sel === 'string' ? [sel] : []
}

/**
 * The selected parts the readings show destroyed (〔換新〕 replaces them),
 * joined with ',' — a stable selector value, so the pill re-renders when
 * that set changes, not on every telemetry push (≤ 10 Hz).
 */
export function damagedSelectionKey(sel: unknown, telemetry: SimTelemetry | null | undefined): string {
  const comps = telemetry?.components
  if (!comps) return ''
  return selectionIds(sel)
    .filter((id) => isReplaceable(comps[id]))
    .join(',')
}

/** One destroyed part selected: its state as the inspector's banner names it (「LED1 已燒毀」), else its id. */
function damagedTitle(id: string): string {
  const s = useStore.getState()
  const type = s.layout.components.find((c) => c.id === id)?.type
  return damageText(id, type ? getEntry(type) : undefined, s.telemetry?.components[id])?.title ?? id
}

export function SelectionPill() {
  const count = useStore((s) => selectionCount(s.selection))
  const select = useStore((s) => s.select)
  const removeSelected = useStore((s) => s.removeSelected)
  const desktop = useIsDesktop()
  const legacy = useLegacyChrome()
  // product chrome: the destroyed parts among the selection (〔換新〕)
  const damagedKey = useStore((s) => (legacy ? '' : damagedSelectionKey(s.selection, s.telemetry)))
  useLang()

  const [confirm, setConfirm] = useState(false)
  const damagedNow = damagedKey ? damagedKey.split(',') : []
  // 2+ items, or one destroyed part (its 〔換新〕 right where the learner is looking)
  const visible = count > 1 || damagedNow.length > 0

  // keep the last label and buttons while the pill springs out (a 換新 that took the damage away)
  const shownRef = useRef({ count, damaged: damagedNow })
  if (visible) shownRef.current = { count, damaged: damagedNow }
  const shown = shownRef.current.count
  const damaged = shownRef.current.damaged
  const group = shown > 1

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

  // product chrome: while the pill shows, the phone toasts float one row above it
  // (SelectionPill.css) — a toast from its own 複製 / 換新 never covers it
  useEffect(() => {
    if (legacy || !visible) return
    document.body.classList.add(SEL_VISIBLE_CLASS)
    return () => document.body.classList.remove(SEL_VISIBLE_CLASS)
  }, [legacy, visible])

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

  const dot = (
    <span className="app-sel-dot" aria-hidden="true">
      ·
    </span>
  )

  return (
    <>
      {mounted &&
        createPortal(
          // lg-card = the nested-glass slab (rim + insets, no backdrop-filter)
          <div
            // is-product: the product chrome's narrow-phone fit and raised phone row (the classic pill is unchanged)
            className={`app-sel-pill lg-card${visible ? ' is-in' : ''}${group ? '' : ' is-single'}${legacy ? '' : ' is-product'}`}
            // new chrome: the 3D hover chip keeps clear of it (scene CHIP_AVOID_SELECTOR)
            data-scene-avoid={legacy || !visible ? undefined : ''}
            role="toolbar"
            aria-label={t('Selection actions')}
          >
            <span className="app-sel-count lg-tabular">{group ? t('{n} selected', { n: shown }) : damaged[0] ? damagedTitle(damaged[0]) : ''}</span>
            {dot}
            {!legacy && damaged.length > 0 && (
              <>
                {/* product chrome: new parts in place of the destroyed ones, settings kept (replace-part.ts) */}
                <button
                  type="button"
                  className="app-sel-btn app-sel-renew lg-pressable lg-specular lg-gel"
                  aria-label={replaceLabel(damaged)}
                  {...pressProps}
                  onPointerDown={onDown}
                  onClick={() => void replacePartsWithFeedback(damaged)}
                >
                  {t('Replace|damaged')}
                </button>
                {group && dot}
              </>
            )}
            {group && (
              <>
                {!legacy && (
                  <>
                    {/* product chrome: a copy of the group beside it, settings and all (copy-paste.ts) */}
                    <button
                      type="button"
                      className="app-sel-btn lg-pressable lg-specular lg-gel"
                      aria-label={t('Duplicate the {n} selected items|copy-paste', { n: shown })}
                      {...pressProps}
                      onPointerDown={onDown}
                      onClick={() => duplicateWithFeedback(useStore.getState().selection)}
                    >
                      {t('Duplicate')}
                    </button>
                    {dot}
                  </>
                )}
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
                {dot}
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
              </>
            )}
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
