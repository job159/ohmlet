/**
 * 3D scene contract. CONTRACT FILE.
 * Implemented by src/three/scene.ts (scene agent); driven by the store/App
 * (glue agent); component visuals come from src/three/component-meshes.ts
 * (meshes agent).
 */

import type { CircuitLayout, HoleRef, Rotation, SimTelemetry } from '../model/types'
import type { RenderModeId } from './render-modes/capability'
import type { StudioProgress } from './render-modes/types'

/**
 * Studio render-mode progress (chunk load / BVH build / samples-per-pixel /
 * converged) surfaced to the host UI — see src/three/render-modes/types.ts.
 */
export type RenderProgress = StudioProgress

/** App interaction mode relevant to the scene's touch ergonomics. */
export type SceneInteractionMode = 'select' | 'place' | 'wire'

/**
 * Direction the 2-D board grid grows when a "+" paddle is tapped:
 * 'right'/'left' add a module to every board-row, 'down'/'up' add a
 * board-row. Structurally identical to the store's GrowDirection
 * (state/types.ts) — the host forwards it to store.growGrid.
 */
export type GridGrowDirection = 'right' | 'left' | 'up' | 'down'

/**
 * Where a scene move-drag wants to land — structurally identical to the
 * store's MoveTarget (state/types.ts):
 *  - `{ anchor }`: a SINGLE selected dip/footprint package re-anchors its
 *    pin-1 hole (free drag, may hop rows/board-rows).
 *  - `{ dCol, dRowLattice }`: a group / leads selection translates by whole
 *    columns and strip-row-lattice steps.
 */
export type SceneMoveTarget = { anchor: HoleRef } | { dCol: number; dRowLattice: number }

