/**
 * Operation simplification — replay of the product owner's request
 * (「刪除不要 double check、導線自動顏色、載入完整答案更顯眼、常用值一鍵」):
 *
 *   UX_E2E_URL=http://localhost:5411/ UX_E2E_SHOTS=<dir> node scripts/ux-e2e/simplify-walk.mjs
 *
 * A fresh zh-TW profile with the desktop workspace (1440×900, mouse):
 *   - the wire tool shows no colour to pick — a legend 「紅＝電源正 · 黑＝地 ·
 *     其他顏色＝訊號」 and 「完成」; a wire from the LED cathode row to the
 *     − rail is stored black, the seeded wires show their role in the
 *     inspector (「紅色：電源正極（5 V 網路）」, 「黑色：接地（PS1 負端）」);
 *   - R1's common values and LED1's colours are one tap each;
 *   - 「移除 LED1」, the selection pill's 刪除 (4 parts), the Delete key and
 *     更多 → 清空麵包板 act at once (no dialog) with a 〔復原〕 toast that
 *     brings everything back; deleting the blink example's U1 and taking it
 *     back restores its firmware binding;
 *   - the lesson header shows 「載入完整答案」 next to 載入起始電路 / 檢查我的
 *     電路, the coach card 「卡住了？載入完整答案」; both load at once (one
 *     undo away) unless the load would overwrite a board's firmware (then
 *     the dialog says so).
 * Then 1366×768 (workspace), a 390×844 phone (touch: legend fits, the
 * Properties sheet's chips, long-press 刪除) and the English classic chrome
 * (its six swatches, its 移除 / 清空 confirmations — unchanged).
 *
 * Follow-up round (review F7 / F8 / F16 + contract requests):
 *   - 範例 → 開啟, 下一課 and 開始引導 replace the board at once with 〔復原〕;
 *     only a load that would overwrite firmware asks, naming the board and
 *     saying 「韌體無法復原」; the classic chrome still asks;
 *   - the wire legend never overlaps the undo pill: one compact row on
 *     375 / 390 / 430 px phones, the workspace slot at 1366 / 1440
 *     (bounding-box checks);
 *   - 更多 → 模擬 「顯示電流」, 更多 → 設定 「音效」, C in the shortcuts list;
 *   - the wire hover chip names the wire's role.
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

/** Two boxes do not overlap (touching edges are fine). */
function apart(a, b) {
  return a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5
}

/** The wire legend strip vs the undo pill: both boxes, and whether they stay apart. */
async function legendClearOfPill(page) {
  const strip = await page.locator('.app-wire-strip').boundingBox()
  const pill = await page.locator('.app-undo-pill').boundingBox()
  const pillShown = await page
    .locator('.app-undo-pill')
    .evaluate((el) => getComputedStyle(el).opacity !== '0')
    .catch(() => false)
  return { strip, pill, pillShown, ok: !!strip && (!pill || !pillShown || apart(strip, pill)) }
}

const LED_CIRCUIT = {
  version: 1,
  name: 'simplify',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'R1', type: 'resistor', holes: ['c10', 'c14'], params: { resistance: 330 } },
    { id: 'LED1', type: 'led', holes: ['d14', 'd18'] },
    { id: 'R2', type: 'resistor', holes: ['c30', 'c34'], params: { resistance: 330 } },
    { id: 'LED2', type: 'led', holes: ['d34', 'd38'] },
  ],
  // stored colours that contradict the roles: the product chrome shows the roles
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+0', color: 'yellow' },
    { id: 'W2', from: 'PS1:-', to: 'top-0', color: 'yellow' },
    { id: 'W3', from: 'top+5', to: 'a10', color: 'green' },
  ],
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true })

