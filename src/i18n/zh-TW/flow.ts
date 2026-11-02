/**
 * zh-TW — 顯示電流 (current flow, owner: flow): the checkbox chip beside the
 * run capsule, its key, toasts and the 更多 → 模擬 row
 * (src/ui/chrome/FlowToggle.tsx). One legend everywhere:
 * 「光點越快越密＝電流越大，方向＝由正到負」 (conventional current, + → −;
 * the dots have ONE colour — magnitude is their speed and density only).
 * Also the words of an LED's eye-averaged current (sim telemetry honesty,
 * NP3): 「平均 2.98 mA」 / 「峰值 4.07 mA」.
 * Taiwan usage; full-width punctuation.
 */
const dict: Record<string, string> = {
  'Show current': '顯示電流',
  'Faster, denser dots = more current; direction = from + to −': '光點越快越密＝電流越大，方向＝由正到負',
  'Show current: {legend}': '顯示電流：{legend}',
  'Current flow hidden': '已關閉電流顯示',
  'Current flow on — run the simulation to see it': '已開啟電流顯示——執行模擬時就會看到電流流動',
  'While the simulation runs, moving dots show the current: {legend}': '模擬執行時，用流動的光點顯示電流：{legend}',
  // the chip's short label on a phone (☑ 電流)
  'Current|flow-chip': '電流',
  // a loop the simulation cannot close (SimTelemetry.flowConcealed): said once per run, honest instead of silent
  'The current loop of {id} cannot be traced completely — its dots are hidden for now': '{id} 的電流迴路無法完整追蹤，暫不顯示它的光點',
  'The current loops of {ids} cannot be traced completely — their dots are hidden for now': '{ids} 的電流迴路無法完整追蹤，暫不顯示它們的光點',
  ', |flow-list': '、',
  // an LED's eye-averaged current that averages a switching (PWM) current (src/instruments/led-light.ts
  // isAveragedLed): 「平均 2.98 mA」, the oscilloscope's word; its on-current under the row title
  'average {v}|reading': '平均 {v}',
  'peak {v}|reading': '峰值 {v}',
}

export default dict
