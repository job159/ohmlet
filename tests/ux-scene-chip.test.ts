/**
 * UX wave SC-4 — the live hover chip (src/ui/workspace/hole-chip.ts):
 * with a simulation session the chip names the firmware-programmed pin mode
 * in the inspector's words, the node voltage of the hole's net (never a
 * guessed number) and, on a part that can be held down in 3D, 「按住即可按下」;
 * without a session it is exactly the contract baseline (K5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { buildNetlist } from '../src/sim/netlist'
import { growPaddleText, holeChipText, holeChipTextFor, objectChipText } from '../src/ui/workspace/hole-chip'
import { registerScene } from '../src/ui/workspace/scene-bridge'
import { moveWireEndTo, wireEndAccepted } from '../src/ui/workspace/wire-ends'
import { useStore } from '../src/state/store'

/** U1 Blue Pill at h10 (PA5 → c20), LED1 b40 / top-32, R1 a36–a40, SW1 at f50, a PSU on the rails. */
const LAYOUT: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', holes: ['a36', 'a40'] },
    { id: 'LED1', type: 'led', holes: ['b40', 'top-32'] },
    { id: 'SW1', type: 'pushbutton', at: 'f50' },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+3' },
    { id: 'W2', from: 'PS1:-', to: 'top-3' },
    { id: 'W3', from: 'a20', to: 'e36' },
  ],
}

/** A session snapshot: every net at a known voltage, PA5 programmed push-pull. */
function telemetry(layout: CircuitLayout, volts: Record<string, number>, modes: Record<string, string> = {}): SimTelemetry {
  const nl = buildNetlist(layout)
  const netVoltages: Record<string, number> = {}
  for (const net of nl.nets) netVoltages[net] = 0
  for (const [ref, v] of Object.entries(volts)) {
    const net = nl.netOf(ref)
    if (net) netVoltages[net] = v
  }
  return {
    time: 1,
    netVoltages,
    components: { U1: { pinVoltages: {}, mcu: { state: 'running', pc: 0x08000100, hclkHz: 8e6, cycles: 1, pinModes: modes } } },
    issues: [],
  }
}

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => {
  __setLangForTests('zh-TW')
  useStore.setState({ telemetry: null })
})

describe('SC-4 live hover chip', () => {
  it('MCU pin: mode in the inspector’s words + node voltage, before the hole', () => {
    const tel = telemetry(LAYOUT, { c20: 3.3 }, { PA5: 'out', PA6: 'in↑' })
    expect(holeChipTextFor(LAYOUT, 'c20', tel)).toBe('U1 PA5（板上 A5）· 推挽輸出 · 3.30 V · c20')
    // H3: a 0 V net reads 「0 V」 (the shared unit formatter — UX fix wave SC-12)
    expect(holeChipTextFor(LAYOUT, 'c19', tel)).toBe('U1 PA6（板上 A6）· 上拉輸入 · 0 V · c19')
  })

  it('other pins, wire ends, strips and rails carry the voltage; no session = the K5 baseline', () => {
    const tel = telemetry(LAYOUT, { b40: 2.29, 'top+3': 5, a20: 3.3 })
    expect(holeChipTextFor(LAYOUT, 'b40', tel)).toBe('LED1 陽極（長腳）· 2.29 V · b40') // H1 pinLabel
    // a wire end names what its strip connects it to (SC-4 acceptance: a20 names U1 PA5), in
    // the H2 form the wire hint uses (requests round: one hole, one name)
    expect(holeChipTextFor(LAYOUT, 'a20', tel)).toBe('導線 W3 · 3.30 V · a20（U1 PA5 這一排）')
    expect(holeChipTextFor(LAYOUT, 'e36', tel)).toBe('導線 W3 · 3.30 V · e36（R1 第 1 腳這一排）') // one net with a20
    expect(holeChipTextFor(LAYOUT, 'top+3', tel)).toBe('導線 W1 · 5.00 V · 上方 + 電源軌 · 第 3 孔（top+3）')
    expect(holeChipTextFor(LAYOUT, 'b20', tel)).toBe('b20（U1 PA5 這一排）· 3.30 V')
    expect(holeChipTextFor(LAYOUT, 'top+10', tel)).toBe('上方 + 電源軌 · 第 10 孔（top+10）· 5.00 V')
    // the same holes without a session
    expect(holeChipTextFor(LAYOUT, 'c20')).toBe('U1 PA5（板上 A5）· c20')
    expect(holeChipTextFor(LAYOUT, 'b40')).toBe('LED1 陽極（長腳）· b40')
    expect(holeChipTextFor(LAYOUT, 'a20')).toBe('導線 W3 · a20（U1 PA5 這一排）')
    expect(holeChipTextFor(LAYOUT, 'top+10')).toBe('上方 + 電源軌 · 第 10 孔（top+10）')
  })

  it('never shows a guessed reading: unsolved nets and strips outside the circuit stay silent', () => {
    const tel = telemetry(LAYOUT, {})
    const net = buildNetlist(LAYOUT).netOf('b40')!
    tel.netVoltages[net] = Number.NaN
    expect(holeChipTextFor(LAYOUT, 'b40', tel)).toBe('LED1 陽極（長腳）· b40')
    expect(holeChipTextFor(LAYOUT, 'a60', tel)).toBeNull() // empty strip, nothing on it
    // below the 1 mV floor: 「0 V」, never 「−0」 (H3)
    expect(holeChipTextFor(LAYOUT, 'c20', telemetry(LAYOUT, { c20: -0.0004 }))).toBe('U1 PA5（板上 A5）· 0 V · c20')
    // a solver blow-up (|V| > 1 kV) is not a reading either
    expect(holeChipTextFor(LAYOUT, 'c20', telemetry(LAYOUT, { c20: -1261957.64 }))).toBe('U1 PA5（板上 A5）· c20')
  })

  it('a part that can be held down in 3D says so while a session exists', () => {
    const sw = holeChipTextFor(LAYOUT, 'f50', telemetry(LAYOUT, {}))
    expect(sw).toMatch(/^SW1 .+ · 0 V · f50 · 按住即可按下$/)
    expect(holeChipTextFor(LAYOUT, 'f50')).not.toMatch(/按住/)
  })

  it('reads the live store (layout + telemetry) and stays English in English', () => {
    useStore.setState({ layout: LAYOUT, telemetry: telemetry(LAYOUT, { c20: 3.3 }, { PA5: 'out' }) })
    expect(holeChipText('c20')).toBe('U1 PA5（板上 A5）· 推挽輸出 · 3.30 V · c20')
    __setLangForTests('en')
    expect(holeChipText('c20')).toBe('U1 PA5 (board label A5) · push-pull output · 3.30 V · c20')
    useStore.setState({ telemetry: null })
    expect(holeChipText('c20')).toBe('U1 PA5 (board label A5) · c20')
  })
})

describe('SC-8 grow-paddle chip text', () => {
  it('says what the paddle does, and the scene bridge installs it on the registered scene', () => {
    expect(growPaddleText('right', false)).toBe('加接一塊麵包板')
    expect(growPaddleText('down', true)).toBe('移除這一側的麵包板')
    const setCallbacks = vi.fn()
    registerScene({ setCallbacks })
    expect(setCallbacks).toHaveBeenCalledWith({
      growPaddleLabel: growPaddleText,
      objectLabelText: objectChipText,
      onWireEndPreview: wireEndAccepted,
      onWireEndMove: moveWireEndTo,
    })
    registerScene(null)
    registerScene({}) // a scene without setCallbacks: no-op
    registerScene(null)
  })
})
