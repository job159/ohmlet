/**
 * Operation simplification, follow-up round (review F7 / F8 / F16 and the
 * build round's contract requests):
 *
 *   - F7: 範例 → 開啟, 下一課 and 開始引導 replace the board at once in the
 *     product chrome, with 〔復原〕 in the toast — exactly like 載入完整答案;
 *     they ask only when the load would overwrite firmware (undo cannot bring
 *     that back), and that dialog names the board and says 「韌體無法復原」;
 *     no firmware sentence without firmware; the classic chrome still asks;
 *   - F8: the phone wire legend is one compact row (the dot shows the colour);
 *   - 更多 → 模擬 「顯示電流」 and 更多 → 設定 「音效」 (product chrome), the C
 *     key in the shortcuts list;
 *   - the wire hover chip names the wire's role;
 *   - the edit sounds come from the board (mech-watch), once: a delete
 *     pulls, a placement inserts, a wire clicks in, an undo swishes; the
 *     old editCue call sites are inert (product chrome only);
 *   - the user guide describes all of it in the interface's own words.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cues = vi.hoisted(() => [] as string[])
vi.mock('../src/ui/fx/sound', async (orig) => {
  const real = await orig<typeof import('../src/ui/fx/sound')>()
  return { ...real, playCue: (cue: string) => void cues.push(cue), playMech: (cue: string) => void cues.push(cue) }
})

import { __setLangForTests, t } from '../src/i18n'
import { lessonById } from '../src/lessons'
import { reloadLessonProgress } from '../src/lessons/progress'
import type { CircuitLayout } from '../src/model/types'
import { __setFirmwareBlobStoreForTests, createMemoryBlobStore } from '../src/state/firmware-store'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { SHORTCUTS, SHORTCUT_GROUPS, shortcutKeysText, withKey } from '../src/ui/chrome/ShortcutsSheet'
import { WireColorStrip, wireLegendItems } from '../src/ui/chrome/WireColorStrip'
import { deletedToast, editCue, firmwareAtRisk, firmwareRiskDialog, removeSelectedWithFeedback, undoWithFeedback } from '../src/ui/chrome/edit-feedback'
import { startMechSoundWatch } from '../src/ui/fx/mech-watch'
import { useLab } from '../src/ui/embedded/lab'
import { dismissToast, getToasts } from '../src/ui/kit'
import { goToLesson, loadLessonCircuit, startGuide, stopGuide } from '../src/ui/lessons/actions'
import { FullAnswerButton } from '../src/ui/lessons/LessonBrowser'
import { useLessonUi } from '../src/ui/lessons/state'
import { ExampleLibrary, exampleOpenAsks } from '../src/ui/workspace/LibraryPanel'
import { objectChipText } from '../src/ui/workspace/hole-chip'
import { SIGNAL_PALETTE, wireRoleLegend, wireRoleOf } from '../src/ui/wire-roles'
import { wireColorLabel } from '../src/ui/wire-colors'
import { flowLegend } from '../src/ui/chrome/FlowToggle'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const squash = (s: string) => s.replace(/\s+/g, ' ')

const memory = new Map<string, string>()
beforeEach(() => {
  memory.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  })
  __setLangForTests('zh-TW')
  __setFirmwareBlobStoreForTests(createMemoryBlobStore())
  reloadLessonProgress()
  __resetHistoryForTests()
  useStore.setState({ layout: EMPTY, selection: [], mode: { kind: 'select' }, running: false })
  useLab.setState({ firmware: {} })
  useLessonUi.setState({ coachId: null, viewId: null, runs: {}, attempted: {}, focus: null, confirm: null })
  for (const x of getToasts()) dismissToast(x.id)
  cues.length = 0
})
afterEach(() => {
  stopGuide()
  __setFirmwareBlobStoreForTests(null)
  __setLangForTests('zh-TW')
  vi.unstubAllGlobals()
})

const EMPTY: CircuitLayout = { version: 1, name: 'e', components: [], wires: [] } as CircuitLayout
const LED: CircuitLayout = {
  version: 1,
  name: 't',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R1', type: 'resistor', holes: ['c10', 'c14'], params: { resistance: 330 } },
    { id: 'LED1', type: 'led', holes: ['d14', 'd18'] },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+0', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-0', color: 'black' },
    { id: 'W3', from: 'a18', to: 'top-12', color: 'black' },
  ],
} as CircuitLayout
const BLINK: CircuitLayout = { version: 1, name: 'blink', components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }], wires: [] } as CircuitLayout
const HAL_BLINK = { U1: { name: 'hal-blink.elf' } }

const st = () => useStore.getState()
const lastToast = () => getToasts().at(-1)
const ids = () => st().layout.components.map((c) => c.id).sort()
const LONG = { timeout: 60_000 }

/** A server render against the stores' live state (zustand's server snapshot is the initial state). */
function renderLive(el: ReturnType<typeof createElement>): string {
  const stores = [useStore, useLab, useLessonUi] as unknown as { getState: () => object; getInitialState: () => object }[]
  const saved = stores.map((s) => {
    const init = s.getInitialState() as Record<string, unknown>
    const before = { ...init }
    Object.assign(init, s.getState())
    return [init, before] as const
  })
  try {
    return renderToStaticMarkup(el)
  } finally {
    for (const [init, before] of saved) {
      for (const k of Object.keys(init)) if (!(k in before)) delete init[k]
      Object.assign(init, before)
    }
  }
}

