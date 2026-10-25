/**
 * Dense nodal-analysis solver (Norton-only stamps) for the simulator.
 * Owned by the sim-core agent.
 *
 * The matrix is a pure conductance matrix: every source is stamped as a
 * Norton equivalent (G += 1/rout, I += v/rout). No group-2 voltage-source
 * rows exist. A gmin leak (1e-9 S) from every node to ground keeps floating
 * nets from making the matrix singular.
 *
 * Nonlinear devices iterate Newton-Raphson around the solve: each iteration
 * the devices restamp their linearized companions at the current candidate
 * solution (with pn-junction voltage-step limiting via `pnLimit`).
 *
 * Linear circuits factor once: `factorIfNeeded()` compares the freshly
 * stamped matrix to the last factored one and reuses the LU decomposition
 * when nothing changed (only forward/back substitution runs per step).
 */

/** Leak conductance from every node to ground (S). */
export const GMIN = 1e-9
/** Maximum Newton-Raphson iterations per solve. */
export const NR_MAX_ITERS = 40
/** Newton-Raphson absolute convergence tolerance (V). */
export const NR_TOL = 1e-6
/** Maximum pn-junction voltage step per NR iteration (V). */
export const PN_MAX_STEP = 0.5

/**
 * SPICE-style junction voltage limiting: clamp the change of a junction
 * voltage between NR iterations to ±maxStep so the exponential diode law
 * cannot explode. Returns the limited voltage.
 */
export function pnLimit(vNew: number, vOld: number, maxStep: number = PN_MAX_STEP): number {
  const dv = vNew - vOld
  if (dv > maxStep) return vOld + maxStep
  if (dv < -maxStep) return vOld - maxStep
  return vNew
}

/**
 * Stamping interface handed to devices/chips. Node index -1 means ground
 * (the reference): stamps touching ground rows/columns are silently dropped,
 * which is exactly the reduced-MNA behavior.
 */
export interface StampContext {
  readonly nodeCount: number
  /** Raw matrix element: A[row][col] += value (skipped for ground nodes). */
  addElement(row: number, col: number, value: number): void
  /** Two-terminal conductance g between nodes a and b. */
  addConductance(a: number, b: number, g: number): void
  /** Independent current source injecting `current` amps INTO `node`. */
  addCurrent(node: number, current: number): void
  /** Thevenin source {v, rout} between plus and minus, stamped as a Norton. */
  addNorton(plus: number, minus: number, v: number, rout: number): void
}

const SINGULAR_EPS = 1e-13

/**
 * PERF — structural sparsity with bit-identical results.
 *
 * Circuit matrices are extremely sparse (2–4 entries per row), yet the
 * reference algorithm is a dense LU with partial pivoting whose O(n²) scans
 * and copies dominated every Newton iteration. MnaSystem keeps the DENSE
 * row-major storage and the reference arithmetic, but knows which entries
 * may be nonzero, so every pass visits only those:
 *
 *  - stamping records each touched entry of `a` (the diagonal always);
 *    beginStamp clears just those, the reuse test compares just those (plus
 *    the previously factored ones) and luSrc copies just those;
 *  - the first factorization of a structure runs a SYMBOLIC elimination
 *    (pivot rows found numerically, fill-in tracked structurally) and records
 *    it as a plan: per pivot column the rows that may be nonzero there and the
 *    columns the pivot row may hold. Later factorizations whose stamped
 *    structure lies inside the plan replay it over those lists only; a pivot
 *    that differs from the plan's re-plans;
 *  - substitution walks the plan's per-row L/U lists in ascending column order.
 *
 * Why the results equal the dense algorithm's bit for bit:
 *  - a skipped elimination update is lu[i][j] −= m·(±0) with a finite m: it
 *    leaves lu[i][j] unchanged unless lu[i][j] is −0, and no −0 ever exists in
 *    the trailing submatrix (stamping sums start at +0, and IEEE subtraction
 *    yields −0 only from a −0 operand). A non-finite multiplier (m·0 = NaN)
 *    hands the factorization to the dense reference;
 *  - pivots: the same candidates (rows outside the lists hold +0, which never
 *    wins) and the same winner (the first maximum = the smallest row index
 *    among equal magnitudes);
 *  - rows the dense code visits with a zero column-k entry only store a ±0
 *    multiplier: the sign of an L-part zero changes no product's contribution
 *    (s − (±0) = s while s ≠ −0, and 0·x is NaN for non-finite x either way);
 *  - substitution: a skipped term is 0·x[j] = ±0 for finite x[j], the others
 *    accumulate in the same column order; a solve that ends with a non-finite
 *    x is redone densely (non-finite values propagate into the final x, so an
 *    all-finite result never met one).
 * Pinned by tests/perf-mna.test.ts (randomized differential vs the dense
 * reference), tests/sim/legacy-equivalence.test.ts and tests/perf-sim.test.ts.
 */
