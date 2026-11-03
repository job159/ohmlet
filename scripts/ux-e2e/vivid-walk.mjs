/**
 * Component realism and feedback (owner: vivid) — replay of the product
 * owner's request (「LED 要非常區別性的亮度…若弄壞要有明顯壞掉的感覺，線路正常
 * 運作要有成功喝采的感覺」):
 *
 *   UX_E2E_URL=http://localhost:5413/ UX_E2E_SHOTS=<dir> node scripts/ux-e2e/vivid-walk.mjs
 *
 * A fresh zh-TW profile with the desktop workspace (1440×900, mouse):
 *   A. LED ladder on 5 V — 220 Ω / 1 kΩ / 10 kΩ / 120 Ω (over-driven): the
 *      telemetry `light` (I / 20 mA) is ≈ 0.70 / 0.16 / 0.016 / > 1, the
 *      over-driven one registers its flicker animator; A'. an LED with no
 *      resistor burns (pop + smoke shot), charred with soot and cracks,
 *      Problems shows the burn-out and NO circuit-ok cue fires (an error is
 *      listed, although the other LED is lit);
 *   B. resistor overload on 12 V — 150 Ω (3.8× its ¼ W rating: hot, smoking,
 *      keeps conducting) and 10 Ω (14.4 W: glows, then burns OPEN — its
 *      current stops); the Problems row 「R2 燒斷了」 with the fix and
 *      〔換新〕; 〔換新〕 puts a new R2 in at once (it conducts again — no edit,
 *      no reset) and, the overload still there, it burns open again;
 *   C. the dc-motor-l298n example: the motor turns (rpm), circuit-ok cue;
 *   D. the blink example: the 「電路正常運作 ✓」 toast once (no repeat on the
 *      same revision), naming what is true when it plays;
 *   E. lesson b1 wired BY HAND passes the acceptance → the 「完成！」 badge (a
 *      pass with the loaded answer does not celebrate — cheer-honesty.mjs s10);
 *   F. a free LED + 220 Ω circuit → 「電路正常運作 ✓」;
 *   G. 5 V into the Blue Pill's PA0 through 100 Ω: the red pin-damage marker
 *      and the Problems row saying the chip may be damaged and the simulation
 *      no longer guarantees U1's behaviour;
 * then a 390×844 phone (touch): the LED ladder look and the b1 badge fits,
 * and the English classic chrome: 3D realism yes, no badge / toast.
 * The page boots with ?e2e&shotrig&cheer: under ?shotrig alone the
 * celebrations are off (the visual-regression harness, F12). A cue is honest
 * only after CHEER_WINDOW_S (1.2 s) of SIMULATED time with nothing edited in
 * between, so every expected cue is waited for (waitOk) — never assumed after
 * a fixed sleep.
 * Exit code 1 on any failed check.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(cond, what, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${extra !== '' ? `  (${extra})` : ''}`)
  if (!cond) failures++
  return cond
}

const PS = [
  { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
]
const PS_WIRES = [
  { id: 'W1', from: 'PS1:+', to: 'top+0' },
  { id: 'W2', from: 'PS1:-', to: 'top-0' },
]

const LED_LADDER = {
  version: 1,
  name: 'vivid-leds',
  components: [
    ...PS,
    { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 220 } },
    { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'red' } },
    { id: 'R2', type: 'resistor', holes: ['top+8', 'a16'], params: { resistance: 1000 } },
    { id: 'LED2', type: 'led', holes: ['b16', 'top-9'], params: { color: 'red' } },
    { id: 'R3', type: 'resistor', holes: ['top+13', 'a22'], params: { resistance: 10000 } },
    { id: 'LED3', type: 'led', holes: ['b22', 'top-14'], params: { color: 'red' } },
    { id: 'R4', type: 'resistor', holes: ['top+18', 'a28'], params: { resistance: 120 } },
    { id: 'LED4', type: 'led', holes: ['b28', 'top-19'], params: { color: 'red' } },
  ],
  wires: PS_WIRES,
}

/** an LED straight across the rails (its own supply: the burned die keeps conducting and loads PS1) */
const LED_BURN = {
  version: 1,
  name: 'vivid-burn',
  components: [
    ...PS,
    { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 220 } },
    { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'red' } },
    { id: 'LED5', type: 'led', holes: ['top+9', 'top-10'], params: { color: 'red' } },
  ],
  wires: PS_WIRES,
}

