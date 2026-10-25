/**
 * End-to-end: REAL firmware (firmware/dist/hal-blink.elf — ST HAL v1.1.9,
 * 72 MHz HSE+PLL, HAL_Delay(500) toggling PA5 and PC13) on the real
 * stm32f103c8 model inside the coordinator, driving the analog circuit:
 *   power_supply 5 V → Blue Pill 5V pin (on-board LDO), GND;
 *   PA5 → 330 Ω → red LED → GND.
 * Asserts the LED net toggles every 500 ms (±1 %) and the on-board PC13 LED
 * (sub.LED_PC13) alternates.
 *
 * Skipped unless the MCU barrel registers 'stm32f103c8' and the firmware
 * loader is present (both are loaded through globs so this file never fails
 * to import while they are being written).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { registeredMcus } from '../../src/mcu/registry'
import type { LoadResult } from '../../src/mcu/firmware'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import { bluePillWorld, part, tap, w } from './worlds'

import.meta.glob('../../src/mcu/all.ts', { eager: true })
const loaderMods = import.meta.glob('../../src/mcu/loader/index.ts', { eager: true }) as Record<
  string,
  { loadFirmwareFile?: (name: string, bytes: Uint8Array) => LoadResult }
>
const loadFirmwareFile = Object.values(loaderMods)[0]?.loadFirmwareFile
const available = registeredMcus().includes('stm32f103c8') && typeof loadFirmwareFile === 'function'

const HERE = dirname(fileURLToPath(import.meta.url))
const ELF = join(HERE, '../../firmware/dist/hal-blink.elf')

describe.skipIf(!available)('real firmware: hal-blink.elf on a Blue Pill', () => {
  it('toggles the PA5 LED net every 500 ms (±1 %) and blinks the PC13 on-board LED', { timeout: 120_000 }, () => {
    const res = loadFirmwareFile!('hal-blink.elf', new Uint8Array(readFileSync(ELF)))
    if (!res.ok) throw new Error(res.error)
    const layout = bluePillWorld(
      [
        part('R1', 'resistor', ['a45', 'a50'], { resistance: 330 }),
        part('D1', 'led', ['b50', 'top-5'], { color: 'red' }),
      ],
      [w(tap('PA5'), 'e45')],
    )
    const co = new SimulationCoordinator()
    co.load(layout, 1)
    co.setFirmware('U1', res.image)
    co.setLogicChannels([{ index: 0, label: 'LED net', source: { kind: 'net', ref: 'c45' } }])

    // sample both LEDs in the middle of each half period
    const d1: number[] = []
    const pc13: number[] = []
    co.advance(0.25)
    for (let k = 0; k < 5; k++) {
      const tele = co.telemetry()
      expect(tele.components.U1.mcu?.state).toBe('running')
      d1.push(tele.components.D1.ledBrightness ?? NaN)
      pc13.push(tele.components.U1.sub?.LED_PC13?.ledBrightness ?? NaN)
      co.advance(0.5)
    }

    const r = co.query({ kind: 'logic', t0: 0, t1: co.time })
    if (r.kind !== 'logic') throw new Error('query')
    const tr = r.capture.traces[0]
    expect(tr.exact).toBe(true) // MCU-driven net: edges are the GPIO edges
    const times = Array.from(tr.times)
    expect(times.length).toBeGreaterThanOrEqual(5)
    for (let i = 1; i < times.length; i++) {
      expect(Math.abs(times[i] - times[i - 1] - 0.5) / 0.5).toBeLessThan(0.01)
    }
    expect(Array.from(tr.levels).every((l, i, a) => i === 0 || l !== a[i - 1])).toBe(true)

    // LEDs alternate between lit and dark from one half period to the next
    for (let k = 0; k < 5; k++) {
      const on = k % 2 === 0
      expect(d1[k] > 0.2, `D1 sample ${k}`).toBe(on)
      expect(pc13[k] > 0.1, `PC13 LED sample ${k}`).toBe(on)
    }
    expect(co.telemetry().components.U1.mcu?.hclkHz).toBe(72_000_000)
    expect(co.issues().filter((i) => i.level === 'error')).toEqual([])
  })
})
