/**
 * UX requests round — scene workstream:
 *  - one hole, one name (SC-12 / SH-12): the hover chip names an empty strip
 *    hole — and a wire end on a strip — with THE static H2 name the wire
 *    hint and the 「已接上 …」 toast use, 「a25（U1 PA0 這一排）」; a part pin
 *    leads with the H1 full name 「R1 第 1 腳」 / 「LED1 陽極（長腳）」;
 *  - a portrait free rectangle (SH-15): fitCornersAlongHome's anchorY lifts
 *    a width-bound box toward the top of the window; 0.5 is the classic
 *    centred fit, bit for bit;
 *  - the probe menu offers a deliberate second scope probe on a net the
 *    scope already measures (IS-13 allowDuplicate) and marks its 「在…中檢視」
 *    rows as instrument reveals;
 *  - SC-13 (4): a re-routed wire still wearing its convention colour takes
 *    the convention of its new ends in the same undo step.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { __setLangForTests } from '../src/i18n'
import { pinLabel } from '../src/i18n/parts'
import { getEntry } from '../src/model/catalog'
import type { CircuitLayout } from '../src/model/types'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { endpointName, holeChipTextFor } from '../src/ui/workspace/hole-chip'
import { probeMenuModel } from '../src/ui/workspace/ProbeMenu'
import { moveWireEndTo } from '../src/ui/workspace/wire-ends'
import { fitCornersAlongHome, type FitWindow } from '../src/three/scene'

/** i4-like: U1 at h10 (PA0 → c25 strip), R2 d40–d44, W8 a25 → e40, W5 on a lone strip, a probe on R2's net. */
const LAYOUT: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R2', type: 'resistor', holes: ['d40', 'd44'], params: { resistance: 330 } },
    { id: 'LED1', type: 'led', holes: ['b50', 'b52'] },
    { id: 'P1', type: 'scope_probe', holes: ['b44'], params: { channel: 1 } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+3', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-1', color: 'black' },
    { id: 'W5', from: 'a58', to: 'a60', color: 'blue' },
    { id: 'W7', from: 'a20', to: 'e36', color: 'yellow' },
    { id: 'W8', from: 'a25', to: 'e40', color: 'green' },
  ],
}

beforeEach(() => {
  __setLangForTests('zh-TW')
  __resetHistoryForTests()
  useStore.setState({ layout: LAYOUT, selection: [], telemetry: null })
  useLab.setState({ logicChannels: [] })
})
afterEach(() => {
  useLab.setState({ logicChannels: [] })
  __setLangForTests('zh-TW')
})

describe('one hole, one name: the chip speaks H2 / H1', () => {
  it('an empty strip hole is named exactly as endpointName names it', () => {
    for (const ref of ['b25', 'c20', 'a44', 'e36']) {
      const name = endpointName(LAYOUT, ref)
      if (ref === 'c20') continue // a pin sits there (its own chip form)
      expect(holeChipTextFor(LAYOUT, ref)).toBe(ref === 'e36' ? `導線 W7 · ${name}` : name)
    }
    expect(holeChipTextFor(LAYOUT, 'b25')).toBe('b25（U1 PA0 這一排）')
    // the shell's wire hint wording is built from the same name
    expect(endpointName(LAYOUT, 'b25')).toBe('b25（U1 PA0 這一排）')
  })

  it('a wire end on a strip names its strip the H2 way; a wire-only strip names the other wire', () => {
    expect(holeChipTextFor(LAYOUT, 'a25')).toBe('導線 W8 · a25（U1 PA0 這一排）')
    expect(holeChipTextFor(LAYOUT, 'a20')).toBe('導線 W7 · a20（U1 PA5 這一排）')
    // W5's strip a58–e58 holds only its own end: no mate → the plain hole
    expect(holeChipTextFor(LAYOUT, 'a58')).toBe('導線 W5 · a58')
    // an empty hole on that strip: the wire is what it connects to
    expect(holeChipTextFor(LAYOUT, 'c58')).toBe('c58（導線 W5 這一排）')
    expect(holeChipTextFor(LAYOUT, 'c62')).toBeNull() // nothing on it
  })

  it('a part pin leads with the H1 full name (pinLabel with the id)', () => {
    const led = getEntry('led')!
    const r = getEntry('resistor')!
    expect(holeChipTextFor(LAYOUT, 'b50')).toBe(`${pinLabel(led, led.pins[0], { id: 'LED1' })}· b50`)
    expect(holeChipTextFor(LAYOUT, 'd40')).toBe(`${pinLabel(r, r.pins[0], { id: 'R2' })} · d40`)
    expect(holeChipTextFor(LAYOUT, 'd40')).toBe('R2 第 1 腳 · d40')
    // a lone board's pins carry the board id too (release QA SC-F2 — only U1's own inspector drops it)
    expect(holeChipTextFor(LAYOUT, 'c20')).toBe('U1 PA5（板上 A5）· c20')
  })

  it('English follows the same shape', () => {
    __setLangForTests('en')
    expect(holeChipTextFor(LAYOUT, 'b25')).toBe(endpointName(LAYOUT, 'b25'))
    expect(holeChipTextFor(LAYOUT, 'd40')).toBe('R2 lead 1 · d40')
  })
})

