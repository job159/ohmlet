/**
 * ARMv7-M Thumb instruction semantics (DDI 0403E chapter A7), one handler
 * per pre-decoded operation. decode.ts maps every encoding to a handler plus
 * up to four integer fields (a, b, c, d); cpu.ts calls
 *
 *   cycles = handler(cpu, a, b, c, d, pc)
 *
 * with R[15] ALREADY set to the address of the next sequential instruction
 * (pc + 2 or pc + 4). A handler branches by overwriting R[15]. Because a
 * 32-bit instruction's next address equals the architectural PC read value
 * (pc + 4), 32-bit handlers may read R[15] as an operand directly; the few
 * 16-bit encodings that can read the PC (high-register ADD/CMP/MOV, BX/BLX)
 * use the `pc` argument instead. PC-relative addresses (literal loads, ADR,
 * branch targets) are folded into constants at decode time.
 *
 * Register file: cpu.r is an Int32Array(18): r0..r15, r16 = write sink for
 * UNPREDICTABLE destinations decode.ts discards, r17 = constant zero (base of
 * decode-time absolute addresses, e.g. LDR literal = LDR [r17, #addr]).
 *
 * Flags-setting mode `s` (field d of data-processing ops):
 *   0 = never, 1 = always (32-bit S=1 and CMP/CMN/TST/TEQ),
 *   2 = only outside an IT block — 16-bit data-processing encodings set
 *       flags only when not InITBlock() (A7.3.3, e.g. ADDS vs ADD<c>).
 *
 * Cycle model: Cortex-M3 TRM (DDI 0337, r2p1 §3.3.1 Table 3-1 "Cortex-M3
 * instruction set summary"; r1p1 §18.2 Table 18-1). P = pipeline refill after
 * a taken branch (TRM: 1..3, depending on alignment and the branch target
 * being a literal; we use 2), N = number of registers transferred. Every
 * handler returns its cycle count; cpu.ts adds the exception costs.
 *
 *   | instruction class (Table 3-1)                 | TRM             | model                                  |
 *   |-----------------------------------------------|-----------------|----------------------------------------|
 *   | ADD/ADC/SUB/SBC/RSB, logical, MOV/MVN, shifts | 1               | 1                                      |
 *   | ... writing the PC (ADD pc / MOV pc)          | 1 + P           | 3                                      |
 *   | CMP/CMN/TST/TEQ, MOVW/MOVT, ADR, CLZ, REV*,   | 1               | 1                                      |
 *   |   RBIT, extends, BFI/BFC/UBFX/SBFX, SSAT/USAT |                 |                                        |
 *   | MUL                                           | 1               | 1                                      |
 *   | MLA / MLS                                     | 2               | 2                                      |
 *   | SMULL / UMULL                                 | 3..5 [c]        | 3 + 1 per operand with a significant   |
 *   |                                               |                 | upper halfword (3..5)                  |
 *   | SMLAL / UMLAL                                 | 4..7 [c]        | 4 + the same (4..6)                    |
 *   | SDIV / UDIV                                   | 2..12 [d]       | 2 + ceil(5 × significant quotient bits |
 *   |                                               |                 | / 16): 2 (zero) .. 12 (32-bit)         |
 *   | LDR/LDRB/LDRH/LDRSB/LDRSH, any addressing     | 2 [b]           | 2                                      |
 *   | LDR to PC                                     | 2 + P           | 4                                      |
 *   | STR/STRB/STRH, any addressing                 | 2 [b]           | 2                                      |
 *   | LDRD / STRD                                   | 1 + N           | 3                                      |
 *   | LDM / STM / PUSH / POP                        | 1 + N           | 1 + N                                  |
 *   | LDM / POP including PC                        | 1 + N + P       | 3 + N                                  |
 *   | LDREX / STREX (B/H), CLREX                    | 2 / 2 / 1       | 2 / 2 / 1                              |
 *   | B, BL, BX, BLX                                | 1 + P           | 3                                      |
 *   | B<c>, CBZ / CBNZ                              | 1 or 1 + P      | 1 not taken, 3 taken                   |
 *   | TBB / TBH                                     | 2 + P           | 4                                      |
 *   | MRS / MSR                                     | 1 or 2          | 2                                      |
 *   | CPSIE / CPSID                                 | 1 or 2          | 1                                      |
 *   | IT, NOP, YIELD, SEV                           | 1               | 1                                      |
 *   | WFI / WFE                                     | 1 + W           | 1 + the sleep (cpu.ts fast-forward)    |
 *   | DMB / DSB / ISB                               | 1 + B           | 1 (no write buffer: B = 0)             |
 *   | an IT-skipped instruction                     | 1               | 1                                      |
 *   | exception entry / return / tail-chain         | 12 / 10 / 6     | 12 / 10 / 6 (cpu.ts; TRM §5.5)         |
 *
 * [c] UMULL/SMULL/UMLAL/SMLAL terminate early depending on the size of the
 *     source values; the TRM gives only the ranges, the per-operand rule above
 *     is ours (a significant upper halfword = not a pure zero/sign extension).
 * [d] the divider terminates early depending on the leading zeros/ones of the
 *     operands, i.e. on the size of the quotient; the TRM gives only 2..12.
 *
 * Not modeled (documented deviations): [b] neighbouring single loads/stores
 * pipelining their address/data phases (back-to-back LDR/STR completing in
 * 1 cycle) and "STR Rx,[Ry,#imm] is always one cycle" (TRM load-store
 * timings), IT folding and the P = 1 / P = 3 cases — these make the model a
 * little slower than the core; flash wait states (STM32F103: 2 at 72 MHz,
 * largely hidden by its prefetch buffer) and bus contention — memory is
 * zero-wait-state here, which makes the model faster than silicon running
 * non-sequential code from flash.
 */
import type { CortexM3 } from './cpu'

export type Handler = (cpu: CortexM3, a: number, b: number, c: number, d: number, pc: number) => number

/** pipeline refill penalty of a taken branch (TRM: P = 1..3; we use 2) */
export const P = 2

/** r16: discarded-result sink, r17: constant zero */
export const R_SINK = 16
export const R_ZERO = 17

// UFSR / BFSR / MMFSR bit positions inside CFSR (B3.2.15)
export const UFSR_UNDEFINSTR = 1 << 16
export const UFSR_INVSTATE = 1 << 17
export const UFSR_INVPC = 1 << 18
export const UFSR_NOCP = 1 << 19
export const UFSR_UNALIGNED = 1 << 24
export const UFSR_DIVBYZERO = 1 << 25

// ---------------------------------------------------------------- helpers

function sf(cpu: CortexM3, s: number): boolean {
  return s === 1 || (s === 2 && cpu.inIT === 0)
}

function setNZ(cpu: CortexM3, r: number): void {
  cpu.n = r >>> 31
  cpu.z = r === 0 ? 1 : 0
}

/** AddWithCarry(x, y, carry_in) with NZCV update (A2.2.1). */
function addFlags(cpu: CortexM3, x: number, y: number, cin: number): number {
  const r = (x + y + cin) | 0
  cpu.n = r >>> 31
  cpu.z = r === 0 ? 1 : 0
  cpu.c = (x >>> 0) + (y >>> 0) + cin > 0xffffffff ? 1 : 0
  cpu.v = ((x ^ r) & (y ^ r)) >>> 31
  return r
}

