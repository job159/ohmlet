/**
 * cheer — the lesson surfaces around a pass and a start (final walkthrough
 * fixes), in the real app (Playwright, msedge, zh-TW, real taps / clicks):
 *
 *   F7   從第一課開始 (onboarding) over a board that holds a circuit — phone
 *        390×844 and desktop 1440×900: the first lesson's start loads AT ONCE
 *        (no "replace the current circuit?" question), the toast carries
 *        〔復原〕 and it brings the circuit back — like 下一課 / 開始引導;
 *   P3   初級 1 on a phone: 拿一顆電阻 → two hole taps → the properties sheet
 *        opens with its one-tap values and NO toast sits over them (the sheet
 *        is the feedback) — sampled every frame for 1.5 s with each toast's
 *        effective opacity, against the chips' live and resting boxes; the
 *        placing click's 「已放置 R1——繼續點孔位可再放一顆…」 never paints;
 *   ANS  a pass with 載入完整答案 (phone and desktop): the coach card and the
 *        驗收 headline say 「全部 6 項條件都通過（用的是載入的解答）」 like the
 *        toast — never 「課程完成」 — and 〔載入起始電路，自己接一次〕 loads the
 *        start at once and guides step 1.
 *
 *   UX_E2E_URL=http://localhost:5453/ UX_E2E_SHOTS=<dir> node scripts/ux-e2e/cheer-lessons.mjs
 *   CHEER_ONLY=phone,desktop   (default: both)
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright')
const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const SHOTS = process.env.UX_E2E_SHOTS ?? null
const CHANNEL = process.env.UX_E2E_CHANNEL ?? 'msedge'
const ONLY = (process.env.CHEER_ONLY ?? 'phone,desktop').split(',')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(cond, what, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${extra !== '' ? `  (${extra})` : ''}`)
  if (!cond) failures++
  return cond
}

/** what the learner had on the board before choosing 從第一課開始 */
const OWN = {
  version: 1,
  name: 'my-circuit',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R7', type: 'resistor', holes: ['top+40', 'a50'], params: { resistance: 1000 } },
    { id: 'LED7', type: 'led', holes: ['b50', 'top-44'], params: { color: 'blue' } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+0' },
    { id: 'W2', from: 'PS1:-', to: 'top-0' },
  ],
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true })

async function open({ width = 1440, height = 900, workspace = true, phone = false, tag = 'x' } = {}) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width, height }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([ws, own]) => {
      if (sessionStorage.getItem('cheer2.seeded')) return
      localStorage.clear()
      // NOT onboarded: the tour opens over the learner's own circuit
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', 'zh-TW')
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      localStorage.setItem('bb.layout', own)
      sessionStorage.setItem('cheer2.seeded', '1')
    },
    [workspace, JSON.stringify(OWN)],
  )
  await page.goto(`${URL}?e2e&shotrig&cheer`, { timeout: 180_000 })
  await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig, null, { timeout: 120_000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(1200)
  const a = {
    page,
    errors,
    close: () => ctx.close(),
    shot: async (name) => {
      if (!SHOTS) return
      mkdirSync(SHOTS, { recursive: true })
      await page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) })
    },
    mod: (file, src, arg) =>
      page.evaluate(
        async ([f, s, ar]) => {
          const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === f) ?? f
          const m = await import(url)
          return await new Function('m', 'a', `return (async () => { ${s} })()`)(m, ar)
        },
        [file, src, arg],
      ),
  }
  a.ids = () => a.mod('/src/state/store.ts', 'return m.useStore.getState().layout.components.map((c) => c.id).sort()')
  a.coach = () => a.mod('/src/ui/lessons/state.ts', 'return m.useLessonUi.getState().coachId')
  a.step = () => a.mod('/src/lessons/progress.ts', "return m.useLessonProgress.getState().lessons['b1-led-resistor']?.step ?? null")
  a.toasts = () => page.evaluate(() => window.__cheer2Toasts ?? [])
  a.clearToasts = () => page.evaluate(() => (window.__cheer2Toasts = []))
  a.screenOf = (ref) => page.evaluate((r) => { const w = window.__e2e.endpointWorld(r); return w ? window.__shotRig.project(w.x, w.y, w.z) : null }, ref)
  a.press = async (loc) => {
    if (phone) {
      const bb = await loc.boundingBox()
      await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2)
    } else await loc.click()
    await sleep(700)
  }
  a.tapHole = async (ref) => {
    const p = await a.screenOf(ref)
    if (phone) await page.touchscreen.tap(p.x, p.y)
    else await page.mouse.click(p.x, p.y)
    await sleep(700)
  }
  /** the boxes of the toasts on screen now */
  a.toastBoxes = () => page.evaluate(() => [...document.querySelectorAll('.lg-toast')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { text: e.innerText, x: r.x, y: r.y, w: r.width, h: r.height } }))
  await a.mod('/src/ui/kit/toasts.ts', `window.__cheer2Toasts = []
     m.subscribeToasts((q) => { for (const t of q) if (!window.__cheer2Toasts.includes(t.text)) window.__cheer2Toasts.push(t.text) })`)
  return a
}

