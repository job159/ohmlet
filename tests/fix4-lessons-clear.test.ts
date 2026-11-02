/**
 * fix4 UI-5 — 更多 → 清空麵包板 (product chrome) says 「已清空麵包板」 with
 * 〔復原〕 exactly when the store recorded an undo step: also for an empty
 * board whose rig still changes (several boards, extra rows, a board size),
 * and 「麵包板已經是空的」 (no 〔復原〕, no undo step) only when nothing changed.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout } from '../src/model/types'
import { __resetHistoryForTests, clearBoardRecordsUndo, useStore } from '../src/state/store'
import { dismissToast, getToasts } from '../src/ui/kit/toasts'
import { clearBoardNow } from '../src/ui/sheets/MoreSheet'

const st = () => useStore.getState()
const EMPTY: CircuitLayout = { version: 1, components: [], wires: [] }

beforeEach(() => {
  __setLangForTests('zh-TW')
  st().resetSim()
  __resetHistoryForTests()
  useStore.setState({ layout: { ...EMPTY }, selection: [], mode: { kind: 'select' } })
  for (const x of getToasts()) dismissToast(x.id)
})

const last = () => getToasts()[getToasts().length - 1]

describe('UI-5: 清空麵包板 on an empty board whose rig still changes', () => {
  it('3 boards, no parts: the rig goes back to one board — 「已清空麵包板」 + 〔復原〕, and 〔復原〕 brings the 3 boards back', () => {
    useStore.setState({ layout: { ...EMPTY, boardCount: 3 } })
    clearBoardNow()
    expect(st().layout.boardCount).toBeUndefined()
    expect(st().canUndo).toBe(true)
    expect(last()?.text).toBe('已清空麵包板')
    expect(last()?.action?.label).toBe('復原')
    last()!.action!.run()
    expect(st().layout.boardCount).toBe(3)
  })

  it('extra rows / a board size: the same', () => {
    for (const rig of [{ boardRows: 2 }, { board: 'half' as const }] as Partial<CircuitLayout>[]) {
      __resetHistoryForTests()
      for (const x of getToasts()) dismissToast(x.id)
      useStore.setState({ layout: { ...EMPTY, ...rig } })
      clearBoardNow()
      expect(st().canUndo, JSON.stringify(rig)).toBe(true)
      expect(last()?.text).toBe('已清空麵包板')
      expect(last()?.action?.label).toBe('復原')
    }
  })

  it('a default empty board: 「麵包板已經是空的」, no 〔復原〕, no undo step', () => {
    clearBoardNow()
    expect(st().canUndo).toBe(false)
    expect(last()?.text).toBe('麵包板已經是空的')
    expect(last()?.action).toBeUndefined()
  })

  it('a board with parts: 「已清空麵包板」 + 〔復原〕 (unchanged)', () => {
    st().addComponent('resistor', { holes: ['a10', 'a14'] })
    __resetHistoryForTests()
    clearBoardNow()
    expect(st().layout.components).toHaveLength(0)
    expect(st().canUndo).toBe(true)
    expect(last()?.text).toBe('已清空麵包板')
    expect(last()?.action?.label).toBe('復原')
  })

  it('the toast’s test is the store’s own: an undo step is recorded exactly when clearBoardRecordsUndo says so', () => {
    const cases: CircuitLayout[] = [
      { ...EMPTY },
      { ...EMPTY, boardCount: 3 },
      { ...EMPTY, boardCount: 1 },
      { ...EMPTY, boardRows: 2 },
      { ...EMPTY, board: 'half' },
    ]
    for (const layout of cases) {
      __resetHistoryForTests()
      useStore.setState({ layout })
      const predicted = clearBoardRecordsUndo(layout)
      st().clearBoard()
      expect(st().canUndo, JSON.stringify(layout)).toBe(predicted)
    }
  })
})