export interface SceneCallbacks {
  /** a board hole was clicked (placement / wiring) */
  onHoleClick(hole: HoleRef): void
  /** pointer hovers a hole (or left all holes → null) */
  onHoleHover(hole: HoleRef | null): void
  /**
   * a component body or wire was clicked. `additive` (ADDITIVE contract
   * extension — desktop shift/cmd/ctrl+click) asks the host to TOGGLE the
   * object in the selection instead of replacing it (store.toggleSelect);
   * absent/false keeps the classic replace semantics.
   */
  onObjectClick(id: string, additive?: boolean): void
  /** click on empty space */
  onBackgroundClick(): void
  /** off-board terminal clicked, ref = "ID:PIN" (for wiring) */
  onTerminalClick(ref: string): void
  /**
   * OPTIONAL (additive): a place/wire commit aimed at `hole` was REJECTED
   * because a component body covers it (occlusion). Fired for quick taps and
   * fingertip lift-commits alike — the host should explain WHY (toast naming
   * the covering part); the scene itself only pins the red locked chip.
   */
  onHoleOcclusionRejected?(hole: HoleRef): void
  /**
   * OPTIONAL (additive): a component body or wire was long-pressed (~500ms
   * hold within 10px — DESIGN.md §4 action-sheet gesture). The scene
   * suppresses the tap that would otherwise fire on the matching pointerup.
   */
  onObjectLongPress?(id: string): void
  /**
   * OPTIONAL (additive): the "add board" plus paddle (shown at the right edge
   * of the last module while in select mode with the sim stopped and fewer
   * than MAX_BOARD_COUNT modules) was tapped. The host grows the rig via
   * store.setBoardCount(count + 1). Superseded by onGrowGrid — when both are
   * set, the right paddle reports through onGrowGrid('right') only.
   */
  onAddBoardClick?(): void
  /**
   * OPTIONAL (additive): one of the FOUR "+" paddles (right/left/top/bottom
   * edges of the 2-D grid; hidden at the axis cap, while the sim runs, and in
   * non-select modes) was tapped. The host grows the grid via
   * store.growGrid(direction).
   */
  onGrowGrid?(direction: GridGrowDirection): void
  /**
   * OPTIONAL (additive): the quiet board-removal affordance. Fired by the
   * small "−" chip revealed beneath a hovered "+" paddle (desktop) or by a
   * long-press on the paddle (touch), only on edges the store can shrink:
   * 'right' drops the rightmost module column, 'down' the deepest board-row.
   * The host shrinks via store.setBoardCount/setBoardRows — their shrink
   * protection already refuses (with a user-presentable error) when parts
   * would be stranded; on success the scene lifts the removed boards away.
   */
  onShrinkGrid?(direction: GridGrowDirection): void
  /**
   * OPTIONAL (additive): a move-drag of the selected part(s) is hovering
   * `target` — return whether the drop would commit (drives the cyan/red
   * hologram tint). Pure; the host answers from store.previewMove. Missing
   * callback = the scene assumes valid.
   */
  onMovePreview?(ids: string[], target: SceneMoveTarget): boolean
  /**
   * OPTIONAL (additive): a move-drag of the selected part(s) dropped on a
   * valid `target`. The host commits via store.commitMove (all-or-nothing,
   * one undo step; wires stay put).
   */
  onMoveCommit?(ids: string[], target: SceneMoveTarget): void
  /**
   * OPTIONAL (additive): a desktop shift+drag marquee finished; `ids` are the
   * components/wires whose screen-projected centers fell inside the rectangle
   * (empty = clear). The host replaces the selection via store.marqueeSelect.
   */
  onMarqueeSelect?(ids: string[]): void
  /**
   * OPTIONAL (additive): an instrument drag is hovering bench position `pos`
   * (plan units, snapped to the 0.5 grid) — return whether the drop would
   * commit (validity tint). Missing callback = assumed valid.
   */
  onInstrumentMovePreview?(id: string, pos: { x: number; z: number }): boolean
  /**
   * OPTIONAL (additive): a selected off-board instrument was dropped at bench
   * position `pos` (0.5-grid snapped). The host commits via
   * store.setInstrumentPos; committed layouts replan wire routes.
   */
  onInstrumentMoveCommit?(id: string, pos: { x: number; z: number }): void
  /**
   * OPTIONAL (additive): Studio render-mode progress for the status capsule
   * (loading the ray-tracer chunk / building the BVH / "rendering… N/M
   * samples" / converged). Fired from the scene's render loop; the payload
   * object is REUSED between calls — copy it if you keep it.
   */
  onRenderProgress?(progress: RenderProgress): void
  /**
   * OPTIONAL (additive, embedded platform): text for the hovered-hole chip.
   * Return a string to show it INSTEAD of the bare hole ref — e.g.
   * 'U1 · A5 · c25' (part id, the pin's silkscreen label, the hole) when a
   * part pin sits in the hole; null / undefined / '' keeps the plain ref.
   * Same glass chip, same auto-shrink, same red padlock styling for occluded
   * holes. Asked whenever the chip is (re)aimed — mouse hover, touch
   * fingertip cursor, desktop click-pinned chip — so keep it pure and cheap;
   * a throwing callback falls back to the ref.
   *
   * UX fix wave (SC-12): with docked chrome the scene also asks it for an
   * off-board terminal ref ("PS1:+") the pointer rests on — a string shows
   * that terminal's chip (「PS1 正端 · 5.00 V」), null / '' shows none.
   */
  holeLabelText?(hole: HoleRef): string | null
  /**
   * OPTIONAL (additive, UX fix wave SC-12): text of the NEUTRAL chip shown in
   * select mode (docked chrome) while the mouse rests on a part body or wire
   * away from its own pins — what a click does there, e.g. 「U1 ·
   * STM32F103C8T6 Blue Pill 開發板 · 點一下選取」. Null / '' = no chip.
   * Installed by src/ui/workspace/scene-bridge.ts registerScene.
   */
  objectLabelText?(id: string): string | null
  /**
   * OPTIONAL (additive, UX fix wave SC-13): an end of the ONE selected wire
   * is being dragged (docked chrome shows two end handles) and aims at
   * `ref` (a hole or "ID:PIN" terminal) — return whether moving that end
   * there would be accepted (drives the preview's red tint). Missing = valid.
   */
  onWireEndPreview?(wireId: string, end: 'from' | 'to', ref: string): boolean
  /**
   * OPTIONAL (additive, UX fix wave SC-13): an end handle was dropped. `ref`
   * is the aimed hole / terminal (null: released away from any) — the host
   * re-routes that end (store.moveWireEnd: one undo step) or explains why
   * not (「這裡不能接：…」). The scene snaps the handle back either way; a
   * committed move re-syncs it from the new layout. Installed by
   * src/ui/workspace/scene-bridge.ts registerScene.
   */
  onWireEndMove?(wireId: string, end: 'from' | 'to', ref: string | null): void
  /**
   * OPTIONAL (additive, embedded platform): the component or wire under the
   * mouse pointer changed (desktop hover only — touch never hovers). `id` is
   * the component / wire id (an off-board instrument's id for its terminal
   * posts), null when the pointer leaves every object, crosses onto a grow
   * paddle or leaves the canvas. Fired on change only, from the scene's
   * per-frame hover pass (no extra raycast).
   */
  onObjectHover?(id: string | null): void
  /**
   * OPTIONAL (additive, UX wave SC-6): press / release of an interactive
   * part in 3D. While a simulation session exists (setTelemetry has a
   * non-null value) and the interaction mode is 'select', pointerdown on a
   * component whose catalog entry has a param with key 'pressed' fires
   * (id, true) at once; pointerup / pointercancel / lost capture of that
   * pointer fires (id, false). The tap still resolves to onObjectClick
   * (selection) as before. Never fired without a session.
   */
  onObjectPress?(id: string, down: boolean): void
  /**
   * OPTIONAL (additive, keep-pressed latch 「保持按下」 — src/ui/embedded/latch.ts):
   * a DOUBLE-CLICK on a pressable part (see onObjectPress) that is not
   * latched — two quick clicks, the second pressed within 450 ms of the
   * first's release — asks the host to KEEP it pressed. The second click's
   * pointerdown already fired onObjectPress(id, true); when this returns
   * true its release is NOT reported (the part stays pressed: the host's
   * latch owns it now). False (or no callback) reports the release as
   * usual. On a part the host lists as latched (setLatchedParts) the first
   * click is an ordinary momentary press (its release lets the part go)
   * and the second click of that double-click presses nothing — a
   * double-click toggles.
   */
  onObjectLatch?(id: string): boolean
  /**
   * OPTIONAL (additive, UX wave SC-5): desktop 'contextmenu' over a board
   * hole (including a hole under a part pin) or an off-board terminal post.
   * `screen` is the event's client position (CSS px). The scene calls
   * preventDefault only in that case; elsewhere the browser menu is left
   * alone. The host opens the probe menu (src/ui/workspace/ProbeMenu.tsx).
   *
   * UX fix wave (SC-14): also fired by a touch LONG-PRESS (docked chrome)
   * on a hole, a part pin or a terminal post — `opts.pointer` says which
   * ('touch': the host shows the menu as an ActionSheet; SH-15 opens it
   * outside the workspace too). A long-press on a part / wire body still
   * reports onObjectLongPress. The right-click passes { pointer: 'mouse' }.
   * A long-press on a WIRE END arms its re-route grip (SC-13): dragging
   * re-routes it, lifting without a move asks for the probe menu here.
   * (`pointer` absent = unknown: the host decides by its own pointer query.)
   */
  onProbeRequest?(target: SceneProbeTarget, screen: { x: number; y: number }, opts?: { pointer?: 'mouse' | 'touch' }): void
  /**
   * OPTIONAL (additive, UX wave SC-8): text of the hover chip shown over a
   * "+" grow paddle (desktop hover, docked chrome — non-zero view insets —
   * only) — e.g. 「加接一塊麵包板」, or for its "−" removal chip
   * (`removing`) 「移除這一側的麵包板」. Null / absent = no chip (the classic
   * behaviour). Asked on hover changes only. Installed by
   * src/ui/workspace/scene-bridge.ts registerScene.
   */
  growPaddleLabel?(direction: GridGrowDirection, removing: boolean): string | null
}

