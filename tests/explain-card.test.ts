/**
 * 「電路說明」 card geometry (round 5 — explain, src/ui/chrome/ExplainCard.tsx
 * + ExplainCard.css), checked without a browser:
 *  - the box holds THREE text lines — line 1 plus up to two of line 2,
 *    or (.is-l1-long, measured) two of line 1 plus one of line 2 — and its
 *    height is the EXPLAIN_CARD_H the inspector's slot is reserved with
 *    (four lines, .is-tall, when the words need them: tests/polish-chrome.test.ts);
 *  - the real long lines the summarizer writes (the hole a wire goes to, the
 *    換新 promise, an over-rated LED's numbers) fit that box at the default
 *    column width (340 px), by estimated glyph widths — nothing actionable
 *    is cut off behind an ellipsis;
 *  - the inspector's slot is reserved before the card is measured and while
 *    onboarding hides it, and the watcher starts before the first paint, so
 *    the inspector never jumps 80 px after the app opens.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { SimEngine } from '../src/sim/engine'
import { runErc } from '../src/sim/erc'
import '../src/sim/models'
import { deriveProblems } from '../src/ui/embedded/problems'
import { explainCircuit, newExplainHistory, observeTelemetry } from '../src/ui/chrome/explain'
import { EXPLAIN_CARD_H } from '../src/ui/chrome/ExplainCard'
import { valid } from './erc/helpers'

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => __setLangForTests('zh-TW'))

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const CSS = read('src/ui/chrome/ExplainCard.css')

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // the selector alone (after a previous rule or a comment — never the tail of a selector list)
  const m = new RegExp(`(?:^|\\}|\\*/)\\s*${esc}\\s*\\{([^}]*)\\}`).exec(CSS)
  return m ? m[1] : ''
}
const px = (block: string, prop: string): number => {
  const m = new RegExp(`(?:^|;|\\n)\\s*${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`).exec(block)
  return m ? parseFloat(m[1]) : NaN
}
/** font: <weight> <size>px/<line-height>px … */
const font = (block: string): { size: number; lh: number } => {
  const m = /font:\s*\d+\s+(\d+)px\/(\d+)px/.exec(block)
  return m ? { size: +m[1], lh: +m[2] } : { size: NaN, lh: NaN }
}
/** how many lines a rule lets its text take (a line clamp, else one: nowrap) */
const clampOf = (block: string): number => {
  const m = /-webkit-line-clamp:\s*(\d+)/.exec(block)
  if (m && !/white-space:\s*nowrap/.test(block)) return +m[1]
  return 1
}

describe('the card’s fixed box', () => {
  it('holds three text lines: line 1 + two of line 2, or two of line 1 + one of line 2 — at the reserved height', () => {
    const card = rule('.app-explain')
    expect(px(card, 'height')).toBe(EXPLAIN_CARD_H)
    const body = rule('.app-explain-body')
    const pad = /padding:\s*(\d+)px\s+\d+px\s+(\d+)px/.exec(body)!
    const l1 = font(rule('.app-explain-l1'))
    const l2 = font(rule('.app-explain-l2'))
    expect(clampOf(rule('.app-explain-l2'))).toBe(2)
    expect(clampOf(rule('.app-explain.is-l1-long .app-explain-l1'))).toBe(2)
    expect(clampOf(rule('.app-explain.is-l1-long .app-explain-l2'))).toBe(1)
    // both arrangements fit inside the box
    const inner = EXPLAIN_CARD_H - +pad[1] - +pad[2]
    expect(l1.lh + 2 * l2.lh).toBeLessThanOrEqual(inner)
    expect(2 * l1.lh + l2.lh).toBeLessThanOrEqual(inner + 2)
  })
})

/** Estimated advance of `text` at `size` px (CJK and full-width 1 em, Latin narrower). */
function textWidth(text: string, size: number, bold = false): number {
  let em = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xffef)) em += 1
    else if (ch === ' ' || ch === ' ') em += 0.28
    else if (/[0-9]/.test(ch)) em += 0.57
    else if (/[A-Z]/.test(ch)) em += 0.66
    else if (/[a-z]/.test(ch)) em += 0.53
    else em += 0.62
  }
  return em * size * (bold ? 1.04 : 1)
}

describe('the summarizer’s long lines fit the box at the default column width', () => {
  const PS = (v = 5) => ({ id: 'PS1', type: 'power_supply', params: { voltage: v } })
  const RAILS = [
    { id: 'W1', from: 'PS1:+', to: 'top+0' },
    { id: 'W2', from: 'PS1:-', to: 'top-0' },
  ]
  const led = (id: string, holes: string[]) => ({ id, type: 'led', holes, params: { color: 'red' } })
  const res = (id: string, holes: string[], resistance: number) => ({ id, type: 'resistor', holes, params: { resistance } })
  const explainOf = (layout: CircuitLayout, seconds: number) => {
    const engine = new SimEngine(layout)
    const history = newExplainHistory()
    let tele!: SimTelemetry
    for (let i = 0; i < seconds * 10; i++) {
      engine.advance(0.1, 1e-3)
      tele = engine.telemetry()
      observeTelemetry(history, layout, tele)
    }
    const findings = runErc(layout, { telemetry: tele, issues: tele.issues })
    const problems = deriveProblems({ layout, findings, issues: tele.issues, firmware: {}, mcus: {}, running: true, simTime: tele.time })
    return explainCircuit({ layout, telemetry: tele, phase: 'running', problems, findings, history })
  }

  it('the open cathode’s wire, the burned LED’s 換新 promise, an over-rated LED’s numbers, an unfed rail’s fix', () => {
    const cases = [
      valid({ version: 1, components: [PS(), res('R1', ['top+3', 'a10'], 330), led('LED1', ['b10', 'c20'])], wires: RAILS }),
      valid({ version: 1, components: [PS(), res('R1', ['top+3', 'a10'], 10), led('LED1', ['b10', 'top-4'])], wires: RAILS }),
      valid({ version: 1, components: [PS(), led('LED1', ['top+3', 'top-4'])], wires: RAILS }),
      valid({ version: 1, components: [PS(12), res('R1', ['top+3', 'a10'], 330), led('LED1', ['b10', 'top-4'])], wires: RAILS }),
      valid({ version: 1, components: [PS(), res('R1', ['bot+3', 'a10'], 330), led('LED1', ['b10', 'top-4'])], wires: RAILS }),
    ]
    // the column's text width: --ws-right-w 340 − the body's side padding − the dot − the gap (ExplainCard.css)
    const body = rule('.app-explain-body')
    const side = /padding:\s*\d+px\s+(\d+)px\s+\d+px\s+(\d+)px/.exec(body)!
    const dot = px(rule('.app-explain-dot'), 'width')
    const gap = px(rule('.app-explain-row'), 'gap')
    const W = 340 - +side[1] - +side[2] - dot - gap
    expect(W).toBeGreaterThan(280)
    const l1 = font(rule('.app-explain-l1'))
    const l2 = font(rule('.app-explain-l2'))
    const l2Lines = clampOf(rule('.app-explain-l2'))
    const l1LongLines = clampOf(rule('.app-explain.is-l1-long .app-explain-l1'))
    const l2Short = clampOf(rule('.app-explain.is-l1-long .app-explain-l2'))
    // a wrapped line loses a little at its breaks
    const fits = (w: number, lines: number) => w <= (lines === 1 ? W : lines * W * 0.94)
    const bad: string[] = []
    let longest = 0
    for (const layout of cases) {
      const [a, b = ''] = explainOf(layout, 1).lines
      const w1 = textWidth(a, l1.size, true)
      const w2 = textWidth(b, l2.size)
      longest = Math.max(longest, w2)
      const ok = fits(w1, 1) ? fits(w2, l2Lines) : fits(w1, l1LongLines) && fits(w2, l2Short)
      if (!ok) bad.push(`${a} (${Math.round(w1)} px) / ${b} (${Math.round(w2)} px)`)
    }
    expect(bad).toEqual([])
    // the point of the second line of line 2: these do not fit on one
    expect(longest).toBeGreaterThan(W)
  })
})

describe('no jump of the inspector', () => {
  const card = read('src/ui/chrome/ExplainCard.tsx')
  const hook = read('src/ui/chrome/useExplanation.ts')

  it('the right column’s slot is reserved by placement alone (not by onboarding or a first explanation), before measuring', () => {
    expect(card).toMatch(/const reserve = !legacy && isDesktop && column\b/)
    expect(card).toMatch(/h > 0 \? h : EXPLAIN_CARD_H/)
    expect(card).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(!reserve\) return/)
  })

  it('the watcher starts before the first paint (a layout effect in the browser)', () => {
    expect(hook).toMatch(/const useBeforePaint = typeof window !== 'undefined' \? useLayoutEffect : useEffect/)
    expect(hook).toMatch(/useBeforePaint\(\(\) => \(enabled \? startExplainWatcher\(\) : undefined\), \[enabled\]\)/)
  })
})
