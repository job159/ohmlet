/**
 * Success feedback — CONTRACT C3 (owner: vivid).
 *
 *   celebrate('lesson-pass', { componentIds?, message? })
 *       a lesson's acceptance passed on the learner's own circuit (never
 *       the loaded answer — success-watch.ts / lesson-pass.ts): tumbling 3D
 *       confetti and a crisp ring around the parts the checks looked at,
 *       the big 「完成！」 badge (CelebrationOverlay) saying what
 *       passed (`message`), the success chime, a haptic pattern on phones.
 *   celebrate('circuit-ok', { componentIds?, message? })
 *       the circuit newly works, cleanly, for a while (see success-watch.ts
 *       — the real conditions: no error, no warning on a working part,
 *       1.2 s of simulated time, no damage): a short sparkle along the
 *       active parts + the toast 「電路正常運作 ✓」 (+ `message`), a light
 *       two-note chime.
 *
 * Callers state only what really happened (NO FAKE SIMULATION): the lesson
 * engine's acceptance result, the success watcher's measured activity. The
 * same kind within DEDUPE_MS is one celebration (the lesson module and the
 * watcher may both report one pass). prefers-reduced-motion: the 3D scene
 * replaces the confetti with a static glow (it samples the preference at
 * mount) and the badge appears without its spring.
 *
 * The English classic chrome (isLegacyChrome) keeps the original ohmlet UI:
 * there the celebration is the 3D effect only — no badge, toast, sound or
 * haptics.
 *
 * The visual-regression harness (?shotrig, scripts/visual-regression.mjs —
 * celebrationsSuppressed) gets NO celebration at all (no toast, badge,
 * sparkle, confetti, sound): its shots must not depend on when a cheer
 * lands. An e2e script that drives the harness and wants the cheer adds
 * `&cheer`.
 */
import { create } from 'zustand'
import { emitSceneFx, type SceneFxEvent, type ScreenRect } from '../../three/internal/fx/bus'
import { t } from '../../i18n'
import { showToast } from '../kit/toasts'
import { isLegacyChrome } from '../chrome/legacy'
import { playCue } from './sound'

export type CelebrationKind = 'lesson-pass' | 'circuit-ok'

export interface CelebrationOptions {
  /** parts the 3D effect gathers around (absent / empty = the whole circuit) */
  componentIds?: string[]
  /** what passed / what works, already in the UI language */
  message?: string
}

/** The badge the overlay shows (lesson-pass only — circuit-ok is a toast). */
export interface CelebrationBadge {
  id: number
  kind: CelebrationKind
  title: string
  message?: string
  at: number
}

export interface CelebrationState {
  badge: CelebrationBadge | null
  /** how many celebrations ran this page (tests / e2e) */
  count: Record<CelebrationKind, number>
  /** celebrations the visual-regression harness swallowed (tests / e2e) */
  suppressed: number
  dismiss(): void
}

export const useCelebration = create<CelebrationState>()((set) => ({
  badge: null,
  count: { 'lesson-pass': 0, 'circuit-ok': 0 },
  suppressed: 0,
  dismiss() {
    set({ badge: null })
  },
}))

/** one celebration per kind within this window (ms) */
export const DEDUPE_MS = 2500
/** how long the 「完成！」 badge stays (ms) */
export const BADGE_MS = 4200

let nextId = 1
const lastAt: Partial<Record<CelebrationKind, number>> = {}
let badgeTimer: ReturnType<typeof setTimeout> | null = null

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function coarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

function haptic(pattern: number | number[]): void {
  try {
    if (coarsePointer() && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern)
  } catch {
    /* never let haptics break a celebration */
  }
}

let suppressOverride: boolean | null = null

/**
 * Where the 「完成！」 badge sits (viewport CSS px) before it is on the page —
 * mirrors fx.css (.fx-cele-host padding-top 64 px / 60 px at ≤ 480 px,
 * .fx-cele-badge max-width min(86vw, 420px); 176 px tall with a one-line
 * message, 197 px with two). The fallback when the real box cannot be
 * measured (measuredBadgeRect); the 3D confetti never bursts from behind it.
 */
export function badgeRect(): ScreenRect | undefined {
  if (typeof window === 'undefined') return undefined
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (!(vw > 0 && vh > 0)) return undefined
  const top = vw <= 480 ? 60 : 64
  const w = Math.min(0.86 * vw, 420)
  return { x0: vw / 2 - w / 2, y0: top, x1: vw / 2 + w / 2, y1: top + 200 }
}

