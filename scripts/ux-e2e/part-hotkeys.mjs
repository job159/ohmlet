/**
 * Round 5 — part keys (「還要有快捷鍵 像 r 電阻 c 電容 p 電供 l 是 led ……
 * 幫我補完常用元件」, 「按鈕改 b」 — src/ui/chrome/part-keys.ts):
 *
 *   UX_E2E_URL=http://localhost:5173/ UX_E2E_SHOTS=<dir> node scripts/ux-e2e/part-hotkeys.mjs
 *
 * A. zh-TW with the desktop workspace (1440×900, mouse):
 *   - the mouse resting on a hole, R → the resistor's ghost under it at once
 *     (no mouse move), two clicks → R1; L → LED1, C → C1, P → a supply
 *     beside the board at once; R R → placing stops;
 *   - after a click on a library card (the card keeps the focus) L still
 *     switches to the LED;
 *   - U arms the Blue Pill, Shift+R turns its ghost, a plain R switches to
 *     the resistor (it never rotates);
 *   - C picks up a capacitor and leaves 顯示電流 alone; Shift+C flips it;
 *   - 「r」 typed in the library search only types; Ctrl+C with nothing
 *     selected arms nothing;
 *   - keycaps on every copy of a 常用元件 card (20);
 *   - the shortcuts sheet (?) lists 「放置元件」 and 旋轉 Shift+R, and a
 *     letter pressed while it is open arms nothing.
 * B. zh-TW without the workspace (the desktop floating 元件 panel — light
 *    glass over the white board): corner keycaps, R arms the resistor with
 *    the panel open (「放置中」).
 * C. A 390×844 touch phone: no keycaps on the sheet's cards.
 * D. English classic chrome: R rotates an armed / a selected chip exactly as
 *    before, L does nothing, no keycaps.
 * E. Without ?shotrig (which mutes the page): Shift+R's turn clicks.
 * Exit code 1 on any failed check.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(cond, what, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${extra ? `  (${extra})` : ''}`)
  if (!cond) failures++
  return cond
}

// a supply on the bench: the empty-board card stays away from the holes
const BENCH = {
  version: 1,
  name: 'part-hotkeys',
  components: [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }],
  wires: [],
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true })

async function open({ lang = 'zh-TW', workspace = true, phone = false, layout = BENCH }) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([l, lg, ws]) => {
      if (sessionStorage.getItem('partkeys.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', lg)
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      localStorage.setItem('bb.layout', l)
      sessionStorage.setItem('partkeys.seeded', '1')
    },
    [JSON.stringify(layout), lang, workspace],
  )
  await page.goto(`${URL}?e2e&shotrig`, { timeout: 180_000 })
  await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig, null, { timeout: 120_000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(1200)
  const tag = `${lang}${workspace ? '-ws' : ''}${phone ? '-phone' : ''}`
  const api = {
    page,
    ctx,
    errors,
    shot: async (name, opts = {}) => {
      if (!SHOTS) return
      mkdirSync(SHOTS, { recursive: true })
      await page.screenshot({ path: path.join(SHOTS, `part-hotkeys-${tag}-${name}.png`), ...opts })
    },
    /** the store, read in the page (mode, hoverHole, components) */
    st: () =>
      page.evaluate(async () => {
        const s = (await import('/src/state/store.ts')).useStore.getState()
        return { mode: s.mode, hover: s.hoverHole, selection: s.selection, comps: s.layout.components.map((c) => ({ id: c.id, type: c.type, holes: c.holes, rotation: c.rotation ?? 0 })) }
      }),
    setMode: (m) => page.evaluate(async (mode) => (await import('/src/state/store.ts')).useStore.getState().setMode(mode), m),
    /** look at the board around `hole` from above-front (fixed pose: no reframe drift) */
    park: async (hole = 'e30') => {
      await page.evaluate((h) => {
        const w = window.__e2e.endpointWorld(h)
        window.__shotRig.setCamera(w.x - 1, 18, w.z + 13, w.x, 0, w.z)
      }, hole)
      await sleep(600)
    },
    screenOf: (ref) =>
      page.evaluate((r) => {
        const w = window.__e2e.endpointWorld(r)
        return w ? window.__shotRig.project(w.x, w.y, w.z) : null
      }, ref),
    /** rest the mouse on a hole (a real move: the scene's hover pass sees it) */
    hover: async (hole) => {
      const p = await api.screenOf(hole)
      await page.mouse.move(p.x - 6, p.y - 4)
      await page.mouse.move(p.x, p.y, { steps: 3 })
      await sleep(250)
      return p
    },
    clickHole: async (hole) => {
      const p = await api.screenOf(hole)
      await page.mouse.move(p.x, p.y, { steps: 2 })
      await sleep(120)
      await page.mouse.click(p.x, p.y)
      await sleep(350)
    },
    toast: async () => (await page.locator('.lg-toast').last().innerText().catch(() => '')).replace(/\s+/g, ' '),
  }
  return api
}

