/**
 * DOCS-SHOTS — recaptures the zh-TW documentation screenshots
 * (docs/images/*.jpg, used by README.md and docs/*.md) from the CURRENT UI,
 * so the pictures can follow future UI changes.
 *
 * Every shot starts from a fresh browser context: zh-TW (bb.lang), the
 * desktop workspace on (bb.workspace), 1440×900 (or a 390×844 phone), the
 * onboarding finished unless the shot is about it. Circuits come from the
 * example library and the lesson circuits through the app's own openers
 * (the code paths of the 「開啟」 / 「載入起始電路」 buttons, imported from the
 * page's own module instances); UI states are reached with real clicks
 * where practical. The page is opened with `?e2e&shotrig&autorun`: the
 * read-only window.__e2e hooks (src/dev/e2e-hooks.ts — simulation time,
 * terminal / hole world points) and the scene's projection rig
 * (window.__shotRig) aim the clicks at the 3D board; `autorun` keeps the
 * product's auto-run on (?shotrig alone turns it off), so a circuit runs as
 * soon as it is opened, as the user sees it. JPEG, quality 80 (tests/docs-links.test.ts
 * keeps every image ≤ 300 KB). A shot waits for the toasts of the steps
 * before it to leave (they belong to the step, not to the picture).
 *
 * Headless or headed: Windows runs a headless browser as a background
 * process (efficiency cores), where the simulation worker reaches only about
 * 0.3× real time — and the capsule honestly says 「0.3 倍速」 in the picture.
 * SHOTS_HEADED=1 opens real (foreground) windows instead, so the pictures
 * show the speed a user's window gets.
 *
 * Usage (a running server — best a private no-HMR Vite server, see
 * docs/developer-guide.md §1 — the page must not reload mid-shot):
 *   SHOTS_HEADED=1 SHOTS_URL=http://localhost:5345/ node scripts/docs-shots.mjs
 *   SHOTS_HEADED=1 SHOTS_URL=http://localhost:5345/ node scripts/docs-shots.mjs "picker|uart"
 *
 * Argument: a regular expression over the shot names below (default: all).
 * Env:
 *   SHOTS_URL      page to drive (default http://localhost:5173/)
 *   SHOTS_OUT      output folder (default docs/images — the files the docs use)
 *   SHOTS_CHANNEL  msedge (default) | chrome | bundled (falls back to VR_CHANNEL)
 *   SHOTS_TEXT     1 = also write <name>.txt with the page's visible text
 *                  (to check the wording the picture shows; not for docs/)
 *   SHOTS_HEADED   1 = headed (foreground) browser windows — the pictures of
 *                  docs/images are taken this way (see above)
 *
 * Shots → files: onboarding, hero, statusPill → status-pill, problems,
 * picker → firmware-picker, uart → uart-terminal, logic → logic-analyzer,
 * scope, probe → probe-menu, wire → wire-net, halt → debugger,
 * peripherals → mcu-peripherals, readings, lessonGuide → lesson-guide,
 * lessonCheck → lesson-check, lessonsList → lessons, examples, library,
 * shortcuts, more → more-panel, phoneInstruments → phone-instruments,
 * phoneExamples → phone-examples.
 * A failed shot prints FAILED <name> and the others still run.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const URL_ = process.env.SHOTS_URL ?? 'http://localhost:5173/'
const OUT = path.resolve(process.env.SHOTS_OUT ?? path.join(ROOT, 'docs', 'images'))
const CHANNEL = process.env.SHOTS_CHANNEL ?? process.env.VR_CHANNEL ?? 'msedge'
const WITH_TEXT = process.env.SHOTS_TEXT === '1'
const HEADED = process.env.SHOTS_HEADED === '1'
const ONLY = process.argv[2] ? new RegExp(process.argv[2]) : null
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fresh(browser, opts = {}) {
  const ctx = await browser.newContext(
    opts.phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(String(e)))
  await page.addInitScript(
    ([onboarded]) => {
      if (sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      localStorage.clear()
      localStorage.setItem('bb.lang', 'zh-TW')
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: true }))
      if (onboarded) localStorage.setItem('bb.onboarded', '1')
    },
    [opts.onboarded !== false],
  )
  await page.goto(`${URL_}?e2e&shotrig&autorun`)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => typeof window.__shotRig?.project === 'function' && window.__e2e)
  await page.evaluate(() => window.__e2e.ready())
  await sleep(2500)
  return { ctx, page }
}

/** Run `src` with `m` = the app's own instance of the module at `modPath`. */
function withModule(page, modPath, src, arg) {
  return page.evaluate(
    async ([p, s, a]) => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === p) ?? p
      const m = await import(url)
      // eslint-disable-next-line no-new-func
      return await new Function('m', 'a', `return (async () => { ${s} })()`)(m, a)
    },
    [modPath, src, arg],
  )
}
const openExample = (page, id) => withModule(page, '/src/ui/workspace/examples.ts', 'return await m.openExampleById(a)', id)
const store = (page, src, arg) => withModule(page, '/src/state/store.ts', `const st = m.useStore.getState(); ${src}`, arg)
const lab = (page, src, arg) => withModule(page, '/src/ui/embedded/lab.ts', `const lab = m.useLab.getState(); ${src}`, arg)
const lessons = (page, src, arg) =>
  withModule(page, '/src/ui/lessons/actions.ts', `const L = (await import("/src/lessons/index.ts")).lessonById(a.id); ${src}`, arg)

