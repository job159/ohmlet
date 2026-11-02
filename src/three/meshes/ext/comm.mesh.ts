/**
 * Communication & memory module meshes (src/model/parts/comm.parts.ts):
 * CH340G USB-to-TTL adapter, HC-05 Bluetooth module (ZS-040 carrier,
 * standing upright), MAX485 RS-485 module, W25Q32 SPI-flash breakout,
 * micro-SD module (AMS1117 + 74LVC125A), PCF8574 I/O expander, ESP-01 on its
 * 1×8 breadboard adapter and the TJA1050 CAN transceiver module. Registered
 * through registerMeshBuilder (meshes/registry); built from ./comm-kit.
 *
 * Every module is laid out in millimetres in a DESIGN frame: origin at
 * catalog pin 0 at rotation 0, +x along its pin row (+dCol), +z toward the
 * breadboard's row j. The statics are built once per design, merged per
 * material and shared; each instance turns them by the yaw of its real pin
 * holes (a 180° placement turns the whole module) about the pin centroid.
 * Per-instance state only where telemetry / params move something: LED
 * lenses (emissive + additive glow sprite, never a light), the CH340
 * logic-level shunt and the PCF8574 address shunts — numeric mutations only.
 *
 * Proportions are the common modules' (mm): CH340G 40 mm board + 12 mm of
 * USB-A plug × 17; ZS-040 37.3 × 15.5 with the 27 × 13 HC-05 core;
 * W25Q32 breakout 22 × 18; micro-SD module 42 × 24; ESP-01 24.8 × 14.3 on
 * a 21 × 8.5 adapter. The two-header modules (MAX485, PCF8574, TJA1050)
 * straddle the channel with their headers 0.6" apart (rows c / h): their
 * boards span exactly the covered rows (the real MAX485 / TJA1050 boards
 * are longer — stated in the catalog doc).
 */
import * as THREE from 'three'
import type { ComponentInstance, ComponentTelemetry } from '../../../model/types'
import type { CatalogEntry } from '../../../model/catalog'
import { paramOf } from '../../../model/catalog'
import { registerMeshBuilder } from '../registry'
import type { BuildResult } from '../shared'
import { fakeLotCode } from '../shared'
import { headerPlasticMaterial, headerPostGeometry, slabGeometry, solderFilletGeometry, solderMaterial } from '../pcb'
import {
  LIFT,
  MM,
  PCB_T,
  PITCH,
  SOIC14,
  SOIC16,
  SOIC16W,
  SOIC8,
  SOIC8W,
  SPACER,
  Y_TOP,
  addStatics,
  applyLed,
  cavity,
  chip,
  crystal3225,
  crystalHc49Smd,
  flatBoard,
  frameGroup,
  isGhost,
  layoutCentroid,
  ledBase,
  ledLens,
  logicLed,
  mergeParts,
  moduleFrame,
  nylon,
  printMaterial,
  put,
  qfn,
  satinMetal,
  shuntGeometry,
  shuntPlastic,
  soic,
  sot223,
  sot23,
  steel,
  subLed,
  tactSwitch,
  tinnedPost,
  topHeader,
  topLabel,
  underHeader,
  usbAPlug,
} from './comm-kit'
import type { LedRig, PcbPainter, SoicSpec, StaticPart } from './comm-kit'

type Pt = [number, number]

/** decals (pin-1 dimples, markings) float this far above a package top */
const DECAL = 0.006

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

/** pins along one row: ((d0 + i)·2.54, z) */
const rowPins = (n: number, z = 0, d0 = 0): Pt[] => Array.from({ length: n }, (_, i) => [(d0 + i) * PITCH, z] as Pt)

/** Painter in DESIGN coordinates for a board centered at (bx, bz). */
function painterAt(p: PcbPainter, bx: number, bz: number) {
  const X = (x: number) => x - bx
  const Z = (z: number) => z - bz
  const pts = (ps: readonly Pt[]) => ps.map(([x, z]) => [X(x), Z(z)] as const)
  return {
    traces: (paths: Pt[][], w = 0.3) => p.traces(paths.map(pts), w),
    copper: (x: number, z: number, w: number, h: number) => p.copperRect(X(x), Z(z), w, h),
    via: (x: number, z: number, r = 0.3) => p.via(X(x), Z(z), r),
    pad: (x: number, z: number, w: number, h: number, rot = 0) => p.padRect(X(x), Z(z), w, h, rot),
    padC: (x: number, z: number, r: number) => p.padCircle(X(x), Z(z), r),
    text: (s: string, x: number, z: number, size: number, opts: { rot?: number; align?: CanvasTextAlign } = {}) =>
      p.silkText(s, X(x), Z(z), size, { stroke: 0.05, condense: 0.92, ...opts }),
    rect: (x: number, z: number, w: number, h: number, lw = 0.15) => p.silkRect(X(x), Z(z), w, h, lw),
    dot: (x: number, z: number, r: number) => p.silkDot(X(x), Z(z), r),
    /** through-hole header pads (pin 1 square) */
    header: (ps: readonly Pt[], squareFirst = true) => {
      ps.forEach(([x, z], i) => {
        if (i === 0 && squareFirst) p.padRect(X(x), Z(z), 1.7, 1.7)
        else p.padCircle(X(x), Z(z), 0.85)
        p.via(X(x), Z(z), 0.42)
      })
    },
    /** dual-row SMD land pattern (rot 0: lead rows along z) */
    soicPads: (s: SoicSpec, x: number, z: number, rot: number) => {
      const off = s.span / 2 - 0.75
      const c = Math.cos(rot)
      const sn = Math.sin(rot)
      const horiz = Math.abs(c) > 0.5
      for (let k = 0; k < s.n; k++) {
        const along = (k - (s.n - 1) / 2) * s.pitch
        for (const side of [-1, 1]) {
          // rotation.y by `rot`: (x, z) → (x cos + z sin, −x sin + z cos)
          const lx = side * off
          const wx = lx * c + along * sn
          const wz = -lx * sn + along * c
          p.padRect(X(x + wx), Z(z + wz), horiz ? 1.5 : 0.6, horiz ? 0.6 : 1.5)
        }
      }
    },
    /** 0603 land pattern, long axis along x rotated `rotDeg` (90 = along z) */
    chipPads: (x: number, z: number, rotDeg = 0) => {
      const along = rotDeg % 180 !== 0
      for (const s of [-1, 1]) {
        if (along) p.padRect(X(x), Z(z + s * 0.8), 0.9, 0.8)
        else p.padRect(X(x + s * 0.8), Z(z), 0.8, 0.9)
      }
    },
    mountHole: (x: number, z: number) => {
      p.padCircle(X(x), Z(z), 1.5)
      p.via(X(x), Z(z), 1.0)
    },
  }
}

/** Static cache: one merged set per design. */
const statics = new Map<string, StaticPart[]>()

/**
 * Build (once) a design's statics in its design frame and bake the pin
 * centroid offset in, so the instance group can sit on the world centroid.
 */
function designStatics(key: string, centroid: Pt, build: (parts: THREE.Object3D[]) => void): StaticPart[] {
  let s = statics.get(key)
  if (!s) {
    const parts: THREE.Object3D[] = []
    build(parts)
    const root = new THREE.Group()
    root.position.set(-centroid[0] * MM, 0, -centroid[1] * MM)
    for (const p of parts) root.add(p)
    s = mergeParts([root])
    statics.set(key, s)
  }
  return s
}

