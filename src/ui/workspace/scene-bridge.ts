/**
 * Scene bridge (UX wave contract K4 — SC-1 / SH-4). Module-level, no React:
 * the one way UI code outside App.tsx points the 3D view at something.
 *
 *   registerScene(scene | null)   App.tsx, right after scene.mount / in cleanup
 *   focusInScene(spec, opts?)     frame + (kind 'problem') pulse the problem layer
 *   clearSceneFocus(kind?)        drop the problem highlight early
 *   frameCircuit()                frame the whole circuit (scene.frameContent)
 *   frameTargets(spec, opts?)     frame only (H7) — e.g. a wiring step from ≥ 60°
 *   highlightSource(spec | null)  hover-only neutral marker, no camera move (H7)
 *   partsBrowsing(open)           the phone's Parts sheet is open (SC-16 paddles)
 *   partsSheetCover(px)           how much of the screen's bottom that sheet covers (SC-F1)
 *   problemLevelSupported(level)  can the scene draw this problem tint (H7)?
 *
 * Touch framing on arming (release QA SC-F1): with a coarse pointer and the
 * new chrome, arming a part (mode 'place') or the wire tool while a hole
 * pitch at the board centre projects under TOUCH_PITCH_MIN_PX frames the
 * working area — the selected parts' holes, else the circuit, else the
 * centre third of an empty board (armFramingSpec) — above the Parts sheet's
 * peek / the wire-colour strip, so a pitch reads ≥ TOUCH_PITCH_TARGET_PX
 * (frameTargets minPitchPx / coverBottomPx). Once per arming (a pinch
 * afterwards wins), and never over a framing someone asked for meanwhile
 * (the lesson coach's 「開始接線」 frames its step two frames later); one
 * toast per session says how to zoom. A store
 * subscription installed with the first registered scene; the desktop
 * (fine pointer) and the classic chrome never frame. The wire tool armed
 * while the lesson coach guides a wiring step (setArmFocusSource — the
 * lessons module registers it) frames that step's targets with the step's
 * own framing instead, the view 「開始接線」 gives: the whole circuit cut
 * down to 14 px about its centre would push the step's far end off a
 * portrait phone (release-check SC-9: e36 / e40 of i1 / i4 at x ≈ 470 on a
 * 390-px screen after 對準電路 → 導線).
 *
 * focusInScene kinds:
 *  - 'guide' (default): only frames the targets (scene.frameTargets). The
 *    lesson coach keeps owning its own highlight layer (setHighlights).
 *  - 'problem': frames the targets AND shows them on the scene's separate
 *    problem layer (setProblemHighlights, red for 'error', amber for 'risk',
 *    blue for 'info') for `holdMs` (default 6000; ≤ 0 or Infinity = until
 *    cleared). The next 'problem' call replaces it. Level 'info' is drawn
 *    only by a scene that declares it (IBreadboardScene.problemHighlightLevels,
 *    SC-11); until then an 'info' focus frames like 'guide' and marks
 *    nothing (never a hint painted red).
 *  - `includeHoles` (UX fix wave H7): extra holes kept INSIDE the frame but
 *    not marked — the fix target next to the problem (the nearest − rail
 *    hole beside an open LED lead).
 *  - `minElevationDeg` is forwarded to scene.frameTargets (a scene that does
 *    not know it ignores it).
 *
 * Every scene method used here is OPTIONAL in IBreadboardScene: a scene
 * without it (or no registered scene at all) makes the call a safe no-op —
 * focusInScene then returns false. Unknown refs / ids are the scene's to
 * skip. Calls are event-driven (clicks, hovers, step changes): nothing here
 * runs per frame, and no camera math happens on the React side.
 */
import type {
  FrameTargetsOptions,
  HighlightSpec,
  IBreadboardScene,
  ProblemHighlightLevel,
  ProblemHighlightSpec,
} from '../../three/scene-api'
import type { CircuitLayout } from '../../model/types'
import { BOARD_SIZES, boardConfigOf } from '../../model/types'
import { getEntry } from '../../model/catalog'
import { componentPinHoles, formatHole, parseHole } from '../../model/breadboard'
import { useStore } from '../../state/store'
import { t } from '../../i18n'
import { showToast } from '../kit/toasts'
import { isLegacyChrome } from '../chrome/legacy'
import { growPaddleText, objectChipText } from './hole-chip'
import { moveWireEndTo, wireEndAccepted } from './wire-ends'
import {
  drawWire,
  wireDrawAccepted,
  wireDrawHint,
  wireDrawTooSmall,
  wireDrawLanding,
  wireDrawStart,
  wireDrawStartText,
  wireDrawStarted,
  wireGripText,
} from './wire-draw'

