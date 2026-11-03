/**
 * vivid: success / damage feedback in the UI —
 *  - celebrate() (C3): the 「完成！」 badge for a lesson, the 「電路正常運作 ✓」
 *    toast for a circuit, one per kind within DEDUPE_MS, the 3D bus event,
 *    nothing but the 3D event in the English classic chrome;
 *  - sound (C3): default on, persisted 'bb.sound', silent before a gesture
 *    and in node (never throws);
 *  - success-watch: circuitRevision ignores knobs, circuitActivity sees only
 *    real activity (≥ 1 mA LED, not a power indicator; a turning motor; an
 *    MCU output that really toggled), the lesson watcher celebrates a passed
 *    acceptance run once — never a pass with the loaded answer (cheer);
 *  - problems: 「R2 燒斷了」 / 「C1 反接爆開」 rows with cause + fix (one row with
 *    the simulator's issue), a pin measured beyond its absolute maximum
 *    says the chip may be damaged and the simulation no longer guarantees it;
 *  - the zh-TW texts of all of the above.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import { hasMessageTranslation, tMessage } from '../src/i18n/messages'
import type { CircuitLayout, SimIssue, SimTelemetry } from '../src/model/types'
import { runErc } from '../src/sim/erc'
import { SimEngine } from '../src/sim/engine'
import { useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { __resetProblemsForTests, deriveProblems, type ProblemsInput } from '../src/ui/embedded/problems'
import { BADGE_MS, DEDUPE_MS, __resetCelebrationForTests, celebrate, useCelebration } from '../src/ui/fx/celebrate'
import { LS_SOUND, QUIET_GAIN, __resetSoundForTests, playCue, soundUnlocked, useSound } from '../src/ui/fx/sound'
import { circuitActivity, circuitRevision, startSuccessWatch, successWatchCount, LIT_LIGHT } from '../src/ui/fx/success-watch'
import { onSceneFx, type SceneFxEvent } from '../src/three/internal/fx/bus'
import { getToasts, dismissToast } from '../src/ui/kit/toasts'
import { useLessonUi } from '../src/ui/lessons/state'
import { useLessonProgress } from '../src/lessons/progress'
import { bluePill, part, tap, valid } from './erc/helpers'

beforeEach(() => {
  __setLangForTests('zh-TW')
  __resetCelebrationForTests()
  for (const x of getToasts()) dismissToast(x.id)
})
afterEach(() => {
  __resetProblemsForTests()
  useStore.setState({ running: false, simTime: 0 })
  useLab.setState({ firmware: {}, mcus: {} })
})

describe('vivid: celebrate (C3)', () => {
  it('lesson-pass: the 「完成！」 badge with what passed + the 3D burst; deduped', () => {
    const events: SceneFxEvent[] = []
    const off = onSceneFx((e) => events.push(e))
    celebrate('lesson-pass', { message: '「LED 與限流電阻」驗收 6 項全部通過' })
    const s = useCelebration.getState()
    expect(s.badge?.title).toBe('完成！')
    expect(s.badge?.message).toBe('「LED 與限流電阻」驗收 6 項全部通過')
    expect(s.count['lesson-pass']).toBe(1)
    expect(events).toEqual([{ type: 'celebrate', kind: 'lesson-pass', componentIds: [] }])
    celebrate('lesson-pass', { message: 'again' }) // the same pass reported twice
    expect(useCelebration.getState().count['lesson-pass']).toBe(1)
    expect(events).toHaveLength(1)
    expect(DEDUPE_MS).toBeGreaterThan(1000)
    expect(BADGE_MS).toBeGreaterThan(3000)
    off()
  })

  it('circuit-ok: the toast 「電路正常運作 ✓ · …」 and the sparkle on the active parts', () => {
    const events: SceneFxEvent[] = []
    const off = onSceneFx((e) => events.push(e))
    celebrate('circuit-ok', { componentIds: ['LED1', ''], message: 'LED1 亮了' })
    expect(useCelebration.getState().badge).toBeNull()
    expect(getToasts().map((x) => x.text)).toContain('電路正常運作 ✓ · LED1 亮了')
    expect(events).toEqual([{ type: 'celebrate', kind: 'circuit-ok', componentIds: ['LED1'] }])
    off()
  })

  it('the English classic chrome: the 3D event only — no badge, no toast', () => {
    __setLangForTests('en')
    const events: SceneFxEvent[] = []
    const off = onSceneFx((e) => events.push(e))
    celebrate('lesson-pass', { message: 'x' })
    celebrate('circuit-ok', { componentIds: ['LED1'] })
    expect(useCelebration.getState().badge).toBeNull()
    expect(getToasts()).toHaveLength(0)
    expect(events).toHaveLength(2)
    off()
  })
})

describe('vivid: sound (C3)', () => {
  it('default on, quiet, persisted as bb.sound = 0 when off; silent before a gesture / without audio', () => {
    expect(QUIET_GAIN).toBeLessThanOrEqual(0.2)
    expect(LS_SOUND).toBe('bb.sound')
    __resetSoundForTests()
    expect(soundUnlocked()).toBe(false)
    expect(() => playCue('success')).not.toThrow()
    __resetSoundForTests({ gestured: true })
    for (const cue of ['success', 'burn', 'place', 'delete', 'wire'] as const) expect(() => playCue(cue)).not.toThrow()
    expect(useSound.getState().enabled).toBe(true)
    useSound.getState().setEnabled(false)
    expect(useSound.getState().enabled).toBe(false)
    useSound.getState().setEnabled(true)
    expect(useSound.getState().enabled).toBe(true)
  })
})

describe('vivid: success watch', () => {
  const lay = (params: Record<string, number>): CircuitLayout => ({
    version: 1,
    components: [
      { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
      { id: 'POT1', type: 'potentiometer', holes: ['a10', 'a11', 'a12'], params },
    ],
    wires: [{ id: 'W1', from: 'PS1:+', to: 'top+0' }],
  })

  it('circuitRevision: a knob (runtime param) is not a change; a value, a wire or firmware is', () => {
    const base = circuitRevision(lay({ position: 0.2, resistance: 10000 }))
    expect(circuitRevision(lay({ position: 0.9, resistance: 10000 }))).toBe(base)
    expect(circuitRevision(lay({ position: 0.2, resistance: 1000 }))).not.toBe(base)
    const l2 = lay({ position: 0.2, resistance: 10000 })
    l2.wires.push({ id: 'W2', from: 'PS1:-', to: 'top-0' })
    expect(circuitRevision(l2)).not.toBe(base)
    expect(circuitRevision(lay({ position: 0.2, resistance: 10000 }), { POT1: { sha256: 'ab' } })).not.toBe(base)
  })

  it('circuitActivity: a ≥ 1 mA LED, a turning motor, a toggling MCU output — never a power indicator', () => {
    const l: CircuitLayout = {
      version: 1,
      components: [
        { id: 'LED1', type: 'led', holes: ['a10', 'a12'] },
        { id: 'LED2', type: 'led', holes: ['a20', 'a22'] },
        { id: 'U1', type: 'stm32_bluepill', at: 'h30' },
      ],
      wires: [],
    }
    const tel = (pc13: number, led1: number): SimTelemetry => ({
      time: 1,
      netVoltages: {},
      issues: [],
      components: {
        LED1: { pinVoltages: {}, light: led1 },
        LED2: { pinVoltages: {}, light: LIT_LIGHT / 10 },
        U1: {
          pinVoltages: { PC13: pc13 },
          sub: { LED_PWR: { pinVoltages: {}, light: 0.07 } },
          mcu: { state: 'running', pc: 0, hclkHz: 8e6, cycles: 1, pinModes: { PC13: 'out' } },
        },
      },
    })
    const levels = new Map<string, number>()
    const toggled = new Set<string>()
    const a1 = circuitActivity(l, tel(3.3, 0), levels, toggled)
    expect(a1.componentIds).toEqual([]) // power LED only, LED2 at 0.1 mA, PC13 not toggled yet
    const a2 = circuitActivity(l, tel(0, 0.6), levels, toggled)
    expect(a2.componentIds).toEqual(['LED1', 'U1'])
    expect(a2.phrases).toEqual(['LED1 亮了', 'U1 的 PC13 在切換'])
  })

  it('the lesson watcher celebrates a passed acceptance run once (a failed one: never)', () => {
    const stop = startSuccessWatch()
    expect(successWatchCount()).toBe(1)
    const ok = { pass: true } as never
    const bad = { pass: false } as never
    useLessonUi.getState().setRun('b1-led-resistor|acceptance', { status: 'done', progress: null, results: [ok, bad], at: Date.now() + 1 })
    expect(useCelebration.getState().count['lesson-pass']).toBe(0)
    useLessonUi.getState().setRun('b1-led-resistor|acceptance', { status: 'done', progress: null, results: [ok, ok], at: Date.now() + 2 })
    expect(useCelebration.getState().count['lesson-pass']).toBe(1)
    expect(useCelebration.getState().badge?.message).toMatch(/驗收 2 項全部通過/)
    // a step check passing is not the lesson
    __resetCelebrationForTests()
    useLessonUi.getState().setRun('b1-led-resistor|step:s1', { status: 'done', progress: null, results: [ok], at: Date.now() + 3 })
    expect(useCelebration.getState().count['lesson-pass']).toBe(0)
    stop()
    useLessonUi.getState().setRun('b1-led-resistor|acceptance', null)
    useLessonUi.getState().setRun('b1-led-resistor|step:s1', null)
  })

  it('cheer: a pass with the loaded answer (solution loaded after the start circuit) is never celebrated', () => {
    const before = useLessonProgress.getState().lessons
    useLessonProgress.setState({
      lessons: { ...before, 'b2-voltage-divider': { step: 0, stepsDone: [], startLoadedAt: 1000, solutionLoadedAt: 2000, updatedAt: 2000 } },
    })
    const events: SceneFxEvent[] = []
    const off = onSceneFx((e) => events.push(e))
    const stop = startSuccessWatch()
    const ok = { pass: true } as never
    useLessonUi.getState().setRun('b2-voltage-divider|acceptance', { status: 'done', progress: null, results: [ok, ok], at: Date.now() + 1 })
    expect(useCelebration.getState().count['lesson-pass']).toBe(0)
    expect(useCelebration.getState().badge).toBeNull()
    expect(events).toHaveLength(0)
    // the start circuit loaded again after the answer: the learner's own pass celebrates
    useLessonProgress.setState({
      lessons: { ...before, 'b2-voltage-divider': { step: 0, stepsDone: [], startLoadedAt: 3000, solutionLoadedAt: 2000, updatedAt: 3000 } },
    })
    useLessonUi.getState().setRun('b2-voltage-divider|acceptance', { status: 'done', progress: null, results: [ok, ok], at: Date.now() + 2 })
    expect(useCelebration.getState().count['lesson-pass']).toBe(1)
    expect(events.map((e) => e.kind)).toEqual(['lesson-pass'])
    stop()
    off()
    useLessonUi.getState().setRun('b2-voltage-divider|acceptance', null)
    useLessonProgress.setState({ lessons: before })
  })
})

describe('vivid: damage in the problems list', () => {
  const input = (layout: CircuitLayout, telemetry: SimTelemetry, issues: SimIssue[]): ProblemsInput => ({
    layout,
    findings: runErc(layout, { telemetry, issues }),
    issues,
    firmware: {},
    mcus: {},
    running: true,
    simTime: telemetry.time,
  })

  it('a burned-open resistor: ONE row 「R2 燒斷了」 with cause + fix', () => {
    const l = valid({
      version: 1,
      components: [
        { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
        { id: 'R2', type: 'resistor', holes: ['top+14', 'top-14'], params: { resistance: 10 } },
      ],
      wires: [
        { id: 'W1', from: 'PS1:+', to: 'top+0' },
        { id: 'W2', from: 'PS1:-', to: 'top-0' },
      ],
    })
    const e = new SimEngine(l)
    e.setRuntimeParam('PS1', 'voltage', 12) // 14.4 W in a ¼ W resistor
    e.advance(2.5, 1e-3)
    const tele = e.telemetry()
    expect(tele.components.R2.damage?.kind).toBe('burned')
    const p = deriveProblems(input(l, tele, tele.issues))
    const rows = p.filter((x) => x.fact === 'burned:R2')
    expect(rows).toHaveLength(1)
    expect(rows[0].level).toBe('error')
    expect(rows[0].title).toBe('R2 燒斷了')
    expect(rows[0].detail).toContain('電阻膜過熱燒穿，已經不導電')
    expect(rows[0].detail).toContain('請改用阻值更大或瓦數更高的電阻，再按〔換新〕；改好電路或數值時也會自動換新') // round 5: 〔換新〕
  })

  it('a reversed electrolytic: ONE row 「C1 反接爆開」 that says the real part is ruined', () => {
    const l = valid({
      version: 1,
      components: [
        { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
        { id: 'C1', type: 'capacitor', holes: ['top-6', 'top+6'], params: { capacitance: 1e-4, polarized: true } },
      ],
      wires: [
        { id: 'W1', from: 'PS1:+', to: 'top+0' },
        { id: 'W2', from: 'PS1:-', to: 'top-0' },
      ],
    })
    const e = new SimEngine(l)
    e.advance(1.5, 1e-3)
    const tele = e.telemetry()
    const p = deriveProblems(input(l, tele, tele.issues))
    const rows = p.filter((x) => x.fact === 'vented:C1')
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('C1 反接爆開')
    expect(rows[0].detail).toContain('實際的電容已經損壞')
    expect(rows[0].detail).toContain('模擬仍沿用原本的容值')
  })

  it('a pin MEASURED beyond its absolute maximum: the chip may be damaged, the simulation no longer guarantees it', () => {
    const l = valid(bluePill([part('R1', 'resistor', ['top+20', tap('PA0')], { resistance: 100 })]))
    const issues: SimIssue[] = [{ level: 'warning', message: 'U1 PA0: 4.80 V exceeds VDD + 0.3 V (3.60 V) — PA0 is not 5 V tolerant', componentId: 'U1' }]
    const tele: SimTelemetry = { time: 1, netVoltages: {}, issues, components: {} }
    const p = deriveProblems(input(l, tele, issues))
    const rows = p.filter((x) => x.fact === 'absmax:U1:PA0')
    expect(rows).toHaveLength(1) // the static finding and the measurement: one row
    expect(rows[0].detail).toContain('實際晶片的這支腳可能已經損壞，之後模擬不再保證 U1 的行為')
    // not measured (static only): no damage claim
    const staticOnly = deriveProblems(input(l, { ...tele, issues: [] }, []))
    expect(staticOnly.some((x) => /可能已經損壞/.test(x.detail))).toBe(false)
  })

  it('zh-TW: every new message translates', () => {
    for (const m of [
      'R2 burned open (14.4 W in a 250 mW resistor) — use a larger resistance or a higher-wattage resistor',
      'C1 vented: 5.00 V reverse voltage on a polarized capacitor — turn it around (+ lead toward the higher voltage)',
      'R2 burned open',
      'C1 vented (reversed)',
    ]) {
      expect(hasMessageTranslation(m), m).toBe(true)
    }
    expect(tMessage('R2 burned open (14.4 W in a 250 mW resistor) — use a larger resistance or a higher-wattage resistor')).toBe(
      'R2 燒斷了（250 mW 的電阻承受了 14.4 W）——請改用阻值更大或瓦數更高的電阻',
    )
    for (const k of ['Done!', 'Circuit working ✓', 'Sound', '{id} lit', '{id} toggles {pin}', '{id} turning', '{id} sounding']) {
      expect(t(k), k).not.toBe(k)
    }
  })
})
