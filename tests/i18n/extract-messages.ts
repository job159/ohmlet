/**
 * Static extraction of the English runtime messages the simulation layer can
 * show the user (tests/i18n/messages-static.test.ts).
 *
 * Scans the sources for message-producing calls — addIssue / reportIssue /
 * issue( / log( / once( / pushLog( / warnOnce( / onIssue( / report( /
 * warnings.push / errors.push / issues.push / throw new Error / new Error —
 * plus `message:` / `reason:` / `notes:` / `detail:` properties and
 * MSG_* / *_NOTES / *_SUPPORT constants, and returns every string or
 * template literal among their arguments as a TEMPLATE: the literal text
 * with each `${…}` placeholder (and each `+ expr +` concatenation part)
 * replaced by PLACEHOLDER. Ternaries yield both branches.
 *
 * Deliberately a small hand-written scanner (no TypeScript AST dependency):
 * it understands string / template / regex-free code well enough for these
 * call sites, and a literal it cannot attribute is simply not extracted —
 * the dynamic test (messages-dynamic.test.ts) covers what runs.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export const PLACEHOLDER = '\u0001'

export interface ExtractedMessage {
  /** template text, placeholders = PLACEHOLDER */
  template: string
  file: string
  line: number
  /** the call / property that produced it */
  via: string
}

/** message-producing calls: addIssue, reportIssue, issue, log, logOnce, pushLog, once, warnOnce, onIssue, report, fail, … */
const CALL_NAMES = String.raw`\w*[lL]og\w*|\w*[iI]ssue\w*|once|warn\w*|report\w*|fail\w*|hint\w*|note|finding\w*|reject\w*|problem\w*|error|warning|info|emit`
const CALL_RE = new RegExp(
  String.raw`(?:(?<![\w.]console\.|\bMath\.|\bconsole\.)\b(?:${CALL_NAMES})\s*\??\.?\(|\b(?:warnings|errors|issues|notes|problems|findings|out|lines|msgs|messages)\.push\s*\(|\bnew\s+(?:Range|Type)?Error\s*\(|\bnew\s+BusFault\s*\()`,
  'g',
)
const PROP_RE = /\b(message|reason|notes|detail|hint|summary|why|fix|error|errors|warnings)\s*:\s*(?=['"`[])/g
const ASSIGN_RE = /\b(?:message|msg|text)\s*=(?!=)\s*/g
const CONST_RE = /\bconst\s+(MSG_\w+|\w+_MSG|\w*NOTES\w*|\w*_SUPPORT\w*|\w*_HINT\w*)\s*(?::[^=]+)?=\s*/g

/** Read a string / template literal starting at `i` (quote char at i). Returns [template, end]. */
function readLiteral(src: string, i: number): [string, number] {
  const q = src[i]
  let out = ''
  let j = i + 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') {
      const n = src[j + 1]
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'u' && src[j + 2] === '{' ? decodeBraceEscape(src, j) : n === 'u' ? String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)) : n
      j += n === 'u' ? (src[j + 2] === '{' ? src.indexOf('}', j) - j + 1 : 6) : 2
      continue
    }
    if (c === q) return [out, j + 1]
    if (q === '`' && c === '$' && src[j + 1] === '{') {
      j = skipBraces(src, j + 1)
      out += PLACEHOLDER
      continue
    }
    out += c
    j++
  }
  return [out, j]
}

function decodeBraceEscape(src: string, j: number): string {
  const end = src.indexOf('}', j)
  return String.fromCodePoint(parseInt(src.slice(j + 3, end), 16))
}

/** `i` at '{'; returns the index after the matching '}' (skips nested strings). */
function skipBraces(src: string, i: number): number {
  let depth = 0
  let j = i
  while (j < src.length) {
    const c = src[j]
    if (c === "'" || c === '"' || c === '`') {
      j = readLiteral(src, j)[1]
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return j + 1
    }
    j++
  }
  return j
}

