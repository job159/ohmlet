/**
 * Keep-pressed latch 「保持按下」 — the follow-ups, replayed in the real app
 * (src/ui/embedded/latch.ts; the product owner's 「按鍵可以保持按下」):
 *
 *   UX_E2E_URL=http://localhost:5425/ node scripts/ux-e2e/latch-followups.mjs
 *
 * zh-TW, desktop 1440×900 (the workspace) and phone 390×844:
 *  - the status pill says 「SW1 保持按下中」 with 〔放開〕 while a session runs
 *    and nothing more urgent is shown; 〔放開〕 lets go;
 *  - KY-040: its button is the same 「保持按下」 toggle (「按鈕（SW）」),
 *    and the firmware sees it (「SW pressed」 on USART1);
 *  - b3 / b4 followed literally: press SW1 on the board (PA0 → 0 V,
 *    「PA0=0」), double-click keeps it pressed, the inspector's 「保持按下」
 *    turns it off; b4: 保持按下 lights LED1 (≈ 9.7 mA);
 *  - a lesson check with SW1 kept pressed: a check that presses SW1 itself
 *    passes; i2 「確認內部上拉」 (it looks at the circuit as it is) fails and
 *    the toast names SW1 with 〔放開〕, after which it passes; a wiring step
 *    (b4-s4) failing while SW1 is kept pressed never raises that toast;
 *  - phone: the long-press sheet offers 保持按下 / 放開 before a run; during a
 *    session a long-press presses SW1 (no sheet) and its Properties sheet
 *    carries the switch; the pill; KY-040's toggle; the coach reads 點兩下;
 *  - the English classic chrome: no 保持按下 in the long-press sheet, the
 *    KY-040 keeps its Pressed switch.
 * Screenshots go to $UX_E2E_SHOTS (default: the OS temp dir). Exit code 1 on
 * any failed check.
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
const SHOTS = process.env.UX_E2E_SHOTS ?? path.join(os.tmpdir(), 'latch-followups-e2e')
const ONLY = process.env.UX_E2E_ONLY ?? '' // 'desktop' | 'phone' | 'classic' | '' (all)
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
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })

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
      if (sessionStorage.getItem('latch2.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', lang)
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      localStorage.setItem('bb.layout', layout)
      localStorage.setItem('bb.sound', JSON.stringify({ enabled: false }))
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      sessionStorage.setItem('latch2.seeded', '1')
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
const lessons = (page, src, arg) => mod(page, '/src/ui/lessons/actions.ts', src, arg)
const pressedOf = (page, id) => store(page, `return m.useStore.getState().layout.components.find((c) => c.id === a)?.params?.pressed ?? null`, id)
const latchedOf = (page, id) => latch(page, 'return m.isLatched(a)', id)
const simNow = (page) => store(page, 'return m.useStore.getState().simTime')
const pinV = (page, id, pin) => page.evaluate(([i, p]) => window.__e2e.component(i)?.pinVoltages?.[p] ?? null, [id, pin])
const uart = (page) => page.evaluate(() => window.__e2e.uart('U1', 'USART1'))
const lastLine = async (page, re) => ((await uart(page)).match(re) ?? []).pop() ?? null
const pill = (page) => page.locator('.app-status-pill.is-in')
const pillText = async (page) => ((await pill(page).count()) ? (await pill(page).innerText()).replace(/\s+/g, ' ').trim() : '')
const toastTexts = (page) => page.locator('.lg-toast').allInnerTexts()

async function openExample(page, id) {
  const r = await mod(page, '/src/ui/workspace/examples.ts', `return await m.openExampleById(${JSON.stringify(id)})`)
  await sleep(1500)
  return r
}
async function runFor(page, seconds, maxMs = 90000) {
  await store(page, 'if (!m.useStore.getState().running) m.useStore.getState().startSim()')
  const t0 = await simNow(page)
  const w0 = Date.now()
  while (Date.now() - w0 < maxMs) {
    await sleep(150)
    if ((await simNow(page)) >= t0 + seconds) break
  }
  return simNow(page)
}
async function until(fn, maxMs = 15000) {
  const w0 = Date.now()
  while (Date.now() - w0 < maxMs) {
    const v = await fn()
    if (v) return v
    await sleep(120)
  }
  return null
}
const select = async (page, id) => {
  await store(page, `m.useStore.getState().select(${JSON.stringify(id)})`)
  await sleep(700)
}
/** Aim the camera at part `id` (`d` = distance) and return its screen point (the canvas must be on top there). */
async function aim(page, id, d = 12, over = 0.12) {
  const w = await page.evaluate((i) => window.__e2e.componentWorld(i, 1.0), id)
  await page.evaluate((v) => window.__shotRig.setCamera(v.x + v.o * v.d, v.y + 1.25 * v.d, v.z + 0.22 * v.d, v.x, v.y, v.z), { ...w, d, o: over })
  await sleep(350)
  const p = await page.evaluate((v) => window.__shotRig.project(v.x, v.y, v.z), w)
  const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName ?? null, [p.x, p.y])
  check(top === 'CANVAS', `${id} is reachable on the canvas`, top)
  return p
}
const toggleIn = (page, scope) => page.locator(`${scope} [role="switch"].latch-toggle`).first()

