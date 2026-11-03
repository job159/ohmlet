/**
 * 「電路說明」 (round 5 — explain): the pure summarizer (src/ui/chrome/explain.ts)
 * on REAL circuits — the real simulation engine sampled at the store's 10 Hz
 * into the history (observeTelemetry), the real rule check (runErc) and
 * problems list (deriveProblems):
 *  - a lit LED prints the inspector's own 「49 %（9.70 mA）」 and its path
 *    「由 5.00 V 經 R1 330 Ω 供電」;
 *  - an open cathode → 「不亮：陰極（c20）沒有接地」 + where the wire goes;
 *  - no resistor → burned, with the current the simulator's issue states (the
 *    issue text is pinned: BURN_ISSUE) and the 換新 recovery words;
 *  - the 555 blinker → 「在閃」 on every refresh (no flicker), a period only
 *    from observed flips;
 *  - what the blinking looks like (round 5 final): pwm-fade's breathing LED
 *    (its real firmware) → 「漸亮漸暗，週期約 2.00 s：最亮 …」, never 「在閃」;
 *    the blink example → 「在閃」; a slow analog triangle → 漸亮漸暗; fast PWM
 *    → 「亮著（PWM）」; a shape not told → 「一明一暗」; a beeping buzzer →
 *    「嗶嗶響」, a buzzer tone faster than the readings → 「在響」 on every
 *    refresh, a silent one 「不響：…」 (never 「沒亮」);
 *  - an open pushbutton → the benign 「SW1 沒按下，電路斷開」;
 *  - synthetic MCU frames for each board blocker, the halt and the lockup;
 *  - paused tag, the static (no telemetry) text, the empty board;
 *  - priority (tiers) and aggregation, selection as the tie-break that never
 *    jumps tiers;
 *  - properties: no line contains a Problem.title; every number in a line is
 *    a formatter's output of an input value (or a constant of the template).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LESSONS } from '../src/lessons'
import { __setLangForTests, lang, type Lang } from '../src/i18n'
import { fmtEng } from '../src/ui/format'
import { getEntry } from '../src/model/catalog'
import { useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { useProblems } from '../src/ui/embedded/problems'
import { EXPLAIN_ANNOUNCE_MS, EXPLAIN_DWELL_MS, EXPLAIN_REFRESH_MS, EXPLAIN_STALE_MS, startExplainWatcher, useExplainView } from '../src/ui/chrome/useExplanation'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import type { McuFrameInfo } from '../src/sim/coordinator/api'
import { SimEngine } from '../src/sim/engine'
import { runErc, type ErcFinding } from '../src/sim/erc'
import '../src/sim/models'
import { fmtCurrent, fmtPower, fmtSimClock, fmtSpan, fmtVoltage } from '../src/instruments/format'
import { ledLightParts } from '../src/instruments/led-light'
import { deriveProblems, type Problem } from '../src/ui/embedded/problems'
import { EXAMPLES } from '../src/ui/workspace/examples'
import { loadFirmwareFile } from '../src/mcu/loader'
import '../src/mcu/all'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { parseProject } from '../src/state/project'
import {
  BLINK_WINDOW_S,
  BURN_ISSUE,
  TIER,
  blinkPeriod,
  fmtPeriod,
  blinkShape,
  shapeOf,
  burnCurrentOf,
  explainCircuit,
  explainForPill,
  isBlinking,
  newExplainHistory,
  noteUart,
  noteUserAction,
  observeTelemetry,
  type ExplainHistory,
  type ExplainInput,
  type Explanation,
} from '../src/ui/chrome/explain'
import { BP, tap, valid } from './erc/helpers'
import { stateColor } from '../src/ui/chrome/run-control'

const ROOT = path.resolve(__dirname, '..')

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => __setLangForTests('zh-TW'))

const PS = (v = 5) => ({ id: 'PS1', type: 'power_supply', params: { voltage: v } })
const RAILS = [
  { id: 'W1', from: 'PS1:+', to: 'top+0' },
  { id: 'W2', from: 'PS1:-', to: 'top-0' },
]
const led = (id: string, holes: string[], color = 'red') => ({ id, type: 'led', holes, params: { color } })
const res = (id: string, holes: string[], resistance: number) => ({ id, type: 'resistor', holes, params: { resistance } })

/** PS1 → R1 (top+3 → a10) → LED1 (b10 → top-4) — the classic first circuit. */
const ledCircuit = (r = 330): CircuitLayout => valid({ version: 1, components: [PS(), res('R1', ['top+3', 'a10'], r), led('LED1', ['b10', 'top-4'])], wires: RAILS })

/** Every explanation the tests produce, with the input and language it was given (the property checks read them). */
const produced: { e: Explanation; input: ExplainInput; lang: Lang }[] = []

interface Run {
  tele: SimTelemetry
  findings: ErcFinding[]
  problems: Problem[]
  history: ExplainHistory
  explain(over?: Partial<ExplainInput>): Explanation
}

/** Run `layout` for `seconds` at the store's 10 Hz, observing every snapshot; the rule check and problems on the last one. */
function run(layout: CircuitLayout, seconds: number, each?: (r: Run) => void): Run {
  const engine = new SimEngine(layout)
  const history = newExplainHistory()
  let r!: Run
  const at = (tele: SimTelemetry): Run => {
    const findings = runErc(layout, { telemetry: tele, issues: tele.issues })
    const problems = deriveProblems({ layout, findings, issues: tele.issues, firmware: {}, mcus: {}, running: true, simTime: tele.time })
    return {
      tele,
      findings,
      problems,
      history,
      explain: (over = {}) => record({ layout, telemetry: tele, phase: 'running', problems, findings, history, ...over }),
    }
  }
  for (let i = 0; i < Math.round(seconds * 10); i++) {
    engine.advance(0.1, 1e-3)
    const tele = engine.telemetry()
    observeTelemetry(history, layout, tele)
    if (each) each(at(tele))
  }
  r = at(engine.telemetry())
  return r
}

function record(input: ExplainInput): Explanation {
  const e = explainCircuit(input)
  produced.push({ e, input, lang: lang() })
  return e
}

describe('explain: what works', () => {
  it('a lit LED: the inspector’s brightness and current, its path, the green dot', () => {
    const r = run(ledCircuit(330), 1)
    const t = r.tele.components.LED1
    const e = r.explain()
    expect(e.tier).toBe(TIER.works)
    expect(e.tone).toBe('ok')
    expect(e.lines[0]).toBe(`LED1 亮著：亮度 ${ledLightParts(t.light, t.current).value}`)
    expect(e.lines[0]).toMatch(/^LED1 亮著：亮度 \d+ %（\d+\.\d+ mA）$/)
    // the source is the measured rail, the resistor its param in the inspector's format
    expect(e.lines[1]).toBe('由 5.00 V 經 R1 330 Ω 供電')
    expect(e.subjectIds).toEqual(['LED1'])
    expect(e.key).toBe('5:LED1:lit')
    expect(e.short).toBe(e.lines[0])
  })

  it('two LEDs: the first in layout order, the other aggregated; a selection wins the tie', () => {
    const l = valid({
      version: 1,
      components: [PS(), res('R1', ['top+3', 'a10'], 330), led('LED1', ['b10', 'top-4']), res('R2', ['top+8', 'a16'], 330), led('LED2', ['b16', 'top-9'], 'green')],
      wires: RAILS,
    })
    const r = run(l, 1)
    const e = r.explain()
    expect(e.lines[0]).toMatch(/^LED1 亮著/)
    expect(e.lines[1]).toBe(`另外 LED2 也亮著（${fmtCurrent(Math.abs(r.tele.components.LED2.current!))}）`)
    const sel = r.explain({ selection: ['LED2'] })
    expect(sel.lines[0]).toMatch(/^LED2 亮著/)
    expect(sel.lines[1]).toBe(`另外 LED1 也亮著（${fmtCurrent(Math.abs(r.tele.components.LED1.current!))}）`)
  })

  it('the 555 blinker: 「在閃」 on every 2 Hz refresh once it blinks — never flickering to lit / dark', () => {
    const blinker = EXAMPLES.find((x) => x.title === '555 LED blinker')!.layout
    const keys: string[] = []
    let i = 0
    const r = run(blinker, 6, (snap) => {
      // the hook refreshes at 2 Hz: every 5th snapshot, from 3 s on (two flips seen by then)
      if (++i % 5 === 0 && snap.tele.time >= 3) keys.push(snap.explain().key)
    })
    expect(keys.length).toBeGreaterThanOrEqual(6)
    expect(new Set(keys)).toEqual(new Set(['5:D1:blink']))
    const e = r.explain()
    const period = blinkPeriod(r.history.emitters.get('D1'), r.tele.time)
    // ≈ 1.5 Hz astable: a period from the observed flips (10 Hz sampling, so ± one sample)
    expect(period).not.toBeNull()
    expect(period!).toBeGreaterThan(0.45)
    expect(period!).toBeLessThan(0.95)
    expect(e.lines[0]).toMatch(/^D1 在閃，約每 \d+(\.\d+)? m?s 一次：亮時 \d+\.\d+ mA$/) // fmtPeriod: 「0.7 s」
    // its path: the 555's output through the series resistor
    expect(e.lines[1]).toMatch(/^由 U1 \S+ 經 R3 470 Ω 驅動$/)
  })
})