/** Module instance: frame group + an inner group in design coordinates. */
function moduleInstance(pins: THREE.Vector3[], a: number, b: number, centroid: Pt): { group: THREE.Group; inner: THREE.Group } {
  const group = frameGroup(moduleFrame(pins, a, b))
  const inner = new THREE.Group()
  inner.position.set(-centroid[0] * MM, 0, -centroid[1] * MM)
  group.add(inner)
  return { group, inner }
}

/** Laser marking on a package top (cached per text; skipped headless). */
function marking(parent: THREE.Object3D, key: string, lines: string[], wMm: number, dMm: number, x: number, y: number, z: number, rotY = 0): void {
  const n = lines.length
  const mat = printMaterial(
    key,
    256,
    Math.max(32, Math.round((256 * dMm) / wMm)),
    lines.map((t, i) => ({
      text: t,
      y: (i + 0.55) / n,
      size: Math.min(0.62, 0.8 / n),
      color: i === 0 ? '#cfcfd3' : '#a6a6ab',
      weight: i === 0 ? 700 : 600,
    })),
  )
  topLabel(parent, mat, wMm, dMm, x, y + 0.004, z, rotY)
}

const pick = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)

// ---------------------------------------------------------------------------
// CH340G USB-to-TTL adapter (pins row a: GND 3V3 5V TXD RXD DTR; the board
// and its USB-A plug run toward −z, over the top rails and off the board)
// ---------------------------------------------------------------------------

const CH_PINS = rowPins(6)
const CH_C = layoutCentroid(CH_PINS)
const CH_BOARD = { x: 6.35, z: -18.0, w: 17.0, d: 40.0 }
/** SOIC-16 CH340G: lead rows along z, left row x 6.35, right row x 10.85, pins z −25.45 … −16.55 */
const CH_CHIP = { x: 8.6, z: -21.0 }
const CH_XTAL = { x: 1.75, z: -25.6 }
/** logic-level jumper: 1×3 header (3V3 · VCC · 5V) */
const CH_JMP = { x0: 3.81, z: -7.0 }
const CH_LEDS = [
  { id: 'PWR', x: 1.6, z: -10.8, color: 'red' },
  { id: 'TXD', x: 1.6, z: -13.0, color: 'green' },
  { id: 'RXD', x: 1.6, z: -15.2, color: 'blue' },
] as const
const CH_USB = { z: -50.0, len: 17.0 }
const CH_CAPS: Pt[] = [
  [0.3, -32.4],
  [3.2, -32.4],
  [8.6, -14.6],
]
/** top of the tallest feature (the shunt on its header), plan units */
export const CH340_TOP = Y_TOP + (2.5 + 6.0) * MM

function paintCh340(p: PcbPainter): void {
  const P = painterAt(p, CH_BOARD.x, CH_BOARD.z)
  const right = (z: number): Pt => [10.85, z]
  const left = (z: number): Pt => [6.35, z]
  P.copper(-1.0, -18.0, 1.8, 30.0) // ground pour along the left edge
  P.traces(
    [
      [
        [0, 0],
        [0, -2.6],
        [-1.0, -3.4],
      ],
      // 3V3 / 5V pins → the outer jumper pins; VCC (middle) → chip pin 16
      [
        [2.54, 0],
        [2.54, -3.6],
        [3.81, -4.8],
        [3.81, -7.0],
      ],
      [
        [5.08, 0],
        [5.08, -2.6],
        [8.89, -4.2],
        [8.89, -7.0],
      ],
      [[6.35, -7.0], [6.35, -9.2], [10.85, -11.6], right(-16.555)],
      // TXD / RXD / DTR down the right edge into the right lead row
      [[7.62, 0], [7.62, -1.8], [12.0, -3.6], [12.0, -18.2], right(-19.095)],
      [[10.16, 0], [10.16, -1.3], [13.0, -3.0], [13.0, -19.4], right(-20.365)],
      [[12.7, 0], [12.7, -1.0], [13.9, -2.4], [13.9, -24.6], right(-25.445)],
      // TX / RX LEDs → the chip's activity outputs
      [[2.4, -13.0], [5.0, -13.0], left(-16.555)],
      [[2.4, -15.2], [4.4, -15.2], [5.4, -17.825], left(-17.825)],
      // crystal ↔ XI / XO
      [[1.75, -20.0], [4.0, -19.1], left(-19.095)],
      [[1.75, -31.2], [4.6, -29.0], [4.6, -22.9], left(-22.905)],
      // USB D+ / D− from the plug
      [[5.6, -33.2], [5.6, -27.0], left(-25.445)],
      [
        [7.4, -33.2],
        [7.4, -24.18],
        [6.35, -24.175],
      ],
    ],
    0.3,
  )
  P.via(-1.0, -3.4)
  P.header(CH_PINS)
  for (let i = 0; i < 3; i++) P.padC(CH_JMP.x0 + i * PITCH, CH_JMP.z, 0.8)
  P.text('3V3', CH_JMP.x0, CH_JMP.z - 2.2, 0.82)
  P.text('VCC', CH_JMP.x0 + PITCH, CH_JMP.z - 2.2, 0.82)
  P.text('5V', CH_JMP.x0 + 2 * PITCH, CH_JMP.z - 2.2, 0.82)
  ;['GND', '3V3', '5V', 'TXD', 'RXD', 'DTR'].forEach((t, i) => P.text(t, i * PITCH, -2.3, 0.8))
  for (const l of CH_LEDS) {
    P.chipPads(l.x, l.z)
    P.chipPads(-0.6, l.z)
    P.text(l.id, 3.2, l.z, 0.78, { align: 'left' })
  }
  P.soicPads(SOIC16, CH_CHIP.x, CH_CHIP.z, 0)
  P.dot(CH_CHIP.x - 3.6, CH_CHIP.z - 5.4, 0.3)
  P.pad(CH_XTAL.x, CH_XTAL.z - 5.6, 1.8, 2.0)
  P.pad(CH_XTAL.x, CH_XTAL.z + 5.6, 1.8, 2.0)
  P.rect(CH_XTAL.x, CH_XTAL.z, 5.5, 12.2)
  P.chipPads(CH_CAPS[0][0], CH_CAPS[0][1])
  P.chipPads(CH_CAPS[1][0], CH_CAPS[1][1])
  P.chipPads(CH_CAPS[2][0], CH_CAPS[2][1])
  // USB plug tab lands
  P.pad(1.0, -34.6, 2.4, 2.0)
  P.pad(11.7, -34.6, 2.4, 2.0)
  P.text('USB-TTL', 10.9, -29.8, 1.0)
  P.text('CH340G', 10.9, -31.5, 0.82)
}

function ch340Statics(): StaticPart[] {
  return designStatics('ch340', CH_C, (parts) => {
    flatBoard(parts, { key: 'ch340', ...CH_BOARD, y0: SPACER * MM, palette: 'red', paint: paintCh340 })
    underHeader(parts, [CH_PINS])
    topHeader(parts, CH_JMP.x0, CH_JMP.z, 3, Y_TOP)
    for (const l of CH_LEDS) {
      ledBase(parts, l.x, l.z)
      chip(parts, 'R', -0.6, l.z)
    }
    soic(parts, SOIC16, CH_CHIP.x, CH_CHIP.z, 0)
    crystalHc49Smd(parts, CH_XTAL.x, CH_XTAL.z, Math.PI / 2)
    for (const [x, z] of CH_CAPS) chip(parts, 'C', x, z)
    usbAPlug(parts, 6.35, CH_USB.z, CH_USB.len, Y_TOP + LIFT)
  })
}

