/**
 * UX wave IN-4 — ERC rule 'open-lead' (src/sim/erc/rules-open.ts): a
 * two-lead part with one lead on a net nobody else uses.
 *
 *  - PA5 → LED anode with a floating cathode: 'risk' while running
 *    (telemetry given), 'info' before; the message names the hole, the
 *    strip and the fix, in Chinese too; holes / componentIds locate it
 *  - a correctly wired LED (and every lesson solution, b1 included) → no
 *    open-lead finding at all; the b1 'erc-clean' checks are unaffected
 *  - single-ended pins legitimately left open (unused MCU pins, NC pins,
 *    IC inputs) never trigger it; a lone part on an empty board neither
 *  - both leads open → 'info' 「還沒接線」 once a source or MCU exists
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runErc, type ErcFinding } from '../src/sim/erc'
import { ERC_RULES } from '../src/sim/erc/api'
import { LESSONS } from '../src/lessons'
import type { SimTelemetry } from '../src/model/types'
import { __setLangForTests } from '../src/i18n'
import { tMessage } from '../src/i18n/messages'
import { bluePill, layout, part, railsWorld, tap, valid, w } from './erc/helpers'
import { englishLeft } from './i18n/zh-check'

const LIVE: SimTelemetry = { time: 0.5, netVoltages: {}, issues: [], components: {} }
const open = (f: readonly ErcFinding[]) => f.filter((x) => x.rule === 'open-lead')

beforeAll(() => __setLangForTests('en'))
afterAll(() => __setLangForTests('zh-TW'))

describe('open-lead: an LED driven from PA5 with its cathode in an empty strip', () => {
  // R1 PA5 → a40/a45, LED anode b45, cathode a38 — nothing else in column 38
  const l = valid(
    bluePill([part('R1', 'resistor', ['a40', 'a45'], { resistance: 330 }), part('D1', 'led', ['b45', 'a48'])], [w(tap('PA5'), 'b40')]),
  )

  it('is a risk while the simulation runs, info before, and points at the open hole', () => {
    const live = open(runErc(l, { telemetry: LIVE }))
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ level: 'risk', componentIds: ['D1'], holes: ['a48'], short: 'D1 cathode not connected' })
    expect(live[0].message).toMatch(/^D1’s cathode \(a48\) is not connected to anything/)
    expect(live[0].message).toContain('column 48 (the a–e strip)')
    expect(live[0].message).toContain('the G pin of the Blue Pill (U1)')
    const statik = open(runErc(l))
    expect(statik).toHaveLength(1)
    expect(statik[0]).toMatchObject({ level: 'info', id: live[0].id })
  })

  it('reads as one Chinese sentence with the cause, the strip and the fix', () => {
    __setLangForTests('zh-TW')
    const f = open(runErc(l, { telemetry: LIVE }))[0]
    expect(tMessage(f.message)).toBe(
      'D1 的陰極（a48）沒有接到任何東西：電流沒有回到 GND 的路徑，所以 LED 不會亮。請用導線把第 48 欄（a–e 這一排）接到 − 電源軌或 Blue Pill（U1）的 G 腳。',
    )
    expect(tMessage(f.short!)).toBe('D1 陰極沒接')
    expect(englishLeft(tMessage(f.message))).toEqual([])
    __setLangForTests('en')
  })

  it('an open anode and an open resistor lead get their own wording', () => {
    const anode = valid(railsWorld([part('D2', 'led', ['a20', 'top-5'])]))
    const f = open(runErc(anode, { telemetry: LIVE }))
    expect(f).toHaveLength(1)
    expect(f[0].short).toBe('D2 anode not connected')
    expect(f[0].message).toContain('no current can flow into the LED')
    const res = valid(railsWorld([part('R7', 'resistor', ['top+5', 'a30'])]))
    const r = open(runErc(res, { telemetry: LIVE }))
    expect(r[0]).toMatchObject({ level: 'risk', holes: ['a30'], short: 'R7 lead 2 not connected' })
    __setLangForTests('zh-TW')
    expect(tMessage(r[0].message)).toBe('R7 的第 2 腳（a30）沒有接到任何東西：這個電阻沒有電流流過。請用導線把第 30 欄（a–e 這一排）接到電路的其他部分。')
    expect(tMessage(r[0].short!)).toBe('R7 第 2 腳沒接')
    __setLangForTests('en')
  })
})

describe('open-lead: no false alarms', () => {
  it('a correctly wired LED gives no open-lead finding (static and live)', () => {
    const l = valid(
      bluePill([part('R1', 'resistor', ['a40', 'a45'], { resistance: 330 }), part('D1', 'led', ['b45', 'top-9'])], [w(tap('PA5'), 'b40')]),
    )
    expect(open(runErc(l))).toEqual([])
    expect(open(runErc(l, { telemetry: LIVE }))).toEqual([])
  })

  it('unused MCU pins, NC pins and multi-pin parts with spare pins are never judged', () => {
    // a powered Blue Pill with 30+ unused GPIOs and a 555 with a spare control pin
    const l = valid(bluePill([{ id: 'U2', type: 'ne555', at: 'f50' }]))
    expect(open(runErc(l, { telemetry: LIVE }))).toEqual([])
  })

  it('a lone part on an otherwise empty board is not a mistake; both leads open with a source → info', () => {
    expect(open(runErc(layout([part('R1', 'resistor', ['a10', 'a14'])])))).toEqual([])
    const f = open(runErc(valid(railsWorld([part('R1', 'resistor', ['a10', 'a14'])])), { telemetry: LIVE }))
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ level: 'info', short: 'R1 not wired yet', holes: ['a10', 'a14'] })
  })

  it('a probe in the same strip does not count as a connection; a wire to a used strip does', () => {
    const probe = valid(railsWorld([part('D1', 'led', ['top+5', 'a30']), { id: 'P1', type: 'scope_probe', holes: ['b30'] }]))
    expect(open(runErc(probe, { telemetry: LIVE }))).toHaveLength(1)
    const wired = valid(railsWorld([part('D1', 'led', ['a30', 'a34']), part('R1', 'resistor', ['b34', 'top-7'])], [w('top+4', 'b30')]))
    expect(open(runErc(wired, { telemetry: LIVE }))).toEqual([])
  })

  it('every lesson solution is free of open leads, statically and live (erc-clean checks unaffected)', () => {
    for (const lesson of LESSONS) {
      const l = lesson.solution.layout
      const f = [...runErc(l), ...runErc(l, { telemetry: LIVE })]
      expect(open(f), `${lesson.id}: ${open(f).map((x) => x.message).join(' | ')}`).toEqual([])
    }
  })

  it('the rule is documented and its texts are translated', () => {
    const rule = ERC_RULES.find((r) => r.id === 'open-lead')
    expect(rule?.title).toBe('Unconnected lead')
    __setLangForTests('zh-TW')
    expect(tMessage(rule!.title)).toBe('腳沒接')
    for (const s of Object.values(rule!.levels)) expect(tMessage(s)).not.toBe(s)
    __setLangForTests('en')
  })
})

describe('open-lead: the start circuit of b1 (LED placed, not wired yet)', () => {
  it('is info only — never an error or a risk', () => {
    const b1 = LESSONS.find((l) => l.id === 'b1-led-resistor')!
    const f = open(runErc(b1.start.layout, { telemetry: LIVE }))
    expect(f.every((x) => x.level === 'info')).toBe(true)
  })
})

