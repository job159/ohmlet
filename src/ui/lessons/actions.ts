/**
 * Lesson actions shared by the workspace Lessons tab, the phone lessons
 * sheet and the coach card: open the browser, load a lesson circuit into the
 * document (store.loadLayout — one undo step) with its firmware (lab
 * loadFirmware / clearFirmware, the same path as the inspector's file
 * input), run the acceptance or a step check against the LIVE circuit off
 * the main thread, move through the guided steps (pointing the camera at
 * each step through the scene bridge, K4), and the steps' one-click actions
 * (LS-1, LS-11): bind a bundled firmware, run the simulation, arm a library
 * part (the placed part is then selected), start wiring with the next
 * wire's ends marked, put pins on the logic analyzer, set a failing value.
 *
 * UX fix round: the guide follows the board — a circuit replaced as a whole
 * ends it, and an async load whose circuit was replaced meanwhile gives up
 * (LS-9); the last step leads to 驗收 (LS-12); observe steps frame their
 * LEDs and re-frame when the tray or a panel changes the free area (LS-12).
 *
 * Release QA (LS-F1…F7): every way into a lesson lands on that lesson's own
 * circuit (lessonOnBoard — 開始引導 / 下一課 load it, or ask to replace the
 * board); the wire tool the coach armed leaves by itself once the step's
 * wires are in; an analyzer step jumps to the burst it talks about
 * (latestBurst → revealInLogic); a lesson's circuit keeps only the analyzer
 * channels the lesson uses; a measuring step checks itself while the
 * simulation runs (watchRunningStepChecks); a jumper experiment removes its
 * wire in one click (「拆掉 j11 → bot-7 這條線」).
 */
import { create } from 'zustand'
import { useStore } from '../../state/store'
import { WORKSPACE_MEDIA_QUERY, useLab } from '../embedded/lab'
import { getEntry } from '../../model/catalog'
import type { CircuitLayout } from '../../model/types'
import type { Lesson, LessonCheck, LessonCircuit, LessonStepAction, LogicBurstView, PinRef } from '../../lessons/types'
import {
  isJumperExperiment,
  lessonInstrument,
  observeTargets,
  pendingWire,
  resetTarget,
  stepActions,
  wiresOnBoard,
  type ParamFix,
} from '../../lessons/step-actions'
import { resolvePinRef, tidyCjkSpaces } from '../../lessons/engine/refs'
import { ensureLogicChannel, findLogicChannel, revealInLogic, type ProbeTarget } from '../embedded/probe-actions'
import type { LogicChannelConfig } from '../../sim/coordinator/api'
import { fmtSpan } from '../../instruments/format'
import { terminalLabel } from '../../i18n/parts'
import { revealInstrument } from '../embedded/instruments/instrument-request'
import { focusInspector, noteMcuReset } from '../embedded/problems'
import { resetWireColorPick } from '../chrome/wire-convention'
import { useLessonProgress } from '../../lessons/progress'
import { LESSONS, lessonById } from '../../lessons'
import { isStructuralCheck, missingStartParts } from '../../lessons/diagnose'
import {
  EvalCancelledError,
  defaultAssets,
  runLessonChecks,
  type EvalInput,
  type EvalProgress,
  type EvaluatedCheck,
  type FirmwareFile,
} from '../../lessons/engine'
import { hasBundled } from '../../lessons/engine/assets'
import { hasBundledFirmware, loadBundledFirmware } from '../../firmware-assets'
import { parseProject } from '../../state/project'
import { sha256Hex } from '../../mcu/loader'
import { showToast, subscribeToasts, tick } from '../kit'
import { t } from '../../i18n'
import { tMessage } from '../../i18n/messages'
import { runOrResume } from '../chrome/run-control'
import { focusInScene, frameTargets, setArmFocusSource, type ArmFocus } from '../workspace/scene-bridge'
import { runKey, useLessonUi, type LessonSection } from './state'

// ---------------------------------------------------------------- browser

/** The desktop workspace is showing (its Lessons tab hosts the browser). */
export function workspaceShowing(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia(WORKSPACE_MEDIA_QUERY).matches &&
      useLab.getState().workspace.enabled
    )
  } catch {
    return false
  }
}

/**
 * Show the lesson browser — the workspace's Lessons tab when the desktop
 * workspace is on, the lessons sheet otherwise — optionally on one lesson.
 */
export function openLessons(lessonId?: string, section?: LessonSection): void {
  const ui = useLessonUi.getState()
  if (lessonId) ui.openLesson(lessonId, section)
  if (workspaceShowing()) {
    const lab = useLab.getState()
    lab.setWorkspace({ left: { ...lab.workspace.left, open: true, tab: 'lessons' } })
  } else {
    ui.setSheetOpen(true)
  }
}

// --------------------------------------------------- the first lesson (K9)

/** The first beginner lesson by order (b1-led-resistor), else the first lesson. */
export function firstLesson(): Lesson | undefined {
  return LESSONS.find((l) => l.level === 'beginner') ?? LESSONS[0]
}

/**
 * 「從第一課開始」 (UX contract K9 — onboarding, empty state): open the first
 * beginner lesson and load its starting circuit, which starts the coach on
 * step 1. The desktop workspace shows the lesson in its Lessons tab (the
 * coach card docks above it); phones keep the board visible (no sheet). A
 * board that holds anything asks first through the usual "replace the
 * current circuit?" confirmation (LessonOverlay) — the guide then starts
 * when the learner confirms.
 *   'loaded'  — circuit (and its firmware) loaded, guide on step 1
 *   'confirm' — waiting for the replace confirmation
 *   'failed'  — the circuit or its firmware could not be loaded (toasted)
 *   'missing' — no lessons are bundled
 */
export async function startFirstLesson(): Promise<'loaded' | 'confirm' | 'failed' | 'missing'> {
  const lesson = firstLesson()
  if (!lesson) return 'missing'
  useLessonUi.getState().openLesson(lesson.id, 'steps')
  if (workspaceShowing()) {
    const lab = useLab.getState()
    lab.setWorkspace({ left: { ...lab.workspace.left, open: true, tab: 'lessons' } })
  }
  if (!boardEmpty()) {
    useLessonUi.getState().setConfirm({ lessonId: lesson.id, which: 'start' })
    return 'confirm'
  }
  return (await loadLessonCircuit(lesson, 'start')) ? 'loaded' : 'failed'
}

/** The lesson after `lesson` (by level, then order — across levels). */
export function nextLesson(lesson: Lesson): Lesson | undefined {
  const i = LESSONS.findIndex((l) => l.id === lesson.id)
  return i >= 0 ? LESSONS[i + 1] : undefined
}

/** The first lesson of the next level, when `lesson` is not its level's last one (「跳到中級」). */
export function nextLevelStart(lesson: Lesson): Lesson | undefined {
  const next = nextLesson(lesson)
  if (!next || next.level !== lesson.level) return undefined
  return LESSONS.find((l) => l.level !== lesson.level && LESSONS.indexOf(l) > LESSONS.indexOf(lesson))
}

/**
 * Leave a lesson for another one (「下一課：…」, 「跳到中級：…」 — LS-F1): the
 * finished lesson's guide stops (and the wire tool it armed), the browser
 * opens on the new lesson's steps and its starting circuit goes on the board
 * — at once on an empty board, else after the usual "replace the current
 * circuit?" (取消 keeps the old board; the new lesson then offers 載入起始電路).
 * A board that already holds the new lesson's own circuit just resumes its guide.
 */
export function goToLesson(target: Lesson): void {
  tick()
  const ui = useLessonUi.getState()
  if (ui.coachId && ui.coachId !== target.id) stopGuide()
  leaveCoachWiring()
  openLessons(target.id, 'steps')
  if (lessonOnBoard(target, useStore.getState().layout)) startGuide(target)
  else requestLoad(target, 'start')
}

// ------------------------------------------------------------ the guide

/** The narrowest framing of a step's targets, in hole pitches. */
export const STEP_MIN_SPAN_HOLES = 16

