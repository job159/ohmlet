/**
 * 顯示電流 — real currents (contract C2): ComponentTelemetry.pinCurrents from
 * the solver's stamps and SimTelemetry.wireCurrents / stripCurrents from KCL
 * inside each net, checked against hand-computed circuits.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_DT, SimEngine } from '../src/sim/engine'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { holePosition, parseHole } from '../src/model/breadboard'
import { R_CONTACT, R_METAL_PER_PITCH, R_WIRE_PER_PITCH } from '../src/sim/coordinator/wire-currents'
import type { CircuitLayout, Wire } from '../src/model/types'
import { PIN_OUT_PP } from '../src/mcu/pins'
import { FakeMcu, PwmProgram } from './coordinator/fake-mcu'
import { bluePillWorld, part, PA5, tap, w } from './coordinator/worlds'
import { dip, dipPinHole, layout, supply5, twoLead } from './helpers'

const W = (id: string, from: string, to: string): Wire => ({ id, from, to })

/** 5 V bench supply on the top rails: wp (PS1:+ → top+0), wn (PS1:- → top-0). */
function bench(components: CircuitLayout['components'], wires: Wire[] = []): CircuitLayout {
  return layout([supply5(), ...components], [W('wp', 'PS1:+', 'top+0'), W('wn', 'PS1:-', 'top-0'), ...wires])
}

/** Settle, drop the start-up window, then return the mean currents of a steady window. */
function tracked(l: CircuitLayout, seconds = 0.002): ReturnType<SimEngine['telemetry']> {
  const e = new SimEngine(l)
  e.trackCurrents = true
  e.advance(seconds)
  e.telemetry() // the first window holds the start-up solve
  e.advance(seconds)
  return e.telemetry()
}

/** GMIN (1 nS per node) leaks a few nA beside every hand calculation: rel 1e-5 by default. */
function close(got: number | undefined, want: number, rel = 1e-5, abs = 1e-9): void {
  expect(got, `expected ${want}`).toBeDefined()
  expect(Math.abs((got as number) - want)).toBeLessThanOrEqual(Math.max(abs, Math.abs(want) * rel))
}

/** Plan run of a wire between two holes (pitches), as the wire model measures it. */
function run(a: string, b: string): number {
  const pa = holePosition(parseHole(a)!)
  const pb = holePosition(parseHole(b)!)
  return Math.hypot(pa.x - pb.x, pa.z - pb.z)
}
const rWire = (a: string, b: string) => 2 * R_CONTACT + R_WIRE_PER_PITCH * (run(a, b) + 2)

