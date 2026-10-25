/**
 * 「韌體目前的設定」 — what the running firmware set up on an STM32F103 board,
 * from the facts every MCU frame already carries (QA clarity
 * PERIPH-LIVE-CONFIG): the blocks it switched on (McuFrameInfo.clocked), the
 * USART line settings it programmed (McuFrameInfo.uarts), AFIO_MAPR
 * (McuFrameInfo.mapr) and the pin modes (telemetry.mcu.pinModes), read the
 * way the pin rows and the logic analyzer read them (pin-function.ts
 * activePinFunction — one judgement for every view):
 *
 *   USART1  115 200 Bd · 8N1 · TX PA9／RX PA10      (bus pins: buses.ts, remap per MAPR)
 *   I2C1    SCL PB6／SDA PB7
 *   SPI1    SCK PA5／MISO PA6／MOSI PA7
 *   TIM3    CH1 → PA6 (PWM)                         (the pins carrying TIM3_CHx right now)
 *   ADC1    IN0 ← PA0                               (pins in analog mode with ADC12_INx)
 *
 * One row per pin-using block the firmware switched on, in that order; the
 * other blocks it switched on (GPIO ports, AFIO, DMA …) are named in one
 * line (`others`). Nothing is guessed: a block the firmware did not switch
 * on is not listed, a remapped pin set the board does not bring out lists no
 * pins, a timer with no channel on a pin says so. Pure.
 */
import type { UartLineConfig } from '../../mcu/mcu-api'
import { F103_BUSES, busKey, type BusDef, type BusKind } from './instruments/buses'
import { activePinFunction, remapActive } from './instruments/pin-function'

export type SetupKind = BusKind | 'timer' | 'adc'

/** One signal of a block on one pin: 'TX' on 'PA9', 'CH1' on 'PA6', 'IN0' on 'PA0'. */
export interface SetupSignal {
  name: string
  /** MCU port pin ('PA9') */
  pin: string
  /** the catalog pin that carries it (Blue Pill: the same name) */
  boardPin: string
}

export interface SetupRow {
  /** the peripheral: 'USART1', 'I2C1', 'TIM3', 'ADC1' */
  block: string
  kind: SetupKind
  signals: SetupSignal[]
  /** buses: the key addBusFor takes ('USART1', 'I2C1-remap') */
  busKey?: string
  /** buses: the firmware moved it to its remapped pins (AFIO_MAPR) */
  remap?: boolean
  /** USART: the line settings, when the firmware enabled it (UE = 1) */
  uart?: UartLineConfig
}

export interface FirmwareSetup {
  rows: SetupRow[]
  /** other blocks the firmware switched on (no pins of their own here), in report order */
  others: string[]
}

export interface SetupInput {
  /** the board's catalog pins and their functions (CatalogEntry.pinInfo / mcu.pinMap) */
  pinInfo: readonly { pin: string; functions?: readonly string[] }[] | undefined
  pinMap: Readonly<Record<string, string>> | undefined
  /** McuFrameInfo.clocked (null / undefined = not reported) */
  clocked: readonly string[] | null | undefined
  /** McuFrameInfo.uarts */
  uarts: readonly { name: string; config: UartLineConfig }[] | null | undefined
  /** McuFrameInfo.mapr (undefined = unknown: the reset mapping) */
  mapr: number | undefined
  /** telemetry.mcu.pinModes (catalog pin → 'af', 'af-od', 'an' …) */
  pinModes: Readonly<Record<string, string>> | undefined
}

/** Blocks every firmware has from reset — not news (the 周邊 tab's ON_FROM_RESET). */
const FROM_RESET = new Set(['Memory map', 'RCC', 'FLASH'])

const TIMERS = /^TIM\d+$/
const ADCS = /^ADC\d$/

/** The bus ids in F103_BUSES order, each once (USART1, USART2, USART3, I2C1, I2C2, SPI1, SPI2). */
const BUS_IDS: readonly string[] = [...new Set(F103_BUSES.map((b) => b.id))]

/** The pin set of bus `id` the firmware uses: the remapped one when the known MAPR selects it. */
function busVariant(id: string, mapr: number | undefined): { def: BusDef | null; remap: boolean } {
  const plain = F103_BUSES.find((b) => b.id === id && !b.remap) ?? null
  if (mapr === undefined || !plain) return { def: plain, remap: false }
  const remapped = remapActive(`${id}_${plain.signals[0].name}`, mapr)
  if (!remapped) return { def: plain, remap: false }
  // remapped onto pins the Blue Pill does not bring out (USART3 → PC10/PC11): no pins to name
  return { def: F103_BUSES.find((b) => b.id === id && b.remap) ?? null, remap: true }
}

