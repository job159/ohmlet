/**
 * Hover-hole FX (pure helpers — no scene wiring here; the scene integrator
 * consumes these next phase).
 *
 *  - makeHoverRing(): an additive, LED-phosphor-look glow ring (cyan-blue,
 *    matching the hologram FX) marking the hovered hole. Motion follows the
 *    binding DESIGN.md §4 spec: pop-in on the house spring with a ~0.6 →
 *    ~1.12 → 1.0 scale overshoot plus a one-shot squash-and-stretch (a hair
 *    wider than tall on landing, then relax); calling show() again while
 *    visible (hopping between adjacent holes) retriggers a smaller pop
 *    (~1.06 overshoot); resting = gentle breathing glow; leave = quick fade
 *    with NO scale animation; reduced motion = crossfade only.
 *  - makeHoleLabel(): ONE pooled CanvasTexture sprite showing the hovered
 *    hole's coordinate (e.g. "e23") on a tiny dark-glass rounded card,
 *    floating above the hole. setText() redraws in place — no per-hover
 *    mesh/texture allocation, crisp at devicePixelRatio 2.
 *
 * Intended scene usage:
 *
 *   // once, at mount:
 *   const ring = makeHoverRing()
 *   const label = makeHoleLabel()
 *   overlayGroup.add(ring.object, label.object)
 *   ring.setReducedMotion(prefersReducedMotion())
 *
 *   // when the hovered hole changes (t = elapsed seconds, same clock as
 *   // tickHolograms — e.g. THREE.Clock#getElapsedTime()):
 *   ring.object.position.set(pos.x, 0, pos.z)
 *   ring.show(t)
 *   label.setText(holeRef)              // e.g. "e23" / "top+5"
 *   label.object.position.set(pos.x, 1.45, pos.z)  // bottom-center anchor
 *   label.show()
 *
 *   // when nothing is hovered:   ring.hide(t); label.hide()
 *   // every frame, before render: ring.tick(t)   — allocation-free
 *   // at scene dispose():         ring.dispose(); label.dispose()
 *
 * Perf contract (README Known Issues / DESIGN.md §9): both helpers allocate
 * everything at construction; tick()/setText() mutate numbers/pixels in
 * place. Additive transparent materials never depth-write and never cast
 * shadows, so the single shadow map is untouched.
 */

import * as THREE from 'three'

/** Matches the existing hover overlays in scene.ts (ghost/hover = 3). */
export const HOVER_RING_RENDER_ORDER = 3
/** The readout floats above everything except the fingertip cursor (10). */
export const HOLE_LABEL_RENDER_ORDER = 9

/** Cyan-blue shared with the hologram FX (hologram.ts VALID_COLOR). */
const RING_COLOR = 0x66ccff

/** Plan size of the ring quad (world units; hole collar outer r = 0.32). */
const RING_PLANE = 1.7
/** The quad floats a hair above the board face (collar top is at 0.05). */
const RING_Y = 0.06
/**
 * Pop motion (DESIGN.md §4, user-tuned + binding). The appear pop scales
 * 0.6 → ~1.12 → settle 1.0 on the house spring (≤ 220ms); hopping between
 * adjacent holes retriggers a smaller pop (~1.06 overshoot). Landing carries
 * a one-shot squash-and-stretch: plan (x/z) a hair wider than tall (y), then
 * relax — "squishy", not bouncy-cartoon.
 */
const POP_SECONDS = 0.2
const POP_FROM = 0.6
const POP_PEAK = 1.12
const POP_SQUASH = 0.05
const HOP_SECONDS = 0.14
const HOP_FROM = 0.92
const HOP_PEAK = 1.06
const HOP_SQUASH = 0.03
/** Fraction of a pop spent rising to the peak; the remainder settles to 1. */
const POP_RISE = 0.55
/** Fade ramps: appear crossfade-in and the on-leave quick fade (seconds). */
const FADE_IN_SECONDS = 0.12
const HIDE_SECONDS = 0.12
/** Breathing glow: small amplitude, slow — "subtle" per the design ask. */
const BREATH_AMPLITUDE = 0.07
const BREATH_RATE = 2.4 // rad/s

