/**
 * Generates docs/support-matrix.md — the honest "what is simulated" table —
 * FROM THE CODE, never by hand:
 *
 *   - the STM32F103C8 peripheral table exactly as the running MCU model
 *     reports it (`McuDevice.support`, built by src/mcu/stm32f1/peripherals.ts
 *     and shown in the inspector's Peripherals card), with the notes in
 *     Traditional Chinese through the same runtime-message tables the UI uses
 *     (src/i18n/messages.ts tMessage);
 *   - every catalog part (src/model/catalog.ts + src/model/parts/*.parts.ts):
 *     its support level, what IS simulated and what is NOT, in Traditional
 *     Chinese through the part tables (src/i18n/parts.ts);
 *   - every lesson (src/lessons registry): its runnable status and, when it
 *     is not fully simulated, the lesson's own runnableNote;
 *   - every example of the library (src/ui/workspace/examples.ts LIBRARY):
 *     category, difficulty, bundled firmware and its simulation note;
 *   - the electrical rule checker's rules (src/sim/erc/api.ts ERC_RULES) with
 *     what each level means, through the same strings as the 問題 panel.
 *
 * The src modules use Vite features (import.meta.glob), so the script runs
 * through vite-node:
 *
 *   npm run docs:support                                   # rewrite docs/support-matrix.md
 *   npx vite-node scripts/gen-support-matrix.mjs           # same
 *   npx vite-node scripts/gen-support-matrix.mjs -- --check  # exit 1 when the committed file is stale
 *
 * tests/docs-support-matrix.test.ts imports `renderSupportMatrix()` and fails
 * when the committed file differs from the generated text, so a new part, a
 * changed support level or a re-worded note cannot leave the doc stale.
 *
 * Output is deterministic (no dates, catalog order, LF line ends).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { __setLangForTests, hasTranslation, lang, t } from '../src/i18n/index.ts'
import { tMessage, hasMessageTranslation } from '../src/i18n/messages.ts'
import { partLabel, partSupport, partTranslation, supportLevelLabel } from '../src/i18n/parts.ts'
import { tc } from '../src/ui/format.ts'
import { CATALOG, supportOf } from '../src/model/catalog.ts'
import '../src/mcu/all.ts'
import { createMcu, registeredMcus } from '../src/mcu/registry.ts'
import { LESSONS } from '../src/lessons/index.ts'
import { ERC_RULES } from '../src/sim/erc/api.ts'
import {
  EXAMPLE_CATEGORIES,
  LIBRARY,
  exampleCategoryName,
  exampleDifficultyName,
  exampleTitle,
} from '../src/ui/workspace/examples.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const MATRIX_PATH = path.join(ROOT, 'docs', 'support-matrix.md')

/**
 * The original (classic chrome) library order — LEGACY_CATEGORY_ORDER in
 * src/ui/workspace/library-order.ts — and the library's category names (t()
 * sources with the 'category' context). The product library now lists by
 * usage (library-order.ts CATEGORY_ORDER); the matrix keeps this stable
 * reference order on purpose. A category missing from this list is still
 * emitted (after the known ones), never dropped.
 */
const CATEGORY_ORDER = ['mcu', 'passive', 'semiconductor', 'switch', 'display', 'ic', 'power', 'sensor', 'module', 'motor', 'instrument']
const CATEGORY_NAMES = {
  passive: 'Passives',
  semiconductor: 'Semis',
  switch: 'Switches',
  display: 'Displays',
  ic: 'ICs',
  power: 'Power',
  instrument: 'Instruments',
  mcu: 'MCU',
  sensor: 'Sensors',
  module: 'Modules',
  motor: 'Motors',
}

/** McuPanel.tsx STATUS_LABEL (shown through tc(…, 'peripheral')). */
const STATUS_LABEL = { verified: 'Verified', partial: 'Partial', unsupported: 'Unsupported' }
const LEVELS = ['full', 'partial', 'visual', 'dev']

/** src/ui/lessons/labels.tsx: the lesson browser's level and runnable words (English sources). */
const LESSON_LEVEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }
const LESSON_RUNNABLE = { ready: 'Runnable', partial: 'Partly simulated', 'not-yet': 'Not runnable yet' }
/** the 問題 panel's level words (ErcPanel.tsx, tc(…, 'erc')) */
const ERC_LEVEL = { error: 'Error', risk: 'Risk', info: 'Info' }

