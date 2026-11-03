/**
 * Automatic 換新 (round 5 — damage: 「燒掉的 LED 要刪掉、重放、重設參數？」
 * — no: fix what burned it and a new one is in). A part the simulation
 * destroyed comes back by itself when the user changes what destroyed it:
 *
 *   1. a structural edit (a part, a hole, a wire, a build-time value such as
 *      a resistance, undo / redo, a load) rebuilds the world — the store's
 *      layout subscription reloads the host and every part is new (the
 *      heal-on-edit contract; nothing to do here);
 *   2. a VALUE the live world takes without a rebuild — a catalog runtime
 *      param that is not a mechanical control: the supply's voltage and
 *      current limit, a pot's or a contrast knob's position, the function
 *      generator's settings, a sensor's environment … — replaces the
 *      destroyed parts (SimHost.repairParts) AUTO_HEAL_MS after the last
 *      such change. The changes up to that quiet moment are one turn of the
 *      knob (a slider drag, a run of stepper clicks): it heals once, at its
 *      end, never on every step.
 *
 * What one turn of the knob may bring back (no part burns twice for it):
 *   - only the parts that were already destroyed when the turn BEGAN — a
 *     part destroyed during the turn (the supply dragged up through the
 *     burn point) stays destroyed, as a real one would;
 *   - not a part destroyed while a value was pushed one way, by a turn
 *     that only pushes the same value(s) further the same way (stepping
 *     the supply up after the LED popped). Turning it back, or changing any
 *     other value, brings a new one; 〔換新〕 always does;
 *   - nothing when the turn ends where it began (the value is back where it
 *     was).
 *
 * Mechanical controls never heal: pressing a button, flipping a switch /
 * slide / toggle, DIP bits, jumpers, the multimeter's mode, a remote's key —
 * those USE the circuit, they do not fix it (a real burned part stays
 * burned when you press a button). 〔換新〕 (replace-part.ts) is the one
 * click for every other case.
 *
 * Honest: when the new value still overloads the part, the running
 * simulation burns it again (a new burst, issue and banner). A commit that
 * rebuilt (the host's 'loaded' event names that very layout) needs no heal
 * — every part is new already — and cancels a pending one, as do 重置模擬
 * and a disposed host.
 *
 * Product chrome only (App.tsx mounts it outside isLegacyChrome). Non-React:
 * one store subscription and one host listener, nothing per frame (a
 * telemetry push costs one reference comparison).
 */
import type { ParamDef } from '../../model/catalog'
import { getEntry } from '../../model/catalog'
import type { CircuitLayout, ComponentInstance } from '../../model/types'
import { t } from '../../i18n'
import { onSimHostEvent, peekSimHost, useStore } from '../../state/store'
import { announceReplaced, replaceableParts } from './replace-part'

/** Quiet time after the last value change before the damaged parts are replaced (ms). */
export const AUTO_HEAL_MS = 400

/**
 * Runtime params that are a mechanical control's position, by key (besides
 * every boolean one — a button's `pressed`, a jumper, a remote's `hold`, a
 * link switch): switch / slide / toggle `state`, DIP `on` bits, the BOOT0
 * jumper, the multimeter's `mode`, an IR remote's key, I²C address jumpers.
 */
const MECHANICAL_KEYS: ReadonlySet<string> = new Set(['state', 'on', 'boot0', 'mode', 'remoteButton', 'address'])

/** Is this runtime param a mechanical control (using the circuit, never fixing it)? */
export function isMechanicalParam(def: Pick<ParamDef, 'key' | 'kind'>): boolean {
  return def.kind === 'boolean' || MECHANICAL_KEYS.has(def.key)
}

function effective(comp: ComponentInstance, def: ParamDef): unknown {
  return comp.params?.[def.key] ?? def.default
}

/** One healing value a change touched: `key` = '<part id>\u0000<param key>'. */
export interface HealingChange {
  key: string
  from: unknown
  to: unknown
}

const keyOf = (id: string, param: string): string => `${id}\u0000${param}`

/**
 * The non-mechanical runtime values `next` changed, of the parts present in
 * both layouts (same id and type). Pure — a new part, a removed one or a
 * structural param is a rebuild's business, not this one's.
 */
export function healingChanges(prev: CircuitLayout, next: CircuitLayout): HealingChange[] {
  const out: HealingChange[] = []
  if (prev.components === next.components) return out
  const before = new Map<string, ComponentInstance>()
  for (const c of prev.components) before.set(c.id, c)
  for (const c of next.components) {
    const old = before.get(c.id)
    if (!old || old === c || old.type !== c.type || old.params === c.params) continue
    for (const def of getEntry(c.type)?.params ?? []) {
      if (def.runtime !== true || isMechanicalParam(def)) continue
      const from = effective(old, def)
      const to = effective(c, def)
      if (from !== to) out.push({ key: keyOf(c.id, def.key), from, to })
    }
  }
  return out
}

/** Did `next` change a non-mechanical runtime value (healingChanges is not empty)? */
export function changesHealingValue(prev: CircuitLayout, next: CircuitLayout): boolean {
  return healingChanges(prev, next).length > 0
}

/**
 * Where one turn of the knob moved each value it touched, from its value
 * when the turn began to its value now: +1 up, −1 down, 0 changed without
 * a direction (a waveform, a mode string). A value back where it began is
 * left out — it did not move.
 */
