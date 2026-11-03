/**
 * Round 5 persona fixes, the minor ones (cheap and safe):
 *
 *  - 〔換新〕 on a circuit that still has the fault: the new part burns again
 *    at once — the toast says so, with the card's fix (replace-part.ts
 *    watchReburn), instead of a lone 「已換上新的 LED1」;
 *  - a calm blink period: 「約每 1.0 s」 for a steady 1 s blink, not 1.04 s /
 *    981 ms / 998 ms by turns (explain.ts fmtPeriod);
 *  - the card's 「（已暫停）」 never breaks inside (ExplainCard keepTail);
 *  - no leftover 「開始模擬」 that asks the learner to start a run that starts
 *    by itself (the rule-check footer, lesson 1's summary);
 *  - the phone's toasts float above a resting sheet (Sheet publishRest +
 *    kit.css), the paused pill's body shows its whole sentence on a tap, the
 *    dock's 元件 raises a peeking parts sheet.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, Fragment } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { InlineSimHost } from '../src/sim/coordinator/inline-host'
import type { SimHost, SimHostCallbacks } from '../src/sim/coordinator/api'
import '../src/sim/models'
import { __setSimHostFactoryForTests, getSimHost, useStore } from '../src/state/store'
import { __stopReburnWatchForTests, REBURN_SETTLE_MS, REBURN_WATCH_MS, replacePartsWithFeedback } from '../src/ui/embedded/replace-part'
import { TIER, fmtPeriod } from '../src/ui/chrome/explain'
import { useExplainView } from '../src/ui/chrome/useExplanation'
import { keepTail } from '../src/ui/chrome/ExplainCard'
import { dismissToast, getToasts } from '../src/ui/kit/toasts'
import { LESSON as B1 } from '../src/lessons/beginner/b1-led-resistor.lesson'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const toasts = () => getToasts().map((x) => x.text)

beforeEach(() => {
  __setLangForTests('zh-TW')
  for (const x of getToasts()) dismissToast(x.id)
})

// ---------------------------------------------------------------------------
// 〔換新〕 that burns again
// ---------------------------------------------------------------------------

describe('〔換新〕 while the fault is still there: 「新的 LED1 又燒掉了」 with the fix', () => {
  const LAYOUT: CircuitLayout = {
    version: 1,
    components: [
      { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
      { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 10 } },
      { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'red' } },
    ],
    wires: [
      { id: 'W1', from: 'PS1:+', to: 'top+1' },
      { id: 'W2', from: 'PS1:-', to: 'top-1' },
    ],
  }
  const tele = (time: number, burned: boolean): SimTelemetry => ({
    time,
    netVoltages: {},
    components: { LED1: { pinVoltages: {}, light: burned ? 0 : 1, current: burned ? 0 : 0.3, ...(burned ? { burned: true } : {}) } },
    issues: [],
  })
  const FIX = '改用至少 180 Ω 的限流電阻；改好就會自動換上新的 LED1'
  let repaired: (readonly string[] | null)[] = []

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })
    repaired = []
    __setSimHostFactoryForTests((cb: SimHostCallbacks) => {
      const h = new InlineSimHost(cb, { scheduler: { request: () => 0, cancel: () => {} }, clock: () => 0 })
      ;(h as SimHost).repairParts = (ids) => void repaired.push(ids)
      return h
    })
    getSimHost()
    useStore.setState({ layout: LAYOUT, running: true, telemetry: tele(1, true), simTime: 1 })
    useExplainView.setState({
      explanation: { tone: 'error', dot: '#f00', lines: ['LED1 燒毀：量到 302 mA，超過額定 20 mA', FIX], subjectIds: ['LED1'], key: '1:LED1:burned', short: '', tier: TIER.damage },
      stale: false,
      announce: '',
    })
  })
  afterEach(() => {
    __stopReburnWatchForTests()
    __setSimHostFactoryForTests(null)
    vi.useRealTimers()
    useStore.setState({ running: false, telemetry: null, simTime: 0 })
    useExplainView.setState({ explanation: null, stale: false, announce: '' })
  })

  it('burned again (no edit in between): the replaced toast gives way to the re-burn and the card’s fix', () => {
    expect(replacePartsWithFeedback(['LED1'])).toBe(true)
    expect(repaired).toEqual([['LED1']])
    expect(toasts()).toEqual(['已換上新的 LED1'])
    // a frame still in flight (before the new part went in) says nothing
    useStore.setState({ telemetry: tele(1.05, true) })
    expect(toasts()).toEqual(['已換上新的 LED1'])
    vi.advanceTimersByTime(REBURN_SETTLE_MS + 50)
    useStore.setState({ telemetry: tele(1.4, true) })
    expect(toasts()).toEqual([`新的 LED1 又燒掉了：${FIX}`])
  })

  it('the new part stays whole, or an edit comes first: no re-burn toast', () => {
    replacePartsWithFeedback(['LED1'])
    vi.advanceTimersByTime(REBURN_SETTLE_MS + 50)
    useStore.setState({ telemetry: tele(1.4, false) })
    vi.advanceTimersByTime(REBURN_WATCH_MS)
    useStore.setState({ telemetry: tele(4, true) }) // long after: the watch is over
    expect(toasts().some((x) => x.includes('又燒掉了'))).toBe(false)
    // an edit (the learner changes R1) — its own story (auto-heal, a rebuild)
    for (const x of getToasts()) dismissToast(x.id)
    useStore.setState({ telemetry: tele(5, true) })
    replacePartsWithFeedback(['LED1'])
    vi.advanceTimersByTime(REBURN_SETTLE_MS + 50)
    useStore.setState({ layout: { ...LAYOUT, components: LAYOUT.components.map((c) => (c.id === 'R1' ? { ...c, params: { resistance: 220 } } : c)) } })
    useStore.setState({ telemetry: tele(5.5, true) })
    expect(toasts().some((x) => x.includes('又燒掉了'))).toBe(false)
  })

  it('no card fix for it: the plain words', () => {
    useExplainView.setState({ explanation: null, stale: false, announce: '' })
    replacePartsWithFeedback(['LED1'])
    vi.advanceTimersByTime(REBURN_SETTLE_MS + 50)
    useStore.setState({ telemetry: tele(1.4, true) })
    expect(toasts()).toEqual(['新的 LED1 又燒掉了：讓它燒掉的問題還在電路裡'])
  })
})

// ---------------------------------------------------------------------------
// the card's words
// ---------------------------------------------------------------------------

describe('the 電路說明 card: a calm period, an unbroken 「（已暫停）」', () => {
  it('fmtPeriod: one decimal in s from 0.5 s, whole s from 10 s, two digits below', () => {
    for (const s of [0.981, 0.998, 1.002, 1.02, 1.04]) expect(fmtPeriod(s), String(s)).toBe('1.0 s')
    expect(fmtPeriod(2.03)).toBe('2.0 s')
    expect(fmtPeriod(0.7)).toBe('0.7 s')
    expect(fmtPeriod(12.3)).toBe('12 s')
    expect(fmtPeriod(0.254)).toBe('250 ms')
    expect(fmtPeriod(0.0498)).toBe('50 ms')
    expect(fmtPeriod(0.00098)).toBe('980 µs')
  })

  it('keepTail: the paused tag in one nowrap span; the text itself unchanged', () => {
    const line = t('{text} (paused)|explain', { text: 'LED1 亮著：亮度 43 %（8.51 mA）' })
    const html = renderToStaticMarkup(createElement(Fragment, null, keepTail(line)))
    expect(html).toBe('LED1 亮著：亮度 43 %（8.51 mA）<span class="app-explain-keep">（已暫停）</span>')
    expect(keepTail('LED1 亮著')).toBe('LED1 亮著')
    expect(read('src/ui/chrome/ExplainCard.css')).toMatch(/\.app-explain-keep \{\s*white-space: nowrap;/)
    expect(read('src/ui/chrome/ExplainCard.tsx')).toContain('{keepTail(unbroken(line1))}')
  })
})

// ---------------------------------------------------------------------------
// no leftover 「開始模擬」
// ---------------------------------------------------------------------------

describe('the run starts by itself: no line asks the learner to start it', () => {
  it('the rule-check footer and lesson 1’s summary', () => {
    expect(t('Wiring and ratings (start the simulation to add live readings)')).toBe('接線與額定值（模擬執行時加入即時讀數）')
    expect(B1.summary).not.toMatch(/開始模擬，/)
    expect(B1.summary).toContain('電路會自動開始模擬')
  })
})

// ---------------------------------------------------------------------------
// the phone: toasts above a resting sheet, the paused pill, the dock's 元件
// ---------------------------------------------------------------------------

describe('phone chrome', () => {
  it('a resting sheet publishes its height at every snap; the product chrome’s toasts float above it', () => {
    const sheet = read('src/ui/kit/Sheet.tsx')
    expect(sheet).toMatch(/setRest\(!desktop && !modal \? Math\.round\(\(sheetHRef\.current \* fracs\[i\]\) \/ maxFrac\) : 0\)/)
    expect(sheet).toMatch(/setCover\(0\)\r?\n\s+setRest\(0\)/) // closing drops it at once
    expect(sheet).toMatch(/b\.classList\.add\('lg-sheet-resting'\)/)
    const kit = read('src/ui/kit/kit.css')
    expect(kit).toMatch(/body\.lg-sheet-resting:not\(\.ws-on\) \.lg-toast-host\.is-wide \{\s*bottom: max\(calc\(var\(--lg-safe-bottom\) \+ 86px\), min\(calc\(var\(--lg-sheet-rest\) \+ 10px\), 60vh\)\);/)
    // the selection pill's own toast row yields to it
    expect(read('src/ui/chrome/SelectionPill.css')).toContain(':not(.app-wire-armed):not(.lg-sheet-resting) .lg-toast-host')
  })

  it('the paused pill’s body is a button that shows the whole sentence', () => {
    const src = read('src/ui/chrome/StatusPill.tsx')
    expect(src).toMatch(/shown\.tone === 'paused' \? \([\s\S]{0,300}className="app-pill-body is-paused-body lg-pressable"[\s\S]{0,200}showToast\(shown\.text, \{ duration: EXPLAIN_TOAST_MS \}\)/)
  })

  it('the dock’s 元件 while the parts sheet peeks raises it instead of closing it', () => {
    const app = read('src/App.tsx')
    expect(app).toMatch(/if \(key === 'parts' && activeSheet === 'parts' && !legacy && partsSheetAtPeek\(\)\) \{\s*raisePartsSheet\(\)\s*return\s*\}/)
    const sheet = read('src/ui/sheets/PartsSheet.tsx')
    expect(sheet).toMatch(/peekOpen = open && !desktop && snap === PEEK/)
    expect(sheet).toMatch(/if \(openRef\.current\) setSnap\(HALF\)/)
  })
})
