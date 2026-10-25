/**
 * Workspace LEFT panel: Library | Examples | Lessons.
 *
 * Library — the full catalog (incl. MCU / Sensors / Modules / Motors) with
 * search over label, type, part number and tags (partMatches, shared with
 * the Parts sheet), category + support-level filters, favorites (★, lab
 * store, persisted), the support badge (supportOf(entry)) on every card and
 * an expandable spec card (meta.specs, what is / is not simulated, size).
 * Clicking a card arms placement exactly like the Parts sheet.
 *
 * Examples — the curated example library (src/ui/workspace/examples.ts, the
 * same list as More → Examples): search, category / difficulty filters,
 * expandable cards, opened through lab.importProject. Exported as
 * ExampleLibrary: the phone's Parts sheet shows the very same list on its
 * 範例 segment (release QA SC-F3).
 * Lessons — the lesson browser (src/ui/lessons/LessonBrowser.tsx).
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionSheet,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  Segmented,
  SidebarLeftIcon,
  StarFillIcon,
  StarIcon,
  pressProps,
  showToast,
  tick,
} from '../kit'
import { placementValid, useStore } from '../../state/store'
import { getEntry, supportOf, type CatalogEntry, type ComponentCategory, type SupportLevel } from '../../model/catalog'
import { CATEGORY_ORDER, PartGlyph, orderedCatalog, partMatches } from '../sheets/PartsSheet'
import { SupportBadge } from '../embedded/PartInfo'
import { lang, t, useLang } from '../../i18n'
import { partDoc, partLabel, partSpecs, partSupport, supportLevelLabel } from '../../i18n/parts'
import { tMessage } from '../../i18n/messages'
import { placementText, tc, tText } from '../embedded/text'
import { IconButton, SelectField, ToggleChip } from '../embedded/controls'
import { useLab } from '../embedded/lab'
import { LessonBrowser } from '../lessons/LessonBrowser'
import { openLessons } from '../lessons/actions'
import { LESSONS, type Lesson } from '../../lessons'
import {
  EXAMPLE_CATEGORIES,
  EXAMPLE_CATEGORY_TINT,
  LIBRARY,
  boardHasContent,
  exampleCategoryName,
  exampleDescription,
  exampleDifficultyName,
  exampleInstrumentName,
  exampleMatchRank,
  exampleRevealRequest,
  exampleSummary,
  exampleTextRuns,
  exampleTitle,
  firmwareWarnings,
  librarySections,
  onExampleReveal,
  openLibraryExample,
  type ExampleCategory,
  type ExampleDifficulty,
  type LibraryExample,
} from './examples'
import type { WorkspacePrefs } from '../../state/lab-types'

type LeftTab = WorkspacePrefs['left']['tab']

/** English sources; shown through t() per render, so a language switch re-labels them. */
const TABS: { value: LeftTab; label: string }[] = [
  { value: 'parts', label: 'Library' },
  { value: 'examples', label: 'Examples' },
  { value: 'lessons', label: 'Lessons' },
]

