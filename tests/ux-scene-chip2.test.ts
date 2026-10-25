/**
 * UX fix wave SC-12 — the hover chip, coherent with every other surface:
 *  - live values through the shared helpers (H3 fmtVoltage, H4 getNetLive):
 *    a recorded PWM net reads 「PWM 1.000 kHz · 34.0 %」 (never 「3.10 V」),
 *    an unrecorded net seen switching is 「3.10 V（瞬時）」, a steady one
 *    「3.10 V」;
 *  - off-board terminals get a chip (H1 terminalLabel): 「PS1 正端 · 5.00 V」;
 *  - a part body in select mode: the neutral 「U1 · … · 點一下選取」;
 *  - the screen chip's placement (src/three/internal/hole-fx.ts
 *    placeScreenChip): inside the free area, above the pointer by default,
 *    flipped near an edge, clear of the floating chrome and of the pointed-at
 *    part, never under the finger.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import type { LogicCapture } from '../src/sim/coordinator/api'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import {
  __resetNetActivityForTests,
  __tickNetActivityForTests,
  getNetLive,
  ingestCapture,
  netLiveText,
  resolveNet,
} from '../src/ui/embedded/instruments/net-activity'
import { holeChipText, holeChipTextFor, objectChipText } from '../src/ui/workspace/hole-chip'
import { SCREEN_CHIP_GAP_PX, placeScreenChip, type ChipRect } from '../src/three/internal/hole-fx'

/** U1 at h10: PA6 → c19 (recorded on D0), PA5 → c20; PS1 feeds j27 (5V). */
const LAYOUT: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'DMM1', type: 'multimeter', params: { mode: 'V' } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'j27', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-1', color: 'black' },
    { id: 'W3', from: 'a19', to: 'e40', color: 'yellow' },
  ],
}

function telemetry(time: number, volts: Record<string, number>): SimTelemetry {
  return { time, netVoltages: volts, components: {}, issues: [] }
}

/** A 1 kHz 34 % PWM recorded on D0 over [t1 − 0.5, t1]. */
function pwmCapture(t1: number): LogicCapture {
  const times: number[] = []
  const levels: number[] = []
  for (let t = t1 - 0.5; t < t1; t += 1e-3) {
    times.push(t, t + 0.34e-3)
    levels.push(1, 0)
  }
  return {
    t0: t1 - 0.5,
    t1,
    tNow: t1,
    overflow: false,
    traces: [{ index: 0, label: 'PA6', exact: true, since: 0, initial: 0, times: Float64Array.from(times), levels: Uint8Array.from(levels) }],
  }
}

