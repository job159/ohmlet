/**
 * 顯示電流 follows the chrome (review findings THREE-2 / UI-3).
 *
 * The classic chrome (isLegacyChrome(): English without the workspace) has
 * no 顯示電流 control — no chip, no 更多 row, no C key — so the preference a
 * learner turned on in the product chrome ('bb.flow') must not carry into it:
 * there the view is off and the simulation does not track currents, while
 * the stored preference stays untouched. When the product chrome comes back
 * (language switch, workspace on, a wider window) the stored preference
 * applies again. A programmatic setVisible() still works in either chrome
 * (scripts/ux-e2e/flow-current.mjs check H).
 *
 * flow.ts reads 'bb.flow' at import, so every test boots fresh modules.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage {
  private m = new Map<string, string>()
  broken = false
  getItem(k: string): string | null {
    if (this.broken) throw new Error('storage unavailable')
    return this.m.has(k) ? (this.m.get(k) as string) : null
  }
  setItem(k: string, v: string): void {
    if (this.broken) throw new Error('storage unavailable')
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    if (this.broken) throw new Error('storage unavailable')
    this.m.delete(k)
  }
}

let storage: MemoryStorage

beforeEach(() => {
  vi.resetModules()
  storage = new MemoryStorage()
  vi.stubGlobal('window', { localStorage: storage })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A page load: 'bb.flow' as stored, fresh flow + tracking modules. */
async function boot(stored: boolean) {
  if (stored) storage.setItem('bb.flow', '1')
  const flow = await import('../src/ui/fx/flow')
  const tracking = await import('../src/sim/coordinator/tracking')
  // a simulation host (worker / inline) as the coordinator registers it
  const told: boolean[] = []
  const unregister = tracking.registerTrackingTarget({ setCurrentTracking: (on) => void told.push(on) })
  return { flow, tracking, told, unregister }
}

describe('顯示電流 in the classic chrome (THREE-2 / UI-3)', () => {
  it('mounting the classic chrome with 顯示電流 stored on: no dots, no current tracking, the stored choice kept', async () => {
    const { flow, tracking, told } = await boot(true)
    // the product chrome's choice as read at boot
    expect(flow.useFlowView.getState().visible).toBe(true)
    expect(tracking.currentTrackingDefault()).toBe(true)
    // App mounts in the classic chrome
    flow.applyFlowChrome(true)
    expect(flow.useFlowView.getState().visible).toBe(false) // the scene's flow layer follows this
    expect(tracking.currentTrackingDefault()).toBe(false)
    expect(told).toEqual([true, false]) // a live host stops tracking
    // a host created later (the next ▶ run) starts without tracking
    const later: boolean[] = []
    tracking.registerTrackingTarget({ setCurrentTracking: (on) => void later.push(on) })
    expect(later).toEqual([])
    // the learner's choice is still stored for the product chrome
    expect(storage.getItem('bb.flow')).toBe('1')
    expect(flow.flowPreference()).toBe(true)
  })

  it('a live switch to the product chrome brings the stored preference back, and back again to classic hides it', async () => {
    const { flow, tracking, told } = await boot(true)
    flow.applyFlowChrome(true)
    // 更多 → 介面語言 → 繁體中文, or the workspace turned on / the window widened
    flow.applyFlowChrome(false)
    expect(flow.useFlowView.getState().visible).toBe(true)
    expect(tracking.currentTrackingDefault()).toBe(true)
    // English on a phone / the window narrowed below the workspace query
    flow.applyFlowChrome(true)
    expect(flow.useFlowView.getState().visible).toBe(false)
    expect(tracking.currentTrackingDefault()).toBe(false)
    flow.applyFlowChrome(false)
    expect(flow.useFlowView.getState().visible).toBe(true)
    expect(tracking.currentTrackingDefault()).toBe(true)
    expect(told).toEqual([true, false, true, false, true])
    expect(storage.getItem('bb.flow')).toBe('1')
  })

  it('the product chrome mounting changes nothing (no extra store update, no tracking flip)', async () => {
    const { flow, told } = await boot(true)
    let updates = 0
    flow.useFlowView.subscribe(() => void updates++)
    flow.applyFlowChrome(false)
    flow.applyFlowChrome(false)
    expect(updates).toBe(0) // FlowToggle's legend / the scene see no spurious change
    expect(flow.useFlowView.getState().visible).toBe(true)
    expect(told).toEqual([true])
  })

  it('preference off: off in both chromes, nothing written', async () => {
    const { flow, tracking } = await boot(false)
    flow.applyFlowChrome(true)
    expect(flow.useFlowView.getState().visible).toBe(false)
    flow.applyFlowChrome(false)
    expect(flow.useFlowView.getState().visible).toBe(false)
    expect(tracking.currentTrackingDefault()).toBe(false)
    expect(storage.getItem('bb.flow')).toBeNull()
  })

  it('turned on in the product chrome, then classic, then product: on again', async () => {
    const { flow, tracking } = await boot(false)
    flow.applyFlowChrome(false)
    flow.useFlowView.getState().setVisible(true) // the chip / 更多 row / C
    expect(storage.getItem('bb.flow')).toBe('1')
    flow.applyFlowChrome(true)
    expect(flow.useFlowView.getState().visible).toBe(false)
    expect(tracking.currentTrackingDefault()).toBe(false)
    flow.applyFlowChrome(false)
    expect(flow.useFlowView.getState().visible).toBe(true)
    expect(tracking.currentTrackingDefault()).toBe(true)
  })

  it('a programmatic setVisible(true) still works in the classic chrome (flow-current.mjs check H)', async () => {
    const { flow, tracking } = await boot(false)
    flow.applyFlowChrome(true)
    flow.useFlowView.getState().setVisible(true)
    expect(flow.useFlowView.getState().visible).toBe(true)
    expect(tracking.currentTrackingDefault()).toBe(true)
    // it is the preference now, in either chrome
    expect(flow.flowPreference()).toBe(true)
    flow.applyFlowChrome(false)
    expect(flow.useFlowView.getState().visible).toBe(true)
  })

  it('without storage (private window) the page still remembers the choice across a chrome switch', async () => {
    const { flow } = await boot(false)
    storage.broken = true
    flow.applyFlowChrome(false)
    flow.useFlowView.getState().setVisible(true)
    flow.applyFlowChrome(true)
    expect(flow.useFlowView.getState().visible).toBe(false)
    flow.applyFlowChrome(false)
    expect(flow.useFlowView.getState().visible).toBe(true)
  })

  it('App applies the chrome on mount (before the scene mounts) and on every chrome switch', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    const effect = 'useEffect(() => applyFlowChrome(legacy), [legacy])'
    expect(app.includes(effect)).toBe(true)
    // declared before the scene-mount effect: React runs a component's effects
    // in order, so the scene's flow layer starts from the chrome's value
    expect(app.indexOf(effect)).toBeGreaterThan(0)
    expect(app.indexOf(effect)).toBeLessThan(app.indexOf('const scene = new BreadboardScene()'))
    // `legacy` is the reactive isLegacyChrome() (language + workspace toggle + viewport)
    expect(app.includes('const legacy = useLegacyChrome()')).toBe(true)
  })
})
