/**
 * End-to-end test hooks — `window.__e2e`, used by scripts/acceptance-e2e.mjs.
 *
 * Loaded by src/main.tsx ONLY when the page URL carries `?e2e` (a separate
 * dynamic chunk: a normal session never downloads it). Everything here is
 * READ-ONLY: snapshots of the app store, the embedded-lab store, the lab's
 * UART / log buffers, a passive per-frame telemetry recorder (an extra
 * listener on the host's frame feed — it never alters a frame) and plain
 * geometry (hole / terminal → world point) so a test can aim real pointer
 * clicks at the 3D board through `window.__shotRig.project`. The one async
 * call (`logic`) is the logic analyzer's own pull query, which only reads the
 * coordinator's recorder. No hook changes the document, the simulation or
 * any preference — the walkthrough drives those through the real UI.
 */
import { onSimHostEvent, useStore } from '../state/store'
import { labBuffers, labReady, useLab } from '../state/lab'
import type { SimFrame, SerialPortInfo } from '../sim/coordinator/api'
import type { ComponentTelemetry } from '../model/types'
import { boardConfigOf } from '../model/types'
import { getEntry } from '../model/catalog'
import {
  componentPinHoles,
  holePosition,
  offboardSlotSpan,
  offboardTerminalPosition,
  parseHole,
  parseTerminalRef,
} from '../model/breadboard'
import { lang } from '../i18n'
import { partLabel } from '../i18n/parts'

/** wire attach height of an off-board terminal post (src/three/internal/wires.ts TERMINAL_TOP_Y) */
const TERMINAL_TOP_Y = 0.7
/** per-frame samples kept (≈ 70 s at 60 frames/s) */
const SAMPLE_CAP = 4096

/** One frame as the recorder saw it. */
export interface E2eFrameSample {
  /** performance.now() when the frame reached the page (ms) */
  wall: number
  /** simulation time of the frame (s) */
  time: number
  running: boolean
  /** computed from the latest document revision */
  current: boolean
  /** LED brightness 0..1 per component id, plus board sub-circuit LEDs as "U1/LED_PC13" */
  leds: Record<string, number>
  /** pushbutton states echoed by the simulation */
  pressed: Record<string, boolean>
  mcus: { id: string; state: string; pc: number; cycles: number; firmware: string | null }[]
  /**
   * the coordinator's achieved speed (sim s ÷ wall s over its last 1 s
   * window, SimFrame.perf.realtimeFactor) when the frame was made — the
   * acceptance report prints it per step and per run
   */
  rt: number
}

export interface E2eHooks {
  readonly version: 1
  /** resolves once the lab's boot-time firmware restore finished */
  ready(): Promise<true>
  /** app + lab state snapshot (plain JSON) */
  state(): Record<string, unknown>
  /** newest current-revision telemetry of one component (null = none yet) */
  component(id: string): ComponentTelemetry | null
  /** frames recorded since `sinceWall` (performance.now() ms; default: all kept) */
  frames(sinceWall?: number): E2eFrameSample[]
  /** performance.now() of the page (aligns `frames(sinceWall)` with the script) */
  now(): number
  /** summary of the newest frame (null before the host published one) */
  lastFrame(): {
    rev: number
    time: number
    running: boolean
    serialPorts: SerialPortInfo[]
    perf: SimFrame['perf']
    mcus: SimFrame['mcus']
  } | null
  /** terminal transcript of a port (the lab ring the UART terminal reads) */
  uart(componentId: string, port: string): string
  uartPorts(): { componentId: string; port: string }[]
  /** newest simulation log entries */
  log(limit?: number): { time: number; level: string; source: string; message: string }[]
  /** logic-analyzer capture of [t0, t1] (s): edges as plain arrays */
  logic(
    t0: number,
    t1: number,
  ): Promise<{
    t0: number
    t1: number
    tNow: number | null
    traces: { index: number; label: string; initial: number; times: number[]; levels: number[]; exact: boolean }[]
  }>
  /** world point of a wire endpoint: a hole ("j27", y = 0) or an off-board terminal ("PS1:+") */
  endpointWorld(ref: string): { x: number; y: number; z: number } | null
  /** the library card label of a catalog type in the active UI language */
  label(type: string): string | null
  /** world point over the middle of a placed part's pins (null = unknown / off-board) */
  componentWorld(id: string, y?: number): { x: number; y: number; z: number } | null
}

// ---------------------------------------------------------------------------
// passive frame recorder
// ---------------------------------------------------------------------------

const samples: E2eFrameSample[] = []
let last: SimFrame | null = null
let lastCurrent: SimFrame | null = null

