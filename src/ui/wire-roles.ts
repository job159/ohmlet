/**
 * wire-roles.ts — every wire's colour follows the role of its net (contract
 * C1, owner: simplify). The product chrome never asks the user to pick a
 * colour: a wire on the supply net is red, on ground black, and a signal
 * wire takes a stable colour of its function so neighbouring signal wires
 * stay distinguishable:
 *
 *   supply  (a source's + terminal, a power pin — 5V / 3V3 / VCC …, a + rail) → red
 *   ground  (a source's − terminal, a ground pin — GND / VSS …, a − rail)     → black
 *   signal  I²C SDA → blue · I²C SCL → yellow · UART TX (MCU sends) → green ·
 *           UART RX (MCU receives) → white · PWM input → orange ·
 *           any other signal net → a palette of its own (purple, teal, pink,
 *           brown, gray), in creation order
 *
 * One colour, one meaning, in every circuit: the palette of the plain
 * signals never uses a role or function colour, so a yellow wire is always
 * an I²C clock line and never the GPIO line of a blink circuit, and the
 * user guide's colour table holds on every board.
 *
 * A signal's function (review F16): a module pin names it (SDA / SCL, a PWM
 * input, TX / RX, a UART pin such as the MAX485's DI / RO — the MCU pin's
 * USART direction then says which way); with no module on the line, the MCU
 * pin's own alternate function does — USARTn_TX / _RX, I2Cn_SDA / _SCL, when
 * it is the pin's only one of those — but only when nothing else sits on the
 * line (an LED's resistor on PA2 is a GPIO line, never 「UART 傳送線」). PWM
 * comes only from a pin whose role says so (a servo / driver input): a timer
 * channel among an MCU pin's alternate functions is not a configured PWM.
 * One logical line keeps one colour across a level shifter: the LVn and HVn
 * nets of a channel are one line (「UART 接收線（BT1 TXD → U1 PA3，經 LS1
 * 準位轉換）」 on both sides), the channel pins themselves only pass it on.
 *
 * The net is the real one the simulator solves (sim/netlist buildNetlist —
 * board strips and rails joined by every wire and by the parts' internal
 * bridges), so the colour changes the moment the user wires a net to
 * ground: every wire of that net turns black. Priority, most specific first:
 * a source terminal (PS1 −, a battery +) decides; then the parts' power /
 * ground pins (catalog pinInfo kind, else the pin name); then the rail
 * marking. A net that carries both a ground and a supply point is a short:
 * it reads as ground (black), the ERC reports the short. One exception, the
 * real-world one: a wire on a multimeter terminal IS that meter's test lead
 * — red on IN, black on COM (METER_LEADS), whatever net it measures.
 *
 *   wireRoleColors(layout)   Map<wireId, colour name> (names wires.ts maps to PVC tones)
 *   wireRoleOf(layout, id)   { role, color, reason } — 「紅色：電源正極（5 V 網路）」
 *   wireRoleLegend()         「紅＝電源正　黑＝地　其他顏色＝訊號」
 *
 * Pure and cached per layout identity (the scene's wire sync, the inspector
 * and the hover chip all ask for the same layout) — computed on a layout
 * change, never per frame.
 */
import type { CatalogEntry, PinInfo } from '../model/catalog'
import { getEntry } from '../model/catalog'
import type { CircuitLayout, ComponentInstance } from '../model/types'
import { buildNetlist } from '../sim/netlist'
import { componentPinHoles, formatHole } from '../model/breadboard'
import { RAILS, boardConfigOf } from '../model/types'
import { t } from '../i18n'
import { pinLabel, terminalLabel } from '../i18n/parts'
import { fmtEng } from './format'
import { wireColorLabel } from './wire-colors'

export type WireRole = 'supply' | 'ground' | 'signal'

/** What a signal net carries, when the parts on it say so. */
export type SignalFunction = 'i2c-sda' | 'i2c-scl' | 'uart-tx' | 'uart-rx' | 'pwm' | null

