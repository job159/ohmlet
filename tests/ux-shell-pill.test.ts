/**
 * UX fix SH-13 — the status pill never says something false or
 * contradictory (src/ui/chrome/StatusPill.tsx, run-feedback.ts):
 *   (1) 「電路已就緒」 only once the problems list speaks for THIS circuit
 *       and no board waits in its firmware grace (COH-18);
 *   (2) findings only a run can confirm (H5 pendingRuntime) → 「· n 項執行後
 *       確認」, and the body opens the list (N7);
 *   (3) an empty board does not run: toast + nothing started (N22);
 *   (4) 「另 n 個」 = errors + warnings − 1 (the More header / badge count
 *       errors + warnings — N15).
 * Pure functions and the real stores; the browser replay is in the shell
 * report (scratch verify-sh13.mjs).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout } from '../src/model/types'
import { useStore } from '../src/state/store'
import type { Problem } from '../src/ui/embedded/problems'
import { problemsSettled, statusPillModel } from '../src/ui/chrome/StatusPill'
import { runBlockedByEmptyBoard, toggleRunWithFeedback } from '../src/ui/chrome/run-feedback'
import { getToasts } from '../src/ui/kit/toasts'

afterEach(() => __setLangForTests('zh-TW'))

const problem = (over: Partial<Problem>): Problem => ({
  id: over.id ?? 'p',
  level: 'warning',
  source: 'erc',
  title: 'T',
  detail: 'D',
  componentIds: [],
  holes: [],
  ...over,
})
const counts = (ps: Problem[]) => ({
  error: ps.filter((p) => p.level === 'error').length,
  warning: ps.filter((p) => p.level === 'warning').length,
  info: ps.filter((p) => p.level === 'info').length,
})
const base = { phase: 'idle' as const, haltedId: null, boardEmpty: false }
const layoutOf = (components: unknown[]): CircuitLayout => ({ version: 1, name: 't', components, wires: [] }) as unknown as CircuitLayout

describe('SH-13 (1) never 「電路已就緒」 before the list speaks for this circuit', () => {
  it('unsettled → nothing; settled → the ready line', () => {
    __setLangForTests('zh-TW')
    expect(statusPillModel({ ...base, problems: [], counts: counts([]), settled: false })).toBeNull()
    expect(statusPillModel({ ...base, problems: [], counts: counts([]), settled: true })?.text).toBe('電路已就緒（空白鍵）')
  })

  it('problemsSettled: the same layout identity, and every MCU board has its firmware', () => {
    const withBoard = layoutOf([{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }])
    const noBoard = layoutOf([{ id: 'R1', type: 'resistor', holes: ['a1', 'a5'] }])
    expect(problemsSettled(null, noBoard, {})).toBe(false) // before the first run
    expect(problemsSettled(layoutOf([]), noBoard, {})).toBe(false) // computed for another circuit
    expect(problemsSettled(noBoard, noBoard, {})).toBe(true)
    // a Blue Pill just dropped: still in its firmware grace → not settled
    expect(problemsSettled(withBoard, withBoard, {})).toBe(false)
    expect(problemsSettled(withBoard, withBoard, { U1: { name: 'hal-blink.elf' } })).toBe(true)
  })

  it('errors and warnings still show while unsettled (only the neutral line waits)', () => {
    __setLangForTests('zh-TW')
    const ps = [problem({ id: 'e', level: 'error', title: '電路中沒有電源' })]
    expect(statusPillModel({ ...base, problems: ps, counts: counts(ps), settled: false })?.text).toBe('電路中沒有電源')
  })
})

describe('SH-13 (2) findings the run will confirm', () => {
  it('「· n 項執行後確認」, and the body opens the list', () => {
    __setLangForTests('zh-TW')
    const ps = [
      problem({ id: 'i1', level: 'info', title: 'U1 PB12 輸入浮接', pendingRuntime: true }),
      problem({ id: 'i2', level: 'info', title: '其他提示' }),
    ]
    const m = statusPillModel({ ...base, problems: ps, counts: counts(ps) })!
    expect(m.tone).toBe('neutral')
    expect(m.text).toBe('電路已就緒（空白鍵）· 1 項執行後確認')
    expect(m.opensProblems).toBe(true)
    expect(m.action?.label).toBe('執行模擬') // release QA SH-F10: the verb on the button, once
    const touch = statusPillModel({ ...base, problems: ps, counts: counts(ps), touch: true })!
    expect(touch.text).toBe('電路已就緒 · 1 項執行後確認')
  })
})

describe('SH-13 (4) one count', () => {
  it('「另 n 個」 = errors + warnings − 1; hints never count', () => {
    __setLangForTests('zh-TW')
    const ps = [
      problem({ id: 'e', level: 'error' }),
      problem({ id: 'w', level: 'warning' }),
      problem({ id: 'i', level: 'info' }),
    ]
    const c = counts(ps)
    expect(statusPillModel({ ...base, problems: ps, counts: c })!.more).toBe(c.error + c.warning - 1)
  })
})

describe('SH-13 (3) an empty board does not run', () => {
  it('toast, nothing started; a circuit runs as before', () => {
    __setLangForTests('zh-TW')
    const st = useStore.getState()
    st.loadLayout(layoutOf([]))
    expect(runBlockedByEmptyBoard()).toBe(true)
    expect(toggleRunWithFeedback()).toBe(false)
    expect(useStore.getState().running).toBe(false)
    expect(getToasts().some((x) => x.text === '麵包板是空的——先開啟範例或放元件')).toBe(true)
    st.loadLayout(layoutOf([{ id: 'R1', type: 'resistor', holes: ['a1', 'a5'] }]))
    expect(runBlockedByEmptyBoard()).toBe(false)
  })
})
