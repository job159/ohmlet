/**
 * Display-module meshes (src/model/parts/displays.parts.ts): SSD1306 0.96"
 * I²C / SPI and SH1106 1.3" OLEDs, LCD1602 / LCD2004 character LCDs (and
 * the LCD1602 on its PCF8574 I²C backpack), ST7735S 1.8" / ILI9341 2.4"
 * SPI TFTs, the MAX7219 8×8 matrix module, an 8-LED WS2812B strip and the
 * TM1637 4-digit module. Registered through registerMeshBuilder.
 *
 * True proportions (millimetres → plan units with MM), on the module frame
 * of displays-module.ts (origin pin 1, +x along the header, +z toward the
 * viewer of the upright picture). Every module is plugged in by a straight
 * male header soldered from the back: black plastic between the breadboard
 * and the PCB, tinned post tips in solder fillets on top — so the PCB
 * floats 2.5 mm above the board (over its front edge for the header-on-top
 * modules, behind it for the MAX7219, as the catalog docs say).
 *
 * Live pixels: per-instance DataTextures (RGBA8, NearestFilter
 * magnification) painted by displays-screens.ts from the part's telemetry
 * — only when the display `version` changes (the TFT model itself
 * snapshots at most every 33 ms of virtual time) — and shown through the
 * EMISSIVE channel of the glass / panel material: OLED pixels emit, the LCD
 * backlight shines through the STN window (and a transflective albedo keeps
 * a yellow-green panel readable when it is off), the TFT glass is dark
 * without its backlight. MAX7219 dots, WS2812B lenses and TM1637 segments
 * are merged lens geometries whose UVs sample one texel each of a tiny
 * level texture (one draw call per module face). No lights, no
 * transmission; WS2812B LEDs get the additive halo sprite of
 * meshes/semis.ts. The '__ghost__' placement preview reuses the shared
 * statics with unlit shared screen materials (no textures, no sprites).
 *
 * Statics (PCB, headers, glass, bezels, packages) are merged once per page
 * per design into one mesh per material (shared resources).
 */
import * as THREE from 'three'
import type { ComponentInstance, ComponentTelemetry, DisplayTelemetry } from '../../../model/types'
import type { CatalogEntry } from '../../../model/catalog'
import { paramOf } from '../../../model/catalog'
import { registerMeshBuilder } from '../registry'
import type { BuildResult } from '../shared'
import { HOLE_DEPTH, cachedGeometry, cachedMaterial, metal, plastic } from '../shared'
import { flatQuadGeometry, slabGeometry, solderMaterial, headerPlasticMaterial } from '../pcb'
import type { PcbArtStyle } from '../pcb'
import { ledLook, ledPerceived, lightOf, makeLedHalo, setHaloColor, type LedHaloRig } from '../led-look'
import { DISPLAY_FULL_LIGHT, displayLensIntensity, makeDisplayGlow, type GlowShape } from '../display-glow'
import {
  LIFT,
  MM,
  PITCH,
  Parts,
  SPACER,
  addHeader,
  addPcb,
  addStatics,
  bandGeometry,
  chipRes,
  coverGlass,
  flexBendGeometry,
  frameGeometry,
  ghostScreen,
  glassEdge,
  innerWallsGeometry,
  matteBlack,
  mlcc,
  paintHeaderPads,
  paintHole,
  pinXs,
  placeModule,
  polyimide,
  screenPlane,
  screenTexture,
  smdBlack,
  staticsOnce,
  tinPlate,
} from './displays-module'
import {
  LCD_PANELS,
  OLED_TEX_H,
  OLED_TEX_W,
  lcdTexSize,
  oledIntensity,
  paintLcd,
  paintMatrix,
  paintOled,
  paintPixels,
  paintSegments,
  paintTft,
  ledAlbedo,
  tftIntensity,
} from './displays-screens'
import type { LcdTexGeom, LcdValues } from './displays-screens'

type V3 = THREE.Vector3

const isGhost = (c: ComponentInstance) => c.id === '__ghost__'

const BLUE_MASK: PcbArtStyle = { mask: '#1a49a6', maskCopper: '#2559b8', pad: '#c3c6c9', silk: '#f2f3ec', drill: '#0b1b40' }
const BLUE_EDGE = 0x173f8f
const GREEN_MASK: PcbArtStyle = { mask: '#1d6a2c', maskCopper: '#287c37', pad: '#c3c6c9', silk: '#eff1e8', drill: '#0b2611' }
const GREEN_EDGE = 0x195a26
const RED_MASK: PcbArtStyle = { mask: '#ab1f1b', maskCopper: '#bd2d27', pad: '#c6c9cc', silk: '#f5f4ee', drill: '#360907' }
const RED_EDGE = 0x951a17
const BLACK_MASK: PcbArtStyle = { mask: '#151517', maskCopper: '#1e1e22', pad: '#c3c6c9', silk: '#efefe8', drill: '#050506' }
const BLACK_EDGE = 0x111113
const FLEX_BLACK: PcbArtStyle = { mask: '#121214', maskCopper: '#1c1c20', pad: '#c9cccf', silk: '#ecece6', drill: '#050505' }
const FLEX_BLACK_EDGE = 0x0f0f11

/** y (plan units) of a module PCB's bottom / top on the standard 2.5 mm header */
const PCB_BOT = SPACER
const yu = (mm: number) => mm * MM

// ======================================================================
// OLED modules (SSD1306 0.96" I²C / SPI, SH1106 1.3")
// ======================================================================

interface OledDesign {
  key: string
  pins: string[]
  /** PCB w × h × t (mm) */
  w: number
  h: number
  t: number
  /** header row distance from the PCB top edge (mm) */
  headerInset: number
  /** glass outline (mm) and its top edge distance from the PCB top edge */
  glassW: number
  glassH: number
  glassTop: number
  /** cover-glass length from the glass top edge (the rest is the COG ledge) */
  coverH: number
  baseT: number
  coverT: number
  /** active area (mm) and its top margin inside the glass */
  aaW: number
  aaH: number
  aaTop: number
  holeD: number
  holeInset: number
}

const OLED_096_I2C: OledDesign = {
  key: 'oled096-i2c',
  pins: ['GND', 'VCC', 'SCL', 'SDA'],
  w: 27.3,
  h: 27.8,
  t: 1.2,
  headerInset: 2.0,
  glassW: 26.7,
  glassH: 19.26,
  glassTop: 7.0,
  coverH: 15.4,
  baseT: 0.7,
  coverT: 0.55,
  aaW: 21.74,
  aaH: 10.86,
  aaTop: 1.9,
  holeD: 2.0,
  holeInset: 2.0,
}
const OLED_096_SPI: OledDesign = { ...OLED_096_I2C, key: 'oled096-spi', pins: ['GND', 'VCC', 'D0', 'D1', 'RES', 'DC', 'CS'] }
const OLED_13_I2C: OledDesign = {
  key: 'oled13-i2c',
  pins: ['VCC', 'GND', 'SCL', 'SDA'],
  w: 35.4,
  h: 33.5,
  t: 1.2,
  headerInset: 2.2,
  glassW: 34.5,
  glassH: 23.0,
  glassTop: 7.8,
  coverH: 19.0,
  baseT: 0.8,
  coverT: 0.6,
  aaW: 29.42,
  aaH: 14.7,
  aaTop: 2.0,
  holeD: 2.2,
  holeInset: 2.2,
}

/** module-frame geometry of an OLED design */
function oledFrame(d: OledDesign) {
  const xh = ((d.pins.length - 1) * PITCH) / 2
  const top = -d.headerInset // PCB top edge (module z)
  const pcbTop = PCB_BOT + d.t
  const glassZ0 = top + d.glassTop
  return {
    cx: xh,
    cz: top + d.h / 2,
    pcbTop,
    glassZ0,
    glassZ1: glassZ0 + d.glassH,
    coverZ1: glassZ0 + d.coverH,
    glassY: pcbTop + 0.1, // double-sided tape
    aaZ: glassZ0 + d.aaTop + d.aaH / 2,
    screenY: pcbTop + 0.1 + d.baseT + d.coverT,
  }
}

