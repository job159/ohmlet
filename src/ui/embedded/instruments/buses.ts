/**
 * Serial buses of the STM32F103 the logic analyzer can set up in one step
 * (UX IS-7 「＋匯流排…」): channels for every signal of the bus plus the
 * matching protocol decoder, with the line settings the firmware programmed
 * when the lab knows them (USART: McuFrameInfo.uarts from USART_BRR / CR1 /
 * CR2). Pin assignments: DS5319 Table 5 (default and remapped alternate
 * functions). Pure — the action lives in probe-actions.ts (addBusFor).
 */
import type { UartLineConfig } from '../../../mcu/mcu-api'
import { STANDARD_BAUDS } from '../../../instruments/decoders'

export type BusKind = 'uart' | 'i2c' | 'spi'

export interface BusSignal {
  /** decoder role ('data' for UART TX / RX — one decoder per direction) */
  role: string
  /** MCU port pin */
  pin: string
  /** channel label suffix: 'TX', 'SCL', 'MOSI' … */
  name: string
}

export interface BusDef {
  /** peripheral name, 'USART1', 'I2C1', 'SPI1' */
  id: string
  kind: BusKind
  /** remapped pin set (AFIO_MAPR) */
  remap?: boolean
  signals: BusSignal[]
}

export const F103_BUSES: readonly BusDef[] = [
  { id: 'USART1', kind: 'uart', signals: [{ role: 'data', pin: 'PA9', name: 'TX' }, { role: 'data', pin: 'PA10', name: 'RX' }] },
  { id: 'USART1', kind: 'uart', remap: true, signals: [{ role: 'data', pin: 'PB6', name: 'TX' }, { role: 'data', pin: 'PB7', name: 'RX' }] },
  { id: 'USART2', kind: 'uart', signals: [{ role: 'data', pin: 'PA2', name: 'TX' }, { role: 'data', pin: 'PA3', name: 'RX' }] },
  { id: 'USART3', kind: 'uart', signals: [{ role: 'data', pin: 'PB10', name: 'TX' }, { role: 'data', pin: 'PB11', name: 'RX' }] },
  { id: 'I2C1', kind: 'i2c', signals: [{ role: 'scl', pin: 'PB6', name: 'SCL' }, { role: 'sda', pin: 'PB7', name: 'SDA' }] },
  { id: 'I2C1', kind: 'i2c', remap: true, signals: [{ role: 'scl', pin: 'PB8', name: 'SCL' }, { role: 'sda', pin: 'PB9', name: 'SDA' }] },
  { id: 'I2C2', kind: 'i2c', signals: [{ role: 'scl', pin: 'PB10', name: 'SCL' }, { role: 'sda', pin: 'PB11', name: 'SDA' }] },
  {
    id: 'SPI1',
    kind: 'spi',
    signals: [
      { role: 'sck', pin: 'PA5', name: 'SCK' },
      { role: 'miso', pin: 'PA6', name: 'MISO' },
      { role: 'mosi', pin: 'PA7', name: 'MOSI' },
    ],
  },
  {
    id: 'SPI1',
    kind: 'spi',
    remap: true,
    signals: [
      { role: 'sck', pin: 'PB3', name: 'SCK' },
      { role: 'miso', pin: 'PB4', name: 'MISO' },
      { role: 'mosi', pin: 'PB5', name: 'MOSI' },
    ],
  },
  {
    id: 'SPI2',
    kind: 'spi',
    signals: [
      { role: 'sck', pin: 'PB13', name: 'SCK' },
      { role: 'miso', pin: 'PB14', name: 'MISO' },
      { role: 'mosi', pin: 'PB15', name: 'MOSI' },
    ],
  },
]

/** Stable key of a bus definition ('USART1', 'I2C1-remap'). */
export function busKey(b: BusDef): string {
  return b.remap ? `${b.id}-remap` : b.id
}

export function busByKey(key: string): BusDef | undefined {
  return F103_BUSES.find((b) => busKey(b) === key)
}

/**
 * How strongly the board uses a bus right now: 2 = the firmware put its
 * pins in an alternate-function mode (af / af-od) or enabled the USART,
 * 1 = its pins are wired to something, 0 = no sign of use.
 */
export function busUse(
  b: BusDef,
  pinModes: Readonly<Record<string, string>> | undefined,
  wired: (pin: string) => boolean,
  uarts?: readonly { name: string; config: UartLineConfig }[],
): 0 | 1 | 2 {
  const first = b.signals[0].pin
  const af = (p: string) => pinModes?.[p] === 'af' || pinModes?.[p] === 'af-od'
  if (b.kind === 'uart') {
    const en = uarts?.find((u) => u.name === b.id)?.config.enabled
    // the USART is on and its TX pin carries the alternate function (TX of the
    // remap or of the default pin set — whichever the firmware chose)
    if (en && af(first)) return 2
    if (en && !b.remap && !pinModes) return 2
  } else if (b.signals.some((s) => af(s.pin)) && af(first)) {
    return 2
  }
  return b.signals.every((s) => wired(s.pin)) ? 1 : 0
}

/** A programmed baud rate as the decoder's option: the standard rate within 1 %, else the exact one. */
function baudOption(baud: number): string {
  for (const b of STANDARD_BAUDS) if (Math.abs(baud - b) <= b * 0.01) return String(b)
  return String(Math.round(baud))
}

/** UART decoder options from the firmware's line config ({} = auto baud). */
export function uartDecoderOptions(c: UartLineConfig | undefined): Record<string, string> {
  if (!c || !c.enabled || !(c.baud > 0)) return {}
  // with parity the MSB of the M-bit word is the parity bit (RM0008 USART_CR1 M/PCE)
  const data = c.dataBits - (c.parity !== 'none' ? 1 : 0)
  return {
    baud: baudOption(c.baud),
    dataBits: String(data),
    parity: c.parity,
    stopBits: String(c.stopBits),
  }
}

/** "115200 8N1" (null when unknown). */
export function uartFormat(c: UartLineConfig | undefined): string | null {
  const o = uartDecoderOptions(c)
  if (!o.baud) return null
  return `${o.baud} ${o.dataBits}${o.parity === 'even' ? 'E' : o.parity === 'odd' ? 'O' : 'N'}${o.stopBits}`
}