/** Split the argument list starting after '(' at `i`; returns raw top-level args and the end index. */
function readArgs(src: string, i: number, close = ')'): [string[], number] {
  const args: string[] = []
  let depth = 0
  let start = i
  let j = i
  while (j < src.length) {
    const c = src[j]
    if (c === "'" || c === '"' || c === '`') {
      j = readLiteral(src, j)[1]
      continue
    }
    if (c === '/' && src[j + 1] === '/') {
      j = src.indexOf('\n', j)
      if (j < 0) j = src.length
      continue
    }
    if (c === '/' && src[j + 1] === '*') {
      j = src.indexOf('*/', j) + 2
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0 && c === close) {
        args.push(src.slice(start, j))
        return [args, j + 1]
      }
      depth--
    } else if (c === ',' && depth === 0) {
      args.push(src.slice(start, j))
      start = j + 1
    }
    j++
  }
  return [args, j]
}

const MAX_VARIANTS = 64

function product(a: string[], b: string[]): string[] {
  const out: string[] = []
  for (const x of a) {
    for (const y of b) {
      out.push(x + y)
      if (out.length >= MAX_VARIANTS) return out
    }
  }
  return out
}

/**
 * The texts a template literal can produce: every ${expr} placeholder
 * expands into the literal variants of \`expr\` (ternaries of strings, nested
 * templates), anything else into PLACEHOLDER.
 */
function readLiteralVariants(src: string, i: number): [string[], number] {
  const q = src[i]
  if (q !== '\`') {
    const [lit, end] = readLiteral(src, i)
    return [[lit], end]
  }
  let acc = ['']
  let text = ''
  let j = i + 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') {
      // decode one escape through the plain reader (same rules)
      const n = src[j + 1]
      const len = n === 'u' ? (src[j + 2] === '{' ? src.indexOf('}', j) - j + 1 : 6) : 2
      text += readLiteral("'" + src.slice(j, j + len) + "'", 0)[0]
      j += len
      continue
    }
    if (c === '\`') return [product(acc, [text]), j + 1]
    if (c === '$' && src[j + 1] === '{') {
      const close = skipBraces(src, j + 1)
      acc = product(product(acc, [text]), exprVariants(src.slice(j + 2, close - 1)))
      text = ''
      j = close
      continue
    }
    text += c
    j++
  }
  return [product(acc, [text]), j]
}

/** Variants of an expression inside ${…} / a concatenation: its literal texts, else one PLACEHOLDER. */
function exprVariants(expr: string): string[] {
  const v = templatesOf(expr, true)
  return v.length ? v : [PLACEHOLDER]
}

function stripParens(e: string): string {
  let s = e.trim()
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0
    let wraps = true
    for (let j = 0; j < s.length; j++) {
      const c = s[j]
      if (c === "'" || c === '"' || c === '\`') {
        j = readLiteral(s, j)[1] - 1
        continue
      }
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth === 0 && j < s.length - 1) {
          wraps = false
          break
        }
      }
    }
    if (!wraps) break
    s = s.slice(1, -1).trim()
  }
  return s
}

/** Top-level \`cond ? a : b\` (nested ternaries in \`b\` allowed) → [cond, a, b]. */
function splitTernary(e: string): [string, string, string] | null {
  let depth = 0
  let q = -1
  let nested = 0
  for (let j = 0; j < e.length; j++) {
    const c = e[j]
    if (c === "'" || c === '"' || c === '\`') {
      j = readLiteral(e, j)[1] - 1
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && c === '?' && e[j + 1] !== '.' && e[j + 1] !== '?' && e[j - 1] !== '?') {
      if (q < 0) q = j
      else nested++
    } else if (depth === 0 && c === ':' && q >= 0) {
      if (nested > 0) nested--
      else return [e.slice(0, q), e.slice(q + 1, j), e.slice(j + 1)]
    }
  }
  return null
}

/**
 * Templates an argument expression can evaluate to: literals joined by \`+\`
 * with expressions as placeholders; \`a ? 'x' : 'y'\` → both branches.
 * \`keepNonLiteral\`: a non-literal ternary branch yields PLACEHOLDER instead of nothing.
 */
