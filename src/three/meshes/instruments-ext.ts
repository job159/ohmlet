/**
 * Embedded-lab instruments: bench digital multimeter (visual.shape 'dmm')
 * and the logic-analyzer IC-hook probe (visual.shape 'logic_probe').
 *
 * The DMM is a member of the bench-instrument family in instruments.ts —
 * same painted-steel enclosure, brushed-aluminum faceplate, rubber corner
 * bumpers, bezel + glass-covered display and the SAME panel-mounted binding
 * posts (hex jam nut, insulator barrel, cross-drilled stud whose wire hole
 * sits exactly at (x, TERMINAL_TOP_Y, z) — the point the scene's wire ends,
 * the router's terminal exits and the fingertip snap all target). What makes
 * it read as a meter: a reflective segment LCD (seven-segment digits drawn
 * per glyph with faint ghost segments, unit annunciator) that shows the
 * model's own formatted reading (telemetry text[0], redrawn only when the
 * key changes — the PSU screen pattern), and a rotary range selector whose
 * pointer sits on the active mode (param 'mode': V / A / Ω).
 *
 * The logic probe is a slim IC test hook: sprung metal hook into the hole,
 * gray nose, a sleeve in the channel's standard logic-analyzer color
 * (black/brown/red/orange/yellow/green/blue/violet, repeating for D8-D15),
 * finger flange and plunger cap — deliberately unlike the scope probe's
 * chunky black boot with a colored ring.
 */

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { ComponentInstance } from '../../model/types'
import type { CatalogEntry } from '../../model/catalog'
import { paramOf } from '../../model/catalog'
import { TERMINAL_TOP_Y } from '../internal/wires'
import {
  BuildResult,
  HOLE_DEPTH,
  cachedGeometry,
  cachedMaterial,
  centroidOf,
  labelMaterial,
  legMesh,
  markShared,
  mergeStatic,
  metal,
  plastic,
} from './shared'

// ---------------------------------------------------------------------------
// Digital multimeter
// ---------------------------------------------------------------------------

const LCD_W = 320
const LCD_H = 116

/** Seven-segment glyphs (segments a-g). Unknown characters render blank. */
const SEG_GLYPHS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  O: 'abcdef',
  L: 'fed',
  E: 'afged',
  r: 'eg',
  ' ': '',
}

const LCD_BG_TOP = '#c3ccb0'
const LCD_BG_BOTTOM = '#adb899'
const LCD_INK = '#16190f'
const LCD_GHOST = 'rgba(40,52,30,0.05)'

/**
 * One slanted seven-segment digit cell at (x, y) (top-left), w × h px.
 * Segments are beveled hexagon bars with a gap, as on a real TN panel.
 */
