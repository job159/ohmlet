/**
 * One-off Phase F a11y-path probe (verification only, safe to delete):
 *   - prefers-reduced-motion: open Parts (morphs must collapse to crossfade
 *     — capture a mid-transition frame + settled sheet)
 *   - prefers-reduced-transparency (via CDP): near-opaque slabs, lens never
 *     arms (html.lg-lens-on must be absent)
 * Usage: npm run build && node scripts/glass-a11y-probe.mjs
 *
 * Empty-card contrast (UX fix SH-16 — N5; a pass / fail check):
 *   GLASS_URL=http://localhost:5173/ node scripts/glass-a11y-probe.mjs empty-contrast
 * Boots a fresh zh-TW profile on an empty board at 1440×900 (workspace on
 * and off) and 390×844 (phone, DPR 2), waits for the adaptive glass tone to settle,
 * then measures EVERY text node of the empty-state card the way a reader
 * sees it: the card is shot twice — as is, and with its text made
 * transparent — so the background under each glyph is the real lensed /
 * tone-adapted glass, not a guess. Per text node: the glyph-core pixels
 * (where the two shots differ most) against the same pixels without the
 * text, WCAG relative luminance. Fails (exit 1) when any node is < 4.5:1.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 4187
const URL = `http://localhost:${PORT}/`

function startPreview() {
  const proc = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: new globalThis.URL('..', import.meta.url).pathname,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('preview server timed out')), 15000)
    proc.stdout.on('data', (d) => {
      if (String(d).includes('localhost')) {
        clearTimeout(timer)
        resolve(proc)
      }
    })
    proc.on('exit', (code) => reject(new Error(`preview exited early (${code})`)))
  })
}

async function tap(page, locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element not visible for tap')
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

const phoneOpts = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
}

async function main() {
  const server = await startPreview()
  const browser = await chromium.launch({ args: ['--use-angle=metal'] })
  try {
    // ---- reduced motion ----
    {
      const ctx = await browser.newContext({ ...phoneOpts, reducedMotion: 'reduce' })
      const page = await ctx.newPage()
      await page.addInitScript(() => localStorage.setItem('bb.onboarded', '1'))
      await page.goto(URL)
      await page.waitForSelector('canvas')
      await page.waitForTimeout(1500)
      await tap(page, page.getByRole('tab', { name: 'Parts' }))
      await page.waitForTimeout(90) // mid-crossfade
      await page.screenshot({ path: 'shots/glassf-rm-parts-mid.png' })
      await page.waitForTimeout(900)
      await page.screenshot({ path: 'shots/glassf-rm-parts.png' })
      const anims = await page.evaluate(() =>
        document.getAnimations().map((a) => ({
          name: a.animationName ?? a.transitionProperty ?? 'waapi',
          ms: a.effect?.getTiming?.().duration ?? null,
        })),
      )
      console.log('reduced-motion settled animations:', JSON.stringify(anims))
      await ctx.close()
    }
    // ---- reduced transparency (CDP media feature) ----
    {
      const ctx = await browser.newContext(phoneOpts)
      const page = await ctx.newPage()
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
      })
      await page.addInitScript(() => localStorage.setItem('bb.onboarded', '1'))
      await page.goto(URL)
      await page.waitForSelector('canvas')
      await page.waitForTimeout(1500)
      const lensOn = await page.evaluate(() =>
        document.documentElement.classList.contains('lg-lens-on'),
      )
      console.log('reduced-transparency lens armed (must be false):', lensOn)
      await page.screenshot({ path: 'shots/glassf-rt-home.png' })
      await tap(page, page.getByRole('tab', { name: 'Parts' }))
      await page.waitForTimeout(1000)
      const filters = await page.evaluate(() =>
        [...document.querySelectorAll('*')]
          .filter((el) => {
            const f = getComputedStyle(el).backdropFilter
            return f && f !== 'none'
          })
          .map((el) => el.className),
      )
      console.log('reduced-transparency live backdrop-filters (must be []):', JSON.stringify(filters))
      await page.screenshot({ path: 'shots/glassf-rt-parts.png' })
      await ctx.close()
    }
  } finally {
    await browser.close()
    server.kill()
  }
  console.log('wrote shots/glassf-rm-*.png + glassf-rt-*.png')
}

// ---------------------------------------------------------------------------
// empty-card contrast (SH-16)
// ---------------------------------------------------------------------------

/** Settle the adaptive glass tone: no platter flipped light / dark for 1.3 s. */
async function settleTone(page) {
  const sig = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.lg-tone-adaptive')]
        .map((el) => `${el.classList.contains('is-tone-light') ? 'L' : 'D'}:${el.style.getPropertyValue('--lg-lum')}`)
        .join('|'),
    )
  let last = await sig()
  let since = Date.now()
  const t0 = Date.now()
  while (Date.now() - t0 < 10000) {
    await page.waitForTimeout(100)
    const s = await sig()
    if (s !== last) {
      last = s
      since = Date.now()
    } else if (Date.now() - since >= 1300) break
  }
}

