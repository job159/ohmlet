/**
 * Development boards: the STM32F103C8T6 "Blue Pill" (visual.shape 'bluepill').
 *
 * True proportions (all layout below is in millimetres, converted with MM):
 *  - 53.0 × 22.6 × 1.6 mm FR4 board (routed edge: FR4 core between hairline
 *    soldermask lips, mask rolled over the top arris) floating on two black
 *    2.5 mm header strips — only along the pin rows, so an open air gap runs
 *    under the PCB between them; the two 1×20 rows sit 15.24 mm (0.6")
 *    apart — exactly breadboard rows c/h. The short pin ends stand 1.4 mm
 *    proud of the top (2.5 mm plastic + 3.0 mm short end − 1.6 mm PCB):
 *    chamfered tinned posts in concave solder fillets.
 *  - STM32F103C8T6 in LQFP48 (7 × 7 × 1.4 mm body, 0.5 mm pitch, JEDEC
 *    MS-026 gull-wings), mounted at 45° like the real board, each side facing
 *    the header pins it is routed to (DS5319 Table 5, LQFP48 column) — the
 *    catalog pinout fixes that turn, so from the front the laser marking
 *    reads upside down (from behind the board it reads upright).
 *  - HC-49S 8 MHz crystal (11.05 × 4.65 × 3.5 mm can, "8.000"), 2 × 6 mm
 *    32.768 kHz tuning-fork can, 7.5 × 5.0 × 2.45 mm micro-USB B receptacle
 *    overhanging the pin-1 end by 0.6 mm (dark socket, contact tongue),
 *    6 × 3.5 mm SMD reset switch, 2×3 BOOT header with gold posts and yellow
 *    shunts (the free post stands as tall as a cap), 4-pin SWD header at the
 *    far end, 0603 passives, SOT-23-5 LDO, 0603 power (red) and PC13
 *    (green) LEDs; ~0.7 mm stroke-font silkscreen.
 *
 * Board frame: local +x runs pin 1 → pin 20 along the row-h header, local +z
 * points at the pin-1 row. It is derived from where pins 1 and 20 ACTUALLY
 * are (rotation already applied by footprintHoles), so a 180°-rotated board
 * renders physically turned — USB at the other end, silkscreen upside down.
 *
 * Perf: every static part (board, headers, packages, passives — ~3.4k of
 * the 4k triangle budget) is merged ONCE per page into one geometry per
 * material in the board frame (shared resources), so each instance — and
 * the placement ghost, rebuilt on every hover — costs ~23 mesh objects and
 * no geometry work. Per-instance state: the BOOT0 jumper (runtime param 'boot0') and
 * the two LEDs (telemetry sub.LED_PWR / sub.LED_PC13: emissive lens +
 * additive halo sprite exactly like meshes/semis.ts — never a PointLight,
 * never transmission).
 */

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { ComponentInstance, ComponentTelemetry } from '../../model/types'
import type { CatalogEntry } from '../../model/catalog'
import { paramOf } from '../../model/catalog'
import {
  BuildResult,
  cachedGeometry,
  cachedMaterial,
  centroidOf,
  etchedLabelMaterial,
  fakeLotCode,
  brushedRoughnessTexture,
  markShared,
  mergeStatic,
  plastic,
  textTexture,
} from './shared'
import { LED_COLORS, ledGlowTexture } from './semis'
import {
  MM,
  PcbPainter,
  boardEdgeGeometries,
  boardTopGeometry,
  chip0603,
  flatQuadGeometry,
  fr4EdgeMaterial,
  headerPlasticMaterial,
  headerPostGeometry,
  maskMaterial,
  microUsbShellParts,
  pcbArtMaterial,
  splitUpFacing,
  qfpBodyParts,
  qfpLeadsGeometry,
  qfpMoldMaterial,
  slabGeometry,
  solderFilletGeometry,
  solderMaterial,
  stadiumShape,
} from './pcb'

// ---------------------------------------------------------------------------
// Layout (millimetres, board frame: +x pin 1 → 20, +z toward the pin-1 row)
// ---------------------------------------------------------------------------

const PCB_L = 53.0
const PCB_W = 22.6
const PCB_T = 1.6
/** black header plastic between the breadboard and the PCB */
const SPACER = 2.5
const PITCH = 2.54
/** header rows at ±0.3" from the board centerline (rows h / c) */
const ROW_Z = 3 * PITCH

/** y (plan units) of the PCB bottom / top faces */
const Y_BOT = SPACER * MM
const Y_TOP = (SPACER + PCB_T) * MM
/** every top-side package floats this far above the art quad (never coplanar) */
const LIFT = 0.004
/** soldermask roll-over chamfer on the routed top arris (mm) */
const EDGE_CHAMFER = 0.15
/**
 * Header pin tips proud of the PCB top (mm): a standard 2.54 mm male header
 * (2.5 mm plastic, 3.0 mm short end) through a 1.6 mm board leaves 1.4 mm —
 * the wire router keeps its clearance against 1.42 mm.
 */
const PIN_PROUD = 1.4
/** top-mounted BOOT / SWD header: post height above its 2.5 mm plastic (6 mm long end, ~as tall as a shunt cap) */
const POST_UP = 5.8

/**
 * Deep royal-blue LPI soldermask (Blue Pill photos under daylight read
 * ~#1d3f95 on the bare mask; the albedo sits below that because the key +
 * IBL + ACES lift it). Copper under the mask reads a shade lighter.
 */
const MASK_BLUE = '#112f7c'
const MASK_BLUE_COPPER = '#17398b'
/** the same mask seen edge-on / on the shadowed underside */
const MASK_EDGE = 0x0d2563

/** LQFP48 placement: center + 45° (pin-1 corner toward +x, see chipToBoard). */
const CHIP_X = 4.0
const CHIP_Z = 0
const CHIP_YAW = (-3 * Math.PI) / 4

