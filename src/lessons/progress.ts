/**
 * Lesson progress (persisted in localStorage 'bb.lessons'): per lesson —
 * started / completed timestamps, the current step, the steps whose own
 * check passed, when the start circuit / the solution was last loaded,
 * whether the completion used the solution, the last acceptance run's score
 * and the last time anything changed — plus the lesson the coach card was
 * guiding (restored after a reload). A zustand store so the library cards,
 * the lesson view and the coach card stay in sync; reads and writes are
 * hardened (private mode, quota, malformed or foreign data never throw — a
 * bad entry is dropped, not half-read).
 *
 *   {
 *     "v": 1,
 *     "guiding": "b1-led-resistor",
 *     "lessons": {
 *       "b1-led-resistor": { "startedAt": 1760000000000, "completedAt": 1760000900000,
 *                            "step": 3, "stepsDone": ["place-led", "wire"],
 *                            "startLoadedAt": 1760000000000,
 *                            "lastCheck": { "passed": 6, "total": 6, "at": 1760000900000 },
 *                            "updatedAt": 1760000900000 }
 *     }
 *   }
 *
 * Optional fields are omitted when unset, so older documents read the same.
 */
import { create } from 'zustand'

export const LESSONS_STORAGE_KEY = 'bb.lessons'
export const LESSON_PROGRESS_VERSION = 1

export interface LessonCheckScore {
  passed: number
  total: number
  /** ms since epoch the run finished */
  at: number
}

export interface LessonProgressEntry {
  /** ms since epoch: first time the lesson was started (start circuit loaded / guide opened) */
  startedAt?: number
  /** ms since epoch: every acceptance check passed (kept when re-run fails later) */
  completedAt?: number
  /** current step index (0-based) */
  step: number
  /** ids of steps whose check passed */
  stepsDone: string[]
  /** ms since epoch: the start circuit was last loaded */
  startLoadedAt?: number
  /** ms since epoch: the solution ("顯示解答") was last loaded */
  solutionLoadedAt?: number
  /** the completion came after loading the solution (no start load since) — 「以解答完成」 */
  viaSolution?: true
  /** the last acceptance run (header chip 「上次檢查 p/n」) */
  lastCheck?: LessonCheckScore
  /** ms since epoch of the last change */
  updatedAt: number
}

export interface LessonProgressState {
  lessons: Record<string, LessonProgressEntry>
  /** the lesson the coach card guides (restored on the next visit), null = none */
  guiding: string | null
  /** mark started (keeps an earlier start time) */
  start(id: string): void
  /** set the current step (starts the lesson when needed) */
  setStep(id: string, step: number): void
  /** record a passed step check */
  markStepDone(id: string, stepId: string): void
  /** record a full pass of the acceptance checks */
  complete(id: string): void
  /** the start circuit or the solution was loaded onto the board */
  loaded(id: string, which: 'start' | 'solution'): void
  /** record an acceptance run's score */
  recordCheck(id: string, passed: number, total: number): void
  /** remember which lesson the coach guides (null = none) */
  setGuiding(id: string | null): void
  /** forget one lesson's progress */
  reset(id: string): void
}

/** Clock (tests may replace it). */
let clock: () => number = () => Date.now()
export function __setLessonClockForTests(fn: (() => number) | null): void {
  clock = fn ?? (() => Date.now())
}

function isTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000
}

function isLessonId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 128
}

/** One persisted entry, sanitized (null when unusable). */
export function sanitizeEntry(raw: unknown): LessonProgressEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const step = typeof r.step === 'number' && Number.isInteger(r.step) && r.step >= 0 && r.step < 1000 ? r.step : 0
  const stepsDone = Array.isArray(r.stepsDone)
    ? [...new Set(r.stepsDone.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 128))].slice(0, 200)
    : []
  const entry: LessonProgressEntry = { step, stepsDone, updatedAt: isTime(r.updatedAt) ? r.updatedAt : 0 }
  if (isTime(r.startedAt)) entry.startedAt = r.startedAt
  if (isTime(r.completedAt)) entry.completedAt = r.completedAt
  if (isTime(r.startLoadedAt)) entry.startLoadedAt = r.startLoadedAt
  if (isTime(r.solutionLoadedAt)) entry.solutionLoadedAt = r.solutionLoadedAt
  if (r.viaSolution === true && entry.completedAt !== undefined) entry.viaSolution = true
  const lc = r.lastCheck as Record<string, unknown> | undefined
  if (lc && typeof lc === 'object' && isCount(lc.passed) && isCount(lc.total) && lc.passed <= lc.total && lc.total > 0 && isTime(lc.at)) {
    entry.lastCheck = { passed: lc.passed, total: lc.total, at: lc.at }
  }
  return entry
}

interface ProgressDoc {
  lessons: Record<string, LessonProgressEntry>
  guiding: string | null
}

