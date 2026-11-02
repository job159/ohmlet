/**
 * The app's ONE LED brightness scale (honesty fix F4): brightness = the LED's
 * current / its rated continuous current (20 mA for the 5 mm LED — the
 * catalog's ratings.ifMax, src/sim/devices.ts LED_RATED_CURRENT; telemetry
 * `light`), always printed WITH that current so the number can be checked:
 *
 *   fmtLedLight(0.2035, 0.00407)          「20 %（4.07 mA）」
 *   fmtLedLight(1.055, 0.0211)            「106 %（21.1 mA，超過額定 20 mA）」
 *   fmtLedLight(0, 0, { burned: true })   「0 %（已燒毀）」
 *   fmtLedLight(0.0035, 0.00007)          「0.4 %（70.0 µA）」
 *
 * The 3D LED look (led-look.ts), the inspector, the scene's LED labels, the
 * lesson checks and the catalog all use this scale, so 100 % means the same
 * 20 mA everywhere and a value above 100 % says it is over-driven. The
 * English classic chrome keeps its original 「…%」 of the old I / 10 mA scale
 * — it never calls this; classicLedBrightness gives it that percent of the
 * same eye-averaged current. A PWM LED's current is an average: with
 * `average` (isAveragedLed) it reads 「15 %（平均 2.98 mA）」.
 *
 * Numbers through the app's unit formatter (UX helper H3); words through t()
 * (zh-TW in src/i18n/zh-TW/truth.ts). Pure.
 */
import { t } from '../i18n'
import type { ComponentTelemetry, SimTelemetry } from '../model/types'
import type { ErcFinding } from '../sim/erc'
import { fmtCurrent, fmtPercent } from './format'

/** The rated continuous current brightness is relative to when a part states none (A) — = LED_RATED_CURRENT. */
export const LED_LIGHT_RATED_A = 0.02

/**
 * The brightness in thousandths of the rating — the precision telemetry
 * publishes `light` with (src/sim/devices.ts roundLight) — as an integer, so
 * every surface rounds the same number the same way (P1): the 3D label and
 * the inspector get the telemetry's 0.485, a lesson check the mean of such
 * samples (0.48499999999999993), and both are 485 here — 「49 %」 on every
 * surface, never 49 % beside 48 %. Integer arithmetic also rounds a half
 * percent up (0.145 → 「15 %」, where 0.145 × 100 = 14.499999999999998).
 */
function lightThousandths(light: number): number {
  return Math.round(light * 1000)
}

/** The whole percent a brightness prints as (fmtLight from 10 % up; isOverRated). */
function wholePercent(light: number): number {
  return Math.round(lightThousandths(light) / 10)
}

/**
 * A brightness (I / rated) as percent: whole percent, one decimal below 10 %
 * so a faintly lit LED never reads 「0 %」 (「0.4 %」, 「< 0.1 %」); 「0 %」 for
 * none; '—' when unknown. Rounded from thousandths (lightThousandths), so
 * the same LED reads the same percent everywhere.
 */
export function fmtLight(light: number | null | undefined): string {
  if (typeof light !== 'number' || !Number.isFinite(light)) return '—'
  if (light <= 0) return '0 %'
  const k = lightThousandths(light)
  if (k < 1) return '< 0.1 %'
  if (k < 100) return fmtPercent(k / 1000, { digits: 1 })
  return fmtPercent(wholePercent(light) / 100, { digits: 0 })
}

/** 「20 mA」 — a rating is an authored number: no zeros it never had (not 「20.0 mA」). */
export function fmtRatedCurrent(a: number): string {
  return fmtCurrent(a).replace(/\.0+(?=\s)/, '').replace(/(\.\d*?)0+(?=\s)/, '$1')
}

/** Is this brightness above the rating as printed (「101 %」 and up — never 「100 %，超過額定」)? */
export function isOverRated(light: number | null | undefined): boolean {
  return typeof light === 'number' && Number.isFinite(light) && wholePercent(light) > 100
}

