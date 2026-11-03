/**
 * PartsSheet — the iOS-grade component browser (DESIGN.md §2 "Parts").
 *
 * Self-contained: renders the kit <Sheet> itself (snaps peek/half/full —
 * 0.28 / 0.55 / 0.92; desktop = floating glass panel anchored left).
 * Search filters by label/type/tags/part number (partMatches), horizontally
 * scrollable category chips, 2-column grid of part cards in library order
 * (src/ui/workspace/library-order.ts: 「全部」 opens with the everyday
 * parts under a 「常用元件」 label, then the rest under their category
 * names; a search ranks by match quality; classic chrome keeps the
 * original flat order) with
 * schematic-style SVG glyphs and — for anything short of a full model —
 * the simulation support badge (supportOf(entry)). Tapping a
 * card arms placement mode (store.setMode place) with a haptic and drops
 * the sheet to the peek snap so the canvas is free for placing while the
 * sheet stays reachable. The armed card shows a blue "Placing" state while
 * its type is the active placement mode. Placement hint text is the shell's
 * job (toasts) — not duplicated here.
 *
 * The catalog helpers + glyphs are exported for the desktop workspace's
 * Library panel (src/ui/workspace/LibraryPanel.tsx) so both browsers speak
 * one vocabulary.
 *
 * New chrome (release QA SC-F3): the desktop library's segmented control
 * 「元件庫｜範例」 heads the sheet (課程 has its own dock tab). 範例 is the
 * workspace's very list (LibraryPanel ExampleLibrary — examples.ts
 * sections, the same 開啟範例 with its confirmation, the same tray
 * instrument), and an opened example brings that instrument up in the 儀器
 * sheet (revealInstrument open) — or, without one, gives the board back.
 * The sheet opens on 元件庫; showPartsSheetSegment('examples') before
 * opening it (the shell's 「範例 ›」, SH-F7) — or while it is open —
 * shows 範例. While open the sheet reports its resting height to the scene
 * bridge (partsSheetCover — the phone's place framing keeps the board above
 * the peek, SC-F1). The classic chrome keeps the parts-only sheet.
 *
 * Usage:
 *   <PartsSheet open={partsOpen} onDismiss={() => setPartsOpen(false)}
 *     desktop={isDesktop} />
 *   showPartsSheetSegment('examples'); setActiveSheet('parts')
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Sheet, Segmented, pressProps, tick, CloseIcon } from '../kit'
import { useStore } from '../../state/store'
import {
  getEntry,
  supportOf,
  type CatalogEntry,
  type ComponentCategory,
  type SupportLevel,
} from '../../model/catalog'
import {
  CATEGORY_ORDER,
  LEGACY_CATEGORY_ORDER,
  orderedCatalog,
  rankByMatch,
  sheetGroups,
  type PartSearchFields,
  type SheetGroup,
} from '../workspace/library-order'
import { SupportBadge } from '../embedded/PartInfo'
import { useLegacyChrome } from '../chrome/legacy'
import { editCue } from '../chrome/edit-feedback'
import { partKeyOf, partKeyTitle } from '../chrome/part-keys'
import { t, useLang } from '../../i18n'
import { partLabel } from '../../i18n/parts'
import { ProbeMenuHost } from '../workspace/ProbeMenu'
import { partsBrowsing, partsSheetCover } from '../workspace/scene-bridge'
import { ExampleLibrary } from '../workspace/LibraryPanel'
import { exampleMainInstrument, type LibraryExample } from '../workspace/examples'
import { revealInstrument } from '../embedded/instruments/instrument-request'
import './PartsSheet.css'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** peek (place-on-canvas) / half (browse) / full (search + scroll) */
const SNAPS = [0.28, 0.55, 0.92] as const
const HALF = 1
const PEEK = 0
const FULL = 2

// the library order lives in one pure module (usage order; classic chrome keeps the original)
export { CATEGORY_ORDER, orderedCatalog } from '../workspace/library-order'

/** English category names (translate for display with categoryText()). */
export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  passive: 'Passives',
  semiconductor: 'Semis',
  switch: 'Switches',
  display: 'Displays',
  ic: 'ICs',
  power: 'Power',
  instrument: 'Instruments',
  mcu: 'MCU',
  sensor: 'Sensors',
  module: 'Modules',
  motor: 'Motors',
}

