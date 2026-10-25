/**
 * Differential test of the Cortex-M3 core against an INDEPENDENT reference.
 *
 * tests/fixtures/cpu/vectors-<family>.json.gz were produced by
 * tools/cpu-oracle/gen_vectors.py: randomized but valid ARMv7-M instruction
 * sequences (assembled by clang), run on Unicorn 2.1.4 (QEMU's ARMv7-M
 * translator, Cortex-M3 model) with random r0-r12/LR/APSR and a 512-byte RAM
 * window. Every case is replayed here on our core, on a bus that maps only
 * the family's code image and that window (any other access is a BusFault,
 * like the generator's rejection of out-of-window cases), and the final
 * r0-r12, SP, LR, PC, xPSR, RAM window and — family `sysreg` — PRIMASK,
 * BASEPRI, FAULTMASK and CONTROL must be identical.
 *
 * The generator never emits UNPREDICTABLE or IMPLEMENTATION DEFINED
 * encodings, exception-raising sequences, or the patterns where QEMU differs
 * from the ARM ARM (tools/cpu-oracle/README.md lists them with citations), so
 * the replay also asserts that our decoder flags none of the encodings as
 * UNPREDICTABLE.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createCortexM3, type CortexM3 } from '../../../src/mcu/core/cpu'
import type { CoreHooks } from '../../../src/mcu/core/cpu-api'
import { decodeThumb, newDecoded } from '../../../src/mcu/core/decode'
import { nocp, undef } from '../../../src/mcu/core/exec'
import { EventQueue } from '../../../src/mcu/core/scheduler'
import { BusFault, type CycleClock, type SystemBus } from '../../../src/mcu/core/types'
import { FIXTURES, STM32F103_CORE, hex } from './harness'

interface VectorCase {
  id: number
  start: number
  end: number
  /** family `raw`: the address of the single random encoding under test */
  insn?: number
  asm: string
  init: { r: number[]; sp: number; psp: number; apsr: number; ramSeed: number }
  out: {
    /** family `raw`: Unicorn raised UC_ERR_INSN_INVALID (UNDEFINED) */
    undef?: boolean
    r: number[] // r0..r12, lr
    sp: number
    xpsr: number
    ram: [number, number][] // changed words: [offset, value]
    special?: { control: number; primask?: number; basepri?: number; faultmask?: number }
  }
}

interface VectorFile {
  family: string
  oracle: string
  config: { priorityBits?: number } | null
  codeBase: number
  window: [number, number]
  image: string
  rejected: Record<string, number>
  cases: VectorCase[]
}

/** flash image + one RAM window; everything else faults (as in the generator's Unicorn run) */
class VectorBus implements SystemBus {
  codeVersion = 0
  readonly ram: Uint8Array
  constructor(
    readonly image: Uint8Array,
    readonly codeBase: number,
    readonly win: number,
    size: number,
  ) {
    this.ram = new Uint8Array(size)
  }
  private rd(a: number, n: number, fetch: boolean): number {
    a >>>= 0
    let m: Uint8Array | null = null
    let o = (a - this.win) >>> 0
    if (!fetch && o <= this.ram.length - n) m = this.ram
    else {
      o = (a - this.codeBase) >>> 0
      if (o <= this.image.length - n) m = this.image
    }
    if (m === null) throw new BusFault(a, false, 'outside the vector window/image')
    let v = 0
    for (let i = n - 1; i >= 0; i--) v = (v << 8) | m[o + i]
    return v >>> 0
  }
  private wr(a: number, v: number, n: number): void {
    a >>>= 0
    const o = (a - this.win) >>> 0
    if (o > this.ram.length - n) throw new BusFault(a, true, 'outside the vector window')
    for (let i = 0; i < n; i++) this.ram[o + i] = (v >>> (8 * i)) & 0xff
  }
  read8(a: number): number {
    return this.rd(a, 1, false)
  }
  read16(a: number): number {
    return this.rd(a, 2, false)
  }
  read32(a: number): number {
    return this.rd(a, 4, false)
  }
  write8(a: number, v: number): void {
    this.wr(a, v, 1)
  }
  write16(a: number, v: number): void {
    this.wr(a, v, 2)
  }
  write32(a: number, v: number): void {
    this.wr(a, v, 4)
  }
  fetch16(a: number): number {
    return this.rd(a, 2, true)
  }
}

