/**
 * Builds the curated example library examples/embedded/ from its readable
 * descriptors.
 *
 *   node scripts/build-examples.mjs           # (re)write every example file + index.json
 *   node scripts/build-examples.mjs --check   # exit 1 when a file is missing or stale
 *   node scripts/build-examples.mjs --list    # id, category, firmware, title
 *
 * Inputs
 *   examples/embedded/src/<id>.example.mjs — one descriptor per example
 *     (default export, see DESCRIPTOR below): zh-TW title / summary /
 *     description / tags / difficulty, the firmware/dist project to embed,
 *     a build() that returns the breadboard layout (helpers in
 *     examples/embedded/src/lib.mjs), pre-placed logic-analyzer channels and
 *     decoders, the instrument tab to open, and what the example must do in
 *     the simulation (checked by tests/examples-embedded.test.ts).
 *   firmware/dist/<project>.elf — the prebuilt firmware images.
 *
 * Outputs
 *   examples/embedded/<id>.ohmlet.json — a self-contained 'ohmlet-project'
 *     envelope (src/state/project.ts, formatVersion 1): the layout, the ELF
 *     embedded byte-exact (base64 + SHA-256 + size), the instrument tray tab
 *     and the logic-analyzer setup. Byte-identical to what
 *     serializeProject() writes for the same contents, so opening one goes
 *     through lab.importProject like any saved project.
 *   examples/embedded/index.json — the small metadata list the Examples UI
 *     bundles (src/ui/workspace/examples.ts); the big envelopes are fetched
 *     only when an example is opened.
 *
 * Re-run after ANY firmware rebuild (node firmware/build.mjs …): the
 * envelopes embed copies of the ELFs, and tests/examples-embedded.test.ts
 * fails with "re-run node scripts/build-examples.mjs" when an embedded SHA
 * no longer matches firmware/dist. Output is deterministic (fixed savedAt,
 * sorted keys where serializeProject sorts), so an unchanged library
 * rebuilds byte-identically.
 *
 * Plain node (no dependencies, no TypeScript): the layout validator and the
 * ERC run in the test suite, which loads these same descriptors.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const EXAMPLES_DIR = path.join(ROOT, 'examples', 'embedded')
export const SRC_DIR = path.join(EXAMPLES_DIR, 'src')
export const DIST_DIR = path.join(ROOT, 'firmware', 'dist')
export const INDEX_FILE = path.join(EXAMPLES_DIR, 'index.json')

/** Fixed "savedAt" of every generated envelope (deterministic output). */
export const EXAMPLES_SAVED_AT = '2026-10-10T00:00:00.000Z'

/** Library sections, in display order (labels live in the UI dictionaries). */
export const CATEGORIES = ['gpio', 'serial', 'display', 'sensor', 'motor', 'analog']
export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced']
/** The app's instrument tray tabs (src/state/lab.ts TRAY_TABS; 'measure' = 量測, UX IS-19). */
export const TRAY_TABS = ['uart', 'logic', 'scope', 'log', 'measure']

/**
 * DESCRIPTOR (default export of src/<id>.example.mjs):
 * {
 *   id: 'blink',                    // file name, stable (saved in user bookmarks/tests)
 *   order: 10,                      // sort order inside the category
 *   category: 'gpio',               // one of CATEGORIES
 *   difficulty: 'beginner',         // one of DIFFICULTIES
 *   title: '…', summary: '…',       // zh-TW: list title, one-line subtitle (no English words:
 *                                   //   they are UI copy, checked like the i18n audit)
 *   description: '…',               // zh-TW: paragraphs separated by blank lines; `code` spans
 *                                   //   mark literal firmware output / identifiers (shown in mono)
 *   tags: ['GPIO', …],              // zh-TW / technical tokens
 *   glyph: 'led',                   // catalog type whose icon represents the example
 *   firmware: 'hal-blink' | null,   // firmware/dist project embedded for U1
 *   simulation: 'full' | 'partial', // 'partial' = something is not simulated …
 *   simulationNote?: '…',           // … and this says exactly what (zh-TW)
 *   build(): Bench,                 // the breadboard (src/lib.mjs)
 *   logic?: { channels: [...], decoders?: [...] },  // instruments.logicChannels / logicView.decoders
 *   tray?: 'uart' | 'logic' | 'scope' | 'log' | 'measure', // instrument tab opened with the example
 *   trayHeight?: 340,               // desktop tray height (px) the example opens with (a two-channel scope needs room)
 *   scope?: { tdiv, vdiv, trigSource, trigSlope, trigLevel, trigMode }, // instruments.scope (oscilloscope front panel on open)
 *   ercRisks?: ['logic-level', …],  // ERC 'risk' rules kept on purpose (explained in the text)
 *   expect: { seconds, uart?: { <port>: 'text the port prints first' } }
 * }
 */

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function fail(msg) {
  throw new Error(`build-examples: ${msg}`)
}

