/**
 * Release QA, instruments area (IS-F3 … IS-F18) — the pure parts and the
 * stores behind each fix:
 *  - F3  ⏮ / ⏭ step from the picked frame (la-frames stepFrame);
 *  - F5  the free anchor hole itself takes a scope probe (probeHolesNear);
 *  - F6  a line faster than the analog samples gets no levels; 自動設定's
 *        timebase / trigger guards (measureWave minPulse, scope-autoset);
 *  - F7  a decimated window's averages from the full recording (averagesOf);
 *  - F8  the live summary looks back before calling a slow signal DC, names
 *        its source (timer / GPIO / serial data), keeps rails steady;
 *  - F9  a train that stopped is 'stopped', never 「時脈（突發）」; data roles
 *        never get a clock;
 *  - F10 how much of the window the probe's samples cover (amplitudeWindow);
 *  - F11 an unwired multimeter reads 「探棒未接」, not 0.000 V;
 *  - F12 an overwritten stretch of the recording (overwrittenBefore);
 *  - F13 the UART line under the shared cursor (lineAtTime);
 *  - F14 a UART line's bytes are searchable (decodedFrames bytes, frameMatches);
 *  - F15 a new off-board unit avoids the bench's leads (clearOffboardSpot);
 *  - F16 the phone sheet's view order (PRODUCT_VIEW_OPTIONS);
 *  - F17 one format per quantity (fmtUartLine, decoderSummary, I²C ACK).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { getEntry } from '../src/model/catalog'
import { boardExtents, holePosition, offboardBodyRect, offboardSlotSpan, offboardTerminalPosition, parseHole } from '../src/model/breadboard'
import { boardConfigOf } from '../src/model/types'
import { validateLayout } from '../src/model/validate'
import type { LogicCapture, LogicTrace } from '../src/sim/coordinator/api'
import { measureEdges, measureWave } from '../src/instruments/measure'
import { parseProject } from '../src/state/project'
import { __resetHistoryForTests, clearOffboardSpot, setOffboardPlacementPolicy, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import {
  __resetNetActivityForTests,
  getNetLive,
  ingestCapture,
  isRailNet,
  netLiveText,
  resolveNet,
} from '../src/ui/embedded/instruments/net-activity'
import { timingCell } from '../src/ui/embedded/instruments/signal-readout'
import { overwrittenBefore, stepFrame } from '../src/ui/embedded/instruments/la-frames'
import { amplitudeWindow, averagesOf, shortestPulse } from '../src/ui/embedded/instruments/scope-engine'
import { autosetTdiv, autosetTrigLevel, minTdivFor, tdivForPeriod } from '../src/ui/embedded/instruments/scope-autoset'
import { meterModeText, meterReading, probeWiringHint, unwiredProbes } from '../src/ui/embedded/instruments/meter-readout'
import { decodedFrames, runDecoder, type DecodedFrame } from '../src/ui/embedded/logic-decoders'
import { frameMatches, statusText } from '../src/ui/embedded/instruments/DecodeResults'
import { decoderSummary } from '../src/ui/embedded/instruments/la-config'
import { probeHolesNear, probeHolesOnNet } from '../src/ui/embedded/probe-actions'
import { fmtUartConfig, fmtUartLine, lineAtTime, type TerminalLine } from '../src/ui/embedded/UartTerminal'
import { PRODUCT_VIEW_OPTIONS } from '../src/ui/sheets/ScopeSheet'
import { ascii, i2cLines, Line, spiLines, uartLine } from './instruments/synth'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const example = (id: string): CircuitLayout => {
  const res = parseProject(readFileSync(join(ROOT, 'examples/embedded', `${id}.ohmlet.json`), 'utf8'))
  if (!res.ok) throw new Error(res.errors.join('; '))
  return res.project.layout
}

type Edges = Pick<LogicTrace, 'initial' | 'times' | 'levels'>
/** A square wave toggling every `half` s from `from` (first edge rising) up to `to`. */
function toggles(half: number, from: number, to: number, initial: 0 | 1 = 0): Edges {
  const times: number[] = []
  const levels: number[] = []
  let level: 0 | 1 = initial
  for (let t = from; t < to; t += half) {
    level = level === 1 ? 0 : 1
    times.push(t)
    levels.push(level)
  }
  return { initial, times: Float64Array.from(times), levels: Uint8Array.from(levels) }
}
/** Edges of `e` inside (t0, t1], with the level at t0 as `initial` — what a recorder query returns. */
function window(e: Edges, t0: number, t1: number): Edges {
  let initial = e.initial
  const times: number[] = []
  const levels: number[] = []
  for (let i = 0; i < e.times.length; i++) {
    if (e.times[i] <= t0) initial = e.levels[i] as 0 | 1
    else if (e.times[i] <= t1) {
      times.push(e.times[i])
      levels.push(e.levels[i])
    }
  }
  return { initial, times: Float64Array.from(times), levels: Uint8Array.from(levels) }
}

beforeEach(() => __setLangForTests('zh-TW'))

