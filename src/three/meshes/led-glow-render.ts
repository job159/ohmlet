/**
 * How the LED glow sprites (halos, star flares — led-look.ts) are drawn
 * each frame (owner: glow). The glow is light in the eye: drawn without a
 * depth test over whatever surrounds the LED, but
 *
 *  - IN the scene pass, at renderOrder 2.6 / 2.7: after the board, the parts
 *    and the pools of light, BEFORE every UI overlay (highlight rims 3,
 *    pin markers 5, the current-flow layer 5, labels 8–9, cursors 10–11),
 *    so a lesson highlight or a live LED label always stays on top;
 *  - only as far as the LED itself can be seen: a hidden LED casts no glare.
 *    Its visibility is the fraction of five sight lines (the camera → the
 *    light and four points around it) that no OTHER part blocks — a CPU
 *    test (part boxes first, then the part's own opaque meshes), redone
 *    when the camera moves, the lit set changes or every 200 ms; no draw
 *    calls, no per-frame allocations.
 *
 * Performance draws into the sRGB canvas: the halo's normal alpha blend
 * tints the white board and lights the dark holes (glare in display space,
 * as the eye sees it). Enhanced composes in a linear-HDR target where the
 * studio-lit white board sits high in the ACES shoulder — an alpha tint
 * there washes back out to white. So in an HDR target the glow shader
 * EMULATES the canvas blend: before the first glow of the frame the target
 * region under the lit glows is copied (one copyTexSubImage2D, RGBA16F),
 * every glow fragment reads its background B, forms the display-space
 * result T = mix(D(B), D(c), a) (D = ACES + sRGB, exactly what OutputPass
 * applies) and writes the HDR value whose tone-mapped image is T. One look
 * in both modes; no extra pass, no extra draw calls.
 *
 * Passes that render the scene with an override material (the SAO
 * normal/depth pre-pass) and other render targets skip the glow entirely.
 */
import * as THREE from 'three'
import { markShared } from './shared'

/** shared uniforms of every glow material (numeric state only — no recompiles) */
export const glowUniforms = {
  /** 0 = the sRGB canvas (three's tone mapping + blending), 1 = HDR emulation */
  uGlowPass: { value: 0 },
  uGlowExposure: { value: 1 },
  uGlowBg: { value: null as THREE.Texture | null },
  /** the copied background region: origin (px) and the copy texture's size (px) */
  uGlowBgRect: { value: new THREE.Vector4(0, 0, 1, 1) },
}

/** the glow sprites (halos, star flares) currently lit */
const litGlows = new Set<THREE.Sprite>()

export function setGlowLit(sprite: THREE.Sprite, lit: boolean): void {
  if (lit) litGlows.add(sprite)
  else litGlows.delete(sprite)
}

/** test hook: the number of glows in the lit registry */
export function litHaloCount(): number {
  return litGlows.size
}

/**
 * The lit glows attached to a scene and visible up their ancestor chain
 * (detached ones — a rebuilt / deleted part — leave the registry). Fills
 * `out`, returns the count.
 */
export function collectLitHalos(out: THREE.Sprite[]): number {
  out.length = 0
  for (const h of litGlows) {
    let o: THREE.Object3D = h
    let shown = true
    while (true) {
      if (!o.visible) shown = false
      if (!o.parent) break
      o = o.parent
    }
    if (!(o as THREE.Scene).isScene) {
      litGlows.delete(h)
      continue
    }
    if (shown) out.push(h)
  }
  return out.length
}

// ---------------------------------------------------------------- geometry

let glowGeo: THREE.BufferGeometry | null = null
/**
 * The glow sprites' quad (three's sprite quad) whose bounding box is a POINT
 * at the sprite's centre: Box3.setFromObject(part) — framing, the live LED
 * label, chip avoidance, celebration bounds — sees the LED, never its glare.
 */
export function glowSpriteGeometry(): THREE.BufferGeometry {
  if (glowGeo) return glowGeo
  const g = new THREE.BufferGeometry()
  g.setIndex([0, 1, 2, 0, 2, 3])
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
  g.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3())
  g.computeBoundingSphere()
  markShared(g) // page lifetime: never disposed with a part
  glowGeo = g
  return g
}

/**
 * onBeforeRender of a part's other light / damage sprites (a hot resistor's
 * haze, a burned LED's soot, SceneFx's pin-damage markers): never drawn in a
 * pass that renders the scene with an override material (the Enhanced SAO
 * normal/depth pre-pass would otherwise take the raw, non-billboarded quad
 * into its depth and normals). Pair with glowAfterRender.
 */
