/**
 * UX fix IN-14 — replay of the audit task (docs/ux/UX_VERIFY.md V-05;
 * findings F-04, E2-05, F-18, E2-20): no fake numbers in the inspector or
 * in Problems.
 *
 *   UX_E2E_URL=http://localhost:5324/ node scripts/ux-e2e/inspector-IN-14.mjs
 *
 *  - PS1 + the 5V pin wired, GND not yet: at most 4 problem rows; the pin
 *    readings (−1261957 V) fold under 「U1 的 GND 沒接」 with their values as
 *    「—」; no DOM text matches /[-−]?\d{4,}(\.\d+)? ?V/ (with every 詳細 open)
 *  - a burned LED (burned open, honesty F11) reads its real open-circuit current
 *    and 「0 %（已燒毀）」, the same current in the readout and the ERC text
 *    (never 267 A / 622 W); a reversed LED reads 「0 A」 (never
 *    −0 pA); an unloaded PSU shows 「5.00 V」 large, 「≈ 0 A（未接負載）」, 「≈ 0 W」
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

const PS = { id: 'PS1', type: 'power_supply', params: { voltage: 5 } }
// ---- PS1 + 5V only ----
{
  const { ctx, page, errors } = await open()
  await loadLayout(page, {
    version: 1,
    components: [PS, { id: 'U1', type: 'stm32_bluepill', at: 'h10' }],
    wires: [
      { id: 'W1', from: 'PS1:+', to: 'j27', color: 'red' },
      { id: 'W2', from: 'PS1:-', to: 'top-1', color: 'black' },
    ],
  })
  await bindFirmware(page, 'U1', 'hal-blink')
  await runUntil(page, 1.0)
  const p = await problems(page, 3000)
  check(p.rows.length <= 4, 'at most 4 problem rows', p.rows.map((r) => r.title))
  const root = p.rows.find((r) => r.title === 'U1 的 GND 沒接')
  check(!!root && /因為 U1 的 GND 沒接，電路沒有參考點，各腳位電壓無法計算（已隱藏 \d+ 則腳位讀數）/.test(root.detail), 'the root row explains and hides the readings', root?.detail)
  check(!!root?.folded && root.folded.items.every((x) => !/\d{4,}/.test(x)) && root.folded.items.some((x) => /：— /.test(x)), 'the folded readings show 「—」', root?.folded?.items.slice(0, 3))
  await select(page, 'U1')
  for (const b of await page.locator('.erc-more:not(.is-all)').all()) await b.click().catch(() => {})
  await sleep(300)
  const text = await page.locator('body').innerText()
  const fake = text.match(/[-−]?\d{4,}(\.\d+)? ?V/g)
  check(!fake, 'no |V| ≥ 1 kV text anywhere on the page', fake?.slice(0, 4))
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}
// ---- burned / reversed LEDs ----
{
  const { ctx, page, errors } = await open()
  await loadLayout(page, {
    version: 1,
    components: [
      PS,
      { id: 'LED1', type: 'led', holes: ['top+20', 'top-20'] },
      { id: 'LED2', type: 'led', holes: ['top-30', 'a40'] },
      { id: 'R1', type: 'resistor', holes: ['top+31', 'b40'], params: { resistance: 330 } },
    ],
    wires: [
      { id: 'W1', from: 'PS1:+', to: 'top+0', color: 'red' },
      { id: 'W2', from: 'PS1:-', to: 'top-0', color: 'black' },
    ],
  })
  await runUntil(page, 0.5)
  await pause(page)
  await select(page, 'LED1')
  let insp = await inspectorText(page)
  // honesty F11 (LED thermal model): an LED straight across the supply burns OPEN within 1 ms — it
  // stops conducting, so the readout is the real open-circuit current (the old model kept it
  // conducting and read 「> 2 A（短路）」). The intent is unchanged: no fake number, and the readout and
  // the ERC text say the same current.
  const cur = (insp.split('即時讀數')[1] ?? '').match(/電流\s*([^\n]+)/)?.[1]?.trim() ?? ''
  check(/^[\d.]+ [pnµ]?A$|^0 A$/.test(cur) && /亮度\s*0 %（已燒毀）/.test(insp), 'burned LED readout: its real open-circuit current (≤ µA) and 「0 %（已燒毀）」', cur)
  check(!!cur && insp.includes(`模擬目前量測到流經它的電流為 ${cur}`), 'the ERC text uses the same words', cur)
  check(!/\d{3} A\b|\d{3} W\b|> 2A/.test(insp), 'never 267 A / 622 W / 「> 2A」')
  await select(page, 'LED2')
  insp = await inspectorText(page)
  check(/電流\s*0 A/.test(insp) && !/[-−]0 /.test(insp), 'a reversed LED reads 「0 A」')
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}
// ---- an unloaded supply ----
{
  const { ctx, page, errors } = await open()
  await loadLayout(page, { version: 1, components: [PS], wires: [] })
  await runUntil(page, 0.3)
  await select(page, 'PS1')
  const insp = await inspectorText(page)
  const readout = await page.locator('.insp-readout-value').first().innerText().catch(() => '')
  check(readout.trim() === '5.00 V', 'the big readout is the output voltage 「5.00 V」', readout)
  check(/≈ 0 A（未接負載）/.test(insp) && /≈ 0 W/.test(insp) && !/\d nA/.test(insp), 'current 「≈ 0 A（未接負載）」, power 「≈ 0 W」, never 「5 nA」')
  check(errors.length === 0, 'no page errors', errors.slice(0, 2))
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
