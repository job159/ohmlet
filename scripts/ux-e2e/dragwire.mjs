/**
 * Round 5 drag-to-wire — 「拖曳拉線，不必先切到導線模式」, replayed with REAL
 * pointer events (src/three/scene.ts beginWireDraw, src/ui/workspace/wire-draw.ts).
 *
 *   UX_E2E_URL=http://localhost:5173/ node scripts/ux-e2e/dragwire.mjs
 *   (UX_E2E_ONLY=desktop|phone|classic runs one part)
 *
 * A fresh profile with R1 on c22–c26 and the wire W1 a34 → a37; the camera
 * parked over column 28 (the phone: 27) with `?shotrig` (a hole pitch reads ≈ 30 px on the
 * desktop, ≈ 23 px on the phone), holes aimed at their projected centres
 * (window.__e2e.endpointWorld). Asserts:
 *
 *  desktop 1440×900, zh-TW workspace, mouse:
 *   - the cursor is a crosshair over a free hole, not between two holes;
 *   - press a19, drag to a29, release → ONE new wire a19 → a29 in its role
 *     colour, the mode is still 選取, nothing is selected, the toast reads
 *     「已接上 a19 … → a29 …」 with 〔復原〕; Ctrl+Z takes exactly that wire back;
 *   - a press on R1's leg (c22) starts from the free hole of its strip
 *     (a wire from a22 / b22 / d22 / e22, never from c22); aiming at nothing
 *     the chip says so (「c22 被 R1 … 佔用，已改從同一排的 b22 拉線」) and the
 *     toast names the move (「…改從同一排接出」) — polish (f);
 *   - a drop on R1's LEG (c26) lands on the free hole of its strip (b26 /
 *     d26): the chip says so while aiming (「…接到同一排的 …」), the toast
 *     names it (「…改接同一排」) — polish (e);
 *   - a mouse held still 800 ms on R1's leg, then dragged: a wire, and no
 *     action sheet (polish (d) — the long-press sheet is a finger's);
 *   - a drag that starts BETWEEN holes orbits (the camera moves, no wire);
 *   - Alt + a drag from a hole orbits (the camera moves, no wire);
 *   - a drag released on the desk adds nothing and shows no refusal;
 *   - a drag on the end of the UNSELECTED wire W1 (a34) re-routes that end
 *     to a32 (still the one wire W1); its toast 「已改接導線 W1 …」 has
 *     〔復原〕, which puts it back (polish (g)); then the same again with
 *     Ctrl+Z;
 *   - a plain click on a hole adds no wire;
 *   - final round (a): a drop on the START's own row — a free hole (a19 →
 *     c19) or R1's leg (a26 → c26) — adds nothing; while aiming, a red route
 *     and the chip 「c19 跟起點在同一排，本來就是通的」, then the toast
 *     「這裡不能接：c19 跟起點在同一排，本來就是通的」;
 *   - final round (c): aiming at nothing (the start-note check above), the
 *     route hangs faint — no red pixels appear between start and pointer;
 *   - final round (b): with R1's leg c22 on a FULL row (filler wires in a22
 *     b22 d22 e22) the leg shows no crosshair (c26 still does), a drag from
 *     it orbits (no wire), and a mouse hold on it opens R1's sheet exactly as
 *     a hold on R1's body does;
 *   - final round (d): a PEN (CDP pointerType 'pen') held still on a33 shows
 *     the grip chip 「a33 · 放開：探測選單／拖曳：拉線」 and the lift opens the
 *     probe sheet for a33; a quick pen tap opens nothing; a pen drag (held
 *     first or not) draws a19 → a29;
 *   - the one-time tip (polish (h)): never under ?shotrig; with the flag
 *     dropped from the URL, the first rest on a free hole shows
 *     「小提示：按住孔位拖到另一個孔位，就能拉線」 once (remembered in
 *     localStorage 'bb.tip.dragWire'), the next rest does not.
 *  phone 390×844 touch (CDP touch events):
 *   - a one-finger drag from a hole orbits (no wire);
 *   - a long-press on a24 (700 ms), a drag, the lift → ONE new wire from a24;
 *     the mode stays 選取 and nothing is selected (no sheet over the board);
 *   - a long-press on a33 and a lift without a move → the probe sheet for
 *     a33 (as before — it now opens on the lift), no wire; while held, the
 *     chip says what a lift and a drag do (「放開：探測選單／拖曳：拉線」 —
 *     polish (i)).
 *  classic chrome (English, no workspace): no crosshair, a mouse drag from a
 *   hole orbits as before (no wire); Alt + a drag on the SELECTED R1 still
 *   MOVES it (polish (a) — Alt is the product chrome's orbit escape only).
 *
 * Round 5 polish (stream "scene") and the final pass (stream "wiring") ran it
 * on the release dev server. Exit code 1 on any failed assertion.
 * UX_E2E_SHOTS=<dir> saves screenshots.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const SHOTS = process.env.UX_E2E_SHOTS ?? null
const ONLY = process.env.UX_E2E_ONLY ?? null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const check = (ok, what, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${!ok && detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
  if (!ok) failures.push(what)
  return ok
}

/** R1 on c22–c26, W1 a34 → a37 (yellow) — room to wire around them, all near column 28. */
const LAYOUT = {
  version: 1,
  components: [{ id: 'R1', type: 'resistor', holes: ['c22', 'c26'], params: { resistance: 330 } }],
  wires: [{ id: 'W1', from: 'a34', to: 'a37', color: 'yellow' }],
}