export function skipInOverridePass(
  _r: THREE.WebGLRenderer,
  scene: THREE.Scene,
  _c: THREE.Camera,
  geometry: THREE.BufferGeometry,
): void {
  if (scene.overrideMaterial) skipDraw(geometry)
}

/**
 * Make a light / damage sprite (not a glow: no visibility test, no HDR
 * emulation) point-bounded — it never widens its part's box (selection box,
 * framing, the SceneFx burst origin) — and absent from override-material
 * passes (skipInOverridePass). Returns the sprite.
 */
export function asFxSprite(s: THREE.Sprite): THREE.Sprite {
  s.geometry = glowSpriteGeometry()
  s.onBeforeRender = skipInOverridePass as THREE.Object3D['onBeforeRender']
  s.onAfterRender = glowAfterRender as THREE.Object3D['onAfterRender']
  return s
}

/** A point bounding box for a glow mesh's geometry (the pool on the board). */
export function pointBounds(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3())
  return g
}

// ------------------------------------------------------------ draw control

const SKIP = -1
/** skip this object's draw (renderBufferDirect returns on a negative draw count); restored in onAfterRender */
function skipDraw(geometry: THREE.BufferGeometry): void {
  geometry.drawRange.count = SKIP
}
export function glowAfterRender(
  _r: THREE.WebGLRenderer,
  _s: THREE.Scene,
  _c: THREE.Camera,
  geometry: THREE.BufferGeometry,
): void {
  if (geometry.drawRange.count === SKIP) geometry.drawRange.count = Infinity
}

const isHdrTarget = (t: THREE.WebGLRenderTarget): boolean =>
  t.texture.type === THREE.HalfFloatType || t.texture.type === THREE.FloatType

/**
 * onBeforeRender of every glow sprite: picks the blend path for this render
 * target, prepares the frame once (visibility; the background copy in an
 * HDR target) and sets this glow's opacity = its light × its visibility.
 */
export function glowBeforeRender(
  this: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): void {
  if (scene.overrideMaterial) return skipDraw(geometry) // the SAO normal/depth pre-pass
  const target = renderer.getRenderTarget()
  let mode = 0
  if (target !== null) {
    if (!isHdrTarget(target) || renderer.toneMapping !== THREE.ACESFilmicToneMapping) return skipDraw(geometry)
    mode = 1
  }
  glowUniforms.uGlowPass.value = mode
  glowUniforms.uGlowExposure.value = renderer.toneMappingExposure
  prepareFrame(renderer, scene, camera, mode === 1 ? target : null)
  if (mode === 1 && !bgReady) return skipDraw(geometry)
  const sprite = this as THREE.Sprite
  const a = (sprite.userData.glowA as number | undefined) ?? 0
  const vis = visibilityOf(sprite)
  const op = a * vis
  ;(material as THREE.SpriteMaterial).opacity = op
  if (!(op > 0.002)) skipDraw(geometry)
}

let frameSeen = -1
let rendererSeen: THREE.WebGLRenderer | null = null
const lit: THREE.Sprite[] = []

/** once per renderer.render() call that draws glows */
function prepareFrame(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget | null,
): void {
  const f = renderer.info.render.frame
  if (f === frameSeen && renderer === rendererSeen) return
  frameSeen = f
  rendererSeen = renderer
  collectLitHalos(lit)
  updateVisibility(scene, camera, lit)
  if (target) copyBackground(renderer, target, camera, lit)
}

// ------------------------------------------------------ the HDR background

let bgTex: THREE.FramebufferTexture | null = null
let bgReady = false
const bgPos = new THREE.Vector2()
const tmpV = new THREE.Vector3()

const nextPow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, n)))

