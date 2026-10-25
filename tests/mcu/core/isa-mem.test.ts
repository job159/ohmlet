/**
 * Load/store instructions (firmware/tests/isa/mem.s). Every result slot is
 * predicted here from the program's pattern bytes and an independent
 * little-endian model of the SRAM buffer the program stores into.
 */
import { describe, expect, it } from 'vitest'
import { fixture, hex } from './harness'

describe('ISA: loads and stores (mem.s)', () => {
  const m = fixture('mem')
  const why = m.runToStop(1_000_000)
  const pattern = m.sym('pattern')
  const P = Array.from({ length: 64 }, (_, i) => m.bus.read8(pattern + i))

  it('the program ran to its final BKPT', () => {
    expect(why).toBe('breakpoint')
    expect(m.logs.filter((l) => l.level !== 'info')).toEqual([])
    expect(m.logs.at(-1)?.message).toMatch(/BKPT #0 /)
  })

  it('pattern is what the assembler was told to emit', () => {
    expect(P).toEqual(Array.from({ length: 64 }, (_, i) => (0x93 * i + 0x17) & 0xff))
  })

  // pattern accessors relative to r9 = pattern + 32 (little-endian)
  const u8 = (o: number) => P[32 + o]
  const u16 = (o: number) => u8(o) | (u8(o + 1) << 8)
  const u32 = (o: number) => (u16(o) | (u16(o + 2) << 16)) >>> 0
  const s8 = (o: number) => ((u8(o) << 24) >> 24) >>> 0
  const s16 = (o: number) => ((u16(o) << 16) >> 16) >>> 0
  const neg = (x: number) => x >>> 0

  // independent model of the 64-byte SRAM buffer
  const buf = new Uint8Array(64)
  const st8 = (o: number, v: number) => (buf[o] = v & 0xff)
  const st16 = (o: number, v: number) => (st8(o, v), st8(o + 1, v >>> 8))
  const st32 = (o: number, v: number) => (st16(o, v), st16(o + 2, v >>> 16))
  const ld8 = (o: number) => buf[o]
  const ld16 = (o: number) => buf[o] | (buf[o + 1] << 8)
  const ld32 = (o: number) => (ld16(o) | (ld16(o + 2) << 16)) >>> 0
  const dump = () => Array.from({ length: 16 }, (_, i) => ld32(4 * i))

  const R0 = 0x11223344
  const R1 = 0xa5b6c7d8
  const expected: number[] = []
  const E = (...v: number[]) => expected.push(...v.map((x) => x >>> 0))

  // single loads
  E(u32(0), u32(4), u32(1), u32(-4), u8(3), u8(-1), u16(2), u16(-2), s8(3), s8(5), s16(3), s16(-6), u16(1), u32(12), u8(6), u32(3), u16(3), u8(3), s16(6))
  // literals (lit1 = 0xcafef00d, lit_back = 0x0badf00d)
  E(0xcafef00d, 0x0badf00d, 0x0d, 0xffffcafe, 0xffffffca)
  // pre/post-indexed: value, base offset
  E(u32(4), 4, u32(4), neg(-4), u8(-3), neg(-3), s8(-3), 0, u16(-2), neg(-2), s16(-2), 4, s8(3), 3, u16(3), 0)
  // LDRD
  E(u32(8), u32(12), u32(-8), u32(-4), u32(16), u32(20), 16, u32(16), u32(20), neg(-8), 0x01020304, 0xf0e0d0c0)
  // LDM / LDMDB / LDM without writeback
  E(u32(0), u32(4), u32(8), u32(12), 16, u32(4), u32(8), u32(12), 4, u32(0), u32(4), 0)
  // stores
  st32(0, R0)
  st8(4, R1)
  st16(6, R1)
  st32(9, R1)
  st16(13, R0)
  st32(16, R0)
  st8(4, R0)
  st32(20, R1)
  E(20)
  st8(20, R0)
  E(19)
  st16(24, R0)
  E(24)
  st32(32, R0)
  st32(36, R1)
  st32(40, R1)
  st32(44, R0)
  E(40)
  st32(40, R0)
  st32(44, R0)
  E(32)
  st32(48, R0)
  st32(52, R1)
  st32(56, 4)
  E(60)
  st32(52, R1)
  st32(56, 4)
  E(52)
  st32(52, R0)
  E(56)
  E(12, R0, R1, 4, 0) // push/pop
  E(R0, R1, pattern + 32) // push.w/pop.w
  st32(60, R1)
  E(R1)
  st8(58, R0)
  E(0x44)
  E(((ld8(63) << 24) >> 24) >>> 0)
  st16(56, R0)
  E(0x3344)
  E(((ld16(62) << 16) >> 16) >>> 0)
  E(...dump())
  // exclusives
  E(ld32(0))
  st32(0, R1)
  E(0, 1)
  E(ld8(4))
  st8(4, R0)
  E(0)
  E(ld16(4))
  E(1) // CLREX closed the monitor
  E(ld32(8))
  st32(8, R0)
  E(0)
  E(ld16(14))
  st16(14, R1)
  E(0)
  E(ld32(0), ld32(4), ld32(8), ld32(12))
  // bit-band: set buf[0].5, clear buf[1].0, set buf[3].7, set buf[2].3 (byte-sized alias write)
  buf[0] |= 0x20
  buf[1] &= ~1
  buf[3] |= 0x80
  buf[2] |= 0x08
  E(1, (buf[0] >> 4) & 1, (buf[4] >> 1) & 1, (buf[1] >> 1) & 1, ld32(0))
  // 16-bit encodings
  E(u32(4), u8(7), u16(6), u32(3), u8(3), u16(3), s8(3), s16(3))
  E(0xcafef00d, m.sym('lit1'), 0xcafef00d, 0xcafef00d, 0xcafef00d)
  const V = 0x89abcdef
  st32(4, V)
  st16(10, V)
  st8(13, V)
  st32(2, V)
  st16(9, V)
  st8(15, V)
  E(ld32(0), ld32(4), ld32(8), ld32(12), 16)
  st32(16, ld32(0))
  st32(20, ld32(4))
  E(24, ld32(16), ld32(20))

  it('every result slot matches the ARM ARM semantics', () => {
    const results = m.sym('results')
    const got = expected.map((_, i) => m.r32(results + 4 * i))
    const diffs = expected.map((w, i) => (got[i] === w ? null : `slot ${i}: got ${hex(got[i])} want ${hex(w)}`)).filter(Boolean)
    expect(diffs).toEqual([])
    // the program wrote exactly as many slots as predicted
    expect(m.core.registers().r[8]).toBe(results + 4 * expected.length)
  })
})
