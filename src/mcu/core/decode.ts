/**
 * Thumb instruction decoder for ARMv7-M without the FP and DSP extensions
 * (Cortex-M3), following the encoding tables of DDI 0403E §A5.2 (16-bit) and
 * §A5.3 (32-bit). Each encoding becomes an exec.ts handler plus four integer
 * fields; everything that can be computed statically is folded here
 * (immediates expanded, PC-relative addresses resolved, shift types decoded),
 * which is why decoded instructions are cached per address (see cpu.ts).
 *
 * ARMv7E-M (DSP) encodings — PKHBT, SXTAB/SXTAH/UXTAB/UXTAH and the *16
 * extends, SSAT16/USAT16, parallel add/subtract, QADD…, SEL, SMLAxy/SMLAD/
 * SMMUL…, SMLALxy/SMLALD, UMAAL — and the FP coprocessor space are UNDEFINED
 * on Cortex-M3 and decode to UsageFault UNDEFINSTR (or NOCP for coprocessor
 * encodings), exactly like the hardware.
 *
 * UNPREDICTABLE encodings are executed following the ARM ARM pseudocode (a
 * destination of PC that the pseudocode does not allow is discarded into the
 * r16 sink) and reported through `unpredictable` so the core can log them
 * once.
 */
import * as X from './exec'
import type { Handler } from './exec'
import { R_SINK, R_ZERO } from './exec'

export interface Decoded {
  fn: Handler
  a: number
  b: number
  c: number
  d: number
  size: 2 | 4
  /** non-null when the encoding is UNPREDICTABLE (still executed per pseudocode) */
  unpredictable: string | null
}

export function newDecoded(): Decoded {
  return { fn: X.undef, a: 0, b: 0, c: 0, d: 0, size: 2, unpredictable: null }
}

/** true when `hw1` is the first halfword of a 32-bit encoding (A5.1) */
export function is32(hw1: number): boolean {
  return hw1 >>> 11 >= 0x1d
}

function set(o: Decoded, fn: Handler, a = 0, b = 0, c = 0, d = 0): void {
  o.fn = fn
  o.a = a
  o.b = b
  o.c = c
  o.d = d
}

function unpred(o: Decoded, why: string): void {
  if (o.unpredictable === null) o.unpredictable = why
}

/** r13 (SP) and r15 (PC) are the registers most encodings forbid (LR is an ordinary register) */
const spPc = (r: number): boolean => r === 13 || r === 15

const signExtend = (v: number, bits: number): number => (v << (32 - bits)) >> (32 - bits)

/** ThumbExpandImm_C (A5.3.2): returns imm32, writes carry mode (0 keep, 2 clear, 3 set) to expCarry */
let expCarry = 0
function thumbExpandImm(imm12: number): number {
  const imm8 = imm12 & 0xff
  if ((imm12 & 0xc00) === 0) {
    expCarry = 0
    switch ((imm12 >> 8) & 3) {
      case 0:
        return imm8
      case 1:
        return (imm8 << 16) | imm8
      case 2:
        return (imm8 << 24) | (imm8 << 8)
      default:
        return (imm8 << 24) | (imm8 << 16) | (imm8 << 8) | imm8
    }
  }
  const unrot = 0x80 | (imm12 & 0x7f)
  const rot = (imm12 >> 7) & 31
  const v = (unrot >>> rot) | (unrot << (32 - rot))
  expCarry = v < 0 ? 3 : 2
  return v | 0
}

/** DecodeImmShift → exec shifted-operand encoding (type<<2 | amount<<5) */
function immShift(type: number, imm5: number): number {
  switch (type) {
    case 0:
      return imm5 << 5
    case 1:
      return (1 << 2) | ((imm5 === 0 ? 32 : imm5) << 5)
    case 2:
      return (2 << 2) | ((imm5 === 0 ? 32 : imm5) << 5)
    default:
      return imm5 === 0 ? (4 << 2) | (1 << 5) : (3 << 2) | (imm5 << 5)
  }
}

// data-processing opcode → handlers, indexed by the 4-bit A5.3.1/A5.3.11 op field
const DP_R: (Handler | null)[] = [X.andR, X.bicR, X.orrR, X.ornR, X.eorR, null, null, null, X.addR, null, X.adcR, X.sbcR, null, X.subR, X.rsbR, null]
const DP_S: (Handler | null)[] = [X.andS, X.bicS, X.orrS, X.ornS, X.eorS, null, null, null, X.addS, null, X.adcS, X.sbcS, null, X.subS, X.rsbS, null]
const DP_I: (Handler | null)[] = [X.andI, X.bicI, X.orrI, X.ornI, X.eorI, null, null, null, X.addI, null, X.adcI, X.sbcI, null, X.subI, X.rsbI, null]
const LOGICAL = 0b0000_0000_0001_1111 // ops 0..4 are logical (carry from shifter / ThumbExpandImm_C)

/**
 * Decode one instruction. `hw2` is only read for 32-bit encodings. `pc` is
 * the instruction's address (needed to fold PC-relative operands).
 */
export function decodeThumb(hw1: number, hw2: number, pc: number, o: Decoded): void {
  o.unpredictable = null
  o.a = o.b = o.c = o.d = 0
  if (is32(hw1)) {
    o.size = 4
    decode32(hw1, hw2, pc, o)
  } else {
    o.size = 2
    decode16(hw1, pc, o)
  }
  // an encoding that turned out UNDEFINED (or NOCP) faults; any UNPREDICTABLE operand
  // noted on the way there is irrelevant and must not be reported
  if (o.fn === X.undef || o.fn === X.nocp) o.unpredictable = null
}

// ======================================================================= 16-bit

