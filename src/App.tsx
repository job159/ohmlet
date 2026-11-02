/**
 * App shell — phone-first "liquid glass" chrome over the full-bleed 3D canvas
 * (DESIGN.md §2). Owns the single BreadboardScene instance and all of the
 * scene↔store glue (placement-by-clicks, DIP ghost, off-board immediate
 * placement, repeat placement, two-click wiring, hover ghost, selection),
 * plus the chrome state machine: StatusBar capsule (run/pause/reset), bottom
 * Dock (Parts · Wire · AI · Scope · More) opening their sheets, the
 * WireColorStrip while wire mode is armed, placement/wire hints as toasts,
 * the EmptyState card, first-launch Onboarding, and the long-press component
 * ActionSheet. Desktop ≥900px: the dock becomes a left rail and the sheets
 * become floating panels (Sheet panel mode).
 *
 * Embedded workspace (desktop ≥1100px + fine pointer, lab.workspace.enabled
 * — src/ui/workspace): Library panel left, Inspector right, instrument tray
 * bottom, floating over the full-bleed canvas. While it is on, the rail's
 * Parts tab drives the Library panel, Scope drives the tray, and the
 * inspector replaces the floating Properties sheet; AI / More keep their
 * right-hand panels. The scene gets pin-name hover labels (holeLabelText)
 * and object hover (inspector hint) through additive callbacks.
 *
 * UX wave (docs/ux/UX_REVIEW.md §5–6; everything but the classic chrome —
 * isLegacyChrome(), English without the workspace, which renders exactly as
 * before): the capsule is an explicit run control (Space / tap = toggleRun,
 * which also resumes a debugger halt), the status pill under it says what is
 * wrong or what to do next (problems store K3, mounted watcher), the first
 * run and the empty board lead into lessons / examples, the dock reads
 * 元件 · 導線 · 課程 · 儀器 · 更多 (AI moved into More), placement / wire
 * hints say how to get out, a refused drop says why, new wires take the
 * conventional colour until a swatch is picked, and the keyboard gains
 * F5 / F10 / Shift+F5 (debugger), F (frame), Ctrl/Cmd+S (save) and ? (the
 * shortcuts list). Scene contracts wired here (SH-4): the scene bridge
 * (K4), hover chips (K5), the probe menu (K6, workspace), 3D press-and-hold
 * of buttons (SC-6) and the view insets — the floating lesson coach (K8)
 * and a resting phone sheet push the framing out from under them.
 *
 * Release QA (new chrome only): a wire start that can never be completed is
 * never stored (SH-F1 — a part pin's hole moves the start to its strip's
 * free hole, anything else is refused at once), a refused leads hole says
 * why (SH-F6), undo / redo / Delete name what changed and the 「這裡不能接」
 * toast leaves with wire mode (SH-F9) — decisions in ui/chrome/edit-feedback.ts.
 *
 * Operation simplification (product owner, new chrome only): there is no
 * wire colour to pick — the scene draws every wire in its net's role colour
 * (contract C1, ui/wire-roles.ts: supply red, ground black, signals by
 * function; pushWireColors on every layout change, setWireColorOverride) and
 * a new wire is stored with it; deleting never asks first (the long-press
 * 「刪除」, the Delete key, the inspector, the selection pill and 清空麵包板
 * act at once, their toast carries 〔復原〕).
 *
 * UI chrome state (which sheet is open, onboarding…) lives HERE in React
 * state — never in the store.
 */
import { useEffect, useRef, useState } from 'react'
import type { AppState, GrowDirection, MoveTarget } from './state/types'
import { boardConfigOf, STRIP_ROWS } from './model/types'
import type { HoleRef, Rotation } from './model/types'
import { formatHole, parseHole } from './model/breadboard'
import { placementValid, setLayoutLoadedSink, setTelemetrySink, useStore, wireRefusal } from './state/store'
import { getEntry } from './model/catalog'
import { occludedHoles } from './model/occlusion'
import { validateLayout } from './model/validate'
import { BreadboardScene } from './three/scene'
import type { RenderProgress, SceneCallbacks } from './three/scene-api'
import type { RenderModeId } from './three/render-modes/capability'
import {
  ActionSheet,
  BookIcon,
  ChipIcon,
  Dock,
  EllipsisIcon,
  SparklesIcon,
  ToastHost,
  WaveformIcon,
  WireIcon,
  dismissToast,
  setPointerFocusRelease,
  sheetCoverHeight,
  showToast,
  subscribeSheetCover,
  tick,
  useIsDesktop,
  type ActionSheetAction,
  type DockItem,
} from './ui/kit'
import { EmptyState, Onboarding, StatusBar, WireColorStrip, hintForMode, markOnboarded, needsOnboarding, pushRenderProgress } from './ui/chrome'
import { FlowToggle } from './ui/chrome/FlowToggle'
import { StatusPill, pillProblem } from './ui/chrome/StatusPill'
import { ShortcutsSheet } from './ui/chrome/ShortcutsSheet'
import { isLegacyChrome, isWorkspaceShowing, useLegacyChrome } from './ui/chrome/legacy'
import { haltedMcuIds, mcuIdsInLayout, runOrResume, targetMcuId } from './ui/chrome/run-control'
import { toggleRunWithFeedback } from './ui/chrome/run-feedback'
import { useInstrumentRequest } from './ui/chrome/instrument-sheet'
import {
  blockingModalOpen,
  cycleFocusRegion,
  debugKeyAction,
  describeKeyTarget,
  installFocusModality,
  lastActionInside,
  releasePointerFocus,
  routeGlobalKey,
  type DebugKey,
} from './ui/chrome/keys'
import {
  anchorRowOf,
  packageOverflow,
  placedAgainHint,
  placementRefusedHint,
  placementSpotRefusedHint,
  wireConnectedHint,
  wireRefusedHint,
  wireStartHint,
  type ArmedFrom,
  type RefusalWhere,
} from './ui/chrome/hints'
import {
  deletedToast,
  dismissWireRefusalToast,
  editCue,
  placementSpotReason,
  redoWithFeedback,
  refusalConcernsFrom,
  removeSelectedWithFeedback,
  showWireRefusalToast,
  undoWithFeedback,
  wireStartCheck,
} from './ui/chrome/edit-feedback'
import { conventionWireColor, resetWireColorPick, wireColorPicked } from './ui/chrome/wire-convention'
import { wireRoleColors, wireRoleOf } from './ui/wire-roles'
import { UndoPill } from './ui/chrome/UndoPill'
import { SelectionPill } from './ui/chrome/SelectionPill'
import { RotateButton } from './ui/chrome/RotateButton'
import { PartsSheet, showPartsSheetSegment } from './ui/sheets/PartsSheet'
import { AiSheet } from './ui/sheets/AiSheet'
import { ScopeSheet } from './ui/sheets/ScopeSheet'
import { MoreSheet, saveProjectFile } from './ui/sheets/MoreSheet'
import { PropertiesSheet } from './ui/sheets/PropertiesSheet'
import { Workspace } from './ui/workspace/Workspace'
import { LessonOverlay } from './ui/lessons/LessonOverlay'
import { computeGeometry, setHoveredObject, useWorkspaceActive } from './ui/workspace/state'
import { holeLabelFor } from './ui/workspace/hole-labels'
import { holeChipText } from './ui/workspace/hole-chip'
import { frameCircuit, registerScene } from './ui/workspace/scene-bridge'
import { CelebrationOverlay } from './ui/fx/CelebrationOverlay'
import { applyFlowChrome } from './ui/fx/flow'
import { openProbeMenu } from './ui/workspace/ProbeMenu'
import { useLab } from './ui/embedded/lab'
import { startProblemsWatcher, useProblems } from './ui/embedded/problems'
import { bindLatchScene, latchPart, latchSheetItem, pressMomentary } from './ui/embedded/latch'
import { useLessonUi } from './ui/lessons/state'
import { openLessons, startFirstLesson } from './ui/lessons/actions'
import { PerfOverlay } from './ui/perf/PerfOverlay'
import { t, useLang } from './i18n'
import { partLabel } from './i18n/parts'
import { tMessage } from './i18n/messages'
import './app.css'

// a mouse / touch click on a kit control leaves no focus behind, so Space
// stays run / pause (SH-9) — the new chrome only; the classic chrome keeps
// its pre-wave focus behaviour (SH-10)
setPointerFocusRelease(() => !isLegacyChrome())