/** 12 V across ¼ W resistors: 150 Ω = 0.96 W (3.8×, hot), 10 Ω = 14.4 W (58×, burns) */
const OVERLOAD = {
  version: 1,
  name: 'vivid-overload',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 12 } },
    { id: 'R1', type: 'resistor', holes: ['top+6', 'top-6'], params: { resistance: 150 } },
    { id: 'R2', type: 'resistor', holes: ['top+14', 'top-14'], params: { resistance: 10 } },
  ],
  wires: PS_WIRES,
}

const FREE_LED = {
  version: 1,
  name: 'vivid-free',
  components: [
    ...PS,
    { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 220 } },
    { id: 'LED1', type: 'led', holes: ['b10', 'top-4'], params: { color: 'green' } },
  ],
  wires: PS_WIRES,
}

/** 5 V into the Blue Pill's PA0 (not 5 V tolerant) through 100 Ω: beyond its absolute maximum */
const ABSMAX = {
  version: 1,
  name: 'vivid-absmax',
  components: [
    ...PS,
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', holes: ['top+20', 'a25'], params: { resistance: 100 } },
  ],
  wires: [...PS_WIRES, { id: 'W3', from: 'top+2', to: 'j27' }, { id: 'W4', from: 'j28', to: 'top-2' }],
}

const browser = await chromium.launch({ channel: CHANNEL, headless: true })
/** VIVID_ONLY=desktop,phone,classic — run only these blocks */
const ONLY = (process.env.VIVID_ONLY ?? 'desktop,phone,reduced,classic').split(',')

