/**
 * Everything the lessons add over the scene, mounted once by App.tsx:
 *
 *  - the coach card — the guided lesson's current step: header 「步驟 n/m ·
 *    title」 + fold + ×, the step's first paragraph (the rest behind
 *    「為什麼？」), its one-click actions, its check and the step navigation.
 *    In the desktop workspace with the Library panel open it DOCKS into the
 *    panel's #ws-coach-slot (UX contract K8) as an in-panel card, so it never
 *    covers the circuit; otherwise (panel collapsed, phone, classic chrome)
 *    it floats as a compact Tier-S card (no backdrop-filter; the UndoPill
 *    over-scene recipe) below the status capsule, folds to its one-line
 *    header while the simulation runs (unfolds on pause or a step change) and
 *    publishes its rect (useLessonUi.coachRect) for the scene's top inset.
 *    UX fix round: a docked card folds while the lesson's acceptance
 *    results show and says 「課程完成——下一課」 on a pass (LS-12); on phones
 *    a sheet over the scene folds the card to its header above the sheet,
 *    and the card carries the status pill's problem line (LS-14, N8).
 *    Final round: on a phone the card also folds while the step's
 *    「開始接線」 runs — the wire-mode chrome (colour strip, hint, raised undo
 *    pill) takes the screen's bottom, so the step framing gets the card's
 *    height back at the top (the scene re-frames into the new free area) —
 *    and keeps its wiring button (「接線中（…）· 再按一次結束」); it unfolds
 *    when the step's wires are drawn or the tool is left;
 *  - the 3D highlights through the scene's optional setHighlights hook: the
 *    failed check / hole chip the learner asked to see, else the current
 *    step's holes / parts; nothing (null) otherwise — so the scene is
 *    untouched while no lesson is guided. The camera follows each step
 *    through the scene bridge (actions.focusStep, K4);
 *  - the lessons sheet (phones / classic chrome; the desktop workspace shows
 *    the same browser in its Library panel instead);
 *  - the "replace the current circuit?" confirmation;
 *  - after a reload, the guide resumes where it was (restoreGuide);
 *  - watchers: step re-checks after edits (and, while the simulation runs,
 *    measuring steps that check themselves — release QA LS-F6), the guide ending when another
 *    circuit replaces the lesson's (LS-9), observe steps re-framing their
 *    LEDs when the free area changes (LS-12), selecting the board a step
 *    points into opening that pin (LS-14).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { lessonById } from '../../lessons'
import { useLessonProgress } from '../../lessons/progress'
import type { HighlightSpec, IBreadboardScene } from '../../three/scene-api'
import { t, useLang } from '../../i18n'
import { useStore } from '../../state/store'
import { useLab } from '../embedded/lab'
import { ActionSheet, BookIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, Sheet, pressProps, sheetCoverHeight, subscribeSheetCover, tick } from '../kit'
import { focusInspector, locateProblem, useProblems, type Problem } from '../embedded/problems'
import { statusPillModel, type PillInput } from '../chrome/StatusPill'
import { useSimPhase } from '../chrome/run-control'
import { stepPendingWire, stepPinTarget } from '../../lessons/step-actions'
import { useWorkspaceActive } from '../workspace/state'
import { useLegacyChrome } from '../chrome/legacy'
import { runKey, useLessonUi } from './state'
import {
  WIRE_FOCUS,
  clampStep,
  goToLesson,
  loadLessonCircuit,
  nextLesson,
  openLessons,
  provideArmFocus,
  restoreGuide,
  stopGuide,
  watchCircuitChanges,
  watchObserveFraming,
  watchRunningStepChecks,
  watchStepChecks,
} from './actions'
import type { Lesson } from '../../lessons/types'
import { CoachWiringLine, LessonBrowser, StepBody } from './LessonBrowser'
import { lessonCode } from './labels'
import './lessons.css'

const SHEET_SNAPS = [0.55, 0.92] as const

type SceneLike = Pick<IBreadboardScene, 'setHighlights'>

export function LessonOverlay({
  sceneRef,
  desktop,
  onOpenMore,
}: {
  sceneRef: RefObject<SceneLike | null>
  desktop: boolean
  /** phones: open the More sheet on its problems (the coach's problem line, LS-14) */
  onOpenMore?: () => void
}) {
  useLang()
  const workspaceOn = useWorkspaceActive()
  // the guided step re-checks itself after each edit (structural checks only)
  useEffect(() => watchStepChecks(), [])
  // …and, while the simulation runs, a measuring step checks itself (LS-F6)
  useEffect(() => watchRunningStepChecks(), [])
  // another circuit replacing the lesson's ends the guide (LS-9)
  useEffect(() => watchCircuitChanges(), [])
  // an observe step re-frames its LEDs when the tray / a panel changes the free area (LS-12)
  useEffect(() => watchObserveFraming(), [])
  // selecting the board a step points into opens its pin (LS-14)
  useEffect(() => watchStepPinSelection(), [])
  // a reload resumes the guide where it was (LS-4)
  useEffect(() => restoreGuide(), [])
  // the wire tool armed on a phone frames the guided wiring step, as 「開始接線」 does (SC-9)
  useEffect(() => provideArmFocus(), [])
  return (
    <>
      <SceneHighlights sceneRef={sceneRef} />
      <CoachCard workspaceOn={workspaceOn} desktop={desktop} onOpenMore={onOpenMore} />
      <LessonsSheet desktop={desktop} workspaceOn={workspaceOn} />
      <ConfirmLoad desktop={desktop} />
    </>
  )
}

