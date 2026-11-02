/**
 * 顯示電流 cost on the performance reference circuit (src/ui/perf/heavy-scene.ts
 * running the real hal-oled-ssd1306 firmware, frame() every ~33 ms like the
 * worker): the same world with current tracking OFF and ON. Always checked:
 * tracked frames carry pin + wire currents and the firmware still runs.
 *
 * The speed ratio is measured so that a busy, shared machine cannot fake it
 * (the earlier one-shot off-then-on timing swung from 76 % to 175 % with the
 * load and the JIT): both worlds are built and warmed first, then advanced
 * in INTERLEAVED slices (off, on, off, on …, the order flipped every round)
 * and the MEDIAN of the per-round on/off ratios is reported — a load spike
 * hits one slice of a pair, never a whole variant. Asserted (tracking keeps
 * ≥ 80 % of the untracked speed) only in a dedicated benchmark run:
 *   OHMLET_BENCH=1 npx vitest run tests/flow-perf.test.ts
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { registeredMcus } from '../src/mcu/registry'
import type { LoadResult } from '../src/mcu/firmware'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import type { SimFrame } from '../src/sim/coordinator/api'
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
/** interleaved rounds and the simulated time of one slice (s) */
const ROUNDS = DEDICATED ? 9 : 2
const SLICE_S = DEDICATED ? 0.2 : 0.05
const FRAME_S = 1 / 30

function world(track: boolean): SimulationCoordinator {
  const res = loadFirmwareFile!('hal-oled-ssd1306.elf', new Uint8Array(readFileSync(ELF)))
  if (!res.ok) throw new Error(res.error)
  const co = new SimulationCoordinator()
  co.setCurrentTracking(track)
  co.load(heavyScene(), 1)
  co.setFirmware('U1', res.image)
  return co
}

/** Advance `s` of simulated time in worker-sized frames; wall seconds spent and the last frame. */
function slice(co: SimulationCoordinator, s: number): { wall: number; last: SimFrame } {
  const w0 = performance.now()
  let last = co.frame(true)
  for (let t = 0; t < s - 1e-9; t += FRAME_S) {
    co.advance(FRAME_S)
    last = co.frame(true)
  }
  return { wall: (performance.now() - w0) / 1000, last }
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b)
  return v[Math.floor(v.length / 2)]
}

describe.skipIf(!available)('current tracking cost on the heavy scene', () => {
  it('tracked frames carry currents; the speed stays close to untracked (interleaved, median)', { timeout: 300_000 }, () => {
    const off = world(false)
    const on = world(true)
    // warm-up: both worlds past start-up, both code paths JIT-compiled
    slice(off, 0.2)
    slice(on, 0.2)
    const ratios: number[] = []
    let lastOff: SimFrame | null = null
    let lastOn: SimFrame | null = null
    for (let r = 0; r < ROUNDS; r++) {
      // flip the order every round: neither variant always runs first after a pause
      const first = r % 2 === 0 ? off : on
      const a = slice(first, SLICE_S)
      const b = slice(first === off ? on : off, SLICE_S)
      const [o, n] = first === off ? [a, b] : [b, a]
      lastOff = o.last
      lastOn = n.last
      ratios.push(o.wall / n.wall) // = speed(on) / speed(off)
    }
    for (const last of [lastOff!, lastOn!]) expect(last.mcus.find((m) => m.componentId === 'U1')?.state).toBe('running')
    const tOff = lastOff!.telemetry
    const tOn = lastOn!.telemetry
    let pins = 0
    for (const c of Object.values(tOn.components)) if (c.pinCurrents) pins++
    expect(Object.keys(tOff.wireCurrents ?? {}).length).toBe(0)
    expect(Object.keys(tOn.wireCurrents ?? {}).length).toBeGreaterThan(5)
    expect(pins).toBeGreaterThan(5)
    const ratio = median(ratios)
    console.log(
      `heavy scene: tracking keeps ${(ratio * 100).toFixed(1)} % of the untracked speed (median of ${ROUNDS} interleaved rounds: ` +
        `${ratios.map((x) => (x * 100).toFixed(0)).join(' / ')} %), ${Object.keys(tOn.wireCurrents ?? {}).length} wires / ${pins} parts with currents`,
    )
    if (DEDICATED) expect(ratio).toBeGreaterThan(0.8)
  })
})
