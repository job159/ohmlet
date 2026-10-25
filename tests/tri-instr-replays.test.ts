/**
 * Release-check triage (instruments replays, 'tri-instr'): the names the
 * Playwright replays (scripts/ux-e2e/instruments-*.mjs) find and read things
 * by are the names the product renders. Each of these changed on purpose in
 * the release QA round (bf340c5) while its replay kept the old text, so the
 * replay failed with a 30 s locator timeout or a regex miss instead of a
 * message that said what moved:
 *
 *  - the example card's 開啟 pill is named 「開啟範例：{title}」 (SC-F4) —
 *    IS-10 / IS-11 / IS-12 / IS-15 open their examples by that name;
 *  - instrument labels carry their glossary ⓘ between the name and the value
 *    (「時脈 ⓘ 100.0 kHz（突發）」 — IS-11, 「Δt ⓘ 501.0 ms」 — IS-15);
 *  - the trigger is ONE chip 「觸發：… · 自動」 whose 觸發設定 popover holds the
 *    觸發模式 select (自動／一般／單次) in the row 模式 under the heading 觸發
 *    (SCOPE-READOUT-TRIGGER) — instruments-requests reads it there.
 *
 * The replays' own patterns are taken from the script files, so a rename on
 * either side fails here, in the unit suite, first.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import { fmtSi } from '../src/instruments/format'
import { tc } from '../src/ui/format'
import { scopeTriggerSummary } from '../src/ui/embedded/instruments/ScopeControls'
import { hasInstrumentTerm } from '../src/ui/embedded/instruments/InstrumentTerm'
import { timingCell } from '../src/ui/embedded/instruments/signal-readout'
import { LIBRARY, exampleTitle } from '../src/ui/workspace/examples'

const ROOT = path.resolve(__dirname, '..')
const script = (name: string) => readFileSync(path.join(ROOT, 'scripts/ux-e2e', name), 'utf8')
const source = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/** What a replay's examplePill(page, title) asks Playwright for: the role and the name pattern. */
function examplePillQuery(file: string, title: string): { role: string; name: RegExp } {
  const s = script(file)
  const at = s.indexOf('const esc = ')
  const end = s.indexOf('.first()', at)
  expect(at, `${file}: the examplePill helper`).toBeGreaterThan(0)
  const make = new Function(`${s.slice(at, end + '.first()'.length)}\nreturn examplePill`)() as (
    page: unknown,
    title: string,
  ) => { role: string; name: RegExp }
  const page = { getByRole: (role: string, o: { name: RegExp }) => ({ first: () => ({ role, name: o.name }) }) }
  return make(page, title)
}

/** A regex literal from a replay, found by a needle that is part of it. */
function regexIn(file: string, needle: string): RegExp {
  const s = script(file)
  const i = s.indexOf(needle)
  expect(i, `${file}: ${needle}`).toBeGreaterThan(0)
  const start = s.lastIndexOf('/', i)
  const close = s.indexOf('/', i + needle.length)
  return new RegExp(s.slice(start + 1, close))
}

beforeEach(() => __setLangForTests('zh-TW'))

describe('the example card’s 開啟 pill (IS-10 / IS-11 / IS-12 / IS-15)', () => {
  it('the product names it 「開啟範例：{title}」 — on the pill and on the write-up’s chip', () => {
    expect(t('Open example: {title}', { title: 'I²C 匯流排掃描' })).toBe('開啟範例：I²C 匯流排掃描')
    const panel = source('src/ui/workspace/LibraryPanel.tsx')
    const pill = panel.slice(panel.indexOf('className="ws-open-pill"'), panel.indexOf('className="ws-open-pill"') + 400)
    expect(pill).toContain("aria-label={t('Open example: {title}', { title })}")
    expect(panel).not.toContain("t('Open “{title}”'")
  })

  for (const file of ['instruments-IS-10.mjs', 'instruments-IS-11.mjs', 'instruments-IS-12.mjs']) {
    it(`${file}: its examplePill finds every library example by the rendered name, and only that one`, () => {
      const titles = LIBRARY.map((ex) => exampleTitle(ex, t))
      expect(titles.length).toBeGreaterThanOrEqual(34)
      for (const title of titles) {
        const q = examplePillQuery(file, title)
        expect(q.role).toBe('button')
        expect(q.name.test(t('Open example: {title}', { title }))).toBe(true)
        // a title is not a prefix match of another card's name, nor the bare pill text
        expect(q.name.test(`${t('Open example: {title}', { title })}（第二版）`)).toBe(false)
        expect(q.name.test(tc('Open', 'example'))).toBe(false)
      }
      // the stale accessible name is gone from the script's own lookups
      expect(script(file)).not.toContain("getByRole('button', { name: `開啟「${title}」` })")
    })
  }

  it('instruments-IS-15.mjs opens by the same name', () => {
    expect(script('instruments-IS-15.mjs')).toContain('new RegExp(`^開啟(範例：')
  })
})

