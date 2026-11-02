/**
 * The look of a lit LED (owners: vivid, glow) — ONE brightness language for
 * every LED-like emitter: the 5 mm LED, the RGB LED, the boards' and
 * modules' SMD indicator LEDs and the WS2812 pixels.
 *
 * Input: telemetry `light` = forward current / rated current (20 mA) — the
 * luminous intensity of an LED is close to linear in its current (the same
 * honest scale the numbers use). Display, in two steps:
 *  1. perceived brightness p = light^0.45 (Stevens' power law), so the
 *     steps the eye expects stay distinct;
 *  2. the visual drive d = 0.8·p plus a 0.2 floor that fades in over the
 *     first ≈ 0.2 mA — a weak LED is plainly ON (and plainly weak), a
 *     leakage-level current stays dark:
 *        0 mA → d 0      dark (no glow at all)
 *      0.5 mA → d 0.35   a small, soft glow around the lens
 *        2 mA → d 0.48   plainly lit
 *        4 mA → d 0.59   clearly lit (every GPIO example): a coloured glow
 *                        well outside the dome
 *       10 mA → d 0.78   bright: a wide glow, the first star rays
 *       20 mA → d 1.00   dazzling: big glow, white-hot die, star flare,
 *                        HDR for the Enhanced bloom
 *     > 20 mA            harsher and whiter still (the part's own animator
 *                        adds the warning flicker, see semis.ts)
 *
 * The LENS keeps its saturated hue and only gets brighter (emission ≤ 1.1
 * linear at the rating — past that ACES bleaches a red lens to salmon);
 * only the die core whitens near full drive. The GLOW is a camera-facing
 * coloured halo drawn without a depth test (it is glare — light in the eye)
 * and with normal blending, which TINTS the white board with the LED's
 * colour (additive light clips to white on white and vanishes).
 *
 * glow2 (M3) — the steps must read in LUMINANCE, not only in hue: the halo
 * carries a HOT CORE over the die in its own draw (an HDR spot, brighter
 * than the lens from 0.5 mA, a step hotter and wider at every current,
 * white-hot at the rating), and its radius / opacity follow the perceived
 * brightness, so 0.5 → 2 → 4 mA spread as far as 4 → 10 → 20 mA. A white
 * LED glows a cool white BRIGHTER than the white board (its old cool tint
 * was darker than the board — only blue rose), ringed by a darker cool edge
 * so the light reads on white. How the glow is drawn — under the UI
 * overlays, only as far as the LED can be seen, the same look in
 * Performance and Enhanced — is led-glow-render.ts.
 *
 * Every rig is numeric-only state on per-instance materials over shared
 * textures: no lights (no shader recompiles), no picking, never in the
 * path-traced Studio still (bbNoStudio), never in a part's bounding box
 * (point-bounded geometry: framing and labels see the LED, not its glare).
 */
import * as THREE from 'three'
import type { ComponentTelemetry } from '../../model/types'
import { cachedGeometry, markShared } from './shared'
import {
  collectLitHalos,
  glowAfterRender,
  glowBeforeRender,
  glowSpriteGeometry,
  glowUniforms,
  litHaloCount,
  pointBounds,
  setGlowLit,
  setGlowOwner,
} from './led-glow-render'

export { collectLitHalos, litHaloCount }

/** Stevens' brightness exponent applied to the relative luminous intensity. */
export const PERCEIVED_EXP = 0.45

/** Perceived brightness of an LED at relative intensity `light` (0 → 0; 1 at the rating; > 1 over-driven). */
export function ledPerceived(light: number): number {
  return light > 0 && Number.isFinite(light) ? Math.pow(light, PERCEIVED_EXP) : 0
}

/**
 * Relative intensity from telemetry: the model's `light`; a snapshot from an
 * older model without it falls back to ledBrightness (I / 10 mA, clamped) / 2.
 */
export function lightOf(t: ComponentTelemetry | null | undefined): number {
  if (!t) return 0
  if (typeof t.light === 'number') return t.light
  return typeof t.ledBrightness === 'number' ? Math.max(0, t.ledBrightness) * 0.5 : 0
}

/** below this perceived brightness the LED reads dark (≈ 3 µA) */
export const P_DARK = 0.02

/** the visual floor of a lit LED and the perceived brightness where it is reached (≈ 0.2 mA) */
export const DRIVE_FLOOR = 0.2
const FLOOR_FULL_P = 0.12

/**
 * The relative intensity an indicator shows when its model only knows ON /
 * OFF (a logic channel, a 0..1 activity level): a typical indicator LED
 * (2 mA). The level scales it — no brightness is invented beyond the level.
 */
export const INDICATOR_ON_LIGHT = 0.1

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Visual drive from perceived brightness: 0 dark; a floor for any real current; 1 at the rating. */
export function ledDrive(p: number): number {
  if (!(p > P_DARK) || !Number.isFinite(p)) return 0
  return DRIVE_FLOOR * smoothstep(P_DARK, FLOOR_FULL_P, p) + (1 - DRIVE_FLOOR) * Math.min(p, 1)
}