// ---------------------------------------------------------------------------
// Hover ring
// ---------------------------------------------------------------------------

const RING_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * Radial falloff: a thin bright core ring at r=0.36 with a wider soft halo
 * and a faint center fill — reads like a lit LED phosphor, not a hard decal.
 * Ends with the standard tonemapping/colorspace chunks so the glow passes
 * through the same ACES + sRGB pipeline as the rest of the scene.
 */
const RING_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uFade;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - vec2(0.5)) * ${RING_PLANE.toFixed(2)};
    float core = exp(-pow((d - 0.36) / 0.08, 2.0));
    float halo = 0.34 * exp(-pow((d - 0.36) / 0.24, 2.0));
    float fill = 0.07 * exp(-pow(d / 0.30, 2.0));
    float a = (core + halo + fill) * uIntensity * uFade;
    // User-tuned (DESIGN.md §4): modest phosphor, not a beacon — the crisp
    // core carries the definition, the dimmed sub-1.0 boost kills the bloom.
    gl_FragColor = vec4(uColor * a * 0.85, clamp(a, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface HoverRing {
  /** Add to the overlay group; position it at the hole (y = 0 board top). */
  object: THREE.Object3D
  /**
   * Pop in with the §4 spring pulse (0.6 → ~1.12 → 1.0 + a one-shot
   * squash-and-stretch). Calling it again while already visible — the scene
   * does so whenever the hovered hole changes — retriggers a smaller pop
   * (~1.06 overshoot), so hopping between adjacent holes re-pops. `time` in
   * seconds, same clock as tick().
   */
  show(time: number): void
  /** Quick fade out (no scale animation), then hide. No-op when already hidden/hiding. */
  hide(time: number): void
  /**
   * Drive the breathing glow + show/hide pulses. Call once per frame with
   * elapsed seconds (shared app clock). Allocation-free; near-zero cost
   * while hidden.
   */
  tick(time: number): void
  /** Reduced motion: crossfade only — no scale pulses, no breathing. */
  setReducedMotion(reduced: boolean): void
  /** Free the per-instance geometry + material (one ring per scene). */
  dispose(): void
}

/**
 * The house motion spring — cubic-bezier(0.32, 0.72, 0, 1), the single curve
 * DESIGN.md §1 mandates for everything (scene.ts SPRING_EASE is the CSS
 * twin). x(t) is monotonic, so it is inverted by bisection (allocation-free;
 * 20 iterations ≈ 1e-6 precision, far past visual resolution).
 */
function houseSpring(k: number): number {
  if (k <= 0) return 0
  if (k >= 1) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 20; i++) {
    const t = (lo + hi) / 2
    const u = 1 - t
    const x = 3 * u * u * t * 0.32 + t * t * t // x1 = 0.32, x2 = 0
    if (x < k) lo = t
    else hi = t
  }
  const t = (lo + hi) / 2
  const u = 1 - t
  return 3 * u * u * t * 0.72 + 3 * u * t * t + t * t * t // y1 = 0.72, y2 = 1
}

/**
 * Build the (single, pooled) hover-hole glow ring. Everything is allocated
 * here; show/hide/tick only mutate uniforms, scale and visibility.
 */
export function makeHoverRing(): HoverRing {
  const geometry = new THREE.PlaneGeometry(RING_PLANE, RING_PLANE)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, RING_Y, 0) // baked: caller positions at the hole (y=0)
  const intensity = { value: 1 }
  const fade = { value: 0 }
  const material = new THREE.ShaderMaterial({
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(RING_COLOR) },
      uIntensity: intensity,
      uFade: fade,
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  })
  material.name = 'hover-ring'
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'hover-ring'
  mesh.visible = false
  mesh.renderOrder = HOVER_RING_RENDER_ORDER
  mesh.raycast = () => {} // never swallow scene picking

  type Mode = 'hidden' | 'shown' | 'hiding'
  let mode: Mode = 'hidden'
  let reduced = false
  /** fade ramp: from `fadeFrom` at `fadeT0` toward 1 (shown) / 0 (hiding) */
  let fadeT0 = 0
  let fadeFrom = 0
  /** active one-shot pop pulse (idle when popT0 < 0) */
  let popT0 = -1
  let popFrom = POP_FROM
  let popPeak = POP_PEAK
  let popSquash = POP_SQUASH
  let popDur = POP_SECONDS

  const startPop = (time: number, from: number, peak: number, squash: number, dur: number) => {
    popT0 = time
    popFrom = from
    popPeak = peak
    popSquash = squash
    popDur = dur
  }

  return {
    object: mesh,
    show(time) {
      if (mode === 'shown') {
        // hovered hole changed while visible: hopping between adjacent holes
        // retriggers a smaller version of the pop (§4, ~1.06 overshoot)
        startPop(time, HOP_FROM, HOP_PEAK, HOP_SQUASH, HOP_SECONDS)
        return
      }
      // fresh arrival (or re-arrival mid fade-out): the full appear pop,
      // crossfading in from whatever opacity the leave fade left behind
      fadeFrom = mode === 'hiding' ? fade.value : 0
      fadeT0 = time
      mode = 'shown'
      mesh.visible = true
      startPop(time, POP_FROM, POP_PEAK, POP_SQUASH, POP_SECONDS)
    },
    hide(time) {
      if (mode === 'hidden' || mode === 'hiding') return
      mode = 'hiding'
      fadeFrom = fade.value
      fadeT0 = time
      popT0 = -1 // leave = quick fade, NO scale animation (§4)
    },
    tick(time) {
      if (mode === 'hidden') return
      // gentle breathing glow while visible (flat under reduced motion)
      intensity.value = 1 + (reduced ? 0 : BREATH_AMPLITUDE * Math.sin(time * BREATH_RATE))
      if (mode === 'hiding') {
        const k = Math.min(1, (time - fadeT0) / HIDE_SECONDS)
        fade.value = fadeFrom * (1 - k)
        if (k >= 1) {
          mode = 'hidden'
          mesh.visible = false
          mesh.scale.setScalar(1)
        }
        return
      }
      // shown: crossfade up…
      const kf = Math.min(1, (time - fadeT0) / FADE_IN_SECONDS)
      fade.value = fadeFrom + (1 - fadeFrom) * kf
      // …and play the one-shot pop. Both legs ride the house spring: rise
      // popFrom → popPeak, then settle popPeak → 1 while the squash-and-
      // stretch overlay widens the plan (x/z) a hair beyond the uniform
      // scale and squashes y by the same hair, relaxing to 0 by the end.
      if (reduced || popT0 < 0) return
      const k = Math.min(1, (time - popT0) / popDur)
      if (k >= 1) {
        popT0 = -1
        mesh.scale.setScalar(1)
        return
      }
      let s: number // uniform spring component
      let q = 0 // squash-and-stretch overlay
      if (k < POP_RISE) {
        s = popFrom + (popPeak - popFrom) * houseSpring(k / POP_RISE)
      } else {
        const u = (k - POP_RISE) / (1 - POP_RISE)
        s = popPeak + (1 - popPeak) * houseSpring(u)
        q = popSquash * Math.sin(Math.PI * u) // lands wide, relaxes to round
      }
      mesh.scale.set(s + q, Math.max(0.05, s - q), s + q)
    },
    setReducedMotion(flag) {
      reduced = flag
      if (flag) {
        intensity.value = 1
        popT0 = -1
        mesh.scale.setScalar(1)
      }
    },
    dispose() {
      mesh.parent?.remove(mesh)
      geometry.dispose()
      material.dispose()
    },
  }
}

