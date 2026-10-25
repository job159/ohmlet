/**
 * UX fix IN-18 — replay of the audit task (docs/ux/UX_VERIFY.md V-12;
 * finding RV-03): the classic-chrome inspector is unchanged.
 *
 *   UX_E2E_URL=http://localhost:5324/ node scripts/ux-e2e/inspector-IN-18.mjs
 *
 * English, workspace off (the classic chrome), the blink circuit, U1 selected
 * on the phone (390×844) and on the desktop (1440×900): the Properties sheet
 * shows the pre-wave body — 「stm32_bluepill · 40-pin」, FIRMWARE with the drop
 * zone and the BIN load address, EXECUTION with the icon debugger, PINOUT,
 * ON-BOARD, SIMULATION, PERIPHERALS — and none of the wave's surfaces (no
 * 'Microcontroller · 40 pins', no Overview / Pins / Firmware / Peripherals
 * tabs, no problems list, no 「Choose built-in firmware」, no probe buttons).
 * An LED shows its raw pin names — each PINS row exactly as in 6d01968,
 * 「anode b40」 (name + hole, no second copy of the name as a gloss) — a wire
 * its raw endpoints. zh-TW keeps the new inspector. The MCU pixels are pinned
 * by the legacy visual scene phone-properties-mcu (baseline from 6d01968,
 * scripts/visual-regression.mjs); no legacy scene shows an LED's sheet, so
 * its rows are compared here. The blink example's LED is LED1 since bf340c5
 * (it was D1 when this replay was written).
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
const EMPTY = { version: 1, name: 'empty', components: [], wires: [] }

let failures = 0
function check(cond, what, extra = '') {
  const x = typeof extra === 'string' ? extra : JSON.stringify(extra)
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${x ? `  (${x.length > 300 ? x.slice(0, 300) + '…' : x})` : ''}`)
  if (!cond) failures++
  return cond
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true })

/** A fresh profile: zh-TW, the desktop workspace at 1440×900 (or the phone), `layout` on the board. */
async function open({ lang = 'zh-TW', workspace = true, phone = false, layout = EMPTY } = {}) {
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
      if (sessionStorage.getItem('in.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', lang)
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      localStorage.setItem('bb.layout', layout)
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      sessionStorage.setItem('in.seeded', '1')
    },
    [lang, workspace, JSON.stringify(layout)],
  )
  // a loaded machine (several dev servers + browsers) takes 35-110 s to the load event of a
  // fresh profile's ~1000 dev modules (release triage, measured): wait for the page, not 30 s
  await page.goto(URL, { timeout: 180000 })
  await page.waitForSelector('canvas', { timeout: 90000 })
  await sleep(2000)
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
const openExample = async (page, id) => {
  const r = await mod(page, '/src/ui/workspace/examples.ts', `return await m.openExampleById(${JSON.stringify(id)})`)
  await sleep(1500)
  return r
}
const loadLayout = async (page, layout) => {
  await store(page, 'm.useStore.getState().loadLayout(a)', layout)
  await sleep(600)
}
const bindFirmware = (page, id, name) =>
  mod(page, '/src/ui/embedded/McuPanel.tsx', `return await m.bindBundledFirmware(${JSON.stringify(id)}, ${JSON.stringify(name)})`)
const lessonCircuit = (page, id, which = 'solution') =>
  mod(page, '/src/ui/lessons/actions.ts', `const L = await import('/src/lessons/index.ts'); return await m.loadLessonCircuit(L.lessonById(${JSON.stringify(id)}), ${JSON.stringify(which)})`)
