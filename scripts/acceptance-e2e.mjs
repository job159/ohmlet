/**
 * First-release acceptance — the user's twelve-step walkthrough, end to end,
 * through the REAL user interface in a real browser.
 *
 *   node scripts/acceptance-e2e.mjs              # one run, writes the report
 *   node scripts/acceptance-e2e.mjs --runs 3     # stability: three fresh runs
 *
 * Environment:
 *   E2E_URL      app URL (default VR_URL, else http://localhost:5173/). Use a
 *                server WITHOUT hot reload while other people edit the tree.
 *   E2E_CHANNEL  msedge (default) | chrome | bundled
 *   E2E_OUT      report directory (default docs/acceptance)
 *   E2E_RUNS     same as --runs
 *   E2E_STOP     stop after this step number (debugging)
 *   E2E_HEADED   1 = show the browser
 *   E2E_SERVER_NOTE  zh-TW note on the server for the report (e.g.
 *                "目前工作目錄的 Vite 開發伺服器，關閉熱重載")
 *
 * Every run starts from a fresh browser profile with the interface in
 * Traditional Chinese (bb.lang = zh-TW), the desktop workspace on (1440×900,
 * mouse) and a circuit from a "previous session" on the board. The steps then
 * use only what a user uses: the library cards, clicks on breadboard holes and
 * terminal posts (aimed through the `?shotrig` camera rig, exactly where the
 * 3D scene draws them), the wire tool (the circuit picks each colour), the
 * inspector's file picker / Run / Reset / HOLD controls, the status capsule,
 * the instrument tray and the More panel (Save project → a real download,
 * Open project… → a real file chooser).
 *
 * Every step asserts the REAL state behind the pixels through the read-only
 * `?e2e` hooks (src/dev/e2e-hooks.ts): the app and lab stores, the firmware
 * binding and its SHA-256, MCU state / PC / cycle counter from the simulation
 * frames, per-frame LED brightness from the solver's telemetry, the UART
 * transcript, logic-analyzer edges from the coordinator's recorder. A step
 * passes only when its assertions hold; the screenshot is evidence, never the
 * criterion. After the runs the script writes docs/acceptance/README.md (the
 * zh-TW report, generated from the measured results) plus the screenshots of
 * the last run and results.json with every run's raw evidence. Exit code 1
 * when any step of any run failed.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const URL = process.env.E2E_URL ?? process.env.VR_URL ?? 'http://localhost:5173/'
const CHANNEL = process.env.E2E_CHANNEL ?? process.env.VR_CHANNEL ?? 'msedge'
const OUT = path.resolve(process.env.E2E_OUT ?? path.join(ROOT, 'docs', 'acceptance'))
const SHOTS = path.join(OUT, 'shots')
const argRuns = process.argv.indexOf('--runs')
const RUNS = Math.max(1, Number(argRuns >= 0 ? process.argv[argRuns + 1] : process.env.E2E_RUNS ?? 1) || 1)
const STOP_AFTER = process.env.E2E_STOP ? Number(process.env.E2E_STOP) : Infinity
const FIRMWARE = path.join(ROOT, 'firmware', 'dist', 'lab-acceptance.elf')
const FIRMWARE_SHA = createHash('sha256').update(readFileSync(FIRMWARE)).digest('hex')
/** the "previous session" a new project starts from */
const SEED_LAYOUT = readFileSync(path.join(ROOT, 'examples', 'blinky-555.json'), 'utf8')
const VIEWPORT = { width: 1440, height: 900 }

// ---------------------------------------------------------------------------
// The circuit (Blue Pill at h10: PB12 = h10 … 3V3 = h29 on the near header,
// GND1 = c10 … VBAT = c29 on the far one; the board covers rows b–i, so every
// header pin keeps one free hole in row a / row j of its strip)
// ---------------------------------------------------------------------------

const PLAN = {
  mcu: { type: 'stm32_bluepill', at: 'h10' },
  resistor: { type: 'resistor', holes: ['b33', 'b37'], ohms: 330 },
  led: { type: 'led', holes: ['e37', 'f37'] }, // anode, cathode (across the channel)
  button: { type: 'pushbutton', at: 'f45' }, // A1 f45 / A2 e45 · B1 f47 / B2 e47
  psu: { type: 'power_supply' },
}

/**
 * [from, to, the role of its net, meaning]. Nothing is picked: the product
 * chrome colours a wire by its net's role (src/ui/wire-roles.ts) — supply
 * red, ground black, a plain signal purple / teal / pink / brown / gray.
 */
const WIRES = [
  ['PS:+', 'bot+0', 'supply', '電源 + → 下方紅色電源軌'],
  ['PS:-', 'bot-0', 'ground', '電源 − → 下方藍色接地軌'],
  ['j27', 'bot+21', 'supply', 'Blue Pill 5V（h27）→ +5 V 電源軌'],
  ['j28', 'bot-22', 'ground', 'Blue Pill GND（h28）→ 接地軌'],
  ['a20', 'a33', 'signal', 'PA5（c20）→ 電阻 R1'],
  ['j37', 'bot-29', 'ground', 'LED 陰極 → 接地軌'],
  ['j10', 'j45', 'signal', 'PB12（h10）→ 按鈕 A 側'],
  ['j47', 'bot-37', 'ground', '按鈕 B 側 → 接地軌'],
]
/** the colours each role may get (wire-roles.ts ROLE_COLOR / SIGNAL_PALETTE) */
const ROLE_COLORS = { supply: ['red'], ground: ['black'], signal: ['purple', 'teal', 'pink', 'brown', 'gray'] }
const ROLE_ZH = { supply: '電源正（紅色）', ground: '地（黑色）', signal: '訊號（紫、青綠等訊號色）' }
/** zh-TW colour names for the report */
const COLOR_ZH = { red: '紅色', black: '黑色', purple: '紫色', teal: '青綠色', pink: '粉紅色', brown: '棕色', gray: '灰色' }
/** the colour the circuit gave each wire (step 4), for the report: `${from}>${to}` → colour */
const wireColorSeen = new Map()

/**
 * Overview camera for report screenshots: [px, py, pz, tx, ty, tz] (plan
 * units). Frames the whole circuit (bench supply … push-button, x −10 … 48)
 * in the free canvas between the library, inspector and tray panels at
 * 1440 × 900; only the empty right end of the board slips under the inspector.
 */
const CAM_OVERVIEW = [21, 80, 66, 21, 0, 4.6]

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

class StepError extends Error {}

function expect(cond, message) {
  if (!cond) throw new StepError(message)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fmt = (n, d = 3) => (Number.isFinite(n) ? Number(n.toFixed(d)).toString() : String(n))
const hex = (n) => `0x${(n >>> 0).toString(16).padStart(8, '0').toUpperCase()}`
const median = (xs) => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

async function hooks(page, fn, arg) {
  return page.evaluate(fn, arg)
}

async function state(page) {
  return page.evaluate(() => window.__e2e.state())
}

/**
 * Poll `fn(page)` until it returns a truthy value (or throw `what` after
 * `timeout` ms of WALL time). Only for what the page itself does — UI state
 * after a click, a store update, a file read — never for something the
 * simulation has to compute: that is `untilSim` / `waitSim`.
 */
async function until(page, fn, what, timeout = 10000, every = 100) {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < timeout) {
    last = await fn(page)
    if (last) return last
    await sleep(every)
  }
  throw new StepError(`逾時（${timeout} ms）：${what}`)
}

/** Newest simulation time seen in a frame. */
async function simNow(page) {
  return page.evaluate(() => window.__e2e.lastFrame()?.time ?? 0)
}

/**
 * Simulation waits are budgeted in SIMULATION time, not wall time.
 *
 * Why (release triage 2026-10-19, docs/acceptance「執行環境與速度」): the
 * simulation runs as fast as the machine allows (the worker's realtime factor
 * — 0.4× on an idle machine, measured down to 0.001× while other sessions
 * kept 100+ threads in the processor queue and the simulation worker thread
 * sat "ready" at ~2 % CPU; a fresh browser was exactly as slow, and the same
 * circuit in plain node crawled just the same, so nothing leaked from one
 * run into the next). A wall-clock timeout therefore failed a
 * correct product on a busy machine (「逾時（20000 ms）：模擬時間前進 2.6 s」)
 * while proving nothing about the behaviour. A condition must now hold within
 * `simBudget` seconds of SIMULATED time — the firmware's own deadline, as
 * strict as or stricter than before — and a wait fails at once when the
 * simulation genuinely stalls: its clock does not move for STALL_MS of wall
 * time while the wait needs it to (after a start-up allowance for a page
 * whose simulation worker is still loading).
 */
const STALL_MS = 30000
/** wall time a freshly started simulation may take to produce its first moving frame (worker start-up on a cold page) */
const START_MS = 180000
/** absolute wall cap of one simulation wait (a crawling but moving simulation) */
const SIM_WAIT_CAP_MS = 20 * 60 * 1000

/**
 * Poll `fn(page)` until it returns a truthy value; fail when the simulation
 * clock advanced more than `simBudget` s while the condition did not hold,
 * when the clock stood still for `stallMs` (`startMs` before the first
 * movement), or after SIM_WAIT_CAP_MS. A power cycle (time back to 0) rebases
 * the budget.
 */
async function untilSim(page, fn, what, simBudget, { every = 50, stallMs = STALL_MS, startMs = stallMs } = {}) {
  let t0 = await simNow(page)
  const w0 = Date.now()
  let lastT = t0
  let lastMove = w0
  let moved = false
  for (;;) {
    const t = await simNow(page) // read BEFORE the condition: it held no earlier than t
    const v = await fn(page)
    if (v) return v
    const now = Date.now()
    if (t < t0) t0 = t // reset to t = 0 while waiting
    if (t !== lastT) {
      lastT = t
      lastMove = now
      moved = true
    }
    if (t - t0 > simBudget) throw new StepError(`模擬時間 ${fmt(simBudget)} s 內沒有${what}（模擬時間 ${fmt(t0)} → ${fmt(t)} s）`)
    const still = now - lastMove
    if (still > (moved ? stallMs : startMs)) {
      const running = await page.evaluate(() => window.__e2e.lastFrame()?.running ?? null)
      throw new StepError(`模擬停滯：${fmt(still / 1000, 0)} s 內模擬時間停在 ${fmt(t)} s（${running ? '仍標示執行中' : '沒有在執行'}），等待：${what}`)
    }
    if (now - w0 > SIM_WAIT_CAP_MS) {
      // still moving, only far too slowly: this machine is too busy to finish the walkthrough (not a stall)
      const rt = (t - t0) / ((now - w0) / 1000)
      throw new StepError(`模擬太慢：${SIM_WAIT_CAP_MS / 60000} 分鐘內模擬時間只前進 ${fmt(t - t0)} s（即時比 ${fmt(rt * 100, 2)} %；模擬仍在前進，是這台電腦太忙，請在較空閒時重跑），等待：${what}`)
    }
    await sleep(every)
  }
}

