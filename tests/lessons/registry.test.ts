/**
 * Lesson registry contract — generic over EVERY lesson in LESSONS
 * (src/lessons/<level>/*.lesson.ts, written concurrently by several
 * authors), evaluated through the REAL lesson evaluator
 * (src/lessons/engine/evaluate.ts: netlist, coordinator running the bundled
 * firmware/dist images, ERC, firmware contracts):
 *
 *  - ids unique and stable-looking, levels valid, step ids unique;
 *  - every user-visible text non-empty and Traditional Chinese (CJK present,
 *    no mainland terms — tests/i18n/zh-check.ts — no half-width punctuation
 *    glued to Chinese in titles);
 *  - start / solution layouts pass validateLayout; every part type exists in
 *    the catalog; every firmware the lesson names exists in firmware/dist;
 *    every step highlight names a hole / terminal ref or a part of the
 *    lesson's circuits;
 *  - runnable ('ready' / 'partial') lessons: acceptance checks exist, the
 *    SOLUTION passes every one and the START fails at least one;
 *  - 'partial' / 'not-yet' lessons say why (runnableNote).
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import '../../src/mcu/all'
import { LESSONS, lessonById } from '../../src/lessons'
import type { Lesson, LessonCheck, PinRef } from '../../src/lessons/types'
import { evaluateLesson, type EvaluatedCheck } from '../../src/lessons/engine/evaluate'
import { validateLayout } from '../../src/model/validate'
import { CATALOG } from '../../src/model/catalog'
import { parseHole, parseTerminalRef } from '../../src/model/breadboard'
import { MAINLAND_TERMS, englishLeft } from '../i18n/zh-check'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../../firmware/dist')
const LONG = { timeout: 900_000 }
const CJK = /[一-鿿]/
/** fields that may be a short technical item instead of a sentence */
const SHORT = /^expected\[|\.label$/

/** code spans and quoted literals (firmware output, identifiers) are not prose */
function withoutLiterals(s: string): string {
  return s.replace(/`[^`]*`/g, ' ').replace(/「[^」]*」/g, ' ').replace(/“[^”]*”/g, ' ')
}

function explain(results: EvaluatedCheck[]): string {
  const lines: string[] = []
  const walk = (r: EvaluatedCheck, depth: number) => {
    lines.push(`${'  '.repeat(depth)}${r.pass ? 'PASS' : 'FAIL'} [${r.kind}] ${r.label}: ${r.detail}${r.technical ? ` | ${r.technical.join(' | ')}` : ''}`)
    for (const c of r.children ?? []) walk(c, depth + 1)
  }
  results.forEach((r) => walk(r, 0))
  return lines.join('\n')
}

/** Every user-visible text field of a lesson, with where it lives. */
function texts(l: Lesson): [string, string][] {
  const out: [string, string][] = [
    ['title', l.title],
    ['summary', l.summary],
    ['wiring', l.wiring],
    ['theory', l.theory],
    ...l.objectives.map((x, i): [string, string] => [`objectives[${i}]`, x]),
    ...l.expected.map((x, i): [string, string] => [`expected[${i}]`, x]),
    ...l.mistakes.flatMap((m, i): [string, string][] => [
      [`mistakes[${i}].symptom`, m.symptom],
      [`mistakes[${i}].cause`, m.cause],
      [`mistakes[${i}].fix`, m.fix],
    ]),
    ...l.steps.flatMap((s): [string, string][] => [
      [`steps.${s.id}.title`, s.title],
      [`steps.${s.id}.body`, s.body],
    ]),
  ]
  if (l.runnableNote !== undefined) out.push(['runnableNote', l.runnableNote])
  const labels = (c: LessonCheck, where: string): [string, string][] => [
    ...(c.label !== undefined ? [[`${where}.label`, c.label] as [string, string]] : []),
    ...(c.kind === 'all' ? c.checks.flatMap((x, i) => labels(x, `${where}.checks[${i}]`)) : []),
  ]
  l.acceptance.forEach((c, i) => out.push(...labels(c, `acceptance[${i}]`)))
  l.steps.forEach((s) => s.check && out.push(...labels(s.check, `steps.${s.id}.check`)))
  return out
}

function allChecks(l: Lesson): LessonCheck[] {
  const out: LessonCheck[] = []
  const walk = (c: LessonCheck): void => {
    out.push(c)
    if (c.kind === 'all') c.checks.forEach(walk)
  }
  l.acceptance.forEach(walk)
  l.steps.forEach((s) => s.check && walk(s.check))
  return out
}

/** firmware/dist projects a lesson names anywhere. */
function firmwareNames(l: Lesson): string[] {
  const names = new Set<string>([
    ...Object.values(l.start.firmware ?? {}),
    ...Object.values(l.solution.firmware ?? {}),
    ...(l.requires?.firmware ?? []),
  ])
  for (const c of allChecks(l)) {
    if (c.kind === 'firmware-loaded' && c.project) names.add(c.project)
    if (c.kind === 'firmware-checks') names.add(c.project)
  }
  return [...names]
}

function pinRefsOf(c: LessonCheck): PinRef[] {
  switch (c.kind) {
    case 'connected':
    case 'not-connected':
      return [c.a, c.b]
    case 'measure':
      return [c.at]
    default:
      return []
  }
}

describe('lesson registry', () => {
  it('has lessons, sorted by level then order, with unique ids', () => {
    expect(LESSONS.length).toBeGreaterThan(0)
    const ids = LESSONS.map((l) => l.id)
    expect(new Set(ids).size, `duplicate ids: ${ids.filter((x, i) => ids.indexOf(x) !== i).join(', ')}`).toBe(ids.length)
    const rank = { beginner: 0, intermediate: 1, advanced: 2 } as const
    for (let i = 1; i < LESSONS.length; i++) {
      const a = LESSONS[i - 1]
      const b = LESSONS[i]
      expect(rank[a.level] < rank[b.level] || (rank[a.level] === rank[b.level] && a.order <= b.order), `${a.id} before ${b.id}`).toBe(
        true,
      )
    }
    for (const l of LESSONS) expect(lessonById(l.id)).toBe(l)
  })

  for (const l of LESSONS) {
    describe(l.id, () => {
      it('is well-formed (id, level, steps, runnable note)', () => {
        expect(l.id).toMatch(/^[a-z0-9][a-z0-9-]*$/)
        expect(['beginner', 'intermediate', 'advanced']).toContain(l.level)
        expect(['ready', 'partial', 'not-yet']).toContain(l.runnable)
        expect(Number.isFinite(l.order)).toBe(true)
        if (l.durationMin !== undefined) expect(l.durationMin).toBeGreaterThan(0)
        expect(l.objectives.length).toBeGreaterThan(0)
        expect(l.steps.length).toBeGreaterThan(0)
        const stepIds = l.steps.map((s) => s.id)
        expect(new Set(stepIds).size, 'step ids unique').toBe(stepIds.length)
        for (const s of stepIds) expect(s.length).toBeGreaterThan(0)
        if (l.runnable !== 'ready') expect(l.runnableNote?.trim(), 'a partial / not-yet lesson says what is missing').toBeTruthy()
        if (l.runnable !== 'not-yet') expect(l.acceptance.length, 'runnable lessons have acceptance checks').toBeGreaterThan(0)
      })

      it('text is non-empty Traditional Chinese (Taiwan usage)', () => {
        for (const [where, s] of texts(l)) {
          expect(typeof s === 'string' && s.trim().length > 0, `${l.id} ${where} is empty`).toBe(true)
          // prose is Chinese; a short item (expected result, check label) may
          // be purely technical ("PB12 ≈ 3.3 V") but never untranslated English
          const short = SHORT.test(where)
          const english = englishLeft(withoutLiterals(s))
          expect(
            CJK.test(s) || (short && english.length === 0),
            `${l.id} ${where} is not Chinese: ${s.slice(0, 80)}${english.length ? ` (English: ${english.join(', ')})` : ''}`,
          ).toBe(true)
          for (const term of MAINLAND_TERMS) expect(s.includes(term), `${l.id} ${where}: mainland term “${term}”`).toBe(false)
        }
      })

      it('circuits validate; parts and firmware exist', () => {
        for (const [what, c] of [
          ['start', l.start],
          ['solution', l.solution],
        ] as const) {
          const v = validateLayout(c.layout)
          expect(v.errors, `${l.id} ${what} layout`).toEqual([])
          expect(v.ok).toBe(true)
          for (const comp of c.layout.components) expect(CATALOG[comp.type], `${what}: ${comp.type}`).toBeDefined()
          for (const id of Object.keys(c.firmware ?? {})) {
            const comp = c.layout.components.find((x) => x.id === id)
            expect(comp, `${what}: firmware bound to missing ${id}`).toBeDefined()
            expect(CATALOG[comp!.type]?.mcu, `${what}: ${id} is not an MCU board`).toBeDefined()
          }
        }
        for (const p of l.requires?.parts ?? []) expect(CATALOG[p], `requires.parts ${p}`).toBeDefined()
        for (const c of allChecks(l)) {
          if (c.kind === 'has-part') expect(CATALOG[c.type], `has-part ${c.type}`).toBeDefined()
          if (c.kind === 'connected' && c.via) expect(CATALOG[c.via.type], `via ${c.via.type}`).toBeDefined()
        }
        for (const fw of firmwareNames(l)) expect(existsSync(join(DIST, `${fw}.elf`)), `firmware/dist/${fw}.elf`).toBe(true)
      })

      it('highlights and check refs name holes, terminals or parts of the lesson', () => {
        const ids = new Set([...l.start.layout.components, ...l.solution.layout.components].map((c) => c.id))
        const okRef = (r: string) => parseHole(r) !== null || (parseTerminalRef(r) !== null && ids.has(parseTerminalRef(r)!.componentId))
        for (const s of l.steps) {
          for (const h of s.highlight?.holes ?? []) expect(okRef(h), `${s.id} highlight hole “${h}”`).toBe(true)
          for (const c of s.highlight?.components ?? []) expect(ids.has(c), `${s.id} highlight part “${c}”`).toBe(true)
        }
        for (const c of allChecks(l)) {
          for (const r of pinRefsOf(c)) {
            if ('hole' in r) expect(parseHole(r.hole), `hole “${r.hole}”`).not.toBeNull()
            else if ('terminal' in r) expect(okRef(r.terminal), `terminal “${r.terminal}”`).toBe(true)
            else expect(ids.has(r.component), `part “${r.component}”`).toBe(true)
          }
          if (c.kind === 'measure' && c.component) expect(ids.has(c.component.split('/')[0]), `measure part “${c.component}”`).toBe(true)
          if (c.kind === 'firmware-loaded' || c.kind === 'uart-contains') expect(ids.has(c.component), `part “${c.component}”`).toBe(true)
          // a check's runtime stimulus: a part of the lesson, a RUNTIME param of its catalog type, a time ≥ 0
          if (c.kind === 'measure' || c.kind === 'uart-contains') {
            for (const st of c.stimulus ?? []) {
              const part = [...l.solution.layout.components, ...l.start.layout.components].find((x) => x.id === st.component)
              expect(part, `stimulus part “${st.component}”`).toBeDefined()
              const def = CATALOG[part!.type]?.params?.find((p) => p.key === st.param)
              expect(def?.runtime, `stimulus “${st.component}.${st.param}” is a runtime param`).toBe(true)
              expect(Number.isFinite(st.at) && st.at >= 0, `stimulus time ${st.at}`).toBe(true)
            }
          }
        }
      })

      if (l.runnable !== 'not-yet') {
        it('the solution passes every acceptance check', LONG, async () => {
          const ev = await evaluateLesson(l, l.solution)
          expect(ev.results.length).toBe(l.acceptance.length)
          expect(ev.pass, `${l.id} solution\n${explain(ev.results)}`).toBe(true)
        })

        it('the starting circuit fails at least one acceptance check', LONG, async () => {
          const ev = await evaluateLesson(l, l.start)
          expect(ev.pass, `${l.id} start\n${explain(ev.results)}`).toBe(false)
          // a failure is a real verdict, never an evaluator error
          expect(ev.results.filter((r) => r.error).map((r) => r.label)).toEqual([])
        })
      }
    })
  }
})