async function runUntil(page, simTime, maxMs = 90000) {
  await store(page, 'm.useStore.getState().startSim()')
  const t0 = Date.now()
  let t = 0
  while (Date.now() - t0 < maxMs) {
    await sleep(300)
    t = await store(page, 'return m.useStore.getState().simTime')
    if (t >= simTime) break
  }
  return t
}
const pause = async (page) => {
  await store(page, 'm.useStore.getState().stopSim()')
  await sleep(300)
}
const select = async (page, id) => {
  await store(page, `m.useStore.getState().select(${JSON.stringify(id)})`)
  await sleep(700)
}
/** The problems store after the watcher caught up (≤ 1 Hz live, 250 ms debounce). */
async function problems(page, wait = 2500) {
  await sleep(wait)
  return mod(
    page,
    '/src/ui/embedded/problems.ts',
    'const s = m.useProblems.getState(); const f = (p) => ({ id: p.id, level: p.level, title: p.title, detail: p.detail, fact: p.fact ?? null, action: p.action?.label ?? null, affects: p.affects ?? 0, folded: p.folded ?? null, pending: !!p.pendingRuntime, note: p.note ?? null, holes: p.holes }); return { rows: s.problems.map(f), resolved: s.resolved.map(f), counts: s.counts }',
  )
}
async function pillText(page) {
  const el = page.locator('.app-status-pill').first()
  if ((await el.count()) === 0) return ''
  return (await el.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
}
async function inspectorText(page) {
  const el = page.locator('.ws-right').first()
  const t = (await el.count()) > 0 ? await el.innerText() : await page.locator('.prs').first().innerText().catch(() => '')
  return t.replace(/[ \t]+/g, ' ')
}

for (const phone of [true, false]) {
  const { ctx, page, errors } = await open({ lang: 'en', workspace: false, phone })
  await openExample(page, 'blink')
  await select(page, 'U1')
  const text = await page.locator('.prs').first().innerText()
  const where = phone ? 'phone' : 'desktop'
  check(/stm32_bluepill · 40-pin/.test(text), `${where}: the classic header 「stm32_bluepill · 40-pin」`)
  for (const h of ['FIRMWARE', 'EXECUTION', 'PINOUT', 'PERIPHERALS']) check(text.toUpperCase().includes(h), `${where}: ${h} group`)
  check(/Drop firmware here|Load firmware/.test(text) || /hal-blink\.elf/.test(text), `${where}: the classic firmware card`)
  check(/BIN load address/.test(text), `${where}: the BIN load address row`)
  for (const s of ['Microcontroller · 40 pins', 'Overview', 'Choose built-in firmware', 'Pins in use', 'No problems found']) check(!text.includes(s), `${where}: no 「${s}」`)
  check((await page.locator('.prs .insp-tabs').count()) === 0 && (await page.locator('.prs .insp-pin-acts').count()) === 0, `${where}: no MCU tabs, no probe buttons`)
  check((await page.locator('.prs-body.prs-classic').count()) === 1, `${where}: the classic body`)
  await select(page, 'LED1')
  const led = await page.locator('.prs').first().innerText()
  check(/\banode\b/.test(led) && /\bcathode\b/.test(led) && !/long lead/.test(led), `${where}: an LED lists its raw pin names`, led.replace(/\s+/g, ' ').slice(0, 160))
  // the 6d01968 row: the raw name, then the hole — never the name twice (「anode anode b40」)
  const pinRows = await page.locator('.prs .prs-pin').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))
  check(pinRows.join(' | ') === 'anode b40 | cathode top-32', `${where}: each LED pin row reads 「anode b40」 as in 6d01968`, pinRows)
  check((await page.locator('.prs .prs-pin-gloss').count()) === 0, `${where}: no gloss repeating an English pin name`)
  await select(page, await store(page, "return m.useStore.getState().layout.wires.find((w) => w.id.toLowerCase() === 'w7').id"))
  const wire = await page.locator('.prs').first().innerText()
  check(/\ba20\b/.test(wire) && /\be36\b/.test(wire) && !/Connected here/.test(wire), `${where}: a wire shows its raw endpoints, no net group`)
  check(errors.length === 0, `${where}: no page errors`, errors.slice(0, 2))
  await ctx.close()
}
// ---- zh-TW keeps the new inspector ----
{
  const { ctx, page, errors } = await open()
  await openExample(page, 'blink')
  await select(page, 'U1')
  const text = await inspectorText(page)
  check(/微控制器 · 40 腳/.test(text) && /概況/.test(text) && /腳位/.test(text), 'zh-TW: the new inspector (微控制器 · 40 腳, the tabs)')
  check((await page.locator('.prs-classic').count()) === 0, 'zh-TW: not the classic body')
  check(errors.length === 0, 'zh-TW: no page errors', errors.slice(0, 2))
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