/** The fixed colours of the roles and functions (names wires.ts / wire-colors.ts map). */
export const ROLE_COLOR = { supply: 'red', ground: 'black' } as const
export const FUNCTION_COLOR: Record<Exclude<SignalFunction, null>, string> = {
  'i2c-sda': 'blue',
  'i2c-scl': 'yellow',
  'uart-tx': 'green',
  'uart-rx': 'white',
  pwm: 'orange',
}
/**
 * Other signal nets, in creation order (the net's first wire in layout
 * order): a new net never changes an older net's colour. Only colours that
 * mean nothing else — never red / black (supply / ground) nor a
 * FUNCTION_COLOR — so a colour keeps one meaning on every board; a sixth
 * plain line repeats the first colour (the hover chip and the inspector
 * still name each line).
 */
export const SIGNAL_PALETTE: readonly string[] = ['purple', 'teal', 'pink', 'brown', 'gray']

/** One net's facts, as the colour rules read them. */
interface NetFacts {
  role: WireRole
  fn: SignalFunction
  /** a source / supply point that names the voltage: 5 (V), 3.3 … (null = not known from the layout) */
  volts: number | null
  /** the point that decided the role / function (a pin or terminal, as a person names it), if any */
  by: string | null
  /** 'rail' when only a rail's marking decided the role */
  rail: '+' | '-' | null
  /** the far end of a UART line (the module pin) for the reason text */
  peer: string | null
  /** the level shifter(s) the line passes through (['LS1']), for the reason text */
  via: readonly string[] | null
}

interface RoleInfo {
  role: WireRole
  color: string
  reason: string
}

/** Instrument terminals whose wire is the instrument's own test lead: the lead's colour. */
export const METER_LEADS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  multimeter: { IN: 'red', COM: 'black' },
}

interface Resolved {
  colors: Map<string, string>
  /** wire id → the meter lead it is (METER_LEADS) */
  leads: Map<string, { color: string; by: string }>
  /** merged net id → its facts (a level-shifted line: the whole line's) */
  facts: Map<string, NetFacts>
  /** wire id → merged net id */
  netOfWire: Map<string, string>
}

// ---------------------------------------------------------------------------
// pin classification
// ---------------------------------------------------------------------------

const GROUND_NAME = /^(?:GND|VSS|AGND|DGND|GND_MOT|0V|V-)(?:_?\d+)?$/i
const SUPPLY_NAME = /^(?:VCC|VDD|VIN|VBUS|VMOT|VM|5V|3V3|3\.3V|\+?\d+(?:\.\d+)?V|V\+)(?:_?\d+)?$/i

function infoOf(entry: CatalogEntry, pin: string): PinInfo | undefined {
  return entry.pinInfo?.find((p) => p.pin === pin)
}

/** Sources whose '+' / '-' terminals define the supply and ground. */
function isSource(entry: CatalogEntry): boolean {
  return entry.category === 'power' && entry.pins.includes('+') && entry.pins.includes('-')
}

/** A pin's power role by its catalog kind, else by its name. */
function pinRole(entry: CatalogEntry, pin: string): 'supply' | 'ground' | null {
  if (isSource(entry)) return pin === '-' ? 'ground' : pin === '+' ? 'supply' : null
  const info = infoOf(entry, pin)
  if (info?.kind === 'ground') return 'ground'
  if (info?.kind === 'power') return 'supply'
  if (info && info.kind !== 'passive') return null // the catalog says what it is
  if (GROUND_NAME.test(pin)) return 'ground'
  if (SUPPLY_NAME.test(pin)) return 'supply'
  return null
}

/** The nominal voltage a supply point names (layout facts only — never a reading). */
function pinVolts(comp: ComponentInstance, entry: CatalogEntry, pin: string): number | null {
  if (isSource(entry) && pin === '+') {
    const v = comp.params?.voltage
    if (typeof v === 'number' && Number.isFinite(v)) return v
    const def = entry.params?.find((p) => p.key === 'voltage')?.default
    if (typeof def === 'number') return def
    const m = /(\d+(?:\.\d+)?)\s*v/i.exec(entry.label)
    return m ? Number(m[1]) : null
  }
  const name = pin.replace(/_\d+$/, '')
  if (/^3V3$|^3\.3V$/i.test(name)) return 3.3
  const m = /^\+?(\d+(?:\.\d+)?)V$/i.exec(name)
  return m ? Number(m[1]) : null
}

