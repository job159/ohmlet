/**
 * Lesson text renderer: the safe Markdown subset of src/lessons/engine/
 * markdown.ts (paragraphs, line breaks, "- " bullets, **bold**, `code`)
 * rendered as React elements — never as HTML, so lesson text cannot inject
 * markup.
 *
 * A `code` span that names a breadboard hole (`a14`, `top+10`) or a part's
 * terminal (`PS1:+`, `DMM1:IN`) becomes a chip (LS-7): the raw id stays
 * visible for precision, the tooltip glosses it in Chinese (「上方 + 電源軌第
 * 10 孔」), and a click lights it on the board and frames it (scene bridge,
 * kind 'guide'); a second click clears it. The print view passes
 * `refs={false}` and keeps plain code.
 */
import { Fragment, useMemo, useSyncExternalStore } from 'react'
import { LESSONS } from '../../lessons'
import { parseMarkdown, type MdInline } from '../../lessons/engine/markdown'
import { parseHole } from '../../model/breadboard'
import { terminalLabel } from '../../i18n/parts'
import { t } from '../../i18n'
import { useStore } from '../../state/store'
import { focusInScene } from '../workspace/scene-bridge'
import { railName } from '../workspace/hole-chip'
import { useLessonUi } from './state'

/**
 * Device-specific wording in lesson text (LS-14):
 * 「{滑鼠：把游標停在 Blue Pill 上｜觸控：點一下 Blue Pill 上的 A5 腳}」 reads the
 * mouse part on a fine pointer (and on paper), the touch part on a touch
 * screen — one sentence that says exactly what to do on this device.
 */
const DEVICE_RE = /\{滑鼠：([^｜{}]*)｜觸控：([^{}]*)\}/g

/** `text` with its device variants resolved for a touch screen (`touch`) or a mouse. */
export function deviceText(text: string, touch: boolean): string {
  return text.replace(DEVICE_RE, (_, mouse: string, tap: string) => (touch ? tap : mouse))
}

const COARSE = '(pointer: coarse)'

function subscribeCoarse(fn: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(COARSE)
  mq.addEventListener?.('change', fn)
  return () => mq.removeEventListener?.('change', fn)
}

function coarseNow(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(COARSE).matches
  } catch {
    return false
  }
}

/** The primary pointer is a touch screen (re-renders when that changes). */
export function useTouchPointer(): boolean {
  return useSyncExternalStore(subscribeCoarse, coarseNow, () => false)
}

/** A part terminal written in lesson text ("PS1:+", "DMM1:IN", "FG1:out"). */
const TERMINAL_RE = /^([A-Z][A-Z0-9]*\d):([A-Za-z0-9+\-−_]+)$/

let lessonPartTypes: Map<string, string> | null = null

/** Catalog type of a part id as the lessons' own circuits use it (PS1, DMM1, FG1 …), for text read before a load. */
function lessonPartType(id: string): string | undefined {
  if (!lessonPartTypes) {
    lessonPartTypes = new Map()
    for (const l of LESSONS) {
      for (const c of [...l.start.layout.components, ...l.solution.layout.components]) {
        if (!lessonPartTypes.has(c.id)) lessonPartTypes.set(c.id, c.type)
      }
    }
  }
  return lessonPartTypes.get(id)
}

/**
 * The Chinese gloss of a hole / terminal ref, null when `text` is neither. A
 * terminal reads the app's one terminal name (H1 terminalLabel): 「DMM1 IN 端」,
 * 「FG1 輸出端」, 「PS1 正端」 — the chip shows that name instead of the raw ref.
 */
export function refGloss(text: string): string | null {
  const term = TERMINAL_RE.exec(text)
  if (term) {
    const id = term[1]
    // the live part, else the part of that id in the lessons' circuits (the board may not hold it yet)
    const type = useStore.getState().layout.components.find((c) => c.id === id)?.type ?? lessonPartType(id)
    return terminalLabel(text.replace('−', '-'), type ? { components: [{ id, type }] } : undefined)
  }
  if (!/^(?:\d+:)?(?:[a-j]\d+|(?:top|bot)[+-]\d+)$/.test(text)) return null
  const h = parseHole(text)
  if (!h) return null
  if (h.kind === 'rail') return t('{rail}, hole {n}', { rail: railName(h.rail), n: h.index })
  return t('row {row}, column {col}', { row: h.row, col: h.col })
}

