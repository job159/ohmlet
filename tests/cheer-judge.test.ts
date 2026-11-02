/**
 * cheer: the honest 「電路正常運作 ✓」 rules (CheerJudge, success-watch.ts),
 * fed with synthetic snapshots and problems lists:
 *  - a warning that names a working part → no cheer at all (an idle part's warning does not block);
 *  - any error → none; a new error inside the window cancels it;
 *  - the circuit must stay clean for CHEER_WINDOW_S of SIMULATED time, judged by a list
 *    computed AFTER the window (judge() is called once, then);
 *  - a damage event inside the window cancels it;
 *  - a delete / an undo / a knob that leaves the same things working never re-cheers;
 *    a change that makes something NEWLY work cleanly does (once per revision);
 *  - … even when the change lands INSIDE the first window (what already worked counts as
 *    done), unless that revision was known not to be clean (then fixing it may cheer);
 *  - a blinking LED's off phase at the end of the window waits for its next on-phase;
 *  - M1: at fire time every named thing is re-verified (an LED lit NOW, a pin toggling
 *    within its period or holding the level it switched to once — 「切換了」); what ended
 *    (a released button, a one-off flash) is dropped, nothing left = no cheer; a button
 *    that moved holds the judgement for HAND_SETTLE_S; while a FINGER holds a momentary input
 *    (not 保持按下) nothing is judged at all — what only the hand keeps alive never cheers.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import type { Problem } from '../src/ui/embedded/problems'
import {
  CHEER_WAIT_S,
  CHEER_WINDOW_S,
  CheerJudge,
  HAND_SETTLE_S,
  activePartIds,
  cheerBlockers,
  circuitActivity,
  fingerHeld,
  snapshotDamaged,
  stillToggling,
  type Activity,
  type ActivityItem,
  type CheerSnapshot,
  type CheerTrack,
  type PinChanges,
} from '../src/ui/fx/success-watch'

beforeEach(() => __setLangForTests('zh-TW'))

const item = (id: string, what = 'lit'): ActivityItem => ({ key: `${id}:${what}`, id, phrase: `${id} 亮了` })
const act = (...items: ActivityItem[]): Activity => ({
  componentIds: [...new Set(items.map((i) => i.id))],
  phrases: items.map((i) => i.phrase).slice(0, 3),
  items,
})
const snap = (rev: string, time: number, activity: Activity, damaged = false): CheerSnapshot => ({ rev, time, activity, damaged })
const prob = (level: Problem['level'], ids: string[], extra: Partial<Problem> = {}): Problem => ({
  id: `p:${level}:${ids.join(',')}`,
  level,
  source: 'erc',
  title: 't',
  detail: 'd',
  componentIds: ids,
  holes: [],
  ...extra,
})
const CLEAN: Problem[] = []
const everything = (ids: readonly string[]) => new Set(['PS1', 'R1', ...ids])

/** Drive the judge at 10 Hz from t0 to t1 with the same inputs; returns the decisions. */
function drive(j: CheerJudge, rev: string, t0: number, t1: number, a: Activity, latest: Problem[] | null, judge: () => Problem[], damagedAt = Infinity) {
  const out: (ReturnType<CheerJudge['step']> & object)[] = []
  for (let t = t0; t <= t1 + 1e-9; t += 0.1) {
    const d = j.step(snap(rev, +t.toFixed(3), a, t >= damagedAt), latest, judge, everything)
    if (d) out.push(d)
  }
  return out
}

