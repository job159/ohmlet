/**
 * UX fix IN-17 — replay of the audit task (docs/ux/UX_VERIFY.md V-08;
 * findings F-05, TR-10, F-06, N12): the two classic beginner mistakes.
 *
 *   UX_E2E_URL=http://localhost:5324/ node scripts/ux-e2e/inspector-IN-17.mjs
 *
 *  - the student's B46 layout (blink with its LED reversed, the cathode on the
 *    PA5 side), running: an error row 「LED1 可能接反了」 naming both holes and
 *    the measured voltage, also on the pill, with 「對調兩腳」 that fixes it
 *    in one click
 *  - lesson b1 with LED1 reversed: a risk before Run, on the pill while running
 *  - the B41 layout (the cathode's − rail fed by nothing): 「LED1 的陰極（top-32）
 *    接到上方 − 電源軌，但這條電源軌沒有接到電源（PS1 負端）…」, the whole rail
 *    marked; the MCU card's 未供電 reason is the board's own power problem
 * The blink example's LED is LED1 since bf340c5 (it was D1 when this replay
 * was written; the LED<n> designator, as the example's own text and the
 * lessons name it).
 * Exit code 1 on any failed check.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright')
const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const CHANNEL = process.env.UX_E2E_CHANNEL ?? 'msedge'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const EMPTY = { version: 1, name: 'empty', components: [], wires: [] }

let failures = 0
function check(cond, what, extra = '') {
  const x = typeof extra === 'string' ? extra : JSON.stringify(extra)
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${x ? `  (${x.length > 300 ? x.slice(0, 300) + '…' : x})` : ''}`)
  if (!cond) failures++
  return cond
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true })

/** A fresh profile: zh-TW, the desktop workspace at 1440×900 (or the phone), `layout` on the board. */
async function open({ lang = 'zh-TW', workspace = true, phone = false, layout = EMPTY } = {}) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([lang, ws, layout]) => {
      if (sessionStorage.getItem('in.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', lang)
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      localStorage.setItem('bb.layout', layout)
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      sessionStorage.setItem('in.seeded', '1')
    },
    [lang, workspace, JSON.stringify(layout)],
  )
  // a loaded machine (several dev servers + browsers) takes 35-110 s to the load event of a
  // fresh profile's ~1000 dev modules (release triage, measured): wait for the page, not 30 s
  await page.goto(URL, { timeout: 180000 })
  await page.waitForSelector('canvas', { timeout: 90000 })
  await sleep(2000)
  return { ctx, page, errors }
}

/** Run `src` (an async body; `m` = the app module at `p`, `a` = arg) in the page — the dev server serves /src. */
const mod = (page, p, src, arg) =>
  page.evaluate(
    async ([p, s, a]) => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new globalThis.URL(n).pathname === p) ?? p
      const m = await import(url)
      const F = Object.getPrototypeOf(async function () {}).constructor
      return await new F('m', 'a', s)(m, a)
    },
    [p, src, arg],
  )
const store = (page, src, arg) => mod(page, '/src/state/store.ts', src, arg)
const openExample = async (page, id) => {
  const r = await mod(page, '/src/ui/workspace/examples.ts', `return await m.openExampleById(${JSON.stringify(id)})`)
  await sleep(1500)
  return r
}
const loadLayout = async (page, layout) => {
  await store(page, 'm.useStore.getState().loadLayout(a)', layout)
  await sleep(600)
}
const bindFirmware = (page, id, name) =>
  mod(page, '/src/ui/embedded/McuPanel.tsx', `return await m.bindBundledFirmware(${JSON.stringify(id)}, ${JSON.stringify(name)})`)
const lessonCircuit = (page, id, which = 'solution') =>
  mod(page, '/src/ui/lessons/actions.ts', `const L = await import('/src/lessons/index.ts'); return await m.loadLessonCircuit(L.lessonById(${JSON.stringify(id)}), ${JSON.stringify(which)})`)
