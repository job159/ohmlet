/**
 * toasts.ts — imperative toast API. Call showToast() from anywhere (store
 * actions, event handlers); <ToastHost/> (Toast.tsx) renders the queue as
 * small glass pills above the dock. At most 2 toasts are queued — older
 * ones are pushed out gracefully.
 *
 * Usage:
 *   showToast('Wire connected')
 *   showToast('LED burned out', { duration: 3500, icon: <BoltIcon size={16}/> })
 *   showToast('3 / 5 項通過', { action: { label: '查看原因', run: openReasons } })
 *
 * A toast with an `action` ends in one tappable label (the only part of the
 * pill that takes the pointer — the rest stays click-through), stays at
 * least ACTION_MIN_MS, holds while the pointer or the focus is on its
 * action, and closes when the action runs.
 */
import type { ReactNode } from 'react'

/** One thing to do about the toast's news: 「查看原因」, 「仍要再放一支」. */
export interface ToastAction {
  /** Short, action-first label, already in the UI language. */
  label: string
  run(): void
}

export interface ToastOptions {
  /** Auto-dismiss after this many ms. Default 2200 (an actionable toast: at least ACTION_MIN_MS). */
  duration?: number
  /** Optional leading icon (kit icon, ~16px). */
  icon?: ReactNode
  /** Optional trailing action (one per toast). */
  action?: ToastAction
}

export interface ToastItem {
  id: number
  text: string
  icon?: ReactNode
  duration: number
  action?: ToastAction
}

/** An actionable toast stays long enough to read it and reach its action. */
export const ACTION_MIN_MS = 5000

type Listener = (toasts: readonly ToastItem[]) => void

const MAX_TOASTS = 2
let queue: readonly ToastItem[] = []
const listeners = new Set<Listener>()
let nextId = 1

function emit() {
  for (const fn of listeners) fn(queue)
}

/** Show a toast pill. Returns its id (usable with dismissToast). */
export function showToast(text: string, opts: ToastOptions = {}): number {
  const duration = opts.duration ?? 2200
  const item: ToastItem = {
    id: nextId++,
    text,
    icon: opts.icon,
    duration: opts.action ? Math.max(duration, ACTION_MIN_MS) : duration,
  }
  if (opts.action) item.action = opts.action
  queue = [...queue, item].slice(-MAX_TOASTS)
  emit()
  return item.id
}

/** Remove a toast early (auto-dismiss calls this for you). */
export function dismissToast(id: number): void {
  if (!queue.some((t) => t.id === id)) return
  queue = queue.filter((t) => t.id !== id)
  emit()
}

/** Current queue snapshot (stable reference between changes). */
export function getToasts(): readonly ToastItem[] {
  return queue
}

/** Subscribe to queue changes; fires immediately with the current queue. */
export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn)
  fn(queue)
  return () => {
    listeners.delete(fn)
  }
}
