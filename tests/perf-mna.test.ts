/**
 * MnaSystem structural-sparsity fast path (src/sim/mna.ts): randomized
 * differential test against the dense reference algorithm it replaced.
 *
 * Every stamping pass is applied to both systems; factorIfNeeded() must give
 * the same verdict and solveInto() the same solution BIT FOR BIT (Object.is
 * per element, so ±0 and NaN placement count). The passes cover the paths of
 * the fast implementation: LU reuse (identical matrix), plan replay (same
 * structure, new values), re-planning (new structure / a different pivot
 * row), entries stamped with value 0, asymmetric stamps that force row swaps,
 * exactly singular matrices and non-finite stamps (dense fallback).
 */
import { describe, expect, it } from 'vitest'
import { GMIN, MnaSystem, solveNewton, type StampContext } from '../src/sim/mna'

/** The original dense MnaSystem, verbatim (the bit-exact reference). */
class DenseReference implements StampContext {
  readonly nodeCount: number
  private readonly a: Float64Array
  private readonly b: Float64Array
  private readonly lu: Float64Array
  private readonly luSrc: Float64Array
  private readonly perm: Int32Array
  /** solveNewton's iterate buffer (MnaSystem.scratch) */
  readonly scratch: Float64Array
  private hasFactor = false

  constructor(nodeCount: number) {
    const n = Math.max(0, nodeCount | 0)
    this.nodeCount = n
    this.a = new Float64Array(n * n)
    this.b = new Float64Array(n)
    this.lu = new Float64Array(n * n)
    this.luSrc = new Float64Array(n * n)
    this.perm = new Int32Array(n)
    this.scratch = new Float64Array(n)
  }

  beginStamp(): void {
    const n = this.nodeCount
    this.a.fill(0)
    this.b.fill(0)
    for (let i = 0; i < n; i++) this.a[i * n + i] = GMIN
  }

  addElement(row: number, col: number, value: number): void {
    if (row >= 0 && col >= 0) this.a[row * this.nodeCount + col] += value
  }

  addConductance(a: number, b: number, g: number): void {
    const n = this.nodeCount
    if (a >= 0) this.a[a * n + a] += g
    if (b >= 0) this.a[b * n + b] += g
    if (a >= 0 && b >= 0) {
      this.a[a * n + b] -= g
      this.a[b * n + a] -= g
    }
  }

  addCurrent(node: number, current: number): void {
    if (node >= 0) this.b[node] += current
  }

  addNorton(plus: number, minus: number, v: number, rout: number): void {
    const r = rout > 1e-6 ? rout : 1e-6
    const g = 1 / r
    this.addConductance(plus, minus, g)
    this.addCurrent(plus, v * g)
    this.addCurrent(minus, -v * g)
  }

  factorIfNeeded(): boolean {
    const n = this.nodeCount
    if (n === 0) return true
    const a = this.a
    const luSrc = this.luSrc
    if (this.hasFactor) {
      let same = true
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== luSrc[i]) {
          same = false
          break
        }
      }
      if (same) return true
    }
    luSrc.set(a)
    const lu = this.lu
    lu.set(a)
    const perm = this.perm
    for (let k = 0; k < n; k++) {
      let p = k
      let max = Math.abs(lu[k * n + k])
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(lu[i * n + k])
        if (v > max) {
          max = v
          p = i
        }
      }
      if (!(max > 1e-13)) {
        this.hasFactor = false
        return false
      }
      perm[k] = p
      if (p !== k) {
        for (let j = 0; j < n; j++) {
          const t = lu[k * n + j]
          lu[k * n + j] = lu[p * n + j]
          lu[p * n + j] = t
        }
      }
      const pivInv = 1 / lu[k * n + k]
      for (let i = k + 1; i < n; i++) {
        const m = lu[i * n + k] * pivInv
        lu[i * n + k] = m
        if (m !== 0) {
          for (let j = k + 1; j < n; j++) lu[i * n + j] -= m * lu[k * n + j]
        }
      }
    }
    this.hasFactor = true
    return true
  }

  solveInto(x: Float64Array): void {
    const n = this.nodeCount
    if (n === 0) return
    if (!this.hasFactor) return
    const lu = this.lu
    const perm = this.perm
    x.set(this.b)
    for (let k = 0; k < n; k++) {
      const p = perm[k]
      if (p !== k) {
        const t = x[k]
        x[k] = x[p]
        x[p] = t
      }
    }
    for (let i = 1; i < n; i++) {
      let s = x[i]
      const row = i * n
      for (let j = 0; j < i; j++) s -= lu[row + j] * x[j]
      x[i] = s
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = x[i]
      const row = i * n
      for (let j = i + 1; j < n; j++) s -= lu[row + j] * x[j]
      x[i] = s / lu[row + i]
    }
  }
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Op =
  | { k: 'g'; a: number; b: number; v: number }
  | { k: 'e'; r: number; c: number; v: number }
  | { k: 'i'; n: number; v: number }
  | { k: 'n'; p: number; m: number; v: number; r: number }

function applyOps(sys: StampContext & { beginStamp(): void }, ops: Op[]): void {
  sys.beginStamp()
  for (const o of ops) {
    if (o.k === 'g') sys.addConductance(o.a, o.b, o.v)
    else if (o.k === 'e') sys.addElement(o.r, o.c, o.v)
    else if (o.k === 'i') sys.addCurrent(o.n, o.v)
    else sys.addNorton(o.p, o.m, o.v, o.r)
  }
}