/** the screen half-extent (px) of a sprite of world size s at view depth z */
function spriteRect(camera: THREE.Camera, s: THREE.Sprite, W: number, H: number, out: number[]): boolean {
  const e = s.matrixWorld.elements
  const size = Math.hypot(e[0], e[1], e[2]) * 0.75 // ≥ the quad's half diagonal (0.707)
  tmpV.set(e[12], e[13], e[14]).applyMatrix4(camera.matrixWorldInverse)
  const z = -tmpV.z
  const persp = (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true
  if (persp && z <= 1e-4) return false
  const P = camera.projectionMatrix.elements
  tmpV.applyMatrix4(camera.projectionMatrix) // NDC (view offset included)
  const k = persp ? 1 / z : 1
  const rx = size * Math.abs(P[0]) * k * (W / 2) + 2
  const ry = size * Math.abs(P[5]) * k * (H / 2) + 2
  const cx = (tmpV.x * 0.5 + 0.5) * W
  const cy = (tmpV.y * 0.5 + 0.5) * H
  out[0] = cx - rx
  out[1] = cy - ry
  out[2] = cx + rx
  out[3] = cy + ry
  return true
}
const rectTmp = [0, 0, 0, 0]

/** copy the target region under every lit glow (one copy per frame) */
function copyBackground(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  camera: THREE.Camera,
  glows: THREE.Sprite[],
): void {
  bgReady = false
  const W = target.width
  const H = target.height
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of glows) {
    if (!((s.userData.glowA as number) > 0) || !(visibilityOf(s) > 0)) continue
    if (!spriteRect(camera, s, W, H, rectTmp)) continue
    x0 = Math.min(x0, rectTmp[0])
    y0 = Math.min(y0, rectTmp[1])
    x1 = Math.max(x1, rectTmp[2])
    y1 = Math.max(y1, rectTmp[3])
  }
  x0 = Math.max(0, Math.floor(x0))
  y0 = Math.max(0, Math.floor(y0))
  x1 = Math.min(W, Math.ceil(x1))
  y1 = Math.min(H, Math.ceil(y1))
  if (!(x1 > x0 && y1 > y0)) return
  const bw = Math.min(Math.max(64, nextPow2(x1 - x0)), Math.max(64, W))
  const bh = Math.min(Math.max(64, nextPow2(y1 - y0)), Math.max(64, H))
  const type = target.texture.type
  if (!bgTex || bgTex.image.width < bw || bgTex.image.height < bh || bgTex.type !== type) {
    bgTex?.dispose()
    const w = Math.max(bw, bgTex && bgTex.type === type ? bgTex.image.width : 0)
    const h = Math.max(bh, bgTex && bgTex.type === type ? bgTex.image.height : 0)
    bgTex = new THREE.FramebufferTexture(w, h)
    bgTex.type = type
    bgTex.name = 'led-glow-background'
  }
  bgPos.set(x0, y0)
  renderer.copyFramebufferToTexture(bgTex, bgPos)
  glowUniforms.uGlowBg.value = bgTex
  glowUniforms.uGlowBgRect.value.set(x0, y0, bgTex.image.width, bgTex.image.height)
  bgReady = true
}

/** Free the background copy (tests / teardown); the next HDR frame re-creates it. */
export function disposeGlowBackground(): void {
  bgTex?.dispose()
  bgTex = null
  bgReady = false
  glowUniforms.uGlowBg.value = null
}

// ------------------------------------------------------------- visibility

/** sight lines per glow: the light and four points around it (± right / up) */
const SAMPLE_OFFSETS: [number, number][] = [
  [0, 0],
  [0.55, 0],
  [-0.55, 0],
  [0, 0.55],
  [0, -0.55],
]
/** start a new pass at least this often while glows are lit (parts may have moved) */
const VIS_REFRESH_MS = 200
/**
 * CPU budget per frame for the sight tests (ms). A pass over the lit glows
 * may span a few frames (round-robin); a newly lit glow goes first. While
 * the camera orbits, passes run back to back: each glow's visibility is at
 * most a few frames old.
 */
export const VIS_BUDGET_MS = 0.3

const visOf = new WeakMap<THREE.Sprite, number>()
/**
 * flare → its halo: a flare is as visible as its halo (one sight test per
 * LED). A module WeakMap, never userData: Object3D.copy JSON-stringifies
 * userData, so a sprite there was serialised (its texture PNG-encoded) on
 * every clone of an LED (outlines, rims, the placement ghost).
 */
const glowOwners = new WeakMap<THREE.Sprite, THREE.Sprite>()

/** Link a glow (the star flare) to the glow whose visibility it shares (its halo). */
export function setGlowOwner(glow: THREE.Sprite, owner: THREE.Sprite): void {
  glowOwners.set(glow, owner)
}
/** glows already given a visibility (a new one jumps the queue) */
const visKnown = new WeakSet<THREE.Sprite>()
const lastCam = new Float64Array(20)
let lastPassAt = -Infinity
/** the current pass: glows still to test */
const queue: THREE.Sprite[] = []
let queueAt = 0
const halos: THREE.Sprite[] = []
const fresh: THREE.Sprite[] = []

