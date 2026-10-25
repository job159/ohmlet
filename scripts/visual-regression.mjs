/**
 * Visual regression harness (cross-platform; Windows/Linux/macOS).
 *
 *   node scripts/visual-regression.mjs capture   # write tests/visual/baseline/*.png
 *   node scripts/visual-regression.mjs compare   # write tests/visual/current/*.png + diff report
 *
 * Drives a headless Chromium-family browser (VR_CHANNEL=msedge|chrome, or the
 * Playwright-bundled chromium when VR_CHANNEL is unset and it is installed)
 * against a running dev/preview server (VR_URL, default http://localhost:5173/).
 *
 * Determinism: every scene boots with onboarding dismissed, a fixed layout in
 * localStorage, the 'performance' render mode (no stochastic post FX) unless a
 * scene names another mode, and a fixed camera pose through the existing
 * `?shotrig` hook (App.tsx). Pixel comparison runs INSIDE the browser on a
 * canvas (no native image dependency): a pixel differs when any channel moves
 * more than CHANNEL_TOL; a scene fails when the differing fraction exceeds
 * MAX_DIFF_RATIO. Hover/hologram shaders are time-driven, so the harness never
 * hovers the canvas.
 *
 * Additive options (defaults leave the legacy run byte-identical):
 *   VR_EXTRA=<file.json>  append scenes (tests/visual/extra-scenes.json); a scene's
 *                         `layout` may be a JSON string OR an object; optional
 *                         `keys` (e.g. ["Space"] = run the simulation) are pressed
 *                         after boot, then `settle` ms (default 1500) elapse
 *   VR_ONLY=<regex>       only shoot scenes whose name matches
 *   VR_OUT=<dir>          write shots (+ diffs/report in compare mode) there instead
 *                         of tests/visual/{baseline,current}
 *   VR_TONE=settle|off    default for scenes without their own `tone` (below)
 *
 * Adaptive glass tone (src/ui/kit/glass/adapt.ts): the floating platters
 * (dock, status capsule, empty-state card) sample the scene behind them every
 * 380 ms and flip light/dark after two agreeing samples, with 340–460 ms CSS
 * transitions — so a shot taken soon after a camera move can catch them
 * mid-flip. A scene may set
 *   "tone": "settle"  after the last camera move / key press, wait until no
 *                     platter's tone class or --lg-lum changed for TONE_STABLE_MS
 *                     (longer than two samples plus the transitions), then shoot
 *                     (replaces the old `keys: ["Shift"]` + settle workaround);
 *   "tone": "off"     boot with the app's ?tone=off flag (no adaptation at all).
 * Without `tone` (and without VR_TONE) a scene is shot exactly as before, so
 * every existing baseline stays comparable.
 *
 * First run and selection (UX fix SH-10 — the classic chrome's own surfaces):
 *   "onboarding": true  boot WITHOUT the 'bb.onboarded' flag, so the first-run
 *                       tour is on screen (shot after its spring settles);
 *   "onboarding": 3     …and advance the tour to that card first (its own
 *                       「Next」 button, clicked / tapped n − 1 times);
 *   "select": "U1"      after boot, click (phone: tap) the component's body at
 *                       its projected screen point (the read-only `?e2e` hooks
 *                       give its world position) — the properties sheet / the
 *                       inspector opens; `settle` ms (default 1500) elapse.
 * The classic-chrome scenes added with them (desktop-onboarding,
 * phone-onboarding, phone-empty, phone-properties-mcu, and the tour's last
 * card desktop-onboarding-3 / phone-onboarding-3 with its 「Get started」)
 * have baselines captured from commit 6d01968, the pre-UX-wave truth of the
 * classic chrome.
 *
 * Live firmware: a scene may set
 *   "firmware": {"U1": "hal-oled-ssd1306"}
 *                     board id → bundled image firmware/dist/<name>.elf (or a file
 *                     name with its .elf / .hex / .bin extension). Before the app
 *                     boots, the bytes go to the lab's IndexedDB blob store
 *                     ('ohmlet' / 'firmware', keyed by SHA-256 — exactly what
 *                     src/state/firmware-store.ts writes) and the binding records
 *                     to localStorage 'bb.firmware', so the lab's boot restore
 *                     re-hashes, re-parses (the real loader) and binds them like a
 *                     returning user's firmware. Such a page also loads the
 *                     read-only `?e2e` hooks and the shot waits until every listed
 *                     board is bound (a scene whose firmware did not bind fails
 *                     instead of shooting a board without it). Combine with
 *                     `keys: ["Space"]` + `settle` to shoot live content (an OLED
 *                     drawing, a lit LED…). Live content advances with wall time,
 *                     so a baseline should show a state the firmware HOLDS (a
 *                     static screen, a steady LED), not a counter mid-flight.
 *                     Scenes without `firmware` boot exactly as before.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const URL = process.env.VR_URL ?? 'http://localhost:5173/'
// a fresh browser profile on a busy machine can need well over Playwright's
// default 30 s to reach the load event; the wait is only for the page to load
const GOTO_TIMEOUT_MS = 180_000
const CHANNEL = process.env.VR_CHANNEL ?? 'msedge'
const MODE = process.argv[2] ?? 'compare'
const BASE_DIR = path.join(ROOT, 'tests', 'visual', 'baseline')
const CUR_DIR = process.env.VR_OUT ? path.resolve(process.env.VR_OUT) : path.join(ROOT, 'tests', 'visual', 'current')
const ONLY = process.env.VR_ONLY ? new RegExp(process.env.VR_ONLY) : null
const CHANNEL_TOL = 24
const MAX_DIFF_RATIO = 0.01
/** default `tone` for scenes that do not set one ('' = legacy timing) */
const TONE_DEFAULT = process.env.VR_TONE === 'settle' || process.env.VR_TONE === 'off' ? process.env.VR_TONE : ''
/** a settled tone: no platter changed for this long (2 × 380 ms samples + 460 ms transition) */
const TONE_STABLE_MS = 1300
/** give up waiting (a scene that keeps animating behind a platter) */
const TONE_MAX_MS = 10000

