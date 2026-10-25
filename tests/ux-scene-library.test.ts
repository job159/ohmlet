/**
 * UX wave scene — library & examples (src/ui/workspace/examples.ts,
 * LibraryPanel.tsx) and the zh-TW coverage of every scene-workstream file:
 *  - SC-7 examples sorted beginner → intermediate → advanced inside a category;
 *  - SC-2 every successful example open (any caller of openLibraryExample)
 *    points the workspace tray at the example's main instrument;
 *  - SC-8 a narrow desktop workspace (< 1500 px) collapses the library after
 *    an example opens, and says how to get it back.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests, hasTranslation, t } from '../src/i18n'
import uxScene from '../src/i18n/zh-TW/ux-scene'
import { useLab } from '../src/ui/embedded/lab'
import { dismissToast, getToasts } from '../src/ui/kit'
import {
  EXAMPLE_CATEGORIES,
  LIBRARY,
  LIBRARY_COLLAPSE_BELOW_PX,
  findLibraryExample,
  openLibraryExample,
  showExampleInstrument,
} from '../src/ui/workspace/examples'
import { MAINLAND_TERMS, englishLeft, halfWidthPunctuation } from './i18n/zh-check'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

class MemoryStorage {
  private m = new Map<string, string>()
  get length(): number {
    return this.m.size
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null
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

const OK = async () => ({ ok: true, errors: [], warnings: [] })
/** the library entry with an in-memory load (no fetch in node with a stubbed window) */
const ex = (id: string) => ({ ...findLibraryExample(id)!, load: async () => '{}' })
const FAIL = async () => ({ ok: false, errors: ['bad'], warnings: [] })

function stubWindow(width: number, wide: boolean): void {
  const storage = new MemoryStorage()
  vi.stubGlobal('window', {
    innerWidth: width,
    localStorage: storage,
    matchMedia: (q: string) => ({ matches: wide, media: q, addEventListener() {}, removeEventListener() {} }),
  })
  vi.stubGlobal('localStorage', storage)
}

beforeEach(() => {
  __setLangForTests('zh-TW')
  for (const x of getToasts()) dismissToast(x.id)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SC-7 example order', () => {
  it('inside every category: beginner → intermediate → advanced, the existing order kept within a level', () => {
    const rank = { beginner: 0, intermediate: 1, advanced: 2 } as const
    for (const c of EXAMPLE_CATEGORIES) {
      const list = LIBRARY.filter((e) => e.category === c)
      for (let i = 1; i < list.length; i++) expect(rank[list[i].difficulty], `${c}: ${list[i].key}`).toBeGreaterThanOrEqual(rank[list[i - 1].difficulty])
    }
    // categories stay grouped in EXAMPLE_CATEGORIES order
    const order = LIBRARY.map((e) => EXAMPLE_CATEGORIES.indexOf(e.category))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // the RS-485 (advanced) link no longer precedes CH340 / HC-05 (intermediate)
    const serial = LIBRARY.filter((e) => e.category === 'serial').map((e) => e.key)
    expect(serial.indexOf('rs485-link')).toBeGreaterThan(serial.indexOf('ch340-bridge'))
  })
})

describe('SC-2 the tray follows every example open', () => {
  beforeEach(() => stubWindow(1600, false))

  it('any caller of openLibraryExample lands on the example’s main instrument', async () => {
    useLab.getState().setWorkspace({ tray: { open: false, height: 240, tab: 'uart' } })
    expect((await openLibraryExample(ex('i2c-scan'), OK)).ok).toBe(true)
    expect(useLab.getState().workspace.tray).toMatchObject({ open: true, tab: 'logic' })
    await openLibraryExample(ex('adc-pot'), OK)
    expect(useLab.getState().workspace.tray.tab).toBe('scope')
  })

  it('an example about a UART link opens on the terminal (its protocol content), not the analyzer', async () => {
    for (const id of ['uart-hello', 'ch340-bridge', 'hc05-bluetooth', 'rs485-link']) {
      useLab.getState().setWorkspace({ tray: { open: false, height: 240, tab: 'logic' } })
      await openLibraryExample(ex(id), OK)
      expect(useLab.getState().workspace.tray, id).toMatchObject({ open: true, tab: 'uart' })
    }
    // the I²C / SPI ones still show their bus on the logic analyzer
    for (const id of ['i2c-scan', 'i2c-eeprom', 'w25q32-flash']) {
      await openLibraryExample(ex(id), OK)
      expect(useLab.getState().workspace.tray.tab, id).toBe('logic')
    }
  })

  it('an analog example without an instrument, or a failed open, leaves the tray alone', async () => {
    useLab.getState().setWorkspace({ tray: { open: false, height: 240, tab: 'uart' } })
    await openLibraryExample(ex('lm7805-regulator'), OK)
    expect(useLab.getState().workspace.tray).toMatchObject({ open: false, tab: 'uart' })
    await openLibraryExample(ex('blink'), FAIL)
    expect(useLab.getState().workspace.tray).toMatchObject({ open: false, tab: 'uart' })
    showExampleInstrument({ instruments: ['uart'] })
    expect(useLab.getState().workspace.tray).toMatchObject({ open: true, tab: 'uart' })
  })
})

