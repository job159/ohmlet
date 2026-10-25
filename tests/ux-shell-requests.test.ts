/**
 * Shell — requests round (round 2) of the UX continuity fixes:
 *   - kit toasts take one action (ToastOptions.action — lessons LS-12 「查看原因」,
 *     instruments' 「仍要再放一支」): it is kept on the item, and an actionable
 *     toast stays at least ACTION_MIN_MS so it can be read and reached;
 *   - showInstrument(view) (src/ui/chrome/instrument-sheet.ts): a link that
 *     leads to an instrument lands on it where no workspace tray shows (the
 *     phone 儀器 sheet: the tray tab is set, then a request App answers by
 *     presenting the sheet); the classic chrome has no such links;
 *   - the status pill's 「· n 項執行後確認」 counts the same rows as the
 *     problems panel's 執行後確認 group (every pendingRuntime row).
 * Pure functions and the real stores (no DOM); the browser replay of the
 * same paths is in the shell report.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { ACTION_MIN_MS, dismissToast, getToasts, showToast } from '../src/ui/kit/toasts'
import { showInstrument, useInstrumentRequest } from '../src/ui/chrome/instrument-sheet'
import { useLab } from '../src/ui/embedded/lab'
import { statusPillModel } from '../src/ui/chrome/StatusPill'
import type { Problem } from '../src/ui/embedded/problems'

afterEach(() => {
  __setLangForTests('zh-TW')
  for (const t of getToasts()) dismissToast(t.id)
})

describe('kit toast action', () => {
  it('keeps the action and stays long enough to reach it', () => {
    let ran = 0
    const id = showToast('3 / 5 項通過', { duration: 2000, action: { label: '查看原因', run: () => ran++ } })
    const item = getToasts().find((t) => t.id === id)!
    expect(item.action?.label).toBe('查看原因')
    expect(item.duration).toBe(ACTION_MIN_MS)
    item.action!.run()
    expect(ran).toBe(1)
  })

  it('a longer duration wins; a plain toast is unchanged', () => {
    const a = showToast('a', { duration: 9000, action: { label: 'x', run: () => {} } })
    const b = showToast('b')
    const items = getToasts()
    expect(items.find((t) => t.id === a)!.duration).toBe(9000)
    const plain = items.find((t) => t.id === b)!
    expect(plain.duration).toBe(2200)
    expect('action' in plain).toBe(false)
  })
})

describe('showInstrument — links land on the instrument', () => {
  it('the classic chrome (English, no workspace) has no such link', () => {
    __setLangForTests('en')
    const before = useInstrumentRequest.getState().request
    expect(showInstrument('log')).toBe(false)
    expect(useInstrumentRequest.getState().request).toBe(before)
  })

  it('without the workspace tray: sets the tray tab and asks the shell for the 儀器 sheet', () => {
    __setLangForTests('zh-TW')
    const lab = useLab.getState()
    lab.setWorkspace({ tray: { ...lab.workspace.tray, open: false, tab: 'scope' } })
    const seq0 = useInstrumentRequest.getState().request?.seq ?? 0
    expect(showInstrument('log')).toBe(true)
    const r1 = useInstrumentRequest.getState().request
    expect(r1).toEqual({ view: 'log', seq: seq0 + 1 })
    expect(useLab.getState().workspace.tray.tab).toBe('log')
    // the desktop tray's open / closed preference is the user's
    expect(useLab.getState().workspace.tray.open).toBe(false)
    // the same view again is a new request (the sheet was closed meanwhile)
    showInstrument('log')
    expect(useInstrumentRequest.getState().request?.seq).toBe(seq0 + 2)
  })
})

describe('status pill: 「· n 項執行後確認」 counts the panel’s 執行後確認 rows', () => {
  const p = (over: Partial<Problem>): Problem => ({
    id: over.id ?? 'p',
    level: 'info',
    source: 'erc',
    title: 'T',
    detail: 'D',
    componentIds: [],
    holes: [],
    ...over,
  })
  it('every pendingRuntime row, and only those', () => {
    __setLangForTests('zh-TW')
    const problems = [p({ id: 'a', pendingRuntime: true }), p({ id: 'b', pendingRuntime: true }), p({ id: 'c' })]
    const m = statusPillModel({
      problems,
      counts: { error: 0, warning: 0, info: 3 },
      phase: 'idle',
      haltedId: null,
      boardEmpty: false,
      settled: true,
    })
    expect(m?.text).toBe('電路已就緒（空白鍵）· 2 項執行後確認')
    expect(m?.opensProblems).toBe(true)
  })
})
