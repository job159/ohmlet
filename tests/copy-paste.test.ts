/**
 * Copy / paste WITH the settings (round 5 — Ctrl/⌘+C／V／X／D, the selection
 * pill's and the long-press sheet's 「複製」): the pure planner
 * (src/state/clipboard.ts), the store's one-step pasteParts, the glue and its
 * words (src/ui/chrome/copy-paste.ts), a Blue Pill's copy running the same
 * firmware across undo / redo (lab.copyFirmware), the key decider, and the
 * history wording of a paste (「放上 R2、LED2、導線 W3」, never 「載入電路」).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/mcu/all'
import { __setLangForTests } from '../src/i18n'
import { netIdForHole, parseHole } from '../src/model/breadboard'
import type { CircuitLayout, ParamValue } from '../src/model/types'
import type { FirmwareImage } from '../src/mcu/firmware'
import type { HostQuery, HostQueryResult, LogicChannelConfig, SimHost, SimHostCallbacks } from '../src/sim/coordinator/api'
import { clipFromSelection, planPaste, wiresLeftLoose, type PartClip } from '../src/state/clipboard'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore } from '../src/state/firmware-store'
import * as L from '../src/state/lab'
import * as S from '../src/state/store'
import { SHORTCUTS, SHORTCUT_GROUPS, shortcutKeysText } from '../src/ui/chrome/ShortcutsSheet'
import {
  __resetClipForTests,
  clipboardClip,
  clipboardKeyAction,
  copySelectionWithFeedback,
  cutSelectionWithFeedback,
  duplicateWithFeedback,
  noteSelectionChange,
  noteViewPress,
  pasteWithFeedback,
  runClipboardKey,
  textSelectionActive,
  type ClipboardKeyContext,
} from '../src/ui/chrome/copy-paste'
import { describeLayoutChange, historyStepText, redoWithFeedback, undoWithFeedback } from '../src/ui/chrome/edit-feedback'
import { getToasts, type ToastItem } from '../src/ui/kit'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

const st = () => S.useStore.getState()
const comp = (id: string) => st().layout.components.find((c) => c.id === id)
const wire = (id: string) => st().layout.wires.find((w) => w.id === id)
const lastToast = (): ToastItem | undefined => getToasts()[getToasts().length - 1]

function resetDocument(layout: CircuitLayout): void {
  st().resetSim()
  S.__resetHistoryForTests()
  S.useStore.setState({ layout, selection: [], mode: { kind: 'select' }, hoverHole: null, canUndo: false, canRedo: false })
}

/** The strip nets a layout's parts and wire ends use. */
function stripNets(layout: CircuitLayout, ids?: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  const add = (ref: string) => {
    const h = parseHole(ref)
    if (h?.kind === 'strip') out.add(netIdForHole(h))
  }
  for (const c of layout.components) if (!ids || ids.has(c.id)) for (const ref of c.holes ?? []) add(ref)
  for (const w of layout.wires) if (!ids || ids.has(w.id)) [w.from, w.to].forEach(add)
  return out
}

/** R1 + LED1 fed from the rails: a part pair, its jumper-free strips, two power feeds. */
const PAIR: CircuitLayout = {
  version: 1,
  components: [
    { id: 'R1', type: 'resistor', holes: ['a10', 'a14'], params: { resistance: 220 } },
    { id: 'LED1', type: 'led', holes: ['c14', 'c18'], params: { color: 'blue' } },
  ],
  wires: [
    { id: 'W1', from: 'top+7', to: 'e10', color: 'red' },
    { id: 'W2', from: 'e18', to: 'top-13', color: 'black' },
  ],
}

const KEYS: ClipboardKeyContext = { legacy: false, editableTarget: false, textSelected: false, selectionCount: 1, modalOpen: false }

beforeEach(() => {
  __setLangForTests('zh-TW')
  __resetClipForTests()
})
afterEach(() => {
  __setLangForTests('zh-TW')
  S.setOffboardPlacementPolicy(null)
})

// ---------------------------------------------------------------------------
// the store: one step, the settings, the ids, the isolation rule
// ---------------------------------------------------------------------------

