/**
 * The LED displays in the LEDs' brightness language (owner: glow, F13),
 * measured in real pixels:
 *
 *   UX_E2E_URL=http://localhost:5421/ UX_E2E_SHOTS=<dir> node scripts/ux-e2e/glow-displays.mjs
 *   (optional) GLOW_MODES=performance,enhanced
 *
 * zh-TW product chrome, 1440×900, both render modes. The classic
 * 7-segment counter (examples/counter.json), the TM1637 counter and the
 * MAX7219 matrix examples: the display is framed and shot dark (before the
 * run) and lit (paused after ≈ 2.5 s of simulated time). The bright red
 * pixels the lit display changed (ΔE ≥ 20, R ≥ 150, R > G + 40) must be
 * LIT RED, not the old pale salmon: ≥ 60 % saturated (R − G ≥ 90,
 * R − B ≥ 90), ≤ 25 % pale (G ≥ 110 — what remains is the smoked glass's
 * sheen and the glow over a grey face); and the glow must spill past the lit
 * segments onto the face: off the saturated cores, pixels that turned
 * redder (Δ(R − G) ≥ 15) cover ≥ 25 % of the cores' area.
 * The shots are written to UX_E2E_SHOTS — read them. Exit code 1 on any
 * failed check.
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

const CASES = [
  { name: '7-segment counter', file: 'examples/counter.json', kind: 'layout', id: 'DS1' },
  { name: 'TM1637 counter', file: 'examples/embedded/tm1637-counter.ohmlet.json', kind: 'embedded', id: 'TM1' },
  { name: 'MAX7219 matrix', file: 'examples/embedded/max7219-matrix.ohmlet.json', kind: 'embedded', id: 'MX1' },
]

const browser = await chromium.launch({ channel: CHANNEL, headless: true })
try {
  for (const mode of MODES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.addInitScript(
      ([m]) => {
        if (sessionStorage.getItem('glowd.seeded')) return
        localStorage.clear()
        localStorage.setItem('bb.onboarded', '1')
        localStorage.setItem('bb.renderMode', m)
        localStorage.setItem('bb.lang', 'zh-TW')
        localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: false }))
        for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
        sessionStorage.setItem('glowd.seeded', '1')
      },
      [mode],
    )
    await page.goto(`${URL}?e2e&shotrig`, { timeout: 180_000 })
    await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig, null, { timeout: 120_000 })
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
    const until = async (t, budget = 40_000) => {
      const t0 = Date.now()
      while (Date.now() - t0 < budget) {
        const s = await mod('/src/state/store.ts', 'const s = m.useStore.getState(); return s.telemetry ? s.telemetry.time : 0')
        if (s >= t) return s
        await sleep(150)
      }
      return -1
    }
    for (const c of CASES) {
      await mod('/src/state/store.ts', 'm.useStore.getState().resetSim?.()')
      const txt = readFileSync(path.join(ROOT, c.file), 'utf8')
      if (c.kind === 'embedded') await mod('/src/ui/embedded/lab.ts', 'return m.useLab.getState().importProject(a)', txt)
      else await mod('/src/state/store.ts', 'return m.useStore.getState().loadLayout(a)', JSON.parse(txt))
      await sleep(mode === 'enhanced' ? 2500 : 1500)
      await mod('/src/ui/workspace/scene-bridge.ts', 'm.frameTargets({ components: a.ids }, { minElevationDeg: 50 })', { ids: [c.id] })
      await sleep(mode === 'enhanced' ? 2000 : 1000)
      const dark = (await page.screenshot()).toString('base64')
      await mod('/src/state/store.ts', 'm.useStore.getState().startSim()')
      await until(2.5)
      await sleep(3000) // the celebrations fade
      await mod('/src/state/store.ts', 'm.useStore.getState().stopSim()')
      await sleep(mode === 'enhanced' ? 2000 : 1000)
      const litBuf = await page.screenshot()
      const lit = litBuf.toString('base64')
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true })
        const tag = `disp-${mode}-${c.id}`
        writeFileSync(path.join(SHOTS, `${tag}-dark.png`), Buffer.from(dark, 'base64'))
        writeFileSync(path.join(SHOTS, `${tag}-lit.png`), litBuf)
      }
      const r = await page.evaluate(
        async ([pa, pb]) => {
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
          const A = await load(pa)
          const B = await load(pb)
          const lin = (u) => {
            const v = u / 255
            return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
          }
          const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
          const lab = (d, i) => {
            const R = lin(d[i])
            const G = lin(d[i + 1])
            const Bb = lin(d[i + 2])
            const X = (0.4124 * R + 0.3576 * G + 0.1805 * Bb) / 0.95047
            const Y = 0.2126 * R + 0.7152 * G + 0.0722 * Bb
            const Z = (0.0193 * R + 0.1192 * G + 0.9505 * Bb) / 1.08883
            return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
          }
          // the framed display sits in the middle of the canvas; the chrome sits at the edges
          const x0 = Math.round(A.width * 0.12)
          const x1 = Math.round(A.width * 0.88)
          const y0 = Math.round(A.height * 0.1)
          const y1 = Math.round(A.height * 0.9)
          let changed = 0
          let bright = 0
          let red = 0
          let pale = 0
          let glow = 0
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
              const i = (y * A.width + x) * 4
              const p = lab(A.data, i)
              const q = lab(B.data, i)
              const dE = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
              if (dE < 6) continue
              const R = B.data[i]
              const G = B.data[i + 1]
              const Bl = B.data[i + 2]
              const core = R >= 150 && R - G >= 90 && R - Bl >= 90
              if (dE >= 20) {
                changed++
                // a lit segment / dot: bright and red — saturated, or the old pale salmon
                if (R >= 150 && R > G + 40) {
                  bright++
                  if (core) red++
                  else if (G >= 110) pale++
                }
              }
              // the glow: off the segment cores, the face turned redder
              if (!core && B.data[i] - B.data[i + 1] - (A.data[i] - A.data[i + 1]) >= 15) glow++
            }
          return { changed, bright, red, pale, glow }
        },
        [dark, lit],
      )
      const share = (n) => (r.bright ? n / r.bright : 0)
      check(r.changed > 300 && r.bright > 200, `${mode} ${c.name}: the display lights up`, `${r.changed} px changed, ${r.bright} lit red`)
      check(share(r.red) >= 0.6, `${mode} ${c.name}: lit segments are saturated red`, `${(100 * share(r.red)).toFixed(0)} % of the lit pixels`)
      check(share(r.pale) <= 0.25, `${mode} ${c.name}: not the old pale salmon`, `${(100 * share(r.pale)).toFixed(0)} % pale (the glass sheen / the glow over a grey face)`)
      check(r.glow >= 0.25 * r.red, `${mode} ${c.name}: a glow spills past the segments onto the face`, `${r.glow} px turned redder around ${r.red} segment px`)
    }
    check(errors.length === 0, `${mode}: no page errors`, errors.slice(0, 2).join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