/** Everything the 3D view shows of an LED at perceived brightness p (pure). */
export interface LedLook {
  /** perceived brightness (light^0.45) */
  p: number
  /** visual drive (ledDrive) */
  drive: number
  /** over-drive amount 0..1 (1 at ≈ 1.6× the rated current) */
  over: number
  /** lens emissive intensity (× the LED's hue — never whitened) */
  lens: number
  /** die emissive intensity, and how far its core goes white-hot (0 = hue) */
  die: number
  dieWhite: number
  /** the glow halo: opacity, radius in lens radii, whitening (over-drive only) */
  halo: number
  haloR: number
  haloWhite: number
  /**
   * glow2 (M3): the HOT CORE of the light, drawn by the halo itself over
   * the die (no extra draw): opacity, radius in lens radii, HDR gain on the
   * light's colour (> 1: brighter than the lens and the board, tone-mapped
   * towards a hot centre) and whitening (near the rating only).
   */
  core: number
  coreR: number
  coreGain: number
  coreWhite: number
  /** the star flare: opacity (0 = hidden), radius in lens radii, HDR gain for the Enhanced bloom */
  flare: number
  flareR: number
  flareGain: number
  /** the pool of light on the board: opacity, radius in lens radii */
  pool: number
  poolR: number
}

export function ledLook(p: number): LedLook {
  const drive = ledDrive(p)
  const lit = drive > 0
  const over = lit ? Math.max(0, Math.min(1, (p - 1) / 0.25)) : 0
  const flare = lit ? Math.min(1, 0.95 * smoothstep(0.62, 1.0, drive) + 0.3 * over) : 0
  return {
    p,
    drive,
    over,
    lens: lit ? 0.3 + 0.8 * drive + 0.5 * over : 0,
    die: lit ? 1.5 + 16 * drive + 18 * over : 0,
    dieWhite: lit ? Math.min(1, 0.75 * smoothstep(0.8, 1.0, drive) + 0.25 * over) : 0,
    // glow2 (M3): opacity and radius follow the perceived brightness itself
    // (not the floored drive), so 0.5 → 2 → 4 mA spread as far apart as
    // 4 → 10 → 20 mA: a small tight glow at 0.5 mA, a wide one at 20 mA
    halo: lit ? Math.min(0.92, 0.46 + 0.46 * Math.min(p, 1) + 0.1 * over) : 0,
    haloR: lit ? 2.0 + 5.5 * Math.pow(Math.min(p, 1), 1.7) + 2.2 * over : 0,
    haloWhite: 0.35 * over,
    core: lit ? Math.min(0.95, 0.72 + 0.23 * Math.min(p, 1) + 0.1 * over) : 0,
    // the core: a small, faintly hot spot at 0.5 mA (brighter than the lens,
    // still its hue), growing and heating up to a white-hot die at 20 mA
    coreR: lit ? 0.5 + 0.5 * Math.min(p, 1) + 0.3 * over : 0,
    coreGain: lit ? 1.8 + 4.2 * Math.min(p, 1) ** 2 + 2 * over : 0,
    coreWhite: lit ? Math.min(1, 0.06 + 0.4 * smoothstep(0.7, 1.0, p) + 0.3 * over) : 0,
    flare,
    flareR: 3 + 6 * drive + 3 * over,
    flareGain: 1 + 2 * flare,
    pool: lit ? Math.min(0.9, 0.2 + 0.5 * drive + 0.15 * over) : 0,
    poolR: lit ? 2 + 6 * drive : 0,
  }
}

/** a cool blue-white: how a phosphor white LED's light reads next to the warm studio key */
export const COOL_WHITE = 0x98b6ff

/**
 * The colour an LED's light shows in its lens / glow: the hue itself, a
 * near-white one as cool white (a white glow would vanish on the white board).
 */
export function ledEmission(color: number): number {
  return isWhiteLight(color) ? COOL_WHITE : color
}

function isWhiteLight(color: number): boolean {
  const hsl = { h: 0, s: 0, l: 0 }
  new THREE.Color(color).getHSL(hsl)
  return hsl.s < 0.15 || color === COOL_WHITE
}

/**
 * How much stronger a white LED's glow is laid on than a coloured one's: its
 * cool-white tint has a fraction of a coloured tint's contrast on the white
 * board, so its opacity a becomes 1 − (1 − a)^boost — denser, and never
 * clipped flat, so the brightness STEPS stay distinct.
 */
export const WHITE_GLOW_BOOST = 1.35
/** …and laid this much wider */
export const WHITE_GLOW_WIDTH = 1.2