// ---------------------------------------------------------------- F7
describe('F7 範例 → 開啟: at once with 〔復原〕; asks only for firmware undo cannot bring back', () => {
  it('the decision: never on an empty board; the classic chrome asks for any other; the product chrome only for loaded firmware', () => {
    expect(exampleOpenAsks(EMPTY, HAL_BLINK, false)).toBe(false)
    expect(exampleOpenAsks(EMPTY, {}, true)).toBe(false)
    expect(exampleOpenAsks(LED, {}, false)).toBe(false) // one undo away
    expect(exampleOpenAsks(BLINK, {}, false)).toBe(false) // a board without firmware
    expect(exampleOpenAsks(BLINK, HAL_BLINK, false)).toBe(true) // an import replaces every binding
    expect(exampleOpenAsks(LED, {}, true)).toBe(true) // classic: as before
  })

  it('the one dialog names the board and its file and says 「韌體無法復原」 (shared with the lessons)', () => {
    const d = firmwareRiskDialog('Blue Pill 閃爍 LED（HAL）', firmwareAtRisk(BLINK, HAL_BLINK, null), HAL_BLINK)
    expect(d.title).toBe('要取代電路和 U1 的韌體嗎？')
    expect(d.message).toBe('「Blue Pill 閃爍 LED（HAL）」會取代目前的電路（按 ↶ 可復原），也會取代已載入的韌體：U1 的 hal-blink.elf（韌體無法復原）。')
    // an unknown file name still names the board
    expect(firmwareRiskDialog('x', ['U1'], { U1: {} }).message).toContain('已載入的韌體：U1（韌體無法復原）')
  })

  it('the library note mentions firmware only when firmware is on the board (product chrome)', () => {
    useStore.setState({ layout: LED })
    const plain = renderLive(createElement(ExampleLibrary, {}))
    expect(plain).toContain('開啟範例會取代目前的電路（按 ↶ 可復原）。每個範例都在真實的模擬中執行')
    expect(plain).not.toContain('開啟範例會取代目前的電路與韌體')
    expect(plain).not.toContain('韌體無法復原')
    useStore.setState({ layout: BLINK })
    useLab.setState({ firmware: HAL_BLINK as never })
    const withFw = renderLive(createElement(ExampleLibrary, {}))
    expect(withFw).toContain('U1 已載入的韌體無法復原，開啟前會先詢問。')
    // the classic chrome keeps its sentence word for word
    __setLangForTests('en')
    const classic = renderLive(createElement(ExampleLibrary, {}))
    expect(classic).toContain('Opening an example replaces the current circuit and its firmware.')
  })

  it('the library opens at once, the toast carries 〔復原〕 (source: the request goes through exampleOpenAsks)', () => {
    const lib = squash(read('src/ui/workspace/LibraryPanel.tsx'))
    expect(lib).toContain('if (exampleOpenAsks(useStore.getState().layout, useLab.getState().firmware, isLegacyChrome())) setConfirm(ex) else void open(ex)')
    expect(lib).toContain('if (replaced && !isLegacyChrome()) undoableToast(text, useStore.getState().layout) else showToast(text)')
    // the phone's 元件 → 範例 is the same list (PartsSheet renders ExampleLibrary)
    expect(read('src/ui/sheets/PartsSheet.tsx')).toContain('<ExampleLibrary')
  })
})

