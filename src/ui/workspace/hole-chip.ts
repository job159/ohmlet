/**
 * Informative hover chip text (UX wave contract K5 — SC-4), wired by App.tsx
 * as SceneCallbacks.holeLabelText with holeLabelFor as the fallback:
 *
 *   holeChipText(hole): string | null
 *
 * What the hole IS and what it connects to, in words:
 *  (a) an MCU pin sits in it → 「U1 PA5（板上 A5）· c20」 — the H1 full form
 *      with the board id, as on every surface outside the board's own
 *      inspector (release QA SC-F2: also with a single board, so the chip,
 *      the wire hint and the Problems rows all say 「U1 PA5」);
 *  (b) another part's pin → 「LED1 陽極（長腳）· b40」 (H1 pinLabel);
 *  (c) a wire end → 「導線 W3 · a10」, on a strip with the strip's name
 *      「導線 W3 · a20（U1 PA5 這一排）」;
 *  (d) an empty strip hole whose 5-hole strip holds pins / wire ends → its
 *      H2 name 「a20（U1 PA5 這一排）」 — the same words as the wire hint
 *      「從 a20（U1 PA5 這一排）拉線」 (requests round: one hole, one name);
 *      a strip holding only wire ends → 「a20（導線 W3 這一排）」;
 *  (e) a rail hole → 「上方 + 電源軌 · 第 10 孔（top+10）」, after the
 *      occupant when one sits in it (the ref stays: lesson texts quote
 *      `bot+31`, the chip is where the learner matches it);
 *  (f) an off-board terminal → 「PS1 正端」 (SC-12);
 *  otherwise null (the scene keeps the plain ref).
 *
 * objectChipText(id) is the neutral chip over a part body / wire in select
 * mode (SC-12): 「U1 · STM32F103C8T6 Blue Pill 開發板 · 點一下選取」, and
 * 「… · 已選取」 once it is selected (SC-F2). A wire's chip names its colour
 * and why (product chrome — wire-roles, the inspector's words): 「導線 W1 ·
 * 紅色：電源正極（5 V 網路）· 點一下選取」.
 *
 * Live data (SC-4) while a simulation session exists (telemetry non-null):
 *  - MCU GPIO pins add the firmware-programmed mode in the inspector's own
 *    words — 「U1 PA5（板上 A5）· 推挽輸出 · 3.30 V · c20」;
 *  - every pin / wire end / rail / strip text adds what the hole's net is
 *    doing (UX fix wave SC-12 — the shared helpers H3 / H4, so the chip and
 *    the inspector never disagree): 「PWM 1.000 kHz · 34.0 %」 on a recorded
 *    PWM net, 「3.10 V」 on a steady one, 「3.10 V（瞬時）」 on an unrecorded
 *    net seen switching — omitted when the strip is not part of the circuit
 *    or the solver has no trustworthy value (never a guessed number);
 *  - an off-board terminal ref ("PS1:+") gets its own chip: 「PS1 正端 ·
 *    5.00 V」 (H1 terminalLabel);
 *  - pins of a part that can be held down in 3D (a 'pressed' param) end
 *    with 「按住即可按下 · 雙擊保持按下」 — 「已保持按下 · 按一下放開」 while
 *    it is kept pressed (the latch, src/ui/embedded/latch.ts); its body's
 *    object chip says the same instead of 「點一下選取」.
 *  - a function generator's output net says what the generator is SET to,
 *    「導線 W2 · 方波 100 Hz · 0–5.00 V · a10（R1 第 1 腳這一排）」 — the pin rows'
 *    and the 量測 tab's words (H4 NetLive 'source'), never the instantaneous
 *    value that jumps between 0 V and 5 V with the wave.
 * The scene re-asks while the chip rests (≤ 4 Hz), once when the session
 * ends and whenever the layout changes under it (a deleted part takes its
 * chip with it), so a voltage never goes stale and never outlives the
 * simulation.
 *
 * Pure function of the store's layout + telemetry (read with getState —
 * hover never re-renders React). The occupancy index and the netlist are
 * rebuilt once per layout identity; a lookup is a few map reads. Never
 * throws.
 *
 * Also the static names every other surface uses (UX helper H2):
 *   endpointName(layout, ref)   「U1 PA0（a25）」「a25（U1 PA0 這一排）」
 *                               「a33（R1 第 1 腳這一排）」
 *                               「上方 − 電源軌 第 20 孔」「PS1 正端」
 *   wireRefusalText(refusal)    why store.wireRefusal / moveWireEnd said no
 */
