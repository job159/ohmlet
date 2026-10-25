/**
 * 「在邏輯分析儀中檢視」 for a UART terminal line (UX IS-8): find the line's
 * bytes on the USART's TX wire and centre the logic analyzer on that burst
 * with marker A on its first start bit.
 *
 * The terminal only knows the frame window the bytes arrived in (the lab
 * stamps chunks with the frame's simulation-time window); the exact instant
 * comes from the wire: the logic recorder's edges of the TX pin, decoded
 * with the line settings the firmware programmed, searched for the line's
 * byte sequence. When the TX pin is not on the analyzer the past cannot be
 * shown (the recorder keeps edges of configured channels only) — the pin is
 * added and the toast says lines from now on can be shown.
 *
 * A line the terminal SENT (its local echo, release polish): the terminal's
 * USB-TTL adapter put it on the USART's RX pin as real frames (close-out
 * UART-RX), so the same search runs on that wire — the RX pin of the
 * coordinator's McuFrameInfo.uartRx (AFIO-remap aware: PB7 for a remapped
 * USART1), from the send on. The TX pin follows the same remap.
 */
import type { UartLineConfig } from '../../../mcu/mcu-api'
import type { UartRxInfo } from '../../../sim/coordinator/api'
import { decodeUart } from '../../../instruments/decoders'
import { spanAtLeast } from '../../../instruments/autofit'
import { getEntry } from '../../../model/catalog'
import { useStore } from '../../../state/store'
import { showToast } from '../../kit'
import { t } from '../../../i18n'
import { useLab } from '../lab'
import { ensureLogicChannel, findLogicChannel, revealInLogic } from '../probe-actions'
import { newDecoderConfig, sanitizeDecoderConfigs } from './la-config'
import { uartDecoderOptions } from './buses'
import { USART_RX, rxPinOf } from './uart-sent'

/**
 * A UART decoder on logic channel `index` with the line settings the firmware
 * programmed (UX IS-15: the revealed line reads as text, not just edges).
 * Nothing when one already reads that channel.
 */
export function ensureUartDecoder(index: number, config: UartLineConfig | undefined): void {
  const lab = useLab.getState()
  const decoders = sanitizeDecoderConfigs(lab.logicView.decoders)
  if (decoders.some((d) => d.decoder === 'uart' && d.channels.data === index)) return
  const base = newDecoderConfig('uart', lab.logicChannels, decoders)
  if (!base) return
  const cfg = { ...base, channels: { data: index }, options: uartDecoderOptions(config) }
  lab.setLogicView({ decoders: [...decoders, cfg] as unknown as Record<string, unknown>[] })
}

/** USART → TX port pin (default and AFIO-remapped), DS5319 Table 5. */
export const USART_TX: Record<string, { pin: string; remap?: string }> = {
  USART1: { pin: 'PA9', remap: 'PB6' },
  USART2: { pin: 'PA2' },
  USART3: { pin: 'PB10' },
}

/** A remapped RX pin → its TX partner (RM0008 §9.3.8: USART1 PB7/PB6, USART2 PD6/PD5, USART3 PC11/PC10 partial, PD9/PD8 full). */
const REMAPPED_TX: Readonly<Record<string, string>> = { PB7: 'PB6', PD6: 'PD5', PC11: 'PC10', PD9: 'PD8' }

/**
 * The wire a terminal line travels on (release polish): a received line on
 * the USART's TX pin, a sent (locally echoed) line on its RX pin — the pin
 * the coordinator reports in McuFrameInfo.uartRx (AFIO-remap aware), else
 * the reset mapping; a remapped RX moves the TX pin with it (PB7 → PB6).
 * null: not a USART of the board.
 */
export function lineWire(port: string, sent: boolean, uartRx?: readonly UartRxInfo[]): { pin: string; dir: 'TX' | 'RX' } | null {
  const tx = USART_TX[port]
  if (!tx || !USART_RX[port]) return null
  const rx = rxPinOf(port, uartRx) ?? USART_RX[port]
  if (sent) return { pin: rx, dir: 'RX' }
  return { pin: rx !== USART_RX[port] ? REMAPPED_TX[rx] ?? tx.pin : tx.pin, dir: 'TX' }
}

/** The tooltip of a line's 「在邏輯分析儀中檢視」: the wire it is searched on. */
export function revealLineTitle(sent: boolean, pin?: string): string {
  return sent
    ? t('Centre the logic analyzer on the frames this line went out as on {pin} (RX), marker A on the first start bit', { pin: pin ?? 'RX' })
    : t('Centre the logic analyzer on this line’s bytes on the TX wire, marker A on the first start bit')
}

/** One character on the wire at the firmware's line settings (s): start + data (+ parity) + stop bits. */
export function charTime(config: UartLineConfig | undefined): number {
  if (!config || !(config.baud > 0)) return 10 / 9600
  return (1 + config.dataBits + (config.stopBits > 0 ? config.stopBits : 1)) / config.baud
}

/**
 * The search window of a SENT line's frames (release polish): they start at
 * the send (store time, never ahead of the coordinator) after one character
 * of idle line, behind anything still queued; at most 10 s are searched, and
 * never past what was simulated. `ready` = the simulation ran long enough for
 * the whole line (and its line ending) to be on the wire.
 */
export function sentLineWindow(at: number, bytes: number, now: number, config: UartLineConfig | undefined): { from: number; to: number; ready: boolean } {
  const from = Math.max(0, at - 0.002)
  const to = Math.max(from, Math.min(now, at + 10))
  // idle character + the line + a CR LF
  const ready = now >= at + charTime(config) * (bytes + 3)
  return { from, to, ready }
}