/**
 * The scene methods the bridge drives (all optional). `setCallbacks` (merge)
 * lets registerScene install the workspace's own scene text providers.
 */
export type BridgeScene = Pick<IBreadboardScene, 'frameContent' | 'frameTargets' | 'setProblemHighlights'> &
  Partial<Pick<IBreadboardScene, 'setCallbacks' | 'setSourceHighlight' | 'problemHighlightLevels' | 'setPartsBrowsing' | 'holePitchPx'>>

export type SceneFocusKind = 'guide' | 'problem'

export interface SceneFocusOptions {
  /** 'guide' (default) frames only; 'problem' also pulses the problem layer */
  kind?: SceneFocusKind
  /** problem layer tint (kind 'problem'; default 'error') — 'info' needs a scene that draws it */
  level?: ProblemHighlightLevel
  /** move the camera to the targets (default true) */
  frame?: boolean
  /** problem highlight lifetime in ms (default 6000; ≤ 0 or Infinity = until cleared) */
  holdMs?: number
  /** forwarded to scene.frameTargets */
  minSpanHoles?: number
  /** forwarded to scene.frameTargets: frame from at least this elevation (degrees) */
  minElevationDeg?: number
  /** forwarded to scene.frameTargets: a hole pitch reads at least this many CSS px (SC-F1) */
  minPitchPx?: number
  /** forwarded to scene.frameTargets: CSS px of the canvas bottom chrome covers for this framing (SC-F1) */
  coverBottomPx?: number
  /** holes kept inside the frame but not marked (a fix target beside the problem) */
  includeHoles?: readonly string[]
}

export const DEFAULT_PROBLEM_HOLD_MS = 6000

let scene: BridgeScene | null = null
let problem: ProblemHighlightSpec | null = null
let problemTimer: ReturnType<typeof setTimeout> | null = null
let source: HighlightSpec | null = null
let browsing = false
/** the phone Parts sheet's resting height (partsSheetCover, SC-F1) */
let partsCover = 0
/** every camera framing asked of the bridge (focusInScene with frame) — an arming yields to one made meanwhile */
let framingSeq = 0
/** the arming watch (SC-F1): its store unsubscribe, the latest arming, the once-per-session toast */
let armWatch: (() => void) | null = null
let armSeq = 0
let zoomToastShown = false
/** what the lesson coach guides the learner to wire (setArmFocusSource) */
let armFocusSource: (() => ArmFocus | null) | null = null

function stopTimer(): void {
  if (problemTimer !== null) clearTimeout(problemTimer)
  problemTimer = null
}

function call(run: (s: BridgeScene) => void): void {
  const s = scene
  if (!s) return
  try {
    run(s)
  } catch (err) {
    // a scene bug must never break the button that asked for the focus
    console.error('scene bridge call failed', err)
  }
}

/** Distinct non-empty strings. */
function clean(list: readonly string[] | undefined): string[] {
  if (!list) return []
  const out: string[] = []
  for (const v of list) if (typeof v === 'string' && v !== '' && !out.includes(v)) out.push(v)
  return out
}

/** frameTargets options with only the members that are set (exact calls for tests and scenes). */
function frameOpts(o: FrameTargetsOptions): FrameTargetsOptions | undefined {
  const out: FrameTargetsOptions = {}
  if (o.minSpanHoles !== undefined) out.minSpanHoles = o.minSpanHoles
  if (o.minElevationDeg !== undefined) out.minElevationDeg = o.minElevationDeg
  if (o.minPitchPx !== undefined) out.minPitchPx = o.minPitchPx
  if (o.coverBottomPx !== undefined) out.coverBottomPx = o.coverBottomPx
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * App.tsx: the mounted scene (null on unmount — drops any pending problem
 * highlight). Also installs the workspace's scene providers — the "+"
 * grow paddle's hover chip (SC-8), the neutral part-body chip (SC-12), the
 * wire end handles' re-route (SC-13, wire-ends.ts) and drag-to-wire (round
 * 5, wire-draw.ts); the scene uses them with docked chrome only.
 */