/**
 * Point the camera at a step's highlight (LS-3) through the scene bridge —
 * frames only; the coach keeps its own highlight layer. Deferred two frames
 * so a circuit loaded in the same tick has been built (and framed) first.
 */
export function focusStep(lesson: Lesson, index: number): void {
  const h = lesson.steps[index]?.highlight
  if (!h || ((h.holes?.length ?? 0) === 0 && (h.components?.length ?? 0) === 0)) return
  const observe = observeSpec(lesson, index)
  if (observe) {
    const run = () => void focusInScene(observe, { kind: 'guide', minSpanHoles: OBSERVE_MIN_SPAN_HOLES })
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(run))
    else run()
    return
  }
  const spec = { holes: h.holes ?? [], components: h.components ?? [] }
  // a wiring step frames its holes from high above (≥ 60°): a raised board hides the far rows from a low angle (LS-11)
  const wiring = stepActions(lesson, index).some((a) => a.kind === 'wire')
  // a step frames with some context around its targets (≥ 16 hole pitches): the learner keeps their bearings
  const opts = wiring
    ? { kind: 'guide' as const, minSpanHoles: STEP_MIN_SPAN_HOLES, minElevationDeg: WIRING_ELEVATION_DEG }
    : { kind: 'guide' as const, minSpanHoles: STEP_MIN_SPAN_HOLES }
  const run = () => void focusInScene(spec, opts)
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(run))
  else run()
}

/** The lowest camera elevation a wiring step is framed from (degrees, H7). */
export const WIRING_ELEVATION_DEG = 60

/**
 * What the coach is guiding the learner to wire (the scene bridge's arm
 * focus, release-check SC-9): while it guides a step with a wire still to
 * draw, that step's highlight with focusStep's wiring framing — so the wire
 * tool armed from the dock on a phone frames the same holes 「開始接線」
 * does (both ends of a20 → e36 on screen) instead of the whole circuit cut
 * down about its centre. Null otherwise (no guide, an observe step, its
 * wires all drawn).
 */
export function guidedWiringFocus(): ArmFocus | null {
  const id = useLessonUi.getState().coachId
  const lesson = id ? lessonById(id) : undefined
  if (!lesson) return null
  const index = clampStep(lesson, useLessonProgress.getState().lessons[lesson.id]?.step ?? 0)
  const layout = useStore.getState().layout
  const wiring = stepActions(lesson, index).some((a) => a.kind === 'wire' && pendingWire(a, layout) !== null)
  const h = lesson.steps[index]?.highlight
  const holes = h?.holes ?? []
  const components = h?.components ?? []
  if (!wiring || (holes.length === 0 && components.length === 0)) return null
  return {
    spec: { holes: [...holes], components: [...components] },
    minSpanHoles: STEP_MIN_SPAN_HOLES,
    minElevationDeg: WIRING_ELEVATION_DEG,
  }
}

/** LessonOverlay: register guidedWiringFocus with the scene bridge; returns the unregister. */
export function provideArmFocus(): () => void {
  setArmFocusSource(guidedWiringFocus)
  return () => setArmFocusSource(null)
}

/**
 * The narrowest framing of an observe step (hole pitches): an LED with its
 * resistor reads ~40 px tall at 1366 × 768 with the tray open, the wire to
 * the board still in view.
 */
export const OBSERVE_MIN_SPAN_HOLES = 16

/**
 * The frame of an observe step on the LIVE board (LS-12 b): its LEDs and the
 * parts in series — null for other steps (and when none of them is on the board).
 */
export function observeSpec(lesson: Lesson, index: number): { components: string[]; holes: string[] } | null {
  const o = observeTargets(lesson, index)
  if (!o) return null
  const present = new Set(useStore.getState().layout.components.map((c) => c.id))
  const components = o.components.filter((id) => present.has(id))
  return components.length > 0 ? { components, holes: [] } : null
}

/**
 * Observe steps keep their LEDs in view (LS-12 b): when the instrument tray
 * or a side panel opens, closes or is resized while the coach shows one, the
 * free area changed — the step is framed again (debounced; event-driven,
 * never per frame). Returns the unsubscribe function.
 */
export function watchObserveFraming(delayMs = 350): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const sig = (w: ReturnType<typeof useLab.getState>['workspace']) =>
    `${w.tray.open ? w.tray.height : 0}|${w.left.open ? w.left.width : 0}|${w.right.open ? w.right.width : 0}`
  const unsub = useLab.subscribe((s, prev) => {
    if (s.workspace === prev.workspace || sig(s.workspace) === sig(prev.workspace)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const coachId = useLessonUi.getState().coachId
      const lesson = coachId ? lessonById(coachId) : undefined
      if (!lesson) return
      const index = clampStep(lesson, useLessonProgress.getState().lessons[lesson.id]?.step ?? 0)
      const spec = observeSpec(lesson, index)
      if (spec) frameTargets(spec, { minSpanHoles: OBSERVE_MIN_SPAN_HOLES })
    }, delayMs)
  })
  return () => {
    if (timer) clearTimeout(timer)
    unsub()
  }
}

/**
 * Start (or resume) the coach card on `lesson` at `step` (default: the saved
 * step). The guide only ever describes the lesson's OWN circuit (LS-F1):
 * while the board does not hold it (lessonOnBoard), an empty board gets the
 * starting circuit — which starts the guide on step 1 — and any other board
 * asks first (「要取代目前的電路嗎？」; 取消 starts nothing).
 */
export function startGuide(lesson: Lesson, step?: number): void {
  if (!lessonOnBoard(lesson, useStore.getState().layout)) {
    if (boardEmpty()) void loadLessonCircuit(lesson, 'start')
    else useLessonUi.getState().setConfirm({ lessonId: lesson.id, which: 'start' })
    return
  }
  const progress = useLessonProgress.getState()
  const saved = progress.lessons[lesson.id]?.step ?? 0
  const s = clampStep(lesson, step ?? saved)
  progress.setStep(lesson.id, s)
  useLessonUi.getState().setCoach(lesson.id)
  followStepWiring(lesson, s)
  focusStep(lesson, s)
}

export function clampStep(lesson: Lesson, step: number): number {
  return Math.max(0, Math.min(lesson.steps.length - 1, Number.isInteger(step) ? step : 0))
}

export function goToStep(lesson: Lesson, step: number): void {
  const s = clampStep(lesson, step)
  useLessonProgress.getState().setStep(lesson.id, s)
  useLessonUi.getState().setFocus(null)
  if (useLessonUi.getState().coachId === lesson.id) {
    followStepWiring(lesson, s)
    focusStep(lesson, s)
  }
}

export function stopGuide(): void {
  leaveCoachWiring()
  useLessonUi.getState().setCoach(null)
}

let restored = false

/**
 * After a reload: resume the coach on the lesson it was guiding (LS-4),
 * with a one-time toast 「繼續「…」步驟 n」, and show that lesson's steps in
 * the lesson browser. Once per page; a lesson that no longer exists — or
 * whose circuit is no longer on the board (LS-9: the board holds another
 * circuit; lessonOnBoard) — is forgotten.
 */
export function restoreGuide(): void {
  if (restored) return
  restored = true
  const progress = useLessonProgress.getState()
  const id = progress.guiding
  if (!id) return
  const lesson = lessonById(id)
  if (!lesson || lesson.steps.length === 0 || !lessonOnBoard(lesson, useStore.getState().layout)) {
    progress.setGuiding(null)
    return
  }
  const ui = useLessonUi.getState()
  if (ui.coachId) return
  const step = clampStep(lesson, progress.lessons[id]?.step ?? 0)
  // the lesson browser (課程 tab / lessons sheet, whenever it is shown) opens where the learner was
  if (!ui.viewId) ui.openLesson(lesson.id, 'steps')
  ui.setCoach(lesson.id)
  showToast(t('Continuing “{title}”, step {n}', { title: lesson.title, n: step + 1 }), { duration: 4200 })
  focusStep(lesson, step)
}

/** Tests: let restoreGuide run again. */
export function __resetRestoreForTests(): void {
  restored = false
}

// -------------------------------------------------------- load circuits

function boardEmpty(): boolean {
  const l = useStore.getState().layout
  return l.components.length === 0 && l.wires.length === 0
}

