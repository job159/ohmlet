/**
 * hints.ts — one-line placement / wire-mode hint copy for the glass toast
 * pills above the dock. This is the old Palette footer hint logic (including
 * lead-by-lead progress) condensed to toast length.
 *
 * New chrome (UX wave SH-5 — everything except isLegacyChrome): every hint
 * says how to get out (「Esc 結束 / 取消」), lead names read as a person
 * says them (pinDisplayName: 「陽極（長腳）→ 陰極（短腳）」, 「第 1 腳」), and
 * a footprint names the row AND what lines up with the clicked hole
 * (「點 h 列的孔位放下（PB12 對齊那個孔）」). The classic chrome keeps the
 * original wording.
 *
 * A finger has no Esc key: on a coarse pointer the way out is the one the
 * screen offers — 「再點一次卡片可取消」 (the Parts card toggles placement),
 * 「點「完成」結束」 (wire strip), 「點空白處取消這條」 (a background tap drops
 * a started wire) — and the R-rotates aside is left out. When the lesson
 * coach armed the placement (its 「拿一顆電阻」 turns into 「放置中」), the
 * way out is that button: 「再按一次「放置中」即可取消」 (UX fix SH-12, TR-19).
 *
 * Wires name both ends the way the rest of the app does (UX helper H2
 * endpointName — 「從 a25（U1 PA0 這一排）拉線」), a committed wire is
 * confirmed (「已接上 … → …」) and a refused one says why (H2
 * wireRefusalText — 「這裡不能接：a25 已經接在這條導線的另一端」). A start
 * on a part pin's hole moves to the free hole of the same strip
 * (「c21 被 U1 PA4 佔用，已改從同一排的 a21 拉線」), any other impossible
 * start is refused at once (「這裡不能接：…——請點同一排的空孔」), and a
 * leads part's refused hole says why (「這裡不能放：a20 已經被導線 W1 佔用」)
 * — release QA SH-F1 / SH-F6 (decisions: edit-feedback.ts).
 *
 * Every zh text leaves here without a space between two Chinese words
 * (release QA SH-F11 — src/i18n/tidy.ts): a name ending in Chinese
 * (「PS1 正端」) runs straight into the next word, 「從 PS1 正端拉線」;
 * spaces next to Latin names stay (「U1 PA5 這一排」).
 */
import { getEntry } from '../../model/catalog'
import type { CatalogEntry } from '../../model/catalog'
import { parseHole, rotateOffsetDelta } from '../../model/breadboard'
import { BOARD_SIZES, STRIP_ROWS } from '../../model/types'
import type { BoardConfig, HoleRef, Rotation } from '../../model/types'
import type { CircuitLayout } from '../../model/types'
import type { InteractionMode } from '../../state/types'
import { useStore, type WireRefusal } from '../../state/store'
import { t } from '../../i18n'
import { tidyCjkSpaces } from '../../i18n/tidy'
import { tc } from '../format'
import { partLabel, pinDisplayName } from '../../i18n/parts'
import { endpointName, wireRefusalText } from '../workspace/hole-chip'
import { isLegacyChrome } from './legacy'
import type { WireStart } from './edit-feedback'

/** Is the primary pointer a finger (no keyboard at hand for Esc / R)? */
export function coarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false
}

/** What armed the placement mode: a library / Parts card, or a lesson coach step button. */
export type ArmedFrom = 'card' | 'coach'

/**
 * A touch hint's way out when the lesson coach armed the mode: its button
 * reads 「放置中」 now, so that is what to press again (not a card the
 * student never touched).
 */
function viaCoach(text: string | null, coach: boolean): string | null {
  if (!text || !coach) return text
  return text
    .replace(tc('tap the card again to cancel', 'exit'), tc('press “Placing” again to cancel', 'exit'))
    .replace(tc('tap the card again to finish', 'exit'), tc('press “Placing” again to finish', 'exit'))
}

