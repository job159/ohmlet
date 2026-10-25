/**
 * Canonical term table (UX helper H9 — docs/ux/UX_VERIFY.md §5.4, SH-17):
 * the same thing has the same name everywhere. Scans every string literal
 * with Chinese text in the zh-TW dictionaries (src/i18n/zh-TW/*.ts: plain
 * dictionaries, part tables, runtime-message templates) and in the lesson
 * sources (src/lessons/**\/*.lesson.ts), parsed with the TypeScript compiler
 * (comments and data refs without Chinese are not text), and fails on:
 *
 *   佔空比                    → 工作週期
 *   在場景中標示               → 在電路板上標示／取消標示
 *   入門 (difficulty)          → 初級（／中級／進階）
 *   n 支引腳                  → n 腳
 *   a speed written 「0.5×」   → 「0.5 倍速」
 *   探針 (the probe)           → 探棒
 *   未載入韌體                 → 還沒有韌體
 *   正在執行 / 執行中 for a bound firmware → 已載入; 執行中 only for the run
 *     phase (「模擬執行中」, 「可在執行中調整」, 「執行中的韌體」, 「執行中可調」
 *     and the run-state labels in RUN_PHASE stay)
 *   raw refs in text: 3V3_1 / GND2, U1.REG / U1.PA5, PS1:+ / PS1:-
 *     (a ref inside "double quotes" is a syntax example and stays)
 *
 * ALLOW lists the occurrences that exist today, each with the workstream
 * and fix item that removes it (IS-17, IN-20, IN-21, LS-8, LS-13, SC-17,
 * SH-17). Each workstream deletes its own entries when it fixes them; an
 * entry that no longer matches anything fails the test (so it gets
 * deleted). ALLOW is now empty and must stay so. New text never gets an
 * entry — use the canonical term. Two permanent lists stay apart from it:
 * RUN_PHASE (the run-state labels) and GLOSSARY_ALIASES (a help entry that
 * names the other word on purpose, canonical term first).
 *
 * The DOM side of the raw-ref rule is scripts/i18n-audit.mjs (rawRefs).
 *
 * The verbs of the path (release QA SH-F10 (3)) — 執行模擬, 在邏輯分析儀中檢視,
 * 開啟範例, 在電路板上標示 — are VERB_RULES with their own shrinking
 * ALLOW_VERBS (today's variants in other workstreams' dictionaries).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '..')

type Owner = 'shell' | 'scene' | 'lessons' | 'inspector' | 'instruments'
type RuleId = 'duty' | 'mark-scene' | 'difficulty' | 'leads' | 'speed-x' | 'probe-tip' | 'no-firmware' | 'running' | 'raw-ref'

/** The raw-ref pattern of SH-17 (also used by the DOM audit). */
const RAW_REF = /\b(3V3|GND)_\d\b|\bU\d+\.(REG|P[A-E]\d+)\b|\b[A-Z]+\d+:[+-]/