/** micro-USB shell: 5.0 mm deep; center −24.6 → mouth 0.6 mm past the board edge */
const USB_DEPTH = 5.0
const USB_X = -24.6
const XTAL = { x: 15.8, z: -3.0 } // HC-49S, long axis along x
const LSE = { x: 15.4, z: 1.2 } // 32.768 kHz can, long axis along x, leads to +x
const RESET = { x: -11.5, z: -3.6 }
/** 2×3 BOOT header: three positions along x ('0' · BOOTx · '1'), two rows along z */
const BOOT = { x: -10.0, z0: 1.53, z1: 4.07 }
const SWD_X = 25.1
const SWD_Z = [-1.5, -0.5, 0.5, 1.5].map((k) => k * PITCH)
const SWD_LABELS = ['3.3', 'IO', 'CLK', 'GND']
const LED_PWR = { x: -19.2, z: -5.4 }
const LED_PC13 = { x: -19.2, z: 5.4 }
const LDO = { x: -19.6, z: 0 }

interface ChipPart {
  x: number
  z: number
  /** degrees, clockwise on screen (plan view) */
  rot: number
  kind: 'R' | 'C'
}
/**
 * 0603 parts. Positions are chosen against the copper art below: no pad
 * may land on a routed trace or a via (the art is one shared texture, so a
 * collision would read as a short on every board).
 */
const PASSIVES: ChipPart[] = [
  { x: -16.6, z: -2.0, rot: 90, kind: 'C' }, // LDO in
  { x: -16.6, z: 2.0, rot: 90, kind: 'C' }, // LDO out
  { x: -16.2, z: -5.4, rot: 0, kind: 'R' }, // PWR LED 1 kΩ
  { x: -16.2, z: 5.4, rot: 0, kind: 'R' }, // PC13 LED 510 Ω
  { x: -3.7, z: 0, rot: 90, kind: 'C' }, // VDD decoupling
  { x: 17.8, z: -6.2, rot: 0, kind: 'C' }, // HSE load caps
  { x: 20.3, z: -6.2, rot: 0, kind: 'C' },
]

/** Header pin i (0-based catalog index) → board-frame mm (x, z). */
function headerPinMm(i: number): [number, number] {
  if (i < 20) return [(i - 9.5) * PITCH, ROW_Z]
  return [(9.5 - (i - 20)) * PITCH, -ROW_Z]
}

/**
 * LQFP48 chip frame (u right, v up, pin 1 top-left — the datasheet view) →
 * board mm. The package turns −135° on screen so its pin-1 corner points
 * +x: each side then faces the header pins it is routed to (pins 1-12 the
 * far row's high end, 13-24 its low end, 25-36 the near row's low end,
 * 37-48 its high end).
 */
function chipToBoard(u: number, v: number): [number, number] {
  const k = Math.SQRT1_2
  return [CHIP_X + k * (v - u), CHIP_Z + k * (u + v)]
}

/** LQFP48 pin p (1-based) at radial distance r (mm): chip-frame point + outward normal. */
function lqfpPin(p: number, r: number): { u: number; v: number; nu: number; nv: number } {
  const side = Math.floor((p - 1) / 12)
  const off = (((p - 1) % 12) - 5.5) * 0.5
  switch (side) {
    case 0:
      return { u: -r, v: -off, nu: -1, nv: 0 } // left: 1 (top) → 12
    case 1:
      return { u: off, v: -r, nu: 0, nv: -1 } // bottom: 13 (left) → 24
    case 2:
      return { u: r, v: off, nu: 1, nv: 0 } // right: 25 (bottom) → 36
    default:
      return { u: -off, v: r, nu: 0, nv: 1 } // top: 37 (right) → 48
  }
}

/** STM32F103C8 LQFP48 pin numbers (DS5319 Table 5) of the header-routed I/Os. */
const LQFP48: Record<string, number> = {
  VBAT: 1, PC13: 2, PC14: 3, PC15: 4, NRST: 7, PA0: 10, PA1: 11, PA2: 12,
  PA3: 13, PA4: 14, PA5: 15, PA6: 16, PA7: 17, PB0: 18, PB1: 19, PB10: 21, PB11: 22,
  PB12: 25, PB13: 26, PB14: 27, PB15: 28, PA8: 29, PA9: 30, PA10: 31, PA11: 32, PA12: 33,
  PA15: 38, PB3: 39, PB4: 40, PB5: 41, PB6: 42, PB7: 43, PB8: 45, PB9: 46,
}

// ---------------------------------------------------------------------------
// Board art (soldermask, copper, pads, silkscreen) — painted once per page
// ---------------------------------------------------------------------------