/** onboarding → 下一步 … → 開始第一課 over the learner's own circuit */
async function startFromOnboarding(a, label) {
  const { page } = a
  check((await a.ids()).join(',') === 'LED7,PS1,R7', `${label}: the learner's own circuit is on the board`, (await a.ids()).join(','))
  for (let i = 0; i < 4; i++) {
    const start = page.getByRole('button', { name: '開始第一課' })
    if ((await start.count()) > 0 && (await start.first().isVisible())) break
    await a.press(page.getByRole('button', { name: '下一步', exact: true }).first())
  }
  await a.clearToasts()
  await a.press(page.getByRole('button', { name: '開始第一課' }).first())
  await sleep(1500)
  const asked = await page.getByText('要取代目前的電路嗎？').count()
  check(asked === 0, `${label}: 從第一課開始 asks nothing (F7, like 下一課)`)
  check((await a.ids()).join(',') === 'DMM1,LED1,PS1', `${label}: … the first lesson's starting circuit is on the board at once`, (await a.ids()).join(','))
  check((await a.coach()) === 'b1-led-resistor' && (await a.step()) === 0, `${label}: … and the coach guides step 1`)
  check((await a.toasts()).includes('已載入「LED 與限流電阻」的起始電路'), `${label}: … the toast says what was loaded`, (await a.toasts()).join(' | '))
  const undo = page.locator('.lg-toast').getByRole('button', { name: '復原' })
  check((await undo.count()) > 0, `${label}: … with 〔復原〕`)
  await a.shot('f7-loaded-with-undo')
  if ((await undo.count()) > 0) {
    await a.press(undo.first())
    await sleep(800)
    check((await a.ids()).join(',') === 'LED7,PS1,R7', `${label}: 〔復原〕 brings the learner's circuit back`, (await a.ids()).join(','))
    // and again (redo is not the point: start it for the next block)
    await a.mod('/src/ui/lessons/actions.ts', 'return m.startFirstLesson()')
    await sleep(1200)
  }
}