function RefChip({ text, gloss }: { text: string; gloss: string }) {
  const key = `ref:${text}`
  const on = useLessonUi((s) => s.focus?.key === key)
  // a terminal shows its name (「DMM1 COM 端」), a hole its own short code (`a14`) with the gloss as tooltip
  const terminal = TERMINAL_RE.test(text)
  return (
    <button
      type="button"
      className={`lsn-code lsn-ref ${on ? 'is-on' : ''}${terminal ? ' is-terminal' : ''}`}
      translate="no"
      title={t('{gloss} — show on the board', { gloss })}
      aria-label={terminal ? gloss : `${text}（${gloss}）`}
      aria-pressed={on}
      onClick={() => {
        const ui = useLessonUi.getState()
        if (on) {
          ui.setFocus(null)
          return
        }
        ui.setFocus({ key, holes: [text], components: [] })
        focusInScene(terminal ? { holes: [text], components: [text.split(':')[0]] } : { holes: [text] }, { kind: 'guide' })
      }}
    >
      {terminal ? gloss : text}
    </button>
  )
}

/** A code span longer than this (characters) may wrap: a firmware line in a phone coach is wider than the card. */
const LONG_CODE = 24

function Inline({ spans, refs }: { spans: MdInline[]; refs: boolean }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.kind === 'text') return <Fragment key={i}>{s.text}</Fragment>
        if (s.kind === 'code') {
          const gloss = refs ? refGloss(s.text) : null
          if (gloss) return <RefChip key={i} text={s.text} gloss={gloss} />
          // printed text: a terminal still reads its name (「DMM1 COM 端」), never 「DMM1:COM」
          const name = TERMINAL_RE.test(s.text) ? refGloss(s.text) : null
          return (
            // a long literal (a whole firmware line) wraps inside its chip instead of running out of the card
            <code key={i} className={`lsn-code${(name ?? s.text).length > LONG_CODE ? ' is-long' : ''}`} translate="no">
              {name ?? s.text}
            </code>
          )
        }
        return (
          <strong key={i}>
            <Inline spans={s.children} refs={refs} />
          </strong>
        )
      })}
    </>
  )
}

export function LessonText({ text, className, refs = true }: { text: string; className?: string; refs?: boolean }) {
  // the printed handout (refs off) keeps the mouse wording
  const touch = useTouchPointer() && refs
  const blocks = useMemo(() => parseMarkdown(deviceText(text, touch)), [text, touch])
  return (
    <div className={`lsn-text ${className ?? ''}`}>
      {blocks.map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inline spans={line} refs={refs} />
              </Fragment>
            ))}
          </p>
        ) : (
          <ul key={i}>
            {b.items.map((item, j) => (
              <li key={j}>
                <Inline spans={item} refs={refs} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  )
}

/** One inline run (no paragraphs) — card titles, list items, check labels. */
export function LessonInline({ text, refs = true }: { text: string; refs?: boolean }) {
  const touch = useTouchPointer() && refs
  const blocks = useMemo(() => parseMarkdown(deviceText(text, touch)), [text, touch])
  const spans: MdInline[] = []
  for (const b of blocks) {
    const runs = b.kind === 'p' ? b.lines : b.items
    for (const r of runs) {
      if (spans.length > 0) spans.push({ kind: 'text', text: ' ' })
      spans.push(...r)
    }
  }
  return <Inline spans={spans} refs={refs} />
}

/**
 * Split step text into its first paragraph (what to do) and the rest (why /
 * details) — the coach shows the rest behind 「為什麼？」 (LS-3).
 */
export function splitFirstParagraph(text: string): [string, string] {
  const parts = text.split(/\n[ \t]*\n/)
  const first = parts[0] ?? ''
  const rest = parts.slice(1).join('\n\n').trim()
  return [first, rest]
}