// ---------------------------------------------------------------------------
// Scene ↔ store glue (pure functions of the store state, no React state)
// ---------------------------------------------------------------------------

/** Keep the ghost footprint and wire-drawing preview in sync with the store. */
function syncOverlays(scene: BreadboardScene, s: AppState): void {
  const mode = s.mode

  if (mode.kind === 'place' && s.hoverHole) {
    const entry = getEntry(mode.type)
    if (entry && entry.placement !== 'offboard') {
      scene.setGhost({
        type: mode.type,
        at: s.hoverHole,
        // rotation-aware (R key cycles mode.rotation for dip/footprint parts)
        valid: placementValid(s.layout, mode.type, s.hoverHole, mode.pickedHoles, mode.rotation),
        // already-picked holes → the scene shows the FULL routed holographic
        // part stretching first-hole → hover for 2-lead leaded parts
        picked: mode.pickedHoles,
        // the hologram renders AT the armed rotation (R / rotate button spins it)
        rotation: mode.rotation,
      })
    } else {
      scene.setGhost(null)
    }
  } else {
    scene.setGhost(null)
  }

  if (mode.kind === 'wire' && mode.from) scene.setWirePreview(mode.from, s.hoverHole)
  else scene.setWirePreview(null, null)
}

/**
 * Wire-mode click on any endpoint (hole or off-board terminal). New chrome
 * (operation simplification, contract C1): no swatch to pick — the
 * committed wire is stored with its net's role colour (wire-roles.ts) on the
 * layout it joins, the colour the scene draws it in.
 *
 * New chrome (release QA SH-F1): a start that can never be completed is
 * never stored — a part pin's hole moves the start to the free hole of the
 * same strip nearest the click (the mode hint says so: 「c21 被 U1 PA4
 * 佔用，已改從同一排的 a21 拉線」), any other impossible start is refused at
 * once with no start kept; a refused second click whose problem is the
 * started end itself drops that start. The classic chrome keeps the
 * original behaviour.
 */
function wireEndpointClick(endpoint: string): void {
  const st = useStore.getState()
  if (st.mode.kind !== 'wire') return
  const { from } = st.mode
  const legacy = isLegacyChrome()
  const auto = !wireColorPicked() && !legacy
  // product chrome (contract C1): no colour to pick — a wire is stored with
  // the colour of its net's role (the scene shows the role colours anyway;
  // the stored one is what an export / the classic chrome shows)
  if (!legacy && from) {
    const color = roleColorOfNewWire(st.layout, from, endpoint)
    const before = st.layout.wires.length
    const refusal = wireRefusal(st.layout, from, endpoint)
    st.addWire(from, endpoint, color)
    const after = useStore.getState().layout
    if (after.wires.length > before) {
      tick() // wire complete (DESIGN.md §1 Haptics)
      editCue('wire') // …and a quiet sound cue (product chrome, 音效 on)
      dismissWireRefusalToast() // the re-aim worked
      wireConnectedText = wireConnectedHint(after, from, endpoint)
      st.setMode({ kind: 'wire', from: null, color }) // done — ready for the next wire
      return
    }
    if (refusal) {
      showWireRefusalToast(wireRefusedHint(refusal, after))
      if (refusalConcernsFrom(refusal, from)) st.setMode({ kind: 'wire', from: null, color: st.mode.color })
    }
    return
  }
  if (!from) {
    let start = endpoint
    if (!legacy) {
      const check = wireStartCheck(st.layout, endpoint)
      if (check.kind === 'refuse') {
        showWireRefusalToast(wireStartHint(check, st.layout) ?? wireRefusedHint(check.refusal, st.layout))
        return // no start: the next click starts the wire
      }
      if (check.kind === 'redirect') {
        start = check.from
        wireStartText = wireStartHint(check, st.layout) // the mode hint says where the wire starts
      }
      dismissWireRefusalToast() // a good start answers the last refusal
    }
    const color = auto ? conventionWireColor(st.layout, [start]) : st.mode.color
    st.setMode({ kind: 'wire', from: start, color })
    return
  }
  const color = auto ? conventionWireColor(st.layout, [from, endpoint]) : st.mode.color
  const before = st.layout.wires.length
  const refusal = wireRefusal(st.layout, from, endpoint)
  st.addWire(from, endpoint, color)
  const after = useStore.getState().layout
  if (after.wires.length > before) {
    tick() // wire complete (DESIGN.md §1 Haptics)
    editCue('wire') // product chrome only (the classic chrome stays silent)
    dismissWireRefusalToast() // the re-aim worked
    // new chrome (SH-12): the mode hint toast confirms it, both ends named
    if (!legacy) wireConnectedText = wireConnectedHint(after, from, endpoint)
    st.setMode({ kind: 'wire', from: null, color }) // done — ready for the next wire
    return
  }
  // refused (occupied/duplicate/self): keep `from` so the user can re-aim —
  // and (new chrome) say why, replacing the previous refusal; a problem with
  // the started end itself (SH-F1) drops the start instead
  if (refusal && !legacy) {
    showWireRefusalToast(wireRefusedHint(refusal, after))
    if (refusalConcernsFrom(refusal, from)) st.setMode({ kind: 'wire', from: null, color: st.mode.color })
  }
}

/** The role colour (C1) a wire from → to would take once added to `layout`. */
function roleColorOfNewWire(layout: AppState['layout'], from: string, to: string): string {
  const probe = { id: '__new_wire__', from, to }
  return wireRoleOf({ ...layout, wires: [...layout.wires, probe] }, probe.id).color
}

/**
 * Contract C1: the scene draws the product chrome's wires in their net's
 * role colour (src/ui/wire-roles.ts); the classic chrome keeps the stored
 * colours. Called on a layout change and a chrome switch — never per frame.
 */
function pushWireColors(scene: BreadboardScene, layout: AppState['layout']): void {
  scene.setWireColorOverride(isLegacyChrome() ? null : wireRoleColors(layout))
}

/** A wire was just committed: the next mode hint confirms it (SH-12). */
let wireConnectedText: string | null = null
/** A wire start just moved to a free hole: the next mode hint says so (SH-F1). */
let wireStartText: string | null = null

/** Is `id` a placed dip/footprint package (the only parts rotatePlaced accepts)? */
function isRotatableComponent(st: AppState, id: string): boolean {
  const comp = st.layout.components.find((c) => c.id === id)
  const entry = comp ? getEntry(comp.type) : undefined
  return !!entry && (entry.placement === 'dip' || entry.placement === 'footprint')
}

/**
 * Rotate a placed package via the store (one undo step) with user feedback:
 * haptic tick on success, teaching toast when no other rotation fits. Shared
 * by the long-press ActionSheet "Rotate" row and the R key in select mode.
 */
function rotatePlacedWithFeedback(id: string): void {
  const st = useStore.getState()
  if (st.rotatePlaced(id).ok) tick()
  else showToast(t("{id} can't rotate — no other rotation fits here", { id }), { duration: 3200 })
}

/** A leads part was just committed and placement re-armed (the hint toast says so). */
let placedAgainId: string | null = null
/** The last "doesn't fit here" toast (rapid retaps replace it). */
let refusalToastId: number | null = null