describe('cheer: CheerJudge', () => {
  it('a clean, newly working circuit cheers once — only after CHEER_WINDOW_S of simulated time, judged by a list computed then', () => {
    expect(CHEER_WINDOW_S).toBeGreaterThanOrEqual(1.2)
    const j = new CheerJudge()
    let judged = 0
    const judge = () => {
      judged++
      return CLEAN
    }
    expect(drive(j, 'A', 0, 1.1, act(item('LED1')), CLEAN, judge)).toEqual([])
    expect(judged).toBe(0)
    const d = drive(j, 'A', 1.2, 1.4, act(item('LED1')), CLEAN, judge)
    expect(d).toEqual([{ componentIds: ['LED1'], message: 'LED1 亮了' }])
    expect(judged).toBe(1)
    // keeps working: never again
    expect(drive(j, 'A', 1.5, 5, act(item('LED1')), CLEAN, judge)).toEqual([])
  })

  it('a warning that names a working part: no celebration at all (the pill already explains)', () => {
    const j = new CheerJudge()
    const warn = [prob('warning', ['LED1', 'R1'])]
    expect(drive(j, 'A', 0, 4, act(item('LED1')), warn, () => warn)).toEqual([])
    // the list was clean while the window ran, the one computed AFTER it is not: none either
    const j2 = new CheerJudge()
    expect(drive(j2, 'A', 0, 3, act(item('LED1')), CLEAN, () => warn)).toEqual([])
    // a warning naming no part blocks too
    const j3 = new CheerJudge()
    expect(drive(j3, 'A', 0, 3, act(item('LED1')), CLEAN, () => [prob('warning', [])])).toEqual([])
    // info rows and board STATES do not
    const j4 = new CheerJudge()
    expect(drive(j4, 'A', 0, 3, act(item('LED1')), CLEAN, () => [prob('info', ['LED1']), prob('warning', ['U1'], { state: true })])).toHaveLength(1)
  })

  it('cheerBlockers / activePartIds: every error; warnings on parts that work or carry current; not on an idle part', () => {
    const layout: CircuitLayout = {
      version: 1,
      components: [
        { id: 'R1', type: 'resistor', holes: ['a1', 'a5'] },
        { id: 'R9', type: 'resistor', holes: ['a40', 'a44'] },
        { id: 'U1', type: 'stm32_bluepill', at: 'h30' },
      ],
      wires: [],
    }
    const tele: SimTelemetry = {
      time: 1,
      netVoltages: {},
      issues: [],
      components: {
        R1: { pinVoltages: {}, current: 0.009 },
        R9: { pinVoltages: {}, current: 0 },
        U1: { pinVoltages: {}, mcu: { state: 'running', pc: 0, hclkHz: 8e6, cycles: 1 } },
      },
    }
    const active = activePartIds(layout, tele, ['LED1'])
    expect([...active].sort()).toEqual(['LED1', 'R1', 'U1'])
    expect(cheerBlockers([prob('warning', ['R9'])], active)).toEqual([]) // a dangling, idle part
    expect(cheerBlockers([prob('warning', ['R1'])], active)).toHaveLength(1) // 「R1 功率超過額定」
    expect(cheerBlockers([prob('error', ['R9'])], active)).toHaveLength(1) // any error
  })

  it('any error blocks; a NEW error inside the window cancels it', () => {
    const j = new CheerJudge()
    expect(drive(j, 'A', 0, 3, act(item('LED1')), [prob('error', ['C1'])], () => CLEAN)).toEqual([])
    const j2 = new CheerJudge()
    expect(drive(j2, 'A', 0, 0.5, act(item('LED1')), CLEAN, () => CLEAN)).toEqual([])
    expect(j2.pendingSince).not.toBeNull()
    expect(drive(j2, 'A', 0.6, 0.6, act(item('LED1')), [prob('error', ['C1'])], () => CLEAN)).toEqual([])
    expect(j2.pendingSince).toBeNull()
  })

  it('a damage event inside the window cancels the cheer (the reversed capacitor that vents at 0.36 s)', () => {
    const j = new CheerJudge()
    // LED1 lights at 0.1 s with a clean list; C1 vents at 0.4 s; the list catches up later
    const d = drive(j, 'A', 0.1, 3, act(item('LED1')), CLEAN, () => CLEAN, 0.4)
    expect(d).toEqual([])
    expect(j.pendingSince).toBeNull()
  })

  it('snapshotDamaged: latched / hot damage, a burned LED, a pin beyond its absolute maximum', () => {
    const base: SimTelemetry = { time: 1, netVoltages: {}, issues: [], components: { R1: { pinVoltages: {} } } }
    expect(snapshotDamaged(base)).toBe(false)
    expect(snapshotDamaged({ ...base, components: { C1: { pinVoltages: {}, damage: { kind: 'vented', since: 0.36 } } } })).toBe(true)
    expect(snapshotDamaged({ ...base, components: { R1: { pinVoltages: {}, damage: { kind: 'overheating', since: 2 } } } })).toBe(true)
    expect(snapshotDamaged({ ...base, components: { LED1: { pinVoltages: {}, burned: true } } })).toBe(true)
    expect(snapshotDamaged({ ...base, components: { U1: { pinVoltages: {}, sub: { LED_PC13: { pinVoltages: {}, burned: true } } } } })).toBe(true)
    expect(snapshotDamaged({ ...base, issues: [{ level: 'warning', message: 'U1 PA0: 4.80 V exceeds VDD + 0.3 V (3.60 V) — PA0 is not 5 V tolerant' }] })).toBe(true)
  })

  it('a delete or an undo that leaves the same things working never re-cheers', () => {
    const j = new CheerJudge()
    const two = act(item('LED1'), item('LED2'))
    expect(drive(j, 'A', 0, 2, two, CLEAN, () => CLEAN)).toHaveLength(1)
    // delete LED2 (revision B): LED1 still lit, nothing new — R2 now dangles (warning on an idle part)
    const dangling = [prob('warning', ['R2'])]
    expect(drive(j, 'B', 2.1, 6, act(item('LED1')), dangling, () => dangling)).toEqual([])
    expect(drive(j, 'B', 6.1, 9, act(item('LED1')), CLEAN, () => CLEAN)).toEqual([])
    // undo (back to revision A): both lit again — both already worked cleanly
    expect(drive(j, 'A', 9.1, 12, two, CLEAN, () => CLEAN)).toEqual([])
  })

  it('a delete INSIDE the first window (both LEDs lit, not cheered yet): no cheer after it, nor after the undo', () => {
    // the verifier's v3-s26 at 700 ms: Run, both LEDs lit from 0.1 s, Delete LED2 at 0.7 s
    const j = new CheerJudge()
    const two = act(item('LED1'), item('LED2'))
    expect(drive(j, 'A', 0.1, 0.6, two, CLEAN, () => CLEAN)).toEqual([])
    expect(j.pendingSince).not.toBeNull()
    const dangling = [prob('warning', ['R2'])] // 「R2 第 2 腳沒接」 — an idle part
    expect(drive(j, 'B', 0.7, 6, act(item('LED1')), dangling, () => dangling)).toEqual([]) // LED1 was already lit
    expect(drive(j, 'A', 6.1, 12, two, CLEAN, () => CLEAN)).toEqual([]) // Ctrl+Z: LED2 was already lit too
    // the same when the problems list for the first circuit had not even been computed yet
    const k = new CheerJudge()
    expect(drive(k, 'A', 0.1, 0.3, two, null, () => CLEAN)).toEqual([])
    expect(k.pendingSince).toBeNull()
    expect(drive(k, 'B', 0.4, 6, act(item('LED1')), CLEAN, () => CLEAN)).toEqual([])
    expect(drive(k, 'A', 6.1, 12, two, CLEAN, () => CLEAN)).toEqual([])
    // … but a change that adds something NEW still cheers that new thing
    const n = new CheerJudge()
    expect(drive(n, 'A', 0.1, 0.6, act(item('LED1')), CLEAN, () => CLEAN)).toEqual([])
    expect(drive(n, 'B', 0.7, 3, two, CLEAN, () => CLEAN)).toEqual([{ componentIds: ['LED2'], message: 'LED2 亮了' }])
  })

  it('what a revision did while it was known NOT to be clean does not count: fixing it inside the first second still cheers', () => {
    const warn = [prob('warning', ['LED1', 'R1'])] // 21 mA
    // lit before its list arrived, then the list names LED1 → retracted; 150 → 330 Ω cheers
    const j = new CheerJudge()
    expect(drive(j, 'R150', 0.1, 0.2, act(item('LED1')), null, () => warn)).toEqual([])
    expect(drive(j, 'R150', 0.3, 0.8, act(item('LED1')), warn, () => warn)).toEqual([])
    expect(drive(j, 'R330', 0.9, 3, act(item('LED1')), CLEAN, () => CLEAN)).toEqual([{ componentIds: ['LED1'], message: 'LED1 亮了' }])
    // the window opened on a clean list, the list after it showed the warning → retracted too
    const k = new CheerJudge()
    expect(drive(k, 'R150', 0.1, 1.3, act(item('LED1')), CLEAN, () => warn)).toEqual([])
    expect(drive(k, 'R150', 1.4, 1.6, act(item('LED1')), warn, () => warn)).toEqual([]) // the judged list is the published one now
    expect(drive(k, 'R330', 1.7, 4, act(item('LED1')), CLEAN, () => CLEAN)).toHaveLength(1)
    // damage inside the window (the reversed capacitor): turning it around cheers the LED
    const d = new CheerJudge()
    expect(drive(d, 'A', 0.1, 1, act(item('LED1')), CLEAN, () => CLEAN, 0.4)).toEqual([])
    expect(drive(d, 'B', 1.1, 3, act(item('LED1')), CLEAN, () => CLEAN)).toEqual([{ componentIds: ['LED1'], message: 'LED1 亮了' }])
  })

  it('a change that makes something NEWLY work cleanly cheers (added LED2; a warning fixed by a new resistor value)', () => {
    const j = new CheerJudge()
    expect(drive(j, 'A', 0, 2, act(item('LED1')), CLEAN, () => CLEAN)).toHaveLength(1)
    const d = drive(j, 'B', 2.1, 4, act(item('LED1'), item('LED2')), CLEAN, () => CLEAN)
    expect(d).toEqual([{ componentIds: ['LED2'], message: 'LED2 亮了' }])

    const k = new CheerJudge()
    const warn = [prob('warning', ['LED1', 'R1'])] // 21 mA: 「LED1 的限流電阻太小」
    expect(drive(k, 'R150', 0, 3, act(item('LED1')), warn, () => warn)).toEqual([])
    expect(drive(k, 'R330', 3.1, 5, act(item('LED1')), CLEAN, () => CLEAN)).toEqual([{ componentIds: ['LED1'], message: 'LED1 亮了' }])
  })

  it('at most once per revision: a knob that lights another LED on a revision that already cheered stays quiet; a pause keeps the session', () => {
    const j = new CheerJudge()
    expect(drive(j, 'A', 0, 2, act(item('LED1')), CLEAN, () => CLEAN)).toHaveLength(1)
    expect(drive(j, 'A', 2.1, 5, act(item('LED1'), item('LED2')), CLEAN, () => CLEAN)).toEqual([])
    // a new session (reset) on the same circuit: still once per revision
    j.reset()
    expect(drive(j, 'A', 0, 3, act(item('LED1')), CLEAN, () => CLEAN)).toEqual([])
    // … in that session LED1 already worked cleanly: a new circuit with LED1 alone stays quiet, one that lights LED3 cheers
    expect(drive(j, 'C', 3.1, 6, act(item('LED1')), CLEAN, () => CLEAN)).toEqual([])
    expect(drive(j, 'D', 6.1, 9, act(item('LED1'), item('LED3')), CLEAN, () => CLEAN)).toEqual([{ componentIds: ['LED3'], message: 'LED3 亮了' }])
    // a reset, then a changed circuit straight away: LED1 newly works in the new session
    j.reset()
    expect(drive(j, 'E', 0, 2, act(item('LED1')), CLEAN, () => CLEAN)).toHaveLength(1)
  })

  it('a list the problems watcher has not computed for this circuit yet never starts a window', () => {
    const j = new CheerJudge()
    expect(drive(j, 'A', 0, 3, act(item('LED1')), null, () => CLEAN)).toEqual([])
    expect(j.pendingSince).toBeNull()
  })

  it('a blinking LED cheers while it is lit; in its off phase at the window’s end the cheer waits for the next on-phase', () => {
    // on 0–0.3, off 0.4–0.7, on 0.8–1.1, off 1.2–1.5, on 1.6… (period 0.8 s): the window ends dark
    const blink = (t: number) => (Math.round(t * 10) % 8 < 4 ? act(item('LED1')) : act())
    const j = new CheerJudge()
    const out: { t: number; d: unknown }[] = []
    for (let t = 0; t <= 3 + 1e-9; t += 0.1) {
      const tt = +t.toFixed(3)
      const d = j.step(snap('A', tt, blink(tt)), CLEAN, () => CLEAN, everything)
      if (d) out.push({ t: tt, d })
    }
    expect(out).toEqual([{ t: 1.6, d: { componentIds: ['LED1'], message: 'LED1 亮了' } }]) // lit again: the cheer plays over a lit LED
    // the window ending in an on-phase: at once
    const k = new CheerJudge()
    const on = (t: number) => (Math.round(t * 10) % 10 < 5 ? act(item('LED1')) : act()) // 0.5 s on / 0.5 s off
    const fired: number[] = []
    for (let t = 0; t <= 3 + 1e-9; t += 0.1) {
      const tt = +t.toFixed(3)
      if (k.step(snap('A', tt, on(tt)), CLEAN, () => CLEAN, everything)) fired.push(tt)
    }
    expect(fired).toEqual([1.2]) // on 1.0–1.4, repeating since 0
  })

  it('something that lit once and went dark is not "working": no cheer — lit again, it needs a whole new window', () => {
    const j = new CheerJudge()
    let judged = 0
    const judge = () => {
      judged++
      return CLEAN
    }
    expect(drive(j, 'A', 0, 0.1, act(item('LED1')), CLEAN, judge)).toEqual([])
    expect(drive(j, 'A', 0.2, 3, act(), CLEAN, judge)).toEqual([]) // dark for longer than a window
    expect(j.pendingSince).toBeNull() // that window is over: nothing it saw still works
    expect(judged).toBe(0)
    expect(drive(j, 'A', 3.1, 4.2, act(item('LED1')), CLEAN, judge)).toEqual([]) // lit again: a new window, not an instant cheer
    expect(judged).toBe(0)
    expect(drive(j, 'A', 4.3, 4.5, act(item('LED1')), CLEAN, judge)).toHaveLength(1) // … still lit after it: it works
    expect(judged).toBe(1)
  })

  it('a blocked judgement waits for a different problems list before it tries again', () => {
    const j = new CheerJudge()
    const warn = [prob('warning', ['LED1'])]
    let judged = 0
    expect(drive(j, 'A', 0, 1.2, act(item('LED1')), CLEAN, () => (judged++, warn))).toEqual([])
    expect(judged).toBe(1)
    // the published list now is that same blocking list: no new window, no extra computation
    expect(drive(j, 'A', 1.4, 5, act(item('LED1')), warn, () => (judged++, warn))).toEqual([])
    expect(judged).toBe(1)
    // the warning goes away (a knob): a new list → a new window → the cheer
    expect(drive(j, 'A', 5.1, 7, act(item('LED1')), CLEAN, () => CLEAN)).toHaveLength(1)
  })
})

