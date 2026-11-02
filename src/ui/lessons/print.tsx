/**
 * Printable lesson material (UX LS-7, teacher persona):
 *
 *  - printLesson(lesson, { student }): a light A4 handout with every
 *    section laid out linearly — objectives, wiring text + parts / wires
 *    tables of the reference circuit (the STARTING circuit in the student
 *    copy: 「學生版：不含解答」, LS-15), theory, numbered steps, expected
 *    results, a mistakes table and an acceptance checklist with 預期 / 實測
 *    columns;
 *  - downloadReceipt(lesson, results, at, student): the acceptance result as
 *    a JSON receipt (lesson, the student's 姓名／座號, time, each check's
 *    verdict and measured-vs-expected text, the circuit's SHA-256, every
 *    bound firmware's SHA-256) plus the same data as a printable receipt;
 *    the file name carries the student (LS-15). The name is remembered on
 *    this device (localStorage 'bb.studentName', readStudentName).
 *
 * The view is rendered into a temporary <div class="lsn-print-root"> on
 * <body> (its own React root), `body.lsn-printing` hides everything else
 * under @media print (lessons.css), window.print() opens the dialog and
 * 'afterprint' removes it again. Nothing is shown on screen.
 */
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Lesson, LessonCheck, LessonStimulus } from '../../lessons/types'
import { checkLabel, fmtRange, fmtSi, stimulusText, type EvaluatedCheck } from '../../lessons/engine'
import { useLessonProgress } from '../../lessons/progress'
import { getEntry } from '../../model/catalog'
import type { CircuitLayout } from '../../model/types'
import { partLabel, terminalLabel } from '../../i18n/parts'
import { lang, t } from '../../i18n'
import { sha256Hex } from '../../mcu/loader'
import { useStore } from '../../state/store'
import { useLab } from '../embedded/lab'
import { wireColorLabel } from '../wire-colors'
import { wireRoleOf } from '../wire-roles'
import { isLegacyChrome } from '../chrome/legacy'
import { tc } from '../format'
import { durationText, lessonCode, runnableName } from './labels'
import { LessonInline, LessonText } from './LessonText'

// ------------------------------------------------------------- printing

let active: (() => void) | null = null

function openPrint(node: ReactNode): void {
  if (typeof document === 'undefined') return
  active?.()
  const host = document.createElement('div')
  host.className = 'lsn-print-root'
  document.body.appendChild(host)
  document.body.classList.add('lsn-printing')
  const root = createRoot(host)
  root.render(node)
  const close = () => {
    window.removeEventListener('afterprint', close)
    if (active === close) active = null
    root.unmount()
    host.remove()
    document.body.classList.remove('lsn-printing')
  }
  active = close
  window.addEventListener('afterprint', close)
  // let React commit the view before the (blocking) print dialog snapshots it
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
}

function dateTime(ms: number): string {
  return new Date(ms).toLocaleString(lang() === 'zh-TW' ? 'zh-TW' : 'en-US', { hour12: false })
}

/** What a check expects, for the checklist's 預期 column ('—' when the label says it all). */
/** The learner actions a check (with its sub-checks) performs itself (final round): the handout says so under its condition. */
function checkStimulus(c: LessonCheck): LessonStimulus[] {
  if (c.kind === 'all') return c.checks.flatMap(checkStimulus)
  return (c.kind === 'measure' || c.kind === 'uart-contains') && c.stimulus ? c.stimulus : []
}

export function expectedText(c: LessonCheck): string {
  switch (c.kind) {
    case 'measure':
      return fmtRange(c.quantity, c.min, c.max)
    case 'connected': {
      const v = c.via
      if (!v || (v.min === undefined && v.max === undefined)) return '—'
      const unit = v.param ? (getEntry(v.type)?.params?.find((p) => p.key === v.param)?.unit ?? '') : ''
      const f = (x: number) => (unit ? fmtSi(x, unit) : String(x))
      return v.min !== undefined && v.max !== undefined
        ? t('{min} – {max}', { min: f(v.min), max: f(v.max) })
        : v.min !== undefined
          ? t('at least {min}', { min: f(v.min) })
          : t('at most {max}', { max: f(v.max!) })
    }
    case 'firmware-loaded':
      return c.project ?? '—'
    case 'uart-contains':
      return `「${c.text}」`
    default:
      return '—'
  }
}

