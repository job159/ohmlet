/**
 * Beginner (初級) analog lessons, src/lessons/beginner/*.lesson.ts — every
 * lesson is checked through the REAL lesson evaluator
 * (src/lessons/engine/evaluate.ts: netlist, the coordinator running the
 * analog engine (+ the real firmware/dist image where a lesson has an MCU),
 * the electrical rule checker):
 *  - start and solution circuits pass validateLayout; required parts exist in
 *    the catalog, required firmware in firmware/dist;
 *  - the solution passes EVERY acceptance check;
 *  - the start circuit fails at least one acceptance check;
 *  - every step check passes on the solution in the state the step asks the
 *    learner to put it in (a held push-button = the runtime param 'pressed',
 *    a flipped slide switch = 'state', exactly what the inspector writes);
 *  - the mistakes the lessons describe are reproducible (they fail the
 *    acceptance for the reason given);
 *  - the content follows the lesson rules (3–8 steps, objectives, mistakes,
 *    expected results with numbers, zh-TW text without mainland terms).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import '../../src/mcu/all'
import { LESSONS } from '../../src/lessons'
import type { Lesson, LessonCheck, LessonCircuit } from '../../src/lessons/types'
import { evaluateChecks, evaluateLesson, lessonCircuitInput, type EvaluatedCheck } from '../../src/lessons/engine/evaluate'
import { validateLayout } from '../../src/model/validate'
import { CATALOG } from '../../src/model/catalog'
import type { CircuitLayout, ParamValue } from '../../src/model/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '../../firmware/dist')
const LONG = { timeout: 600_000 }
/** yield to the event loop now and then: a long synchronous simulation must not starve the vitest worker RPC */
const EVAL = { yieldEveryMs: 100 }

const beginner = LESSONS.filter((l) => l.level === 'beginner')

function explain(results: EvaluatedCheck[]): string {
  const lines: string[] = []
  const walk = (r: EvaluatedCheck, depth: number) => {
    lines.push(`${'  '.repeat(depth)}${r.pass ? 'PASS' : 'FAIL'} [${r.kind}] ${r.label}: ${r.detail}${r.technical ? ` | ${r.technical.join(' | ')}` : ''}`)
    for (const c of r.children ?? []) walk(c, depth + 1)
  }
  results.forEach((r) => walk(r, 0))
  return lines.join('\n')
}

/** Simplified-Chinese / mainland terms that must not appear in zh-TW lesson text. */
const MAINLAND = [
  '程序', '文件', '界面', '內存', '默認', '寄存器', '串口', '波特率', '引腳', '管腳', '芯片', '模塊', '信號',
  '數據', '調試', '字節', '比特', '運行', '加載', '硬件', '軟件', '屏幕', '時鐘', '定時器', '電平', '上升沿', '下降沿',
  '占空比', '分頻', '採樣', '分辨率', '消抖', '輪詢', '緩沖', '萬用表', '電位器', '晶振', '激活', '視頻', '網絡',
  '打印', '菜單', '鼠標', '光標', '服務器', '兼容', '計算機', '單片機',
  // mainland transistor / instrument terms (Taiwan: 電晶體、射極、集極、閘極、汲極、探棒、迴路)
  '三極管', '場效應管', '發射極', '集電極', '柵極', '漏極', '探頭', '回路', '接口', '總線',
  // simplified characters never belong in zh-TW text
  '这', '个', '们', '时', '后', '设', '据', '错', '数', '电', '压', '图', '线', '开', '关', '读', '写', '为', '与',
]

function allText(l: Lesson): string {
  return [
    l.title,
    l.summary,
    ...l.objectives,
    l.wiring,
    l.theory,
    ...l.expected,
    ...l.mistakes.flatMap((m) => [m.symptom, m.cause, m.fix]),
    ...l.steps.flatMap((s) => [s.title, s.body]),
    l.runnableNote ?? '',
    l.start.layout.name ?? '',
    l.solution.layout.name ?? '',
  ].join('\n')
}

