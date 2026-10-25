/**
 * Runtime simulator messages (SimIssue.message, McuLogEvent / SimLogEntry
 * messages, ERC findings, peripheral support notes) are produced in English
 * by the engine, coordinator, MCU models and checkers. They are translated
 * HERE, at the display boundary, so the simulation code and its tests stay
 * language-neutral.
 *
 * Patterns: src/i18n/zh-TW/messages-*.ts export
 *   MESSAGES_ZH: Array<[RegExp, (m: RegExpMatchArray) => string]>
 * (anchored regexes over the whole English message; first match wins) and
 *   NOTES_ZH: Record<string, string> for long fixed texts (support notes),
 * keyed by the exact English text.
 * tests/i18n collects the messages real circuits and firmware produce and
 * fails when one has no translation.
 */
import { lang } from './index'

export type MessagePattern = [RegExp, (m: RegExpMatchArray) => string]

const modules = import.meta.glob<{ MESSAGES_ZH?: MessagePattern[]; NOTES_ZH?: Record<string, string> }>(
  './zh-TW/messages-*.ts',
  { eager: true },
)
const keys = Object.keys(modules).sort()
const PATTERNS: MessagePattern[] = keys.flatMap((k) => modules[k].MESSAGES_ZH ?? [])
const NOTES: Record<string, string> = Object.assign({}, ...keys.map((k) => modules[k].NOTES_ZH ?? {}))

/** Translate one runtime message (falls back to the English text). */
export function tMessage(msg: string): string {
  if (lang() !== 'zh-TW' || !msg) return msg
  const fixed = NOTES[msg]
  if (fixed !== undefined) return fixed
  for (const [re, fmt] of PATTERNS) {
    const m = msg.match(re)
    if (m) return fmt(m)
  }
  return msg
}

/** Whether a message has a zh-TW translation (coverage tests). */
export function hasMessageTranslation(msg: string): boolean {
  if (NOTES[msg] !== undefined) return true
  return PATTERNS.some(([re]) => re.test(msg))
}