function paintBluePill(p: PcbPainter, entry: CatalogEntry): void {
  const labelOf = (pin: string) => entry.pinInfo?.find((pi) => pi.pin === pin)?.label ?? pin
  const pinIndex = new Map(entry.pins.map((name, i) => [name, i]))

  // ---- copper (top layer) -----------------------------------------------------
  // Header → LQFP buses where the real board's 45° package makes them clean:
  // each bus is monotonic (header order matches the package side's pin
  // order): lead pad → 45° along the lead → a staggered horizontal lane →
  // straight into the header pad. Lanes step 0.5 mm, so the 0.25 mm traces
  // never touch or cross. Everything else leaves the top layer through vias
  // (sides 0/1 fan out to staggered vias; a side carrying a bus gets none —
  // a via there would land on a lane). Part placement above keeps every pad
  // off these paths.
  const k = Math.SQRT1_2
  const routedSides = new Set<number>()
  const buses: { pins: string[]; dir: 1 | -1 }[] = [
    { pins: ['PA10', 'PA11', 'PA12'], dir: -1 }, // right side → near row, under the BOOT header
    { pins: ['PB6', 'PB7', 'PB8', 'PB9'], dir: 1 }, // top side → near row
  ]
  const paths: [number, number][][] = []
  for (const bus of buses) {
    const items = bus.pins
      .map((name) => {
        const lq = LQFP48[name]
        const idx = pinIndex.get(name)
        if (lq === undefined || idx === undefined) return null
        const l = lqfpPin(lq, 4.95)
        const [lx, lz] = chipToBoard(l.u, l.v)
        const [hx, hz] = headerPinMm(idx)
        return { lq, lx, lz, dx: k * (l.nv - l.nu), dz: k * (l.nu + l.nv), hx, hz }
      })
      .filter((it): it is NonNullable<typeof it> => it !== null)
      // the lead farthest along the travel direction takes the innermost lane
      .sort((a, b) => bus.dir * (b.lx - a.lx))
    let prev: number | null = null
    for (const it of items) {
      const sz = Math.sign(it.hz)
      let lane: number = sz * Math.max(sz * it.lz + 0.45, prev === null ? -Infinity : sz * prev + 0.5)
      lane = sz * Math.min(sz * lane, ROW_Z - 1.45)
      const t = (lane - it.lz) / it.dz
      const x1 = it.lx + t * it.dx
      if (t < 0 || bus.dir * (it.hx - x1) < 0.3) continue // pad behind its lead
      paths.push([
        [it.lx, it.lz],
        [x1, lane],
        [it.hx, lane],
        [it.hx, it.hz],
      ])
      routedSides.add(Math.floor((it.lq - 1) / 12))
      prev = lane
    }
  }
  p.traces(paths, 0.25)

  // LQFP fan-out to vias on the bus-free sides (staggered 0.75 / 1.55 mm so
  // neighbouring vias never touch; never into the header pad zone)
  for (let pin = 1; pin <= 48; pin++) {
    if (routedSides.has(Math.floor((pin - 1) / 12))) continue
    const len = pin % 2 === 0 ? 0.75 : 1.55
    const a = lqfpPin(pin, 4.95)
    const b = lqfpPin(pin, 4.95 + len)
    const [ax, az] = chipToBoard(a.u, a.v)
    const [bx, bz] = chipToBoard(b.u, b.v)
    if (Math.abs(bz) > ROW_Z - 1.3) continue
    p.traces([[[ax, az], [bx, bz]]], 0.25)
    p.via(bx, bz, 0.3)
  }

  // power pins: fat stubs to stitching vias (5V / G / 3.3 / VB)
  for (const name of ['5V', 'GND3', '3V3_2', 'GND1', 'GND2', 'VBAT']) {
    const idx = pinIndex.get(name)
    if (idx === undefined) continue
    const [hx, hz] = headerPinMm(idx)
    const vz = Math.sign(hz) * 5.7
    p.traces([[[hx, hz], [hx, vz]]], 0.6)
    p.via(hx, vz, 0.4)
  }

  // local power + LED wiring at the USB end: VBUS → LDO in, LDO → caps,
  // LED → series resistor
  p.traces(
    [
      [
        [USB_X + 3.1, -1.3],
        [LDO.x - 1.2, -0.95],
      ],
      [
        [LDO.x + 1.2, 0.95],
        [-17.6, 0.95],
        [-16.6, 1.2],
      ],
      [
        [LDO.x + 1.2, -0.95],
        [-17.6, -0.95],
        [-16.6, -1.2],
      ],
    ],
    0.5,
  )
  for (const led of [LED_PWR, LED_PC13]) {
    p.traces([[[led.x + 0.8, led.z], [led.x + 2.2, led.z]]], 0.3)
  }

  // ---- pads (HASL tin) -----------------------------------------------------
  entry.pins.forEach((_name, i) => {
    const [hx, hz] = headerPinMm(i)
    if (i === 0) p.padRect(hx, hz, 1.7, 1.7) // square pad marks pin 1
    else p.padCircle(hx, hz, 0.85)
  })
  for (let pin = 1; pin <= 48; pin++) {
    const a = lqfpPin(pin, 4.35)
    const [x, z] = chipToBoard(a.u, a.v)
    // pad long axis along the lead normal: −135° package turn + side normal
    const side = Math.floor((pin - 1) / 12)
    const rot = side % 2 === 0 ? -Math.PI / 4 : Math.PI / 4
    p.padRect(x, z, 1.2, 0.3, rot)
  }
  for (const c of PASSIVES) {
    const r = (c.rot * Math.PI) / 180
    for (const s of [-1, 1]) {
      p.padRect(c.x + s * 0.8 * Math.cos(r), c.z + s * 0.8 * Math.sin(r), 0.9, 0.95, r)
    }
  }
  for (const led of [LED_PWR, LED_PC13]) {
    for (const s of [-1, 1]) p.padRect(led.x + s * 0.8, led.z, 0.9, 0.95)
  }
  // SOT-23-5 LDO (long axis along z): 3 leads on −x, 2 on +x
  for (const dz of [-0.95, 0, 0.95]) p.padRect(LDO.x - 1.2, LDO.z + dz, 1.0, 0.55)
  for (const dz of [-0.95, 0.95]) p.padRect(LDO.x + 1.2, LDO.z + dz, 1.0, 0.55)
  // reset switch legs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) p.padRect(RESET.x + sx * 2.2, RESET.z + sz * 2.15, 1.0, 0.9)
  }
  // micro-USB: 5 signal fingers behind the shell + 2 side anchor tabs
  for (let k = -2; k <= 2; k++) p.padRect(USB_X + 3.1, k * 0.65, 1.2, 0.4)
  for (const sz of [-1, 1]) p.padRect(USB_X + 1.0, sz * 4.1, 1.8, 1.2)
  // crystals
  for (const s of [-1, 1]) p.padCircle(XTAL.x + s * 2.44, XTAL.z, 0.75)
  for (const dz of [-0.4, 0.4]) p.padCircle(LSE.x + 4.25, LSE.z + dz, 0.38)

  // ---- silkscreen ------------------------------------------------------------
  // Plotted stroke-font silk (~0.7 mm glyphs, ~0.12 mm strokes — a Blue
  // Pill's legends are small and crisp, never bold). Header row outlines +
  // pin labels OUTSIDE the rows (between the pads and the board edge),
  // rotated to read bottom→top like the real board.
  const silk = { weight: 400, stroke: 0.045, condense: 0.9 }
  for (const sz of [-1, 1]) p.silkRect(0, sz * ROW_Z, 20 * PITCH, PITCH, 0.12)
  entry.pins.forEach((name, i) => {
    const [hx, hz] = headerPinMm(i)
    const near = hz > 0
    p.silkText(labelOf(name), hx, near ? ROW_Z + 1.55 : -ROW_Z - 1.55, 0.74, {
      ...silk,
      rot: -Math.PI / 2,
      align: near ? 'right' : 'left',
    })
  })
  // LEDs + legends
  for (const [led, text] of [
    [LED_PWR, 'PWR'],
    [LED_PC13, 'PC13'],
  ] as const) {
    p.silkRect(led.x, led.z, 2.7, 1.45, 0.12)
    p.silkText(text, led.x, led.z + (led.z < 0 ? 1.4 : -1.4), 0.72, silk)
  }
  // BOOT jumpers: row legends right of the header, '0' / '1' over the ends
  p.silkRect(BOOT.x, (BOOT.z0 + BOOT.z1) / 2, 3 * PITCH + 0.45, 2 * PITCH + 0.45, 0.12)
  p.silkText('BOOT0', BOOT.x + 4.3, BOOT.z0, 0.78, { ...silk, align: 'left' })
  p.silkText('BOOT1', BOOT.x + 4.3, BOOT.z1, 0.78, { ...silk, align: 'left' })
  p.silkText('0', BOOT.x - PITCH, BOOT.z0 - 1.85, 0.78, silk)
  p.silkText('1', BOOT.x + PITCH, BOOT.z0 - 1.85, 0.78, silk)
  // SWD header + legends
  p.silkRect(SWD_X, 0, PITCH + 0.45, 4 * PITCH + 0.45, 0.12)
  SWD_Z.forEach((z, i) => p.silkText(SWD_LABELS[i], SWD_X - 1.7, z, 0.74, { ...silk, align: 'right' }))
  // package outlines
  p.silkStadium(XTAL.x, XTAL.z, 11.8, 5.3, 0.12)
  p.silkRect(LSE.x, LSE.z, 6.8, 2.7, 0.12)
  // tact switch: only the end bars show past the body; the legs' pads stay clear
  p.silkRect(RESET.x, RESET.z, 7.4, 2.6, 0.12)
  // LQFP: only the pin-1 dot. The 45° package's corners reach ±7.3 mm along
  // the board axes — corner brackets there landed on the header pads, the
  // VDD cap and the crystal outline.
  const dot = chipToBoard(-5.45, 5.45)
  p.silkDot(dot[0], dot[1], 0.32)
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