/** Set runtime params on placed parts (what the inspector writes while the learner holds / flips them). */
function withParams(layout: CircuitLayout, set: Record<string, Record<string, ParamValue>>): CircuitLayout {
  return {
    ...layout,
    components: layout.components.map((c) => (set[c.id] ? { ...c, params: { ...(c.params ?? {}), ...set[c.id] } } : c)),
  }
}

/** Circuit edit helpers for reproducing the lessons' 常見錯誤. */
function edit(circuit: LessonCircuit, fn: (layout: CircuitLayout) => CircuitLayout): LessonCircuit {
  return { ...circuit, layout: fn(structuredClone(circuit.layout)) }
}
function setParam(id: string, key: string, value: ParamValue) {
  return (l: CircuitLayout): CircuitLayout => withParams(l, { [id]: { [key]: value } })
}
function dropComponent(id: string) {
  return (l: CircuitLayout): CircuitLayout => ({ ...l, components: l.components.filter((c) => c.id !== id) })
}
function dropWire(id: string) {
  return (l: CircuitLayout): CircuitLayout => ({ ...l, wires: l.wires.filter((w) => w.id !== id) })
}
function moveHoles(id: string, holes: string[]) {
  return (l: CircuitLayout): CircuitLayout => ({ ...l, components: l.components.map((c) => (c.id === id ? { ...c, holes } : c)) })
}
function moveWire(id: string, from: string, to: string) {
  return (l: CircuitLayout): CircuitLayout => ({ ...l, wires: l.wires.map((w) => (w.id === id ? { ...w, from, to } : w)) })
}
function pipe(...fns: ((l: CircuitLayout) => CircuitLayout)[]) {
  return (l: CircuitLayout): CircuitLayout => fns.reduce((acc, f) => f(acc), l)
}

/**
 * The state a step asks the learner to put the circuit in before its check
 * runs (held buttons, flipped switches). Steps not listed run on the
 * solution as it is.
 */
const STEP_STATE: Record<string, Record<string, Record<string, ParamValue>>> = {
  'b3-s3': { SW1: { pressed: true } },
  'b3-s5': { SW2: { pressed: true } },
  'b4-s3': { SW1: { pressed: true } },
  'b6-s4': { SW1: { state: 'a' } },
  'b6-s5': { SW1: { state: 'b' } },
  'b7-s5': { SW1: { state: 'b' } },
}

/**
 * Reproductions of the documented mistakes (常見錯誤): the broken circuit
 * must fail the lesson's acceptance with a failing check whose label
 * contains `fails`, and/or — for mistakes that only show in another switch
 * position — fail the check of step `step` (in that step's STEP_STATE).
 */
interface Mistake {
  what: string
  circuit: (l: Lesson) => LessonCircuit
  /** substring of the label of an acceptance check that must fail */
  fails?: string
  /** id of a step whose check must fail on the broken circuit */
  step?: string
}

/** A three-lead part with its pins 2 and 3 swapped (drain ↔ source of the IRLZ44N). */
function swapPins23(id: string) {
  return (l: CircuitLayout): CircuitLayout => ({
    ...l,
    components: l.components.map((c) => (c.id === id && c.holes ? { ...c, holes: [c.holes[0], c.holes[2], c.holes[1]] } : c)),
  })
}
/** A three-lead part with its pins 1 and 3 swapped (emitter ↔ collector of the 2N3904). */
function swapPins13(id: string) {
  return (l: CircuitLayout): CircuitLayout => ({
    ...l,
    components: l.components.map((c) => (c.id === id && c.holes ? { ...c, holes: [c.holes[2], c.holes[1], c.holes[0]] } : c)),
  })
}
function addWire(id: string, from: string, to: string) {
  return (l: CircuitLayout): CircuitLayout => ({ ...l, wires: [...l.wires, { id, from, to }] })
}

