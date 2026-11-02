/**
 * Keep-pressed latch 「保持按下」 — replay of the product owner's request
 * 「按鍵可以保持按下，這個也要做進去」 (src/ui/embedded/latch.ts).
 *
 *   UX_E2E_URL=http://localhost:5415/ node scripts/ux-e2e/latch-keep-pressed.mjs
 *
 * The button-exti example (SW1 on PB12 with the internal pull-up, EXTI
 * falling edge + 20 ms debounce, 「press n」 on USART1), zh-TW:
 *  - desktop 1440×900 (the workspace): select SW1 → the inspector shows the
 *    「保持按下」 switch beside 按住; turning it on keeps the button pressed —
 *    the firmware sees it (PB12 held low, 「press 1」 once, no repeats) and the
 *    footer says 「SW1 保持按下中」; turning it off releases (PB12 high again);
 *  - a DOUBLE-CLICK on SW1 in 3D keeps it pressed (the switch turns on, the
 *    hover chip says 「已保持按下 · 按一下放開」, PB12 low); one click in 3D
 *    lets it go; a double-click again, then 重置模擬 releases it (and a run
 *    afterwards boots with PB12 high, no press);
 *  - the latch never reaches a saved project (exportJson / autosave);
 *  - phone 390×844: the Properties sheet's 「保持按下」 switch latches, the
 *    按住 puck and the switch fit side by side;
 *  - the English classic chrome keeps the original inspector (no switch)
 *    and a double-click there stays momentary.
 * Screenshots go to $UX_E2E_SHOTS (default: the OS temp dir). Exit code 1
 * on any failed check.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright')
const BASE = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const URL = `${BASE}${BASE.includes('?') ? '&' : '?'}e2e&shotrig`
const CHANNEL = process.env.UX_E2E_CHANNEL ?? 'msedge'
const SHOTS = process.env.UX_E2E_SHOTS ?? path.join(os.tmpdir(), 'latch-e2e')
fs.mkdirSync(SHOTS, { recursive: true })
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

async function open({ lang = 'zh-TW', workspace = true, phone = false } = {}) {
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
      if (sessionStorage.getItem('latch.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', lang)
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      localStorage.setItem('bb.layout', layout)
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      sessionStorage.setItem('latch.seeded', '1')
    },
    [lang, workspace, JSON.stringify(EMPTY)],
  )
  await page.goto(URL, { timeout: 180000 })
  await page.waitForSelector('canvas', { timeout: 90000 })
  await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig, null, { timeout: 90000 })
  await sleep(1500)
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
const latch = (page, src, arg) => mod(page, '/src/ui/embedded/latch.ts', src, arg)
const pressedParam = (page) => store(page, "return m.useStore.getState().layout.components.find((c) => c.id === 'SW1')?.params?.pressed ?? null")
const isLatched = (page) => latch(page, "return m.isLatched('SW1')")
const simNow = (page) => store(page, 'return m.useStore.getState().simTime')
const pb12 = (page) => page.evaluate(() => window.__e2e.component('U1')?.pinVoltages?.PB12 ?? null)
const uart = (page) => page.evaluate(() => window.__e2e.uart('U1', 'USART1'))
const presses = async (page) => ((await uart(page)).match(/press \d+/g) ?? []).length

async function openExample(page, id) {
  const r = await mod(page, '/src/ui/workspace/examples.ts', `return await m.openExampleById(${JSON.stringify(id)})`)
  await sleep(1500)
  return r
}
async function runFor(page, seconds, maxMs = 90000) {
  await store(page, 'm.useStore.getState().startSim()')
  const t0 = await simNow(page)
  const w0 = Date.now()
  while (Date.now() - w0 < maxMs) {
    await sleep(200)
    if ((await simNow(page)) >= t0 + seconds) break
  }
  return simNow(page)
}
async function until(page, fn, maxMs = 15000) {
  const w0 = Date.now()
  while (Date.now() - w0 < maxMs) {
    const v = await fn()
    if (v) return v
    await sleep(100)
  }
  return null
}
const select = async (page, id) => {
  await store(page, `m.useStore.getState().select(${JSON.stringify(id)})`)
  await sleep(700)
}
/** Aim the camera nearly overhead at SW1 and return its screen point (the canvas must be on top there). */
async function aimSW1(page) {
  const w = await page.evaluate(() => window.__e2e.componentWorld('SW1', 1.0))
  const d = 12
  await page.evaluate((v) => window.__shotRig.setCamera(v.x + 0.12 * v.d, v.y + 1.25 * v.d, v.z + 0.22 * v.d, v.x, v.y, v.z), { ...w, d })
  await sleep(300)
  const p = await page.evaluate((v) => window.__shotRig.project(v.x, v.y, v.z), w)
  const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName ?? null, [p.x, p.y])
  check(top === 'CANVAS', 'SW1 is clickable on the canvas', top)
  await page.mouse.move(p.x - 3, p.y - 3)
  await page.mouse.move(p.x, p.y, { steps: 3 })
  await sleep(120)
  return p
}
const toggle = (page, scope) => page.locator(`${scope} [role="switch"].latch-toggle`).first()
/** Two boxes read in the same frame, once two reads 100 ms apart agree (≤ 4 s). */
async function settledBoxes(page, aSel, bSel) {
  const read = () =>
    page.evaluate(([a, b]) => {
      const box = (sel) => {
        const r = document.querySelector(sel)?.getBoundingClientRect()
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
      }
      return { hb: box(a), tb: box(b) }
    }, [aSel, bSel])
  let prev = await read()
  for (let i = 0; i < 40; i++) {
    await sleep(100)
    const cur = await read()
    if (JSON.stringify(cur) === JSON.stringify(prev)) return cur
    prev = cur
  }
  return prev
}

