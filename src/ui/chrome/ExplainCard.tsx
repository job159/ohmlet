/**
 * ExplainCard — 「電路說明」 (explain stream): one or two plain lines at the
 * top right that say what the circuit is doing right now and why
 * (explain.ts / useExplanation.ts):
 *
 *   ┌───────────────────────────────────────────┐
 *   │ ● LED1 亮著：亮度 49 %（9.70 mA）           │
 *   │   由 5.00 V 經 R1 330 Ω 供電               │
 *   └───────────────────────────────────────────┘
 *
 * Placement (decided here, measured on change — never per frame):
 *  - desktop workspace with the inspector open: fixed at the top of the
 *    right column, the inspector's width (--ws-right-w), EXPLAIN_CARD_H
 *    tall (EXPLAIN_CARD_TALL_H while the words need four lines — see
 *    below); --ws-explain-h (its height + 8) is published on <body> before
 *    the first paint — reserved even while onboarding hides the card — and
 *    the inspector (.ws-right) starts below it: it never jumps when the card
 *    appears. A sibling, so the inspector's own text (and the scripts that
 *    read it) is unchanged;
 *  - inspector collapsed, or a desktop without the workspace: floating at
 *    the top-right corner; when the run capsule, the 顯示電流 chip, the
 *    status pill or the performance card would overlap it, it glides below
 *    them (a transform — the CSS spot is measured with offsetTop, which a
 *    running glide does not move);
 *  - phones: nothing here — the status pill's lowest tier says line 1
 *    (StatusPill 'explain'), a tap shows both lines;
 *  - classic chrome: nothing. Onboarding (hidden) hides it; while the
 *    empty-state card shows, only the right-column card stays (one line).
 * The pill keeps the fault and its action; the card the effect and the cause.
 *
 * The text box holds three text lines: line 1 and up to two of line 2 —
 * or, when line 1 itself is too long for one line, two of line 1 and one of
 * line 2. When the words need FOUR lines (line 1 wraps and so does line 2,
 * or line 2 needs three), the box grows to four (two + two / one + three),
 * so the fix — the hole the wire goes to, 「改好就會自動換上新的 LED1」 — is
 * never cut off. The natural line counts are measured when the words or the
 * width change (≤ 2 Hz; explainBoxFit). The box GROWS at once (before the
 * paint, so a line is never shown clamped) and shrinks back only after the
 * words have fitted three lines for EXPLAIN_SHRINK_MS — the inspector under
 * it (through --ws-explain-h) moves at most twice, never with every update.
 * Under ?shotrig the box shrinks at once (no timing in a screenshot).
 *
 * Material: Tier S (the StatusPill / inspector slab recipe — near-opaque
 * gradient, lg-rim, inset shadows, NO backdrop-filter). A new subject
 * crossfades its lines (160 ms; none under reduced motion); numbers never
 * animate; the previous circuit's lines are dimmed while an edit settles.
 * A click selects the subject part and opens its inspector (focusInspector —
 * the camera stays put); while a mouse rests on it the scene marks the parts
 * it talks about (the calm hover marker, H7 — no camera move). a11y:
 * role=status with aria-live off (it refreshes at 2 Hz); a visually hidden
 * polite region announces subject / state changes only, at most one per
 * 2 s. The 3D hover chip keeps clear of it (data-scene-avoid).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t, useLang } from '../../i18n'
import { pressProps, tick, useIsDesktop } from '../kit'
import { useLab } from '../embedded/lab'
import { focusInspector } from '../embedded/problems'
import { highlightSource } from '../workspace/scene-bridge'
import { useWorkspaceActive } from '../workspace/state'
import { useLegacyChrome } from './legacy'
import { useExplanation } from './useExplanation'
import './ExplainCard.css'

/** the card's height (ExplainCard.css .app-explain: three text lines) — reserved before the card is measured */
export const EXPLAIN_CARD_H = 72
/** the four-line box (ExplainCard.css .app-explain.is-tall): only while the words need it */
export const EXPLAIN_CARD_TALL_H = 90
/** a tall box shrinks back only once the words have fitted three lines this long (no inspector jitter) */
export const EXPLAIN_SHRINK_MS = 6000
/** the inspector starts this far below the card's bottom edge */
const COLUMN_GAP = 8
/** what the floating card keeps clear of */
const OBSTACLES = '.app-run-capsule, .app-flow-chip, .app-status-pill.is-in, .perf-ov'