/** What the firmware set up (see the module comment). */
export function firmwareSetup(input: SetupInput): FirmwareSetup {
  const on = new Set<string>()
  const order: string[] = []
  const add = (name: string) => {
    if (!on.has(name)) {
      on.add(name)
      order.push(name)
    }
  }
  for (const n of input.clocked ?? []) add(n)
  // a USART the firmware enabled is on even when the model does not list its clock
  for (const u of input.uarts ?? []) if (u.config.enabled) add(u.name)
  const boardPinOf = (port: string): string =>
    (input.pinMap && Object.keys(input.pinMap).find((p) => input.pinMap![p] === port)) ?? port
  const portOf = (boardPin: string): string => input.pinMap?.[boardPin] ?? boardPin
  const rows: SetupRow[] = []
  const listed = new Set<string>()

  // serial lines and buses: their pins come from the bus definitions (an RX / MISO pin is an input)
  for (const id of BUS_IDS) {
    if (!on.has(id)) continue
    const { def, remap } = busVariant(id, input.mapr)
    const kind = (def ?? F103_BUSES.find((b) => b.id === id)!).kind
    const row: SetupRow = {
      block: id,
      kind,
      signals: def ? def.signals.map((s) => ({ name: s.name, pin: s.pin, boardPin: boardPinOf(s.pin) })) : [],
    }
    if (def) row.busKey = busKey(def)
    if (remap) row.remap = true
    const uart = input.uarts?.find((u) => u.name === id)?.config
    if (kind === 'uart' && uart?.enabled) row.uart = uart
    rows.push(row)
    listed.add(id)
  }

  // timers: the pins that carry one of their channels right now (the pin rows' own judgement)
  const ctx = { uarts: input.uarts ?? undefined, mapr: input.mapr, clocked: input.clocked ?? undefined }
  const channels = new Map<string, SetupSignal[]>()
  const analog = new Map<string, SetupSignal[]>()
  for (const info of input.pinInfo ?? []) {
    const fns = info.functions ?? []
    const mode = input.pinModes?.[info.pin]
    const fn = activePinFunction(fns, mode, ctx)
    const m = fn ? /^(TIM\d+)_(CH\dN?)/.exec(fn) : null
    if (m) {
      const list = channels.get(m[1]) ?? []
      list.push({ name: m[2], pin: portOf(info.pin), boardPin: info.pin })
      channels.set(m[1], list)
    }
    if (mode === 'an') {
      const a = fns.map((f) => /^ADC(\d+)_IN(\d+)$/.exec(f)).find(Boolean)
      if (a) {
        // ADC12_IN0 is an input of ADC1 and ADC2: listed under each one the firmware switched on
        for (const d of a[1].split('')) {
          const list = analog.get(`ADC${d}`) ?? []
          list.push({ name: `IN${a[2]}`, pin: portOf(info.pin), boardPin: info.pin })
          analog.set(`ADC${d}`, list)
        }
      }
    }
  }
  const byChannel = (a: SetupSignal, b: SetupSignal) => a.name.localeCompare(b.name, 'en', { numeric: true })
  for (const id of order.filter((n) => TIMERS.test(n)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    rows.push({ block: id, kind: 'timer', signals: (channels.get(id) ?? []).sort(byChannel) })
    listed.add(id)
  }
  for (const id of order.filter((n) => ADCS.test(n)).sort()) {
    rows.push({ block: id, kind: 'adc', signals: (analog.get(id) ?? []).sort(byChannel) })
    listed.add(id)
  }
  const others = order.filter((n) => !listed.has(n) && !FROM_RESET.has(n))
  return { rows, others }
}

/** 「8N1」 — a USART's frame format (data bits without the parity bit, N / E / O, stop bits). */
export function uartFrameText(c: UartLineConfig): string {
  const data = c.dataBits - (c.parity !== 'none' ? 1 : 0)
  return `${data}${c.parity === 'even' ? 'E' : c.parity === 'odd' ? 'O' : 'N'}${c.stopBits}`
}
