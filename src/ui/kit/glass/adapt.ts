/**
 * adapt.ts — backdrop-luminance adaptation for the Liquid Glass material
 * (DESIGN.md §1). Apple's regular variant "knows how bright or dark the
 * background is, so the platter and the symbols on top of it flip between
 * light and dark to stay visible" and its shadows modulate with the content
 * behind. The browser equivalent here: a singleton sampler reads the live
 * WebGL scene behind each registered platter at low frequency and writes
 * two things per surface:
 *
 *   --lg-lum            0..1 mean backdrop luminance (continuous; drives
 *                       the adaptive ambient-shadow alpha in kit.css, and
 *                       transitions via the registered @property)
 *   .is-tone-light      flipped with hysteresis + a 2-sample vote — the
 *                       light-glass state (light platter paint fades in on
 *                       the .lg-tone child layer; ink/separator custom
 *                       props flip dark; see kit.css)
 *
 * How the read works: the scene renderer draws each frame inside its own
 * rAF callback and the drawing buffer is cleared at composite
 * (preserveDrawingBuffer is off — DESIGN.md §7 forbids paying for it). So
 * the sampler schedules from a TIMER task: a requestAnimationFrame issued
 * between frames lands AFTER the scene's already-queued callback, i.e. our
 * drawImage() runs in the same frame right after renderer.render(), while
 * the buffer is still valid. Each registered surface's backdrop rect is
 * blitted into one tiny strip canvas (a 12×8 patch per surface, single
 * getImageData per sample — one small GPU readback every SAMPLE_MS, never
 * per frame). All-black frames (missed render, paused loop) are detected
 * and skipped, freezing the last known tone.
 *
 * PERF (the readback leaves the main thread): a synchronous getImageData
 * waits for the GPU process to drain its queue — measured at ~85 ms per
 * sample in Edge with software WebGL (a third of the main thread's wall
 * time in the blink example, almost all of its long tasks), a sync stall
 * of a frame or so on real GPUs. So the main thread only snapshots the
 * post-render drawing buffer with createImageBitmap (a GPU-side copy,
 * ~0.1 ms) in that same rAF slot and hands it to a tiny readback worker,
 * which performs the very same blit (identical drawImage source rects onto
 * an identical 12×8-per-surface strip, an OffscreenCanvas 2D) and the
 * getImageData there; the bytes come back and the blank-frame guard /
 * luminance / vote math below runs on them unchanged (applySample). The
 * worker's bytes were verified identical to the in-thread blit's, so the
 * tone and --lg-lum values are exactly what the in-thread read produced —
 * applied one worker round trip (≈ a frame) later, well inside the
 * 340–460 ms CSS transitions. Cadence (SAMPLE_MS, the first read after
 * 60 ms), thresholds and votes are untouched. Without createImageBitmap /
 * OffscreenCanvas / Blob workers (or once the worker fails) the original
 * in-thread read runs.
 *
 * Scope (the tone tier): the floating platters that orbit over wildly
 * varying scene content — dock, status capsule, empty-state card. Sheets,
 * panels and nested cards stay the regular dark glass (they are content
 * surfaces, like iOS sheets). Registration is per-component
 * (attachToneAdapt in an effect), no App.tsx hook required.
 *
 * Opt-outs: prefers-reduced-transparency (the material flattens; tone
 * never engages — same gate as the lens) and the `?tone=off` verification
 * flag. Hidden documents pause sampling.
 */

/** ms between samples (~2.6Hz — reaction feels live, cost stays nil). */
const SAMPLE_MS = 380
/** Hysteresis thresholds on mean sRGB luminance (0..1). */
const LIGHT_ON = 0.58
const LIGHT_OFF = 0.46
/** Consecutive agreeing samples required before the tone flips. */
const FLIP_VOTES = 2
/** Strip-canvas patch size per registered surface. */
const PATCH_W = 12
const PATCH_H = 8

interface ToneEntry {
  light: boolean
  votes: number
}

const entries = new Map<HTMLElement, ToneEntry>()
let timer = 0
let strip: HTMLCanvasElement | null = null
let stripCtx: CanvasRenderingContext2D | null = null
let sceneCanvas: HTMLCanvasElement | null = null
let enabled: boolean | null = null

function toneEnabled(): boolean {
  if (enabled !== null) return enabled
  if (typeof window === 'undefined' || typeof document === 'undefined') return (enabled = false)
  try {
    if (new URLSearchParams(window.location.search).get('tone') === 'off')
      return (enabled = false)
  } catch {
    /* no usable location (tests) — fall through */
  }
  if (window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches)
    return (enabled = false)
  return (enabled = true)
}