import type { CircuitLayout, Hole, HoleRef, RailId, SimTelemetry } from '../../model/types'
import { boardConfigOf } from '../../model/types'
import { getEntry, type CatalogEntry } from '../../model/catalog'
import { componentPinHoles, formatHole, netIdForHole, parseHole, parseTerminalRef } from '../../model/breadboard'
import { buildNetlist, type Netlist } from '../../sim/netlist'
import { useStore, type WireRefusal } from '../../state/store'
import { t } from '../../i18n'
import { partLabel, pinDisplayName, pinLabel, terminalLabel } from '../../i18n/parts'
import { fmtVoltage, isTrustedVoltage } from '../../instruments/format'
import { getNetLive, hasActivity, netLiveText } from '../embedded/instruments/net-activity'
import { tc } from '../format'
import { tidyCjkSpaces } from '../../i18n/tidy'
import { canPress, isLatched } from '../embedded/latch'
import { wireRoleOf } from '../wire-roles'
import { isLegacyChrome } from '../chrome/legacy'

/** One thing plugged into a hole. */
type Occupant =
  | { kind: 'pin'; id: string; entry: CatalogEntry; pin: string; mcu: boolean }
  | { kind: 'wire'; id: string }

interface ChipIndex {
  /** canonical hole ref → occupant */
  byHole: Map<string, Occupant>
  /** static strip / rail net id → occupants, in layout order */
  byStrip: Map<string, Occupant[]>
}

let cache: { layout: CircuitLayout; index: ChipIndex } | null = null

function indexOf(layout: CircuitLayout): ChipIndex {
  if (cache?.layout === layout) return cache.index
  const byHole = new Map<string, Occupant>()
  const byStrip = new Map<string, Occupant[]>()
  const put = (h: Hole, o: Occupant) => {
    const ref = formatHole(h)
    if (!byHole.has(ref)) byHole.set(ref, o)
    const net = netIdForHole(h)
    const list = byStrip.get(net)
    if (list) list.push(o)
    else byStrip.set(net, [o])
  }
  const config = boardConfigOf(layout)
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry || entry.placement === 'offboard') continue
    const holes = componentPinHoles(comp, entry, config)
    if (!holes) continue
    holes.forEach((h, i) => {
      if (h) put(h, { kind: 'pin', id: comp.id, entry, pin: entry.pins[i], mcu: !!entry.mcu })
    })
  }
  for (const w of layout.wires) {
    for (const end of [w.from, w.to]) {
      const h = parseHole(end)
      if (h) put(h, { kind: 'wire', id: w.id })
    }
  }
  const index = { byHole, byStrip }
  cache = { layout, index }
  return index
}

// ---------------------------------------------------------------------------
// live values (SC-4)
// ---------------------------------------------------------------------------

let netCache: { layout: CircuitLayout; netlist: Netlist | null } | null = null

function netlistOf(layout: CircuitLayout): Netlist | null {
  if (netCache?.layout === layout) return netCache.netlist
  let netlist: Netlist | null = null
  try {
    netlist = buildNetlist(layout)
  } catch {
    netlist = null
  }
  netCache = { layout, netlist }
  return netlist
}

/** How far back (s of sim time) a level change counts as "this net is switching" (live chip). */
const ACTIVITY_WINDOW_S = 2