/**
 * A non-MCU pin's signal function (by its catalog functions, else its name):
 * 'tx-pin' / 'rx-pin' a module's own TX / RX by name, 'uart-pin' a UART pin
 * whose name does not say the direction (the MAX485's DI / RO, a driver's
 * PDN_UART — the MCU pin on the line says which way the line goes).
 */
function moduleFunction(entry: CatalogEntry, pin: string): SignalFunction | 'tx-pin' | 'rx-pin' | 'uart-pin' {
  const info = infoOf(entry, pin)
  const fns = (info?.functions ?? []).map((f) => f.toUpperCase())
  const name = pin.toUpperCase()
  if (/^SDA\d*$/.test(name) || fns.some((f) => /(^|_)SDA$/.test(f))) return 'i2c-sda'
  if (/^SCL\d*$/.test(name) || fns.some((f) => /(^|_)SCL$/.test(f))) return 'i2c-scl'
  if (fns.includes('PWM')) return 'pwm'
  if (/^(?:TX|TXD)\d*$/.test(name)) return 'tx-pin'
  if (/^(?:RX|RXD)\d*$/.test(name)) return 'rx-pin'
  if (fns.some((f) => /^U(S)?ART(\d*|_TX|_RX)$/.test(f))) return 'uart-pin'
  return null
}

/** An MCU pin's default-mapped alternate functions (the '(remap)' ones need firmware to select them). */
function mcuFunctions(entry: CatalogEntry, pin: string): string[] {
  return (infoOf(entry, pin)?.functions ?? []).filter((f) => !/\(remap\)/i.test(f))
}

/** An MCU pin's UART direction from its alternate functions (null = none / both). */
function mcuUartDirection(entry: CatalogEntry, pin: string): 'uart-tx' | 'uart-rx' | null {
  const fns = mcuFunctions(entry, pin)
  const tx = fns.some((f) => /^U(S)?ART\d+_TX$/i.test(f))
  const rx = fns.some((f) => /^U(S)?ART\d+_RX$/i.test(f))
  return tx && !rx ? 'uart-tx' : rx && !tx ? 'uart-rx' : null
}

/**
 * The one serial-bus function an MCU pin can carry (USARTn_TX / _RX,
 * I2Cn_SDA / _SCL), null when it has none or more than one of them (PB10:
 * I2C2_SCL and USART3_TX — which one the firmware uses is not a layout fact).
 * Timer channels never count: an MCU pin is PWM only when the firmware says
 * so, and the colours are layout facts.
 */
function mcuBusFunction(entry: CatalogEntry, pin: string): Exclude<SignalFunction, 'pwm' | null> | null {
  const found = new Set<Exclude<SignalFunction, 'pwm' | null>>()
  for (const f of mcuFunctions(entry, pin)) {
    if (/^U(S)?ART\d+_TX$/i.test(f)) found.add('uart-tx')
    else if (/^U(S)?ART\d+_RX$/i.test(f)) found.add('uart-rx')
    else if (/^I2C\d+_SDA$/i.test(f)) found.add('i2c-sda')
    else if (/^I2C\d+_SCL$/i.test(f)) found.add('i2c-scl')
  }
  return found.size === 1 ? [...found][0] : null
}

/**
 * The pass-through channels of a part (one logical line on two nets): a
 * level shifter's LVn ↔ HVn. Its channel pins carry the line on; they never
 * decide what the line is.
 */
function channelPairs(entry: CatalogEntry): [string, string][] {
  const out: [string, string][] = []
  for (const p of entry.pins) {
    const m = /^LV(\d+)$/.exec(p)
    if (m && entry.pins.includes(`HV${m[1]}`)) out.push([p, `HV${m[1]}`])
  }
  return out
}
const channelCache = new WeakMap<CatalogEntry, ReadonlySet<string>>()
/** The pins of `entry` that are pass-through channel ends. */
function channelPins(entry: CatalogEntry): ReadonlySet<string> {
  let s = channelCache.get(entry)
  if (!s) channelCache.set(entry, (s = new Set(channelPairs(entry).flat())))
  return s
}

// ---------------------------------------------------------------------------
// the nets
// ---------------------------------------------------------------------------