describe('explain: motors, buzzers (synthetic readings)', () => {
  it('a turning motor in revolutions per minute (the cheer’s threshold), a sounding buzzer; a still one is no news', () => {
    const l: CircuitLayout = { version: 1, components: [{ id: 'M1', type: 'dc_motor' }, { id: 'BZ1', type: 'buzzer' }], wires: [] }
    const tele = (rpm: number, sounding: boolean): SimTelemetry => ({
      time: 1,
      netVoltages: {},
      components: { M1: { pinVoltages: {}, values: { rpm } }, BZ1: { pinVoltages: {}, sounding } },
      issues: [],
    })
    const e = record({ layout: l, telemetry: tele(1240.4, true), phase: 'running', problems: [] })
    expect(e.lines).toEqual(['M1 在轉：每分鐘 1240 轉', '另外，BZ1 在響'])
    expect(record({ layout: l, telemetry: tele(-3, true), phase: 'running', problems: [] }).lines).toEqual(['BZ1 在響'])
    expect(record({ layout: l, telemetry: tele(0, false), phase: 'running', problems: [] }).lines).toEqual(['電路模擬中'])
    __setLangForTests('en')
    expect(record({ layout: l, telemetry: tele(1240.4, false), phase: 'running', problems: [] }).lines).toEqual(['M1 is turning: 1240 rpm'])
  })
})

describe('explain: what does not work, and why', () => {
  it('an open cathode: the strip that does not reach ground, and where the wire goes', () => {
    const l = valid({ version: 1, components: [PS(), res('R1', ['top+3', 'a10'], 330), led('LED1', ['b10', 'c20'])], wires: RAILS })
    const e = run(l, 1).explain()
    expect(e.tier).toBe(TIER.cause)
    expect(e.tone).toBe('warning')
    expect(e.lines[0]).toBe('LED1 不亮：陰極（c20）沒有接地')
    expect(e.lines[1]).toMatch(/^用導線把 LED1 陰極（c20）接到上方 − 電源軌 第 \d+ 孔$/)
  })

  it('before any run (no telemetry): the static rule-check words, no numbers', () => {
    const l = valid({ version: 1, components: [PS(), res('R1', ['top+3', 'a10'], 330), led('LED1', ['b10', 'c20'])], wires: RAILS })
    const findings = runErc(l)
    const problems = deriveProblems({ layout: l, findings, issues: [], firmware: {}, mcus: {}, running: false, simTime: 0 })
    const e = record({ layout: l, telemetry: null, phase: 'idle', problems, findings })
    expect(e.lines[0]).toBe('LED1 不會亮：陰極（c20）沒有接地')
    const bare = valid({ version: 1, components: [PS(), led('LED1', ['top+3', 'top-4'])], wires: RAILS })
    const f2 = runErc(bare)
    const s2 = record({ layout: bare, telemetry: null, phase: 'idle', problems: deriveProblems({ layout: bare, findings: f2, issues: [], firmware: {}, mcus: {}, running: false, simTime: 0 }), findings: f2 })
    expect(s2.lines[0]).toBe('LED1 沒有串限流電阻：電流可能過大')
    // the value is the rule check's own (rules-led suggestion), never computed here
    const advised = /about (\d+(?:\.\d+)? [kM]?Ω)/.exec(f2.find((f) => f.rule === 'led-current')!.message)![1]
    expect(s2.lines[1]).toBe(`串一顆約 ${advised} 的限流電阻`)
    // nothing to say yet
    const quiet = record({ layout: ledCircuit(), telemetry: null, phase: 'idle', problems: [] })
    expect(quiet.lines).toEqual(['模擬還沒開始', '開始模擬後，這裡會說明電路正在做什麼'])
    expect(quiet.tone).toBe('idle')
  })

  it('a resistor far too small: burned, with the current the simulator reported, and the 換新 words', () => {
    const r = run(ledCircuit(10), 0.3)
    expect(r.tele.components.LED1.burned).toBe(true)
    // the engine's issue text is the only place the burn current survives: pinned
    const issue = r.tele.issues.find((i) => BURN_ISSUE.test(i.message))
    expect(issue?.message).toMatch(/^LED LED1 burned out \(current \d+mA — add a series resistor\)$/)
    const i = burnCurrentOf(r.tele.issues, 'LED1')!
    expect(i).toBeGreaterThan(0.15)
    expect(i).toBeLessThan(2)
    const e = r.explain()
    expect(e.tier).toBe(TIER.damage)
    expect(e.tone).toBe('error')
    expect(e.lines[0]).toBe(`LED1 燒毀：量到 ${fmtCurrent(i)}，超過額定 20 mA`) // measured (the ERC row says 「最多約 …」)
    // the value is the rule check's own ('Use at least … in series')
    const advised = /at least (\d+(?:\.\d+)? [kM]?Ω)/.exec(r.findings.find((f) => f.rule === 'led-current' && f.componentIds[0] === 'LED1')!.message)![1]
    expect(e.lines[1]).toBe(`改用至少 ${advised} 的限流電阻；改好就會自動換上新的 LED1`)
    // no value from the rule check, a resistor in series: the 換新 recovery words of the damage banner
    expect(r.explain({ findings: [] }).lines[1]).toBe('按〔換新〕換上新的；改好電路或數值也會自動換新')
  })

  it('no resistor at all: burned, no meaningless number, 「串一顆限流電阻」', () => {
    const l = valid({ version: 1, components: [PS(), led('LED1', ['top+3', 'top-4'])], wires: RAILS })
    const r = run(l, 0.3)
    expect(r.tele.components.LED1.burned).toBe(true)
    // straight across a stiff supply the solver's burn current is no reading (> 2 A): not printed
    expect(r.tele.issues.some((i) => BURN_ISSUE.test(i.message))).toBe(true)
    expect(burnCurrentOf(r.tele.issues, 'LED1')).toBeNull()
    const e = r.explain()
    expect(e.lines[0]).toBe('LED1 燒毀：電流遠超過額定 20 mA')
    const advised = /about (\d+(?:\.\d+)? [kM]?Ω)/.exec(r.findings.find((f) => f.rule === 'led-current' && f.componentIds[0] === 'LED1')!.message)![1]
    expect(e.lines[1]).toBe(`串一顆約 ${advised} 的限流電阻；改好就會自動換上新的 LED1`)
    // without the rule check's value: the decision's own words
    expect(r.explain({ findings: [] }).lines[1]).toBe('串一顆限流電阻；改好就會自動換上新的 LED1')
  })

  it('an open pushbutton: the benign reason, and how to close it', () => {
    const l = valid({
      version: 1,
      components: [PS(), { id: 'SW1', type: 'pushbutton', at: 'f10' }, res('R1', ['h12', 'h20'], 330), led('LED1', ['i20', 'top-22'])],
      wires: [...RAILS, { id: 'W3', from: 'top+5', to: 'j10' }],
    })
    const e = run(l, 0.5).explain()
    expect(e.tier).toBe(TIER.benign)
    expect(e.lines).toEqual(['LED1 沒亮：SW1 沒按下，電路斷開', '按住 SW1，電路就會接通'])
    expect(e.subjectIds).toEqual(['LED1', 'SW1'])
    // pressed: it lights
    const on = { ...l, components: l.components.map((c) => (c.id === 'SW1' ? { ...c, params: { pressed: true } } : c)) }
    expect(run(on, 0.5).explain().lines[0]).toMatch(/^LED1 亮著：亮度/)
  })

  it('priority: damage before what works, even when the working part is selected', () => {
    const l = valid({
      version: 1,
      components: [PS(), res('R1', ['top+3', 'a10'], 330), led('LED1', ['b10', 'top-4']), led('LED2', ['top+8', 'top-9'], 'green')],
      wires: RAILS,
    })
    const r = run(l, 0.5)
    const e = r.explain({ selection: ['LED1'] })
    expect(e.tier).toBe(TIER.damage)
    expect(e.lines[0]).toMatch(/^LED2 燒毀/)
  })
})

