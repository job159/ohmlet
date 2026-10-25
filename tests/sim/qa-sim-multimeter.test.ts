/**
 * Release QA SIM-F1 (AN-01): the bench multimeter reads like a real
 * integrating DMM.
 *
 *  (1) formatReading never prints an exponent: the range follows |value|,
 *      and below the unit's resolution floor (V < 1 µV, A < 1 nA, Ω < 1 mΩ)
 *      the display rests at an unsigned zero with that range's digits
 *      (「0.000 mV」, 「0.00 µA」, 「0.00 Ω」) — a solver residue such as
 *      2.786e-40 V used to read 「2.786e-40 nV」.
 *  (2) MultimeterDevice publishes the mean over a DMM_GATE_S (100 ms) gate
 *      of simulated time (the first partial gate: its running mean, so a DC
 *      circuit reads at once), so DC V on a PWM net reads duty × V_high
 *      instead of flipping 0 V / 3.3 V with the solver step it landed on —
 *      on a synthetic square wave and on the real hal-pwm-fade firmware
 *      (the pwm-fade example), where it agrees with the 量測 net row's
 *      平均 (netLiveSummary over the same 100 ms).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SimEngine } from '../../src/sim/engine'
import { DMM_GATE_S, formatReading } from '../../src/sim/devices'
import type { CircuitLayout, ComponentInstance, Wire } from '../../src/model/types'
import { loadFirmwareFile } from '../../src/mcu/loader'
import '../../src/mcu/all'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import { netLiveSummary } from '../../src/instruments/measure'
import { getEntry } from '../../src/model/catalog'
import { meterReading } from '../../src/ui/embedded/instruments/meter-readout'

const HERE = dirname(fileURLToPath(import.meta.url))
/** what the 3D LCD parser accepts (instruments-ext.ts drawLcd): sign, digits, unit — no exponent */
const DISPLAY = /^-?\d+(\.\d+)? (M|k|m|µ|n)?(V|A|Ω)$/

let seq = 0
const w = (from: string, to: string): Wire => ({ id: `w${++seq}`, from, to })
const lay = (components: ComponentInstance[], wires: Wire[]): CircuitLayout => ({ version: 1, components, wires })

describe('formatReading: never an exponent (SIM-F1 (1))', () => {
  it('rests at an unsigned zero below the resolution floor, with that range’s digits', () => {
    expect(formatReading(2.786e-40, 'V', 4)).toBe('0.000 mV')
    expect(formatReading(1e-40, 'V', 4)).toBe('0.000 mV')
    expect(formatReading(-1e-87, 'V', 4)).toBe('0.000 mV') // never 「-0.000」
    expect(formatReading(4e-7, 'V', 4)).toBe('0.000 mV') // below 1 µV
    expect(formatReading(0, 'V', 4)).toBe('0.000 mV')
    expect(formatReading(-0, 'V', 4)).toBe('0.000 mV')
    expect(formatReading(1e-40, 'A', 3)).toBe('0.00 µA')
    expect(formatReading(-1e-87, 'A', 3)).toBe('0.00 µA')
    expect(formatReading(4e-10, 'A', 3)).toBe('0.00 µA') // below 1 nA
    expect(formatReading(0, 'A', 3)).toBe('0.00 µA')
    expect(formatReading(1e-40, 'Ω', 3)).toBe('0.00 Ω')
    expect(formatReading(0, 'Ω', 3)).toBe('0.00 Ω')
    expect(formatReading(5e-4, 'Ω', 3)).toBe('0.00 Ω') // below 1 mΩ
    expect(formatReading(0.05, 'Ω', 3)).toBe('50.0 mΩ')
  })

  it('picks the range from |value| above the floor (unchanged readings)', () => {
    expect(formatReading(999.96, 'Ω', 4)).toBe('1.000 kΩ') // rounding carries into the next range
    expect(formatReading(999.96, 'V', 4)).toBe('1.000 kV')
    expect(formatReading(4e-7, 'A', 3)).toBe('400 nA')
    expect(formatReading(1.2e-6, 'V', 4)).toBe('1.200 µV')
    expect(formatReading(-2.5e-5, 'V', 4)).toBe('-25.00 µV')
    expect(formatReading(1e-9, 'A', 3)).toBe('1.00 nA')
    expect(formatReading(3.29812, 'V', 4)).toBe('3.298 V')
    expect(formatReading(0.01234, 'A', 3)).toBe('12.3 mA')
    expect(formatReading(4700, 'Ω', 3)).toBe('4.70 kΩ')
    expect(formatReading(Infinity, 'Ω', 3)).toBe('OL')
  })

  it('no input of any magnitude prints an exponent', () => {
    const bad: string[] = []
    for (const [unit, sig] of [
      ['V', 4],
      ['A', 3],
      ['Ω', 3],
      ['V', 2],
      ['V', 1],
    ] as const) {
      for (let e = -320; e <= 12; e += 0.25) {
        for (const sign of [1, -1]) {
          const v = sign * 10 ** e
          const text = formatReading(v, unit, sig)
          if (/e/i.test(text) || !DISPLAY.test(text)) bad.push(`${v} ${unit}/${sig} → ${text}`)
        }
      }
    }
    expect(bad).toEqual([])
  })
})

