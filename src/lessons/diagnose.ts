/**
 * "Root cause first" for a failed lesson check run (UX LS-5) — pure
 * functions over the acceptance checks, their evaluated results, the live
 * layout and an ERC result; src/ui/lessons/CheckResults.tsx renders them.
 *
 *   missingStartParts   are the parts the acceptance names on the board at
 *                       all? (half or more missing → "load the start circuit")
 *   relatedFindings     ERC findings about the parts of the failing checks
 *   matchMistake        the first common mistake whose `match` fits
 *   dependentFailures   measure checks that fail only because a structural
 *                       check on the same parts fails ("另外 n 項因此未通過")
 *
 * Nothing here invents a diagnosis: every line it feeds the UI is an ERC
 * finding of the real circuit or a mistake the lesson author tied to the
 * exact pass / fail pattern of its checks.
 */
import type { CircuitLayout } from '../model/types'
import { parseTerminalRef } from '../model/breadboard'
import { getEntry } from '../model/catalog'
import { ERC_LEVEL_ORDER, type ErcFinding } from '../sim/erc'
import type { EvaluatedCheck } from './engine/evaluate'
import type { Lesson, LessonCheck, LessonMistake, PinRef } from './types'

/** Answered by the netlist alone (no simulated time, no firmware). */
export function isStructuralCheck(c: LessonCheck): boolean {
  return (
    c.kind === 'has-part' ||
    c.kind === 'connected' ||
    c.kind === 'not-connected' ||
    (c.kind === 'all' && c.checks.every(isStructuralCheck))
  )
}

function refPart(r: PinRef): string | null {
  if ('component' in r) return r.component
  if ('terminal' in r) return parseTerminalRef(r.terminal)?.componentId ?? null
  return null
}

/** Ids of the parts the acceptance checks name (PinRef parts, terminals' parts, measured / MCU parts). */
export function referencedParts(lesson: Lesson): string[] {
  const out = new Set<string>()
  const walk = (c: LessonCheck): void => {
    switch (c.kind) {
      case 'connected':
      case 'not-connected':
        for (const r of [c.a, c.b]) {
          const id = refPart(r)
          if (id) out.add(id)
        }
        return
      case 'measure': {
        const id = c.component ? c.component.split('/')[0] : refPart(c.at)
        if (id) out.add(id)
        return
      }
      case 'firmware-loaded':
      case 'uart-contains':
        out.add(c.component)
        return
      case 'all':
        c.checks.forEach(walk)
        return
      default:
        return
    }
  }
  lesson.acceptance.forEach(walk)
  return [...out]
}

/**
 * Which of those parts the live board lacks; `mostlyMissing` = half or more
 * of them, or the lesson's microcontroller board (another lesson's circuit
 * may share PS1 / LED1, but never the board the lesson programs).
 */
export function missingStartParts(lesson: Lesson, layout: CircuitLayout): { missing: string[]; total: number; mostlyMissing: boolean } {
  const ids = new Set((Array.isArray(layout.components) ? layout.components : []).map((c) => c?.id))
  const parts = referencedParts(lesson)
  const missing = parts.filter((p) => !ids.has(p))
  const mcus = new Set(
    [...lesson.start.layout.components, ...lesson.solution.layout.components].filter((c) => !!getEntry(c.type)?.mcu).map((c) => c.id),
  )
  const mostlyMissing = parts.length > 0 && (missing.length * 2 >= parts.length || missing.some((p) => mcus.has(p)))
  return { missing, total: parts.length, mostlyMissing }
}

/** Parts named by the failing top-level results. */
export function failingComponents(results: readonly EvaluatedCheck[]): string[] {
  const out = new Set<string>()
  for (const r of results) if (!r.pass) for (const c of r.focus?.components ?? []) out.add(c)
  return [...out]
}

/** 'rule' matches the rule; 'rule:tail' a finding of that rule whose id ends with ':tail'. */
export function findingMatches(f: ErcFinding, rule: string): boolean {
  const i = rule.indexOf(':')
  if (i < 0) return f.rule === rule
  return f.rule === rule.slice(0, i) && f.id.endsWith(`:${rule.slice(i + 1)}`)
}

/** ERC findings (any level) about the parts of the failing checks, most severe first. */
export function relatedFindings(findings: readonly ErcFinding[], results: readonly EvaluatedCheck[], limit = 2): ErcFinding[] {
  const comps = new Set(failingComponents(results))
  if (comps.size === 0) return []
  return findings
    .filter((f) => f.componentIds.some((c) => comps.has(c)))
    .sort((a, b) => ERC_LEVEL_ORDER[a.level] - ERC_LEVEL_ORDER[b.level])
    .slice(0, limit)
}

/** The first common mistake whose `match` fits the results (null when none, or when all pass). */
export function matchMistake(lesson: Lesson, results: readonly EvaluatedCheck[], findings: readonly ErcFinding[]): LessonMistake | null {
  if (results.every((r) => r.pass)) return null
  for (const m of lesson.mistakes) {
    const mt = m.match
    if (!mt || !(mt.checks?.length || mt.passes?.length || mt.ercRules?.length || mt.components?.length)) continue
    if (mt.checks?.some((i) => !results[i] || results[i].pass)) continue
    if (mt.passes?.some((i) => !results[i] || !results[i].pass)) continue
    if (mt.ercRules?.length && !findings.some((f) => mt.ercRules!.some((r) => findingMatches(f, r)))) continue
    if (mt.components?.length) {
      const involved = new Set([...failingComponents(results), ...findings.flatMap((f) => f.componentIds)])
      if (!mt.components.some((c) => involved.has(c))) continue
    }
    return m
  }
  return null
}

/**
 * Keys of failing MEASURE results that share a part with a failing
 * structural check — they cannot pass before the wiring does, so the list
 * folds them under "另外 n 項因此未通過". `checks[i]` is the check of
 * `results[i]`.
 */
export function dependentFailures(checks: readonly LessonCheck[], results: readonly EvaluatedCheck[]): Set<string> {
  const structural = new Set<string>()
  results.forEach((r, i) => {
    const c = checks[i]
    if (!r.pass && c && isStructuralCheck(c)) for (const id of r.focus?.components ?? []) structural.add(id)
  })
  const out = new Set<string>()
  if (structural.size === 0) return out
  results.forEach((r, i) => {
    const c = checks[i]
    if (r.pass || !c || c.kind !== 'measure') return
    if ((r.focus?.components ?? []).some((id) => structural.has(id))) out.add(r.key)
  })
  return out
}
