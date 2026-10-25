/**
 * The Markdown subset lesson texts may use (LessonStep.body, wiring,
 * theory): paragraphs separated by blank lines, line breaks kept inside a
 * paragraph, "- " bullet lists, **bold** and `code`. Parsed into a tiny
 * AST that the UI renders as React elements — never as HTML, so lesson
 * text cannot inject markup. Anything else (headings, links, numbered
 * lists, HTML) stays literal text.
 */

export type MdInline = { kind: 'text'; text: string } | { kind: 'code'; text: string } | { kind: 'bold'; children: MdInline[] }

export type MdBlock =
  /** a paragraph: one inline run per source line */
  | { kind: 'p'; lines: MdInline[][] }
  /** a bullet list: one inline run per item */
  | { kind: 'ul'; items: MdInline[][] }

/** Inline spans of one line. */
export function parseInline(s: string): MdInline[] {
  const out: MdInline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ kind: 'text', text })
    text = ''
  }
  let i = 0
  while (i < s.length) {
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ kind: 'code', text: s.slice(i + 1, end) })
        i = end + 1
        continue
      }
    } else if (s.startsWith('**', i)) {
      // the closing ** must not sit inside a code span
      let j = i + 2
      let end = -1
      while (j < s.length) {
        if (s[j] === '`') {
          const close = s.indexOf('`', j + 1)
          j = close > j ? close + 1 : j + 1
          continue
        }
        if (s.startsWith('**', j)) {
          end = j
          break
        }
        j++
      }
      if (end > i + 2) {
        flush()
        out.push({ kind: 'bold', children: parseInline(s.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    text += s[i]
    i++
  }
  flush()
  return out
}

const BULLET = /^\s*[-•]\s+/

/** Blocks of a lesson text. */
export function parseMarkdown(src: string): MdBlock[] {
  const blocks: MdBlock[] = []
  const lines = (src ?? '').replace(/\r\n?/g, '\n').split('\n')
  let para: string[] = []
  let items: string[] | null = null
  const endPara = () => {
    if (para.length > 0) blocks.push({ kind: 'p', lines: para.map((l) => parseInline(l.trim())) })
    para = []
  }
  const endList = () => {
    if (items && items.length > 0) blocks.push({ kind: 'ul', items: items.map((l) => parseInline(l.trim())) })
    items = null
  }
  for (const line of lines) {
    if (line.trim() === '') {
      endPara()
      endList()
      continue
    }
    if (BULLET.test(line)) {
      endPara()
      if (!items) items = []
      items.push(line.replace(BULLET, ''))
      continue
    }
    if (items && /^\s+\S/.test(line)) {
      // indented continuation of the previous bullet
      items[items.length - 1] += ` ${line.trim()}`
      continue
    }
    endList()
    para.push(line)
  }
  endPara()
  endList()
  return blocks
}

/** The plain text of a lesson text (search, aria labels, clamped previews). */
export function markdownPlainText(src: string): string {
  const inline = (xs: MdInline[]): string => xs.map((x) => (x.kind === 'bold' ? inline(x.children) : x.text)).join('')
  return parseMarkdown(src)
    .map((b) => (b.kind === 'p' ? b.lines.map(inline).join(' ') : b.items.map((it) => `• ${inline(it)}`).join(' ')))
    .join(' ')
}
