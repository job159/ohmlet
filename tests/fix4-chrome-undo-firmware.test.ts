/**
 * 〔復原〕 of a load that bound firmware (review finding UI-4).
 *
 * A lesson answer (or an example / project) loaded over the learner's own
 * board binds its firmware to the loaded MCU. When the learner's board had a
 * Blue Pill with the SAME id but NO firmware, the product chrome loads at once
 * (nothing is at risk) and promises 〔復原〕. Undo must then give back the
 * learner's board as it was — WITHOUT the loaded firmware — and redo must
 * bind it again. Edits are not loads: firmware the learner loads after moving
 * a lone board, or the whole circuit, survives undo of that move.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/mcu/all'
import type { CircuitLayout, ParamValue } from '../src/model/types'
import type { FirmwareImage } from '../src/mcu/firmware'
import type {
  HostQuery,
  HostQueryResult,
  LogicChannelConfig,
  SimHost,
  SimHostCallbacks,
} from '../src/sim/coordinator/api'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore, type FirmwareBlobStore } from '../src/state/firmware-store'
import * as L from '../src/state/lab'
import * as S from '../src/state/store'
import { __setLangForTests, t } from '../src/i18n'
import { lessonById } from '../src/lessons'
import { reloadLessonProgress } from '../src/lessons/progress'
import { dismissToast, getToasts } from '../src/ui/kit'
import { loadLessonCircuit, loadNeedsConfirm, stopGuide } from '../src/ui/lessons/actions'
import { useLessonUi } from '../src/ui/lessons/state'

const file = (name: string): { name: string; bytes: Uint8Array } => ({
  name,
  bytes: new Uint8Array(readFileSync(`firmware/dist/${name}`)),
})

/** The learner's own board: a Blue Pill U1 (no firmware), a supply and a resistor. */
const OWN: CircuitLayout = {
  version: 1,
  name: 'own',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', holes: ['a40', 'a44'], params: { resistance: 330 } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+3', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-3', color: 'black' },
  ],
}

/** A loaded circuit (an answer / example) with its own U1 — fresh objects every call. */
const answer = (): CircuitLayout => ({
  version: 1,
  name: 'answer',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', holes: ['a40', 'a44'], params: { resistance: 220 } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+3', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-3', color: 'black' },
    { id: 'W3', from: 'a20', to: 'e36', color: 'yellow' },
  ],
})

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

const st = () => S.useStore.getState()
const lab = () => L.useLab.getState()
/** board id → bound firmware file name */
const bound = (): Record<string, string> => Object.fromEntries(Object.entries(lab().firmware).map(([id, r]) => [id, r.name]))
const u1 = () => st().layout.components.find((c) => c.id === 'U1')

let hosts: FakeHost[] = []
const host = (): FakeHost => hosts[hosts.length - 1]
/** firmware sent to the host, in order (none = removal) */
const sent = (h: FakeHost): string[] =>
  h.of('setFirmware').map((c) => `${c.args[0] as string}:${c.args[1] === null ? 'none' : (c.args[1] as FirmwareImage).name}`)

