/**
 * UX fix IN-13 — replay of the audit task (docs/ux/UX_VERIFY.md V-04;
 * findings COH-01, F-07, N2, RV-06, AN2-19, E2-11): one fact, one row, one
 * wording.
 *
 *   UX_E2E_URL=http://localhost:5324/ node scripts/ux-e2e/inspector-IN-13.mjs
 *
 *  - blink without firmware, running: exactly one row 「U1 還沒有韌體」〔載入韌體…〕
 *    in the problems panel and on the phone; the pill has no 「另 1 個」; the
 *    row's 〔載入韌體…〕 opens the built-in firmware picker on U1; the U1 header
 *    shows the same row — since release QA IN-F3 (bf340c5: a board state is
 *    explained once, in its 執行狀態 card) as its title + 〔見下方執行狀態〕,
 *    which focuses #exec-U1, where the row's own sentence is, with the
 *    firmware row holding the row's action (〔選擇內建韌體〕 / 〔從電腦選擇檔案…〕);
 *    the state chip says 「還沒有韌體」 and the firmware row
 *    「U1 還沒有韌體——請選一個內建韌體或從電腦載入」
 *  - an LED straight on PA5 (R1 bridged): one row 「LED1 沒有限流電阻」 with
 *    「1 個原因 · 影響 2 處」 (no 「U1 PA5」 / 「超過 25 mA」 twins) — the blink
 *    example's LED is LED1 since bf340c5 (the LED<n> designator, as the
 *    example's own text and the lessons name it)
 *  - an LED straight across the supply: one burned row
 * Boots with `autorun=0`: the replay drives run / pause itself (round 5 auto-run off).
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
  // autorun=0 (round 5): this replay runs / pauses the simulation itself (store startSim /
  // stopSim) and reads the states in between; auto-run would start or resume it on its own
  await page.goto(`${URL}${URL.includes('?') ? '&' : '?'}autorun=0`, { timeout: 180000 })
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

// ---- blink without firmware ----
{
  const { ctx, page, errors } = await open()
  await openExample(page, 'blink')
  await mod(page, '/src/state/lab.ts', "m.useLab.getState().clearFirmware('U1')")
  await runUntil(page, 0.6)
  const p = await problems(page)
  const fw = p.rows.filter((r) => /韌體/.test(r.title))
  check(fw.length === 1 && fw[0].title === 'U1 還沒有韌體' && fw[0].action === '載入韌體…', 'one row 「U1 還沒有韌體」〔載入韌體…〕', p.rows.map((r) => r.title))
  const pill = await pillText(page)
  check(/U1 還沒有韌體/.test(pill) && !/另 \d+ 個/.test(pill), 'the pill names it once, no 「另 1 個」', pill)
  // the problems panel row's own 〔載入韌體…〕 (nothing selected: the full list) opens the built-in
  // firmware picker on U1's firmware row
  await page.locator('#ws-problems').getByRole('button', { name: '載入韌體…' }).first().click()
  const picker = await page.waitForSelector('.insp-fwp', { timeout: 5000 }).then(() => true).catch(() => false)
  const shown = await store(page, 'return m.useStore.getState().selection')
  check(picker && JSON.stringify(shown) === '["U1"]', 'the panel row’s 〔載入韌體…〕 selects U1 and opens the built-in firmware picker', { picker, shown })
  await page.keyboard.press('Escape')
  await sleep(400)
  await select(page, 'U1')
  const insp = await inspectorText(page)
  // the header's problem card: the same row (its title, once) and the way to its action —
  // 〔見下方執行狀態〕 (release QA IN-F3), which brings the 執行狀態 card into view and focuses it
  const card = page.locator('.ws-right .insp-part-problems').first()
  const cardRows = await card.locator('.erc-finding').evaluateAll((els) => els.map((e) => ({ title: e.querySelector('.erc-title')?.textContent ?? '', buttons: [...e.querySelectorAll('button')].map((b) => b.textContent) })))
  check(
    cardRows.length === 1 && cardRows[0].title === 'U1 還沒有韌體' && cardRows[0].buttons.join() === '見下方執行狀態',
    'the U1 header shows the same row 「U1 還沒有韌體」〔見下方執行狀態〕', cardRows,
  )
  await card.getByRole('button', { name: '見下方執行狀態' }).click()
  await sleep(600)
  const focused = await page.evaluate(() => document.activeElement?.id ?? '')
  check(focused === 'exec-U1', '〔見下方執行狀態〕 focuses the 執行狀態 card (#exec-U1)', focused)
  const exec = (await page.locator('#exec-U1 .insp-reason').first().innerText().catch(() => '')).trim()
  const row = fw[0]
  check(exec.length > 20 && !!row && row.detail.startsWith(exec), 'the 執行狀態 card explains it in the row’s own words', { exec, row: row?.detail })
  // the 執行狀態 card's firmware row (McuPanel FirmwareSummary): the two ways of 〔載入韌體…〕
  const fwRow = page.locator('.ws-right .insp-fw-summary').first()
  const fwButtons = await fwRow.locator('button').evaluateAll((els) => els.filter((b) => !b.disabled).map((b) => b.textContent.trim()))
  check(fwButtons.includes('選擇內建韌體') && fwButtons.includes('從電腦選擇檔案…'), 'the row’s action is right there: the firmware row’s 〔選擇內建韌體〕 / 〔從電腦選擇檔案…〕', fwButtons)
  check((insp.match(/U1 還沒有韌體(?!—)/g) ?? []).length === 1, 'the title once in the U1 inspector (not a second row in its problems list)', insp.match(/.*U1 還沒有韌體.*/g))
  check(!/未載入韌體/.test(insp), 'no other wording (「未載入韌體」) in the U1 inspector')
  check(/還沒有韌體/.test(insp) && /U1 還沒有韌體——請選一個內建韌體或從電腦載入/.test(insp), 'state chip and firmware card use the same words')
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}
// ---- the phone ----
{
  const { ctx, page, errors } = await open({ phone: true, workspace: false })
  await openExample(page, 'blink')
  await mod(page, '/src/state/lab.ts', "m.useLab.getState().clearFirmware('U1')")
  await runUntil(page, 0.6)
  const p = await problems(page)
  check(p.rows.filter((r) => /韌體/.test(r.title)).length === 1, 'phone: one firmware row', p.rows.map((r) => r.title))
  check(errors.length === 0, 'phone: no page errors', errors.slice(0, 2))
  await ctx.close()
}
// ---- an LED straight on PA5 ----
{
  const { ctx, page, errors } = await open()
  await openExample(page, 'blink')
  await store(page, "m.useStore.getState().addWire('c36', 'c40')") // bridges R1: the LED hangs on PA5 directly
  await runUntil(page, 1.5)
  const p = await problems(page)
  const nores = p.rows.filter((r) => /限流電阻/.test(r.title))
  check(nores.length === 1 && nores[0].title === 'LED1 沒有限流電阻' && nores[0].affects === 2, 'one row 「LED1 沒有限流電阻」 affecting 2 places', p.rows.map((r) => [r.title, r.affects]))
  check(!p.rows.some((r) => /^U1 PA5/.test(r.title) || /超過 25 mA/.test(r.title)), 'no 「U1 PA5」 / 「超過 25 mA」 twin rows', p.rows.map((r) => r.title))
  const panel = await page.locator('#ws-problems').innerText().catch(() => '')
  check(/1 個原因 · 影響 2 處/.test(panel), 'the panel says 「1 個原因 · 影響 2 處」')
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}
// ---- a burned LED ----
{
  const { ctx, page, errors } = await open()
  await loadLayout(page, {
    version: 1,
    components: [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }, { id: 'LED1', type: 'led', holes: ['top+20', 'top-20'] }],
    wires: [
      { id: 'W1', from: 'PS1:+', to: 'top+0', color: 'red' },
      { id: 'W2', from: 'PS1:-', to: 'top-0', color: 'black' },
    ],
  })
  await runUntil(page, 0.4)
  const p = await problems(page)
  const burned = p.rows.filter((r) => /燒毀/.test(r.title))
  check(burned.length === 1 && burned[0].fact === 'burned:LED1', 'one burned row', p.rows.map((r) => r.title))
  check(!p.rows.some((r) => /2A|> 2 A（可能短路）/.test(r.title)), 'no 「> 2A」 twin of the supply', p.rows.map((r) => r.title))
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