/** Load every descriptor (sorted by file name). */
export async function loadDescriptors() {
  const files = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.example.mjs'))
    .sort()
  const out = []
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(SRC_DIR, f)).href)
    const d = mod.default
    if (!d || typeof d !== 'object') fail(`${f}: no default export`)
    if (`${d.id}.example.mjs` !== f) fail(`${f}: id "${d.id}" must match the file name`)
    out.push(d)
  }
  return out
}

function checkDescriptor(d, seen) {
  const where = `example "${d.id}"`
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.id)) fail(`${where}: id must be kebab-case`)
  if (seen.has(d.id)) fail(`${where}: duplicate id`)
  seen.add(d.id)
  if (!CATEGORIES.includes(d.category)) fail(`${where}: unknown category ${d.category}`)
  if (!DIFFICULTIES.includes(d.difficulty)) fail(`${where}: unknown difficulty ${d.difficulty}`)
  for (const k of ['title', 'summary', 'description']) {
    if (typeof d[k] !== 'string' || !d[k].trim()) fail(`${where}: "${k}" must be a non-empty string`)
  }
  if (!Array.isArray(d.tags) || d.tags.length === 0 || !d.tags.every((t) => typeof t === 'string' && t)) {
    fail(`${where}: "tags" must be a non-empty string array`)
  }
  if (!Number.isFinite(d.order)) fail(`${where}: "order" must be a number`)
  if (typeof d.glyph !== 'string' || !d.glyph) fail(`${where}: "glyph" must name a catalog type`)
  if (d.firmware !== null && typeof d.firmware !== 'string') fail(`${where}: "firmware" must be a project name or null`)
  if (!['full', 'partial'].includes(d.simulation)) fail(`${where}: "simulation" must be 'full' or 'partial'`)
  if (d.simulation === 'partial' && !d.simulationNote) fail(`${where}: a partial example needs a simulationNote`)
  if (d.tray !== undefined && !TRAY_TABS.includes(d.tray)) fail(`${where}: unknown tray tab ${d.tray}`)
  if (d.trayHeight !== undefined && !(Number.isInteger(d.trayHeight) && d.trayHeight >= 96 && d.trayHeight <= 960)) {
    fail(`${where}: trayHeight must be an integer 96–960 (px)`)
  }
  if (d.trayHeight !== undefined && !d.tray) fail(`${where}: trayHeight needs a tray tab`)
  if (typeof d.build !== 'function') fail(`${where}: build() missing`)
  if (!d.expect || !Number.isFinite(d.expect.seconds)) fail(`${where}: expect.seconds missing`)
}

/**
 * The envelope object of one descriptor — key order and content exactly as
 * serializeProject (src/state/project.ts) writes them.
 */