// ---------------------------------------------------------------------------
// Hole coordinate readout (pooled CanvasTexture sprite)
// ---------------------------------------------------------------------------

/** World size of the label card (~2.2 units wide per the design ask). */
const LABEL_W = 2.2
const LABEL_H = 0.8
/**
 * Canvas backing resolution: 100 logical px per world unit × 2 render scale
 * — crisp at devicePixelRatio 2 (the renderer's pixelRatio cap).
 */
const LABEL_PX_W = 440
const LABEL_PX_H = 160

/**
 * Wider cards for long texts (the informative hover chip — 「PA5（板上 A5）·
 * 推挽輸出 · 3.30 V · c20」): the canvas grows in steps of half the base
 * width up to 3.5× (so a hop between similar texts reuses the texture), and
 * the sprite widens with it. A text that fits the base card draws exactly as
 * before (same canvas, same font, same size).
 */
const LABEL_WIDTH_STEP = 220
const LABEL_PX_W_MAX = 1540
/** a chip too long for one readable line wraps once (at a ' · '): two-line card height */
const LABEL_PX_H2 = 260
/**
 * Texts with CJK characters / full-width punctuation use the UI sans stack —
 * monospace CJK fallbacks read poorly. (The classic chip's '·' and '−' are
 * not CJK: 'U1 · A5 · c20' keeps its monospace card.)
 */