function decode16(hw: number, pc: number, o: Decoded): void {
  const op = hw >>> 10
  if (op < 16) {
    // A5.2.1 shift (immediate), add, subtract, move, compare
    const rd = hw & 7
    const rn = (hw >> 3) & 7
    const imm5 = (hw >> 6) & 31
    switch ((hw >> 11) & 7) {
      case 0: // LSL imm (imm5 = 0: MOVS Rd, Rm)
        set(o, X.movS, rd, 0, rn, 2 | immShift(0, imm5))
        return
      case 1:
        set(o, X.movS, rd, 0, rn, 2 | immShift(1, imm5))
        return
      case 2:
        set(o, X.movS, rd, 0, rn, 2 | immShift(2, imm5))
        return
      case 3: {
        const rm = (hw >> 6) & 7
        switch ((hw >> 9) & 3) {
          case 0:
            set(o, X.addR, rd, rn, rm, 2)
            return
          case 1:
            set(o, X.subR, rd, rn, rm, 2)
            return
          case 2:
            set(o, X.addI, rd, rn, rm, 2) // imm3
            return
          default:
            set(o, X.subI, rd, rn, rm, 2)
            return
        }
      }
      case 4:
        set(o, X.movI, (hw >> 8) & 7, 0, hw & 0xff, 2)
        return
      case 5:
        set(o, X.cmpI, 0, (hw >> 8) & 7, hw & 0xff, 1)
        return
      case 6:
        set(o, X.addI, (hw >> 8) & 7, (hw >> 8) & 7, hw & 0xff, 2)
        return
      default:
        set(o, X.subI, (hw >> 8) & 7, (hw >> 8) & 7, hw & 0xff, 2)
        return
    }
  }
  if (op === 16) {
    // A5.2.2 data processing
    const rdn = hw & 7
    const rm = (hw >> 3) & 7
    switch ((hw >> 6) & 15) {
      case 0:
        return set(o, X.andR, rdn, rdn, rm, 2)
      case 1:
        return set(o, X.eorR, rdn, rdn, rm, 2)
      case 2:
        return set(o, X.lslRR, rdn, rdn, rm, 2)
      case 3:
        return set(o, X.lsrRR, rdn, rdn, rm, 2)
      case 4:
        return set(o, X.asrRR, rdn, rdn, rm, 2)
      case 5:
        return set(o, X.adcR, rdn, rdn, rm, 2)
      case 6:
        return set(o, X.sbcR, rdn, rdn, rm, 2)
      case 7:
        return set(o, X.rorRR, rdn, rdn, rm, 2)
      case 8:
        return set(o, X.tstR, 0, rdn, rm, 1)
      case 9: // RSBS Rd, Rn, #0
        return set(o, X.rsbI, rdn, rm, 0, 2)
      case 10:
        return set(o, X.cmpR, 0, rdn, rm, 1)
      case 11:
        return set(o, X.cmnR, 0, rdn, rm, 1)
      case 12:
        return set(o, X.orrR, rdn, rdn, rm, 2)
      case 13: // MULS Rdm, Rn, Rdm
        return set(o, X.mul, rdn, rm, rdn, 2)
      case 14:
        return set(o, X.bicR, rdn, rdn, rm, 2)
      default:
        return set(o, X.mvnR, rdn, 0, rm, 2)
    }
  }
  if (op === 17) {
    // A5.2.3 special data instructions and branch and exchange
    const rm = (hw >> 3) & 15
    const rdn = ((hw >> 4) & 8) | (hw & 7)
    switch ((hw >> 6) & 15) {
      case 0:
      case 1:
      case 2:
      case 3:
        if (rdn === 15 && rm === 15) unpred(o, 'ADD PC, PC')
        return set(o, X.addHi, rdn, rm)
      case 4:
        unpred(o, 'special data opcode 0100')
        return set(o, X.cmpHi, rdn, rm)
      case 5:
      case 6:
      case 7:
        if ((rdn < 8 && rm < 8) || rdn === 15 || rm === 15) unpred(o, 'CMP (high registers) operands')
        return set(o, X.cmpHi, rdn, rm)
      case 8:
      case 9:
      case 10:
      case 11:
        return set(o, X.movHi, rdn, rm)
      case 12:
      case 13:
        if (hw & 7) unpred(o, 'BX with nonzero (0) bits')
        return set(o, X.bx, rm)
      default:
        if (rm === 15) unpred(o, 'BLX PC')
        if (hw & 7) unpred(o, 'BLX with nonzero (0) bits')
        return set(o, X.blx, rm)
    }
  }
  if (op === 18 || op === 19) {
    // LDR (literal): address = Align(PC, 4) + imm8 << 2
    const addr = (((pc + 4) & ~3) + ((hw & 0xff) << 2)) | 0
    return set(o, X.ldrI, (hw >> 8) & 7, R_ZERO, addr)
  }
  if (op < 40) {
    // A5.2.4 load/store single data item
    const rt = hw & 7
    const rn = (hw >> 3) & 7
    const imm5 = (hw >> 6) & 31
    switch (hw >> 12) {
      case 5: {
        const rm = (hw >> 6) & 7
        const h = [X.strR, X.strhR, X.strbR, X.ldrsbR, X.ldrR, X.ldrhR, X.ldrbR, X.ldrshR][(hw >> 9) & 7]
        return set(o, h, rt, rn, rm, 0)
      }
      case 6:
        return set(o, hw & 0x800 ? X.ldrI : X.strI, rt, rn, imm5 << 2)
      case 7:
        return set(o, hw & 0x800 ? X.ldrbI : X.strbI, rt, rn, imm5)
      case 8:
        return set(o, hw & 0x800 ? X.ldrhI : X.strhI, rt, rn, imm5 << 1)
      default:
        // SP-relative
        return set(o, hw & 0x800 ? X.ldrI : X.strI, (hw >> 8) & 7, 13, (hw & 0xff) << 2)
    }
  }
  if (op === 40 || op === 41) {
    // ADR: Align(PC, 4) + imm8 << 2
    const addr = (((pc + 4) & ~3) + ((hw & 0xff) << 2)) | 0
    return set(o, X.movI, (hw >> 8) & 7, 0, addr, 0)
  }
  if (op === 42 || op === 43) {
    // ADD Rd, SP, #imm8 << 2
    return set(o, X.addI, (hw >> 8) & 7, 13, (hw & 0xff) << 2, 0)
  }
  if (op < 48) return decodeMisc16(hw, pc, o)
  if (op === 48 || op === 49) {
    // STM Rn!, {list}
    const rn = (hw >> 8) & 7
    const list = hw & 0xff
    if (list === 0) unpred(o, 'STM with empty register list')
    return set(o, X.stm, rn, list, 1)
  }
  if (op === 50 || op === 51) {
    // LDM Rn{!}, {list}: writeback iff Rn not in the list
    const rn = (hw >> 8) & 7
    const list = hw & 0xff
    if (list === 0) unpred(o, 'LDM with empty register list')
    return set(o, X.ldm, rn, list, list & (1 << rn) ? 0 : 1)
  }
  if (op < 56) {
    // A5.2.6 conditional branch, UDF, SVC
    const cond = (hw >> 8) & 15
    if (cond === 14) return set(o, X.undef) // UDF #imm8: permanently UNDEFINED
    if (cond === 15) return set(o, X.svc, hw & 0xff)
    const target = (pc + 4 + (signExtend(hw & 0xff, 8) << 1)) | 0
    return set(o, X.bcond, target, cond)
  }
  // op 56, 57: B (unconditional, T2)
  const target = (pc + 4 + (signExtend(hw & 0x7ff, 11) << 1)) | 0
  set(o, X.b, target)
}

