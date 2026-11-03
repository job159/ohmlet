/**
 * 「電路說明」 (round 5 — explain), replayed in the real app
 * (src/ui/chrome/ExplainCard.tsx, explain.ts, the status pill's 'explain' tier):
 *
 *   UX_E2E_URL=http://localhost:5425/ node scripts/ux-e2e/explain-card.mjs
 *
 * zh-TW, desktop 1440×900 and 1280×720 (the workspace), the same with the
 * inspector collapsed, a phone 390×844, and the English classic chrome:
 *  - desktop: a two-line card at the top of the right column — outside
 *    .ws-right (the inspector's own text is unchanged), the inspector starts
 *    8 px under it (its slot is there before the run, too), it says 「LED1
 *    亮著：亮度 …（… mA）」 / 「由 5.00 V 經 R1 330 Ω 供電」 once the run is on,
 *    72 px (three text lines) while the words fit three, line 2 of a burned
 *    LED is not cut off, a click selects LED1 (the camera stays), no
 *    backdrop-filter (glass budget);
 *  - the open cathode before a run (polish round): 「LED1 不會亮：陰極（d18）
 *    沒有接地」 / 「用導線把 LED1 陰極（d18）接到上方 − 電源軌 第 13 孔」,
 *    nothing cut off, at 1440×900 and 1280×720;
 *  - words that need four lines (a long part id): the card grows to 90 px
 *    at once and the inspector follows it (--ws-explain-h); with short words
 *    again it stays 90 px for the dwell, then goes back to 72 px (outside
 *    ?shotrig — under it the box shrinks at once);
 *  - a guided lesson step that asks the learner to measure LED1's current
 *    (b1 「LED1 亮起，確認電流」): the card says 「LED1 亮著」 without the number;
 *  - an empty board: one line 「麵包板上還沒有元件。」;
 *  - inspector collapsed: the floating card at the top right, clear of the
 *    run capsule, the 顯示電流 chip and the status pill;
 *  - phone: no card; the pill's lowest tier says line 1 while the circuit
 *    runs with nothing wrong, a tap shows both lines as a toast;
 *  - what the blinking looks like (UX_E2E_ONLY=shape): the pwm-fade example's
 *    breathing LED reads 「LED1 漸亮漸暗，週期約 2 s：最亮 4.00 mA」 /
 *    「由 U1 PA6 經 R1 330 Ω 驅動」 on every refresh, never 「在閃」; the blink
 *    example 「LED1 在閃，約每 1 s 一次：亮時 4.07 mA」 — under ?shotrig and
 *    with the real timing (auto-run, the dwell);
 *  - classic chrome: nothing.
 * Screenshots go to $UX_E2E_SHOTS (default: the OS temp dir). Exit code 1 on
 * any failed check. (?shotrig: auto-run is off, so the run is started here.)
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
const SHOTS = process.env.UX_E2E_SHOTS ?? path.join(os.tmpdir(), 'explain-card-e2e')
const ONLY = process.env.UX_E2E_ONLY ?? '' // 'desktop' | 'floating' | 'phone' | 'classic' | 'shape' | '' (all)
fs.mkdirSync(SHOTS, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const EMPTY = { version: 1, name: 'empty', components: [], wires: [] }
/** the same circuit with LED1's cathode in d18, wired to nothing (the static words before a run) */
const OPEN = {
  version: 1,
  name: 'explain-open',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 330 } },
    { id: 'LED1', type: 'led', holes: ['b10', 'd18'], params: { color: 'red' } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+0' },
    { id: 'W2', from: 'PS1:-', to: 'top-0' },
  ],
}
/** a long part id: line 1 and line 2 both wrap — four text lines */
const LONG_ID = 'LED_STATUS_GREEN12'
const LONG = { ...OPEN, name: 'explain-long', components: OPEN.components.map((c) => (c.id === 'LED1' ? { ...c, id: LONG_ID } : c)) }
/** PS1 → R1 330 Ω (top+3 → a10) → LED1 (b10 → top-4): the classic first circuit */
const LED = {
  version: 1,
  name: 'explain',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 330 } },
    { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'red' } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+0' },
    { id: 'W2', from: 'PS1:-', to: 'top-0' },
  ],
}