const RULES: readonly { id: RuleId; use: string; test: (text: string) => boolean }[] = [
  { id: 'duty', use: '工作週期', test: (s) => s.includes('佔空比') },
  { id: 'mark-scene', use: '在電路板上標示／取消標示', test: (s) => s.includes('在場景中標示') },
  // 「輸入門檻」 contains 入門 too
  { id: 'difficulty', use: '初級', test: (s) => /(?<!輸)入門(?!檻)/.test(s) },
  { id: 'leads', use: 'n 腳', test: (s) => s.includes('支引腳') },
  // a number glued to × in a sentence about speed (「2×AA」, 「128×64」, 「3× USART」 are not speeds)
  { id: 'speed-x', use: 'n 倍速', test: (s) => /\d×(?!\s?\d)/.test(s) && /速|即時|真實時間|模擬/.test(s) },
  { id: 'probe-tip', use: '探棒', test: (s) => s.includes('探針') },
  { id: 'no-firmware', use: '還沒有韌體', test: (s) => s.includes('未載入韌體') },
  {
    id: 'running',
    use: '已載入 (firmware bound) — 執行中 only for the run phase',
    test: (s) => s.includes('正在執行') || /執行中(?![的可也為])/.test(s.replace(/(模擬|在)執行中/g, '')),
  },
  { id: 'raw-ref', use: 'pinLabel / terminalLabel / endpointName', test: (s) => RAW_REF.test(s.replace(/"[^"\n]*"/g, '')) },
]

interface Literal {
  /** repo-relative path */
  file: string
  /** dictionary key when the literal is a property value ('Running', 'tip|pin') */
  key?: string
  text: string
  line: number
}

interface Allowed {
  /** file name the entry is in (basename, e.g. 'lessons-ui.ts') */
  file: string
  rule: RuleId
  /** the dictionary key, or a substring of the literal */
  key?: string
  includes?: string
}

/** Run-phase statements that stay (permanent; not part of the shrinking ALLOW). */
const RUN_PHASE: readonly Allowed[] = [
  { file: 'chrome.ts', rule: 'running', key: 'Running' }, // the capsule's run state
  { file: 'embedded.ts', rule: 'running', key: 'Running|mcu-state' }, // the MCU badge's run state
  { file: 'embedded.ts', rule: 'running', key: 'Executing firmware' }, // that state's tooltip
]

/**
 * Glossary aliases (permanent): a help entry names the other word ON
 * PURPOSE, so a student who met it elsewhere finds the canonical term —
 * 「工作週期（又稱佔空比）」 (IN-20 (5)). Only the glossary may do this.
 */
const GLOSSARY_ALIASES: readonly Allowed[] = [
  { file: 'ux-inspector-2.ts', rule: 'duty', key: 'Duty cycle (also called duty ratio)' },
]

/** Everything that stays for good (never shrinks to nothing, unlike ALLOW). */
const PERMANENT: readonly Allowed[] = [...RUN_PHASE, ...GLOSSARY_ALIASES]

/** Today's occurrences, by owning workstream and fix item. Delete an entry when it is fixed. */
const ALLOW: Readonly<Record<Owner, readonly (Allowed & { item: string })[]>> = {
  shell: [],
  scene: [],
  lessons: [],
  inspector: [],
  instruments: [],
}

/**
 * The verbs of the one place → wire → run → observe path (release QA
 * SH-F10 (3) — p-02): one action, one verb, everywhere.
 *
 *   執行模擬            — the run control, never 「▶ 執行」 / 「「執行」」 alone
 *   在邏輯分析儀中檢視   — never 「在邏輯分析儀（中／上）顯示／查看」
 *   開啟範例            — never 「打開範例」 / 「載入範例」
 *   在電路板上標示       — never 「在麵包板上標示」 / 「標示在電路板上」
 *                         (「在場景中標示」 is the mark-scene rule above)
 */
type VerbId = 'run-sim' | 'view-la' | 'open-example' | 'mark-board'

const VERB_RULES: readonly { id: VerbId; use: string; test: (text: string) => boolean }[] = [
  { id: 'run-sim', use: '執行模擬', test: (s) => /▶ ?執行(?!模擬)|「執行」/.test(s) },
  { id: 'view-la', use: '在邏輯分析儀中檢視', test: (s) => /在邏輯分析儀(?:中|裡|上)?(?:顯示|查看|觀看)/.test(s) },
  { id: 'open-example', use: '開啟範例', test: (s) => /(?:打開|載入)(?:現成的|這個|一個)?範例/.test(s) },
  {
    id: 'mark-board',
    use: '在電路板上標示',
    test: (s) => /在(?:麵包板|板子|板|3D ?畫面|畫面)上標示|標示在(?:電路板|麵包板)上/.test(s),
  },
]

interface AllowedVerb {
  file: string
  rule: VerbId
  key: string
  item: string
}

/**
 * Today's variants of the verbs, by owner and fix item — the same shrinking
 * convention as ALLOW (delete yours when fixed; a stale entry fails). Shell
 * has none of its own: the pill's 「執行」 became 「執行模擬」 and the 更多
 * sheet says 「開啟範例」 (SH-F10).
 */
const ALLOW_VERBS: Readonly<Record<Owner, readonly AllowedVerb[]>> = {
  shell: [],
  scene: [],
  lessons: [],
  inspector: [],
  instruments: [],
}

// ---------------------------------------------------------------------------
// scanning
// ---------------------------------------------------------------------------

const CJK = /[㐀-鿿]/

function filesIn(relDir: string, match: RegExp): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(ROOT, rel))) {
      const child = `${rel}/${name}`
      if (statSync(path.join(ROOT, child)).isDirectory()) walk(child)
      else if (match.test(name)) out.push(child)
    }
  }
  walk(relDir)
  return out.sort()
}