/** Per text node of the card: glyph-core luminance vs. the same pixels without text (runs in the page). */
function measureNodes([a, b, nodes, box, dpr]) {
  const load = (s) =>
    new Promise((ok, bad) => {
      const im = new Image()
      im.onload = () => ok(im)
      im.onerror = bad
      im.src = `data:image/png;base64,${s}`
    })
  const px = (im) => {
    const c = document.createElement('canvas')
    c.width = im.width
    c.height = im.height
    const g = c.getContext('2d')
    g.drawImage(im, 0, 0)
    return g.getImageData(0, 0, im.width, im.height)
  }
  const lin = (c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const L = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2])
  return Promise.all([load(a), load(b)]).then(([ia, ib]) => {
    const A = px(ia)
    const B = px(ib)
    return nodes.map((n) => {
      const x0 = Math.max(0, Math.floor((n.x - box.x) * dpr))
      const y0 = Math.max(0, Math.floor((n.y - box.y) * dpr))
      const x1 = Math.min(A.width, Math.ceil((n.x + n.w - box.x) * dpr))
      const y1 = Math.min(A.height, Math.ceil((n.y + n.h - box.y) * dpr))
      const diffs = []
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * A.width + x) * 4
          const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2])
          if (d > 30) diffs.push([d, i])
        }
      }
      if (diffs.length === 0) return { ...n, ratio: null }
      diffs.sort((p, q) => q[0] - p[0])
      // the glyph cores: the strongest quarter of the changed pixels
      const core = diffs.slice(0, Math.max(1, Math.round(diffs.length * 0.25)))
      let lt = 0
      let lb = 0
      for (const [, i] of core) {
        lt += L(A.data, i)
        lb += L(B.data, i)
      }
      lt /= core.length
      lb /= core.length
      return { ...n, ratio: Math.round(((Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05)) * 100) / 100 }
    })
  })
}

async function emptyContrast() {
  const url = process.env.GLASS_URL ?? 'http://localhost:5173/'
  const browser = await chromium.launch({ channel: process.env.GLASS_CHANNEL ?? 'msedge' })
  const rows = []
  try {
    for (const vp of [
      { name: '1440', ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, workspace: true },
      // zh-TW without the workspace: the card floats over the bright board and turns light glass
      { name: '1440 (no workspace)', ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, workspace: false },
      { name: '390', ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, workspace: false },
    ]) {
      const ctx = await browser.newContext(vp.ctx)
      const page = await ctx.newPage()
      await page.addInitScript((ws) => {
        localStorage.clear()
        localStorage.setItem('bb.onboarded', '1')
        localStorage.setItem('bb.lang', 'zh-TW')
        localStorage.setItem('bb.renderMode', 'performance')
        localStorage.setItem('bb.workspace', JSON.stringify({ v: 1, enabled: ws }))
        localStorage.setItem('bb.layout', JSON.stringify({ version: 1, name: 'empty', components: [], wires: [] }))
      }, vp.workspace)
      await page.goto(url)
      await page.waitForSelector('.app-empty-card')
      await page.waitForTimeout(2500)
      await settleTone(page)
      // freeze the card between the two shots (no spring / transition)
      await page.addStyleTag({ content: '.app-empty-card, .app-empty-card * { transition: none !important; animation: none !important; }' })
      await page.waitForTimeout(200)
      const card = page.locator('.app-empty-card')
      const box = await card.boundingBox()
      const tone = await card.evaluate((el) => (el.classList.contains('is-tone-light') ? 'light' : 'dark'))
      // every element box that directly holds text
      const nodes = await page.evaluate(() => {
        const out = []
        const root = document.querySelector('.app-empty-card')
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = n.textContent.trim()
          if (!text) continue
          const range = document.createRange()
          range.selectNodeContents(n)
          for (const r of range.getClientRects()) {
            if (r.width < 2 || r.height < 2) continue
            out.push({ text: text.slice(0, 24), x: r.x, y: r.y, w: r.width, h: r.height })
          }
        }
        return out
      })
      const shotA = await page.screenshot({ clip: box })
      await page.addStyleTag({
        content: '.app-empty-card * { color: transparent !important; text-shadow: none !important; -webkit-text-fill-color: transparent !important; }',
      })
      await page.waitForTimeout(150)
      const shotB = await page.screenshot({ clip: box })
      const res = await page.evaluate(measureNodes, [
        shotA.toString('base64'),
        shotB.toString('base64'),
        nodes,
        box,
        vp.ctx.deviceScaleFactor,
      ])
      for (const r of res) rows.push({ viewport: vp.name, tone, text: r.text, ratio: r.ratio })
      await ctx.close()
    }
  } finally {
    await browser.close()
  }
  console.table(rows)
  const bad = rows.filter((r) => r.ratio !== null && r.ratio < 4.5)
  console.log(bad.length === 0 ? 'empty card: every text node ≥ 4.5:1' : `empty card: ${bad.length} text node(s) under 4.5:1`)
  if (bad.length) process.exitCode = 1
}

if (process.argv[2] === 'empty-contrast') {
  emptyContrast().catch((e) => {
    console.error(e)
    process.exit(1)
  })
} else {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
