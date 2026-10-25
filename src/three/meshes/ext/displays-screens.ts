/**
 * Pixel painters for the display-module meshes (displays.mesh.ts): turn a
 * part's DisplayTelemetry / values / rgb into the RGBA bytes of the
 * per-instance DataTextures the glass, the LCD window and the LED faces
 * sample. Pure functions over typed arrays — node-safe (no DOM, no
 * canvas), so the mesh tests can check what a screen shows.
 *
 * Texture row convention: DataTextures are not flipped (flipY = false), so
 * byte row 0 is v = 0 — the BOTTOM of a plane whose v axis runs toward the
 * module's far edge. The painters below take that into account: image row
 * y (0 = the top of the picture as the module shows it upright) lands in
 * texture row H − 1 − y.
 */
import type { DisplayTelemetry } from '../../../model/types'
import { romGlyph } from './displays-font'

export type Rgb = readonly [number, number, number]

// =================================================================== OLED

export const OLED_TEX_W = 128
export const OLED_TEX_H = 64

/** lit-pixel colour of the OLED variants (sRGB) */
const OLED_WHITE: Rgb = [236, 242, 255]
const OLED_BLUE: Rgb = [70, 182, 255]
const OLED_YELLOW: Rgb = [255, 214, 52]

/** Glass rows 0–15 are the yellow zone of a "yellow-blue" panel (a separate emitter strip on the glass). */
export const OLED_YELLOW_ROWS = 16

/** Lit colour of glass row `y` for a variant ('white' | 'blue' | 'yellow-blue'). */
export function oledColor(variant: string, y: number): Rgb {
  if (variant === 'blue') return OLED_BLUE
  if (variant === 'yellow-blue') return y < OLED_YELLOW_ROWS ? OLED_YELLOW : OLED_BLUE
  return OLED_WHITE
}

/**
 * The glass image of an SSD1306 / SH1106 module ('mono-pages' telemetry:
 * byte (y >> 3)·128 + x, bit y & 7) into a 128 × 64 RGBA buffer: lit
 * pixels in the panel colour, dark ones black. A missing / off display
 * stays black (an OLED emits nothing when off). Returns the number of lit
 * pixels.
 */
export function paintOled(out: Uint8Array, d: DisplayTelemetry | undefined, variant: string): number {
  out.fill(0)
  for (let i = 3; i < out.length; i += 4) out[i] = 255
  if (!d || !d.on || !d.data || d.format !== 'mono-pages') return 0
  const w = Math.min(d.width, OLED_TEX_W)
  const h = Math.min(d.height, OLED_TEX_H)
  let lit = 0
  for (let y = 0; y < h; y++) {
    const c = oledColor(variant, y)
    const row = (OLED_TEX_H - 1 - y) * OLED_TEX_W
    const base = (y >> 3) * d.width
    const bit = 1 << (y & 7)
    for (let x = 0; x < w; x++) {
      if ((d.data[base + x] & bit) === 0) continue
      const o = (row + x) * 4
      out[o] = c[0]
      out[o + 1] = c[1]
      out[o + 2] = c[2]
      lit++
    }
  }
  return lit
}

/** Emissive intensity of an OLED from its contrast register (telemetry contrast 0..1). */
export function oledIntensity(d: DisplayTelemetry | undefined): number {
  if (!d || !d.on) return 0
  const c = Math.min(1, Math.max(0, d.contrast ?? 0.5))
  return 0.45 + 1.05 * c
}

// ============================================================ character LCD

/**
 * Character-LCD window texture geometry: every 5 × 8 character cell is
 * drawn as 6 × 9 dot slots (one slot of gap right and below, the real
 * 0.6 mm / 0.4 mm inter-character gaps), every dot as `DOT` × `DOT`
 * texels with a 1-texel gap (the 0.05 mm gaps between the dots), plus a
 * margin of background around the character area (the viewing area is
 * larger than the character area).
 */
export interface LcdTexGeom {
  cols: number
  rows: number
  /** texels of background left / right of the character area */
  marginX: number
  /** texels of background above / below the character area */
  marginY: number
}

/** texels per dot slot (3 lit + 1 gap) */
export const LCD_DOT = 4

export function lcdTexSize(g: LcdTexGeom): { w: number; h: number } {
  return {
    w: g.cols * 6 * LCD_DOT - LCD_DOT + 2 * g.marginX,
    h: g.rows * 9 * LCD_DOT - LCD_DOT + 2 * g.marginY,
  }
}

/** Panel colours (sRGB): background = glass between dots, dot = a fully driven dot. */
export interface LcdPanelColors {
  bg: Rgb
  dot: Rgb
}

export const LCD_PANELS: Record<string, LcdPanelColors> = {
  // negative-mode blue STN: the backlight shows through driven dots
  blue: { bg: [34, 78, 236], dot: [226, 240, 255] },
  // positive-mode yellow-green STN: driven dots turn dark
  'yellow-green': { bg: [176, 206, 46], dot: [34, 48, 22] },
}

