/**
 * The documentation's links work: every relative link and image in the
 * project docs (README.md, README.en.md, ARCHITECTURE.md, CHANGELOG.md and
 * the docs/ pages owned with them) points at a file that exists, every
 * `#anchor` names a heading of its target (GitHub's heading slugs), every
 * screenshot under docs/images is referenced and stays ≤ 300 KB.
 *
 * Links INTO docs/ux and docs/acceptance are checked too (those pages are
 * maintained elsewhere, so they are targets, not sources here).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '..')

/** The docs whose links this test owns (repo-relative). */
const DOC_FILES = [
  'README.md',
  'README.en.md',
  'ARCHITECTURE.md',
  'CHANGELOG.md',
  'docs/user-guide.md',
  'docs/firmware-guide.md',
  'docs/developer-guide.md',
  'docs/support-matrix.md',
  'docs/third-party-notices.md',
]

const IMAGES_DIR = 'docs/images'
const MAX_IMAGE_BYTES = 300 * 1024

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
}

/** The text with fenced code blocks blanked (line numbers kept). */
function withoutFences(text: string): string {
  let inFence = false
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence
        return ''
      }
      return inFence ? '' : line
    })
    .join('\n')
}

/** GitHub's heading slug (github-slugger): lower case, punctuation and symbols dropped, spaces → '-'. */
function githubSlug(heading: string): string {
  const text = heading
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/<[^>]+>/g, '') // inline HTML
    .replace(/[`*]/g, '') // code / emphasis markers
    .trim()
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

/** Every heading anchor of a markdown file (duplicates get -1, -2 … like GitHub). */
function anchorsOf(markdown: string): Set<string> {
  const seen = new Map<string, number>()
  const out = new Set<string>()
  for (const line of withoutFences(markdown).split('\n')) {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (!m) continue
    const base = githubSlug(m[2])
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    out.add(n === 0 ? base : `${base}-${n}`)
  }
  return out
}

interface Link {
  file: string
  line: number
  target: string
  image: boolean
}

/** Markdown links and images outside code (fenced blocks and inline code spans). */
function linksOf(file: string, markdown: string): Link[] {
  const out: Link[] = []
  withoutFences(markdown)
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.replace(/`[^`]*`/g, '``')
      for (const m of line.matchAll(/(!?)\[(?:[^\]\\]|\\.)*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        out.push({ file, line: i + 1, target: m[2], image: m[1] === '!' })
      }
      // HTML <img src="…">
      for (const m of line.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)) out.push({ file, line: i + 1, target: m[1], image: true })
    })
  return out
}

const isExternal = (t: string) => /^(https?:|mailto:)/i.test(t)

const anchorCache = new Map<string, Set<string>>()
function anchorsOfFile(abs: string): Set<string> {
  let a = anchorCache.get(abs)
  if (!a) {
    a = anchorsOf(readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'))
    anchorCache.set(abs, a)
  }
  return a
}

describe('docs: links, anchors and images', () => {
  it('every doc this test owns exists', () => {
    for (const f of DOC_FILES) expect(existsSync(path.join(ROOT, f)), f).toBe(true)
  })

  it('relative links and images point at existing files, anchors at existing headings', () => {
    const problems: string[] = []
    for (const file of DOC_FILES) {
      const text = read(file)
      for (const link of linksOf(file, text)) {
        if (isExternal(link.target)) continue
        const [rawPath, rawAnchor] = link.target.split('#') as [string, string | undefined]
        const where = `${link.file}:${link.line} → ${link.target}`
        const decodedPath = decodeURIComponent(rawPath)
        const abs = decodedPath === '' ? path.join(ROOT, file) : path.resolve(path.dirname(path.join(ROOT, file)), decodedPath)
        if (!abs.startsWith(ROOT)) {
          problems.push(`${where}: leaves the repository`)
          continue
        }
        if (!existsSync(abs)) {
          problems.push(`${where}: no such file`)
          continue
        }
        if (rawAnchor !== undefined && /\.md$/i.test(abs)) {
          const anchor = decodeURIComponent(rawAnchor)
          if (!anchorsOfFile(abs).has(anchor)) problems.push(`${where}: no heading with the anchor #${anchor}`)
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it(`every screenshot in ${IMAGES_DIR} is referenced and at most 300 KB`, () => {
    const dir = path.join(ROOT, IMAGES_DIR)
    const files = readdirSync(dir).filter((f) => /\.(png|jpe?g|gif|webp|svg)$/i.test(f))
    expect(files.length).toBeGreaterThan(0)
    const referenced = new Set<string>()
    for (const file of DOC_FILES) {
      for (const link of linksOf(file, read(file))) {
        if (!link.image || isExternal(link.target)) continue
        referenced.add(path.resolve(path.dirname(path.join(ROOT, file)), decodeURIComponent(link.target.split('#')[0])))
      }
    }
    for (const f of files) {
      const abs = path.join(dir, f)
      expect(statSync(abs).size, `${IMAGES_DIR}/${f} is larger than 300 KB`).toBeLessThanOrEqual(MAX_IMAGE_BYTES)
      expect(referenced.has(abs), `${IMAGES_DIR}/${f} is not used by any doc`).toBe(true)
    }
  })

  it('the slugger follows GitHub for the headings these docs use', () => {
    expect(githubSlug('13. 持續整合（CI）')).toBe('13-持續整合ci')
    expect(githubSlug('微控制器周邊：`stm32f103c8`')).toBe('微控制器周邊stm32f103c8')
    expect(githubSlug('16. 從腳位、孔位、導線直接量測')).toBe('16-從腳位孔位導線直接量測')
    expect(githubSlug('9.1 周邊分頁')).toBe('91-周邊分頁')
    expect(githubSlug('The expect contract')).toBe('the-expect-contract')
    expect(githubSlug('10. `checks` 行為契約')).toBe('10-checks-行為契約')
  })
})