function resetDocument(layout: CircuitLayout): void {
  st().resetSim()
  S.__resetHistoryForTests()
  S.useStore.setState({ layout, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
}

function fakeHosts(): void {
  hosts = []
  S.__setSimHostFactoryForTests((cb) => {
    const h = new FakeHost(cb)
    hosts.push(h)
    return h
  })
}

// ---------------------------------------------------------------------------

describe('undo of a load that bound firmware to a board that had none (store + lab)', () => {
  let storage: MemoryStorage
  let blobs: FirmwareBlobStore

  beforeEach(async () => {
    storage = new MemoryStorage()
    vi.stubGlobal('window', { localStorage: storage, matchMedia: (q: string) => ({ matches: false, media: q }) })
    blobs = { ...createMemoryBlobStore(), persistent: true }
    __setFirmwareBlobStoreForTests(blobs)
    fakeHosts()
    S.__setSimClockForTests(() => 0)
    L.__setLabClockForTests(() => 0)
    resetDocument(OWN)
    await L.__rebootLabForTests()
  })

  afterEach(() => {
    S.__setSimHostFactoryForTests(null)
    S.__setSimClockForTests(null)
    L.__setLabClockForTests(null)
    __setFirmwareBlobStoreForTests(null)
    vi.unstubAllGlobals()
  })

  it('undo gives the board back WITHOUT the loaded firmware; redo binds it again; undo again unbinds', async () => {
    const own = u1()
    expect(bound()).toEqual({})
    expect(st().loadLayout(answer()).ok).toBe(true) // an answer / example: one undo step
    expect((await lab().loadFirmware('U1', file('hal-blink.elf'))).ok).toBe(true)
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
    const loadedU1 = u1()
    const h = host()

    st().undo() // 〔復原〕
    expect(u1()).toBe(own) // the learner's own board instance is back…
    expect(bound()).toEqual({}) // …without firmware it never had
    expect(storage.getItem('bb.firmware')).toBeNull() // a reload would not bring it back either
    expect(sent(h).slice(-1)).toEqual(['U1:none']) // the running host drops it

    st().redo()
    expect(u1()).toBe(loadedU1)
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
    expect(JSON.parse(storage.getItem('bb.firmware') as string).U1.name).toBe('hal-blink.elf')
    expect(sent(h).slice(-1)).toEqual(['U1:hal-blink.elf'])

    st().undo()
    expect(u1()).toBe(own)
    expect(bound()).toEqual({})
    expect(sent(h).slice(-1)).toEqual(['U1:none'])
  })

  it('an example / project import over the unbound board: undo unbinds, redo restores the project firmware', async () => {
    // a project file whose U1 carries firmware (the examples load this way)
    resetDocument(answer())
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    const text = await lab().exportProject()
    resetDocument(OWN)
    await L.__rebootLabForTests()
    lab().clearFirmware('U1')
    expect(bound()).toEqual({})
    const own = u1()

    const res = await lab().importProject(text)
    expect(res.ok).toBe(true)
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
    st().undo()
    expect(u1()).toBe(own)
    expect(bound()).toEqual({})
    st().redo()
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
  })

  it('firmware the learner loads after moving a LONE board survives undo of the move (an edit, not a load)', async () => {
    resetDocument({ version: 1, components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }], wires: [] })
    expect(st().commitMove(['U1'], { dCol: 2, dRowLattice: 0 }).ok).toBe(true)
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    st().undo() // the move
    expect(u1()?.at).toBe('h10')
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
  })

  it('firmware loaded after moving the WHOLE circuit survives undo of that move', async () => {
    resetDocument({
      version: 1,
      components: [
        { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
        { id: 'R1', type: 'resistor', holes: ['a40', 'a44'], params: { resistance: 330 } },
      ],
      wires: [{ id: 'W1', from: 'a20', to: 'e36', color: 'yellow' }],
    })
    expect(st().commitMove(['U1', 'R1'], { dCol: 2, dRowLattice: 0 }).ok).toBe(true)
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    st().undo()
    expect(u1()?.at).toBe('h10')
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
  })

  it('after the undo, firmware the learner loads on the restored board is theirs: it survives later edits and their undo', async () => {
    st().loadLayout(answer())
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    st().undo()
    expect(bound()).toEqual({})
    await lab().loadFirmware('U1', file('bare-blink.hex')) // the learner's own choice
    expect(st().commitMove(['U1'], { dCol: 2, dRowLattice: 0 }).ok).toBe(true)
    st().undo() // the move — back to the instance the load displaced
    expect(u1()?.at).toBe('h10')
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
  })

  it('a board delete + undo still brings the board back WITH its firmware', async () => {
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    st().removeComponent('U1')
    expect(bound()).toEqual({})
    st().undo()
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
  })

  it('a board that had firmware before the load keeps one after the undo (unchanged: the load asked first)', async () => {
    await lab().loadFirmware('U1', file('bare-blink.hex'))
    st().loadLayout(answer())
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    st().undo()
    expect(Object.keys(bound())).toEqual(['U1'])
  })

  it('a bound board a load takes away (no U1 in the new circuit) comes back with its firmware, and keeps it through later edits', async () => {
    st().startSim() // a live host: its reload reconciles the bindings first
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    expect(st().loadLayout({ version: 1, components: [{ id: 'R9', type: 'resistor', holes: ['a40', 'a44'] }], wires: [] }).ok).toBe(true)
    expect(bound()).toEqual({})
    st().undo()
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
    expect(st().commitMove(['U1'], { dCol: 2, dRowLattice: 0 }).ok).toBe(true)
    st().undo() // the move: the board is the learner's, firmware and all
    expect(u1()?.at).toBe('h10')
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
  })

  it('a reload after the load restores the loaded board with its firmware', async () => {
    st().loadLayout(answer())
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    await L.__rebootLabForTests() // the page reloads (the document stays: autosave)
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
  })
})

// ---------------------------------------------------------------------------

describe('the review scenario: 載入完整答案 over an unbound Blue Pill, then 〔復原〕', () => {
  const memory = new Map<string, string>()

  beforeEach(async () => {
    memory.clear()
    // localStorage without a window: bundled firmware is read from disk (node)
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
      setItem: (k: string, v: string) => void memory.set(k, String(v)),
      removeItem: (k: string) => void memory.delete(k),
      clear: () => memory.clear(),
    })
    __setLangForTests('zh-TW')
    reloadLessonProgress()
    __setFirmwareBlobStoreForTests(createMemoryBlobStore())
    fakeHosts()
    resetDocument({ version: 1, components: [], wires: [] })
    await L.__rebootLabForTests()
    useLessonUi.setState({ coachId: null, viewId: null, runs: {}, attempted: {}, loadingFirmware: null, focus: null })
    for (const x of getToasts()) dismissToast(x.id)
  })

  afterEach(() => {
    stopGuide()
    S.__setSimHostFactoryForTests(null)
    __setFirmwareBlobStoreForTests(null)
    vi.unstubAllGlobals()
  })

  it('〔復原〕 leaves the learner’s U1 without the lesson’s firmware; redo binds hal-blink again', async () => {
    st().addComponent('stm32_bluepill', { at: 'h10' })
    st().addComponent('led', { holes: ['a50', 'a51'] })
    const own = st().layout
    const ownU1 = u1()
    expect(bound()).toEqual({})
    const i1 = lessonById('i1-gpio-output')!
    expect(loadNeedsConfirm(i1, 'solution', own, false)).toBe(false) // loads at once, promising 〔復原〕
    expect(await loadLessonCircuit(i1, 'solution')).toBe(true)
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
    const toast = getToasts().find((x) => x.action?.label === t('Undo'))
    expect(toast).toBeDefined()
    toast!.action!.run() // 〔復原〕
    expect(st().layout).toBe(own)
    expect(u1()).toBe(ownU1)
    expect(bound()).toEqual({}) // never loaded by the learner: it does not drive PA5 / PC13 on their circuit
    st().redo()
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
  })

  it('〔復原〕, drag U1, load own firmware, run, Ctrl+Z the drag: the firmware stays bound and running', async () => {
    st().addComponent('stm32_bluepill', { at: 'h10' })
    st().addComponent('led', { holes: ['a50', 'a51'] })
    const i1 = lessonById('i1-gpio-output')!
    expect(await loadLessonCircuit(i1, 'solution')).toBe(true)
    getToasts()
      .find((x) => x.action?.label === t('Undo'))!
      .action!.run() // 〔復原〕
    expect(bound()).toEqual({})
    expect(st().commitMove(['U1'], { dCol: 2, dRowLattice: 0 }).ok).toBe(true)
    expect((await lab().loadFirmware('U1', file('bare-blink.hex'))).ok).toBe(true)
    st().startSim()
    const h = host()
    expect(sent(h).slice(-1)).toEqual(['U1:bare-blink.hex'])
    st().undo() // Ctrl+Z: only the drag
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
    expect(sent(h).slice(-1)).toEqual(['U1:bare-blink.hex'])
  })

  it('〔復原〕, move the whole circuit, load own firmware, undo the move', async () => {
    st().addComponent('stm32_bluepill', { at: 'h10' })
    st().addComponent('led', { holes: ['a50', 'a51'] })
    const i1 = lessonById('i1-gpio-output')!
    expect(await loadLessonCircuit(i1, 'solution')).toBe(true)
    getToasts()
      .find((x) => x.action?.label === t('Undo'))!
      .action!.run()
    const ids = st().layout.components.map((c) => c.id)
    expect(st().commitMove(ids, { dCol: 2, dRowLattice: 0 }).ok).toBe(true)
    await lab().loadFirmware('U1', file('bare-blink.hex'))
    st().undo()
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
  })
})

