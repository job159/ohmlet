/**
 * Stable text formats of the instrument layer (annotations, readouts,
 * exports). Tests pin these strings, so change them deliberately.
 *
 * Also the app-wide unit formatter (UX helper H3 — docs/ux/UX_VERIFY.md
 * §5.4 「同一個量，同一種格式」): every voltage / current / power / frequency
 * / percentage / speed factor / simulation time the UI prints goes through
 * the functions in the second half of this file, so the hover chip, the
 * inspector, the lessons, the ERC texts and the instruments never disagree:
 *
 *   fmtVoltage(3.3)                      "3.30 V"   (compact, 3 significant digits)
 *   fmtVoltage(1.7984, {precision: 'reading'})  "1.798 V" (4 significant digits)
 *   fmtVoltage(0.5)                      "500 mV"
 *   fmtCurrent(9.7e-3)                   "9.70 mA"  fmtPower(0.031) "31.0 mW"
 *   fmtFreq(999.7) "999.7 Hz"            fmtPercent(0.5) "50.0 %"
 *   fmtSpeedFactor(0.17) "0.2 倍速"       fmtSimClock(187.84) "187.8 s"
 *   fmtSimTimeAt(2.704391, 1e-6) "2.704 391 s"   approx("851.9 mV") "≈ 851.9 mV"
 *
 * Honest limits (a value that may be wrong is never printed): |V| < 1 mV →
 * "0 V", |I| < 1 nA → "0 A", |P| < 1 µW → "0 W" (never "−0"); a non-finite
 * value or |V| > 1 kV (a solver that did not converge) → "—" (or the
 * caller's `invalid` text); |I| > 2 A → "> 2 A（短路）". Negative numbers use
 * the typographic minus "−" (U+2212). A number and its unit are always
 * separated by one space. Pure (i18n only for the few words: 倍速, 短路).
 */
import { t } from '../i18n'

/** Hex digits for a `bits`-wide word: 8 → 2, 9 → 3, 16 → 4. */
export function hexWidth(bits: number): number {
  return Math.max(1, Math.ceil(bits / 4))
}

/** "0x48" / "0x1A5" (upper-case, zero-padded to the word width). */
export function fmtHex(v: number, bits = 8): string {
  return `0x${(v >>> 0).toString(16).toUpperCase().padStart(hexWidth(bits), '0')}`
}

/** "48" — the compact form used when an annotation span is narrow. */
export function fmtHexShort(v: number, bits = 8): string {
  return (v >>> 0).toString(16).toUpperCase().padStart(hexWidth(bits), '0')
}

const ESCAPES: Record<number, string> = { 0x00: '\\0', 0x09: '\\t', 0x0a: '\\n', 0x0d: '\\r' }

/**
 * ASCII rendering of a byte: 'H' for printable characters (0x20–0x7E),
 * \r \n \t \0 for the usual control characters, '' otherwise (and for
 * words wider than 8 bits).
 */
export function asciiOf(v: number, bits = 8): string {
  if (bits > 8) return ''
  if (v >= 0x20 && v <= 0x7e) return `'${String.fromCharCode(v)}'`
  return ESCAPES[v] ?? ''
}

/** "0x48 'H'", "0x0D \r", "0x9F", "0x1A5" — hex + ASCII. */
export function fmtWord(v: number, bits = 8): string {
  const a = asciiOf(v, bits)
  return a ? `${fmtHex(v, bits)} ${a}` : fmtHex(v, bits)
}

const PREFIXES: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
]

/**
 * SI-prefixed value with `digits` significant digits: fmtSi(1000.4, 'Hz')
 * → "1.000 kHz", fmtSi(0.0025, 's') → "2.500 ms", fmtSi(-0.12, 'V', 3) →
 * "-120 mV". Non-finite → "—".
 */