const yellowJumper = () => plastic(0xf2c21b, 0.36)
const ledSubstrate = () =>
  cachedMaterial('bp-led-substrate', () =>
    new THREE.MeshPhysicalMaterial({ color: 0xf1ede2, roughness: 0.45, metalness: 0 }),
  )
/** 0603 thick-film resistor: black overglaze top */
const chipResistorMat = () =>
  cachedMaterial('bp-0603-r', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x16161a, roughness: 0.5, metalness: 0 }),
  )
/** 0603 MLCC: sintered tan ceramic */
const mlccMat = () =>
  cachedMaterial('bp-0603-c', () =>
    new THREE.MeshPhysicalMaterial({ color: 0xa88a62, roughness: 0.62, metalness: 0 }),
  )
const darkRecess = () =>
  cachedMaterial('bp-recess', () =>
    new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: 0.75, metalness: 0 }),
  )
/** black molded bodies: SMD tact-switch base, SOT-23 LDO */
const smdBlack = () => plastic(0x1b1b1e, 0.52)

/**
 * Metal finishes. The two raster modes light very differently (Performance:
 * RoomEnvironment at 0.85; Enhanced: a studio HDRI whose overhead softbox is
 * far brighter, at 0.32, with bloom past 1.6 linear), and the env strength
 * is NOT tunable per material: with the environment coming from
 * scene.environment, three r170 feeds every MeshStandardMaterial
 * scene.environmentIntensity and ignores material.envMapIntensity
 * (WebGLRenderer setProgram). The levers are albedo, metalness and
 * roughness — judged in both modes from the same camera:
 *  - small VERTICAL or curved metal (can walls, the shell's bent edges)
 *    stays polished: it mirrors the dim horizon with crisp highlight lines;
 *  - up-facing FLATS (can top, shell top, switch plate, lead feet, post
 *    tops) see the softbox at the usual 30-45° breadboard camera angles, so
 *    they take a satin finish — rough, partly dielectric, albedo below
 *    white — or they blow out to one white sheet and bloom.
 */
function bpMetal(key: string, color: number, roughness: number, metalness = 1.0, brushed = true): THREE.MeshPhysicalMaterial {
  return cachedMaterial(`bp-metal:${key}`, () => {
    const m = new THREE.MeshPhysicalMaterial({ color, metalness, roughness })
    // the shared streak map (0.8-1.0 × roughness): a brushed / stamped
    // sheen across flats instead of one uniform value
    const r = brushed ? brushedRoughnessTexture() : null
    if (r) m.roughnessMap = r
    return m
  })
}
/**
 * Polished nickel walls of the HC-49S can (no brushed map: drawn cans are
 * smooth — the streak map read as scratches).
 */
