/**
 * UX fix SH-9 — replay of the audit task (docs/ux/UX_VERIFY.md V-09; findings
 * E2-01, COH-03, F-02, E2-09): after a MOUSE click on a panel button, Space,
 * F5, F10 and Shift+F5 still mean run / pause, halt / resume, step and
 * reset — the keys work wherever the focus is.
 *
 *   UX_E2E_URL=http://localhost:5321/ node scripts/ux-e2e/shell-SH-9.mjs
 *
 * Fresh profile, zh-TW, desktop workspace (1440×900, mouse). Opens the blink
 * example through the library (real clicks), selects U1 in 3D, then for each
 * of 「單步」 (MCU panel), 「自動」 (logic analyzer), a tray tab, 「重置 MCU」:
 * click it, then F5 ×2 (halt ↔ resume), F10 (one instruction while halted),
 * Shift+F5 (one reset) and Space (runs) — 5/5 per button. Then:
 *   - 「重置 MCU」 then Space → exactly ONE 「U1 重置」 separator and running;
 *   - paused, F10 → halted, PC moved, a handful of cycles (one instruction);
 *   - F5 never reloads the page (defaultPrevented);
 *   - a button reached with Tab activates on Space (native, kept);
 *   - lesson i1: 「下一步」 then Space → the step stays, the simulation runs.
 * State comes from the read-only `?e2e` hooks and the lab's own buffers.
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

let failures = 0
function check(cond, what, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${extra ? `  (${extra})` : ''}`)
  if (!cond) failures++
  return cond
}

async function until(fn, timeout = 8000, every = 80) {
  const t0 = Date.now()
  let v
  while (Date.now() - t0 < timeout) {
    v = await fn()
    if (v) return v
    await sleep(every)
  }
  return v
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.addInitScript(() => {
  if (sessionStorage.getItem('sh9.seeded')) return
  localStorage.clear()
  localStorage.setItem('bb.onboarded', '1')
  localStorage.setItem('bb.renderMode', 'performance')
  localStorage.setItem('bb.lang', 'zh-TW')
  localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: true }))
  sessionStorage.setItem('sh9.seeded', '1')
})
await page.goto(`${URL}?e2e&shotrig`)
await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig, null, { timeout: 120000 })
await page.evaluate(() => window.__e2e.ready())
await sleep(800)

const st = () => page.evaluate(() => window.__e2e.state())
const u1 = async () => (await st()).mcus?.U1 ?? null
const halted = async () => (await u1())?.state === 'halted'
const running = async () => (await st()).running === true
/** firmware loads / resets recorded for the terminal separators (the lab's own list) */
const resetMarks = () =>
  page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/state/lab.ts') ?? '/src/state/lab.ts'
    const m = await import(url)
    return m.labBuffers.terminalMarks().filter((x) => x.kind === 'reset' && x.componentId === 'U1').length
  })
const pressKey = async (k) => {
  await page.keyboard.press(k)
  await sleep(250)
}

// ---- the blink example, through the library ----
await page.getByRole('button', { name: '開啟範例' }).first().click()
await sleep(600)
await page.getByRole('button', { name: '開啟範例：Blue Pill 閃爍 LED（HAL）' }).click()
check(!!(await until(async () => (await st()).firmware?.U1, 15000)), 'blink opened with its firmware bound to U1')
await sleep(1200)
// select U1 with a real click on its body
const w = await page.evaluate(() => window.__e2e.componentWorld('U1', 1.0))
const p = await page.evaluate((v) => window.__shotRig.project(v.x, v.y, v.z), w)
await page.mouse.click(p.x, p.y)
check(!!(await until(() => page.getByRole('button', { name: '重置 MCU' }).first().isVisible())), 'U1 selected: the MCU panel is up')

// a bubble-phase / capture listener added AFTER the app's: did the app prevent F5's default (reload)?
await page.evaluate(() => {
  window.__f5Prevented = []
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5') window.__f5Prevented.push(e.defaultPrevented)
  }, true)
})

// run
await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
await pressKey('Space')
check(await until(running), 'Space on the 3D view runs the simulation')
await sleep(600)

/** F5 ×2, F10, Shift+F5, Space after a mouse click on `name` */
async function battery(name) {
  let ok = 0
  const h0 = await halted()
  await pressKey('F5')
  if (await until(async () => (await halted()) !== h0, 3000)) ok++
  else check(false, `${name}: F5 ${h0 ? 'resumes' : 'halts'}`)
  const h1 = await halted()
  await pressKey('F5')
  if (await until(async () => (await halted()) !== h1, 3000)) ok++
  else check(false, `${name}: second F5 ${h1 ? 'resumes' : 'halts'}`)
  if (!(await halted())) {
    await pressKey('F5')
    await until(halted, 3000)
  }
  const before = await u1()
  await pressKey('F10')
  const after = await until(async () => {
    const m = await u1()
    return m && m.cycles !== before?.cycles ? m : null
  }, 3000)
  if (after && after.state === 'halted' && after.pc !== before.pc) ok++
  else check(false, `${name}: F10 steps the halted core`, `pc ${before?.pc} → ${after?.pc}`)
  const r0 = await resetMarks()
  await pressKey('Shift+F5')
  if ((await until(async () => (await resetMarks()) === r0 + 1, 3000)) && (await resetMarks()) === r0 + 1) ok++
  else check(false, `${name}: Shift+F5 resets U1 once`)
  await pressKey('Space')
  if (await until(async () => (await running()) && !(await halted()), 3000)) ok++
  else check(false, `${name}: Space runs`)
  check(ok === 5, `after a mouse click on 「${name}」: F5, F5, F10, Shift+F5, Space`, `${ok}/5`)
  await sleep(400)
}