async function runUntil(page, simTime, maxMs = 90000) {
  await store(page, 'm.useStore.getState().startSim()')
  const t0 = Date.now()
  let t = 0
  while (Date.now() - t0 < maxMs) {
    await sleep(300)
    t = await store(page, 'return m.useStore.getState().simTime')
    if (t >= simTime) break
  }
  return t
}
const pause = async (page) => {
  await store(page, 'm.useStore.getState().stopSim()')
  await sleep(300)
}
const select = async (page, id) => {
  await store(page, `m.useStore.getState().select(${JSON.stringify(id)})`)
  await sleep(700)
}
/** The problems store after the watcher caught up (≤ 1 Hz live, 250 ms debounce). */
async function problems(page, wait = 2500) {
  await sleep(wait)
  return mod(
    page,
    '/src/ui/embedded/problems.ts',
    'const s = m.useProblems.getState(); const f = (p) => ({ id: p.id, level: p.level, title: p.title, detail: p.detail, fact: p.fact ?? null, action: p.action?.label ?? null, affects: p.affects ?? 0, folded: p.folded ?? null, pending: !!p.pendingRuntime, note: p.note ?? null, holes: p.holes }); return { rows: s.problems.map(f), resolved: s.resolved.map(f), counts: s.counts }',
  )
}
async function pillText(page) {
  const el = page.locator('.app-status-pill').first()
  if ((await el.count()) === 0) return ''
  return (await el.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
}
async function inspectorText(page) {
  const el = page.locator('.ws-right').first()
  const t = (await el.count()) > 0 ? await el.innerText() : await page.locator('.prs').first().innerText().catch(() => '')
  return t.replace(/[ \t]+/g, ' ')
}

// ---- B46: reversed on PA5 ----
{
  const { ctx, page, errors } = await open()
  await openExample(page, 'blink')
  await store(page, "m.useStore.getState().swapLeads('LED1')")
  await runUntil(page, 1.5)
  const p = await problems(page)
  const rev = p.rows.find((r) => r.title === 'LED1 可能接反了')
  check(rev?.level === 'error' && /長腳（陽極）在 top-32、短腳（陰極）在 b40；陰極比陽極高 \d\.\d\d V，所以不會亮。請把兩支腳對調。/.test(rev.detail), 'an error row naming the holes and the voltage', rev ?? p.rows.map((r) => r.title))
  check(/LED1 可能接反了/.test(await pillText(page)), 'the pill shows it')
  await select(page, 'LED1')
  await page.locator('.insp-part-problems').getByRole('button', { name: '對調兩腳' }).first().click()
  await sleep(500)
  const holes = await store(page, "return m.useStore.getState().layout.components.find((c) => c.id === 'LED1').holes")
  check(holes.join() === 'b40,top-32', '「對調兩腳」 fixes it in one click', holes)
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}
// ---- b1 reversed ----
{
  const { ctx, page, errors } = await open()
  await lessonCircuit(page, 'b1-led-resistor')
  await sleep(800)
  await store(page, "m.useStore.getState().swapLeads('LED1')")
  const p = await problems(page, 1800)
  check(p.rows.some((r) => /^LED1 /.test(r.title) && /接反/.test(r.title) && r.level === 'warning'), 'a risk before Run', p.rows.map((r) => [r.title, r.level]))
  await runUntil(page, 0.8)
  await problems(page)
  const pill = await pillText(page)
  check(/LED1/.test(pill) && /接反/.test(pill), 'on the pill while running', pill)
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}
// ---- B41: a cathode on an unfed rail ----
{
  const { ctx, page, errors } = await open()
  await openExample(page, 'blink')
  await store(page, "const l = m.useStore.getState().layout; m.useStore.getState().loadLayout({ ...l, wires: l.wires.filter((w) => w.id.toLowerCase() !== 'w6') })")
  await runUntil(page, 0.8)
  const p = await problems(page)
  const open1 = p.rows.find((r) => r.title === 'LED1 陰極沒接')
  check(
    !!open1 && open1.detail === 'LED1 的陰極（top-32）接到上方 − 電源軌，但這條電源軌沒有接到電源（PS1 負端），所以電流回不去。請用導線把上方 − 電源軌接到下方 − 電源軌，或直接接到 PS1 負端。',
    'the floating-rail message', open1?.detail ?? p.rows.map((r) => r.title),
  )
  check((open1?.holes.length ?? 0) > 20 && open1.holes.includes('top-0'), 'the whole rail is marked', open1?.holes.length)
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}
// ---- the MCU card's 未供電 reason = the board's power problem ----
{
  const { ctx, page, errors } = await open()
  await openExample(page, 'blink')
  await store(page, "const l = m.useStore.getState().layout; m.useStore.getState().loadLayout({ ...l, wires: l.wires.filter((w) => w.id.toLowerCase() !== 'w4') })") // U1 G → bot- removed: no ground reference
  await runUntil(page, 0.8)
  const p = await problems(page)
  await select(page, 'U1')
  const reason = await page.locator('.insp-reason').first().innerText().catch(() => '')
  const row = p.rows.find((r) => /U1/.test(r.title) && r.level === 'error')
  check(!!row && reason.trim() === row.detail.trim(), 'the 未供電 reason is the problem row’s own explanation, not a second wording', { reason, row: row?.detail })
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