function buildCh340(comp: ComponentInstance, entry: CatalogEntry, pins: THREE.Vector3[]): BuildResult {
  const ghost = isGhost(comp)
  const { group, inner } = moduleInstance(pins, 0, 5, CH_C)
  addStatics(group, ch340Statics())
  // logic-level shunt: over 3V3 · VCC (3.3V) or VCC · 5V (5V)
  const shunt = new THREE.Mesh(shuntGeometry(), shuntPlastic(0x1a1a1c))
  shunt.position.set(0, Y_TOP + 2.5 * MM, CH_JMP.z * MM)
  inner.add(shunt)
  const setShunt = (v: unknown) => {
    shunt.position.x = (CH_JMP.x0 + (pick(v, '5V') === '3.3V' ? 0.5 : 1.5) * PITCH) * MM
  }
  setShunt(paramOf(comp.params, entry, 'logic'))
  const leds: Partial<Record<string, LedRig>> = {}
  for (const l of CH_LEDS) leds[l.id] = ledLens(inner, l.color, l.x, l.z, ghost)
  if (!ghost) {
    marking(inner, 'ch340g', ['CH340G', fakeLotCode('CH340G')], 7.0, 3.2, CH_CHIP.x, Y_TOP + LIFT + (SOIC16.H + 0.12) * MM, CH_CHIP.z, Math.PI / 2)
    marking(inner, 'ch340-xtal', ['12.000'], 7.0, 1.6, CH_XTAL.x, Y_TOP + LIFT + 3.7 * MM, CH_XTAL.z, Math.PI / 2)
  }
  return {
    object: group,
    pinWorld: pins.map((p) => p.clone()),
    update: (c2, e2, t: ComponentTelemetry | null) => {
      setShunt(paramOf(c2.params, e2, 'logic'))
      if (ghost) return
      applyLed(leds.PWR ?? null, subLed(t, 'LED_PWR'))
      applyLed(leds.TXD ?? null, logicLed(t?.leds?.TX))
      applyLed(leds.RXD ?? null, logicLed(t?.leds?.RX))
    },
  }
}

// ---------------------------------------------------------------------------
// HC-05 on the ZS-040 carrier, standing upright on its right-angle header
// (pins row e: STATE RXD TXD GND VCC EN; component side facing +z)
// ---------------------------------------------------------------------------

const BT_PINS = rowPins(6)
const BT_C = layoutCentroid(BT_PINS)
const BT_W = 15.5
const BT_L = 37.3
/** carrier bottom edge above the breadboard; its back face rests on the header plastic */
const BT_Y0 = 0.9
const BT_BACK_Z = 1.25
/** right-angle header plastic body: 2.5 × 2.5 mm, 1.0 mm above the breadboard */
const BT_HDR_Y = 1.0
/** right-angle pin ends proud of the component face */
const BT_PROUD = 1.2
/**
 * Carrier "flat" frame (built lying down, then stood up): x across, +y the
 * component face, +z toward the bottom edge (the header).
 */
const BT_HOLE_Z = BT_L / 2 - 1.35
const BT_CORE = { x: 0, z: -BT_L / 2 + 0.2 + 13.5, w: 13.0, d: 27.0, t: 0.8 }
const BT_LED = { x: 4.6, z: 12.2 }
export const HC05_TOP = (BT_Y0 + BT_L) * MM

function paintZs040(p: PcbPainter): void {
  const pins = rowPins(6, BT_HOLE_Z, -2.5)
  const P = painterAt(p, 0, 0)
  P.copper(0, 9.1, 12.5, 0.8) // ground strap under the core's bottom castellations
  P.traces(
    [
      [[pins[4][0], BT_HOLE_Z], [pins[4][0], 14.2], [-3.65, 12.6]],
      [[pins[1][0], BT_HOLE_Z], [pins[1][0], 13.4], [-2.6, 10.0], [-2.6, 8.4]],
      [[pins[2][0], BT_HOLE_Z], [pins[2][0], 13.0], [-0.6, 10.0], [-0.6, 8.4]],
      [[pins[0][0], BT_HOLE_Z], [pins[0][0], 15.0], [5.4, 13.6], [5.4, 12.2]],
      [[pins[5][0], BT_HOLE_Z], [pins[5][0], 14.0], [2.3, 12.4]],
      [
        [-4.6, 10.6],
        [-4.6, 8.4],
      ],
    ],
    0.3,
  )
  P.header(pins)
  P.pad(-4.6, 11.6, 2.9, 2.4)
  P.chipPads(BT_LED.x, BT_LED.z)
  P.chipPads(4.6, 14.9)
  P.chipPads(-4.6, 14.9)
  P.chipPads(-1.6, 15.2)
  P.rect(0.5, 11.6, 4.6, 3.6)
  P.text('KEY', 0.5, 9.75, 0.75)
  ;['STATE', 'RXD', 'TXD', 'GND', 'VCC', 'EN'].forEach((t, i) => P.text(t, pins[i][0], BT_HOLE_Z - 1.45, 0.6))
}

function paintHc05Core(p: PcbPainter): void {
  const P = painterAt(p, 0, 0)
  // castellated edge pads along both long sides
  for (let z = -5.5; z <= 13.0; z += 1.5) {
    P.pad(-6.2, z, 1.2, 0.9)
    P.pad(6.2, z, 1.2, 0.9)
  }
  // meander PCB antenna at the top end
  const meander: Pt[] = [[-5.5, -12.6]]
  for (let i = 0; i < 6; i++) {
    const x = -5.5 + i * 1.9
    meander.push([x, -8.4], [x + 0.95, -8.4], [x + 0.95, -12.6], [x + 1.9, -12.6])
  }
  P.traces([meander], 0.45)
  P.traces(
    [
      [
        [0, -7.6],
        [0, -7.0],
      ],
      [
        [-3.0, -3.0],
        [-5.4, -3.0],
      ],
      [
        [3.0, -2.0],
        [5.4, -2.0],
      ],
      [
        [-1.5, 2.0],
        [-5.4, 4.0],
      ],
      [
        [3.5, 3.4],
        [5.4, 4.6],
      ],
    ],
    0.25,
  )
  for (const [x, z] of [
    [-4.2, -6.8],
    [4.2, -6.8],
    [-4.2, 9.6],
    [4.0, 9.2],
  ] as Pt[])
    P.via(x, z)
  P.text('HC-05', 0.4, 10.4, 0.9)
}

