/**
 * LED brightness ladder (owner: glow) — the product owner's
 * 「LED 要非常區別性的亮度（亮的超亮，電流小時明顯變小，要有區別性）」 measured
 * in real pixels:
 *
 *   UX_E2E_URL=http://localhost:5421/ UX_E2E_SHOTS=<dir> node scripts/ux-e2e/glow-ladder.mjs
 *   (optional) GLOW_MODES=performance,enhanced  GLOW_COLORS=red,green,yellow,blue,white
 *              GLOW_VIEWS=board,close  GLOW_DPR=1
 *
 * For every render mode and LED colour, a 5 V ladder of six LEDs, each with
 * the resistor that gives ≈ 0 / 0.5 / 2 / 4 / 10 / 19.5 mA (the 0 mA LED
 * has a floating anode). The REAL currents are read back from telemetry
 * (asserted within ±25 % of the target). Two frames are shot from the same
 * camera: the board before the run (every LED dark) and the running circuit
 * (paused once the celebrations have faded, so nothing but the LEDs
 * changed). Each LED is located on screen from its own light halo's world
 * position; per LED the script averages the per-pixel CIELAB ΔE76 between
 * the lit and the dark frame over the crop (a disc of 3 dome radii: G, "how
 * different does it look"), over the ring OUTSIDE the dome (1.4–3 radii,
 * beside / behind it — the glow the eye reads as "this LED shines") and
 * over 6 dome radii (the light's brightness × extent).
 *
 * Checks (per mode × colour × view):
 *  - the 0 mA control LED does not change (G ≤ 1.5);
 *  - 0.5 mA is a clearly visible dim glow (G ≥ 5);
 *  - 4 mA (every GPIO example) is CLEARLY on: G ≥ 10, and the glow shows
 *    outside the dome (ring ΔE ≥ 6);
 *  - monotonic and step-wise distinguishable: 0.5 → 2 → 4 → 10 → 19.5 mA
 *    each raise the light over 6 radii by ≥ 25 %;
 *  - coloured lenses stay saturated when lit (dome chroma ≥ 80 % of the
 *    unlit lens, red / green / yellow at 4 mA);
 *  - glow2 (M3), LUMINANCE — for white and red (GLOW_LUM_COLORS), in both
 *    modes and both views, the same frames measured as |ΔL*| only (a white
 *    LED whose glow only turned the board blue read as unlit): the 0 mA
 *    control unchanged (≤ 0.5); 0.5 mA plainly on (mean |ΔL*| over 3 dome
 *    radii ≥ 2.5); every neighbour step 0.5 → 2 → 4 → 10 → 19.5 mA brighter
 *    by ≥ 0.5 mean |ΔL*| over 6 dome radii AND ×1.25 or more.
 * The ladder shots (dark and lit) are written to UX_E2E_SHOTS — read them.
 * Exit code 1 on any failed check.
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright')
const URL = process.env.UX_E2E_URL ?? 'http://localhost:5173/'
const SHOTS = process.env.UX_E2E_SHOTS ?? null
const CHANNEL = process.env.UX_E2E_CHANNEL ?? 'msedge'
const MODES = (process.env.GLOW_MODES ?? 'performance,enhanced').split(',').filter(Boolean)
const COLORS = (process.env.GLOW_COLORS ?? 'red,green,yellow,blue,white').split(',').filter(Boolean)
const VIEWS = (process.env.GLOW_VIEWS ?? 'board,close').split(',').filter(Boolean)
const DPR = Number(process.env.GLOW_DPR ?? 1)
/** glow2 (M3): the colours whose ladder must also step in LUMINANCE, and the thresholds (mean |ΔL*|) */
const LUM_COLORS = (process.env.GLOW_LUM_COLORS ?? 'white,red').split(',').filter(Boolean)
const LUM_ON = 2.5
const LUM_STEP = 0.5
const LUM_RATIO = 1.25
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(cond, what, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${extra !== '' ? `  (${extra})` : ''}`)
  if (!cond) failures++
  return cond
}

// --- the ladder ------------------------------------------------------------

/** the engine's LED model: V(10 mA) = the colour's Vf, ideality n = 2 */
const VF = { red: 1.8, green: 2.2, yellow: 2.0, blue: 3.0, white: 3.2 }
const NVT = 2 * 0.025852
const SUPPLY = 5
const TARGET_MA = [0, 0.5, 2, 4, 10, 19.5]
const COLS = TARGET_MA.map((_, i) => 9 + 7 * i)
/** the rail hole index whose x (2.5 + i + ⌊i/5⌋) is nearest to x */
function railIndexNear(x) {
  let best = 0
  for (let i = 0; i < 50; i++) if (Math.abs(2.5 + i + Math.floor(i / 5) - x) < Math.abs(2.5 + best + Math.floor(best / 5) - x)) best = i
  return best
}
function resistorFor(color, mA) {
  const i = mA / 1000
  const vf = VF[color] + NVT * Math.log(i / 0.01)
  return Math.round(((SUPPLY - vf) / i) * 10) / 10
}
function ladder(color) {
  const components = [{ id: 'PS1', type: 'power_supply', params: { voltage: SUPPLY } }]
  TARGET_MA.forEach((mA, k) => {
    const c = COLS[k]
    const n = k + 1
    if (mA > 0) {
      components.push({ id: `R${n}`, type: 'resistor', holes: [`top+${railIndexNear(c - 5)}`, `a${c}`], params: { resistance: resistorFor(color, mA) } })
    }
    components.push({ id: `LED${n}`, type: 'led', holes: [`b${c}`, `top-${railIndexNear(c - 4)}`], params: { color } })
  })
  return {
    version: 1,
    name: `glow-ladder-${color}`,
    components,
    wires: [
      { id: 'W1', from: 'PS1:+', to: 'top+0' },
      { id: 'W2', from: 'PS1:-', to: 'top-0' },
    ],
  }
}

// --- page helpers ------------------------------------------------------------

async function open(browser, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([m]) => {
      if (sessionStorage.getItem('glow.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', m)
      localStorage.setItem('bb.lang', 'zh-TW')
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: false }))
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      sessionStorage.setItem('glow.seeded', '1')
    },
    [mode],
  )
  await page.goto(`${URL}?e2e&shotrig`, { timeout: 180_000 })
  await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig && !!window.__vividFx, null, { timeout: 120_000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(mode === 'enhanced' ? 4000 : 1200) // the studio HDRI loads async
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

/** the LEDs' dome centres (their light halo) in viewport px, and the dome radius in px */
async function ledScreen(page, ids) {
  return page.evaluate((list) => {
    const root = window.__vividFx.group.parent?.parent
    const out = {}
    root?.traverse((o) => {
      if (o.name !== 'led-halo') return
      let p = o
      let id
      while (p && !id) {
        id = typeof p.userData.componentId === 'string' ? p.userData.componentId : undefined
        p = p.parent
      }
      if (!id || !list.includes(id)) return
      const w = o.getWorldPosition(o.position.clone())
      const c = window.__shotRig.project(w.x, w.y, w.z)
      const e = window.__shotRig.project(w.x + 0.42, w.y, w.z)
      if (c && e) out[id] = { x: c.x, y: c.y, r: Math.max(2, Math.hypot(e.x - c.x, e.y - c.y)) }
    })
    return out
  }, ids)
}

/** per-LED pixel statistics between two full-viewport PNGs (computed in the page) */
async function measure(page, offPng, onPng, spots, dpr) {
  return page.evaluate(
    async ([a, b, sp, k]) => {
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
        const fx = f(X)
        const fy = f(Y)
        const fz = f(Z)
        return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
      }
      const res = {}
      for (const [id, s] of Object.entries(sp)) {
        const cx = s.x * k
        const cy = s.y * k
        const r = s.r * k
        const R = r * 6
        let nAll = 0
        let dAll = 0
        let nCrop = 0
        let dCrop = 0
        let nRing = 0
        let dRing = 0
        let lRing = 0
        let nDome = 0
        let dDome = 0
        let lDome = 0
        let cOn = 0
        let cOff = 0
        let rgbOn = [0, 0, 0]
        // glow2 (M3): LUMINANCE only (|ΔL*|, not hue) over the crop and the 6-radius disc
        let lAbsCrop = 0
        let lAbsAll = 0
        let lOnDome = 0
        let lOffDome = 0
        for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(A.height - 1, Math.ceil(cy + R)); y++) {
          for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(A.width - 1, Math.ceil(cx + R)); x++) {
            const d = Math.hypot(x - cx, y - cy)
            if (d > R) continue
            const i = (y * A.width + x) * 4
            const p = lab(A.data, i)
            const q = lab(B.data, i)
            const de = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
            nAll++
            dAll += de
            lAbsAll += Math.abs(q[0] - p[0])
            if (d <= r * 3) {
              nCrop++
              dCrop += de
              lAbsCrop += Math.abs(q[0] - p[0])
            }
            if (d <= r) {
              nDome++
              dDome += de
              lDome += q[0] - p[0]
              lOnDome += q[0]
              lOffDome += p[0]
              cOn += Math.hypot(q[1], q[2])
              cOff += Math.hypot(p[1], p[2])
              rgbOn = [rgbOn[0] + B.data[i], rgbOn[1] + B.data[i + 1], rgbOn[2] + B.data[i + 2]]
            } else if (d >= r * 1.4 && d <= r * 3 && y <= cy + r * 0.5) {
              // the ring beside and behind the dome (not the body below it)
              nRing++
              dRing += de
              lRing += q[0] - p[0]
            }
          }
        }
        res[id] = {
          G: dCrop / Math.max(1, nCrop),
          glow: dAll / Math.max(1, nAll),
          ring: dRing / Math.max(1, nRing),
          ringL: lRing / Math.max(1, nRing),
          dome: dDome / Math.max(1, nDome),
          domeL: lDome / Math.max(1, nDome),
          chromaOn: cOn / Math.max(1, nDome),
          chromaOff: cOff / Math.max(1, nDome),
          rgbOn: rgbOn.map((v) => Math.round(v / Math.max(1, nDome))),
          rPx: r,
          lumCrop: lAbsCrop / Math.max(1, nCrop),
          lumGlow: lAbsAll / Math.max(1, nAll),
          lumDomeOn: lOnDome / Math.max(1, nDome),
          lumDomeOff: lOffDome / Math.max(1, nDome),
        }
      }
      return res
    },
    [offPng.toString('base64'), onPng.toString('base64'), spots, dpr],
  )
}

async function waitFx(page, budget = 9000) {
  const t0 = Date.now()
  while (Date.now() - t0 < budget) {
    const n = await page.evaluate(() => window.__vividFx.particleCount)
    if (n === 0) return true
    await sleep(200)
  }
  return false
}

// --- run ---------------------------------------------------------------------

const browser = await chromium.launch({ channel: CHANNEL, headless: true })
const summary = []
try {
  for (const mode of MODES) {
    const { page, ctx, errors, mod } = await open(browser, mode)
    const active = await page.evaluate(() => document.querySelector('canvas') !== null)
    check(active, `${mode}: the 3D canvas is up`)
    for (const color of COLORS) {
      const ids = TARGET_MA.map((_, k) => `LED${k + 1}`)
      await mod('/src/state/store.ts', 'm.useStore.getState().resetSim?.(); return m.useStore.getState().loadLayout(a)', ladder(color))
      await sleep(1200)
      // the cameras: 'board' = the whole ladder at a normal working distance,
      // 'close' = the reviewer's close look
      const mid = await page.evaluate(() => {
        const a = window.__e2e.componentWorld('LED1', 0)
        const b = window.__e2e.componentWorld('LED6', 0)
        return a && b ? { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 } : null
      })
      // (the target sits a little left of the ladder's middle: the left
      // dock covers the canvas's first ≈ 90 px)
      const poses = {
        board: [mid.x - 2, 30, mid.z + 34, mid.x - 2, 0, mid.z],
        close: [mid.x - 1.5, 19, mid.z + 25, mid.x - 1.5, 0, mid.z + 1],
      }
      const offShots = {}
      for (const v of VIEWS) {
        await page.evaluate((p) => window.__shotRig.setCamera(...p), poses[v])
        await sleep(mode === 'enhanced' ? 1800 : 900)
        offShots[v] = await page.screenshot()
      }
      await mod('/src/state/store.ts', 'm.useStore.getState().startSim()')
      // past the settle + any working-circuit sparkles, then pause: a DC
      // ladder is steady, so the paused frame is the running look
      const t0 = Date.now()
      while (Date.now() - t0 < 20_000) {
        const t = await mod('/src/state/store.ts', 'const s = m.useStore.getState(); return s.telemetry ? s.telemetry.time : 0')
        if (t >= 2.0) break
        await sleep(200)
      }
      await waitFx(page)
      await mod('/src/state/store.ts', 'm.useStore.getState().stopSim()')
      await sleep(600)
      const real = []
      for (const id of ids) {
        const c = await page.evaluate((i) => window.__e2e.component(i), id)
        real.push(Math.abs(c?.current ?? 0) * 1000)
      }
      const currentsOk = real.every((mA, k) => (TARGET_MA[k] === 0 ? mA < 0.01 : Math.abs(mA - TARGET_MA[k]) / TARGET_MA[k] < 0.25))
      check(currentsOk, `${mode} ${color}: real currents near the ladder targets`, real.map((v) => v.toFixed(2)).join(' / ') + ' mA')
      for (const v of VIEWS) {
        await page.evaluate((p) => window.__shotRig.setCamera(...p), poses[v])
        await sleep(mode === 'enhanced' ? 1800 : 900)
        const onShot = await page.screenshot()
        const spots = await ledScreen(page, ids)
        const m = await measure(page, offShots[v], onShot, spots, DPR)
        const row = ids.map((id) => m[id])
        const G = row.map((r) => r?.G ?? NaN) // the crop: 3 dome radii
        const tag = `${mode} ${color} ${v}`
        console.log(
          `      ${tag}: ` +
            row
              .map((r, k) => `${TARGET_MA[k]}mA G ${r?.G.toFixed(1)} glow ${r?.glow.toFixed(2)} ring ${r?.ring.toFixed(1)} (L ${r?.ringL.toFixed(1)}) dome ${r?.dome.toFixed(1)} C ${r?.chromaOff.toFixed(0)}→${r?.chromaOn.toFixed(0)} rgb ${r?.rgbOn.join(',')} | lum crop ${r?.lumCrop.toFixed(2)} glow ${r?.lumGlow.toFixed(2)} dome L* ${r?.lumDomeOff.toFixed(0)}→${r?.lumDomeOn.toFixed(0)}`)
              .join('\n        '),
        )
        summary.push({ mode, color, view: v, currents: real, metrics: row })
        check(G[0] <= 1.5, `${tag}: the 0 mA control LED stays as it was`, G[0].toFixed(2))
        check(G[1] >= 5, `${tag}: 0.5 mA is a visible dim glow`, `G ${G[1].toFixed(1)}`)
        check(G[3] >= 10 && row[3].ring >= 6, `${tag}: 4 mA is clearly on, glow outside the dome`, `G ${G[3].toFixed(1)}, ring ΔE ${row[3].ring.toFixed(1)}`)
        // each step: the light (the mean ΔE over 6 dome radii — brightness ×
        // extent) grows by a quarter or more
        const W = row.map((r) => r?.glow ?? NaN)
        const steps = [1, 2, 3, 4].map((k) => W[k + 1] / W[k])
        check(steps.every((s) => s >= 1.25), `${tag}: 0.5 → 2 → 4 → 10 → 19.5 mA each look brighter`, steps.map((s) => `×${s.toFixed(2)}`).join(' '))
        if (['red', 'green', 'yellow'].includes(color)) {
          check(row[3].chromaOn >= 0.8 * row[3].chromaOff, `${tag}: the lit lens stays saturated at 4 mA`, `C* ${row[3].chromaOff.toFixed(0)} → ${row[3].chromaOn.toFixed(0)}`)
        }
        if (LUM_COLORS.includes(color)) {
          // glow2 (M3): the steps must show in LUMINANCE (|ΔL*|), not only in hue —
          // a white LED whose glow only turned the board blue read as unlit
          const Lc = row.map((r) => r?.lumCrop ?? NaN)
          const Lg = row.map((r) => r?.lumGlow ?? NaN)
          check(Lc[0] <= 0.5, `${tag}: luminance — the 0 mA control LED stays as it was`, `|ΔL*| ${Lc[0].toFixed(2)}`)
          check(
            Lc[1] >= LUM_ON,
            `${tag}: luminance — 0.5 mA is plainly ON (|ΔL*| over 3 dome radii ≥ ${LUM_ON})`,
            `${Lc[1].toFixed(2)}; dome L* ${row[1].lumDomeOff.toFixed(0)} → ${row[1].lumDomeOn.toFixed(0)}`,
          )
          const dL = [1, 2, 3, 4].map((k) => Lg[k + 1] - Lg[k])
          const rL = [1, 2, 3, 4].map((k) => Lg[k + 1] / Lg[k])
          check(
            dL.every((d) => d >= LUM_STEP) && rL.every((q) => q >= LUM_RATIO),
            `${tag}: luminance — 0.5 → 2 → 4 → 10 → 19.5 mA each step brighter (|ΔL*| over 6 radii +${LUM_STEP} and ×${LUM_RATIO} or more)`,
            dL.map((d, i) => `+${d.toFixed(2)} (×${rL[i].toFixed(2)})`).join(' '),
          )
        }
        if (SHOTS) {
          mkdirSync(SHOTS, { recursive: true })
          const xs = Object.values(spots).map((s) => s.x)
          const ys = Object.values(spots).map((s) => s.y)
          const pad = v === 'close' ? 90 : 60
          const clip = {
            x: Math.max(0, Math.min(...xs) - pad),
            y: Math.max(0, Math.min(...ys) - pad),
            width: Math.min(1440, Math.max(...xs) - Math.min(...xs) + 2 * pad),
            height: Math.min(900, Math.max(...ys) - Math.min(...ys) + 2 * pad),
          }
          await page.screenshot({ path: path.join(SHOTS, `glow-${mode}-${color}-${v}-lit.png`), clip })
          // the dark frame of the same view for side-by-side reading
          await page.evaluate(
            async ([b64, c, k]) => {
              const img = new Image()
              img.src = `data:image/png;base64,${b64}`
              await img.decode()
              const cv = document.createElement('canvas')
              cv.width = c.width * k
              cv.height = c.height * k
              cv.getContext('2d').drawImage(img, c.x * k, c.y * k, c.width * k, c.height * k, 0, 0, c.width * k, c.height * k)
              window.__glowDark = cv.toDataURL('image/png').slice(22)
            },
            [offShots[v].toString('base64'), clip, DPR],
          )
          const dark = await page.evaluate(() => window.__glowDark)
          writeFileSync(path.join(SHOTS, `glow-${mode}-${color}-${v}-dark.png`), Buffer.from(dark, 'base64'))
          // the crops, enlarged: top row dark, bottom row lit, one column per rung
          const cells = await page.evaluate(
            async ([a, b, sp, list, mA, k]) => {
              const load = async (b64) => {
                const img = new Image()
                img.src = `data:image/png;base64,${b64}`
                await img.decode()
                return img
              }
              const A = await load(a)
              const B = await load(b)
              const C = 170
              const cv = document.createElement('canvas')
              cv.width = C * list.length
              cv.height = C * 2 + 22
              const g = cv.getContext('2d')
              g.fillStyle = '#222'
              g.fillRect(0, 0, cv.width, cv.height)
              list.forEach((id, i) => {
                const s = sp[id]
                if (!s) return
                const h = s.r * 4.5 * k
                for (const [img, row] of [[A, 0], [B, 1]]) g.drawImage(img, s.x * k - h, s.y * k - h, 2 * h, 2 * h, i * C, row * C, C, C)
                g.fillStyle = '#fff'
                g.font = '15px sans-serif'
                g.fillText(`${mA[i]} mA`, i * C + 8, 2 * C + 16)
              })
              return cv.toDataURL('image/png').slice(22)
            },
            [offShots[v].toString('base64'), onShot.toString('base64'), spots, ids, real.map((x) => x.toFixed(1)), DPR],
          )
          writeFileSync(path.join(SHOTS, `glow-${mode}-${color}-${v}-cells.png`), Buffer.from(cells, 'base64'))
        }
      }
      await mod('/src/state/store.ts', 'm.useStore.getState().resetSim?.()')
    }
    check(errors.length === 0, `${mode}: no page errors`, errors.slice(0, 2).join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
if (SHOTS) writeFileSync(path.join(SHOTS, 'glow-ladder.json'), JSON.stringify(summary, null, 1))
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