/** A fresh page: profile seeded once per context (a reload keeps the state). */
async function open({ width, height, lang = 'zh-TW', workspace = true, layout = LED_CIRCUIT, phone = false }) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width, height }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([l, lg, ws]) => {
      if (sessionStorage.getItem('simplify.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', lg)
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      if (l) localStorage.setItem('bb.layout', l)
      sessionStorage.setItem('simplify.seeded', '1')
    },
    [layout ? JSON.stringify(layout) : null, lang, workspace],
  )
  await page.goto(`${URL}?e2e&shotrig`, { timeout: 180_000 })
  await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig, null, { timeout: 120_000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(1200)
  const tag = `${width}${lang === 'en' ? '-en' : ''}`
  const api = {
    page,
    ctx,
    errors,
    shot: async (name) => {
      if (!SHOTS) return
      mkdirSync(SHOTS, { recursive: true })
      await page.screenshot({ path: path.join(SHOTS, `simplify-${tag}-${name}.png`) })
    },
    state: () => page.evaluate(() => window.__e2e.state()),
    /** the app's own store module (same instance), for wire selection / reads */
    store: (src, arg) =>
      page.evaluate(
        async ([s, a]) => {
          const url =
            performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/state/store.ts') ??
            '/src/state/store.ts'
          const m = await import(url)
          return new Function('st', 'a', s)(m.useStore.getState(), a)
        },
        [src, arg],
      ),
    screenOf: (ref) =>
      page.evaluate((r) => {
        const w = r.includes(':') || /^(top|bot)/.test(r) || /^[a-j]\d+$/.test(r) ? window.__e2e.endpointWorld(r) : null
        return w ? window.__shotRig.project(w.x, w.y, w.z) : null
      }, ref),
    compScreen: (id, y = 0.6) =>
      page.evaluate(
        ([i, h]) => {
          const w = window.__e2e.componentWorld(i, h)
          return w ? window.__shotRig.project(w.x, w.y, w.z) : null
        },
        [id, y],
      ),
    clickComp: async (id, mod) => {
      const p = await api.compScreen(id)
      if (!p) throw new Error(`${id} not on screen`)
      if (mod) await page.keyboard.down(mod)
      await page.mouse.click(p.x, p.y)
      if (mod) await page.keyboard.up(mod)
      await sleep(450)
    },
    ids: async () => (await api.state()).layout.components.map((c) => c.id),
    /** hover along a wire (between its two ends, at a few heights) until the 3D chip names it */
    wireChip: async (id) => {
      const w = (await api.state()).layout.wires.find((x) => x.id === id)
      if (!w) return null
      const pts = await page.evaluate(([f, t]) => [window.__e2e.endpointWorld(f), window.__e2e.endpointWorld(t)], [w.from, w.to])
      if (!pts[0] || !pts[1]) return null
      for (const y of [0.4, 0.8, 1.2, 1.8, 2.5]) {
        for (const k of [0.5, 0.4, 0.6, 0.3, 0.7]) {
          const x = pts[0].x + (pts[1].x - pts[0].x) * k
          const z = pts[0].z + (pts[1].z - pts[0].z) * k
          const p = await page.evaluate(([a, b, c]) => window.__shotRig.project(a, b, c), [x, y, z])
          if (!p) continue
          await page.mouse.move(p.x, p.y)
          await sleep(160)
          const text = await page
            .locator('.bb-hover-chip')
            .evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity !== '0' && e.textContent).map((e) => e.textContent))
          const hit = text.find((tx) => tx.startsWith(`導線 ${id} `))
          if (hit) return hit
        }
      }
      return null
    },
    toastAction: () => page.locator('.lg-toast').getByRole('button', { name: '復原' }),
    /** open confirmation action sheets (the kit ActionSheet) */
    dialogs: () => page.locator('.lg-asheet:visible').count(),
    /** the workspace Library panel on one of its tabs (opens the panel from the rail when it is folded) */
    libraryTab: async (name) => {
      const tab = page.locator('.ws-tabs').getByText(name, { exact: true })
      if (!(await tab.isVisible().catch(() => false))) {
        await page.getByRole('tab', { name: '元件' }).click()
        await sleep(500)
      }
      await tab.click()
      await sleep(400)
    },
  }
  return api
}