/** A random circuit-like stamp list: mostly conductances, a few controlled sources. */
function randomOps(r: () => number, n: number, opts: { asym: number; nonFinite: boolean }): Op[] {
  const node = () => Math.floor(r() * (n + 1)) - 1 // −1 = ground
  const ops: Op[] = []
  const count = 1 + Math.floor(r() * (2.5 * n + 2))
  for (let t = 0; t < count; t++) {
    const u = r()
    const mag = Math.pow(10, -6 + r() * 12)
    const v = r() < 0.08 ? 0 : (r() < 0.5 ? -1 : 1) * mag
    if (u < 0.6) ops.push({ k: 'g', a: node(), b: node(), v: Math.abs(v) })
    else if (u < 0.6 + opts.asym) ops.push({ k: 'e', r: node(), c: node(), v })
    else if (u < 0.92) ops.push({ k: 'i', n: node(), v })
    else ops.push({ k: 'n', p: node(), m: node(), v: v * 1e-3, r: Math.pow(10, -7 + r() * 9) })
  }
  if (opts.nonFinite && r() < 0.5) {
    const bad = [NaN, Infinity, -Infinity][Math.floor(r() * 3)]
    ops.push(r() < 0.5 ? { k: 'e', r: node(), c: node(), v: bad } : { k: 'i', n: node(), v: bad })
  }
  return ops
}

/** Same structure, perturbed values (a Newton iteration / the next time step). */
function perturb(r: () => number, ops: Op[]): Op[] {
  return ops.map((o) => {
    if (r() < 0.4) return o
    const f = r() < 0.05 ? 0 : 1 + (r() - 0.5) * 1e-3
    if (o.k === 'g') return { ...o, v: o.v * Math.abs(f) }
    if (o.k === 'e') return { ...o, v: o.v * f }
    if (o.k === 'i') return { ...o, v: o.v * f }
    return { ...o, v: o.v * f }
  })
}

function expectSameVector(got: Float64Array, want: Float64Array, where: string): void {
  for (let i = 0; i < want.length; i++) {
    if (!Object.is(got[i], want[i])) {
      throw new Error(`${where}: x[${i}] = ${got[i]} but the dense reference gives ${want[i]}`)
    }
  }
}

describe('MnaSystem sparse fast path = dense reference, bit for bit', () => {
  it('random circuit-like systems over reuse / replay / re-plan / pivot-change / singular passes', () => {
    let passes = 0
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed)
      const n = 1 + Math.floor(r() * (seed % 7 === 0 ? 60 : 24))
      const fast = new MnaSystem(n)
      const ref = new DenseReference(n)
      const xf = new Float64Array(n)
      const xr = new Float64Array(n)
      const asym = seed % 3 === 0 ? 0.25 : 0.05
      let ops = randomOps(r, n, { asym, nonFinite: seed % 11 === 0 })
      for (let pass = 0; pass < 24; pass++) {
        const u = r()
        if (u < 0.15) {
          /* identical matrix: LU reuse */
        } else if (u < 0.7) ops = perturb(r, ops)
        else if (u < 0.85) ops = randomOps(r, n, { asym, nonFinite: seed % 11 === 0 })
        else if (u < 0.93) {
          // grow the structure a little (re-plan) or drop a stamp
          const extra = randomOps(r, n, { asym, nonFinite: false })
          ops = r() < 0.7 ? [...ops, ...extra.slice(0, 2)] : ops.slice(0, Math.max(0, ops.length - 2))
        } else {
          // exactly cancel a diagonal's gmin → a zero pivot candidate
          const d = Math.floor(r() * n)
          ops = [...ops, { k: 'e', r: d, c: d, v: -GMIN }]
        }
        applyOps(fast, ops)
        applyOps(ref, ops)
        const okF = fast.factorIfNeeded()
        const okR = ref.factorIfNeeded()
        expect(okF, `seed ${seed} pass ${pass}: factor verdict`).toBe(okR)
        xf.fill(7)
        xr.fill(7)
        fast.solveInto(xf)
        ref.solveInto(xr)
        expectSameVector(xf, xr, `seed ${seed} n ${n} pass ${pass}`)
        passes++
      }
    }
    expect(passes).toBe(400 * 24)
  })

  it('Newton iterations on a nonlinear diode-like network stay bit-identical', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(1000 + seed)
      const n = 2 + Math.floor(r() * 30)
      const base: Op[] = randomOps(r, n, { asym: 0.03, nonFinite: false }).filter((o) => o.k !== 'e')
      // diodes between random node pairs, Is = 1e-14, nVt = 0.05
      const diodes: [number, number][] = []
      for (let d = 0; d < 1 + Math.floor(r() * n); d++) {
        diodes.push([Math.floor(r() * n), Math.floor(r() * (n + 1)) - 1])
      }
      const stampWith = (sys: StampContext & { beginStamp(): void }) => (x: Float64Array) => {
        applyOps(sys, base)
        for (const [p, m] of diodes) {
          const vd = Math.min((p >= 0 ? x[p] : 0) - (m >= 0 ? x[m] : 0), 0.9)
          const e = Math.exp(vd / 0.05)
          const gd = (1e-14 / 0.05) * e + 1e-12
          const id = 1e-14 * (e - 1)
          sys.addConductance(p, m, gd)
          sys.addCurrent(p, -(id - gd * vd))
          sys.addCurrent(m, id - gd * vd)
        }
      }
      const fast = new MnaSystem(n)
      const ref = new DenseReference(n)
      const xf = new Float64Array(n)
      const xr = new Float64Array(n)
      for (let step = 0; step < 15; step++) {
        const rf = solveNewton(fast, stampWith(fast), xf)
        const rr = solveNewton(ref as unknown as MnaSystem, stampWith(ref), xr)
        expect(rf).toEqual(rr)
        expectSameVector(xf, xr, `diode seed ${seed} step ${step}`)
        base.push(...perturb(r, base.slice(0, 1)))
      }
    }
  })
})
