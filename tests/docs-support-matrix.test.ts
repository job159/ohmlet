/**
 * docs/support-matrix.md is GENERATED from the code
 * (scripts/gen-support-matrix.mjs: McuDevice.support + every catalog part's
 * support level / simulated / limits, in zh-TW through the i18n tables).
 * This test regenerates it in memory and fails when the committed file is
 * stale — a new part, a changed support level, a re-worded peripheral note
 * or translation must come with `npm run docs:support`.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Generator {
  renderSupportMatrix(): string
  MATRIX_PATH: string
}

// The generator is a plain .mjs (it is also a vite-node CLI); a computed
// specifier keeps TypeScript from asking for a declaration file.
const GENERATOR = '../scripts/gen-support-matrix.mjs'

describe('docs/support-matrix.md', () => {
  it('matches the code (regenerate with: npm run docs:support)', async () => {
    const gen = (await import(/* @vite-ignore */ GENERATOR)) as Generator
    const expected = gen.renderSupportMatrix()
    let committed = ''
    try {
      committed = readFileSync(gen.MATRIX_PATH, 'utf8').replace(/\r\n/g, '\n')
    } catch {
      /* missing file = stale */
    }
    if (committed !== expected) {
      const a = committed.split('\n')
      const b = expected.split('\n')
      let i = 0
      while (i < a.length && i < b.length && a[i] === b[i]) i++
      expect.fail(
        `docs/support-matrix.md is stale — run \`npm run docs:support\`.\n` +
          `first difference at line ${i + 1}:\n  committed: ${a[i] ?? '(end of file)'}\n  generated: ${b[i] ?? '(end of file)'}`,
      )
    }
    // the first test pays the generator's cold import (catalog + every i18n table): ~5 s on a busy machine
  }, 30_000)

  it('lists every peripheral of the MCU model and every catalog part', async () => {
    const gen = (await import(/* @vite-ignore */ GENERATOR)) as Generator
    const text = gen.renderSupportMatrix()
    const { CATALOG } = await import('../src/model/catalog')
    await import('../src/mcu/all')
    const { createMcu } = await import('../src/mcu/registry')
    const mcu = createMcu('stm32f103c8')
    expect(mcu).not.toBeNull()
    for (const p of mcu!.support) expect(text, `peripheral ${p.name}`).toContain(`\`${p.name}\``)
    for (const type of Object.keys(CATALOG)) expect(text, `part ${type}`).toContain(`\`${type}\``)
    // honest levels are spelled out, not hidden
    expect(text).toContain('不支援')
    expect(text).not.toContain('尚未翻譯的項目')
  })

  it('the Blue Pill lists the MCU core’s own supply current (IDD) as not simulated, in the catalog’s words', async () => {
    // a bench supply's current excludes the chip itself — said in the same
    // place as the modules' 「面板本身不消耗電源電流」, never left for the
    // reader to infer from a suspiciously small reading
    // (the English source names IDD; the zh-TW line at the same position says it in plain words)
    const gen = (await import(/* @vite-ignore */ GENERATOR)) as Generator
    const { CATALOG, supportOf } = await import('../src/model/catalog')
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
    const idd = limits[at]
    expect(idd, 'stm32_bluepill zh-TW limit about the chip’s own current').toBeDefined()
    expect(idd).toContain('耗電')
    expect(idd).toMatch(/72 MHz/)
    expect(idd).toMatch(/\d+–\d+ mA/)
    expect(idd).toContain('電源供應器')
    expect(idd).toContain('不含晶片本身')

    // the committed page carries it, verbatim, under the Blue Pill's 未模擬 list
    const committed = readFileSync(gen.MATRIX_PATH, 'utf8').replace(/\r\n/g, '\n')
    const start = committed.indexOf('— `stm32_bluepill`')
    expect(start, 'Blue Pill section').toBeGreaterThan(0)
    const next = committed.indexOf('\n#', start + 1)
    const section = committed.slice(start, next < 0 ? undefined : next)
    const notModeled = section.slice(section.indexOf('\n未模擬：'))
    expect(section.indexOf('\n未模擬：'), 'Blue Pill 未模擬 list').toBeGreaterThan(0)
    expect(notModeled.split('\n')).toContain(`- ${idd}`)
  })

  it('lists every lesson with its runnable note, every example and every ERC rule', async () => {
    const gen = (await import(/* @vite-ignore */ GENERATOR)) as Generator
    const text = gen.renderSupportMatrix()
    const { LESSONS } = await import('../src/lessons/index')
    const { ERC_RULES } = await import('../src/sim/erc/api')
    const { LIBRARY } = await import('../src/ui/workspace/examples')
    for (const l of LESSONS) {
      expect(text, `lesson ${l.id}`).toContain(`\`${l.id}\``)
      // a lesson that is not fully simulated says what is missing
      if (l.runnable !== 'ready') expect(text, `lesson ${l.id} note`).toContain((l.runnableNote ?? '').slice(0, 20))
    }
    for (const r of ERC_RULES) expect(text, `ERC rule ${r.id}`).toContain(`\`${r.id}\``)
    for (const e of LIBRARY) {
      if (e.firmware) expect(text, `example firmware ${e.firmware.project}`).toContain(`\`${e.firmware.project}\``)
      if (e.simulation !== 'full') expect(text, `example note ${e.key}`).toContain((e.simulationNote ?? '').slice(0, 20))
    }
  })
})
