/**
 * Advanced (進階) lessons, src/lessons/advanced/*.lesson.ts — every lesson is
 * checked through the REAL lesson evaluator (src/lessons/engine/evaluate.ts:
 * netlist, coordinator with the bundled firmware/dist images, ERC, firmware
 * contracts) and every behaviour a lesson text states is reproduced on the
 * simulator with the same firmware:
 *
 *  - registry and content rules (order a1 … a8, 3–8 steps, objectives,
 *    mistakes, expected results with numbers, zh-TW text without English
 *    outside `code` spans, pin names in the app's one form);
 *  - the solution passes every acceptance check and every step check, the
 *    start circuit fails at least one acceptance check;
 *  - the documented behaviour really happens (UART lines, timing, logic
 *    edges, motor / encoder telemetry), including the experiments the steps
 *    ask for (jumpers, runtime params, mistake firmware);
 *  - every common mistake with `match` data is the 「最可能的原因」 of its own
 *    reproduction (src/lessons/diagnose.ts matchMistake over the evaluated
 *    acceptance results and the ERC findings — static and live — exactly as
 *    src/ui/lessons/CheckResults.tsx computes them).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import '../../src/mcu/all'
import { LESSONS, lessonById } from '../../src/lessons'
import type { Lesson, LessonCheck, LessonCircuit } from '../../src/lessons/types'
import type { CircuitLayout, ParamValue } from '../../src/model/types'
import {
  evaluateChecks,
  evaluateLesson,
  lessonCircuitInput,
  type EvalInput,
  type EvaluatedCheck,
} from '../../src/lessons/engine/evaluate'
import { matchMistake } from '../../src/lessons/diagnose'
import { stepActions } from '../../src/lessons/step-actions'
import { validateLayout } from '../../src/model/validate'
import { CATALOG } from '../../src/model/catalog'
import { loadFirmwareFile } from '../../src/mcu/loader'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import { runErc, type ErcFinding } from '../../src/sim/erc'
import { eraseW25q } from '../../src/sim/models/comm-flash'
import { englishLeft } from '../i18n/zh-check'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '../../firmware/dist')
const LONG = { timeout: 600_000 }

const advanced = LESSONS.filter((l) => l.level === 'advanced')

function lesson(id: string): Lesson {
  const l = lessonById(id)
  if (!l) throw new Error(`no lesson ${id}`)
  return l
}

function explain(results: EvaluatedCheck[]): string {
  const lines: string[] = []
  const walk = (r: EvaluatedCheck, depth: number) => {
    lines.push(`${'  '.repeat(depth)}${r.pass ? 'PASS' : 'FAIL'} [${r.key} ${r.kind}] ${r.label}: ${r.detail}${r.technical ? ` | ${r.technical.join(' | ')}` : ''}`)
    for (const c of r.children ?? []) walk(c, depth + 1)
  }
  results.forEach((r) => walk(r, 0))
  return lines.join('\n')
}

function allText(l: Lesson): string[] {
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
  ]
}

function labels(l: Lesson): string[] {
  const out: string[] = []
  const walk = (c: LessonCheck) => {
    if (c.label) out.push(c.label)
    if (c.kind === 'all') c.checks.forEach(walk)
  }
  l.acceptance.forEach(walk)
  l.steps.forEach((s) => s.check && walk(s.check))
  return out
}

/** prose without code spans, quoted literals, lesson firmware names and pointer variants */
function prose(s: string): string {
  return s
    .replace(/`[^`]*`/g, ' ')
    .replace(/「[^」]*」/g, ' ')
    .replace(/\blesson-[a-z0-9-]+\b/g, ' ')
    .replace(/\{滑鼠：|｜觸控：|\}/g, ' ')
}

const MAINLAND = [
  '程序', '文件', '界面', '內存', '默認', '寄存器', '串口', '波特率', '引腳', '管腳', '芯片', '模塊', '函數', '信號',
  '數據', '調試', '字節', '比特', '運行', '加載', '硬件', '軟件', '屏幕', '時鐘', '定時器', '電平', '上升沿', '下降沿',
  '占空比', '佔空比', '分頻', '採樣', '分辨率', '消抖', '輪詢', '緩沖', '地址', '萬用表', '電位器', '晶振', '激活',
  '網絡', '打印', '菜單', '鼠標', '光標', '兼容', '計算機', '單片機',
]

// ------------------------------------------------------------- registry

describe('advanced lessons: registry and content', () => {
  it('the eight advanced lessons are registered in order', () => {
    expect(advanced.map((l) => l.id)).toEqual([
      'a1-mpu6050',
      'a2-ssd1306',
      'a3-uart-dma',
      'a4-freertos',
      'a5-stepper-a4988',
      'a6-rotary-encoder',
      'a7-i2c-multi',
      'a8-spi-flash',
    ])
    expect(advanced.map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    // every advanced lesson runs real firmware on the Blue Pill
    for (const l of advanced) expect(Object.keys(l.solution.firmware ?? {}), l.id).toEqual(['U1'])
  })

  for (const l of advanced) {
    describe(l.id, () => {
      it('layouts are valid, every part and firmware is listed in requires', () => {
        for (const [what, c] of [
          ['start', l.start],
          ['solution', l.solution],
        ] as const) {
          const v = validateLayout(c.layout)
          expect(v.errors, `${l.id} ${what}`).toEqual([])
          for (const comp of c.layout.components) expect(l.requires?.parts ?? [], `${comp.type} in requires.parts`).toContain(comp.type)
          for (const p of Object.values(c.firmware ?? {})) expect(l.requires?.firmware ?? [], `${p} in requires.firmware`).toContain(p)
        }
        for (const p of l.requires?.parts ?? []) expect(CATALOG[p], p).toBeDefined()
        expect(l.requires?.instrument).toBe('uart')
      })

      it('content follows the lesson rules (zh-TW, 3–8 steps, mistakes with match data, numbers in the expected results)', () => {
        expect(l.steps.length).toBeGreaterThanOrEqual(3)
        expect(l.steps.length).toBeLessThanOrEqual(8)
        expect(l.objectives.length).toBeGreaterThanOrEqual(3)
        expect(l.mistakes.length).toBeGreaterThanOrEqual(3)
        expect(l.expected.length).toBeGreaterThanOrEqual(3)
        expect(l.acceptance.length).toBeGreaterThanOrEqual(3)
        for (const e of l.expected) expect(/\d/.test(e), e).toBe(true)
        // most mistakes are diagnosable: their match data points at acceptance indices that exist
        const matched = l.mistakes.filter((m) => m.match)
        expect(matched.length, `${l.id}: mistakes with match data`).toBeGreaterThanOrEqual(3)
        for (const m of matched) {
          for (const i of [...(m.match?.checks ?? []), ...(m.match?.passes ?? [])]) {
            expect(i, `${l.id} match index`).toBeLessThan(l.acceptance.length)
          }
        }
        for (const field of [...allText(l), ...labels(l)]) {
          for (const w of MAINLAND) expect(field.includes(w), `mainland term "${w}" in ${l.id}: ${field.slice(0, 60)}`).toBe(false)
          expect(englishLeft(prose(field)), field.slice(0, 80)).toEqual([])
          // the app's pin names (UX H1): never a raw catalog key or "U1.PA5" / "PS1:+"
          expect(/\b(3V3|GND)_\d\b|\bU\d+\.P[A-E]\d+\b|\b[A-Z]+\d+:[+-]/.test(field.replace(/"[^"\n]*"/g, '')), field.slice(0, 80)).toBe(false)
        }
      })

      it('every step offers a one-click action or an automatic check, and highlights what it talks about', () => {
        l.steps.forEach((s, i) => {
          expect(stepActions(l, i).length > 0 || !!s.check, `${l.id} ${s.id}`).toBe(true)
          expect((s.highlight?.components?.length ?? 0) + (s.highlight?.holes?.length ?? 0), `${l.id} ${s.id} highlight`).toBeGreaterThan(0)
        })
      })

      it('the solution passes every acceptance check', LONG, async () => {
        const ev = await evaluateLesson(l, l.solution)
        expect(ev.pass, explain(ev.results)).toBe(true)
      })

      it('the start circuit fails at least one acceptance check', LONG, async () => {
        const ev = await evaluateLesson(l, l.start)
        expect(ev.pass, explain(ev.results)).toBe(false)
        expect(ev.results.filter((r) => r.error).map((r) => r.label)).toEqual([])
      })

      it('every step check passes on the solution', LONG, async () => {
        const checks = l.steps.map((s) => s.check).filter((c): c is LessonCheck => !!c)
        const res = await evaluateChecks(await lessonCircuitInput(l.solution), checks)
        expect(
          res.every((r) => r.pass),
          explain(res),
        ).toBe(true)
      })
    })
  }
})

// ------------------------------------------------------------- helpers

const images = new Map<string, ReturnType<typeof loadImage>>()
function loadImage(name: string) {
  const res = loadFirmwareFile(`${name}.elf`, new Uint8Array(readFileSync(join(DIST, `${name}.elf`))))
  if (!res.ok) throw new Error(`${name}: ${res.error}`)
  return res.image
}
function image(name: string) {
  let img = images.get(name)
  if (!img) {
    img = loadImage(name)
    images.set(name, img)
  }
  return img
}

interface Ev {
  at: number
  component: string
  key: string
  value: ParamValue
}

interface SimRun {
  lines: { t: number; text: string }[]
  co: SimulationCoordinator
  /** rising edges of a logic channel inside [t0, t1] */
  rises(label: string, t0: number, t1: number): number
  text(): string
}

/**
 * Run `layout` with `fw` on U1 for `seconds`; runtime param `events` are
 * applied at their virtual time (what the inspector does while running);
 * `logic` pins of U1 are recorded.
 */
function sim(layout: CircuitLayout, fw: string, seconds: number, events: Ev[] = [], logic: string[] = []): SimRun {
  const co = new SimulationCoordinator()
  co.load(layout, 1)
  co.setFirmware('U1', image(fw))
  if (logic.length) {
    co.setLogicChannels(logic.map((pin, index) => ({ index, label: pin, source: { kind: 'mcu-pin', componentId: 'U1', pin } })))
  }
  const lines: { t: number; text: string }[] = []
  let buf = ''
  co.addUartListener((componentId, port, byte, t) => {
    if (componentId !== 'U1' || port !== 'USART1') return
    if (byte === 0x0d) return
    if (byte === 0x0a) {
      lines.push({ t, text: buf })
      buf = ''
    } else buf += String.fromCharCode(byte)
  })
  const queue = [...events].sort((a, b) => a.at - b.at)
  while (co.time < seconds - 1e-12) {
    while (queue.length && queue[0].at <= co.time + 1e-12) {
      const e = queue.shift()!
      co.setRuntimeParam(e.component, e.key, e.value)
    }
    const next = queue.length ? Math.min(queue[0].at, seconds) : seconds
    co.advance(Math.max(1e-6, Math.min(0.005, next - co.time)))
  }
  return {
    lines,
    co,
    rises(label, t0, t1) {
      const q = co.query({ kind: 'logic', t0: 0, t1: co.time })
      if (q.kind !== 'logic') throw new Error('logic query')
      const tr = q.capture.traces.find((x) => x.label === label)
      if (!tr) throw new Error(`no trace ${label}`)
      let n = 0
      for (let i = 0; i < tr.times.length; i++) if (tr.levels[i] === 1 && tr.times[i] >= t0 && tr.times[i] <= t1) n++
      return n
    },
    text: () => lines.map((l) => l.text).join('\n'),
  }
}

function lineAt(run: SimRun, re: RegExp): number {
  const l = run.lines.find((x) => re.test(x.text))
  if (!l) throw new Error(`no UART line ${re}:\n${run.text()}`)
  return l.t
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** The wire with endpoint `keep`: move its other end to `other`. */
function moveWire(l: CircuitLayout, keep: string, other: string): void {
  const w = l.wires.find((x) => x.from === keep || x.to === keep)
  if (!w) throw new Error(`no wire at ${keep}`)
  if (w.from === keep) w.to = other
  else w.from = other
}

function dropWire(l: CircuitLayout, end: string): void {
  const n = l.wires.length
  l.wires = l.wires.filter((w) => w.from !== end && w.to !== end)
  if (l.wires.length !== n - 1) throw new Error(`expected one wire at ${end}`)
}

function addWire(l: CircuitLayout, from: string, to: string): void {
  const used = new Set(l.wires.map((w) => Number(w.id.slice(1))))
  let n = 1
  while (used.has(n)) n++
  l.wires.push({ id: `W${n}`, from, to })
}

function setParam(l: CircuitLayout, id: string, key: string, value: ParamValue): void {
  const c = l.components.find((x) => x.id === id)
  if (!c) throw new Error(`no part ${id}`)
  c.params = { ...(c.params ?? {}), [key]: value }
}

/** The solution of `l` changed by `mutate`, with `firmware` (default: the solution's) on U1. */
function variant(l: Lesson, mutate: (layout: CircuitLayout) => void, firmware?: string | null): LessonCircuit {
  const layout = clone(l.solution.layout)
  mutate(layout)
  const v = validateLayout(layout)
  if (!v.ok) throw new Error(`${l.id} variant invalid: ${v.errors.join('; ')}`)
  const fw = firmware === undefined ? l.solution.firmware?.U1 : firmware
  return fw ? { layout, firmware: { U1: fw } } : { layout }
}

/** ERC findings while running (a fresh world, 0.3 s), as CheckResults computes them for a running circuit. */
function liveFindings(input: EvalInput, layout: CircuitLayout): ErcFinding[] {
  const co = new SimulationCoordinator()
  co.load(layout, 1)
  const fw = input.firmware.U1
  if (fw) {
    const res = loadFirmwareFile(fw.name, fw.bytes)
    if (res.ok) co.setFirmware('U1', res.image)
  }
  while (co.time < 0.3) co.advance(0.02)
  const f = runErc(layout, { telemetry: co.telemetry(), issues: co.issues() })
  co.dispose()
  return f
}

/**
 * The acceptance run of `circuit` and the mistake CheckResults would show as
 * 「最可能的原因」, with the ERC of a stopped circuit and of a running one.
 * The firmware contract does not depend on the circuit: it is replaced by a
 * check with the same verdict (it passes in every lesson) to keep this fast.
 */
async function diagnose(l: Lesson, circuit: LessonCircuit) {
  const checks = l.acceptance.map((c) => (c.kind === 'firmware-checks' ? ({ kind: 'has-part', type: 'stm32_bluepill' } as LessonCheck) : c))
  const input = await lessonCircuitInput(circuit)
  const results = await evaluateChecks(input, checks)
  const stopped = matchMistake(l, results, runErc(circuit.layout))
  const running = matchMistake(l, results, liveFindings(input, circuit.layout))
  return { results, stopped, running }
}

async function expectMistake(l: Lesson, circuit: LessonCircuit, index: number): Promise<void> {
  const d = await diagnose(l, circuit)
  const want = l.mistakes[index]
  const name = (m: unknown) => (m ? l.mistakes.indexOf(m as never) : null)
  expect(d.results.every((r) => r.pass), `${l.id}: the reproduction must fail\n${explain(d.results)}`).toBe(false)
  expect(name(d.stopped), `${l.id} mistake ${index} (stopped)\n${explain(d.results)}`).toBe(index)
  expect(name(d.running), `${l.id} mistake ${index} (running)\n${explain(d.results)}`).toBe(index)
  expect(want.match).toBeDefined()
}

// ------------------------------------------------- documented behaviour

describe('advanced lessons: the documented behaviour happens on the simulator', () => {
  it('a3: 40 B by circular DMA cost 4 interrupts (4 PB0 pulses), one RXNE interrupt per byte costs 41; DMA normal mode receives only msg #1', LONG, () => {
    const l = lesson('a3-uart-dma')
    const dma = sim(l.solution.layout, 'lesson-a3-uart-dma', 0.6, [], ['PA10', 'PB0'])
    expect(dma.lines.map((x) => x.text).slice(0, 5)).toEqual([
      'UART DMA lesson a3: USART2 TX (PA2) -> USART1 RX (PA10), 115200 8N1',
      'RX: DMA1 ch5 circular, 32 B ring + IDLE line detection',
      'msg #1: 5 B [idle] irq=1 isr=12.2 us: hello',
      'msg #2: 23 B [ht idle] irq=2 isr=18.7 us: T=23.5C H=45% P=1013hPa',
      'msg #3: 40 B [tc ht tc idle] irq=4 isr=29.3 us: 0123456789abcdefghijklmnopqrstuvwxyzABCD',
    ])
    // msg #3 is sent at 500 ms after boot (≈ 0.507 s): 40 frames of 86.8 µs on PA10
    const t3 = lineAt(dma, /^msg #3/)
    expect(t3).toBeGreaterThan(0.5)
    expect(t3).toBeLessThan(0.53)
    expect(dma.rises('PB0', 0.49, t3 - 0.006)).toBe(4)

    const rxne = sim(
      variant(l, (x) => addWire(x, 'j11', 'bot-7')).layout,
      'lesson-a3-uart-dma',
      0.6,
      [],
      ['PB0'],
    )
    expect(rxne.text()).toContain('PB13 low: RX by interrupt, RXNE for every byte + IDLE')
    expect(rxne.text()).toContain('msg #3: 40 B [idle] irq=41 isr=73.0 us: 0123456789abcdefghijklmnopqrstuvwxyzABCD')
    const r3 = lineAt(rxne, /^msg #3/)
    expect(rxne.rises('PB0', 0.49, r3 - 0.006)).toBe(41)

    const normal = sim(variant(l, (x) => addWire(x, 'j10', 'bot-6')).layout, 'lesson-a3-uart-dma', 0.75)
    expect(normal.text()).toContain('PB12 low: RX DMA in NORMAL mode, not re-armed after the first message')
    const got = normal.lines.filter((x) => x.text.startsWith('msg #')).map((x) => x.text)
    expect(got.length, got.join(' | ')).toBe(1)
    expect(got[0]).toMatch(/^msg #1: 5 B \[idle\] irq=1 isr=\d+\.\d us: hello$/)
  })

  it('a4: tasks in priority order, 38 context switches a second, the button ISR; the hog task starves everything; a bad ISR priority asserts', LONG, () => {
    const l = lesson('a4-freertos')
    const ok = sim(l.solution.layout, 'lesson-a4-freertos', 1.1, [
      { at: 0.6, component: 'SW1', key: 'pressed', value: true },
      { at: 0.7, component: 'SW1', key: 'pressed', value: false },
    ], ['PA5'])
    const text = ok.lines.map((x) => x.text)
    expect(text.slice(0, 3)).toEqual([
      'FreeRTOS V11.1.0 on STM32F103C8, 72 MHz, tick 1000 Hz',
      'tasks: fast prio 3 every 100 ms, blink prio 2 every 250 ms, logger prio 1; queue 8 x 8 B',
      'heap free 5192 B, starting the scheduler',
    ])
    // tick 500: the higher-priority task first
    expect(text.indexOf('[   500] fast  #5') + 1).toBe(text.indexOf('[   500] blink #2 LED off'))
    expect(text.some((x) => /^\[ +\d+\] button #1 \(EXTI ISR -> queue\)$/.test(x))).toBe(true)
    expect(lineAt(ok, /^\[   250\] blink #1 LED on$/)).toBeCloseTo(0.2725, 2)
    // the first PA5 edge at tick 250 (scheduler start ≈ 22 ms after power-on)
    expect(ok.rises('PA5', 0, 0.3)).toBe(1)

    const quiet = sim(l.solution.layout, 'lesson-a4-freertos', 1.05)
    expect(quiet.text()).toMatch(/\[  1000\] stats: 38 context switches, idle 9\d\.\d%, queue peak 2\/8, stack free fast \d+ blink \d+ logger \d+ words/)

    const hog = sim(variant(l, (x) => addWire(x, 'j11', 'bot-8')).layout, 'lesson-a4-freertos', 1.8, [], ['PA5'])
    expect(hog.text()).toContain('PB13 low: task hog prio 4 busy-loops from 1000 ms on')
    expect(hog.lines[hog.lines.length - 1].text).toBe('[   900] fast  #9')
    expect(hog.rises('PA5', 0.8, 1.8)).toBe(0)

    const bad = sim(variant(l, (x) => addWire(x, 'j12', 'bot-9')).layout, 'lesson-a4-freertos', 0.8, [
      { at: 0.6, component: 'SW1', key: 'pressed', value: true },
    ])
    expect(bad.text()).toContain('PB14 low: EXTI15_10 at NVIC priority 2 (above the syscall limit 5)')
    expect(bad.lines[bad.lines.length - 1].text).toBe('configASSERT failed: port.c:805')
  })

  it('a5: one turn at 1/8 microstepping; VREF 0.08 V or a 15 N·cm load lose steps while the firmware still reports 1600/8', LONG, () => {
    const l = lesson('a5-stepper-a4988')
    const pos = (run: SimRun) => (run.co.telemetry().components.M1?.values as Record<string, number>).position
    const ok = sim(l.solution.layout, 'hal-stepper-a4988', 1.2)
    expect(ok.text()).toContain('done, position 1600/8 full steps')
    expect(lineAt(ok, /^done, position 1600\/8/)).toBeCloseTo(1.156, 2)
    expect(pos(ok)).toBeGreaterThan(200.3)
    expect(pos(ok)).toBeLessThan(200.7)

    const low = sim(variant(l, (x) => setParam(x, 'DRV1', 'vref', 0.08)).layout, 'hal-stepper-a4988', 1.2)
    expect(low.text()).toContain('done, position 1600/8 full steps')
    expect(pos(low)).toBeGreaterThan(165)
    expect(pos(low)).toBeLessThan(180)

    const load = sim(variant(l, (x) => setParam(x, 'M1', 'loadTorque', 15)).layout, 'hal-stepper-a4988', 1.2)
    expect(load.text()).toContain('done, position 1600/8 full steps')
    expect(Math.abs(pos(load))).toBeLessThan(5)
  })

  it('a6: the UART count follows the knob turned at runtime; swapped CLK / DT count backwards; the PB13 jumper prints 4 raw counts per detent', LONG, () => {
    const l = lesson('a6-rotary-encoder')
    const turns: Ev[] = [
      { at: 0.1, component: 'ENC1', key: 'position', value: 5 },
      { at: 0.5, component: 'ENC1', key: 'position', value: 2 },
      { at: 0.8, component: 'ENC1', key: 'pressed', value: true },
      { at: 0.9, component: 'ENC1', key: 'pressed', value: false },
    ]
    const ok = sim(l.solution.layout, 'lesson-a6-encoder', 1.0, turns)
    expect(ok.lines.map((x) => x.text)).toEqual([
      'KY-040 lesson a6: TIM4 encoder CLK PB6 / DT PB7, filter 15, SW PB12',
      'pos=0',
      'pos=1',
      'pos=2',
      'pos=3',
      'pos=4',
      'pos=5',
      'pos=4',
      'pos=3',
      'pos=2',
      'SW pressed',
      'SW released',
    ])
    // 20 detents/s: one detent every 50 ms
    expect(lineAt(ok, /^pos=2$/) - lineAt(ok, /^pos=1$/)).toBeCloseTo(0.05, 3)
    expect(lineAt(ok, /^SW pressed$/) - 0.8).toBeGreaterThan(0.019)
    expect(lineAt(ok, /^SW pressed$/) - 0.8).toBeLessThan(0.023)

    const swapped = variant(l, (x) => {
      moveWire(x, 'j40', 'j24')
      moveWire(x, 'j41', 'j23')
    })
    const back = sim(swapped.layout, 'lesson-a6-encoder', 0.5, turns.slice(0, 1))
    expect(back.lines.map((x) => x.text).slice(1)).toEqual(['pos=0', 'pos=-1', 'pos=-2', 'pos=-3', 'pos=-4', 'pos=-5'])

    const raw = sim(variant(l, (x) => addWire(x, 'j11', 'bot-8')).layout, 'lesson-a6-encoder', 0.2, [
      { at: 0.1, component: 'ENC1', key: 'position', value: 1 },
    ])
    expect(raw.lines.map((x) => x.text).slice(1)).toEqual([
      'PB13 low: raw TIM4 count on every edge (4 per detent)',
      'pos=0',
      'cnt=1',
      'cnt=2',
      'cnt=3',
      'cnt=4',
      'pos=1',
    ])
  })

  it('a7: the AT24C02 alone leaves the bus busy; wiring the modules while running brings it back; AD0 high moves the MPU-6050 to 0x69', LONG, () => {
    const l = lesson('a7-i2c-multi')
    const co = new SimulationCoordinator()
    co.load(l.start.layout, 1)
    co.setFirmware('U1', image('lesson-a7-i2c-multi'))
    const lines: string[] = []
    let buf = ''
    co.addUartListener((_c, _p, byte) => {
      if (byte === 0x0a) {
        lines.push(buf.replace(/\r$/, ''))
        buf = ''
      } else buf += String.fromCharCode(byte)
    })
    const until = (s: number) => {
      while (co.time < s) co.advance(0.01)
    }
    until(1.2)
    expect(lines).toEqual(['I2C1 multi-device bus, lesson a7 (PB6 SCL / PB7 SDA, 100 kHz)', 'bus busy: SDA/SCL stuck low (no pull-up on the bus?)'])
    expect(runErc(l.start.layout, { telemetry: co.telemetry(), issues: co.issues() }).some((f) => f.rule === 'i2c-pullup' && f.level === 'error')).toBe(true)
    // the solution's wires, without a reset (hot rewire)
    co.load(l.solution.layout, 2)
    until(2.2)
    co.dispose()
    expect(lines.slice(2, 8)).toEqual([
      'scan: 0x50 0x68 0x76 (3 devices)',
      'AT24C02 @0x50: page write 8 B, ready after 45 polls, read back ok',
      'MPU-6050 @0x68: WHO_AM_I=0x68, awake',
      'BME280 @0x76: id=0x60, calibration read',
      'all 3 devices ok',
      'read: ax=0 ay=0 az=16384 | T=25.00 C P=1013.24 hPa H=49.99 %',
    ])

    const ad0 = sim(variant(l, (x) => addWire(x, 'j48', 'top+39')).layout, 'lesson-a7-i2c-multi', 0.2)
    expect(ad0.text()).toContain('scan: 0x50 0x69 0x76 (3 devices)')
    expect(ad0.text()).toContain('MPU-6050 @0x68: no ACK (0x69 answers: AD0 is high)')
    expect(ad0.text()).toContain('2 of 3 devices ok')
  })

  it('a8: erase busy 46 ms, the data survives an MCU reset; without BUSY polling the program is lost (reads FF)', LONG, () => {
    const l = lesson('a8-spi-flash')
    // the flash keeps its contents per component id for the session (the evaluator runs above wrote it): a new part
    eraseW25q('FL1')
    const co = new SimulationCoordinator()
    co.load(l.solution.layout, 1)
    co.setFirmware('U1', image('hal-w25q'))
    const lines: string[] = []
    let buf = ''
    co.addUartListener((_c, _p, byte) => {
      if (byte === 0x0a) {
        lines.push(buf.replace(/\r$/, ''))
        buf = ''
      } else buf += String.fromCharCode(byte)
    })
    const until = (s: number) => {
      while (co.time < s) co.advance(0.005)
    }
    until(0.15)
    expect(lines).toEqual([
      'W25Q32 test (SPI1 9 MHz mode 0, CS PA4)',
      'JEDEC ID EF 40 16',
      'SR1 0x00',
      'before: FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF',
      'sector erase: busy 46 ms',
      'page program 64 bytes: busy for 39 status reads',
      'read back ok',
      'w25q ok',
    ])
    co.mcuReset('U1')
    until(0.3)
    expect(lines[11]).toBe('before: 01 04 07 0A 0D 10 13 16 19 1C 1F 22 25 28 2B 2E')
    co.dispose()

    const nobusy = sim(l.solution.layout, 'lesson-a8-nobusy', 0.15)
    expect(nobusy.lines.map((x) => x.text).slice(4)).toEqual([
      'sector erase: sent, BUSY not polled',
      'page program 64 bytes: sent, BUSY not polled',
      'mismatch at 0x001000: wrote 01 read FF',
      'w25q FAILED',
    ])
  })
})

// ------------------------------------------- 最可能的原因 of each mistake

describe('advanced lessons: each common mistake is the most likely cause of its own reproduction', () => {
  it('a1 MPU-6050', LONG, async () => {
    const l = lesson('a1-mpu6050')
    await expectMistake(l, variant(l, (x) => (moveWire(x, 'j42', 'j24'), moveWire(x, 'j43', 'j23'))), 0)
    await expectMistake(l, variant(l, (x) => addWire(x, 'j10', 'bot-6')), 1)
    await expectMistake(l, variant(l, (x) => addWire(x, 'j46', 'top+37')), 2)
    await expectMistake(l, variant(l, (x) => dropWire(x, 'j40')), 3)
    await expectMistake(l, l.start, 3)
  })

  it('a2 SSD1306', LONG, async () => {
    const l = lesson('a2-ssd1306')
    await expectMistake(l, variant(l, (x) => addWire(x, 'j10', 'bot-6')), 0)
    await expectMistake(l, variant(l, (x) => (moveWire(x, 'g42', 'j24'), moveWire(x, 'g43', 'j23'))), 1)
    await expectMistake(l, variant(l, (x) => setParam(x, 'OLED', 'address', '0x3D')), 2)
  })

  it('a3 UART DMA', LONG, async () => {
    const l = lesson('a3-uart-dma')
    await expectMistake(l, l.start, 0)
    await expectMistake(l, variant(l, (x) => addWire(x, 'j10', 'bot-6')), 1)
    await expectMistake(l, variant(l, (x) => addWire(x, 'j11', 'bot-7')), 2)
  })

  it('a4 FreeRTOS', LONG, async () => {
    const l = lesson('a4-freertos')
    await expectMistake(l, variant(l, (x) => addWire(x, 'j11', 'bot-8')), 0)
    await expectMistake(l, variant(l, (x) => addWire(x, 'j12', 'bot-9')), 1)
    await expectMistake(l, l.start, 2)
    await expectMistake(l, variant(l, (x) => dropWire(x, 'j47')), 3)
  })

  it('a5 A4988', LONG, async () => {
    const l = lesson('a5-stepper-a4988')
    await expectMistake(l, l.start, 0)
    await expectMistake(l, variant(l, (x) => (moveWire(x, 'j46', 'a17'), moveWire(x, 'j47', 'a25'))), 0)
    await expectMistake(l, variant(l, (x) => dropWire(x, 'i44')), 1)
    await expectMistake(l, variant(l, (x) => setParam(x, 'DRV1', 'vref', 0.08)), 2)
    await expectMistake(l, variant(l, (x) => (moveWire(x, 'a45', 'M1:B+'), moveWire(x, 'a43', 'M1:A-'))), 3)
    await expectMistake(l, variant(l, (x) => dropWire(x, 'a40')), 4)
  })

  it('a6 KY-040', LONG, async () => {
    const l = lesson('a6-rotary-encoder')
    await expectMistake(l, variant(l, (x) => (moveWire(x, 'j40', 'j24'), moveWire(x, 'j41', 'j23'))), 0)
    await expectMistake(l, variant(l, (x) => moveWire(x, 'j40', 'j25')), 1)
    await expectMistake(l, variant(l, (x) => dropWire(x, 'j43')), 2)
    await expectMistake(l, variant(l, (x) => addWire(x, 'j11', 'bot-8')), 3)
    await expectMistake(l, variant(l, (x) => dropWire(x, 'j42')), 4)
    await expectMistake(l, l.start, 5)
  })

  it('a7 I²C multi-device', LONG, async () => {
    const l = lesson('a7-i2c-multi')
    await expectMistake(l, l.start, 0)
    await expectMistake(l, variant(l, (x) => dropWire(x, 'j42')), 1)
    await expectMistake(l, variant(l, (x) => (moveWire(x, 'j44', 'b36'), moveWire(x, 'j45', 'b35'))), 2)
    await expectMistake(l, variant(l, (x) => addWire(x, 'j48', 'top+39')), 3)
    await expectMistake(l, variant(l, (x) => moveWire(x, 'j54', 'bot+43')), 4)
    await expectMistake(l, variant(l, (x) => (dropWire(x, 'j56'), dropWire(x, 'j57'))), 5)
  })

  it('a8 W25Q32', LONG, async () => {
    const l = lesson('a8-spi-flash')
    await expectMistake(l, variant(l, () => {}, 'lesson-a8-nobusy'), 0)
    await expectMistake(l, variant(l, (x) => (moveWire(x, 'd41', 'a18'), moveWire(x, 'd44', 'a19'))), 1)
    await expectMistake(l, variant(l, (x) => dropWire(x, 'd40')), 2)
    await expectMistake(l, variant(l, (x) => moveWire(x, 'a47', 'bot+38')), 3)
    await expectMistake(l, l.start, 5)
  })
})
