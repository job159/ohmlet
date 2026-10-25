/**
 * Electrical rule check (ERC) — entry point.
 *
 *   runErc(layout, { telemetry?, issues? }) → ErcFinding[]
 *
 * Pure and synchronous: builds the netlist + DC graph (graph.ts) and runs
 * the rule modules. Rules (see api.ts ERC_RULES for the level semantics):
 *   1 supply-short       rules-power.ts
 *   2 led-current        rules-led.ts
 *   3 gpio-overvoltage   rules-mcu.ts
 *   4 floating-input     rules-mcu.ts
 *   5 i2c-pullup         rules-mcu.ts
 *   6 supply-range       rules-power.ts  /  logic-level  rules-mcu.ts
 *   7 over-rating        rules-live.ts   (telemetry / issues only)
 *   8 open-lead          rules-open.ts   (a two-lead part with a lead on an empty net,
 *                                          or only on a rail no supply feeds)
 *     rail-unpowered     rules-open.ts   (a rail with parts / wires and no supply)
 *   9 ground-reference, unpowered        rules-power.ts
 * Findings are sorted error → risk → info, then by rule, then by id.
 */
import type { CircuitLayout } from '../../model/types'
import type { ErcFinding, ErcOptions } from './api'
import { ERC_LEVEL_ORDER, ERC_RULES } from './api'
import { buildCircuit } from './graph'
import { checkPower, checkSupplyRange, checkSupplyShorts } from './rules-power'
import { checkLeds } from './rules-led'
import { checkFloatingInputs, checkGpioModes, checkGpioVoltages, checkI2c, checkPinRatings } from './rules-mcu'
import { checkLive } from './rules-live'
import { checkOpenLeads, checkUnpoweredRails } from './rules-open'

export type { ErcFinding, ErcLevel, ErcOptions, ErcRuleId, ErcRuleInfo } from './api'
export { ERC_RULES, ERC_LEVEL_ORDER } from './api'
export { firmwareModesSettled, inSystemMemory, MODE_SETTLE_S } from './mcu-state'

const RULE_ORDER = new Map(ERC_RULES.map((r, i) => [r.id, i]))

export function runErc(layout: CircuitLayout, opts: ErcOptions = {}): ErcFinding[] {
  if (!layout || !Array.isArray(layout.components)) return []
  const c = buildCircuit(layout, opts.telemetry ?? null, opts.issues ?? [], {
    resetAt: opts.mcuResetAt,
    resetPc: opts.mcuResetPc,
    unclocked: opts.unclockedPorts,
  })
  const out: ErcFinding[] = []
  checkSupplyShorts(c, out)
  checkLeds(c, out)
  checkGpioVoltages(c, out)
  checkFloatingInputs(c, out)
  checkI2c(c, out)
  checkGpioModes(c, out)
  checkSupplyRange(c, out)
  checkPinRatings(c, out)
  checkOpenLeads(c, out)
  checkUnpoweredRails(c, out)
  checkPower(c, out)
  const leds = new Set(out.filter((f) => f.rule === 'led-current' && f.level !== 'info').map((f) => f.componentIds[0]))
  checkLive(c, out, leds)

  // dedupe by id (first wins), then sort
  const seen = new Set<string>()
  const unique: ErcFinding[] = []
  for (const f of out) {
    if (seen.has(f.id)) continue
    seen.add(f.id)
    unique.push(f)
  }
  return unique.sort(
    (a, b) =>
      ERC_LEVEL_ORDER[a.level] - ERC_LEVEL_ORDER[b.level] ||
      (RULE_ORDER.get(a.rule) ?? 99) - (RULE_ORDER.get(b.rule) ?? 99) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** Count findings per level. */
export function ercCounts(findings: readonly ErcFinding[]): { error: number; risk: number; info: number } {
  const n = { error: 0, risk: 0, info: 0 }
  for (const f of findings) n[f.level]++
  return n
}
