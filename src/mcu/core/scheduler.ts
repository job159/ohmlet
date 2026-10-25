/**
 * Deterministic discrete-event queue keyed by core cycle (binary min-heap,
 * FIFO among equal cycles). See Scheduler in ./types.
 */
import type { EventHandle, Scheduler } from './types'

interface Ev {
  at: number
  seq: number
  id: number
  fn: (cycle: number) => void
}

export class EventQueue implements Scheduler {
  private heap: Ev[] = []
  private seq = 0
  private nextId = 1
  /** ids cancelled while still in the heap (lazy deletion) */
  private cancelled = new Set<number>()

  schedule(atCycle: number, fn: (cycle: number) => void): EventHandle {
    const id = this.nextId++
    const ev: Ev = { at: atCycle, seq: this.seq++, id, fn }
    const h = this.heap
    h.push(ev)
    let i = h.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (less(h[p], ev)) break
      h[i] = h[p]
      i = p
    }
    h[i] = ev
    return id
  }

  cancel(h: EventHandle): void {
    if (h > 0) this.cancelled.add(h)
  }

  nextAt(): number {
    this.dropCancelledTop()
    return this.heap.length > 0 ? this.heap[0].at : Infinity
  }

  runDue(cycle: number): void {
    for (;;) {
      this.dropCancelledTop()
      const h = this.heap
      if (h.length === 0 || h[0].at > cycle) return
      const ev = this.pop()
      ev.fn(ev.at)
    }
  }

  clear(): void {
    this.heap.length = 0
    this.cancelled.clear()
  }

  get size(): number {
    return this.heap.length - this.cancelled.size
  }

  private dropCancelledTop(): void {
    const h = this.heap
    while (h.length > 0 && this.cancelled.has(h[0].id)) {
      this.cancelled.delete(h[0].id)
      this.pop()
    }
  }

  private pop(): Ev {
    const h = this.heap
    const top = h[0]
    const last = h.pop() as Ev
    if (h.length > 0) {
      let i = 0
      const n = h.length
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && less(h[r], h[l]) ? r : l
        if (less(last, h[c])) break
        h[i] = h[c]
        i = c
      }
      h[i] = last
    }
    return top
  }
}

function less(a: Ev, b: Ev): boolean {
  return a.at < b.at || (a.at === b.at && a.seq < b.seq)
}