const MISTAKES: Record<string, Mistake[]> = {
  'b1-led-resistor': [
    { what: 'LED reversed', circuit: (l) => edit(l.solution, moveHoles('LED1', ['c16', 'c14'])), fails: '電流' },
    { what: '100 Ω burns the LED', circuit: (l) => edit(l.solution, setParam('R1', 'resistance', 100)), fails: '沒有燒毀' },
    { what: '150 Ω: above the 20 mA rating', circuit: (l) => edit(l.solution, setParam('R1', 'resistance', 150)), fails: 'ERC' },
    { what: '10 kΩ: LED barely lit', circuit: (l) => edit(l.solution, setParam('R1', 'resistance', 10000)), fails: '電流' },
    { what: 'LED legs in one column', circuit: (l) => edit(l.solution, moveHoles('LED1', ['c14', 'd14'])), fails: '電流' },
  ],
  'b2-voltage-divider': [
    { what: 'DMM1 COM floating', circuit: (l) => edit(l.solution, dropWire('W4')), fails: 'COM' },
    { what: 'R2 to top+ instead of top−', circuit: (l) => edit(l.solution, moveHoles('R2', ['b12', 'top+10'])), fails: 'DMM1 量到' },
    { what: 'meter in A mode', circuit: (l) => edit(l.solution, setParam('DMM1', 'mode', 'A')), fails: 'DMM1 量到' },
    {
      what: 'IN and COM swapped',
      circuit: (l) => edit(l.solution, pipe(moveWire('W3', 'DMM1:COM', 'e12'), moveWire('W4', 'DMM1:IN', 'top-12'))),
      fails: 'DMM1 量到',
    },
  ],
  'b3-pull-resistors': [
    { what: 'no pull resistors (floating)', circuit: (l) => l.start, fails: 'ERC' },
    { what: 'R1 to top− (pull-down)', circuit: (l) => edit(l.solution, moveHoles('R1', ['top-30', 'b40'])), fails: 'PA0 為高準位' },
    {
      what: 'pull-up to 5 V',
      circuit: (l) => edit(l.solution, pipe(moveHoles('R1', ['bot+38', 'j40']), addWire('wx', 'PS1:+', 'bot+0'))),
      fails: 'ERC',
    },
    {
      what: 'SW2 straight across the 3.3 V rail',
      circuit: (l) => edit(l.solution, pipe(moveWire('W7', 'top+47', 'a48'), moveWire('W8', 'a50', 'top-39'))),
      fails: 'ERC',
    },
  ],
  'b4-button-debounce': [
    { what: 'button bypassed', circuit: (l) => edit(l.solution, moveWire('W3', 'top+7', 'b12')), fails: 'LED1 不亮' },
    { what: 'R3 left out', circuit: (l) => edit(l.solution, dropComponent('R3')), fails: 'C1（Y 點）' },
  ],
  'b5-rc-time-constant': [
    { what: 'FG1 gnd not tied to ground', circuit: (l) => edit(l.solution, dropWire('W4')), fails: '共地' },
    { what: '100 Hz', circuit: (l) => edit(l.solution, setParam('FG1', 'frequency', 100)), fails: 'τ' },
    { what: '1 mF', circuit: (l) => edit(l.solution, setParam('C1', 'capacitance', 1e-3)), fails: 'τ' },
    { what: 'offset 0 V', circuit: (l) => edit(l.solution, setParam('FG1', 'offset', 0)), fails: 'τ' },
    { what: 'PRB2 on the generator side', circuit: (l) => edit(l.solution, moveHoles('PRB2', ['e10'])), fails: '示波器' },
  ],
  'b6-mosfet-led': [
    { what: 'no gate pull-down', circuit: (l) => edit(l.solution, dropComponent('R3')), fails: '下拉', step: 'b6-s4' },
    { what: 'drain and source swapped', circuit: (l) => edit(l.solution, swapPins23('Q1')), fails: 'Q1 汲極', step: 'b6-s4' },
    { what: 'gate resistor on throw a', circuit: (l) => edit(l.solution, moveHoles('R2', ['a10', 'a16'])), fails: 'LED1 亮' },
    { what: 'LED cathode to ground: MOSFET bypassed', circuit: (l) => edit(l.solution, moveWire('W5', 'a20', 'top-21')), fails: 'Q1 汲極', step: 'b6-s4' },
    { what: 'drain shorted to ground', circuit: (l) => edit(l.solution, addWire('wx', 'b17', 'top-21')), fails: '短路', step: 'b6-s4' },
  ],
  'b7-npn-switch': [
    { what: '100 kΩ base resistor: active region', circuit: (l) => edit(l.solution, setParam('R2', 'resistance', 100000)), fails: 'V_CE' },
    { what: 'no base resistor', circuit: (l) => edit(l.solution, pipe(dropComponent('R2'), addWire('wx', 'a12', 'a17'))), fails: 'ERC' },
    { what: 'emitter and collector swapped', circuit: (l) => edit(l.solution, swapPins13('Q1')), fails: 'LED1 亮' },
    { what: 'LED cathode to ground: transistor bypassed', circuit: (l) => edit(l.solution, moveWire('W5', 'a20', 'top-21')), fails: 'Q1 集極' },
    { what: 'collector shorted to ground', circuit: (l) => edit(l.solution, addWire('wx', 'b18', 'top-21')), fails: '短路' },
  ],
}