/** Wait until the simulation clock has advanced `seconds` past `from` (no wall-clock deadline: see untilSim). */
async function waitSim(page, from, seconds, opts) {
  return untilSim(page, async (p) => ((await simNow(p)) >= from + seconds ? true : null), `前進到 ${fmt(from + seconds)} s`, Infinity, opts)
}

/** wall time a page may take to load and start its modules (cold dev server, busy machine) */
const BOOT_MS = 180000

/**
 * Single-thread speed of this machine right now: a fixed integer loop in a
 * fresh Worker of the page for ~1 s (million loop iterations per second). The
 * report prints it beside each run's realtime factor, so a slow run can be
 * told apart from a slow machine.
 */
async function calibrate(page) {
  const src = `onmessage = () => { const t0 = performance.now(); let n = 0, x = 0; while (performance.now() - t0 < 1000) { for (let i = 0; i < 100000; i++) x = (x * 1103515245 + 12345) | 0; n++ } postMessage(n * 0.1 / ((performance.now() - t0) / 1000) + (x & 0) ) }`
  return page.evaluate(
    (s) =>
      new Promise((resolve) => {
        const w = new Worker(URL.createObjectURL(new Blob([s], { type: 'text/javascript' })))
        w.onmessage = (e) => {
          w.terminate()
          resolve(Math.round(e.data))
        }
        w.postMessage(0)
      }),
    src,
  )
}

/** Realtime factors (sim s ÷ wall s, the coordinator's 1 s window) of the running frames recorded since `sinceWall`. */
async function realtimeSince(page, sinceWall) {
  return page.evaluate((w) => window.__e2e.frames(w).filter((f) => f.running && f.current && f.rt > 0).map((f) => f.rt), sinceWall)
}

// ---------------------------------------------------------------------------
// 3D aiming: park the shotrig camera over the target, then a real mouse click
// on the projected point (after checking nothing covers the canvas there)
// ---------------------------------------------------------------------------

async function setCamera(page, cam) {
  await page.evaluate((c) => window.__shotRig.setCamera(...c), cam)
  await sleep(260)
}

/** aim the camera at a world point and hover it; returns its screen position */
async function aimWorld(page, w, { dist = 9 } = {}) {
  // nearly overhead and a little in front: the ray reaches a free hole beside
  // a raised board without crossing its body
  await setCamera(page, [w.x + 0.12 * dist, w.y + 1.25 * dist, w.z + 0.22 * dist, w.x, w.y, w.z])
  const p = await page.evaluate((v) => window.__shotRig.project(v.x, v.y, v.z), w)
  expect(p, `目標點 (${w.x}, ${w.y}, ${w.z}) 不在畫面內`)
  const covered = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName ?? null, [p.x, p.y])
  expect(covered === 'CANVAS', `目標點被介面元素遮住（${covered}）`)
  await page.mouse.move(p.x - 3, p.y - 3)
  await page.mouse.move(p.x, p.y, { steps: 3 })
  await sleep(90)
  return p
}

async function clickWorld(page, w, opts) {
  const p = await aimWorld(page, w, opts)
  await page.mouse.click(p.x, p.y)
  await sleep(220)
}

async function clickEndpoint(page, ref) {
  const w = await page.evaluate((r) => window.__e2e.endpointWorld(r), ref)
  expect(w, `找不到端點 ${ref} 的位置`)
  await clickWorld(page, w)
}

async function clickComponent(page, id, y = 1.0) {
  const w = await page.evaluate(([i, h]) => window.__e2e.componentWorld(i, h), [id, y])
  expect(w, `找不到元件 ${id} 的位置`)
  await clickWorld(page, w, { dist: 12 })
}

/** aim at a component in 3D and hover it; returns its screen position */
async function aimComponent(page, id, y = 1.0) {
  const w = await page.evaluate(([i, h]) => window.__e2e.componentWorld(i, h), [id, y])
  expect(w, `找不到元件 ${id} 的位置`)
  return aimWorld(page, w, { dist: 12 })
}

// ---------------------------------------------------------------------------
// UI helpers (zh-TW accessible names — they double as a translation check)
// ---------------------------------------------------------------------------

async function openMore(page) {
  const panel = page.locator('.asm-sheet')
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole('tab', { name: '更多' }).click()
    await panel.waitFor({ state: 'visible' })
    await sleep(450)
  }
  return panel
}

async function closeMore(page) {
  const panel = page.locator('.asm-sheet')
  if (await panel.isVisible().catch(() => false)) {
    await page.getByRole('tab', { name: '更多' }).click()
    await panel.waitFor({ state: 'hidden' }).catch(() => {})
    await sleep(350)
  }
}