function parseDoc(text: string | null): ProgressDoc {
  const empty: ProgressDoc = { lessons: {}, guiding: null }
  if (!text) return empty
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return empty
  }
  if (!raw || typeof raw !== 'object') return empty
  const doc = raw as { v?: unknown; lessons?: unknown; guiding?: unknown }
  if (doc.v !== LESSON_PROGRESS_VERSION || !doc.lessons || typeof doc.lessons !== 'object' || Array.isArray(doc.lessons)) return empty
  const out: Record<string, LessonProgressEntry> = {}
  for (const [id, e] of Object.entries(doc.lessons as Record<string, unknown>)) {
    if (!id || id.length > 128) continue
    const entry = sanitizeEntry(e)
    if (entry) out[id] = entry
  }
  return { lessons: out, guiding: isLessonId(doc.guiding) ? doc.guiding : null }
}

/** The persisted document, sanitized (unknown versions are ignored, never half-read). */
export function parseProgress(text: string | null): Record<string, LessonProgressEntry> {
  return parseDoc(text).lessons
}

/** The lesson the coach was guiding when the document was saved (null = none / unusable). */
export function parseGuiding(text: string | null): string | null {
  return parseDoc(text).guiding
}

function load(): ProgressDoc {
  try {
    if (typeof localStorage === 'undefined') return { lessons: {}, guiding: null }
    return parseDoc(localStorage.getItem(LESSONS_STORAGE_KEY))
  } catch {
    return { lessons: {}, guiding: null }
  }
}

function save(lessons: Record<string, LessonProgressEntry>, guiding: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (Object.keys(lessons).length === 0 && !guiding) localStorage.removeItem(LESSONS_STORAGE_KEY)
    else
      localStorage.setItem(
        LESSONS_STORAGE_KEY,
        JSON.stringify(guiding ? { v: LESSON_PROGRESS_VERSION, guiding, lessons } : { v: LESSON_PROGRESS_VERSION, lessons }),
      )
  } catch {
    /* storage unavailable / full: progress lives for this session only */
  }
}

function blank(): LessonProgressEntry {
  return { step: 0, stepsDone: [], updatedAt: 0 }
}

const initial = load()

export const useLessonProgress = create<LessonProgressState>()((set, get) => {
  const update = (id: string, fn: (e: LessonProgressEntry, at: number) => LessonProgressEntry) => {
    const at = clock()
    const cur = get().lessons[id] ?? blank()
    const next = { ...fn({ ...cur, stepsDone: [...cur.stepsDone] }, at), updatedAt: at }
    const lessons = { ...get().lessons, [id]: next }
    set({ lessons })
    save(lessons, get().guiding)
  }
  return {
    lessons: initial.lessons,
    guiding: initial.guiding,
    start(id) {
      update(id, (e, at) => (e.startedAt === undefined ? { ...e, startedAt: at } : e))
    },
    setStep(id, step) {
      const s = Number.isInteger(step) && step >= 0 ? step : 0
      update(id, (e, at) => ({ ...e, step: s, startedAt: e.startedAt ?? at }))
    },
    markStepDone(id, stepId) {
      update(id, (e, at) => ({
        ...e,
        startedAt: e.startedAt ?? at,
        stepsDone: e.stepsDone.includes(stepId) ? e.stepsDone : [...e.stepsDone, stepId],
      }))
    },
    complete(id) {
      update(id, (e, at) => {
        // the solution was loaded and no start circuit since: a copied result
        const viaSolution = e.solutionLoadedAt !== undefined && e.solutionLoadedAt > (e.startLoadedAt ?? -1)
        const next: LessonProgressEntry = { ...e, startedAt: e.startedAt ?? at }
        if (e.completedAt === undefined) {
          next.completedAt = at
          if (viaSolution) next.viaSolution = true
        } else if (e.viaSolution && !viaSolution) {
          // earned on the learner's own circuit after an earlier "solution" completion
          next.completedAt = at
          delete next.viaSolution
        }
        return next
      })
    },
    loaded(id, which) {
      update(id, (e, at) =>
        which === 'start' ? { ...e, startedAt: e.startedAt ?? at, startLoadedAt: at } : { ...e, solutionLoadedAt: at },
      )
    },
    recordCheck(id, passed, total) {
      if (!isCount(passed) || !isCount(total) || total === 0 || passed > total) return
      update(id, (e, at) => ({ ...e, lastCheck: { passed, total, at } }))
    },
    setGuiding(id) {
      const next = id && isLessonId(id) ? id : null
      if (next === get().guiding) return
      set({ guiding: next })
      save(get().lessons, next)
    },
    reset(id) {
      if (!(id in get().lessons)) return
      const lessons = { ...get().lessons }
      delete lessons[id]
      const guiding = get().guiding === id ? null : get().guiding
      set({ lessons, guiding })
      save(lessons, guiding)
    },
  }
})

/** Re-read localStorage (tests; another tab's changes on focus). */
export function reloadLessonProgress(): void {
  const doc = load()
  useLessonProgress.setState({ lessons: doc.lessons, guiding: doc.guiding })
}