function handleHoleClick(hole: HoleRef): void {
  const st = useStore.getState()
  const mode = st.mode

  if (mode.kind === 'wire') {
    wireEndpointClick(hole)
    return
  }

  if (mode.kind === 'place') {
    const entry = getEntry(mode.type)
    if (!entry) return

    if (entry.placement === 'dip' || entry.placement === 'footprint') {
      const before = st.layout.components.length
      st.addComponent(mode.type, { at: hole, rotation: mode.rotation })
      const comps = useStore.getState().layout.components
      if (comps.length > before) {
        tick() // placement commit
        editCue('place') // …and its quiet sound cue (product chrome, 音效 on)
        st.setMode({ kind: 'select' })
        st.select(comps[comps.length - 1].id)
      } else if (!isLegacyChrome()) {
        // say WHY nothing happened — the real reason (SH-11): a wrong row
        // names the row to click, a package off the edge says which way to
        // move, else the validator's reason
        const rotation = mode.rotation ?? 0
        if (refusalToastId != null) dismissToast(refusalToastId)
        refusalToastId = showToast(
          placementRefusedHint(entry, rotationProblemText(mode.type, hole, rotation), refusalWhere(mode.type, hole, rotation)),
          { duration: 4200 },
        )
      }
      return
    }

    if (entry.placement === 'leads' || entry.placement === 'probe') {
      // occupied / already-picked holes are refused (ghost shows red); the
      // new chrome says why, replacing the previous refusal (release QA SH-F6)
      if (!placementValid(st.layout, mode.type, hole, mode.pickedHoles)) {
        if (!isLegacyChrome()) {
          const reason = placementSpotReason(st.layout, mode.type, hole, mode.pickedHoles)
          if (refusalToastId != null) dismissToast(refusalToastId)
          refusalToastId = reason ? showToast(placementSpotRefusedHint(reason), { duration: 3200 }) : null
        }
        return
      }
      // a good hole answers the last refusal
      if (refusalToastId != null) dismissToast(refusalToastId)
      refusalToastId = null
      const picked = [...mode.pickedHoles, hole]
      if (picked.length < entry.pins.length) {
        st.setMode({ kind: 'place', type: mode.type, pickedHoles: picked })
        return
      }
      const before = st.layout.components.length
      st.addComponent(mode.type, { holes: picked })
      const comps = useStore.getState().layout.components
      const added = comps.length > before
      if (added) {
        tick() // placement commit
        editCue('place') // product chrome only
      }
      if (added && entry.placement === 'leads') {
        // stay in place mode for repeat placement of leads parts
        placedAgainId = comps[comps.length - 1].id
        st.setMode({ kind: 'place', type: mode.type, pickedHoles: [] })
      } else if (added) {
        st.setMode({ kind: 'select' })
        st.select(comps[comps.length - 1].id)
      } else {
        st.setMode({ kind: 'place', type: mode.type, pickedHoles: [] })
      }
      return
    }
    return
  }

  // select mode: clicking a bare hole clears the selection
  if (st.selection.length > 0) st.clearSelection()
}

function handleTerminalClick(ref: string): void {
  const st = useStore.getState()
  if (st.mode.kind === 'wire') {
    wireEndpointClick(ref)
    return
  }
  if (st.mode.kind === 'select') {
    const id = ref.split(':')[0]
    if (st.layout.components.some((c) => c.id === id)) st.select(id)
  }
}

function handleObjectClick(id: string, additive?: boolean): void {
  const st = useStore.getState()
  if (st.mode.kind !== 'select') return
  // additive (desktop shift/cmd/ctrl+click) TOGGLES the part in the
  // selection — the multi-select path beyond the marquee; a plain click
  // keeps the classic replace semantics
  if (additive) st.toggleSelect(id)
  else st.select(id)
}

/**
 * A place/wire commit aimed at a body-covered hole was rejected by the
 * scene. The red locked chip shows WHERE — this toast explains WHY, naming
 * the covering component (the same occlusion model the validator uses), so
 * even a quick tap (which never sees the aim chip) gets feedback.
 */
let occlusionToastId: number | null = null
function handleHoleOcclusionRejected(hole: HoleRef): void {
  const st = useStore.getState()
  const config = boardConfigOf(st.layout)
  let coverer: string | null = null
  for (const comp of st.layout.components) {
    const entry = getEntry(comp.type)
    if (!entry) continue
    if (occludedHoles(comp, entry, config).has(hole)) {
      coverer = entry.label ? `${comp.id} (${partLabel(entry)})` : comp.id
      break
    }
  }
  if (occlusionToastId != null) dismissToast(occlusionToastId) // rapid retaps replace
  occlusionToastId = showToast(
    coverer
      ? t('{hole} is covered by {part} — move it or pick a clear hole', { hole, part: coverer })
      : t('{hole} is covered by a component body — pick a clear hole', { hole }),
    { duration: 2800 },
  )
}

function handleBackgroundClick(): void {
  const st = useStore.getState()
  if (st.mode.kind === 'wire' && st.mode.from) {
    st.setMode({ kind: 'wire', from: null, color: st.mode.color }) // cancel the started wire
    return
  }
  if (st.mode.kind === 'select' && st.selection.length > 0) st.clearSelection()
}

/** Legacy plus-paddle tap: grow the rig by one module (scene springs it in). */
function handleAddBoardClick(): void {
  const st = useStore.getState()
  const count = boardConfigOf(st.layout).count
  const res = st.setBoardCount(count + 1)
  if (res.ok) tick() // placement-commit-grade haptic (DESIGN.md §1)
  else if (res.error) showToast(tMessage(res.error))
}

/** "+" paddle tap on any grid edge: grow the 2-D grid (left/up also remap). */
function handleGrowGrid(direction: GrowDirection): void {
  const res = useStore.getState().growGrid(direction)
  if (res.ok) {
    tick() // placement-commit-grade haptic (DESIGN.md §1)
    maybeHintShrink()
  } else if (res.error) {
    showToast(tMessage(res.error))
  }
}

/**
 * One-time teaching toast for the TOUCH removal gesture (the desktop "−"
 * chip is hover-discoverable; long-press is not): shown the first time a
 * coarse-pointer user grows the grid past one board — exactly when removal
 * becomes possible and the paddle they just used is the removal surface too.
 */
const SHRINK_HINT_KEY = 'bb.hintShrink'
function maybeHintShrink(): void {
  try {
    if (!window.matchMedia('(pointer: coarse)').matches) return
    if (window.localStorage.getItem(SHRINK_HINT_KEY)) return
    window.localStorage.setItem(SHRINK_HINT_KEY, '1')
  } catch {
    return // no matchMedia / storage: skip the hint rather than nag forever
  }
  showToast(t('Long-press a + paddle to remove a board'), { duration: 3600 })
}

/**
 * "−" chip (desktop hover) / paddle long-press (touch): remove a board from
 * that edge via the EXISTING store shrink — setBoardCount/setBoardRows
 * shrink protection refuses (with its own explanatory error) when any part
 * or wire would be stranded on the removed module/row.
 */
function handleShrinkGrid(direction: GrowDirection): void {
  const st = useStore.getState()
  const config = boardConfigOf(st.layout)
  const res =
    direction === 'right' || direction === 'left'
      ? st.setBoardCount(config.count - 1)
      : st.setBoardRows((config.rows ?? 1) - 1)
  if (res.ok) tick(16) // delete-grade haptic (DESIGN.md §1)
  else if (res.error) showToast(tMessage(res.error))
}

/** Drag-to-move preview: would the drop commit? (drives the hologram tint) */
function handleMovePreview(ids: string[], target: MoveTarget): boolean {
  return useStore.getState().previewMove(ids, target).valid
}

/** Drag-to-move drop: all-or-nothing commit (one undo step; wires stay put). */
function handleMoveCommit(ids: string[], target: MoveTarget): void {
  if (useStore.getState().commitMove(ids, target).ok) tick()
}

/** Instrument bench-drag preview: full model validation of the candidate pos. */
function handleInstrumentMovePreview(id: string, pos: { x: number; z: number }): boolean {
  const layout = useStore.getState().layout
  const components = layout.components.map((c) => (c.id === id ? { ...c, pos } : c))
  return validateLayout({ ...layout, components }).ok
}

/** Instrument bench-drag drop → store.setInstrumentPos (wires replan). */
function handleInstrumentMoveCommit(id: string, pos: { x: number; z: number }): void {
  const res = useStore.getState().setInstrumentPos(id, pos)
  if (res.ok) tick()
  else if (res.error) showToast(tMessage(res.error))
}

/**
 * Teaching toast for an invalid armed rotation (R key / rotate button): the
 * text comes from validateLayout on a probe placement, so the explanation is
 * the validator's own ("straddles the channel", "covered by ...", ...).
 */
function rotationProblemText(type: string, at: HoleRef, rotation: Rotation): string | null {
  const st = useStore.getState()
  const entry = getEntry(type)
  if (!entry) return null
  // the probe id must itself satisfy the validator's id rules ('__rot__'
  // started with an underscore, so EVERY toast read as the id-rule error
  // instead of the real placement problem — Phase-C verification fix)
  const PROBE_ID = 'ROTATION_PROBE_X9'
  const probe =
    rotation !== 0
      ? { id: PROBE_ID, type, at, rotation }
      : { id: PROBE_ID, type, at }
  const res = validateLayout({ ...st.layout, components: [...st.layout.components, probe] })
  if (res.ok) return null
  const err = res.errors.find((e) => e.includes(PROBE_ID)) ?? res.errors[0]
  // localise the validator's English text first (its patterns see the real
  // message shape), then name the part instead of the probe id
  const label = partLabel(entry)
  return err ? tMessage(err).split(`"${PROBE_ID}"`).join(label).split(PROBE_ID).join(label) : null
}