/** A5.2.5 miscellaneous 16-bit instructions (1011 xxxx xxxx xxxx) */
function decodeMisc16(hw: number, pc: number, o: Decoded): void {
  if ((hw & 0x0500) === 0x0100) {
    // CBZ / CBNZ: imm32 = i:imm5:'0'
    const imm = (((hw >> 9) & 1) << 6) | (((hw >> 3) & 31) << 1)
    return set(o, hw & 0x800 ? X.cbnz : X.cbz, hw & 7, (pc + 4 + imm) | 0)
  }
  const opc = (hw >> 5) & 0x7f
  if ((opc & 0b1111100) === 0) return set(o, X.addSpI, 13, 13, (hw & 0x7f) << 2, 0)
  if ((opc & 0b1111100) === 0b0000100) return set(o, X.subSpI, 13, 13, (hw & 0x7f) << 2, 0)
  if ((opc & 0b1111000) === 0b0010000) {
    const rd = hw & 7
    const rm = (hw >> 3) & 7
    const h = [X.sxth, X.sxtb, X.uxth, X.uxtb][(hw >> 6) & 3]
    return set(o, h, rd, rm, 0)
  }
  if ((opc & 0b1110000) === 0b0100000) {
    // PUSH {list, LR}
    const list = (hw & 0xff) | (hw & 0x100 ? 0x4000 : 0)
    if (list === 0) unpred(o, 'PUSH with empty register list')
    return set(o, X.stmdb, 13, list, 1)
  }
  if ((hw & 0xffe8) === 0xb660) {
    // CPS: im = bit 4, I = bit 1, F = bit 0 (bit 2 is (0): there is no A flag on M profile)
    if ((hw & 3) === 0) unpred(o, 'CPS with no I/F bit')
    if (hw & 4) unpred(o, 'CPS with the (0) A bit set')
    return set(o, X.cps, (hw >> 4) & 1, hw & 3)
  }
  if ((opc & 0b1111110) === 0b1010000) return set(o, X.rev, hw & 7, (hw >> 3) & 7)
  if ((opc & 0b1111110) === 0b1010010) return set(o, X.rev16, hw & 7, (hw >> 3) & 7)
  if ((opc & 0b1111110) === 0b1010110) return set(o, X.revsh, hw & 7, (hw >> 3) & 7)
  if ((opc & 0b1110000) === 0b1100000) {
    // POP {list, PC}
    const list = (hw & 0xff) | (hw & 0x100 ? 0x8000 : 0)
    if (list === 0) unpred(o, 'POP with empty register list')
    return set(o, X.ldm, 13, list, 1)
  }
  if ((opc & 0b1111000) === 0b1110000) return set(o, X.bkpt, hw & 0xff)
  if ((opc & 0b1111000) === 0b1111000) {
    const mask = hw & 15
    if (mask !== 0) {
      // IT: firstcond = 1111 is UNPREDICTABLE, AL with an "else" slot likewise
      const firstcond = (hw >> 4) & 15
      if (firstcond === 15 || (firstcond === 14 && bitCount(mask) !== 1)) unpred(o, 'IT condition')
      return set(o, X.it, hw & 0xff)
    }
    switch ((hw >> 4) & 15) {
      case 0:
        return set(o, X.nop)
      case 1: // YIELD: no other threads to yield to
        return set(o, X.nop)
      case 2:
        return set(o, X.wfe)
      case 3:
        return set(o, X.wfi)
      case 4:
        return set(o, X.sev)
      default: // unallocated hints execute as NOP (A5.2.5)
        return set(o, X.nop)
    }
  }
  set(o, X.undef)
}

function bitCount(x: number): number {
  let n = 0
  for (; x; x &= x - 1) n++
  return n
}

// ======================================================================= 32-bit

function decode32(hw1: number, hw2: number, pc: number, o: Decoded): void {
  const op1 = (hw1 >> 11) & 3
  if (op1 === 1) {
    if ((hw1 & 0xfe40) === 0xe800) return decodeLdmStm(hw1, hw2, o)
    if ((hw1 & 0xfe40) === 0xe840) return decodeDualExclusive(hw1, hw2, pc, o)
    if ((hw1 & 0xfe00) === 0xea00) return decodeDpShifted(hw1, hw2, o)
    return set(o, X.nocp) // 1110 11xx: coprocessor
  }
  if (op1 === 2) {
    if ((hw2 & 0x8000) === 0) {
      if ((hw1 & 0x0200) === 0) return decodeDpModImm(hw1, hw2, o)
      return decodeDpPlainImm(hw1, hw2, pc, o)
    }
    return decodeBranchMisc(hw1, hw2, pc, o)
  }
  // op1 === 3
  if ((hw1 & 0xfe00) === 0xf800) return decodeLoadStore(hw1, hw2, pc, o)
  if ((hw1 & 0xff00) === 0xfa00) return decodeDpRegister(hw1, hw2, o)
  if ((hw1 & 0xff80) === 0xfb00) return decodeMultiply(hw1, hw2, o)
  if ((hw1 & 0xff80) === 0xfb80) return decodeLongMultiply(hw1, hw2, o)
  if ((hw1 & 0xfc00) === 0xfc00) return set(o, X.nocp)
  set(o, X.undef)
}

/** A5.3.5 load/store multiple */
function decodeLdmStm(hw1: number, hw2: number, o: Decoded): void {
  const opc = (hw1 >> 7) & 3
  const load = (hw1 >> 4) & 1
  const wb = (hw1 >> 5) & 1
  const rn = hw1 & 15
  const list = hw2
  if (opc === 0 || opc === 3) return set(o, X.undef) // SRS / RFE do not exist on M profile
  if (rn === 15) unpred(o, 'LDM/STM with Rn = PC')
  if (load) {
    if (list & 0x2000 || bitCount(list) < 2) unpred(o, 'LDM register list')
    if ((list & 0xc000) === 0xc000) unpred(o, 'LDM loading both PC and LR')
    if (wb && list & (1 << rn)) unpred(o, 'LDM writeback with Rn in list')
    return set(o, opc === 1 ? X.ldm : X.ldmdb, rn, list, wb)
  }
  if (list & 0xa000 || bitCount(list) < 2) unpred(o, 'STM register list')
  if (wb && list & (1 << rn)) unpred(o, 'STM writeback with Rn in list')
  set(o, opc === 1 ? X.stm : X.stmdb, rn, list & 0x5fff, wb)
}

