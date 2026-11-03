/**
 * Auto-run (round 5 — 「改了就自動模擬，不用按執行」): in the product chrome
 * the simulation runs whenever the board holds a circuit. Opening the app,
 * an example, a lesson circuit or a project, placing a part, drawing a wire,
 * an undo / redo and a firmware load all start it — no Run press. A pause is
 * still possible and is respected:
 *
 *   - an explicit pause (the capsule, Space, the MCU panel: store.stopSim,
 *     simStopReason 'user') holds until the CIRCUIT changes. A structural
 *     edit (parts, holes, build-time values, wires — undo / redo too), a
 *     firmware change or a load resumes it; using the circuit (a knob, a
 *     button, a switch, an instrument moved) does not, and neither does
 *     重置模擬: a paused simulation that is reset stays paused at t = 0;
 *   - a reset of a running simulation powers it up again from 0 s;
 *   - a debugger halt is never resumed here (F5, the capsule and 〔繼續執行〕
 *     do that); a failed start is not retried until the circuit changes;
 *   - deleting the last part ends the session (resetSim); an empty board
 *     (wires only counts as empty, like run-feedback.ts) never builds a host
 *     — no worker, no simulation CPU;
 *   - the app's first start waits for the lab's boot-time firmware restore
 *     (labReady): a real board boots WITH its program — at most
 *     BOOT_TIMEOUT_MS (a restore that never settles, e.g. a blocked
 *     IndexedDB, must not leave auto-run dead). A multi-step load
 *     (lab.importProject, loadLessonCircuit) holds auto-run until its
 *     firmware is bound (state/run-gate.ts). Meanwhile autoRunWaiting() is
 *     true: a start is coming, so the status pill keeps its 「電路已就緒」
 *     line back (it would contradict the run a moment later);
 *   - loading firmware (a new image, or the same file flashed again) is a
 *     change of the circuit: it resumes a pause too — the board was just
 *     power-on-reset to run that program;
 *   - the product chrome coming up over a circuit already on the board (a
 *     language switch from the classic chrome) starts it, unless the
 *     learner paused it.
 *
 * Off in the classic chrome (isLegacyChrome keeps the original manual run; a
 * language switch never stops a running simulation, auto-run just stops
 * starting one) and under the harness flags ?shotrig / ?perfwin / ?perfrig
 * unless `&autorun` is present (screenshot and perf scenes stay
 * deterministic); `?autorun=0` turns it off anywhere.
 *
 * Every trigger — the store's layout, the lab's firmware map, the host's
 * 'reset', the gate's release, the boot — is coalesced into ONE decision on
 * a macrotask (setTimeout 0), so latch.ts's release microtask and the lab's
 * synchronous 'loaded' firmware sync land first. A layout change is a 'load'
 * when store.layoutLoadCount() moved, an 'edit' when circuitRevision (the
 * cheer's structural identity: runtime params and instrument positions
 * excluded) changed, else 'runtime'. runStartedByAutoRun() (run-gate.ts)
 * tells the cheer and the lesson coach why the run going now started.
 *
 * Non-React: store / lab subscriptions only, nothing per frame (the 10 Hz
 * telemetry pushes cost one comparison each).
 */
import { useSyncExternalStore } from 'react'
import { onLangChange } from '../../i18n'
import { layoutLoadCount, onSimHostEvent, simStopReason, useStore } from '../../state/store'
import { labReady } from '../../state/lab'
import type { FirmwareRecord } from '../../state/lab-types'
import {
  autoRunHeld,
  noteAutoStart,
  onAutoRunGateChange,
  onAutoRunRelease,
  runStartedByAutoRun,
  type AutoRunReason,
} from '../../state/run-gate'
import { WORKSPACE_MEDIA_QUERY, useLab } from '../embedded/lab'
import { circuitRevision } from '../fx/success-watch'
import { isLegacyChrome } from './legacy'
import { haltedMcuIds } from './run-control'

export { runStartedByAutoRun }
export type { AutoRunReason, AutoStart } from '../../state/run-gate'

/**
 * May auto-run start runs on a page with this query string, in this chrome?
 * (pure — tests) Never in the classic chrome; never with `autorun=0`; under
 * the harness flags only with `autorun`.
 */
export function autoRunAllowed(search: string, legacy: boolean): boolean {
  if (legacy) return false
  let q: URLSearchParams
  try {
    q = new URLSearchParams(search)
  } catch {
    return true
  }
  if (q.get('autorun') === '0') return false
  if ((q.has('shotrig') || q.has('perfwin') || q.has('perfrig')) && !q.has('autorun')) return false
  return true
}