/** A wire end in the tables: a hole as written (「a16」), a terminal by its name (「PS1 正端」, H1). */
function endText(ref: string, layout: CircuitLayout): string {
  return ref.includes(':') ? terminalLabel(ref, layout) : ref
}

/**
 * A wire's colour in the handout: the product chrome names the colour the
 * board draws (its net's role, contract C1 — 「紅色：電源正極（5 V 網路）」);
 * the classic chrome the stored colour.
 */
function wireColorText(layout: CircuitLayout, id: string, stored: string | undefined): string {
  if (!isLegacyChrome()) return wireRoleOf(layout, id).reason
  return stored ? wireColorLabel(stored) : '—'
}

function placeText(holes: string[] | undefined, at: string | undefined): string {
  if (holes && holes.length > 0) return holes.join('、')
  if (at) return at
  return t('off the board')
}

function CircuitTables({ layout }: { layout: CircuitLayout }) {
  return (
    <div className="lsn-print-pair">
      <table className="lsn-print-table">
        <thead>
          <tr>
            <th>{tc('Part', 'handout')}</th>
            <th>{tc('Part name', 'handout')}</th>
            <th>{tc('Holes', 'handout')}</th>
          </tr>
        </thead>
        <tbody>
          {layout.components.map((c) => {
            const e = getEntry(c.type)
            return (
              <tr key={c.id}>
                <td translate="no">{c.id}</td>
                <td>{e ? partLabel(e) : c.type}</td>
                <td translate="no">{placeText(c.holes, c.at)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {layout.wires.length > 0 && (
        <table className="lsn-print-table">
          <thead>
            <tr>
              <th>{t('Wire')}</th>
              <th>{t('From')}</th>
              <th>{t('To')}</th>
              <th>{tc('Color', 'handout')}</th>
            </tr>
          </thead>
          <tbody>
            {layout.wires.map((w) => (
              <tr key={w.id}>
                <td translate="no">{w.id}</td>
                <td translate="no">{endText(w.from, layout)}</td>
                <td translate="no">{endText(w.to, layout)}</td>
                {/* product chrome: the colour the board shows — its net's role (contract C1) */}
                <td>{wireColorText(layout, w.id, w.color)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function Handout({ lesson, student = false }: { lesson: Lesson; student?: boolean }) {
  const duration = durationText(lesson.durationMin)
  return (
    <article className="lsn-print">
      <header className="lsn-print-head">
        <div className="lsn-print-eyebrow">
          {lessonCode(lesson)} · {t('ohmlet STM32 electronics lab')}
          {student && ` · ${t('Student copy')}`}
        </div>
        <h1>{lesson.title}</h1>
        <div className="lsn-print-meta">
          {[duration, runnableName(lesson.runnable)].filter(Boolean).join(' · ')}
          <span className="lsn-print-fill">
            {tc('Student name', 'handout')}：＿＿＿＿＿＿＿　{tc('Date', 'handout')}：＿＿＿＿＿＿
          </span>
        </div>
        <p>
          <LessonInline text={lesson.summary} refs={false} />
        </p>
        {lesson.runnable !== 'ready' && lesson.runnableNote && <p className="lsn-print-note">{lesson.runnableNote}</p>}
      </header>

      <section>
        <h2>{t('After this lesson you can')}</h2>
        <ul>
          {lesson.objectives.map((x, i) => (
            <li key={i}>
              <LessonInline text={x} refs={false} />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{t('Wiring')}</h2>
        <LessonText text={lesson.wiring} refs={false} />
        {student ? (
          <>
            <h3>{t('Starting circuit')}</h3>
            <CircuitTables layout={lesson.start.layout} />
          </>
        ) : (
          <>
            <h3>{t('Reference circuit')}</h3>
            <CircuitTables layout={lesson.solution.layout} />
          </>
        )}
        {!student && Object.keys(lesson.solution.firmware ?? {}).length > 0 && (
          <p>
            {t('Firmware')}：
            {Object.entries(lesson.solution.firmware ?? {})
              .map(([id, fw]) => `${id} ← ${fw}`)
              .join('、')}
          </p>
        )}
      </section>

      <section>
        <h2>{t('Theory')}</h2>
        <LessonText text={lesson.theory} refs={false} />
      </section>

      <section>
        <h2>{t('Steps')}</h2>
        <ol className="lsn-print-steps">
          {lesson.steps.map((s) => (
            <li key={s.id}>
              <strong>{s.title}</strong>
              <LessonText text={s.body} refs={false} />
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2>{t('Expected results')}</h2>
        <ul>
          {lesson.expected.map((x, i) => (
            <li key={i}>
              <LessonInline text={x} refs={false} />
            </li>
          ))}
        </ul>
      </section>

      {lesson.mistakes.length > 0 && (
        <section>
          <h2>{t('Common mistakes')}</h2>
          <table className="lsn-print-table is-wide">
            <thead>
              <tr>
                <th>{tc('Symptom', 'handout')}</th>
                <th>{t('Cause')}</th>
                <th>{t('Fix')}</th>
              </tr>
            </thead>
            <tbody>
              {lesson.mistakes.map((m, i) => (
                <tr key={i}>
                  <td>
                    <LessonInline text={m.symptom} refs={false} />
                  </td>
                  <td>
                    <LessonInline text={m.cause} refs={false} />
                  </td>
                  <td>
                    <LessonInline text={m.fix} refs={false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {lesson.acceptance.length > 0 && (
        <section className="lsn-print-keep">
          <h2>{t('Acceptance checklist')}</h2>
          <table className="lsn-print-table is-check">
            <thead>
              <tr>
                <th aria-label={tc('Done', 'handout')} />
                <th>{tc('Condition', 'handout')}</th>
                <th>{tc('Expected', 'handout')}</th>
                <th>{tc('Measured', 'handout')}</th>
              </tr>
            </thead>
            <tbody>
              {lesson.acceptance.map((c, i) => (
                <tr key={i}>
                  <td className="lsn-print-box">☐</td>
                  <td>
                    <LessonInline text={checkLabel(c, lesson.solution.layout)} refs={false} />
                    {checkStimulus(c).length > 0 && (
                      <div className="lsn-print-stim">{stimulusText(checkStimulus(c), lesson.solution.layout)}</div>
                    )}
                  </td>
                  <td>{expectedText(c)}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </article>
  )
}

/**
 * Open the printable handout of `lesson` (A4, light). `student`: the
 * student copy — the starting circuit instead of the reference solution.
 */
export function printLesson(lesson: Lesson, opts: { student?: boolean } = {}): void {
  openPrint(<Handout lesson={lesson} student={!!opts.student} />)
}

// --------------------------------------------------------- student name

/** localStorage key of the student's 姓名／座號 on this device (LS-15). */
export const STUDENT_NAME_KEY = 'bb.studentName'

/** The remembered 姓名／座號 ('' = none yet; storage may be unavailable). */
export function readStudentName(): string {
  try {
    return (typeof localStorage !== 'undefined' ? localStorage.getItem(STUDENT_NAME_KEY) : null)?.trim() ?? ''
  } catch {
    return ''
  }
}

/** Remember the 姓名／座號 (best effort: a private window may refuse). */
export function saveStudentName(name: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STUDENT_NAME_KEY, name.trim())
  } catch {
    /* not remembered — the receipt still carries it */
  }
}

/** The name as a file-name part: 「王小明 12」 → 「王小明-12」 (no path or reserved characters). */
export function fileSafeName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

// --------------------------------------------------------------- receipt

export interface LessonReceipt {
  kind: 'ohmlet-lesson-receipt'
  version: 1
  lesson: { id: string; code: string; title: string; level: Lesson['level'] }
  /** 姓名／座號 as the student typed it (LS-15; absent in older receipts) */
  student?: { name: string }
  checkedAt: string
  passed: number
  total: number
  complete: boolean
  /** the lesson's solution was loaded and no start circuit since */
  viaSolution: boolean
  layoutSha256: string
  firmware: { componentId: string; file: string; sha256: string }[]
  checks: { label: string; kind: string; pass: boolean; expected: string; detail: string }[]
}

/** The acceptance receipt of a finished run (pure apart from the live firmware / layout it records). */
export function buildReceipt(lesson: Lesson, results: readonly EvaluatedCheck[], at: number, student = ''): LessonReceipt {
  const layout = useStore.getState().layout
  const firmware = Object.values(useLab.getState().firmware)
    .map((r) => ({ componentId: r.componentId, file: r.name, sha256: r.sha256 }))
    .sort((a, b) => a.componentId.localeCompare(b.componentId))
  const passed = results.filter((r) => r.pass).length
  return {
    kind: 'ohmlet-lesson-receipt',
    version: 1,
    lesson: { id: lesson.id, code: lessonCode(lesson), title: lesson.title, level: lesson.level },
    ...(student.trim() ? { student: { name: student.trim() } } : {}),
    checkedAt: new Date(at).toISOString(),
    passed,
    total: results.length,
    complete: passed === results.length && results.length > 0,
    viaSolution: !!useLessonProgress.getState().lessons[lesson.id]?.viaSolution,
    layoutSha256: sha256Hex(new TextEncoder().encode(JSON.stringify(layout))),
    firmware,
    checks: results.map((r, i) => ({
      label: r.label,
      kind: r.kind,
      pass: r.pass,
      expected: lesson.acceptance[i] ? expectedText(lesson.acceptance[i]) : '—',
      detail: r.detail,
    })),
  }
}

function Receipt({ receipt }: { receipt: LessonReceipt }) {
  return (
    <article className="lsn-print">
      <header className="lsn-print-head">
        <div className="lsn-print-eyebrow">
          {receipt.lesson.code} · {t('Acceptance receipt')}
        </div>
        <h1>{receipt.lesson.title}</h1>
        <div className="lsn-print-meta">
          {t('Checked {time}', { time: dateTime(Date.parse(receipt.checkedAt)) })} ·{' '}
          <strong>{t('{passed} of {n} conditions pass', { passed: receipt.passed, n: receipt.total })}</strong>
          {receipt.viaSolution && ` · ${t('Completed with the solution')}`}
          <span className="lsn-print-fill">
            {tc('Student name', 'handout')}：{receipt.student?.name || '＿＿＿＿＿＿＿＿＿＿'}
          </span>
        </div>
      </header>
      <table className="lsn-print-table is-check">
        <thead>
          <tr>
            <th>{tc('Result', 'handout')}</th>
            <th>{tc('Condition', 'handout')}</th>
            <th>{tc('Expected', 'handout')}</th>
            <th>{tc('Measured', 'handout')}</th>
          </tr>
        </thead>
        <tbody>
          {receipt.checks.map((c, i) => (
            <tr key={i}>
              <td className={c.pass ? 'is-pass' : 'is-fail'}>{c.pass ? `✓ ${t('passed')}` : `✕ ${t('failed')}`}</td>
              <td>
                <LessonInline text={c.label} refs={false} />
              </td>
              <td>{c.expected}</td>
              <td>{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="lsn-print-small">
        <div>
          {t('Circuit SHA-256')}：<code translate="no">{receipt.layoutSha256}</code>
        </div>
        {receipt.firmware.length === 0 ? (
          <div>{t('Firmware')}：—</div>
        ) : (
          receipt.firmware.map((f) => (
            <div key={f.componentId}>
              {t('Firmware')} {f.componentId}：<code translate="no">{f.file}</code> SHA-256 <code translate="no">{f.sha256}</code>
            </div>
          ))
        )}
      </section>
    </article>
  )
}

function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** The receipt's file name: 「b1-led-resistor-王小明-12-acceptance-20261014-1515.json」. */
export function receiptFileName(lesson: Lesson, at: number, student = ''): string {
  const who = fileSafeName(student)
  return `${lesson.id}${who ? `-${who}` : ''}-acceptance-${stamp(at)}.json`
}

/** 「匯出驗收結果」: download the JSON receipt (named after the student) and open its printable version. */
export function downloadReceipt(lesson: Lesson, results: readonly EvaluatedCheck[], at: number, student = ''): LessonReceipt {
  const receipt = buildReceipt(lesson, results, at, student)
  if (typeof document !== 'undefined') {
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = receiptFileName(lesson, at, student)
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    openPrint(<Receipt receipt={receipt} />)
  }
  return receipt
}