/** A5.3.6 load/store dual or exclusive, table branch */
function decodeDualExclusive(hw1: number, hw2: number, pc: number, o: Decoded): void {
  const p = (hw1 >> 8) & 1
  const u = (hw1 >> 7) & 1
  const w = (hw1 >> 5) & 1
  const load = (hw1 >> 4) & 1
  const rn = hw1 & 15
  const rt = (hw2 >> 12) & 15
  const rt2 = (hw2 >> 8) & 15
  if (p === 1 || w === 1) {
    // LDRD / STRD (immediate, literal)
    const imm = (hw2 & 0xff) << 2
    const off = u ? imm : -imm
    if (load) {
      if (rt === rt2 || spPc(rt) || spPc(rt2)) unpred(o, 'LDRD registers')
      if (rn === 15) {
        // LDRD (literal): Align(PC, 4) ± imm whatever P is; W = 1 is UNPREDICTABLE (R[15] is never
        // a write-back target: A2.3.1 R[] asserts n <= 14)
        if (w) unpred(o, 'LDRD literal with writeback')
        const addr = (((pc + 4) & ~3) + off) | 0
        return set(o, X.ldrd, rt, R_ZERO, addr, rt2)
      }
      if (w && (rn === rt || rn === rt2)) unpred(o, 'LDRD writeback overlaps Rt')
    } else {
      if (spPc(rt) || spPc(rt2)) unpred(o, 'STRD registers')
      if (w && (rn === rt || rn === rt2)) unpred(o, 'STRD writeback overlaps Rt')
      if (rn === 15) {
        // A7.7.163: n == 15 is UNPREDICTABLE (not UNDEFINED); the base reads as the PC, no write-back
        unpred(o, 'STRD with Rn = PC')
        return set(o, X.strd, rt, R_ZERO, (pc + 4 + (p ? off : 0)) | 0, rt2)
      }
    }
    const mode = w === 0 ? 0 : p === 1 ? 1 : 2
    return set(o, load ? X.ldrd : X.strd, rt, rn, off, rt2 | (mode << 4))
  }
  const op1 = (hw1 >> 7) & 3
  const op3 = (hw2 >> 4) & 15
  if (op1 === 0) {
    if (load === 0) {
      // STREX Rd, Rt, [Rn, #imm]
      const rd = (hw2 >> 8) & 15
      if (rd === rn || rd === rt || spPc(rd) || spPc(rt) || rn === 15) unpred(o, 'STREX registers')
      return set(o, X.strex, rd, rt, rn, (hw2 & 0xff) << 2)
    }
    if (spPc(rt) || rn === 15) unpred(o, 'LDREX registers')
    if ((hw2 & 0xf00) !== 0xf00) unpred(o, 'LDREX (1) bits')
    return set(o, X.ldrex, rt, rn, (hw2 & 0xff) << 2)
  }
  if (op1 === 1) {
    if (load === 0) {
      const rd = hw2 & 15
      if (op3 !== 4 && op3 !== 5) return set(o, X.undef)
      if (rd === rn || rd === rt || spPc(rd) || spPc(rt) || rn === 15) unpred(o, 'STREXB/H registers')
      if ((hw2 & 0xf00) !== 0xf00) unpred(o, 'STREXB/H (1) bits')
      return set(o, op3 === 4 ? X.strexb : X.strexh, rd, rt, rn)
    }
    if (op3 === 0 || op3 === 1) {
      const rm = hw2 & 15
      if (rn === 13 || spPc(rm)) unpred(o, 'TBB/TBH registers')
      if ((hw2 & 0xff00) !== 0xf000) unpred(o, 'TBB/TBH (1)/(0) bits')
      return set(o, op3 === 0 ? X.tbb : X.tbh, rn, rm)
    }
    if (op3 === 4 || op3 === 5) {
      if (spPc(rt) || rn === 15) unpred(o, 'LDREXB/H registers')
      if ((hw2 & 0xf0f) !== 0xf0f) unpred(o, 'LDREXB/H (1) bits')
      return set(o, op3 === 4 ? X.ldrexb : X.ldrexh, rt, rn)
    }
  }
  set(o, X.undef)
}

/** A5.3.11 data processing (shifted register) */
function decodeDpShifted(hw1: number, hw2: number, o: Decoded): void {
  const op = (hw1 >> 5) & 15
  const s = (hw1 >> 4) & 1
  const rn = hw1 & 15
  let rd = (hw2 >> 8) & 15
  const rm = hw2 & 15
  const imm5 = ((hw2 >> 10) & 0x1c) | ((hw2 >> 6) & 3)
  const sh = immShift((hw2 >> 4) & 3, imm5)
  const plain = sh === 0 // LSL #0: the plain-register handlers are equivalent (carry = carry_in)
  const f = plain ? s : s | sh
  if (hw2 & 0x8000) unpred(o, 'data-processing (register) with the (0) bit 15 set')
  // compare / test aliases (Rd = PC with S = 1)
  if (rd === 15 && s) {
    const t =
      op === 0 ? (plain ? X.tstR : X.tstS) : op === 4 ? (plain ? X.teqR : X.teqS) : op === 8 ? (plain ? X.cmnR : X.cmnS) : op === 13 ? (plain ? X.cmpR : X.cmpS) : null
    if (t !== null) {
      if (rn === 15 || spPc(rm) || (rn === 13 && op !== 8 && op !== 13)) unpred(o, 'test/compare (register) with SP/PC operand')
      return set(o, t, 0, rn, rm, f | 1)
    }
  }
  const h = plain ? DP_R[op] : DP_S[op]
  if (h === null) return set(o, X.undef) // includes PKHBT/PKHTB (DSP)
  const spForm = (op === 8 || op === 13) && rn === 13 // ADD/SUB (SP plus register)
  const isMov = (op === 2 || op === 3) && rn === 15 // MOV/MVN and the immediate shifts
  const movPlain = op === 2 && rn === 15 && plain && !s
  if (spPc(rm) && !(movPlain && rm === 13 && rd !== 13)) unpred(o, 'data-processing (register) with Rm = SP/PC')
  if (rn === 15 && !isMov) unpred(o, 'data-processing (register) with Rn = PC')
  if (rn === 13 && !spForm) unpred(o, 'data-processing (register) with Rn = SP')
  if (rd === 13 && !(spForm || movPlain)) unpred(o, 'data-processing (register) with Rd = SP')
  if (rd === 15) {
    unpred(o, 'data-processing (register) with Rd = PC')
    rd = R_SINK
  }
  if (rd === 13 && spForm) {
    // ADD/SUB SP, SP, Rm{, LSL #0-3} (A7.7.6/A7.7.176); the result is written with SP[1:0] = 0
    if (((hw2 >> 4) & 3) !== 0 || imm5 > 3) unpred(o, 'ADD/SUB SP, SP, Rm with a shift other than LSL #0-3')
    return set(o, op === 8 ? X.addSpS : X.subSpS, rd, rn, rm, s | sh)
  }
  if (rd === 13 && movPlain) return set(o, X.movSpR, rd, 0, rm, 0) // MOV.W SP, Rm
  if (op === 2 && rn === 15) return set(o, plain ? X.movR : X.movS, rd, 0, rm, f)
  if (op === 3 && rn === 15) return set(o, plain ? X.mvnR : X.mvnS, rd, 0, rm, f)
  set(o, h, rd, rn, rm, f)
}

