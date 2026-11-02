/**
 * UX fix SC-9 (P0) — replay of audit tasks F-01 / TR-01: in wire mode a
 * click lands on the hole the hover chip names, whatever part body the ray
 * crosses first.
 *
 *   UX_E2E_URL=http://localhost:5322/ node scripts/ux-e2e/scene-SC-9.mjs
 *
 * A fresh zh-TW profile, desktop workspace 1440×900 and 1366×768 (mouse)
 * and phone 390×844 (touch, DPR 2). For b1 step 4 (a16 → top-13), i1 step 2
 * (a20 ↔ e36) and i4 step 3 (a25 ↔ e40) the lesson's own circuit is loaded
 * and the guide put on that step (the coach's focusStep frames the camera),
 * then the 「導線」 tool is picked from the dock and the hole is clicked with
 * REAL pointer events at its projected centre (`?shotrig` projection of the
 * board-plane hole), both as the first end and as the second end, from the
 * lesson's camera and from the auto-framed camera (F on the desktop, the
 * 「對準電路」 button on the phone — the load framing). Each tap waits for
 * the camera to come to rest after the tool is picked, counted in animation
 * frames (settle): on the phone the pick glides the camera (the coach card
 * grows; the touch arming frames the guided step — release QA SC-F1). Asserts:
 *   - every hover chip names the hole before the click (desktop);
 *   - every click sets mode.from to the hole / commits the wire (24 / 24
 *     clicks at 1440×900, 12 / 12 at 1366×768, 12 / 12 phone taps);
 *   - a click on a hole a part body covers (e20 under U1) shows the red
 *     locked chip and the occlusion toast — never a silent click;
 *   - in select mode a click on the Blue Pill body still selects U1.
 * Exit code 1 on any failed assertion. UX_E2E_SHOTS=<dir> saves screenshots.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const SHOTS = process.env.UX_E2E_SHOTS ?? null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

const CASES = [
  { lesson: 'b1-led-resistor', hole: 'a16', other: 'top-13' },
  { lesson: 'i1-gpio-output', hole: 'a20', other: 'e36' },
  { lesson: 'i4-pwm', hole: 'a25', other: 'e40' },
]

async function newPage(browser, phone, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-TW' }
      : { viewport, deviceScaleFactor: 1, locale: 'zh-TW' },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript((ws) => {
    if (sessionStorage.getItem('ux.seeded')) return
    localStorage.clear()
    localStorage.setItem('bb.onboarded', '1')
    localStorage.setItem('bb.renderMode', 'performance')
    localStorage.setItem('bb.lang', 'zh-TW')
    localStorage.setItem('bb.hintShrink', '1')
    if (ws) localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: true }))
    sessionStorage.setItem('ux.seeded', '1')
  }, !phone)
  await page.goto(`${URL}?e2e&shotrig`, { timeout: 180_000 })
  await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig, null, { timeout: 90_000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(1000)
  return { ctx, page, errors }
}

const shot = async (page, name) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `SC-9-${name}.png`) })
}

/** The lesson's own circuit, the guide on `step` — the coach's focusStep frames the camera. */
async function lessonStep(page, lessonId, hole) {
  const step = await page.evaluate(
    async ([id, h]) => {
      const L = await import('/src/lessons/index.ts')
      const A = await import('/src/ui/lessons/actions.ts')
      const lesson = L.lessonById(id)
      const s = lesson.steps.findIndex((st) => (st.highlight?.holes ?? []).includes(h) && /導線/.test(st.body))
      await A.loadLessonCircuit(lesson, 'start')
      A.startGuide(lesson, s)
      // the load replaced the previous lesson's board, so its toast carries 〔復原〕 (operation
      // simplification) — an actionable toast takes taps for ≥ 5 s, and on the phone it sits over
      // the board's lower rows. This script is about 3D hole picking, not toasts: let it go first.
      const K = await import('/src/ui/kit/toasts.ts')
      for (const x of K.getToasts()) K.dismissToast(x.id)
      return s
    },
    [lessonId, hole],
  )
  await sleep(1500) // two deferred frames + the ~450 ms camera spring
  return step
}

const state = (page) => page.evaluate(() => window.__e2e.state())
const project = (page, ref) =>
  page.evaluate((r) => {
    const w = window.__e2e.endpointWorld(r)
    return w ? window.__shotRig.project(w.x, w.y, w.z) : null
  }, ref)
