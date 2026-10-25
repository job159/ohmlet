/**
 * Logic-analyzer view configuration helpers. The decoder instances and the
 * trigger settings themselves live in the lab store (useLab().logicView —
 * the single source of truth since UX IS-3: persisted as 'bb.logicView',
 * carried in project files and example envelopes); the store keeps them as
 * opaque JSON and the analyzer reads them through the sanitizers below.
 * The one-time move of the analyzer's former keys ('bb.logicDecoders',
 * 'bb.logicTrigger') into the store happens at lab boot (src/state/lab.ts).
 *
 * Pure helpers (sanitizing, channel auto-mapping, summaries) — exported for
 * tests.
 */
import type { LogicChannelConfig } from '../../../sim/coordinator/api'
import type { EdgeSlope } from '../../../instruments/trigger'
import { fmtBaud } from '../../../instruments/format'
import { getDecoder, type LogicDecoderConfig } from '../logic-decoders'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ---------------------------------------------------------------- decoders

export function sanitizeDecoderConfigs(raw: unknown): LogicDecoderConfig[] {
  if (!Array.isArray(raw)) return []
  const out: LogicDecoderConfig[] = []
  const ids = new Set<string>()
  for (const r of raw) {
    if (!isObject(r) || typeof r.decoder !== 'string' || !getDecoder(r.decoder)) continue
    const id = typeof r.id === 'string' && r.id && !ids.has(r.id) ? r.id : uniqueId(r.decoder, ids)
    ids.add(id)
    const channels: Record<string, number> = {}
    if (isObject(r.channels)) {
      for (const [k, v] of Object.entries(r.channels)) {
        if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 15) channels[k] = v
      }
    }
    const options: Record<string, string> = {}
    if (isObject(r.options)) {
      for (const [k, v] of Object.entries(r.options)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') options[k] = String(v)
      }
    }
    out.push({ id, decoder: r.decoder, channels, options })
    if (out.length >= 8) break
  }
  return out
}

function uniqueId(base: string, used: Set<string>): string {
  for (let k = 1; ; k++) {
    const id = `${base}${k}`
    if (!used.has(id)) return id
  }
}

/**
 * Channel-label hints per role (names first, then the STM32F103 default
 * pins of USART1-3, I2C1/2, SPI1/2 — RM0008 Table 5 / DS5319 Table 5).
 */
const ROLE_HINTS: Record<string, Record<string, RegExp>> = {
  uart: { data: /\b(tx|rx|uart|usart|serial)|^PA(9|10|2|3)$|^PB(10|11|6|7)$/i },
  i2c: { scl: /scl|^PB(6|8|10)$/i, sda: /sda|^PB(7|9|11)$/i },
  spi: {
    sck: /sck|sclk|clk|^PA5$|^PB(13|3)$/i,
    mosi: /mosi|sdo|dout|^PA7$|^PB(15|5)$/i,
    miso: /miso|sdi|din|^PA6$|^PB(14|4)$/i,
    cs: /\bcs\b|nss|ss\b|^PA(4|15)$|^PB12$/i,
  },
  onewire: { data: /1w|one.?wire|dq|\bow\b/i },
}

/** What a channel is called for role matching: its label, plus the MCU pin it reads. */
function channelNames(c: LogicChannelConfig): string[] {
  const out = [c.label]
  if (c.source.kind === 'mcu-pin') out.push(c.source.pin)
  // "PA9 TX" → also try the words one by one ("TX" matches the UART hint)
  for (const w of c.label.split(/[\s·/._-]+/)) if (w && w !== c.label) out.push(w)
  return out
}

/**
 * A new decoder instance with its roles mapped to the configured channels:
 * a channel whose label (or pin) matches the role's hint — preferring one
 * that no other decoder of the same kind reads already, so a second UART
 * decoder lands on RX after the first took TX — otherwise (required roles
 * only) the first channel not taken yet.
 */
export function newDecoderConfig(
  decoderId: string,
  channels: readonly LogicChannelConfig[],
  existing: readonly LogicDecoderConfig[],
): LogicDecoderConfig | null {
  const d = getDecoder(decoderId)
  if (!d) return null
  const used = new Set(existing.map((c) => c.id ?? c.decoder))
  const busy = new Set<number>()
  for (const c of existing) if (c.decoder === decoderId) for (const ch of Object.values(c.channels)) busy.add(ch)
  const map: Record<string, number> = {}
  const taken = new Set<number>()
  const hints = ROLE_HINTS[decoderId] ?? {}
  const roles = d.spec?.roles ?? d.roles.map((id) => ({ id, label: id, optional: false }))
  for (const role of roles) {
    const hint = hints[role.id]
    if (!hint) continue
    const ok = (c: LogicChannelConfig) => !taken.has(c.index) && channelNames(c).some((n) => hint.test(n))
    const ch = channels.find((c) => ok(c) && !busy.has(c.index)) ?? channels.find(ok)
    if (ch) {
      map[role.id] = ch.index
      taken.add(ch.index)
    }
  }
  for (const role of roles) {
    if (role.id in map || role.optional) continue
    const ch = channels.find((c) => !taken.has(c.index) && !busy.has(c.index)) ?? channels.find((c) => !taken.has(c.index))
    if (ch) {
      map[role.id] = ch.index
      taken.add(ch.index)
    }
  }
  return { id: uniqueId(decoderId, used), decoder: decoderId, channels: map, options: {} }
}