/**
 * glow2 (M3): white light on the white board. Its cool tint at gain 1 is
 * DARKER than the board (only blue rose), so a white LED read unlit. Its
 * glow is laid on as a cool white lifted towards white and BRIGHTER than
 * the board (HDR gain, tone-mapped: ≈ L* 95 against the board's 86), its
 * hot core brighter still, and the glow is ringed by a darker cool edge —
 * the contrast that makes a light read on a white surface.
 */
export const WHITE_HALO_LIFT = 0.3
export const WHITE_HALO_GAIN = 2.4
/** the white core: lifted this far towards white, and its gain × the core's */
export const WHITE_CORE_LIFT = 0.5
export const WHITE_CORE_GAIN = 1.3

/** a red LED's light luminance (linear Y): the hue the core gains are tuned on */
const CORE_REF_Y = 0.24
/**
 * The core's gain for a hue of luminance Y: a light hue (yellow, green)
 * bleaches towards white under ACES at a gain a red takes in its stride, so
 * its gain is scaled by √(CORE_REF_Y / Y) (0.6 … 1.25) — every hue's core
 * reaches the same "hot" step at the same current.
 */
export function coreHueGain(c: THREE.Color): number {
  const Y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  return Y > 0 ? Math.min(1.25, Math.max(0.6, Math.sqrt(CORE_REF_Y / Y))) : 1
}
/** the darker contrasting edge of a white glow: opacity, and its colour (linear: a cool slate, ≈ rgb(104, 118, 152) on screen) */
export const WHITE_EDGE_ALPHA = 0.24
export const WHITE_EDGE_COLOR = new THREE.Color().setRGB(0.12, 0.15, 0.25)

/** the linear colour of an LED's glow */
export function ledGlowColor(color: number): THREE.Color {
  return new THREE.Color(ledEmission(color))
}

/** the glow opacity exponent of an LED colour (WHITE_GLOW_BOOST for white light, else 1) */
export function ledGlowBoost(color: number): number {
  return isWhiteLight(color) ? WHITE_GLOW_BOOST : 1
}

let poolTex: THREE.Texture | null | undefined
/** soft radial pool of light (white; tinted by the material) */
export function ledPoolTexture(): THREE.Texture | null {
  if (poolTex !== undefined) return poolTex
  if (typeof document === 'undefined') return (poolTex = null)
  const S = 128
  const cv = document.createElement('canvas')
  cv.width = S
  cv.height = S
  const ctx = cv.getContext('2d')
  if (!ctx) return (poolTex = null)
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.85)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(cv)
  markShared(tex)
  poolTex = tex
  return tex
}