function oledStatics(d: OledDesign) {
  return staticsOnce(() => {
    const f = oledFrame(d)
    const parts = new Parts()
    const xs = pinXs(d.pins.length)
    addPcb(parts, {
      key: d.key,
      wMm: d.w,
      hMm: d.h,
      tMm: d.t,
      cx: f.cx,
      cz: f.cz,
      yBotMm: PCB_BOT,
      style: BLUE_MASK,
      edge: BLUE_EDGE,
      paint: (p, at) => {
        // traces from the header down under the glass, a GND pour strip
        const traces: [number, number][][] = xs.map((x, i) => {
          const [bx, bz] = at(x, 0)
          const [, gz] = at(0, f.glassZ0 + 0.5)
          const tx = at(f.cx + (i - (xs.length - 1) / 2) * 1.2, 0)[0]
          return [
            [bx, bz],
            [bx, bz + 2.6],
            [tx, gz - 1.0],
            [tx, gz + 1.5],
          ]
        })
        p.traces(traces, 0.3)
        paintHeaderPads(p, at, xs, 0, { text: d.pins, dz: 2.05, size: 0.92 })
        const hx = d.w / 2 - d.holeInset
        const hz = d.h / 2 - d.holeInset
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) paintHole(p, sx * hx, sz * hz, d.holeD)
        // FPC landing pads at the bottom edge (under the folded flex)
        const [, ez] = at(0, f.glassZ1)
        for (let i = -5; i <= 5; i++) p.padRect(i * 0.9, ez + 2.3, 0.45, 1.4)
      },
    })
    addHeader(parts, xs, 0, PCB_BOT, f.pcbTop)

    // glass: substrate + encapsulation glass (glossy black top), COG driver on the ledge
    const baseY = yu(f.glassY)
    parts.add(slabGeometry(d.glassW * MM, d.baseT * MM, d.glassH * MM, { bottom: true }), glassEdge(), f.cx, baseY + yu(d.baseT) / 2, (f.glassZ0 + f.glassZ1) / 2)
    parts.add(
      slabGeometry(d.glassW * MM - 0.002, d.coverT * MM, d.coverH * MM, { bottom: true }),
      coverGlass(),
      f.cx,
      baseY + yu(d.baseT) + yu(d.coverT) / 2,
      (f.glassZ0 + f.coverZ1) / 2,
    )
    // black print around the active area is the cover glass itself; the bare substrate ledge carries the COG driver
    parts.add(slabGeometry(16.0 * MM, 0.3 * MM, 0.9 * MM, { bottom: true }), smdBlack(), f.cx, baseY + yu(d.baseT) + yu(0.15) + LIFT, (f.coverZ1 + f.glassZ1) / 2 - 0.3)

    // FPC: flat from the glass edge to the PCB edge, then folded round to the back
    const pcbEdge = -d.headerInset + d.h
    const fpcW = 12.0
    parts.add(flatQuadGeometry(fpcW * MM, (pcbEdge - f.glassZ1) * MM), polyimide(), f.cx, yu(f.pcbTop) + 0.003, (f.glassZ1 + pcbEdge) / 2)
    const r = (d.t + 0.25) / 2
    parts.add(flexBendGeometry(fpcW, r), polyimide(), f.cx, yu(PCB_BOT + d.t / 2), pcbEdge)
    // the flex continues under the board (seen from low angles)
    const under = new THREE.Mesh(flatQuadGeometry(fpcW * MM, 6.0 * MM), polyimide())
    under.rotation.x = Math.PI
    parts.obj(under, f.cx, yu(PCB_BOT) - 0.004 - yu(0.12), pcbEdge - 3.0)
    return parts
  })
}

function buildOled(d: OledDesign) {
  const statics = oledStatics(d)
  return (comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult => {
    const group = new THREE.Group()
    placeModule(group, pins, d.pins.length - 1)
    addStatics(group, statics())
    const f = oledFrame(d)
    const ghost = isGhost(comp)
    const tex = ghost ? null : screenTexture(OLED_TEX_W, OLED_TEX_H)
    const screen = ghost
      ? { mesh: new THREE.Mesh(flatQuadGeometry(d.aaW * MM, d.aaH * MM), ghostScreen('oled', 0x040506)), material: null }
      : screenPlane(d.aaW, d.aaH, tex, { base: 0x020203, roughness: 0.28, clearcoat: 0.1 })
    screen.mesh.position.set(f.cx * MM, yu(f.screenY) + 0.002, f.aaZ * MM)
    group.add(screen.mesh)

    let lastVersion = -1
    let lastVariant = ''
    const apply = (c: ComponentInstance, e: CatalogEntry, t: ComponentTelemetry | null) => {
      if (!tex || !screen.material) return
      const variant = String(paramOf(c.params, e, 'color') ?? 'white')
      const disp = t?.display
      const ver = disp ? disp.version : -1
      if (ver !== lastVersion || variant !== lastVariant) {
        lastVersion = ver
        lastVariant = variant
        paintOled(tex.image.data as Uint8Array, disp, variant)
        tex.needsUpdate = true
      }
      screen.material.emissiveIntensity = oledIntensity(disp)
    }
    apply(comp, entry, null)
    return { object: group, pinWorld: pins.map((p) => p.clone()), update: apply }
  }
}

/** top of the OLED meshes (header post tips) in plan units */
export const OLED_TOP = yu(PCB_BOT + 1.2 + 1.8)

// ======================================================================
// Character LCDs (HD44780 16×2 / 20×4, LCD1602 + PCF8574 backpack)
// ======================================================================

interface LcdDesign {
  key: string
  cols: number
  rows: number
  /** PCB (mm) and pin 1's distance from the PCB's left edge */
  w: number
  h: number
  pin1FromLeft: number
  /** bezel outline / height above the PCB top, window (viewing area) */
  bezelW: number
  bezelD: number
  bezelH: number
  winW: number
  winD: number
  /** character pitch (mm) */
  pitchX: number
  pitchY: number
  holeD: number
  holeDX: number
  holeDZ: number
}

const LCD1602: LcdDesign = {
  key: 'lcd1602',
  cols: 16,
  rows: 2,
  w: 80,
  h: 36,
  pin1FromLeft: 8.0,
  bezelW: 71.2,
  bezelD: 24.2,
  bezelH: 7.0,
  winW: 64.5,
  winD: 16.0,
  pitchX: 3.55,
  pitchY: 5.95,
  holeD: 2.5,
  holeDX: 75,
  holeDZ: 31,
}
const LCD2004: LcdDesign = {
  key: 'lcd2004',
  cols: 20,
  rows: 4,
  w: 98,
  h: 60,
  pin1FromLeft: 10.0,
  bezelW: 97.0,
  bezelD: 39.5,
  bezelH: 7.3,
  winW: 76.0,
  winD: 25.2,
  pitchX: 3.55,
  pitchY: 5.35,
  holeD: 3.0,
  holeDX: 93,
  holeDZ: 55,
}

const LCD_PINS = ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K']
const LCD_HEADER_INSET = 2.5

/** texture geometry: texel pitch from the character pitch, margins fill the viewing area */
function lcdTex(d: LcdDesign): { geom: LcdTexGeom; texW: number; texH: number; quadW: number; quadD: number } {
  const tx = d.pitchX / 24 // mm per texel (6 dot slots × 4 texels per character pitch)
  const ty = d.pitchY / 36
  const core = lcdTexSize({ cols: d.cols, rows: d.rows, marginX: 0, marginY: 0 })
  const marginX = Math.max(0, Math.round((d.winW / tx - core.w) / 2))
  const marginY = Math.max(0, Math.round((d.winD / ty - core.h) / 2))
  const geom = { cols: d.cols, rows: d.rows, marginX, marginY }
  const { w, h } = lcdTexSize(geom)
  return { geom, texW: w, texH: h, quadW: w * tx, quadD: h * ty }
}

/** PCB-relative layout: `left` / `top` = PCB left / top edge in the module frame (mm), `yPcb` = PCB bottom (mm). */
interface LcdPlacement {
  left: number
  top: number
  yPcb: number
}

function lcdParts(parts: Parts, d: LcdDesign, pl: LcdPlacement, paintPins: boolean): void {
  const cx = pl.left + d.w / 2
  const cz = pl.top + d.h / 2
  const pcbTop = pl.yPcb + 1.6
  const hz = pl.top + LCD_HEADER_INSET
  const xs = LCD_PINS.map((_, i) => pl.left + d.pin1FromLeft + i * PITCH)
  addPcb(parts, {
    key: `${d.key}${paintPins ? '' : '-bp'}`,
    wMm: d.w,
    hMm: d.h,
    tMm: 1.6,
    cx,
    cz,
    yBotMm: pl.yPcb,
    style: GREEN_MASK,
    edge: GREEN_EDGE,
    paint: (p, at) => {
      // header traces fanning into the bezel area (to the COB controller on the back)
      const tr: [number, number][][] = xs.map((x) => {
        const [bx, bz] = at(x, hz)
        return [
          [bx, bz],
          [bx, bz + 2.2],
        ]
      })
      p.traces(tr, 0.3)
      paintHeaderPads(p, at, xs, hz, paintPins ? { text: LCD_PINS, dz: 1.9, size: 0.72 } : undefined)
      const [p1x, p1z] = at(xs[0] - 1.9, hz)
      p.silkText('1', p1x, p1z, 1.0, { stroke: 0.04 })
      const [p16x, p16z] = at(xs[15] + 2.0, hz)
      p.silkText('16', p16x, p16z, 1.0, { stroke: 0.04 })
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) paintHole(p, (sx * d.holeDX) / 2, (sz * d.holeDZ) / 2, d.holeD)
      // bezel tab slots and the backlight A / K pads at the right end
      for (const sx of [-1, 1]) {
        p.padRect((sx * (d.bezelW - 1.5)) / 2, -d.bezelD / 2 + 2.5, 1.2, 0.6)
        p.padRect((sx * (d.bezelW - 1.5)) / 2, d.bezelD / 2 - 2.5, 1.2, 0.6)
      }
      p.silkRect(0, 0, d.bezelW + 0.8, d.bezelD + 0.8, 0.15)
    },
  })
  addHeader(parts, xs, hz, pl.yPcb, pcbTop, { plasticFromMm: pl.yPcb - SPACER })

  // tin-plated bezel: walls from the PCB, the sheet bent over at the top
  // edge (a 0.5 mm 45° bend that catches the light), frame with the window
  const yTop = pcbTop + d.bezelH
  const bend = 0.5
  parts.add(slabGeometry(d.bezelW * MM, (d.bezelH - bend) * MM, d.bezelD * MM, { top: true, bottom: true }), tinPlate(), cx, yu(pcbTop + (d.bezelH - bend) / 2), cz)
  parts.add(bandGeometry(d.bezelW, d.bezelD, d.bezelW - 2 * bend, d.bezelD - 2 * bend, bend), tinPlate(), cx, yu(yTop - bend), cz)
  parts.add(frameGeometry(d.key, d.bezelW - 2 * bend, d.bezelD - 2 * bend, 0.4, { w: d.winW, d: d.winD }), tinPlate(), cx, yu(yTop - 0.4), cz)
  // window walls down to the polarizer (dark: the glass edge + black LCD frame)
  parts.add(innerWallsGeometry(d.winW, d.winD, 0.9), matteBlack(), cx, yu(yTop - 0.9), cz)
  // twisted mounting tabs at the bezel's foot
  const tab = slabGeometry(2.0 * MM, 0.9 * MM, 0.35 * MM, { bottom: true })
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.add(tab, tinPlate(), cx + (sx * (d.bezelW - 6)) / 2, yu(pcbTop + 0.45), cz + sz * (d.bezelD / 2 + 0.17))
    }
  }
}

