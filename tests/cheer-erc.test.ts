/**
 * cheer (F2 extra): a polarized capacitor wired the wrong way round between
 * two rails is an ERROR before Run — the static ERC says so from the rails'
 * nominal voltages (src/sim/erc/rules-damage.ts), so the reversed
 * electrolytic of the reviewer's s14 is flagged before it ever vents and no
 * 「電路正常運作 ✓」 can open a window beside it. Once the simulation reports
 * the vent, that ONE row (the same finding id) says 「C1 反接爆開」 instead —
 * never listed as "resolved by the live readings".
 *  - more than 1 V reversed only (the capacitor model never vents at 1 V);
 *  - a lead not on a rail is not judged (no guessing);
 *  - the right way round / non-polarized: nothing.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { hasMessageTranslation, tMessage } from '../src/i18n/messages'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import { runErc } from '../src/sim/erc'
import { VENT_REVERSE_V } from '../src/sim/erc/rules-damage'
import { SimEngine } from '../src/sim/engine'
import '../src/sim/models'
import { deriveProblems, resolvedByLive, type ProblemsInput } from '../src/ui/embedded/problems'
import { CheerJudge, activePartIds, circuitActivity, snapshotDamaged } from '../src/ui/fx/success-watch'
import { valid } from './erc/helpers'

beforeEach(() => __setLangForTests('zh-TW'))

const RAILS = [
  { id: 'W1', from: 'PS1:+', to: 'top+0' },
  { id: 'W2', from: 'PS1:-', to: 'top-0' },
]
/** C1 between the − rail (its + lead, p1) and the + rail (its − lead, p2) — or the other way */
const capAcross = (v: number, plus: string, minus: string, polarized = true, extra: CircuitLayout['components'] = []): CircuitLayout =>
  valid({
    version: 1,
    components: [{ id: 'PS1', type: 'power_supply', params: { voltage: v } }, { id: 'C1', type: 'capacitor', holes: [plus, minus], params: { capacitance: 1e-4, polarized } }, ...extra],
    wires: RAILS,
  })
const REVERSED = capAcross(5, 'top-6', 'top+6')

const problemsOf = (layout: CircuitLayout, telemetry: SimTelemetry | null) =>
  deriveProblems({
    layout,
    findings: runErc(layout, telemetry ? { telemetry, issues: telemetry.issues } : {}),
    issues: telemetry?.issues ?? [],
    firmware: {},
    mcus: {},
    running: telemetry !== null,
    simTime: telemetry?.time ?? 0,
  } as ProblemsInput)

describe('cheer: a reversed electrolytic is flagged before Run', () => {
  it('static ERC: an error with the polarity fact, translated completely', () => {
    const f = runErc(REVERSED).filter((x) => x.componentIds.includes('C1'))
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ rule: 'over-rating', level: 'error', fact: 'reversed:C1', short: 'C1 electrolytic reversed' })
    expect(f[0].message).toContain('+ lead (top-6) is at 0 V and its − lead (top+6) at 5.00 V')
    expect(hasMessageTranslation(f[0].message)).toBe(true)
    expect(tMessage(f[0].message)).toBe(
      'C1（電容）是有極性的電解電容，但接反了：+ 腳（top-6）在 0 V，− 腳（top+6）在 5.00 V。反接的電解電容一通電就會發熱，直到頂部的洩壓閥爆開。請把它轉過來，讓 + 腳接較高的電壓。',
    )
    const rows = problemsOf(REVERSED, null).filter((p) => p.componentIds.includes('C1'))
    expect(rows.map((p) => [p.level, p.title])).toEqual([['error', 'C1 電解電容接反了']])
  })

  it('only when it WILL vent: > 1 V reversed, both leads on rails, polarized', () => {
    expect(VENT_REVERSE_V).toBe(1)
    const c1 = (l: CircuitLayout) => runErc(l).filter((x) => x.fact === 'reversed:C1')
    expect(c1(capAcross(5, 'top+6', 'top-6'))).toHaveLength(0) // the right way round
    expect(c1(capAcross(5, 'top-6', 'top+6', false))).toHaveLength(0) // non-polarized
    expect(c1(capAcross(1, 'top-6', 'top+6'))).toHaveLength(0) // 1 V reverse never vents
    expect(c1(capAcross(2, 'top-6', 'top+6'))).toHaveLength(1)
    expect(c1(capAcross(5, 'a12', 'top+6'))).toHaveLength(0) // + lead on a node that is not a rail: not judged
  })

  it('after the vent: ONE row 「C1 反接爆開」 (same finding id), not "resolved by the live readings"', () => {
    const before = runErc(REVERSED)
    const e = new SimEngine(REVERSED)
    e.advance(1.5, 1e-3)
    const tele = e.telemetry()
    expect(tele.components.C1?.damage?.kind).toBe('vented')
    const live = runErc(REVERSED, { telemetry: tele, issues: tele.issues })
    const mine = live.filter((x) => x.componentIds.includes('C1'))
    expect(mine).toHaveLength(1)
    expect(mine[0].fact).toBe('vented:C1')
    expect(mine[0].id).toBe(before.find((x) => x.fact === 'reversed:C1')!.id)
    expect(resolvedByLive(before, live).filter((p) => p.componentIds.includes('C1'))).toEqual([])
    const rows = problemsOf(REVERSED, tele).filter((p) => p.componentIds.includes('C1'))
    expect(rows.map((p) => p.title)).toEqual(['C1 反接爆開'])
  })

  it('s14: with the static error on the list from the start, the cheer never even opens a window', () => {
    const l = capAcross(12, 'top-30', 'top+31', true, [
      { id: 'R2', type: 'resistor', holes: ['top+13', 'a20'], params: { resistance: 1000 } },
      { id: 'LED1', type: 'led', holes: ['b20', 'top-24'], params: { color: 'green' } },
    ])
    const staticRows = problemsOf(l, null)
    expect(staticRows.some((p) => p.level === 'error' && p.title === 'C1 電解電容接反了')).toBe(true)
    const e = new SimEngine(l)
    const j = new CheerJudge()
    const levels = new Map<string, number>()
    const toggled = new Set<string>()
    let lit = 0
    for (let i = 0; i < 3; i++) {
      // before the vent (0.1 – 0.3 s): LED1 lit, nothing damaged yet — the list already blocks
      e.advance(0.1, 1e-3)
      const t = e.telemetry()
      const act = circuitActivity(l, t, levels, toggled)
      if (act.items.length > 0) lit++
      expect(snapshotDamaged(t)).toBe(false)
      expect(j.step({ rev: 'A', time: t.time, activity: act, damaged: false }, staticRows, () => staticRows, (ids) => activePartIds(l, t, ids))).toBeNull()
      expect(j.pendingSince).toBeNull()
    }
    expect(lit).toBeGreaterThan(0)
  })
})
