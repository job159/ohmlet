/**
 * zh-TW runtime messages of the honest-celebration work (owner: cheer): the
 * static ERC finding for a polarized capacitor wired the wrong way round
 * between two rails (src/sim/erc/rules-damage.ts — said before Run; once the
 * simulation reports the vent, 「C1 反接爆開」 (messages-vivid.ts) takes its
 * row). Ids, hole refs and values with units stay; full-width punctuation;
 * the same words as the vent: 電解電容, + 腳 / − 腳, 洩壓閥.
 */
import type { MessagePattern } from '../messages'
import { tpl } from './messages-core'
import { labelZh } from './messages-erc'

export const MESSAGES_ZH: MessagePattern[] = [
  tpl(
    '«id!» («label») is a polarized capacitor wired the wrong way round: its + lead («a») is at «va» and its − lead («b») at «vb». A reversed electrolytic heats up until its pressure vent opens once the circuit is powered. Turn it around so + goes to the higher voltage.',
    (g) =>
      `${g.id}（${labelZh(g.label)}）是有極性的電解電容，但接反了：+ 腳（${g.a}）在 ${g.va}，− 腳（${g.b}）在 ${g.vb}。反接的電解電容一通電就會發熱，直到頂部的洩壓閥爆開。請把它轉過來，讓 + 腳接較高的電壓。`,
  ),
  tpl('«id!» electrolytic reversed', (g) => `${g.id} 電解電容接反了`),
]
