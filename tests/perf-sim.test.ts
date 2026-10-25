/**
 * Simulation throughput on the performance reference circuit
 * (src/ui/perf/heavy-scene.ts — Blue Pill + SSD1306 OLED + MPU-6050 +
 * LCD1602 backpack on one I²C bus, 74HC595 + 8 LEDs on SPI, TB6612FNG + DC
 * motor) running REAL firmware (firmware/dist/hal-oled-ssd1306.elf: 72 MHz
 * HAL, I²C at 400 kHz, OLED redraw every 200 ms) inside the coordinator —
 * exactly the work the simulation worker does for the heavy scene.
 *
 * Always checked (correctness, any machine): the firmware runs, the OLED
 * receives frames (its framebuffer gets lit pixels), the I²C bus raises no
 * error issue, and one frame() per ~33 ms of sim time is produced like the
 * worker does. Throughput (sim-time ÷ wall-time, MIPS, analog steps/s) is
 * printed; it is asserted only in a dedicated benchmark run
 * (OHMLET_BENCH=1 npx vitest run tests/perf-sim.test.ts) — the shared suite
 * runs files in parallel, where wall-clock rates mean nothing.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { registeredMcus } from '../src/mcu/registry'
import type { LoadResult } from '../src/mcu/firmware'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { heavyScene } from '../src/ui/perf/heavy-scene'

import.meta.glob('../src/mcu/all.ts', { eager: true })
const loaderMods = import.meta.glob('../src/mcu/loader/index.ts', { eager: true }) as Record<
  string,
  { loadFirmwareFile?: (name: string, bytes: Uint8Array) => LoadResult }
>
const loadFirmwareFile = Object.values(loaderMods)[0]?.loadFirmwareFile
const available = registeredMcus().includes('stm32f103c8') && typeof loadFirmwareFile === 'function'

const HERE = dirname(fileURLToPath(import.meta.url))
const ELF = join(HERE, '../firmware/dist/hal-oled-ssd1306.elf')
const DEDICATED = process.env.OHMLET_BENCH === '1'
/** sim seconds measured (after a warm-up that covers boot + the first OLED frames) */
const MEASURE_S = DEDICATED ? 1.0 : 0.25
/** the worker's frame cadence (sim seconds between frame() snapshots at 1× speed, ~30 Hz) */
const FRAME_S = 1 / 30

describe.skipIf(!available)('heavy scene throughput (hal-oled-ssd1306 on the reference circuit)', () => {
  it('runs the firmware, draws the OLED and reports sim speed', { timeout: 300_000 }, () => {
    const res = loadFirmwareFile!('hal-oled-ssd1306.elf', new Uint8Array(readFileSync(ELF)))
    if (!res.ok) throw new Error(res.error)
    const co = new SimulationCoordinator()
    co.load(heavyScene(), 1)
    co.setFirmware('U1', res.image)

    // warm-up: HAL init + the first OLED redraws (JIT warm too)
    for (let t = 0; t < 0.3; t += FRAME_S) {
      co.advance(FRAME_S)
      co.frame(true)
    }
    const f0 = co.frame(true)
    const i0 = f0.mcus.find((m) => m.componentId === 'U1')?.instructions ?? 0
    const w0 = performance.now()
    const v0 = f0.telemetry.components.OLED1?.display?.version ?? 0
    let frames = 0
    for (let t = 0; t < MEASURE_S - 1e-9; t += FRAME_S) {
      co.advance(FRAME_S)
      co.frame(true)
      frames++
    }
    const wall = (performance.now() - w0) / 1000
    const f1 = co.frame(true)
    const u1 = f1.mcus.find((m) => m.componentId === 'U1')
    expect(u1?.state).toBe('running')
    const instr = (u1?.instructions ?? 0) - i0

    // the OLED is on, shows lit pixels and kept receiving frames while measured
    const disp = f1.telemetry.components.OLED1?.display
    expect(disp?.on, 'OLED1 display on').toBe(true)
    expect(Array.from(disp?.data ?? []).some((b) => b !== 0), 'OLED1 lit pixels').toBe(true)
    expect(disp?.version ?? 0).toBeGreaterThan(v0)
    expect(f1.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(frames).toBeGreaterThan(5)

    const rt = MEASURE_S / wall
    const mips = instr / wall / 1e6
    console.log(
      `heavy scene: ${MEASURE_S.toFixed(2)} s simulated in ${wall.toFixed(3)} s wall → ${rt.toFixed(2)}× real time, ` +
        `U1 ${mips.toFixed(1)} MIPS (${(instr / 1e6).toFixed(1)} M instructions), ${frames} frames`,
    )
    if (DEDICATED) expect(rt).toBeGreaterThan(0.3)
  })
})