function lcdTop(d: LcdDesign, yPcb: number): number {
  return yu(yPcb + 1.6 + d.bezelH)
}

interface LcdRig {
  tex: THREE.DataTexture | null
  material: THREE.MeshPhysicalMaterial | null
  geom: LcdTexGeom
}

/** the panel plane inside the bezel window (per instance) */
function lcdPanel(group: THREE.Group, comp: ComponentInstance, d: LcdDesign, pl: LcdPlacement): LcdRig {
  const t = lcdTex(d)
  const cx = pl.left + d.w / 2
  const cz = pl.top + d.h / 2
  const y = yu(pl.yPcb + 1.6 + d.bezelH - 0.9) + 0.002
  if (isGhost(comp)) {
    const m = new THREE.Mesh(flatQuadGeometry(t.quadW * MM, t.quadD * MM), ghostScreen('lcd', 0x1b2f78))
    m.position.set(cx * MM, y, cz * MM)
    group.add(m)
    return { tex: null, material: null, geom: t.geom }
  }
  const tex = screenTexture(t.texW, t.texH)
  const s = screenPlane(t.quadW, t.quadD, tex, { base: 0x000000, reflect: 0.2, roughness: 0.42, clearcoat: 0 })
  s.mesh.position.set(cx * MM, y, cz * MM)
  group.add(s.mesh)
  return { tex, material: s.material, geom: t.geom }
}

/** repaint + backlight: `bl` = the backlight LED's perceived brightness 0..1 (led-look.ts; a 0/1 bit = off / full) */
function lcdUpdater(rig: LcdRig) {
  let lastVersion = -2
  let lastPanel = ''
  let lastBlink = -1
  return (panelName: string, disp: DisplayTelemetry | undefined, values: Record<string, number> | undefined, bl: number) => {
    if (!rig.tex || !rig.material) return
    const panel = LCD_PANELS[panelName] ?? LCD_PANELS.blue
    const ver = disp ? disp.version : -1
    const blink = values?.blinkPhase ?? 0
    if (ver !== lastVersion || panelName !== lastPanel || blink !== lastBlink) {
      lastVersion = ver
      lastPanel = panelName
      lastBlink = blink
      paintLcd(rig.tex.image.data as Uint8Array, rig.geom, disp, values as LcdValues | undefined, panel)
      rig.tex.needsUpdate = true
      // transflective yellow-green reads by reflected light; the blue STN does not
      rig.material.color.setScalar(panelName === 'yellow-green' ? 0.55 : 0.16)
    }
    const b = Math.min(1, Math.max(0, bl))
    rig.material.emissiveIntensity = b <= 0.005 ? 0 : 0.12 + 0.9 * b
  }
}