/**
 * One-line summary of a decoder instance for its toolbar chip (UX IS-5):
 * "UART · PA9 TX · 115200 8N1", "I²C · PB6 SCL / PB7 SDA", "SPI · 模式 0 ·
 * CS PA4". `measuredBaud` = the decoder's own auto-baud result when the
 * baud option is 'auto'. Words go through `tr` (the UI's t()), so this stays
 * pure for tests.
 */
export function decoderSummary(
  cfg: LogicDecoderConfig,
  channels: readonly LogicChannelConfig[],
  tr: (src: string, params?: Record<string, string | number>) => string,
  measuredBaud?: number | null,
  /** product chrome (UX QA IS-F17): the baud in the one format — 「UART · PA9 TX · 115 200 Bd · 8N1」 */
  opts: { product?: boolean } = {},
): string {
  const d = getDecoder(cfg.decoder)
  const label = d?.label ?? cfg.decoder
  const name = (role: string): string | null => {
    const i = cfg.channels[role]
    if (i === undefined) return null
    return channels.find((c) => c.index === i)?.label ?? `D${i}`
  }
  const opt = (k: string, dflt: string) => String(cfg.options?.[k] ?? dflt)
  const parts: string[] = [label]
  switch (cfg.decoder) {
    case 'uart': {
      parts.push(name('data') ?? tr('pick a channel'))
      const baud = opt('baud', 'auto')
      const par = opt('parity', 'none')
      const fmt = `${opt('dataBits', '8')}${par === 'even' ? 'E' : par === 'odd' ? 'O' : 'N'}${opt('stopBits', '1')}`
      if (opts.product) {
        if (baud !== 'auto' && Number(baud) > 0) parts.push(`${fmtBaud(Number(baud))} · ${fmt}`)
        else if (measuredBaud) parts.push(tr('{baud} (auto) {format}', { baud: fmtBaud(measuredBaud), format: `· ${fmt}` }))
        else parts.push(tr('auto baud {format}', { format: fmt }))
      } else if (baud !== 'auto') parts.push(`${baud} ${fmt}`)
      else if (measuredBaud) parts.push(tr('{baud} (auto) {format}', { baud: measuredBaud, format: fmt }))
      else parts.push(tr('auto baud {format}', { format: fmt }))
      break
    }
    case 'i2c': {
      const scl = name('scl')
      const sda = name('sda')
      parts.push(scl && sda ? `${scl} / ${sda}` : tr('pick SCL and SDA'))
      break
    }
    case 'spi': {
      parts.push(name('sck') ?? tr('pick SCK'))
      parts.push(tr('mode {n}', { n: opt('mode', '0') }))
      const cs = name('cs')
      if (cs) parts.push(`CS ${cs}`)
      break
    }
    default: {
      const first = d?.spec?.roles[0]?.id
      const ch = first ? name(first) : null
      if (ch) parts.push(ch)
    }
  }
  return parts.join(' · ')
}

/** The decoder's measured baud from its notes ("auto: 115200 Bd (…)"), else null. */
export function measuredBaudOf(info: readonly string[] | undefined): number | null {
  const m = info?.length ? /^auto: (\d+) Bd/.exec(info[0]) : null
  return m ? Number(m[1]) : null
}

// ----------------------------------------------------------------- trigger

export interface LogicTriggerPrefs {
  kind: 'edge' | 'pattern'
  channel: number
  slope: EdgeSlope
  /** channel index → required level (absent = don't care) */
  pattern: Record<number, 0 | 1>
  /** fraction of the window before the trigger point */
  pre: number
}

export const TRIGGER_DEFAULTS: LogicTriggerPrefs = { kind: 'edge', channel: 0, slope: 'falling', pattern: {}, pre: 0.1 }

export const PRE_TRIGGER = [0.1, 0.25, 0.5, 0.75, 0.9] as const

/** "PA6 ↓", "PA6 ↑", "PA6 ↕", or the pattern "PA5=1 PA6=0" (empty: null). */
export function triggerCondition(prefs: LogicTriggerPrefs, channels: readonly LogicChannelConfig[]): string | null {
  const name = (i: number) => channels.find((c) => c.index === i)?.label ?? null
  if (prefs.kind === 'edge') {
    const ch = name(prefs.channel)
    if (!ch) return null
    return `${ch} ${prefs.slope === 'rising' ? '↑' : prefs.slope === 'falling' ? '↓' : '↕'}`
  }
  const parts = Object.entries(prefs.pattern)
    .map(([k, v]) => {
      const ch = name(Number(k))
      return ch ? `${ch}=${v}` : null
    })
    .filter((x): x is string => x !== null)
  return parts.length ? parts.join(' ') : null
}

export function sanitizeTrigger(raw: unknown): LogicTriggerPrefs {
  const out: LogicTriggerPrefs = { ...TRIGGER_DEFAULTS, pattern: {} }
  if (!isObject(raw)) return out
  if (raw.kind === 'edge' || raw.kind === 'pattern') out.kind = raw.kind
  if (typeof raw.channel === 'number' && Number.isInteger(raw.channel) && raw.channel >= 0 && raw.channel <= 15) {
    out.channel = raw.channel
  }
  if (raw.slope === 'rising' || raw.slope === 'falling' || raw.slope === 'any') out.slope = raw.slope
  if (typeof raw.pre === 'number' && (PRE_TRIGGER as readonly number[]).includes(raw.pre)) out.pre = raw.pre
  if (isObject(raw.pattern)) {
    for (const [k, v] of Object.entries(raw.pattern)) {
      const ch = Number(k)
      if (Number.isInteger(ch) && ch >= 0 && ch <= 15 && (v === 0 || v === 1)) out.pattern[ch] = v
    }
  }
  return out
}