function hc05Statics(): StaticPart[] {
  return designStatics('hc05', BT_C, (parts) => {
    // right-angle header: plastic body on the breadboard side, pin tails into the holes
    const strip = new THREE.Mesh(slabGeometry(6 * PITCH * MM - 0.01, 2.5 * MM, 2.5 * MM), headerPlasticMaterial())
    put(parts, strip, 6.35, (BT_HDR_Y + 1.25) * MM, 0)
    const tail = slabGeometry(0.64 * MM, BT_HDR_Y * MM, 0.64 * MM)
    for (const [x] of BT_PINS) put(parts, new THREE.Mesh(tail, tinnedPost()), x, (BT_HDR_Y / 2) * MM, 0)

    // the carrier + everything on it, built flat then stood up (+y → +z, flat +z → −y)
    const flat: THREE.Object3D[] = []
    flatBoard(flat, { key: 'zs040', x: 0, z: 0, w: BT_W, d: BT_L, y0: 0, palette: 'blue', paint: paintZs040 })
    const t = PCB_T * MM
    const post = headerPostGeometry(0.32 * MM, BT_PROUD * MM, 0.16 * MM)
    const fillet = solderFilletGeometry(0.8 * MM, 0.36 * MM, 0.55 * MM)
    for (const [x, z] of rowPins(6, BT_HOLE_Z, -2.5)) {
      put(flat, new THREE.Mesh(post, tinnedPost()), x, t, z)
      put(flat, new THREE.Mesh(fillet, solderMaterial()), x, t + 0.002, z)
    }
    sot23(flat, -4.6, 11.6, 0, t)
    tactSwitch(flat, 0.5, 11.6, t)
    ledBase(flat, BT_LED.x, BT_LED.z, 0, t)
    chip(flat, 'R', 4.6, 14.9, 0, t)
    chip(flat, 'R', -4.6, 14.9, 0, t)
    chip(flat, 'C', -1.6, 15.2, 0, t)
    // the HC-05 core (green, 0.8 mm, castellated) soldered flat on the carrier
    const coreY = t + 0.004
    flatBoard(flat, { key: 'hc05-core', ...BT_CORE, y0: coreY, palette: 'green', paint: paintHc05Core, thickness: BT_CORE.t })
    const coreTop = coreY + BT_CORE.t * MM
    // CSR BC417 (6 × 6 BGA), 8 Mbit flash (5 × 5), 26 MHz crystal, decoupling
    qfn(flat, 6.0, 1.0, 0, BT_CORE.z - 4.5, coreTop)
    qfn(flat, 5.0, 1.0, 1.0, BT_CORE.z + 3.0, coreTop)
    crystal3225(flat, -4.0, BT_CORE.z - 0.6, coreTop)
    chip(flat, 'C', -4.0, BT_CORE.z + 4.4, 90, coreTop)
    chip(flat, 'C', 4.5, BT_CORE.z + 6.2, 90, coreTop)
    chip(flat, 'R', -1.8, BT_CORE.z + 7.4, 0, coreTop)
    const stand = new THREE.Group()
    for (const o of flat) stand.add(o)
    stand.rotation.x = Math.PI / 2
    stand.position.set(6.35 * MM, (BT_Y0 + BT_L / 2) * MM, BT_BACK_Z * MM)
    parts.push(stand)
  })
}

function buildHc05(comp: ComponentInstance, _entry: CatalogEntry, pins: THREE.Vector3[]): BuildResult {
  const ghost = isGhost(comp)
  const { group, inner } = moduleInstance(pins, 0, 5, BT_C)
  addStatics(group, hc05Statics())
  // per-instance pieces live in the same stood-up carrier frame
  const face = new THREE.Group()
  face.rotation.x = Math.PI / 2
  face.position.set(6.35 * MM, (BT_Y0 + BT_L / 2) * MM, BT_BACK_Z * MM)
  inner.add(face)
  const led = ledLens(face, 'red', BT_LED.x, BT_LED.z, ghost, PCB_T * MM)
  if (!ghost) {
    const y = (PCB_T + BT_CORE.t + 1.0) * MM + 3 * LIFT
    marking(face, 'bc417', ['CSR', 'BC417143B', fakeLotCode('BC417')], 5.2, 5.2, 0, y, BT_CORE.z - 4.5)
  }
  return {
    object: group,
    pinWorld: pins.map((p) => p.clone()),
    update: (_c2, _e2, t) => {
      if (!ghost) applyLed(led, logicLed(t?.leds?.LED))
    },
  }
}

// ---------------------------------------------------------------------------
// MAX485 RS-485 module (logic header RO RE DE DI in row h, bus header
// VCC B A GND in row c; the board spans rows c … h over the channel)
// ---------------------------------------------------------------------------

const RS_BUS = -6 * PITCH
const RS_PINS: Pt[] = [...rowPins(4), ...rowPins(4, RS_BUS)]
const RS_C = layoutCentroid(RS_PINS)
const RS_BOARD = { x: 3.81, z: -7.62, w: 12.4, d: 17.6 }
/** SOIC-8, lead rows along x: upper row z −5.35 (pins 1–4), lower −9.85; x 1.905 … 5.715 */
const RS_CHIP = { x: 3.81, z: -7.6 }
const RS_LED = { x: 8.6, z: -12.0 }
export const MAX485_TOP = Y_TOP + LIFT + (SOIC8.H + 0.12) * MM + DECAL

function paintMax485(p: PcbPainter): void {
  const P = painterAt(p, RS_BOARD.x, RS_BOARD.z)
  P.traces(
    [
      // RO / RE / DE / DI pads → pull-ups → chip pins 1–4
      ...[0, 1, 2, 3].map((i): Pt[] => [
        [i * PITCH, 0],
        [i * PITCH, -2.2],
        [1.905 + i * 1.27, -4.0],
        [1.905 + i * 1.27, -5.35],
      ]),
      // A / B pads → bias + termination → chip pins 6 / 7
      [
        [5.08, RS_BUS],
        [5.08, -12.0],
        [4.445, -9.85],
      ],
      [
        [2.54, RS_BUS],
        [2.54, -12.0],
        [3.175, -9.85],
      ],
      // VCC up the left edge (decoupling cap on the way), GND to the LED leg
      [
        [0, RS_BUS],
        [0, -13.6],
        [-1.0, -13.0],
        [-1.0, -2.0],
      ],
      [
        [7.62, RS_BUS],
        [7.62, -13.6],
        [8.6, -12.8],
      ],
    ],
    0.3,
  )
  P.via(-1.0, -2.0)
  P.header(RS_PINS.slice(0, 4))
  P.header(RS_PINS.slice(4), false)
  P.soicPads(SOIC8, RS_CHIP.x, RS_CHIP.z, Math.PI / 2)
  P.dot(RS_CHIP.x - 3.1, RS_CHIP.z + 2.6, 0.28)
  for (let i = 0; i < 4; i++) P.chipPads(i * PITCH, -3.2, 90)
  for (let i = 0; i < 3; i++) P.chipPads(i * PITCH, -12.0, 90)
  P.chipPads(RS_LED.x, RS_LED.z, 90)
  P.chipPads(8.6, -7.6, 90)
  P.chipPads(-1.0, -7.6, 90)
  ;['RO', 'RE', 'DE', 'DI'].forEach((t, i) => P.text(t, i * PITCH, -1.3, 0.7))
  ;['VCC', 'B', 'A', 'GND'].forEach((t, i) => P.text(t, i * PITCH, -13.9, 0.64))
}

function max485Statics(): StaticPart[] {
  return designStatics('max485', RS_C, (parts) => {
    flatBoard(parts, { key: 'max485', ...RS_BOARD, y0: SPACER * MM, palette: 'blue', paint: paintMax485 })
    underHeader(parts, [RS_PINS.slice(0, 4), RS_PINS.slice(4)])
    soic(parts, SOIC8, RS_CHIP.x, RS_CHIP.z, Math.PI / 2)
    for (let i = 0; i < 4; i++) chip(parts, 'R', i * PITCH, -3.2, 90)
    for (let i = 0; i < 3; i++) chip(parts, 'R', i * PITCH, -12.0, 90)
    ledBase(parts, RS_LED.x, RS_LED.z, 90)
    chip(parts, 'R', 8.6, -7.6, 90)
    chip(parts, 'C', -1.0, -7.6, 90)
  })
}

function buildMax485(comp: ComponentInstance, _entry: CatalogEntry, pins: THREE.Vector3[]): BuildResult {
  const ghost = isGhost(comp)
  const { group, inner } = moduleInstance(pins, 0, 3, RS_C)
  addStatics(group, max485Statics())
  const led = ledLens(inner, 'red', RS_LED.x, RS_LED.z, ghost, Y_TOP, 90)
  if (!ghost) marking(inner, 'max485', ['MAX485', 'CSA ' + fakeLotCode('MAX485').slice(0, 4)], 4.2, 2.6, RS_CHIP.x, MAX485_TOP - DECAL, RS_CHIP.z)
  return {
    object: group,
    pinWorld: pins.map((p) => p.clone()),
    update: (_c2, _e2, t) => {
      if (!ghost) applyLed(led, subLed(t, 'LED_PWR'))
    },
  }
}