const chipText = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.bb-hover-chip')
    return el && el.style.display !== 'none' ? el.textContent : null
  })

/**
 * The camera at rest, counted in animation frames, not wall time: on the
 * phone, picking a tool sets off frame-scheduled glides — the coach card
 * grows (new view insets, frame 1) and the touch arming frames the guided
 * step (release QA SC-F1, frame 3), each a ~450 ms spring — so a tap a fixed
 * 250 ms after the pick could land mid-glide on the neighbouring hole (e40 →
 * d40 under a slow software-GL frame rate). Waits until `minFrames` frames
 * have passed and `ref`'s projection has not moved for `stableFrames` frames.
 */
async function settle(page, ref, { minFrames = 5, stableFrames = 4 } = {}) {
  await page.evaluate(() => (window.__sc9Settle = null))
  await page
    .waitForFunction(
      ([r, minF, stableF]) => {
        const w = window.__e2e.endpointWorld(r)
        const p = w ? window.__shotRig.project(w.x, w.y, w.z) : null
        const s = (window.__sc9Settle ??= { frames: 0, stable: 0, last: null })
        s.frames++
        s.stable = p && s.last && Math.hypot(p.x - s.last.x, p.y - s.last.y) < 0.05 ? s.stable + 1 : 0
        s.last = p
        return s.frames >= minF && s.stable >= stableF
      },
      [ref, minFrames, stableFrames],
      { polling: 'raf', timeout: 15_000 },
    )
    .catch(() => console.log(`  (the camera did not come to rest on ${ref} within 15 s)`))
}

async function wireTool(page, ref) {
  await page.getByRole('tab', { name: '導線' }).click()
  await sleep(250)
  await settle(page, ref)
}

async function leaveWireMode(page) {
  for (let i = 0; i < 3; i++) {
    const s = await state(page)
    if (s.mode.kind === 'select') return
    await page.keyboard.press('Escape')
    await sleep(120)
  }
}

/** Real pointer at the projected hole centre: hover (desktop), then click / tap. */
async function hit(page, ref, phone) {
  const p = await project(page, ref)
  if (!p) return { ok: false, why: `${ref} is not on screen` }
  const covered = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName ?? null, [p.x, p.y])
  if (covered !== 'CANVAS') return { ok: false, why: `${ref} at (${Math.round(p.x)}, ${Math.round(p.y)}) is under ${covered}` }
  let chip = null
  if (phone) {
    await page.touchscreen.tap(p.x, p.y)
  } else {
    await page.mouse.move(p.x - 4, p.y - 4)
    await page.mouse.move(p.x, p.y, { steps: 3 })
    await sleep(150)
    chip = await chipText(page)
    await page.mouse.down()
    await page.mouse.up()
  }
  await sleep(260)
  return { ok: true, chip, p }
}

/** The auto-framed camera: F on the desktop, the 「對準電路」 button on the phone (the load framing). */
async function frameCircuit(page, phone, ref) {
  if (!phone) {
    await page.keyboard.press('f')
  } else {
    const box = await page.getByRole('button', { name: '對準電路' }).boundingBox()
    if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  }
  await sleep(900)
  await settle(page, ref)
}

async function replay(page, phone, label, repeats = phone ? 1 : 2) {
  let tries = 0
  let good = 0
  const cameras = ['lesson', 'frame']
  for (const c of CASES) {
    for (const camera of cameras) {
      for (const order of ['first', 'second']) {
        for (let r = 0; r < repeats; r++) {
          const step = await lessonStep(page, c.lesson, c.hole)
          if (camera === 'frame') await frameCircuit(page, phone, c.hole)
          await wireTool(page, c.hole)
          const before = (await state(page)).layout.wires.length
          let ok = false
          let detail = ''
          if (order === 'first') {
            const h = await hit(page, c.hole, phone)
            const s = await state(page)
            ok = h.ok && s.mode.kind === 'wire' && s.mode.from === c.hole
            detail = h.ok ? `from=${s.mode.from}` : h.why
            if (h.ok && !phone) check(typeof h.chip === 'string' && h.chip.includes(c.hole), `${label} ${c.lesson} step ${step + 1}: the chip names ${c.hole} (「${h.chip}」)`)
          } else {
            const o = await hit(page, c.other, phone)
            const h = await hit(page, c.hole, phone)
            const s = await state(page)
            const w = s.layout.wires.find((x) => (x.from === c.other && x.to === c.hole) || (x.from === c.hole && x.to === c.other))
            ok = o.ok && h.ok && s.layout.wires.length === before + 1 && !!w
            detail = h.ok ? (o.ok ? `wires ${before} → ${s.layout.wires.length}` : o.why) : h.why
            if (h.ok && !phone) check(typeof h.chip === 'string' && h.chip.includes(c.hole), `${label} ${c.lesson} step ${step + 1}: the chip names ${c.hole} as the second end (「${h.chip}」)`)
          }
          tries++
          if (ok) good++
          check(ok, `${label} ${c.lesson} step ${step + 1}, ${camera} camera, ${c.hole} as the ${order} end (${detail})`)
          if (!ok) await shot(page, `${label}-${c.lesson}-${camera}-${order}-fail`)
          await leaveWireMode(page)
        }
      }
    }
  }
  console.log(`${label}: ${good} / ${tries} clicks landed on the named hole`)
  return { good, tries }
}

