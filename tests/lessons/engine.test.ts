/**
 * Lesson engine (src/lessons/engine): every LessonCheck kind evaluated
 * against the REAL simulation — a Blue Pill running the bundled hal-blink /
 * hal-uart-hello images through the coordinator, netlists, ERC and a
 * firmware contract — with zh-TW measured-vs-expected details; plus the
 * pure parts (signal arithmetic, formatting, PinRef resolution, the Markdown
 * subset), progress reporting, cancellation and the inline runner.
 */
import { afterEach, describe, expect, it } from 'vitest'
import '../../src/mcu/all'
import { __setLangForTests } from '../../src/i18n'
import type { LessonCheck } from '../../src/lessons/types'
import {
  EvalCancelledError,
  assetNeeds,
  checkLabel,
  collectAssets,
  evaluateChecks,
  evaluateLesson,
  fmtQuantity,
  fmtRange,
  fmtSi,
  lessonCircuitInput,
  markdownPlainText,
  parseInline,
  parseMarkdown,
  resolvePinRef,
  runLessonChecks,
  type EvalProgress,
  type EvaluatedCheck,
} from '../../src/lessons/engine'
import { analogEdges, jitteredInstants, periodStats, sampleStats, timeWeightedStats } from '../../src/lessons/engine/signal'
import type { Lesson } from '../../src/lessons/types'
import { bluePillWorld, part, tap, w } from '../coordinator/worlds'

afterEach(() => __setLangForTests('zh-TW'))

const LONG = { timeout: 300_000 }
const CJK = /[一-鿿]/

/** LED + 330 Ω on PA5 (hal-blink toggles PA5 every 501 ms). */
function blinkLayout() {
  return bluePillWorld(
    [part('R1', 'resistor', ['a45', 'a50'], { resistance: 330 }), part('D1', 'led', ['b50', 'top-5'], { color: 'red' })],
    [w(tap('PA5'), 'e45')],
  )
}

function byKey(results: EvaluatedCheck[]): Record<string, EvaluatedCheck> {
  return Object.fromEntries(results.map((r) => [r.key, r]))
}