describe('SC-8 room for the circuit on narrow desktops', () => {
  it(`below ${LIBRARY_COLLAPSE_BELOW_PX} px the library collapses after an example opens, with a toast`, async () => {
    vi.useFakeTimers()
    stubWindow(1366, true)
    useLab.getState().setWorkspace({ enabled: true, left: { open: true, width: 290, tab: 'examples' } })
    await openLibraryExample(ex('blink'), OK)
    expect(useLab.getState().workspace.left.open).toBe(false)
    vi.runAllTimers()
    expect(getToasts().map((x) => x.text)).toContain('已收合元件庫，讓電路有更多空間（左側把手可展開）')
  })

  it('wide desktops, phones and failed opens keep the library as it is', async () => {
    stubWindow(1600, true)
    useLab.getState().setWorkspace({ enabled: true, left: { open: true, width: 290, tab: 'examples' } })
    await openLibraryExample(ex('blink'), OK)
    expect(useLab.getState().workspace.left.open).toBe(true)
    stubWindow(390, false) // phone: no workspace showing
    await openLibraryExample(ex('blink'), OK)
    expect(useLab.getState().workspace.left.open).toBe(true)
    stubWindow(1366, true)
    await openLibraryExample(ex('blink'), FAIL)
    expect(useLab.getState().workspace.left.open).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// zh-TW coverage of the scene workstream
// ---------------------------------------------------------------------------

const FILES = [
  'src/ui/workspace/hole-chip.ts',
  'src/ui/workspace/LibraryPanel.tsx',
  'src/ui/workspace/examples.ts',
  'src/ui/workspace/Workspace.tsx',
  'src/ui/workspace/ProbeMenu.tsx',
  'src/ui/sheets/PartsSheet.tsx',
]

function literalKeys(src: string): string[] {
  const re = /\b(t|tc)\(\s*(['"])((?:\\.|(?!\2).)*)\2(?:\s*,\s*(['"])((?:\\.|(?!\4).)*)\4)?/g
  const out: string[] = []
  for (const m of src.matchAll(re)) {
    const k = m[3].replace(/\\(['"\\])/g, '$1')
    out.push(m[1] === 'tc' && m[5] ? `${k}|${m[5]}` : k)
  }
  return out
}

describe('zh-TW coverage (scene workstream)', () => {
  it('every literal t()/tc() source in the scene files has a zh-TW entry', () => {
    const missing: string[] = []
    for (const f of FILES) for (const k of literalKeys(read(f))) if (!hasTranslation(k)) missing.push(`${f}: ${k}`)
    expect(missing).toEqual([])
  })

  it('the ux-scene dictionary is Taiwan-usage Chinese with intact placeholders, and nothing overrides it', () => {
    const entries = Object.entries(uxScene)
    expect(entries.length).toBeGreaterThan(10)
    for (const [en, zh] of entries) {
      for (const term of MAINLAND_TERMS) expect(zh.includes(term), `${en} → ${zh} uses ${term}`).toBe(false)
      expect(halfWidthPunctuation(zh), zh).toEqual([])
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      expect(ph(zh), en).toEqual(ph(en))
      expect(englishLeft(zh.replace(/\{\w+\}/g, ' '), ['Esc']), zh).toEqual([])
    }
    for (const [en, zh] of entries) {
      const [src, ctx] = en.split('|')
      expect(ctx ? t(en) : t(src), en).toBe(zh)
    }
  })
})