export type TurnDirections = ReadonlyMap<string, -1 | 0 | 1>

function valueNow(layout: CircuitLayout, key: string): { found: boolean; value: unknown } {
  const cut = key.indexOf('\u0000')
  const id = key.slice(0, cut)
  const param = key.slice(cut + 1)
  const comp = layout.components.find((c) => c.id === id)
  const def = comp ? getEntry(comp.type)?.params?.find((d) => d.key === param) : undefined
  return comp && def ? { found: true, value: effective(comp, def) } : { found: false, value: undefined }
}

/** The directions of a turn that began at `start` (key → value then) and stands at `layout` now. */
export function turnDirections(start: ReadonlyMap<string, unknown>, layout: CircuitLayout): TurnDirections {
  const out = new Map<string, -1 | 0 | 1>()
  for (const [key, from] of start) {
    const now = valueNow(layout, key)
    if (!now.found || now.value === from) continue
    const to = now.value
    out.set(key, typeof from === 'number' && typeof to === 'number' ? (to > from ? 1 : to < from ? -1 : 0) : 0)
  }
  return out
}

/**
 * Does turn `dirs` only push on what destroyed a part — every value it
 * moved, moved the same way as during the turn that destroyed the part
 * (`blame`)? Then it cannot be the fix: the part stays destroyed.
 */
export function pushesOn(blame: TurnDirections | undefined, dirs: TurnDirections): boolean {
  if (!blame || blame.size === 0 || dirs.size === 0) return false
  for (const [key, dir] of dirs) if (dir === 0 || blame.get(key) !== dir) return false
  return true
}

/**
 * Start the automatic 換新 (App.tsx, product chrome); returns the stop
 * function. `delayMs` = AUTO_HEAL_MS (tests may shorten it).
 */
export function startAutoHeal(opts: { delayMs?: number } = {}): () => void {
  const delay = opts.delayMs ?? AUTO_HEAL_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  /** the layout the host loaded last (a commit that rebuilt names it) */
  let loaded: CircuitLayout | null = null
  /**
   * The turn of the knob in progress: the parts destroyed when it began
   * (what it may bring back) and each value it touched → its value then.
   */
  let turn: { before: readonly string[]; start: Map<string, unknown> } | null = null
  /** destroyed parts → the directions of the turn that destroyed them */
  const blame = new Map<string, TurnDirections>()
  /** the last turn that ended: its directions, the parts it replaced, those still destroyed after it */
  let last: { dirs: TurnDirections; replaced: readonly string[]; destroyed: readonly string[] } | null = null

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    turn = null
  }
  /** a new world (rebuilt, reset, gone): every part new, nothing to blame */
  const forget = (): void => {
    cancel()
    blame.clear()
    last = null
  }

  /** The end of a turn: replace what it may bring back; blame it for what it destroyed. */
  const endTurn = (): void => {
    timer = null
    const done = turn
    turn = null
    if (!done) return
    const s = useStore.getState()
    const dirs = turnDirections(done.start, s.layout)
    const now = replaceableParts(s.telemetry)
    for (const id of now) if (!done.before.includes(id)) blame.set(id, dirs) // destroyed during this turn
    const ids = dirs.size === 0 ? [] : done.before.filter((id) => now.includes(id) && !pushesOn(blame.get(id), dirs))
    for (const id of ids) blame.delete(id)
    last = { dirs, replaced: ids, destroyed: now.filter((id) => !ids.includes(id)) }
    if (ids.length > 0) heal(ids)
  }

  const offHost = onSimHostEvent((e) => {
    if (e.kind === 'loaded') {
      // a rebuild: every part is new already (a debounced reload lands here too)
      loaded = e.layout
      forget()
    } else if (e.kind === 'reset' || e.kind === 'disposed') {
      forget()
    }
  })
  const offStore = useStore.subscribe((s, prev) => {
    if (s.layout === prev.layout) return
    if (s.layout === loaded) {
      forget() // this commit rebuilt (the store's subscription loaded it first)
      return
    }
    const changes = healingChanges(prev.layout, s.layout)
    if (changes.length === 0) return
    if (!turn) {
      // a new turn of the knob: what it may fix — the parts destroyed right now
      const before = replaceableParts(s.telemetry)
      for (const id of [...blame.keys()]) if (!before.includes(id)) blame.delete(id) // whole again (〔換新〕)
      for (const id of before) {
        // destroyed after the last turn ended, whole when it ended and not one it replaced: that turn's values did it
        if (blame.has(id) || !last || last.replaced.includes(id) || last.destroyed.includes(id)) continue
        blame.set(id, last.dirs)
      }
      turn = { before, start: new Map() }
    }
    for (const c of changes) if (!turn.start.has(c.key)) turn.start.set(c.key, c.from)
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(endTurn, delay)
  })
  return () => {
    forget()
    offHost()
    offStore()
  }
}

/** Replace `ids` (destroyed when their turn began, still destroyed): a new frame, the insert sound, a toast. */
function heal(ids: readonly string[]): void {
  const h = peekSimHost()
  if (!h || typeof h.repairParts !== 'function') return
  try {
    h.repairParts(ids)
  } catch {
    return // a dead host: the store's own error path reports it
  }
  announceReplaced(t('Replaced with new parts automatically: {ids}', { ids: ids.join(t(', |damage-list')) }))
}