/** the RAM window's initial contents: xorshift32 words (same as ram_fill in gen_vectors.py) */
function ramFill(seed: number, out: Uint8Array): void {
  let x = seed >>> 0
  for (let i = 0; i < out.length; i += 4) {
    x = (x ^ (x << 13)) >>> 0
    x = (x ^ (x >>> 17)) >>> 0
    x = (x ^ (x << 5)) >>> 0
    out[i] = x & 0xff
    out[i + 1] = (x >>> 8) & 0xff
    out[i + 2] = (x >>> 16) & 0xff
    out[i + 3] = x >>> 24
  }
}

function hexBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length / 2)
  for (let i = 0; i < b.length; i++) b[i] = parseInt(s.substr(2 * i, 2), 16)
  return b
}

interface Replay {
  cases: number
  mismatches: string[]
  logs: string[]
  /** `raw`: encodings our decoder reports as UNPREDICTABLE (not comparable, skipped) */
  unpredictable: number
  /** `raw`: encodings both sides treat as UNDEFINED */
  undefined: number
}

const NAMES = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'lr']

/** replay every case of a vector file on our core */
function replay(v: VectorFile): Replay {
  const image = hexBytes(v.image)
  const bus = new VectorBus(image, v.codeBase, v.window[0], v.window[1])
  const logs: string[] = []
  const hooks: CoreHooks = {
    systemResetRequest: () => logs.push('reset request'),
    systickRefDivider: () => 8,
    log: (level, message) => {
      // a core rebuilt after a failed case logs its unreadable reset vector: not a finding of its own
      if (!message.startsWith('reset: vector table')) logs.push(`${level}: ${message}`)
    },
  }
  const config = { ...STM32F103_CORE, ...(v.config ?? {}) }
  const fresh = (): { core: CortexM3; clock: CycleClock } => {
    const clock: CycleClock = { cycles: 0 }
    const core = createCortexM3(bus, new EventQueue(), clock, hooks, config) as CortexM3
    return { core, clock }
  }
  let { core, clock } = fresh()
  const ram0 = new Uint8Array(v.window[1])
  const mismatches: string[] = []
  const dec = newDecoded()
  let unpredictable = 0
  let undefinedBoth = 0
  for (const c of v.cases) {
    if (c.insn !== undefined) {
      // a raw encoding: UNPREDICTABLE ones have no single right answer; UNDEFINED must agree
      const o = c.insn - v.codeBase
      const hw1 = image[o] | (image[o + 1] << 8)
      const hw2 = hw1 >>> 11 >= 0x1d ? image[o + 2] | (image[o + 3] << 8) : 0
      decodeThumb(hw1, hw2, c.insn, dec)
      if (dec.unpredictable !== null) {
        unpredictable++
        continue
      }
      const ours = dec.fn === undef || dec.fn === nocp
      if (c.out.undef || ours) {
        if (c.out.undef && ours) undefinedBoth++
        else mismatches.push(`${v.family}#${c.id} [${c.asm}]: ${c.out.undef ? 'UNDEFINED on Unicorn' : 'executed by Unicorn'}, ${ours ? 'UNDEFINED' : `executed (${dec.fn.name})`} on our core`)
        continue
      }
    }
    // ----------------------------------------------------------- set up
    core.halted = false
    core.npriv = 0
    core.writeSpecial(20, 0, 0) // CONTROL = 0: privileged, MSP
    core.primask = core.basepri = core.faultmask = 0
    core.exclusive = 0
    core.it = 0
    core.tbit = 1
    for (let i = 0; i < 13; i++) core.setRegister(i, c.init.r[i])
    core.setRegister(14, c.init.r[13])
    core.setRegister(13, c.init.sp)
    core.writeSpecial(9, c.init.psp, 0) // PSP
    const f = c.init.apsr >>> 0
    core.n = (f >>> 31) & 1
    core.z = (f >>> 30) & 1
    core.c = (f >>> 29) & 1
    core.v = (f >>> 28) & 1
    core.q = (f >>> 27) & 1
    core.setRegister(15, c.start)
    core.breakpoints.clear()
    core.breakpoints.add(c.end >>> 0)
    ramFill(c.init.ramSeed, ram0)
    bus.ram.set(ram0)
    // -------------------------------------------------------------- run
    const why = core.run(clock.cycles + 100_000)
    // ---------------------------------------------------------- compare
    const diffs: string[] = []
    const R = core.registers()
    if (why !== 'breakpoint' || R.r[15] !== c.end >>> 0) diffs.push(`stopped with '${why}' at ${hex(R.r[15])}, expected the end ${hex(c.end)}`)
    for (let i = 0; i < 14; i++) {
      const got = R.r[i === 13 ? 14 : i]
      if (got !== c.out.r[i] >>> 0) diffs.push(`${NAMES[i]} ${hex(got)} != ${hex(c.out.r[i])}`)
    }
    if (R.r[13] !== c.out.sp >>> 0) diffs.push(`sp ${hex(R.r[13])} != ${hex(c.out.sp)}`)
    if (R.xpsr !== c.out.xpsr >>> 0) diffs.push(`xpsr ${hex(R.xpsr)} != ${hex(c.out.xpsr)}`)
    const want = new Map(c.out.ram.map(([o, w]) => [o, w >>> 0]))
    for (let o = 0; o < ram0.length; o += 4) {
      const got = (bus.ram[o] | (bus.ram[o + 1] << 8) | (bus.ram[o + 2] << 16) | (bus.ram[o + 3] << 24)) >>> 0
      const init = (ram0[o] | (ram0[o + 1] << 8) | (ram0[o + 2] << 16) | (ram0[o + 3] << 24)) >>> 0
      const exp = want.get(o) ?? init
      if (got !== exp) diffs.push(`ram[${hex(v.window[0] + o)}] ${hex(got)} != ${hex(exp)}`)
    }
    if (c.out.special) {
      const s = c.out.special
      if (R.control !== s.control) diffs.push(`CONTROL ${R.control} != ${s.control}`)
      if (s.primask !== undefined && R.primask !== s.primask) diffs.push(`PRIMASK ${R.primask} != ${s.primask}`)
      if (s.basepri !== undefined && R.basemask !== s.basepri) diffs.push(`BASEPRI ${hex(R.basemask)} != ${hex(s.basepri)}`)
      if (s.faultmask !== undefined && R.faultmask !== s.faultmask) diffs.push(`FAULTMASK ${R.faultmask} != ${s.faultmask}`)
    }
    if (diffs.length > 0) {
      const o = c.start - v.codeBase
      const bytes = Array.from(image.subarray(o, Math.min(o + 48, c.end - v.codeBase)), (b) => b.toString(16).padStart(2, '0')).join('')
      mismatches.push(`${v.family}#${c.id} [${c.asm}] (${bytes}): ${diffs.join('; ')}`)
      ;({ core, clock } = fresh()) // a faulted/locked-up core must not poison the next case
    }
  }
  return { cases: v.cases.length, mismatches, logs, unpredictable, undefined: undefinedBoth }
}

