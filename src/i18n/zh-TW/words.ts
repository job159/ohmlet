/**
 * zh-TW UI strings of the last wording pass (owner: words): the 'over-rating'
 * ERC rule's title and error semantics (src/sim/erc/api.ts ERC_RULES), now
 * that a reversed electrolytic across two rails is a static error shown
 * before Run (src/sim/erc/rules-damage.ts) — the rule is no longer "live
 * only". Shown by t() in the ERC panel, the Problems row's 詳細 and the
 * support matrix (scripts/gen-support-matrix.mjs). Taiwan usage.
 */
const zh: Record<string, string> = {
  'Over rating': '超出額定',
  'the simulation’s own model reports the part destroyed (an LED or RGB die burned out, a resistor burned open, an electrolytic capacitor vented); or, before Run, a polarized capacitor sits reversed by more than 1 V between two rails, so it will vent once powered':
    '模擬模型回報元件已損毀（LED 或 RGB LED 的晶粒燒毀、電阻燒斷、電解電容爆開）；或在執行前就看得出：有極性（電解）電容反接在兩條電源軌之間超過 1 V，一通電就會爆開',
}

export default zh
