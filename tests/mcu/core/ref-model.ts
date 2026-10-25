/**
 * Independent reference semantics for the ALU test cases (firmware/tests/isa
 * CASE macro): interprets the UAL text of a data-processing / multiply /
 * bit-field / extend / saturate instruction (or a short ';'-separated
 * sequence, e.g. an IT block) directly from the ARMv7-M ARM pseudocode
 * (DDI 0403E A2.2 / A7.7). Written separately from src/mcu/core (BigInt
 * arithmetic, string-level parsing) so the tests never use the
 * implementation to compute their expectations.
 */

export interface RefState {
  /** r0..r15 as unsigned 32-bit numbers */
  r: number[]
  n: number
  z: number
  c: number
  v: number
  q: number
}

const M32 = (1n << 32n) - 1n
const u32 = (x: bigint): number => Number(x & M32)
const s32 = (x: number): bigint => BigInt(x | 0)
const big = (x: number): bigint => BigInt(x >>> 0)

/** AddWithCarry (A2.2.1) */
function addWithCarry(x: number, y: number, carry: number): { result: number; c: number; v: number } {
  const usum = big(x) + big(y) + BigInt(carry)
  const ssum = s32(x) + s32(y) + BigInt(carry)
  const result = u32(usum)
  return {
    result,
    c: usum === BigInt(result) ? 0 : 1,
    v: ssum === BigInt(result | 0) ? 0 : 1,
  }
}

/** Shift_C (A7.4.2); amount semantics of DecodeImmShift / register shifts as given */
function shiftC(x: number, type: string, amount: number, carryIn: number): { v: number; c: number } {
  const X = big(x)
  if (type === 'rrx') return { v: u32((BigInt(carryIn) << 31n) | (X >> 1n)), c: x & 1 }
  if (amount === 0) return { v: x >>> 0, c: carryIn }
  switch (type) {
    case 'lsl': {
      const full = X << BigInt(amount)
      return { v: u32(full), c: Number((full >> 32n) & 1n) }
    }
    case 'lsr': {
      const c = amount <= 32 ? Number((X >> BigInt(amount - 1)) & 1n) : 0
      return { v: u32(X >> BigInt(amount)), c }
    }
    case 'asr': {
      const S = s32(x)
      const sh = BigInt(Math.min(amount, 32))
      return { v: u32(S >> sh), c: Number((S >> (sh - 1n)) & 1n) }
    }
    case 'ror': {
      const m = amount % 32
      const v = m === 0 ? x >>> 0 : u32((X >> BigInt(m)) | (X << BigInt(32 - m)))
      return { v, c: v >>> 31 }
    }
  }
  throw new Error(`bad shift ${type}`)
}