// ---------------------------------------------------------------------------
// A. desktop 1440×900, zh-TW, workspace
// ---------------------------------------------------------------------------
{
  const a = await open({ width: 1440, height: 900 })
  const { page } = a
  await a.shot('01-start')

  // the wire tool: a legend, no colour to pick
  await page.getByRole('tab', { name: '導線' }).click()
  await sleep(600)
  const strip = page.locator('.app-wire-strip')
  check((await strip.locator('.app-swatch').count()) === 0, 'wire mode: no colour swatches to pick')
  const legend = await strip.innerText()
  check(/紅＝電源正/.test(legend) && /黑＝地/.test(legend) && /其他顏色＝訊號/.test(legend) && /完成/.test(legend), 'wire mode: the legend 紅＝電源正 · 黑＝地 · 其他顏色＝訊號 + 完成', legend.replace(/\s+/g, ' '))
  {
    // one colour, one meaning (pass 2): the signal dots are the plain-signal colours (purple, teal, pink),
    // never a function colour (yellow = I²C SCL, green = UART TX, blue = I²C SDA)
    const dots = await strip.locator('.app-wire-legend-dot').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor))
    check(
      dots.join(' ') === 'rgb(229, 72, 77) rgb(31, 35, 42) rgb(142, 68, 173) rgb(31, 177, 169) rgb(212, 79, 158)',
      'wire mode: the legend dots — red, black, then the plain-signal purple / teal / pink',
      dots.join(' '),
    )
  }
  await a.shot('02-wire-legend')
  // LED cathode row → the − rail: black, by itself
  const from = await a.screenOf('a18')
  const to = await a.screenOf('top-12')
  await page.mouse.click(from.x, from.y)
  await sleep(300)
  await page.mouse.click(to.x, to.y)
  await sleep(600)
  const w4 = (await a.state()).layout.wires.find((w) => w.from === 'a18' && w.to === 'top-12')
  check(w4?.color === 'black', 'LED cathode → − rail is stored black (no colour chosen)', w4?.color)
  {
    const r = await legendClearOfPill(page)
    check(r.ok && r.pillShown, '1440 workspace: the legend strip and the undo pill do not overlap', JSON.stringify({ strip: r.strip, pill: r.pill }))
  }
  await a.shot('03-wired-black')
  await strip.getByRole('button', { name: '完成' }).click()
  await sleep(300)

  // the hover chip over a wire names its role (the inspector's words)
  {
    const text = await a.wireChip(w4?.id ?? 'W4')
    check(!!text && text.includes('黑色：接地（PS1 負端）') && text.endsWith('點一下選取'), 'hover chip over the new wire names its role', text ?? 'no chip found')
    await a.shot('03b-wire-chip')
    await page.mouse.move(5, 450)
    await sleep(300)
  }

  // the wire inspector names the colour's meaning
  await a.store(`st.select(${JSON.stringify(w4?.id ?? 'W4')})`)
  await sleep(500)
  const sub = async () => (await page.locator('.prs-head-sub').first().innerText()).trim()
  check((await sub()) === '黑色：接地（PS1 負端）', 'wire inspector: 「黑色：接地（PS1 負端）」', await sub())
  await a.shot('04-wire-inspector')
  await a.store("st.select('W1')")
  await sleep(400)
  check((await sub()) === '紅色：電源正極（5 V 網路）', 'wire inspector: 「紅色：電源正極（5 V 網路）」 (stored yellow)', await sub())
  await a.store("st.select('W3')")
  await sleep(400)
  check((await sub()).startsWith('紅色：電源正極'), 'the + rail\'s wire to R1 is red too (stored green)', await sub())
  check((await page.locator('.prs-body [role="radiogroup"]').count()) === 0, 'wire inspector: no colour editor')

  // one-tap common values
  await a.clickComp('R1')
  const chips = page.locator('.prs-chips-wrap .prs-chip')
  check((await chips.allInnerTexts()).join(' ') === '220 Ω 330 Ω 1 kΩ 4.7 kΩ 10 kΩ', 'R1: the five common values', (await chips.allInnerTexts()).join(' '))
  await page.getByRole('button', { name: '1 kΩ' }).click()
  await sleep(300)
  check((await a.state()).layout.components.find((c) => c.id === 'R1').params.resistance === 1000, 'R1: 1 kΩ in one tap')
  await a.shot('05-r1-quick')
  await a.clickComp('LED1')
  await page.getByRole('radio', { name: '藍色' }).click()
  await sleep(300)
  check((await a.state()).layout.components.find((c) => c.id === 'LED1').params?.color === 'blue', 'LED1: blue in one tap')
  await a.shot('06-led-colors')

  // 移除 acts at once, 〔復原〕 brings it back
  await page.getByRole('button', { name: /移除 LED1/ }).click()
  await sleep(350)
  check((await a.dialogs()) === 0 && !(await a.ids()).includes('LED1'), 'inspector 移除: gone at once, no dialog')
  const toast = (await page.locator('.lg-toast').last().innerText()).replace(/\s+/g, ' ')
  check(/已刪除 LED1/.test(toast) && /復原/.test(toast), 'the toast says what went, with 〔復原〕', toast)
  await a.shot('07-removed-toast')
  await a.toastAction().click()
  await sleep(400)
  check((await a.ids()).includes('LED1'), '〔復原〕 brings LED1 back')

  // the selection pill's 刪除 (4 parts — the classic chrome confirmed above 3)
  await a.clickComp('R1')
  await a.clickComp('LED1', 'Shift')
  await a.clickComp('R2', 'Shift')
  await a.clickComp('LED2', 'Shift')
  check((await a.state()).selection.length === 4, '4 parts selected')
  await page.locator('.app-sel-pill').getByRole('button', { name: /刪除/ }).click()
  await sleep(400)
  check((await a.dialogs()) === 0 && (await a.ids()).join(',') === 'PS1', 'pill 刪除 ×4: gone at once, no dialog')
  await a.shot('08-group-deleted')
  await a.toastAction().click()
  await sleep(400)
  check((await a.ids()).length === 5, '〔復原〕 brings all four back')

  // Delete key
  await a.clickComp('R2')
  await page.keyboard.press('Delete')
  await sleep(350)
  check(!(await a.ids()).includes('R2') && /復原/.test(await page.locator('.lg-toast').last().innerText()), 'Delete key: gone at once, toast with 〔復原〕')
  await a.toastAction().click()
  await sleep(300)

  // 更多 → 清空麵包板
  await page.getByRole('tab', { name: '更多' }).click()
  await sleep(600)
  await page.getByRole('button', { name: /清空麵包板/ }).first().click()
  await sleep(500)
  check((await a.dialogs()) === 0 && (await a.ids()).length === 0, '清空麵包板: cleared at once, no dialog')
  await a.shot('09-cleared')
  await a.toastAction().click()
  await sleep(500)
  check((await a.ids()).length === 5 && (await a.state()).layout.wires.length === 4, '〔復原〕 brings the whole board back')
  await page.keyboard.press('Escape')
  await sleep(300)

  // the blink example: deleting U1 and taking it back restores its firmware
  await a.libraryTab('範例')
  await sleep(400)
  const openBlink = page.locator('[data-example="blink"] .ws-open-pill')
  const exConfirm = page.locator('[role="dialog"] button.is-destructive, [role="dialog"] [data-destructive]')
  const note = (await page.locator('.ws-lib .ws-note').last().innerText()).trim()
  check(note.startsWith('開啟範例會取代目前的電路（按 ↶ 可復原）。') && !note.includes('韌體無法復原'), 'library note: no firmware sentence without firmware on the board', note)
  // F7: over a board without firmware 開啟 acts at once — the toast carries 〔復原〕
  await openBlink.scrollIntoViewIfNeeded()
  await openBlink.click()
  await page.waitForFunction(() => !!window.__e2e.state().firmware?.U1, null, { timeout: 30_000 })
  await sleep(500)
  {
    // (at 1440 the library also folds away for the circuit — its own toast stacks under this one)
    const toast = (await page.locator('.lg-toast', { hasText: '已開啟' }).allInnerTexts()).join(' / ').replace(/\s+/g, ' ')
    check((await a.dialogs()) === 0 && /已開啟「Blue Pill 閃爍 LED（HAL）」/.test(toast) && /復原/.test(toast), '範例 → 開啟 over the LED board: at once, no dialog, 〔復原〕 in the toast', toast)
    await a.shot('08b-example-opened')
    await a.toastAction().click()
    await sleep(600)
    check((await a.ids()).includes('LED1') && !(await a.ids()).includes('U1'), '〔復原〕 brings the LED board back')
  }
  await a.libraryTab('範例')
  await sleep(400)
  await openBlink.scrollIntoViewIfNeeded()
  await openBlink.click()
  await page.waitForFunction(() => !!window.__e2e.state().firmware?.U1 && window.__e2e.state().layout.components.some((c) => c.id === 'U1'), null, { timeout: 30_000 })
  await sleep(500)
  // one colour, one meaning (pass 2): the blink circuit's PA5 GPIO line is a plain-signal purple,
  // not the I²C-clock yellow the user guide's table reserves
  await a.store("st.select('W7')")
  await sleep(500)
  check((await sub()) === '紫色：訊號（U1 PA5）', 'blink W7 (PA5 → R1): 「紫色：訊號（U1 PA5）」 — a plain-signal colour', await sub())
  await a.shot('08d-blink-pa5-purple')
  await a.store('st.select(null)')
  await sleep(300)
  // …over a board whose firmware would be overwritten it asks — naming the board, saying 「韌體無法復原」
  await a.libraryTab('範例')
  await sleep(400)
  {
    const note2 = (await page.locator('.ws-lib .ws-note').last().innerText()).trim()
    check(note2.includes('U1 已載入的韌體無法復原，開啟前會先詢問。'), 'library note: the firmware sentence once U1 has firmware', note2)
    const other = page.locator('[data-example="button-exti"] .ws-open-pill')
    await other.scrollIntoViewIfNeeded()
    await other.click()
    await sleep(600)
    const sheet = page.locator('.lg-asheet:visible')
    const text = (await sheet.count()) ? (await sheet.innerText()).replace(/\s+/g, ' ') : ''
    check(/要取代電路和 U1 的韌體嗎？/.test(text) && /U1 的 hal-blink\.elf/.test(text) && /韌體無法復原/.test(text), '開啟 over U1’s firmware: the dialog names U1 and its file, 「韌體無法復原」', text)
    await a.shot('08c-example-firmware-dialog')
    await page.keyboard.press('Escape')
    await sleep(500)
    check((await a.state()).firmware.U1?.name === 'hal-blink.elf' && (await a.ids()).includes('U1'), 'Escape: nothing changed (U1 keeps hal-blink)')
  }
  const fw = (await a.state()).firmware.U1
  await sleep(800)
  await a.clickComp('U1')
  await page.keyboard.press('Delete')
  await sleep(600)
  check(!(await a.ids()).includes('U1'), 'blink: U1 deleted at once')
  await a.toastAction().click()
  await page.waitForFunction(() => !!window.__e2e.state().firmware?.U1, null, { timeout: 15_000 }).catch(() => {})
  const back = (await a.state()).firmware.U1
  check((await a.ids()).includes('U1') && back?.sha256 === fw?.sha256, '〔復原〕 brings U1 back with its firmware binding', back?.name)
  // …and so does 清空麵包板's 〔復原〕
  await page.getByRole('tab', { name: '更多' }).click()
  await sleep(600)
  await page.getByRole('button', { name: /清空麵包板/ }).first().click()
  await sleep(600)
  check((await a.ids()).length === 0, 'blink: 清空麵包板 at once')
  await a.toastAction().click()
  await page.waitForFunction(() => !!window.__e2e.state().firmware?.U1, null, { timeout: 15_000 }).catch(() => {})
  check((await a.state()).firmware.U1?.sha256 === fw?.sha256, '清空麵包板 → 〔復原〕 brings the board back with U1\'s firmware binding')
  await page.keyboard.press('Escape')
  await sleep(400)

  // lessons: 載入完整答案 in the header and the coach
  await a.libraryTab('課程')
  await sleep(400)
  await page.locator('.lsn-card', { hasText: 'LED 與限流電阻' }).click()
  await sleep(500)
  const actions = page.locator('.lsn-actions')
  const labels = (await actions.locator('button').allInnerTexts()).map((s) => s.trim())
  check(labels.includes('載入起始電路') && labels.includes('載入完整答案'), 'lesson header: 載入起始電路 + 載入完整答案 side by side', labels.join(' | '))
  check((await actions.getByRole('button', { name: '載入完整答案' }).getAttribute('class'))?.includes('tinted'), '載入完整答案 is a tinted button')
  await a.shot('10-lesson-header')
  // the board holds the blink example: b1 has no MCU of its own → U1's binding survives an undo → no dialog
  await actions.getByRole('button', { name: '載入起始電路' }).click()
  await sleep(500)
  check((await a.dialogs()) === 0, 'b1 載入起始電路 over the blink board: no dialog (the undo restores it, firmware too)')
  await page.locator('.lsn-coach').waitFor({ state: 'visible', timeout: 20_000 })
  await sleep(1200)
  const calm = page.locator('.lsn-coach .lsn-coach-answer')
  check((await calm.count()) === 1 && (await calm.innerText()).trim() === '卡住了？載入完整答案', 'coach card: 「卡住了？載入完整答案」')
  await a.shot('11-coach-calm')
  await calm.click()
  await sleep(2500)
  const st = await a.state()
  check((await a.dialogs()) === 0 && st.layout.wires.some((w) => w.from.startsWith('DMM1')), 'the full answer loads at once (its meter leads are on the board)')
  check((await calm.count()) === 0, 'the coach stops offering the answer once it is loaded')
  await a.shot('12-answer-loaded')
  check(a.errors.length === 0, 'desktop: no page errors', a.errors.join(' / '))

  // F7: 下一課 after the pass and 開始引導 off the lesson's circuit load at once, with 〔復原〕
  await page.locator('.lsn-actions').getByRole('button', { name: '檢查我的電路' }).first().click()
  const next = page.getByRole('button', { name: /下一課：電阻分壓/ }).first()
  await next.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {})
  if (check(await next.isVisible(), 'b1 passes: 「下一課：電阻分壓 →」 shows')) {
    await sleep(3500) // past the celebration
    await next.click()
    await sleep(1500)
    const toast = (await page.locator('.lg-toast').last().innerText()).replace(/\s+/g, ' ')
    check((await a.dialogs()) === 0 && (await a.ids()).includes('DMM2') && /已載入「電阻分壓」的起始電路/.test(toast) && /復原/.test(toast), '下一課: b2’s circuit at once, no dialog, 〔復原〕 in the toast', toast)
    await a.shot('12b-next-lesson')
  }
  await a.libraryTab('課程')
  await sleep(300)
  {
    const allL = page.getByRole('button', { name: /所有課程/ })
    if (await allL.count()) await allL.first().click()
    await sleep(300)
    await page.locator('.lsn-card', { hasText: 'LED 與限流電阻' }).first().click()
    await sleep(500)
    const start = page.locator('.lsn-actions').getByRole('button', { name: '開始引導' })
    if (check((await start.count()) === 1, 'b1 off its circuit offers 開始引導')) {
      await start.click()
      await sleep(1500)
      const toast = (await page.locator('.lg-toast').last().innerText()).replace(/\s+/g, ' ')
      check((await a.dialogs()) === 0 && (await a.ids()).includes('LED1') && /復原/.test(toast), '開始引導: b1’s start at once, no dialog, 〔復原〕', toast)
      await a.shot('12c-start-guide')
    }
  }

  // a load that would overwrite firmware asks — and says why
  await a.libraryTab('範例')
  await sleep(400)
  await openBlink.scrollIntoViewIfNeeded()
  await openBlink.click()
  await sleep(400)
  if (await exConfirm.count()) await exConfirm.first().click()
  await page.waitForFunction(() => !!window.__e2e.state().firmware?.U1 && window.__e2e.state().layout.components.some((c) => c.id === 'U1'), null, { timeout: 30_000 })
  await a.libraryTab('課程')
  await sleep(300)
  const allLessons = page.getByRole('button', { name: /所有課程/ })
  if (await allLessons.count()) await allLessons.first().click()
  await sleep(300)
  // i7 (I²C) is not the blink board's lesson, and its circuit gives U1 a firmware of its own
  await page.locator('.lsn-card', { hasText: 'I²C 匯流排' }).first().click()
  await sleep(500)
  await page.locator('.lsn-actions').getByRole('button', { name: '載入完整答案' }).click()
  await sleep(500)
  const sheet = page.locator('.lg-asheet:visible')
  const sheetText = (await sheet.count()) ? (await sheet.innerText()).replace(/\s+/g, ' ') : ''
  check(
    /韌體無法復原/.test(sheetText) && /載入完整答案/.test(sheetText) && /U1 的 hal-blink\.elf/.test(sheetText) && /要取代電路和 U1 的韌體嗎？/.test(sheetText),
    'i7 over the blink board: the dialog names U1 and says the firmware cannot be undone',
    sheetText,
  )
  check((await a.state()).layout.components.some((c) => c.type === 'stm32_bluepill') && (await a.state()).firmware.U1?.name === 'hal-blink.elf', 'nothing changed before the answer')
  await a.shot('13-firmware-dialog')
  await page.keyboard.press('Escape')
  await sleep(400)

  // 更多: 顯示電流 after the speed row, 音效 in 設定; the shortcuts list names C
  await page.getByRole('tab', { name: '更多' }).click()
  await sleep(700)
  {
    const panel = page.locator('.asm-sheet').first()
    const txt = (await panel.innerText()).replace(/\s+/g, ' ')
    const speed = txt.indexOf('模擬速度（倍速）')
    const flow = txt.indexOf('顯示電流')
    const reset = txt.indexOf('重置模擬')
    check(speed > 0 && flow > speed && reset > flow, '更多 → 模擬: 顯示電流 right after the speed row', `${speed} ${flow} ${reset}`)
    // pass 2: 「0.1 倍」…「10 倍」 each on one line (they wrapped to 「0.1／倍」)
    const seg = await panel.locator('[role="radiogroup"][aria-label="模擬速度"]').first().evaluate((el) =>
      [...el.querySelectorAll('.lg-seg-item')].map((b) => {
        const range = document.createRange()
        range.selectNodeContents(b)
        return { text: b.textContent, lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size, h: Math.round(b.getBoundingClientRect().height) }
      }),
    )
    check(seg.length === 5 && seg.every((x) => x.lines === 1 && x.h <= 40), '更多 → 模擬速度: every option on one line', JSON.stringify(seg))
    const settings = txt.indexOf('介面語言')
    check(settings > 0 && txt.indexOf('音效', settings) > settings, '更多 → 設定: 音效')
    await panel.getByText('顯示電流', { exact: true }).first().scrollIntoViewIfNeeded()
    await a.shot('14-more-rows')
    const flowSw = panel.getByRole('switch', { name: '顯示電流' })
    check((await flowSw.count()) === 1, '顯示電流 switch present')
    const before = await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/ui/fx/flow.ts') ?? '/src/ui/fx/flow.ts'
      return (await import(url)).useFlowView.getState().visible
    })
    await flowSw.first().click()
    await sleep(300)
    const after = await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/ui/fx/flow.ts') ?? '/src/ui/fx/flow.ts'
      return (await import(url)).useFlowView.getState().visible
    })
    check(after === !before, '顯示電流 switch flips the preference', `${before} → ${after}`)
    await panel.getByText('音效', { exact: true }).first().scrollIntoViewIfNeeded()
    await a.shot('14b-more-sound')
    check((await panel.getByRole('switch', { name: '音效' }).count()) === 1, '音效 switch present')
  }
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.mouse.click(5, 450)
  await page.keyboard.press('?')
  await sleep(500)
  {
    const card = page.locator('.app-keys-card')
    const keys = (await card.count()) ? (await card.innerText()).replace(/\s+/g, ' ') : ''
    check(/C 顯示電流/.test(keys), 'shortcuts list: C 顯示電流', keys.slice(0, 240))
    await a.shot('15-shortcuts')
  }
  await page.keyboard.press('Escape')
  check(a.errors.length === 0, 'desktop: no page errors (end)', a.errors.join(' / '))
  await a.ctx.close()
}

