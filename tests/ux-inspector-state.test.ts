/**
 * UX wave WS4 (inspector) — the pieces finished in the continuation pass:
 *
 *  - IN-2  "nothing has run since the last reset": a re-flash or Reset MCU
 *          while paused hides the board's previous frame (its PC / symbol /
 *          lockup describe the old run) until a newer frame arrives
 *  - IN-6  the 周邊 tab groups the support table 時脈與電源／GPIO／計時器／
 *          通訊／類比／其他 and collapses each note to its first sentence
 *  - IN-8  a burned-out LED's solver current reads 「> 2 A（短路）」, smaller
 *          currents get thin-space grouping (STU-14)
 *  - copy  the reason lines point at the button right below them
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { __setLangForTests, t, hasTranslation } from '../src/i18n'
import { tMessage } from '../src/i18n/messages'
import { supportTable } from '../src/mcu/stm32f1/peripherals'
import type { McuFrameInfo } from '../src/sim/coordinator/api'
import type { FirmwareRecord } from '../src/state/lab-types'
import { mergeTitles } from '../src/ui/embedded/ErcPanel'
import { firstSentence, peripheralFamilies } from '../src/ui/embedded/McuPanel'
import { __resetProblemsForTests, frameSinceReset, noteMcuReset, trackMcuResets } from '../src/ui/embedded/problems'
import { useLab } from '../src/ui/embedded/lab'
import { tc } from '../src/ui/embedded/text'

beforeAll(() => __setLangForTests('zh-TW'))

const frame = (pc: number, state: McuFrameInfo['state'] = 'running'): McuFrameInfo => ({
  componentId: 'U1',
  state,
  firmware: 'hal-blink.elf',
  pc,
  hclkHz: 72e6,
  cycles: 1000,
  realtime: 1,
  uarts: [],
})

const record = (name: string): FirmwareRecord => ({
  componentId: 'U1',
  name,
  format: 'elf',
  sha256: name,
  size: 1,
  loadedAt: 0,
  warnings: [],
})

describe('IN-2 a reset makes the last frame history', () => {
  afterEach(() => {
    useLab.setState({ mcus: {}, firmware: {} })
    __resetProblemsForTests()
  })

  it('Reset MCU while paused: the old frame no longer counts; the next frame does', () => {
    const old = frame(0x08000310)
    useLab.setState({ mcus: { U1: old } })
    expect(frameSinceReset('U1', old)).toBe(old)
    noteMcuReset('U1')
    expect(frameSinceReset('U1', old)).toBeUndefined()
    const next = frame(0x08000b44)
    useLab.setState({ mcus: { U1: next } })
    expect(frameSinceReset('U1', next)).toBe(next)
    // other boards are untouched
    const other = { ...frame(0x08000100), componentId: 'U2' }
    expect(frameSinceReset('U2', other)).toBe(other)
  })

  it('a firmware (re)binding marks the board’s frame from before the swap', () => {
    trackMcuResets()
    const old = frame(0x08001388, 'lockup')
    useLab.setState({ firmware: { U1: record('hal-blink.elf') } })
    useLab.setState({ mcus: { U1: old } }) // the run of hal-blink
    expect(frameSinceReset('U1', old)).toBe(old)
    useLab.setState({ firmware: { U1: record('hal-uart-hello.bin') } })
    expect(frameSinceReset('U1', old)).toBeUndefined()
  })
})

describe('IN-6 peripherals grouped by family', () => {
  const table = supportTable()
  const families = peripheralFamilies(table)

  it('every block of the STM32F103 support table appears exactly once', () => {
    const names = families.flatMap((f) => f.items.map((p) => p.name))
    expect(names.sort()).toEqual(table.map((p) => p.name).sort())
  })

  it('families in display order, with the expected members, titles in zh-TW', () => {
    const titles = families.map((f) => f.title)
    expect(titles).toEqual(['Clock and power', 'GPIO', 'Timers', 'Communication', 'Analog', 'Other'])
    const of = (title: string) => families.find((f) => f.title === title)!.items.map((p) => p.name)
    expect(of('Clock and power')).toContain('RCC')
    expect(of('GPIO')).toEqual(expect.arrayContaining(['GPIO', 'AFIO', 'EXTI']))
    expect(of('Timers')).toEqual(expect.arrayContaining(['TIM1', 'TIM2', 'TIM3', 'TIM4', 'IWDG']))
    expect(of('Communication')).toEqual(expect.arrayContaining(['USART1', 'SPI1', 'I2C1', 'CAN', 'USB']))
    expect(of('Analog')).toEqual(expect.arrayContaining(['ADC1', 'ADC2']))
    expect(of('Other')).toContain('DMA1')
    expect(titles.map((x) => tc(x, 'periph-group'))).toEqual(['時脈與電源', 'GPIO', '計時器', '通訊', '類比', '其他'])
  })

  it('a collapsed row shows the first sentence of the localized note', () => {
    expect(firstSentence('Not implemented: registers read 0, writes ignored. RCC_BDCR itself works.')).toBe(
      'Not implemented: registers read 0, writes ignored.',
    )
    expect(firstSentence('未實作：暫存器讀回 0。RCC_BDCR 本身可用。')).toBe('未實作：暫存器讀回 0。')
    expect(firstSentence('0x08000000 at 8.5 MHz works')).toBe('0x08000000 at 8.5 MHz works')
    for (const p of table) expect(firstSentence(tMessage(p.notes)).length).toBeGreaterThan(0)
  })
})

describe('IN-8 one cause, one headline', () => {
  it('folded I²C lines name both signals; unrelated headlines keep the first', () => {
    expect(mergeTitles(['I²C1 SCL 沒有上拉電阻', 'I²C1 SDA 沒有上拉電阻'])).toBe('I²C1 SCL、SDA 沒有上拉電阻')
    expect(mergeTitles(['U1 的 OUT 對地短路', 'U2 輸入浮接'])).toBe('U1 的 OUT 對地短路')
    expect(mergeTitles(['電路中沒有電源'])).toBe('電路中沒有電源')
  })
})

describe('IN-8 measured currents read as what they mean', () => {
  it('a burned-out LED’s solver current is a short circuit, not 267295 mA', () => {
    const s = tMessage('LED D1 burned out (current 267295mA — add a series resistor)')
    expect(s).toBe('LED D1 已燒毀：電流 > 2 A（短路）。請串聯限流電阻。')
    expect(tMessage('LED D1 burned out (current 1234mA — add a series resistor)')).toContain('1 234 mA')
    expect(tMessage('LED D1 burned out (current 31mA — add a series resistor)')).toContain('電流 31 mA')
  })
})

describe('reason lines point at what is right there', () => {
  it('idle / no firmware / burned LED copy is translated and names the visible button', () => {
    for (const key of [
      'Press “▶ Run” or the Space bar to start the simulation.',
      'Press “▶ Run” to start the simulation.',
      'The MCU has no program to run until it gets firmware: pick one below.',
      'Burned out — add a series resistor and run the simulation again: the simulated LED recovers.',
    ]) {
      expect(hasTranslation(key), key).toBe(true)
    }
    // the visible button is 「執行模擬」 (QA IN-F8 — one verb for the run control)
    expect(t('Press “▶ Run” or the Space bar to start the simulation.')).toBe('按「▶ 執行模擬」或空白鍵開始模擬。')
    expect(t('Press “▶ Run” to start the simulation.')).toBe('按「▶ 執行模擬」開始模擬。')
    expect(t('The MCU has no program to run until it gets firmware: pick one below.')).toContain('下方')
    expect(t('Burned out — add a series resistor and run the simulation again: the simulated LED recovers.')).not.toContain('更換')
  })
})