export interface ExplainCardProps {
  /** the host hides it (onboarding) */
  hidden?: boolean
  /** the empty-state card is up: the floating card steps aside (the right-column one says 「麵包板上還沒有元件。」) */
  empty?: boolean
}

/**
 * How the box holds the words, from their natural line counts at its width
 * (n1 = line 1, n2 = line 2; 0 = no line 2):
 *  - l1Long: line 1 takes two lines (it does not fit one);
 *  - tall: four lines are needed — line 1 wraps and line 2 does too, or
 *    line 2 alone needs three, or (no line 2) line 1 needs three.
 */
export function explainBoxFit(n1: number, n2: number): { l1Long: boolean; tall: boolean } {
  const l1Long = n1 >= 2
  return { l1Long, tall: n2 === 0 ? n1 >= 3 : l1Long ? n2 >= 2 : n2 >= 3 }
}

const NBSP = String.fromCharCode(0xa0)

/** a number and the unit after it: 「4.05 mA」, 「2.03 s」, 「330 Ω」, 「49 %」 (the formatters' own space) */
const VALUE_UNIT = /(\d) (?=(?:[pnµumkM]?(?:A|V|W|s|Hz|Ω)|%|°C)(?![\w]))/g

/**
 * A hole name never breaks across lines on the card: 「第 13 孔」 stays
 * whole; nor does a value: 「4.05 mA」 never leaves 「mA」 alone on the next
 * line when line 1 wraps (no-break spaces; the text itself is unchanged).
 */
export function unbroken(line: string): string {
  return line.replace(/第 (\d+) 孔/g, `第${NBSP}$1${NBSP}孔`).replace(VALUE_UNIT, `$1${NBSP}`)
}

/**
 * Line 1 with its 「（已暫停）」 tag in one unbreakable piece (persona fix: it
 * wrapped as 「（已暫｜停）」); the text is unchanged (a nowrap span).
 */
export function keepTail(line: string): ReactNode {
  const tag = t('{text} (paused)|explain', { text: '' }).trim()
  if (!tag || !line.endsWith(tag) || line.length === tag.length) return line
  return (
    <>
      {line.slice(0, line.length - tag.length)}
      <span className="app-explain-keep">{tag}</span>
    </>
  )
}

/** Under the visual-regression harness (?shotrig) the box never waits to shrink. */
function shotRig(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.location && new URLSearchParams(window.location.search).has('shotrig')
  } catch {
    return false
  }
}

/** Do two rects overlap (with `pad` px of air)? */
function overlaps(a: { left: number; right: number; top: number; bottom: number }, b: DOMRect, pad: number): boolean {
  return a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad
}

/**
 * How far (px) the floating card drops below whatever it would overlap at
 * its CSS spot (0 = stay). The CSS spot is the layout box (offsetTop /
 * offsetLeft — a position: fixed card's are viewport coordinates, and a
 * running transform glide does not move them). Rect reads only, a few elements.
 */
export function floatingDrop(card: HTMLElement): number {
  const width = card.offsetWidth
  const height = card.offsetHeight
  if (width === 0) return 0
  const top0 = card.offsetTop
  const left = card.offsetLeft
  const others = [...document.querySelectorAll<HTMLElement>(OBSTACLES)].map((el) => el.getBoundingClientRect()).filter((b) => b.width > 0)
  let top = top0
  // drop below each obstacle it meets, top to bottom (capsule → chip → pill → performance card)
  for (let pass = 0; pass < 4; pass++) {
    const box = { left, right: left + width, top, bottom: top + height }
    const hit = others.filter((b) => overlaps(box, b, 6)).sort((a, b) => a.bottom - b.bottom)[0]
    if (!hit) break
    top = Math.ceil(hit.bottom + 10)
  }
  return Math.max(0, top - top0)
}

