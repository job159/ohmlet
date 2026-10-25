/**
 * The lazy timer's closed forms (src/mcu/stm32f1/tim-counter.ts) against
 * the step-by-step reference `stepOnce`, exhaustively over small ARR values
 * and every reachable start state (including counters above ARR).
 */
import { describe, expect, it } from 'vitest'
import { advance, type CountMode, type Counter, type MatchDir, pwm1Active, stepOnce, stepsToEnter, stepsToWrap } from '../../../src/mcu/stm32f1/tim-counter'

const MODES: CountMode[] = ['up', 'down', 'center']

function starts(arr: number): Counter[] {
  const out: Counter[] = []
  for (const cnt of [0, 1, arr - 1, arr, arr + 1, arr + 2, 0xfffe, 0xffff]) {
    if (cnt < 0 || cnt > 0xffff) continue
    out.push({ cnt, down: false }, { cnt, down: true })
  }
  return out
}

/** brute force: steps until the first step ending on v (direction-filtered), within `limit` */
function bruteEnter(mode: CountMode, c0: Counter, arr: number, v: number, dir: MatchDir, limit: number): number {
  const c = { ...c0 }
  for (let s = 1; s <= limit; s++) {
    const r = stepOnce(mode, c, arr)
    if (c.cnt === v && (dir === 'any' || (dir === 'up') === r.up)) return s
  }
  return Infinity
}

describe('tim-counter closed forms vs stepOnce', () => {
  it('stepOnce: edge-aligned and center-aligned sequences (RM0008 Figures 103, 109, 113)', () => {
    const seq = (mode: CountMode, arr: number, c: Counter, n: number) => {
      const out: string[] = []
      for (let i = 0; i < n; i++) {
        const r = stepOnce(mode, c, arr)
        out.push(c.cnt + (r.wrap ? `:${r.wrap}` : ''))
      }
      return out.join(' ')
    }
    expect(seq('up', 3, { cnt: 0, down: false }, 6)).toBe('1 2 3 0:ovf 1 2')
    expect(seq('down', 3, { cnt: 3, down: true }, 6)).toBe('2 1 0 3:unf 2 1')
    expect(seq('center', 3, { cnt: 0, down: false }, 8)).toBe('1 2 3:ovf 2 1 0:unf 1 2')
    // above ARR: up rolls over silently, down passes ARR
    expect(seq('up', 3, { cnt: 0xfffe, down: false }, 4)).toBe('65535 0:roll 1 2')
    expect(seq('down', 3, { cnt: 5, down: true }, 7)).toBe('4 3 2 1 0 3:unf 2')
  })

  it('stepsToWrap / stepsToEnter / advance agree with stepping', () => {
    for (const arr of [1, 2, 3, 5, 8]) {
      for (const mode of MODES) {
        for (const c0 of starts(arr)) {
          // stepsToWrap
          {
            const c = { ...c0 }
            let s = 0
            let r
            do {
              r = stepOnce(mode, c, arr)
              s++
            } while (!r.wrap && s < 0x20000)
            expect(stepsToWrap(mode, c0, arr), `${mode} arr=${arr} ${JSON.stringify(c0)}`).toBe(s)
          }
          // stepsToEnter for every value and direction filter
          const limit = 0x10000 + 4 * arr + 4
          for (const v of [0, 1, arr - 1, arr, arr + 1, 0xffff]) {
            if (v < 0) continue
            for (const dir of ['any', 'up', 'down'] as MatchDir[]) {
              const want = bruteEnter(mode, c0, arr, v, dir, limit)
              expect(stepsToEnter(mode, c0, arr, v, dir), `${mode} arr=${arr} ${JSON.stringify(c0)} v=${v} ${dir}`).toBe(want)
            }
          }
          // advance n steps = n single steps (state and wrap count)
          for (const n of [0, 1, 2, arr, arr + 1, 2 * arr, 2 * arr + 1, 7 * arr + 3, 0x10003]) {
            const a = { ...c0 }
            const b = { ...c0 }
            const wraps = advance(mode, a, arr, n)
            let w = 0
            for (let i = 0; i < n; i++) {
              const r = stepOnce(mode, b, arr)
              if (r.wrap === 'ovf' || r.wrap === 'unf') w++
            }
            expect(a.cnt, `${mode} arr=${arr} ${JSON.stringify(c0)} n=${n}`).toBe(b.cnt)
            if (mode === 'center' && b.cnt > 0 && b.cnt < arr) expect(a.down).toBe(b.down)
            expect(wraps).toBe(w)
          }
        }
      }
    }
  })

  it('PWM mode 1 reference: edge-aligned up/down and center-aligned duty', () => {
    const duty = (mode: CountMode, arr: number, ccr: number) => {
      const c: Counter = { cnt: mode === 'down' ? arr : 0, down: mode === 'down' }
      const period = mode === 'center' ? 2 * arr : arr + 1
      let on = 0
      for (let i = 0; i < period; i++) {
        stepOnce(mode, c, arr)
        if (pwm1Active(mode, c, arr, ccr)) on++
      }
      return on / period
    }
    expect(duty('up', 99, 25)).toBe(0.25)
    expect(duty('up', 99, 0)).toBe(0)
    expect(duty('up', 99, 100)).toBe(1)
    expect(duty('down', 99, 24)).toBe(0.25)
    expect(duty('down', 99, 0)).toBe(0.01) // "0 % PWM is not possible" counting down
    expect(duty('center', 8, 4)).toBe(0.5) // RM0008 Figure 117
    expect(duty('center', 8, 8)).toBe(1)
    expect(duty('center', 8, 0)).toBe(0)
  })
})
