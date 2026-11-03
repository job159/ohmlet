/**
 * Round 5 — copy / paste WITH the settings (「複製元件：Ctrl+C／V 連同參數一起複製」):
 *
 *   UX_E2E_URL=http://localhost:5173/ UX_E2E_SHOTS=<dir> node scripts/ux-e2e/copy-paste.mjs
 *
 * zh-TW with the desktop workspace (1440×900, mouse), the keys through the
 * app's real window handler (src/App.tsx → src/ui/chrome/copy-paste.ts):
 *   - Ctrl+C on R1 → 「已複製 R1——按 Ctrl+V 貼上」 (the key is taken);
 *   - Ctrl+V → R2 with R1's 330 Ω beside it (and its rail feed), selected,
 *     「已貼上 R2」 + 〔復原〕; Ctrl+Z takes it back as 「已復原：放上 R2、導線 …」;
 *   - Ctrl+V with the mouse on a free hole → the copy's top-left there;
 *   - Ctrl+D → 「已複製一份：…」; Ctrl+X → 「已剪下 R1——…」, then Ctrl+V with the
 *     mouse still resting on the part puts it back, its feed W3 too;
 *   - the selection pill's 「複製這 2 項」 copies a group at once;
 *   - selected text keeps the browser's Ctrl+C (no toast, not prevented);
 *     after a click on a part that selection is stale: Ctrl+C copies the part.
 * zh-TW without the workspace: the long-press menu's 複製 copies at once
 * (no place mode). English classic chrome: Ctrl+C / Ctrl+D are the browser's.
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

const CIRCUIT = {
  version: 1,
  name: 'copy-paste',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R1', type: 'resistor', holes: ['c10', 'c14'], params: { resistance: 330 } },
    { id: 'LED1', type: 'led', holes: ['d14', 'd18'], params: { color: 'green' } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+0', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-0', color: 'black' },
    { id: 'W3', from: 'top+5', to: 'a10', color: 'red' },
  ],
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true })

async function open({ lang = 'zh-TW', workspace = true }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([l, lg, ws]) => {
      if (sessionStorage.getItem('copypaste.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', lg)
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      localStorage.setItem('bb.layout', l)
      sessionStorage.setItem('copypaste.seeded', '1')
    },
    [JSON.stringify(CIRCUIT), lang, workspace],
  )
  await page.goto(`${URL}?e2e&shotrig`, { timeout: 180_000 })
  await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig, null, { timeout: 120_000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(1200)
  // what the app did with each key: a capture listener added after the app's sees defaultPrevented at bubble time
  await page.evaluate(() => {
    window.__keys = []
    window.addEventListener('keydown', (e) => setTimeout(() => window.__keys.push(`${e.ctrlKey ? 'Ctrl+' : ''}${e.key}:${e.defaultPrevented}`)), true)
  })
  const api = {
    page,
    ctx,
    errors,
    shot: async (name) => {
      if (!SHOTS) return
      mkdirSync(SHOTS, { recursive: true })
      await page.screenshot({ path: path.join(SHOTS, `copy-paste-${lang}${workspace ? '-ws' : ''}-${name}.png`) })
    },
    state: () => page.evaluate(() => window.__e2e.state()),
    comp: async (id) => (await api.state()).layout.components.find((c) => c.id === id),
    ids: async () => (await api.state()).layout.components.map((c) => c.id),
    screenOf: (ref) => page.evaluate((r) => {
      const w = window.__e2e.endpointWorld(r)
      return w ? window.__shotRig.project(w.x, w.y, w.z) : null
    }, ref),
    compScreen: (id, y = 0.6) =>
      page.evaluate(([i, h]) => {
        const w = window.__e2e.componentWorld(i, h)
        return w ? window.__shotRig.project(w.x, w.y, w.z) : null
      }, [id, y]),
    clickComp: async (id, mod) => {
      let p = await api.compScreen(id)
      if (!p) throw new Error(`${id} not on screen`)
      // a paste can pan the view to show the copy: bring the part back out from under a panel first
      const onCanvas = (q) => page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', [q.x, q.y])
      if (!(await onCanvas(p))) {
        await page.evaluate((i) => {
          const w = window.__e2e.componentWorld(i, 0)
          window.__shotRig.setCamera(w.x - 3, 26, w.z + 22, w.x, 0, w.z)
        }, id)
        await sleep(400)
        p = await api.compScreen(id)
      }
      if (mod) await page.keyboard.down(mod)
      await page.mouse.click(p.x, p.y)
      if (mod) await page.keyboard.up(mod)
      await sleep(450)
    },
    toast: async () => (await page.locator('.lg-toast').last().innerText().catch(() => '')).replace(/\s+/g, ' '),
    prevented: (key) => page.evaluate((k) => window.__keys.filter((x) => x.startsWith(`${k}:`)).map((x) => x.endsWith('true')), key),
  }
  return api
}

// ---------------------------------------------------------------------------
// A. zh-TW, the desktop workspace: the keys, the pill
// ---------------------------------------------------------------------------
{
  const a = await open({})
  const { page } = a
  await a.clickComp('R1')
  check((await a.state()).selection.join(',') === 'R1', 'R1 selected')

  await page.keyboard.press('Control+c')
  await sleep(300)
  check((await a.toast()).includes('已複製 R1——按 Ctrl+V 貼上'), 'Ctrl+C: 「已複製 R1——按 Ctrl+V 貼上」', await a.toast())
  check((await a.prevented('Ctrl+c')).every(Boolean), 'Ctrl+C on a selected part is taken by the app')

  // the mouse off the board: the copy goes beside the source
  const wiresBefore = (await a.state()).layout.wires.length
  await page.mouse.move(720, 60)
  await sleep(200)
  await page.keyboard.press('Control+v')
  await sleep(500)
  const r2 = await a.comp('R2')
  check(r2?.params?.resistance === 330, 'Ctrl+V: R2 keeps R1’s 330 Ω', JSON.stringify(r2))
  check((await a.state()).selection.join(',') === 'R2', 'the copy is selected')
  check((await a.state()).layout.wires.length === wiresBefore + 1, 'R1’s rail feed (W3) came along with it')
  const pasted = await a.toast()
  check(pasted.includes('已貼上 R2') && pasted.includes('復原'), 'the toast: 「已貼上 R2」 + 〔復原〕', pasted)
  await a.shot('01-pasted')

  await page.keyboard.press('Control+z')
  await sleep(400)
  check(!(await a.ids()).includes('R2'), 'Ctrl+Z: one step takes the copy back')
  check(/已復原：放上 R2、導線 W\d+/.test(await a.toast()), 'the undo names it 「已復原：放上 R2、導線 …」', await a.toast())

  // the mouse on a free hole: the copy's top-left lands there
  const at = await a.screenOf('b45')
  if (check(!!at, 'b45 on screen')) {
    await page.mouse.move(at.x, at.y)
    await sleep(300)
    await page.keyboard.press('Control+v')
    await sleep(500)
    const r = await a.comp('R2')
    const col = Number(r?.holes?.[0]?.replace(/^[a-j]/, ''))
    check(Math.abs(col - 45) <= 2, 'Ctrl+V on a free hole: the copy goes there', JSON.stringify(r?.holes))
    await a.shot('02-pasted-at-pointer')
    await page.keyboard.press('Control+z')
    await sleep(400)
  }

  // Ctrl+D: a copy beside the selection, at once
  await a.clickComp('R1')
  await page.keyboard.press('Control+d')
  await sleep(500)
  check((await a.comp('R2'))?.params?.resistance === 330, 'Ctrl+D: R2 at once, 330 Ω')
  check((await a.toast()).includes('已複製一份：R2'), 'the toast: 「已複製一份：R2」', await a.toast())
  check((await a.prevented('Ctrl+d')).every(Boolean), 'Ctrl+D is taken (no bookmark dialog) when it duplicates')
  await page.keyboard.press('Control+z')
  await sleep(400)

  // click, Ctrl+X, Ctrl+V with the mouse still resting on the part: back where it was, joined as it was
  await a.clickComp('R1')
  const before = await a.comp('R1')
  const feedBefore = (await a.state()).layout.wires.find((w) => w.id === 'W3')
  await page.keyboard.press('Control+x')
  await sleep(400)
  check(!(await a.ids()).includes('R1'), 'Ctrl+X: R1 is gone')
  check((await a.toast()).includes('已剪下 R1'), 'the toast: 「已剪下 R1——按 Ctrl+V 貼上」', await a.toast())
  check(!(await a.state()).layout.wires.some((w) => w.id === 'W3'), 'Ctrl+X took R1’s feed W3 (it would hang loose)')
  await page.keyboard.press('Control+v') // the mouse has not moved: it hovers R1's old holes
  await sleep(500)
  check(JSON.stringify((await a.comp('R1'))?.holes) === JSON.stringify(before?.holes), 'Ctrl+V with the mouse still on it: R1 back where it was', JSON.stringify((await a.comp('R1'))?.holes))
  const feedAfter = (await a.state()).layout.wires.find((w) => w.id === 'W3')
  check(JSON.stringify(feedAfter) === JSON.stringify(feedBefore), 'its feed W3 back on the same holes (still in series with LED1)', JSON.stringify(feedAfter))
  check(!(await a.toast()).includes('放不下'), 'no 「滑鼠指的地方放不下」 on its own spot', await a.toast())

  // the selection pill's 複製 (2 parts)
  await a.clickComp('R1')
  await a.clickComp('LED1', 'Shift')
  const dup = page.locator('.app-sel-pill').getByRole('button', { name: '複製這 2 項' })
  if (check((await dup.count()) === 1, 'the pill shows 「複製」 for 2 selected parts')) {
    await dup.click()
    await sleep(500)
    const ids = await a.ids()
    check(ids.includes('R2') && ids.includes('LED2'), 'pill 複製: R2 + LED2 at once', ids.join(','))
    check((await a.comp('LED2'))?.params?.color === 'green', 'LED2 keeps LED1’s green')
    await a.shot('03-pill-duplicate')
  }

  // selected text: the browser copies it
  await page.keyboard.press('Escape')
  await a.clickComp('R1')
  const toastsBefore = await page.locator('.lg-toast').count()
  await page.evaluate(() => {
    // a selectable line of text (the chrome itself is user-select: none; the UART log / lesson text are not)
    const el = document.createElement('p')
    el.textContent = 'UART: hello'
    el.style.cssText = 'position:fixed;left:8px;top:8px;user-select:text;-webkit-user-select:text;z-index:99'
    document.body.appendChild(el)
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(range)
  })
  await sleep(150) // 'selectionchange' is a task of its own
  await page.keyboard.press('Control+c')
  await sleep(300)
  const prevented = await a.prevented('Ctrl+c')
  check(prevented[prevented.length - 1] === false, 'Ctrl+C over selected text is the browser’s (not prevented)')
  check((await page.locator('.lg-toast').count()) <= toastsBefore, 'no 「已複製」 toast over selected text')
  // then a click on R1 in the 3D view: that selection is stale now (whether or not the click cleared it)
  await a.clickComp('R1')
  await page.keyboard.press('Control+c')
  await sleep(300)
  const prevented2 = await a.prevented('Ctrl+c')
  check(prevented2[prevented2.length - 1] === true, 'after a click on a part, Ctrl+C copies the part again (taken)')
  check((await a.toast()).includes('已複製 R1'), 'the toast: 「已複製 R1——按 Ctrl+V 貼上」', await a.toast())
  check(a.errors.length === 0, 'no page errors (workspace)', a.errors.join(' / '))
  await a.ctx.close()
}

// ---------------------------------------------------------------------------
// B. zh-TW without the workspace: the long-press menu's 複製 copies at once
// ---------------------------------------------------------------------------
{
  const a = await open({ workspace: false })
  const { page } = a
  const r1 = await a.compScreen('R1', 0.5)
  await page.mouse.move(r1.x, r1.y)
  await page.mouse.down()
  await sleep(900)
  await page.mouse.up()
  await sleep(500)
  const item = page.locator('.lg-asheet:visible .lg-asheet-btn', { hasText: '複製' })
  if (check((await item.count()) >= 1, 'long-press: the part menu has 複製')) {
    await item.first().click()
    await sleep(500)
    const s = await a.state()
    check(s.mode.kind === 'select', 'long-press 複製: no place mode (nothing to tap again)', JSON.stringify(s.mode))
    check(s.layout.components.find((c) => c.id === 'R2')?.params?.resistance === 330, 'long-press 複製: R2 at once with 330 Ω')
    check((await a.toast()).includes('已複製一份：R2'), 'the toast: 「已複製一份：R2」 + 〔復原〕', await a.toast())
  }
  check(a.errors.length === 0, 'no page errors (no workspace)', a.errors.join(' / '))
  await a.ctx.close()
}

// ---------------------------------------------------------------------------
// C. the English classic chrome: the browser keeps Ctrl+C / Ctrl+D
// ---------------------------------------------------------------------------
{
  const a = await open({ lang: 'en', workspace: false })
  const { page } = a
  await a.clickComp('R1')
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await sleep(400)
  check((await a.prevented('Ctrl+c')).every((x) => !x), 'classic: Ctrl+C is left to the browser')
  check(!(await a.ids()).includes('R2'), 'classic: Ctrl+V pastes nothing')
  check(a.errors.length === 0, 'no page errors (classic)', a.errors.join(' / '))
  await a.ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
