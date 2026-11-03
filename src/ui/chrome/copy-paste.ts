/**
 * copy-paste.ts — Ctrl/⌘+C／V／X／D: copy placed parts WITH their settings
 * (round 5, product chrome). React-free glue between the keys (App.tsx),
 * the selection pill's 「複製」, the long-press sheet's 「複製」 and the store:
 *
 *  - the clip is module state, not the document: never saved, it survives
 *    undo and pastes after the originals are gone. Ctrl+C / Ctrl+X take the
 *    selection (state/clipboard.ts clipFromSelection — the parts, their
 *    params, the wires between them and their power feed) and note the
 *    firmware of every copied Blue Pill;
 *  - clipboardKeyAction(e, ctx): which of copy / cut / paste / duplicate a
 *    keydown is, or 'pass' — the classic chrome, a text field, an open
 *    modal, Shift / Alt chords (Ctrl+Shift+C is DevTools), Ctrl+C / Ctrl+X
 *    over selected text (the browser keeps its own copy — a selection left
 *    over from before a press on the 3D view does not count), and Ctrl+C／X／D
 *    with nothing selected. A held key (auto-repeat) acts once;
 *  - the *WithFeedback actions say what happened: 「已複製 R1、LED1——按
 *    Ctrl+V 貼上」, 「已貼上 R2、LED2」 + 〔復原〕, 「已複製一份：R2」 +
 *    〔復原〕, 「已剪下 R1——按 Ctrl+V 貼上」 + 〔復原〕 (a cut also takes the
 *    copied wires it would leave hanging, so cut + paste is a move — with
 *    the pointer still on the part too). Selected wires that do not come
 *    along are named (「（導線 W2 沒有一起複製）」), and so is a hovered
 *    free spot the copy did not fit (「——滑鼠指的地方放不下」). A pasted
 *    Blue Pill runs the same firmware (lab.copyFirmware — undo / redo follow
 *    it) and the toast says so: 「已貼上 U2（連同韌體 hal-blink.elf）」. No
 *    room: 〔加一塊麵包板〕 grows the rig and pastes again.
 *
 * The paste is ONE undo step (store.pasteParts) and the copy is selected;
 * the camera stays put, and the sound stream's store watcher voices the
 * paste as ONE insert (withMechPaste — even onto an empty board); no room
 * for the copy plays the soft 'refuse' thunk.
 */
import type { HoleRef } from '../../model/types'
import { getEntry } from '../../model/catalog'
import { clipFromSelection, wiresLeftLoose, type PartClip } from '../../state/clipboard'
import { copyFirmware } from '../../state/lab'
import { stripTransientParams, useStore } from '../../state/store'
import { t } from '../../i18n'
import { tidyCjkSpaces } from '../../i18n/tidy'
import { dismissToast, showToast, tick } from '../kit'
import { useLab } from '../embedded/lab'
import { nameList, selectionNames, undoableToast } from './edit-feedback'
import { withMechPaste } from '../fx/mech-watch'
import { playMech } from '../fx/sound'
import type { KeyLike } from './keys'
import { shortcutKeysText } from './ShortcutsSheet'

/** What Ctrl+C / Ctrl+X took, and the firmware (sha-256) its boards ran then: source id → sha. */
interface Held {
  clip: PartClip
  firmware: ReadonlyMap<string, string>
}

let held: Held | null = null
/** The last plain copy-paste toast (a held key replaces it). */
let toastId: number | null = null

/** The clip Ctrl+V pastes (null = nothing copied yet). */
export function clipboardClip(): PartClip | null {
  return held?.clip ?? null
}

/** TEST-ONLY: forget the clip. */
export function __resetClipForTests(): void {
  held = null
  toastId = null
}

// ---------------------------------------------------------------------------
// the keys
// ---------------------------------------------------------------------------

export type ClipboardKeyAction = 'copy' | 'cut' | 'paste' | 'duplicate' | 'pass'

/** What clipboardKeyAction needs to know besides the key. */
export interface ClipboardKeyContext {
  /** the classic chrome: the browser keeps every key (SH-10) */
  legacy: boolean
  /** the key went to a text field */
  editableTarget: boolean
  /** text is selected on the page (the UART log, a lesson…) */
  textSelected: boolean
  /** selected parts and wires */
  selectionCount: number
  /** a blocking modal is open */
  modalOpen: boolean
}

const KEY_ACTIONS: ReadonlyMap<string, Exclude<ClipboardKeyAction, 'pass'>> = new Map([
  ['c', 'copy'],
  ['x', 'cut'],
  ['v', 'paste'],
  ['d', 'duplicate'],
])

/**
 * Which clipboard action a keydown is (pure). Ctrl or ⌘ with no Shift / Alt;
 * the letter as typed, or the physical key on a non-Latin layout.
 */