function buildLcdParallel(d: LcdDesign) {
  const pl: LcdPlacement = { left: -d.pin1FromLeft, top: -LCD_HEADER_INSET, yPcb: PCB_BOT }
  const statics = staticsOnce(() => {
    const parts = new Parts()
    lcdParts(parts, d, pl, true)
    return parts
  })
  return (comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult => {
    const group = new THREE.Group()
    placeModule(group, pins, 15)
    addStatics(group, statics())
    const rig = lcdPanel(group, comp, d, pl)
    const paint = lcdUpdater(rig)
    const apply = (c: ComponentInstance, e: CatalogEntry, t: ComponentTelemetry | null) => {
      // the backlight is the module LED (A → 100 Ω → LED → K): its sub-circuit current
      // its REAL current / 20 mA, perceived (led-look.ts: one brightness language)
      const led = t?.sub?.LED_BL
      const bl = led && !led.burned ? Math.min(1, ledPerceived(lightOf(led))) : 0
      paint(String(paramOf(c.params, e, 'panel') ?? 'blue'), t?.display, t?.values, bl)
    }
    apply(comp, entry, null)
    return { object: group, pinWorld: pins.map((p) => p.clone()), update: apply }
  }
}

export const LCD1602_TOP = lcdTop(LCD1602, PCB_BOT)
export const LCD2004_TOP = lcdTop(LCD2004, PCB_BOT)

// ---- LCD1602 + PCF8574 backpack ------------------------------------------

/** heights (mm): I²C header plastic under the backpack, backpack PCB, 16-pin header, LCD PCB */
const BP = {
  hdrBot: 5.5,
  pcbBot: 8.0,
  pcbT: 1.6,
  lcdBot: 12.1,
  /** LCD placement in the module frame (left / top edge) */
  lcdLeft: -4.4,
  lcdTop: -2.0,
  /** backpack outline (module frame) */
  x0: -2.0,
  x1: 43.4,
  z0: -1.0,
  z1: 18.0,
  /** trimmer and PCF8574 positions on the backpack underside */
  pot: { x: 33.5, z: 9.5 },
  chip: { x: 20.0, z: 10.0 },
  jumper: { x: 41.0, z: 13.0 },
}
const BP_LCD: LcdPlacement = { left: BP.lcdLeft, top: BP.lcdTop, yPcb: BP.lcdBot }

function backpackStatics() {
  return staticsOnce(() => {
    const parts = new Parts()
    lcdParts(parts, LCD1602, BP_LCD, false)
    const w = BP.x1 - BP.x0
    const h = BP.z1 - BP.z0
    const cx = (BP.x0 + BP.x1) / 2
    const cz = (BP.z0 + BP.z1) / 2
    const i2cXs = pinXs(4)
    addPcb(parts, {
      key: 'pcf8574-backpack',
      wMm: w,
      hMm: h,
      tMm: BP.pcbT,
      cx,
      cz,
      yBotMm: BP.pcbBot,
      style: BLACK_MASK,
      edge: BLACK_EDGE,
      paint: (p, at) => {
        // the 16 LCD pads along the top edge, the I²C pads + labels at the left end
        const lcdXs = LCD_PINS.map((_, i) => BP.lcdLeft + LCD1602.pin1FromLeft + i * PITCH)
        paintHeaderPads(p, at, lcdXs, BP.lcdTop + LCD_HEADER_INSET)
        paintHeaderPads(p, at, i2cXs, 0)
        const lbl = ['GND', 'VCC', 'SDA', 'SCL']
        i2cXs.forEach((x, i) => {
          const [bx, bz] = at(x, 3.3)
          p.silkText(lbl[i], bx, bz, 0.8, { stroke: 0.03, condense: 0.8 })
        })
        p.traces(
          [
            [at(i2cXs[2], 0), at(i2cXs[2], 5.5), at(BP.chip.x - 4, 5.5)],
            [at(i2cXs[3], 0), at(i2cXs[3], 6.5), at(BP.chip.x - 4, 6.5)],
          ],
          0.3,
        )
        const [jx, jz] = at(BP.jumper.x, BP.jumper.z)
        p.silkText('LED', jx, jz + 2.0, 0.8, { stroke: 0.03 })
      },
    })
    // I²C header under the backpack's left end, its pins straight down into the breadboard
    parts.add(
      slabGeometry(4 * PITCH * MM - 0.004, (BP.pcbBot - BP.hdrBot) * MM - 0.004, 2.5 * MM, { top: true, bottom: true }),
      headerPlasticMaterial(),
      (i2cXs[0] + i2cXs[3]) / 2,
      yu((BP.hdrBot + BP.pcbBot) / 2),
      0,
    )
    const pinLen = yu(BP.hdrBot) - HOLE_DEPTH
    const pinGeo = slabGeometry(0.64 * MM, pinLen, 0.64 * MM, { top: true })
    for (const x of i2cXs) parts.add(pinGeo, metal(0xd0d3d6, 0.36), x, HOLE_DEPTH + pinLen / 2, 0)

    // backpack underside (hangs toward the breadboard): PCF8574T SOIC-16, blue trimmer, LED jumper
    const yUnder = yu(BP.pcbBot)
    parts.add(slabGeometry(10.3 * MM, 1.55 * MM, 7.5 * MM, { top: true }), smdBlack(), BP.chip.x, yUnder - yu(0.2) - yu(1.55) / 2, BP.chip.z)
    const lead = slabGeometry(0.42 * MM, 0.2 * MM, 1.1 * MM, { top: true })
    for (let i = 0; i < 8; i++) {
      for (const s of [-1, 1]) {
        parts.add(lead, metal(0xc9ccd0, 0.35), BP.chip.x - 4.445 + i * 1.27, yUnder - yu(0.1), BP.chip.z + s * 4.3)
      }
    }
    parts.add(
      cachedGeometry('displays-trimmer-body', () => new THREE.BoxGeometry(6.6 * MM, 4.2 * MM, 7.0 * MM)),
      plastic(0x2f62d8, 0.45),
      BP.pot.x,
      yUnder - yu(2.1),
      BP.pot.z,
    )
    parts.add(slabGeometry(5.08 * MM, 2.5 * MM, 2.5 * MM, { top: true }), headerPlasticMaterial(), BP.jumper.x, yUnder - yu(1.25), BP.jumper.z)
    parts.add(
      cachedGeometry('displays-jumper-cap', () => new THREE.BoxGeometry(5.0 * MM, 5.6 * MM, 2.4 * MM)),
      plastic(0x1c1c1f, 0.5),
      BP.jumper.x,
      yUnder - yu(2.5 + 2.8),
      BP.jumper.z,
    )
    return parts
  })
}

const BACKPACK_STATICS = backpackStatics()

function buildLcd1602I2c(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  placeModule(group, pins, 3)
  addStatics(group, BACKPACK_STATICS())
  const rig = lcdPanel(group, comp, LCD1602, BP_LCD)
  const paint = lcdUpdater(rig)
  // the trimmer's screw (faces the breadboard): turned by the 'contrast' runtime parameter
  const screw = new THREE.Mesh(
    cachedGeometry('displays-trimmer-screw', () => {
      const g = new THREE.BoxGeometry(3.2 * MM, 0.3 * MM, 0.7 * MM)
      return g
    }),
    metal(0xd8c58e, 0.3),
  )
  screw.position.set(BP.pot.x * MM, yu(BP.pcbBot - 4.2 - 0.2 - 0.15), BP.pot.z * MM)
  group.add(screw)
  const apply = (c: ComponentInstance, e: CatalogEntry, t: ComponentTelemetry | null) => {
    const pos = Number(paramOf(c.params, e, 'contrast') ?? 0.85)
    screw.rotation.y = (Number.isFinite(pos) ? pos : 0.85) * Math.PI * 1.5 - Math.PI * 0.75
    const disp = t?.display
    // the P3 bit's level (a PWM'd backlight averages): its light, perceived (led-look.ts)
    paint(String(paramOf(c.params, e, 'panel') ?? 'blue'), disp, t?.values, ledPerceived(Math.min(1, disp?.backlight ?? 0)))
  }
  apply(comp, entry, null)
  return { object: group, pinWorld: pins.map((p) => p.clone()), update: apply }
}

export const LCD1602_I2C_TOP = lcdTop(LCD1602, BP.lcdBot)

// ======================================================================
// SPI TFTs (ST7735S 1.8" 128×160, ILI9341 2.4" 240×320)
// ======================================================================

interface TftDesign {
  key: string
  pins: string[]
  w: number
  h: number
  /** backlight frame (white) outline / height, its top edge from the PCB top edge */
  frameW: number
  frameH: number
  frameT: number
  frameTop: number
  /** LCD glass inset in the frame, thickness */
  glassInset: number
  glassT: number
  /** optional resistive touch layer (thickness, length from the glass top) */
  touchT: number
  touchH: number
  /** active area and its top margin inside the glass */
  aaW: number
  aaH: number
  aaTop: number
  texW: number
  texH: number
  label: string
}

const ST7735: TftDesign = {
  key: 'st7735',
  pins: ['GND', 'VCC', 'SCL', 'SDA', 'RES', 'DC', 'CS', 'BL'],
  w: 34.0,
  h: 56.0,
  frameW: 34.0,
  frameH: 45.8,
  frameT: 1.9,
  frameTop: 9.8,
  glassInset: 0.3,
  glassT: 0.5,
  touchT: 0,
  touchH: 0,
  aaW: 28.03,
  aaH: 35.04,
  aaTop: 2.4,
  texW: 128,
  texH: 160,
  label: '1.8 TFT SPI 128*160',
}
const ILI9341: TftDesign = {
  key: 'ili9341',
  pins: ['VCC', 'GND', 'CS', 'RESET', 'DC', 'SDI', 'SCK', 'LED', 'SDO', 'T_CLK', 'T_CS', 'T_DIN', 'T_DO', 'T_IRQ'],
  w: 42.72,
  h: 77.1,
  frameW: 42.72,
  frameH: 60.26,
  frameT: 2.3,
  frameTop: 10.0,
  glassInset: 0.35,
  glassT: 0.5,
  touchT: 0.6,
  touchH: 55.0,
  aaW: 36.72,
  aaH: 48.96,
  aaTop: 3.2,
  texW: 240,
  texH: 320,
  label: '2.4 TFT SPI 240*320',
}

const TFT_HEADER_INSET = 2.5

function tftFrame(d: TftDesign) {
  const xh = ((d.pins.length - 1) * PITCH) / 2
  const top = -TFT_HEADER_INSET
  const pcbTop = PCB_BOT + 1.6
  const z0 = top + d.frameTop
  const glassY = pcbTop + 0.1 + d.frameT
  return {
    cx: xh,
    cz: top + d.h / 2,
    pcbTop,
    frameZ0: z0,
    frameZ1: z0 + d.frameH,
    glassY,
    aaZ: z0 + d.glassInset + d.aaTop + d.aaH / 2,
    screenY: glassY + d.glassT + d.touchT,
  }
}

function tftStatics(d: TftDesign) {
  return staticsOnce(() => {
    const f = tftFrame(d)
    const parts = new Parts()
    const xs = pinXs(d.pins.length)
    const pcbEdge = -TFT_HEADER_INSET + d.h
    addPcb(parts, {
      key: d.key,
      wMm: d.w,
      hMm: d.h,
      tMm: 1.6,
      cx: f.cx,
      cz: f.cz,
      yBotMm: PCB_BOT,
      style: RED_MASK,
      edge: RED_EDGE,
      pxPerMm: d.w > 40 ? 26 : 32,
      paint: (p, at) => {
        const traces: [number, number][][] = xs.map((x) => {
          const [bx, bz] = at(x, 0)
          return [
            [bx, bz],
            [bx, bz + 4.0],
            [bx * 0.8, at(0, f.frameZ0)[1] + 0.8],
          ]
        })
        p.traces(traces, 0.28)
        paintHeaderPads(p, at, xs, 0, { text: d.pins, dz: 2.1, size: d.pins.length > 8 ? 0.62 : 0.85 })
        // regulator / backlight-switch land patterns between the header and the panel
        for (const [x, z] of tftSmd(d, f)) p.padRect(...at(x, z), 0.9, 0.8)
        // mounting holes at the header corners (and the far corners of the long module)
        const hx = d.w / 2 - 2.6
        paintHole(p, -hx, -d.h / 2 + 2.6, 2.6)
        paintHole(p, hx, -d.h / 2 + 2.6, 2.6)
        if (d.touchT > 0) {
          paintHole(p, -hx, d.h / 2 - 2.6, 2.6)
          paintHole(p, hx, d.h / 2 - 2.6, 2.6)
          // the SD-card socket's header pads on the far edge (unpopulated)
          const sd = ['SD_CS', 'SD_MOSI', 'SD_MISO', 'SD_SCK']
          sd.forEach((s, i) => {
            const x = f.cx + (i - 1.5) * PITCH
            const [bx, bz] = at(x, pcbEdge - 2.6)
            p.padCircle(bx, bz, 0.85)
            p.via(bx, bz, 0.5)
            p.silkText(s, bx, bz - 2.0, 0.55, { stroke: 0.02, condense: 0.7 })
          })
        }
        const [lx, lz] = at(f.cx, f.frameZ0 - 1.0)
        p.silkText(d.label, lx, lz, 0.8, { stroke: 0.03 })
      },
    })
    addHeader(parts, xs, 0, PCB_BOT, f.pcbTop)

    // white backlight frame (molded), black LCD glass on top, optional touch film
    const y0 = yu(f.pcbTop + 0.1)
    const zc = (f.frameZ0 + f.frameZ1) / 2
    parts.add(slabGeometry(d.frameW * MM, d.frameT * MM, d.frameH * MM, { bottom: true }), plastic(0xeceae4, 0.5), f.cx, y0 + yu(d.frameT) / 2, zc)
    const gw = d.frameW - 2 * d.glassInset
    const gd = d.frameH - 2 * d.glassInset
    parts.add(slabGeometry(gw * MM, d.glassT * MM, gd * MM, { bottom: true }), coverGlass(), f.cx, yu(f.glassY + d.glassT / 2), zc)
    if (d.touchT > 0) {
      const tz0 = f.frameZ0 + d.glassInset
      parts.add(
        slabGeometry(gw * MM - 0.004, d.touchT * MM, d.touchH * MM, { bottom: true }),
        coverGlass(),
        f.cx,
        yu(f.glassY + d.glassT + d.touchT / 2),
        tz0 + d.touchH / 2,
      )
      // touch FPC leaving the panel's far end
      parts.add(flatQuadGeometry(8 * MM, (gd - d.touchH) * MM), polyimide(), f.cx + 9, yu(f.glassY + d.glassT) + 0.002, tz0 + d.touchH + (gd - d.touchH) / 2)
    }
    // COG driver under black tape on the ledge (the glass end below the active area)
    const ledgeZ = f.frameZ0 + d.glassInset + d.aaTop + d.aaH + 3.0
    parts.add(slabGeometry(d.aaW * 0.7 * MM, 0.15 * MM, 2.6 * MM, { bottom: true }), matteBlack(), f.cx, yu(f.glassY + d.glassT + 0.075) + LIFT, ledgeZ)
    // main FPC: out of the panel's far edge, folded round the PCB edge (ST7735) or soldered on the front (ILI9341)
    const fpcW = d.touchT > 0 ? 26 : 20
    if (d.touchT > 0) {
      parts.add(flatQuadGeometry(fpcW * MM, 3.0 * MM), polyimide(), f.cx, yu(f.pcbTop) + 0.003, f.frameZ1 + 1.5)
      parts.add(slabGeometry(fpcW * MM, 0.35 * MM, 0.9 * MM, { bottom: true }), solderMaterial(), f.cx, yu(f.pcbTop + 0.17), f.frameZ1 + 2.6)
    } else {
      parts.add(flatQuadGeometry(fpcW * MM, (pcbEdge - f.frameZ1) * MM), polyimide(), f.cx, yu(f.pcbTop) + 0.003, (f.frameZ1 + pcbEdge) / 2)
      parts.add(flexBendGeometry(fpcW, 0.95), polyimide(), f.cx, yu(PCB_BOT + 0.8), pcbEdge)
    }
    // SOT-23 regulator / backlight switch + 0603 parts near the header
    const smd = tftSmd(d, f)
    smd.forEach(([x, z], i) => {
      if (i % 3 === 0) {
        parts.add(slabGeometry(2.9 * MM, 1.0 * MM, 1.3 * MM, { bottom: true }), smdBlack(), x + 0.6, yu(f.pcbTop + 0.5) + LIFT, z)
      } else {
        parts.add(slabGeometry(1.6 * MM, 0.5 * MM, 0.8 * MM, { bottom: true }), i % 3 === 1 ? mlcc() : chipRes(), x, yu(f.pcbTop + 0.25) + LIFT, z)
      }
    })
    return parts
  })
}

/** SMD land positions (module mm) between the header row and the panel. */
function tftSmd(d: TftDesign, f: ReturnType<typeof tftFrame>): [number, number][] {
  void f
  const z = 4.4
  const span = (d.pins.length - 1) * PITCH
  const xs = [0.12, 0.3, 0.42, 0.62, 0.78, 0.9].map((k) => k * span)
  return xs.map((x) => [x, z])
}

function buildTft(d: TftDesign) {
  const statics = tftStatics(d)
  return (comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult => {
    const group = new THREE.Group()
    placeModule(group, pins, d.pins.length - 1)
    addStatics(group, statics())
    const f = tftFrame(d)
    const ghost = isGhost(comp)
    const tex = ghost ? null : screenTexture(d.texW, d.texH)
    const screen = ghost
      ? { mesh: new THREE.Mesh(flatQuadGeometry(d.aaW * MM, d.aaH * MM), ghostScreen('tft', 0x08090a)), material: null }
      : screenPlane(d.aaW, d.aaH, tex, { base: 0x030304, roughness: 0.34, clearcoat: 0.08 })
    screen.mesh.position.set(f.cx * MM, yu(f.screenY) + 0.002, f.aaZ * MM)
    group.add(screen.mesh)
    let lastVersion = -2
    const apply = (_c: ComponentInstance, _e: CatalogEntry, t: ComponentTelemetry | null) => {
      if (!tex || !screen.material) return
      const disp = t?.display
      const ver = disp ? disp.version : -1
      if (ver !== lastVersion) {
        lastVersion = ver
        paintTft(tex.image.data as Uint8Array, d.texW, d.texH, disp)
        tex.needsUpdate = true
      }
      screen.material.emissiveIntensity = tftIntensity(disp)
    }
    apply(comp, entry, null)
    return { object: group, pinWorld: pins.map((p) => p.clone()), update: apply }
  }
}

/** the COG driver strip on the glass ledge is the highest point of the ST7735 (no touch layer) */
export const ST7735_TOP = yu(PCB_BOT + 1.6 + 0.1 + ST7735.frameT + ST7735.glassT + 0.15) + LIFT
export const ILI9341_TOP = yu(PCB_BOT + 1.6 + 0.1 + ILI9341.frameT + ILI9341.glassT + ILI9341.touchT) + 0.002

// ======================================================================
// MAX7219 8×8 matrix module (DIP kit: input header at the bottom edge)
// ======================================================================

const MX = {
  w: 32.0,
  h: 50.0,
  /** input header distance from the bottom (+z) edge */
  inset: 2.5,
  /** 1088AS block: 32 × 32 × 7 mm on 8.5 mm female headers */
  block: 32.0,
  blockT: 7.0,
  femaleH: 8.5,
  /** block centre (module z) */
  bz: -26.3,
  dotPitch: 4.0,
  dotD: 3.0,
}
const MX_PINS = ['VCC', 'GND', 'DIN', 'CS', 'CLK']
const MX_CX = 2 * PITCH
const MX_PCB_TOP = PCB_BOT + 1.6
const MX_BLOCK_Y = MX_PCB_TOP + MX.femaleH

function max7219Statics() {
  return staticsOnce(() => {
    const parts = new Parts()
    const xs = pinXs(5)
    const cz = MX.inset - MX.h / 2
    const outZ = MX.inset - MX.h + 2.5
    addPcb(parts, {
      key: 'max7219',
      wMm: MX.w,
      hMm: MX.h,
      tMm: 1.6,
      cx: MX_CX,
      cz,
      yBotMm: PCB_BOT,
      style: BLUE_MASK,
      edge: BLUE_EDGE,
      paint: (p, at) => {
        paintHeaderPads(p, at, xs, 0, { text: MX_PINS, dz: -2.15, size: 0.95 })
        // output header pads (DOUT end, unpopulated)
        const outLbl = ['VCC', 'GND', 'DOUT', 'CS', 'CLK']
        xs.forEach((x, i) => {
          const [bx, bz] = at(x, outZ)
          p.padCircle(bx, bz, 0.85)
          p.via(bx, bz, 0.5)
          p.silkText(outLbl[i], bx, bz + 1.8, 0.8, { stroke: 0.03, condense: 0.8 })
        })
        // parts zone silkscreen: C1 C2 R1 outlines
        const c1 = at(-3.0, -6.6)
        p.silkStadium(c1[0], c1[1], 5.6, 5.6)
        p.silkText('C1', c1[0] - 4.2, c1[1], 0.85, { stroke: 0.03 })
        const c2 = at(5.08, -6.8)
        p.silkRect(c2[0], c2[1], 4.4, 2.6)
        p.silkText('C2', c2[0], c2[1] + 2.2, 0.85, { stroke: 0.03 })
        const r1 = at(12.6, -6.8)
        p.silkRect(r1[0], r1[1], 7.4, 2.6)
        p.silkText('R1', r1[0], r1[1] + 2.2, 0.85, { stroke: 0.03 })
        // traces from the input header up into the IC area
        p.traces(
          xs.map((x, i) => [at(x, 0), at(x, -2.8), at(MX_CX + (i - 2) * 3.0, -10.2)]),
          0.35,
        )
        // DIP-24 socket outline + matrix outline under the block
        const ic = at(MX_CX, MX.bz)
        p.silkRect(ic[0], ic[1], 8.6, 31.0)
        for (const sx of [-1, 1]) {
          const fh = at(MX_CX + sx * 13.97, MX.bz)
          p.silkRect(fh[0], fh[1], 2.8, 20.8)
        }
      },
    })
    addHeader(parts, xs, 0, PCB_BOT, MX_PCB_TOP)
    const top = yu(MX_PCB_TOP)
    // female headers (2 × 1×8) along the block's left / right edges
    for (const sx of [-1, 1]) {
      parts.add(slabGeometry(2.5 * MM, MX.femaleH * MM, 20.3 * MM, { bottom: true }), headerPlasticMaterial(), MX_CX + sx * 13.97, top + yu(MX.femaleH) / 2, MX.bz)
    }
    // DIP-24 MAX7219 under the block (seen from low angles): body + 2 × 12 legs
    parts.add(slabGeometry(6.6 * MM, 3.3 * MM, 30.5 * MM, { bottom: true }), plastic(0x18181a, 0.45), MX_CX, top + yu(0.5 + 1.65), MX.bz)
    const leg = slabGeometry(0.3 * MM, 0.9 * MM, 0.5 * MM, { bottom: true })
    for (let i = 0; i < 12; i++) {
      for (const s of [-1, 1]) parts.add(leg, metal(0xcfd2d6, 0.32), MX_CX + s * 3.45, top + yu(0.45), MX.bz + (i - 5.5) * PITCH)
    }
    // the 1088AS block: black epoxy, a darker satin face carries the dots
    const bt = MX.blockT
    parts.add(slabGeometry(MX.block * MM, bt * MM, MX.block * MM, { bottom: true }), plastic(0x101012, 0.62), MX_CX, yu(MX_BLOCK_Y + bt / 2), MX.bz)
    // C1 10 µF electrolytic (standing), C2 100 nF MLCC (radial, yellow epoxy), R1 10 kΩ (lying)
    parts.add(
      cachedGeometry('displays-ecap', () => new THREE.CylinderGeometry(2.5 * MM, 2.5 * MM, 11 * MM, 16)),
      plastic(0x1d2d6b, 0.42),
      -3.0,
      top + yu(5.5 + 0.4),
      -6.6,
    )
    parts.add(
      cachedGeometry('displays-ecap-top', () => {
        const g = new THREE.CircleGeometry(2.3 * MM, 16)
        g.rotateX(-Math.PI / 2)
        return g
      }),
      metal(0xb3b6ba, 0.8),
      -3.0,
      top + yu(11.4) + 0.002,
      -6.6,
    )
    parts.add(
      cachedGeometry('displays-mlcc-radial', () => {
        const g = new THREE.SphereGeometry(1.0, 12, 8)
        g.scale(2.0 * MM, 2.2 * MM, 1.2 * MM)
        return g
      }),
      plastic(0xd9a62a, 0.4),
      5.08,
      top + yu(3.4),
      -6.8,
    )
    parts.add(
      cachedGeometry('displays-axial-r', () => {
        const g = new THREE.CapsuleGeometry(1.15 * MM, 4.0 * MM, 4, 10)
        g.rotateZ(Math.PI / 2)
        return g
      }),
      plastic(0xcdb48c, 0.5),
      12.6,
      top + yu(1.4),
      -6.8,
    )
    for (const s of [-1, 1]) {
      parts.add(slabGeometry(1.2 * MM, 0.5 * MM, 0.5 * MM), metal(0xd0d3d6, 0.35), 12.6 + s * 3.4, top + yu(1.3), -6.8)
    }
    return parts
  })
}

const MAX7219_STATICS = max7219Statics()

/** 64 dot lenses on the block face, each with all UVs at its level-texel centre (column c, row r). */
function matrixDotsGeometry(): THREE.BufferGeometry {
  return cachedGeometry('displays-matrix-dots', () => {
    const pos: number[] = []
    const uv: number[] = []
    const seg = 12
    const r = (MX.dotD / 2) * MM
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const x = MX_CX * MM + (col - 3.5) * MX.dotPitch * MM
        const z = MX.bz * MM + (row - 3.5) * MX.dotPitch * MM
        const u = (col + 0.5) / 8
        const v = (row + 0.5) / 8
        for (let k = 0; k < seg; k++) {
          const a0 = (k / seg) * Math.PI * 2
          const a1 = ((k + 1) / seg) * Math.PI * 2
          // CCW seen from +y: centre, a0, a1 (x = cos, z = −sin)
          pos.push(x, 0, z, x + Math.cos(a0) * r, 0, z - Math.sin(a0) * r, x + Math.cos(a1) * r, 0, z - Math.sin(a1) * r)
          uv.push(u, v, u, v, u, v)
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.computeVertexNormals()
    return g
  })
}

function levelTexture(w: number, h: number): THREE.DataTexture {
  const t = screenTexture(w, h, false)
  t.minFilter = THREE.NearestFilter
  return t
}

/**
 * Per-instance LED face material: emission sampled per lens from `emis`,
 * the diffuser's albedo pulled down where a lens is lit (`albedo`, see
 * ledAlbedo) so a lit segment reads as light, not as a pale painted shape.
 */
function ledFaceMaterial(
  emis: THREE.DataTexture,
  albedo: THREE.DataTexture,
  opts: { color: number; emissive: number; intensity: number; roughness: number; clearcoat?: number },
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: opts.color,
    map: albedo,
    roughness: opts.roughness,
    metalness: 0,
    clearcoat: opts.clearcoat ?? 0,
    clearcoatRoughness: 0.2,
    emissive: opts.emissive,
    emissiveIntensity: opts.intensity,
    emissiveMap: emis,
    // a lit lens shows its own light, not a mirror of the room (the albedo map's alpha, ledAlbedo)
    specularIntensityMap: albedo,
  })
}

function refreshAlbedo(albedo: THREE.DataTexture, emis: THREE.DataTexture): void {
  ledAlbedo(albedo.image.data as Uint8Array, emis.image.data as Uint8Array)
  albedo.needsUpdate = true
}

function buildMax7219(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  placeModule(group, pins, 4)
  addStatics(group, MAX7219_STATICS())
  const ghost = isGhost(comp)
  const tex = ghost ? null : levelTexture(8, 8)
  const alb = ghost ? null : levelTexture(8, 8)
  // unlit dot: the milky diffuser of the 1088AS; lit: red emission sampled per dot
  const material =
    ghost || !tex || !alb
      ? cachedMaterial('displays-matrix-dot-ghost', () => new THREE.MeshPhysicalMaterial({ color: 0xcdc2bd, roughness: 0.55, metalness: 0 }))
      : ledFaceMaterial(tex, alb, { color: 0xcdc2bd, emissive: 0xff1608, intensity: 0, roughness: 0.55 })
  const dots = new THREE.Mesh(matrixDotsGeometry(), material)
  dots.position.y = yu(MX_BLOCK_Y + MX.blockT) + 0.002
  group.add(dots)
  // glow (one LED language, display-glow.ts): the lit dots' light on the black block face
  const half = (MX.block / 2) * MM
  const glow = ghost
    ? null
    : makeDisplayGlow({
        x0: MX_CX * MM - half,
        x1: MX_CX * MM + half,
        z0: MX.bz * MM - half,
        z1: MX.bz * MM + half,
        y: yu(MX_BLOCK_Y + MX.blockT) + 0.004,
        shapes: matrixDotShapes(),
        color: 0xff2010,
        pxPerUnit: 18,
      })
  if (glow?.mesh) group.add(glow.mesh)
  const levels = new Float32Array(64)
  let lastVersion = -2
  const apply = (_c: ComponentInstance, _e: CatalogEntry, t: ComponentTelemetry | null) => {
    if (!tex) return
    const disp = t?.display
    const ver = disp ? disp.version : -1
    if (ver === lastVersion) return
    lastVersion = ver
    const lit = paintMatrix(tex.image.data as Uint8Array, disp)
    tex.needsUpdate = true
    if (alb) refreshAlbedo(alb, tex)
    // the programmed brightness (PWM × multiplex duty, the model's) through the LEDs' curve
    const p = lit > 0 && disp ? ledPerceived(Math.max(0, disp.contrast ?? 1) * DISPLAY_FULL_LIGHT) : 0
    ;(material as THREE.MeshPhysicalMaterial).emissiveIntensity = displayLensIntensity(ledLook(p))
    const d = tex.image.data as Uint8Array
    for (let i = 0; i < 64; i++) levels[i] = d[i * 4] > 0 ? 1 : 0
    glow?.apply(levels, p)
  }
  apply(comp, entry, null)
  return { object: group, pinWorld: pins.map((p) => p.clone()), update: apply }
}

export const MAX7219_TOP = yu(MX_BLOCK_Y + MX.blockT) + 0.002

/** the 64 dots as glow shapes, in texel order (row r, column c → index 8r + c) */
function matrixDotShapes(): GlowShape[] {
  const out: GlowShape[] = []
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++)
      out.push({
        cx: MX_CX * MM + (col - 3.5) * MX.dotPitch * MM,
        cz: MX.bz * MM + (row - 3.5) * MX.dotPitch * MM,
        r: (MX.dotD / 2) * MM,
      })
  return out
}

