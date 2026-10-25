/**
 * Display-text helpers for the embedded-lab views and the desktop
 * workspace (on top of src/i18n):
 *
 *   tc(src, ctx)     the project's gettext-style CONTEXT lookup (src/ui/format,
 *                    dictionary key "src|ctx"), re-exported: one English
 *                    word can carry two translations ("Partial" is a support
 *                    level 部分模擬 but a peripheral status 部分; "Stop" is a
 *                    scope status 停止 but a UART parameter 停止位元). Falls
 *                    back to t(src) — English shows `src`.
 *   tText(src)       UI dictionary first, then the runtime-message tables
 *                    (tMessage) — for English texts produced by data tables
 *                    (ERC rule semantics, pin notes) that either side may
 *                    translate.
 *   pinModeLabel     compact Chinese tag for the firmware-programmed pin mode
 *                    (telemetry.mcu.pinModes: 'in↑', 'af-od' …).
 *   placementText    localized "8 leads" / "DIP-8" / "off-board" meta.
 *   decoderInfoText  logic-analyzer decoder notes ("auto: 9600 Bd" …).
 *   firmwareDescriptionText  loader one-line image description.
 *   pinNameText      lower-case catalog pin names (anode, gate, wiper …) in
 *                    the UI language; PA5 / VCC / SDA stay as they are.
 *   pinFunctionText  pin function chips: "USART1_TX (remap)" keeps the
 *                    signal name, localizes the "(remap)" note.
 *   logSourceText    simulation-log source ids ('sim', 'U1/loader') for display.
 *   tNodes           t() whose {placeholders} are React nodes — used to keep
 *                    tool names / paths / hashes inside a sentence marked
 *                    translate="no" (noTranslate).
 *
 * The simulation/catalog data stays English (it feeds tests, the LLM
 * prompt and the validator); translation happens here, at display time.
 */
import { createElement, Fragment, type ReactNode } from 'react'
import { lang, t } from '../../i18n'
import { tMessage } from '../../i18n/messages'
import type { CatalogEntry } from '../../model/catalog'
import { tc } from '../format'

export { tc }

const messageCache = new Map<string, string>()
let messageCacheLang = lang()

/**
 * tMessage with a bounded cache, for views that re-render long lists of
 * runtime messages (simulation log: up to 1500 rows at ≤ 10 Hz; the same
 * texts repeat), so the pattern tables are not re-scanned per row/frame.
 */
export function tMessageCached(msg: string): string {
  const l = lang()
  if (l !== 'zh-TW' || !msg) return msg
  if (l !== messageCacheLang) {
    messageCache.clear()
    messageCacheLang = l
  }
  let out = messageCache.get(msg)
  if (out === undefined) {
    out = tMessage(msg)
    if (messageCache.size >= 4000) messageCache.clear()
    messageCache.set(msg, out)
  }
  return out
}

/** UI dictionary, then the runtime-message tables. */
export function tText(src: string): string {
  if (!src) return src
  const a = t(src)
  return a !== src ? a : tMessage(src)
}

/**
 * Firmware-programmed pin mode tag (McuBoardChip.fillTelemetry: an / in /
 * in↑ / in↓ / out / od / af / af-od, plus rst / gnd / pwr / nc for the
 * board's non-GPIO pins) → compact label.
 */
export function pinModeLabel(mode: string): string {
  return tc(mode, 'pin-mode')
}

/** "8 leads" / "DIP-8" / "40-pin" / "off-board" / "probe" (PartsSheet.placementMeta, localized). */
export function placementText(entry: CatalogEntry): string {
  const n = entry.pins.length
  switch (entry.placement) {
    case 'leads':
      return t('{n} leads', { n })
    case 'dip':
      return `DIP-${n}`
    case 'footprint':
      return t('{n}-pin', { n })
    case 'offboard':
      return t('off-board')
    case 'probe':
      return t('probe')
  }
}