let failures = 0
function check(cond, what, extra = '') {
  const x = typeof extra === 'string' ? extra : JSON.stringify(extra)
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${x ? `  (${x.length > 300 ? x.slice(0, 300) + '…' : x})` : ''}`)
  if (!cond) failures++
  return cond
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })

const browser = await chromium.launch({ channel: CHANNEL, headless: true })

async function open({ lang = 'zh-TW', workspace = true, phone = false, layout = LED, right = true, size = [1440, 900], rig = true } = {}) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([lang, ws, right, layout]) => {
      if (sessionStorage.getItem('explain.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', lang)
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws, right: { open: right, width: 340 } }))
      localStorage.setItem('bb.layout', layout)
      localStorage.setItem('bb.sound', JSON.stringify({ enabled: false }))
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      sessionStorage.setItem('explain.seeded', '1')
    },
    [lang, workspace, right, JSON.stringify(layout)],
  )
  // rig = false: the real timing (no ?shotrig — auto-run on, the card's dwell on)
  await page.goto(rig ? URL : `${BASE}${BASE.includes('?') ? '&' : '?'}e2e`, { timeout: 180000 })
  await page.waitForSelector('canvas', { timeout: 90000 })
  await page.waitForFunction((rig) => !!window.__e2e && (!rig || !!window.__shotRig), rig, { timeout: 90000 })
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
const card = (page) => page.locator('.app-explain')
/** the card's visible lines (never its visually hidden live region, which repeats line 1 for screen readers) */
const cardText = async (page) => {
  if (!(await card(page).count())) return ''
  const parts = await card(page).first().locator('.app-explain-l1, .app-explain-l2').allInnerTexts()
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
async function until(fn, ms = 6000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) return null
    await sleep(150)
  }
}
const run = async (page) => {
  await store(page, 'm.useStore.getState().startSim()')
  await sleep(2000) // a few telemetry pushes + the problems list for this circuit
}
/** each visible line of the card, and whether its box cuts it off */
const cutLines = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.app-explain-l1, .app-explain-l2')].map((el) => ({
      text: el.textContent,
      cut: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
    })),
  )
const overlaps = (a, b) => !!a && !!b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

// =============================================================== desktop (the right column)
if (!ONLY || ONLY === 'desktop') {
  const { ctx, page, errors } = await open()
  // the inspector's slot is reserved from the first paint (it never jumps when the card's words arrive)
  const r0 = await page.locator('.ws-right').boundingBox()
  check(!!r0 && Math.abs(r0.y - (16 + 72 + 8)) <= 1, 'desktop: the inspector starts under the card’s slot before any run', r0)
  await run(page)
  const text = await until(async () => ((await cardText(page)).includes('亮著') ? cardText(page) : null))
  check(/^LED1 亮著：亮度 \d+ %（\d+\.\d+ mA） 由 5\.00 V 經 R1 330 Ω 供電$/.test(text ?? ''), 'desktop: the card says what LED1 does and why', text ?? (await cardText(page)))
  await shot(page, 'd1-card')
  const c = await card(page).boundingBox()
  const r = await page.locator('.ws-right').boundingBox()
  check(!!c && c.y >= 15 && c.y <= 17, 'desktop: the card is the top of the right column', c)
  check(!!c && !!r && Math.abs(r.y - (c.y + c.height + 8)) <= 1, 'desktop: the inspector starts 8 px under it', { c, r })
  check(!!c && !!r && Math.abs(c.x - r.x) <= 1 && Math.abs(c.width - r.width) <= 1, 'desktop: the card has the inspector’s width', { c, r })
  check((await page.locator('.ws-right .app-explain').count()) === 0, 'desktop: the card is not inside the inspector (its text is unchanged)')
  check(!!c && c.height >= 70 && c.height <= 74, 'desktop: 72 px while the words fit three text lines', c)
  const blur = await page.evaluate(() => getComputedStyle(document.querySelector('.app-explain')).backdropFilter)
  check(!blur || blur === 'none', 'desktop: no backdrop-filter (glass budget)', blur)
  check((await page.locator('.app-explain[role="status"][aria-live="off"]').count()) === 1, 'desktop: role=status, aria-live off (numbers refresh at 2 Hz)')
  check((await page.locator('.app-explain .app-explain-live[aria-live="polite"]').count()) === 1, 'desktop: a polite region for subject changes only')
  // a click selects the subject (the camera stays)
  const cam = () => page.evaluate(() => window.__shotRig.project(0, 0, 0)) // a camera move changes the projection
  const camBefore = await cam()
  await card(page).locator('.app-explain-body').click()
  await sleep(500)
  check(JSON.stringify(await store(page, 'return m.useStore.getState().selection')) === '["LED1"]', 'desktop: a click selects LED1')
  check(JSON.stringify(await cam()) === JSON.stringify(camBefore), 'desktop: the camera did not move', { camBefore })
  // a guided lesson step that asks for LED1's current (b1 「LED1 亮起，確認電流」, step 5): no number on the card
  await mod(page, '/src/lessons/progress.ts', 'm.useLessonProgress.getState().setStep("b1-led-resistor", 4)')
  await mod(page, '/src/ui/lessons/state.ts', 'm.useLessonUi.getState().setCoach("b1-led-resistor")')
  const quiet = await until(async () => ((await cardText(page)).startsWith('LED1 亮著 ') ? cardText(page) : null), 4000)
  check(/^LED1 亮著 由 5\.00 V 經 R1 330 Ω 供電$/.test(quiet ?? ''), 'desktop: a measure step — the state, not the number the learner is to find', quiet ?? (await cardText(page)))
  await shot(page, 'd1b-card-lesson-measure')
  await mod(page, '/src/ui/lessons/state.ts', 'm.useLessonUi.getState().setCoach(null)')
  const back = await until(async () => (/^LED1 亮著：亮度/.test(await cardText(page)) ? cardText(page) : null), 4000)
  check(!!back, 'desktop: the number is back once no step asks for it', back ?? (await cardText(page)))
  // a burned LED: other lines, the same three-line box
  await store(page, 'm.useStore.getState().setParam("R1", "resistance", 10)')
  await sleep(2500)
  const c2 = await card(page).boundingBox()
  check(!!c && !!c2 && c2.height === c.height, 'desktop: the height stays while the words fit three lines', { c, c2, text: await cardText(page) })
  // the fix (「…改好就會自動換上新的 LED1」) is not cut off: line 2 takes up to two lines, nothing hidden
  const cut = await cutLines(page)
  check(cut.length > 0 && cut.every((x) => !x.cut), 'desktop: no line is cut off', cut)
  await shot(page, 'd2-card-burned')
  check(errors.length === 0, 'desktop: no page errors', errors.join(' | '))
  await ctx.close()

  // the open cathode before a run, at both laptop sizes: line 1 on one line, the whole fix readable
  for (const size of [
    [1440, 900],
    [1280, 720],
  ]) {
    const o = await open({ layout: OPEN, size })
    const ot = await until(async () => ((await cardText(o.page)).includes('不會亮') ? cardText(o.page) : null), 4000)
    check(
      /^LED1 不會亮：陰極（d18）沒有接地 用導線把 LED1 陰極（d18）接到上方 − 電源軌 第 \d+ 孔$/.test(ot ?? ''),
      `desktop ${size.join('×')}: the open cathode — the effect, the cause and where the wire goes`,
      ot ?? (await cardText(o.page)),
    )
    const oc = await cutLines(o.page)
    check(oc.length === 2 && oc.every((x) => !x.cut), `desktop ${size.join('×')}: nothing of it is cut off`, oc)
    const ob = await card(o.page).boundingBox()
    check(!!ob && ob.height >= 70 && ob.height <= 74, `desktop ${size.join('×')}: three text lines are enough (72 px)`, ob)
    await shot(o.page, `d4-open-cathode-${size[0]}`)
    check(o.errors.length === 0, `desktop ${size.join('×')}: no page errors`, o.errors.join(' | '))
    await o.ctx.close()
  }

  // four lines needed (a long part id): the box grows at once, the inspector follows; short words: back to 72
  for (const size of [
    [1440, 900],
    [1280, 720],
  ]) {
    const g = await open({ layout: LONG, size })
    await until(async () => ((await cardText(g.page)).includes('不會亮') ? true : null), 4000)
    const gb = await card(g.page).boundingBox()
    const gr = await g.page.locator('.ws-right').boundingBox()
    check(!!gb && gb.height >= 88 && gb.height <= 92, `desktop ${size.join('×')}: four lines needed — the card grows (90 px)`, { gb, text: await cardText(g.page) })
    check(!!gb && !!gr && Math.abs(gr.y - (gb.y + gb.height + 8)) <= 1, `desktop ${size.join('×')}: the inspector moves with it (8 px under)`, { gb, gr })
    const gc = await cutLines(g.page)
    check(gc.length === 2 && gc.every((x) => !x.cut), `desktop ${size.join('×')}: none of the four lines is cut off`, gc)
    await shot(g.page, `d5-four-lines-${size[0]}`)
    // ?shotrig: short words again → back to 72 px at once (a screenshot never depends on the dwell)
    await store(g.page, `m.useStore.getState().addWire("e18", "top-13")`)
    const shrunk = await until(async () => {
      const b = await card(g.page).boundingBox()
      return b && b.height <= 74 ? b : null
    }, 4000)
    check(!!shrunk, `desktop ${size.join('×')} (?shotrig): short words — 72 px again at once`, { b: await card(g.page).boundingBox(), text: await cardText(g.page) })
    check(g.errors.length === 0, `desktop ${size.join('×')}: no page errors (four lines)`, g.errors.join(' | '))
    await g.ctx.close()
  }

  // the real timing (no ?shotrig): a tall card waits before it shrinks, then shrinks — the inspector moves twice at most
  {
    const g = await open({ layout: LONG, rig: false })
    const grown = await until(async () => {
      const b = await card(g.page).boundingBox()
      return b && b.height >= 88 ? b : null
    }, 8000)
    check(!!grown, 'desktop (live): four lines needed — 90 px', { b: await card(g.page).boundingBox(), text: await cardText(g.page) })
    // wire the cathode to ground: it lights; 「LED_STATUS_GREEN12 亮著：…」 / 「由 5.00 V 經 R1 330 Ω 供電」 fits three lines
    await store(g.page, `m.useStore.getState().addWire("e18", "top-13")`)
    await sleep(2500)
    const held = await card(g.page).boundingBox()
    const heldText = await cardText(g.page)
    check(!!held && held.height >= 88 && heldText.includes('亮著'), 'desktop (live): new words that fit three lines — the box holds 90 px for a moment', { held, heldText })
    const after = await until(async () => {
      const b = await card(g.page).boundingBox()
      return b && b.height <= 74 ? b : null
    }, 9000)
    const ar = await g.page.locator('.ws-right').boundingBox()
    check(!!after && !!ar && Math.abs(ar.y - (after.y + after.height + 8)) <= 1, 'desktop (live): then back to 72 px, the inspector with it', { after, ar })
    check(g.errors.length === 0, 'desktop (live): no page errors', g.errors.join(' | '))
    await g.ctx.close()
  }

  // an empty board: one line
  const e = await open({ layout: EMPTY })
  const t0 = await until(async () => ((await cardText(e.page)) ? cardText(e.page) : null), 4000)
  check(t0 === '麵包板上還沒有元件。', 'desktop: an empty board — one line', t0 ?? '')
  await shot(e.page, 'd3-empty')
  await e.ctx.close()
}

// =============================================================== inspector collapsed (floating)
if (!ONLY || ONLY === 'floating') {
  const { ctx, page, errors } = await open({ right: false })
  await run(page)
  await until(async () => ((await page.locator('.app-explain.is-floating').count()) > 0 ? true : null))
  const c = await page.locator('.app-explain.is-floating').boundingBox()
  check(!!c && c.x + c.width >= 1440 - 20, 'floating: at the top right', c)
  for (const sel of ['.app-run-capsule', '.app-flow-chip', '.app-status-pill.is-in']) {
    const b = (await page.locator(sel).count()) ? await page.locator(sel).first().boundingBox() : null
    check(!overlaps(c, b), `floating: clear of ${sel}`, { c, b })
  }
  await shot(page, 'f1-floating')
  check(errors.length === 0, 'floating: no page errors', errors.join(' | '))
  await ctx.close()
}

// =============================================================== phone (the pill's lowest tier)
if (!ONLY || ONLY === 'phone') {
  const { ctx, page, errors } = await open({ phone: true, workspace: false })
  await run(page)
  check((await card(page).count()) === 0, 'phone: no card')
  const pill = page.locator('.app-status-pill.is-in.is-explain')
  // its visible text (the polite live region beside it is for screen readers)
  const pt = await until(async () => ((await pill.count()) ? (await pill.locator('.app-pill-text').innerText()).trim() : null))
  check((await page.locator('.app-status-pill.is-explain .app-pill-live[aria-live="polite"]').count()) === 1, 'phone: a polite region for subject changes')
  check(/^LED1 亮著：亮度 \d+ %（\d+\.\d+ mA）$/.test(pt ?? ''), 'phone: the pill says line 1', pt ?? '')
  const pb = await pill.boundingBox()
  check(!!pb && pb.x >= 8 && pb.x + pb.width <= 390 - 8, 'phone: the pill fits the screen', pb)
  await pill.locator('.app-pill-body').tap()
  await sleep(400)
  const toast = (await page.locator('.lg-toast-host').innerText().catch(() => '')).replace(/\s+/g, ' ')
  check(toast.includes('由 5.00 V 經 R1 330 Ω 供電'), 'phone: a tap shows both lines', toast)
  await shot(page, 'p1-pill-explain')
  check(errors.length === 0, 'phone: no page errors', errors.join(' | '))
  await ctx.close()
}

// =============================================================== what the blinking looks like (round 5 final)
// pwm-fade's breathing LED (its real firmware) is 「漸亮漸暗」, never 「在閃」; the blink example stays 「在閃」 —
// under ?shotrig (no dwell) and with the real timing (auto-run, the dwell, no ?shotrig).
if (!ONLY || ONLY === 'shape') {
  const FADE = /^LED1 漸亮漸暗，週期約 \d+(?:\.\d+)? m?s：最亮 \d+(?:\.\d+)? [mµ]A 由 U1 PA6 經 R1 330 Ω 驅動$/
  const BLINK = /^LED1 在閃，約每 \d+(?:\.\d+)? m?s 一次：亮時 \d+(?:\.\d+)? [mµ]A 由 U1 PA5 經 R1 330 Ω 驅動$/
  for (const rig of [true, false]) {
    const tag = rig ? 'shape (?shotrig)' : 'shape (live)'
    for (const [id, want, name] of [
      ['pwm-fade', FADE, 'fade'],
      ['blink', BLINK, 'blink'],
    ]) {
      const { ctx, page, errors } = await open({ layout: EMPTY, rig })
      const r = await mod(page, '/src/ui/workspace/examples.ts', `return await m.openExampleById(${JSON.stringify(id)})`)
      check(r?.ok === true, `${tag}: ${id} opened`, r)
      await sleep(1000)
      if (rig) await store(page, 'm.useStore.getState().startSim()')
      // a few periods of simulated time, then the card every half second for ~4 s
      const t0 = Date.now()
      while (Date.now() - t0 < 60000 && (await store(page, 'return m.useStore.getState().simTime')) < 5) await sleep(250)
      await sleep(1200)
      const seen = []
      for (let k = 0; k < 8; k++) {
        seen.push(await cardText(page))
        await sleep(500)
      }
      const last = seen[seen.length - 1]
      check(want.test(last), `${tag}: ${id} — the card says what the LED really does`, last)
      check(seen.every((x) => want.test(x)), `${tag}: ${id} — the same words on every refresh`, seen)
      if (name === 'fade') check(!seen.some((x) => x.includes('在閃')), `${tag}: a breathing LED is never 「在閃」`, seen)
      const cut = await cutLines(page)
      check(cut.length === 2 && cut.every((x) => !x.cut), `${tag}: ${id} — nothing of it is cut off`, cut)
      // 「週期約」 keeps the breathing LED's line 1 on one line of the 340 px column (as short as the blink's)
      check((await page.locator('.app-explain.is-l1-long').count()) === 0, `${tag}: ${id} — line 1 takes one line`, await cardText(page))
      await shot(page, `s-${name}-${rig ? 'rig' : 'live'}`)
      check(errors.length === 0, `${tag}: ${id} — no page errors`, errors.join(' | '))
      await ctx.close()
    }
  }
}

// =============================================================== classic chrome
if (!ONLY || ONLY === 'classic') {
  const { ctx, page, errors } = await open({ lang: 'en', workspace: false })
  await run(page)
  check((await card(page).count()) === 0, 'classic: no card')
  check((await page.locator('.app-status-pill').count()) === 0, 'classic: no pill')
  check(errors.length === 0, 'classic: no page errors', errors.join(' | '))
  await ctx.close()
}

await browser.close()
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)