const CONDS = ['eq', 'ne', 'cs', 'cc', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le', 'al']
const COND_ALIAS: Record<string, string> = { hs: 'cs', lo: 'cc' }

function condHolds(st: RefState, cond: string): boolean {
  const { n, z, c, v } = st
  switch (COND_ALIAS[cond] ?? cond) {
    case 'eq':
      return z === 1
    case 'ne':
      return z === 0
    case 'cs':
      return c === 1
    case 'cc':
      return c === 0
    case 'mi':
      return n === 1
    case 'pl':
      return n === 0
    case 'vs':
      return v === 1
    case 'vc':
      return v === 0
    case 'hi':
      return c === 1 && z === 0
    case 'ls':
      return c === 0 || z === 1
    case 'ge':
      return n === v
    case 'lt':
      return n !== v
    case 'gt':
      return z === 0 && n === v
    case 'le':
      return z === 1 || n !== v
    default:
      return true
  }
}

const BASES = [
  'addw', 'subw', 'movw', 'movt', 'rev16', 'revsh', 'rbit', 'rev', 'sbfx', 'ubfx', 'bfi', 'bfc', 'sxtb', 'sxth', 'uxtb', 'uxth',
  'smull', 'umull', 'smlal', 'umlal', 'sdiv', 'udiv', 'ssat', 'usat', 'mla', 'mls', 'mul', 'clz', 'neg', 'rrx',
  'adc', 'add', 'and', 'asr', 'bic', 'cmn', 'cmp', 'eor', 'lsl', 'lsr', 'mov', 'mvn', 'orn', 'orr', 'ror', 'rsb', 'sbc', 'sub', 'teq', 'tst', 'nop',
]

interface Mnemonic {
  base: string
  s: boolean
  cond: string
}

function parseMnemonic(m: string): Mnemonic {
  m = m.replace(/\.(w|n)$/, '')
  for (const b of BASES) {
    if (!m.startsWith(b)) continue
    let rest = m.slice(b.length)
    let s = false
    if (rest.startsWith('s') && !CONDS.includes(rest) && !(rest in COND_ALIAS)) {
      s = true
      rest = rest.slice(1)
    }
    if (rest === '' || CONDS.includes(rest) || rest in COND_ALIAS) return { base: b, s, cond: rest || 'al' }
  }
  throw new Error(`reference model: unknown mnemonic ${m}`)
}

type Operand = { kind: 'reg'; n: number } | { kind: 'imm'; v: number } | { kind: 'shift'; type: string; amount: number }

function parseOperand(t: string): Operand {
  t = t.trim()
  let m = /^r(\d+)$/.exec(t)
  if (m) return { kind: 'reg', n: Number(m[1]) }
  if (t === 'sp') return { kind: 'reg', n: 13 }
  if (t === 'lr') return { kind: 'reg', n: 14 }
  if (t === 'pc') return { kind: 'reg', n: 15 }
  m = /^#(-?(?:0x[0-9a-f]+|\d+))$/.exec(t)
  if (m) return { kind: 'imm', v: Number(m[1]) }
  if (t === 'rrx') return { kind: 'shift', type: 'rrx', amount: 1 }
  m = /^(lsl|lsr|asr|ror)\s+#(\d+)$/.exec(t)
  if (m) return { kind: 'shift', type: m[1], amount: Number(m[2]) }
  throw new Error(`reference model: bad operand ${t}`)
}

/** carry-out of a modified immediate: rotated encodings (value outside the 4 replicate patterns) set C = bit 31 */
function immCarry(v: number, cin: number): number {
  v >>>= 0
  const b = v & 0xff
  if (v <= 0xff) return cin
  if (v === ((b << 16) | b) >>> 0) return cin
  if (v === ((b << 24) | (b << 8)) >>> 0 && (v & 0xff) === 0) return cin
  if (v === ((b << 24) | (b << 16) | (b << 8) | b) >>> 0) return cin
  const hb = (v >>> 8) & 0xff
  if (v === ((hb << 24) | (hb << 8)) >>> 0) return cin
  return v >>> 31
}

/** execute `text` (one instruction or a ';'-separated sequence incl. IT) on `st` */
export function refExec(text: string, st: RefState): void {
  const parts = text.split(';').map((p) => p.trim()).filter(Boolean)
  let itConds: string[] = []
  for (const p of parts) {
    const sp = p.indexOf(' ')
    const mn = (sp < 0 ? p : p.slice(0, sp)).toLowerCase()
    const ops = sp < 0 ? [] : p.slice(sp + 1).split(',').map((o) => o.trim())
    const itm = /^it([te]{0,3})$/.exec(mn)
    if (itm) {
      const first = COND_ALIAS[ops[0]] ?? ops[0]
      const inv = CONDS[CONDS.indexOf(first) ^ 1]
      itConds = [first, ...itm[1].split('').map((x) => (x === 't' ? first : inv))]
      continue
    }
    const mnem = parseMnemonic(mn)
    if (itConds.length) {
      const c = itConds.shift()!
      if ((COND_ALIAS[mnem.cond] ?? mnem.cond) !== c) throw new Error(`reference model: ${p} does not match IT condition ${c}`)
    }
    if (!condHolds(st, mnem.cond)) continue
    execOne(mnem, ops.map(parseOperand), st)
  }
}

function setNZ(st: RefState, v: number): void {
  st.n = (v >>> 31) & 1
  st.z = v >>> 0 === 0 ? 1 : 0
}

function execOne(m: Mnemonic, ops: Operand[], st: RefState): void {
  const R = st.r
  const reg = (o: Operand): number => {
    if (o.kind !== 'reg') throw new Error('register expected')
    return R[o.n] >>> 0
  }
  const rn = (o: Operand): number => {
    if (o.kind !== 'reg') throw new Error('register expected')
    return o.n
  }
  const imm = (o: Operand): number => {
    if (o.kind !== 'imm') throw new Error('immediate expected')
    return o.v
  }
  /** operand 2: register (optionally shifted) or immediate → value and shifter carry */
  const op2 = (list: Operand[]): { v: number; c: number } => {
    const o = list[0]
    if (o.kind === 'imm') return { v: o.v >>> 0, c: immCarry(o.v, st.c) }
    const x = reg(o)
    const sh = list[1]
    if (sh && sh.kind === 'shift') return shiftC(x, sh.type, sh.amount, st.c)
    return { v: x, c: st.c }
  }
  const w = (d: number, v: number) => {
    R[d] = v >>> 0
  }
  const b = m.base
  switch (b) {
    case 'and':
    case 'orr':
    case 'eor':
    case 'bic':
    case 'orn':
    case 'add':
    case 'adc':
    case 'sub':
    case 'sbc':
    case 'rsb': {
      // Rd, Rn, op2   or (16-bit two-operand form) Rdn, Rm
      let d: number
      let x: number
      let rest: Operand[]
      if (ops.length === 2) {
        d = rn(ops[0])
        x = reg(ops[0])
        rest = ops.slice(1)
      } else {
        d = rn(ops[0])
        x = reg(ops[1])
        rest = ops.slice(2)
      }
      const y = op2(rest)
      let res: number
      let arith: { result: number; c: number; v: number } | null = null
      switch (b) {
        case 'and':
          res = x & y.v
          break
        case 'orr':
          res = x | y.v
          break
        case 'eor':
          res = x ^ y.v
          break
        case 'bic':
          res = x & ~y.v
          break
        case 'orn':
          res = x | ~y.v
          break
        case 'add':
          arith = addWithCarry(x, y.v, 0)
          break
        case 'adc':
          arith = addWithCarry(x, y.v, st.c)
          break
        case 'sub':
          arith = addWithCarry(x, ~y.v, 1)
          break
        case 'sbc':
          arith = addWithCarry(x, ~y.v, st.c)
          break
        default:
          arith = addWithCarry(~x, y.v, 1)
      }
      if (arith) res = arith.result
      w(d, res!)
      if (m.s) {
        setNZ(st, res!)
        if (arith) {
          st.c = arith.c
          st.v = arith.v
        } else st.c = y.c
      }
      return
    }
    case 'addw':
      return w(rn(ops[0]), reg(ops[1]) + imm(ops[2]))
    case 'subw':
      return w(rn(ops[0]), reg(ops[1]) - imm(ops[2]))
    case 'mov':
    case 'mvn': {
      const y = op2(ops.slice(1))
      const res = b === 'mov' ? y.v : ~y.v
      w(rn(ops[0]), res)
      if (m.s) {
        setNZ(st, res)
        st.c = y.c
      }
      return
    }
    case 'movw':
      return w(rn(ops[0]), imm(ops[1]))
    case 'movt':
      return w(rn(ops[0]), ((imm(ops[1]) << 16) | (R[rn(ops[0])] & 0xffff)) >>> 0)
    case 'neg': {
      const a = addWithCarry(~reg(ops[1]), 0, 1)
      w(rn(ops[0]), a.result)
      if (m.s) {
        setNZ(st, a.result)
        st.c = a.c
        st.v = a.v
      }
      return
    }
    case 'tst':
    case 'teq': {
      const y = op2(ops.slice(1))
      const res = b === 'tst' ? reg(ops[0]) & y.v : reg(ops[0]) ^ y.v
      setNZ(st, res)
      st.c = y.c
      return
    }
    case 'cmp':
    case 'cmn': {
      const y = op2(ops.slice(1))
      const a = b === 'cmp' ? addWithCarry(reg(ops[0]), ~y.v, 1) : addWithCarry(reg(ops[0]), y.v, 0)
      setNZ(st, a.result)
      st.c = a.c
      st.v = a.v
      return
    }
    case 'lsl':
    case 'lsr':
    case 'asr':
    case 'ror': {
      // Rd, Rm, #imm | Rd, Rn, Rm | Rdn, Rm
      let d: number
      let x: number
      let amount: number
      if (ops.length === 2) {
        d = rn(ops[0])
        x = reg(ops[0])
        amount = reg(ops[1]) & 0xff
      } else if (ops[2].kind === 'imm') {
        d = rn(ops[0])
        x = reg(ops[1])
        amount = ops[2].v
      } else {
        d = rn(ops[0])
        x = reg(ops[1])
        amount = reg(ops[2]) & 0xff
      }
      const r = amount === 0 ? { v: x, c: st.c } : shiftC(x, b, amount, st.c)
      w(d, r.v)
      if (m.s) {
        setNZ(st, r.v)
        st.c = r.c
      }
      return
    }
    case 'rrx': {
      const r = shiftC(reg(ops[1]), 'rrx', 1, st.c)
      w(rn(ops[0]), r.v)
      if (m.s) {
        setNZ(st, r.v)
        st.c = r.c
      }
      return
    }
    case 'mul': {
      const res = u32(big(reg(ops[1])) * big(reg(ops[2])))
      w(rn(ops[0]), res)
      if (m.s) setNZ(st, res)
      return
    }
    case 'mla':
      return w(rn(ops[0]), u32(big(reg(ops[1])) * big(reg(ops[2])) + big(reg(ops[3]))))
    case 'mls':
      return w(rn(ops[0]), u32(big(reg(ops[3])) - big(reg(ops[1])) * big(reg(ops[2]))))
    case 'umull':
    case 'smull':
    case 'umlal':
    case 'smlal': {
      const signed = b[0] === 's'
      const x = signed ? s32(reg(ops[2])) : big(reg(ops[2]))
      const y = signed ? s32(reg(ops[3])) : big(reg(ops[3]))
      let p = x * y
      if (b.endsWith('lal')) p += (big(R[rn(ops[1])]) << 32n) | big(R[rn(ops[0])])
      w(rn(ops[0]), u32(p))
      w(rn(ops[1]), u32(p >> 32n))
      return
    }
    case 'sdiv':
    case 'udiv': {
      const y = b === 'sdiv' ? s32(reg(ops[2])) : big(reg(ops[2]))
      const x = b === 'sdiv' ? s32(reg(ops[1])) : big(reg(ops[1]))
      // RoundTowardsZero; division by zero yields 0 (CCR.DIV_0_TRP = 0)
      w(rn(ops[0]), y === 0n ? 0 : u32(x / y))
      return
    }
    case 'bfi':
    case 'bfc': {
      const d = rn(ops[0])
      const lsb = imm(ops[b === 'bfi' ? 2 : 1])
      const width = imm(ops[b === 'bfi' ? 3 : 2])
      const mask = ((1n << BigInt(width)) - 1n) << BigInt(lsb)
      const src = b === 'bfi' ? big(reg(ops[1])) << BigInt(lsb) : 0n
      w(d, u32((big(R[d]) & ~mask) | (src & mask)))
      return
    }
    case 'ubfx':
    case 'sbfx': {
      const lsb = imm(ops[2])
      const width = imm(ops[3])
      let f = (big(reg(ops[1])) >> BigInt(lsb)) & ((1n << BigInt(width)) - 1n)
      if (b === 'sbfx' && f >> BigInt(width - 1)) f -= 1n << BigInt(width)
      w(rn(ops[0]), u32(f))
      return
    }
    case 'sxtb':
    case 'sxth':
    case 'uxtb':
    case 'uxth': {
      const rot = ops[2] && ops[2].kind === 'shift' ? ops[2].amount : 0
      const v = shiftC(reg(ops[1]), 'ror', rot, 0).v
      const bits = b.endsWith('b') ? 8 : 16
      let f = big(v) & ((1n << BigInt(bits)) - 1n)
      if (b[0] === 's' && f >> BigInt(bits - 1)) f -= 1n << BigInt(bits)
      w(rn(ops[0]), u32(f))
      return
    }
    case 'rev': {
      const x = reg(ops[1])
      w(rn(ops[0]), ((x & 0xff) << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24))
      return
    }
    case 'rev16': {
      const x = reg(ops[1])
      const bytes = [x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff]
      w(rn(ops[0]), bytes[1] | (bytes[0] << 8) | (bytes[3] << 16) | (bytes[2] << 24))
      return
    }
    case 'revsh': {
      const x = reg(ops[1])
      let h = ((x & 0xff) << 8) | ((x >>> 8) & 0xff)
      if (h & 0x8000) h -= 0x10000
      w(rn(ops[0]), h)
      return
    }
    case 'rbit': {
      const x = reg(ops[1])
      let r = 0
      for (let i = 0; i < 32; i++) if ((x >>> i) & 1) r |= 1 << (31 - i)
      w(rn(ops[0]), r)
      return
    }
    case 'clz': {
      const x = reg(ops[1])
      let n = 0
      while (n < 32 && ((x >>> (31 - n)) & 1) === 0) n++
      w(rn(ops[0]), n)
      return
    }
    case 'ssat':
    case 'usat': {
      const sat = imm(ops[1])
      let operand = s32(reg(ops[2]))
      const sh = ops[3]
      if (sh && sh.kind === 'shift') operand = sh.type === 'lsl' ? s32(u32(operand << BigInt(sh.amount))) : operand >> BigInt(sh.amount)
      let max: bigint
      let min: bigint
      if (b === 'ssat') {
        max = (1n << BigInt(sat - 1)) - 1n
        min = -(1n << BigInt(sat - 1))
      } else {
        max = (1n << BigInt(sat)) - 1n
        min = 0n
      }
      let r = operand
      if (operand > max) {
        r = max
        st.q = 1
      } else if (operand < min) {
        r = min
        st.q = 1
      }
      w(rn(ops[0]), u32(r))
      return
    }
    case 'nop':
      return
  }
  throw new Error(`reference model: ${b} not modeled`)
}

/** APSR as MRS returns it (N Z C V Q in bits 31..27) */
export function apsrOf(st: RefState): number {
  return ((st.n << 31) | (st.z << 30) | (st.c << 29) | (st.v << 28) | (st.q << 27)) >>> 0
}

export function stateFrom(r0: number, r1: number, r2: number, r3: number, apsr: number): RefState {
  const r = new Array<number>(16).fill(0)
  r[0] = r0 >>> 0
  r[1] = r1 >>> 0
  r[2] = r2 >>> 0
  r[3] = r3 >>> 0
  return { r, n: (apsr >>> 31) & 1, z: (apsr >>> 30) & 1, c: (apsr >>> 29) & 1, v: (apsr >>> 28) & 1, q: (apsr >>> 27) & 1 }
}