/**
 * Wait until the adaptive glass tone is stable: every `.lg-tone-adaptive`
 * platter keeps its light/dark class and its --lg-lum value for
 * TONE_STABLE_MS. Returns the ms waited (for the log).
 */
async function settleTone(page) {
  const signature = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.lg-tone-adaptive')]
        .map((el) => `${el.classList.contains('is-tone-light') ? 'L' : 'D'}:${el.style.getPropertyValue('--lg-lum')}`)
        .join('|'),
    )
  const t0 = Date.now()
  let last = await signature()
  let since = Date.now()
  while (Date.now() - t0 < TONE_MAX_MS) {
    await page.waitForTimeout(100)
    const s = await signature()
    if (s !== last) {
      last = s
      since = Date.now()
    } else if (Date.now() - since >= TONE_STABLE_MS) break
  }
  return Date.now() - t0
}

/** The lab's firmware blob store (src/state/firmware-store.ts FIRMWARE_DB_*). */
export const FIRMWARE_DB = { name: 'ohmlet', version: 1, store: 'firmware' }
/** localStorage key of the lab's firmware binding records (src/state/lab.ts LS_FIRMWARE). */
export const LS_FIRMWARE = 'bb.firmware'
const FIRMWARE_EXT = { '.elf': 'elf', '.hex': 'hex', '.bin': 'bin' }

/**
 * What a scene's `firmware` map seeds: the binding records ('bb.firmware'
 * JSON, as the lab persists them) and one blob row per distinct image
 * (bytes as base64 for the page). Throws on an unknown image, so a typo
 * fails the scene instead of shooting a board without firmware.
 */
