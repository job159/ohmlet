/**
 * Test stimulus — an EXTERNAL DRIVER on a header pin of an MCU board, used
 * by the firmware-contract runner (./checks.ts) and, later, by lessons.
 *
 * Electrically a stimulus is a strong Thevenin source on the pin's NET:
 *   level 0   50 Ω (STIMULUS_ROUT) to the board's VSS (a button closed to GND)
 *   level 1   50 Ω to the board's VDD rail (3V3 on a Blue Pill)
 *   'open'    nothing at all (the released button): only what the circuit
 *             and the MCU's own pull resistors do remains
 * It enters the simulation exactly where a real external driver would:
 *   - analog solver: the board adapter stamps it as an extra stage between
 *     the pin's node and the board's VDD / VSS rail nodes, duty-averaged
 *     over the analog interval like every drive (McuBoardChip.setFixture);
 *     on an ANALOG net its change also ends the analog interval exactly at
 *     the stimulus time;
 *   - logic layer: on a logic-resolvable net it is its own DigitalNets slot,
 *     resolved at the exact virtual time against the MCU's stage and the
 *     pulls (so driving against a push-pull output is reported as
 *     contention and reads undefined, as on a bench);
 *   - the MCU only ever sees the resolved net through its Schmitt-trigger
 *     inputs (McuBoardChip → McuPinPort.setInput). Nothing here touches MCU
 *     registers or peripheral state.
 * The coordinator owns the live stimuli (SimulationCoordinator.setStimulus)
 * and re-applies them on every rebuild (load()); `StimulusPlan` below turns
 * a timed drive list into coordinator events.
 */
import { STM32F1_GPIO } from '../../mcu/pins'

/** A stimulus level: forced low, forced high, or released. */
export type StimulusLevel = 0 | 1 | 'open'

/**
 * Output resistance of the stimulus driver (Ω): the same 50 Ω as an STM32F1
 * push-pull stage (DS5319 §5.3.14, VOL ≤ 0.4 V at 8 mA), i.e. a strong
 * logic driver that overrides the 30–50 kΩ internal pulls by three orders
 * of magnitude but is still a finite source (contention stays visible).
 */
export const STIMULUS_ROUT = STM32F1_GPIO.routStrong

/** Stage conductances (S) of a stimulus level: [to VDD, to VSS]. */
export function stimulusStage(level: StimulusLevel): [number, number] {
  const g = 1 / STIMULUS_ROUT
  if (level === 0) return [0, g]
  if (level === 1) return [g, 0]
  return [0, 0]
}

export function isStimulusLevel(v: unknown): v is StimulusLevel {
  return v === 0 || v === 1 || v === 'open'
}

/** One timed stimulus action, time in seconds (absolute virtual time). */
export interface StimulusAction {
  at: number
  componentId: string
  /** catalog pin of the board ('PA0', 'PB12' …) */
  pin: string
  level: StimulusLevel
}

/** The coordinator services a plan needs (SimulationCoordinator implements them). */
export interface StimulusHost {
  /** current virtual time (s); inside an event callback its exact time */
  readonly now: number
  /** run `fn` at exact virtual time `t` on the coordinator event queue */
  scheduleAt(t: number, fn: () => void): number
  cancelScheduled(handle: number): void
  /** apply a stimulus now (inside an event: at the event's exact time) */
  setStimulus(componentId: string, pin: string, level: StimulusLevel): boolean
}

/**
 * A list of timed stimulus actions scheduled on a coordinator. Actions at
 * the same time apply in list order. `applied` records what actually
 * happened (time + whether the target pin exists) for reports.
 */
export class StimulusPlan {
  readonly applied: { action: StimulusAction; t: number; ok: boolean }[] = []
  private handles: number[] = []

  constructor(private readonly host: StimulusHost) {}

  /** Schedule `actions` (times in absolute seconds; past times apply at once). */
  schedule(actions: readonly StimulusAction[]): void {
    const sorted = actions
      .map((a, i) => ({ a, i }))
      .sort((x, y) => x.a.at - y.a.at || x.i - y.i)
      .map((x) => x.a)
    for (const a of sorted) {
      const h = this.host.scheduleAt(a.at, () => {
        const ok = this.host.setStimulus(a.componentId, a.pin, a.level)
        this.applied.push({ action: a, t: this.host.now, ok })
      })
      this.handles.push(h)
    }
  }

  /** Cancel every action that has not run yet. */
  cancel(): void {
    for (const h of this.handles) this.host.cancelScheduled(h)
    this.handles = []
  }
}