async function armPart(page, type) {
  const label = await page.evaluate((t) => window.__e2e.label(t), type)
  expect(label, `元件庫沒有 ${type}`)
  const search = page.locator('.ws-search input')
  await search.fill('')
  await search.fill(label)
  await sleep(150)
  const card = page.locator('.ws-part-main').filter({ has: page.locator('.ws-part-label', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
  expect((await card.count()) >= 1, `元件庫找不到「${label}」卡片`)
  await card.first().click()
  await sleep(200)
  return label
}

async function captureState(page) {
  const s = await state(page)
  return { components: s.layout.components, wires: s.layout.wires }
}

function componentByType(s, type) {
  return s.layout.components.find((c) => c.type === type)
}

/** LED half-periods (sim s) from recorded frames: threshold at half the peak brightness. */
function halfPeriods(frames, id) {
  const xs = frames.filter((f) => f.running && f.current && typeof f.leds[id] === 'number')
  const peak = Math.max(0, ...xs.map((f) => f.leds[id]))
  if (peak < 0.05) return { peak, edges: [], halves: [] }
  const thr = peak / 2
  const edges = []
  let prev = null
  for (const f of xs) {
    const on = f.leds[id] > thr
    if (prev !== null && on !== prev) edges.push({ t: f.time, on })
    prev = on
  }
  const halves = []
  for (let i = 1; i < edges.length; i++) halves.push(edges[i].t - edges[i - 1].t)
  return { peak, edges, halves }
}

// ---------------------------------------------------------------------------
// one run
// ---------------------------------------------------------------------------

async function runOnce(browser, runIndex, shotDir) {
  mkdirSync(shotDir, { recursive: true })
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, acceptDownloads: true, locale: 'zh-TW' })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)))
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`console: ${m.text().slice(0, 400)}`)
  })
  await page.addInitScript((seed) => {
    const prefs = {
      'bb.onboarded': '1',
      'bb.renderMode': 'performance',
      'bb.workspace': JSON.stringify({ v: 1, enabled: true }),
      'bb.lang': 'zh-TW',
      'bb.hintShrink': '1',
    }
    const fresh = !sessionStorage.getItem('e2e.seeded')
    const wipe = sessionStorage.getItem('e2e.wipe') === '1'
    if (fresh || wipe) {
      localStorage.clear()
      for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v)
      if (fresh) localStorage.setItem('bb.layout', seed)
      sessionStorage.setItem('e2e.seeded', '1')
      sessionStorage.removeItem('e2e.wipe')
    }
  }, SEED_LAYOUT)

  /** run environment for the report: how fast this machine was while the run ran */
  const env = { bootMs: [], cal: [], startMs: null, realtime: null }
  /** single-thread calibration at a named moment of the run (開始 / 模擬中 / 結束) */
  const calAt = async (at) => env.cal.push({ at, mops: await calibrate(page).catch(() => null) })
  /** every running frame's realtime factor of this run (summarised into env.realtime at the end) */
  const rtAll = []
  const boot = async () => {
    const t0 = Date.now()
    // a cold dev-server page on a busy machine can take far longer than 30 s
    // to load and run its modules; how long it took goes into the report
    await page.goto(`${URL}?e2e&shotrig`, { timeout: BOOT_MS })
    await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig, null, { timeout: BOOT_MS })
    await page.evaluate(() => window.__e2e.ready())
    env.bootMs.push(Date.now() - t0)
    await sleep(1500)
  }

  const run = { index: runIndex, steps: [], pageErrors, env, startedAt: new Date().toISOString() }
  let blocked = false
  // JPEG (quality 88): the report's evidence stays legible at ~1/5 of the PNG size
  const shot = async (rec, name, caption, opts = {}) => {
    const file = path.join(shotDir, `${name}.jpg`)
    if (opts.cam) await setCamera(page, opts.cam)
    if (opts.settle) await sleep(opts.settle)
    await page.screenshot({ path: file, type: 'jpeg', quality: 88, ...(opts.clip ? { clip: opts.clip } : {}) })
    rec.shots.push({ file: `${name}.jpg`, caption })
    return file
  }
  const step = async (id, title, fn) => {
    const rec = { id, title, status: 'blocked', evidence: [], shots: [], error: null, ms: 0 }
    run.steps.push(rec)
    if (blocked || id > STOP_AFTER) return rec
    const t0 = Date.now()
    const w0 = await page.evaluate(() => window.__e2e.now()).catch(() => null)
    try {
      await fn(rec)
      rec.status = 'pass'
    } catch (err) {
      rec.status = 'fail'
      rec.error = err instanceof StepError ? err.message : String(err?.stack ?? err).slice(0, 1500)
      blocked = true
      try {
        await shot(rec, `${String(id).padStart(2, '0')}-failure`, '失敗當下的畫面')
      } catch {
        /* the page may be gone */
      }
    }
    rec.ms = Date.now() - t0
    // the simulation's speed while this step ran (the page may be gone after a failure)
    if (w0 !== null) {
      // a reload inside the step (step 12) restarts the page clock
      const nowW = await page.evaluate(() => window.__e2e.now()).catch(() => Infinity)
      const rts = await realtimeSince(page, w0 > nowW ? Number.NEGATIVE_INFINITY : w0).catch(() => [])
      if (rts.length > 0) {
        rec.realtime = { median: median(rts), min: Math.min(...rts), max: Math.max(...rts) }
        for (const x of rts) rtAll.push(x)
      }
    }
    const rt = rec.realtime ? ` · 即時比 ${fmt(rec.realtime.median * 100, 0)} %` : ''
    console.log(`run ${runIndex} · step ${id} ${rec.status}${rt}${rec.error ? ` — ${rec.error.split('\n')[0]}` : ''}`)
    return rec
  }
  const say = (rec, line) => rec.evidence.push(line)

  /** shared between steps */
  const ids = {}
  /** wall time of the Run click (step 6): step 7 reports how long the first running frame took */
  let runClickedAt = null
  let savedProject = null
  let layoutBeforeSave = null

  await boot()
  await calAt('開始')

  // ---------------------------------------------------------------- 1
  await step(1, '建立新專案', async (rec) => {
    const s0 = await state(page)
    expect(s0.lang === 'zh-TW', `介面語言應為 zh-TW，實際為 ${s0.lang}`)
    expect(s0.workspace.enabled === true, '桌面工作區未啟用')
    expect(s0.layout.components.length > 0, '啟動時應載入前一次工作階段的電路')
    say(rec, `啟動時麵包板上有前一次工作階段留下的電路：${s0.layout.components.length} 個元件、${s0.layout.wires.length} 條導線（examples/blinky-555.json）。`)
    const more = await openMore(page)
    // the product chrome clears at once and offers 〔復原〕 (2026-11-02: no double check); it
    // still asks first when loaded firmware would be lost — answer that sheet if it appears
    await more.getByText('清空麵包板', { exact: true }).click()
    const confirm = page.locator('.lg-asheet-btn.is-destructive', { hasText: '清空麵包板' })
    const undo = page.locator('.lg-toast').getByRole('button', { name: '復原' })
    await Promise.race([confirm.waitFor({ state: 'visible' }), undo.waitFor({ state: 'visible' })])
    if (await confirm.isVisible()) {
      await sleep(300)
      await confirm.click()
    }
    await until(page, async (p) => ((await state(p)).layout.components.length === 0 ? true : null), '麵包板清空')
    const undoOffered = await undo.isVisible()
    expect(undoOffered, '清空後應提示〔復原〕')
    await closeMore(page)
    const s1 = await state(page)
    expect(s1.layout.components.length === 0 && s1.layout.wires.length === 0, '清空後仍有元件或導線')
    expect(Object.keys(s1.firmware).length === 0, '清空後仍有韌體綁定')
    expect(s1.running === false && s1.simTime === 0, '清空後模擬應停止且時間歸零')
    say(rec, '透過「更多 → 清空麵包板」建立新專案（不再二次確認，提示附〔復原〕）：元件 0、導線 0、韌體綁定 0，模擬停止、時間 0 s。')
    await shot(rec, '01-new-project', '新專案：空白麵包板（桌面工作區，繁體中文介面）')
  })

  // ---------------------------------------------------------------- 2
  await step(2, '放入 STM32F103C8T6 Blue Pill', async (rec) => {
    const label = await armPart(page, PLAN.mcu.type)
    let s = await state(page)
    expect(s.mode.kind === 'place' && s.mode.type === PLAN.mcu.type, '點選元件庫卡片後應進入放置模式')
    say(rec, `在元件庫搜尋並點選「${label}」卡片 → 進入放置模式（${s.mode.type}）。`)
    await clickEndpoint(page, PLAN.mcu.at)
    s = await until(page, async (p) => {
      const st = await state(p)
      return componentByType(st, PLAN.mcu.type) ? st : null
    }, 'Blue Pill 出現在電路中')
    const u = componentByType(s, PLAN.mcu.type)
    ids.mcu = u.id
    expect(u.at === PLAN.mcu.at, `Blue Pill 應放在 ${PLAN.mcu.at}，實際為 ${u.at}`)
    expect(s.mode.kind === 'select' && s.selection.includes(u.id), '放置後應回到選取模式並選取新元件')
    say(rec, `點擊麵包板孔位 ${PLAN.mcu.at}（3D 場景中的實際孔位）→ 新元件 ${u.id}（${u.type}），第 1 腳 PB12 位於 ${u.at}；放置後自動選取，屬性面板顯示該開發板。`)
    await page.locator('.ws-search input').fill('')
    await shot(rec, '02-bluepill', 'Blue Pill 放在麵包板上（右側屬性面板顯示韌體與執行區塊）', { cam: CAM_OVERVIEW, settle: 300 })
  })

  // ---------------------------------------------------------------- 3
  await step(3, '放入麵包板元件：電阻、LED、按鈕與電源', async (rec) => {
    // resistor (leads: two hole clicks; the tool stays armed for repeats)
    const rl = await armPart(page, PLAN.resistor.type)
    for (const h of PLAN.resistor.holes) await clickEndpoint(page, h)
    await page.keyboard.press('Escape')
    // LED
    const ll = await armPart(page, PLAN.led.type)
    for (const h of PLAN.led.holes) await clickEndpoint(page, h)
    await page.keyboard.press('Escape')
    // pushbutton (footprint: one click on pin A1)
    const bl = await armPart(page, PLAN.button.type)
    await clickEndpoint(page, PLAN.button.at)
    // bench power supply (off-board: placed at once)
    const pl = await armPart(page, PLAN.psu.type)
    await page.locator('.ws-search input').fill('')
    const s = await until(page, async (p) => {
      const st = await state(p)
      return ['resistor', 'led', 'pushbutton', 'power_supply'].every((t) => componentByType(st, t)) ? st : null
    }, '四個元件都出現在電路中')
    const r = componentByType(s, 'resistor')
    const d = componentByType(s, 'led')
    const b = componentByType(s, 'pushbutton')
    const ps = componentByType(s, 'power_supply')
    Object.assign(ids, { r: r.id, led: d.id, btn: b.id, psu: ps.id })
    expect(JSON.stringify(r.holes) === JSON.stringify(PLAN.resistor.holes), `電阻腳位應為 ${PLAN.resistor.holes}，實際 ${r.holes}`)
    expect(JSON.stringify(d.holes) === JSON.stringify(PLAN.led.holes), `LED 腳位應為 ${PLAN.led.holes}，實際 ${d.holes}`)
    expect(b.at === PLAN.button.at, `按鈕應放在 ${PLAN.button.at}，實際 ${b.at}`)
    say(rec, `「${rl}」${r.id}：${r.holes.join(' – ')}；「${ll}」${d.id}：陽極 ${d.holes[0]}、陰極 ${d.holes[1]}（跨越中央溝槽）；「${bl}」${b.id}：A1 位於 ${b.at}；「${pl}」${ps.id}：工作台電源（板外，預設 5 V）。`)
    // R1 = 330 Ω through the inspector's E12 quick pick
    await clickComponent(page, r.id, 0.6)
    await until(page, async (p) => ((await state(p)).selection[0] === r.id ? true : null), `點擊 3D 中的 ${r.id} 後應選取它`)
    await page.locator('.prs-chip', { hasText: /^330\s?Ω$/ }).first().click()
    const s2 = await until(page, async (p) => {
      const st = await state(p)
      const rr = st.layout.components.find((c) => c.id === r.id)
      return rr?.params?.resistance === PLAN.resistor.ohms ? st : null
    }, `${r.id} 阻值設為 330 Ω`)
    expect(s2.layout.components.length === 5, `電路應有 5 個元件，實際 ${s2.layout.components.length}`)
    say(rec, `在 3D 場景點選 ${r.id}，於屬性面板的 E12 快速選值點「330 Ω」→ resistance = ${PLAN.resistor.ohms} Ω。`)
    await shot(rec, '03-parts', '五個元件就位：Blue Pill、電阻 330 Ω、LED、按鈕與工作台電源', { cam: CAM_OVERVIEW, settle: 300 })
  })

  // ---------------------------------------------------------------- 4
  await step(4, '透過視覺化介面接線', async (rec) => {
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: '導線' }).click()
    await sleep(250)
    let s = await state(page)
    expect(s.mode.kind === 'wire', '點「導線」後應進入接線模式')
    const resolve = (ref) => ref.replace(/^PS:/, `${ids.psu}:`)
    // no colour to pick: the wire strip is a legend
    const strip = page.locator('.app-wire-strip')
    expect((await strip.locator('.app-swatch').count()) === 0, '接線模式不應有色票可選（顏色由電路決定）')
    const legend = (await strip.innerText()).replace(/\s+/g, ' ')
    expect(/紅＝電源正/.test(legend) && /黑＝地/.test(legend), `接線列應顯示圖例「紅＝電源正　黑＝地　其他顏色＝訊號」，實際「${legend}」`)
    for (const [a, b, role] of WIRES) {
      const from = resolve(a)
      const to = resolve(b)
      await clickEndpoint(page, from)
      s = await state(page)
      expect(s.mode.kind === 'wire' && s.mode.from === from, `接線起點應為 ${from}（實際 ${s.mode.from}）`)
      const before = s.layout.wires.length
      await clickEndpoint(page, to)
      s = await until(page, async (p) => {
        const st = await state(p)
        return st.layout.wires.length > before ? st : null
      }, `導線 ${from} → ${to} 建立`)
      const w = s.layout.wires[s.layout.wires.length - 1]
      const ok = (w.from === from && w.to === to) || (w.from === to && w.to === from)
      expect(ok, `新導線應連接 ${from} ↔ ${to}，實際 ${w.from} ↔ ${w.to}`)
      expect(ROLE_COLORS[role].includes(w.color), `導線 ${from} → ${to} 應自動上色為${ROLE_ZH[role]}，實際 ${w.color}`)
      wireColorSeen.set(`${a}>${b}`, w.color)
    }
    await page.keyboard.press('Escape')
    await sleep(200)
    s = await state(page)
    expect(s.layout.wires.length === WIRES.length, `應有 ${WIRES.length} 條導線，實際 ${s.layout.wires.length}`)
    expect(s.mode.kind === 'select', '按 Esc 後應離開接線模式')
    for (const [a, b, , meaning] of WIRES) say(rec, `${resolve(a)} → ${resolve(b)}（${COLOR_ZH[wireColorSeen.get(`${a}>${b}`)]}）：${meaning}`)
    say(rec, `共 ${s.layout.wires.length} 條導線，全部以「導線」工具在 3D 麵包板上逐孔點擊完成；顏色由電路自動決定（電源正紅、地黑、訊號用其他顏色），不需選色。`)
    await shot(rec, '04-wired', '接線完成：電源、5V/GND、PA5 → 330 Ω → LED → GND、PB12 → 按鈕 → GND', { cam: CAM_OVERVIEW, settle: 400 })
  })

  // ---------------------------------------------------------------- 5
  await step(5, '載入真正的 STM32F103 ELF 韌體', async (rec) => {
    await clickComponent(page, ids.mcu, 1.0)
    await until(page, async (p) => ((await state(p)).selection[0] === ids.mcu ? true : null), `點擊 3D 中的 ${ids.mcu} 後應選取它`)
    const pick = page.getByRole('button', { name: '選擇檔案…' })
    await pick.waitFor({ state: 'visible' })
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), pick.click()])
    await chooser.setFiles(FIRMWARE)
    const s = await until(page, async (p) => {
      const st = await state(p)
      return st.firmware[ids.mcu]?.sha256 === FIRMWARE_SHA ? st : null
    }, '韌體綁定到 Blue Pill', 15000)
    const rec0 = s.firmware[ids.mcu]
    expect(rec0.name === 'lab-acceptance.elf' && rec0.format === 'elf', `韌體記錄不符：${rec0.name} ${rec0.format}`)
    await page.locator('.emb-fw-name', { hasText: 'lab-acceptance.elf' }).waitFor({ state: 'visible' })
    say(rec, `在 3D 場景點選 ${ids.mcu}，於屬性面板「韌體」區塊按「選擇檔案…」，經瀏覽器檔案選擇器選取 firmware/dist/lab-acceptance.elf。`)
    say(rec, `綁定記錄：${rec0.name}，格式 ${rec0.format.toUpperCase()}，${rec0.size} 位元組，SHA-256 ${rec0.sha256}（與磁碟上的檔案一致）。`)
    if (rec0.description) say(rec, `載入器描述：${rec0.description}`)
    await shot(rec, '05-firmware', '屬性面板：韌體 lab-acceptance.elf 已載入（含 SHA-256）')
  })

  // ---------------------------------------------------------------- 6
  await step(6, '按下執行', async (rec) => {
    const run = page.locator('.emb-run-ctl').getByRole('button', { name: '執行模擬' })
    runClickedAt = Date.now()
    await run.click()
    await until(page, async (p) => ((await state(p)).running ? true : null), '模擬進入執行狀態')
    await page.locator('.emb-run-ctl').getByRole('button', { name: '暫停模擬' }).waitFor({ state: 'visible' })
    await page.locator('.lg-capsule-hit[aria-label="暫停模擬"]').waitFor({ state: 'visible' })
    say(rec, '按屬性面板「執行」區塊的「執行」按鈕 → 應用程式狀態 running = true，狀態膠囊顯示「執行中」，按鈕變為「暫停」。')
  })

  // ---------------------------------------------------------------- 7
  await step(7, 'MCU 模擬引擎開始執行韌體', async (rec) => {
    // the first running frame: on a cold page the simulation worker may still
    // be loading its modules, which takes as long as the machine needs (the
    // measured delay goes into the report) — the step proves THAT it starts
    await until(page, async (p) => ((await state(p)).mcus[ids.mcu]?.state === 'running' ? true : null), 'MCU 狀態變為 running', START_MS)
    // from the Run click to the first frame with the MCU running
    const firstRunning = await page.evaluate((id) => window.__e2e.frames().find((f) => f.running && f.mcus.some((m) => m.id === id && m.state === 'running'))?.wall ?? null, ids.mcu)
    const nowW = await page.evaluate(() => window.__e2e.now())
    env.startMs = runClickedAt === null ? null : Math.max(0, Date.now() - runClickedAt - (firstRunning === null ? 0 : nowW - firstRunning))
    await page.locator('.emb-state', { hasText: '執行中' }).first().waitFor({ state: 'visible' })
    const t0 = await page.evaluate(() => window.__e2e.now())
    const sim0 = await simNow(page)
    const wSim0 = Date.now()
    await waitSim(page, sim0, 1.0)
    const wallFor1s = (Date.now() - wSim0) / 1000
    // the machine's single-thread speed right while the simulation runs (report: 執行環境與速度)
    await calAt('模擬中')
    const frames = (await page.evaluate((w) => window.__e2e.frames(w), t0)).filter((f) => f.current)
    const mcu = frames.map((f) => f.mcus.find((m) => m.id === ids.mcu)).filter(Boolean)
    expect(mcu.length >= 5, `收到的 MCU 畫格太少（${mcu.length}）`)
    const cyc0 = mcu[0].cycles
    const cyc1 = mcu[mcu.length - 1].cycles
    const pcs = new Set(mcu.map((m) => m.pc))
    const inFlash = [...pcs].every((pc) => pc >= 0x08000000 && pc < 0x08010000)
    const lf = await page.evaluate(() => window.__e2e.lastFrame())
    const info = lf.mcus.find((m) => m.componentId === ids.mcu)
    expect(cyc1 > cyc0, '週期計數應持續增加')
    expect(pcs.size >= 2, `PC 應持續變化（只看到 ${pcs.size} 個值）`)
    expect(inFlash, `PC 應位於快閃記憶體 0x08000000–0x0800FFFF：${[...pcs].map(hex).join(', ')}`)
    expect(info && info.hclkHz === 72_000_000, `韌體設定的核心時脈應為 72 MHz，實際 ${info?.hclkHz}`)
    expect(info.firmware === 'lab-acceptance.elf', `模擬畫格中的韌體名稱應為 lab-acceptance.elf，實際 ${info.firmware}`)
    const dSim = frames[frames.length - 1].time - frames[0].time
    say(rec, `狀態徽章顯示「執行中」；模擬畫格中 ${ids.mcu} 的 state = running、韌體 = ${info.firmware}。`)
    say(rec, `模擬時間前進 ${fmt(dSim)} s 期間，週期計數 ${cyc0.toLocaleString('en-US')} → ${cyc1.toLocaleString('en-US')}（+${(cyc1 - cyc0).toLocaleString('en-US')}），≈ ${fmt((cyc1 - cyc0) / dSim / 1e6, 1)} M 週期 / 模擬秒。`)
    say(rec, `PC 在 ${pcs.size} 個不同位址間移動（例：${[...pcs].slice(0, 4).map(hex).join('、')}），全部位於快閃記憶體。`)
    say(rec, `核心時脈 ${info.hclkHz / 1e6} MHz（韌體 SystemClock_Config：HSE 8 MHz × PLL9）；即時比 ${fmt(info.realtime * 100, 0)} %（模擬速度 / 實際時間；這 1 s 模擬時間用了實際 ${fmt(wallFor1s, 1)} s，按下執行後 ${fmt(env.startMs / 1000, 1)} s 出現第一個執行中的畫格）。`)
    await shot(rec, '07-running', '執行中：狀態徽章、PC、週期數、核心時脈與即時比')
  })

  // ---------------------------------------------------------------- 8
  await step(8, 'LED 根據韌體與接線狀態亮滅', async (rec) => {
    const t0 = await page.evaluate(() => window.__e2e.now())
    await waitSim(page, await simNow(page), 2.6)
    const frames = await page.evaluate((w) => window.__e2e.frames(w), t0)
    const { peak, edges, halves } = halfPeriods(frames, ids.led)
    const med = median(halves)
    expect(peak > 0.15, `LED 最大亮度應明顯大於 0（實際 ${fmt(peak)}）`)
    expect(edges.length >= 6, `2.6 s 內 LED 亮滅轉換應 ≥ 6 次（實際 ${edges.length}）`)
    expect(Math.abs(med - 0.25) < 0.04, `LED 半週期中位數應為 0.25 s（2 Hz），實際 ${fmt(med)} s`)
    const curr = await page.evaluate((id) => window.__e2e.component(id), ids.led)
    say(rec, `模擬 2.6 s 內 LED（${ids.led}）亮度由求解器遙測逐畫格取樣：峰值 ${fmt(peak, 2)}（≈ ${fmt(peak * 10, 1)} mA，滿亮度 = 10 mA），共 ${edges.length} 次亮滅轉換，半週期中位數 ${fmt(med)} s → 2 Hz 閃爍（韌體 mode 0：250 ms 亮 / 250 ms 滅）。`)
    if (curr?.current !== undefined) say(rec, `目前 LED 電流 ${fmt(curr.current * 1000, 2)} mA。`)
    // lit / unlit evidence. A screenshot of the live WebGL page takes longer
    // than one blink phase, so the moment is frozen with the status capsule
    // (Pause), the PAUSED frame's telemetry is checked, then shot and resumed.
    const capsule = page.locator('.lg-capsule-hit')
    const camLed = [37 + 2.5, 17, 7 + 12, 33, 0, 7]
    await setCamera(page, camLed)
    const ledLit = async (p) => (await p.evaluate((id) => window.__e2e.component(id)?.ledBrightness ?? 0, ids.led)) > peak / 2
    const pausedFrame = async (p) => {
      const f = await p.evaluate(() => window.__e2e.lastFrame())
      return f && !f.running ? true : null
    }
    for (const lit of [true, false]) {
      let ok = false
      for (let attempt = 0; attempt < 8 && !ok; attempt++) {
        // catch the START of the wanted phase: first the other one, then the edge
        // (each phase lasts 0.25 s of simulated time: both waits are budgeted in it)
        await untilSim(page, async (p) => ((await ledLit(p)) !== lit ? true : null), `LED ${lit ? '熄滅' : '亮起'}`, 0.6, { every: 10 })
        await untilSim(page, async (p) => ((await ledLit(p)) === lit ? true : null), `LED ${lit ? '亮起' : '熄滅'}`, 0.6, { every: 10 })
        await capsule.click()
        // the pause is a round trip to the simulation worker (wall time)
        await until(page, pausedFrame, '暫停後的模擬畫格', 20000, 20)
        await sleep(200) // the scene draws the paused telemetry
        ok = (await ledLit(page)) === lit
        if (ok) await shot(rec, lit ? '08-led-on' : '08-led-off', lit ? 'LED 亮（2 Hz 閃爍的亮相位，暫停後截圖）' : 'LED 滅（2 Hz 閃爍的滅相位，暫停後截圖）')
        await capsule.click()
        await until(page, async (p) => ((await state(p)).running ? true : null), '繼續執行', 20000)
      }
      expect(ok, `無法在 LED ${lit ? '亮' : '滅'}相位暫停並截圖`)
    }
    say(rec, '亮 / 滅截圖：在相位開始時以狀態膠囊暫停（閃爍半週期短於一次截圖所需時間），確認暫停畫格的 LED 遙測確實為亮 / 滅後才截圖，再繼續執行。')
  })

  // ---------------------------------------------------------------- 9
  /**
   * Hold the pushbutton down until `hold` s of sim time pass, with live
   * checks: through the inspector's 按住 button, or (`at` = a screen point)
   * directly on the button in the 3D scene, which presses it while the
   * simulation runs (and selects it).
   */
  const pressButton = async (hold = 0.12, at = null) => {
    if (at) {
      await page.mouse.move(at.x, at.y)
    } else {
      const btn = page.getByRole('button', { name: '按住按鈕' })
      await btn.waitFor({ state: 'visible' })
      const box = await btn.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    }
    await page.mouse.down()
    let low = null
    let pressedSeen = false
    try {
      const t = await until(page, async (p) => {
        const st = await state(p)
        return st.layout.components.find((c) => c.id === ids.btn)?.params?.pressed === true ? await simNow(p) : null
      }, '按鈕狀態 pressed = true', 15000, 20)
      // held for `hold` s of SIMULATED time (sampling PB12 meanwhile)
      await untilSim(page, async (p) => {
        const u = await p.evaluate((id) => window.__e2e.component(id), ids.mcu)
        const sw = await p.evaluate((id) => window.__e2e.component(id), ids.btn)
        if (sw?.pressed) pressedSeen = true
        const v = u?.pinVoltages?.PB12
        if (typeof v === 'number') low = low === null ? v : Math.min(low, v)
        return (await simNow(p)) >= t + hold ? true : null
      }, `按住按鈕 ${hold} s`, Infinity, { every: 20 })
    } finally {
      await page.mouse.up()
    }
    await until(page, async (p) => {
      const st = await state(p)
      return st.layout.components.find((c) => c.id === ids.btn)?.params?.pressed === false ? true : null
    }, '放開按鈕', 15000, 20)
    return { low, pressedSeen }
  }
  const uartText = () => page.evaluate((id) => window.__e2e.uart(id, 'USART1'), ids.mcu)

  await step(9, '按鈕能改變 GPIO 輸入', async (rec) => {
    await setCamera(page, CAM_OVERVIEW)
    const idle = await page.evaluate((id) => window.__e2e.component(id)?.pinVoltages?.PB12, ids.mcu)
    expect(idle > 2.5, `放開時 PB12 應被內部上拉至高電位（實際 ${fmt(idle, 2)} V）`)
    say(rec, `放開時 PB12 = ${fmt(idle, 2)} V（韌體設定的內部上拉）。`)
    const expectMode = async (line, at = null) => {
      const before = (await uartText()).length
      const r = await pressButton(0.12, at)
      expect(r.pressedSeen, '模擬遙測應回報按鈕被按下')
      expect(r.low !== null && r.low < 0.5, `按下時 PB12 應被拉到 GND（最低 ${fmt(r.low, 2)} V）`)
      // the firmware answers within its 30 ms debounce + one line at 115200 Bd: 1 s of simulated time is ample
      await untilSim(page, async () => ((await uartText()).slice(before).includes(line) ? true : null), `UART 輸出「${line.trim()}」`, 1.0)
      return r
    }
    // 0 → 1: 5 Hz — pressed directly on the button in the 3D scene
    const at = await aimComponent(page, ids.btn, 1.2)
    let r = await expectMode('mode=1 blink 5 Hz\r\n', at)
    await until(page, async (p) => ((await state(p)).selection[0] === ids.btn ? true : null), `在 3D 中按下 ${ids.btn} 後應選取它`)
    say(rec, `第 1 次直接在 3D 場景按住按鈕 ${ids.btn}（模擬執行中，在按鈕上按住滑鼠就是按下、放開就是放開，同時會選取它）；之後改用屬性面板的「按住」大按鈕。`)
    let t0 = await page.evaluate(() => window.__e2e.now())
    await waitSim(page, await simNow(page), 1.6)
    let hp = halfPeriods(await page.evaluate((w) => window.__e2e.frames(w), t0), ids.led)
    let med = median(hp.halves)
    expect(hp.edges.length >= 10 && Math.abs(med - 0.1) < 0.03, `mode 1 的 LED 應以 5 Hz 閃爍（半週期中位數 ${fmt(med)} s，轉換 ${hp.edges.length} 次）`)
    say(rec, `第 1 次按下：PB12 最低 ${fmt(r.low, 2)} V → 韌體經 EXTI12 去彈跳後輸出「mode=1 blink 5 Hz」，LED 半週期中位數 ${fmt(med)} s（5 Hz，${hp.edges.length} 次轉換 / 1.6 s）。`)
    // 1 → 2: solid on
    r = await expectMode('mode=2 solid on\r\n')
    t0 = await page.evaluate(() => window.__e2e.now())
    await waitSim(page, await simNow(page), 0.8)
    let fr = (await page.evaluate((w) => window.__e2e.frames(w), t0)).filter((f) => f.running && f.current)
    expect(fr.length > 5 && fr.every((f) => f.leds[ids.led] > 0.15), 'mode 2 的 LED 應恆亮')
    say(rec, `第 2 次按下 →「mode=2 solid on」，${fr.length} 個畫格中 LED 全部恆亮（亮度 ${fmt(fr[fr.length - 1].leds[ids.led], 2)}）。`)
    await shot(rec, '09-solid-on', 'mode 2：LED 恆亮（UART 終端機顯示模式切換訊息）', { cam: CAM_OVERVIEW, settle: 300 })
    // 2 → 3: off
    r = await expectMode('mode=3 off\r\n')
    t0 = await page.evaluate(() => window.__e2e.now())
    await waitSim(page, await simNow(page), 0.8)
    fr = (await page.evaluate((w) => window.__e2e.frames(w), t0)).filter((f) => f.running && f.current)
    expect(fr.length > 5 && fr.every((f) => f.leds[ids.led] < 0.02), 'mode 3 的 LED 應熄滅')
    say(rec, `第 3 次按下 →「mode=3 off」，${fr.length} 個畫格中 LED 全部熄滅。`)
    await shot(rec, '09-off', 'mode 3：LED 熄滅', { cam: CAM_OVERVIEW, settle: 300 })
    // 3 → 0: back to 2 Hz
    r = await expectMode('mode=0 blink 2 Hz\r\n')
    t0 = await page.evaluate(() => window.__e2e.now())
    await waitSim(page, await simNow(page), 1.6)
    hp = halfPeriods(await page.evaluate((w) => window.__e2e.frames(w), t0), ids.led)
    med = median(hp.halves)
    expect(Math.abs(med - 0.25) < 0.04, `回到 mode 0 後 LED 應以 2 Hz 閃爍（半週期中位數 ${fmt(med)} s）`)
    say(rec, `第 4 次按下 →「mode=0 blink 2 Hz」，LED 半週期中位數 ${fmt(med)} s，回到 2 Hz。`)
  })

  // ---------------------------------------------------------------- 10
  await step(10, '使用虛擬儀器觀察訊號', async (rec) => {
    // logic analyzer on PA5 (+ PC13 heartbeat, PB12 button, PA9 USART1 TX)
    await page.locator('.ws-tray-tabs').getByText('邏輯分析儀', { exact: true }).click()
    const add = page.locator('select[aria-label="新增通道"]')
    await add.waitFor({ state: 'visible' })
    for (const pin of ['PA5', 'PC13', 'PB12', 'PA9']) {
      await add.selectOption(`mcu|${ids.mcu}|${pin}`)
      await sleep(120)
    }
    const s = await state(page)
    const pins = s.logicChannels.map((c) => c.source.pin)
    expect(['PA5', 'PC13', 'PB12', 'PA9'].every((p) => pins.includes(p)), `邏輯分析儀通道應包含 PA5/PC13/PB12/PA9，實際 ${pins}`)
    // zoom the live view out to 2 s per screen (1-2-5 ladder from 10 ms)
    for (let i = 0; i < 7; i++) {
      await page.getByRole('button', { name: '縮小' }).click()
      await sleep(60)
    }
    const tStart = await simNow(page)
    await waitSim(page, tStart, 2.2)
    const tNow = await simNow(page)
    const cap = await page.evaluate(([a, b]) => window.__e2e.logic(a, b), [tNow - 2.0, tNow])
    const pa5 = cap.traces.find((t) => t.label === 'PA5')
    expect(pa5 && pa5.exact, 'PA5 通道應為精確（MCU 腳位）訊號')
    const dts = []
    for (let i = 1; i < pa5.times.length; i++) dts.push(pa5.times[i] - pa5.times[i - 1])
    expect(pa5.times.length >= 6, `2 s 內 PA5 應有 ≥ 6 個邊緣（實際 ${pa5.times.length}）`)
    const worst = Math.max(...dts.map((d) => Math.abs(d - 0.25)))
    expect(worst < 20e-6, `PA5 每個半週期都應為 250 ms ± 20 µs（最大偏差 ${fmt(worst * 1e6, 2)} µs）`)
    const pc13 = cap.traces.find((t) => t.label === 'PC13')
    let pulse = null
    for (let i = 1; pc13 && i < pc13.times.length; i++) {
      if (pc13.levels[i - 1] === 0 && pc13.levels[i] === 1) pulse = pc13.times[i] - pc13.times[i - 1]
    }
    say(rec, `邏輯分析儀（底部儀器列）以「新增通道」加入 ${ids.mcu} 的 PA5、PC13、PB12、PA9，並縮放到每畫面 2 s。`)
    say(rec, `記錄器在最近 2 s 內擷取 PA5 共 ${pa5.times.length} 個邊緣，每個半週期 250 ms，最大偏差 ${fmt(worst * 1e6, 2)} µs（精確邊緣時間，非取樣）。`)
    if (pulse !== null) say(rec, `PC13（板載 LED 心跳）低電位脈衝寬 ${fmt(pulse * 1000, 3)} ms（韌體：每秒亮 50 ms）。`)
    await sleep(600)
    await shot(rec, '10-logic', '邏輯分析儀：PA5 方波（2 Hz）、PC13 心跳、PB12、PA9（USART1 TX）', { cam: CAM_OVERVIEW, settle: 600 })
    // UART terminal
    await page.locator('.ws-tray-tabs').getByText('UART 終端機', { exact: true }).click()
    const out = page.locator('pre.emb-term-out')
    await out.waitFor({ state: 'visible' })
    const sel = await page.locator('.emb-term select').first().inputValue()
    const text = await out.innerText()
    expect(text.includes('boot ok'), `UART 終端機應顯示「boot ok」：${JSON.stringify(text.slice(0, 120))}`)
    for (const line of ['mode=0 blink 2 Hz', 'mode=1 blink 5 Hz', 'mode=2 solid on', 'mode=3 off']) {
      expect(text.includes(line), `UART 終端機應顯示「${line}」`)
    }
    // the line the firmware programmed (USART_BRR / CR1 / CR2), from the simulation frame …
    const line = await page.evaluate((id) => {
      const m = window.__e2e.lastFrame()?.mcus.find((x) => x.componentId === id)
      return m?.uarts?.find((u) => u.name === 'USART1')?.config ?? null
    }, ids.mcu)
    expect(
      line && line.enabled && Math.abs(line.baud - 115200) < 1 && line.dataBits === 8 && line.parity === 'none' && line.stopBits === 1,
      `韌體設定的 USART1 應為 115200 8N1，實際 ${JSON.stringify(line)}`,
    )
    // … and the terminal's line chip shows exactly that, in the product's one
    // baud format (「115 200 Bd · 8N1」, UX QA IS-F17 — the analyzer lane and
    // the 量測 tab read the same). The chip is a glossary term (鮑率): its ⓘ
    // affordance is aria-hidden, so the label is read without it.
    const chipEl = page.locator('.emb-term .emb-tag').first()
    const chip = await chipEl.evaluate((el) => {
      const c = el.cloneNode(true)
      for (const h of c.querySelectorAll('[aria-hidden="true"]')) h.remove()
      return c.textContent.replace(/\s+/g, ' ').trim()
    })
    expect(chip === '115 200 Bd · 8N1', `線路設定標籤應為韌體設定的「115 200 Bd · 8N1」，實際「${chip}」`)
    expect((await chipEl.locator('.insp-term').count()) === 1, '線路設定標籤應可點開「鮑率」名詞解釋（ⓘ）')
    say(rec, `UART 終端機（${sel.replace('\u0000', ' · ')}）顯示「boot ok」與四行模式訊息；線路設定標籤「${chip}」與模擬畫格中韌體寫入 USART_BRR / CR1 / CR2 的設定（${Math.round(line.baud)} Bd、${line.dataBits} 位元、無同位、${line.stopBits} 停止位元）一致，並可點開「鮑率」名詞解釋。`)
    await shot(rec, '10-uart', 'UART 終端機：boot ok 與模式切換訊息，線路設定 115 200 Bd · 8N1')
  })

  // ---------------------------------------------------------------- 11
  await step(11, '可以暫停、重置與重新執行', async (rec) => {
    // pause (status capsule)
    await page.locator('.lg-capsule-hit[aria-label="暫停模擬"]').click()
    await until(page, async (p) => (!(await state(p)).running ? true : null), '模擬暫停', 20000)
    await sleep(300)
    const a = await state(page)
    const cycA = a.mcus[ids.mcu]?.cycles
    await sleep(800)
    const b = await state(page)
    expect(b.running === false && b.simTime === a.simTime, `暫停後模擬時間不應前進（${a.simTime} → ${b.simTime}）`)
    expect(b.mcus[ids.mcu]?.cycles === cycA, '暫停後 MCU 週期數不應增加')
    // the capsule keeps two pill layers (collapsed / expanded); read the visible one
    await page.locator('.lg-capsule:not(.is-hidden) .app-run-word', { hasText: '已暫停' }).first().waitFor({ state: 'visible' })
    say(rec, `點狀態膠囊暫停：running = false，0.8 s 內模擬時間停在 ${fmt(b.simTime)} s、週期數停在 ${cycA?.toLocaleString('en-US')}，膠囊顯示「已暫停」。`)
    await shot(rec, '11-paused', '已暫停：時間與週期數凍結', { cam: CAM_OVERVIEW, settle: 300 })
    // reset (More → Reset simulation)
    const more = await openMore(page)
    await more.getByText('重置模擬', { exact: true }).click()
    await until(page, async (p) => {
      const st = await state(p)
      return st.simTime === 0 && !st.running ? true : null
    }, '模擬重置歸零', 20000)
    await until(page, async () => ((await uartText()) === '' ? true : null), '重置後終端機清空', 20000)
    await closeMore(page)
    say(rec, '「更多 → 重置模擬」：模擬時間歸零、UART 終端機緩衝清空（電源循環）。')
    // run again (status capsule)
    await page.locator('.lg-capsule-hit[aria-label="執行模擬"]').click()
    // the firmware boots and prints within a few ms of simulated time: 1 s is ample
    await untilSim(page, async () => ((await uartText()).startsWith('boot ok\r\nmode=0 blink 2 Hz\r\n') ? true : null), '在重新執行後再次輸出「boot ok」', 1.0)
    const t0 = await page.evaluate(() => window.__e2e.now())
    await waitSim(page, await simNow(page), 1.6)
    const hp = halfPeriods(await page.evaluate((w) => window.__e2e.frames(w), t0), ids.led)
    expect(Math.abs(median(hp.halves) - 0.25) < 0.04, `重新執行後 LED 應從 mode 0（2 Hz）開始，半週期 ${fmt(median(hp.halves))} s`)
    const c = await state(page)
    expect(c.running && c.mcus[ids.mcu]?.state === 'running', '重新執行後 MCU 應在執行中')
    say(rec, `再點狀態膠囊執行：韌體從頭開始，終端機重新出現「boot ok」「mode=0 blink 2 Hz」，LED 半週期 ${fmt(median(hp.halves))} s（mode 0）。`)
    // MCU-only reset from the inspector (NRST: the core restarts, the circuit
    // keeps simulating). Leave mode 0 first, so the reset is visible as the
    // firmware forgetting its RAM state.
    // (pressing the button in 3D while running presses it — one press = mode 1)
    const beforePress = (await uartText()).length
    await pressButton(0.12, await aimComponent(page, ids.btn, 1.2))
    await untilSim(page, async () => ((await uartText()).slice(beforePress).includes('mode=1 blink 5 Hz\r\n') ? true : null), 'UART 輸出「mode=1 blink 5 Hz」', 1.0)
    await clickComponent(page, ids.mcu, 1.0)
    await until(page, async (p) => ((await state(p)).selection[0] === ids.mcu ? true : null), `重新選取 ${ids.mcu}`)
    const before = (await uartText()).length
    const simBefore = await simNow(page)
    const tReset = await page.evaluate(() => window.__e2e.now())
    await page.locator('.emb-run-ctl').getByRole('button', { name: '重置 MCU' }).click()
    await untilSim(page, async () => ((await uartText()).slice(before).includes('boot ok\r\nmode=0 blink 2 Hz\r\n') ? true : null), '在重置 MCU 後再次開機（回到 mode 0）', 1.0)
    const resetLog = (await page.evaluate(() => window.__e2e.log(200))).find((e) => e.source === 'sim' && e.message === `${ids.mcu}: reset`)
    expect(resetLog, `模擬日誌應記錄「${ids.mcu}: reset」`)
    expect(resetLog.time >= simBefore, `重置 MCU 不應讓模擬時間歸零（日誌時間 ${fmt(resetLog.time)} s，重置前 ${fmt(simBefore)} s）`)
    await waitSim(page, await simNow(page), 1.6)
    const hpR = halfPeriods((await page.evaluate((w) => window.__e2e.frames(w), tReset)).filter((f) => f.time > resetLog.time + 0.05), ids.led)
    expect(Math.abs(median(hpR.halves) - 0.25) < 0.04, `重置 MCU 後 LED 應回到 mode 0（2 Hz），半週期 ${fmt(median(hpR.halves))} s`)
    say(rec, `先按一次按鈕進入 mode 1（終端機「mode=1 blink 5 Hz」），再按屬性面板「重置 MCU」（NRST 腳位重置：只重置核心，電路持續模擬）：日誌在 ${fmt(resetLog.time)} s 記錄「${ids.mcu}: reset」（模擬時間未歸零），韌體從重置向量重新開機，終端機再次出現「boot ok」「mode=0 blink 2 Hz」，LED 半週期 ${fmt(median(hpR.halves))} s——RAM 中的模式狀態已清除。`)
  })

  // ---------------------------------------------------------------- 12
  await step(12, '儲存專案後能重新載入', async (rec) => {
    layoutBeforeSave = await captureState(page)
    const more = await openMore(page)
    const [download] = await Promise.all([page.waitForEvent('download'), more.getByText('儲存專案', { exact: true }).click()])
    const name = download.suggestedFilename()
    savedProject = path.join(os.tmpdir(), `ohmlet-acceptance-${process.pid}-${runIndex}-${name}`)
    await download.saveAs(savedProject)
    await closeMore(page)
    const json = JSON.parse(readFileSync(savedProject, 'utf8'))
    const fwIds = Object.keys(json.firmware ?? {})
    const fwU1 = json.firmware?.[ids.mcu]
    expect(json.format === 'ohmlet-project', `下載的檔案應為 ohmlet-project 專案（format = ${json.format}）`)
    expect(fwU1 && fwU1.sha256 === FIRMWARE_SHA, '專案檔應內嵌 Blue Pill 的韌體（SHA-256 一致）')
    expect(Array.isArray(json.layout?.components) && json.layout.components.length === layoutBeforeSave.components.length, '專案檔應包含完整電路')
    say(rec, `「更多 → 儲存專案」觸發瀏覽器下載：${name}（${readFileSync(savedProject).length.toLocaleString('en-US')} 位元組，format = ${json.format}，formatVersion ${json.formatVersion}），內含電路（${json.layout.components.length} 個元件、${json.layout.wires.length} 條導線）、${fwIds.length} 個韌體（${ids.mcu}：${fwU1.name}，SHA-256 一致）與儀器設定。`)
    // reload with the browser's storage wiped: only the file can bring it back
    await page.evaluate(() => sessionStorage.setItem('e2e.wipe', '1'))
    await boot()
    const empty = await state(page)
    expect(empty.layout.components.length === 0 && Object.keys(empty.firmware).length === 0, '清除瀏覽器儲存後重新整理，麵包板應為空白')
    say(rec, '清除這個瀏覽器的 localStorage（自動儲存的電路與韌體綁定）後重新整理頁面 → 空白麵包板、沒有韌體。')
    await shot(rec, '12-reloaded-empty', '重新整理後：瀏覽器儲存已清除，麵包板空白')
    const more2 = await openMore(page)
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), more2.getByText('開啟專案…', { exact: true }).click()])
    await chooser.setFiles(savedProject)
    const s = await until(page, async (p) => {
      const st = await state(p)
      return st.layout.components.length === layoutBeforeSave.components.length && st.firmware[ids.mcu]?.sha256 === FIRMWARE_SHA ? st : null
    }, '專案開啟（電路 + 韌體）', 30000)
    await closeMore(page)
    // canonical form: key order is not content; `pressed` is a transient runtime param
    const canon = (v) =>
      Array.isArray(v)
        ? v.map(canon)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canon(v[k])]))
          : v
    const norm = (l) =>
      JSON.stringify(
        canon({
          c: [...l.components].map((c) => ({ ...c, params: { ...(c.params ?? {}), pressed: undefined } })).sort((x, y) => x.id.localeCompare(y.id)),
          w: [...l.wires].sort((x, y) => x.id.localeCompare(y.id)),
        }),
      )
    if (norm(s.layout) !== norm(layoutBeforeSave)) {
      const a = JSON.parse(norm(layoutBeforeSave))
      const b = JSON.parse(norm(s.layout))
      const diffs = []
      for (const k of ['c', 'w']) {
        const n = Math.max(a[k].length, b[k].length)
        for (let i = 0; i < n; i++) {
          if (JSON.stringify(a[k][i]) !== JSON.stringify(b[k][i])) diffs.push(`${JSON.stringify(a[k][i])} ≠ ${JSON.stringify(b[k][i])}`)
        }
      }
      throw new StepError(`開啟後的電路應與儲存前完全相同：${diffs.slice(0, 4).join('；')}`)
    }
    say(rec, `「更多 → 開啟專案…」經檔案選擇器選取剛下載的檔案 → ${s.layout.components.length} 個元件、${s.layout.wires.length} 條導線與儲存前完全相同；${ids.mcu} 的韌體 ${s.firmware[ids.mcu].name} 已重新綁定（SHA-256 一致）。`)
    // run again: the restored firmware boots and blinks
    await page.locator('.lg-capsule-hit[aria-label="執行模擬"]').click()
    // a freshly loaded page: its simulation worker may still be starting (START_MS before the clock first moves)
    await untilSim(page, async () => ((await uartText()).includes('boot ok\r\nmode=0 blink 2 Hz') ? true : null), '在開啟的專案執行後輸出「boot ok」', 1.0, { startMs: START_MS })
    const t0 = await page.evaluate(() => window.__e2e.now())
    await waitSim(page, await simNow(page), 1.6)
    const hp = halfPeriods(await page.evaluate((w) => window.__e2e.frames(w), t0), ids.led)
    expect(Math.abs(median(hp.halves) - 0.25) < 0.04, `開啟的專案執行後 LED 應以 2 Hz 閃爍（半週期 ${fmt(median(hp.halves))} s）`)
    say(rec, `執行開啟的專案：MCU 執行中，終端機輸出「boot ok」「mode=0 blink 2 Hz」，LED 半週期 ${fmt(median(hp.halves))} s（2 Hz）。`)
    await page.locator('.ws-tray-tabs').getByText('UART 終端機', { exact: true }).click().catch(() => {})
    await shot(rec, '12-reopened-running', '開啟儲存的專案後再次執行：韌體仍綁定、LED 閃爍、終端機輸出', { cam: CAM_OVERVIEW, settle: 500 })
  })

  run.ids = ids
  await calAt('結束')
  if (rtAll.length > 0) {
    let lo = Infinity
    let hi = -Infinity
    for (const x of rtAll) {
      if (x < lo) lo = x
      if (x > hi) hi = x
    }
    env.realtime = { median: median(rtAll), min: lo, max: hi, frames: rtAll.length }
  }
  run.finishedAt = new Date().toISOString()
  run.pageErrors = pageErrors
  if (savedProject) rmSync(savedProject, { force: true })
  await ctx.close()
  return run
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const STATUS = { pass: '通過', fail: '失敗', blocked: '未執行' }