// ---------------------------------------------------------------- desktop
{
  const { ctx, page, errors } = await open()
  check((await openExample(page, 'button-exti')).ok === true, 'desktop: button-exti opened')
  await runFor(page, 0.3)
  check((await pb12(page)) > 2.5, 'desktop: PB12 idles high (internal pull-up)', String(await pb12(page)))
  check((await presses(page)) === 0, 'desktop: no press at boot')
  await select(page, 'SW1')
  const panel = '.ws-right'
  const sw = toggle(page, panel)
  check((await sw.count()) === 1, 'desktop: the inspector shows the 保持按下 switch')
  check((await sw.innerText()).trim() === '保持按下', 'desktop: it reads 「保持按下」', await sw.innerText())
  check((await sw.getAttribute('aria-checked')) === 'false', 'desktop: off at first')
  const hold = page.locator(`${panel} .prs-hold`).first()
  // both boxes in one frame, once the inspector's layout has settled (the panel content
  // animates in; two separate reads on a loaded machine could straddle that)
  const { hb, tb } = await settledBoxes(page, `${panel} .prs-hold`, `${panel} [role="switch"].latch-toggle`)
  check(!!hb && !!tb && Math.abs(hb.y + hb.height / 2 - (tb.y + tb.height / 2)) < 8 && tb.x > hb.x + hb.width, 'desktop: the switch sits beside the 按住 puck', { hb, tb })
  let text = (await page.locator(panel).innerText()).replace(/\s+/g, ' ')
  check(text.includes('打開「保持按下」就會一直按著'), 'desktop: the footer says what the switch does')
  await page.screenshot({ path: path.join(SHOTS, 'desktop-1-off.png') })

  // ---- latch through the inspector
  await sw.click()
  await sleep(300)
  check((await sw.getAttribute('aria-checked')) === 'true', 'desktop: the switch is on')
  check((await pressedParam(page)) === true && (await isLatched(page)) === true, 'desktop: SW1 is kept pressed (runtime pressed param)')
  text = (await page.locator(panel).innerText()).replace(/\s+/g, ' ')
  check(text.includes('SW1 保持按下中'), 'desktop: the footer says 「SW1 保持按下中」')
  check((await hold.innerText()).trim() === '已按下', 'desktop: the 按住 puck shows 已按下')
  await runFor(page, 0.4)
  check((await pb12(page)) < 0.5, 'desktop: the firmware sees a held button (PB12 low)', String(await pb12(page)))
  check(await page.evaluate(() => window.__e2e.component('SW1')?.pressed === true), 'desktop: the simulation reports SW1 pressed')
  check((await presses(page)) === 1, 'desktop: 「press 1」 once (held, no repeats)', await uart(page))
  await runFor(page, 0.3)
  check((await presses(page)) === 1 && (await pb12(page)) < 0.5, 'desktop: still held, still one press')
  const saved = await store(page, 'return m.useStore.getState().exportJson()')
  check(!saved.includes('"pressed"'), 'desktop: the latch is not in the saved project')
  await sleep(1200) // autosave debounce
  check(!(await page.evaluate(() => localStorage.getItem('bb.layout') ?? '')).includes('"pressed":true'), 'desktop: nor in the autosave')
  await aimSW1(page)
  await page.mouse.move(5, 450) // the badge without the hover chip over it
  await sleep(300)
  await page.screenshot({ path: path.join(SHOTS, 'desktop-2-latched-inspector.png') })

  // ---- turn it off
  await sw.click()
  await sleep(300)
  check((await sw.getAttribute('aria-checked')) === 'false' && (await pressedParam(page)) === false, 'desktop: turning it off releases SW1')
  await runFor(page, 0.2)
  check((await pb12(page)) > 2.5, 'desktop: PB12 high again', String(await pb12(page)))

  // ---- double-click in 3D
  const p = await aimSW1(page)
  const before = await presses(page)
  await page.mouse.dblclick(p.x, p.y)
  await sleep(500)
  check((await isLatched(page)) === true, 'desktop: a double-click on SW1 keeps it pressed')
  check((await store(page, 'return m.useStore.getState().selection')).join() === 'SW1', 'desktop: …and selects it')
  check((await sw.getAttribute('aria-checked')) === 'true', 'desktop: the inspector switch turned on with it')
  const chip = await mod(page, '/src/ui/workspace/hole-chip.ts', "return m.objectChipText('SW1')")
  check(/已保持按下 · 按一下放開$/.test(chip), 'desktop: the hover chip says 「已保持按下 · 按一下放開」', chip)
  await page.screenshot({ path: path.join(SHOTS, 'desktop-3-dblclick-chip.png') })
  await runFor(page, 0.3)
  check((await pb12(page)) < 0.5, 'desktop: the firmware sees it held (PB12 low)', String(await pb12(page)))
  check((await presses(page)) > before, 'desktop: …and counted the press', await uart(page))
  await page.mouse.move(5, 450)
  await sleep(300)
  await page.screenshot({ path: path.join(SHOTS, 'desktop-4-latched-badge.png') })

  // ---- one click lets it go
  await sleep(600) // past the double-click window
  const q = await aimSW1(page)
  await page.mouse.click(q.x, q.y)
  check(!!(await until(page, async () => (await pressedParam(page)) === false)), 'desktop: one click on a kept-pressed SW1 releases it')
  check((await isLatched(page)) === false && (await sw.getAttribute('aria-checked')) === 'false', 'desktop: the switch follows')
  const chip2 = await mod(page, '/src/ui/workspace/hole-chip.ts', "return m.objectChipText('SW1')")
  check(/按住即可按下 · 雙擊保持按下$/.test(chip2), 'desktop: the chip says 「按住即可按下 · 雙擊保持按下」 again', chip2)
  await runFor(page, 0.2)
  check((await pb12(page)) > 2.5, 'desktop: PB12 high after the release', String(await pb12(page)))

  // ---- double-click again, then 重置模擬
  await sleep(600)
  const r = await aimSW1(page)
  await page.mouse.dblclick(r.x, r.y)
  await sleep(500)
  check((await isLatched(page)) === true, 'desktop: latched again')
  await store(page, 'm.useStore.getState().resetSim()')
  await sleep(400)
  check((await pressedParam(page)) === false && (await isLatched(page)) === false, '重置模擬 releases the kept-pressed SW1')
  check((await sw.getAttribute('aria-checked')) === 'false', '重置模擬: the switch is off')
  await runFor(page, 0.3)
  check((await pb12(page)) > 2.5 && (await presses(page)) === 0, '重置模擬: the new run boots with SW1 released (PB12 high, no press)', String(await pb12(page)))
  check(errors.length === 0, 'desktop: no page errors', errors.slice(0, 2))
  await ctx.close()
}

