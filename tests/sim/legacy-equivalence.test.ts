/**
 * Legacy equivalence: the embedded-platform engine hooks are additive, so the
 * four bundled examples must produce node voltages BIT-IDENTICAL to the
 * original engine (fixture captured from git 0ae7cc8 before any edit — see
 * legacy-scenarios.ts). The SimulationCoordinator in its pure-analog mode
 * (no MCU, no digital device) must reproduce the same numbers too.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_DT, SimEngine } from '../../src/sim/engine'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import fixture from './fixtures/legacy-examples.json'
import {
  LEGACY_EXAMPLES,
  LEGACY_STEPS,
  loadExample,
  runLegacyScenario,
} from './legacy-scenarios'
import type { LegacyCapture } from './legacy-scenarios'

const LONG = { timeout: 120_000 }
const FIXTURE = (fixture as unknown as { examples: Record<string, LegacyCapture> }).examples

function expectBitIdentical(name: string, got: LegacyCapture): void {
  const want = FIXTURE[name]
  expect(want, `fixture for ${name}`).toBeDefined()
  expect(got.nets).toEqual(want.nets)
  expect(got.checkpoints.length).toBe(want.checkpoints.length)
  let compared = 0
  for (let c = 0; c < want.checkpoints.length; c++) {
    const w = want.checkpoints[c]
    const g = got.checkpoints[c]
    expect(g.step).toBe(w.step)
    expect(Object.is(g.time, w.time), `${name} time @${w.step}`).toBe(true)
    for (let k = 0; k < w.v.length; k++) {
      // Object.is: exact bits (distinguishes 0 / −0, null = NaN)
      if (!Object.is(g.v[k], w.v[k])) {
        throw new Error(`${name}: net ${want.nets[k]} @ step ${w.step}: got ${g.v[k]}, legacy ${w.v[k]}`)
      }
      compared++
    }
  }
  expect(compared).toBeGreaterThan(0)
  expect(got.issues).toEqual(want.issues)
}

describe('legacy equivalence: SimEngine on the bundled examples', () => {
  for (const [name, raw] of LEGACY_EXAMPLES) {
    it(`${name}: ${LEGACY_STEPS} steps bit-identical to the original engine`, LONG, () => {
      const engine = new SimEngine(loadExample(raw))
      const got = runLegacyScenario(name, {
        stepOnce: () => engine.step(),
        setRuntimeParam: (id, k, v) => engine.setRuntimeParam(id, k, v),
        telemetry: () => engine.telemetry(),
      })
      expectBitIdentical(name, got)
    })
  }

  it('the fixture really moves (guards against a trivially constant capture)', () => {
    const blinky = FIXTURE['blinky-555']
    const series = blinky.checkpoints.map((c) => c.v)
    const distinct = new Set(series.map((v) => JSON.stringify(v)))
    expect(distinct.size).toBeGreaterThan(5)
  })
})

describe('legacy equivalence: SimulationCoordinator (no MCU, no digital device)', () => {
  for (const [name, raw] of LEGACY_EXAMPLES) {
    it(`${name}: advance(DEFAULT_DT) ≡ one engine step, bit-identical`, LONG, () => {
      const co = new SimulationCoordinator()
      co.load(loadExample(raw), 1)
      const got = runLegacyScenario(name, {
        stepOnce: () => co.advance(DEFAULT_DT),
        setRuntimeParam: (id, k, v) => co.setRuntimeParam(id, k, v),
        telemetry: () => co.telemetry(),
      })
      expectBitIdentical(name, got)
      expect(co.stepCount).toBe(LEGACY_STEPS)
    })
  }

  it('coarse advance() chunks take the same steps as the legacy store loop', LONG, () => {
    const [, raw] = LEGACY_EXAMPLES[0]
    const co = new SimulationCoordinator()
    co.load(loadExample(raw), 1)
    const engine = new SimEngine(loadExample(raw))
    // 1/60 s frames, like the legacy rAF loop
    for (let f = 0; f < 30; f++) co.advance(1 / 60)
    while (engine.time < co.time - DEFAULT_DT * 0.5) engine.step()
    expect(co.stepCount).toBe(Math.round(engine.time / DEFAULT_DT))
    const a = co.telemetry().netVoltages
    const b = engine.telemetry().netVoltages
    for (const k of Object.keys(b)) expect(Object.is(a[k], b[k]), k).toBe(true)
  })
})