describe('F7 下一課 / 開始引導: at once with 〔復原〕 in the product chrome', () => {
  it('下一課 over b1’s board (no firmware) loads b2 at once; 〔復原〕 brings b1 back', LONG, async () => {
    const b1 = lessonById('b1-led-resistor')!
    const b2 = lessonById('b2-voltage-divider')!
    await loadLessonCircuit(b1, 'solution')
    const b1Board = st().layout
    goToLesson(b2)
    expect(useLessonUi.getState().confirm).toBeNull()
    for (let i = 0; i < 50 && useLessonUi.getState().coachId !== b2.id; i++) await new Promise((r) => setTimeout(r, 20))
    expect(ids()).toEqual(['DMM1', 'DMM2', 'PS1'])
    expect(useLessonUi.getState().coachId).toBe(b2.id)
    const toast = lastToast()!
    expect(toast.text).toBe(`已載入「${b2.title}」的起始電路`)
    expect(toast.action?.label).toBe('復原')
    toast.action!.run()
    expect(st().layout.components.map((c) => c.id)).toEqual(b1Board.components.map((c) => c.id))
  })

  it('開始引導 on another circuit loads the lesson’s own start at once', LONG, async () => {
    const b2 = lessonById('b2-voltage-divider')!
    useStore.setState({ layout: LED })
    startGuide(b2, 0)
    expect(useLessonUi.getState().confirm).toBeNull()
    for (let i = 0; i < 50 && useLessonUi.getState().coachId !== b2.id; i++) await new Promise((r) => setTimeout(r, 20))
    expect(useLessonUi.getState().coachId).toBe(b2.id)
    expect(lastToast()?.action?.label).toBe('復原')
  })

  it('…asks only when it would overwrite a board’s firmware (i7 gives U1 firmware of its own)', () => {
    useStore.setState({ layout: BLINK })
    useLab.setState({ firmware: HAL_BLINK as never })
    goToLesson(lessonById('i7-i2c')!)
    expect(useLessonUi.getState().confirm).toEqual({ lessonId: 'i7-i2c', which: 'start' })
    expect(st().layout).toBe(BLINK) // nothing changed before the answer
    useLessonUi.getState().setConfirm(null)
    // a lesson without an MCU takes U1 away: its binding waits for the undo — no question
    goToLesson(lessonById('b1-led-resistor')!)
    expect(useLessonUi.getState().confirm).toBeNull()
  })

  it('the classic chrome asks for any non-empty board, as before', () => {
    __setLangForTests('en')
    useStore.setState({ layout: LED })
    goToLesson(lessonById('b2-voltage-divider')!)
    expect(useLessonUi.getState().confirm).toEqual({ lessonId: 'b2-voltage-divider', which: 'start' })
    useLessonUi.getState().setConfirm(null)
    startGuide(lessonById('b2-voltage-divider')!, 0)
    expect(useLessonUi.getState().confirm).toEqual({ lessonId: 'b2-voltage-divider', which: 'start' })
  })

  it('the lesson dialog uses the same named-board words (LessonOverlay ConfirmLoad)', () => {
    const overlay = squash(read('src/ui/lessons/LessonOverlay.tsx'))
    expect(overlay).toContain('firmwareRiskDialog(lesson.title, boards, firmware)')
    expect(overlay).toContain("title={risk ? risk.title : t('Replace the current circuit?')}")
  })

  it('載入完整答案’s tooltip names firmware only when the answer has some', () => {
    const b1 = renderToStaticMarkup(createElement(FullAnswerButton, { lesson: lessonById('b1-led-resistor')!, calm: true }))
    expect(b1).toContain('title="顯示解答：載入本課完成的電路——按 ↶ 可復原"')
    const i1 = renderToStaticMarkup(createElement(FullAnswerButton, { lesson: lessonById('i1-gpio-output')! }))
    expect(i1).toContain('title="顯示解答：載入本課完成的電路與韌體——按 ↶ 可復原"')
  })
})

