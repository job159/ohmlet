/**
 * src/mcu/core/disasm.ts against `llvm-objdump -d --triple=thumbv7m`:
 *
 *  - the committed listings of every firmware/tests/isa program (including
 *    encodings.s, a deterministic sample of the whole Thumb encoding space:
 *    every 11th 16-bit encoding, 3500 random 32-bit ones, MSR/MRS/hint/barrier
 *    spaces) — always run, no toolchain needed;
 *  - every firmware/dist ELF through a live llvm-objdump when the LLVM
 *    toolchain is installed (found like firmware/build.mjs finds it).
 *
 * Comparison: llvm-objdump's `<symbol+off>` annotations and `@` comments are
 * dropped, whitespace collapsed; "exact" compares the remaining text as is,
 * "normalized" additionally reads every `#imm` as a number (hex/decimal).
 * Lines llvm-objdump shows as data (.word/.short, from mapping symbols) are
 * not instructions and are skipped.
 *
 * The same sample cross-checks decode.ts (the executable decoder) with the
 * disassembler: what the disassembler cannot decode must be UNDEFINED, NOCP or
 * flagged UNPREDICTABLE by decode.ts, and what decode.ts executes as
 * UNDEFINED must not disassemble to an instruction (UDF excepted).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeThumb, is32, newDecoded } from '../../../src/mcu/core/decode'
import { disassemble, disassembleAtPc, disassembleOne, isThumb32, itStateOfXpsr } from '../../../src/mcu/core/disasm'
import { FIXTURES, FW_DIST, fixture, hex, loadElfFile, type ElfImage } from './harness'

interface Entry {
  addr: number
  text: string
  data: boolean
  /** first line after a gap / data: starts a new disassembly run */
  brk: boolean
}

/** parse an llvm-objdump -d listing (with or without raw instruction bytes) */
export function parseListing(listing: string): Entry[] {
  const out: Entry[] = []
  let brk = true
  for (const line of listing.split(/\r?\n/)) {
    if (/^\s*\.\.\.\s*$/.test(line)) {
      brk = true
      continue
    }
    const m = /^\s*([0-9a-f]+):\s([^\t]*)\t(.*)$/.exec(line)
    if (!m) continue
    const text = m[3].trim()
    const data = /^\.(word|short|byte)\b/.test(text)
    out.push({ addr: parseInt(m[1], 16), text, data, brk })
    brk = data
  }
  return out
}