describe('evaluateChecks — every check kind on a running Blue Pill', () => {
  it('evaluates structure, firmware, measurements, UART, ERC, contracts and composites', LONG, async () => {
    __setLangForTests('zh-TW')
    const input = await lessonCircuitInput({ layout: blinkLayout(), firmware: { U1: 'hal-blink' } })
    const PA5 = { component: 'U1', pin: 'PA5' }
    const checks: LessonCheck[] = [
      /* 0 */ { kind: 'has-part', type: 'resistor' },
      /* 1 */ { kind: 'has-part', type: 'led', count: 2 },
      /* 2 */ { kind: 'connected', a: PA5, b: { component: 'D1', pin: 'anode' }, via: { type: 'resistor', param: 'resistance', min: 100, max: 1000 } },
      /* 3 */ { kind: 'connected', a: PA5, b: { component: 'D1', pin: 'anode' }, via: { type: 'resistor', param: 'resistance', min: 1000, max: 10000 } },
      /* 4 */ { kind: 'connected', a: { component: 'D1', pin: 'cathode' }, b: { component: 'U1', pin: 'GND1' } },
      /* 5 */ { kind: 'not-connected', a: PA5, b: { component: 'U1', pin: 'GND1' } },
      /* 6 */ { kind: 'firmware-loaded', component: 'U1', project: 'hal-blink' },
      /* 7 */ { kind: 'firmware-loaded', component: 'U1', project: 'hal-uart-hello' },
      /* 8 */ { kind: 'measure', at: PA5, quantity: 'frequency', min: 0.9, max: 1.1, seconds: 2.2 },
      /* 9 */ { kind: 'measure', at: PA5, quantity: 'duty', min: 45, max: 55, seconds: 2.2, fresh: true },
      /* 10 */ { kind: 'measure', at: { hole: 'a50' }, quantity: 'frequency', min: 0.9, max: 1.1, seconds: 2.2, fresh: true },
      /* 11 */ { kind: 'measure', at: { component: 'U1', pin: '3V3_1' }, quantity: 'voltage', min: 3.2, max: 3.4, seconds: 0.2 },
      /* 12 */ { kind: 'measure', at: { component: 'D1', pin: 'anode' }, component: 'D1', quantity: 'current', min: 0.001, max: 0.004, seconds: 2 },
      /* 13 */ { kind: 'measure', at: { component: 'D1', pin: 'anode' }, component: 'D1', quantity: 'led-brightness', min: 0.9, max: 1, seconds: 2 },
      /* 14 */ { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'Hello', seconds: 0.3 },
      /* 15 */ { kind: 'erc-clean', level: 'risk' },
      /* 16 */ { kind: 'firmware-checks', project: 'bare-button' },
      /* 17 */ { kind: 'all', checks: [{ kind: 'has-part', type: 'resistor' }, { kind: 'has-part', type: 'buzzer' }] },
      /* 18 */ { kind: 'measure', at: { component: 'U9', pin: 'PA5' }, quantity: 'voltage', min: 0, max: 1 },
    ]
    const progress: EvalProgress[] = []
    const r = byKey(await evaluateChecks(input, checks, { onProgress: (p) => progress.push(p) }))
    const pass = (k: number) => expect(r[k].pass, `${k}: ${r[k].label} — ${r[k].detail}`).toBe(true)
    const fail = (k: number) => expect(r[k].pass, `${k}: ${r[k].label} — ${r[k].detail}`).toBe(false)

    pass(0)
    fail(1)
    expect(r[1].detail).toContain('只有 1 個')
    pass(2)
    expect(r[2].detail).toContain('330 Ω')
    fail(3)
    expect(r[3].detail).toMatch(/330 Ω.*1 kΩ – 10 kΩ/)
    pass(4)
    pass(5)
    pass(6)
    fail(7)
    expect(r[7].detail).toContain('hal-uart-hello')
    pass(8)
    expect(r[8].detail).toMatch(/量測值 0\.99\d Hz/)
    pass(9) // percent range (45–55) read as a fraction
    expect(r[9].detail).toContain('量測值 50.0 %') // H3 fmtPercent, as the analyzer prints it (LS-10)
    pass(10) // analog hole net: logic recorder / scope ring edges
    pass(11)
    expect(r[11].detail).toContain('3.30 V') // H3 compact, as the inspector prints it (LS-10)
    pass(12) // a 50 % blinking LED: ~2 mA average
    fail(13) // brightness averages ~50 % — not 90 %
    fail(14) // hal-blink prints nothing
    expect(r[14].detail).toContain('沒有送出任何資料')
    pass(15)
    pass(16)
    expect(r[16].detail).toContain('bare-button')
    fail(17)
    expect(r[17].children?.map((c) => c.pass)).toEqual([true, false])
    fail(18)
    expect(r[18].detail).toContain('電路中沒有 U9')

    // zh-TW labels and details, no evaluator errors
    for (const x of Object.values(r)) {
      expect(CJK.test(x.label), x.label).toBe(true)
      expect(CJK.test(x.detail), x.detail).toBe(true)
      expect(x.error, `${x.key} ${x.detail}`).toBeFalsy()
    }
    // failures point at what to look at
    expect(r[3].focus?.components).toContain('R1')

    // progress: monotone, every top-level check reported, ends at 1
    for (let i = 1; i < progress.length; i++) expect(progress[i].fraction).toBeGreaterThanOrEqual(progress[i - 1].fraction - 1e-9)
    expect(new Set(progress.map((p) => p.index)).size).toBe(checks.length + 1)
    expect(progress[progress.length - 1].fraction).toBe(1)
  })

  it('reads UART output byte-exactly within the window', LONG, async () => {
    const input = await lessonCircuitInput({ layout: bluePillWorld(), firmware: { U1: 'hal-uart-hello' } })
    const [hello, tick, late] = await evaluateChecks(input, [
      { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'Hello from STM32F103!', seconds: 0.5 },
      { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'tick 1\n', seconds: 1.5 },
      { kind: 'uart-contains', component: 'U1', port: 'USART1', text: 'tick 3', seconds: 1.5 },
    ])
    expect(hello.pass, hello.detail).toBe(true)
    expect(hello.detail).toMatch(/上電後 0\.\d+ 秒收到/)
    expect(tick.pass, tick.detail).toBe(true) // CR of "\r\n" ignored
    expect(late.pass).toBe(false)
    expect(late.technical?.[0]).toContain('tick 1')
  })

  it('measures a DC net and a missing firmware honestly', LONG, async () => {
    // no firmware bound: the pin floats / stays low, never "1 Hz"
    const input = await lessonCircuitInput({ layout: blinkLayout() })
    const [freq, fw] = await evaluateChecks(input, [
      { kind: 'measure', at: { component: 'U1', pin: 'PA5' }, quantity: 'frequency', min: 0.9, max: 1.1, seconds: 0.3 },
      { kind: 'firmware-loaded', component: 'U1' },
    ])
    expect(freq.pass).toBe(false)
    expect(freq.detail).toContain('訊號沒有變化')
    expect(fw.pass).toBe(false)
    expect(fw.detail).toContain('還沒有韌體') // the canonical 「U1 還沒有韌體」 (LS-8, H9)
  })

  it('reports a bypassed via part and an unconnected pin', async () => {
    const layout = bluePillWorld([part('R1', 'resistor', ['a45', 'a50'], { resistance: 330 })], [w(tap('PA5'), 'e45'), w('b45', 'b50')])
    const [bypassed, open] = await evaluateChecks({ layout, firmware: {} }, [
      { kind: 'connected', a: { component: 'U1', pin: 'PA5' }, b: { hole: 'c50' }, via: { type: 'resistor' } },
      { kind: 'connected', a: { hole: 'f60' }, b: { hole: 'c50' } },
    ])
    expect(bypassed.pass).toBe(false)
    expect(bypassed.detail).toContain('被跳過')
    expect(open.pass).toBe(false)
    expect(open.detail).toContain('沒有接到任何東西')
  })

  it('details follow the UI language', async () => {
    __setLangForTests('en')
    const [r] = await evaluateChecks({ layout: blinkLayout(), firmware: {} }, [{ kind: 'has-part', type: 'led', count: 3 }])
    expect(r.detail).toBe('Only 1 × LED in the circuit (need at least 3).')
  })

  it('cancels between simulation slices', LONG, async () => {
    const input = await lessonCircuitInput({ layout: blinkLayout(), firmware: { U1: 'hal-blink' } })
    const signal = { aborted: false }
    const run = evaluateChecks(
      input,
      [{ kind: 'measure', at: { component: 'U1', pin: 'PA5' }, quantity: 'frequency', min: 0, max: 10, seconds: 5 }],
      {
        signal,
        onProgress: (p) => {
          if (p.fraction > 0.05) signal.aborted = true
        },
      },
    )
    await expect(run).rejects.toBeInstanceOf(EvalCancelledError)
  })

  it('evaluateLesson / runLessonChecks (inline) agree on a lesson', LONG, async () => {
    const lesson: Lesson = {
      id: 'test-blink',
      level: 'beginner',
      order: 0,
      title: '測試',
      summary: '測試',
      objectives: ['測試'],
      wiring: '測試',
      theory: '測試',
      start: { layout: bluePillWorld() },
      solution: { layout: blinkLayout(), firmware: { U1: 'hal-blink' } },
      expected: ['測試'],
      mistakes: [],
      acceptance: [
        { kind: 'firmware-loaded', component: 'U1', project: 'hal-blink' },
        { kind: 'has-part', type: 'led' },
      ],
      steps: [{ id: 's1', title: '測試', body: '測試' }],
      runnable: 'ready',
    }
    const sol = await evaluateLesson(lesson, lesson.solution)
    expect(sol.pass).toBe(true)
    const start = await evaluateLesson(lesson, lesson.start)
    expect(start.pass).toBe(false)
    expect(start.results.map((r) => r.pass)).toEqual([false, false])
    const input = await lessonCircuitInput(lesson.solution)
    const viaRunner = await runLessonChecks(input, lesson.acceptance, { worker: false })
    expect(viaRunner.map((r) => r.pass)).toEqual([true, true])
    // the worker gets exactly the assets a run needs
    expect(assetNeeds([...lesson.acceptance, { kind: 'firmware-checks', project: 'bare-button' }])).toEqual({
      bundled: ['hal-blink', 'bare-button'],
      manifest: ['bare-button'],
    })
    const bundle = await collectAssets([{ kind: 'firmware-checks', project: 'bare-button' }])
    expect(bundle.bundled['bare-button']?.bytes.length).toBeGreaterThan(1000)
    expect(bundle.manifest['bare-button']?.checks).toBeDefined()
  })
})