describe('pin currents from the stamps', () => {
  it('series 1 kΩ + 1 kΩ across 5 V: I = 5 / (2000 + 0.01) everywhere along the loop', () => {
    const t = tracked(
      bench([
        twoLead('R1', 'resistor', 'top+1', 'a10', { resistance: 1000 }),
        twoLead('R2', 'resistor', 'b10', 'top-1', { resistance: 1000 }),
      ]),
    )
    const I = 5 / (2000 + 0.01) // the bench supply is an ideal source behind 10 mΩ
    const c = t.components
    close(c.R1.pinCurrents?.p1, I)
    close(c.R1.pinCurrents?.p2, -I)
    close(c.R2.pinCurrents?.p1, I)
    close(c.R2.pinCurrents?.p2, -I)
    close(c.PS1.pinCurrents?.['+'], -I) // conventional current LEAVES the supply at +
    close(c.PS1.pinCurrents?.['-'], I)
    // wires: positive = from → to
    close(t.wireCurrents?.wp, I)
    close(t.wireCurrents?.wn, -I) // returns top-0 → PS1:-
    // strip / rail metal between used holes
    close(t.stripCurrents?.['top+0>top+1'], I)
    close(t.stripCurrents?.['a10>b10'], I)
    close(t.stripCurrents?.['top-0>top-1'], -I)
  })

  it('series LED: the LED, its resistor and every wire carry the same current (= (5 − Vf) / 330)', () => {
    const t = tracked(
      bench(
        [twoLead('R1', 'resistor', 'top+1', 'a10', { resistance: 330 }), twoLead('D1', 'led', 'b10', 'b14', { color: 'red' })],
        [W('wk', 'c14', 'top-2')],
      ),
    )
    const d = t.components.D1
    const vf = d.pinVoltages.anode - d.pinVoltages.cathode
    const vr = t.components.R1.pinVoltages.p1 - t.components.R1.pinVoltages.p2
    const I = vr / 330
    expect(I).toBeGreaterThan(0.008)
    expect(I).toBeLessThan(0.011)
    expect(vf).toBeGreaterThan(1.7)
    close(d.pinCurrents?.anode, I, 1e-4)
    close(d.pinCurrents?.cathode, -I, 1e-4)
    close(d.current, I, 1e-4) // the LED model's own branch current agrees
    close(t.wireCurrents?.wp, I, 1e-4)
    close(t.wireCurrents?.wk, I, 1e-4) // cathode strip → GND rail
    close(t.stripCurrents?.['b14>c14'], I, 1e-4)
  })

  it('parallel LEDs: the supply wire carries I1 + I2 and the rail splits it', () => {
    const t = tracked(
      bench(
        [
          twoLead('R1', 'resistor', 'top+1', 'a10', { resistance: 330 }),
          twoLead('D1', 'led', 'b10', 'b13', { color: 'red' }),
          twoLead('R2', 'resistor', 'top+2', 'a20', { resistance: 1000 }),
          twoLead('D2', 'led', 'b20', 'b23', { color: 'red' }),
        ],
        [W('k1', 'c13', 'top-1'), W('k2', 'c23', 'top-2')],
      ),
    )
    const I1 = t.components.D1.pinCurrents!.anode
    const I2 = t.components.D2.pinCurrents!.anode
    expect(I1).toBeGreaterThan(2.5 * I2) // 330 Ω vs 1 kΩ: clearly different currents
    expect(I2).toBeGreaterThan(0.002)
    close(t.wireCurrents?.wp, I1 + I2)
    close(t.wireCurrents?.wn, -(I1 + I2))
    close(t.stripCurrents?.['top+0>top+1'], I1 + I2)
    close(t.stripCurrents?.['top+1>top+2'], I2)
    close(t.stripCurrents?.['top-1>top-2'], -I2)
    close(t.stripCurrents?.['top-0>top-1'], -(I1 + I2))
    close(t.wireCurrents?.k1, I1)
    close(t.wireCurrents?.k2, I2)
  })

  it('a wire loop splits the current by the conductor resistances (KCL + length model)', () => {
    // rail → column 20 through TWO wires (wA top+5 → a20, wB top+6 → b20): a loop
    const t = tracked(
      bench([twoLead('R1', 'resistor', 'c20', 'top-1', { resistance: 1000 })], [W('wA', 'top+5', 'a20'), W('wB', 'top+6', 'b20')]),
    )
    const I = t.components.R1.pinCurrents!.p1
    close(I, 5 / (1000 + 0.01), 1e-5)
    // path A: wA then strip a20 → b20; path B: rail top+5 → top+6 then wB
    const rA = rWire('top+5', 'a20') + R_METAL_PER_PITCH * (holePosition(parseHole('b20')!).z - holePosition(parseHole('a20')!).z)
    const rB = R_METAL_PER_PITCH * 1 + rWire('top+6', 'b20')
    const iA = (I * rB) / (rA + rB)
    const iB = (I * rA) / (rA + rB)
    close(t.wireCurrents?.wA, iA, 1e-6)
    close(t.wireCurrents?.wB, iB, 1e-6)
    close(t.stripCurrents?.['top+5>top+6'], iB, 1e-6)
    close(t.stripCurrents?.['a20>b20'], iA, 1e-6)
    close(t.stripCurrents?.['b20>c20'], I, 1e-6)
    close(t.stripCurrents?.['top+0>top+5'], I, 1e-6)
  })

  it('a wire with nothing flowing reads 0 (known), and an idle strip segment is not listed', () => {
    const t = tracked(bench([twoLead('R1', 'resistor', 'top+1', 'a10', { resistance: 1000 })], [W('dead', 'b10', 'a30')]))
    expect(t.wireCurrents?.dead).toBe(0)
    expect(Math.abs(t.components.R1.pinCurrents!.p1)).toBeLessThan(1e-7) // open circuit (GMIN leak only)
    expect(t.stripCurrents?.['a10>b10']).toBeUndefined()
  })

  it('a legacy Norton-driven chip closes its loop: a SOURCING output takes its current in at VCC (the + wire carries it), a SINKING one returns it through its GND pin', () => {
    const at = 'f20'
    const pin = (n: number) => dipPinHole(at, 14, n)
    const shift = (h: string, row: string) => `${row}${h.slice(1)}`
    // VCC (pin 14, row e) → top+ rail; GND (pin 7, row f) → top− rail; 1A (pin 1) floats → 1Y high
    const base = [W('vcc', shift(pin(14), 'a'), 'top+3'), W('gnd', shift(pin(7), 'j'), 'top-3')]
    const src = tracked(
      bench(
        [dip('U1', 'sn7404', at), twoLead('R1', 'resistor', shift(pin(2), 'j'), 'j40', { resistance: 330 }), twoLead('D1', 'led', 'i40', 'i44')],
        [...base, W('k', 'h44', 'top-5')],
      ),
    )
    const I = src.components.D1.pinCurrents!.anode
    expect(I).toBeGreaterThan(0.004)
    close(src.components.U1.pinCurrents?.['1Y'], -I, 1e-4) // leaves the chip at 1Y …
    close(src.components.U1.pinCurrents?.VCC, I, 1e-4) // … after entering at VCC (F5: was 0)
    close(src.components.U1.pinCurrents?.GND, 0, 0, 1e-7) // a sourcing output returns nothing through GND
    close(src.wireCurrents?.vcc, -I, 1e-4) // top+3 → the VCC strip (the wire runs strip → rail)
    close(src.wireCurrents?.wp, I, 1e-4) // the bench supply's + wire carries it …
    close(src.wireCurrents?.k, I, 1e-4) // … the LED's return reaches the − rail …
    close(src.wireCurrents?.wn, -I, 1e-4) // … and the − wire carries it back: one closed loop
    close(src.components.PS1.pinCurrents?.['+'], -I, 1e-4)
    close(src.components.PS1.pinCurrents?.['-'], I, 1e-4)

    // 2A tied high (to VCC) → 2Y low: an LED from the + rail sinks into 2Y
    const sink = tracked(
      bench(
        [
          dip('U1', 'sn7404', at),
          twoLead('D1', 'led', 'top+7', 'j40'),
          twoLead('R1', 'resistor', 'i40', shift(pin(4), 'j'), { resistance: 330 }),
        ],
        [...base, W('hi', shift(pin(3), 'j'), 'top+8')],
      ),
    )
    const Is = sink.components.D1.pinCurrents!.anode
    expect(Is).toBeGreaterThan(0.004)
    close(sink.components.U1.pinCurrents?.['2Y'], Is, 1e-4) // into the chip at 2Y
    close(sink.components.U1.pinCurrents?.GND, -Is, 1e-4) // …and out through its GND pin
    close(sink.wireCurrents?.gnd, Is, 1e-4) // GND strip → top− rail
  })

  it('no tracking, no currents: the default telemetry is unchanged (zero cost)', () => {
    const e = new SimEngine(bench([twoLead('R1', 'resistor', 'top+1', 'top-1', { resistance: 1000 })]))
    e.advance(0.001)
    const t = e.telemetry()
    expect(t.wireCurrents).toBeUndefined()
    expect(t.stripCurrents).toBeUndefined()
    expect(t.components.R1.pinCurrents).toBeUndefined()
  })
})