/** ConditionPassed() for a 4-bit condition code (A7.3). */
export function condPassed(cpu: CortexM3, cond: number): boolean {
  switch (cond) {
    case 0:
      return cpu.z === 1
    case 1:
      return cpu.z === 0
    case 2:
      return cpu.c === 1
    case 3:
      return cpu.c === 0
    case 4:
      return cpu.n === 1
    case 5:
      return cpu.n === 0
    case 6:
      return cpu.v === 1
    case 7:
      return cpu.v === 0
    case 8:
      return cpu.c === 1 && cpu.z === 0
    case 9:
      return cpu.c === 0 || cpu.z === 1
    case 10:
      return cpu.n === cpu.v
    case 11:
      return cpu.n !== cpu.v
    case 12:
      return cpu.z === 0 && cpu.n === cpu.v
    case 13:
      return cpu.z === 1 || cpu.n !== cpu.v
    default:
      return true
  }
}

/**
 * Shift_C (A7.4.2). type: 0 LSL, 1 LSR, 2 ASR, 3 ROR, 4 RRX. Works both for
 * DecodeImmShift amounts and for register-controlled amounts (0..255).
 * Leaves the shifter carry-out in cpu.sc.
 */
export function shiftC(cpu: CortexM3, x: number, type: number, n: number): number {
  switch (type) {
    case 0:
      if (n === 0) {
        cpu.sc = cpu.c
        return x
      }
      if (n >= 32) {
        cpu.sc = n === 32 ? x & 1 : 0
        return 0
      }
      cpu.sc = (x >>> (32 - n)) & 1
      return x << n
    case 1:
      if (n === 0) {
        cpu.sc = cpu.c
        return x
      }
      if (n >= 32) {
        cpu.sc = n === 32 ? x >>> 31 : 0
        return 0
      }
      cpu.sc = (x >>> (n - 1)) & 1
      return (x >>> n) | 0
    case 2:
      if (n === 0) {
        cpu.sc = cpu.c
        return x
      }
      if (n >= 32) {
        cpu.sc = x >>> 31
        return x >> 31
      }
      cpu.sc = (x >> (n - 1)) & 1
      return x >> n
    case 3: {
      if (n === 0) {
        cpu.sc = cpu.c
        return x
      }
      const m = n & 31
      const r = m === 0 ? x : (x >>> m) | (x << (32 - m))
      cpu.sc = r >>> 31
      return r | 0
    }
    default: {
      const r = (cpu.c << 31) | (x >>> 1)
      cpu.sc = x & 1
      return r
    }
  }
}

/** shifted-register operand: d = s | type << 2 | amount << 5 */
function shOperand(cpu: CortexM3, x: number, d: number): number {
  return shiftC(cpu, x, (d >> 2) & 7, d >> 5)
}

// ---------------------------------------- data processing: register (a=rd b=rn c=rm d=s)

export function andR(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  const r = R[rn] & R[rm]
  if (s !== 0 && sf(cpu, s)) setNZ(cpu, r)
  R[rd] = r
  return 1
}
export function eorR(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  const r = R[rn] ^ R[rm]
  if (s !== 0 && sf(cpu, s)) setNZ(cpu, r)
  R[rd] = r
  return 1
}
export function orrR(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  const r = R[rn] | R[rm]
  if (s !== 0 && sf(cpu, s)) setNZ(cpu, r)
  R[rd] = r
  return 1
}
export function ornR(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  const r = R[rn] | ~R[rm]
  if (s !== 0 && sf(cpu, s)) setNZ(cpu, r)
  R[rd] = r
  return 1
}
export function bicR(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  const r = R[rn] & ~R[rm]
  if (s !== 0 && sf(cpu, s)) setNZ(cpu, r)
  R[rd] = r
  return 1
}
export function movR(cpu: CortexM3, rd: number, _rn: number, rm: number, s: number): number {
  const R = cpu.r
  const r = R[rm]
  if (s !== 0 && sf(cpu, s)) setNZ(cpu, r)
  R[rd] = r
  return 1
}
export function mvnR(cpu: CortexM3, rd: number, _rn: number, rm: number, s: number): number {
  const R = cpu.r
  const r = ~R[rm]
  if (s !== 0 && sf(cpu, s)) setNZ(cpu, r)
  R[rd] = r
  return 1
}
export function tstR(cpu: CortexM3, _rd: number, rn: number, rm: number): number {
  const R = cpu.r
  setNZ(cpu, R[rn] & R[rm])
  return 1
}
export function teqR(cpu: CortexM3, _rd: number, rn: number, rm: number): number {
  const R = cpu.r
  setNZ(cpu, R[rn] ^ R[rm])
  return 1
}
export function addR(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  R[rd] = s !== 0 && sf(cpu, s) ? addFlags(cpu, R[rn], R[rm], 0) : R[rn] + R[rm]
  return 1
}
export function adcR(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  R[rd] = s !== 0 && sf(cpu, s) ? addFlags(cpu, R[rn], R[rm], cpu.c) : R[rn] + R[rm] + cpu.c
  return 1
}
export function subR(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  R[rd] = s !== 0 && sf(cpu, s) ? addFlags(cpu, R[rn], ~R[rm], 1) : R[rn] - R[rm]
  return 1
}
export function sbcR(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  R[rd] = s !== 0 && sf(cpu, s) ? addFlags(cpu, R[rn], ~R[rm], cpu.c) : R[rn] + ~R[rm] + cpu.c
  return 1
}
export function rsbR(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  R[rd] = s !== 0 && sf(cpu, s) ? addFlags(cpu, ~R[rn], R[rm], 1) : R[rm] - R[rn]
  return 1
}
export function cmpR(cpu: CortexM3, _rd: number, rn: number, rm: number): number {
  const R = cpu.r
  addFlags(cpu, R[rn], ~R[rm], 1)
  return 1
}
export function cmnR(cpu: CortexM3, _rd: number, rn: number, rm: number): number {
  const R = cpu.r
  addFlags(cpu, R[rn], R[rm], 0)
  return 1
}

// --------------------- data processing: shifted register (a=rd b=rn c=rm d=s|type<<2|amt<<5)