/** The layout a lesson load put on the board (its re-checks are not the learner's edits). */
let lessonLayout: CircuitLayout | null = null
/** The lesson whose circuit `lessonLayout` is. */
let lessonLayoutId: string | null = null

/**
 * The board holds `lesson`'s own circuit (LS-F1): it descends from a
 * loadLessonCircuit of THIS lesson — a component object of that load is
 * still in the layout (the identity test of circuitReplaced: edits keep the
 * untouched parts' objects, a replaced circuit shares none). A board that
 * descends from ANOTHER lesson's load is never this lesson's, even when it
 * happens to hold most of its parts (b1's PS1 / DMM1 / LED1 under b2). A
 * board that descends from no lesson load this session (after a reload, an
 * example, a file, undo across a load) falls back to its parts
 * (lessonPartsOnBoard).
 */
export function lessonOnBoard(lesson: Lesson, layout: CircuitLayout): boolean {
  if (lessonLayout && lessonLayoutId) {
    const loaded = new Set(lessonLayout.components)
    if (layout.components.some((c) => loaded.has(c))) return lessonLayoutId === lesson.id
  }
  return lessonPartsOnBoard(lesson, layout)
}

/**
 * The board holds `lesson`'s circuit by its parts alone: the parts its checks
 * name are mostly there (missingStartParts), every part of its starting
 * circuit is there (same id, same type), and nothing on the board is of a
 * type the lesson's circuits never use — the blink example's Blue Pill is
 * not b1's circuit although it has a PS1 and an LED1; i1's LED is not a3's;
 * b1's LED1 is not b2's. A part the learner added of a type the lesson uses
 * (b2's load resistor), or an instrument (a scope probe), keeps it the lesson's.
 */
export function lessonPartsOnBoard(lesson: Lesson, layout: CircuitLayout): boolean {
  const comps = Array.isArray(layout.components) ? layout.components.filter((c) => !!c) : []
  if (missingStartParts(lesson, layout).mostlyMissing) return false
  const have = new Map(comps.map((c) => [c.id, c.type]))
  if (!lesson.start.layout.components.every((c) => have.get(c.id) === c.type)) return false
  const types = new Set([...lesson.start.layout.components, ...lesson.solution.layout.components].map((c) => c.type))
  // the learner's own probes and meters (instruments) never make it another circuit
  return comps.every((c) => types.has(c.type) || getEntry(c.type)?.category === 'instrument')
}

/** Tests: forget which lesson the board descends from (as after a reload). */
export function __resetLessonLayoutForTests(): void {
  lessonLayout = null
  lessonLayoutId = null
}

/**
 * Generation of lesson circuit loads (LS-9 / RV-09): each loadLessonCircuit
 * takes a new one, and every async continuation — of a circuit load or of a
 * step's firmware load — gives up when a newer load started or the circuit
 * it was meant for has been replaced (an example, an import, undo …): no
 * firmware bind, no guide, no toast, no step check on the wrong circuit.
 */
let loadGen = 0
/** The lesson whose own circuit is being put on the board (its replace is not "another circuit"). */
let loadingLesson: string | null = null

/**
 * A circuit REPLACED as a whole — none of its parts is a part of the
 * previous document (the identity test of src/state/lab.ts: an example, a
 * lesson, an imported or new file, undo / redo across a load) — or a board
 * that was emptied. An edit keeps the untouched parts' objects.
 */
export function circuitReplaced(prev: CircuitLayout, next: CircuitLayout): boolean {
  if (next === prev) return false
  if (next.components.length === 0) return next.wires.length === 0 && prev.components.length > 0
  const before = new Set(prev.components)
  return !next.components.some((c) => before.has(c))
}

/** A continuation of a load started on `target` at generation `gen` is out of date. */
function staleLoad(gen: number, target: CircuitLayout): boolean {
  const now = useStore.getState().layout
  return gen !== loadGen || (now !== target && circuitReplaced(target, now))
}

/** Load a lesson circuit, asking first when the board holds anything. */
export function requestLoad(lesson: Lesson, which: 'start' | 'solution'): void {
  if (boardEmpty()) void loadLessonCircuit(lesson, which)
  else useLessonUi.getState().setConfirm({ lessonId: lesson.id, which })
}

/**
 * Replace the document with the lesson's start / solution circuit (one undo
 * step) and bind its firmware: bundled firmware/dist images for the boards
 * the lesson names, cleared bindings for its other MCU boards (an earlier
 * board with the same id must not keep running its old firmware). A newer
 * load, or another circuit replacing this one while the firmware loads,
 * cancels the rest (false, silently — the newer action speaks for itself).
 */
export async function loadLessonCircuit(lesson: Lesson, which: 'start' | 'solution'): Promise<boolean> {
  const gen = ++loadGen
  const circuit: LessonCircuit = which === 'start' ? lesson.start : lesson.solution
  loadingLesson = lesson.id
  let res: ReturnType<ReturnType<typeof useStore.getState>['loadLayout']>
  try {
    res = useStore.getState().loadLayout(circuit.layout)
  } finally {
    loadingLesson = null
  }
  if (!res.ok) {
    showToast(t('Couldn’t load the lesson circuit: {error}', { error: res.errors[0] ? tMessage(res.errors[0]) : t('unknown error') }), {
      duration: 5200,
    })
    return false
  }
  const target = useStore.getState().layout
  lessonLayout = target
  lessonLayoutId = lesson.id
  // the analyzer keeps only the channels THIS lesson reads (LS-F5): i1's PA5 / PC13 never carry into a3
  pruneLessonChannels(lesson, target)
  useLessonProgress.getState().loaded(lesson.id, which)
  const lab = useLab.getState()
  const failures: string[] = []
  for (const comp of target.components) {
    if (!getEntry(comp.type)?.mcu) continue
    const project = circuit.firmware?.[comp.id]
    if (!project) {
      lab.clearFirmware(comp.id)
      continue
    }
    try {
      const file = await defaultAssets.bundled(project)
      if (staleLoad(gen, target)) return false
      if (!file) {
        failures.push(t('the {project} firmware is not bundled with the app', { project }))
        continue
      }
      const r = await lab.loadFirmware(comp.id, file)
      if (staleLoad(gen, target)) return false
      if (!r.ok) failures.push(tMessage(r.error ?? ''))
    } catch (err) {
      if (staleLoad(gen, target)) return false
      failures.push(tMessage(err instanceof Error ? err.message : String(err)))
    }
  }
  if (staleLoad(gen, target)) return false
  // the instrument the lesson reads (the analyzer for a frequency / duty lesson — LS-11)
  const instrument = lessonInstrument(lesson)
  if (instrument) showInstrument(instrument)
  tick()
  // phones: drop the lessons sheet so the board and the coach card show
  useLessonUi.getState().setSheetOpen(false)
  // a fresh circuit: nothing on it has been attempted yet, earlier results are stale
  useLessonUi.getState().clearAttempts(lesson.id)
  if (which === 'start') {
    useLessonProgress.getState().start(lesson.id)
    startGuide(lesson, 0)
  } else if (useLessonUi.getState().coachId !== lesson.id) {
    startGuide(lesson)
  }
  const ui = useLessonUi.getState()
  for (const key of Object.keys(ui.runs)) if (key.startsWith(`${lesson.id}|`)) ui.setRun(key, null)
  ui.setFocus(null)
  if (failures.length > 0) {
    showToast(t('Circuit loaded, but the firmware could not be loaded: {error}', { error: failures[0] }), { duration: 5200 })
  } else {
    showToast(which === 'start' ? t('Loaded the starting circuit of “{title}”', { title: lesson.title }) : t('Loaded the solution of “{title}”', { title: lesson.title }))
  }
  return failures.length === 0
}

/**
 * The pins a lesson reads on the logic analyzer (LS-F5): those of its
 * add-logic step actions (explicit or derived) and those its frequency /
 * duty checks measure (steps and acceptance).
 */