export function registerScene(next: BridgeScene | null): void {
  if (next === scene) return
  stopTimer()
  problem = null
  source = null
  scene = next
  if (next) watchArming()
  if (browsing) call((s) => s.setPartsBrowsing?.(true))
  call((s) =>
    s.setCallbacks?.({
      growPaddleLabel: growPaddleText,
      objectLabelText: objectChipText,
      onWireEndPreview: wireEndAccepted,
      onWireEndMove: moveWireEndTo,
      wireDrawStart,
      onWireDrawStarted: wireDrawStarted,
      onWireDrawPreview: wireDrawAccepted,
      onWireDraw: drawWire,
    }),
  )
  // drag-to-wire polish (a leg lands on its strip's free hole, the chips'
  // words, the one-time tip) — a second, additive install
  call((s) =>
    s.setCallbacks?.({
      wireDrawLanding,
      wireDrawStartText,
      wireGripText,
      onWireDrawHint: wireDrawHint,
      onWireDrawTooSmall: wireDrawTooSmall,
    }),
  )
}

/** Is a scene registered (tests / callers that want to explain a no-op)? */
export function sceneRegistered(): boolean {
  return scene !== null
}

/**
 * Can the registered scene draw problem-layer `level`? 'error' / 'risk'
 * always (SC-1); 'info' only when the scene lists it (SC-11). False without
 * a scene.
 */
export function problemLevelSupported(level: ProblemHighlightLevel): boolean {
  if (!scene) return false
  if (level !== 'info') return true
  return scene.problemHighlightLevels?.includes('info') === true
}

/**
 * Point the 3D view at `spec` (holes / terminals / component or wire ids).
 * Returns false when nothing could happen (no scene, or nothing named).
 */
export function focusInScene(spec: HighlightSpec, opts: SceneFocusOptions = {}): boolean {
  const holes = clean(spec.holes)
  const components = clean(spec.components)
  if (!scene || (holes.length === 0 && components.length === 0)) return false
  const target: HighlightSpec = { holes, components }
  if (opts.frame !== false) {
    framingSeq++
    const extra = clean(opts.includeHoles).filter((h) => !holes.includes(h))
    const framed: HighlightSpec = extra.length > 0 ? { holes: [...holes, ...extra], components } : target
    const fo = frameOpts(opts)
    call((s) => s.frameTargets?.(framed, fo))
  }
  const level = opts.level ?? 'error'
  if (opts.kind === 'problem' && problemLevelSupported(level)) {
    stopTimer()
    const spec2: ProblemHighlightSpec = { ...target, level }
    problem = spec2
    call((s) => s.setProblemHighlights?.(spec2))
    const hold = opts.holdMs ?? DEFAULT_PROBLEM_HOLD_MS
    if (Number.isFinite(hold) && hold > 0) {
      problemTimer = setTimeout(() => {
        problemTimer = null
        if (problem !== spec2) return
        problem = null
        call((s) => s.setProblemHighlights?.(null))
      }, hold)
    }
  }
  return true
}

/**
 * Clear what focusInScene showed: the problem layer for kind 'problem' or
 * no kind. ('guide' only moves the camera — there is nothing to clear.)
 */
export function clearSceneFocus(kind?: SceneFocusKind): void {
  if (kind === 'guide') return
  stopTimer()
  if (problem === null) return
  problem = null
  call((s) => s.setProblemHighlights?.(null))
}

/** The problem highlight currently shown (null = none). */
export function activeProblemFocus(): ProblemHighlightSpec | null {
  return problem
}

/** Frame the whole circuit (F key, "對準電路"); the home framing on an empty board. */
export function frameCircuit(): void {
  call((s) => s.frameContent?.())
}

/**
 * Frame `spec` without marking anything (UX helper H7): the lesson coach's
 * wiring steps ({ minElevationDeg: 60 }, LS-11) and observation steps
 * re-framed after a panel resize (LS-12). Returns false without a scene or
 * targets.
 */
export function frameTargets(spec: HighlightSpec, opts: FrameTargetsOptions = {}): boolean {
  return focusInScene(spec, { kind: 'guide', ...opts })
}

/**
 * Hover-only neutral marker on what a control points at (UX helper H7 —
 * an LA channel label, a pin row, a problem chip): rings + a thin outline,
 * no camera move; `null` clears it. Returns whether a scene took it (false
 * without a scene or before SC-11 implements setSourceHighlight — a safe
 * no-op).
 */
export function highlightSource(spec: HighlightSpec | null): boolean {
  if (!scene?.setSourceHighlight) {
    source = null
    return false
  }
  const holes = clean(spec?.holes)
  const components = clean(spec?.components)
  const next = holes.length > 0 || components.length > 0 ? { holes, components } : null
  if (next === null && source === null) return true
  source = next
  call((s) => s.setSourceHighlight?.(next))
  return true
}

/** The hover marker currently shown (null = none). */
export function activeSourceHighlight(): HighlightSpec | null {
  return source
}