async function open({ width, height, lang = 'zh-TW', workspace = true, phone = false, reducedMotion = 'no-preference' }) {
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
      if (sessionStorage.getItem('vivid.seeded')) return
      localStorage.clear()
      localStorage.setItem('bb.onboarded', '1')
      localStorage.setItem('bb.renderMode', 'performance')
      localStorage.setItem('bb.lang', lg)
      localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
      for (const k of ['bb.hintShrink', 'bb.studioPhoneWarned']) localStorage.setItem(k, '1')
      sessionStorage.setItem('vivid.seeded', '1')
    },
    [lang, workspace],
  )
  // &cheer: celebrations on (?shotrig alone switches them off for the visual-regression shots)
  await page.goto(`${URL}?e2e&shotrig&cheer`, { timeout: 180_000 })
  await page.waitForFunction(() => !!window.__e2e && !!window.__shotRig, null, { timeout: 120_000 })
  await page.evaluate(() => window.__e2e.ready())
  await sleep(1200)
  const tag = `${width}${lang === 'en' ? '-en' : ''}`
  const api = {
    page,
    errors,
    /** each block is one tab: close it before the next opens (integrator, round 5 final — with every
     *  earlier block's WebGL scene still rendering, the 4th / 5th page stalled for seconds, once for good) */
    close: () => ctx.close(),
    shot: async (name) => {
      if (!SHOTS) return
      mkdirSync(SHOTS, { recursive: true })
      await page.screenshot({ path: path.join(SHOTS, `vivid-${tag}-${name}.png`) })
    },
    /** run `src` with the app's OWN module instance of `file` bound to `m` */
    mod: (file, src, arg) =>
      page.evaluate(
        async ([f, s, a]) => {
          const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === f) ?? f
          const m = await import(url)
          return await new Function('m', 'a', `return (async () => { ${s} })()`)(m, a)
        },
        [file, src, arg],
      ),
    load: async (layout) => {
      const r = await api.mod('/src/state/store.ts', 'return m.useStore.getState().loadLayout(a)', layout)
      await sleep(900)
      return r
    },
    run: () => api.mod('/src/state/store.ts', 'm.useStore.getState().startSim()'),
    stop: () => api.mod('/src/state/store.ts', 'm.useStore.getState().stopSim()'),
    reset: () => api.mod('/src/state/store.ts', 'm.useStore.getState().resetSim()'),
    simTime: () => api.mod('/src/state/store.ts', 'return m.useStore.getState().simTime'),
    /** wait until the simulation reached `t` seconds (or the wall budget ran out) */
    until: async (t, budgetMs = 30_000) => {
      const t0 = Date.now()
      while (Date.now() - t0 < budgetMs) {
        const s = await api.mod('/src/state/store.ts', 'const s = m.useStore.getState(); return s.telemetry ? s.telemetry.time : 0')
        if (s >= t) return s
        await sleep(150)
      }
      return api.simTime()
    },
    comp: (id) => page.evaluate((i) => window.__e2e.component(i), id),
    problems: () => api.mod('/src/ui/embedded/problems.ts', 'return m.useProblems.getState().problems.map((p) => ({ level: p.level, title: p.title, detail: p.detail, fact: p.fact ?? null }))'),
    cele: () => api.mod('/src/ui/fx/celebrate.ts', 'const s = m.useCelebration.getState(); return { badge: s.badge, count: s.count }'),
    /** every toast text shown since the page opened (a toast may be gone by the time a check runs) */
    toasts: () => page.evaluate(() => window.__vividToasts ?? []),
    /** wait until the circuit-ok count reaches n (wall budget); the simulated time it was seen at, or -1 */
    waitOk: async (n, budgetMs = 30_000) => {
      const t0 = Date.now()
      while (Date.now() - t0 < budgetMs) {
        const c = await api.cele()
        if (c.count['circuit-ok'] >= n) return api.mod('/src/state/store.ts', 'const s = m.useStore.getState(); return s.telemetry ? s.telemetry.time : 0')
        await sleep(120)
      }
      return -1
    },
    /**
     * lesson b1 wired BY HAND (its start circuit + the learner's own 330 Ω R1 and three wires — the
     * cheer-honesty.mjs handPass), then 檢查我的電路; resolves when the run is done
     */
    handPassB1: () =>
      api.mod(
        '/src/ui/lessons/actions.ts',
        `const L = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/lessons/index.ts') ?? '/src/lessons/index.ts')
         const S = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/state/store.ts') ?? '/src/state/store.ts')
         const lesson = L.lessonById('b1-led-resistor')
         await m.loadLessonCircuit(lesson, 'start')
         await new Promise((r) => setTimeout(r, 600))
         const st = S.useStore.getState()
         st.addComponent('resistor', { holes: ['top+10', 'a14'] })
         const r = S.useStore.getState().layout.components.find((c) => c.type === 'resistor')
         S.useStore.getState().setParam(r.id, 'resistance', 330)
         S.useStore.getState().addWire('a16', 'top-13')
         S.useStore.getState().addWire('DMM1:IN', 'e14')
         S.useStore.getState().addWire('DMM1:COM', 'top-15')
         await new Promise((r) => setTimeout(r, 400))
         await m.runAcceptance(lesson)
         return S.useStore.getState().layout.wires.length`,
      ),
    camera: (px, py, pz, tx, ty, tz) => page.evaluate((a) => window.__shotRig.setCamera(...a), [px, py, pz, tx, ty, tz]),
    world: (id) => page.evaluate((i) => window.__e2e.componentWorld(i, 0.5), id),
    /** the scene's FX state (particles, emitters, markers, animators) */
    fx: () =>
      api.mod(
        '/src/three/internal/fx/registry.ts',
        'return { animators: m.frameAnimatorCount() }',
      ),
  }
  await api.mod(
    '/src/ui/kit/toasts.ts',
    `window.__vividToasts = []
     m.subscribeToasts((q) => { for (const t of q) if (!window.__vividToasts.includes(t.text)) window.__vividToasts.push(t.text) })`,
  )
  return api
}

/** frame the parts with the app's own framing (it knows the workspace panels / phone sheets), seen from ≥ 50° */
async function frameAbove(a, ids) {
  await a.mod('/src/ui/workspace/scene-bridge.ts', 'm.frameTargets({ components: a }, { minElevationDeg: 50 })', ids)
  await sleep(900)
}