describe('explain: boards (synthetic MCU frames)', () => {
  const frame = (over: Partial<McuFrameInfo>): McuFrameInfo => ({
    componentId: 'U1',
    state: 'running',
    firmware: 'hal-blink.elf',
    pc: 0x08000100,
    hclkHz: 8e6,
    cycles: 1000,
    realtime: 1,
    uarts: [],
    ...over,
  })
  const fw = { U1: { componentId: 'U1', name: 'hal-blink.elf', format: 'elf' as const, sha256: 'x', size: 1, loadedAt: 0, warnings: [] } }
  const board = (): CircuitLayout => {
    const pa5 = tap('PA5')
    return valid({ version: 1, components: [PS(), BP, res('R1', [pa5, 'a45'], 330), led('LED1', ['b45', 'top-46'])], wires: RAILS })
  }
  const tele = (time: number): SimTelemetry => ({ time, netVoltages: {}, components: { U1: { pinVoltages: {} }, LED1: { pinVoltages: {}, current: 0, light: 0 } }, issues: [] })
  const problemsFor = (layout: CircuitLayout, firmware: Record<string, (typeof fw)['U1']>, mcus: Record<string, McuFrameInfo>) =>
    deriveProblems({ layout, findings: [], issues: [], firmware, mcus, running: true, simTime: 5 })

  it('no firmware: a board alone in its own words; an LED it drives says the effect AND the cause (the board line is not repeated)', () => {
    const alone = valid({ version: 1, components: [PS(), BP], wires: RAILS })
    const a = record({ layout: alone, telemetry: tele(1), phase: 'running', problems: problemsFor(alone, {}, {}), firmware: {}, mcus: {} })
    expect(a.tier).toBe(TIER.power)
    expect(a.tone).toBe('warning')
    expect(a.lines).toEqual(['U1 沒有韌體，不會執行任何程式', '替 U1 載入韌體'])
    const l = board()
    const problems = problemsFor(l, {}, {})
    const e = record({ layout: l, telemetry: tele(1), phase: 'running', problems, firmware: {}, mcus: {} })
    expect(e.tier).toBe(TIER.cause)
    expect(e.lines).toEqual(['LED1 不亮：驅動它的 U1 沒有韌體', '替 U1 載入韌體'])
    // the board's own state colour (H6), not a generic warning dot
    expect(e.dot).toBe(stateColor('no-firmware'))
    expect(e.subjectIds[0]).toBe('LED1')
  })

  it('the LED’s own cause names the board that drives it (something else works, the LED is selected)', () => {
    const l = valid({ ...board(), components: [...board().components, res('R9', ['top+38', 'a38'], 330), led('LED9', ['b38', 'top-39'], 'green')] })
    const problems = problemsFor(l, {}, {})
    const t9 = tele(1)
    t9.components.LED9 = { pinVoltages: {}, current: 0.0095, light: 0.475 }
    const e = record({ layout: l, telemetry: t9, phase: 'running', problems, firmware: {}, mcus: {}, selection: ['LED1'] })
    expect(e.tier).toBe(TIER.cause)
    expect(e.lines).toEqual(['LED1 不亮：驅動它的 U1 沒有韌體', '替 U1 載入韌體'])
    // before a run: the same cause in the static words
    const s = record({ layout: l, telemetry: null, phase: 'idle', problems, firmware: {}, mcus: {}, selection: ['LED1'] })
    expect(s.lines).toEqual(['LED1 不會亮：驅動它的 U1 沒有韌體', '替 U1 載入韌體'])
  })

  it('no power / BOOT0 / lockup / debugger halt', () => {
    const l = board()
    const alone = valid({ version: 1, components: [PS(), BP], wires: RAILS })
    const unpowered = problemsFor(alone, fw, { U1: frame({ state: 'unpowered' }) })
    const a = record({ layout: alone, telemetry: tele(1), phase: 'running', problems: unpowered, firmware: fw, mcus: { U1: frame({ state: 'unpowered' }) } })
    expect(a.tier).toBe(TIER.power)
    expect(a.tone).toBe('error')
    expect(a.lines[0]).toBe('U1 沒有電，不會執行任何程式')
    // line 2: the fix sentence of the board's own row (its last sentence)
    const row = unpowered.find((p) => p.fact === 'power:U1')!
    expect(a.lines[1]).toBe(row.detail.split('。').filter(Boolean).pop())
    // an LED it drives: the effect, the cause, the same fix
    const led1 = record({ layout: l, telemetry: tele(1), phase: 'running', problems: problemsFor(l, fw, { U1: frame({ state: 'unpowered' }) }), firmware: fw, mcus: { U1: frame({ state: 'unpowered' }) } })
    expect(led1.lines).toEqual(['LED1 不亮：驅動它的 U1 沒有電', a.lines[1]])
    const boot = frame({ pc: 0x1ffff100 })
    const b = record({ layout: alone, telemetry: tele(1), phase: 'running', problems: problemsFor(alone, fw, { U1: boot }), firmware: fw, mcus: { U1: boot } })
    expect(b.lines[0]).toBe('U1 的 BOOT0 = 1，開機後執行內建的開機程式')
    const lock = frame({ state: 'lockup' })
    const c = record({ layout: l, telemetry: tele(1), phase: 'fault', problems: problemsFor(l, fw, { U1: lock }), firmware: fw, mcus: { U1: lock } })
    expect(c.tier).toBe(TIER.session)
    expect(c.tone).toBe('error')
    expect(c.lines[0]).toBe('U1 當機了：韌體停止執行')
    expect(c.lines).toHaveLength(2)
    const halt = frame({ state: 'halted' })
    const d = record({ layout: l, telemetry: tele(3.11), phase: 'halted', problems: problemsFor(l, fw, { U1: halt }), firmware: fw, mcus: { U1: halt } })
    expect(d.lines).toEqual([`整個模擬停在 ${fmtSimClock(3.11)}：U1 被除錯器停住了`, '繼續執行後，整個電路會從這一刻接著跑'])
    expect(d.lines[0]).toBe('整個模擬停在 3.11 s：U1 被除錯器停住了')
  })

  it('a dark LED on a pin the firmware holds low: the measured level, never a guess', () => {
    const l = board()
    const t1 = tele(1)
    t1.components.U1 = { pinVoltages: { PA5: 0 } }
    const e = record({ layout: l, telemetry: t1, phase: 'running', problems: [], firmware: fw, mcus: { U1: frame({}) } })
    expect(e.tier).toBe(TIER.benign)
    expect(e.lines[0]).toBe('LED1 沒亮：U1 PA5 目前輸出低電位')
    // no level read: nothing found, said so
    const unknown = record({ layout: l, telemetry: tele(1), phase: 'running', problems: [], firmware: fw, mcus: { U1: frame({}) } })
    expect(unknown.tier).toBe(TIER.unknown)
    expect(unknown.lines).toEqual(['LED1 沒亮：沒有電流流過', '找不到明確原因；請確認兩支腳都有接進電路'])
  })

  it('a board running its firmware with nothing observed yet: the steady line', () => {
    const l = valid({ version: 1, components: [PS(), BP], wires: RAILS })
    const e = record({ layout: l, telemetry: tele(1), phase: 'running', problems: [], firmware: fw, mcus: { U1: frame({}) } })
    expect(e.tier).toBe(TIER.steady)
    expect(e.lines).toEqual(['U1 正在跑 hal-blink.elf'])
  })
})

describe('explain: phases, the empty board, the phone pill', () => {
  it('paused: the last snapshot with 「（已暫停）」 and the paused dot', () => {
    const r = run(ledCircuit(), 1)
    const e = r.explain({ phase: 'paused' })
    expect(e.lines[0]).toMatch(/^LED1 亮著：亮度 .+（已暫停）$/)
    expect(e.tone).toBe('paused')
    expect(e.key).toBe('5:LED1:lit:paused')
  })

  it('an empty board: one line; the pill never takes it', () => {
    const e = record({ layout: { version: 1, components: [], wires: [] }, telemetry: null, phase: 'idle', problems: [] })
    expect(e.lines).toEqual(['麵包板上還沒有元件。'])
    expect(explainForPill(e, { desktop: false, legacy: false })).toBeNull()
  })

  it('explainForPill: phones only, both lines for the tap', () => {
    const e = run(ledCircuit(), 1).explain()
    expect(explainForPill(e, { desktop: true, legacy: false })).toBeNull()
    expect(explainForPill(e, { desktop: false, legacy: true })).toBeNull()
    expect(explainForPill(null, { desktop: false, legacy: false })).toBeNull()
    expect(explainForPill(e, { desktop: false, legacy: false })).toEqual({ text: e.lines[0], detail: `${e.lines[0]}。${e.lines[1]}` })
  })

  it('English with the workspace: the English sources', () => {
    __setLangForTests('en')
    const r = run(ledCircuit(), 1)
    const e = r.explain()
    expect(e.lines[0]).toMatch(/^LED1 is lit: brightness \d+ % \(\d+\.\d+ mA\)$/)
    expect(e.lines[1]).toBe('Fed from 5.00 V through R1 330 Ω')
  })
})

describe('explain: the history (hysteresis, blinking, periods)', () => {
  const layout = ledCircuit()
  const snap = (time: number, light: number): SimTelemetry => ({
    time,
    netVoltages: {},
    components: { LED1: { pinVoltages: {}, light, current: light * 0.02 } },
    issues: [],
  })

  it('lit at the cheer’s 1 mA, dark again only below 0.6 mA (hysteresis)', () => {
    const h = newExplainHistory()
    observeTelemetry(h, layout, snap(0.1, 0.06))
    expect(h.emitters.get('LED1')!.lit).toBe(true)
    observeTelemetry(h, layout, snap(0.2, 0.04)) // between the thresholds: stays lit
    expect(h.emitters.get('LED1')!.lit).toBe(true)
    expect(h.emitters.get('LED1')!.flips).toEqual([])
    observeTelemetry(h, layout, snap(0.3, 0.02))
    expect(h.emitters.get('LED1')!.lit).toBe(false)
    observeTelemetry(h, layout, snap(0.4, 0.04)) // below the lit threshold: stays dark
    expect(h.emitters.get('LED1')!.lit).toBe(false)
  })

  it('three flips within the window = blinking (on → off → on repeats; one pulse does not); a period only from three flips the sampling can resolve', () => {
    const h = newExplainHistory()
    let time = 0
    const at = (light: number) => observeTelemetry(h, layout, snap((time += 0.1), light))
    at(0.2)
    for (let i = 0; i < 4; i++) at(0.2)
    for (let i = 0; i < 5; i++) at(0)
    const tr = h.emitters.get('LED1')!
    expect(tr.flips).toHaveLength(1)
    expect(isBlinking(tr, time)).toBe(false)
    for (let i = 0; i < 5; i++) at(0.2)
    // dark once, lit again: one pulse, not a blink
    expect(tr.flips).toHaveLength(2)
    expect(isBlinking(tr, time)).toBe(false)
    for (let i = 0; i < 5; i++) at(0)
    expect(isBlinking(tr, time)).toBe(true)
    expect(blinkPeriod(tr, time)).toBeCloseTo(1.0, 5)
    // flips age out of the window: steady again
    for (let i = 0; i < (BLINK_WINDOW_S + 1) * 10; i++) at(0.2)
    expect(isBlinking(tr, time)).toBe(false)
    // a blink faster than the samples can resolve has no period
    const fast = newExplainHistory()
    let t2 = 0
    for (let i = 0; i < 12; i++) observeTelemetry(fast, layout, snap((t2 += 0.1), i % 2 ? 0.2 : 0))
    expect(isBlinking(fast.emitters.get('LED1'), t2)).toBe(true)
    expect(blinkPeriod(fast.emitters.get('LED1'), t2)).toBeNull()
  })

  it('a clock that goes back is a new session', () => {
    const h = newExplainHistory()
    observeTelemetry(h, layout, snap(2, 0.2))
    observeTelemetry(h, layout, snap(2.1, 0))
    expect(h.emitters.get('LED1')!.flips).toHaveLength(1)
    observeTelemetry(h, layout, snap(0.1, 0.2))
    expect(h.emitters.get('LED1')!.flips).toHaveLength(0)
  })
})