/** autoRunAllowed for this page and the chrome showing now (read at every decision). */
export function autoRunEnabled(): boolean {
  let search = ''
  try {
    if (typeof window !== 'undefined' && window.location) search = window.location.search
  } catch {
    /* no location: a plain page */
  }
  return autoRunAllowed(search, isLegacyChrome())
}

/** How strongly a trigger asks: when several coalesce, the strongest decides (and is recorded). */
const RANK: Readonly<Record<AutoRunReason, number>> = { runtime: 0, reset: 1, chrome: 1, edit: 2, firmware: 2, load: 3, boot: 4 }

/** the first start goes ahead after this long even when the lab's restore never settles */
export const BOOT_TIMEOUT_MS = 5000

/** The triggers that end an explicit pause: the circuit changed (or a new one arrived). */
const RESUMES_PAUSE: ReadonlySet<AutoRunReason> = new Set<AutoRunReason>(['edit', 'firmware', 'load', 'boot'])

function stronger(a: AutoRunReason | null, b: AutoRunReason): AutoRunReason {
  return a !== null && RANK[a] >= RANK[b] ? a : b
}

export interface AutoRunOptions {
  /** resolves once the boot-time firmware restore is done (default: the lab's labReady) */
  ready?: () => Promise<void>
  /** may auto-run start runs now? (default: autoRunEnabled — asked at every decision) */
  enabled?: () => boolean
  /** the boot goes ahead after this long even if ready() never settles (default BOOT_TIMEOUT_MS) */
  bootTimeoutMs?: number
}

let installed = 0
/** the installed auto-run's own `enabled` (autoRunActive) */
let activeEnabled: (() => boolean) | null = null

/**
 * Auto-run is installed and may start runs now: a caller that restarts a
 * run itself (a lesson step's 重置模擬) leaves the restart to it, so the run
 * counts as auto-run's (runStartedByAutoRun) like the capsule's reset.
 */
export function autoRunActive(): boolean {
  return activeEnabled !== null && activeEnabled()
}

// ---- "a start is coming" (the boot's restore, a held load): the pill keeps its ready line back
let waiting = false
const waitingListeners = new Set<() => void>()

function setWaiting(v: boolean): void {
  if (v === waiting) return
  waiting = v
  for (const fn of [...waitingListeners]) fn()
}

/** Auto-run is about to start the board: the boot waits for the lab's restore, or a load holds the gate. */
export function autoRunWaiting(): boolean {
  return waiting
}

/** Called when autoRunWaiting() changes; returns the unsubscribe. */
export function onAutoRunWaitingChange(fn: () => void): () => void {
  waitingListeners.add(fn)
  return () => {
    waitingListeners.delete(fn)
  }
}

/** Reactive autoRunWaiting() (StatusPill). */
export function useAutoRunWaiting(): boolean {
  return useSyncExternalStore(onAutoRunWaitingChange, autoRunWaiting, autoRunWaiting)
}

/**
 * Was any board flashed between `prev` and `next` (a record replaced by a
 * newer load — the same file flashed again keeps the revision but
 * power-on-resets the board)?
 */
function flashed(prev: Readonly<Record<string, FirmwareRecord>>, next: Readonly<Record<string, FirmwareRecord>>): boolean {
  for (const [id, r] of Object.entries(next)) {
    const p = prev[id]
    if (p !== undefined && p !== r && p.loadedAt !== r.loadedAt) return true
  }
  return false
}

