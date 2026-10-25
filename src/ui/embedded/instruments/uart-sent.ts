/**
 * The UART terminal's sends, as they really travel (release close-out
 * UART-RX). The terminal is a virtual USB-TTL adapter whose TXD is jumpered
 * to the MCU's RX pin: typed bytes go out as real UART frames on that wire
 * (src/sim/coordinator/uart-adapter.ts), so the logic analyzer's RX lane
 * and its UART decoder show them like any other signal — the earlier
 * annotation layer (a hatched "sent straight into the USART" note on the RX
 * lane, a 「直接送入」 row in 解碼結果, the 「終端機送出的資料直接寫進
 * USART1」 trace note and send-box hint) is retired: it is no longer true.
 *
 * What stays here:
 *   - `rxWireNote` — the one sentence under the terminal's send box, from
 *     the coordinator's McuFrameInfo.uartRx: the bytes go out on PA10 as
 *     frames at the firmware's line settings; or, when the circuit already
 *     drives that net (a CH340's TXD, the board's own PA2, a supply rail …),
 *     「PA10 已由 CH1 的 TXD 驅動，終端機不另外送出」 with the module's own
 *     port offered; or why it cannot send (no baud yet, pin not on the
 *     board). The same facts the coordinator logs — the surfaces agree;
 *   - `USART_RX` — the reset mapping of each USART's RX pin (a remapped
 *     pin comes with McuFrameInfo.uartRx, which reports AFIO_MAPR);
 *   - the record of what the terminal sent and when (`recordUartSend` /
 *     `useUartSends` / `sendDuration`): still true, never drawn — the frames
 *     themselves are on the RX wire, and 「在邏輯分析儀中檢視」 on a sent line
 *     finds them there (uart-reveal.ts revealUartLine with `echo`, on the RX
 *     pin `rxPinOf` returns); the instruments-clarity replay reads the record
 *     for the instant of its send.
 * Module-level (never React state); a simulation reset — time going back —
 * forgets the sends, like every recording.
 */
import { create } from 'zustand'
import { useStore } from '../../../state/store'
import type { UartRxInfo } from '../../../sim/coordinator/api'
import { getEntry } from '../../../model/catalog'
import { pinLabel } from '../../../i18n/parts'
import { t } from '../../../i18n'

/** USART → RX port pin (the reset mapping, DS5319 Table 5; a remapped pin is McuFrameInfo.uartRx[].pin). */
export const USART_RX: Readonly<Record<string, string>> = {
  USART1: 'PA10',
  USART2: 'PA3',
  USART3: 'PB11',
}

/** The RX pin of `port` on a board: the coordinator's (remap-aware) report, else the reset mapping. */
export function rxPinOf(port: string, uartRx: readonly UartRxInfo[] | undefined): string | undefined {
  return uartRx?.find((u) => u.port === port)?.pin ?? USART_RX[port]
}

// ---------------------------------------------------------------- the note

/** What the terminal says under its send box for an MCU port (rxWireNote). */
export interface RxWireNote {
  /** which case it is ('no-baud': the firmware has not programmed the USART yet) */
  kind: 'free' | 'sending' | 'driven' | 'rail' | 'output' | 'absent' | 'no-baud'
  text: string
  /** the terminal may send on this port now */
  canSend: boolean
  /** 'info' = how the bytes travel; 'warn' = the terminal will not send */
  tone: 'info' | 'warn'
  /** a module's own port to use instead (the driver's 'COM' / 'BT') */
  offer?: { componentId: string; port: string; label: string }
}

/** Minimal component lookup (a CircuitLayout's components fit). */
type Parts = readonly { id: string; type: string }[]

/** 「CH1 的 TXD」, 「U1 的 PA2」, 「BT1 的 TXD（經 LS1）」 — the output that drives the net. */
function driverText(by: NonNullable<UartRxInfo['by']>, parts: Parts): string {
  const type = parts.find((c) => c.id === by.componentId)?.type
  const entry = type ? getEntry(type) : undefined
  const name = entry ? pinLabel(entry, by.pin, { form: 'short' }) : by.pin
  const s = by.via
    ? t('{id}’s {pin} (through {via})', { id: by.componentId, pin: name, via: by.via })
    : t('{id}’s {pin}', { id: by.componentId, pin: name })
  // 「PS1 的 正端」 → 「PS1 的正端」: a space only between CJK and Latin text
  return s.replace(/的 (\p{Script=Han})/u, '的$1')
}

/**
 * The sentence under the terminal's send box for MCU port `port` of
 * `componentId` (null: nothing known yet — no frame from a running world).
 * `info` is the port's McuFrameInfo.uartRx entry, `line` the firmware's
 * line settings as the terminal shows them (「115 200 Bd · 8N1」; null when
 * the firmware has not programmed a baud).
 */