/** The live scene canvas (re-queried when remounted). */
function findSceneCanvas(): HTMLCanvasElement | null {
  if (sceneCanvas?.isConnected) return sceneCanvas
  sceneCanvas =
    document.querySelector<HTMLCanvasElement>('.app-canvas canvas') ??
    document.querySelector<HTMLCanvasElement>('canvas')
  return sceneCanvas
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function visible(el: HTMLElement): boolean {
  interface WithCheckVisibility {
    checkVisibility?: (o?: object) => boolean
  }
  const cv = (el as WithCheckVisibility).checkVisibility
  if (typeof cv === 'function')
    return cv.call(el, { visibilityProperty: true, checkVisibilityCSS: true })
  return el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
}

// ---------------------------------------------------------------- readback

/**
 * The readback worker's whole program (a Blob worker: self-contained, no
 * bundler entry). It mirrors the in-thread blit exactly: one strip canvas
 * kept across samples (resized only when the surface count changes), each
 * surface's source rect drawn into its PATCH_W × PATCH_H patch, one
 * getImageData. Replies { id, data } in request order (data null = the
 * read failed: tainted / no 2D context — the main thread then falls back).
 */
const WORKER_SRC = `
let strip = null, ctx = null
onmessage = (e) => {
  const { id, bmp, rects, pw, ph } = e.data
  let data = null
  try {
    const w = (rects.length / 4) * pw
    if (!strip) { strip = new OffscreenCanvas(w, ph); ctx = strip.getContext('2d') }
    if (strip.width !== w || strip.height !== ph) { strip.width = w; strip.height = ph }
    for (let i = 0; i < rects.length; i += 4) ctx.drawImage(bmp, rects[i], rects[i + 1], rects[i + 2], rects[i + 3], (i / 4) * pw, 0, pw, ph)
    data = ctx.getImageData(0, 0, w, ph).data
  } catch (err) { data = null }
  try { bmp.close() } catch (err) {}
  postMessage({ id, data }, data ? [data.buffer] : [])
}`

/** A sample whose pixels are being read by the worker. */
interface InFlight {
  live: HTMLElement[]
  /** the entries as they were at sample time (a re-attached surface gets a new one) */
  owners: ToneEntry[]
}

/** undefined = not tried yet, null = unavailable (in-thread read) */
let reader: Worker | null | undefined
let readSeq = 0
const inFlight = new Map<number, InFlight>()

function offThreadReader(): Worker | null {
  if (reader !== undefined) return reader
  reader = null
  try {
    if (
      typeof Worker === 'undefined' ||
      typeof OffscreenCanvas === 'undefined' ||
      typeof createImageBitmap !== 'function' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    )
      return null
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))
    const w = new Worker(url)
    URL.revokeObjectURL(url)
    w.onmessage = (e: MessageEvent<{ id: number; data: Uint8ClampedArray | null }>) => {
      const { id, data } = e.data
      const job = inFlight.get(id)
      inFlight.delete(id)
      if (!job) return
      if (!data) {
        // the worker cannot read (no OffscreenCanvas 2D there): read in-thread from now on
        dropReader()
        return
      }
      applySample(data, job.live, job.owners)
    }
    w.onerror = () => dropReader()
    reader = w
  } catch {
    reader = null // CSP / no blob workers: the in-thread read
  }
  return reader
}

function dropReader(): void {
  if (reader) {
    try {
      reader.terminate()
    } catch {
      /* already gone */
    }
  }
  reader = null
  inFlight.clear()
}

