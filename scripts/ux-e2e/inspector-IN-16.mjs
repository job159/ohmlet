/**
 * UX fix IN-16 — replay of the audit task (docs/ux/UX_VERIFY.md V-11;
 * findings AN2-02, N7): transient and run-dependent findings are reported
 * honestly.
 *
 *   UX_E2E_URL=http://localhost:5324/ node scripts/ux-e2e/inspector-IN-16.mjs
 *
 *  - spi-595 at 2 s of simulated time: no 74HC595 floating row in the pill
 *    or the panel — they sit under 「已由即時讀數排除」 with
 *    「開機時 U2 SRCLK 短暫浮接（MCU 重置期間腳位為高阻抗），之後已被 PA5 驅動。」
 *  - opening button-exti: a neutral pill (no amber 「U1 PB12 輸入浮接」) and
 *    one row under 「執行後確認」; after ▶ it moves to 已由即時讀數排除
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

// ---- spi-595 ----
{
  const { ctx, page, errors } = await open()
  await openExample(page, 'spi-595')
  await runUntil(page, 2.0)
  const p = await problems(page, 3000)
  check(!p.rows.some((r) => /74HC595|浮接/.test(r.title)), 'no 74HC595 floating row in the panel', p.rows.map((r) => r.title))
  check(!/浮接/.test(await pillText(page)), 'nor in the pill')
  const note = p.resolved.find((r) => /SRCLK/.test(r.title))?.note ?? ''
  check(/^開機時 U2 SRCLK 短暫浮接（MCU 重置期間腳位為高阻抗），之後已被 PA5 驅動。$/.test(note), 'listed under 已由即時讀數排除 with what happened', note)
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}
// ---- button-exti ----
{
  const { ctx, page, errors } = await open()
  await openExample(page, 'button-exti')
  const p = await problems(page)
  const pending = p.rows.filter((r) => r.pending)
  check(pending.length === 1 && pending[0].level === 'info' && p.counts.warning === 0 && p.counts.error === 0, 'one 「執行後確認」 row, nothing amber', p.rows.map((r) => [r.title, r.level]))
  const pill = await pillText(page)
  check(!/浮接/.test(pill), 'the pill is neutral', pill)
  const panel = await page.locator('#ws-problems').innerText().catch(() => '')
  check(/執行後確認（1）/.test(panel), 'the panel groups it under 「執行後確認（1）」')
  await runUntil(page, 1.2)
  const p2 = await problems(page)
  check(!p2.rows.some((r) => r.pending || /浮接/.test(r.title)) && p2.resolved.some((r) => /PB12/.test(r.title)), 'after ▶ it moves to 已由即時讀數排除', { rows: p2.rows.map((r) => r.title), resolved: p2.resolved.map((r) => r.title) })
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
