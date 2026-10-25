/**
 * MCU model registry. Each model module registers a factory as a side effect
 * (imported through src/mcu/all.ts) — the same pattern as chip-api.ts.
 */
import type { McuDevice } from './mcu-api'

export type McuFactory = () => McuDevice

const registry = new Map<string, McuFactory>()

export function registerMcu(model: string, factory: McuFactory): void {
  registry.set(model, factory)
}

export function createMcu(model: string): McuDevice | null {
  const f = registry.get(model)
  return f ? f() : null
}

export function registeredMcus(): string[] {
  return [...registry.keys()]
}