interface PinOnNet {
  comp: ComponentInstance
  entry: CatalogEntry
  pin: string
  /**
   * it carries or observes the line, never decides what it is: a level
   * shifter's channel end (LVn / HVn), an instrument's probe or terminal (a
   * logic probe on a UART line never changes its colour)
   */
  through: boolean
}

const cache = new WeakMap<CircuitLayout, Resolved>()

function resolve(layout: CircuitLayout): Resolved {
  const hit = cache.get(layout)
  if (hit) return hit
  const netlist = buildNetlist(layout)
  const config = boardConfigOf(layout)

  // every part pin / terminal, by merged net
  const pinsOf = new Map<string, PinOnNet[]>()
  const add = (net: string | null, p: PinOnNet) => {
    if (!net) return
    let list = pinsOf.get(net)
    if (!list) pinsOf.set(net, (list = []))
    list.push(p)
  }
  // the pass-through channels whose two ends are both on a net (LV1 ↔ HV1 …)
  const channels: { comp: ComponentInstance; a: string; b: string }[] = []
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry) continue
    const channelEnds = channelPins(entry)
    const observer = entry.category === 'instrument'
    const through = (pin: string) => observer || channelEnds.has(pin)
    const netOfPin = new Map<string, string>()
    if (entry.placement === 'offboard') {
      for (const pin of entry.pins) {
        const net = netlist.netOf(`${comp.id}:${pin}`)
        add(net, { comp, entry, pin, through: through(pin) })
        if (net) netOfPin.set(pin, net)
      }
    } else {
      const holes = componentPinHoles(comp, entry, config)
      holes?.forEach((h, i) => {
        if (!h) return
        const net = netlist.netOf(formatHole(h))
        add(net, { comp, entry, pin: entry.pins[i], through: through(entry.pins[i]) })
        if (net) netOfPin.set(entry.pins[i], net)
      })
    }
    for (const [lv, hv] of channelPairs(entry)) {
      const a = netOfPin.get(lv)
      const b = netOfPin.get(hv)
      if (a && b && a !== b) channels.push({ comp, a, b })
    }
  }

  // the rails each merged net holds (every board-row's four rails)
  const railsOf = new Map<string, Set<'+' | '-'>>()
  for (let boardRow = 0; boardRow < (config.rows ?? 1); boardRow++) {
    for (const rail of RAILS) {
      const net = netlist.netOf(formatHole(boardRow === 0 ? { kind: 'rail', rail, index: 0 } : { kind: 'rail', rail, index: 0, boardRow }))
      if (!net) continue
      let s = railsOf.get(net)
      if (!s) railsOf.set(net, (s = new Set()))
      s.add(rail.endsWith('-') ? '-' : '+')
    }
  }
  const netOfWire = new Map<string, string>()
  const wiresOf = new Map<string, string[]>()
  for (const w of layout.wires) {
    const net = netlist.netOf(w.from) ?? netlist.netOf(w.to)
    if (!net) continue
    netOfWire.set(w.id, net)
    let ws = wiresOf.get(net)
    if (!ws) wiresOf.set(net, (ws = []))
    ws.push(w.id)
  }

  // each net's own role first (a channel never carries a supply or a ground
  // across: only two signal nets become one line)
  const own = new Map<string, NetFacts>()
  for (const net of new Set([...pinsOf.keys(), ...wiresOf.keys()])) own.set(net, netFacts(pinsOf.get(net) ?? [], railsOf.get(net)))

  // one logical line across level-shifter channels (union-find over the nets)
  const parent = new Map<string, string>()
  const find = (n: string): string => {
    let r = n
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  const viaOf = new Map<string, Set<string>>()
  for (const ch of channels) {
    if (own.get(ch.a)?.role !== 'signal' || own.get(ch.b)?.role !== 'signal') continue
    const ra = find(ch.a)
    const rb = find(ch.b)
    const via = new Set([...(viaOf.get(ra) ?? []), ...(viaOf.get(rb) ?? []), ch.comp.id])
    if (ra !== rb) parent.set(rb, ra)
    viaOf.set(ra, via)
  }
  const lineOf = (net: string) => find(net)
  const members = new Map<string, string[]>()
  for (const net of own.keys()) {
    const root = lineOf(net)
    let m = members.get(root)
    if (!m) members.set(root, (m = []))
    m.push(net)
  }
  const facts = new Map<string, NetFacts>()
  for (const [root, nets] of members) {
    if (nets.length === 1) {
      facts.set(nets[0], own.get(nets[0])!)
      continue
    }
    const pins = nets.flatMap((n) => pinsOf.get(n) ?? [])
    const via = [...(viaOf.get(root) ?? [])].sort()
    const line = { ...netFacts(pins, undefined), via: via.length > 0 ? via : null }
    for (const n of nets) facts.set(n, line)
  }

  // colours: role colours, function colours, then the plain-signal palette
  // in creation order (its colours mean nothing else); one colour per
  // logical line
  const palette = SIGNAL_PALETTE
  const colors = new Map<string, string>()
  const lineColor = new Map<string, string>()
  let next = 0
  for (const w of layout.wires) {
    const net = netOfWire.get(w.id)
    if (!net) continue
    const line = lineOf(net)
    let c = lineColor.get(line)
    if (!c) {
      const f = facts.get(net)!
      c = f.role !== 'signal' ? ROLE_COLOR[f.role] : f.fn ? FUNCTION_COLOR[f.fn] : palette[next++ % palette.length]
      lineColor.set(line, c)
    }
    colors.set(w.id, c)
  }
  // a wire on a meter terminal is the meter's red / black test lead
  const leads = new Map<string, { color: string; by: string }>()
  for (const w of layout.wires) {
    for (const end of [w.from, w.to]) {
      const i = end.indexOf(':')
      if (i <= 0 || /^\d+$/.test(end.slice(0, i))) continue // a hole ("1:a12" is a board-row hole)
      const comp = layout.components.find((c) => c.id === end.slice(0, i))
      const color = comp ? METER_LEADS[comp.type]?.[end.slice(i + 1)] : undefined
      if (!comp || !color) continue
      leads.set(w.id, { color, by: terminalLabel(end, layout) })
      colors.set(w.id, color)
      break
    }
  }
  const out: Resolved = { colors, leads, facts, netOfWire }
  cache.set(layout, out)
  return out
}

