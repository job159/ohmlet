/**
 * Thumb disassembler for ARMv7-M without the FP and DSP extensions
 * (Cortex-M3), printing what `llvm-objdump -d --triple=thumbv7m` prints:
 * UAL mnemonics with the IT-block condition and the `.w` suffix where LLVM
 * shows it, `sp`/`lr`/`pc` register names, hexadecimal immediates where
 * LLVM's printer uses them (data-processing constants, imm12 / imm5 / SP
 * offsets, MOVW/MOVT, SVC/BKPT/UDF) and decimal ones where it does not
 * (imm8 load/store offsets incl. pre/post-index and LDRD/STRD, shift amounts
 * of shifted-register operands, ADR offsets, BFI/BFC). Branch and literal
 * targets are printed as absolute addresses (and returned in `target`), as
 * llvm-objdump shows them minus its `<symbol+off>` annotation and `@`
 * comment.
 *
 * Encodings are decoded from the DDI 0403E tables (A5.2 16-bit, A5.3 32-bit)
 * independently of decode.ts (the executable decoder), so the disassembler
 * also cross-checks it (tests/mcu/core/disasm.test.ts). Encodings that are
 * UNDEFINED on a Cortex-M3 — the DSP extension, the FP coprocessor space
 * (cp10/cp11), SRS/RFE, BLX (immediate) — print `<unknown>` like LLVM;
 * other coprocessor instructions print as MRC/MCR/CDP/LDC/STC/MCRR/MRRC
 * (they raise UsageFault NOCP when executed).
 *
 * For UNPREDICTABLE encodings (should-be-one/zero bits violated, nested IT,
 * firstcond 1111, inconsistent duplicated register fields ...) the ARM ARM
 * defines no syntax; the disassembler then follows LLVM's choices (each one
 * noted where it is made) so listings compare line for line — verified on
 * the whole 16-bit space and 500k random 32-bit encodings.
 *
 * The disassembly is a linear sweep that tracks ITSTATE from instruction to
 * instruction; pass `itState` (e.g. itStateOfXpsr(core.registers().xpsr))
 * to start inside an IT block, or use disassembleAtPc for a register snapshot.
 */

export interface DisasmLine {
  /** address of the instruction */
  addr: number
  size: 2 | 4
  /** "mnemonic\toperands" as llvm-objdump prints it (without its `<sym>` / `@` annotations) */
  text: string
  /** the instruction's bytes in memory order */
  bytes: number[]
  /** absolute branch target, literal address or ADR result when the instruction has one */
  target?: number
}

/** halfword reader (little-endian); may throw for unmapped memory, which ends the listing */
export type Read16 = (addr: number) => number

export interface DisasmOptions {
  /** ITSTATE (EPSR.IT, 8 bits) in effect at the first instruction; default 0 */
  itState?: number
}

/** EPSR.IT from an xPSR value: IT[1:0] = xPSR[26:25], IT[7:2] = xPSR[15:10] (B1.4.2) */
export function itStateOfXpsr(xpsr: number): number {
  return ((xpsr >>> 25) & 3) | ((xpsr >>> 8) & 0xfc)
}

/** first halfword of a 32-bit encoding (A5.1) */
export function isThumb32(hw1: number): boolean {
  return hw1 >>> 11 >= 0x1d
}

/**
 * Disassemble `count` instructions starting at `addr` (halfword aligned).
 * Stops early (returning the lines so far) when `read16` throws.
 */
export function disassemble(read16: Read16, addr: number, count: number, opts: DisasmOptions = {}): DisasmLine[] {
  const out: DisasmLine[] = []
  // conditions of the remaining IT-block slots, next one first (ITSTATE[7:4] then ITAdvance())
  let pending: number[] = []
  for (let it = (opts.itState ?? 0) & 0xff; it !== 0; it = (it & 7) === 0 ? 0 : (it & 0xe0) | ((it << 1) & 0x1f)) pending.push(it >> 4)
  let a = (addr & ~1) >>> 0
  for (let i = 0; i < count; i++) {
    let hw1: number
    let hw2 = 0
    try {
      hw1 = read16(a) & 0xffff
      if (isThumb32(hw1)) hw2 = read16((a + 2) >>> 0) & 0xffff
    } catch {
      break
    }
    const size: 2 | 4 = isThumb32(hw1) ? 4 : 2
    const cond = pending.length > 0 ? (pending.shift() as number) : -1
    const r = size === 4 ? dis32(hw1, hw2, a, cond) : dis16(hw1, a, cond)
    // like LLVM, an undecodable halfword/word does not use up an IT slot
    if (r === UNKNOWN && cond !== -1) pending.unshift(cond)
    const bytes = size === 4 ? [hw1 & 0xff, hw1 >>> 8, hw2 & 0xff, hw2 >>> 8] : [hw1 & 0xff, hw1 >>> 8]
    const line: DisasmLine = { addr: a, size, text: r.text, bytes }
    if (r.target !== undefined) line.target = r.target >>> 0
    out.push(line)
    // IT inside an IT block is UNPREDICTABLE; like LLVM, its block runs first, then the rest of the outer one
    if (r.itState !== undefined) pending = [...itConditions(r.itState), ...pending]
    a = (a + size) >>> 0
  }
  return out
}

/** the conditions of the instructions an IT instruction covers (firstcond 1111 treated as AL, like LLVM) */
function itConditions(itState: number): number[] {
  const first = (itState >> 4) & 15
  let it = first === 15 ? 0xe0 | (itState & 15) : itState
  const conds: number[] = []
  for (; it !== 0; it = (it & 7) === 0 ? 0 : (it & 0xe0) | ((it << 1) & 0x1f)) conds.push(it >> 4)
  return conds
}

/**
 * Inspector helper: the `count` instructions from the current PC of a core
 * register snapshot (CoreRegisters, e.g. McuDebugState.registers), with the
 * IT state taken from its xPSR so an instruction inside an IT block shows its
 * condition. `readMemory` is McuDevice.readMemory (src/mcu/mcu-api.ts).
 */
export function disassembleAtPc(readMemory: (addr: number, length: number) => Uint8Array, regs: { r: number[]; xpsr: number }, count = 1): DisasmLine[] {
  const pc = (regs.r[15] & ~1) >>> 0
  const bytes = readMemory(pc, 4 * count)
  const read16 = (a: number): number => {
    const o = (a - pc) >>> 0
    if (o + 1 >= bytes.length) throw new RangeError('outside the bytes read')
    return bytes[o] | (bytes[o + 1] << 8)
  }
  return disassemble(read16, pc, count, { itState: itStateOfXpsr(regs.xpsr) })
}