// ======================================================================
// WS2812B 8-LED strip (input pads 5V GND DIN at the left end, DOUT right)
// ======================================================================

const WS = {
  len: 61.0,
  width: 10.0,
  t: 0.2,
  cx: 29.21,
  ledX0: 9.0,
  ledPitch: 6.4,
  led: 5.0,
  ledT: 1.6,
  lensD: 3.7,
  /** trimmed header tips above the strip (mm) */
  proud: 1.0,
}
const WS_XS = [0, PITCH, 2 * PITCH, 23 * PITCH]
/** a WS2812B pixel's glow size (× the 5 mm LED's): its 3.7 mm lens, a little under a T-1¾ dome */
const WS_GLOW_SIZE = 0.75
const WS_TOP_Y = PCB_BOT + WS.t

function ws2812Statics() {
  return staticsOnce(() => {
    const parts = new Parts()
    addPcb(parts, {
      key: 'ws2812-strip',
      wMm: WS.len,
      hMm: WS.width,
      tMm: WS.t,
      cx: WS.cx,
      cz: 0,
      yBotMm: PCB_BOT,
      style: FLEX_BLACK,
      edge: FLEX_BLACK_EDGE,
      pxPerMm: 22,
      paint: (p, at) => {
        // copper bus under the white mask, LED land patterns, end pads + legends
        p.traces(
          [
            [at(0, -3.4), at(WS.len - 2, -3.4)],
            [at(PITCH, 3.4), at(WS.len - 2, 3.4)],
          ],
          1.1,
        )
        for (let i = 0; i < 8; i++) {
          const [lx, lz] = at(WS.ledX0 + i * WS.ledPitch, 0)
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.padRect(lx + sx * 2.45, lz + sz * 1.6, 1.0, 1.0)
        }
        WS_XS.forEach((x) => {
          const [bx, bz] = at(x, 0)
          p.padRect(bx, bz, 1.9, 2.6)
        })
        const lbl = ['5V', 'GND', 'DIN']
        lbl.forEach((s, i) => {
          const [bx, bz] = at(WS_XS[i], 0)
          p.silkText(s, bx, bz + 2.7, 0.8, { stroke: 0.03, condense: 0.8 })
        })
        const [dx, dz] = at(WS_XS[3], 0)
        p.silkText('DO', dx, dz + 2.7, 0.8, { stroke: 0.03 })
        const [ax, az] = at(WS.cx, 4.2)
        p.silkText('WS2812B  DIN >> DO', ax, az, 0.8, { stroke: 0.03 })
      },
    })
    addHeader(parts, WS_XS, 0, PCB_BOT, WS_TOP_Y, { proudMm: WS.proud })
    // 5050 packages: white body, the lens is per instance (it lights)
    const body = slabGeometry(WS.led * MM, WS.ledT * MM, WS.led * MM, { bottom: true })
    for (let i = 0; i < 8; i++) {
      parts.add(body, plastic(0xf3f2ec, 0.42), WS.ledX0 + i * WS.ledPitch, yu(WS_TOP_Y + WS.ledT / 2) + LIFT, 0)
      // the leads' solder joints at the package corners
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          parts.add(slabGeometry(0.6 * MM, 0.35 * MM, 0.9 * MM, { bottom: true }), solderMaterial(), WS.ledX0 + i * WS.ledPitch + sx * 2.7, yu(WS_TOP_Y + 0.17), sz * 1.6)
        }
      }
    }
    return parts
  })
}

