/**
 * Localised catalog text for the UI. The catalog itself stays English (it is
 * also the LLM's system prompt and the validator's vocabulary); display code
 * asks these helpers instead of reading entry.label/doc/meta/support
 * directly.
 *
 * Tables: src/i18n/zh-TW/parts-*.ts export `PARTS_ZH: Record<type, PartText>`
 * (merged with import.meta.glob). Every catalog type must have a zh-TW entry
 * — tests/i18n enforces it.
 */
import type { CatalogEntry, ComponentCategory, SupportInfo, SupportLevel } from '../model/catalog'
import { getEntry, supportOf } from '../model/catalog'
import { lang, t } from './index'

export interface PartText {
  label: string
  /** usage description shown in the library / inspector (the catalog `doc` in Chinese) */
  doc: string
  /** meta.specs in Chinese, same order */
  specs?: string[]
  /** support.simulated in Chinese, same order */
  simulated?: string[]
  /** support.limits in Chinese, same order */
  limits?: string[]
  /** param key → label */
  params?: Record<string, string>
  /** param key → { option value → label } for select params */
  options?: Record<string, Record<string, string>>
}

const modules = import.meta.glob<{ PARTS_ZH: Record<string, PartText> }>('./zh-TW/parts-*.ts', { eager: true })
const PARTS_ZH: Record<string, PartText> = Object.assign(
  {},
  ...Object.keys(modules)
    .sort()
    .map((k) => modules[k].PARTS_ZH),
)

function zh(entry: CatalogEntry): PartText | undefined {
  return lang() === 'zh-TW' ? PARTS_ZH[entry.type] : undefined
}

export function partLabel(entry: CatalogEntry): string {
  return zh(entry)?.label ?? entry.label
}

export function partDoc(entry: CatalogEntry): string {
  return zh(entry)?.doc ?? entry.doc
}

export function partSpecs(entry: CatalogEntry): string[] {
  return zh(entry)?.specs ?? entry.meta?.specs ?? []
}

export function partParamLabel(entry: CatalogEntry, key: string, fallback: string): string {
  return zh(entry)?.params?.[key] ?? t(fallback)
}

export function partOptionLabel(entry: CatalogEntry, key: string, value: string): string {
  return zh(entry)?.options?.[key]?.[value] ?? t(value)
}

/** Support info with localised simulated/limits lists. */
export function partSupport(entry: CatalogEntry): SupportInfo {
  const s = supportOf(entry)
  const z = zh(entry)
  if (!z) return s
  return { level: s.level, simulated: z.simulated ?? s.simulated, limits: z.limits ?? s.limits }
}

export function supportLevelLabel(level: SupportLevel): string {
  switch (level) {
    case 'full':
      return t('Full')
    case 'partial':
      return t('Partial')
    case 'visual':
      return t('Visual only')
    case 'dev':
      return t('In development')
  }
}

export function categoryLabel(c: ComponentCategory, english: string): string {
  return t(english) || c
}

/** Types missing a zh-TW entry (coverage tests). */
export function missingPartTranslations(types: string[]): string[] {
  return types.filter((ty) => !PARTS_ZH[ty])
}

export function partTranslation(type: string): PartText | undefined {
  return PARTS_ZH[type]
}

/** t(`${src}|${context}`) with the plain-source fallback (src/ui/format.ts tc, kept local: i18n stays UI-free). */
function tCtx(src: string, context: string): string {
  const key = `${src}|${context}`
  const s = t(key)
  return s === key ? t(src) : s
}

/** "GND1" / "3V3_2" → "GND" / "3V3": a board's duplicate power-pin ids lose their index. */
function boardPowerPinName(pin: string): string {
  const m = /^(GND|3V3|5V|VCC|VDD|VSS|VIN)_?\d$/.exec(pin)
  return m ? m[1] : pin
}

/**
 * A pin as a person reads it (UX wave contract K11 — IN-9), for hints,
 * hover chips, inspector rows and problem texts:
 *  - MCU boards: the port name ('PA5'), plus the board's silkscreen label
 *    when it differs — 「PA5（板上 A5）」; power pins drop the duplicate
 *    index — 「GND（板上 G）」, 「3V3（板上 3.3）」;
 *  - LEDs: 「陽極（長腳）」 / 「陰極（短腳）」; diodes: 陽極 / 「陰極（色環端）」;
 *  - numbered leads p1, p2 … : 「第 1 腳」, 「第 2 腳」;
 *  - source terminals + / − : 「正端」 / 「負端」;
 *  - other lower-case catalog names (gate, wiper, tip …): their pin-name
 *    translation (閘極, 滑動端, 探針); single letters: 「a 端」;
 *  - datasheet pin names (VCC, OUT, 1A, SDA …) stay as printed.
 * English returns readable English ('PA5 (board label A5)', 'anode (long lead)', 'lead 1').
 */