export function lessonLogicRefs(lesson: Lesson): PinRef[] {
  const out: PinRef[] = []
  lesson.steps.forEach((_, i) => {
    for (const a of stepActions(lesson, i)) if (a.kind === 'add-logic') for (const pin of a.pins) out.push({ component: a.component, pin })
  })
  const walk = (c: LessonCheck): void => {
    if (c.kind === 'all') c.checks.forEach(walk)
    else if (c.kind === 'measure' && (c.quantity === 'frequency' || c.quantity === 'duty')) out.push(c.at)
  }
  for (const s of lesson.steps) if (s.check) walk(s.check)
  lesson.acceptance.forEach(walk)
  return out
}

/** A channel measures one of `refs` on `layout` (the same MCU pin, or the same hole / terminal). */
function channelReads(ch: LogicChannelConfig, refs: readonly PinRef[], layout: CircuitLayout): boolean {
  return refs.some((ref) => {
    const r = resolvePinRef(layout, ref)
    if (!r.ok) return false
    if (r.mcuPin) return ch.source.kind === 'mcu-pin' && ch.source.componentId === r.mcuPin.componentId && ch.source.pin === r.mcuPin.pin
    return ch.source.kind === 'net' && ch.source.ref === r.endpoint
  })
}

/** The trigger settings read a channel index that is not in `live` (an edge on it, or a pattern bit). */
function triggerReadsGone(trigger: Record<string, unknown> | null, live: ReadonlySet<number>): boolean {
  if (!trigger) return false
  if (trigger.kind === 'pattern') {
    const pattern = trigger.pattern && typeof trigger.pattern === 'object' ? Object.keys(trigger.pattern as object) : []
    return pattern.some((k) => !live.has(Number(k)))
  }
  const channel = typeof trigger.channel === 'number' ? trigger.channel : 0
  return !live.has(channel)
}

/**
 * A lesson's circuit keeps only the logic channels the lesson itself reads
 * (LS-F5): an earlier lesson's U1 PA5 / PC13 (same board id, so the lab's
 * own stale-source pruning keeps them) are dropped, with the decoders that
 * read only those and a trigger on one of them (the trigger then defaults to
 * channel 0 — the first channel the lesson's step adds).
 */
function pruneLessonChannels(lesson: Lesson, layout: CircuitLayout): void {
  const lab = useLab.getState()
  if (lab.logicChannels.length === 0) return
  const refs = lessonLogicRefs(lesson)
  const keep = lab.logicChannels.filter((ch) => channelReads(ch, refs, layout))
  if (keep.length === lab.logicChannels.length) return
  lab.setLogicChannels(keep)
  const live = new Set(keep.map((c) => c.index))
  const view = useLab.getState().logicView
  const decoders = view.decoders.filter((d) => {
    const chs = d && typeof d.channels === 'object' && d.channels ? Object.values(d.channels as Record<string, unknown>) : []
    return chs.some((i) => typeof i === 'number' && live.has(i))
  })
  const trigger = triggerReadsGone(view.trigger, live)
  if (decoders.length !== view.decoders.length || trigger) {
    useLab.getState().setLogicView(trigger ? { decoders, trigger: null } : { decoders })
  }
}

// ------------------------------------------------- step actions (LS-1)

/** File stem of a bound firmware ("hal-blink.elf" → "hal-blink"). */
export function firmwareStem(name: string): string {
  return name.replace(/\.[A-Za-z0-9]+$/, '')
}

/** The bundled project bound to `componentId` (by file name), null = none / not an ELF. */
export function boundProject(componentId: string): string | null {
  const rec = useLab.getState().firmware[componentId]
  return rec ? firmwareStem(rec.name) : null
}

/**
 * 「載入 hal-blink 到 U1」: bind a bundled firmware/dist image to an MCU board
 * through the lab's own loader (loadBundledFirmware → lab.loadFirmware —
 * the inspector's path; the board resets and runs the real image). In the
 * workspace the board is selected so its inspector shows the binding (phones
 * keep the board in view — a selection would cover it with the Properties
 * sheet). With a lesson step, that step is checked right after.
 */
export async function loadStepFirmware(componentId: string, project: string, step?: { lesson: Lesson; index: number }): Promise<boolean> {
  const ui = useLessonUi.getState()
  if (ui.loadingFirmware) return false
  const comp = useStore.getState().layout.components.find((c) => c.id === componentId)
  if (!comp || !getEntry(comp.type)?.mcu) {
    showToast(t('{id} is not on the board — load the starting circuit first', { id: componentId }), { duration: 4200 })
    return false
  }
  if (!hasBundledFirmware(project)) {
    showToast(t('the {project} firmware is not bundled with the app', { project }), { duration: 4200 })
    return false
  }
  ui.setLoadingFirmware(`${componentId}|${project}`)
  // a lesson / example / file replacing this circuit meanwhile cancels the rest (LS-9)
  const gen = loadGen
  const target = useStore.getState().layout
  try {
    const file = await loadBundledFirmware(project)
    if (staleLoad(gen, target)) return false
    const r = await useLab.getState().loadFirmware(componentId, file)
    if (staleLoad(gen, target)) return false
    if (!r.ok) {
      showToast(t('Couldn’t load {project}: {error}', { project, error: tMessage(r.error ?? '') }), { duration: 5200 })
      return false
    }
    tick()
    if (workspaceShowing()) useStore.getState().select(componentId)
    showToast(t('Loaded {file} into {id}', { file: file.name, id: componentId }))
    if (step) void runStepCheck(step.lesson, step.index)
    return true
  } catch (err) {
    if (staleLoad(gen, target)) return false
    showToast(t('Couldn’t load {project}: {error}', { project, error: tMessage(err instanceof Error ? err.message : String(err)) }), {
      duration: 5200,
    })
    return false
  } finally {
    useLessonUi.getState().setLoadingFirmware(null)
  }
}

/** 「▶ 執行模擬」: start the simulation, or resume a board the debugger halted (K2). */
export function runSim(): void {
  tick()
  runOrResume()
}

/**
 * 「拿一顆電阻」: arm the library's placement mode for `type` — the next
 * clicks on breadboard holes place it, exactly like its library card.
 */
export function armPart(type: string): void {
  if (!getEntry(type)) return
  tick()
  const before = new Set(useStore.getState().layout.components.map((c) => c.id))
  useStore.getState().setMode({ kind: 'place', type, pickedHoles: [] })
  watchPlacement(type, before)
}

/** The armed step part waiting for its first placement (one at a time). */
let placementWatch: (() => void) | null = null

/**
 * LS-11 (a): the part a step's 「拿一顆電阻」 armed is placed ONCE — then the
 * tool returns to select, the new part is selected and its properties open
 * (focusInspector), so 「把電阻值設為 330 Ω」 is right where the learner looks,
 * and the coach's button reads 「拿一顆電阻」 again for a next one. Leaving
 * placement any other way (Esc, another tool) just stops watching.
 */
function watchPlacement(type: string, before: ReadonlySet<string>): void {
  placementWatch?.()
  let done = false
  const stop = () => {
    if (done) return
    done = true
    unsub()
    if (placementWatch === stop) placementWatch = null
  }
  const unsub = useStore.subscribe((s, prev) => {
    if (s.layout !== prev.layout) {
      const added = s.layout.components.find((c) => c.type === type && !before.has(c.id))
      if (added) {
        stop()
        // after the placement click's own handler (it re-arms repeat placement in the same tick)
        setTimeout(() => {
          const st = useStore.getState()
          if (!st.layout.components.some((c) => c.id === added.id)) return
          if (st.mode.kind === 'place' && st.mode.type === type) st.setMode({ kind: 'select' })
          focusInspector(added.id)
          showToast(t('Placed {id} — its properties are open', { id: added.id }), { duration: 3600 })
        }, 0)
        return
      }
    }
    if (s.mode.kind !== 'place' || s.mode.type !== type) stop()
  })
  placementWatch = stop
}

/** The lesson highlight a wiring step points at (only its own key is cleared again). */
export const WIRE_FOCUS = 'wire:'

/** The running 「開始接線」 guide (one at a time). */
let wiringWatch: (() => void) | null = null