/** Localised category name (被動元件 / 半導體 / … in zh-TW). */
export function categoryText(c: ComponentCategory): string {
  return t(CATEGORY_LABELS[c])
}

/** Placement summary for a card / header ("2 leads" → 2 支引腳). Localised. */
export function placementMeta(entry: CatalogEntry): string {
  switch (entry.placement) {
    case 'leads':
      return t('{n} leads', { n: entry.pins.length })
    case 'dip':
      return `DIP-${entry.pins.length}`
    case 'footprint':
      return t('{n}-pin', { n: entry.pins.length })
    case 'offboard':
      return t('off-board')
    case 'probe':
      return t('probe')
  }
}

/** Screen-reader phrasing of the support level (English; supportSpoken()
 *  localises). */
export const SUPPORT_SPOKEN: Record<SupportLevel, string> = {
  full: 'fully simulated',
  partial: 'partially simulated',
  visual: 'visual only, not simulated',
  dev: 'in development, not placeable',
}

/** Localised screen-reader phrasing of the support level. */
export function supportSpoken(level: SupportLevel): string {
  return t(SUPPORT_SPOKEN[level])
}

/**
 * Library search: every whitespace-separated term must match the label,
 * type key, part number, manufacturer or one of the search tags
 * (case-insensitive) — "stm32 f103", "blue pill", "i2c" all find parts.
 * The localised part name and category also match (電阻, 感測器 …).
 */
export function partMatches(entry: CatalogEntry, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const hay = [
    entry.label,
    entry.type,
    entry.type.replace(/_/g, ' '),
    entry.meta?.partNumber ?? '',
    entry.meta?.manufacturer ?? '',
    ...(entry.meta?.tags ?? []),
    partLabel(entry),
    categoryText(entry.category),
  ]
    .join('\n')
    .toLowerCase()
  return terms.every((t) => hay.includes(t))
}

/**
 * The fields search results are RANKED by (library-order.ts rankByMatch):
 * the names (UI language, English, type key, part number) above the tags
 * (search tags, maker, category name + `extraTags`). The same texts
 * partMatches filters on.
 */
export function partSearchFields(entry: CatalogEntry, extraTags: readonly string[] = []): PartSearchFields {
  return {
    names: [partLabel(entry), entry.label, entry.type, entry.meta?.partNumber ?? ''],
    tags: [...(entry.meta?.tags ?? []), entry.meta?.manufacturer ?? '', categoryText(entry.category), ...extraTags],
  }
}

// ---------------------------------------------------------------------------
// Schematic glyphs — 48x28 grid, stroke = currentColor (tinted per category)
// ---------------------------------------------------------------------------