describe('the watcher (useExplanation): dwell, damping, staleness, announcements', () => {
  const L = ledCircuit()
  /** LED1's eye-mean reading at simulated `time` (the store's telemetry; PS1 / R1 publish nothing here) */
  const tele = (time: number, light: number, current = light * 0.02, burned = false): SimTelemetry => ({
    time,
    netVoltages: {},
    components: { LED1: { pinVoltages: {}, light, current, ...(burned ? { burned: true } : {}) } },
    issues: [],
  })
  const LIT = (time: number) => tele(time, 0.485, 0.0097)
  /** the host's load frame (worker-host 'load' → postFrame): the circuit before its first solve, every reading 0 */
  const LOAD = (time: number) => tele(time, 0, 0)
  let stop: (() => void) | null = null
  const view = () => useExplainView.getState()
  const push = (t: SimTelemetry) => useStore.setState({ telemetry: t, simTime: t.time })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })
    useLab.setState({ firmware: {}, mcus: {} })
    useStore.setState({ layout: L, telemetry: LIT(0.1), running: true, simTime: 0.1, selection: [] })
    useProblems.setState({ problems: [], layout: L, findings: [] })
  })
  afterEach(() => {
    stop?.()
    stop = null
    vi.useRealTimers()
    useStore.setState({ running: false, simTime: 0, telemetry: null, selection: [] })
  })

  it('dwell: a new subject replaces the shown one only after holding 1 s (a one-refresh blip never shows); damage at once', () => {
    stop = startExplainWatcher()
    expect(view().explanation?.key).toBe('5:LED1:lit')
    expect(view().announce).toBe('LED1 亮著：亮度 49 %（9.70 mA）')
    // dark for one refresh (simulated seconds apart: one flip each, never a blink)
    vi.advanceTimersByTime(600)
    push(tele(5, 0))
    expect(view().explanation?.key).toBe('5:LED1:lit')
    vi.advanceTimersByTime(100)
    push(LIT(10))
    vi.advanceTimersByTime(3000)
    expect(view().explanation?.key).toBe('5:LED1:lit')
    // dark for good: shown once it held the dwell
    push(tele(15, 0))
    vi.advanceTimersByTime(EXPLAIN_DWELL_MS - 100)
    expect(view().explanation?.key).toBe('5:LED1:lit')
    vi.advanceTimersByTime(200)
    expect(view().explanation?.key).toBe('7:LED1:unknown')
    expect(view().announce).toBe('LED1 沒亮：沒有電流流過')
    // damage (P1) needs no dwell: the next refresh shows it
    vi.advanceTimersByTime(600)
    push(tele(20, 0, 0, true))
    expect(view().explanation?.key).toBe('1:LED1:burned')
  })

  it('announcements: subject / state changes only, at most one per 2 s', () => {
    stop = startExplainWatcher()
    const first = view().announce
    expect(first).toBe('LED1 亮著：亮度 49 %（9.70 mA）')
    // a burn 100 ms later: shown at once, announced only when the 2 s gap is over
    vi.advanceTimersByTime(600)
    push(tele(5, 0, 0, true))
    expect(view().explanation?.key).toBe('1:LED1:burned')
    expect(view().announce).toBe(first)
    vi.advanceTimersByTime(EXPLAIN_ANNOUNCE_MS)
    expect(view().announce).toMatch(/^LED1 燒毀/)
  })

  it('damping: a number that differs for one refresh never shows; one that stays shows on the second', () => {
    stop = startExplainWatcher()
    const shown = () => view().explanation?.lines[0]
    expect(shown()).toBe('LED1 亮著：亮度 49 %（9.70 mA）')
    vi.advanceTimersByTime(600)
    push(tele(0.2, 0.4855, 0.00971))
    expect(shown()).toBe('LED1 亮著：亮度 49 %（9.70 mA）')
    vi.advanceTimersByTime(100)
    push(LIT(0.3))
    vi.advanceTimersByTime(2000)
    expect(shown()).toBe('LED1 亮著：亮度 49 %（9.70 mA）')
    // a steady new value: the second refresh shows it
    push(tele(0.4, 0.49, 0.0098))
    expect(shown()).toBe('LED1 亮著：亮度 49 %（9.70 mA）')
    vi.advanceTimersByTime(EXPLAIN_REFRESH_MS)
    expect(shown()).toBe('LED1 亮著：亮度 49 %（9.80 mA）')
  })

  it('staleness: after a structural edit the old lines stay dimmed until the new circuit’s list and readings arrive', () => {
    stop = startExplainWatcher()
    const before = view().explanation
    const L2: CircuitLayout = { ...L, components: [...L.components, res('R2', ['a30', 'a34'], 1000)] }
    useStore.setState({ layout: L2 })
    expect(view().stale).toBe(true)
    expect(view().explanation).toBe(before)
    // the list for the new circuit alone is not enough: the readings are still the old revision's
    vi.advanceTimersByTime(300)
    useProblems.setState({ problems: [], layout: L2, findings: [] })
    expect(view().stale).toBe(true)
    vi.advanceTimersByTime(100)
    // the host's load frame: the new circuit before its first solve (all zeros) — no readings yet (persona fix)
    push(LOAD(0.5))
    vi.advanceTimersByTime(EXPLAIN_REFRESH_MS)
    expect(view().stale).toBe(true)
    expect(view().explanation).toBe(before)
    push(LIT(0.6))
    vi.advanceTimersByTime(EXPLAIN_REFRESH_MS)
    expect(view().stale).toBe(false)
    expect(view().explanation?.key).toBe('5:LED1:lit')
  })

  it('staleness: nothing new within 1.5 s → the new circuit’s static words (never the old readings); a knob is no edit', () => {
    stop = startExplainWatcher()
    const L2: CircuitLayout = { ...L, components: [...L.components, res('R2', ['a30', 'a34'], 1000)] }
    useStore.setState({ layout: L2 })
    vi.advanceTimersByTime(EXPLAIN_STALE_MS - 100)
    expect(view().stale).toBe(true)
    vi.advanceTimersByTime(200)
    expect(view().stale).toBe(false)
    expect(view().explanation?.lines).toEqual(['電路模擬中'])
    // a runtime param (the supply's voltage knob) keeps the session's words: no staleness
    useStore.setState({ layout: L2 })
    useProblems.setState({ problems: [], layout: L2, findings: [] })
    push(LOAD(0.5))
    push(LIT(0.6))
    vi.advanceTimersByTime(EXPLAIN_REFRESH_MS)
    expect(view().explanation?.key).toBe('5:LED1:lit')
    const knob: CircuitLayout = { ...L2, components: L2.components.map((c) => (c.id === 'PS1' ? { ...c, params: { voltage: 6 } } : c)) }
    useStore.setState({ layout: knob })
    expect(view().stale).toBe(false)
    expect(view().explanation?.key).toBe('5:LED1:lit')
  })
})