describe('portrait framing: anchorY', () => {
  const HOME_DIR = new THREE.Vector3(-6, 36, 40).normalize()
  const pts: THREE.Vector3[] = []
  for (const x of [-14, 42]) for (const y of [0, 3]) for (const z of [-2, 9]) pts.push(new THREE.Vector3(x, y, z))
  // a phone: narrow and tall — the long circuit is width-bound
  const win: FitWindow = { xl: -0.2, xr: 0.2, yb: -0.42, yt: 0.4 }

  function extentsY(tgt: THREE.Vector3, d: number) {
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    cam.position.copy(HOME_DIR).multiplyScalar(d).add(tgt)
    cam.lookAt(tgt)
    cam.updateMatrixWorld()
    let y0 = Infinity
    let y1 = -Infinity
    for (const p of pts) {
      const v = p.clone().applyMatrix4(cam.matrixWorldInverse)
      const sy = v.y / -v.z
      y0 = Math.min(y0, sy)
      y1 = Math.max(y1, sy)
    }
    return { y0, y1 }
  }

  it('0.5 is the classic centred fit, bit for bit', () => {
    const a = new THREE.Vector3(14, 0, 3.5)
    const b = new THREE.Vector3(14, 0, 3.5)
    const da = fitCornersAlongHome(pts, win, a)
    const db = fitCornersAlongHome(pts, win, b, undefined, 0.5)
    expect(db).toBe(da)
    expect(b.x).toBe(a.x)
    expect(b.z).toBe(a.z)
  })

  it('a smaller anchor lifts the box: that share of the spare height stays above it', () => {
    const tgt = new THREE.Vector3(14, 0, 3.5)
    const d = fitCornersAlongHome(pts, win, tgt, undefined, 0.2)
    const e = extentsY(tgt, d)
    const slack = win.yt - win.yb - (e.y1 - e.y0)
    expect(slack).toBeGreaterThan(0.1) // width-bound: plenty of spare height
    expect(e.y1).toBeLessThanOrEqual(win.yt + 1e-6)
    expect(e.y0).toBeGreaterThanOrEqual(win.yb - 1e-6)
    expect(Math.abs(win.yt - e.y1 - 0.2 * slack)).toBeLessThan(2e-3)
    expect(tgt.y).toBe(0)
  })
})