function templatesOf(expr: string, keepNonLiteral = false): string[] {
  const e = stripParens(expr)
  if (!e) return []
  const tern = splitTernary(e)
  if (tern) {
    const branch = (b: string) => (keepNonLiteral ? exprVariants(b) : templatesOf(b))
    return [...branch(tern[1]), ...branch(tern[2])].slice(0, MAX_VARIANTS)
  }
  // \`x ?? 'literal'\` / \`x || 'literal'\`: the literal alternative
  for (const op of ['??', '||']) {
    const parts = splitTopLevelOp(e, op)
    if (parts.length > 1) return parts.flatMap((x) => templatesOf(x, keepNonLiteral)).slice(0, MAX_VARIANTS)
  }
  const parts = splitTopLevel(e, '+')
  let acc = ['']
  let hasLiteral = false
  for (const p of parts) {
    const s = p.trim()
    if (/^['"\`]/.test(s)) {
      const [lits, end] = readLiteralVariants(s, 0)
      if (end === s.length) {
        acc = product(acc, lits)
        hasLiteral = true
        continue
      }
    }
    if (/^\(.*\)$/s.test(s)) {
      const inner = templatesOf(s.slice(1, -1), true)
      if (inner.some((x) => x !== PLACEHOLDER)) {
        acc = product(acc, inner)
        hasLiteral = true
        continue
      }
    }
    acc = product(acc, [PLACEHOLDER])
  }
  return hasLiteral ? acc : []
}

/** The expression starting at \`i\` up to the end of its statement (no semicolons in this code base). */
function readExpr(src: string, i: number): string {
  let depth = 0
  let j = i
  while (j < src.length) {
    const c = src[j]
    if (c === "'" || c === '"' || c === '\`') {
      j = readLiteral(src, j)[1]
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break
      depth--
    } else if (depth === 0 && (c === '\n' || c === ';' || c === ',')) {
      if (c !== '\n') break
      const before = src.slice(i, j).trimEnd()
      const after = src.slice(j).trimStart()
      if (!/[-+?:|&=(,]$/.test(before) && !/^(?:[-+?:.|&]|\?\?)/.test(after)) break
    }
    j++
  }
  return src.slice(i, j)
}

function splitTopLevel(e: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let j = 0; j < e.length; j++) {
    const c = e[j]
    if (c === "'" || c === '"' || c === '`') {
      j = readLiteral(e, j)[1] - 1
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && c === sep) {
      // skip ?. ?? and => / >= etc.
      if (sep === '?' && (e[j + 1] === '.' || e[j + 1] === '?' || e[j - 1] === '?')) continue
      if (sep === ':' && false) continue
      out.push(e.slice(start, j))
      start = j + 1
    }
  }
  out.push(e.slice(start))
  return out
}

function splitTopLevelOp(e: string, op: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let j = 0; j < e.length; j++) {
    const c = e[j]
    if (c === "'" || c === '"' || c === '`') {
      j = readLiteral(e, j)[1] - 1
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && e.startsWith(op, j)) {
      out.push(e.slice(start, j))
      start = j + op.length
      j += op.length - 1
    }
  }
  out.push(e.slice(start))
  return out
}

/** A template that reads like a sentence shown to a person (not a key / level / id). */
export function looksLikeMessage(template: string): boolean {
  const text = template.split(PLACEHOLDER).join(' ')
  if (!/[A-Za-z]{3}/.test(text)) return false
  if (!/\s/.test(template.trim())) return false // keys ('load', 'mcu:…:error'), levels, ids
  return true
}

function lineOf(src: string, i: number): number {
  let n = 1
  for (let j = 0; j < i; j++) if (src.charCodeAt(j) === 10) n++
  return n
}