// ---------------------------------------------------------------------------
// A2. desktop 1440×900, zh-TW without the workspace: the long-press menu's 刪除
// ---------------------------------------------------------------------------
{
  const a = await open({ width: 1440, height: 900, workspace: false })
  const { page } = a
  const r1 = await a.compScreen('R1', 0.5)
  await page.mouse.move(r1.x, r1.y)
  await page.mouse.down()
  await sleep(900)
  await page.mouse.up()
  await sleep(500)
  const del = page.locator('.lg-asheet:visible .lg-asheet-btn.is-destructive')
  if (check((await del.count()) === 1, 'long-press: the part menu opens (its 刪除 is a menu item, not a confirmation)')) {
    await a.shot('14-longpress-menu')
    await del.click()
    await sleep(500)
    check((await a.dialogs()) === 0 && !(await a.ids()).includes('R1'), 'long-press 刪除: gone at once')
    check(/已刪除 R1/.test(await page.locator('.lg-toast').last().innerText()), 'long-press 刪除: the toast names R1, with 〔復原〕')
    await a.toastAction().click()
    await sleep(400)
    check((await a.ids()).includes('R1'), '〔復原〕 restores R1')
  }
  check(a.errors.length === 0, 'desktop (no workspace): no page errors', a.errors.join(' / '))
  await a.ctx.close()
}