describe('explain: what the learner just did is never mistaken for the circuit (round 5 verify)', () => {
  const swLayout = valid({
    version: 1,
    components: [PS(), { id: 'SW1', type: 'pushbutton', at: 'f10' }, res('R1', ['h12', 'h20'], 330), led('LED1', ['i20', 'top-22'])],
    wires: [...RAILS, { id: 'W3', from: 'top+5', to: 'j10' }],
  })
  const withParam = (l: CircuitLayout, id: string, key: string, value: number | boolean | string): CircuitLayout => ({
    ...l,
    components: l.components.map((c) => (c.id === id ? { ...c, params: { ...c.params, [key]: value } } : c)),
  })

  it('one press and release of a button is never 「在閃」 — before, during or after (its flips are the action’s effect)', () => {
    const pressed = withParam(swLayout, 'SW1', 'pressed', true)
    const engine = new SimEngine(swLayout)
    const history = newExplainHistory()
    let layout = swLayout
    const keys: string[] = []
    for (let i = 0; i < 60; i++) {
      if (i === 10 || i === 15) {
        // the store's setParam: a new layout of the same circuit; the watcher notes the action
        layout = i === 10 ? pressed : swLayout
        engine.setRuntimeParam('SW1', 'pressed', i === 10)
        noteUserAction(history)
      }
      engine.advance(0.1, 1e-3)
      const tele = engine.telemetry()
      observeTelemetry(history, layout, tele)
      const findings = runErc(layout, { telemetry: tele, issues: tele.issues })
      const problems = deriveProblems({ layout, findings, issues: tele.issues, firmware: {}, mcus: {}, running: true, simTime: tele.time })
      keys.push(record({ layout, telemetry: tele, phase: 'running', problems, findings, history }).key)
    }
    expect(keys.filter((k) => k.includes('blink'))).toEqual([])
    expect(keys.slice(11, 15).every((k) => k === '5:LED1:lit')).toBe(true)
    expect(keys.at(-1)).toBe('6:LED1:open:SW1')
  })

  it('even without the action noted, one pulse (on → off) is no blink: blinking needs three flips', () => {
    const h = newExplainHistory()
    const snap = (time: number, light: number): SimTelemetry => ({ time, netVoltages: {}, components: { LED1: { pinVoltages: {}, light, current: light * 0.02 } }, issues: [] })
    const L = ledCircuit()
    let time = 0
    for (const light of [0, 0, 0.5, 0.5, 0.5, 0, 0, 0, 0, 0]) observeTelemetry(h, L, snap((time += 0.1), light))
    expect(isBlinking(h.emitters.get('LED1'), time)).toBe(false)
  })

  it('a burn and a 換新 (repairParts) are no blink', () => {
    const l = ledCircuit(10)
    const engine = new SimEngine(l)
    const history = newExplainHistory()
    const lines: string[] = []
    for (let i = 0; i < 40; i++) {
      // 換新 every second: the fault is still there, so the new LED burns again
      if (i > 0 && i % 10 === 0) engine.repairParts(null)
      engine.advance(0.1, 1e-3)
      const tele = engine.telemetry()
      observeTelemetry(history, l, tele)
      const findings = runErc(l, { telemetry: tele, issues: tele.issues })
      const problems = deriveProblems({ layout: l, findings, issues: tele.issues, firmware: {}, mcus: {}, running: true, simTime: tele.time })
      lines.push(record({ layout: l, telemetry: tele, phase: 'running', problems, findings, history }).lines[0])
    }
    expect(lines.filter((x) => /在閃/.test(x))).toEqual([])
    expect(lines.some((x) => /^LED1 燒毀/.test(x))).toBe(true)
  })

  it('a knob on a blinker keeps 「在閃」 (no 亮著 / 沒亮 flash between blinks); a blinker the change stopped is steady again', () => {
    const h = newExplainHistory()
    const L = ledCircuit()
    const snap = (time: number, light: number): SimTelemetry => ({ time, netVoltages: {}, components: { LED1: { pinVoltages: {}, light, current: light * 0.02 } }, issues: [] })
    let time = 0
    let i = 0
    const blinkStep = () => observeTelemetry(h, L, snap((time += 0.1), Math.floor(i++ / 3) % 2 ? 0.4 : 0))
    for (let k = 0; k < 30; k++) blinkStep()
    expect(isBlinking(h.emitters.get('LED1'), time)).toBe(true)
    // the learner turns a knob on the blinker every 200 ms for 2 s: it keeps blinking, and says so all along
    for (let k = 0; k < 20; k++) {
      if (k % 2 === 0) noteUserAction(h)
      blinkStep()
      expect(isBlinking(h.emitters.get('LED1'), time)).toBe(true)
    }
    // a change that stops it (steady on): blinking lapses within the carried gap, then it is simply lit
    noteUserAction(h)
    for (let k = 0; k < 15; k++) observeTelemetry(h, L, snap((time += 0.1), 0.4))
    expect(isBlinking(h.emitters.get('LED1'), time)).toBe(false)
    expect(h.emitters.get('LED1')!.lit).toBe(true)
  })
})

describe('explain: honest words for dim, switched and limited LEDs (round 5 verify)', () => {
  it('a dim LED (4.7 kΩ, below the cheer’s 1 mA) glows faintly — the inspector’s own value — never 「沒有電流」', () => {
    const r = run(ledCircuit(4700), 1)
    const t = r.tele.components.LED1
    expect(t.light).toBeLessThan(0.05)
    const e = r.explain()
    expect(e.tier).toBe(TIER.benign)
    expect(e.tone).toBe('info')
    expect(e.lines[0]).toBe(`LED1 很暗：亮度 ${ledLightParts(t.light, t.current).value}`)
    expect(e.lines[1]).toBe('由 5.00 V 經 R1 4.7 kΩ 供電')
    expect(e.lines.join('')).not.toMatch(/沒有電流/)
  })

  it('no cause found: the measured current as it is (「電流只有 45.0 nA」), never 「沒有電流（…）」', () => {
    const l = ledCircuit()
    const tele: SimTelemetry = { time: 1, netVoltages: {}, components: { LED1: { pinVoltages: {}, light: 0, current: 45e-9 } }, issues: [] }
    const e = record({ layout: l, telemetry: tele, phase: 'running', problems: [] })
    expect(e.tier).toBe(TIER.unknown)
    expect(e.lines).toEqual([`LED1 沒亮：電流只有 ${fmtCurrent(45e-9)}`, '找不到明確原因；請確認兩支腳都有接進電路'])
  })

  it('the NPN switch example: 「Q1 沒有導通」 and what turns it on — not a wiring fault; pressed, the path names Q1', () => {
    const j = JSON.parse(readFileSync(path.join(ROOT, 'examples/embedded/npn-switch.ohmlet.json'), 'utf8'))
    const l: CircuitLayout = j.layout
    const off = run(l, 1).explain()
    expect(off.tier).toBe(TIER.benign)
    expect(off.lines).toEqual(['LED1 沒亮：Q1 沒有導通', '按住 SW1，Q1 就會導通'])
    expect(off.subjectIds).toEqual(['LED1', 'Q1', 'SW1'])
    const on = run({ ...l, components: l.components.map((c) => (c.id === 'SW1' ? { ...c, params: { ...c.params, pressed: true } } : c)) }, 1).explain()
    expect(on.lines[0]).toMatch(/^LED1 亮著：亮度/)
    expect(on.lines[1]).toBe('由 5.00 V 經 R3 330 Ω、Q1 供電')
  })

  it('an LDR as the only limit: 「由 5.00 V 經 LDR1 供電」, never 「直接由」', () => {
    const l = valid({
      version: 1,
      components: [PS(), { id: 'LDR1', type: 'photoresistor', holes: ['top+10', 'a10'], params: { light: 0.9 } }, led('LED1', ['b10', 'top-14'])],
      wires: RAILS,
    })
    const e = run(l, 1).explain()
    expect(e.lines[0]).toMatch(/^LED1 亮著/)
    expect(e.lines[1]).toBe('由 5.00 V 經 LDR1 供電')
  })

  it('a path the rule check cannot see (the b6 MOSFET with a voltmeter across it) is not named — never 「經 DMM1」', () => {
    const lesson = LESSONS.find((x) => x.id === 'b6-mosfet-led')!
    const e = run(lesson.solution.layout, 1).explain()
    expect(e.lines[0]).toMatch(/^LED1 亮著/)
    expect(e.lines.join(' ')).not.toMatch(/DMM1/)
  })

  it('a resistor above its power rating: P4 in its measured watts — after an LED’s own risk', () => {
    const hot = valid({ version: 1, components: [PS(), res('R1', ['top+3', 'top-4'], 10)], wires: RAILS })
    const r = run(hot, 1)
    const e = r.explain()
    expect(e.tier).toBe(TIER.risk)
    expect(e.lines).toEqual([`R1 發燙：功率 ${fmtPower(Math.abs(r.tele.components.R1.power!))} 超過額定 250 mW`, '改用阻值大一點或瓦數高一點的電阻'])
    // 12 V through 330 Ω: the LED over its rating leads, the resistor's heat is the pill's
    const both = run(valid({ version: 1, components: [PS(12), res('R1', ['top+3', 'a10'], 330), led('LED1', ['b10', 'top-4'])], wires: RAILS }), 2).explain()
    expect(both.lines[0]).toMatch(/^LED1 亮著，但超過額定 20 mA/)
  })

  it('a rail no supply feeds: said as a rail, the fix joins it to a fed one — no raw 「bot+3」', () => {
    const l = valid({ version: 1, components: [PS(), res('R1', ['bot+3', 'a10'], 330), led('LED1', ['b10', 'top-4'])], wires: RAILS })
    const e = run(l, 1).explain()
    expect(e.lines[0]).toBe('LED1 不亮：R1 第 1 腳接的電源軌沒有電')
    expect(e.lines[1]).toMatch(/^用導線把下方 \+ 電源軌 第 3 孔接到上方 \+ 電源軌 第 \d+ 孔$/)
    expect(e.lines.join(' ')).not.toMatch(/\b(?:bot|top)[+-]\d/)
  })

  it('an LED not wired at all (the beginner lessons’ start): line 2 is the fix, not the cause again', () => {
    const lesson = LESSONS.find((x) => x.id === 'b1-led-resistor')!
    const e = run(lesson.start.layout, 1).explain()
    expect(e.lines).toEqual(['LED1 不亮：兩支腳都還沒接進電路', '用導線把 LED1 的兩支腳接進電路'])
  })

  it('the supply in plain words: 「供給電路 …」, 「目前幾乎沒有電流流出」', () => {
    const l = valid({ version: 1, components: [PS(), res('R1', ['top+3', 'top-4'], 1000)], wires: RAILS })
    const r = run(l, 0.5)
    expect(r.explain().lines).toEqual([`PS1 輸出 5.00 V，供給電路 ${fmtCurrent(Math.abs(r.tele.components.PS1.current!))}`])
    const open = valid({ version: 1, components: [PS(), res('R1', ['top+3', 'a40'], 1000)], wires: RAILS })
    expect(run(open, 0.5).explain({ problems: [] }).lines).toEqual(['PS1 輸出 5.00 V，目前幾乎沒有電流流出'])
  })

  it('serial data only while it keeps coming (a greeting at boot is not 「正在送出」 a minute later)', () => {
    const l = valid({ version: 1, components: [PS(), BP], wires: RAILS })
    const fw = { U1: { componentId: 'U1', name: 'uart-hello.elf', format: 'elf' as const, sha256: 'x', size: 1, loadedAt: 0, warnings: [] } }
    const mcus = { U1: { componentId: 'U1', state: 'running' as const, firmware: 'uart-hello.elf', pc: 0x08000100, hclkHz: 8e6, cycles: 1, realtime: 1, uarts: [] } }
    const h = newExplainHistory()
    const at = (time: number) => {
      const tele: SimTelemetry = { time, netVoltages: {}, components: { U1: { pinVoltages: {} } }, issues: [] }
      observeTelemetry(h, l, tele)
      return record({ layout: l, telemetry: tele, phase: 'running', problems: [], firmware: fw, mcus, history: h })
    }
    noteUart(h, 'U1', 0.9)
    expect(at(1).lines[0]).toBe('U1 正在送出序列資料')
    expect(at(5).lines[0]).toBe('U1 正在跑 uart-hello.elf')
  })

  it('a subject whose line 1 would repeat a Problems title never leads (line 1 is checked too)', () => {
    const r = run(ledCircuit(), 1)
    const fake: Problem = { id: 'x', level: 'warning', source: 'erc', title: 'LED1 亮著', detail: '—', componentIds: [], holes: [] }
    const e = r.explain({ problems: [...r.problems, fake] })
    expect(e.lines.some((x) => x.includes('LED1 亮著'))).toBe(false)
  })
})