/** ▶ 執行模擬 through the run control (the capsule's own path) */
const run = (page) => withModule(page, '/src/ui/chrome/run-control.ts', 'm.runOrResume()')
async function untilSim(page, seconds, timeout = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const t = await page.evaluate(() => window.__e2e.lastFrame()?.time ?? 0)
    if (t >= seconds) return t
    await sleep(250)
  }
  throw new Error(`simulation did not reach ${seconds} s`)
}
async function screenOf(page, ref) {
  return page.evaluate((r) => {
    const w = window.__e2e.endpointWorld(r)
    return w ? window.__shotRig.project(w.x, w.y, w.z) : null
  }, ref)
}
async function setTray(page, tab, height) {
  await lab(page, 'lab.setWorkspace({ tray: { ...lab.workspace.tray, open: true, tab: a.tab, ...(a.height ? { height: a.height } : {}) } })', { tab, height })
}
async function setLeft(page, patch) {
  await lab(page, 'lab.setWorkspace({ left: { ...lab.workspace.left, ...a } })', patch)
}
async function frame(page) {
  await page.mouse.move(5, 450)
  const b = page.getByRole('button', { name: '對準電路' }).first()
  if (await b.count()) await b.click()
  await sleep(1200)
}

/** Wait (≤ 8 s) until no toast is on screen: 「已收合元件庫…」 and the like belong to the step that raised them. */
async function noToasts(page) {
  const t0 = Date.now()
  while (Date.now() - t0 < 8000) {
    const n = await page.evaluate(() => document.querySelectorAll('.lg-toast').length)
    if (n === 0) return
    await sleep(250)
  }
}

async function save(page, name, clip) {
  await page.mouse.move(2, 2) // no stray hover
  await noToasts(page)
  await sleep(300)
  const file = path.join(OUT, `${name}.jpg`)
  await page.screenshot({ path: file, type: 'jpeg', quality: 80, ...(clip ? { clip } : {}) })
  if (WITH_TEXT) writeFileSync(path.join(OUT, `${name}.txt`), await page.evaluate(() => document.body.innerText))
  console.log('shot', name, `${Math.round(statSync(file).size / 1024)} KB`, page.errors.length ? `errors: ${page.errors.join(' | ')}` : '')
}