const WS2812_STATICS = ws2812Statics()

/** 8 lens discs (one texel each of an 8 × 1 colour texture) + the die cluster under each. */
function wsLensGeometry(): THREE.BufferGeometry {
  return cachedGeometry('displays-ws-lenses', () => {
    const pos: number[] = []
    const uv: number[] = []
    const seg = 16
    const r = (WS.lensD / 2) * MM
    for (let i = 0; i < 8; i++) {
      const x = (WS.ledX0 + i * WS.ledPitch) * MM
      const u = (i + 0.5) / 8
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2
        const a1 = ((k + 1) / seg) * Math.PI * 2
        pos.push(x, 0, 0, x + Math.cos(a0) * r, 0, -Math.sin(a0) * r, x + Math.cos(a1) * r, 0, -Math.sin(a1) * r)
        uv.push(u, 0.5, u, 0.5, u, 0.5)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.computeVertexNormals()
    return g
  })
}

function buildWs2812(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  placeModule(group, pins, 3)
  addStatics(group, WS2812_STATICS())
  const ghost = isGhost(comp)
  const tex = ghost ? null : levelTexture(8, 1)
  const alb = ghost ? null : levelTexture(8, 1)
  const material =
    ghost || !tex || !alb
      ? cachedMaterial('displays-ws-lens-ghost', () => new THREE.MeshPhysicalMaterial({ color: 0xd8cdae, roughness: 0.22, metalness: 0, clearcoat: 0.6 }))
      : ledFaceMaterial(tex, alb, { color: 0xd8cdae, emissive: 0xffffff, intensity: 2.2, roughness: 0.22, clearcoat: 0.6 })
  const lens = new THREE.Mesh(wsLensGeometry(), material)
  lens.position.y = yu(WS_TOP_Y + WS.ledT) + LIFT + 0.002
  group.add(lens)
  // the three dies + IC seen through the clear resin (static dark specks)
  const dies = new THREE.Mesh(
    cachedGeometry('displays-ws-dies', () => {
      const parts: THREE.BufferGeometry[] = []
      for (let i = 0; i < 8; i++) {
        const g = new THREE.PlaneGeometry(0.9 * MM, 0.5 * MM)
        g.rotateX(-Math.PI / 2)
        g.translate((WS.ledX0 + i * WS.ledPitch - 0.6) * MM, 0, 0.5 * MM)
        parts.push(g)
      }
      return mergeFlat(parts)
    }),
    cachedMaterial('displays-ws-die', () => new THREE.MeshPhysicalMaterial({ color: 0x3a3630, roughness: 0.4, metalness: 0.2 })),
  )
  dies.position.y = lens.position.y + 0.002
  group.add(dies)
  // the shared LED glow halo per pixel (led-look.ts: one brightness language
  // with every LED; the texture is null in node, the sprites still carry the state)
  const glows: LedHaloRig[] = []
  const hue = new THREE.Color()
  if (!ghost) {
    for (let i = 0; i < 8; i++) {
      // (the hue is the pixel's, set per update; a saturated placeholder keeps the white-LED boost off)
      const rig = makeLedHalo({ color: 0xff0000, at: new THREE.Vector3((WS.ledX0 + i * WS.ledPitch) * MM, yu(WS_TOP_Y + WS.ledT) + 0.25, 0), size: WS_GLOW_SIZE })
      group.add(rig.halo)
      glows.push(rig)
    }
  }
  let lastSig = '#init' // never a real signature: the first apply paints (albedo included)
  const apply = (_c: ComponentInstance, _e: CatalogEntry, t: ComponentTelemetry | null) => {
    if (!tex) return
    const rgb = t?.rgb
    const sig = rgb ? rgb.join(',') : ''
    if (sig === lastSig) return
    lastSig = sig
    const data = tex.image.data as Uint8Array
    paintPixels(data, rgb, 8)
    tex.needsUpdate = true
    if (alb) refreshAlbedo(alb, tex)
    glows.forEach((rig, i) => {
      // the latched PWM level of the brightest channel is the pixel's light
      // (0..1 of full); its hue, normalised, is the glow's colour
      const v = rgb?.[i] ?? 0
      const m = Math.max((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff) / 255
      const mx = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
      if (m > 0 && mx > 0) {
        hue.setRGB(data[i * 4] / mx, data[i * 4 + 1] / mx, data[i * 4 + 2] / mx, THREE.SRGBColorSpace)
        setHaloColor(rig, hue)
      }
      rig.apply(ledPerceived(m))
    })
  }
  apply(comp, entry, null)
  return { object: group, pinWorld: pins.map((p) => p.clone()), update: apply }
}

/** merge plain (non-indexed / indexed mixed) planes */
function mergeFlat(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  for (const g0 of gs) {
    const g = g0.index ? g0.toNonIndexed() : g0
    const p = g.getAttribute('position') as THREE.BufferAttribute
    const u = g.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
      uv.push(u.getX(i), u.getY(i))
    }
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  out.computeVertexNormals()
  return out
}

export const WS2812_TOP = yu(WS_TOP_Y + WS.ledT) + LIFT + 0.004

// ======================================================================
// TM1637 4-digit module (0.36" clock display: 4 digits + colon)
// ======================================================================

const TM = {
  w: 42.0,
  h: 24.0,
  inset: 2.0,
  dispW: 30.0,
  dispD: 14.0,
  dispT: 7.2,
  /** display centre (module z) */
  dz: 11.0,
  digitH: 9.14,
  digitW: 4.6,
  seg: 0.9,
  slant: Math.tan((8 * Math.PI) / 180),
  digitX: [-11.1, -3.7, 3.7, 11.1],
}
const TM_PINS = ['CLK', 'DIO', 'VCC', 'GND']
const TM_CX = 1.5 * PITCH
const TM_FACE_Y = PCB_BOT + 1.6 + TM.dispT

function tm1637Statics() {
  return staticsOnce(() => {
    const parts = new Parts()
    const xs = pinXs(4)
    addPcb(parts, {
      key: 'tm1637',
      wMm: TM.w,
      hMm: TM.h,
      tMm: 1.6,
      cx: TM_CX,
      cz: -TM.inset + TM.h / 2,
      yBotMm: PCB_BOT,
      style: BLUE_MASK,
      edge: BLUE_EDGE,
      paint: (p, at) => {
        paintHeaderPads(p, at, xs, 0, { text: TM_PINS, dz: 1.95, size: 0.9 })
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) paintHole(p, sx * (TM.w / 2 - 2.4), sz * (TM.h / 2 - 2.4), 2.2)
        // the display's 12 pins (two rows of 6) under its body edges
        for (let i = 0; i < 6; i++) {
          for (const sz of [-1, 1]) {
            const [bx, bz] = at(TM_CX + (i - 2.5) * PITCH, TM.dz + sz * 6.35)
            p.padCircle(bx, bz, 0.7)
          }
        }
        p.silkRect(...at(TM_CX, TM.dz), TM.dispW + 0.8, TM.dispD + 0.8, 0.15)
      },
    })
    addHeader(parts, xs, 0, PCB_BOT, PCB_BOT + 1.6)
    // display body: dark gray walls, black satin face
    const y0 = yu(PCB_BOT + 1.6) + LIFT
    parts.add(slabGeometry(TM.dispW * MM, (TM.dispT - 0.3) * MM, TM.dispD * MM, { bottom: true, top: true }), plastic(0x2a2a2d, 0.55), TM_CX, y0 + yu(TM.dispT - 0.3) / 2, TM.dz)
    parts.add(slabGeometry(TM.dispW * MM, 0.3 * MM, TM.dispD * MM, { bottom: true }), plastic(0x0e0e10, 0.5), TM_CX, y0 + yu(TM.dispT - 0.15), TM.dz)
    return parts
  })
}

const TM1637_STATICS = tm1637Statics()

/** CCW (seen from +y) polygon points → triangle fan into pos / uv */
function pushFan(pos: number[], uv: number[], pts: [number, number][], u: number): void {
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % pts.length]
    area += x0 * y1 - x1 * y0
  }
  const p = area >= 0 ? pts : [...pts].reverse()
  for (let i = 1; i < p.length - 1; i++) {
    for (const [x, y] of [p[0], p[i], p[i + 1]]) {
      // picture (x, y-up) → module (x, z = −y)
      pos.push(x * MM, 0, -y * MM)
      uv.push(u, 0.5)
    }
  }
}