// =============================================================== desktop
if (!ONLY || ONLY === 'desktop') {
  const { ctx, page, errors } = await open()
  const panel = '.ws-right'

  // ---- the status pill (button-exti)
  check((await openExample(page, 'button-exti')).ok === true, 'desktop: button-exti opened')
  await runFor(page, 0.3)
  await sleep(1300) // the problems list (≤ 1 Hz) speaks for the running circuit
  const before = await pillText(page)
  await select(page, 'SW1')
  const sw = toggleIn(page, panel)
  await sw.click()
  await sleep(500)
  check((await latchedOf(page, 'SW1')) === true, 'desktop: 保持按下 on in the inspector keeps SW1 pressed')
  await runFor(page, 0.2)
  const t1 = await until(async () => ((await pillText(page)).includes('保持按下中') ? pillText(page) : null), 4000)
  check(t1 === 'SW1 保持按下中 放開', 'desktop: the pill reads 「SW1 保持按下中」 with 〔放開〕', { before, t1 })
  await shot(page, 'd1-pill-latched')
  // the pill sits under the capsule and never over the inspector
  const pb = await pill(page).boundingBox()
  const rb = await page.locator(panel).boundingBox()
  check(!!pb && !!rb && pb.x + pb.width <= rb.x, 'desktop: the pill stays in the scene column', { pb, rb })
  await pill(page).getByRole('button', { name: '放開' }).click()
  await sleep(500)
  check((await pressedOf(page, 'SW1')) === false, 'desktop: 〔放開〕 lets SW1 go')
  check((await sw.getAttribute('aria-checked')) === 'false', 'desktop: the inspector switch follows')
  const t2 = await until(async () => (!(await pillText(page)).includes('保持按下中') ? (await pillText(page)) || '(hidden)' : null), 4000)
  check(t2 !== null, 'desktop: the latch line leaves the pill', t2 ?? '')
  await runFor(page, 0.2)
  check((await pinV(page, 'U1', 'PB12')) > 2.5, 'desktop: PB12 high again after 放開', String(await pinV(page, 'U1', 'PB12')))

  // ---- KY-040: the same 保持按下 toggle
  check((await openExample(page, 'ky040-encoder')).ok === true, 'desktop: ky040-encoder opened')
  await runFor(page, 0.3)
  await select(page, 'ENC1')
  const enc = toggleIn(page, panel)
  check((await enc.count()) === 1, 'desktop: the KY-040 shows the 保持按下 toggle')
  check((await enc.innerText()).trim() === '保持按下' && (await enc.getAttribute('aria-checked')) === 'false', 'desktop: 「保持按下」, off')
  const rowText = await enc.evaluate((el) => (el.closest('[role="listitem"], .lg-row, li') ?? el.parentElement)?.innerText ?? '')
  check(rowText.includes('按鈕（SW）'), 'desktop: its row is named 「按鈕（SW）」', rowText)
  check((await page.locator(`${panel} [aria-label="按下"]`).count()) === 0, 'desktop: no generic 「按下」 switch left')
  await enc.scrollIntoViewIfNeeded()
  await shot(page, 'd2-ky040-off')
  await enc.click()
  await sleep(300)
  check((await latchedOf(page, 'ENC1')) === true && (await enc.getAttribute('aria-checked')) === 'true', 'desktop: on keeps ENC1 pressed')
  await runFor(page, 0.15)
  check(/SW pressed/.test(await uart(page)), 'desktop: the firmware sees it (「SW pressed」)', (await uart(page)).slice(-120))
  await shot(page, 'd3-ky040-on')
  check(/ENC1 保持按下中/.test(await pillText(page)) || (await pillText(page)) !== '', 'desktop: the pill speaks (latch, or a problem above it)', await pillText(page))
  await enc.click()
  await runFor(page, 0.15)
  check(/SW released/.test(await uart(page)), 'desktop: off releases it (「SW released」)')

  // ---- b3 followed literally (the coach's step 「按住 SW1：PA0 變成 0」)
  await store(page, 'm.useStore.getState().resetSim()')
  check((await lessons(page, "const l = (await import('/src/lessons/index.ts')).lessonById('b3-pull-resistors'); return await m.loadLessonCircuit(l, 'solution')")) === true, 'b3: the full answer loaded')
  await sleep(1200)
  await lessons(page, "const l = (await import('/src/lessons/index.ts')).lessonById('b3-pull-resistors'); m.startGuide(l, l.steps.findIndex((s) => s.id === 'b3-s3'))")
  await sleep(1200)
  const coach = page.locator('.lsn-coach')
  const coachText = (await coach.innerText()).replace(/\s+/g, ' ')
  check(coachText.includes('在麵包板上按住 SW1') && coachText.includes('雙擊 SW1') && coachText.includes('在屬性面板打開「保持按下」'), 'b3: the step says 按住 SW1 / 雙擊 SW1 / 打開「保持按下」', coachText.slice(0, 200))
  check(!/勾選 SW1 的「按下」/.test(coachText), 'b3: no 「勾選 SW1 的「按下」」')
  await shot(page, 'd4-b3-step')
  await runFor(page, 0.3)
  check((await pinV(page, 'U1', 'PA0')) > 2.5, 'b3: PA0 high while released', String(await pinV(page, 'U1', 'PA0')))
  // 「在麵包板上按住 SW1」
  let p = await aim(page, 'SW1')
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await runFor(page, 0.25)
  check((await pinV(page, 'U1', 'PA0')) < 0.3, 'b3: holding SW1 on the board pulls PA0 to ≈ 0 V', String(await pinV(page, 'U1', 'PA0')))
  check((await lastLine(page, /PA0=\d/g)) === 'PA0=0', 'b3: the terminal shows PA0=0', await lastLine(page, /PA0=\d PA1=\d/g))
  await page.mouse.up()
  await runFor(page, 0.25)
  check((await pinV(page, 'U1', 'PA0')) > 2.5 && (await lastLine(page, /PA0=\d/g)) === 'PA0=1', 'b3: let go → PA0=1')
  // 「想讓它一直按著：雙擊 SW1」
  await sleep(600)
  p = await aim(page, 'SW1')
  await page.mouse.dblclick(p.x, p.y)
  await sleep(400)
  check((await latchedOf(page, 'SW1')) === true, 'b3: a double-click keeps SW1 pressed')
  await runFor(page, 0.3)
  check((await pinV(page, 'U1', 'PA0')) < 0.3 && (await lastLine(page, /PA0=\d/g)) === 'PA0=0', 'b3: kept pressed → PA0 stays 0', String(await pinV(page, 'U1', 'PA0')))
  await page.mouse.move(5, 450)
  await sleep(300)
  await shot(page, 'd5-b3-kept')
  // 「檢查此步驟」 with SW2 kept pressed too: the check presses SW1 itself and passes
  await latch(page, "m.setLatched('SW2', true)")
  // (the running coach may already have checked the step itself and moved on: the
  // button's own call then, on the same step)
  const checkBtn = coach.locator('button', { hasText: '檢查此步驟' })
  const t3 = Date.now()
  if ((await checkBtn.count()) > 0) await checkBtn.first().click()
  else await lessons(page, "const l = (await import('/src/lessons/index.ts')).lessonById('b3-pull-resistors'); await m.runStepCheck(l, l.steps.findIndex((s) => s.id === 'b3-s3'))")
  const ok = await until(() => mod(page, '/src/ui/lessons/state.ts', "const r = m.useLessonUi.getState().runs['b3-pull-resistors|step:b3-s3']; return r?.status === 'done' && r.at >= a ? { v: r.results.every((x) => x.pass) } : null", t3), 30000)
  check(ok?.v === true, 'b3: 檢查此步驟 passes with SW1 and SW2 kept pressed (the check presses SW1 itself)')
  // 「觀察完請放開 SW1（關掉「保持按下」…）」
  await select(page, 'SW1')
  await toggleIn(page, panel).click()
  await sleep(300)
  check((await latchedOf(page, 'SW1')) === false, 'b3: 關掉「保持按下」 releases SW1')
  await latch(page, "m.setLatched('SW2', false)")
  await runFor(page, 0.25)
  check((await lastLine(page, /PA0=\d/g)) === 'PA0=1', 'b3: PA0=1 again')
  await lessons(page, 'm.stopGuide()')

  // ---- b4-s3: 保持按下 lights LED1
  await store(page, 'm.useStore.getState().resetSim()')
  await lessons(page, "const l = (await import('/src/lessons/index.ts')).lessonById('b4-button-debounce'); return await m.loadLessonCircuit(l, 'solution')")
  await sleep(1200)
  await lessons(page, "const l = (await import('/src/lessons/index.ts')).lessonById('b4-button-debounce'); m.startGuide(l, l.steps.findIndex((s) => s.id === 'b4-s3'))")
  await sleep(1000)
  const c4 = (await page.locator('.lsn-coach').innerText()).replace(/\s+/g, ' ')
  check(c4.includes('在麵包板上按住 SW1') && c4.includes('打開「保持按下」'), 'b4: the step names the real controls', c4.slice(0, 160))
  await runFor(page, 0.1)
  await select(page, 'SW1')
  await toggleIn(page, panel).click()
  await runFor(page, 0.1)
  const iLed = await page.evaluate(() => window.__e2e.component('LED1')?.current ?? null)
  check(iLed !== null && iLed > 0.008 && iLed < 0.0115, 'b4: 保持按下 lights LED1 at ≈ 9.7 mA', String(iLed))
  await shot(page, 'd6-b4-kept')
  await latch(page, "m.setLatched('SW1', false)")
  await lessons(page, 'm.stopGuide()')

  // ---- b4-s4 (a wiring step) with SW1 kept pressed, as b4-s3 suggests: its failure is never blamed on SW1
  await store(page, 'm.useStore.getState().resetSim()')
  await lessons(page, "const l = (await import('/src/lessons/index.ts')).lessonById('b4-button-debounce'); return await m.loadLessonCircuit(l, 'start')")
  await sleep(1200)
  await lessons(page, "const l = (await import('/src/lessons/index.ts')).lessonById('b4-button-debounce'); m.startGuide(l, l.steps.findIndex((s) => s.id === 'b4-s4'))")
  await sleep(1000)
  await latch(page, "m.setLatched('SW1', true)")
  // the coach re-checks its structural step after the latch's own layout edit
  const auto4 = await until(() => mod(page, '/src/ui/lessons/state.ts', "const r = m.useLessonUi.getState().runs['b4-button-debounce|step:b4-s4']; return r?.status === 'done' ? { pass: r.results[0].pass } : null"), 15000)
  check(auto4?.pass === false, 'b4-s4: the automatic re-check fails (R2 / the X-point wire not placed yet)')
  await sleep(300)
  check(!/保持按下中/.test((await toastTexts(page)).join(' | ')), 'b4-s4: …and no toast blames SW1', await toastTexts(page))
  const t4 = Date.now() - 500
  await page.locator('.lsn-coach').locator('button', { hasText: '檢查此步驟' }).first().click()
  const man4 = await until(() => mod(page, '/src/ui/lessons/state.ts', "const r = m.useLessonUi.getState().runs['b4-button-debounce|step:b4-s4']; return r?.status === 'done' && r.at > a ? { pass: r.results[0].pass } : null", t4), 15000)
  check(man4?.pass === false, 'b4-s4: 檢查此步驟 reads ✕')
  await sleep(300)
  check(!/保持按下中/.test((await toastTexts(page)).join(' | ')), 'b4-s4: a wiring failure is not the hand’s: no 「SW1 保持按下中」 toast', await toastTexts(page))
  check((await latchedOf(page, 'SW1')) === true, 'b4-s4: SW1 stays kept pressed')
  await shot(page, 'd6b-b4s4-wiring-no-toast')
  await latch(page, "m.setLatched('SW1', false)")
  await lessons(page, 'm.stopGuide()')

  // ---- a lesson check that looks at the circuit as it is, with SW1 kept pressed (i2 確認內部上拉)
  await store(page, 'm.useStore.getState().resetSim()')
  await lessons(page, "const l = (await import('/src/lessons/index.ts')).lessonById('i2-exti-button'); return await m.loadLessonCircuit(l, 'solution')")
  await sleep(1200)
  await lessons(page, "const l = (await import('/src/lessons/index.ts')).lessonById('i2-exti-button'); m.startGuide(l, l.steps.findIndex((s) => s.id === 'pullup'))")
  await sleep(1000)
  await latch(page, "m.setLatched('SW1', true)")
  await page.locator('.lsn-coach').locator('button', { hasText: '檢查此步驟' }).first().click()
  const res = await until(() => mod(page, '/src/ui/lessons/state.ts', "const r = m.useLessonUi.getState().runs['i2-exti-button|step:pullup']; return r?.status === 'done' ? { pass: r.results[0].pass } : null"), 30000)
  check(res?.pass === false, 'i2: 確認內部上拉 fails while SW1 is kept pressed (it looks at the circuit as it is)')
  const toast = page.locator('.lg-toast').filter({ hasText: 'SW1 保持按下中——這一步檢查的是目前的電路' })
  check((await toast.count()) === 1, 'i2: the toast says SW1 is kept pressed', await toastTexts(page))
  await sleep(400)
  await shot(page, 'd7-i2-check-latched')
  await toast.getByRole('button', { name: '放開' }).click()
  await sleep(300)
  check((await latchedOf(page, 'SW1')) === false, 'i2: the toast’s 〔放開〕 releases SW1')
  await page.locator('.lsn-coach').locator('button', { hasText: '檢查此步驟' }).first().click()
  const res2 = await until(() => mod(page, '/src/ui/lessons/state.ts', "const r = m.useLessonUi.getState().runs['i2-exti-button|step:pullup']; return r?.status === 'done' && r.at > a ? { pass: r.results[0].pass } : null", Date.now() - 500), 30000)
  check(res2?.pass === true, 'i2: …then the same check passes')
  await shot(page, 'd8-i2-check-released')
  // the acceptance with SW1 kept pressed: all pass (never the hand)
  await latch(page, "m.setLatched('SW1', true)")
  await lessons(page, "const l = (await import('/src/lessons/index.ts')).lessonById('i2-exti-button'); await m.runAcceptance(l)")
  const acc = await mod(page, '/src/ui/lessons/state.ts', "const r = m.useLessonUi.getState().runs['i2-exti-button|acceptance']; return r?.status === 'done' ? r.results.map((x) => x.pass) : null")
  check(Array.isArray(acc) && acc.length > 0 && acc.every(Boolean), 'i2: the acceptance passes with SW1 kept pressed', acc)
  await latch(page, "m.setLatched('SW1', false)")
  await lessons(page, 'm.stopGuide()')
  check(errors.length === 0, 'desktop: no page errors', errors.slice(0, 2))
  await ctx.close()
}