const SHOTS = {
  async onboarding(browser) {
    const { ctx, page } = await fresh(browser, { onboarded: false })
    for (let k = 0; k < 2; k++) {
      await page.getByRole('button', { name: /下一步/ }).first().click()
      await sleep(500)
    }
    await sleep(700)
    await save(page, 'onboarding')
    await ctx.close()
  },

  async hero(browser) {
    const { ctx, page } = await fresh(browser)
    await openExample(page, 'blink')
    await sleep(2500)
    await run(page)
    await untilSim(page, 5.5)
    await sleep(800)
    await save(page, 'hero')
    await ctx.close()
  },

  async statusPill(browser) {
    const { ctx, page } = await fresh(browser)
    await openExample(page, 'blink')
    await sleep(2000)
    // auto-run ran hal-blink for a moment: clear the program, then power up again from 0 s so the
    // recorders hold no traces of it — the board as a learner meets it before loading a program
    await lab(page, 'lab.clearFirmware("U1")')
    await sleep(300)
    await store(page, 'st.resetSim()')
    await sleep(2500)
    await save(page, 'status-pill')
    await ctx.close()
  },

  async problems(browser) {
    const { ctx, page } = await fresh(browser)
    await openExample(page, 'blink')
    await sleep(1500)
    // the classic beginner mistake: the resistor bypassed — the LED hangs straight on PA5
    await store(page, 'st.removeComponent("R1"); st.addWire("a36", "a40", "yellow")')
    await sleep(1500)
    await run(page)
    await untilSim(page, 1.2)
    await sleep(2500)
    await save(page, 'problems')
    await ctx.close()
  },

  async picker(browser) {
    const { ctx, page } = await fresh(browser)
    await openExample(page, 'blink')
    await sleep(1500)
    await lab(page, 'lab.clearFirmware("U1")')
    await sleep(300)
    await store(page, 'st.resetSim()') // as in statusPill
    await store(page, 'st.select("U1")')
    await sleep(1500)
    await page.locator('button', { hasText: '選擇內建韌體' }).first().click()
    await sleep(1200)
    await save(page, 'firmware-picker')
    await ctx.close()
  },

  async uart(browser) {
    const { ctx, page } = await fresh(browser)
    await openExample(page, 'uart-hello')
    await sleep(2000)
    await run(page)
    await untilSim(page, 2.2)
    await setTray(page, 'uart', 380)
    const input = page.getByPlaceholder(/傳送到/).first()
    await input.click()
    await input.fill('hello')
    await page.keyboard.press('Enter')
    await untilSim(page, 3.4)
    await store(page, 'st.select("U1")')
    await sleep(1500)
    await save(page, 'uart-terminal')
    await ctx.close()
  },

  async logic(browser) {
    const { ctx, page } = await fresh(browser)
    await openExample(page, 'i2c-scan')
    await sleep(2000)
    await run(page)
    await untilSim(page, 1.2)
    await setTray(page, 'logic', 440)
    await sleep(1500)
    await page.locator('button', { hasText: '解碼結果' }).first().click()
    await sleep(2000)
    await save(page, 'logic-analyzer')
    await ctx.close()
  },

  async scope(browser) {
    const { ctx, page } = await fresh(browser)
    await openExample(page, 'pwm-fade')
    await sleep(2000)
    await setTray(page, 'scope', 440)
    await run(page)
    await untilSim(page, 1.5)
    await page.locator('button', { hasText: '自動設定' }).first().click()
    await sleep(3200)
    // hal-pwm-fade sweeps the duty (≈ 2 s a cycle): wait for a mid duty — a short pulse leaves
    // 峰對峰值 「取樣不足」 and the sampling warning in the picture. The duty keeps moving until
    // the capture: a picture counts only when the duty read just before AND just after it is mid.
    await page.mouse.move(2, 2)
    await noToasts(page)
    const duty = () => page.evaluate(() => Number(/工作週期[^\n]*\n(?:ⓘ\n)?([\d.]+) %/.exec(document.body.innerText)?.[1] ?? NaN))
    const mid = (d) => d >= 30 && d <= 70
    const t0 = Date.now()
    for (;;) {
      if (Date.now() - t0 > 30000) throw new Error('no mid duty on the scope within 30 s')
      if (!mid(await duty())) {
        await sleep(50)
        continue
      }
      const shot = await page.screenshot({ type: 'jpeg', quality: 80 })
      if (!mid(await duty())) continue
      writeFileSync(path.join(OUT, 'scope.jpg'), shot)
      if (WITH_TEXT) writeFileSync(path.join(OUT, 'scope.txt'), await page.evaluate(() => document.body.innerText))
      console.log('shot scope', `${Math.round(shot.length / 1024)} KB`)
      break
    }
    await ctx.close()
  },

  async probe(browser) {
    const { ctx, page } = await fresh(browser)
    await openExample(page, 'pwm-fade')
    await sleep(2000)
    await run(page)
    await untilSim(page, 1)
    await noToasts(page) // 「已收合元件庫…」 from the opening would cover the menu
    const p = await screenOf(page, 'a19')
    await page.mouse.click(p.x, p.y, { button: 'right' })
    await sleep(1000)
    // shot right where the menu opened (save() would first move the pointer away from it)
    await page.screenshot({ path: path.join(OUT, 'probe-menu.jpg'), type: 'jpeg', quality: 80 })
    console.log('shot probe-menu')
    await ctx.close()
  },

  async wire(browser) {
    const { ctx, page } = await fresh(browser)
    await openExample(page, 'pwm-fade')
    await sleep(1500)
    await run(page)
    await untilSim(page, 1)
    await store(page, 'st.select("W7")')
    await sleep(1800)
    await save(page, 'wire-net')
    await ctx.close()
  },

  async halt(browser) {
    const { ctx, page } = await fresh(browser)
    await openExample(page, 'blink')
    await sleep(2000)
    await run(page)
    await untilSim(page, 1)
    await store(page, 'st.select("U1")')
    await sleep(800)
    await page.locator('button', { hasText: '停住核心' }).first().click()
    await sleep(1200)
    // scroll the inspector to the register rows
    await page.evaluate(() => {
      const regs = document.querySelector('.emb-regs')
      regs?.scrollIntoView({ block: 'center' })
    })
    await sleep(800)
    await save(page, 'debugger')
    await ctx.close()
  },

  async peripherals(browser) {
    const { ctx, page } = await fresh(browser)
    await openExample(page, 'i2c-scan')
    await sleep(2000)
    await run(page)
    await untilSim(page, 1)
    await withModule(page, '/src/ui/embedded/problems.ts', 'm.focusInspector("U1", { tab: "peripherals" })')
    await sleep(1800)
    // 「韌體目前的設定」 at the top of the inspector, the support list under it
    await page.evaluate(() => {
      const head = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent?.trim() === '韌體目前的設定')
      head?.scrollIntoView({ block: 'start' })
    })
    await sleep(800)
    await save(page, 'mcu-peripherals')
    await ctx.close()
  },

  async readings(browser) {
    const { ctx, page } = await fresh(browser)
    await lessons(page, 'await m.loadLessonCircuit(L, "solution"); m.stopGuide()', { id: 'b2-voltage-divider' })
    await sleep(1500)
    await setLeft(page, { open: false })
    await store(page, 'st.clearSelection()')
    await setTray(page, 'measure', 300)
    await sleep(800)
    await frame(page)
    await run(page)
    await untilSim(page, 0.5)
    await sleep(2500)
    await save(page, 'readings')
    await ctx.close()
  },

  async lessonGuide(browser) {
    const { ctx, page } = await fresh(browser)
    await withModule(page, '/src/ui/lessons/actions.ts', 'm.openLessons("i1-gpio-output")')
    await sleep(1200)
    await page.locator('button', { hasText: '載入起始電路' }).first().click()
    await sleep(3500)
    await save(page, 'lesson-guide')
    await ctx.close()
  },

  async lessonCheck(browser) {
    const { ctx, page } = await fresh(browser)
    await lessons(page, 'await m.loadLessonCircuit(L, "solution"); m.stopGuide(); m.openLessons(a.id, "acceptance")', { id: 'i1-gpio-output' })
    await sleep(2000)
    await page.locator('button', { hasText: '檢查我的電路' }).first().click()
    const t0 = Date.now()
    while (Date.now() - t0 < 180000) {
      const txt = await page.evaluate(() => document.body.innerText)
      if (/項條件通過|課程完成|條件都通過/.test(txt)) break
      await sleep(1000)
    }
    await sleep(1500)
    await save(page, 'lesson-check')
    await ctx.close()
  },

  async lessonsList(browser) {
    const { ctx, page } = await fresh(browser)
    await setLeft(page, { open: true, tab: 'lessons' })
    await sleep(1200)
    await save(page, 'lessons')
    await ctx.close()
  },

  async examples(browser) {
    const { ctx, page } = await fresh(browser)
    await setLeft(page, { open: true, tab: 'examples' })
    await sleep(1000)
    // expand the first card's details
    const more = page.getByRole('button', { name: /顯示「Blue Pill 閃爍 LED/ }).first()
    if (await more.count()) await more.click()
    await sleep(1000)
    await save(page, 'examples')
    await ctx.close()
  },

  async library(browser) {
    const { ctx, page } = await fresh(browser)
    await openExample(page, 'oled-ssd1306')
    await sleep(2500)
    await setLeft(page, { open: true, tab: 'parts' })
    await page.getByPlaceholder('搜尋元件與標籤').fill('oled')
    await sleep(800)
    const det = page.getByRole('button', { name: /顯示「OLED 0\.96/ }).first()
    if (await det.count()) await det.click()
    await run(page)
    await untilSim(page, 1.5)
    await sleep(1500)
    await save(page, 'library')
    await ctx.close()
  },

  async shortcuts(browser) {
    const { ctx, page } = await fresh(browser)
    await openExample(page, 'blink')
    await sleep(1500)
    await page.mouse.click(720, 140)
    await page.keyboard.press('?')
    await sleep(1000)
    await save(page, 'shortcuts')
    await ctx.close()
  },

  async more(browser) {
    const { ctx, page } = await fresh(browser)
    await openExample(page, 'blink')
    await sleep(1500)
    await page.locator('text=更多').first().click()
    await sleep(1200)
    await save(page, 'more-panel')
    await ctx.close()
  },

  async phoneInstruments(browser) {
    const { ctx, page } = await fresh(browser, { phone: true })
    await openExample(page, 'uart-hello')
    await sleep(2000)
    await run(page)
    await untilSim(page, 2.5)
    await page.locator('text=儀器').last().click()
    await sleep(1800)
    await save(page, 'phone-instruments')
    await ctx.close()
  },

  async phoneExamples(browser) {
    // the dock's 元件 sheet, 範例 segment (更多 → 範例 › and the empty board's 開啟範例 open the same list)
    const { ctx, page } = await fresh(browser, { phone: true })
    await page.locator('text=元件').last().click()
    await sleep(1200)
    await page.getByRole('radio', { name: '範例' }).first().click()
    await sleep(1500)
    await save(page, 'phone-examples')
    await ctx.close()
  },
}

// a headed window must keep rendering when another window covers it
const HEADED_ARGS = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--window-position=-3000,0']
const browser = await chromium.launch(
  CHANNEL === 'bundled'
    ? { headless: !HEADED, ...(HEADED ? { args: HEADED_ARGS } : {}) }
    : { channel: CHANNEL, headless: !HEADED, ...(HEADED ? { args: HEADED_ARGS } : {}) },
)
let failed = 0
try {
  for (const [name, fn] of Object.entries(SHOTS)) {
    if (ONLY && !ONLY.test(name)) continue
    try {
      await fn(browser)
    } catch (e) {
      failed++
      console.log('FAILED', name, String(e?.message ?? e).split('\n')[0])
    }
  }
} finally {
  await browser.close()
}
console.log(`docs-shots: ${failed === 0 ? 'done' : `${failed} shot(s) failed`} → ${path.relative(ROOT, OUT) || OUT}`)
if (failed > 0) process.exitCode = 1
