/**
 * Display-time localisation of the AI Circuit Builder's runtime text: the
 * progress statuses (llm.status), the user-facing errors (llm.error, from
 * src/llm/client.ts friendlyApiError / generate.ts / the store) and the
 * machine-tested expectation lines (src/llm/verify.ts describeExpectation).
 * The LLM pipeline keeps producing English (its tests and repair prompts
 * read it); the AI sheet and the status capsule translate here.
 *
 * Fixed texts go through t() (zh-TW: src/i18n/zh-TW/sheets.ts); the few
 * parameterised shapes are matched with anchored regexes. Anything unknown
 * falls through to tMessage() (the simulator message tables) and finally
 * to the English text itself.
 */
import { hasTranslation, lang, t } from '../../i18n'
import { tMessage } from '../../i18n/messages'

type Rule = [RegExp, (m: RegExpMatchArray) => string]

function viaRules(text: string, rules: readonly Rule[]): string {
  if (lang() === 'en') return text
  if (hasTranslation(text)) return t(text)
  for (const [re, fmt] of rules) {
    const m = text.match(re)
    if (m) return fmt(m)
  }
  return tMessage(text)
}

const STATUS_RULES: readonly Rule[] = [
  [/^repairing \(attempt (\d+)\)…$/, (m) => t('repairing (attempt {n})…', { n: m[1] })],
]

/** llm.status ("thinking…", "repairing (attempt 2)…", …) for display. */
export function aiStatusText(status: string): string {
  return viaRules(status, STATUS_RULES)
}

/** One "- failure" line of a repair summary. */
const bullet = (line: string): string => line.replace(/^- (.*)$/, (_, msg: string) => `- ${tMessage(msg)}`)

const ERROR_RULES: readonly Rule[] = [
  [
    /^The model "(.+)" was not found \(404\)\. Your account may not have access to it yet\.$/,
    (m) => t('The model "{model}" was not found (404). Your account may not have access to it yet.', { model: m[1] }),
  ],
  [/^The Claude API rejected the request \(400\): ([\s\S]*)$/, (m) => t('The Claude API rejected the request (400): {detail}', { detail: m[1] })],
  [
    /^Claude API error \((\d+)\): ([\s\S]*)$/,
    (m) => t('Claude API error ({status}): {detail}', { status: m[1], detail: m[2] }),
  ],
  [/^Claude API error: ([\s\S]*)$/, (m) => t('Claude API error: {detail}', { detail: m[1] })],
  [
    /^Claude could not produce a working circuit after (\d+) attempts\. Last failures:\n([\s\S]*)$/,
    (m) =>
      t('Claude could not produce a working circuit after {n} attempts. Last failures:', { n: m[1] }) +
      '\n' +
      m[2].split('\n').map(bullet).join('\n'),
  ],
  [
    /^Generated circuit failed validation: ([\s\S]*)$/,
    (m) => t('Generated circuit failed validation: {detail}', { detail: m[1].split('; ').map(tMessage).join('；') }),
  ],
  [/^verification worker error: ([\s\S]*)$/, (m) => t('verification worker error: {detail}', { detail: m[1] })],
]

/** llm.error for display. */
export function aiErrorText(error: string): string {
  return viaRules(error, ERROR_RULES)
}

const EXPECTATION_RULES: readonly Rule[] = [
  [/^LED (\S+) lights up$/, (m) => t('LED {id} lights up', { id: m[1] })],
  [/^LED (\S+) stays off until you interact$/, (m) => t('LED {id} stays off until you interact', { id: m[1] })],
  [/^LED (\S+) blinks at (.+)$/, (m) => t('LED {id} blinks at {range}', { id: m[1], range: m[2] })],
  [/^display (\S+) shows "(.*)"$/, (m) => t('display {id} shows "{digit}"', { id: m[1], digit: m[2] })],
  [/^net (\S+) oscillates at (.+)$/, (m) => t('net {id} oscillates at {range}', { id: m[1], range: m[2] })],
  [
    /^net (\S+) stays within (\S+)V to (\S+)V$/,
    (m) => t('net {id} stays within {min}V to {max}V', { id: m[1], min: m[2], max: m[3] }),
  ],
  [/^buzzer (\S+) sounds$/, (m) => t('buzzer {id} sounds', { id: m[1] })],
]

/** A verified-expectation summary line ("LED D1 blinks at 0.5-3Hz") for display. */
export function aiExpectationText(line: string): string {
  return viaRules(line, EXPECTATION_RULES)
}