function record(f: SimFrame, current: boolean): void {
  last = f
  if (current) lastCurrent = f
  const leds: Record<string, number> = {}
  const pressed: Record<string, boolean> = {}
  for (const [id, c] of Object.entries(f.telemetry.components)) {
    if (typeof c.ledBrightness === 'number') leds[id] = c.ledBrightness
    if (typeof c.pressed === 'boolean') pressed[id] = c.pressed
    if (c.sub) {
      for (const [sid, s] of Object.entries(c.sub)) {
        if (typeof s.ledBrightness === 'number') leds[`${id}/${sid}`] = s.ledBrightness
      }
    }
  }
  samples.push({
    wall: performance.now(),
    time: f.time,
    running: f.running,
    current,
    leds,
    pressed,
    mcus: f.mcus.map((m) => ({ id: m.componentId, state: m.state, pc: m.pc, cycles: m.cycles, firmware: m.firmware })),
    rt: f.perf?.realtimeFactor ?? 0,
  })
  if (samples.length > SAMPLE_CAP) samples.splice(0, samples.length - SAMPLE_CAP)
}

onSimHostEvent((e) => {
  if (e.kind === 'frame') record(e.frame, e.current)
  else if (e.kind === 'disposed') {
    last = null
    lastCurrent = null
  }
})

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

function endpointWorld(ref: string): { x: number; y: number; z: number } | null {
  const hole = parseHole(ref)
  if (hole) {
    const p = holePosition(hole)
    return { x: p.x, y: 0, z: p.z }
  }
  const term = parseTerminalRef(ref)
  if (!term) return null
  // off-board slots follow layout order and each unit's slot span, and the
  // terminal row uses the part's own bench geometry — exactly like the
  // scene's shelf (scene.ts buildComponentRecord)
  let slot = 0
  for (const c of useStore.getState().layout.components) {
    const entry = getEntry(c.type)
    if (!entry || entry.placement !== 'offboard') continue
    if (c.id === term.componentId) {
      const pin = entry.pins.indexOf(term.pin)
      if (pin < 0) return null
      const p = offboardTerminalPosition(slot, pin, c.pos, entry.offboard)
      return { x: p.x, y: TERMINAL_TOP_Y, z: p.z }
    }
    slot += offboardSlotSpan(entry.offboard)
  }
  return null
}

function componentWorld(id: string, y = 0.5): { x: number; y: number; z: number } | null {
  const layout = useStore.getState().layout
  const comp = layout.components.find((c) => c.id === id)
  const entry = comp ? getEntry(comp.type) : undefined
  if (!comp || !entry || entry.placement === 'offboard') return null
  const holes = componentPinHoles(comp, entry, boardConfigOf(layout))
  if (!holes || holes.some((h) => h === null)) return null
  let x = 0
  let z = 0
  for (const h of holes) {
    const p = holePosition(h!)
    x += p.x
    z += p.z
  }
  return { x: x / holes.length, y, z: z / holes.length }
}

// ---------------------------------------------------------------------------
// window.__e2e
// ---------------------------------------------------------------------------

const hooks: E2eHooks = {
  version: 1,
  async ready() {
    await labReady()
    return true
  },
  state() {
    const s = useStore.getState()
    const l = useLab.getState()
    return {
      lang: lang(),
      layout: s.layout,
      mode: s.mode,
      selection: s.selection,
      running: s.running,
      simTime: s.simTime,
      simSpeed: s.simSpeed,
      issues: s.issues,
      firmware: l.firmware,
      mcus: l.mcus,
      workspace: l.workspace,
      logicChannels: l.logicChannels,
      terminal: l.terminal,
      uartVersion: l.uartVersion,
    }
  },
  component(id) {
    return lastCurrent?.telemetry.components[id] ?? null
  },
  frames(sinceWall = Number.NEGATIVE_INFINITY) {
    return samples.filter((s) => s.wall >= sinceWall)
  },
  now() {
    return performance.now()
  },
  lastFrame() {
    const f = last
    if (!f) return null
    return { rev: f.rev, time: f.time, running: f.running, serialPorts: f.serialPorts ?? [], perf: f.perf, mcus: f.mcus }
  },
  uart(componentId, port) {
    return labBuffers.uartText(componentId, port)
  },
  uartPorts() {
    return labBuffers.uartPorts()
  },
  log(limit = 50) {
    return labBuffers
      .log()
      .slice(-limit)
      .map((e) => ({ time: e.time, level: e.level, source: e.source, message: e.message }))
  },
  async logic(t0, t1) {
    const cap = await useLab.getState().queryLogic(t0, t1)
    return {
      t0: cap.t0,
      t1: cap.t1,
      tNow: cap.tNow ?? null,
      traces: cap.traces.map((tr) => ({
        index: tr.index,
        label: tr.label,
        initial: tr.initial,
        times: Array.from(tr.times),
        levels: Array.from(tr.levels),
        exact: tr.exact,
      })),
    }
  },
  label(type) {
    const entry = getEntry(type)
    return entry ? partLabel(entry) : null
  },
  endpointWorld,
  componentWorld,
}

;(window as unknown as { __e2e?: E2eHooks }).__e2e = hooks
