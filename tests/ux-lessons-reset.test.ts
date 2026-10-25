/**
 * Final round — the one-click 「重置 MCU」 / 「重置模擬」 step actions
 * (request 3 of the lessons-advanced engineer):
 *  - every jumper / reset experiment step offers the button its text names
 *    (a1, a2, a5 「重置模擬」; a3 ×2, a4 ×2, a6, a8, i7 ×2 「重置 MCU」), and
 *    no step sends the learner to the inspector or the More sheet any more;
 *  - resetTarget names the lesson's board; action keys are distinct; the
 *    jumper experiments (their wire is what their check forbids) are known;
 *  - the coach renders them with the other actions' button style, in the
 *    author's order (開始接線 → 重置 → ▶), the MCU reset with its Shift+F5;
 *  - resetFromStep runs the inspector's / More sheet's own actions: Reset
 *    MCU (noteMcuReset + lab.mcuReset) — refused with the reason when the
 *    board is missing or has no firmware — and Reset simulation
 *    (store.resetSim; a running simulation runs on from the new power-on);
 *  - the lessons-final dictionary is Taiwan-usage Chinese.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/mcu/all'
import { __setLangForTests } from '../src/i18n'
import lessonsFinal from '../src/i18n/zh-TW/lessons-final'
import { LESSONS, lessonById } from '../src/lessons'
import { actionKey, isJumperExperiment, resetTarget, stepActions } from '../src/lessons/step-actions'
import type { Lesson, LessonStepAction } from '../src/lessons/types'
import type { FirmwareRecord } from '../src/state/lab-types'
import { useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { dismissToast, getToasts } from '../src/ui/kit'
import { resetFromStep, runStepAction } from '../src/ui/lessons/actions'
import { StepBody } from '../src/ui/lessons/LessonBrowser'
import { MAINLAND_TERMS, englishLeft, halfWidthPunctuation } from './i18n/zh-check'

const lesson = (id: string): Lesson => lessonById(id)!
const lastToast = (): string => getToasts()[getToasts().length - 1]?.text ?? ''
type Reset = Extract<LessonStepAction, { kind: 'reset' }>
const MCU: Reset = { kind: 'reset', scope: 'mcu' }
const CIRCUIT: Reset = { kind: 'reset', scope: 'circuit' }

const store0 = useStore.getState()
const lab0 = useLab.getState()

beforeEach(() => {
  __setLangForTests('zh-TW')
  useStore.setState({ layout: { version: 1, components: [], wires: [] }, selection: [], mode: { kind: 'select' }, running: false })
  useLab.setState({ firmware: {}, mcus: {} })
  for (const x of getToasts()) dismissToast(x.id)
})

afterEach(() => {
  useStore.setState({ resetSim: store0.resetSim, startSim: store0.startSim, running: false })
  useLab.setState({ mcuReset: lab0.mcuReset, firmware: {} })
  __setLangForTests('zh-TW')
})

function resetSteps(): string[] {
  const out: string[] = []
  for (const l of LESSONS) {
    l.steps.forEach((s, i) => {
      for (const a of stepActions(l, i)) if (a.kind === 'reset') out.push(`${l.id}/${s.id}/${a.scope}`)
    })
  }
  return out.sort()
}

describe('which steps offer a reset (request 3)', () => {
  it('every reset experiment, with the scope its text names', () => {
    expect(resetSteps()).toEqual(
      [
        'a1-mpu6050/sleep-experiment/circuit',
        'a2-ssd1306/charge-pump/circuit',
        'a3-uart-dma/normal/mcu',
        'a3-uart-dma/rxne/mcu',
        'a4-freertos/bad-priority/mcu',
        'a4-freertos/hog/mcu',
        'a5-stepper-a4988/vref/circuit',
        'a6-rotary-encoder/raw/mcu',
        'a8-spi-flash/program/mcu',
        'i7-i2c/eeprom/mcu',
        'i7-i2c/scan/mcu',
      ].sort(),
    )
  })

  it('the step text names the button below; no step sends the learner to the inspector or 更多 any more', () => {
    for (const l of LESSONS) {
      l.steps.forEach((s, i) => {
        const where = `${l.id} ${s.id}`
        expect(s.body.includes('屬性面板的「重置 MCU」'), where).toBe(false)
        expect(s.body.includes('「更多」→「重置模擬」'), where).toBe(false)
        for (const a of stepActions(l, i)) {
          if (a.kind !== 'reset') continue
          expect(s.body.includes(a.scope === 'mcu' ? '「重置 MCU」' : '「重置模擬」'), where).toBe(true)
        }
        if (/下方的「重置 MCU」/.test(s.body)) expect(stepActions(l, i).some((a) => a.kind === 'reset' && a.scope === 'mcu'), where).toBe(true)
        if (/下方的「重置模擬」/.test(s.body)) expect(stepActions(l, i).some((a) => a.kind === 'reset' && a.scope === 'circuit'), where).toBe(true)
      })
    }
  })

  it('the jumper experiments — their wire is what their check forbids — re-check as 「尚未完成」 while the jumper is in', () => {
    const jumpers: string[] = []
    for (const l of LESSONS) l.steps.forEach((s, i) => isJumperExperiment(l, i) && jumpers.push(`${l.id}/${s.id}`))
    expect(jumpers.sort()).toEqual(
      [
        'a1-mpu6050/sleep-experiment',
        'a2-ssd1306/charge-pump',
        'a3-uart-dma/normal',
        'a3-uart-dma/rxne',
        'a4-freertos/bad-priority',
        'a4-freertos/hog',
        'a6-rotary-encoder/raw',
        // AD0 → 3.3 V moves the MPU-6050 to 0x69 (the firmware rescans every second: no reset button)
        'a7-i2c-multi/address',
      ].sort(),
    )
  })

  it('a jumper step reads 開始接線 → 重置 MCU → 拆掉這條線 → ▶ 執行模擬; resetTarget names the board; keys are distinct', () => {
    const a3 = lesson('a3-uart-dma')
    const i = a3.steps.findIndex((s) => s.id === 'rxne')
    // release QA LS-F7: the experiment's own 「拆掉 j11 → bot-7 這條線」 (shown only while the wire is in)
    expect(stepActions(a3, i).map(actionKey)).toEqual(['wire|j11>bot-7', 'reset|mcu|', 'unwire|j11>bot-7', 'run'])
    expect(resetTarget(a3, MCU)).toBe('U1')
    expect(resetTarget(a3, { ...MCU, component: 'U2' })).toBe('U2')
    expect(resetTarget(a3, CIRCUIT)).toBeNull()
    expect(new Set([actionKey(MCU), actionKey(CIRCUIT), actionKey({ ...MCU, component: 'U2' })]).size).toBe(3)
  })
})

describe('the coach row', () => {
  it('renders 「重置 MCU」 with the other actions’ button style, after the wire and before ▶, with its Shift+F5', () => {
    const a3 = lesson('a3-uart-dma')
    const i = a3.steps.findIndex((s) => s.id === 'rxne')
    const html = renderToStaticMarkup(createElement(StepBody, { lesson: a3, index: i, compact: true }))
    const row = html.slice(html.indexOf('lsn-actrow'))
    const wire = row.indexOf('開始接線（j11 → bot-7）')
    const reset = row.indexOf('>重置 MCU<')
    const run = row.indexOf('執行模擬')
    expect(wire).toBeGreaterThan(0)
    expect(reset).toBeGreaterThan(wire)
    expect(run).toBeGreaterThan(reset)
    // the same PressableButton as its neighbours: the first action filled, the rest tinted
    expect(row).toMatch(/class="lg-btn lg-btn-filled lg-btn-sm[^"]*"[^>]*>(?:(?!<\/button>).)*開始接線/)
    const button = /<button [^>]*>(?:(?!<\/button>).)*>重置 MCU<\/button>/.exec(row)?.[0] ?? ''
    expect(button).toContain('class="lg-btn lg-btn-tinted lg-btn-sm lg-pressable lg-hit lg-gel"')
    expect(button).toContain('title="讓 U1 的韌體從重置重新開始——電路的其他部分保持原狀（Shift+F5）"')
    expect(button).toContain('aria-keyshortcuts="Shift+F5"')
  })

  it('renders 「重置模擬」 in a1’s sleep experiment', () => {
    const a1 = lesson('a1-mpu6050')
    const i = a1.steps.findIndex((s) => s.id === 'sleep-experiment')
    const html = renderToStaticMarkup(createElement(StepBody, { lesson: a1, index: i, compact: true }))
    expect(html).toContain('title="整個電路從 0 秒重新上電（同「更多」→「重置模擬」）"')
    expect(html).toContain('>重置模擬<')
  })
})

describe('resetFromStep runs the inspector’s and the More sheet’s own resets', () => {
  const record = (name: string): FirmwareRecord => ({
    componentId: 'U1',
    name,
    format: 'elf',
    sha256: '0',
    size: 1,
    loadedAt: 0,
    warnings: [],
  })

  it('重置 MCU: refused with the reason without the board or its firmware, else lab.mcuReset on the lesson’s board', () => {
    const a3 = lesson('a3-uart-dma')
    const mcuReset = vi.fn()
    useLab.setState({ mcuReset })
    expect(resetFromStep(MCU, a3)).toBe(false)
    expect(lastToast()).toBe('電路中沒有 U1——請先按「載入起始電路」')
    useStore.setState({ layout: a3.start.layout })
    expect(resetFromStep(MCU, a3)).toBe(false)
    expect(lastToast()).toBe('U1 還沒有韌體')
    expect(mcuReset).not.toHaveBeenCalled()
    useLab.setState({ firmware: { U1: record('lesson-a3-uart-dma.elf') } })
    runStepAction(MCU, { lesson: a3, index: 0 })
    expect(mcuReset).toHaveBeenCalledTimes(1)
    expect(mcuReset).toHaveBeenCalledWith('U1')
    expect(lastToast()).toBe('已重置 U1')
  })

  it('重置模擬: store.resetSim; a running simulation runs on from the new power-on, a stopped one waits for ▶', () => {
    const a1 = lesson('a1-mpu6050')
    const resetSim = vi.fn(() => useStore.setState({ running: false }))
    const startSim = vi.fn(() => useStore.setState({ running: true }))
    useStore.setState({ resetSim, startSim, running: false })
    expect(resetFromStep(CIRCUIT, a1)).toBe(true)
    expect(resetSim).toHaveBeenCalledTimes(1)
    expect(startSim).not.toHaveBeenCalled()
    expect(lastToast()).toBe('模擬已重置')
    useStore.setState({ running: true })
    expect(resetFromStep(CIRCUIT, a1)).toBe(true)
    expect(resetSim).toHaveBeenCalledTimes(2)
    expect(startSim).toHaveBeenCalledTimes(1)
    expect(useStore.getState().running).toBe(true)
    expect(lastToast()).toBe('模擬已重置——整個電路重新上電')
  })
})

describe('the lessons-final dictionary', () => {
  it('is Taiwan-usage Traditional Chinese with intact placeholders', () => {
    const bad: string[] = []
    for (const [src, zh] of Object.entries(lessonsFinal)) {
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
      if (ph(src.split('|')[0]) !== ph(zh)) bad.push(`placeholders: ${src}`)
      const left = englishLeft(zh.replace(/\{\w+\}/g, ' '), ['MCU'])
      if (left.length) bad.push(`English left in ${src}: ${left.join(' ')}`)
      for (const term of MAINLAND_TERMS) if (zh.includes(term)) bad.push(`mainland term ${term}: ${src}`)
      if (halfWidthPunctuation(zh).length) bad.push(`half-width punctuation: ${zh}`)
    }
    expect(bad).toEqual([])
  })
})