const kind = (m) => (m.kind === 'place' ? `place:${m.type}` : m.kind)

// ---------------------------------------------------------------------------
// A. zh-TW, the desktop workspace
// ---------------------------------------------------------------------------
{
  const a = await open({})
  const { page } = a
  await a.park('e30')

  // the mouse rests on e26 in select mode — then R, no mouse move
  await a.hover('e26')
  console.log(`      (select mode: the store's hovered hole ${(await a.st()).hover})`)
  await page.keyboard.press('r')
  await sleep(150) // well under any mouse move: the ghost must be there already
  let s = await a.st()
  check(kind(s.mode) === 'place:resistor', 'R → 電阻 armed', kind(s.mode))
  check(s.hover === 'e26', 'the ghost is under the mouse at once (hoverHole e26 without a mouse move)', s.hover)
  await a.shot('01-r-ghost-at-once')
  const card = page.locator('.ws-left .ws-lib-section').first().locator('.ws-part').first()
  check((await card.innerText()).includes('放置中'), 'the 電阻 card says 「放置中」 (the card’s own armed state)')
  check((await a.toast()).includes('電阻：依序點 2 個孔位'), 'the card’s placement hint toast', await a.toast())

  await a.clickHole('e26')
  await a.clickHole('e29')
  s = await a.st()
  const r1 = s.comps.find((c) => c.id === 'R1')
  check(r1?.type === 'resistor' && JSON.stringify(r1.holes) === '["e26","e29"]', 'two clicks → R1 on e26–e29', JSON.stringify(r1))
  check(kind(s.mode) === 'place:resistor', 'repeat placement keeps the resistor armed (as from the card)')

  // L, place; C, place; P at once
  await page.keyboard.press('l')
  await sleep(150)
  check(kind((await a.st()).mode) === 'place:led', 'L → LED armed (switches from the resistor)')
  await a.hover('e31')
  await a.shot('02-l-ghost')
  await a.clickHole('e31')
  await a.clickHole('e33')
  check((await a.st()).comps.some((c) => c.id === 'LED1' && c.type === 'led'), 'two clicks → LED1')
  await page.keyboard.press('c')
  await sleep(150)
  check(kind((await a.st()).mode) === 'place:capacitor', 'C → 電容 armed')
  await a.park('e36')
  await a.clickHole('e35')
  await a.clickHole('e37')
  const c1 = (await a.st()).comps.find((c) => c.id === 'C1')
  check(c1?.type === 'capacitor', 'two clicks → C1', `${JSON.stringify(c1)} ${await a.toast()}`)
  const before = (await a.st()).comps.length
  await page.keyboard.press('p')
  await sleep(300)
  s = await a.st()
  check(s.comps.length === before + 1 && s.comps.at(-1).type === 'power_supply', 'P → a supply beside the board at once (PS2)', s.comps.at(-1)?.id)
  check(kind(s.mode) === 'select' && s.selection.join(',') === s.comps.at(-1).id, 'and selected, like its card')
  await a.shot('03-placed')

  // R R: placing stops
  await page.keyboard.press('r')
  await sleep(120)
  check(kind((await a.st()).mode) === 'place:resistor', 'R → armed')
  await page.keyboard.press('r')
  await sleep(120)
  check(kind((await a.st()).mode) === 'select', 'R again → placing stops (the armed card’s second click)')

  // a card click leaves the focus on the card; L still switches (capture phase past the panel's guardKeys)
  await page.locator('.ws-left .ws-lib-section').first().locator('.ws-part-main').first().click()
  await sleep(200)
  const focusInPanel = await page.evaluate(() => !!document.activeElement?.closest('.ws-left'))
  await a.park('a30') // (PS2 was brought into view: look at the board again)
  await a.hover('a30')
  await page.keyboard.press('l')
  await sleep(150)
  s = await a.st()
  check(focusInPanel, 'the clicked card kept the focus (inside the library panel)')
  check(kind(s.mode) === 'place:led' && s.hover === 'a30', 'L after a card click → LED, ghost under the mouse', `${kind(s.mode)} ${s.hover}`)
  await page.keyboard.press('Escape')
  await sleep(150)

  // U, Shift+R turns the ghost (with its click), R switches to the resistor
  await page.keyboard.press('u')
  await sleep(150)
  await a.park('h30')
  await a.hover('h28')
  s = await a.st()
  check(kind(s.mode) === 'place:stm32_bluepill' && (s.mode.rotation ?? 0) === 0, 'U → the Blue Pill armed')
  check((await a.toast()).includes('Shift+R 旋轉'), 'its hint names Shift+R 旋轉', await a.toast())
  await page.keyboard.press('Shift+R')
  await sleep(250)
  s = await a.st()
  check(kind(s.mode) === 'place:stm32_bluepill' && (s.mode.rotation ?? 0) !== 0, 'Shift+R turns the armed Blue Pill', `rotation ${s.mode.rotation}`)
  await a.shot('04-shift-r-bluepill')
  await page.keyboard.press('r')
  await sleep(150)
  check(kind((await a.st()).mode) === 'place:resistor', 'a plain R while the Blue Pill is armed switches to the resistor (never rotates)')
  await page.keyboard.press('Escape')
  await sleep(150)

  // C is the capacitor, not 顯示電流; Shift+C flips 顯示電流
  const flow = () => page.evaluate(async () => (await import('/src/ui/fx/flow.ts')).useFlowView.getState().visible)
  // (view keys — F, ?, Shift+C — act on the 3D view: the learner clicks the board first)
  await page.evaluate(() => document.activeElement?.blur?.())
  const flow0 = await flow()
  await page.keyboard.press('c')
  await sleep(200)
  check(kind((await a.st()).mode) === 'place:capacitor' && (await flow()) === flow0, 'C picks up a capacitor; 顯示電流 untouched')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+C')
  await sleep(200)
  check((await flow()) === !flow0, 'Shift+C flips 顯示電流', `${flow0} → ${await flow()}`)
  await page.keyboard.press('Shift+C')
  await sleep(200)
  check((await flow()) === flow0, 'Shift+C again flips it back')

  // the library search only types
  await a.setMode({ kind: 'select' })
  const search = page.locator('.ws-left input[type="search"]')
  await search.click()
  await page.keyboard.type('r')
  await sleep(200)
  check((await search.inputValue()) === 'r' && kind((await a.st()).mode) === 'select', '「r」 in the library search only types', await search.inputValue())
  await search.fill('')
  await page.evaluate(() => document.activeElement?.blur?.()) // back to the 3D view
  await page.keyboard.press('Escape')

  // Ctrl+C with nothing selected arms nothing
  await page.evaluate(async () => (await import('/src/state/store.ts')).useStore.getState().select(null))
  await page.keyboard.press('Control+c')
  await sleep(150)
  check(kind((await a.st()).mode) === 'select', 'Ctrl+C is never the capacitor')

  // keycaps: every copy of a 常用元件 card, visible on a mouse pointer
  const caps = await page.evaluate(() =>
    [...document.querySelectorAll('.ws-left .ws-part-key')].filter((k) => getComputedStyle(k).display !== 'none').map((k) => k.textContent),
  )
  check(caps.length === 20 && new Set(caps).size === 10, 'keycaps on the 10 常用元件 cards and their category copies', caps.join(''))
  const tip = await page.locator('.ws-left .ws-part-main[aria-keyshortcuts="B"]').first().getAttribute('title')
  check(tip === '按鈕（輕觸開關）（快捷鍵 B）', 'the card’s tooltip names the key', tip)
  const panel = await page.locator('.ws-left').boundingBox()
  // (the workspace panel is the dark glass; B shoots the translucent floating panel over the white board)
  await a.shot('05-keycaps', { clip: { x: panel.x, y: panel.y, width: panel.width, height: 520 } })

  // the shortcuts sheet
  await page.mouse.move(720, 500)
  await page.keyboard.press('?')
  await sleep(500)
  const sheet = (await page.locator('.app-keys').innerText().catch(() => '')).replace(/\s+/g, ' ')
  check(sheet.includes('放置元件') && sheet.includes('R 電阻') && sheet.includes('B 按鈕（輕觸開關）'), 'the sheet lists 「放置元件」 (R 電阻 … B 按鈕)', sheet.slice(0, 120))
  check(/Shift \+ R 旋轉/.test(sheet) && /Shift \+ C 顯示電流/.test(sheet), '旋轉 Shift+R, 顯示電流 Shift+C', sheet.match(/.{0,12}旋轉.{0,4}/)?.[0])
  await page.keyboard.press('r')
  await sleep(150)
  check(kind((await a.st()).mode) === 'select', 'a letter pressed while the sheet is open arms nothing')
  await a.shot('07-shortcuts-sheet')
  await page.locator('.app-keys-body').evaluate((el) => (el.scrollTop = 200))
  await sleep(150)
  await a.shot('08-shortcuts-sheet-parts')
  await page.keyboard.press('Escape')
  await sleep(300)
  check(a.errors.length === 0, 'no page errors (A)', a.errors.join(' | '))
  await a.ctx.close()
}

