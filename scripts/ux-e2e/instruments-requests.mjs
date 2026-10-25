/**
 * UX requests round — instruments replay: every link between a probe action
 * and the instrument it names LANDS there, on the desktop and on a phone
 * (UX_VERIFY §5.4 link matrix, SC-14 (3), SC-13 (4), IN-15).
 *
 *   1. desktop 「Blue Pill 閃爍 LED」: the probe menu's 「在邏輯分析儀中顯示（PA5 LED）」
 *      switches the tray to the analyzer and flashes the PA5 row (label and
 *      trace band); adding the same net again flashes it too;
 *   2. desktop 「PWM 呼吸燈」: 「在示波器中顯示（CH1）」 switches to the scope and
 *      flashes the CH1 chip; the trigger mode is never a bare 自動 (the trigger chip
 *      「觸發：… · 自動」 opens 觸發設定, whose 模式 row offers 自動／一般／單次);
 *   3. a wire end moved to other ends takes their convention colour, and one
 *      undo restores the end AND the colour (store.moveWireEnd's colour option);
 *   4. phone 390 × 844: 加入邏輯分析儀 on the probe sheet keeps the board in
 *      view, its toast's 「在儀器中查看」 opens 儀器 on 邏輯 with the new row
 *      flashing; the open sheet follows a reveal to 日誌; the duplicate scope
 *      probe toast's 「仍要再放一支」 places the second probe;
 *   5. the classic chrome (English, no workspace): nothing of this happens.
 *
 *   UX_E2E_URL=http://localhost:5325/ node scripts/ux-e2e/instruments-requests.mjs
 *
 * Needs a dev server WITHOUT hot reload (modules are imported from /src).
 * msedge, headless. Exit 1 on failure.
 */
import { chromium } from 'playwright'

const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const CHANNEL = process.env.UX_E2E_CHANNEL ?? 'msedge'
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}

async function boot(browser, { phone = false, lang = 'zh-TW', shotrig = false } = {}) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([ws, lg]) => {
      if (sessionStorage.getItem('ux-e2e-seeded')) return
      sessionStorage.setItem('ux-e2e-seeded', '1')
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.layout', JSON.stringify({ version: 1, components: [], wires: [] }))
      localStorage.setItem('bb.renderMode', 'performance')
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      localStorage.setItem('bb.lang', lg)
    },
    [!phone, lang],
  )
  // the app's boot is not under test: on a loaded machine (several dev servers and browsers)
  // the 'load' event took 3–116 s (measured in the release triage), past goto's 30 s default
  await page.goto(`${URL}${URL.includes('?') ? '&' : '?'}e2e${shotrig ? '&shotrig' : ''}`, { timeout: 180000 })
  await page.waitForSelector('canvas', { timeout: 120000 })
  await page.waitForFunction((rig) => !!window.__e2e && (!rig || !!window.__shotRig), shotrig, { timeout: 60000 })
  await page.evaluate(() => window.__e2e.ready())
  return { ctx, page, errors }
}

/**
 * Wait until the run reaches `s` seconds of SIMULATED time. Bounded by progress,
 * not by wall time: on a loaded machine the same run went 0.008–0.09× real time
 * and its first simulated tick came 15 s to over 90 s after ▶ (release triage),
 * so a fixed 180 s budget failed healthy runs. A run that never starts within
 * `startMs`, or stops advancing for `stallMs`, still fails — naming where it
 * stopped and whether the store says it is running.
 */
async function waitSim(page, s, stallMs = 90000, startMs = 300000) {
  const t0 = await page.evaluate(() => window.__e2e.state().simTime)
  let last = t0
  let since = Date.now()
  for (;;) {
    const st = await page.evaluate(() => {
      const x = window.__e2e.state()
      return { t: x.simTime, running: x.running }
    })
    if (st.t >= s) return st.t
    if (st.t > last) {
      last = st.t
      since = Date.now()
    } else {
      const limit = last === t0 ? startMs : stallMs
      if (Date.now() - since > limit) {
        throw new Error(`simulated time stayed at ${st.t} s for ${limit / 1000} s (waiting for ${s} s; running: ${st.running})`)
      }
    }
    await page.waitForTimeout(250)
  }
}

const withModule = (page, path, fn, arg) =>
  page.evaluate(
    async ([p, src, a]) => {
      const m = await import(p)
      return await new Function('m', 'a', `return (async () => { ${src} })()`)(m, a)
    },
    [path, fn, arg],
  )