// ---------------------------------------------------------------- F8
describe('F8 the phone wire legend is one compact row', () => {
  it('each item has a short phone form; the dot keeps the colour, the full words stay for screen readers', () => {
    expect(wireLegendItems().map((i) => i.short)).toEqual(['電源正', '地', '訊號'])
    expect(wireLegendItems().map((i) => i.text)).toEqual(['紅＝電源正', '黑＝地', '其他顏色＝訊號'])
    useStore.setState({ layout: LED, mode: { kind: 'wire', from: null, color: 'red' } })
    const html = renderLive(createElement(WireColorStrip))
    expect(html).toContain('<span class="app-wire-legend-short" aria-hidden="true">電源正</span>')
    expect(html).toContain('<span class="app-wire-legend-text">紅＝電源正</span>')
    useStore.setState({ mode: { kind: 'select' } })
  })

  it('CSS: the strip takes its one-row width; phones show the short words in one row, the full ones visually hidden', () => {
    const css = squash(read('src/ui/chrome/WireColorStrip.css'))
    expect(css).toMatch(/\.app-wire-strip\.is-legend \{[^}]*width: max-content;/)
    const phone = css.slice(css.indexOf('@media (max-width: 430px)'))
    expect(phone).toMatch(/\.app-wire-legend \{ flex-wrap: nowrap;/)
    expect(phone).toMatch(/\.app-wire-legend-text \{ position: absolute; width: 1px; height: 1px;/)
    expect(phone).toMatch(/\.app-wire-legend-short \{ display: inline; \}/)
  })
})

// ---------------------------------------------------------------- 顯示電流 / 音效 / C
describe('顯示電流 and 音效 are one tap away in 更多; Shift+C is in the shortcuts list', () => {
  it('Shift+C 「顯示電流」 is listed in the View group; the chip’s tooltip reads it from the table', () => {
    // round 5: a plain C picks up a capacitor (part-keys.ts), so 顯示電流 moved to Shift+C
    expect(SHORTCUTS['current-flow']).toEqual({ combos: [['Shift', 'C']], label: 'Show current' })
    const view = SHORTCUT_GROUPS.find((g) => g.title === 'View')!
    expect(view.rows).toContain(SHORTCUTS['current-flow'])
    expect(view.rows.indexOf(SHORTCUTS['current-flow'])).toBe(view.rows.indexOf(SHORTCUTS.frame) + 1)
    expect(shortcutKeysText('current-flow')).toBe('Shift+C')
    expect(withKey(t('Show current'), 'current-flow')).toEqual({ title: '顯示電流（Shift+C）', ariaKeyshortcuts: 'Shift+C' })
    // a plain C is no shortcut of the table: it is the capacitor's part key
    const singles = Object.entries(SHORTCUTS).filter(([, r]) => r.combos.some((c) => c.length === 1 && c[0].toUpperCase() === 'C'))
    expect(singles.map(([id]) => id)).toEqual([])
  })

  it('更多: 「顯示電流」 right after the speed row (模擬), 「音效」 in 設定 — product chrome only', () => {
    const more = squash(read('src/ui/sheets/MoreSheet.tsx'))
    const speed = more.indexOf("aria-label={t('Simulation speed')}")
    const flow = more.indexOf('{!legacy && <FlowViewRow />}')
    const reset = more.indexOf("title={t('Reset simulation')}")
    expect(speed).toBeGreaterThan(0)
    expect(flow).toBeGreaterThan(speed)
    expect(flow).toBeLessThan(reset)
    const settings = more.indexOf("<ListGroup header={t('Settings')}>")
    const sound = more.indexOf('{!legacy && <SoundSettingRow />}')
    expect(sound).toBeGreaterThan(settings)
    expect(t('Sound')).toBe('音效')
  })

  it('更多 → 模擬速度: 「0.1 倍」…「10 倍」 each on one line (product chrome; the classic row is untouched)', () => {
    const more = squash(read('src/ui/sheets/MoreSheet.tsx'))
    expect(more).toContain("aria-label={t('Simulation speed')} className={legacy ? undefined : 'asm-seg-speed'}")
    const css = squash(read('src/ui/sheets/asm-sheets.css'))
    expect(css).toMatch(/\.asm-seg-speed \.lg-seg-item \{ padding: 0 4px; white-space: nowrap; \}/)
  })
})

// ---------------------------------------------------------------- the hover chip
describe('the wire hover chip names the wire’s role (product chrome)', () => {
  it('「導線 W1 · 紅色：電源正極（5 V 網路）· 點一下選取」; the classic chrome keeps the bare chip', () => {
    useStore.setState({ layout: LED })
    expect(objectChipText('W1')).toContain(wireRoleOf(LED, 'W1').reason) // the inspector's own words
    expect(objectChipText('W1')).toBe('導線 W1 · 紅色：電源正極（5 V 網路）· 點一下選取')
    expect(objectChipText('W3')).toBe('導線 W3 · 黑色：接地（PS1 負端）· 點一下選取')
    useStore.setState({ selection: ['W3'] })
    expect(objectChipText('W3')).toBe('導線 W3 · 黑色：接地（PS1 負端）· 已選取')
    __setLangForTests('en')
    expect(objectChipText('W1')).toBe('Wire W1 · Click to select')
  })
})

// ---------------------------------------------------------------- sound cues
describe('edit sounds come from the board, once (product chrome; sound.ts is rate-limited, silent before a gesture and when 音效 is off)', () => {
  let stopWatch: () => void = () => undefined
  beforeEach(() => {
    stopWatch = startMechSoundWatch()
  })
  afterEach(() => stopWatch())

  it('a delete pulls the part out once — the Delete key, the inspector, the long-press menu; the toast itself is silent', () => {
    st().loadLayout(LED)
    expect(cues).toEqual(['load'])
    cues.length = 0
    st().select('LED1')
    removeSelectedWithFeedback()
    expect(cues).toEqual(['pull'])
    deletedToast(['R1']) // the toast names a removal another call already made: no second sound
    expect(cues).toEqual(['pull'])
  })

  it('placement and wire commits sound from the store watcher; editCue is inert (no double sound)', () => {
    editCue('place')
    editCue('wire')
    editCue('delete')
    expect(cues).toEqual([])
    st().addComponent('resistor', { holes: ['c20', 'c24'] })
    st().addWire('a20', 'top+5')
    expect(cues).toEqual(['insert', 'wire-in'])
    undoWithFeedback() // one swish, not the wire pulled out
    expect(cues).toEqual(['insert', 'wire-in', 'undo'])
  })

  it('the classic chrome stays silent', () => {
    __setLangForTests('en')
    st().loadLayout(LED)
    st().select('LED1')
    removeSelectedWithFeedback()
    st().addComponent('resistor', { holes: ['c20', 'c24'] })
    editCue('place')
    editCue('wire')
    expect(cues).toEqual([])
  })
})

// ---------------------------------------------------------------- the user guide
describe('the user guide describes the simplified operation in the interface’s own words', () => {
  const guide = read('docs/user-guide.md')
  const section = (n: number): string => {
    const start = guide.indexOf(`\n## ${n}. `)
    const end = guide.indexOf('\n## ', start + 1)
    return guide.slice(start, end < 0 ? undefined : end)
  }

  it('§4 the automatic wire colours and the legend; signals by function', () => {
    const s4 = section(4)
    for (const item of wireLegendItems()) expect(s4).toContain(item.text)
    expect(wireRoleLegend()).toBe('紅＝電源正　黑＝地　其他顏色＝訊號')
    for (const w of ['I²C', 'SDA', 'SCL', 'UART', 'PWM', '藍色', '黃色', '綠色', '白色', '橘色']) expect(s4).toContain(w)
    expect(s4).toContain('紅色：電源正極（5 V 網路）')
    expect(s4).toContain('準位轉換')
    expect(s4).not.toContain('其他訊號線是黃色') // the old rule
    expect(s4).not.toContain('在顏色列點選一個顏色')
  })

  it('§4 one colour, one meaning: the plain-signal row lists the palette, the example quote is the board’s', () => {
    const s4 = section(4)
    const plain = SIGNAL_PALETTE.map(wireColorLabel)
    expect(plain).toEqual(['紫色', '青綠色', '粉紅色', '棕色', '灰色'])
    expect(s4).toContain(`| ${plain.join('、')} | 一般訊號`)
    expect(s4).toContain('**一個顏色只有一個意思**')
    expect(s4).toContain(`只用最後一列的${['', '一', '兩', '三', '四', '五', '六'][plain.length]}個顏色`)
    expect(s4).not.toContain('| 其他顏色 | 一般訊號') // the old row (yellow GPIO read as I²C SCL)
    // the quote is the blink example's own PA5 wire
    const blink: CircuitLayout = JSON.parse(read('examples/embedded/blink.ohmlet.json')).layout
    const pa5 = blink.wires.map((w) => wireRoleOf(blink, w.id).reason).find((r) => r.endsWith('：訊號（U1 PA5）'))
    expect(pa5).toBe('紫色：訊號（U1 PA5）')
    expect(s4).toContain(`範例「${JSON.parse(read('examples/embedded/index.json')).examples.find((e: { id: string }) => e.id === 'blink').title}」裡 PA5 接 LED 的線是紫色（「${pa5}」）`)
    // the phone legend's three signal dots, named
    const dots = wireLegendItems().find((i) => i.key === 'signal')!.colors.map(wireColorLabel)
    expect(s4).toContain(`訊號的三個圓點是一般訊號的${dots.join('、')}`)
  })

  it('電表, not 電錶: the meter lead’s words follow the term of the rest of the app', () => {
    const lead: CircuitLayout = {
      version: 1,
      name: 't',
      components: [{ id: 'DMM1', type: 'multimeter', params: { mode: 'V' } }],
      wires: [{ id: 'W1', from: 'DMM1:COM', to: 'a10' }],
    } as CircuitLayout
    expect(wireRoleOf(lead, 'W1').reason).toBe('黑色：電表表筆（DMM1 COM 端）')
    expect(read('src/i18n/zh-TW/simplify.ts')).not.toContain('電錶')
    expect(guide).not.toContain('電錶')
  })

  it('§3 / §8 delete without confirmation + 〔復原〕, the header trash, the common values', () => {
    expect(section(3)).toContain('〔復原〕')
    expect(section(8)).not.toContain('刪除元件（會先確認）')
    expect(section(8)).toContain('常用值')
    expect(section(8)).toContain('垃圾桶')
  })

  it('§19 / §20 / §21 loads act at once; only overwritten firmware asks', () => {
    expect(section(19)).toContain('載入完整答案')
    expect(section(19)).toContain('卡住了？載入完整答案')
    expect(section(19)).toContain('韌體無法復原')
    expect(section(20)).not.toContain('取代目前的電路與已載入的韌體')
    expect(section(21)).not.toContain('會先確認，可以復原')
  })

  it('顯示電流 (chip, 更多 row, key Shift+C), 音效, the cheer and the damage looks, 保持按下', () => {
    const s5 = section(5)
    expect(s5).toContain(`「${flowLegend()}」`) // the chip's / the 更多 row's legend, word for word
    expect(s5).toContain('「更多 → 模擬 → 顯示電流」')
    // round 5: a plain C picks up a capacitor (part-keys.ts) — 顯示電流 is Shift+C
    expect(section(23)).toMatch(/\| Shift\+C \| 顯示電流/)
    expect(section(23)).not.toMatch(/\| C \| 顯示電流/)
    expect(section(22)).toContain('**顯示電流**開關')
    expect(section(22)).toContain('**音效**開關')
    expect(s5).toContain(`「${t('Circuit working ✓')}」`)
    expect(s5).toContain(`「${t('Done!')}」`)
    // 保持按下: the inspector switch, double-click in 3D, released by one press or 重置模擬, never saved
    expect(s5).toContain(`「**${t('Keep pressed|latch')}**」`)
    expect(s5).toContain(`「${t('hold to press')} · ${t('double-click to keep pressed|latch')}」`)
    expect(s5).toContain(`「${t('kept pressed|latch')} · ${t('click to release|latch')}」`)
    expect(s5).toContain('「重置模擬」')
    expect(s5).toContain('不會存進專案檔')
    expect(section(21)).toContain(`「${t('Board cleared')}」附〔復原〕`)
  })
})
