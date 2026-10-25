/**
 * Layout builders for coordinator tests: a Blue Pill straddling the channel
 * (anchor h10 → header pins in rows h and c), bench supply on the 5V pin,
 * ground on the top− rail. Every header pin's strip has exactly one free
 * hole beside the PCB (row a for the c-row header, row j for the h-row
 * header) — `tap(pin)` returns it.
 */
import type { CircuitLayout, ComponentInstance, ParamValue, Wire } from '../../src/model/types'
import { componentPinHoles, formatHole } from '../../src/model/breadboard'
import { CATALOG } from '../../src/model/catalog'

export const BP: ComponentInstance = { id: 'U1', type: 'stm32_bluepill', at: 'h10' }

/** The free hole on the strip of a Blue Pill header pin. */
export function tap(pin: string, board: ComponentInstance = BP): string {
  const entry = CATALOG[board.type]
  const idx = entry.pins.indexOf(pin)
  if (idx < 0) throw new Error(`no pin ${pin}`)
  const holes = componentPinHoles(board, entry)
  const h = holes?.[idx]
  if (!h || h.kind !== 'strip') throw new Error(`no hole for ${pin}`)
  return formatHole({ ...h, row: h.row === 'c' ? 'a' : 'j' })
}

let seq = 0
export function w(from: string, to: string): Wire {
  seq += 1
  return { id: `w${seq}`, from, to }
}

export function part(
  id: string,
  type: string,
  holes: string[],
  params?: Record<string, ParamValue>,
): ComponentInstance {
  return params ? { id, type, holes, params } : { id, type, holes }
}

export interface WorldOptions {
  /** bench supply voltage (default 5 V, fed into the 5V pin) */
  supply?: number
  /** feed the supply into 3V3 instead of 5V */
  via3v3?: boolean
  /** connect the board 3V3 to the top+ rail (for pull-ups) */
  rail3v3?: boolean
}

/**
 * PS1 → 5V pin (or 3V3), PS1− → top− rail, board GND3 → top− rail.
 * `parts` / `wires` are added on top.
 */
export function bluePillWorld(
  parts: ComponentInstance[] = [],
  wires: Wire[] = [],
  opts: WorldOptions = {},
): CircuitLayout {
  const base: Wire[] = [
    w('PS1:+', opts.via3v3 ? tap('3V3_2') : tap('5V')),
    w('PS1:-', 'top-0'),
    w(tap('GND3'), 'top-1'),
  ]
  if (opts.rail3v3) base.push(w(tap('3V3_1'), 'top+0'))
  return {
    version: 1,
    name: 'coordinator test world',
    components: [{ id: 'PS1', type: 'power_supply', params: { voltage: opts.supply ?? 5 } }, BP, ...parts],
    wires: [...base, ...wires],
  }
}

/** Fake-MCU pin numbers (port*16 + bit). */
export const PA0 = 0
export const PA1 = 1
export const PA5 = 5
export const PA9 = 9
export const PB6 = 22
export const PB7 = 23
export const PB8 = 24
export const PB9 = 25
export const PC13 = 45