/**
 * The phone's Parts sheet opened / closed (SC-16): with a finger the scene
 * shows its grow paddles while the parts library is open (or a part is
 * armed). Remembered for a scene registered later; repeated values no-op.
 */
export function partsBrowsing(open: boolean): void {
  if (open === browsing) return
  browsing = open
  call((s) => s.setPartsBrowsing?.(open))
}

/**
 * The phone's Parts sheet's resting height (SC-F1): CSS px of the screen's
 * bottom it covers at its current snap — the peek a tapped card drops it to
 * is below the shell's sheet-cover threshold, so the view insets do not
 * know it. 0 when closed (and on a desktop panel). Remembered for the next
 * arming, not acted on.
 */
export function partsSheetCover(px: number): void {
  partsCover = Number.isFinite(px) && px > 0 ? Math.round(px) : 0
}

// ---------------------------------------------------------------------------
// touch framing on arming (release QA SC-F1)
// ---------------------------------------------------------------------------

/** Below this projected hole pitch (CSS px) at the board centre, an arming on a touch screen frames the working area. */
export const TOUCH_PITCH_MIN_PX = 12
/** …so that a hole pitch reads at least this big (a finger tells the holes apart). */
export const TOUCH_PITCH_TARGET_PX = 14
/** The framing's narrowest span (hole pitches): a part and its neighbours, not a lone hole. */
export const TOUCH_FRAME_MIN_SPAN = 16
/** Frames to wait after an arming: a lesson step's own framing (two frames later) lands first and wins. */
const ARM_FRAME_DELAY = 3
/** Air between the framed area and the chrome resting over the bottom (CSS px). */
const COVER_GAP_PX = 8

function coarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

function afterFrames(n: number, run: () => void): void {
  if (n <= 0 || typeof requestAnimationFrame !== 'function') {
    run()
    return
  }
  requestAnimationFrame(() => afterFrames(n - 1, run))
}