export function andS(cpu: CortexM3, rd: number, rn: number, rm: number, d: number): number {
  const R = cpu.r
  const r = R[rn] & shOperand(cpu, R[rm], d)
  if (sf(cpu, d & 3)) {
    setNZ(cpu, r)
    cpu.c = cpu.sc
  }
  R[rd] = r
  return 1
}
export function eorS(cpu: CortexM3, rd: number, rn: number, rm: number, d: number): number {
  const R = cpu.r
  const r = R[rn] ^ shOperand(cpu, R[rm], d)
  if (sf(cpu, d & 3)) {
    setNZ(cpu, r)
    cpu.c = cpu.sc
  }
  R[rd] = r
  return 1
}
export function orrS(cpu: CortexM3, rd: number, rn: number, rm: number, d: number): number {
  const R = cpu.r
  const r = R[rn] | shOperand(cpu, R[rm], d)
  if (sf(cpu, d & 3)) {
    setNZ(cpu, r)
    cpu.c = cpu.sc
  }
  R[rd] = r
  return 1
}
export function ornS(cpu: CortexM3, rd: number, rn: number, rm: number, d: number): number {
  const R = cpu.r
  const r = R[rn] | ~shOperand(cpu, R[rm], d)
  if (sf(cpu, d & 3)) {
    setNZ(cpu, r)
    cpu.c = cpu.sc
  }
  R[rd] = r
  return 1
}
export function bicS(cpu: CortexM3, rd: number, rn: number, rm: number, d: number): number {
  const R = cpu.r
  const r = R[rn] & ~shOperand(cpu, R[rm], d)
  if (sf(cpu, d & 3)) {
    setNZ(cpu, r)
    cpu.c = cpu.sc
  }
  R[rd] = r
  return 1
}
/** MOV with shift = the LSL/LSR/ASR/ROR/RRX (immediate) instructions */
export function movS(cpu: CortexM3, rd: number, _rn: number, rm: number, d: number): number {
  const R = cpu.r
  const r = shOperand(cpu, R[rm], d)
  if (sf(cpu, d & 3)) {
    setNZ(cpu, r)
    cpu.c = cpu.sc
  }
  R[rd] = r
  return 1
}
export function mvnS(cpu: CortexM3, rd: number, _rn: number, rm: number, d: number): number {
  const R = cpu.r
  const r = ~shOperand(cpu, R[rm], d)
  if (sf(cpu, d & 3)) {
    setNZ(cpu, r)
    cpu.c = cpu.sc
  }
  R[rd] = r
  return 1
}
export function tstS(cpu: CortexM3, _rd: number, rn: number, rm: number, d: number): number {
  const R = cpu.r
  setNZ(cpu, R[rn] & shOperand(cpu, R[rm], d))
  cpu.c = cpu.sc
  return 1
}
export function teqS(cpu: CortexM3, _rd: number, rn: number, rm: number, d: number): number {
  const R = cpu.r
  setNZ(cpu, R[rn] ^ shOperand(cpu, R[rm], d))
  cpu.c = cpu.sc
  return 1
}
export function addS(cpu: CortexM3, rd: number, rn: number, rm: number, d: number): number {
  const R = cpu.r
  const y = shOperand(cpu, R[rm], d)
  R[rd] = sf(cpu, d & 3) ? addFlags(cpu, R[rn], y, 0) : R[rn] + y
  return 1
}
export function adcS(cpu: CortexM3, rd: number, rn: number, rm: number, d: number): number {
  const R = cpu.r
  const y = shOperand(cpu, R[rm], d)
  R[rd] = sf(cpu, d & 3) ? addFlags(cpu, R[rn], y, cpu.c) : R[rn] + y + cpu.c
  return 1
}
export function subS(cpu: CortexM3, rd: number, rn: number, rm: number, d: number): number {
  const R = cpu.r
  const y = shOperand(cpu, R[rm], d)
  R[rd] = sf(cpu, d & 3) ? addFlags(cpu, R[rn], ~y, 1) : R[rn] - y
  return 1
}
export function sbcS(cpu: CortexM3, rd: number, rn: number, rm: number, d: number): number {
  const R = cpu.r
  const y = shOperand(cpu, R[rm], d)
  R[rd] = sf(cpu, d & 3) ? addFlags(cpu, R[rn], ~y, cpu.c) : R[rn] + ~y + cpu.c
  return 1
}
export function rsbS(cpu: CortexM3, rd: number, rn: number, rm: number, d: number): number {
  const R = cpu.r
  const y = shOperand(cpu, R[rm], d)
  R[rd] = sf(cpu, d & 3) ? addFlags(cpu, ~R[rn], y, 1) : y - R[rn]
  return 1
}
export function cmpS(cpu: CortexM3, _rd: number, rn: number, rm: number, d: number): number {
  const R = cpu.r
  addFlags(cpu, R[rn], ~shOperand(cpu, R[rm], d), 1)
  return 1
}
export function cmnS(cpu: CortexM3, _rd: number, rn: number, rm: number, d: number): number {
  const R = cpu.r
  addFlags(cpu, R[rn], shOperand(cpu, R[rm], d), 0)
  return 1
}

// ---------------------------- writes to SP: SP[1:0] are RAZ/WI (B1.4.1; Cortex-M3 TRM §2.3.2)

/** MOV.W SP, Rm */
export function movSpR(cpu: CortexM3, _rd: number, _rn: number, rm: number): number {
  const R = cpu.r
  R[13] = R[rm] & ~3
  return 1
}
/** ADD{S}.W SP, SP, Rm{, LSL #n} (a=13 b=13 c=rm d=s|type<<2|amt<<5) */
export function addSpS(cpu: CortexM3, rd: number, rn: number, rm: number, d: number): number {
  addS(cpu, rd, rn, rm, d)
  cpu.r[13] &= ~3
  return 1
}
/** SUB{S}.W SP, SP, Rm{, LSL #n} */
export function subSpS(cpu: CortexM3, rd: number, rn: number, rm: number, d: number): number {
  subS(cpu, rd, rn, rm, d)
  cpu.r[13] &= ~3
  return 1
}

// --------------- data processing: immediate (a=rd b=rn c=imm32 d=s|carry<<2)
// carry field (ThumbExpandImm_C): 0 = unchanged, 2 = C:=0, 3 = C:=1 → d bit3 = defined, bit2 = value

export function andI(cpu: CortexM3, rd: number, rn: number, imm: number, d: number): number {
  const R = cpu.r
  const r = R[rn] & imm
  if (d !== 0 && sf(cpu, d & 3)) {
    setNZ(cpu, r)
    if (d & 8) cpu.c = (d >> 2) & 1
  }
  R[rd] = r
  return 1
}
export function eorI(cpu: CortexM3, rd: number, rn: number, imm: number, d: number): number {
  const R = cpu.r
  const r = R[rn] ^ imm
  if (d !== 0 && sf(cpu, d & 3)) {
    setNZ(cpu, r)
    if (d & 8) cpu.c = (d >> 2) & 1
  }
  R[rd] = r
  return 1
}
export function orrI(cpu: CortexM3, rd: number, rn: number, imm: number, d: number): number {
  const R = cpu.r
  const r = R[rn] | imm
  if (d !== 0 && sf(cpu, d & 3)) {
    setNZ(cpu, r)
    if (d & 8) cpu.c = (d >> 2) & 1
  }
  R[rd] = r
  return 1
}
export function ornI(cpu: CortexM3, rd: number, rn: number, imm: number, d: number): number {
  const R = cpu.r
  const r = R[rn] | ~imm
  if (d !== 0 && sf(cpu, d & 3)) {
    setNZ(cpu, r)
    if (d & 8) cpu.c = (d >> 2) & 1
  }
  R[rd] = r
  return 1
}
export function bicI(cpu: CortexM3, rd: number, rn: number, imm: number, d: number): number {
  const R = cpu.r
  const r = R[rn] & ~imm
  if (d !== 0 && sf(cpu, d & 3)) {
    setNZ(cpu, r)
    if (d & 8) cpu.c = (d >> 2) & 1
  }
  R[rd] = r
  return 1
}
/** MOV/MOVS/MOVW immediate and ADR (address folded at decode) */
export function movI(cpu: CortexM3, rd: number, _rn: number, imm: number, d: number): number {
  if (d !== 0 && sf(cpu, d & 3)) {
    setNZ(cpu, imm)
    if (d & 8) cpu.c = (d >> 2) & 1
  }
  cpu.r[rd] = imm
  return 1
}
export function mvnI(cpu: CortexM3, rd: number, _rn: number, imm: number, d: number): number {
  const r = ~imm
  if (d !== 0 && sf(cpu, d & 3)) {
    setNZ(cpu, r)
    if (d & 8) cpu.c = (d >> 2) & 1
  }
  cpu.r[rd] = r
  return 1
}
export function tstI(cpu: CortexM3, _rd: number, rn: number, imm: number, d: number): number {
  setNZ(cpu, cpu.r[rn] & imm)
  if (d & 8) cpu.c = (d >> 2) & 1
  return 1
}
export function teqI(cpu: CortexM3, _rd: number, rn: number, imm: number, d: number): number {
  setNZ(cpu, cpu.r[rn] ^ imm)
  if (d & 8) cpu.c = (d >> 2) & 1
  return 1
}
export function addI(cpu: CortexM3, rd: number, rn: number, imm: number, d: number): number {
  const R = cpu.r
  R[rd] = d !== 0 && sf(cpu, d & 3) ? addFlags(cpu, R[rn], imm, 0) : R[rn] + imm
  return 1
}
export function adcI(cpu: CortexM3, rd: number, rn: number, imm: number, d: number): number {
  const R = cpu.r
  R[rd] = d !== 0 && sf(cpu, d & 3) ? addFlags(cpu, R[rn], imm, cpu.c) : R[rn] + imm + cpu.c
  return 1
}
export function subI(cpu: CortexM3, rd: number, rn: number, imm: number, d: number): number {
  const R = cpu.r
  R[rd] = d !== 0 && sf(cpu, d & 3) ? addFlags(cpu, R[rn], ~imm, 1) : R[rn] - imm
  return 1
}
export function sbcI(cpu: CortexM3, rd: number, rn: number, imm: number, d: number): number {
  const R = cpu.r
  R[rd] = d !== 0 && sf(cpu, d & 3) ? addFlags(cpu, R[rn], ~imm, cpu.c) : R[rn] + ~imm + cpu.c
  return 1
}
export function rsbI(cpu: CortexM3, rd: number, rn: number, imm: number, d: number): number {
  const R = cpu.r
  R[rd] = d !== 0 && sf(cpu, d & 3) ? addFlags(cpu, ~R[rn], imm, 1) : imm - R[rn]
  return 1
}
export function cmpI(cpu: CortexM3, _rd: number, rn: number, imm: number): number {
  addFlags(cpu, cpu.r[rn], ~imm, 1)
  return 1
}
export function cmnI(cpu: CortexM3, _rd: number, rn: number, imm: number): number {
  addFlags(cpu, cpu.r[rn], imm, 0)
  return 1
}
/** ADD/SUB SP, SP, #imm and ADD Rd, SP, #imm with Rd = SP: SP[1:0] are RAZ/WI */
export function addSpI(cpu: CortexM3, rd: number, rn: number, imm: number, d: number): number {
  const R = cpu.r
  const r = d !== 0 && sf(cpu, d & 3) ? addFlags(cpu, R[rn], imm, 0) : R[rn] + imm
  R[rd] = r & ~3
  return 1
}
export function subSpI(cpu: CortexM3, rd: number, rn: number, imm: number, d: number): number {
  const R = cpu.r
  const r = d !== 0 && sf(cpu, d & 3) ? addFlags(cpu, R[rn], ~imm, 1) : R[rn] - imm
  R[rd] = r & ~3
  return 1
}

