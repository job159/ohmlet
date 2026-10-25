/**
 * Instrument UI screenshots (cross-platform, headless Edge/Chrome).
 *
 *   node scripts/instrument-shots.mjs [la|scope|phone|small|all]
 *
 * Seeds a Blue Pill + bench PSU + LED on PA5 and a function generator
 * (100 Hz square, 0..3.3 V) into a 1 kOhm / 1 uF RC low-pass with scope
 * probes on the generator output (CH1) and the capacitor (CH2), logic
 * channels PA9 / PA10, a UART decoder (auto baud) and a falling-edge
 * trigger on PA9, enables the desktop workspace and captures:
 *   - la:    hal-uart-hello.elf loaded through the inspector, trigger armed
 *            BEFORE Run -> the analyzer freezes on the banner's first start
 *            bit with UART decode rows; the decoder strip; markers A/B with
 *            the cursor readout; the three exports (VCD / CSV edges / CSV
 *            decoded, saved next to the PNGs); a wheel zoom to full labels;
 *   - scope: triggered RC waveforms with automatic measurements, time and
 *            voltage cursors, fixed V/div, the rolling (trigger off) view;
 *   - phone: the Scope sheet (half + full detent) and its Logic segment;
 *   - small: scope + logic analyzer at the default tray height (240 px).
 *
 * Needs a running dev server (UI_URL, default http://localhost:5173/). A
 * server with HMR reloads the page when files change mid-run; a no-HMR
 * vite server on another port avoids that (see scripts/visual-regression.mjs).
 * Output: $INSTRUMENT_SHOTS_DIR (default <tmp>/ohmlet-instrument-shots).
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const URL = process.env.UI_URL ?? 'http://localhost:5173/'
const CHANNEL = process.env.VR_CHANNEL ?? 'msedge'
const OUT = process.env.INSTRUMENT_SHOTS_DIR ?? path.join(os.tmpdir(), 'ohmlet-instrument-shots')
const FIRMWARE = path.join(ROOT, 'firmware', 'dist', 'hal-uart-hello.elf')

const LAYOUT = {
  version: 1,
  name: 'Instruments demo',
  board: 'standard',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', params: { resistance: 330 }, holes: ['a20', 'a34'] },
    { id: 'D1', type: 'led', params: { color: 'green' }, holes: ['b34', 'top-28'] },
    // RC low-pass driven by the function generator (scope demo)
    { id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: 100, amplitude: 1.65, offset: 1.65 } },
    { id: 'R2', type: 'resistor', params: { resistance: 1000 }, holes: ['b45', 'b50'] },
    { id: 'C1', type: 'capacitor', params: { capacitance: 1e-6 }, holes: ['c50', 'top-44'] },
    { id: 'P1', type: 'scope_probe', params: { channel: 1 }, holes: ['d45'] },
    { id: 'P2', type: 'scope_probe', params: { channel: 2 }, holes: ['d50'] },
  ],
  wires: [
    { id: 'w1', from: 'PS1:+', to: 'j27', color: 'red' },
    { id: 'w2', from: 'PS1:-', to: 'j28', color: 'black' },
    { id: 'w3', from: 'a10', to: 'top-6', color: 'black' },
    { id: 'w4', from: 'FG1:out', to: 'a45', color: 'yellow' },
    { id: 'w5', from: 'FG1:gnd', to: 'top-40', color: 'black' },
  ],
}

const CHANNELS = [
  { index: 0, label: 'PA9', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA9' } },
  { index: 1, label: 'PA10', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA10' } },
]
const DECODERS = [{ id: 'uart1', decoder: 'uart', channels: { data: 0 }, options: { baud: 'auto' } }]
const TRIGGER = { v: 1, kind: 'edge', channel: 0, slope: 'falling', pattern: {}, pre: 0.1 }

async function boot(browser, ctxOpts, seed) {
  const ctx = await browser.newContext(ctxOpts)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('inst-seeded')) return
    sessionStorage.setItem('inst-seeded', '1')
    localStorage.clear()
    localStorage.setItem('bb.onboarded', '1')
    localStorage.setItem('bb.renderMode', 'performance')
    for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v)
  }, seed)
  await page.goto(`${URL}?shotrig`)
  await page.waitForSelector('canvas')
  await page.waitForTimeout(2500)
  return { ctx, page, errors }
}

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

async function shot(page, name, clip) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot(clip ? { path: file, clip } : { path: file })
  console.log('shot', file)
}

function seedFor(tab, extra = {}, height = 380) {
  return {
    'bb.layout': JSON.stringify(LAYOUT),
    'bb.workspace': JSON.stringify({ v: 1, enabled: true, tray: { open: true, height, tab } }),
    'bb.instruments': JSON.stringify({ v: 1, logicChannels: CHANNELS }),
    'bb.logicDecoders': JSON.stringify({ v: 1, decoders: DECODERS }),
    'bb.logicTrigger': JSON.stringify(TRIGGER),
    ...extra,
  }
}

async function loadFirmware(page) {
  await store(page, "st.select('U1')")
  await page.waitForTimeout(500)
  await page.setInputFiles('.ws-right .emb-fw input[type=file]', FIRMWARE)
  await page.waitForTimeout(1200)
}

async function trayClip(page) {
  const box = await page.locator('.ws-tray').boundingBox()
  return box ? { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 } : undefined
}

async function logic(browser, w, h) {
  const tag = `la-${w}x${h}`
  const { ctx, page, errors } = await boot(browser, { viewport: { width: w, height: h }, deviceScaleFactor: 1 }, seedFor('logic'))
  await loadFirmware(page)
  const tray = page.locator('.ws-tray')
  // 10 ms → 5 ms → 2 ms
  await tray.getByRole('button', { name: 'Zoom in' }).click()
  await tray.getByRole('button', { name: 'Zoom in' }).click()
  await tray.getByRole('button', { name: 'Trigger', exact: true }).click()
  await page.waitForTimeout(200)
  await tray.getByRole('button', { name: 'Arm' }).click()
  await page.waitForTimeout(200)
  await shot(page, `${tag}-0-armed`, await trayClip(page))
  await page.locator('.ws-right').getByRole('button', { name: 'Run simulation' }).click()
  for (let i = 0; i < 80; i++) {
    if ((await tray.getByText(/triggered at/).count()) > 0) break
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(1500)
  await store(page, 'st.stopSim()')
  await page.waitForTimeout(600)
  await shot(page, `${tag}-1-triggered`)
  await shot(page, `${tag}-1-triggered-tray`, await trayClip(page))

  // decoder panel instead of the trigger strip
  await tray.getByRole('button', { name: 'Trigger', exact: true }).click()
  await tray.getByRole('button', { name: /^Decode/ }).click()
  await page.waitForTimeout(400)
  await shot(page, `${tag}-2-decoders-tray`, await trayClip(page))

  // markers A / B around the first bytes, hover the PA9 row
  const plot = tray.locator('.emb-la-plot')
  const pb = await plot.boundingBox()
  if (pb) {
    await page.mouse.click(pb.x + pb.width * 0.105, pb.y + 34)
    await page.mouse.click(pb.x + pb.width * 0.148, pb.y + 34)
    await page.mouse.move(pb.x + pb.width * 0.5, pb.y + 34)
    await page.waitForTimeout(400)
  }
  await shot(page, `${tag}-3-markers-tray`, await trayClip(page))
  await shot(page, `${tag}-3-markers`)
  // exports: the browser download carries the generated files
  for (const choice of ['vcd:view', 'csv-edges:view', 'csv-ann:view']) {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      tray.locator('select[aria-label="Export capture"]').selectOption(choice),
    ])
    const file = path.join(OUT, dl.suggestedFilename())
    await dl.saveAs(file)
    const text = readFileSync(file, 'utf8')
    console.log('download', dl.suggestedFilename(), text.length, 'bytes:', JSON.stringify(text.slice(0, 240)))
  }
  // wheel-zoom onto the first bytes: full "0x48 'H'" labels
  if (pb) {
    await tray.getByRole('button', { name: 'Clear markers' }).click()
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(pb.x + pb.width * 0.2, pb.y + 60)
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(350)
    }
    await page.mouse.move(pb.x + pb.width * 0.45, pb.y + 34)
    await page.waitForTimeout(400)
  }
  await shot(page, `${tag}-4-zoomed-tray`, await trayClip(page))
  if (errors.length) console.log(tag, 'page errors:', errors.slice(0, 8))
  await ctx.close()
}

async function scope(browser, w, h) {
  const tag = `scope-${w}x${h}`
  const SCOPE = { tdiv: 0.002, vdiv: 'auto', vpos: 1, trigSource: 0, trigSlope: 'rising', trigLevel: 1.65, trigMode: 'auto', holdoff: 0, cursors: 'off' }
  const { ctx, page, errors } = await boot(
    browser,
    { viewport: { width: w, height: h }, deviceScaleFactor: 1 },
    seedFor('scope', { 'bb.scopeView': JSON.stringify(SCOPE) }),
  )
  await store(page, 'st.startSim()')
  for (let i = 0; i < 60; i++) {
    const t = await store(page, 'return st.simTime')
    if (t > 0.08) break
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(500)
  await shot(page, `${tag}-1-running`)
  await store(page, 'st.stopSim()')
  await page.waitForTimeout(600)
  await shot(page, `${tag}-2-paused-tray`, await trayClip(page))
  // time cursors
  const tray = page.locator('.ws-tray')
  await tray.locator('select[aria-label="Cursors"]').selectOption('time')
  await page.waitForTimeout(400)
  await shot(page, `${tag}-3-cursors-tray`, await trayClip(page))
  // fixed 1 V/div + voltage cursors
  await tray.locator('select[aria-label="Volts per division"]').selectOption('1')
  await tray.locator('select[aria-label="Cursors"]').selectOption('volt')
  await page.waitForTimeout(400)
  await shot(page, `${tag}-4-vdiv-volt-cursors-tray`, await trayClip(page))
  // trigger off: rolling legacy-style window at the default 0.5 s/div
  await tray.locator('select[aria-label="Trigger source"]').selectOption('off')
  await tray.locator('select[aria-label="Volts per division"]').selectOption('auto')
  await tray.locator('select[aria-label="Cursors"]').selectOption('off')
  for (let i = 0; i < 8; i++) await tray.getByRole('button', { name: 'Zoom out (slower timebase)' }).click()
  await page.waitForTimeout(500)
  await shot(page, `${tag}-5-roll-tray`, await trayClip(page))
  if (errors.length) console.log(tag, 'page errors:', errors.slice(0, 8))
  await ctx.close()
}

async function phone(browser) {
  const tag = 'phone-390x844'
  const SCOPE = { tdiv: 0.002, vdiv: 'auto', vpos: 1, trigSource: 1, trigSlope: 'rising', trigLevel: 1.65, trigMode: 'auto', holdoff: 0, cursors: 'off' }
  const { ctx, page, errors } = await boot(
    browser,
    { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    seedFor('scope', { 'bb.scopeView': JSON.stringify(SCOPE) }),
  )
  await store(page, 'st.startSim()')
  await page.waitForTimeout(2500)
  await store(page, 'st.stopSim()')
  await page.locator('.lg-dock').getByText('Scope').first().tap()
  await page.waitForTimeout(1200)
  await shot(page, `${tag}-1-scope`)
  // drag the grabber band up to the full detent (real touch events via CDP)
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
  await shot(page, `${tag}-1b-scope-full`)
  await page.locator('.lg-sheet').getByRole('radio', { name: 'Logic', exact: true }).tap()
  await page.waitForTimeout(1200)
  await shot(page, `${tag}-2-logic`)
  if (errors.length) console.log(tag, 'page errors:', errors.slice(0, 8))
  await ctx.close()
}

async function small(browser) {
  const tag = 'small-1440x900'
  const SCOPE = { tdiv: 0.002, vdiv: 'auto', vpos: 1, trigSource: 0, trigSlope: 'rising', trigLevel: 1.65, trigMode: 'auto', holdoff: 0, cursors: 'off' }
  const { ctx, page, errors } = await boot(
    browser,
    { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    seedFor('scope', { 'bb.scopeView': JSON.stringify(SCOPE) }, 240),
  )
  await store(page, 'st.startSim()')
  await page.waitForTimeout(2500)
  await store(page, 'st.stopSim()')
  await page.waitForTimeout(500)
  await shot(page, `${tag}-scope-tray`, await trayClip(page))
  await page.locator('.ws-tray').getByRole('radio', { name: 'Logic Analyzer' }).click()
  await page.waitForTimeout(800)
  await shot(page, `${tag}-logic-tray`, await trayClip(page))
  if (errors.length) console.log(tag, 'page errors:', errors.slice(0, 8))
  await ctx.close()
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch(CHANNEL === 'bundled' ? {} : { channel: CHANNEL })
  try {
    const only = process.argv[2] ?? 'all'
    if (only === 'all' || only === 'la') await logic(browser, 1440, 900)
    if (only === 'all' || only === 'scope') await scope(browser, 1440, 900)
    if (only === 'all' || only === 'phone') await phone(browser)
    if (only === 'all' || only === 'small') await small(browser)
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