describe('MCU pins (board adapter stage drives)', () => {
  function mcuWorld(l: CircuitLayout, setup: (f: FakeMcu) => void) {
    const co = new SimulationCoordinator({
      createMcu: () => {
        const f = new FakeMcu()
        setup(f)
        return f
      },
    })
    co.setCurrentTracking(true)
    co.load(l, 1)
    return co
  }

  it('PA5 SOURCING an LED: current leaves the board at PA5 and the board closes KCL', () => {
    const l = bluePillWorld(
      [part('R1', 'resistor', ['a45', 'a50'], { resistance: 330 }), part('D1', 'led', ['b50', 'top-5'], { color: 'red' })],
      [w(tap('PA5'), 'e45')],
    )
    const pa5Wire = l.wires[l.wires.length - 1].id
    const supplyWire = l.wires[0].id // PS1:+ → the 5V pin's strip
    const co = mcuWorld(l, (f) => (f.pins.drives[PA5] = { mode: PIN_OUT_PP, level: 1, af: false }))
    co.advance(0.002)
    const t = co.telemetry()
    const I = t.components.D1.pinCurrents!.anode
    expect(I).toBeGreaterThan(0.003)
    const u1 = t.components.U1.pinCurrents!
    close(u1.PA5, -I, 1e-4)
    close(t.wireCurrents?.[pa5Wire], I, 1e-4) // tap(PA5) → e45
    // everything the board takes in at 5V comes back out of its pins
    let sum = 0
    for (const v of Object.values(u1)) sum += v
    expect(Math.abs(sum)).toBeLessThan(1e-6)
    expect(u1['5V']).toBeGreaterThan(I) // the regulator feeds the LED + the power LED
    close(t.wireCurrents?.[supplyWire], u1['5V'], 1e-4)
  })

  it('PA5 SINKING an LED from the 3.3 V rail: current enters the board at PA5', () => {
    const l = bluePillWorld(
      [part('D1', 'led', ['top+3', 'a40'], { color: 'red' }), part('R1', 'resistor', ['b40', 'b45'], { resistance: 330 })],
      [w('c45', tap('PA5'))],
      { rail3v3: true },
    )
    const pa5Wire = l.wires[l.wires.length - 1].id
    const co = mcuWorld(l, (f) => (f.pins.drives[PA5] = { mode: PIN_OUT_PP, level: 0, af: false }))
    co.advance(0.002)
    const t = co.telemetry()
    const I = t.components.D1.pinCurrents!.anode
    expect(I).toBeGreaterThan(0.002)
    close(t.components.U1.pinCurrents?.PA5, I, 1e-4)
    close(t.wireCurrents?.[pa5Wire], I, 1e-4) // c45 → tap(PA5)
  })

  it('a 25 % PWM on PA5: the published current is the time average (≈ 25 % of the on-current)', () => {
    const l = bluePillWorld(
      [part('R1', 'resistor', ['a45', 'a50'], { resistance: 330 }), part('D1', 'led', ['b50', 'top-5'], { color: 'red' })],
      [w(tap('PA5'), 'e45')],
    )
    // the fake core runs at 8 MHz: 1 kHz period = 8 000 cycles, 25 % high
    const on = mcuWorld(l, (f) => (f.pins.drives[PA5] = { mode: PIN_OUT_PP, level: 1, af: false }))
    on.advance(0.004)
    on.telemetry()
    on.advance(0.002)
    const full = on.telemetry().components.D1.pinCurrents!.anode
    const co = mcuWorld(l, (f) => f.addProgram(new PwmProgram(PA5, 8_000, 2_000, 0)))
    co.advance(0.004)
    co.telemetry() // start a fresh averaging window
    co.advance(0.02) // 20 whole periods
    const avg = co.telemetry().components.D1.pinCurrents!.anode
    expect(avg / full).toBeGreaterThan(0.23)
    expect(avg / full).toBeLessThan(0.27)
  })
})

describe('bit-identical solutions with tracking on', () => {
  it('an MCU world in lockstep produces the same node voltages tracked or not', () => {
    const l = bluePillWorld(
      [part('R1', 'resistor', ['a45', 'a50'], { resistance: 330 }), part('D1', 'led', ['b50', 'top-5'], { color: 'red' })],
      [w(tap('PA5'), 'e45')],
    )
    const run = (track: boolean) => {
      const co = new SimulationCoordinator({
        createMcu: () => {
          const f = new FakeMcu()
          f.addProgram(new PwmProgram(PA5, 7_200, 2_000, 0))
          return f
        },
      })
      co.setCurrentTracking(track)
      co.load(l, 1)
      const out: number[] = []
      for (let k = 0; k < 40; k++) {
        co.advance(DEFAULT_DT * 3)
        out.push(...Array.from(co.engine!.nodeVoltages))
      }
      return out
    }
    const a = run(false)
    const b = run(true)
    expect(b.length).toBe(a.length)
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) throw new Error(`node value ${i}: ${a[i]} vs ${b[i]}`)
  })
})