// ---------------------------------- register-controlled shifts (a=rd b=rn c=rm d=s)

export function lslRR(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  const r = shiftC(cpu, R[rn], 0, R[rm] & 255)
  if (s !== 0 && sf(cpu, s)) {
    setNZ(cpu, r)
    cpu.c = cpu.sc
  }
  R[rd] = r
  return 1
}
export function lsrRR(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  const r = shiftC(cpu, R[rn], 1, R[rm] & 255)
  if (s !== 0 && sf(cpu, s)) {
    setNZ(cpu, r)
    cpu.c = cpu.sc
  }
  R[rd] = r
  return 1
}
export function asrRR(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  const r = shiftC(cpu, R[rn], 2, R[rm] & 255)
  if (s !== 0 && sf(cpu, s)) {
    setNZ(cpu, r)
    cpu.c = cpu.sc
  }
  R[rd] = r
  return 1
}
export function rorRR(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  const r = shiftC(cpu, R[rn], 3, R[rm] & 255)
  if (s !== 0 && sf(cpu, s)) {
    setNZ(cpu, r)
    cpu.c = cpu.sc
  }
  R[rd] = r
  return 1
}

// ------------------------------------------ 16-bit high-register forms (A5.2.3)

/** ADD Rdn, Rm (T2) — either operand may be SP or PC; Rd = PC branches (ALUWritePC) */
export function addHi(cpu: CortexM3, rdn: number, rm: number, _c: number, _d: number, pc: number): number {
  const R = cpu.r
  const x = rdn === 15 ? pc + 4 : R[rdn]
  const y = rm === 15 ? pc + 4 : R[rm]
  const r = (x + y) | 0
  if (rdn === 15) {
    R[15] = r & ~1
    return 1 + P
  }
  R[rdn] = rdn === 13 ? r & ~3 : r
  return 1
}
/** MOV Rd, Rm (T1) */
export function movHi(cpu: CortexM3, rd: number, rm: number, _c: number, _d: number, pc: number): number {
  const R = cpu.r
  const r = rm === 15 ? pc + 4 : R[rm]
  if (rd === 15) {
    R[15] = r & ~1
    return 1 + P
  }
  R[rd] = rd === 13 ? r & ~3 : r
  return 1
}
/** CMP Rn, Rm (T2) */
export function cmpHi(cpu: CortexM3, rn: number, rm: number, _c: number, _d: number, pc: number): number {
  const R = cpu.r
  const x = rn === 15 ? pc + 4 : R[rn]
  const y = rm === 15 ? pc + 4 : R[rm]
  addFlags(cpu, x, ~y, 1)
  return 1
}

// ----------------------------------------------------------- multiply / divide

/** MUL/MULS (a=rd b=rn c=rm d=s): MULS sets N,Z only (C, V unchanged on ARMv7-M) */
export function mul(cpu: CortexM3, rd: number, rn: number, rm: number, s: number): number {
  const R = cpu.r
  const r = Math.imul(R[rn], R[rm])
  if (s !== 0 && sf(cpu, s)) setNZ(cpu, r)
  R[rd] = r
  return 1
}
export function mla(cpu: CortexM3, rd: number, rn: number, rm: number, ra: number): number {
  const R = cpu.r
  R[rd] = Math.imul(R[rn], R[rm]) + R[ra]
  return 2
}
export function mls(cpu: CortexM3, rd: number, rn: number, rm: number, ra: number): number {
  const R = cpu.r
  R[rd] = R[ra] - Math.imul(R[rn], R[rm])
  return 2
}

/** 32x32 → 64 multiply into cpu.lo / cpu.hi (exact, via 16-bit limbs). */
function mul64(cpu: CortexM3, x: number, y: number, signed: boolean): void {
  const xl = x & 0xffff
  const xh = x >>> 16
  const yl = y & 0xffff
  const yh = y >>> 16
  const ll = xl * yl
  const lh = xl * yh
  const hl = xh * yl
  const mid = (ll >>> 16) + (lh & 0xffff) + (hl & 0xffff)
  cpu.lo = (mid << 16) | (ll & 0xffff)
  let hi = xh * yh + (lh >>> 16) + (hl >>> 16) + Math.floor(mid / 65536)
  // two's-complement correction: x_s*y_s = x_u*y_u - 2^32*(x<0 ? y_u : 0) - 2^32*(y<0 ? x_u : 0)
  if (signed) {
    if (x < 0) hi -= y >>> 0
    if (y < 0) hi -= x >>> 0
  }
  cpu.hi = hi | 0
}

function longMulCycles(x: number, y: number, signed: boolean): number {
  // early termination when an operand's upper halfword is a pure sign/zero extension
  const bx = signed ? (x >> 15 === 0 || x >> 15 === -1 ? 0 : 1) : x >>> 16 === 0 ? 0 : 1
  const by = signed ? (y >> 15 === 0 || y >> 15 === -1 ? 0 : 1) : y >>> 16 === 0 ? 0 : 1
  return 3 + bx + by
}