// 「單步」 (MCU panel): needs a halted core — 「■ 停住核心」 first, as the engineer did (E2-01)
await page.getByRole('button', { name: '■ 停住核心' }).click()
await until(halted, 3000)
const pcBefore = (await u1())?.pc
await page.getByRole('button', { name: '單步', exact: true }).click()
await until(async () => (await u1())?.pc !== pcBefore, 3000)
await battery('單步')

// 「自動」 (logic analyzer, the tray's front instrument for blink)
await page.locator('.ws-tray').getByRole('radio', { name: '邏輯分析儀' }).click()
await sleep(300)
await page.locator('.ws-tray').getByRole('button', { name: '自動', exact: true }).click()
await battery('自動')

// a tray tab
await page.locator('.ws-tray').getByRole('radio', { name: 'UART 終端機' }).click()
await battery('UART 終端機（儀器匣分頁）')

// 「重置 MCU」
await page.getByRole('button', { name: '重置 MCU' }).first().click()
await sleep(300)
await battery('重置 MCU')

// ---- COH-03: 重置 MCU then Space → one separator, running ----
await pressKey('Space') // pause
await until(async () => !(await running()), 3000)
const marks0 = await resetMarks()
await page.getByRole('button', { name: '重置 MCU' }).first().click()
await sleep(300)
await pressKey('Space')
await sleep(800)
const marks1 = await resetMarks()
check(marks1 === marks0 + 1, '重置 MCU then Space: exactly one 「U1 重置」 separator', `${marks1 - marks0}`)
check(await running(), '重置 MCU then Space: the simulation runs')

// ---- E2-09: paused (not halted) → F10 halts and steps one instruction ----
await pressKey('Space')
await until(async () => !(await running()), 3000)
await sleep(300)
const m0 = await u1()
await pressKey('F10')
const m1 = await until(async () => {
  const m = await u1()
  return m && m.state === 'halted' && m.cycles !== m0.cycles ? m : null
}, 3000)
check(!!m1 && m1.pc !== m0.pc, 'paused, F10 → the core halts and the PC advances', m1 ? `0x${m0.pc.toString(16)} → 0x${m1.pc.toString(16)}` : 'no step')
check(!!m1 && m1.cycles - m0.cycles > 0 && m1.cycles - m0.cycles <= 40, 'paused, F10 → one instruction (a handful of cycles)', m1 ? `${m1.cycles - m0.cycles} cycles` : '')
const toast = await page.$$eval('.lg-toast', (els) => els.map((e) => e.textContent).join(' | '))
check(toast.includes('已停住 U1 核心並單步一道指令'), 'the step says so: 「已停住 U1 核心並單步一道指令——F5 繼續」', toast)
await pressKey('F5')
check(await until(async () => (await running()) && !(await halted()), 3000), 'F5 resumes')

const prevented = await page.evaluate(() => window.__f5Prevented)
check(prevented.length > 0 && prevented.every(Boolean), 'F5 never reaches the browser (no reload)', `${prevented.length} presses`)

// ---- a keyboard user keeps native activation: Tab to 「重置 MCU」, Space presses it ----
const runningBefore = await running()
await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
let reached = false
for (let i = 0; i < 160 && !reached; i++) {
  await page.keyboard.press('Tab')
  reached = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim() === '重置 MCU')
}
check(reached, 'Tab reaches 「重置 MCU」')
const r0 = await resetMarks()
await pressKey('Space')
await sleep(400)
check((await resetMarks()) === r0 + 1, 'Space on the Tab-focused 「重置 MCU」 presses it (native activation)')
check((await running()) === runningBefore, '… and does not toggle run / pause')

// ---- F-02: lesson coach 「下一步」 then Space ----
await page.locator('.lg-dock').getByText('課程').click()
await sleep(600)
await page.getByRole('button', { name: /中級 1 · STM32 GPIO/ }).click()
await sleep(600)
await page.getByRole('button', { name: '開始引導' }).click()
await until(() => page.locator('.lsn-coach').isVisible(), 8000)
await sleep(1500)
if (await running()) {
  await pressKey('Space')
  await until(async () => !(await running()), 3000)
}
const stepText = () => page.$eval('.lsn-coach', (e) => (/步驟 (\d+)\/(\d+)/.exec(e.innerText) ?? [])[1] ?? null)
await page.locator('.lsn-coach').getByRole('button', { name: '下一步' }).click()
await sleep(500)
const s0 = await stepText()
await pressKey('Space')
await sleep(600)
check((await stepText()) === s0, 'coach 「下一步」 then Space: the step stays', `step ${s0} → ${await stepText()}`)
check(await until(running, 3000), 'coach 「下一步」 then Space: the simulation runs')

check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' / '))
await browser.close()
console.log(failures === 0 ? 'SH-9: all checks passed' : `SH-9: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