// ------------------------------------------------------------ highlights

function SceneHighlights({ sceneRef }: { sceneRef: RefObject<SceneLike | null> }) {
  const coachId = useLessonUi((s) => s.coachId)
  const focus = useLessonUi((s) => s.focus)
  const stepIndex = useLessonProgress((s) => (coachId ? s.lessons[coachId]?.step ?? 0 : 0))
  const spec = useMemo<HighlightSpec | null>(() => {
    if (focus && (focus.components.length > 0 || focus.holes.length > 0)) {
      return { holes: focus.holes, components: focus.components }
    }
    const lesson = coachId ? lessonById(coachId) : undefined
    if (!lesson) return null
    const h = lesson.steps[clampStep(lesson, stepIndex)]?.highlight
    if (!h || ((h.holes?.length ?? 0) === 0 && (h.components?.length ?? 0) === 0)) return null
    return { holes: h.holes ?? [], components: h.components ?? [] }
  }, [coachId, focus, stepIndex])
  // the scene ignores an unchanged spec (signature) — push on every change
  useEffect(() => {
    sceneRef.current?.setHighlights?.(spec)
  }, [spec, sceneRef])
  useEffect(() => () => sceneRef.current?.setHighlights?.(null), [sceneRef])
  return null
}

// ------------------------------------------------------------ coach card

/**
 * The workspace Library panel's coach slot (#ws-coach-slot, K8) while it is
 * rendered — null when the panel is collapsed / the workspace is off. Looked
 * up after the panel commits (a couple of frames at most).
 */
function useCoachSlot(enabled: boolean): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!enabled || typeof document === 'undefined') {
      setSlot(null)
      return
    }
    let raf = 0
    let tries = 0
    const find = () => {
      const el = document.getElementById('ws-coach-slot')
      if (el) setSlot(el)
      else if (tries++ < 12 && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(find)
      else setSlot(null)
    }
    find()
    return () => cancelAnimationFrame(raf)
  }, [enabled])
  return slot && slot.isConnected ? slot : null
}

/**
 * The step points at a pin (i1 step 1: 「找到 PA5」): when the learner selects
 * that board, its inspector / Properties sheet opens on 腳位 scrolled to the
 * pin (focusInspector) — PA5 is not among the used pins before it is wired.
 */
function watchStepPinSelection(): () => void {
  return useStore.subscribe((s, prev) => {
    if (s.selection === prev.selection || s.selection.length !== 1) return
    const id = s.selection[0]
    if (prev.selection.includes(id)) return
    const coachId = useLessonUi.getState().coachId
    const lesson = coachId ? lessonById(coachId) : undefined
    if (!lesson) return
    const target = stepPinTarget(lesson, clampStep(lesson, useLessonProgress.getState().lessons[lesson.id]?.step ?? 0), s.layout)
    if (!target || target.component !== id) return
    // once the inspector / Properties sheet presenting the selection has mounted (it ignores a request older than itself)
    const go = () => focusInspector(target.component, { tab: 'pins', pin: target.pin })
    setTimeout(() => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => requestAnimationFrame(go)) : go()), 0)
  })
}

/** px of the screen bottom a resting phone sheet covers (event-driven). */
function useSheetCover(): number {
  return useSyncExternalStore(
    (fn) => subscribeSheetCover(() => fn()),
    sheetCoverHeight,
    () => 0,
  )
}