const browser = await chromium.launch({ channel: process.env.UX_E2E_CHANNEL ?? 'msedge', headless: true })
try {
  // ---------------------------------------------------------------- desktop
  {
    const { ctx, page, errors } = await newPage(browser, false)
    const d = await replay(page, false, 'desktop')
    check(d.good === d.tries && d.tries >= 24, `desktop: ${d.good} / ${d.tries} clicks commit (≥ 24 needed)`)

    // a covered hole is never a silent click: red locked chip + the occlusion toast
    await lessonStep(page, 'i1-gpio-output', 'a20')
    await wireTool(page, 'e20')
    const p = await project(page, 'e20')
    await page.mouse.move(p.x - 4, p.y - 4)
    await page.mouse.move(p.x, p.y, { steps: 3 })
    await sleep(150)
    await page.mouse.down()
    await page.mouse.up()
    await sleep(350)
    const locked = await page.evaluate(() => {
      const el = document.querySelector('.bb-hover-chip')
      return !!el && el.style.display !== 'none' && el.firstElementChild?.style.display !== 'none' ? el.textContent : null
    })
    const toast = await page.evaluate(() => [...document.querySelectorAll('.lg-toast')].map((e) => e.textContent).join(' | '))
    check(!!locked && locked.includes('e20'), `a click on e20 (under U1) shows the red locked chip (「${locked}」)`)
    check(/e20/.test(toast) && /U1/.test(toast), `…and the occlusion toast names U1 (「${toast}」)`)
    await shot(page, 'desktop-e20-locked')
    await leaveWireMode(page)

    // select mode: a click on the Blue Pill body still selects U1
    const u1 = await page.evaluate(() => {
      const w = window.__e2e.componentWorld('U1', 1.2)
      return w ? window.__shotRig.project(w.x, w.y, w.z) : null
    })
    await page.mouse.move(u1.x - 4, u1.y - 4)
    await page.mouse.move(u1.x, u1.y, { steps: 3 })
    await sleep(200)
    await page.mouse.down()
    await page.mouse.up()
    await sleep(300)
    const sel = (await state(page)).selection
    check(sel.length === 1 && sel[0] === 'U1', `select mode: clicking the Blue Pill body selects U1 (${JSON.stringify(sel)})`)
    check(errors.length === 0, `desktop: no page errors (${errors.slice(0, 2).join(' / ')})`)
    await ctx.close()
  }
  // ------------------------------------------------------- desktop 1366×768
  {
    const { ctx, page, errors } = await newPage(browser, false, { width: 1366, height: 768 })
    const d = await replay(page, false, 'desktop-1366', 1)
    check(d.good === d.tries && d.tries >= 12, `desktop 1366×768: ${d.good} / ${d.tries} clicks commit (≥ 12 needed)`)
    check(errors.length === 0, `desktop 1366×768: no page errors (${errors.slice(0, 2).join(' / ')})`)
    await ctx.close()
  }
  // ------------------------------------------------------------------ phone
  {
    const { ctx, page, errors } = await newPage(browser, true)
    const ph = await replay(page, true, 'phone')
    check(ph.good === ph.tries && ph.tries >= 12, `phone: ${ph.good} / ${ph.tries} taps commit (≥ 12 needed)`)
    check(errors.length === 0, `phone: no page errors (${errors.slice(0, 2).join(' / ')})`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nSC-9: all checks passed')