/** 「開始 6 · 模擬中 3 · 結束 2」: the run's CPU calibrations */
function fmtCal(env) {
  const xs = env?.cal ?? []
  return xs.length === 0 ? '—' : xs.map((c) => `${c.at} ${c.mops == null ? '—' : c.mops}`).join(' · ')
}

/** 「42 %」: the run's median realtime factor */
function fmtRt(env) {
  const r = env?.realtime
  return r ? `${fmt(r.median * 100, 0)} %` : '—'
}

/** 「42 %（35 – 47 %）」 */
function fmtRtRange(env) {
  const r = env?.realtime
  return r ? `${fmt(r.median * 100, 0)} %（${fmt(r.min * 100, 0)} – ${fmt(r.max * 100, 0)} %）` : '—'
}

function writeReport(runs, meta) {
  const last = runs[runs.length - 1]
  const lines = []
  const allPass = runs.every((r) => r.steps.every((s) => s.status === 'pass') && r.pageErrors.length === 0)
  lines.push('# 首次發佈驗收報告（端對端）')
  lines.push('')
  lines.push(
    `> 本報告由 \`node scripts/acceptance-e2e.mjs --runs ${runs.length}\` 自動產生：在真正的瀏覽器（${meta.browser}，1440 × 900，滑鼠）中，以繁體中文介面與桌面工作區，透過使用者實際使用的介面完成使用者訂定的十二個驗收步驟。每一步都以模擬的實際狀態判定（應用程式與實驗室狀態、韌體 SHA-256、MCU 狀態 / PC / 週期數、求解器的 LED 亮度遙測、UART 緩衝、邏輯分析儀記錄器的邊緣時間），截圖只是佐證。`,
  )
  lines.push('')
  lines.push(`- 產生時間：${meta.date}`)
  lines.push(`- 受測網址：${meta.url}（${process.env.E2E_SERVER_NOTE ? `${process.env.E2E_SERVER_NOTE}；` : ''}自動化掛鉤 \`?e2e\` 只讀取狀態，不改變任何行為；\`?shotrig\` 只用來把滑鼠點擊對準 3D 孔位）`)
  lines.push(`- 韌體：\`firmware/dist/lab-acceptance.elf\`（SHA-256 \`${FIRMWARE_SHA}\`），以 clang + ST HAL v1.1.9 建置，原始碼在 \`firmware/projects/lab-acceptance/\``)
  lines.push(`- 總結：**${allPass ? `全部通過（${runs.length} 次連續執行皆通過）` : '有步驟失敗'}**`)
  lines.push('')
  lines.push('## 結果摘要')
  lines.push('')
  lines.push(`| 步驟 | 驗收項目 | ${runs.map((r) => `第 ${r.index} 次`).join(' | ')} |`)
  lines.push(`| --- | --- | ${runs.map(() => '---').join(' | ')} |`)
  for (let i = 0; i < last.steps.length; i++) {
    const s = last.steps[i]
    lines.push(`| ${s.id} | ${s.title} | ${runs.map((r) => `${STATUS[r.steps[i]?.status ?? 'blocked']}（${fmt((r.steps[i]?.ms ?? 0) / 1000, 1)} s）`).join(' | ')} |`)
  }
  lines.push(`| — | 頁面錯誤（pageerror / console.error） | ${runs.map((r) => (r.pageErrors.length === 0 ? '無' : `${r.pageErrors.length} 筆`)).join(' | ')} |`)
  lines.push(`| — | 模擬即時比（中位數） | ${runs.map((r) => fmtRt(r.env)).join(' | ')} |`)
  lines.push('')
  lines.push('## 執行環境與速度')
  lines.push('')
  lines.push(
    '模擬器以這台電腦當下能給的速度執行韌體：「即時比」是模擬時間 ÷ 實際時間（狀態膠囊與屬性面板「模擬速度」顯示的就是它）。因此每個需要模擬計算的等待都以**模擬時間**設定期限（例如按下按鈕後 1 s 模擬時間內必須輸出模式訊息、LED 每個相位 0.25 s），而不是實際時間；只有模擬時鐘真的停住（30 s 實際時間內完全沒有前進）才算失敗。電腦忙碌時驗收會跑得比較久，但判定標準不變。',
  )
  lines.push('')
  lines.push(`| 項目 | ${runs.map((r) => `第 ${r.index} 次`).join(' | ')} |`)
  lines.push(`| --- | ${runs.map(() => '---').join(' | ')} |`)
  lines.push(`| 模擬即時比：中位數（最低 – 最高） | ${runs.map((r) => fmtRtRange(r.env)).join(' | ')} |`)
  lines.push(`| CPU 校準：單執行緒整數迴圈（百萬次 / s，越大表示電腦越空閒） | ${runs.map((r) => fmtCal(r.env)).join(' | ')} |`)
  lines.push(`| 頁面載入（含重新整理） | ${runs.map((r) => (r.env?.bootMs ?? []).map((ms) => `${fmt(ms / 1000, 1)} s`).join(' / ') || '—').join(' | ')} |`)
  lines.push(`| 按下執行到第一個執行中畫格 | ${runs.map((r) => (r.env?.startMs == null ? '—' : `${fmt(r.env.startMs / 1000, 1)} s`)).join(' | ')} |`)
  lines.push('')
  lines.push(
    '即時比若隨 CPU 校準一起下降，是這台電腦當時忙碌（例如同時有其他瀏覽器在跑 3D 場景），不是模擬器在上一次執行後留下了東西：每一次執行都是全新的瀏覽器環境，關閉後不留下任何程序。',
  )
  lines.push('')
  lines.push('## 測試電路')
  lines.push('')
  lines.push('| 元件 | 位置 | 說明 |')
  lines.push('| --- | --- | --- |')
  const id = (k, fallback) => last.ids?.[k] ?? fallback
  lines.push(`| STM32F103C8T6 Blue Pill（${id('mcu', 'U1')}） | 第 1 腳 PB12 在 ${PLAN.mcu.at} | PA5 = c20、5V = h27、GND = h28、PB12 = h10 |`)
  lines.push(`| 電阻 ${id('r', 'R1')}，330 Ω | ${PLAN.resistor.holes.join(' – ')} | PA5 的限流電阻 |`)
  lines.push(`| LED ${id('led', 'LED1')}（紅色） | 陽極 ${PLAN.led.holes[0]}、陰極 ${PLAN.led.holes[1]} | 跨越中央溝槽 |`)
  lines.push(`| 按鈕 ${id('btn', 'SW1')} | A1 在 ${PLAN.button.at} | A 側接 PB12，B 側接地；不需外接電阻（內部上拉） |`)
  lines.push(`| 工作台電源 ${id('psu', 'PS1')} | 板外 | 5 V，接下方電源軌 |`)
  lines.push('')
  lines.push('| 導線 | 顏色 | 用途 |')
  lines.push('| --- | --- | --- |')
  for (const [a, b, role, m] of WIRES) lines.push(`| ${a.replace('PS:', 'PS1:')} → ${b} | ${COLOR_ZH[wireColorSeen.get(`${a}>${b}`)] ?? ROLE_ZH[role]} | ${m} |`)
  lines.push('')
  lines.push('韌體行為（`lab-acceptance`）：72 MHz；開機輸出 `boot ok` 與 `mode=0 blink 2 Hz`；PA5 依模式 0 → 1 → 2 → 3 為 2 Hz 閃爍 / 5 Hz 閃爍 / 恆亮 / 熄滅，按鈕（PB12，EXTI 下降緣，30 ms 去彈跳）切換模式並由 USART1 115200 8N1 回報；PC13 板載 LED 每秒亮 50 ms 作為心跳。所有時序都在 SysTick 中斷內完成，與 UART 輸出無關。')
  lines.push('')
  lines.push(`## 逐步紀錄（第 ${last.index} 次執行）`)
  lines.push('')
  for (const s of last.steps) {
    lines.push(`### ${s.id}. ${s.title} — ${STATUS[s.status]}`)
    lines.push('')
    for (const e of s.evidence) lines.push(`- ${e}`)
    if (s.error) lines.push(`- **失敗原因：** ${s.error.split('\n')[0]}`)
    lines.push('')
    for (const sh of s.shots) {
      lines.push(`![${sh.caption}](shots/${sh.file})`)
      lines.push('')
      lines.push(`*${sh.caption}*`)
      lines.push('')
    }
  }
  if (runs.some((r) => r.pageErrors.length > 0)) {
    lines.push('## 頁面錯誤')
    lines.push('')
    for (const r of runs) for (const e of r.pageErrors) lines.push(`- 第 ${r.index} 次：\`${e.replace(/`/g, "'")}\``)
    lines.push('')
  }
  lines.push('## 驗收過程中發現與修正的問題')
  lines.push('')
  lines.push('- **模組序列埠的字長**（已修正，`src/sim/models/comm.model.ts`）：CH340 的 COM 埠以 9600 8E1 開啟時，UART 終端機顯示成「9600 7E1」。原因是模組回報的傳輸參數把「資料位元數」當成 `UartLineConfig.dataBits`，而這個欄位與 STM32 的 USART_CR1.M 一樣是「含同位位元的字長」。現在 8 個資料位元 + 同位位元回報為 9 位元字長，終端機正確顯示 8E1（測試：`tests/uart-module-ports.test.ts`）。')
  lines.push('- **UART 終端機在模組傳出任何位元組前看不到模組的序列埠**（已新增功能）：CH340 的「COM 埠（USB 轉 TTL）」與 HC-05 的「藍牙（已配對手機）」現在一進入模擬（第一個模擬畫格）就列在序列埠選單中，並顯示模組在腳位上使用的傳輸參數；之前要等到第一個位元組抵達才會出現。')
  lines.push('- 十二個步驟本身沒有發現產品錯誤。觀察：屬性面板的「週期」是自上電起累計的核心週期數，「重置 MCU」（NRST）不會將它歸零；重置是否發生以韌體重新開機（UART「boot ok」）、日誌「U1: reset」與 RAM 中的模式狀態被清除來驗證。')
  lines.push('- **發佈前分析（2026-10-19）：第 10 步「線路設定應為 115200 8N1」**——不是產品錯誤：UART 終端機的線路設定標籤改用全產品統一的鮑率格式「115 200 Bd · 8N1」（與邏輯分析儀通道、量測分頁相同），並可點開「鮑率」名詞解釋（ⓘ）。驗收仍檢查同一件事：標籤內容與模擬畫格中韌體寫入 USART1 的設定（115200 Bd、8 位元、無同位、1 停止位元）一致。')
  lines.push('- **發佈前分析（2026-10-19）：第 2、3 次執行在第 8 步「逾時（20000 ms）：模擬時間前進 2.6 s」**——不是產品洩漏：狀態膠囊當時誠實顯示「0.06 倍速」。量測顯示模擬速度跟著整台電腦的忙碌程度走（同一段時間內單執行緒校準在 2–122 百萬次 / s 之間變動）：全新的瀏覽器第一次執行一樣慢；同一頁重新整理、同一頁連續開啟多個專案都只有一個模擬背景執行緒；每次執行關閉後瀏覽器不留下任何轉譯程序或 CPU 用量；不經瀏覽器、直接在 node 執行同一電路與韌體，同一段時間也一樣忽快忽慢（每 0.1 s 模擬時間花 0.17–40 s 實際時間）；慢的時候模擬背景執行緒處於「就緒」狀態（要執行卻分不到 CPU，只得到約 2 % 的 CPU 時間），而系統的處理器佇列同時有 100 個以上等著執行的執行緒。原因是驗收以實際時間設定期限，電腦忙碌時正確的產品也會逾時；現在改以模擬時間設定期限並偵測真正的停滯（見「執行環境與速度」）。')
  lines.push('')
  lines.push('## 範圍與誠實聲明')
  lines.push('')
  lines.push('- 「拖入」在本應用程式中的操作是：點選元件庫卡片進入放置模式，再點擊麵包板孔位放下（與手機版相同的放置流程）；本測試使用的就是這個流程。')
  lines.push('- 3D 孔位與端子的點擊位置由 `window.__shotRig.project()` 依場景實際的相機投影計算，再以真實滑鼠事件點擊；點擊前確認該像素沒有被任何介面面板遮住。相機在點擊前會移到目標上方（如同使用者縮放視角）。')
  lines.push('- 示波器為選用項目，本次驗收未納入（需要另外放置示波器探棒）；訊號以邏輯分析儀（精確邊緣時間）與 UART 終端機觀察。')
  lines.push('- 截圖使用「效能」繪圖模式（無隨機後製特效），讓每次執行的畫面可以比較。')
  lines.push('- 原始量測資料（每次執行的每一步證據與耗時）在 `results.json`。')
  lines.push('')
  writeFileSync(path.join(OUT, 'README.md'), lines.join('\n'))
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({
    ...(CHANNEL === 'bundled' ? {} : { channel: CHANNEL }),
    headless: process.env.E2E_HEADED !== '1',
  })
  const runs = []
  try {
    for (let i = 1; i <= RUNS; i++) {
      // the last run's screenshots become the report's; earlier runs go to tmp
      const dir = i === RUNS ? path.join(os.tmpdir(), `ohmlet-acceptance-shots-${process.pid}`) : path.join(os.tmpdir(), `ohmlet-acceptance-run-${process.pid}-${i}`)
      rmSync(dir, { recursive: true, force: true })
      const run = await runOnce(browser, i, dir)
      run.shotDir = dir
      runs.push(run)
    }
  } finally {
    await browser.close()
  }
  // publish the last run's screenshots
  const last = runs[runs.length - 1]
  rmSync(SHOTS, { recursive: true, force: true })
  mkdirSync(SHOTS, { recursive: true })
  for (const s of last.steps) for (const sh of s.shots) {
    const src = path.join(last.shotDir, sh.file)
    if (existsSync(src)) copyFileSync(src, path.join(SHOTS, sh.file))
  }
  for (const r of runs) rmSync(r.shotDir, { recursive: true, force: true })
  const meta = { date: new Date().toISOString(), url: URL, browser: CHANNEL === 'bundled' ? 'Playwright Chromium' : `Playwright + ${CHANNEL}` }
  writeFileSync(
    path.join(OUT, 'results.json'),
    JSON.stringify({ meta, firmwareSha256: FIRMWARE_SHA, runs: runs.map(({ shotDir, ...r }) => r) }, null, 2),
  )
  writeReport(runs, meta)
  const failed = runs.some((r) => r.steps.some((s) => s.status !== 'pass') || r.pageErrors.length > 0)
  console.table(runs.map((r) => ({ run: r.index, passed: r.steps.filter((s) => s.status === 'pass').length, steps: r.steps.length, pageErrors: r.pageErrors.length, realtime: fmtRt(r.env), cpu: fmtCal(r.env) })))
  console.log(`report: ${path.relative(ROOT, path.join(OUT, 'README.md'))}`)
  if (failed) process.exitCode = 1
}

// run only when executed as a script: tests/acceptance-waits.test.ts imports
// the simulation-time waits without starting a browser
const sameFile = (p, q) => (process.platform === 'win32' ? p.toLowerCase() === q.toLowerCase() : p === q)
if (process.argv[1] && sameFile(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(e)
    process.exit(2)
  })
}

export { StepError, START_MS, STALL_MS, untilSim, waitSim }