const canMetal = () => bpMetal('can', 0xb8bdc3, 0.3, 1.0, false)
/** the 32.768 kHz tuning-fork can: a cylinder's lit generatrix bloomed at 0.3 */
const lseMetal = () => bpMetal('lse', 0xaeb3b9, 0.42, 0.9, false)
/**
 * Satin up-facing flats: the crystal-can top and base flange, the USB-shell
 * top, the tact-switch plate.
 */
const satinTop = () => bpMetal('satin', 0x8d9298, 0.62, 0.5)
/**
 * Stamped stainless micro-USB shell walls + rounded edges (the tests find
 * the shell by this 0xb4b8bd tone).
 */
const usbSteel = () => bpMetal('usb', 0xb4b8bd, 0.36)
/**
 * Tinned (HASL / hot-dip) header posts proud of the solder joints. Rough
 * enough that the small facets average the environment: polished, their
 * sides mirrored the dark horizon (black spikes in Enhanced) and their flat
 * tops the softbox (glowing squares).
 */
const tinnedPost = () => bpMetal('post', 0xd8dce0, 0.7, 0.7)
/** gold-flash posts of the top-mounted BOOT / SWD headers (fully metallic, they mirrored the dark horizon brown in Enhanced) */
const goldPost = () => bpMetal('gold', 0xdcb05a, 0.55, 0.6)
/**
 * Matte tin: LQFP lead ribbons, 0603 / LED terminations, SOT-23 and switch
 * legs. The flat up-facing feet bloomed into a row of white bars as
 * polished metal.
 */
const leadTin = () => bpMetal('lead', 0x8a8f95, 0.7, 0.3)

/**
 * Printed (stamped-ink) marking on a metal can: lit ink with a faint bump
 * like the pot legend in passives.ts, cached by text.
 */
function canInk(text: string): THREE.MeshStandardMaterial | null {
  const tex = textTexture(text, { w: 256, h: 64, fg: '#2c2d31' })
  if (!tex) return null
  return cachedMaterial(`bp-can-ink:${text}`, () => {
    const m = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      roughness: 0.55,
      metalness: 0,
    })
    m.bumpMap = tex
    m.bumpScale = 0.3
    return m
  })
}

// ---------------------------------------------------------------------------
// Static geometry (built once, merged per material, shared by every instance)
// ---------------------------------------------------------------------------

interface StaticPart {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

let staticsCache: StaticPart[] | null = null

const at = (o: THREE.Object3D, xMm: number, y: number, zMm: number): THREE.Object3D => {
  o.position.set(xMm * MM, y, zMm * MM)
  return o
}

/**
 * BOOT jumper cap (2.54 mm shunt, 5.0 × 2.5 × 6.0 mm), bottom at y = 0:
 * softened molded edges (one bevel ring), 2.3 mm wide so the two caps on
 * the 2.54 mm rows show their real parting gap. Cached/shared.
 */
function jumperGeometry(): THREE.BufferGeometry {
  return cachedGeometry('bp-jumper', () => {
    const g = new RoundedBoxGeometry(4.95 * MM, 6.0 * MM, 2.3 * MM, 1, 0.32 * MM)
    g.translate(0, 3.0 * MM, 0)
    return g
  })
}

/** BOOT jumper x center (mm) for a jumper position '0' (GND side) / '1' (3.3 V side). */
function jumperX(pos: string): number {
  return BOOT.x + (pos === '1' ? PITCH / 2 : -PITCH / 2)
}

function buildStatics(entry: CatalogEntry): StaticPart[] {
  const parts: THREE.Object3D[] = []
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, xMm: number, y: number, zMm: number) => {
    const m = new THREE.Mesh(geo, mat)
    parts.push(at(m, xMm, y, zMm))
    return m
  }

  // ---- PCB: art quad on top, routed edge (FR4 core between mask lips, mask
  // roll-over chamfer on the top arris), soldermask bottom -----------------
  const art = pcbArtMaterial(
    'bluepill',
    PCB_L,
    PCB_W,
    { mask: MASK_BLUE, maskCopper: MASK_BLUE_COPPER, pad: '#b4b7ba', silk: '#ebeae1', drill: '#0a1a3d' },
    (p) => paintBluePill(p, entry),
  )
  add(boardTopGeometry(PCB_L, PCB_W, EDGE_CHAMFER), art, 0, Y_TOP, 0)
  const edge = boardEdgeGeometries(PCB_L, PCB_W, PCB_T, EDGE_CHAMFER)
  add(edge.fr4, fr4EdgeMaterial(), 0, Y_BOT, 0)
  add(edge.mask, maskMaterial(MASK_EDGE), 0, Y_BOT, 0)
  const bottom = new THREE.Mesh(flatQuadGeometry(PCB_L * MM, PCB_W * MM), maskMaterial(MASK_EDGE))
  bottom.rotation.x = Math.PI // faces down
  parts.push(at(bottom, 0, Y_BOT, 0))

  // ---- 2 × 20 header: one black strip per row UNDER the PCB (only along
  // the pin rows — the PCB floats on them with an open air gap between),
  // tinned post tips + solder fillets on top (the long pin ends are hidden
  // in the breadboard sockets). A 1×20 strip is 50.8 mm of continuous
  // plastic; its break-off notches sit on the faces the PCB and the
  // breadboard cover.
  const stripGeo = slabGeometry(20 * PITCH * MM - 0.004, SPACER * MM - 0.004, 2.5 * MM, { top: true, bottom: true })
  for (const sz of [-1, 1]) add(stripGeo, headerPlasticMaterial(), 0, (SPACER * MM) / 2 + 0.002, sz * ROW_Z)
  // short pin end: 3.0 mm above the plastic − 1.6 mm PCB = 1.4 mm proud of
  // the top, 0.64 mm square with its stamped chamfer; the joint is a
  // concave HASL-tin fillet from the 1.7 mm pad up the post
  const tipGeo = headerPostGeometry(0.32 * MM, PIN_PROUD * MM, 0.16 * MM)
  const filletGeo = solderFilletGeometry(0.8 * MM, 0.36 * MM, 0.55 * MM)
  for (let i = 0; i < 40; i++) {
    const [x, z] = headerPinMm(i)
    add(tipGeo, tinnedPost(), x, Y_TOP, z)
    add(filletGeo, solderMaterial(), x, Y_TOP + 0.002, z)
  }

