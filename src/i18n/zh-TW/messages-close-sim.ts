/**
 * zh-TW runtime messages of the UART terminal's USB-TTL adapter (release
 * close-out UART-RX: src/sim/coordinator/uart-adapter.ts and the TTL
 * adapter block of coordinator.ts) — a send the adapter refused because the
 * RX net is not free, an adapter that let go of its pin when another output
 * started to drive it, a full buffer. The reason fragment (one of the
 * coordinator's ttlWhy texts) is translated by whyZh. Ids, pin and port
 * names stay verbatim; full-width punctuation.
 */
import type { MessagePattern } from '../messages'
import { tpl } from './messages-core'

/** The reason fragment ("PA10 is driven by CH1 TXD") in Chinese; unchanged when unknown. */
function whyZh(why: string): string {
  let m = /^(\S+) is driven by (\S+) (\S+) through (\S+)$/.exec(why)
  if (m) return `${m[1]} 已由 ${m[2]} 的 ${m[3]}（經 ${m[4]}）驅動`
  m = /^(\S+) is driven by another output$/.exec(why)
  if (m) return `${m[1]} 已由其他輸出驅動`
  m = /^(\S+) is driven by (\S+) (\S+)$/.exec(why)
  if (m) return `${m[1]} 已由 ${m[2]} 的 ${m[3]} 驅動`
  m = /^(\S+) is wired to a supply rail or ground$/.exec(why)
  if (m) return `${m[1]} 直接接在電源或 GND 上`
  m = /^(\S+) is an output of (\S+) right now, not the (\S+) RX$/.exec(why)
  if (m) return `${m[1]} 目前是 ${m[2]} 的輸出腳，不是 ${m[3]} 的 RX`
  m = /^(\S+) is not connected to anything$/.exec(why)
  if (m) return `${m[1]} 沒有接到任何地方`
  m = /^its RX pin (\S+) is not on the board's headers$/.exec(why)
  if (m) return `它的 RX 腳 ${m[1]} 不在板子的排針上`
  m = /^the firmware has not set the (\S+) baud rate \(BRR\) yet$/.exec(why)
  if (m) return `韌體還沒有設定 ${m[1]} 的鮑率（BRR）`
  m = /^(\S+) is busy$/.exec(why)
  if (m) return `${m[1]} 正在使用中`
  return why
}

export const MESSAGES_ZH: MessagePattern[] = [
  tpl(
    '«id!» «port!»: the terminal did not send «n#» byte(s) — «why*»',
    (g) => `${g.id} ${g.port}：終端機沒有送出這 ${g.n} 個位元組——${whyZh(g.why)}`,
  ),
  tpl(
    "«id!» «port!»: the terminal's USB-TTL adapter let go of «pin!» — «why*»",
    (g) => `${g.id} ${g.port}：終端機的 USB 轉 TTL 轉接器已放開 ${g.pin}——${whyZh(g.why)}`,
  ),
  tpl(
    "«id!» «port!»: the terminal's adapter buffer is full — «n#» byte(s) dropped",
    (g) => `${g.id} ${g.port}：終端機轉接器的緩衝區已滿，${g.n} 個位元組已丟棄`,
  ),
]