/** One decoded byte on the wire. */
export interface WireByte {
  t0: number
  t1: number
  value: number
}

/**
 * Where `bytes` (the line, in order) were sent: the first run of decoded
 * wire bytes inside [from, to] that matches the line's first bytes (up to
 * 8 — enough to tell lines apart, tolerant of a line cut by the terminal's
 * history). null when the wire does not hold them.
 */
export function findByteRun(wire: readonly WireByte[], bytes: readonly number[], from: number, to: number): { t0: number; t1: number } | null {
  const want = bytes.slice(0, Math.min(8, bytes.length))
  if (want.length === 0) return null
  for (let i = 0; i + want.length <= wire.length; i++) {
    if (wire[i].t0 < from || wire[i].t0 > to) continue
    let ok = true
    for (let k = 0; k < want.length && ok; k++) ok = wire[i + k].value === want[k]
    if (!ok) continue
    // the run continues while the wire keeps matching the line
    let k = want.length
    while (k < bytes.length && i + k < wire.length && wire[i + k].value === bytes[k]) k++
    return { t0: wire[i].t0, t1: wire[i + k - 1].t1 }
  }
  return null
}

/**
 * Show a terminal line in the logic analyzer. `t0`/`t1` = the frame window
 * its first byte arrived in (a sent line: the send instant); `bytes` = the
 * line's bytes; `echo` = the terminal sent it (its local echo) — searched on
 * the RX pin from the send on, instead of on the TX pin.
 */
export async function revealUartLine(
  line: { t0: number; t1: number; bytes: number[]; echo?: boolean },
  port: { componentId: string; port: string; config?: UartLineConfig },
): Promise<void> {
  const layout = useStore.getState().layout
  const comp = layout.components.find((c) => c.id === port.componentId)
  const mcu = comp ? getEntry(comp.type)?.mcu : undefined
  const sent = !!line.echo
  // TX for a received line, RX for a sent one — the coordinator's (remap-aware) pins (release polish)
  const wire = comp && mcu ? lineWire(port.port, sent, useLab.getState().mcus[comp.id]?.uartRx) : null
  const fallback = (why?: string) => {
    // no wire to read: show the window the line arrived in (a sent line: the send), honestly labelled
    const dur = Math.max(line.t1 - line.t0, sent ? charTime(port.config) * (line.bytes.length + 3) : 1e-3, 1e-3)
    revealInLogic(sent ? line.t0 + dur / 2 : (line.t0 + line.t1) / 2, spanAtLeast(dur * 1.5), line.t0)
    showToast(why ?? t('Showing when this line arrived (the TX pin is not readable on the analyzer)'), { duration: 3600 })
  }
  if (!comp || !wire) {
    fallback(sent ? t('Showing when this line was sent (the RX pin is not readable on the analyzer)') : undefined)
    return
  }
  const pin = wire.pin
  const ch = findLogicChannel({ kind: 'mcu-pin', componentId: comp.id, pin })
  if (!ch) {
    const e = ensureLogicChannel({ kind: 'mcu-pin', componentId: comp.id, pin }, `${pin} ${wire.dir}`)
    if (e.ok && e.index !== undefined) ensureUartDecoder(e.index, port.config)
    showToast(
      e.ok
        ? sent
          ? t('{pin} was not on the logic analyzer, so this line cannot be shown — added it: lines you send from now on can be.', { pin })
          : t('{pin} was not on the logic analyzer, so this line cannot be shown — added it: lines from now on can be.', { pin })
        : e.reason ?? t('{pin} was not on the logic analyzer', { pin }),
      { duration: 4800 },
    )
    return
  }
  const cfg = port.config
  ensureUartDecoder(ch.index, cfg)
  const baud = cfg && cfg.enabled && cfg.baud > 0 ? cfg.baud : 'auto'
  // a received line can take a while on the wire: look back far enough for it to have started;
  // a sent one goes out from the send on (behind anything still queued)
  const frameTime = (10 / (typeof baud === 'number' ? baud : 9600)) * Math.max(1, line.bytes.length)
  const win = sent ? sentLineWindow(line.t0, line.bytes.length, useStore.getState().simTime, cfg) : null
  const from = win ? win.from : Math.max(0, line.t0 - frameTime - 0.002)
  const to = win ? win.to : line.t1 + frameTime + 0.001
  const notOnWire = () =>
    win && !win.ready
      ? t('This line is not on {pin} yet — let the simulation run a moment, then try again', { pin })
      : sent
        ? t('Showing when this line was sent (its frames are not in the {pin} recording)', { pin })
        : undefined
  const cap = await useLab.getState().queryLogic(from, to)
  const tr = cap.traces.find((x) => x.index === ch.index)
  if (!tr) {
    fallback(notOnWire())
    return
  }
  const res = decodeUart(
    tr,
    {
      baud,
      dataBits: cfg ? cfg.dataBits - (cfg.parity !== 'none' ? 1 : 0) : 8,
      parity: cfg?.parity ?? 'none',
      stopBits: cfg?.stopBits && cfg.stopBits >= 1 ? cfg.stopBits : 1,
    },
    cap.t1,
  )
  const run = findByteRun(res.frames, line.bytes, from, to)
  if (!run) {
    fallback(notOnWire())
    return
  }
  const dur = run.t1 - run.t0
  revealInLogic((run.t0 + run.t1) / 2, spanAtLeast(dur * 1.25), run.t0)
}
