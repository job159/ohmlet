/**
 * Real-firmware integration tests: ELF images built from ST's HAL v1.1.9 +
 * ST's startup file (firmware/dist, see firmware/build.mjs) run on the
 * STM32F103 SoC with the real Cortex-M3 core, and are judged only by what
 * leaves the chip — pin edges with their simulated times and USART bytes.
 *
 * They need src/mcu/core/cpu.ts (createCortexM3); without it the whole
 * suite is skipped (describe.skipIf), never faked.
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
const LONG = { timeout: 180_000 }

interface Edge {
  t: number
  level: number
  mode: number
}

function boot(name: string) {
  const parsed = loadElf(new Uint8Array(readFileSync(join(DIST, `${name}.elf`))), `${name}.elf`)
  if (!parsed.ok) throw new Error(parsed.error)
  const mcu = new Stm32f103({ createCore: createCortexM3 as CreateCortexM3 })
  const load = mcu.loadFirmware(parsed.image)
  expect(load.ok, load.errors.join('; ')).toBe(true)
  const edges = new Map<number, Edge[]>()
  mcu.pins.listener = {
    pinDriveChanged(pin, cycle) {
      const d = mcu.pins.drive(pin)
      let list = edges.get(pin)
      if (!list) edges.set(pin, (list = []))
      list.push({ t: mcu.timeOfCycle(cycle), level: d.level, mode: d.mode })
    },
  }
  const uart = mcu.uart('USART1') as UartTap
  const tx: { byte: number; t: number }[] = []
  uart.onTx = (byte, cycle) => tx.push({ byte, t: mcu.timeOfCycle(cycle) })
  mcu.reset('power-on')
  const text = () => String.fromCharCode(...tx.map((x) => x.byte))
  /** run in slices until `pred` holds (or `limit` seconds of simulated time) */
  const runUntil = (pred: () => boolean, limit: number, slice = 1e-3) => {
    while (!pred() && mcu.time() < limit) {
      const r = mcu.runUntil(mcu.time() + slice)
      if (r === 'lockup' || r === 'breakpoint') break
    }
  }
  /** output level changes of a push-pull pin (debug-pull / reset states filtered out) */
  const toggles = (pin: number) => {
    const out: Edge[] = []
    for (const e of edges.get(pin) ?? []) {
      if (e.mode !== PIN_OUT_PP) continue
      if (out.length && out[out.length - 1].level === e.level) continue
      out.push(e)
    }
    return out
  }
  return { mcu, uart, tx, text, edges, runUntil, toggles, image: parsed.image }
}

/**
 * Every transmitted byte must appear on PA9 as an 8N1 frame whose edges sit
 * exactly at start + k·bit (start = stop-bit end − 10 bits).
 */
function checkFrames(edges: Edge[], tx: { byte: number; t: number }[], bitOf: (i: number) => number) {
  const pa9 = edges.filter((e) => e.mode === PIN_OUT_PP)
  tx.forEach((x, i) => {
    const bit = bitOf(i)
    const t0 = x.t - 10 * bit
    const want: { k: number; level: number }[] = []
    let prev = 1
    const lv = [0]
    for (let b = 0; b < 8; b++) lv.push((x.byte >> b) & 1)
    lv.push(1)
    lv.forEach((l, k) => {
      if (l !== prev) want.push({ k, level: l })
      prev = l
    })
    const got = pa9.filter((e) => e.t >= t0 - 1e-9 && e.t < x.t - 1e-9)
    expect(got.map((e) => e.level), `byte ${i} (0x${x.byte.toString(16)})`).toEqual(want.map((w) => w.level))
    got.forEach((e, j) => expect(e.t - t0, `byte ${i} edge ${j}`).toBeCloseTo(want[j].k * bit, 10))
  })
}

