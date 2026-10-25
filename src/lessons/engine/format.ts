/**
 * Display text of lesson checks: default labels for checks a lesson left
 * unlabeled and the measured-vs-expected values, through t() (English
 * sources, zh-TW entries in src/i18n/zh-TW/lessons-ui.ts). Pure — the
 * evaluator calls it in node tests and in the lesson-check worker.
 *
 * Numbers go through the app's one unit formatter (UX helper H3,
 * src/instruments/format.ts), so a check says 「量測值 9.70 mA」 exactly as
 * the inspector, the hover chip and the instruments would print that value
 * (UX LS-10). Expected limits are authored numbers: the same units, with
 * the zeros that would claim a precision the author never wrote dropped
 * (「預期 5 mA – 15 mA」, not 「5.00 mA – 15.0 mA」).
 */
import { t } from '../../i18n'
import { partLabel, partParamLabel, type TerminalOwners } from '../../i18n/parts'
import { fmtCurrent, fmtFreq, fmtPercent as fmtPercentH3, fmtVoltage } from '../../instruments/format'
import { getEntry } from '../../model/catalog'
import type { LessonCheck, LessonStimulus, PinRef } from '../types'
import { pinRefText, tidyCjkSpaces } from './refs'

type Quantity = Extract<LessonCheck, { kind: 'measure' }>['quantity']

const PREFIXES: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
]