export function fmtSi(x: number, unit: string, digits = 4): string {
  if (!Number.isFinite(x)) return '—'
  if (x === 0) return `0 ${unit}`
  const a = Math.abs(x)
  let [scale, prefix] = PREFIXES[PREFIXES.length - 1]
  for (const p of PREFIXES) {
    if (a >= p[0] * 0.9995) {
      ;[scale, prefix] = p
      break
    }
  }
  const s = x / scale
  const intDigits = Math.max(1, Math.floor(Math.log10(Math.abs(s) + 1e-12)) + 1)
  let decimals = Math.max(0, digits - intDigits)
  // rounding may carry into a new integer digit (99.996 → "100.00")
  if (decimals > 0 && Math.abs(Number(s.toFixed(decimals))) >= 10 ** intDigits) decimals--
  return `${s.toFixed(decimals)} ${prefix}${unit}`
}

/**
 * Frequency for every analyzer / scope readout (UX IS-1). Never a milli
 * prefix — "998.0 mHz" reads as MHz at a glance:
 *   < 1 Hz        3 significant digits in Hz   0.998 Hz · 0.0500 Hz
 *   1 Hz – 1 kHz  4 significant digits in Hz   1.000 Hz · 50.00 Hz · 998.0 Hz
 *   ≥ 1 kHz       4 significant digits, k / M / G   1.000 kHz · 72.00 MHz
 * Rounding that carries into the next range moves up a range (999.96 Hz →
 * "1.000 kHz"). Non-finite or ≤ 0 → "—" (a frequency is never negative).
 * `digits: 3` for an estimate the data cannot resolve to 4 (an analog
 * frequency from coarse samples, UX IS-11): "1.01 kHz", "999 Hz".
 */
export function fmtFreq(hz: number, digits: 3 | 4 = 4): string {
  if (!Number.isFinite(hz) || hz <= 0) return '—'
  if (hz < 1) {
    const r = Number(hz.toPrecision(3))
    if (r < 1) return `${hz.toPrecision(3)} Hz`
  }
  // `digits` significant digits; let the rounded value pick the unit (0.9996 Hz
  // rounds to 1.00 at 3 digits → "1.000 Hz")
  const r = Math.max(1, Number(hz.toPrecision(digits)))
  if (r < 1e3) return `${r.toPrecision(digits)} Hz`
  if (r < 1e6) return `${(r / 1e3).toPrecision(digits)} kHz`
  if (r < 1e9) return `${(r / 1e6).toPrecision(digits)} MHz`
  return `${(r / 1e9).toPrecision(digits)} GHz`
}

/**
 * Compact time length for zoom / timebase labels: trailing zeros dropped,
 * "10 ms", "500 µs", "2 s", "1.5 ms" (3 significant digits at most).
 */
export function fmtSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  return fmtSi(seconds, 's', 3).replace(/\.0+ /, ' ').replace(/(\.\d*?)0+ /, '$1 ')
}

/**
 * A range of times (pulse widths) with 3 significant digits, the unit
 * written once when both ends share it: "501 ms" (min ≈ max), "8.68–86.8 µs",
 * "950 µs–1.20 ms". Non-finite → "—".
 */
export function fmtTimeRange(min: number, max: number): string {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '—'
  const lo = fmtSi(min, 's', 3)
  if (!(max > min * 1.001)) return lo
  const hi = fmtSi(max, 's', 3)
  const sp = lo.lastIndexOf(' ')
  return hi.endsWith(lo.slice(sp)) ? `${lo.slice(0, sp)}–${hi}` : `${lo}–${hi}`
}

/**
 * Percentage of a 0..1 fraction (H3): one decimal below 100 % —
 * 0.5 → "50.0 %", 0.034 → "3.4 %", 1 → "100 %", 1.234 → "123 %" — always
 * with a space before "%", never "−0.0 %". `digits: 0` rounds to whole
 * percent ("97 %", for a brightness label). Non-finite → "—".
 */
export function fmtPercent(f: number, opts: { digits?: 0 | 1 } = {}): string {
  if (!Number.isFinite(f)) return '—'
  const p = f * 100
  const digits = opts.digits ?? 1
  const s = digits === 0 || Math.abs(p) >= 99.95 ? Math.round(p).toFixed(0) : p.toFixed(1)
  return `${noNegativeZero(s)} %`
}

// ---------------------------------------------------------------------------
// App-wide units (UX helper H3)
// ---------------------------------------------------------------------------

/** Typographic minus for negative numbers. */
const MINUS = '−'