/**
 * The wire tool is armed because a step's 「開始接線」 armed it (LS-F2) —
 * cleared as soon as the tool is left any way. Wire mode the learner picked
 * from the dock is never the coach's to end.
 */
let wiringByCoach = false

/** The wire tool is the coach's (tests). */
export function coachArmedWiring(): boolean {
  return wiringByCoach && useStore.getState().mode.kind === 'wire'
}

/**
 * The coach leaves the wire tool it armed (LS-F2): the marks go, select mode
 * is back — no toast (上一步／下一步, 下一課, closing the guide).
 */
function leaveCoachWiring(): void {
  wiringWatch?.()
  if (!wiringByCoach) return
  wiringByCoach = false
  const st = useStore.getState()
  if (st.mode.kind === 'wire') st.setMode({ kind: 'select' })
}

/**
 * The guide moved to step `index` while the coach's wire tool is armed:
 * a step with wires still to draw takes the tool over (its next wire is
 * marked), any other step returns to select (LS-F2).
 */
function followStepWiring(lesson: Lesson, index: number): void {
  if (!coachArmedWiring()) {
    wiringByCoach = false
    return
  }
  const a = stepActions(lesson, index).find((x): x is Extract<LessonStepAction, { kind: 'wire' }> => x.kind === 'wire')
  if (a && pendingWire(a, useStore.getState().layout)) startWiring(a, { lesson, index })
  else leaveCoachWiring()
}

/**
 * LS-11 (c) 「開始接線（a16 → top-13）」: the wire tool with the next wire the
 * step still needs marked on the board — first its start, after the first
 * click its other end — and the camera on the step's holes from high above
 * (a raised Blue Pill hides the far rows from a low angle). Once a wire is
 * drawn and the tool is still armed, the step's NEXT wire is marked at once
 * (final round: one 「開始接線」 walks the learner through the step's wires;
 * the phone coach stays folded meanwhile). The marks go once the step's
 * wires are all drawn or the tool is left. Release QA LS-F2: once the last
 * of them is drawn the tool leaves by itself (「導線都接好了，已離開導線工具」),
 * so the next click on a part selects it instead of starting a wire.
 */
export function startWiring(a: Extract<LessonStepAction, { kind: 'wire' }>, step?: { lesson: Lesson; index: number }): void {
  const st = useStore.getState()
  const next = pendingWire(a, st.layout)
  if (!next) return
  tick()
  resetWireColorPick()
  st.select(null)
  st.setMode({ kind: 'wire', from: null, color: st.mode.kind === 'wire' ? st.mode.color : 'red' })
  wiringByCoach = true
  if (step) focusStep(step.lesson, step.index)
  let [from, to] = next
  const mark = (holes: string[]) => useLessonUi.getState().setFocus({ key: `${WIRE_FOCUS}${from}>${to}`, holes, components: [] })
  mark([from])
  wiringWatch?.()
  let wiresBefore = st.layout.wires.length
  let done = false
  const stop = () => {
    if (done) return
    done = true
    unsub()
    if (wiringWatch === stop) wiringWatch = null
    const ui = useLessonUi.getState()
    if (ui.focus?.key.startsWith(WIRE_FOCUS)) ui.setFocus(null)
  }
  const unsub = useStore.subscribe((s) => {
    if (s.mode.kind !== 'wire') {
      wiringByCoach = false
      stop()
      return
    }
    if (s.layout.wires.length !== wiresBefore) {
      // a wire was drawn (or undone): the step's next wire, while the tool stays armed
      const more = pendingWire(a, s.layout)
      if (!more) {
        stop()
        // the step's wires are all in: leave the tool — after the click handler that drew the last
        // one has re-armed it for a next wire (App.tsx)
        setTimeout(() => {
          if (!wiringByCoach || useStore.getState().mode.kind !== 'wire') return
          wiringByCoach = false
          useStore.getState().setMode({ kind: 'select' })
          showToast(t('All the wires are in — left the wire tool'), { duration: 3200 })
        }, 0)
        return
      }
      wiresBefore = s.layout.wires.length
      if (more[0] !== from || more[1] !== to) {
        ;[from, to] = more
        mark([from])
        return
      }
    }
    // after the first click, the other end of the wire
    const at = s.mode.from === from ? [to] : s.mode.from === to ? [from] : s.mode.from ? [from, to] : [from]
    const cur = useLessonUi.getState().focus
    if (cur?.key.startsWith(WIRE_FOCUS) && cur.holes.join() !== at.join()) mark(at)
  })
  wiringWatch = stop
}

/**
 * LS-11 (d) 「把 PA5、PC13 加到邏輯分析儀」: a channel for each pin (an existing
 * one on the same net is kept), one toast, and the analyzer shown. With a
 * `view` naming a burst (release QA LS-F4, a3 「找到 40 B 的那一筆訊息」) the
 * analyzer then jumps to the latest such burst (revealBurst) — also on a
 * second press, when the channels are already there.
 */
export function addLogicChannels(component: string, pins: readonly string[], view?: LogicBurstView): boolean {
  const layout = useStore.getState().layout
  const comp = layout.components.find((c) => c.id === component)
  if (!comp || !getEntry(comp.type)) {
    showToast(t('{id} is not on the board — load the starting circuit first', { id: component }), { duration: 4200 })
    return false
  }
  tick()
  const added: string[] = []
  const failed: string[] = []
  for (const pin of pins) {
    const target = logicTarget(component, pin, layout)
    const r = target ? ensureLogicChannel(target) : null
    if (!r || !r.ok) failed.push(pin)
    else if (r.added) added.push(pin)
  }
  showInstrument('logic', { open: true })
  const names = (list: readonly string[]) => list.map((p) => logicPinName(component, p)).join('、')
  if (failed.length > 0) {
    showToast(t('Could not add {pins} to the logic analyzer', { pins: names(failed) }), { duration: 4200 })
  } else if (view?.burstOn) {
    // the toast says what was found (or what to do) once the search ends
    void revealBurst(component, view, { pins: names(pins), added: added.length > 0 })
  } else if (added.length === 0) {
    showToast(t('{pins} are already on the logic analyzer', { pins: names(pins) }))
  } else {
    showToast(
      workspaceShowing()
        ? t('Added {pins} to the logic analyzer', { pins: names(added) })
        : t('Added {pins} to the logic analyzer — open Instruments to see them', { pins: names(added) }),
    )
  }
  return failed.length === 0
}

/** Edges closer than this belong to one burst (a UART message: its characters are 87 µs apart at 115200 Bd). */
export const BURST_GAP_S = 1e-3
/** How far back the burst search looks (s of simulated time: a3's three messages repeat every 0.6 s). */
export const BURST_LOOKBACK_S = 1.2
/** The burst search polls this often (ms)… */
export const BURST_POLL_MS = 250
/** …for at most this long (ms, wall time). */
export const BURST_WAIT_MS = 3000

/**
 * The latest COMPLETE burst of edges in a logic trace (pure; LS-F4): a run of
 * edges each less than `gap` after the previous one, lasting at least
 * `minBurst` s, with at least `gap` of quiet before it and after it inside
 * the window [t0, t1] (a burst cut by either window edge is not complete).
 * null when there is none.
 */
export function latestBurst(
  times: ArrayLike<number>,
  opts: { t0: number; t1: number; minBurst?: number; gap?: number },
): { start: number; end: number } | null {
  const gap = opts.gap ?? BURST_GAP_S
  const min = opts.minBurst ?? 0
  let i = times.length - 1
  while (i >= 0) {
    let j = i
    while (j > 0 && times[j] - times[j - 1] < gap) j--
    const start = times[j]
    const end = times[i]
    const complete = opts.t1 - end >= gap && start - opts.t0 >= gap
    if (complete && end - start >= min) return { start, end }
    i = j - 1
  }
  return null
}

/** The running burst search (a newer press or a replaced circuit ends the older one). */
let burstGen = 0

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Jump the logic analyzer to the latest complete burst on `view.burstOn`
 * (LS-F4): while the simulation runs, the last BURST_LOOKBACK_S of the
 * analyzer's capture is searched every BURST_POLL_MS for up to
 * BURST_WAIT_MS; the burst found is shown centred in a `view.span` window
 * with marker A on its first edge (revealInLogic — the analyzer stops
 * following). The toast says what happened — never a reading that is not there.
 */