// ---------------------------------------------------------------- phone
{
  const { ctx, page, errors } = await open({ phone: true })
  check((await openExample(page, 'button-exti')).ok === true, 'phone: button-exti opened')
  await runFor(page, 0.2)
  await select(page, 'SW1')
  const sw = toggle(page, '.prs')
  await sw.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
  check((await sw.count()) === 1, 'phone: the Properties sheet shows the 保持按下 switch')
  // both boxes in one frame, once the sheet's spring has settled (two separate reads
  // could straddle a frame of the sheet still sliding up)
  await sleep(700)
  const { hb, tb } = await page.evaluate(() => {
    const box = (el) => {
      const r = el?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
    }
    return { hb: box(document.querySelector('.prs .prs-hold')), tb: box(document.querySelector('.prs [role="switch"].latch-toggle')) }
  })
  check(!!hb && !!tb && tb.x + tb.width <= 390 - 8 && Math.abs(hb.y + hb.height / 2 - (tb.y + tb.height / 2)) < 8, 'phone: the puck and the switch fit side by side', { hb, tb })
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone: no horizontal scroll')
  await sw.scrollIntoViewIfNeeded()
  await sw.tap()
  await sleep(400)
  check((await sw.getAttribute('aria-checked')) === 'true' && (await isLatched(page)) === true, 'phone: tapping it keeps SW1 pressed')
  await runFor(page, 0.3)
  check((await pb12(page)) < 0.5, 'phone: the firmware sees it held', String(await pb12(page)))
  await page.screenshot({ path: path.join(SHOTS, 'phone-1-latched.png') })
  await sw.tap()
  await sleep(400)
  check((await pressedParam(page)) === false, 'phone: tapping it again releases SW1')
  check(errors.length === 0, 'phone: no page errors', errors.slice(0, 2))
  await ctx.close()
}

// ---------------------------------------------------------------- the English classic chrome
{
  const { ctx, page, errors } = await open({ lang: 'en', workspace: false })
  await openExample(page, 'button-exti')
  await runFor(page, 0.2)
  await select(page, 'SW1')
  check((await page.locator('.latch-toggle').count()) === 0, 'classic: no 保持按下 switch (the original inspector)')
  check((await page.locator('.prs-holdrow.latch-holdrow').count()) === 0, 'classic: the original HOLD row')
  await page.locator('.asm-sheet, .prs-sheet').first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  await store(page, 'm.useStore.getState().select(null)')
  await sleep(600)
  const p = await aimSW1(page)
  await page.mouse.dblclick(p.x, p.y)
  check(!!(await until(page, async () => (await pressedParam(page)) === false, 4000)), 'classic: a double-click stays momentary (released)')
  check(errors.length === 0, 'classic: no page errors', errors.slice(0, 2))
  await ctx.close()
}

await browser.close()
console.log(`\nscreenshots: ${SHOTS}`)
console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