/** Library section / filter names per category (the PartsSheet chip names, as t() sources). */
const CATEGORY_NAMES: Record<ComponentCategory, string> = {
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

function categoryName(c: ComponentCategory): string {
  return tc(CATEGORY_NAMES[c], 'category')
}

/** Screen-reader phrasing of the support level (PartsSheet.SUPPORT_SPOKEN, as t() sources). */
const SUPPORT_SPOKEN: Record<SupportLevel, string> = {
  full: 'fully simulated',
  partial: 'partially simulated',
  visual: 'visual only, not simulated',
  dev: 'in development, not placeable',
}

/** An ordinary lower-case English word (3+ letters) inside catalog text. */
const ENGLISH_WORD = /\b[a-z]{3,}\b/

/**
 * The card's part-number chip in the UI language. Real part numbers
 * ("STM32F103C8T6", "LM7805 / L7805") pass through; descriptive catalog
 * texts ('SSD1306 0.96" OLED module (I²C)') use their dictionary entry, and
 * — for entries added after the dictionary — keep only the leading model
 * code in Chinese instead of showing English words ('' when none).
 */
function partNumberText(partNumber: string): string {
  const tr = tText(partNumber)
  if (tr !== partNumber || lang() !== 'zh-TW' || !ENGLISH_WORD.test(partNumber)) return tr
  const words = partNumber.split(/\s+/)
  const cut = words.findIndex((w) => ENGLISH_WORD.test(w))
  let code = words.slice(0, cut).join(' ')
  // never leave a parenthesis open: "ESP-01 (ESP8266EX, 1 MB flash) …" → "ESP-01"
  if ((code.match(/\(/g) ?? []).length > (code.match(/\)/g) ?? []).length) code = code.slice(0, code.lastIndexOf('('))
  return code.replace(/[\s,;:+/(–-]+$/, '')
}

/** Manufacturer line: dictionary entry, else the brand names with "generic" localized. */
function manufacturerText(m: string): string {
  const tr = tText(m)
  if (tr !== m || lang() !== 'zh-TW') return tr
  return m
    .replace(/\bgeneric module\b/g, t('generic module'))
    .replace(/\bgeneric board\b/g, t('generic board'))
    .replace(/\bgeneric\b/g, t('generic'))
}

/**
 * Library search: per term, the shared English matcher (label, type, part
 * number, manufacturer, tags) or the localized name / category, so
 * "電阻" or "感測器" finds parts as well as "stm32 f103".
 */
function libraryMatches(entry: CatalogEntry, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const local = `${partLabel(entry)}\n${categoryName(entry.category)}`.toLowerCase()
  return terms.every((term) => local.includes(term) || partMatches(entry, term))
}

export function LibraryPanel({
  onCollapse,
  searchRef,
}: {
  onCollapse: () => void
  searchRef?: React.RefObject<HTMLInputElement>
}) {
  const left = useLab((s) => s.workspace.left)
  const setWorkspace = useLab((s) => s.setWorkspace)
  useLang()

  return (
    <>
      <div className="ws-head">
        <Segmented<LeftTab>
          className="ws-tabs"
          value={left.tab}
          onChange={(tab) => setWorkspace({ left: { ...useLab.getState().workspace.left, tab } })}
          options={TABS.map((o) => ({ value: o.value, label: t(o.label) }))}
          aria-label={t('Left panel')}
        />
        <IconButton aria-label={t('Hide library panel')} onClick={onCollapse}>
          <SidebarLeftIcon size={20} />
        </IconButton>
      </div>
      {/* lesson coach slot (UX contract K8): the coach card portals in here;
          empty = display:none, so the panel is unchanged without a lesson */}
      <div id="ws-coach-slot" className="ws-coach-slot" />
      <div className="ws-scroll">
        {left.tab === 'parts' && <LibraryTab searchRef={searchRef} />}
        {left.tab === 'examples' && <ExampleLibrary />}
        {left.tab === 'lessons' && <LessonsTab />}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

type CatFilter = 'all' | ComponentCategory
type LevelFilter = 'any' | SupportLevel

function LibraryTab({ searchRef }: { searchRef?: React.RefObject<HTMLInputElement> }) {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const favorites = useLab((s) => s.favorites)
  const toggleFavorite = useLab((s) => s.toggleFavorite)

  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<CatFilter>('all')
  const [level, setLevel] = useState<LevelFilter>('any')
  const [favOnly, setFavOnly] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const localRef = useRef<HTMLInputElement>(null)
  const inputRef = searchRef ?? localRef

  const armedType = mode.kind === 'place' ? mode.type : null
  const all = useMemo(() => orderedCatalog(), [])
  const presentCats = useMemo(() => CATEGORY_ORDER.filter((c) => all.some((e) => e.category === c)), [all])

  const filtered = all.filter(
    (e) =>
      (cat === 'all' || e.category === cat) &&
      (level === 'any' || supportOf(e).level === level) &&
      (!favOnly || favorites.includes(e.type)) &&
      libraryMatches(e, query),
  )
  const filtering = query.trim() !== '' || cat !== 'all' || level !== 'any' || favOnly

  // unfiltered: Favorites first, then one section per category
  const sections: { key: string; title: string; entries: CatalogEntry[] }[] = filtering
    ? [
        {
          key: 'results',
          title: t(filtered.length === 1 ? '{n} part' : '{n} parts', { n: filtered.length }),
          entries: filtered,
        },
      ]
    : [
        ...(favorites.length > 0
          ? [{ key: 'fav', title: t('Favorites'), entries: all.filter((e) => favorites.includes(e.type)) }]
          : []),
        ...presentCats.map((c) => ({
          key: c,
          title: categoryName(c),
          entries: all.filter((e) => e.category === c),
        })),
      ]

  const suppressClick = useRef(false)
  const arm = (entry: CatalogEntry) => {
    if (suppressClick.current) {
      // the click that ends a drag released over its own card
      suppressClick.current = false
      return
    }
    if (supportOf(entry).level === 'dev') return
    tick()
    if (armedType === entry.type) setMode({ kind: 'select' })
    else setMode({ kind: 'place', type: entry.type, pickedHoles: [] })
  }
  const dragToPlace = useDragToPlace(suppressClick)

  return (
    <div className="ws-lib">
      <div className="psh-search ws-search">
        <span className="psh-search-icon" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="7.2" cy="7.2" r="5.2" />
            <path d="M11.2 11.2 15 15" />
          </svg>
        </span>
        <input
          ref={inputRef}
          className="psh-search-input"
          type="search"
          placeholder={t('Search parts and tags')}
          aria-label={t('Search the component library')}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query !== '') {
              e.stopPropagation()
              setQuery('')
            }
          }}
        />
        {query !== '' && (
          <button
            type="button"
            className="psh-search-clear lg-pressable"
            aria-label={t('Clear search')}
            {...pressProps}
            onClick={() => setQuery('')}
          >
            <CloseIcon size={13} />
          </button>
        )}
      </div>

      <div className="ws-filters" role="group" aria-label={t('Filters')}>
        <SelectField
          aria-label={t('Category')}
          value={cat}
          onChange={(v) => setCat(v as CatFilter)}
          className="ws-filter-cat"
          options={[
            { value: 'all', label: t('All parts') },
            ...presentCats.map((c) => ({ value: c, label: categoryName(c) })),
          ]}
        />
        <SelectField
          aria-label={t('Simulation support')}
          value={level}
          onChange={(v) => setLevel(v as LevelFilter)}
          className="ws-filter-level"
          options={[
            { value: 'any', label: t('Any support') },
            ...(['full', 'partial', 'visual', 'dev'] as SupportLevel[]).map((l) => ({
              value: l,
              label: supportLevelLabel(l),
            })),
          ]}
        />
        <ToggleChip pressed={favOnly} onChange={setFavOnly} title={t('Show favorites only')}>
          <StarFillIcon size={14} />
          <span className="emb-visually-hidden">{t('Favorites only')}</span>
        </ToggleChip>
      </div>

      {filtered.length === 0 && (
        <div className="ws-note lg-caption">
          {favOnly && favorites.length === 0
            ? t('No favorites yet — star a part to pin it here.')
            : query.trim()
              ? t('No parts match “{q}”.', { q: query.trim() })
              : t('No parts match these filters.')}
        </div>
      )}

      {sections.map((sec) =>
        sec.entries.length === 0 ? null : (
          <section key={sec.key} className="ws-lib-section" aria-label={sec.title}>
            <div className="lg-list-header lg-caption">{sec.title}</div>
            <div className="ws-lib-list">
              {sec.entries.map((entry) => (
                <PartCard
                  key={`${sec.key}:${entry.type}`}
                  entry={entry}
                  armed={armedType === entry.type}
                  favorite={favorites.includes(entry.type)}
                  expanded={expanded === `${sec.key}:${entry.type}`}
                  onArm={() => arm(entry)}
                  onDragStart={(e) => dragToPlace(e, entry)}
                  onFavorite={() => {
                    tick()
                    toggleFavorite(entry.type)
                  }}
                  onExpand={() =>
                    setExpanded((x) => (x === `${sec.key}:${entry.type}` ? null : `${sec.key}:${entry.type}`))
                  }
                />
              ))}
            </div>
          </section>
        ),
      )}
    </div>
  )
}

/** px a card must travel before a press becomes a drag-to-place (SC-8) */
const DRAG_START_PX = 6

/**
 * Drag a part card onto the board (SC-8): pointerdown + DRAG_START_PX of
 * travel arms placement for that part — the scene's ghost then follows the
 * pointer over the canvas like a hover. Releasing over a board hole:
 *  - a DIP / footprint package is placed there (one undo step) and selected;
 *  - a leaded part takes that hole as its FIRST lead — the next click sets
 *    the second one (the lesson text 「拖一顆電阻到 a14」 now just works).
 * Released anywhere else (or on a hole that cannot take it) the part stays
 * armed, exactly as if its card had been clicked. Mouse only; touch keeps
 * tap-to-arm (a finger drag scrolls the list).
 */
function useDragToPlace(suppressClick: React.MutableRefObject<boolean>) {
  return (e: React.PointerEvent<HTMLButtonElement>, entry: CatalogEntry) => {
    if (e.button !== 0 || e.pointerType !== 'mouse' || supportOf(entry).level === 'dev') return
    const x0 = e.clientX
    const y0 = e.clientY
    let started = false
    const move = (ev: PointerEvent) => {
      if (started || Math.hypot(ev.clientX - x0, ev.clientY - y0) <= DRAG_START_PX) return
      started = true
      tick()
      useStore.getState().setMode({ kind: 'place', type: entry.type, pickedHoles: [] })
      document.body.classList.add('ws-part-dragging')
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      document.body.classList.remove('ws-part-dragging')
      if (!started) return
      suppressClick.current = (ev.target as Element | null)?.closest?.('.ws-part-main') !== null
      // the click (if any) fires right after this pointerup — never later
      setTimeout(() => (suppressClick.current = false), 0)
      if (ev.type !== 'pointerup') return
      const over = document.elementFromPoint(ev.clientX, ev.clientY)
      const st = useStore.getState()
      const hole = st.hoverHole
      if (!(over instanceof HTMLCanvasElement) || !hole || st.mode.kind !== 'place' || st.mode.type !== entry.type) return
      if (entry.placement === 'dip' || entry.placement === 'footprint') {
        const before = st.layout.components.length
        st.addComponent(entry.type, { at: hole, rotation: st.mode.rotation })
        const comps = useStore.getState().layout.components
        if (comps.length > before) {
          tick()
          st.setMode({ kind: 'select' })
          st.select(comps[comps.length - 1].id)
        }
      } else if (placementValid(st.layout, entry.type, hole, [])) {
        tick()
        st.setMode({ kind: 'place', type: entry.type, pickedHoles: [hole] })
      }
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
  }
}

function PartCard({
  entry,
  armed,
  favorite,
  expanded,
  onArm,
  onFavorite,
  onExpand,
  onDragStart,
}: {
  entry: CatalogEntry
  armed: boolean
  favorite: boolean
  expanded: boolean
  onArm: () => void
  onFavorite: () => void
  onExpand: () => void
  /** pointerdown on the card body — drag-to-place (SC-8) */
  onDragStart?: (e: React.PointerEvent<HTMLButtonElement>) => void
}) {
  const support = partSupport(entry)
  const meta = entry.meta
  const label = partLabel(entry)
  const placement = placementText(entry)
  const specs = partSpecs(entry)
  const sub = [
    placement,
    meta?.partNumber && meta.partNumber !== entry.label && meta.partNumber !== label ? partNumberText(meta.partNumber) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const detailsId = `ws-part-${entry.type}`
  const spoken = { part: label, meta: placement, support: t(SUPPORT_SPOKEN[support.level]) }
  return (
    <div className={`ws-part lg-card cat-${entry.category} ${armed ? 'is-armed' : ''} ${expanded ? 'is-open' : ''}`}>
      <div className="ws-part-row">
        <button
          type="button"
          className="ws-part-main lg-pressable"
          aria-pressed={armed}
          aria-disabled={support.level === 'dev' || undefined}
          aria-label={
            armed
              ? t('{part}, {meta}, {support}, placing — click again to cancel', spoken)
              : t('{part}, {meta}, {support}, click to place', spoken)
          }
          title={armed ? t('Click the card again to stop placing') : undefined}
          {...pressProps}
          onClick={onArm}
          onPointerDown={(e) => {
            pressProps.onPointerDown(e)
            onDragStart?.(e)
          }}
        >
          <span className="ws-part-glyph" aria-hidden="true">
            <PartGlyph entry={entry} />
          </span>
          <span className="ws-part-text">
            <span className="ws-part-label">{label}</span>
            <span className="ws-part-sub">{sub}</span>
          </span>
        </button>
        <span className="ws-part-side">
          {armed ? <span className="psh-card-armed ws-part-armed">{t('Placing')}</span> : <SupportBadge level={support.level} />}
          <span className="ws-part-actions">
            <button
              type="button"
              className={`ws-star ${favorite ? 'is-on' : ''}`}
              aria-pressed={favorite}
              aria-label={
                favorite ? t('Remove {part} from favorites', { part: label }) : t('Add {part} to favorites', { part: label })
              }
              title={favorite ? t('Unfavorite') : t('Favorite')}
              onClick={onFavorite}
            >
              {favorite ? <StarFillIcon size={16} /> : <StarIcon size={16} />}
            </button>
            <button
              type="button"
              className="ws-star"
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={expanded ? t('Hide {part} details', { part: label }) : t('Show {part} details', { part: label })}
              title={t('Details')}
              onClick={onExpand}
            >
              {expanded ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
            </button>
          </span>
        </span>
      </div>
      {armed && (
        // how to place, and how to stop — right where the user just clicked
        <div className="ws-part-armed-hint" role="status">
          {t('Click a breadboard hole to place it · Esc to stop')}
        </div>
      )}
      {expanded && (
        <div className="ws-part-details" id={detailsId}>
          <p className="ws-part-doc">{partDoc(entry)}</p>
          {specs.length > 0 && (
            <div className="ws-part-block">
              <span className="emb-mini-head">{t('Specs')}</span>
              <ul>
                {specs.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {support.simulated && support.simulated.length > 0 && (
            <div className="ws-part-block">
              <span className="emb-mini-head">{t('Simulated')}</span>
              <ul>
                {support.simulated.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {support.limits && support.limits.length > 0 && (
            <div className="ws-part-block">
              <span className="emb-mini-head">{t('Not modeled')}</span>
              <ul>
                {support.limits.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {(meta?.manufacturer || meta?.sizeMm) && (
            <div className="ws-part-facts">
              {/* brand names are proper names: not for machine translation */}
              {meta?.manufacturer && <span translate="no">{manufacturerText(meta.manufacturer)}</span>}
              {meta?.sizeMm && (
                <span className="lg-tabular">
                  {meta.sizeMm[0]} × {meta.sizeMm[1]} × {meta.sizeMm[2]} mm
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Examples + Lessons
// ---------------------------------------------------------------------------

type ExampleCatFilter = 'all' | ExampleCategory
type ExampleLevelFilter = 'any' | ExampleDifficulty

/** Last example-reveal request the Examples tab applied (survives the tab remounting). */
let revealSeen = 0

/**
 * The lesson an example belongs to: the one whose main firmware
 * (requires.firmware[0]) is the example's firmware project — else the first
 * lesson that uses that firmware at all (pwm-fade's hal-pwm-fade is the
 * PWM lesson's second program).
 */
function relatedLesson(ex: LibraryExample): Lesson | undefined {
  const project = ex.firmware?.project
  if (!project) return undefined
  return (
    LESSONS.find((l) => l.requires?.firmware?.[0] === project) ??
    LESSONS.find((l) => l.requires?.firmware?.includes(project) === true)
  )
}

/** Difficulty → tag tint (the emb-tag family: green / teal / orange). */
const DIFFICULTY_TAG: Record<ExampleDifficulty, string> = {
  beginner: 'is-on',
  intermediate: 'is-ft',
  advanced: 'is-partial',
}

/**
 * Examples — the curated library (src/ui/workspace/examples.ts): search,
 * category + difficulty filters, one section per category, cards that
 * expand to the description / instruments / firmware, and "Open example"
 * through lab.importProject (firmware bound, instruments set up) with a
 * confirmation before a non-empty board is replaced.
 *
 * One list for both browsers (release QA SC-F3): the workspace's 範例 tab
 * (the default, `sheet` false) and the phone Parts sheet's 範例 segment
 * (`sheet` true: its confirmation is the sheet's own action sheet — a
 * panel next to the Parts panel on a desktop without the workspace — and
 * `onOpened` hands the opened example back so the sheet can bring up its
 * instrument; `onSearchFocus` lets the sheet rise for the keyboard).
 */
export function ExampleLibrary({
  sheet = false,
  desktop = true,
  onOpened,
  onSearchFocus,
}: {
  sheet?: boolean
  /** the confirmation's presentation (sheet only): desktop panel or phone action sheet */
  desktop?: boolean
  /** an example was opened (after its toast) */
  onOpened?: (ex: LibraryExample) => void
  onSearchFocus?: () => void
}) {
  const importProject = useLab((s) => s.importProject)
  useLang()
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<ExampleCatFilter>('all')
  const [level, setLevel] = useState<ExampleLevelFilter>('any')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<LibraryExample | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // openExampleById(…, { confirmIfNotEmpty }) on a board with content asks
  // to SHOW the card instead of replacing the circuit: clear the filters,
  // expand it and scroll it into view (also when this tab mounts after the
  // request — the left panel switches to it right before asking)
  useEffect(() => {
    const reveal = () => {
      const req = exampleRevealRequest()
      if (!req || req.seq <= revealSeen) return
      revealSeen = req.seq
      setQuery('')
      setCat('all')
      setLevel('any')
      setExpanded(req.key)
      // after the expanded card has rendered
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = listRef.current?.querySelector<HTMLElement>(`[data-example="${CSS.escape(req.key)}"]`)
          el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }),
      )
    }
    reveal()
    return onExampleReveal(reveal)
  }, [])

  // SC-17: a search ranks title hits above summary hits above tag hits above
  // category-name hits — inside a section, and the sections by their best hit
  const ranked = LIBRARY.map((ex, i) => ({
    ex,
    i,
    rank:
      (cat === 'all' || ex.category === cat) && (level === 'any' || ex.difficulty === level)
        ? exampleMatchRank(ex, query, t, [exampleCategoryName(ex.category), exampleDifficultyName(ex.difficulty)])
        : -1,
  }))
    .filter((r) => r.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
  const filtered = ranked.map((r) => r.ex)
  const rankOf = new Map(ranked.map((r) => [r.ex.key, r.rank]))
  const sections = librarySections(filtered)
    .map((sec, i) => ({ sec, i, best: Math.min(...sec.examples.map((ex) => rankOf.get(ex.key) ?? 0)) }))
    .sort((a, b) => a.best - b.best || a.i - b.i)
    .map((s) => s.sec)
  const filtering = query.trim() !== '' || cat !== 'all' || level !== 'any'

  const open = async (ex: LibraryExample) => {
    setBusy(ex.key)
    const res = await openLibraryExample(ex, importProject)
    setBusy(null)
    const title = exampleTitle(ex, t)
    if (!res.ok) {
      showToast(t('Couldn’t open example: {error}', { error: res.errors[0] ? tMessage(res.errors[0]) : t('unknown error') }))
      return
    }
    tick()
    const fw = firmwareWarnings(res.warnings)
    showToast(fw.length > 0 ? t('Opened “{title}” — firmware not loaded: {error}', { title, error: tMessage(fw[0]) }) : t('Opened “{title}”', { title }))
    onOpened?.(ex)
  }
  const request = (ex: LibraryExample) => {
    if (boardHasContent(useStore.getState().layout)) setConfirm(ex)
    else void open(ex)
  }

  return (
    <div className={sheet ? 'ws-lib psh-examples' : 'ws-lib'} ref={listRef}>
      <div className="psh-search ws-search">
        <span className="psh-search-icon" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="7.2" cy="7.2" r="5.2" />
            <path d="M11.2 11.2 15 15" />
          </svg>
        </span>
        <input
          className="psh-search-input"
          type="search"
          placeholder={t('Search examples, chips and tags')}
          aria-label={t('Search the example library')}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={onSearchFocus}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query !== '') {
              e.stopPropagation()
              setQuery('')
            }
          }}
        />
        {query !== '' && (
          <button
            type="button"
            className="psh-search-clear lg-pressable"
            aria-label={t('Clear search')}
            {...pressProps}
            onClick={() => setQuery('')}
          >
            <CloseIcon size={13} />
          </button>
        )}
      </div>

      <div className="ws-filters" role="group" aria-label={t('Filters')}>
        <SelectField
          aria-label={t('Example category')}
          value={cat}
          onChange={(v) => setCat(v as ExampleCatFilter)}
          options={[
            { value: 'all', label: t('All categories') },
            ...EXAMPLE_CATEGORIES.map((c) => ({ value: c, label: exampleCategoryName(c) })),
          ]}
        />
        <SelectField
          aria-label={t('Example difficulty')}
          value={level}
          onChange={(v) => setLevel(v as ExampleLevelFilter)}
          className="ws-filter-level"
          options={[
            { value: 'any', label: t('Any difficulty') },
            ...(['beginner', 'intermediate', 'advanced'] as ExampleDifficulty[]).map((d) => ({
              value: d,
              label: exampleDifficultyName(d),
            })),
          ]}
        />
      </div>

      {filtered.length === 0 && (
        <div className="ws-note lg-caption">
          {query.trim() ? t('No examples match “{q}”.', { q: query.trim() }) : t('No examples match these filters.')}
        </div>
      )}

      {sections.map((sec) => (
        <section key={sec.category} className="ws-lib-section" aria-label={exampleCategoryName(sec.category)}>
          <div className="lg-list-header lg-caption">
            {filtering
              ? `${exampleCategoryName(sec.category)} · ${t(sec.examples.length === 1 ? '{n} example' : '{n} examples', { n: sec.examples.length })}`
              : exampleCategoryName(sec.category)}
          </div>
          <div className="ws-lib-list">
            {sec.examples.map((ex) => (
              <ExampleCard
                key={ex.key}
                ex={ex}
                expanded={expanded === ex.key}
                busy={busy === ex.key}
                onToggle={() => setExpanded((x) => (x === ex.key ? null : ex.key))}
                onOpen={() => request(ex)}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="ws-note lg-caption">
        {t(
          'Opening an example replaces the current circuit and its firmware. Every example runs on the real simulation; the firmware examples carry the exact ELF built from their CubeIDE-style projects.',
        )}
      </div>

      <ActionSheet
        open={confirm !== null}
        onDismiss={() => setConfirm(null)}
        desktop={sheet ? desktop : true}
        anchor="left"
        title={t('Replace the current circuit?')}
        message={
          confirm
            ? t('“{title}” replaces the circuit on the board (undo brings it back) and the loaded firmware.', {
                title: exampleTitle(confirm, t),
              })
            : undefined
        }
        actions={[
          {
            label: t('Open example'),
            destructive: true,
            onSelect: () => {
              if (confirm) void open(confirm)
            },
          },
        ]}
      />
    </div>
  )
}

function ExampleCard({
  ex,
  expanded,
  busy,
  onToggle,
  onOpen,
}: {
  ex: LibraryExample
  expanded: boolean
  busy: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const title = exampleTitle(ex, t)
  const glyph = getEntry(ex.glyph)
  const difficulty = exampleDifficultyName(ex.difficulty)
  const detailsId = `ws-example-${ex.key.replace(/[^a-z0-9-]/gi, '-')}`
  const lesson = expanded ? relatedLesson(ex) : undefined
  return (
    <div className={`ws-part lg-card cat-${EXAMPLE_CATEGORY_TINT[ex.category]} ${expanded ? 'is-open' : ''}`} data-example={ex.key}>
      <div className="ws-part-row">
        <button
          type="button"
          className="ws-part-main lg-pressable"
          aria-expanded={expanded}
          aria-controls={detailsId}
          {...pressProps}
          onClick={onToggle}
        >
          <span className="ws-part-glyph" aria-hidden="true">
            {glyph && <PartGlyph entry={glyph} />}
          </span>
          <span className="ws-part-text">
            <span className="ws-part-label">{title}</span>
            <span className="ws-part-sub">{exampleSummary(ex, t)}</span>
          </span>
        </button>
        <span className="ws-part-side">
          <span className={`emb-tag ${DIFFICULTY_TAG[ex.difficulty]}`} title={t('Difficulty: {level}', { level: difficulty })}>
            {difficulty}
          </span>
          <span className="ws-part-actions">
            {/* one click from the list to the board (SC-7); the body still
                opens the write-up, which keeps its own 「開啟範例」. The pill
                stays 「開啟」 — 「開啟範例」 would clamp 13 of the titles at
                1366 px — and its name says the whole action (SC-F4) */}
            <button
              type="button"
              className="ws-open-pill"
              aria-label={t('Open example: {title}', { title })}
              title={t('Open example: {title}', { title })}
              disabled={busy}
              {...pressProps}
              onClick={onOpen}
            >
              {busy ? t('Opening…') : tc('Open', 'example')}
            </button>
            <button
              type="button"
              className="ws-star"
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={expanded ? t('Hide details of “{title}”', { title }) : t('Show details of “{title}”', { title })}
              title={t('Details')}
              onClick={onToggle}
            >
              {expanded ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
            </button>
          </span>
        </span>
      </div>
      {expanded && (
        <div className="ws-part-details" id={detailsId}>
          {exampleDescription(ex, t).map((p, i) => (
            <p key={i} className="ws-part-doc">
              {exampleTextRuns(p).map((run, j) =>
                run.code ? (
                  // literal firmware output / identifiers: data, not UI copy
                  <code key={j} className="lsn-code" translate="no">
                    {run.text}
                  </code>
                ) : (
                  <Fragment key={j}>{run.text}</Fragment>
                ),
              )}
            </p>
          ))}
          {ex.simulation === 'partial' && ex.simulationNote && (
            <div className="ws-part-block">
              <span className="emb-mini-head">
                {t('Not simulated')} <SupportBadge level="partial" />
              </span>
              <ul>
                <li>{ex.simulationNote}</li>
              </ul>
            </div>
          )}
          {ex.instruments.length > 0 && (
            <div className="ws-part-block">
              <span className="emb-mini-head">{t('Instruments')}</span>
              <ul>
                {ex.instruments.map((i) => (
                  <li key={i}>{exampleInstrumentName(i)}</li>
                ))}
              </ul>
            </div>
          )}
          {lesson && (
            <div className="ws-part-related">
              <span className="emb-mini-head">{t('Related lesson')}</span>
              <button
                type="button"
                className="ws-related-link"
                title={t('Open this lesson in the Lessons tab')}
                {...pressProps}
                onClick={() => {
                  tick()
                  openLessons(lesson.id)
                }}
              >
                {t('{title} ({level} {n})', { title: lesson.title, level: exampleDifficultyName(lesson.level), n: lesson.order })}
                <ChevronRightIcon size={14} />
              </button>
            </div>
          )}
          <div className="ws-part-facts">
            {ex.tags.map((tag) => (
              <span key={tag} className="emb-tag">
                {tag}
              </span>
            ))}
          </div>
          <div className="ws-part-facts">
            <span>
              {ex.firmware
                ? t('Firmware: {file} · {size} KB', { file: ex.firmware.name, size: (ex.firmware.size / 1024).toFixed(1) })
                : t('No firmware — analog circuit')}
            </span>
            <span className="lg-tabular">{t('{parts} parts · {wires} wires', { parts: ex.parts, wires: ex.wires })}</span>
          </div>
          <div>
            <button
              type="button"
              className="emb-chip"
              aria-label={t('Open example: {title}', { title })}
              disabled={busy}
              {...pressProps}
              onClick={onOpen}
            >
              {busy ? t('Opening…') : t('Open example')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function LessonsTab() {
  return <LessonBrowser variant="panel" />
}