// =============================================================== phone
if (!ONLY || ONLY === 'phone') {
  const { ctx, page, errors } = await open({ phone: true })
  const cdp = await ctx.newCDPSession(page)
  const longPress = async (x, y, ms = 900) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await sleep(ms)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(600)
  }
  const asheet = page.locator('.lg-asheet:visible')
  check((await openExample(page, 'button-exti')).ok === true, 'phone: button-exti opened')
  // a finger on a zoomed-in button (as a learner pinches in to work on it)
  let p = await aim(page, 'SW1', 40, 0.1)
  await longPress(p.x, p.y)
  const items = (await asheet.allInnerTexts()).join('\n')
  check(items.includes('SW1 · 按鈕（輕觸開關）') && items.includes('保持按下'), 'phone: before a run the long-press sheet offers 保持按下', items.replace(/\n/g, ' / '))
  await shot(page, 'p1-sheet-keep')
  await asheet.getByRole('button', { name: '保持按下' }).tap()
  await sleep(500)
  check((await latchedOf(page, 'SW1')) === true, 'phone: tapping it keeps SW1 pressed')
  await longPress(p.x, p.y)
  const items2 = (await asheet.allInnerTexts()).join('\n')
  check(items2.includes('放開') && !items2.includes('保持按下'), 'phone: the next long-press offers 放開', items2.replace(/\n/g, ' / '))
  await page.keyboard.press('Escape').catch(() => {})
  await asheet.getByRole('button', { name: '取消' }).tap().catch(() => {})
  await sleep(500)
  // the run: the firmware sees the held button, the pill says so
  await runFor(page, 0.4)
  await sleep(1300)
  check((await pinV(page, 'U1', 'PB12')) < 0.5, 'phone: the run boots with SW1 held (PB12 low)', String(await pinV(page, 'U1', 'PB12')))
  const pt = await until(async () => ((await pillText(page)).includes('保持按下中') ? pillText(page) : null), 4000)
  check(pt === 'SW1 保持按下中 放開', 'phone: the pill reads 「SW1 保持按下中」 〔放開〕', pt ?? (await pillText(page)))
  await shot(page, 'p2-pill')
  const fit = await pill(page).boundingBox()
  check(!!fit && fit.x >= 8 && fit.x + fit.width <= 390 - 8, 'phone: the pill fits the screen', fit)
  await pill(page).getByRole('button', { name: '放開' }).tap()
  await sleep(500)
  check((await pressedOf(page, 'SW1')) === false, 'phone: 〔放開〕 lets SW1 go')
  // during a session a long-press is the finger on the button: it presses, no sheet; the part's sheet has the switch
  p = await aim(page, 'SW1', 40, 0.1)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] })
  await sleep(300)
  await runFor(page, 0.1)
  check((await pressedOf(page, 'SW1')) === true && (await latchedOf(page, 'SW1')) === false, 'phone: during a session the long-press holds SW1 down (pressed, not kept)')
  await sleep(500)
  check((await asheet.count()) === 0, 'phone: …and opens no menu')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(700)
  check((await pressedOf(page, 'SW1')) === false, 'phone: lifting the finger releases it')
  const sheetSw = toggleIn(page, '.prs')
  await sheetSw.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {})
  check((await sheetSw.count()) === 1, 'phone: the pressed part is selected and its sheet carries 保持按下')
  await sheetSw.scrollIntoViewIfNeeded().catch(() => {})
  await sleep(300)
  await shot(page, 'p3-session-sheet')
  await sheetSw.tap()
  await sleep(400)
  check((await latchedOf(page, 'SW1')) === true, 'phone: the sheet’s switch keeps it pressed during the session')
  await sheetSw.tap()
  await sleep(300)
  await store(page, 'm.useStore.getState().select(null)')
  await sleep(600)

  // KY-040 on the phone
  await openExample(page, 'ky040-encoder')
  await select(page, 'ENC1')
  const enc = toggleIn(page, '.prs')
  await enc.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {})
  check((await enc.count()) === 1, 'phone: the KY-040 sheet shows 保持按下')
  await enc.scrollIntoViewIfNeeded().catch(() => {})
  await sleep(300)
  const eb = await enc.boundingBox()
  check(!!eb && eb.x + eb.width <= 390 - 8 && eb.height >= 40, 'phone: the toggle fits, a finger-sized target', eb)
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone: no horizontal scroll')
  await enc.tap()
  await sleep(300)
  check((await latchedOf(page, 'ENC1')) === true, 'phone: tapping it keeps ENC1 pressed')
  await shot(page, 'p4-ky040')
  await enc.tap()
  await store(page, 'm.useStore.getState().select(null)')
  await sleep(500)

  // b3 on the phone: the coach says 點兩下
  await lessons(page, "const l = (await import('/src/lessons/index.ts')).lessonById('b3-pull-resistors'); return await m.loadLessonCircuit(l, 'solution')")
  await sleep(1200)
  await lessons(page, "const l = (await import('/src/lessons/index.ts')).lessonById('b3-pull-resistors'); m.startGuide(l, l.steps.findIndex((s) => s.id === 'b3-s3'))")
  await sleep(1200)
  const ct = (await page.locator('.lsn-coach').allInnerTexts()).join(' ').replace(/\s+/g, ' ')
  check(ct.includes('點兩下 SW1') && ct.includes('打開「保持按下」'), 'phone: b3 tells a finger 點兩下 SW1 / 打開「保持按下」', ct.slice(0, 200))
  await shot(page, 'p5-b3-coach')
  await lessons(page, 'm.stopGuide()')
  check(errors.length === 0, 'phone: no page errors', errors.slice(0, 2))
  await ctx.close()
}

