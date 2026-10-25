/**
 * runLessonChecks(): evaluate lesson checks in a Module Worker (the browser
 * main thread never runs simulated seconds of firmware), with progress and
 * cancellation; falls back to the inline evaluator when Workers are
 * unavailable (node, tests) or the worker cannot start (CSP) — the inline
 * path yields to the event loop every few milliseconds.
 *
 * The assets a run needs (bundled firmware images, firmware contracts) are
 * loaded HERE on the calling thread and handed to the worker, which cannot
 * fetch the dev-server asset URLs itself.
 */
import { lang, t, type Lang } from '../../i18n'
import type { LessonCheck } from '../types'
import { collectAssets, prefetchedAssets, type AssetBundle, type EvalAssets } from './assets'
import { EvalCancelledError, evaluateChecks, type EvalInput, type EvalProgress, type EvaluatedCheck } from './evaluate'

/** postMessage payload the lesson-check worker receives. */
export interface LessonCheckRequest {
  input: EvalInput
  checks: LessonCheck[]
  assets: AssetBundle
  lang: Lang
}

/** Messages the worker posts back. */
export type LessonCheckMessage =
  | { kind: 'progress'; progress: EvalProgress }
  | { kind: 'done'; results: EvaluatedCheck[] }
  | { kind: 'error'; error: string }

export interface RunLessonChecksOptions {
  onProgress?: (p: EvalProgress) => void
  signal?: AbortSignal
  /** asset source on the calling thread (default: firmware/dist + manifest) */
  assets?: EvalAssets
  /** false = always inline (tests / diagnostics) */
  worker?: boolean
}

function inline(
  input: EvalInput,
  checks: readonly LessonCheck[],
  bundle: AssetBundle,
  opts: RunLessonChecksOptions,
): Promise<EvaluatedCheck[]> {
  return evaluateChecks(input, checks, {
    assets: prefetchedAssets(bundle),
    onProgress: opts.onProgress,
    signal: opts.signal,
  })
}

/** Evaluate `checks` on `input`; rejects with EvalCancelledError when `signal` aborts. */
export async function runLessonChecks(
  input: EvalInput,
  checks: readonly LessonCheck[],
  opts: RunLessonChecksOptions = {},
): Promise<EvaluatedCheck[]> {
  const { signal } = opts
  if (signal?.aborted) throw new EvalCancelledError()
  const bundle = await collectAssets(checks, opts.assets)
  if (signal?.aborted) throw new EvalCancelledError()

  if (opts.worker === false || typeof Worker === 'undefined') return inline(input, checks, bundle, opts)

  let worker: Worker
  try {
    worker = new Worker(new URL('./lesson-check.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return inline(input, checks, bundle, opts) // blocked (CSP, exotic embedder)
  }

  return new Promise<EvaluatedCheck[]>((resolve, reject) => {
    let settled = false
    let started = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      fn()
    }
    const onAbort = () => finish(() => reject(new EvalCancelledError()))
    signal?.addEventListener('abort', onAbort)
    worker.onmessage = (e: MessageEvent<LessonCheckMessage>) => {
      started = true
      const m = e.data
      if (!m || settled) return
      if (m.kind === 'progress') opts.onProgress?.(m.progress)
      else if (m.kind === 'done') finish(() => resolve(m.results))
      else finish(() => reject(new Error(m.error)))
    }
    worker.onerror = () => {
      // the worker script itself failed before answering: evaluate inline instead
      if (!started) {
        finish(() => {
          inline(input, checks, bundle, opts).then(resolve, reject)
        })
      } else {
        finish(() => reject(new Error(t('The lesson check stopped unexpectedly.'))))
      }
    }
    const request: LessonCheckRequest = { input, checks: [...checks], assets: bundle, lang: lang() }
    worker.postMessage(request)
  })
}