/** The floating coach's top (CSS: safe top + 58 px) and its folded header height. */
const FLOAT_TOP_PX = 58
const FOLDED_PX = 48

function CoachCard({ workspaceOn, desktop, onOpenMore }: { workspaceOn: boolean; desktop: boolean; onOpenMore?: () => void }) {
  const coachId = useLessonUi((s) => s.coachId)
  const folded = useLessonUi((s) => s.coachFolded)
  const setFolded = useLessonUi((s) => s.setCoachFolded)
  const focus = useLessonUi((s) => s.focus)
  const setFocus = useLessonUi((s) => s.setFocus)
  const progress = useLessonProgress((s) => (coachId ? s.lessons[coachId] : undefined))
  const leftOpen = useLab((s) => s.workspace.left.open)
  const running = useStore((s) => s.running)
  const slot = useCoachSlot(workspaceOn && leftOpen)
  const lesson = coachId ? lessonById(coachId) : undefined
  const show = !!lesson && lesson.steps.length > 0
  const docked = show && !!slot
  const index = lesson ? clampStep(lesson, progress?.step ?? 0) : 0
  const cardRef = useRef<HTMLElement>(null)

  // a floating card folds to its header while the simulation runs, so the result stays visible
  const [runFold, setRunFold] = useState(false)
  useEffect(() => {
    setRunFold(running && !docked)
  }, [running, docked])
  // a docked card folds to its header while the lesson's acceptance results show below it (LS-12):
  // 「最可能的原因」 and 「下一課」 get the panel's height
  const resultsShown = useLessonUi((s) => !!coachId && s.viewId === coachId && s.section === 'acceptance' && !!s.runs[runKey(coachId)])
  const [resultsFold, setResultsFold] = useState(false)
  useEffect(() => {
    setResultsFold(resultsShown && docked)
  }, [resultsShown, docked])
  // phones: the card folds while the step's 「開始接線」 runs (its wire marks are on the board) so the
  // step framing keeps the holes above the wire-mode chrome; it unfolds once the step's wires are drawn
  // or the tool is left. Never on a desktop / docked card or in the classic chrome.
  const legacy = useLegacyChrome()
  const wiring = useStore((s) => s.mode.kind === 'wire')
  const wireMarked = !!focus?.key.startsWith(WIRE_FOCUS)
  const layout = useStore((s) => s.layout)
  const stepWire = useMemo(() => (lesson ? stepPendingWire(lesson, index, layout) !== null : false), [lesson, index, layout])
  const phoneFloat = !desktop && !docked && !legacy
  const [wireFold, setWireFold] = useState(false)
  useEffect(() => {
    if (phoneFloat && wiring && wireMarked && stepWire) setWireFold(true)
  }, [phoneFloat, wiring, wireMarked, stepWire])
  useEffect(() => {
    if (!wiring || !stepWire || !phoneFloat) setWireFold(false)
  }, [wiring, stepWire, phoneFloat])
  useEffect(() => {
    setRunFold(false)
    setResultsFold(false)
    setWireFold(false)
  }, [index, coachId])
  // phones: a Properties / lessons sheet resting over the scene folds the card to its header above the
  // sheet (LS-14) — it hides only when a tall sheet leaves no room for it
  const sheetCover = useSheetCover()
  const underSheet = !docked && sheetCover > 0
  const noRoom = underSheet && typeof window !== 'undefined' && FLOAT_TOP_PX + FOLDED_PX + 8 > window.innerHeight - sheetCover
  const shownFolded = folded || runFold || resultsFold || underSheet || wireFold
  // the lesson passed its acceptance: the coach says so and offers the next lesson
  const passed = useLessonUi((s) => {
    const r = coachId ? s.runs[runKey(coachId)] : undefined
    return !!r && r.status === 'done' && !!r.results && r.results.length > 0 && r.results.every((x) => x.pass)
  })

  useEffect(() => {
    useLessonUi.getState().setCoachDocked(docked)
  }, [docked])
  useEffect(() => () => useLessonUi.getState().setCoachDocked(false), [])

  // publish the floating card's rect (K8) — layout box, unaffected by the entry animation
  useLayoutEffect(() => {
    const ui = useLessonUi.getState()
    const el = cardRef.current
    if (!show || docked || !el) {
      ui.setCoachRect(null)
      return
    }
    const publish = () => ui.setCoachRect({ top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight, height: el.offsetHeight })
    publish()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null
    ro?.observe(el)
    window.addEventListener('resize', publish)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', publish)
      useLessonUi.getState().setCoachRect(null)
    }
  }, [show, docked])

  if (!lesson || !show) return null
  const step = lesson.steps[index]
  const done = progress?.stepsDone.includes(step.id) ?? false
  const stepLine = t('Step {n}/{m} · {title}', { n: index + 1, m: lesson.steps.length, title: step.title })
  const card = (
    <aside
      ref={cardRef}
      className={`lsn-coach lg-card ${docked ? 'is-docked' : 'is-floating'} ${shownFolded ? 'is-folded' : ''} ${workspaceOn ? 'is-ws' : ''}${noRoom ? ' is-under-sheet' : ''}`}
      aria-label={t('Lesson guide: {title}', { title: lesson.title })}
    >
      <div className="lsn-coach-head">
        <span className="lsn-coach-icon" aria-hidden="true">
          <BookIcon size={16} />
        </span>
        <button
          type="button"
          className="lsn-coach-title lg-pressable"
          title={t('Open the lesson')}
          {...pressProps}
          onClick={() => openLessons(lesson.id, 'steps')}
        >
          <span className="lsn-coach-step">
            <span className="lsn-coach-steptext">{stepLine}</span>
            {done && <span className="lsn-coach-done">{t('done')}</span>}
          </span>
          {!shownFolded && (
            <span className="lsn-coach-lesson">
              {lessonCode(lesson)} · {lesson.title}
            </span>
          )}
        </button>
        <button
          type="button"
          className="lsn-icon-btn lg-pressable"
          aria-label={shownFolded ? t('Expand the guide') : t('Collapse the guide')}
          aria-expanded={!shownFolded}
          {...pressProps}
          onClick={() => {
            if (shownFolded) {
              setRunFold(false)
              setResultsFold(false)
              setWireFold(false)
              setFolded(false)
            } else setFolded(true)
          }}
        >
          {shownFolded ? <ChevronDownIcon size={16} /> : <ChevronUpIcon size={16} />}
        </button>
        <button type="button" className="lsn-icon-btn lg-pressable" aria-label={t('Close the guide')} {...pressProps} onClick={stopGuide}>
          <CloseIcon size={14} />
        </button>
      </div>
      {!desktop && !docked && <CoachProblemLine onOpenMore={onOpenMore} />}
      {wireFold && <CoachWiringLine lesson={lesson} index={index} />}
      {passed && <CoachPassLine lesson={lesson} />}
      {!shownFolded && (
        <div className="lsn-coach-body">
          {focus && !focus.key.startsWith(WIRE_FOCUS) && (
            <div className="lsn-callout is-focus">
              {t('Showing it on the board.')}{' '}
              <button type="button" className="lsn-link is-inline" onClick={() => setFocus(null)}>
                {t('Back to the step')}
              </button>
            </div>
          )}
          <StepBody lesson={lesson} index={index} compact />
        </div>
      )}
    </aside>
  )
  return docked && slot ? createPortal(card, slot) : card
}