/**
 * The live value of `ref`'s net in the chip (SC-12 (4), H3 + H4): a PWM
 * net reads 「PWM 1.000 kHz · 34.0 %」, a recorded non-periodic one
 * 「訊號變化中（非週期）」, a steady one 「3.10 V」; a net the logic recorder
 * does not see is the solver's instantaneous value — 「3.10 V（瞬時）」 once
 * it was seen switching, never a PWM guessed from it. '' when there is no
 * trustworthy value (no session, not in the circuit, no solution, |V| >
 * 1 kV) — the chip then says nothing rather than something wrong. The H4
 * reads only apply to the live document (`layout` is the store's).
 */
function voltageText(layout: CircuitLayout, ref: string, tel: SimTelemetry | null): string {
  if (!tel) return ''
  if (layout === useStore.getState().layout) {
    const live = getNetLive(ref)
    if (live) {
      switch (live.kind) {
        case 'pwm':
          return netLiveText(live, { form: 'compact' })
        case 'toggling':
          return netLiveText(live)
        case 'dc':
          return fmtVoltage(live.v)
        case 'unknown':
          if (live.v === null) return ''
          return hasActivity(ref, tel.time - ACTIVITY_WINDOW_S) ? netLiveText(live) : fmtVoltage(live.v)
        case 'source':
          // a function generator's output: what it is SET to — 「方波 100 Hz · 0–5.00 V」, the
          // words of its pin row and the 量測 tab — never one jumping instant of the wave
          // (QA clarity FG-RAIL); the full 「（函數產生器設定）」 note is the pin row's title
          return netLiveText(live, { form: 'compact' })
      }
    }
  }
  const net = netlistOf(layout)?.netOf(ref)
  const v = net ? tel.netVoltages[net] : undefined
  return isTrustedVoltage(v) ? fmtVoltage(v) : ''
}

/** GPIO modes worth naming (power / ground / reset pins already say what they are). */
const MODE_SOURCES: Record<string, string> = {
  in: 'floating input',
  'in↑': 'pull-up input',
  'in↓': 'pull-down input',
  an: 'analog input',
  out: 'push-pull output',
  od: 'open-drain output',
  af: 'alternate-function push-pull',
  'af-od': 'alternate-function open-drain',
}

/** The firmware-programmed mode in the inspector's own words ('' when unknown). */
function modeText(o: Extract<Occupant, { kind: 'pin' }>, tel: SimTelemetry | null): string {
  const mode = tel?.components[o.id]?.mcu?.pinModes?.[o.pin]
  if (!mode || !(mode in MODE_SOURCES)) return ''
  // the pin map / mode tag tooltips' wording (embedded.ts 'pin-mode-long'), so
  // the chip and the inspector never name a mode two ways
  const long = tc(mode, 'pin-mode-long')
  return long !== mode ? long : t(MODE_SOURCES[mode])
}

/** Can this occupant's part be held down in 3D (SceneCallbacks.onObjectPress)? */
function pressable(o: Occupant): boolean {
  return o.kind === 'pin' && !!o.entry.params?.some((p) => p.key === 'pressed')
}

/**
 * What a click does to a pressable part (SC-6 + the keep-pressed latch,
 * src/ui/embedded/latch.ts): 「按住即可按下 · 雙擊保持按下」, or while it
 * is kept pressed 「已保持按下 · 按一下放開」 (a momentary press releases it).
 */
export function pressHintText(layout: CircuitLayout, id: string): string {
  return isLatched(id, layout)
    ? dotJoin(t('kept pressed|latch'), t('click to release|latch'))
    : dotJoin(t('hold to press'), t('double-click to keep pressed|latch'))
}

/** "PA5" for an MCU pin (port name only — the short form for lists), else the readable pin name. */
function shortName(o: Occupant): string {
  if (o.kind === 'wire') return t('Wire {id}', { id: o.id })
  const port = o.mcu ? o.entry.mcu?.pinMap[o.pin] : undefined
  return `${o.id} ${port ?? pinDisplayName(o.entry, o.pin)}`
}