describe('MultimeterDevice: a gate-mean reading (SIM-F1 (2))', () => {
  /** PS1 → DMM IN (top+ rail), DMM COM → PS1− (top− rail); PS1's voltage is the test signal */
  const meterOnSupply = (mode = 'V') =>
    new SimEngine(
      lay(
        [
          { id: 'PS1', type: 'power_supply', params: { voltage: 0 } },
          { id: 'R1', type: 'resistor', holes: ['top+3', 'top-3'], params: { resistance: 1000 } },
          { id: 'MM1', type: 'multimeter', params: { mode } },
        ],
        [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('MM1:IN', 'top+5'), w('MM1:COM', 'top-5')],
      ),
    )
  const DT = 5e-5

  it('a DC circuit reads at once (the first partial gate publishes its running mean)', () => {
    const e = meterOnSupply()
    e.setRuntimeParam('PS1', 'voltage', 3.3)
    e.step(DT)
    const t = e.telemetry().components.MM1
    expect(t.values!.reading).toBeCloseTo(3.3, 3)
    expect(t.text![0]).toMatch(/^3\.(299|300) V$/)
  })

  it('a 1 kHz 30 % square wave reads duty × V_high, steady at every sample — never the instantaneous 0 / 3.3 V', () => {
    const e = meterOnSupply()
    const period = 20 // steps of 50 µs = 1 ms
    const high = 6 // 30 %
    let n = 0
    const run = (seconds: number) => {
      const steps = Math.round(seconds / DT)
      for (let i = 0; i < steps; i++, n++) {
        e.setRuntimeParam('PS1', 'voltage', n % period < high ? 3.3 : 0)
        e.step(DT)
      }
    }
    run(DMM_GATE_S * 1.5)
    const texts: string[] = []
    for (let k = 0; k < 40; k++) {
      // land the sample anywhere inside the PWM period, high or low
      run(0.0123 + (k % 7) * 1.1e-4)
      const t = e.telemetry().components.MM1
      expect(t.values!.reading).toBeCloseTo(0.3 * 3.3, 2)
      texts.push(t.text![0])
    }
    for (const s of texts) expect(s).toMatch(/^9(89|90|91)\.\d mV$/)
  })

  it('holds the last gate’s mean while the next gate fills, then publishes the new mean', () => {
    const e = meterOnSupply()
    e.setRuntimeParam('PS1', 'voltage', 1)
    const steps = (s: number) => Math.round(s / DT)
    for (let i = 0; i < steps(DMM_GATE_S); i++) e.step(DT) // gate 1 complete: 1 V
    expect(e.telemetry().components.MM1.values!.reading).toBeCloseTo(1, 4)
    e.setRuntimeParam('PS1', 'voltage', 2)
    for (let i = 0; i < steps(DMM_GATE_S / 2); i++) e.step(DT)
    expect(e.telemetry().components.MM1.values!.reading).toBeCloseTo(1, 4) // gate 2 still open
    for (let i = 0; i < steps(DMM_GATE_S / 2); i++) e.step(DT)
    expect(e.telemetry().components.MM1.values!.reading).toBeCloseTo(2, 4) // gate 2 mean
  })

  it('weights each solve by its dt (variable steps, as the MCU lockstep takes them)', () => {
    const e = meterOnSupply()
    // 3.3 V for 0.03 s in many short steps, 0 V for 0.07 s in a few long ones
    e.setRuntimeParam('PS1', 'voltage', 3.3)
    for (let i = 0; i < 600; i++) e.step(5e-5)
    e.setRuntimeParam('PS1', 'voltage', 0)
    for (let i = 0; i < 7; i++) e.step(0.01)
    expect(e.telemetry().components.MM1.values!.reading).toBeCloseTo(0.3 * 3.3, 3)
  })

  it('A mode publishes the mean current in values.reading, current and text alike', () => {
    const e = new SimEngine(
      lay(
        [
          { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
          { id: 'R1', type: 'resistor', holes: ['a10', 'a20'], params: { resistance: 1000 } },
          { id: 'MM1', type: 'multimeter', params: { mode: 'A' } },
        ],
        [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), w('top+1', 'b10'), w('c20', 'MM1:IN'), w('MM1:COM', 'top-4')],
      ),
    )
    let n = 0
    for (let i = 0; i < Math.round((2 * DMM_GATE_S) / DT); i++, n++) {
      e.setRuntimeParam('PS1', 'voltage', n % 20 < 10 ? 5 : 0)
      e.step(DT)
    }
    const t = e.telemetry().components.MM1
    const i = 0.5 * (5 / (1000 + 0.1 + 0.01))
    expect(t.values!.reading).toBeCloseTo(i, 6)
    expect(t.current).toBe(t.values!.reading)
    expect(t.text![0]).toBe('2.50 mA')
  })

  it('an open A-mode meter reads 「0.00 µA」, an open V-mode meter 「0.000 mV」 — never an exponent', () => {
    for (const [mode, text] of [
      ['A', '0.00 µA'],
      ['V', '0.000 mV'],
    ] as const) {
      const e = new SimEngine(lay([{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }, { id: 'MM1', type: 'multimeter', params: { mode } }], [w('PS1:-', 'top-0'), w('MM1:COM', 'top-1')]))
      e.advance(0.25)
      expect(e.telemetry().components.MM1.text![0]).toBe(text)
    }
  })

  it('a mode change starts a new measurement (the new range reads at once)', () => {
    const e = meterOnSupply()
    e.setRuntimeParam('PS1', 'voltage', 2)
    for (let i = 0; i < Math.round((1.5 * DMM_GATE_S) / DT); i++) e.step(DT)
    e.setRuntimeParam('MM1', 'mode', 'A')
    e.step(DT)
    const t = e.telemetry().components.MM1
    expect(t.text![1]).toBe('DC A')
    // the 0.1 Ω shunt across the 2 V supply (its own output resistance limits it)
    expect(t.values!.reading).toBeGreaterThan(1)
  })
})