/** What the phone coach's problem line says (pure — tests). */
export type CoachLine =
  | { kind: 'problem'; tone: 'error' | 'warning'; dot: string; text: string; more: number; run: (() => void) | null }
  | { kind: 'pending'; text: string; first: Problem }

/**
 * Phones (N8, LS-14): the status pill steps aside for the coach, so the
 * coach carries its line — the pill's own model (statusPillModel): a red /
 * amber dot and the title (「電路中沒有電源」 · 另 n 個, the folded counts the
 * panel shows). With nothing wrong, the findings only the run can confirm
 * (H5 pendingRuntime) read 「n 項執行後確認」 — the pill's own suffix, which a
 * guided pill leaves out with its ready line (the coach says what's next).
 * Neutral lines stay the coach's own voice.
 */
export function coachLine(input: Pick<PillInput, 'problems' | 'counts' | 'phase' | 'boardEmpty'>): CoachLine | null {
  const model = statusPillModel({ ...input, haltedId: null, guided: true, touch: true })
  if (model && model.tone !== 'neutral') {
    const action = model.action
    return {
      kind: 'problem',
      tone: model.tone === 'error' ? 'error' : 'warning',
      dot: model.dot,
      text: model.text,
      more: model.more,
      run: action ? () => action.run() : null,
    }
  }
  if (input.phase !== 'idle' || input.boardEmpty) return null
  const pending = input.problems.filter((p) => p.pendingRuntime)
  return pending.length > 0 ? { kind: 'pending', text: t('{n} to confirm after the run', { n: pending.length }), first: pending[0] } : null
}