export interface LedLightOptions {
  /** the LED's rated continuous current (A), default 20 mA */
  rated?: number
  /** the LED burned out (it emits nothing and passes no current) */
  burned?: boolean
  /**
   * the current (and so the brightness) is the eye mean of a SWITCHING
   * current — PWM, a fast blink (isAveragedLed): it reads 「15 %（平均 2.98 mA）」
   */
  average?: boolean
}

/**
 * Does this LED's shown current — and its brightness — average a SWITCHING
 * current (PWM, a fast blink)? LED telemetry is the mean over the last
 * 20 ms of simulated time (src/sim/devices.ts LedWindow, like the eye and an
 * ammeter see it); while that window holds on / off edges the model also
 * publishes values.iPeak, the on-current, and every reader says 平均.
 */
export function isAveragedLed(tele: Pick<ComponentTelemetry, 'values'> | null | undefined): boolean {
  const p = tele?.values?.iPeak
  return typeof p === 'number' && Number.isFinite(p)
}

/** the old classic scale's full brightness (A) — = src/sim/devices.ts LED_FULL_CURRENT */
const CLASSIC_FULL_A = 0.01

/**
 * The English classic chrome's 「…%」 (the old I / 10 mA scale, 0…1) of the
 * SAME eye-averaged current the telemetry's `current` shows, so the classic
 * inspector's Current and Brightness rows and its LED label never
 * contradict each other on a PWM LED (telemetry ledBrightness is the
 * engine's instant value: 0 % or 41 % at a 1 kHz PWM while the current reads
 * 2.22 mA). An RGB LED: its brightest intact die (`leds` R / G / B are each
 * die's mean / 10 mA). A part that is no eye-averaged LED (no `light`): its
 * own ledBrightness. undefined when there is none.
 */
export function classicLedBrightness(tele: ComponentTelemetry | null | undefined): number | undefined {
  if (!tele) return undefined
  if (typeof tele.light !== 'number') return tele.ledBrightness
  if (tele.leds) {
    let b = 0
    for (const v of Object.values(tele.leds)) if (v > b) b = v
    return Math.min(b, 1)
  }
  if (tele.burned) return 0
  const i = tele.current
  if (typeof i !== 'number' || !Number.isFinite(i)) return tele.ledBrightness
  return Math.min(Math.max(i / CLASSIC_FULL_A, 0), 1)
}

/** 「平均 2.98 mA」 for an averaged LED current, else 「2.98 mA」 */
function ledCurrentText(current: number, opts: LedLightOptions): string {
  const i = fmtCurrent(Math.abs(current))
  return opts.average ? t('average {v}|reading', { v: i }) : i
}

/**
 * The two parts of fmtLedLight for a narrow row: `value` 「157 %（31.4 mA）」
 * and, above the rating, `over` 「超過額定 20 mA」 (null otherwise) — the
 * inspector puts `over` under the row title so the value never squeezes it.
 */
export function ledLightParts(
  light: number | null | undefined,
  current: number | null | undefined,
  opts: LedLightOptions = {},
): { value: string; over: string | null } {
  if (opts.burned) return { value: t('0 % (burned out)|led'), over: null }
  if (typeof light !== 'number' || !Number.isFinite(light)) return { value: '—', over: null }
  const pct = fmtLight(light)
  const over = isOverRated(light) ? t('above the rated {rated}|led', { rated: fmtRatedCurrent(opts.rated ?? LED_LIGHT_RATED_A) }) : null
  if (typeof current !== 'number' || !Number.isFinite(current)) return { value: pct, over }
  return { value: t('{light} ({current})|led', { light: pct, current: ledCurrentText(current, opts) }), over }
}

/**
 * Brightness WITH the LED current (see the module doc). `current` is the
 * LED's own forward current (A; its magnitude is printed). '—' when the
 * brightness is unknown (no simulation).
 */