async function revealBurst(component: string, view: LogicBurstView, names: { pins: string; added: boolean }): Promise<boolean> {
  const gen = ++burstGen
  const target = useStore.getState().layout
  const what = view.label ?? t('signal burst')
  const span = fmtSpan(view.span)
  const say = (text: string, duration = 4200) => showToast(tidyCjkSpaces(text), { duration })
  const deadline = Date.now() + BURST_WAIT_MS
  for (;;) {
    const now = useStore.getState().layout
    if (gen !== burstGen || (now !== target && circuitReplaced(target, now))) return false
    if (!useStore.getState().running) {
      say(
        names.added
          ? t('Added {pins} to the logic analyzer — press ▶ Run simulation, then press this button again to jump to the latest {what}', { pins: names.pins, what })
          : t('{pins} are on the logic analyzer — press ▶ Run simulation, then press this button again to jump to the latest {what}', { pins: names.pins, what }),
        5600,
      )
      return false
    }
    const lt = view.burstOn ? logicTarget(component, view.burstOn, now) : null
    const ch = lt ? findLogicChannel(lt, now) : null
    const t1 = useStore.getState().simTime
    if (ch && t1 > 0) {
      const cap = await useLab.getState().queryLogic(Math.max(0, t1 - BURST_LOOKBACK_S), t1)
      if (gen !== burstGen) return false
      const trace = cap.traces.find((x) => x.index === ch.index)
      const end = Math.min(cap.t1, cap.tNow ?? cap.t1)
      const b = trace ? latestBurst(trace.times, { t0: cap.t0, t1: end, minBurst: view.minBurst }) : null
      if (b) {
        revealInLogic((b.start + b.end) / 2, view.span, b.start)
        say(
          names.added
            ? t('Added {pins} to the logic analyzer and jumped to the latest {what} ({span} window)', { pins: names.pins, what, span })
            : t('Jumped to the latest {what} on the logic analyzer ({span} window)', { what, span }),
        )
        return true
      }
    }
    if (Date.now() >= deadline) {
      say(
        names.added
          ? t('Added {pins} to the logic analyzer — no complete {what} yet: let the simulation run a little longer, then press this button again', { pins: names.pins, what })
          : t('No complete {what} on the logic analyzer yet — let the simulation run a little longer, then press this button again', { what }),
        5600,
      )
      return false
    }
    await sleepMs(BURST_POLL_MS)
  }
}

/** The logic-analyzer source of a part pin: an MCU pin, else the hole the pin sits in. */
function logicTarget(component: string, pin: string, layout: CircuitLayout): ProbeTarget | null {
  const r = resolvePinRef(layout, { component, pin })
  if (!r.ok) return null
  if (r.mcuPin) return { kind: 'mcu-pin', componentId: r.mcuPin.componentId, pin: r.mcuPin.pin }
  return r.hole ? { kind: 'hole', ref: r.endpoint } : { kind: 'terminal', ref: r.endpoint }
}

/** 「PA5」 for a pin of the (single) MCU board — the analyzer's own channel name — else 「U2 QA」. */
export function logicPinName(component: string, pin: string): string {
  const layout = useStore.getState().layout
  const comp = layout.components.find((c) => c.id === component)
  const mcu = comp ? !!getEntry(comp.type)?.mcu : false
  const boards = layout.components.filter((c) => !!getEntry(c.type)?.mcu).length
  return mcu && boards <= 1 ? pin : `${component} ${pin}`
}

/**
 * Point the workspace's instrument tray at `tab` (the lesson's instrument,
 * LS-11). Phones keep the board in view: the 儀器 sheet is only switched to
 * `tab` (it opens there next time), unless `open` asks for it now — after
 * an explicit step action such as 「把 PA5 加到邏輯分析儀」.
 */
export function showInstrument(tab: 'logic' | 'scope' | 'uart', opts: { open?: boolean } = {}): void {
  if (!workspaceShowing()) {
    revealInstrument(tab, { open: opts.open })
    return
  }
  const lab = useLab.getState()
  if (lab.workspace.tray.open && lab.workspace.tray.tab === tab) return
  lab.setWorkspace({ tray: { ...lab.workspace.tray, open: true, tab } })
}

/**
 * LS-11 (b) 「把 R1 設為 330 Ω」: give the part the value its failing check
 * wants (one undo step, like the inspector's field); the step re-checks
 * itself after the edit (watchStepChecks).
 */
export function applyParamFix(fix: ParamFix): void {
  tick()
  useStore.getState().setParam(fix.component, fix.param, fix.value)
}

/**
 * 「重置 MCU」 / 「重置模擬」 (final round, request 3) — the step's own button
 * for what its text used to send the learner to the inspector or the More
 * sheet for, through the very same actions:
 *  - scope 'mcu': the inspector's Reset MCU on the step's board
 *    (noteMcuReset + lab.mcuReset): the firmware starts again from reset
 *    (it reads its experiment jumpers there), the sensors and the display
 *    keep their state — exactly like the board's reset button;
 *  - scope 'circuit': the More sheet's Reset simulation (store.resetSim):
 *    every part powers up again from 0 s; a simulation that was running
 *    runs on from the new power-on (the learner pressed it to see the
 *    cold start), a stopped one waits for ▶ 執行模擬.
 * A board that is not on the board or has no firmware yet is told, not
 * reset. Returns whether something was reset.
 */
export function resetFromStep(a: Extract<LessonStepAction, { kind: 'reset' }>, lesson: Lesson): boolean {
  if (a.scope === 'circuit') {
    const wasRunning = useStore.getState().running
    tick(16)
    useStore.getState().resetSim()
    if (wasRunning) runOrResume()
    showToast(wasRunning ? t('Simulation reset — the whole circuit powered up again') : t('Simulation reset'))
    return true
  }
  const id = resetTarget(lesson, a)
  const comp = id ? useStore.getState().layout.components.find((c) => c.id === id) : undefined
  if (!id || !comp || !getEntry(comp.type)?.mcu) {
    showToast(t('{id} is not on the board — load the starting circuit first', { id: id ?? 'U1' }), { duration: 4200 })
    return false
  }
  if (!useLab.getState().firmware[id]) {
    showToast(t('{id} has no firmware yet', { id }), { duration: 4200 })
    return false
  }
  noteMcuReset(id)
  useLab.getState().mcuReset(id)
  tick(16)
  showToast(t('{id} reset', { id }))
  return true
}

/** An end of a wire a step names: a hole as written (「a16」), a terminal by its name (「DMM1 IN 端」). */
export function wireEndText(ref: string, layout: CircuitLayout = useStore.getState().layout): string {
  return ref.includes(':') ? terminalLabel(ref, layout) : ref
}

/**
 * 「拆掉 j11 → bot-7 這條線」 (release QA LS-F7): the end of a jumper
 * experiment — the wire(s) of the action that are on the board go in ONE
 * undo step (Ctrl+Z puts them back), no confirmation; the step re-checks
 * itself after the edit (watchStepChecks). Returns whether a wire went.
 */
export function unwireFromStep(a: Extract<LessonStepAction, { kind: 'unwire' }>): boolean {
  const st = useStore.getState()
  const gone = wiresOnBoard(a, st.layout)
  if (gone.length === 0) return false
  tick()
  if (gone.length === 1) st.removeWire(gone[0].id)
  else {
    st.select(null)
    for (const w of gone) st.toggleSelect(w.id)
    st.removeSelected()
  }
  // named the way the step names the wire (its own direction)
  const named = gone.map((w) => a.wires.find(([f, to]) => (f === w.from && to === w.to) || (f === w.to && to === w.from)) ?? [w.from, w.to])
  const layout = st.layout
  showToast(
    named.length === 1
      ? t('Removed the wire {from} → {to}', { from: wireEndText(named[0][0], layout), to: wireEndText(named[0][1], layout) })
      : t('Removed {n} wires', { n: named.length }),
  )
  return true
}