/**
 * Final walkthrough M1: the cheer fired 「電路正常運作 ✓ · LED1 亮了」 over a
 * dark LED after a ~1 s button press (w14: LED1 lit 1.28 → 2.24 s, the cue at
 * 2.68 s; w13: a phone long-press pressed the running button for 0.9 s), and
 * 「…LED1 亮了 · U1 的 PA5 在切換」 just as button-exti's second press turned
 * the LED off (w4). At fire time every named thing is re-verified.
 */
describe('cheer: re-verified at fire time (M1)', () => {
  /** drive with a per-time activity and an optional hand time */
  function run(
    j: CheerJudge,
    rev: string,
    t0: number,
    t1: number,
    at: (t: number) => Activity,
    opts: { latestFrom?: number; handAt?: (t: number) => number | undefined; held?: (t: number) => boolean; judge?: () => Problem[] } = {},
  ) {
    const out: { t: number; d: NonNullable<ReturnType<CheerJudge['step']>> }[] = []
    for (let t = t0; t <= t1 + 1e-9; t += 0.1) {
      const tt = +t.toFixed(3)
      const latest = opts.latestFrom === undefined || tt >= opts.latestFrom ? CLEAN : null
      const d = j.step({ ...snap(rev, tt, at(tt)), handAt: opts.handAt?.(tt), held: opts.held?.(tt) }, latest, opts.judge ?? (() => CLEAN), everything)
      if (d) out.push({ t: tt, d })
    }
    return out
  }

  it('w14 repro: a 1 s press lights LED1 1.28 → 2.24 s (the list arrives at 1.48 s) — no cheer over the dark LED, nor later', () => {
    const j = new CheerJudge()
    let judged = 0
    const lit = (t: number) => (t >= 1.28 && t <= 2.24 ? act(item('LED1')) : act())
    const hand = (t: number) => (t >= 2.2 ? 2.2 : t >= 1.2 ? 1.2 : undefined) // pressed at 1.2, released at 2.2
    expect(run(j, 'A', 0, 8, lit, { latestFrom: 1.48, handAt: hand, judge: () => (judged++, CLEAN) })).toEqual([])
    expect(judged).toBe(0) // never even judged: nothing it would name was still true
    expect(j.pendingSince).toBeNull()
  })

  it('w13 repro: a phone long-press (0.9 s) inside a running window — the LED is dark at fire time: no cheer', () => {
    const j = new CheerJudge()
    const lit = (t: number) => (t >= 1.0 && t < 1.9 ? act(item('LED1')) : act())
    expect(run(j, 'A', 0, 6, lit, { handAt: (t) => (t >= 1.9 ? 1.9 : t >= 1.0 ? 1.0 : undefined) })).toEqual([])
  })

  it('… the same press without any hand signal (a lit run shorter than the window): still no cheer', () => {
    const j = new CheerJudge()
    expect(run(j, 'A', 0, 6, (t) => (t >= 1.0 && t < 1.9 ? act(item('LED1')) : act()))).toEqual([])
  })

  it('a button KEPT pressed (保持按下) longer than the window: the cheer plays while the LED is lit (the hand settles first)', () => {
    // 保持按下 at 1.0 s (no finger on it), let go at 4.0 s: a steady state — it cheers like any circuit
    const j = new CheerJudge()
    const lit = (t: number) => (t >= 1.0 && t < 4.0 ? act(item('LED1')) : act())
    const out = run(j, 'A', 0, 6, lit, { handAt: (t) => (t >= 4.0 ? 4.0 : t >= 1.0 ? 1.0 : undefined) })
    expect(out).toEqual([{ t: 2.2, d: { componentIds: ['LED1'], message: 'LED1 亮了' } }])
    expect(lit(2.2).items).toHaveLength(1) // lit at that moment
  })

  it('M1 verification: a FINGER holding the button just past the window (1.25 / 1.3 / 1.4 / 1.7 / 2.5 / 3 s) never cheers — not while held, not after the release', () => {
    // npn-switch: pressed at 1.0 s, LED1 lit while the finger holds SW1 (the cue once came at 2.59 s
    // for a 1.3 s press, 20 ms before the release, and the toast then sat over the dark LED)
    for (const hold of [1.25, 1.3, 1.4, 1.7, 2.5, 3]) {
      const j = new CheerJudge()
      const up = 1.0 + hold
      const lit = (t: number) => (t >= 1.05 && t < up ? act(item('LED1')) : act())
      const out = run(j, 'A', 0, 9, lit, {
        latestFrom: 0.5,
        handAt: (t) => (t >= up ? up : t >= 1.0 ? 1.0 : undefined),
        held: (t) => t >= 1.0 && t < up,
      })
      expect({ hold, out }).toEqual({ hold, out: [] })
      expect(j.pendingSince).toBeNull() // dropped after the release: what the finger kept alive went dark
    }
  })

  it('… a finger held for a long time (8 s) never lets the window run out meanwhile, and after the release only what still works cheers', () => {
    // LED1 steady from 0 (its own circuit, unrelated to the button); LED2 lit only while SW1 is held 0.3 → 8.3 s
    const j = new CheerJudge()
    const at = (t: number) => (t >= 0.3 && t < 8.3 ? act(item('LED1'), item('LED2')) : act(item('LED1')))
    const out = run(j, 'A', 0, 12, at, {
      handAt: (t) => (t >= 8.3 ? 8.3 : t >= 0.3 ? 0.3 : undefined),
      held: (t) => t >= 0.3 && t < 8.3,
    })
    expect(out).toHaveLength(1)
    expect(out[0].t).toBeGreaterThanOrEqual(8.3 + HAND_SETTLE_S - 1e-9) // nothing judged while the finger was on it
    expect(out[0].d).toEqual({ componentIds: ['LED1'], message: 'LED1 亮了' }) // LED2 went dark with the release: dropped
  })

  it('… the finger lets go INTO 保持按下 (the long-press sheet / the inspector toggle): it cheers once settled, while the LED is lit', () => {
    // pressed by a finger at 1.0 s, 保持按下 at 1.8 s (the button stays pressed, no finger): LED1 stays lit
    const j = new CheerJudge()
    const lit = (t: number) => (t >= 1.05 ? act(item('LED1')) : act())
    const out = run(j, 'A', 0, 5, lit, {
      latestFrom: 0.5,
      handAt: (t) => (t >= 1.8 ? 1.8 : t >= 1.0 ? 1.0 : undefined),
      held: (t) => t >= 1.0 && t < 1.8,
    })
    expect(out).toHaveLength(1)
    expect(out[0].t).toBeGreaterThanOrEqual(Math.max(1.1 + CHEER_WINDOW_S, 1.8 + HAND_SETTLE_S) - 1e-9)
    expect(out[0].d).toEqual({ componentIds: ['LED1'], message: 'LED1 亮了' })
    expect(lit(out[0].t).items).toHaveLength(1)
  })

  it('… what a finger kept alive never counts as having worked: an edit after the release still lets 保持按下 cheer it', () => {
    const j = new CheerJudge()
    // a 0.8 s finger press lights LED1 (rev A), released; then a knob-free edit (rev B); then 保持按下 lights it for good
    run(j, 'A', 0, 3, (t) => (t >= 1.0 && t < 1.8 ? act(item('LED1')) : act()), {
      handAt: (t) => (t >= 1.8 ? 1.8 : t >= 1.0 ? 1.0 : undefined),
      held: (t) => t >= 1.0 && t < 1.8,
    })
    const out = run(j, 'B', 3.1, 7, (t) => (t >= 4.0 ? act(item('LED1')) : act()), { handAt: (t) => (t >= 4.0 ? 4.0 : 1.8) })
    expect(out).toHaveLength(1)
    expect(out[0].d.message).toBe('LED1 亮了')
  })

  it('a button released just before the window ends: the cue waits HAND_SETTLE_S, then names only what still works', () => {
    // LED1 steady from 0 (unrelated to the button); LED2 lit while SW1 is pressed 0.2 → 1.15 s
    const j = new CheerJudge()
    const two = (t: number) => (t >= 0.2 && t < 1.15 ? act(item('LED1'), item('LED2')) : act(item('LED1')))
    const out = run(j, 'A', 0, 4, two, { handAt: (t) => (t >= 1.15 ? 1.15 : t >= 0.2 ? 0.2 : undefined) })
    expect(out).toHaveLength(1)
    expect(out[0].t).toBeGreaterThanOrEqual(1.15 + HAND_SETTLE_S - 1e-9)
    expect(out[0].d).toEqual({ componentIds: ['LED1'], message: 'LED1 亮了' }) // LED2 went dark with the release: dropped
  })

  it('a phrase that stopped being true before the cue is dropped; with none left there is no cue', () => {
    const j = new CheerJudge()
    // LED1 and LED2 lit from 0; LED2 goes dark at 0.9 s (inside the window)
    const out = run(j, 'A', 0, 3, (t) => (t < 0.9 ? act(item('LED1'), item('LED2')) : act(item('LED1'))))
    expect(out).toEqual([{ t: 1.2, d: { componentIds: ['LED1'], message: 'LED1 亮了' } }])
    // both dark before the window ends: nothing
    const k = new CheerJudge()
    expect(run(k, 'A', 0, 4, (t) => (t < 1.1 ? act(item('LED1'), item('LED2')) : act()))).toEqual([])
  })

  it('something lit only in the window’s last half is not proven yet: the cue waits until it has been on for half a window (bounded)', () => {
    const j = new CheerJudge()
    // LED1 from 0; LED2 from 1.0 s (late): the cue waits for LED2 to cover half a window → both named at 1.6 s
    const out = run(j, 'A', 0, 4, (t) => (t < 1.0 ? act(item('LED1')) : act(item('LED1'), item('LED2'))))
    expect(out).toEqual([{ t: 1.6, d: { componentIds: ['LED1', 'LED2'], message: 'LED1 亮了 · LED2 亮了' } }])
    // never waits forever: a thing flickering in and out at every sample — the cue goes out with what is proven
    const k = new CheerJudge()
    const flick = (t: number) => (Math.round(t * 10) % 2 === 0 ? act(item('LED1'), item('U1', 'toggles:PA0')) : act(item('LED1')))
    const o2 = run(k, 'A', 0, 6, flick)
    expect(o2).toHaveLength(1)
    expect(o2[0].t).toBeLessThanOrEqual(CHEER_WINDOW_S + CHEER_WAIT_S + 1e-9)
    expect(o2[0].d.componentIds).toContain('LED1')
  })

  it('w4 repro: a pin toggled by two presses (button-exti) is not 「在切換」, and the LED its second press turned off is not 「亮了」', () => {
    const j = new CheerJudge()
    // press 1 at 0.5 s: PA5 → high, LED1 on; press 2 at 1.5 s: PA5 → low, LED1 off (the window opened at 0.6 s)
    const pin = (n: number, last: number): ActivityItem => ({
      key: 'U1:toggles:PA5',
      id: 'U1',
      phrase: n === 1 ? 'U1 的 PA5 切換了' : 'U1 的 PA5 在切換',
      changes: n,
      lastChange: last,
    })
    const at = (t: number) => (t < 0.5 ? act() : t < 1.5 ? act(item('LED1'), pin(1, 0.5)) : t < 4.3 ? act(pin(2, 1.5)) : act())
    const hand = (t: number) => (t >= 1.6 ? 1.6 : t >= 1.5 ? 1.5 : t >= 0.6 ? 0.6 : t >= 0.5 ? 0.5 : undefined)
    expect(run(j, 'A', 0, 8, at, { latestFrom: 0.6, handAt: hand })).toEqual([])
  })

  it('a pin that changed ONCE and holds its new level after a press: 「U1 的 PA5 切換了」 — the latched LED and the pin cheer', () => {
    const j = new CheerJudge()
    const pin: ActivityItem = { key: 'U1:toggles:PA5', id: 'U1', phrase: 'U1 的 PA5 切換了', changes: 1, lastChange: 0.5 }
    const at = (t: number) => (t < 0.5 ? act() : act(item('LED1'), pin))
    const out = run(j, 'A', 0, 4, at, { latestFrom: 0.6, handAt: (t) => (t >= 0.6 ? 0.6 : t >= 0.5 ? 0.5 : undefined) })
    expect(out).toEqual([{ t: 1.8, d: { componentIds: ['LED1', 'U1'], message: 'LED1 亮了 · U1 的 PA5 切換了' } }])
  })

  it('firmware that keeps toggling while a button moves: the toggling counts once a change came after the hand settled', () => {
    const j = new CheerJudge()
    // PA5 toggles every 0.5 s from 0.5 s (blink); a click at 1.0 s
    const pin = (t: number): ActivityItem => {
      const n = Math.floor(t / 0.5 + 1e-9)
      return { key: 'U1:toggles:PA5', id: 'U1', phrase: n === 1 ? 'U1 的 PA5 切換了' : 'U1 的 PA5 在切換', changes: n, lastChange: n * 0.5 }
    }
    const out = run(j, 'A', 0, 4, (t) => (t < 0.5 ? act() : act(pin(t))), { handAt: (t) => (t >= 1.0 ? 1.0 : undefined) })
    expect(out).toHaveLength(1)
    expect(out[0].t).toBeGreaterThanOrEqual(1.5) // the change at 1.5 s came after the hand (1.0 + HAND_SETTLE_S)
    expect(out[0].d.message).toBe('U1 的 PA5 在切換')
  })

  it('verdict() itself: gone / due back / not settled / proven', () => {
    const j = new CheerJudge()
    const tr = (over: Partial<CheerTrack>): CheerTrack => ({ it: item('LED1'), first: 0, runStart: 0, onsets: [0], ...over })
    expect(j.verdict(tr({ runStart: null }), 1.2, -Infinity)).toBe('no') // lit once, gone
    expect(j.verdict(tr({ runStart: null, onsets: [0, 0.8] }), 1.2, -Infinity)).toBe('wait') // blinking, due back
    expect(j.verdict(tr({ runStart: null, onsets: [0, 0.8] }), 3, -Infinity)).toBe('no') // stopped blinking
    expect(j.verdict(tr({}), 1.2, 1.0)).toBe('wait') // a button moved 0.2 s ago
    expect(j.verdict(tr({}), 1.0 + HAND_SETTLE_S, 1.0)).toBe('yes')
    expect(j.verdict(tr({ runStart: 1.0, onsets: [1.0] }), 1.2, -Infinity)).toBe('wait') // on only since 1.0
    expect(j.verdict(tr({ runStart: 1.0, onsets: [0, 1.0] }), 1.2, -Infinity)).toBe('yes') // repeating since 0
    expect(j.verdict(tr({ it: { ...item('U1', 'toggles:PA5'), changes: 3, lastChange: 1.1 } }), 2, 1.0)).toBe('wait') // toggled only around the hand
    expect(j.verdict(tr({ it: { ...item('U1', 'toggles:PA5'), changes: 4, lastChange: 1.5 } }), 2, 1.0)).toBe('yes')
  })
})

