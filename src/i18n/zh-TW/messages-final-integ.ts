/**
 * zh-TW texts of the final integration round's runtime messages (English
 * stays the source text; see src/i18n/messages.ts):
 *  - rules-power.ts: a module regulator's output pin left unfed because its
 *    jumper is removed (the L298N's +5V without the 5V-EN jumper).
 */
import type { MessagePattern } from '../messages'
import { CATALOG } from '../../model/catalog'
import { partTranslation } from '../parts'
import { labelZh } from './messages-erc'
import { tpl } from './messages-core'

/** An English part-param label ('5V-EN regulator jumper') → its zh-TW label. */
function paramLabelZh(label: string): string {
  for (const e of Object.values(CATALOG)) {
    const p = e.params?.find((x) => x.label === label)
    const zh = p ? partTranslation(e.type)?.params?.[p.key] : undefined
    if (zh) return zh
  }
  return label
}

/** A space before a label that starts with Latin text (「拔掉 5V-EN 穩壓器跳線帽後」). */
const spaced = (s: string): string => (/^[!-~]/.test(s) ? ` ${s}` : s)

export const MESSAGES_ZH: MessagePattern[] = [
  tpl(
    '«id»’s «pin» pin is not connected to any supply (at «at»): with the «j» removed, the «l» needs its own «v» there. Wire «pin2» to a «v2» supply, or fit the jumper so the on-board regulator makes it from «from».',
    (g) =>
      `${g.id} 的 ${g.pin} 腳位沒有連接到任何電源${g.at === `${g.id}:${g.pin}` ? '' : `（位於 ${g.at}）`}：` +
      `拔掉${spaced(paramLabelZh(g.j))}後，${labelZh(g.l)}需要在這裡另外接 ${g.v}。` +
      `請把 ${g.pin2} 接到 ${g.v2} 的電源，或插上跳線帽，讓板載穩壓器從 ${g.from} 產生。`,
  ),
]