async function open(browser, { phone = false, lang = 'zh-TW', workspace = !phone } = {}) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-TW' }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: lang },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([l, ws, layout]) => {
      if (sessionStorage.getItem('ux.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', l)
      localStorage.setItem('bb.hintShrink', '1')
      localStorage.setItem('bb.layout', layout)
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      sessionStorage.setItem('ux.seeded', '1')
    },
    [lang, workspace, JSON.stringify(LAYOUT)],
  )
  await page.goto(`${URL}?e2e&shotrig`, { timeout: 180_000 })
  await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig, null, { timeout: 90_000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(1000)
  return { ctx, page, errors }
}

const shot = async (page, name) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `dragwire-${name}.png`) })
}

const state = (page) => page.evaluate(() => window.__e2e.state())
const wires = async (page) => (await state(page)).layout.wires
/** The board-plane point of a hole. */
const world = (page, ref) => page.evaluate((r) => window.__e2e.endpointWorld(r), ref)
/** The screen point of a hole / terminal (null off screen). */
const project = (page, ref) =>
  page.evaluate((r) => {
    const w = window.__e2e.endpointWorld(r)
    return w ? window.__shotRig.project(w.x, w.y, w.z) : null
  }, ref)
/** The screen point of a board-plane point (x, z). */
const projectXZ = (page, x, z) => page.evaluate(([a, b]) => window.__shotRig.project(a, 0, b), [x, z])
/**
 * Wait until the camera holds still (a board point projects to the same
 * place twice in a row): an orbit's damping glides on after the release, and
 * setCamera does not stop that glide — a check right after an orbit would
 * see the camera still moving (final round: the classic Alt check flaked so).
 */
async function settle(page, maxMs = 3000) {
  const t0 = Date.now()
  let last = await page.evaluate(() => {
    const w = window.__e2e.endpointWorld('j5')
    return window.__shotRig.project(w.x, 0, w.z)
  })
  while (Date.now() - t0 < maxMs) {
    await sleep(120)
    const p = await page.evaluate(() => {
      const w = window.__e2e.endpointWorld('j5')
      return window.__shotRig.project(w.x, 0, w.z)
    })
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.2) return
    last = p
  }
}
/** The camera over column `col` from `d` units away (once any orbit glide has died down). */
async function park(page, col = 28, d = 30) {
  await settle(page)
  await page.evaluate(
    ([c, dist]) => {
      const w = window.__e2e.endpointWorld(`e${c}`)
      window.__shotRig.setCamera(w.x - 0.1 * dist, 0.75 * dist, w.z + 0.65 * dist, w.x, 0, w.z)
    },
    [col, d],
  )
  await sleep(400)
  await settle(page)
}
/** Did the camera move while `run` ran (a fixed board point projects elsewhere)? */
async function cameraMoved(page, run) {
  // a board point far from the orbit target (a point AT the target never moves on screen)
  const ref = await world(page, 'j5')
  const before = await projectXZ(page, ref.x, ref.z)
  await run()
  await sleep(300)
  const after = await projectXZ(page, ref.x, ref.z)
  return Math.hypot(after.x - before.x, after.y - before.y) > 4
}
/** The 3D view's cursor at screen point `p` (the scene styles its container, the canvas's parent). */
const cursor = (page, p) =>
  page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y)
    return el?.tagName === 'CANVAS' ? (el.parentElement?.style.cursor ?? '') : `(${el?.tagName ?? 'nothing'} on top)`
  }, [p.x, p.y])
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.lg-toast')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()))
/** The 3D view's hover / aim chip text ('' when hidden). */
const chipText = (page) =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('.bb-hover-chip')].find((x) => x.style.display !== 'none')
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''
  })