describe('cheer: an MCU pin’s item tells the truth now (circuitActivity with the watcher’s change log)', () => {
  const layout: CircuitLayout = { version: 1, components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h30' }], wires: [] }
  const tel = (time: number, pa5: number): SimTelemetry => ({
    time,
    netVoltages: {},
    issues: [],
    components: { U1: { pinVoltages: { PA5: pa5 }, mcu: { state: 'running', pc: 0, hclkHz: 8e6, cycles: 1, pinModes: { PA5: 'out' } } } },
  })

  it('once → 「切換了」 (held); again and again → 「在切換」; stopped → no item; the item carries its changes', () => {
    const levels = new Map<string, number>()
    const toggled = new Set<string>()
    const changes: PinChanges = new Map()
    const at = (time: number, v: number) => circuitActivity(layout, tel(time, v), levels, toggled, changes)
    expect(at(0.1, 0).items).toEqual([])
    expect(at(0.5, 3.3).items).toEqual([{ key: 'U1:toggles:PA5', id: 'U1', phrase: 'U1 的 PA5 切換了', changes: 1, lastChange: 0.5 }])
    expect(at(3.0, 3.3).phrases).toEqual(['U1 的 PA5 切換了']) // holds its new level: still true
    expect(at(3.1, 0).phrases).toEqual(['U1 的 PA5 在切換']) // a second change
    expect(at(3.6, 3.3).items[0]).toMatchObject({ phrase: 'U1 的 PA5 在切換', changes: 3, lastChange: 3.6 })
    expect(at(4.1, 0).items[0]).toMatchObject({ changes: 4, lastChange: 4.1 })
    // the 10 Hz telemetry goes on; PA5 stays low from 4.1 s (it toggled every 0.5 s)
    const seen: Record<string, string[]> = {}
    for (let t = 4.2; t <= 6.0 + 1e-9; t += 0.1) seen[t.toFixed(1)] = at(+t.toFixed(3), 0).phrases
    expect(seen['4.8']).toEqual(['U1 的 PA5 在切換']) // within its period (0.5 s × 1.5 + the sampling)
    expect(seen['5.3']).toEqual([]) // 1.2 s without a change: it stopped toggling — no activity any more
    expect(seen['6.0']).toEqual([])
    expect(stillToggling(changes.get('U1:PA5')!, 6.0)).toBe(false)
  })

  it('without the change log (older callers) a pin that took both levels reads 「在切換」 as before', () => {
    const levels = new Map<string, number>()
    const toggled = new Set<string>()
    circuitActivity(layout, tel(0.1, 0), levels, toggled)
    expect(circuitActivity(layout, tel(0.5, 3.3), levels, toggled).phrases).toEqual(['U1 的 PA5 在切換'])
    expect(circuitActivity(layout, tel(9, 3.3), levels, toggled).phrases).toEqual(['U1 的 PA5 在切換'])
  })
})

describe('cheer: fingerHeld — a finger on a button, not 保持按下', () => {
  const lay = (sw: Record<string, boolean>, extra: CircuitLayout['components'] = []): CircuitLayout => ({
    version: 1,
    components: [{ id: 'SW1', type: 'pushbutton', holes: ['e10', 'e12', 'f10', 'f12'], params: sw }, { id: 'R1', type: 'resistor', holes: ['a1', 'a5'], params: { pressed: true } }, ...extra],
    wires: [],
  })
  it('pressed + held (the 3D press-and-hold, the 按住 puck) is a finger; pressed alone is kept pressed; released is nothing', () => {
    expect(fingerHeld(lay({ pressed: true }), ['SW1'], false)).toEqual(['SW1'])
    expect(fingerHeld(lay({ pressed: true }), [], false)).toEqual([]) // 保持按下
    expect(fingerHeld(lay({ pressed: false }), ['SW1'], false)).toEqual([]) // the release's first write
    expect(fingerHeld(lay({}), [], false)).toEqual([])
  })
  it('the English classic chrome has no 保持按下 for the pushbutton: a pressed pushbutton there is always a finger', () => {
    expect(fingerHeld(lay({ pressed: true }), [], true)).toEqual(['SW1'])
    // a part that is not pressable never counts (R1 above carries a stray 'pressed')
    expect(fingerHeld(lay({ pressed: false }), ['R1'], true)).toEqual([])
  })
})