// ---------------------------------------------------------------------------
// B. zh-TW without the workspace: the floating 元件 panel
// ---------------------------------------------------------------------------
{
  const b = await open({ workspace: false })
  const { page } = b
  await page.locator('.lg-dock').getByText('元件', { exact: true }).first().click()
  await sleep(700)
  const caps = await page.evaluate(() =>
    [...document.querySelectorAll('.psh-card-key')].filter((k) => getComputedStyle(k).display !== 'none').map((k) => k.textContent),
  )
  check(caps.length === 10, 'the floating panel: a corner keycap on each 常用元件 card', caps.join(''))
  await b.park('e30')
  await b.hover('e30')
  await page.keyboard.press('r')
  await sleep(200)
  const s = await b.st()
  check(kind(s.mode) === 'place:resistor' && s.hover === 'e30', 'R with the panel open → 電阻 armed, ghost under the mouse', `${kind(s.mode)} ${s.hover}`)
  const armed = await page.locator('.psh-card[aria-pressed="true"]').first().innerText().catch(() => '')
  check(armed.includes('放置中'), 'its card says 「放置中」', armed.replace(/\s+/g, ' '))
  await b.shot('01-floating-panel')
  check(b.errors.length === 0, 'no page errors (B)', b.errors.join(' | '))
  await b.ctx.close()
}