/** The text of a property name ('Running', "tip|pin"). */
function nameText(n: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isNumericLiteral(n)) return n.text
  return undefined
}

/** Every string / template literal of a source file (template holes read as 「{…}」). */
function literalsOf(rel: string): Literal[] {
  const src = ts.createSourceFile(rel, readFileSync(path.join(ROOT, rel), 'utf8'), ts.ScriptTarget.Latest, true)
  const out: Literal[] = []
  const add = (node: ts.Node, text: string) => {
    const parent = node.parent
    let key: string | undefined
    if (parent && ts.isPropertyAssignment(parent)) {
      if (parent.name === node) return // a key, not text
      key = nameText(parent.name)
    }
    if (parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent))) return
    out.push({ file: rel, key, text, line: src.getLineAndCharacterOfPosition(node.getStart()).line + 1 })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text)
    else if (ts.isTemplateExpression(node)) {
      add(node, node.head.text + node.templateSpans.map((s) => `{…}${s.literal.text}`).join(''))
      // the expressions inside the holes may hold literals of their own
      for (const s of node.templateSpans) visit(s.expression)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
  return out
}

interface Violation extends Literal {
  rule: RuleId
}

interface VerbViolation extends Literal {
  rule: VerbId
}

function scan(): { literals: number; violations: Violation[]; verbs: VerbViolation[] } {
  const files = [...filesIn('src/i18n/zh-TW', /\.ts$/), ...filesIn('src/lessons', /\.lesson\.ts$/)]
  let literals = 0
  const violations: Violation[] = []
  const verbs: VerbViolation[] = []
  for (const f of files) {
    for (const lit of literalsOf(f)) {
      if (!CJK.test(lit.text)) continue
      literals++
      for (const r of RULES) if (r.test(lit.text)) violations.push({ ...lit, rule: r.id })
      for (const r of VERB_RULES) if (r.test(lit.text)) verbs.push({ ...lit, rule: r.id })
    }
  }
  return { literals, violations, verbs }
}

function coversVerb(a: AllowedVerb, v: VerbViolation): boolean {
  return path.basename(v.file) === a.file && a.rule === v.rule && v.key === a.key
}

const whereVerb = (v: VerbViolation) =>
  `${v.file}:${v.line} [${v.rule} → ${VERB_RULES.find((r) => r.id === v.rule)?.use}] ${v.key ? `${JSON.stringify(v.key)}: ` : ''}${v.text.slice(0, 90)}`

function covers(a: Allowed, v: Violation): boolean {
  if (path.basename(v.file) !== a.file || a.rule !== v.rule) return false
  if (a.key !== undefined) return v.key === a.key
  return a.includes !== undefined && v.text.includes(a.includes)
}

const where = (v: Violation) => `${v.file}:${v.line} [${v.rule} → ${RULES.find((r) => r.id === v.rule)?.use}] ${v.key ? `${JSON.stringify(v.key)}: ` : ''}${v.text.slice(0, 90)}`