// ---------------------------------------------------------------------------
// W25Q32 SPI-flash breakout (CS DO WP GND DI CLK HOLD VCC in row e; the
// board lies over the channel and rows f – j)
// ---------------------------------------------------------------------------

const FL_PINS = rowPins(8)
const FL_C = layoutCentroid(FL_PINS)
const FL_BOARD = { x: 8.89, z: 7.1, w: 22.0, d: 18.0 }
/** 208-mil SOIC-8, lead rows along x: lower row z 6.0 (pins 1–4), upper 12.4 (pins 8–5) */
const FL_CHIP = { x: 8.89, z: 9.2 }
export const W25Q_TOP = Y_TOP + LIFT + (SOIC8W.H + 0.12) * MM + DECAL

function paintW25q(p: PcbPainter): void {
  const P = painterAt(p, FL_BOARD.x, FL_BOARD.z)
  const pinX = (k: number) => FL_CHIP.x - 1.905 + k * 1.27
  const lowZ = FL_CHIP.z - 3.2
  const upZ = FL_CHIP.z + 3.2
  P.traces(
    [
      // CS, DO, WP, GND → pins 1–4
      ...[0, 1, 2, 3].map((i): Pt[] => [
        [i * PITCH, 0],
        [i * PITCH, 2.6],
        [pinX(i), lowZ],
      ]),
      // DI, CLK, HOLD, VCC → pins 5–8 round the right end (DI innermost)
      ...[4, 5, 6, 7].map((i): Pt[] => {
        const j = i - 4
        const zH = 4.4 - j * 0.7
        const xO = 14.0 + j * 0.8
        const zT = 13.0 + j * 0.55
        const xP = pinX(3 - j)
        return [
          [i * PITCH, 0],
          [i * PITCH, zH],
          [xO, zH],
          [xO, zT],
          [xP, zT],
          [xP, upZ],
        ]
      }),
    ],
    0.3,
  )
  P.header(FL_PINS)
  P.soicPads(SOIC8W, FL_CHIP.x, FL_CHIP.z, Math.PI / 2)
  P.chipPads(16.4, 9.2, 90)
  P.dot(FL_CHIP.x - 3.5, FL_CHIP.z - 1.9, 0.32)
  ;['CS', 'DO', 'WP', 'GND', 'DI', 'CLK', 'HOLD', 'VCC'].forEach((t, i) => P.text(t, i * PITCH + 0.05, 3.3, 0.74, { rot: -Math.PI / 2 }))
  P.text('W25Q32 SPI FLASH', 8.89, 15.25, 0.95)
}

function w25qStatics(): StaticPart[] {
  return designStatics('w25q', FL_C, (parts) => {
    flatBoard(parts, { key: 'w25q', ...FL_BOARD, y0: SPACER * MM, palette: 'purple', paint: paintW25q })
    underHeader(parts, [FL_PINS])
    soic(parts, SOIC8W, FL_CHIP.x, FL_CHIP.z, Math.PI / 2)
    chip(parts, 'C', 16.4, 9.2, 90)
  })
}