/**
 * Toast line for the current interaction mode, or null when none applies.
 * `armedFrom` says what armed a placement (the touch way out names it);
 * `layout` names a started wire's first end (default: the live circuit).
 */
export function hintForMode(
  mode: InteractionMode,
  touch = coarsePointer(),
  armedFrom: ArmedFrom = 'card',
  layout?: CircuitLayout,
): string | null {
  if (isLegacyChrome()) return tidy(classicHint(mode))
  return tidy(viaCoach(modeHint(mode, touch, layout), touch && armedFrom === 'coach'))
}

/** tidyCjkSpaces through a nullable hint. */
function tidy(text: string | null): string | null {
  return text == null ? null : tidyCjkSpaces(text)
}

/** 「已接上 a25（U1 PA0 這一排）→ 上方 − 電源軌第 20 孔」: a committed wire, both ends named (H2). */
export function wireConnectedHint(layout: CircuitLayout, from: string, to: string): string {
  return tidyCjkSpaces(t('Connected {ends}', { ends: arrowJoin([endpointName(layout, from), endpointName(layout, to)]) }))
}

/** 「這裡不能接：a25 已經接在這條導線的另一端」: why a wire click was refused (H2 / H8). */
export function wireRefusedHint(refusal: WireRefusal, layout: CircuitLayout): string {
  return tidyCjkSpaces(t('Can’t wire here: {reason}', { reason: wireRefusalText(refusal, layout) }))
}

/**
 * What a refused or redirected wire START says (release QA SH-F1 —
 * edit-feedback.ts wireStartCheck): 「c21 被 U1 PA4 佔用，已改從同一排的
 * a21 拉線」, 「這裡不能接：a20 已經被導線 W1 佔用——請點同一排的空孔」,
 * 「…——這一排已經沒有空孔」, 「這裡不能接：a90 不在目前的麵包板上」. Null
 * for a start that is fine.
 */
export function wireStartHint(start: WireStart, layout: CircuitLayout): string | null {
  switch (start.kind) {
    case 'ok':
      return null
    case 'redirect': {
      const p = { hole: start.hole, pin: start.pin, free: start.from }
      return tidyCjkSpaces(
        start.rail
          ? t('{hole} is taken by {pin} — wiring from {free} on the same rail instead', p)
          : t('{hole} is taken by {pin} — wiring from {free} in the same row instead', p),
      )
    }
    case 'refuse': {
      const reason = wireRefusalText(start.refusal, layout)
      switch (start.where) {
        case 'row':
          return tidyCjkSpaces(t('Can’t wire here: {reason} — tap a free hole in the same row', { reason }))
        case 'rail':
          return tidyCjkSpaces(t('Can’t wire here: {reason} — tap a free hole on the same rail', { reason }))
        case 'row-full':
          return tidyCjkSpaces(t('Can’t wire here: {reason} — this row has no free hole left', { reason }))
        case 'rail-full':
          return tidyCjkSpaces(t('Can’t wire here: {reason} — this rail has no free hole left', { reason }))
        default:
          return wireRefusedHint(start.refusal, layout)
      }
    }
  }
}

/** 「這裡不能放：a20 已經被導線 W1 佔用」: a leads / probe part's refused hole (release QA SH-F6). */
export function placementSpotRefusedHint(reason: string): string {
  return tidyCjkSpaces(t('Can’t place here: {reason}', { reason }))
}

/** The anchor row of a footprint part ('h' for the Blue Pill). */
export function footprintRow(entry: CatalogEntry): string {
  return entry.footprintOffsets?.[0]?.row ?? 'f'
}

/** The pin that lands on the clicked hole: an MCU's port name ('PB12'), else the display name. */
export function anchorPinName(entry: CatalogEntry): string {
  const pin = entry.pins[0] ?? ''
  if (entry.mcu) return entry.mcu.pinMap[pin] ?? pin
  return pinDisplayName(entry, pin)
}