describe('signal arithmetic', () => {
  it('frequency and duty over whole periods; DC levels', () => {
    // 10 Hz, 30 % duty, starting low
    const times: number[] = []
    const levels: number[] = []
    for (let k = 0; k < 10; k++) {
      times.push(k * 0.1, k * 0.1 + 0.03)
      levels.push(1, 0)
    }
    const s = periodStats({ initial: 0, times, levels })
    expect(s.frequency).toBeCloseTo(10, 9)
    expect(s.duty).toBeCloseTo(0.3, 9)
    expect(s.rising).toBe(10)
    expect(periodStats({ initial: 1, times: [], levels: [] })).toMatchObject({ constant: 1, duty: 1, frequency: null })
    expect(periodStats({ initial: 0, times: [0.5], levels: [1] })).toMatchObject({ frequency: null, duty: null, constant: null })
    expect(periodStats({ initial: 2, times: [], levels: [] }).constant).toBe(2)
  })

  it('analog edges at the mid-level with hysteresis; flat signals have none', () => {
    const t: number[] = []
    const v: number[] = []
    for (let i = 0; i <= 2000; i++) {
      t.push(i * 1e-3)
      v.push(1 + Math.sin(2 * Math.PI * 5 * i * 1e-3)) // 5 Hz around 1 V
    }
    const e = analogEdges(t, v, 0, 2)!
    expect(e).not.toBeNull()
    expect(periodStats(e).frequency).toBeCloseTo(5, 2)
    expect(periodStats(e).duty).toBeCloseTo(0.5, 2)
    expect(analogEdges([0, 1, 2], [3.3, 3.31, 3.3], 0, 2)).toBeNull()
  })

  it('time-weighted and sampled means', () => {
    // 1 V for 0.25 s then 3 V for 0.75 s → 2.5 V
    expect(timeWeightedStats([0.25, 1], [1, 3], 0, 1).mean).toBeCloseTo(2.5, 12)
    expect(sampleStats([1, NaN, 3]).mean).toBe(2)
    expect(sampleStats([]).count).toBe(0)
    const at = jitteredInstants(0, 1, 100)
    expect(at).toHaveLength(100)
    at.forEach((x, k) => {
      expect(x).toBeGreaterThanOrEqual(k / 100)
      expect(x).toBeLessThan((k + 1) / 100)
    })
    expect(jitteredInstants(0, 1, 100)).toEqual(at) // deterministic
  })
})