/** One sample pass: blit every live surface's backdrop, read once, apply. */
function sample(): void {
  const canvas = findSceneCanvas()
  if (!canvas || canvas.width === 0 || canvas.height === 0) return
  const live: HTMLElement[] = []
  for (const el of entries.keys()) {
    if (el.isConnected && visible(el)) live.push(el)
  }
  if (live.length === 0) return
  const crect = canvas.getBoundingClientRect()
  if (crect.width === 0 || crect.height === 0) return
  const sx = canvas.width / crect.width
  const sy = canvas.height / crect.height
  const rects = new Array<number>(live.length * 4)
  for (let i = 0; i < live.length; i++) {
    const r = live[i].getBoundingClientRect()
    const px = clamp((r.left - crect.left) * sx, 0, canvas.width - 2)
    const py = clamp((r.top - crect.top) * sy, 0, canvas.height - 2)
    rects[i * 4] = px
    rects[i * 4 + 1] = py
    rects[i * 4 + 2] = clamp(r.width * sx, 1, canvas.width - px)
    rects[i * 4 + 3] = clamp(r.height * sy, 1, canvas.height - py)
  }

  // a worker that stopped answering (8 samples ≈ 3 s behind): read in-thread
  if (inFlight.size >= 8) dropReader()
  const worker = offThreadReader()
  if (worker) {
    let snap: Promise<ImageBitmap>
    try {
      // the post-render drawing buffer, copied GPU-side (no readback here)
      snap = createImageBitmap(canvas)
    } catch {
      return // unreadable this frame — keep the last tone (as a failed read does)
    }
    const id = ++readSeq
    const owners: ToneEntry[] = []
    for (const el of live) owners.push(entries.get(el) as ToneEntry)
    inFlight.set(id, { live, owners })
    snap.then(
      (bmp) => {
        if (reader !== worker || !inFlight.has(id)) {
          bmp.close()
          return
        }
        worker.postMessage({ id, bmp, rects, pw: PATCH_W, ph: PATCH_H }, [bmp])
      },
      () => {
        inFlight.delete(id)
      },
    )
    return
  }

  // in-thread read (no worker support)
  if (!strip) {
    strip = document.createElement('canvas')
    stripCtx = strip.getContext('2d')
  }
  const ctx = stripCtx
  if (!ctx) return
  const w = live.length * PATCH_W
  if (strip.width !== w || strip.height !== PATCH_H) {
    strip.width = w
    strip.height = PATCH_H
  }
  for (let i = 0; i < live.length; i++) {
    ctx.drawImage(canvas, rects[i * 4], rects[i * 4 + 1], rects[i * 4 + 2], rects[i * 4 + 3], i * PATCH_W, 0, PATCH_W, PATCH_H)
  }
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, w, PATCH_H).data
  } catch {
    return // tainted/unreadable — keep the last tone
  }
  applySample(data, live, null)
}

/**
 * Luminance + tone votes from one read strip (`live.length` patches).
 * `owners`: the entries at sample time (off-thread reads) — a surface that
 * detached, or detached and re-attached, while its pixels were in flight is
 * skipped, exactly as a detached surface is skipped in-thread.
 */
function applySample(data: Uint8ClampedArray, live: HTMLElement[], owners: ToneEntry[] | null): void {
  const w = live.length * PATCH_W
  // blank-frame guard: a missed render (or paused loop) reads back pure
  // black across the whole strip — the lit desk never does. Skip it.
  let maxC = 0
  for (let i = 0; i < data.length; i += 4) {
    const m = Math.max(data[i], data[i + 1], data[i + 2])
    if (m > maxC) maxC = m
  }
  if (maxC < 4) return
  for (let i = 0; i < live.length; i++) {
    let sum = 0
    for (let y = 0; y < PATCH_H; y++) {
      const row = (y * w + i * PATCH_W) * 4
      for (let x = 0; x < PATCH_W; x++) {
        const p = row + x * 4
        sum += 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]
      }
    }
    const lum = sum / (PATCH_W * PATCH_H * 255)
    const el = live[i]
    const entry = entries.get(el)
    if (!entry || (owners !== null && owners[i] !== entry)) continue
    el.style.setProperty('--lg-lum', lum.toFixed(3))
    const want = entry.light ? lum > LIGHT_OFF : lum > LIGHT_ON
    if (want !== entry.light) {
      if (++entry.votes >= FLIP_VOTES) {
        entry.light = want
        entry.votes = 0
        el.classList.toggle('is-tone-light', want)
      }
    } else {
      entry.votes = 0
    }
  }
}

function tickSample(): void {
  if (document.hidden || entries.size === 0) return
  // issued from a timer task, this rAF queues AFTER the scene loop's own
  // (already-pending) callback — sample() reads the buffer post-render
  requestAnimationFrame(sample)
}

function start(): void {
  if (timer || typeof window === 'undefined') return
  timer = window.setInterval(tickSample, SAMPLE_MS)
  window.setTimeout(tickSample, 60) // first read without the full wait
}

function stop(): void {
  if (!timer) return
  window.clearInterval(timer)
  timer = 0
}

/**
 * Register a floating platter for backdrop-luminance adaptation. Returns
 * the detach function (call on unmount). No-op (noop detach) when tone
 * adaptation is disabled.
 */
export function attachToneAdapt(el: HTMLElement): () => void {
  if (!toneEnabled()) return () => {}
  el.classList.add('lg-tone-adaptive')
  entries.set(el, { light: false, votes: 0 })
  start()
  return () => {
    entries.delete(el)
    el.classList.remove('lg-tone-adaptive', 'is-tone-light')
    el.style.removeProperty('--lg-lum')
    if (entries.size === 0) stop()
  }
}