/** 「陽極（長腳）→ 陰極（短腳）」: ' → ' between names, no space after a full-width bracket. */
export function arrowJoin(names: readonly string[]): string {
  return names.reduce((out, n, i) => (i === 0 ? n : `${out}${/[）」』]$/.test(out) ? '' : ' '}→ ${n}`), '')
}

/** New-chrome hints (UX wave SH-5); `touch` swaps the key names for on-screen exits. */
function modeHint(mode: InteractionMode, touch: boolean, layout?: CircuitLayout): string | null {
  switch (mode.kind) {
    case 'select':
      return null

    case 'wire':
      if (mode.from) {
        // the first end as everything else names it (H2): 「a25（U1 PA0 這一排）」, 「PS1 正端」
        // (hintForMode tidies the spaces: 「從 PS1 正端拉線」)
        const p = { from: endpointName(layout ?? useStore.getState().layout, mode.from) }
        return touch
          ? t('Wire from {from}: tap the second hole · tap empty space to cancel this one', p)
          : t('Wire from {from}: tap the second hole · Esc cancels this one', p)
      }
      return touch
        ? t('Wire mode: tap two holes or terminals in turn · tap “Done” to finish')
        : t('Wire mode: tap two holes or terminals in turn · Esc to finish')

    case 'place': {
      const entry = getEntry(mode.type)
      if (!entry) return t('Unknown component type "{type}"', { type: mode.type })
      const part = partLabel(entry)
      switch (entry.placement) {
        case 'offboard':
          return t('{part} added beside the board — wire its terminals', { part })
        case 'dip': {
          const p = { part, n: entry.pins.length }
          return touch
            ? t('{part}: tap the pin-1 hole in row f (DIP-{n} straddles the channel) · tap the card again to cancel', p)
            : t('{part}: tap the pin-1 hole in row f (DIP-{n} straddles the channel) · Esc to cancel', p)
        }
        case 'footprint': {
          const p = { part, row: footprintRow(entry), pin: anchorPinName(entry) }
          return touch
            ? t('{part}: tap a hole in row {row} to drop it ({pin} lands on that hole) · tap the card again to cancel', p)
            : t('{part}: tap a hole in row {row} to drop it ({pin} lands on that hole) · R rotates · Esc to cancel', p)
        }
        case 'probe':
          return touch
            ? t('{part}: tap a hole on the net you want to plot · tap the card again to cancel', { part })
            : t('{part}: tap a hole on the net you want to plot · Esc to cancel', { part })
        case 'leads': {
          const n = entry.pins.length
          const placed = mode.pickedHoles.length
          if (placed === 0) {
            if (n === 1) {
              return touch
                ? t('{part}: tap a hole to place it · tap the card again to cancel', { part })
                : t('{part}: tap a hole to place it · Esc to cancel', { part })
            }
            const p = { part, n, pins: arrowJoin(entry.pins.map((pin) => pinDisplayName(entry, pin))) }
            return touch
              ? t('{part}: tap {n} holes in turn ({pins}) · tap the card again to cancel', p)
              : t('{part}: tap {n} holes in turn ({pins}) · Esc to cancel', p)
          }
          const next = entry.pins[Math.min(placed, n - 1)]
          const p = { i: Math.min(placed + 1, n), n, pin: pinDisplayName(entry, next) }
          return touch
            ? t('Lead {i}/{n}: tap the hole for “{pin}” · tap the card again to cancel', p)
            : t('Lead {i}/{n}: tap the hole for “{pin}” · Esc to cancel', p)
        }
      }
    }
  }
}

/** Toast after a leads part is committed and placement re-arms (repeat placement). */
export function placedAgainHint(id: string, touch = coarsePointer(), armedFrom: ArmedFrom = 'card'): string {
  const text = touch
    ? t('Placed {id} — keep tapping holes to place another · tap the card again to finish', { id })
    : t('Placed {id} — keep tapping holes to place another · Esc to finish', { id })
  return tidyCjkSpaces(viaCoach(text, touch && armedFrom === 'coach') ?? text)
}