export function clipboardKeyAction(e: KeyLike, ctx: ClipboardKeyContext): ClipboardKeyAction {
  if (ctx.legacy || ctx.editableTarget || ctx.modalOpen) return 'pass'
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return 'pass'
  const letter = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : (e.code ?? '').replace(/^Key/, '').toLowerCase()
  const action = KEY_ACTIONS.get(letter)
  if (!action) return 'pass'
  if (action === 'paste') return 'paste'
  if (ctx.selectionCount === 0) return 'pass' // Ctrl+C／X: the browser's; Ctrl+D: its bookmark
  if (action !== 'duplicate' && ctx.textSelected) return 'pass' // selected text: the browser copies it
  return action
}

/**
 * The order of the page's last text-selection change and the last press on
 * the 3D view: a selection made BEFORE a press on the view (one the press
 * did not clear) is stale — Ctrl+C then copies the selected parts, not it.
 */
let seq = 0
let selectionSeq = 0
let viewPressSeq = 0
/** The page's text selection changed (document 'selectionchange'). */
export function noteSelectionChange(): void {
  selectionSeq = ++seq
}
/** A pointer went down on the 3D view (a canvas). */
export function noteViewPress(): void {
  viewPressSeq = ++seq
}
try {
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('selectionchange', noteSelectionChange)
    const onPress = (e: Event) => {
      if ((e.target as Element | null)?.tagName === 'CANVAS') noteViewPress()
    }
    document.addEventListener('pointerdown', onPress, true)
  }
} catch {
  /* no DOM: no selection to track */
}

/** Is text selected on the page (a non-empty, non-collapsed selection made since the last press on the 3D view)? */
export function textSelectionActive(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false
    if (viewPressSeq > selectionSeq) return false // left over from before a press on the 3D view
    const sel = window.getSelection()
    return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0
  } catch {
    return false
  }
}

/**
 * Run a clipboard key (App.tsx — after clipboardKeyAction said which; the
 * caller still takes the key). `repeat`: the key is held (auto-repeat) —
 * it acted on its first press only, so holding Ctrl+V or Ctrl+D never
 * sprays copies (one undo step each).
 */
export function runClipboardKey(
  action: Exclude<ClipboardKeyAction, 'pass'>,
  opts: { near?: HoleRef | null; repeat?: boolean } = {},
): void {
  if (opts.repeat) return
  switch (action) {
    case 'copy':
      copySelectionWithFeedback()
      return
    case 'cut':
      cutSelectionWithFeedback()
      return
    case 'paste':
      pasteWithFeedback(opts)
      return
    case 'duplicate':
      duplicateWithFeedback()
      return
  }
}

// ---------------------------------------------------------------------------
// the actions
// ---------------------------------------------------------------------------

/** 「R1、LED1」 — the clip's parts (its wires when it has no part). */
function clipNames(c: PartClip): string {
  return nameList(c.components.length > 0 ? c.components.map((x) => x.id) : c.wires.map((w) => t('Wire {id}', { id: w.id })))
}

/** 「導線 W2」 — the selected wires the clip left behind ('' = none). */
function leftNames(c: PartClip): string {
  return c.left && c.left.length > 0 ? nameList(c.left.map((id) => t('Wire {id}', { id }))) : ''
}

function say(text: string): void {
  if (toastId != null) dismissToast(toastId)
  toastId = showToast(tidyCjkSpaces(text), { duration: 2600 })
}

/** The copied boards' firmware right now (source id → sha-256). */
function firmwareOf(c: PartClip): Map<string, string> {
  const bound = useLab.getState().firmware
  const out = new Map<string, string>()
  for (const comp of c.components) {
    const rec = getEntry(comp.type)?.mcu ? bound[comp.id] : undefined
    if (rec) out.set(comp.id, rec.sha256)
  }
  return out
}

/** The clip of `ids` (the selection), or null — with a toast when something was selected. */
function take(ids?: readonly string[]): Held | null {
  const st = useStore.getState()
  const from = ids ?? st.selection
  // a held button is never copied held (the keep-pressed latch is the transient 'pressed')
  const clip = clipFromSelection(stripTransientParams(st.layout), from)
  if (!clip) {
    if (from.length > 0) say(t('Nothing to copy — wires come along with the parts they join|copy-paste'))
    return null
  }
  return { clip, firmware: firmwareOf(clip) }
}

/** Ctrl/⌘+C: the selection into the clip — 「已複製 R1、LED1——按 Ctrl+V 貼上」. */
export function copySelectionWithFeedback(): boolean {
  const next = take()
  if (!next) return false
  held = next
  const names = clipNames(next.clip)
  const keys = shortcutKeysText('paste')
  const wires = leftNames(next.clip)
  say(
    wires
      ? t('{names} copied ({wires} not copied) — {keys} pastes|copy-paste', { names, wires, keys })
      : t('{names} copied — {keys} pastes|copy-paste', { names, keys }),
  )
  return true
}

/**
 * Ctrl/⌘+X: copy, then delete the selection as the Delete key does — with
 * the copied wires that would hang loose (a cut moves them; a paste right
 * after puts everything back where it was). One step; 〔復原〕 undoes it.
 */