/** Markdown table-cell / inline text escaping (pipes, emphasis stars, HTML). */
function md(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\*/g, '\\*').replace(/</g, '&lt;').replace(/\r?\n/g, ' ')
}

function categoryName(c) {
  return CATEGORY_NAMES[c] ? tc(CATEGORY_NAMES[c], 'category') : c
}

function orderedEntries() {
  const entries = Object.values(CATALOG)
  const known = CATEGORY_ORDER.flatMap((c) => entries.filter((e) => e.category === c))
  const rest = entries.filter((e) => !CATEGORY_ORDER.includes(e.category))
  return [...known, ...rest]
}

function categoriesInOrder() {
  const present = new Set(Object.values(CATALOG).map((e) => e.category))
  return [...CATEGORY_ORDER.filter((c) => present.has(c)), ...[...present].filter((c) => !CATEGORY_ORDER.includes(c)).sort()]
}

function mcuSection(out) {
  for (const model of registeredMcus().sort()) {
    const mcu = createMcu(model)
    if (!mcu) continue
    const support = mcu.support
    const count = (s) => support.filter((p) => p.status === s).length
    out.push(`## 微控制器周邊：\`${model}\``)
    out.push('')
    out.push(
      `來源：\`McuDevice.support\`（\`src/mcu/stm32f1/peripherals.ts\`），即選取開發板後「屬性」面板「周邊」分頁顯示的同一份表格。` +
        `共 ${support.length} 個區塊：${tc(STATUS_LABEL.verified, 'peripheral')} ${count('verified')}、` +
        `${tc(STATUS_LABEL.partial, 'peripheral')} ${count('partial')}、${tc(STATUS_LABEL.unsupported, 'peripheral')} ${count('unsupported')}。`,
    )
    out.push('')
    out.push(
      `- **${tc(STATUS_LABEL.verified, 'peripheral')}**：文件記載的功能全部實作，**且**有真實韌體整合測試（\`tests/mcu/stm32f1/*firmware*.test.ts\` 等）通過。`,
    )
    out.push(`- **${tc(STATUS_LABEL.partial, 'peripheral')}**：已實作的部分見說明；未實作的部分也寫在說明裡。`)
    out.push(
      `- **${tc(STATUS_LABEL.unsupported, 'peripheral')}**：暫存器讀取一律為 0、忽略寫入，並在模擬日誌記錄每一次存取——絕不假裝可以運作。`,
    )
    out.push('')
    out.push('| 區塊 | 狀態 | 說明 | 驗證用韌體 |')
    out.push('|---|---|---|---|')
    for (const p of support) {
      const name = tc(p.name, 'periph-name')
      const shown = name === p.name ? `\`${p.name}\`` : `${md(name)}（\`${p.name}\`）`
      const tests = p.verifiedBy?.length ? p.verifiedBy.map((n) => `\`${n}\``).join('、') : '—'
      out.push(`| ${shown} | ${md(tc(STATUS_LABEL[p.status], 'peripheral'))} | ${md(tMessage(p.notes))} | ${tests} |`)
    }
    out.push('')
  }
}

function partsOverview(out) {
  const entries = orderedEntries()
  const byLevel = (l) => entries.filter((e) => supportOf(e).level === l).length
  out.push('## 元件總覽')
  out.push('')
  out.push(
    `來源：\`src/model/catalog.ts\` 與 \`src/model/parts/*.parts.ts\` 的 \`support\` 欄位（未標示的舊元件視為「${supportLevelLabel('full')}」，` +
      `見 \`supportOf()\`），中文文字取自 \`src/i18n/zh-TW/parts-*.ts\`。共 ${entries.length} 種元件：` +
      LEVELS.map((l) => `${supportLevelLabel(l)} ${byLevel(l)}`).join('、') +
      '。',
  )
  out.push('')
  out.push(`- **${supportLevelLabel('full')}**：在其記載的模型範圍內完整模擬（範圍見「已模擬」）。`)
  out.push(`- **${supportLevelLabel('partial')}**：只模擬註明的部分行為（缺少的部分見「未模擬」）。`)
  out.push(`- **${supportLevelLabel('visual')}**：只支援放置、接線與網路表；除了連接關係之外不模擬任何行為。`)
  out.push(`- **${supportLevelLabel('dev')}**：開發中，一般版本無法放置。`)
  out.push('')
  out.push('| 分類 | 元件 | 類型（`type`） | 支援等級 |')
  out.push('|---|---|---|---|')
  for (const e of entries) {
    out.push(`| ${md(categoryName(e.category))} | ${md(partLabel(e))} | \`${e.type}\` | ${md(supportLevelLabel(supportOf(e).level))} |`)
  }
  out.push('')
}

