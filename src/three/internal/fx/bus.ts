/**
 * FX event bus (owner: vivid) — the one way UI code asks the mounted 3D
 * scene for a one-shot effect, without holding a scene reference:
 *
 *   emitSceneFx({ type: 'celebrate', kind, componentIds })   (src/ui/fx/celebrate.ts)
 *   onSceneFx(listener) → unsubscribe                        (BreadboardScene.mount)
 *
 * Module-level, no React, no three.js import (safe in node tests). A scene
 * that is not mounted simply misses the event — effects are decoration on
 * top of state the UI already shows, never the only signal.
 */

export type SceneFxEvent =
  | {
      type: 'celebrate'
      /** 'lesson-pass' = the big confetti burst; 'circuit-ok' = a short sparkle along the active parts */
      kind: 'lesson-pass' | 'circuit-ok'
      /** parts the effect gathers around (empty = the whole circuit) */
      componentIds: string[]
      /**
       * a screen area (viewport CSS px) the effect must not burst from —
       * where the 「完成！」 badge sits, so the confetti is never hidden behind it
       */
      avoid?: ScreenRect
    }

/** A rectangle in viewport CSS pixels. */
export interface ScreenRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

type Listener = (e: SceneFxEvent) => void

const listeners = new Set<Listener>()

/** Subscribe (the mounted scene); returns the unsubscribe function. */
export function onSceneFx(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Fire one effect at every mounted scene (no-op when none listens). */
export function emitSceneFx(e: SceneFxEvent): void {
  for (const l of [...listeners]) {
    try {
      l(e)
    } catch (err) {
      console.error('scene fx listener failed', err)
    }
  }
}

/** Number of listening scenes (tests). */
export function sceneFxListenerCount(): number {
  return listeners.size
}