/** one instruction from its halfwords (cond = ITSTATE condition in effect, -1 outside an IT block) */
export function disassembleOne(hw1: number, hw2: number, addr: number, cond = -1): string {
  return isThumb32(hw1) ? dis32(hw1 & 0xffff, hw2 & 0xffff, addr >>> 0, cond).text : dis16(hw1 & 0xffff, addr >>> 0, cond).text
}

// ===================================================================== text

interface Res {
  text: string
  target?: number
  /** set by IT: the ITSTATE it establishes */
  itState?: number
}

const REG = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'sp', 'lr', 'pc']
/** condition suffixes; AL prints nothing, 1111 (the "else" of an AL IT block) prints like LLVM */
const COND = ['eq', 'ne', 'hs', 'lo', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le', '', '<und>']
const SHIFT = ['lsl', 'lsr', 'asr', 'ror']
const UNKNOWN: Res = { text: '<unknown>' }

const R = (n: number): string => REG[n & 15]
const hex = (v: number): string => (v < 0 ? `#-0x${(-v).toString(16)}` : `#0x${v.toString(16)}`)
const uhex = (v: number): string => `#0x${(v >>> 0).toString(16)}`
const dec = (v: number): string => `#${v}`
const addrText = (v: number): string => `0x${(v >>> 0).toString(16)}`
const signExtend = (v: number, bits: number): number => (v << (32 - bits)) >> (32 - bits)

function regList(list: number): string {
  const regs: string[] = []
  for (let i = 0; i < 16; i++) if (list & (1 << i)) regs.push(REG[i])
  return `{${regs.join(', ')}}`
}

/** mnemonic = base + "s" + condition + ".w" (UAL: ADDS<c>.W) */
function mn(base: string, cond: number, s = false, wide = false): string {
  return base + (s ? 's' : '') + (cond >= 0 ? COND[cond] : '') + (wide ? '.w' : '')
}

function ins(m: string, ops?: string): Res {
  return { text: ops === undefined || ops === '' ? m : `${m}\t${ops}` }
}

/** DecodeImmShift → ", lsl #n" etc. (LSL #0 prints nothing; amounts in decimal like LLVM) */
function shiftText(type: number, imm5: number): string {
  if (type === 0) return imm5 === 0 ? '' : `, lsl #${imm5}`
  if (type === 3 && imm5 === 0) return ', rrx'
  return `, ${SHIFT[type]} #${imm5 === 0 ? 32 : imm5}`
}

/** ThumbExpandImm (A5.3.2) */
function thumbExpandImm(imm12: number): number {
  const imm8 = imm12 & 0xff
  if ((imm12 & 0xc00) === 0) {
    switch ((imm12 >> 8) & 3) {
      case 0:
        return imm8
      case 1:
        return ((imm8 << 16) | imm8) >>> 0
      case 2:
        return ((imm8 << 24) | (imm8 << 8)) >>> 0
      default:
        return ((imm8 << 24) | (imm8 << 16) | (imm8 << 8) | imm8) >>> 0
    }
  }
  const unrot = 0x80 | (imm12 & 0x7f)
  const rot = (imm12 >> 7) & 31
  return ((unrot >>> rot) | (unrot << (32 - rot))) >>> 0
}

// ======================================================================= 16-bit

function dis16(hw: number, pc: number, cond: number): Res {
  const inIT = cond >= 0
  // 16-bit data-processing encodings set the flags only outside an IT block (A7.3.3)
  const s = !inIT
  const op = hw >>> 10
  if (op < 16) {
    // A5.2.1 shift (immediate), add, subtract, move, compare
    const rd = hw & 7
    const rm = (hw >> 3) & 7
    const imm5 = (hw >> 6) & 31
    switch ((hw >> 11) & 7) {
      case 0:
        if (imm5 === 0) return ins('movs', `${R(rd)}, ${R(rm)}`) // MOV (register) T2: not permitted in IT
        return ins(mn('lsl', cond, s), `${R(rd)}, ${R(rm)}, ${hex(imm5)}`)
      case 1:
        return ins(mn('lsr', cond, s), `${R(rd)}, ${R(rm)}, ${hex(imm5 === 0 ? 32 : imm5)}`)
      case 2:
        return ins(mn('asr', cond, s), `${R(rd)}, ${R(rm)}, ${hex(imm5 === 0 ? 32 : imm5)}`)
      case 3: {
        const x = (hw >> 6) & 7
        const sub = (hw >> 9) & 1
        const base = sub ? 'sub' : 'add'
        if ((hw >> 10) & 1) return ins(mn(base, cond, s), `${R(rd)}, ${R(rm)}, ${hex(x)}`)
        return ins(mn(base, cond, s), `${R(rd)}, ${R(rm)}, ${R(x)}`)
      }
      case 4:
        return ins(mn('mov', cond, s), `${R((hw >> 8) & 7)}, ${hex(hw & 0xff)}`)
      case 5:
        return ins(mn('cmp', cond), `${R((hw >> 8) & 7)}, ${hex(hw & 0xff)}`)
      case 6:
        return ins(mn('add', cond, s), `${R((hw >> 8) & 7)}, ${hex(hw & 0xff)}`)
      default:
        return ins(mn('sub', cond, s), `${R((hw >> 8) & 7)}, ${hex(hw & 0xff)}`)
    }
  }
  if (op === 16) {
    // A5.2.2 data processing
    const rdn = hw & 7
    const rm = (hw >> 3) & 7
    const two = (base: string): Res => ins(mn(base, cond, s), `${R(rdn)}, ${R(rm)}`)
    switch ((hw >> 6) & 15) {
      case 0:
        return two('and')
      case 1:
        return two('eor')
      case 2:
        return two('lsl')
      case 3:
        return two('lsr')
      case 4:
        return two('asr')
      case 5:
        return two('adc')
      case 6:
        return two('sbc')
      case 7:
        return two('ror')
      case 8:
        return ins(mn('tst', cond), `${R(rdn)}, ${R(rm)}`)
      case 9:
        return ins(mn('rsb', cond, s), `${R(rdn)}, ${R(rm)}, #0`)
      case 10:
        return ins(mn('cmp', cond), `${R(rdn)}, ${R(rm)}`)
      case 11:
        return ins(mn('cmn', cond), `${R(rdn)}, ${R(rm)}`)
      case 12:
        return two('orr')
      case 13:
        return ins(mn('mul', cond, s), `${R(rdn)}, ${R(rm)}, ${R(rdn)}`)
      case 14:
        return two('bic')
      default:
        return two('mvn')
    }
  }
  if (op === 17) {
    // A5.2.3 special data instructions and branch and exchange
    const rm = (hw >> 3) & 15
    const rdn = ((hw >> 4) & 8) | (hw & 7)
    switch ((hw >> 8) & 3) {
      case 0:
        // ADD (register) T2; ADD (SP plus register) T1 prints the SP operand explicitly
        if (rm === 13) return ins(mn('add', cond), `${R(rdn)}, sp, ${R(rdn)}`)
        return ins(mn('add', cond), `${R(rdn)}, ${R(rm)}`)
      case 1:
        return ins(mn('cmp', cond), `${R(rdn)}, ${R(rm)}`)
      case 2:
        return ins(mn('mov', cond), `${R(rdn)}, ${R(rm)}`)
      default:
        // LLVM decodes BX with nonzero (0) bits but not BLX
        if (hw & 0x80 && hw & 7) return UNKNOWN
        return ins(mn(hw & 0x80 ? 'blx' : 'bx', cond), R(rm))
    }
  }
  if (op === 18 || op === 19) {
    // LDR (literal) T1
    const imm = (hw & 0xff) << 2
    return { text: `${mn('ldr', cond)}\t${R((hw >> 8) & 7)}, [pc, ${hex(imm)}]`, target: ((pc + 4) & ~3) + imm }
  }
  if (op < 40) {
    // A5.2.4 load/store single data item
    const rt = R(hw & 7)
    const rn = R((hw >> 3) & 7)
    const imm5 = (hw >> 6) & 31
    const mem = (imm: number): string => (imm === 0 ? `[${rn}]` : `[${rn}, ${hex(imm)}]`)
    switch (hw >> 12) {
      case 5: {
        const base = ['str', 'strh', 'strb', 'ldrsb', 'ldr', 'ldrh', 'ldrb', 'ldrsh'][(hw >> 9) & 7]
        return ins(mn(base, cond), `${rt}, [${rn}, ${R((hw >> 6) & 7)}]`)
      }
      case 6:
        return ins(mn(hw & 0x800 ? 'ldr' : 'str', cond), `${rt}, ${mem(imm5 << 2)}`)
      case 7:
        return ins(mn(hw & 0x800 ? 'ldrb' : 'strb', cond), `${rt}, ${mem(imm5)}`)
      case 8:
        return ins(mn(hw & 0x800 ? 'ldrh' : 'strh', cond), `${rt}, ${mem(imm5 << 1)}`)
      default: {
        const imm = (hw & 0xff) << 2
        return ins(mn(hw & 0x800 ? 'ldr' : 'str', cond), `${R((hw >> 8) & 7)}, ${imm === 0 ? '[sp]' : `[sp, ${hex(imm)}]`}`)
      }
    }
  }
  if (op === 40 || op === 41) {
    // ADR T1: the offset is printed (decimal), the result is the target
    const imm = (hw & 0xff) << 2
    return { text: `${mn('adr', cond)}\t${R((hw >> 8) & 7)}, ${dec(imm)}`, target: ((pc + 4) & ~3) + imm }
  }
  if (op === 42 || op === 43) return ins(mn('add', cond), `${R((hw >> 8) & 7)}, sp, ${hex((hw & 0xff) << 2)}`)
  if (op < 48) return misc16(hw, pc, cond)
  if ((op === 48 || op === 49 || op === 50 || op === 51) && (hw & 0xff) === 0) return UNKNOWN // empty list
  if (op === 48 || op === 49) return ins(mn('stm', cond), `${R((hw >> 8) & 7)}!, ${regList(hw & 0xff)}`)
  if (op === 50 || op === 51) {
    const rn = (hw >> 8) & 7
    const list = hw & 0xff
    return ins(mn('ldm', cond), `${R(rn)}${list & (1 << rn) ? '' : '!'}, ${regList(list)}`)
  }
  if (op < 56) {
    // A5.2.6 conditional branch, UDF, SVC
    const c = (hw >> 8) & 15
    if (c === 14) {
      // LLVM names two UDF immediates after their toolchain uses
      if ((hw & 0xff) === 0xfe) return ins('trap')
      if ((hw & 0xff) === 0xf9) return ins('__brkdiv0')
      return ins('udf', hex(hw & 0xff))
    }
    if (c === 15) return ins(mn('svc', cond), hex(hw & 0xff))
    const target = (pc + 4 + (signExtend(hw & 0xff, 8) << 1)) >>> 0
    return { text: `b${COND[c]}\t${addrText(target)}`, target }
  }
  if (op < 58) {
    const target = (pc + 4 + (signExtend(hw & 0x7ff, 11) << 1)) >>> 0
    return { text: `${mn('b', cond)}\t${addrText(target)}`, target }
  }
  return UNKNOWN // 32-bit prefixes never reach here
}

/** A5.2.5 miscellaneous 16-bit instructions */
function misc16(hw: number, pc: number, cond: number): Res {
  if ((hw & 0x0500) === 0x0100) {
    const imm = (((hw >> 9) & 1) << 6) | (((hw >> 3) & 31) << 1)
    const target = (pc + 4 + imm) >>> 0
    return { text: `${hw & 0x800 ? 'cbnz' : 'cbz'}\t${R(hw & 7)}, ${addrText(target)}`, target }
  }
  const opc = (hw >> 5) & 0x7f
  if ((opc & 0b1111100) === 0) return ins(mn('add', cond), `sp, ${hex((hw & 0x7f) << 2)}`)
  if ((opc & 0b1111100) === 0b0000100) return ins(mn('sub', cond), `sp, ${hex((hw & 0x7f) << 2)}`)
  if ((opc & 0b1111000) === 0b0010000) {
    const base = ['sxth', 'sxtb', 'uxth', 'uxtb'][(hw >> 6) & 3]
    return ins(mn(base, cond), `${R(hw & 7)}, ${R((hw >> 3) & 7)}`)
  }
  // an empty register list is UNPREDICTABLE; LLVM does not decode it
  if ((opc & 0b1110000) === 0b0100000) return (hw & 0x1ff) === 0 ? UNKNOWN : ins(mn('push', cond), regList((hw & 0xff) | (hw & 0x100 ? 0x4000 : 0)))
  if ((hw & 0xffe8) === 0xb660) {
    // the A flag does not exist on M profile (UNPREDICTABLE bit); LLVM still prints it
    const f = (hw & 4 ? 'a' : '') + (hw & 2 ? 'i' : '') + (hw & 1 ? 'f' : '')
    return ins(hw & 0x10 ? 'cpsid' : 'cpsie', f || 'none')
  }
  if ((opc & 0b1111110) === 0b1010000) return ins(mn('rev', cond), `${R(hw & 7)}, ${R((hw >> 3) & 7)}`)
  if ((opc & 0b1111110) === 0b1010010) return ins(mn('rev16', cond), `${R(hw & 7)}, ${R((hw >> 3) & 7)}`)
  if ((opc & 0b1111110) === 0b1010110) return ins(mn('revsh', cond), `${R(hw & 7)}, ${R((hw >> 3) & 7)}`)
  if ((opc & 0b1110000) === 0b1100000) return (hw & 0x1ff) === 0 ? UNKNOWN : ins(mn('pop', cond), regList((hw & 0xff) | (hw & 0x100 ? 0x8000 : 0)))
  if ((opc & 0b1111000) === 0b1110000) return ins('bkpt', hex(hw & 0xff))
  if ((opc & 0b1111000) === 0b1111000) {
    const mask = hw & 15
    if (mask !== 0) {
      // firstcond 1111 is UNPREDICTABLE; LLVM shows it as AL
      const first = Math.min((hw >> 4) & 15, 14)
      let suffix = ''
      for (let k = 3; k > 0 && (mask & ((1 << k) - 1)) !== 0; k--) suffix += ((mask >> k) & 1) === (first & 1) ? 't' : 'e'
      return { text: `it${suffix}\t${COND[first] || 'al'}`, itState: hw & 0xff }
    }
    const hint = ['nop', 'yield', 'wfe', 'wfi', 'sev'][(hw >> 4) & 15]
    if (hint !== undefined) return ins(mn(hint, cond))
    return ins(mn('hint', cond), hex((hw >> 4) & 15))
  }
  return UNKNOWN
}

// ======================================================================= 32-bit

function dis32(hw1: number, hw2: number, pc: number, cond: number): Res {
  const op1 = (hw1 >> 11) & 3
  if (op1 === 1) {
    if ((hw1 & 0xfe40) === 0xe800) return ldmStm(hw1, hw2, cond)
    if ((hw1 & 0xfe40) === 0xe840) return dualExclusive(hw1, hw2, pc, cond)
    if ((hw1 & 0xfe00) === 0xea00) return dpShifted(hw1, hw2, cond)
    return coprocessor(hw1, hw2, cond)
  }
  if (op1 === 2) {
    if ((hw2 & 0x8000) === 0) return hw1 & 0x0200 ? dpPlainImm(hw1, hw2, pc, cond) : dpModImm(hw1, hw2, cond)
    return branchMisc(hw1, hw2, pc, cond)
  }
  if ((hw1 & 0xfe00) === 0xf800) return loadStore(hw1, hw2, pc, cond)
  if ((hw1 & 0xff00) === 0xfa00) return dpRegister(hw1, hw2, cond)
  if ((hw1 & 0xff80) === 0xfb00) return multiply(hw1, hw2, cond)
  if ((hw1 & 0xff80) === 0xfb80) return longMultiply(hw1, hw2, cond)
  if ((hw1 & 0xfc00) === 0xfc00) return coprocessor(hw1, hw2, cond)
  return UNKNOWN
}

/** A5.3.5 load/store multiple */
function ldmStm(hw1: number, hw2: number, cond: number): Res {
  const opc = (hw1 >> 7) & 3
  const load = (hw1 >> 4) & 1
  const wb = (hw1 >> 5) & 1
  const rn = hw1 & 15
  if (opc === 0 || opc === 3) return UNKNOWN // SRS / RFE: not in ARMv7-M
  // empty lists and stores of SP or PC (should-be-zero list bits) are not decoded by LLVM
  if (hw2 === 0 || (!load && hw2 & 0xa000)) return UNKNOWN
  const list = regList(hw2)
  if (opc === 1) {
    if (load && wb && rn === 13) return ins(mn('pop', cond, false, true), list)
    return ins(mn(load ? 'ldm' : 'stm', cond, false, true), `${R(rn)}${wb ? '!' : ''}, ${list}`)
  }
  if (!load && wb && rn === 13) return ins(mn('push', cond, false, true), list)
  return ins(mn(load ? 'ldmdb' : 'stmdb', cond), `${R(rn)}${wb ? '!' : ''}, ${list}`)
}

/** imm8 (scaled) offset addressing as LLVM prints it (decimal, "#-0" for U = 0 with zero) */
function imm8Addr(rn: string, imm: number, u: number, p: number, w: number, alwaysImm: boolean): string {
  const off = u ? `#${imm}` : `#-${imm}`
  if (!p) return `[${rn}], ${off}` // post-indexed
  if (w) return `[${rn}, ${off}]!`
  if (imm === 0 && u && !alwaysImm) return `[${rn}]`
  return `[${rn}, ${off}]`
}

/** A5.3.6 load/store dual or exclusive, table branch */
function dualExclusive(hw1: number, hw2: number, pc: number, cond: number): Res {
  const p = (hw1 >> 8) & 1
  const u = (hw1 >> 7) & 1
  const w = (hw1 >> 5) & 1
  const load = (hw1 >> 4) & 1
  const rn = hw1 & 15
  const rt = (hw2 >> 12) & 15
  const rt2 = (hw2 >> 8) & 15
  if (p === 1 || w === 1) {
    const imm = (hw2 & 0xff) << 2
    const regs = `${R(rt)}, ${R(rt2)}`
    if (load && rn === 15 && w === 0) {
      const target = ((pc + 4) & ~3) + (u ? imm : -imm)
      return { text: `${mn('ldrd', cond)}\t${regs}, [pc${imm === 0 && u ? '' : `, #${u ? '' : '-'}${imm}`}]`, target }
    }
    return ins(mn(load ? 'ldrd' : 'strd', cond), `${regs}, ${imm8Addr(R(rn), imm, u, p, w, false)}`)
  }
  const op1 = (hw1 >> 7) & 3
  const op3 = (hw2 >> 4) & 15
  // (1)/(0) should-be bits of the exclusive and table-branch encodings: LLVM rejects violations
  if (op1 === 0) {
    const imm = (hw2 & 0xff) << 2
    const mem = imm === 0 ? `[${R(rn)}]` : `[${R(rn)}, ${hex(imm)}]`
    if (load) return (hw2 & 0xf00) !== 0xf00 ? UNKNOWN : ins(mn('ldrex', cond), `${R(rt)}, ${mem}`)
    return ins(mn('strex', cond), `${R((hw2 >> 8) & 15)}, ${R(rt)}, ${mem}`)
  }
  if (op1 === 1) {
    if (!load) {
      if ((op3 === 4 || op3 === 5) && (hw2 & 0xf00) === 0xf00) return ins(mn(op3 === 4 ? 'strexb' : 'strexh', cond), `${R(hw2 & 15)}, ${R(rt)}, [${R(rn)}]`)
      return UNKNOWN
    }
    if (op3 < 2 && (hw2 & 0xff00) !== 0xf000) return UNKNOWN
    if (op3 === 0) return ins(mn('tbb', cond), `[${R(rn)}, ${R(hw2 & 15)}]`)
    if (op3 === 1) return ins(mn('tbh', cond), `[${R(rn)}, ${R(hw2 & 15)}, lsl #1]`)
    if ((op3 === 4 || op3 === 5) && (hw2 & 0xf0f) === 0xf0f) return ins(mn(op3 === 4 ? 'ldrexb' : 'ldrexh', cond), `${R(rt)}, [${R(rn)}]`)
  }
  return UNKNOWN
}

/** A5.3.11 data processing (shifted register) */
function dpShifted(hw1: number, hw2: number, cond: number): Res {
  const op = (hw1 >> 5) & 15
  const s = ((hw1 >> 4) & 1) === 1
  const rn = hw1 & 15
  const rd = (hw2 >> 8) & 15
  const rm = hw2 & 15
  const type = (hw2 >> 4) & 3
  const imm5 = ((hw2 >> 10) & 0x1c) | ((hw2 >> 6) & 3)
  const sh = `${R(rm)}${shiftText(type, imm5)}`
  const three = (base: string, wide: boolean): Res => ins(mn(base, cond, s, wide), `${R(rd)}, ${R(rn)}, ${sh}`)
  const cmp = (base: string): Res => ins(mn(base, cond, false, true), `${R(rn)}, ${sh}`)
  switch (op) {
    case 0:
      return rd === 15 && s ? cmp('tst') : three('and', true)
    case 1:
      return three('bic', true)
    case 2:
      if (hw2 & 0x8000) return UNKNOWN // should-be-zero bit (LLVM checks it for ORR/MOV only)
      if (rn !== 15) return three('orr', true)
      // MOV (register) and the shift-by-immediate instructions
      if (type === 0 && imm5 === 0) return ins(mn('mov', cond, s, true), `${R(rd)}, ${R(rm)}`)
      if (type === 3 && imm5 === 0) return ins(mn('rrx', cond, s), `${R(rd)}, ${R(rm)}`)
      return ins(mn(SHIFT[type], cond, s, true), `${R(rd)}, ${R(rm)}, ${hex(imm5 === 0 ? 32 : imm5)}`)
    case 3:
      if (rn === 15) return ins(mn('mvn', cond, s, true), `${R(rd)}, ${sh}`)
      return three('orn', false)
    case 4:
      return rd === 15 && s ? cmp('teq') : three('eor', true)
    case 8:
      return rd === 15 && s ? cmp('cmn') : three('add', true)
    case 10:
      return three('adc', true)
    case 11:
      return three('sbc', true)
    case 13:
      return rd === 15 && s ? cmp('cmp') : three('sub', true)
    case 14:
      return three('rsb', false)
    default:
      return UNKNOWN // PKHBT/PKHTB (DSP) and unallocated opcodes
  }
}

/** A5.3.1 data processing (modified immediate) */
function dpModImm(hw1: number, hw2: number, cond: number): Res {
  const op = (hw1 >> 5) & 15
  const s = ((hw1 >> 4) & 1) === 1
  const rn = hw1 & 15
  const rd = (hw2 >> 8) & 15
  const imm = uhex(thumbExpandImm((((hw1 >> 10) & 1) << 11) | (((hw2 >> 12) & 7) << 8) | (hw2 & 0xff)))
  const three = (base: string, wide: boolean): Res => ins(mn(base, cond, s, wide), `${R(rd)}, ${R(rn)}, ${imm}`)
  const cmp = (base: string): Res => ins(mn(base, cond, false, true), `${R(rn)}, ${imm}`)
  switch (op) {
    case 0:
      return rd === 15 && s ? cmp('tst') : three('and', false)
    case 1:
      return three('bic', false)
    case 2:
      return rn === 15 ? ins(mn('mov', cond, s, true), `${R(rd)}, ${imm}`) : three('orr', false)
    case 3:
      return rn === 15 ? ins(mn('mvn', cond, s), `${R(rd)}, ${imm}`) : three('orn', false)
    case 4:
      return rd === 15 && s ? cmp('teq') : three('eor', false)
    case 8:
      return rd === 15 && s ? cmp('cmn') : three('add', true)
    case 10:
      return three('adc', false)
    case 11:
      return three('sbc', false)
    case 13:
      return rd === 15 && s ? cmp('cmp') : three('sub', true)
    case 14:
      return three('rsb', true)
    default:
      return UNKNOWN
  }
}

/** A5.3.3 data processing (plain binary immediate) */
function dpPlainImm(hw1: number, hw2: number, pc: number, cond: number): Res {
  const op = (hw1 >> 4) & 31
  const rn = hw1 & 15
  const rd = (hw2 >> 8) & 15
  const imm3 = (hw2 >> 12) & 7
  const imm12 = (((hw1 >> 10) & 1) << 11) | (imm3 << 8) | (hw2 & 0xff)
  const lsb = (imm3 << 2) | ((hw2 >> 6) & 3)
  const low5 = hw2 & 31
  switch (op) {
    case 0:
      if (rn === 15) return { text: `${mn('adr', cond, false, true)}\t${R(rd)}, #${imm12}`, target: ((pc + 4) & ~3) + imm12 }
      return ins(mn('addw', cond), `${R(rd)}, ${R(rn)}, ${hex(imm12)}`)
    case 4:
      return ins(mn('movw', cond), `${R(rd)}, ${hex((rn << 12) | imm12)}`)
    case 10:
      // (ADR with a zero subtracted offset is shown as the SUBW it also is)
      if (rn === 15 && imm12 !== 0) return { text: `${mn('adr', cond, false, true)}\t${R(rd)}, #-${imm12}`, target: ((pc + 4) & ~3) - imm12 }
      return ins(mn('subw', cond), `${R(rd)}, ${R(rn)}, ${hex(imm12)}`)
    case 12:
      return ins(mn('movt', cond), `${R(rd)}, ${hex((rn << 12) | imm12)}`)
    case 16:
    case 18:
    case 24:
    case 26: {
      // SSAT / USAT; sh = 1 with a zero shift is SSAT16 / USAT16 (DSP); LLVM rejects set (0) bits
      if (hw1 & 0x400 || hw2 & 0x20) return UNKNOWN
      const asr = (hw1 >> 5) & 1
      if (asr && lsb === 0) return UNKNOWN
      const signed = op < 24
      const sat = signed ? low5 + 1 : low5
      const shift = asr ? `, asr #${lsb}` : lsb !== 0 ? `, lsl #${lsb}` : ''
      return ins(mn(signed ? 'ssat' : 'usat', cond), `${R(rd)}, ${hex(sat)}, ${R(rn)}${shift}`)
    }
    case 20:
    case 28:
      return ins(mn(op === 20 ? 'sbfx' : 'ubfx', cond), `${R(rd)}, ${R(rn)}, ${hex(lsb)}, ${hex(low5 + 1)}`)
    case 22: {
      if (hw1 & 0x400 || hw2 & 0x20) return UNKNOWN // (0) bits, as LLVM checks them
      // msb < lsb is UNPREDICTABLE; LLVM then shows a one-bit field at msb
      const from = low5 < lsb ? low5 : lsb
      const width = low5 - from + 1
      if (rn === 15) return ins(mn('bfc', cond), `${R(rd)}, #${from}, #${width}`)
      return ins(mn('bfi', cond), `${R(rd)}, ${R(rn)}, #${from}, #${width}`)
    }
    default:
      return UNKNOWN
  }
}

/** M-profile special register names (B5.1.1, SYSm) */
const SYSREG: Record<number, string> = {
  0: 'apsr',
  1: 'iapsr',
  2: 'eapsr',
  3: 'xpsr',
  5: 'ipsr',
  6: 'epsr',
  7: 'iepsr',
  8: 'msp',
  9: 'psp',
  16: 'primask',
  17: 'basepri',
  18: 'basepri_max',
  19: 'faultmask',
  20: 'control',
}

/**
 * SYSm values LLVM refuses for ARMv7-M because they name registers of later
 * profiles (ARMv8-M stack limits / Security Extension / PACBTI); other
 * unallocated values are UNPREDICTABLE and print as numbers.
 */
function sysmRejected(sysm: number): boolean {
  return sysm === 10 || sysm === 11 || (sysm >= 0x88 && sysm <= 0x8b) || sysm === 0x90 || sysm === 0x91 || sysm === 0x93 || sysm === 0x94 || sysm === 0x98 || (sysm & 0x78) === 0x20
}

/** hint numbers LLVM prints by name: [mnemonic, operands] */
const HINT_NAMES: Record<number, [string, string]> = {
  0x0d: ['pacbti', 'r12, lr, sp'],
  0x0f: ['bti', ''],
  0x14: ['csdb', ''],
  0x1d: ['pac', 'r12, lr, sp'],
  0x2d: ['aut', 'r12, lr, sp'],
}

/** DMB/DSB option names (A7.7.33/A7.7.34) */
const BARRIER: Record<number, string> = { 15: 'sy', 14: 'st', 11: 'ish', 10: 'ishst', 7: 'nsh', 6: 'nshst', 3: 'osh', 2: 'oshst' }

/** A5.3.4 branches and miscellaneous control */
function branchMisc(hw1: number, hw2: number, pc: number, cond: number): Res {
  const op1 = (hw2 >> 12) & 7
  const op = (hw1 >> 4) & 0x7f
  if ((op1 & 5) === 0) {
    if ((op & 0x38) !== 0x38) {
      // B<cond>.W (T3): imm32 = S:J2:J1:imm6:imm11:'0'
      const s = (hw1 >> 10) & 1
      const imm = (s << 20) | (((hw2 >> 11) & 1) << 19) | (((hw2 >> 13) & 1) << 18) | ((hw1 & 0x3f) << 12) | ((hw2 & 0x7ff) << 1)
      const target = (pc + 4 + signExtend(imm, 21)) >>> 0
      return { text: `b${COND[(hw1 >> 6) & 15]}.w\t${addrText(target)}`, target }
    }
    if (op === 0x38 || op === 0x39) {
      const sysm = hw2 & 0xff
      if (sysmRejected(sysm)) return UNKNOWN
      // without the DSP extension only the NZCVQ write mask exists (other masks are UNPREDICTABLE)
      const name = SYSREG[sysm] ?? String(sysm)
      return ins(mn('msr', cond), `${sysm <= 3 ? `${name}_nzcvq` : name}, ${R(hw1 & 15)}`)
    }
    // hints and barriers: should-be bits (hw1[3:0] = 1111, hint hw2[11] = 0, barrier hw2[11:8] = 1111,
    // CLREX hw2[3:0] = 1111), which LLVM checks
    if ((op === 0x3a || op === 0x3b) && (hw1 & 15) !== 15) return UNKNOWN
    if (op === 0x3b && (hw2 & 0xf00) !== 0xf00) return UNKNOWN
    if (op === 0x3a) {
      if ((hw2 & 0x700) !== 0) return UNKNOWN // CPS.W does not exist in ARMv7-M
      const hint = hw2 & 0xff
      // LLVM names the ARMv8.1-M PACBTI hints for every target (NOPs on a Cortex-M3) without checking hw2[11]
      const named = HINT_NAMES[hint]
      if (named !== undefined && (hint !== 0x14 || (hw2 & 0x800) === 0)) return ins(mn(named[0], cond), named[1])
      if (hw2 & 0x800) return UNKNOWN
      if (hint < 5) return ins(mn(['nop', 'yield', 'wfe', 'wfi', 'sev'][hint], cond, false, true))
      if ((hint & 0xf0) === 0xf0) return ins(mn('dbg', cond), hex(hint & 15))
      return ins(mn('hint', cond, false, true), hex(hint))
    }
    if (op === 0x3b) {
      const option = hw2 & 15
      switch ((hw2 >> 4) & 15) {
        case 2:
          return option === 15 ? ins(mn('clrex', cond)) : UNKNOWN
        case 4:
          // DSB #0 / #4 are the speculation barriers SSBB / PSSBB in LLVM's syntax
          if (option === 0 || option === 4) return ins(mn(option === 0 ? 'ssbb' : 'pssbb', cond))
          return ins(mn('dsb', cond), BARRIER[option] ?? hex(option))
        case 5:
          return ins(mn('dmb', cond), BARRIER[option] ?? hex(option))
        case 6:
          return ins(mn('isb', cond), option === 15 ? 'sy' : hex(option))
        default:
          return UNKNOWN
      }
    }
    if (op === 0x3e || op === 0x3f) {
      const sysm = hw2 & 0xff
      if (sysmRejected(sysm)) return UNKNOWN
      return ins(mn('mrs', cond), `${R((hw2 >> 8) & 15)}, ${SYSREG[sysm] ?? String(sysm)}`)
    }
    if (op1 === 2 && op === 0x7f) return ins('udf.w', hex(((hw1 & 15) << 12) | (hw2 & 0xfff)))
    return UNKNOWN
  }
  if ((op1 & 5) === 4) return UNKNOWN // BLX (immediate): no ARM state on M profile
  // B.W (T4) / BL: I1 = NOT(J1 XOR S), I2 = NOT(J2 XOR S), imm32 = S:I1:I2:imm10:imm11:'0'
  const s = (hw1 >> 10) & 1
  const i1 = ~(((hw2 >> 13) & 1) ^ s) & 1
  const i2 = ~(((hw2 >> 11) & 1) ^ s) & 1
  const imm = (s << 24) | (i1 << 23) | (i2 << 22) | ((hw1 & 0x3ff) << 12) | ((hw2 & 0x7ff) << 1)
  const target = (pc + 4 + signExtend(imm, 25)) >>> 0
  if ((op1 & 5) === 1) return { text: `${mn('b', cond, false, true)}\t${addrText(target)}`, target }
  return { text: `${mn('bl', cond)}\t${addrText(target)}`, target }
}

/** A5.3.7–A5.3.10 single loads (incl. memory hints) and stores */
function loadStore(hw1: number, hw2: number, pc: number, cond: number): Res {
  const signed = (hw1 >> 8) & 1
  const big = (hw1 >> 7) & 1
  const size = (hw1 >> 5) & 3
  const load = (hw1 >> 4) & 1
  const rn = hw1 & 15
  const rt = (hw2 >> 12) & 15
  if (size === 3) return UNKNOWN
  if (!load && (signed || rn === 15)) return UNKNOWN
  if (load && signed && size === 2) return UNKNOWN
  const sz = ['b', 'h', ''][size]
  const base = (load ? (signed ? 'ldrs' : 'ldr') : 'str') + sz
  // Rt = PC on a byte/halfword load without writeback is a memory hint: PLD (byte), PLI (signed
  // byte); the halfword forms are unallocated hints (A5.3.9) — except that LLVM shows the
  // literal one as PLD/PLI because it ignores the (0) bit that distinguishes them
  const hint = load && rt === 15 && size !== 2
  const hintName = size === 0 ? (signed ? 'pli' : 'pld') : null
  if (load && rn === 15) {
    const imm = hw2 & 0xfff
    const target = ((pc + 4) & ~3) + (big ? imm : -imm)
    const lit = `[pc, ${big ? hex(imm) : `#-0x${imm.toString(16)}`}]`
    if (hint) return signed && size === 1 ? UNKNOWN : { text: `${mn(signed ? 'pli' : 'pld', cond)}\t${lit}`, target }
    return { text: `${mn(base, cond, false, true)}\t${R(rt)}, ${lit}`, target }
  }
  if (big) {
    const imm = hw2 & 0xfff
    const mem = imm === 0 ? `[${R(rn)}]` : `[${R(rn)}, ${hex(imm)}]`
    if (hint) return hintName ? ins(mn(hintName, cond), mem) : UNKNOWN
    return ins(mn(base, cond, false, true), `${R(rt)}, ${mem}`)
  }
  if (hw2 & 0x800) {
    const p = (hw2 >> 10) & 1
    const u = (hw2 >> 9) & 1
    const w = (hw2 >> 8) & 1
    const imm = hw2 & 0xff
    if (p && u && !w) {
      // LDRT / STRT and friends: unprivileged access (Rt = PC is UNPREDICTABLE, not a hint)
      return ins(mn(base + 't', cond), `${R(rt)}, ${imm === 0 ? `[${R(rn)}]` : `[${R(rn)}, #${imm}]`}`)
    }
    if (!p && !w) return UNKNOWN
    // with writeback Rt = PC is an (UNPREDICTABLE) load, not a hint
    if (hint && p && !w) return hintName && !u ? ins(mn(hintName, cond), `[${R(rn)}, #-${imm}]`) : UNKNOWN
    return ins(mn(base, cond), `${R(rt)}, ${imm8Addr(R(rn), imm, u, p, w, p === 1 && w === 1)}`)
  }
  if ((hw2 & 0xfc0) !== 0) return UNKNOWN
  const amt = (hw2 >> 4) & 3
  const mem = `[${R(rn)}, ${R(hw2 & 15)}${amt ? `, lsl #${amt}` : ''}]`
  if (hint) return hintName ? ins(mn(hintName, cond), mem) : UNKNOWN
  return ins(mn(base, cond, false, true), `${R(rt)}, ${mem}`)
}

/** A5.3.12 data processing (register) */
function dpRegister(hw1: number, hw2: number, cond: number): Res {
  if ((hw2 & 0xf000) !== 0xf000) return UNKNOWN
  const op1 = (hw1 >> 4) & 15
  const op2 = (hw2 >> 4) & 15
  const rn = hw1 & 15
  const rd = R((hw2 >> 8) & 15)
  const rm = hw2 & 15
  if (op2 === 0 && op1 < 8) return ins(mn(SHIFT[op1 >> 1], cond, (op1 & 1) === 1, true), `${rd}, ${R(rn)}, ${R(rm)}`)
  if (op2 & 8 && op1 < 8) {
    // SXTH/UXTH/SXTB/UXTB; Rn != PC selects the DSP add-extend forms
    const base = ['sxth', 'uxth', null, null, 'sxtb', 'uxtb', null, null][op1]
    if (rn !== 15 || base === null) return UNKNOWN
    const rot = ((hw2 >> 4) & 3) << 3
    return ins(mn(base, cond, false, true), `${rd}, ${R(rm)}${rot ? `, ror #${rot}` : ''}`)
  }
  if ((op1 & 0xc) === 8 && (op2 & 0xc) === 8) {
    // Rm is encoded twice; differing copies are UNPREDICTABLE and LLVM shows their bitwise OR
    const a = op1 & 3
    const b = op2 & 3
    const m = R(rn | rm)
    if (a === 1) {
      const base = ['rev', 'rev16', 'rbit', 'revsh'][b]
      return ins(mn(base, cond, false, b !== 2), `${rd}, ${m}`)
    }
    if (a === 3 && b === 0) return ins(mn('clz', cond), `${rd}, ${m}`)
  }
  return UNKNOWN
}

/** A5.3.16 multiply, multiply accumulate */
function multiply(hw1: number, hw2: number, cond: number): Res {
  const op1 = (hw1 >> 4) & 7
  const op2 = (hw2 >> 4) & 15
  const rn = R(hw1 & 15)
  const ra = (hw2 >> 12) & 15
  const rd = R((hw2 >> 8) & 15)
  const rm = R(hw2 & 15)
  if (op1 !== 0 || op2 > 1) return UNKNOWN
  if (op2 === 0) return ra === 15 ? ins(mn('mul', cond), `${rd}, ${rn}, ${rm}`) : ins(mn('mla', cond), `${rd}, ${rn}, ${rm}, ${R(ra)}`)
  return ins(mn('mls', cond), `${rd}, ${rn}, ${rm}, ${R(ra)}`)
}

/** A5.3.17 long multiply, long multiply accumulate, divide */
function longMultiply(hw1: number, hw2: number, cond: number): Res {
  const op1 = (hw1 >> 4) & 7
  const op2 = (hw2 >> 4) & 15
  const rn = R(hw1 & 15)
  const rm = R(hw2 & 15)
  const lo = R((hw2 >> 12) & 15)
  const hi = R((hw2 >> 8) & 15)
  if (op2 === 15 && (op1 === 1 || op1 === 3)) {
    if (((hw2 >> 12) & 15) !== 15) return UNKNOWN // (1)(1)(1)(1)
    return ins(mn(op1 === 1 ? 'sdiv' : 'udiv', cond), `${hi}, ${rn}, ${rm}`)
  }
  if (op2 !== 0) return UNKNOWN
  const base = ['smull', null, 'umull', null, 'smlal', null, 'umlal', null][op1]
  if (base === null) return UNKNOWN
  return ins(mn(base, cond), `${lo}, ${hi}, ${rn}, ${rm}`)
}

/**
 * A5.3.18 coprocessor instructions. The FP register file (cp10/cp11) does
 * not exist without the FP extension: LLVM, like the hardware, treats that
 * space as undefined.
 */
function coprocessor(hw1: number, hw2: number, cond: number): Res {
  const coproc = (hw2 >> 8) & 15
  const two = (hw1 >> 12) & 1 ? '2' : ''
  const op1 = (hw1 >> 4) & 0x3f
  // (LLVM still decodes the unindexed LDC2L/STC2L there)
  if ((coproc & 0xe) === 0xa && !(two && (op1 & 0x3e) === 0x0c)) return UNKNOWN
  const p = `p${coproc}`
  const crn = `c${hw1 & 15}`
  const crm = `c${hw2 & 15}`
  if ((op1 & 0x3e) === 0) return UNKNOWN
  if ((op1 & 0x3e) === 4) {
    // MCRR / MRRC
    const base = (op1 & 1 ? 'mrrc' : 'mcrr') + two
    return ins(mn(base, two ? -1 : cond), `${p}, ${hex((hw2 >> 4) & 15)}, ${R((hw2 >> 12) & 15)}, ${R(hw1 & 15)}, ${crm}`)
  }
  if ((op1 & 0x20) === 0) {
    // LDC / STC
    const base = (op1 & 1 ? 'ldc' : 'stc') + two + (op1 & 4 ? 'l' : '')
    const pre = (op1 >> 4) & 1
    const u = (op1 >> 3) & 1
    const w = (op1 >> 1) & 1
    const imm = (hw2 & 0xff) << 2
    const rn = R(hw1 & 15)
    const crd = `c${(hw2 >> 12) & 15}`
    const off = `#${u ? '' : '-'}${imm}`
    let mem: string
    if (pre) mem = w ? `[${rn}, ${off}]!` : imm === 0 && u ? `[${rn}]` : `[${rn}, ${off}]`
    else if (w) mem = `[${rn}], ${off}` // post-indexed
    else mem = `[${rn}], {${hw2 & 0xff}}` // unindexed: coprocessor option
    return ins(mn(base, two ? -1 : cond), `${p}, ${crd}, ${mem}`)
  }
  if ((op1 & 0x30) === 0x20) {
    if ((hw2 & 0x10) === 0) {
      // CDP
      return ins(mn('cdp' + two, two ? -1 : cond), `${p}, ${hex((hw1 >> 4) & 15)}, c${(hw2 >> 12) & 15}, ${crn}, ${crm}, ${hex((hw2 >> 5) & 7)}`)
    }
    // MRC to PC transfers the flags: "APSR_nzcv"
    const mrc = (op1 & 1) === 1
    const rt = (hw2 >> 12) & 15
    const reg = mrc && rt === 15 ? 'apsr_nzcv' : R(rt)
    return ins(mn((mrc ? 'mrc' : 'mcr') + two, two ? -1 : cond), `${p}, ${hex((hw1 >> 5) & 7)}, ${reg}, ${crn}, ${crm}, ${hex((hw2 >> 5) & 7)}`)
  }
  return UNKNOWN
}