/**
 * Where a refused dip / footprint drop was aimed (SH-11): the rows of the
 * clicked column the part WOULD fit at the armed rotation (the store's own
 * placementValid — occupancy, covering and seams included), and whether the
 * package anchored there runs off an edge of the board.
 */
function refusalWhere(type: string, hole: HoleRef, rotation: Rotation): RefusalWhere {
  const st = useStore.getState()
  const entry = getEntry(type)
  const at = parseHole(hole)
  if (!entry || !at || at.kind !== 'strip') return { hole, rotation }
  const fitRows = STRIP_ROWS.filter((row) => placementValid(st.layout, type, formatHole({ ...at, row }), [], rotation))
  // the edge test needs the anchor in a row the package can take
  const rowOk = fitRows.length > 0 ? fitRows.includes(at.row) : at.row === anchorRowOf(entry) || rotation !== 0
  const overflow = rowOk ? packageOverflow(entry, hole, boardConfigOf(st.layout), rotation) : null
  return { hole, fitRows, overflow, rotation }
}

/**
 * Phone view insets of the new chrome (SH-15): the scene's free area starts
 * below the run capsule and the status pill's slot (always reserved — the
 * pill comes and goes, the framing must not jump with it) or below a
 * floating lesson coach card, and ends above the dock or a resting sheet.
 * DOM reads only when called (an effect / a resize), never per frame.
 */
function phoneChromeInsets(coachTop: number, sheetCover: number): { top: number; bottom: number } {
  const vh = window.innerHeight
  const capsule = document.querySelector('.lg-capsule-wrap')?.getBoundingClientRect()
  const capsuleBottom = capsule && capsule.height > 0 ? capsule.bottom : 48
  // the pill hangs 10 px under the capsule (14 px on a touch screen, where its
  // fix button's 44 px target clears the capsule's — SH-F8; the 8 px margin
  // below still leaves 4 px), 40 px tall on phones (StatusPill.css)
  const pillSlot = capsuleBottom + 10 + 40 + 8
  const dock = document.querySelector('.lg-dock')?.getBoundingClientRect()
  const dockTop = dock && dock.height > 0 ? dock.top : vh - 73
  return {
    top: Math.round(Math.max(pillSlot, coachTop)),
    bottom: Math.round(Math.max(vh - dockTop + 8, sheetCover)),
  }
}

/**
 * One-time toast when Studio is picked on a phone-class (coarse-pointer)
 * device: ray tracing is allowed there, but it runs at reduced internal
 * resolution and is heavy on the GPU/battery — say so exactly once.
 */
const STUDIO_PHONE_WARNED_KEY = 'bb.studioPhoneWarned'
function maybeWarnStudioOnPhone(mode: RenderModeId): void {
  if (mode !== 'studio') return
  try {
    if (!window.matchMedia('(pointer: coarse)').matches) return
    if (window.localStorage.getItem(STUDIO_PHONE_WARNED_KEY)) return
    window.localStorage.setItem(STUDIO_PHONE_WARNED_KEY, '1')
  } catch {
    return // no matchMedia / storage: skip the warning rather than nag forever
  }
  showToast(t('Studio ray traces at reduced resolution on this device — expect battery drain'), {
    duration: 4500,
  })
}

/**
 * Pin-name hover labels (SceneCallbacks.holeLabelText). New chrome: the
 * readable chip of src/ui/workspace/hole-chip.ts (contract K5 — 「PA5（板上
 * A5）· c20」, 「c40 → 同一排：R1 第 1 腳」, rails by name), falling back to
 * the classic label. Classic chrome: "U1 · A5 · c20" for a component pin,
 * "w3 · a10" for a wire end, null elsewhere (src/ui/workspace/hole-labels.ts).
 */
function holeLabelText(hole: HoleRef): string | null {
  const layout = useStore.getState().layout
  if (isLegacyChrome()) return holeLabelFor(layout, hole)
  return holeChipText(hole) ?? holeLabelFor(layout, hole)
}

/**
 * 3D press-and-hold of an interactive part while the simulation runs (SC-6):
 * a part whose catalog entry has the runtime 'pressed' param follows the
 * pointer (down → pressed, up → released; never an undo step). A momentary
 * hold (latch.ts): pressing and letting go of a part kept pressed (保持按下)
 * releases it.
 */
function handleObjectPress(id: string, down: boolean): void {
  const st = useStore.getState()
  const comp = st.layout.components.find((c) => c.id === id)
  const entry = comp ? getEntry(comp.type) : undefined
  if (!entry?.params?.some((p) => p.key === 'pressed')) return
  pressMomentary(id, down)
  if (!down) return
  // the part being pressed is the one the user is working with: select it
  // (a long hold never resolves to a tap/click) so the inspector shows its
  // live pins while it is held
  if (st.mode.kind === 'select' && !(st.selection.length === 1 && st.selection[0] === id)) st.select(id)
  tick()
}

/**
 * Keep-pressed latch (保持按下 — latch.ts): a double-click on a pressable
 * part in 3D keeps it pressed (it is selected by its clicks). The classic
 * chrome declines (the scene then lets go as before).
 */
function handleObjectLatch(id: string): boolean {
  if (isLegacyChrome() || !latchPart(id)) return false
  tick(16)
  return true
}

/**
 * Debugger keys (SH-7 / SH-9): F5 resumes a halted core / starts a stopped
 * simulation (runOrResume) or, while running, halts the selected / only
 * board; Shift+F5 resets it; F10 steps a halted core one instruction — and
 * while the simulation is paused it halts the core where the pause left it
 * and steps (「已停住 U1 核心並單步一道指令——F5 繼續」). The decision is
 * keys.ts debugKeyAction (pure); this runs it with its feedback.
 */
