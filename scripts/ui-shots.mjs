/**
 * Embedded-workspace UI screenshots (cross-platform, headless Edge/Chrome).
 *
 *   node scripts/ui-shots.mjs            # writes PNGs to $UI_SHOTS_DIR (default: <tmp>/ohmlet-ui-shots)
 *
 * Seeds a Blue Pill (at h10 on a standard board) + bench PSU + LED/resistor
 * on PA5, enables the desktop workspace and captures:
 *   - 1440×900 and 1920×1080: idle workspace, Blue Pill selected (inspector:
 *     firmware / execution / pinout), real firmware running
 *     (firmware/dist/hal-uart-hello.elf loaded through the inspector's file
 *     input), and every tray tab (UART, logic analyzer with PA9 + PA5,
 *     oscilloscope, simulation log)
 *   - 1440×900 empty board: the empty-state card centred in the free column
 *   - 390×844 phone: home, Properties sheet with the MCU controls, and the
 *     Scope sheet's Lab segments (Logic / UART / Log)
 * plus 3× close-ups of the scene's pin hover labels (U1 · A5 · c20 …),
 * and prints a live backdrop-filter audit per desktop view (the ≤4 / ≤3
 * budget of DESIGN.md §1 must hold with the workspace on).
 *
 * Needs a running dev server (UI_URL, default http://localhost:5173/).
 * Same browser approach as scripts/visual-regression.mjs (VR_CHANNEL).
 */
import { mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const URL = process.env.UI_URL ?? 'http://localhost:5173/'
const CHANNEL = process.env.VR_CHANNEL ?? 'msedge'
const OUT = process.env.UI_SHOTS_DIR ?? path.join(os.tmpdir(), 'ohmlet-ui-shots')
const FIRMWARE = path.join(ROOT, 'firmware', 'dist', 'hal-uart-hello.elf')

const LAYOUT = JSON.stringify({
  version: 1,
  name: 'Blue Pill workspace',
  board: 'standard',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    // PA5 sits at c20 (pin 30, far header): resistor from its strip to col 34
    { id: 'R1', type: 'resistor', params: { resistance: 330 }, holes: ['a20', 'a34'] },
    { id: 'D1', type: 'led', params: { color: 'green' }, holes: ['b34', 'top-28'] },
  ],
  wires: [
    { id: 'w1', from: 'PS1:+', to: 'j27', color: 'red' }, // 5V pin (h27)
    { id: 'w2', from: 'PS1:-', to: 'j28', color: 'black' }, // GND3 (h28)
    { id: 'w3', from: 'a10', to: 'top-6', color: 'black' }, // GND1 (c10) → top− rail
  ],
})

