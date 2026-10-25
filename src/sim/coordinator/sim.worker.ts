/**
 * Module Worker entry of the WorkerSimHost: runs a SimulationCoordinator
 * (via SimWorkerRuntime) off the main thread. Spawned by WorkerSimHost via
 *   new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
 * Protocol: MainToWorker in, WorkerToMain out (see ./worker-host.ts).
 */
import { SimWorkerRuntime } from './worker-host'
import type { MainToWorker, WorkerToMain } from './worker-host'

// tsconfig uses the DOM lib (no WebWorker lib): type the worker global scope
// through the structural Worker interface (onmessage / postMessage shapes).
const ctx = self as unknown as Worker

const runtime = new SimWorkerRuntime({
  post: (m: WorkerToMain, transfer: Transferable[]) => ctx.postMessage(m, transfer),
})

ctx.onmessage = (e: MessageEvent<MainToWorker>) => runtime.handle(e.data)