/** UMULL/SMULL RdLo, RdHi, Rn, Rm (a=rdlo b=rdhi c=rn d=rm) */
export function umull(cpu: CortexM3, lo: number, hi: number, rn: number, rm: number): number {
  const R = cpu.r
  const x = R[rn]
  const y = R[rm]
  mul64(cpu, x, y, false)
  R[lo] = cpu.lo
  R[hi] = cpu.hi
  return longMulCycles(x, y, false)
}
export function smull(cpu: CortexM3, lo: number, hi: number, rn: number, rm: number): number {
  const R = cpu.r
  const x = R[rn]
  const y = R[rm]
  mul64(cpu, x, y, true)
  R[lo] = cpu.lo
  R[hi] = cpu.hi
  return longMulCycles(x, y, true)
}
function accumulate64(cpu: CortexM3, lo: number, hi: number): void {
  const R = cpu.r
  const sumLo = (cpu.lo >>> 0) + (R[lo] >>> 0)
  const carry = sumLo > 0xffffffff ? 1 : 0
  const nhi = (cpu.hi + R[hi] + carry) | 0
  R[lo] = sumLo | 0
  R[hi] = nhi
}
/** UMLAL/SMLAL: one cycle more than the plain long multiply (TRM 4..7 vs 3..5) */
export function umlal(cpu: CortexM3, lo: number, hi: number, rn: number, rm: number): number {
  const R = cpu.r
  const x = R[rn]
  const y = R[rm]
  mul64(cpu, x, y, false)
  accumulate64(cpu, lo, hi)
  return 1 + longMulCycles(x, y, false)
}
export function smlal(cpu: CortexM3, lo: number, hi: number, rn: number, rm: number): number {
  const R = cpu.r
  const x = R[rn]
  const y = R[rm]
  mul64(cpu, x, y, true)
  accumulate64(cpu, lo, hi)
  return 1 + longMulCycles(x, y, true)
}

function divCycles(q: number): number {
  const bits = 32 - Math.clz32(q)
  return 2 + ((bits * 5 + 15) >> 4)
}

/** SDIV/UDIV (a=rd b=rn c=rm): x/0 = 0 unless CCR.DIV_0_TRP (→ UsageFault DIVBYZERO) */
export function sdiv(cpu: CortexM3, rd: number, rn: number, rm: number): number {
  const R = cpu.r
  const y = R[rm]
  if (y === 0) {
    if (cpu.divZeroTrap()) cpu.usageFault(UFSR_DIVBYZERO)
    R[rd] = 0
    return 2
  }
  // |q| < 2^31 except INT_MIN / -1, which wraps back to INT_MIN through `| 0`
  const q = (R[rn] / y) | 0
  R[rd] = q
  return divCycles(q < 0 ? -q : q)
}
export function udiv(cpu: CortexM3, rd: number, rn: number, rm: number): number {
  const R = cpu.r
  const y = R[rm] >>> 0
  if (y === 0) {
    if (cpu.divZeroTrap()) cpu.usageFault(UFSR_DIVBYZERO)
    R[rd] = 0
    return 2
  }
  const q = ((R[rn] >>> 0) / y) >>> 0
  R[rd] = q
  return divCycles(q)
}

// ------------------------------------------------- bit field / extend / misc

/** BFI Rd, Rn, #lsb, #width (a=rd b=rn c=lsb d=msb) */
export function bfi(cpu: CortexM3, rd: number, rn: number, lsb: number, msb: number): number {
  const R = cpu.r
  const m = (-1 >>> (31 - (msb - lsb))) << lsb
  R[rd] = (R[rd] & ~m) | ((R[rn] << lsb) & m)
  return 1
}
export function bfc(cpu: CortexM3, rd: number, _rn: number, lsb: number, msb: number): number {
  const m = (-1 >>> (31 - (msb - lsb))) << lsb
  cpu.r[rd] &= ~m
  return 1
}
/** UBFX/SBFX (a=rd b=rn c=lsb d=width-1) */
export function ubfx(cpu: CortexM3, rd: number, rn: number, lsb: number, wm1: number): number {
  const R = cpu.r
  R[rd] = (R[rn] >>> lsb) & (-1 >>> (31 - wm1))
  return 1
}
export function sbfx(cpu: CortexM3, rd: number, rn: number, lsb: number, wm1: number): number {
  const R = cpu.r
  const msb = lsb + wm1
  R[rd] = (R[rn] << (31 - msb)) >> (31 - wm1)
  return 1
}

/** SSAT Rd, #n, Rn{, shift} (a=rd b=rn c=n (1..32) d=type<<5|amt; type 0 LSL, 2 ASR) */
export function ssat(cpu: CortexM3, rd: number, rn: number, n: number, d: number): number {
  const R = cpu.r
  const x = (d >> 5) === 2 ? R[rn] >> (d & 31) : R[rn] << (d & 31)
  const max = 2 ** (n - 1) - 1
  const min = -(2 ** (n - 1))
  let r = x
  if (x > max) {
    r = max
    cpu.q = 1
  } else if (x < min) {
    r = min
    cpu.q = 1
  }
  R[rd] = r
  return 1
}
/** USAT Rd, #n, Rn{, shift} (c = n 0..31) */
export function usat(cpu: CortexM3, rd: number, rn: number, n: number, d: number): number {
  const R = cpu.r
  const x = (d >> 5) === 2 ? R[rn] >> (d & 31) : R[rn] << (d & 31)
  const max = 2 ** n - 1
  let r = x
  if (x > max) {
    r = max
    cpu.q = 1
  } else if (x < 0) {
    r = 0
    cpu.q = 1
  }
  R[rd] = r
  return 1
}

/** SXTB/SXTH/UXTB/UXTH Rd, Rm{, ROR #rot} (a=rd b=rm c=rot) */
export function sxtb(cpu: CortexM3, rd: number, rm: number, rot: number): number {
  const R = cpu.r
  const x = R[rm]
  const v = rot === 0 ? x : (x >>> rot) | (x << (32 - rot))
  R[rd] = (v << 24) >> 24
  return 1
}
export function sxth(cpu: CortexM3, rd: number, rm: number, rot: number): number {
  const R = cpu.r
  const x = R[rm]
  const v = rot === 0 ? x : (x >>> rot) | (x << (32 - rot))
  R[rd] = (v << 16) >> 16
  return 1
}
export function uxtb(cpu: CortexM3, rd: number, rm: number, rot: number): number {
  const R = cpu.r
  const x = R[rm]
  const v = rot === 0 ? x : (x >>> rot) | (x << (32 - rot))
  R[rd] = v & 0xff
  return 1
}
export function uxth(cpu: CortexM3, rd: number, rm: number, rot: number): number {
  const R = cpu.r
  const x = R[rm]
  const v = rot === 0 ? x : (x >>> rot) | (x << (32 - rot))
  R[rd] = v & 0xffff
  return 1
}

