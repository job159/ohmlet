/**
 * Display-module meshes (src/three/meshes/ext/displays.mesh.ts) — the
 * standard of tests/meshes-embedded.test.ts and parts-basic-mesh.test.ts:
 * real models inside the 4000-triangle budget, pinWorld exactly at the
 * catalog pins, no transmission and no lights, dispose never frees shared
 * resources, synthetic collinear pins never throw, the ghost preview is
 * cheap (no per-instance textures / sprites), the router heights and body
 * rects cover the meshes — and the live screens show what the telemetry
 * says: the per-instance DataTextures are painted from real model
 * telemetry (OLED pixels, LCD characters + CGRAM + cursor, TFT RGB565, the
 * MAX7219 dots, WS2812B colours, TM1637 segments) and repainted only when
 * the display version changes.
 *
 * Runs in node (no DOM): the PCB art canvases degrade to plain soldermask
 * by design; the DataTextures are node-safe.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CATALOG, getEntry } from '../../src/model/catalog'
import type { ComponentInstance, ComponentTelemetry, DisplayTelemetry } from '../../src/model/types'
import { componentPinHoles, holePosition } from '../../src/model/breadboard'
import { buildComponentObject, disposeComponentObject, updateComponentVisual } from '../../src/three/component-meshes'
import { isSharedResource } from '../../src/three/meshes/shared'
import { registeredMeshShapes } from '../../src/three/meshes/registry'
import {
  ILI9341_TOP,
  LCD1602_I2C_TOP,
  LCD1602_TOP,
  LCD2004_TOP,
  MAX7219_TOP,
  OLED_TOP,
  ST7735_TOP,
  TM1637_TOP,
  WS2812_TOP,
} from '../../src/three/meshes/ext/displays.mesh'
import { LCD_DOT, LCD_PANELS, glyphRows, lcdTexSize, paintLcd } from '../../src/three/meshes/ext/displays-screens'
import { HD44780_ROM } from '../../src/three/meshes/ext/displays-font'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

const TYPES = [
  'ssd1306_i2c',
  'ssd1306_spi',
  'sh1106_i2c',
  'lcd1602',
  'lcd2004',
  'lcd1602_i2c',
  'st7735',
  'ili9341',
  'max7219_8x8',
  'ws2812b_strip8',
  'tm1637_4digit',
]

const PLACED: Record<string, ComponentInstance> = {
  ssd1306_i2c: { id: 'OLED1', type: 'ssd1306_i2c', at: 'j20' },
  ssd1306_spi: { id: 'OLED2', type: 'ssd1306_spi', at: 'j20' },
  sh1106_i2c: { id: 'OLED3', type: 'sh1106_i2c', at: 'j20' },
  lcd1602: { id: 'LCD1', type: 'lcd1602', at: 'j10' },
  lcd2004: { id: 'LCD2', type: 'lcd2004', at: 'j10' },
  lcd1602_i2c: { id: 'LCD3', type: 'lcd1602_i2c', at: 'j10' },
  st7735: { id: 'TFT1', type: 'st7735', at: 'j20' },
  ili9341: { id: 'TFT2', type: 'ili9341', at: 'j20' },
  max7219_8x8: { id: 'MX1', type: 'max7219_8x8', at: 'a20' },
  ws2812b_strip8: { id: 'LED1', type: 'ws2812b_strip8', at: 'j10' },
  tm1637_4digit: { id: 'TM1', type: 'tm1637_4digit', at: 'j20' },
}

const TOPS: Record<string, number> = {
  ssd1306_i2c: OLED_TOP,
  ssd1306_spi: OLED_TOP,
  sh1106_i2c: OLED_TOP,
  lcd1602: LCD1602_TOP,
  lcd2004: LCD2004_TOP,
  lcd1602_i2c: LCD1602_I2C_TOP,
  st7735: ST7735_TOP,
  ili9341: ILI9341_TOP,
  max7219_8x8: MAX7219_TOP,
  ws2812b_strip8: WS2812_TOP,
  tm1637_4digit: TM1637_TOP,
}

function entryOf(type: string) {
  const e = getEntry(type)
  if (!e) throw new Error(`catalog entry missing: ${type}`)
  return e
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh)
  })
  return out
}

function materialsOf(root: THREE.Object3D): THREE.Material[] {
  const out = new Set<THREE.Material>()
  for (const m of meshesOf(root)) for (const mm of Array.isArray(m.material) ? m.material : [m.material]) out.add(mm)
  return [...out]
}

function spritesOf(root: THREE.Object3D): THREE.Sprite[] {
  const out: THREE.Sprite[] = []
  root.traverse((o) => {
    if ((o as THREE.Sprite).isSprite) out.push(o as THREE.Sprite)
  })
  return out
}

function triangleCount(root: THREE.Object3D): number {
  let tris = 0
  for (const m of meshesOf(root)) {
    const g = m.geometry
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3
  }
  return tris
}

function scenePins(comp: ComponentInstance): THREE.Vector3[] {
  const holes = componentPinHoles(comp, entryOf(comp.type))
  if (!holes) throw new Error(`malformed placement for ${comp.id}`)
  return holes.map((h) => {
    const p = holePosition(h!)
    return v(p.x, 0, p.z)
  })
}

function meshBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  for (const m of meshesOf(root)) {
    m.geometry.computeBoundingBox()
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld))
  }
  return box
}

/** the per-instance DataTextures of a built part (emissive maps) */
function dataTextures(root: THREE.Object3D): THREE.DataTexture[] {
  const out = new Set<THREE.DataTexture>()
  for (const m of materialsOf(root)) {
    const mm = m as THREE.MeshPhysicalMaterial
    for (const t of [mm.emissiveMap, mm.map]) if (t && (t as THREE.DataTexture).isDataTexture) out.add(t as THREE.DataTexture)
  }
  return [...out]
}