/** "-0", "-0.00" → "0", "0.00"; "-1.5" → "−1.5" (typographic minus). */
function noNegativeZero(s: string): string {
  if (!s.startsWith('-')) return s
  return /^-0(?:\.0*)?$/.test(s) ? s.slice(1) : MINUS + s.slice(1)
}

/** |V| above this is a solver artefact, never a reading (1 kV). */
export const VOLTAGE_LIMIT_V = 1000
/** |V| below this prints as "0 V" (1 mV). */
export const VOLTAGE_FLOOR_V = 1e-3
/** |I| below this prints as "0 A" (1 nA). */
export const CURRENT_FLOOR_A = 1e-9
/** |I| above this means a short circuit, not a number to read (2 A). */
export const SHORT_CIRCUIT_A = 2
/** |P| below this prints as "0 W" (1 µW). */
export const POWER_FLOOR_W = 1e-6

/**
 * Options of the H3 quantity formatters.
 *  - precision: 'compact' (default) = 3 significant digits ("3.30 V",
 *    "500 mV") for chips, rows and messages; 'reading' = 4 ("1.798 V",
 *    "5.000 V") for a meter's big readout and instrument measurements.
 *  - invalid: text for a value that cannot be trusted (non-finite, or
 *    |V| > 1 kV) instead of "—" — e.g. t('— (solver did not converge)').
 *  - plain: language-neutral English for the few words the formatter adds
 *    ("> 2 A (short circuit)") — for simulator / ERC messages that are
 *    translated later at the display boundary (tMessage).
 */
export interface QuantityFormat {
  precision?: 'compact' | 'reading'
  invalid?: string
  plain?: boolean
}

/** One scaled number: `digits` significant digits, rounding that carries moves up a prefix. */
function scaled(x: number, unit: string, prefixes: readonly (readonly [number, string])[], digits: number): string {
  const a = Math.abs(x)
  // a value that rounds up to the next prefix takes it (999.6 mV → "1.00 V")
  const carry = 1 - 5 * 10 ** -(digits + 1)
  let [scale, prefix] = prefixes[prefixes.length - 1]
  for (const p of prefixes) {
    if (a >= p[0] * carry) {
      ;[scale, prefix] = p
      break
    }
  }
  const s = x / scale
  const intDigits = Math.max(1, Math.floor(Math.log10(Math.abs(s) + 1e-12)) + 1)
  let decimals = Math.max(0, digits - intDigits)
  // rounding may carry into a new integer digit (9.996 → "10.00" at 4 digits)
  if (decimals > 0 && Math.abs(Number(s.toFixed(decimals))) >= 10 ** intDigits) decimals--
  return `${noNegativeZero(s.toFixed(decimals))} ${prefix}${unit}`
}

const VOLT_PREFIXES = [
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
] as const
const AMP_PREFIXES = [
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
] as const
const WATT_PREFIXES = [
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
] as const

const sigDigits = (o: QuantityFormat): number => (o.precision === 'reading' ? 4 : 3)

/** A voltage that may be printed (finite, |V| ≤ 1 kV). */
export function isTrustedVoltage(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= VOLTAGE_LIMIT_V
}

/**
 * A voltage (H3): "3.30 V", "500 mV", "1.798 V" (reading), "−1.20 V";
 * |V| < 1 mV → "0 V"; non-finite / null / |V| > 1 kV → "—" (or `invalid`).
 */
export function fmtVoltage(v: number | null | undefined, opts: QuantityFormat = {}): string {
  if (!isTrustedVoltage(v)) return opts.invalid ?? '—'
  if (Math.abs(v) < VOLTAGE_FLOOR_V) return '0 V'
  return scaled(v, 'V', VOLT_PREFIXES, sigDigits(opts))
}

/** |I| above SHORT_CIRCUIT_A — a short circuit, not a reading. */
export function isShortCircuitCurrent(i: number | null | undefined): boolean {
  return typeof i === 'number' && Number.isFinite(i) && Math.abs(i) > SHORT_CIRCUIT_A
}

/**
 * A current (H3): "9.70 mA", "120 µA", "1.50 A"; |I| < 1 nA → "0 A";
 * |I| > 2 A → "> 2 A（短路）" (English "> 2 A (short circuit)"); non-finite
 * → "—" (or `invalid`). The sign is kept ("−4.10 mA"): pass Math.abs for a
 * magnitude.
 */
