/**
 * Round 5 drag-to-wire — the host side (src/ui/workspace/wire-draw.ts,
 * installed on the scene by scene-bridge registerScene):
 *  - wireDrawStart: where a pressed point starts a wire — a free hole or a
 *    terminal as is, a part pin's hole moved to the free hole of its strip
 *    (the wire mode's own rule), nothing on a wire end / in the classic
 *    chrome / outside select mode (wire mode before its first end is fine);
 *  - drawWire: ONE undo step, the net's role colour, the mode and the
 *    selection untouched, 「已接上 … → …」 with 〔復原〕; a refusal says why
 *    (「這裡不能接：…」); released away from any hole, nothing at all;
 *  - the onboarding card names the gesture (the wire mode hint no longer
 *    carries a tail — polish: a one-time tip, tests/polish-scene.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import type { CircuitLayout } from '../src/model/types'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { getToasts } from '../src/ui/kit/toasts'
import { hintForMode, wireConnectedHint } from '../src/ui/chrome/hints'
import { roleColorOfNewWire, wireRoleOf } from '../src/ui/wire-roles'
import { drawWire, wireDrawAccepted, wireDrawStart } from '../src/ui/workspace/wire-draw'

/** i4-like: PS1 − on the top − rail (W2), W3 / W8 on U1's strips, R2 at d40–d44. */
const LAYOUT: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R2', type: 'resistor', holes: ['d40', 'd44'], params: { resistance: 330 } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'j27', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-1', color: 'black' },
    { id: 'W3', from: 'a20', to: 'e30', color: 'yellow' },
    { id: 'W8', from: 'a25', to: 'e40', color: 'green' },
  ],
}

const lastToast = () => getToasts().at(-1)
const wires = () => useStore.getState().layout.wires

beforeEach(() => {
  __setLangForTests('zh-TW')
  __resetHistoryForTests()
  useStore.setState({ layout: LAYOUT, selection: [], mode: { kind: 'select' }, telemetry: null })
})
afterEach(() => __setLangForTests('zh-TW'))

describe('wireDrawStart: where a press starts a wire', () => {
  it('a free hole and a terminal post start there; a part pin moves to its strip’s free hole', () => {
    expect(wireDrawStart('a50')).toBe('a50')
    expect(wireDrawStart('PS1:+')).toBe('PS1:+') // a post takes any number of wires
    expect(wireDrawStart('d40')).toBe('c40') // R2's pin: the nearest free hole of column 40
  })

  it('nothing on a wire end, a covered hole or off the rig', () => {
    expect(wireDrawStart('a20')).toBeNull() // W3's end
    expect(wireDrawStart('e20')).toBeNull() // under U1's body
    expect(wireDrawStart('a99')).toBeNull()
  })

  it('select mode, or the wire mode before its first end; never placing, mid-wire or in the classic chrome', () => {
    useStore.setState({ mode: { kind: 'wire', from: null, color: 'red' } })
    expect(wireDrawStart('a50')).toBe('a50')
    useStore.setState({ mode: { kind: 'wire', from: 'a50', color: 'red' } })
    expect(wireDrawStart('a51')).toBeNull()
    useStore.setState({ mode: { kind: 'place', type: 'led', pickedHoles: [] } as never })
    expect(wireDrawStart('a50')).toBeNull()
    useStore.setState({ mode: { kind: 'select' } })
    __setLangForTests('en') // English without the workspace = the classic chrome
    expect(wireDrawStart('a50')).toBeNull()
  })
})

