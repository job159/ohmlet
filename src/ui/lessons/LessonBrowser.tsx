/**
 * The lesson browser — the workspace Library panel's 課程 tab and the phone /
 * classic-chrome lessons sheet render this same component.
 *
 *  - list: lessons grouped by level (初級 / 中級 / 進階) as Tier-S cards —
 *    course code + title (「初級 1 · LED 與限流電阻」), summary, duration, the
 *    runnable badge (可執行 / 部分模擬 / 尚不可執行) with its honest note,
 *    progress (step n / m) and a completed check — green when earned, grey
 *    「以解答完成」 when the solution was loaded for it (src/lessons/progress.ts,
 *    localStorage 'bb.lessons');
 *  - lesson view: header (back, 列印講義 ▾ teacher / student copy, ⋯, code,
 *    title, duration, badge, the completion / last-check chips), the actions
 *    — before the lesson's circuit is on the board 載入起始電路 (filled) /
 *    顯示解答 / 開始引導 / 檢查我的電路; once it is (lessonOnBoard: the board
 *    descends from THIS lesson's load — release QA LS-F1) 檢查我的電路
 *    (filled) / 開始引導 / 重新載入起始電路, 顯示解答… behind ⋯
 *    (LS-14) — then the sections 目標 · 接線 · 原理 · 步驟 · 預期結果 · 常見錯誤 ·
 *    驗收 as a wrapping chip tab row. Steps navigate the guide (coach card +
 *    3D highlights + camera) and offer one-click actions (load a bundled
 *    firmware, ▶ run, take a part, start wiring, add analyzer channels, set a
 *    failing value — LS-1, LS-11) next to their own check; the last step
 *    leads to 驗收 (LS-12). 驗收 runs every acceptance check against the LIVE
 *    circuit (off the main thread), puts the most likely cause first (LS-5),
 *    scrolls its outcome into view (LS-12) and, on a pass, offers the next
 *    lesson (LS-4) and a receipt named after the student (LS-7, LS-15).
 *    A bound firmware reads 「✓ 已載入 · 尚未執行／執行中／已暫停」 (LS-8).
 *
 * Lesson content is authored in zh-TW and shown as is; UI strings go through
 * t() (src/i18n/zh-TW/lessons-ui.ts, ux-lessons.ts, ux-lessons-2.ts).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LESSONS, lessonById } from '../../lessons'
import type { Lesson, LessonLevel, LessonStepAction } from '../../lessons/types'
import { useLessonProgress, type LessonProgressEntry } from '../../lessons/progress'
import {
  actionKey,
  countParts,
  lessonMcu,
  mainFirmware,
  mistakeFirmware,
  paramFixes,
  pendingWire,
  resetTarget,
  stepActions,
  stepPendingWire,
  wiresOnBoard,
} from '../../lessons/step-actions'
import { missingStartParts } from '../../lessons/diagnose'
import { getEntry } from '../../model/catalog'
import { partLabel } from '../../i18n/parts'
import { fmtSi, resolvePinRef } from '../../lessons/engine'
import { tidyCjkSpaces } from '../../lessons/engine/refs'
import type { CircuitLayout } from '../../model/types'
import type { LogicChannelConfig } from '../../sim/coordinator/api'
import { focusInspector } from '../embedded/problems'
import { lang, t, useLang } from '../../i18n'
import { useStore } from '../../state/store'
import { useLab } from '../embedded/lab'
import { useSimPhase, type SimPhase } from '../chrome/run-control'
import { withKey } from '../chrome/ShortcutsSheet'
import {
  BookIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  ExportIcon,
  PlayIcon,
  PressableButton,
  ResetIcon,
  pressProps,
  tick,
} from '../kit'
import { LESSON_SECTIONS, runKey, useLessonUi, type LessonSection } from './state'
import {
  addLogicChannels,
  applyParamFix,
  armPart,
  cancelRun,
  clampStep,
  firmwareStem,
  goToLesson,
  goToAcceptance,
  goToStep,
  lessonOnBoard,
  loadStepFirmware,
  nextLesson,
  nextLevelStart,
  requestLoad,
  resetFromStep,
  runAcceptance,
  runSim,
  runStepCheck,
  startGuide,
  startWiring,
  logicPinName,
  unwireFromStep,
  useAutoCheck,
  wireEndText,
} from './actions'
import { LEVEL_ORDER, RunnableBadge, durationText, lessonCode, levelName } from './labels'
import { CheckResults, runSummary } from './CheckResults'
import { LessonInline, LessonText, splitFirstParagraph } from './LessonText'
import { tc } from '../format'
import { downloadReceipt, printLesson, readStudentName, saveStudentName } from './print'
import './lessons.css'

/** The user asked for less motion (scrolls jump instead of gliding). */
function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** English sources of the section tabs. */
const SECTION_NAMES: Record<LessonSection, string> = {
  objectives: 'Objectives',
  wiring: 'Wiring',
  theory: 'Theory',
  steps: 'Steps',
  expected: 'Expected results',
  mistakes: 'Common mistakes',
  acceptance: 'Acceptance',
}

export function LessonBrowser({ variant }: { variant: 'panel' | 'sheet' }) {
  useLang()
  const viewId = useLessonUi((s) => s.viewId)
  const lesson = viewId ? lessonById(viewId) : undefined
  return lesson ? <LessonView key={lesson.id} lesson={lesson} variant={variant} /> : <LessonList />
}

// ---------------------------------------------------------------- the list

function progressLine(lesson: Lesson, p: LessonProgressEntry | undefined): string | null {
  if (!p) return null
  if (p.completedAt !== undefined) return p.viaSolution ? t('Completed with the solution') : t('Completed')
  if (p.startedAt === undefined || lesson.steps.length === 0) return null
  return t('Step {n} of {m}', { n: clampStep(lesson, p.step) + 1, m: lesson.steps.length })
}

function LessonList() {
  const progress = useLessonProgress((s) => s.lessons)
  const coachId = useLessonUi((s) => s.coachId)
  if (LESSONS.length === 0) {
    return (
      <div className="lsn-empty">
        <span className="lsn-empty-art" aria-hidden="true">
          <BookIcon size={34} />
        </span>
        <span className="lg-headline">{t('No lessons yet')}</span>
      </div>
    )
  }
  const done = LESSONS.filter((l) => progress[l.id]?.completedAt !== undefined).length
  const groups = LEVEL_ORDER.map((level) => ({ level, lessons: LESSONS.filter((l) => l.level === level) })).filter(
    (g) => g.lessons.length > 0,
  )
  return (
    <div className="lsn-list">
      <div className="lsn-list-intro lg-caption">
        {t('Guided builds checked automatically against the live simulation.')}{' '}
        <span className="lg-tabular">{t('{done} of {n} completed', { done, n: LESSONS.length })}</span>
      </div>
      {groups.map((g) => (
        <LevelGroup key={g.level} level={g.level} lessons={g.lessons} progress={progress} coachId={coachId} />
      ))}
    </div>
  )
}

