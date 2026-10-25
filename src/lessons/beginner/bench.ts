/**
 * Shared bench builders for the beginner lessons (src/lessons/beginner/*).
 *
 * Every beginner circuit sits on one standard breadboard with the bench
 * supply PS1 on the TOP rails (PS1:+ → top+0, PS1:- → top-0); the parts the
 * acceptance checks reference by id are pre-placed in the starting circuits
 * so the ids the learner sees are exactly the ids the checks use.
 */
import type { CircuitLayout, ComponentInstance, ParamValue, Wire } from '../../model/types'

/** A wire with an explicit id and a cosmetic color. */
export function wire(id: string, from: string, to: string, color: string): Wire {
  return { id, from, to, color }
}

/** The bench supply at `volts` (default 5 V). */
export function supply(volts = 5, id = 'PS1'): ComponentInstance {
  return { id, type: 'power_supply', params: { voltage: volts } }
}

/** PS1:+ → top+0 (red) and PS1:- → top-0 (black). */
export function supplyWires(id = 'PS1'): Wire[] {
  return [wire('W1', `${id}:+`, 'top+0', 'red'), wire('W2', `${id}:-`, 'top-0', 'black')]
}

/** A free-lead part (resistor, LED, capacitor, transistor, switch, probe …). */
export function part(
  id: string,
  type: string,
  holes: string[],
  params?: Record<string, ParamValue>,
): ComponentInstance {
  return params ? { id, type, holes, params } : { id, type, holes }
}

/** An anchored part (pushbutton footprint, Blue Pill …). */
export function anchored(
  id: string,
  type: string,
  at: string,
  params?: Record<string, ParamValue>,
): ComponentInstance {
  return params ? { id, type, at, params } : { id, type, at }
}

/** An off-board instrument (multimeter, function generator …). */
export function offboard(id: string, type: string, params?: Record<string, ParamValue>): ComponentInstance {
  return params ? { id, type, params } : { id, type }
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

/** A version-1 layout on the standard board. */
export function bench(name: string, components: ComponentInstance[], wires: Wire[]): CircuitLayout {
  return { version: 1, name, components, wires }
}