/** the TM1637's lit shapes: picture (x, y-up) mm polygons and their level texel (8·digit + segment, colon = 15) */
function tmSegmentPolys(): { pts: [number, number][]; texel: number }[] {
  const out: { pts: [number, number][]; texel: number }[] = []
  {
    const t = TM.seg / 2
    const w2 = TM.digitW / 2 - t
    const h2 = TM.digitH / 2 - t
    const gap = 0.18
    const bar = (cx: number, cy: number, half: number, horiz: boolean): [number, number][] =>
      horiz
        ? [
            [cx - half, cy],
            [cx - half + t, cy - t],
            [cx + half - t, cy - t],
            [cx + half, cy],
            [cx + half - t, cy + t],
            [cx - half + t, cy + t],
          ]
        : [
            [cx, cy - half],
            [cx + t, cy - half + t],
            [cx + t, cy + half - t],
            [cx, cy + half],
            [cx - t, cy + half - t],
            [cx - t, cy - half + t],
          ]
    const segs: [number, number, number, boolean][] = [
      [0, h2, w2 - gap, true], // a
      [w2, h2 / 2, h2 / 2 - gap, false], // b
      [w2, -h2 / 2, h2 / 2 - gap, false], // c
      [0, -h2, w2 - gap, true], // d
      [-w2, -h2 / 2, h2 / 2 - gap, false], // e
      [-w2, h2 / 2, h2 / 2 - gap, false], // f
      [0, 0, w2 - gap, true], // g
    ]
    // picture y-up from the display centre; x relative to the display centre
    const dcz = -TM.dz // picture y of the display centre (module z = −y)
    for (let dgt = 0; dgt < 4; dgt++) {
      segs.forEach(([sx, sy, half, horiz], k) => {
        const pts = bar(sx, sy, half, horiz).map(([x, y]): [number, number] => [TM_CX + TM.digitX[dgt] + x + y * TM.slant, dcz + y])
        out.push({ pts, texel: dgt * 8 + k })
      })
    }
    // colon: two square dots between digits 2 and 3
    for (const cy of [2.0, -2.0]) {
      const s = 0.45
      const pts: [number, number][] = [
        [-s, -s],
        [s, -s],
        [s, s],
        [-s, s],
      ].map(([x, y]) => [TM_CX + x + (cy + y) * TM.slant, dcz + cy + y])
      out.push({ pts, texel: 8 + 7 })
    }
  }
  return out
}

