/**
 * UX fix LS-10 (P0) — replay of audit finding RV-04: a measured value is
 * never rounded to 「≈ 0」 when it is not zero.
 *
 *   UX_E2E_URL=http://localhost:5323/ node scripts/ux-e2e/lessons-LS-10.mjs
 *
 * In a fresh zh-TW profile (desktop workspace, 1440×900):
 *  1. the audit probe, in the app's own module graph: fmtMeasured('frequency',
 *     2 / 4 Hz, 450–550) and (8 Hz, 0.9–1.1 kHz) print the value, never
 *     「≈ 0 Hz」 / 「≈ 0 kHz」; a reversed LED's 7.6 pA still reads 「≈ 0 mA」;
 *  2. the real evaluator on a real simulation in the page: hal-blink's PA5
 *     (≈ 1 Hz) checked against 450–550 Hz reads 「量測值 0.99… Hz」;
 *  3. the real UI: lesson i3 with its solution and the documented mistake
 *     firmware lesson-i3-offby1 (the 「重現這個錯誤」 button) — 檢查我的電路
 *     shows 「量測值 492.7 Hz（預期 495 Hz – 505 Hz）」 on the PB12 row.
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
    await page.screenshot({ path: path.join(SHOTS, `LS-10-${name}.png`) })
  }
  await page.goto(`${URL}?e2e`, { timeout: 180_000 })
  await page.waitForFunction(() => !!window.__e2e, null, { timeout: 90_000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(800)

  // 1. the audit probe in the app's own modules
  const probe = await page.evaluate(async () => {
    const f = await import('/src/lessons/engine/format.ts')
    return {
      f2: f.fmtMeasured('frequency', 2, 450, 550),
      f4: f.fmtMeasured('frequency', 4, 450, 550),
      f8: f.fmtMeasured('frequency', 8, 900, 1100),
      i: f.fmtMeasured('current', 7.6e-12, 5e-3, 15e-3),
      range: f.fmtRange('frequency', 450, 550),
    }
  })
  console.log('  probe', JSON.stringify(probe))
  check(probe.f2 === '2.000 Hz' && probe.f4 === '4.000 Hz' && probe.f8 === '8.000 Hz', '2 / 4 / 8 Hz print as measured (never ≈ 0)')
  check(probe.i === '≈ 0 mA', 'a reversed LED’s leakage still reads 「≈ 0 mA」')

  // 2. the real evaluator, real simulation: ~1 Hz against 450–550 Hz
  const evaluated = await page.evaluate(async () => {
    const engine = await import('/src/lessons/engine/index.ts')
    const { lessonById } = await import('/src/lessons/index.ts')
    const i1 = lessonById('i1-gpio-output')
    const input = await engine.lessonCircuitInput(i1.solution)
    const [r] = await engine.runLessonChecks(
      input,
      [{ kind: 'measure', at: { component: 'U1', pin: 'PA5' }, quantity: 'frequency', min: 450, max: 550, seconds: 2.2 }],
      { worker: false },
    )
    return r.detail
  })
  console.log('  evaluated', evaluated)
  check(/量測值 0\.99\d Hz（預期 450 Hz – 550 Hz）/.test(evaluated) && !/≈/.test(evaluated), 'a real 1 Hz blink against 450–550 Hz prints 「量測值 0.99… Hz」')

  // 3. the real UI: i3 solution + the off-by-one mistake firmware → 檢查我的電路
  await page.locator('.ws-tabs').getByText('課程', { exact: true }).click()
  await page.locator('.lsn-card', { hasText: '計時器中斷' }).click()
  // operation simplification: the product chrome's one-tap 〔載入完整答案〕 (classic: 「顯示解答」)
  await page.locator('.lsn-actions').getByRole('button', { name: /^(顯示解答|載入完整答案)$/ }).click()
  await sleep(400)
  const confirm = page.locator('[role="dialog"]').getByRole('button', { name: '載入解答' })
  if (await confirm.count()) await confirm.first().click()
  await page.waitForFunction(() => String(window.__e2e.state().firmware?.U1?.name ?? '') === 'hal-tim-irq.elf', null, { timeout: 30_000 })
  const view = page.locator('.lsn-view')
  await view.getByRole('tab', { name: '常見錯誤' }).click()
  await view.getByRole('button', { name: /重現這個錯誤：載入 lesson-i3-offby1/ }).click()
  await page.waitForFunction(() => String(window.__e2e.state().firmware?.U1?.name ?? '') === 'lesson-i3-offby1.elf', null, { timeout: 30_000 })
  await view.getByRole('tab', { name: /驗收/ }).click()
  await view.locator('.lsn-acceptance').getByRole('button', { name: /檢查我的電路|再檢查一次/ }).click()
  await page.waitForFunction(() => document.querySelectorAll('.lsn-acceptance .lsn-check.is-pass, .lsn-acceptance .lsn-check.is-fail').length >= 5, null, {
    timeout: 120_000,
  })
  await sleep(500)
  const row = view.locator('.lsn-acceptance .lsn-check', { hasText: 'PB12 的頻率為 500 Hz' }).first()
  await row.scrollIntoViewIfNeeded()
  const rowText = (await row.innerText()).replace(/\s+/g, ' ')
  console.log('  row', rowText)
  check(/量測值 492\.\d Hz（預期 495 Hz – 505 Hz）/.test(rowText), 'the PB12 row reads 「量測值 492.7 Hz（預期 495 Hz – 505 Hz）」')
  const all = await view.locator('.lsn-acceptance').innerText()
  check(!/≈ 0 (k|M)?Hz/.test(all), 'no 「≈ 0 Hz」 anywhere in the results')
  await shot('01-i3-offby1-results')
  check(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`)
} catch (err) {
  failures.push(String(err))
  console.log('FAIL', err)
} finally {
  await browser.close()
}
console.log(failures.length === 0 ? 'LS-10: all assertions passed' : `LS-10: ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
