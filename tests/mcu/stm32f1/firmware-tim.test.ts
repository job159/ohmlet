/**
 * Real-firmware integration tests of TIM1–TIM4 (src/mcu/stm32f1/tim.ts):
 * ELF images built from ST's HAL v1.1.9 (firmware/projects/hal-tim-*,
 * hal-pwm-fade, hal-servo; firmware/build.mjs) run on the STM32F103 SoC with
 * the real Cortex-M3 core and are judged only by what leaves the chip — pin
 * edges with their exact cycle stamps (pins.listener) and USART1 bytes.
 *
 * They need src/mcu/core/cpu.ts (createCortexM3); without it the suite is
 * skipped (describe.skipIf), never faked.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CreateCortexM3 } from '../../../src/mcu/core/cpu-api'
import { loadElf } from '../../../src/mcu/loader'
import type { UartTap } from '../../../src/mcu/mcu-api'
import { PIN_OUT_PP } from '../../../src/mcu/pins'
import { Stm32f103 } from '../../../src/mcu/stm32f1/soc'

const corePath = '../../../src/mcu/core/cpu'
const coreMod: { createCortexM3?: CreateCortexM3 } | null = await import(/* @vite-ignore */ corePath).catch(() => null)
const createCortexM3 = coreMod?.createCortexM3
const coreAvailable = typeof createCortexM3 === 'function'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'firmware', 'dist')
const LONG = { timeout: 300_000 }
const HZ = 72e6

interface Edge {
  cycle: number
  t: number
  level: number
  mode: number
}

function boot(name: string, opts: { loop?: [string, string][] } = {}) {
  const parsed = loadElf(new Uint8Array(readFileSync(join(DIST, `${name}.elf`))), `${name}.elf`)
  if (!parsed.ok) throw new Error(parsed.error)
  const mcu = new Stm32f103({ createCore: createCortexM3 as CreateCortexM3 })
  const load = mcu.loadFirmware(parsed.image)
  expect(load.ok, load.errors.join('; ')).toBe(true)
  const edges = new Map<number, Edge[]>()
  const loops = (opts.loop ?? []).map(([a, b]) => [mcu.pins.pinIndex(a), mcu.pins.pinIndex(b)] as const)
  mcu.pins.listener = {
    pinDriveChanged(pin, cycle) {
      const d = mcu.pins.drive(pin)
      let list = edges.get(pin)
      if (!list) edges.set(pin, (list = []))
      list.push({ cycle, t: mcu.timeOfCycle(cycle), level: d.level, mode: d.mode })
      // a bench wire from an output to an input pin (no circuit solver here)
      for (const [from, to] of loops) if (from === pin) mcu.pins.setInput(to, d.level as 0 | 1, d.level ? 3.3 : 0)
    },
  }
  const uart = mcu.uart('USART1') as UartTap
  const tx: { byte: number; t: number }[] = []
  uart.onTx = (byte, cycle) => tx.push({ byte, t: mcu.timeOfCycle(cycle) })
  mcu.reset('power-on')
  const text = () => String.fromCharCode(...tx.map((x) => x.byte))
  const runUntil = (pred: () => boolean, limit: number, slice = 1e-3) => {
    while (!pred() && mcu.time() < limit) {
      const r = mcu.runUntil(mcu.time() + slice)
      if (r === 'lockup' || r === 'breakpoint') break
    }
  }
  /** level changes of a pin while it is driven (push-pull GPIO or AF push-pull) */
  const levels = (pin: number) => {
    const out: Edge[] = []
    for (const e of edges.get(pin) ?? []) {
      if (e.mode !== PIN_OUT_PP) continue
      if (out.length && out[out.length - 1].level === e.level) continue
      out.push(e)
    }
    return out
  }
  /** SoC-level warnings/errors (the core's own reports excluded) */
  const warnings = () => mcu.drainLog().filter((e) => e.level !== 'info' && e.source !== 'core').map((e) => `${e.source}: ${e.message}`)
  return { mcu, uart, tx, text, edges, runUntil, levels, warnings }
}