describe('Ctrl+C／Ctrl+V — the store’s pasteParts', () => {
  beforeEach(() => resetDocument(PAIR))

  it('copies the parts with their settings and power feeds beside the source, as ONE undo step', () => {
    st().marqueeSelect(['R1', 'LED1'])
    expect(copySelectionWithFeedback()).toBe(true)
    expect(lastToast()?.text).toBe('已複製 R1、LED1——按 Ctrl+V 貼上')
    const before = st().layout
    expect(pasteWithFeedback()).toBe(true)
    // R2 / LED2 / W3 / W4 — the ids addComponent and addWire would give
    expect(comp('R2')).toEqual({ id: 'R2', type: 'resistor', holes: ['a20', 'a24'], params: { resistance: 220 } })
    expect(comp('LED2')).toEqual({ id: 'LED2', type: 'led', holes: ['c24', 'c28'], params: { color: 'blue' } })
    // beside: one free column after the source (col 19), the rail ends on the same rails, nearest x
    expect(wire('W3')).toEqual({ id: 'W3', from: 'top+15', to: 'e20', color: 'red' })
    expect(wire('W4')).toEqual({ id: 'W4', from: 'e28', to: 'top-21', color: 'black' })
    // the copy is selected; the originals are untouched (the very same objects)
    expect(st().selection).toEqual(['R2', 'LED2'])
    expect(st().layout.components.slice(0, 2)).toEqual(before.components)
    expect(st().layout.components[0]).toBe(before.components[0])
    expect(lastToast()?.text).toBe('已貼上 R2、LED2（連同導線 W3、W4）') // the wires that came along are named (persona fix)
    expect(lastToast()?.action?.label).toBe('復原')
    // one undo step takes it all back; redo brings it again
    const pasted = st().layout
    st().undo()
    expect(st().layout).toBe(before)
    expect(st().canUndo).toBe(false)
    st().redo()
    expect(st().layout).toBe(pasted)
  })

  it('the 〔復原〕 of the toast undoes the paste and says 「已復原：放上 R2、LED2、導線 W3 等 4 項」', () => {
    st().marqueeSelect(['R1', 'LED1'])
    copySelectionWithFeedback()
    const before = st().layout
    pasteWithFeedback()
    lastToast()?.action?.run()
    expect(st().layout).toBe(before)
    expect(lastToast()?.text).toBe('已復原：放上 R2、LED2、導線 W3 等 4 項')
  })

  it('never shares a strip with the circuit (validateLayout checks holes, not nets)', () => {
    // R5 sits in row e of columns 8 / 12: the copy one free column right (a8–a12) would join its strips
    resetDocument({
      version: 1,
      components: [
        { id: 'R1', type: 'resistor', holes: ['a2', 'a6'] },
        { id: 'R5', type: 'resistor', holes: ['e8', 'e12'] },
      ],
      wires: [],
    })
    const used = stripNets(st().layout)
    st().select('R1')
    copySelectionWithFeedback()
    pasteWithFeedback()
    expect(comp('R2')?.holes).toEqual(['a9', 'a13'])
    const mine = stripNets(st().layout, new Set(['R2']))
    expect([...mine].filter((n) => used.has(n))).toEqual([])
  })

  it('moves whole halves only (0 or ±5 rows): a blocked row goes to the other half, never one row down', () => {
    resetDocument({
      version: 1,
      board: 'half',
      components: [
        { id: 'R6', type: 'resistor', holes: ['a1', 'a8'] },
        { id: 'R1', type: 'resistor', holes: ['a12', 'a16'], params: { resistance: 1000 } },
        { id: 'R5', type: 'resistor', holes: ['a20', 'a30'] },
      ],
      wires: [],
    })
    st().select('R1')
    copySelectionWithFeedback()
    pasteWithFeedback()
    expect(comp('R2')).toEqual({ id: 'R2', type: 'resistor', holes: ['f12', 'f16'], params: { resistance: 1000 } })
  })

  it('packages move by columns only (a DIP stays anchored in row f, a footprint in its row)', () => {
    resetDocument({
      version: 1,
      components: [
        { id: 'U1', type: 'ne555', at: 'f5' },
        { id: 'SW1', type: 'pushbutton', at: 'f15' },
      ],
      wires: [],
    })
    st().marqueeSelect(['U1', 'SW1'])
    duplicateWithFeedback()
    expect(comp('U2')?.at).toBe('f19') // one free column right of the group (cols 5–17)
    expect(comp('SW2')?.at).toBe('f29') // the group keeps its shape
    expect(lastToast()?.text).toBe('已複製一份：U2、SW2')
  })

  it('pastes on the hovered hole when the copy fits there (top-left on it), else beside the source', () => {
    resetDocument({ version: 1, components: [{ id: 'R1', type: 'resistor', holes: ['a10', 'a14'] }], wires: [] })
    st().select('R1')
    copySelectionWithFeedback()
    pasteWithFeedback({ near: 'b40' })
    expect(comp('R2')?.holes).toEqual(['b40', 'b44'])
    // hovering the original itself: it cannot go there — beside the source instead
    st().undo()
    pasteWithFeedback({ near: 'a12' })
    expect(comp('R2')?.holes).toEqual(['a16', 'a20'])
  })

  it('a copy fed from a rail goes to the hovered half; its feed stays on its own rail unless the rail across is one net with it', () => {
    st().select('R1')
    copySelectionWithFeedback()
    pasteWithFeedback({ near: 'g40' })
    // the whole half moves (a / e → f / j); top+ and bot+ are separate nets: the feed reaches back to top+
    expect(comp('R2')?.holes).toEqual(['f40', 'f44'])
    expect(wire('W3')).toEqual({ id: 'W3', from: 'top+32', to: 'j40', color: 'red' })
    // bot+ bridged to top+ (one net): the feed takes the near rail
    resetDocument({ ...PAIR, wires: [...PAIR.wires, { id: 'W5', from: 'top+0', to: 'bot+0', color: 'red' }] })
    st().select('R1')
    copySelectionWithFeedback()
    pasteWithFeedback({ near: 'g40' })
    expect(comp('R2')?.holes).toEqual(['f40', 'f44'])
    expect(wire('W3')).toEqual({ id: 'W3', from: 'bot+32', to: 'j40', color: 'red' })
  })

  it('on the hovered hole the copied PARTS’ top-left lands there, not their feed wire’s end', () => {
    // R1 in row c, fed from top+ into row a: hovering c40 puts R1’s copy in row c
    resetDocument({
      version: 1,
      components: [{ id: 'R1', type: 'resistor', holes: ['c10', 'c14'], params: { resistance: 330 } }],
      wires: [{ id: 'W1', from: 'top+5', to: 'a10', color: 'red' }],
    })
    st().select('R1')
    copySelectionWithFeedback()
    pasteWithFeedback({ near: 'c40' })
    expect(comp('R2')?.holes).toEqual(['c40', 'c44'])
    expect(wire('W2')?.to).toBe('a40')
  })

  it('a hovered free spot the copy does not fit says so; hovering the original does not', () => {
    resetDocument({ version: 1, components: [{ id: 'R1', type: 'resistor', holes: ['a10', 'a14'] }], wires: [] })
    st().select('R1')
    copySelectionWithFeedback()
    pasteWithFeedback({ near: 'a63' }) // the board’s last column: a 5-hole resistor cannot start there
    expect(comp('R2')?.holes).toEqual(['a16', 'a20'])
    expect(lastToast()?.text).toBe('已貼上 R2——滑鼠指的地方放不下')
    st().undo()
    pasteWithFeedback({ near: 'a12' }) // on R1 itself: beside it, as asked
    expect(lastToast()?.text).toBe('已貼上 R2')
  })

  it('click, Ctrl+X, Ctrl+V with the pointer still on the part puts it back joined as it was', () => {
    const cases: [string, string, string[]][] = [
      ['R1', 'a10', ['a10', 'a14']],
      ['R1', 'a12', ['a10', 'a14']],
      ['R1', 'a13', ['a10', 'a14']],
      ['R1', 'b12', ['a10', 'a14']],
      ['LED1', 'c16', ['c14', 'c18']],
      ['LED1', 'c15', ['c14', 'c18']],
    ]
    for (const [id, near, holes] of cases) {
      resetDocument(PAIR)
      st().select(id)
      cutSelectionWithFeedback()
      pasteWithFeedback({ near })
      expect(comp(id)?.holes, `${id} with the pointer on ${near}`).toEqual(holes)
      expect(st().layout.wires).toHaveLength(2) // its feed back on its own holes, no second one
      // no 「放不下」: the pointer was on its own spot; the cut feed wire comes back with it (named — persona fix)
      expect(lastToast()?.text).toMatch(new RegExp(`^已貼上 ${id}（連同導線 W[0-9]）$`))
    }
    // R1 in row c fed into row a (the e2e circuit), pointer on c11
    resetDocument({
      version: 1,
      components: [
        { id: 'R1', type: 'resistor', holes: ['c10', 'c14'], params: { resistance: 330 } },
        { id: 'LED1', type: 'led', holes: ['d14', 'd18'], params: { color: 'green' } },
      ],
      wires: [{ id: 'W3', from: 'top+5', to: 'a10', color: 'red' }],
    })
    const before = st().layout
    st().select('R1')
    cutSelectionWithFeedback()
    pasteWithFeedback({ near: 'c11' })
    expect(comp('R1')?.holes).toEqual(['c10', 'c14'])
    expect(wire('W3')).toEqual(before.wires[0])
  })

  it('copy, Delete, paste: back on its own spot, using the feed wire the Delete key left there', () => {
    st().select('R1')
    copySelectionWithFeedback()
    st().removeSelected()
    expect(wire('W1')).toBeDefined() // the Delete key leaves wires
    pasteWithFeedback()
    expect(comp('R1')?.holes).toEqual(['a10', 'a14'])
    expect(st().layout.wires.map((w) => w.id)).toEqual(['W1', 'W2']) // not a second feed beside the first
    expect(st().selection).toEqual(['R1'])
    expect(lastToast()?.text).toBe('已貼上 R1') // the feed wire was already there: nothing came along
  })

  it('a paste right after a cut puts the parts back where they were (their loose feed wire goes and comes back)', () => {
    st().select('R1')
    const before = st().layout
    expect(cutSelectionWithFeedback()).toBe(true)
    expect(comp('R1')).toBeUndefined()
    expect(wire('W1')).toBeUndefined() // its power feed would hang loose: the cut moves it
    expect(wire('W2')).toBeDefined() // LED1's feed stays
    expect(lastToast()?.text).toBe('已剪下 R1——按 Ctrl+V 貼上')
    expect(lastToast()?.action?.label).toBe('復原')
    pasteWithFeedback()
    expect(comp('R1')).toEqual(before.components[0])
    expect(wire('W1')).toEqual(before.wires[0])
    // two steps: the paste, then the cut
    st().undo()
    st().undo()
    expect(st().layout).toBe(before)
  })

  it('the clip is not the document: it survives undo, and pastes after the originals are gone', () => {
    st().select('R1')
    copySelectionWithFeedback()
    st().removeSelected()
    st().undo()
    expect(clipboardClip()?.components.map((c) => c.id)).toEqual(['R1'])
    resetDocument({ version: 1, components: [], wires: [] })
    pasteWithFeedback()
    expect(st().layout.components).toEqual([{ id: 'R1', type: 'resistor', holes: ['a10', 'a14'], params: { resistance: 220 } }])
    expect(st().layout.wires).toEqual([{ id: 'W1', from: 'top+7', to: 'e10', color: 'red' }])
  })

  it('on its own spot a copy joins only what it shared when it was taken — never a part placed there since', () => {
    st().select('R1')
    cutSelectionWithFeedback()
    // a new part in R1’s old strip 10 since the cut
    S.useStore.setState({ layout: { ...st().layout, components: [...st().layout.components, { id: 'R9', type: 'resistor', holes: ['b10', 'b4'] }] } })
    pasteWithFeedback()
    const r1 = comp('R1')!
    expect(r1.holes).not.toEqual(['a10', 'a14'])
    const others = stripNets({ ...st().layout, components: st().layout.components.filter((c) => c.id !== 'R1'), wires: [] })
    expect([...stripNets(st().layout, new Set(['R1']))].filter((n) => others.has(n))).toEqual([])
  })

  it('Ctrl+V with nothing copied says how to copy; a copy of only stranded wires says they need their parts', () => {
    expect(pasteWithFeedback()).toBe(false)
    expect(lastToast()?.text).toBe('還沒有複製元件——先選取元件，再按 Ctrl+C')
    resetDocument({
      version: 1,
      components: [
        { id: 'R1', type: 'resistor', holes: ['a10', 'a14'] },
        { id: 'R2', type: 'resistor', holes: ['a20', 'a24'] },
      ],
      wires: [{ id: 'W1', from: 'e14', to: 'e20' }],
    })
    st().select('W1')
    expect(copySelectionWithFeedback()).toBe(false)
    expect(lastToast()?.text).toBe('沒有可複製的元件——導線會跟著它接的元件一起複製')
  })

  it('Ctrl+D copies beside the selection without touching the clip Ctrl+V pastes', () => {
    st().select('LED1')
    copySelectionWithFeedback()
    st().select('R1')
    duplicateWithFeedback()
    expect(comp('R2')?.params).toEqual({ resistance: 220 })
    expect(st().selection).toEqual(['R2'])
    expect(lastToast()?.text).toBe('已複製一份：R2（連同導線 W3）') // the wires that came along are named (persona fix)
    expect(clipboardClip()?.components.map((c) => c.id)).toEqual(['LED1'])
  })

  it('pasting ends place / wire mode', () => {
    st().select('R1')
    copySelectionWithFeedback()
    S.useStore.setState({ mode: { kind: 'wire', from: 'b30', color: 'red' } })
    pasteWithFeedback()
    expect(st().mode).toEqual({ kind: 'select' })
  })
})

