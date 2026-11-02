/**
 * 顯示電流 chip logic (src/ui/chrome/FlowToggle.tsx): the preference flips
 * with honest feedback (no currents before the simulation runs — the toast
 * says so), the key is free in the shared key table, the legend is the one
 * sentence the product owner asked for, and the chrome strings are zh-TW.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import { getToasts } from '../src/ui/kit'
import { useFlowView } from '../src/ui/fx/flow'
import { FLOW_KEY, flowLegend, showFlowLegend, toggleFlowView } from '../src/ui/chrome/FlowToggle'
import { SHORTCUTS } from '../src/ui/chrome/ShortcutsSheet'
import { useStore } from '../src/state/store'

beforeEach(() => {
  __setLangForTests('zh-TW')
  useFlowView.getState().setVisible(false)
})
afterEach(() => {
  useFlowView.getState().setVisible(false)
})

const lastToast = () => getToasts()[getToasts().length - 1]?.text ?? ''

describe('顯示電流 toggle', () => {
  it('the legend is the requested sentence', () => {
    // F15: the dots have one colour — magnitude is speed and density only
    expect(flowLegend()).toBe('光點越快越密＝電流越大，方向＝由正到負')
    expect(t('Show current')).toBe('顯示電流')
  })

  it('turning it on before anything runs says the currents come with the run (never a fake picture)', () => {
    expect(useStore.getState().running).toBe(false)
    toggleFlowView(false)
    expect(useFlowView.getState().visible).toBe(true)
    expect(lastToast()).toBe('已開啟電流顯示——執行模擬時就會看到電流流動')
  })

  it('the key toggle announces off', () => {
    useFlowView.getState().setVisible(true)
    toggleFlowView(true)
    expect(useFlowView.getState().visible).toBe(false)
    expect(lastToast()).toBe('已關閉電流顯示')
  })

  it('C is free in the shared key table (or already listed for this action)', () => {
    for (const [id, row] of Object.entries(SHORTCUTS)) {
      for (const combo of row.combos) {
        if (combo.length === 1 && combo[0].toUpperCase() === FLOW_KEY) expect(id).toBe('current-flow')
      }
    }
  })

  it('turned on while paused (or before a run): the legend is not spent — it waits for the run, then shows once', () => {
    const w = globalThis as unknown as { window?: { localStorage: Storage } }
    const had = w.window
    const mem = new Map<string, string>()
    w.window = {
      localStorage: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, String(v)),
        removeItem: (k: string) => void mem.delete(k),
        clear: () => mem.clear(),
        key: () => null,
        length: 0,
      } as Storage,
    }
    try {
      expect(useStore.getState().running).toBe(false)
      toggleFlowView(false) // the chip / the 更多 row before the run
      expect(lastToast()).toBe('已開啟電流顯示——執行模擬時就會看到電流流動')
      expect(mem.get('bb.flowHint')).toBeUndefined() // the verifier's q7: it used to be spent here
      // the run starts with the view on (FlowToggle's effect): the legend, once
      expect(showFlowLegend(false)).toBe(true)
      expect(lastToast()).toBe('顯示電流：光點越快越密＝電流越大，方向＝由正到負')
      expect(mem.get('bb.flowHint')).toBe('1')
      expect(showFlowLegend(false)).toBe(false)
      // the key's announcement always carries it
      expect(showFlowLegend(true)).toBe(true)
    } finally {
      if (had === undefined) delete w.window
      else w.window = had
    }
  })
})
