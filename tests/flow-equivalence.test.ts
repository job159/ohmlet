/**
 * 顯示電流 never changes a solution: with current tracking ON the four bundled
 * legacy examples still reproduce the original engine's node voltages BIT FOR
 * BIT (the same fixture as tests/sim/legacy-equivalence.test.ts), and the
 * tracked telemetry carries pin / wire currents that close KCL per part.
 */
import { describe, expect, it } from 'vitest'
import { SimEngine } from '../src/sim/engine'
import fixture from './sim/fixtures/legacy-examples.json'
import { LEGACY_EXAMPLES, loadExample, runLegacyScenario } from './sim/legacy-scenarios'
import type { LegacyCapture } from './sim/legacy-scenarios'

const FIXTURE = (fixture as unknown as { examples: Record<string, LegacyCapture> }).examples

describe('legacy equivalence with current tracking on', () => {
  for (const [name, raw] of LEGACY_EXAMPLES) {
    it(`${name}: bit-identical node voltages, currents published`, { timeout: 120_000 }, () => {
      const engine = new SimEngine(loadExample(raw))
      engine.trackCurrents = true
      let lastTele: ReturnType<SimEngine['telemetry']> | null = null
      const got = runLegacyScenario(name, {
        stepOnce: () => engine.step(),
        setRuntimeParam: (id, k, v) => engine.setRuntimeParam(id, k, v),
        telemetry: () => (lastTele = engine.telemetry()),
      })
      const want = FIXTURE[name]
      expect(got.nets).toEqual(want.nets)
      for (let c = 0; c < want.checkpoints.length; c++) {
        const w = want.checkpoints[c]
        const g = got.checkpoints[c]
        for (let k = 0; k < w.v.length; k++) {
          if (!Object.is(g.v[k], w.v[k])) throw new Error(`${name}: net ${want.nets[k]} @ step ${w.step}: ${g.v[k]} vs ${w.v[k]}`)
        }
      }
      expect(got.issues).toEqual(want.issues)
      const tele = lastTele as ReturnType<SimEngine['telemetry']> | null
      expect(tele?.wireCurrents).toBeDefined()
      // every 2-terminal part closes KCL: what enters one lead leaves the other
      for (const [id, c] of Object.entries(tele!.components)) {
        const pc = c.pinCurrents
        if (!pc) continue
        const vals = Object.values(pc)
        if (vals.length !== 2) continue
        expect(Math.abs(vals[0] + vals[1]), id).toBeLessThan(1e-9 + 1e-6 * Math.abs(vals[0]))
      }
    })
  }
})