/**
 * Segments joined with ' · ' — without the space after a full-width closing
 * bracket (「PA5（板上 A5）· c20」, not 「…） · c20」).
 */
export function dotJoin(...parts: string[]): string {
  let out = ''
  for (const p of parts) {
    if (!p) continue
    out = out === '' ? p : /[）」』]$/.test(out) ? `${out}· ${p}` : `${out} · ${p}`
  }
  return out
}

/**
 * The occupant as the chip's lead segment — the H1 full pin name every other
 * surface prints (「R1 第 1 腳」, 「LED1 陽極（長腳）」, 「U1 PA5（板上 A5）」).
 * The board id stays even with a single board (release QA SC-F2): only the
 * board's own inspector drops it, and the chip is not that inspector.
 */
function occupantText(o: Occupant): string {
  if (o.kind === 'wire') return t('Wire {id}', { id: o.id })
  return pinLabel(o.entry, o.pin, { id: o.id })
}

const RAIL_NAMES: Record<RailId, string> = {
  'top+': 'top + rail',
  'top-': 'top − rail',
  'bot+': 'bottom + rail',
  'bot-': 'bottom − rail',
}

/** 「上方 + 電源軌」 for a rail id (UI language). */
export function railName(rail: RailId): string {
  return t(RAIL_NAMES[rail])
}

/** 「上方 + 電源軌 · 第 10 孔（top+10）」 */
function railText(h: Extract<Hole, { kind: 'rail' }>, ref: string): string {
  return t('{rail} · hole {n} ({ref})', { rail: railName(h.rail), n: h.index, ref })
}

/**
 * Chip text for `hole` in `layout` (pure; exported for tests). With
 * `telemetry` (a simulation session) the text carries the live mode /
 * voltage / press hint; without it, the static baseline.
 */
export function holeChipTextFor(layout: CircuitLayout, hole: HoleRef, telemetry: SimTelemetry | null = null): string | null {
  const h = parseHole(hole)
  if (!h) return terminalChipTextFor(layout, hole, telemetry)
  const ref = formatHole(h)
  const index = indexOf(layout)
  const where = h.kind === 'rail' ? railText(h, ref) : ref
  const volts = voltageText(layout, ref, telemetry)
  const own = index.byHole.get(ref)
  if (own) {
    const mode = own.kind === 'pin' && own.mcu ? modeText(own, telemetry) : ''
    const hint = telemetry && pressable(own) ? pressHintText(layout, own.id) : ''
    // a wire end says little by itself — name its strip the H2 way
    // (「導線 W7 · a20（U1 PA5 這一排）」)
    const named = own.kind === 'wire' && h.kind === 'strip' ? stripHoleName(layout, index, h, ref, own) : ''
    return dotJoin(occupantText(own), mode, volts, named || where, hint)
  }
  if (h.kind === 'rail') return dotJoin(where, volts)
  const named = stripHoleName(layout, index, h, ref, null)
  if (!named) return null
  return dotJoin(named, volts)
}

/**
 * An empty strip hole (or one holding only `self`, the hovered wire end) by
 * what its 5-hole strip connects it to: THE static H2 name when a part pin
 * is on the strip — 「a20（U1 PA5 這一排）」, word for word what the wire
 * hint and the 「已接上 …」 toast say — else the first other wire end in the
 * same form, 「a20（導線 W3 這一排）」; '' when nothing else is there.
 */
function stripHoleName(layout: CircuitLayout, index: ChipIndex, h: Hole, ref: string, self: Occupant | null): string {
  const others = (index.byStrip.get(netIdForHole(h)) ?? []).filter(
    (o) => !(self && o.kind === self.kind && o.id === self.id),
  )
  if (others.some((o) => o.kind === 'pin')) return endpointName(layout, ref)
  const wire = others[0]
  return wire ? t('{hole} ({name} strip)', { hole: ref, name: shortName(wire) }) : ''
}