  // ---- LQFP48 STM32F103C8T6 ------------------------------------------------
  const chip = new THREE.Group()
  for (const g of qfpBodyParts(7.0, 1.4, 0.08)) chip.add(new THREE.Mesh(g, qfpMoldMaterial()))
  chip.add(new THREE.Mesh(qfpLeadsGeometry(7.0, 12, 0.5), leadTin()))
  const dimple = new THREE.Mesh(
    cachedGeometry('bp-qfp-dimple', () => {
      const g = new THREE.CircleGeometry(0.42 * MM, 14)
      g.rotateX(-Math.PI / 2)
      return g
    }),
    darkRecess(),
  )
  // pin-1 dimple in the chip's top-left corner (chip-local x = u, −z = v)
  dimple.position.set(-2.35 * MM, (0.08 + 1.4) * MM + 0.002, -2.35 * MM)
  chip.add(dimple)
  chip.rotation.y = CHIP_YAW
  parts.push(at(chip, CHIP_X, Y_TOP + LIFT, CHIP_Z))

  // ---- HC-49S 8 MHz crystal: base plate + drawn can with rolled top edge ---
  // (flat tops satin, walls + rolled edge polished — see satinTop)
  const baseGeo = cachedGeometry('bp-hc49-base', () => {
    const g = new THREE.ExtrudeGeometry(stadiumShape(11.35 * MM, 4.95 * MM), {
      depth: 0.45 * MM,
      bevelEnabled: false,
      curveSegments: 5,
    })
    g.rotateX(-Math.PI / 2)
    return g
  })
  const canGeo = cachedGeometry('bp-hc49-can', () => {
    const bevel = 0.28 * MM
    const g = new THREE.ExtrudeGeometry(stadiumShape(11.05 * MM - 2 * bevel, 4.65 * MM - 2 * bevel), {
      depth: 3.3 * MM - 2 * bevel,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 5,
    })
    g.rotateX(-Math.PI / 2)
    g.translate(0, bevel, 0)
    return g
  })
  for (const [key, geo, y] of [
    ['bp-hc49-base', baseGeo, Y_TOP + LIFT],
    ['bp-hc49-can', canGeo, Y_TOP + LIFT + 0.44 * MM],
  ] as const) {
    const split = splitUpFacing(key, geo)
    add(split.up, satinTop(), XTAL.x, y, XTAL.z)
    add(split.rest, canMetal(), XTAL.x, y, XTAL.z)
  }

  // ---- 32.768 kHz tuning-fork can lying flat, leads bent down to the pads --
  const lse = new THREE.Mesh(
    cachedGeometry('bp-lse-can', () => {
      const g = new THREE.CylinderGeometry(1.0 * MM, 1.0 * MM, 6.0 * MM, 12)
      g.rotateZ(Math.PI / 2)
      return g
    }),
    lseMetal(),
  )
  parts.push(at(lse, LSE.x, Y_TOP + 1.05 * MM, LSE.z))
  for (const dz of [-0.4, 0.4]) {
    add(slabGeometry(1.35 * MM, 0.26 * MM, 0.26 * MM), leadTin(), LSE.x + 3.55, Y_TOP + 1.05 * MM, LSE.z + dz)
    add(slabGeometry(0.26 * MM, 1.05 * MM, 0.26 * MM, { bottom: true }), leadTin(), LSE.x + 4.25, Y_TOP + 0.55 * MM, LSE.z + dz)
  }

  // ---- micro-USB B receptacle: drawn steel shell, insulator + tongue -------
  const usbY = Y_TOP + LIFT
  const usb = microUsbShellParts(USB_DEPTH)
  const usbOuter = splitUpFacing(`bp-usb-shell:${USB_DEPTH}`, usb.shell)
  add(usbOuter.rest, usbSteel(), USB_X, usbY, 0)
  add(usbOuter.up, satinTop(), USB_X, usbY, 0)
  add(usb.cavity, darkRecess(), USB_X, usbY, 0) // the socket walls sit in deep occlusion
  // insulator body fills the shell from 1.2 mm behind the mouth to its back
  // (sized inside the trapezoid opening so it never pokes through the
  // shell's lower chamfers); the contact tongue hangs from its top, recessed
  // 0.3 mm behind the mouth
  const mouth = -USB_DEPTH / 2
  add(slabGeometry(3.7 * MM, 1.85 * MM, 5.3 * MM), headerPlasticMaterial(), USB_X + mouth + 1.2 + 1.85, usbY + 1.24 * MM, 0)
  add(slabGeometry(0.9 * MM, 0.6 * MM, 3.7 * MM), headerPlasticMaterial(), USB_X + mouth + 0.75, usbY + 1.55 * MM, 0)
  // the two stamped latch windows on the shell top (they hold the plug)
  for (const sz of [-1, 1]) {
    add(flatQuadGeometry(1.0 * MM, 0.55 * MM), darkRecess(), USB_X + mouth + 1.3, usbY + 2.45 * MM + 0.003, sz * 1.7)
  }
  for (const sz of [-1, 1]) {
    // anchor tabs folded down the shell sides to the board
    add(slabGeometry(1.6 * MM, 1.3 * MM, 0.22 * MM, { bottom: true }), satinTop(), USB_X + 1.0, usbY + 0.65 * MM, sz * 3.86)
  }