function LevelGroup({
  level,
  lessons,
  progress,
  coachId,
}: {
  level: LessonLevel
  lessons: Lesson[]
  progress: Record<string, LessonProgressEntry>
  coachId: string | null
}) {
  const name = levelName(level)
  return (
    <section className="lsn-level" aria-label={name}>
      <div className="lg-list-header lg-caption">{name}</div>
      <div className="lsn-cards">
        {lessons.map((l) => (
          <LessonCard key={l.id} lesson={l} progress={progress[l.id]} guiding={coachId === l.id} />
        ))}
      </div>
    </section>
  )
}

function LessonCard({ lesson, progress, guiding }: { lesson: Lesson; progress?: LessonProgressEntry; guiding: boolean }) {
  const openLesson = useLessonUi((s) => s.openLesson)
  const completed = progress?.completedAt !== undefined
  const viaSolution = completed && !!progress?.viaSolution
  const duration = durationText(lesson.durationMin)
  const status = progressLine(lesson, progress)
  const summaryId = `lsn-sum-${lesson.id}`
  const code = lessonCode(lesson)
  return (
    <button
      type="button"
      className={`lsn-card lg-card lg-pressable ${completed ? 'is-done' : ''} ${guiding ? 'is-guiding' : ''}`}
      aria-label={[`${code} · ${lesson.title}`, duration, status].filter(Boolean).join(' · ')}
      aria-describedby={summaryId}
      {...pressProps}
      onClick={() => {
        tick()
        openLesson(lesson.id)
      }}
    >
      <span className="lsn-card-top">
        <span className="lsn-card-title">
          <span className="lsn-card-code">{code} · </span>
          {lesson.title}
        </span>
        {completed && (
          <span className={`lsn-done ${viaSolution ? 'is-solution' : ''}`} title={viaSolution ? t('Completed with the solution') : t('Completed')}>
            <CheckIcon size={14} />
          </span>
        )}
      </span>
      <span className="lsn-card-summary" id={summaryId}>
        <LessonInline text={lesson.summary} refs={false} />
      </span>
      <span className="lsn-card-meta">
        <RunnableBadge runnable={lesson.runnable} />
        {duration && <span className="lg-tabular">{duration}</span>}
        {guiding ? <span className="lsn-card-guiding">{t('Guiding')}</span> : status && (!completed || viaSolution) ? <span>{status}</span> : null}
      </span>
      {lesson.runnable !== 'ready' && lesson.runnableNote && <span className="lsn-card-note">{lesson.runnableNote}</span>}
    </button>
  )
}

// ---------------------------------------------------------- the lesson view