/** a glow's visibility 0..1 (1 until computed); a flare uses its halo's */
export function visibilityOf(s: THREE.Sprite): number {
  const owner = glowOwners.get(s) ?? s
  return visOf.get(owner) ?? 1
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function cameraMoved(camera: THREE.Camera): boolean {
  const m = camera.matrixWorld.elements
  const p = camera.projectionMatrix.elements
  let moved = false
  for (let i = 0; i < 16; i++) {
    if (lastCam[i] !== m[i]) moved = true
    lastCam[i] = m[i]
  }
  const pk = [0, 5, 8, 9]
  for (let i = 0; i < 4; i++) {
    if (lastCam[16 + i] !== p[pk[i]]) moved = true
    lastCam[16 + i] = p[pk[i]]
  }
  return moved
}

/**
 * Bring the lit glows' visibility up to date: a new pass when the camera
 * moved, a glow lit up or VIS_REFRESH_MS passed; each call spends at most
 * VIS_BUDGET_MS on it (`force`: everything now — tests).
 */
export function updateVisibility(_scene: THREE.Scene, camera: THREE.Camera, glows: THREE.Sprite[], force = false): void {
  const moved = cameraMoved(camera)
  const t = now()
  halos.length = 0
  fresh.length = 0
  for (const s of glows) {
    if (glowOwners.has(s)) continue
    halos.push(s)
    if (!visKnown.has(s)) fresh.push(s)
  }
  const passDone = queueAt >= queue.length
  if (force || (passDone && (moved || fresh.length > 0 || t - lastPassAt >= VIS_REFRESH_MS))) {
    queue.length = 0
    for (const s of halos) queue.push(s)
    queueAt = 0
    lastPassAt = t
  } else {
    // a glow lit mid-pass: tested next
    for (const s of fresh) if (queue.indexOf(s, queueAt) < 0) queue.splice(queueAt, 0, s)
  }
  if (queueAt >= queue.length) return
  const parts = occluderParts(halos)
  const stop = force ? Infinity : t + VIS_BUDGET_MS
  do {
    const s = queue[queueAt++]
    if (!s.parent) continue
    visOf.set(s, sightOf(camera, s, parts))
    visKnown.add(s)
  } while (queueAt < queue.length && now() < stop)
  hits.length = 0
}

const ray = new THREE.Ray()
const raycaster = new THREE.Raycaster()
const hits: THREE.Intersection[] = []
const camPos = new THREE.Vector3()
const right = new THREE.Vector3()
const up = new THREE.Vector3()
const light = new THREE.Vector3()
const point = new THREE.Vector3()
const dir = new THREE.Vector3()
const entry = new THREE.Vector3()
const grown = new THREE.Box3()

/** the part (a child of the scene's components group) a glow belongs to */
const partOf = new WeakMap<THREE.Object3D, THREE.Object3D | null>()
function partRoot(s: THREE.Object3D): THREE.Object3D | null {
  if (partOf.has(s)) return partOf.get(s) ?? null
  let o: THREE.Object3D | null = s
  let root: THREE.Object3D | null = null
  while (o) {
    if (o.parent && o.parent.name === 'components') {
      root = o
      break
    }
    o = o.parent
  }
  if (root) partOf.set(s, root)
  return root
}

interface PartBox {
  part: THREE.Object3D
  box: THREE.Box3
  key: Float64Array
  n: number
  at: number
}
const boxes = new WeakMap<THREE.Object3D, PartBox>()
const childBox = new THREE.Box3()
const occluders: PartBox[] = []

const occludes = (m: THREE.Material | THREE.Material[]): boolean => {
  const one = (x: THREE.Material): boolean =>
    x.visible !== false &&
    x.colorWrite !== false &&
    (x.transparent !== true || x.opacity >= 0.85) &&
    !(((x as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0.2)
  return Array.isArray(m) ? m.some(one) : one(m)
}

const isSolidMesh = (o: THREE.Object3D): o is THREE.Mesh => {
  const m = o as THREE.Mesh
  return m.isMesh === true && !(o as unknown as THREE.Sprite).isSprite
}

/** a part's world box over its visible solid meshes (cached until the part moves; refreshed every 2 s) */
function partBox(part: THREE.Object3D, t: number): PartBox {
  const e = part.matrixWorld.elements
  let pb = boxes.get(part)
  let stale = !pb || pb.n !== part.children.length || t - pb.at > 2000
  if (pb && !stale) for (let i = 0; i < 16; i++) if (pb.key[i] !== e[i]) stale = true
  if (!pb || stale) {
    if (!pb) {
      pb = { part, box: new THREE.Box3(), key: new Float64Array(16), n: 0, at: 0 }
      boxes.set(part, pb)
    }
    pb.box.makeEmpty()
    const box = pb.box
    part.traverseVisible((o) => {
      if (!isSolidMesh(o) || !occludes(o.material)) return
      const g = o.geometry
      if (!g.boundingBox) g.computeBoundingBox()
      if (!g.boundingBox || g.boundingBox.isEmpty()) return
      childBox.copy(g.boundingBox).applyMatrix4(o.matrixWorld)
      box.union(childBox)
    })
    pb.key.set(e)
    pb.n = part.children.length
    pb.at = t
  }
  return pb
}

/** the candidate occluders of this frame: every visible part under the glows' components group */
function occluderParts(halos: THREE.Sprite[]): PartBox[] {
  occluders.length = 0
  const root = halos.length > 0 ? partRoot(halos[0]) : null
  const group = root?.parent
  if (!group) return occluders
  const t = now()
  for (const p of group.children) {
    if (!p.visible) continue
    const pb = partBox(p, t)
    if (!pb.box.isEmpty()) occluders.push(pb)
  }
  return occluders
}

/** does any visible solid mesh of `o` cross the raycaster's segment */
function blocks(o: THREE.Object3D): boolean {
  if (!o.visible) return false
  if (isSolidMesh(o) && occludes(o.material)) {
    hits.length = 0
    o.raycast(raycaster, hits)
    if (hits.length > 0) return true
  }
  const c = o.children
  for (let i = 0; i < c.length; i++) if (blocks(c[i])) return true
  return false
}

/**
 * blocks() for an on-board indicator's own part: only a hit farther than
 * `skip` from the light counts — the LED's own lens and pads never hide it,
 * a jumper cap, header or IC of the same board does
 */
function blocksAway(o: THREE.Object3D, skip: number): boolean {
  if (!o.visible) return false
  if (isSolidMesh(o) && occludes(o.material)) {
    hits.length = 0
    o.raycast(raycaster, hits)
    for (let i = 0; i < hits.length; i++) if (hits[i].point.distanceTo(light) > skip) return true
  }
  const c = o.children
  for (let i = 0; i < c.length; i++) if (blocksAway(c[i], skip)) return true
  return false
}

/** does the segment camPos → camPos + dir·far enter `box` */
function segmentEnters(box: THREE.Box3, far: number): boolean {
  if (box.containsPoint(camPos)) return true
  return ray.intersectBox(box, entry) !== null && entry.distanceTo(camPos) <= far
}

const near: PartBox[] = []

/**
 * the fraction of the sight lines to a glow's light that no other part
 * blocks — nor, for an on-board indicator (userData.glowOnBoard), its own
 * board's other meshes
 */
function sightOf(camera: THREE.Camera, s: THREE.Sprite, parts: PartBox[]): number {
  if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return 1
  const root = partRoot(s)
  const onBoard = s.userData.glowOnBoard === true
  if (!root || (parts.length < 2 && !onBoard)) return 1
  const me = s.matrixWorld.elements
  light.set(me[12], me[13], me[14])
  camPos.setFromMatrixPosition(camera.matrixWorld)
  const ce = camera.matrixWorld.elements
  right.set(ce[0], ce[1], ce[2]).normalize()
  up.set(ce[4], ce[5], ce[6]).normalize()
  const r = (s.userData.glowLensR as number | undefined) ?? 0.2
  // the parts any sight line could cross: their boxes grown by the sample spread, on the centre line
  dir.subVectors(light, camPos)
  const L0 = dir.length()
  if (!(L0 > 1e-6)) return 1
  dir.divideScalar(L0)
  ray.set(camPos, dir)
  near.length = 0
  for (const pb of parts) {
    if (pb.part === root && !onBoard) continue
    grown.copy(pb.box).expandByScalar(r * 0.6)
    if (segmentEnters(grown, L0)) near.push(pb)
  }
  if (near.length === 0) return 1
  let clear = 0
  for (const [ox, oy] of SAMPLE_OFFSETS) {
    point.copy(light).addScaledVector(right, ox * r).addScaledVector(up, oy * r)
    dir.subVectors(point, camPos)
    const L = dir.length()
    dir.divideScalar(L)
    ray.set(camPos, dir)
    const far = L - 0.02
    let blocked = false
    for (let i = 0; i < near.length && !blocked; i++) {
      if (!segmentEnters(near[i].box, far)) continue
      raycaster.set(camPos, dir)
      raycaster.near = 0
      raycaster.far = far
      blocked = near[i].part === root ? blocksAway(root, 2 * r) : blocks(near[i].part)
    }
    if (!blocked) clear++
  }
  return clear / SAMPLE_OFFSETS.length
}