function buildW25q(comp: ComponentInstance, _entry: CatalogEntry, pins: THREE.Vector3[]): BuildResult {
  const { group, inner } = moduleInstance(pins, 0, 7, FL_C)
  addStatics(group, w25qStatics())
  if (!isGhost(comp)) marking(inner, 'w25q32', ['winbond', '25Q32JVSIQ', fakeLotCode('W25Q32')], 4.6, 4.2, FL_CHIP.x, W25Q_TOP - DECAL, FL_CHIP.z)
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

// ---------------------------------------------------------------------------
// micro-SD module (GND VCC MISO MOSI SCK CS in row e; 24 × 42 mm board over
// the channel and the lower rows, socket at the far end)
// ---------------------------------------------------------------------------

const SD_PINS = rowPins(6)
const SD_C = layoutCentroid(SD_PINS)
const SD_BOARD = { x: 6.35, z: 18.8, w: 24.0, d: 42.0 }
/** 74LVC125A SOIC-14, lead rows along x: lower z 10.15 (inputs), upper 14.65; x 2.54 … 10.16 */
const SD_BUF = { x: 6.35, z: 12.4 }
const SD_LDO = { x: 14.8, z: 9.6 }
const SD_SOCKET = { x: 6.35, z: 31.9, w: 14.0, d: 15.0, h: 1.85 }
/** 0603 parts: [x, z, rotDeg] — four series / pull-up resistors, then the capacitors */
const SD_CHIPS: [number, number, number][] = [
  [2.6, 18.6, 90],
  [5.1, 18.6, 90],
  [7.6, 18.6, 90],
  [10.1, 18.6, 90],
  [12.2, 15.6, 0],
  [16.6, 15.6, 0],
  [11.0, 6.4, 90],
]
export const SD_TOP = Y_TOP + LIFT + SD_SOCKET.h * MM + 0.12 * MM

function paintSd(p: PcbPainter): void {
  const P = painterAt(p, SD_BOARD.x, SD_BOARD.z)
  const bufX = (k: number) => SD_BUF.x + (k - 3) * 1.27
  P.copper(-4.4, 20.0, 1.6, 36.0) // GND pour (left edge)
  P.traces(
    [
      [
        [0, 0],
        [0, 2.0],
        [-4.4, 4.0],
      ],
      // VCC (5 V) round the right edge to the regulator input
      [
        [2.54, 0],
        [2.54, 1.6],
        [12.0, 2.4],
        [17.4, 4.0],
        [17.4, 11.6],
        [17.1, 12.6],
      ],
      // 3.3 V from the tab to the buffer supply
      [
        [13.1, 7.0],
        [11.0, 7.2],
        [11.4, 8.0],
        [11.4, 13.8],
        [bufX(6), 14.65],
      ],
      // MISO / MOSI / SCK / CS → the buffer's lower row
      ...[2, 3, 4, 5].map((i): Pt[] => [
        [i * PITCH, 0],
        [i * PITCH, 5.4],
        [bufX(i - 1), 10.15],
      ]),
      // buffer outputs → series resistors → socket contacts
      ...[0, 1, 2, 3].map((k): Pt[] => [
        [bufX(k), 14.65],
        [2.6 + k * 2.5, 17.0],
        [2.6 + k * 2.5, 21.0],
        [3.2 + k * 2.0, 24.6],
      ]),
    ],
    0.3,
  )
  P.header(SD_PINS)
  P.soicPads(SOIC14, SD_BUF.x, SD_BUF.z, Math.PI / 2)
  P.dot(SD_BUF.x - 4.9, SD_BUF.z - 2.6, 0.3)
  P.pad(SD_LDO.x, SD_LDO.z - 2.6, 3.4, 2.0)
  for (const dx of [-2.3, 0, 2.3]) P.pad(SD_LDO.x + dx, SD_LDO.z + 3.0, 0.95, 1.6)
  for (const [x, z, r] of SD_CHIPS) P.chipPads(x, z, r)
  ;['GND', 'VCC', 'MISO', 'MOSI', 'SCK', 'CS'].forEach((t, i) => P.text(t, i * PITCH + 0.05, 3.5, 0.78, { rot: -Math.PI / 2 }))
  P.text('MicroSD Card Adapter', 6.35, 22.4, 1.05)
  P.rect(SD_SOCKET.x, SD_SOCKET.z, SD_SOCKET.w + 0.6, SD_SOCKET.d + 0.4)
  P.mountHole(-3.2, 36.6)
  P.mountHole(15.9, 36.6)
}

function sdStatics(): StaticPart[] {
  return designStatics('sdcard', SD_C, (parts) => {
    flatBoard(parts, { key: 'sdcard', ...SD_BOARD, y0: SPACER * MM, palette: 'blue', paint: paintSd })
    underHeader(parts, [SD_PINS])
    soic(parts, SOIC14, SD_BUF.x, SD_BUF.z, Math.PI / 2)
    sot223(parts, SD_LDO.x, SD_LDO.z, 0)
    SD_CHIPS.forEach(([x, z, r], i) => chip(parts, i < 4 ? 'R' : 'C', x, z, r))
    // push-push micro-SD socket: drawn steel shell, dark slot, the card inserted
    const s = SD_SOCKET
    const shell = new THREE.Mesh(slabGeometry(s.w * MM, s.h * MM, s.d * MM, { bottom: true }), steel())
    put(parts, shell, s.x, Y_TOP + LIFT + (s.h / 2) * MM, s.z)
    for (const dx of [-3.0, 3.0]) {
      const rib = new THREE.Mesh(slabGeometry(0.8 * MM, 0.12 * MM, 9.0 * MM, { bottom: true }), satinMetal())
      put(parts, rib, s.x + dx, Y_TOP + LIFT + s.h * MM, s.z - 1.0)
    }
    const slot = new THREE.Mesh(slabGeometry(11.6 * MM, 1.1 * MM, 0.2 * MM), cavity())
    put(parts, slot, s.x, Y_TOP + LIFT + 0.75 * MM, s.z + s.d / 2 + 0.05)
    const card = new THREE.Mesh(slabGeometry(11.0 * MM, 0.7 * MM, 4.4 * MM), nylon(0x1c1c20))
    put(parts, card, s.x, Y_TOP + LIFT + 0.75 * MM, s.z + s.d / 2 + 1.0)
    for (const dx of [-7.3, 7.3]) {
      const tab = new THREE.Mesh(slabGeometry(0.6 * MM, 0.3 * MM, 2.0 * MM, { bottom: true }), steel())
      put(parts, tab, s.x + dx, Y_TOP + LIFT, s.z + 4.0)
    }
  })
}

function buildSd(comp: ComponentInstance, entry: CatalogEntry, pins: THREE.Vector3[]): BuildResult {
  const { group, inner } = moduleInstance(pins, 0, 5, SD_C)
  addStatics(group, sdStatics())
  if (!isGhost(comp)) {
    marking(inner, 'lvc125', ['LVC125A', fakeLotCode('74LVC125')], 7.0, 2.6, SD_BUF.x, Y_TOP + LIFT + (SOIC14.H + 0.12) * MM, SD_BUF.z)
    marking(inner, 'ams1117-sd', ['AMS1117', '3.3'], 5.4, 2.8, SD_LDO.x, Y_TOP + LIFT + 1.7 * MM, SD_LDO.z)
    // card label on the protruding end (the card param picks SDHC / SDSC)
    const kind = pick(paramOf(comp.params, entry, 'card'), 'sdhc') === 'sdsc' ? 'SDSC 128MB' : 'SDHC 4GB'
    const lbl = printMaterial(`sd-card:${kind}`, 256, 96, [
      { text: 'microSD', y: 0.36, size: 0.42, color: '#e9e9ec' },
      { text: kind, y: 0.78, size: 0.3, color: '#b9bcc4', weight: 600 },
    ])
    topLabel(inner, lbl, 9.0, 3.4, SD_SOCKET.x, Y_TOP + LIFT + 1.1 * MM + 0.004, SD_SOCKET.z + SD_SOCKET.d / 2 + 1.1)
  }
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

// ---------------------------------------------------------------------------
// PCF8574 I/O expander (P0–P7 in row h, GND VCC SDA SCL INT in row c at
// dCol 1–5; A0–A2 address shunts on the right)
// ---------------------------------------------------------------------------

const PCF_BUS = -6 * PITCH
const PCF_PINS: Pt[] = [...rowPins(8), ...rowPins(5, PCF_BUS, 1)]
const PCF_C = layoutCentroid(PCF_PINS)
const PCF_BOARD = { x: 8.89, z: -7.62, w: 20.5, d: 17.6 }
/** SO-16 wide (PCF8574T), lead rows along x: upper z −3.22 (ports), lower −12.02; x 1.555 … 10.445 */
const PCF_CHIP = { x: 6.0, z: -7.62 }
/** address jumper headers A0, A1, A2: 3 pins along z (VCC · A · GND) */
const PCF_JX = [12.7, 15.24, 17.78]
const PCF_JZ = -7.62
export const PCF8574_TOP = Y_TOP + (2.5 + 6.0) * MM

function paintPcf(p: PcbPainter): void {
  const P = painterAt(p, PCF_BOARD.x, PCF_BOARD.z)
  const pinX = (k: number) => PCF_CHIP.x + (k - 3.5) * 1.27
  P.traces(
    [
      // P0–P7 pads → the upper lead row
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i): Pt[] => [
        [i * PITCH, 0],
        [i * PITCH, -1.2],
        [pinX(i), -2.6],
      ]),
      // GND / VCC / SDA / SCL / INT → the lower lead row
      ...[1, 2, 3, 4, 5].map((d): Pt[] => [
        [d * PITCH, PCF_BUS],
        [d * PITCH, -13.6],
        [pinX(d + 1), -12.6],
      ]),
    ],
    0.28,
  )
  // A0–A2 reach the jumpers on the bottom layer
  for (const x of PCF_JX) P.via(x, -12.0)
  P.header(PCF_PINS.slice(0, 8))
  P.header(PCF_PINS.slice(8), false)
  P.soicPads(SOIC16W, PCF_CHIP.x, PCF_CHIP.z, Math.PI / 2)
  P.dot(PCF_CHIP.x - 5.6, PCF_CHIP.z - 4.0, 0.3)
  for (const x of PCF_JX) for (let k = -1; k <= 1; k++) P.padC(x, PCF_JZ + k * PITCH, 0.8)
  ;['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'].forEach((t, i) => P.text(t, i * PITCH, -1.6, 0.7))
  ;['GND', 'VCC', 'SDA', 'SCL', 'INT'].forEach((t, i) => P.text(t, (i + 1) * PITCH, -13.55, 0.62))
  ;['A0', 'A1', 'A2'].forEach((t, i) => P.text(t, PCF_JX[i], -2.85, 0.7))
  P.chipPads(-0.5, PCF_CHIP.z, 90)
  P.chipPads(15.24, -13.0)
  P.chipPads(17.78, -13.0)
  P.text('PCF8574', 16.3, -15.25, 0.88)
}

function pcfStatics(): StaticPart[] {
  return designStatics('pcf8574', PCF_C, (parts) => {
    flatBoard(parts, { key: 'pcf8574', ...PCF_BOARD, y0: SPACER * MM, palette: 'blue', paint: paintPcf })
    underHeader(parts, [PCF_PINS.slice(0, 8), PCF_PINS.slice(8)])
    soic(parts, SOIC16W, PCF_CHIP.x, PCF_CHIP.z, Math.PI / 2)
    for (const x of PCF_JX) topHeader(parts, x, PCF_JZ - PITCH, 3, Y_TOP, 'z')
    chip(parts, 'C', -0.5, PCF_CHIP.z, 90)
    chip(parts, 'R', 15.24, -13.0)
    chip(parts, 'R', 17.78, -13.0)
  })
}