export function buildEnvelope(d, appVersion) {
  const bench = d.build()
  // the layout's own description is plain text: `code` markers (UI only) removed
  const layout = bench.layout({
    title: d.title,
    description: d.layoutDescription ?? `${d.summary}\n\n${d.description}`.replace(/`([^`\n]+)`/g, '$1'),
  })
  const firmware = {}
  let fwMeta = null
  if (d.firmware) {
    const file = path.join(DIST_DIR, `${d.firmware}.elf`)
    if (!existsSync(file)) fail(`example "${d.id}": firmware/dist/${d.firmware}.elf does not exist`)
    const bytes = readFileSync(file)
    if (!layout.components.some((c) => c.id === 'U1' && c.type === 'stm32_bluepill')) {
      fail(`example "${d.id}": firmware needs the Blue Pill U1`)
    }
    const sha256 = sha256Hex(bytes)
    firmware.U1 = { name: `${d.firmware}.elf`, format: 'elf', sha256, size: bytes.length, data: bytes.toString('base64') }
    fwMeta = { project: d.firmware, name: `${d.firmware}.elf`, sha256, size: bytes.length }
  }
  const env = {
    format: 'ohmlet-project',
    formatVersion: 1,
    app: { name: 'ohmlet', version: appVersion },
    savedAt: EXAMPLES_SAVED_AT,
    layout,
    firmware,
  }
  if (d.tray) env.workspace = { v: 1, tray: d.trayHeight ? { open: true, height: d.trayHeight, tab: d.tray } : { open: true, tab: d.tray } }
  const channels = d.logic?.channels ?? []
  const decoders = d.logic?.decoders ?? []
  if (channels.length > 0 || decoders.length > 0) {
    env.instruments = { logicChannels: channels }
    if (decoders.length > 0) env.instruments.logicView = { v: 1, decoders, trigger: null }
  }
  if (d.scope) env.instruments = { ...(env.instruments ?? {}), scope: d.scope }
  return { env, fwMeta, layout }
}

/** Index entry (what the Examples UI lists without loading the envelope). */
function indexEntry(d, fwMeta, layout) {
  const instruments = []
  if (d.tray === 'uart' || d.expect.uart) instruments.push('uart')
  if ((d.logic?.channels ?? []).length > 0) instruments.push('logic')
  if (layout.components.some((c) => c.type === 'scope_probe')) instruments.push('scope')
  const e = {
    id: d.id,
    file: `${d.id}.ohmlet.json`,
    category: d.category,
    order: d.order,
    difficulty: d.difficulty,
    title: d.title,
    summary: d.summary,
    description: d.description,
    tags: d.tags,
    glyph: d.glyph,
    firmware: fwMeta,
    simulation: d.simulation,
    parts: layout.components.length,
    wires: layout.wires.length,
    instruments,
  }
  if (d.simulationNote) e.simulationNote = d.simulationNote
  return e
}

/** Build everything in memory: file name → text. */
export async function buildAll() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const appVersion = typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  const descriptors = await loadDescriptors()
  const seen = new Set()
  const files = new Map()
  const index = []
  for (const d of descriptors) {
    checkDescriptor(d, seen)
    const { env, fwMeta, layout } = buildEnvelope(d, appVersion)
    files.set(`${d.id}.ohmlet.json`, `${JSON.stringify(env, null, 2)}\n`)
    index.push(indexEntry(d, fwMeta, layout))
  }
  index.sort(
    (a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.order - b.order || (a.id < b.id ? -1 : 1),
  )
  files.set('index.json', `${JSON.stringify({ v: 1, examples: index }, null, 2)}\n`)
  return { files, index, descriptors }
}

async function main() {
  const args = process.argv.slice(2)
  const { files, index } = await buildAll()
  if (args.includes('--list')) {
    for (const e of index) console.log(`${e.category.padEnd(8)} ${e.id.padEnd(22)} ${(e.firmware?.project ?? '—').padEnd(22)} ${e.title}`)
    return
  }
  const stale = []
  for (const [name, text] of files) {
    const p = path.join(EXAMPLES_DIR, name)
    const old = existsSync(p) ? readFileSync(p, 'utf8') : null
    if (old !== text) stale.push(name)
  }
  const orphans = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.ohmlet.json') && !files.has(f))
  if (args.includes('--check')) {
    if (stale.length || orphans.length) {
      console.error(`examples out of date: ${[...stale, ...orphans.map((o) => `${o} (no descriptor)`)].join(', ')}`)
      console.error('run: node scripts/build-examples.mjs')
      process.exit(1)
    }
    console.log(`${index.length} examples up to date`)
    return
  }
  for (const name of stale) writeFileSync(path.join(EXAMPLES_DIR, name), files.get(name))
  for (const o of orphans) rmSync(path.join(EXAMPLES_DIR, o))
  console.log(`${index.length} examples: ${stale.length} written, ${orphans.length} removed, ${files.size - stale.length} unchanged`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