/** Which edge of the board a package would run off. */
export type PackageOverflow = 'left' | 'right' | 'rows'

/** Where a refused dip / footprint drop was aimed (App.tsx probes it). */
export interface RefusalWhere {
  /** the clicked hole */
  hole: HoleRef
  /** the rows of the clicked column where the part WOULD fit (empty: none) — rotation-aware */
  fitRows?: readonly string[]
  /** the package anchored at `hole` (in a row it can take) runs off this edge of the board */
  overflow?: PackageOverflow | null
  /** the armed rotation (the unrotated anchor row is only known at 0) */
  rotation?: Rotation
}

/** The row a package's anchor takes when it is not rotated: f for a DIP (pin 1), the footprint's own row. */
export function anchorRowOf(entry: CatalogEntry): string {
  return entry.placement === 'dip' ? 'f' : footprintRow(entry)
}

/**
 * Which edge of the board a dip / footprint package anchored at `hole` runs
 * off with `rotation` (null = inside the board's bounds, or not a package /
 * not a strip hole). Bounds only — the row rule (a footprint's anchor row,
 * a DIP's pin 1 in row f) is the caller's other question.
 */
export function packageOverflow(
  entry: CatalogEntry,
  hole: HoleRef,
  config: Pick<BoardConfig, 'size' | 'count'>,
  rotation: Rotation = 0,
): PackageOverflow | null {
  const at = parseHole(hole)
  if (!at || at.kind !== 'strip') return null
  const maxCol = BOARD_SIZES[config.size ?? 'standard'].cols * (config.count ?? 1)
  let lo = at.col
  let hi = at.col
  let rowsOff = false
  if (entry.placement === 'dip') {
    hi = at.col + Math.ceil(entry.pins.length / 2) - 1
  } else if (entry.placement === 'footprint' && entry.footprintOffsets?.length) {
    const offsets = entry.footprintOffsets
    const anchorIdx = STRIP_ROWS.indexOf(offsets[0].row)
    const atIdx = STRIP_ROWS.indexOf(rotation === 0 ? offsets[0].row : at.row)
    for (const o of offsets) {
      const d = rotateOffsetDelta(o.dCol, STRIP_ROWS.indexOf(o.row) - anchorIdx, rotation)
      lo = Math.min(lo, at.col + d.dCol)
      hi = Math.max(hi, at.col + d.dCol)
      const r = atIdx + d.dRow
      if (r < 0 || r >= STRIP_ROWS.length) rowsOff = true
    }
  } else {
    return null
  }
  if (hi > maxCol) return 'right'
  if (lo < 1) return 'left'
  return rowsOff ? 'rows' : null
}

/**
 * Why a dip / footprint drop was refused (UX fix SH-11 — the REAL reason):
 *   1. the clicked row cannot take the anchor (a footprint off its row, a
 *      DIP not straddling e / f) → 「它要跨在中央溝槽上——請點 h 列（藍色
 *      標示）的孔位（PB12 對齊那個孔）」, whatever the validator says (a
 *      wrong row reads to it as "off the board");
 *   2. the row is right but the package runs off an edge → 「右邊超出麵包板
 *      ——請往左移，或在「更多 → 麵包板尺寸」改用實驗室 XL」;
 *   3. otherwise the validator's reason (occupied, covered, a module seam…),
 *      else the channel rule.
 * Without `where` (older callers) only 3 applies. Mouse and touch read the
 * same (no key is named).
 */
export function placementRefusedHint(entry: CatalogEntry, reason: string | null, where?: RefusalWhere): string {
  return tidyCjkSpaces(refusedDropText(entry, reason, where))
}