describe('the watcher: what the learner just did shows at once, and only once its readings are in (round 5 verify)', () => {
  const swLayout = valid({
    version: 1,
    components: [PS(), { id: 'SW1', type: 'pushbutton', at: 'f10' }, res('R1', ['h12', 'h20'], 330), led('LED1', ['i20', 'top-22'])],
    wires: [...RAILS, { id: 'W3', from: 'top+5', to: 'j10' }],
  })
  const pressed: CircuitLayout = { ...swLayout, components: swLayout.components.map((c) => (c.id === 'SW1' ? { ...c, params: { pressed: true } } : c)) }
  const ledTele = (time: number, light: number, extra: Partial<SimTelemetry['components'][string]> = {}): SimTelemetry => ({
    time,
    netVoltages: {},
    components: { LED1: { pinVoltages: {}, light, current: light * 0.02, ...extra } },
    issues: [],
  })
  let stop: (() => void) | null = null
  const view = () => useExplainView.getState()
  const push = (t: SimTelemetry) => useStore.setState({ telemetry: t, simTime: t.time })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })
    useLab.setState({ firmware: {}, mcus: {} })
    const findings = runErc(swLayout)
    useStore.setState({ layout: swLayout, telemetry: ledTele(1, 0), running: true, simTime: 1, selection: [] })
    useProblems.setState({ problems: deriveProblems({ layout: swLayout, findings, issues: [], firmware: {}, mcus: {}, running: true, simTime: 1 }), layout: swLayout, findings })
  })
  afterEach(() => {
    stop?.()
    stop = null
    vi.useRealTimers()
    useStore.setState({ running: false, simTime: 0, telemetry: null, selection: [] })
  })

  it('a button press: the old line stays (never 「沒有電流」) until readings after it arrive, then 「亮著」 at once; the release likewise', () => {
    stop = startExplainWatcher()
    const seen: string[] = [view().explanation!.lines[0]]
    expect(seen[0]).toBe('LED1 沒亮：SW1 沒按下，電路斷開')
    vi.advanceTimersByTime(1000)
    let time = 1
    useStore.setState({ layout: pressed })
    seen.push(view().explanation!.lines[0])
    // the first push may still be the world before the press (in flight)
    vi.advanceTimersByTime(100)
    push(ledTele((time += 0.1), 0))
    seen.push(view().explanation!.lines[0])
    vi.advanceTimersByTime(100)
    push(ledTele((time += 0.1), 0.485))
    expect(view().explanation!.key).toBe('5:LED1:lit') // 200 ms after the press, no dwell
    for (let k = 0; k < 10; k++) {
      vi.advanceTimersByTime(100)
      push(ledTele((time += 0.1), 0.485))
      seen.push(view().explanation!.lines[0])
    }
    useStore.setState({ layout: swLayout })
    for (let k = 0; k < 3; k++) {
      vi.advanceTimersByTime(100)
      push(ledTele((time += 0.1), 0))
    }
    expect(view().explanation!.key).toBe('6:LED1:open:SW1')
    expect(seen.filter((x) => /沒有電流|找不到/.test(x))).toEqual([])
  })

  it('a knob drag (a new layout every frame) updates the card about twice a second — no recompute per event', () => {
    const L = ledCircuit()
    useStore.setState({ layout: L, telemetry: ledTele(1, 0.485) })
    useProblems.setState({ problems: [], layout: L, findings: [] })
    stop = startExplainWatcher()
    vi.advanceTimersByTime(2000)
    let updates = 0
    const off = useExplainView.subscribe((s, prev) => {
      if (s.explanation !== prev.explanation) updates++
    })
    let time = 1
    let v = 5
    for (let ms = 0; ms < 2000; ms += 16) {
      v += 0.01
      useStore.setState({ layout: { ...L, components: L.components.map((c) => (c.id === 'PS1' ? { ...c, params: { voltage: v } } : c)) } })
      vi.advanceTimersByTime(16)
      if (ms % 96 === 0) push(ledTele((time += 0.1), 0.3 + ms / 10000))
    }
    off()
    expect(updates).toBeGreaterThan(0)
    expect(updates).toBeLessThanOrEqual(7)
    expect(view().stale).toBe(false)
  })

  it('a firmware load, then a knob: the knob is no edit (the revision follows the firmware) — the card is not dimmed', () => {
    const L = valid({ version: 1, components: [PS(), BP], wires: RAILS })
    useStore.setState({ layout: L, telemetry: ledTele(1, 0.485) })
    useProblems.setState({ problems: [], layout: L, findings: [] })
    stop = startExplainWatcher()
    useLab.setState({ firmware: { U1: { componentId: 'U1', name: 'x.elf', format: 'elf', sha256: 'abc', size: 1, loadedAt: 0, warnings: [] } } as never })
    vi.advanceTimersByTime(300)
    useProblems.setState({ problems: [], layout: L, findings: [] })
    push(ledTele(1.05, 0)) // the host's load frame after the firmware load (unsolved)
    push(ledTele(1.1, 0.485))
    vi.advanceTimersByTime(EXPLAIN_REFRESH_MS)
    expect(view().stale).toBe(false)
    useStore.setState({ layout: { ...L, components: L.components.map((c) => (c.id === 'PS1' ? { ...c, params: { voltage: 6 } } : c)) } })
    expect(view().stale).toBe(false)
  })

  it('a placeholder (「電路模擬中」) is replaced by the first real line at once — no dwell', () => {
    const L = ledCircuit()
    useStore.setState({ layout: L, telemetry: null })
    useProblems.setState({ problems: [], layout: L, findings: [] })
    stop = startExplainWatcher()
    expect(view().explanation!.lines).toEqual(['電路模擬中'])
    vi.advanceTimersByTime(600)
    push(ledTele(0, 0)) // the session's load frame at t = 0 (before its first solve)
    push(ledTele(0.1, 0.485))
    vi.advanceTimersByTime(EXPLAIN_REFRESH_MS)
    expect(view().explanation!.key).toBe('5:LED1:lit')
  })

  it('a replaced part (換新: P1 → lit) shows at once — no dwell', () => {
    const L = ledCircuit()
    useStore.setState({ layout: L, telemetry: ledTele(1, 0, { burned: true }) })
    useProblems.setState({ problems: [], layout: L, findings: [] })
    stop = startExplainWatcher()
    expect(view().explanation!.key).toBe('1:LED1:burned')
    vi.advanceTimersByTime(600)
    push(ledTele(1.1, 0.485))
    expect(view().explanation!.key).toBe('5:LED1:lit')
  })
})

