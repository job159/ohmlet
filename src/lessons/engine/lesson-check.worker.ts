/**
 * Module Worker entry: evaluates lesson checks off the main thread (the
 * 'measure' / 'uart-contains' / 'firmware-checks' / 'erc-clean' kinds run
 * real firmware for simulated seconds). Spawned by runLessonChecks() in
 * ./run.ts exactly like src/llm/verify.worker.ts:
 *   new Worker(new URL('./lesson-check.worker.ts', import.meta.url), { type: 'module' })
 * Protocol: one LessonCheckRequest in → any number of 'progress' messages →
 * one 'done' or 'error' message out (all structured-clone safe).
 */
import { setLang } from '../../i18n'
import { prefetchedAssets } from './assets'
import { evaluateChecks } from './evaluate'
import type { LessonCheckMessage, LessonCheckRequest } from './run'

// tsconfig uses the DOM lib (no WebWorker lib): type the worker global scope
// through the structural Worker interface (onmessage / postMessage shapes).
const ctx = self as unknown as Worker

ctx.onmessage = (e: MessageEvent<LessonCheckRequest>) => {
  const req = e.data
  const post = (m: LessonCheckMessage) => ctx.postMessage(m)
  // details are written in the UI language of the page that asked
  setLang(req.lang)
  // ≤ ~25 progress messages per second (a new check always reports at once)
  let lastAt = 0
  let lastIndex = -1
  evaluateChecks(req.input, req.checks, {
    assets: prefetchedAssets(req.assets),
    onProgress: (progress) => {
      const at = performance.now()
      if (progress.index === lastIndex && at - lastAt < 40) return
      lastAt = at
      lastIndex = progress.index
      post({ kind: 'progress', progress })
    },
  }).then(
    (results) => post({ kind: 'done', results }),
    (err: unknown) => post({ kind: 'error', error: err instanceof Error ? err.message : String(err) }),
  )
}