function drawSegDigit(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  segs: string,
  color: string,
  dp: boolean,
): void {
  const t = Math.max(3, w * 0.17) // bar thickness
  const g = t * 0.22 // gap between bars
  const skew = 0.1 // italic slant (x shift per unit of height)
  const hh = h / 2
  // bar endpoints in an un-slanted cell: [x0, y0, x1, y1]
  const bars: Record<string, [number, number, number, number]> = {
    a: [t / 2 + g, t / 2, w - t / 2 - g, t / 2],
    g: [t / 2 + g, hh, w - t / 2 - g, hh],
    d: [t / 2 + g, h - t / 2, w - t / 2 - g, h - t / 2],
    f: [t / 2, t / 2 + g, t / 2, hh - g],
    b: [w - t / 2, t / 2 + g, w - t / 2, hh - g],
    e: [t / 2, hh + g, t / 2, h - t / 2 - g],
    c: [w - t / 2, hh + g, w - t / 2, h - t / 2 - g],
  }
  const sx = (px: number, py: number): number => x + px + (h - py) * skew
  ctx.fillStyle = color
  for (const s of segs) {
    const bar = bars[s]
    if (!bar) continue
    const [x0, y0, x1, y1] = bar
    const horiz = y0 === y1
    ctx.beginPath()
    if (horiz) {
      ctx.moveTo(sx(x0, y0), y + y0)
      ctx.lineTo(sx(x0 + t / 2, y0 - t / 2), y + y0 - t / 2)
      ctx.lineTo(sx(x1 - t / 2, y1 - t / 2), y + y1 - t / 2)
      ctx.lineTo(sx(x1, y1), y + y1)
      ctx.lineTo(sx(x1 - t / 2, y1 + t / 2), y + y1 + t / 2)
      ctx.lineTo(sx(x0 + t / 2, y0 + t / 2), y + y0 + t / 2)
    } else {
      ctx.moveTo(sx(x0, y0), y + y0)
      ctx.lineTo(sx(x0 + t / 2, y0 + t / 2), y + y0 + t / 2)
      ctx.lineTo(sx(x1 + t / 2, y1 - t / 2), y + y1 - t / 2)
      ctx.lineTo(sx(x1, y1), y + y1)
      ctx.lineTo(sx(x1 - t / 2, y1 - t / 2), y + y1 - t / 2)
      ctx.lineTo(sx(x0 - t / 2, y0 + t / 2), y + y0 + t / 2)
    }
    ctx.closePath()
    ctx.fill()
  }
  if (dp) {
    ctx.beginPath()
    ctx.arc(sx(w + t * 0.55, h - t / 2), y + h - t / 2, t * 0.55, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Unit shown in the annunciator when no reading exists, per range mode. */
function modeUnit(mode: string): string {
  return mode === 'A' ? 'A' : mode === 'Ω' ? 'Ω' : 'V'
}

/**
 * Paint the LCD: the reading line (telemetry text[0] from the multimeter
 * model, verbatim) as seven-segment digits + unit annunciator. No reading
 * (sim stopped / no telemetry) shows dashes — the meter never invents one.
 */
function drawLcd(ctx: CanvasRenderingContext2D, mode: string, line: string | null): void {
  const W = LCD_W
  const H = LCD_H
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, LCD_BG_TOP)
  bg.addColorStop(1, LCD_BG_BOTTOM)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  // annunciators (always-on legends of a DC bench meter)
  ctx.fillStyle = LCD_INK
  ctx.font = 'bold 15px Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('DC', 14, 10)
  ctx.font = 'bold 12px Arial, sans-serif'
  ctx.fillText('AUTO', 44, 12)

  // parse "<sign><number|OL> <unit>"; anything else is drawn as plain text
  let sign = ''
  let digits = '----'
  let unit = modeUnit(mode)
  let plain: string | null = null
  if (line !== null) {
    const m = /^\s*([+-]?)\s*(\d*\.?\d+|O\.?L|-+)\s*(.*)$/.exec(line)
    if (m) {
      sign = m[1] === '-' ? '-' : ''
      digits = m[2].replace('O.L', 'OL')
      unit = m[3].trim() || unit
    } else {
      plain = line
    }
  }

  const cellW = 42
  const cellH = 62
  const top = 36
  const right = W - 76 // digit block right edge (unit annunciator after it)
  if (plain !== null) {
    ctx.fillStyle = LCD_INK
    ctx.font = 'bold 34px "Courier New", monospace'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(plain, W - 14, top + cellH / 2, W - 28)
    return
  }
  // ghost segments: a TN panel always shows its unlit segments faintly
  const nCells = 5
  const pitch = cellW + 10
  for (let i = 0; i < nCells; i++) {
    drawSegDigit(ctx, right - (nCells - i) * pitch, top, cellW, cellH, 'abcdefg', LCD_GHOST, true)
  }
  // lit glyphs, right-aligned; '.' attaches to the preceding cell's dp
  const cells: { ch: string; dp: boolean }[] = []
  for (const ch of digits) {
    if (ch === '.' && cells.length) cells[cells.length - 1].dp = true
    else cells.push({ ch, dp: false })
  }
  const shown = cells.slice(-nCells)
  shown.forEach((cell, i) => {
    const slot = nCells - shown.length + i
    drawSegDigit(ctx, right - (nCells - slot) * pitch, top, cellW, cellH, SEG_GLYPHS[cell.ch] ?? '', LCD_INK, cell.dp)
  })
  // minus sign as a short bar left of the digit block
  if (sign) {
    ctx.fillStyle = LCD_INK
    ctx.fillRect(right - nCells * pitch - 26, top + cellH / 2 - 3, 18, 6)
  }
  ctx.fillStyle = LCD_INK
  ctx.font = 'bold 30px Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(unit, right + 14, top + cellH - 4, W - right - 18)
}

/** Fine horizontal brushing for the DMM faceplate (own map — see instruments.ts). */
let dmmBrushTex: THREE.Texture | null | undefined
function faceplateBrush(): THREE.Texture | null {
  if (dmmBrushTex !== undefined) return dmmBrushTex
  dmmBrushTex = null
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (ctx) {
      let seed = 0xd33f >>> 0
      const rnd = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0
        return seed / 4294967296
      }
      for (let y = 0; y < 256; y++) {
        const v = 196 + Math.floor(rnd() * 59)
        ctx.fillStyle = `rgb(${v},${v},${v})`
        ctx.fillRect(0, y, 64, 1)
      }
      const tex = new THREE.CanvasTexture(canvas)
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      markShared(tex)
      dmmBrushTex = tex
    }
  }
  return dmmBrushTex
}