/** Install auto-run (App.tsx, once); returns the uninstall. */
export function startAutoRun(opts: AutoRunOptions = {}): () => void {
  const enabled = opts.enabled ?? autoRunEnabled
  const ready = opts.ready ?? labReady
  installed++
  activeEnabled = enabled
  let stopped = false
  let booted = false
  let wasEnabled = enabled()
  /** the strongest trigger not decided yet */
  let pending: AutoRunReason | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const revisionNow = (): string => circuitRevision(useStore.getState().layout, useLab.getState().firmware)
  let seenLoads = layoutLoadCount()
  let lastRev = revisionNow()
  /** the circuit a failure happened on: not retried until it changes */
  let failedRev: string | null = null

  const decide = (reason: AutoRunReason): void => {
    if (stopped || !enabled()) return
    if (!booted || autoRunHeld()) {
      // the boot (labReady) or the gate's release decides it
      pending = stronger(pending, reason)
      return
    }
    const st = useStore.getState()
    if (st.layout.components.length === 0) {
      // nothing to simulate: the last part deleted ends the session; an empty board never gets a host
      if (st.running || st.simTime > 0) st.resetSim()
      return
    }
    if (st.running) return
    // a debugger halt stays until the learner resumes it (F5, the capsule, 〔繼續執行〕)
    if (haltedMcuIds().length > 0) return
    const why = simStopReason()
    if (why === 'debugger') return
    const rev = revisionNow()
    if (why === 'failed' && failedRev === rev) return // no retry loop: the next change of the circuit retries
    if (why === 'user' && !RESUMES_PAUSE.has(reason)) return // using the circuit keeps the pause
    noteAutoStart({ reason, layout: st.layout, rev })
    st.startSim()
    if (!useStore.getState().running) {
      // the host could not be built (an error issue is posted): nothing started — and the stop
      // reason stayed 'failed' through it, so this circuit is the one that failed now
      noteAutoStart(null)
      if (simStopReason() === 'failed') failedRev = rev
    }
  }

  const run = (): void => {
    timer = null
    const reason = pending
    pending = null
    if (reason !== null) decide(reason)
  }
  const schedule = (): void => {
    if (timer !== null || stopped) return
    timer = setTimeout(run, 0)
  }
  const trigger = (reason: AutoRunReason): void => {
    pending = stronger(pending, reason)
    schedule()
  }
  const updateWaiting = (): void => setWaiting(!stopped && enabled() && (!booted || autoRunHeld()))
  // the product chrome came up (a language switch, the workspace shown): start what is on the
  // board — a 'chrome' start, which keeps a pause the learner made
  const chromeCheck = (): void => {
    if (stopped) return
    const now = enabled()
    if (now === wasEnabled) return
    wasEnabled = now
    updateWaiting()
    if (now) trigger('chrome')
  }

  const unsubs: (() => void)[] = []
  unsubs.push(
    useStore.subscribe((s, prev) => {
      // the run stopped (pause, reset, failure, halt): the record of who started it ends with it
      if (prev.running && !s.running && runStartedByAutoRun() !== null) noteAutoStart(null)
      // the circuit a failure happened on (failSession always commits to the store); a start
      // or a reset ends the failure, and the next trigger may try again
      if (simStopReason() !== 'failed') failedRev = null
      else if (failedRev === null) failedRev = revisionNow()
      if (s.layout === prev.layout) return
      const loads = layoutLoadCount()
      const rev = revisionNow()
      let reason: AutoRunReason
      if (loads !== seenLoads) {
        seenLoads = loads
        reason = 'load'
      } else reason = rev !== lastRev ? 'edit' : 'runtime'
      lastRev = rev
      trigger(reason)
    }),
  )
  unsubs.push(
    useLab.subscribe((s, prev) => {
      if (s.workspace !== prev.workspace) chromeCheck()
      if (s.firmware === prev.firmware) return
      const rev = revisionNow()
      // a record's details are not the image a board runs; a board flashed again is (the same file)
      if (rev === lastRev && !flashed(prev.firmware, s.firmware)) return
      lastRev = rev
      trigger('firmware')
    }),
  )
  unsubs.push(onSimHostEvent((e) => (e.kind === 'reset' ? trigger('reset') : undefined)))
  unsubs.push(onAutoRunRelease(() => (pending !== null ? schedule() : undefined)))
  unsubs.push(onAutoRunGateChange(updateWaiting))
  unsubs.push(onLangChange(chromeCheck))
  try {
    const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WORKSPACE_MEDIA_QUERY) : null
    if (mq && typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', chromeCheck)
      unsubs.push(() => mq.removeEventListener('change', chromeCheck))
    }
  } catch {
    /* no media queries: the language and the workspace toggle still tell */
  }

  // the first start: once the lab's restore is done — or after BOOT_TIMEOUT_MS whatever it does
  const boot = (): void => {
    if (stopped || booted) return
    booted = true
    clearTimeout(bootTimer)
    updateWaiting()
    trigger('boot')
  }
  const bootTimer = setTimeout(boot, opts.bootTimeoutMs ?? BOOT_TIMEOUT_MS)
  updateWaiting()
  ready()
    .catch(() => undefined)
    .then(boot)

  return () => {
    if (stopped) return
    stopped = true
    installed--
    if (activeEnabled === enabled) activeEnabled = null
    clearTimeout(bootTimer)
    if (timer !== null) clearTimeout(timer)
    timer = null
    for (const u of unsubs) u()
    setWaiting(false)
  }
}

/** auto-run installs alive (tests). */
export function autoRunInstallCount(): number {
  return installed
}