let flareTex: THREE.Texture | null | undefined
/** a four-ray star flare with a hot core — the "dazzling" glint */
export function ledFlareTexture(): THREE.Texture | null {
  if (flareTex !== undefined) return flareTex
  if (typeof document === 'undefined') return (flareTex = null)
  const S = 256
  const cv = document.createElement('canvas')
  cv.width = S
  cv.height = S
  const ctx = cv.getContext('2d')
  if (!ctx) return (flareTex = null)
  const c = S / 2
  // a small hot core (the die, white-hot), long thin rays
  const core = ctx.createRadialGradient(c, c, 0, c, c, c * 0.14)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.35, 'rgba(255,255,255,0.6)')
  core.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, S, S)
  ctx.globalCompositeOperation = 'lighter'
  for (const [w, h, a] of [
    [S, 5, 0.9],
    [5, S, 0.9],
    [S * 0.6, 3, 0.45],
  ] as [number, number, number][]) {
    const gx = ctx.createLinearGradient(c - w / 2, 0, c + w / 2, 0)
    const gy = ctx.createLinearGradient(0, c - h / 2, 0, c + h / 2)
    const g = w > h ? gx : gy
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.5, `rgba(255,255,255,${a})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(c - w / 2, c - h / 2, w, h)
  }
  const tex = new THREE.CanvasTexture(cv)
  markShared(tex)
  flareTex = tex
  return tex
}

let haloTex: THREE.Texture | null | undefined
/** a wide soft falloff with a brighter centre (the resistor's heat haze uses it) */
export function ledHaloTexture(): THREE.Texture | null {
  if (haloTex !== undefined) return haloTex
  if (typeof document === 'undefined') return (haloTex = null)
  const S = 128
  const cv = document.createElement('canvas')
  cv.width = S
  cv.height = S
  const ctx = cv.getContext('2d')
  if (!ctx) return (haloTex = null)
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.08, 'rgba(255,255,255,0.75)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.32)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.1)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(cv)
  markShared(tex)
  haloTex = tex
  return tex
}

/**
 * How much of the glow lies over the lens itself (u → 0): the glare is
 * drawn over the dome, and a full-strength centre would flatten it into a
 * disc — the lit lens shows its own light and highlights through it.
 */
export const GLOW_CORE = 0.4

/**
 * The glow profile, u = r / R: a soft ball of light (1 − u²)² whose centre
 * (over the lens) is held to GLOW_CORE, rising to full by u = 0.3 — ≈ the
 * lens rim at 4 mA.
 */
export function ledGlowProfile(u: number): number {
  if (!(u < 1)) return 0
  const x = Math.max(0, u)
  const v = 1 - x * x
  const t = Math.min(1, x / 0.3)
  return v * v * (GLOW_CORE + (1 - GLOW_CORE) * t * t * (3 - 2 * t))
}

let glareTex: THREE.Texture | null | undefined
/** the LED glow halo texture (ledGlowProfile as alpha, white; tinted by the material) */
export function ledGlareTexture(): THREE.Texture | null {
  if (glareTex !== undefined) return glareTex
  if (typeof document === 'undefined') return (glareTex = null)
  const S = 128
  const cv = document.createElement('canvas')
  cv.width = S
  cv.height = S
  const ctx = cv.getContext('2d')
  if (!ctx) return (glareTex = null)
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  for (let i = 0; i <= 32; i++) {
    const u = i / 32
    g.addColorStop(u, `rgba(255,255,255,${ledGlowProfile(u).toFixed(4)})`)
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(cv)
  markShared(tex)
  glareTex = tex
  return tex
}

const noPick = (): void => {}
const WHITE = new THREE.Color(0xffffff)

/**
 * WHERE the glow blends decides whether it reads (led-glow-render.ts):
 * Performance draws into the sRGB canvas, after each fragment is
 * tone-mapped — the halo's normal alpha blend tints the white board and
 * lights the dark holes, glare in display space, as the eye sees it. In
 * Enhanced's linear-HDR target the shader emulates exactly that blend from
 * a copy of the background (see GLOW_HDR_GLSL): one look in both modes.
 *
 * The pool is ON the board (depth-tested): a MULTIPLY tint, board ×
 * mix(1, colour, a)^k — scale-invariant, so the board takes the colour
 * however bright it is (k > 1 in the HDR target).
 */
export const LINEAR_POOL_POWER = 2.5
const poolPower = { value: 1 }
const syncPoolPass = (renderer: THREE.WebGLRenderer): void => {
  poolPower.value = renderer.getRenderTarget() !== null ? LINEAR_POOL_POWER : 1
}

// three's ACESFilmicToneMapping matrices (sRGB → AP1 → sRGB) and their inverses
const ACES_IN = new THREE.Matrix3().set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777)
const ACES_OUT = new THREE.Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602)
const ACES_IN_INV = ACES_IN.clone().invert()
const ACES_OUT_INV = ACES_OUT.clone().invert()
const glslMat3 = (m: THREE.Matrix3): string => `mat3( ${m.elements.map((x) => x.toPrecision(9)).join(', ')} )`

/** the display transform D (three's ACES at the exposure + the sRGB OETF, as OutputPass / the canvas apply it) and its inverse */
const RRT = (v: number): number => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081)
const RRT_INV = (y0: number): number => {
  const y = Math.min(1, Math.max(-0.00038, y0))
  const A = 0.983729 * y - 1
  const B = 0.432951 * y - 0.0245786
  const C = 0.238081 * y + 0.000090537
  return (-B - Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A)
}
const OETF = (l: number): number => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 0.41666) - 0.055)
const EOTF = (v: number): number => (v <= 0.04045 ? v * 0.0773993808 : Math.pow(v * 0.9478672986 + 0.0521327014, 2.4))
/** brightest display value the HDR emulation targets (D⁻¹ grows without bound at 1) */
export const GLOW_DISPLAY_MAX = 0.996
const mul3 = (m: THREE.Matrix3, v: THREE.Vector3): THREE.Vector3 => v.applyMatrix3(m)
/** D(linear HDR colour) → display-referred sRGB (pure; mirrors the shader) */
export function glowDisplay(c: THREE.Vector3, exposure = 1): THREE.Vector3 {
  const v = mul3(ACES_IN, c.clone().multiplyScalar(exposure / 0.6))
  v.set(RRT(v.x), RRT(v.y), RRT(v.z))
  mul3(ACES_OUT, v)
  return v.set(OETF(Math.min(1, Math.max(0, v.x))), OETF(Math.min(1, Math.max(0, v.y))), OETF(Math.min(1, Math.max(0, v.z))))
}
/** D⁻¹: the linear HDR colour whose display image is `d` (pure; mirrors the shader) */
export function glowDisplayInv(d: THREE.Vector3, exposure = 1): THREE.Vector3 {
  const cl = (x: number): number => EOTF(Math.min(GLOW_DISPLAY_MAX, Math.max(0, x)))
  const v = mul3(ACES_OUT_INV, new THREE.Vector3(cl(d.x), cl(d.y), cl(d.z)))
  v.set(RRT_INV(v.x), RRT_INV(v.y), RRT_INV(v.z))
  return mul3(ACES_IN_INV, v).multiplyScalar(0.6 / exposure)
}

/**
 * The glow's colour path. uGlowPass 0 (the canvas): three's own tone
 * mapping + sRGB output and the material's blend. 1 (an HDR target): the
 * fragment reads its background B from the copy, forms the display-space
 * result the canvas would show — T = mix(D(B), D(c), a) for the halo,
 * D(B) + a·D(c) for the additive flare — and writes the HDR value that
 * tone-maps to T (the halo as (X, a) under its normal blend, the flare as
 * the additive difference).
 */
const GLOW_HDR_GLSL = `
uniform float uGlowPass;
uniform float uGlowExposure;
uniform sampler2D uGlowBg;
uniform vec4 uGlowBgRect;
vec3 glowRRT( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}
vec3 glowRRTInv( vec3 y ) {
  y = clamp( y, vec3( -0.00038 ), vec3( 1.0 ) );
  vec3 A = 0.983729 * y - 1.0;
  vec3 B = 0.4329510 * y - 0.0245786;
  vec3 C = 0.238081 * y + 0.000090537;
  return ( -B - sqrt( max( B * B - 4.0 * A * C, vec3( 0.0 ) ) ) ) / ( 2.0 * A );
}
vec3 glowDisplay( vec3 c ) {
  c *= uGlowExposure / 0.6;
  c = clamp( ${glslMat3(ACES_OUT)} * glowRRT( ${glslMat3(ACES_IN)} * c ), 0.0, 1.0 );
  return sRGBTransferOETF( vec4( c, 1.0 ) ).rgb;
}
vec3 glowDisplayInv( vec3 d ) {
  vec3 l = sRGBTransferEOTF( vec4( clamp( d, 0.0, ${GLOW_DISPLAY_MAX} ), 1.0 ) ).rgb;
  return ${glslMat3(ACES_IN_INV)} * glowRRTInv( ${glslMat3(ACES_OUT_INV)} * l ) * ( 0.6 / uGlowExposure );
}
`
const HALO_OUT = `if ( uGlowPass > 0.5 ) {
  vec3 bgHdr = texture2D( uGlowBg, ( gl_FragCoord.xy - uGlowBgRect.xy ) / uGlowBgRect.zw ).rgb;
  vec3 bgD = glowDisplay( bgHdr );
  vec3 cD = glowDisplay( outgoingLight );
  float ga = clamp( diffuseColor.a, 0.0, 1.0 );
#ifdef GLOW_ADDITIVE
  vec3 target = min( bgD + cD * ga, vec3( ${GLOW_DISPLAY_MAX} ) );
  gl_FragColor = vec4( max( glowDisplayInv( target ) - bgHdr, vec3( 0.0 ) ), 1.0 );
#else
  if ( ga < 0.002 ) discard;
  vec3 target = mix( bgD, cD, ga );
  gl_FragColor = vec4( ( glowDisplayInv( target ) - bgHdr * ( 1.0 - ga ) ) / ga, ga );
#endif
} else {
  #include <opaque_fragment>
}`

/**
 * glow2 (M3): a halo's own light, laid OVER its soft glow in the same draw
 * (u = r / R across the sprite):
 *  - the contrasting edge (white light only): a cool darker band at
 *    u ≈ 0.45–0.95, opacity uEdgeA × the halo's opacity;
 *  - the hot core over the die: a gaussian of radius uCoreR (in u), the HDR
 *    colour uCoreColor, opacity uCoreA × the halo's opacity — so a hidden
 *    LED's core fades with its glow (the opacity carries the visibility).
 * Composited "over" (straight alpha), so both blend paths take the result.
 */
const HALO_CORE_GLSL = `
uniform vec3 uCoreColor;
uniform float uCoreR;
uniform float uCoreA;
uniform float uEdgeA;
uniform vec3 uEdgeColor;
`
const HALO_CORE = `#include <map_fragment>
#ifdef USE_MAP
{
  float gu = length( vMapUv - 0.5 ) * 2.0;
  float ea = clamp( opacity * uEdgeA, 0.0, 1.0 ) * smoothstep( 0.45, 0.72, gu ) * ( 1.0 - smoothstep( 0.8, 0.97, gu ) );
  float a0 = diffuseColor.a;
  float a1 = ea + a0 * ( 1.0 - ea );
  diffuseColor.rgb = a1 > 0.0 ? ( uEdgeColor * ea + diffuseColor.rgb * a0 * ( 1.0 - ea ) ) / a1 : diffuseColor.rgb;
  float ca = uCoreR > 0.0 ? clamp( opacity * uCoreA, 0.0, 1.0 ) * exp( - ( gu * gu ) / ( uCoreR * uCoreR ) ) : 0.0;
  float a2 = ca + a1 * ( 1.0 - ca );
  diffuseColor.rgb = a2 > 0.0 ? ( uCoreColor * ca + diffuseColor.rgb * a1 * ( 1.0 - ca ) ) / a2 : diffuseColor.rgb;
  diffuseColor.a = a2;
}
#endif`

/** a halo's per-material core / edge uniforms (numeric state only) */
export interface HaloCoreUniforms {
  uCoreColor: { value: THREE.Color }
  uCoreR: { value: number }
  uCoreA: { value: number }
  uEdgeA: { value: number }
  uEdgeColor: { value: THREE.Color }
}
const haloCores = new WeakMap<THREE.Material, HaloCoreUniforms>()
/** test hook: a halo material's core / edge uniforms */
export function haloCoreOf(mat: THREE.Material): HaloCoreUniforms | undefined {
  return haloCores.get(mat)
}

/** A glow material: the canvas path as is; in an HDR target, the display-space emulation above. */
function glowHalo(mat: THREE.SpriteMaterial, additive = false): THREE.SpriteMaterial {
  if (additive) mat.defines = { ...(mat.defines ?? {}), GLOW_ADDITIVE: '' }
  const core: HaloCoreUniforms | null = additive
    ? null
    : {
        uCoreColor: { value: new THREE.Color(0, 0, 0) },
        uCoreR: { value: 0 },
        uCoreA: { value: 0 },
        uEdgeA: { value: 0 },
        uEdgeColor: { value: WHITE_EDGE_COLOR },
      }
  if (core) haloCores.set(mat, core)
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlowPass = glowUniforms.uGlowPass
    shader.uniforms.uGlowExposure = glowUniforms.uGlowExposure
    shader.uniforms.uGlowBg = glowUniforms.uGlowBg
    shader.uniforms.uGlowBgRect = glowUniforms.uGlowBgRect
    let frag = shader.fragmentShader.replace('#include <opaque_fragment>', HALO_OUT)
    if (core) {
      Object.assign(shader.uniforms, core)
      frag = HALO_CORE_GLSL + frag.replace('#include <map_fragment>', HALO_CORE)
    }
    shader.fragmentShader = GLOW_HDR_GLSL + frag
  }
  mat.customProgramCacheKey = () => (additive ? 'led-glow-flare-v3' : 'led-glow-halo-v4')
  return mat
}

