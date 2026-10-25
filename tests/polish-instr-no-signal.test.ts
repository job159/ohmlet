/**
 * Release polish (instruments) — the logic analyzer's 「這些通道到目前為止都沒有
 * 訊號變化。」 is only said of a recorder that holds no change
 * (src/ui/embedded/instruments/la-no-signal.ts, used by LogicAnalyzer.tsx's
 * auto-fit). In blink's first second the recorder already holds PA5's boot
 * edges and the first toggle — too few for a period, so 「自動」 has nothing
 * to fit — and the analyzer now shows them instead of claiming there are none.
 * Checked on the REAL hal-blink firmware in the coordinator.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import '../src/mcu/all'
import { loadFirmwareFile } from '../src/mcu/loader'
import type { CircuitLayout } from '../src/model/types'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import type { LogicCapture } from '../src/sim/coordinator/api'
import { fitLogicSpan, spanAtLeast } from '../src/instruments/autofit'
import { EMPTY_RECHECK_MS, autoFitFallback, firstRecordedChange } from '../src/ui/embedded/instruments/la-no-signal'
import { Line, capture } from './instruments/synth'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LONG = { timeout: 120_000 }

function blinkAt(seconds: number): { cap: LogicCapture; now: number } {
  const env = JSON.parse(readFileSync(join(ROOT, 'examples/embedded/blink.ohmlet.json'), 'utf8')) as {
    layout: CircuitLayout
    instruments: { logicChannels: { index: number; label: string; source: { kind: 'mcu-pin'; componentId: string; pin: string } }[] }
  }
  const fw = loadFirmwareFile('hal-blink.elf', new Uint8Array(readFileSync(join(ROOT, 'firmware/dist/hal-blink.elf'))))
  if (!fw.ok) throw new Error(fw.error)
  const co = new SimulationCoordinator()
  co.load(env.layout, 1)
  co.setFirmware('U1', fw.image)
  // the example's PA5 / PC13, and an unused PB0 (index 2)
  co.setLogicChannels([...env.instruments.logicChannels, { index: 2, label: 'PB0', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PB0' } }])
  while (co.time < seconds) co.advance(0.01)
  const r = co.query({ kind: 'logic', t0: 0, t1: co.time })
  if (r.kind !== 'logic') throw new Error('query')
  return { cap: r.capture, now: co.time }
}

describe('「沒有訊號變化」 is true or not said', () => {
  it('blink at 0.4 s: the recorder holds PA5 edges, 「自動」 finds no period — the analyzer shows them (no 「沒有訊號變化」)', LONG, () => {
    const { cap, now } = blinkAt(0.4)
    const pa5 = cap.traces.find((x) => x.index === 0)!
    expect(pa5.times.length).toBeGreaterThan(0)
    const first = firstRecordedChange([cap])!
    expect(first).toBeLessThan(0.01)
    // the auto-fit itself has nothing to fit (the cause of the false overlay)
    expect(fitLogicSpan(cap, [], { t0: Math.max(0, now - 2), t1: now, slowest: true }).kind).toBe('none')
    const fb = autoFitFallback([cap], now)
    expect(fb).toEqual({ kind: 'recording', span: 0.5 })
    // the window following the clock holds every recorded change
    if (fb.kind === 'recording') expect(now - fb.span).toBeLessThan(first)
    // the unused PB0 alone: out of reset, then low — the overlay may say 「沒有訊號變化」
    const pb0 = { ...cap, traces: cap.traces.filter((x) => x.index === 2) }
    expect(pb0.traces[0].times.length).toBeGreaterThan(0)
    expect(autoFitFallback([pb0], now)).toEqual({ kind: 'empty' })
  })

  it('a recorder without any change: “empty” — the only case the overlay may say 「沒有訊號變化」', () => {
    const quiet = capture(0, 3, [new Line(0).trace(0), new Line(1).trace(1)])
    expect(firstRecordedChange([quiet])).toBeNull()
    expect(autoFitFallback([quiet], 3)).toEqual({ kind: 'empty' })
    expect(autoFitFallback([], 3)).toEqual({ kind: 'empty' })
  })

  it('a pin coming out of reset (undefined → low) is no signal change; the first 0 ↔ 1 is; the span stays on the zoom ladder, ≥ 10 ms', () => {
    // an unused PB0: undefined until the GPIO reset state, then low for good
    const boot = capture(0, 3, [new Line(2).set(0.00005, 0).trace(0)])
    expect(firstRecordedChange([boot])).toBeNull()
    expect(autoFitFallback([boot], 3)).toEqual({ kind: 'empty' })
    // blink's PA5: undefined → low at 0.000 05 s, high at 0.001 33 s
    const pa5 = capture(0, 0.003, [new Line(2).set(0.00005, 0).set(0.00133, 1).trace(0)])
    expect(firstRecordedChange([pa5])).toBe(0.00133)
    expect(autoFitFallback([pa5], 0.003)).toEqual({ kind: 'recording', span: 0.01 })
    // the earliest change of any capture (the fit looks at 2 s, 20 s and — when quiet — the whole recording)
    const late = capture(18, 25, [new Line(0).set(19, 1).trace(0)])
    expect(firstRecordedChange([late, pa5])).toBe(0.00133)
    expect(autoFitFallback([late], 25)).toEqual({ kind: 'recording', span: spanAtLeast(6 * 1.05) })
    // a window starting mid-recording judges from its initial level
    expect(firstRecordedChange([capture(5, 6, [new Line(1).set(5.5, 0).trace(0)])])).toBe(5.5)
  })

  it('the analyzer wires it in: product chrome only, the quiet recorder re-checked every 250 ms', () => {
    const src = readFileSync(join(ROOT, 'src/ui/embedded/LogicAnalyzer.tsx'), 'utf8')
    expect(src).toContain("result.kind === 'none' && !classicRef.current")
    expect(src).toContain('autoFitFallback(looked, now)')
    expect(src).toContain('queryLogic(quietTo, now)')
    expect(EMPTY_RECHECK_MS).toBe(250)
  })
})
