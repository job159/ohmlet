/**
 * The 3D breadboard scene — implements IBreadboardScene (src/three/scene-api.ts).
 *
 * Owns the renderer / camera / controls / lights / board mesh / wires / ghost
 * / picking. Component visuals are delegated to src/three/component-meshes.ts.
 *
 * Units: 1 unit = one hole pitch; board top surface at y = 0.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MAX_BOARD_COUNT, MAX_BOARD_ROWS, STRIP_ROWS, boardConfigOf, isRotation } from '../model/types'
import type {
  BoardConfig,
  CircuitLayout,
  ComponentInstance,
  Hole,
  HoleRef,
  ParamValue,
  Rotation,
  SimTelemetry,
  Wire,
} from '../model/types'
import {
  BOARD_ROW_PITCH,
  ROW_Z,
  allHoles,
  boardExtents,
  componentPinHoles,
  dipHoles,
  footprintHoles,
  formatHole,
  holePosition,
  offboardBodyPosition,
  offboardBodyRect,
  offboardGeometryOf,
  offboardSlotSpan,
  offboardTerminalPosition,
  parseHole,
  parseTerminalRef,
  rotateOffsetDelta,
} from '../model/breadboard'
import { occludedHoles } from '../model/occlusion'
import { getEntry, type CatalogEntry } from '../model/catalog'
import {
  buildComponentObject,
  disposeComponentObject,
  hasComponentUpdater,
  sameVisualTelemetry,
  telemetryAnimates,
  updateComponentVisual,
  type BuiltComponent,
} from './component-meshes'
import type { ComponentTelemetry } from '../model/types'
import type { RoutedComponent } from './internal/wire-router'
import type {
  FrameTargetsOptions,
  GhostSpec,
  GridGrowDirection,
  HighlightSpec,
  IBreadboardScene,
  ProblemHighlightLevel,
  ProblemHighlightSpec,
  SceneCallbacks,
  SceneInteractionMode,
  SceneMoveTarget,
  SceneProbeTarget,
  ViewInsets,
} from './scene-api'
import { buildBoard, type BoardBuild } from './internal/board'
import { SpawnFX, type PuffRect } from './internal/spawn-fx'
import { HoleIndex } from './internal/hole-index'
import {
  TERMINAL_TOP_Y,
  WIRE_TIP_LEN,
  WIRE_TIP_SINK,
  planRoutes,
  planVersion,
  previewComponentPose,
  previewWireGeometry,
  routedBodyFor,
  routedComponentPose,
  routedComponentSignature,
  routedWireSignature,
  wireColorFor,
  wireGeometry,
} from './internal/wires'
import {
  applyHologram,
  applyOutline,
  disposeHolograms,
  makeHologramMaterial,
  makeOutlineMaterial,
  makePinMarkers,
  restartProblemPulse,
  setHologramReducedMotion,
  tickHolograms,
  type HologramVariant,
  type PinMarkers,
} from './internal/hologram'
import {
  SCREEN_CHIP_EDGE_PX,
  makeHoleLabel,
  makeHoverRing,
  makeScreenChip,
  placeScreenChip,
  type ChipRect,
  type ChipTone,
  type HoleLabel,
  type HoverRing,
  type ScreenChip,
} from './internal/hole-fx'
import { RenderModeManager, type RenderModeId } from './render-modes/manager'
import { fmtPercent } from '../instruments/format'

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Off-board terminal posts are DRAWN by the instrument mesh itself (panel-
 *  mounted binding posts, meshes/instruments.ts — one visual source of
 *  truth); the scene keeps one INVISIBLE box per post as the pick/touch
 *  proxy, aligned over the mesh post and sized generously for fingers.
 *  three's Raycaster tests invisible meshes too, so every existing terminal
 *  raycast keeps working while nothing extra renders or casts shadows. */
const POST_PROXY_W = 0.9
const POST_PROXY_H = 0.9
const POST_PROXY_D = 1.1
/** proxy-center offset from the wire attach point (x, TERMINAL_TOP_Y, z):
 *  down to the post's horizontal axis, back over the body toward the panel */
const POST_PROXY_DY = -0.1
const POST_PROXY_DZ = -0.25
/** min plan gap between neighboring proxies of a fine-pitch terminal row */
const POST_PROXY_GAP = 0.1
const HOLE_SNAP_DIST = 0.55
/** coarse-pointer snap radius (DESIGN.md §4: fingers need bigger targets) */
const HOLE_SNAP_DIST_TOUCH = 0.9
/** mouse click discrimination (unchanged desktop behavior) */
const CLICK_MAX_PX = 6
const CLICK_MAX_MS = 400
/** touch tap discrimination (DESIGN.md §4: moved < 10px && < 350ms) */
const TAP_MAX_PX = 10
const TAP_MAX_MS = 350
/** long-press on a component/wire → onObjectLongPress (10px hold tolerance) */
const LONG_PRESS_MS = 500
const LONG_PRESS_MAX_PX = 10
/** double-tap/double-click empty space → re-frame (gap between the two taps) */
const DOUBLE_TAP_MS = 450
const DOUBLE_TAP_MAX_PX = 40
/** plan-units the fingertip ghost-cursor floats toward the top of the screen */
const FINGERTIP_OFFSET_UNITS = 2.5
/** the cursor's screen offset is clamped to a finger-sized px band so extreme
 *  zoom levels keep the aim ring visible just above the fingertip */
const FINGERTIP_OFFSET_MIN_PX = 44
const FINGERTIP_OFFSET_MAX_PX = 88
/** screen-space probe (px) used to find the screen-up direction on the board */
const FINGERTIP_PROBE_PX = 24
/** terminal-post snap radius for the fingertip cursor (posts are chunky) */
const TERMINAL_SNAP_DIST_TOUCH = 1.25
/** touch slop for body/wire/post picking (px): a wire tube is ~6px on screen,
 *  far under the 44px touch-target rule (DESIGN.md §4) */
const OBJECT_TOUCH_SLOP_PX = 22
/** ring sample pattern [radius px, sample count] for the slop raycast */
const SLOP_RINGS: ReadonlyArray<readonly [number, number]> = [
  [6, 6],
  [12, 10],
  [18, 12],
  [22, 14],
]
/** camera re-frame tween duration */
const REFRAME_MS = 450
/** home view direction (unit vector, target → camera): the elevated 3/4 view */
const HOME_DIR = new THREE.Vector3(-6, 36, 40).normalize()
/** camera basis for the home direction (used by the fit-to-content math) */
const HOME_FWD = HOME_DIR.clone().negate()
const HOME_RIGHT = new THREE.Vector3().crossVectors(HOME_FWD, new THREE.Vector3(0, 1, 0)).normalize()
const HOME_UP = new THREE.Vector3().crossVectors(HOME_RIGHT, HOME_FWD).normalize()
/** A view direction's camera basis (forward = target → scene, right, up). */
export interface ViewBasis {
  fwd: THREE.Vector3
  right: THREE.Vector3
  up: THREE.Vector3
}
const HOME_BASIS: ViewBasis = { fwd: HOME_FWD, right: HOME_RIGHT, up: HOME_UP }
/** elevation of the home view direction above the board plane (degrees, ≈ 41.7°) */
const HOME_ELEVATION_DEG = THREE.MathUtils.radToDeg(Math.asin(HOME_DIR.y))

/**
 * frameTargets' minElevationDeg (H7 / LS-11): the home view direction raised
 * to at least `deg` above the board plane, same azimuth — a wiring step from
 * 60° sees the far a-row past a raised Blue Pill. Null when the home
 * direction is already that steep (or no / an invalid value), so the
 * classic framing path stays untouched.
 */
function elevatedViewDir(deg: number | undefined): THREE.Vector3 | null {
  if (deg === undefined || !Number.isFinite(deg)) return null
  const e = THREE.MathUtils.degToRad(Math.min(85, deg))
  if (deg <= HOME_ELEVATION_DEG) return null
  const h = Math.hypot(HOME_DIR.x, HOME_DIR.z) || 1
  return new THREE.Vector3((HOME_DIR.x / h) * Math.cos(e), Math.sin(e), (HOME_DIR.z / h) * Math.cos(e)).normalize()
}

/** The camera basis looking along −`dir` (dir = target → camera). */
function viewBasis(dir: THREE.Vector3): ViewBasis {
  const fwd = dir.clone().negate()
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize()
  return { fwd, right, up }
}
/** y-range of framable content (board slab bottom … tallest part) */
const HOME_MIN_Y = -1.2
const HOME_MAX_Y = 3.2
const HOME_FIT_MARGIN = 1.05
const MIN_HOME_DISTANCE = 20
const WIRE_RADIUS = 0.16
const PREVIEW_RADIUS = 0.07
const SELECT_EMISSIVE = 0x2f6bff
const SELECT_INTENSITY = 0.55
const SELECT_BOX_PAD = 0.35
/** hover ring lift: floats just above the flush board face (sockets recess) */
const HOVER_RING_LIFT = 0.05
/** hole-coordinate chip anchor height above the board (bottom-center) */
const HOLE_LABEL_Y = 1.5
/** ...and above the fingertip aim ring while touch-aiming */
const FINGERTIP_LABEL_Y = 2.3
/** clicked-hole chip stays pinned this long (desktop QOL) */
const LABEL_PIN_MS = 1200
/** default plan span of the routed ghost before the first hole is picked */
const GHOST_DEFAULT_SPAN = 3
/** "+" grow paddles (one per grid edge): plate size / float pose / spring-in */
const PADDLE_SIZE = 2.8
const PADDLE_GAP = 1.6 // plan gap between board edge and plate
const PADDLE_Y = 1.9 // plate center height
const PADDLE_TILT = -0.42 // lean back toward the camera (radians)
/** "−" removal chip: a quiet companion revealed beneath a hovered "+" paddle */
const PADDLE_MINUS_SCALE = 0.52 // chip size relative to the + plate
const PADDLE_MINUS_DROP = 2.35 // local-y offset beneath the + plate
/**
 * Board SPAWN animation (grow paddles): the freshly built module column /
 * board-row DROPS in from above — a gravity-feel ease-in fall with a slight
 * tilt that levels out, then a one-beat squash-and-relax settle on the house
 * spring, plus a tiny pooled dust puff at touchdown (~650ms total). The new
 * meshes are FULLY BUILT before the first animated frame (transform-only
 * tween of prebuilt groups) and the tween clock starts on the first rAF tick
 * AFTER the synchronous rebuild, so the fall never starts mid-air; the
 * camera glide home waits for the settle (drop → settle → dust → glide).
 */
const SPAWN_DROP_MS = 290
const SPAWN_SETTLE_MS = 360
const SPAWN_DROP_HEIGHT = 9
const SPAWN_TILT_RAD = (2.5 * Math.PI) / 180
const SPAWN_SQUASH = 0.035 // scaleY dips to ~0.965 at touchdown, then relaxes
/** reduced-motion spawn: simple material fade-in (no fall, no dust) */
const SPAWN_FADE_MS = 240
/** scene-initiated module/row removal: quick lift + fade + a smaller puff */
const REMOVE_MS = 300
const REMOVE_LIFT = 2.6
/** ghost-rotation spin spring (R key / rotate button cycles the hologram) */
const GHOST_SPIN_MS = 220
/** lesson highlight shell: clearance around the part on every side (plan units ≈ 0.2 mm) */
const HIGHLIGHT_CLEARANCE = 0.08
/** live LED brightness labels (SC-10): refresh at most this often (ms) */
const LED_LABEL_REFRESH_MS = 250
/** …float this far above the part's top (plan units) */
const LED_LABEL_LIFT = 0.45
/** …and never shrink below this card height on screen (CSS px) */
const LED_LABEL_MIN_PX = 22
/** drag must travel this many px before a move-drag/marquee starts (a tap stays a tap) */
const DRAG_START_PX = 5
const DRAG_START_PX_TOUCH = 8
/** snap radius (plan units) for re-anchoring a dragged package */
const MOVE_ANCHOR_SNAP = 0.9
/** instrument drags snap their bench anchor to the model's 0.5 grid */
const INSTRUMENT_GRID = 0.5
/** validity tint of the instrument-drag overlay box (hologram palette) */
const DRAG_TINT_VALID = 0x66ccff
const DRAG_TINT_INVALID = 0xff453a

// circuit-first framing (UX wave SC-1) — docked-chrome (non-zero insets) and
// frameTargets only; the zero-inset content framing is the classic sphere fit
/** plan padding around framed content / targets (hole pitches) */
const FRAME_PAD = 1.5
/** smallest span frameContent zooms to (hole pitches across) */
const CONTENT_MIN_SPAN = 12
/** frameTargets default: never closer than this many hole pitches across */
const TARGETS_MIN_SPAN = 10
/** headroom inside the free rectangle (fit window shrunk by this factor) */
const FIT_MARGIN = 1.06
/**
 * Bands inside the free rectangle that floating chrome still covers in the
 * workspace (CSS px): the status capsule along the top edge, the undo pill /
 * toasts along the bottom edge. The box fit keeps content out of them.
 */
const FIT_RESERVE_TOP_PX = 76
const FIT_RESERVE_BOTTOM_PX = 56
/** frameTargets minPitchPx (release QA SC-F1): fit refinements, and the share of the wanted pitch that counts as reached */
const MIN_PITCH_FIT_STEPS = 8
const MIN_PITCH_TOLERANCE = 0.995
/** …and the gain a column cut must bring to count (else the rows bind) */
const MIN_PITCH_GAIN = 1.01

/** frameTargets' optional fit constraints (release QA SC-F1), kept with lastTargetFrame for the re-fit. */
interface TargetFitExtras {
  /** a hole pitch at the framed box's centre projects at least this many CSS px */
  minPitchPx?: number
  /** CSS px of the canvas bottom that chrome covers during this framing */
  coverBottomPx?: number
}
/**
 * Portrait free rectangle (phones, SH-15): the share of the fit window's
 * spare height left above a width-bound circuit — high in the view, with
 * room for the touch chip above the finger, instead of centred under a
 * 35–40 % empty band.
 */
const PORTRAIT_ANCHOR_Y = 0.2
/** selection-follow: re-frame when more than this fraction of the selection is under chrome */
const FOLLOW_HIDDEN_MAX = 0.4
/** selection-follow pan keeps this much air (px) between the selection and the chrome */
const FOLLOW_MARGIN_PX = 16
/** hover chip: live values (pin mode / voltage) refresh at most this often (ms) */
const CHIP_REFRESH_MS = 250
/**
 * Floating chrome the docked-chrome hover chip keeps clear of (SC-12): the
 * run capsule, the status pill, the wire colour strip, the undo pill and
 * toasts — plus anything that marks itself `data-scene-avoid`. Measured when
 * the chip is (re)aimed, never per frame.
 */
const CHIP_AVOID_SELECTOR =
  '[data-scene-avoid], .app-run-capsule, .app-status-pill.is-in, .app-wire-strip, .app-undo-pill, .lg-toast'
/** the hovered part's screen box is kept clear only while it is smaller than this share of the free area */
const CHIP_PART_AVOID_MAX = 0.2
/** a hole within this plan distance (hole pitches) of a part pin points at that part (chip avoidance) */
const CHIP_PART_NEAR = 1.6
/** wire aiming, mouse: an off-board terminal post within this many px counts when no hole is near */
const TERMINAL_HOVER_SLOP_PX = 14
/** wire end handles (SC-13): on-screen diameter (CSS px) for a mouse / a finger, and their grab radius */
const WIRE_HANDLE_PX = 18
const WIRE_HANDLE_PX_TOUCH = 30
const WIRE_HANDLE_GRAB_PX = 14
const WIRE_HANDLE_GRAB_PX_TOUCH = 28
/** chip keys outside the hover pass: a click-pinned chip / one whose pin expired (the next pass redraws) */
const PINNED_CHIP_KEY = '!pin'
const STALE_CHIP_KEY = '!stale'
/** flyCamera to (within) this squared world distance of the current pose moves nothing on screen: the hover chip stays */
const CAMERA_STILL_EPS2 = 1e-6
/** right-button press → contextmenu farther than this (px) was an orbit pan, not a probe */
const PROBE_MAX_DRIFT_PX = 6
/** probe pick: a hit on a part body within this plan distance of one of its pins probes that pin */
const PROBE_PIN_SNAP = 1.2
/** …a touch long-press must land closer (on the leg / header itself): the body keeps its action sheet */
const PROBE_PIN_SNAP_TOUCH = 0.6
/** press in 3D: a click lasts at least this long in SIMULATED time (s) — a human click, past a 20–50 ms debounce */
const MIN_PRESS_SIM_S = 0.08
/** …but a held-back release never waits longer than this (wall ms; a paused session) */
const PRESS_RELEASE_CAP_MS = 1500

// --- rendering pipeline (see DESIGN.md 'Rendering') -------------------------
/** ACES filmic exposure (tuned by eye against the glass UI via screenshots) */
const EXPOSURE = 1.05
/** RoomEnvironment IBL strength — what makes the PBR metals/glass read */
const ENV_INTENSITY = 0.85
/** warm key light: direction (target → light, normalized) + intensity */
const KEY_DIR = new THREE.Vector3(0.5, 1.05, 0.55).normalize()
const KEY_COLOR = 0xfff0dd
const KEY_INTENSITY = 1.2
const FILL_COLOR = 0xbcd0ff
const FILL_INTENSITY = 0.22
/** ONE shadow map for the whole scene (phone perf budget) */
const SHADOW_MAP_SIZE = 2048
/** lit laminate desk plane (receives the key-light shadow physically) */
const GROUND_BACKDROP_Y = -1.3
const GROUND_SIZE = 640
/**
 * Camera layer for the Studio raster-overlay compositing pass: everything
 * excluded from the path-traced still (overlay subtree + grow paddles) is
 * re-rendered on top of the presented path-traced frame through this layer,
 * so holograms / hover FX / selection stay live while a still converges or
 * holds. Layer 0 membership is never removed — the normal raster pipelines
 * keep drawing the same objects untouched.
 */
const OVERLAY_LAYER = 1
const enableOverlayLayer = (o: THREE.Object3D): void => {
  o.layers.enable(OVERLAY_LAYER)
}
/**
 * Telemetry-driven material refreshes (LED emissive, display segments) reach
 * Studio at most this often: each refresh restarts path-traced accumulation
 * by design (the still must show live LED state), but the running sim pushes
 * telemetry every frame and re-packing the path tracer's material texture at
 * 60Hz would be pure waste while accumulation can never get past a frame.
 */
const MATERIALS_REFRESH_MS = 250

const EMPTY_LAYOUT: CircuitLayout = { version: 1, components: [], wires: [] }

// ---------------------------------------------------------------------------
// Internal record types
// ---------------------------------------------------------------------------

interface ComponentRecord {
  comp: ComponentInstance
  entry: CatalogEntry
  built: BuiltComponent
  signature: string
  /** wire attachment point per pin (hole tops at y=0; terminal post tops) */
  attach: THREE.Vector3[]
  /** invisible terminal-post hit proxies (empty for on-board parts) — the
   *  visible posts are part of the instrument mesh */
  posts: THREE.Mesh[]
  /** default-shelf slot of an off-board unit (offboardSlotSpan-advanced; -1 for on-board parts) */
  slot: number
}

interface WireRecord {
  wire: Wire
  group: THREE.Group
  signature: string
  /** merged insulation geometry (tube + baked end caps) — per-wire, disposed */
  geo: THREE.BufferGeometry
  /** merged bare-tip pin geometry (board-hole ends), when any — disposed */
  tipsGeo: THREE.BufferGeometry | null
  material: THREE.MeshStandardMaterial
}

/** What the fingertip ghost-cursor is snapped to: a board hole or a terminal post. */
type FingertipTarget =
  | { kind: 'hole'; hole: HoleRef }
  | { kind: 'terminal'; ref: string; x: number; z: number }

/**
 * What place / wire mode aims at (SC-9, resolveAimTarget): the hover chip
 * names exactly this and a click commits exactly this. `occluded`: a part
 * body covers the hole (the click is rejected with the red locked chip).
 */
type AimTarget = { kind: 'hole'; hole: HoleRef; occluded: boolean } | { kind: 'terminal'; ref: string }

/** First pickable thing along a ray: a terminal post or a component / wire id. */
type PickHit = { terminalRef?: string; componentId?: string }

/** What the hover chip names: an aim target, or (select mode, docked chrome) a part body. */
type HoverTarget = AimTarget | { kind: 'object'; id: string }

/** One of the four "+" grow paddles (per 2-D grid edge). */
interface PaddleRecord {
  dir: GridGrowDirection
  group: THREE.Group
  plate: THREE.Mesh
  mat: THREE.MeshPhysicalMaterial
  glyphMat: THREE.MeshBasicMaterial
  /**
   * The quiet "−" removal chip (right/down paddles only — the store can only
   * shrink those edges): revealed beneath the + plate while the paddle is
   * hovered on desktop AND the axis has more than one module/row; touch uses
   * a long-press on the + paddle instead. `minusReveal` is the eased 0..1
   * reveal driven per frame in updatePaddles (number writes only).
   */
  minus: THREE.Group | null
  minusPlate: THREE.Mesh | null
  minusMat: THREE.MeshPhysicalMaterial | null
  minusGlyphMat: THREE.MeshBasicMaterial | null
  minusReveal: number
}

/**
 * A temporary material-fade over a board subtree (reduced-motion spawn
 * fade-in; removal fade-out). Materials are CLONED per unique source and
 * swapped in — the build's shared materials are never mutated — then either
 * restored (fade-in) or dropped with the disposed old build (removal).
 * Bounded one-time cost at the user's tap, never per frame.
 */
interface FadeSet {
  swaps: {
    mesh: THREE.Mesh
    original: THREE.Material | THREE.Material[]
    renderOrder: number
  }[]
  clones: { mat: THREE.Material; base: number }[]
}

/**
 * Clone + swap transparent materials under `roots` for an opacity fade.
 * Render order is forced to mirror the boards' opaque layering (slabs first,
 * then the interior socket bores, printed decals last): renderOrder beats
 * three's transparent depth sort, so depth-tested writes keep the dark bore
 * interiors INSIDE the fading body instead of compositing over it.
 */
function buildFadeSet(roots: THREE.Object3D[]): FadeSet {
  const cloneOf = new Map<THREE.Material, THREE.Material>()
  const set: FadeSet = { swaps: [], clones: [] }
  const cloned = (src: THREE.Material): THREE.Material => {
    let c = cloneOf.get(src)
    if (!c) {
      c = src.clone()
      c.transparent = true
      cloneOf.set(src, c)
      set.clones.push({ mat: c, base: src.transparent ? src.opacity : 1 })
    }
    return c
  }
  for (const root of roots) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const wasTransparent = Array.isArray(mesh.material)
        ? mesh.material.some((mm) => mm.transparent)
        : mesh.material.transparent
      set.swaps.push({ mesh, original: mesh.material, renderOrder: mesh.renderOrder })
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(cloned)
        : cloned(mesh.material)
      mesh.renderOrder = wasTransparent
        ? 6 // decals stay on top of the body they label
        : (mesh as THREE.InstancedMesh).isInstancedMesh
          ? 5 // socket bores draw after the slabs → depth-tested inside them
          : 4 // body slabs / channel floors first (cloned depthWrite kept)
    })
  }
  return set
}

/** Drive every cloned material to `k` × its base opacity (number writes). */
function setFadeOpacity(set: FadeSet, k: number): void {
  for (const c of set.clones) (c.mat as THREE.Material & { opacity: number }).opacity = c.base * k
}

/** Restore the original materials (fade-in end) and free the clones. */
function disposeFadeSet(set: FadeSet, restore: boolean): void {
  if (restore) {
    for (const s of set.swaps) {
      s.mesh.material = s.original
      s.mesh.renderOrder = s.renderOrder
    }
  }
  for (const c of set.clones) c.mat.dispose()
  set.swaps.length = 0
  set.clones.length = 0
}

/** An in-flight move-drag of the selected on-board part(s). */
interface MoveDrag {
  /** selected on-board component ids the drag translates (wires stay put) */
  ids: string[]
  /** board-plane grab point at pointerdown */
  grab: THREE.Vector3
  /** single dip/footprint package → anchor-form re-anchor; else delta form */
  anchor: { pos: { x: number; z: number } } | null
  /** delta-form reference strip hole (first strip pin of the moved set) */
  ref: { col: number; rowIdx: number; boardRow: number; x: number; z: number } | null
  /** passed the start threshold (hologram visible, taps suppressed) */
  started: boolean
  target: SceneMoveTarget | null
  valid: boolean
  /** group hologram of the moved part(s), translated to the candidate spot */
  holo: THREE.Group | null
  holoVariant: HologramVariant
}

/** An in-flight bench drag of a selected off-board instrument. */
interface InstrumentDrag {
  id: string
  /** current body anchor (explicit pos or the legacy slot shelf) */
  origin: { x: number; z: number }
  grab: THREE.Vector3
  started: boolean
  /** snapped candidate anchor (0.5 grid) */
  pos: { x: number; z: number }
  valid: boolean
  /** original world positions of the unit's terminal posts */
  postBase: THREE.Vector3[]
  /** validity tint box over the dragged enclosure */
  tint: THREE.Mesh | null
  tintMat: THREE.MeshBasicMaterial | null
  /** world center the tint box returns to at zero offset */
  tintBase: THREE.Vector3
  /**
   * the unit's own selection box(es), hidden while the tint box stands in for
   * them — they would otherwise stay behind at the origin, an empty box,
   * while the real unit (its whole footprint) slides
   */
  hiddenSel: THREE.Mesh[]
}

/**
 * A drag of a selected wire's end handle (UX fix wave SC-13): the end
 * follows the aim resolver (hole / terminal, same chip as wiring) and the
 * drop re-routes it through the host (onWireEndMove — one undo step).
 */
interface WireEndDrag {
  wireId: string
  end: 'from' | 'to'
  /** world point of the end that stays put */
  fixed: THREE.Vector3
  pointerId: number
  /** touch: armed by a long-press on the handle (a move before it is an orbit) */
  armed: boolean
  started: boolean
  target: AimTarget | null
  valid: boolean
  preview: THREE.Mesh | null
}

/** A desktop shift+drag marquee (screen-space overlay rectangle). */
interface MarqueeDrag {
  startX: number
  startY: number
  curX: number
  curY: number
  el: HTMLDivElement | null
  started: boolean
}

/** Everything created at mount() and torn down at dispose(). */
interface Mounted {
  container: HTMLElement
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  board: BoardBuild
  componentsGroup: THREE.Group
  wiresGroup: THREE.Group
  terminalsGroup: THREE.Group
  overlayGroup: THREE.Group
  /** image-based lighting (PMREM'd RoomEnvironment) */
  pmrem: THREE.PMREMGenerator
  envTex: THREE.Texture
  /** warm key (the one shadow caster) + dim cool fill */
  keyLight: THREE.DirectionalLight
  fillLight: THREE.DirectionalLight
  /** desk: lit laminate plane, receives the key shadow (recentered on board rebuild) */
  groundGroup: THREE.Group
  groundGeo: THREE.PlaneGeometry
  backdropMat: THREE.MeshStandardMaterial
  backdropTexs: THREE.Texture[]
  /** shared FX clock (holograms, hover ring, paddle pulse) */
  clock: THREE.Clock
  /** prefers-reduced-motion, sampled at mount */
  reduced: boolean
  /** hovered-hole FX: phosphor glow ring + pooled coordinate chip */
  hoverRing: HoverRing
  holeLabel: HoleLabel
  /** docked chrome's hover chip: a screen-space DOM card (SC-12; holeLabel is the classic chrome's) */
  screenChip: ScreenChip
  /** four "+" grow paddles (select mode, sim stopped, axis below its cap) */
  paddles: PaddleRecord[]
  paddleGeos: THREE.BufferGeometry[]
  /** pooled touchdown dust (board spawn/removal FX — internal/spawn-fx.ts) */
  spawnFx: SpawnFX
  /** fingertip ghost-cursor (touch aiming in place/wire modes) */
  fingertipGroup: THREE.Group
  fingertipGeos: THREE.BufferGeometry[]
  fingertipRingMat: THREE.MeshBasicMaterial
  fingertipGlowMat: THREE.MeshBasicMaterial
  fingertipCrossMat: THREE.MeshBasicMaterial
  /** default camera framing — the re-frame destination for an empty board */
  homePos: THREE.Vector3
  homeTarget: THREE.Vector3
  /** shared unit-box geometry + material for selection highlight overlays */
  selBoxGeo: THREE.BoxGeometry
  selBoxMat: THREE.MeshBasicMaterial
  /** clone source for wire end caps (baked into each wire's merged tube) */
  capGeo: THREE.SphereGeometry
  /** clone source + shared material for the exposed tinned wire tips */
  tipGeo: THREE.CylinderGeometry
  tipMat: THREE.MeshStandardMaterial
  /** shared geometry + material for the invisible terminal-post hit proxies */
  postGeo: THREE.BoxGeometry
  postMat: THREE.MeshBasicMaterial
  previewMesh: THREE.Mesh | null
  previewMat: THREE.MeshBasicMaterial
  resizeObserver: ResizeObserver
  raf: number
  /** false while the tab is hidden — the render loop is fully paused */
  rafActive: boolean
  /** preallocated raycast root lists (no per-frame array churn) */
  objectPickRoots: THREE.Object3D[]
  hoverPickRoots: THREE.Object3D[]
  removeListeners(): void
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Mesh-rebuild signature. Runtime params (pot position, switch state, pressed,
 * PSU voltage...) are excluded: they change on every slider drag while the sim
 * runs and their visuals are applied via updateComponentVisual — only
 * structural changes (type, placement, build-time params) force a rebuild.
 */
function componentSignature(
  comp: ComponentInstance,
  entry: CatalogEntry,
  slot: number,
  config: BoardConfig,
): string {
  let params: Record<string, ParamValue> | null = null
  if (comp.params) {
    const runtimeKeys = new Set<string>()
    for (const def of entry.params ?? []) if (def.runtime) runtimeKeys.add(def.key)
    for (const key of Object.keys(comp.params).sort()) {
      if (runtimeKeys.has(key)) continue
      ;(params ??= {})[key] = comp.params[key]
    }
  }
  return JSON.stringify({
    t: comp.type,
    at: comp.at ?? null,
    h: comp.holes ?? null,
    rot: comp.rotation ?? 0,
    // explicit instrument bench position (movable instruments)
    pos: comp.pos ? `${comp.pos.x},${comp.pos.z}` : null,
    p: params,
    s: slot,
    // a rig change (size × modules × board-rows) re-validates every placement
    b: `${config.size}x${config.count}x${config.rows ?? 1}`,
    // a routed part rebuilds when re-planning moved its body pose
    r: routedComponentSignature(comp.id),
  })
}

/** Plan z of strip row index `i` (0 = a … 9 = j), extrapolated past the board edges. */
function rowZ(i: number): number {
  if (i >= 0 && i < STRIP_ROWS.length) return ROW_Z[STRIP_ROWS[i]]
  if (i < 0) return ROW_Z.a + i * (ROW_Z.b - ROW_Z.a)
  return ROW_Z.j + (i - (STRIP_ROWS.length - 1)) * (ROW_Z.j - ROW_Z.i)
}

/**
 * Where a DIP / footprint package anchored at `at` WOULD put its pins when it
 * does not fit (rows / columns past the rig's edges, the wrong anchor row) —
 * unclamped plan positions for the red "doesn't fit here" ghost (SC-8).
 * Null for anchors that are not strip holes or quarter-turned DIPs.
 */
function rawPackagePins(at: Hole, entry: CatalogEntry, rotation: Rotation): { x: number; z: number }[] | null {
  if (at.kind !== 'strip') return null
  const dz = (at.boardRow ?? 0) * BOARD_ROW_PITCH
  const atIdx = STRIP_ROWS.indexOf(at.row)
  if (entry.placement === 'dip') {
    if (rotation === 90 || rotation === 270) return null
    const half = Math.floor(entry.pins.length / 2)
    if (half < 1) return null
    // the dipHoles walk (pin 1 at the anchor, the row above coming back);
    // 180 occupies the same holes with the pin walk rotated by half
    const out: { x: number; z: number }[] = []
    for (let i = 0; i < half; i++) out.push({ x: at.col + i, z: rowZ(atIdx) + dz })
    for (let i = 0; i < half; i++) out.push({ x: at.col + half - 1 - i, z: rowZ(atIdx - 1) + dz })
    return rotation === 180 ? [...out.slice(half), ...out.slice(0, half)] : out
  }
  const offs = entry.footprintOffsets
  if (!offs || offs.length === 0) return null
  const anchorIdx = STRIP_ROWS.indexOf(offs[0].row)
  return offs.map((o) => {
    const d = rotateOffsetDelta(o.dCol, STRIP_ROWS.indexOf(o.row) - anchorIdx, rotation)
    return { x: at.col + d.dCol, z: rowZ(atIdx + d.dRow) + dz }
  })
}

/** A fit window in view-plane tangents around the principal point (xl < 0 < xr, yb < 0 < yt). */
export interface FitWindow {
  xl: number
  xr: number
  yb: number
  yt: number
}

/**
 * Pure framing math (SC-1, exported for tests): looking along the home view
 * direction (HOME_FWD, camera at `tgt + HOME_DIR · d`), find the smallest
 * distance `d` at which every corner projects inside `win`, sliding `tgt`
 * IN the board plane (y unchanged) so the projected corners sit centred in
 * the window — a few fixed-point steps (a plan move along screen-right is
 * exact; along the horizontal "screen up" it shifts the image by
 * sin(elevation) per unit, and the depth change is absorbed by iterating).
 * `anchorY` places the projected box vertically: the share of the window's
 * spare height left ABOVE it — 0.5 (default) centres it exactly as before,
 * a smaller value lifts it toward the top (a portrait phone, SH-15).
 * Mutates `tgt`; returns d. Event-driven (framing calls), no vector churn.
 */
export function fitCornersAlongHome(
  corners: readonly THREE.Vector3[],
  win: FitWindow,
  tgt: THREE.Vector3,
  basis: ViewBasis = HOME_BASIS,
  anchorY = 0.5,
): number {
  const { xl, xr, yb, yt } = win
  const { fwd: HOME_FWD, right: HOME_RIGHT, up: HOME_UP } = basis
  const gx = HOME_FWD.x
  const gz = HOME_FWD.z
  const gl = Math.hypot(gx, gz) || 1
  const sinE = Math.max(0.2, (gx * HOME_UP.x + gz * HOME_UP.z) / gl)
  /** smallest distance that puts every corner inside the window (≥ 1 unit in front) */
  const distance = (): number => {
    let dd = 1
    for (const c of corners) {
      const ox = c.x - tgt.x
      const oy = c.y - tgt.y
      const oz = c.z - tgt.z
      const px = ox * HOME_RIGHT.x + oy * HOME_RIGHT.y + oz * HOME_RIGHT.z
      const py = ox * HOME_UP.x + oy * HOME_UP.y + oz * HOME_UP.z
      const pf = ox * HOME_FWD.x + oy * HOME_FWD.y + oz * HOME_FWD.z
      dd = Math.max(dd, px / xr - pf, px / xl - pf, py / yt - pf, py / yb - pf, 1 - pf)
    }
    return dd
  }
  for (let iter = 0; iter < 6; iter++) {
    const d = distance()
    // where the corners land at that distance → slide the target to centre them
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const c of corners) {
      const ox = c.x - tgt.x
      const oy = c.y - tgt.y
      const oz = c.z - tgt.z
      const depth = d + ox * HOME_FWD.x + oy * HOME_FWD.y + oz * HOME_FWD.z
      const sx = (ox * HOME_RIGHT.x + oy * HOME_RIGHT.y + oz * HOME_RIGHT.z) / depth
      const sy = (ox * HOME_UP.x + oy * HOME_UP.y + oz * HOME_UP.z) / depth
      if (sx < minX) minX = sx
      if (sx > maxX) maxX = sx
      if (sy < minY) minY = sy
      if (sy > maxY) maxY = sy
    }
    const ex = (minX + maxX) / 2 - (xl + xr) / 2
    // centred: the classic expression, bit for bit; otherwise the top edge
    // goes `anchorY` of the spare height below the window's top
    const ey =
      anchorY === 0.5
        ? (minY + maxY) / 2 - (yb + yt) / 2
        : maxY - (yt - anchorY * Math.max(0, yt - yb - (maxY - minY)))
    if (Math.abs(ex) < 1e-4 && Math.abs(ey) < 1e-4) break
    tgt.x += HOME_RIGHT.x * ex * d + (gx / gl) * ((ey * d) / sinE)
    tgt.z += HOME_RIGHT.z * ex * d + (gz / gl) * ((ey * d) / sinE)
  }
  return distance()
}