/** Decoder notes from src/instruments/decoders (uart.ts / spi.ts). */
export function decoderInfoText(s: string): string {
  if (lang() !== 'zh-TW') return s
  let m = /^auto: (\d+) Bd \(measured (\d+) Bd\)$/.exec(s)
  if (m) return t('auto: {baud} Bd (measured {measured} Bd)', { baud: m[1], measured: m[2] })
  m = /^auto: (\d+) Bd$/.exec(s)
  if (m) return t('auto: {baud} Bd', { baud: m[1] })
  return tText(s)
}

/**
 * The loader's one-line description (src/mcu/loader: elf.ts / bin.ts /
 * ihex.ts). The runtime-message tables win when they cover it.
 */
export function firmwareDescriptionText(s: string): string {
  if (lang() !== 'zh-TW') return s
  const viaMessages = tMessage(s)
  if (viaMessages !== s) return viaMessages
  let m = /^ELF32 ARM((?:, [\w-]+)*), (Thumb entry|entry) (0x[0-9A-Fa-f]+)$/.exec(s)
  if (m) {
    const flags = m[1] ? m[1].slice(2).split(', ').map((f) => tc(f, 'elf-flag')).join('、') : ''
    return t(m[2] === 'Thumb entry' ? 'ELF32 ARM{flags}, Thumb entry {addr}' : 'ELF32 ARM{flags}, entry {addr}', {
      flags: flags ? `（${flags}）` : '',
      addr: m[3],
    })
  }
  m = /^raw binary, (\d+) bytes at (0x[0-9A-Fa-f]+)$/.exec(s)
  if (m) return t('raw binary, {n} bytes at {addr}', { n: m[1], addr: m[2] })
  m = /^Intel HEX, (\d+) bytes in (\d+) blocks?(?:, entry (0x[0-9A-Fa-f]+))?$/.exec(s)
  if (m) {
    const base = t('Intel HEX, {n} bytes in {blocks} blocks', { n: m[1], blocks: m[2] })
    return m[3] ? base + t(', entry {addr}', { addr: m[3] }) : base
  }
  return s
}

/**
 * Catalog pin names that are ordinary lower-case words (anode / cathode,
 * gate / drain / source, emitter / collector, wiper, common …) in the UI
 * language; technical names (PA5, VCC, SDA, D0) and single letters (a, b) are returned as is.
 */
export function pinNameText(pin: string): string {
  return /^[a-z]{2,}$/.test(pin) ? tc(pin, 'pin') : pin
}

/** Pin function chip ("USART1_TX (remap)"): the signal stays, the note is localized. */
export function pinFunctionText(fn: string): string {
  const m = /^(.*) \(remap\)$/.exec(fn)
  return m ? t('{fn} (remap)', { fn: m[1] }) : fn
}

/**
 * Simulation-log source id for display: 'sim' / 'lab' and the MCU's
 * 'core' / 'loader' segments are words, peripheral names (USART1, RCC) and
 * component ids stay. The raw id is still what the filter matches.
 */
export function logSourceText(source: string): string {
  if (lang() !== 'zh-TW') return source
  return source
    .split('/')
    .map((seg) => (/^[a-z]+$/.test(seg) ? tc(seg, 'log-source') : seg))
    .join('/')
}

/** An inline run that must not be translated (tool names, paths, hashes, file names). */
export function noTranslate(text: string): ReactNode {
  return createElement('span', { translate: 'no' }, text)
}

/**
 * t() for a sentence with embedded nodes: `{name}` placeholders whose name
 * is in `nodes` are replaced by those React nodes (others interpolate as
 * plain text through `params`).
 */
export function tNodes(src: string, nodes: Record<string, ReactNode>, params?: Record<string, string | number>): ReactNode[] {
  const s = t(src, params)
  const out: ReactNode[] = []
  const re = /\{(\w+)\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (!(m[1] in nodes)) continue
    if (m.index > last) out.push(s.slice(last, m.index))
    out.push(createElement(Fragment, { key: `${m[1]}@${m.index}` }, nodes[m[1]]))
    last = m.index + m[0].length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}