/**
 * The line itself: a tap opens 更多 → 問題 (the pill's body); without a More
 * opener from the host, the problem's own action / its place on the board.
 * Re-renders with the problems store (≤ 1 Hz).
 */
function CoachProblemLine({ onOpenMore }: { onOpenMore?: () => void }) {
  const problems = useProblems((s) => s.problems)
  const counts = useProblems((s) => s.counts)
  const phase = useSimPhase()
  const boardEmpty = useStore((s) => s.layout.components.length === 0)
  const line = coachLine({ problems, counts, phase, boardEmpty })
  if (!line) return null
  const open = () => {
    tick()
    if (onOpenMore) onOpenMore()
    else if (line.kind === 'problem') line.run?.()
    else void locateProblem(line.first)
  }
  if (line.kind === 'pending') {
    return (
      <button type="button" className="lsn-coach-problem is-info" onClick={open}>
        <span className="lsn-coach-problem-dot" aria-hidden="true" />
        <span className="lsn-coach-problem-text">{line.text}</span>
      </button>
    )
  }
  return (
    <button type="button" className={`lsn-coach-problem is-${line.tone}`} style={{ ['--lsn-dot' as string]: line.dot }} onClick={open}>
      <span className="lsn-coach-problem-dot" aria-hidden="true" />
      <span className="lsn-coach-problem-text">{line.text}</span>
      {line.more > 0 && <span className="lsn-coach-problem-more">{t('· {n} more', { n: line.more })}</span>}
    </button>
  )
}

/** 「課程完成——下一課：電阻分壓 →」 in the coach once the acceptance passes (LS-12), folded or not. */
function CoachPassLine({ lesson }: { lesson: Lesson }) {
  const next = nextLesson(lesson)
  return (
    <div className="lsn-coach-pass" role="status">
      <span className="lsn-coach-pass-text">{t('Lesson complete')}</span>
      {next && (
        <button type="button" className="lsn-link is-inline" onClick={() => goToLesson(next)}>
          {t('Next lesson: {title} →', { title: next.title })}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------- lessons sheet

function LessonsSheet({ desktop, workspaceOn }: { desktop: boolean; workspaceOn: boolean }) {
  const open = useLessonUi((s) => s.sheetOpen)
  const setOpen = useLessonUi((s) => s.setSheetOpen)
  const [snap, setSnap] = useState(1)
  // every presentation starts at the full detent (the content scrolls there)
  useEffect(() => {
    if (open) setSnap(1)
  }, [open])
  // the desktop workspace hosts the browser in its Library panel instead
  useEffect(() => {
    if (open && workspaceOn) {
      setOpen(false)
      openLessons()
    }
  }, [open, workspaceOn, setOpen])
  return (
    <Sheet
      open={open && !workspaceOn}
      onDismiss={() => setOpen(false)}
      snapPoints={SHEET_SNAPS}
      activeSnap={snap}
      onSnapChange={setSnap}
      desktop={desktop}
      anchor="left"
      ariaLabel={t('Lessons')}
      className="lsn-sheet"
    >
      <div className="lsn-sheet-body">
        <div className="lsn-sheet-head">
          <BookIcon size={20} />
          <span className="lg-title">{t('Lessons')}</span>
        </div>
        <LessonBrowser variant="sheet" />
      </div>
    </Sheet>
  )
}

// ------------------------------------------------------------ confirmation

function ConfirmLoad({ desktop }: { desktop: boolean }) {
  const confirm = useLessonUi((s) => s.confirm)
  const setConfirm = useLessonUi((s) => s.setConfirm)
  const lesson = confirm ? lessonById(confirm.lessonId) : undefined
  const which = confirm?.which ?? 'start'
  return (
    <ActionSheet
      open={!!confirm && !!lesson}
      onDismiss={() => setConfirm(null)}
      desktop={desktop}
      anchor="left"
      title={t('Replace the current circuit?')}
      message={
        lesson
          ? which === 'start'
            ? t('The starting circuit of “{title}” replaces everything on the board (you can undo).', { title: lesson.title })
            : t('The solution of “{title}” replaces everything on the board (you can undo).', { title: lesson.title })
          : undefined
      }
      actions={[
        {
          label: which === 'start' ? t('Load starting circuit') : t('Load solution'),
          destructive: true,
          onSelect: () => {
            if (lesson) void loadLessonCircuit(lesson, which)
          },
        },
      ]}
    />
  )
}