/** REV/REV16/REVSH/RBIT/CLZ (a=rd b=rm) */
export function rev(cpu: CortexM3, rd: number, rm: number): number {
  const R = cpu.r
  const x = R[rm]
  R[rd] = (x >>> 24) | ((x >> 8) & 0xff00) | ((x << 8) & 0xff0000) | (x << 24)
  return 1
}
export function rev16(cpu: CortexM3, rd: number, rm: number): number {
  const R = cpu.r
  const x = R[rm]
  R[rd] = ((x >>> 8) & 0x00ff00ff) | ((x << 8) & 0xff00ff00)
  return 1
}
export function revsh(cpu: CortexM3, rd: number, rm: number): number {
  const R = cpu.r
  const x = R[rm]
  R[rd] = ((x << 24) >> 16) | ((x >>> 8) & 0xff)
  return 1
}
export function rbit(cpu: CortexM3, rd: number, rm: number): number {
  const R = cpu.r
  let x = R[rm]
  x = ((x >>> 1) & 0x55555555) | ((x & 0x55555555) << 1)
  x = ((x >>> 2) & 0x33333333) | ((x & 0x33333333) << 2)
  x = ((x >>> 4) & 0x0f0f0f0f) | ((x & 0x0f0f0f0f) << 4)
  x = ((x >>> 8) & 0x00ff00ff) | ((x & 0x00ff00ff) << 8)
  R[rd] = (x >>> 16) | (x << 16)
  return 1
}
export function clz(cpu: CortexM3, rd: number, rm: number): number {
  const R = cpu.r
  R[rd] = Math.clz32(R[rm])
  return 1
}
/** MOVT Rd, #imm16 (a=rd c=imm16) */
export function movt(cpu: CortexM3, rd: number, _b: number, imm16: number): number {
  const R = cpu.r
  R[rd] = (R[rd] & 0xffff) | (imm16 << 16)
  return 1
}

// ---------------------------------------------------------- loads / stores
// immediate offset (a=rt b=rn c=signed imm): LDR literal = [r17 (zero), #address]

export function ldrI(cpu: CortexM3, rt: number, rn: number, imm: number): number {
  const R = cpu.r
  const v = cpu.ld32((R[rn] + imm) | 0)
  if (rt === 15) return 2 + P + cpu.loadWritePC(v)
  R[rt] = v
  return 2
}
export function ldrbI(cpu: CortexM3, rt: number, rn: number, imm: number): number {
  const R = cpu.r
  R[rt] = cpu.ld8((R[rn] + imm) | 0)
  return 2
}
export function ldrhI(cpu: CortexM3, rt: number, rn: number, imm: number): number {
  const R = cpu.r
  R[rt] = cpu.ld16((R[rn] + imm) | 0)
  return 2
}
export function ldrsbI(cpu: CortexM3, rt: number, rn: number, imm: number): number {
  const R = cpu.r
  R[rt] = (cpu.ld8((R[rn] + imm) | 0) << 24) >> 24
  return 2
}
export function ldrshI(cpu: CortexM3, rt: number, rn: number, imm: number): number {
  const R = cpu.r
  R[rt] = (cpu.ld16((R[rn] + imm) | 0) << 16) >> 16
  return 2
}
export function strI(cpu: CortexM3, rt: number, rn: number, imm: number): number {
  const R = cpu.r
  cpu.st32((R[rn] + imm) | 0, R[rt])
  return 2
}
export function strbI(cpu: CortexM3, rt: number, rn: number, imm: number): number {
  const R = cpu.r
  cpu.st8((R[rn] + imm) | 0, R[rt] & 0xff)
  return 2
}
export function strhI(cpu: CortexM3, rt: number, rn: number, imm: number): number {
  const R = cpu.r
  cpu.st16((R[rn] + imm) | 0, R[rt] & 0xffff)
  return 2
}

// register offset (a=rt b=rn c=rm d=lsl amount)

export function ldrR(cpu: CortexM3, rt: number, rn: number, rm: number, sh: number): number {
  const R = cpu.r
  const v = cpu.ld32((R[rn] + (R[rm] << sh)) | 0)
  if (rt === 15) return 2 + P + cpu.loadWritePC(v)
  R[rt] = v
  return 2
}
export function ldrbR(cpu: CortexM3, rt: number, rn: number, rm: number, sh: number): number {
  const R = cpu.r
  R[rt] = cpu.ld8((R[rn] + (R[rm] << sh)) | 0)
  return 2
}
export function ldrhR(cpu: CortexM3, rt: number, rn: number, rm: number, sh: number): number {
  const R = cpu.r
  R[rt] = cpu.ld16((R[rn] + (R[rm] << sh)) | 0)
  return 2
}
export function ldrsbR(cpu: CortexM3, rt: number, rn: number, rm: number, sh: number): number {
  const R = cpu.r
  R[rt] = (cpu.ld8((R[rn] + (R[rm] << sh)) | 0) << 24) >> 24
  return 2
}
export function ldrshR(cpu: CortexM3, rt: number, rn: number, rm: number, sh: number): number {
  const R = cpu.r
  R[rt] = (cpu.ld16((R[rn] + (R[rm] << sh)) | 0) << 16) >> 16
  return 2
}
export function strR(cpu: CortexM3, rt: number, rn: number, rm: number, sh: number): number {
  const R = cpu.r
  cpu.st32((R[rn] + (R[rm] << sh)) | 0, R[rt])
  return 2
}
export function strbR(cpu: CortexM3, rt: number, rn: number, rm: number, sh: number): number {
  const R = cpu.r
  cpu.st8((R[rn] + (R[rm] << sh)) | 0, R[rt] & 0xff)
  return 2
}
export function strhR(cpu: CortexM3, rt: number, rn: number, rm: number, sh: number): number {
  const R = cpu.r
  cpu.st16((R[rn] + (R[rm] << sh)) | 0, R[rt] & 0xffff)
  return 2
}

// pre/post-indexed with writeback (a=rt b=rn c=signed imm d=1 pre-index, 2 post-index).
// The access happens before the base write-back so a faulting access leaves Rn intact.

export function ldrX(cpu: CortexM3, rt: number, rn: number, imm: number, mode: number): number {
  const R = cpu.r
  const base = R[rn]
  const off = (base + imm) | 0
  const v = cpu.ld32(mode === 1 ? off : base)
  R[rn] = off
  if (rt === 15) return 2 + P + cpu.loadWritePC(v)
  R[rt] = v
  return 2
}
export function ldrbX(cpu: CortexM3, rt: number, rn: number, imm: number, mode: number): number {
  const R = cpu.r
  const base = R[rn]
  const off = (base + imm) | 0
  const v = cpu.ld8(mode === 1 ? off : base)
  R[rn] = off
  R[rt] = v
  return 2
}
export function ldrhX(cpu: CortexM3, rt: number, rn: number, imm: number, mode: number): number {
  const R = cpu.r
  const base = R[rn]
  const off = (base + imm) | 0
  const v = cpu.ld16(mode === 1 ? off : base)
  R[rn] = off
  R[rt] = v
  return 2
}
export function ldrsbX(cpu: CortexM3, rt: number, rn: number, imm: number, mode: number): number {
  const R = cpu.r
  const base = R[rn]
  const off = (base + imm) | 0
  const v = cpu.ld8(mode === 1 ? off : base)
  R[rn] = off
  R[rt] = (v << 24) >> 24
  return 2
}
export function ldrshX(cpu: CortexM3, rt: number, rn: number, imm: number, mode: number): number {
  const R = cpu.r
  const base = R[rn]
  const off = (base + imm) | 0
  const v = cpu.ld16(mode === 1 ? off : base)
  R[rn] = off
  R[rt] = (v << 16) >> 16
  return 2
}
export function strX(cpu: CortexM3, rt: number, rn: number, imm: number, mode: number): number {
  const R = cpu.r
  const base = R[rn]
  const off = (base + imm) | 0
  cpu.st32(mode === 1 ? off : base, R[rt])
  R[rn] = off
  return 2
}
export function strbX(cpu: CortexM3, rt: number, rn: number, imm: number, mode: number): number {
  const R = cpu.r
  const base = R[rn]
  const off = (base + imm) | 0
  cpu.st8(mode === 1 ? off : base, R[rt] & 0xff)
  R[rn] = off
  return 2
}
export function strhX(cpu: CortexM3, rt: number, rn: number, imm: number, mode: number): number {
  const R = cpu.r
  const base = R[rn]
  const off = (base + imm) | 0
  cpu.st16(mode === 1 ? off : base, R[rt] & 0xffff)
  R[rn] = off
  return 2
}

