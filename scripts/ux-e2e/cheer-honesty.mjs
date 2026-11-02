/**
 * cheer — honest celebrations, in the real app (Playwright, msedge):
 *
 *   the reviewer's cases that must NOT cheer
 *     s29  an LED at 21 mA behind 150 Ω (warning on LED1)       → no 「電路正常運作 ✓」
 *     s14  12 V with a reversed electrolytic that vents          → none (damage in the window)
 *     s26  a working circuit, then Delete on LED2                → no second cheer
 *     s26  … Delete INSIDE the first 1.2 s (both LEDs lit, not    → no cheer after it, nor after Ctrl+Z
 *          cheered yet)
 *     s10  課程 → 初級 1 → 載入完整答案 → 檢查我的電路          → no 完成！/ confetti / chime;
 *                                                                 the toast, the 驗收 headline and the
 *                                                                 coach say 「全部 6 項條件都通過（用的
 *                                                                 是載入的解答）」 — never 「課程完成」 —
 *                                                                 and 〔載入起始電路，自己接一次〕 loads
 *                                                                 the start at once (〔復原〕)
 *     M1   npn-switch, SW1 held ~1 s (w14)                       → no cue over the dark LED
 *     M1   … a FINGER holding SW1 1.3 / 1.4 / 1.7 / 2.5 s        → no cue while held, none after the
 *          (just past the window)                                  release (the LED goes dark with it)
 *     M1   … 保持按下 (the inspector's switch)                    → ONE cue, while LED1 is lit — and
 *                                                                 still lit 2 s later
 *     M1   button-exti: a click, then 保持按下 (w4)               → no cue names a dark LED1, presses
 *                                                                 are never 「PA5 在切換」
 *     M1   phone: a 0.9 s long-press on the running SW1 (w13)    → no cue over a dark LED; a 2.5 s
 *                                                                 finger hold → none either; the
 *                                                                 sheet's 保持按下 → the cue while lit
 *   real successes that DO cheer
 *     LED + 330 Ω                          → 「電路正常運作 ✓ · LED1 亮了」 after ≥ 1.2 s simulated
 *     M2: LED + 330 Ω + a 100 µF electrolytic across the rails (+ on +)
 *                                          → no false 「PS1 輸出超過 2 A」, ONE cue (needs the
 *                                             simulation owner's sustained-over-current fix)
 *     lesson b1 wired by hand              → 完成！ + confetti (11–16 px quads, none bursting from
 *                                             behind the badge — aimed with its MEASURED box — and
 *                                             every fountain on a working part, never bare wood /
 *                                             empty holes), no duplicate 「課程完成…」 toast
 *     the blink example (Blue Pill firmware) → 「電路正常運作 ✓ · …」
 *   plus: a 390×844 phone pass, reduced motion (static glow), the English
 *   classic chrome (3D cue only) and the visual-regression harness
 *   (?shotrig without &cheer: nothing at all).
 *
 *   UX_E2E_URL=http://localhost:5423/ UX_E2E_SHOTS=<dir> node scripts/ux-e2e/cheer-honesty.mjs
 *   CHEER_ONLY=desktop,phone,reduced,classic,harness,m1,m1phone,m2   (default: all)
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
const ONLY = (process.env.CHEER_ONLY ?? 'desktop,phone,reduced,classic,harness,m1,m1phone,m2').split(',')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(cond, what, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${extra !== '' ? `  (${extra})` : ''}`)
  if (!cond) failures++
  return cond
}

const PS = (v = 5) => ({ id: 'PS1', type: 'power_supply', params: { voltage: v } })
const PS_WIRES = [
  { id: 'W1', from: 'PS1:+', to: 'top+0' },
  { id: 'W2', from: 'PS1:-', to: 'top-0' },
]
const ledCircuit = (r, name) => ({
  version: 1,
  name,
  components: [PS(), { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: r } }, { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'red' } }],
  wires: PS_WIRES,
})
const REVERSED_CAP = {
  version: 1,
  name: 'cheer-s14',
  components: [
    PS(12),
    { id: 'R1', type: 'resistor', holes: ['top+6', 'top-6'], params: { resistance: 150 } },
    { id: 'R2', type: 'resistor', holes: ['top+13', 'a20'], params: { resistance: 1000 } },
    { id: 'LED1', type: 'led', holes: ['b20', 'top-24'], params: { color: 'green' } },
    { id: 'C1', type: 'capacitor', holes: ['top-30', 'top+31'], params: { polarized: true, capacitance: 0.0001 } },
  ],
  wires: PS_WIRES,
}
/** M2: a correctly placed bulk capacitor (+ on the + rail) beside a working LED */
const BULK_CAP = {
  version: 1,
  name: 'cheer-m2',
  components: [
    PS(),
    { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 330 } },
    { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'red' } },
    { id: 'C1', type: 'capacitor', holes: ['top+30', 'top-31'], params: { polarized: true, capacitance: 0.0001 } },
  ],
  wires: PS_WIRES,
}
const TWO_LEDS = {
  version: 1,
  name: 'cheer-s26',
  components: [
    PS(),
    { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 330 } },
    { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'red' } },
    { id: 'R2', type: 'resistor', holes: ['top+8', 'a16'], params: { resistance: 330 } },
    { id: 'LED2', type: 'led', holes: ['b16', 'top-9'], params: { color: 'green' } },
  ],
  wires: PS_WIRES,
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true })