const CJK = /[\u2e80-\u2fff\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/

export interface HoleLabel {
  /**
   * A billboard sprite, anchored bottom-center: `position` is the point the
   * card floats ABOVE (e.g. `set(hole.x, 1.45, hole.z)`).
   */
  object: THREE.Object3D
  /** Redraw the card with a new coordinate (e.g. "e23"). Skips if unchanged. */
  setText(text: string): void
  /**
   * Uniform size multiplier of the card (default 1 — the world-sized card).
   * The scene raises it so the card never shrinks below a readable size on
   * screen. Number writes only.
   */
  setScale(k: number): void
  /** Card height in world units at scale 1 (for on-screen size checks). */
  readonly baseHeight: number
  /**
   * Occluded-hole styling (DESIGN §4b occlusion UX): `true` renders the
   * coordinate in iOS red with a tiny padlock glyph — the hole is covered by
   * a component body and takes no pin or wire end. Skips if unchanged.
   */
  setLocked(locked: boolean): void
  show(): void
  hide(): void
  /** Free the texture + material (one label per scene, reused per hover). */
  dispose(): void
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * Build the (single, pooled) hover-hole coordinate label: a tiny liquid-glass
 * rounded card with light monospace text on a CanvasTexture sprite. Headless
 * (no DOM, vitest node env) it degrades to an invisible sprite whose
 * setText() only records the string — same as board.ts's decal skip.
 */
export function makeHoleLabel(): HoleLabel {
  let canvas: HTMLCanvasElement | null = null
  let ctx: CanvasRenderingContext2D | null = null
  let texture: THREE.CanvasTexture | null = null
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas')
    canvas.width = LABEL_PX_W
    canvas.height = LABEL_PX_H
    ctx = canvas.getContext('2d')
    if (ctx) {
      texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = 4
    }
  }

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false, // readable even when a tall part is in front
  })
  material.name = 'hole-label'
  const sprite = new THREE.Sprite(material)
  sprite.name = 'hole-label'
  sprite.center.set(0.5, 0) // bottom-center anchor: position = point above hole
  sprite.scale.set(LABEL_W, LABEL_H, 1)
  sprite.visible = false
  sprite.renderOrder = HOLE_LABEL_RENDER_ORDER
  sprite.raycast = () => {}

  // precomputed paint constants (no per-redraw gradient/string churn)
  const monoFor = (px: number): string =>
    `600 ${px}px ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace`
  const sansFor = (px: number): string =>
    `600 ${px}px "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Noto Sans CJK TC", system-ui, sans-serif`
  let fontFor = monoFor
  const BASE_FONT_PX = 78
  const INSET = 3
  const RADIUS = 34
  const TEXT_PAD = 64
  /** widened cards keep more air at their rounded ends */
  const TEXT_PAD_WIDE = 120
  let cardFill: CanvasGradient | string = 'rgba(22,24,32,0.82)'
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, LABEL_PX_H)
    g.addColorStop(0, 'rgba(44,48,60,0.85)') // liquid-glass card (DESIGN.md §1)
    g.addColorStop(1, 'rgba(22,24,32,0.82)')
    cardFill = g
  }

  let cardFill2: CanvasGradient | string = cardFill
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, LABEL_PX_H2)
    g.addColorStop(0, 'rgba(44,48,60,0.85)')
    g.addColorStop(1, 'rgba(22,24,32,0.82)')
    cardFill2 = g
  }

  let text = ''
  let locked = false
  /** the text as drawn: one line, or two when a long chip wraps at a ' · ' */
  let lines: string[] = ['']
  /** current canvas size (px) — LABEL_PX_W × LABEL_PX_H unless a long text grew it */
  let pxW = LABEL_PX_W
  let pxH = LABEL_PX_H
  /** scene-driven size multiplier (setScale) */
  let scaleK = 1
  const applyScale = (): void => {
    sprite.scale.set(LABEL_W * (pxW / LABEL_PX_W) * scaleK, LABEL_H * (pxH / LABEL_PX_H) * scaleK, 1)
  }

  /** Tiny vector padlock (body + shackle), centered at (cx, cy), height ~s. */
  const drawPadlock = (cx: number, cy: number, s: number): void => {
    if (!ctx) return
    const bodyW = s * 0.92
    const bodyH = s * 0.62
    const shackleR = s * 0.30
    ctx.strokeStyle = '#ff453a'
    ctx.fillStyle = '#ff453a'
    // shackle: open arc sitting on the body top
    ctx.lineWidth = Math.max(3, s * 0.14)
    ctx.beginPath()
    ctx.arc(cx, cy - bodyH * 0.18, shackleR, Math.PI, 2 * Math.PI)
    ctx.stroke()
    // body: rounded square below
    roundRectPath(ctx, cx - bodyW / 2, cy - bodyH * 0.2, bodyW, bodyH, s * 0.14)
    ctx.fill()
  }

  /**
   * Fit the canvas to the text. ASCII texts that fit the base card (shrunk
   * no further than the classic 34 px floor) keep the classic card exactly —
   * coordinates and 'U1 · A5 · c20' chips look as they always did. Longer
   * texts and every Chinese (CJK) text get a card wide enough for the
   * base font size: the next LABEL_WIDTH_STEP up to LABEL_PX_W_MAX (beyond
   * that the text shrinks as before). A size change re-allocates the GPU
   * texture (dispose → the next upload uses the new size).
   */
  const fitCanvas = (): void => {
    if (!ctx || !canvas || !texture) return
    const wide = CJK.test(text)
    fontFor = wide ? sansFor : monoFor
    ctx.font = fontFor(BASE_FONT_PX)
    const lock = locked ? BASE_FONT_PX * 0.9 : 0
    const textW = ctx.measureText(text).width
    const classicFits = !wide && textW * (34 / BASE_FONT_PX) + lock <= LABEL_PX_W - TEXT_PAD
    lines = [text]
    let lineW = textW
    if (!classicFits && textW + lock + TEXT_PAD_WIDE > LABEL_PX_W_MAX) {
      // too long for one readable line: wrap once at the ' · ' that balances
      // the two lines best (「D1 · 陰極（短腳）· 0.00 V」 / 「上方 − 電源軌 · …」)
      let best = Infinity
      for (let i = text.indexOf('·'); i > 0; i = text.indexOf('·', i + 1)) {
        const a = text.slice(0, i).trimEnd()
        const b = text.slice(i + 1).trimStart()
        if (!a || !b) continue
        const wMax = Math.max(ctx.measureText(a).width, ctx.measureText(b).width)
        if (wMax < best) {
          best = wMax
          lines = [a, b]
        }
      }
      if (lines.length === 2) lineW = best
    }
    let nextW = LABEL_PX_W
    const need = lineW + lock + TEXT_PAD_WIDE
    if (need > LABEL_PX_W && !classicFits) {
      nextW = Math.min(LABEL_PX_W_MAX, LABEL_PX_W + Math.ceil((need - LABEL_PX_W) / LABEL_WIDTH_STEP) * LABEL_WIDTH_STEP)
    }
    const nextH = lines.length === 2 ? LABEL_PX_H2 : LABEL_PX_H
    if (nextW !== pxW || nextH !== pxH) {
      pxW = nextW
      pxH = nextH
      canvas.width = nextW
      canvas.height = nextH
      texture.dispose()
      applyScale()
    }
  }

  const draw = (): void => {
    if (!ctx || !canvas || !texture) return
    fitCanvas()
    const w = canvas.width
    const h = canvas.height
    const MAX_TEXT_W = w - (w > LABEL_PX_W ? TEXT_PAD_WIDE : TEXT_PAD)
    ctx.clearRect(0, 0, w, h)
    // dark glass rounded card + hairline border + specular top edge
    roundRectPath(ctx, INSET, INSET, w - 2 * INSET, h - 2 * INSET, RADIUS)
    ctx.fillStyle = h > LABEL_PX_H ? cardFill2 : cardFill
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = locked ? 'rgba(255,69,58,0.45)' : 'rgba(255,255,255,0.16)'
    ctx.stroke()
    roundRectPath(ctx, INSET + 2, INSET + 2, w - 2 * (INSET + 2), h - 2 * (INSET + 2), RADIUS - 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'
    ctx.stroke()
    // light monospace coordinate, auto-shrunk to fit (e.g. "top+49");
    // occluded holes render in iOS red with a tiny padlock left of the ref
    let px = BASE_FONT_PX
    const lockS = locked ? px * 0.62 : 0
    const lockGap = locked ? px * 0.28 : 0
    ctx.font = fontFor(px)
    const widest = (): number => Math.max(...lines.map((l) => ctx.measureText(l).width))
    let measured = widest() + lockS + lockGap
    if (measured > MAX_TEXT_W) {
      px = Math.max(34, Math.floor((px * MAX_TEXT_W) / measured))
      ctx.font = fontFor(px)
      measured = widest() + (locked ? px * 0.9 : 0)
    }
    ctx.fillStyle = locked ? '#ff453a' : '#e8f4ff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const textCx = w / 2 + (locked ? (lockS + lockGap) / 2 : 0)
    // one line: the classic vertical centre; two: centred around it, 100 px apart
    const step = LABEL_PX_H2 - LABEL_PX_H
    lines.forEach((line, i) => ctx.fillText(line, textCx, h / 2 + 2 + (i - (lines.length - 1) / 2) * step))
    if (locked) {
      const textW = ctx.measureText(lines[0]).width
      const y0 = h / 2 + 2 - ((lines.length - 1) / 2) * step
      drawPadlock(textCx - textW / 2 - lockGap - lockS / 2, y0, lockS)
    }
    texture.needsUpdate = true
  }

  return {
    object: sprite,
    setText(next) {
      if (next === text) return
      text = next
      draw()
    },
    setLocked(next) {
      if (next === locked) return
      locked = next
      draw()
    },
    setScale(k) {
      const next = Number.isFinite(k) && k > 0 ? k : 1
      if (next === scaleK) return
      scaleK = next
      applyScale()
    },
    baseHeight: LABEL_H,
    show() {
      sprite.visible = true
    },
    hide() {
      sprite.visible = false
    },
    dispose() {
      sprite.parent?.remove(sprite)
      texture?.dispose()
      material.dispose()
      // NOTE: sprite.geometry is THREE.Sprite's module-shared quad — never
      // dispose it here or every sprite in the app loses its geometry.
    },
  }
}

