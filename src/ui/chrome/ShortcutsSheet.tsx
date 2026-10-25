/**
 * ShortcutsSheet — 「鍵盤快速鍵」 (UX wave SH-7): every global key of the app
 * shell in one Tier-S card — run / pause, the debugger keys, framing,
 * editing, undo and saving. Opened with '?' or from More → 鍵盤快速鍵
 * (desktop). Keys render as <kbd> keycaps.
 *
 * Material: Tier-S (near-opaque gradient + lg-rim + inset shadows, NO
 * backdrop-filter) over a dim scrim — modal: Esc, the close button or a
 * scrim click dismisses; while it is open the app's own key handlers act
 * on nothing (a capture listener swallows the keys and the global key
 * router stands aside for an open modal), so Space cannot start the
 * simulation behind it, and Tab stays inside (close button ⇄ the
 * scrollable list — SH-16 / RV-11). Springs in with transform/opacity
 * (reduced motion collapses it).
 *
 * Classic chrome: never mounted (App.tsx — SH-10), its keys are not routed.
 * Shift+A (分析版面) is listed only while the desktop workspace shows.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon, KeyboardIcon, pressProps, tick } from '../kit'
import { t, useLang } from '../../i18n'
import { tc } from '../format'
import { useWorkspaceActive } from '../workspace/state'
import { isLegacyChrome } from './legacy'
import './ShortcutsSheet.css'

/** Mac keyboards say ⌘ where others say Ctrl. */
function isMac(): boolean {
  try {
    return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  } catch {
    return false
  }
}

/** One row: key combos (each a list of keys pressed together) + what it does. English sources. */
export interface ShortcutRow {
  combos: string[][]
  label: string
}

/** The command modifier as printed on this keyboard: '⌘' on a Mac, else 'Ctrl'. */
export function modKeyName(): string {
  return isMac() ? '⌘' : 'Ctrl'
}

/** Key tokens with a localized display name (the rest show as printed). */
function keyName(k: string): string {
  switch (k) {
    case 'Space':
      return tc('Space', 'key')
    case 'Arrows':
      return tc('Arrow keys', 'key')
    case 'Mod':
      return modKeyName()
    default:
      return k
  }
}

/** Every global key of the shell, by id (UX helper H6 — withKey reads it). */
export type ShortcutId =
  | 'run'
  | 'halt-resume'
  | 'step'
  | 'reset-mcu'
  | 'frame'
  | 'shortcuts'
  | 'rotate'
  | 'delete'
  | 'nudge'
  | 'cancel'
  | 'undo'
  | 'redo'
  | 'save'
  | 'analysis-layout'
  | 'regions'

/** THE key table (English sources): what the sheet lists and what withKey announces. */
export const SHORTCUTS: Readonly<Record<ShortcutId, ShortcutRow>> = {
  run: { combos: [['Space']], label: 'Run / pause' },
  'halt-resume': { combos: [['F5']], label: 'Halt / resume the core' },
  step: { combos: [['F10']], label: 'Step one instruction' },
  'reset-mcu': { combos: [['Shift', 'F5']], label: 'Reset the MCU' },
  frame: { combos: [['F']], label: 'Frame the circuit' },
  shortcuts: { combos: [['?']], label: 'Show this list' },
  rotate: { combos: [['R']], label: 'Rotate' },
  delete: { combos: [['Delete']], label: 'Delete' },
  nudge: { combos: [['Arrows']], label: 'Nudge the selection' },
  cancel: { combos: [['Esc']], label: 'Cancel / clear the selection' },
  undo: { combos: [['Mod', 'Z']], label: 'Undo' },
  redo: { combos: [['Mod', 'Y']], label: 'Redo' },
  save: { combos: [['Mod', 'S']], label: 'Save project' },
  // the tray's analysis layout (Tray.tsx — the desktop workspace only)
  'analysis-layout': { combos: [['Shift', 'A']], label: 'Analysis layout' },
  // F6 / Shift+F6 between the rail, the panels, the 3D view and the tray (SH-16)
  regions: { combos: [['F6'], ['Shift', 'F6']], label: 'Move between panels' },
}

/** Rows that only work in the desktop workspace (the sheet hides them elsewhere). */
export const WORKSPACE_ONLY_ROWS: ReadonlySet<ShortcutRow> = new Set([SHORTCUTS['analysis-layout']])

export const SHORTCUT_GROUPS: readonly { title: string; rows: readonly ShortcutRow[] }[] = [
  {
    title: 'Simulation',
    rows: [SHORTCUTS.run, SHORTCUTS['halt-resume'], SHORTCUTS.step, SHORTCUTS['reset-mcu']],
  },
  {
    title: 'View',
    rows: [SHORTCUTS.frame, SHORTCUTS['analysis-layout'], SHORTCUTS.regions, SHORTCUTS.shortcuts],
  },
  {
    title: 'Editing',
    rows: [
      SHORTCUTS.rotate,
      SHORTCUTS.delete,
      SHORTCUTS.nudge,
      SHORTCUTS.cancel,
      // two rows: one combo per line reads faster than 「Ctrl+Z ／ Ctrl+Y」 wrapped
      SHORTCUTS.undo,
      SHORTCUTS.redo,
      SHORTCUTS.save,
    ],
  },
]