export function fmtCurrent(i: number | null | undefined, opts: QuantityFormat = {}): string {
  if (typeof i !== 'number' || !Number.isFinite(i)) return opts.invalid ?? '—'
  if (Math.abs(i) > SHORT_CIRCUIT_A) return opts.plain ? '> 2 A (short circuit)' : t('> 2 A (short circuit)')
  if (Math.abs(i) < CURRENT_FLOOR_A) return '0 A'
  return scaled(i, 'A', AMP_PREFIXES, sigDigits(opts))
}

/**
 * A power (H3): "31.0 mW", "1.25 W"; |P| < 1 µW → "0 W"; non-finite → "—".
 * With `current` above 2 A the power of a short is meaningless:
 * "—（短路）" (English "— (short circuit)").
 */
export function fmtPower(w: number | null | undefined, opts: QuantityFormat & { current?: number | null } = {}): string {
  if (isShortCircuitCurrent(opts.current)) return opts.plain ? '— (short circuit)' : t('— (short circuit)')
  if (typeof w !== 'number' || !Number.isFinite(w)) return opts.invalid ?? '—'
  if (Math.abs(w) < POWER_FLOOR_W) return '0 W'
  return scaled(w, 'W', WATT_PREFIXES, sigDigits(opts))
}

/**
 * An achieved speed factor (H3, the capsule and the MCU panel): "0.2 倍速",
 * "0.07 倍速", "1.0 倍速", "12 倍速"; below 0.005 "< 0.01 倍速" (never
 * "0 倍速" while something runs). Negative / non-finite → "—".
 */
export function fmtSpeedFactor(x: number | null | undefined): string {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) return '—'
  const n = x < 0.005 ? '< 0.01' : x < 0.1 ? x.toFixed(2) : x < 9.95 ? x.toFixed(1) : x.toFixed(0)
  return t('{x}× speed', { x: n })
}

/**
 * The simulation clock (H3, the run capsule): "3.11 s", "66.90 s",
 * "187.8 s"; from 10 minutes on whole seconds plus the clock —
 * "612 s（10:12）", "3725 s（1:02:05）". Never "3:07.8". Negative /
 * non-finite → "—".
 */
export function fmtSimClock(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 99.995) return `${seconds.toFixed(2)} s`
  if (seconds < 599.95) return `${seconds.toFixed(1)} s`
  const whole = Math.floor(seconds)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const two = (n: number) => String(n).padStart(2, '0')
  const clock = h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
  return t('{s} s ({clock})', { s: whole, clock })
}

/**
 * An absolute simulation time with enough decimals to resolve `resolution`
 * seconds (H3 — marker / cursor readouts): (2.704391, 1e-6) → "2.704 391 s",
 * (2.704391, 1e-3) → "2.704 s", (0.5, 0.01) → "0.50 s". Decimals are grouped
 * by three with a space; at most 9 (ns). A missing / non-positive resolution
 * gives 3 decimals. Non-finite → "—".
 */
export function fmtSimTimeAt(seconds: number | null | undefined, resolution?: number): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—'
  const decimals =
    typeof resolution === 'number' && Number.isFinite(resolution) && resolution > 0
      ? Math.min(9, Math.max(0, Math.ceil(-Math.log10(resolution) - 1e-9)))
      : 3
  const fixed = noNegativeZero(seconds.toFixed(decimals))
  const dot = fixed.indexOf('.')
  if (dot < 0) return `${fixed} s`
  const frac = fixed.slice(dot + 1).replace(/(\d{3})(?=\d)/g, '$1 ')
  return `${fixed.slice(0, dot)}.${frac} s`
}

/**
 * The logic analyzer's ANCHOR tick (QA clarity LA-AXIS): the absolute
 * simulation time of the first labelled division in the footer's format at
 * a tenth of a division (H3 fmtSimTimeAt) — 「2.104 361 8 s」 at 1 µs/格 —
 * without a trailing all-zero digit group (never 「0.102 0 s」, that is
 * 「0.102 s」). Non-finite → "—".
 */