/** What a scene probe request points at: exactly one of the two is set. */
export interface SceneProbeTarget {
  /** board hole ref ("c20", "top+3", "1:a12") */
  hole?: HoleRef
  /** off-board terminal ref "ID:PIN" ("PS1:+") */
  terminal?: string
}

export interface GhostSpec {
  type: string
  /** anchor hole under the cursor */
  at: HoleRef
  valid: boolean
  /**
   * OPTIONAL (additive): holes already picked for a multi-click leaded part
   * (store place-mode pickedHoles). With one hole picked for a 2-lead part
   * the scene shows the FULL routed holographic part stretching from the
   * picked hole to the hovered anchor — vertical mounts included.
   */
  picked?: HoleRef[]
  /**
   * OPTIONAL (additive): armed in-plane rotation for dip/footprint packages
   * (store place-mode `mode.rotation`; absent = 0). The hologram renders at
   * this rotation — cycling it (R key / rotate button) spins the hologram
   * with a quick spring — and `valid` should already account for it.
   */
  rotation?: Rotation
}

export interface IBreadboardScene {
  mount(container: HTMLElement): void
  dispose(): void
  setCallbacks(cb: Partial<SceneCallbacks>): void

  /** diff & rebuild meshes to match the layout */
  setLayout(layout: CircuitLayout): void
  /** apply live electrical state (LED glow, 7-seg segments...); null = sim stopped */
  setTelemetry(t: SimTelemetry | null): void
  /** translucent preview of the component being placed; null = none */
  setGhost(ghost: GhostSpec | null): void
  /** highlight selected object ids */
  setSelection(ids: string[]): void
  /** wire-drawing preview from a fixed endpoint to the hovered hole */
  setWirePreview(from: HoleRef | string | null, to: HoleRef | null): void
  /**
   * OPTIONAL (additive): report the app's interaction mode so the scene can
   * adapt touch ergonomics (fingertip ghost-cursor during place/wire; a
   * one-finger touch drag then aims the cursor instead of orbiting). Safe to
   * never call — the scene falls back to inferring the mode from
   * setGhost/setWirePreview.
   */
  setInteractionMode?(mode: SceneInteractionMode): void
  /**
   * OPTIONAL (additive): spring the camera (DESIGN.md spring, reduced-motion
   * jump) to frame the current layout's content. Called by the host after a
   * wholesale layout load (example, JSON import, AI apply) so circuits placed
   * anywhere on the board become visible — the fixed home framing crops phone
   * portrait viewports to a fraction of the board. Falls back to the home
   * framing when the board is empty. Safe to never call.
   */
  frameContent?(): void
  /**
   * OPTIONAL (additive): apply the user's render-mode preference (the
   * Performance / Enhanced / Studio picker in the More sheet →
   * store.renderMode). The scene's RenderModeManager clamps unsupported
   * modes to the device's best fallback and persists the choice under
   * 'bb.renderMode'. Safe to never call — the scene boots from the persisted
   * preference / device auto-default on its own.
   */
  setRenderMode?(mode: RenderModeId): void
  /**
   * OPTIONAL (additive, embedded workspace): screen area covered by docked
   * chrome — CSS px measured from each canvas edge (the desktop workspace's
   * library / inspector panels and bottom tray). The scene then centres the
   * home framing and frameContent() in the FREE rectangle and fits them to
   * it: the projection's principal point moves to the free area's centre
   * (camera view offset — orbit still pivots on the framed target, which
   * stays centred in the free area), and while the camera is parked at the
   * home or content framing it re-frames to the new free area. All-zero
   * insets (the default) leave the camera projection exactly as without this
   * call. Safe to never call.
   */
  setViewInsets?(insets: ViewInsets): void
  /**
   * OPTIONAL (additive, lessons): point at breadboard holes / off-board
   * terminals and placed parts — the lesson coach's current step. Holes
   * reuse the placement pin markers (glowing ring + falling-light beam,
   * valid tint); parts get a hologram shell of their own mesh (a hair larger
   * than the part, so it never z-fights it). `null` or empty lists clear
   * them, and while nothing is highlighted NOTHING is added to the scene
   * graph (rendering is exactly as without this call). Unknown refs / ids
   * are skipped; highlights follow layout edits. Safe to never call.
   */
  setHighlights?(spec: HighlightSpec | null): void
  /**
   * OPTIONAL (additive, UX wave SC-1): spring the camera (DESIGN.md spring;
   * reduced motion jumps) along the current home view direction so the
   * axis-aligned box of the referenced holes / off-board terminals /
   * component and wire meshes (+ 1.5 hole pitches of padding) fits the free
   * rectangle left by setViewInsets — never closer than `minSpanHoles`
   * (default 10) hole pitches across, clamped to the orbit distance limits.
   * Unknown refs / ids are skipped; nothing known = no camera move. Callers
   * go through src/ui/workspace/scene-bridge.ts (focusInScene), never
   * directly. Safe to never call.
   */
  frameTargets?(spec: HighlightSpec, opts?: FrameTargetsOptions): void
  /**
   * OPTIONAL (additive, UX wave SC-1): the PROBLEM highlight layer — a
   * second layer independent of setHighlights (the lesson layer): pulsing
   * ring markers on the holes / terminals (red for 'error', amber for
   * 'risk') and an emissive outline (not a hologram shell) on the
   * components and wires named in `components` (wire ids are accepted
   * there). `null` clears it, and while it is clear NOTHING is added to the
   * scene graph. Driven by scene-bridge focusInScene({…}, { kind: 'problem' }).
   * Safe to never call.
   *
   * UX fix wave (H7, SC-11): level 'info' = --ios-blue rings on the holes plus
   * a thin outline on parts and wires — drawn only by a scene that lists
   * 'info' in `problemHighlightLevels` (the bridge never sends 'info' to a
   * scene that does not, so an older scene never paints a hint red).
   */
  setProblemHighlights?(spec: ProblemHighlightSpec | null): void
  /**
   * OPTIONAL (additive, UX fix wave H7 — SC-11): the problem-layer levels
   * this scene draws. Absent = ['error', 'risk'] (the SC-1 scene).
   */
  readonly problemHighlightLevels?: readonly ProblemHighlightLevel[]
  /**
   * OPTIONAL (additive, UX fix wave H7 — SC-11): a hover-only NEUTRAL marker
   * on what an instrument channel / a pin row / a problem chip points at —
   * rings on the holes / terminals and a thin outline on the parts — while
   * the pointer rests on that control. Never moves the camera; `null` (or
   * empty lists) clears it, and while clear nothing is in the scene graph.
   * Independent of the lesson and problem layers. Driven by scene-bridge
   * highlightSource(). Safe to never call.
   */
  setSourceHighlight?(spec: HighlightSpec | null): void
  /**
   * OPTIONAL (additive, keep-pressed latch 「保持按下」 — src/ui/embedded/latch.ts):
   * the parts the host keeps pressed. Each gets a small lock badge over its
   * top (it follows a moved / rebuilt part; static, never picked), and the
   * double-click rule of SceneCallbacks.onObjectLatch reads the list. The
   * host pushes it on change (bindLatchScene) — never per frame. Safe to
   * never call.
   */
  setLatchedParts?(ids: readonly string[]): void
  /**
   * OPTIONAL (additive, UX fix wave SC-16): the new (docked) chrome is
   * showing — App passes !isLegacyChrome() (the desktop workspace, and the
   * zh-TW phone with its coach and sheets). Picks the screen-space hover chip
   * (SC-12), the wire end handles (SC-13), the touch probe long-press
   * (SC-14) and the grow-paddle gating (near-edge with a mouse; armed part /
   * open parts library with a finger) and their hover label, instead of
   * hasInsets(). Safe to never call (the scene keeps its inset-based guess).
   */
  setDockedChrome?(on: boolean): void
  /**
   * OPTIONAL (additive, UX fix wave SC-16): the parts library is open (the
   * phone's Parts sheet — scene-bridge partsBrowsing). With docked chrome and
   * a coarse pointer the grow paddles show only while it is open or a part
   * is armed. Safe to never call.
   */
  setPartsBrowsing?(open: boolean): void
  /**
   * OPTIONAL (additive, release QA SC-F1): how big one hole pitch looks —
   * the projected distance in CSS px between two neighbouring columns at
   * plan point `at` (default: the centre of the board grid), seen from the
   * camera's RESTING pose (a running camera glide counts by its
   * destination). Null before mount or when the point is behind the
   * camera. Event-driven (an arming on a touch screen), never per frame.
   * Safe to never call.
   */
  holePitchPx?(at?: { x: number; z: number }): number | null
  /**
   * OPTIONAL (additive, contract C1 — src/ui/wire-roles.ts): the display
   * colour of wires by id (colour names / css hex, as Wire.color takes),
   * overriding the stored Wire.color in the wire sync. The product chrome
   * passes wireRoleColors(layout) on every layout change (supply red, ground
   * black, signals by function); null = the stored colours (the classic
   * chrome's behaviour). A wire missing from the map keeps its stored
   * colour. Event-driven, never per frame. Safe to never call.
   */
  setWireColorOverride?(colors: Map<string, string> | null): void
  /**
   * OPTIONAL (additive, contract C2 — 顯示電流): diagnostics of the scene's
   * current-flow layer (one pooled THREE.Points in the overlay group). The
   * layer follows the user's preference itself (src/ui/fx/flow.ts
   * useFlowView — the product chip, the 更多 row, the C key, or a
   * programmatic setVisible in any chrome) and draws only what setTelemetry
   * carries: SimTelemetry.wireCurrents / stripCurrents and
   * ComponentTelemetry.pinCurrents of 2-terminal parts. Null before mount.
   * Event-driven reads only (the perf overlay, e2e). Safe to never call.
   */
  flowStats?(): CurrentFlowStats | null
}

