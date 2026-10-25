/**
 * zh-TW runtime messages of the motors & drivers family
 * (src/sim/models/motors.model.ts): DC motor stall, SG90 servo signal and
 * supply, L298N / TB6612FNG / DRV8833 bridges and the A4988 / DRV8825 /
 * TMC2209 step/dir drivers. Ids, pin names, part numbers, numbers and units
 * stay verbatim; Chinese sentences use full-width punctuation.
 */
import type { MessagePattern } from '../messages'
import { tpl } from './messages-core'

const AB_ZH: Record<string, string> = { A: 'A', B: 'B' }

export const MESSAGES_ZH: MessagePattern[] = [
  // ---- DC motor
  tpl(
    '«id»: motor stalled — «i#» A through the armature (the load torque exceeds the motor torque)',
    (g) => `${g.id}：馬達堵轉——電樞電流 ${g.i} A（負載轉矩大於馬達轉矩）`,
  ),

  // ---- SG90 servo
  tpl(
    '«id»: SIG pulse of «w#» ms ignored — a servo expects 0.5–2.5 ms pulses about every 20 ms',
    (g) => `${g.id}：SIG 脈波 ${g.w} ms 已忽略——伺服機需要約每 20 ms 一個 0.5–2.5 ms 的脈波`,
  ),
  tpl("«id»: servo supply «v#» V is above the SG90's 4.8–6 V range", (g) => `${g.id}：伺服機電源 ${g.v} V 高於 SG90 的 4.8–6 V 範圍`),
  tpl(
    "«id»: servo supply «v#» V is below the SG90's 4.8 V rating — it moves slowly and weakly",
    (g) => `${g.id}：伺服機電源 ${g.v} V 低於 SG90 的 4.8 V 額定值——轉動緩慢且無力`,
  ),

  // ---- L298N
  tpl(
    '«id»: logic supply +5V is «v#» V — fit the 5V-EN jumper (VS 7–12 V) or feed 5 V to the +5V terminal; the bridges stay off',
    (g) => `${g.id}：邏輯電源 +5V 只有 ${g.v} V——請插上 5V-EN 跳線帽（VS 7–12 V），或由 +5V 端子供應 5 V；H 橋維持關閉`,
  ),
  tpl(
    "«id»: VS = «v#» V with the 5V-EN jumper fitted — the module's 78M05 is meant for VS ≤ 12 V: remove the jumper and feed +5V externally",
    (g) => `${g.id}：插著 5V-EN 跳線帽時 VS = ${g.v} V——模組上的 78M05 只適用 VS ≤ 12 V：請拔掉跳線帽，改由外部供應 +5V`,
  ),
  tpl("«id»: VS = «v#» V exceeds the L298's 46 V maximum", (g) => `${g.id}：VS = ${g.v} V 超過 L298 的最大值 46 V`),
  tpl(
    "«id»: channel «ch=A|B» carries «i#» A — above the L298's 2 A continuous rating (the L298 has no over-current protection)",
    (g) => `${g.id}：通道 ${AB_ZH[g.ch]} 電流 ${g.i} A——超過 L298 的 2 A 連續額定值（L298 沒有過電流保護）`,
  ),
  tpl(
    '«id»: «pin» is driven while its jumper ties it to +5V — remove the «pin2» jumper to control the speed with PWM',
    (g) => `${g.id}：${g.pin} 已被跳線帽接到 +5V，卻仍有訊號在驅動它——要用 PWM 控制速度，請拔掉 ${g.pin2} 跳線帽`,
  ),

  // ---- TB6612FNG
  tpl("«id»: VM = «v#» V exceeds the TB6612FNG's 15 V maximum", (g) => `${g.id}：VM = ${g.v} V 超過 TB6612FNG 的最大值 15 V`),
  tpl("«id»: VCC = «v#» V exceeds the TB6612FNG's 6 V maximum", (g) => `${g.id}：VCC = ${g.v} V 超過 TB6612FNG 的最大值 6 V`),
  tpl(
    '«id»: VM is powered but VCC is not — connect VCC to the 3.3 V or 5 V logic supply',
    (g) => `${g.id}：VM 已供電但 VCC 沒有——請將 VCC 接到 3.3 V 或 5 V 邏輯電源`,
  ),
  tpl(
    "«id»: channel «ch=A|B» carries «i#» A — above the TB6612FNG's 3.2 A peak rating (1.2 A continuous)",
    (g) => `${g.id}：通道 ${AB_ZH[g.ch]} 電流 ${g.i} A——超過 TB6612FNG 的 3.2 A 峰值額定值（連續 1.2 A）`,
  ),

  // ---- DRV8833
  tpl(
    '«id»: over-current on bridge «ch=A|B» («i#» A > 3.3 A) — outputs disabled, nFAULT low, retry after 1.35 ms',
    (g) => `${g.id}：H 橋 ${AB_ZH[g.ch]} 過電流（${g.i} A > 3.3 A）——輸出關閉、nFAULT 拉低，1.35 ms 後重試`,
  ),
  tpl("«id»: VM = «v#» V exceeds the DRV8833's 11.8 V absolute maximum", (g) => `${g.id}：VM = ${g.v} V 超過 DRV8833 的絕對最大值 11.8 V`),

  // ---- StepStick drivers (A4988 / DRV8825 / TMC2209)
  tpl("«id»: motor supply «v#» V exceeds the «chip»'s «max#» V maximum", (g) => `${g.id}：馬達電源 ${g.v} V 超過 ${g.chip} 的最大值 ${g.max} V`),
  tpl(
    "«id»: motor supply «v#» V is below the «chip»'s operating minimum — outputs disabled",
    (g) => `${g.id}：馬達電源 ${g.v} V 低於 ${g.chip} 的最低工作電壓——輸出關閉`,
  ),
  tpl(
    "«id»: STEP sits at «v#» V — between the A4988's input thresholds (0.3·VDD … 0.7·VDD with VDD = «vdd#» V); power VDD from the MCU's 3.3 V",
    (g) => `${g.id}：STEP 停在 ${g.v} V——介於 A4988 的輸入臨界值之間（0.3·VDD … 0.7·VDD，VDD = ${g.vdd} V）；請改由微控制器（MCU）的 3.3 V 供應 VDD`,
  ),
  tpl(
    '«id»: activity on PDN_UART — the TMC2209 UART register interface is not simulated (standalone STEP/DIR mode only)',
    (g) => `${g.id}：PDN_UART 上有訊號活動——未模擬 TMC2209 的 UART 暫存器介面（僅支援獨立 STEP/DIR 模式）`,
  ),
  tpl(
    '«id»: STEP low time «t#» µs is shorter than the «chip» minimum «min#» µs',
    (g) => `${g.id}：STEP 低電位時間 ${g.t} µs 短於 ${g.chip} 的最小值 ${g.min} µs`,
  ),
  tpl(
    '«id»: STEP high pulse «t#» µs is shorter than the «chip» minimum «min#» µs',
    (g) => `${g.id}：STEP 高電位脈波 ${g.t} µs 短於 ${g.chip} 的最小值 ${g.min} µs`,
  ),
  tpl(
    '«id»: DIR changed «t#» ns before a STEP edge — the «chip» needs «min#» ns setup time',
    (g) => `${g.id}：DIR 在 STEP 邊緣前 ${g.t} ns 才改變——${g.chip} 需要 ${g.min} ns 的建立時間`,
  ),
  tpl(
    '«id»: STEP pulse «t#» ms too early after SLEEP went high — the «chip» ignores steps until it is awake',
    (g) => `${g.id}：SLEEP 拉高後 STEP 脈波早了 ${g.t} ms——${g.chip} 喚醒前會忽略步進`,
  ),
  tpl(
    '«id»: MS1/MS2/MS3 = «ms» is not a valid «chip» step mode — treated as full step',
    (g) => `${g.id}：MS1/MS2/MS3 = ${g.ms} 不是有效的 ${g.chip} 步進模式——以全步進處理`,
  ),
]
