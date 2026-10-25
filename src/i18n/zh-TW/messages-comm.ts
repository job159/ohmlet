/**
 * zh-TW runtime messages of the communication & memory modules
 * (src/sim/models/comm.model.ts + comm-flash.ts / comm-sd.ts): CH340 COM
 * port, HC-05 modes and phone link, MAX485 bus diagnostics, W25Q32
 * protection / unsupported instructions, SD-card power-up clocks, ESP-01
 * boot mode and the missing Wi-Fi, TJA1050 dominant time-out and TX level.
 *
 * Logs carry the module name ("HC-05: …", "W25Q32: …") and are matched
 * whole. Issues arrive as "<id>: <body>" and are composed by the generic
 * «id»: «message» wrapper of messages-core, which translates the body with
 * the patterns below. Ids, pin names, part numbers, numbers and units stay
 * verbatim; Chinese sentences use full-width punctuation.
 */
import type { MessagePattern } from '../messages'
import { tpl } from './messages-core'

export const MESSAGES_ZH: MessagePattern[] = [
  // ---- CH340 USB-to-TTL adapter
  tpl(
    'CH340: «n» byte(s) from the COM port dropped — the module is unpowered',
    (g) => `CH340：COM 埠送出的 ${g.n} 個位元組已丟棄——模組沒有供電`,
  ),

  // ---- HC-05 Bluetooth module
  tpl('HC-05: AT command mode (EN high at power-up), «b» 8N1', (g) => `HC-05：AT 指令模式（通電時 EN 為高準位），${g.b} 8N1`),
  tpl(
    'HC-05: data mode, «b» baud, «p=phone connected|waiting for a phone»',
    (g) => `HC-05：資料模式，鮑率 ${g.b}，${g.p === 'phone connected' ? '手機已連線' : '等待手機連線'}`,
  ),
  tpl('HC-05: phone connected', () => 'HC-05：手機已連線'),
  tpl('HC-05: phone disconnected', () => 'HC-05：手機已中斷連線'),
  tpl('HC-05: AT+RESET — restarting', () => 'HC-05：AT+RESET——重新啟動'),
  tpl(
    'HC-05: no phone link (the module is not in data mode or the phone is disconnected) — bytes from the phone dropped',
    () => 'HC-05：沒有手機連線（模組不在資料模式，或手機已中斷連線）——手機送來的位元組已丟棄',
  ),

  // ---- MAX485 RS-485 transceiver (issues: "<id>: …")
  tpl(
    'RS-485 bus contention: another driver holds A/B against this one (VA − VB = «v» V while DI = «di») — only one node may enable its driver (DE) at a time',
    (g) => `RS-485 匯流排衝突：另一個驅動器把 A/B 拉向相反方向（DI = ${g.di} 時 VA − VB = ${g.v} V）——同一時間只能有一個節點致能驅動器（DE）`,
  ),
  tpl(
    'RS-485 bus is not terminated (A–B load ≈ «r»): fit 120 Ω at both ends of the cable — reflections are not simulated, so short breadboard wiring still works',
    (g) => `RS-485 匯流排沒有終端電阻（A–B 負載 ≈ ${g.r}）：請在纜線兩端各接 120 Ω——未模擬訊號反射，所以麵包板上的短導線仍可運作`,
  ),
  tpl(
    'RS-485 bus is terminated at one end only (A–B load ≈ «r» Ω): fit 120 Ω at the other end too',
    (g) => `RS-485 匯流排只有一端接終端電阻（A–B 負載 ≈ ${g.r} Ω）：另一端也請接 120 Ω`,
  ),
  tpl(
    'RS-485 bus is over-terminated (A–B load ≈ «r» Ω, more than two 120 Ω resistors): remove the termination from the nodes between the two ends',
    (g) => `RS-485 匯流排終端電阻過多（A–B 負載 ≈ ${g.r} Ω，超過兩個 120 Ω 電阻）：請拆掉兩端之間各節點的終端電阻`,
  ),

  // ---- W25Q32 SPI NOR flash
  tpl(
    'power lost while the flash was busy (program / erase): that operation is incomplete',
    () => '快閃記憶體忙碌（燒錄／抹除）時斷電：該操作未完成',
  ),
  tpl('W25Q32: instruction 0x«h» is not modeled — ignored', (g) => `W25Q32：指令 0x${g.h} 未模擬——已忽略`),
  tpl(
    'W25Q32: chip erase ignored — part of the array is block-protected',
    () => 'W25Q32：已忽略整片抹除——部分記憶體陣列受區塊保護',
  ),
  tpl(
    'W25Q32: erase at 0x«a» ignored — block-protected (BP bits)',
    (g) => `W25Q32：已忽略位址 0x${g.a} 的抹除——該區塊受保護（BP 位元）`,
  ),
  tpl(
    'W25Q32: page program at 0x«a» ignored — block-protected (BP bits)',
    (g) => `W25Q32：已忽略位址 0x${g.a} 的頁燒錄——該區塊受保護（BP 位元）`,
  ),
  tpl(
    'W25Q32: status register write ignored — SRP = 1 and /WP is low (hardware protected)',
    () => 'W25Q32：已忽略寫入狀態暫存器——SRP = 1 且 /WP 為低準位（硬體保護）',
  ),

  // ---- micro-SD card (issue: "<id>: SD card: …")
  tpl(
    'SD card: CMD0 after only «n» clock cycles — send at least 74 clocks with CS high after power-up (SD spec §6.4.1.1); the card does not answer',
    (g) => `SD 卡：通電後只送了 ${g.n} 個時脈就送出 CMD0——通電後必須在 CS 為高準位時送出至少 74 個時脈（SD 規格 §6.4.1.1）；記憶卡不會回應`,
  ),

  // ---- ESP-01
  tpl(
    'ESP-01: GPIO0 low at reset — UART download mode (the AT firmware does not start)',
    () => 'ESP-01：重置時 GPIO0 為低準位——進入 UART 下載模式（AT 韌體不會啟動）',
  ),
  tpl(
    'ESP-01: Wi-Fi is not simulated — network AT commands answer ERROR',
    () => 'ESP-01：未模擬 Wi-Fi——網路相關 AT 指令一律回應 ERROR',
  ),

  // ---- TJA1050 CAN transceiver (issues: "<id>: …")
  tpl(
    'CAN transceiver TXD held dominant longer than «t» µs: the TJA1050 time-out disabled its driver until TXD goes high (TXD stuck low?)',
    (g) => `CAN 收發器的 TXD 保持顯性超過 ${g.t} µs：TJA1050 逾時保護已關閉驅動器，直到 TXD 回到高準位（TXD 卡在低準位？）`,
  ),
  tpl(
    'TX high level «v» V is below the TJA1050 minimum VIH of 0.7·VCC = «min» V: outside the datasheet guarantee (it switches here, as on most benches)',
    (g) => `TX 高準位 ${g.v} V 低於 TJA1050 的最小 VIH（0.7·VCC = ${g.min} V）：超出規格書保證範圍（這裡仍會切換，與多數實驗桌上的情況相同）`,
  ),
]