/**
 * How many strongly red pixels (the refused route 0xff453a, the red chip's
 * edge) the screen shows inside the box around points `a` and `b` (± pad):
 * a screenshot of the box, decoded in the page.
 */
async function redCount(page, a, b, pad = 14) {
  const vp = page.viewportSize()
  const x = Math.max(0, Math.min(a.x, b.x) - pad)
  const y = Math.max(0, Math.min(a.y, b.y) - pad)
  const width = Math.max(4, Math.min(vp.width - x, Math.abs(a.x - b.x) + 2 * pad))
  const height = Math.max(4, Math.min(vp.height - y, Math.abs(a.y - b.y) + 2 * pad))
  const png = await page.screenshot({ clip: { x, y, width, height } })
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] > 190 && d[i + 1] < 120 && d[i + 2] < 110) n++
    return n
  }, png.toString('base64'))
}
/** The visible action sheets' text ('' = none). */
const sheetText = async (page) => (await page.locator('.lg-asheet:visible').allInnerTexts()).join(' / ').replace(/\s+/g, ' ')
async function closeSheets(page) {
  if ((await page.locator('.lg-asheet:visible').count()) > 0) {
    await page.keyboard.press('Escape')
    await sleep(400)
  }
}
/**
 * A PEN (CDP Input.dispatchMouseEvent pointerType 'pen'): press at `a`, hold
 * still `hold` ms (`during` runs then, still pressed), glide to `b` (null:
 * no move), lift.
 */
async function penGesture(cdp, a, b, { hold = 0, during = null, steps = 12 } = {}) {
  const send = (type, p, buttons) => cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons, clickCount: 1, pointerType: 'pen' })
  await send('mouseMoved', { x: a.x - 3, y: a.y - 3 }, 0)
  await send('mouseMoved', a, 0)
  await sleep(150)
  await send('mousePressed', a, 1)
  if (hold > 0) await sleep(hold)
  if (during) await during()
  let end = a
  if (b) {
    for (let i = 1; i <= steps; i++) {
      end = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }
      await send('mouseMoved', end, 1)
      await sleep(16)
    }
    await sleep(120)
  }
  await send('mouseReleased', end, 0)
  await sleep(500)
}
async function clearToasts(page) {
  await page.evaluate(async () => {
    const K = await import('/src/ui/kit/toasts.ts')
    for (const x of K.getToasts()) K.dismissToast(x.id)
  })
  await sleep(200)
}
/**
 * A real mouse drag: hover, press, (hold still `hold` ms), glide in `steps`,
 * (`before` runs at the end point, still pressed), release. `mods` are held through it.
 */
async function mouseDrag(page, a, b, { steps = 16, mods = [], hold = 0, before = null } = {}) {
  for (const k of mods) await page.keyboard.down(k)
  await page.mouse.move(a.x - 3, a.y - 3)
  await page.mouse.move(a.x, a.y, { steps: 3 })
  await sleep(120)
  await page.mouse.down()
  if (hold > 0) await sleep(hold)
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps)
    await sleep(16)
  }
  await sleep(120)
  if (before) await before()
  await page.mouse.up()
  for (const k of mods) await page.keyboard.up(k)
  await sleep(400)
}

