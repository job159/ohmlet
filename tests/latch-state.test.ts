/**
 * Keep-pressed latch 「保持按下」 (src/ui/embedded/latch.ts) — the product
 * owner's 「按鍵可以保持按下」: latch / release / reset / not saved /
 * momentary release, against the real zustand store (it imports cleanly in
 * node). latched(id) = the layout says pressed:true and no momentary hold
 * is active — the same runtime 'pressed' param the 3D press and the 按住 puck
 * write, so the circuit (and the firmware) sees a held button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { __resetHistoryForTests, stripTransientParams, useStore } from '../src/state/store'
import {
  bindLatchScene,
  canPress,
  isLatched,
  latchPart,
  latchedIn,
  latchedSummary,
  pressMomentary,
  releaseAllLatches,
  setLatched,
  useLatchHolds,
} from '../src/ui/embedded/latch'
import { getEntry } from '../src/model/catalog'

const LAYOUT: CircuitLayout = {
  version: 1,
  name: 'latch',
  components: [
    { id: 'SW1', type: 'pushbutton', at: 'f50' },
    { id: 'SW2', type: 'pushbutton', at: 'f54' },
    { id: 'ENC1', type: 'ky040_encoder', at: 'f10' },
    { id: 'R1', type: 'resistor', holes: ['a36', 'a40'] },
  ],
  wires: [],
}

const SESSION: SimTelemetry = { time: 1, netVoltages: {}, components: {}, issues: [] }

const pressed = (id: string) => useStore.getState().layout.components.find((c) => c.id === id)?.params?.pressed

function reset(): void {
  useStore.getState().resetSim()
  __resetHistoryForTests()
  useLatchHolds.setState({ held: [] })
  useStore.setState({ layout: LAYOUT, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
}

beforeEach(() => {
  __setLangForTests('zh-TW')
  reset()
})
afterEach(() => {
  useStore.setState({ telemetry: null })
  useLatchHolds.setState({ held: [] })
})

describe('which parts can be kept pressed', () => {
  it('every part with the runtime pressed param — pushbutton, KY-040, joystick — and nothing else', () => {
    expect(canPress(getEntry('pushbutton'))).toBe(true)
    expect(canPress(getEntry('ky040_encoder'))).toBe(true)
    expect(canPress(getEntry('joystick_xy'))).toBe(true)
    expect(canPress(getEntry('resistor'))).toBe(false)
    expect(canPress(undefined)).toBe(false)
  })
})

describe('latch and release (the 保持按下 toggle)', () => {
  it('on = the runtime pressed param stays true (no undo step); off releases', () => {
    expect(setLatched('SW1', true)).toBe(true)
    expect(pressed('SW1')).toBe(true)
    expect(isLatched('SW1')).toBe(true)
    expect(latchedIn(useStore.getState().layout)).toEqual(['SW1'])
    expect(useStore.getState().canUndo).toBe(false) // runtime state, never an undo step
    expect(latchedSummary()).toBe('SW1 保持按下中')
    expect(setLatched('SW2', true)).toBe(true)
    expect(latchedSummary()).toBe('SW1、SW2 保持按下中')
    expect(setLatched('SW1', false)).toBe(true)
    expect(pressed('SW1')).toBe(false)
    expect(isLatched('SW1')).toBe(false)
    expect(latchedIn(useStore.getState().layout)).toEqual(['SW2'])
  })

  it('refuses a part that cannot be pressed (and an unknown id)', () => {
    expect(setLatched('R1', true)).toBe(false)
    expect(setLatched('NOPE', true)).toBe(false)
    expect(pressed('R1')).toBeUndefined()
  })

  it('a part pressed through its own 按下 switch (KY-040) counts as kept pressed', () => {
    useStore.getState().setParam('ENC1', 'pressed', true)
    expect(isLatched('ENC1')).toBe(true)
    useStore.getState().setParam('ENC1', 'pressed', false)
    expect(isLatched('ENC1')).toBe(false)
  })
})

describe('momentary press (3D press-and-hold, the 按住 puck)', () => {
  it('pressed while held, but never "kept pressed"; up releases', () => {
    pressMomentary('SW1', true)
    expect(pressed('SW1')).toBe(true)
    expect(isLatched('SW1')).toBe(false) // a finger holds it
    pressMomentary('SW1', false)
    expect(pressed('SW1')).toBe(false)
    expect(useLatchHolds.getState().held).toEqual([])
  })

  it('a momentary press of a latched part releases it', () => {
    setLatched('SW1', true)
    pressMomentary('SW1', true)
    expect(pressed('SW1')).toBe(true) // still closed while the finger is on it
    expect(isLatched('SW1')).toBe(false)
    pressMomentary('SW1', false)
    expect(pressed('SW1')).toBe(false)
    expect(isLatched('SW1')).toBe(false)
  })

  it('the 3D double-click: the second press stays pressed (latchPart), a stray release is ignored', () => {
    pressMomentary('SW1', true) // the second click's pointerdown
    expect(latchPart('SW1')).toBe(true) // its pointerup asks to keep it pressed
    expect(isLatched('SW1')).toBe(true)
    pressMomentary('SW1', false) // e.g. a held-back quick-click release arriving late
    expect(pressed('SW1')).toBe(true)
    expect(isLatched('SW1')).toBe(true)
  })

  it('turning 保持按下 on supersedes a quick click whose release is still held back', () => {
    pressMomentary('SW1', true) // 按住 quick click: the release waits for 50 ms of simulated time
    setLatched('SW1', true)
    pressMomentary('SW1', false) // …the deferred release fires
    expect(isLatched('SW1')).toBe(true)
  })
})

describe('the latch is runtime state only', () => {
  it('never saved: autosave / project files / exports strip it, undo snapshots never carry it', () => {
    useStore.getState().addComponent('resistor', { holes: ['a1', 'a5'] }) // one undoable edit
    setLatched('SW1', true)
    const stripped = stripTransientParams(useStore.getState().layout)
    expect(stripped.components.find((c) => c.id === 'SW1')?.params?.pressed).toBeUndefined()
    const exported = JSON.parse(useStore.getState().exportJson()) as CircuitLayout
    expect(exported.components.find((c) => c.id === 'SW1')?.params?.pressed).toBeUndefined()
    expect(JSON.stringify(exported)).not.toContain('pressed')
    // an undo restores a snapshot without it: the latch goes (honestly — the circuit is released too)
    useStore.getState().undo()
    expect(isLatched('SW1')).toBe(false)
  })

  it('deleting the part releases it', () => {
    setLatched('SW1', true)
    useStore.getState().select('SW1')
    useStore.getState().removeSelected()
    expect(latchedIn(useStore.getState().layout)).toEqual([])
    expect(isLatched('SW1')).toBe(false)
  })
})

describe('bindLatchScene: lock badges + 重置模擬', () => {
  it('pushes the latched parts on change only (never per frame)', () => {
    const setLatchedParts = vi.fn()
    const unbind = bindLatchScene({ setLatchedParts })
    expect(setLatchedParts).toHaveBeenLastCalledWith([])
    setLatched('SW1', true)
    expect(setLatchedParts).toHaveBeenLastCalledWith(['SW1'])
    const calls = setLatchedParts.mock.calls.length
    useStore.getState().setParam('R1', 'resistance', 470) // a layout change that leaves the latch alone
    expect(setLatchedParts.mock.calls.length).toBe(calls)
    pressMomentary('SW1', true) // a finger on it: no badge while held
    expect(setLatchedParts).toHaveBeenLastCalledWith([])
    pressMomentary('SW1', false)
    expect(setLatchedParts).toHaveBeenLastCalledWith([])
    expect(pressed('SW1')).toBe(false)
    unbind()
    setLatched('SW2', true)
    expect(setLatchedParts).toHaveBeenLastCalledWith([])
  })

  it('重置模擬 (the session ends) releases every latch', async () => {
    const setLatchedParts = vi.fn()
    const unbind = bindLatchScene({ setLatchedParts })
    useStore.setState({ telemetry: SESSION }) // a session exists
    setLatched('SW1', true)
    useStore.getState().setParam('ENC1', 'pressed', true)
    expect(setLatchedParts).toHaveBeenLastCalledWith(['SW1', 'ENC1'])
    useStore.getState().stopSim() // a pause keeps it
    await Promise.resolve()
    expect(isLatched('SW1')).toBe(true)
    useStore.getState().resetSim()
    await Promise.resolve()
    expect(pressed('SW1')).toBe(false)
    expect(pressed('ENC1')).toBe(false)
    expect(setLatchedParts).toHaveBeenLastCalledWith([])
    unbind()
  })

  it('a reset with no session to end leaves a latch set before running', async () => {
    const unbind = bindLatchScene({})
    setLatched('SW1', true) // applies when the simulation runs
    useStore.getState().resetSim()
    await Promise.resolve()
    expect(isLatched('SW1')).toBe(true)
    unbind()
  })

  it('the classic chrome (enabled false): no badges, a reset left as before', async () => {
    const setLatchedParts = vi.fn()
    const unbind = bindLatchScene({ setLatchedParts }, () => false)
    useStore.setState({ telemetry: SESSION })
    setLatched('SW1', true)
    expect(setLatchedParts).toHaveBeenLastCalledWith([])
    useStore.getState().resetSim()
    await Promise.resolve()
    expect(pressed('SW1')).toBe(true)
    unbind()
  })

  it('releaseAllLatches lets go of latched and held parts alike', () => {
    setLatched('SW1', true)
    pressMomentary('SW2', true)
    releaseAllLatches()
    expect(pressed('SW1')).toBe(false)
    expect(pressed('SW2')).toBe(false)
    expect(useLatchHolds.getState().held).toEqual([])
  })
})