/** A5.3.1 data processing (modified immediate) */
function decodeDpModImm(hw1: number, hw2: number, o: Decoded): void {
  const op = (hw1 >> 5) & 15
  const s = (hw1 >> 4) & 1
  const rn = hw1 & 15
  let rd = (hw2 >> 8) & 15
  const h = DP_I[op]
  if (h === null) return set(o, X.undef)
  const imm12 = ((hw1 >> 10) & 1) << 11 | ((hw2 >> 12) & 7) << 8 | (hw2 & 0xff)
  const imm = thumbExpandImm(imm12)
  if ((imm12 & 0xc00) === 0 && (imm12 & 0x300) !== 0 && (imm12 & 0xff) === 0) unpred(o, 'modified immediate with imm8 = 0')
  // logical ops take the carry from ThumbExpandImm_C, arithmetic ones never use it
  const carry = (LOGICAL >> op) & 1 ? expCarry : 0
  const d = s ? 1 | (carry << 2) : 0
  if (rd === 15 && s && (op === 0 || op === 4 || op === 8 || op === 13)) {
    // TST/TEQ: n IN {13,15} is UNPREDICTABLE; CMN/CMP: n == 15 (A7.7.188/A7.7.186/A7.7.25/A7.7.27)
    if (rn === 15 || (rn === 13 && (op === 0 || op === 4))) unpred(o, 'test/compare (immediate) with Rn = SP/PC')
    if (op === 0) return set(o, X.tstI, 0, rn, imm, 1 | (carry << 2))
    if (op === 4) return set(o, X.teqI, 0, rn, imm, 1 | (carry << 2))
    return set(o, op === 8 ? X.cmnI : X.cmpI, 0, rn, imm, 1)
  }
  if (rd === 15) {
    unpred(o, 'data-processing (immediate) with Rd = PC')
    rd = R_SINK
  }
  if ((op === 2 || op === 3) && rn === 15) {
    // MOV/MVN (immediate): d IN {13,15} is UNPREDICTABLE
    if (rd === 13) unpred(o, 'MOV/MVN (immediate) with Rd = SP')
    return set(o, op === 2 ? X.movI : X.mvnI, rd, 0, imm, d)
  }
  const spForm = (op === 8 || op === 13) && rn === 13 // ADD/SUB (SP plus immediate)
  if (rn === 15) unpred(o, 'data-processing (immediate) with Rn = PC')
  if (rn === 13 && !spForm) unpred(o, 'data-processing (immediate) with Rn = SP')
  if (spForm) {
    // ADD/SUB Rd, SP, #imm: Rd = SP keeps SP[1:0] = 0
    if (rd === 13) return set(o, op === 8 ? X.addSpI : X.subSpI, rd, rn, imm, d)
    return set(o, op === 8 ? X.addI : X.subI, rd, rn, imm, d)
  }
  if (rd === 13) unpred(o, 'data-processing (immediate) with Rd = SP')
  set(o, h, rd, rn, imm, d)
}

/** allocated A5.3.3 op values: ADDW 0, MOVW 4, SUBW 10, MOVT 12, SSAT 16/18, SBFX 20, BFI 22, USAT 24/26, UBFX 28 */
const PLAIN_IMM_OPS = (1 << 0) | (1 << 4) | (1 << 10) | (1 << 12) | (1 << 16) | (1 << 18) | (1 << 20) | (1 << 22) | (1 << 24) | (1 << 26) | (1 << 28)