function refusedDropText(entry: CatalogEntry, reason: string | null, where?: RefusalWhere): string {
  const part = partLabel(entry)
  const at = where ? parseHole(where.hole) : null
  if (at && at.kind === 'strip' && (entry.placement === 'footprint' || entry.placement === 'dip')) {
    const anchor = anchorRowOf(entry)
    const fit = where?.fitRows
    // the row that works: the probe's answer (rotation-aware); with no fitting
    // row at all (the column is taken), the unrotated anchor row when known
    const rowWrong =
      fit && fit.length > 0 ? !fit.includes(at.row) : (where?.rotation ?? 0) === 0 && at.row !== anchor
    if (rowWrong) {
      const row = fit && fit.length > 0 && !fit.includes(anchor) ? fit[0] : anchor
      return entry.placement === 'footprint'
        ? t('{part} doesn’t fit here: it must straddle the centre channel — tap a hole in row {row} (marked in blue) ({pin} lands on that hole)', {
            part,
            row,
            pin: anchorPinName(entry),
          })
        : t('{part} doesn’t fit here: it must straddle the centre channel — tap a hole in row {row} (marked in blue)', { part, row })
    }
    const over = where?.overflow ?? null
    if (over) {
      const p = { part, xl: t(BOARD_SIZES.labxl.label) }
      return over === 'right'
        ? t('{part} doesn’t fit here: it runs off the right edge of the board — move it left, or switch to the {xl} board (More → Board size)', p)
        : over === 'left'
          ? t('{part} doesn’t fit here: it runs off the left edge of the board — move it right', p)
          : t('{part} doesn’t fit here: it runs off the board — pick a hole nearer the middle', p)
    }
  }
  // the validator opens with "component X (label) pin 1 at e45 doesn't fit —":
  // the toast names the part already, keep only the why + the fix
  if (reason) {
    for (const sep of ['——', ' — ']) {
      const i = reason.indexOf(sep)
      if (i > 0 && reason.slice(0, i).includes(part) && reason.length > i + sep.length) {
        reason = reason.slice(i + sep.length)
        break
      }
    }
  }
  return reason
    ? t('{part} doesn’t fit here: {reason}', { part, reason })
    : t('{part} doesn’t fit here: it must straddle the centre channel — tap a hole in row {row}', {
        part,
        row: entry.placement === 'footprint' ? footprintRow(entry) : 'f',
      })
}

/** The original (classic chrome) wording. */
function classicHint(mode: InteractionMode): string | null {
  switch (mode.kind) {
    case 'select':
      return null

    case 'wire':
      return mode.from
        ? t('Wire from {from} — tap the second hole or terminal', { from: mode.from })
        : t('Wire mode — tap two holes or terminals to connect them')

    case 'place': {
      const entry = getEntry(mode.type)
      if (!entry) return t('Unknown component type "{type}"', { type: mode.type })
      const part = partLabel(entry)
      switch (entry.placement) {
        case 'offboard':
          return t('{part} added beside the board — wire its terminals', { part })
        case 'dip': {
          const n = entry.pins.length
          return t('{part}: tap the pin-1 hole in row f (DIP-{n} straddles the channel)', { part, n })
        }
        case 'footprint': {
          const row = entry.footprintOffsets?.[0]?.row ?? 'f'
          return t('{part}: tap the {pin} anchor hole (row {row})', { part, pin: entry.pins[0], row })
        }
        case 'probe':
          return t('{part}: tap a hole on the net you want to plot', { part })
        case 'leads': {
          const n = entry.pins.length
          const placed = mode.pickedHoles.length
          if (placed === 0) {
            return n === 1
              ? t('{part}: tap a hole to place it', { part })
              : t('{part}: tap {n} holes — pin order {order}', { part, n, order: entry.pins.join(' → ') })
          }
          const next = entry.pins[Math.min(placed, n - 1)]
          return t("Lead {i} of {n} — tap the hole for '{pin}'", { i: Math.min(placed + 1, n), n, pin: next })
        }
      }
    }
  }
}