/**
 * The word rules of scripts/i18n-audit.mjs (the "fully Chinese" UI gate),
 * applied to the lesson texts the lesson panel shows: outside `code` spans
 * (rendered as <code>, which the audit skips) every word of 3+ Latin letters
 * must be a technical token the audit allows — its ALLOW / REGISTERS lists
 * (read from the script itself), a catalog pin / part-number token, a token
 * with a digit or underscore, or a mixed-case identifier.
 */
function auditAllowlist(): Set<string> {
  const src = readFileSync(join(HERE, '../../scripts/i18n-audit.mjs'), 'utf8')
  const out = new Set<string>()
  for (const name of ['ALLOW', 'REGISTERS']) {
    const m = new RegExp(`const ${name} = new Set\\(\\s*\`([^\`]*)\``).exec(src)
    expect(m, `${name} list in scripts/i18n-audit.mjs`).not.toBeNull()
    for (const t of m![1].split(/\s+/)) if (t) out.add(t)
  }
  for (const e of Object.values(CATALOG)) {
    const add = (s: unknown) => {
      for (const t of String(s ?? '').split(/[^A-Za-z0-9_]+/)) if (t && !/^[a-z]+$/.test(t)) out.add(t)
    }
    for (const p of e.pins ?? []) add(p)
    for (const pi of e.pinInfo ?? []) {
      add(pi.pin)
      add(pi.label)
      for (const f of pi.functions ?? []) add(f)
    }
    add(e.meta?.partNumber)
    for (const p of e.params ?? []) add(p.unit)
  }
  for (const t of ['ohmlet', 'cortex', 'stm']) out.add(t)
  return out
}