/** Draw order of the glow: after the pools of light (2), before every UI overlay (≥ 3). */
export const GLOW_RENDER_ORDER = 2.6
export const FLARE_RENDER_ORDER = 2.7

/** wire a glow sprite into the per-frame draw control (led-glow-render.ts) */
function asGlowSprite(s: THREE.Sprite, lensR: number): THREE.Sprite {
  s.geometry = glowSpriteGeometry()
  s.onBeforeRender = glowBeforeRender as THREE.Object3D['onBeforeRender']
  s.onAfterRender = glowAfterRender as THREE.Object3D['onAfterRender']
  s.userData.glowLensR = lensR
  s.userData.glowA = 0
  s.raycast = noPick
  s.userData.bbNoStudio = true
  s.visible = false
  return s
}

/** a dark glow: hidden, out of the lit registry, its scale back to a point */
function darken(s: THREE.Sprite): void {
  s.visible = false
  s.material.opacity = 0
  s.userData.glowA = 0
  s.scale.setScalar(1e-3)
  s.updateMatrix()
  setGlowLit(s, false)
}

/**
 * The pool: always a multiply tint (fragment mix(1, colour, a), no tone
 * mapping so 1 stays 1), stronger in the HDR target.
 */
function multiplyTint(mat: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
  mat.blending = THREE.MultiplyBlending
  mat.toneMapped = false
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPoolPower = poolPower
    shader.fragmentShader =
      'uniform float uPoolPower;\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        'gl_FragColor = vec4( pow( mix( vec3( 1.0 ), outgoingLight, clamp( diffuseColor.a, 0.0, 1.0 ) ), vec3( uPoolPower ) ), 1.0 );',
      )
  }
  mat.customProgramCacheKey = () => 'led-pool-multiply-v1'
  return mat
}