// ---------------------------------------------------------------------------
// B. desktop 1366×768
// ---------------------------------------------------------------------------
{
  const b = await open({ width: 1366, height: 768 })
  const { page } = b
  await page.getByRole('tab', { name: '導線' }).click()
  await sleep(500)
  const box = await page.locator('.app-wire-strip').boundingBox()
  check(!!box && box.x >= 0 && box.x + box.width <= 1366, '1366: the legend strip fits', JSON.stringify(box))
  {
    const from = await b.screenOf('a18')
    const to = await b.screenOf('top-12')
    await page.mouse.click(from.x, from.y)
    await sleep(300)
    await page.mouse.click(to.x, to.y)
    await sleep(600)
    const r = await legendClearOfPill(page)
    check(r.ok && r.pillShown && r.strip.height <= 56, '1366 workspace: one-row legend strip, clear of the undo pill', JSON.stringify({ strip: r.strip, pill: r.pill }))
  }
  await b.shot('01-wire-legend')
  await page.keyboard.press('Escape')
  await b.clickComp('R1')
  check((await page.locator('.prs-chips-wrap .prs-chip').count()) === 5, '1366: R1 quick picks')
  await b.shot('02-r1')
  await b.libraryTab('課程')
  await sleep(300)
  await page.locator('.lsn-card').first().click()
  await sleep(400)
  check((await page.locator('.lsn-actions').getByRole('button', { name: '載入完整答案' }).count()) === 1, '1366: 載入完整答案 in the header')
  await b.shot('03-lesson')
  await b.ctx.close()
}

