/**
 * Release triage, inspector replays (scripts/ux-e2e/inspector-IN-18.mjs):
 *
 *  - CLASSIC-PIN-ROW  the classic chrome (English without the workspace) shows
 *                     a part's PINS rows exactly as 6d01968 did — 「anode b40」,
 *                     the raw name then the hole. Since b7be397 t() drops an
 *                     untranslated 「|pin」 context, so pinGloss('anode') read
 *                     back 「anode」 and every row said its name twice
 *                     (「anode anode b40」, 「p1 p1 a36」). A gloss that is the
 *                     name itself is no gloss.
 *
 * The other two failing replays (IN-13, IN-17) were stale (the blink LED is
 * LED1 since bf340c5; a board state's sentence lives in its 執行狀態 card
 * since QA IN-F3): the scripts were updated, the product is unchanged.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import { getEntry } from '../src/model/catalog'
import type { CircuitLayout } from '../src/model/types'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { __resetProblemsForTests, useInspectorFocus, useProblems } from '../src/ui/embedded/problems'
import { PropertiesBody } from '../src/ui/sheets/PropertiesSheet'

const ROOT = path.resolve(__dirname, '..')
const BLINK = (JSON.parse(readFileSync(path.join(ROOT, 'examples/embedded/blink.ohmlet.json'), 'utf8')) as { layout: CircuitLayout }).layout

/** A server render against the stores' live state (zustand's server snapshot is the initial state). */
function renderLive(el: ReturnType<typeof createElement>): string {
  const stores = [useStore, useLab, useProblems, useInspectorFocus] as unknown as { getState: () => object; getInitialState: () => object }[]
  const saved = stores.map((s) => {
    const init = s.getInitialState() as Record<string, unknown>
    const before = { ...init }
    Object.assign(init, s.getState())
    return [init, before] as const
  })
  try {
    return renderToStaticMarkup(el)
  } finally {
    for (const [init, before] of saved) {
      for (const k of Object.keys(init)) if (!(k in before)) delete init[k]
      Object.assign(init, before)
    }
  }
}

const body = () => renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))

/** The classic PINS rows of a render: [name, gloss | null, hole] per row. */
function classicPinRows(html: string): [string, string | null, string][] {
  const rows: [string, string | null, string][] = []
  const re =
    /<div class="prs-pin" role="listitem">(?:<span class="prs-pin-num[^"]*">[^<]*<\/span>)?<span class="prs-pin-name prs-mono" translate="no">([^<]*)<\/span>(?:<span class="prs-pin-gloss lg-caption">([^<]*)<\/span>)?<span class="prs-pin-hole prs-mono" translate="no">([^<]*)<\/span>/g
  for (let m = re.exec(html); m; m = re.exec(html)) rows.push([m[1], m[2] ?? null, m[3]])
  return rows
}

beforeEach(() => {
  __setLangForTests('en')
  __resetProblemsForTests()
  useStore.getState().resetSim()
  __resetHistoryForTests()
  useLab.setState({ workspace: { ...useLab.getState().workspace, enabled: false } })
})
afterEach(() => {
  __setLangForTests('zh-TW')
  useStore.setState({ selection: [], running: false, simTime: 0, telemetry: null })
})

describe('CLASSIC-PIN-ROW: the classic PINS rows read as in 6d01968', () => {
  it('the blink LED: 「anode b40」 / 「cathode top-32」 — the exact 6d01968 row markup, no gloss', () => {
    useStore.setState({ layout: BLINK, selection: ['LED1'] })
    const html = body()
    expect(html).toContain('prs-body prs-classic')
    expect(classicPinRows(html)).toEqual([
      ['anode', null, 'b40'],
      ['cathode', null, 'top-32'],
    ])
    expect(html).toContain(
      '<div class="prs-pin" role="listitem"><span class="prs-pin-name prs-mono" translate="no">anode</span><span class="prs-pin-hole prs-mono" translate="no">b40</span><span class="prs-pin-v lg-tabular"></span></div>',
    )
    expect(html).not.toContain('prs-pin-gloss')
  })

  it('no English pin name is ever repeated as its own gloss (resistor, potentiometer, supply, diode, capacitor)', () => {
    const layout: CircuitLayout = {
      version: 1,
      components: [
        { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
        { id: 'R1', type: 'resistor', holes: ['a36', 'a40'], params: { resistance: 330 } },
        { id: 'RV1', type: 'potentiometer', holes: ['c40', 'c41', 'c42'] },
        { id: 'D2', type: 'diode', holes: ['a20', 'a24'] },
        { id: 'C1', type: 'capacitor', holes: ['a50', 'a52'] },
      ],
      wires: [],
    }
    for (const c of layout.components) expect(getEntry(c.type), c.type).toBeDefined()
    const seen: string[] = []
    for (const c of layout.components) {
      useStore.setState({ layout, selection: [c.id] })
      const html = body()
      expect(html, c.id).toContain('prs-body prs-classic')
      expect(html, c.id).not.toContain('prs-pin-gloss')
      const rows = classicPinRows(html)
      expect(rows.length, c.id).toBe(getEntry(c.type)!.pins.length)
      for (const [name, gloss] of rows) {
        expect(gloss, `${c.id} ${name}`).toBeNull()
        seen.push(`${c.id}:${name}`)
      }
    }
    expect(seen).toEqual(expect.arrayContaining(['R1:p1', 'R1:p2', 'RV1:wiper', 'PS1:+', 'PS1:-']))
  })

  it('the cause: an untranslated 「|pin」 context reads back as the name itself in English', () => {
    expect(t('anode|pin')).toBe('anode')
    expect(t('p1|pin')).toBe('p1')
  })

  it('zh-TW is untouched: the new inspector names the LED leads in Chinese, never the classic rows', () => {
    __setLangForTests('zh-TW')
    useStore.setState({ layout: BLINK, selection: ['LED1'] })
    const html = body()
    expect(html).not.toContain('prs-classic')
    expect(classicPinRows(html)).toEqual([])
    expect(html).toContain('陽極')
    expect(html).toContain('陰極')
  })
})