/** the 5 mm LED's dome radius (scene units): the unit of every glow size below */
export const LED_LENS_R = 0.42

export interface LedHaloRig {
  halo: THREE.Sprite
  /** the light's colour (linear; mutable — see setHaloColor) */
  color: THREE.Color
  /**
   * Show perceived brightness `p` (0 = dark; > 1 over-driven); `gain`
   * scales the light for the current frame (the over-drive flicker).
   */
  apply(p: number, gain?: number): void
}

export interface LedGlowRig extends LedHaloRig {
  flare: THREE.Sprite
  pool: THREE.Mesh
}

export interface LedGlowOptions {
  /** the LED's colour (sRGB hex); the glow uses ledEmission(color) */
  color: number
  /** where the light comes from (the die / dome centre) */
  at: THREE.Vector3
  /** size multiplier (1 = a 5 mm LED; SMD indicators ≈ 0.45) */
  size?: number
  /**
   * an indicator on a board or module: the part's own other meshes (a
   * jumper cap, a header, an IC) can hide it too (led-glow-render.ts sightOf)
   */
  onBoard?: boolean
}

/** the coloured glow halo sprite (one draw call while lit and seen, none while dark or hidden) */
function haloSprite(color: THREE.Color, at: THREE.Vector3, k: number): THREE.Sprite {
  const mat = glowHalo(
    new THREE.SpriteMaterial({
      map: ledGlareTexture(),
      color: color.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      // glare: light in the eye, over whatever surrounds the LED —
      // depth-tested, the dome hid it and the board clipped its lower half;
      // a LED hidden behind another part casts none (led-glow-render.ts)
      depthTest: false,
    }),
  )
  const halo = asGlowSprite(new THREE.Sprite(mat), LED_LENS_R * k)
  halo.position.copy(at)
  halo.renderOrder = GLOW_RENDER_ORDER
  halo.name = 'led-halo'
  halo.scale.setScalar(1e-3)
  return halo
}