/** Selector-pointer angle (rad, clockwise from straight up) per mode. */
const MODE_ANGLE: Record<string, number> = { V: -0.87, A: 0, Ω: 0.87 }

export function buildMultimeter(
  comp: ComponentInstance,
  entry: CatalogEntry,
  pins: THREE.Vector3[],
): BuildResult {
  const group = new THREE.Group()
  const c = centroidOf(pins)
  const postZ = c.z
  const bodyW = 6.5
  const bodyH = 3.2
  const bodyD = 3.2
  // identical enclosure frame to the PSU: front face 0.8 behind the posts,
  // so offboardBodyRect (validator + router obstacle) stays mesh-exact
  const frontZ = postZ - 0.8

  const shell = new THREE.Mesh(
    cachedGeometry('dmm-shell', () => new RoundedBoxGeometry(bodyW, bodyH, bodyD, 2, 0.12)),
    cachedMaterial('dmm-shell-mat', () =>
      new THREE.MeshPhysicalMaterial({ color: 0x282c33, roughness: 0.55, metalness: 0.25 }),
    ),
  )
  shell.position.set(c.x, bodyH / 2, frontZ - bodyD / 2)
  group.add(shell)

  // brushed-aluminum faceplate (metalness 0.8 + env lift, same reasoning as
  // the PSU plate: a pure metal collapses to charcoal in the dim-env modes)
  const faceplate = new THREE.Mesh(
    cachedGeometry('dmm-faceplate-geo', () => new THREE.BoxGeometry(6.2, 2.96, 0.08)),
    cachedMaterial('dmm-faceplate', () => {
      const m = new THREE.MeshPhysicalMaterial({ color: 0xc2c7cd, metalness: 0.8, roughness: 0.38 })
      m.envMapIntensity = 1.9
      const r = faceplateBrush()
      if (r) m.roughnessMap = r
      return m
    }),
  )
  faceplate.position.set(c.x, bodyH / 2, frontZ + 0.04)
  group.add(faceplate)
  const faceZ = frontZ + 0.08 + 0.02

  const statics: THREE.Object3D[] = []

  // rubber corner bumpers front + rear
  const rubber = cachedMaterial('dmm-rubber', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.9, metalness: 0 }),
  )
  const bumperGeo = cachedGeometry('dmm-bumper', () => new RoundedBoxGeometry(0.62, 0.62, 0.4, 1, 0.14))
  for (const sx of [-1, 1]) {
    for (const sy of [0, 1]) {
      for (const zPos of [frontZ + 0.04, frontZ - bodyD + 0.12]) {
        const b = new THREE.Mesh(bumperGeo, rubber)
        b.position.set(c.x + sx * (bodyW / 2 - 0.3), sy === 0 ? 0.31 : bodyH - 0.31, zPos)
        statics.push(b)
      }
    }
  }

  // LCD bezel (raised frame) — the display sits recessed behind glass
  const bezelMat = cachedMaterial('dmm-bezel', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x101114, roughness: 0.6, metalness: 0 }),
  )
  const lcdX = c.x - 0.7
  const lcdY = 2.05
  const lcdW = 3.3
  const lcdH = 1.2
  const bezelD = 0.16
  const bzTop = cachedGeometry('dmm-bz-top', () => new THREE.BoxGeometry(lcdW + 0.3, 0.15, bezelD))
  const bzSide = cachedGeometry('dmm-bz-side', () => new THREE.BoxGeometry(0.15, lcdH + 0.3, bezelD))
  for (const sy of [-1, 1]) {
    const rail = new THREE.Mesh(bzTop, bezelMat)
    rail.position.set(lcdX, lcdY + sy * (lcdH / 2 + 0.075), faceZ + bezelD / 2 - 0.02)
    statics.push(rail)
  }
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(bzSide, bezelMat)
    rail.position.set(lcdX + sx * (lcdW / 2 + 0.075), lcdY, faceZ + bezelD / 2 - 0.02)
    statics.push(rail)
  }

  // the LCD itself: per-instance canvas, redrawn only when (mode, reading)
  // changes. Reflective panel → lit by the scene (map) with a modest
  // backlight (emissiveMap) so it stays legible in the dim-env modes.
  let redraw: ((mode: string, line: string | null) => void) | null = null
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = LCD_W
    canvas.height = LCD_H
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(lcdW, lcdH),
        new THREE.MeshStandardMaterial({
          map: tex,
          emissive: 0xffffff,
          emissiveMap: tex,
          emissiveIntensity: 0.32,
          roughness: 0.55,
          metalness: 0,
        }),
      )
      screen.position.set(lcdX, lcdY, faceZ + 0.01)
      group.add(screen)
      let lastKey = ''
      redraw = (mode, line) => {
        const key = `${mode}|${line ?? ''}`
        if (key === lastKey) return
        lastKey = key
        drawLcd(ctx, mode, line)
        tex.needsUpdate = true
      }
    }
  }

  // glass cover over the recessed LCD (alpha only — no transmission)
  const glass = new THREE.Mesh(
    cachedGeometry('dmm-glass-geo', () => new THREE.PlaneGeometry(lcdW + 0.1, lcdH + 0.1)),
    cachedMaterial('dmm-glass', () =>
      new THREE.MeshPhysicalMaterial({
        color: 0x0a0c10,
        roughness: 0.06,
        metalness: 0,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      }),
    ),
  )
  glass.position.set(lcdX, lcdY, faceZ + 0.09)
  group.add(glass)

  // printed legends: model + power LED (same band as the PSU)
  const modelMat = labelMaterial('BS-DM45  MULTIMETER', { w: 256, h: 32, fg: '#2a2d31' })
  if (modelMat) {
    const lbl = new THREE.Mesh(
      cachedGeometry('dmm-model-geo', () => new THREE.PlaneGeometry(0.95, 0.12)),
      modelMat,
    )
    lbl.position.set(c.x - 2.1, 0.9, faceZ)
    group.add(lbl)
  }
  const led = new THREE.Mesh(
    cachedGeometry('dmm-pwr-led-geo', () => {
      const g = new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12)
      g.rotateX(Math.PI / 2)
      return g
    }),
    cachedMaterial('dmm-pwr-led', () =>
      new THREE.MeshStandardMaterial({ color: 0x0a2012, emissive: 0x35d158, emissiveIntensity: 1.6, roughness: 0.4 }),
    ),
  )
  led.position.set(c.x - 2.7, 0.95, faceZ + 0.02)
  group.add(led)

  // rotary range selector: dark skirt + machined knob with a grip bar; the
  // knob group turns so its pointer sits on the active mode legend
  const dialX = c.x + 2.15
  const dialY = 1.72
  const skirt = new THREE.Mesh(
    cachedGeometry('dmm-dial-skirt', () => {
      const g = new THREE.CylinderGeometry(0.62, 0.62, 0.06, 28)
      g.rotateX(Math.PI / 2)
      return g
    }),
    bezelMat,
  )
  skirt.position.set(dialX, dialY, faceZ + 0.03)
  statics.push(skirt)
  const knob = new THREE.Group()
  knob.position.set(dialX, dialY, faceZ)
  const knobParts: THREE.Object3D[] = []
  const knobBody = new THREE.Mesh(
    cachedGeometry('dmm-knob', () => {
      const g = new THREE.CylinderGeometry(0.5, 0.52, 0.3, 28)
      g.rotateX(Math.PI / 2)
      return g
    }),
    metal(0xb9bec5, 0.3),
  )
  knobBody.position.z = 0.21
  knobParts.push(knobBody)
  const grip = new THREE.Mesh(
    cachedGeometry('dmm-knob-grip', () => new THREE.BoxGeometry(0.2, 0.94, 0.18)),
    plastic(0x1b1c20, 0.45),
  )
  grip.position.z = 0.44
  knobParts.push(grip)
  const tick = new THREE.Mesh(
    cachedGeometry('dmm-knob-tick', () => new THREE.BoxGeometry(0.07, 0.26, 0.03)),
    cachedMaterial('dmm-knob-tick-mat', () =>
      new THREE.MeshPhysicalMaterial({ color: 0xeef0f2, roughness: 0.4, metalness: 0 }),
    ),
  )
  tick.position.set(0, 0.3, 0.54)
  knobParts.push(tick)
  for (const m of mergeStatic(knobParts)) knob.add(m)
  group.add(knob)

  // mode legends around the selector (V upper-left, A top, Ω upper-right)
  for (const mode of ['V', 'A', 'Ω'] as const) {
    const mat = labelMaterial(mode, { w: 64, h: 64, fg: '#24272b' })
    if (!mat) continue
    const lbl = new THREE.Mesh(
      cachedGeometry('dmm-mode-lbl', () => new THREE.PlaneGeometry(0.3, 0.3)),
      mat,
    )
    const a = MODE_ANGLE[mode]
    lbl.position.set(dialX + Math.sin(a) * 0.86, dialY + Math.cos(a) * 0.86, faceZ)
    group.add(lbl)
  }

  // binding posts through the faceplate — the PSU post construction exactly:
  // COM (pin 0) black, IN (pin 1) red; stud TOP = the wire attach point
  const plateFront = frontZ + 0.08
  const studR = 0.1
  const axisY = TERMINAL_TOP_Y - studR
  const hexGeo = cachedGeometry('dmm-post-hex-z', () => {
    const g = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 6)
    g.rotateX(Math.PI / 2)
    return g
  })
  const barrelGeo = cachedGeometry('dmm-post-barrel-z', () => {
    const g = new THREE.CylinderGeometry(0.21, 0.21, 0.48, 18)
    g.rotateX(Math.PI / 2)
    return g
  })
  const grooveGeo = cachedGeometry('dmm-post-groove', () => new THREE.TorusGeometry(0.21, 0.022, 6, 18))
  const studGeo = cachedGeometry('dmm-post-stud-z', () => {
    const g = new THREE.CylinderGeometry(0.1, 0.1, 0.29, 14)
    g.rotateX(Math.PI / 2)
    return g
  })
  const crossGeo = cachedGeometry('dmm-post-cross-v', () => new THREE.CylinderGeometry(0.045, 0.045, 0.26, 8))
  const domeGeo = cachedGeometry('dmm-post-dome-z', () => {
    const g = new THREE.CylinderGeometry(0.13, 0.16, 0.12, 14)
    g.rotateX(Math.PI / 2)
    return g
  })
  const darkMat = cachedMaterial('dmm-post-dark', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: 0.8, metalness: 0 }),
  )
  const postLabels = ['COM', 'VΩA']
  pins.forEach((p, i) => {
    const insulator = plastic(i === 0 ? 0x1a1a1d : 0xc02020, 0.32)
    const hex = new THREE.Mesh(hexGeo, metal(0xc9ccd1, 0.28))
    hex.position.set(p.x, axisY, plateFront + 0.06)
    statics.push(hex)
    const barrel = new THREE.Mesh(barrelGeo, insulator)
    barrel.position.set(p.x, axisY, plateFront + 0.38)
    statics.push(barrel)
    for (const gz of [0.3, 0.48]) {
      const groove = new THREE.Mesh(grooveGeo, insulator)
      groove.position.set(p.x, axisY, plateFront + gz)
      statics.push(groove)
    }
    const stud = new THREE.Mesh(studGeo, metal(0xd8dadd, 0.25))
    stud.position.set(p.x, axisY, p.z - 0.025)
    statics.push(stud)
    const cross = new THREE.Mesh(crossGeo, darkMat)
    cross.position.set(p.x, axisY, p.z)
    statics.push(cross)
    const dome = new THREE.Mesh(domeGeo, metal(0xd8dadd, 0.25))
    dome.position.set(p.x, axisY, p.z + 0.16)
    statics.push(dome)
    const text = postLabels[i]
    const lblMat = text ? labelMaterial(text, { w: 128, h: 64, fg: i === 1 ? '#8c1f1f' : '#2b2e33' }) : null
    if (lblMat) {
      const lbl = new THREE.Mesh(
        cachedGeometry('dmm-post-lbl', () => new THREE.PlaneGeometry(0.8, 0.36)),
        lblMat,
      )
      // printed inboard of each post at axis height, like the PSU legends
      lbl.position.set(p.x + (i === 0 ? 0.78 : -0.78), axisY, faceZ)
      group.add(lbl)
    }
  })
  for (const m of mergeStatic(statics)) group.add(m)

  const apply = (c2: ComponentInstance, e2: CatalogEntry, line: string | null) => {
    const mode = String(paramOf(c2.params, e2, 'mode') ?? 'V')
    knob.rotation.z = -(MODE_ANGLE[mode] ?? 0) // clockwise angle → negative z-roll
    redraw?.(mode, line)
  }
  apply(comp, entry, null)

  return {
    object: group,
    pinWorld: pins.map((p) => new THREE.Vector3(p.x, TERMINAL_TOP_Y, p.z)),
    update: (c2, e2, telemetry) => {
      const line = telemetry?.text?.[0]
      apply(c2, e2, typeof line === 'string' ? line : null)
    },
  }
}