function loadVectors(file: string): VectorFile {
  return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as VectorFile
}

/** OHMLET_CPU_VECTORS=<dir> replays freshly generated vectors before they are committed */
const DIR = process.env.OHMLET_CPU_VECTORS ?? FIXTURES
const FILES = readdirSync(DIR)
  .filter((f) => /^vectors-.*\.json\.gz$/.test(f))
  .sort()

describe('Cortex-M3 core vs Unicorn (QEMU) reference vectors', () => {
  let total = 0
  for (const f of FILES) {
    const v = loadVectors(path.join(DIR, f))
    total += v.cases.length
    const what = v.family === 'raw' ? 'random encodings: UNDEFINED or identical results' : 'random sequences match exactly'
    it(`${v.family}: ${v.cases.length} ${what}`, () => {
      const res = replay(v)
      expect(res.mismatches.slice(0, 12), `${res.mismatches.length} of ${res.cases} cases differ`).toEqual([])
      // valid encodings only: the decoder must not consider any of them UNPREDICTABLE
      expect(res.logs).toEqual([])
      if (v.family === 'raw') {
        // most raw encodings are comparable: both UNDEFINED, or executed with identical results
        expect(res.unpredictable).toBeLessThan(res.cases / 4)
        expect(res.undefined).toBeGreaterThan(res.cases / 4)
      } else expect(res.unpredictable).toBe(0)
    })
  }
  it('covers every instruction family with at least 20,000 cases in total', () => {
    const fams = FILES.map((f) => f.replace(/^vectors-|\.json\.gz$/g, ''))
    expect(fams).toEqual(
      expect.arrayContaining(['alu16', 'dp_imm', 'dp_plain', 'dp_shift', 'dp_reg', 'mul_div', 'ldst_imm', 'ldst_reg', 'ldst_multi', 'excl', 'branch', 'it', 'sp', 'pcrel', 'sysreg']),
    )
    expect(total).toBeGreaterThanOrEqual(20_000)
  })
})