function runDebugKey(key: DebugKey): void {
  const st = useStore.getState()
  const lab = useLab.getState()
  const action = debugKeyAction(key, {
    running: st.running,
    started: st.simTime > 0,
    halted: haltedMcuIds(),
    target: targetMcuId(),
  })
  switch (action.kind) {
    case 'resume':
      runOrResume()
      tick()
      return
    case 'halt': {
      lab.mcuHalt(action.id)
      tick()
      // the capsule (「核心已停住 · 繼續」) and the status pill (「U1 核心已停住
      // （偵錯器）〔繼續執行〕」) say it; a toast is a third voice — only while
      // an error holds the pill (SH-13 (6))
      const top = pillProblem(useProblems.getState().problems)
      if (top?.level === 'error') {
        showToast(t('{id} core halted — F10 steps, F5 resumes', { id: action.id }), { duration: 3600 })
      }
      return
    }
    case 'step':
      lab.mcuStep(action.id)
      tick()
      return
    case 'halt-step':
      lab.mcuHalt(action.id)
      lab.mcuStep(action.id)
      tick()
      showToast(t('{id} core halted and stepped one instruction — F5 resumes', { id: action.id }), { duration: 3600 })
      return
    case 'reset':
      lab.mcuReset(action.id)
      tick(16)
      showToast(t('{id} reset', { id: action.id }))
      return
    case 'explain': {
      const text =
        action.text === 'select-reset'
          ? t('Select the MCU to reset first')
          : action.text === 'select-halt'
            ? t('Select the MCU to halt first')
            : action.text === 'select-step'
              ? t('Select the MCU to step first')
              : action.text === 'start-first'
                ? t('Start the simulation first (Space or F5) — then F5 halts the core and F10 steps')
                : t('Halt the core first (F5), then step with F10')
      showToast(text, { duration: 3200 })
    }
  }
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

/** Duplicate via re-placement: same type re-enters place mode (the user taps
 *  the holes for the copy); off-board instruments are added immediately with
 *  their params copied. */
function duplicateComponent(id: string): void {
  const st = useStore.getState()
  const comp = st.layout.components.find((c) => c.id === id)
  if (!comp) return
  const entry = getEntry(comp.type)
  if (!entry) return
  if (entry.placement === 'offboard') {
    const before = st.layout.components.length
    st.addComponent(comp.type, {})
    const comps = useStore.getState().layout.components
    if (comps.length > before && comp.params) {
      const newId = comps[comps.length - 1].id
      for (const [k, v] of Object.entries(comp.params)) st.setParam(newId, k, v)
    }
    showToast(t('{part} duplicated', { part: partLabel(entry) }))
  } else {
    st.select(null)
    st.setMode({ kind: 'place', type: comp.type, pickedHoles: [] })
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

type SheetKey = 'parts' | 'ai' | 'scope' | 'more'
type DockKey = SheetKey | 'wire' | 'lessons' | 'none'

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<BreadboardScene | null>(null)
  const isDesktop = useIsDesktop()
  const workspaceOn = useWorkspaceActive()
  const librarySearchRef = useRef<HTMLInputElement | null>(null)
  // the whole chrome re-renders on a language switch (Settings → 介面語言)
  useLang()
  const legacy = useLegacyChrome()

  // --- chrome state machine (React state, never the store) ---
  const [activeSheet, setActiveSheet] = useState<SheetKey | null>(null)
  const [actionTarget, setActionTarget] = useState<string | null>(null)
  const [onboarding, setOnboarding] = useState(needsOnboarding)
  const [aiPrefill, setAiPrefill] = useState<string | undefined>(undefined)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const mode = useStore((s) => s.mode)
  const selection = useStore((s) => s.selection)
  const boardEmpty = useStore((s) => s.layout.components.length === 0)
  const issueCount = useStore((s) => s.issues.length)
  const problemCount = useProblems((s) => s.counts.error + s.counts.warning)
  const select = useStore((s) => s.select)
  const coachId = useLessonUi((s) => s.coachId)
  const lessonViewId = useLessonUi((s) => s.viewId)
  const lessonsSheetOpen = useLessonUi((s) => s.sheetOpen)
  const coachRect = useLessonUi((s) => s.coachRect)
  const leftPanel = useLab((s) => s.workspace.left)

  const wireArmed = mode.kind === 'wire'
  const lastWireColor = useRef('red')
  if (mode.kind === 'wire') lastWireColor.current = mode.color

  // 顯示電流 follows the chrome (review THREE-2 / UI-3): the classic chrome has
  // no control for it, so the stored choice ('bb.flow') shows no dots and
  // tracks no currents there; the product chrome shows it again. Declared
  // before the scene mounts: its flow layer starts from this chrome's value.
  useEffect(() => applyFlowChrome(legacy), [legacy])

  // mount the 3D scene once; keep it in sync with the store
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new BreadboardScene()
    scene.mount(container)
    sceneRef.current = scene
    // latest Studio render progress (COPIED — the engine reuses the payload
    // object); the capsule gets every update, the ?shotrig harness polls it
    // to await a converged still deterministically
    let lastRenderProgress: RenderProgress | null = null
    const callbacks: Partial<SceneCallbacks> = {
      holeLabelText,
      onObjectHover: (id: string | null) => setHoveredObject(id),
      onHoleClick: handleHoleClick,
      onHoleHover: (h: HoleRef | null) => useStore.getState().setHoverHole(h),
      onObjectClick: handleObjectClick,
      onBackgroundClick: handleBackgroundClick,
      onTerminalClick: handleTerminalClick,
      onHoleOcclusionRejected: handleHoleOcclusionRejected,
      onObjectLongPress: (id: string) => setActionTarget(id),
      onAddBoardClick: handleAddBoardClick, // legacy fallback (onGrowGrid wins)
      onGrowGrid: handleGrowGrid,
      onShrinkGrid: handleShrinkGrid,
      onMovePreview: handleMovePreview,
      onMoveCommit: handleMoveCommit,
      onMarqueeSelect: (ids: string[]) => useStore.getState().marqueeSelect(ids),
      onInstrumentMovePreview: handleInstrumentMovePreview,
      onInstrumentMoveCommit: handleInstrumentMoveCommit,
      // SC-6: hold a button in 3D while running
      onObjectPress: handleObjectPress,
      // …and a double-click keeps it pressed (保持按下, latch.ts)
      onObjectLatch: handleObjectLatch,
      // SC-5: right-click a hole / pin / terminal → the probe menu (workspace)
      // (SH-15: a touch long-press too — the menu comes up as a sheet on
      // phones, hosted by the Parts sheet there, by the workspace on desktop)
      onProbeRequest: (target, screen, opts?: { pointer?: 'mouse' | 'touch' }) => {
        if (isLegacyChrome()) return
        if (isWorkspaceShowing() || opts?.pointer === 'touch') openProbeMenu(target, screen, opts)
      },
      onRenderProgress: (p: RenderProgress) => {
        lastRenderProgress = { ...p }
        pushRenderProgress(p) // status capsule: "rendering… N/M samples"
      },
    }
    scene.setCallbacks(callbacks)
    // the one way UI code outside the shell points the 3D view (K4)
    registerScene(scene)

    // initial sync — contract C1 first: the product chrome draws every wire
    // in its net's role colour (supply red, ground black, signals by
    // function), the classic chrome keeps the stored colours (null)
    const s0 = useStore.getState()
    pushWireColors(scene, s0.layout)
    scene.setLayout(s0.layout)
    scene.setSelection(s0.selection)
    scene.setInteractionMode?.(s0.mode.kind)
    syncOverlays(scene, s0)
    setTelemetrySink((t) => scene.setTelemetry(t)) // also pushes current telemetry
    // keep-pressed parts: lock badges + 重置模擬 lets them go (product chrome)
    const unbindLatch = bindLatchScene(scene, () => !isLegacyChrome())

    // Loaded examples / imports / applied AI circuits can sit anywhere on the
    // board, far outside the fixed home framing of a phone viewport — spring
    // the camera to frame them. Same for a restored autosave on boot.
    setLayoutLoadedSink(() => scene.frameContent?.())
    if (s0.layout.components.length > 0 || s0.layout.wires.length > 0) scene.frameContent?.()

    const unsub = useStore.subscribe((s, prev) => {
      if (s.layout !== prev.layout) {
        scene.setLayout(s.layout)
        pushWireColors(scene, s.layout)
      }
      if (s.selection !== prev.selection) scene.setSelection(s.selection)
      if (s.mode.kind !== prev.mode.kind) scene.setInteractionMode?.(s.mode.kind)
      if (s.mode !== prev.mode || s.hoverHole !== prev.hoverHole || s.layout !== prev.layout) {
        syncOverlays(scene, s)
      }
      // More-sheet graphics picker → the scene's RenderModeManager (the boot
      // value needs no push: the manager reads the same persisted key). On a
      // phone, picking Studio warns once about the reduced-resolution mode.
      if (s.renderMode !== prev.renderMode && s.renderMode) {
        scene.setRenderMode?.(s.renderMode)
        maybeWarnStudioOnPhone(s.renderMode)
      }
    })

    // Screenshot-harness camera rig (scripts/closeups.mjs): exposed ONLY when
    // the page is opened with `?shotrig` — inert in normal use, no UI surface.
    const shotRig =
      typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('shotrig')
    if (shotRig) {
      ;(window as unknown as Record<string, unknown>).__shotRig = {
        setCamera: (px: number, py: number, pz: number, tx: number, ty: number, tz: number) =>
          scene.setCameraPose({ x: px, y: py, z: pz }, { x: tx, y: ty, z: tz }),
        // world point → viewport px (deterministic drag targets for sweeps)
        project: (x: number, y: number, z: number) => scene.projectToScreen({ x, y, z }),
        // latest Studio progress (scripts/modes.mjs awaits `converged`)
        renderProgress: () => lastRenderProgress,
      }
    }

    return () => {
      if (shotRig) delete (window as unknown as Record<string, unknown>).__shotRig
      setLayoutLoadedSink(null)
      setTelemetrySink(null)
      unbindLatch()
      unsub()
      registerScene(null)
      sceneRef.current = null
      scene.dispose()
    }
  }, [])

  // problems store (K3): ERC + simulator issues + MCU states, ≤ 1 Hz — the
  // status pill, the inspector's problems panel and the More sheet read it
  useEffect(() => startProblemsWatcher(), [])

  // contract C1: a chrome switch (Settings → 介面語言 / the workspace) swaps
  // role colours ↔ stored colours
  useEffect(() => {
    const scene = sceneRef.current
    if (scene) pushWireColors(scene, useStore.getState().layout)
  }, [legacy])

  // a resting phone sheet (≥ 0.4 detent) covers the scene's bottom (SH-8)
  const [sheetCover, setSheetCover] = useState(sheetCoverHeight)
  useEffect(() => subscribeSheetCover(setSheetCover), [])

  // desktop workspace: frame the board in the canvas area its docked panels
  // and tray leave free (same geometry the Workspace lays the panels out
  // with). Without the workspace the new chrome frames below a floating
  // lesson coach card (K8) and above a resting phone sheet (SH-8); on a
  // phone also below the run capsule + the status pill's slot and above the
  // dock (SH-15 — the board sat in the lower half, cut off at the right,
  // and never re-framed when the coach folded). The classic chrome floats
  // over the scene and keeps zero insets.
  const workspacePrefs = useLab((s) => s.workspace)
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    // the docked (new) chrome: screen-space chips, paddles only while placing on touch (SC-16)
    scene.setDockedChrome?.(!legacy)
    if (!workspaceOn) {
      if (legacy) {
        scene.setViewInsets({ left: 0, right: 0, top: 0, bottom: 0 })
        return
      }
      const coachTop = coachRect ? Math.max(0, coachRect.bottom + 8) : 0
      if (isDesktop) {
        scene.setViewInsets({ left: 0, right: 0, top: coachTop, bottom: 0 })
        return
      }
      const apply = () => {
        const { top, bottom } = phoneChromeInsets(coachTop, sheetCover)
        // the scene re-frames a camera parked at the home / circuit / step
        // framing into the new free area (setViewInsets); a camera the user
        // placed keeps its pose
        scene.setViewInsets({ left: 0, right: 0, top, bottom })
      }
      apply()
      window.addEventListener('resize', apply)
      return () => window.removeEventListener('resize', apply)
    }
    // the coach card floats (coachRect non-null) only while the Library panel
    // is collapsed — docked in #ws-coach-slot it publishes null — so frame
    // the board below it, as without the workspace
    const top = coachRect ? Math.max(0, coachRect.bottom + 8) : 0
    const apply = () => {
      const g = computeGeometry(workspacePrefs, window.innerWidth, window.innerHeight)
      scene.setViewInsets({ left: g.insetLeft, right: g.insetRight, top, bottom: g.insetBottom })
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [workspaceOn, workspacePrefs, legacy, coachRect, sheetCover, isDesktop])

  // global keys (new chrome, SH-9): Space run / pause (toggleRun — a debugger
  // halt resumes) and the debugger keys F5 / F10 / Shift+F5 act wherever the
  // focus is — window CAPTURE phase, so the workspace panels' guardKeys and
  // a clicked (pointer-focused) button cannot swallow or re-fire them; a
  // keyboard-focused control, a text field and an open modal keep Space
  // (keys.ts routeGlobalKey). The classic chrome routes none of them (SH-10).
  useEffect(() => installFocusModality(), [])
  useEffect(() => {
    const onKeyCapture = (e: KeyboardEvent) => {
      const route = routeGlobalKey(e, describeKeyTarget(e.target), {
        legacy: isLegacyChrome(),
        mcuCount: mcuIdsInLayout().length,
        blockingModal: blockingModalOpen(),
      })
      if (route.kind === 'pass') return
      e.preventDefault()
      if (route.kind === 'swallow') return
      e.stopPropagation()
      if (route.kind === 'region') {
        cycleFocusRegion(route.back) // F6 / Shift+F6 (SH-16)
        return
      }
      if (route.blur) releasePointerFocus(e.target)
      if (route.kind === 'run') {
        if (e.repeat) return // holding Space must not flicker run / pause
        // an empty board does not run: a toast says what to do first (SH-13)
        if (toggleRunWithFeedback()) tick()
        return
      }
      if (e.repeat && route.key !== 'F10') return // F10 held = step on (a debugger habit)
      runDebugKey(route.key)
    }
    window.addEventListener('keydown', onKeyCapture, true)
    return () => window.removeEventListener('keydown', onKeyCapture, true)
  }, [])

  // keyboard (desktop): Esc cancel/deselect, Delete remove, F frame the
  // circuit (new chrome), Ctrl/Cmd+S save the project and ? the shortcuts
  // list (new chrome), Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z or Ctrl+Y redo,
  // R = rotate the armed part while placing OR the single selected
  // dip/footprint package in select mode (rotatePlaced — next valid
  // rotation, one undo step), arrow keys = nudge the selection (dCol ±1;
  // Up/Down step leads parts along the strip-row lattice — all-or-nothing);
  // the classic chrome keeps its pre-wave Space here
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      const st = useStore.getState()
      const key = e.key.toLowerCase()
      // (new chrome: a short toast names the step — 「已復原：放上 R1」, SH-F9)
      if ((e.metaKey || e.ctrlKey) && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redoWithFeedback()
        else undoWithFeedback()
        return
      }
      if (e.ctrlKey && key === 'y') {
        e.preventDefault()
        redoWithFeedback()
        return
      }
      // the classic chrome keeps the browser's Ctrl+S (Save page) and '?' (SH-10)
      const legacyChrome = isLegacyChrome()
      if ((e.metaKey || e.ctrlKey) && !e.altKey && key === 's' && !legacyChrome) {
        e.preventDefault()
        void saveProjectFile()
        return
      }
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !legacyChrome) {
        e.preventDefault()
        setShortcutsOpen((o) => !o)
        return
      }
      if (key === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !isLegacyChrome()) {
        e.preventDefault()
        frameCircuit()
        return
      }
      if (key === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (st.mode.kind === 'place') {
          e.preventDefault()
          st.rotateArmed()
          return
        }
        // select mode: R rotates the single selected dip/footprint package
        if (
          st.mode.kind === 'select' &&
          st.selection.length === 1 &&
          isRotatableComponent(st, st.selection[0])
        ) {
          e.preventDefault()
          rotatePlacedWithFeedback(st.selection[0])
          return
        }
      }
      if (
        st.mode.kind === 'select' &&
        st.selection.length > 0 &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')
      ) {
        e.preventDefault()
        if (e.key === 'ArrowLeft') st.moveSelection(-1)
        else if (e.key === 'ArrowRight') st.moveSelection(1)
        else if (e.key === 'ArrowUp') st.moveSelection(0, -1)
        else st.moveSelection(0, 1)
        return
      }
      if (e.key === 'Escape') {
        if (st.mode.kind === 'wire' && st.mode.from) {
          st.setMode({ kind: 'wire', from: null, color: st.mode.color })
        } else if (st.mode.kind !== 'select') {
          st.setMode({ kind: 'select' })
        } else if (st.selection.length > 0) {
          st.clearSelection()
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selection.length > 0) {
          e.preventDefault()
          // new chrome: 「已刪除 PS1——Ctrl+Z 可復原」 (SH-F9)
          removeSelectedWithFeedback()
          tick(16)
        }
      } else if ((e.key === ' ' || e.code === 'Space') && isLegacyChrome()) {
        // classic chrome, exactly as before the UX wave (the new chrome's
        // Space is routed in the capture phase above): focused buttons (incl.
        // the capsule, role="button") activate themselves
        const t = e.target
        if (
          t instanceof HTMLElement &&
          (t.tagName === 'BUTTON' || t.getAttribute('role') === 'button')
        ) {
          return
        }
        e.preventDefault()
        if (st.running) st.stopSim()
        else st.startSim()
        tick()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // teaching toast when cycling to a rotation that cannot fit at the hovered
  // anchor (R key AND the chrome RotateButton both funnel through
  // mode.rotation, so one subscription covers both); text from validateLayout
  const prevRotationRef = useRef<Rotation | null>(null)
  useEffect(() => {
    if (mode.kind !== 'place') {
      prevRotationRef.current = null
      return
    }
    const rot: Rotation = mode.rotation ?? 0
    const prev = prevRotationRef.current
    prevRotationRef.current = rot
    if (prev === null || prev === rot) return // armed fresh / unchanged
    const st = useStore.getState()
    if (!st.hoverHole) return
    if (placementValid(st.layout, mode.type, st.hoverHole, mode.pickedHoles, rot)) return
    const text = rotationProblemText(mode.type, st.hoverHole, rot)
    if (text) showToast(text, { duration: 3200 })
  }, [mode])

  // placement / wire-mode hints as glass toasts above the dock; each mode
  // change replaces the previous hint so stale hints never linger
  const firstModeRef = useRef(true)
  const hintToastRef = useRef<number | null>(null)
  const prevModeRef = useRef<AppState['mode'] | null>(null)
  const armedFromRef = useRef<ArmedFrom>('card')
  useEffect(() => {
    if (firstModeRef.current) {
      firstModeRef.current = false // no toast for the boot-time select mode
      return
    }
    if (hintToastRef.current != null) dismissToast(hintToastRef.current)
    // what armed a placement — a library card or the lesson coach's step
    // button (its touch hint names 「放置中」, not a card — SH-12 / TR-19);
    // decided when the placement starts, kept through repeat placement
    const prev = prevModeRef.current
    prevModeRef.current = mode
    if (mode.kind === 'place' && (prev?.kind !== 'place' || prev.type !== mode.type)) {
      armedFromRef.current = lastActionInside('.lsn-coach, [class*="lsn-"]') ? 'coach' : 'card'
    }
    // a leads part was just committed and placement re-armed: say so (SH-5)
    const placed = placedAgainId
    placedAgainId = null
    // a wire was just committed: confirm it, both ends named (SH-12)
    const connected = wireConnectedText
    wireConnectedText = null
    // a wire start just moved off a part pin's hole: say where it starts (SH-F1)
    const started = wireStartText
    wireStartText = null
    const legacyChrome = isLegacyChrome()
    // the 「這裡不能接」 toast goes with wire mode (SH-F9)
    if (mode.kind !== 'wire') dismissWireRefusalToast()
    const hint =
      placed && mode.kind === 'place' && mode.pickedHoles.length === 0 && !legacyChrome
        ? placedAgainHint(placed, undefined, armedFromRef.current)
        : connected && mode.kind === 'wire' && !mode.from && !legacyChrome
          ? connected
          : started && mode.kind === 'wire' && mode.from && !legacyChrome
            ? started
            : hintForMode(mode, undefined, armedFromRef.current)
    hintToastRef.current = hint
      ? showToast(hint, { duration: placed || started ? 3800 : connected ? 2400 : 3200 })
      : null
  }, [mode])

  // toasts sit higher while the wire color strip occupies their spot
  useEffect(() => {
    document.body.classList.toggle('app-wire-armed', wireArmed)
    return () => document.body.classList.remove('app-wire-armed')
  }, [wireArmed])

  // the workspace hosts Parts (Library panel) and Scope (tray) itself: a
  // sheet of either kind left open when it turns on would double the view
  useEffect(() => {
    if (workspaceOn) setActiveSheet((cur) => (cur === 'parts' || cur === 'scope' ? null : cur))
  }, [workspaceOn])

  // a link that leads to an instrument (「在模擬日誌中檢視」, the probe
  // menu's analyzer row…) where no workspace tray shows — phones, narrow
  // desktop windows: the 儀器 sheet presents on that view (ScopeSheet opens
  // on the tray tab showInstrument set). Event-driven.
  useEffect(
    () =>
      useInstrumentRequest.subscribe((s, p) => {
        if (!s.request || s.request === p.request || isLegacyChrome() || isWorkspaceShowing()) return
        if (useLessonUi.getState().sheetOpen) useLessonUi.getState().setSheetOpen(false)
        setActiveSheet('scope')
      }),
    [],
  )

  /** Workspace: show the Library panel on its Library tab and focus search. */
  const showLibrary = () => {
    const lab = useLab.getState()
    lab.setWorkspace({ left: { ...lab.workspace.left, open: true, tab: 'parts' } })
    // after the panel (re)mounts
    requestAnimationFrame(() => librarySearchRef.current?.focus({ preventScroll: true }))
  }

  /** Workspace: the Library panel's Examples tab with its search focused. */
  const showExamples = () => {
    const lab = useLab.getState()
    lab.setWorkspace({ left: { ...lab.workspace.left, open: true, tab: 'examples' } })
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('.ws-left input[type="search"]')?.focus({ preventScroll: true }),
      ),
    )
  }

  /**
   * 「開啟範例」 / 「範例 ›」 (new chrome — release QA SH-F7): the one example
   * library — the workspace's 範例 tab on a desktop, otherwise the 元件 sheet
   * on its 範例 segment (scene SC-F3; an open 元件 sheet switches at once).
   */
  const openExamples = () => {
    if (workspaceOn) {
      setActiveSheet(null)
      showExamples()
      return
    }
    showPartsSheetSegment('examples')
    setActiveSheet('parts')
  }

  // --- dock state machine ---
  const lessonsActive = workspaceOn ? leftPanel.open && leftPanel.tab === 'lessons' : lessonsSheetOpen
  const dockActive: DockKey = activeSheet ?? (wireArmed ? 'wire' : !legacy && lessonsActive ? 'lessons' : 'none')
  const onDock = (key: DockKey) => {
    if (key === 'lessons') {
      // 課程 (new chrome): the workspace's Lessons tab, or the lessons sheet
      setActiveSheet(null)
      if (workspaceOn) {
        const lab = useLab.getState()
        const { left } = lab.workspace
        if (left.open && left.tab === 'lessons') lab.setWorkspace({ left: { ...left, open: false } })
        else openLessons()
      } else if (useLessonUi.getState().sheetOpen) {
        useLessonUi.getState().setSheetOpen(false)
      } else {
        openLessons()
      }
      return
    }
    // another dock item takes over from the phone lessons sheet
    if (!workspaceOn && key !== 'none' && useLessonUi.getState().sheetOpen) useLessonUi.getState().setSheetOpen(false)
    if (workspaceOn && (key === 'parts' || key === 'scope')) {
      // workspace: the rail toggles the persistent panels instead of sheets
      setActiveSheet(null)
      const lab = useLab.getState()
      const { left, tray } = lab.workspace
      if (key === 'parts') {
        if (left.open && left.tab === 'parts') lab.setWorkspace({ left: { ...left, open: false } })
        else showLibrary()
      } else if (tray.open) {
        // 「儀器」 shows / hides the instrument tray as a whole, on whichever
        // instrument was last in front (the classic 'Scope' item no longer
        // exists in the workspace — the workspace is never the classic chrome)
        lab.setWorkspace({ tray: { ...tray, open: false } })
      } else {
        lab.setWorkspace({ tray: { ...tray, open: true } })
      }
      return
    }
    if (key === 'wire') {
      const st = useStore.getState()
      if (st.mode.kind === 'wire') {
        st.setMode({ kind: 'select' }) // tap again to exit
      } else {
        setActiveSheet(null)
        st.select(null)
        resetWireColorPick() // the colour follows the convention until a swatch is picked
        st.setMode({ kind: 'wire', from: null, color: lastWireColor.current })
      }
      return
    }
    if (key === 'none') return
    setActiveSheet((cur) => (cur === key ? null : key))
  }

  // the More badge: classic chrome counts simulator issues; the new chrome
  // counts errors + warnings of the problems store, and drops the badge in
  // the workspace (the status pill says it there, persistently)
  const badgeCount = legacy ? issueCount : workspaceOn ? 0 : problemCount
  const moreItem: DockItem<DockKey> = {
    key: 'more',
    icon: (
      <span className="app-dock-iconwrap">
        <EllipsisIcon size={26} />
        {badgeCount > 0 && (
          <span className="app-dock-badge" aria-label={t('{n} issues', { n: badgeCount })}>
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </span>
    ),
    label: t('More'),
  }
  const dockItems: readonly DockItem<DockKey>[] = legacy
    ? [
        { key: 'parts', icon: <ChipIcon size={26} />, label: t('Parts') },
        { key: 'wire', icon: <WireIcon size={26} />, label: t('Wire') },
        { key: 'ai', icon: <SparklesIcon size={26} />, label: t('AI') },
        { key: 'scope', icon: <WaveformIcon size={26} />, label: t('Scope') },
        moreItem,
      ]
    : [
        { key: 'parts', icon: <ChipIcon size={26} />, label: t('Parts') },
        { key: 'wire', icon: <WireIcon size={26} />, label: t('Wire') },
        { key: 'lessons', icon: <BookIcon size={26} />, label: t('Lessons') },
        { key: 'scope', icon: <WaveformIcon size={26} />, label: t('Instruments') },
        moreItem,
      ]

  // --- long-press action sheet ---
  const layout = useStore((s) => s.layout)
  const targetComp = actionTarget ? layout.components.find((c) => c.id === actionTarget) : undefined
  const targetWire = actionTarget ? layout.wires.find((w) => w.id === actionTarget) : undefined
  const targetEntry = targetComp ? getEntry(targetComp.type) : undefined
  const actionSheetActions: ActionSheetAction[] = []
  if (targetComp) {
    actionSheetActions.push({ label: t('Properties'), onSelect: () => select(targetComp.id) })
    // 保持按下 / 放開 (latch.ts — product chrome): a button can be kept pressed from here before a
    // run or between runs; during a session a touch long-press on it presses it instead (SC-6 —
    // the finger is the hand on the button), and the part it selects shows the same switch in its
    // sheet (a double-tap keeps it pressed too)
    const latchItem = legacy ? null : latchSheetItem(targetComp.id, layout)
    if (latchItem) {
      actionSheetActions.push({
        label: latchItem.label,
        onSelect: () => {
          if (latchItem.run()) tick(latchItem.kept ? 8 : 16)
        },
      })
    }
    // dip/footprint packages only — the rotation feature's placed-part surface
    // (DIPs toggle 0↔180, footprints step to the next VALID quarter turn)
    if (targetEntry && (targetEntry.placement === 'dip' || targetEntry.placement === 'footprint')) {
      actionSheetActions.push({
        label: t('Rotate'),
        onSelect: () => rotatePlacedWithFeedback(targetComp.id),
      })
    }
    actionSheetActions.push({ label: t('Duplicate'), onSelect: () => duplicateComponent(targetComp.id) })
  }
  if (targetComp || targetWire) {
    // the TOUCH multi-select path (DESIGN §8: everything touch-completable):
    // long-press → toggle into the selection; repeat on other parts/wires to
    // build the group the SelectionPill / group move-drag then operate on
    const targetSelected = actionTarget != null && selection.includes(actionTarget)
    actionSheetActions.push({
      label: targetSelected ? t('Remove from Selection') : t('Add to Selection'),
      onSelect: () => {
        if (actionTarget != null) useStore.getState().toggleSelect(actionTarget)
      },
    })
    actionSheetActions.push({
      label: t('Delete'),
      destructive: true,
      onSelect: () => {
        const st = useStore.getState()
        if (targetComp) st.removeComponent(targetComp.id)
        else if (targetWire) st.removeWire(targetWire.id)
        tick(16)
        // new chrome: the Delete key's words, with the way back (SH-F9)
        if (legacy) showToast(targetComp ? t('{id} removed', { id: targetComp.id }) : t('Wire removed'))
        else deletedToast([targetComp ? targetComp.id : t('Wire {id}', { id: targetWire!.id })])
      },
    })
  }

  // new chrome: the card steps aside while a lesson is being followed or
  // browsed and while the examples / lessons list is already on screen
  const learningOnScreen =
    coachId != null ||
    lessonViewId != null ||
    lessonsSheetOpen ||
    (workspaceOn && leftPanel.open && (leftPanel.tab === 'examples' || leftPanel.tab === 'lessons'))
  const emptyVisible =
    boardEmpty && activeSheet === null && mode.kind === 'select' && !onboarding && (legacy || !learningOnScreen)
  const finishOnboarding = () => {
    markOnboarded()
    setOnboarding(false)
  }

  return (
    <div className="app-root">
      {/* full-bleed 3D canvas under everything */}
      <div className="app-canvas" ref={containerRef} />

      {/* top-center run capsule */}
      <StatusBar />
      <FlowToggle /> {/* 顯示電流 chip beside the capsule (product chrome, while a session exists) */}

      {/* status pill under it: the top problem or the next step (new chrome;
          self-hides in the classic chrome and when there is nothing to say) */}
      <StatusPill hidden={onboarding || emptyVisible} onOpenMore={() => setActiveSheet('more')} />

      {/* empty-state card */}
      {emptyVisible && (
        <EmptyState
          onBrowseParts={() => (workspaceOn ? showLibrary() : setActiveSheet('parts'))}
          onAskAi={() => {
            setAiPrefill(t('make me a circuit that displays a date'))
            setActiveSheet('ai')
          }}
          onStartLesson={() => void startFirstLesson()}
          onOpenExamples={openExamples}
        />
      )}

      {/* wire color swatches above the dock while armed */}
      <WireColorStrip />

      {/* undo/redo glass pill (left edge, above the dock); self-hides */}
      <UndoPill />

      {/* multi-select pill ("N selected · Delete · Clear"); self-hides at ≤1 */}
      <SelectionPill />

      {/* rotate-the-armed-package glass button (touch chrome); self-hides */}
      <RotateButton />

      {/* bottom dock / desktop left rail */}
      <Dock<DockKey>
        items={dockItems}
        activeKey={dockActive}
        onSelect={onDock}
        desktop={isDesktop}
        aria-label={t('Main')}
      />

      {/* desktop embedded workspace: Library · Inspector · instrument tray
          (Tier-S panels floating over the canvas; self-gated by
          useWorkspaceActive — phones and the classic chrome never mount it) */}
      {workspaceOn && <Workspace librarySearchRef={librarySearchRef} />}
      <PerfOverlay sceneRef={sceneRef} />

      {/* sheets (each renders its own kit Sheet; panel mode on desktop) */}
      <PartsSheet
        open={activeSheet === 'parts' && !workspaceOn}
        onDismiss={() => setActiveSheet(null)}
        desktop={isDesktop}
      />
      <AiSheet
        open={activeSheet === 'ai'}
        onDismiss={() => {
          setActiveSheet(null)
          setAiPrefill(undefined) // prefill is a one-shot (empty-state path only)
        }}
        desktop={isDesktop}
        initialPrompt={aiPrefill}
      />
      <ScopeSheet
        open={activeSheet === 'scope' && !workspaceOn}
        onDismiss={() => setActiveSheet(null)}
        desktop={isDesktop}
      />
      <MoreSheet
        open={activeSheet === 'more'}
        onDismiss={() => {
          // a row that leads elsewhere (「在模擬日誌中檢視」 → the 儀器 sheet)
          // has already switched sheets: only close the More sheet itself
          setActiveSheet((cur) => (cur === 'more' ? null : cur))
        }}
        desktop={isDesktop}
        onOpenAi={() => setActiveSheet('ai')}
        onOpenShortcuts={() => {
          setActiveSheet(null)
          setShortcutsOpen(true)
        }}
        // 「範例 ›」 (SH-F7): the one example library — the workspace's 範例
        // tab, or the 元件 sheet's 範例 segment (scene SC-F3)
        onOpenExamples={legacy ? undefined : openExamples}
      />

      {/* selection → Properties presents at half snap (single = full editor,
          multi = compact group view); dismiss deselects. With the workspace
          on, the inspector panel shows the same editors instead. */}
      <PropertiesSheet
        open={selection.length > 0 && !workspaceOn}
        onDismiss={() => select(null)}
        desktop={isDesktop}
      />

      {/* long-press a component → Properties / Duplicate / Delete */}
      <ActionSheet
        open={actionTarget != null && (targetComp != null || targetWire != null)}
        onDismiss={() => setActionTarget(null)}
        title={
          targetComp
            ? `${targetComp.id} · ${targetEntry ? partLabel(targetEntry) : targetComp.type}`
            : targetWire
              ? t('Wire {id}', { id: targetWire.id })
              : undefined
        }
        actions={actionSheetActions}
        desktop={isDesktop}
      />

      {/* the phone coach's problem line opens 更多 → 問題 (the list leads the sheet — LS-14 (d)) */}
      <LessonOverlay
        sceneRef={sceneRef}
        desktop={isDesktop}
        onOpenMore={() => setActiveSheet('more')}
      />

      {/* glass toast pills above the dock */}
      <ToastHost wide={!legacy} />
      <CelebrationOverlay />

      {/* 「鍵盤快速鍵」 (? or More → 鍵盤快速鍵; new chrome only — the classic
          chrome routes none of its keys, SH-10) */}
      {!legacy && <ShortcutsSheet open={shortcutsOpen} onDismiss={() => setShortcutsOpen(false)} />}

      {/* first-launch coach overlay */}
      {onboarding && <Onboarding onDone={finishOnboarding} />}
    </div>
  )
}