export class MnaSystem implements StampContext {
  readonly nodeCount: number

  /** workspace for NR (the "next" candidate solution) */
  readonly scratch: Float64Array

  private readonly a: Float64Array // stamped conductance matrix (row-major)
  private readonly b: Float64Array // stamped RHS current vector
  private readonly lu: Float64Array // LU factors (in place, unit lower diag)
  private readonly luSrc: Float64Array // copy of the matrix that was factored
  private readonly perm: Int32Array // row-swap record from partial pivoting
  private hasFactor = false

  // ---- structure of `a`: entries touched since beginStamp (diagonal first)
  private readonly aMark: Uint8Array
  private readonly aList: Int32Array
  private aCount = 0
  // ---- structure of `luSrc`: the entries copied at the last factorization
  private readonly srcList: Int32Array
  private srcCount = 0

  // ---- the elimination plan (valid while `planned`)
  private planned = false
  /** `lu` was last written by the dense reference (structure unknown) */
  private luDense = false
  /** plan: entries of the source structure it was built from */
  private readonly planInit: Uint8Array
  /** plan: every entry of lu that may be nonzero (reset list) */
  private readonly luMark: Uint8Array
  private readonly luList: Int32Array
  private luCount = 0
  /** plan: pivot row of each step */
  private readonly planPerm: Int32Array
  /** plan: per step k, rows (> k) that may be nonzero in column k — flat, k·n + t */
  private readonly colRows: Int32Array
  private readonly colLen: Int32Array
  /** plan: per step k, columns (> k) the pivot row may hold — flat, k·n + t */
  private readonly nzCols: Int32Array
  private readonly nzLen: Int32Array
  /** plan: per row, ascending L columns (j < i) and U columns (j > i) — flat, i·n + t */
  private readonly rowL: Int32Array
  private readonly rowLLen: Int32Array
  private readonly rowU: Int32Array
  private readonly rowULen: Int32Array
  /** symbolic elimination step in progress (−1: loading the source) */
  private curK = -1

  constructor(nodeCount: number) {
    const n = Math.max(0, nodeCount | 0)
    this.nodeCount = n
    const n2 = n * n
    this.a = new Float64Array(n2)
    this.b = new Float64Array(n)
    this.lu = new Float64Array(n2)
    this.luSrc = new Float64Array(n2)
    this.perm = new Int32Array(n)
    this.scratch = new Float64Array(n)
    this.aMark = new Uint8Array(n2)
    this.aList = new Int32Array(n2)
    this.srcList = new Int32Array(n2)
    this.planInit = new Uint8Array(n2)
    this.luMark = new Uint8Array(n2)
    this.luList = new Int32Array(n2)
    this.planPerm = new Int32Array(n)
    this.colRows = new Int32Array(n2)
    this.colLen = new Int32Array(n)
    this.nzCols = new Int32Array(n2)
    this.nzLen = new Int32Array(n)
    this.rowL = new Int32Array(n2)
    this.rowLLen = new Int32Array(n)
    this.rowU = new Int32Array(n2)
    this.rowULen = new Int32Array(n)
    // the diagonal (gmin) is always part of the stamped structure
    for (let i = 0; i < n; i++) {
      const d = i * n + i
      this.aMark[d] = 1
      this.aList[i] = d
    }
    this.aCount = n
  }

  /** Reset matrix and RHS for a fresh stamping pass (gmin on the diagonal). */
  beginStamp(): void {
    const n = this.nodeCount
    const a = this.a
    const mark = this.aMark
    const list = this.aList
    for (let t = n; t < this.aCount; t++) {
      const idx = list[t]
      a[idx] = 0
      mark[idx] = 0
    }
    this.aCount = n
    this.b.fill(0)
    for (let i = 0; i < n; i++) a[i * n + i] = GMIN
  }

  /** a[idx] is about to be stamped: record it in the structure */
  private touch(idx: number): void {
    if (this.aMark[idx] === 0) {
      this.aMark[idx] = 1
      this.aList[this.aCount++] = idx
    }
  }

  addElement(row: number, col: number, value: number): void {
    if (row >= 0 && col >= 0) {
      const idx = row * this.nodeCount + col
      this.touch(idx)
      this.a[idx] += value
    }
  }