describe('the pwm-fade example (real hal-pwm-fade firmware): DMM on PA6 / GND', () => {
  it('reads the 100 ms mean of the PWM — never an exponent, never the instantaneous 0 / 3.3 V — and agrees with the 量測 net row', { timeout: 180_000 }, () => {
    const res = loadFirmwareFile('hal-pwm-fade.elf', new Uint8Array(readFileSync(join(HERE, '../../firmware/dist/hal-pwm-fade.elf'))))
    if (!res.ok) throw new Error(res.error)
    const dmmComp: ComponentInstance = { id: 'X1', type: 'multimeter', params: { mode: 'V' } }
    const dmmEntry = getEntry('multimeter')!
    const project = JSON.parse(readFileSync(join(HERE, '../../examples/embedded/pwm-fade.ohmlet.json'), 'utf8')) as { layout: CircuitLayout }
    const layout: CircuitLayout = {
      ...project.layout,
      components: [...project.layout.components, dmmComp],
      // exactly the analyst's wiring: IN on the PA6 strip, COM on the bottom ground rail
      wires: [...project.layout.wires, w('X1:IN', 'd40'), w('X1:COM', 'bot-30')],
    }
    const co = new SimulationCoordinator()
    co.load(layout, 1)
    co.setFirmware('U1', res.image)
    co.setLogicChannels([{ index: 0, label: 'PA6', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA6' } }])
    co.advance(1.05) // samples between gate ends: the last complete gate is unambiguous
    const rows: string[] = []
    for (let k = 0; k < 12; k++) {
      co.advance(0.4)
      const tele = co.telemetry()
      const dmm = tele.components.X1
      const text = dmm.text![0]
      const reading = dmm.values!.reading
      expect(text).not.toMatch(/e/i)
      expect(text).toMatch(DISPLAY)
      // the gate the reading belongs to: the last complete 100 ms gate before now
      const tNow = co.time
      const t1 = Math.floor(tNow / DMM_GATE_S + 1e-6) * DMM_GATE_S
      const t0 = t1 - DMM_GATE_S
      // the scope's view of PA6 (probe P1) over that gate: its time mean and high level
      const sq = co.query({ kind: 'scope', t0, t1, maxPoints: 1 << 20 })
      if (sq.kind !== 'scope') throw new Error('scope query')
      const tr = sq.capture.traces[0]
      let area = 0
      let vHigh = 0
      for (let i = 1; i < tr.t.length; i++) {
        const a = Math.max(t0, tr.t[i - 1])
        const b = Math.min(t1, tr.t[i])
        if (b > a) area += tr.v[i] * (b - a) // a solve's value holds over its step (backward Euler)
        vHigh = Math.max(vHigh, tr.v[i])
      }
      const scopeMean = area / (Math.min(t1, tr.t[tr.t.length - 1]) - Math.max(t0, tr.t[0]))
      // the 量測 net row: duty × V_high over the same 100 ms (netLiveSummary, the H4 rule)
      const lq = co.query({ kind: 'logic', t0, t1 })
      if (lq.kind !== 'logic') throw new Error('logic query')
      const live = netLiveSummary({ trace: lq.capture.traces[0], t0, t1, v: null, vHigh })
      rows.push(`t=${tNow.toFixed(3)} DMM ${text} · scope mean ${scopeMean.toFixed(4)} V · net row ${JSON.stringify(live)}`)
      expect(Math.abs(reading - scopeMean), rows.join('\n')).toBeLessThan(0.01)
      expect(live.kind, rows.join('\n')).toBe('pwm')
      if (live.kind === 'pwm') expect(Math.abs(reading - (live.vavg ?? NaN)), rows.join('\n')).toBeLessThan(0.01)
      // a 100 ms mean of a 1 % / 10 ms ramp is never a rail
      expect(reading).toBeGreaterThan(0.05)
      expect(reading).toBeLessThan(3.25)
      // the inspector's 讀數 card and the 量測 tab show this very text (meterReading); the 3D LCD draws text[0] verbatim
      expect(meterReading(dmmComp, dmmEntry, dmm).value).toBe(text)
    }
  })
})