export function firmwareSeed(map, distDir = path.join(ROOT, 'firmware', 'dist')) {
  const records = {}
  const rows = []
  for (const [id, name] of Object.entries(map ?? {})) {
    const file = FIRMWARE_EXT[path.extname(name).toLowerCase()] ? name : `${name}.elf`
    const full = path.join(distDir, file)
    if (!existsSync(full)) throw new Error(`scene firmware ${id}: ${path.relative(ROOT, full)} not found`)
    const bytes = readFileSync(full)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    records[id] = {
      componentId: id,
      name: file,
      format: FIRMWARE_EXT[path.extname(file).toLowerCase()],
      sha256,
      size: bytes.length,
      loadedAt: 0,
      warnings: [],
    }
    if (!rows.some((r) => r.sha256 === sha256)) rows.push({ sha256, name: file, base64: bytes.toString('base64') })
  }
  return { records, rows }
}

/** Write blob rows into the page origin's IndexedDB (the schema firmware-store.ts opens). */
async function seedFirmwareDb(page, rows) {
  await page.evaluate(
    async ([rows, db]) => {
      const conn = await new Promise((ok, bad) => {
        const req = indexedDB.open(db.name, db.version)
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(db.store)) req.result.createObjectStore(db.store, { keyPath: 'sha256' })
        }
        req.onsuccess = () => ok(req.result)
        req.onerror = () => bad(req.error)
        req.onblocked = () => bad(new Error('IndexedDB open blocked'))
      })
      await new Promise((ok, bad) => {
        const tx = conn.transaction(db.store, 'readwrite')
        const store = tx.objectStore(db.store)
        for (const r of rows) {
          const bin = atob(r.base64)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          store.put({ sha256: r.sha256, name: r.name, bytes, storedAt: 0 })
        }
        tx.oncomplete = () => ok()
        tx.onerror = () => bad(tx.error)
        tx.onabort = () => bad(tx.error)
      })
      conn.close()
    },
    [rows, FIRMWARE_DB],
  )
}

const example = (f) => readFileSync(path.join(ROOT, 'examples', f), 'utf8')
/** the circuit of a project-file example (examples/embedded/*.ohmlet.json) */
const projectLayout = (f) => JSON.stringify(JSON.parse(example(f)).layout)
const EMPTY = JSON.stringify({ version: 1, name: 'empty', components: [], wires: [] })

/** Scenes: name, layout JSON, optional camera [px,py,pz,tx,ty,tz], viewport, render mode. */
const SCENES = [
  { name: 'desktop-empty', layout: EMPTY },
  { name: 'desktop-blinky-555', layout: example('blinky-555.json') },
  { name: 'desktop-counter', layout: example('counter.json') },
  { name: 'desktop-date-display', layout: example('date-display.json') },
  { name: 'desktop-night-light', layout: example('night-light.json') },
  {
    name: 'closeup-blinky-555',
    layout: example('blinky-555.json'),
    cam: [14, 16, 22, 22, 0, 6],
  },
  { name: 'phone-blinky-555', layout: example('blinky-555.json'), phone: true },
  // classic chrome surfaces the base scenes never showed (SH-10; baselines from 6d01968)
  { name: 'desktop-onboarding', layout: EMPTY, onboarding: true },
  { name: 'phone-onboarding', layout: EMPTY, phone: true, onboarding: true },
  { name: 'desktop-onboarding-3', layout: EMPTY, onboarding: 3 },
  { name: 'phone-onboarding-3', layout: EMPTY, phone: true, onboarding: 3 },
  { name: 'phone-empty', layout: EMPTY, phone: true },
  { name: 'phone-properties-mcu', layout: projectLayout('embedded/blink.ohmlet.json'), phone: true, select: 'U1', settle: 1800 },
  ...(process.env.VR_EXTRA ? JSON.parse(readFileSync(process.env.VR_EXTRA, 'utf8')) : []),
]
  .map((s) => (typeof s.layout === 'string' ? s : { ...s, layout: JSON.stringify(s.layout) }))
  .filter((s) => !ONLY || ONLY.test(s.name))

