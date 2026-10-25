/**
 * Shared bench for the intermediate (中級) STM32 lessons
 * (src/lessons/intermediate/*.lesson.ts). Not a lesson itself: the registry
 * only collects `*.lesson.ts`.
 *
 * Every intermediate lesson starts from the same Blue Pill bench, wired the
 * way the bundled embedded examples are (examples/embedded):
 *  - U1 stm32_bluepill anchored at h10: header pins 1–20 in row h, columns
 *    10–29 (PB12 … 3V3_2), pins 21–40 in row c, columns 29–10 (VBAT … GND1).
 *    The PCB covers rows b–i, so each header pin has exactly ONE free hole on
 *    its strip: row j beside the h-row header, row a beside the c-row header
 *    (`tap(pin)`).
 *  - PS1 bench supply 5 V → bottom + rail → the board's 5V pin (on-board
 *    3.3 V LDO); PS1 − → bottom − rail = GND.
 *  - the board's 3V3 pin → top + rail (3.3 V for pull-ups, pots, ICs) and a
 *    GND pin → top − rail, so BOTH − rails are ground.
 * Component ids follow the editor's own naming (src/state/store.ts
 * ID_PREFIX: R1, LED1, SW1, RV1, U2 …, X1 for modules / instruments), so a
 * part the learner places gets the id the checks expect.
 */
import type { CircuitLayout, ComponentInstance, Wire } from '../../model/types'
import { componentPinHoles, formatHole } from '../../model/breadboard'
import { getEntry } from '../../model/catalog'

/** the Blue Pill under test */
export const BOARD: ComponentInstance = { id: 'U1', type: 'stm32_bluepill', at: 'h10' }
/** the bench supply (5 V into the board's 5V pin) */
export const SUPPLY: ComponentInstance = { id: 'PS1', type: 'power_supply', params: { voltage: 5 } }

/**
 * The free breadboard hole on the strip of a Blue Pill header pin (row j
 * beside the h-row header, row a beside the c-row header).
 */
export function tap(pin: string): string {
  const entry = getEntry(BOARD.type)
  if (!entry) throw new Error('catalog has no stm32_bluepill')
  const i = entry.pins.indexOf(pin)
  const h = i >= 0 ? componentPinHoles(BOARD, entry)?.[i] : null
  if (!h || h.kind !== 'strip') throw new Error(`no Blue Pill header pin ${pin}`)
  return formatHole({ ...h, row: h.row === 'c' ? 'a' : 'j' })
}

/** [from, to, color] — a wire on the bench */
export type WireSpec = readonly [from: string, to: string, color?: string]

/** power wiring of the bench (always the first wires, W1 … W6) */
export const POWER_WIRES: readonly WireSpec[] = [
  ['PS1:+', 'bot+0', 'red'],
  ['PS1:-', 'bot-0', 'black'],
  [tap('5V'), 'bot+20', 'red'],
  [tap('GND3'), 'bot-21', 'black'],
  [tap('3V3_1'), 'top+8', 'red'],
  [tap('GND2'), 'top-7', 'black'],
]

/**
 * A lesson circuit on the bench: PS1 + U1 + `parts`, the power wiring and
 * then `wires`, numbered W1, W2 … in that order — so a solution built from
 * the same lists as its start circuit plus extra entries keeps every id of
 * the start circuit.
 */
export function benchLayout(
  name: string,
  description: string,
  parts: readonly ComponentInstance[],
  wires: readonly WireSpec[],
): CircuitLayout {
  const all: Wire[] = [...POWER_WIRES, ...wires].map(([from, to, color], i) =>
    color ? { id: `W${i + 1}`, from, to, color } : { id: `W${i + 1}`, from, to },
  )
  return {
    version: 1,
    name,
    description,
    components: [{ ...SUPPLY, params: { ...SUPPLY.params } }, { ...BOARD }, ...parts.map((p) => ({ ...p }))],
    wires: all,
  }
}

/** A two-lead / three-lead part on breadboard holes. */
export function leads(id: string, type: string, holes: readonly string[], params?: ComponentInstance['params']): ComponentInstance {
  return params ? { id, type, holes: [...holes], params: { ...params } } : { id, type, holes: [...holes] }
}

/** An anchored part (DIP / footprint / module). */
export function anchored(id: string, type: string, at: string, params?: ComponentInstance['params']): ComponentInstance {
  return params ? { id, type, at, params: { ...params } } : { id, type, at }
}