// ---------------------------------------------------------------------------

/**
 * After 〔復原〕 the restored board is the learner's own again. An ordinary
 * edit of it (a drag, a rotation, moving the whole circuit, growing the grid)
 * makes a new copy of that same board; firmware the learner loads onto the
 * copy is theirs and must survive undo of the edit (verifier finding np-1).
 */
describe('after 〔復原〕, firmware loaded on an edited copy of the restored board survives undo of the edit', () => {
  beforeEach(async () => {
    vi.stubGlobal('window', { localStorage: new MemoryStorage(), matchMedia: (q: string) => ({ matches: false, media: q }) })
    __setFirmwareBlobStoreForTests({ ...createMemoryBlobStore(), persistent: true })
    fakeHosts()
    S.__setSimClockForTests(() => 0)
    L.__setLabClockForTests(() => 0)
    resetDocument(OWN)
    await L.__rebootLabForTests()
  })

  afterEach(() => {
    S.__setSimHostFactoryForTests(null)
    S.__setSimClockForTests(null)
    L.__setLabClockForTests(null)
    __setFirmwareBlobStoreForTests(null)
    vi.unstubAllGlobals()
  })

  /** load an answer (binding its firmware), then 〔復原〕: the learner's board without it */
  async function loadAndUndo(withFirmware = true): Promise<void> {
    const own = u1()
    expect(st().loadLayout(answer()).ok).toBe(true)
    if (withFirmware) expect((await lab().loadFirmware('U1', file('hal-blink.elf'))).ok).toBe(true)
    st().undo()
    expect(u1()).toBe(own)
    expect(bound()).toEqual({})
  }

  it('a drag of the lone board: firmware stays bound and the running host keeps it, through undo and redo', async () => {
    await loadAndUndo()
    const own = u1()
    expect(st().commitMove(['U1'], { dCol: 2, dRowLattice: 0 }).ok).toBe(true)
    expect(u1()).not.toBe(own) // the drag made a new copy of the same board
    expect((await lab().loadFirmware('U1', file('bare-blink.hex'))).ok).toBe(true)
    st().startSim()
    const h = host()
    expect(sent(h).slice(-1)).toEqual(['U1:bare-blink.hex'])
    const before = sent(h).length
    st().undo() // Ctrl+Z: only the drag
    expect(u1()).toBe(own)
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
    st().redo()
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
    expect(sent(h).slice(before)).toEqual([]) // the running firmware is never dropped or re-sent
  })

  it('without a live host (the lab follows the document alone): undo of the load unbinds, undo of a later drag keeps own firmware', async () => {
    const own = u1()
    st().loadLayout(answer())
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    fakeHosts() // the simulation host goes away
    st().undo()
    expect(u1()).toBe(own)
    expect(bound()).toEqual({})
    expect(st().commitMove(['U1'], { dCol: 2, dRowLattice: 0 }).ok).toBe(true)
    await lab().loadFirmware('U1', file('bare-blink.hex'))
    fakeHosts()
    st().undo()
    expect(u1()).toBe(own)
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
  })

  it('a rotation of the board', async () => {
    await loadAndUndo()
    const own = u1()
    expect(st().rotatePlaced('U1')).toEqual({ ok: true })
    expect(u1()).not.toBe(own)
    await lab().loadFirmware('U1', file('bare-blink.hex'))
    st().undo()
    expect(u1()).toBe(own)
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
  })

  it('a move of the whole circuit', async () => {
    await loadAndUndo()
    const own = u1()
    expect(st().commitMove(['U1', 'R1'], { dCol: 2, dRowLattice: 0 }).ok).toBe(true)
    await lab().loadFirmware('U1', file('bare-blink.hex'))
    st().undo()
    expect(u1()).toBe(own)
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
  })

  it('growing the grid up (every part is remapped)', async () => {
    await loadAndUndo()
    const own = u1()
    expect(st().growGrid('up').ok).toBe(true)
    expect(u1()).not.toBe(own)
    await lab().loadFirmware('U1', file('bare-blink.hex'))
    st().undo()
    expect(u1()).toBe(own)
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
  })

  it('two drags in a row, firmware loaded after the second: undo of both keeps it', async () => {
    await loadAndUndo()
    const own = u1()
    expect(st().commitMove(['U1'], { dCol: 2, dRowLattice: 0 }).ok).toBe(true)
    expect(st().commitMove(['U1'], { dCol: 2, dRowLattice: 0 }).ok).toBe(true)
    await lab().loadFirmware('U1', file('bare-blink.hex'))
    st().undo()
    st().undo()
    expect(u1()).toBe(own)
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
  })

  it('a load that bound no firmware, undone at once, then a drag + own firmware + undo of the drag', async () => {
    await loadAndUndo(false)
    expect(st().commitMove(['U1'], { dCol: 2, dRowLattice: 0 }).ok).toBe(true)
    await lab().loadFirmware('U1', file('bare-blink.hex'))
    st().undo()
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
  })

  it('a second load over the dragged board is still undone without its firmware, back past the drag; redo binds it again', async () => {
    await loadAndUndo()
    const own = u1()
    expect(st().commitMove(['U1'], { dCol: 2, dRowLattice: 0 }).ok).toBe(true)
    const dragged = u1()
    expect(st().loadLayout(answer()).ok).toBe(true)
    await lab().loadFirmware('U1', file('bare-blink.hex'))
    const loaded = u1()
    st().undo() // the second load
    expect(u1()).toBe(dragged)
    expect(bound()).toEqual({})
    st().undo() // the drag
    expect(u1()).toBe(own)
    expect(bound()).toEqual({})
    st().redo()
    expect(bound()).toEqual({})
    st().redo()
    expect(u1()).toBe(loaded)
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
  })

  it('the loaded board dragged before the 〔復原〕: undo all the way unbinds, redo all the way binds again', async () => {
    const own = u1()
    st().loadLayout(answer())
    await lab().loadFirmware('U1', file('hal-blink.elf'))
    expect(st().commitMove(['U1'], { dCol: 2, dRowLattice: 0 }).ok).toBe(true)
    st().undo() // the drag
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
    st().undo() // the load
    expect(u1()).toBe(own)
    expect(bound()).toEqual({})
    st().redo()
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
    st().redo()
    expect(bound()).toEqual({ U1: 'hal-blink.elf' })
  })

  it('firmware loaded on the restored board itself follows it into redo and back (unchanged)', async () => {
    await loadAndUndo()
    const own = u1()
    await lab().loadFirmware('U1', file('bare-blink.hex'))
    st().redo() // the loaded board again: the learner's choice replaced the loaded firmware
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
    st().undo()
    expect(u1()).toBe(own)
    expect(bound()).toEqual({ U1: 'bare-blink.hex' })
  })
})
