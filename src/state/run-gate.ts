/**
 * The auto-run gate (round 5 — 「改了就自動模擬」; the policy itself lives in
 * src/ui/chrome/auto-run.ts). State layer, no runtime dependencies:
 *
 *   holdAutoRun()        a multi-step load in progress (lab.importProject,
 *                        loadLessonCircuit — whileAutoRunHeld wraps a whole
 *                        async call) holds auto-run until it is done:
 *                        loadLayout lands the new circuit first and binds
 *                        its firmware only after async work, while the
 *                        coordinator still holds the PREVIOUS circuit's
 *                        image under the same board id. Started in between,
 *                        that stale program would boot on the new circuit
 *                        (stale UART lines in a terminal resetSim just
 *                        cleared, stale pin drives that can damage parts).
 *                        Returns the release (idempotent); ref-counted.
 *   autoRunHeld()        a hold is active
 *   onAutoRunRelease(fn) the last hold was released (auto-run then decides
 *                        what it deferred); returns the unsubscribe
 *   onAutoRunGateChange(fn)
 *                        the gate closed (first hold) or opened (last
 *                        release) — auto-run's "a start is coming" state
 *                        (the status pill keeps its ready line back)
 *
 *   noteAutoStart(info) / runStartedByAutoRun()
 *                        why auto-run started the run that is going now
 *                        ('boot' — the app opened, 'load' — an example, a
 *                        lesson circuit, a project, 'chrome' — the product
 *                        chrome came up over a circuit already there (a
 *                        language switch), 'edit', 'firmware', 'reset',
 *                        'runtime'), or null for a run the user
 *                        started (capsule, Space, 〔繼續執行〕, a lesson's
 *                        ▶) — auto-run clears it whenever the simulation
 *                        stops, so at a run's rising edge it tells listeners
 *                        (the cheer, the lesson coach) who started it.
 *
 * Single-step loads (an AI circuit, a JSON layout) and undo / redo need no
 * hold: the lab reconciles their firmware synchronously in its 'loaded'
 * listener, before auto-run's deferred decision.
 */
import type { CircuitLayout } from '../model/types'

/** Why auto-run started (or would start) a run. */
export type AutoRunReason = 'boot' | 'load' | 'chrome' | 'edit' | 'firmware' | 'reset' | 'runtime'

/** The run auto-run started: why, and the circuit it started on (`rev` = circuitRevision of it). */
export interface AutoStart {
  reason: AutoRunReason
  layout: CircuitLayout
  rev: string
}

let holds = 0
const releaseListeners = new Set<() => void>()
const gateListeners = new Set<() => void>()

function notify(listeners: ReadonlySet<() => void>): void {
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch (err) {
      console.error('auto-run gate listener failed', err)
    }
  }
}

/** Hold auto-run (ref-counted) until the returned release is called (calling it twice is harmless). */
export function holdAutoRun(): () => void {
  holds++
  if (holds === 1) notify(gateListeners)
  let released = false
  return () => {
    if (released) return
    released = true
    holds--
    if (holds > 0) return
    notify(gateListeners)
    notify(releaseListeners)
  }
}

/** `fn` with auto-run held for the whole of every call (released however the call ends). */
export function whileAutoRunHeld<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const release = holdAutoRun()
    try {
      return await fn(...args)
    } finally {
      release()
    }
  }
}

/** Is a multi-step load holding auto-run? */
export function autoRunHeld(): boolean {
  return holds > 0
}

/** Called when the last hold is released; returns the unsubscribe. */
export function onAutoRunRelease(fn: () => void): () => void {
  releaseListeners.add(fn)
  return () => {
    releaseListeners.delete(fn)
  }
}

/** Called when the gate closes (the first hold) or opens (the last release); returns the unsubscribe. */
export function onAutoRunGateChange(fn: () => void): () => void {
  gateListeners.add(fn)
  return () => {
    gateListeners.delete(fn)
  }
}

let lastAutoStart: AutoStart | null = null

/** auto-run: the run starting now is its own (null: the run stopped / a user start). */
export function noteAutoStart(info: AutoStart | null): void {
  lastAutoStart = info
}

/** Why auto-run started the current run; null when the user started it (or nothing runs). */
export function runStartedByAutoRun(): AutoStart | null {
  return lastAutoStart
}

/** TEST-ONLY: drop every hold and the start record. */
export function __resetRunGateForTests(): void {
  holds = 0
  lastAutoStart = null
}