export function fmtTickAnchor(t: number, step: number): string {
  const s = fmtSimTimeAt(t, step / 10)
  // "0.102 0 s" → "0.102 s"; "2.104 360 0 s" → "2.104 360 s"; a significant last digit stays
  return s.replace(/ 0+ s$/, ' s')
}

const OFFSET_UNITS: readonly (readonly [number, string])[] = [
  [1, 's'],
  [1e-3, 'ms'],
  [1e-6, 'µs'],
  [1e-9, 'ns'],
]

/**
 * A logic-analyzer tick as an OFFSET from the anchor (QA clarity LA-AXIS):
 * 「+1 µs」「+20 µs」「+0.5 s」. One unit for the whole axis — the one that
 * reads `maxOffset` (the largest offset on it) without a leading 「0.」 —
 * and the decimals the division `step` needs, trailing zeros dropped.
 */
export function fmtTickOffset(dt: number, step: number, maxOffset: number = dt): string {
  if (!Number.isFinite(dt) || !Number.isFinite(step) || step <= 0) return '—'
  const m = Math.abs(maxOffset) * (1 + 1e-9)
  const [scale, unit] = OFFSET_UNITS.find(([s]) => m >= s) ?? OFFSET_UNITS[OFFSET_UNITS.length - 1]
  const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step / scale) - 1e-9)))
  let num = (dt / scale).toFixed(decimals)
  if (num.includes('.')) num = num.replace(/\.?0+$/, '')
  return `+${noNegativeZero(num)} ${unit}`
}

/**
 * The labels of `count` + 1 ticks starting at `t0`, `step` apart: the
 * anchor in absolute time, every other tick as its offset from it —
 * (2.1043618, 1e-6, 3) → ['2.104 361 8 s', '+1 µs', '+2 µs', '+3 µs'].
 */
export function axisTickLabels(t0: number, step: number, count: number): string[] {
  const out = [fmtTickAnchor(t0, step)]
  for (let k = 1; k <= count; k++) out.push(fmtTickOffset(k * step, step, count * step))
  return out
}

/**
 * An instrument SETTING (QA clarity FG-RAIL — what a function generator is
 * set to, never a measurement): 4 significant digits with the trailing
 * zeros dropped, 「100 Hz」「1 kHz」「2.5 Hz」「12.5 kHz」. Non-finite → "—".
 */
export function fmtSetting(x: number, unit: string): string {
  // a frequency never reads in mHz (fmtFreq's rule): 0.01 Hz, not 「10 mHz」
  if (unit === 'Hz' && Number.isFinite(x) && x > 0 && x < 1) return `${Number(x.toPrecision(4))} Hz`
  const s = fmtSi(x, unit)
  const sp = s.indexOf(' ')
  if (sp < 0) return s
  let num = s.slice(0, sp)
  if (num.includes('.')) num = num.replace(/\.?0+$/, '')
  return `${noNegativeZero(num)}${s.slice(sp)}`
}

/** "−4.000 ms": fmtSi with the typographic minus (H3) for a signed time or voltage; never "−0". */
export function fmtSiSigned(x: number, unit: string, digits = 4): string {
  const s = fmtSi(x, unit, digits)
  const sp = s.indexOf(' ')
  return sp < 0 ? s : `${noNegativeZero(s.slice(0, sp))}${s.slice(sp)}`
}

/**
 * A baud rate (H3, UX IS-11 — the line of a serial pin instead of a
 * meaningless frequency): thousands grouped with a space, "115 200 Bd",
 * "9600 Bd", "1 000 000 Bd"; a fractional rate keeps one decimal
 * ("7812.5 Bd"). Non-finite / ≤ 0 → "—".
 */
export function fmtBaud(baud: number | null | undefined): string {
  if (typeof baud !== 'number' || !Number.isFinite(baud) || baud <= 0) return '—'
  const r = Math.round(baud * 10) / 10
  const [int, frac] = (Number.isInteger(r) ? String(r) : r.toFixed(1)).split('.')
  const grouped = int.length > 4 ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : int
  return `${grouped}${frac ? `.${frac}` : ''} Bd`
}

/** "≈ 851.9 mV" — an estimate, always with a space; "—" stays "—". */
export function approx(text: string): string {
  if (text === '' || text.startsWith('—')) return text
  return text.startsWith('≈') ? text : `≈ ${text}`
}