/** Values the HD44780 model publishes next to its 'chars' display. */
export interface LcdValues {
  cursorRow?: number
  cursorCol?: number
  cursor?: number
  blink?: number
  blinkPhase?: number
  ghostRow1?: number
  ghostOther?: number
}

/** The 8 dot rows of character `code` (CGRAM codes 00h–0Fh come from the telemetry CGRAM copy). */
export function glyphRows(code: number, cgram: Uint8Array | undefined): ArrayLike<number> {
  if (code < 0x10) {
    const k = (code & 7) * 8
    return cgram && cgram.length >= k + 8 ? cgram.subarray(k, k + 8) : new Uint8Array(8)
  }
  return romGlyph(code)
}

/**
 * Paint the LCD window: every dot mixes background → dot colour by its
 * drive level — the contrast curve the model derives from V_LCD for driven
 * dots, the ghost level for undriven ones (the row of boxes of an
 * uninitialized 1-line display, ghosting at an extreme V_LCD). Cursor:
 * underline in dot row 8; blink: the whole cell alternates with a block.
 * Missing telemetry = an unpowered panel: plain background.
 */
export function paintLcd(
  out: Uint8Array,
  g: LcdTexGeom,
  d: DisplayTelemetry | undefined,
  v: LcdValues | undefined,
  panel: LcdPanelColors,
): void {
  const { w, h } = lcdTexSize(g)
  const [br, bg, bb] = panel.bg
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    out[o] = br
    out[o + 1] = bg
    out[o + 2] = bb
    out[o + 3] = 255
  }
  if (!d || d.format !== 'chars') return
  const text = d.text ?? []
  const on = d.on
  const level = Math.min(1, Math.max(0, d.contrast ?? 0))
  const ghost1 = Math.min(1, Math.max(0, v?.ghostRow1 ?? 0))
  const ghostN = Math.min(1, Math.max(0, v?.ghostOther ?? 0))
  const curR = v?.cursorRow ?? -1
  const curC = v?.cursorCol ?? -1
  const underline = (v?.cursor ?? 0) === 1
  const blockPhase = (v?.blink ?? 0) === 1 && (v?.blinkPhase ?? 0) === 1
  const cgram = d.data
  for (let r = 0; r < g.rows; r++) {
    const ghost = r === 0 ? ghost1 : ghostN
    const line = text[r] ?? ''
    for (let c = 0; c < g.cols; c++) {
      const code = c < line.length ? line.charCodeAt(c) & 0xff : 0x20
      const rows = glyphRows(code, cgram)
      const isCur = on && r === curR && c === curC
      for (let dy = 0; dy < 8; dy++) {
        let bits = on ? rows[dy] & 0x1f : 0
        if (isCur && blockPhase) bits = 0x1f
        if (isCur && underline && dy === 7) bits = 0x1f
        for (let dx = 0; dx < 5; dx++) {
          const driven = ((bits >> (4 - dx)) & 1) === 1
          const k = driven ? Math.max(level, ghost) : ghost
          if (k <= 0.002) continue
          const x0 = g.marginX + (c * 6 + dx) * LCD_DOT
          // texture row 0 = bottom: picture row y → h − 1 − y
          const y0 = g.marginY + (r * 9 + dy) * LCD_DOT
          const cr = Math.round(br + (panel.dot[0] - br) * k)
          const cg = Math.round(bg + (panel.dot[1] - bg) * k)
          const cb = Math.round(bb + (panel.dot[2] - bb) * k)
          for (let ty = 0; ty < LCD_DOT - 1; ty++) {
            const row = (h - 1 - (y0 + ty)) * w
            for (let tx = 0; tx < LCD_DOT - 1; tx++) {
              const o = (row + x0 + tx) * 4
              out[o] = cr
              out[o + 1] = cg
              out[o + 2] = cb
            }
          }
        }
      }
    }
  }
}

// ==================================================================== TFT

/**
 * RGB565 glass image ('rgb565' telemetry: little-endian 16-bit words,
 * row-major, portrait) → RGBA. Missing telemetry = an unpowered panel:
 * black (the TN glass is dark without its backlight; the backlight term
 * is the material's emissive intensity). A powered panel that is asleep
 * or DISPOFF (`on` false) is the normally-white TN glass: the backlight
 * shines through undriven pixels.
 */
export function paintTft(out: Uint8Array, w: number, h: number, d: DisplayTelemetry | undefined): void {
  if (!d || d.format !== 'rgb565' || !d.data || d.width !== w || d.height !== h) {
    out.fill(0)
    for (let i = 3; i < out.length; i += 4) out[i] = 255
    return
  }
  if (!d.on) {
    out.fill(255)
    return
  }
  const src = d.data
  for (let y = 0; y < h; y++) {
    const row = (h - 1 - y) * w
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 2
      const p = src[i] | (src[i + 1] << 8)
      const r5 = (p >> 11) & 0x1f
      const g6 = (p >> 5) & 0x3f
      const b5 = p & 0x1f
      const o = (row + x) * 4
      out[o] = (r5 << 3) | (r5 >> 2)
      out[o + 1] = (g6 << 2) | (g6 >> 4)
      out[o + 2] = (b5 << 3) | (b5 >> 2)
      out[o + 3] = 255
    }
  }
}