/** a pass with the loaded answer: every surface agrees, and 〔載入起始電路，自己接一次〕 */
async function answerPass(a, label) {
  const { page } = a
  await a.mod(
    '/src/ui/lessons/actions.ts',
    `const L = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/lessons/index.ts') ?? '/src/lessons/index.ts')
     const lesson = L.lessonById('b1-led-resistor')
     await m.loadLessonCircuit(lesson, 'solution')
     return true`,
  )
  await sleep(800)
  await a.clearToasts()
  await a.mod(
    '/src/ui/lessons/actions.ts',
    `const L = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/lessons/index.ts') ?? '/src/lessons/index.ts')
     await m.runAcceptance(L.lessonById('b1-led-resistor'))
     return true`,
  )
  await sleep(900)
  const toasts = await a.toasts()
  check(toasts.includes('驗收 6 項全部通過，但用的是載入的解答——自己接一次，才算完成本課。'), `${label}: the toast says the pass used the loaded answer`, toasts.join(' | '))
  const coach = (await page.locator('.lsn-coach-pass').first().innerText().catch(() => '')).replace(/\n/g, ' / ')
  check(coach.includes('全部 6 項條件都通過（用的是載入的解答）'), `${label}: the coach card says the same`, coach)
  check(!coach.includes('課程完成') && !coach.includes('下一課'), `${label}: … no 「課程完成」 / 下一課 for the answer's pass`, coach)
  const screen = await page.evaluate(() => document.body.innerText)
  check(!screen.includes('課程完成'), `${label}: 「課程完成」 is nowhere on screen`)
  check((await page.locator('.fx-cele-badge').count()) === 0, `${label}: no 完成！ badge`)
  await a.shot('answer-pass-coach')
  const build = page.locator('.lsn-coach-pass').getByRole('button', { name: '載入起始電路，自己接一次' })
  check((await build.count()) > 0, `${label}: the coach offers 〔載入起始電路，自己接一次〕`)
  if ((await build.count()) > 0) {
    await a.clearToasts()
    await a.press(build.first())
    await sleep(1200)
    check((await a.ids()).join(',') === 'DMM1,LED1,PS1', `${label}: … it loads the starting circuit at once`, (await a.ids()).join(','))
    check((await a.coach()) === 'b1-led-resistor' && (await a.step()) === 0, `${label}: … and guides step 1`)
    check((await page.locator('.lsn-coach-pass').count()) === 0, `${label}: … the answer's pass line is gone`)
    check((await a.toasts()).includes('已載入「LED 與限流電阻」的起始電路'), `${label}: … with the 〔復原〕 toast`, (await a.toasts()).join(' | '))
    await a.shot('answer-build-it-yourself')
  }
}