function buildPcf(comp: ComponentInstance, entry: CatalogEntry, pins: THREE.Vector3[]): BuildResult {
  const { group, inner } = moduleInstance(pins, 0, 7, PCF_C)
  addStatics(group, pcfStatics())
  // one blue shunt per address bit: VCC side (bit = 1, −z) or GND side (bit = 0, +z)
  const shunts = PCF_JX.map((x) => {
    const m = new THREE.Mesh(shuntGeometry(), shuntPlastic(0x2456c8))
    m.rotation.y = Math.PI / 2
    m.position.set(x * MM, Y_TOP + 2.5 * MM, PCF_JZ * MM)
    inner.add(m)
    return m
  })
  const setAddress = (v: unknown) => {
    const s = pick(v, '0x20')
    const n = parseInt(s, s.startsWith('0x') ? 16 : 10)
    const a = Number.isFinite(n) ? (n - 0x20) & 7 : 0
    shunts.forEach((m, k) => {
      m.position.z = (PCF_JZ + ((a >> k) & 1 ? -0.5 : 0.5) * PITCH) * MM
    })
  }
  setAddress(paramOf(comp.params, entry, 'address'))
  if (!isGhost(comp)) {
    marking(inner, 'pcf8574t', ['PCF8574T', fakeLotCode('PCF8574')], 8.4, 4.4, PCF_CHIP.x, Y_TOP + LIFT + (SOIC16W.H + 0.12) * MM, PCF_CHIP.z)
  }
  return {
    object: group,
    pinWorld: pins.map((p) => p.clone()),
    update: (c2, e2) => setAddress(paramOf(c2.params, e2, 'address')),
  }
}

// ---------------------------------------------------------------------------
// ESP-01 lying on its 1×8 breadboard adapter (GND GPIO2 GPIO0 RXD TXD
// CH_PD RST VCC in row e; the module overhangs the channel and rows f – j)
// ---------------------------------------------------------------------------

const ESP_PINS = rowPins(8)
const ESP_C = layoutCentroid(ESP_PINS)
const ESP_ADAPTER = { x: 8.89, z: 2.65, w: 21.0, d: 8.5 }
/** 2×4 female socket on the adapter: rows z 2.54 / 5.08, columns x 5.08 … 12.7, 8.5 mm tall */
const ESP_SOCK = { x: 8.89, z: 3.81, h: 8.5 }
/** ESP-01 board (24.8 × 14.3 × 1.0), header end over the socket, overhanging toward +z */
const ESP_BOARD = { x: 8.89, z: 3.81 - 1.27 + 10.7, w: 14.3, d: 24.8, t: 1.0 }
/** ESP-01 bottom face: adapter + socket + its own header plastic */
const ESP_Y0 = (SPACER + PCB_T + ESP_SOCK.h + 2.5) * MM
export const ESP01_TOP = ESP_Y0 + ESP_BOARD.t * MM + LIFT + (SOIC8.H + 0.12) * MM + DECAL

/** ESP-01 header pins in its board-centered frame: 2 rows × 4 */
const ESP_HDR: Pt[] = [-3.81, -1.27, 1.27, 3.81].flatMap((x) => [[x, -10.7] as Pt, [x, -8.16] as Pt])
const ESP_LED_PWR: Pt = [-5.4, -8.6]
const ESP_LED_TX: Pt = [-5.4, -6.6]

function paintEspAdapter(p: PcbPainter): void {
  const P = painterAt(p, ESP_ADAPTER.x, ESP_ADAPTER.z)
  P.traces(
    ESP_PINS.map(([x], i): Pt[] => [
      [x, 0],
      [x, 0.9],
      [ESP_SOCK.x - 3.81 + (i >> 1) * PITCH, i & 1 ? 5.08 : 2.54],
    ]),
    0.3,
  )
  P.header(ESP_PINS)
  ;['GND', 'IO2', 'IO0', 'RX', 'TX', 'EN', 'RST', '3V3'].forEach((t, i) => P.text(t, i * PITCH, -1.05, 0.56))
  P.text('ESP-01', 16.4, 5.6, 0.78)
}

function paintEsp01(p: PcbPainter): void {
  const P = painterAt(p, 0, 0)
  // printed meander antenna at the far end, fed from the chip's RF pin
  const ant: Pt[] = [[-5.6, 5.8]]
  for (let i = 0; i < 5; i++) {
    const x = -5.6 + i * 2.3
    ant.push([x, 11.6], [x + 1.15, 11.6], [x + 1.15, 6.6], [x + 2.3, 6.6])
  }
  P.traces([ant], 0.5)
  P.traces(
    [
      [
        [4.0, -3.6],
        [5.6, -3.6],
        [5.6, 6.6],
      ],
      [
        [-1.0, -1.1],
        [-1.0, -0.4],
      ],
      [
        [-2.4, -3.4],
        [-1.0, -3.4],
      ],
      ...ESP_HDR.map(([x, z]): Pt[] => [
        [x, z],
        [x * 0.55, z + 2.6],
        [1.5 + x * 0.42, -6.1],
      ]),
    ],
    0.25,
  )
  for (const [x, z] of ESP_HDR) {
    P.padC(x, z, 0.75)
    P.via(x, z, 0.4)
  }
  P.pad(1.5, -3.6, 5.6, 5.6)
  P.soicPads(SOIC8, -0.5, 2.5, Math.PI / 2)
  P.pad(-4.0, -3.4, 3.4, 2.7)
  P.chipPads(ESP_LED_PWR[0], ESP_LED_PWR[1])
  P.chipPads(ESP_LED_TX[0], ESP_LED_TX[1])
  P.chipPads(4.9, -7.4, 90)
  P.chipPads(-5.6, 0.6, 90)
}

function espStatics(): StaticPart[] {
  return designStatics('esp01', ESP_C, (parts) => {
    flatBoard(parts, { key: 'esp-adapter', ...ESP_ADAPTER, y0: SPACER * MM, palette: 'black', paint: paintEspAdapter })
    underHeader(parts, [ESP_PINS])
    // 2×4 female socket (black, 8.5 mm tall)
    const sock = new THREE.Mesh(slabGeometry(4 * PITCH * MM - 0.01, ESP_SOCK.h * MM, 2 * PITCH * MM - 0.01, { bottom: true }), headerPlasticMaterial())
    put(parts, sock, ESP_SOCK.x, Y_TOP + (ESP_SOCK.h / 2) * MM, ESP_SOCK.z)
    // the ESP-01's own 2×4 male header plastic between the socket and its board
    const plast = new THREE.Mesh(
      slabGeometry(4 * PITCH * MM - 0.01, 2.5 * MM - 0.004, 2 * PITCH * MM - 0.01, { top: true, bottom: true }),
      headerPlasticMaterial(),
    )
    put(parts, plast, ESP_SOCK.x, Y_TOP + (ESP_SOCK.h + 1.25) * MM, ESP_SOCK.z)
    // the ESP-01 (blue), built in its own board-centered frame
    const esp: THREE.Object3D[] = []
    flatBoard(esp, { key: 'esp01', x: 0, z: 0, w: ESP_BOARD.w, d: ESP_BOARD.d, y0: 0, palette: 'blue', paint: paintEsp01, thickness: ESP_BOARD.t })
    const top = ESP_BOARD.t * MM
    const post = headerPostGeometry(0.32 * MM, 1.4 * MM, 0.16 * MM)
    const fillet = solderFilletGeometry(0.75 * MM, 0.36 * MM, 0.5 * MM)
    for (const [x, z] of ESP_HDR) {
      put(esp, new THREE.Mesh(post, tinnedPost()), x, top, z)
      put(esp, new THREE.Mesh(fillet, solderMaterial()), x, top + 0.002, z)
    }
    qfn(esp, 5.0, 0.85, 1.5, -3.6, top)
    soic(esp, SOIC8, -0.5, 2.5, Math.PI / 2, top)
    crystal3225(esp, -4.0, -3.4, top)
    ledBase(esp, ESP_LED_PWR[0], ESP_LED_PWR[1], 0, top)
    ledBase(esp, ESP_LED_TX[0], ESP_LED_TX[1], 0, top)
    chip(esp, 'C', 4.9, -7.4, 90, top)
    chip(esp, 'C', -5.6, 0.6, 90, top)
    const g = new THREE.Group()
    for (const o of esp) g.add(o)
    g.position.set(ESP_BOARD.x * MM, ESP_Y0, ESP_BOARD.z * MM)
    parts.push(g)
  })
}

