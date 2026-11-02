/**
 * The LED glow stays honest about what the eye can see (owner: glow) — the
 * second-pass review findings, measured in real pixels:
 *
 *   UX_E2E_URL=http://localhost:5421/ UX_E2E_SHOTS=<dir> node scripts/ux-e2e/glow-occlusion.mjs
 *   (optional) GLOW_MODES=performance,enhanced
 *
 * zh-TW product chrome, 1440×900, both render modes:
 *  A. a LED hidden behind another part casts no glare — the lcd1602-i2c
 *     example, the Blue Pill's power LED seen through the LCD module from a
 *     low camera: lit vs dark ΔE ≤ 2 over the LED's spot; the same LED seen
 *     from above (control) does show its glow (ΔE ≥ 4);
 *  B. the glow never widens the part — two lit LEDs (≈ 4 and 18 mA): each
 *     LED part's box (the scene's Box3.setFromObject rule) is the same with
 *     and without its glow objects, running and after a reset, and the glow
 *     scales return to a point when dark;
 *  C. the UI overlays stay on top of the glow — lesson b1 (solution loaded,
 *     running, the guide on the step that highlights LED1 at ≈ 10 mA): the
 *     highlight's cyan rim stays cyan over the glow (its blue-minus-red ≥
 *     half its glow-free value, and its contrast against the red-tinted
 *     board ≥ 30 above a control frame with the glow forced over the
 *     overlays — the reviewed defect), and the live label 「LED1 …」 over the
 *     glow changes by ≤ 6 ΔE.
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

async function open(browser, mode, workspace) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([m, ws]) => {
      if (sessionStorage.getItem('glowo.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', m)
      localStorage.setItem('bb.lang', 'zh-TW')
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      sessionStorage.setItem('glowo.seeded', '1')
    },
    [mode, workspace],
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
  const until = async (t, budget = 40_000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < budget) {
      const s = await mod('/src/state/store.ts', 'const s = m.useStore.getState(); return s.telemetry ? s.telemetry.time : 0')
      if (s >= t) return s
      await sleep(150)
    }
    return -1
  }
  const run = () => mod('/src/state/store.ts', 'm.useStore.getState().startSim()')
  const stop = () => mod('/src/state/store.ts', 'm.useStore.getState().stopSim()')
  const reset = () => mod('/src/state/store.ts', 'm.useStore.getState().resetSim?.()')
  const shot = async (name) => {
    const png = await page.screenshot()
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      writeFileSync(path.join(SHOTS, `occl-${mode}-${name}.png`), png)
    }
    return png.toString('base64')
  }
  return { page, ctx, errors, mod, until, run, stop, reset, shot }
}

/** in the page: decode two shots, mean ΔE76 over a rect, plus the share of cyan (highlight) pixels in each */
async function compare(page, a, b, rect) {
  return page.evaluate(
    async ([pa, pb, r]) => {
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
      // the highlight rim: cyan in the frame without glow (b)
      const cyan = (d, i) => d[i + 2] > 140 && d[i + 1] > 140 && d[i + 2] - d[i] > 45
      let n = 0
      let sum = 0
      // blue-minus-red over the rim pixels and over their surroundings (not rim, not the red lens)
      let rimA = 0
      let rimB = 0
      let rimN = 0
      let aroundA = 0
      let aroundN = 0
      const x0 = Math.max(0, Math.round(r.x))
      const y0 = Math.max(0, Math.round(r.y))
      const x1 = Math.min(A.width, Math.round(r.x + r.w))
      const y1 = Math.min(A.height, Math.round(r.y + r.h))
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * A.width + x) * 4
          const p = lab(A.data, i)
          const q = lab(B.data, i)
          sum += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
          if (cyan(B.data, i)) {
            rimA += A.data[i + 2] - A.data[i]
            rimB += B.data[i + 2] - B.data[i]
            rimN++
          } else if (B.data[i] - B.data[i + 2] <= 60) {
            aroundA += A.data[i + 2] - A.data[i]
            aroundN++
          }
          n++
        }
      const rimBR = rimN ? rimA / rimN : 0
      return { dE: n ? sum / n : 0, rimN, rimBR, rimBRNoGlow: rimN ? rimB / rimN : 0, contrast: rimBR - (aroundN ? aroundA / aroundN : 0), n }
    },
    [a, b, rect],
  )
}