function lessonsSection(out) {
  const count = (r) => LESSONS.filter((l) => l.runnable === r).length
  out.push('## 課程的模擬狀態')
  out.push('')
  out.push(
    `來源：\`src/lessons/<級別>/*.lesson.ts\` 的 \`runnable\` 與 \`runnableNote\`（課程瀏覽器卡片上的同一個標示）。共 ${LESSONS.length} 堂：` +
      Object.keys(LESSON_RUNNABLE)
        .map((r) => `${t(LESSON_RUNNABLE[r])} ${count(r)}`)
        .join('、') +
      '。驗收條件一律在真實模擬中評估；「部分模擬」的課程可以執行與驗收，說明列出沒有模擬的部分。',
  )
  out.push('')
  out.push('| 課程 | 標題 | 狀態 | 沒有模擬的部分 |')
  out.push('|---|---|---|---|')
  for (const l of LESSONS) {
    const code = `${tc(LESSON_LEVEL[l.level], 'lesson level')} ${l.order}`
    const note = l.runnable === 'ready' ? '—' : md(l.runnableNote ?? '')
    out.push(`| ${md(code)}（\`${l.id}\`） | ${md(l.title)} | ${md(t(LESSON_RUNNABLE[l.runnable]))} | ${note} |`)
  }
  out.push('')
}

function examplesSection(out) {
  const partial = LIBRARY.filter((e) => e.simulation !== 'full').length
  const withFw = LIBRARY.filter((e) => e.firmware).length
  out.push('## 範例的模擬狀態')
  out.push('')
  out.push(
    `來源：範例庫 \`LIBRARY\`（\`src/ui/workspace/examples.ts\`：\`examples/embedded/index.json\` 加上 4 個經典電路）。共 ${LIBRARY.length} 個範例，` +
      `其中 ${withFw} 個內含韌體、${partial} 個標示「部分模擬」。`,
  )
  out.push('')
  out.push('| 分類 | 範例 | 難度 | 內含韌體 | 模擬 |')
  out.push('|---|---|---|---|---|')
  for (const c of EXAMPLE_CATEGORIES) {
    for (const e of LIBRARY.filter((x) => x.category === c)) {
      const fw = e.firmware ? `\`${e.firmware.project ?? e.firmware.name}\`` : '—'
      const sim = e.simulation === 'full' ? supportLevelLabel('full') : `${supportLevelLabel('partial')}：${md(e.simulationNote ?? '')}`
      out.push(`| ${md(exampleCategoryName(c))} | ${md(exampleTitle(e, t))} | ${md(exampleDifficultyName(e.difficulty))} | ${fw} | ${sim} |`)
    }
  }
  out.push('')
}

function ercSection(out) {
  out.push('## 電氣規則檢查（ERC）的規則')
  out.push('')
  out.push(
    `來源：\`ERC_RULES\`（\`src/sim/erc/api.ts\`），即「問題」面板「這是什麼？」說明的同一份表格。共 ${ERC_RULES.length} 條規則。` +
      'ERC 是規則式檢查：只在有資料（接線、元件額定值、模擬讀數）時下判斷，不能證明電路一定正確或安全。',
  )
  out.push('')
  out.push(`| 規則 | ${Object.values(ERC_LEVEL).map((l) => tc(l, 'erc')).join(' | ')} |`)
  out.push(`|---|${Object.keys(ERC_LEVEL).map(() => '---').join('|')}|`)
  for (const r of ERC_RULES) {
    const cells = Object.keys(ERC_LEVEL).map((l) => (r.levels[l] ? md(t(r.levels[l])) : '—'))
    out.push(`| ${md(t(r.title))}（\`${r.id}\`） | ${cells.join(' | ')} |`)
  }
  out.push('')
}