// ---------------------------------------------------------------------------
// C0. phones 375 / 390 / 430 (touch): the wire legend is one row, clear of the undo pill (F8)
// ---------------------------------------------------------------------------
for (const [w, h] of [
  [375, 667],
  [390, 844],
  [430, 932],
]) {
  const c = await open({ width: w, height: h, workspace: false, phone: true })
  const { page } = c
  await page.getByRole('tab', { name: '導線' }).tap()
  await sleep(900)
  const r = await legendClearOfPill(page)
  // what a person SEES (the full words are visually hidden — kept for screen readers)
  const legend = await page
    .locator('.app-wire-strip .app-wire-legend-text, .app-wire-strip .app-wire-legend-short, .app-wire-strip .app-wire-done')
    .evaluateAll((els) =>
      els
        .filter((e) => {
          const r = e.getBoundingClientRect()
          return r.width > 2 && r.height > 2 && getComputedStyle(e).display !== 'none'
        })
        .map((e) => e.textContent.trim())
        .join(' '),
    )
  check(r.ok && r.pillShown, `${w}×${h}: the legend strip and the undo pill do not overlap`, JSON.stringify({ strip: r.strip, pill: r.pill }))
  check(!!r.strip && r.strip.height <= 56 && r.strip.x >= 15.5 && r.strip.x + r.strip.width <= w - 15.5, `${w}×${h}: one row inside the 16 px gutters`, JSON.stringify(r.strip))
  check(legend === '電源正 地 訊號 完成', `${w}×${h}: 「● 電源正 ● 地 ●●● 訊號 │ 完成」`, legend)
  const sr = await page.locator('.app-wire-legend-text').allTextContents()
  check(sr.join('|') === '紅＝電源正|黑＝地|其他顏色＝訊號', `${w}×${h}: the full words stay for screen readers`, sr.join('|'))
  await c.shot(`00-wire-legend-${w}`)
  check(c.errors.length === 0, `${w}×${h}: no page errors`, c.errors.join(' / '))
  await c.ctx.close()
}