/** A pin as a person names it (H1): 「U1 PA5」, 「LED1 陽極」; an off-board terminal 「PS1 負端」, 「DMM1 IN 端」. */
const nameOf = (p: PinOnNet) =>
  p.entry.placement === 'offboard'
    ? terminalLabel(`${p.comp.id}:${p.pin}`, { components: [p.comp] })
    : pinLabel(p.entry, p.pin, { id: p.comp.id, form: 'short' })

function netFacts(pins: readonly PinOnNet[], rails: ReadonlySet<'+' | '-'> | undefined): NetFacts {
  const base = { volts: null, by: null, rail: null, peer: null, fn: null, via: null } as const
  // 1. a source terminal decides
  const srcGround = pins.find((p) => isSource(p.entry) && p.pin === '-')
  const srcSupply = pins.find((p) => isSource(p.entry) && p.pin === '+')
  if (srcGround) return { ...base, role: 'ground', by: nameOf(srcGround) }
  // 2. the parts' power / ground pins
  const gnd = pins.find((p) => !isSource(p.entry) && pinRole(p.entry, p.pin) === 'ground')
  if (gnd) return { ...base, role: 'ground', by: nameOf(gnd) }
  const supplies = pins.filter((p) => pinRole(p.entry, p.pin) === 'supply')
  if (srcSupply || supplies.length > 0) {
    const first = srcSupply ?? supplies[0]
    let volts: number | null = null
    for (const p of srcSupply ? [srcSupply, ...supplies] : supplies) {
      volts = pinVolts(p.comp, p.entry, p.pin)
      if (volts != null) break
    }
    return { ...base, role: 'supply', by: nameOf(first), volts }
  }
  // 3. the rail marking
  if (rails?.has('-')) return { ...base, role: 'ground', rail: '-' }
  if (rails?.has('+')) return { ...base, role: 'supply', rail: '+' }
  // 4. a signal: what the parts on it say it carries (a level shifter's
  // channel pins only pass the line on — they never decide it)
  const parts = pins.filter((p) => !p.through)
  const mcuPins = parts.filter((p) => p.entry.mcu)
  const modulePins = parts.filter((p) => !p.entry.mcu)
  let txPin: PinOnNet | null = null
  let rxPin: PinOnNet | null = null
  let uartPin: PinOnNet | null = null
  for (const p of modulePins) {
    const f = moduleFunction(p.entry, p.pin)
    if (f === 'i2c-sda' || f === 'i2c-scl' || f === 'pwm') return { ...base, role: 'signal', fn: f, by: nameOf(p) }
    if (f === 'tx-pin') txPin ??= p
    if (f === 'rx-pin') rxPin ??= p
    if (f === 'uart-pin') uartPin ??= p
  }
  if (txPin || rxPin || uartPin) {
    // MCU's point of view: the MCU pin's USART function first; else the
    // module pin read from the other side (a module's RXD is fed by a TX line)
    for (const p of mcuPins) {
      const dir = mcuUartDirection(p.entry, p.pin)
      if (dir) return { ...base, role: 'signal', fn: dir, by: nameOf(p), peer: nameOf((txPin ?? rxPin ?? uartPin)!) }
    }
    if (txPin || rxPin) {
      const fn: SignalFunction = rxPin && !txPin ? 'uart-tx' : 'uart-rx'
      const mcu = mcuPins[0]
      return { ...base, role: 'signal', fn, by: mcu ? nameOf(mcu) : null, peer: nameOf((rxPin && !txPin ? rxPin : txPin)!) }
    }
    // a UART pin whose name does not tell the direction, and no MCU USART pin to say it: a plain signal
  }
  // 5. no module on the line: the MCU pin's own alternate function (F16) —
  // only when nothing else is on it (an LED's resistor on PA2 is a GPIO line)
  if (modulePins.length === 0 && mcuPins.length > 0) {
    const bus = mcuLineFunction(mcuPins)
    if (bus) return { ...base, role: 'signal', ...bus }
  }
  const first = mcuPins[0] ?? modulePins[0] ?? pins[0]
  return { ...base, role: 'signal', by: first ? nameOf(first) : null }
}

