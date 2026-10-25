/**
 * Static coverage of the runtime messages the simulation layer can show:
 * every message template extracted from the sources (tests/i18n/
 * extract-messages.ts — addIssue / reportIssue / issue( / log( / once( /
 * warnings.push / errors.push / throw new Error / `message:` … in src/sim,
 * src/mcu, the lab store, project files, the store's user-facing errors and
 * the layout validator) must translate COMPLETELY under zh-TW: with probe
 * values in place of the `${…}` placeholders, tMessage() returns a string
 * with no English words left (technical tokens aside, see zh-check.ts).
 *
 * A new English message anywhere in those files fails here until a pattern
 * for it exists in src/i18n/zh-TW/messages-*.ts.
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../../src/i18n'
import { tMessage } from '../../src/i18n/messages'
import { PLACEHOLDER, extractFiles, walk } from './extract-messages'
import type { ExtractedMessage } from './extract-messages'
import { englishLeft } from './zh-check'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCOPES = ['src/sim', 'src/mcu', 'src/state/lab.ts', 'src/state/project.ts', 'src/state/store.ts', 'src/model/validate.ts']

/**
 * Extracted literals that are not messages a user sees (developer / CLI
 * output, internal invariants). Keyed by `file` → template prefixes.
 */
const NOT_USER_FACING: Record<string, string[]> = {
  // formatReport(): the firmware build's console report (firmware/build.mjs), not the app
  'src/sim/coordinator/checks.ts': ['  [', '      log ', '      ok  ', '      FAIL'],
}

/**
 * Constants that are only shown composed with others; their composed texts
 * (the live peripheral support table) are checked exactly by
 * messages-dynamic.test.ts.
 */
const COMPOSED_ONLY: Record<string, string[]> = {
  'src/mcu/stm32f1/tim.ts': ['Lazy 16-bit counter', 'Advanced-control timer'],
}

function files(): string[] {
  return SCOPES.flatMap((s) => {
    const abs = path.join(ROOT, s)
    return s.endsWith('.ts') ? [abs] : walk(abs, (f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  })
}

const UNIFORM = ['U1', '7', 'PA5', 'x', '']
const MIXED = ['U1', '7', '']

function probes(n: number): string[][] {
  const out: string[][] = UNIFORM.map((v) => Array<string>(n).fill(v))
  if (n >= 1 && n <= 4) {
    const total = MIXED.length ** n
    for (let k = 0; k < total; k++) {
      const v: string[] = []
      let x = k
      for (let i = 0; i < n; i++) {
        v.push(MIXED[x % MIXED.length])
        x = Math.floor(x / MIXED.length)
      }
      out.push(v)
    }
  }
  return out
}

function fill(template: string, values: string[]): string {
  let i = 0
  return template.replace(new RegExp(PLACEHOLDER, 'g'), () => values[i++] ?? '')
}

/** null when some probe translates completely, else the best attempt. */
function untranslated(template: string): { msg: string; out: string; left: string[] } | null {
  const n = template.split(PLACEHOLDER).length - 1
  let best: { msg: string; out: string; left: string[] } | null = null
  for (const values of probes(n)) {
    const msg = fill(template, values)
    const out = tMessage(msg)
    const left = out === msg ? ['(untranslated)'] : englishLeft(out)
    if (left.length === 0) return null
    if (!best || left.length < best.left.length) best = { msg, out, left }
  }
  return best
}

describe('runtime messages: static coverage (zh-TW)', () => {
  beforeAll(() => __setLangForTests('zh-TW'))
  afterAll(() => __setLangForTests('zh-TW'))

  const all: ExtractedMessage[] = extractFiles(ROOT, files())
  const seen = new Set<string>()
  const templates = all.filter((m) => {
    if ((NOT_USER_FACING[m.file] ?? []).some((p) => m.template.startsWith(p))) return false
    if ((COMPOSED_ONLY[m.file] ?? []).some((p) => m.template.startsWith(p))) return false
    const key = m.template
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  it('extracts the message templates of the simulation layer', () => {
    expect(templates.length).toBeGreaterThan(500)
    // spot checks: one per area
    const has = (re: RegExp) => templates.some((m) => re.test(m.template))
    expect(has(/^LED \u0001 burned out/)).toBe(true) // engine
    expect(has(/no firmware loaded — board simulated electrically only$/)).toBe(true) // mcu-board
    expect(has(/^PLL input \u0001 is outside 1–25 MHz/)).toBe(true) // RCC
    expect(has(/is not 5 V tolerant \(limit VDD \+ 0\.3 V/)).toBe(true) // ERC
    expect(has(/^"version" must be the number 1/)).toBe(true) // validator
  })

  it('every extracted message translates completely', () => {
    const bad: string[] = []
    for (const m of templates) {
      const u = untranslated(m.template)
      if (u) bad.push(`${m.file}:${m.line} [${u.left.join(', ')}]\n    EN ${u.msg}\n    ZH ${u.out}`)
    }
    // I18N_DUMP=<file>: write the list for review (the assertion message is truncated by the reporter)
    if (process.env.I18N_DUMP) writeFileSync(process.env.I18N_DUMP, bad.join('\n'))
    expect(bad, `${bad.length} messages are not (fully) translated:\n${bad.join('\n')}`).toEqual([])
  })
})
