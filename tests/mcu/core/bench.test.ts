/**
 * Core throughput on a realistic instruction mix: firmware/projects/cpu-bench
 * runs the cpu-selftest workload (compiled -O2) 60 times — about 41 million
 * instructions of loads/stores, branches, jump tables, 64-bit helpers and
 * calls — and folds the checksums into bench_result.
 *
 * Always checked: the result equals the fold of the host-computed selftest
 * checksum (tests/fixtures/cpu/selftest-host.txt), i.e. the benchmark ran
 * correctly. Throughput is printed (wall clock, best of N runs); the >= 30
 * MIPS target is asserted only in a dedicated benchmark run
 * (OHMLET_BENCH=1 npx vitest run tests/mcu/core/bench.test.ts), because the
 * shared test suite runs files in parallel and wall-clock rates are
 * meaningless under that load.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURES, FW_DIST, hex, loadElfFile, makeMachine } from './harness'

const DEDICATED = process.env.OHMLET_BENCH === '1'
const RUNS = DEDICATED ? 5 : 1

describe('cpu-bench throughput', () => {
  it(`runs ~41 M instructions correctly; reports MIPS (best of ${RUNS})`, { timeout: 300_000 }, () => {
    const checksum = parseInt(/^checksum ([0-9a-f]{8})/.exec(readFileSync(path.join(FIXTURES, 'selftest-host.txt'), 'utf8'))![1], 16)
    let want = 0
    for (let i = 0; i < 60; i++) want = (Math.imul(want, 31) + checksum + i) >>> 0
    const elf = loadElfFile(path.join(FW_DIST, 'cpu-bench.elf'))
    let best = Infinity
    let instructions = 0
    let cycles = 0
    for (let run = 0; run < RUNS; run++) {
      const m = makeMachine(elf)
      const t0 = performance.now()
      const why = m.runToStop(2_000_000_000)
      const dt = (performance.now() - t0) / 1000
      expect(why).toBe('breakpoint')
      expect(m.logs.map((l) => l.message)).toEqual([expect.stringMatching(/^BKPT #67 at /)])
      expect(hex(m.r32(m.sym('bench_result')))).toBe(hex(want))
      best = Math.min(best, dt)
      instructions = m.core.instructions
      cycles = m.clock.cycles
    }
    expect(instructions).toBeGreaterThan(40_000_000)
    const mips = instructions / best / 1e6
    console.log(
      `cpu-bench: ${instructions} instructions, ${cycles} cycles (CPI ${(cycles / instructions).toFixed(3)}) in ${best.toFixed(3)} s` +
        ` → ${mips.toFixed(1)} MIPS (${(cycles / best / 1e6).toFixed(1)} simulated MHz)`,
    )
    if (DEDICATED) expect(mips).toBeGreaterThanOrEqual(30)
  })
})