async function shoot(browser, scene, outDir) {
  const ctx = await browser.newContext(
    scene.phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  )
  const page = await ctx.newPage()
  const fw = scene.firmware ? firmwareSeed(scene.firmware) : null
  await page.addInitScript(
    ([l, m, ws, lg, fwKey, fwRecords, onboarding]) => {
      localStorage.clear()
      if (!onboarding) localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.layout', l)
      localStorage.setItem('bb.renderMode', m)
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      // Legacy scenes pin the classic (pre-embedded) chrome so they stay
      // comparable with the Phase-0 baseline; a scene opts into the embedded
      // desktop workspace with `workspace: true`.
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      // UI language: legacy / pre-i18n scenes pin English so they stay
      // comparable with their baselines; zh-TW scenes set `lang: 'zh-TW'`.
      localStorage.setItem('bb.lang', lg)
      // live-firmware scenes: the binding records the lab restores at boot
      if (fwRecords) localStorage.setItem(fwKey, fwRecords)
    },
    [
      scene.layout,
      scene.mode ?? 'performance',
      scene.workspace === true,
      scene.lang ?? 'en',
      LS_FIRMWARE,
      fw ? JSON.stringify(fw.records) : null,
      scene.onboarding === true || typeof scene.onboarding === 'number',
    ],
  )
  const tone = scene.tone ?? TONE_DEFAULT
  if (fw) {
    // the blob store must hold the bytes BEFORE the app boots: seed it from a
    // static document of the same origin (the app never runs there)
    await page.goto(new globalThis.URL('icon.svg', URL).href, { timeout: GOTO_TIMEOUT_MS })
    await seedFirmwareDb(page, fw.rows)
  }
  await page.goto(`${URL}?shotrig${tone === 'off' ? '&tone=off' : ''}${fw || scene.select ? '&e2e' : ''}`, { timeout: GOTO_TIMEOUT_MS })
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => typeof window.__shotRig?.setCamera === 'function')
  if (fw) {
    await page.waitForFunction(() => !!window.__e2e, null, { timeout: 30000 })
    await page.evaluate(() => window.__e2e.ready())
    const bound = await page.evaluate(() => window.__e2e.state().firmware)
    for (const [id, rec] of Object.entries(fw.records)) {
      if (bound[id]?.sha256 !== rec.sha256) throw new Error(`scene ${scene.name}: firmware ${rec.name} was not bound to ${id}`)
    }
  }
  await page.waitForTimeout(scene.mode === 'enhanced' ? 3500 : 2200)
  if (scene.cam) {
    await page.evaluate((cam) => window.__shotRig.setCamera(...cam), scene.cam)
    await page.waitForTimeout(600)
  }
  if (typeof scene.onboarding === 'number' && scene.onboarding > 1) {
    // the tour's own primary button (「Next」 / 「下一步」), as a user advances it
    const next = page.locator('.app-onboard-actions button').last()
    for (let i = 1; i < scene.onboarding; i++) {
      if (scene.phone) await next.tap()
      else await next.click()
      await page.waitForTimeout(700)
    }
    await page.waitForTimeout(600)
  }
  if (scene.select) {
    // a real click / tap on the part's body, as a user selects it
    await page.waitForFunction(() => !!window.__e2e, null, { timeout: 30000 })
    const w = await page.evaluate((id) => window.__e2e.componentWorld(id, 1.0), scene.select)
    if (!w) throw new Error(`scene ${scene.name}: no component ${scene.select}`)
    const p = await page.evaluate((v) => window.__shotRig.project(v.x, v.y, v.z), w)
    if (!p) throw new Error(`scene ${scene.name}: ${scene.select} is off screen`)
    if (scene.phone) await page.touchscreen.tap(p.x, p.y)
    else await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(scene.settle ?? 1500)
  }
  if (Array.isArray(scene.keys) && scene.keys.length) {
    for (const k of scene.keys) await page.keyboard.press(k)
    await page.waitForTimeout(scene.settle ?? 1500)
    // the app may re-frame on run state changes: re-park the scene camera
    if (scene.cam) {
      await page.evaluate((cam) => window.__shotRig.setCamera(...cam), scene.cam)
      await page.waitForTimeout(600)
    }
  }
  if (tone === 'settle') await settleTone(page)
  const file = path.join(outDir, `${scene.name}.png`)
  await page.screenshot({ path: file })
  await ctx.close()
  return file
}