/** 4 × 7 segments + the colon, texel 8·digit + segment (a = 0 … g = 6), colon = texel 15 */
function segmentsGeometry(): THREE.BufferGeometry {
  return cachedGeometry('displays-tm1637-segments', () => {
    const pos: number[] = []
    const uv: number[] = []
    for (const s of tmSegmentPolys()) pushFan(pos, uv, s.pts, (s.texel + 0.5) / 32)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.computeVertexNormals()
    return g
  })
}

function buildTm1637(comp: ComponentInstance, entry: CatalogEntry, pins: V3[]): BuildResult {
  const group = new THREE.Group()
  placeModule(group, pins, 3)
  addStatics(group, TM1637_STATICS())
  const ghost = isGhost(comp)
  const tex = ghost ? null : levelTexture(32, 1)
  const alb = ghost ? null : levelTexture(32, 1)
  const material =
    ghost || !tex || !alb
      ? cachedMaterial('displays-seg-ghost', () => new THREE.MeshPhysicalMaterial({ color: 0xaaa49f, roughness: 0.5, metalness: 0 }))
      : ledFaceMaterial(tex, alb, { color: 0xaaa49f, emissive: 0xff1808, intensity: 0, roughness: 0.5 })
  const segs = new THREE.Mesh(segmentsGeometry(), material)
  segs.position.y = yu(TM_FACE_Y) + LIFT + 0.002
  group.add(segs)
  // glow (one LED language, display-glow.ts): the lit segments' light on the black face
  const polys = tmSegmentPolys()
  const glow = ghost
    ? null
    : makeDisplayGlow({
        x0: (TM_CX - TM.dispW / 2) * MM,
        x1: (TM_CX + TM.dispW / 2) * MM,
        z0: (TM.dz - TM.dispD / 2) * MM,
        z1: (TM.dz + TM.dispD / 2) * MM,
        y: yu(TM_FACE_Y) + LIFT + 0.004,
        // picture (x, y-up) → module (x, z = −y)
        shapes: polys.map((s) => ({ pts: s.pts.map(([x, y]): [number, number] => [x * MM, -y * MM]) })),
        color: 0xff2010,
        pxPerUnit: 18,
      })
  if (glow?.mesh) group.add(glow.mesh)
  const levels = new Float32Array(polys.length)
  let lastSig = '#init' // never a real signature: the first apply paints (albedo included)
  const apply = (_c: ComponentInstance, _e: CatalogEntry, t: ComponentTelemetry | null) => {
    if (!tex) return
    const v = t?.values
    const sig = v ? `${v.seg0},${v.seg1},${v.seg2},${v.seg3},${v.brightness},${v.on}` : ''
    if (sig === lastSig) return
    lastSig = sig
    const lit = paintSegments(tex.image.data as Uint8Array, v)
    tex.needsUpdate = true
    if (alb) refreshAlbedo(alb, tex)
    // the programmed pulse width (the model's) through the LEDs' curve
    const p = lit > 0 && v ? ledPerceived(Math.min(1, Math.max(0, v.brightness ?? 0)) * DISPLAY_FULL_LIGHT) : 0
    ;(material as THREE.MeshPhysicalMaterial).emissiveIntensity = displayLensIntensity(ledLook(p))
    const d = tex.image.data as Uint8Array
    for (let i = 0; i < polys.length; i++) levels[i] = d[polys[i].texel * 4] > 0 ? 1 : 0
    glow?.apply(levels, p)
  }
  apply(comp, entry, null)
  return { object: group, pinWorld: pins.map((p) => p.clone()), update: apply }
}

export const TM1637_TOP = yu(TM_FACE_Y) + LIFT + 0.004

// ======================================================================
// registration (shape names = CatalogEntry.visual.shape)
// ======================================================================

registerMeshBuilder('oled096_i2c', 4, buildOled(OLED_096_I2C))
registerMeshBuilder('oled096_spi', 7, buildOled(OLED_096_SPI))
registerMeshBuilder('oled13_i2c', 4, buildOled(OLED_13_I2C))
registerMeshBuilder('lcd1602', 16, buildLcdParallel(LCD1602))
registerMeshBuilder('lcd2004', 16, buildLcdParallel(LCD2004))
registerMeshBuilder('lcd1602_i2c', 4, buildLcd1602I2c)
registerMeshBuilder('tft_st7735', 8, buildTft(ST7735))
registerMeshBuilder('tft_ili9341', 14, buildTft(ILI9341))
registerMeshBuilder('max7219_matrix', 5, buildMax7219)
registerMeshBuilder('ws2812_strip', 4, buildWs2812)
registerMeshBuilder('tm1637_display', 4, buildTm1637)