async function open({ width = 1440, height = 900, lang = 'zh-TW', workspace = true, phone = false, reducedMotion = 'no-preference', cheer = true, tag = 'x' } = {}) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion }
      : { viewport: { width, height }, deviceScaleFactor: 1, reducedMotion },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(
    ([lg, ws]) => {
      if (sessionStorage.getItem('cheer.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', lg)
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      sessionStorage.setItem('cheer.seeded', '1')
    },
    [lang, workspace],
  )
  await page.goto(`${URL}?e2e&shotrig${cheer ? '&cheer' : ''}`, { timeout: 180_000 })
  await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig, null, { timeout: 120_000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(1000)
  const a = {
    page,
    errors,
    // each block closes its page: a page left running (its simulation, its renderer) starves the next one's timing
    close: () => ctx.close(),
    shot: async (name) => {
      if (!SHOTS) return
      mkdirSync(SHOTS, { recursive: true })
      await page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`) })
    },
    mod: (file, src, arg) =>
      page.evaluate(
        async ([f, s, ar]) => {
          const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === f) ?? f
          const m = await import(url)
          return await new Function('m', 'a', `return (async () => { ${s} })()`)(m, ar)
        },
        [file, src, arg],
      ),
  }
  a.load = async (layout) => {
    const r = await a.mod('/src/state/store.ts', 'return m.useStore.getState().loadLayout(a)', layout)
    await sleep(900)
    return r
  }
  a.run = () => a.mod('/src/state/store.ts', 'm.useStore.getState().startSim()')
  a.stop = () => a.mod('/src/state/store.ts', 'm.useStore.getState().stopSim()')
  a.reset = () => a.mod('/src/state/store.ts', 'm.useStore.getState().resetSim()')
  a.simTime = () => a.mod('/src/state/store.ts', 'const s = m.useStore.getState(); return s.telemetry ? s.telemetry.time : 0')
  a.until = async (t, budgetMs = 60_000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < budgetMs) {
      const s = await a.simTime()
      if (s >= t) return s
      await sleep(150)
    }
    return -1
  }
  a.cele = () => a.mod('/src/ui/fx/celebrate.ts', 'const s = m.useCelebration.getState(); return { badge: s.badge, count: s.count, suppressed: s.suppressed }')
  a.problems = () => a.mod('/src/ui/embedded/problems.ts', 'return m.useProblems.getState().problems.map((p) => ({ level: p.level, title: p.title, fact: p.fact ?? null }))')
  a.toasts = () => page.evaluate(() => window.__cheerToasts ?? [])
  a.clearToasts = () => page.evaluate(() => (window.__cheerToasts = []))
  a.compScreen = (id, y = 0.6) => page.evaluate(([i, h]) => { const w = window.__e2e.componentWorld(i, h); return w ? window.__shotRig.project(w.x, w.y, w.z) : null }, [id, y])
  a.frame = async (ids, el = 50) => {
    await a.mod('/src/ui/workspace/scene-bridge.ts', 'm.frameTargets({ components: a.ids }, { minElevationDeg: a.el })', { ids, el })
    await sleep(900)
  }
  /** wait until the circuit-ok count reaches n (wall budget); returns the sim time it was seen at, or -1 */
  a.waitOk = async (n, budgetMs = 20_000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < budgetMs) {
      const c = await a.cele()
      if (c.count['circuit-ok'] >= n) return a.simTime()
      await sleep(120)
    }
    return -1
  }
  a.lessonActions = (src) =>
    a.mod(
      '/src/ui/lessons/actions.ts',
      `const L = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/lessons/index.ts') ?? '/src/lessons/index.ts')
       const lesson = L.lessonById('b1-led-resistor')
       ${src}`,
    )
  /** the learner's own R1 (330 Ω) and wires on b1's start circuit */
  a.wireB1ByHand = () =>
    a.mod(
      '/src/state/store.ts',
      `const s = m.useStore.getState()
       s.addComponent('resistor', { holes: ['top+10', 'a14'] })
       const r = m.useStore.getState().layout.components.find((c) => c.type === 'resistor')
       m.useStore.getState().setParam(r.id, 'resistance', 330)
       m.useStore.getState().addWire('a16', 'top-13')
       m.useStore.getState().addWire('DMM1:IN', 'e14')
       m.useStore.getState().addWire('DMM1:COM', 'top-15')
       return m.useStore.getState().layout.wires.length`,
    )
  /** the live confetti quads, projected: [{ x, y, px }] */
  a.confetti = () =>
    page.evaluate(() => {
      const fx = window.__vividFx
      const sys = fx?.soft
      if (!sys) return null
      const out = []
      for (let i = 0; i < sys.live; i++) {
        const sh = sys.baseShape[i]
        if (!(sh >= 2 && sh < 3)) continue
        const p = window.__shotRig.project(sys.pos[i * 3], sys.pos[i * 3 + 1], sys.pos[i * 3 + 2])
        if (p) out.push({ x: p.x, y: p.y, px: -sys.size[i] })
      }
      return out
    })
  /**
   * Where the lesson-pass burst came from: each crisp ring (or, in reduced
   * motion, each still glow) with the placed part whose box holds it (null =
   * a point on the circuit's rim: bare wood / empty holes) and its screen point.
   */
  a.origins = () =>
    page.evaluate(() => {
      const fx = window.__vividFx
      const sys = fx?.soft
      if (!sys) return null
      const boxes = {}
      for (const id of fx.host.ids()) {
        const o = { copy(b) { this.min = { x: b.min.x, z: b.min.z }; this.max = { x: b.max.x, z: b.max.z }; return this }, isEmpty() { return false } }
        if (fx.host.bounds(id, o)) boxes[id] = o
      }
      const out = []
      for (let i = 0; i < sys.live; i++) {
        const sh = sys.baseShape[i]
        if (fx.reduced ? sh !== 0 : sh !== 4) continue
        const x = sys.pos[i * 3]
        const y = sys.pos[i * 3 + 1]
        const z = sys.pos[i * 3 + 2]
        const part = Object.keys(boxes).find((id) => x >= boxes[id].min.x - 0.3 && x <= boxes[id].max.x + 0.3 && z >= boxes[id].min.z - 0.3 && z <= boxes[id].max.z + 0.3) ?? null
        out.push({ part, screen: window.__shotRig.project(x, y, z) })
      }
      return out
    })
  a.fxEvents = () => page.evaluate(() => window.__cheerFx ?? [])
  a.comp = (id) => page.evaluate((i) => window.__e2e.component(i), id)
  a.importProject = async (file) => {
    const txt = readFileSync(path.join(ROOT, file), 'utf8')
    const r = await a.mod('/src/ui/embedded/lab.ts', 'return m.useLab.getState().importProject(a)', txt)
    await sleep(1500)
    return r
  }
  /** every 「電路正常運作 ✓」 cue from now on, with the simulated time and the light of each part it sparkles at THAT moment */
  a.cueLog = () =>
    a.mod(
      '/src/three/internal/fx/bus.ts',
      `const st = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/state/store.ts') ?? '/src/state/store.ts')
       window.__cheerCues = []
       m.onSceneFx((e) => {
         if (e.kind !== 'circuit-ok') return
         const t = st.useStore.getState().telemetry
         const lights = {}
         for (const id of e.componentIds ?? []) lights[id] = t?.components[id]?.light ?? null
         window.__cheerCues.push({ sim: t ? t.time : null, ids: e.componentIds ?? [], lights })
       })`,
    )
  a.cues = () => page.evaluate(() => window.__cheerCues ?? [])
  a.clearCues = () => page.evaluate(() => (window.__cheerCues = []))
  await a.mod('/src/ui/kit/toasts.ts', `window.__cheerToasts = []
     m.subscribeToasts((q) => { for (const t of q) if (!window.__cheerToasts.includes(t.text)) window.__cheerToasts.push(t.text) })`)
  await a.mod('/src/three/internal/fx/bus.ts', `window.__cheerFx = []
     m.onSceneFx((e) => window.__cheerFx.push({ kind: e.kind, ids: e.componentIds, avoid: e.avoid ?? null }))`)
  return a
}

const okToasts = (list) => list.filter((s) => s.startsWith('電路正常運作'))

/** lesson b1 wired by hand → 檢查我的電路; returns the badge box and the confetti seen right after it */
async function handPass(a, label) {
  await a.lessonActions(`await m.loadLessonCircuit(lesson, 'start'); return true`)
  await sleep(600)
  const wires = await a.wireB1ByHand()
  check(wires === 5, `${label}: b1 start circuit wired by hand (R1 + 3 wires)`, wires)
  await sleep(400)
  await a.clearToasts()
  const before = (await a.cele()).count['lesson-pass']
  const fxBefore = (await a.fxEvents()).length
  await a.lessonActions(`await m.runAcceptance(lesson); return true`)
  let seen = false
  for (let i = 0; i < 60 && !seen; i++) {
    // the badge goes up, then (one frame later) the 3D burst aimed clear of its real box
    seen = (await a.page.locator('.fx-cele-badge').count()) > 0 && (await a.fxEvents()).slice(fxBefore).some((e) => e.kind === 'lesson-pass')
    if (!seen) await sleep(30)
  }
  const confetti = await a.confetti() // just after the burst: where each quad started
  const origins = await a.origins()
  const fxEvent = (await a.fxEvents()).slice(fxBefore).find((e) => e.kind === 'lesson-pass') ?? null
  const c = await a.cele()
  check(c.count['lesson-pass'] === before + 1 && c.badge?.title === '完成！', `${label}: a hand-built pass shows 完成！`, JSON.stringify(c.badge))
  const tag = label.replace(/\W+/g, '-')
  if (SHOTS && confetti && confetti.length) {
    // a close look at the burst (≈ 150 ms in)
    const vp = a.page.viewportSize()
    const xs = confetti.map((q) => q.x)
    const ys = confetti.map((q) => q.y)
    const x0 = Math.max(0, Math.min(...xs) - 120)
    const y0 = Math.max(0, Math.min(...ys) - 140)
    const x1 = Math.min(vp.width, Math.max(...xs) + 120)
    const y1 = Math.min(vp.height, Math.max(...ys) + 110)
    await a.page.screenshot({ path: path.join(SHOTS, `${tag}-burst-zoom.png`), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } })
  }
  await a.shot(`${tag}-burst`)
  await sleep(250) // the badge's pop has settled: its real box
  const box = await a.page.locator('.fx-cele-badge').boundingBox().catch(() => null)
  if (box && fxEvent?.avoid) {
    const av = fxEvent.avoid
    const off = Math.max(Math.abs(av.x0 - box.x), Math.abs(av.y0 - box.y), Math.abs(av.x1 - (box.x + box.width)), Math.abs(av.y1 - (box.y + box.height)))
    check(off <= 2, `${label}: the burst avoided the badge's MEASURED box`, `avoid ${JSON.stringify(av)} vs badge ${JSON.stringify(box)}`)
  }
  check(!!origins && origins.length > 0 && origins.every((o) => o.part !== null), `${label}: every fountain / glow sits on a working part (none on bare wood / empty holes)`, JSON.stringify(origins?.map((o) => o.part)))
  if (origins && box) {
    const hidden = origins.filter((o) => o.screen && o.screen.x > box.x && o.screen.x < box.x + box.width && o.screen.y > box.y && o.screen.y < box.y + box.height)
    check(hidden.length === 0, `${label}: no fountain behind the badge`, hidden.length)
  }
  return { box, confetti, origins, fxEvent }
}

// ---------------------------------------------------------------------------
if (ONLY.includes('desktop')) {
  const a = await open({ tag: 'd' })
  const { page } = a

  // ---- s29: an LED at 21 mA (warning) → no cheer
  check((await a.load(ledCircuit(150, 'cheer-s29'))).ok, 's29: LED + 150 Ω loads')
  await a.frame(['R1', 'LED1'], 50)
  await a.run()
  await a.until(3.5)
  await sleep(600)
  const p29 = await a.problems()
  check(p29.some((p) => p.level === 'warning' && /LED1/.test(p.title)), 's29: Problems warns about LED1', p29.map((p) => p.title).join(' | '))
  check((await a.cele()).count['circuit-ok'] === 0 && okToasts(await a.toasts()).length === 0, 's29: no 「電路正常運作 ✓」 while LED1 is warned about', (await a.toasts()).join(' | '))
  await a.shot('s29-21mA-no-cheer')
  await a.reset()

  // ---- a real working LED → the cheer, after the window
  await a.clearToasts()
  check((await a.load(ledCircuit(330, 'cheer-ok'))).ok, 'ok: LED + 330 Ω loads')
  await a.run()
  const firedAt = await a.waitOk(1)
  check(firedAt >= 1.2, 'ok: 「電路正常運作 ✓」 fires — only after ≥ 1.2 s of simulated time', firedAt)
  await sleep(250)
  check(okToasts(await a.toasts()).includes('電路正常運作 ✓ · LED1 亮了'), 'ok: the toast names what works', (await a.toasts()).join(' | '))
  await a.shot('ok-330-cheer')
  await a.reset()

  // ---- s14: a reversed electrolytic vents → no cheer
  await a.clearToasts()
  const okBefore14 = (await a.cele()).count['circuit-ok']
  check((await a.load(REVERSED_CAP)).ok, 's14: reversed capacitor circuit loads')
  await a.frame(['R1', 'R2', 'LED1', 'C1'], 50)
  await sleep(400)
  // before Run: the static ERC already says it (the pill / Problems), so nothing can cheer beside it
  const p14static = await a.problems()
  check(p14static.some((p) => p.level === 'error' && p.title === 'C1 電解電容接反了' && p.fact === 'reversed:C1'), 's14: before Run, Problems says 「C1 電解電容接反了」 (error)', p14static.map((p) => `${p.level}:${p.title}`).join(' | '))
  await a.shot('s14-static-before-run')
  await a.run()
  await a.until(6)
  await sleep(1200)
  const p14 = await a.problems()
  check(p14.some((p) => p.fact === 'vented:C1'), 's14: Problems says C1 vented', p14.map((p) => p.title).join(' | '))
  check(!p14.some((p) => p.fact === 'reversed:C1'), 's14: after the vent ONE row for C1 (「C1 反接爆開」 replaced the warning)', p14.map((p) => p.title).join(' | '))
  check((await a.cele()).count['circuit-ok'] === okBefore14 && okToasts(await a.toasts()).length === 0, 's14: no cheer around a venting capacitor', (await a.toasts()).join(' | '))
  await a.shot('s14-vented-no-cheer')
  await a.reset()

  // ---- s26: Delete on a working circuit → no second cheer
  await a.clearToasts()
  check((await a.load(TWO_LEDS)).ok, 's26: two LEDs load')
  await a.frame(['R1', 'LED1', 'R2', 'LED2'], 55)
  const okBefore26 = (await a.cele()).count['circuit-ok']
  await page.keyboard.press('Space')
  check((await a.waitOk(okBefore26 + 1)) >= 1.2, 's26: the working circuit cheers once')
  await sleep(3600) // the first toast leaves
  await a.clearToasts()
  const p = await a.compScreen('LED2')
  await page.mouse.click(p.x, p.y)
  await sleep(400)
  await page.keyboard.press('Delete')
  await sleep(300)
  const tDel = await a.simTime()
  const left = await a.mod('/src/state/store.ts', 'return m.useStore.getState().layout.components.map((c) => c.id)')
  check(!left.includes('LED2'), 's26: Delete removed LED2 at once', left.join(','))
  await a.until(tDel + 3)
  await sleep(1200)
  check((await a.cele()).count['circuit-ok'] === okBefore26 + 1, 's26: no second cheer after the delete', (await a.toasts()).join(' | '))
  check(okToasts(await a.toasts()).length === 0, 's26: no 「電路正常運作」 toast after the delete')
  await a.shot('s26-after-delete')
  await a.reset()

  // ---- s26 inside the first window: Delete while both LEDs are lit but before the cheer could land
  await a.clearToasts()
  check((await a.load(TWO_LEDS)).ok, 's26-early: two LEDs load')
  await a.frame(['R1', 'LED1', 'R2', 'LED2'], 55)
  const okBeforeEarly = (await a.cele()).count['circuit-ok']
  const pe = await a.compScreen('LED2')
  await page.mouse.click(pe.x, pe.y) // select LED2 (stopped)
  await sleep(300)
  await page.keyboard.press('Space')
  let both = null
  for (let i = 0; i < 80; i++) {
    both = await a.mod('/src/state/store.ts', 'const t = m.useStore.getState().telemetry; return t ? { t: t.time, l1: t.components.LED1?.light ?? 0, l2: t.components.LED2?.light ?? 0 } : null')
    if (both && both.l1 >= 0.05 && both.l2 >= 0.05 && both.t >= 0.3) break
    await sleep(40)
  }
  await page.keyboard.press('Delete')
  await sleep(150)
  const tEarly = await a.simTime()
  const leftEarly = await a.mod('/src/state/store.ts', 'return m.useStore.getState().layout.components.map((c) => c.id)')
  check(!!both && both.l1 >= 0.05 && both.l2 >= 0.05, 's26-early: both LEDs were lit before the delete', JSON.stringify(both))
  check(!leftEarly.includes('LED2') && tEarly < 1.2 && (await a.cele()).count['circuit-ok'] === okBeforeEarly, 's26-early: LED2 deleted inside the first window, no cheer yet', `sim ${tEarly.toFixed(2)} s`)
  await a.until(tEarly + 3.5)
  await sleep(600)
  const pEarly = await a.problems()
  check((await a.cele()).count['circuit-ok'] === okBeforeEarly && okToasts(await a.toasts()).length === 0, 's26-early: no 「電路正常運作 ✓」 after the delete (LED1 was already lit)', (await a.toasts()).join(' | '))
  check(pEarly.some((p) => /R2/.test(p.title)), 's26-early: the pill / Problems say R2 dangles', pEarly.map((p) => p.title).join(' | '))
  await a.shot('s26-early-after-delete')
  await page.keyboard.press('Control+z')
  await sleep(300)
  const tUndo = await a.simTime()
  const backEarly = await a.mod('/src/state/store.ts', 'return m.useStore.getState().layout.components.map((c) => c.id)')
  check(backEarly.includes('LED2'), 's26-early: Ctrl+Z brought LED2 back', backEarly.join(','))
  await a.until(tUndo + 3)
  await sleep(600)
  check((await a.cele()).count['circuit-ok'] === okBeforeEarly && okToasts(await a.toasts()).length === 0, 's26-early: no cheer after Ctrl+Z either (LED2 was already lit)', (await a.toasts()).join(' | '))
  await a.shot('s26-early-after-undo')
  await a.reset()

  // ---- s10: 課程 → 初級 1 → 載入完整答案 → 檢查我的電路
  await a.clearToasts()
  await page.locator('.ws-tabs').getByText('課程', { exact: true }).click()
  await sleep(700)
  await page.getByRole('button', { name: /初級 1 · LED 與限流電阻/ }).first().click()
  await sleep(1200)
  await page.getByRole('button', { name: '載入完整答案' }).first().click()
  await sleep(1500)
  const passBefore = (await a.cele()).count['lesson-pass']
  await page.getByRole('button', { name: '檢查我的電路' }).first().click()
  let solved = false
  for (let i = 0; i < 60 && !solved; i++) {
    solved = await a.mod('/src/ui/lessons/state.ts', "const r = m.useLessonUi.getState().runs['b1-led-resistor|acceptance']; return !!r && r.status === 'done'")
    if (!solved) await sleep(250)
  }
  await sleep(500)
  const c10 = await a.cele()
  const t10 = await a.toasts()
  check(solved, 's10: the acceptance run finished')
  check(c10.count['lesson-pass'] === passBefore && c10.badge === null, 's10: a pass with the loaded answer → no 完成！ badge / confetti / chime', JSON.stringify(c10))
  check((await page.locator('.fx-cele-badge').count()) === 0, 's10: no badge on screen')
  check(t10.some((s) => s.includes('但用的是載入的解答')), 's10: the toast says the pass used the loaded answer', t10.join(' | '))
  check(!t10.some((s) => s.startsWith('課程完成')), 's10: no 「課程完成」 toast for the loaded answer')
  await sleep(400)
  // every surface says the same (final walkthrough): the 驗收 headline and the coach's pass line
  const screen10 = await page.evaluate(() => document.body.innerText)
  check(screen10.includes('全部 6 項條件都通過（用的是載入的解答）'), 's10: the 驗收 headline / coach line say 「全部 6 項條件都通過（用的是載入的解答）」')
  check(!screen10.includes('課程完成'), 's10: 「課程完成」 is nowhere on screen for the answer’s pass')
  const coachLine = await page.locator('.lsn-coach-pass').first().innerText().catch(() => '')
  check(coachLine.includes('用的是載入的解答') && coachLine.includes('載入起始電路，自己接一次'), 's10: the coach card offers the honest next step', coachLine.replace(/\n/g, ' / '))
  const build = page.getByRole('button', { name: '載入起始電路，自己接一次' })
  check((await build.count()) >= 1, 's10: 〔載入起始電路，自己接一次〕 is on screen')
  await a.shot('s10-solution-pass-calm')
  await a.clearToasts()
  await build.first().click()
  await sleep(1500)
  const after10 = await a.mod('/src/state/store.ts', 'return m.useStore.getState().layout.components.map((c) => c.type)')
  const coach10 = await a.mod('/src/ui/lessons/state.ts', 'return m.useLessonUi.getState().coachId')
  check(!after10.includes('resistor') && coach10 === 'b1-led-resistor', 's10: … it loads b1’s starting circuit and guides step 1', `${after10.join(',')} coach ${coach10}`)
  check((await a.toasts()).includes('已載入「LED 與限流電阻」的起始電路'), 's10: … at once, with the 〔復原〕 toast (no question)', (await a.toasts()).join(' | '))
  check(!(await page.evaluate(() => document.body.innerText)).includes('用的是載入的解答）'), 's10: … and the answer’s pass is gone from the panel and the coach')
  await a.shot('s10-build-it-yourself')

  // ---- b1 wired by hand → 完成！ + confetti, no duplicate toast
  await sleep(5600) // the answer's toast leaves first
  const { box, confetti } = await handPass(a, 'b1')
  check(!!box && box.width > 200, 'b1: the badge is on screen', JSON.stringify(box))
  check(!!confetti && confetti.length >= 40, 'b1: confetti quads are flying', confetti?.length)
  if (confetti && confetti.length && box) {
    const inside = confetti.filter((q) => q.x > box.x && q.x < box.x + box.width && q.y > box.y && q.y < box.y + box.height)
    check(inside.length <= confetti.length * 0.1, 'b1: the confetti does not burst from behind the badge', `${inside.length} of ${confetti.length} behind it`)
    const px = confetti.map((q) => q.px)
    check(Math.min(...px) >= 11 && Math.max(...px) <= 16, 'b1: confetti sprites 11–16 px (quads 9–13 px long)', `${Math.min(...px).toFixed(1)}–${Math.max(...px).toFixed(1)}`)
  }
  await a.shot('b1-pass-falling')
  const tb1 = await a.toasts()
  check(!tb1.some((s) => s.startsWith('課程完成')), 'b1: no duplicate 「課程完成…」 toast beside the badge', tb1.join(' | '))
  await sleep(1300)
  const left2 = await a.confetti()
  check(left2 !== null && left2.length === 0, 'b1: the confetti is gone after ~1.5 s', left2?.length)
  await sleep(2600)

  // ---- the blink example: Blue Pill firmware toggling PC13 + LED1
  await a.clearToasts()
  const okBeforeBlink = (await a.cele()).count['circuit-ok']
  const proj = readFileSync(path.join(ROOT, 'examples/embedded/blink.ohmlet.json'), 'utf8')
  const imp = await a.mod('/src/ui/embedded/lab.ts', 'return m.useLab.getState().importProject(a)', proj)
  check(!!imp && imp.ok !== false, 'blink: the example imports', JSON.stringify(imp).slice(0, 160))
  await sleep(1500)
  await a.run()
  const firedBlink = await a.waitOk(okBeforeBlink + 1, 40_000)
  check(firedBlink >= 1.2, 'blink: the running example cheers 「電路正常運作 ✓」', firedBlink)
  await sleep(200)
  const tb = okToasts(await a.toasts())
  check(tb.length === 1 && /亮了|切換/.test(tb[0]), 'blink: the toast names what works', tb.join(' | '))
  const pb = await a.problems()
  check(!pb.some((x) => x.level === 'error'), 'blink: no error listed when it cheered', pb.map((x) => x.title).join(' | '))
  await a.shot('blink-cheer')
  await a.reset()
  check(a.errors.length === 0, 'desktop: no page errors', a.errors.join(' | '))
  await a.close()
}

// ---------------------------------------------------------------------------
if (ONLY.includes('phone')) {
  const a = await open({ width: 390, height: 844, workspace: false, phone: true, tag: 'p' })
  const { box, confetti } = await handPass(a, 'phone')
  check(!!box && box.x >= 0 && box.x + box.width <= 390, 'phone: the badge fits the screen', JSON.stringify(box))
  if (confetti && confetti.length && box) {
    const inside = confetti.filter((q) => q.x > box.x && q.x < box.x + box.width && q.y > box.y && q.y < box.y + box.height)
    check(inside.length <= confetti.length * 0.1, 'phone: the confetti does not burst from behind the badge', `${inside.length} of ${confetti.length}`)
  }
  await sleep(300)
  await a.shot('b1-pass-confetti')
  check(a.errors.length === 0, 'phone: no page errors', a.errors.join(' | '))
  await a.close()
}

// ---------------------------------------------------------------------------
if (ONLY.includes('reduced')) {
  const a = await open({ reducedMotion: 'reduce', tag: 'r' })
  const { confetti } = await handPass(a, 'reduced motion')
  check(confetti !== null && confetti.length === 0, 'reduced motion: no flying confetti (a still glow + the badge)', confetti?.length)
  await sleep(300)
  await a.shot('b1-pass-static')
  check(a.errors.length === 0, 'reduced: no page errors', a.errors.join(' | '))
  await a.close()
}

// ---------------------------------------------------------------------------
if (ONLY.includes('classic')) {
  const a = await open({ lang: 'en', workspace: false, tag: 'c' })
  check((await a.load(ledCircuit(330, 'cheer-classic'))).ok, 'classic: LED + 330 Ω loads')
  await a.run()
  const at = await a.waitOk(1)
  check(at >= 1.2, 'classic: the 3D cue fires after the window', at)
  await sleep(300)
  check(!(await a.toasts()).some((s) => /working/i.test(s)), 'classic chrome: no toast (original UI)', (await a.toasts()).join(' | '))
  check(a.errors.length === 0, 'classic: no page errors', a.errors.join(' | '))
  await a.close()
}

// ---------------------------------------------------------------------------
if (ONLY.includes('harness')) {
  const a = await open({ cheer: false, tag: 'h' })
  check((await a.load(ledCircuit(330, 'cheer-harness'))).ok, 'harness: LED + 330 Ω loads')
  await a.run()
  await a.until(3)
  await sleep(800)
  const c = await a.cele()
  check(c.count['circuit-ok'] === 0 && okToasts(await a.toasts()).length === 0, '?shotrig: no circuit-ok toast / sparkle', JSON.stringify(c))
  await a.reset()
  await handPassHarness(a)
  check(a.errors.length === 0, 'harness: no page errors', a.errors.join(' | '))
  await a.close()
}

// ---------------------------------------------------------------------------
// M1 (final walkthrough w14 / w13 / w4): the cue is re-verified when it plays —
// what a released button turned dark is never 「亮了」, presses are not 「在切換」
if (ONLY.includes('m1')) {
  const a = await open({ tag: 'm1' })
  const { page } = a
  await a.cueLog()

  // ---- w14: npn-switch, SW1 held ~1 s with the mouse → the LED lights only while held: no cue
  const imp = await a.importProject('examples/embedded/npn-switch.ohmlet.json')
  check(!!imp && imp.ok !== false, 'm1 w14: the npn-switch example opens', JSON.stringify(imp).slice(0, 120))
  await a.frame(['SW1', 'LED1', 'Q1'], 45)
  await page.keyboard.press('Space')
  await a.until(1.0)
  const sw = await a.compScreen('SW1', 0.9)
  await page.mouse.move(sw.x, sw.y)
  await page.mouse.down()
  await sleep(1000)
  const litHeld = (await a.comp('LED1'))?.light ?? 0
  await page.mouse.up()
  const tUp = await a.simTime()
  check(litHeld >= 0.05, 'm1 w14: holding SW1 lights LED1', litHeld)
  await a.until(tUp + 3.5)
  await sleep(400)
  const cues14 = await a.cues()
  check(cues14.length === 0, 'm1 w14: no 「電路正常運作 ✓」 after a ~1 s press (the LED went dark with the release)', JSON.stringify(cues14))
  check(okToasts(await a.toasts()).length === 0, 'm1 w14: no cue toast', (await a.toasts()).join(' | '))
  check(((await a.comp('LED1'))?.light ?? 1) < 0.05, 'm1 w14: LED1 is dark again')
  await a.shot('m1-w14-no-cue-after-press')

  // ---- M1 verification: a finger holding SW1 just PAST the window (1.3 / 1.4 / 1.7 / 2.5 s — the cue once
  // came 20 ms before the release and the toast then sat over the dark LED): no cue while held, none after
  for (const holdMs of [1300, 1400, 1700, 2500]) {
    await a.clearToasts()
    await a.clearCues()
    await page.mouse.move(sw.x, sw.y)
    const tDown = await a.simTime()
    await page.mouse.down()
    let lit = 0
    const t0 = Date.now()
    while (Date.now() - t0 < holdMs) {
      await sleep(100)
      lit = Math.max(lit, (await a.comp('LED1'))?.light ?? 0)
    }
    const cuesHeld = await a.cues()
    await page.mouse.up()
    const up = await a.simTime()
    check(lit >= 0.05 && up - tDown >= 1.2, `m1 hold ${holdMs} ms: the finger lit LED1 for ${(up - tDown).toFixed(2)} s simulated (past the 1.2 s window)`, lit)
    check(cuesHeld.length === 0, `m1 hold ${holdMs} ms: no 「電路正常運作 ✓」 while the finger holds SW1`, JSON.stringify(cuesHeld))
    await a.until(up + 3)
    await sleep(300)
    const after = await a.cues()
    check(after.length === 0 && okToasts(await a.toasts()).length === 0, `m1 hold ${holdMs} ms: none after the release either (LED1 went dark with it)`, JSON.stringify(after) + ' ' + (await a.toasts()).join(' | '))
    check(((await a.comp('LED1'))?.light ?? 1) < 0.05, `m1 hold ${holdMs} ms: LED1 is dark again`)
    if (holdMs === 1300 || holdMs === 2500) await a.shot(`m1-hold-${holdMs}-after-release`)
  }

  // ---- … 保持按下 (a steady state: the inspector's switch, a real click): the cue plays WHILE LED1 is lit, and it stays lit
  await a.clearToasts()
  await a.clearCues()
  await a.mod('/src/state/store.ts', "m.useStore.getState().select('SW1')")
  await sleep(600)
  const keep = page.getByRole('switch', { name: /保持按下/ }).first()
  check((await keep.count()) > 0, 'm1 kept: the inspector offers 保持按下')
  await keep.click()
  const kept = await a.mod('/src/state/store.ts', "return m.useStore.getState().layout.components.find((c) => c.id === 'SW1')?.params?.pressed === true")
  check(kept === true, 'm1 kept: SW1 is kept pressed', kept)
  const at = await a.waitOk(1, 20_000)
  const cue = (await a.cues())[0] ?? null
  if (cue) await a.shot('m1-kept-cue-while-lit')
  check(at > 0 && !!cue && cue.lights.LED1 >= 0.05, 'm1 kept: 保持按下 cheers while LED1 is lit', JSON.stringify(cue))
  check(okToasts(await a.toasts()).includes('電路正常運作 ✓ · LED1 亮了'), 'm1 kept: the toast names the lit LED', (await a.toasts()).join(' | '))
  await a.until((await a.simTime()) + 2)
  check(((await a.comp('LED1'))?.light ?? 0) >= 0.05, 'm1 kept: … and LED1 is still lit 2 s later (the toast never outlives the light)')
  check((await a.cues()).length === 1, 'm1 kept: … once', JSON.stringify(await a.cues()))
  await a.mod('/src/ui/embedded/latch.ts', "return m.setLatched('SW1', false)")
  await a.reset()

  // ---- w4: button-exti — a click toggles PA5 (LED1 on), then 保持按下 toggles it back (LED1 off)
  await a.clearCues()
  await a.clearToasts()
  const imp4 = await a.importProject('examples/embedded/button-exti.ohmlet.json')
  check(!!imp4 && imp4.ok !== false, 'm1 w4: the button-exti example opens', JSON.stringify(imp4).slice(0, 120))
  await a.frame(['SW1', 'R1', 'LED1', 'U1'], 45)
  await page.keyboard.press('Space')
  await a.until(1.0)
  await sleep(500)
  const sw4 = await a.compScreen('SW1', 0.9)
  await page.mouse.click(sw4.x, sw4.y)
  await sleep(1000)
  const on4 = (await a.comp('LED1'))?.light ?? 0
  check(on4 >= 0.05, 'm1 w4: the click turned LED1 on (EXTI toggles PA5)', on4)
  await a.mod('/src/ui/embedded/latch.ts', "return m.setLatched('SW1', true)")
  await sleep(4500)
  const cues4 = await a.cues()
  const off4 = (await a.comp('LED1'))?.light ?? 0
  const lies = cues4.filter((c) => c.ids.includes('LED1') && !(c.lights.LED1 >= 0.05))
  check(lies.length === 0, 'm1 w4: no cue sparkles / names a dark LED1', JSON.stringify(cues4))
  check(!okToasts(await a.toasts()).some((x) => /PA5 在切換/.test(x)), 'm1 w4: two presses are never 「U1 的 PA5 在切換」', (await a.toasts()).join(' | '))
  check(off4 < 0.05, 'm1 w4: 保持按下 (the second press) turned LED1 off', off4)
  await a.shot('m1-w4-after-keep')
  await a.mod('/src/ui/embedded/latch.ts', "return m.setLatched('SW1', false)")
  await a.reset()
  check(a.errors.length === 0, 'm1: no page errors', a.errors.join(' | '))
  await a.close()
}

// ---------------------------------------------------------------------------
// M1 on a phone (w13): long-pressing the running SW1 to open its sheet presses it for ~0.9 s
if (ONLY.includes('m1phone')) {
  const a = await open({ width: 390, height: 844, workspace: false, phone: true, tag: 'm1p' })
  const { page } = a
  await a.cueLog()
  await a.importProject('examples/embedded/npn-switch.ohmlet.json')
  await a.frame(['SW1', 'LED1', 'Q1'], 45)
  await a.run()
  await a.until(1.0)
  const sw = await a.compScreen('SW1', 0.9)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sw.x, y: sw.y }] })
  await sleep(900)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const tUp = await a.simTime()
  await a.until(tUp + 3.5)
  await sleep(400)
  const cues = await a.cues()
  check(cues.every((c) => !c.ids.includes('LED1') || c.lights.LED1 >= 0.05), 'm1 phone w13: a 0.9 s long-press never gets a cue over a dark LED', JSON.stringify(cues))
  check(okToasts(await a.toasts()).length === 0, 'm1 phone w13: no cue toast after the long-press', (await a.toasts()).join(' | '))
  await a.shot('m1-w13-after-longpress')
  // a finger on SW1 for 2.5 s (well past the window): nothing while held, nothing after
  // (the sheet the first long-press opened goes first: a touch on the board would only close it)
  await a.mod('/src/state/store.ts', 'm.useStore.getState().clearSelection()')
  await sleep(800)
  await a.clearCues()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sw.x, y: sw.y }] })
  await sleep(2500)
  const heldCues = await a.cues()
  const litHeld = (await a.comp('LED1'))?.light ?? 0
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const tUp2 = await a.simTime()
  check(litHeld >= 0.05 && heldCues.length === 0, 'm1 phone: a 2.5 s finger hold lights LED1 and gets no cue while held', `${litHeld} ${JSON.stringify(heldCues)}`)
  await a.until(tUp2 + 3)
  await sleep(300)
  check((await a.cues()).length === 0 && okToasts(await a.toasts()).length === 0, 'm1 phone: … nor after the release', JSON.stringify(await a.cues()))
  // 保持按下 from the sheet the long-press opened (a real tap): the steady state cheers while LED1 is lit
  const keep = page.getByText('保持按下', { exact: true }).first()
  if ((await keep.count()) === 0) await a.mod('/src/state/store.ts', "m.useStore.getState().select('SW1')")
  await sleep(500)
  const kb = await page.getByText('保持按下', { exact: true }).first().boundingBox()
  check(!!kb, 'm1 phone: SW1’s sheet offers 保持按下')
  if (kb) await page.touchscreen.tap(kb.x + kb.width / 2, kb.y + kb.height / 2)
  const at = await a.waitOk(1, 20_000)
  const cue = (await a.cues())[0] ?? null
  if (cue) await a.shot('m1-phone-kept-cue')
  check(at > 0 && !!cue && cue.lights.LED1 >= 0.05, 'm1 phone: 保持按下 cheers while LED1 is lit', JSON.stringify(cue))
  check(a.errors.length === 0, 'm1 phone: no page errors', a.errors.join(' | '))
  await a.close()
}