// ---------------------------------------------------------------------------
// Screen-space hover chip (UX fix wave SC-12 — docked / new chrome only)
// ---------------------------------------------------------------------------

/**
 * Tone of the screen chip: 'normal' (a hole / terminal), 'locked' (place /
 * wire mode aimed at a hole a part body covers — white text, red left bar
 * and a red padlock), 'neutral' (select mode over a part body: what a click
 * does there).
 */
export type ChipTone = 'normal' | 'locked' | 'neutral'

/** A screen rectangle in viewport CSS px (x0 < x1, y0 < y1). */
export interface ChipRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** chip font size (CSS px) — the spec's 14–16 px band */
export const SCREEN_CHIP_FONT_PX = 15
/** air between the anchor (the pointer / hole) and the chip (CSS px) */
export const SCREEN_CHIP_GAP_PX = 18
/** the chip keeps this far from the edges of the free area (CSS px) */
export const SCREEN_CHIP_EDGE_PX = 16

function overlapArea(a: ChipRect, b: ChipRect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * Where a w × h chip goes for the anchor (ax, ay) — pure, allocation-light
 * (one small candidate list per call). Candidates: above the anchor, below it
 * (unless `noBelow` — a finger sits there), right, left, and above / below
 * the hovered part's box (`part`) so the chip never covers the part being
 * pointed at; each is clamped into `area`. The winner covers neither the
 * anchor (a 12 px box) nor anything in `avoid` / `part` when possible; ties
 * go to the earlier candidate, so the chip sits above the pointer by default
 * and flips to the other side near an edge.
 */
export function placeScreenChip(
  w: number,
  h: number,
  ax: number,
  ay: number,
  area: ChipRect,
  avoid: readonly ChipRect[],
  part: ChipRect | null = null,
  opts: { gap?: number; noBelow?: boolean } = {},
): { x: number; y: number } {
  const gap = opts.gap ?? SCREEN_CHIP_GAP_PX
  const cands: [number, number][] = [[ax - w / 2, ay - gap - h]]
  if (!opts.noBelow) cands.push([ax - w / 2, ay + gap])
  cands.push([ax + gap, ay - h / 2], [ax - gap - w, ay - h / 2])
  if (part) {
    cands.push([ax - w / 2, part.y0 - gap * 0.5 - h])
    if (!opts.noBelow) cands.push([ax - w / 2, part.y1 + gap * 0.5])
  }
  const maxX = Math.max(area.x0, area.x1 - w)
  const maxY = Math.max(area.y0, area.y1 - h)
  const anchor: ChipRect = { x0: ax - 6, y0: ay - 6, x1: ax + 6, y1: ay + 6 }
  let best = { x: Math.min(Math.max(cands[0][0], area.x0), maxX), y: Math.min(Math.max(cands[0][1], area.y0), maxY) }
  let bestScore = Infinity
  for (const [cx, cy] of cands) {
    const x = Math.min(Math.max(cx, area.x0), maxX)
    const y = Math.min(Math.max(cy, area.y0), maxY)
    const r: ChipRect = { x0: x, y0: y, x1: x + w, y1: y + h }
    let score = overlapArea(r, anchor) * 400
    for (const a of avoid) score += overlapArea(r, a) * 4
    if (part) score += overlapArea(r, part)
    // a clamp that slid the chip so far that it no longer spans the anchor
    // reads as detached (sliding along the anchor's own side is free)
    score += (Math.max(0, Math.abs(x - cx) - (w / 2 - 12)) + Math.max(0, Math.abs(y - cy) - (h / 2 - 6))) * 0.5
    if (score < bestScore - 1e-6) {
      bestScore = score
      best = { x, y }
    }
  }
  return { x: Math.round(best.x), y: Math.round(best.y) }
}

export interface ScreenChip {
  /** the chip element (null without a DOM — tests, workers) */
  readonly element: HTMLDivElement | null
  /** Redraw with a new text (no-op if unchanged). */
  setText(text: string): void
  setTone(tone: ChipTone): void
  /** max width (CSS px) — the free area's width minus the edge air */
  setMaxWidth(px: number): void
  /** current size in CSS px (measured once per text / tone / width change) */
  size(): { w: number; h: number }
  /** top-left corner in viewport CSS px (writes only when it moved) */
  moveTo(x: number, y: number): void
  show(): void
  hide(): void
  readonly visible: boolean
  dispose(): void
}

const PADLOCK_SVG =
  '<svg width="11" height="13" viewBox="0 0 11 13" aria-hidden="true" style="flex:none;margin-top:3px">' +
  '<path d="M2.6 5.6V3.9a2.9 2.9 0 0 1 5.8 0v1.7" fill="none" stroke="#ff453a" stroke-width="1.6"/>' +
  '<rect x="0.8" y="5.4" width="9.4" height="7" rx="1.6" fill="#ff453a"/></svg>'

/**
 * The docked-chrome hover chip: a fixed-position DOM card in screen space —
 * a constant 15 px font at any zoom, wrapped to the free area's width, placed
 * by the scene each frame it is visible (placeScreenChip: inside the free
 * area, clear of the floating chrome and of the part being pointed at).
 * Near-opaque dark card (Tier-S recipe, no backdrop-filter), never takes the
 * pointer, aria-hidden (the hover chip repeats what the inspector says). The
 * classic chrome keeps the world-sized sprite of makeHoleLabel.
 */
export function makeScreenChip(): ScreenChip {
  if (typeof document === 'undefined') {
    let shown = false
    return {
      element: null,
      setText() {},
      setTone() {},
      setMaxWidth() {},
      size: () => ({ w: 0, h: 0 }),
      moveTo() {},
      show() {
        shown = true
      },
      hide() {
        shown = false
      },
      get visible() {
        return shown
      },
      dispose() {},
    }
  }
  const el = document.createElement('div')
  el.className = 'bb-hover-chip'
  el.setAttribute('aria-hidden', 'true')
  const st = el.style
  st.position = 'fixed'
  st.left = '0'
  st.top = '0'
  st.zIndex = '6'
  st.pointerEvents = 'none'
  st.display = 'none'
  st.boxSizing = 'border-box'
  st.alignItems = 'flex-start'
  st.gap = '6px'
  st.padding = '5px 11px 6px'
  st.borderRadius = '10px'
  st.background = 'rgba(28, 30, 38, 0.94)'
  st.border = '1px solid rgba(255, 255, 255, 0.14)'
  st.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.08)'
  st.color = 'rgba(255, 255, 255, 0.95)'
  st.font = `600 ${SCREEN_CHIP_FONT_PX}px/1.35 var(--lg-font, system-ui, sans-serif)`
  st.whiteSpace = 'normal'
  st.overflowWrap = 'anywhere'
  st.willChange = 'transform'
  const lock = document.createElement('span')
  lock.innerHTML = PADLOCK_SVG
  lock.style.display = 'none'
  const label = document.createElement('span')
  el.append(lock, label)
  document.body.appendChild(el)

  let text = ''
  let tone: ChipTone = 'normal'
  let maxW = 0
  let shown = false
  let measured: { w: number; h: number } | null = null
  let lastX = NaN
  let lastY = NaN
  return {
    element: el,
    setText(next) {
      if (next === text) return
      text = next
      label.textContent = next
      measured = null
    },
    setTone(next) {
      if (next === tone) return
      tone = next
      lock.style.display = next === 'locked' ? 'inline-flex' : 'none'
      st.borderLeft = next === 'locked' ? '3px solid #ff453a' : '1px solid rgba(255, 255, 255, 0.14)'
      st.fontWeight = next === 'neutral' ? '500' : '600'
      measured = null
    },
    setMaxWidth(px) {
      const next = Math.max(120, Math.round(px))
      if (next === maxW) return
      maxW = next
      st.maxWidth = `${next}px`
      measured = null
    },
    size() {
      if (!measured) measured = { w: el.offsetWidth, h: el.offsetHeight }
      return measured
    },
    moveTo(x, y) {
      if (x === lastX && y === lastY) return
      lastX = x
      lastY = y
      st.transform = `translate(${x}px, ${y}px)`
    },
    show() {
      if (shown) return
      shown = true
      st.display = 'flex'
      measured = null
    },
    hide() {
      if (!shown) return
      shown = false
      st.display = 'none'
    },
    get visible() {
      return shown
    },
    dispose() {
      el.remove()
    },
  }
}