export function LessonView({ lesson, variant }: { lesson: Lesson; variant: 'panel' | 'sheet' }) {
  const section = useLessonUi((s) => s.section)
  const setSection = useLessonUi((s) => s.setSection)
  const closeLesson = useLessonUi((s) => s.closeLesson)
  const coachId = useLessonUi((s) => s.coachId)
  const acceptance = useLessonUi((s) => s.runs[runKey(lesson.id)])
  const progress = useLessonProgress((s) => s.lessons[lesson.id])
  const topRef = useRef<HTMLDivElement>(null)
  const runnable = lesson.runnable !== 'not-yet'
  const completed = progress?.completedAt !== undefined
  const viaSolution = completed && !!progress?.viaSolution
  const lastCheck = progress?.lastCheck
  const duration = durationText(lesson.durationMin)
  const running = acceptance?.status === 'running'
  // the learner is working on this lesson — the board holds ITS circuit (LS-F1: a board that descends
  // from another lesson's load never counts, even while it shares parts): the next action is the
  // check, the start circuit only reloads, the solution hides (LS-14)
  const layout = useStore((s) => s.layout)
  const working = useMemo(() => lessonOnBoard(lesson, layout), [lesson, layout])

  // the panel / sheet scroller is an ancestor: a lesson opens at its header (back, title — the
  // list may have been scrolled), a new section starts at the tab row
  const viewRef = useRef<HTMLDivElement>(null)
  const shownSection = useRef(section)
  useEffect(() => {
    // 'start': a view taller than the scroller that covers it would not move with 'nearest'
    viewRef.current?.scrollIntoView?.({ block: 'start' })
  }, [])
  useEffect(() => {
    if (shownSection.current === section) return
    shownSection.current = section
    topRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [section])

  const check = () => {
    setSection('acceptance')
    void runAcceptance(lesson)
  }

  return (
    <div ref={viewRef} className={`lsn-view is-${variant}`}>
      <div className="lsn-view-nav">
        <button type="button" className="lsn-back lg-pressable" {...pressProps} onClick={closeLesson}>
          <ChevronLeftIcon size={16} />
          <span>{t('All lessons')}</span>
        </button>
        <span className="lsn-view-tools">
          <OverflowMenu
            label={t('A printable handout: steps, wiring, mistakes and an acceptance checklist')}
            trigger={
              <>
                <ExportIcon size={15} />
                <span>{t('Print handout')}</span>
              </>
            }
            triggerClass="lsn-head-btn"
            items={[
              { label: t('Print handout (with the solution)'), run: () => printLesson(lesson) },
              { label: t('Print handout (student copy: no solution)'), run: () => printLesson(lesson, { student: true }) },
            ]}
          />
          {/* while the learner works on the lesson, the solution is one deliberate step away (LS-14) */}
          {working && (
            <OverflowMenu label={t('More lesson actions')} items={[{ label: t('Show solution…'), run: () => requestLoad(lesson, 'solution') }]} />
          )}
        </span>
      </div>

      <header className="lsn-view-head">
        <div className="lsn-view-code">{lessonCode(lesson)}</div>
        <h2 className="lsn-view-title">{lesson.title}</h2>
        <div className="lsn-card-meta">
          {duration && <span className="lg-tabular">{duration}</span>}
          <RunnableBadge runnable={lesson.runnable} />
          {completed && !viaSolution && (
            <span className="lsn-done-chip">
              <CheckIcon size={12} />
              {t('Completed')}
            </span>
          )}
          {viaSolution && (
            <span className="lsn-done-chip is-solution" title={t('Completed after loading the solution — load the starting circuit and build it yourself to earn it.')}>
              <CheckIcon size={12} />
              {t('Completed with the solution')}
            </span>
          )}
          {lastCheck && lastCheck.passed < lastCheck.total && (
            <span className="lsn-last-chip lg-tabular" title={t('The last acceptance check on this device')}>
              {t('Last check {p}/{n}', { p: lastCheck.passed, n: lastCheck.total })}
            </span>
          )}
        </div>
        <p className="lsn-view-summary">
          <LessonInline text={lesson.summary} />
        </p>
        {lesson.runnable !== 'ready' && lesson.runnableNote && (
          <div className={`lsn-callout is-${lesson.runnable}`}>
            <strong>{lesson.runnable === 'partial' ? t('Not simulated:') : t('Cannot run yet:')}</strong> {lesson.runnableNote}
          </div>
        )}
      </header>

      <div className="lsn-actions">
        {working ? (
          <PressableButton
            size="sm"
            variant="filled"
            disabled={!runnable || running || lesson.acceptance.length === 0}
            title={runnable ? undefined : t('This lesson cannot run in the simulator yet.')}
            onClick={check}
          >
            {running ? t('Checking…') : t('Check my circuit')}
          </PressableButton>
        ) : (
          <>
            <PressableButton size="sm" variant="filled" onClick={() => requestLoad(lesson, 'start')}>
              {t('Load starting circuit')}
            </PressableButton>
            <PressableButton size="sm" variant="tinted" onClick={() => requestLoad(lesson, 'solution')}>
              {t('Show solution')}
            </PressableButton>
          </>
        )}
        {lesson.steps.length > 0 && coachId !== lesson.id && (
          <PressableButton
            size="sm"
            variant="tinted"
            onClick={() => {
              startGuide(lesson)
              setSection('steps')
            }}
          >
            {/* off its own circuit the guide starts over on the starting circuit (LS-F1): never 「繼續」 then */}
            {progress?.startedAt !== undefined && working ? t('Resume guide') : t('Start guide')}
          </PressableButton>
        )}
        {working ? (
          <PressableButton size="sm" variant="tinted" onClick={() => requestLoad(lesson, 'start')}>
            {t('Reload starting circuit')}
          </PressableButton>
        ) : (
          <PressableButton
            size="sm"
            variant="tinted"
            disabled={!runnable || running || lesson.acceptance.length === 0}
            title={runnable ? undefined : t('This lesson cannot run in the simulator yet.')}
            onClick={check}
          >
            {running ? t('Checking…') : t('Check my circuit')}
          </PressableButton>
        )}
      </div>

      <div ref={topRef} className="lsn-tabs" role="tablist" aria-label={t('Lesson sections')}>
        {LESSON_SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            id={`lsn-tab-${variant}-${s}`}
            aria-selected={section === s}
            aria-controls={`lsn-sec-${variant}`}
            className={`lsn-tab lg-pressable ${section === s ? 'is-on' : ''}`}
            {...pressProps}
            onClick={() => setSection(s)}
          >
            {t(SECTION_NAMES[s])}
            {s === 'acceptance' && <AcceptanceBadge lessonId={lesson.id} />}
          </button>
        ))}
      </div>

      <div className="lsn-section" role="tabpanel" id={`lsn-sec-${variant}`} aria-labelledby={`lsn-tab-${variant}-${section}`}>
        {section === 'objectives' && <Objectives lesson={lesson} />}
        {section === 'wiring' && <Wiring lesson={lesson} />}
        {section === 'theory' && <LessonText text={lesson.theory} />}
        {section === 'steps' && <Steps lesson={lesson} />}
        {section === 'expected' && <Bullets items={lesson.expected} />}
        {section === 'mistakes' && <Mistakes lesson={lesson} />}
        {section === 'acceptance' && <Acceptance lesson={lesson} onCheck={check} />}
      </div>
    </div>
  )
}

/**
 * ⋯ — the lesson's rarely used actions (「顯示解答…」, LS-14): a small Tier-S
 * menu under the button (no backdrop-filter); Esc, a click elsewhere or a
 * choice closes it.
 */
