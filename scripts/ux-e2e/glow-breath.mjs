/**
 * pwm-fade breathes in 3D (owner: glow) — the eye-averaged LED `light`
 * (sim LedWindow, LED_EYE_S) must make the 1 kHz PWM LED fade smoothly up
 * and down instead of strobing between 0 and its peak:
 *
 *   UX_E2E_URL=http://localhost:5452/ UX_E2E_SHOTS=<dir> node scripts/ux-e2e/glow-breath.mjs
 *   (optional) GLOW_MODES=performance,enhanced
 *
 * Loads examples/embedded/pwm-fade, runs it and samples LED1's telemetry
 * `light` and the 3D halo the scene actually shows (its opacity and size)
 * about every 40 ms of wall time for ≈ 5 s. Checks (per mode):
 *  - the light covers the breath (dim ≤ 15 % and bright ≥ 60 % of the
 *    brightest sample);
 *  - smooth: between consecutive samples the light moves by at most a
 *    quarter of the breath per 100 ms of simulated time (a strobing LED
 *    jumps between 0 and its peak);
 *  - the halo follows the light (bigger when brighter: rank correlation);
 *  - no page errors.
 * A strip of 8 crops of LED1 across one breath is written to UX_E2E_SHOTS — read it.
 */
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

const browser = await chromium.launch({ channel: CHANNEL, headless: true })
try {
  for (const mode of MODES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.addInitScript(
      ([m]) => {
        if (sessionStorage.getItem('breath.seeded')) return
        localStorage.clear()
        localStorage.setItem('bb.onboarded', '1')
        localStorage.setItem('bb.renderMode', m)
        localStorage.setItem('bb.lang', 'zh-TW')
        localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: false }))
        for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
        sessionStorage.setItem('breath.seeded', '1')
      },
      [mode],
    )
    await page.goto(`${URL}?e2e&shotrig`, { timeout: 180_000 })
    await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig && !!window.__vividFx, null, { timeout: 120_000 })
    await page.evaluate(() => window.__e2e.ready())
    await sleep(mode === 'enhanced' ? 4000 : 1200)
    const mod = (file, src, arg) =>
      page.evaluate(
        async ([f, s, ar]) => {
          const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === f) ?? f
          const m = await import(url)
          return await new Function('m', 'a', `return (async () => { ${s} })()`)(m, ar)
        },
        [file, src, arg],
      )
    const txt = readFileSync(path.join(ROOT, 'examples', 'embedded', 'pwm-fade.ohmlet.json'), 'utf8')
    await mod('/src/ui/embedded/lab.ts', 'return m.useLab.getState().importProject(a)', txt)
    await sleep(2500)
    const w = await page.evaluate(() => window.__e2e.componentWorld('LED1', 0))
    await page.evaluate((p) => window.__shotRig.setCamera(...p), [w.x, 12, w.z + 12, w.x, 1, w.z])
    await sleep(800)
    await mod('/src/state/store.ts', 'm.useStore.getState().startSim()')
    await sleep(1500)
    const samples = []
    const t0 = Date.now()
    const frames = []
    while (Date.now() - t0 < 5200) {
      const s = await page.evaluate(() => {
        const c = window.__e2e.component('LED1')
        let halo = null
        window.__vividFx.group.parent?.parent?.traverse((o) => {
          if (o.name !== 'led-halo' || halo) return
          let p = o
          let id
          while (p && !id) {
            id = typeof p.userData.componentId === 'string' ? p.userData.componentId : undefined
            p = p.parent
          }
          if (id === 'LED1') halo = { a: o.visible ? o.userData.glowA : 0, r: o.visible ? o.scale.x : 0 }
        })
        const st = window.__e2e.state()
        return { light: c?.light ?? 0, sim: typeof st.simTime === 'number' ? st.simTime : 0, halo }
      })
      samples.push(s)
      if (SHOTS && frames.length < 8 && samples.length % 6 === 0) {
        // centred on LED1's light (its halo's world position)
        const c = await page.evaluate(() => {
          let at = null
          window.__vividFx.group.parent?.parent?.traverse((o) => {
            if (o.name !== 'led-halo' || at) return
            let p = o
            let id
            while (p && !id) {
              id = typeof p.userData.componentId === 'string' ? p.userData.componentId : undefined
              p = p.parent
            }
            if (id === 'LED1') at = o.getWorldPosition(o.position.clone())
          })
          return at ? window.__shotRig.project(at.x, at.y, at.z) : null
        })
        if (c) frames.push(await page.screenshot({ clip: { x: c.x - 70, y: c.y - 70, width: 140, height: 140 } }))
      }
      await sleep(40)
    }
    await mod('/src/state/store.ts', 'm.useStore.getState().stopSim()')
    const L = samples.map((s) => s.light)
    const hi = Math.max(...L)
    const lo = Math.min(...L)
    console.log(`      ${mode}: ${samples.length} samples, light ${lo.toFixed(3)} … ${hi.toFixed(3)}; sim ${samples[0].sim.toFixed(2)} → ${samples[samples.length - 1].sim.toFixed(2)} s`)
    console.log('      light: ' + L.map((x) => x.toFixed(2)).join(' '))
    check(hi > 0.05 && lo <= 0.15 * hi, `${mode}: the light covers the breath (dim and bright)`, `${lo.toFixed(3)} … ${hi.toFixed(3)}`)
    // smoothness: per 100 ms of simulated time the light moves ≤ a quarter of the breath
    let worst = 0
    check(samples[samples.length - 1].sim - samples[0].sim > 2, `${mode}: the simulation ran a full breath while sampled`, `${(samples[samples.length - 1].sim - samples[0].sim).toFixed(2)} s`)
    for (let i = 1; i < samples.length; i++) {
      const dt = Math.max(0.01, samples[i].sim - samples[i - 1].sim)
      if (samples[i].sim === samples[i - 1].sim) continue
      worst = Math.max(worst, Math.abs(L[i] - L[i - 1]) / hi / (dt / 0.1))
    }
    check(worst <= 0.25, `${mode}: it breathes smoothly — no strobing between 0 and the peak`, `worst step ${(worst * 100).toFixed(0)} % of the breath per 100 ms`)
    // the 3D halo follows the light: Spearman rank correlation of light vs halo size
    const pairs = samples.filter((s) => s.halo).map((s) => [s.light, s.halo.r])
    const rank = (xs) => {
      const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0])
      const r = new Array(xs.length)
      idx.forEach(([, i], k) => (r[i] = k))
      return r
    }
    const ra = rank(pairs.map((p) => p[0]))
    const rb = rank(pairs.map((p) => p[1]))
    const n = pairs.length
    const d2 = ra.reduce((s, x, i) => s + (x - rb[i]) ** 2, 0)
    const rho = n > 2 ? 1 - (6 * d2) / (n * (n * n - 1)) : 0
    check(rho > 0.8, `${mode}: the 3D glow follows the light (bigger when brighter)`, `ρ ${rho.toFixed(2)} over ${n} samples`)
    check(errors.length === 0, `${mode}: no page errors`, errors.slice(0, 2).join(' | '))
    if (SHOTS && frames.length > 0) {
      mkdirSync(SHOTS, { recursive: true })
      const strip = await page.evaluate(async (imgs) => {
        const loaded = await Promise.all(
          imgs.map(async (b64) => {
            const i = new Image()
            i.src = `data:image/png;base64,${b64}`
            await i.decode()
            return i
          }),
        )
        const cv = document.createElement('canvas')
        cv.width = loaded.length * 142
        cv.height = 140
        const g = cv.getContext('2d')
        loaded.forEach((i, k) => g.drawImage(i, k * 142, 0))
        return cv.toDataURL('image/png').slice(22)
      }, frames.map((f) => f.toString('base64')))
      writeFileSync(path.join(SHOTS, `glow-breath-${mode}.png`), Buffer.from(strip, 'base64'))
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