describe('UX H9 canonical terms (UX_VERIFY.md §5.4)', () => {
  const { literals, violations, verbs } = scan()
  const allowed = Object.entries(ALLOW).flatMap(([owner, list]) => list.map((a) => ({ ...a, owner: owner as Owner })))

  it('reads the dictionaries and the lessons (sanity)', () => {
    expect(literals).toBeGreaterThan(3000)
  })

  it('no non-canonical term outside the allow-list', () => {
    const bad = violations.filter((v) => !PERMANENT.some((a) => covers(a, v)) && !allowed.some((a) => covers(a, v)))
    expect(bad.map(where)).toEqual([])
  })

  it('every allow-list entry still matches (delete the entries you fixed)', () => {
    const stale = allowed.filter((a) => !violations.some((v) => covers(a, v)))
    expect(stale.map((a) => `${a.owner} ${a.item}: ${a.file} ${a.rule} ${a.key ?? a.includes}`)).toEqual([])
  })

  it('the allow-list is empty: every workstream fixed its own terms (SH-17 acceptance)', () => {
    expect(allowed.map((a) => `${a.owner} ${a.item}`)).toEqual([])
  })

  it('every glossary alias still exists and names the canonical term first', () => {
    const lits = GLOSSARY_ALIASES.map((a) => violations.find((v) => covers(a, v)))
    expect(lits.every(Boolean)).toBe(true)
    for (const [i, v] of lits.entries()) {
      const canonical = RULES.find((r) => r.id === GLOSSARY_ALIASES[i].rule)!.use
      expect(v!.text.startsWith(canonical)).toBe(true)
    }
  })

  describe('the verbs of the path (release QA SH-F10 (3))', () => {
    const allowedVerbs = Object.entries(ALLOW_VERBS).flatMap(([owner, list]) => list.map((a) => ({ ...a, owner: owner as Owner })))

    it('no other verb for running, viewing in the analyzer, opening an example or marking on the board', () => {
      const bad = verbs.filter((v) => !allowedVerbs.some((a) => coversVerb(a, v)))
      expect(bad.map(whereVerb)).toEqual([])
    })

    it('every verb allow-list entry still matches (delete the entries you fixed)', () => {
      const stale = allowedVerbs.filter((a) => !verbs.some((v) => coversVerb(a, v)))
      expect(stale.map((a) => `${a.owner} ${a.item}: ${a.file} ${a.rule} ${a.key}`)).toEqual([])
    })

    it('the shell itself uses only the canonical verbs', () => {
      expect(ALLOW_VERBS.shell).toEqual([])
      expect(verbs.filter((v) => /\/(ux|qa)-shell\.ts$/.test(v.file)).map(whereVerb)).toEqual([])
    })

    it('the canonical verbs exist where the shell shows them', () => {
      const has = (text: string) => literalsOf('src/i18n/zh-TW/chrome.ts').concat(literalsOf('src/i18n/zh-TW/ux-shell.ts'), literalsOf('src/i18n/zh-TW/ux-contracts.ts'), literalsOf('src/i18n/zh-TW/examples.ts')).some((l) => l.text === text)
      expect(has('執行模擬')).toBe(true)
      expect(has('開啟範例')).toBe(true)
      expect(has('在電路板上標示')).toBe(true)
      expect(literalsOf('src/i18n/zh-TW/ux-instruments.ts').some((l) => l.text === '在邏輯分析儀中檢視')).toBe(true)
    })

    it('the verb rules: canonical text passes, the variants fail', () => {
      const hit = (id: VerbId, s: string) => VERB_RULES.find((r) => r.id === id)!.test(s)
      expect(hit('run-sim', '按「▶ 執行模擬」（空白鍵）')).toBe(false)
      expect(hit('run-sim', '電路已就緒（空白鍵）')).toBe(false)
      expect(hit('run-sim', '按「▶ 執行」開始模擬')).toBe(true)
      expect(hit('run-sim', '請按「執行」')).toBe(true)
      expect(hit('view-la', '在邏輯分析儀中檢視')).toBe(false)
      expect(hit('view-la', '在邏輯分析儀中顯示（PA5）')).toBe(true)
      expect(hit('view-la', '在邏輯分析儀上顯示最近一筆 UART 幀')).toBe(true)
      expect(hit('view-la', '已加入邏輯分析儀：PA5——到「儀器」查看')).toBe(false)
      expect(hit('open-example', '開啟範例會取代目前的電路')).toBe(false)
      expect(hit('open-example', '載入範例會取代目前的電路')).toBe(true)
      expect(hit('open-example', '或打開現成的範例')).toBe(true)
      expect(hit('mark-board', '在電路板上標示「U1」')).toBe(false)
      expect(hit('mark-board', '在麵包板上標示')).toBe(true)
    })
  })

  it('the rules themselves: canonical text passes, the listed variants fail', () => {
    const hit = (id: RuleId, s: string) => RULES.find((r) => r.id === id)!.test(s)
    expect(hit('duty', '工作週期 50.0 %')).toBe(false)
    expect(hit('duty', '佔空比 50 %')).toBe(true)
    expect(hit('difficulty', '用輸入門檻判斷')).toBe(false)
    expect(hit('difficulty', '入門')).toBe(true)
    expect(hit('speed-x', '0.2 倍速')).toBe(false)
    expect(hit('speed-x', '2×AA 電池盒')).toBe(false)
    expect(hit('speed-x', '0.5× 表示模擬 1 秒要花真實的 2 秒')).toBe(true)
    expect(hit('running', '模擬執行中也可調整')).toBe(false)
    expect(hit('running', '執行中的韌體把 PA0 設為輸入')).toBe(false)
    expect(hit('running', '搖桿位置與按鈕可在執行中調整')).toBe(false)
    expect(hit('running', 'U1 正在執行 hal-blink')).toBe(true)
    expect(hit('running', '執行中')).toBe(true)
    expect(hit('raw-ref', '（如 "PS1:+"）')).toBe(false)
    expect(hit('raw-ref', 'U1 的 3V3_1 腳')).toBe(true)
    expect(hit('raw-ref', 'U1.REG 過熱')).toBe(true)
    expect(hit('raw-ref', '`PS1:-` 接 `top-0`')).toBe(true)
    expect(hit('raw-ref', 'PS1 正端接 top+0')).toBe(false)
  })

  it('the bare 週期 is never a count label (QA clarity MCU-CYCLES): 週期 is a period, the CPU count is 時脈週期數', () => {
    // an entry whose English source counts cycles ("Cycles", "cycle count", "… cycles …") must not label
    // it 週期 alone: 「週期 112 163 290」 in the MCU panel beside the scope's 「週期 1.000 ms」 reads as one quantity
    const counts = (key: string) => /\bcycles\b|\bcycle count\b/i.test(key.replace(/\|[a-z0-9-]+$/, ''))
    const bareLabel = (s: string) => /^週期(?:$|[（( ：:])/.test(s)
    const lits = filesIn('src/i18n/zh-TW', /\.ts$/)
      .flatMap(literalsOf)
      .filter((l) => l.key !== undefined)
    const bad = lits.filter((l) => counts(l.key!) && bareLabel(l.text))
    expect(bad.map((l) => `${l.file}:${l.line} ${JSON.stringify(l.key)}: ${l.text.slice(0, 60)}`)).toEqual([])
    // the MCU panel's readout and its glossary entry
    const byKey = (k: string) => lits.find((l) => l.key === k)?.text
    expect(byKey('Cycles')).toBe('時脈週期數')
    expect(byKey('Cycles (CPU clock cycles)')).toBe('時脈週期數（CPU 時脈週期）')
    // a period keeps its word (the scope / analyzer measurement, the glossary entry)
    expect(byKey('T|meas')).toBe('週期')
    expect(byKey('Period|glossary')).toBe('週期')
    // the rule itself
    expect(bareLabel('週期')).toBe(true)
    expect(bareLabel('週期（CPU 時脈週期數）')).toBe(true)
    expect(bareLabel('時脈週期數')).toBe(false)
    expect(bareLabel('週期訊號 {f} · {duty}')).toBe(false)
    expect(counts('Cycles')).toBe(true)
    expect(counts('Duty cycle')).toBe(false)
  })
})