/** drop `<sym+off>` annotations and `@` comments, collapse whitespace */
const clean = (t: string): string => (t.startsWith('<unknown>') ? '<unknown>' : t.replace(/\s*@.*$/, '').replace(/\s+<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
/** ... and read immediates as numbers */
const norm = (t: string): string => clean(t).replace(/#(-?)(0x[0-9a-f]+|\d+)/g, (_, s: string, v: string) => `#${s}${Number(v)}`)

function memoryOf(elf: ElfImage): (a: number) => number {
  const mem = new Map<number, number>()
  for (const [, s] of elf.sections) if (s.addr) for (let i = 0; i < s.data.length; i++) mem.set(s.addr + i, s.data[i])
  return (a: number) => {
    const lo = mem.get(a)
    const hi = mem.get(a + 1)
    if (lo === undefined || hi === undefined) throw new Error(`unmapped ${hex(a)}`)
    return lo | (hi << 8)
  }
}

interface Score {
  lines: number
  exact: number
  normalized: number
  mismatches: string[]
}

function score(name: string, elf: ElfImage, listing: string, into: Score): void {
  const read16 = memoryOf(elf)
  const entries = parseListing(listing)
  for (let i = 0; i < entries.length; ) {
    if (entries[i].data) {
      i++
      continue
    }
    let j = i + 1
    while (j < entries.length && !entries[j].data && !entries[j].brk) j++
    const run = entries.slice(i, j)
    const lines = new Map(disassemble(read16, run[0].addr, run.length).map((l) => [l.addr, l]))
    for (const e of run) {
      into.lines++
      const l = lines.get(e.addr)
      const got = l?.text ?? '<missing>'
      if (clean(got) === clean(e.text)) into.exact++
      if (norm(got) === norm(e.text)) into.normalized++
      else into.mismatches.push(`${name} ${hex(e.addr)}: got "${clean(got)}" llvm-objdump "${clean(e.text)}"`)
    }
    i = j
  }
}

const report = (what: string, s: Score) =>
  console.log(
    `disassembler vs llvm-objdump, ${what}: ${s.lines} instructions, exact ${((100 * s.exact) / s.lines).toFixed(3)}%, ` +
      `normalized ${((100 * s.normalized) / s.lines).toFixed(3)}%` +
      (s.mismatches.length ? `\n  mismatches:\n  ${s.mismatches.slice(0, 50).join('\n  ')}` : ''),
  )

/** the LLVM objdump of the toolchain firmware/build.mjs uses, or null */
function objdumpTool(): string | null {
  const exe = process.platform === 'win32' ? '.exe' : ''
  const tool = process.env.OHMLET_CLANG_DIR ? path.join(process.env.OHMLET_CLANG_DIR, 'llvm-objdump' + exe) : 'llvm-objdump'
  const r = spawnSync(tool, ['--version'], { encoding: 'utf8' })
  return r.status === 0 ? tool : null
}
const OBJDUMP = objdumpTool()

describe('disassembler vs llvm-objdump', () => {
  it('committed listings of the ISA programs and the encoding-space sample (>= 99% exact)', () => {
    const s: Score = { lines: 0, exact: 0, normalized: 0, mismatches: [] }
    const names = readdirSync(FIXTURES)
      .filter((f) => f.endsWith('.objdump') && existsSync(path.join(FIXTURES, f.replace(/\.objdump$/, '.elf'))))
      .map((f) => f.slice(0, -8))
    expect(names).toContain('encodings')
    expect(names.length).toBeGreaterThanOrEqual(19)
    for (const n of names) score(n, loadElfFile(path.join(FIXTURES, `${n}.elf`)), readFileSync(path.join(FIXTURES, `${n}.objdump`), 'utf8'), s)
    report('committed fixtures', s)
    expect(s.lines).toBeGreaterThan(50_000)
    expect(s.exact / s.lines).toBeGreaterThanOrEqual(0.99)
    expect(s.normalized / s.lines).toBeGreaterThanOrEqual(0.99)
  })

  it.skipIf(OBJDUMP === null)('every firmware/dist ELF through a live llvm-objdump (>= 99% exact)', () => {
    const s: Score = { lines: 0, exact: 0, normalized: 0, mismatches: [] }
    const elfs = readdirSync(FW_DIST).filter((f) => f.endsWith('.elf'))
    expect(elfs.length).toBeGreaterThan(5)
    for (const f of elfs) {
      const r = spawnSync(OBJDUMP as string, ['-d', '--triple=thumbv7m', path.join(FW_DIST, f)], { encoding: 'utf8', maxBuffer: 64 << 20 })
      expect(r.status, r.stderr).toBe(0)
      score(`dist/${f}`, loadElfFile(path.join(FW_DIST, f)), r.stdout, s)
    }
    report('firmware/dist', s)
    expect(s.lines).toBeGreaterThan(10_000)
    expect(s.exact / s.lines).toBeGreaterThanOrEqual(0.99)
  })
})

describe('decode.ts and the disassembler agree on UNDEFINED encodings', () => {
  it('all 16-bit encodings and 300k pseudo-random 32-bit ones', () => {
    const d = newDecoded()
    const bad: string[] = []
    let x = 0x2545f491
    const rnd = () => {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      return x >>> 0
    }
    const check = (hw1: number, hw2: number) => {
      decodeThumb(hw1, hw2, 0x08000100, d)
      const text = disassembleOne(hw1, hw2, 0x08000100)
      const name = d.fn.name
      const undefined_ = name === 'undef' || name === 'nocp'
      const enc = is32(hw1) ? `${hw1.toString(16)} ${hw2.toString(16).padStart(4, '0')}` : hw1.toString(16).padStart(4, '0')
      // LLVM does not decode it: decode.ts must not run it as an ordinary instruction. The one
      // documented difference: halfword loads to PC without writeback are the "unallocated memory
      // hints, treat as NOP" of A5.3.8, which LLVM does not decode.
      const hintNop = is32(hw1) && name === 'nop' && (hw1 & 0xfe70) === 0xf830 && hw2 >>> 12 === 15
      if (text === '<unknown>' && !undefined_ && d.unpredictable === null && !hintNop) bad.push(`${enc}: decode.ts runs ${name}, disassembler <unknown>`)
      // decode.ts UNDEFINED: only UDF (permanently undefined) may disassemble to a mnemonic
      if (name === 'undef' && !/^(<unknown>|udf|udf\.w|trap|__brkdiv0)(\t|$)/.test(text)) bad.push(`${enc}: decode.ts UNDEFINED, disassembler "${text}"`)
      if (name === 'nocp' && !/^(<unknown>|mrc2?|mcr2?|cdp2?|ldc2?l?|stc2?l?|mrrc2?|mcrr2?)(\t|$)/.test(text)) bad.push(`${enc}: decode.ts NOCP, disassembler "${text}"`)
    }
    for (let h = 0; h < 0x10000; h++) if (!isThumb32(h)) check(h, 0)
    for (let i = 0; i < 300_000; i++) check(0xe800 + (rnd() % 0x1800), rnd() & 0xffff)
    expect(bad.slice(0, 30)).toEqual([])
  })
})

describe('disassembler API', () => {
  it('lines carry address, size, bytes and the branch / literal target', () => {
    const m = fixture('branch')
    const read16 = (a: number) => m.bus.read16(a)
    const lines = disassemble(read16, m.sym('reset'), 400)
    expect(lines.length).toBe(400)
    for (let i = 1; i < lines.length; i++) expect(lines[i].addr).toBe(lines[i - 1].addr + lines[i - 1].size)
    for (const l of lines) {
      expect(l.bytes.length).toBe(l.size)
      expect(l.bytes[0] | (l.bytes[1] << 8)).toBe(read16(l.addr))
      if (/^(b|bl|cbn?z)[a-z.]*\t/.test(l.text)) expect(l.text).toContain(`0x${(l.target as number).toString(16)}`)
    }
    // 16-bit literal load: target = Align(PC, 4) + imm
    const lit = disassemble(() => 0x4803, 0x08000102, 1)[0] // ldr r0, [pc, #12]
    expect(lit).toEqual({ addr: 0x08000102, size: 2, text: 'ldr\tr0, [pc, #0xc]', bytes: [0x03, 0x48], target: 0x08000104 + 12 })
  })

  it('tracks ITSTATE from an IT instruction or from xPSR (the inspector starting mid-block)', () => {
    // ite eq; addeq r0, r1; subne r0, #1; adds r0, #1
    const code = [0xbf0c, 0x4408, 0x3801, 0x3001]
    const read16 = (a: number) => code[(a - 0x08000000) >> 1]
    expect(disassemble(read16, 0x08000000, 4).map((l) => l.text)).toEqual(['ite\teq', 'addeq\tr0, r1', 'subne\tr0, #0x1', 'adds\tr0, #0x1'])
    // halted on the else slot: ITSTATE 0x0c ("ite eq") advanced once is 0x18 (NE, last slot), as xPSR holds it
    const xpsr = 0x01000000 | ((0x18 & 3) << 25) | ((0x18 >> 2) << 10)
    expect(itStateOfXpsr(xpsr)).toBe(0x18)
    expect(disassemble(read16, 0x08000004, 2, { itState: itStateOfXpsr(xpsr) }).map((l) => l.text)).toEqual(['subne\tr0, #0x1', 'adds\tr0, #0x1'])
  })

  it('disassembleAtPc: the current instruction of a halted core, IT condition included', () => {
    const m = fixture('branch')
    // stop on the first instruction executed inside an IT block
    let regs = m.core.registers()
    for (let i = 0; i < 100_000 && itStateOfXpsr(regs.xpsr) === 0; i++) {
      m.core.halted = true
      m.core.stepInstruction()
      regs = m.core.registers()
    }
    expect(itStateOfXpsr(regs.xpsr)).not.toBe(0)
    const readMemory = (addr: number, length: number) => {
      const out = new Uint8Array(length)
      for (let i = 0; i < length; i++) out[i] = m.bus.read8(addr + i)
      return out
    }
    const [line] = disassembleAtPc(readMemory, regs, 1)
    expect(line.addr).toBe(regs.r[15])
    const cond = ['eq', 'ne', 'hs', 'lo', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le'][itStateOfXpsr(regs.xpsr) >> 4]
    expect(line.text.split('\t')[0]).toMatch(new RegExp(`${cond}(\\.w)?$`))
  })

  it('stops at unreadable memory instead of inventing instructions', () => {
    const read16 = (a: number) => {
      if (a >= 0x08000004) throw new Error('unmapped')
      return 0xbf00
    }
    expect(disassemble(read16, 0x08000000, 10).map((l) => l.text)).toEqual(['nop', 'nop'])
    // a 32-bit instruction whose second halfword is unreadable is not shown
    const half = (a: number) => {
      if (a !== 0x08000000) throw new Error('unmapped')
      return 0xf000 // first halfword of a BL
    }
    expect(disassemble(half, 0x08000000, 3)).toEqual([])
  })
})