export function ExplainCard({ hidden = false, empty = false }: ExplainCardProps) {
  const legacy = useLegacyChrome()
  const isDesktop = useIsDesktop()
  const workspaceOn = useWorkspaceActive()
  const rightOpen = useLab((s) => s.workspace.right.open)
  const rightWidth = useLab((s) => s.workspace.right.width)
  useLang()
  const column = workspaceOn && rightOpen
  const wanted = !legacy && isDesktop && !hidden && (column || !empty)
  const view = useExplanation(wanted)
  const e = view?.explanation ?? null
  const shown = wanted && e !== null
  const ref = useRef<HTMLDivElement | null>(null)

  // the right column: the inspector starts below the card's slot (its height + the gap) — reserved before
  // the first paint and while onboarding hides the card, so the inspector never jumps when it appears
  const reserve = !legacy && isDesktop && column
  useLayoutEffect(() => {
    if (!reserve) return
    const body = document.body
    const el = shown ? ref.current : null
    const write = () => {
      const h = el ? Math.round(el.getBoundingClientRect().height) : 0
      body.style.setProperty('--ws-explain-h', `${(h > 0 ? h : EXPLAIN_CARD_H) + COLUMN_GAP}px`)
    }
    write()
    const ro = el && typeof ResizeObserver === 'function' ? new ResizeObserver(write) : null
    if (el) ro?.observe(el)
    return () => {
      ro?.disconnect()
      body.style.removeProperty('--ws-explain-h')
    }
  }, [reserve, shown])

  // floating: keep clear of the capsule row (on resize, a new subject, the capsule / chip / pill changing size or
  // appearing) — DOM reads on those events only
  const [drop, setDrop] = useState(0)
  const [layoutTick, setLayoutTick] = useState(0)
  const floating = shown && !column
  useEffect(() => {
    if (!floating) return
    const bump = () => setLayoutTick((n) => n + 1)
    window.addEventListener('resize', bump)
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(bump) : null
    const watchObstacles = () => {
      ro?.disconnect()
      for (const el of document.querySelectorAll(OBSTACLES)) ro?.observe(el)
    }
    watchObstacles()
    // a portal (the pill, the performance card) mounting or leaving
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => (watchObstacles(), bump())) : null
    mo?.observe(document.body, { childList: true })
    return () => {
      window.removeEventListener('resize', bump)
      ro?.disconnect()
      mo?.disconnect()
    }
  }, [floating])
  // what the words need (measured when they or the width change): line 1 on two lines, four lines in all
  const [fit, setFit] = useState({ l1Long: false, tall: false })
  const line1 = e?.lines[0] ?? ''
  const line2Text = e?.lines[1] ?? ''
  useLayoutEffect(() => {
    const el = ref.current
    const l1 = el?.querySelector<HTMLElement>('.app-explain-l1')
    if (!el || !l1) return
    const l2 = el.querySelector<HTMLElement>('.app-explain-l2')
    // unclamped for a moment (no paint in between): each line at its natural height
    el.classList.add('is-measuring')
    const lines = (x: HTMLElement | null): number => {
      if (!x) return 0
      const lh = parseFloat(getComputedStyle(x).lineHeight)
      return Math.max(1, Math.round(x.getBoundingClientRect().height / (lh > 0 ? lh : 18)))
    }
    const next = explainBoxFit(lines(l1), lines(l2))
    el.classList.remove('is-measuring')
    setFit((cur) => (cur.l1Long === next.l1Long && cur.tall === next.tall ? cur : next))
  }, [line1, line2Text, shown, column, rightWidth, layoutTick])

  // the box: four lines at once when the words need them (before the paint), back to three only after
  // they have fitted three for EXPLAIN_SHRINK_MS — the inspector below moves on those two changes only
  const [tall, setTall] = useState(false)
  useLayoutEffect(() => {
    if (!shown) {
      if (tall) setTall(false)
      return
    }
    if (fit.tall) {
      if (!tall) setTall(true)
      return
    }
    if (!tall) return
    if (shotRig()) {
      setTall(false)
      return
    }
    const timer = setTimeout(() => setTall(false), EXPLAIN_SHRINK_MS)
    return () => clearTimeout(timer)
  }, [fit.tall, tall, shown])
  const l1Long = fit.l1Long

  const key = e?.key ?? ''
  useLayoutEffect(() => {
    const el = ref.current
    const next = floating && el ? floatingDrop(el) : 0
    setDrop((cur) => (cur === next ? cur : next))
  }, [floating, key, layoutTick, rightWidth, tall])

  // the scene marks what the card talks about while a mouse rests on it (never a camera move)
  const marked = useRef(false)
  const subjects = e?.subjectIds ?? []
  const subjectKey = subjects.join(',')
  const unmark = () => {
    if (!marked.current) return
    marked.current = false
    highlightSource(null)
  }
  useEffect(() => unmark, [])
  // a new subject under a resting mouse: the marker follows it
  useEffect(() => {
    if (marked.current) marked.current = highlightSource(subjects.length > 0 ? { components: subjects } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectKey])
  useEffect(() => {
    if (!shown) unmark()
  }, [shown])

  if (typeof document === 'undefined' || !shown || !e) return null
  const subject = subjects[0] ?? null
  const [, line2] = e.lines
  const onClick = (ev: MouseEvent<HTMLButtonElement>) => {
    if (ev.detail > 0) ev.currentTarget.blur() // a pointer click leaves no focus behind (Space stays run / pause)
    tick()
    if (subject) focusInspector(subject)
  }
  const onEnter = (ev: PointerEvent<HTMLElement>) => {
    if (ev.pointerType !== 'mouse' || subjects.length === 0) return
    marked.current = highlightSource({ components: subjects })
  }
  const style = {
    '--app-explain-dot': e.dot,
    ...(floating ? { '--app-explain-dy': `${drop}px` } : {}),
  } as CSSProperties
  // the row (dot + lines) sits centred in the fixed box; the dot stays beside line 1
  const lines = (
    <span className="app-explain-row">
      <span className="app-explain-dot" aria-hidden="true" />
      {/* keyed by the subject: a new one crossfades in */}
      <span className="app-explain-lines" key={e.key}>
        <span className="app-explain-l1">{keepTail(unbroken(line1))}</span>
        {line2 && <span className="app-explain-l2">{unbroken(line2)}</span>}
      </span>
    </span>
  )
  return createPortal(
    <div
      ref={ref}
      className={`app-explain lg-rim is-${e.tone}${column ? ' is-column' : ' is-floating'}${view?.stale ? ' is-stale' : ''}${line2 ? '' : ' is-single'}${l1Long ? ' is-l1-long' : ''}${tall ? ' is-tall' : ''}`}
      style={style}
      data-scene-avoid=""
      role="status"
      aria-live="off"
      aria-label={t('Circuit explanation|explain')}
      onPointerEnter={onEnter}
      onPointerLeave={unmark}
    >
      {subject ? (
        <button
          type="button"
          className="app-explain-body lg-pressable"
          title={[...e.lines, t('Click to select {id}|explain', { id: subject })].join('\n')}
          {...pressProps}
          onClick={onClick}
        >
          {lines}
        </button>
      ) : (
        <div className="app-explain-body is-static" title={e.lines.join('\n')}>
          {lines}
        </div>
      )}
      <span className="app-explain-live" aria-live="polite">
        {view?.announce ?? ''}
      </span>
    </div>,
    document.body,
  )
}
