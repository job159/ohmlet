/**
 * zh-TW runtime messages of the damage models (owner: vivid): the
 * simulator's issues when a resistor's thermal model burns it open or an
 * electrolytic capacitor vents (src/sim/devices.ts), and the matching ERC
 * findings (src/sim/erc/rules-damage.ts), and the log line of a part
 * replaced by 〔換新〕 (SimulationCoordinator.repairParts). Ids and values
 * with units stay; full-width punctuation.
 */
import type { MessagePattern } from '../messages'
import { tpl } from './messages-core'
import { labelZh } from './messages-erc'

/** "250 mW" / "rated" (no rating) */
function powerZh(p: string): string {
  return p === 'rated' ? '額定' : `額定 ${p} `
}

export const MESSAGES_ZH: MessagePattern[] = [
  // ---- simulator issues ----
  tpl(
    '«id!» burned open («p» in a «r» resistor) — use a larger resistance or a higher-wattage resistor',
    (g) => `${g.id} 燒斷了（${g.r} 的電阻承受了 ${g.p}）——請改用阻值更大或瓦數更高的電阻`,
  ),
  tpl(
    '«id!» vented: «v#» V reverse voltage on a polarized capacitor — turn it around (+ lead toward the higher voltage)',
    (g) => `${g.id} 洩壓閥爆開：極性電容承受 ${g.v} V 反向電壓——請把它轉過來（+ 腳接較高的電壓）`,
  ),

  // ---- ERC findings (rules-damage) ----
  tpl(
    '«id!» («label») burned open in the simulation: it dissipated many times its «p» power until its film overheated and burned through, so it no longer conducts. Use a larger resistance or a higher-wattage resistor; a circuit edit puts in a new one (in the workspace, “Replace” and a value change do too).',
    (g) =>
      `${g.id}（${labelZh(g.label)}）在模擬中燒斷了：它消耗的功率是${powerZh(g.p)}功率的好幾倍，電阻膜過熱燒穿，已經不導電。請改用阻值更大或瓦數更高的電阻，再按〔換新〕；改好電路或數值時也會自動換新。`,
  ),
  tpl('«id!» burned open', (g) => `${g.id} 燒斷了`),
  tpl(
    '«id!» («label») vented in the simulation: its + lead sat more than 1 V below its − lead, and a reversed electrolytic capacitor heats up until its pressure vent opens. A real one is ruined (it loses capacitance and may short); the simulation keeps its value. Turn it around so + goes to the higher voltage; a circuit edit puts in a new one (in the workspace, “Replace” and a value change do too).',
    (g) =>
      `${g.id}（${labelZh(g.label)}）在模擬中洩壓閥爆開：它的 + 腳比 − 腳低了超過 1 V，反接的電解電容會發熱，直到頂部的洩壓閥爆開。實際的電容已經損壞（容量流失，還可能短路），模擬仍沿用原本的容值。請把它轉過來讓 + 腳接較高的電壓，再按〔換新〕；改好電路或數值時也會自動換新。`,
  ),
  tpl('«id!» vented (reversed)', (g) => `${g.id} 反接爆開`),

  // ---- 換新 (round 5 — damage): the simulation log's line for a part replaced in place ----
  tpl('«id!» replaced with a new part', (g) => `${g.id} 已換上新的`),
]