/** Blank out comments so commented-out code / doc prose is not extracted. */
function stripComments(src: string): string {
  let out = ''
  let j = 0
  while (j < src.length) {
    const c = src[j]
    if (c === "'" || c === '"' || c === '`') {
      const end = readLiteral(src, j)[1]
      out += src.slice(j, end)
      j = end
      continue
    }
    if (c === '/' && src[j + 1] === '/') {
      const end = src.indexOf('\n', j)
      const stop = end < 0 ? src.length : end
      out += ' '.repeat(stop - j)
      j = stop
      continue
    }
    if (c === '/' && src[j + 1] === '*') {
      const end = src.indexOf('*/', j + 2)
      const stop = end < 0 ? src.length : end + 2
      out += src.slice(j, stop).replace(/[^\n]/g, ' ')
      j = stop
      continue
    }
    // regex literal after an operator / paren: skip it (contains quotes sometimes)
    if (c === '/' && /[=(,:!&|?;{}\[]\s*$/.test(out.slice(-3))) {
      let k = j + 1
      let inClass = false
      while (k < src.length && src[k] !== '\n') {
        if (src[k] === '\\') {
          k += 2
          continue
        }
        if (src[k] === '[') inClass = true
        else if (src[k] === ']') inClass = false
        else if (src[k] === '/' && !inClass) break
        k++
      }
      if (src[k] === '/') {
        out += ' '.repeat(k + 1 - j)
        j = k + 1
        continue
      }
    }
    out += c
    j++
  }
  return out
}

export function extractFromSource(src0: string, file: string): ExtractedMessage[] {
  const src = stripComments(src0)
  const out: ExtractedMessage[] = []
  const add = (templates: string[], at: number, via: string) => {
    for (const template of templates) if (looksLikeMessage(template)) out.push({ template, file, line: lineOf(src, at), via })
  }
  for (const m of src.matchAll(CALL_RE)) {
    const open = (m.index ?? 0) + m[0].length
    const [args] = readArgs(src, open)
    add(args.flatMap((x) => templatesOf(x)), m.index ?? 0, m[0].replace(/\s+/g, ''))
  }
  for (const m of src.matchAll(PROP_RE)) {
    const at = (m.index ?? 0) + m[0].length
    if (src[at] === '[') {
      // errors: ['…', `…`]
      const [items] = readArgs(src, at + 1, ']')
      add(items.flatMap((x) => templatesOf(x)), m.index ?? 0, `${m[1]}:`)
      continue
    }
    const [args] = readArgs(src, at, '}')
    // the property value is the first top-level "arg" (up to , or })
    add(templatesOf(args[0] ?? ''), m.index ?? 0, `${m[1]}:`)
  }
  for (const m of src.matchAll(ASSIGN_RE)) {
    const at = (m.index ?? 0) + m[0].length
    add(templatesOf(readExpr(src, at)), m.index ?? 0, 'message =')
  }
  for (const m of src.matchAll(CONST_RE)) {
    const at = (m.index ?? 0) + m[0].length
    const c = src[at]
    if (c === '[' || c === '{') {
      const [items] = readArgs(src, at + 1, c === '[' ? ']' : '}')
      for (const it of items) {
        // object entries: take the value after the first top-level ':'
        const kv = c === '{' ? splitTopLevel(it, ':').slice(1).join(':') : it
        add(templatesOf(kv), at, m[1])
      }
    } else if (c === "'" || c === '"' || c === '`') {
      // one literal, possibly continued with `+ …` on the following lines
      let end = readLiteral(src, at)[1]
      while (/^\s*\+\s*['"`]/.test(src.slice(end, end + 200))) {
        const q = src.indexOf(src.slice(end).match(/['"`]/)?.[0] ?? "'", end)
        end = readLiteral(src, q)[1]
      }
      add(templatesOf(src.slice(at, end)), at, m[1])
    }
  }
  return out
}

export function walk(dir: string, filter: (f: string) => boolean): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p, filter))
    else if (filter(p)) out.push(p)
  }
  return out.sort()
}

export function extractFiles(root: string, files: string[]): ExtractedMessage[] {
  return files.flatMap((f) => extractFromSource(readFileSync(f, 'utf8'), path.relative(root, f).replace(/\\/g, '/')))
}
