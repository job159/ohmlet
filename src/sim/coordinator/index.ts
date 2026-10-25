/**
 * Simulation host entry point. UI code talks ONLY to the SimHost contract
 * (./api.ts); this module picks the implementation.
 */
import type { SimHost, SimHostCallbacks } from './api'
import { InlineSimHost } from './inline-host'
import { WorkerSimHost } from './worker-host'

export type * from './api'
export { SimulationCoordinator, MAX_ANALOG_DT, MIN_ANALOG_DT, SCOPE_SAMPLE_DT } from './coordinator'
export type { CoordinatorOptions } from './coordinator'
export { InlineSimHost } from './inline-host'
export type { InlineSimHostOptions, TickScheduler } from './inline-host'
export { WorkerSimHost, SimWorkerRuntime } from './worker-host'
export { McuBoardChip, MCU_BOARD_MODEL } from './mcu-board'

/**
 * A Web Worker host when `Worker` exists and the worker can be constructed,
 * otherwise (node, a sandbox without workers, construction failure) an
 * inline host on the calling thread.
 */
export function createSimHost(callbacks: SimHostCallbacks): SimHost {
  if (typeof Worker !== 'undefined') {
    try {
      return new WorkerSimHost(callbacks)
    } catch {
      /* fall back to the inline host */
    }
  }
  return new InlineSimHost(callbacks)
}