/** The rail hole index nearest strip column `col` (rail x = 2.5 + i + ⌊i / 5⌋). */
function railIndexNear(col: number, railHoles: number): number {
  let best = 0
  let bestD = Infinity
  const guess = Math.round(((col - 2.5) * 5) / 6)
  for (let i = Math.max(0, guess - 2); i <= Math.min(railHoles - 1, guess + 2); i++) {
    const d = Math.abs(2.5 + i + Math.floor(i / 5) - col)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * What an arming on a touch screen frames (SC-F1): the selected parts'
 * holes (a selected wire: its ends; an off-board part: its body), else the
 * whole circuit (every part and wire), else — an empty board — the centre
 * third of the front board-row's length, rail to rail. Pure of its inputs.
 * `board` (arming a part that goes INTO the board — persona fix): off-board
 * instruments and the wires that reach them are left out, so a lone supply
 * beside an empty board never takes the framing from the holes the part
 * goes in (a circuit of only off-board parts frames as an empty board).
 */
export function armFramingSpec(layout: CircuitLayout, selection: readonly string[], opts: { board?: boolean } = {}): HighlightSpec {
  const config = boardConfigOf(layout)
  const board = opts.board === true
  const offBoard = (type: string): boolean => getEntry(type)?.placement === 'offboard'
  const onBoardWire = (w: { from: string; to: string }): boolean => !!parseHole(w.from) && !!parseHole(w.to)
  const holes: string[] = []
  const components: string[] = []
  for (const id of selection) {
    const comp = layout.components.find((c) => c.id === id)
    if (comp) {
      if (board && offBoard(comp.type)) continue
      const entry = getEntry(comp.type)
      const pins = entry ? componentPinHoles(comp, entry, config) : null
      const refs = (pins ?? []).flatMap((h) => (h ? [formatHole(h)] : []))
      if (refs.length > 0) holes.push(...refs)
      else components.push(id)
      continue
    }
    const wire = layout.wires.find((w) => w.id === id)
    if (wire && (!board || onBoardWire(wire))) holes.push(wire.from, wire.to)
  }
  if (holes.length > 0 || components.length > 0) return { holes, components }
  const all = [
    ...layout.components.filter((c) => !board || !offBoard(c.type)).map((c) => c.id),
    ...layout.wires.filter((w) => !board || onBoardWire(w)).map((w) => w.id),
  ]
  if (all.length > 0) return { holes: [], components: all }
  const size = BOARD_SIZES[config.size]
  const cols = size.cols * config.count
  const c0 = Math.max(1, Math.round(cols / 3) + 1)
  const c1 = Math.max(c0, Math.round((2 * cols) / 3))
  const rails = size.railHoles * config.count
  return {
    holes: [`a${c0}`, `j${c1}`, `top+${railIndexNear(c0, rails)}`, `bot+${railIndexNear(c1, rails)}`],
    components: [],
  }
}

/** CSS px of the screen's bottom the chrome covers while armed: the Parts sheet's peek, the wire-colour strip. */
function bottomCover(): number {
  let px = partsCover
  if (typeof document !== 'undefined' && typeof window !== 'undefined' && typeof document.querySelector === 'function') {
    const strip = document.querySelector<HTMLElement>('.app-wire-strip')
    // the strip's layout box (its rise-in animation transforms it): fixed → offsetTop counts from the viewport top
    if (strip && strip.offsetHeight > 0) px = Math.max(px, window.innerHeight - strip.offsetTop)
  }
  return px > 0 ? px + COVER_GAP_PX : 0
}

/**
 * A guided wiring step's targets and the step's own framing (the lesson
 * coach's focusStep: at least `minSpanHoles` across, from `minElevationDeg`).
 */
export interface ArmFocus {
  spec: HighlightSpec
  minSpanHoles?: number
  minElevationDeg?: number
}

/**
 * The lessons module: what the coach is guiding the learner to wire right
 * now (null = no wiring step guided). The touch arming of the wire tool
 * frames it instead of the whole circuit — both ends of the step's wire stay
 * on the phone's screen, as after 「開始接線」. Null unregisters.
 */
export function setArmFocusSource(source: (() => ArmFocus | null) | null): void {
  armFocusSource = source
}

/** The registered source's answer, when it names something (a broken source frames the circuit). */
function guidedArmFocus(): ArmFocus | null {
  let f: ArmFocus | null = null
  try {
    f = armFocusSource?.() ?? null
  } catch {
    f = null
  }
  if (!f) return null
  const holes = clean(f.spec.holes)
  const components = clean(f.spec.components)
  return holes.length > 0 || components.length > 0 ? { ...f, spec: { holes, components } } : null
}

/** A place arming of a part that goes into the board (not an off-board instrument). */
function placesOnBoard(mode: { kind: string; type?: string }): boolean {
  if (mode.kind !== 'place' || typeof mode.type !== 'string') return false
  const entry = getEntry(mode.type)
  return !!entry && entry.placement !== 'offboard'
}

function frameArming(kind: 'place' | 'wire'): void {
  const st = useStore.getState()
  const s = scene
  if (st.mode.kind !== kind || !s?.holePitchPx || isLegacyChrome() || !coarsePointer()) return
  let pitch: number | null = null
  try {
    pitch = s.holePitchPx() ?? null
  } catch {
    pitch = null
  }
  if (pitch === null || !Number.isFinite(pitch) || pitch >= TOUCH_PITCH_MIN_PX) return
  const cover = bottomCover()
  const guided = kind === 'wire' ? guidedArmFocus() : null
  // a guided wiring step: its own framing above the wire strip — never cut down
  // about its centre (minPitchPx), which could drop either end of its wire
  const ok = guided
    ? frameTargets(guided.spec, {
        minSpanHoles: Math.max(TOUCH_FRAME_MIN_SPAN, guided.minSpanHoles ?? 0),
        ...(guided.minElevationDeg !== undefined ? { minElevationDeg: guided.minElevationDeg } : {}),
        ...(cover > 0 ? { coverBottomPx: cover } : {}),
      })
    : frameTargets(armFramingSpec(st.layout, st.selection, { board: placesOnBoard(st.mode) }), {
        minSpanHoles: TOUCH_FRAME_MIN_SPAN,
        minPitchPx: TOUCH_PITCH_TARGET_PX,
        ...(cover > 0 ? { coverBottomPx: cover } : {}),
      })
  if (!ok || zoomToastShown) return
  zoomToastShown = true
  showToast(t('Zoomed in on the breadboard — pinch to zoom again'), { duration: 3200 })
}

/** Install the arming watch once (registerScene): place / wire armed from another mode. */
function watchArming(): void {
  if (armWatch) return
  armWatch = useStore.subscribe((s, prev) => {
    const kind = s.mode.kind
    if (kind === prev.mode.kind || (kind !== 'place' && kind !== 'wire')) return
    const seq = ++armSeq
    const framedBefore = framingSeq
    afterFrames(ARM_FRAME_DELAY, () => {
      if (seq === armSeq && framingSeq === framedBefore) frameArming(kind)
    })
  })
}

/** Tests: forget the session's zoom toast, the remembered sheet cover and any pending arming. */
export function __resetArmFramingForTests(): void {
  zoomToastShown = false
  partsCover = 0
  armSeq++
}