/**
 * Parts whose face must stay readable under a lesson highlight (SC-3): the
 * bench instruments (multimeter, power supply, function generator…) and
 * display modules get an outline rim + terminal rings, never a hologram
 * shell over their LCD / panel.
 */
function keepsReadoutVisible(entry: CatalogEntry): boolean {
  return entry.placement === 'offboard' || entry.category === 'display' || emitsLight(entry)
}

/**
 * Parts whose LIGHT a step asks the learner to watch (UX fix wave SC-10):
 * LEDs, RGB LEDs, 7-segment / LED-matrix / addressable-strip modules, a
 * logic probe's LEDs and every MCU board (its on-board PC13 / power LEDs) —
 * a cyan hologram shell over them would wash the light out to a pale ghost.
 */
const LIGHT_TYPES: ReadonlySet<string> = new Set([
  'led',
  'rgb_led',
  'seven_segment',
  'tm1637_4digit',
  'max7219_8x8',
  'ws2812b_strip8',
  'logic_probe',
])
function emitsLight(entry: CatalogEntry): boolean {
  return LIGHT_TYPES.has(entry.type) || !!entry.mcu
}

function wireSignature(w: Wire, a: THREE.Vector3, b: THREE.Vector3): string {
  // the routed-path signature folds in collision-avoidance shape changes:
  // a wire reroutes (and must rebuild) when OTHER wires/obstacles move
  return (
    `${w.from}|${w.to}|${w.color ?? ''}|` +
    `${a.x.toFixed(3)},${a.y.toFixed(3)},${a.z.toFixed(3)}|` +
    `${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)}|` +
    routedWireSignature(w.id, a, b)
  )
}

/**
 * cubic-bezier(p1x, p1y, p2x, p2y) easing evaluator with CSS timing-function
 * semantics (hand-rolled — no runtime deps). Newton iteration with a
 * bisection fallback to invert x(t), then evaluates y(t).
 */
function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number): (x: number) => number {
  const cx = 3 * p1x
  const bx = 3 * (p2x - p1x) - cx
  const ax = 1 - cx - bx
  const cy = 3 * p1y
  const by = 3 * (p2y - p1y) - cy
  const ay = 1 - cy - by
  const xAt = (t: number) => ((ax * t + bx) * t + cx) * t
  const yAt = (t: number) => ((ay * t + by) * t + cy) * t
  const dxAt = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 5; i++) {
      const d = dxAt(t)
      if (Math.abs(d) < 1e-6) break
      t -= (xAt(t) - x) / d
      if (t < 0) t = 0
      else if (t > 1) t = 1
    }
    if (Math.abs(xAt(t) - x) > 1e-4) {
      let lo = 0
      let hi = 1
      while (hi - lo > 1e-5) {
        t = (lo + hi) / 2
        if (xAt(t) < x) lo = t
        else hi = t
      }
    }
    return yAt(t)
  }
}

/** The one app spring (DESIGN.md §1 Motion): cubic-bezier(0.32, 0.72, 0, 1). */
const SPRING_EASE = cubicBezier(0.32, 0.72, 0, 1)

let wireHandleMat: THREE.SpriteMaterial | null = null
/**
 * The wire end grip (SC-13): a white ring around an --ios-blue core on a
 * soft shadow — the near-opaque Tier-S look of the app's controls, drawn
 * once into a small canvas; one material for every grip, page lifetime.
 */
function wireHandleMaterial(): THREE.SpriteMaterial {
  if (wireHandleMat) return wireHandleMat
  let map: THREE.CanvasTexture | null = null
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = 96
    c.height = 96
    const g = c.getContext('2d')
    if (g) {
      g.fillStyle = 'rgba(0,0,0,0.28)'
      g.beginPath()
      g.arc(48, 51, 40, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#ffffff'
      g.beginPath()
      g.arc(48, 48, 38, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#0a84ff'
      g.beginPath()
      g.arc(48, 48, 27, 0, Math.PI * 2)
      g.fill()
      map = new THREE.CanvasTexture(c)
      map.colorSpace = THREE.SRGBColorSpace
    }
  }
  wireHandleMat = new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false })
  wireHandleMat.name = 'wire-end-handle'
  return wireHandleMat
}

let wireEndBadMat: THREE.MeshBasicMaterial | null = null
/** The red preview route of an end drag aimed where the wire cannot go. */
function wireEndInvalidMaterial(): THREE.MeshBasicMaterial {
  wireEndBadMat ??= new THREE.MeshBasicMaterial({ color: 0xff453a, transparent: true, opacity: 0.85, depthWrite: false })
  return wireEndBadMat
}

/** Free the wire-end grip / refused-route materials (scene dispose; recreated on demand). */
function disposeWireEndMaterials(): void {
  wireHandleMat?.map?.dispose()
  wireHandleMat?.dispose()
  wireEndBadMat?.dispose()
  wireHandleMat = null
  wireEndBadMat = null
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Procedural laminate-desk textures (color + roughness pair). DESIGN §9 asks
 * for "a product photo of a real breadboard on a DESK" — the old unlit
 * radial-gradient MeshBasicMaterial plane read as a turntable-render void.
 * This is a LIT walnut-laminate surface: warm base tone, low-frequency tonal
 * blotches, long wavy grain strokes, and a matching roughness map so the IBL
 * sheen breaks up along the grain. Deterministic LCG noise (no reload
 * shimmer, headless-safe null).
 *
 * The rim still fades to FULLY TRANSPARENT — an opaque rim color can never
 * exactly match the scene background (the plane is ACES-tone-mapped, the
 * clear color is not), so without the alpha fade the plane's straight edges
 * read as a hard seam whenever the camera orbits low.
 */
/** Desk texture tiling: the grain/roughness pair repeats this many times
 *  across the GROUND_SIZE plane (640/4 = 160 world units ≈ 40cm per tile —
 *  texel density high enough that grazing views keep crisp grain instead of
 *  smearing into motion-blur streaks). The alpha fade does NOT repeat. */
const DESK_REPEAT = 4

function makeDeskTextures(maxAnisotropy: number): {
  map: THREE.CanvasTexture
  rough: THREE.CanvasTexture | null
  alpha: THREE.CanvasTexture | null
} | null {
  if (typeof document === 'undefined') return null
  const S = 1024
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  let seed = 0x5eed1234
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  /** draw cb at the 9 wrap offsets so the tile repeats seamlessly */
  const wrapped = (c: CanvasRenderingContext2D, cb: () => void): void => {
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        c.save()
        c.translate(ox, oy)
        cb()
        c.restore()
      }
    }
  }

  // warm walnut base — saturated enough to still read WARM after ACES tone
  // mapping and the cool fill light desaturate it
  ctx.fillStyle = '#52402c'
  ctx.fillRect(0, 0, S, S)
  // broad tonal blotches (plank-to-plank variation), wrap-drawn to tile —
  // low-frequency detail survives grazing-angle minification best
  for (let i = 0; i < 90; i++) {
    const x = rnd() * S
    const y = rnd() * S
    const r = (0.08 + rnd() * 0.22) * S
    const light = rnd() > 0.5
    wrapped(ctx, () => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, light ? 'rgba(168,128,82,0.14)' : 'rgba(30,20,12,0.16)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r)
    })
  }
  // wood grain: wavy horizontal strokes (≈ 4–40cm at the tile scale)
  for (let i = 0; i < 1500; i++) {
    const y = rnd() * S
    const x0 = rnd() * S
    const len = (0.04 + rnd() * 0.2) * S
    const amp = 1 + rnd() * 3
    const stroke =
      rnd() > 0.42
        ? `rgba(26,17,9,${(0.04 + rnd() * 0.08).toFixed(3)})`
        : `rgba(178,138,92,${(0.04 + rnd() * 0.07).toFixed(3)})`
    const width = 0.6 + rnd() * 1.8
    const c1 = (rnd() - 0.5) * 2 * amp
    const c2 = (rnd() - 0.5) * amp
    wrapped(ctx, () => {
      ctx.strokeStyle = stroke
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(x0, y)
      ctx.quadraticCurveTo(x0 + len / 2, y + c1, x0 + len, y + c2)
      ctx.stroke()
    })
  }

  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = Math.max(1, maxAnisotropy)
  map.wrapS = THREE.RepeatWrapping
  map.wrapT = THREE.RepeatWrapping
  map.repeat.set(DESK_REPEAT, DESK_REPEAT)

  // roughness map: satin variation breaking the sheen up along the grain
  const RS = 512
  const rc = document.createElement('canvas')
  rc.width = RS
  rc.height = RS
  const rctx = rc.getContext('2d')
  let rough: THREE.CanvasTexture | null = null
  if (rctx) {
    rctx.fillStyle = '#d2d2d2' // base roughness ≈ 0.82
    rctx.fillRect(0, 0, RS, RS)
    for (let i = 0; i < 420; i++) {
      const y = rnd() * RS
      const x0 = rnd() * RS
      const len = (0.04 + rnd() * 0.16) * RS
      rctx.strokeStyle =
        rnd() > 0.5
          ? `rgba(176,176,176,${(0.2 + rnd() * 0.3).toFixed(3)})` // glossier grain line
          : `rgba(232,232,232,${(0.2 + rnd() * 0.3).toFixed(3)})` // rougher one
      rctx.lineWidth = 0.8 + rnd() * 2
      rctx.beginPath()
      rctx.moveTo(x0, y)
      rctx.lineTo(x0 + len, y + (rnd() - 0.5) * 5)
      rctx.stroke()
    }
    rough = new THREE.CanvasTexture(rc)
    rough.anisotropy = Math.max(1, maxAnisotropy)
    rough.wrapS = THREE.RepeatWrapping
    rough.wrapT = THREE.RepeatWrapping
    rough.repeat.set(DESK_REPEAT, DESK_REPEAT)
  }

  // rim fade (NON-repeating): dissolves the plane into the background before
  // its straight edges — an opaque rim can never match the un-tone-mapped
  // clear color, so without this the edges read as a hard seam at low orbits
  const AS = 256
  const ac = document.createElement('canvas')
  ac.width = AS
  ac.height = AS
  const actx = ac.getContext('2d')
  let alpha: THREE.CanvasTexture | null = null
  if (actx) {
    const fade = actx.createRadialGradient(AS / 2, AS / 2, 0, AS / 2, AS / 2, AS / 2)
    fade.addColorStop(0, '#ffffff')
    fade.addColorStop(0.55, '#ffffff')
    fade.addColorStop(0.8, '#737373')
    fade.addColorStop(1, '#000000')
    actx.fillStyle = '#000000'
    actx.fillRect(0, 0, AS, AS)
    actx.fillStyle = fade
    actx.fillRect(0, 0, AS, AS)
    alpha = new THREE.CanvasTexture(ac)
  }
  return { map, rough, alpha }
}

/**
 * Cheap shadow casting for dynamic objects: opaque meshes cast into the ONE
 * shadow map (cast only — they never receive). Transparent parts (LED glass,
 * glows, labels) are skipped so the map stays clean and alpha stays cheap.
 */
function enableShadowCasting(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (mats.some((m) => m.transparent)) return
    mesh.castShadow = true
  })
}

/**
 * PERF (perf/hotspots.md B2): the scene graph is static between edits, but
 * three.js recomposes every object's local matrix on each render while
 * matrixAutoUpdate is true — O(scene) wasted math during orbits, where only
 * the camera moves. Static subtrees (board, desk, placed parts, wires, posts,
 * selection boxes) are frozen once their transforms are committed; every
 * scene-side mutation of a frozen transform calls updateMatrix() explicitly
 * (module spring-in, instrument drags, telemetry-posed children). Tweened /
 * per-frame-animated objects (paddles, overlay FX, holograms) stay auto.
 */
function freezeTransforms(root: THREE.Object3D): void {
  root.traverse((o) => {
    o.updateMatrix()
    o.matrixAutoUpdate = false
  })
}

/** Recompose one frozen subtree (after visual updaters posed its children). */
const refreshMatrixOf = (o: THREE.Object3D): void => {
  o.updateMatrix()
}

/**
 * Performance diagnostics probe (src/ui/perf — the 效能診斷 overlay and
 * scripts/perf-win.mjs). Attached with BreadboardScene.attachPerfProbe only
 * while diagnostics are on; with no probe attached the render loop and the
 * telemetry path pay one null check each.
 */
export interface ScenePerfProbe {
  /** CPU ms of each animation frame (controls, FX ticks, render submission) — ring buffer */
  readonly frameMs: Float64Array
  /** frames recorded so far (newest at (frames − 1) % frameMs.length) */
  frames: number
  /** draw calls / triangles of the newest frame, summed over every render pass */
  calls: number
  triangles: number
  /** telemetry pushes applied (cumulative) and the CPU ms they took */
  telemetryPushes: number
  telemetryMs: number
  /** part visuals refreshed / skipped as visually unchanged (cumulative) */
  partsApplied: number
  partsSkipped: number
}

/** A fresh probe with room for `capacity` frame times. */
export function createScenePerfProbe(capacity = 240): ScenePerfProbe {
  return {
    frameMs: new Float64Array(capacity),
    frames: 0,
    calls: 0,
    triangles: 0,
    telemetryPushes: 0,
    telemetryMs: 0,
    partsApplied: 0,
    partsSkipped: 0,
  }
}

/** The four grid-growth directions, paddle build/iteration order. */
const GROW_DIRECTIONS: readonly GridGrowDirection[] = ['right', 'left', 'up', 'down']

/**
 * The "+" grow paddles: rounded glass-look plates with a plus glyph,
 * kit-blue tinted, leaning back toward the elevated home camera — one per
 * edge of the 2-D grid (right/left grow modules, up/down grow board-rows).
 * Transmission stays reserved for LEDs (perf budget) — the glass read comes
 * from transparency + clearcoat + a soft emissive tint, pulsed per frame in
 * updatePaddles (number writes only). Geometry is shared by all four plates;
 * materials are per paddle (independent hover highlights). Never cast
 * shadows.
 */