const browser = await chromium.launch({ channel: process.env.UX_E2E_CHANNEL ?? 'msedge' })
try {
  // ============================================================ desktop
  if (!ONLY || ONLY === 'desktop') {
    const { ctx, page, errors } = await open(browser)
    await park(page)
    const n0 = (await wires(page)).length
    const a19w = await world(page, 'a19')

    // the cursor says where a press draws
    const a19 = await project(page, 'a19')
    await page.mouse.move(a19.x - 4, a19.y - 4)
    await page.mouse.move(a19.x, a19.y, { steps: 3 })
    await sleep(250)
    check((await cursor(page, a19)) === 'crosshair', 'desktop: the cursor over a free hole is a crosshair', await cursor(page, a19))
    const gap = await projectXZ(page, a19w.x + 0.5, a19w.z + 0.5)
    await page.mouse.move(gap.x, gap.y, { steps: 3 })
    await sleep(250)
    check((await cursor(page, gap)) === '', 'desktop: between two holes it is not (the plain cursor)', await cursor(page, gap))

    // press a19, drag to a29, release → one wire, still 選取, nothing selected, toast with 〔復原〕
    await clearToasts(page)
    await mouseDrag(page, await project(page, 'a19'), await project(page, 'a29'))
    let st = await state(page)
    const w = st.layout.wires.at(-1)
    check(st.layout.wires.length === n0 + 1 && w?.from === 'a19' && w?.to === 'a29', 'desktop: a drag a19 → a29 adds ONE wire a19 → a29', st.layout.wires)
    check(st.mode.kind === 'select', 'desktop: the mode stays 選取 (no wire mode needed)', st.mode)
    check(st.selection.length === 0, 'desktop: the new wire is not selected', st.selection)
    const t1 = (await toasts(page)).join(' | ')
    check(/已接上 a19/.test(t1) && /a29/.test(t1) && /復原/.test(t1), 'desktop: the toast says 「已接上 a19 … → a29 …」 with 〔復原〕', t1)
    const roleColor = await page.evaluate(async (id) => {
      const R = await import('/src/ui/wire-roles.ts')
      const S = await import('/src/state/store.ts')
      return R.wireRoleOf(S.useStore.getState().layout, id).color
    }, w?.id)
    check(!!w && w.color === roleColor, 'desktop: the wire is stored in its role colour', { stored: w?.color, role: roleColor })
    await shot(page, 'desktop-drawn')
    await page.keyboard.press('Control+z')
    await sleep(400)
    st = await state(page)
    check(st.layout.wires.length === n0 && !st.layout.wires.some((x) => x.id === w?.id), 'desktop: Ctrl+Z takes exactly that wire back', st.layout.wires)

    // a part pin: the wire starts from the free hole of its strip — said
    // while it aims at nothing (the chip) and after (the toast)
    await clearToasts(page)
    const deskNear = await projectXZ(page, a19w.x + 3, a19w.z - 9)
    let startChip = ''
    /** red pixels between the start and the pointer: before the press / while aiming at nothing */
    const looseRed = { before: 0, during: 0 }
    {
      const c22 = await project(page, 'c22')
      await page.mouse.move(c22.x - 3, c22.y - 3)
      await page.mouse.move(c22.x, c22.y, { steps: 3 })
      await sleep(120)
      looseRed.before = await redCount(page, c22, deskNear)
      await page.mouse.down()
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(c22.x + ((deskNear.x - c22.x) * i) / 10, c22.y + ((deskNear.y - c22.y) * i) / 10)
        await sleep(16)
      }
      await sleep(200)
      startChip = await chipText(page)
      looseRed.during = await redCount(page, c22, deskNear)
      await shot(page, 'desktop-start-note')
      const a31 = await project(page, 'a31')
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(deskNear.x + ((a31.x - deskNear.x) * i) / 10, deskNear.y + ((a31.y - deskNear.y) * i) / 10)
        await sleep(16)
      }
      await sleep(150)
      await page.mouse.up()
      await sleep(400)
    }
    st = await state(page)
    const pinWire = st.layout.wires.at(-1)
    check(
      st.layout.wires.length === n0 + 1 && /^[abde]22$/.test(pinWire?.from ?? '') && pinWire?.to === 'a31',
      'desktop: a drag from R1’s leg (c22) starts at the free hole of its strip',
      pinWire,
    )
    check(
      /^c22 被 R1 .*佔用，已改從同一排的 [abde]22 拉線$/.test(startChip),
      'desktop: aiming at nothing, the chip names the moved start (「c22 被 R1 … 佔用，已改從同一排的 … 拉線」)',
      startChip,
    )
    // final round (c): aiming at nothing is no refusal — the route hangs faint, never red beside that neutral chip
    check(looseRed.during - looseRed.before < 25, 'desktop: aiming at nothing, the route is faint — not the red of a refused target', looseRed)
    const tPin = (await toasts(page)).join(' | ')
    check(/已接上 [abde]22（c22 被 R1 .*佔用，改從同一排接出）→ a31/.test(tPin), 'desktop: the toast names the moved start', tPin)
    await page.keyboard.press('Control+z')
    await sleep(400)

    // a drop on R1's LEG (c26): it lands on the free hole of its strip, said while aiming and after
    await clearToasts(page)
    let legChip = ''
    await mouseDrag(page, await project(page, 'a19'), await project(page, 'c26'), {
      before: async () => {
        legChip = await chipText(page)
        await shot(page, 'desktop-leg-aim')
      },
    })
    st = await state(page)
    const legWire = st.layout.wires.at(-1)
    check(
      st.layout.wires.length === n0 + 1 && legWire?.from === 'a19' && /^[bd]26$/.test(legWire?.to ?? ''),
      'desktop: a drop on R1’s leg (c26) lands on the free hole of its strip (b26 / d26)',
      legWire,
    )
    check(/^c26 被 R1 .*佔用 → 接到同一排的 [bd]26$/.test(legChip), 'desktop: while aiming at the leg, the chip says where it will land', legChip)
    const tLeg = (await toasts(page)).join(' | ')
    check(/已接上 a19 → [bd]26（c26 被 R1 .*佔用，改接同一排）/.test(tLeg) && /復原/.test(tLeg), 'desktop: the toast says where it went, with 〔復原〕', tLeg)
    await shot(page, 'desktop-leg-drop')
    await page.keyboard.press('Control+z')
    await sleep(400)

    // a mouse held still on R1's leg first, then dragged: still a wire — no action sheet
    await clearToasts(page)
    await mouseDrag(page, await project(page, 'c26'), await project(page, 'a30'), { hold: 800 })
    st = await state(page)
    const heldWire = st.layout.wires.at(-1)
    const sheets = await page.locator('.lg-asheet:visible').count()
    check(
      st.layout.wires.length === n0 + 1 && /^[abde]26$/.test(heldWire?.from ?? '') && heldWire?.to === 'a30' && sheets === 0,
      'desktop: a mouse held still on a leg, then dragged, draws the wire (no action sheet)',
      { heldWire, sheets },
    )
    if (sheets > 0) await page.keyboard.press('Escape')
    await page.keyboard.press('Control+z')
    await sleep(400)

    // final round (a): a drop on the START's own strip — a free hole or a part's
    // leg alike — does nothing and says why (red route + red chip, then the toast)
    for (const [start, aim, what] of [
      ['a19', 'c19', 'a free hole'],
      ['a26', 'c26', 'R1’s leg'],
    ]) {
      await clearToasts(page)
      const s = await project(page, start)
      const e = await project(page, aim)
      const before = await redCount(page, s, e)
      let aimChip = ''
      let during = 0
      await mouseDrag(page, s, e, {
        before: async () => {
          aimChip = await chipText(page)
          during = await redCount(page, s, e)
          await shot(page, `desktop-same-row-${aim}`)
        },
      })
      const reason = `${aim} 跟起點在同一排，本來就是通的`
      check((await wires(page)).length === n0, `desktop: a drop on ${what} of the start’s own row (${start} → ${aim}) adds no wire`)
      check(aimChip === reason, `desktop: while aiming at ${aim}, the chip says why (「${reason}」)`, aimChip)
      check(during - before > 25, `desktop: …beside a red route (a refused target)`, { before, during })
      const tSame = (await toasts(page)).join(' | ')
      check(tSame.includes(`這裡不能接：${reason}`), `desktop: the toast 「這裡不能接：${reason}」`, tSame)
    }

    // between holes: an orbit, no wire
    const between = await projectXZ(page, a19w.x + 0.5, a19w.z + 0.5)
    const moved1 = await cameraMoved(page, () => mouseDrag(page, between, { x: between.x - 160, y: between.y - 40 }))
    check(moved1 && (await wires(page)).length === n0, 'desktop: a drag that starts between holes orbits and adds no wire', { moved1 })
    await park(page)

    // Alt + a drag from a hole: an orbit, no wire
    const a21 = await project(page, 'a21')
    const moved2 = await cameraMoved(page, () => mouseDrag(page, a21, { x: a21.x - 160, y: a21.y - 40 }, { mods: ['Alt'] }))
    check(moved2 && (await wires(page)).length === n0, 'desktop: Alt + a drag from a hole orbits and adds no wire', { moved2 })
    await park(page)

    // released on the desk (beyond the top rails): nothing, silently
    await clearToasts(page)
    const desk = await projectXZ(page, a19w.x + 4, a19w.z - 9)
    await mouseDrag(page, await project(page, 'a23'), desk)
    const t2 = await toasts(page)
    check((await wires(page)).length === n0 && t2.every((x) => !/不能接/.test(x)), 'desktop: released on the desk — no wire, no refusal toast', t2)

    // the end of the UNSELECTED wire W1 re-routes (one undo step) — its toast has 〔復原〕
    await clearToasts(page)
    await mouseDrag(page, await project(page, 'a34'), await project(page, 'a32'))
    st = await state(page)
    const w1 = st.layout.wires.find((x) => x.id === 'W1')
    check(st.layout.wires.length === n0 && w1?.from === 'a32' && w1?.to === 'a37', 'desktop: a drag on W1’s end (a34) re-routes it to a32', st.layout.wires)
    const tRe = (await toasts(page)).join(' | ')
    check(/已改接導線 W1/.test(tRe) && /復原/.test(tRe), 'desktop: the re-route toast 「已改接導線 W1 …」 carries 〔復原〕', tRe)
    await page.locator('.lg-toast.has-action .lg-toast-action').first().click()
    await sleep(400)
    check((await wires(page)).find((x) => x.id === 'W1')?.from === 'a34', 'desktop: 〔復原〕 on that toast puts W1’s end back')
    await mouseDrag(page, await project(page, 'a34'), await project(page, 'a32'))
    await page.keyboard.press('Control+z')
    await sleep(400)
    check((await wires(page)).find((x) => x.id === 'W1')?.from === 'a34', 'desktop: one Ctrl+Z puts W1’s end back')

    // a plain click on a hole: no wire
    const a33 = await project(page, 'a33')
    await page.mouse.move(a33.x, a33.y)
    await page.mouse.down()
    await page.mouse.up()
    await sleep(300)
    check((await wires(page)).length === n0, 'desktop: a click on a hole adds no wire')

    // final round (b): R1's leg c22 on a FULL strip (wires in a22 b22 d22 e22) —
    // no wire can start there, so no crosshair; it is part of R1 there: a drag
    // orbits, and a hold opens R1's sheet exactly as a hold on R1's body does
    await page.evaluate(async () => {
      const S = await import('/src/state/store.ts')
      const st = S.useStore.getState()
      for (const [a, b] of [['a22', 'j18'], ['b22', 'i18'], ['d22', 'h18'], ['e22', 'g18']]) st.addWire(a, b, 'yellow')
    })
    await sleep(500)
    {
      const nFull = (await wires(page)).length
      const c22 = await project(page, 'c22')
      await page.mouse.move(c22.x - 4, c22.y - 4)
      await page.mouse.move(c22.x, c22.y, { steps: 3 })
      await sleep(300)
      const cFull = await cursor(page, c22)
      check(cFull !== 'crosshair', 'desktop: a leg whose row has no free hole shows no crosshair (no wire starts there)', cFull)
      const c26 = await project(page, 'c26')
      await page.mouse.move(c26.x, c26.y, { steps: 3 })
      await sleep(300)
      check((await cursor(page, c26)) === 'crosshair', 'desktop: …a leg whose row has room still does', await cursor(page, c26))
      const movedFull = await cameraMoved(page, () => mouseDrag(page, c22, { x: c22.x - 160, y: c22.y - 40 }))
      check(movedFull && (await wires(page)).length === nFull, 'desktop: a drag from that leg orbits and adds no wire (the press agrees with the hover)', { movedFull })
      await park(page)
      // a hold there and a hold on R1's body: the same sheet
      const holdSheet = async (p) => {
        await page.mouse.move(p.x, p.y, { steps: 3 })
        await sleep(200)
        await page.mouse.down()
        await sleep(800)
        const text = await sheetText(page)
        await page.mouse.up()
        await sleep(300)
        await closeSheets(page)
        return text
      }
      const onLeg = await holdSheet(await project(page, 'c22'))
      const c24 = await world(page, 'c24')
      const onBody = await holdSheet(await page.evaluate(([x, z]) => window.__shotRig.project(x, 0.35, z), [c24.x, c24.z]))
      check(/^R1/.test(onBody) && onLeg.split(' / ')[0] === onBody.split(' / ')[0], 'desktop: a mouse hold on that leg opens R1’s sheet, as a hold on R1’s body does', { onLeg: onLeg.slice(0, 60), onBody: onBody.slice(0, 60) })
      check((await wires(page)).length === nFull, 'desktop: …and adds no wire')
    }
    await page.evaluate(async () => {
      const S = await import('/src/state/store.ts')
      for (let i = 0; i < 4; i++) S.useStore.getState().undo()
    })
    await sleep(400)
    check((await wires(page)).length === n0, 'desktop: (the four filler wires are undone)')

    // final round (d): a PEN takes the mouse's press — and a hold then a lift
    // opens the probe sheet like a finger (the grip chip says so at the hold)
    {
      const cdp = await ctx.newCDPSession(page)
      await clearToasts(page)
      const a33 = await project(page, 'a33')
      let penChip = ''
      await penGesture(cdp, a33, null, {
        hold: 800,
        during: async () => {
          penChip = await chipText(page)
          await shot(page, 'desktop-pen-grip')
        },
      })
      check(penChip === 'a33 · 放開：探測選單／拖曳：拉線', 'desktop: a pen held still on a33: the grip chip says what a lift and a drag do', penChip)
      const penSheet = await sheetText(page)
      check(/a33/.test(penSheet) && (await wires(page)).length === n0, 'desktop: …the lift without a move opens the probe sheet for a33 (no wire)', penSheet.slice(0, 120))
      await closeSheets(page)
      // a pen's quick tap: no sheet, no wire (the click it was)
      await penGesture(cdp, a33, null)
      check((await sheetText(page)) === '' && (await wires(page)).length === n0, 'desktop: a quick pen tap opens no sheet and adds no wire', await sheetText(page))
      await closeSheets(page)
      // a pen press-drag draws, held first or not
      await penGesture(cdp, await project(page, 'a19'), await project(page, 'a29'))
      let pw = (await wires(page)).at(-1)
      check((await wires(page)).length === n0 + 1 && pw?.from === 'a19' && pw?.to === 'a29', 'desktop: a pen drag a19 → a29 draws the wire', pw)
      await page.keyboard.press('Control+z')
      await sleep(400)
      await penGesture(cdp, await project(page, 'a19'), await project(page, 'a29'), { hold: 800 })
      pw = (await wires(page)).at(-1)
      check((await wires(page)).length === n0 + 1 && pw?.to === 'a29' && (await sheetText(page)) === '', 'desktop: a pen held still, then dragged, still draws (no sheet)', pw)
      await closeSheets(page)
      await page.keyboard.press('Control+z')
      await sleep(400)
      check((await wires(page)).length === n0, 'desktop: (the pen wires are undone)')
    }

    // the one-time tip: nothing so far (?shotrig); with the flag dropped from
    // the URL, the first rest on a free hole shows it — once
    const TIP = '小提示：按住孔位拖到另一個孔位，就能拉線'
    const tipCount = async () => (await toasts(page)).filter((x) => x.includes(TIP)).length
    check((await tipCount()) === 0, 'desktop: no tip under ?shotrig')
    await clearToasts(page)
    await page.evaluate(() => history.replaceState(null, '', `${location.pathname}?e2e`))
    const restOn = async (ref) => {
      const p = await project(page, ref)
      await page.mouse.move(gap.x, gap.y, { steps: 2 })
      await sleep(150)
      await page.mouse.move(p.x, p.y, { steps: 3 })
      await sleep(350)
    }
    await restOn('a40')
    check((await tipCount()) === 1, 'desktop: the first rest on a free hole shows the one-time tip', await toasts(page))
    await clearToasts(page)
    await restOn('a41')
    check((await tipCount()) === 0, 'desktop: …only once', await toasts(page))
    const tipFlag = await page.evaluate(() => localStorage.getItem('bb.tip.dragWire'))
    check(tipFlag === '1', 'desktop: the tip is remembered (localStorage bb.tip.dragWire)', tipFlag)

    check(errors.length === 0, 'desktop: no page errors', errors.slice(0, 3))
    await ctx.close()
  }

  // ============================================================ phone
  if (!ONLY || ONLY === 'phone') {
    const { ctx, page, errors } = await open(browser, { phone: true })
    await park(page, 27, 44)
    const cdp = await ctx.newCDPSession(page)
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts })
    const n0 = (await wires(page)).length

    // one finger dragged at once: the orbit it always was
    const a22 = await project(page, 'a22')
    const moved = await cameraMoved(page, async () => {
      await touch('touchStart', [{ x: a22.x, y: a22.y }])
      for (let i = 1; i <= 12; i++) {
        await touch('touchMove', [{ x: a22.x + 8 * i, y: a22.y }])
        await sleep(16)
      }
      await touch('touchEnd', [])
    })
    check(moved && (await wires(page)).length === n0, 'phone: a one-finger drag from a hole orbits (no wire)', { moved })
    await park(page, 27, 44)

    // long-press a24, drag, lift: a wire. The aim ring floats about 2.5 hole
    // pitches above the finger, so the finger ends 2.5 rows in front of e30.
    const p = await project(page, 'a24')
    const e30 = await world(page, 'e30')
    const q = await projectXZ(page, e30.x, e30.z + 2.5)
    await touch('touchStart', [{ x: p.x, y: p.y }])
    await sleep(700)
    for (let i = 1; i <= 14; i++) {
      await touch('touchMove', [{ x: p.x + ((q.x - p.x) * i) / 14, y: p.y + ((q.y - p.y) * i) / 14 }])
      await sleep(24)
    }
    await sleep(250)
    await touch('touchEnd', [])
    await sleep(600)
    const st = await state(page)
    check(st.layout.wires.length === n0 + 1 && st.layout.wires.at(-1)?.from === 'a24', 'phone: long-press a24, drag, lift → ONE new wire from a24', st.layout.wires.at(-1))
    check(st.mode.kind === 'select' && st.selection.length === 0, 'phone: still 選取, nothing selected (no sheet over the board)', { mode: st.mode, sel: st.selection })
    await shot(page, 'phone-drawn')

    // long-press and lift without a move: the probe sheet (on the lift)
    const a33 = await project(page, 'a33')
    await touch('touchStart', [{ x: a33.x, y: a33.y }])
    await sleep(800)
    const sheetHeld = await page.locator('.lg-asheet:visible').count()
    const gripChip = await chipText(page)
    await shot(page, 'phone-grip')
    check(/^a33 · 放開：探測選單／拖曳：拉線$/.test(gripChip), 'phone: while held, the chip says what a lift and a drag do', gripChip)
    await touch('touchEnd', [])
    await sleep(700)
    const sheet = (await page.locator('.lg-asheet:visible').allInnerTexts()).join(' / ')
    check(sheetHeld === 0, 'phone: while the finger holds still, no sheet yet (the grip is armed)')
    check(/a33/.test(sheet), 'phone: lifting without a move opens the probe sheet for a33', sheet.slice(0, 160))
    check((await wires(page)).length === n0 + 1, 'phone: …and adds no wire')
    check(errors.length === 0, 'phone: no page errors', errors.slice(0, 3))
    await ctx.close()
  }

  // ============================================================ classic
  if (!ONLY || ONLY === 'classic') {
    const { ctx, page, errors } = await open(browser, { lang: 'en', workspace: false })
    await park(page)
    const n0 = (await wires(page)).length
    const a19 = await project(page, 'a19')
    await page.mouse.move(a19.x, a19.y, { steps: 3 })
    await sleep(250)
    check((await cursor(page, a19)) === '', 'classic: no crosshair over a hole', await cursor(page, a19))
    const moved = await cameraMoved(page, () => mouseDrag(page, a19, { x: a19.x - 160, y: a19.y - 40 }))
    check(moved && (await wires(page)).length === n0, 'classic: a drag from a hole orbits, as before (no wire)', { moved })
    await park(page)

    // Alt + a drag on the SELECTED R1 still moves it (Alt orbits only in the product chrome)
    await page.evaluate(async () => {
      const S = await import('/src/state/store.ts')
      S.useStore.getState().select('R1')
    })
    await sleep(300)
    // the selection opens the classic properties panel: the view resizes for a
    // moment (every board point projects elsewhere) — let it come to rest first
    await settle(page)
    const c24 = await world(page, 'c24')
    let body = null
    for (const y of [0.35, 0.5, 0.25, 0.65, 0.2, 0.8]) {
      const p = await page.evaluate(([x, yy, z]) => window.__shotRig.project(x, yy, z), [c24.x, y, c24.z])
      await page.mouse.move(p.x, p.y, { steps: 2 })
      await sleep(200)
      if ((await cursor(page, p)) === 'pointer') {
        body = p
        break
      }
    }
    check(!!body, 'classic: R1’s body is under the pointer (cursor pointer)')
    if (body) {
      const holesBefore = JSON.stringify((await state(page)).layout.components.find((c) => c.id === 'R1')?.holes)
      const c28 = await project(page, 'c28')
      const c24p = await project(page, 'c24')
      const to = { x: body.x + (c28.x - c24p.x), y: body.y + (c28.y - c24p.y) }
      const camMoved = await cameraMoved(page, () => mouseDrag(page, body, to, { mods: ['Alt'] }))
      const holesAfter = JSON.stringify((await state(page)).layout.components.find((c) => c.id === 'R1')?.holes)
      check(holesAfter !== holesBefore && !camMoved, 'classic: Alt + a drag on the selected R1 moves it (no orbit)', { holesBefore, holesAfter, camMoved })
    }
    check(errors.length === 0, 'classic: no page errors', errors.slice(0, 3))
    await ctx.close()
  }
} finally {
  await browser.close()
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED`)
  process.exit(1)
}
console.log('\nall drag-to-wire checks passed')