describe('glossary ⓘ between an instrument label and its value (IS-11, IS-15)', () => {
  it('時脈 (burst) and Δt are glossary terms in the product chrome', () => {
    expect(hasInstrumentTerm('burst')).toBe(true)
    expect(hasInstrumentTerm('dt')).toBe(true)
    expect(source('src/ui/embedded/LogicAnalyzer.tsx')).toContain('<InstrumentTerm id="burst">{cell.label}</InstrumentTerm>')
    expect(source('src/ui/embedded/LogicAnalyzer.tsx')).toContain('<InstrumentTerm id="dt">Δt</InstrumentTerm>')
  })

  it('IS-11 reads PB6 SCL’s burst clock as rendered: 「時脈 ⓘ 100.0 kHz（突發）」', () => {
    const BURST_CLOCK = regexIn('instruments-IS-11.mjs', '時脈\\s*(?:ⓘ\\s*)?')
    const cell = timingCell({ frequency: null, periodicity: 'burst', burstClock: 100e3, skipped: false }, null)
    expect(cell.kind).toBe('burst')
    expect(`${cell.label} ⓘ ${cell.value}`).toBe('時脈 ⓘ 100.0 kHz（突發）')
    expect(BURST_CLOCK.test(`PB6 SCL ${cell.label} ⓘ ${cell.value} 高電位時間5.00 µs`)).toBe(true)
    expect(BURST_CLOCK.test(`${cell.label} ${cell.value}`)).toBe(true) // the classic chrome: no ⓘ
    // still a burst clock of ~100 kHz, nothing else
    const fast = timingCell({ frequency: null, periodicity: 'burst', burstClock: 400e3, skipped: false }, null)
    expect(BURST_CLOCK.test(`${fast.label} ⓘ ${fast.value}`)).toBe(false)
    expect(BURST_CLOCK.test('頻率 ⓘ 100.0 kHz')).toBe(false)
  })

  it('IS-15 reads the marker interval as rendered: 「Δt ⓘ 501.0 ms」', () => {
    const DT = regexIn('instruments-IS-15.mjs', 'Δt\\s*(?:ⓘ\\s*)?')
    expect(fmtSi(0.501, 's')).toBe('501.0 ms')
    expect(DT.test(`Δt ⓘ ${fmtSi(0.501, 's')} · 1/Δt1.996 Hz`)).toBe(true)
    expect(DT.test(`Δt ${fmtSi(0.501, 's')}`)).toBe(true)
    expect(DT.test(`Δt ⓘ ${fmtSi(0.5003, 's')}`)).toBe(false)
  })
})

describe('the scope’s trigger mode is never a bare 自動 (instruments-requests)', () => {
  it('the chip names 觸發 before the mode; the requests pattern reads it', () => {
    const CHIP = regexIn('instruments-requests.mjs', '^觸發：CH1 ')
    const chip = scopeTriggerSummary({ trigSource: 0, trigSlope: 'rising', trigLevel: 1.65, trigMode: 'auto', holdoff: 0 })
    expect(chip).toBe('觸發：CH1 ↑ 上升緣 · 準位 1.65 V · 自動')
    expect(CHIP.test(chip)).toBe(true)
    expect(CHIP.test(scopeTriggerSummary({ trigSource: 0, trigSlope: 'rising', trigLevel: 1.65, trigMode: 'normal', holdoff: 0 }))).toBe(false)
  })

  it('the popover: 觸發設定 › heading 觸發, row 模式, select 觸發模式 with 自動／一般／單次', () => {
    expect(t('Trigger settings')).toBe('觸發設定')
    expect(t('Trigger')).toBe('觸發')
    expect(tc('Mode', 'trigger')).toBe('模式')
    expect(t('Trigger mode')).toBe('觸發模式')
    expect(['Auto', 'Normal', 'Single'].map((m) => tc(m, 'trig-short'))).toEqual(['自動', '一般', '單次'])
    // the product puts the 觸發模式 select inside the 觸發設定 popover (one chip, fields labelled there)
    const ctl = source('src/ui/embedded/instruments/ScopeControls.tsx')
    const popAt = ctl.indexOf("label={t('Trigger settings')} width={320}")
    expect(popAt).toBeGreaterThan(0)
    const pop = ctl.slice(popAt, ctl.indexOf('</Popover>', popAt))
    expect(pop).toContain("<InstrumentTerm id=\"trigger\">{t('Trigger')}</InstrumentTerm>")
    expect(pop).toContain("{tc('Mode', 'trigger')}")
    expect(pop).toContain("aria-label={t('Trigger mode')}")
    expect(pop).toContain("{ value: 'auto', label: tc('Auto', 'trig-short') }")
    // and the requests replay looks for exactly these
    const rq = script('instruments-requests.mjs')
    expect(rq).toContain("getByRole('dialog', { name: '觸發設定' })")
    expect(rq).toContain("getByRole('combobox', { name: '觸發模式' })")
    expect(rq).toContain("trig.modes.join('/') === '自動/一般/單次'")
    expect(rq).toContain("trig.head === '觸發' && trig.row === '模式'")
  })
})
