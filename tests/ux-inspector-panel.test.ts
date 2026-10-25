/**
 * UX wave WS4 (inspector) — the pure pieces behind the panels:
 *
 *  - IN-2  honest MCU state: mcuUiStateOf / mcuReadoutsHidden (尚未執行 is
 *          never 未供電; paused / halted / BOOT0 / lockup), labels in zh-TW
 *  - IN-1  built-in firmware picker model: 本課使用 (solution first, error
 *          demos tagged with the mistake's symptom), 範例韌體, 其他; search;
 *          every bundled project listed exactly once and described
 *  - IN-3  problems: the problems panel view (anchor, groups, folded causes,
 *          「已由即時讀數排除」), problemWhere, problemTitle, sim power dedupe
 *  - IN-11 fault bits / xPSR flags decoded
 *  - IN-9  glossary + the workstream dictionary (Taiwan usage, no English left)
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { __setLangForTests, hasTranslation, t } from '../src/i18n'
import { tMessage } from '../src/i18n/messages'
import uxInspector from '../src/i18n/zh-TW/ux-inspector'
import type { CircuitLayout } from '../src/model/types'
import { bundledFirmwareNames } from '../src/firmware-assets'
import { lessonById } from '../src/lessons'
import { runErc, type ErcFinding } from '../src/sim/erc'
import { ERC_RULES } from '../src/sim/erc/api'
import {
  CFSR_BITS,
  HFSR_BITS,
  MCU_STATE_META,
  decodeFaultBits,
  mcuReadoutsHidden,
  mcuUiStateOf,
  xpsrFlags,
  type McuUiState,
} from '../src/ui/embedded/format'
import { GLOSSARY, glossaryText, pinModeTerm, type GlossaryId } from '../src/ui/embedded/glossary'
import { FIRMWARE_TEXT, filterGroups, firmwareGroups } from '../src/ui/embedded/BundledFirmwarePicker'
import { ErcPanel, ProblemsPanelView } from '../src/ui/embedded/ErcPanel'
import { deriveProblems, ercProblem, problemTitle, problemWhere, resolvedByLive, type Problem } from '../src/ui/embedded/problems'
import { tc } from '../src/ui/embedded/text'
import { LIBRARY } from '../src/ui/workspace/examples'
import { MAINLAND_TERMS, englishLeft } from './i18n/zh-check'
import { bluePill, part, tap, valid, w } from './erc/helpers'

beforeAll(() => __setLangForTests('zh-TW'))
afterAll(() => __setLangForTests('zh-TW'))

// ---------------------------------------------------------------------------
// IN-2
// ---------------------------------------------------------------------------

describe('IN-2 honest MCU state', () => {
  const at = (frame: { state: Parameters<typeof mcuUiStateOf>[0]['frame'] extends infer F ? (F extends { state: infer S } ? S : never) : never; pc?: number } | null, running: boolean, simTime: number, hasFirmware = true): McuUiState =>
    mcuUiStateOf({ hasFirmware, running, simTime, frame: frame ? { state: frame.state, pc: frame.pc ?? 0x08000100 } : null })

  it('before Run it is 尚未執行 — never 未供電, whatever the stale frame says', () => {
    expect(at(null, false, 0)).toBe('idle')
    expect(at({ state: 'unpowered' }, false, 0)).toBe('idle')
    expect(at({ state: 'running' }, false, 0)).toBe('idle')
    expect(at(null, false, 3)).toBe('idle') // reset cleared the frames
    expect(tc(MCU_STATE_META.idle.label, 'mcu-state')).toBe('尚未執行')
  })

  it('no firmware first; halted / lockup as reported; paused; system memory; the frame otherwise', () => {
    expect(at({ state: 'running' }, true, 1, false)).toBe('no-firmware')
    expect(at({ state: 'halted' }, false, 2)).toBe('halted')
    expect(at({ state: 'lockup' }, true, 2)).toBe('lockup')
    expect(at({ state: 'running' }, false, 2)).toBe('paused')
    expect(at({ state: 'sleeping' }, false, 2)).toBe('paused')
    expect(at({ state: 'running', pc: 0x1ffff008 }, true, 2)).toBe('boot-sysmem')
    expect(at({ state: 'unpowered' }, true, 2)).toBe('unpowered')
    expect(at({ state: 'running' }, true, 2)).toBe('running')
    expect(at(null, true, 0.01)).toBe('no-data')
    expect(tc(MCU_STATE_META.paused.label, 'mcu-state')).toBe('已暫停')
    expect(tc(MCU_STATE_META['boot-sysmem'].label, 'mcu-state')).toBe('系統記憶體開機（未模擬）')
  })

  it('PC / cycles / clock / speed read 「—」 when they would mean nothing', () => {
    for (const s of ['idle', 'no-firmware', 'unpowered', 'reset', 'no-data'] as McuUiState[]) expect(mcuReadoutsHidden(s), s).toBe(true)
    for (const s of ['running', 'paused', 'halted', 'lockup', 'boot-sysmem', 'sleeping'] as McuUiState[]) expect(mcuReadoutsHidden(s), s).toBe(false)
  })

  it('every state has a zh-TW label and tooltip; the old 「執行中 · 模擬已暫停」 wording is gone', () => {
    for (const m of Object.values(MCU_STATE_META)) {
      expect(hasTranslation(`${m.label}|mcu-state`), m.label).toBe(true)
      expect(t(m.hint)).not.toBe(m.hint)
    }
    expect(Object.values(uxInspector).some((v) => v.includes('執行中 · 模擬已暫停'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// IN-11
// ---------------------------------------------------------------------------

describe('IN-11 fault status and flags', () => {
  it('CFSR / HFSR bits decode to named causes, in zh-TW too', () => {
    // the BIN-at-the-wrong-address lockup of the audit: CFSR 0x00001001, HFSR 0x40000000
    const bits = decodeFaultBits(0x00001001, 0x40000000)
    expect(bits.map((b) => b.name)).toEqual(['IACCVIOL', 'STKERR', 'FORCED'])
    expect(t(bits[0].text)).toBe('指令存取違規')
    expect(t(bits[2].text)).toBe('升級為 HardFault')
    for (const [, , text] of [...CFSR_BITS, ...HFSR_BITS]) expect(hasTranslation(text), text).toBe(true)
    expect(decodeFaultBits(0x02000000, 0).map((b) => t(b.text))).toEqual(['除以零'])
  })
  it('xPSR condition flags', () => {
    expect(xpsrFlags(0x61000000)).toEqual({ N: false, Z: true, C: true, V: false })
    expect(xpsrFlags(0x91000000)).toEqual({ N: true, Z: false, C: false, V: true })
  })
})

// ---------------------------------------------------------------------------
// IN-1
// ---------------------------------------------------------------------------

describe('IN-1 built-in firmware picker model', () => {
  const names = bundledFirmwareNames()
  const i1 = lessonById('i1-gpio-output')!

  it('with lesson i1 open: hal-blink first, its error demos tagged with the mistake’s symptom', () => {
    const g = firmwareGroups(names, i1)
    expect(g.map((x) => x.id)).toEqual(['lesson', 'example', 'other'])
    const lesson = g[0].options
    expect(lesson[0]).toMatchObject({ name: 'hal-blink', mistake: false, title: 'Blue Pill 閃爍 LED（HAL）' })
    const noclk = lesson.find((o) => o.name === 'lesson-i1-noclk')!
    expect(noclk.mistake).toBe(true)
    expect(noclk.summary).toMatch(/PA5 的 LED1 完全不亮/)
    expect(noclk.title).toBe('忘了開 GPIOA 時脈')
    expect(lesson.find((o) => o.name === 'lesson-i1-od')?.mistake).toBe(true)
  })

  it('every bundled project is listed exactly once, each with a Chinese title and summary', () => {
    const g = firmwareGroups(names, null)
    expect(g.map((x) => x.id)).toEqual(['example', 'other'])
    const all = g.flatMap((x) => x.options.map((o) => o.name))
    expect(all.sort()).toEqual([...names].sort())
    const examples = new Set(LIBRARY.map((e) => e.firmware?.project).filter(Boolean))
    for (const n of names) if (!examples.has(n)) expect(FIRMWARE_TEXT[n], `FIRMWARE_TEXT['${n}']`).toBeDefined()
    for (const o of g.flatMap((x) => x.options)) {
      expect(englishLeft(o.title, ['micro', 'Wi', 'Fi']), `${o.name}: ${o.title}`).toEqual([])
      expect(o.summary.length, o.name).toBeGreaterThan(5)
      expect(/[一-鿿]/.test(o.summary), `${o.name}: ${o.summary}`).toBe(true)
    }
  })

  it('search matches the project name, the title or the summary (all terms)', () => {
    const g = firmwareGroups(names, i1)
    expect(filterGroups(g, 'noclk').flatMap((x) => x.options.map((o) => o.name))).toEqual(['lesson-i1-noclk'])
    expect(filterGroups(g, '閃爍 HAL').flatMap((x) => x.options.map((o) => o.name))).toContain('hal-blink')
    expect(filterGroups(g, 'zzz-nothing')).toEqual([])
    expect(filterGroups(g, '').flatMap((x) => x.options).length).toBe(names.length)
  })
})

// ---------------------------------------------------------------------------
// IN-3
// ---------------------------------------------------------------------------

describe('IN-3 problems panel', () => {
  const noPower: CircuitLayout = {
    version: 1,
    components: [
      { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
      { id: 'LED1', type: 'led', holes: ['a20', 'a24'] },
    ],
    wires: [],
  }

  it('the simulator’s power complaints fold into the ERC finding that explains them', () => {
    const findings = runErc(noPower)
    const p = deriveProblems({
      layout: noPower,
      findings,
      issues: [
        { level: 'warning', message: 'no ground' },
        { level: 'warning', message: 'no power supply' },
        { level: 'warning', message: 'U1: MCU unpowered (VDD 0.00 V) — feed 5V (on-board regulator) or 3V3, and connect GND', componentId: 'U1' },
        { level: 'warning', message: 'LED1 is reverse biased — swap its leads', componentId: 'LED1' },
      ],
      firmware: { U1: { componentId: 'U1', name: 'hal-blink.elf', format: 'elf', sha256: 'a', size: 1, loadedAt: 0, warnings: [] } },
      mcus: {},
      running: true,
      simTime: 2,
    })
    expect(p.filter((x) => x.source === 'sim').map((x) => x.componentIds)).toEqual([['LED1']])
    expect(p[0].title).toBe('電路中沒有電源')
  })

  it('a bare part id is never a headline', () => {
    expect(problemTitle('U1：MCU 未供電（VDD 0.00 V）——請供應 5V')).toBe('U1 MCU 未供電（VDD 0.00 V）')
    expect(problemTitle('沒有接地')).toBe('沒有接地')
  })

  // UX fix wave IN-20: the short pin form of helper H1 (「U1 PA5」, 「D1 陰極」), the full form as the chip title
  it('where a problem is: parts with the pins it names, wires by name', () => {
    const l = valid(bluePill([part('D1', 'led', ['a40', 'a48'])], [w(tap('PA5'), 'b40')]))
    const f = runErc(l).find((x) => x.rule === 'open-lead')!
    expect(problemWhere(ercProblem(f), l)).toBe('D1 陰極')
    const p: Problem = { id: 'x', level: 'error', source: 'erc', title: 't', detail: 'd', componentIds: ['U1'], holes: [tap('PA5').replace('a', 'c')], wireIds: ['W1'] }
    expect(problemWhere(p, l)).toBe('U1 PA5、導線 W1')
  })

  it('static risks the live readings cleared are listed apart', () => {
    const a = { id: 'floating-input:U1:PB12', rule: 'floating-input', level: 'risk', message: 'm', componentIds: ['U1'], nets: [], holes: [] } as ErcFinding
    const b = { ...a, id: 'led-current:D1', rule: 'led-current' } as ErcFinding
    expect(resolvedByLive([a, b], [b]).map((x) => x.id)).toEqual(['erc:floating-input:U1:PB12'])
  })

  it('renders the anchor, the header, the level groups, folded causes and the cleared group', () => {
    const base: Problem = { id: 'erc:i2c-pullup:a', level: 'warning', source: 'erc', title: 'I²C1 SCL 沒有上拉電阻', detail: '請在 SCL、SDA 各加一顆 4.7 kΩ 電阻到 3.3 V。', componentIds: ['U1'], holes: [], group: 'i2c-lone:U1' }
    const problems: Problem[] = [
      { id: 'erc:unpowered:no-source', level: 'error', source: 'erc', title: '電路中沒有電源', detail: '電路中沒有電源，因此 U1 無法運作。', componentIds: ['U1'], holes: [], rule: 'unpowered', action: { label: '載入韌體…', run: () => {} } },
      base,
      { ...base, id: 'erc:i2c-pullup:b', title: 'I²C1 SDA 沒有上拉電阻' },
      { id: 'erc:open-lead:R1:p1', level: 'info', source: 'erc', title: 'R1 第 1 腳沒接', detail: '…', componentIds: ['R1'], holes: ['a36'] },
    ]
    const resolved: Problem[] = [{ ...base, id: 'erc:floating-input:U1:PB12', title: 'U1 PB12 輸入浮接', group: undefined }]
    const html = renderToStaticMarkup(createElement(ProblemsPanelView, { problems, resolved, live: true }))
    expect(html).toContain('id="ws-problems"')
    expect(html).toContain('>問題<')
    expect(html).toMatch(/erc-badge is-error[^>]*>1</)
    expect(html).toMatch(/erc-badge is-risk[^>]*>2</)
    expect(html.indexOf('>錯誤 <')).toBeLessThan(html.indexOf('>風險 <'))
    expect(html).toContain('1 個原因 · 影響 2 處')
    expect(html.match(/class="erc-title"/g)?.length).toBe(3) // SCL + SDA folded into one row
    expect(html).toContain('已由即時讀數排除（1）')
    expect(html).toContain('載入韌體…')
    expect(html).toContain('在電路板上標示')
    expect(html).toContain('這是什麼？')
    const clear = renderToStaticMarkup(createElement(ProblemsPanelView, { problems: [], live: false }))
    expect(clear).toContain('未發現問題')
    expect(renderToStaticMarkup(createElement(ErcPanel))).toContain('id="ws-problems"')
  })
})

// ---------------------------------------------------------------------------
// IN-9 + dictionary
// ---------------------------------------------------------------------------

describe('IN-9 glossary and the ux-inspector dictionary', () => {
  it('every glossary term has a Chinese title and a one- or two-sentence body', () => {
    for (const id of Object.keys(GLOSSARY) as GlossaryId[]) {
      const g = glossaryText(id)
      // the dictionary has both sources of every entry (QA clarity GLOSSARY-ENTRIES: a new id needs its zh-TW text)
      if (id !== 'boot0') expect(hasTranslation(GLOSSARY[id].title), `${id} title`).toBe(true)
      expect(hasTranslation(GLOSSARY[id].body), `${id} body`).toBe(true)
      if (id !== 'boot0') expect(/[一-鿿]/.test(g.title), id).toBe(true)
      expect(/[一-鿿]/.test(g.body), id).toBe(true)
      expect(g.body.split('。').filter(Boolean).length, id).toBeLessThanOrEqual(3)
    }
    expect(pinModeTerm('af-od')).toBe('open-drain')
    expect(pinModeTerm('out')).toBe('push-pull')
    expect(t('Real time')).toBe('模擬速度')
    expect(tc('af-od', 'pin-mode')).toBe('複用開汲極')
  })

  it('Taiwan usage, intact placeholders, no stray English', () => {
    const allowed = ['micro', 'Wi', 'Fi', 'PC', 'BKPT', 'HAL', 'RAM', 'FreeRTOS', 'SystemCoreClock', 'HardFault', 'Thumb', 'xPSR']
    for (const [k, v] of Object.entries(uxInspector)) {
      expect(MAINLAND_TERMS.filter((m) => v.includes(m)), k).toEqual([])
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      expect(ph(v), k).toEqual(ph(k.replace(/\|[^|]*$/, '')))
      expect(englishLeft(v.replace(/\{\w+\}/g, ' '), allowed), `${k} → ${v}`).toEqual([])
    }
  })

  it('the new ERC rules are documented in both languages', () => {
    for (const id of ['open-lead', 'gpio-mode']) {
      const r = ERC_RULES.find((x) => x.id === id)!
      expect(hasTranslation(r.title), r.title).toBe(true)
      for (const s of Object.values(r.levels)) expect(tMessage(s)).not.toBe(s)
    }
  })
})