export function cutSelectionWithFeedback(): boolean {
  const next = take()
  if (!next) return false
  held = next
  const st = useStore.getState()
  const before = st.layout
  const loose = wiresLeftLoose(before, next.clip).filter((id) => !st.selection.includes(id))
  if (loose.length > 0) st.marqueeSelect([...st.selection, ...loose])
  useStore.getState().removeSelected()
  const after = useStore.getState().layout
  if (after === before) return true
  tick(16) // delete haptic (DESIGN.md §1)
  if (toastId != null) dismissToast(toastId)
  toastId = null
  const names = clipNames(next.clip)
  const keys = shortcutKeysText('paste')
  const wires = leftNames(next.clip) // selected, so cut — but not in the clip
  const text = wires
    ? t('{names} cut ({wires} will not be pasted) — {keys} pastes|copy-paste', { names, wires, keys })
    : t('{names} cut — {keys} pastes|copy-paste', { names, keys })
  undoableToast(tidyCjkSpaces(text), after)
  return true
}

/** Ctrl/⌘+V: the clip onto the board — on the hovered hole `near` when it fits there, else beside its source. */
export function pasteWithFeedback(opts: { near?: HoleRef | null } = {}): boolean {
  if (!held) {
    say(t('Nothing copied yet — select parts, then press {keys}|copy-paste', { keys: shortcutKeysText('copy') }))
    return false
  }
  return place(held, 'paste', opts.near ?? null)
}

/**
 * Ctrl/⌘+D, the selection pill's and the long-press sheet's 「複製」: a copy
 * of `ids` (the selection) beside them, with their settings, at once. The
 * clip Ctrl+V pastes stays as it was.
 */
export function duplicateWithFeedback(ids?: readonly string[]): boolean {
  const next = take(ids)
  return next ? place(next, 'duplicate', null) : false
}

/** Commit a copy (one undo step), give its boards their firmware, and say what happened. */
function place(h: Held, how: 'paste' | 'duplicate', near: HoleRef | null): boolean {
  // one gesture, one insert sound (the watcher honours the mark — even onto an empty board)
  const plan = withMechPaste(() => useStore.getState().pasteParts(h.clip, { near }))
  if (!plan.ok) {
    if (plan.reason === 'no-room') noRoom(h, how)
    else say(t('Nothing to copy — wires come along with the parts they join|copy-paste'))
    return false
  }
  tick() // placement-commit-grade haptic (DESIGN.md §1)
  const files: string[] = []
  let lost = false
  for (const [src, sha256] of h.firmware) {
    const dst = plan.renames[src]
    if (!dst) continue
    const rec = copyFirmware(src, dst, { sha256 })
    if (rec) files.push(rec.name)
    else lost = true
  }
  const names = nameList(selectionNames(plan.layout, plan.ids.length > 0 ? plan.ids : plan.wireIds))
  let text = how === 'paste' ? t('{names} pasted|copy-paste', { names }) : t('Duplicated: {names}|copy-paste', { names })
  if (lost) text = t('{text} (the firmware did not come along)|copy-paste', { text })
  else if (files.length === 1) text = t('{text} (with the firmware {file})|copy-paste', { text, file: files[0] })
  else if (files.length > 1) text = t('{text} (with their firmware)|copy-paste', { text })
  // a duplicate names the selected wires it left behind (a paste said so at the copy)
  const wires = how === 'duplicate' ? leftNames(h.clip) : ''
  // the wires that came along with the parts are named too (persona fix: a rail wire appeared unannounced)
  const n = plan.ids.length > 0 ? plan.wireIds.length : 0
  const brought = n === 0 ? '' : n <= 3 ? t('with wire {ids}|copy-paste', { ids: plan.wireIds.join(t(', ')) }) : t('with {n} wires|copy-paste', { n })
  if (brought && wires) text = t('{text} ({brought}; {wires} not copied)|copy-paste', { text, brought, wires })
  else if (brought) text = t('{text} ({brought})|copy-paste', { text, brought })
  else if (wires) text = t('{text} ({wires} not copied)|copy-paste', { text, wires })
  // the pointer was on a free hole and the copy went elsewhere: say why it is not there
  if (plan.nearMissed) text = t('{text} — it did not fit where the mouse points|copy-paste', { text })
  if (toastId != null) dismissToast(toastId)
  toastId = null
  undoableToast(tidyCjkSpaces(text), useStore.getState().layout)
  return true
}

/** No room for the copy: say so, with 〔加一塊麵包板〕 (grow the rig to the right — else down — and paste again). */
function noRoom(h: Held, how: 'paste' | 'duplicate'): void {
  playMech('refuse') // the copy did not go in: the soft refusal thunk
  if (toastId != null) dismissToast(toastId)
  toastId = showToast(tidyCjkSpaces(t('No free spot on the breadboard for a copy of {names}|copy-paste', { names: clipNames(h.clip) })), {
    duration: 4200,
    action: {
      label: t('Add a breadboard|copy-paste'),
      run: () => {
        const st = useStore.getState()
        if (!st.growGrid('right').ok && !st.growGrid('down').ok) {
          playMech('refuse')
          say(t('The breadboard cannot grow any further — clear a few columns first|copy-paste'))
          return
        }
        place(h, how, null)
      },
    },
  })
}