/** IBreadboardScene.flowStats: what the current-flow layer drew last frame. */
export interface CurrentFlowStats {
  visible: boolean
  /** known conductor paths (wires, 2-terminal parts, strip segments in use) */
  paths: number
  /** paths carrying a current above the display threshold */
  activePaths: number
  heads: number
  /** heads + their trail points (one draw call) */
  points: number
  /** CPU time of the layer's last per-frame update (ms) */
  tickMs: number
}

/** Options of IBreadboardScene.frameTargets. */
export interface FrameTargetsOptions {
  /** smallest framed span, in hole pitches (default 10) */
  minSpanHoles?: number
  /**
   * OPTIONAL (additive, release QA SC-F1): frame close enough that a hole
   * pitch at the framed box's centre projects at least this many CSS px —
   * a box too big for that is cut down about its centre (the phone's
   * place / wire framing: ≥ 14 px, a finger can tell the holes apart).
   * A scene that does not know it ignores it.
   */
  minPitchPx?: number
  /**
   * OPTIONAL (additive, release QA SC-F1): CSS px of the canvas's bottom
   * that floating chrome covers during THIS framing beyond the view insets
   * (the phone's Parts sheet at its peek, the wire-colour strip) — the
   * framed box stays above it. Only with view insets (docked chrome); a
   * scene that does not know it ignores it.
   */
  coverBottomPx?: number
  /**
   * OPTIONAL (additive, UX fix wave H7 — SC-11 / LS-11): frame from at least
   * this camera elevation above the board plane (degrees; e.g. 60 for a
   * wiring step, so hole rows are not hidden behind part bodies). Absent =
   * the current home view direction. A scene that does not know it ignores it.
   */
  minElevationDeg?: number
}

/** Problem-layer tints: red 'error', amber 'risk', blue 'info' (H7). */
export type ProblemHighlightLevel = 'error' | 'risk' | 'info'

/** What IBreadboardScene.setProblemHighlights points at (components may name wires). */
export type ProblemHighlightSpec = HighlightSpec & { level: ProblemHighlightLevel }

/** What IBreadboardScene.setHighlights points at. */
export interface HighlightSpec {
  /** hole refs ("c45", "top+3") or off-board terminal refs ("PS1:+") */
  holes?: HoleRef[]
  /** placed component ids */
  components?: string[]
}

/** Docked-chrome insets for IBreadboardScene.setViewInsets (CSS px from each canvas edge). */
export interface ViewInsets {
  left: number
  right: number
  top: number
  bottom: number
}