/** Run one step action (the coach / step list buttons). */
export function runStepAction(a: LessonStepAction, step?: { lesson: Lesson; index: number }): void {
  switch (a.kind) {
    case 'load-firmware':
      void loadStepFirmware(a.component, a.project, step)
      return
    case 'run':
      runSim()
      return
    case 'arm-part':
      armPart(a.type)
      return
    case 'wire':
      startWiring(a, step)
      return
    case 'add-logic':
      addLogicChannels(a.component, a.pins, a.view)
      return
    case 'reset':
      if (step) resetFromStep(a, step.lesson)
      return
    case 'unwire':
      unwireFromStep(a)
      return
  }
}

// ---------------------------------------------------- live evaluation

/**
 * The live document as evaluator input: the store's layout and the bytes of
 * every bound firmware — bundled images straight from firmware/dist when the
 * binding is byte-identical to one, otherwise from the lab's project export
 * (the user's own files).
 */
export async function liveEvalInput(): Promise<EvalInput> {
  const layout = useStore.getState().layout
  const records = useLab.getState().firmware
  const firmware: Record<string, FirmwareFile> = {}
  const missing: string[] = []
  for (const [id, rec] of Object.entries(records)) {
    const project = firmwareStem(rec.name)
    if (rec.format === 'elf' && hasBundled(project)) {
      try {
        const file = await defaultAssets.bundled(project)
        if (file && sha256Hex(file.bytes) === rec.sha256) {
          firmware[id] = file
          continue
        }
      } catch {
        /* fall back to the project export */
      }
    }
    missing.push(id)
  }
  if (missing.length > 0) {
    const parsed = parseProject(await useLab.getState().exportProject())
    if (parsed.ok) {
      for (const fw of parsed.project.firmware) {
        if (!missing.includes(fw.componentId)) continue
        firmware[fw.componentId] =
          fw.binBase !== undefined ? { name: fw.name, bytes: fw.bytes, binBase: fw.binBase } : { name: fw.name, bytes: fw.bytes }
      }
    }
  }
  return { layout, firmware }
}

const controllers = new Map<string, AbortController>()

export function cancelRun(key: string): void {
  controllers.get(key)?.abort()
}

/**
 * A check answered by the netlist alone (no simulated time, no firmware):
 * cheap enough to evaluate inline on the main thread, e.g. automatically
 * after every edit while the coach shows its step.
 */
export function isStructural(c: LessonCheck): boolean {
  return isStructuralCheck(c)
}

async function runChecksInto(key: string, checks: Lesson['acceptance']): Promise<EvaluatedCheck[] | null> {
  controllers.get(key)?.abort()
  const ac = new AbortController()
  controllers.set(key, ac)
  const ui = useLessonUi.getState()
  const startedAt = Date.now()
  ui.setRun(key, { status: 'running', progress: null, results: null, at: startedAt })
  // a failed check of the previous run may be pointed at in 3D: it is stale now
  if (ui.focus?.key.startsWith(`${key}#`)) ui.setFocus(null)
  try {
    const structural = checks.every(isStructural)
    const input: EvalInput = structural ? { layout: useStore.getState().layout, firmware: {} } : await liveEvalInput()
    const results = await runLessonChecks(input, checks, {
      worker: structural ? false : undefined,
      signal: ac.signal,
      onProgress: (progress: EvalProgress) => {
        if (controllers.get(key) !== ac) return
        useLessonUi.getState().setRun(key, { status: 'running', progress, results: null, at: startedAt })
      },
    })
    if (controllers.get(key) !== ac) return null
    useLessonUi.getState().setRun(key, { status: 'done', progress: null, results, at: Date.now() })
    return results
  } catch (err) {
    if (controllers.get(key) !== ac) return null
    if (err instanceof EvalCancelledError) {
      useLessonUi.getState().setRun(key, null)
      return null
    }
    const msg = tMessage(err instanceof Error ? err.message : String(err))
    useLessonUi.getState().setRun(key, { status: 'error', progress: null, results: null, error: msg, at: Date.now() })
    return null
  } finally {
    if (controllers.get(key) === ac) controllers.delete(key)
  }
}

/**
 * The last step's 「前往驗收 · 檢查我的電路」 (LS-12): the lesson's 驗收
 * section (the workspace panel / the lessons sheet), the acceptance run, and
 * — when it finishes — its outcome scrolled into view by the section.
 */
export function goToAcceptance(lesson: Lesson): void {
  tick()
  openLessons(lesson.id, 'acceptance')
  void runAcceptance(lesson)
}

/** "檢查我的電路": every acceptance check on the live circuit. */
export async function runAcceptance(lesson: Lesson): Promise<void> {
  if (lesson.runnable === 'not-yet' || lesson.acceptance.length === 0) return
  useLessonProgress.getState().start(lesson.id)
  const results = await runChecksInto(runKey(lesson.id), lesson.acceptance)
  if (!results) return
  const passed = results.filter((r) => r.pass).length
  useLessonProgress.getState().recordCheck(lesson.id, passed, results.length)
  if (passed === results.length) {
    tick()
    useLessonProgress.getState().complete(lesson.id)
    showToast(t('Lesson complete — all {n} acceptance checks pass.', { n: results.length }), { duration: 4200 })
  } else {
    // 「驗收 3 / 5 項通過 · 查看原因」: the outcome and 最可能的原因, wherever the learner is now (LS-12)
    showToast(t('{passed} of {n} acceptance checks pass', { passed, n: results.length }), {
      duration: 5200,
      action: { label: t('See why'), run: () => showAcceptanceCause(lesson) },
    })
  }
}

/** 「查看原因」: the lesson's 驗收 section, scrolled to its outcome and 最可能的原因 (LS-12). */
export function showAcceptanceCause(lesson: Lesson): void {
  tick()
  openLessons(lesson.id, 'acceptance')
  useLessonUi.getState().requestRevealCause(lesson.id)
}

/**
 * The current step's own check on the live circuit. `attempt` (default)
 * marks the step as tried by the learner — a failure then reads ✕; the
 * automatic re-check after a lesson load passes false.
 */
export async function runStepCheck(lesson: Lesson, stepIndex: number, opts: { attempt?: boolean } = {}): Promise<void> {
  const step = lesson.steps[stepIndex]
  if (!step?.check || lesson.runnable === 'not-yet') return
  const key = runKey(lesson.id, step.id)
  if (opts.attempt !== false) useLessonUi.getState().markAttempted(key)
  const results = await runChecksInto(key, [step.check])
  if (!results) return
  if (results.every((r) => r.pass)) {
    tick()
    useLessonProgress.getState().markStepDone(lesson.id, step.id)
  }
}

/**
 * While the coach guides a lesson, re-check the current step after every
 * circuit edit when its check is structural (netlist only — no simulation
 * runs behind the learner's back): the step turns done as soon as the wiring
 * is right. A lesson's own circuit load is not the learner's edit, so its
 * re-check never paints the step red (LS-4). Returns the unsubscribe function.
 */
export function watchStepChecks(delayMs = 450): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsub = useStore.subscribe((s, prev) => {
    if (s.layout === prev.layout) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const coachId = useLessonUi.getState().coachId
      const lesson = coachId ? lessonById(coachId) : undefined
      if (!lesson || lesson.runnable === 'not-yet') return
      const entry = useLessonProgress.getState().lessons[lesson.id]
      const index = clampStep(lesson, entry?.step ?? 0)
      const step = lesson.steps[index]
      if (!step?.check || !isStructural(step.check) || entry?.stepsDone.includes(step.id)) return
      const edited = useStore.getState().layout !== lessonLayout
      // a jumper experiment's check fails while its jumper is in by design: 「尚未完成」, never ✕, until
      // the learner removes it (it passes) or presses 檢查此步驟 themselves
      void runStepCheck(lesson, index, { attempt: edited && !isJumperExperiment(lesson, index) })
    }, delayMs)
  })
  return () => {
    if (timer) clearTimeout(timer)
    unsub()
  }
}