/** LDR SP, [Rn, #imm] / LDR SP, [Rn, Rm{, LSL #n}] / LDR SP, literal: SP[1:0] are RAZ/WI */
export function ldrISp(cpu: CortexM3, rt: number, rn: number, imm: number): number {
  const c = ldrI(cpu, rt, rn, imm)
  cpu.r[13] &= ~3
  return c
}
export function ldrRSp(cpu: CortexM3, rt: number, rn: number, rm: number, sh: number): number {
  const c = ldrR(cpu, rt, rn, rm, sh)
  cpu.r[13] &= ~3
  return c
}

const WB_HANDLERS: Handler[] = [ldrX, ldrbX, ldrhX, ldrsbX, ldrshX, strX, strbX, strhX]

/**
 * A pre/post-indexed load/store that writes SP (Rt = SP, or base SP with an
 * offset that is not a multiple of 4): d = mode | handler index << 2
 * (index into ldrX ldrbX ldrhX ldrsbX ldrshX strX strbX strhX).
 */
export function wbSp(cpu: CortexM3, rt: number, rn: number, imm: number, d: number): number {
  const c = WB_HANDLERS[d >> 2](cpu, rt, rn, imm, d & 3, 0)
  cpu.r[13] &= ~3
  return c
}

/**
 * LDRT/LDRBT/LDRHT/LDRSBT/LDRSHT/STRT/STRBT/STRHT (a=rt b=rn c=imm8 d=kind):
 * the access is performed with unprivileged permissions (A7.7.xx "T" forms).
 * kind: 0 LDRT 1 LDRBT 2 LDRHT 3 LDRSBT 4 LDRSHT 5 STRT 6 STRBT 7 STRHT
 */
export function ldstT(cpu: CortexM3, rt: number, rn: number, imm: number, kind: number): number {
  const R = cpu.r
  const addr = (R[rn] + imm) | 0
  cpu.unpriv = 1
  try {
    switch (kind) {
      case 0:
        R[rt] = cpu.ld32(addr)
        break
      case 1:
        R[rt] = cpu.ld8(addr)
        break
      case 2:
        R[rt] = cpu.ld16(addr)
        break
      case 3:
        R[rt] = (cpu.ld8(addr) << 24) >> 24
        break
      case 4:
        R[rt] = (cpu.ld16(addr) << 16) >> 16
        break
      case 5:
        cpu.st32(addr, R[rt])
        break
      case 6:
        cpu.st8(addr, R[rt] & 0xff)
        break
      default:
        cpu.st16(addr, R[rt] & 0xffff)
    }
  } finally {
    cpu.unpriv = 0
  }
  return 2
}

/** LDRD/STRD (a=rt b=rn c=signed imm d=rt2 | mode<<4; mode 0 offset, 1 pre-index wb, 2 post-index) */
export function ldrd(cpu: CortexM3, rt: number, rn: number, imm: number, d: number): number {
  const R = cpu.r
  const base = R[rn]
  const off = (base + imm) | 0
  const mode = d >> 4
  const addr = mode === 2 ? base : off
  if (addr & 3) cpu.usageFault(UFSR_UNALIGNED)
  const v1 = cpu.ld32(addr)
  const v2 = cpu.ld32((addr + 4) | 0)
  if (mode !== 0) R[rn] = off
  R[rt] = v1
  R[d & 15] = v2
  return 3
}
export function strd(cpu: CortexM3, rt: number, rn: number, imm: number, d: number): number {
  const R = cpu.r
  const base = R[rn]
  const off = (base + imm) | 0
  const mode = d >> 4
  const addr = mode === 2 ? base : off
  if (addr & 3) cpu.usageFault(UFSR_UNALIGNED)
  cpu.st32(addr, R[rt])
  cpu.st32((addr + 4) | 0, R[d & 15])
  if (mode !== 0) R[rn] = off
  return 3
}

/**
 * LDM/LDMIA/POP (a=rn b=register list c=writeback). All words are read
 * before any register is written so a BusFault mid-transfer leaves the
 * register file (and base) unchanged, as the ARM ARM requires of an
 * abandoned LDM. Unaligned base → UsageFault UNALIGNED regardless of
 * CCR.UNALIGN_TRP.
 */
export function ldm(cpu: CortexM3, rn: number, list: number, wb: number): number {
  const R = cpu.r
  const tmp = cpu.tmp
  let addr = R[rn]
  if (addr & 3) cpu.usageFault(UFSR_UNALIGNED)
  let l = list
  let n = 0
  while (l !== 0) {
    const i = 31 - Math.clz32(l & -l)
    tmp[i] = cpu.ld32(addr)
    addr = (addr + 4) | 0
    l &= l - 1
    n++
  }
  if (wb !== 0) R[rn] = addr
  l = list & 0x7fff
  while (l !== 0) {
    const i = 31 - Math.clz32(l & -l)
    R[i] = tmp[i]
    l &= l - 1
  }
  if (list & 0x8000) return 1 + n + P + cpu.loadWritePC(tmp[15])
  return 1 + n
}
/** LDMDB (a=rn b=list c=writeback) */
export function ldmdb(cpu: CortexM3, rn: number, list: number, wb: number): number {
  const R = cpu.r
  const tmp = cpu.tmp
  const n = popcount(list)
  const start = (R[rn] - 4 * n) | 0
  if (start & 3) cpu.usageFault(UFSR_UNALIGNED)
  let addr = start
  let l = list
  while (l !== 0) {
    const i = 31 - Math.clz32(l & -l)
    tmp[i] = cpu.ld32(addr)
    addr = (addr + 4) | 0
    l &= l - 1
  }
  if (wb !== 0) R[rn] = start
  l = list & 0x7fff
  while (l !== 0) {
    const i = 31 - Math.clz32(l & -l)
    R[i] = tmp[i]
    l &= l - 1
  }
  if (list & 0x8000) return 1 + n + P + cpu.loadWritePC(tmp[15])
  return 1 + n
}
/** STM/STMIA (a=rn b=list c=writeback) */
export function stm(cpu: CortexM3, rn: number, list: number, wb: number): number {
  const R = cpu.r
  let addr = R[rn]
  if (addr & 3) cpu.usageFault(UFSR_UNALIGNED)
  let l = list
  let n = 0
  while (l !== 0) {
    const i = 31 - Math.clz32(l & -l)
    cpu.st32(addr, R[i])
    addr = (addr + 4) | 0
    l &= l - 1
    n++
  }
  if (wb !== 0) R[rn] = addr
  return 1 + n
}
/** STMDB/PUSH (a=rn b=list c=writeback) */
export function stmdb(cpu: CortexM3, rn: number, list: number, wb: number): number {
  const R = cpu.r
  const n = popcount(list)
  const start = (R[rn] - 4 * n) | 0
  if (start & 3) cpu.usageFault(UFSR_UNALIGNED)
  let addr = start
  let l = list
  while (l !== 0) {
    const i = 31 - Math.clz32(l & -l)
    cpu.st32(addr, R[i])
    addr = (addr + 4) | 0
    l &= l - 1
  }
  if (wb !== 0) R[rn] = start
  return 1 + n
}