const open = (page, id) => withModule(page, '/src/ui/workspace/examples.ts', 'return await m.openExampleById(a)', id)
const runTo = async (page, s) => {
  await withModule(page, '/src/state/store.ts', 'm.useStore.getState().startSim()')
  await waitSim(page, s)
}
const menuItem = (page, target, key) =>
  withModule(
    page,
    '/src/ui/workspace/ProbeMenu.tsx',
    'const it = m.probeMenuModel(a.target).items.find((x) => x.key === a.key); if (!it) return null; it.run(); return it.label',
    { target, key },
  )
const tray = (page) => withModule(page, '/src/ui/embedded/lab.ts', 'return m.useLab.getState().workspace.tray')
const sheetView = (page) => page.locator('.asm-sheet .lg-seg-item[aria-checked="true"]').first().innerText().catch(() => '')
const toastTexts = async (page) => (await page.locator('.lg-toast').allInnerTexts()).map((x) => x.replace(/\n/g, ' '))
const probes = (page) =>
  withModule(page, '/src/state/store.ts', "return m.useStore.getState().layout.components.filter((c) => c.type === 'scope_probe').length")

const browser = await chromium.launch({ channel: CHANNEL === 'bundled' ? undefined : CHANNEL })
try {
  // ---- 1–3: desktop workspace
  {
    const { ctx, page, errors } = await boot(browser)
    await open(page, 'blink')
    await page.waitForTimeout(800)
    await runTo(page, 1.0)
    await withModule(page, '/src/ui/embedded/lab.ts', "const l = m.useLab.getState(); l.setWorkspace({ tray: { ...l.workspace.tray, open: true, tab: 'scope' } })")
    await page.waitForTimeout(500)
    const label = await menuItem(page, { kind: 'mcu-pin', componentId: 'U1', pin: 'PA5' }, 'logic')
    await page.waitForTimeout(250)
    const t1 = await tray(page)
    const flash = [await page.locator('.emb-la-label.is-flash').count(), await page.locator('.lai-row-flash').count()]
    check('blink: 「在邏輯分析儀中顯示（PA5 LED）」 opens the analyzer and flashes the PA5 row', /在邏輯分析儀中(顯示|檢視)/.test(label ?? '') && t1.tab === 'logic' && t1.open && flash[0] === 1 && flash[1] === 1, { label, t1, flash })
    await page.waitForTimeout(1900)
    check('blink: the flash ends by itself', (await page.locator('.emb-la-label.is-flash, .lai-row-flash').count()) === 0)
    await withModule(page, '/src/ui/embedded/probe-actions.ts', "m.addLogicChannelFor({ kind: 'hole', ref: 'c20' })")
    await page.waitForTimeout(250)
    check('blink: adding PA5’s net again flashes the row that has it', (await page.locator('.emb-la-label.is-flash').count()) === 1, await toastTexts(page))

    await open(page, 'pwm-fade')
    await page.waitForTimeout(800)
    await runTo(page, 0.5)
    await withModule(page, '/src/ui/embedded/lab.ts', "const l = m.useLab.getState(); l.setWorkspace({ tray: { ...l.workspace.tray, open: true, tab: 'logic' } })")
    await page.waitForTimeout(500)
    const sl = await menuItem(page, { kind: 'mcu-pin', componentId: 'U1', pin: 'PA6' }, 'scope')
    await page.waitForTimeout(300)
    const t2 = await tray(page)
    const chip = await page.locator('.sco-chip-btn.is-flash').count()
    check('pwm-fade: 「在示波器中顯示（CH1）」 opens the scope and flashes CH1', /在示波器中(顯示|檢視)（CH1）/.test(sl ?? '') && t2.tab === 'scope' && chip === 1, { sl, t2, chip })
    // QA clarity SCOPE-READOUT-TRIGGER (bf340c5; user guide 示波器 › 觸發晶片): the trigger is ONE
    // chip that names every field — 「觸發：CH1 ↑ 上升緣 · 準位 … · 自動」 — and its 觸發設定
    // popover holds the selects. So the mode never reads as a bare 自動 (the analyzer's auto-fit,
    // the scope's 自動設定): on the chip it follows 「觸發：」, in the popover it is the 觸發模式
    // select of the row 模式 under the heading 觸發, and both show the same mode.
    const trigChip = page.locator('.sco-trig-chip button').first()
    const chipText = (await trigChip.innerText()).replace(/\n/g, ' ').replace(/\s*▾\s*$/, '').trim()
    await trigChip.click()
    const pop = page.getByRole('dialog', { name: '觸發設定' })
    await pop.waitFor({ timeout: 5000 })
    const modeSel = pop.getByRole('combobox', { name: '觸發模式' })
    const trig = {
      chip: chipText,
      modes: await modeSel.locator('option').allInnerTexts(),
      shown: await modeSel.evaluate((el) => el.options[el.selectedIndex]?.textContent ?? null),
      head: (await pop.locator('.sco-trig-head').innerText()).replace(/\s*ⓘ\s*$/, '').trim(),
      row: await modeSel.evaluate((el) => el.closest('label')?.querySelector('.sco-trig-k')?.textContent ?? null),
    }
    await page.keyboard.press('Escape')
    check(
      'pwm-fade: the trigger mode is never a bare 自動 — chip 「觸發：… · 自動」, its popover 觸發 › 模式（觸發模式）offers 自動／一般／單次',
      /^觸發：CH1 .+ · 自動$/.test(trig.chip) && trig.modes.join('/') === '自動/一般/單次' && trig.shown === '自動' && trig.head === '觸發' && trig.row === '模式',
      trig,
    )

    // 3: the colour of a re-routed wire
    const w = await withModule(
      page,
      '/src/ui/workspace/wire-ends.ts',
      `const S = (await import('/src/state/store.ts')).useStore
       const C = await import('/src/ui/chrome/wire-convention.ts')
       const lay = S.getState().layout
       let pick = null
       for (const x of lay.wires) {
         if (pick || x.color !== C.conventionWireColor(lay, [x.from, x.to])) continue
         for (const end of ['from', 'to']) for (const h of ['top+30', 'top-30', 'bot+30', 'bot-30', 'j45', 'j50', 'g45']) {
           if (pick || !m.wireEndAccepted(x.id, end, h)) continue
           const rest = { ...lay, wires: lay.wires.filter((y) => y.id !== x.id) }
           const other = x[end === 'from' ? 'to' : 'from']
           const c = C.conventionWireColor(rest, end === 'from' ? [h, other] : [other, h])
           if (c !== x.color) pick = { id: x.id, end, h, want: c, before: { ...x } }
         }
       }
       if (!pick) return null
       m.moveWireEndTo(pick.id, pick.end, pick.h)
       const after = { ...S.getState().layout.wires.find((x) => x.id === pick.id) }
       S.getState().undo()
       const undone = { ...S.getState().layout.wires.find((x) => x.id === pick.id) }
       return { pick, after, undone }`,
    )
    check(
      'a moved wire end takes the convention colour of its new ends; one undo restores end and colour',
      !!w && w.after[w.pick.end] === w.pick.h && w.after.color === w.pick.want && JSON.stringify(w.undone) === JSON.stringify(w.pick.before),
      w,
    )
    check('desktop: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }

  // ---- 4: phone
  {
    const { ctx, page, errors } = await boot(browser, { phone: true })
    await open(page, 'pwm-fade')
    await page.waitForTimeout(800)
    await runTo(page, 0.5)
    await withModule(page, '/src/ui/workspace/ProbeMenu.tsx', "m.openProbeMenu?.({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA7' }, { x: 200, y: 300 }, { pointer: 'touch' })")
    await page.waitForTimeout(600)
    const add = page.locator('button', { hasText: '加入邏輯分析儀' }).first()
    if (await add.count()) await add.click()
    else await withModule(page, '/src/ui/embedded/probe-actions.ts', "m.addLogicChannelFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA7' })")
    await page.waitForTimeout(500)
    const covered = await page.locator('.asm-sheet .lg-seg-item').count()
    const toast = await toastTexts(page)
    check('phone: 加入邏輯分析儀 keeps the board in view; the toast offers 在儀器中查看', covered === 0 && toast.some((x) => /已加入邏輯分析儀/.test(x) && /在儀器中查看/.test(x)), { covered, toast })
    await page.locator('.lg-toast button, .lg-toast [role="button"]', { hasText: '在儀器中查看' }).first().click()
    await page.waitForTimeout(900)
    const v1 = await sheetView(page)
    const f1 = await page.locator('.emb-la-label.is-flash').count()
    check('phone: one tap opens 儀器 on 邏輯 with the new row flashing', v1 === '邏輯' && f1 === 1, { v1, f1 })
    await withModule(page, '/src/ui/chrome/instrument-sheet.ts', "m.showInstrument('log')")
    await page.waitForTimeout(600)
    check('phone: the open sheet follows a reveal to 日誌 (在模擬日誌中檢視)', (await sheetView(page)) === '日誌')
    await page.keyboard.press('Escape')
    await page.mouse.click(195, 120)
    await page.waitForTimeout(700)
    await withModule(page, '/src/ui/embedded/probe-actions.ts', "void m.addScopeProbeFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA6' })")
    await page.waitForTimeout(500)
    const dup = await toastTexts(page)
    const n0 = await probes(page)
    const more = page.locator('.lg-toast button, .lg-toast [role="button"]', { hasText: '仍要再放一支' }).first()
    const hasMore = (await more.count()) === 1
    if (hasMore) await more.click()
    await page.waitForTimeout(700)
    const n1 = await probes(page)
    check('phone: the duplicate probe toast’s 仍要再放一支 places the second probe', dup.some((x) => /已由 PRB1 量測/.test(x)) && hasMore && n1 === n0 + 1, { dup, n0, n1 })
    check('phone: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }

  // ---- QA IS-F5: the one free hole of a Blue Pill pin strip (uart-hello j15, PA9) takes the probe
  for (const phone of [false, true]) {
    const where = phone ? 'phone long-press' : 'desktop right-click'
    const { ctx, page, errors } = await boot(browser, { phone, shotrig: true })
    await open(page, 'uart-hello')
    await page.waitForTimeout(1200)
    const w = await page.evaluate(() => window.__e2e.endpointWorld('j15'))
    const dist = 9
    await page.evaluate((c) => window.__shotRig.setCamera(...c), [w.x + 0.12 * dist, w.y + 1.25 * dist, w.z + 0.22 * dist, w.x, w.y, w.z])
    await page.waitForTimeout(500)
    const p = await page.evaluate((v) => window.__shotRig.project(v.x, v.y, v.z), w)
    const on = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName ?? null, [p.x, p.y])
    if (phone) {
      // a real touch long-press (mouse events never start the touch long-press timer)
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] })
      await page.waitForTimeout(900)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      await page.mouse.move(p.x - 3, p.y - 3)
      await page.mouse.move(p.x, p.y, { steps: 3 })
      await page.waitForTimeout(150)
      await page.mouse.click(p.x, p.y, { button: 'right' })
    }
    await page.waitForTimeout(800)
    const item = page.locator('button, [role="menuitem"]', { hasText: '放示波器探棒（CH1）' }).first()
    const found = (await item.count()) === 1
    const enabled = found && (await item.isEnabled())
    check(`uart-hello ${where} on j15: 「放示波器探棒（CH1）」 is offered and enabled`, on === 'CANVAS' && found && enabled, { on, found, enabled })
    if (enabled) await item.click()
    await page.waitForTimeout(700)
    const placed = await withModule(page, '/src/state/store.ts', "return m.useStore.getState().layout.components.filter((c) => c.type === 'scope_probe').map((c) => [c.id, c.holes?.[0]])")
    check(`uart-hello ${where}: PRB1 lands in j15`, JSON.stringify(placed) === JSON.stringify([['PRB1', 'j15']]), placed)
    const toast = await toastTexts(page)
    check(`uart-hello ${where}: the toast names the strip (unchanged wording)`, toast.some((x) => /已在 j15 這一排放示波器探棒（CH1）/.test(x)), toast)
    check(`uart-hello ${where}: no page errors`, errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }

  // ---- 5: classic chrome
  {
    const { ctx, page, errors } = await boot(browser, { phone: true, lang: 'en' })
    await open(page, 'pwm-fade')
    await page.waitForTimeout(800)
    const before = await tray(page)
    const r = await withModule(page, '/src/ui/embedded/instruments/instrument-request.ts', "return m.revealInstrument('log', { open: true })")
    await withModule(page, '/src/ui/embedded/probe-actions.ts', "m.addLogicChannelFor({ kind: 'mcu-pin', componentId: 'U1', pin: 'PA7' })")
    await page.waitForTimeout(500)
    const after = await tray(page)
    const toast = await toastTexts(page)
    const actions = await page.locator('.lg-toast button, .lg-toast [role="button"]').count()
    check('classic: no reveal, no sheet, the old toast text without an action', r === false && before.tab === after.tab && (await page.locator('.asm-sheet').count()) === 0 && toast.some((x) => /open Instruments to see it/.test(x)) && actions === 0, { r, before, after, toast, actions })
    check('classic: no page errors', errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(`\ninstruments requests: ${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