// ---------------------------------------------------------------------------
// Logic-analyzer probe (IC test hook)
// ---------------------------------------------------------------------------

/**
 * The de-facto logic-analyzer lead colors (resistor color code order, as on
 * Saleae / fx2la harnesses): D0 black … D7 violet, repeating for D8-D15.
 */
export const LOGIC_CHANNEL_COLORS = [
  0x2a2a2d, // black
  0x7a4a26, // brown
  0xd2392e, // red
  0xe8822a, // orange
  0xf0c52c, // yellow
  0x2fa84f, // green
  0x2e62d9, // blue
  0x8a46b0, // violet
]

/** Channel number 0..15 from the 'D0'..'D15' param (malformed → 0). */
export function logicChannelIndex(v: unknown): number {
  const m = /^D?(\d{1,2})$/i.exec(String(v ?? 'D0').trim())
  const n = m ? Number(m[1]) : 0
  return Number.isFinite(n) && n >= 0 ? n % 16 : 0
}

export function buildLogicProbe(
  comp: ComponentInstance,
  entry: CatalogEntry,
  pins: THREE.Vector3[],
): BuildResult {
  const group = new THREE.Group()
  const p = pins[0] ?? new THREE.Vector3()
  const ch = logicChannelIndex(paramOf(comp.params, entry, 'channel'))
  const sleeveColor = LOGIC_CHANNEL_COLORS[ch % 8]

  // fully static → one mesh per material (hook metal / gray hardware / sleeve)
  const statics: THREE.Object3D[] = []

  // sprung grabber hook: out of the hole, a tight curl toward +x, back into
  // the nose — a smaller, finer curl than the scope probe's hook
  statics.push(
    legMesh(
      [
        new THREE.Vector3(p.x, HOLE_DEPTH + 0.04, p.z),
        new THREE.Vector3(p.x, 0.16, p.z),
        new THREE.Vector3(p.x + 0.1, 0.27, p.z),
        new THREE.Vector3(p.x + 0.04, 0.37, p.z),
        new THREE.Vector3(p.x - 0.03, 0.42, p.z - 0.04),
        new THREE.Vector3(p.x - 0.04, 0.56, p.z - 0.1), // buried in the nose
      ],
      0.032,
      metal(0xd8dadd, 0.25),
    ),
  )

  // slim body leaning gently back (−z) — the scope probe leans twice as far
  const lean = new THREE.Group()
  lean.position.set(p.x - 0.03, 0.4, p.z - 0.04)
  lean.rotation.x = -0.32
  const hardware = plastic(0x6d7077, 0.5) // gray nose / flange / plunger

  const nose = new THREE.Mesh(
    cachedGeometry('lp-nose', () => new THREE.CylinderGeometry(0.13, 0.05, 0.42, 12)),
    hardware,
  )
  nose.position.y = 0.21
  lean.add(nose)

  // channel-colored sleeve with two shallow grip rings
  const sleeveMat = plastic(sleeveColor, 0.42)
  const sleeve = new THREE.Mesh(
    cachedGeometry('lp-sleeve', () => new THREE.CylinderGeometry(0.15, 0.14, 1.2, 14)),
    sleeveMat,
  )
  sleeve.position.y = 1.02
  lean.add(sleeve)
  const ringGeo = cachedGeometry('lp-grip-ring', () => new THREE.TorusGeometry(0.15, 0.018, 5, 14))
  for (const ry of [0.62, 0.74]) {
    const ring = new THREE.Mesh(ringGeo, sleeveMat)
    ring.rotation.x = Math.PI / 2
    ring.position.y = ry
    lean.add(ring)
  }

  // finger flange + plunger rod + push cap
  const flange = new THREE.Mesh(
    cachedGeometry('lp-flange', () => new THREE.CylinderGeometry(0.3, 0.3, 0.06, 18)),
    hardware,
  )
  flange.position.y = 1.65
  lean.add(flange)
  const rod = new THREE.Mesh(
    cachedGeometry('lp-rod', () => new THREE.CylinderGeometry(0.06, 0.06, 0.34, 8)),
    metal(0xc9ccd1, 0.3),
  )
  rod.position.y = 1.85
  lean.add(rod)
  const cap = new THREE.Mesh(
    cachedGeometry('lp-cap', () => new THREE.CylinderGeometry(0.17, 0.17, 0.16, 16)),
    hardware,
  )
  cap.position.y = 2.06
  lean.add(cap)

  statics.push(lean) // mergeStatic bakes the lean into the vertices
  for (const m of mergeStatic(statics)) group.add(m)

  return { object: group, pinWorld: pins.map((q) => q.clone()) }
}