// =============================================================== classic
if (!ONLY || ONLY === 'classic') {
  const { ctx, page, errors } = await open({ lang: 'en', workspace: false })
  await openExample(page, 'button-exti')
  const p = await aim(page, 'SW1', 30, 0.1)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await sleep(900)
  await page.mouse.up()
  await sleep(500)
  const items = (await page.locator('.lg-asheet:visible').allInnerTexts()).join('\n')
  check(items.includes('Properties') && !/Keep pressed|Release/.test(items), 'classic: the long-press sheet is unchanged (no Keep pressed)', items.replace(/\n/g, ' / '))
  await page.keyboard.press('Escape').catch(() => {})
  await page.locator('.lg-asheet:visible').getByRole('button', { name: 'Cancel' }).click().catch(() => {})
  await sleep(400)
  await openExample(page, 'ky040-encoder')
  await select(page, 'ENC1')
  check((await page.locator('.latch-toggle').count()) === 0, 'classic: the KY-040 has no latch toggle')
  check((await page.locator('[role="switch"][aria-label="Pressed"], input[aria-label="Pressed"]').count()) === 1, 'classic: its Pressed switch is as before')
  await shot(page, 'c1-classic-ky040')
  check(errors.length === 0, 'classic: no page errors', errors.slice(0, 2))
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