function applyHalo(halo: THREE.Sprite, color: THREE.Color, look: LedLook, k: number, gain: number, boost = 1): void {
  const mat = halo.material
  if (!(look.drive > 0)) {
    darken(halo)
    return
  }
  const white = boost !== 1
  if (white) {
    // white light: lifted towards white and brighter than the board (see WHITE_HALO_GAIN)
    mat.color.copy(color).lerp(WHITE, WHITE_HALO_LIFT + (1 - WHITE_HALO_LIFT) * look.haloWhite).multiplyScalar(WHITE_HALO_GAIN)
  } else mat.color.copy(color).lerp(WHITE, look.haloWhite)
  const a = Math.min(0.95, look.halo * gain)
  mat.opacity = boost === 1 ? a : 1 - Math.pow(1 - a, boost)
  halo.userData.glowA = mat.opacity
  // a white glow is also laid wider (the same steps, more area to read on white)
  const width = white ? WHITE_GLOW_WIDTH : 1
  halo.scale.setScalar(2 * LED_LENS_R * k * look.haloR * width)
  // the hot core over the die (and a white glow's contrasting edge), relative to this opacity
  const core = haloCores.get(mat)
  if (core) {
    core.uCoreColor.value
      .copy(color)
      .lerp(WHITE, white ? WHITE_CORE_LIFT + (1 - WHITE_CORE_LIFT) * look.coreWhite : look.coreWhite)
      .multiplyScalar(look.coreGain * (white ? WHITE_CORE_GAIN : coreHueGain(color)) * gain)
    core.uCoreR.value = look.coreR / (look.haloR * width)
    core.uCoreA.value = mat.opacity > 0 ? Math.min(1, look.core * gain) / mat.opacity : 0
    // the edge matters most for a faint glow; a dazzling one needs it less
    core.uEdgeA.value = white && mat.opacity > 0 ? (WHITE_EDGE_ALPHA * Math.min(1, 1.1 - 0.5 * Math.min(look.p, 1))) / mat.opacity : 0
  }
  halo.visible = true
  halo.updateMatrix()
  setGlowLit(halo, true)
}

/**
 * One glow halo (the SMD indicators, WS2812 pixels, the RGB LED): the same
 * brightness language as the 5 mm LED in a single sprite.
 */
export function makeLedHalo(o: LedGlowOptions): LedHaloRig {
  const k = o.size ?? 1
  const color = ledGlowColor(o.color)
  const boost = ledGlowBoost(o.color)
  const halo = haloSprite(color, o.at, k)
  if (o.onBoard) halo.userData.glowOnBoard = true
  return {
    halo,
    color,
    apply: (p, gain = 1) => applyHalo(halo, color, ledLook(p), k, gain, boost),
  }
}

/** Re-tint a halo rig (the RGB LED's mixed colour, a WS2812 pixel's latched colour); applies on the next apply(). */
export function setHaloColor(rig: LedHaloRig, color: THREE.Color): void {
  rig.color.copy(color)
  rig.halo.material.color.copy(color)
}

export interface LedGlowFullOptions extends LedGlowOptions {
  /** where the pool lies on the board (y is the surface) */
  poolAt: THREE.Vector3
}