/** A5.3.3 data processing (plain binary immediate) */
function decodeDpPlainImm(hw1: number, hw2: number, pc: number, o: Decoded): void {
  const op = (hw1 >> 4) & 31
  const rn = hw1 & 15
  let rd = (hw2 >> 8) & 15
  const i = (hw1 >> 10) & 1
  const imm3 = (hw2 >> 12) & 7
  const imm8 = hw2 & 0xff
  const imm12 = (i << 11) | (imm3 << 8) | imm8
  const imm2 = (hw2 >> 6) & 3
  const sh = (imm3 << 2) | imm2
  if (((PLAIN_IMM_OPS >>> op) & 1) === 0) return set(o, X.undef)
  // saturate / bit-field encodings: hw1[10] and hw2[5] are (0)
  if (op >= 16 && (i || hw2 & 0x20)) unpred(o, 'saturate/bit-field (0) bits set')
  if (rd === 15 || (rd === 13 && !((op === 0 || op === 10) && rn === 13))) {
    unpred(o, 'plain-immediate data-processing with Rd = SP/PC')
    if (rd === 15) rd = R_SINK
  }
  switch (op) {
    case 0:
      if (rn === 15) return set(o, X.movI, rd, 0, (((pc + 4) & ~3) + imm12) | 0, 0) // ADR T3
      if (rn === 13 && rd === 13) return set(o, X.addSpI, rd, rn, imm12, 0)
      return set(o, X.addI, rd, rn, imm12, 0) // ADDW
    case 4: // MOVW
      return set(o, X.movI, rd, 0, (rn << 12) | imm12, 0)
    case 10:
      if (rn === 15) return set(o, X.movI, rd, 0, (((pc + 4) & ~3) - imm12) | 0, 0) // ADR T2
      if (rn === 13 && rd === 13) return set(o, X.subSpI, rd, rn, imm12, 0)
      return set(o, X.subI, rd, rn, imm12, 0) // SUBW
    case 12: // MOVT
      return set(o, X.movt, rd, 0, (rn << 12) | imm12)
    case 16:
    case 18: {
      // SSAT (sh bit = hw1[5]); SSAT16 (sh=1, shift 0) is DSP → UNDEFINED
      const asr = (hw1 >> 5) & 1
      if (asr && sh === 0) return set(o, X.undef)
      if (spPc(rn)) unpred(o, 'SSAT with Rn = SP/PC')
      return set(o, X.ssat, rd, rn, (hw2 & 31) + 1, ((asr ? 2 : 0) << 5) | sh)
    }
    case 20: {
      const wm1 = hw2 & 31
      if (sh + wm1 > 31) unpred(o, 'SBFX lsb + width > 32')
      if (spPc(rn)) unpred(o, 'SBFX with Rn = SP/PC')
      return set(o, X.sbfx, rd, rn, sh, Math.min(wm1, 31 - sh))
    }
    case 22: {
      const msb = hw2 & 31
      if (msb < sh) {
        unpred(o, 'BFI/BFC msb < lsb')
        return set(o, X.nop)
      }
      if (rn === 15) return set(o, X.bfc, rd, 0, sh, msb)
      if (rn === 13) unpred(o, 'BFI with Rn = SP')
      return set(o, X.bfi, rd, rn, sh, msb)
    }
    case 24:
    case 26: {
      const asr = (hw1 >> 5) & 1
      if (asr && sh === 0) return set(o, X.undef) // USAT16 (DSP)
      if (spPc(rn)) unpred(o, 'USAT with Rn = SP/PC')
      return set(o, X.usat, rd, rn, hw2 & 31, ((asr ? 2 : 0) << 5) | sh)
    }
    case 28: {
      const wm1 = hw2 & 31
      if (sh + wm1 > 31) unpred(o, 'UBFX lsb + width > 32')
      if (spPc(rn)) unpred(o, 'UBFX with Rn = SP/PC')
      return set(o, X.ubfx, rd, rn, sh, Math.min(wm1, 31 - sh))
    }
    default:
      return set(o, X.undef)
  }
}

/** A5.3.4 branches and miscellaneous control */
function decodeBranchMisc(hw1: number, hw2: number, pc: number, o: Decoded): void {
  const op1 = (hw2 >> 12) & 7
  const op = (hw1 >> 4) & 0x7f
  const s = (hw1 >> 10) & 1
  const j1 = (hw2 >> 13) & 1
  const j2 = (hw2 >> 11) & 1
  if ((op1 & 5) === 0) {
    if ((op & 0x38) !== 0x38) {
      // B<cond>.W (T3): imm32 = S:J2:J1:imm6:imm11:'0'
      const imm = (s << 20) | (j2 << 19) | (j1 << 18) | ((hw1 & 0x3f) << 12) | ((hw2 & 0x7ff) << 1)
      return set(o, X.bcond, (pc + 4 + signExtend(imm, 21)) | 0, (hw1 >> 6) & 15)
    }
    if (op === 0x38 || op === 0x39) {
      // MSR (register)
      const sysm = hw2 & 0xff
      const mask = (hw2 >> 10) & 3
      const rn = hw1 & 15
      if (spPc(rn)) unpred(o, 'MSR with Rn = SP/PC')
      if (!validSysm(sysm)) unpred(o, `MSR SYSm ${sysm}`)
      // mask<0> (APSR.GE) needs the DSP extension (B5.2.3)
      if (mask === 0 || (sysm > 3 && mask !== 2) || mask & 1) unpred(o, 'MSR mask')
      if (hw1 & 0x10 || hw2 & 0x2300) unpred(o, 'MSR (0) bits')
      return set(o, X.msr, sysm, rn, mask)
    }
    // hints and barriers: hw1[3:0] are (1)(1)(1)(1) and hw2[13] is (0)
    if ((op === 0x3a || op === 0x3b) && ((hw1 & 15) !== 15 || hw2 & 0x2000)) unpred(o, 'hint/barrier (1)/(0) bits')
    if (op === 0x3a) {
      if ((hw2 & 0x700) !== 0) return set(o, X.undef)
      if (hw2 & 0x800) unpred(o, 'hint (0) bit 11')
      switch (hw2 & 0xff) {
        case 0:
        case 1:
          return set(o, X.nop)
        case 2:
          return set(o, X.wfe)
        case 3:
          return set(o, X.wfi)
        case 4:
          return set(o, X.sev)
        default: // DBG #option and unallocated hints: NOP
          return set(o, X.nop)
      }
    }
    if (op === 0x3b) {
      if ((hw2 & 0xf00) !== 0xf00) unpred(o, 'barrier (1) bits')
      switch ((hw2 >> 4) & 15) {
        case 2:
          if ((hw2 & 15) !== 15) unpred(o, 'CLREX (1) bits')
          return set(o, X.clrex)
        case 4: // DSB
        case 5: // DMB
        case 6: // ISB
          return set(o, X.barrier)
        default:
          return set(o, X.undef)
      }
    }
    if (op === 0x3e || op === 0x3f) {
      // MRS Rd, spec_reg
      const rd = (hw2 >> 8) & 15
      const sysm = hw2 & 0xff
      if (spPc(rd)) unpred(o, 'MRS with Rd = SP/PC')
      if (!validSysm(sysm)) unpred(o, `MRS SYSm ${sysm}`)
      if (hw1 & 0x10 || (hw1 & 15) !== 15 || hw2 & 0x2000) unpred(o, 'MRS (1)/(0) bits')
      return set(o, X.mrs, rd === 15 ? R_SINK : rd, sysm)
    }
    return set(o, X.undef) // includes UDF.W (op1 = 010, op = 1111111)
  }
  if ((op1 & 5) === 1) {
    // B.W (T4)
    return set(o, X.b, (pc + 4 + branchImm24(hw1, hw2)) | 0)
  }
  if ((op1 & 5) === 4) return set(o, X.undef) // BLX (immediate): no ARM state on M profile
  set(o, X.bl, (pc + 4 + branchImm24(hw1, hw2)) | 0)
}