/**
 * An off-board terminal's chip (SC-12 (2)): 「PS1 正端 · 5.00 V」, 「DMM1 COM
 * 端 · 0 V」 (H1 terminalLabel + the live value) — null for a ref that is not
 * a terminal of a part in `layout`.
 */
function terminalChipTextFor(layout: CircuitLayout, ref: string, telemetry: SimTelemetry | null): string | null {
  const term = parseTerminalRef(ref)
  if (!term || !layout.components.some((c) => c.id === term.componentId)) return null
  return dotJoin(terminalLabel(ref, layout), voltageText(layout, ref, telemetry))
}

/**
 * SceneCallbacks.objectLabelText (SC-12 (3)): the neutral chip over a part
 * body or a wire in select mode — what it is and what a click does there:
 * 「U1 · STM32F103C8T6 Blue Pill 開發板 · 點一下選取」, 「導線 W3 · 點一下選取」;
 * once it is selected the click has nothing left to do, so the chip says so
 * — 「U1 · … · 已選取」, 「導線 W1 · 已選取」 (release QA SC-F2; the scene
 * re-asks when the selection changes). Null for an unknown id. Installed on
 * the scene by scene-bridge registerScene.
 */
export function objectChipText(id: string): string | null {
  try {
    const st = useStore.getState()
    const layout = st.layout
    const action = st.selection.includes(id) ? tc('Selected', 'object chip') : t('Click to select')
    const comp = layout.components.find((c) => c.id === id)
    if (comp) {
      const entry = getEntry(comp.type)
      // a session: a click PRESSES a pressable part (and selects it) — say how,
      // and how to keep it pressed (latch); 已選取 stays when it is selected
      if (st.telemetry && canPress(entry)) {
        const selected = st.selection.includes(id) ? action : ''
        return dotJoin(id, entry ? partLabel(entry) : '', selected, pressHintText(layout, id))
      }
      return dotJoin(id, entry ? partLabel(entry) : '', action)
    }
    if (layout.wires.some((w) => w.id === id)) {
      // product chrome: the colour the board shows and why (wire-roles — the inspector's own words,
      // 「導線 W1 · 紅色：電源正極（5 V 網路）· 點一下選取」); the classic chrome keeps the bare chip
      return isLegacyChrome() ? dotJoin(t('Wire {id}', { id }), action) : dotJoin(t('Wire {id}', { id }), wireRoleOf(layout, id).reason, action)
    }
    return null
  } catch {
    return null
  }
}

/**
 * SceneCallbacks.growPaddleLabel (SC-8): what a "+" grow paddle does —
 * 「加接一塊麵包板」 — or its "−" removal chip, 「移除這一側的麵包板」.
 */
export function growPaddleText(_direction: string, removing: boolean): string {
  return removing ? t('Remove the breadboard on this side') : t('Add a breadboard here')
}

// ---------------------------------------------------------------------------
// static endpoint names (UX helper H2)
// ---------------------------------------------------------------------------

/** 「上方 − 電源軌 第 20 孔」 */
function railHoleName(h: Extract<Hole, { kind: 'rail' }>): string {
  return t('{rail} hole {n}', { rail: railName(h.rail), n: h.index })
}

/** The short H1 name of a part pin: 「U1 PA0」, 「LED1 陽極」. */
function pinShort(o: Extract<Occupant, { kind: 'pin' }>): string {
  return pinLabel(o.entry, o.pin, { id: o.id, form: 'short' })
}