// ---------------------------------------------------------------------------
// M2 (integration with the simulation owner's fix): a correctly placed 100 µF electrolytic across
// the 5 V rails beside a working LED — no false 「PS1 輸出超過 2 A」, and the circuit cheers ONCE
if (ONLY.includes('m2')) {
  const a = await open({ tag: 'm2' })
  await a.cueLog()
  check((await a.load(BULK_CAP)).ok, 'm2: LED + 330 Ω + 100 µF (+ on the + rail) loads')
  await a.frame(['R1', 'LED1', 'C1'], 50)
  const pre = await a.problems()
  check(pre.length === 0, 'm2: no problem before Run', pre.map((p) => `${p.level}:${p.title}`).join(' | '))
  await a.run()
  const at = await a.waitOk(1, 25_000)
  const pm = await a.problems()
  check(!pm.some((p) => /PS1/.test(p.title) && /2 A|短路/.test(p.title)), 'm2: no false 「PS1 輸出超過 2 A」 from the capacitor’s charging surge', pm.map((p) => `${p.level}:${p.title}`).join(' | '))
  check(at >= 1.2, 'm2: the 100 µF + LED circuit cheers 「電路正常運作 ✓」', at)
  await a.until((await a.simTime()) + 3)
  await sleep(500)
  check((await a.cele()).count['circuit-ok'] === (at >= 1.2 ? 1 : 0) && (await a.cues()).length <= 1, 'm2: … exactly once', JSON.stringify(await a.cues()))
  await a.shot('m2-bulk-cap')
  check(a.errors.length === 0, 'm2: no page errors', a.errors.join(' | '))
  await a.close()
}

async function handPassHarness(a) {
  await a.lessonActions(`await m.loadLessonCircuit(lesson, 'start'); return true`)
  await sleep(600)
  await a.wireB1ByHand()
  await sleep(400)
  await a.clearToasts()
  await a.lessonActions(`await m.runAcceptance(lesson); return true`)
  await sleep(400)
  const c = await a.cele()
  check(c.badge === null && c.count['lesson-pass'] === 0 && (await a.page.locator('.fx-cele-badge').count()) === 0, '?shotrig: a lesson pass shows no badge / confetti', JSON.stringify(c))
  check((await a.toasts()).includes('課程完成——全部 6 項驗收條件都通過。'), '?shotrig: the original pass toast stays (deterministic, as before)', (await a.toasts()).join(' | '))
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
