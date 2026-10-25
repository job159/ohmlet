/**
 * Anchored settings popover of the instrument toolbars (UX IS-5): the full
 * decoder / trigger editors open here, over the page, so they never push
 * the waveform out of a short tray. Tier-S surface (the UndoPill / probe
 * menu recipe in instruments.css — NO backdrop-filter, the glass budget is
 * untouched), portalled to <body>, placed under its chip or above it when
 * the chip sits low (the tray lives at the bottom of the screen), clamped to
 * the viewport with an 8 px margin before paint. Esc, a press outside or a
 * window resize close it; focus moves in on open and back to the
 * chip on close.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './instruments.css'

const MARGIN = 8
const GAP = 6

export function Popover({
  anchor,
  open,
  onClose,
  label,
  children,
  width,
}: {
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  label: string
  children: ReactNode
  /** preferred width (px); clamped to the viewport */
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // place before paint (and again when the content changes size)
  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPos(null)
      return
    }
    const el = ref.current
    if (!el) return
    const place = () => {
      const a = anchor.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const below = vh - a.bottom - GAP - MARGIN
      const above = a.top - GAP - MARGIN
      const up = r.height > below && above > below
      const top = up ? Math.max(MARGIN, a.top - GAP - r.height) : Math.min(vh - MARGIN - r.height, a.bottom + GAP)
      const left = Math.max(MARGIN, Math.min(vw - MARGIN - r.width, a.left))
      setPos((p) => (p && p.left === left && p.top === top && p.up === up ? p : { left, top, up }))
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, anchor])

  // focus in on open, back to the chip on close
  useEffect(() => {
    if (!open) return
    const el = ref.current
    const first = el?.querySelector<HTMLElement>('select, button, input, [tabindex]:not([tabindex="-1"])')
    first?.focus({ preventScroll: true })
    return () => {
      if (anchor && document.contains(anchor)) anchor.focus({ preventScroll: true })
    }
  }, [open, anchor])

  // dismissal
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      }
    }
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (ref.current?.contains(target) || anchor?.contains(target)) return
      closeRef.current()
    }
    // (no window 'blur': a native <select> list inside the popover may blur it)
    const onResize = () => closeRef.current()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, anchor])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={ref}
      className={`lai-pop ${pos?.up ? 'is-up' : ''}`}
      role="dialog"
      aria-label={label}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
        width: width ? `min(${width}px, calc(100vw - ${2 * MARGIN}px))` : undefined,
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  )
}