/** The halo + flare + board pool of one 5 mm LED (add the three objects to the part group). */
export function makeLedGlow(o: LedGlowFullOptions): LedGlowRig {
  const k = o.size ?? 1
  const color = ledGlowColor(o.color)
  const boost = ledGlowBoost(o.color)
  const halo = haloSprite(color, o.at, k)

  // the star flare: additive glare, drawn like the halo (see glowHalo); it
  // is as visible as its halo (one sight test per LED)
  const flareMat = glowHalo(
    new THREE.SpriteMaterial({
      map: ledFlareTexture(),
      color: color.clone().lerp(WHITE, 0.3),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
    true,
  )
  const flare = asGlowSprite(new THREE.Sprite(flareMat), LED_LENS_R * k)
  setGlowOwner(flare, halo)
  flare.position.copy(o.at)
  flare.renderOrder = FLARE_RENDER_ORDER
  flare.name = 'led-flare'
  flare.scale.setScalar(1e-3)
  const flareBase = flareMat.color.clone()

  // the pool of light on the board: the white plastic takes the LED's
  // colour — a MULTIPLY tint (board × mix(1, colour, a)), which reads the
  // same on the board's LDR white (Performance) and on its HDR white under
  // the Enhanced studio light, where an alpha tint washes out;
  // polygon-offset above the board face
  const poolMat = multiplyTint(
    new THREE.MeshBasicMaterial({
      map: ledPoolTexture(),
      color: color.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  )
  const pool = new THREE.Mesh(
    // point-bounded: the pool never widens the part's box (framing, labels)
    cachedGeometry('led-pool-pt', () => {
      const g = new THREE.PlaneGeometry(1, 1)
      g.rotateX(-Math.PI / 2)
      return pointBounds(g)
    }),
    poolMat,
  )
  pool.onBeforeRender = syncPoolPass
  pool.position.set(o.poolAt.x, o.poolAt.y + 0.03, o.poolAt.z)
  pool.visible = false
  pool.raycast = noPick
  pool.userData.bbNoStudio = true
  pool.renderOrder = 2
  pool.name = 'led-pool'
  pool.scale.setScalar(1e-3)

  const apply = (p: number, gain = 1): void => {
    const look = ledLook(p)
    applyHalo(halo, color, look, k, gain, boost)
    if (!(look.drive > 0)) {
      darken(flare)
      pool.visible = false
      poolMat.opacity = 0
      pool.scale.setScalar(1e-3)
      pool.updateMatrix()
      return
    }
    if (look.flare > 0.01) {
      // HDR (> 1) near the rating: tone-mapped to a white-hot star
      flareMat.color.copy(flareBase).lerp(WHITE, 0.3 * look.over).multiplyScalar(look.flareGain)
      flareMat.opacity = Math.min(1, look.flare * gain)
      flare.userData.glowA = flareMat.opacity
      flare.scale.setScalar(2 * LED_LENS_R * k * look.flareR)
      flare.visible = true
      flare.updateMatrix()
      setGlowLit(flare, true)
    } else darken(flare)
    poolMat.opacity = Math.min(0.9, look.pool * gain)
    pool.scale.setScalar(2 * LED_LENS_R * k * look.poolR)
    pool.visible = true
    pool.updateMatrix()
  }
  return { halo, color, flare, pool, apply }
}

/** an SMD indicator's glow size (× the 5 mm LED's) */
export const SMD_GLOW_SIZE = 0.45
/** an SMD indicator lens's emission at the first glimmer (its saturated lit tint keeps the hue) */
const SMD_LENS_BASE = 1.0

/** An SMD indicator LED: its per-instance lens material (emissive = the hue) + one glow halo. */
export interface IndicatorLed {
  lens: THREE.MeshStandardMaterial
  /** the unlit lens colour (restored when dark / after a reset) */
  tint: number
  halo: LedHaloRig | null
}

/** The glow halo of an SMD indicator at `at` (null for a ghost preview: no sprite). */
export function indicatorHalo(color: number, at: THREE.Vector3, ghost = false): LedHaloRig | null {
  return ghost ? null : makeLedHalo({ color, at, size: SMD_GLOW_SIZE, onBoard: true })
}

/**
 * Light an SMD indicator at perceived brightness p — the 5 mm LED's
 * language: lit, the little lens takes its light's saturated hue (a pale
 * lens under the key light plus emission bleaches to pink) and glows; dark,
 * its unlit tint and no halo. Numeric-only mutations.
 */
export function applyIndicator(led: IndicatorLed, p: number, gain = 1): void {
  const look = ledLook(p)
  if (look.drive > 0) {
    led.lens.color.copy(led.lens.emissive).multiplyScalar(0.55)
    // a lens a few pixels wide: its emission stays above 1 when lit (it is
    // the halo that tells the brightness steps apart)
    led.lens.emissiveIntensity = (SMD_LENS_BASE + 0.9 * look.drive + 0.5 * look.over) * gain
  } else {
    led.lens.color.setHex(led.tint)
    led.lens.emissiveIntensity = 0
  }
  led.halo?.apply(p, gain)
}

/** Perceived brightness of an indicator whose model only knows a 0..1 ON level (a logic channel). */
export function indicatorLevelP(level: number | undefined): number {
  return typeof level === 'number' && level > 0 ? ledPerceived(Math.min(1, level) * INDICATOR_ON_LIGHT) : 0
}