// ---------------------------------------------------------------------------
if (ONLY.includes('phone')) {
  const a = await open({ width: 390, height: 844, workspace: false, phone: true, tag: 'p' })
  const { page } = a
  await startFromOnboarding(a, 'phone F7')

  // ---- P3: 拿一顆電阻 → place it → the sheet with its one-tap values, no toast over them
  for (let i = 0; i < 3; i++) {
    const take = page.getByRole('button', { name: '拿一顆電阻' })
    if ((await take.count()) > 0 && (await take.first().isVisible())) break
    await a.press(page.getByRole('button', { name: /^下一步/ }).first())
  }
  await a.clearToasts()
  await a.press(page.getByRole('button', { name: '拿一顆電阻' }).first())
  await a.tapHole('top+10')
  // the second tap places R1: watch every toast on screen for 2 s from that tap (one sample per
  // frame, timed from the tap itself). A toast counts as painted when its EFFECTIVE opacity (its
  // own × every ancestor's — the host fades the wrapper, not the pill) is above 0.05, and as over
  // the chips when it overlaps their box in THAT frame (the sheet slides up beneath it).
  await page.evaluate(() => {
    window.__cheer2Seen = []
    window.__cheer2TapAt = null
    window.addEventListener('touchstart', () => (window.__cheer2TapAt ??= performance.now()), { capture: true, once: true })
    const t0 = performance.now()
    const look = () => {
      const tap = window.__cheer2TapAt
      // the sheet's one-tap values on screen in THIS frame (null while the sheet is not up yet)
      const chip = [...document.querySelectorAll('.prs-chips')].find((c) => c.getBoundingClientRect().width > 0)
      const cr = chip ? chip.getBoundingClientRect() : null
      for (const e of document.querySelectorAll('.lg-toast')) {
        const r = e.getBoundingClientRect()
        let op = 1
        for (let n = e; n && n !== document.documentElement; n = n.parentElement) op *= +getComputedStyle(n).opacity
        if (r.width > 0 && r.height > 0 && op > 0.05)
          window.__cheer2Seen.push({ text: e.innerText, x: r.x, y: r.y, w: r.width, h: r.height, opacity: +op.toFixed(2), ms: tap === null ? null : Math.round(performance.now() - tap), chips: cr ? { x: cr.x, y: cr.y, w: cr.width, h: cr.height } : null })
      }
      if (tap === null ? performance.now() - t0 < 15_000 : performance.now() - tap < 2000) requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  await a.tapHole('a14')
  await sleep(1500)
  const placed = (await a.ids()).includes('R1')
  check(placed, 'phone P3: R1 placed with two taps', (await a.ids()).join(','))
  const chips = page.locator('.prs-chips').first()
  const chipBox = await chips.boundingBox().catch(() => null)
  check(!!chipBox, 'phone P3: the properties sheet opened with the one-tap values', JSON.stringify(chipBox))
  check(!(await a.toasts()).includes('已放置 R1——屬性面板已打開'), 'phone P3: no 「已放置 R1——屬性面板已打開」 toast (the sheet is the feedback)', (await a.toasts()).join(' | '))
  const seen = (await page.evaluate(() => window.__cheer2Seen ?? [])).filter((x) => x.ms !== null && x.ms >= 0)
  const shown = [...new Set(seen.map((x) => x.text.replace(/\s+/g, ' ')))]
  console.log(`      toasts painted in the 2 s after the placing tap: ${JSON.stringify(shown)} (${seen.length} samples; with the chips on screen: ${seen.filter((x) => x.chips).length})`)
  const hit = (x, c) => !!c && x.x < c.x + c.w && x.x + x.w > c.x && x.y < c.y + c.h && x.y + x.h > c.y
  const onChips = seen.filter((x) => hit(x, x.chips))
  check(onChips.length === 0, 'phone P3: no toast painted over the chips while the sheet opened (every frame, effective opacity)', JSON.stringify(onChips.slice(0, 3)))
  // the placing click's repeat-placement hint said the opposite of what happens (the tool returns to select)
  const rearmHint = seen.filter((x) => /繼續點孔位|再放一顆|已放置/.test(x.text))
  check(rearmHint.length === 0, 'phone P3: no 「已放置 R1——繼續點孔位可再放一顆…」 / 「已放置…」 toast painted at all after the placing tap', JSON.stringify(rearmHint.slice(0, 2)))
  check((await a.mod('/src/state/store.ts', 'return m.useStore.getState().mode.kind')) === 'select', 'phone P3: the tool is back to select (one placement)')
  const boxes = await a.toastBoxes()
  const over = chipBox ? boxes.filter((b) => b.x < chipBox.x + chipBox.width && b.x + b.w > chipBox.x && b.y < chipBox.y + chipBox.height && b.y + b.h > chipBox.y) : []
  check(over.length === 0, 'phone P3: no toast covers the one-tap value chips', JSON.stringify(over))
  await a.shot('p3-placed-sheet')
  const v330 = page.getByRole('button', { name: '330 Ω', exact: true })
  if ((await v330.count()) > 0) {
    await a.press(v330.first())
    const r = await a.mod('/src/state/store.ts', "return m.useStore.getState().layout.components.find((c) => c.id === 'R1')?.params?.resistance ?? null")
    check(r === 330, 'phone P3: one tap on 330 Ω sets it', r)
  }

  // ---- the answer's pass
  await answerPass(a, 'phone ANS')
  check(a.errors.length === 0, 'phone: no page errors', a.errors.join(' | '))
  await a.close()
}

// ---------------------------------------------------------------------------
if (ONLY.includes('desktop')) {
  const a = await open({ tag: 'd' })
  await startFromOnboarding(a, 'desktop F7')
  await answerPass(a, 'desktop ANS')
  // the 驗收 headline in the workspace's lesson panel
  const { page } = a
  await a.mod(
    '/src/ui/lessons/actions.ts',
    `const L = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/lessons/index.ts') ?? '/src/lessons/index.ts')
     const lesson = L.lessonById('b1-led-resistor')
     await m.loadLessonCircuit(lesson, 'solution')
     m.goToAcceptance(lesson)
     return true`,
  )
  let head = ''
  for (let i = 0; i < 40 && !head; i++) {
    await sleep(250)
    head = await page.locator('.lsn-pass .lsn-pass-text').first().innerText().catch(() => '')
  }
  check(head === '全部 6 項條件都通過（用的是載入的解答）', 'desktop ANS: the 驗收 headline says the pass used the loaded answer', head)
  check((await page.locator('.lsn-pass.is-answer .lsn-build-own').count()) > 0, 'desktop ANS: … its first action is 〔載入起始電路，自己接一次〕')
  check(!(await page.evaluate(() => document.body.innerText)).includes('課程完成'), 'desktop ANS: 「課程完成」 nowhere on screen')
  await a.shot('answer-acceptance-panel')
  check(a.errors.length === 0, 'desktop: no page errors', a.errors.join(' | '))
  await a.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