  // ---- SMD reset switch: black base, stainless frame, round plunger --------
  add(slabGeometry(6.0 * MM, 1.1 * MM, 3.5 * MM, { bottom: true }), smdBlack(), RESET.x, Y_TOP + LIFT + 0.55 * MM, RESET.z)
  add(slabGeometry(5.5 * MM, 0.16 * MM, 3.2 * MM, { bottom: true }), satinTop(), RESET.x, Y_TOP + LIFT + 1.18 * MM, RESET.z)
  add(
    cachedGeometry('bp-reset-plunger', () => new THREE.CylinderGeometry(0.75 * MM, 0.8 * MM, 0.65 * MM, 12)),
    plastic(0x2a2a2e, 0.45),
    RESET.x,
    Y_TOP + LIFT + 1.5 * MM,
    RESET.z,
  )
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(slabGeometry(0.6 * MM, 0.5 * MM, 0.8 * MM, { bottom: true }), leadTin(), RESET.x + sx * 2.2, Y_TOP + LIFT + 0.25 * MM, RESET.z + sz * 2.1)
    }
  }

  // ---- BOOT header 2×3 (top-mounted) + the BOOT1 jumper (fixed at '0') ------
  // molded cells with their break-off grooves; gold-flash square posts with
  // the stamped chamfer, the exposed one standing about as tall as a cap
  const topCell = slabGeometry((PITCH - 0.07) * MM, SPACER * MM, (PITCH - 0.07) * MM, { bottom: true })
  const longPin = headerPostGeometry(0.32 * MM, POST_UP * MM, 0.2 * MM)
  for (const bz of [BOOT.z0, BOOT.z1]) {
    for (const k of [-1, 0, 1]) {
      add(topCell, headerPlasticMaterial(), BOOT.x + k * PITCH, Y_TOP + LIFT + (SPACER * MM) / 2, bz)
      add(longPin, goldPost(), BOOT.x + k * PITCH, Y_TOP + SPACER * MM, bz)
    }
  }
  add(jumperGeometry(), yellowJumper(), jumperX('0'), Y_TOP + (SPACER + 0.05) * MM, BOOT.z1)

  // ---- SWD 1×4 header at the far end -----------------------------------------
  for (const z of SWD_Z) {
    add(topCell, headerPlasticMaterial(), SWD_X, Y_TOP + LIFT + (SPACER * MM) / 2, z)
    add(longPin, goldPost(), SWD_X, Y_TOP + SPACER * MM, z)
  }

  // ---- 0603 passives -------------------------------------------------------------
  for (const c of PASSIVES) {
    const g = new THREE.Group()
    for (const o of chip0603(c.kind === 'R' ? chipResistorMat() : mlccMat(), leadTin(), c.kind === 'R' ? 0.45 : 0.8)) {
      g.add(o)
    }
    g.rotation.y = (-c.rot * Math.PI) / 180 // clockwise on screen = negative yaw
    parts.push(at(g, c.x, Y_TOP + LIFT, c.z))
  }

  // ---- SOT-23-5 LDO (long axis along z) -----------------------------------------
  add(slabGeometry(1.6 * MM, 1.0 * MM, 2.9 * MM, { bottom: true }), smdBlack(), LDO.x, Y_TOP + LIFT + 0.6 * MM, LDO.z)
  for (const [sx, dz] of [
    [-1, -0.95],
    [-1, 0],
    [-1, 0.95],
    [1, -0.95],
    [1, 0.95],
  ] as const) {
    add(slabGeometry(0.75 * MM, 0.14 * MM, 0.4 * MM, { bottom: true }), leadTin(), LDO.x + sx * 1.05, Y_TOP + LIFT + 0.07 * MM, LDO.z + dz)
    add(slabGeometry(0.16 * MM, 0.5 * MM, 0.4 * MM, { bottom: true }), leadTin(), LDO.x + sx * 0.82, Y_TOP + LIFT + 0.35 * MM, LDO.z + dz)
  }

  // ---- 0603 LED bodies (substrate + terminations; the lit lens is per-instance)
  for (const led of [LED_PWR, LED_PC13]) {
    add(slabGeometry(1.1 * MM, 0.3 * MM, 0.8 * MM, { bottom: true }), ledSubstrate(), led.x, Y_TOP + LIFT + 0.15 * MM, led.z)
    for (const s of [-1, 1]) {
      add(slabGeometry(0.25 * MM, 0.55 * MM, 0.8 * MM, { bottom: true }), leadTin(), led.x + s * 0.675, Y_TOP + LIFT + 0.275 * MM, led.z)
    }
  }

  // merge once; mark the merged geometries shared (page lifetime, never
  // disposed with an instance — see disposeComponentObject)
  return mergeStatic(parts).map((m) => {
    markShared(m.geometry)
    return { geometry: m.geometry, material: m.material as THREE.Material }
  })
}