describe('explain: a fade is no blink — what the blinking looks like (round 5 final)', () => {
  type Fw = Record<string, { componentId: string; name: string; format: 'elf' | 'bin' | 'hex'; sha256: string; size: number; loadedAt: number; warnings: string[] }>
  /** An embedded example with its REAL firmware (the coordinator), observed every `step` simulated s like the store's pushes. */
  function runExample(id: string, seconds: number, step = 0.1, each?: (r: Run, k: number) => void): Run {
    const res = parseProject(readFileSync(path.join(ROOT, 'examples/embedded', `${id}.ohmlet.json`), 'utf8'))
    if (!res.ok) throw new Error(res.errors.join('; '))
    const layout = res.project.layout
    const co = new SimulationCoordinator()
    co.load(layout, 1)
    const firmware: Fw = {}
    for (const f of res.project.firmware) {
      const img = loadFirmwareFile(f.name, f.bytes)
      if (!img.ok) throw new Error(img.error)
      co.setFirmware(f.componentId, img.image)
      firmware[f.componentId] = { componentId: f.componentId, name: f.name, format: f.format as 'elf', sha256: f.sha256, size: f.size, loadedAt: 0, warnings: [] }
    }
    const history = newExplainHistory()
    const at = (): Run => {
      const frame = co.frame()
      const tele = frame.telemetry
      const mcus = Object.fromEntries(frame.mcus.map((m) => [m.componentId, m]))
      const findings = runErc(layout, { telemetry: tele, issues: tele.issues })
      const problems = deriveProblems({ layout, findings, issues: tele.issues, firmware, mcus, running: true, simTime: tele.time })
      return {
        tele,
        findings,
        problems,
        history,
        explain: (over = {}) => record({ layout, telemetry: tele, phase: 'running', problems, findings, history, mcus, firmware, ...over }),
      }
    }
    for (let k = 0; k < Math.round(seconds / step); k++) {
      co.advance(step)
      observeTelemetry(history, layout, co.frame().telemetry)
      if (each) each(at(), k)
    }
    return at()
  }

  it('pwm-fade (its real firmware): 「LED1 漸亮漸暗，週期約 2.00 s：最亮 …」 on every 2 Hz refresh once it repeats — never 「在閃」', () => {
    const lines: string[] = []
    const keys: string[] = []
    let brightest = 0
    const r = runExample('pwm-fade', 6, 0.1, (snap, k) => {
      const c = snap.tele.components.LED1
      if (typeof c?.current === 'number' && (c.light ?? 0) >= 0.05) brightest = Math.max(brightest, Math.abs(c.current))
      if ((k + 1) % 5 === 0) {
        const e = snap.explain()
        lines.push(e.lines[0])
        if (snap.tele.time >= 3) keys.push(e.key)
      }
    })
    // the LED really breathes through many levels: a PWM average (平均), never a two-level blink
    const tr = r.history.emitters.get('LED1')
    expect(isBlinking(tr, r.tele.time)).toBe(true)
    expect(blinkShape(tr)).toBe('fade')
    expect(lines.filter((x) => /在閃/.test(x))).toEqual([])
    expect(new Set(keys)).toEqual(new Set(['5:LED1:fade']))
    const e = r.explain()
    const period = blinkPeriod(tr, r.tele.time)!
    expect(period).toBeGreaterThan(1.8)
    expect(period).toBeLessThan(2.2)
    expect(e.lines[0]).toBe(`LED1 漸亮漸暗，週期約 ${fmtPeriod(period)}：最亮 ${fmtCurrent(brightest)}`)
    expect(e.lines[1]).toMatch(/^由 U1 PA6 經 R1 330 Ω 驅動$/)
    // a lesson step whose answer is a frequency / duty: no period, and no brightest current (a PWM average follows the duty)
    expect(r.explain({ secrets: { current: [], nets: [], timing: true } }).lines[0]).toBe('LED1 漸亮漸暗')
    // … whose answer is LED1's current: the period, no current
    expect(r.explain({ secrets: { current: ['LED1'], nets: [], timing: false } }).lines[0]).toBe(`LED1 漸亮漸暗，週期約 ${fmtPeriod(period)}`)
    // English (the product chrome's other language)
    __setLangForTests('en')
    expect(r.explain().lines[0]).toBe(`LED1 fades up and down about every ${fmtPeriod(period)}: ${fmtCurrent(brightest)} at its brightest`)
  }, 60_000)

  it('pwm-fade sampled finely (¼ speed: a snapshot every 25 ms of simulated time) is still 漸亮漸暗 — 最亮 is the peak of the window, not of its last few samples', () => {
    const lit: { t: number; i: number }[] = []
    // 3.8 s: the last peak (3.0 s) is 0.8 s back — more than two dozen dense samples ago
    const r = runExample('pwm-fade', 3.8, 0.025, (snap) => {
      const c = snap.tele.components.LED1
      if (typeof c?.current === 'number' && (c.light ?? 0) >= 0.05) lit.push({ t: snap.tele.time, i: Math.abs(c.current) })
    })
    expect(blinkShape(r.history.emitters.get('LED1'))).toBe('fade')
    const peak = Math.max(...lit.filter((x) => r.tele.time - x.t <= BLINK_WINDOW_S).map((x) => x.i))
    expect(r.explain().lines[0]).toMatch(new RegExp(`^LED1 漸亮漸暗，週期約 \\d+(\\.\\d+)? m?s：最亮 ${fmtCurrent(peak)}$`))
  }, 60_000)

  it('the blink example (its real firmware): a two-level blink stays 「在閃，約每 1.00 s 一次：亮時 …」; PC13 blinks the same way', () => {
    const r = runExample('blink', 4)
    const tr = r.history.emitters.get('LED1')
    expect(blinkShape(tr)).toBe('blink')
    expect(blinkShape(r.history.emitters.get('U1/LED_PC13'))).toBe('blink')
    const e = r.explain()
    expect(e.key).toBe('5:LED1:blink')
    expect(e.lines[0]).toMatch(/^LED1 在閃，約每 (1|1\.\d+) s 一次：亮時 \d\.\d+ mA$/)
    // a duty / frequency step: no period; a GPIO blink's on-current is no PWM average, so it stays
    expect(r.explain({ secrets: { current: [], nets: [], timing: true } }).lines[0]).toMatch(/^LED1 在閃：亮時 \d\.\d+ mA$/)
  }, 60_000)

  /** FG1 (any waveform) → R1 330 Ω → LED1 → ground (PS1's − rail), no board, no firmware. */
  const fgLed = (params: Record<string, string | number>): CircuitLayout =>
    valid({
      version: 1,
      components: [PS(), { id: 'FG1', type: 'function_generator', params }, res('R1', ['a10', 'a14'], 330), led('LED1', ['b14', 'top-2'])],
      wires: [...RAILS, { id: 'W3', from: 'FG1:out', to: 'e10' }, { id: 'W4', from: 'FG1:gnd', to: 'top-1' }],
    })

  it('a slow analog triangle (no PWM): 漸亮漸暗 with its period; a 1 Hz square: 在閃; a 100 Hz square: 亮著（PWM）, no period at all', () => {
    const tri = run(fgLed({ waveform: 'triangle', frequency: 0.5, amplitude: 1.6, offset: 3.4 }), 6)
    expect(blinkShape(tri.history.emitters.get('LED1'))).toBe('fade')
    expect(tri.explain().lines[0]).toMatch(/^LED1 漸亮漸暗，週期約 \d+(\.\d+)? m?s：最亮 \d\.\d+ mA$/)
    const sq = run(fgLed({ waveform: 'square', frequency: 1, amplitude: 2.5, offset: 2.5 }), 4)
    expect(sq.explain().lines[0]).toMatch(/^LED1 在閃，約每 \d+(\.\d+)? m?s 一次：亮時 \d\.\d+ mA$/)
    const pwm = run(fgLed({ waveform: 'square', frequency: 100, amplitude: 2.5, offset: 2.5 }), 2)
    const t = pwm.tele.components.LED1
    expect(isBlinking(pwm.history.emitters.get('LED1'), pwm.tele.time)).toBe(false)
    expect(pwm.explain().lines[0]).toBe(`LED1 亮著（PWM）：亮度 ${ledLightParts(t.light, t.current, { average: true }).value}`)
  })

  it('shapeOf: two levels with step edges = blink; a glide through many levels = fade; one more level, a sawtooth, too few samples = not told', () => {
    const L = (xs: number[]) => xs.map((l) => ({ l }))
    const cycle = (n: number, f: (x: number) => number) => Array.from({ length: n }, (_, k) => f(k / n))
    const square = [...cycle(10, (x) => (x < 0.5 ? 0.2 : 0)), ...cycle(10, (x) => (x < 0.5 ? 0.2 : 0))]
    const triangle = [...cycle(20, (x) => 0.2 * (1 - Math.abs(2 * x - 1))), ...cycle(20, (x) => 0.2 * (1 - Math.abs(2 * x - 1)))]
    const sine = cycle(24, (x) => 0.1 + 0.1 * Math.sin(2 * Math.PI * x))
    expect(shapeOf(L(square))).toBe('blink')
    // a sample on an edge (the 20 ms eye window) does not make a blink a fade
    expect(shapeOf(L([...square.slice(0, 5), 0.1, ...square.slice(5)]))).toBe('blink')
    expect(shapeOf(L(triangle))).toBe('fade')
    expect(shapeOf(L(sine))).toBe('fade')
    // dark → half → full → dark: a stepped blink is no breathing, nor a plain two-level blink
    expect(shapeOf(L([...cycle(12, (x) => (x < 1 / 3 ? 0 : x < 2 / 3 ? 0.1 : 0.2)), ...cycle(12, (x) => (x < 1 / 3 ? 0 : x < 2 / 3 ? 0.1 : 0.2))]))).toBeNull()
    // ramp up, then off at once: not 漸亮漸暗
    expect(shapeOf(L([...cycle(10, (x) => 0.2 * x), ...cycle(10, (x) => 0.2 * x)]))).toBeNull()
    expect(shapeOf(L(square.slice(0, 7)))).toBeNull()
    // no real swing
    expect(shapeOf(L(cycle(20, () => 0.1)))).toBeNull()
  })

  const snapOf = (time: number, lights: Record<string, number>): SimTelemetry => ({
    time,
    netVoltages: {},
    components: Object.fromEntries(Object.entries(lights).map(([id, light]) => [id, { pinVoltages: {}, light, current: light * 0.02 }])),
    issues: [],
  })

  it('a blink whose shape is not told says the neutral 「一明一暗…：最亮 …」; two fading LEDs aggregate as 「另外 LED2 也漸亮漸暗」', () => {
    const one = ledCircuit()
    const h = newExplainHistory()
    let time = 0
    // dark → a quarter → half, then dark again: it repeats, but is neither two levels nor a glide
    for (let k = 0; k < 40; k++) observeTelemetry(h, one, snapOf((time += 0.1), { LED1: [0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25, 0.5, 0.5, 0.5, 0.5][k % 12] }))
    const tr = h.emitters.get('LED1')
    expect(isBlinking(tr, time)).toBe(true)
    expect(blinkShape(tr)).toBeNull()
    // synthetic readings carry no net voltages (the path names the ERC's nominal 5.00 V): not for the property checks
    const e = explainCircuit({ layout: one, telemetry: snapOf(time, { LED1: 0.5 }), phase: 'running', problems: [], history: h })
    expect(e.key).toBe('5:LED1:pulse')
    expect(e.lines[0]).toBe(`LED1 一明一暗，週期約 ${fmtPeriod(blinkPeriod(tr, time)!)}：最亮 ${fmtCurrent(0.01)}`)
    // two LEDs breathing
    const two = valid({
      version: 1,
      components: [PS(), res('R1', ['top+3', 'a10'], 330), led('LED1', ['b10', 'top-4']), res('R2', ['top+8', 'a16'], 330), led('LED2', ['b16', 'top-9'], 'green')],
      wires: RAILS,
    })
    const h2 = newExplainHistory()
    let t2 = 0
    const tri = (k: number) => 0.2 * (1 - Math.abs(((k % 20) / 10) - 1))
    for (let k = 0; k < 50; k++) observeTelemetry(h2, two, snapOf((t2 += 0.1), { LED1: tri(k), LED2: tri(k + 5) }))
    const e2 = explainCircuit({ layout: two, telemetry: snapOf(t2, { LED1: tri(49), LED2: tri(54) }), phase: 'running', problems: [], history: h2 })
    expect(e2.lines[0]).toMatch(/^LED1 漸亮漸暗，週期約 \d+(\.\d+)? m?s：最亮 \d\.\d+ mA$/)
    expect(e2.lines[1]).toBe('另外 LED2 也漸亮漸暗')
  })

  it('a board’s on-board LED: 「在閃」 on / off, 「漸亮漸暗」 when it glides', () => {
    const l = valid({ version: 1, components: [PS(), BP], wires: RAILS })
    const words = (light: (k: number) => number): string => {
      const h = newExplainHistory()
      let time = 0
      const snap = (k: number): SimTelemetry => ({ time, netVoltages: {}, components: { U1: { pinVoltages: {}, sub: { LED_PC13: { pinVoltages: {}, light: light(k), current: light(k) * 0.02 } } } }, issues: [] })
      for (let k = 0; k < 40; k++) {
        time += 0.1
        observeTelemetry(h, l, snap(k))
      }
      return record({ layout: l, telemetry: snap(39), phase: 'running', problems: [], history: h }).lines[0]
    }
    expect(words((k) => (Math.floor(k / 5) % 2 ? 0 : 0.1))).toBe('U1 的板載 LED（PC13）在閃')
    expect(words((k) => 0.1 * (1 - Math.abs(((k % 20) / 10) - 1)))).toBe('U1 的板載 LED（PC13）漸亮漸暗')
  })

  /** FG1 straight across buzzer BZ1 (p1 → the − rail). */
  const fgBuzzer = (frequency: number): CircuitLayout =>
    valid({
      version: 1,
      components: [PS(), { id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency, amplitude: 2.5, offset: 2.5 } }, { id: 'BZ1', type: 'buzzer', holes: ['b20', 'top-21'] }],
      wires: [...RAILS, { id: 'W3', from: 'FG1:out', to: 'a20' }, { id: 'W4', from: 'FG1:gnd', to: 'top-1' }],
    })

  it('a buzzer beeping by itself (1 Hz): 「BZ1 嗶嗶響，約每 1.00 s 一聲」 — no period while a frequency is the answer', () => {
    const r = run(fgBuzzer(1), 5)
    const e = r.explain()
    expect(e.lines[0]).toMatch(/^BZ1 嗶嗶響，約每 \d+(\.\d+)? m?s 一聲$/)
    expect(blinkPeriod(r.history.emitters.get('BZ1'), r.tele.time)).toBeCloseTo(1, 1)
    expect(r.explain({ secrets: { current: [], nets: [], timing: true } }).lines[0]).toBe('BZ1 嗶嗶響')
  })

  it('a buzzer tone faster than the readings (≈ 1 kHz square): 「BZ1 在響」 on every refresh — never silent / 沒亮 between two samples', () => {
    const engine = new SimEngine(fgBuzzer(1003))
    const l = fgBuzzer(1003)
    const h = newExplainHistory()
    const lines: string[] = []
    const silent: number[] = []
    for (let k = 0; k < 40; k++) {
      engine.advance(0.1, 1e-4)
      const tele = engine.telemetry()
      observeTelemetry(h, l, tele)
      if (tele.components.BZ1.sounding !== true) silent.push(k)
      if (k >= 10) lines.push(record({ layout: l, telemetry: tele, phase: 'running', problems: [], history: h }).lines[0])
    }
    // the instant readings really catch it silent now and then …
    expect(silent.length).toBeGreaterThan(5)
    // … but it sounds all along
    expect(new Set(lines)).toEqual(new Set(['BZ1 在響']))
  })

  it('a silent buzzer’s reason says 「不響」, never 「沒亮」', () => {
    const l = valid({
      version: 1,
      components: [PS(), { id: 'SW1', type: 'pushbutton', at: 'f10' }, { id: 'BZ1', type: 'buzzer', holes: ['h12', 'h16'] }],
      wires: [...RAILS, { id: 'W3', from: 'top+5', to: 'j10' }, { id: 'W4', from: 'j16', to: 'top-17' }],
    })
    const r = run(l, 1)
    const e = r.explain()
    expect(e.lines[0]).toBe('BZ1 不響：SW1 沒按下，電路斷開')
    expect(e.lines[1]).toBe('按住 SW1，電路就會接通')
    expect(e.lines.join('')).not.toMatch(/沒亮/)
  })
})