/** T4 / BL immediate: I1 = NOT(J1 XOR S), I2 = NOT(J2 XOR S), imm32 = S:I1:I2:imm10:imm11:'0' */
function branchImm24(hw1: number, hw2: number): number {
  const s = (hw1 >> 10) & 1
  const i1 = ~(((hw2 >> 13) & 1) ^ s) & 1
  const i2 = ~(((hw2 >> 11) & 1) ^ s) & 1
  const imm = (s << 24) | (i1 << 23) | (i2 << 22) | ((hw1 & 0x3ff) << 12) | ((hw2 & 0x7ff) << 1)
  return signExtend(imm, 25)
}

function validSysm(sysm: number): boolean {
  return sysm <= 3 || (sysm >= 5 && sysm <= 9) || (sysm >= 16 && sysm <= 20)
}

// loads/stores by [signed][size]: size 0 byte 1 half 2 word
const LD_I = [X.ldrbI, X.ldrhI, X.ldrI]
const LDS_I = [X.ldrsbI, X.ldrshI]
const LD_R = [X.ldrbR, X.ldrhR, X.ldrR]
const LDS_R = [X.ldrsbR, X.ldrshR]
const LD_X = [X.ldrbX, X.ldrhX, X.ldrX]
const LDS_X = [X.ldrsbX, X.ldrshX]
const ST_I = [X.strbI, X.strhI, X.strI]
const ST_R = [X.strbR, X.strhR, X.strR]
const ST_X = [X.strbX, X.strhX, X.strX]

/** LDR/STR (immediate, pre/post-indexed) handlers by kind, as packed into wbSp's d field */
const WB_KIND = new Map<Handler, number>([
  [X.ldrX, 0],
  [X.ldrbX, 1],
  [X.ldrhX, 2],
  [X.ldrsbX, 3],
  [X.ldrshX, 4],
  [X.strX, 5],
  [X.strbX, 6],
  [X.strhX, 7],
])

/**
 * pre/post-indexed access: an access that writes SP (Rt = SP, or base SP with an
 * offset that is not a multiple of 4) goes through wbSp, which keeps SP[1:0] = 0
 */
function setIndexed(o: Decoded, h: Handler, rt: number, rn: number, off: number, mode: number): void {
  if (rt === 13 || (rn === 13 && (off & 3) !== 0)) return set(o, X.wbSp, rt, rn, off, mode | ((WB_KIND.get(h) as number) << 2))
  set(o, h, rt, rn, off, mode)
}

/**
 * A5.3.7–A5.3.10 single loads (incl. memory hints) and stores. Word loads may
 * target SP (written with SP[1:0] = 0) or PC (LoadWritePC); byte/halfword
 * loads with Rt = PC are memory hints when they do not write back (PLD/PLI,
 * and the unallocated hints A5.3.8 says to treat as NOP), UNPREDICTABLE loads
 * otherwise; Rt = SP is UNPREDICTABLE for them.
 */
function decodeLoadStore(hw1: number, hw2: number, pc: number, o: Decoded): void {
  const signed = (hw1 >> 8) & 1
  const big = (hw1 >> 7) & 1 // imm12 form (or U for literal)
  const size = (hw1 >> 5) & 3
  const load = (hw1 >> 4) & 1
  const rn = hw1 & 15
  const rt = (hw2 >> 12) & 15
  const word = size === 2
  if (size === 3) return set(o, X.undef)
  if (!load) {
    if (signed || rn === 15) return set(o, X.undef)
    if (rt === 15 || (rt === 13 && !word)) unpred(o, 'store with Rt = SP/PC')
    if (big) return set(o, ST_I[size], rt, rn, hw2 & 0xfff)
    if (hw2 & 0x800) {
      const p = (hw2 >> 10) & 1
      const u = (hw2 >> 9) & 1
      const w = (hw2 >> 8) & 1
      const imm = hw2 & 0xff
      if (p && u && !w) {
        if (rt === 13) unpred(o, 'STRT with Rt = SP') // t IN {13,15} for every T form
        return set(o, X.ldstT, rt, rn, imm, [6, 7, 5][size]) // STRBT/STRHT/STRT
      }
      if (!p && !w) return set(o, X.undef)
      const off = u ? imm : -imm
      if (!w) return set(o, ST_I[size], rt, rn, off)
      if (rn === rt) unpred(o, 'store writeback with Rn = Rt')
      return setIndexed(o, ST_X[size], rt, rn, off, p ? 1 : 2)
    }
    if ((hw2 & 0xfc0) !== 0) return set(o, X.undef)
    const rm = hw2 & 15
    if (spPc(rm)) unpred(o, 'store register offset with Rm = SP/PC')
    return set(o, ST_R[size], rt, rn, rm, (hw2 >> 4) & 3)
  }
  if (signed && word) return set(o, X.undef)
  const ldI = word && rt === 13 ? X.ldrISp : signed ? LDS_I[size] : LD_I[size]
  const hint = rt === 15 && !word
  if (rt === 13 && !word) unpred(o, 'byte/halfword load with Rt = SP')
  if (rn === 15) {
    // literal; Rt = PC: PLD/PLI (literal) or an unallocated hint
    if (hint) return set(o, X.nop)
    const imm = hw2 & 0xfff
    const addr = (((pc + 4) & ~3) + (big ? imm : -imm)) | 0
    return set(o, ldI, rt, R_ZERO, addr)
  }
  if (big) {
    if (hint) return set(o, X.nop)
    return set(o, ldI, rt, rn, hw2 & 0xfff)
  }
  if (hw2 & 0x800) {
    const p = (hw2 >> 10) & 1
    const u = (hw2 >> 9) & 1
    const w = (hw2 >> 8) & 1
    const imm = hw2 & 0xff
    if (p && u && !w) {
      // LDRT/LDRBT/LDRHT/LDRSBT/LDRSHT: t IN {13,15} is UNPREDICTABLE (a PC result is discarded)
      if (spPc(rt)) unpred(o, 'LDRT-class load with Rt = SP/PC')
      return set(o, X.ldstT, rt === 15 ? R_SINK : rt, rn, imm, signed ? (size === 0 ? 3 : 4) : [1, 2, 0][size])
    }
    if (!p && !w) return set(o, X.undef)
    const off = u ? imm : -imm
    if (!w) {
      if (hint) return set(o, X.nop) // PLD/PLI [Rn, #-imm8], unallocated hint
      return set(o, ldI, rt, rn, off)
    }
    if (rn === rt) unpred(o, 'load writeback with Rn = Rt')
    if (hint) {
      // (t == 15 && W == '1') is UNPREDICTABLE: the access and the write-back happen, the result is discarded
      unpred(o, 'byte/halfword load to PC with writeback')
      return set(o, signed ? LDS_X[size] : LD_X[size], R_SINK, rn, off, p ? 1 : 2)
    }
    return setIndexed(o, signed ? LDS_X[size] : LD_X[size], rt, rn, off, p ? 1 : 2)
  }
  if ((hw2 & 0xfc0) !== 0) return set(o, X.undef)
  if (hint) return set(o, X.nop)
  const rm = hw2 & 15
  if (spPc(rm)) unpred(o, 'load register offset with Rm = SP/PC')
  set(o, word && rt === 13 ? X.ldrRSp : signed ? LDS_R[size] : LD_R[size], rt, rn, rm, (hw2 >> 4) & 3)
}

