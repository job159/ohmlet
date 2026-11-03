/**
 * UX fix LS-8 (P0) — replay of audit task F-03 / TR-07 / N1: 「已載入」 is not
 * 「執行中」.
 *
 *   UX_E2E_URL=http://localhost:5323/ node scripts/ux-e2e/lessons-LS-8.mjs
 *
 * A fresh zh-TW profile with the desktop workspace (1440×900) opens lesson
 * i1, loads its starting circuit, walks the coach to step 3 and presses its
 * one-click 「載入 hal-blink 到 U1」 — with the simulation idle. Then:
 *   - no visible text outside the run capsule says 「正在執行」 or 「執行中」;
 *   - the coach's check reads 「U1 已載入 hal-blink」 and its detail tells
 *     the learner to press ▶ 執行模擬;
 *   - the Wiring section's firmware pill reads 「✓ 已載入 · 尚未執行」, and
 *     after ▶ 執行模擬 「✓ 已載入 · 執行中」 (the hint after the check is gone).
 * The page boots with `autorun=0` (round 5): the product runs every circuit
 * by itself, so the idle wording this replay pins (it still shows after a
 * paused simulation is reset) needs auto-run off; the firmware load then
 * leaves the simulation idle as before.
 * Exit code 1 on any failed assertion. UX_E2E_SHOTS=<dir> saves screenshots.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const SHOTS = process.env.UX_E2E_SHOTS ?? null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

const browser = await chromium.launch({ channel: process.env.UX_E2E_CHANNEL ?? 'msedge', headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'zh-TW' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(() => {
    if (sessionStorage.getItem('ux.seeded')) return
    localStorage.clear()
    localStorage.setItem('bb.onboarded', '1')
    localStorage.setItem('bb.renderMode', 'performance')
    localStorage.setItem('bb.lang', 'zh-TW')
    localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: true }))
    sessionStorage.setItem('ux.seeded', '1')
  })
  const shot = async (name) => {
    if (!SHOTS) return
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS, `LS-8-${name}.png`) })
  }
  // autorun=0: the idle state under test (auto-run would start the lesson circuit at once)
  await page.goto(`${URL}?e2e&autorun=0`, { timeout: 180_000 })
  await page.waitForFunction(() => !!window.__e2e, null, { timeout: 90_000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(800)

  // 課程 → i1 → 載入起始電路
  await page.locator('.ws-tabs').getByText('課程', { exact: true }).click()
  await page.locator('.lsn-card', { hasText: 'STM32 GPIO 輸出' }).click()
  await page.locator('.lsn-actions').getByRole('button', { name: /載入起始電路/ }).click()
  await sleep(500)
  const confirm = page.locator('[role="dialog"]').getByRole('button', { name: '載入起始電路' })
  if (await confirm.count()) await confirm.first().click()
  const coach = page.locator('.lsn-coach')
  await coach.waitFor({ state: 'visible', timeout: 20_000 })
  await sleep(1200)
  // step 1 → 3
  for (let i = 0; i < 2; i++) {
    await coach.getByRole('button', { name: '下一步' }).click()
    await sleep(400)
  }
  check((await coach.innerText()).includes('步驟 3/'), 'the coach shows step 3')
  await coach.getByRole('button', { name: /載入 hal-blink 到 U1/ }).click()
  // the step check runs on the live circuit right after the load
  await page.waitForFunction(() => /U1 已載入 hal-blink/.test(document.querySelector('.lsn-coach')?.textContent ?? ''), null, { timeout: 30_000 })
  await page.waitForFunction(() => !!document.querySelector('.lsn-coach .lsn-check.is-pass'), null, { timeout: 60_000 })
  await sleep(600)
  await shot('01-loaded-idle')

  const st = await page.evaluate(() => window.__e2e.state())
  check(st.running === false, 'the simulation is still idle after the firmware load')
  check(String(st.firmware?.U1?.name ?? '') === 'hal-blink.elf', 'hal-blink.elf is bound to U1')

  // nothing outside the capsule says it runs
  const leaks = await page.evaluate(() => {
    const out = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || el.closest('.app-run-capsule')) continue
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || el.getClientRects().length === 0) continue
      if (/正在執行|執行中/.test(n.textContent ?? '')) out.push(n.textContent.trim().slice(0, 80))
    }
    for (const el of document.querySelectorAll('[aria-label],[title]')) {
      if (el.closest('.app-run-capsule')) continue
      for (const a of ['aria-label', 'title']) {
        const v = el.getAttribute(a)
        if (v && /正在執行|執行中/.test(v)) out.push(`${a}: ${v.slice(0, 80)}`)
      }
    }
    return out
  })
  check(leaks.length === 0, `no 「正在執行／執行中」 outside the capsule while idle ${leaks.length ? JSON.stringify(leaks) : ''}`)

  const coachText = (await coach.innerText()).replace(/\s+/g, ' ')
  check(coachText.includes('U1 已載入 hal-blink'), 'the coach check reads 「U1 已載入 hal-blink」')
  check(coachText.includes('按 ▶ 執行模擬後開始執行'), 'the check detail says to press ▶ 執行模擬')

  // the Wiring section's firmware pill
  const view = page.locator('.lsn-view')
  await view.getByRole('tab', { name: '接線' }).click()
  await sleep(300)
  const pill = view.locator('.lsn-fw-pill', { hasText: 'hal-blink' })
  const idleText = (await pill.innerText()).replace(/\s+/g, ' ')
  check(/已載入 · 尚未執行/.test(idleText), `the firmware pill reads 「✓ 已載入 · 尚未執行」 (${idleText})`)
  await shot('02-wiring-pill-idle')

  // ▶ 執行模擬
  await page.locator('.app-run-capsule').click()
  await page.waitForFunction(() => window.__e2e.state().running === true, null, { timeout: 20_000 })
  await sleep(1200)
  const runText = (await pill.innerText()).replace(/\s+/g, ' ')
  check(/已載入 · 執行中/.test(runText), `after ▶ the pill reads 「✓ 已載入 · 執行中」 (${runText})`)
  const coachRun = (await coach.innerText()).replace(/\s+/g, ' ')
  check(!coachRun.includes('按 ▶ 執行模擬後開始執行'), 'the 「按 ▶ 執行模擬」 hint is gone once it runs')
  await shot('03-running')
  check(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`)
} catch (err) {
  failures.push(String(err))
  console.log('FAIL', err)
} finally {
  await browser.close()
}
console.log(failures.length === 0 ? 'LS-8: all assertions passed' : `LS-8: ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
