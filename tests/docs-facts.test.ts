/**
 * The figures the docs quote are the code's figures: part counts and support
 * levels, lessons per level and their runnable status, examples (and how
 * many carry firmware), ERC rules, MCU peripheral blocks and the verified
 * ones, firmware projects and bundled images. A new part, lesson, example or
 * firmware project therefore comes with the README sentence that counts it.
 *
 * Also: every `npm run <script>` the docs or the CI workflow mention exists
 * in package.json, and the CI workflow keeps its documented matrix.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CATALOG, supportOf } from '../src/model/catalog'
import '../src/mcu/all'
import { createMcu } from '../src/mcu/registry'
import { LESSONS } from '../src/lessons/index'
import { ERC_RULES } from '../src/sim/erc/api'
import { LIBRARY } from '../src/ui/workspace/examples'
import { bundledFirmwareNames } from '../src/firmware-assets'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

function facts() {
  const parts = Object.values(CATALOG)
  const level = (l: string) => parts.filter((e) => supportOf(e).level === l).length
  const lessons = (lv: string) => LESSONS.filter((l) => l.level === lv).length
  const mcu = createMcu('stm32f103c8')!
  const manifest = JSON.parse(read('firmware/dist/manifest.json')) as Record<string, unknown>
  return {
    parts: parts.length,
    full: level('full'),
    partial: level('partial'),
    visual: level('visual'),
    lessons: LESSONS.length,
    beginner: lessons('beginner'),
    intermediate: lessons('intermediate'),
    advanced: lessons('advanced'),
    ready: LESSONS.filter((l) => l.runnable === 'ready').length,
    partialLessons: LESSONS.filter((l) => l.runnable === 'partial').length,
    examples: LIBRARY.length,
    withFirmware: LIBRARY.filter((e) => e.firmware).length,
    rules: ERC_RULES.length,
    blocks: mcu.support.length,
    verified: mcu.support.filter((p) => p.status === 'verified').map((p) => p.name),
    unsupported: mcu.support.filter((p) => p.status === 'unsupported').map((p) => p.name),
    projects: Object.keys(manifest).length,
    images: bundledFirmwareNames().length,
  }
}

describe('docs: quoted figures match the code', () => {
  const f = facts()

  it('README.md (zh-TW)', () => {
    const t = read('README.md')
    const want = [
      `**${f.parts} 種元件。**`,
      `完整模擬 ${f.full}、部分模擬 ${f.partial}、僅視覺接線 ${f.visual}`,
      `${f.rules} 條規則`,
      `${f.lessons} 堂引導式課程（初級 ${f.beginner}、中級 ${f.intermediate}、進階 ${f.advanced}）`,
      `${f.examples} 個開啟即可執行的範例（其中 ${f.withFirmware} 個內含韌體）`,
      `${f.images} 個韌體映像檔（${f.projects} 個韌體專案`,
      `共 ${f.blocks} 個區塊`,
      `| ${f.verified.join('、')} |`,
      `目前 ${f.ready} 堂可執行、${f.partialLessons} 堂部分模擬`,
    ]
    for (const w of want) expect(t, `README.md should say 「${w}」`).toContain(w)
  })

  it('README.en.md', () => {
    const t = read('README.en.md')
    const want = [
      `**${f.parts} parts**`,
      `${f.full} fully simulated, ${f.partial} partially, ${f.visual} visual only`,
      `(${f.rules} rules)`,
      `**${f.lessons} guided lessons** (${f.beginner} beginner, ${f.intermediate} intermediate, ${f.advanced} advanced)`,
      `**${f.examples} examples** (${f.withFirmware} with bundled firmware)`,
      `${f.images} bundled images (${f.projects} firmware projects)`,
      `${f.blocks} blocks`,
    ]
    for (const w of want) expect(t, `README.en.md should say "${w}"`).toContain(w)
  })

  it('the guides', () => {
    const user = read('docs/user-guide.md')
    expect(user).toContain(`${f.lessons} 堂課依**初級**、**中級**、**進階**分組`)
    expect(user).toContain(`${f.examples} 個範例分成六類`)
    expect(user).toContain(`規則共 ${f.rules} 條`)
    const fw = read('docs/firmware-guide.md')
    expect(fw).toContain(`收錄 ${f.projects} 個 CubeIDE 風格的專案`)
    expect(fw).toContain(`隨附的 ${f.images} 個映像檔`)
  })

  it('the user guide’s 量測 section quotes the Blue Pill chip-current limit in the catalog’s own words', async () => {
    // §15 tells the reader that a bench supply's current excludes the chip;
    // the clause is the catalog limit's (support matrix / inspector 未模擬).
    // The English source names the datasheet symbol (IDD); the zh-TW text at
    // the same position says it in plain words (release close-out).
    const { partSupport } = await import('../src/i18n/parts')
    const i18n = await import('../src/i18n/index')
    const at = (supportOf(CATALOG.stm32_bluepill).limits ?? []).findIndex((x) => x.includes('IDD'))
    expect(at, 'stm32_bluepill English limit about the core IDD').toBeGreaterThanOrEqual(0)
    const prev = i18n.lang()
    i18n.__setLangForTests('zh-TW')
    let limits: string[]
    try {
      limits = partSupport(CATALOG.stm32_bluepill).limits ?? []
    } finally {
      i18n.__setLangForTests(prev)
    }
    const line = limits[at]
    expect(line, 'stm32_bluepill zh-TW limit about the chip’s own current').toBeDefined()
    expect(line).toMatch(/72 MHz 時約 \d+–\d+ mA/)
    // 「晶片本身的耗電（72 MHz 時約 20–36 mA）未模擬」: the clause the guide quotes, verbatim
    const clause = line.slice(0, line.indexOf('未模擬') + '未模擬'.length)
    expect(clause, `clause of 「${line}」`).toMatch(/^.+（72 MHz[^）]*）未模擬$/)
    const user = read('docs/user-guide.md')
    const s15 = user.slice(user.indexOf('## 15. '), user.indexOf('## 16. '))
    expect(s15).toContain(clause)
    expect(s15).toContain('電源供應器讀到的電流不含晶片本身')
  })

  it('the verified and unsupported peripherals the READMEs name are the model’s', () => {
    expect(f.verified.sort()).toEqual(['EXTI', 'GPIO', 'IWDG'])
    expect(f.unsupported.sort()).toEqual(['CAN', 'RTC', 'USB', 'USB/CAN SRAM'])
  })
})

describe('docs: commands exist', () => {
  const scripts = Object.keys((JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts)
  const sources = [
    'README.md',
    'README.en.md',
    'ARCHITECTURE.md',
    'docs/user-guide.md',
    'docs/firmware-guide.md',
    'docs/developer-guide.md',
    '.github/workflows/ci.yml',
  ]

  it('every `npm run <script>` mentioned is a package.json script', () => {
    const missing: string[] = []
    for (const file of sources) {
      for (const m of read(file).matchAll(/npm run ([a-z][\w:-]*)/g)) if (!scripts.includes(m[1])) missing.push(`${file}: npm run ${m[1]}`)
    }
    expect(missing, missing.join('\n')).toEqual([])
  })

  it('the CI workflow keeps the documented matrix and steps', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toMatch(/os: \[ubuntu-latest, windows-latest\]/)
    expect(ci).toMatch(/node: \[20, 22\]/)
    for (const step of ['npm ci', 'npm run typecheck', 'npm test', 'npm run examples:check', 'npm run build', 'npm run fw:build', 'npm run audit:i18n', 'npm run test:visual'])
      expect(ci, step).toContain(step)
  })
})