/** In-page audit of LIVE backdrop-filters (same method as scripts/glass-chrome.mjs). */
function auditFilters() {
  const live = Array.from(document.querySelectorAll('*')).filter((el) => {
    const bf = getComputedStyle(el).backdropFilter
    if (!bf || bf === 'none') return false
    return el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })
  })
  return {
    filters: live.length,
    lenses: live.filter((el) => getComputedStyle(el).backdropFilter.includes('url(')).length,
    list: live.map((el) => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 2).join('.')}`),
  }
}

async function boot(browser, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.addInitScript((layout) => {
    if (sessionStorage.getItem('ui-shots-seeded')) return
    sessionStorage.setItem('ui-shots-seeded', '1')
    localStorage.clear()
    localStorage.setItem('bb.onboarded', '1')
    localStorage.setItem('bb.layout', layout)
    localStorage.setItem('bb.renderMode', 'performance')
    for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
    localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: true }))
  }, LAYOUT)
  await page.goto(`${URL}?shotrig`)
  await page.waitForSelector('canvas')
  await page.waitForTimeout(2500)
  // a dev server hot-reloading the page mid-run (other edits) invalidates the sequence
  page.on('load', () => errors.push('PAGE RELOADED during the run (dev-server HMR) — re-run this viewport'))
  return { ctx, page, errors }
}

/**
 * Run `fn` (source text, gets `st` = the app store state) inside the page.
 * The store module is imported by the EXACT URL the app loaded (a dev
 * server that has hot-updated store.ts serves it as store.ts?t=…; a bare
 * import would instantiate a second, unrelated store).
 */
const store = (page, fn, arg) =>
  page.evaluate(
    async ([src, a]) => {
      const url =
        performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .find((n) => new URL(n).pathname === '/src/state/store.ts') ?? '/src/state/store.ts'
      const m = await import(url)
      // eslint-disable-next-line no-new-func
      return new Function('st', 'a', src)(m.useStore.getState(), a)
    },
    [fn, arg],
  )

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file })
  console.log(`shot ${file}`)
}

async function desktop(browser, w, h) {
  const tag = `ws-${w}x${h}`
  const { ctx, page, errors } = await boot(browser, { viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  console.log(tag, 'audit idle', JSON.stringify(await page.evaluate(auditFilters)))
  await shot(page, `${tag}-1-idle`)

  // library: Blue Pill spec card, a search, then the Examples / Lessons tabs
  const left = page.locator('.ws-left')
  await left.getByRole('button', { name: /Show STM32F103C8T6 Blue Pill details/ }).click()
  await page.waitForTimeout(300)
  await shot(page, `${tag}-1b-library-details`)
  await left.getByRole('button', { name: /Hide STM32F103C8T6 Blue Pill details/ }).click()
  await left.getByRole('searchbox', { name: 'Search the component library' }).fill('i2c')
  await page.waitForTimeout(200)
  await shot(page, `${tag}-1c-library-search`)
  await left.getByRole('searchbox', { name: 'Search the component library' }).fill('')
  await left.getByRole('radio', { name: 'Examples' }).click()
  await page.waitForTimeout(250)
  await shot(page, `${tag}-1d-examples`)
  await left.getByRole('radio', { name: 'Lessons' }).click()
  await page.waitForTimeout(250)
  await shot(page, `${tag}-1e-lessons`)
  await left.getByRole('radio', { name: 'Library' }).click()

  await store(page, "st.select('U1')")
  await page.waitForTimeout(500)
  await shot(page, `${tag}-2-bluepill-selected`)

  // an edit (undo pill) + a multi-selection (selection pill + group inspector):
  // the bottom chrome must re-flow above the tray into the free centre column
  await store(page, "st.setParam('R1', 'resistance', 470)")
  await store(page, "st.marqueeSelect(['R1', 'D1'])")
  await page.waitForTimeout(600)
  await shot(page, `${tag}-2b-pills-reflow`)
  await store(page, "st.select('U1')")
  await page.waitForTimeout(400)

  // real firmware through the inspector's file input, then Run
  if (existsSync(FIRMWARE)) {
    await page.setInputFiles('.ws-right .emb-fw input[type=file]', FIRMWARE)
    await page.waitForTimeout(700)
    await shot(page, `${tag}-2c-firmware-loaded-toast`)
    await page.waitForTimeout(500)
    await page.locator('.ws-right').getByRole('button', { name: 'Run simulation' }).click()
    await page.waitForTimeout(3500)
    await shot(page, `${tag}-3-firmware-running`)
  }
  console.log(tag, 'audit running', JSON.stringify(await page.evaluate(auditFilters)))

  const tab = (name) => page.locator('.ws-tray').getByRole('radio', { name }).click()
  await tab('UART Terminal')
  await page.waitForTimeout(600)
  await shot(page, `${tag}-4-tray-uart`)

  await tab('Logic Analyzer')
  await page.waitForTimeout(300)
  const add = page.locator('.ws-tray select[aria-label="Add channel"]')
  for (const v of ['mcu|U1|PA9', 'mcu|U1|PA10', 'mcu|U1|PA5']) {
    if ((await add.locator(`option[value="${v}"]`).count()) > 0) await add.selectOption(v)
  }
  await page.waitForTimeout(1500)
  await shot(page, `${tag}-5-tray-logic`)

  // let hal-uart-hello print a few "tick N" lines (one per second), pause,
  // zoom out to 2 s,
  // then wheel-zoom onto the first PA9 (USART1 TX) burst
  for (let i = 0; i < 120; i++) {
    const t = await store(page, 'return st.simTime')
    if (t > 3.3) break
    await page.waitForTimeout(250)
  }
  await store(page, 'st.stopSim()')
  for (let i = 0; i < 7; i++) await page.locator('.ws-tray').getByRole('button', { name: 'Zoom out' }).click()
  await page.waitForTimeout(700)
  const plot = page.locator('.ws-tray .emb-la-plot')
  // first column where the PA9 trace (channel row 0) leaves its HIGH line:
  // sample inside the row, between the high (y=26) and low (y=42) levels
  const findEdge = () =>
    plot.evaluate((el) => {
      const c = el.querySelector('canvas')
      const g = c.getContext('2d')
      const dpr = c.width / el.clientWidth
      const row = g.getImageData(0, Math.round((20 + 16) * dpr), c.width, 1).data
      for (let x = 0; x < c.width; x++) {
        const [r, gg, b] = [row[x * 4], row[x * 4 + 1], row[x * 4 + 2]]
        // anti-aliased 1.5 px stroke: the trace yellow (#ffd84a) at partial coverage
        if (r > 140 && gg > 115 && b < 90 && r > b * 2) return x / dpr
      }
      return null
    })
  // zoom one step at a time, re-aiming at the burst after every step
  const box = await plot.boundingBox()
  for (let i = 0; i < 9; i++) {
    const x = await findEdge()
    if (process.env.UI_SHOTS_DEBUG) console.log('burst edge x', x, await page.locator('.emb-zoom-val').textContent())
    if (x === null) break
    await page.mouse.move(box.x + x + 1, box.y + 40)
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(350)
  }
  await page.mouse.move(box.x + box.width * 0.6, box.y + 40)
  await page.waitForTimeout(400)
  await shot(page, `${tag}-5b-tray-logic-uart-burst`)

  await tab('Oscilloscope')
  await page.waitForTimeout(800)
  await shot(page, `${tag}-6-tray-scope`)

  await tab('Simulation Log')
  await page.waitForTimeout(600)
  await shot(page, `${tag}-7-tray-log`)

  // inspector scrolled to the pinout table
  await page.locator('.ws-right .ws-scroll').evaluate((el) => {
    const pin = el.querySelector('.emb-pin')
    if (pin) el.scrollTop = pin.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 120
  })
  await page.waitForTimeout(300)
  await shot(page, `${tag}-8-pinout`)

  // collapsed panels leave slim handles
  await page.locator('.ws-left').getByRole('button', { name: 'Hide library panel' }).click()
  await page.locator('.ws-tray').getByRole('button', { name: 'Collapse instrument tray' }).click()
  await page.waitForTimeout(500)
  await shot(page, `${tag}-9-collapsed`)

  // keyboard isolation: typing in the terminal / pressing keys on panel
  // controls must not reach App's global shortcuts (Space run, R rotate,
  // Delete, arrow nudges)
  // (picking a tab on the collapsed bar re-opens the tray)
  await page.locator('.ws-tray').getByRole('radio', { name: 'UART Terminal' }).click()
  await page.waitForTimeout(300)
  const before = await store(page, 'return JSON.stringify([st.running, st.selection, st.layout.components.find((c) => c.id === "U1")])')
  await page.locator('.ws-tray .emb-term-input').click()
  await page.keyboard.type(' r ')
  await page.keyboard.press('Delete')
  await page.keyboard.press('ArrowRight')
  await page.locator('.ws-tray').getByRole('radio', { name: 'Hex' }).click()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Delete')
  await page.keyboard.press('r')
  const after = await store(page, 'return JSON.stringify([st.running, st.selection, st.layout.components.find((c) => c.id === "U1")])')
  console.log(tag, 'keyboard isolation', before === after ? 'OK (no run/select/move/rotate/delete leaked)' : `LEAK ${before} -> ${after}`)

  // a right-hand sheet panel over the workspace: the glass budget must hold
  await page.locator('.lg-dock').getByText('More').click()
  await page.waitForTimeout(900)
  console.log(tag, 'audit More panel', JSON.stringify(await page.evaluate(auditFilters)))
  await page.locator('.lg-panel .lg-panel-content').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  // (ListRow buttons carry role=listitem — review defect B6 — so match by text)
  await page.locator('.lg-panel').getByText('About ohmlet').click()
  await page.waitForTimeout(300)
  await page.locator('.lg-panel .lg-panel-content').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(300)
  await shot(page, `${tag}-10-more-panel`)

  if (errors.length) console.log(tag, 'page errors:', errors.slice(0, 8))
  await ctx.close()
}

/**
 * Pin hover labels (App.tsx holeLabelText → the scene's hover chip): hover
 * holes through the ?shotrig projection — plan → world is x = column,
 * z = strip-row lattice (a..e = 3..7, f..j = 9..13), y = board top — and
 * capture 3× close-ups of the chip.
 */
async function hoverLabels(browser) {
  const { ctx, page } = await boot(browser, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 })
  await page.waitForFunction(() => typeof window.__shotRig?.project === 'function')
  const holes = [
    ['c20', 20, 5], // U1 PA5 → "U1 · A5 · c20"
    ['h20', 20, 11], // U1 PB3 → "U1 · B3 · h20"
    ['a20', 20, 3], // R1 lead → "R1 · p1 · a20"
    ['j27', 27, 13], // wire end → "w1 · j27"
  ]
  for (const [name, x, z] of holes) {
    const p = await page.evaluate(([x, z]) => window.__shotRig.project(x, 0, z), [x, z])
    if (!p) continue
    await page.mouse.move(p.x, p.y, { steps: 4 })
    await page.waitForTimeout(500)
    const file = path.join(OUT, `hover-${name}.png`)
    await page.screenshot({ path: file, clip: { x: p.x - 70, y: p.y - 50, width: 140, height: 60 } })
    console.log(`shot ${file}`)
  }
  await ctx.close()
}

/** Empty board + workspace: the empty-state card centres in the free column. */
async function emptyWorkspace(browser, w, h) {
  const tag = `ws-${w}x${h}`
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('bb.onboarded', '1')
    localStorage.setItem('bb.renderMode', 'performance')
    localStorage.setItem('bb.layout', JSON.stringify({ version: 1, components: [], wires: [] }))
    localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: true }))
  })
  await page.goto(`${URL}?shotrig`)
  await page.waitForSelector('canvas')
  await page.waitForTimeout(2500)
  console.log(tag, 'audit empty', JSON.stringify(await page.evaluate(auditFilters)))
  await shot(page, `${tag}-0-empty`)
  await ctx.close()
}

async function phone(browser) {
  const tag = 'phone-390x844'
  const { ctx, page, errors } = await boot(browser, {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  await shot(page, `${tag}-1-home`)
  const workspaceMounted = await page.locator('.ws-panel').count()
  console.log(tag, 'workspace panels mounted (must be 0):', workspaceMounted)

  await store(page, "st.select('U1')")
  await page.waitForTimeout(900)
  await shot(page, `${tag}-2-properties-half`)
  // drag the grabber band up to the full detent (real touch events via CDP —
  // Playwright's touchscreen API only taps)
  const band = page.locator('.lg-sheet .lg-sheet-band').first()
  const box = await band.boundingBox()
  if (box) {
    const cdp = await ctx.newCDPSession(page)
    const x = box.x + box.width / 2
    const y0 = box.y + 20
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
    for (let i = 1; i <= 14; i++) {
      const y = y0 + ((60 - y0) * i) / 14
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(900)
  }
  await shot(page, `${tag}-3-properties-full`)
  // scroll the full sheet to the execution + pinout groups
  await page.locator('.lg-sheet .lg-sheet-content').first().evaluate((el) => {
    const run = el.querySelector('.emb-run-head')
    if (run) el.scrollTop = run.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 60
  })
  await page.waitForTimeout(400)
  await shot(page, `${tag}-3b-properties-execution`)

  await store(page, 'st.select(null)')
  await page.waitForTimeout(700)
  await page.locator('.lg-dock').getByRole('tab', { name: 'Scope' }).or(page.locator('.lg-dock').getByText('Scope')).first().tap()
  await page.waitForTimeout(900)
  await shot(page, `${tag}-4-scope`)
  for (const seg of ['Logic', 'UART', 'Log']) {
    await page.locator('.lg-sheet').getByRole('radio', { name: seg, exact: true }).tap()
    await page.waitForTimeout(700)
    await shot(page, `${tag}-5-lab-${seg.toLowerCase()}`)
  }
  if (errors.length) console.log(tag, 'page errors:', errors.slice(0, 8))
  await ctx.close()
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch(CHANNEL === 'bundled' ? {} : { channel: CHANNEL })
  try {
    const only = process.argv[2]
    if (!only || only === '1440') await emptyWorkspace(browser, 1440, 900)
    if (!only || only === '1440') await desktop(browser, 1440, 900)
    if (!only || only === '1920') await desktop(browser, 1920, 1080)
    if (!only || only === 'phone') await phone(browser)
    if (!only || only === 'hover') await hoverLabels(browser)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
