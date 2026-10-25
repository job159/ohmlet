/**
 * UX wave IN-8 — ERC additions and message hygiene (src/sim/erc):
 *
 *  - i2c-pullup: an MCU pin the running firmware made I²C open-drain
 *    (af-od) with nothing on its net still needs pull-ups (ENG-07: Blue Pill
 *    + hal-i2c-scan, PB6 / PB7 af-od, nothing wired) — one cause for SCL+SDA
 *  - gpio-mode (live, ≥ 0.5 s): an LED on PA5 while the firmware leaves PA5
 *    an input (hal-uart-hello with the blink wiring)
 *  - supply-short: a regulator OUTPUT tied to GND (LM7805 example + a wire
 *    top+45 → top−46, AN-07) is an error naming the wire
 *  - hygiene: datasheet citations live in ErcFinding.ref, never in the main
 *    message; a battery short is worded as a battery; short headlines
 *  - IN-17 (fix wave): a reversed LED between rails is a risk, facing a GPIO
 *    it is info until the simulation measures it reverse-biased (error,
 *    naming both holes and the voltage); a lead on a rail no supply feeds
 *    names that rail and how to feed it; rail-unpowered (info)
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ERC_RULES, runErc, type ErcFinding } from '../src/sim/erc'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { __setLangForTests, t } from '../src/i18n'
import { tMessage } from '../src/i18n/messages'
import { bluePill, layout, modesTelemetry, ofRule, part, railsWorld, summary, tap, valid, w } from './erc/helpers'
import { englishLeft } from './i18n/zh-check'

beforeAll(() => __setLangForTests('en'))
afterAll(() => __setLangForTests('zh-TW'))

const ROOT = path.resolve(__dirname, '..')
const live = (modes: Record<string, string>, time = 1, firmware = 'hal-uart-hello.elf'): SimTelemetry => {
  const tel = modesTelemetry(modes)
  tel.time = time
  tel.components.U1.mcu!.firmware = firmware
  return tel
}

describe('i2c-pullup: I²C pins made open-drain by the firmware, nothing wired (ENG-07)', () => {
  const l = valid(bluePill())
  it('is a risk per line, one cause for SCL and SDA', () => {
    const f = ofRule(runErc(l, { telemetry: modesTelemetry({ PB6: 'af-od', PB7: 'af-od' }) }), 'i2c-pullup')
    expect(f.map((x) => x.level), summary(f)).toEqual(['risk', 'risk'])
    expect(f.map((x) => x.short).sort()).toEqual(['I²C1 SCL has no pull-up', 'I²C1 SDA has no pull-up'])
    expect(new Set(f.map((x) => x.group)).size).toBe(1)
    expect(f[0].ref).toBe('NXP UM10204 §3.1.1')
    __setLangForTests('zh-TW')
    const scl = f.find((x) => x.message.includes('SCL'))!
    expect(tMessage(scl.message)).toBe('I²C1 SCL（U1 PB6）設成開汲極，但網路上沒有上拉電阻：請在 SCL、SDA 各加一顆 4.7 kΩ 電阻到 3.3 V。')
    expect(tMessage(scl.short!)).toBe('I²C1 SCL 沒有上拉電阻')
    __setLangForTests('en')
  })

  it('plain GPIO open-drain (hal-gpio-modes) and pins with a pull-up are left alone', () => {
    expect(ofRule(runErc(l, { telemetry: modesTelemetry({ PB6: 'od', PB7: 'od' }) }), 'i2c-pullup')).toEqual([])
    const pulled = valid(
      bluePill(
        [part('R1', 'resistor', [tap('PB6'), 'bot+30'], { resistance: 4700 }), part('R2', 'resistor', [tap('PB7'), 'bot+31'], { resistance: 4700 })],
        [],
        { rail3v3: true },
      ),
    )
    expect(ofRule(runErc(pulled, { telemetry: modesTelemetry({ PB6: 'af-od', PB7: 'af-od' }) }), 'i2c-pullup')).toEqual([])
  })
})

describe('gpio-mode: a load on a pin the firmware never drives', () => {
  // the blink wiring: PA5 → R1 → LED → GND
  const l = valid(
    bluePill([part('R1', 'resistor', ['a40', 'a45'], { resistance: 330 }), part('D1', 'led', ['b45', 'top-9'])], [w(tap('PA5'), 'b40')]),
  )

  it('uart-hello leaves PA5 a floating input: risk naming the LED, the pin and the firmware', () => {
    const f = ofRule(runErc(l, { telemetry: live({ PA5: 'in' }) }), 'gpio-mode')
    expect(f, summary(f)).toHaveLength(1)
    expect(f[0]).toMatchObject({ level: 'risk', short: 'D1 on PA5: not an output' })
    expect(f[0].componentIds).toEqual(expect.arrayContaining(['D1', 'U1', 'R1']))
    expect(f[0].message).toContain('hal-uart-hello.elf')
    __setLangForTests('zh-TW')
    const zh = tMessage(f[0].message)
    expect(zh).toBe(
      'D1 接在 U1 PA5，但目前的韌體（hal-uart-hello.elf）沒有把 PA5 設成輸出（現在是浮接輸入），所以 LED 不會亮。請確認韌體控制的是哪一支腳（「腳位」分頁列出每支腳的模式）。',
    )
    expect(englishLeft(zh)).toEqual([])
    expect(tMessage(f[0].short!)).toBe('D1 接在 PA5，但 PA5 不是輸出')
    __setLangForTests('en')
  })

  it('not before 0.5 s of running, not for an output, not statically', () => {
    expect(ofRule(runErc(l, { telemetry: live({ PA5: 'in' }, 0.2) }), 'gpio-mode')).toEqual([])
    expect(ofRule(runErc(l, { telemetry: live({ PA5: 'out' }, 2, 'hal-blink.elf') }), 'gpio-mode')).toEqual([])
    expect(ofRule(runErc(l), 'gpio-mode')).toEqual([])
  })

  it('not while the core is locked up, halted or unpowered (that board has a more basic problem)', () => {
    for (const state of ['lockup', 'halted', 'unpowered', 'reset'] as const) {
      const tel = live({ PA5: 'in' })
      tel.components.U1.mcu!.state = state
      expect(ofRule(runErc(l, { telemetry: tel }), 'gpio-mode'), state).toEqual([])
    }
  })

  it('a button on an input pin is not a load', () => {
    const b = valid(bluePill([{ id: 'SW1', type: 'pushbutton', at: 'f50' }], [w(tap('PB12'), 'j50'), w('j52', 'top-12')]))
    expect(ofRule(runErc(b, { telemetry: live({ PB12: 'in↑' }) }), 'gpio-mode')).toEqual([])
  })
})

describe('supply-short: a regulator output tied to GND (AN-07)', () => {
  const env = JSON.parse(readFileSync(path.join(ROOT, 'examples/embedded/lm7805-regulator.ohmlet.json'), 'utf8')) as { layout: CircuitLayout }
  it('the example itself has no supply short', () => {
    expect(ofRule(runErc(env.layout), 'supply-short')).toEqual([])
  })

  it('a wire top+45 → top−46 is an error that names the wire', () => {
    const l: CircuitLayout = { ...env.layout, wires: [...env.layout.wires, { id: 'W1', from: 'top+45', to: 'top-46' }] }
    const f = ofRule(runErc(l), 'supply-short').filter((x) => x.level === 'error')
    const out = f.find((x) => x.id === 'supply-short:U1:REG:out')
    expect(out, summary(f)).toBeDefined()
    expect(out!.wireIds).toContain('W1')
    expect(out!.short).toBe('U1 OUT shorted to GND')
    expect(out!.message).toMatch(/^Regulator output shorted: U1 OUT reaches GND through wires .*W1/)
    __setLangForTests('zh-TW')
    expect(tMessage(out!.message)).toMatch(/^穩壓輸出短路：U1 的 OUT（經由導線 .*W1.*）接到 GND。/)
    expect(tMessage(out!.short!)).toBe('U1 的 OUT 對地短路')
    __setLangForTests('en')
  })
})

describe('message hygiene', () => {
  const fixtures: [string, CircuitLayout, SimTelemetry | null][] = [
    ['GPIO LED without resistor', valid(bluePill([part('D1', 'led', [tap('PA5'), 'top-9'])])), null],
    ['5 V on PA0', valid(bluePill([], [w('top+20', tap('PA0'))])), null],
    ['5 V on FT PA9 with pull-up', valid(bluePill([], [w('top+20', tap('PA9'))])), modesTelemetry({ PA9: 'in↑' })],
    ['3.3 V pin fed 5 V', valid(bluePill([], [], { via3v3: true })), null],
    ['button on a push-pull output', valid(bluePill([{ id: 'SW1', type: 'pushbutton', at: 'f50' }], [w(tap('PB12'), 'j50'), w('j52', 'top-12')])), modesTelemetry({ PB12: 'out' })],
  ]
  for (const [name, l, tel] of fixtures) {
    it(`${name}: no datasheet citation in the main message; references are kept`, () => {
      const f: ErcFinding[] = runErc(l, { telemetry: tel })
      expect(f.length, name).toBeGreaterThan(0)
      for (const x of f) expect(x.message, x.id).not.toMatch(/DS5319|UM10204|pin model|data sheet/)
      expect(f.some((x) => x.ref && /DS5319/.test(x.ref)), summary(f)).toBe(true)
      __setLangForTests('zh-TW')
      for (const x of f) {
        if (x.ref) expect(tMessage(x.ref), x.ref).not.toMatch(/Table|estimate/)
        if (x.short) expect(englishLeft(tMessage(x.short)), x.short).toEqual([])
      }
      __setLangForTests('en')
    })
  }

  it('every finding of the fixtures has a short headline of at most 22 characters in zh-TW', () => {
    __setLangForTests('zh-TW')
    for (const [, l, tel] of fixtures) {
      for (const x of runErc(l, { telemetry: tel })) {
        expect(x.short, x.id).toBeTruthy()
        expect(tMessage(x.short!).length, tMessage(x.short!)).toBeLessThanOrEqual(22)
      }
    }
    __setLangForTests('en')
  })

  it('a battery short is worded as a battery, a bench supply as a bench supply', () => {
    const bat = layout([{ id: 'BAT1', type: 'battery_9v' }], [w('BAT1:+', 'top+3'), w('BAT1:-', 'top+5')])
    const fb = ofRule(runErc(bat), 'supply-short')[0]
    expect(fb.message).toContain('a battery drives its full short-circuit current')
    expect(fb.message).not.toContain('bench supply')
    const ps = railsWorld([], [w('top+3', 'top-3')])
    const fp = ofRule(runErc(ps), 'supply-short')[0]
    expect(fp.message).toContain('the bench supply has no current limit')
    __setLangForTests('zh-TW')
    expect(tMessage(fb.message)).toContain('電池會輸出它全部的短路電流')
    expect(tMessage(fp.message)).toContain('桌上型電源沒有限流')
    __setLangForTests('en')
  })
})

// ---------------------------------------------------------------------------
// UX fix wave IN-17 — the two classic beginner mistakes, caught correctly
// ---------------------------------------------------------------------------

describe('IN-17 a reversed LED', () => {
  // the student's B46 layout: anode on the − rail, cathode in PA5's strip
  const gpioReversed = valid(bluePill([part('LED1', 'led', ['top-9', tap('PA5')])]))
  const reversedOnPa5 = (f: readonly ErcFinding[]) => f.filter((x) => x.id === 'led-current:LED1:reversed')

  it('between two rails it can never light: a risk (was info)', () => {
    const l = valid(railsWorld([part('R1', 'resistor', ['top+5', 'a40'], { resistance: 330 }), part('D1', 'led', ['top-5', 'b40'])]))
    const f = ofRule(runErc(l), 'led-current')
    expect(f.map((x) => [x.id, x.level])).toEqual([['led-current:D1:reversed', 'risk']])
    expect(f[0].fact).toBe('reversed:D1')
  })

  it('facing a GPIO: info before the run (the pin may stay low) …', () => {
    const f = reversedOnPa5(runErc(gpioReversed))
    expect(f).toHaveLength(1)
    expect(f[0].level).toBe('info')
    expect(f[0].message).toMatch(/^LED1 faces U1 PA5 the wrong way round/)
  })

  it('… an error once the simulation shows the cathode 3.30 V above the anode with no current', () => {
    const tel: SimTelemetry = {
      time: 1,
      netVoltages: {},
      issues: [],
      components: { LED1: { pinVoltages: { anode: 0, cathode: 3.3 }, current: -7.6e-12, ledBrightness: 0, burned: false } },
    }
    const f = reversedOnPa5(runErc(gpioReversed, { telemetry: tel }))
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ level: 'error', short: 'LED1 may be reversed', fact: 'reversed:LED1', holes: ['top-9', tap('PA5')] })
    __setLangForTests('zh-TW')
    expect(tMessage(f[0].message)).toBe(`LED1 可能接反了：長腳（陽極）在 top-9、短腳（陰極）在 ${tap('PA5')}；陰極比陽極高 3.30 V，所以不會亮。請把兩支腳對調。`)
    expect(tMessage(f[0].short!)).toBe('LED1 可能接反了')
    __setLangForTests('en')
    // the pin driving low: nothing measured against it — the static info stays
    tel.components.LED1.pinVoltages = { anode: 0, cathode: 0 }
    expect(reversedOnPa5(runErc(gpioReversed, { telemetry: tel })).map((x) => x.level)).toEqual(['info'])
  })

  it('a correctly wired LED is never called reversed', () => {
    const ok = valid(bluePill([part('R1', 'resistor', ['a40', 'a45'], { resistance: 330 }), part('LED1', 'led', ['b45', 'top-9'])], [w(tap('PA5'), 'b40')]))
    const tel: SimTelemetry = { time: 1, netVoltages: {}, issues: [], components: { LED1: { pinVoltages: { anode: 2.0, cathode: 0 }, current: 0.004 } } }
    expect(ofRule(runErc(ok, { telemetry: tel }), 'led-current')).toEqual([])
  })
})

describe('IN-17 a lead on a rail no supply feeds', () => {
  // PA5 → R1 → D1, the cathode wired to the BOTTOM − rail; only the top rails are powered
  const l = valid(
    bluePill([part('R1', 'resistor', ['a40', 'a45'], { resistance: 330 }), part('D1', 'led', ['b45', 'a48'])], [w(tap('PA5'), 'b40'), w('b48', 'bot-30')]),
  )

  it('names the floating rail and how to feed it, and marks the whole rail', () => {
    const f = runErc(l, { telemetry: { time: 0.5, netVoltages: {}, issues: [], components: {} } }).filter((x) => x.rule === 'open-lead')
    expect(f).toHaveLength(1)
    expect(f[0].level).toBe('risk')
    expect(f[0].message).toBe(
      'D1’s cathode (a48) goes to the bottom − rail, but no supply feeds that rail (PS1:-), so the current cannot get back. Wire the bottom − rail to the top − rail, or straight to PS1:-.',
    )
    expect(f[0].holes[0]).toBe('a48')
    expect(f[0].holes).toContain('bot-0')
    expect(f[0].holes.length).toBeGreaterThan(40)
    __setLangForTests('zh-TW')
    expect(tMessage(f[0].message)).toBe(
      'D1 的陰極（a48）接到下方 − 電源軌，但這條電源軌沒有接到電源（PS1 負端），所以電流回不去。請用導線把下方 − 電源軌接到上方 − 電源軌，或直接接到 PS1 負端。',
    )
    __setLangForTests('en')
  })

  it('rail-unpowered (info): two LEDs share the unfed bottom − rail', () => {
    const two = valid(
      bluePill(
        [part('D1', 'led', ['top+20', 'a48']), part('D2', 'led', ['top+21', 'a50'])],
        [w('b48', 'bot-30'), w('b50', 'bot-31')],
      ),
    )
    const f = runErc(two).filter((x) => x.rule === 'rail-unpowered')
    expect(f.map((x) => [x.id, x.level])).toEqual([['rail-unpowered:bot-', 'info']])
    expect(f[0].componentIds.sort()).toEqual(['D1', 'D2'])
    __setLangForTests('zh-TW')
    expect(tMessage(f[0].message)).toMatch(/^下方 − 電源軌接了 D1、D2、導線 w\d+ 與 導線 w\d+，但沒有接到任何電源，所以接在上面的東西都沒有接地。請用導線把下方 − 電源軌接到上方 − 電源軌，或直接接到 PS1 負端。$/)
    expect(tMessage(f[0].short!)).toBe('下方 − 電源軌沒有接電源')
    expect(t(ERC_RULES.find((r) => r.id === 'rail-unpowered')!.title)).toBe('電源軌沒有接電源')
    __setLangForTests('en')
    // fed: the bottom − rail wired to the top − rail
    expect(runErc({ ...two, wires: [...two.wires, w('top-40', 'bot-40')] }).filter((x) => x.rule === 'rail-unpowered')).toEqual([])
  })
})