// ---------------------------------------------------------------------------
describe('IS-F3 ⏮ / ⏭ from the picked frame', () => {
  // 「tick N」 lines one second apart, start bits at N + 0.001 42 s
  const frames: DecodedFrame[] = Array.from({ length: 9 }, (_, i) => {
    const t0 = i + 1 + 0.00142
    return { id: `uart1@${t0}`, instance: 'uart1', decoder: 'UART', channel: 0, t0, t1: t0 + 0.0007, text: `"tick ${i + 1}\\r\\n"`, status: 'ok' }
  })
  const centreOf = (f: DecodedFrame) => (f.t0 + f.t1) / 2

  it('pick 「tick 5」, ⏭⏭, then ⏮⏮⏮: 6.001 42 → 5.001 42 → 4.001 42 s', () => {
    let picked = frames[4].id
    const step = (dir: 1 | -1) => {
      const cur = frames.find((f) => f.id === picked)!
      const f = stepFrame(frames, dir, { picked, markerA: cur.t0, mid: centreOf(cur), whole: false })!
      picked = f.id
      return f.t0
    }
    expect([step(1), step(1)]).toEqual([frames[5].t0, frames[6].t0])
    const back = [step(-1), step(-1), step(-1)]
    expect(back.map((x) => Number(x.toFixed(5)))).toEqual([6.00142, 5.00142, 4.00142])
  })
  it('the window centre alone found the current frame again (the bug)', () => {
    const cur = frames[6]
    // the old search: from the centre, whose frame starts before it
    const old = frames.filter((f) => f.t0 < centreOf(cur)).pop()
    expect(old?.id).toBe(cur.id)
    expect(stepFrame(frames, -1, { picked: cur.id, markerA: null, mid: centreOf(cur), whole: false })?.id).toBe(frames[5].id)
  })
  it('without a picked frame: from marker A, else the centre; ⤢ starts at the first frame', () => {
    expect(stepFrame(frames, 1, { picked: null, markerA: 3.5, mid: 8, whole: false })?.id).toBe(frames[3].id)
    expect(stepFrame(frames, -1, { picked: null, markerA: null, mid: 3.5, whole: false })?.id).toBe(frames[2].id)
    expect(stepFrame(frames, 1, { picked: frames[5].id, markerA: 6, mid: 0, whole: true })?.id).toBe(frames[0].id)
    expect(stepFrame(frames, -1, { picked: frames[0].id, markerA: null, mid: 1, whole: false })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('IS-F5 the free anchor hole takes the probe', () => {
  it('uart-hello: j15 (PA9’s only free hole) → [j15], on the net too', () => {
    const layout = example('uart-hello')
    expect(probeHolesNear(layout, 'j15')).toEqual(['j15'])
    expect(probeHolesOnNet(layout, 'j15')).toEqual(['j15'])
    // an occupied anchor still redirects to its strip's free holes (unchanged)
    expect(probeHolesNear(layout, 'h15')).toEqual(['j15'])
  })
})

// ---------------------------------------------------------------------------
describe('IS-F6 a line faster than the analog samples', () => {
  /** A 115 200 Bd line sampled every 50 µs (the analog recorder of the analyst's run). */
  function sampledUart(): { t: number[]; v: number[] } {
    const { line, end } = uartLine(ascii('tick 7\r\n'), { baud: 115200, lead: 2e-4 })
    const tr = line.trace()
    const sig = (x: number) => {
      let l = tr.initial
      for (let i = 0; i < tr.times.length && tr.times[i] <= x; i++) l = tr.levels[i] as 0 | 1
      return l === 1 ? 3.3 : 0
    }
    const t: number[] = []
    const v: number[] = []
    for (let x = 0; x <= end + 2e-4; x += 50e-6) {
      t.push(x)
      v.push(sig(x))
    }
    return { t, v }
  }

  it('no Vpp / Vavg / Vrms when one bit (8.68 µs) is shorter than 2 sample intervals (50 µs)', () => {
    const { t, v } = sampledUart()
    const plain = measureWave(t, v)
    expect(plain.vpp).not.toBeNull() // the old readout: a confident number
    const m = measureWave(t, v, -Infinity, Infinity, { minPulse: 1 / 115200 })
    expect(m).toMatchObject({ amplitude: 'undersampled', vpp: null, vavg: null, vrms: null, frequency: null })
    expect(m.sampleInterval!).toBeCloseTo(50e-6, 9)
    // a slow line on the same samples keeps its levels
    expect(measureWave(t, v, -Infinity, Infinity, { minPulse: 1e-3 }).amplitude).toBeNull()
  })
  it('the shortest known pulse: a serial bit, else the narrower polarity’s mean pulse of the exact edges', () => {
    expect(shortestPulse({ baud: 115200 }, null)).toBeCloseTo(8.68e-6, 8)
    expect(shortestPulse(null, { high: { count: 3, min: 2e-4, max: 3e-4, avg: 2.5e-4 }, low: { count: 3, min: 7e-4, max: 8e-4, avg: 7.5e-4 } })).toBe(2.5e-4)
    expect(shortestPulse(null, null)).toBeNull()
  })
  it('自動設定: never faster than 2 samples per division, the trigger never on a rail', () => {
    expect(minTdivFor(50e-6)).toBe(1e-4)
    expect(minTdivFor(null)).toBe(1e-6)
    // a UART bit as the "period": 100 µs/div, not 5 µs/div
    expect(tdivForPeriod(8.68e-6)).toBeLessThan(1e-5)
    expect(autosetTdiv(8.68e-6, 50e-6)).toBe(1e-4)
    // PWM 1 kHz and RC 100 Hz: unchanged
    expect(autosetTdiv(1e-3, 50e-6)).toBe(tdivForPeriod(1e-3))
    expect(autosetTdiv(1e-2, 2e-5)).toBe(tdivForPeriod(1e-2))
    expect(autosetTdiv(1e-3, null)).toBe(2e-4)
    // 50 % of the analog swing; one level seen (a UART line idling high): half of it, never 3.3 V
    expect(autosetTrigLevel(0, 3.3, 9)).toBe(1.65)
    expect(autosetTrigLevel(3.3, 3.3, 9)).toBe(1.65)
    expect(autosetTrigLevel(null, null, 1.2)).toBe(1.2)
  })
})

// ---------------------------------------------------------------------------
describe('IS-F7 a decimated window’s averages', () => {
  /** min/max decimation exactly like the recorder (recorders.ts SampleRing.capture). */
  function decimate(t: number[], v: number[], maxPoints: number): { t: Float64Array; v: Float32Array } {
    const n = t.length
    const buckets = Math.floor(maxPoints / 2)
    const ot: number[] = []
    const ov: number[] = []
    for (let b = 0; b < buckets; b++) {
      const s = Math.floor((b * n) / buckets)
      const e = Math.floor(((b + 1) * n) / buckets)
      if (e <= s) continue
      let lo = s
      let hi = s
      for (let i = s; i < e; i++) {
        if (v[i] < v[lo]) lo = i
        if (v[i] > v[hi]) hi = i
      }
      for (const i of lo === hi ? [lo] : [Math.min(lo, hi), Math.max(lo, hi)]) {
        ot.push(t[i])
        ov.push(v[i])
      }
    }
    return { t: Float64Array.from(ot), v: Float32Array.from(ov) }
  }

  it('a 34 % 1 kHz square wave: the decimated pairs bias the mean / RMS, the full recording does not', () => {
    const VOH = 3.3
    const duty = 0.34
    const t: number[] = []
    const v: number[] = []
    // an edge-exact square wave (two samples per edge) plus 10 µs steps — 1.2 s, like 500 ms/div paused
    for (let k = 0; k < 1200; k++) {
      const a = k * 1e-3
      // 10 µs steps; the solver steps onto each edge (a sample either side of it)
      for (let j = 0; j < 100; j++) {
        if (j === 34) {
          t.push(a + 34e-5 - 1e-9)
          v.push(VOH)
        }
        t.push(a + j * 1e-5)
        v.push(j < 34 ? VOH : 0)
      }
      t.push(a + 1e-3 - 1e-9)
      v.push(0)
    }
    const t0 = 0
    const t1 = t[t.length - 1]
    // buckets longer than a period (500 ms/div on a 1 kHz PWM): every bucket is a 0 V / 3.3 V pair
    const dec = decimate(t, v, 512)
    const biased = measureWave(dec.t, dec.v, t0, t1, { decimated: true })
    const trueAvg = duty * VOH
    const trueRms = VOH * Math.sqrt(duty)
    expect(Math.abs(biased.vavg! - trueAvg) / trueAvg).toBeGreaterThan(0.01) // the old ≈ value
    const cap = { t0, t1, traces: [{ index: 0, label: 'CH1', t: Float64Array.from(t), v: Float32Array.from(v), decimated: false }] }
    const full = averagesOf(cap, [0], t0, t1).get(0)!
    expect(Math.abs(full.vavg! - trueAvg) / trueAvg).toBeLessThan(0.01)
    expect(Math.abs(full.vrms! - trueRms) / trueRms).toBeLessThan(0.01)
    expect(full.dt).toBeCloseTo(1e-5, 9)
    // a decimated full capture is not used
    expect(averagesOf({ ...cap, traces: [{ ...cap.traces[0], decimated: true }] }, [0], t0, t1).size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
describe('IS-F8 one live summary that matches the analyzer', () => {
  /** U1 at h10 + PS1: PA5 recorded on D0 (blink's LED pin), PB12 on D1. */
  const LAYOUT: CircuitLayout = {
    version: 1,
    components: [
      { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
      { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    ],
    wires: [
      { id: 'W1', from: 'PS1:+', to: 'bot+0', color: 'red' },
      { id: 'W2', from: 'PS1:-', to: 'bot-0', color: 'black' },
    ],
  }
  const tel = (time: number, volts: Record<string, number>): SimTelemetry => ({ time, netVoltages: volts, components: {}, issues: [] })
  const cap = (t0: number, t1: number, traces: { index: number; e: Edges }[]): LogicCapture => ({
    t0,
    t1,
    tNow: t1,
    overflow: false,
    traces: traces.map(({ index, e }) => ({ index, label: `D${index}`, exact: true, since: 0, ...window(e, t0, t1) })),
  })
  let pa5 = ''
  let pb12 = ''

  beforeEach(() => {
    __resetNetActivityForTests()
    useStore.getState().resetSim()
    __resetHistoryForTests()
    useStore.setState({ layout: LAYOUT, selection: [], running: true, simTime: 10, telemetry: null })
    useLab.setState({
      mcus: {},
      logicChannels: [
        { index: 0, label: 'PA5 LED', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA5' } },
        { index: 1, label: 'PB12 DQ', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PB12' } },
      ],
    })
    pa5 = resolveNet({ componentId: 'U1', pin: 'PA5' }, LAYOUT) ?? ''
    pb12 = resolveNet({ componentId: 'U1', pin: 'PB12' }, LAYOUT) ?? ''
  })
  afterEach(() => {
    __resetNetActivityForTests()
    useStore.setState({ telemetry: null, running: false, simTime: 0 })
    useLab.setState({ logicChannels: [], mcus: {}, logicView: { ...useLab.getState().logicView, decoders: [] } })
  })

  it('blink’s 1 Hz PA5 reads 「週期訊號 0.998 Hz · 50.0 %」 between its edges, never 0 V / 3.10 V', () => {
    const blink = toggles(0.501, 0.501, 60)
    // the first read of the poll reaches back 5 s; then 250 ms reads that hold no edge at all
    useStore.setState({ telemetry: tel(10, { [pa5]: 0 }) })
    ingestCapture(cap(5, 10, [{ index: 0, e: blink }]))
    const seen = new Set<string>()
    for (let t = 10.25; t <= 13; t += 0.25) {
      useStore.setState({ simTime: t, telemetry: tel(t, { [pa5]: Math.floor(t / 0.501) % 2 ? 3.1 : 0 }) })
      ingestCapture(cap(t - 0.25, t, [{ index: 0, e: blink }]))
      seen.add(netLiveText(getNetLive({ componentId: 'U1', pin: 'PA5' })))
    }
    expect([...seen]).toEqual(['週期訊號 0.998 Hz · 50.0 %'])
    const live = getNetLive('j14' /* not on PA5 */)
    expect(live?.kind).not.toBe('pwm')
  })

  it('blink’s first second: too few edges to judge → 「訊號變化中」, never 「非週期」', () => {
    const blink = toggles(0.501, 0.501, 60)
    useStore.setState({ simTime: 1.6, telemetry: tel(1.6, { [pa5]: 3.1 }) })
    ingestCapture(cap(0, 1.6, [{ index: 0, e: blink }]))
    const live = getNetLive({ componentId: 'U1', pin: 'PA5' })
    expect(live).toMatchObject({ kind: 'toggling', young: true, source: 'gpio' })
    expect(netLiveText(live)).toBe('訊號變化中')
    // enough edges of one polarity: periodic, or plainly not periodic
    expect(netLiveText({ kind: 'toggling', edges: 12, v: 3.3 })).toBe('訊號變化中（非週期）')
    __setLangForTests('en')
    expect(netLiveText(live)).toBe('Changing')
  })

  it('a signal that stops is DC again after its look-back', () => {
    const e = toggles(0.501, 0.501, 11) // stops at ~10.5 s
    useStore.setState({ telemetry: tel(10, { [pa5]: 0 }) })
    ingestCapture(cap(5, 10, [{ index: 0, e }]))
    expect(getNetLive({ componentId: 'U1', pin: 'PA5' })?.kind).toBe('pwm')
    for (let t = 10.25; t <= 16; t += 0.25) {
      useStore.setState({ simTime: t, telemetry: tel(t, { [pa5]: 3.1 }) })
      ingestCapture(cap(t - 0.25, t, [{ index: 0, e }]))
    }
    expect(getNetLive({ componentId: 'U1', pin: 'PA5' })).toEqual({ kind: 'dc', v: 3.1 })
  })

  it('a decoder’s data role (1-Wire DQ) reads 「1-Wire 資料」 (the bus it carries — QA clarity MEASURE-COHERENCE), never 「PWM」', () => {
    useLab.setState({ logicView: { ...useLab.getState().logicView, decoders: [{ id: 'onewire1', decoder: 'onewire', channels: { dq: 1 } }] } })
    // a regular bit-banged burst (15.2 kHz) — the old readout called it 「PWM 15.20 kHz」
    const dq = toggles(1 / 30400, 9.95, 9.999)
    useStore.setState({ telemetry: tel(10, { [pb12]: 3.3 }) })
    ingestCapture(cap(9, 10, [{ index: 1, e: dq }]))
    const live = getNetLive({ componentId: 'U1', pin: 'PB12' })
    expect(live && 'source' in live ? live.source : null).toBe('data')
    expect(netLiveText(live)).toBe('1-Wire 資料')
    expect(netLiveText(live, { form: 'compact' })).toBe('1-Wire 資料')
    // quiet 100 ms after a burst: still changing (the look-back saw the bursts), not 3.30 V
    for (let t = 10.25; t <= 11; t += 0.25) {
      useStore.setState({ simTime: t, telemetry: tel(t, { [pb12]: 3.3 }) })
      ingestCapture(cap(t - 0.25, t, [{ index: 1, e: dq }]))
    }
    expect(netLiveText(getNetLive({ componentId: 'U1', pin: 'PB12' }))).toBe('1-Wire 資料')
  })

  it('a timer channel output is a PWM: 「PWM 1.000 kHz · 34.0 %」 (pin mode af, TIM3 clocked)', () => {
    const LAY = { ...LAYOUT }
    useStore.setState({ layout: LAY })
    useLab.setState({ logicChannels: [{ index: 0, label: 'PA6 PWM', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA6' } }], mcus: { U1: { componentId: 'U1', uarts: [], clocked: ['TIM3'] } as never } })
    const pa6 = resolveNet({ componentId: 'U1', pin: 'PA6' }, LAY) ?? ''
    const t = tel(10, { [pa6]: 3.3 })
    t.components.U1 = { mcu: { pinModes: { PA6: 'af' } } } as never
    useStore.setState({ telemetry: t })
    const e: Edges = (() => {
      const times: number[] = []
      const levels: number[] = []
      for (let k = 0; k < 400; k++) {
        times.push(9.6 + k * 1e-3, 9.6 + k * 1e-3 + 0.34e-3)
        levels.push(1, 0)
      }
      return { initial: 0, times: Float64Array.from(times), levels: Uint8Array.from(levels) }
    })()
    ingestCapture(cap(9.5, 10, [{ index: 0, e }]))
    const live = getNetLive({ componentId: 'U1', pin: 'PA6' })
    expect(live).toMatchObject({ kind: 'pwm', source: 'timer' })
    expect(netLiveText(live, { form: 'compact' })).toBe('PWM 1.000 kHz · 34.0 %')
  })

  it('steady rails are DC even unrecorded: PS1’s terminals, the board’s 3V3 / 5V / GND', () => {
    useLab.setState({ logicChannels: [] })
    const plus = resolveNet('PS1:+', LAYOUT)!
    const v3 = resolveNet({ componentId: 'U1', pin: '3V3_1' }, LAYOUT)!
    const v5 = resolveNet({ componentId: 'U1', pin: '5V' }, LAYOUT)!
    const gnd = resolveNet({ componentId: 'U1', pin: 'GND1' }, LAYOUT)!
    useStore.setState({ telemetry: tel(10, { [plus]: 5, [v3]: 3.3, [v5]: 5, [gnd]: 0, [pa5]: 3.1 }) })
    expect(getNetLive('PS1:+')).toEqual({ kind: 'dc', v: 5 })
    expect(getNetLive({ componentId: 'U1', pin: '3V3_1' })).toEqual({ kind: 'dc', v: 3.3 })
    expect(getNetLive({ componentId: 'U1', pin: '5V' })).toEqual({ kind: 'dc', v: 5 })
    expect(getNetLive({ componentId: 'U1', pin: 'GND1' })).toEqual({ kind: 'dc', v: 0 })
    expect(isRailNet(v3, LAYOUT)).toBe(true)
    // a GPIO is still the instantaneous solver value, said as such
    expect(getNetLive({ componentId: 'U1', pin: 'PA5' })).toEqual({ kind: 'unknown', v: 3.1, instantaneous: true })
    expect(netLiveText(getNetLive({ componentId: 'U1', pin: '3V3_1' }))).toBe('3.30 V')
  })
})

// ---------------------------------------------------------------------------
describe('IS-F9 「時脈（突發）」 only for a real clock burst', () => {
  it('a 1 Hz toggle that stopped at 35.57 s is \'stopped\', its footer says so', () => {
    const e = toggles(0.501, 0.501, 35.6) // last edge at 35.571 s, low after it
    const m = measureEdges(e, 30, 40)
    expect(m.periodicity).toBe('stopped')
    expect(m.stoppedAt!).toBeCloseTo(e.times[e.times.length - 1], 9)
    expect(m.frequency).toBeNull()
    expect(m.burstClock).toBeNull()
    const lvl = m.stoppedLevel
    const cell = timingCell(m, null, false, 0.01)
    expect(cell.kind).toBe('stopped')
    expect(cell.value).toBe(`—（已停在${lvl === 1 ? '高' : '低'}電位，最後一個邊緣 ${(Math.round(e.times[e.times.length - 1] * 100) / 100).toFixed(2)} s）`)
    expect(cell.value).not.toMatch(/時脈/)
    // floating after it (a pin back to an input)
    const f: Edges = { initial: e.initial, times: Float64Array.from([...e.times, 36]), levels: Uint8Array.from([...e.levels, 2]) }
    expect(timingCell(measureEdges(f, 30, 40), null, false, 0.01).value).toMatch(/^—（已停止，最後一個邊緣 35\.5\d s 之後浮接）$/)
  })
  it('one SPI byte with idle around it and an I²C SCL stay a clock burst', () => {
    const { sck } = spiLines([0xa5], [0x3c], { mode: 0, period: 1e-6 }, 50e-6)
    const spi = measureEdges(sck.trace(), 0, 200e-6)
    expect(spi.periodicity).toBe('burst')
    expect(timingCell(spi, null).value).toBe('1.000 MHz（突發）')
    const ops = []
    for (const a of [0x3c, 0x3d]) ops.push({ op: 'start' as const }, { op: 'byte' as const, value: a << 1, ack: true }, { op: 'stop' as const })
    const { scl, end } = i2cLines(ops, 10e-6)
    expect(timingCell(measureEdges(scl.trace(), 0, end), null).value).toMatch(/時脈|（突發）/)
  })
  it('a data role is serial data, never a clock or a stopped clock', () => {
    const { sck } = spiLines([0xa5], [0x3c], { mode: 0, period: 1e-6 }, 50e-6)
    const burst = measureEdges(sck.trace(), 0, 200e-6)
    expect(timingCell(burst, null, true).value).toBe('—（非週期訊號：序列資料）')
    const stopped = measureEdges(toggles(0.501, 0.501, 35.6), 30, 40)
    expect(timingCell(stopped, null, true).value).toBe('—（非週期訊號：序列資料）')
  })
  it('a steady PWM is still periodic; a regular train still running is not stopped', () => {
    const e = toggles(0.5e-3, 0, 0.1)
    expect(measureEdges(e, 0.05, 0.1).periodicity).toBe('periodic')
  })
})

// ---------------------------------------------------------------------------
describe('IS-F10 the probe’s own samples', () => {
  it('amplitudeWindow: from the first to the last sample inside the window', () => {
    const t = Float64Array.from([2.5, 2.6, 3.0, 3.5])
    const v = Float32Array.from([0, 3.1, 3.1, 0])
    expect(amplitudeWindow({ t, v }, 0, 4)).toBeCloseTo(1.0, 9)
    expect(amplitudeWindow({ t, v }, 2.55, 3.2)).toBeCloseTo(0.4, 9)
    expect(amplitudeWindow({ t: Float64Array.from([1]), v: Float32Array.from([1]) }, 0, 2)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
describe('IS-F11 an unwired multimeter measures nothing', () => {
  const dmm = { id: 'DMM1', type: 'multimeter', params: { mode: 'V' } }
  const entry = () => getEntry('multimeter')!
  const tele = { text: ['0.000 V', 'DC V'] } as never
  const base: CircuitLayout = { version: 1, components: [dmm], wires: [] }

  it('both probes open / one open / both wired', () => {
    expect(unwiredProbes(dmm, entry(), base)).toEqual(['COM', 'IN'])
    // what is missing, then the next step in the meter's mode
    expect(meterReading(dmm, entry(), tele, base)).toEqual({
      value: null,
      sub: '探棒未接（DMM1 兩支探棒都還沒接線）——把 COM 接到 GND、IN 接到要量的點',
      unwired: true,
    })
    const com = { ...base, wires: [{ id: 'W1', from: 'DMM1:COM', to: 'top-1' }] }
    expect(meterReading(dmm, entry(), tele, com)).toEqual({
      value: null,
      sub: '探棒未接（DMM1 IN 端還沒接線）——把 COM 接到 GND、IN 接到要量的點',
      unwired: true,
    })
    const both = { ...base, wires: [...com.wires, { id: 'W2', from: 'a10', to: 'DMM1:IN' }] }
    expect(meterReading(dmm, entry(), tele, both)).toEqual({ value: '0.000 V', sub: '直流電壓（IN − COM）' })
    // a part outside the layout (a lesson's expectation): its own reading as before
    expect(meterReading(dmm, entry(), tele, { version: 1, components: [], wires: [] }).value).toBe('0.000 V')
  })
  it('the next step follows the meter’s mode (A in series, Ω across the part)', () => {
    const amp = { ...dmm, params: { mode: 'A' } }
    expect(meterReading(amp, entry(), tele, { ...base, components: [amp] }).sub).toBe(
      '探棒未接（DMM1 兩支探棒都還沒接線）——把電表串進電流路徑：電流從 IN 流入、COM 流出',
    )
    // both spellings of the ohm (U+03A9 Greek omega, U+2126 ohm sign) read the same
    for (const ohm of ['Ω', 'Ω']) {
      expect(probeWiringHint(ohm)).toBe('把 IN 與 COM 接在要量的元件兩端（電路不通電）')
      expect(meterModeText(ohm)).toBe(meterModeText('Ω'))
    }
    expect(meterModeText('Ω')).not.toBe('Ω')
  })
  it('the classic chrome keeps the pre-QA readings (the meter’s own text, the compact supply voltage)', () => {
    __setLangForTests('en') // English without the workspace = the classic chrome
    expect(meterReading(dmm, entry(), tele, base)).toEqual({ value: '0.000 V', sub: 'DC voltage (IN − COM)' })
    const ps = { id: 'PS1', type: 'power_supply', params: { voltage: 5 } }
    const r = meterReading(ps, getEntry('power_supply')!, { current: 0.0123, pinVoltages: { '+': 5, '-': 0 } } as never, { version: 1, components: [ps], wires: [] })
    expect(r.sub).toBe('Output current · output 5.00 V')
    // the product chrome in English (the 量測 tab passes classic = false)
    expect(meterReading(dmm, entry(), tele, base, false).unwired).toBe(true)
  })
  it('the supply’s secondary voltage uses the reading precision (IS-F17)', () => {
    const ps = { id: 'PS1', type: 'power_supply', params: { voltage: 5 } }
    const r = meterReading(ps, getEntry('power_supply')!, { current: 0.0123, pinVoltages: { '+': 5, '-': 0 } } as never, { version: 1, components: [ps], wires: [] })
    expect(r.sub).toMatch(/5\.000 V/)
    expect(r.value).toBe('12.30 mA')
  })
})

// ---------------------------------------------------------------------------
describe('IS-F12 an overwritten stretch of the recording', () => {
  const tr = (initial: 0 | 1 | 2, times: number[]) => ({ index: 0, label: 'D0', exact: true, initial, times: Float64Array.from(times), levels: Uint8Array.from(times.map(() => 1)) })
  it('ring wrapped and the window before the oldest kept edge → overwritten; otherwise not', () => {
    expect(overwrittenBefore({ t0: 1, t1: 1.1, overflow: true, traces: [tr(2, [])] }, 0, 1.1)).toBe(true)
    expect(overwrittenBefore({ t0: 1, t1: 4, overflow: true, traces: [tr(2, [3.2])] }, 0, 1.1)).toBe(true)
    expect(overwrittenBefore({ t0: 1, t1: 4, overflow: true, traces: [tr(2, [1.05])] }, 0, 1.1)).toBe(false)
    expect(overwrittenBefore({ t0: 1, t1: 1.1, overflow: false, traces: [tr(2, [])] }, 0, 1.1)).toBe(false)
    expect(overwrittenBefore({ t0: 1, t1: 1.1, overflow: true, traces: [tr(1, [])] }, 0, 1.1)).toBe(false)
    expect(overwrittenBefore(null, 0, 1)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('IS-F13 the UART line under the shared cursor', () => {
  const line = (at: number, text: string, t0: number, t1: number, end: number): TerminalLine => ({
    kind: 'text',
    at,
    bytes: [...text].map((c) => c.charCodeAt(0)),
    text,
    t0,
    t1,
    end,
    echo: false,
  })
  const lines: TerminalLine[] = [line(0, 'tick 1', 1.0, 1.016, 1.016), line(8, 'tick 2', 2.0, 2.016, 2.016), line(16, 'tick 3', 3.0, 3.016, 3.016)]
  it('the decode table’s start bit of 「tick 2」 falls in line 「tick 2」', () => {
    const frameTime = 10 / 115200
    expect(lineAtTime(lines, 2.00142, frameTime)).toBe(8)
    expect(lineAtTime(lines, 2.0 - frameTime / 2, frameTime)).toBe(8)
    expect(lineAtTime(lines, 2.5, frameTime)).toBeNull()
    expect(lineAtTime(lines, null, frameTime)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('IS-F14 a UART line’s bytes are searchable', () => {
  it('「0x31」 finds 「tick 1」; the text and other decoders still match as before', () => {
    const baud = 115200
    const a = uartLine([...ascii('Hello\r\n'), ...ascii('tick 1\r\n')], { baud, lead: 1e-4 })
    const tr = a.line.trace(0)
    const cap: LogicCapture = { t0: 0, t1: a.end + 1e-3, overflow: false, traces: [tr] }
    const run = runDecoder(cap, { id: 'uart1', decoder: 'uart', channels: { data: 0 }, options: { baud: '115200' } })!
    const frames = decodedFrames([run])
    expect(frames[1].bytes).toBe('0x74 0x69 0x63 0x6B 0x20 0x31 0x0D 0x0A')
    const find = (q: string) => frames.filter((f) => frameMatches(f, q.toLowerCase(), statusText(f))).map((f) => f.text)
    expect(find('0x31')).toEqual(['"tick 1\\r\\n"'])
    expect(find('0X6b')).toEqual(['"tick 1\\r\\n"'])
    expect(find('hello')).toEqual(['"Hello\\r\\n"'])
    expect(find('0x0D')).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
describe('IS-F15 a new off-board unit avoids the bench’s leads', () => {
  type Geom = NonNullable<ReturnType<typeof getEntry>>['offboard']
  const plan = (layout: CircuitLayout) => {
    const units: { id: string; slot: number; pos?: { x: number; z: number }; geom?: Geom; pins: readonly string[] }[] = []
    let slot = 0
    for (const c of layout.components) {
      const e = getEntry(c.type)
      if (e?.placement !== 'offboard') continue
      units.push({ id: c.id, slot, pos: c.pos, geom: e.offboard, pins: e.pins })
      slot += offboardSlotSpan(e.offboard)
    }
    return { units, next: slot }
  }
  afterEach(() => setOffboardPlacementPolicy(null))

  it('blink (PS1 wired) + 數位萬用電表: off the PS1 leads, clear of the board and PS1’s posts', () => {
    const layout = example('blink')
    const spot = clearOffboardSpot(layout, getEntry('multimeter')!)
    expect(spot).not.toBeNull()
    const { units, next } = plan(layout)
    const r = offboardBodyRect(next, spot!, getEntry('multimeter')!.offboard)
    // no PS1 lead crosses it
    for (const w of layout.wires) {
      if (!w.from.startsWith('PS1:') && !w.to.startsWith('PS1:')) continue
      const term = w.from.startsWith('PS1:') ? w.from : w.to
      const hole = parseHole(term === w.from ? w.to : w.from)!
      const ps = units.find((u) => u.id === 'PS1')!
      const a = offboardTerminalPosition(ps.slot, ps.pins.indexOf(term.slice(4)), ps.pos, ps.geom)
      const b = holePosition(hole)
      for (let k = 0; k <= 100; k++) {
        const x = a.x + ((b.x - a.x) * k) / 100
        const z = a.z + ((b.z - a.z) * k) / 100
        expect(x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ, `${w.id} at ${k}%`).toBe(false)
      }
    }
    const ext = boardExtents(boardConfigOf(layout))
    expect(r.minX < ext.maxX && r.maxX > ext.minX && r.minZ < ext.maxZ && r.maxZ > ext.minZ).toBe(false)
    // and the store places it there in the new chrome — a valid layout, one undo step
    __resetHistoryForTests()
    useStore.setState({ layout, selection: [] })
    setOffboardPlacementPolicy(() => true)
    useStore.getState().addComponent('multimeter', {})
    const dmm = useStore.getState().layout.components.find((c) => c.type === 'multimeter')!
    expect(dmm).toMatchObject({ id: 'DMM1', pos: spot })
    expect(validateLayout(useStore.getState().layout).ok).toBe(true)
    useStore.getState().undo()
    expect(useStore.getState().layout.components.some((c) => c.type === 'multimeter')).toBe(false)
  })
  it('the classic chrome (no policy) and a clear slot keep the default shelf', () => {
    const layout = example('blink')
    __resetHistoryForTests()
    useStore.setState({ layout, selection: [] })
    useStore.getState().addComponent('multimeter', {})
    expect(useStore.getState().layout.components.find((c) => c.type === 'multimeter')?.pos).toBeUndefined()
    // nothing wired: the next shelf slot is clear
    expect(clearOffboardSpot({ version: 1, components: [{ id: 'PS1', type: 'power_supply' }], wires: [] }, getEntry('multimeter')!)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('IS-F16 / IS-F17 one order, one format', () => {
  it('the phone sheet lists the desktop tray’s views in its order', () => {
    expect(PRODUCT_VIEW_OPTIONS.map((o) => o.value)).toEqual(['uart', 'logic', 'scope', 'log', 'measure'])
    expect(PRODUCT_VIEW_OPTIONS.map((o) => o.title)).toEqual(['UART Terminal', 'Logic Analyzer', 'Oscilloscope', 'Simulation Log', 'Readings|tray'])
  })
  it('baud: 「115 200 Bd · 8N1」 on the UART badge and the decoder chip (classic keeps its spelling)', () => {
    const c = { enabled: true, baud: 115200, dataBits: 8 as const, parity: 'none' as const, stopBits: 1 as const }
    expect(fmtUartLine(c)).toBe('115 200 Bd · 8N1')
    expect(fmtUartLine({ ...c, baud: 9600, parity: 'even', dataBits: 9 as never })).toBe('9600 Bd · 8E1')
    expect(fmtUartLine(undefined)).toBe('not configured')
    expect(fmtUartConfig(c)).toBe('115200 8N1')
    const tr = (s: string, p?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(p?.[k] ?? ''))
    const chans = [{ index: 0, label: 'PA9 TX', source: { kind: 'mcu-pin' as const, componentId: 'U1', pin: 'PA9' } }]
    expect(decoderSummary({ decoder: 'uart', channels: { data: 0 }, options: { baud: '115200' } }, chans, tr, null, { product: true })).toBe('UART · PA9 TX · 115 200 Bd · 8N1')
    expect(decoderSummary({ decoder: 'uart', channels: { data: 0 }, options: {} }, chans, tr, 115200, { product: true })).toBe('UART · PA9 TX · 115 200 Bd (auto) · 8N1')
    expect(decoderSummary({ decoder: 'uart', channels: { data: 0 }, options: { baud: '115200' } }, chans, tr)).toBe('UART · PA9 TX · 115200 8N1')
  })
  it('an I²C address frame reads ACK / NACK like its lane', () => {
    const f = (text: string, status: DecodedFrame['status']): DecodedFrame => ({ id: text, instance: 'i2c1', decoder: 'I²C', channel: 1, t0: 0, t1: 1, text, status })
    expect(statusText(f('Addr 0x3C W', 'ok'))).toBe('ACK')
    expect(statusText(f('Addr 0x3D W', 'nack'))).toBe('NACK')
    expect(statusText(f('Addr 0x3C W', 'ok'), true)).toBe('OK')
    expect(statusText({ ...f('"tick 1"', 'ok'), decoder: 'UART' })).toBe('OK')
  })
})

// the synthetic line helper is used above through uartLine; keep the import honest
void Line