/** How often the running-step watcher looks (ms; reads the stores, never renders). */
export const AUTO_CHECK_POLL_MS = 250
/** A failing automatic check runs again at most this often (s of simulated time). */
export const AUTO_CHECK_RETRY_S = 2
/** …backing off to this while nothing on the board changed (the evaluation is deterministic). */
export const AUTO_CHECK_RETRY_MAX_S = 16

/**
 * Seconds of simulated time a step's check waits for while the simulation
 * runs before it checks itself (LS-F6): max(check.seconds ?? 1, 1) for a
 * measure / uart-contains / firmware-checks check — an 'all' takes its
 * longest such sub-check (its structural parts are instant). null for a
 * check that does not need the run (structural — watchStepChecks re-checks
 * those after each edit — firmware-loaded, ERC).
 */
export function runningCheckDelay(c: LessonCheck): number | null {
  switch (c.kind) {
    case 'measure':
    case 'uart-contains':
      return Math.max(c.seconds ?? 1, 1)
    case 'firmware-checks':
      return 1
    case 'all': {
      let d: number | null = null
      for (const x of c.checks) {
        const v = runningCheckDelay(x)
        if (v !== null) d = Math.max(d ?? 0, v)
      }
      return d
    }
    default:
      return null
  }
}

/**
 * The automatic check the coach is waiting for (LS-F6): the step's run key
 * and the simulated seconds left (the coach's 「模擬執行中，約 n 秒後自動檢查…」);
 * null while none. Changes only when that whole number changes.
 */
export const useAutoCheck = create<{ key: string | null; inSeconds: number | null }>(() => ({ key: null, inSeconds: null }))

/**
 * While the coach shows a step that is not done, whose check needs the run
 * (runningCheckDelay), and the simulation runs, the step checks itself
 * (LS-F6): once the simulated clock has advanced that long since the step
 * was shown or the run started, runStepCheck with attempt: false — a
 * failure never reads ✕, the row stays 「尚未完成」 — and, while it fails,
 * again at most every AUTO_CHECK_RETRY_S of simulated time (backing off
 * while nothing on the board changed), never two at once. Nothing runs while
 * the simulation is stopped. Polls the stores every `pollMs` (no React work
 * per frame); returns the unsubscribe function.
 */
export function watchRunningStepChecks(pollMs = AUTO_CHECK_POLL_MS): () => void {
  let anchor: { key: string; t0: number } | null = null
  let last: { key: string; at: number; wait: number; layout: CircuitLayout; firmware: unknown } | null = null
  let inFlight = false
  let wasRunning = false
  const publish = (key: string | null, inSeconds: number | null) => {
    const cur = useAutoCheck.getState()
    if (cur.key !== key || cur.inSeconds !== inSeconds) useAutoCheck.setState({ key, inSeconds })
  }
  const poll = () => {
    const st = useStore.getState()
    const running = st.running
    const now = st.simTime
    const coachId = useLessonUi.getState().coachId
    const lesson = coachId ? lessonById(coachId) : undefined
    const entry = lesson ? useLessonProgress.getState().lessons[lesson.id] : undefined
    const index = lesson ? clampStep(lesson, entry?.step ?? 0) : 0
    const step = lesson?.steps[index]
    const delay = step?.check && lesson?.runnable !== 'not-yet' ? runningCheckDelay(step.check) : null
    if (!running || !lesson || !step || delay === null || entry?.stepsDone.includes(step.id)) {
      wasRunning = running
      anchor = null
      publish(null, null)
      return
    }
    const key = runKey(lesson.id, step.id)
    // the step was just shown, the run just started, or the clock went back (a reset): count from here
    if (!anchor || anchor.key !== key || !wasRunning || now < anchor.t0) {
      anchor = { key, t0: now }
      last = null
    }
    wasRunning = true
    const firmware = useLab.getState().firmware
    if (last && (last.key !== key || now < last.at)) last = null
    // a failed try is retried every 2 s of simulated time, less often while nothing changed
    const changed = !!last && (last.layout !== st.layout || last.firmware !== firmware)
    const wait = last ? (changed ? AUTO_CHECK_RETRY_S : last.wait) : 0
    const due = last ? last.at + wait : anchor.t0 + delay
    const busy = inFlight || useLessonUi.getState().runs[key]?.status === 'running'
    if (!busy && now >= due) {
      last = { key, at: now, wait: last ? Math.min(AUTO_CHECK_RETRY_MAX_S, changed ? AUTO_CHECK_RETRY_S : wait * 2) : AUTO_CHECK_RETRY_S, layout: st.layout, firmware }
      inFlight = true
      publish(null, null)
      void runStepCheck(lesson, index, { attempt: false }).finally(() => {
        inFlight = false
      })
      return
    }
    publish(busy ? null : key, busy ? null : Math.max(1, Math.ceil(due - now)))
  }
  const id = setInterval(poll, pollMs)
  return () => {
    clearInterval(id)
    publish(null, null)
  }
}

/**
 * The guide follows the board (LS-9 / RV-02): when the circuit is REPLACED
 * (an example, an imported project, undo across the lesson load) or emptied
 * and the guided lesson's own parts are no longer there, the coach stops at
 * once — it never describes parts that are not on the board, never re-checks
 * its step against a foreign circuit and no longer silences the status
 * pill — with a toast that says why. A lesson putting its own circuit on the
 * board is not "another circuit" (loadLessonCircuit restarts the guide
 * itself). Returns the unsubscribe function.
 */
export function watchCircuitChanges(): () => void {
  return useStore.subscribe((s, prev) => {
    if (s.layout === prev.layout || loadingLesson !== null) return
    const coachId = useLessonUi.getState().coachId
    if (!coachId || !circuitReplaced(prev.layout, s.layout)) return
    const lesson = lessonById(coachId)
    // the lesson's own circuit came back (redo, its saved file): the guide goes on
    if (lesson && lessonOnBoard(lesson, s.layout)) return
    stopGuide()
    if (!lesson) return
    const emptied = s.layout.components.length === 0
    showLastingToast(
      emptied
        ? t('Stopped guiding “{title}” — the board was cleared', { title: lesson.title })
        : t('Stopped guiding “{title}” — the board now holds another circuit', { title: lesson.title }),
      4800,
    )
  })
}

/**
 * A toast the learner must get to read: the replacing action usually toasts
 * right after (「已開啟「…」」, 「已收合元件庫…」) and the kit keeps only the
 * newest two, so when later toasts push this one out within its time it is
 * shown once more after the burst. A toast the user dismissed stays gone.
 *
 * Its time counts from the frame that first PAINTS it (afterPaint), not
 * from this call (release QA re-run of LS-9): the replacement that ends the
 * guide holds the main thread right after the store change — the new
 * circuit's meshes, its firmware — for seconds on a slow machine, so the
 * toast reaches the screen only when that work ends, and the burst right
 * behind it must not then take it away after ~0.1 s because "4.8 s" passed
 * on the wall clock while nothing was drawn.
 */
function showLastingToast(text: string, duration: number): void {
  const id = showToast(text, { duration })
  /** Date.now() of the first frame that showed the toast; null = not painted yet */
  let paintedAt: number | null = null
  let unsub: (() => void) | null = null
  let done = false
  const finish = () => {
    done = true
    unsub?.()
    unsub = null
  }
  unsub = subscribeToasts((queue) => {
    if (done || queue.some((x) => x.id === id)) return
    // evicted = newer toasts filled the queue; anything else is a dismissal
    const evicted = queue.length > 0 && queue.every((x) => x.id > id)
    finish()
    const onScreen = paintedAt === null ? 0 : Date.now() - paintedAt
    if (!evicted || onScreen > duration - 600) return
    setTimeout(() => showToast(text, { duration: Math.max(2400, duration - onScreen) }), 450)
  })
  if (done) unsub?.()
  afterPaint(() => {
    if (done) return
    paintedAt = Date.now()
    setTimeout(finish, duration)
  })
}

/**
 * Run `fn` once the current work has been painted: two animation frames
 * (the first one runs after whatever task holds the main thread, the second
 * after the frame that committed and drew the toast); a macrotask where
 * there are no frames (Node tests).
 */
function afterPaint(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(fn))
  else setTimeout(fn, 0)
}