// ---------------------------------------------------------------------------
// C. phone 390×844 (touch)
// ---------------------------------------------------------------------------
{
  const c = await open({ width: 390, height: 844, workspace: false, phone: true })
  const { page } = c
  await page.getByRole('tab', { name: '導線' }).tap()
  await sleep(600)
  const box = await page.locator('.app-wire-strip').boundingBox()
  check(!!box && box.x >= 8 && box.x + box.width <= 382, 'phone: the legend strip fits inside the 16 px gutters', JSON.stringify(box))
  const done = await page.locator('.app-wire-done').boundingBox()
  check(!!done && done.height >= 34 && done.x + done.width <= 382, 'phone: 完成 stays whole', JSON.stringify(done))
  await c.shot('01-wire-legend')
  await page.locator('.app-wire-done').tap()
  await sleep(400)
  const r1 = await c.compScreen('R1')
  await page.touchscreen.tap(r1.x, r1.y)
  await sleep(900)
  check((await page.locator('.prs-chips-wrap .prs-chip').count()) === 5, 'phone: the Properties sheet shows R1\'s quick picks')
  await c.shot('02-r1-sheet')
  await page.getByRole('button', { name: '220 Ω' }).tap()
  await sleep(300)
  check((await c.state()).layout.components.find((x) => x.id === 'R1').params.resistance === 220, 'phone: 220 Ω in one tap')
  // a finger drags the sheet up to its full detent, then scrolls to 「移除 R1」
  {
    const grab = await page.locator('.lg-sheet-grabber').first().boundingBox()
    const cdp = await c.ctx.newCDPSession(page)
    const x = grab.x + grab.width / 2
    let y = grab.y + grab.height / 2
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 0; i < 12; i++) {
      y -= 30
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
      await sleep(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(700)
    await page.getByRole('button', { name: /移除 R1/ }).evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await sleep(300)
  }
  await page.getByRole('button', { name: /移除 R1/ }).tap()
  await sleep(500)
  check((await c.dialogs()) === 0 && !(await c.ids()).includes('R1'), 'phone: 移除 acts at once')
  await c.shot('03-removed')
  await c.toastAction().tap()
  await sleep(400)
  check((await c.ids()).includes('R1'), 'phone: 〔復原〕 restores R1')
  // the sheet header's trash: one tap at the half detent, where the part's name is
  {
    await c.store('st.select(null)')
    await sleep(900)
    const ledAt = await c.compScreen('LED1', 0.6)
    await page.touchscreen.tap(ledAt.x, ledAt.y)
    await sleep(900)
    if ((await c.state()).selection[0] !== 'LED1') await c.store("st.select('LED1')")
    await sleep(600)
    const trash = page.getByRole('button', { name: '刪除 LED1' })
    const tb = await trash.boundingBox()
    check(!!tb && tb.y > 0 && tb.y + tb.height < 844, 'phone: the header trash shows at the half detent', JSON.stringify(tb))
    await trash.tap()
    await sleep(500)
    check((await c.dialogs()) === 0 && !(await c.ids()).includes('LED1'), 'phone: header trash deletes at once')
    await c.shot('03b-header-trash')
    await c.toastAction().tap()
    await sleep(400)
    check((await c.ids()).includes('LED1'), 'phone: 〔復原〕 restores LED1')
  }
  // 更多 → 清空麵包板 on a phone: at once, 〔復原〕 brings it back
  // (a long-press on a part over the board opens the probe menu in this chrome — SC-14;
  // the object menu's 刪除 shares the Delete key's deletedToast, checked on the desktop)
  await c.store('st.select(null)')
  await sleep(800)
  await page.getByRole('tab', { name: '更多' }).tap()
  await sleep(900)
  const clear = page.getByRole('button', { name: /清空麵包板/ }).first()
  await clear.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await sleep(300)
  await clear.tap()
  await sleep(500)
  check((await c.dialogs()) === 0 && (await c.ids()).length === 0, 'phone: 清空麵包板 at once')
  await c.shot('04-cleared')
  await c.toastAction().tap()
  await sleep(500)
  check((await c.ids()).length === 5, 'phone: 〔復原〕 brings the board back')
  await page.keyboard.press('Escape').catch(() => {})
  await c.store('st.select(null)')
  await sleep(600)
  check(c.errors.length === 0, 'phone: no page errors', c.errors.join(' / '))
  // the lessons sheet: 載入完整答案 among the header actions
  await page.getByRole('tab', { name: '課程' }).tap()
  await sleep(800)
  await page.locator('.lsn-card').first().tap()
  await sleep(600)
  check((await page.locator('.lsn-actions').getByRole('button', { name: '載入完整答案' }).count()) === 1, 'phone: 載入完整答案 in the lesson header')
  await c.shot('04-lesson')
  await c.ctx.close()
}

// ---------------------------------------------------------------------------
// D. the English classic chrome keeps its UI
// ---------------------------------------------------------------------------
{
  const d = await open({ width: 1440, height: 900, lang: 'en', workspace: false })
  const { page } = d
  await page.getByRole('tab', { name: 'Wire' }).click()
  await sleep(500)
  check((await page.locator('.app-wire-strip .app-swatch').count()) === 6, 'classic: the six colour swatches')
  check((await page.locator('.app-wire-legend').count()) === 0, 'classic: no legend')
  await d.shot('01-swatches')
  await page.keyboard.press('Escape')
  await d.clickComp('R1')
  await sleep(500)
  check((await page.locator('.prs-chips-wrap').count()) === 0 && (await page.locator('.prs-chips .prs-chip').count()) === 16, 'classic: the E12 scroller, no quick-pick row')
  await page.getByRole('button', { name: /Remove R1/ }).click()
  await sleep(500)
  check((await d.ids()).includes('R1') && (await page.locator('[role="dialog"]').filter({ hasText: 'R1' }).count()) > 0, 'classic: Remove asks first')
  await d.shot('02-remove-confirm')
  await page.keyboard.press('Escape')
  await sleep(400)
  // the classic More sheet's example list still asks before replacing the board, in its own words
  await page.getByRole('tab', { name: 'More' }).click()
  await sleep(800)
  {
    const row = page.locator('.asm-sheet').getByText('Blue Pill 閃爍 LED（HAL）', { exact: true }).first()
    if (await row.count()) {
      await row.scrollIntoViewIfNeeded()
      await row.click()
      await sleep(600)
      const sheetText = (await page.locator('.lg-asheet:visible').allInnerTexts()).join(' ').replace(/\s+/g, ' ')
      check(/Replace the current circuit\?/.test(sheetText) && /and the loaded firmware\./.test(sheetText) && (await d.ids()).includes('R1'), 'classic: opening an example still asks, in its old words', sheetText.slice(0, 200))
      await d.shot('03-example-confirm')
      await page.keyboard.press('Escape')
      await sleep(400)
    } else {
      check(false, 'classic: the More sheet lists the examples')
    }
    const more = (await page.locator('.asm-sheet').first().innerText()).replace(/\s+/g, ' ')
    check(!/Show current|Sound/.test(more), 'classic: no 顯示電流 / 音效 rows in More', more.slice(0, 160))
    const speedCls = await page.locator('[role="radiogroup"][aria-label="Simulation speed"]').first().getAttribute('class')
    check(speedCls?.trim() === 'lg-seg', 'classic: the speed row keeps its original control', speedCls ?? 'none')
  }
  await page.keyboard.press('Escape')
  await sleep(300)
  check(d.errors.length === 0, 'classic: no page errors', d.errors.join(' / '))
  await d.ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