function leakWords(text: string, allow: Set<string>): string[] {
  const s = text
    .replace(/`[^`]*`/g, ' ')
    .replace(/\b(?:\d+:)?(?:top|bot)[+\-−]\d*/g, ' ')
    .replace(/\b(?:hal|bare|soc|cpu|lab|lesson)(?:-[a-z0-9]+)+\b/g, ' ')
    .replace(/\b[A-Za-z]+\d+:[\w+-]+/g, ' ')
    .replace(/\bBlue Pill\b/g, ' ')
  const words: string[] = []
  for (const tok of s.match(/[A-Za-z0-9_]+(?:['’][A-Za-z]+)?/g) ?? []) {
    if (!/[A-Za-z]{3}/.test(tok)) continue
    if (/[0-9_]/.test(tok)) continue
    if (/[a-z]/.test(tok) && (tok.match(/[A-Z]/g) ?? []).length >= 2) continue
    if (allow.has(tok) || allow.has(tok.toLowerCase())) continue
    words.push(tok)
  }
  return words
}

function checkLabels(c: LessonCheck): string[] {
  return [...(c.label ? [c.label] : []), ...(c.kind === 'all' ? c.checks.flatMap(checkLabels) : [])]
}

describe('beginner lesson texts pass the i18n-audit word rules', () => {
  const allow = auditAllowlist()
  for (const l of beginner) {
    it(l.id, () => {
      const texts = [
        allText(l),
        ...l.acceptance.flatMap(checkLabels),
        ...l.steps.flatMap((s) => (s.check ? checkLabels(s.check) : [])),
      ]
      const leaks = [...new Set(texts.flatMap((x) => leakWords(x, allow)))]
      expect(leaks, `untranslated words in ${l.id}`).toEqual([])
    })
  }
})

describe('b5: the τ acceptance check measures the time constant (±10 %)', () => {
  const b5 = beginner.find((l) => l.id === 'b5-rc-time-constant')
  // τ = (R1 + 50 Ω generator output) × 1 µF
  for (const [r, pass] of [
    [8200, false], // τ ≈ 8.25 ms (−18 %)
    [9100, true], // τ ≈ 9.15 ms
    [10000, true], // τ ≈ 10.05 ms
    [10500, true], // τ ≈ 10.55 ms
    [12000, false], // τ ≈ 12.05 ms (+20 %)
  ] as const) {
    it(`R1 = ${r} Ω → ${pass ? 'pass' : 'fail'}`, LONG, async () => {
      expect(b5).toBeDefined()
      const tau = b5!.acceptance[0]
      expect(tau.kind).toBe('all')
      const circuit = edit(b5!.solution, setParam('R1', 'resistance', r))
      const res = await evaluateChecks(await lessonCircuitInput(circuit), [tau], EVAL)
      expect(res[0].pass, explain(res)).toBe(pass)
    })
  }
})

describe('beginner lessons: registry and content', () => {
  it('the seven beginner lessons are registered in order', () => {
    expect(beginner.map((l) => l.id)).toEqual([
      'b1-led-resistor',
      'b2-voltage-divider',
      'b3-pull-resistors',
      'b4-button-debounce',
      'b5-rc-time-constant',
      'b6-mosfet-led',
      'b7-npn-switch',
    ])
    expect(beginner.map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  for (const l of beginner) {
    describe(l.id, () => {
      it('layouts are valid, requirements exist', () => {
        for (const [what, c] of [
          ['start', l.start],
          ['solution', l.solution],
        ] as const) {
          const v = validateLayout(c.layout)
          expect(v.errors, `${l.id} ${what}`).toEqual([])
          expect(v.ok).toBe(true)
          for (const p of Object.values(c.firmware ?? {})) expect(existsSync(join(DIST, `${p}.elf`)), p).toBe(true)
        }
        for (const p of l.requires?.parts ?? []) expect(CATALOG[p], p).toBeDefined()
        for (const p of l.requires?.firmware ?? []) expect(existsSync(join(DIST, `${p}.elf`)), p).toBe(true)
        for (const c of l.solution.layout.components) expect(l.requires?.parts ?? [], `${c.type} listed in requires.parts`).toContain(c.type)
        // the ids the checks reference that the learner does not add are pre-placed in the start circuit
        const startIds = new Set(l.start.layout.components.map((c) => c.id))
        const solIds = new Set(l.solution.layout.components.map((c) => c.id))
        for (const id of startIds) expect(solIds.has(id), `${id} of the start circuit is kept in the solution`).toBe(true)
      })

      it('content follows the lesson rules (zh-TW, 3–8 steps, mistakes, expected results)', () => {
        expect(l.steps.length).toBeGreaterThanOrEqual(3)
        expect(l.steps.length).toBeLessThanOrEqual(8)
        expect(new Set(l.steps.map((s) => s.id)).size).toBe(l.steps.length)
        expect(l.objectives.length).toBeGreaterThanOrEqual(3)
        expect(l.mistakes.length).toBeGreaterThanOrEqual(3)
        expect(l.expected.length).toBeGreaterThanOrEqual(3)
        expect(l.acceptance.length).toBeGreaterThanOrEqual(3)
        expect(l.wiring.length).toBeGreaterThan(100)
        expect(l.theory.length).toBeGreaterThan(200)
        if (l.runnable !== 'ready') expect(l.runnableNote, 'runnableNote').toBeTruthy()
        const text = allText(l)
        for (const w of MAINLAND) expect(text.includes(w), `mainland term "${w}" in ${l.id}`).toBe(false)
        for (const e of l.expected) expect(/\d/.test(e), e).toBe(true)
        // highlights name parts / holes that exist in the solution
        const ids = new Set(l.solution.layout.components.map((c) => c.id))
        for (const s of l.steps) for (const id of s.highlight?.components ?? []) expect(ids.has(id), `${s.id} highlights ${id}`).toBe(true)
      })

      it('the solution passes every acceptance check', LONG, async () => {
        const ev = await evaluateLesson(l, l.solution, EVAL)
        if (process.env.LESSON_VERBOSE) console.log(`${l.id} solution\n${explain(ev.results)}`)
        expect(ev.pass, explain(ev.results)).toBe(true)
      })

      it('the start circuit fails at least one acceptance check', LONG, async () => {
        const ev = await evaluateLesson(l, l.start, EVAL)
        if (process.env.LESSON_VERBOSE) console.log(`${l.id} start\n${explain(ev.results)}`)
        expect(ev.pass, explain(ev.results)).toBe(false)
      })

      it('every step check passes on the solution (in the state the step asks for)', LONG, async () => {
        for (const s of l.steps) {
          if (!s.check) continue
          const state = STEP_STATE[s.id]
          const circuit: LessonCircuit = state ? { ...l.solution, layout: withParams(l.solution.layout, state) } : l.solution
          const res = await evaluateChecks(await lessonCircuitInput(circuit), [s.check as LessonCheck], EVAL)
          if (process.env.LESSON_VERBOSE) console.log(`${l.id} ${s.id}\n${explain(res)}`)
          expect(res[0].pass, `${s.id}\n${explain(res)}`).toBe(true)
        }
      })

      for (const m of MISTAKES[l.id] ?? []) {
        it(`mistake reproduces: ${m.what}`, LONG, async () => {
          const broken = m.circuit(l)
          expect(validateLayout(broken.layout).errors, 'the broken circuit is still a valid layout').toEqual([])
          if (m.step) {
            const step = l.steps.find((s) => s.id === m.step)
            expect(step?.check, m.step).toBeDefined()
            const state = STEP_STATE[m.step]
            const circuit: LessonCircuit = state ? { ...broken, layout: withParams(broken.layout, state) } : broken
            const res = await evaluateChecks(await lessonCircuitInput(circuit), [step!.check as LessonCheck], EVAL)
            if (process.env.LESSON_VERBOSE) console.log(`${l.id} mistake ${m.what} (${m.step})\n${explain(res)}`)
            expect(res[0].pass, explain(res)).toBe(false)
          }
          if (m.fails) {
            const ev = await evaluateLesson(l, broken, EVAL)
            if (process.env.LESSON_VERBOSE) console.log(`${l.id} mistake ${m.what}\n${explain(ev.results)}`)
            expect(ev.pass, explain(ev.results)).toBe(false)
            const failed = ev.results.filter((r) => !r.pass).map((r) => r.label)
            expect(
              failed.some((x) => x.includes(m.fails!)),
              `expected a failing check labelled "…${m.fails}…", failed: ${failed.join(' / ')}`,
            ).toBe(true)
          }
        })
      }
    })
  }
})
