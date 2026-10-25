/**
 * Shared bench for the advanced lessons (src/lessons/advanced/*): a Blue Pill
 * (U1, anchor h10 — header pins in rows h and c, the board body covers rows
 * b–i, so every header pin keeps exactly ONE free hole: row j beside the
 * h-row header, row a beside the c-row header) on one standard breadboard.
 *
 * Power (identical in every advanced lesson):
 *   PS1 5 V  → bot+0 → bot+1 → the 5V pin strip (j27): bottom + rail = 5 V
 *   PS1 −    → top-0; GND3 (j28) → top-1; top-2 → bot-0: both − rails = GND
 *   3V3_1 (a12) → top+0: top + rail = the Blue Pill's 3.3 V regulator output
 *
 * The modules a lesson's acceptance checks reference by id are pre-placed in
 * its starting circuit, so the ids the learner sees are the ids the checks
 * use.
 */
import type { CircuitLayout, ComponentInstance, ParamValue, Wire } from '../../model/types'
import type { LessonCheck, PinRef } from '../types'

/** The free breadboard hole on the strip of each Blue Pill header pin (U1 at h10). */
export const TAP = {
  PB12: 'j10',
  PB13: 'j11',
  PB14: 'j12',
  PB15: 'j13',
  PA8: 'j14',
  PA9: 'j15',
  PA10: 'j16',
  PA11: 'j17',
  PA12: 'j18',
  PA15: 'j19',
  PB3: 'j20',
  PB4: 'j21',
  PB5: 'j22',
  PB6: 'j23',
  PB7: 'j24',
  PB8: 'j25',
  PB9: 'j26',
  '5V': 'j27',
  GND3: 'j28',
  '3V3_2': 'j29',
  VBAT: 'a29',
  PC13: 'a28',
  PC14: 'a27',
  PC15: 'a26',
  PA0: 'a25',
  PA1: 'a24',
  PA2: 'a23',
  PA3: 'a22',
  PA4: 'a21',
  PA5: 'a20',
  PA6: 'a19',
  PA7: 'a18',
  PB0: 'a17',
  PB1: 'a16',
  PB10: 'a15',
  PB11: 'a14',
  NRST: 'a13',
  '3V3_1': 'a12',
  GND2: 'a11',
  GND1: 'a10',
} as const

export type BluePillPin = keyof typeof TAP

/** The Blue Pill under test. */
export const BOARD: ComponentInstance = { id: 'U1', type: 'stm32_bluepill', at: 'h10' }

/** A wire with an explicit id and a cosmetic color (red, black, yellow, green, blue, white). */
export function wire(id: string, from: string, to: string, color: string): Wire {
  return { id, from, to, color }
}

/** A free-lead part (resistor, LED, DIP chip by holes …). */
export function part(id: string, type: string, holes: string[], params?: Record<string, ParamValue>): ComponentInstance {
  return params ? { id, type, holes, params } : { id, type, holes }
}

/** An anchored part (module footprint, DIP package, pushbutton …). */
export function anchored(id: string, type: string, at: string, params?: Record<string, ParamValue>): ComponentInstance {
  return params ? { id, type, at, params } : { id, type, at }
}

/** An off-board part (bench supply, motor …). */
export function offboard(id: string, type: string, params?: Record<string, ParamValue>): ComponentInstance {
  return params ? { id, type, params } : { id, type }
}

/** The bench supply PS1 (5 V) and the Blue Pill. */
export function benchParts(): ComponentInstance[] {
  return [offboard('PS1', 'power_supply', { voltage: 5 }), { ...BOARD }]
}

/** The power wiring described in the header (ids W1…W6 — the lesson's own wires follow from W7). */
export function benchWires(): Wire[] {
  return [
    wire('W1', 'PS1:+', 'bot+0', 'red'),
    wire('W2', 'bot+1', TAP['5V'], 'red'),
    wire('W3', 'PS1:-', 'top-0', 'black'),
    wire('W4', TAP.GND3, 'top-1', 'black'),
    wire('W5', 'top-2', 'bot-0', 'black'),
    wire('W6', TAP['3V3_1'], 'top+0', 'red'),
  ]
}

/** A version-1 layout on the standard board: the bench plus `components` / `wires`. */
export function bench(name: string, components: ComponentInstance[], wires: Wire[]): CircuitLayout {
  return { version: 1, name, components: [...benchParts(), ...components], wires: [...benchWires(), ...wires] }
}

/** A Blue Pill pin as a check reference. */
export function pin(name: BluePillPin): PinRef {
  return { component: 'U1', pin: name }
}

/** A module pin as a check reference. */
export function pinOf(component: string, name: string): PinRef {
  return { component, pin: name }
}

/** The Blue Pill's 3.3 V output (the top + rail). */
export const V33: PinRef = { component: 'U1', pin: '3V3_1' }
/** The 5 V net: the Blue Pill's 5V pin, fed from PS1 through the bottom + rail. */
export const V5: PinRef = { component: 'U1', pin: '5V' }
/** The Blue Pill's ground (GND1; the top − rail). */
export const GND: PinRef = { component: 'U1', pin: 'GND1' }

/** `connected` check between a module pin and a Blue Pill pin. */
export function wired(component: string, modulePin: string, to: PinRef, label?: string): LessonCheck {
  return label
    ? { kind: 'connected', a: { component, pin: modulePin }, b: to, label }
    : { kind: 'connected', a: { component, pin: modulePin }, b: to }
}

/**
 * Lesson text: paragraphs joined by blank lines (the lesson renderer's
 * paragraph break). Use `bullets()` for a "- " list inside one paragraph.
 */
export function doc(...paragraphs: string[]): string {
  return paragraphs.join('\n\n')
}

/** One "- " bullet list (a single paragraph, items on consecutive lines). */
export function bullets(...items: string[]): string {
  return items.map((s) => `- ${s}`).join('\n')
}