export function pinDisplayName(entry: CatalogEntry, pin: string): string {
  if (entry.mcu) {
    const name = entry.mcu.pinMap[pin] ?? boardPowerPinName(pin)
    const silk = entry.pinInfo?.find((p) => p.pin === pin)?.label
    return silk && silk !== name ? t('{pin} (board label {silk})', { pin: name, silk }) : name
  }
  const isLed = entry.sim.kind === 'device' && entry.sim.model === 'led'
  const isDiode = entry.sim.kind === 'device' && (entry.sim.model === 'diode' || entry.sim.model === 'zener')
  if (pin === 'anode' && isLed) return t('anode (long lead)')
  if (pin === 'cathode' && isLed) return t('cathode (short lead)')
  if (pin === 'cathode' && isDiode) return t('cathode (banded end)')
  const lead = /^p(\d+)$/.exec(pin)
  if (lead) return t('lead {n}', { n: Number(lead[1]) })
  if (pin === '+') return t('positive terminal')
  if (pin === '-') return t('negative terminal')
  if (/^[a-z]$/.test(pin)) return t('terminal {pin}', { pin })
  if (/^[a-z]{2,}$/.test(pin)) return tCtx(pin, 'pin')
  return pin
}

/** 「PA5（板上 A5）」 → 「PA5」, 「陽極（長腳）」 → 「陽極」, 'PA5 (board label A5)' → 'PA5'. */
function withoutNote(name: string): string {
  return name.replace(/（[^（）]*）$/, '').replace(/ \([^()]*\)$/, '')
}

/** A part's id joined to a name: 「U1 PA5」, 「LED1 陽極（長腳）」. */
function idJoin(id: string | undefined, name: string): string {
  return id ? `${id} ${name}` : name
}

/**
 * THE way to name a pin (UX helper H1 — docs/ux/UX_VERIFY.md §5.4), for
 * every surface: hints, hover chips, the probe menu, inspector rows, problem
 * texts, lesson checks, instrument channels.
 *
 *  form 'full' (default) — 「U1 PA5（板上 A5）」, 「U1 3V3（板上 3.3）」,
 *    「U1 GND（板上 G）」, 「LED1 陽極（長腳）」, 「D1 陰極（色環端）」,
 *    「R1 第 2 腳」, 「PS1 正端」 (pinDisplayName prefixed with the part id);
 *  form 'short' — the same without the trailing note: 「U1 PA5」, 「U1 3V3」,
 *    「LED1 陽極」 — ONLY in dense tables, with the full form as the title.
 *
 * Without `id` the part id is left out (「PA5（板上 A5）」) — for places that
 * already name the part (a pin row inside U1's own inspector). An unknown pin
 * name is returned as given. English: 'U1 PA5 (board label A5)', 'LED1 anode
 * (long lead)'.
 */
export function pinLabel(entry: CatalogEntry, pin: string, opts: { id?: string; form?: 'full' | 'short' } = {}): string {
  const name = pinDisplayName(entry, pin)
  return idJoin(opts.id, opts.form === 'short' ? withoutNote(name) : name)
}

/** Minimal component lookup for terminalLabel (a CircuitLayout fits). */
export interface TerminalOwners {
  components: readonly { id: string; type: string }[]
}

/** Categories whose off-board posts read as terminals: 「PS1 正端」, 「DMM1 COM 端」. */
const TERMINAL_CATEGORIES: readonly ComponentCategory[] = ['power', 'instrument']

/**
 * An off-board terminal ref ("PS1:+", "DMM1:COM", "FG1:out") as a person
 * reads it (UX helper H1): 「PS1 正端」, 「PS1 負端」, 「DMM1 COM 端」,
 * 「FG1 輸出端」; a motor / module lead keeps its printed name (「M1 M+」).
 * With `layout` the part's catalog entry decides the pin wording; without
 * it, '+' / '−' still read 正端 / 負端 and other pins 「<pin> 端」. A ref that
 * is not "ID:PIN" is returned unchanged. English: 'PS1 positive terminal',
 * 'DMM1 COM terminal'.
 */
export function terminalLabel(ref: string, layout?: TerminalOwners): string {
  const i = ref.indexOf(':')
  if (i <= 0 || i === ref.length - 1) return ref
  const id = ref.slice(0, i)
  const pin = ref.slice(i + 1)
  const type = layout?.components.find((c) => c.id === id)?.type
  const entry = type ? getEntry(type) : undefined
  if (entry) {
    const name = pinDisplayName(entry, pin)
    if (pin === '+' || pin === '-' || !TERMINAL_CATEGORIES.includes(entry.category)) return idJoin(id, name)
    return idJoin(id, terminalWord(name))
  }
  if (pin === '+') return idJoin(id, t('positive terminal'))
  if (pin === '-') return idJoin(id, t('negative terminal'))
  return idJoin(id, terminalWord(/^[a-z]{2,}$/.test(pin) ? tCtx(pin, 'pin') : pin))
}

/** 「COM」 → 「COM 端」, 「輸出」 → 「輸出端」 (no space after a CJK word); English 'COM terminal'. */
function terminalWord(name: string): string {
  return t('{name} terminal', { name }).replace(/([一-鿿]) 端$/, '$1端')
}