describe('formatting and refs', () => {
  it('formats values and ranges', () => {
    expect(fmtSi(0.0094, 'A')).toBe('9.4 mA')
    expect(fmtSi(4700, 'Ω')).toBe('4.7 kΩ')
    expect(fmtQuantity('frequency', 0.998)).toBe('0.998 Hz')
    expect(fmtQuantity('frequency', 1500)).toBe('1.500 kHz') // H3 fmtFreq, as the instruments print it (LS-10)
    expect(fmtQuantity('duty', 0.625)).toBe('62.5 %')
    expect(fmtRange('duty', 45, 55)).toBe('45 % – 55 %')
    expect(fmtRange('led-brightness', 0.5, 1)).toBe('50 % – 100 %')
    __setLangForTests('zh-TW')
    expect(checkLabel({ kind: 'erc-clean' })).toBe('電氣規則檢查（ERC）沒有錯誤')
    expect(checkLabel({ kind: 'has-part', type: 'resistor', label: '自訂標籤' })).toBe('自訂標籤')
  })

  it('resolves pins, holes, terminals and silkscreen labels', () => {
    const layout = blinkLayout()
    expect(resolvePinRef(layout, { hole: 'a50' })).toMatchObject({ ok: true, endpoint: 'a50', hole: true })
    expect(resolvePinRef(layout, { terminal: 'PS1:+' })).toMatchObject({ ok: true, endpoint: 'PS1:+', hole: false })
    const pa5 = resolvePinRef(layout, { component: 'U1', pin: 'PA5' })
    expect(pa5).toMatchObject({ ok: true, hole: true, mcuPin: { componentId: 'U1', pin: 'PA5' } })
    expect(resolvePinRef(layout, { component: 'U1', pin: 'pa5' })).toEqual(pa5)
    expect(resolvePinRef(layout, { component: 'D1', pin: 'anode' })).toMatchObject({ ok: true, endpoint: 'b50' })
    expect(resolvePinRef(layout, { component: 'D9', pin: 'anode' })).toMatchObject({ ok: false, reason: 'no-component' })
    expect(resolvePinRef(layout, { component: 'D1', pin: 'gate' })).toMatchObject({ ok: false, reason: 'no-pin' })
    expect(resolvePinRef(layout, { hole: 'zz9' })).toMatchObject({ ok: false, reason: 'bad-hole' })
  })
})

describe('the lesson Markdown subset', () => {
  it('parses paragraphs, line breaks, bullets, bold and code', () => {
    const md = '第一段 **粗體** 與 `PA5`\n同一段第二行\n\n- 項目一\n- 項目 **二**\n  續行\n\n結尾'
    const blocks = parseMarkdown(md)
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'ul', 'p'])
    expect(blocks[0]).toMatchObject({ kind: 'p', lines: [[{ text: '第一段 ' }, { kind: 'bold' }, { text: ' 與 ' }, { kind: 'code', text: 'PA5' }], [{ text: '同一段第二行' }]] })
    expect(blocks[1].kind === 'ul' && blocks[1].items.length).toBe(2)
    expect(markdownPlainText(md)).toBe('第一段 粗體 與 PA5 同一段第二行 • 項目一 • 項目 二 續行 結尾')
  })

  it('never interprets markup — HTML and unclosed spans stay literal', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([{ kind: 'text', text: '<img src=x onerror=alert(1)>' }])
    expect(parseInline('**未閉合 `也未閉合')).toEqual([{ kind: 'text', text: '**未閉合 `也未閉合' }])
    expect(parseInline('`**不是粗體**`')).toEqual([{ kind: 'code', text: '**不是粗體**' }])
    expect(parseMarkdown('# 標題\n1. 編號')).toEqual([{ kind: 'p', lines: [[{ kind: 'text', text: '# 標題' }], [{ kind: 'text', text: '1. 編號' }]] }])
  })
})
