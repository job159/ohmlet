/**
 * zh-TW display translations of the support notes the fidelity wave
 * re-checked against the peripheral code (src/mcu/stm32f1/peripherals.ts):
 * USART2 / USART3 are now driven by real HAL firmware with the
 * communication modules, and DBGMCU's freeze bits reach TIM1–TIM4. English
 * stays the source text; see src/i18n/messages.ts.
 */
import type { MessagePattern } from '../messages'
import { polishNotes, tpl, tr, translates } from './messages-core'

export const MESSAGES_ZH: MessagePattern[] = [
  tpl(
    '«b» Same model as USART1; real HAL firmware runs on USART2 too (hal-ch340, hal-hc05, hal-esp01: echo and AT dialogues with the module in both directions; hal-rs485: its report output).',
    (g) =>
      `${tr(g.b)}與 USART1 使用相同模型；真實 HAL 韌體也在 USART2 上執行（hal-ch340、hal-hc05、hal-esp01：與模組雙向的回音與 AT 指令對話；hal-rs485：它的報告輸出）。`,
    (g) => translates(g.b),
  ),
  tpl(
    '«b» Same model as USART1; real HAL firmware runs on USART3 too (hal-rs485: the RS-485 ping-pong with USART1, both directions).',
    (g) => `${tr(g.b)}與 USART1 使用相同模型；真實 HAL 韌體也在 USART3 上執行（hal-rs485：與 USART1 雙向的 RS-485 乒乓往返）。`,
    (g) => translates(g.b),
  ),
]

export const NOTES_ZH: Record<string, string> = polishNotes({
  'IDCODE 0x20036410 (readable as if a debugger were attached — silicon reads 0 otherwise, errata ES096), CR freeze bits applied to IWDG, WWDG and TIM1–TIM4 while the core is halted (a frozen TIM1 also disables its outputs); the I2C SMBus-timeout and CAN bits have no effect (SMBus and bxCAN are not simulated). Trace output not simulated.':
    'IDCODE 0x20036410（如同接上除錯器般可讀取——否則實際晶片讀到 0，見勘誤表 ES096）、核心停止時對 IWDG、WWDG 與 TIM1–TIM4 套用 CR 凍結位元（凍結的 TIM1 也會關閉輸出）；I2C 的 SMBus 逾時與 CAN 凍結位元沒有作用（未模擬 SMBus 與 bxCAN）。未模擬追蹤輸出。',
})