function buildPaddles(): { paddles: PaddleRecord[]; geos: THREE.BufferGeometry[] } {
  const geos: THREE.BufferGeometry[] = []

  const half = PADDLE_SIZE / 2
  const r = 0.62
  const shape = new THREE.Shape()
  shape.moveTo(-half + r, -half)
  shape.lineTo(half - r, -half)
  shape.quadraticCurveTo(half, -half, half, -half + r)
  shape.lineTo(half, half - r)
  shape.quadraticCurveTo(half, half, half - r, half)
  shape.lineTo(-half + r, half)
  shape.quadraticCurveTo(-half, half, -half, half - r)
  shape.lineTo(-half, -half + r)
  shape.quadraticCurveTo(-half, -half, -half + r, -half)
  const plateGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.18,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 2,
    curveSegments: 8,
  })
  plateGeo.translate(0, 0, -0.09)
  geos.push(plateGeo)
  const barGeo = new THREE.BoxGeometry(PADDLE_SIZE * 0.52, 0.32, 0.1)
  geos.push(barGeo)

  const paddles: PaddleRecord[] = GROW_DIRECTIONS.map((dir) => {
    const group = new THREE.Group()
    group.name = `plus-paddle-${dir}`
    // UI chrome, not circuit: kept out of the Studio path-traced still and
    // composited raster-side on top of it (see renderStudioOverlays)
    group.userData.bbNoStudio = true
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x66a8ff,
      transparent: true,
      opacity: 0.32,
      roughness: 0.22,
      metalness: 0,
      clearcoat: 0.8,
      clearcoatRoughness: 0.25,
      emissive: 0x0a84ff,
      emissiveIntensity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const plate = new THREE.Mesh(plateGeo, mat)
    plate.renderOrder = 1
    group.add(plate)

    const glyphMat = new THREE.MeshBasicMaterial({
      color: 0xeaf6ff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    })
    const barH = new THREE.Mesh(barGeo, glyphMat)
    barH.position.z = 0.18
    barH.renderOrder = 2
    const barV = new THREE.Mesh(barGeo, glyphMat)
    barV.rotation.z = Math.PI / 2
    barV.position.z = 0.18
    barV.renderOrder = 2
    group.add(barH, barV)
    group.rotation.x = PADDLE_TILT // lean the face up toward the 3/4 home view
    group.visible = false

    // the quiet "−" removal chip: same glass language, smaller, hidden until
    // the + paddle is hovered (desktop) on a shrinkable axis. Right/down
    // only — the store's shrink (setBoardCount/setBoardRows) drops the
    // rightmost module column / deepest board-row, so those are the honest
    // edges to offer. Shares the plate/bar geometry (scaled by the chip
    // group); independent materials for the reveal/hover fades.
    let minus: THREE.Group | null = null
    let minusPlate: THREE.Mesh | null = null
    let minusMat: THREE.MeshPhysicalMaterial | null = null
    let minusGlyphMat: THREE.MeshBasicMaterial | null = null
    if (dir === 'right' || dir === 'down') {
      minus = new THREE.Group()
      minus.name = `minus-chip-${dir}`
      minusMat = new THREE.MeshPhysicalMaterial({
        color: 0x9caabd,
        transparent: true,
        opacity: 0,
        roughness: 0.25,
        metalness: 0,
        clearcoat: 0.8,
        clearcoatRoughness: 0.25,
        emissive: 0x8a93a3,
        emissiveIntensity: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      minusPlate = new THREE.Mesh(plateGeo, minusMat)
      minusPlate.renderOrder = 1
      minus.add(minusPlate)
      minusGlyphMat = new THREE.MeshBasicMaterial({
        color: 0xf2f5fa,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
      const minusBar = new THREE.Mesh(barGeo, minusGlyphMat)
      minusBar.position.z = 0.18
      minusBar.renderOrder = 2
      minus.add(minusBar)
      minus.position.y = -PADDLE_MINUS_DROP // beneath the + plate (local space)
      minus.scale.setScalar(PADDLE_MINUS_SCALE)
      minus.visible = false
      group.add(minus) // inherits the paddle's lean + float position
    }
    return { dir, group, plate, mat, glyphMat, minus, minusPlate, minusMat, minusGlyphMat, minusReveal: 0 }
  })
  return { paddles, geos }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export class BreadboardScene implements IBreadboardScene {
  /** UX fix wave H7 (SC-11): the problem-layer tints this scene draws — 'info' included */
  readonly problemHighlightLevels: readonly ProblemHighlightLevel[] = ['error', 'risk', 'info']
  private m: Mounted | null = null

  // desired state — survives unmount/remount and may be set before mount()
  private callbacks: Partial<SceneCallbacks> = {}
  private layout: CircuitLayout = EMPTY_LAYOUT
  private telemetry: SimTelemetry | null = null
  private ghost: GhostSpec | null = null
  private selectedIds: string[] = []
  private preview: { from: HoleRef | string | null; to: HoleRef | null } = { from: null, to: null }
  /** render-mode preference set before mount (host picker); null = unset */
  private renderModePref: RenderModeId | null = null
  /** docked-chrome insets (setViewInsets, CSS px); all zero = no view offset */
  private viewInsets: ViewInsets = { left: 0, right: 0, top: 0, bottom: 0 }
  /** destination of the last frameContent()/double-tap content framing */
  private lastContentFrame: { pos: THREE.Vector3; tgt: THREE.Vector3 } | null = null

  // render-mode engine (Performance / Enhanced / Studio — render-modes/)
  private readonly modes = new RenderModeManager()
  /** an OrbitControls gesture is in flight (boolean-guarded: depth-safe) */
  private controlsInteracting = false
  /** a primary canvas pointer is down (aiming / edit drags) */
  private pointerInteracting = false
  /** a telemetry/selection material refresh awaits the next throttle slot */
  private materialsRefreshPending = false
  /** timestamp (ms) of the last Studio material refresh actually sent */
  private lastMaterialsRefresh = 0
  /**
   * PERF: the component telemetry each part's visual was last refreshed
   * with (keyed by component id; absent = never / forced). setTelemetry
   * skips parts whose visually relevant telemetry did not change.
   */
  private readonly appliedTelemetry = new Map<string, ComponentTelemetry | null>()
  /** diagnostics probe (src/ui/perf); null = off */
  private perfProbe: ScenePerfProbe | null = null

  // scene-graph records
  private components = new Map<string, ComponentRecord>()
  private wires = new Map<string, WireRecord>()
  /** saved emissive of highlighted per-instance wire materials (scene-owned) */
  private savedEmissive = new Map<THREE.MeshStandardMaterial, { color: number; intensity: number }>()
  /** translucent overlay boxes around selected components */
  private selectionBoxes: THREE.Mesh[] = []
  /** holographic placement ghost (actual part mesh + pin markers) */
  private ghostFx: {
    holo: THREE.Object3D | null
    built: BuiltComponent | null
    markers: PinMarkers
    sig: string
  } | null = null
  /** lesson highlights (setHighlights; null = none — nothing in the scene graph) */
  private highlightSpec: { holes: string[]; components: string[] } | null = null
  /** built highlight FX: pin markers on holes + hologram shells of parts */
  private highlightFx: { group: THREE.Group; markers: PinMarkers | null; sig: string } | null = null
  /** problem layer (setProblemHighlights; null = none — nothing in the scene graph) */
  private problemSpec: { holes: string[]; components: string[]; level: ProblemHighlightLevel } | null = null
  /** built problem FX: tinted pin markers + outline hulls of parts / wires */
  private problemFx: { group: THREE.Group; markers: PinMarkers | null; sig: string } | null = null
  /** live brightness labels of the highlighted LEDs while a simulation session exists (SC-10) */
  private ledLabels: { id: string; label: HoleLabel; top: THREE.Vector3; text: string }[] = []
  private ledLabelsAt = 0
  /** hover-only neutral marker (H7 setSourceHighlight; independent of the lesson / problem layers) */
  private sourceSpec: { holes: string[]; components: string[] } | null = null
  /** the source marker's FX: tinted rings + thin rims (cloned meshes share geometry) */
  private sourceFx: { group: THREE.Group; markers: PinMarkers | null; sig: string } | null = null
  /** destination of the last frameTargets (re-fitted when the insets change while parked there) */
  private lastTargetFrame: {
    box: THREE.Box3
    minSpan: number
    /** frameTargets' view direction (target → camera): the home one unless minElevationDeg raised it */
    dir: THREE.Vector3 | null
    /** frameTargets' minPitchPx / coverBottomPx (release QA SC-F1), kept for the re-fit */
    extra: TargetFitExtras
    pos: THREE.Vector3
    tgt: THREE.Vector3
  } | null = null
  /** scratch camera of holePitchPx / the min-pitch fit (the live camera is never moved for a measurement) */
  private pitchCam: THREE.PerspectiveCamera | null = null
  /** an interactive part held down in 3D (SC-6 onObjectPress) */
  private press: { id: string; pointerId: number; t0: number | null } | null = null
  /** a quick click's release, held back until the simulation has seen a human-length press (SC-6) */
  private pendingRelease: { id: string; until: number; timer: ReturnType<typeof setTimeout> } | null = null
  /** docked chrome: soft glow on every hole an armed package may anchor at (SC-8) */
  private anchorFx: { markers: PinMarkers; sig: string } | null = null
  /** bumped per syncLayout — the anchor glow re-derives on edits */
  private layoutRev = 0
  /** right-button press point (contextmenu after an orbit pan is not a probe) */
  private rightDown: { x: number; y: number } | null = null
  /** last live refresh of the hover chip text (ms) */
  private chipRefreshAt = 0
  /** canvas CSS height (chip min-size check without a per-frame layout read) */
  private viewH = 1
  private viewW = 1
  /** docked chrome only: the board edge the mouse is near (its "+" paddle may show) */
  private paddleNear: GridGrowDirection | null = null
  /** scratch for framing / follow math (event-driven, reused — no churn) */
  private readonly fitBoxTmp = new THREE.Box3()
  private readonly fitCorners: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3())
  private readonly tmpVecC = new THREE.Vector3()
  private readonly tmpVecD = new THREE.Vector3()
  /** clicked-hole coordinate chip stays pinned until this timestamp (ms) */
  private labelPinnedUntil = 0
  /** where a right-click opened the probe menu: no hover chip until the pointer leaves that spot */
  private chipMutedAt: { x: number; y: number } | null = null
  /** which grow paddle the pointer hovers (hover highlight + cursor) */
  private paddleHover: GridGrowDirection | null = null
  /** ...and whether the hover sits on the paddle's "−" removal chip */
  private paddleMinusHover: GridGrowDirection | null = null
  /**
   * Spawn tween for freshly added board modules / board-rows: drop from
   * SPAWN_DROP_HEIGHT with a leveling tilt (rotated about each entry's own
   * plan center), one-beat squash settle, dust at touchdown. `t0 = 0` until
   * the first rAF tick after the synchronous rebuild (lazy start — the heavy
   * mesh build must never eat into the fall). All per-frame work is scalar
   * math + transform writes on prebuilt groups.
   */
  private spawnTween: {
    entries: {
      group: THREE.Group
      base: THREE.Vector3
      /** rotation pivot (entry's plan center at board level, parent space) */
      pivot: THREE.Vector3
      /** local-space bottom y (squash pivot — the face that stays planted) */
      bottom: number
    }[]
    /** tilt axis ('z' for module columns, 'x' for board-rows) + signed angle */
    axis: 'x' | 'z'
    tilt: number
    /** world base rect of the new slab(s) — dust burst ring */
    rect: PuffRect
    t0: number
    landed: boolean
  } | null = null
  /** reduced-motion spawn: simple fade-in over the new groups */
  private fadeTween: { set: FadeSet; t0: number } | null = null
  /**
   * Scene-initiated removal ("−" chip / paddle long-press): the dropped
   * module column / board-row groups are detached from the OLD board build
   * (whose disposal is deferred to the tween end), lifted and faded out over
   * cloned materials, with a smaller dust puff at liftoff.
   */
  private removalTween: {
    groups: THREE.Group[]
    bases: THREE.Vector3[]
    set: FadeSet
    oldBuild: BoardBuild
    t0: number
  } | null = null
  /** fly home after the rig GREW (the new module must come into view) */
  private flyHomePending = false
  /** paddle direction tapped last — picks which groups animate on rebuild */
  private pendingGrowDir: GridGrowDirection | null = null
  /** "−" direction tapped last — arms the removal animation on rebuild */
  private pendingShrinkDir: GridGrowDirection | null = null
  /** canonical refs of holes covered by component bodies (occlusion UX) */
  private occluded = new Set<string>()
  /** ghost spin spring: pivot un-rotates from `from` to 0 (R-key cycle) */
  private ghostSpin: { pivot: THREE.Group; from: number; t0: number } | null = null
  /** ghost identity (type|at|picked) + rotation of the previous syncGhost */
  private lastGhostKey = ''
  private lastGhostRotation: Rotation = 0
  /** in-flight editing drags (select mode only; at most one non-null) */
  private moveDrag: MoveDrag | null = null
  /** SC-13: the end handles of the one selected wire (docked chrome) */
  private wireHandles: { wireId: string; group: THREE.Group; ends: { end: 'from' | 'to'; sprite: THREE.Sprite; at: THREE.Vector3 }[] } | null = null
  private wireEndDrag: WireEndDrag | null = null
  /** a wire-end drag aims like wire mode (resolver, fingertip cursor, touch gestures) */
  private forceWireAim = false
  private instDrag: InstrumentDrag | null = null
  private marquee: MarqueeDrag | null = null
  /** controls.enabled was forced off for a drag — restore on gesture end */
  private controlsSuspended = false

  // picking state (reused buffers — no per-frame allocations)
  private readonly holeIndex = new HoleIndex()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointerNdc = new THREE.Vector2()
  private readonly hitBuf: THREE.Intersection[] = []
  private pointerDirty = false
  private pointerInside = false
  private lastHoverHole: HoleRef | null = null
  /** component / wire / instrument id under the mouse (onObjectHover dedupe) */
  private lastHoverObject: string | null = null
  /** setDockedChrome (SC-16): null = never told — the scene guesses from the view insets */
  private dockedChrome: boolean | null = null
  /** setPartsBrowsing (SC-16): the parts library is open — a coarse pointer shows the grow paddles then */
  private partsBrowsing = false
  /** a coarse primary pointer (sampled at mount; a touch event also says so) */
  private coarseDevice = false
  /** what the hover chip names right now ('' = nothing) — the hover pass redraws on change only */
  private chipKey = ''
  /** …the hole / terminal behind it, re-asked for live text (refreshHoleChip) */
  private chipLive: { kind: 'hole'; ref: HoleRef } | { kind: 'terminal'; ref: string } | null = null
  /** world point the screen chip is anchored to */
  private readonly chipAnchor = new THREE.Vector3()
  /** a camera move that is not a pointer move hid the chip (hideChipForCameraMove): re-aim once it settles */
  private chipAfterCamera = false
  /** world box of the part the screen chip keeps clear of (null = none) */
  private chipPartBox: THREE.Box3 | null = null
  /** floating chrome (viewport px) the screen chip keeps clear of — measured when it is (re)aimed */
  private chipAvoid: ChipRect[] = []
  /** touch aiming: the chip never sits under the finger */
  private chipNoBelow = false
  /** canvas client rect (viewport px) — refreshed when the chip is (re)aimed */
  private readonly canvasRect = { left: 0, top: 0, width: 1, height: 1 }
  /** hole ref → id of the part pin / wire end plugged into it (rebuilt per layout) */
  private readonly pinOwner = new Map<string, string>()
  /** the pointer ray's first hit point (hover pass) — a body chip's anchor */
  private readonly hoverPoint = new THREE.Vector3()
  /** scratch anchor for the chip helpers */
  private readonly chipTmp = new THREE.Vector3()
  private downInfo: {
    x: number
    y: number
    t: number
    id: number
    type: string
    /** peak drift (px) from the down point — tap/long-press discrimination */
    maxDrift: number
  } | null = null
  /** pointerType of the most recent pointer event (drives snap radius) */
  private lastPointerType = 'mouse'
  /** primary touch pointer currently down (drives fingertip aiming) */
  private activeTouchId: number | null = null
  private longPressTimer: number | null = null
  /** a long-press fired — swallow the matching pointerup tap */
  private tapSuppressed = false
  /** previous empty-space tap, for double-tap re-frame detection */
  private lastBgTap: { x: number; y: number; t: number } | null = null
  /** app interaction mode, if the host reports it (else inferred from ghost/preview) */
  private explicitMode: SceneInteractionMode | null = null
  /** camera re-frame tween (rAF-interpolated, spring-eased) */
  private camTween: {
    startPos: THREE.Vector3
    startTgt: THREE.Vector3
    endPos: THREE.Vector3
    endTgt: THREE.Vector3
    t0: number
  } | null = null
  /** scratch state for the fingertip cursor (no per-frame allocations) */
  private fingertipHasPoint = false
  private readonly fingertipPoint = new THREE.Vector3()
  private readonly tmpNdc = new THREE.Vector2()
  private readonly tmpVecA = new THREE.Vector3()
  private readonly tmpVecB = new THREE.Vector3()

  // -------------------------------------------------------------- lifecycle

  mount(container: HTMLElement): void {
    if (this.m) this.dispose()

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)
    this.viewH = h
    this.viewW = w
    renderer.setSize(w, h)
    // product-render pipeline: sRGB out, ACES filmic tone mapping, ONE soft
    // shadow map (PCFSoft, 2048) — no postprocessing, pixelRatio stays ≤ 2
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = EXPOSURE
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // The shadow map depends only on geometry + the key light — never the
    // orbiting camera — and the scene is static between layout edits. Render
    // it on demand (syncLayout / refitShadows set shadowMap.needsUpdate)
    // instead of re-rendering every caster into the 2048² map every frame.
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    renderer.domElement.style.display = 'block'
    // touch-native canvas: the page must never scroll/zoom/select/loupe from here
    renderer.domElement.style.touchAction = 'none'
    renderer.domElement.style.userSelect = 'none'
    renderer.domElement.style.setProperty('-webkit-user-select', 'none')
    renderer.domElement.style.setProperty('-webkit-touch-callout', 'none')
    renderer.domElement.style.setProperty('-webkit-tap-highlight-color', 'transparent')
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x15171c)

    // image-based lighting: PMREM'd RoomEnvironment makes the PBR materials
    // (brushed metal, molded epoxy, LED glass) actually read as materials
    const pmrem = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    const envTex = pmrem.fromScene(room, 0.04).texture
    room.dispose()
    scene.environment = envTex
    scene.environmentIntensity = ENV_INTENSITY

    const boardConfig = boardConfigOf(this.layout)
    const ext = boardExtents(boardConfig)
    const cx = (ext.minX + ext.maxX) / 2
    const cz = (ext.minZ + ext.maxZ) / 2

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000)
    // provisional elevated 3/4 view — replaced by the aspect-fit home framing
    // (computeHomeFraming) as soon as the Mounted record exists below
    camera.position.set(cx - 6, 36, cz + 40)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(cx, 0, cz)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    // sane orbit limits — the camera can never go under the board
    controls.minDistance = 6
    controls.maxDistance = 180
    controls.maxPolarAngle = Math.PI * 0.49
    // touch: one finger rotates, two fingers pinch-zoom + pan (DESIGN.md §4).
    // touches.ONE is swapped to null while place/wire aiming is active — see
    // updateTouchGestures().
    controls.touches.ONE = THREE.TOUCH.ROTATE
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
    controls.update()

    // render-mode engine: Performance keeps the plain render call in the rAF
    // loop below at zero added cost; Enhanced/Studio take over presentation
    // (contract in render-modes/manager.ts). Boots from the persisted
    // 'bb.renderMode' / device default; a host preference set before mount
    // (store boot value) is applied on top.
    this.modes.init(renderer, scene, camera)
    if (this.renderModePref) this.modes.setMode(this.renderModePref)
    // camera interaction → Studio yields to the Enhanced raster while moving
    // (booleans guard the depth counter against unbalanced start/end events)
    const onControlsStart = () => {
      if (!this.controlsInteracting) {
        this.controlsInteracting = true
        this.modes.onInteractionStart()
      }
    }
    const onControlsEnd = () => {
      if (this.controlsInteracting) {
        this.controlsInteracting = false
        this.modes.onInteractionEnd()
        // hover processing is gated off during the gesture (B3) — re-arm it
        // so the ring/label/cursor refresh on release even without a move
        this.pointerDirty = true
      }
    }
    controls.addEventListener('start', onControlsStart)
    controls.addEventListener('end', onControlsEnd)
    // Studio convergence progress → host status capsule (payload is reused)
    const offRenderProgress = this.modes.on('progress', (p) => {
      this.callbacks.onRenderProgress?.(p)
    })

    // lighting: the IBL carries the ambience; one warm shadow-casting key
    // (camera fitted to the board in refitShadows) + a dim cool fill.
    // No hemisphere light — it would wash the IBL flat.
    const keyLight = new THREE.DirectionalLight(KEY_COLOR, KEY_INTENSITY)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
    keyLight.shadow.bias = -0.0002
    keyLight.shadow.normalBias = 0.02
    const fillLight = new THREE.DirectionalLight(FILL_COLOR, FILL_INTENSITY)
    fillLight.position.set(-35, 40, -30)
    scene.add(keyLight, keyLight.target, fillLight)

    // desk: one large LIT laminate plane just under the board — it receives
    // the key-light shadow physically, so the board and instruments sit on a
    // believable surface instead of floating in an unlit void (DESIGN §9
    // "product photo of a real breadboard on a desk"). The texture's alpha
    // fades to 0 at the rim, dissolving into the background with no edge.
    const groundGroup = new THREE.Group()
    groundGroup.name = 'ground'
    const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE)
    const deskTex = makeDeskTextures(renderer.capabilities.getMaxAnisotropy())
    const backdropMat = new THREE.MeshStandardMaterial(
      deskTex
        ? {
            map: deskTex.map, // repeats (per-map UV transforms, three r152+)
            roughnessMap: deskTex.rough,
            roughness: 1, // multiplied by the roughness map (≈ 0.82 base)
            alphaMap: deskTex.alpha, // non-repeating radial rim fade
            metalness: 0,
            transparent: true,
            depthWrite: false,
          }
        : { color: 0x2c241d, roughness: 0.9, metalness: 0 },
    )
    const backdropTexs: THREE.Texture[] = deskTex
      ? [deskTex.map, deskTex.rough, deskTex.alpha].filter((t): t is THREE.CanvasTexture => !!t)
      : []
    const backdrop = new THREE.Mesh(groundGeo, backdropMat)
    backdrop.rotation.x = -Math.PI / 2
    backdrop.position.y = GROUND_BACKDROP_Y
    backdrop.receiveShadow = true // the ONE shadow map lands here
    groundGroup.add(backdrop)
    groundGroup.position.set(cx, 0, cz)
    scene.add(groundGroup)
    freezeTransforms(groundGroup) // static (B2); board rebuilds updateMatrix

    this.holeIndex.rebuild(boardConfig)
    const board = buildBoard(renderer.capabilities.getMaxAnisotropy(), boardConfig)
    scene.add(board.group)
    // the board is static between rig edits (B2); the module spring-in tween
    // is the one mover and calls updateMatrix per animated group per frame
    freezeTransforms(board.group)

    const componentsGroup = new THREE.Group()
    componentsGroup.name = 'components'
    const wiresGroup = new THREE.Group()
    wiresGroup.name = 'wires'
    const terminalsGroup = new THREE.Group()
    terminalsGroup.name = 'terminals'
    const overlayGroup = new THREE.Group()
    overlayGroup.name = 'overlay'
    // Studio: the whole overlay subtree (holograms, hover FX, selection
    // boxes, previews, coordinate chips) is excluded from the path-traced
    // still and composited raster-side instead — see renderStudioOverlays
    overlayGroup.userData.bbNoStudio = true
    scene.add(componentsGroup, wiresGroup, terminalsGroup, overlayGroup)
    // the container groups themselves never move (children freeze/animate
    // individually — root-only, NOT recursive: overlay FX stay auto)
    for (const g of [componentsGroup, wiresGroup, terminalsGroup, overlayGroup]) {
      g.updateMatrix()
      g.matrixAutoUpdate = false
    }

    // shared FX clock + reduced-motion preference (sampled once per mount)
    const clock = new THREE.Clock()
    const reduced = prefersReducedMotion()
    this.coarseDevice = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    setHologramReducedMotion(reduced)

    // hovered-hole FX: LED-phosphor glow ring + pooled coordinate chip
    // (the holographic placement ghost is built on demand in syncGhost)
    const hoverRing = makeHoverRing()
    hoverRing.setReducedMotion(reduced)
    overlayGroup.add(hoverRing.object)
    const holeLabel = makeHoleLabel()
    overlayGroup.add(holeLabel.object)
    // docked chrome's chip lives in screen space (a fixed DOM card)
    const screenChip = makeScreenChip()

    // "+" grow paddles: floating glass plates with plus glyphs at the four
    // edges of the 2-D grid (visibility driven per frame in updatePaddles)
    const paddleBuild = buildPaddles()
    for (const p of paddleBuild.paddles) scene.add(p.group)

    // pooled touchdown-dust FX (board spawn/removal). Mounted invisible so
    // the warmup compile below links its sprite program at mount time — the
    // first puff must never compile a shader mid-animation.
    const spawnFx = new SpawnFX()
    scene.add(spawnFx.group)

    // fingertip ghost-cursor (DESIGN.md §4): a glowing ring + crosshair that
    // floats toward the top of the screen from the touched point so the finger
    // never hides the target hole. Always on top (depthTest off), shown only
    // while a touch pointer is down in place/wire mode.
    const fingertipGroup = new THREE.Group()
    fingertipGroup.name = 'fingertip-cursor'
    fingertipGroup.visible = false
    const fingertipGeos: THREE.BufferGeometry[] = []
    const fingertipRingMat = new THREE.MeshBasicMaterial({
      color: 0x0a84ff,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const fingertipGlowMat = new THREE.MeshBasicMaterial({
      color: 0x64d2ff,
      transparent: true,
      opacity: 0.3,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const fingertipCrossMat = new THREE.MeshBasicMaterial({
      color: 0xeaf4ff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    {
      const ringGeo = new THREE.RingGeometry(0.55, 0.8, 32)
      const glowGeo = new THREE.RingGeometry(0.8, 1.25, 32)
      const crossGeo = new THREE.PlaneGeometry(1.0, 0.07)
      fingertipGeos.push(ringGeo, glowGeo, crossGeo)
      const crossB = new THREE.Mesh(crossGeo, fingertipCrossMat)
      crossB.rotation.z = Math.PI / 2 // in-plane spin — applied before the x-flip below
      for (const mesh of [
        new THREE.Mesh(glowGeo, fingertipGlowMat),
        new THREE.Mesh(ringGeo, fingertipRingMat),
        new THREE.Mesh(crossGeo, fingertipCrossMat),
        crossB,
      ]) {
        mesh.rotation.x = -Math.PI / 2 // lie flat on the board plane
        mesh.renderOrder = 10
        fingertipGroup.add(mesh)
      }
    }
    overlayGroup.add(fingertipGroup)

    // selection highlight overlay (translucent box per selected component —
    // component meshes share module-cached materials, so never mutate those)
    const selBoxGeo = new THREE.BoxGeometry(1, 1, 1)
    const selBoxMat = new THREE.MeshBasicMaterial({
      color: SELECT_EMISSIVE,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    })

    // shared resources for wires and terminal-post hit proxies. The tip pin
    // is the ~5mm stripped tinned end every real jumper shows at a hole
    // entry: the insulation tube stops WIRE_TIP_LEN above the board (wires.ts
    // trims the curve) and this bare pin carries on down into the recessed
    // socket. The post proxy is INVISIBLE — the instrument mesh draws the
    // real panel-mounted post; this box only catches rays/touches for it.
    const capGeo = new THREE.SphereGeometry(1, 10, 8)
    const tipGeo = new THREE.CylinderGeometry(
      0.085,
      0.07,
      WIRE_TIP_LEN + WIRE_TIP_SINK,
      8,
    )
    const tipMat = new THREE.MeshStandardMaterial({
      color: 0xc9ccd2,
      metalness: 0.9,
      roughness: 0.35,
    })
    const postGeo = new THREE.BoxGeometry(POST_PROXY_W, POST_PROXY_H, POST_PROXY_D)
    const postMat = new THREE.MeshBasicMaterial()
    const previewMat = new THREE.MeshBasicMaterial({
      color: 0xffd84d,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })

    // pointer events — passive observers that do not fight OrbitControls
    const dom = renderer.domElement
    const onPointerMove = (e: PointerEvent) => {
      if (!e.isPrimary) return // ignore secondary fingers during a pinch
      this.lastPointerType = e.pointerType
      // a real move after the probe menu opened: the hover chip may show again
      const muted = this.chipMutedAt
      if (muted && Math.hypot(e.clientX - muted.x, e.clientY - muted.y) > PROBE_MAX_DRIFT_PX) this.chipMutedAt = null
      this.updateNdc(e)
      this.pointerInside = true
      this.pointerDirty = true
      const down = this.downInfo
      if (down && e.pointerId === down.id) {
        const drift = Math.hypot(e.clientX - down.x, e.clientY - down.y)
        if (drift > down.maxDrift) down.maxDrift = drift
        if (drift > LONG_PRESS_MAX_PX) this.cancelLongPress()
        // editing gestures (move-drag / instrument-drag / marquee) track the
        // pointer directly — they own the gesture once past the threshold
        this.updateEditDrags(e, drift)
      }
    }
    const onPointerDown = (e: PointerEvent) => {
      this.lastPointerType = e.pointerType
      this.camTween = null // grabbing the scene cancels the re-frame tween
      if (!e.isPrimary) {
        // a second finger means pinch — never a tap / long-press / fingertip
        // commit, and any in-flight editing drag is abandoned (not committed)
        this.cancelLongPress()
        this.cancelEditDrags()
        this.downInfo = null
        this.activeTouchId = null
        this.hideFingertip()
        return
      }
      // right button: remember where it went down — a contextmenu after an
      // orbit pan (pointer moved) is not a probe request (onContextMenu)
      if (e.button === 2) this.rightDown = { x: e.clientX, y: e.clientY }
      if (e.button !== 0) return
      this.beginPointerInteraction() // Studio raster-falls-back while touched
      this.updateNdc(e)
      this.pointerInside = true
      this.pointerDirty = true // fingertip cursor appears within one frame
      this.tapSuppressed = false // fresh gesture
      this.downInfo = {
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
        id: e.pointerId,
        type: e.pointerType,
        maxDrift: 0,
      }
      if (e.pointerType === 'touch') this.activeTouchId = e.pointerId
      // SC-13: grabbing a selected wire's end handle re-routes that end
      if (this.beginWireEndDrag(e)) return
      // long-press a component/wire (suppressed while fingertip-aiming a touch)
      if (!(e.pointerType === 'touch' && this.isPlaceOrWireMode())) {
        let id = this.pickObjectIdAtPointer()
        if (id === null && e.pointerType === 'touch' && this.m) {
          // finger-sized long-press target — wires are only ~6px wide
          id = this.pickWithSlop(this.m.objectPickRoots, OBJECT_TOUCH_SLOP_PX)?.componentId ?? null
        }
        // SC-6: holding an interactive part (pushbutton…) while a simulation
        // session exists PRESSES it through the host's runtime-param path —
        // no long-press menu, no move-drag, no orbit while held; the tap still
        // resolves to onObjectClick (selection) on release
        if (id !== null && this.m && this.pressable(id)) {
          this.releasePress()
          this.flushPressRelease()
          this.press = { id, pointerId: e.pointerId, t0: this.telemetry?.time ?? null }
          this.suspendControls(this.m, e)
          this.callbacks.onObjectPress?.(id, true)
          return
        }
        if (id !== null) this.startLongPress(id)
        else if (e.pointerType === 'touch' && this.m) {
          // touch removal affordance: long-pressing a "+" paddle on a
          // shrinkable edge removes the board there (no hover on touch, so
          // the "−" chip can't be reached — this is its coarse-pointer twin)
          this.raycaster.setFromCamera(this.pointerNdc, this.m.camera)
          const pad = this.pickPaddle(this.m)
          if (pad && !pad.minus && this.paddleRemovable(this.m, pad.rec.dir)) {
            this.startPaddleLongPress(pad.rec.dir)
          } else if (!pad && this.isDocked()) {
            // SC-14: a long-press on a bare hole measures it (probe sheet)
            this.startLongPress(null)
          }
        }
        // editing gestures (select mode): a drag starting on an already-
        // SELECTED part is a move — NOT an orbit (decided here so the orbit
        // can be suspended before OrbitControls rotates); shift+drag on empty
        // board (desktop mouse) arms the marquee rectangle.
        this.maybeBeginEditDrag(e, id)
      }
    }
    const onPointerUp = (e: PointerEvent) => {
      this.cancelLongPress()
      this.endPointerInteraction()
      if (this.press?.pointerId === e.pointerId) this.releasePress()
      if (this.finishEditDrags(e)) {
        // a started move/instrument/marquee drag consumed the whole gesture
        if (this.activeTouchId === e.pointerId) this.activeTouchId = null
        this.hideFingertip()
        this.downInfo = null
        this.tapSuppressed = false
        return
      }
      const down = this.downInfo
      const wasFingertip = this.activeTouchId === e.pointerId && this.isPlaceOrWireMode()
      if (this.activeTouchId === e.pointerId) this.activeTouchId = null
      this.hideFingertip()
      if (!down || e.pointerId !== down.id) return
      this.downInfo = null
      if (e.button !== 0) return
      if (this.tapSuppressed) {
        this.tapSuppressed = false // a long-press already consumed this gesture
        return
      }
      const touchLike = down.type !== 'mouse'
      const maxPx = touchLike ? TAP_MAX_PX : CLICK_MAX_PX
      const maxMs = touchLike ? TAP_MAX_MS : CLICK_MAX_MS
      const drift = Math.max(down.maxDrift, Math.hypot(e.clientX - down.x, e.clientY - down.y))
      const dt = performance.now() - down.t
      const isTap = drift < maxPx && dt < maxMs
      if (wasFingertip && !isTap) {
        // drag/dwell-to-aim, lift-to-commit: the finger moved or held long
        // enough to have SEEN the aim ring, so the snapped candidate (hole or
        // off-board terminal) wins, however far the finger travelled
        this.updateNdc(e)
        const target = this.pickFingertipTarget()
        if (target?.kind === 'hole') {
          if (this.occluded.has(target.hole)) {
            // occluded hole: rejected — the red locked chip shows WHERE, the
            // host callback explains WHY (toast naming the covering part)
            this.callbacks.onHoleOcclusionRejected?.(target.hole)
          } else {
            this.callbacks.onHoleClick?.(target.hole)
          }
        } else if (target) {
          this.callbacks.onTerminalClick?.(target.ref)
        }
        return
      }
      // quick taps — including in place/wire mode, where the offset aim ring is
      // never perceivable within <350ms — commit what is under the finger
      if (isTap) this.handleClick(e)
    }
    const onPointerCancel = () => {
      this.cancelLongPress()
      this.endPointerInteraction()
      this.releasePress()
      this.cancelEditDrags()
      this.downInfo = null
      this.activeTouchId = null
      this.tapSuppressed = false
      this.hideFingertip()
    }
    const onPointerLeave = () => {
      this.cancelLongPress()
      this.endPointerInteraction()
      this.releasePress()
      this.cancelEditDrags()
      this.pointerInside = false
      this.pointerDirty = false
      this.chipMutedAt = null
      this.downInfo = null
      this.activeTouchId = null
      this.tapSuppressed = false
      this.hideFingertip()
      if (this.lastHoverHole !== null) {
        this.lastHoverHole = null
        this.callbacks.onHoleHover?.(null)
      }
      this.setHoverObject(null)
      const mm = this.m
      if (mm) {
        mm.hoverRing.hide(mm.clock.getElapsedTime())
        // the pin keeps a just-clicked hole's chip; docked chrome drops a
        // HOVER chip (another hole passed on the way out) the moment the
        // pointer leaves — it names nothing under the pointer any more
        if (this.labelPinnedUntil <= performance.now() || (this.isDocked() && this.chipKey !== PINNED_CHIP_KEY)) this.hideChip(mm)
        this.chipKey = ''
        this.paddleHover = null
        this.paddleMinusHover = null
        mm.container.style.cursor = ''
      }
    }
    // iOS Safari hardening: pinch must never zoom the page, long-press must
    // never trigger the system loupe/menu (touch-action:none + these guards)
    const preventDefault = (e: Event) => e.preventDefault()
    const onWheel = () => {
      this.camTween = null // user zoom cancels the re-frame tween
    }
    // a held part whose pointer capture is lost (window blur, capture
    // stolen) must never stay pressed
    const onLostCapture = (e: PointerEvent) => {
      if (this.press?.pointerId === e.pointerId) {
        this.releasePress()
        this.restoreControls()
      }
    }
    // the canvas never shows the browser menu (iOS long-press hardening, as
    // before); a desktop right-click on a hole / pin / terminal post / wire
    // additionally asks the host for the probe menu (SC-5)
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      const rd = this.rightDown
      this.rightDown = null
      if (this.lastPointerType !== 'mouse' || !this.callbacks.onProbeRequest || !this.m) return
      if (rd && Math.hypot(e.clientX - rd.x, e.clientY - rd.y) > PROBE_MAX_DRIFT_PX) return
      this.updateNdcXY(e.clientX, e.clientY)
      const target = this.probeTargetAtPointer(this.m)
      if (!target) return
      this.callbacks.onProbeRequest(target, { x: e.clientX, y: e.clientY }, { pointer: 'mouse' })
      // the menu's header names the point now: no hover chip peeking out
      // behind it until the pointer really moves (the pan release re-arms
      // the hover pass on the same spot)
      if (this.isDocked()) {
        this.hideChip(this.m)
        this.chipKey = STALE_CHIP_KEY
        this.chipMutedAt = { x: e.clientX, y: e.clientY }
      }
    }
    dom.addEventListener('pointermove', onPointerMove)
    dom.addEventListener('pointerdown', onPointerDown)
    dom.addEventListener('pointerup', onPointerUp)
    dom.addEventListener('pointercancel', onPointerCancel)
    dom.addEventListener('pointerleave', onPointerLeave)
    dom.addEventListener('gesturestart', preventDefault)
    dom.addEventListener('gesturechange', preventDefault)
    dom.addEventListener('gestureend', preventDefault)
    dom.addEventListener('touchstart', preventDefault, { passive: false })
    dom.addEventListener('touchmove', preventDefault, { passive: false })
    dom.addEventListener('contextmenu', onContextMenu)
    dom.addEventListener('lostpointercapture', onLostCapture)
    dom.addEventListener('wheel', onWheel, { passive: true })
    // pause the render loop entirely while the tab is hidden (perf budget)
    const onVisibility = () => {
      if (document.hidden) stopLoop()
      else startLoop()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const removeListeners = () => {
      controls.removeEventListener('start', onControlsStart)
      controls.removeEventListener('end', onControlsEnd)
      offRenderProgress()
      dom.removeEventListener('pointermove', onPointerMove)
      dom.removeEventListener('pointerdown', onPointerDown)
      dom.removeEventListener('pointerup', onPointerUp)
      dom.removeEventListener('pointercancel', onPointerCancel)
      dom.removeEventListener('pointerleave', onPointerLeave)
      dom.removeEventListener('gesturestart', preventDefault)
      dom.removeEventListener('gesturechange', preventDefault)
      dom.removeEventListener('gestureend', preventDefault)
      dom.removeEventListener('touchstart', preventDefault)
      dom.removeEventListener('touchmove', preventDefault)
      dom.removeEventListener('contextmenu', onContextMenu)
      dom.removeEventListener('lostpointercapture', onLostCapture)
      dom.removeEventListener('wheel', onWheel)
      document.removeEventListener('visibilitychange', onVisibility)
    }

    const resizeObserver = new ResizeObserver(() => this.handleResize())
    resizeObserver.observe(container)

    const m: Mounted = {
      container,
      renderer,
      scene,
      camera,
      controls,
      board,
      componentsGroup,
      wiresGroup,
      terminalsGroup,
      overlayGroup,
      pmrem,
      envTex,
      keyLight,
      fillLight,
      groundGroup,
      groundGeo,
      backdropMat,
      backdropTexs,
      clock,
      reduced,
      hoverRing,
      holeLabel,
      screenChip,
      paddles: paddleBuild.paddles,
      paddleGeos: paddleBuild.geos,
      spawnFx,
      fingertipGroup,
      fingertipGeos,
      fingertipRingMat,
      fingertipGlowMat,
      fingertipCrossMat,
      homePos: camera.position.clone(),
      homeTarget: controls.target.clone(),
      selBoxGeo,
      selBoxMat,
      capGeo,
      tipGeo,
      tipMat,
      postGeo,
      postMat,
      previewMesh: null,
      previewMat,
      resizeObserver,
      raf: 0,
      rafActive: false,
      objectPickRoots: [componentsGroup, wiresGroup],
      hoverPickRoots: [terminalsGroup, componentsGroup, wiresGroup],
      removeListeners,
    }
    this.m = m

    // aspect-fit home framing (replaces the provisional position above): a
    // portrait phone must see the whole board, not a landscape-tuned crop
    // (insets set before mount shift the projection first — setViewInsets)
    this.applyViewOffset(m)
    this.computeHomeFraming(m)
    m.camera.position.copy(m.homePos)
    m.controls.target.copy(m.homeTarget)
    m.controls.update()

    // sync any state set before mount
    this.positionPaddles(m)
    this.syncLayout()
    this.syncGhost()
    this.syncWirePreview()
    this.applySelection()
    this.applyTelemetryAll()
    this.updateTouchGestures()

    // PERF (perf/hotspots.md, A5): pre-warm the first-use FX shader programs.
    // The hover ring + coordinate chip otherwise compile in the middle of the
    // user's FIRST drag (+2 program links, a >100ms frame mid-orbit), and the
    // hologram/pin-marker materials compile mid-first-placement. compile()
    // walks the graph with scene.traverse (visibility ignored), so the
    // invisible FX already mounted warm in place; the on-demand hologram
    // materials are compiled against throwaway meshes. One-time mount cost —
    // these programs would otherwise compile inside a gesture.
    {
      const warmGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1)
      const warm = new THREE.Group()
      warm.name = 'shader-warmup'
      warm.visible = false
      const warmMarkers: PinMarkers[] = []
      for (const variant of ['valid', 'invalid'] as const) {
        warm.add(new THREE.Mesh(warmGeo, makeHologramMaterial(variant)))
        const markers = makePinMarkers([{ x: 0, y: 0, z: 0 }], variant)
        warmMarkers.push(markers)
        warm.add(markers.group)
      }
      // outline hulls (lesson rims of instruments, the problem layer): one
      // program for every tint — the first problem pulse must not compile
      warm.add(new THREE.Mesh(warmGeo, makeOutlineMaterial('error')))
      scene.add(warm)
      renderer.compile(scene, camera)
      scene.remove(warm)
      for (const mk of warmMarkers) mk.dispose()
      warmGeo.dispose() // hologram/marker materials stay module-cached
    }

    let prevFrameT = 0 // rAF-local: render-mode dt without per-frame allocs
    const animate = () => {
      if (this.m !== m || !m.rafActive) return // disposed/paused — stop this loop
      m.raf = requestAnimationFrame(animate)
      // diagnostics (src/ui/perf): frame CPU time + per-frame render totals
      const probe = this.perfProbe
      const probeT0 = probe ? performance.now() : 0
      if (probe) {
        m.renderer.info.autoReset = false
        m.renderer.info.reset()
      }
      m.controls.update()
      this.updateCamTween(m) // after controls.update so the tween wins while active
      // shared-FX clock: one number write drives every hologram/marker shader
      const t = m.clock.getElapsedTime()
      const dt = prevFrameT > 0 ? t - prevFrameT : 0
      prevFrameT = t
      tickHolograms(t)
      m.hoverRing.tick(t)
      this.updatePaddles(m, t)
      this.updateSpawnTween(m)
      this.updateRemovalTween(m)
      this.updateFadeTween()
      if (m.spawnFx.live) m.spawnFx.tick(performance.now())
      this.updateGhostSpin()
      if (this.labelPinnedUntil > 0 && performance.now() > this.labelPinnedUntil) {
        this.labelPinnedUntil = 0
        // a pinned chip the hover pass has not replaced since: let the next
        // pass decide (the pointer may still rest on that hole)
        if (this.chipKey === PINNED_CHIP_KEY) {
          this.chipKey = STALE_CHIP_KEY
          if (this.pointerInside && this.lastPointerType !== 'touch') this.pointerDirty = true
          else this.hideChip(m)
        } else if (!this.pointerInside || this.chipKey === '') {
          // a hover chip the pin kept up after the pointer left the board (or
          // found nothing) — e.g. a click, then a quick move onto a panel —
          // must not outlive the pin: it would name a hole nobody points at
          this.hideChip(m)
          this.chipKey = ''
        }
      }
      // the docked chrome's screen chip follows its anchor (camera moves)
      if (m.screenChip.visible) this.placeChip(m)
      if (this.ledLabels.length > 0) this.sizeLedLabels(m)
      // PERF (perf/hotspots.md B3): hover targeting is meaningless while an
      // orbit gesture is in flight — without the gate the brute-force
      // raycast (+ its Intersection allocations) runs on EVERY orbit frame,
      // because the drag moves the pointer each frame. pointerDirty stays
      // set (and onControlsEnd re-arms it), so the ring/label/cursor refresh
      // on the frame the gesture releases.
      if (this.pointerDirty && this.pointerInside && !this.controlsInteracting) {
        this.processHover(m)
        this.pointerDirty = false
      }
      // throttled Studio material refresh (telemetry / wire-tint changes)
      if (
        this.materialsRefreshPending &&
        performance.now() - this.lastMaterialsRefresh >= MATERIALS_REFRESH_MS
      ) {
        this.materialsRefreshPending = false
        this.lastMaterialsRefresh = performance.now()
        this.modes.invalidate('materials')
      }
      // Performance mode (and any still-loading pipeline) returns false and
      // the classic raster pipeline below runs untouched — byte-identical
      // behavior and cost to the pre-render-modes loop. Enhanced/Studio draw
      // inside render(); a path-traced frame additionally gets the raster
      // overlays (holograms, hover FX, selection) composited on top so every
      // interactive affordance stays live over the converging/held still.
      if (!this.modes.render(dt)) {
        m.renderer.render(m.scene, m.camera)
      } else if (this.modes.pathTracedFrame) {
        this.renderStudioOverlays(m)
      }
      if (probe) {
        probe.frameMs[probe.frames % probe.frameMs.length] = performance.now() - probeT0
        probe.frames++
        probe.calls = m.renderer.info.render.calls
        probe.triangles = m.renderer.info.render.triangles
      }
    }
    const startLoop = () => {
      if (this.m !== m || m.rafActive) return
      m.rafActive = true
      m.raf = requestAnimationFrame(animate)
    }
    const stopLoop = () => {
      if (!m.rafActive) return
      m.rafActive = false
      cancelAnimationFrame(m.raf)
    }
    if (!document.hidden) startLoop() // else onVisibility resumes it
  }

  dispose(): void {
    const m = this.m
    if (!m) return
    this.m = null // stops the animation loop

    cancelAnimationFrame(m.raf)
    m.resizeObserver.disconnect()
    m.removeListeners()
    // before scene teardown: Enhanced/Studio restore the displaced
    // environment + shadow budget onto still-live objects, and Studio frees
    // its BVH/accumulation GPU memory
    this.modes.dispose()
    m.controls.dispose()

    this.clearSelectionHighlights()
    for (const id of Array.from(this.components.keys())) this.removeComponentRecord(m, id)
    for (const id of Array.from(this.wires.keys())) this.removeWireRecord(m, id)
    this.components.clear()
    this.wires.clear()

    if (m.previewMesh) {
      m.overlayGroup.remove(m.previewMesh)
      ;(m.previewMesh.geometry as THREE.BufferGeometry).dispose()
    }
    m.previewMat.dispose()
    this.cancelEditDrags()
    this.clearGhostFx(m)
    this.clearHighlightFx(m) // the spec survives: a remount rebuilds it
    this.clearProblemFx(m) // likewise
    this.clearSourceFx(m) // likewise
    this.clearWireHandles(m)
    this.clearAnchorFx()
    disposeHolograms() // module-cached FX materials (recreated on demand)
    disposeWireEndMaterials() // likewise (wire end grips, the refused-route tint)
    m.hoverRing.dispose()
    m.holeLabel.dispose()
    m.screenChip.dispose()
    this.finishBoardAnims(m) // removal tween may hold the OLD board build
    m.spawnFx.dispose()
    for (const g of m.paddleGeos) g.dispose()
    for (const p of m.paddles) {
      p.mat.dispose()
      p.glyphMat.dispose()
      p.minusMat?.dispose()
      p.minusGlyphMat?.dispose()
    }
    for (const g of m.fingertipGeos) g.dispose()
    m.fingertipRingMat.dispose()
    m.fingertipGlowMat.dispose()
    m.fingertipCrossMat.dispose()
    m.selBoxGeo.dispose()
    m.selBoxMat.dispose()
    m.capGeo.dispose()
    m.tipGeo.dispose()
    m.tipMat.dispose()
    m.postGeo.dispose()
    m.postMat.dispose()
    m.groundGeo.dispose()
    m.backdropMat.dispose()
    for (const t of m.backdropTexs) t.dispose()
    m.keyLight.shadow.dispose()
    m.scene.environment = null
    m.envTex.dispose()
    m.pmrem.dispose()
    m.board.dispose()

    m.scene.clear()
    m.renderer.dispose()
    m.renderer.domElement.remove()
    m.container.style.cursor = ''

    this.cancelLongPress()
    this.releasePress() // a held part must not stay pressed in the document
    this.flushPressRelease()
    this.rightDown = null
    this.lastTargetFrame = null
    this.camTween = null
    this.flyHomePending = false
    this.pendingGrowDir = null
    this.pendingShrinkDir = null
    this.labelPinnedUntil = 0
    this.chipKey = ''
    this.chipLive = null
    this.chipPartBox = null
    this.paddleHover = null
    this.paddleMinusHover = null
    this.ghostSpin = null
    this.lastGhostKey = ''
    this.lastGhostRotation = 0
    this.controlsSuspended = false
    this.controlsInteracting = false
    this.pointerInteracting = false
    this.materialsRefreshPending = false
    this.lastMaterialsRefresh = 0
    this.activeTouchId = null
    this.tapSuppressed = false
    this.lastBgTap = null
    this.fingertipHasPoint = false
    this.pointerDirty = false
    this.pointerInside = false
    this.lastHoverHole = null
    this.downInfo = null
    this.hitBuf.length = 0
  }

  setCallbacks(cb: Partial<SceneCallbacks>): void {
    Object.assign(this.callbacks, cb)
  }

  // ------------------------------------------------------------------ state

  setLayout(layout: CircuitLayout): void {
    this.layout = layout
    if (this.m) this.syncLayout()
  }

  setTelemetry(t: SimTelemetry | null): void {
    const changed = t !== this.telemetry
    const sessionFlip = (t === null) !== (this.telemetry === null)
    this.telemetry = t
    // PERF: the engine emits a FRESH telemetry object per push, so an
    // identical reference carries nothing new — skip the O(components)
    // visual pass (a paused sim re-pushing the same snapshot costs zero).
    // A new snapshot refreshes only the parts whose visual inputs changed.
    if (!changed) return
    if (!this.m) {
      this.materialsRefreshPending = true
      return
    }
    // Studio: LED emissive / display segments are material-only changes —
    // request a (throttled) refresh so a held still shows live LED state.
    // No-op in Performance/Enhanced (they redraw every frame anyway). A
    // snapshot that changed no part's visual leaves the materials as they are.
    if (this.applyTelemetryChanged() > 0) this.materialsRefreshPending = true
    this.refreshHoleChip(t === null)
    // SC-10: a session starting / ending swaps the lesson shells for rings +
    // rims and back; the LED labels follow the telemetry at ≤ 4 Hz
    if (sessionFlip && this.highlightSpec) this.syncHighlights()
    else this.refreshLedLabels(false)
    // a quick click's deferred release: once the simulation has run a
    // human-length press (or the session ended), let go
    const pr = this.pendingRelease
    if (pr && (t === null || !(t.time < pr.until))) this.flushPressRelease()
  }

  /**
   * Live hover chip (SC-4): the host's chip text may carry live values (pin
   * mode, node voltage), so while the chip rests on a hole it is re-asked at
   * most every CHIP_REFRESH_MS — and at once when the session ends, so no
   * stale reading outlives the simulation. setText redraws only on change.
   */
  private refreshHoleChip(force: boolean): void {
    const m = this.m
    const live = this.chipLive
    if (!m || live === null || !this.chipShown(m) || !this.callbacks.holeLabelText) return
    const now = performance.now()
    if (!force && now - this.chipRefreshAt < CHIP_REFRESH_MS) return
    this.chipRefreshAt = now
    const text = live.kind === 'hole' ? this.holeChipText(live.ref) : this.terminalChipText(live.ref)
    if (text) this.setChipText(m, text)
  }

  /**
   * The layout changed under a showing hover chip (release close-out —
   * docked chrome only; the classic chrome keeps its chip until the pointer
   * moves, as before): after a Delete, 「PS1 正端 · 5.00 V」 must not stay
   * over the spot the supply left, nor its ring on a post that is gone.
   *  - a mouse resting on the canvas: the next hover pass re-aims (one
   *    raycast on the next frame — event-driven, never per frame), so the
   *    chip names whatever is under the pointer now, or hides;
   *  - otherwise (a finger's pinned chip, a chip kept after the pointer
   *    left): re-ask its text in place; a terminal whose part is gone takes
   *    its chip and ring with it.
   * Nothing to do while no chip shows, or while the probe menu mutes it.
   */
  private refreshChipAfterLayout(m: Mounted): void {
    if (!this.isDocked() || this.chipKey === '' || this.chipMutedAt) return
    if (!this.chipShown(m) && !m.hoverRing.object.visible) return
    if (this.pointerInside && this.lastPointerType !== 'touch' && this.chipKey !== PINNED_CHIP_KEY) {
      this.chipKey = STALE_CHIP_KEY
      this.pointerDirty = true
      return
    }
    const live = this.chipLive
    if (!live) return
    if (live.kind === 'terminal' && !this.resolveEndpoint(live.ref)) {
      m.hoverRing.hide(m.clock.getElapsedTime())
      this.hideChip(m)
      this.chipKey = ''
      this.chipLive = null
      return
    }
    const text = live.kind === 'hole' ? this.holeChipText(live.ref) : this.terminalChipText(live.ref)
    if (text) this.setChipText(m, text)
    else {
      this.hideChip(m)
      this.chipKey = ''
      this.chipLive = null
    }
  }

  /**
   * The camera moves while the pointer does not (release polish — docked
   * chrome only; the classic chrome keeps its world-sized chip until the
   * pointer moves, as before): the selection-follow pan after select(), a
   * re-frame / F / focus tween, a reduced-motion jump, a view-inset or canvas
   * size change. The chip and ring name what WAS under a pointer that is
   * still, and the board now slides under it — in pwm-fade, selecting LED1
   * slid 「U1 PA6 … c19」 under the undo / redo pill. Both hide now (once per
   * move, from the camera-change paths — never per frame); when the camera
   * settles, rearmChipAfterCamera gives a mouse resting on the canvas one
   * hover pass, so the chip names what is under the pointer then. A finger
   * rests nowhere: its chip stays hidden until the next touch. An editing
   * drag or a finger aiming owns its chip and keeps it.
   */
  private hideChipForCameraMove(m: Mounted): void {
    if (!this.isDocked()) return
    if (this.moveDrag?.started || this.instDrag?.started || this.marquee?.started || this.wireEndDrag || this.activeTouchId !== null) return
    this.chipAfterCamera = true
    // a pass still pending from before the move (select() re-asks a body chip) would re-show the
    // chip on the first tween frame and let it ride the board: the landing re-aims instead
    this.pointerDirty = false
    if (this.chipKey === '' && !this.chipShown(m) && !m.hoverRing.object.visible) return
    m.hoverRing.hide(m.clock.getElapsedTime())
    this.hideChip(m)
    this.chipKey = ''
    this.chipLive = null
    this.labelPinnedUntil = 0
  }

  /** The camera settled after hideChipForCameraMove: a mouse resting on the canvas re-aims (one raycast on the next frame). */
  private rearmChipAfterCamera(): void {
    if (!this.chipAfterCamera) return
    this.chipAfterCamera = false
    if (this.pointerInside && this.lastPointerType !== 'touch') this.pointerDirty = true
  }

  /**
   * Diagnostics (src/ui/perf): attach a probe that records per-frame CPU
   * time, draw calls / triangles (summed over every pass of the active
   * render mode) and telemetry-application cost; null detaches it. Not part
   * of IBreadboardScene — the overlay feature-detects it.
   */
  attachPerfProbe(probe: ScenePerfProbe | null): void {
    this.perfProbe = probe
    // renderer.info normally resets per render() call; while probing it is
    // reset once per frame instead so multi-pass modes report their total
    if (this.m) this.m.renderer.info.autoReset = probe === null
  }

  /** GPU resources the renderer currently holds (diagnostics; null before mount). */
  perfMemory(): { geometries: number; textures: number; programs: number } | null {
    const m = this.m
    if (!m) return null
    const info = m.renderer.info
    return {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
    }
  }

  setGhost(ghost: GhostSpec | null): void {
    this.ghost = ghost
    this.updateTouchGestures() // ghost ⇒ place mode may be inferred
    if (this.m) this.syncGhost()
  }

  setSelection(ids: string[]): void {
    this.selectedIds = ids.slice()
    if (!this.m) return
    this.applySelection()
    // a part body's neutral chip says whether that part is selected
    // (release QA SC-F2 「… · 已選取」): the next hover pass re-asks its text
    if (this.chipKey.startsWith('o:')) {
      this.chipKey = STALE_CHIP_KEY
      if (this.pointerInside && this.lastPointerType !== 'touch') this.pointerDirty = true
    }
    // docked chrome only: a selection made from a panel (problem list,
    // inspector, probe menu…) that sits under the chrome comes into view
    if (ids.length > 0 && this.freeArea(this.m)) this.followSelection(this.m)
  }

  setWirePreview(from: HoleRef | string | null, to: HoleRef | null): void {
    this.preview = { from, to }
    this.updateTouchGestures() // active preview ⇒ wire mode may be inferred
    if (this.m) this.syncWirePreview()
  }

  /**
   * ADDITIVE contract extension (optional in IBreadboardScene): the host
   * app's interaction mode. Enables touch ergonomics — fingertip ghost-cursor
   * and one-finger aiming (instead of orbiting) during place/wire. When never
   * called, the scene infers the mode from setGhost/setWirePreview.
   */
  setInteractionMode(mode: SceneInteractionMode): void {
    this.explicitMode = mode
    this.updateTouchGestures()
    this.syncWireHandles()
  }

  /**
   * ADDITIVE contract extension (optional in IBreadboardScene): spring the
   * camera to frame the current circuit. The host calls this after wholesale
   * layout loads (examples / JSON import / AI apply) — those circuits can sit
   * anywhere on the board, and the fixed home framing crops phone portrait
   * viewports to a fraction of it. Empty board → home framing.
   */
  frameContent(): void {
    this.reframeCamera()
  }

  /**
   * ADDITIVE contract extension (optional in IBreadboardScene): the user's
   * render-mode preference (More sheet picker → store.renderMode). The
   * manager clamps unsupported modes to the device's best fallback and
   * persists the resolved choice under 'bb.renderMode'. Like all desired
   * state this survives unmount/remount (applied again after init).
   */
  setRenderMode(mode: RenderModeId): void {
    this.renderModePref = mode
    if (this.m) this.modes.setMode(mode)
  }

  /**
   * ADDITIVE contract extension (optional in IBreadboardScene): the screen
   * area docked chrome covers (desktop workspace panels + tray), CSS px from
   * each canvas edge. The projection's principal point moves to the centre
   * of the free rectangle (applyViewOffset) and the home / content framings
   * fit that rectangle; a camera parked at (or flying to) either framing
   * re-frames, a user-placed camera keeps its pose. All-zero insets clear
   * the offset — the projection is then exactly the classic one.
   */
  setViewInsets(insets: ViewInsets): void {
    const px = (v: number) => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0)
    const next = { left: px(insets.left), right: px(insets.right), top: px(insets.top), bottom: px(insets.bottom) }
    const cur = this.viewInsets
    if (
      next.left === cur.left &&
      next.right === cur.right &&
      next.top === cur.top &&
      next.bottom === cur.bottom
    ) {
      return
    }
    this.viewInsets = next
    const m = this.m
    if (!m) return // mount applies it
    // where is the camera parked / heading? (decided against the OLD framings)
    const tw = this.camTween
    const pos = tw ? tw.endPos : m.camera.position
    const tgt = tw ? tw.endTgt : m.controls.target
    const near = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceToSquared(b) < 0.04
    const atHome = near(pos, m.homePos) && near(tgt, m.homeTarget)
    const cf = this.lastContentFrame
    const atContent = !atHome && cf !== null && near(pos, cf.pos) && near(tgt, cf.tgt)
    const tf = this.lastTargetFrame
    const atTargets = !atHome && !atContent && tf !== null && near(pos, tf.pos) && near(tgt, tf.tgt)
    this.applyViewOffset(m)
    this.computeHomeFraming(m)
    if (atHome) this.flyCamera(m, m.homePos, m.homeTarget)
    else if (atContent) this.reframeCamera()
    else if (atTargets && tf) this.flyToBox(m, tf.box, tf.minSpan, tf.dir, tf.extra)
    // a user-placed camera keeps its pose — but a selection the new chrome
    // now covers (the inspector springing open) still comes into view
    else if (this.selectedIds.length > 0 && this.freeArea(m)) this.followSelection(m)
    // the new offset shifts the whole image under the pointer (a glide re-arms when it lands)
    this.hideChipForCameraMove(m)
    if (!this.camTween) this.rearmChipAfterCamera()
  }

  /**
   * ADDITIVE contract extension (optional in IBreadboardScene, UX fix wave
   * SC-16): the parts library is open (the phone's Parts sheet). With docked
   * chrome and a coarse pointer the grow paddles show while it is — a board
   * to grow is a parts question — and while a part is armed. Safe to never call.
   */
  setPartsBrowsing(open: boolean): void {
    this.partsBrowsing = open
  }

  /**
   * ADDITIVE contract extension (optional in IBreadboardScene, UX fix wave
   * SC-16): the new (docked) chrome is showing — the host passes
   * !isLegacyChrome(). It picks the screen-space hover chip (SC-12) over the
   * classic world-sized one, the wire end handles (SC-13), the touch probe
   * long-press (SC-14) and the grow-paddle gating (near-edge reveal with a
   * mouse; with a finger only while a part is armed or the parts library is
   * open) with their hover labels. Never called = the scene guesses from
   * the view insets (hasInsets), as before.
   */
  setDockedChrome(on: boolean): void {
    if (this.dockedChrome === on) return
    this.dockedChrome = on
    const m = this.m
    if (!m) return
    // the two chromes draw different chips: let the next hover pass redraw
    this.hideChip(m)
    this.chipKey = STALE_CHIP_KEY
    this.pointerDirty = true
    this.syncWireHandles() // the end handles are docked-chrome only
  }

  /**
   * ADDITIVE contract extension (optional in IBreadboardScene, UX wave
   * SC-1): spring the camera along the home view direction so the box of
   * the referenced holes / off-board terminals / part and wire meshes
   * (+ FRAME_PAD) fits the free rectangle (setViewInsets) — never closer
   * than `minSpanHoles` hole pitches across. Unknown refs / ids are
   * skipped; nothing known = no camera move.
   */
  frameTargets(spec: HighlightSpec, opts?: FrameTargetsOptions): void {
    const m = this.m
    if (!m) return
    const box = this.targetsBox(spec, new THREE.Box3())
    if (!box) return
    const span = opts?.minSpanHoles
    const positive = (v: number | undefined) => (v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined)
    this.flyToBox(
      m,
      box,
      Number.isFinite(span) && span !== undefined && span > 0 ? span : TARGETS_MIN_SPAN,
      elevatedViewDir(opts?.minElevationDeg),
      { minPitchPx: positive(opts?.minPitchPx), coverBottomPx: positive(opts?.coverBottomPx) },
    )
  }

  /**
   * ADDITIVE contract extension (optional in IBreadboardScene, release QA
   * SC-F1): the projected distance (CSS px) between two neighbouring hole
   * columns at plan point `at` — default the centre of the board grid —
   * from the camera's RESTING pose (a running glide counts by its
   * destination). Null before mount or when the point is behind the
   * camera. A scratch camera measures; the live one never moves.
   */
  holePitchPx(at?: { x: number; z: number }): number | null {
    const m = this.m
    if (!m) return null
    const tw = this.camTween
    let x: number
    let z: number
    if (at && Number.isFinite(at.x) && Number.isFinite(at.z)) {
      x = at.x
      z = at.z
    } else {
      const b = boardExtents(boardConfigOf(this.layout))
      x = (b.minX + b.maxX) / 2
      z = (b.minZ + b.maxZ) / 2
    }
    return this.pitchFrom(m, tw ? tw.endPos : m.camera.position, tw ? tw.endTgt : m.controls.target, x, z)
  }

  /**
   * One column pitch at plan (x, z) on the board plane, in CSS px, for a
   * camera at `pos` looking at `tgt` with the live camera's lens and view
   * offset (scratch camera). Null for an unsized canvas or a point behind
   * the camera.
   */
  private pitchFrom(m: Mounted, pos: THREE.Vector3, tgt: THREE.Vector3, x: number, z: number): number | null {
    const w = m.container.clientWidth
    const h = m.container.clientHeight
    if (w < 1 || h < 1) return null
    const cam = this.pitchCam ?? (this.pitchCam = new THREE.PerspectiveCamera())
    cam.copy(m.camera, false)
    cam.position.copy(pos)
    cam.up.set(0, 1, 0)
    cam.lookAt(tgt)
    cam.updateMatrixWorld(true)
    const a = new THREE.Vector3(x - 0.5, 0, z).project(cam)
    const b = new THREE.Vector3(x + 0.5, 0, z).project(cam)
    if (a.z > 1 || b.z > 1) return null
    return Math.hypot(((b.x - a.x) * w) / 2, ((b.y - a.y) * h) / 2)
  }

  /**
   * ADDITIVE contract extension (optional in IBreadboardScene, UX wave
   * SC-1): the PROBLEM layer, independent of the lesson highlights — pulsing
   * red ('error') / amber ('risk') ring markers on holes and terminal posts,
   * and an outline hull (the part stays fully visible) around the named
   * components AND wires. Null / empty clears it; while clear nothing is in
   * the scene graph. Follows layout edits like setHighlights.
   */
  setProblemHighlights(spec: ProblemHighlightSpec | null): void {
    const strings = (xs: unknown): string[] =>
      Array.isArray(xs) ? [...new Set(xs.filter((x): x is string => typeof x === 'string' && x.length > 0))] : []
    const holes = strings(spec?.holes)
    const components = strings(spec?.components)
    const level: ProblemHighlightLevel = spec?.level === 'risk' ? 'risk' : spec?.level === 'info' ? 'info' : 'error'
    this.problemSpec = holes.length > 0 || components.length > 0 ? { holes, components, level } : null
    // every (re)shown problem announces itself: two pulses, then a steady rim
    if (this.problemSpec && this.m) restartProblemPulse(this.m.clock.getElapsedTime())
    if (this.m) this.syncProblemHighlights()
  }

  /**
   * ADDITIVE contract extension (optional in IBreadboardScene, UX fix wave
   * H7 — SC-11): the hover-only NEUTRAL marker — calm cyan rings on the
   * holes / terminal posts and a thin rim on the parts / wires an
   * instrument channel, a pin row or a problem chip points at, while the
   * pointer rests on that control. Never moves the camera; null / empty
   * clears it, and while clear nothing is in the scene graph. Follows
   * layout edits like the other layers.
   */
  setSourceHighlight(spec: HighlightSpec | null): void {
    const strings = (xs: unknown): string[] =>
      Array.isArray(xs) ? [...new Set(xs.filter((x): x is string => typeof x === 'string' && x.length > 0))] : []
    const holes = strings(spec?.holes)
    const components = strings(spec?.components)
    this.sourceSpec = holes.length > 0 || components.length > 0 ? { holes, components } : null
    if (this.m) this.syncSourceHighlights()
  }

  /**
   * ADDITIVE contract extension (optional in IBreadboardScene): lesson
   * highlights — pin markers on holes / terminals, hologram shells around
   * parts (the placement-ghost FX, valid tint). Empty / null clears; with
   * nothing highlighted no object exists in the scene graph.
   */
  setHighlights(spec: HighlightSpec | null): void {
    const strings = (xs: unknown): string[] =>
      Array.isArray(xs) ? [...new Set(xs.filter((x): x is string => typeof x === 'string' && x.length > 0))] : []
    const holes = strings(spec?.holes)
    const components = strings(spec?.components)
    this.highlightSpec = holes.length > 0 || components.length > 0 ? { holes, components } : null
    if (this.m) this.syncHighlights()
  }

  /**
   * Shift the projection's principal point to the centre of the rectangle
   * the view insets leave free: a sub-window of the canvas's own pixel size,
   * offset by half the inset imbalance (camera.setViewOffset) — aspect and
   * per-pixel angle are unchanged, so the field of view keeps its meaning,
   * raycasts / project() follow automatically and Studio copies the matrix.
   * No insets → no view offset at all (legacy projection, bit-identical).
   */
  private applyViewOffset(m: Mounted): void {
    const fr = this.freeArea(m)
    if (!fr) {
      if (m.camera.view?.enabled) m.camera.clearViewOffset()
      return
    }
    m.camera.setViewOffset(fr.w, fr.h, (fr.right - fr.left) / 2, (fr.bottom - fr.top) / 2, fr.w, fr.h)
  }

  /**
   * Canvas size + effective insets (each axis' pair scaled down so at least
   * 20% of the canvas stays free) — null when there are no insets.
   */
  private freeArea(m: Mounted): {
    w: number
    h: number
    left: number
    right: number
    top: number
    bottom: number
    /** free fraction of the canvas width / height */
    fw: number
    fh: number
  } | null {
    const { left, right, top, bottom } = this.viewInsets
    if (left === 0 && right === 0 && top === 0 && bottom === 0) return null
    const w = m.container.clientWidth
    const h = m.container.clientHeight
    if (w < 1 || h < 1) return null
    const kx = Math.min(1, (w * 0.8) / Math.max(1, left + right))
    const ky = Math.min(1, (h * 0.8) / Math.max(1, top + bottom))
    const l = left * kx
    const r = right * kx
    const t = top * ky
    const b = bottom * ky
    return { w, h, left: l, right: r, top: t, bottom: b, fw: (w - l - r) / w, fh: (h - t - b) / h }
  }

  // ----------------------------------------------------------- layout diff

  private syncLayout(): void {
    const m = this.m
    if (!m) return
    this.layoutRev++

    // board size/count/board-row change → rebuild the board mesh + hole index
    // (home framing and the shadow-camera fit follow at the end of this method)
    const config = boardConfigOf(this.layout)
    if (
      config.size !== m.board.config.size ||
      config.count !== m.board.config.count ||
      config.rows !== (m.board.config.rows ?? 1)
    ) {
      this.rebuildBoard(m, config)
    } else {
      // a non-rig edit landed first (or a paddle tap was refused by the
      // store): stale paddle intents must not mis-attribute a LATER rebuild
      this.pendingGrowDir = null
      this.pendingShrinkDir = null
    }

    // un-apply highlights so saved emissive values stay coherent across rebuilds
    this.clearSelectionHighlights()

    // occlusion UX inputs: holes covered by component bodies get no hover
    // ring, a red locked coordinate chip, and silently rejected place/wire
    // clicks (mirrors the validator's occlusion pass via the same model code)
    this.occluded.clear()
    this.pinOwner.clear()
    for (const comp of this.layout.components) {
      const entry = getEntry(comp.type)
      if (!entry) continue
      for (const ref of occludedHoles(comp, entry, config)) this.occluded.add(ref)
      if (entry.placement === 'offboard') continue
      for (const h of componentPinHoles(comp, entry, config) ?? []) {
        if (h && !this.pinOwner.has(formatHole(h))) this.pinOwner.set(formatHole(h), comp.id)
      }
    }
    for (const w of this.layout.wires) {
      for (const end of [w.from, w.to]) {
        const h = parseHole(end)
        if (h && !this.pinOwner.has(formatHole(h))) this.pinOwner.set(formatHole(h), w.id)
      }
    }

    // ONE unified collision-aware routing pass: axial leaded components and
    // every wire route together (cached inside wires.ts by an endpoint +
    // obstacle signature — no-op when unchanged). Must run before the
    // component diff: routed body poses fold into the rebuild signatures.
    planRoutes(this.layout)

    // --- components ---
    const seen = new Set<string>()
    let offboardSlot = 0 // default-shelf slot: layout order, each unit advancing it by its span
    for (const comp of this.layout.components) {
      const entry = getEntry(comp.type)
      if (!entry) continue
      const slot = entry.placement === 'offboard' ? offboardSlot : -1
      if (entry.placement === 'offboard') offboardSlot += offboardSlotSpan(entry.offboard)
      const sig = componentSignature(comp, entry, slot, config)
      const existing = this.components.get(comp.id)
      if (existing && existing.signature === sig) {
        existing.comp = comp
        seen.add(comp.id)
        continue
      }
      if (existing) this.removeComponentRecord(m, comp.id)
      const rec = this.buildComponentRecord(m, comp, entry, slot, sig)
      if (rec) {
        this.components.set(comp.id, rec)
        seen.add(comp.id)
      }
    }
    for (const id of Array.from(this.components.keys())) {
      if (!seen.has(id)) this.removeComponentRecord(m, id)
    }

    // --- wires (after components, so terminal attach points are current) ---
    const seenWires = new Set<string>()
    for (const wire of this.layout.wires) {
      const a = this.resolveEndpoint(wire.from)
      const b = this.resolveEndpoint(wire.to)
      if (!a || !b) continue // unresolvable endpoint → no visual
      const sig = wireSignature(wire, a, b)
      const existing = this.wires.get(wire.id)
      if (existing && existing.signature === sig) {
        existing.wire = wire
        seenWires.add(wire.id)
        continue
      }
      if (existing) this.removeWireRecord(m, wire.id)
      this.wires.set(wire.id, this.buildWireRecord(m, wire, a, b, sig))
      seenWires.add(wire.id)
    }
    for (const id of Array.from(this.wires.keys())) {
      if (!seenWires.has(id)) this.removeWireRecord(m, id)
    }

    this.applySelection() // (re-syncs the wire end handles too)
    this.applyTelemetryAll()
    // the hover chip + ring name what is under them NOW (a deleted part's chip goes with it)
    this.refreshChipAfterLayout(m)
    // lesson highlights follow rebuilt parts (no-op while none is set)
    if (this.highlightSpec || this.highlightFx) this.syncHighlights()
    // …and so does the problem layer (outline hulls clone the live meshes)
    if (this.problemSpec || this.problemFx) this.syncProblemHighlights()
    // …and the hover-only source marker
    if (this.sourceSpec || this.sourceFx) this.syncSourceHighlights()

    // casters changed → re-render the on-demand shadow map once next frame
    m.renderer.shadowMap.needsUpdate = true
    // Studio: scene-graph contents changed → schedule a lazy BVH rebuild
    // (no-op in Performance/Enhanced; rebuild runs off the interaction path
    // — only on an idle Studio frame, on a worker when available)
    this.modes.invalidate()

    // off-board instruments and board rig changes grow/shrink the home
    // extents; while the camera is parked at home, follow it so a freshly
    // added PSU (or a bigger board) stays framed (a user-positioned camera is
    // left alone). A rig GROWTH always flies home — the new module (and the
    // plus paddle that just moved to its edge) must come into view.
    // computeHomeFraming also refits the shadow camera.
    const wasHome = this.cameraAtHome(m)
    const homeMoved = this.computeHomeFraming(m)
    if (this.spawnTween || this.removalTween) {
      // the camera glide is SEQUENCED after the board animation (drop →
      // settle → dust → glide) — updateSpawnTween/updateRemovalTween fly
      // home when they land, so just remember that home moved under us
      if (homeMoved && wasHome) this.flyHomePending = true
    } else if (this.flyHomePending || (homeMoved && wasHome)) {
      this.flyHomePending = false
      this.flyCamera(m, m.homePos, m.homeTarget)
    }
  }

  /** Swap the board mesh + hole index to a new rig config (dispose the old). */
  private rebuildBoard(m: Mounted, config: BoardConfig): void {
    const prev = m.board.config
    const prevBuild = m.board
    this.finishBoardAnims(m) // any in-flight spawn/removal snaps to its end state

    const prevRows = prev.rows ?? 1
    const rows = config.rows ?? 1
    const shrankCount =
      config.size === prev.size && config.count === prev.count - 1 && rows === prevRows
    const shrankRows =
      config.size === prev.size && rows === prevRows - 1 && config.count === prev.count
    const shrinkDir = this.pendingShrinkDir
    this.pendingShrinkDir = null

    // scene-initiated removal ("−" chip / paddle long-press): detach the
    // dropped module column / board-row from the OLD build BEFORE disposing
    // it — the groups lift + fade out over cloned materials with a small
    // dust puff, and the old build's disposal waits for the tween end.
    let removalArmed = false
    if (
      (shrankCount || shrankRows) &&
      shrinkDir !== null &&
      !m.reduced &&
      !document.hidden
    ) {
      prevBuild.group.updateMatrixWorld(true)
      const groups = shrankCount
        ? prevBuild.moduleGroups
            .map((rowMods) => rowMods[prev.count - 1])
            .filter((g): g is THREE.Group => !!g)
        : prevBuild.rowGroups[prevRows - 1]
          ? [prevBuild.rowGroups[prevRows - 1]]
          : []
      if (groups.length > 0) {
        const box = new THREE.Box3()
        for (const g of groups) box.expandByObject(g) // world rect (pre-detach)
        const bases: THREE.Vector3[] = []
        for (const g of groups) {
          // reparent to the scene at the same world pose (parents are the
          // origin-rooted board group / its z-offset row groups)
          const pw = new THREE.Vector3()
          g.parent?.getWorldPosition(pw)
          g.removeFromParent()
          g.position.add(pw)
          g.updateMatrix() // frozen subtree (B2)
          m.scene.add(g)
          g.traverse((o) => {
            ;(o as THREE.Mesh).castShadow = false // no lingering shadow
          })
          bases.push(g.position.clone())
        }
        this.removalTween = {
          groups,
          bases,
          set: buildFadeSet(groups),
          oldBuild: prevBuild,
          t0: performance.now(),
        }
        m.spawnFx.burst(
          { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z },
          performance.now(),
          9,
          0.8,
        )
        removalArmed = true
      }
    }

    m.scene.remove(prevBuild.group)
    if (!removalArmed) prevBuild.dispose() // else deferred to the tween end
    m.board = buildBoard(m.renderer.capabilities.getMaxAnisotropy(), config)
    m.scene.add(m.board.group)
    freezeTransforms(m.board.group) // static between rig edits (B2)
    this.holeIndex.rebuild(config)
    const ext = boardExtents(config)
    m.groundGroup.position.set((ext.minX + ext.maxX) / 2, 0, (ext.minZ + ext.maxZ) / 2)
    m.groundGroup.updateMatrix() // frozen (B2) — commit the recenter
    this.positionPaddles(m)
    this.lastHoverHole = null // stale refs may not exist on the new board

    // the grid GREW → the new module column / board-row DROPS in on its
    // fully prebuilt meshes (transform-only; the shadow map follows per
    // tween frame), then the camera glides home so the grown grid is framed.
    // The paddle the user tapped picks the edge: growing left/up remaps
    // content, so the NEW groups are the ones at index 0 (leftmost module
    // column / front board-row).
    const dir = this.pendingGrowDir
    this.pendingGrowDir = null
    if (config.size !== prev.size) return
    const grewCount = config.count === prev.count + 1 && rows === prevRows
    const grewRows = rows === prevRows + 1 && config.count === prev.count
    if (config.count < prev.count || rows < prevRows || (!grewCount && !grewRows)) {
      if (config.count > prev.count || rows > prevRows) this.flyHomePending = true
      return
    }
    this.flyHomePending = true
    if (document.hidden) return // FX are skipped entirely on a hidden tab
    let groups: THREE.Group[]
    let axis: 'x' | 'z'
    let tilt: number
    if (grewCount) {
      const k = dir === 'left' ? 0 : config.count - 1
      groups = m.board.moduleGroups
        .map((rowMods) => rowMods[k])
        .filter((g): g is THREE.Group => !!g)
      axis = 'z' // module columns lean sideways, toward the existing rig
      tilt = dir === 'left' ? -SPAWN_TILT_RAD : SPAWN_TILT_RAD
    } else {
      const r = dir === 'up' ? 0 : rows - 1
      const grp = m.board.rowGroups[r]
      groups = grp ? [grp] : []
      axis = 'x' // board-rows pitch front/back, toward the existing rig
      tilt = dir === 'up' ? SPAWN_TILT_RAD : -SPAWN_TILT_RAD
    }
    if (groups.length === 0) return

    if (m.reduced) {
      // reduced motion: simple fade-in — no fall, no squash, no dust
      this.fadeTween = { set: buildFadeSet(groups), t0: performance.now() }
      setFadeOpacity(this.fadeTween.set, 0)
      return
    }

    // setup allocations happen ONCE here (never per frame): per-entry pivot
    // (own plan center at board level, parent space) + base + squash bottom,
    // and the union base rect for the touchdown dust ring
    m.board.group.updateMatrixWorld(true)
    const rect: PuffRect = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
    const entries = groups.map((group) => {
      const box = new THREE.Box3().setFromObject(group)
      rect.minX = Math.min(rect.minX, box.min.x)
      rect.maxX = Math.max(rect.maxX, box.max.x)
      rect.minZ = Math.min(rect.minZ, box.min.z)
      rect.maxZ = Math.max(rect.maxZ, box.max.z)
      const base = group.position.clone()
      const pw = new THREE.Vector3()
      group.parent?.getWorldPosition(pw)
      const pivot = new THREE.Vector3(
        (box.min.x + box.max.x) / 2 - pw.x,
        -pw.y,
        (box.min.z + box.max.z) / 2 - pw.z,
      )
      return { group, base, pivot, bottom: box.min.y - pw.y - base.y }
    })
    this.spawnTween = { entries, axis, tilt, rect, t0: 0, landed: false }
    this.poseSpawnEntries(m, SPAWN_DROP_HEIGHT, this.spawnTween.tilt, 1)
  }

  /**
   * Pose every spawn entry at fall offset `yOff` with tilt `theta` about its
   * own pivot (scalar math — no per-frame allocations); `scaleY` < 1 squashes
   * about the slab's resting bottom face so the base stays planted.
   */
  private poseSpawnEntries(m: Mounted, yOff: number, theta: number, scaleY: number): void {
    const tw = this.spawnTween
    if (!tw) return
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    for (const e of tw.entries) {
      const vx = e.base.x - e.pivot.x
      const vy = e.base.y + yOff - e.pivot.y
      const vz = e.base.z - e.pivot.z
      let nx = vx
      let ny = vy
      let nz = vz
      if (theta !== 0) {
        if (tw.axis === 'z') {
          nx = vx * cos - vy * sin
          ny = vx * sin + vy * cos
        } else {
          ny = vy * cos - vz * sin
          nz = vy * sin + vz * cos
        }
      }
      const g = e.group
      g.position.set(e.pivot.x + nx, e.pivot.y + ny, e.pivot.z + nz)
      if (tw.axis === 'z') g.rotation.z = theta
      else g.rotation.x = theta
      if (scaleY !== 1) {
        g.scale.y = scaleY
        g.position.y += e.bottom * (1 - scaleY)
      } else {
        g.scale.y = 1
      }
      g.updateMatrix() // frozen board subtree (B2) — explicit commit
    }
    // the moving casters shift — keep the on-demand shadow map fresh
    m.renderer.shadowMap.needsUpdate = true
  }

  private buildComponentRecord(
    m: Mounted,
    comp: ComponentInstance,
    entry: CatalogEntry,
    slot: number,
    signature: string,
  ): ComponentRecord | null {
    const pinPositions: THREE.Vector3[] = []
    const attach: THREE.Vector3[] = []
    const posts: THREE.Mesh[] = []

    if (entry.placement === 'offboard') {
      // the part's own terminal pitch / offset (CatalogEntry.offboard) —
      // legacy instruments keep 2.5 and the full-width proxies
      const pitch = offboardGeometryOf(entry.offboard).pitch
      const proxyScaleX = Math.min(1, (pitch - POST_PROXY_GAP) / POST_PROXY_W)
      for (let i = 0; i < entry.pins.length; i++) {
        const pin = entry.pins[i]
        // explicit bench position (movable instruments) overrides the shelf
        const p = offboardTerminalPosition(slot, i, comp.pos, entry.offboard)
        pinPositions.push(new THREE.Vector3(p.x, 0, p.z))
        attach.push(new THREE.Vector3(p.x, TERMINAL_TOP_Y, p.z))

        // invisible hit proxy aligned over the instrument mesh's panel-
        // mounted post (the ONLY rendered post) — raycasts/touch picking
        // keep their generous target without a second, floating visual;
        // a fine-pitch terminal row narrows them so neighbors never overlap
        const post = new THREE.Mesh(m.postGeo, m.postMat)
        post.visible = false
        if (proxyScaleX < 1) post.scale.x = proxyScaleX
        post.position.set(p.x, TERMINAL_TOP_Y + POST_PROXY_DY, p.z + POST_PROXY_DZ)
        post.userData.terminalRef = `${comp.id}:${pin}`
        // static between edits (B2) — instrument drags updateMatrix explicitly
        post.updateMatrix()
        post.matrixAutoUpdate = false
        m.terminalsGroup.add(post)
        posts.push(post)
      }
    } else {
      // validate against the ACTIVE rig: far columns exist on labxl/multi-board
      const holes = componentPinHoles(comp, entry, boardConfigOf(this.layout))
      if (!holes) return null
      for (const h of holes) {
        if (!h) return null
        const p = holePosition(h)
        const v = new THREE.Vector3(p.x, 0, p.z)
        pinPositions.push(v)
        attach.push(v.clone())
      }
    }

    // axial leaded parts take their router-planned pose (body + lead paths);
    // wire attachment stays at the holes (attach[] above) — routed leads
    // always enter their exact holes, so picking/telemetry are unaffected
    const built = buildComponentObject(
      comp,
      entry,
      pinPositions,
      routedComponentPose(comp.id) ?? undefined,
    )
    built.object.userData.componentId = comp.id
    enableShadowCasting(built.object)
    // placed parts commit their matrices once (B2); telemetry/param updaters
    // that pose children are followed by a refresh in applyTelemetryAll, and
    // instrument drags updateMatrix the slid root explicitly
    freezeTransforms(built.object)
    m.componentsGroup.add(built.object)
    return { comp, entry, built, signature, attach, posts, slot }
  }

  private removeComponentRecord(m: Mounted, id: string): void {
    const rec = this.components.get(id)
    if (!rec) return
    m.componentsGroup.remove(rec.built.object)
    // only frees per-instance resources — module-cached shared ones are kept
    disposeComponentObject(rec.built.object)
    for (const post of rec.posts) m.terminalsGroup.remove(post) // shared geo/mat — no dispose
    this.components.delete(id)
  }

  private buildWireRecord(
    m: Mounted,
    wire: Wire,
    a: THREE.Vector3,
    b: THREE.Vector3,
    signature: string,
  ): WireRecord {
    // PVC jumper insulation (matches meshes/shared.ts makeWireMaterial spec)
    // but PER-INSTANCE: the scene mutates emissive for selection highlight and
    // disposes it with the wire — shared cached materials would break both.
    const material = new THREE.MeshPhysicalMaterial({
      color: wireColorFor(wire),
      roughness: 0.4,
      metalness: 0.0,
      clearcoat: 0.15,
      clearcoatRoughness: 0.35,
    })
    // PERF (perf/hotspots.md B1): one wire = ONE insulation draw. The two end
    // caps share the tube's material and never move relative to it, so they
    // are BAKED into the tube geometry (identical world-space shape — caps
    // were separate meshes purely for code convenience, at 2 extra draw calls
    // per wire). The up-to-2 bare tinned tip pins share tipMat and merge into
    // one more mesh. 5 draws/objects per wire → 2; merging runs only on
    // layout edits, never per frame.
    const tubeGeo = wireGeometry(a, b, WIRE_RADIUS, wire.id)
    const insulationParts: THREE.BufferGeometry[] = [tubeGeo]
    const tipParts: THREE.BufferGeometry[] = []
    for (const p of [a, b]) {
      // board-hole ends (y = 0) are stripped: the insulation stops
      // WIRE_TIP_LEN up and a bare tinned pin runs down into the socket;
      // terminal-post ends keep the classic insulated cap at the post top
      const stripped = p.y === 0
      const cap = m.capGeo.clone()
      const s = WIRE_RADIUS * 1.15
      cap.scale(s, s, s)
      cap.translate(p.x, stripped ? WIRE_TIP_LEN : p.y, p.z)
      insulationParts.push(cap)
      if (stripped) {
        const pin = m.tipGeo.clone()
        pin.translate(p.x, (WIRE_TIP_LEN - WIRE_TIP_SINK) / 2, p.z)
        tipParts.push(pin)
      }
    }
    const group = new THREE.Group()
    const mergedTube = mergeGeometries(insulationParts)
    let geo: THREE.BufferGeometry
    if (mergedTube) {
      for (const g of insulationParts) g.dispose() // copied into the merge
      geo = mergedTube
      const tube = new THREE.Mesh(geo, material)
      tube.castShadow = true // cast only — wires never receive
      group.add(tube)
    } else {
      // defensive fallback (tube/sphere attribute sets always match, so this
      // is unreachable in practice): legacy per-piece meshes, shared cap geo
      geo = tubeGeo
      for (let i = 1; i < insulationParts.length; i++) insulationParts[i].dispose()
      const tube = new THREE.Mesh(tubeGeo, material)
      tube.castShadow = true
      group.add(tube)
      for (const p of [a, b]) {
        const stripped = p.y === 0
        const cap = new THREE.Mesh(m.capGeo, material)
        cap.scale.setScalar(WIRE_RADIUS * 1.15)
        cap.position.set(p.x, stripped ? WIRE_TIP_LEN : p.y, p.z)
        group.add(cap)
      }
    }
    let tipsGeo: THREE.BufferGeometry | null = null
    if (tipParts.length > 0) {
      const mergedTips = tipParts.length === 1 ? tipParts[0] : mergeGeometries(tipParts)
      if (mergedTips) {
        if (tipParts.length > 1) for (const g of tipParts) g.dispose()
        tipsGeo = mergedTips
        const pins = new THREE.Mesh(tipsGeo, m.tipMat)
        pins.castShadow = true
        group.add(pins)
      } else {
        // unreachable fallback (identical clones always merge): shared geo
        for (const g of tipParts) g.dispose()
        for (const p of [a, b]) {
          if (p.y !== 0) continue
          const pin = new THREE.Mesh(m.tipGeo, m.tipMat)
          pin.castShadow = true
          pin.position.set(p.x, (WIRE_TIP_LEN - WIRE_TIP_SINK) / 2, p.z)
          group.add(pin)
        }
      }
    }
    group.userData.componentId = wire.id
    freezeTransforms(group) // static until this record is rebuilt (B2)
    m.wiresGroup.add(group)
    return { wire, group, signature, geo, tipsGeo, material }
  }

  private removeWireRecord(m: Mounted, id: string): void {
    const rec = this.wires.get(id)
    if (!rec) return
    m.wiresGroup.remove(rec.group)
    rec.geo.dispose()
    rec.tipsGeo?.dispose()
    rec.material.dispose()
    this.wires.delete(id)
  }

  /** World position of a wire endpoint: hole top (y=0) or terminal post top. */
  private resolveEndpoint(ref: string): THREE.Vector3 | null {
    const hole = parseHole(ref)
    if (hole) {
      const p = holePosition(hole)
      return new THREE.Vector3(p.x, 0, p.z)
    }
    const term = parseTerminalRef(ref)
    if (!term) return null
    const rec = this.components.get(term.componentId)
    if (!rec || rec.entry.placement !== 'offboard') return null
    const pinIdx = rec.entry.pins.indexOf(term.pin)
    if (pinIdx < 0) return null
    return rec.attach[pinIdx].clone()
  }

  // -------------------------------------------------------------- telemetry

  /** Refresh every part's visual (mount, layout sync): params may have changed too. */
  private applyTelemetryAll(): void {
    const t = this.telemetry
    const applied = this.appliedTelemetry
    applied.clear()
    for (const [id, rec] of this.components) {
      const ct = t ? (t.components[id] ?? null) : null
      this.applyPartTelemetry(rec, ct)
      applied.set(id, ct)
    }
  }

  /**
   * PERF: refresh only the parts whose visually relevant telemetry changed
   * since their last refresh (component-meshes sameVisualTelemetry: inert
   * fields such as pin voltages and MCU pc/cycles are ignored; a part
   * animating against wall time is always refreshed). Updaters are pure
   * functions of params + those fields, so skipping an unchanged part — its
   * updater AND the matrix recomposition of its subtree — renders exactly
   * the same frame. Parts without an updater are never refreshed here (the
   * layout path still recomposes them). Returns how many parts refreshed.
   */
  private applyTelemetryChanged(): number {
    const probe = this.perfProbe
    const t0 = probe ? performance.now() : 0
    const t = this.telemetry
    const applied = this.appliedTelemetry
    let n = 0
    let skipped = 0
    for (const [id, rec] of this.components) {
      const ct = t ? (t.components[id] ?? null) : null
      const prev = applied.get(id)
      if (
        (prev !== undefined && !telemetryAnimates(ct) && sameVisualTelemetry(prev, ct)) ||
        !hasComponentUpdater(rec.built)
      ) {
        // keep the newest snapshot as the reference (values equal anyway)
        if (prev !== undefined) applied.set(id, ct)
        skipped++
        continue
      }
      this.applyPartTelemetry(rec, ct)
      applied.set(id, ct)
      n++
    }
    if (probe) {
      probe.telemetryPushes++
      probe.telemetryMs += performance.now() - t0
      probe.partsApplied += n
      probe.partsSkipped += skipped
    }
    return n
  }

  private applyPartTelemetry(rec: ComponentRecord, ct: ComponentTelemetry | null): void {
    updateComponentVisual(rec.built, rec.comp, rec.entry, ct)
    // transforms are frozen (B2) and updaters may pose children (button
    // caps, switch levers, pot knobs) — recompose the subtree after each
    // applied update. This runs only on telemetry/layout CHANGES (exactly
    // where auto-update used to pay every frame), never during pure
    // camera motion.
    rec.built.object.traverse(refreshMatrixOf)
  }

  // ------------------------------------------------------------------ ghost

  /** Drop the holographic ghost + pin markers (frees the source build). */
  private clearGhostFx(m: Mounted): void {
    this.ghostSpin = null // any pending spin pivot dies with its hologram
    const fx = this.ghostFx
    if (!fx) return
    this.ghostFx = null
    if (fx.holo) m.overlayGroup.remove(fx.holo)
    // the hologram clone shares the source's geometry — dispose the source
    if (fx.built) disposeComponentObject(fx.built.object)
    fx.markers.dispose()
  }

  /** Quick spring that settles a freshly rotated ghost into place (R cycle). */
  private updateGhostSpin(): void {
    const s = this.ghostSpin
    if (!s) return
    const k = Math.min(1, (performance.now() - s.t0) / GHOST_SPIN_MS)
    s.pivot.rotation.y = s.from * (1 - SPRING_EASE(k))
    if (k >= 1) {
      s.pivot.rotation.y = 0
      this.ghostSpin = null
    }
  }

  /**
   * Holographic placement preview: the ACTUAL part mesh rendered through the
   * hologram material (scanlines + fresnel, cyan-blue valid / red invalid)
   * plus pulsing pin markers on every committed target hole.
   *
   *  - dip/footprint: the package at its anchor, markers on every pin hole.
   *  - routed 2-lead parts (resistor/diode/inductor): after the first pick
   *    the ghost is the FINAL routed pose stretching first-hole → hover
   *    (vertical mount included) via routeOne; before the first pick a
   *    default-span pose previews at the hover hole.
   *  - other leads/probe parts: the part spanning picked + hovered holes
   *    (remaining pins inferred rightward), markers on the real targets only.
   */
  private syncGhost(): void {
    const m = this.m
    if (!m) return
    const g = this.ghost
    if (!g) {
      this.clearGhostFx(m)
      this.clearAnchorFx()
      this.lastGhostKey = ''
      this.lastGhostRotation = 0
      return
    }
    const entry = getEntry(g.type)
    const at = parseHole(g.at)
    if (!entry || !at || entry.placement === 'offboard') {
      this.clearGhostFx(m)
      this.clearAnchorFx()
      return
    }

    const config = boardConfigOf(this.layout) // packages must fit the ACTIVE rig
    const picked = g.picked ?? []
    // armed in-plane rotation (dip/footprint; hardened against bad values)
    const rotation: Rotation = isRotation(g.rotation) ? g.rotation : 0
    const isPackage = entry.placement === 'dip' || entry.placement === 'footprint'
    // docked chrome (SC-8): where may this package go? glow every valid anchor
    if (isPackage && this.hasInsets()) this.syncAnchorFx(m, entry, rotation, config)
    else this.clearAnchorFx()
    const key = `${g.type}|${g.at}|${picked.join(',')}`
    const sig =
      `${key}|${g.valid}|r${rotation}` +
      `|${planVersion()}|${config.size}x${config.count}x${config.rows ?? 1}`
    if (this.ghostFx?.sig === sig) return
    const prevKey = this.lastGhostKey
    const prevRotation = this.lastGhostRotation
    this.lastGhostKey = key
    this.lastGhostRotation = rotation
    this.clearGhostFx(m)

    const variant: HologramVariant = g.valid ? 'valid' : 'invalid'
    const atP = holePosition(at)

    // pin world positions for the build + marker positions (real targets only)
    let pins: THREE.Vector3[] | null = null
    let markerPts: { x: number; y: number; z: number }[]
    let routed: RoutedComponent | undefined
    /** plan point the rotation spin pivots around (packages only) */
    let spinPivot: { x: number; z: number } | null = null

    if (isPackage) {
      const hs =
        entry.placement === 'dip'
          ? dipHoles(at, entry.pins.length, config, rotation)
          : entry.footprintOffsets
            ? footprintHoles(at, entry.footprintOffsets, config, rotation)
            : null
      if (hs) {
        const pts = hs.map(holePosition)
        pins = pts.map((p) => new THREE.Vector3(p.x, 0, p.z))
        markerPts = pts.map((p) => ({ x: p.x, y: 0, z: p.z }))
        // spin pivot: a DIP occupies the same holes at 180 → its hole-bbox
        // center is rotation-invariant; footprints rotate around pin 1 (at)
        if (entry.placement === 'dip') {
          let minX = Infinity
          let maxX = -Infinity
          let minZ = Infinity
          let maxZ = -Infinity
          for (const p of pts) {
            if (p.x < minX) minX = p.x
            if (p.x > maxX) maxX = p.x
            if (p.z < minZ) minZ = p.z
            if (p.z > maxZ) maxZ = p.z
          }
          spinPivot = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }
        } else {
          spinPivot = { x: atP.x, z: atP.z }
        }
      } else {
        markerPts = [{ x: atP.x, y: 0, z: atP.z }] // anchor invalid for the package
        // docked chrome (SC-8): still SHOW the package — red, where it would
        // land (running past the board edge / off its rows) — so the miss is
        // visible instead of a lone marker; the anchor glow shows where it fits
        const raw = this.hasInsets() ? rawPackagePins(at, entry, rotation) : null
        if (raw) pins = raw.map((p) => new THREE.Vector3(p.x, 0, p.z))
      }
    } else {
      // leads / probe parts: picked holes first, the hover hole next, any
      // remaining pins inferred one column to the right per pin
      const pickedPts = picked
        .map(parseHole)
        .filter((h): h is Hole => h !== null)
        .map(holePosition)
      markerPts = [...pickedPts, atP].map((p) => ({ x: p.x, y: 0, z: p.z }))
      if (routedBodyFor(g.type) && entry.pins.length === 2) {
        const a = pickedPts[0] ?? atP
        const b =
          pickedPts.length >= 1 ? atP : { x: atP.x + GHOST_DEFAULT_SPAN, z: atP.z }
        if (Math.hypot(b.x - a.x, b.z - a.z) > 1e-6) {
          routed = previewComponentPose(g.type, a, b) ?? undefined
          pins = [new THREE.Vector3(a.x, 0, a.z), new THREE.Vector3(b.x, 0, b.z)]
        }
        // a == b (hovering the already-picked hole): marker only, no hologram
      } else {
        pins = []
        for (let i = 0; i < entry.pins.length; i++) {
          const p =
            i < pickedPts.length
              ? pickedPts[i]
              : i === pickedPts.length
                ? atP
                : { x: atP.x + (i - pickedPts.length), z: atP.z }
          pins.push(new THREE.Vector3(p.x, 0, p.z))
        }
      }
    }

    let holo: THREE.Object3D | null = null
    let built: BuiltComponent | null = null
    if (pins) {
      const ghostComp: ComponentInstance =
        rotation !== 0
          ? { id: '__ghost__', type: g.type, rotation }
          : { id: '__ghost__', type: g.type }
      built = buildComponentObject(ghostComp, entry, pins, routed)
      holo = applyHologram(built.object, variant)
      // R-key / rotate-button cycle on the SAME armed ghost: spring the
      // hologram from its previous orientation into the new one (clockwise
      // plan rotation = negative yaw, so the pivot un-rotates from +delta)
      const spinDelta = (((rotation - prevRotation) % 360) + 360) % 360
      if (spinPivot && key === prevKey && spinDelta !== 0 && !m.reduced) {
        const pivot = new THREE.Group()
        pivot.name = 'ghost-spin-pivot'
        pivot.position.set(spinPivot.x, 0, spinPivot.z)
        holo.position.set(-spinPivot.x, 0, -spinPivot.z)
        pivot.add(holo)
        const from = THREE.MathUtils.degToRad(spinDelta)
        pivot.rotation.y = from
        this.ghostSpin = { pivot, from, t0: performance.now() }
        holo = pivot
      }
      m.overlayGroup.add(holo)
    }
    const markers = makePinMarkers(markerPts, pins ? variant : 'invalid')
    m.overlayGroup.add(markers.group)
    this.ghostFx = { holo, built, markers, sig }
  }

  /** Drop the anchor glow (idempotent). */
  private clearAnchorFx(): void {
    const fx = this.anchorFx
    if (!fx) return
    this.anchorFx = null
    fx.markers.dispose()
  }

  /**
   * SC-8 placement validity (docked chrome only): a soft cyan ring (no beam)
   * on every hole where the armed DIP / footprint package fits right now —
   * its pins on the rig, on free holes not covered by a part — so "Blue Pill
   * goes on row h" is visible before the first wrong click. Re-derived when
   * the part, its rotation or the layout changes (once per change: a scan
   * over the rig's holes); hovering only moves the ghost.
   */
  private syncAnchorFx(m: Mounted, entry: CatalogEntry, rotation: Rotation, config: BoardConfig): void {
    const sig = `${entry.type}|r${rotation}|${this.layoutRev}`
    if (this.anchorFx?.sig === sig) return
    this.clearAnchorFx()
    const taken = new Set<string>(this.occluded)
    for (const c of this.layout.components) {
      const e = getEntry(c.type)
      if (!e || e.placement === 'offboard') continue
      for (const h of componentPinHoles(c, e, config) ?? []) if (h) taken.add(formatHole(h))
    }
    for (const w of this.layout.wires) {
      for (const end of [w.from, w.to]) {
        const h = parseHole(end)
        if (h) taken.add(formatHole(h))
      }
    }
    const points: { x: number; y: number; z: number }[] = []
    for (const h of allHoles(config)) {
      if (h.kind !== 'strip') continue
      const hs =
        entry.placement === 'dip'
          ? dipHoles(h, entry.pins.length, config, rotation)
          : entry.footprintOffsets
            ? footprintHoles(h, entry.footprintOffsets, config, rotation)
            : null
      if (!hs || hs.some((p) => taken.has(formatHole(p)))) continue
      const p = holePosition(h)
      points.push({ x: p.x, y: 0, z: p.z })
    }
    if (points.length === 0) return
    const markers = makePinMarkers(points, 'hint', { beams: false })
    m.overlayGroup.add(markers.group)
    this.anchorFx = { markers, sig }
  }

  // ------------------------------------------------------- lesson highlights

  /** Drop the lesson highlight FX (hologram clones share geometry — nothing else to free). */
  private clearHighlightFx(m: Mounted): void {
    this.clearLedLabels()
    const fx = this.highlightFx
    if (!fx) return
    this.highlightFx = null
    m.overlayGroup.remove(fx.group)
    fx.markers?.dispose()
  }

  /** Drop the live LED labels (each owns a small canvas texture). */
  private clearLedLabels(): void {
    for (const l of this.ledLabels) l.label.dispose()
    this.ledLabels = []
  }

  /**
   * Live LED labels (SC-10): 「LED1 97 %」 over every highlighted LED from
   * its telemetry ledBrightness — redrawn at most every LED_LABEL_REFRESH_MS
   * (setTelemetry), sized to stay readable on screen (per frame while they
   * exist: one distance per label). Hidden without a simulation session.
   */
  private refreshLedLabels(force: boolean): void {
    if (this.ledLabels.length === 0) return
    const now = performance.now()
    if (!force && now - this.ledLabelsAt < LED_LABEL_REFRESH_MS) return
    this.ledLabelsAt = now
    for (const l of this.ledLabels) {
      const b = this.telemetry?.components[l.id]?.ledBrightness
      if (typeof b !== 'number' || !Number.isFinite(b)) {
        l.label.hide()
        continue
      }
      const text = `${l.id} ${fmtPercent(Math.max(0, Math.min(1, b)), { digits: 0 })}`
      if (text !== l.text) {
        l.text = text
        l.label.setText(text)
      }
      l.label.show()
    }
  }

  /** Keep the LED labels at least LED_LABEL_MIN_PX tall on screen (per frame while any exist). */
  private sizeLedLabels(m: Mounted): void {
    const tanV = Math.tan((m.camera.fov * Math.PI) / 360)
    for (const l of this.ledLabels) {
      const dist = m.camera.position.distanceTo(l.top)
      const px = (l.label.baseHeight / (2 * Math.max(0.01, dist) * tanV)) * this.viewH
      const k = px > 0 && px < LED_LABEL_MIN_PX ? Math.min(6, LED_LABEL_MIN_PX / px) : 1
      l.label.setScale(Math.round(k * 20) / 20)
    }
  }

  /**
   * Rebuild the lesson highlights when the spec or a highlighted part's
   * build changed: pin markers (ring + beam, valid tint) on every resolvable
   * hole / terminal, and per part a hologram clone of its live mesh scaled
   * about its bounding-box centre so the shell clears the part by
   * HIGHLIGHT_CLEARANCE on every side (no z-fighting with the real
   * surfaces). No spec → no FX object at all.
   */
  private syncHighlights(): void {
    const m = this.m
    if (!m) return
    const spec = this.highlightSpec
    if (!spec) {
      this.clearHighlightFx(m)
      return
    }
    const termRec = (ref: string) => {
      const term = parseHole(ref) ? null : parseTerminalRef(ref)
      return term ? this.components.get(term.componentId) : undefined
    }
    // SC-10: a running simulation turns every shell into rings + rims
    const running = this.telemetry !== null
    const sig =
      `${running ? 'run|' : ''}${spec.holes.map((h) => `${h}@${termRec(h)?.signature ?? ''}`).join(',')}` +
      `|${spec.components.map((id) => `${id}@${this.components.get(id)?.signature ?? ''}`).join(',')}`
    if (this.highlightFx?.sig === sig) return
    this.clearHighlightFx(m)

    const group = new THREE.Group()
    group.name = 'lesson-highlights'
    const points: { x: number; y: number; z: number }[] = []
    for (const ref of spec.holes) {
      const p = this.resolveEndpoint(ref)
      if (p) points.push({ x: p.x, y: p.y, z: p.z })
    }
    // SC-3: instruments and displays keep their readout visible — a ring on
    // each terminal post plus an outline rim instead of a hologram shell
    // (a cyan ghost over a DMM would hide the very digits the step asks for).
    // SC-10: so do the parts whose LIGHT the step is about (LEDs, segment /
    // matrix modules, MCU boards with their on-board LEDs) — and while the
    // simulation runs, every highlighted part: the learner is watching it.
    // Small on-board parts get a ring on each of their leg holes.
    const rimmed: ComponentRecord[] = []
    const holeCfg = boardConfigOf(this.layout)
    for (const id of spec.components) {
      const rec = this.components.get(id)
      if (!rec || !(running || keepsReadoutVisible(rec.entry))) continue
      rimmed.push(rec)
      if (rec.posts.length > 0) {
        for (const a of rec.attach) points.push({ x: a.x, y: a.y, z: a.z })
      } else if (rec.entry.pins.length <= 4) {
        for (const h of componentPinHoles(rec.comp, rec.entry, holeCfg) ?? []) {
          if (!h) continue
          const p = holePosition(h)
          points.push({ x: p.x, y: 0, z: p.z })
        }
      }
    }
    const markers = points.length > 0 ? makePinMarkers(points, 'valid') : null
    if (markers) group.add(markers.group)
    for (const rec of rimmed) group.add(applyOutline(rec.built.object, 'valid'))
    const box = new THREE.Box3()
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    // the highlighted LEDs say how bright they are while a session exists
    if (running) {
      for (const rec of rimmed) {
        if (rec.entry.type !== 'led') continue
        box.setFromObject(rec.built.object)
        if (box.isEmpty()) continue
        const label = makeHoleLabel()
        const top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + LED_LABEL_LIFT, (box.min.z + box.max.z) / 2)
        label.object.position.copy(top)
        label.object.renderOrder = 8
        group.add(label.object)
        this.ledLabels.push({ id: rec.comp.id, label, top, text: '' })
      }
      this.refreshLedLabels(true)
    }
    for (const id of spec.components) {
      const rec = this.components.get(id)
      if (!rec || running || keepsReadoutVisible(rec.entry)) continue
      // the clone keeps the part's local transforms (the components root is
      // the identity), so its box is the part's world box — minus the
      // sprites / lights / lines applyHologram drops
      const holo = applyHologram(rec.built.object, 'valid')
      box.setFromObject(holo)
      if (box.isEmpty()) continue
      box.getSize(size)
      box.getCenter(center)
      const grow = (d: number) => (d > 1e-6 ? (d + 2 * HIGHLIGHT_CLEARANCE) / d : 1)
      // scale about the box centre: outer (T(c)·S) · inner (T(−c)) · part
      const outer = new THREE.Group()
      outer.position.copy(center)
      outer.scale.set(grow(size.x), grow(size.y), grow(size.z))
      const inner = new THREE.Group()
      inner.position.set(-center.x, -center.y, -center.z)
      inner.add(holo)
      outer.add(inner)
      group.add(outer)
    }
    m.overlayGroup.add(group)
    this.highlightFx = { group, markers, sig }
  }

  // ---------------------------------------------------- problem highlights

  /** Drop the problem FX (outline clones share geometry — nothing else to free). */
  private clearProblemFx(m: Mounted): void {
    const fx = this.problemFx
    if (!fx) return
    this.problemFx = null
    m.overlayGroup.remove(fx.group)
    fx.markers?.dispose()
  }

  /**
   * Rebuild the problem layer when its spec or a named part / wire build
   * changed: tinted pin markers on every resolvable hole / terminal and an
   * outline hull around every named component or wire (red 'error', amber
   * 'risk', throbbing). No spec → no FX object at all.
   */
  private syncProblemHighlights(): void {
    const m = this.m
    if (!m) return
    const spec = this.problemSpec
    if (!spec) {
      this.clearProblemFx(m)
      return
    }
    const termSig = (ref: string) => {
      const term = parseHole(ref) ? null : parseTerminalRef(ref)
      return term ? (this.components.get(term.componentId)?.signature ?? '') : ''
    }
    const sig =
      `${spec.level}|${spec.holes.map((h) => `${h}@${termSig(h)}`).join(',')}` +
      `|${spec.components
        .map((id) => `${id}@${this.components.get(id)?.signature ?? this.wires.get(id)?.signature ?? ''}`)
        .join(',')}`
    if (this.problemFx?.sig === sig) return
    this.clearProblemFx(m)

    const group = new THREE.Group()
    group.name = 'problem-highlights'
    const points: { x: number; y: number; z: number }[] = []
    for (const ref of spec.holes) {
      const p = this.resolveEndpoint(ref)
      if (p) points.push({ x: p.x, y: p.y, z: p.z })
    }
    // 'info' (a hint): calm blue rings without the falling beams
    const markers = points.length > 0 ? makePinMarkers(points, spec.level, { beams: spec.level !== 'info' }) : null
    if (markers) group.add(markers.group)
    for (const id of spec.components) {
      const src = this.components.get(id)?.built.object ?? this.wires.get(id)?.group
      if (src) group.add(applyOutline(src, spec.level))
    }
    m.overlayGroup.add(group)
    this.problemFx = { group, markers, sig }
  }

  // --------------------------------------------- source marker (H7, hover)

  /** Drop the source-marker FX (outline clones share geometry). */
  private clearSourceFx(m: Mounted): void {
    const fx = this.sourceFx
    if (!fx) return
    this.sourceFx = null
    m.overlayGroup.remove(fx.group)
    fx.markers?.dispose()
  }

  /** Rebuild the hover-only source marker when its spec or a named build changed (none = nothing in the graph). */
  private syncSourceHighlights(): void {
    const m = this.m
    if (!m) return
    const spec = this.sourceSpec
    if (!spec) {
      this.clearSourceFx(m)
      return
    }
    const termSig = (ref: string) => {
      const term = parseHole(ref) ? null : parseTerminalRef(ref)
      return term ? (this.components.get(term.componentId)?.signature ?? '') : ''
    }
    const sig =
      `${spec.holes.map((h) => `${h}@${termSig(h)}`).join(',')}` +
      `|${spec.components
        .map((id) => `${id}@${this.components.get(id)?.signature ?? this.wires.get(id)?.signature ?? ''}`)
        .join(',')}`
    if (this.sourceFx?.sig === sig) return
    this.clearSourceFx(m)
    const group = new THREE.Group()
    group.name = 'source-highlight'
    const points: { x: number; y: number; z: number }[] = []
    for (const ref of spec.holes) {
      const p = this.resolveEndpoint(ref)
      if (p) points.push({ x: p.x, y: p.y, z: p.z })
    }
    const markers = points.length > 0 ? makePinMarkers(points, 'source', { beams: false }) : null
    if (markers) group.add(markers.group)
    for (const id of spec.components) {
      const src = this.components.get(id)?.built.object ?? this.wires.get(id)?.group
      if (src) group.add(applyOutline(src, 'source'))
    }
    m.overlayGroup.add(group)
    this.sourceFx = { group, markers, sig }
  }

  // -------------------------------------------------------------- selection

  private clearSelectionHighlights(): void {
    for (const [mat, saved] of this.savedEmissive) {
      mat.emissive.setHex(saved.color)
      mat.emissiveIntensity = saved.intensity
    }
    this.savedEmissive.clear()
    for (const box of this.selectionBoxes) box.removeFromParent()
    this.selectionBoxes.length = 0
  }

  /**
   * Component meshes share module-cached materials across instances, so they
   * are highlighted with a translucent overlay box (never by mutating their
   * materials). Wire materials are per-instance and scene-owned, so wires get
   * a precise emissive tint instead of a (potentially huge) bounding box.
   */
  private applySelection(): void {
    const hadWireTint = this.savedEmissive.size > 0
    this.clearSelectionHighlights()
    this.syncWireHandles()
    const m = this.m
    if (!m) return
    for (const id of this.selectedIds) {
      const compRec = this.components.get(id)
      if (compRec) {
        this.addSelectionBox(m, compRec.built.object)
        continue
      }
      const wireRec = this.wires.get(id)
      if (wireRec) {
        const mat = wireRec.material
        if (!this.savedEmissive.has(mat)) {
          this.savedEmissive.set(mat, {
            color: mat.emissive.getHex(),
            intensity: mat.emissiveIntensity,
          })
        }
        mat.emissive.setHex(SELECT_EMISSIVE)
        mat.emissiveIntensity = SELECT_INTENSITY
      }
    }
    // wire selection tints REAL (path-traced) materials; component selection
    // boxes live in the overlay (raster-composited) and need nothing
    if (hadWireTint || this.savedEmissive.size > 0) this.materialsRefreshPending = true
  }

  private addSelectionBox(m: Mounted, obj: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(obj)
    if (box.isEmpty()) return
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const mesh = new THREE.Mesh(m.selBoxGeo, m.selBoxMat)
    mesh.position.copy(center)
    mesh.scale.set(size.x + SELECT_BOX_PAD, size.y + SELECT_BOX_PAD, size.z + SELECT_BOX_PAD)
    mesh.renderOrder = 2
    mesh.updateMatrix() // static until the selection changes (B2)
    mesh.matrixAutoUpdate = false
    m.overlayGroup.add(mesh)
    this.selectionBoxes.push(mesh)
  }

  // ----------------------------------------------------------- wire preview

  private syncWirePreview(): void {
    const m = this.m
    if (!m) return
    if (m.previewMesh) {
      m.overlayGroup.remove(m.previewMesh)
      ;(m.previewMesh.geometry as THREE.BufferGeometry).dispose()
      m.previewMesh = null
    }
    const { from, to } = this.preview
    if (!from || !to) return
    const a = this.resolveEndpoint(from)
    const toHole = parseHole(to)
    if (!a || !toHole) return
    const pb = holePosition(toHole)
    const b = new THREE.Vector3(pb.x, 0, pb.z)
    // the preview IS the final path: routeOne against the planned world
    const mesh = new THREE.Mesh(previewWireGeometry(a, b, PREVIEW_RADIUS), m.previewMat)
    mesh.renderOrder = 3
    m.overlayGroup.add(mesh)
    m.previewMesh = mesh
  }

  // ---------------------------------------------------------------- picking

  private updateNdc(e: PointerEvent): void {
    this.updateNdcXY(e.clientX, e.clientY)
  }

  private updateNdcXY(clientX: number, clientY: number): void {
    const m = this.m
    if (!m) return
    const rect = m.renderer.domElement.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  }

  // ------------------------------------------------- press in 3D (SC-6)

  /**
   * Can `id` be pressed in 3D right now: a simulation session exists
   * (setTelemetry non-null), the scene is in select mode, and the part's
   * catalog entry has a runtime 'pressed' param (pushbutton, keypad key…).
   */
  private pressable(id: string): boolean {
    if (this.telemetry === null || this.isPlaceOrWireMode()) return false
    const rec = this.components.get(id)
    return !!rec?.entry.params?.some((p) => p.key === 'pressed')
  }

  /** Let go of a held part (idempotent): reports onObjectPress(id, false) once. */
  private releasePress(): void {
    const p = this.press
    if (!p) return
    this.press = null
    // a quick click on a loaded machine can be shorter in SIMULATED time
    // than the firmware's debounce window (120 ms of wall clock at 0.25×
    // is 30 ms on the MCU) — hold the release back until the simulation
    // has seen MIN_PRESS_SIM_S of press (setTelemetry lets go), never
    // longer than PRESS_RELEASE_CAP_MS of wall clock (a paused session)
    const now = this.telemetry?.time
    if (p.t0 !== null && typeof now === 'number' && now - p.t0 < MIN_PRESS_SIM_S) {
      this.pendingRelease = {
        id: p.id,
        until: p.t0 + MIN_PRESS_SIM_S,
        timer: setTimeout(() => this.flushPressRelease(), PRESS_RELEASE_CAP_MS),
      }
      return
    }
    this.callbacks.onObjectPress?.(p.id, false)
  }

  /** Report a held-back release now (idempotent). */
  private flushPressRelease(): void {
    const pr = this.pendingRelease
    if (!pr) return
    this.pendingRelease = null
    clearTimeout(pr.timer)
    this.callbacks.onObjectPress?.(pr.id, false)
  }

  // ------------------------------------------------- probe target (SC-5)

  /**
   * What a desktop right-click points at (pointerNdc must be current):
   * an off-board terminal post (exact, then within 14 px on screen); the pin
   * of the part under the pointer nearest to the hit point (within
   * PROBE_PIN_SNAP); the nearer end of a wire under the pointer; else the
   * board hole under the pointer (a hole under a part body included). Null
   * over empty space.
   */
  private probeTargetAtPointer(m: Mounted, touch = false): SceneProbeTarget | null {
    this.raycaster.setFromCamera(this.pointerNdc, m.camera)
    this.hitBuf.length = 0
    const termHits = this.raycaster.intersectObjects(m.terminalsGroup.children, false, this.hitBuf)
    const exact = termHits[0]?.object.userData.terminalRef
    if (typeof exact === 'string') return { terminal: exact }
    const near = this.pickTerminalNearPointer(touch ? OBJECT_TOUCH_SLOP_PX : 14)
    if (near) return { terminal: near }

    // a finger: the hole it snaps to on the board plane decides first (as
    // the aim resolver does) — a part pin or a wire end in it, or a free hole,
    // is the point to measure; a hole under a part body gives that body's sheet
    if (touch) {
      this.raycaster.setFromCamera(this.pointerNdc, m.camera)
      const hole = this.pickHole(HOLE_SNAP_DIST_TOUCH)
      if (hole && (this.pinOwner.has(hole) || !this.occluded.has(hole))) return { hole }
      if (hole) return null
    }

    this.raycaster.setFromCamera(this.pointerNdc, m.camera)
    this.hitBuf.length = 0
    const hits = this.raycaster.intersectObjects(m.objectPickRoots, true, this.hitBuf)
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object
      let id: string | null = null
      while (o && id === null) {
        const v = o.userData.componentId
        if (typeof v === 'string') id = v
        o = o.parent
      }
      if (id === null) continue
      const p = hit.point
      const rec = this.components.get(id)
      if (rec && rec.entry.placement !== 'offboard') {
        const holes = componentPinHoles(rec.comp, rec.entry, boardConfigOf(this.layout))
        let best: string | null = null
        const snap = touch ? PROBE_PIN_SNAP_TOUCH : PROBE_PIN_SNAP
        let bestD = snap * snap
        for (const h of holes ?? []) {
          if (!h) continue
          const hp = holePosition(h)
          const d2 = (hp.x - p.x) * (hp.x - p.x) + (hp.z - p.z) * (hp.z - p.z)
          if (d2 < bestD) {
            bestD = d2
            best = formatHole(h)
          }
        }
        if (best) return { hole: best }
        // a body far from its pins: probe the hole under the pointer (mouse);
        // a finger on a part body asks for that part's action sheet instead
        if (touch) return null
        break
      }
      const wire = this.wires.get(id)
      // touch: a wire's body keeps its action sheet (its ends re-route — SC-13)
      if (wire && touch) return null
      if (wire) {
        const a = this.resolveEndpoint(wire.wire.from)
        const b = this.resolveEndpoint(wire.wire.to)
        if (!a || !b) break
        const end = a.distanceToSquared(p) <= b.distanceToSquared(p) ? wire.wire.from : wire.wire.to
        return parseHole(end) ? { hole: formatHole(parseHole(end)!) } : { terminal: end }
      }
      break
    }

    this.raycaster.setFromCamera(this.pointerNdc, m.camera)
    const hole = this.pickHole(touch ? HOLE_SNAP_DIST_TOUCH : HOLE_SNAP_DIST)
    return hole ? { hole } : null
  }

  /**
   * A touch long-press fired (UX fix wave SC-14): with docked chrome a hole,
   * a part pin or a terminal post under the finger asks the host for the
   * probe menu (as an ActionSheet — onProbeRequest(…, { pointer: 'touch' }));
   * otherwise — a part / wire body, or the classic chrome — the object's
   * action sheet as before (onObjectLongPress). `id`: the object under the
   * finger at pointerdown (null over a bare hole).
   */
  private touchLongPress(id: string | null, at?: SceneProbeTarget): void {
    const m = this.m
    const down = this.downInfo
    if (m && down && down.type === 'touch' && this.isDocked() && this.callbacks.onProbeRequest) {
      this.updateNdcXY(down.x, down.y)
      const target = at ?? this.probeTargetAtPointer(m, true)
      if (target) {
        this.callbacks.onProbeRequest(target, { x: down.x, y: down.y }, { pointer: 'touch' })
        return
      }
    }
    if (id !== null) this.callbacks.onObjectLongPress?.(id)
  }

  /** Intersect the raycaster's current ray with the board plane (y = 0). */
  private rayToPlane(out: THREE.Vector3): boolean {
    const ray = this.raycaster.ray
    if (Math.abs(ray.direction.y) < 1e-9) return false
    const t = -ray.origin.y / ray.direction.y
    if (t <= 0) return false
    out.set(ray.origin.x + ray.direction.x * t, 0, ray.origin.z + ray.direction.z * t)
    return true
  }

  /** Snap the pointer ray's board-plane point to the nearest hole within maxDist. */
  private pickHole(maxDist: number): HoleRef | null {
    if (!this.rayToPlane(this.tmpVecA)) return null
    return this.holeIndex.nearest(this.tmpVecA.x, this.tmpVecA.z, maxDist)
  }

  /** Component/wire id under the pointer (sets the raycaster itself). */
  private pickObjectIdAtPointer(): string | null {
    return this.raycastRoots(this.m?.objectPickRoots ?? null, this.pointerNdc)?.componentId ?? null
  }

  /**
   * SC-9 — THE aim resolver of place / wire mode. The hover chip names its
   * result and a click / quick tap commits it, so the two can never
   * disagree. The board-plane hole under the pointer (snap radius) comes
   * first, whatever part body the ray crosses on the way — a raised Blue
   * Pill or an LED in front of the far a-row must not swallow the hole the
   * chip names. While wiring, an off-board terminal also counts: the post
   * under the ray, an instrument body under the ray (→ its nearest post),
   * or — with no hole near — a post within a few px on screen. With no hole
   * in the snap radius but a part body under the ray, the nearest hole
   * within twice the radius (a click on a tall part's top still lands on a
   * hole). `first` is the first pickable hit along the pointer ray when the
   * caller already has it (the hover pass); undefined = raycast here.
   */
  private resolveAimTarget(m: Mounted, touch: boolean, first?: PickHit | null): AimTarget | null {
    const wiring = this.isWireAiming()
    const hit = first !== undefined ? first : this.raycastRoots(m.hoverPickRoots, this.pointerNdc)
    if (wiring && hit?.terminalRef) return { kind: 'terminal', ref: hit.terminalRef }
    if (wiring && hit?.componentId) {
      const rec = this.components.get(hit.componentId)
      if (rec && rec.posts.length > 0) {
        const term = this.pickTerminalNearPointer(Infinity, rec)
        if (term) return { kind: 'terminal', ref: term }
      }
    }
    this.raycaster.setFromCamera(this.pointerNdc, m.camera)
    const snap = touch ? HOLE_SNAP_DIST_TOUCH : HOLE_SNAP_DIST
    let hole = this.pickHole(snap)
    if (!hole && wiring) {
      const near = this.pickTerminalNearPointer(touch ? OBJECT_TOUCH_SLOP_PX : TERMINAL_HOVER_SLOP_PX)
      if (near) return { kind: 'terminal', ref: near }
    }
    if (!hole && hit) hole = this.pickHole(2 * snap)
    return hole ? { kind: 'hole', hole, occluded: this.occluded.has(hole) } : null
  }

  /** The first pickable hit of an intersection list (terminal post or component / wire). */
  private pickOfHits(hits: THREE.Intersection[]): PickHit | null {
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object
      while (o) {
        const ref = o.userData.terminalRef
        if (typeof ref === 'string') return { terminalRef: ref }
        const id = o.userData.componentId
        if (typeof id === 'string') return { componentId: id }
        o = o.parent
      }
    }
    return null
  }

  /** One raycast at `ndc` against `roots` → terminalRef / componentId of the first hit. */
  private raycastRoots(
    roots: THREE.Object3D[] | null,
    ndc: THREE.Vector2,
  ): { terminalRef?: string; componentId?: string } | null {
    const m = this.m
    if (!m || !roots) return null
    this.raycaster.setFromCamera(ndc, m.camera)
    this.hitBuf.length = 0
    const hits = this.raycaster.intersectObjects(roots, true, this.hitBuf)
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object
      while (o) {
        const ref = o.userData.terminalRef
        if (typeof ref === 'string') return { terminalRef: ref }
        const id = o.userData.componentId
        if (typeof id === 'string') return { componentId: id }
        o = o.parent
      }
    }
    return null
  }

  /**
   * Nearest off-board terminal post to the pointer in SCREEN space (px).
   * Posts can be a couple of px wide at the fit-to-board zoom, so ray
   * sampling can slip past them — projecting the post tops is exact.
   */
  private pickTerminalNearPointer(slopPx: number, only?: ComponentRecord): string | null {
    const m = this.m
    if (!m) return null
    const rect = m.renderer.domElement.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    const px = ((this.pointerNdc.x + 1) / 2) * rect.width
    const py = ((1 - this.pointerNdc.y) / 2) * rect.height
    let bestD2 = Number.isFinite(slopPx) ? slopPx * slopPx : Infinity
    let best: string | null = null
    for (const rec of only ? [only] : this.components.values()) {
      for (let i = 0; i < rec.posts.length; i++) {
        const ref = rec.posts[i].userData.terminalRef
        if (typeof ref !== 'string') continue
        this.tmpVecB.copy(rec.attach[i]).project(m.camera)
        if (this.tmpVecB.z > 1) continue // behind the camera
        const dx = ((this.tmpVecB.x + 1) / 2) * rect.width - px
        const dy = ((1 - this.tmpVecB.y) / 2) * rect.height - py
        const d2 = dx * dx + dy * dy
        if (d2 < bestD2) {
          bestD2 = d2
          best = ref
        }
      }
    }
    return best
  }

  /**
   * Touch-slop pick (DESIGN.md §4 44px targets): the exact ray first, then
   * rings of offset rays out to slopPx, nearest ring first — wires/posts are
   * a few px wide on screen, far too thin for a fingertip. Touch taps and
   * long-presses only; mouse picking stays pixel-exact.
   */
  private pickWithSlop(
    roots: THREE.Object3D[],
    slopPx: number,
  ): { terminalRef?: string; componentId?: string } | null {
    const m = this.m
    if (!m) return null
    const rect = m.renderer.domElement.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    const direct = this.raycastRoots(roots, this.pointerNdc)
    if (direct) return direct
    for (const [r, n] of SLOP_RINGS) {
      if (r > slopPx) break
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n
        this.tmpNdc.set(
          this.pointerNdc.x + (2 * r * Math.cos(a)) / rect.width,
          this.pointerNdc.y + (2 * r * Math.sin(a)) / rect.height,
        )
        const hit = this.raycastRoots(roots, this.tmpNdc)
        if (hit) return hit
      }
    }
    return null
  }

  /**
   * Candidate target for the fingertip ghost-cursor. Screen-space "up" is
   * mapped onto the board by unprojecting a point FINGERTIP_PROBE_PX above the
   * touch onto y = 0; the aim point is the touch's own plane point pushed
   * FINGERTIP_OFFSET_UNITS along that direction (clamped to a finger-sized
   * screen offset so the ring stays visible at any zoom), then snapped to the
   * nearest board hole — or, while wiring, the nearest off-board terminal
   * post. Side effects: fingertipHasPoint/fingertipPoint.
   */
  private pickFingertipTarget(): FingertipTarget | null {
    this.fingertipHasPoint = false
    const m = this.m
    if (!m) return null
    this.raycaster.setFromCamera(this.pointerNdc, m.camera)
    if (!this.rayToPlane(this.tmpVecA)) return null
    const rect = m.renderer.domElement.getBoundingClientRect()
    const dNdcY = rect.height >= 1 ? (2 * FINGERTIP_PROBE_PX) / rect.height : 0.06
    this.tmpNdc.set(this.pointerNdc.x, this.pointerNdc.y + dNdcY)
    this.raycaster.setFromCamera(this.tmpNdc, m.camera)
    this.fingertipPoint.copy(this.tmpVecA)
    if (this.rayToPlane(this.tmpVecB)) {
      this.tmpVecB.sub(this.tmpVecA) // plane direction of "screen up"
      this.tmpVecB.y = 0
      const len = this.tmpVecB.length() // plan-units per FINGERTIP_PROBE_PX
      if (len > 1e-6) {
        const unitsPerPx = len / FINGERTIP_PROBE_PX
        const offsetUnits = Math.min(
          Math.max(FINGERTIP_OFFSET_UNITS, FINGERTIP_OFFSET_MIN_PX * unitsPerPx),
          FINGERTIP_OFFSET_MAX_PX * unitsPerPx,
        )
        this.fingertipPoint.addScaledVector(this.tmpVecB, offsetUnits / len)
      }
    } // else: probe ray missed the plane (grazing camera) — aim at the raw point
    this.fingertipHasPoint = true
    const ax = this.fingertipPoint.x
    const az = this.fingertipPoint.z

    const hole = this.holeIndex.nearest(ax, az, HOLE_SNAP_DIST_TOUCH)
    let holeD2 = Infinity
    if (hole) {
      const h = parseHole(hole)
      if (h) {
        const p = holePosition(h)
        holeD2 = (p.x - ax) * (p.x - ax) + (p.z - az) * (p.z - az)
      }
    }

    // off-board terminal posts are wire endpoints too — the aim ring must be
    // able to land on them while wiring (they are never placement targets)
    if (this.isWireAiming()) {
      let bestD2 = TERMINAL_SNAP_DIST_TOUCH * TERMINAL_SNAP_DIST_TOUCH
      let best: FingertipTarget | null = null
      for (const rec of this.components.values()) {
        for (let i = 0; i < rec.posts.length; i++) {
          const ref = rec.posts[i].userData.terminalRef
          if (typeof ref !== 'string') continue
          const p = rec.attach[i]
          const d2 = (p.x - ax) * (p.x - ax) + (p.z - az) * (p.z - az)
          if (d2 < bestD2) {
            bestD2 = d2
            best = { kind: 'terminal', ref, x: p.x, z: p.z }
          }
        }
      }
      if (best && bestD2 <= holeD2) return best
    }
    return hole ? { kind: 'hole', hole } : null
  }

  /** Hover pass — runs at most once per animation frame, only when the pointer moved. */
  private processHover(m: Mounted): void {
    // an in-flight editing drag owns the pointer — its own handlers track it
    if (this.moveDrag?.started || this.instDrag?.started || this.marquee?.started) return
    // …and a finger holding an armed wire end keeps the grabbed end's chip until it moves
    if (this.wireEndDrag?.armed && !this.wireEndDrag.started && this.lastPointerType === 'touch') return
    // the probe menu just opened on this spot: its header names the point
    if (this.chipMutedAt) return
    // touch aiming (place/wire): the fingertip ghost-cursor drives hover
    if (this.activeTouchId !== null && this.isPlaceOrWireMode()) {
      this.processFingertip(m)
      return
    }
    m.fingertipGroup.visible = false

    const t = m.clock.getElapsedTime()
    const touch = this.lastPointerType === 'touch'
    const aiming = this.isPlaceOrWireMode()
    const docked = this.isDocked()
    // ONE object raycast per mouse hover pass (touch never hovers objects):
    // the cursor, onObjectHover, the aim resolver and the body chip read it
    let first: PickHit | null = null
    let overObject = false
    let hoverId: string | null = null
    if (!touch) {
      this.raycaster.setFromCamera(this.pointerNdc, m.camera)
      this.hitBuf.length = 0
      const hits = this.raycaster.intersectObjects(m.hoverPickRoots, true, this.hitBuf)
      overObject = hits.length > 0
      first = this.pickOfHits(hits)
      if (this.callbacks.onObjectHover) hoverId = this.objectIdOfHits(hits)
      if (hits.length > 0) this.hoverPoint.copy(hits[0].point)
    }

    // what the chip names: placing / wiring → the aim resolver (SC-9 — the
    // click commits the same thing); select → the hole under the pointer,
    // or (docked chrome) the terminal post / part body under it (SC-12)
    let target: HoverTarget | null
    if (aiming) {
      target = this.resolveAimTarget(m, touch, touch ? undefined : first)
    } else {
      this.raycaster.setFromCamera(this.pointerNdc, m.camera)
      const hole = this.pickHole(touch ? HOLE_SNAP_DIST_TOUCH : HOLE_SNAP_DIST)
      target = hole ? { kind: 'hole', hole, occluded: this.occluded.has(hole) } : null
      if (docked && !touch && first) {
        // a terminal post under (or a few px from) the pointer wins over the
        // wire end plugged onto it and over its instrument's body
        const post = first.terminalRef ?? this.pickTerminalNearPointer(TERMINAL_HOVER_SLOP_PX)
        if (post) target = { kind: 'terminal', ref: post }
        else if (
          first.componentId &&
          this.callbacks.objectLabelText &&
          !(target?.kind === 'hole' && this.pinOwner.get(target.hole) === first.componentId)
        ) {
          // a part body, not one of its own pins: say what a click does here
          target = { kind: 'object', id: first.componentId }
        }
      }
    }
    // the hole the host hears about (ghost, wire preview, store hover)
    const hole = target?.kind === 'hole' ? target.hole : aiming ? null : this.planeHoleOf(m, target)
    if (hole !== this.lastHoverHole) {
      this.lastHoverHole = hole
      this.callbacks.onHoleHover?.(hole)
    }

    if (touch) {
      this.applyHoverChip(m, t, target, aiming, docked)
      m.container.style.cursor = '' // no cursor to style — skip the object raycast
      this.setHoverObject(null) // touch never hovers
      return
    }
    // docked chrome (SC-8): which board edge is the mouse near? Only that
    // edge's "+" paddle shows (updatePaddles) — none float over the circuit
    if (docked) {
      this.paddleNear = this.rayToPlane(this.tmpVecA) ? this.nearPaddleEdge(m, this.tmpVecA.x, this.tmpVecA.z) : null
    }
    // grow-paddle hover highlight (progressive enhancement, mouse only);
    // hovering the + plate reveals its "−" chip, which keeps the paddle in
    // hover state while the pointer moves down onto it
    this.raycaster.setFromCamera(this.pointerNdc, m.camera)
    const paddle = this.pickPaddle(m)
    this.paddleHover = paddle?.rec.dir ?? null
    this.paddleMinusHover = paddle?.minus ? paddle.rec.dir : null
    if (paddle) {
      m.container.style.cursor = 'pointer'
      this.setHoverObject(null)
      // docked chrome: say what the paddle does (host text — the scene has
      // no language); the classic chrome keeps its chip-less paddles
      const text = docked ? this.paddleLabelText(paddle.rec.dir, paddle.minus) : null
      if (text) {
        const key = `p:${paddle.rec.dir}:${paddle.minus ? 1 : 0}`
        if (key !== this.chipKey) {
          this.chipKey = key
          this.chipLive = null
          m.hoverRing.hide(t)
          this.showChip(m, text, 'normal', paddle.rec.group.position, PADDLE_SIZE * 0.62, null)
        }
        return
      }
      this.applyHoverChip(m, t, target, aiming, docked)
      return
    }
    this.applyHoverChip(m, t, target, aiming, docked)
    m.container.style.cursor = overObject ? 'pointer' : ''
    // OPTIONAL onObjectHover (additive): resolved from the SAME hits — no
    // extra raycast; terminal posts report their instrument
    if (this.callbacks.onObjectHover) this.setHoverObject(hoverId)
  }

  /** Select mode over a part body / terminal: the board hole under the pointer (what onHoleHover reports). */
  private planeHoleOf(m: Mounted, target: HoverTarget | null): HoleRef | null {
    if (target === null || target.kind === 'hole') return target?.kind === 'hole' ? target.hole : null
    this.raycaster.setFromCamera(this.pointerNdc, m.camera)
    return this.pickHole(this.lastPointerType === 'touch' ? HOLE_SNAP_DIST_TOUCH : HOLE_SNAP_DIST)
  }

  /**
   * Point the hover ring + chip at `target` — only when it changed since the
   * last pass (the chip text is re-asked for live values by refreshHoleChip).
   * Holes: the ring (none on a covered hole) and the host's chip text; the
   * red locked tone in place / wire mode only (docked chrome — the classic
   * chip keeps its padlock whenever the hole is covered). Terminals (docked
   * chrome): the ring on the post and 「PS1 正端 · 5.00 V」. A part body
   * (docked, select mode): the neutral 「U1 · … · 點一下選取」 chip at the
   * pointer, no ring.
   */
  private applyHoverChip(m: Mounted, t: number, target: HoverTarget | null, aiming: boolean, docked: boolean): void {
    const key =
      target === null
        ? ''
        : target.kind === 'hole'
          ? `h:${target.hole}:${target.occluded ? 1 : 0}:${aiming ? 1 : 0}`
          : target.kind === 'terminal'
            ? `t:${target.ref}`
            : `o:${target.id}`
    if (key === this.chipKey) {
      // a body chip follows the pointer across its part
      if (target?.kind === 'object' && m.screenChip.visible) this.chipAnchor.copy(this.hoverPoint)
      return
    }
    this.chipKey = key
    this.chipLive = null
    if (target === null) {
      m.hoverRing.hide(t)
      if (this.labelPinnedUntil <= performance.now()) this.hideChip(m)
      return
    }
    if (target.kind === 'hole') {
      const h = parseHole(target.hole)
      if (!h) return
      const p = holePosition(h)
      // occluded hole (covered by a component body): NO hover ring — the
      // coordinate chip alone shows the ref (red + padlock while aiming)
      if (target.occluded) {
        m.hoverRing.hide(t)
      } else {
        m.hoverRing.object.position.set(p.x, HOVER_RING_LIFT, p.z)
        m.hoverRing.show(t)
      }
      this.chipLive = { kind: 'hole', ref: target.hole }
      this.chipTmp.set(p.x, 0, p.z)
      const tone: ChipTone = target.occluded && (aiming || !docked) ? 'locked' : 'normal'
      this.showChip(m, this.holeChipText(target.hole), tone, this.chipTmp, HOLE_LABEL_Y, target.occluded ? null : this.partNearHole(target.hole))
      return
    }
    if (target.kind === 'terminal') {
      const at = this.resolveEndpoint(target.ref)
      const text = docked && at ? this.terminalChipText(target.ref) : null
      if (!at || !docked) {
        m.hoverRing.hide(t)
        if (this.labelPinnedUntil <= performance.now()) this.hideChip(m)
        return
      }
      m.hoverRing.object.position.set(at.x, at.y + HOVER_RING_LIFT, at.z)
      m.hoverRing.show(t)
      if (!text) {
        this.hideChip(m)
        return
      }
      this.chipLive = { kind: 'terminal', ref: target.ref }
      const owner = parseTerminalRef(target.ref)?.componentId ?? null
      this.showChip(m, text, 'normal', at, HOLE_LABEL_Y, owner)
      return
    }
    m.hoverRing.hide(t)
    const text = this.objectChipText(target.id)
    if (!text) {
      this.hideChip(m)
      return
    }
    this.showChip(m, text, 'neutral', this.hoverPoint, HOLE_LABEL_Y, target.id)
  }

  /**
   * Hover-chip text for a hole: the host's holeLabelText (e.g. 'U1 · A5 ·
   * c25') when it returns a non-empty string, else the bare ref. Same chip,
   * same auto-shrink (hole-fx fits any string); a throwing host callback can
   * never break the hover pass.
   */
  private holeChipText(hole: HoleRef): string {
    const cb = this.callbacks.holeLabelText
    if (!cb) return hole
    try {
      const t = cb(hole)
      return typeof t === 'string' && t.length > 0 ? t : hole
    } catch {
      return hole
    }
  }

  /** Host text for an off-board terminal's chip (「PS1 正端 · 5.00 V」) — null = no chip. */
  private terminalChipText(ref: string): string | null {
    try {
      const t = this.callbacks.holeLabelText?.(ref)
      return typeof t === 'string' && t.length > 0 ? t : null
    } catch {
      return null
    }
  }

  /** Host text for a part body's neutral chip (「U1 · … · 點一下選取」) — null = no chip. */
  private objectChipText(id: string): string | null {
    try {
      const t = this.callbacks.objectLabelText?.(id)
      return typeof t === 'string' && t.length > 0 ? t : null
    } catch {
      return null
    }
  }

  /** Docked chrome: setDockedChrome, else (never told) non-zero view insets. */
  private isDocked(): boolean {
    return this.dockedChrome ?? this.hasInsets()
  }

  /**
   * The part a hole chip points at (its screen box is kept clear): the part
   * whose pin sits in the hole, else the part with a pin nearest the hole
   * within CHIP_PART_NEAR pitches (the LED beside an empty d-row hole).
   * Event-driven (chip re-aim) — a scan over the plugged holes.
   */
  private partNearHole(hole: HoleRef): string | null {
    const own = this.pinOwner.get(hole)
    if (own && this.components.has(own)) return own
    const h = parseHole(hole)
    if (!h) return null
    const p = holePosition(h)
    let best: string | null = null
    let bestD2 = CHIP_PART_NEAR * CHIP_PART_NEAR
    for (const [ref, id] of this.pinOwner) {
      if (!this.components.has(id)) continue
      const q = parseHole(ref)
      if (!q) continue
      const r = holePosition(q)
      const d2 = (r.x - p.x) * (r.x - p.x) + (r.z - p.z) * (r.z - p.z)
      if (d2 < bestD2) {
        bestD2 = d2
        best = id
      }
    }
    return best
  }

  /**
   * Show the hover chip with `text` for world point `anchor` (SC-12). Docked
   * chrome: the screen-space card (fixed 15 px font, wrapped to the free
   * area, placed clear of the floating chrome and of part `avoid`'s screen
   * box — placeChip, every frame it shows). Classic chrome: the world-sized
   * sprite `lift` units above the anchor, exactly as before.
   */
  private showChip(m: Mounted, text: string, tone: ChipTone, anchor: THREE.Vector3, lift: number, avoid: string | null, noBelow = false): void {
    if (!this.isDocked()) {
      m.screenChip.hide()
      m.holeLabel.setLocked(tone === 'locked')
      m.holeLabel.setText(text)
      m.holeLabel.object.position.set(anchor.x, anchor.y + lift, anchor.z)
      m.holeLabel.show()
      return
    }
    m.holeLabel.hide()
    this.chipAnchor.copy(anchor)
    this.chipNoBelow = noBelow
    const rec = avoid ? (this.components.get(avoid)?.built.object ?? this.wires.get(avoid)?.group) : undefined
    if (rec) {
      this.chipPartBox ??= new THREE.Box3()
      this.chipPartBox.setFromObject(rec)
      if (this.chipPartBox.isEmpty()) this.chipPartBox = null
    } else {
      this.chipPartBox = null
    }
    this.measureChipChrome(m)
    const chip = m.screenChip
    chip.setTone(tone)
    chip.setText(text)
    chip.show()
    this.placeChip(m)
  }

  /** Hide whichever hover chip shows. */
  private hideChip(m: Mounted): void {
    m.holeLabel.hide()
    m.screenChip.hide()
  }

  /** Is a hover chip showing? */
  private chipShown(m: Mounted): boolean {
    return m.holeLabel.object.visible || m.screenChip.visible
  }

  /** Swap the showing chip's text in place (live re-ask). */
  private setChipText(m: Mounted, text: string): void {
    if (m.screenChip.visible) m.screenChip.setText(text)
    else m.holeLabel.setText(text)
  }

  /** The floating chrome (and the canvas rect) the screen chip keeps clear of — on (re)aim, never per frame. */
  private measureChipChrome(m: Mounted): void {
    const r = m.renderer.domElement.getBoundingClientRect()
    this.canvasRect.left = r.left
    this.canvasRect.top = r.top
    this.canvasRect.width = Math.max(1, r.width)
    this.canvasRect.height = Math.max(1, r.height)
    this.chipAvoid.length = 0
    if (typeof document === 'undefined') return
    for (const el of document.querySelectorAll(CHIP_AVOID_SELECTOR)) {
      const b = el.getBoundingClientRect()
      if (b.width > 0 && b.height > 0) this.chipAvoid.push({ x0: b.left, y0: b.top, x1: b.right, y1: b.bottom })
    }
  }

  /**
   * Every frame the screen chip shows: follow its anchor (camera moves)
   * inside the free area — the canvas minus the view insets, minus
   * SCREEN_CHIP_EDGE_PX of air (so its max width is the free width − 32 px)
   * — clear of the floating chrome and of the pointed-at part when that part
   * is small on screen. Scalar math on scratch vectors; one style write
   * only when the chip moved.
   */
  private placeChip(m: Mounted): void {
    const chip = m.screenChip
    const cr = this.canvasRect
    const ins = this.viewInsets
    const edge = SCREEN_CHIP_EDGE_PX
    const x0 = cr.left + Math.min(ins.left, cr.width * 0.8) + edge
    const x1 = Math.max(x0 + 120, cr.left + cr.width - Math.min(ins.right, cr.width * 0.8) - edge)
    const y0 = cr.top + Math.min(ins.top, cr.height * 0.8) + edge / 2
    const y1 = Math.max(y0 + 40, cr.top + cr.height - Math.min(ins.bottom, cr.height * 0.8) - edge / 2)
    chip.setMaxWidth(x1 - x0)
    const { w, h } = chip.size()
    m.camera.updateMatrixWorld()
    const v = this.tmpVecB.copy(this.chipAnchor).project(m.camera)
    if (v.z > 1) {
      // the anchor went behind the camera (an orbit while the chip shows): park it off screen
      chip.moveTo(-10000, -10000)
      return
    }
    const ax = cr.left + ((v.x + 1) / 2) * cr.width
    const ay = cr.top + ((1 - v.y) / 2) * cr.height
    let part: ChipRect | null = null
    const box = this.chipPartBox
    if (box) {
      let px0 = Infinity
      let px1 = -Infinity
      let py0 = Infinity
      let py1 = -Infinity
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(m.camera)
        const sx = cr.left + ((v.x + 1) / 2) * cr.width
        const sy = cr.top + ((1 - v.y) / 2) * cr.height
        if (sx < px0) px0 = sx
        if (sx > px1) px1 = sx
        if (sy < py0) py0 = sy
        if (sy > py1) py1 = sy
      }
      if ((px1 - px0) * (py1 - py0) < CHIP_PART_AVOID_MAX * (x1 - x0) * (y1 - y0)) part = { x0: px0, y0: py0, x1: px1, y1: py1 }
    }
    const p = placeScreenChip(w, h, ax, ay, { x0, y0, x1, y1 }, this.chipAvoid, part, { noBelow: this.chipNoBelow })
    chip.moveTo(p.x, p.y)
  }

  /** Component / wire / instrument id of the first pickable hit (null = none). */
  private objectIdOfHits(hits: THREE.Intersection[]): string | null {
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object
      while (o) {
        const ref = o.userData.terminalRef
        if (typeof ref === 'string') return parseTerminalRef(ref)?.componentId ?? null
        const id = o.userData.componentId
        if (typeof id === 'string') return id
        o = o.parent
      }
    }
    return null
  }

  /** Report a hovered-object change through the optional onObjectHover. */
  private setHoverObject(id: string | null): void {
    if (id === this.lastHoverObject) return
    this.lastHoverObject = id
    this.callbacks.onObjectHover?.(id)
  }

  /**
   * Fingertip pass: the cursor floats toward the top of the screen from the
   * touched point and snaps to the candidate target — the snapped hole (not
   * the raw touch point) is what onHoleHover reports; a snapped terminal post
   * shows the ring on the post (terminals have no hover callback).
   */
  private processFingertip(m: Mounted): void {
    const target = this.pickFingertipTarget()
    if (!this.fingertipHasPoint) {
      m.fingertipGroup.visible = false
      this.hideChip(m)
      this.chipKey = ''
      if (this.lastHoverHole !== null) {
        this.lastHoverHole = null
        this.callbacks.onHoleHover?.(null)
      }
      return
    }
    let px = this.fingertipPoint.x
    let pz = this.fingertipPoint.z
    let py = 0.1
    let hole: HoleRef | null = null
    if (target?.kind === 'hole') {
      hole = target.hole
      const h = parseHole(hole)
      if (h) {
        const p = holePosition(h)
        px = p.x
        pz = p.z
      }
    } else if (target) {
      px = target.x
      pz = target.z
      py = TERMINAL_TOP_Y + 0.05 // ring sits on the post top
    }
    m.fingertipGroup.position.set(px, py, pz)
    m.fingertipGroup.visible = true
    // dim the cursor when it has nothing to snap to
    m.fingertipRingMat.opacity = target ? 0.95 : 0.45
    m.fingertipGlowMat.opacity = target ? 0.3 : 0.15
    m.fingertipCrossMat.opacity = target ? 0.9 : 0.5
    m.hoverRing.hide(m.clock.getElapsedTime())
    // the coordinate chip rides above the aim ring showing the snapped ref
    // (occluded holes read red + locked — the lift commit will be rejected);
    // docked chrome: a snapped terminal post gets its chip too, and the
    // screen chip never sits under the finger
    const key = hole ? `f:${hole}` : target ? `f:${target.kind === 'terminal' ? target.ref : ''}` : ''
    if (key !== this.chipKey) {
      this.chipKey = key
      this.chipLive = null
      this.chipTmp.set(px, py, pz)
      const termText = !hole && target?.kind === 'terminal' && this.isDocked() ? this.terminalChipText(target.ref) : null
      if (hole) {
        this.chipLive = { kind: 'hole', ref: hole }
        const tone: ChipTone = this.occluded.has(hole) ? 'locked' : 'normal'
        this.showChip(m, this.holeChipText(hole), tone, this.chipTmp, FINGERTIP_LABEL_Y, null, true)
      } else if (termText && target?.kind === 'terminal') {
        this.chipLive = { kind: 'terminal', ref: target.ref }
        this.showChip(m, termText, 'normal', this.chipTmp, FINGERTIP_LABEL_Y, null, true)
      } else {
        this.hideChip(m)
      }
    }
    m.container.style.cursor = ''
    if (hole !== this.lastHoverHole) {
      this.lastHoverHole = hole
      this.callbacks.onHoleHover?.(hole)
    }
  }

  // ------------------------------------------------- touch gestures & camera

  /** place/wire = touch aiming mode (fingertip cursor; one-finger aims, not orbits) */
  private isPlaceOrWireMode(): boolean {
    if (this.forceWireAim) return true
    if (this.explicitMode !== null) return this.explicitMode !== 'select'
    return this.ghost !== null || this.preview.from !== null
  }

  /** wire mode specifically — terminal posts are valid endpoints only here */
  private isWireAiming(): boolean {
    if (this.forceWireAim) return true
    if (this.explicitMode !== null) return this.explicitMode === 'wire'
    return this.ghost === null && this.preview.from !== null
  }

  /**
   * One-finger touch: orbit normally; while place/wire aiming is active it is
   * handed to the fingertip cursor instead (OrbitControls treats a null
   * touches.ONE as "no gesture"). Two-finger dolly/pan always works.
   */
  private updateTouchGestures(): void {
    const m = this.m
    if (!m) return
    m.controls.touches.ONE = this.isPlaceOrWireMode() ? null : THREE.TOUCH.ROTATE
  }

  // ------------------------------------------------ editing drags (select mode)
  //
  // GESTURE DECISION (documented per the task spec): in select mode a
  // one-finger / left-button drag that STARTS on an already-SELECTED part is
  // a MOVE gesture, never an orbit — selecting a part is the explicit "I want
  // to manipulate this" signal, and grabbing the selected thing should move
  // it (iOS drag-and-drop semantics); orbit stays available everywhere else
  // on the canvas, so nothing is lost. Touch and mouse behave identically.
  // OrbitControls is suspended at pointerdown (its pointermove handler checks
  // `enabled` per event, and its pointerup always releases the pointer, so a
  // mid-gesture disable is safe) and restored when the gesture ends.
  //
  // Desktop shift+drag on EMPTY board = marquee selection. The rectangle is a
  // screen-space overlay <div> (not an in-scene mesh) because (a) the hit
  // test is itself screen-space — "parts whose centers PROJECT inside" — so
  // the visual and the test can never disagree, (b) it costs zero GPU work
  // and no scene-graph churn, and (c) the scene already owns DOM (the
  // renderer canvas), so no new React plumbing is needed.

  /** Force-disable orbiting for the duration of an editing drag. */
  private suspendControls(m: Mounted, e: PointerEvent): void {
    if (!this.controlsSuspended) {
      this.controlsSuspended = true
      m.controls.enabled = false
    }
    try {
      m.renderer.domElement.setPointerCapture(e.pointerId)
    } catch {
      /* pointer already gone — the drag will just end on the next event */
    }
  }

  private restoreControls(): void {
    if (this.controlsSuspended && this.m) this.m.controls.enabled = true
    this.controlsSuspended = false
  }

  // ------------------------------------------------ wire end handles (SC-13)

  /** Drop the end handles (sprites share the module's handle material). */
  private clearWireHandles(m: Mounted): void {
    const h = this.wireHandles
    if (!h) return
    this.wireHandles = null
    m.overlayGroup.remove(h.group)
  }

  /**
   * Show the two end handles of the ONE selected wire (docked chrome,
   * select mode): round Tier-S grips at its ends, a constant size on screen
   * (sizeAttenuation off — no per-frame work), drawn over everything.
   * Rebuilt on selection / mode / layout changes only.
   */
  private syncWireHandles(): void {
    const m = this.m
    if (!m) return
    const id = this.selectedIds.length === 1 ? this.selectedIds[0] : null
    const rec = id ? this.wires.get(id) : undefined
    const show = !!rec && this.isDocked() && !this.isPlaceOrWireMode() && this.wireEndDrag === null
    if (!show || !rec) {
      this.clearWireHandles(m)
      return
    }
    const a = this.resolveEndpoint(rec.wire.from)
    const b = this.resolveEndpoint(rec.wire.to)
    const h = this.wireHandles
    if (h && h.wireId === rec.wire.id && a && b && h.ends[0].at.equals(a) && h.ends[1].at.equals(b)) return
    this.clearWireHandles(m)
    if (!a || !b) return
    const group = new THREE.Group()
    group.name = 'wire-end-handles'
    const px = this.lastPointerType === 'touch' ? WIRE_HANDLE_PX_TOUCH : WIRE_HANDLE_PX
    // sizeAttenuation off: scale = screen fraction × 2·tan(fov/2) → px / viewH
    const k = (px * 2 * Math.tan(THREE.MathUtils.degToRad(m.camera.fov / 2))) / Math.max(1, this.viewH)
    const ends: { end: 'from' | 'to'; sprite: THREE.Sprite; at: THREE.Vector3 }[] = []
    for (const [end, at] of [['from', a], ['to', b]] as const) {
      const sprite = new THREE.Sprite(wireHandleMaterial())
      sprite.position.set(at.x, at.y + 0.12, at.z)
      sprite.scale.set(k, k, 1)
      sprite.renderOrder = 11
      sprite.raycast = () => {}
      group.add(sprite)
      ends.push({ end, sprite, at })
    }
    m.overlayGroup.add(group)
    this.wireHandles = { wireId: rec.wire.id, group, ends }
  }

  /** The end handle under the pointer (screen distance — the grips are tiny targets), or null. */
  private pickWireHandle(m: Mounted, e: PointerEvent): 'from' | 'to' | null {
    const h = this.wireHandles
    if (!h) return null
    const rect = m.renderer.domElement.getBoundingClientRect()
    const grab = e.pointerType === 'touch' ? WIRE_HANDLE_GRAB_PX_TOUCH : WIRE_HANDLE_GRAB_PX
    let best: 'from' | 'to' | null = null
    let bestD = grab * grab
    m.camera.updateMatrixWorld()
    for (const end of h.ends) {
      const v = this.tmpVecB.copy(end.sprite.position).project(m.camera)
      if (v.z > 1) continue
      const dx = rect.left + ((v.x + 1) / 2) * rect.width - e.clientX
      const dy = rect.top + ((1 - v.y) / 2) * rect.height - e.clientY
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        best = end.end
      }
    }
    return best
  }

  /**
   * Pointerdown on an end handle: the mouse arms the drag at once (orbit
   * suspended); a finger has to hold still for LONG_PRESS_MS first, so a
   * one-finger orbit that happens to start on a grip stays an orbit.
   */
  private beginWireEndDrag(e: PointerEvent): boolean {
    const m = this.m
    if (!m || this.wireEndDrag || this.moveDrag || this.instDrag || this.marquee || this.isPlaceOrWireMode()) return false
    const touch = e.pointerType === 'touch'
    // the selected wire's grips; a finger may also long-press ANY wire's end
    // (on a phone, selecting a wire opens its sheet over the board)
    let pick: { wireId: string; end: 'from' | 'to'; fixed: THREE.Vector3 } | null = null
    const h = this.wireHandles
    const end = h ? this.pickWireHandle(m, e) : null
    const other = end && h ? h.ends.find((x) => x.end !== end) : undefined
    if (h && end && other) pick = { wireId: h.wireId, end, fixed: other.at.clone() }
    else if (touch && this.isDocked()) pick = this.pickWireEndNear(m, e)
    if (!pick) return false
    this.wireEndDrag = {
      wireId: pick.wireId,
      end: pick.end,
      fixed: pick.fixed,
      pointerId: e.pointerId,
      armed: !touch,
      started: false,
      target: null,
      valid: true,
      preview: null,
    }
    if (!touch) {
      this.armWireEndDrag(m, e)
      return true
    }
    this.cancelLongPress()
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null
      const d = this.wireEndDrag
      if (!d || !this.downInfo || !this.m) return
      d.armed = true
      this.armWireEndDrag(this.m, e)
    }, LONG_PRESS_MS)
    return true
  }

  /** The end drag owns the pointer: no orbit, aim like wire mode (chip + fingertip cursor). */
  private armWireEndDrag(m: Mounted, e: PointerEvent): void {
    this.suspendControls(m, e)
    this.forceWireAim = true
    this.updateTouchGestures()
    this.chipKey = STALE_CHIP_KEY
    this.pointerDirty = true
    // a finger: the moment the long-press arms the grip, the ring and the
    // chip sit on the END it grabbed (「導線 W7 · a20（U1 PA5 這一排）」) — lift
    // there to measure that point, drag to re-route it (the aim ring then
    // floats above the finger as in wire mode)
    if (e.pointerType === 'touch') this.showGrabbedEnd(m)
  }

  /** Touch end drag, armed but not moved: ring + chip on the grabbed end (no aim offset yet). */
  private showGrabbedEnd(m: Mounted): void {
    const d = this.wireEndDrag
    const ref = d ? this.wires.get(d.wireId)?.wire[d.end] : undefined
    const at = ref ? this.resolveEndpoint(ref) : null
    if (!ref || !at) {
      this.processFingertip(m)
      return
    }
    const h = parseHole(ref)
    const hole = h ? formatHole(h) : null
    m.fingertipGroup.position.set(at.x, hole ? 0.1 : TERMINAL_TOP_Y + 0.05, at.z)
    m.fingertipGroup.visible = true
    m.fingertipRingMat.opacity = 0.95
    m.fingertipGlowMat.opacity = 0.3
    m.fingertipCrossMat.opacity = 0.9
    m.hoverRing.hide(m.clock.getElapsedTime())
    this.chipKey = `grab:${ref}` // the first move's aim pass replaces it
    this.chipLive = hole ? { kind: 'hole', ref: hole } : { kind: 'terminal', ref }
    const text = hole ? this.holeChipText(hole) : this.terminalChipText(ref)
    this.chipTmp.copy(at)
    if (text) this.showChip(m, text, 'normal', this.chipTmp, FINGERTIP_LABEL_Y, null, true)
    else this.hideChip(m)
  }

  /**
   * Touch: the wire end under the finger (any wire) — the end in the hole the
   * finger snaps to, or, off the board, an end on a terminal post within the
   * grip radius. Never a neighbouring hole's wire end: at a phone's zoom the
   * holes sit ~10 px apart.
   */
  private pickWireEndNear(m: Mounted, e: PointerEvent): { wireId: string; end: 'from' | 'to'; fixed: THREE.Vector3 } | null {
    this.raycaster.setFromCamera(this.pointerNdc, m.camera)
    const hole = this.pickHole(HOLE_SNAP_DIST_TOUCH)
    if (hole) {
      const id = this.pinOwner.get(hole)
      const rec = id ? this.wires.get(id) : undefined
      if (!rec) return null
      const end = parseHole(rec.wire.from) && formatHole(parseHole(rec.wire.from)!) === hole ? 'from' : 'to'
      const fixed = this.resolveEndpoint(rec.wire[end === 'from' ? 'to' : 'from'])
      return fixed ? { wireId: rec.wire.id, end, fixed } : null
    }
    const rect = m.renderer.domElement.getBoundingClientRect()
    let best: { wireId: string; end: 'from' | 'to'; fixed: THREE.Vector3 } | null = null
    let bestD = WIRE_HANDLE_GRAB_PX_TOUCH * WIRE_HANDLE_GRAB_PX_TOUCH
    m.camera.updateMatrixWorld()
    for (const rec of this.wires.values()) {
      const a = this.resolveEndpoint(rec.wire.from)
      const b = this.resolveEndpoint(rec.wire.to)
      if (!a || !b) continue
      for (const [end, at, fixed] of [['from', a, b], ['to', b, a]] as const) {
        if (parseHole(rec.wire[end])) continue // hole ends: the snapped hole above decides
        const v = this.tmpVecB.copy(at).project(m.camera)
        if (v.z > 1) continue
        const dx = rect.left + ((v.x + 1) / 2) * rect.width - e.clientX
        const dy = rect.top + ((1 - v.y) / 2) * rect.height - e.clientY
        const d = dx * dx + dy * dy
        if (d < bestD) {
          bestD = d
          best = { wireId: rec.wire.id, end, fixed }
        }
      }
    }
    return best
  }

  /** Per move of a running end drag: the aimed target, its validity and the preview route. */
  private updateWireEndDrag(m: Mounted): void {
    const d = this.wireEndDrag
    if (!d) return
    const touch = this.lastPointerType === 'touch'
    // the aim pass of wire mode drives the chip / ring / fingertip cursor
    // directly (the hover pass is gated off while OrbitControls holds the
    // pointer it saw first)
    let target: AimTarget | null
    if (touch) {
      this.processFingertip(m)
      const f = this.pickFingertipTarget()
      target = f?.kind === 'hole' ? { kind: 'hole', hole: f.hole, occluded: this.occluded.has(f.hole) } : f ? { kind: 'terminal', ref: f.ref } : null
    } else {
      target = this.resolveAimTarget(m, false)
      this.applyHoverChip(m, m.clock.getElapsedTime(), target, true, this.isDocked())
    }
    d.target = target
    const ref = target ? (target.kind === 'hole' ? target.hole : target.ref) : null
    let valid = !!target && !(target.kind === 'hole' && target.occluded)
    if (valid && ref) {
      try {
        valid = this.callbacks.onWireEndPreview ? this.callbacks.onWireEndPreview(d.wireId, d.end, ref) !== false : true
      } catch {
        valid = true
      }
    }
    d.valid = valid
    // the preview route: from the fixed end to the target (or the pointer's plane point)
    let to: THREE.Vector3 | null = ref ? this.resolveEndpoint(ref) : null
    if (!to) {
      this.raycaster.setFromCamera(this.pointerNdc, m.camera)
      if (touch && this.fingertipHasPoint) to = this.fingertipPoint.clone()
      else if (this.rayToPlane(this.tmpVecA)) to = this.tmpVecA.clone()
    }
    if (d.preview) {
      m.overlayGroup.remove(d.preview)
      ;(d.preview.geometry as THREE.BufferGeometry).dispose()
      d.preview = null
    }
    if (to && to.distanceToSquared(d.fixed) > 1e-6) {
      const mesh = new THREE.Mesh(previewWireGeometry(d.fixed, to, PREVIEW_RADIUS), valid ? m.previewMat : wireEndInvalidMaterial())
      mesh.renderOrder = 3
      m.overlayGroup.add(mesh)
      d.preview = mesh
    }
    // the dragged grip follows the target
    const grip = this.wireHandles?.ends.find((x) => x.end === d.end)
    if (grip && to) grip.sprite.position.set(to.x, to.y + 0.12, to.z)
  }

  /** End the end drag (drop or abandon): preview gone, aiming back to select, the handles re-synced. */
  private dropWireEndDrag(): void {
    const d = this.wireEndDrag
    if (!d) return
    this.wireEndDrag = null
    const m = this.m
    if (m && d.preview) {
      m.overlayGroup.remove(d.preview)
      ;(d.preview.geometry as THREE.BufferGeometry).dispose()
    }
    if (this.forceWireAim) {
      this.forceWireAim = false
      this.updateTouchGestures()
      if (m) {
        this.hideFingertip()
        m.hoverRing.hide(m.clock.getElapsedTime())
        this.hideChip(m)
      }
      this.chipKey = STALE_CHIP_KEY
      this.pointerDirty = true
    }
    // snap the grips back (a committed move re-syncs them from the new layout)
    if (m) this.clearWireHandles(m)
    this.syncWireHandles()
  }

  /**
   * Pointerdown in select mode: arm a move-drag (selected part), an
   * instrument bench drag (selected off-board unit) or a shift+drag marquee.
   * Armed drags only START once the pointer travels DRAG_START_PX — a tap
   * stays a tap.
   */
  private maybeBeginEditDrag(e: PointerEvent, picked: string | null): void {
    const m = this.m
    if (!m || this.moveDrag || this.instDrag || this.marquee) return
    if (this.isPlaceOrWireMode()) return

    // shift+drag on empty board (desktop mouse) = marquee rectangle
    if (picked === null && e.shiftKey && e.pointerType === 'mouse') {
      this.raycaster.setFromCamera(this.pointerNdc, m.camera)
      if (this.pickPaddle(m)) return
      this.hitBuf.length = 0
      if (this.raycaster.intersectObjects(m.terminalsGroup.children, false, this.hitBuf).length > 0)
        return
      this.marquee = {
        startX: e.clientX,
        startY: e.clientY,
        curX: e.clientX,
        curY: e.clientY,
        el: null,
        started: false,
      }
      this.suspendControls(m, e)
      return
    }

    if (picked === null || !this.selectedIds.includes(picked)) return
    const rec = this.components.get(picked)
    if (!rec) return // a selected WIRE was grabbed — wires stay put; orbit instead
    this.raycaster.setFromCamera(this.pointerNdc, m.camera)
    if (!this.rayToPlane(this.tmpVecA)) return

    // selected off-board instrument → bench drag (0.5-grid, validity tint)
    if (rec.entry.placement === 'offboard') {
      const origin = rec.comp.pos ?? offboardBodyPosition(rec.slot, undefined, rec.entry.offboard)
      this.instDrag = {
        id: picked,
        origin: { x: origin.x, z: origin.z },
        grab: this.tmpVecA.clone(),
        started: false,
        pos: { x: origin.x, z: origin.z },
        valid: true,
        postBase: rec.posts.map((p) => p.position.clone()),
        tint: null,
        tintMat: null,
        tintBase: new THREE.Vector3(),
        hiddenSel: [],
      }
      this.suspendControls(m, e)
      return
    }

    // selected on-board part(s) → move gesture. The whole selected group of
    // on-board components moves together (wires always stay put).
    const ids = this.selectedIds.filter((id) => {
      const r = this.components.get(id)
      return !!r && r.entry.placement !== 'offboard'
    })
    if (ids.length === 0) return

    // anchor form: exactly ONE moved part and it is a dip/footprint package
    // (free re-anchor — may hop rows/board-rows); everything else translates
    // by whole columns + strip-row-lattice steps (delta form)
    let anchor: MoveDrag['anchor'] = null
    if (ids.length === 1) {
      const only = this.components.get(ids[0])
      if (
        only &&
        (only.entry.placement === 'dip' || only.entry.placement === 'footprint') &&
        only.comp.at
      ) {
        const ah = parseHole(only.comp.at)
        if (ah) {
          const p = holePosition(ah)
          anchor = { pos: { x: p.x, z: p.z } }
        }
      }
    }
    let ref: MoveDrag['ref'] = null
    if (!anchor) {
      const config = boardConfigOf(this.layout)
      refSearch: for (const id of ids) {
        const r = this.components.get(id)
        if (!r) continue
        const holes = componentPinHoles(r.comp, r.entry, config)
        if (!holes) continue
        for (const h of holes) {
          if (h && h.kind === 'strip') {
            const p = holePosition(h)
            ref = {
              col: h.col,
              rowIdx: STRIP_ROWS.indexOf(h.row),
              boardRow: h.boardRow ?? 0,
              x: p.x,
              z: p.z,
            }
            break refSearch
          }
        }
      }
    }
    this.moveDrag = {
      ids,
      grab: this.tmpVecA.clone(),
      anchor,
      ref,
      started: false,
      target: null,
      valid: false,
      holo: null,
      holoVariant: 'valid',
    }
    this.suspendControls(m, e)
  }

  /** Per-pointermove drive of whichever editing drag is armed/running. */
  private updateEditDrags(e: PointerEvent, drift: number): void {
    const m = this.m
    if (!m) return
    const startPx = e.pointerType === 'touch' ? DRAG_START_PX_TOUCH : DRAG_START_PX
    const we = this.wireEndDrag
    if (we) {
      // touch: a move before the long-press armed the handle is an orbit
      if (!we.armed) {
        if (this.longPressTimer === null) this.dropWireEndDrag()
        return
      }
      if (!we.started && drift > startPx) {
        we.started = true
        this.cancelLongPress()
      }
      if (we.started) this.updateWireEndDrag(m)
      return
    }
    if (this.marquee) {
      this.marquee.curX = e.clientX
      this.marquee.curY = e.clientY
      if (!this.marquee.started && drift > startPx) {
        this.marquee.started = true
        this.cancelLongPress()
      }
      if (this.marquee.started) this.updateMarqueeEl()
      return
    }
    if (this.moveDrag) {
      if (!this.moveDrag.started && drift > startPx) {
        this.moveDrag.started = true
        this.cancelLongPress()
        this.buildMoveHolo(m)
      }
      if (this.moveDrag.started) this.updateMoveDrag(m)
      return
    }
    if (this.instDrag) {
      if (!this.instDrag.started && drift > startPx) {
        this.instDrag.started = true
        this.cancelLongPress()
        this.buildInstTint(m)
      }
      if (this.instDrag.started) this.updateInstDrag(m)
    }
  }

  /** Group hologram of the moved part(s) — geometry shared with the live meshes. */
  private buildMoveHolo(m: Mounted): void {
    const d = this.moveDrag
    if (!d || d.holo) return
    const group = new THREE.Group()
    group.name = 'move-drag-holo'
    for (const id of d.ids) {
      const rec = this.components.get(id)
      if (rec) group.add(applyHologram(rec.built.object, 'valid'))
    }
    d.holoVariant = 'valid'
    m.overlayGroup.add(group)
    d.holo = group
  }

  /** Swap the move hologram's cyan/red tint (cached materials — no compiles). */
  private setMoveHoloVariant(d: MoveDrag, variant: HologramVariant): void {
    if (!d.holo || d.holoVariant === variant) return
    d.holoVariant = variant
    const mat = makeHologramMaterial(variant)
    d.holo.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) mesh.material = mat
    })
  }

  /**
   * Track the move-drag: snap the candidate target on the hole lattice,
   * re-validate through onMovePreview only when the SNAPPED target changes,
   * and float the group hologram at the implied plan offset.
   */
  private updateMoveDrag(m: Mounted): void {
    const d = this.moveDrag
    if (!d) return
    this.raycaster.setFromCamera(this.pointerNdc, m.camera)
    if (!this.rayToPlane(this.tmpVecA)) return
    const dx = this.tmpVecA.x - d.grab.x
    const dz = this.tmpVecA.z - d.grab.z

    let target: SceneMoveTarget | null = null
    let planDx = dx
    let planDz = dz
    if (d.anchor) {
      // single package: re-anchor pin 1 to the nearest hole under the drag
      const hole = this.holeIndex.nearest(
        d.anchor.pos.x + dx,
        d.anchor.pos.z + dz,
        MOVE_ANCHOR_SNAP,
      )
      if (hole) {
        const h = parseHole(hole)
        if (h) {
          const p = holePosition(h)
          target = { anchor: hole }
          planDx = p.x - d.anchor.pos.x
          planDz = p.z - d.anchor.pos.z
        }
      }
      // no hole in range: the hologram tracks the raw drag, tinted invalid
    } else {
      // group / leads: whole-column + strip-row-lattice translation, snapped
      // against the reference pin (rail-only selections translate columns)
      const dCol = Math.round(dx)
      let dRowLattice = 0
      planDx = dCol
      planDz = 0
      if (d.ref) {
        const rowOffset = d.ref.boardRow * BOARD_ROW_PITCH
        const targetZ = d.ref.z + dz
        let best = d.ref.rowIdx
        let bestErr = Infinity
        for (let i = 0; i < STRIP_ROWS.length; i++) {
          const err = Math.abs(ROW_Z[STRIP_ROWS[i]] + rowOffset - targetZ)
          if (err < bestErr) {
            bestErr = err
            best = i
          }
        }
        dRowLattice = best - d.ref.rowIdx
        planDz = ROW_Z[STRIP_ROWS[best]] - ROW_Z[STRIP_ROWS[d.ref.rowIdx]]
      }
      target = { dCol, dRowLattice }
    }

    const targetKey = JSON.stringify(target)
    if (targetKey !== JSON.stringify(d.target)) {
      d.target = target
      d.valid =
        target === null
          ? false
          : 'dCol' in target && target.dCol === 0 && target.dRowLattice === 0
            ? true // resting at the origin — dropping is a no-op, not an error
            : (this.callbacks.onMovePreview?.(d.ids, target) ?? true)
      this.setMoveHoloVariant(d, d.valid ? 'valid' : 'invalid')
    }
    d.holo?.position.set(planDx, 0, planDz)
  }

  /** Validity tint box over a dragged instrument's enclosure. */
  private buildInstTint(m: Mounted): void {
    const d = this.instDrag
    if (!d || d.tint) return
    const rec = this.components.get(d.id)
    if (!rec) return
    // the part's own footprint (CatalogEntry.offboard): a wide driver module
    // tints its whole body + terminal row, not the legacy 6.5 × 4.5 box
    const rect = offboardBodyRect(rec.slot, rec.comp.pos, rec.entry.offboard)
    const mat = new THREE.MeshBasicMaterial({
      color: DRAG_TINT_VALID,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(m.selBoxGeo, mat)
    const height = 4.2 // covers the ~4-unit enclosure + posts
    d.tintBase.set((rect.minX + rect.maxX) / 2, height / 2 - 0.1, (rect.minZ + rect.maxZ) / 2)
    mesh.position.copy(d.tintBase)
    mesh.scale.set(rect.maxX - rect.minX + 0.4, height, rect.maxZ - rect.minZ + 0.4)
    mesh.renderOrder = 2
    m.overlayGroup.add(mesh)
    d.tint = mesh
    d.tintMat = mat
    // the unit's selection box (centred on its mesh, so inside its body rect —
    // no other part's box can be: bodies never overlap) would stay behind at
    // the origin while the unit slides; the tint box replaces it for the drag
    for (const box of this.selectionBoxes) {
      const p = box.position
      if (box.visible && p.x > rect.minX && p.x < rect.maxX && p.z > rect.minZ && p.z < rect.maxZ) {
        box.visible = false
        d.hiddenSel.push(box)
      }
    }
  }

  /**
   * Track the instrument drag: snap the bench anchor to the 0.5 grid, ask the
   * host for validity, slide the real unit + posts by the offset (wires lag
   * until the commit replans them) and tint the overlay box.
   */
  private updateInstDrag(m: Mounted): void {
    const d = this.instDrag
    if (!d) return
    this.raycaster.setFromCamera(this.pointerNdc, m.camera)
    if (!this.rayToPlane(this.tmpVecA)) return
    const snap = (v: number) => Math.round(v / INSTRUMENT_GRID) * INSTRUMENT_GRID
    const x = snap(d.origin.x + this.tmpVecA.x - d.grab.x)
    const z = snap(d.origin.z + this.tmpVecA.z - d.grab.z)
    if (x === d.pos.x && z === d.pos.z) return
    d.pos = { x, z }
    d.valid = this.callbacks.onInstrumentMovePreview?.(d.id, d.pos) ?? true
    d.tintMat?.color.setHex(d.valid ? DRAG_TINT_VALID : DRAG_TINT_INVALID)
    const ox = x - d.origin.x
    const oz = z - d.origin.z
    const rec = this.components.get(d.id)
    if (rec) {
      rec.built.object.position.set(ox, 0, oz)
      rec.built.object.updateMatrix() // frozen (B2) — commit the slide
      for (let i = 0; i < rec.posts.length && i < d.postBase.length; i++) {
        rec.posts[i].position.set(d.postBase[i].x + ox, d.postBase[i].y, d.postBase[i].z + oz)
        rec.posts[i].updateMatrix()
      }
    }
    d.tint?.position.set(d.tintBase.x + ox, d.tintBase.y, d.tintBase.z + oz)
    m.renderer.shadowMap.needsUpdate = true // the unit's casters moved
  }

  /** Restore the dragged instrument's real meshes to their record positions. */
  private resetInstDragVisuals(m: Mounted, d: InstrumentDrag): void {
    const rec = this.components.get(d.id)
    if (rec) {
      rec.built.object.position.set(0, 0, 0)
      rec.built.object.updateMatrix() // frozen (B2)
      for (let i = 0; i < rec.posts.length && i < d.postBase.length; i++) {
        rec.posts[i].position.copy(d.postBase[i])
        rec.posts[i].updateMatrix()
      }
    }
    if (d.tint) {
      m.overlayGroup.remove(d.tint)
      d.tintMat?.dispose()
      d.tint = null
      d.tintMat = null
    }
    for (const box of d.hiddenSel) box.visible = true
    d.hiddenSel.length = 0
    m.renderer.shadowMap.needsUpdate = true
    // Studio: the unit's REAL meshes were slid around during the drag — make
    // sure the still rebuilds even when the drop was cancelled (a committed
    // drop reroutes the layout and re-invalidates via syncLayout anyway)
    this.modes.invalidate()
  }

  /** Screen-space marquee rectangle (lazy overlay div, fixed positioning). */
  private updateMarqueeEl(): void {
    const mq = this.marquee
    if (!mq || typeof document === 'undefined') return
    if (!mq.el) {
      const el = document.createElement('div')
      el.style.position = 'fixed'
      el.style.border = '1px solid rgba(10,132,255,0.95)'
      el.style.background = 'rgba(10,132,255,0.14)'
      el.style.borderRadius = '3px'
      el.style.pointerEvents = 'none'
      el.style.zIndex = '5'
      document.body.appendChild(el)
      mq.el = el
    }
    mq.el.style.left = `${Math.min(mq.startX, mq.curX)}px`
    mq.el.style.top = `${Math.min(mq.startY, mq.curY)}px`
    mq.el.style.width = `${Math.abs(mq.curX - mq.startX)}px`
    mq.el.style.height = `${Math.abs(mq.curY - mq.startY)}px`
  }

  /** Components + wires whose screen-projected centers fall inside the marquee. */
  private computeMarqueeIds(m: Mounted, mq: MarqueeDrag): string[] {
    const rect = m.renderer.domElement.getBoundingClientRect()
    const x0 = Math.min(mq.startX, mq.curX)
    const x1 = Math.max(mq.startX, mq.curX)
    const y0 = Math.min(mq.startY, mq.curY)
    const y1 = Math.max(mq.startY, mq.curY)
    const ids: string[] = []
    const box = new THREE.Box3()
    const center = new THREE.Vector3()
    m.camera.updateMatrixWorld()
    const test = (id: string, obj: THREE.Object3D): void => {
      box.setFromObject(obj)
      if (box.isEmpty()) return
      box.getCenter(center).project(m.camera)
      if (center.z > 1) return // behind the camera
      const sx = rect.left + ((center.x + 1) / 2) * rect.width
      const sy = rect.top + ((1 - center.y) / 2) * rect.height
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ids.push(id)
    }
    for (const [id, rec] of this.components) test(id, rec.built.object)
    for (const [id, rec] of this.wires) test(id, rec.group)
    return ids
  }

  /**
   * Pointerup lands an editing drag. Returns true when a STARTED drag
   * consumed the whole gesture (the caller suppresses the tap); a merely
   * armed drag cleans up silently and lets the tap proceed.
   */
  private finishEditDrags(e: PointerEvent): boolean {
    const m = this.m
    let consumed = false
    if (this.wireEndDrag) {
      const d = this.wireEndDrag
      if (d.started) {
        consumed = true
        // the drop: the host re-routes (one undo step) or says why not
        const ref = d.target ? (d.target.kind === 'hole' ? d.target.hole : d.target.ref) : null
        this.dropWireEndDrag()
        this.callbacks.onWireEndMove?.(d.wireId, d.end, ref)
      } else {
        // a touch long-press that armed the grip but never moved: the
        // long-press itself (the wire's action sheet / the probe sheet)
        consumed = d.armed && d.pointerId === e.pointerId && e.pointerType === 'touch'
        this.dropWireEndDrag()
        // …on the wire's END: measure that point (the probe sheet), like any hole
        const w = this.wires.get(d.wireId)?.wire
        const ref = w ? w[d.end] : null
        if (consumed) this.touchLongPress(d.wireId, ref ? (parseHole(ref) ? { hole: ref } : { terminal: ref }) : undefined)
      }
    } else if (this.marquee) {
      const mq = this.marquee
      this.marquee = null
      if (mq.started && m) {
        mq.curX = e.clientX
        mq.curY = e.clientY
        this.callbacks.onMarqueeSelect?.(this.computeMarqueeIds(m, mq))
        consumed = true
      }
      mq.el?.remove()
    } else if (this.moveDrag) {
      const d = this.moveDrag
      this.moveDrag = null
      if (d.started) {
        consumed = true
        if (d.valid && d.target) {
          const noop = 'dCol' in d.target && d.target.dCol === 0 && d.target.dRowLattice === 0
          if (!noop) this.callbacks.onMoveCommit?.(d.ids, d.target)
        }
      }
      if (d.holo && m) m.overlayGroup.remove(d.holo) // clones share geometry — nothing to free
    } else if (this.instDrag) {
      const d = this.instDrag
      this.instDrag = null
      if (m) this.resetInstDragVisuals(m, d)
      if (d.started) {
        consumed = true
        if (d.valid && (d.pos.x !== d.origin.x || d.pos.z !== d.origin.z)) {
          this.callbacks.onInstrumentMoveCommit?.(d.id, d.pos)
        }
      }
    }
    this.restoreControls()
    return consumed
  }

  /** Abandon any editing drag (pointer cancel/leave, dispose). */
  private cancelEditDrags(): void {
    const m = this.m
    if (this.wireEndDrag) this.dropWireEndDrag()
    if (this.marquee) {
      this.marquee.el?.remove()
      this.marquee = null
    }
    if (this.moveDrag) {
      if (m && this.moveDrag.holo) m.overlayGroup.remove(this.moveDrag.holo)
      this.moveDrag = null
    }
    if (this.instDrag) {
      if (m) this.resetInstDragVisuals(m, this.instDrag)
      this.instDrag = null
    }
    this.restoreControls()
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer)
      this.longPressTimer = null
    }
  }

  private startLongPress(id: string | null): void {
    this.cancelLongPress()
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null
      if (!this.downInfo) return // already released
      this.tapSuppressed = true // swallow the matching pointerup tap
      this.touchLongPress(id)
    }, LONG_PRESS_MS)
  }

  /** Touch long-press on a "+" paddle → remove a board from that edge. */
  private startPaddleLongPress(dir: GridGrowDirection): void {
    this.cancelLongPress()
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null
      if (!this.downInfo) return // already released
      this.tapSuppressed = true // the matching pointerup must not also grow
      this.pendingShrinkDir = dir
      this.callbacks.onShrinkGrid?.(dir)
    }, LONG_PRESS_MS)
  }

  private hideFingertip(): void {
    const m = this.m
    if (!m) return
    m.fingertipGroup.visible = false
    if (this.lastPointerType === 'touch') {
      this.hideChip(m)
      this.chipKey = ''
    }
  }

  /** Keep the coordinate chip on a just-clicked hole for ~1.2s (desktop). */
  private pinHoleLabel(m: Mounted, holeRef: HoleRef): void {
    const h = parseHole(holeRef)
    if (!h) return
    const p = holePosition(h)
    const covered = this.occluded.has(holeRef)
    // red + padlock only where the hole is truly unavailable (place / wire);
    // the classic chip keeps its padlock on any covered hole
    const tone: ChipTone = covered && (this.isPlaceOrWireMode() || !this.isDocked()) ? 'locked' : 'normal'
    this.chipTmp.set(p.x, 0, p.z)
    this.chipLive = { kind: 'hole', ref: holeRef }
    this.chipKey = PINNED_CHIP_KEY // the next hover pass re-evaluates
    this.showChip(m, this.holeChipText(holeRef), tone, this.chipTmp, HOLE_LABEL_Y, covered ? null : this.partNearHole(holeRef))
    this.labelPinnedUntil = performance.now() + LABEL_PIN_MS
  }

  // ------------------------------------------------------------ grow paddles

  /** Float one "+" paddle just past each edge of the 2-D grid. */
  private positionPaddles(m: Mounted): void {
    const ext = boardExtents(m.board.config)
    const cx = (ext.minX + ext.maxX) / 2
    const cz = (ext.minZ + ext.maxZ) / 2
    const off = PADDLE_GAP + PADDLE_SIZE / 2
    for (const p of m.paddles) {
      switch (p.dir) {
        case 'right':
          p.group.position.set(ext.maxX + off, PADDLE_Y, cz)
          break
        case 'left':
          p.group.position.set(ext.minX - off, PADDLE_Y, cz)
          break
        case 'up':
          p.group.position.set(cx, PADDLE_Y, ext.minZ - off)
          break
        case 'down':
          p.group.position.set(cx, PADDLE_Y, ext.maxZ + off)
          break
      }
    }
  }

  /** Docked chrome present (setViewInsets non-zero)? Allocation-free. */
  private hasInsets(): boolean {
    const i = this.viewInsets
    return i.left !== 0 || i.right !== 0 || i.top !== 0 || i.bottom !== 0
  }

  /**
   * The grid edge whose "+" paddle the plan point (x, z) is near: within
   * about two hole pitches inside the edge out to just past the paddle
   * plate, along the edge's span (null = none). Scalar math.
   */
  private nearPaddleEdge(m: Mounted, x: number, z: number): GridGrowDirection | null {
    const ext = boardExtents(m.board.config)
    const inside = 2.2
    const outside = PADDLE_GAP + PADDLE_SIZE + 1.2
    let best: GridGrowDirection | null = null
    let bestD = Infinity
    const consider = (dir: GridGrowDirection, d: number, along: number, lo: number, hi: number) => {
      if (d < -inside || d > outside || along < lo - inside || along > hi + inside) return
      const ad = Math.abs(d)
      if (ad < bestD) {
        bestD = ad
        best = dir
      }
    }
    consider('right', x - ext.maxX, z, ext.minZ, ext.maxZ)
    consider('left', ext.minX - x, z, ext.minZ, ext.maxZ)
    consider('up', ext.minZ - z, x, ext.minX, ext.maxX)
    consider('down', z - ext.maxZ, x, ext.minX, ext.maxX)
    return best
  }

  /** Host text for a paddle's hover chip (null = no chip; a throwing host never breaks hover). */
  private paddleLabelText(dir: GridGrowDirection, removing: boolean): string | null {
    try {
      const t = this.callbacks.growPaddleLabel?.(dir, removing)
      return typeof t === 'string' && t.length > 0 ? t : null
    } catch {
      return null
    }
  }

  /**
   * Docked chrome: does paddle `p`'s plate project onto chrome — a docked
   * panel / the tray (the insets) or the status-capsule band along the top?
   * Two project() calls on scratch vectors; no allocations.
   */
  private paddleUnderChrome(m: Mounted, p: PaddleRecord): boolean {
    const ins = this.viewInsets
    const w = this.viewW
    const h = this.viewH
    const half = PADDLE_SIZE / 2
    for (const s of [-1, 1]) {
      this.tmpVecC.copy(p.group.position)
      this.tmpVecC.x += s * half
      this.tmpVecC.y += s * half
      this.tmpVecC.project(m.camera)
      if (this.tmpVecC.z > 1) return true
      const sx = ((this.tmpVecC.x + 1) / 2) * w
      const sy = ((1 - this.tmpVecC.y) / 2) * h
      if (sx < ins.left || sx > w - ins.right || sy > h - ins.bottom || sy < Math.max(ins.top, FIT_RESERVE_TOP_PX)) {
        return true
      }
    }
    return false
  }

  /** Can the "−" affordance shrink this paddle's edge right now? (right/down
   *  only — the store shrink drops the rightmost module / deepest row.) */
  private paddleRemovable(m: Mounted, dir: GridGrowDirection): boolean {
    const config = m.board.config
    if (dir === 'right') return config.count > 1
    if (dir === 'down') return (config.rows ?? 1) > 1
    return false
  }

  /**
   * Per-frame paddle state: visible only in select mode while the sim is
   * stopped and that paddle's axis can still grow (modules for left/right,
   * board-rows for up/down); gentle idle glass pulse; hover highlight eased
   * with a tiny scale spring. Hovering a paddle (desktop) reveals its quiet
   * "−" removal chip beneath when the axis has something to remove — eased
   * scale + opacity, warm-red tinted only while the chip itself is hovered.
   * Number writes only.
   */
  private updatePaddles(m: Mounted, t: number): void {
    // PERF: boardConfigOf allocates a fresh object per call — this runs every
    // frame, so read the built board's config instead (syncLayout rebuilds
    // the board whenever the layout's rig differs, so they always agree here)
    const config = m.board.config
    // docked chrome (SC-8 / SC-16): with a mouse a paddle shows only at the
    // edge the pointer is near (or while hovered); with a finger (no hover)
    // only while a part is armed for placement or the parts library is open
    // — never floating over the circuit otherwise — and in both cases never
    // over a panel, the tray or the capsule. The classic chrome: the
    // always-on paddles of select mode, untouched.
    const gated = this.isDocked()
    const coarse = gated && (this.coarseDevice || this.lastPointerType === 'touch')
    const placing = this.explicitMode !== null ? this.explicitMode === 'place' : this.ghost !== null
    const baseVisible =
      (coarse ? (placing && !this.forceWireAim) || (this.partsBrowsing && !this.isPlaceOrWireMode()) : !this.isPlaceOrWireMode()) &&
      this.telemetry === null &&
      this.moveDrag === null
    const pulse = m.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2.1)
    let anyHover = false
    for (const p of m.paddles) {
      const capped =
        p.dir === 'right' || p.dir === 'left'
          ? config.count >= MAX_BOARD_COUNT
          : (config.rows ?? 1) >= MAX_BOARD_ROWS
      const visible =
        baseVisible &&
        !capped &&
        (!gated ||
          (coarse
            ? !this.paddleUnderChrome(m, p)
            : (this.paddleNear === p.dir || this.paddleHover === p.dir) && this.pointerInside && !this.paddleUnderChrome(m, p)))
      p.group.visible = visible
      if (!visible) {
        if (this.paddleHover === p.dir) this.paddleHover = null
        if (this.paddleMinusHover === p.dir) this.paddleMinusHover = null
        p.minusReveal = 0
        if (p.minus) p.minus.visible = false
        continue
      }
      const minusHover = this.paddleMinusHover === p.dir
      const hover = this.paddleHover === p.dir || minusHover
      anyHover ||= hover
      p.mat.opacity = hover ? 0.55 : 0.3 + 0.07 * pulse
      p.mat.emissiveIntensity = hover ? 0.85 : 0.28 + 0.2 * pulse
      p.glyphMat.opacity = hover ? 1 : 0.72 + 0.18 * pulse
      const target = hover && !m.reduced ? 1.07 : 1
      const s = p.group.scale.x
      p.group.scale.setScalar(s + (target - s) * 0.25)

      // "−" chip reveal (progressive enhancement — only hover can reach it,
      // so touch never sees a dangling chip; long-press covers touch)
      if (p.minus && p.minusMat && p.minusGlyphMat) {
        const revealTarget = hover && this.paddleRemovable(m, p.dir) ? 1 : 0
        p.minusReveal = m.reduced
          ? revealTarget
          : p.minusReveal + (revealTarget - p.minusReveal) * 0.22
        if (p.minusReveal < 0.02) {
          p.minusReveal = revealTarget === 0 ? 0 : p.minusReveal
          p.minus.visible = p.minusReveal > 0
        } else {
          p.minus.visible = true
        }
        if (p.minus.visible) {
          const r = p.minusReveal
          p.minus.scale.setScalar(PADDLE_MINUS_SCALE * (0.7 + 0.3 * r))
          p.minus.position.y = -PADDLE_MINUS_DROP * (0.85 + 0.15 * r)
          p.minusMat.opacity = (minusHover ? 0.5 : 0.26) * r
          p.minusMat.emissiveIntensity = minusHover ? 0.6 : 0.18
          p.minusMat.emissive.setHex(minusHover ? 0xff453a : 0x8a93a3)
          p.minusGlyphMat.opacity = (minusHover ? 1 : 0.8) * r
        }
      }
    }
    if (!anyHover && !baseVisible) {
      this.paddleHover = null
      this.paddleMinusHover = null
    }
  }

  /** The visible paddle plate (or its revealed "−" chip) under the ray. */
  private pickPaddle(m: Mounted): { rec: PaddleRecord; minus: boolean } | null {
    for (const p of m.paddles) {
      if (!p.group.visible) continue
      // the revealed chip first — it sits below the + plate, never occluded
      if (p.minusPlate && p.minus?.visible && p.minusReveal > 0.5) {
        this.hitBuf.length = 0
        if (this.raycaster.intersectObject(p.minusPlate, false, this.hitBuf).length > 0) {
          return { rec: p, minus: true }
        }
      }
      this.hitBuf.length = 0
      if (this.raycaster.intersectObject(p.plate, false, this.hitBuf).length > 0) {
        return { rec: p, minus: false }
      }
    }
    return null
  }

  /**
   * Drive the board SPAWN drop (transform-only on prebuilt groups):
   * gravity-feel ease-in fall with a leveling tilt → touchdown (dust puff +
   * squash) → house-spring relax → deferred camera glide home.
   */
  private updateSpawnTween(m: Mounted): void {
    const tw = this.spawnTween
    if (!tw) return
    const now = performance.now()
    if (tw.t0 === 0) {
      // lazy clock start: the synchronous rebuild (board + every component
      // mesh) happened before this first tick — the fall starts at its top,
      // never mid-air, however long the rebuild took
      tw.t0 = now
      return
    }
    const fall = (now - tw.t0) / SPAWN_DROP_MS
    if (fall < 1) {
      const p = fall * fall // accelerating, gravity-feel
      this.poseSpawnEntries(m, SPAWN_DROP_HEIGHT * (1 - p), tw.tilt * (1 - p), 1)
      return
    }
    if (!tw.landed) {
      tw.landed = true
      // touchdown: tiny dust puff at the base edges (the store path already
      // fired the haptic). The rAF loop only runs on a visible tab.
      m.spawnFx.burst(tw.rect, now, 12, 1)
    }
    const settle = (now - tw.t0 - SPAWN_DROP_MS) / SPAWN_SETTLE_MS
    if (settle < 1) {
      // one-beat squash: quick dip into the squash, house-spring relax out
      const dip = settle < 0.25 ? settle / 0.25 : 1 - SPRING_EASE((settle - 0.25) / 0.75)
      this.poseSpawnEntries(m, 0, 0, 1 - SPAWN_SQUASH * dip)
      return
    }
    this.poseSpawnEntries(m, 0, 0, 1) // exact rest pose
    this.spawnTween = null
    // Studio: a BVH built mid-tween captured displaced module poses —
    // rebuild once the drop has settled on the final geometry
    this.modes.invalidate()
    // sequence tail: drop → settle → dust → NOW the camera glides home
    if (this.flyHomePending) {
      this.flyHomePending = false
      this.flyCamera(m, m.homePos, m.homeTarget)
    }
  }

  /** Drive the removal lift + fade (detached old-board groups + clones). */
  private updateRemovalTween(m: Mounted): void {
    const tw = this.removalTween
    if (!tw) return
    const k = Math.min(1, (performance.now() - tw.t0) / REMOVE_MS)
    const ease = 1 - (1 - k) * (1 - k) // ease-out lift
    for (let i = 0; i < tw.groups.length; i++) {
      const g = tw.groups[i]
      g.position.set(tw.bases[i].x, tw.bases[i].y + REMOVE_LIFT * ease, tw.bases[i].z)
      g.updateMatrix()
    }
    setFadeOpacity(tw.set, 1 - ease)
    if (k >= 1) {
      // natural end: clean up WITHOUT killing the still-drifting dust puff
      this.removalTween = null
      for (const g of tw.groups) m.scene.remove(g)
      disposeFadeSet(tw.set, false) // the groups die with the old build
      tw.oldBuild.dispose()
      this.modes.invalidate()
      // deferred camera follow (the home extents shrank under the tween)
      if (this.flyHomePending) {
        this.flyHomePending = false
        this.flyCamera(m, m.homePos, m.homeTarget)
      }
    }
  }

  /** Drive the reduced-motion spawn fade-in (opacity only, no movement). */
  private updateFadeTween(): void {
    const tw = this.fadeTween
    if (!tw) return
    const k = Math.min(1, (performance.now() - tw.t0) / SPAWN_FADE_MS)
    setFadeOpacity(tw.set, k)
    if (k >= 1) {
      disposeFadeSet(tw.set, true) // restore the build's shared materials
      this.fadeTween = null
      this.modes.invalidate()
    }
  }

  /**
   * Snap every board spawn/removal animation to its end state and free what
   * it held (the removal tween owns the OLD board build until it finishes).
   * Safe to call any time — rebuilds and dispose() both funnel through here.
   */
  private finishBoardAnims(m: Mounted): void {
    const spawn = this.spawnTween
    if (spawn) {
      this.spawnTween = null
      for (const e of spawn.entries) {
        e.group.position.copy(e.base)
        e.group.rotation.set(0, 0, 0)
        e.group.scale.set(1, 1, 1)
        e.group.updateMatrix()
      }
    }
    const fade = this.fadeTween
    if (fade) {
      this.fadeTween = null
      disposeFadeSet(fade.set, true)
    }
    const removal = this.removalTween
    if (removal) {
      this.removalTween = null
      for (const g of removal.groups) m.scene.remove(g)
      disposeFadeSet(removal.set, false) // groups die with the old build
      removal.oldBuild.dispose()
      this.modes.invalidate()
    }
    m.spawnFx.reset()
  }

  /** Spring the camera to pos/tgt (~450ms); reduced motion jumps instantly. */
  private flyCamera(m: Mounted, pos: THREE.Vector3, tgt: THREE.Vector3): void {
    // the board slides under a pointer that stays put: the hover chip + ring go, and re-aim when it
    // lands (a fly to where the camera already is — F on a framed circuit — moves nothing: keep them)
    if (pos.distanceToSquared(m.camera.position) > CAMERA_STILL_EPS2 || tgt.distanceToSquared(m.controls.target) > CAMERA_STILL_EPS2) {
      this.hideChipForCameraMove(m)
    }
    if (prefersReducedMotion()) {
      this.camTween = null
      m.camera.position.copy(pos)
      m.controls.target.copy(tgt)
      m.controls.update()
      this.rearmChipAfterCamera()
      return
    }
    this.camTween = {
      startPos: m.camera.position.clone(),
      startTgt: m.controls.target.clone(),
      endPos: pos.clone(),
      endTgt: tgt.clone(),
      t0: performance.now(),
    }
  }

  /**
   * HARNESS ONLY (scripts/closeups.mjs via App's `?shotrig` hook): park the
   * camera at an exact pose for deterministic close-up screenshots. Cancels
   * any active re-frame tween; the running rAF loop renders the new view.
   * Not part of the scene contract — never called by product code.
   */
  setCameraPose(
    pos: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number },
  ): void {
    const m = this.m
    if (!m) return
    this.camTween = null
    // close-up shots go under the product orbit floor — relax it (the hook is
    // only reachable through the ?shotrig harness page, never in normal use)
    m.controls.minDistance = Math.min(m.controls.minDistance, 1.5)
    m.camera.position.set(pos.x, pos.y, pos.z)
    m.controls.target.set(target.x, target.y, target.z)
    m.controls.update()
  }

  /**
   * HARNESS ONLY (scripts/sweeps.mjs via App's `?shotrig` hook): project a
   * world point to viewport-client pixel coordinates so the sweep can aim
   * deterministic drags at parts and paddles. Not part of the scene contract.
   */
  projectToScreen(p: { x: number; y: number; z: number }): { x: number; y: number } | null {
    const m = this.m
    if (!m) return null
    const rect = m.renderer.domElement.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    m.camera.updateMatrixWorld()
    this.tmpVecB.set(p.x, p.y, p.z).project(m.camera)
    if (this.tmpVecB.z > 1) return null
    return {
      x: rect.left + ((this.tmpVecB.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - this.tmpVecB.y) / 2) * rect.height,
    }
  }

  /** Plan-extents of everything framable: the grid + off-board instrument units. */
  private homeBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    const config = boardConfigOf(this.layout)
    let { minX, maxX, minZ, maxZ } = boardExtents(config)
    // the "+" grow paddles float just past the grid's edges — keep them framed
    const pad = PADDLE_GAP + PADDLE_SIZE
    if (config.count < MAX_BOARD_COUNT) {
      minX -= pad
      maxX += pad
    }
    if (config.rows < MAX_BOARD_ROWS) {
      minZ -= pad
      maxZ += pad
    }
    // off-board instrument bodies (explicit `pos` honored — instruments are
    // movable) extend the framable bench; +margin past the terminal apron
    let slot = 0
    for (const comp of this.layout.components) {
      const entry = getEntry(comp.type)
      if (entry?.placement !== 'offboard') continue
      const r = offboardBodyRect(slot, comp.pos, entry.offboard) // the part's own footprint
      slot += offboardSlotSpan(entry.offboard)
      minX = Math.min(minX, r.minX - 0.8)
      maxX = Math.max(maxX, r.maxX + 0.8)
      minZ = Math.min(minZ, r.minZ - 0.5)
      maxZ = Math.max(maxZ, r.maxZ + 0.5)
    }
    return { minX, maxX, minZ, maxZ }
  }

  /**
   * Aspect-fit home framing (the default view, the empty-board re-frame
   * destination and the resize anchor): the camera distance along HOME_DIR is
   * the minimum that puts every corner of the board (+ off-board instruments)
   * bounding box inside the CURRENT frustum — a portrait phone gets the whole
   * board, not a landscape-tuned crop. Returns true when home moved.
   */
  private computeHomeFraming(m: Mounted): boolean {
    const b = this.homeBounds()
    this.refitShadows(m, b) // the shadow camera tracks the same extents
    const cx = (b.minX + b.maxX) / 2
    const cz = (b.minZ + b.maxZ) / 2
    let tanV = Math.tan(THREE.MathUtils.degToRad(m.camera.fov / 2))
    let tanH = tanV * Math.max(m.camera.aspect, 0.01)
    // docked chrome: fit the free rectangle (centred on the view axis by
    // applyViewOffset) instead of the whole canvas
    const fr = this.freeArea(m)
    if (fr) {
      tanH *= fr.fw
      tanV *= fr.fh
    }
    let d = MIN_HOME_DISTANCE
    for (const x of [b.minX, b.maxX]) {
      for (const y of [HOME_MIN_Y, HOME_MAX_Y]) {
        for (const z of [b.minZ, b.maxZ]) {
          const ox = x - cx
          const oz = z - cz
          const px = ox * HOME_RIGHT.x + y * HOME_RIGHT.y + oz * HOME_RIGHT.z
          const py = ox * HOME_UP.x + y * HOME_UP.y + oz * HOME_UP.z
          const pf = ox * HOME_FWD.x + y * HOME_FWD.y + oz * HOME_FWD.z
          d = Math.max(d, Math.abs(px) / tanH - pf, Math.abs(py) / tanV - pf)
        }
      }
    }
    d *= HOME_FIT_MARGIN
    const hx = cx + HOME_DIR.x * d
    const hy = HOME_DIR.y * d
    const hz = cz + HOME_DIR.z * d
    const moved =
      Math.abs(hx - m.homePos.x) > 1e-3 ||
      Math.abs(hy - m.homePos.y) > 1e-3 ||
      Math.abs(hz - m.homePos.z) > 1e-3 ||
      Math.abs(cx - m.homeTarget.x) > 1e-3 ||
      Math.abs(cz - m.homeTarget.z) > 1e-3
    m.homeTarget.set(cx, 0, cz)
    m.homePos.set(hx, hy, hz)
    // the home framing must stay reachable by pinch-zoom-out (and the
    // content-framing clamp below must never crop a fitted circuit)
    m.controls.maxDistance = Math.max(180, d * 1.35)
    return moved
  }

  /**
   * Fit the key light's ONE shadow map tightly around the active extents
   * (board + instruments): the ortho frustum is the bounding sphere of the
   * plan bounds, so texel density rises on smaller boards and nothing clips
   * on 'labxl'. Called whenever the home bounds are recomputed.
   */
  private refitShadows(
    m: Mounted,
    b: { minX: number; maxX: number; minZ: number; maxZ: number },
  ): void {
    const cx = (b.minX + b.maxX) / 2
    const cz = (b.minZ + b.maxZ) / 2
    // +3 margin: leaning wires/tall parts at the rim still land in the map
    const r = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 3
    const d = Math.max(60, r * 1.6)
    m.keyLight.position.set(cx + KEY_DIR.x * d, KEY_DIR.y * d, cz + KEY_DIR.z * d)
    m.keyLight.target.position.set(cx, 0, cz)
    m.keyLight.target.updateMatrixWorld()
    const cam = m.keyLight.shadow.camera
    if (cam.left !== -r || cam.right !== r) {
      cam.left = -r
      cam.right = r
      cam.top = r
      cam.bottom = -r
      cam.near = Math.max(1, d - r - 8)
      cam.far = d + r + 8
      cam.updateProjectionMatrix()
    }
    // light/frustum may have moved — schedule one on-demand shadow render
    m.renderer.shadowMap.needsUpdate = true
  }

  /** True while the camera is (still) parked at the home framing. */
  private cameraAtHome(m: Mounted): boolean {
    return (
      m.camera.position.distanceToSquared(m.homePos) < 0.04 &&
      m.controls.target.distanceToSquared(m.homeTarget) < 0.04
    )
  }

  /**
   * Camera framing that fits the layout's content (components, wires,
   * off-board terminal posts) from the home view's direction; null when the
   * board is empty. Distance fits the content's bounding sphere in the
   * narrower field of view, so phone portrait (narrow horizontal FOV) zooms
   * out far enough to reveal circuits placed anywhere along the board.
   */
  private contentFraming(m: Mounted): { pos: THREE.Vector3; tgt: THREE.Vector3 } | null {
    const box = new THREE.Box3()
    box.expandByObject(m.componentsGroup)
    box.expandByObject(m.wiresGroup)
    box.expandByObject(m.terminalsGroup)
    if (box.isEmpty()) return null

    // docked chrome (SC-1): circuit-first — fit the content BOX (its eight
    // corners, not the bounding sphere) into the free rectangle, so long thin
    // circuits fill the space between the panels. Zero insets keep the
    // classic sphere fit below bit-for-bit (legacy boots frame through it).
    if (this.freeArea(m)) return this.fitBox(m, box, CONTENT_MIN_SPAN)

    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const radius = Math.max(sphere.radius, 5) + 1.5 // pad; floor avoids over-zoom on tiny circuits
    const tgt = new THREE.Vector3(sphere.center.x, 0, sphere.center.z)
    const dir = new THREE.Vector3().subVectors(m.homePos, m.homeTarget).normalize()
    const vFov = THREE.MathUtils.degToRad(m.camera.fov)
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * m.camera.aspect)
    // docked chrome: the free rectangle's field of view (setViewInsets)
    const fr = this.freeArea(m)
    const fit = fr
      ? Math.min(2 * Math.atan(Math.tan(vFov / 2) * fr.fh), 2 * Math.atan(Math.tan(hFov / 2) * fr.fw))
      : Math.min(vFov, hFov)
    // sphere-tangent fit in the narrower FOV, +10% headroom for the chrome
    const dist = (radius / Math.sin(fit / 2)) * 1.1
    const clamped = THREE.MathUtils.clamp(dist, m.controls.minDistance, m.controls.maxDistance)
    const pos = dir.multiplyScalar(clamped).add(tgt)
    return { pos, tgt }
  }

  /**
   * Camera pose along the home view direction that fits `box` (padded by
   * FRAME_PAD in plan, at least `minSpan` hole pitches wide) into the free
   * rectangle — or the whole canvas without insets. The fit window is the
   * free rectangle's field of view minus the bands the capsule and the undo
   * pill still cover (docked chrome only), shrunk by FIT_MARGIN; the orbit
   * target stays on the board plane and is slid (a few fixed-point steps) so
   * the projected box sits centred in that window (a portrait window: high
   * in it — PORTRAIT_ANCHOR_Y). Exact for the eight
   * corners under perspective; clamped to the orbit distance limits.
   * Event-driven (never per frame); the corner scratch is reused.
   */
  private fitBox(
    m: Mounted,
    box: THREE.Box3,
    minSpan: number,
    dir: THREE.Vector3 | null = null,
    coverBottomPx?: number,
  ): { pos: THREE.Vector3; tgt: THREE.Vector3 } {
    // fit window in view-plane tangents (right/up of the principal point)
    const tanV = Math.tan(THREE.MathUtils.degToRad(m.camera.fov / 2))
    const tanH = tanV * Math.max(m.camera.aspect, 0.01)
    let xr = tanH
    let yt = tanV
    let yb = -tanV
    const fr = this.freeArea(m)
    if (fr) {
      xr = tanH * fr.fw
      const perPx = (2 * tanV) / fr.h
      yt = tanV * fr.fh - Math.max(0, FIT_RESERVE_TOP_PX - fr.top) * perPx
      // chrome resting over the free rectangle's bottom for this framing
      // (frameTargets coverBottomPx — the phone's peek sheet, the wire strip)
      // takes the place of the undo-pill band when it reaches higher
      const cover = coverBottomPx !== undefined && coverBottomPx > 0 ? coverBottomPx - fr.bottom : 0
      yb = -tanV * fr.fh + Math.max(FIT_RESERVE_BOTTOM_PX, cover) * perPx
      if (yt - yb < tanV * fr.fh) {
        // a very short free rectangle: drop the reserves rather than the circuit
        yt = tanV * fr.fh
        yb = -yt
      }
    }
    xr /= FIT_MARGIN
    yt /= FIT_MARGIN
    yb /= FIT_MARGIN

    // padded plan box, widened to the minimum span about its centre
    const cx = (box.min.x + box.max.x) / 2
    const cz = (box.min.z + box.max.z) / 2
    const hx = Math.max((box.max.x - box.min.x) / 2 + FRAME_PAD, minSpan / 2)
    const hz = Math.max((box.max.z - box.min.z) / 2 + FRAME_PAD, minSpan / 4)
    const y0 = Math.min(box.min.y, 0)
    const y1 = Math.max(box.max.y, 0.5)
    let i = 0
    for (const x of [cx - hx, cx + hx]) {
      for (const y of [y0, y1]) {
        for (const z of [cz - hz, cz + hz]) this.fitCorners[i++].set(x, y, z)
      }
    }
    const tgt = new THREE.Vector3(cx, 0, cz)
    // a portrait free rectangle (a phone): a wide circuit is width-bound and
    // would float mid-screen under a tall empty band — lift it toward the top
    // of the window (SH-15: the eye starts there, sheets rise from below);
    // landscape keeps it centred
    const portrait = fr !== null && fr.h * fr.fh > fr.w * fr.fw
    const d = fitCornersAlongHome(
      this.fitCorners,
      { xl: -xr, xr, yb, yt },
      tgt,
      dir ? viewBasis(dir) : undefined,
      portrait ? PORTRAIT_ANCHOR_Y : 0.5,
    )
    const dist = THREE.MathUtils.clamp(d, m.controls.minDistance, m.controls.maxDistance)
    const pos = new THREE.Vector3().copy(dir ?? HOME_DIR).multiplyScalar(dist).add(tgt)
    return { pos, tgt }
  }

  /** Box of the holes / terminals / parts / wires `spec` names (null: nothing known). */
  private targetsBox(spec: HighlightSpec, out: THREE.Box3): THREE.Box3 | null {
    out.makeEmpty()
    const p = this.tmpVecC
    for (const ref of Array.isArray(spec.holes) ? spec.holes : []) {
      if (typeof ref !== 'string') continue
      const at = this.resolveEndpoint(ref)
      if (!at) continue
      out.expandByPoint(at)
      out.expandByPoint(p.copy(at).setY(at.y + 1))
    }
    for (const id of Array.isArray(spec.components) ? spec.components : []) {
      if (typeof id !== 'string') continue
      const src = this.components.get(id)?.built.object ?? this.wires.get(id)?.group
      if (src) out.union(this.fitBoxTmp.setFromObject(src))
    }
    return out.isEmpty() ? null : out
  }

  /** Spring the camera to fit `box` (frameTargets / its re-fit on an inset change), along `dir` (null = home). */
  private flyToBox(
    m: Mounted,
    box: THREE.Box3,
    minSpan: number,
    dir: THREE.Vector3 | null = null,
    extra: TargetFitExtras = {},
  ): void {
    let framed = box
    let f = this.fitBox(m, box, minSpan, dir, extra.coverBottomPx)
    const want = extra.minPitchPx
    if (want !== undefined) {
      // release QA SC-F1: a box too big to show a hole pitch of `want` px —
      // measured along its centre column at its near AND far edge, so the
      // far rows count too — is cut down about its centre and fitted again:
      // its columns first (a long board is width-bound on a portrait phone),
      // its rows only when cutting columns does not bring the pitch up (a
      // short landscape window); each cut scales the padded half-extent by
      // the pitch ratio — the camera distance follows the binding extent. A
      // few steps converge; the minimum span stops it
      const cx = (box.min.x + box.max.x) / 2
      const cz = (box.min.z + box.max.z) / 2
      let hx = (box.max.x - box.min.x) / 2
      let hz = (box.max.z - box.min.z) / 2
      const boxOf = (ax: number, az: number) =>
        new THREE.Box3(new THREE.Vector3(cx - ax, box.min.y, cz - az), new THREE.Vector3(cx + ax, box.max.y, cz + az))
      const pitchAt = (fit: { pos: THREE.Vector3; tgt: THREE.Vector3 }, az: number): number | null => {
        const near = this.pitchFrom(m, fit.pos, fit.tgt, cx, cz + az)
        const far = this.pitchFrom(m, fit.pos, fit.tgt, cx, cz - az)
        return near === null || far === null ? null : Math.min(near, far)
      }
      let p = pitchAt(f, hz)
      for (let i = 0; i < MIN_PITCH_FIT_STEPS && p !== null && p < want * MIN_PITCH_TOLERANCE; i++) {
        const k = p / want
        const nhx = Math.max(0, (hx + FRAME_PAD) * k - FRAME_PAD)
        if (nhx < hx - 1e-6) {
          const tryBox = boxOf(nhx, hz)
          const tryFit = this.fitBox(m, tryBox, minSpan, dir, extra.coverBottomPx)
          const tryP = pitchAt(tryFit, hz)
          if (tryP !== null && tryP > p * MIN_PITCH_GAIN) {
            hx = nhx
            framed = tryBox
            f = tryFit
            p = tryP
            continue
          }
        }
        // cutting columns did not help: the rows bind
        const nhz = Math.max(0, (hz + FRAME_PAD) * k - FRAME_PAD)
        if (nhz >= hz - 1e-6) break // nothing left to cut: the minimum span binds
        hz = nhz
        framed = boxOf(hx, hz)
        f = this.fitBox(m, framed, minSpan, dir, extra.coverBottomPx)
        p = pitchAt(f, hz)
      }
    }
    this.lastTargetFrame = { box: framed.clone(), minSpan, dir, extra, pos: f.pos, tgt: f.tgt }
    this.flyCamera(m, f.pos, f.tgt)
  }

  /**
   * Selection-follow (docked chrome only): when the selected parts / wires
   * project with their centre outside the free rectangle, or more than
   * FOLLOW_HIDDEN_MAX of them lies under the chrome, glide just far enough
   * to bring them in (keeping the user's zoom and angle); a selection bigger
   * than the free rectangle is framed instead. Skipped while a re-frame is
   * already flying (that framing shows the circuit anyway).
   */
  private followSelection(m: Mounted): void {
    if (this.camTween) return
    const fr = this.freeArea(m)
    if (!fr) return
    const box = this.targetsBox({ components: this.selectedIds }, new THREE.Box3())
    if (!box) return
    m.camera.updateMatrixWorld()
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    const v = this.tmpVecD
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          v.set(x, y, z).project(m.camera)
          if (v.z > 1) return // behind the camera — leave the user's view alone
          const sx = ((v.x + 1) / 2) * fr.w
          const sy = ((1 - v.y) / 2) * fr.h
          if (sx < x0) x0 = sx
          if (sx > x1) x1 = sx
          if (sy < y0) y0 = sy
          if (sy > y1) y1 = sy
        }
      }
    }
    const fx0 = fr.left
    const fx1 = fr.w - fr.right
    const fy0 = fr.top + Math.max(0, FIT_RESERVE_TOP_PX - fr.top)
    const fy1 = fr.h - fr.bottom - FIT_RESERVE_BOTTOM_PX
    const area = Math.max(1, (x1 - x0) * (y1 - y0))
    const ix = Math.max(0, Math.min(x1, fx1) - Math.max(x0, fx0))
    const iy = Math.max(0, Math.min(y1, fy1) - Math.max(y0, fy0))
    const hidden = 1 - (ix * iy) / area
    const ccx = (x0 + x1) / 2
    const ccy = (y0 + y1) / 2
    const centreOut = ccx < fx0 || ccx > fx1 || ccy < fy0 || ccy > fy1
    if (!centreOut && hidden <= FOLLOW_HIDDEN_MAX) return
    if (x1 - x0 > (fx1 - fx0) - 2 * FOLLOW_MARGIN_PX || y1 - y0 > (fy1 - fy0) - 2 * FOLLOW_MARGIN_PX) {
      this.flyToBox(m, box, TARGETS_MIN_SPAN)
      return
    }
    // smallest screen shift that brings the box inside (with a margin)
    let dx = 0
    let dy = 0
    if (x0 < fx0 + FOLLOW_MARGIN_PX) dx = fx0 + FOLLOW_MARGIN_PX - x0
    else if (x1 > fx1 - FOLLOW_MARGIN_PX) dx = fx1 - FOLLOW_MARGIN_PX - x1
    if (y0 < fy0 + FOLLOW_MARGIN_PX) dy = fy0 + FOLLOW_MARGIN_PX - y0
    else if (y1 > fy1 - FOLLOW_MARGIN_PX) dy = fy1 - FOLLOW_MARGIN_PX - y1
    // px → world at the box's depth, along the camera's own right / up
    box.getCenter(v)
    const depth = Math.max(1, v.sub(m.camera.position).dot(m.camera.getWorldDirection(this.tmpVecC)))
    const perPx = (2 * depth * Math.tan(THREE.MathUtils.degToRad(m.camera.fov / 2))) / fr.h
    const right = this.tmpVecC.setFromMatrixColumn(m.camera.matrixWorld, 0)
    const up = this.tmpVecD.setFromMatrixColumn(m.camera.matrixWorld, 1)
    // moving the camera left / up slides the image right / down
    const shift = new THREE.Vector3().addScaledVector(right, -dx * perPx).addScaledVector(up, dy * perPx)
    this.flyCamera(m, m.camera.position.clone().add(shift), m.controls.target.clone().add(shift))
  }

  /**
   * Double-tap/double-click on empty space: spring the camera to frame the
   * circuit (or back to the home framing when the board is empty).
   */
  private reframeCamera(): void {
    const m = this.m
    if (!m) return
    const f = this.contentFraming(m)
    this.lastContentFrame = f
    this.flyCamera(m, f ? f.pos : m.homePos, f ? f.tgt : m.homeTarget)
  }

  /** rAF interpolation of camera position+target toward the tween destination. */
  private updateCamTween(m: Mounted): void {
    const tw = this.camTween
    if (!tw) return
    const t = Math.min(1, (performance.now() - tw.t0) / REFRAME_MS)
    const s = SPRING_EASE(t)
    m.camera.position.lerpVectors(tw.startPos, tw.endPos, s)
    m.controls.target.lerpVectors(tw.startTgt, tw.endTgt, s)
    m.camera.lookAt(m.controls.target)
    if (t >= 1) {
      this.camTween = null
      m.controls.update() // re-sync OrbitControls' spherical state
      this.rearmChipAfterCamera() // the camera landed: a resting mouse's chip names what is under it now
    }
  }

  /** Resolved tap/click (touch: <10px && <350ms; mouse: <6px && <400ms). */
  private handleClick(e: PointerEvent): void {
    const m = this.m
    if (!m) return
    this.updateNdc(e)
    this.raycaster.setFromCamera(this.pointerNdc, m.camera)
    const touch = e.pointerType === 'touch'
    const aiming = this.isPlaceOrWireMode()

    // 0. the "+" grow paddles (select mode + sim stopped only). The tapped
    // direction is remembered so the rebuild can animate the new module
    // column / board-row in at the matching edge. A click on the revealed
    // "−" chip removes from that edge instead (store shrink — protection
    // toasts handle stranded parts on the host side).
    const paddle = this.pickPaddle(m)
    if (paddle) {
      if (paddle.minus) {
        if (this.paddleRemovable(m, paddle.rec.dir)) {
          this.pendingShrinkDir = paddle.rec.dir
          this.callbacks.onShrinkGrid?.(paddle.rec.dir)
        }
        return
      }
      this.pendingGrowDir = paddle.rec.dir
      if (this.callbacks.onGrowGrid) this.callbacks.onGrowGrid(paddle.rec.dir)
      else if (paddle.rec.dir === 'right') this.callbacks.onAddBoardClick?.() // legacy host
      return
    }

    // 1. terminal posts (exact)
    this.hitBuf.length = 0
    const termHits = this.raycaster.intersectObjects(m.terminalsGroup.children, false, this.hitBuf)
    if (termHits.length > 0) {
      const ref = termHits[0].object.userData.terminalRef
      if (typeof ref === 'string') {
        this.callbacks.onTerminalClick?.(ref)
        return
      }
    }

    // 2. placing / wiring (SC-9): the aim resolver decides — the SAME target
    // the hover chip names, whatever part body the ray crosses first. A
    // click there never selects (onObjectClick is a select-mode event).
    if (aiming) {
      const target = this.resolveAimTarget(m, touch)
      if (target?.kind === 'terminal') {
        this.callbacks.onTerminalClick?.(target.ref)
        return
      }
      if (target) {
        // occlusion UX: a place/wire click on a body-covered hole is
        // rejected — pin the red locked chip (a quick tap never saw the aim
        // chip) and let the host explain WHY via onHoleOcclusionRejected
        if (target.occluded) {
          this.pinHoleLabel(m, target.hole)
          this.callbacks.onHoleOcclusionRejected?.(target.hole)
          return
        }
        if (!touch) this.pinHoleLabel(m, target.hole) // desktop QOL: chip lingers ~1.2s
        this.callbacks.onHoleClick?.(target.hole)
        return
      }
      // nothing to aim at under a part body (an instrument while placing):
      // keep the half-drawn wire — only a click on empty space cancels it
      if (this.raycastRoots(m.objectPickRoots, this.pointerNdc)) return
    } else {
      // 2. component bodies / wires (exact). shift/cmd/ctrl+click asks the
      // host for an ADDITIVE toggle (desktop multi-select extension).
      const id = this.pickObjectIdAtPointer()
      if (id !== null) {
        this.callbacks.onObjectClick?.(id, e.shiftKey || e.metaKey || e.ctrlKey)
        return
      }

      // 2b. touch slop, select mode: wires (~6px) and posts are far under the
      // 44px rule — search outward before holes (a hole tap in select mode only
      // clears the selection, so the nearby object should win)
      if (touch) {
        const term = this.pickTerminalNearPointer(OBJECT_TOUCH_SLOP_PX)
        if (term) {
          this.callbacks.onTerminalClick?.(term)
          return
        }
        const t = this.pickWithSlop(m.objectPickRoots, OBJECT_TOUCH_SLOP_PX)
        if (t?.componentId) {
          this.callbacks.onObjectClick?.(t.componentId)
          return
        }
      }

      // 3. board holes (coarse snap radius for touch); re-aim the ray first —
      // the slop scan above may have left it on an offset sample
      this.raycaster.setFromCamera(this.pointerNdc, m.camera)
      const holeRef = this.pickHole(touch ? HOLE_SNAP_DIST_TOUCH : HOLE_SNAP_DIST)
      if (holeRef) {
        if (!touch) this.pinHoleLabel(m, holeRef) // desktop QOL: chip lingers ~1.2s
        this.callbacks.onHoleClick?.(holeRef)
        return
      }
    }

    // 4. empty space — a second tap right after the first one re-frames the camera
    const now = performance.now()
    const prev = this.lastBgTap
    this.lastBgTap = { x: e.clientX, y: e.clientY, t: now }
    if (
      prev &&
      now - prev.t < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_MAX_PX
    ) {
      this.lastBgTap = null
      this.reframeCamera()
      return
    }
    this.callbacks.onBackgroundClick?.()
  }

  // ----------------------------------------------------- render-mode plumbing

  /** A primary canvas pointer went down (orbit, aiming, drags): Studio yields
   *  to the Enhanced raster until it lifts. Boolean-guarded so the manager's
   *  depth counter can never wedge on an unbalanced event. */
  private beginPointerInteraction(): void {
    if (this.pointerInteracting) return
    this.pointerInteracting = true
    this.modes.onInteractionStart()
  }

  private endPointerInteraction(): void {
    if (!this.pointerInteracting) return
    this.pointerInteracting = false
    this.modes.onInteractionEnd()
  }

  /**
   * Raster-overlay compositing for path-traced frames: everything excluded
   * from the Studio still (the overlay subtree + grow paddles — holograms,
   * hover ring, pin markers, selection boxes, wire/instrument previews,
   * coordinate chips, fingertip cursor) is re-rendered on top of the
   * presented image each frame, so placement / wiring / hover / selection
   * stay fully live while a still converges or holds. The pass draws a
   * handful of unlit transparent meshes over a cleared depth buffer —
   * negligible cost, no allocations.
   */
  private renderStudioOverlays(m: Mounted): void {
    // overlay children are created at many sites (ghost, drags, selection,
    // labels) — refreshing layer membership on the tiny subtree once per
    // composited frame beats layer bookkeeping at every add site
    m.overlayGroup.traverse(enableOverlayLayer)
    for (const p of m.paddles) p.group.traverse(enableOverlayLayer)
    const r = m.renderer
    const bg = m.scene.background
    const shadowPending = r.shadowMap.needsUpdate
    m.scene.background = null // never repaint the backdrop over the still
    r.shadowMap.needsUpdate = false // don't burn the on-demand map on overlays
    r.autoClear = false
    r.clearDepth()
    m.camera.layers.set(OVERLAY_LAYER)
    r.render(m.scene, m.camera)
    m.camera.layers.set(0)
    r.autoClear = true
    r.shadowMap.needsUpdate = shadowPending
    m.scene.background = bg
  }

  // ----------------------------------------------------------------- resize

  private handleResize(): void {
    const m = this.m
    if (!m) return
    const w = m.container.clientWidth
    const h = m.container.clientHeight
    if (w < 1 || h < 1) return
    const wasHome = this.cameraAtHome(m)
    this.viewH = h
    this.viewW = w
    m.camera.aspect = w / h
    m.camera.updateProjectionMatrix()
    this.applyViewOffset(m) // the offset window tracks the canvas size
    m.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)) // keep the ≤2 cap
    m.renderer.setSize(w, h)
    this.modes.setSize(w, h) // composer targets track the canvas (after setSize)
    // the wire end grips keep their on-screen size (their scale follows the canvas height)
    if (this.wireHandles) {
      this.clearWireHandles(m)
      this.syncWireHandles()
    }
    // an aspect change moves the fit-to-board home framing; snap with it while
    // parked there (rotation/first-layout pass), never mid-tween or mid-orbit
    if (this.computeHomeFraming(m) && wasHome && !this.camTween) {
      m.camera.position.copy(m.homePos)
      m.controls.target.copy(m.homeTarget)
      m.controls.update()
    }
    // a new canvas size moves every hole on screen (and the chip's measured canvas rect)
    this.hideChipForCameraMove(m)
    if (!this.camTween) this.rearmChipAfterCamera()
  }
}