function bluePillStatics(entry: CatalogEntry): StaticPart[] {
  if (!staticsCache) staticsCache = buildStatics(entry)
  return staticsCache
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const LED_LENS_GEO = () => slabGeometry(1.1 * MM, 0.32 * MM, 0.78 * MM, { bottom: true })

/** Lens tint (unlit) per LED color: pale, water-clear-ish epoxy. */
const LENS_TINT: Record<string, number> = { red: 0xf4d2cc, green: 0xd6efd4 }

interface LedRig {
  lens: THREE.MeshPhysicalMaterial
  glow: THREE.Sprite | null
  tint: number
  burned: boolean
}

export function buildBluePill(
  comp: ComponentInstance,
  entry: CatalogEntry,
  pins: THREE.Vector3[],
): BuildResult {
  const group = new THREE.Group()
  const ghost = comp.id === '__ghost__'

  // board frame from where pins 1 and 20 really are (rotation-aware); the
  // centroid of all 40 pins is the board center for any legal placement
  const a = pins[0]
  const b = pins[Math.min(19, pins.length - 1)]
  let yaw = 0
  if (a && b) {
    const dx = b.x - a.x
    const dz = b.z - a.z
    if (Math.hypot(dx, dz) > 1e-6) yaw = Math.atan2(-dz, dx)
  }
  const c = centroidOf(pins)
  group.position.set(c.x, 0, c.z)
  group.rotation.y = yaw

  for (const s of bluePillStatics(entry)) group.add(new THREE.Mesh(s.geometry, s.material))

  // BOOT0 jumper follows the runtime param (a separate mesh: it moves)
  const jumper = new THREE.Mesh(jumperGeometry(), yellowJumper())
  jumper.position.set(jumperX('0') * MM, Y_TOP + (SPACER + 0.05) * MM, BOOT.z0 * MM)
  group.add(jumper)
  const setJumper = (v: unknown) => {
    jumper.position.x = jumperX(String(v ?? '0')) * MM
  }
  setJumper(paramOf(comp.params, entry, 'boot0'))

  // laser-etched package marking + stamped crystal marking (transparent
  // planes: they stay out of the static merge for their own sort order)
  if (!ghost) {
    const lot = fakeLotCode('STM32F103C8T6')
    const mark = etchedLabelMaterial(['STM32F103', `C8T6  ${lot}`], 2.4)
    if (mark) {
      const lbl = new THREE.Mesh(flatQuadGeometry(5.3 * MM, 2.2 * MM), mark)
      const [mx, mz] = chipToBoard(0.15, -0.35)
      lbl.position.set(mx * MM, Y_TOP + LIFT + 1.48 * MM + 0.006, mz * MM)
      lbl.rotation.y = CHIP_YAW
      group.add(lbl)
    }
    const ink = canInk('8.000')
    if (ink) {
      const lbl = new THREE.Mesh(flatQuadGeometry(6.0 * MM, 1.5 * MM), ink)
      lbl.position.set(XTAL.x * MM, Y_TOP + LIFT + 3.74 * MM + 0.004, XTAL.z * MM)
      group.add(lbl)
    }
  }

  // on-board LEDs: per-instance lens (emissive) + additive halo sprite
  const mkLed = (pos: { x: number; z: number }, colorName: 'red' | 'green'): LedRig => {
    const color = LED_COLORS[colorName]
    const tint = LENS_TINT[colorName]
    const lens = ghost
      ? (cachedMaterial(`bp-led-lens:${colorName}`, () =>
          new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.15, metalness: 0 }),
        ) as THREE.MeshPhysicalMaterial)
      : new THREE.MeshPhysicalMaterial({
          color: tint,
          // molded epoxy dome: glossy, but a mirror clearcoat on a lens this
          // small turns the key light into a bloom-blown pinpoint (Enhanced)
          roughness: 0.3,
          metalness: 0,
          clearcoat: 0.45,
          clearcoatRoughness: 0.28,
          emissive: new THREE.Color(color),
          emissiveIntensity: 0,
        })
    const lensMesh = new THREE.Mesh(LED_LENS_GEO(), lens)
    lensMesh.position.set(pos.x * MM, Y_TOP + LIFT + (0.3 + 0.16) * MM, pos.z * MM)
    group.add(lensMesh)
    let glow: THREE.Sprite | null = null
    if (!ghost) {
      glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: ledGlowTexture(),
          color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      )
      glow.position.set(pos.x * MM, Y_TOP + 0.35, pos.z * MM)
      glow.scale.setScalar(1.2)
      glow.visible = false
      group.add(glow)
    }
    return { lens, glow, tint, burned: false }
  }
  const leds = { pwr: mkLed(LED_PWR, 'red'), pc13: mkLed(LED_PC13, 'green') }

  const applyLed = (rig: LedRig, t: ComponentTelemetry | undefined) => {
    if (ghost) return
    if (t?.burned) {
      if (!rig.burned) {
        rig.burned = true
        rig.lens.color.setHex(0x3a3631) // smoked
        rig.lens.emissiveIntensity = 0
        if (rig.glow) rig.glow.visible = false
      }
      return
    }
    if (rig.burned) {
      rig.burned = false
      rig.lens.color.setHex(rig.tint)
    }
    // ledBrightness is the engine's I / 10 mA. Board indicator LEDs run at
    // 1-3 mA (PWR: (3.3 − 1.8) V / 1 kΩ ≈ 1.5 mA) and modern SMD dies are
    // plainly lit there — the display maps brightness through a perceptual
    // √ curve (lightness ~ luminance^0.5); off stays exactly off
    const br = THREE.MathUtils.clamp(t?.ledBrightness ?? 0, 0, 1)
    const perceived = Math.sqrt(br)
    rig.lens.emissiveIntensity = br <= 0.001 ? 0 : 1.2 + 4.0 * perceived
    if (rig.glow) {
      const mat = rig.glow.material
      if (br > 0.002) {
        rig.glow.visible = true
        mat.opacity = Math.min(1, 0.35 + 0.65 * perceived)
        rig.glow.scale.setScalar(0.8 + 1.1 * perceived)
      } else {
        rig.glow.visible = false
        mat.opacity = 0
      }
    }
  }

  return {
    object: group,
    pinWorld: pins.map((p) => p.clone()),
    update: (c2, e2, telemetry) => {
      setJumper(paramOf(c2.params, e2, 'boot0'))
      applyLed(leds.pwr, telemetry?.sub?.LED_PWR)
      applyLed(leds.pc13, telemetry?.sub?.LED_PC13)
    },
  }
}

/** Plan-space top of the tallest Blue Pill feature (the BOOT jumper caps), units. */
export const BLUEPILL_MESH_TOP = Y_TOP + (SPACER + 0.05 + 6.0) * MM