function OverflowMenu({
  label,
  items,
  trigger,
  triggerClass = 'lsn-more-btn',
}: {
  label: string
  items: { label: string; run: () => void }[]
  /** the button's content (default ⋯) */
  trigger?: ReactNode
  triggerClass?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  return (
    <span ref={rootRef} className="lsn-more">
      <button
        type="button"
        className={`${triggerClass} lg-pressable`}
        aria-label={trigger ? undefined : label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        {...pressProps}
        onClick={() => setOpen(!open)}
      >
        {trigger ?? <EllipsisIcon size={18} />}
      </button>
      {open && (
        <span className="lsn-more-menu" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="lsn-more-item"
              onClick={() => {
                setOpen(false)
                it.run()
              }}
            >
              {it.label}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

function AcceptanceBadge({ lessonId }: { lessonId: string }) {
  const run = useLessonUi((s) => s.runs[runKey(lessonId)])
  const sum = runSummary(run)
  if (!sum) return null
  const ok = sum.passed === sum.total
  return (
    <span className={`lsn-tab-count ${ok ? 'is-pass' : 'is-fail'}`} aria-label={t('{passed} of {n} pass', { passed: sum.passed, n: sum.total })}>
      {sum.passed}/{sum.total}
    </span>
  )
}

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="lsn-bullets">
      {items.map((x, i) => (
        <li key={i}>
          <LessonInline text={x} />
        </li>
      ))}
    </ul>
  )
}

function Objectives({ lesson }: { lesson: Lesson }) {
  return (
    <>
      <div className="lsn-sub">{t('After this lesson you can')}</div>
      <Bullets items={lesson.objectives} />
    </>
  )
}

// ------------------------------------------------------------- firmware

/** The bundled project bound to `componentId` (re-renders only when it changes). */
function useBoundProject(componentId: string | undefined): string | null {
  return useLab((s) => {
    const rec = componentId ? s.firmware[componentId] : undefined
    return rec ? firmwareStem(rec.name) : null
  })
}

/** The run phase in the MCU badge's words (尚未執行 / 執行中 / 已暫停 / 核心已停住 / 故障). */
const PHASE_WORDS: Record<SimPhase, string> = {
  idle: 'Not run yet',
  running: 'Running',
  paused: 'Paused',
  halted: 'Halted',
  fault: 'Fault',
}

/**
 * 「· 尚未執行」: what a bound firmware is doing right now (LS-8). Binding is
 * 「已載入」; only the run phase may say 「執行中」, so a learner who loaded
 * the firmware is never told it runs before ▶ 執行模擬.
 */
export function phaseSuffix(phase: SimPhase): string {
  return ` · ${tc(PHASE_WORDS[phase], 'mcu-state')}`
}

/** 「✓ U1 已載入 hal-blink · 尚未執行」 — a firmware bound to a board, with the live run phase (LS-8). */
function BoundFirmware({ id, project }: { id: string; project: string }) {
  const phase = useSimPhase()
  return (
    <span className={`lsn-fw-state is-${phase}`}>
      <CheckIcon size={12} />
      {t('{id} has {project} loaded', { id, project })}
      <span className="lsn-fw-phase">{phaseSuffix(phase)}</span>
    </span>
  )
}

/** A firmware pill of the Wiring section: 「hal-blink · 載入到 U1」, or 「✓ 已載入 · 尚未執行」 once bound. */
function FirmwarePill({ project, component }: { project: string; component: string | undefined }) {
  const bound = useBoundProject(component)
  const loading = useLessonUi((s) => s.loadingFirmware === `${component}|${project}`)
  const phase = useSimPhase()
  if (!component) {
    return (
      <code className="lsn-code" translate="no">
        {project}
      </code>
    )
  }
  const on = bound === project
  return (
    <button
      type="button"
      className={`lsn-fw-pill lg-pressable ${on ? 'is-on' : ''}`}
      {...pressProps}
      disabled={on || loading}
      aria-label={
        on ? t('{id} has {project} loaded', { id: component, project }) + phaseSuffix(phase) : t('Load {project} into {id}', { project, id: component })
      }
      onClick={() => void loadStepFirmware(component, project)}
    >
      <code translate="no">{project}</code>
      <span className="lsn-fw-pill-act">
        {on ? (
          <>
            <CheckIcon size={12} />
            {tc('loaded', 'firmware pill')}
            {phaseSuffix(phase)}
          </>
        ) : loading ? (
          t('Loading…')
        ) : (
          t('Load into {id}', { id: component })
        )}
      </span>
    </button>
  )
}

function Wiring({ lesson }: { lesson: Lesson }) {
  const parts = [...new Set(lesson.requires?.parts ?? [])]
  const firmware = [...new Set(lesson.requires?.firmware ?? Object.values(lesson.solution.firmware ?? {}))]
  const mcu = lessonMcu(lesson)
  return (
    <>
      <LessonText text={lesson.wiring} />
      {(parts.length > 0 || firmware.length > 0) && (
        <div className="lsn-requires lg-card">
          {parts.length > 0 && (
            <div>
              <span className="lsn-sub">{t('Parts')}</span>
              <span className="lsn-requires-list">
                {parts.map((p) => {
                  const e = getEntry(p)
                  return (
                    <span key={p} className="lsn-pill">
                      {e ? partLabel(e) : p}
                    </span>
                  )
                })}
              </span>
            </div>
          )}
          {firmware.length > 0 && (
            <div>
              <span className="lsn-sub">{t('Firmware')}</span>
              <span className="lsn-requires-list">
                {firmware.map((f) => (
                  <FirmwarePill key={f} project={f} component={mcu} />
                ))}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  )
}

/** 「重現這個錯誤：載入 lesson-i1-noclk」, and 「換回 hal-blink」 while it runs. */
function MistakeFirmware({ lesson, project }: { lesson: Lesson; project: string }) {
  const mcu = lessonMcu(lesson)
  const bound = useBoundProject(mcu)
  const loading = useLessonUi((s) => s.loadingFirmware !== null)
  if (!mcu) return null
  const main = mainFirmware(lesson, mcu)
  if (bound === project) {
    return (
      <div className="lsn-actrow">
        <BoundFirmware id={mcu} project={project} />
        {main && (
          <PressableButton size="sm" variant="tinted" disabled={loading} onClick={() => void loadStepFirmware(mcu, main)}>
            {t('Switch back to {project}', { project: main })}
          </PressableButton>
        )}
      </div>
    )
  }
  return (
    <div className="lsn-actrow">
      <PressableButton size="sm" variant="tinted" disabled={loading} onClick={() => void loadStepFirmware(mcu, project)}>
        {t('Reproduce this mistake: load {project}', { project })}
      </PressableButton>
    </div>
  )
}

function Mistakes({ lesson }: { lesson: Lesson }) {
  if (lesson.mistakes.length === 0) return <p className="lg-caption">{t('No common mistakes listed.')}</p>
  return (
    <div className="lsn-mistakes">
      {lesson.mistakes.map((m, i) => (
        <div key={i} className="lsn-mistake lg-card">
          <div className="lsn-mistake-symptom">
            <LessonInline text={m.symptom} />
          </div>
          <dl>
            <dt>{t('Cause')}</dt>
            <dd>
              <LessonInline text={m.cause} />
            </dd>
            <dt>{t('Fix')}</dt>
            <dd>
              <LessonInline text={m.fix} />
            </dd>
          </dl>
          {mistakeFirmware(lesson, m).map((f) => (
            <MistakeFirmware key={f} lesson={lesson} project={f} />
          ))}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- steps

function Steps({ lesson }: { lesson: Lesson }) {
  const progress = useLessonProgress((s) => s.lessons[lesson.id])
  const coachId = useLessonUi((s) => s.coachId)
  const docked = useLessonUi((s) => s.coachDocked)
  const current = clampStep(lesson, progress?.step ?? 0)
  const done = progress?.stepsDone ?? []
  const guiding = coachId === lesson.id
  // the coach card docked above this panel IS the current step: the list stays a table of contents
  const inCoach = guiding && docked
  if (lesson.steps.length === 0) return <p className="lg-caption">{t('This lesson has no guided steps.')}</p>
  return (
    <ol className="lsn-steps">
      {lesson.steps.map((step, i) => {
        const isCurrent = i === current
        const isDone = done.includes(step.id)
        return (
          <li key={step.id} className={`lsn-step ${isCurrent ? 'is-current' : ''} ${isDone ? 'is-done' : ''}`}>
            <button
              type="button"
              className="lsn-step-head lg-pressable"
              aria-expanded={isCurrent && !inCoach}
              aria-current={isCurrent ? 'step' : undefined}
              {...pressProps}
              onClick={() => {
                goToStep(lesson, i)
                if (guiding) startGuide(lesson, i)
              }}
            >
              <span className="lsn-step-num" aria-hidden="true">
                {isDone ? <CheckIcon size={12} /> : i + 1}
              </span>
              <span className="lsn-step-title">{step.title}</span>
              {isDone && <span className="lsn-visually-hidden">{t('done')}</span>}
              {isCurrent && inCoach && <span className="lsn-step-tag">{t('In the guide above')}</span>}
            </button>
            {isCurrent && !inCoach && <StepBody lesson={lesson} index={i} />}
          </li>
        )
      })}
    </ol>
  )
}

/** Live count of each armed type's parts on the board (recounted on edits only, never per frame). */
function useCounts(types: readonly string[]): number[] {
  const layout = useStore((s) => s.layout)
  return useMemo(() => types.map((ty) => countParts(layout, ty)), [layout, types])
}

/**
 * The step's one-click actions (LS-1), left of its check button: 「載入
 * hal-blink 到 U1」 (✓ once that firmware runs; 「換回 hal-blink」 while one of
 * the step's mistake firmwares runs), 「▶ 執行模擬」 (hidden while running),
 * 「拿一顆電阻」 (hidden once the board holds as many as the solution),
 * 「重置 MCU」 / 「重置模擬」 (the inspector's and the More sheet's resets,
 * final round). Once the step is done its check row says what runs — the ✓
 * state is not repeated.
 */
function StepActionRow({
  lesson,
  index,
  done,
  trailing,
  noPrimary = false,
}: {
  lesson: Lesson
  index: number
  done: boolean
  trailing?: ReactNode
  /** another button of the step is THE next action (the last step's 「前往驗收」): every action here is tinted */
  noPrimary?: boolean
}) {
  const actions = useMemo(() => stepActions(lesson, index), [lesson, index])
  const running = useStore((s) => s.running)
  const armed = useStore((s) => (s.mode.kind === 'place' ? s.mode.type : null))
  const wiring = useStore((s) => s.mode.kind === 'wire')
  const layout = useStore((s) => s.layout)
  const loading = useLessonUi((s) => s.loadingFirmware)
  const armTypes = useMemo(() => actions.flatMap((a) => (a.kind === 'arm-part' ? [a.type] : [])), [actions])
  const counts = useCounts(armTypes)
  const fwBoards = useMemo(() => [...new Set(actions.flatMap((a) => (a.kind === 'load-firmware' ? [a.component] : [])))], [actions])
  const records = useLab((s) => s.firmware)
  const channels = useLab((s) => s.logicChannels)
  const bound = new Map(fwBoards.map((id) => [id, records[id] ? firmwareStem(records[id].name) : ''] as const))
  const step = { lesson, index }
  // 「把 R1 設為 330 Ω」 / 「選取 R1」: the one-click fix of a failing value check (LS-11 b)
  const stepCheck = lesson.steps[index]?.check
  const run = useLessonUi((s) => s.runs[runKey(lesson.id, lesson.steps[index]?.id)])
  const fixes = useMemo(
    () => (stepCheck && run?.status === 'done' && run.results?.[0] ? paramFixes(lesson, stepCheck, run.results[0], layout) : []),
    [lesson, stepCheck, run, layout],
  )

  let primaryUsed = noPrimary
  const variant = (): 'filled' | 'tinted' => {
    const v = primaryUsed ? 'tinted' : 'filled'
    primaryUsed = true
    return v
  }
  const renderAction = (a: LessonStepAction): ReactNode => {
    switch (a.kind) {
      case 'load-firmware': {
        const key = `fw|${a.component}|${a.project}`
        if (bound.get(a.component) === a.project) {
          if (done) return null
          return <BoundFirmware key={key} id={a.component} project={a.project} />
        }
        const busy = loading === `${a.component}|${a.project}`
        return (
          <PressableButton key={key} size="sm" variant={variant()} disabled={loading !== null} onClick={() => void loadStepFirmware(a.component, a.project, step)}>
            {busy ? t('Loading…') : t('Load {project} into {id}', { project: a.project, id: a.component })}
          </PressableButton>
        )
      }
      case 'run':
        if (running) return null
        return (
          <PressableButton key="run" size="sm" variant={variant()} icon={<PlayIcon size={14} />} onClick={runSim}>
            {t('Run simulation')}
          </PressableButton>
        )
      case 'arm-part': {
        const i = armTypes.indexOf(a.type)
        const need = countParts(lesson.solution.layout, a.type)
        if ((counts[i] ?? 0) >= need) return null
        const entry = getEntry(a.type)
        const name = entry ? partLabel(entry) : a.type
        if (armed === a.type) {
          return (
            <PressableButton
              key={`arm|${a.type}`}
              size="sm"
              variant="tinted"
              aria-pressed
              title={t('Press again to stop placing')}
              onClick={() => useStore.getState().setMode({ kind: 'select' })}
            >
              {t('Placing — click the holes on the board')}
            </PressableButton>
          )
        }
        return (
          <PressableButton key={`arm|${a.type}`} size="sm" variant={variant()} onClick={() => armPart(a.type)}>
            {t('Take a {part}', { part: name })}
          </PressableButton>
        )
      }
      case 'wire': {
        if (done) return null
        const next = pendingWire(a, layout)
        if (!next) return null
        const ends = { from: wireEndName(next[0], layout), to: wireEndName(next[1], layout) }
        if (wiring) {
          return (
            <PressableButton
              key="wire"
              size="sm"
              variant="tinted"
              aria-pressed
              title={t('Press again to stop wiring')}
              /* the label stays true after the first click: the marks on the board show which end is next */
              onClick={() => useStore.getState().setMode({ kind: 'select' })}
            >
              {t('Wiring ({from} → {to}) — press to stop', ends)}
            </PressableButton>
          )
        }
        return (
          <PressableButton key="wire" size="sm" variant={variant()} onClick={() => startWiring(a, step)}>
            {t('Start wiring ({from} → {to})', ends)}
          </PressableButton>
        )
      }
      case 'reset': {
        // the same words as the inspector's Reset MCU and the More sheet's Reset simulation
        if (a.scope === 'circuit') {
          return (
            <PressableButton
              key="reset|circuit"
              size="sm"
              variant={variant()}
              icon={<ResetIcon size={14} />}
              title={t('Power the whole circuit up again from 0 s (like More → Reset simulation)')}
              onClick={() => resetFromStep(a, lesson)}
            >
              {t('Reset simulation')}
            </PressableButton>
          )
        }
        const id = resetTarget(lesson, a) ?? ''
        const k = withKey(t('Restart {id}’s firmware from reset — the rest of the circuit keeps its state', { id }), 'reset-mcu')
        return (
          <PressableButton
            key={`reset|mcu|${id}`}
            size="sm"
            variant={variant()}
            icon={<ResetIcon size={14} />}
            title={k.title}
            aria-keyshortcuts={k.ariaKeyshortcuts}
            onClick={() => resetFromStep(a, lesson)}
          >
            {t('Reset MCU')}
          </PressableButton>
        )
      }
      case 'add-logic': {
        const names = a.pins.map((p) => logicPinName(a.component, p)).join('、')
        if (logicPinsPresent(a.component, a.pins, channels, layout)) {
          // a step that talks about one burst keeps its button: it jumps there again (LS-F4)
          if (a.view?.burstOn) {
            return (
              <PressableButton key={`logic|${a.component}`} size="sm" variant={variant()} onClick={() => addLogicChannels(a.component, a.pins, a.view)}>
                {tidyCjkSpaces(t('Show the latest {what} on the logic analyzer', { what: a.view.label ?? t('signal burst') }))}
              </PressableButton>
            )
          }
          return (
            <span key={`logic|${a.component}`} className="lsn-fw-state">
              <CheckIcon size={12} />
              {t('{pins} are on the logic analyzer', { pins: names })}
            </span>
          )
        }
        return (
          <PressableButton key={`logic|${a.component}`} size="sm" variant={variant()} onClick={() => addLogicChannels(a.component, a.pins, a.view)}>
            {t('Add {pins} to the logic analyzer', { pins: names })}
          </PressableButton>
        )
      }
      case 'unwire': {
        // only while the wire is in (its 開始接線 hides meanwhile): the end of a jumper experiment (LS-F7)
        const on = wiresOnBoard(a, layout)
        if (on.length === 0) return null
        const w = a.wires.find(([f, to]) => on.some((x) => (x.from === f && x.to === to) || (x.from === to && x.to === f))) ?? [on[0].from, on[0].to]
        return (
          <PressableButton key={actionKey(a)} size="sm" variant={variant()} onClick={() => unwireFromStep(a)}>
            {t('Remove the wire {from} → {to}', { from: wireEndText(w[0], layout), to: wireEndText(w[1], layout) })}
          </PressableButton>
        )
      }
    }
  }

  const buttons: ReactNode[] = []
  const reverts: ReactNode[] = []
  for (const f of fixes) {
    const value = fmtSi(f.value, f.unit)
    buttons.push(
      <PressableButton key={`fix|${f.component}`} size="sm" variant={variant()} onClick={() => applyParamFix(f)}>
        {t('Set {id} to {value}', { id: f.component, value })}
      </PressableButton>,
      <PressableButton key={`select|${f.component}`} size="sm" variant="tinted" onClick={() => focusInspector(f.component)}>
        {t('Select {id}', { id: f.component })}
      </PressableButton>,
    )
  }
  for (const a of actions) buttons.push(renderAction(a))
  for (const id of fwBoards) {
    const main = mainFirmware(lesson, id)
    const now = bound.get(id)
    const mistake = actions.some((a) => a.kind === 'load-firmware' && a.component === id && a.project !== main && a.project === now)
    if (main && now && now !== main && mistake) {
      reverts.push(
        <PressableButton key={`revert|${id}`} size="sm" variant="tinted" disabled={loading !== null} onClick={() => void loadStepFirmware(id, main, step)}>
          {t('Switch back to {project}', { project: main })}
        </PressableButton>,
      )
    }
  }
  const visible = [...buttons, ...reverts].filter(Boolean)
  if (visible.length === 0 && !trailing) return null
  return (
    <div className="lsn-actrow">
      {visible}
      {trailing}
    </div>
  )
}

/**
 * The folded phone coach while the step's 「開始接線」 runs (final round): the
 * card folds away from the board — the wire-mode chrome takes the bottom of
 * the screen — and keeps the action row's own wiring button, 「接線中（j40 →
 * bot+31）· 再按一次結束」, so it still says which wire the marks are for.
 */
export function CoachWiringLine({ lesson, index }: { lesson: Lesson; index: number }) {
  const layout = useStore((s) => s.layout)
  const wiring = useStore((s) => s.mode.kind === 'wire')
  const next = useMemo(() => stepPendingWire(lesson, index, layout), [lesson, index, layout])
  if (!wiring || !next) return null
  const ends = { from: wireEndName(next[0], layout), to: wireEndName(next[1], layout) }
  return (
    <div className="lsn-coach-wiring">
      <PressableButton
        size="sm"
        variant="tinted"
        aria-pressed
        title={t('Press again to stop wiring')}
        onClick={() => useStore.getState().setMode({ kind: 'select' })}
      >
        {t('Wiring ({from} → {to}) — press to stop', ends)}
      </PressableButton>
    </div>
  )
}

/** An end of a wire the step asks for: a hole as written (「a16」), a terminal by its name (「DMM1 IN 端」). */
function wireEndName(ref: string, layout: CircuitLayout): string {
  return wireEndText(ref, layout)
}

/** Every pin of `component` already has a logic channel (its own, or one on the same hole). */
function logicPinsPresent(component: string, pins: readonly string[], channels: readonly LogicChannelConfig[], layout: CircuitLayout): boolean {
  return pins.every((pin) => {
    const r = resolvePinRef(layout, { component, pin })
    if (!r.ok) return false
    return channels.some((c) =>
      r.mcuPin
        ? c.source.kind === 'mcu-pin' && c.source.componentId === r.mcuPin.componentId && c.source.pin === r.mcuPin.pin
        : c.source.kind === 'net' && c.source.ref === r.endpoint,
    )
  })
}

/** 「為什麼？」: the rest of a step's text in the coach (collapsed by default, remembered for the session). */
function WhyDisclosure({ text }: { text: string }) {
  const open = useLessonUi((s) => s.whyOpen)
  const setOpen = useLessonUi((s) => s.setWhyOpen)
  return (
    <div className={`lsn-why ${open ? 'is-open' : ''}`}>
      <button type="button" className="lsn-disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
        <span>{t('Why?')}</span>
      </button>
      {open && <LessonText text={text} className="lsn-why-text" />}
    </div>
  )
}

/** 「✓ 3 / 3 項條件成立 ›」: a passed step's sub-checks folded to one line in the coach (LS-F3). */
function PassedChecksLine({ n, open, onToggle }: { n: number; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="lsn-checks-folded" aria-expanded={open} onClick={onToggle}>
      <span className="lsn-checks-folded-mark" aria-hidden="true">
        <CheckIcon size={12} />
      </span>
      <span>{t('{passed} / {n} conditions hold', { passed: n, n })}</span>
      {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
    </button>
  )
}

/** The current step's body, its actions and check, and the step navigation (lesson view + coach card). */
export function StepBody({ lesson, index, compact = false }: { lesson: Lesson; index: number; compact?: boolean }) {
  const step = lesson.steps[index]
  const key = runKey(lesson.id, step?.id)
  const run = useLessonUi((s) => s.runs[key])
  const attempted = useLessonUi((s) => !!s.attempted[key])
  const coachId = useLessonUi((s) => s.coachId)
  const done = useLessonProgress((s) => (step ? (s.lessons[lesson.id]?.stepsDone.includes(step.id) ?? false) : false))
  const hasActions = useMemo(() => stepActions(lesson, index).length > 0, [lesson, index])
  // 「模擬執行中，約 n 秒後自動檢查…」 while the running simulation is about to check this step (LS-F6)
  const autoIn = useAutoCheck((s) => (s.key === key ? s.inSeconds : null))
  // the coach folds a passed step's sub-check list to one line (LS-F3); a click opens it for this step
  const [openChecks, setOpenChecks] = useState<string | null>(null)
  // a step that turns done brings 下一步 into view (the coach slot / the phone card scroll)
  const navRef = useRef<HTMLDivElement>(null)
  const seen = useRef({ key, done })
  useEffect(() => {
    const was = seen.current
    seen.current = { key, done }
    if (!compact || !done || was.done || was.key !== key || typeof requestAnimationFrame !== 'function') return
    const raf = requestAnimationFrame(() => {
      const el = navRef.current?.querySelector<HTMLElement>('.lsn-next') ?? navRef.current
      el?.scrollIntoView?.({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(raf)
  }, [compact, done, key])
  if (!step) return null
  const runnable = lesson.runnable !== 'not-yet'
  // a step with nothing to do or check (「看完按「下一步」」) makes 下一步 its primary button
  const nextPrimary = done || (!hasActions && (!step.check || !runnable))
  const running = run?.status === 'running'
  const last = index === lesson.steps.length - 1
  // the last step's next action is the acceptance (LS-12): 「前往驗收 · 檢查我的電路」
  const finish = last && runnable && lesson.acceptance.length > 0
  const guiding = coachId === lesson.id
  const highlight = !!step.highlight && ((step.highlight.holes?.length ?? 0) > 0 || (step.highlight.components?.length ?? 0) > 0)
  const [first, rest] = compact ? splitFirstParagraph(step.body) : [step.body, '']
  const checkButton =
    step.check && runnable ? (
      <PressableButton key="check" size="sm" variant="tinted" disabled={running} onClick={() => void runStepCheck(lesson, index)}>
        {running ? t('Checking…') : t('Check this step')}
      </PressableButton>
    ) : null
  const passedResult = run?.status === 'done' && run.results?.length === 1 && run.results[0].pass ? run.results[0] : null
  const subChecks = compact && done && passedResult ? (passedResult.children?.length ?? 0) : 0
  const foldChecks = subChecks > 0 && openChecks !== key
  return (
    <div className="lsn-step-body">
      <LessonText text={first} />
      {rest && <WhyDisclosure text={rest} />}
      <StepActionRow lesson={lesson} index={index} done={done} trailing={checkButton} noPrimary={finish} />
      {step.check && runnable && (
        <div className="lsn-step-check">
          {subChecks > 0 && <PassedChecksLine n={subChecks} open={!foldChecks} onToggle={() => setOpenChecks(foldChecks ? key : null)} />}
          {!foldChecks && (
            <CheckResults checks={[step.check]} run={run} runId={key} attempted={attempted} onCancel={() => cancelRun(key)} names={lesson} />
          )}
          {autoIn !== null && !done && !running && (
            <p className="lsn-autocheck" role="status">
              {t('Simulation running — checks itself in about {n} s…', { n: autoIn })}
            </p>
          )}
        </div>
      )}
      <div ref={navRef} className="lsn-step-nav">
        <PressableButton size="sm" variant="plain" disabled={index === 0} onClick={() => goToStep(lesson, index - 1)}>
          <ChevronLeftIcon size={14} />
          {t('Previous')}
        </PressableButton>
        {!compact && highlight && !guiding && (
          <PressableButton size="sm" variant="tinted" onClick={() => startGuide(lesson, index)}>
            {t('Show on the board')}
          </PressableButton>
        )}
        {last ? (
          finish && <FinishButton lesson={lesson} />
        ) : (
          <PressableButton size="sm" variant={nextPrimary ? 'filled' : 'plain'} className="lsn-next" onClick={() => goToStep(lesson, index + 1)}>
            {t('Next')}
            <ChevronRightIcon size={14} />
          </PressableButton>
        )}
      </div>
    </div>
  )
}

/** The last step's way out (LS-12): 「前往驗收 · 檢查我的電路」 — the 驗收 section, the check, its results in view. */
function FinishButton({ lesson }: { lesson: Lesson }) {
  const running = useLessonUi((s) => s.runs[runKey(lesson.id)]?.status === 'running')
  return (
    <PressableButton size="sm" variant="filled" className="lsn-next lsn-finish" disabled={running} onClick={() => goToAcceptance(lesson)}>
      {running ? t('Checking…') : t('Go to acceptance · Check my circuit')}
      <ChevronRightIcon size={14} />
    </PressableButton>
  )
}

// ----------------------------------------------------------- acceptance

/**
 * 「姓名／座號」 asked once before the first receipt (LS-15): remembered on
 * this device, written into the receipt and its file name.
 */
function StudentNameForm({ onDone, onCancel }: { onDone: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(readStudentName)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  const ok = name.trim().length > 0
  return (
    <form
      className="lsn-student-form lg-card"
      onSubmit={(e) => {
        e.preventDefault()
        if (ok) onDone(name.trim())
      }}
    >
      <label className="lsn-student-label" htmlFor="lsn-student-name">
        {t('Name / seat number for the receipt')}
      </label>
      <input
        ref={inputRef}
        id="lsn-student-name"
        className="lsn-student-input"
        value={name}
        maxLength={40}
        autoComplete="name"
        placeholder={t('e.g. Wang Xiaoming 12')}
        onChange={(e) => setName(e.target.value)}
      />
      <span className="lsn-actrow">
        <PressableButton size="sm" variant="filled" type="submit" disabled={!ok}>
          {t('Export results')}
        </PressableButton>
        <PressableButton size="sm" variant="plain" onClick={onCancel}>
          {t('Cancel')}
        </PressableButton>
      </span>
    </form>
  )
}

/** The pass state: a springing check mark, the next lesson in one click (LS-4). */
function PassBlock({ lesson, total }: { lesson: Lesson; total: number }) {
  const viaSolution = useLessonProgress((s) => !!s.lessons[lesson.id]?.viaSolution)
  const next = nextLesson(lesson)
  const jump = nextLevelStart(lesson)
  return (
    <div className="lsn-pass" role="status" data-reveal>
      <div className="lsn-pass-line">
        <span className="lsn-pass-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9.4 7.4 12.8 14 5.6" />
          </svg>
        </span>
        <span className="lsn-pass-text">{t('All {n} conditions pass — lesson complete!', { n: total })}</span>
      </div>
      {viaSolution && <p className="lsn-pass-note">{t('This pass used the loaded solution. Load the starting circuit and build it yourself to earn the lesson.')}</p>}
      {(next || jump) && (
        <div className="lsn-pass-actions">
          {next && (
            <PressableButton size="sm" variant="filled" onClick={() => goToLesson(next)}>
              {t('Next lesson: {title} →', { title: next.title })}
            </PressableButton>
          )}
          {jump && (
            <PressableButton size="sm" variant="tinted" onClick={() => goToLesson(jump)}>
              {t('Jump to {level}: {title}', { level: levelName(jump.level), title: jump.title })}
            </PressableButton>
          )}
        </div>
      )}
    </div>
  )
}

function Acceptance({ lesson, onCheck }: { lesson: Lesson; onCheck: () => void }) {
  const key = runKey(lesson.id)
  const run = useLessonUi((s) => s.runs[key])
  const rootRef = useRef<HTMLDivElement>(null)
  const [askName, setAskName] = useState(false)
  // a check that finishes while this section shows: its outcome — 「最可能的原因」, or 「下一課」 —
  // scrolls to the top of the panel, never below the fold (LS-12)
  const status = run?.status
  const prevStatus = useRef(status)
  useEffect(() => {
    const was = prevStatus.current
    prevStatus.current = status
    if (was !== 'running' || status !== 'done') return
    const raf = requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector<HTMLElement>('[data-reveal]') ?? rootRef.current
      el?.scrollIntoView?.({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
  }, [status])
  // 「查看原因」 on the failing acceptance toast (LS-12): the same outcome, on request — also when this
  // section mounts only now (the lessons sheet opening, the panel switching to 驗收)
  const reveal = useLessonUi((s) => (s.revealCause?.lessonId === lesson.id ? s.revealCause.at : null))
  useEffect(() => {
    if (reveal === null) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const root = rootRef.current
        const el = root?.querySelector<HTMLElement>('[data-reveal]') ?? root?.querySelector<HTMLElement>('.lsn-cause') ?? root
        el?.scrollIntoView?.({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
        useLessonUi.getState().requestRevealCause(null)
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [reveal])
  const completedAt = useLessonProgress((s) => s.lessons[lesson.id]?.completedAt)
  const runnable = lesson.runnable !== 'not-yet'
  const sum = runSummary(run)
  const running = run?.status === 'running'
  // without the start circuit the "n / m pass" line would only mislead: CheckResults says what to do
  const layout = useStore((s) => s.layout)
  const noStart = useMemo(() => missingStartParts(lesson, layout).mostlyMissing, [lesson, layout])
  return (
    <div ref={rootRef} className="lsn-acceptance">
      <p className="lg-caption">
        {runnable
          ? t('All conditions must pass on YOUR circuit (the board as it is now, with its firmware) for the lesson to count as completed. Each check runs the real simulation.')
          : t('This lesson cannot run in the simulator yet, so it cannot be checked automatically. The conditions are listed for reference.')}
      </p>
      {sum &&
        !(noStart && sum.passed < sum.total) &&
        (sum.passed === sum.total ? (
          <PassBlock lesson={lesson} total={sum.total} />
        ) : (
          <div className="lsn-callout is-fail" role="status" data-reveal>
            {t('{passed} of {n} conditions pass. Fix the failed ones and check again.', { passed: sum.passed, n: sum.total })}
          </div>
        ))}
      {!sum && completedAt !== undefined && !running && (
        <div className="lsn-callout is-pass">{t('You completed this lesson on {date}.', { date: new Date(completedAt).toLocaleDateString(lang() === 'zh-TW' ? 'zh-TW' : 'en-US') })}</div>
      )}
      <CheckResults checks={lesson.acceptance} run={run} runId={key} onCancel={() => cancelRun(key)} lesson={lesson} />
      {runnable && (
        <div className="lsn-step-nav">
          <PressableButton
            size="sm"
            variant="tinted"
            disabled={running || lesson.acceptance.length === 0}
            onClick={onCheck}
          >
            {running ? t('Checking…') : sum ? t('Check again') : t('Check my circuit')}
          </PressableButton>
          {sum && run?.results && (
            <PressableButton
              size="sm"
              variant="plain"
              icon={<ExportIcon size={14} />}
              title={t('Download the results (JSON) and open a printable receipt')}
              onClick={() => {
                const name = readStudentName()
                if (name) downloadReceipt(lesson, run.results!, run.at, name)
                else setAskName(true)
              }}
            >
              {t('Export results')}
            </PressableButton>
          )}
        </div>
      )}
      {askName && sum && run?.results && (
        <StudentNameForm
          onCancel={() => setAskName(false)}
          onDone={(name) => {
            setAskName(false)
            saveStudentName(name)
            downloadReceipt(lesson, run.results!, run.at, name)
          }}
        />
      )}
      {!askName && sum && run?.results && readStudentName() && (
        <p className="lsn-student lg-caption">
          {t('Receipts are named {name}', { name: readStudentName() })}{' '}
          <button type="button" className="lsn-link is-inline" onClick={() => setAskName(true)}>
            {t('Change')}
          </button>
        </p>
      )}
    </div>
  )
}
