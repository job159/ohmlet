/**
 * Toast.tsx — <ToastHost/>: mounts once near the app root and renders the
 * showToast() queue (toasts.ts) as small glass pills centered above the dock.
 * Material: the rim+specular tier (DESIGN.md §1) — each pill wears the
 * bent-light rim ring (lg-rim) and registers with the shared specular
 * tracker, but takes NO backdrop-filter (toasts stack 2-3 deep and would
 * otherwise blow the ≤4 concurrent-filter budget, §7). Pills spring in
 * (transform/opacity keyframes), auto-dismiss after their duration, and fade
 * out through a short leave transition. The host is pointer-transparent —
 * toasts never block the canvas; only an actionable toast's trailing label
 * (ToastOptions.action — 「查看原因」) takes the pointer. While the pointer or
 * the keyboard focus rests on that label the toast holds; it closes when
 * the action runs.
 *
 * `wide` lets a pill use the full toast width on narrow screens (the host
 * is centred with left: 50%, so a shrink-to-fit pill would otherwise wrap
 * at half the viewport); the classic chrome keeps the original pills.
 *
 * Usage:
 *   <ToastHost />            // once, in App
 *   showToast('Saved')       // anywhere
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSpecular } from './glass'
import { pressProps } from './PressableButton'
import { tick } from './haptics'
import { dismissToast, getToasts, subscribeToasts, type ToastItem } from './toasts'

const LEAVE_MS = 220 // matches .lg-toast transition
/** a held actionable toast lingers this long after the pointer / focus leaves its action */
const RELEASE_MS = 2400

/**
 * Key names inside a toast line render as small keycaps (<kbd>): 「· Esc
 * 結束」, 「Shift+R 旋轉」 (product chrome), 「R 旋轉」 (classic). Whole tokens
 * only; a lone R / F only right before the action it names (「R 旋轉」,
 * "R rotates") so part / pin names never match.
 */
const KEY_TOKEN = /(?<![\w+\-])(Shift\+R(?= (?:旋轉|rotates))|Esc|Enter|Space|Shift|Ctrl|Cmd|Delete|F10|F5|R(?= (?:旋轉|rotates)))(?![\w+\-])/g

/** Toast text with its key names as keycaps (plain string when there are none). */
export function toastTextNodes(text: string): ReactNode {
  KEY_TOKEN.lastIndex = 0
  if (!KEY_TOKEN.test(text)) return text
  KEY_TOKEN.lastIndex = 0
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(KEY_TOKEN)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    out.push(
      <kbd key={at} className="lg-kbd">
        {m[0]}
      </kbd>,
    )
    last = at + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** One glass pill: bent-light rim + tracked specular sheen (no blur). */
function ToastPill({ leaving, actionable = false, children }: { leaving: boolean; actionable?: boolean; children: ReactNode }) {
  const specRef = useSpecular<HTMLDivElement>()
  return (
    <div ref={specRef} className={`lg-toast lg-rim ${leaving ? 'is-leaving' : ''}${actionable ? ' has-action' : ''}`}>
      {children}
    </div>
  )
}

export function ToastHost({ wide = false }: { wide?: boolean } = {}) {
  const [items, setItems] = useState<readonly ToastItem[]>(getToasts)
  const [leaving, setLeaving] = useState<readonly ToastItem[]>([])
  const prevRef = useRef<readonly ToastItem[]>(getToasts())
  const timersRef = useRef(new Map<number, number>())

  // mirror the store; keep removed toasts around briefly for the fade-out
  useEffect(() => {
    const unsub = subscribeToasts((next) => {
      const prev = prevRef.current
      prevRef.current = next
      const gone = prev.filter((p) => !next.some((n) => n.id === p.id))
      if (gone.length > 0) {
        setLeaving((l) => [...l, ...gone.filter((g) => !l.some((x) => x.id === g.id))])
        for (const g of gone) {
          window.setTimeout(() => {
            setLeaving((l) => l.filter((x) => x.id !== g.id))
          }, LEAVE_MS)
        }
      }
      setItems(next)
    })
    return unsub
  }, [])

  // one auto-dismiss timer per live toast (none while its action is held)
  const heldRef = useRef(new Set<number>())
  const arm = (id: number, ms: number) => {
    const timers = timersRef.current
    timers.set(
      id,
      window.setTimeout(() => {
        timers.delete(id)
        dismissToast(id)
      }, ms),
    )
  }
  useEffect(() => {
    const timers = timersRef.current
    for (const t of items) {
      if (!timers.has(t.id) && !heldRef.current.has(t.id)) arm(t.id, t.duration)
    }
  }, [items])
  /** the pointer / focus rests on a toast's action: it stays */
  const hold = (id: number) => {
    heldRef.current.add(id)
    const timer = timersRef.current.get(id)
    if (timer != null) window.clearTimeout(timer)
    timersRef.current.delete(id)
  }
  /** …and lingers RELEASE_MS once it leaves */
  const release = (id: number) => {
    if (!heldRef.current.delete(id)) return
    if (getToasts().some((t) => t.id === id)) arm(id, RELEASE_MS)
  }
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const id of timers.values()) window.clearTimeout(id)
      timers.clear()
    }
  }, [])

  if (typeof document === 'undefined') return null
  const visible = [...items, ...leaving].sort((a, b) => a.id - b.id)
  if (visible.length === 0) return null

  return createPortal(
    <div className={`lg-toast-host${wide ? ' is-wide' : ''}`} role="status" aria-live="polite">
      {visible.map((t) => {
        const isLeaving = leaving.some((l) => l.id === t.id)
        const action = t.action
        return (
          <ToastPill key={t.id} leaving={isLeaving} actionable={!!action}>
            {t.icon}
            <span>{toastTextNodes(t.text)}</span>
            {action && (
              <button
                type="button"
                // lg-hit: a ≥ 44 px touch target even on a one-line pill
                className="lg-toast-action lg-pressable lg-hit"
                tabIndex={isLeaving ? -1 : 0}
                {...pressProps}
                onPointerEnter={() => hold(t.id)}
                onPointerLeave={(e) => {
                  pressProps.onPointerLeave(e)
                  release(t.id)
                }}
                onFocus={() => hold(t.id)}
                onBlur={() => release(t.id)}
                onClick={() => {
                  if (isLeaving) return
                  tick()
                  heldRef.current.delete(t.id)
                  dismissToast(t.id)
                  action.run()
                }}
              >
                {action.label}
              </button>
            )}
          </ToastPill>
        )
      })}
    </div>,
    document.body,
  )
}
