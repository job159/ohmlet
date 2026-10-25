/**
 * The acceptance walkthrough's simulation waits (scripts/acceptance-e2e.mjs,
 * release triage 2026-10-19): a condition the SIMULATION has to produce is
 * budgeted in simulated time, so a correct product on a busy machine (the
 * worker reached only 0.06× real time while other browser sessions used the
 * CPU) no longer fails on a wall-clock deadline — while a wrong product still
 * fails (the condition does not hold within its simulated-time budget) and a
 * frozen simulation fails fast (its clock stands still).
 *
 * The helpers only talk to the page through page.evaluate(fn, arg) on
 * window.__e2e; the fake page runs those functions against a scripted clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error — a plain ES module script without type declarations
import { STALL_MS, START_MS, StepError, untilSim, waitSim } from '../scripts/acceptance-e2e.mjs'

interface FakeSim {
  time: number
  running: boolean
}

let sim: FakeSim
let timer: ReturnType<typeof setInterval> | null = null

/** a page whose simulation clock advances `rate` sim-seconds per wall-second */
function fakePage(rate: number) {
  sim = { time: 0, running: true }
  const w0 = Date.now()
  let t0 = 0
  timer = setInterval(() => {
    if (sim.running && rate > 0) sim.time = t0 + ((Date.now() - w0) / 1000) * rate
  }, 2)
  vi.stubGlobal('window', { __e2e: { lastFrame: () => ({ time: sim.time, running: sim.running }) } })
  return {
    evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown) => fn(arg),
    /** power cycle: the clock restarts at 0 */
    reset() {
      t0 = -((Date.now() - w0) / 1000) * rate
      sim.time = 0
    },
  }
}

beforeEach(() => {
  timer = null
})
afterEach(() => {
  if (timer) clearInterval(timer)
  vi.unstubAllGlobals()
})

describe('acceptance waits budget simulated time, not wall time', () => {
  it('exports generous stall / start-up guards (a real stall still fails within a minute)', () => {
    expect(STALL_MS).toBeGreaterThanOrEqual(10_000)
    expect(STALL_MS).toBeLessThanOrEqual(60_000)
    expect(START_MS).toBeGreaterThanOrEqual(STALL_MS)
  })

  it('a slow but moving simulation reaches its target however long the wall clock takes', async () => {
    // 0.25 sim-s per wall-s: 0.1 s of sim needs 400 ms of wall time — the old
    // wall deadline equivalent would have been ~10× shorter in this test's scale
    const page = fakePage(0.25)
    const w0 = Date.now()
    await waitSim(page, 0, 0.1, { stallMs: 2000, every: 5 })
    expect(sim.time).toBeGreaterThanOrEqual(0.1)
    expect(Date.now() - w0).toBeGreaterThanOrEqual(350)
  })

  it('a condition that holds within its simulated-time budget passes', async () => {
    const page = fakePage(1)
    const v = await untilSim(page, async () => (sim.time >= 0.05 ? 'seen' : null), 'X', 0.2, { stallMs: 2000, every: 5 })
    expect(v).toBe('seen')
  })

  it('a condition that does not hold within its simulated-time budget fails — the behaviour check is kept', async () => {
    const page = fakePage(1)
    const err = await untilSim(page, async () => null, 'UART 輸出「mode=1」', 0.08, { stallMs: 2000, every: 5 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StepError)
    expect(String((err as Error).message)).toMatch(/^模擬時間 0\.08 s 內沒有UART 輸出「mode=1」/)
  })

  it('a frozen simulation clock fails fast as a stall (and says whether it was still marked running)', async () => {
    const page = fakePage(0) // never moves
    const w0 = Date.now()
    const err = await waitSim(page, 0, 1, { stallMs: 120, every: 5 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StepError)
    expect(String((err as Error).message)).toMatch(/^模擬停滯：.*仍標示執行中.*等待：前進到 1 s/)
    expect(Date.now() - w0).toBeLessThan(5000) // the stall guard, not a long cap
  })

  it('a clock that stops after moving is a stall too', async () => {
    const page = fakePage(1)
    const p = untilSim(page, async () => null, 'X', Infinity, { stallMs: 120, every: 5 }).catch((e: unknown) => e)
    await new Promise((r) => setTimeout(r, 60))
    sim.running = false // paused: the clock freezes
    const err = await p
    expect(String((err as Error).message)).toMatch(/^模擬停滯：.*沒有在執行/)
  })

  it('the start-up allowance applies only before the clock first moves', async () => {
    const page = fakePage(0)
    // no movement for 150 ms (3× the stall guard): within the start-up allowance the wait goes on …
    const p = untilSim(page, async () => (sim.time >= 0.02 ? true : null), 'X', 1, { stallMs: 50, startMs: 3000, every: 5 })
    await new Promise((r) => setTimeout(r, 150))
    sim.time = 0.03 // … and the first movement satisfies it
    await expect(p).resolves.toBe(true)
  })

  it('a power cycle while waiting rebases the budget instead of failing', async () => {
    const page = fakePage(1)
    await waitSim(page, 0, 0.05, { stallMs: 2000, every: 5 })
    const p = untilSim(page, async () => (sim.time >= 0.03 && sim.time < 0.05 ? true : null), 'X', 0.1, { stallMs: 2000, every: 5 })
    page.reset() // time back to 0
    await expect(p).resolves.toBe(true)
  })
})
