/**
 * Release QA SIM-F3 (AN-09) + SIM-F1 support text: what a part's 支援 /
 * 限制 list says about what is NOT simulated must match the model.
 *
 *  - stm32_bluepill: the MCU core's own supply current (IDD) is not modelled
 *    — a bench supply feeding a 72 MHz Blue Pill reads only the board's
 *    LEDs / pull-ups (~2 mA), not the 20–36 mA the chip itself draws.
 *  - multimeter: the display is a ~100 ms gate mean (an integrating meter),
 *    so a PWM pin reads its average.
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { loadFirmwareFile } from '../../src/mcu/loader'
import { __setLangForTests } from '../../src/i18n'
import { partSupport } from '../../src/i18n/parts'
import { getEntry, supportOf } from '../../src/model/catalog'
import type { CircuitLayout } from '../../src/model/types'
import '../../src/mcu/all'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import { checkBoardTap as tap } from '../../src/sim/coordinator/checks'

afterEach(() => __setLangForTests('zh-TW'))

const IDD_EN = "The MCU core's own supply current (IDD, about 20–36 mA at 72 MHz) is not simulated: a bench supply's current excludes the chip itself"
const IDD_ZH = '晶片本身的耗電（72 MHz 時約 20–36 mA）未模擬：電源供應器讀到的電流不含晶片本身'

describe('stm32_bluepill 支援 / 限制: IDD is not simulated (SIM-F3)', () => {
  it('lists the line in English and in zh-TW, in the same position', () => {
    const entry = getEntry('stm32_bluepill')!
    const en = supportOf(entry).limits ?? []
    expect(en).toContain(IDD_EN)
    __setLangForTests('zh-TW')
    const zh = partSupport(entry).limits ?? []
    expect(zh).toHaveLength(en.length)
    expect(zh[en.indexOf(IDD_EN)]).toBe(IDD_ZH)
  })

  it('is true of the model: PS1 feeding a running 72 MHz Blue Pill reads only the board parts, not 20–36 mA', { timeout: 60_000 }, () => {
    const res = loadFirmwareFile('hal-blink.elf', new Uint8Array(readFileSync(new URL('../../firmware/dist/hal-blink.elf', import.meta.url))))
    if (!res.ok) throw new Error(res.error)
    let seq = 0
    const w = (from: string, to: string) => ({ id: `w${++seq}`, from, to })
    const layout: CircuitLayout = {
      version: 1,
      components: [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }, { id: 'U1', type: 'stm32_bluepill', at: 'h10' }],
      wires: [w('PS1:+', tap('5V')), w('PS1:-', 'top-0'), w(tap('GND3'), 'top-1')],
    }
    const co = new SimulationCoordinator()
    co.load(layout, 1)
    co.setFirmware('U1', res.image)
    co.advance(0.05)
    const info = co.frame(true).mcus.find((m) => m.componentId === 'U1')!
    expect(info.hclkHz).toBe(72_000_000)
    const i = Math.abs(co.telemetry().components.PS1.current ?? NaN)
    expect(i).toBeGreaterThan(0.0005) // the power LED and friends
    expect(i).toBeLessThan(0.01) // no IDD: far below the datasheet's 20–36 mA
  })
})

describe('multimeter 支援: the display is a gate mean (SIM-F1)', () => {
  it('says so in English and zh-TW', () => {
    const entry = getEntry('multimeter')!
    const en = supportOf(entry).simulated ?? []
    const k = en.findIndex((s) => s.includes('~100 ms gate'))
    expect(k).toBeGreaterThanOrEqual(0)
    __setLangForTests('zh-TW')
    const zh = partSupport(entry).simulated ?? []
    expect(zh).toHaveLength(en.length)
    expect(zh[k]).toContain('約 100 ms')
    expect(zh[k]).toContain('工作週期')
  })
})
