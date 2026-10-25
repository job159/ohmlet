/**
 * "Is this string fully Chinese?" for the i18n tests: the Latin words of 3+
 * letters left in a translated string that are not technical tokens.
 *
 * Allowed (kept untranslated by the glossary): identifiers with a digit or
 * an underscore (PA5, USART1, AT24C02, TIM2_CH1, 0x4001, HAL_Delay),
 * acronyms / CamelCase identifiers with 2+ capitals (GPIO, VDDA, SysTick,
 * BusFault, SoC), camelCase identifiers (setIrqLine, binBase), quoted JSON
 * keys ("version"), file names / extensions, rail hole refs (top+5),
 * off-board terminal references (FG1:gnd), quoted circuit-line syntax
 * examples ("PA6 -> PA0: jumper wire"), firmware project names
 * (hal-uart-hello), the 1-Wire bus, units (lux) and a short list of proper
 * names (ohmlet, Cortex, Thumb, Shockley, manufacturers …).
 */

const STRIP: RegExp[] = [
  /\bhttps?:\/\/\S+/g,
  /"[A-Za-z_][\w.-]*"/g, // quoted JSON keys / identifiers / format ids ("ohmlet-project")
  /(?:[\w-]+)?\.(?:ohmlet\.)?(?:json|elf|axf|out|bin|hex|ihex|ihx|dat|txt|vcd|csv|map|symtab|strtab|o)\b/gi, // file names / extensions
  /\b(?:\d+:)?(?:top|bot)[+\-−]\d*/g, // rail holes / rails (top+5, top−)
  /\b(?:hal|bare|soc|cpu)(?:-[a-z0-9]+)+\b/g, // firmware project names
  /\bBlue Pill\b/g,
  /\b[A-Za-z]+\[[^\]]*\]/g, // JSON paths: components[3], holes[0]
  /\b[a-z]+[A-Z]\w*(?:\.\w+)+/g, // dotted camelCase identifiers: logicView.decoders
  /\b[A-Za-z]+\d+:[\w+-]+/g, // off-board terminal references: FG1:gnd, PS1:+
  /"[^"\n]*->[^"\n]*"/g, // quoted circuit-line syntax examples ("PA6 -> PA0: jumper wire")
  /\b1-Wire\b/g, // protocol name (Maxim 1-Wire bus)
]

const ALLOWED = new Set(
  `
  ohmlet Cortex Thumb ARMv Shockley Ebers Moll Intel Schmitt pnjlim
  Infineon International Rectifier Vishay Sharp Songle Microchip Atmel Texas Instruments SparkFun
  Advanced Monolithic Systems STMicroelectronics Dallas Maxim
  kHz mHz kbps bps Mbps mAh Kbit kbit Mbit Mbaud Vin Vth Vout Vcc Vdd exp sat lux
  `
    .split(/\s+/)
    .filter(Boolean),
)

export function englishLeft(s: string, extra: Iterable<string> = []): string[] {
  const allow = new Set([...ALLOWED, ...extra])
  let t = s
  for (const re of STRIP) t = t.replace(re, ' ')
  const out: string[] = []
  for (const tok of t.match(/[A-Za-z0-9_]+/g) ?? []) {
    if (!/[A-Za-z]{3}/.test(tok)) continue
    if (/[0-9_]/.test(tok)) continue
    if ((tok.match(/[A-Z]/g) ?? []).length >= 2) continue // GPIO, SysTick, BusFault, SoC
    if (/^[a-z]+[A-Z]\w*$/.test(tok)) continue // camelCase identifiers
    if (allow.has(tok)) continue
    out.push(tok)
  }
  return out
}

/** Mainland-usage terms the Taiwan glossary forbids (simplified and traditional forms). */
export const MAINLAND_TERMS = [
  '程序',
  '界面',
  '信息',
  '內存',
  '内存',
  '默認',
  '默认',
  '軟件',
  '软件',
  '硬件',
  '數據',
  '数据',
  '文件',
  '視頻',
  '屏幕',
  '鼠標',
  '菜單',
  '設置',
  '缺省',
  '網絡',
]

/** ASCII punctuation glued to a CJK character (should be full-width in Chinese sentences). */
export function halfWidthPunctuation(s: string): string[] {
  const out: string[] = []
  const re = /[一-鿿][,;:!?]|[,;:!?](?=[一-鿿])|[一-鿿]\(|\)[一-鿿]/g
  for (const m of s.matchAll(re)) out.push(s.slice(Math.max(0, (m.index ?? 0) - 6), (m.index ?? 0) + 6))
  return out
}