// ---------------------------------------------------------------------------
// A–F: desktop 1440×900, zh-TW, workspace
// ---------------------------------------------------------------------------
if (ONLY.includes('desktop')) {
  const a = await open({ width: 1440, height: 900 })
  const { page } = a

  // ---- A. the LED ladder ----
  check((await a.load(LED_LADDER)).ok, 'A: LED ladder loads')
  await a.run()
  await a.until(0.6)
  const L = {}
  for (const id of ['LED1', 'LED2', 'LED3', 'LED4']) L[id] = await a.comp(id)
  check(L.LED1?.light > 0.6 && L.LED1?.light < 0.8, 'A: 220 Ω → light ≈ 0.70 (≈ 14 mA)', L.LED1?.light)
  check(L.LED2?.light > 0.13 && L.LED2?.light < 0.18, 'A: 1 kΩ → light ≈ 0.16 (≈ 3.2 mA)', L.LED2?.light)
  check(L.LED3?.light > 0.01 && L.LED3?.light < 0.02, 'A: 10 kΩ → light ≈ 0.016 (≈ 0.3 mA)', L.LED3?.light)
  check(L.LED4?.light > 1.05 && !L.LED4?.burned, 'A: 120 Ω → over-driven (> 20 mA) but intact', L.LED4?.light)
  const fx = await a.fx()
  check(fx.animators >= 1, 'A: the over-driven LED runs its warning flicker animator', fx.animators)
  await frameAbove(a, ['LED1', 'LED2', 'LED3', 'LED4'], 15)
  await a.shot('A1-led-ladder')
  await sleep(350)
  await a.shot('A2-led-ladder-later')
  await a.stop()

  // ---- A'. no series resistor: burns ----
  const okBefore = (await a.cele()).count['circuit-ok']
  check((await a.load(LED_BURN)).ok, "A': burn circuit loads")
  await frameAbove(a, ['LED1', 'LED5'], 11)
  await a.run()
  await sleep(250)
  await a.shot('A3-burn-pop')
  await a.until(0.5)
  const l5 = await a.comp('LED5')
  check(l5?.burned === true && l5?.damage?.kind === 'burned' && l5?.light === 0, "A': no resistor → burned, light 0, damage latched", JSON.stringify(l5?.damage))
  await sleep(900)
  await a.shot('A4-burn-smoke')
  await sleep(1500)
  const probs = await a.problems()
  const burnRow = probs.find((p) => p.fact === 'burned:LED5')
  check(!!burnRow && burnRow.level === 'error', "A': Problems lists LED5 burned out (error)", burnRow?.title)
  check((await a.cele()).count['circuit-ok'] === okBefore, "A': no circuit-ok cue while an error is listed (LED1 is lit, but LED5 burned)")
  await sleep(4000)
  await a.shot('A5-burned-after')
  await a.stop()

  // ---- B. resistor overload ----
  check((await a.load(OVERLOAD)).ok, 'B: overload circuit loads')
  await a.run()
  await frameAbove(a, ['R1', 'R2'], 16)
  await a.until(1.2)
  let r1 = await a.comp('R1')
  let r2 = await a.comp('R2')
  check(r2?.damage?.kind === 'overheating' && r2?.heat > 2, 'B: 10 Ω at 12 V after 1.2 s — overheating, glowing', `${r2?.heat} ${r2?.damage?.kind}`)
  await a.shot('B1-overload-hot')
  await a.until(2.4)
  r2 = await a.comp('R2')
  check(r2?.damage?.kind === 'burned' && Math.abs(r2?.current ?? 1) < 1e-6, 'B: 10 Ω burned OPEN — its current stopped', `${r2?.damage?.kind} ${r2?.current}`)
  await sleep(600)
  await a.shot('B2-overload-burned')
  const probsB = await a.problems()
  const rowB = probsB.find((p) => p.fact === 'burned:R2')
  // round 5: the fix, and how it comes back — 〔換新〕, or by itself once the circuit or a value is fixed
  check(!!rowB && /燒斷/.test(rowB.title) && /再按〔換新〕/.test(rowB.detail) && /自動換新/.test(rowB.detail), 'B: Problems 「R2 燒斷了」 with cause + fix + 〔換新〕', rowB ? `${rowB.title} — ${rowB.detail}` : '')
  // round 5 — 〔換新〕: a new R2 at once, in place (no edit, no reset, its 10 Ω kept) — it conducts again
  check(await a.mod('/src/ui/embedded/replace-part.ts', 'return m.replaceDamagedWithFeedback(a)', 'R2'), 'B: 〔換新〕 replaces R2')
  const tReplaced = await a.simTime()
  await sleep(300)
  r2 = await a.comp('R2')
  check(r2?.damage?.kind !== 'burned' && Math.abs(r2?.current ?? 0) > 0.5, 'B: 〔換新〕 → a new R2 conducts again (≈ 1.2 A) — no edit, no reset', `${r2?.damage?.kind} ${r2?.current}`)
  await a.until(5, 30_000)
  r1 = await a.comp('R1')
  check(r1?.damage?.kind === 'overheating' && Math.abs(r1?.current ?? 0) > 0.07, 'B: 150 Ω (3.8× its rating) overheats, smoking, still conducting', `${r1?.heat} ${r1?.current}`)
  await a.shot('B3-overload-150-smoking')
  // the 10 Ω overload is still there: the new R2 heats up and burns open again (≈ 1.9 s) — honest, never a fake fix
  await a.until(tReplaced + 2.6, 30_000)
  r2 = await a.comp('R2')
  check(r2?.damage?.kind === 'burned', 'B: the overload still there → the new R2 burned open again', r2?.damage?.kind)
  await a.stop()

  // ---- G. a pin beyond its absolute maximum: marker + honest wording ----
  check((await a.load(ABSMAX)).ok, 'G: 5 V into PA0 loads')
  await a.run()
  await a.until(1.0)
  await sleep(1300)
  const look = await page.evaluate(() => window.__vividFx.debugLook())
  check(look.markers === 1, 'G: the pin-damage marker stands over U1 PA0', look.markers)
  const rowG = (await a.problems()).find((p) => p.fact === 'absmax:U1:PA0')
  check(!!rowG && /可能已經損壞/.test(rowG.detail) && /不再保證 U1 的行為/.test(rowG.detail), 'G: Problems says the pin may be damaged and the simulation no longer guarantees U1', rowG ? `${rowG.title} — ${rowG.detail}` : '')
  await frameAbove(a, ['U1'], 22)
  await a.shot('G1-absmax-marker')
  await a.stop()

  // ---- C. motor example ----
  const motor = readFileSync(path.join(ROOT, 'examples/embedded/dc-motor-l298n.ohmlet.json'), 'utf8')
  const imp = await a.mod('/src/ui/embedded/lab.ts', 'return m.useLab.getState().importProject(a)', motor)
  check(imp?.ok, 'C: dc-motor-l298n example opens', JSON.stringify(imp?.errors ?? []))
  await sleep(1500)
  await a.run()
  await a.until(2.5, 40_000)
  const comps = await a.mod('/src/state/store.ts', 'return m.useStore.getState().layout.components.map((c) => c.id + ":" + c.type)')
  const motorId = comps.find((c) => /motor/.test(c.split(':')[1]) && !/l298n/.test(c))?.split(':')[0]
  const mt = motorId ? await a.comp(motorId) : null
  check(Math.abs(mt?.values?.rpm ?? 0) > 5, 'C: the motor turns (rpm from the model)', `${motorId} ${mt?.values?.rpm}`)
  const firedC = await a.waitOk(1, 30_000)
  const celeC = await a.cele()
  const toastC = await a.toasts()
  check(firedC >= 1.2 && celeC.count['circuit-ok'] >= 1, 'C: circuit-ok celebrated for the running motor circuit (after ≥ 1.2 s simulated)', `${firedC} ` + JSON.stringify(celeC.count) + ' ' + toastC.join(' | '))
  await a.shot('C1-motor')
  await a.stop()

  // ---- D. blink example: once per revision ----
  const blink = readFileSync(path.join(ROOT, 'examples/embedded/blink.ohmlet.json'), 'utf8')
  const before = (await a.cele()).count['circuit-ok']
  check((await a.mod('/src/ui/embedded/lab.ts', 'return m.useLab.getState().importProject(a)', blink))?.ok, 'D: blink example opens')
  await sleep(1500)
  await a.run()
  const firedD = await a.waitOk(before + 1, 40_000)
  await sleep(300)
  const toastD = await a.toasts()
  const afterD = (await a.cele()).count['circuit-ok']
  check(firedD >= 1.2 && afterD === before + 1, 'D: blink → one 「電路正常運作 ✓」 (after ≥ 1.2 s simulated)', `${before} → ${afterD} at ${firedD}`)
  check(toastD.some((s) => /^電路正常運作 ✓ · .*(LED1 亮了|在切換)/.test(s)), 'D: the toast reads 「電路正常運作 ✓ · …」 with what it saw', toastD.join(' | '))
  await a.shot('D1-blink-ok')
  await a.stop()
  await a.run()
  await a.until(3.0, 30_000)
  await sleep(1300)
  check((await a.cele()).count['circuit-ok'] === afterD, 'D: pause + run again on the same circuit: no repeat')
  await a.stop()

  // ---- E. lesson b1 wired by hand passes → 完成！ (the loaded answer passing does not celebrate) ----
  const passE = await a.handPassB1()
  check(passE === 5, 'E: b1 wired by hand (R1 + 3 wires) and its acceptance ran', passE)
  await sleep(500)
  const celeE = await a.cele()
  check(celeE.count['lesson-pass'] >= 1 && celeE.badge?.title === '完成！', 'E: the 「完成！」 badge', JSON.stringify(celeE.badge))
  check(/驗收 \d+ 項全部通過/.test(celeE.badge?.message ?? ''), 'E: the badge says what passed', celeE.badge?.message)
  const badgeBox = await page.locator('.fx-cele-badge').boundingBox()
  check(!!badgeBox && badgeBox.width > 200, 'E: the badge is on screen', JSON.stringify(badgeBox))
  await sleep(300)
  await a.shot('E1-b1-pass')
  await sleep(4500)
  check((await page.locator('.fx-cele-badge').count()) === 0, 'E: the badge leaves by itself')

  // ---- F. a free circuit ----
  const beforeF = (await a.cele()).count['circuit-ok']
  check((await a.load(FREE_LED)).ok, 'F: free LED circuit loads')
  await a.run()
  const firedF = await a.waitOk(beforeF + 1)
  await sleep(300)
  check(firedF >= 1.2 && (await a.cele()).count['circuit-ok'] === beforeF + 1, 'F: free LED + 220 Ω → 「電路正常運作 ✓」 (after ≥ 1.2 s simulated)', firedF)
  await frameAbove(a, ['LED1'], 14)
  await a.shot('F1-free-ok')
  await a.stop()
  check(a.errors.length === 0, 'desktop: no page errors', a.errors.join(' | '))
  await a.close()
}