describe('drawWire: the drop', () => {
  it('adds ONE wire in its role colour, in ONE undo step, and says so with 〔復原〕; mode and selection stay', () => {
    useStore.setState({ selection: ['R2'] })
    const color = roleColorOfNewWire(LAYOUT, 'top-5', 'a50')
    expect(color).toBe('black') // the − rail is ground (W2 ties it to PS1 −)
    drawWire('top-5', 'a50')
    const after = useStore.getState().layout
    expect(after.wires).toHaveLength(LAYOUT.wires.length + 1)
    const w = after.wires.at(-1)!
    expect([w.from, w.to]).toEqual(['top-5', 'a50'])
    expect(w.color).toBe(color)
    expect(wireRoleOf(after, w.id).color).toBe(w.color) // stored = drawn
    expect(useStore.getState().mode).toEqual({ kind: 'select' })
    expect(useStore.getState().selection).toEqual(['R2']) // the new wire is not selected
    const toast = lastToast()!
    expect(toast.text).toBe(wireConnectedHint(after, 'top-5', 'a50'))
    expect(toast.text).toBe('已接上上方 − 電源軌第 5 孔 → a50')
    expect(toast.action?.label).toBe(t('Undo'))
    // exactly one step: one undo brings the board back, nothing more to undo
    useStore.getState().undo()
    expect(useStore.getState().layout.wires).toEqual(LAYOUT.wires)
    expect(useStore.getState().canUndo).toBe(false)
  })

  it('〔復原〕 on the toast takes the wire back (a drag that was meant to be an orbit)', () => {
    drawWire('c40', 'a50')
    expect(wires()).toHaveLength(LAYOUT.wires.length + 1)
    lastToast()!.action!.run()
    expect(wires()).toHaveLength(LAYOUT.wires.length)
  })

  it('a refusal says why and adds nothing; the preview asks the same question', () => {
    expect(wireDrawAccepted('c40', 'a20')).toBe(false)
    expect(wireDrawAccepted('c40', 'a50')).toBe(true)
    drawWire('c40', 'a20')
    expect(wires()).toEqual(LAYOUT.wires)
    expect(lastToast()!.text).toBe('這裡不能接：a20 已經被導線 W3 佔用')
  })

  it('released away from any hole or terminal: nothing happens and nothing is said', () => {
    const before = getToasts()
    drawWire('c40', null)
    expect(useStore.getState().layout).toBe(LAYOUT)
    expect(getToasts()).toBe(before)
    expect(useStore.getState().canUndo).toBe(false)
  })

  it('the classic chrome never commits one', () => {
    __setLangForTests('en')
    drawWire('c40', 'a50')
    expect(useStore.getState().layout).toBe(LAYOUT)
  })
})

describe('the gesture is named where people look', () => {
  it('the wire mode hint is short again — the gesture is taught by a one-time tip instead (polish)', () => {
    // round 5 polish: the 「…不必切到導線模式」 tail is gone (nobody read it in a
    // 3 s toast, and it showed only inside the wire mode) — wire-draw.ts
    // wireDrawHint teaches the drag where it happens (tests/polish-scene.test.ts)
    expect(hintForMode({ kind: 'wire', from: null, color: 'red' }, false)).toBe('導線模式：依序點兩個孔位或端子 · Esc 結束')
    expect(hintForMode({ kind: 'wire', from: null, color: 'red' }, true)).toBe('導線模式：依序點兩個孔位或端子 · 點「完成」結束')
    // a started wire's hint is unchanged
    expect(hintForMode({ kind: 'wire', from: 'a1', color: 'red' }, false)).toBe('從 a1 拉線：點第二個孔位 · Esc 取消這條')
  })

  it('the onboarding card: drag off the holes to orbit (Alt / Option anywhere), from hole to hole to wire; a finger long-presses first', () => {
    const mouse = t(
      'Left-drag off the holes to orbit (with Alt / Option held, drag anywhere to orbit), scroll to zoom, right-drag to pan; drag from one hole to another to wire them. Double-click empty space to re-frame.',
    )
    expect(mouse).toContain('從一個孔位拖到另一個孔位就能接線')
    expect(mouse).toContain('按住 Alt／Option 鍵') // the Mac name too (the guide's convention)
    expect(
      t('Drag with one finger to orbit, pinch to zoom, drag with two fingers to pan; long-press a hole and drag to another hole to wire them. Double-tap empty space to re-frame.'),
    ).toContain('長按孔位再拖到另一個孔位就能接線')
  })
})