// ---------------------------------------------------------------------------
// what comes along
// ---------------------------------------------------------------------------

describe('what a copy takes', () => {
  it('the wires between the copied parts and their power feeds — not a wire to a part that stays', () => {
    const L1: CircuitLayout = {
      version: 1,
      components: [
        { id: 'R1', type: 'resistor', holes: ['a10', 'a14'] },
        { id: 'R2', type: 'resistor', holes: ['a20', 'a24'] },
        { id: 'LED1', type: 'led', holes: ['c30', 'c34'] },
      ],
      wires: [
        { id: 'W1', from: 'e14', to: 'e20' }, // R1 ↔ R2 (both copied)
        { id: 'W2', from: 'top+3', to: 'e10' }, // R1's feed
        { id: 'W3', from: 'e24', to: 'e30' }, // R2 ↔ LED1 (stays): dropped
        { id: 'W4', from: 'b40', to: 'b45' }, // nothing to do with them
      ],
    }
    const clip = clipFromSelection(L1, ['R1', 'R2', 'W3'])!
    expect(clip.components.map((c) => c.id)).toEqual(['R1', 'R2'])
    expect(clip.wires.map((w) => w.id)).toEqual(['W1', 'W2']) // W3 is selected but leads to LED1
    expect(clip.sourceIds).toEqual(['R1', 'R2'])
    // a selected free jumper comes along on its own
    expect(clipFromSelection(L1, ['W4'])?.wires.map((w) => w.id)).toEqual(['W4'])
    // a cut takes the feed and the jumper with the parts; W3 still serves LED1
    expect(wiresLeftLoose(L1, clip)).toEqual(['W1', 'W2'])
  })

  it('an instrument’s wires follow the copy: to a copied part, and its ground lead to a rail', () => {
    resetDocument({
      version: 1,
      components: [
        { id: 'FG1', type: 'function_generator', params: { frequency: 50 } },
        { id: 'R1', type: 'resistor', holes: ['a10', 'a14'] },
      ],
      wires: [
        { id: 'W1', from: 'FG1:out', to: 'e10' },
        { id: 'W2', from: 'FG1:gnd', to: 'top-3' },
      ],
    })
    st().marqueeSelect(['FG1', 'R1'])
    copySelectionWithFeedback()
    expect(clipboardClip()?.wires.map((w) => w.id)).toEqual(['W1', 'W2'])
    pasteWithFeedback()
    expect(comp('FG2')?.params).toEqual({ frequency: 50 })
    expect(comp('FG2')?.pos).toBeUndefined() // the default shelf, never on top of FG1
    expect(comp('R2')?.holes).toEqual(['a16', 'a20'])
    expect(wire('W3')).toEqual({ id: 'W3', from: 'FG2:out', to: 'e16' })
    // GND on the same rail, beside the copy: the generator works as its original does
    expect(wire('W4')?.from).toBe('FG2:gnd')
    expect(wire('W4')?.to).toMatch(/^top-\d+$/)
    expect(lastToast()?.text).toBe('已貼上 FG2、R2（連同導線 W3、W4）') // the wires that came along are named (persona fix)
  })

  it('a meter’s COM lead to the ground rail comes along; a source’s output to a rail never does — and the toast names it', () => {
    resetDocument({
      version: 1,
      components: [
        { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
        { id: 'R1', type: 'resistor', holes: ['a10', 'a14'] },
        { id: 'DMM1', type: 'multimeter', params: { mode: 'V' } },
      ],
      wires: [
        { id: 'W1', from: 'PS1:+', to: 'top+0', color: 'red' },
        { id: 'W2', from: 'PS1:-', to: 'top-0', color: 'black' },
        { id: 'W3', from: 'DMM1:IN', to: 'e14' },
        { id: 'W4', from: 'DMM1:COM', to: 'top-3' },
      ],
    })
    st().marqueeSelect(['R1', 'DMM1'])
    copySelectionWithFeedback()
    expect(clipboardClip()?.wires.map((w) => w.id)).toEqual(['W3', 'W4'])
    pasteWithFeedback()
    const dmm2 = st().layout.wires.filter((w) => w.from.startsWith('DMM2:'))
    expect(dmm2.map((w) => w.from)).toEqual(['DMM2:IN', 'DMM2:COM'])
    expect(dmm2[1].to).toMatch(/^top-\d+$/)
    // a second supply's + on top+ would fight PS1: it stays behind, and the copy says so
    resetDocument(st().layout)
    st().marqueeSelect(['PS1', 'W1', 'W2'])
    copySelectionWithFeedback()
    expect(clipboardClip()?.wires.map((w) => w.id)).toEqual(['W2'])
    expect(clipboardClip()?.left).toEqual(['W1'])
    expect(lastToast()?.text).toBe('已複製 PS1（導線 W1 沒有一起複製）——按 Ctrl+V 貼上')
    st().marqueeSelect(['PS1', 'W1', 'W2'])
    duplicateWithFeedback()
    expect(lastToast()?.text).toBe('已複製一份：PS2（連同導線 W7；導線 W1 沒有一起複製）') // the wires that came along are named (persona fix)
    expect(st().layout.wires.some((w) => w.from === 'PS2:+' || w.to === 'PS2:+')).toBe(false)
  })

  it('a scope probe re-picks the lowest free channel', () => {
    resetDocument({
      version: 1,
      components: [
        { id: 'PRB1', type: 'scope_probe', holes: ['b30'] },
        { id: 'PRB2', type: 'scope_probe', holes: ['b40'], params: { channel: 2 } },
      ],
      wires: [],
    })
    st().select('PRB2')
    duplicateWithFeedback()
    expect(comp('PRB3')?.params).toEqual({ channel: 3 })
  })

  it('a button kept pressed is copied released (the latch is transient), its other settings kept', () => {
    resetDocument({ version: 1, components: [{ id: 'SW1', type: 'pushbutton', at: 'f20', params: { pressed: true } }], wires: [] })
    st().select('SW1')
    copySelectionWithFeedback()
    pasteWithFeedback()
    expect(comp('SW2')).toEqual({ id: 'SW2', type: 'pushbutton', at: 'f24' })
    expect(comp('SW1')?.params).toEqual({ pressed: true }) // the original is not touched
  })
})

// ---------------------------------------------------------------------------
// no room
// ---------------------------------------------------------------------------

describe('no room', () => {
  it('says so with 〔加一塊麵包板〕, which grows the rig and pastes', () => {
    resetDocument({ version: 1, board: 'half', components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h5' }], wires: [] })
    const before = st().layout
    st().select('U1')
    expect(duplicateWithFeedback()).toBe(false)
    expect(st().layout).toBe(before) // nothing changed
    const toast = lastToast()!
    expect(toast.text).toBe('麵包板上沒有空位放 U1 的複本')
    expect(toast.action?.label).toBe('加一塊麵包板')
    toast.action!.run()
    expect(st().layout.boardCount).toBe(2)
    const at = parseHole(comp('U2')!.at!)
    expect(at?.kind === 'strip' && at.col).toBeGreaterThanOrEqual(31) // the second module: never across the seam
    expect(lastToast()?.text).toBe('已複製一份：U2')
  })

  it('a copy fed from a rail fills the other half before saying there is no room (its feed reaching back to its rail)', () => {
    resetDocument({
      version: 1,
      board: 'half',
      components: [{ id: 'R1', type: 'resistor', holes: ['a10', 'a14'], params: { resistance: 220 } }],
      wires: [{ id: 'W1', from: 'top+7', to: 'e10', color: 'red' }],
    })
    st().select('R1')
    const halves: string[] = []
    for (let i = 0; i < 5; i++) {
      const before = st().layout
      expect(duplicateWithFeedback(), `copy ${i + 2}`).toBe(true)
      const added = st().layout.components.filter((c) => !before.components.includes(c))
      const feed = st().layout.wires.filter((w) => !before.wires.includes(w))
      halves.push(added[0].holes![0][0])
      // never a strip of the circuit before it; the feed stays on top+ (bot+ is another net)
      const used = stripNets(before)
      expect([...stripNets(st().layout, new Set([...added.map((c) => c.id), ...feed.map((w) => w.id)]))].filter((n) => used.has(n))).toEqual([])
      expect(feed.map((w) => w.from)).toEqual([expect.stringMatching(/^top\+\d+$/)])
    }
    // the a–e half fills first (three copies fit beside R1 on a half board), then the f–j half
    expect(halves).toEqual(['a', 'a', 'a', 'f', 'f'])
  })

  it('a copy fed from a rail goes to another board-row when its own is full; 〔加一塊麵包板〕 grows down when it cannot grow right', () => {
    // a rig six modules wide (it cannot grow right), every strip of board-row 0 already in use
    const wires: CircuitLayout['wires'] = [{ id: 'W1', from: 'top+7', to: 'e10', color: 'red' }]
    for (let k = 1; k <= 180; k++) if (k !== 10 && k !== 14) wires.push({ id: `J${k}`, from: `c${k}`, to: `h${k}` })
    wires.push({ id: 'J10', from: 'h10', to: 'h14' })
    resetDocument({
      version: 1,
      board: 'half',
      boardCount: 6,
      components: [{ id: 'R1', type: 'resistor', holes: ['a10', 'a14'], params: { resistance: 220 } }],
      wires,
    })
    st().select('R1')
    expect(duplicateWithFeedback()).toBe(false)
    const toast = lastToast()!
    expect(toast.text).toBe('麵包板上沒有空位放 R1 的複本')
    toast.action!.run()
    expect(st().layout.boardRows).toBe(2)
    expect(comp('R2')?.holes?.every((h) => h.startsWith('1:'))).toBe(true)
    // board-row 1's top+ is another net: the feed reaches back to board-row 0's top+
    const feed = st().layout.wires[st().layout.wires.length - 1]
    expect(feed.from).toMatch(/^top\+\d+$/)
    expect(feed.to).toMatch(/^1:e\d+$/)
    expect(lastToast()?.text).toBe('已複製一份：R2（連同導線 W2）') // the wires that came along are named (persona fix)
  })

  it('the planner gives up after its validation budget rather than searching forever', () => {
    const full: CircuitLayout = { version: 1, board: 'half', components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h5' }], wires: [] }
    const clip: PartClip = clipFromSelection(full, ['U1'])!
    const plan = planPaste(full, clip, { allocId: () => 'U2', offboardPos: () => null })
    expect(plan).toEqual({ ok: false, reason: 'no-room' })
    expect(planPaste(full, { components: [], wires: [], sourceIds: [] }, { allocId: () => 'X', offboardPos: () => null })).toEqual({
      ok: false,
      reason: 'empty',
    })
  })
})

// ---------------------------------------------------------------------------
// the history wording
// ---------------------------------------------------------------------------

describe('the history names a paste as a placement', () => {
  it('parts AND wires added to a board whose parts stay the same objects: 「放上 …」; a load stays 「載入電路」', () => {
    const r1 = { id: 'R1', type: 'resistor', holes: ['a10', 'a14'] }
    const w1 = { id: 'W1', from: 'top+7', to: 'e10' }
    const before: CircuitLayout = { version: 1, components: [r1], wires: [w1] }
    const pasted: CircuitLayout = {
      ...before,
      components: [r1, { id: 'R2', type: 'resistor', holes: ['a20', 'a24'] }],
      wires: [w1, { id: 'W2', from: 'top+15', to: 'e20' }],
    }
    expect(describeLayoutChange(before, pasted)).toBe('放上 R2、導線 W2')
    expect(historyStepText('undo', describeLayoutChange(before, pasted))).toBe('已復原：放上 R2、導線 W2')
    // a load builds fresh objects (validateLayout): the same additions read as a whole circuit
    const loaded: CircuitLayout = JSON.parse(JSON.stringify(pasted))
    expect(describeLayoutChange(before, loaded)).toBe('載入電路')
    expect(describeLayoutChange({ version: 1, components: [], wires: [] }, pasted)).toBe('載入電路')
  })

  it('a paste onto an EMPTY board too (cut everything, paste, undo / redo): 「放上 R1、導線 W1」', () => {
    resetDocument({
      version: 1,
      components: [{ id: 'R1', type: 'resistor', holes: ['a10', 'a14'] }],
      wires: [{ id: 'W1', from: 'top+7', to: 'e10', color: 'red' }],
    })
    st().select('R1')
    cutSelectionWithFeedback()
    expect(st().layout.components.length + st().layout.wires.length).toBe(0)
    pasteWithFeedback()
    undoWithFeedback()
    expect(lastToast()?.text).toBe('已復原：放上 R1、導線 W1')
    redoWithFeedback()
    expect(lastToast()?.text).toBe('已重做：放上 R1、導線 W1')
  })
})

// ---------------------------------------------------------------------------
// the keys
// ---------------------------------------------------------------------------

describe('clipboardKeyAction', () => {
  const ctrl = (key: string, extra: Record<string, unknown> = {}) => ({ key, ctrlKey: true, ...extra })

  it('Ctrl / ⌘ + C, X, V, D', () => {
    expect(clipboardKeyAction(ctrl('c'), KEYS)).toBe('copy')
    expect(clipboardKeyAction({ key: 'c', metaKey: true }, KEYS)).toBe('copy')
    expect(clipboardKeyAction(ctrl('x'), KEYS)).toBe('cut')
    expect(clipboardKeyAction(ctrl('v'), KEYS)).toBe('paste')
    expect(clipboardKeyAction(ctrl('d'), KEYS)).toBe('duplicate')
    expect(clipboardKeyAction(ctrl('C'), KEYS)).toBe('copy') // caps lock
    // a non-Latin layout: the physical key
    expect(clipboardKeyAction(ctrl('с', { code: 'KeyC' }), KEYS)).toBe('copy')
    // a Latin layout means the letter typed (Dvorak's KeyC types j)
    expect(clipboardKeyAction(ctrl('j', { code: 'KeyC' }), KEYS)).toBe('pass')
    expect(clipboardKeyAction({ key: 'c' }, KEYS)).toBe('pass')
    expect(clipboardKeyAction(ctrl('z'), KEYS)).toBe('pass')
  })

  it('the browser keeps its own: Shift / Alt chords, text fields, modals, the classic chrome', () => {
    expect(clipboardKeyAction(ctrl('c', { shiftKey: true }), KEYS)).toBe('pass') // DevTools
    expect(clipboardKeyAction(ctrl('v', { altKey: true }), KEYS)).toBe('pass')
    for (const k of ['c', 'x', 'v', 'd']) {
      expect(clipboardKeyAction(ctrl(k), { ...KEYS, editableTarget: true })).toBe('pass')
      expect(clipboardKeyAction(ctrl(k), { ...KEYS, modalOpen: true })).toBe('pass')
      expect(clipboardKeyAction(ctrl(k), { ...KEYS, legacy: true })).toBe('pass')
    }
  })

  it('selected text is copied by the browser; nothing selected leaves Ctrl+C／X／D alone; Ctrl+V always pastes', () => {
    expect(clipboardKeyAction(ctrl('c'), { ...KEYS, textSelected: true })).toBe('pass')
    expect(clipboardKeyAction(ctrl('x'), { ...KEYS, textSelected: true })).toBe('pass')
    expect(clipboardKeyAction(ctrl('d'), { ...KEYS, textSelected: true })).toBe('duplicate')
    expect(clipboardKeyAction(ctrl('v'), { ...KEYS, textSelected: true })).toBe('paste')
    for (const k of ['c', 'x', 'd']) expect(clipboardKeyAction(ctrl(k), { ...KEYS, selectionCount: 0 })).toBe('pass')
    expect(clipboardKeyAction(ctrl('v'), { ...KEYS, selectionCount: 0 })).toBe('paste')
  })

  it('a held key acts once: auto-repeat of Ctrl+V／Ctrl+D adds no copies (the key is still taken)', () => {
    resetDocument(PAIR)
    st().select('R1')
    copySelectionWithFeedback()
    runClipboardKey('paste')
    const once = st().layout
    for (let i = 0; i < 5; i++) runClipboardKey('paste', { repeat: true })
    runClipboardKey('duplicate', { repeat: true })
    expect(st().layout).toBe(once)
    expect(st().layout.components.map((c) => c.id)).toEqual(['R1', 'LED1', 'R2'])
  })

  it('a text selection left over from before a press on the 3D view does not keep Ctrl+C from the parts', () => {
    vi.stubGlobal('window', { getSelection: () => ({ isCollapsed: false, toString: () => 'UART: hello' }) })
    try {
      noteSelectionChange() // the learner selected a UART line
      expect(textSelectionActive()).toBe(true)
      noteViewPress() // then clicked a part (the press did not clear the selection)
      expect(textSelectionActive()).toBe(false)
      noteSelectionChange() // selected text again
      expect(textSelectionActive()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('the shortcuts list has the four rows in 編輯, each two keys (C alone stays 顯示電流)', () => {
    const editing = SHORTCUT_GROUPS.find((g) => g.title === 'Editing')!.rows
    for (const id of ['copy', 'cut', 'paste', 'duplicate'] as const) expect(editing).toContain(SHORTCUTS[id])
    expect(shortcutKeysText('copy')).toBe('Ctrl+C')
    expect(shortcutKeysText('paste')).toBe('Ctrl+V')
    expect(shortcutKeysText('cut')).toBe('Ctrl+X')
    expect(shortcutKeysText('duplicate')).toBe('Ctrl+D')
  })

  it('App.tsx routes them after Ctrl+S (product chrome) and the long-press 複製 copies at once there', () => {
    const app = read('src/App.tsx')
    const save = app.indexOf('void saveProjectFile()')
    const keys = app.indexOf(': clipboardKeyAction(e, {')
    expect(keys).toBeGreaterThan(save)
    expect(app.indexOf("if (e.key === '?'", keys)).toBeGreaterThan(keys)
    expect(app).toContain('runClipboardKey(clipAction, { near: st.hoverHole, repeat: e.repeat })')
    expect(app).toContain('legacy ? duplicateComponent(targetComp.id) : duplicateWithFeedback([targetComp.id])')
    const pill = read('src/ui/chrome/SelectionPill.tsx')
    expect(pill).toContain('{!legacy && (')
    expect(pill).toContain("aria-label={t('Duplicate the {n} selected items|copy-paste', { n: shown })}")
  })
})

// ---------------------------------------------------------------------------
// a Blue Pill's copy runs the same firmware (lab.copyFirmware)
// ---------------------------------------------------------------------------

const file = (name: string): { name: string; bytes: Uint8Array } => ({
  name,
  bytes: new Uint8Array(readFileSync(`firmware/dist/${name}`)),
})

const BOARD: CircuitLayout = {
  version: 1,
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+3', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-3', color: 'black' },
  ],
}

class MemoryStorage {
  private m = new Map<string, string>()
  get length(): number {
    return this.m.size
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
  clear(): void {
    this.m.clear()
  }
}

class FakeHost implements SimHost {
  readonly kind = 'inline' as const
  readonly calls: { method: string; args: unknown[] }[] = []
  constructor(readonly cb: SimHostCallbacks) {}
  private rec(method: string, args: unknown[]): void {
    this.calls.push({ method, args })
  }
  of(method: string) {
    return this.calls.filter((c) => c.method === method)
  }
  load(layout: CircuitLayout, rev: number): void {
    this.rec('load', [layout, rev])
  }
  setFirmware(componentId: string, image: FirmwareImage | null): void {
    this.rec('setFirmware', [componentId, image])
  }
  start(speed: number): void {
    this.rec('start', [speed])
  }
  pause(): void {
    this.rec('pause', [])
  }
  reset(): void {
    this.rec('reset', [])
  }
  setSpeed(s: number): void {
    this.rec('setSpeed', [s])
  }
  stepTime(s: number): void {
    this.rec('stepTime', [s])
  }
  mcuReset(id: string): void {
    this.rec('mcuReset', [id])
  }
  mcuHalt(id: string): void {
    this.rec('mcuHalt', [id])
  }
  mcuResume(id: string): void {
    this.rec('mcuResume', [id])
  }
  mcuStep(id: string): void {
    this.rec('mcuStep', [id])
  }
  setRuntimeParam(id: string, key: string, value: ParamValue): void {
    this.rec('setRuntimeParam', [id, key, value])
  }
  uartSend(componentId: string, port: string, bytes: Uint8Array): void {
    this.rec('uartSend', [componentId, port, bytes])
  }
  setLogicChannels(channels: LogicChannelConfig[]): void {
    this.rec('setLogicChannels', [channels])
  }
  query(q: HostQuery): Promise<HostQueryResult> {
    this.rec('query', [q])
    return Promise.reject(new Error('no answer scripted'))
  }
  dispose(): void {
    this.rec('dispose', [])
  }
}

describe('a Blue Pill’s copy runs the same firmware (undo / redo follow it)', () => {
  const lab = () => L.useLab.getState()
  const bound = (): Record<string, string> => Object.fromEntries(Object.entries(lab().firmware).map(([id, r]) => [id, r.name]))
  let hosts: FakeHost[] = []
  const host = (): FakeHost => hosts[hosts.length - 1]
  const sent = (h: FakeHost): string[] =>
    h.of('setFirmware').map((c) => `${c.args[0] as string}:${c.args[1] === null ? 'none' : (c.args[1] as FirmwareImage).name}`)

  beforeEach(async () => {
    vi.stubGlobal('window', { localStorage: new MemoryStorage(), matchMedia: (q: string) => ({ matches: false, media: q }) })
    __setFirmwareBlobStoreForTests({ ...createMemoryBlobStore(), persistent: true })
    hosts = []
    S.__setSimHostFactoryForTests((cb) => {
      const h = new FakeHost(cb)
      hosts.push(h)
      return h
    })
    S.__setSimClockForTests(() => 0)
    L.__setLabClockForTests(() => 0)
    resetDocument(BOARD)
    await L.__rebootLabForTests()
    expect((await lab().loadFirmware('U1', file('hal-blink.elf'))).ok).toBe(true)
  })

  afterEach(() => {
    S.__setSimHostFactoryForTests(null)
    S.__setSimClockForTests(null)
    L.__setLabClockForTests(null)
    __setFirmwareBlobStoreForTests(null)
    vi.unstubAllGlobals()
  })

  it('copy + paste binds the same image to U2, sends it, and the toast says so; undo drops it, redo brings it back', () => {
    st().select('U1')
    copySelectionWithFeedback()
    pasteWithFeedback()
    expect(comp('U2')?.at).toBe('h31')
    expect(bound()).toEqual({ U1: 'hal-blink.elf', U2: 'hal-blink.elf' })
    expect(sent(host()).slice(-1)).toEqual(['U2:hal-blink.elf'])
    expect(lastToast()?.text).toBe('已貼上 U2（連同韌體 hal-blink.elf）')
    st().undo()
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
    expect(sent(host()).slice(-1)).toEqual(['U2:none'])
    st().redo()
    expect(bound()).toEqual({ U1: 'hal-blink.elf', U2: 'hal-blink.elf' })
    expect(sent(host()).slice(-1)).toEqual(['U2:hal-blink.elf'])
  })

  it('cut + paste: the board comes back as U1 with its firmware', () => {
    st().select('U1')
    cutSelectionWithFeedback()
    expect(bound()).toEqual({})
    pasteWithFeedback()
    expect(comp('U1')?.at).toBe('h10')
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
    expect(lastToast()?.text).toBe('已貼上 U1（連同韌體 hal-blink.elf）')
  })

  it('cut + paste, then undo twice: the original board comes back WITH its firmware (redo twice: the pasted one too)', () => {
    const original = comp('U1')
    st().select('U1')
    cutSelectionWithFeedback()
    pasteWithFeedback()
    expect(comp('U1')).not.toBe(original) // a new board under the same id
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
    st().undo() // the paste
    expect(bound()).toEqual({})
    st().undo() // the cut
    expect(comp('U1')).toBe(original)
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
    expect(sent(host()).slice(-1)).toEqual(['U1:hal-blink.elf'])
    st().redo() // the cut
    expect(bound()).toEqual({})
    st().redo() // the paste
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
    expect(sent(host()).slice(-1)).toEqual(['U1:hal-blink.elf'])
  })

  it('the same when the cut board was pasted somewhere else (a move by cut and paste)', () => {
    const original = comp('U1')
    st().select('U1')
    cutSelectionWithFeedback()
    pasteWithFeedback({ near: 'c35' })
    expect(comp('U1')?.at).toBe('h35')
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
    st().undo()
    st().undo()
    expect(comp('U1')).toBe(original)
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
  })

  it('another image loaded on the source since the copy is not passed off as the copied one', async () => {
    st().select('U1')
    copySelectionWithFeedback()
    expect((await lab().loadFirmware('U1', file('bare-blink.hex'))).ok).toBe(true)
    pasteWithFeedback()
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
    expect(lastToast()?.text).toBe('已貼上 U2（韌體沒有一起複製）')
  })
})