/**
 * TFT emissive intensity: the backlight duty (0 = dark glass). Kept below
 * 1 so saturated RGB565 colours stay saturated through the ACES tone curve.
 */
export const TFT_FULL = 0.68
export function tftIntensity(d: DisplayTelemetry | undefined): number {
  if (!d) return 0
  return TFT_FULL * Math.min(1, Math.max(0, d.backlight ?? 0))
}

// ============================================================ LED faces

/**
 * MAX7219 matrix ('mono-pages' 8 × 8: byte per column, bit r = row r) →
 * an 8 × 8 RGBA level map sampled by the 64 dot lenses (texel (c, r) of
 * byte row r): R = G = B = lit level 0..255. The brightness the model
 * reports (PWM duty × multiplex duty, 1 = full scan at 31/32) scales the
 * level; the material colour carries the red.
 */
export function paintMatrix(out: Uint8Array, d: DisplayTelemetry | undefined): number {
  out.fill(0)
  for (let i = 3; i < out.length; i += 4) out[i] = 255
  if (!d || !d.on || !d.data || d.format !== 'mono-pages') return 0
  const b = Math.min(1, Math.max(0, (d.contrast ?? 1) / 2))
  // even intensity 0 (1/32 PWM) is plainly visible on a real matrix
  const lvl = srgbByte(0.3 + 0.7 * b)
  let lit = 0
  for (let c = 0; c < 8; c++) {
    const col = d.data[c] ?? 0
    for (let r = 0; r < 8; r++) {
      if (((col >> r) & 1) === 0) continue
      const o = (r * 8 + c) * 4
      out[o] = out[o + 1] = out[o + 2] = lvl
      lit++
    }
  }
  return lit
}

/** WS2812B colours (packed 0xRRGGBB per LED) → 1-row RGBA texture; returns the brightest channel 0..1. */
export function paintPixels(out: Uint8Array, rgb: readonly number[] | undefined, count: number): number {
  let peak = 0
  for (let i = 0; i < count; i++) {
    const v = rgb?.[i] ?? 0
    const r = (v >> 16) & 0xff
    const g = (v >> 8) & 0xff
    const b = v & 0xff
    // the LED's perceived colour: the 8-bit PWM values, lifted so dim
    // colours still read (the camera sees a lit die, not its average)
    const m = Math.max(r, g, b)
    const k = m > 0 ? Math.min(255 / m, Math.max(1, 2.4 - m / 255)) : 0
    const o = i * 4
    out[o] = Math.min(255, Math.round(r * k))
    out[o + 1] = Math.min(255, Math.round(g * k))
    out[o + 2] = Math.min(255, Math.round(b * k))
    out[o + 3] = 255
    peak = Math.max(peak, m / 255)
  }
  return peak
}

/**
 * TM1637 module (values seg0–seg3: segment bits a…g = bit 0…6, bit 7 of
 * digit 2 (seg1) = colon; brightness 0..1; on) → a 32-texel level row:
 * texel 8·digit + segment (0 a … 6 g), texel 7 of digit 1 = the colon.
 */
export function paintSegments(out: Uint8Array, values: Record<string, number> | undefined): number {
  out.fill(0)
  for (let i = 3; i < out.length; i += 4) out[i] = 255
  if (!values || !values.on) return 0
  const b = Math.min(1, Math.max(0, values.brightness ?? 0))
  const lvl = srgbByte(0.3 + 0.7 * b)
  let lit = 0
  for (let dgt = 0; dgt < 4; dgt++) {
    const s = values[`seg${dgt}`] ?? 0
    for (let k = 0; k < 8; k++) {
      if (k === 7 && dgt !== 1) continue // decimal points are not wired on this module
      if (((s >> k) & 1) === 0) continue
      const o = (dgt * 8 + k) * 4
      out[o] = out[o + 1] = out[o + 2] = lvl
      lit++
    }
  }
  return lit
}

/** linear 0..1 → sRGB-encoded byte (the level textures are sampled as sRGB) */
export function srgbByte(linear: number): number {
  const l = Math.min(1, Math.max(0, linear))
  const v = l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055
  return Math.round(v * 255)
}

/**
 * Albedo of LED faces from their emission texture: a lit lens is dominated
 * by its own light, so its diffuse reflection of the room is pulled down
 * (`out` = 255 − k·max(R, G, B)); unlit lenses keep the diffuser colour.
 */
export function ledAlbedo(out: Uint8Array, emission: Uint8Array, k = 0.95): void {
  for (let i = 0; i < emission.length; i += 4) {
    const m = Math.max(emission[i], emission[i + 1], emission[i + 2])
    const a = Math.round(255 - k * m)
    out[i] = out[i + 1] = out[i + 2] = a
    out[i + 3] = 255
  }
}