function buildEsp01(comp: ComponentInstance, _entry: CatalogEntry, pins: THREE.Vector3[]): BuildResult {
  const ghost = isGhost(comp)
  const { group, inner } = moduleInstance(pins, 0, 7, ESP_C)
  addStatics(group, espStatics())
  const board = new THREE.Group()
  board.position.set(ESP_BOARD.x * MM, ESP_Y0, ESP_BOARD.z * MM)
  inner.add(board)
  const top = ESP_BOARD.t * MM
  const pwr = ledLens(board, 'red', ESP_LED_PWR[0], ESP_LED_PWR[1], ghost, top)
  const tx = ledLens(board, 'blue', ESP_LED_TX[0], ESP_LED_TX[1], ghost, top)
  if (!ghost) {
    marking(board, 'esp8266ex', ['ESP8266EX', fakeLotCode('ESP8266')], 4.4, 4.4, 1.5, top + LIFT + 0.85 * MM, -3.6)
    marking(board, 'esp-flash', ['25Q80', fakeLotCode('25Q80').slice(0, 4)], 4.0, 2.6, -0.5, top + LIFT + (SOIC8.H + 0.12) * MM, 2.5)
  }
  return {
    object: group,
    pinWorld: pins.map((p) => p.clone()),
    update: (_c2, _e2, t) => {
      if (ghost) return
      applyLed(pwr, subLed(t, 'LED_PWR'))
      applyLed(tx, logicLed(t?.leds?.TX))
    },
  }
}

// ---------------------------------------------------------------------------
// TJA1050 CAN transceiver module (TX RX VCC GND in row h, CANH CANL in
// row c at dCol 1 / 2)
// ---------------------------------------------------------------------------

const CAN_BUS = -6 * PITCH
const CAN_PINS: Pt[] = [...rowPins(4), [PITCH, CAN_BUS], [2 * PITCH, CAN_BUS]]
const CAN_C = layoutCentroid(CAN_PINS)
const CAN_BOARD = { x: 3.81, z: -7.62, w: 11.5, d: 17.6 }
/** SOIC-8, lead rows along x: upper z −4.95 (TXD GND VCC RXD), lower −9.45 */
const CAN_CHIP = { x: 3.81, z: -7.2 }
export const TJA1050_TOP = Y_TOP + LIFT + (SOIC8.H + 0.12) * MM + DECAL

function paintTja(p: PcbPainter): void {
  const P = painterAt(p, CAN_BOARD.x, CAN_BOARD.z)
  const up = -4.95
  P.traces(
    [
      [
        [0, 0],
        [0, -2.4],
        [1.905, up],
      ],
      [
        [5.08, 0],
        [5.08, -2.6],
        [4.445, up],
      ],
      // RXD and GND change sides through vias (bottom layer)
      [
        [2.54, 0],
        [2.54, -1.9],
      ],
      [
        [5.715, up],
        [6.6, -3.6],
      ],
      [
        [7.62, 0],
        [7.62, -1.9],
      ],
      [
        [3.175, up],
        [3.0, -3.5],
      ],
      // CANH (7) / CANL (6) → the bus header + termination
      [
        [2.54, CAN_BUS],
        [2.54, -12.0],
        [3.175, -9.45],
      ],
      [
        [5.08, CAN_BUS],
        [5.08, -12.0],
        [4.445, -9.45],
      ],
    ],
    0.3,
  )
  for (const [x, z] of [
    [2.54, -1.9],
    [6.6, -3.6],
    [7.62, -1.9],
    [3.0, -3.5],
  ] as Pt[])
    P.via(x, z)
  P.header(CAN_PINS.slice(0, 4))
  P.header(CAN_PINS.slice(4), false)
  P.soicPads(SOIC8, CAN_CHIP.x, CAN_CHIP.z, Math.PI / 2)
  P.dot(CAN_CHIP.x - 3.1, CAN_CHIP.z + 2.6, 0.28)
  P.chipPads(3.81, -12.4)
  P.chipPads(8.3, -7.2, 90)
  ;['TX', 'RX', 'VCC', 'GND'].forEach((t, i) => P.text(t, i * PITCH, -1.15, 0.66))
  P.text('CANH', PITCH, -13.65, 0.56)
  P.text('CANL', 2 * PITCH, -13.65, 0.56)
  P.text('TJA1050', 8.3, -12.4, 0.74, { rot: -Math.PI / 2 })
}

function tjaStatics(): StaticPart[] {
  return designStatics('tja1050', CAN_C, (parts) => {
    flatBoard(parts, { key: 'tja1050', ...CAN_BOARD, y0: SPACER * MM, palette: 'blue', paint: paintTja })
    underHeader(parts, [CAN_PINS.slice(0, 4), CAN_PINS.slice(4)])
    soic(parts, SOIC8, CAN_CHIP.x, CAN_CHIP.z, Math.PI / 2)
    chip(parts, 'R', 3.81, -12.4)
    chip(parts, 'C', 8.3, -7.2, 90)
  })
}

function buildTja(comp: ComponentInstance, _entry: CatalogEntry, pins: THREE.Vector3[]): BuildResult {
  const { group, inner } = moduleInstance(pins, 0, 3, CAN_C)
  addStatics(group, tjaStatics())
  if (!isGhost(comp)) marking(inner, 'tja1050', ['TJA1050', fakeLotCode('TJA1050').slice(0, 4)], 4.2, 2.6, CAN_CHIP.x, TJA1050_TOP - DECAL, CAN_CHIP.z)
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

// ---------------------------------------------------------------------------

/** catalog type → top of the tallest mesh feature (plan units); tests hold obstacleHeight ≥ it */
export const COMM_MESH_TOPS: Record<string, number> = {
  usb_uart_ch340: CH340_TOP,
  hc05_bt: HC05_TOP,
  max485_module: MAX485_TOP,
  w25q32_flash: W25Q_TOP,
  sd_card_spi: SD_TOP,
  pcf8574_module: PCF8574_TOP,
  esp01: ESP01_TOP,
  can_tja1050: TJA1050_TOP,
}

registerMeshBuilder('comm_ch340', 2, buildCh340)
registerMeshBuilder('comm_hc05', 2, buildHc05)
registerMeshBuilder('comm_max485', 2, buildMax485)
registerMeshBuilder('comm_w25q', 2, buildW25q)
registerMeshBuilder('comm_sdcard', 2, buildSd)
registerMeshBuilder('comm_pcf8574', 2, buildPcf)
registerMeshBuilder('comm_esp01', 2, buildEsp01)
registerMeshBuilder('comm_tja1050', 2, buildTja)