/** 3 significant digits, trailing zeros trimmed ("2.03", "12", "0.5"). */
function sig3(x: number): string {
  if (Math.abs(x) < 1e-12) return '0'
  const s = x.toPrecision(3)
  return s.includes('e') ? String(Number(s)) : s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** Engineering notation: 0.0094 A → "9.4 mA", 220 Ω → "220 Ω", 4700 → "4.7 kΩ". */
export function fmtSi(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—'
  const a = Math.abs(value)
  if (a === 0) return `0 ${unit}`.trim()
  for (const [scale, prefix] of PREFIXES) {
    if (a >= scale * 0.9995) return `${sig3(value / scale)} ${prefix}${unit}`.trim()
  }
  return `${sig3(value / 1e-12)} p${unit}`.trim()
}

/** duty / brightness ranges: a max above 1 means the lesson wrote percent. */
export function isPercentRange(min: number, max: number): boolean {
  return max > 1 || min > 1
}

/**
 * A value of `quantity` as the rest of the app prints it (H3, compact):
 * 「3.30 V」「500 mV」「9.70 mA」「999.7 Hz」「0.998 Hz」「1.500 kHz」「50.0 %」.
 * Frequencies never use mHz; 0 Hz (a signal that does not change) is 「0 Hz」.
 */
export function fmtQuantity(quantity: Quantity, value: number): string {
  switch (quantity) {
    case 'voltage':
      return fmtVoltage(value)
    case 'current':
      return fmtCurrent(value)
    case 'frequency':
      return value === 0 ? '0 Hz' : fmtFreq(value)
    case 'duty':
    case 'led-brightness':
      return fmtPercentH3(value)
  }
}

/** A 0..1 fraction as percent, as the instruments print it (H3: 「50.0 %」「62.5 %」「100 %」). */
export function fmtPercent(fraction: number): string {
  return fmtPercentH3(fraction)
}

/**
 * An AUTHORED number (an expected limit) in the H3 units without trailing
 * zeros: 0.005 A → 「5 mA」, 1.7 V → 「1.7 V」, 450 Hz → 「450 Hz」, 0.45 →
 * 「45 %」 — the author wrote 5 mA, not 5.00 mA.
 */
export function fmtLimit(quantity: Quantity, value: number): string {
  return fmtQuantity(quantity, value).replace(/(\.\d*?)0+(?=\s)/, '$1').replace(/\.(?=\s)/, '')
}

/** |I| below this is "nothing flows" for a lesson check (leakage of a reversed LED, solver noise): 1 µA. */
export const MEASURED_ZERO_CURRENT_A = 1e-6
/** |V| below this is "0 V" for a lesson check (a net settled to ground): 5 mV. */
export const MEASURED_ZERO_VOLTAGE_V = 5e-3

/** The unit (with prefix) H3 prints the larger end of a range in: 0.015 A → "mA", 0.4 V → "mV". */
function rangeUnit(quantity: 'voltage' | 'current', min: number, max: number): string {
  const ref = Math.max(Math.abs(min), Math.abs(max))
  const text = quantity === 'voltage' ? fmtVoltage(ref) : fmtCurrent(ref)
  const unit = text.slice(text.lastIndexOf(' ') + 1)
  return /^[kmµn]?[VA]$/.test(unit) ? unit : quantity === 'voltage' ? 'V' : 'A'
}

/**
 * A MEASURED value of a measure check (UX LS-5, LS-10), in the app's one
 * format (H3): 「9.70 mA」「1.80 V」「0.998 Hz」「8.000 Hz」「62.5 %」.
 * A value is never rounded to 「≈ 0」 when it is not zero: frequency and
 * duty never clamp (a timer that is 100× too slow reads 「8.000 Hz」, not
 * 「≈ 0 kHz」); only a current below 1 µA or a voltage below 5 mV — the
 * leakage of a reversed LED, a net at ground — reads 「≈ 0」 in the unit of
 * the expected range (「≈ 0 mA」 against 5 mA – 15 mA), never 「7.6 pA」.
 * A short reads 「> 2 A（短路）」; a value that cannot be trusted 「—」.
 */
export function fmtMeasured(quantity: Quantity, value: number, min: number, max: number): string {
  if (!Number.isFinite(value)) return '—'
  switch (quantity) {
    case 'duty':
    case 'led-brightness':
      return fmtPercentH3(value)
    case 'frequency':
      return value === 0 ? '0 Hz' : fmtFreq(Math.abs(value))
    case 'current':
      if (Math.abs(value) < MEASURED_ZERO_CURRENT_A) return `≈ 0 ${rangeUnit('current', min, max)}`
      return fmtCurrent(value)
    case 'voltage':
      if (Math.abs(value) < MEASURED_ZERO_VOLTAGE_V) return `≈ 0 ${rangeUnit('voltage', min, max)}`
      return fmtVoltage(value)
  }
}

/** The expected range of a measure check in display units (「1.7 V – 1.9 V」「5 mA – 15 mA」「45 % – 55 %」). */
export function fmtRange(quantity: Quantity, min: number, max: number): string {
  const scale = (quantity === 'duty' || quantity === 'led-brightness') && isPercentRange(min, max) ? 0.01 : 1
  return t('{min} – {max}', { min: fmtLimit(quantity, min * scale), max: fmtLimit(quantity, max * scale) })
}

/**
 * What a check's stimulus does, in the inspector's own words (final round):
 * 「檢查時會自動操作：0.1 秒時把 ENC1 的「位置」設為 5，0.6 秒時勾選 ENC1
 * 的「按下」」 (「一上電就…」 at 0 s). A boolean param reads as the checkbox
 * the learner would tick; times are seconds after power-on. `parts` says which catalog part
 * each id is (a CircuitLayout fits); '' for an empty stimulus.
 */
export function stimulusText(stimulus: readonly LessonStimulus[], parts?: TerminalOwners): string {
  if (stimulus.length === 0) return ''
  const items = stimulus.map((st) => {
    const type = parts?.components.find((c) => c.id === st.component)?.type
    const entry = type ? getEntry(type) : undefined
    const def = entry?.params?.find((p) => p.key === st.param)
    const param = entry && def ? partParamLabel(entry, st.param, def.label) : st.param
    const at = Number(Math.max(0, st.at).toFixed(3))
    // an SI quantity in the units the value fixes print (0.08 V → 「80 mV」); a count (detents) stays a number
    const si = typeof st.value === 'number' && !!def?.unit && /^(V|A|Ω|Hz|F|H|W|s)$/.test(def.unit)
    const v = { t: at, id: st.component, param, value: si ? fmtSi(st.value as number, def!.unit!) : String(st.value) }
    if (typeof st.value === 'boolean') {
      if (at === 0) return st.value ? t('At power-on: tick {id} “{param}”', v) : t('At power-on: untick {id} “{param}”', v)
      return st.value ? t('{t} s: tick {id} “{param}”', v) : t('{t} s: untick {id} “{param}”', v)
    }
    return at === 0 ? t('At power-on: set {id} “{param}” to {value}', v) : t('{t} s: set {id} “{param}” to {value}', v)
  })
  return t('The check does this itself: {list}', { list: items.join(t('; |stimulus-list')) })
}

/** Localized name of a catalog type ("電阻"), the type id when unknown. */
export function partName(type: string): string {
  const entry = getEntry(type)
  return entry ? partLabel(entry) : type
}

/** Localized quantity name. */
export function quantityName(q: Quantity): string {
  switch (q) {
    case 'voltage':
      return t('Voltage')
    case 'frequency':
      return t('Frequency')
    case 'duty':
      return t('Duty cycle')
    case 'current':
      return t('Current')
    case 'led-brightness':
      return t('LED brightness')
  }
}

/**
 * The lesson's own label, else a generated description of the check, with
 * the app's pin names (H1) — `parts` (the circuit, a CircuitLayout fits)
 * says which catalog part each id is.
 */
export function checkLabel(c: LessonCheck, parts?: TerminalOwners): string {
  if (c.label && c.label.trim()) return c.label
  return tidyCjkSpaces(generatedLabel(c, parts))
}

function generatedLabel(c: LessonCheck, parts?: TerminalOwners): string {
  const pin = (r: PinRef) => pinRefText(r, parts)
  switch (c.kind) {
    case 'has-part':
      return (c.count ?? 1) > 1
        ? t('The circuit has {count} × {part}', { count: c.count ?? 1, part: partName(c.type) })
        : t('The circuit has a {part}', { part: partName(c.type) })
    case 'connected':
      return c.via
        ? t('{a} connects to {b} through a {part}', { a: pin(c.a), b: pin(c.b), part: partName(c.via.type) })
        : t('{a} is connected to {b}', { a: pin(c.a), b: pin(c.b) })
    case 'not-connected':
      return t('{a} is not connected to {b}', { a: pin(c.a), b: pin(c.b) })
    case 'firmware-loaded':
      return c.project
        ? t('{id} has the {project} firmware loaded', { id: c.component, project: c.project })
        : t('{id} has firmware loaded', { id: c.component })
    case 'measure': {
      const where = c.quantity === 'current' || c.quantity === 'led-brightness' ? (c.component ?? pin(c.at)) : pin(c.at)
      return t('{quantity} at {at} is {range}', { quantity: quantityName(c.quantity), at: where, range: fmtRange(c.quantity, c.min, c.max) })
    }
    case 'uart-contains':
      return t('{id} {port} prints “{text}”', { id: c.component, port: c.port, text: c.text })
    case 'firmware-checks':
      return t('The {project} firmware passes its behavior contract', { project: c.project })
    case 'erc-clean':
      return c.level === 'risk'
        ? t('The electrical rule check finds no error or risk')
        : t('The electrical rule check finds no error')
    case 'all':
      return t('All {n} conditions hold', { n: c.checks.length })
  }
}