describe('explain: honesty properties over every line above', () => {
  it('no line contains a Problem.title verbatim', () => {
    expect(produced.length).toBeGreaterThan(20)
    const bad: string[] = []
    for (const { e, input } of produced) {
      for (const p of input.problems) {
        if (p.title.length < 4) continue
        for (const line of e.lines) if (line.includes(p.title)) bad.push(`${line} ⊃ ${p.title}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('every number is a formatter’s output of an input value (or the template’s own constant)', () => {
    const bad: string[] = []
    for (const { e, input, lang: l } of produced) {
      __setLangForTests(l)
      const { layout, telemetry: tele } = input
      // the templates' own constants (a rating, the per-pin limit, the short-circuit threshold)
      const allowed: string[] = ['20 mA', '25 mA', '2 A', '100 °C', 'BOOT0 = 1']
      for (const c of layout.components) {
        allowed.push(c.id)
        const pMax = getEntry(c.type)?.ratings?.pMax
        if (typeof pMax === 'number') allowed.push(fmtPower(pMax).replace(/\.0+(?=\s)/, ''))
        if (typeof c.params?.resistance === 'number') allowed.push(fmtEng(c.params.resistance, 'Ω'))
        for (const h of c.holes ?? []) allowed.push(h)
      }
      // a problem's own fix sentence (line 2's fallback) is the problem's text, not a number made here
      for (const p of input.problems) for (const s of p.detail.split(/。|\. /)) if (s.trim()) allowed.push(s.trim().replace(/[。.]$/, ''))
      // the rule check's own resistor advice (rules-led: 'of about 330 Ω' / 'Use at least 1 kΩ')
      for (const f of input.findings ?? []) for (const m of f.message.matchAll(/(?:about|at least) (\d+(?:\.\d+)? [kM]?Ω)/g)) allowed.push(m[1])
      for (const fw of Object.values(input.firmware ?? {})) allowed.push(fw.name)
      if (tele) {
        allowed.push(fmtSimClock(tele.time))
        for (const v of Object.values(tele.netVoltages)) allowed.push(fmtVoltage(v))
        for (const [id, ct] of Object.entries(tele.components)) {
          if (typeof ct.current === 'number') allowed.push(fmtCurrent(Math.abs(ct.current)))
          if (typeof ct.power === 'number') allowed.push(fmtPower(Math.abs(ct.power)))
          allowed.push(ledLightParts(ct.light, ct.current).value)
          // a PWM LED's eye mean says so: 「15 %（平均 2.98 mA）」 (ledLightParts with average)
          allowed.push(ledLightParts(ct.light, ct.current, { average: true }).value)
          // a motor's speed: whole revolutions per minute
          if (typeof ct.values?.rpm === 'number') allowed.push(` ${Math.round(Math.abs(ct.values.rpm))} `)
          const b = burnCurrentOf(tele.issues, id)
          if (b !== null) allowed.push(fmtCurrent(b))
        }
      }
      for (const line of e.lines) {
        // the history's observed values first (their own formatters), then ids, holes and the values the
        // inputs justify; any digit left is unexplained
        let rest = line
          .replace(/約每 \d+(?:\.\d+)? m?s 一(?:次|聲)|週期約 \d+(?:\.\d+)? m?s/g, ' ') // observed periods (fmtSpan of the flips)
          .replace(/about every \d+(?:\.\d+)? m?s/g, ' ')
          .replace(/(?:亮時|最亮) \d+(?:\.\d+)? [mµn]A/g, ' ') // observed on-currents (fmtCurrent of the samples)
          .replace(/\d+(?:\.\d+)? [mµn]A (?:while on|at its brightest)/g, ' ')
        if (allowed.includes(line)) continue
        for (const a of [...allowed].sort((x, y) => y.length - x.length)) rest = rest.split(a).join(' ')
        rest = rest
          .replace(/\b(?:top|bot)[+−-]?\d+/g, ' ') // rail refs
          .replace(/第 \d+ 孔/g, ' ') // a rail hole's index (endpointName — the fix target)
          .replace(/第 \d+ 腳/g, ' ') // a part pin's name (pinLabel: 「R1 第 1 腳」)
          .replace(/\b[a-j]\d+\b/g, ' ') // strip holes
          .replace(/\bP[A-C]\d+\b/g, ' ') // board pin names
        if (/\d/.test(rest)) bad.push(`${line} → ${rest}`)
      }
    }
    __setLangForTests('zh-TW')
    expect(bad).toEqual([])
  })
})
