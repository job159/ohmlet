/**
 * The GPIO examples at the app's own framing (owner: glow) — F1: "at the
 * 1–6 mA every GPIO example runs, a lit LED must not be mistaken for off",
 * and F13: the board's other emitters speak the same language.
 *
 *   UX_E2E_URL=http://localhost:5421/ UX_E2E_SHOTS=<dir> node scripts/ux-e2e/glow-examples.mjs
 *
 * zh-TW product chrome, both render modes, a 1440×900 desktop (workspace)
 * and a 390×844 touch phone. Per example (blink, traffic-light, pwm-fade):
 * import it, run, and capture two frames from the camera the app framed:
 * an LED lit (real telemetry: light ≥ 0.15, i.e. ≥ 3 mA) and the same LED
 * dark (blink / traffic-light: a phase where it is off; pwm-fade: the paused
 * board before the run). The lit LED must differ from its dark self by a
 * mean CIELAB ΔE ≥ 10 within 3 dome radii, and its glow must reach past the
 * dome (ring ΔE ≥ 5). The Blue Pill's power LED (≈ 1.5 mA, from its own
 * sub-circuit) must show the shared glow halo while powered. Then the WS2812
 * strip example lights its pixels' halos, and the legacy basic-rgb-lit
 * visual scene (English classic chrome) is shot for reading.
 * Exit code 1 on any failed check. READ the shots.
 */
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright')
const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const SHOTS = process.env.UX_E2E_SHOTS ?? null
const CHANNEL = process.env.UX_E2E_CHANNEL ?? 'msedge'
const MODES = (process.env.GLOW_MODES ?? 'performance,enhanced').split(',').filter(Boolean)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(cond, what, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${extra !== '' ? `  (${extra})` : ''}`)
  if (!cond) failures++
  return cond
}

async function open(browser, { mode, phone, lang = 'zh-TW', workspace = !phone, layout = null }) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([m, lg, ws, l]) => {
      if (sessionStorage.getItem('glowx.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', m)
      localStorage.setItem('bb.lang', lg)
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      if (l) localStorage.setItem('bb.layout', l)
      sessionStorage.setItem('glowx.seeded', '1')
    },
    [mode, lang, workspace, layout],
  )
  await page.goto(`${URL}?e2e&shotrig`, { timeout: 180_000 })
  await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig && !!window.__vividFx, null, { timeout: 120_000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(mode === 'enhanced' ? 4000 : 1500)
  const mod = (file, src, arg) =>
    page.evaluate(
      async ([f, s, ar]) => {
        const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === f) ?? f
        const m = await import(url)
        return await new Function('m', 'a', `return (async () => { ${s} })()`)(m, ar)
      },
      [file, src, arg],
    )
  return { page, ctx, errors, mod }
}

/** a part's light halos: visible flag + screen position / dome radius (px) */
async function halos(page, id) {
  return page.evaluate((cid) => {
    const root = window.__vividFx.group.parent?.parent
    const out = []
    root?.traverse((o) => {
      if (o.name !== 'led-halo') return
      let p = o
      let owner
      while (p && !owner) {
        owner = typeof p.userData.componentId === 'string' ? p.userData.componentId : undefined
        p = p.parent
      }
      if (owner !== cid) return
      const w = o.getWorldPosition(o.position.clone())
      const c = window.__shotRig.project(w.x, w.y, w.z)
      const e = window.__shotRig.project(w.x + 0.42, w.y, w.z)
      out.push({ visible: o.visible, x: c?.x ?? -1, y: c?.y ?? -1, r: c && e ? Math.max(2, Math.hypot(e.x - c.x, e.y - c.y)) : 0 })
    })
    return out
  }, id)
}

/**
 * mean ΔE76 (lit vs dark) inside 3 dome radii, and over the ring 1.4–3 radii
 * (above / beside the dome) — each frame sampled around ITS OWN LED position
 * (a panel resize between the frames may shift the canvas); also returns
 * the two crops side by side, enlarged, for reading
 */
async function deltaE(page, offPng, onPng, spotOff, spot, k) {
  return page.evaluate(
    async ([a, b, so, s, kk]) => {
      const load = async (b64) => {
        const img = new Image()
        img.src = `data:image/png;base64,${b64}`
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width
        cv.height = img.height
        const cx = cv.getContext('2d', { willReadFrequently: true })
        cx.drawImage(img, 0, 0)
        return cx.getImageData(0, 0, img.width, img.height)
      }
      const A = await load(a)
      const B = await load(b)
      const lin = (u) => {
        const v = u / 255
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
      }
      const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
      const lab = (d, i) => {
        const r = lin(d[i])
        const g = lin(d[i + 1])
        const bb = lin(d[i + 2])
        const X = (0.4124 * r + 0.3576 * g + 0.1805 * bb) / 0.95047
        const Y = 0.2126 * r + 0.7152 * g + 0.0722 * bb
        const Z = (0.0193 * r + 0.1192 * g + 0.9505 * bb) / 1.08883
        return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
      }
      const cx = s.x * kk
      const cy = s.y * kk
      const ox = so.x * kk - cx
      const oy = so.y * kk - cy
      const r = s.r * kk
      let n = 0
      let sum = 0
      let nr = 0
      let sr = 0
      for (let y = Math.max(0, Math.floor(cy - 3 * r)); y <= Math.min(A.height - 1, Math.ceil(cy + 3 * r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - 3 * r)); x <= Math.min(A.width - 1, Math.ceil(cx + 3 * r)); x++) {
          const d = Math.hypot(x - cx, y - cy)
          if (d > 3 * r) continue
          const i = (y * A.width + x) * 4
          const xo = Math.round(x + ox)
          const yo = Math.round(y + oy)
          if (xo < 0 || yo < 0 || xo >= A.width || yo >= A.height) continue
          const p = lab(A.data, (yo * A.width + xo) * 4)
          const q = lab(B.data, i)
          const de = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
          n++
          sum += de
          if (d >= 1.4 * r && y <= cy + 0.5 * r) {
            nr++
            sr += de
          }
        }
      }
      // the pair, enlarged (12 dome radii square → 240 px each)
      const cv = document.createElement('canvas')
      cv.width = 480
      cv.height = 240
      const g = cv.getContext('2d')
      const h = 6 * r
      const ia = new Image()
      ia.src = `data:image/png;base64,${a}`
      await ia.decode()
      const ib = new Image()
      ib.src = `data:image/png;base64,${b}`
      await ib.decode()
      g.drawImage(ia, cx + ox - h, cy + oy - h, 2 * h, 2 * h, 0, 0, 240, 240)
      g.drawImage(ib, cx - h, cy - h, 2 * h, 2 * h, 240, 0, 240, 240)
      return { G: sum / Math.max(1, n), ring: sr / Math.max(1, nr), pair: cv.toDataURL('image/png').slice(22) }
    },
    [offPng.toString('base64'), onPng.toString('base64'), spotOff, spot, k],
  )
}

const EXAMPLES = [
  { file: 'blink', led: 'LED1' },
  { file: 'traffic-light', led: null },
  { file: 'pwm-fade', led: 'LED1' },
]

const browser = await chromium.launch({ channel: CHANNEL, headless: true })
try {
  for (const mode of MODES) {
    for (const phone of [false, true]) {
      const view = phone ? 'phone' : 'desktop'
      const { page, ctx, errors, mod } = await open(browser, { mode, phone })
      const k = phone ? 2 : 1
      for (const ex of EXAMPLES) {
        const txt = readFileSync(path.join(ROOT, 'examples', 'embedded', `${ex.file}.ohmlet.json`), 'utf8')
        await mod('/src/ui/embedded/lab.ts', 'return m.useLab.getState().importProject(a)', txt)
        await sleep(2500)
        const ids = await page.evaluate(() => (window.__e2e.state().layout?.components ?? []).filter((c) => c.type === 'led').map((c) => c.id))
        // find a lit LED (≥ 3 mA) and pause on it (re-checked once paused)
        let litId = null
        let litLight = 0
        for (let attempt = 0; attempt < 6 && !litId; attempt++) {
          await mod('/src/state/store.ts', 'm.useStore.getState().startSim()')
          for (let i = 0; i < 300 && !litId; i++) {
            for (const id of ex.led ? [ex.led] : ids) {
              const c = await page.evaluate((x) => window.__e2e.component(x), id)
              if ((c?.light ?? 0) >= 0.15) {
                litId = id
                break
              }
            }
            if (!litId) await sleep(50)
          }
          await mod('/src/state/store.ts', 'm.useStore.getState().stopSim()')
          await sleep(mode === 'enhanced' ? 1500 : 900)
          const c = litId ? await page.evaluate((x) => window.__e2e.component(x), litId) : null
          if ((c?.light ?? 0) >= 0.15) litLight = c.light
          else litId = null
        }
        if (!check(litId !== null, `${mode} ${view} ${ex.file}: an LED lights (real telemetry)`)) continue
        const onShot = await page.screenshot()
        const [spot] = await halos(page, litId)
        check(spot?.visible === true, `${mode} ${view} ${ex.file}: ${litId} at ${(litLight * 20).toFixed(1)} mA shows its glow`)
        const pwr = (await halos(page, 'U1')).filter((h) => h.visible).length
        check(pwr >= 1, `${mode} ${view} ${ex.file}: the Blue Pill's power LED glows (shared halo)`, `${pwr} lit`)
        // the same LED dark: run on until it is off (pwm-fade never goes fully dark → a fresh, unrun load)
        let offShot = null
        let spotOff = null
        if (ex.file !== 'pwm-fade') {
          await mod('/src/state/store.ts', 'm.useStore.getState().startSim()')
          for (let i = 0; i < 300; i++) {
            const c = await page.evaluate((x) => window.__e2e.component(x), litId)
            if ((c?.light ?? 1) === 0) break
            await sleep(40)
          }
          await mod('/src/state/store.ts', 'm.useStore.getState().stopSim()')
          await sleep(mode === 'enhanced' ? 1500 : 900)
          const c = await page.evaluate((x) => window.__e2e.component(x), litId)
          if ((c?.light ?? 1) === 0) {
            offShot = await page.screenshot()
            ;[spotOff] = await halos(page, litId)
          }
        } else {
          await mod('/src/state/store.ts', 'm.useStore.getState().resetSim?.()')
          await sleep(mode === 'enhanced' ? 1800 : 1000)
          offShot = await page.screenshot()
          ;[spotOff] = await halos(page, litId)
        }
        if (check(offShot !== null && spot, `${mode} ${view} ${ex.file}: a dark frame of the same LED`)) {
          const m = await deltaE(page, offShot, onShot, spotOff ?? spot, spot, k)
          check(m.G >= 10 && m.ring >= 5, `${mode} ${view} ${ex.file}: ${litId} lit vs dark is unmistakable at the app's framing`, `ΔE ${m.G.toFixed(1)}, ring ${m.ring.toFixed(1)}, dome ${spot.r.toFixed(1)} px`)
          if (SHOTS) {
            mkdirSync(SHOTS, { recursive: true })
            const { writeFileSync } = await import('node:fs')
            writeFileSync(path.join(SHOTS, `ex-${mode}-${view}-${ex.file}-pair.png`), Buffer.from(m.pair, 'base64'))
          }
        }
        if (SHOTS) {
          mkdirSync(SHOTS, { recursive: true })
          const { writeFileSync } = await import('node:fs')
          writeFileSync(path.join(SHOTS, `ex-${mode}-${view}-${ex.file}-on.png`), onShot)
          if (offShot) writeFileSync(path.join(SHOTS, `ex-${mode}-${view}-${ex.file}-off.png`), offShot)
        }
        await mod('/src/state/store.ts', 'm.useStore.getState().resetSim?.()')
      }
      if (!phone) {
        // WS2812: the pixels' halos
        const txt = readFileSync(path.join(ROOT, 'examples', 'embedded', 'ws2812-strip.ohmlet.json'), 'utf8')
        await mod('/src/ui/embedded/lab.ts', 'return m.useLab.getState().importProject(a)', txt)
        await sleep(2500)
        const strip = await page.evaluate(() => (window.__e2e.state().layout?.components ?? []).find((c) => c.type === 'ws2812b_strip8')?.id ?? null)
        await mod('/src/state/store.ts', 'm.useStore.getState().startSim()')
        let lit = 0
        for (let i = 0; i < 200 && lit === 0; i++) {
          lit = strip ? (await halos(page, strip)).filter((h) => h.visible).length : 0
          if (lit === 0) await sleep(60)
        }
        await mod('/src/state/store.ts', 'm.useStore.getState().stopSim()')
        await sleep(900)
        check(lit > 0, `${mode} ${view} ws2812-strip: lit pixels show the shared glow halo`, `${lit} lit`)
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `ex-${mode}-${view}-ws2812-strip.png`) })
        await mod('/src/state/store.ts', 'm.useStore.getState().resetSim?.()')
      }
      check(errors.length === 0, `${mode} ${view}: no page errors`, errors.slice(0, 2).join(' | '))
      await ctx.close()
    }
  }
  // the legacy visual scene with a lit RGB LED (English classic chrome)
  const j = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'visual', 'extra-basic.json'), 'utf8'))
  const scenes = Array.isArray(j) ? j : (j.scenes ?? Object.values(j))
  const s = scenes.find((x) => x.name === 'basic-rgb-lit')
  if (s) {
    const { page, ctx, errors } = await open(browser, { mode: s.mode ?? 'performance', phone: false, lang: s.lang ?? 'en', workspace: s.workspace === true, layout: typeof s.layout === 'string' ? s.layout : JSON.stringify(s.layout) })
    if (s.cam) await page.evaluate((cam) => window.__shotRig.setCamera(...cam), s.cam)
    await sleep(600)
    for (const key of s.keys ?? []) await page.keyboard.press(key)
    await sleep(s.settle ?? 1500)
    const rgb = await page.evaluate(() => (window.__e2e.state().layout?.components ?? []).find((c) => c.type === 'rgb_led')?.id ?? null)
    const h = rgb ? await halos(page, rgb) : []
    check(h.some((x) => x.visible), 'legacy basic-rgb-lit: the RGB LED glows in the classic chrome')
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'scene-basic-rgb-lit.png') })
    check(errors.length === 0, 'legacy basic-rgb-lit: no page errors', errors.slice(0, 2).join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