describe('probe menu: a deliberate second scope probe', () => {
  it('a net the scope already measures offers 「再放一支示波器探棒（CH2）」 after 「在示波器中檢視（CH1）」', () => {
    const m = probeMenuModel({ kind: 'hole', ref: 'a44' })
    const keys = m.items.map((i) => i.key)
    expect(keys).toEqual(['logic', 'scope', 'scope-more', 'select'])
    expect(m.items[1].label).toBe('在示波器中檢視（CH1）')
    expect(m.items[1].reveal).toBe('scope')
    expect(m.items[2].label).toBe('再放一支示波器探棒（CH2）')
    expect(m.items[2].title).toBe('P1 已經在 CH1 量這個網路——這會再放一支探棒')
  })

  it('an unmeasured net has no second-probe row; an analyzer channel is a reveal row', () => {
    expect(probeMenuModel({ kind: 'hole', ref: 'a30' }).items.map((i) => i.key)).not.toContain('scope-more')
    useLab.setState({ logicChannels: [{ index: 0, label: 'PA5 LED', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA5' } }] })
    const m = probeMenuModel({ kind: 'hole', ref: 'c20' })
    expect(m.items[0].label).toBe('在邏輯分析儀中檢視（PA5 LED）')
    expect(m.items[0].reveal).toBe('logic')
  })

  it('never offers a probe it would refuse: a net with no free hole greys the rows out and says why', () => {
    const full: CircuitLayout = {
      version: 1,
      components: [
        { id: 'R9', type: 'resistor', holes: ['a60', 'f60'] },
        { id: 'R11', type: 'resistor', holes: ['c60', 'c62'] },
        { id: 'R12', type: 'resistor', holes: ['d60', 'd62'] },
        { id: 'R13', type: 'resistor', holes: ['e60', 'e62'] },
      ],
      wires: [],
    }
    useStore.setState({ layout: { ...full, components: [...full.components, { id: 'R10', type: 'resistor', holes: ['b60', 'b62'] }] } })
    const scope = probeMenuModel({ kind: 'hole', ref: 'a60' }).items.find((i) => i.key === 'scope')!
    expect(scope.disabled).toBe(true)
    expect(scope.title).toMatch(/^a60 所在的網路已經沒有空孔：/)
    expect(scope.note).toBe('a60 所在的網路已經沒有空孔')
    // a probe already on that full net: show it; a second one cannot go anywhere
    useStore.setState({ layout: { ...full, components: [...full.components, { id: 'P1', type: 'scope_probe', holes: ['b60'], params: { channel: 1 } }] } })
    const m = probeMenuModel({ kind: 'hole', ref: 'a60' })
    expect(m.items[1].label).toBe('在示波器中檢視（CH1）')
    const more = m.items.find((i) => i.key === 'scope-more')!
    expect(more.disabled).toBe(true)
    expect(more.note).toBe('a60 所在的網路已經沒有空孔')
  })

  it('the second-probe row places a real probe on the same net, one undo step', async () => {
    const m = probeMenuModel({ kind: 'hole', ref: 'a44' })
    m.items.find((i) => i.key === 'scope-more')!.run()
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    const probes = useStore.getState().layout.components.filter((c) => c.type === 'scope_probe')
    expect(probes).toHaveLength(2)
    expect(Number(probes[1].params?.channel)).toBe(2)
    useStore.getState().undo()
    expect(useStore.getState().layout.components.filter((c) => c.type === 'scope_probe')).toHaveLength(1)
  })
})

describe('SC-13 (4): the convention colour follows a re-route', () => {
  it('a signal-yellow wire moved onto the − rail turns black in the same undo step; a picked colour stays', () => {
    moveWireEndTo('W7', 'to', 'top-20')
    const w7 = useStore.getState().layout.wires.find((w) => w.id === 'W7')!
    expect(w7.to).toBe('top-20')
    expect(w7.color).toBe('black')
    useStore.getState().undo()
    const back = useStore.getState().layout.wires.find((w) => w.id === 'W7')!
    expect(back.to).toBe('e36')
    expect(back.color).toBe('yellow')
    moveWireEndTo('W8', 'to', 'top-21')
    expect(useStore.getState().layout.wires.find((w) => w.id === 'W8')!.color).toBe('green')
  })
})