export function rxWireNote(
  componentId: string,
  port: string,
  info: UartRxInfo | undefined,
  line: string | null,
  parts: Parts,
): RxWireNote | null {
  if (!info) return null
  const pin = info.pin
  switch (info.state) {
    case 'driven': {
      const by = info.by
      const text = (
        by
          ? t('{pin} is driven by {driver} — the terminal does not send on it', { pin, driver: driverText(by, parts) })
          : t('{pin} is driven by another output — the terminal does not send on it', { pin })
      ).replace(/([\p{Script=Han}）]) (?=\p{Script=Han})/gu, '$1') // 「（經 LS1） 驅動」, 「的正端 驅動」: no space between CJK text
      const offer = by?.port
        ? { componentId: by.componentId, port: by.port, label: t('Use {id}’s {port} port', { id: by.componentId, port: by.port }) }
        : undefined
      return offer ? { kind: 'driven', text, canSend: false, tone: 'warn', offer } : { kind: 'driven', text, canSend: false, tone: 'warn' }
    }
    case 'rail':
      return { kind: 'rail', text: t('{pin} is wired straight to a supply rail or GND — the terminal does not send on it', { pin }), canSend: false, tone: 'warn' }
    case 'output':
      return {
        kind: 'output',
        text: t('{pin} is an output of {id} right now (the firmware does not use it as the {port} RX) — the terminal does not send on it', { pin, id: componentId, port }),
        canSend: false,
        tone: 'warn',
      }
    case 'absent': {
      // a pin of the board that sits in no hole, or a remap onto a pin the package lacks
      const type = parts.find((c) => c.id === componentId)?.type
      const onBoard = !!(type && getEntry(type)?.pins.includes(pin))
      const text = onBoard
        ? t('{pin} is not connected to anything — the terminal cannot send', { pin })
        : t('{port} RX is on {pin}, which this board does not bring out — the terminal cannot send', { port, pin })
      return { kind: 'absent', text, canSend: false, tone: 'warn' }
    }
    default:
      if (line === null) {
        return {
          kind: 'no-baud',
          text: t('{id} has not set the {port} baud rate yet — the terminal does not know how fast to send', { id: componentId, port }),
          canSend: false,
          tone: 'warn',
        }
      }
      if (info.queued > 0) {
        return { kind: 'sending', text: t('Sending on {pin}… {n} bytes to go ({line})', { pin, n: info.queued, line }), canSend: true, tone: 'info' }
      }
      return {
        kind: 'free',
        text: t('Typed text goes out on {pin} as UART frames ({line}) through the terminal’s USB-TTL adapter (3.3 V)', { pin, line }),
        canSend: true,
        tone: 'info',
      }
  }
}

// ------------------------------------------------------- the record of sends

/** One send from the terminal. */
export interface UartSend {
  /** increasing id */
  id: number
  componentId: string
  /** 'USART1' … */
  port: string
  /** simulation time of the send (s) */
  t: number
  /** the bytes as sent (the line ending included) */
  bytes: number[]
  /** one character on the wire at the firmware's line settings (s; undefined = unknown) */
  frameTime?: number
}

/** Sends kept (oldest dropped). */
const MAX_SENDS = 200

interface UartSendsState {
  sends: readonly UartSend[]
}

export const useUartSends = create<UartSendsState>()(() => ({ sends: [] }))

let nextId = 1

/** Note one terminal send. */
export function recordUartSend(send: Omit<UartSend, 'id'>): void {
  if (send.bytes.length === 0 || !Number.isFinite(send.t)) return
  const sends = [...useUartSends.getState().sends, { ...send, id: nextId++ }]
  useUartSends.setState({ sends: sends.length > MAX_SENDS ? sends.slice(sends.length - MAX_SENDS) : sends })
}

/** The time the bytes take on the wire at the line settings (s). */
export function sendDuration(s: Pick<UartSend, 'bytes' | 'frameTime'>): number {
  const ft = s.frameTime !== undefined && s.frameTime > 0 ? s.frameTime : 10 / 115200
  return ft * s.bytes.length
}

let watching = false
/** Forget the sends when the simulation clock goes back (a reset, a new circuit). */
function watch(): void {
  if (watching) return
  watching = true
  useStore.subscribe((s, p) => {
    if (s.simTime < p.simTime && useUartSends.getState().sends.length > 0) useUartSends.setState({ sends: [] })
  })
}
watch()

/** TEST-ONLY */
export function __resetUartSendsForTests(): void {
  useUartSends.setState({ sends: [] })
  nextId = 1
}