/** Compare two PNGs inside a browser page via canvas pixel reads. */
async function diff(browser, aFile, bFile, diffFile) {
  const page = await browser.newPage()
  const a = readFileSync(aFile).toString('base64')
  const b = readFileSync(bFile).toString('base64')
  const res = await page.evaluate(
    async ([a, b, tol]) => {
      const load = (s) =>
        new Promise((ok, bad) => {
          const im = new Image()
          im.onload = () => ok(im)
          im.onerror = bad
          im.src = `data:image/png;base64,${s}`
        })
      const [ia, ib] = await Promise.all([load(a), load(b)])
      if (ia.width !== ib.width || ia.height !== ib.height)
        return { sizeMismatch: true, ratio: 1, png: null }
      const w = ia.width
      const h = ia.height
      const px = (im) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const g = c.getContext('2d')
        g.drawImage(im, 0, 0)
        return g.getImageData(0, 0, w, h)
      }
      const da = px(ia)
      const db = px(ib)
      const out = new ImageData(w, h)
      let bad = 0
      for (let i = 0; i < da.data.length; i += 4) {
        const d = Math.max(
          Math.abs(da.data[i] - db.data[i]),
          Math.abs(da.data[i + 1] - db.data[i + 1]),
          Math.abs(da.data[i + 2] - db.data[i + 2]),
        )
        if (d > tol) {
          bad++
          out.data[i] = 255
          out.data[i + 3] = 255
        } else {
          const l = (da.data[i] + da.data[i + 1] + da.data[i + 2]) / 12
          out.data[i] = out.data[i + 1] = out.data[i + 2] = l
          out.data[i + 3] = 255
        }
      }
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d').putImageData(out, 0, 0)
      return { sizeMismatch: false, ratio: bad / (w * h), png: c.toDataURL('image/png').split(',')[1] }
    },
    [a, b, CHANNEL_TOL],
  )
  await page.close()
  if (res.png) writeFileSync(diffFile, Buffer.from(res.png, 'base64'))
  return res
}

async function main() {
  const outDir = MODE === 'capture' ? (process.env.VR_OUT ? CUR_DIR : BASE_DIR) : CUR_DIR
  mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch(CHANNEL === 'bundled' ? {} : { channel: CHANNEL })
  const report = []
  try {
    for (const scene of SCENES) {
      const file = await shoot(browser, scene, outDir)
      console.log(`shot ${path.relative(ROOT, file)}`)
      if (MODE === 'compare') {
        const base = path.join(BASE_DIR, `${scene.name}.png`)
        if (!existsSync(base)) {
          report.push({ scene: scene.name, status: 'no-baseline' })
          continue
        }
        const r = await diff(browser, base, file, path.join(CUR_DIR, `${scene.name}.diff.png`))
        const pass = !r.sizeMismatch && r.ratio <= MAX_DIFF_RATIO
        report.push({ scene: scene.name, status: pass ? 'pass' : 'FAIL', diffRatio: +r.ratio.toFixed(5) })
      }
    }
  } finally {
    await browser.close()
  }
  if (MODE === 'compare') {
    writeFileSync(path.join(CUR_DIR, 'report.json'), JSON.stringify(report, null, 2))
    console.table(report)
    if (report.some((r) => r.status === 'FAIL')) process.exitCode = 1
  }
}

// run as a script (tests import the firmware-seed helpers without shooting)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