describe('SC-12 chip texts through H1 / H3 / H4', () => {
  let pa6 = ''
  let pa5 = ''
  let v5 = ''
  beforeEach(() => {
    __setLangForTests('zh-TW')
    __resetNetActivityForTests()
    useStore.getState().resetSim()
    __resetHistoryForTests()
    useStore.setState({ layout: LAYOUT, selection: [], running: false, simTime: 1.0, telemetry: null })
    useLab.setState({ logicChannels: [{ index: 0, label: 'PA6 PWM', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA6' } }] })
    pa6 = resolveNet('c19', LAYOUT) ?? ''
    pa5 = resolveNet('c20', LAYOUT) ?? ''
    v5 = resolveNet('PS1:+', LAYOUT) ?? ''
  })
  afterEach(() => {
    __resetNetActivityForTests()
    useStore.setState({ telemetry: null, running: false, simTime: 0 })
    useLab.setState({ logicChannels: [] })
    __setLangForTests('zh-TW')
  })

  it('a recorded PWM net reads PWM — never the instantaneous 3.10 V', () => {
    useStore.setState({ telemetry: telemetry(1.0, { [pa6]: 3.1, [pa5]: 3.1, [v5]: 5 }) })
    getNetLive('c19')
    __tickNetActivityForTests()
    ingestCapture(pwmCapture(1.0))
    const chip = holeChipText('c19')
    // the chip prints the shared H4 words for the net (what names the source — 「PWM」 for a
    // timer channel, 「週期訊號」 otherwise — is the helper's, IS-F8): the measured 1.000 kHz /
    // 34.0 %, never the instantaneous 3.10 V
    const live = getNetLive('c19')
    expect(live?.kind).toBe('pwm')
    const words = netLiveText(live, { form: 'compact' })
    expect(words).toMatch(/1\.000 kHz · 34\.0 %$/)
    expect(chip).toBe(`U1 PA6（板上 A6）· ${words} · c19`)
    expect(chip).not.toMatch(/3\.10 V/)
    // the wire end on the same net says the same (a19 is PA6's strip)
    expect(holeChipText('a19')).toBe(`導線 W3 · ${words} · a19（U1 PA6 這一排）`)
  })

  it('an unrecorded net: the plain value while steady, 「（瞬時）」 once it was seen switching', () => {
    useStore.setState({ telemetry: telemetry(1.0, { [pa5]: 0, [v5]: 5 }), simTime: 1.0 })
    expect(holeChipText('c20')).toBe('U1 PA5（板上 A5）· 0 V · c20') // starts watching the net
    __tickNetActivityForTests()
    useStore.setState({ telemetry: telemetry(1.2, { [pa5]: 3.1, [v5]: 5 }), simTime: 1.2 })
    __tickNetActivityForTests()
    expect(holeChipText('c20')).toBe('U1 PA5（板上 A5）· 3.10 V（瞬時）· c20')
    // the 5 V rail never changed level: a plain value
    expect(holeChipText('j27')).toBe('導線 W1 · 5.00 V · j27（U1 5V 這一排）')
  })

  it('off-board terminals get a chip: H1 name + the live value', () => {
    expect(holeChipTextFor(LAYOUT, 'PS1:+')).toBe('PS1 正端')
    expect(holeChipTextFor(LAYOUT, 'PS1:-')).toBe('PS1 負端')
    expect(holeChipTextFor(LAYOUT, 'DMM1:COM')).toBe('DMM1 COM 端')
    useStore.setState({ telemetry: telemetry(1.0, { [v5]: 5 }) })
    expect(holeChipText('PS1:+')).toBe('PS1 正端 · 5.00 V')
    // not a terminal of a part in the circuit → no chip (the scene shows none)
    expect(holeChipTextFor(LAYOUT, 'PS9:+')).toBeNull()
    __setLangForTests('en')
    expect(holeChipTextFor(LAYOUT, 'PS1:+')).toBe('PS1 positive terminal')
  })

  it('a part body or a wire in select mode: the neutral 「… · 點一下選取」 chip', () => {
    expect(objectChipText('U1')).toBe('U1 · STM32F103C8T6 Blue Pill 開發板 · 點一下選取')
    expect(objectChipText('W3')).toBe('導線 W3 · 點一下選取')
    expect(objectChipText('nope')).toBeNull()
    __setLangForTests('en')
    expect(objectChipText('W3')).toBe('Wire W3 · Click to select')
  })
})

describe('SC-12 placeScreenChip (screen space)', () => {
  const AREA: ChipRect = { x0: 424, y0: 8, x1: 1056, y1: 624 } // 1440×900 workspace free rect minus the edge air
  const inside = (p: { x: number; y: number }, w: number, h: number, a: ChipRect) =>
    p.x >= a.x0 && p.y >= a.y0 && p.x + w <= a.x1 && p.y + h <= a.y1
  const overlaps = (p: { x: number; y: number }, w: number, h: number, r: ChipRect) =>
    p.x < r.x1 && p.x + w > r.x0 && p.y < r.y1 && p.y + h > r.y0

  it('sits centred above the pointer when there is room', () => {
    const p = placeScreenChip(200, 32, 700, 400, AREA, [])
    expect(p).toEqual({ x: 600, y: 400 - SCREEN_CHIP_GAP_PX - 32 })
  })

  it('stays inside the free area at the panels’ edge (the PA9 / j15 cut-off chips)', () => {
    // a 600 px chip whose anchor is 20 px inside the left panel's edge
    const p = placeScreenChip(600, 54, 444, 300, AREA, [])
    expect(inside(p, 600, 54, AREA)).toBe(true)
    const q = placeScreenChip(600, 54, 1040, 300, AREA, [])
    expect(inside(q, 600, 54, AREA)).toBe(true)
  })

  it('flips below the pointer at the top edge, and never covers the pointer', () => {
    const p = placeScreenChip(220, 32, 700, 30, AREA, [])
    expect(p.y).toBeGreaterThanOrEqual(30 + 6)
    expect(overlaps(p, 220, 32, { x0: 694, y0: 24, x1: 706, y1: 36 })).toBe(false)
  })

  it('keeps clear of the capsule / pill and of the pointed-at part', () => {
    const capsule: ChipRect = { x0: 620, y0: 10, x1: 820, y1: 96 }
    const p = placeScreenChip(220, 32, 720, 120, AREA, [capsule])
    expect(overlaps(p, 220, 32, capsule)).toBe(false)
    // an LED right above the hole (d41 beside c41): the chip goes elsewhere
    const led: ChipRect = { x0: 690, y0: 330, x1: 740, y1: 395 }
    const q = placeScreenChip(160, 32, 715, 400, AREA, [], led)
    expect(overlaps(q, 160, 32, led)).toBe(false)
  })

  it('touch: never under the finger (no below candidate)', () => {
    const p = placeScreenChip(220, 32, 700, 30, AREA, [], null, { noBelow: true })
    expect(p.y + 32).toBeLessThanOrEqual(30 + 6 + 1e-9 + 32) // above or beside, not below the anchor row
    expect(p.y).toBeLessThan(30)
  })
})
