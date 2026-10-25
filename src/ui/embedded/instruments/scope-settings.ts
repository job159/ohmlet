/**
 * Oscilloscope front-panel settings — one small zustand store shared by
 * every ScopeView instance (desktop tray + phone sheet), persisted per
 * browser in localStorage 'bb.scopeView' (tolerant of missing / corrupt /
 * blocked storage). Pure sanitizer exported for tests.
 */
import { create } from 'zustand'
import { fmtSi } from '../../../instruments/format'
import { useLab } from '../lab'

export type ScopeTrigMode = 'auto' | 'normal' | 'single'
export type ScopeCursorMode = 'off' | 'time' | 'volt'

export interface ScopeSettings {
  /** horizontal scale, s per division (10 divisions) */
  tdiv: number
  /** vertical scale, V per division (8 divisions), or 'auto' (legacy autoscale) */
  vdiv: number | 'auto'
  /** fixed scale: divisions between the screen bottom and 0 V */
  vpos: number
  /** trigger source channel 0..3, null = off (free-running roll) */
  trigSource: number | null
  trigSlope: 'rising' | 'falling'
  /** V */
  trigLevel: number
  trigMode: ScopeTrigMode
  /** s */
  holdoff: number
  cursors: ScopeCursorMode
  /**
   * axis labels in absolute simulation time (the logic analyzer's clock)
   * instead of relative to the trigger / window end (UX IS-8)
   */
  absTime: boolean
}

/** 1-2-5 ladder, 1 µs/div … 2 s/div. */
export const TDIVS: readonly number[] = (() => {
  const out: number[] = []
  for (let e = -6; e <= -1; e++) for (const m of [1, 2, 5]) out.push(Number((m * 10 ** e).toPrecision(3)))
  out.push(1, 2)
  return out
})()

export const VDIVS: readonly number[] = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10]

export const HOLDOFFS: readonly number[] = [0, 1e-6, 10e-6, 100e-6, 1e-3, 10e-3, 100e-3, 1]

export const SCOPE_DEFAULTS: ScopeSettings = {
  tdiv: 0.5,
  vdiv: 'auto',
  vpos: 1,
  trigSource: null,
  trigSlope: 'rising',
  trigLevel: 1.65,
  trigMode: 'auto',
  holdoff: 0,
  cursors: 'off',
  absTime: false,
}

const LS_KEY = 'bb.scopeView'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function sanitizeScopeSettings(raw: unknown): ScopeSettings {
  const out: ScopeSettings = { ...SCOPE_DEFAULTS }
  if (!isObject(raw)) return out
  if (typeof raw.tdiv === 'number' && TDIVS.includes(raw.tdiv)) out.tdiv = raw.tdiv
  if (raw.vdiv === 'auto' || (typeof raw.vdiv === 'number' && VDIVS.includes(raw.vdiv))) out.vdiv = raw.vdiv
  if (typeof raw.vpos === 'number' && Number.isInteger(raw.vpos) && Math.abs(raw.vpos) <= 16) out.vpos = raw.vpos
  if (raw.trigSource === null || (typeof raw.trigSource === 'number' && [0, 1, 2, 3].includes(raw.trigSource))) {
    out.trigSource = raw.trigSource as number | null
  }
  if (raw.trigSlope === 'rising' || raw.trigSlope === 'falling') out.trigSlope = raw.trigSlope
  if (typeof raw.trigLevel === 'number' && Number.isFinite(raw.trigLevel) && Math.abs(raw.trigLevel) <= 1000) {
    out.trigLevel = raw.trigLevel
  }
  if (raw.trigMode === 'auto' || raw.trigMode === 'normal' || raw.trigMode === 'single') out.trigMode = raw.trigMode
  if (typeof raw.holdoff === 'number' && HOLDOFFS.includes(raw.holdoff)) out.holdoff = raw.holdoff
  if (raw.cursors === 'off' || raw.cursors === 'time' || raw.cursors === 'volt') out.cursors = raw.cursors
  if (typeof raw.absTime === 'boolean') out.absTime = raw.absTime
  return out
}

function load(): ScopeSettings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return sanitizeScopeSettings(raw ? (JSON.parse(raw) as unknown) : null)
  } catch {
    return { ...SCOPE_DEFAULTS }
  }
}

interface ScopeSettingsState extends ScopeSettings {
  /**
   * an example / project with scope probes and no front-panel preset was
   * opened: the scope runs 「自動設定」 the first time it is shown with data
   * (UX IS-2). Session only, never persisted.
   */
  autoPending: boolean
  set(p: Partial<ScopeSettings> & { autoPending?: boolean }): void
}

export const useScopeSettings = create<ScopeSettingsState>()((set, get) => ({
  ...load(),
  autoPending: false,
  set(p) {
    set(p)
    const { set: _s, autoPending: _a, ...rest } = { ...get() }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(rest))
    } catch {
      // storage blocked: settings last for this session
    }
  },
}))

/**
 * Example / project presets (lab.scopePreset, envelope `instruments.scope`):
 * the known fields are sanitized over the current settings; an import that
 * carries scope probes but no preset (`settings` = {}) asks for an
 * automatic setup instead.
 */
let lastPresetSeq = 0
function applyPreset(p: { seq: number; settings: Record<string, unknown> } | null): void {
  if (!p || p.seq === lastPresetSeq) return
  lastPresetSeq = p.seq
  const s = useScopeSettings.getState()
  if (Object.keys(p.settings).length === 0) {
    s.set({ autoPending: true })
    return
  }
  const { set: _s, autoPending: _a, ...cur } = s
  s.set({ ...sanitizeScopeSettings({ ...cur, ...p.settings }), autoPending: false })
}
applyPreset(useLab.getState().scopePreset)
useLab.subscribe((st, prev) => {
  if (st.scopePreset !== prev.scopePreset) applyPreset(st.scopePreset)
})

/** "2 ms/div", "500 µs/div", "1 s/div" */
export function fmtDiv(x: number, unit: string): string {
  return `${fmtSi(x, unit, 3).replace(/\.0+ /, ' ').replace(/(\.\d*?)0+ /, '$1 ')}/div`
}

/** Parse a level typed by the user: "1.65", "1.65 V", "-0.5", "500m", "500 mV". */
export function parseVolts(text: string): number | null {
  const m = /^\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(m|µ|u)?\s*v?\s*$/i.exec(text)
  if (!m) return null
  const k = m[2] === 'm' ? 1e-3 : m[2] === 'µ' || m[2] === 'u' ? 1e-6 : 1
  const v = Number(m[1]) * k
  return Number.isFinite(v) && Math.abs(v) <= 1000 ? v : null
}