function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  x = (x + (x >>> 4)) & 0x0f0f0f0f
  return Math.imul(x, 0x01010101) >>> 24
}

// ------------------------------------------------------ exclusive accesses
// Local exclusive monitor (A3.4.1): LDREX* opens it, STREX* succeeds only if
// open and always closes it; CLREX, exception entry and exception return
// close it. Like the Cortex-M3's single-state local monitor the address is
// not compared (IMPLEMENTATION DEFINED in A3.4.1).

/** LDREX Rt, [Rn, #imm] (a=rt b=rn c=imm) */
export function ldrex(cpu: CortexM3, rt: number, rn: number, imm: number): number {
  const R = cpu.r
  const addr = (R[rn] + imm) | 0
  if (addr & 3) cpu.usageFault(UFSR_UNALIGNED)
  const v = cpu.ld32(addr)
  cpu.exclusive = 1
  R[rt] = v
  return 2
}
export function ldrexb(cpu: CortexM3, rt: number, rn: number): number {
  const R = cpu.r
  const v = cpu.ld8(R[rn])
  cpu.exclusive = 1
  R[rt] = v
  return 2
}
export function ldrexh(cpu: CortexM3, rt: number, rn: number): number {
  const R = cpu.r
  const addr = R[rn]
  if (addr & 1) cpu.usageFault(UFSR_UNALIGNED)
  const v = cpu.ld16(addr)
  cpu.exclusive = 1
  R[rt] = v
  return 2
}
/** STREX Rd, Rt, [Rn, #imm] (a=rd b=rt c=rn d=imm) */
export function strex(cpu: CortexM3, rd: number, rt: number, rn: number, imm: number): number {
  const R = cpu.r
  const addr = (R[rn] + imm) | 0
  if (addr & 3) cpu.usageFault(UFSR_UNALIGNED)
  if (cpu.exclusive !== 0) {
    cpu.st32(addr, R[rt])
    R[rd] = 0
  } else R[rd] = 1
  cpu.exclusive = 0
  return 2
}
export function strexb(cpu: CortexM3, rd: number, rt: number, rn: number): number {
  const R = cpu.r
  if (cpu.exclusive !== 0) {
    cpu.st8(R[rn], R[rt] & 0xff)
    R[rd] = 0
  } else R[rd] = 1
  cpu.exclusive = 0
  return 2
}
export function strexh(cpu: CortexM3, rd: number, rt: number, rn: number): number {
  const R = cpu.r
  const addr = R[rn]
  if (addr & 1) cpu.usageFault(UFSR_UNALIGNED)
  if (cpu.exclusive !== 0) {
    cpu.st16(addr, R[rt] & 0xffff)
    R[rd] = 0
  } else R[rd] = 1
  cpu.exclusive = 0
  return 2
}
export function clrex(cpu: CortexM3): number {
  cpu.exclusive = 0
  return 1
}

// ------------------------------------------------------------------ branches

/** B (a=target) */
export function b(cpu: CortexM3, target: number): number {
  cpu.r[15] = target
  return 1 + P
}
/** B<cond> (a=target b=cond) */
export function bcond(cpu: CortexM3, target: number, cond: number): number {
  if (condPassed(cpu, cond)) {
    cpu.r[15] = target
    return 1 + P
  }
  return 1
}
/** BL (a=target): LR = next instruction | 1 */
export function bl(cpu: CortexM3, target: number): number {
  const R = cpu.r
  R[14] = R[15] | 1
  R[15] = target
  return 1 + P
}
/** BX Rm (a=rm): BXWritePC — interworking + EXC_RETURN in Handler mode */
export function bx(cpu: CortexM3, rm: number, _b: number, _c: number, _d: number, pc: number): number {
  return 1 + P + cpu.bxWritePC(rm === 15 ? pc + 4 : cpu.r[rm])
}
/** BLX Rm (a=rm): BLXWritePC — interworking, no exception return */
export function blx(cpu: CortexM3, rm: number): number {
  const R = cpu.r
  const t = R[rm]
  R[14] = R[15] | 1
  cpu.blxWritePC(t)
  return 1 + P
}
/** CBZ/CBNZ (a=rn b=target) */
export function cbz(cpu: CortexM3, rn: number, target: number): number {
  const R = cpu.r
  if (R[rn] === 0) {
    R[15] = target
    return 1 + P
  }
  return 1
}
export function cbnz(cpu: CortexM3, rn: number, target: number): number {
  const R = cpu.r
  if (R[rn] !== 0) {
    R[15] = target
    return 1 + P
  }
  return 1
}
/** TBB [Rn, Rm] (a=rn b=rm): R[15] already = PC read value (pc + 4) for this 32-bit encoding */
export function tbb(cpu: CortexM3, rn: number, rm: number, _c: number, _d: number, pc: number): number {
  const R = cpu.r
  const off = cpu.ld8((R[rn] + R[rm]) | 0)
  R[15] = (pc + 4 + 2 * off) | 0
  return 2 + P
}
export function tbh(cpu: CortexM3, rn: number, rm: number, _c: number, _d: number, pc: number): number {
  const R = cpu.r
  const off = cpu.ld16((R[rn] + (R[rm] << 1)) | 0)
  R[15] = (pc + 4 + 2 * off) | 0
  return 2 + P
}

// ------------------------------------------------------------ system / hints

/** IT (a = ITSTATE = firstcond:mask) */
export function it(cpu: CortexM3, itstate: number): number {
  cpu.it = itstate
  return 1
}
export function nop(): number {
  return 1
}
/** DSB/DMB/ISB: no write buffer is modeled; ISB re-evaluates pending state */
export function barrier(cpu: CortexM3): number {
  cpu.limit = -1
  return 1
}
export function wfi(cpu: CortexM3): number {
  cpu.waitForInterrupt()
  return 1
}
export function wfe(cpu: CortexM3): number {
  cpu.waitForEvent()
  return 1
}
export function sev(cpu: CortexM3): number {
  cpu.sendEvent()
  return 1
}
/** MSR spec_reg, Rn (a=SYSm b=rn c=mask) */
export function msr(cpu: CortexM3, sysm: number, rn: number, mask: number): number {
  cpu.writeSpecial(sysm, cpu.r[rn], mask)
  return 2
}
/** MRS Rd, spec_reg (a=rd b=SYSm) */
export function mrs(cpu: CortexM3, rd: number, sysm: number): number {
  cpu.r[rd] = cpu.readSpecial(sysm)
  return 2
}
/** CPSIE/CPSID (a = 1 disable / 0 enable, b = I:F bits) */
export function cps(cpu: CortexM3, disable: number, flags: number): number {
  cpu.changeProcessorState(disable, flags)
  return 1
}
/** SVC #imm8 */
export function svc(cpu: CortexM3): number {
  cpu.supervisorCall()
  return 1
}
/** BKPT #imm8 (a=imm) — halting debug: the core halts ON the BKPT */
export function bkpt(cpu: CortexM3, imm: number, _b: number, _c: number, _d: number, pc: number): number {
  cpu.breakpointInstruction(pc, imm)
  return 1
}
/** UDF and every UNDEFINED encoding → UsageFault UNDEFINSTR */
export function undef(cpu: CortexM3): number {
  cpu.usageFault(UFSR_UNDEFINSTR)
  return 1
}
/** coprocessor encodings: no coprocessor exists on Cortex-M3 → UsageFault NOCP */
export function nocp(cpu: CortexM3): number {
  cpu.usageFault(UFSR_NOCP)
  return 1
}