/**
 * [high, low] phase lengths in cycles from the SECOND rising edge on (the
 * first high phase starts when CCxE is set, a few cycles before CEN).
 */
function phases(edges: Edge[]): { high: number[]; low: number[]; period: number[] } {
  const rises = edges.map((x, i) => (x.level === 1 ? i : -1)).filter((i) => i >= 0)
  const e = edges.slice(rises[1] ?? edges.length)
  const high: number[] = []
  const low: number[] = []
  const period: number[] = []
  for (let i = 0; i + 1 < e.length; i++) (e[i].level ? high : low).push(e[i + 1].cycle - e[i].cycle)
  for (let i = 0; i + 2 < e.length; i += 2) period.push(e[i + 2].cycle - e[i].cycle)
  return { high, low, period }
}

const pin = (mcu: Stm32f103, name: string) => mcu.pins.pinIndex(name)

describe.skipIf(!coreAvailable)('TIM real-firmware integration (needs src/mcu/core/cpu.ts)', () => {
  it('hal-tim-pwm: TIM2 PA0 1 kHz 25 %, TIM3 PA6 20 kHz 50 %, TIM1 PA8 2 kHz 75 % — exact edge cycles', LONG, () => {
    const b = boot('hal-tim-pwm')
    b.runUntil(() => false, 0.05)
    expect(b.mcu.hclkHz).toBe(HZ)
    const check = (name: string, high: number, low: number) => {
      const p = phases(b.levels(pin(b.mcu, name)))
      expect(p.high.length, name).toBeGreaterThan(10)
      expect(new Set(p.high), `${name} high`).toEqual(new Set([high]))
      expect(new Set(p.low), `${name} low`).toEqual(new Set([low]))
    }
    check('PA0', 250e-6 * HZ, 750e-6 * HZ)
    check('PA6', 1800, 1800)
    check('PA8', 375e-6 * HZ, 125e-6 * HZ)
    expect(b.mcu.pins.drive(pin(b.mcu, 'PA8')).af).toBe(true)
    expect(b.warnings()).toEqual([])
  })

  it('hal-tim-irq: TIM4 update interrupt toggles PB12 every 1.000 ms, PC13 every 500 ms right after a PB12 edge', LONG, () => {
    const b = boot('hal-tim-irq')
    b.runUntil(() => b.levels(pin(b.mcu, 'PC13')).length >= 4, 2)
    const pb12 = b.levels(pin(b.mcu, 'PB12'))
    const pc13 = b.levels(pin(b.mcu, 'PC13'))
    expect(pb12.length).toBeGreaterThan(1000)
    // after the first toggle, every interval is one timer period (72000 cycles) up to interrupt-latency jitter
    for (let i = 2; i < pb12.length; i++) expect(Math.abs(pb12[i].cycle - pb12[i - 1].cycle - 72000), `PB12 edge ${i}`).toBeLessThanOrEqual(14)
    // no drift: the n-th edge is n periods after the first
    const span = pb12[pb12.length - 1].cycle - pb12[1].cycle
    expect(Math.abs(span - (pb12.length - 2) * 72000)).toBeLessThanOrEqual(14)
    // PC13 (starts high = LED off): toggles on every 500th interrupt
    expect(pc13[0].level).toBe(1)
    for (let i = 2; i < pc13.length; i++) expect(Math.abs(pc13[i].cycle - pc13[i - 1].cycle - 500 * 72000)).toBeLessThanOrEqual(14)
    for (const e of pc13.slice(1)) {
      const near = pb12.find((x) => x.cycle <= e.cycle && e.cycle - x.cycle < 2e-6 * HZ)
      expect(near, `PB12 edge before PC13 edge at ${e.t}`).toBeDefined()
    }
    expect(b.warnings()).toEqual([])
  })

  it('hal-pwm-fade: PA6 1 kHz PWM whose duty ramps 0 → 100 → 0 % in 1 % steps of 10 periods, 2.000 s cycle', LONG, () => {
    const b = boot('hal-pwm-fade')
    b.runUntil(() => false, 4.6, 5e-3)
    const e = b.levels(pin(b.mcu, 'PA6'))
    const P = 72000
    // every rising edge sits on the update-event grid
    const rises = e.filter((x) => x.level === 1).map((x) => x.cycle)
    const t0 = rises[0]
    for (const r of rises) expect((r - t0) % P, 'rising edge off the 1 ms grid').toBe(0)
    // high time of each period [t0 + nP, t0 + (n+1)P)
    const high = (from: number, to: number) => {
      let lvl = 0
      let last = from
      let acc = 0
      for (const x of e) {
        if (x.cycle <= from) {
          lvl = x.level
          continue
        }
        if (x.cycle >= to) break
        if (lvl) acc += x.cycle - last
        lvl = x.level
        last = x.cycle
      }
      if (lvl) acc += to - last
      return acc
    }
    const duty: number[] = []
    for (let n = 0; t0 + (n + 1) * P <= b.mcu.clock.cycles; n++) {
      const h = high(t0 + n * P, t0 + (n + 1) * P)
      expect(h % 720, `period ${n}: high time ${h} cycles is not a whole percent`).toBe(0)
      duty.push(h / 720)
    }
    expect(duty.length).toBeGreaterThan(4000)
    const tri = (k: number) => {
      const s = Math.floor((((k % 2000) + 2000) % 2000) / 10)
      return s <= 100 ? s : 200 - s
    }
    // the ramp's phase relative to the first rising edge, then every period must follow it
    let off = -1
    for (let o = 0; o < 2000 && off < 0; o++) if (duty.slice(0, 400).every((d, n) => d === tri(n + o))) off = o
    expect(off, 'no phase of the 0→100→0 % ramp matches').toBeGreaterThanOrEqual(0)
    duty.forEach((d, n) => expect(d, `period ${n}`).toBe(tri(n + off)))
    expect(Math.max(...duty)).toBe(100)
    expect(b.warnings()).toEqual([])
  })

  it('hal-servo: PA1 50 Hz frames, pulse 1.0 → 2.0 → 1.0 ms in 0.1 ms steps, each width in exactly 10 frames', LONG, () => {
    const b = boot('hal-servo')
    b.runUntil(() => false, 4.6, 5e-3)
    const e = b.levels(pin(b.mcu, 'PA1'))
    const frame = 20e-3 * HZ
    const rises = e.filter((x) => x.level === 1)
    for (let i = 2; i < rises.length; i++) expect(rises[i].cycle - rises[i - 1].cycle).toBe(frame)
    // widths from the second frame on (the first pulse starts when CC2E is set, just before CEN)
    const widths: number[] = []
    const second = e.indexOf(rises[1])
    for (let i = second; i + 1 < e.length; i++) if (e[i].level === 1 && e[i + 1].level === 0) widths.push((e[i + 1].cycle - e[i].cycle) / 72)
    expect(widths.length).toBeGreaterThan(200)
    // runs of equal widths
    const runs: { w: number; n: number }[] = []
    for (const w of widths) {
      if (runs.length && runs[runs.length - 1].w === w) runs[runs.length - 1].n++
      else runs.push({ w, n: 1 })
    }
    expect(runs[0].w).toBe(1000)
    const inner = runs.slice(1, -1)
    expect(inner.length).toBeGreaterThan(15)
    for (const r of inner) expect(r.n, `width ${r.w} µs`).toBe(10)
    for (let i = 1; i < runs.length; i++) {
      expect(Math.abs(runs[i].w - runs[i - 1].w)).toBe(100)
      expect(runs[i].w).toBeGreaterThanOrEqual(1000)
      expect(runs[i].w).toBeLessThanOrEqual(2000)
    }
    expect(runs.map((r) => r.w).slice(0, 22)).toEqual([1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 1900, 1800, 1700, 1600, 1500, 1400, 1300, 1200, 1100, 1000, 1100])
    expect(b.warnings()).toEqual([])
  })

  it('hal-tim-capture: TIM2 PWM input measures the TIM3 signal looped from PA6 to PA0', LONG, () => {
    const b = boot('hal-tim-capture', { loop: [['PA6', 'PA0']] })
    b.runUntil(() => b.text().split('\r\n').length > 14, 4, 5e-3)
    const lines = b.text().split('\r\n')
    expect(lines[0]).toBe('PWM input: TIM3 CH1 PA6 -> TIM2 CH1 PA0')
    const want = ['f=2000 d=300', 'f=5000 d=500', 'f=1250 d=750']
    expect(lines.slice(1, 14)).toEqual([...Array(12)].map((_, i) => want[Math.floor(i / 4)]).concat([want[0]]))
    // the generator really changes: PA6 periods of 36000, 14400 and 57600 cycles
    const p = phases(b.levels(pin(b.mcu, 'PA6'))).period
    for (const v of [36000, 14400, 57600]) expect(p.includes(v), `PA6 period ${v}`).toBe(true)
    // lines 250 ms apart (each starts on a SysTick deadline)
    const starts = b.tx.filter((_, i) => i > 0 && b.tx[i - 1].byte === 10).map((x) => x.t)
    for (let i = 2; i < starts.length; i++) expect(Math.abs(starts[i] - starts[i - 1] - 0.25)).toBeLessThan(20e-6)
    expect(b.warnings()).toEqual([])
  })

  it('hal-tim-capture without the jumper: no edge on PA0 → the overflow path prints f=0 d=0', LONG, () => {
    const b = boot('hal-tim-capture')
    b.runUntil(() => b.text().split('\r\n').length > 3, 1, 5e-3)
    expect(b.text().split('\r\n').slice(1, 3)).toEqual(['f=0 d=0', 'f=0 d=0'])
  })

  it('hal-tim-encoder: quadrature edges on PB6/PB7 count ×4 up and down; a 2 µs bounce is filtered', LONG, () => {
    const b = boot('hal-tim-encoder')
    b.runUntil(() => b.text().endsWith('enc=0\r\n'), 1)
    expect(b.text()).toBe('enc=0\r\n')
    const PB6 = pin(b.mcu, 'PB6')
    const PB7 = pin(b.mcu, 'PB7')
    expect(b.mcu.pins.level(PB6)).toBe(1) // pull-ups
    const edge = (p: number, level: 0 | 1) => {
      b.mcu.pins.setInput(p, level, level * 3.3)
      b.runUntil(() => false, b.mcu.time() + 5e-3)
    }
    // forward: A falls first (A leads B)
    for (let k = 0; k < 2; k++) {
      edge(PB6, 0)
      edge(PB7, 0)
      edge(PB6, 1)
      edge(PB7, 1)
    }
    // backward one detent and a bit
    edge(PB7, 0)
    edge(PB6, 0)
    edge(PB7, 1)
    edge(PB6, 1)
    edge(PB7, 0)
    edge(PB6, 0)
    // a 2 µs glitch on A (shorter than the 3.6 µs filter) changes nothing
    b.mcu.pins.setInput(PB6, 1, 3.3)
    b.mcu.runUntil(b.mcu.time() + 2e-6)
    b.mcu.pins.setInput(PB6, 0, 0)
    b.runUntil(() => false, b.mcu.time() + 5e-3)
    const got = b.text().split('\r\n').filter(Boolean)
    expect(got).toEqual(['enc=0', ...[1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2].map((n) => `enc=${n}`)])
    expect(b.warnings()).toEqual([])
  })
})