/** a part's lit light halo: world + screen position and the dome radius in px */
async function haloOf(page, id) {
  return page.evaluate((cid) => {
    const root = window.__vividFx.group.parent?.parent
    let out = null
    root?.traverse((o) => {
      if (out || o.name !== 'led-halo') return
      let p = o
      let owner
      while (p && !owner) {
        owner = typeof p.userData.componentId === 'string' ? p.userData.componentId : undefined
        p = p.parent
      }
      if (owner !== cid) return
      const w = o.getWorldPosition(o.position.clone())
      out = { visible: o.visible, w: { x: w.x, y: w.y, z: w.z }, lensR: o.userData.glowLensR ?? 0.2 }
    })
    return out
  }, id)
}
const project = (page, w) => page.evaluate(([x, y, z]) => window.__shotRig.project(x, y, z), [w.x, w.y, w.z])

const browser = await chromium.launch({ channel: CHANNEL, headless: true })
try {
  for (const mode of MODES) {
    // ------------------------------------------------ A. a hidden LED: no glare
    {
      const a = await open(browser, mode, false)
      const txt = readFileSync(path.join(ROOT, 'examples/embedded/lcd1602-i2c.ohmlet.json'), 'utf8')
      await a.mod('/src/ui/embedded/lab.ts', 'return m.useLab.getState().importProject(a)', txt)
      await sleep(2500)
      await a.run()
      await a.until(1.0)
      await sleep(3500) // the celebrations fade
      await a.stop()
      await sleep(800)
      const h = await haloOf(a.page, 'U1')
      const lcd = await a.page.evaluate(() => window.__e2e.componentWorld('LCD1', 1.0))
      if (!check(!!h && h.visible && !!lcd, `${mode} A: the Blue Pill power LED is lit`)) continue
      const dx = lcd.x - h.w.x
      const dz = lcd.z - h.w.z
      const L = Math.hypot(dx, dz)
      const behind = [lcd.x + (dx / L) * 5, h.w.y + 0.4, lcd.z + (dz / L) * 5]
      const above = [h.w.x - 6, h.w.y + 14, h.w.z + 12]
      const pose = async (cam) => {
        await a.page.evaluate(([c, t]) => window.__shotRig.setCamera(c[0], c[1], c[2], t.x, t.y, t.z), [cam, h.w])
        await sleep(mode === 'enhanced' ? 1800 : 900)
      }
      await pose(behind)
      const sB = await project(a.page, h.w)
      const behindLit = await a.shot('A-behind-lit')
      await pose(above)
      const sA = await project(a.page, h.w)
      const aboveLit = await a.shot('A-above-lit')
      await a.reset()
      await sleep(1200)
      await pose(behind)
      const behindDark = await a.shot('A-behind-dark')
      await pose(above)
      const aboveDark = await a.shot('A-above-dark')
      const box = (s, k) => ({ x: s.x - k, y: s.y - k, w: 2 * k, h: 2 * k })
      const hid = await compare(a.page, behindLit, behindDark, box(sB, 30))
      const seen = await compare(a.page, aboveLit, aboveDark, box(sA, 30))
      check(hid.dE <= 2, `${mode} A: the LED hidden behind the LCD module casts no glare through it`, `ΔE ${hid.dE.toFixed(2)}`)
      check(seen.dE >= 4, `${mode} A: the same LED seen from above shows its glow (control)`, `ΔE ${seen.dE.toFixed(2)}`)
      check(a.errors.length === 0, `${mode} A: no page errors`, a.errors.slice(0, 2).join(' | '))
      await a.ctx.close()
    }

    // ------------------------------------------- B. the glow never widens the part
    {
      const a = await open(browser, mode, true)
      await a.mod('/src/state/store.ts', 'return m.useStore.getState().loadLayout(a)', {
        version: 1,
        name: 'glow-bounds',
        components: [
          { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
          { id: 'R1', type: 'resistor', holes: ['top+13', 'a20'], params: { resistance: 820 } },
          { id: 'LED1', type: 'led', holes: ['b20', 'top-24'], params: { color: 'red' } },
          { id: 'R2', type: 'resistor', holes: ['top+23', 'a32'], params: { resistance: 150 } },
          { id: 'LED2', type: 'led', holes: ['b32', 'top-34'], params: { color: 'green' } },
        ],
        wires: [
          { id: 'W1', from: 'PS1:+', to: 'top+0' },
          { id: 'W2', from: 'PS1:-', to: 'top-0' },
        ],
      })
      await sleep(1500)
      const boxes = () =>
        a.page.evaluate(() => {
          const root = window.__vividFx.group.parent.parent
          const parts = {}
          root.traverse((o) => {
            const id = o.userData?.componentId
            if ((id === 'LED1' || id === 'LED2') && !parts[id]) parts[id] = o
          })
          const glow = (c) => c.name === 'led-halo' || c.name === 'led-flare' || c.name === 'led-pool'
          const res = {}
          for (const [id, o] of Object.entries(parts)) {
            o.updateWorldMatrix(true, true)
            // Box3.setFromObject: every node's geometry.boundingBox through its world matrix
            const B = (skip) => {
              const mn = [Infinity, Infinity, Infinity]
              const mx = [-Infinity, -Infinity, -Infinity]
              o.traverse((c) => {
                if (skip && glow(c)) return
                const g = c.geometry
                if (!g) return
                if (!g.boundingBox) g.computeBoundingBox()
                const bb = g.boundingBox
                if (bb.max.x < bb.min.x) return
                const e = c.matrixWorld.elements
                for (const x of [bb.min.x, bb.max.x])
                  for (const y of [bb.min.y, bb.max.y])
                    for (const z of [bb.min.z, bb.max.z]) {
                      const w = [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]
                      for (let k = 0; k < 3; k++) {
                        mn[k] = Math.min(mn[k], w[k])
                        mx[k] = Math.max(mx[k], w[k])
                      }
                    }
              })
              return [...mn, ...mx].map((v) => Math.round(v * 1000) / 1000)
            }
            let maxScale = 0
            let lit = false
            o.traverse((c) => {
              if (!glow(c)) return
              maxScale = Math.max(maxScale, c.scale.x)
              if (c.visible) lit = true
            })
            res[id] = { all: B(false), bare: B(true), maxScale, lit }
          }
          return res
        })
      await a.run()
      await a.until(1.0)
      await sleep(3000)
      const running = await boxes()
      const c1 = await a.page.evaluate(() => window.__e2e.component('LED1'))
      const c2 = await a.page.evaluate(() => window.__e2e.component('LED2'))
      console.log(`      ${mode} B: LED1 ${((c1?.current ?? 0) * 1000).toFixed(2)} mA, LED2 ${((c2?.current ?? 0) * 1000).toFixed(2)} mA`)
      for (const id of ['LED1', 'LED2']) {
        const r = running[id]
        check(!!r && r.lit && r.maxScale > 1, `${mode} B: ${id} glows`, r ? `scale ${r.maxScale.toFixed(2)}` : 'missing')
        check(!!r && JSON.stringify(r.all) === JSON.stringify(r.bare), `${mode} B: ${id}'s box is the same with and without its glow (running)`, r ? JSON.stringify(r.all) : '')
      }
      await a.stop()
      await sleep(500)
      await a.reset()
      await sleep(1000)
      const after = await boxes()
      for (const id of ['LED1', 'LED2']) {
        const r = after[id]
        check(!!r && !r.lit && r.maxScale <= 0.001, `${mode} B: ${id}'s glow is dark and back to a point after the reset`, r ? `scale ${r.maxScale}` : '')
        check(!!r && JSON.stringify(r.all) === JSON.stringify(r.bare), `${mode} B: ${id}'s box is the same with and without its glow (after the reset)`)
      }
      await a.ctx.close()
    }

    // ---------------------------------------- C. the UI overlays stay on top
    {
      const a = await open(browser, mode, true)
      const id = await a.mod(
        '/src/ui/lessons/actions.ts',
        `const { LESSONS } = await import('/src/lessons/index.ts').catch(() => ({}))
         let lesson = (LESSONS ?? []).find?.((l) => /b1|led-resistor/.test(l.id)) ?? m.firstLesson()
         m.requestLoad(lesson, 'solution')
         await new Promise((r) => setTimeout(r, 1500))
         m.startGuide(lesson, 1)
         return lesson.id`,
      )
      await sleep(1500)
      await a.run()
      await a.until(1.0)
      await sleep(4000)
      await a.mod(
        '/src/ui/lessons/actions.ts',
        `const { LESSONS } = await import('/src/lessons/index.ts').catch(() => ({}))
         const lesson = (LESSONS ?? []).find?.((l) => /b1|led-resistor/.test(l.id)) ?? m.firstLesson()
         m.goToStep(lesson, 1)`,
      )
      await sleep(2500)
      await a.stop()
      await sleep(1500)
      const c = await a.page.evaluate(() => window.__e2e.component('LED1'))
      const mA = (c?.current ?? 0) * 1000
      const h = await haloOf(a.page, 'LED1')
      const label = await a.page.evaluate(() => {
        const root = window.__vividFx.group.parent.parent
        let out = null
        root.traverse((o) => {
          if (out || o.name !== 'lesson-highlights') return
          o.traverse((s) => {
            if (out || !s.isSprite || !s.visible) return
            const w = s.getWorldPosition(s.position.clone())
            out = { x: w.x, y: w.y, z: w.z, sx: s.scale.x, sy: s.scale.y }
          })
        })
        return out
      })
      if (!check(!!h && h.visible && mA > 5, `${mode} C: lesson ${id}: LED1 lit and highlighted`, `${mA.toFixed(2)} mA`)) {
        await a.ctx.close()
        continue
      }
      const s = await project(a.page, h.w)
      const r = await project(a.page, { x: h.w.x + h.lensR, y: h.w.y, z: h.w.z })
      const domePx = Math.max(4, Math.hypot(r.x - s.x, r.y - s.y))
      const withGlow = await a.shot('C-highlight-glow')
      // the control: the same frame with the glow forced over the overlays (the reviewed defect)
      await a.page.evaluate(() =>
        window.__vividFx.group.parent.parent.traverse((o) => {
          if (o.name === 'led-halo' || o.name === 'led-flare') o.renderOrder += 10
        }),
      )
      await sleep(mode === 'enhanced' ? 1500 : 800)
      const glowOver = await a.shot('C-highlight-glow-over-control')
      await a.page.evaluate(() =>
        window.__vividFx.group.parent.parent.traverse((o) => {
          if (o.name === 'led-halo' || o.name === 'led-flare') o.renderOrder -= 10
        }),
      )
      await a.page.evaluate(() =>
        window.__vividFx.group.parent.parent.traverse((o) => {
          if (o.name === 'led-halo' || o.name === 'led-flare') {
            o.userData.occlHid = o.visible
            o.visible = false
          }
        }),
      )
      await sleep(mode === 'enhanced' ? 1500 : 800)
      const noGlow = await a.shot('C-highlight-noglow')
      await a.page.evaluate(() =>
        window.__vividFx.group.parent.parent.traverse((o) => {
          if (o.userData.occlHid !== undefined) {
            o.visible = o.userData.occlHid
            delete o.userData.occlHid
          }
        }),
      )
      const k = domePx * 2.2
      const crop = { x: s.x - k, y: s.y - k, w: 2 * k, h: 2 * k }
      const rim = await compare(a.page, withGlow, noGlow, crop)
      const over = await compare(a.page, glowOver, noGlow, crop)
      check(rim.rimN > 20, `${mode} C: the highlight rim is there (glow hidden)`, `${rim.rimN} cyan px`)
      // drawn over the glow the rim stays cyan against the red-tinted board around it; with the
      // glow over the overlays (the control) the rim drowns in red
      check(
        rim.rimBR >= 0.5 * rim.rimBRNoGlow && rim.contrast >= over.contrast + 30,
        `${mode} C: the highlight rim stays on top of the glow`,
        `rim B−R ${rim.rimBR.toFixed(0)} (no glow ${rim.rimBRNoGlow.toFixed(0)}, glow over it ${over.rimBR.toFixed(0)}); contrast vs the glow around it ${rim.contrast.toFixed(0)} (glow over it ${over.contrast.toFixed(0)})`,
      )
      if (check(!!label, `${mode} C: the live LED label is shown`)) {
        // the card: anchored at its bottom centre, facing the camera (its width runs along screen x)
        const anchor = await project(a.page, label)
        const edge = await project(a.page, { x: label.x + label.sx / 2, y: label.y, z: label.z })
        const wPx = 2 * Math.abs(edge.x - anchor.x)
        const hPx = (wPx * label.sy) / label.sx
        // its inner 70 % (the text and the card, not the rounded border)
        const lab = await compare(a.page, withGlow, noGlow, { x: anchor.x - 0.35 * wPx, y: anchor.y - 0.85 * hPx, w: 0.7 * wPx, h: 0.7 * hPx })
        check(lab.dE <= 6, `${mode} C: the live label is not painted over by the glow`, `ΔE ${lab.dE.toFixed(2)} over ${lab.n} px`)
      }
      await a.ctx.close()
    }
  }
} finally {
  await browser.close()
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