  addConductance(a: number, b: number, g: number): void {
    const n = this.nodeCount
    if (a >= 0) this.a[a * n + a] += g
    if (b >= 0) this.a[b * n + b] += g
    if (a >= 0 && b >= 0) {
      const ab = a * n + b
      const ba = b * n + a
      this.touch(ab)
      this.touch(ba)
      this.a[ab] -= g
      this.a[ba] -= g
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

  /**
   * Factor the stamped matrix with LU + partial pivoting, unless it is
   * bit-identical to the last factored matrix (then the old factorization is
   * reused — linear circuits factor once). Returns false if singular.
   */
  factorIfNeeded(): boolean {
    const n = this.nodeCount
    if (n === 0) return true
    if (this.hasFactor && this.sameAsFactored()) return true

    // luSrc ← a (only the two structures can hold nonzeros)
    const a = this.a
    const luSrc = this.luSrc
    const src = this.srcList
    for (let t = 0; t < this.srcCount; t++) luSrc[src[t]] = 0
    const list = this.aList
    const cnt = this.aCount
    let inPlan = this.planned
    const planInit = this.planInit
    for (let t = 0; t < cnt; t++) {
      const idx = list[t]
      luSrc[idx] = a[idx]
      src[t] = idx
      if (planInit[idx] === 0) inPlan = false
    }
    this.srcCount = cnt

    let r = inPlan ? this.factorPlanned() : RE_PLAN
    if (r === RE_PLAN) r = this.factorSymbolic()
    if (r === DENSE) {
      // a non-finite multiplier: the dense reference handles it exactly
      this.planned = false
      this.luDense = true
      this.hasFactor = this.factorDense()
      return this.hasFactor
    }
    this.hasFactor = r === OK
    return this.hasFactor
  }

  /** a === luSrc entry for entry (the dense test, over the two structures) */
  private sameAsFactored(): boolean {
    const a = this.a
    const luSrc = this.luSrc
    const list = this.aList
    for (let t = 0; t < this.aCount; t++) {
      const idx = list[t]
      if (a[idx] !== luSrc[idx]) return false
    }
    // entries factored last time but not stamped now: a holds +0 there
    const mark = this.aMark
    const src = this.srcList
    for (let t = 0; t < this.srcCount; t++) {
      const idx = src[t]
      if (mark[idx] === 0 && luSrc[idx] !== 0) return false
    }
    return true
  }

  /** zero every entry of lu that may be nonzero, forget the old plan */
  private clearLu(): void {
    const lu = this.lu
    if (this.luDense) {
      lu.fill(0)
      this.luMark.fill(0)
      this.planInit.fill(0)
      this.luDense = false
    } else {
      const list = this.luList
      const mark = this.luMark
      const init = this.planInit
      for (let t = 0; t < this.luCount; t++) {
        const idx = list[t]
        lu[idx] = 0
        mark[idx] = 0
        init[idx] = 0
      }
    }
    this.luCount = 0
    this.planned = false
  }

  /** lu[idx] (row i, column j) may become nonzero: add it to the plan structure */
  private luTouch(idx: number, i: number, j: number): void {
    if (this.luMark[idx] !== 0) return
    this.luMark[idx] = 1
    this.luList[this.luCount++] = idx
    // rows of a column still to be eliminated
    if (i > j && j > this.curK) this.colRows[j * this.nodeCount + this.colLen[j]++] = i
  }

  /**
   * Symbolic + numeric elimination of luSrc into lu, recording the plan.
   * Structure is tracked independently of values (a zero entry keeps its
   * place), so the plan stays a superset for later values.
   */
  private factorSymbolic(): number {
    const n = this.nodeCount
    const lu = this.lu
    const luSrc = this.luSrc
    const luMark = this.luMark
    const colRows = this.colRows
    const colLen = this.colLen
    const nzCols = this.nzCols
    const nzLen = this.nzLen
    const perm = this.perm
    this.clearLu()
    colLen.fill(0)
    this.curK = -1
    const src = this.srcList
    const planInit = this.planInit
    for (let t = 0; t < this.srcCount; t++) {
      const idx = src[t]
      lu[idx] = luSrc[idx]
      planInit[idx] = 1
      const i = (idx / n) | 0
      this.luTouch(idx, i, idx - i * n)
    }

    for (let k = 0; k < n; k++) {
      this.curK = k
      const kk = k * n
      const cBase = kk
      const cLen = colLen[k]
      // partial pivoting: the first maximal |entry| in column k at/below row k
      let p = k
      let max = Math.abs(lu[kk + k])
      for (let t = 0; t < cLen; t++) {
        const i = colRows[cBase + t]
        const v = Math.abs(lu[i * n + k])
        if (v > max || (v === max && i < p)) {
          max = v
          p = i
        }
      }
      if (!(max > SINGULAR_EPS)) return SINGULAR
      perm[k] = p
      if (p !== k) {
        // swap values and structure (marks follow the entries they describe)
        const pp = p * n
        for (let j = 0; j < n; j++) {
          const t = lu[kk + j]
          lu[kk + j] = lu[pp + j]
          lu[pp + j] = t
          const mk = luMark[kk + j]
          const mp = luMark[pp + j]
          if (mp !== 0 && mk === 0) this.luTouch(kk + j, k, j)
          if (mk !== 0 && mp === 0) this.luTouch(pp + j, p, j)
        }
      }
      // columns the pivot row may hold right of the diagonal
      let c = 0
      for (let j = k + 1; j < n; j++) if (luMark[kk + j] !== 0) nzCols[kk + c++] = j
      nzLen[k] = c
      const pivInv = 1 / lu[kk + k]
      let dense = false
      for (let t = 0; t < cLen; t++) {
        const i = colRows[cBase + t]
        const ii = i * n
        // structural fill-in, whatever the values are this time
        for (let s = 0; s < c; s++) {
          const j = nzCols[kk + s]
          if (luMark[ii + j] === 0) this.luTouch(ii + j, i, j)
        }
        const m = lu[ii + k] * pivInv
        lu[ii + k] = m
        if (m !== 0) {
          if (m - m !== 0) dense = true // non-finite multiplier
          for (let s = 0; s < c; s++) {
            const j = nzCols[kk + s]
            lu[ii + j] -= m * lu[kk + j]
          }
        }
      }
      if (dense) return DENSE
    }
    this.planPerm.set(perm)
    this.buildRows()
    this.curK = -1
    this.planned = true
    return OK
  }

  /** Replay the recorded plan over the current luSrc. */
  private factorPlanned(): number {
    const n = this.nodeCount
    const lu = this.lu
    const luSrc = this.luSrc
    const colRows = this.colRows
    const colLen = this.colLen
    const nzCols = this.nzCols
    const nzLen = this.nzLen
    const planPerm = this.planPerm
    const perm = this.perm
    // reset to the source matrix
    const list = this.luList
    for (let t = 0; t < this.luCount; t++) lu[list[t]] = 0
    const src = this.srcList
    for (let t = 0; t < this.srcCount; t++) {
      const idx = src[t]
      lu[idx] = luSrc[idx]
    }

    for (let k = 0; k < n; k++) {
      const kk = k * n
      const cLen = colLen[k]
      let p = k
      let max = Math.abs(lu[kk + k])
      for (let t = 0; t < cLen; t++) {
        const i = colRows[kk + t]
        const v = Math.abs(lu[i * n + k])
        if (v > max || (v === max && i < p)) {
          max = v
          p = i
        }
      }
      if (!(max > SINGULAR_EPS)) return SINGULAR
      if (p !== planPerm[k]) return RE_PLAN
      perm[k] = p
      if (p !== k) {
        const pp = p * n
        for (let j = 0; j < n; j++) {
          const t = lu[kk + j]
          lu[kk + j] = lu[pp + j]
          lu[pp + j] = t
        }
      }
      const c = nzLen[k]
      const pivInv = 1 / lu[kk + k]
      for (let t = 0; t < cLen; t++) {
        const ii = colRows[kk + t] * n
        const m = lu[ii + k] * pivInv
        lu[ii + k] = m
        if (m !== 0) {
          if (m - m !== 0) return DENSE
          for (let s = 0; s < c; s++) {
            const j = nzCols[kk + s]
            lu[ii + j] -= m * lu[kk + j]
          }
        }
      }
    }
    return OK
  }

  /** per-row L/U column lists of the plan structure, each ascending */
  private buildRows(): void {
    const n = this.nodeCount
    const rowL = this.rowL
    const rowU = this.rowU
    const lLen = this.rowLLen
    const uLen = this.rowULen
    lLen.fill(0)
    uLen.fill(0)
    const list = this.luList
    for (let t = 0; t < this.luCount; t++) {
      const idx = list[t]
      const i = (idx / n) | 0
      const j = idx - i * n
      if (j < i) rowL[i * n + lLen[i]++] = j
      else if (j > i) rowU[i * n + uLen[i]++] = j
    }
    for (let i = 0; i < n; i++) {
      sortRange(rowL, i * n, lLen[i])
      sortRange(rowU, i * n, uLen[i])
    }
  }

  /** The reference dense LU with partial pivoting of luSrc into lu. */
  private factorDense(): boolean {
    const n = this.nodeCount
    const lu = this.lu
    lu.set(this.luSrc)
    const perm = this.perm

    for (let k = 0; k < n; k++) {
      // partial pivoting: pick the largest |entry| in column k at/below row k
      let p = k
      let max = Math.abs(lu[k * n + k])
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(lu[i * n + k])
        if (v > max) {
          max = v
          p = i
        }
      }
      if (!(max > SINGULAR_EPS)) return false
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
    return true
  }

  /** Solve A x = b using the current factorization, writing into `x`. */
  solveInto(x: Float64Array): void {
    const n = this.nodeCount
    if (n === 0) return
    if (!this.hasFactor) return
    if (!this.planned || !this.solveSparse(x)) this.solveDense(x)
  }

  /** substitution over the plan's row lists; false = a non-finite result */
  private solveSparse(x: Float64Array): boolean {
    const n = this.nodeCount
    const lu = this.lu
    const perm = this.perm
    const rowL = this.rowL
    const rowU = this.rowU
    const lLen = this.rowLLen
    const uLen = this.rowULen
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
      const len = lLen[i]
      if (len === 0) continue
      const row = i * n
      let s = x[i]
      for (let t = 0; t < len; t++) {
        const j = rowL[row + t]
        s -= lu[row + j] * x[j]
      }
      x[i] = s
    }
    let finite = true
    for (let i = n - 1; i >= 0; i--) {
      const row = i * n
      let s = x[i]
      const len = uLen[i]
      for (let t = 0; t < len; t++) {
        const j = rowU[row + t]
        s -= lu[row + j] * x[j]
      }
      const v = s / lu[row + i]
      x[i] = v
      if (v - v !== 0) finite = false
    }
    return finite
  }

  /** The reference dense forward/back substitution. */
  private solveDense(x: Float64Array): void {
    const n = this.nodeCount
    const lu = this.lu
    const perm = this.perm
    x.set(this.b)
    // apply recorded row swaps
    for (let k = 0; k < n; k++) {
      const p = perm[k]
      if (p !== k) {
        const t = x[k]
        x[k] = x[p]
        x[p] = t
      }
    }
    // forward substitution (L has unit diagonal)
    for (let i = 1; i < n; i++) {
      let s = x[i]
      const row = i * n
      for (let j = 0; j < i; j++) s -= lu[row + j] * x[j]
      x[i] = s
    }
    // back substitution
    for (let i = n - 1; i >= 0; i--) {
      let s = x[i]
      const row = i * n
      for (let j = i + 1; j < n; j++) s -= lu[row + j] * x[j]
      x[i] = s / lu[row + i]
    }
  }
}

/** factorization outcomes */
const OK = 0
const SINGULAR = 1
const DENSE = 2
const RE_PLAN = 3

/** insertion sort of a[start, start + len) ascending (tiny lists) */
function sortRange(a: Int32Array, start: number, len: number): void {
  const end = start + len
  for (let i = start + 1; i < end; i++) {
    const v = a[i]
    let j = i - 1
    while (j >= start && a[j] > v) {
      a[j + 1] = a[j]
      j--
    }
    a[j + 1] = v
  }
}

export interface NewtonResult {
  converged: boolean
  iterations: number
  singular: boolean
}

/**
 * Newton-Raphson outer loop. `stampAll(x)` must restamp every device at the
 * candidate solution `x` (devices apply their own junction limiting and
 * remember the limited operating point between iterations).
 *
 * `x` is used as the initial guess and receives the final solution.
 */
export function solveNewton(
  sys: MnaSystem,
  stampAll: (x: Float64Array) => void,
  x: Float64Array,
  maxIter: number = NR_MAX_ITERS,
  tol: number = NR_TOL,
): NewtonResult {
  const n = sys.nodeCount
  if (n === 0) return { converged: true, iterations: 0, singular: false }
  const xNext = sys.scratch

  for (let iter = 1; iter <= maxIter; iter++) {
    sys.beginStamp()
    stampAll(x)
    if (!sys.factorIfNeeded()) {
      return { converged: false, iterations: iter, singular: true }
    }
    sys.solveInto(xNext)

    let maxDelta = 0
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xNext[i] - x[i])
      if (d > maxDelta) maxDelta = d
    }
    x.set(xNext)
    if (maxDelta < tol) return { converged: true, iterations: iter, singular: false }
    if (!Number.isFinite(maxDelta)) return { converged: false, iterations: iter, singular: false }
  }
  return { converged: false, iterations: maxIter, singular: false }
}
