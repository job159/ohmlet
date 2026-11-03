/**
 * UX fix IN-15 — replay of the audit task (docs/ux/UX_VERIFY.md V-03;
 * findings RV-01, COH-02, F-14, TR-08): the live rules know the MCU's state.
 *
 *   UX_E2E_URL=http://localhost:5324/ node scripts/ux-e2e/inspector-IN-15.mjs
 *
 *  - hal-blink runs 1.2 s, pause, 重置 MCU (the inspector button): no
 *    gpio-mode problem; re-flashing bare-blink while paused: none either;
 *    a firmware that really leaves PA5 an input is still reported
 *  - BOOT0 = 1 + reset: only 「U1 從系統記憶體開機（未模擬）」, with its one
 *    consequence folded under 「連帶影響（先解決：U1 從系統記憶體開機）」
 *  - lesson i1 + lesson-i1-noclk: the message names IOPAEN, not the pin
 *  - lesson i4 + lesson-i4-nomoe: the pill shows 「TIM1 的輸出被關閉（MOE = 0）——PA8 沒有 PWM」
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

const gpioMode = (p) => p.rows.filter((r) => r.id.startsWith('erc:gpio-mode'))
// ---- reset / re-flash while paused ----
{
  const { ctx, page, errors } = await open()
  await openExample(page, 'blink')
  await runUntil(page, 1.2)
  await pause(page)
  await select(page, 'U1')
  await page.getByRole('button', { name: /重置 MCU/ }).first().click()
  const p = await problems(page)
  check(gpioMode(p).length === 0, '重置 MCU while paused: no 「不是輸出」 blame', p.rows.map((r) => r.title))
  check(!/不是輸出/.test(await pillText(page)), 'the pill does not blame the firmware')
  await bindFirmware(page, 'U1', 'bare-blink')
  const p2 = await problems(page)
  check(gpioMode(p2).length === 0, 're-flash bare-blink while paused: no blame', p2.rows.map((r) => r.title))
  await bindFirmware(page, 'U1', 'hal-uart-hello')
  const t0 = await store(page, 'return m.useStore.getState().simTime')
  await runUntil(page, t0 + 1.0)
  const p3 = await problems(page)
  check(gpioMode(p3).length === 1, 'a firmware that really leaves PA5 an input is reported after it ran', p3.rows.map((r) => r.title))
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}
// ---- BOOT0 = 1 ----
{
  const { ctx, page, errors } = await open()
  await openExample(page, 'blink')
  await runUntil(page, 1.0)
  await store(page, "m.useStore.getState().setParam('U1', 'boot0', '1')")
  await select(page, 'U1')
  await page.getByRole('button', { name: /重置 MCU/ }).first().click()
  const t0 = await store(page, 'return m.useStore.getState().simTime')
  await runUntil(page, t0 + 1.2)
  const p = await problems(page)
  const warn = p.rows.filter((r) => r.level !== 'info')
  check(warn.length === 1 && warn[0].title === 'U1 從系統記憶體開機（未模擬）', 'only the BOOT0 row', p.rows.map((r) => r.title))
  check(warn[0]?.folded?.head === '連帶影響（先解決：U1 從系統記憶體開機）' && warn[0].folded.items.length === 1, 'with one folded consequence', warn[0]?.folded)
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}
// ---- i1 noclk ----
{
  const { ctx, page, errors } = await open()
  check(await lessonCircuit(page, 'i1-gpio-output'), 'i1 solution circuit')
  await sleep(1200)
  check((await bindFirmware(page, 'U1', 'lesson-i1-noclk')) === null, 'lesson-i1-noclk loaded')
  await runUntil(page, 1.6)
  const p = await problems(page)
  const clk = p.rows.find((r) => /IOPAEN/.test(r.detail))
  check(!!clk && clk.detail.includes('韌體寫入 GPIOA 時，GPIOA 的時脈沒有打開（RCC_APB2ENR.IOPAEN = 0），寫入被忽略，所以 PA5 一直是浮接輸入。請先呼叫 __HAL_RCC_GPIOA_CLK_ENABLE()。'), 'the message names IOPAEN', p.rows.map((r) => r.detail.slice(0, 60)))
  check(!p.rows.some((r) => /不是輸出/.test(r.title)), 'no pin-choice blame')
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}
// ---- i4 nomoe ----
{
  const { ctx, page, errors } = await open()
  check(await lessonCircuit(page, 'i4-pwm'), 'i4 solution circuit')
  await sleep(1200)
  check((await bindFirmware(page, 'U1', 'lesson-i4-nomoe')) === null, 'lesson-i4-nomoe loaded')
  await runUntil(page, 1.0)
  await problems(page)
  const pill = await pillText(page)
  check(/TIM1 的輸出被關閉（MOE = 0）——PA8 沒有 PWM/.test(pill), 'the pill: 「TIM1 的輸出被關閉（MOE = 0）——PA8 沒有 PWM」', pill)
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