/**
 * THE static name of a hole or terminal (UX helper H2) — wire hints, the
 * 「已接上 …」 toast, wire endpoints in the inspector, instrument channel
 * names; no live data:
 *  - a part pin sits in it → 「U1 PA0（a25）」, 「LED1 陽極（c14）」;
 *  - an empty strip hole (or one holding only a wire end) → 「a25（U1 PA0
 *    這一排）」 after the first part pin on its 5-hole strip, else 「a25」 —
 *    tidy zh-TW (release QA SC-F2, the shared tidyCjkSpaces): no space
 *    between two Chinese words, 「a33（R1 第 1 腳這一排）」;
 *  - a rail hole → 「上方 − 電源軌 第 20 孔」;
 *  - an off-board terminal → 「PS1 正端」, 「DMM1 COM 端」 (H1 terminalLabel).
 * Unknown refs come back unchanged. Pure of `layout` (the occupancy index is
 * cached per layout identity); never throws.
 */
export function endpointName(layout: CircuitLayout, ref: string): string {
  try {
    const h = parseHole(ref)
    if (!h) return parseTerminalRef(ref) ? terminalLabel(ref, layout) : ref
    const hole = formatHole(h)
    const index = indexOf(layout)
    const own = index.byHole.get(hole)
    if (own?.kind === 'pin') return t('{name} ({hole})', { name: pinShort(own), hole })
    if (h.kind === 'rail') return railHoleName(h)
    const mate = (index.byStrip.get(netIdForHole(h)) ?? []).find((o): o is Extract<Occupant, { kind: 'pin' }> => o.kind === 'pin')
    return mate ? tidyCjkSpaces(t('{hole} ({name} strip)', { hole, name: pinShort(mate) })) : hole
  } catch {
    return ref
  }
}

/** Who sits in `ref` (for a refusal text): a part pin or a wire end. */
function occupantName(layout: CircuitLayout, ref: string): string | null {
  const h = parseHole(ref)
  const o = h ? indexOf(layout).byHole.get(formatHole(h)) : undefined
  if (!o) return null
  return o.kind === 'pin' ? pinShort(o) : t('Wire {id}', { id: o.id })
}

/**
 * Why a wire (or a dragged wire end) cannot go there, in one short
 * sentence (UX H2 / H8 — store.wireRefusal, store.moveWireEnd):
 * 「a25 已經接在這條導線的另一端」, 「c25 已經被 U1 PA0 佔用」, 「a20 已經被導線 W3
 * 佔用」, 「這兩點之間已經有導線 W3」, 「e20 被 U1 的本體蓋住了」, 「a90 不在目前的
 * 麵包板上」. Callers add their own lead-in (「這裡不能接：」).
 */
export function wireRefusalText(refusal: WireRefusal, layout: CircuitLayout = useStore.getState().layout): string {
  switch (refusal.kind) {
    case 'no-wire':
      return t('Wire {id} no longer exists', { id: refusal.wireId })
    case 'invalid-endpoint':
      return parseHole(refusal.ref)
        ? t('{hole} is not on the current breadboard', { hole: refusal.ref })
        : t('{ref} is not a terminal of a part in the circuit', { ref: refusal.ref })
    case 'same-endpoint':
      return t('{hole} is already the other end of this wire', { hole: refusal.ref })
    case 'duplicate':
      return t('Wire {id} already joins these two points', { id: refusal.wireId })
    case 'occupied': {
      const who = occupantName(layout, refusal.ref)
      // 「已經被 U1 PA0 佔用」 but 「已經被導線 W3 佔用」 (no space between two CJK words)
      return who
        ? t('{hole} already holds {what}', { hole: refusal.ref, what: who }).replace(/([一-鿿]) (?=[一-鿿])/g, '$1')
        : t('{hole} is already in use', { hole: refusal.ref })
    }
    case 'covered':
      return refusal.by
        ? t('{hole} is covered by the body of {id}', { hole: refusal.ref, id: refusal.by })
        : t('{hole} is covered by a part body', { hole: refusal.ref })
  }
}

/** SceneCallbacks.holeLabelText: the chip text for the live layout + telemetry, or null (never throws). */
export function holeChipText(hole: HoleRef): string | null {
  try {
    const s = useStore.getState()
    return holeChipTextFor(s.layout, hole, s.telemetry)
  } catch {
    return null
  }
}