/**
 * The function of a line that holds only MCU pins (and pass-through channel
 * ends): every pin's single bus function (mcuBusFunction), agreeing — one
 * pin, or a UART TX joined to a UART RX (the line carries what the TX pin
 * sends: 「UART 傳送線（U1 PA2 → U1 PA10）」), or the same I²C line on two
 * boards. Anything else (a pin without one, two transmitters) is not known.
 */
function mcuLineFunction(mcuPins: readonly PinOnNet[]): Pick<NetFacts, 'fn' | 'by' | 'peer'> | null {
  const fns = mcuPins.map((p) => mcuBusFunction(p.entry, p.pin))
  if (fns.some((f) => f == null)) return null
  const kinds = new Set(fns)
  if (kinds.size === 1) {
    const fn = fns[0]!
    // two UART pins of the same direction on one line fight each other: not a UART line
    if ((fn === 'uart-tx' || fn === 'uart-rx') && mcuPins.length > 1) return null
    return { fn, by: nameOf(mcuPins[0]), peer: null }
  }
  if (kinds.size === 2 && kinds.has('uart-tx') && kinds.has('uart-rx') && mcuPins.length === 2) {
    const tx = mcuPins[fns.indexOf('uart-tx')]
    const rx = mcuPins[fns.indexOf('uart-rx')]
    return { fn: 'uart-tx', by: nameOf(tx), peer: nameOf(rx) }
  }
  return null
}

// ---------------------------------------------------------------------------
// the contract
// ---------------------------------------------------------------------------

/** The display colour of every wire from its net's role (wire id → colour name). */
export function wireRoleColors(layout: CircuitLayout): Map<string, string> {
  return resolve(layout).colors
}