describe.skipIf(!coreAvailable)('STM32F103 real-firmware integration (needs src/mcu/core/cpu.ts)', () => {
  it('hal-blink: HAL 72 MHz clock setup, PA5 and PC13 toggle every 500 ms ±0.5 %, PC13 = !PA5', LONG, () => {
    const b = boot('hal-blink')
    b.runUntil(() => b.toggles(5).length >= 6, 4)
    expect(b.mcu.hclkHz).toBe(72e6)
    const pa5 = b.toggles(5)
    const pc13 = b.toggles(45)
    expect(pa5.length).toBeGreaterThanOrEqual(6)
    for (let i = 2; i < pa5.length; i++) {
      const dt = pa5[i].t - pa5[i - 1].t
      expect(dt).toBeGreaterThan(0.5 * 0.995)
      expect(dt).toBeLessThan(0.5 * 1.005)
    }
    // PC13 toggles in the same loop iteration, opposite level
    for (const e of pa5.slice(1)) {
      const c = pc13.find((x) => x.t >= e.t && x.t - e.t < 50e-6)
      expect(c, `PC13 edge near ${e.t}`).toBeDefined()
      expect(c!.level).toBe(1 - e.level)
    }
    expect(b.mcu.debugState().state === 'running' || b.mcu.debugState().state === 'sleeping').toBe(true)
    // a correct CubeIDE-style program must not trigger any SoC-level warning
    // (instruction-level reports from the core are the core's own business)
    const warn = b.mcu.drainLog().filter((e) => e.level !== 'info' && e.source !== 'core')
    expect(warn.map((e) => `${e.source}: ${e.message}`)).toEqual([])
  })

  it('bare-blink: register-level, 8 MHz HSI + SysTick, toggles every 250 ms ±0.5 %', LONG, () => {
    const b = boot('bare-blink')
    b.runUntil(() => b.toggles(5).length >= 6, 2)
    expect(b.mcu.hclkHz).toBe(8e6)
    const pa5 = b.toggles(5)
    expect(pa5.length).toBeGreaterThanOrEqual(6)
    for (let i = 2; i < pa5.length; i++) {
      const dt = pa5[i].t - pa5[i - 1].t
      expect(dt).toBeGreaterThan(0.25 * 0.995)
      expect(dt).toBeLessThan(0.25 * 1.005)
    }
    const pc13 = b.toggles(45)
    expect(pc13.length).toBeGreaterThanOrEqual(5)
  })

  it('soc-uart: "hello\\r\\n" on PA9 with bit-exact 115200 timing, then HAL_UART_Receive echo', LONG, () => {
    const b = boot('soc-uart')
    b.runUntil(() => b.text().endsWith('hello\r\n'), 0.1)
    expect(b.text()).toBe('hello\r\n')
    expect(b.uart.config()).toEqual({ enabled: true, baud: 115200, dataBits: 8, parity: 'none', stopBits: 1 })
    const bit = 625 / 72e6 // BRR 0x271 at PCLK2 = 72 MHz
    checkFrames(b.edges.get(9) ?? [], b.tx, () => bit)
    const pc13Before = b.toggles(45).length
    b.uart.send(new TextEncoder().encode('abc'))
    b.runUntil(() => b.text().length >= 10, b.mcu.time() + 0.05)
    expect(b.text()).toBe('hello\r\nabc')
    checkFrames(b.edges.get(9) ?? [], b.tx, () => bit)
    expect(b.toggles(45).length - pc13Before).toBe(3)
    expect(b.mcu.drainLog().filter((e) => e.level === 'error')).toEqual([])
  })

  it('soc-exti: a falling edge on PB12 toggles PA5 via HAL_GPIO_EXTI_Callback; rising edges do not', LONG, () => {
    const b = boot('soc-exti')
    const PB12 = b.mcu.pins.pinIndex('PB12')
    b.runUntil(() => false, 0.01)
    expect(b.mcu.pins.drive(PB12).mode).toBe(2) // input pull-up
    const edgeAt = (level: 0 | 1) => {
      const t = b.mcu.time()
      b.mcu.pins.setInput(PB12, level, level ? 3.3 : 0)
      b.runUntil(() => false, t + 2e-3)
      return t
    }
    const t1 = edgeAt(0)
    let pa5 = b.toggles(5)
    expect(pa5.length).toBe(2) // initial low + one toggle
    expect(pa5[1].level).toBe(1)
    const latency = pa5[1].t - t1
    expect(latency).toBeGreaterThan(0)
    expect(latency).toBeLessThan(20e-6)
    edgeAt(1)
    expect(b.toggles(5).length).toBe(2)
    edgeAt(0)
    pa5 = b.toggles(5)
    expect(pa5.length).toBe(3)
    expect(pa5[2].level).toBe(0)
  })

  it('soc-iwdg: two IWDG resets 100 ms after the last refresh, reset flags reported, boot count in BKP', LONG, () => {
    const b = boot('soc-iwdg')
    b.runUntil(() => b.text().includes('done\r\n'), 2, 5e-3)
    expect(b.text().split('\r\n')).toEqual([
      'boot 1 csr=0C000000 POR PIN',
      'starving',
      'boot 2 csr=24000000 IWDG PIN',
      'starving',
      'boot 3 csr=24000000 IWDG PIN',
      'done',
      '',
    ])
    // a reset is visible on the pins: PA9 drops from AF push-pull back to its floating reset state
    const pa9 = b.edges.get(9) ?? []
    const resets = pa9.filter((e, i) => i > 0 && e.mode === 1 && pa9[i - 1].mode === PIN_OUT_PP).map((e) => e.t)
    expect(resets.length).toBe(2)
    expect(b.mcu.resetFlags).toBe(0) // boot 3 cleared them (RMVF)
    // the reset comes 100 ms after the last refresh; "starving\r\n" (10 bytes ≈ 0.87 ms) went out just after that refresh
    let from = 0
    for (const r of resets) {
      const nl = b.tx.findIndex((x, i) => i >= from && x.byte === 10 && b.text().slice(0, i + 1).endsWith('starving\r\n'))
      expect(nl).toBeGreaterThanOrEqual(0)
      const dt = r - b.tx[nl].t
      expect(dt).toBeGreaterThan(0.0985)
      expect(dt).toBeLessThan(0.1)
      from = nl + 1
    }
  })

  it('soc-clock: HSI → PLL 72 MHz → HSI; SystemCoreClock printed per phase, exact UART timing, constant HAL_Delay', LONG, () => {
    const b = boot('soc-clock')
    b.runUntil(() => b.text().includes('done\r\n'), 0.5)
    const lines = ['clk=8000000\r\n', 'clk=72000000\r\n', 'clk=8000000\r\n', 'done\r\n']
    expect(b.text()).toBe(lines.join(''))
    // per byte, the bit time of its phase: BRR 0x45 @ 8 MHz, 0x271 @ 72 MHz, 0x45 @ 8 MHz
    const n1 = lines[0].length
    const n2 = n1 + lines[1].length
    const bitOf = (i: number) => (i >= n1 && i < n2 ? 625 / 72e6 : 69 / 8e6)
    checkFrames(b.edges.get(9) ?? [], b.tx, bitOf)
    const pa5 = b.toggles(5).filter((e, i, a) => i > 0 || e.level === 1)
    const highs: number[] = []
    for (let i = 0; i + 1 < pa5.length; i++) if (pa5[i].level === 1 && pa5[i + 1].level === 0) highs.push(pa5[i + 1].t - pa5[i].t)
    expect(highs.length).toBe(3)
    for (const w of highs) {
      expect(w).toBeGreaterThanOrEqual(10e-3)
      expect(w).toBeLessThan(11.2e-3)
    }
  })
})