function partsDetail(out) {
  const entries = orderedEntries()
  out.push('## 各元件的模擬範圍')
  out.push('')
  for (const c of categoriesInOrder()) {
    out.push(`### ${md(categoryName(c))}`)
    out.push('')
    for (const e of entries.filter((x) => x.category === c)) {
      const s = partSupport(e)
      const pn = e.meta?.partNumber && e.meta.partNumber !== partLabel(e) ? `（${md(e.meta.partNumber)}）` : ''
      out.push(`#### ${md(partLabel(e))} — \`${e.type}\``)
      out.push('')
      out.push(`支援等級：**${md(supportLevelLabel(s.level))}**${pn}`)
      out.push('')
      if (s.simulated?.length) {
        out.push(`${t('Simulated')}：`)
        out.push('')
        for (const x of s.simulated) out.push(`- ${md(x)}`)
        out.push('')
      }
      if (s.limits?.length) {
        out.push(`${t('Not modeled')}：`)
        out.push('')
        for (const x of s.limits) out.push(`- ${md(x)}`)
        out.push('')
      }
      if (!s.simulated?.length && !s.limits?.length) {
        out.push('（此元件沒有額外的模擬說明。）')
        out.push('')
      }
    }
  }
}

/** Untranslated texts the generator had to print in English (reported, never hidden). */
function missingTranslations() {
  const missing = []
  for (const e of Object.values(CATALOG)) if (!partTranslation(e.type)) missing.push(`part ${e.type}`)
  for (const model of registeredMcus()) {
    const mcu = createMcu(model)
    for (const p of mcu?.support ?? []) if (!hasMessageTranslation(p.notes)) missing.push(`${model} ${p.name} notes`)
  }
  for (const r of ERC_RULES) {
    if (!hasTranslation(r.title)) missing.push(`ERC ${r.id} title`)
    for (const [l, s] of Object.entries(r.levels)) if (s && !hasTranslation(s)) missing.push(`ERC ${r.id} ${l}`)
  }
  return missing
}

/** The whole document (zh-TW). Pure apart from the language switch, which is restored. */
export function renderSupportMatrix() {
  const prev = lang()
  __setLangForTests('zh-TW')
  try {
    const out = []
    out.push('<!-- 本檔案由 scripts/gen-support-matrix.mjs 依程式碼自動產生，請勿手動編輯。')
    out.push('     重新產生：npm run docs:support（tests/docs-support-matrix.test.ts 會在內容過期時失敗） -->')
    out.push('')
    out.push('# 模擬支援矩陣')
    out.push('')
    out.push(
      'ohmlet 不做「假模擬」：每個 MCU 周邊、每個元件、每堂課程與每個範例都誠實標示模擬到什麼程度。本頁直接由程式碼產生，' +
        '內容與應用程式中的「周邊」分頁、元件庫卡片上的支援等級徽章、屬性面板的「已模擬／未模擬」清單、課程卡片的標示，' +
        '以及「問題」面板的規則說明完全一致。',
    )
    out.push('')
    out.push('- [微控制器周邊](#微控制器周邊stm32f103c8)')
    out.push('- [元件總覽](#元件總覽)')
    out.push('- [課程的模擬狀態](#課程的模擬狀態)')
    out.push('- [範例的模擬狀態](#範例的模擬狀態)')
    out.push('- [電氣規則檢查（ERC）的規則](#電氣規則檢查erc的規則)')
    out.push('- [各元件的模擬範圍](#各元件的模擬範圍)')
    out.push('')
    mcuSection(out)
    partsOverview(out)
    lessonsSection(out)
    examplesSection(out)
    ercSection(out)
    partsDetail(out)
    const missing = missingTranslations()
    if (missing.length) {
      out.push('## 尚未翻譯的項目')
      out.push('')
      out.push('以下文字目前沒有繁體中文翻譯，上面以英文原文列出：')
      out.push('')
      for (const m of missing) out.push(`- \`${m}\``)
      out.push('')
    }
    return out.join('\n').replace(/\n+$/, '\n')
  } finally {
    __setLangForTests(prev)
  }
}

function main() {
  const check = process.argv.includes('--check')
  const text = renderSupportMatrix()
  if (check) {
    let current = ''
    try {
      current = readFileSync(MATRIX_PATH, 'utf8').replace(/\r\n/g, '\n')
    } catch {
      /* missing = stale */
    }
    if (current !== text) {
      console.error('docs/support-matrix.md is stale — run: npm run docs:support')
      process.exitCode = 1
    } else console.log('docs/support-matrix.md is up to date')
    return
  }
  writeFileSync(MATRIX_PATH, text)
  console.log(`wrote ${path.relative(ROOT, MATRIX_PATH)} (${text.split('\n').length} lines)`)
}

// CLI only: vite-node strips the script path from process.argv, so "not
// under vitest" is the test (vitest imports renderSupportMatrix() without
// side effects)
if (!process.env.VITEST) main()
