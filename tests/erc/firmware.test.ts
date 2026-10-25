/**
 * ERC with telemetry from REAL firmware running on the stm32f103c8 model in
 * the Simulation Coordinator (firmware/dist, ST HAL v1.1.9):
 *
 *  hal-gpio-modes.elf — PA1 input pull-up, PA2 input pull-down, PA3
 *    floating input, PB6/PB7 open-drain outputs, PA9/PA10 USART1 (PA10
 *    input pull-up). The pin modes the firmware programs clear / keep the
 *    floating-input findings, make the I²C rule certain and flag an FT pin
 *    held above VDD + 0.3 V with its pull-up enabled.
 *  hal-blink.elf — drives PA5 high; with PA5 strapped to GND the
 *    coordinator measures the driver over-current and the ERC reports it.
 *  hal-i2c-scan.elf — hardware I2C1 on PB6/PB7 (alternate-function open
 *    drain) with an AT24C02 on the bus: without pull-ups the I²C rule is an
 *    error, with 4.7 kΩ pull-ups it is clean.
 *
 * Skipped unless the MCU barrel registers 'stm32f103c8' and the firmware
 * loader is present (same guard as tests/coordinator/firmware-e2e.test.ts).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registeredMcus } from '../../src/mcu/registry'
import type { LoadResult } from '../../src/mcu/firmware'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import { CATALOG } from '../../src/model/catalog'
import type { CircuitLayout, ComponentInstance, SimIssue, SimTelemetry } from '../../src/model/types'
import { runErc } from '../../src/sim/erc'
import { I2C_DEV, bluePill, ofRule, part, sensor, sensorPower, summary, tap, valid, w } from './helpers'

import.meta.glob('../../src/mcu/all.ts', { eager: true })
const loaderMods = import.meta.glob('../../src/mcu/loader/index.ts', { eager: true }) as Record<
  string,
  { loadFirmwareFile?: (name: string, bytes: Uint8Array) => LoadResult }
>
const loadFirmwareFile = Object.values(loaderMods)[0]?.loadFirmwareFile
const available = registeredMcus().includes('stm32f103c8') && typeof loadFirmwareFile === 'function'
const HERE = dirname(fileURLToPath(import.meta.url))
const has = (t: string) => !!CATALOG[t]

function run(elf: string, l: CircuitLayout, seconds: number): { telemetry: SimTelemetry; issues: SimIssue[] } {
  const res = loadFirmwareFile!(elf, new Uint8Array(readFileSync(join(HERE, '../../firmware/dist', elf))))
  if (!res.ok) throw new Error(res.error)
  const co = new SimulationCoordinator()
  co.load(l, 1)
  co.setFirmware('U1', res.image)
  co.advance(seconds)
  const out = { telemetry: co.telemetry(), issues: co.issues() }
  co.dispose()
  return out
}

describe.skipIf(!available)('ERC with real firmware telemetry', () => {
  beforeAll(() => {
    CATALOG[I2C_DEV.type] = I2C_DEV
  })
  afterAll(() => {
    delete CATALOG[I2C_DEV.type]
  })

  // buttons: SW1 PA1 → GND, SW2 PA2 → 3.3 V, SW3 PA3 → GND; PA10 (FT, RX pull-up) strapped to 5 V
  const buttons: ComponentInstance[] = [
    { id: 'SW1', type: 'pushbutton', at: 'f40' },
    { id: 'SW2', type: 'pushbutton', at: 'f45' },
    { id: 'SW3', type: 'pushbutton', at: 'f50' },
  ]
  const buttonWires = [
    w(tap('PA1'), 'a40'),
    w('a42', 'bot-1'),
    w(tap('PA2'), 'a45'),
    w('a47', 'bot+1'),
    w(tap('PA3'), 'a50'),
    w('a52', 'bot-2'),
    w(tap('PA10'), 'top+9'),
  ]
  const world = valid(bluePill(buttons, buttonWires, { rail3v3: true }))
  let gpioModes: { telemetry: SimTelemetry; issues: SimIssue[] } | null = null
  const modes = () => (gpioModes ??= run('hal-gpio-modes.elf', world, 0.03))

  it('hal-gpio-modes programs the pin modes the rules read', { timeout: 120_000 }, () => {
    const t = modes().telemetry.components.U1.mcu
    expect(t?.state).toBe('running')
    expect(t?.pinModes).toMatchObject({ PA1: 'in↑', PA2: 'in↓', PA3: 'in', PB6: 'od', PB7: 'od', PA10: 'in↑' })
  })

  it('floating inputs: the firmware pulls clear PA1 and PA2, PA3 stays a risk', { timeout: 120_000 }, () => {
    const statik = ofRule(runErc(world), 'floating-input')
    expect(statik.map((f) => f.id).sort(), summary(statik)).toEqual([
      'floating-input:U1:PA1',
      'floating-input:U1:PA2',
      'floating-input:U1:PA3',
    ])
    const live = ofRule(runErc(world, modes()), 'floating-input')
    expect(live.map((f) => f.id), summary(live)).toEqual(['floating-input:U1:PA3'])
    expect(live[0].message).toMatch(/running firmware configured U1 PA3 as a floating input/)
  })

  it('FT pin PA10 at 5 V with the firmware pull-up enabled is a risk (DS5319 Table 9 note 3)', { timeout: 120_000 }, () => {
    expect(ofRule(runErc(world), 'gpio-overvoltage').map((f) => f.level)).toEqual(['info'])
    const live = ofRule(runErc(world, modes()), 'gpio-overvoltage')
    expect(live.map((f) => f.level), summary(live)).toEqual(['risk'])
    expect(live[0].message).toMatch(/pull-up/)
  })

  it('I²C: a sensor on the open-drain PB6/PB7 without pull-ups is an error; with pull-ups it is clean', { timeout: 120_000 }, () => {
    const bus = (pullups: boolean) =>
      valid(
        bluePill(
          [
            sensor('U2', 55),
            ...(pullups
              ? [
                  part('R1', 'resistor', ['c57', 'bot+30'], { resistance: 4700 }),
                  part('R2', 'resistor', ['c58', 'bot+31'], { resistance: 4700 }),
                ]
              : []),
          ],
          [...sensorPower(55), w('b57', tap('PB6')), w('b58', tap('PB7'))],
          { rail3v3: true },
        ),
      )
    // without telemetry the firmware's use of PB6/PB7 is unknown → risk
    expect(ofRule(runErc(bus(false)), 'i2c-pullup').map((f) => f.level)).toEqual(['risk', 'risk'])
    const live = ofRule(runErc(bus(false), modes()), 'i2c-pullup')
    expect(live.map((f) => f.level), summary(live)).toEqual(['error', 'error'])
    expect(ofRule(runErc(bus(true), modes()), 'i2c-pullup')).toEqual([])
  })

  it('hal-blink driving PA5 into a GND strap: the measured over-current becomes a finding', { timeout: 120_000 }, () => {
    const l = valid(bluePill([], [w(tap('PA5'), 'top-5')]))
    expect(ofRule(runErc(l), 'over-rating')).toEqual([])
    const { telemetry, issues } = run('hal-blink.elf', l, 0.03)
    expect(issues.some((i) => /PA5: driver sources/.test(i.message)), issues.map((i) => i.message).join('\n')).toBe(true)
    const f = ofRule(runErc(l, { telemetry, issues }), 'over-rating')
    expect(f.map((x) => x.id), summary(f)).toEqual(['over-rating:U1:PA5:gpio'])
    expect(f[0].level).toBe('risk')
    expect(f[0].message).toMatch(/25 mA per-pin limit/)
  })

  const i2cReady = has('at24c02') && existsSync(join(HERE, '../../firmware/dist/hal-i2c-scan.elf'))
  it.skipIf(!i2cReady)('hal-i2c-scan: PB6/PB7 become af-od; no pull-ups → error, 4.7 kΩ pull-ups → clean', { timeout: 120_000 }, () => {
    // AT24C02 at f40 (VCC e40, GND f43, SCL e42, SDA e43) on the board's 3.3 V (bot rails)
    const bench = (pullups: boolean) =>
      valid(
        bluePill(
          [
            { id: 'EE1', type: 'at24c02', at: 'f40' },
            ...(pullups
              ? [
                  part('R1', 'resistor', ['b42', 'bot+6'], { resistance: 4700 }),
                  part('R2', 'resistor', ['b43', 'bot+7'], { resistance: 4700 }),
                ]
              : []),
          ],
          [w('a40', 'bot+5'), w('j43', 'bot-5'), w('a42', tap('PB6')), w('a43', tap('PB7'))],
          { rail3v3: true },
        ),
      )
    for (const pullups of [false, true]) {
      const l = bench(pullups)
      const live = run('hal-i2c-scan.elf', l, 0.05)
      expect(live.telemetry.components.U1.mcu?.pinModes).toMatchObject({ PB6: 'af-od', PB7: 'af-od' })
      const f = ofRule(runErc(l, live), 'i2c-pullup')
      if (pullups) expect(f, summary(f)).toEqual([])
      else expect(f.map((x) => x.level), summary(f)).toEqual(['error', 'error'])
    }
  })
})

