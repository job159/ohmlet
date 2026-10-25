/**
 * TIM PWM through the SimulationCoordinator: REAL firmware
 * (firmware/dist/hal-tim-pwm.elf — ST HAL v1.1.9, TIM3 CH1 on PA6 at 20 kHz
 * 50 %) on the stm32f103c8 model inside the coordinator, driving
 *   PA6 → 330 Ω → red LED → GND  (bench supply 5 V into the 5V pin).
 * The logic recorder's exact edges (an MCU-driven net) must show 20 kHz
 * ±0.1 % and a 50.0 % duty cycle; the LED is lit by the PWM current.
 *
 * Skipped unless the MCU barrel registers 'stm32f103c8' and the firmware
 * loader is present (loaded through globs, like tests/coordinator/firmware-e2e).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { registeredMcus } from '../../../src/mcu/registry'
import type { LoadResult } from '../../../src/mcu/firmware'
import { SimulationCoordinator } from '../../../src/sim/coordinator/coordinator'
import { bluePillWorld, part, tap, w } from '../../coordinator/worlds'

import.meta.glob('../../../src/mcu/all.ts', { eager: true })
const loaderMods = import.meta.glob('../../../src/mcu/loader/index.ts', { eager: true }) as Record<
  string,
  { loadFirmwareFile?: (name: string, bytes: Uint8Array) => LoadResult }
>
const loadFirmwareFile = Object.values(loaderMods)[0]?.loadFirmwareFile
const available = registeredMcus().includes('stm32f103c8') && typeof loadFirmwareFile === 'function'

const HERE = dirname(fileURLToPath(import.meta.url))
const ELF = join(HERE, '../../../firmware/dist/hal-tim-pwm.elf')

describe.skipIf(!available)('real firmware: hal-tim-pwm.elf PWM LED on PA6 through the coordinator', () => {
  it('PA6 drives the LED net at 20 kHz ±0.1 % with a 50.0 % duty cycle (exact recorder edges)', { timeout: 300_000 }, () => {
    const res = loadFirmwareFile!('hal-tim-pwm.elf', new Uint8Array(readFileSync(ELF)))
    if (!res.ok) throw new Error(res.error)
    const layout = bluePillWorld(
      [
        part('R1', 'resistor', ['a45', 'a50'], { resistance: 330 }),
        part('D1', 'led', ['b50', 'top-5'], { color: 'red' }),
      ],
      [w(tap('PA6'), 'e45')],
    )
    const co = new SimulationCoordinator()
    co.load(layout, 1)
    co.setFirmware('U1', res.image)
    co.setLogicChannels([
      { index: 0, label: 'PA6', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA6' } },
      { index: 1, label: 'LED net', source: { kind: 'net', ref: 'c45' } },
    ])
    co.advance(0.15) // power-on, HAL init, 72 MHz, timers started
    const t0 = co.time
    co.advance(0.02)
    const tele = co.telemetry()
    expect(tele.components.U1.mcu?.state === 'running' || tele.components.U1.mcu?.state === 'sleeping').toBe(true)
    expect(tele.components.U1.mcu?.hclkHz).toBe(72_000_000)

    const r = co.query({ kind: 'logic', t0, t1: co.time })
    if (r.kind !== 'logic') throw new Error('query')
    for (const tr of r.capture.traces) {
      expect(tr.exact, tr.label).toBe(true)
      const times = Array.from(tr.times)
      const levels = Array.from(tr.levels)
      expect(levels.every((l, i) => l === (i === 0 ? 1 - tr.initial : 1 - levels[i - 1])), `${tr.label} alternates`).toBe(true)
      // whole periods from the first rising edge to the last rising edge
      const first = levels.indexOf(1)
      const last = levels.lastIndexOf(1)
      const rises = times.filter((_, i) => levels[i] === 1)
      expect(rises.length, tr.label).toBeGreaterThan(300)
      const span = times[last] - times[first]
      const f = (rises.length - 1) / span
      expect(Math.abs(f - 20_000) / 20_000, `${tr.label} frequency ${f}`).toBeLessThan(1e-3)
      let high = 0
      for (let i = first; i < last; i++) if (levels[i] === 1) high += times[i + 1] - times[i]
      const duty = high / span
      expect(duty.toFixed(3), `${tr.label} duty`).toBe('0.500')
    }
    // the LED conducts while PA6 is high: a lit but not fully driven LED
    const led = co.telemetry().components.D1
    expect(led.ledBrightness ?? 0).toBeGreaterThan(0.05)
    expect(co.issues().filter((i) => i.level === 'error')).toEqual([])
  })
})