/**
 * The real 「完成！」 badge's box (viewport CSS px) once it is on the page:
 * its LAYOUT box (offsets inside the fixed host), not getBoundingClientRect —
 * the pop animation scales it while the confetti is aimed. Undefined when
 * no badge is mounted.
 */
export function measuredBadgeRect(): ScreenRect | undefined {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return undefined
  const el = document.querySelector<HTMLElement>('.fx-cele-badge')
  const host = el?.offsetParent
  if (!el || !host || !(el.offsetWidth > 0 && el.offsetHeight > 0)) return undefined
  const r = host.getBoundingClientRect()
  const x0 = r.left + el.offsetLeft
  const y0 = r.top + el.offsetTop
  return { x0, y0, x1: x0 + el.offsetWidth, y1: y0 + el.offsetHeight }
}

/**
 * The lesson-pass 3D burst, aimed clear of the badge: on the next frame
 * (the badge is rendered by then — its message may wrap to two lines) with
 * its measured box; at once with the estimate when there is no frame to
 * wait for (node tests, a hidden tab).
 */
function emitClearOfBadge(fx: SceneFxEvent): void {
  const go = (): void => {
    const avoid = measuredBadgeRect() ?? badgeRect()
    if (avoid) fx.avoid = avoid
    emitSceneFx(fx)
  }
  const raf = typeof window !== 'undefined' ? window.requestAnimationFrame : undefined
  if (typeof raf === 'function' && typeof document !== 'undefined' && !document.hidden) raf.call(window, go)
  else go()
}

/**
 * The page runs under the visual-regression / screenshot harness
 * (`?shotrig`) without `&cheer`: celebrations would make its shots depend
 * on timing, so there are none.
 */
export function celebrationsSuppressed(): boolean {
  if (suppressOverride !== null) return suppressOverride
  try {
    if (typeof window === 'undefined' || !window.location) return false
    const q = new URLSearchParams(window.location.search)
    return q.has('shotrig') && !q.has('cheer')
  } catch {
    return false
  }
}

/**
 * Celebrate a REAL success (see the module doc). Safe anywhere: without a
 * mounted scene the 3D part is skipped, in node tests the sound and haptics
 * are no-ops.
 */
export function celebrate(kind: CelebrationKind, opts: CelebrationOptions = {}): void {
  if (celebrationsSuppressed()) {
    useCelebration.setState((s) => ({ suppressed: s.suppressed + 1 }))
    return
  }
  const now = nowMs()
  const last = lastAt[kind]
  if (last !== undefined && now - last < DEDUPE_MS) return
  lastAt[kind] = now

  const componentIds = (opts.componentIds ?? []).filter((id) => typeof id === 'string' && id !== '')
  const fx: SceneFxEvent = { type: 'celebrate', kind, componentIds }

  const st = useCelebration.getState()
  const count = { ...st.count, [kind]: st.count[kind] + 1 }
  if (isLegacyChrome()) {
    emitSceneFx(fx)
    useCelebration.setState({ count })
    return
  }
  if (kind === 'lesson-pass') {
    const badge: CelebrationBadge = { id: nextId++, kind, title: t('Done!'), at: Date.now() }
    if (opts.message) badge.message = opts.message
    useCelebration.setState({ badge, count })
    emitClearOfBadge(fx)
    if (badgeTimer !== null) clearTimeout(badgeTimer)
    badgeTimer = setTimeout(() => {
      badgeTimer = null
      if (useCelebration.getState().badge?.id === badge.id) useCelebration.setState({ badge: null })
    }, BADGE_MS)
    playCue('success')
    haptic([18, 60, 18, 60, 40])
  } else {
    emitSceneFx(fx)
    useCelebration.setState({ count })
    const head = t('Circuit working ✓')
    showToast(opts.message ? `${head} · ${opts.message}` : head, { duration: 3400 })
    playCue('success', { short: true })
    haptic(14)
  }
}

/** Tests: forget the dedupe clock and the badge. */
export function __resetCelebrationForTests(): void {
  for (const k of Object.keys(lastAt) as CelebrationKind[]) delete lastAt[k]
  if (badgeTimer !== null) clearTimeout(badgeTimer)
  badgeTimer = null
  useCelebration.setState({ badge: null, count: { 'lesson-pass': 0, 'circuit-ok': 0 }, suppressed: 0 })
  suppressOverride = null
}

/** Tests: act as if the page were (true) / were not (false) under the harness; null = read the URL. */
export function __setCelebrationsSuppressedForTests(v: boolean | null): void {
  suppressOverride = v
}