function emissiveMaterial(root: THREE.Object3D): THREE.MeshPhysicalMaterial {
  const m = materialsOf(root).find((x) => (x as THREE.MeshPhysicalMaterial).emissiveMap) as THREE.MeshPhysicalMaterial | undefined
  if (!m) throw new Error('no emissive screen material')
  return m
}

const tel = (extra: Partial<ComponentTelemetry>): ComponentTelemetry => ({ pinVoltages: {}, ...extra })

function build(type: string) {
  const comp = PLACED[type]
  const entry = entryOf(type)
  const built = buildComponentObject(comp, entry, scenePins(comp))
  return { comp, entry, built }
}

// ---------------------------------------------------------------------------

describe('every display module', () => {
  it('has a registered builder and builds a real model within the triangle budget', () => {
    const shapes = new Set(registeredMeshShapes())
    for (const t of TYPES) {
      const shape = CATALOG[t].visual?.shape
      expect(shapes.has(shape ?? ''), `${t} shape ${shape}`).toBe(true)
      const { built } = build(t)
      const tris = triangleCount(built.object)
      expect(tris, `${t} is not the fallback box`).toBeGreaterThan(150)
      expect(tris, `${t} budget`).toBeLessThanOrEqual(4000)
      disposeComponentObject(built.object)
    }
  })

  it('pinWorld sits exactly at the catalog pins', () => {
    for (const t of TYPES) {
      const comp = PLACED[t]
      const pins = scenePins(comp)
      const built = buildComponentObject(comp, entryOf(t), pins)
      expect(built.pinWorld, t).toHaveLength(pins.length)
      built.pinWorld.forEach((p, i) => {
        expect(p.x, `${t} pin ${i}`).toBeCloseTo(pins[i].x, 9)
        expect(p.z, `${t} pin ${i}`).toBeCloseTo(pins[i].z, 9)
        expect(p.y, `${t} pin ${i}`).toBe(0)
      })
      disposeComponentObject(built.object)
    }
  })

  it('no transmission (alpha / emissive only), never a light', () => {
    for (const t of TYPES) {
      const { built } = build(t)
      const transmissive = materialsOf(built.object).filter((m) => ((m as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0)
      expect(transmissive, t).toHaveLength(0)
      let lights = 0
      built.object.traverse((o) => {
        if ((o as THREE.Light).isLight) lights++
      })
      expect(lights, t).toBe(0)
      disposeComponentObject(built.object)
    }
  })

  it('dispose frees only per-instance resources (screens included); a second instance stays intact', () => {
    const disposed: object[] = []
    const origMat = THREE.Material.prototype.dispose
    const origGeo = THREE.BufferGeometry.prototype.dispose
    const origTex = THREE.Texture.prototype.dispose
    THREE.Material.prototype.dispose = function (this: THREE.Material) {
      disposed.push(this)
      origMat.call(this)
    }
    THREE.BufferGeometry.prototype.dispose = function (this: THREE.BufferGeometry) {
      disposed.push(this)
      origGeo.call(this)
    }
    THREE.Texture.prototype.dispose = function (this: THREE.Texture) {
      disposed.push(this)
      origTex.call(this)
    }
    try {
      for (const t of TYPES) {
        const comp = PLACED[t]
        const a = buildComponentObject(comp, entryOf(t), scenePins(comp))
        const texA = dataTextures(a.object)
        const b = buildComponentObject({ ...comp, id: `${comp.id}_b` }, entryOf(t), scenePins(comp))
        disposeComponentObject(a.object)
        // the screen textures of the disposed instance are freed with it
        for (const tx of texA) expect(disposed.includes(tx), `${t} screen texture freed`).toBe(true)
        for (const m of materialsOf(b.object)) expect(disposed.includes(m), `${t} shares a disposed material`).toBe(false)
        for (const m of meshesOf(b.object)) expect(disposed.includes(m.geometry), `${t} shares a disposed geometry`).toBe(false)
        for (const tx of dataTextures(b.object)) expect(disposed.includes(tx), `${t} shares a disposed texture`).toBe(false)
        disposeComponentObject(b.object)
      }
      for (const r of disposed) expect(isSharedResource(r)).toBe(false)
    } finally {
      THREE.Material.prototype.dispose = origMat
      THREE.BufferGeometry.prototype.dispose = origGeo
      THREE.Texture.prototype.dispose = origTex
    }
  })

  it('survives collinear synthetic pins and malformed short pin lists', () => {
    for (const t of TYPES) {
      const entry = entryOf(t)
      const pins = entry.pins.map((_, i) => v(i * 2, 0, 0))
      const built = buildComponentObject({ id: `T_${t}`, type: t }, entry, pins)
      expect(built.pinWorld, t).toHaveLength(pins.length)
      expect(triangleCount(built.object), t).toBeLessThanOrEqual(4000)
      updateComponentVisual(built, { id: `T_${t}`, type: t }, entry, null)
      disposeComponentObject(built.object)
      const tiny = buildComponentObject({ id: `T2_${t}`, type: t }, entry, [v(0, 0, 0), v(0, 0, 0)])
      expect(tiny.pinWorld).toHaveLength(2)
      disposeComponentObject(tiny.object)
    }
  })

  it('the ghost preview builds without per-instance screens or sprites', () => {
    for (const t of TYPES) {
      const comp = { ...PLACED[t], id: '__ghost__' }
      const built = buildComponentObject(comp, entryOf(t), scenePins(comp))
      expect(spritesOf(built.object), t).toHaveLength(0)
      expect(dataTextures(built.object), t).toHaveLength(0)
      for (const m of materialsOf(built.object)) expect(isSharedResource(m), `${t} ghost material shared`).toBe(true)
      disposeComponentObject(built.object)
    }
  })

  it('a 180° turn lays the module behind its header row (header-on-top modules) or in front (MAX7219)', () => {
    for (const [t, at] of [
      ['ssd1306_i2c', 'a20'],
      ['lcd1602', 'a40'],
      ['max7219_8x8', 'j20'],
    ] as const) {
      const comp: ComponentInstance = { id: 'R', type: t, at, rotation: 180 }
      const pins = scenePins(comp)
      const built = buildComponentObject(comp, entryOf(t), pins)
      const box = meshBox(built.object)
      const rowZ = pins[0].z
      if (t === 'max7219_8x8') expect(box.max.z, t).toBeGreaterThan(rowZ + 15)
      else expect(box.min.z, t).toBeLessThan(rowZ - 8)
      disposeComponentObject(built.object)
    }
  })
})

describe('router heights and body extents match the meshes', () => {
  it('obstacleHeight covers the mesh top (exported tops are exact upper bounds)', () => {
    for (const t of TYPES) {
      const { built } = build(t)
      const box = meshBox(built.object)
      expect(box.max.y, `${t} exported top`).toBeLessThanOrEqual(TOPS[t] + 1e-6)
      expect(TOPS[t] - box.max.y, `${t} exported top is tight`).toBeLessThan(0.05)
      expect(CATALOG[t].obstacleHeight!, `${t} obstacleHeight`).toBeGreaterThanOrEqual(box.max.y)
      expect(box.min.y, `${t} nothing below the hole depth`).toBeGreaterThanOrEqual(-0.2)
      disposeComponentObject(built.object)
    }
  })

  it('the PCB spans exactly the declared bodyFootprint columns and stays off the neighbouring strip row', () => {
    for (const t of TYPES) {
      const comp = PLACED[t]
      const entry = entryOf(t)
      const fp = entry.bodyFootprint
      if (!fp || fp === 'auto') throw new Error(`${t}: explicit bodyFootprint expected`)
      const pins = scenePins(comp)
      const built = buildComponentObject(comp, entry, pins)
      const box = meshBox(built.object)
      const x0 = pins[0].x
      // a hole counts as covered when the body crosses its centre
      expect(box.min.x, `${t} covers column ${fp.dCols[0]}`).toBeLessThan(x0 + fp.dCols[0])
      expect(box.min.x, `${t} not column ${fp.dCols[0] - 1}`).toBeGreaterThan(x0 + fp.dCols[0] - 1)
      expect(box.max.x, `${t} covers column ${fp.dCols[1]}`).toBeGreaterThan(x0 + fp.dCols[1])
      expect(box.max.x, `${t} not column ${fp.dCols[1] + 1}`).toBeLessThan(x0 + fp.dCols[1] + 1)
      // the strip rows beyond the declared ones (toward the board centre) stay free
      const rowZ = pins[0].z
      const inward = fp.rows.length > 1 ? 2 : 1
      if (comp.at!.startsWith('a')) expect(box.max.z, `${t} row ${inward} below`).toBeLessThan(rowZ + inward)
      else expect(box.min.z, `${t} row ${inward} above`).toBeGreaterThan(rowZ - inward)
      disposeComponentObject(built.object)
    }
  })
})

// ---------------------------------------------------------------------------
// live screens
// ---------------------------------------------------------------------------

/** RGBA of texel (x, y) with y = picture row from the TOP (textures store row 0 at the bottom) */
function texel(t: THREE.DataTexture, x: number, yTop: number): number[] {
  const { width: w, height: h } = t.image
  const d = t.image.data as Uint8Array
  const o = ((h - 1 - yTop) * w + x) * 4
  return [d[o], d[o + 1], d[o + 2]]
}

describe('state-driven visuals', () => {
  it('OLED: GDDRAM-derived glass image → emissive texture in the panel colour; off = black; version-gated', () => {
    const { comp, entry, built } = build('ssd1306_i2c')
    const [tex] = dataTextures(built.object)
    expect(tex.image.width).toBe(128)
    expect(tex.image.height).toBe(64)
    const data = new Uint8Array(1024)
    data[0 * 128 + 5] = 0b0000_0100 // pixel (5, 2)
    data[7 * 128 + 127] = 0x80 // pixel (127, 63)
    const disp: DisplayTelemetry = { version: 1, width: 128, height: 64, format: 'mono-pages', data, on: true, contrast: 0.8 }
    updateComponentVisual(built, comp, entry, tel({ display: disp }))
    expect(texel(tex, 5, 2)[0]).toBeGreaterThan(200)
    expect(texel(tex, 127, 63)[0]).toBeGreaterThan(200)
    expect(texel(tex, 6, 2)).toEqual([0, 0, 0])
    const mat = emissiveMaterial(built.object)
    expect(mat.emissiveIntensity).toBeGreaterThan(1)
    // blue variant repaints even at the same version
    updateComponentVisual(built, { ...comp, params: { color: 'blue' } }, entry, tel({ display: disp }))
    const blue = texel(tex, 5, 2)
    expect(blue[2]).toBeGreaterThan(blue[0])
    // same version, different data: no repaint (snapshots are immutable per version)
    data[0 * 128 + 6] = 0b100
    const before = tex.version
    updateComponentVisual(built, { ...comp, params: { color: 'blue' } }, entry, tel({ display: disp }))
    expect(tex.version).toBe(before)
    // display off (AEh or charge pump off): black, no emission
    updateComponentVisual(built, comp, entry, tel({ display: { ...disp, version: 2, on: false } }))
    expect(texel(tex, 5, 2)).toEqual([0, 0, 0])
    expect(mat.emissiveIntensity).toBe(0)
    disposeComponentObject(built.object)
  })

  it('OLED yellow-blue: rows 0–15 yellow, the rest blue', () => {
    const { comp, entry, built } = build('ssd1306_i2c')
    const [tex] = dataTextures(built.object)
    const data = new Uint8Array(1024).fill(0xff)
    updateComponentVisual(built, { ...comp, params: { color: 'yellow-blue' } }, entry, tel({ display: { version: 1, width: 128, height: 64, format: 'mono-pages', data, on: true, contrast: 0.5 } }))
    const y = texel(tex, 10, 3)
    const b = texel(tex, 10, 40)
    expect(y[0]).toBeGreaterThan(y[2])
    expect(b[2]).toBeGreaterThan(b[0])
    disposeComponentObject(built.object)
  })

  it('LCD1602: characters from the HD44780 ROM and CGRAM, cursor underline, backlight from the module LED', () => {
    const { comp, entry, built } = build('lcd1602')
    const [tex] = dataTextures(built.object)
    const cgram = new Uint8Array(64)
    cgram.set([0b10001, 0, 0, 0, 0, 0, 0, 0b11111], 8) // CGRAM char 1: corner dots + bottom row
    const disp: DisplayTelemetry = {
      version: 3,
      width: 16,
      height: 2,
      format: 'chars',
      text: ['A' + ' '.repeat(15), '\u0001' + ' '.repeat(15)],
      data: cgram,
      on: true,
      contrast: 1,
    }
    const values = { cursorRow: 1, cursorCol: 3, cursor: 1, blink: 0, blinkPhase: 0, ghostRow1: 0, ghostOther: 0 }
    const led = tel({ ledBrightness: 1.6 })
    updateComponentVisual(built, comp, entry, tel({ display: disp, values, sub: { LED_BL: led } }))
    const W = tex.image.width
    const H = tex.image.height
    const geom = lcdTexSize({ cols: 16, rows: 2, marginX: 0, marginY: 0 })
    const mx = (W - geom.w) / 2
    const my = (H - geom.h) / 2
    const panel = LCD_PANELS.blue
    const dot = (r: number, c: number, dy: number, dx: number) => texel(tex, mx + (c * 6 + dx) * LCD_DOT + 1, my + (r * 9 + dy) * LCD_DOT + 1)
    // 'A' row 0 = 0b01110: dots 1..3 lit, 0 and 4 dark
    const a = HD44780_ROM[0x41 * 8]
    expect(a).toBe(0b01110)
    expect(dot(0, 0, 0, 0)).toEqual([...panel.bg])
    expect(dot(0, 0, 0, 2)).toEqual([...panel.dot])
    // CGRAM glyph 1: corners of row 0, the whole row 7
    expect(dot(1, 0, 0, 0)).toEqual([...panel.dot])
    expect(dot(1, 0, 0, 2)).toEqual([...panel.bg])
    expect(dot(1, 0, 7, 2)).toEqual([...panel.dot])
    // cursor underline at row 1, column 3 (a blank cell)
    expect(dot(1, 3, 7, 0)).toEqual([...panel.dot])
    expect(dot(1, 3, 6, 0)).toEqual([...panel.bg])
    const mat = emissiveMaterial(built.object)
    expect(mat.emissiveIntensity).toBeGreaterThan(0.9)
    // backlight wire removed: no emission (the blue STN is then nearly unreadable)
    updateComponentVisual(built, comp, entry, tel({ display: disp, values, sub: { LED_BL: tel({ ledBrightness: 0 }) } }))
    expect(mat.emissiveIntensity).toBe(0)
    disposeComponentObject(built.object)
  })

  it('LCD: an uninitialized 1-line panel shows the row of boxes on line 1; low contrast fades the dots', () => {
    const geom = { cols: 16, rows: 2, marginX: 3, marginY: 2 }
    const { w, h } = lcdTexSize(geom)
    const out = new Uint8Array(w * h * 4)
    const panel = LCD_PANELS['yellow-green']
    const disp: DisplayTelemetry = { version: 1, width: 16, height: 2, format: 'chars', text: [' '.repeat(16), ' '.repeat(16)], on: false, contrast: 0 }
    paintLcd(out, geom, disp, { ghostRow1: 0.85, ghostOther: 0 }, panel)
    const px = (x: number, yTop: number) => {
      const o = ((h - 1 - yTop) * w + x) * 4
      return [out[o], out[o + 1], out[o + 2]]
    }
    const box = px(geom.marginX + 2 * LCD_DOT + 1, geom.marginY + 3 * LCD_DOT + 1)
    const row2 = px(geom.marginX + 2 * LCD_DOT + 1, geom.marginY + (9 + 3) * LCD_DOT + 1)
    expect(box[0]).toBeLessThan(panel.bg[0] - 80) // dark box on the yellow-green glass
    expect(row2).toEqual([...panel.bg])
    // contrast 0.5: a driven dot sits halfway between background and dot colour
    paintLcd(out, geom, { ...disp, on: true, contrast: 0.5, text: ['ÿ' + ' '.repeat(15), ' '.repeat(16)] }, { ghostRow1: 0, ghostOther: 0 }, panel)
    const half = px(geom.marginX + 1, geom.marginY + 1)
    expect(half[0]).toBeCloseTo((panel.bg[0] + panel.dot[0]) / 2, -1)
    expect(glyphRows(0xff, undefined)[0]).toBe(0b11111)
  })

  it('LCD1602 + backpack: backlight from the P3 bit (display.backlight), contrast trimmer turns the screw', () => {
    const { comp, entry, built } = build('lcd1602_i2c')
    const disp: DisplayTelemetry = { version: 1, width: 16, height: 2, format: 'chars', text: ['HI'.padEnd(16), ' '.repeat(16)], on: true, contrast: 1, backlight: 1 }
    updateComponentVisual(built, comp, entry, tel({ display: disp }))
    const mat = emissiveMaterial(built.object)
    expect(mat.emissiveIntensity).toBeGreaterThan(0.9)
    updateComponentVisual(built, comp, entry, tel({ display: { ...disp, version: 2, backlight: 0 } }))
    expect(mat.emissiveIntensity).toBe(0)
    // the trimmer's screw slot: the one small box mesh turned about y (3.2 mm long)
    const screw = meshesOf(built.object).find((m) => {
      const g = m.geometry as THREE.BoxGeometry
      return g.type === 'BoxGeometry' && Math.abs(g.parameters.width - 3.2 / 2.54) < 1e-6
    })
    expect(screw).toBeDefined()
    expect(screw!.rotation.y).not.toBe(0)
    const r0 = screw!.rotation.y
    updateComponentVisual(built, { ...comp, params: { contrast: 0.2 } }, entry, tel({ display: disp }))
    expect(screw!.rotation.y).not.toBeCloseTo(r0, 3)
    disposeComponentObject(built.object)
  })

  it('TFT: RGB565 frame → texture, backlight duty → emission; an unpowered panel is dark', () => {
    for (const [t, w, h] of [
      ['st7735', 128, 160],
      ['ili9341', 240, 320],
    ] as const) {
      const { comp, entry, built } = build(t)
      const [tex] = dataTextures(built.object)
      expect([tex.image.width, tex.image.height]).toEqual([w, h])
      const px = new Uint16Array(w * h)
      px[0] = 0xf800 // red at (0, 0)
      px[5 * w + 7] = 0x07e0 // green at (7, 5)
      px[(h - 1) * w + (w - 1)] = 0x001f // blue at the bottom-right
      const disp: DisplayTelemetry = { version: 4, width: w, height: h, format: 'rgb565', data: new Uint8Array(px.buffer), on: true, backlight: 0.5 }
      updateComponentVisual(built, comp, entry, tel({ display: disp }))
      expect(texel(tex, 0, 0)).toEqual([255, 0, 0])
      expect(texel(tex, 7, 5)).toEqual([0, 255, 0])
      expect(texel(tex, w - 1, h - 1)).toEqual([0, 0, 255])
      const mat = emissiveMaterial(built.object)
      expect(mat.emissiveIntensity).toBeCloseTo(0.34, 3)
      // powered but asleep / DISPOFF: the normally-white TN glass shows the backlight
      updateComponentVisual(built, comp, entry, tel({ display: { ...disp, version: 5, on: false } }))
      expect(texel(tex, 7, 5)).toEqual([255, 255, 255])
      expect(mat.emissiveIntensity).toBeCloseTo(0.34, 3)
      updateComponentVisual(built, comp, entry, null)
      expect(texel(tex, 0, 0)).toEqual([0, 0, 0])
      expect(mat.emissiveIntensity).toBe(0)
      disposeComponentObject(built.object)
    }
  })

  it('MAX7219: each of the 64 dots samples its own texel (column c, row r) of the level map', () => {
    const { comp, entry, built } = build('max7219_8x8')
    const [tex] = dataTextures(built.object)
    const data = new Uint8Array(8)
    data[0] = 0b0000_0001 // column 0, row 0
    data[7] = 0b1000_0000 // column 7, row 7
    updateComponentVisual(built, comp, entry, tel({ display: { version: 1, width: 8, height: 8, format: 'mono-pages', data, on: true, contrast: 1 } }))
    const d = tex.image.data as Uint8Array
    const at = (r: number, c: number) => d[(r * 8 + c) * 4]
    expect(at(0, 0)).toBeGreaterThan(100)
    expect(at(7, 7)).toBeGreaterThan(100)
    expect(at(0, 7)).toBe(0)
    // the dot of column 0 / row 0 is the far-left one (row 0 = farthest from the input header)
    const dots = meshesOf(built.object).find((m) => m.material === emissiveMaterial(built.object))!
    const pos = dots.geometry.getAttribute('position')
    const uv = dots.geometry.getAttribute('uv')
    let farLeft = { x: Infinity, z: Infinity, u: 0, v: 0 }
    for (let i = 0; i < pos.count; i += 3) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      if (x + z < farLeft.x + farLeft.z) farLeft = { x, z, u: uv.getX(i), v: uv.getY(i) }
    }
    expect(farLeft.u).toBeCloseTo(0.5 / 8, 6)
    expect(farLeft.v).toBeCloseTo(0.5 / 8, 6)
    // shutdown: dark
    updateComponentVisual(built, comp, entry, tel({ display: { version: 2, width: 8, height: 8, format: 'mono-pages', data, on: false, contrast: 1 } }))
    expect(at(0, 0)).toBe(0)
    disposeComponentObject(built.object)
  })

  it('WS2812B: the latched colours light the lenses and their halos; dark LEDs hide the halo', () => {
    const { comp, entry, built } = build('ws2812b_strip8')
    const [tex] = dataTextures(built.object)
    const rgb = [0xff0000, 0x00ff00, 0x0000ff, 0x400000, 0, 0, 0, 0x303030]
    updateComponentVisual(built, comp, entry, tel({ rgb }))
    const d = tex.image.data as Uint8Array
    expect([d[0], d[1], d[2]]).toEqual([255, 0, 0])
    expect([d[4], d[5], d[6]]).toEqual([0, 255, 0])
    expect([d[8], d[9], d[10]]).toEqual([0, 0, 255])
    expect(d[12]).toBeGreaterThan(0x40) // dim red still reads red
    expect(d[13]).toBe(0)
    const glows = spritesOf(built.object)
    expect(glows).toHaveLength(8)
    expect(glows.slice(0, 4).every((s) => s.visible)).toBe(true)
    expect(glows[4].visible).toBe(false)
    disposeComponentObject(built.object)
  })

  it('TM1637: segment bits and the colon light their own texels at the programmed pulse width', () => {
    const { comp, entry, built } = build('tm1637_4digit')
    const [tex] = dataTextures(built.object)
    // "12:34": 1 = b c, 2 = a b d e g, colon on digit 2
    const v = { seg0: 0x06, seg1: 0x5b | 0x80, seg2: 0x4f, seg3: 0x66, brightness: 11 / 14, on: 1 }
    updateComponentVisual(built, comp, entry, tel({ values: v }))
    const d = tex.image.data as Uint8Array
    const lvl = (dgt: number, k: number) => d[(dgt * 8 + k) * 4]
    expect([0, 1, 2, 3, 4, 5, 6].map((k) => lvl(0, k) > 0)).toEqual([false, true, true, false, false, false, false])
    expect(lvl(1, 7)).toBeGreaterThan(0) // colon
    expect(lvl(3, 6)).toBeGreaterThan(0) // '4' has g
    updateComponentVisual(built, comp, entry, tel({ values: { ...v, on: 0 } }))
    expect(lvl(0, 1)).toBe(0)
    disposeComponentObject(built.object)
  })
})

describe('LED faces before any telemetry', () => {
  it('unlit diffusers keep their colour (the albedo maps start white, the emission black)', () => {
    for (const t of ['max7219_8x8', 'ws2812b_strip8', 'tm1637_4digit']) {
      const { built } = build(t)
      const mat = emissiveMaterial(built.object)
      const alb = (mat.map as THREE.DataTexture).image.data as Uint8Array
      const emi = (mat.emissiveMap as THREE.DataTexture).image.data as Uint8Array
      expect(alb[0], t).toBe(255)
      expect(emi[0], t).toBe(0)
      disposeComponentObject(built.object)
    }
  })
})