// ---------------------------------------------------------------------------
// phone 390×844
// ---------------------------------------------------------------------------
if (ONLY.includes('phone')) {
  const a = await open({ width: 390, height: 844, workspace: false, phone: true })
  check((await a.load(LED_LADDER)).ok, 'phone: LED ladder loads')
  await a.run()
  await a.until(0.6)
  await frameAbove(a, ['LED1', 'LED2', 'LED3', 'LED4'], 22)
  await a.shot('P1-led-ladder')
  await a.stop()
  check((await a.handPassB1()) === 5, 'phone: b1 wired by hand, acceptance ran')
  await sleep(500)
  const box = await a.page.locator('.fx-cele-badge').boundingBox()
  check(!!box && box.x >= 0 && box.x + box.width <= 390, 'phone: the 「完成！」 badge fits the screen', JSON.stringify(box))
  await a.shot('P2-b1-pass')
  check(a.errors.length === 0, 'phone: no page errors', a.errors.join(' | '))
  await a.close()
}

// ---------------------------------------------------------------------------
// reduced motion + the English classic chrome
// ---------------------------------------------------------------------------
if (ONLY.includes('reduced')) {
  const a = await open({ width: 1440, height: 900, reducedMotion: 'reduce' })
  check((await a.load(LED_LADDER)).ok, 'reduced motion: LED ladder loads')
  await a.run()
  await a.until(0.6)
  check((await a.fx()).animators === 0, 'reduced motion: no flicker animator (static over-drive look)')
  await a.stop()
  await a.close()
}
if (ONLY.includes('classic')) {
  const a = await open({ width: 1440, height: 900, lang: 'en', workspace: false })
  check((await a.load(FREE_LED)).ok, 'classic: free LED circuit loads')
  await a.run()
  await a.waitOk(1)
  await sleep(400)
  const c = await a.cele()
  const toasts = await a.toasts()
  check(c.count['circuit-ok'] === 1 && !toasts.some((s) => /working/i.test(s)), 'classic chrome: 3D cue only, no toast', toasts.join(' | '))
  const l1 = await a.comp('LED1')
  check(l1?.light > 0.5, 'classic chrome: the same realistic LED light', l1?.light)
  await frameAbove(a, ['LED1'], 14)
  await a.shot('X1-classic-led')
  check(a.errors.length === 0, 'classic: no page errors', a.errors.join(' | '))
  await a.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