/** One wire's role, colour and the reason in words (「紅色：電源正極（5 V 網路）」). */
export function wireRoleOf(layout: CircuitLayout, wireId: string): RoleInfo {
  const r = resolve(layout)
  const net = r.netOfWire.get(wireId)
  const color = r.colors.get(wireId) ?? layout.wires.find((w) => w.id === wireId)?.color ?? SIGNAL_PALETTE[0]
  const f = net ? r.facts.get(net) : undefined
  const lead = r.leads.get(wireId)
  if (lead) {
    const text = t('{color}: {meaning}|wire-role', { color: wireColorLabel(color), meaning: t('meter test lead ({by})|wire-role', { by: lead.by }) })
    return { role: f?.role ?? 'signal', color, reason: text }
  }
  if (!f) return { role: 'signal', color, reason: roleReason(color, 'signal', null) }
  return { role: f.role, color, reason: roleReason(color, f.role, f) }
}

/** The wire's meaning after the colour name: 「電源正極（5 V 網路）」 (no colour). */
export function wireRoleMeaning(layout: CircuitLayout, wireId: string): string {
  const r = resolve(layout)
  const lead = r.leads.get(wireId)
  if (lead) return t('meter test lead ({by})|wire-role', { by: lead.by })
  const net = r.netOfWire.get(wireId)
  const f = net ? r.facts.get(net) : undefined
  return meaning(f?.role ?? 'signal', f ?? null)
}

function meaning(role: WireRole, f: NetFacts | null): string {
  if (role === 'supply') {
    if (f?.volts != null) return t('supply positive ({v} net)|wire-role', { v: fmtEng(f.volts, 'V') })
    if (f?.rail === '+') return t('supply positive (+ rail)|wire-role')
    return f?.by ? t('supply positive ({by})|wire-role', { by: f.by }) : t('supply positive|wire-role')
  }
  if (role === 'ground') {
    if (f?.rail === '-') return t('ground (− rail)|wire-role')
    return f?.by ? t('ground ({by})|wire-role', { by: f.by }) : t('ground|wire-role')
  }
  // a line through a level shifter names it: 「…，經 LS1 準位轉換」 (the same words on both sides)
  const via = f?.via ? f.via.join(t(', ')) : null
  const by = f?.by ?? null
  switch (f?.fn ?? null) {
    case 'i2c-sda':
      return via
        ? t('I²C data line SDA ({by}, via {via})|wire-role', { by: by ?? 'SDA', via })
        : t('I²C data line SDA ({by})|wire-role', { by: by ?? 'SDA' })
    case 'i2c-scl':
      return via
        ? t('I²C clock line SCL ({by}, via {via})|wire-role', { by: by ?? 'SCL', via })
        : t('I²C clock line SCL ({by})|wire-role', { by: by ?? 'SCL' })
    case 'uart-tx':
      if (f?.peer && by) {
        return via
          ? t('UART line the MCU sends on ({by} → {peer}, via {via})|wire-role', { by, peer: f.peer, via })
          : t('UART line the MCU sends on ({by} → {peer})|wire-role', { by, peer: f.peer })
      }
      return by ? t('UART line the MCU sends on ({by})|wire-role', { by }) : t('UART line the MCU sends on|wire-role')
    case 'uart-rx':
      if (f?.peer && by) {
        return via
          ? t('UART line the MCU receives on ({peer} → {by}, via {via})|wire-role', { by, peer: f.peer, via })
          : t('UART line the MCU receives on ({peer} → {by})|wire-role', { by, peer: f.peer })
      }
      return by ? t('UART line the MCU receives on ({by})|wire-role', { by }) : t('UART line the MCU receives on|wire-role')
    case 'pwm':
      return via
        ? t('PWM control signal ({by}, via {via})|wire-role', { by: by ?? 'PWM', via })
        : t('PWM control signal ({by})|wire-role', { by: by ?? 'PWM' })
    default:
      if (by && via) return t('signal ({by}, via {via})|wire-role', { by, via })
      return by ? t('signal ({by})|wire-role', { by }) : t('signal|wire-role')
  }
}

function roleReason(color: string, role: WireRole, f: NetFacts | null): string {
  return t('{color}: {meaning}|wire-role', { color: wireColorLabel(color), meaning: meaning(role, f) })
}

/** The one-line legend of the wire mode: 「紅＝電源正　黑＝地　其他顏色＝訊號」. */
export function wireRoleLegend(): string {
  return t('Red = supply +   Black = ground   Other colours = signals|wire-legend')
}