// ---------------------------------------------------------------------------
// C. a touch phone: no keycaps
// ---------------------------------------------------------------------------
{
  const c = await open({ workspace: false, phone: true })
  const { page } = c
  await page.locator('.lg-dock').getByText('元件', { exact: true }).first().tap()
  await sleep(900)
  const shown = await page.evaluate(() => [...document.querySelectorAll('.psh-card-key')].filter((k) => getComputedStyle(k).display !== 'none').length)
  const cards = await page.locator('.psh-card').count()
  check(cards > 0 && shown === 0, 'a 390×844 touch phone: the sheet shows no keycaps', `${shown} of ${cards} cards`)
  await c.shot('01-phone-sheet')
  check(c.errors.length === 0, 'no page errors (C)', c.errors.join(' | '))
  await c.ctx.close()
}

// ---------------------------------------------------------------------------
// E. the sound of the turn (?shotrig mutes the page: a plain page here)
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    if (sessionStorage.getItem('partkeys.seeded')) return
    localStorage.clear()
    localStorage.setItem('bb.onboarded', '1')
    localStorage.setItem('bb.renderMode', 'performance')
    localStorage.setItem('bb.lang', 'zh-TW')
    localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: true }))
    sessionStorage.setItem('partkeys.seeded', '1')
  })
  await page.goto(`${URL}?e2e`, { timeout: 180_000 })
  await page.waitForFunction(() => !!window.__e2e, null, { timeout: 120_000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(1500)
  const started = () => page.evaluate(async () => (await import('/src/ui/fx/sound.ts')).__soundStatsForTests().started)
  await page.mouse.click(720, 880) // a gesture (the page may sound after one)
  await page.evaluate(() => document.activeElement?.blur?.())
  await page.keyboard.press('u')
  await sleep(300)
  const n0 = await started()
  await page.keyboard.press('Shift+R')
  await sleep(400)
  const n1 = await started()
  const mode = await page.evaluate(async () => (await import('/src/state/store.ts')).useStore.getState().mode)
  check(mode.kind === 'place' && (mode.rotation ?? 0) !== 0, 'E: Shift+R turned the Blue Pill', JSON.stringify(mode))
  check(n1 > n0, 'E: the turn clicks (the ghost’s rotate cue — store.rotateArmed → mech-watch)', `${n0} → ${n1}`)
  await ctx.close()
}

// ---------------------------------------------------------------------------
// D. the English classic chrome: R rotates as before, letters do nothing
// ---------------------------------------------------------------------------
{
  const d = await open({ lang: 'en', workspace: false })
  const { page } = d
  await d.park('f30')
  await d.setMode({ kind: 'place', type: 'ne555', pickedHoles: [] })
  await d.hover('f30')
  await page.keyboard.press('r')
  await sleep(200)
  let s = await d.st()
  check(kind(s.mode) === 'place:ne555' && s.mode.rotation === 180, 'classic: R turns the armed NE555 (0 → 180)', JSON.stringify(s.mode))
  await page.keyboard.press('l')
  await sleep(200)
  s = await d.st()
  check(kind(s.mode) === 'place:ne555', 'classic: L does nothing')
  await page.keyboard.press('Escape')
  await sleep(150)
  // a placed, selected chip: R turns it (rotatePlaced)
  await page.evaluate(async () => {
    const { useStore } = await import('/src/state/store.ts')
    useStore.getState().addComponent('ne555', { at: 'f30' })
    const comps = useStore.getState().layout.components
    useStore.getState().select(comps[comps.length - 1].id)
  })
  await sleep(200)
  const id = (await d.st()).selection[0]
  await page.mouse.move(720, 120)
  await page.keyboard.press('r')
  await sleep(300)
  s = await d.st()
  check(s.comps.find((c) => c.id === id)?.rotation === 180, `classic: R turns the selected ${id}`, JSON.stringify(s.comps.find((c) => c.id === id)))
  await page.locator('.lg-dock').getByText('Parts', { exact: true }).first().click()
  await sleep(700)
  check((await page.locator('.psh-card-key').count()) === 0 && (await page.locator('.psh-card[aria-keyshortcuts]').count()) === 0, 'classic: no keycaps, no announced keys')
  await d.shot('01-classic')
  check(d.errors.length === 0, 'no page errors (D)', d.errors.join(' | '))
  await d.ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
