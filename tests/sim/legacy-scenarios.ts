/**
 * Legacy-equivalence scenarios for the four bundled examples.
 *
 * The fixture `fixtures/legacy-examples.json` was captured by running these
 * exact scenarios against the ORIGINAL engine (git HEAD before the
 * embedded-platform engine hooks: `git show 0ae7cc8:src/sim/engine.ts`).
 * Every later engine — and the SimulationCoordinator in its no-MCU mode —
 * must reproduce those node voltages BIT FOR BIT (Object.is per value).
 *
 * The scenarios also exercise runtime params mid-run (button presses, light
 * slider, pot position) so the setRuntimeParam path is covered too.
 */
import type { CircuitLayout, ParamValue, SimTelemetry } from '../../src/model/types'
import { validateLayout } from '../../src/model/validate'

import blinkyRaw from '../../examples/blinky-555.json'
import dateRaw from '../../examples/date-display.json'
import counterRaw from '../../examples/counter.json'
import nightRaw from '../../examples/night-light.json'

/** Total DEFAULT_DT steps per scenario (0.6 s of sim time). */
export const LEGACY_STEPS = 12_000
/** A checkpoint (all node voltages) is recorded every this many steps. */
export const CHECK_EVERY = 500

export const LEGACY_EXAMPLES: [string, unknown][] = [
  ['blinky-555', blinkyRaw],
  ['date-display', dateRaw],
  ['counter', counterRaw],
  ['night-light', nightRaw],
]

interface Action {
  step: number
  id: string
  key: string
  value: ParamValue
}

/** Runtime-param actions applied BEFORE the given step index runs. */
export const LEGACY_ACTIONS: Record<string, Action[]> = {
  counter: [
    { step: 5000, id: 'SW1', key: 'pressed', value: true },
    { step: 6000, id: 'SW1', key: 'pressed', value: false },
  ],
  'night-light': [
    { step: 4000, id: 'LDR1', key: 'light', value: 0.05 },
    { step: 8000, id: 'LDR1', key: 'light', value: 0.95 },
    { step: 9000, id: 'RV1', key: 'position', value: 0.3 },
  ],
}

export interface LegacyCheckpoint {
  step: number
  time: number
  /** node voltage per net (same order as `nets`); null encodes NaN */
  v: (number | null)[]
}

export interface LegacyCapture {
  nets: string[]
  checkpoints: LegacyCheckpoint[]
  issues: string[]
}

/** Anything that can take one DEFAULT_DT step and report telemetry. */
export interface LegacyStepper {
  stepOnce(): void
  setRuntimeParam(id: string, key: string, value: ParamValue): void
  telemetry(): SimTelemetry
}

export function loadExample(raw: unknown): CircuitLayout {
  const res = validateLayout(raw)
  if (!res.ok || !res.layout) throw new Error(`example failed validation: ${res.errors.join('; ')}`)
  return res.layout
}

export function runLegacyScenario(name: string, stepper: LegacyStepper): LegacyCapture {
  const actions = LEGACY_ACTIONS[name] ?? []
  let nets: string[] | null = null
  const checkpoints: LegacyCheckpoint[] = []
  const record = (step: number): void => {
    const tele = stepper.telemetry()
    if (!nets) nets = Object.keys(tele.netVoltages).sort()
    const v = nets.map((n) => {
      const x = tele.netVoltages[n]
      return Number.isNaN(x) ? null : x
    })
    checkpoints.push({ step, time: tele.time, v })
  }
  for (let i = 0; i < LEGACY_STEPS; i++) {
    for (const a of actions) if (a.step === i) stepper.setRuntimeParam(a.id, a.key, a.value)
    stepper.stepOnce()
    if ((i + 1) % CHECK_EVERY === 0) record(i + 1)
  }
  const tele = stepper.telemetry()
  return { nets: nets ?? [], checkpoints, issues: tele.issues.map((x) => x.message) }
}