/** One combo as printed in a title: 「F10」, 「Shift+F5」, 「Ctrl+Z」 (⌘Z on a Mac), 「空白鍵」. */
function comboText(keys: readonly string[]): string {
  const names = keys.map(keyName)
  return names[0] === '⌘' ? names.join('') : names.join('+')
}

/** ARIA key names (WAI-ARIA aria-keyshortcuts): Space, Shift+F5, Control+Z / Meta+Z, Escape. */
function ariaKey(k: string): string {
  switch (k) {
    case 'Mod':
      return isMac() ? 'Meta' : 'Control'
    case 'Esc':
      return 'Escape'
    case 'Arrows':
      return 'ArrowLeft ArrowRight ArrowUp ArrowDown'
    default:
      return k
  }
}

/** The keys of a shortcut as printed: 「F10」, 「Shift+F5」, 「空白鍵」 (alternatives joined with ／). */
export function shortcutKeysText(id: ShortcutId): string {
  return SHORTCUTS[id].combos.map(comboText).join('／')
}

/** aria-keyshortcuts of a shortcut: 'F10', 'Shift+F5', 'Control+Z', 'Space'. */
export function ariaKeyshortcutsOf(id: ShortcutId): string {
  return SHORTCUTS[id].combos.map((c) => c.map(ariaKey).join('+')).join(' ')
}

/**
 * A button's title + aria-keyshortcuts with its key (UX helper H6), so a
 * control and the shortcuts sheet never disagree: withKey(t('Step'), 'step')
 * → { title: 「單步（F10）」, ariaKeyshortcuts: 'F10' }. `label` is already in
 * the UI language. Classic chrome (English without the workspace) does not
 * route these keys (SH-10), so there the title is the bare label and no
 * shortcut is announced.
 */
export function withKey(label: string, id: ShortcutId): { title: string; ariaKeyshortcuts?: string } {
  if (isLegacyChrome()) return { title: label }
  return { title: t('{label} ({keys})', { label, keys: shortcutKeysText(id) }), ariaKeyshortcuts: ariaKeyshortcutsOf(id) }
}

function Combo({ keys }: { keys: string[] }) {
  const out: ReactNode[] = []
  keys.forEach((k, i) => {
    if (i > 0)
      out.push(
        <span key={`p${i}`} className="app-keys-plus" aria-hidden="true">
          +
        </span>,
      )
    out.push(
      <kbd key={k} className="lg-kbd">
        {keyName(k)}
      </kbd>,
    )
  })
  return <span className="app-keys-combo">{out}</span>
}

export interface ShortcutsSheetProps {
  open: boolean
  onDismiss: () => void
}

export function ShortcutsSheet({ open, onDismiss }: ShortcutsSheetProps) {
  useLang()
  const workspaceOn = useWorkspaceActive()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus({ preventScroll: true })
    // modal: the shell's key handlers never act on a key (its capture-phase
    // router stands aside while a modal is open, its bubbling handler never
    // sees one), and Tab stays inside: close button ⇄ the scrollable list
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const stops: HTMLElement[] = []
        if (closeRef.current) stops.push(closeRef.current)
        if (bodyRef.current) stops.push(bodyRef.current)
        if (stops.length === 0) return
        e.preventDefault()
        const at = stops.indexOf(document.activeElement as HTMLElement)
        const next = at < 0 ? 0 : (at + (e.shiftKey ? stops.length - 1 : 1)) % stops.length
        stops[next].focus({ preventScroll: true })
        return
      }
      e.stopImmediatePropagation()
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault()
        dismissRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      prev?.focus?.({ preventScroll: true })
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="app-keys" role="dialog" aria-modal="true" aria-labelledby="app-keys-title">
      <div className="app-keys-scrim" onClick={onDismiss} />
      <div className="app-keys-card lg-rim">
        <div className="app-keys-head">
          <span className="app-keys-icon" aria-hidden="true">
            <KeyboardIcon size={22} />
          </span>
          <span id="app-keys-title" className="app-keys-title">
            {t('Keyboard shortcuts')}
          </span>
          <button
            ref={closeRef}
            type="button"
            className="app-keys-close lg-pressable"
            aria-label={tc('Close', 'shortcuts')}
            {...pressProps}
            onClick={() => {
              tick()
              onDismiss()
            }}
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <div ref={bodyRef} className="app-keys-body" tabIndex={0} aria-label={t('Keyboard shortcuts')}>
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title} className="app-keys-group">
              <div className="app-keys-group-title">{tc(g.title, 'shortcuts')}</div>
              {g.rows.filter((r) => workspaceOn || !WORKSPACE_ONLY_ROWS.has(r)).map((r) => (
                <div key={r.label} className="app-keys-row">
                  <span className="app-keys-keys">
                    {r.combos.map((c, i) => (
                      <span key={i} className="app-keys-alt">
                        {i > 0 && (
                          <span className="app-keys-or" aria-hidden="true">
                            ／
                          </span>
                        )}
                        <Combo keys={c} />
                      </span>
                    ))}
                  </span>
                  <span className="app-keys-label">{t(r.label)}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="app-keys-foot">
          {t('Space, F5, F10 and Shift+F5 work wherever the focus is (Space not while you type in a field); the editing keys work on the 3D view.')}
        </div>
      </div>
    </div>,
    document.body,
  )
}