/** A5.3.12 data processing (register): shifts by register, extends, misc */
function decodeDpRegister(hw1: number, hw2: number, o: Decoded): void {
  if ((hw2 & 0xf000) !== 0xf000) return set(o, X.undef)
  const op1 = (hw1 >> 4) & 15
  const op2 = (hw2 >> 4) & 15
  const rn = hw1 & 15
  let rd = (hw2 >> 8) & 15
  const rm = hw2 & 15
  if (spPc(rd)) {
    unpred(o, 'data-processing (register) with Rd = SP/PC')
    if (rd === 15) rd = R_SINK
  }
  if (op2 === 0 && op1 < 8) {
    if (spPc(rn) || spPc(rm)) unpred(o, 'shift (register) with SP/PC operand')
    const s = op1 & 1
    const h = [X.lslRR, X.lsrRR, X.asrRR, X.rorRR][op1 >> 1]
    return set(o, h, rd, rn, rm, s)
  }
  if (op2 & 8 && op1 < 8) {
    // extends; Rn != PC selects the add-and-extend DSP forms (SXTAH…) → UNDEFINED
    if (rn !== 15) return set(o, X.undef)
    const rot = ((hw2 >> 4) & 3) << 3
    if (spPc(rm)) unpred(o, 'extend with Rm = SP/PC')
    if (hw2 & 0x40) unpred(o, 'extend with the (0) bit 6 set') // 1111 Rd 1 (0) rotate Rm
    switch (op1) {
      case 0:
        return set(o, X.sxth, rd, rm, rot)
      case 1:
        return set(o, X.uxth, rd, rm, rot)
      case 4:
        return set(o, X.sxtb, rd, rm, rot)
      case 5:
        return set(o, X.uxtb, rd, rm, rot)
      default: // SXTB16/UXTB16 (DSP)
        return set(o, X.undef)
    }
  }
  if ((op1 & 0xc) === 8 && (op2 & 0xc) === 8) {
    // A5.3.15 miscellaneous operations: Rm is encoded twice
    const a = op1 & 3
    const b = op2 & 3
    if (a !== 1 && !(a === 3 && b === 0)) return set(o, X.undef) // QADD/QDADD/QSUB/QDSUB/SEL (DSP)
    if (rn !== rm) unpred(o, 'misc operation with mismatched Rm copies')
    if (spPc(rm)) unpred(o, 'misc operation with Rm = SP/PC')
    if (a === 1) return set(o, [X.rev, X.rev16, X.rbit, X.revsh][b], rd, rm)
    return set(o, X.clz, rd, rm)
  }
  set(o, X.undef) // parallel add/subtract (DSP)
}

/** A5.3.16 multiply, multiply accumulate */
function decodeMultiply(hw1: number, hw2: number, o: Decoded): void {
  const op1 = (hw1 >> 4) & 7
  // op2 is hw2[5:4] in table A5-28, but hw2[7:6] are '00' in MUL/MLA/MLS (other values: DSP forms)
  const op2 = (hw2 >> 4) & 15
  const rn = hw1 & 15
  const ra = (hw2 >> 12) & 15
  let rd = (hw2 >> 8) & 15
  const rm = hw2 & 15
  if (op1 !== 0 || op2 > 1) return set(o, X.undef) // SMLA<x><y>, SMLAD, SMMUL… (DSP)
  if (spPc(rd) || spPc(rn) || spPc(rm) || ra === 13) unpred(o, 'multiply with SP/PC operand')
  if (rd === 15) rd = R_SINK
  if (op2 === 0) {
    if (ra === 15) return set(o, X.mul, rd, rn, rm, 0)
    return set(o, X.mla, rd, rn, rm, ra)
  }
  if (ra === 15) unpred(o, 'MLS with Ra = PC')
  set(o, X.mls, rd, rn, rm, ra)
}

/** A5.3.17 long multiply, long multiply accumulate, divide */
function decodeLongMultiply(hw1: number, hw2: number, o: Decoded): void {
  const op1 = (hw1 >> 4) & 7
  const op2 = (hw2 >> 4) & 15
  const rn = hw1 & 15
  const rm = hw2 & 15
  const lo = (hw2 >> 12) & 15
  let rd = (hw2 >> 8) & 15
  if (op2 === 15 && (op1 === 1 || op1 === 3)) {
    if ((hw2 & 0xf000) !== 0xf000) unpred(o, 'SDIV/UDIV (1) bits')
    if (spPc(rd) || spPc(rn) || spPc(rm)) unpred(o, 'divide with SP/PC operand')
    if (rd === 15) rd = R_SINK
    return set(o, op1 === 1 ? X.sdiv : X.udiv, rd, rn, rm)
  }
  if (op2 !== 0) return set(o, X.undef) // SMLALxy, SMLALD, SMLSLD, UMAAL (DSP)
  const h = op1 === 0 ? X.smull : op1 === 2 ? X.umull : op1 === 4 ? X.smlal : op1 === 6 ? X.umlal : null
  if (h === null) return set(o, X.undef)
  if (spPc(lo) || spPc(rd) || spPc(rn) || spPc(rm)) unpred(o, 'long multiply with SP/PC operand')
  if (lo === rd) unpred(o, 'long multiply with RdLo = RdHi')
  set(o, h, lo === 15 ? R_SINK : lo, rd === 15 ? R_SINK : rd, rn, rm)
}