function G({ children }: { children: ReactNode }) {
  return (
    <svg
      width="54"
      height="31"
      viewBox="0 0 48 28"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

const ZIGZAG = 'M2 14h6l3-7 5 14 5-14 5 14 5-14 5 14 3-7h7'

export function PartGlyph({ entry }: { entry: CatalogEntry }) {
  switch (entry.type) {
    case 'resistor':
      return (
        <G>
          <path d={ZIGZAG} />
        </G>
      )
    case 'capacitor':
      return (
        <G>
          <path d="M2 14h17M29 14h17M19 5v18M29 5v18" />
        </G>
      )
    case 'inductor':
      return (
        <G>
          <path d="M2 14h6a4 4 0 0 1 8 0 4 4 0 0 1 8 0 4 4 0 0 1 8 0 4 4 0 0 1 8 0h6" />
        </G>
      )
    case 'potentiometer':
      return (
        <G>
          <path d={ZIGZAG} />
          <path d="M14 26 33 5M28 5.6l5-.6-.6 5" strokeWidth={1.6} />
        </G>
      )
    case 'photoresistor':
      return (
        <G>
          <path d={ZIGZAG} />
          <path d="M4 2l5 4M7 6.4 9 6l-.4-2M11 1l5 4M13.8 5.4l2.2-.4-.4-2.2" strokeWidth={1.4} />
        </G>
      )
    case 'led':
      return (
        <G>
          <path d="M2 14h12M34 14h12M14 6l20 8-20 8zM34 6v16" />
          <path d="M31 8l5-5M33 3h3v3M36 13l5-5M38 8h3v3" strokeWidth={1.4} />
        </G>
      )
    case 'pushbutton':
      return (
        <G>
          <path d="M2 18h12M34 18h12M14 8h20M24 8V3" />
          <circle cx="16" cy="18" r="2" fill="currentColor" stroke="none" />
          <circle cx="32" cy="18" r="2" fill="currentColor" stroke="none" />
        </G>
      )
    case 'seven_segment':
      return (
        <G>
          <rect x="14" y="2" width="20" height="24" rx="3" />
          <path d="M20 7h8M20 14h8M20 21h8M20 7v14M28 7v14" strokeWidth={1.6} />
        </G>
      )
    case 'buzzer':
      return (
        <G>
          <path d="M12 11h5l7-6v18l-7-6h-5z" />
          <path d="M29 10a6 6 0 0 1 0 8M33.5 7a11 11 0 0 1 0 14" strokeWidth={1.6} />
        </G>
      )
    case 'function_generator':
      return (
        <G>
          <rect x="10" y="4" width="28" height="20" rx="4" />
          <path d="M15 14c2.5-7 6.5-7 9 0s6.5 7 9 0" strokeWidth={1.6} />
        </G>
      )
    case 'logic_probe':
      return (
        <G>
          <path d="M3 20h7V8h8v12h8V8h8v12h11" />
        </G>
      )
    case 'multimeter':
      return (
        <G>
          <rect x="13" y="2" width="22" height="24" rx="3.5" />
          <rect x="17" y="5.5" width="14" height="6" rx="1" strokeWidth={1.4} />
          <circle cx="24" cy="18.5" r="3.6" strokeWidth={1.6} />
        </G>
      )
    default:
      break
  }
  switch (entry.category) {
    case 'semiconductor':
      // diode triangle + bar; BJTs/MOSFETs get the TO-92 half-moon
      if (entry.type === 'diode') {
        return (
          <G>
            <path d="M2 14h12M34 14h12M14 6l20 8-20 8zM34 6v16" />
          </G>
        )
      }
      return (
        <G>
          <path d="M14 18a10 10 0 0 1 20 0z" />
          <path d="M18 18v8M24 18v8M30 18v8" />
        </G>
      )
    case 'switch':
      return (
        <G>
          <path d="M2 14h10M36 14h10M16 13 32 4" />
          <circle cx="14" cy="14" r="2" fill="currentColor" stroke="none" />
          <circle cx="34" cy="14" r="2" fill="currentColor" stroke="none" />
        </G>
      )
    case 'display':
      return (
        <G>
          <rect x="14" y="2" width="20" height="24" rx="3" />
          <path d="M20 7h8M20 14h8M20 21h8M20 7v14M28 7v14" strokeWidth={1.6} />
        </G>
      )
    case 'ic':
      return (
        <G>
          <rect x="12" y="6" width="24" height="16" rx="2" />
          <path d="M16 6V2M24 6V2M32 6V2M16 22v4M24 22v4M32 22v4" />
          <path d="M21.5 6a2.5 2.5 0 0 0 5 0" strokeWidth={1.4} />
        </G>
      )
    case 'power':
      return (
        <G>
          <path d="M2 14h18M28 14h18M20 4v20M28 9v10" />
          <path d="M8 5h5M10.5 2.5v5" strokeWidth={1.4} />
        </G>
      )
    case 'instrument':
      return (
        <G>
          <circle cx="20" cy="11" r="7.5" />
          <path d="M25.5 16.5 35 26M20 11l3.5-3.5" strokeWidth={1.6} />
        </G>
      )
    case 'mcu':
      // dev board: PCB with two header rows, the MCU, USB at the pin-1 end
      return (
        <G>
          <rect x="4" y="5" width="41" height="18" rx="2.5" />
          <path d="M1.5 11.5h2.5v5H1.5" strokeWidth={1.6} />
          <rect x="19" y="9.5" width="10" height="9" rx="1.3" strokeWidth={1.6} />
          <path
            d="M9 8.2h0M13 8.2h0M17 8.2h0M31 8.2h0M35 8.2h0M39 8.2h0M9 19.8h0M13 19.8h0M17 19.8h0M31 19.8h0M35 19.8h0M39 19.8h0"
            strokeWidth={2.4}
          />
        </G>
      )
    case 'sensor':
      // breakout board carrying a sensing element
      return (
        <G>
          <rect x="10" y="3" width="28" height="22" rx="2.5" />
          <circle cx="24" cy="12" r="5" strokeWidth={1.6} />
          <path d="M15 21.5h0M20 21.5h0M25 21.5h0M30 21.5h0M35 21.5h0" strokeWidth={2.4} />
        </G>
      )
    case 'module':
      return (
        <G>
          <rect x="8" y="4" width="32" height="20" rx="2.5" />
          <rect x="13" y="8" width="16" height="10" rx="1" strokeWidth={1.4} />
          <path d="M34 8.5h0M34 13h0M34 17.5h0" strokeWidth={2.4} />
        </G>
      )
    case 'motor':
      return (
        <G>
          <circle cx="24" cy="14" r="10" />
          <path d="M19.5 18.5v-9l4.5 6 4.5-6v9" strokeWidth={1.6} />
          <path d="M2 14h12M34 14h12" />
        </G>
      )
    case 'passive':
    default:
      return (
        <G>
          <path d={ZIGZAG} />
        </G>
      )
  }
}

// ---------------------------------------------------------------------------
// Search field — iOS search bar (magnifier, clear button, no-zoom 17px text)
// ---------------------------------------------------------------------------

function SearchField({
  value,
  onChange,
  onFocus,
}: {
  value: string
  onChange: (v: string) => void
  onFocus?: () => void
}) {
  return (
    <div className="psh-search">
      <span className="psh-search-icon" aria-hidden="true">
        <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="7.2" cy="7.2" r="5.2" />
          <path d="M11.2 11.2 15 15" />
        </svg>
      </span>
      <input
        className="psh-search-input"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        placeholder={t('Search parts')}
        aria-label={t('Search parts')}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
      />
      {value !== '' && (
        <button
          type="button"
          className="psh-search-clear lg-pressable"
          aria-label={t('Clear search')}
          {...pressProps}
          onClick={() => onChange('')}
        >
          <CloseIcon size={13} />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

export interface PartsSheetProps {
  open: boolean
  /** Called when the user dismisses the sheet (swipe down / scrim / Esc). */
  onDismiss: () => void
  /** Render as the desktop floating panel (anchored left) instead. */
  desktop?: boolean
}

type CatFilter = 'all' | ComponentCategory

/**
 * The parts grid for a chip + query (exported for tests): classic chrome —
 * the original flat list; a query — one list, best matches first
 * (rankByMatch: a name before a tag, the usage order breaks ties); 「全部」
 * — 「常用元件」, then the rest under their category names (sheetGroups);
 * a category chip — that category in usage order.
 */
export function sheetPartGroups(legacy: boolean, cat: CatFilter, query: string): SheetGroup[] {
  const list = orderedCatalog({ legacy }).filter((e) => (cat === 'all' || e.category === cat) && partMatches(e, query))
  if (legacy) return [{ key: 'all', entries: list }]
  if (query.trim() !== '') return [{ key: 'all', entries: rankByMatch(list, query, (e) => partSearchFields(e)) }]
  return cat === 'all' ? sheetGroups(list) : [{ key: 'all', entries: list }]
}

/** The sheet's two views (new chrome): the parts library and the example library. */
export type PartsSheetSegment = 'parts' | 'examples'

/** English sources of the segment labels — the workspace library's own tab names (t() per render). */
const SEGMENTS: { value: PartsSheetSegment; label: string }[] = [
  { value: 'parts', label: 'Library' },
  { value: 'examples', label: 'Examples' },
]

/** A segment asked for before the sheet opened (consumed by the next opening). */
let pendingSegment: PartsSheetSegment | null = null
const segmentSubs = new Set<(segment: PartsSheetSegment) => void>()

/**
 * Show `segment` in the Parts sheet (release QA SC-F3 — the shell's
 * 「範例 ›」, SH-F7): call it, then open the sheet (App: setActiveSheet
 * ('parts')); a sheet already open switches at once. Without a request the
 * sheet opens on 元件庫. The classic chrome has no segments (ignored there).
 */
export function showPartsSheetSegment(segment: PartsSheetSegment): void {
  pendingSegment = segment
  for (const fn of segmentSubs) fn(segment)
}

/** The open phone sheet rests at its peek (its cards under the dock — persona fix). */
let peekOpen = false
const raiseSubs = new Set<() => void>()

/** Does the open phone parts sheet rest at its peek? (the dock's 元件 then raises it — App onDock) */
export function partsSheetAtPeek(): boolean {
  return peekOpen
}

/**
 * Raise the open phone parts sheet from its peek to its resting half (the
 * dock's 元件 while the sheet peeks — persona fix: that tap closed the sheet,
 * and the next card took a second tap). Placing stays armed.
 */
export function raisePartsSheet(): void {
  for (const fn of raiseSubs) fn()
}

/**
 * The segment the next opening shows (consumes a pending request). Exported
 * for tests.
 */
export function takePartsSheetSegment(): PartsSheetSegment {
  const s = pendingSegment ?? 'parts'
  pendingSegment = null
  return s
}

/**
 * An example opened from the sheet (SC-F3): its main instrument comes up in
 * the 儀器 sheet like the workspace tray opens on it (the App swaps the
 * sheets); an example without one gives the board back.
 */
export function afterExampleOpened(ex: Pick<LibraryExample, 'instruments' | 'key'>, dismiss: () => void): void {
  const tab = exampleMainInstrument(ex)
  if (tab && revealInstrument(tab, { open: true })) return
  dismiss()
}

/**
 * The phone parts sheet went from open to closed (`was` → `open`): placing
 * ends (product chrome; the desktop panel and the classic chrome keep it —
 * a mouse's ghost follows the pointer there, and the classic chrome keeps
 * its original behaviour). Persona fix: after a swipe down or the dock's
 * 元件 nothing on screen said a part was still armed, and the next tap on
 * the board silently started one.
 */
export function endPlacingOnPartsClose(was: boolean, open: boolean, opts: { desktop: boolean; legacy: boolean }): void {
  if (!was || open || opts.desktop || opts.legacy) return
  const st = useStore.getState()
  if (st.mode.kind === 'place') st.setMode({ kind: 'select' })
}

export function PartsSheet({ open, onDismiss, desktop = false }: PartsSheetProps) {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const lang = useLang()
  const legacy = useLegacyChrome()

  const [snap, setSnap] = useState<number>(HALF)
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<CatFilter>('all')
  const [segment, setSegment] = useState<PartsSheetSegment>('parts')
  const openRef = useRef(open)
  openRef.current = open
  // the classic chrome keeps the parts-only sheet
  const view: PartsSheetSegment = legacy ? 'parts' : segment

  // fresh presentation each time the sheet opens (on 元件庫, unless 範例 was asked for)
  useEffect(() => {
    if (!open) return
    setSnap(HALF)
    setSegment(takePartsSheetSegment())
  }, [open])

  // 「範例 ›」 while the sheet is already open: switch now
  useEffect(() => {
    const on = (next: PartsSheetSegment) => {
      if (!openRef.current) return
      pendingSegment = null
      setSegment(next)
    }
    segmentSubs.add(on)
    return () => {
      segmentSubs.delete(on)
    }
  }, [])

  // the dock's 元件 while the sheet peeks: raise it (persona fix — partsSheetAtPeek / raisePartsSheet)
  useEffect(() => {
    peekOpen = open && !desktop && snap === PEEK
    return () => {
      peekOpen = false
    }
  }, [open, desktop, snap])
  useEffect(() => {
    const on = () => {
      if (openRef.current) setSnap(HALF)
    }
    raiseSubs.add(on)
    return () => {
      raiseSubs.delete(on)
    }
  }, [])

  // SC-16: on a phone the scene shows its grow paddles while this library is open
  // (the parts library — not the examples)
  useEffect(() => {
    if (desktop) return
    partsBrowsing(open && view === 'parts')
    return () => partsBrowsing(false)
  }, [open, desktop, view])

  // SC-F1: how much of the screen's bottom the sheet covers where it rests —
  // the phone's place framing keeps the board above a tapped card's peek
  useEffect(() => {
    if (desktop || typeof window === 'undefined') return
    partsSheetCover(open ? Math.round(SNAPS[snap] * window.innerHeight) : 0)
    return () => partsSheetCover(0)
  }, [open, snap, desktop])

  // persona fix (product chrome, phone): closing the sheet — a swipe down,
  // the dock's 元件, the scrim — ends placing. The armed card and its
  // 「放置中」 line leave with it, so nothing on screen would say that the
  // next tap on the board starts a part.
  const wasOpen = useRef(open)
  useEffect(() => {
    const was = wasOpen.current
    wasOpen.current = open
    endPlacingOnPartsClose(was, open, { desktop, legacy })
  }, [open, desktop, legacy])

  const armedType = mode.kind === 'place' ? mode.type : null
  // new chrome (SC-7): while a part is armed the phone sheet sits at its peek
  // snap with the armed card under the dock — say what is armed and how to
  // stop right under the title (classic chrome: unchanged)
  const armedEntry = !legacy && armedType ? getEntry(armedType) : undefined

  const groups = useMemo(
    () => sheetPartGroups(legacy, cat, query),
    // lang: partMatches also matches the localised part / category names
    [query, cat, lang, legacy],
  )

  const onCard = (entry: CatalogEntry) => {
    // 'dev' parts are listed (an honest roadmap) but never placeable
    if (supportOf(entry).level === 'dev') return
    tick()
    if (armedType === entry.type) {
      // tapping the armed card cancels placement
      setMode({ kind: 'select' })
      return
    }
    // an off-board part (supply, meter…) is placed by arming it: that is its placement commit
    const before = useStore.getState().layout.components.length
    setMode({ kind: 'place', type: entry.type, pickedHoles: [] })
    if (useStore.getState().layout.components.length > before) editCue('place')
    // drop to peek so the canvas is free to place on — NOT a full dismiss
    if (!desktop) setSnap(PEEK)
  }

  return (
    <>
      {/* SC-14: the phone's touch probe sheet (a long-press on a hole / pin) —
          the desktop workspace mounts its own host */}
      {!desktop && <ProbeMenuHost />}
      <Sheet
        open={open}
        onDismiss={onDismiss}
        snapPoints={SNAPS}
        activeSnap={snap}
        onSnapChange={setSnap}
        desktop={desktop}
        anchor="left"
        ariaLabel={t('Parts')}
        className="psh"
      >
        <div className="psh-body">
          {legacy ? (
            <div className="psh-title lg-headline">{t('Parts')}</div>
          ) : (
            // SC-F3: the workspace library's own tabs (課程 is a dock tab of its own)
            <Segmented<PartsSheetSegment>
              className="psh-segments"
              value={view}
              onChange={setSegment}
              options={SEGMENTS.map((o) => ({ value: o.value, label: t(o.label) }))}
              aria-label={t('Parts sheet view')}
            />
          )}
          {view === 'examples' ? (
            <ExampleLibrary
              sheet
              desktop={desktop}
              onOpened={(ex) => afterExampleOpened(ex, onDismiss)}
              onSearchFocus={() => {
                if (!desktop) setSnap(FULL)
              }}
            />
          ) : (
            <PartsView
              armedEntry={armedEntry}
              query={query}
              setQuery={setQuery}
              cat={cat}
              setCat={setCat}
              groups={groups}
              armedType={armedType}
              legacy={legacy}
              onSearchFocus={() => {
                if (!desktop) setSnap(FULL)
              }}
              onCard={onCard}
            />
          )}
        </div>
      </Sheet>
    </>
  )
}

/** The parts library view of the sheet (the classic chrome's whole sheet body under its title). Exported for tests. */
export function PartsView({
  armedEntry,
  query,
  setQuery,
  cat,
  setCat,
  groups,
  armedType,
  legacy,
  onSearchFocus,
  onCard,
}: {
  armedEntry: CatalogEntry | undefined
  query: string
  setQuery: (q: string) => void
  cat: CatFilter
  setCat: (c: CatFilter) => void
  /** the grid's runs: one headerless 'all' run, or 常用元件 + the categories (全部 in the product chrome) */
  groups: SheetGroup[]
  armedType: string | null
  legacy: boolean
  onSearchFocus: () => void
  onCard: (entry: CatalogEntry) => void
}) {
  const grid = (entries: CatalogEntry[]) => (
    <div className="psh-grid">
      {entries.map((entry) => {
        const armed = armedType === entry.type
        const level = supportOf(entry).level
        // round 5 part keys (part-keys.ts — product chrome): R 電阻, C 電容 … as a
        // corner keycap (mouse pointers only: CSS; 「放置中」 takes the corner while armed)
        const hotkey = legacy ? null : partKeyOf(entry.type)
        return (
          <button
            key={entry.type}
            type="button"
            className={
              // nested glass card (rim + slab via lg-card) with the gel
              // press: the specular blooms from the touch point
              `psh-card lg-card lg-pressable lg-specular lg-gel cat-${entry.category}`
            }
            aria-pressed={armed}
            aria-disabled={level === 'dev' || undefined}
            aria-keyshortcuts={hotkey ?? undefined}
            title={
              armed && !legacy ? t('Click the card again to stop placing') : hotkey ? (partKeyTitle(entry) ?? undefined) : undefined
            }
            aria-label={
              t('{part}, {meta}, {support}', { part: partLabel(entry), meta: placementMeta(entry), support: supportSpoken(level) }) +
              (armed ? t(', placing') : '')
            }
            {...pressProps}
            onClick={() => onCard(entry)}
          >
            <span className="psh-card-glyph" aria-hidden="true">
              <PartGlyph entry={entry} />
            </span>
            <span className="psh-card-label">{partLabel(entry)}</span>
            <span className="psh-card-tags">
              <span className="psh-card-meta lg-tabular">{placementMeta(entry)}</span>
              {level !== 'full' && <SupportBadge level={level} />}
            </span>
            {armed && <span className="psh-card-armed">{t('Placing')}</span>}
            {hotkey && !armed && (
              <kbd className="psh-card-key" aria-hidden="true">
                {hotkey}
              </kbd>
            )}
          </button>
        )
      })}
    </div>
  )
  const count = groups.reduce((n, g) => n + g.entries.length, 0)
  return (
    <>
      {armedEntry && (
        <div className="psh-armed-line" role="status">
          {t('Placing {part} · tap its card again to stop', { part: partLabel(armedEntry) })}
        </div>
      )}

      <SearchField
        value={query}
        onChange={setQuery}
        // searching needs the keyboard + room for results: spring to full
        onFocus={onSearchFocus}
      />

      <div className="psh-chips" role="group" aria-label={t('Filter by category')}>
        <CategoryChip label={t('All')} active={cat === 'all'} onSelect={() => setCat('all')} />
        {(legacy ? LEGACY_CATEGORY_ORDER : CATEGORY_ORDER).map((c) => (
          <CategoryChip
            key={c}
            label={categoryText(c)}
            active={cat === c}
            onSelect={() => setCat(c)}
          />
        ))}
      </div>

      {count === 0 ? (
        <div className="psh-empty lg-caption">{t('No parts match “{query}”', { query: query.trim() })}</div>
      ) : (
        groups.map((g) => {
          if (g.key === 'all') return <Fragment key="all">{grid(g.entries)}</Fragment>
          // 全部: a small label over each run — 常用元件, then the category names —
          // so the learner sees where the everyday parts end (the 範例 headers' look)
          const title = g.key === 'common' ? t('Common parts') : categoryText(g.key)
          return (
            <section key={g.key} className="ws-lib-section psh-group" aria-label={title}>
              <div className="lg-list-header lg-caption">{title}</div>
              {grid(g.entries)}
            </section>
          )
        })
      )}
    </>
  )
}

function CategoryChip({
  label,
  active,
  onSelect,
}: {
  label: string
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className="psh-chip lg-gel"
      aria-pressed={active}
      {...pressProps}
      onClick={() => {
        if (!active) {
          tick()
          onSelect()
        }
      }}
    >
      {label}
    </button>
  )
}