export function fmtLedLight(light: number | null | undefined, current: number | null | undefined, opts: LedLightOptions = {}): string {
  if (opts.burned) return t('0 % (burned out)|led')
  if (typeof light !== 'number' || !Number.isFinite(light)) return '—'
  const pct = fmtLight(light)
  if (typeof current !== 'number' || !Number.isFinite(current)) return pct
  const i = ledCurrentText(current, opts)
  if (isOverRated(light)) {
    return t('{light} ({current}, above the rated {rated})|led', { light: pct, current: i, rated: fmtRatedCurrent(opts.rated ?? LED_LIGHT_RATED_A) })
  }
  return t('{light} ({current})|led', { light: pct, current: i })
}

const UNIT_SCALE: Record<string, number> = { A: 1, mA: 1e-3, µA: 1e-6, nA: 1e-9 }

export interface LedSentenceOptions {
  /**
   * the LED's telemetry `light` (I / rated) from the same telemetry the
   * sentence's current came from — exact, so the Problems row reads the very
   * percent the inspector prints (「105 %」 at 21.08 mA, where the sentence's
   * rounded 「21.1 mA」 alone would give 106 %). Without it the brightness is
   * computed from the quoted current.
   */
  light?: number | null
  /** the LED's rated continuous current (A), default 20 mA */
  rated?: number
}

/**
 * An ERC sentence that quotes an LED's measured current with a brightness
 * on the OLD I / 10 mA scale (src/sim/erc/rules-led.ts: "… The simulation
 * measures 31.4 mA through it right now (brightness 100 %).") → the
 * brightness on the app's one scale ("(brightness 157 %)"), from the LED's
 * telemetry `light` when given, else from the current in the same sentence
 * — so the Problems row never contradicts the inspector's 「157 %（31.4 mA，
 * 超過額定 20 mA）」. The percent has the inspector's form (fmtLight): a whole
 * percent from 10 % up; below that the inspector prints one decimal
 * (「7.5 %」), which the sentence's zh-TW template (whole percent only) cannot
 * carry — the brightness is then left out and the current stays. The
 * English source keeps its form (its zh-TW template still applies);
 * idempotent; any other text is returned unchanged.
 */
export function ledSentenceOnOneScale(message: string, opts: LedSentenceOptions = {}): string {
  if (!message.includes('(brightness ')) return message
  const rated = opts.rated ?? LED_LIGHT_RATED_A
  return message.replace(
    /measures (\d+(?:\.\d+)?) (A|mA|µA|nA) through it right now \(brightness -?\d+(?:\.\d+)? %\)/,
    (m, num: string, unit: string) => {
      let light = typeof opts.light === 'number' && Number.isFinite(opts.light) ? Math.max(0, opts.light) : NaN
      if (!Number.isFinite(light)) {
        const i = parseFloat(num) * (UNIT_SCALE[unit] ?? NaN)
        if (!Number.isFinite(i) || !(rated > 0)) return m
        light = i / rated
      }
      const pct = fmtLight(light)
      const whole = /^\d+ %$/.exec(pct)
      return whole
        ? `measures ${num} ${unit} through it right now (brightness ${pct})`
        : `measures ${num} ${unit} through it right now`
    },
  )
}

/**
 * An ERC finding's message with its LED brightness on the app's one scale
 * (F4) — from the LED's own telemetry `light` (the finding's subject,
 * componentIds[0]) when readings are given, so the Problems row, the
 * lesson's ERC check and the inspector print the very same percent; else
 * from the current the sentence quotes. Findings of other rules are
 * returned as they are.
 */
export function ledFindingMessage(f: Pick<ErcFinding, 'rule' | 'message' | 'componentIds'>, telemetry?: SimTelemetry | null): string {
  if (f.rule !== 'led-current') return f.message
  const subject = f.componentIds[0]
  const light = subject ? telemetry?.components[subject]?.light : undefined
  return ledSentenceOnOneScale(f.message, { light })
}
