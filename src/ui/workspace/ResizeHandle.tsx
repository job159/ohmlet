/**
 * Panel resize handle (pointer capture). While dragging, the size is written
 * straight to the body's CSS custom property (`--ws-left-w` …) — every
 * dependent surface (panels, tray, toasts, pills) re-flows from that one
 * variable with zero React renders — and committed to the lab store
 * (lab.setWorkspace → persisted) on release. Keyboard: the handle is an
 * ARIA separator; ←/→ (↑/↓ for the tray) resize in 16 px steps, Home/End
 * jump to the limits, Enter/double-click restores the default size.
 */
import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

export interface ResizeHandleProps {
  /** which way the size grows when the pointer moves right/down (+1) or left/up (−1) */
  axis: 'x' | 'y'
  sign: 1 | -1
  value: number
  min: number
  max: number
  defaultValue: number
  cssVar: string
  label: string
  onCommit: (value: number) => void
  className?: string
}

const STEP = 16

export function ResizeHandle({
  axis,
  sign,
  value,
  min,
  max,
  defaultValue,
  cssVar,
  label,
  onCommit,
  className,
}: ResizeHandleProps) {
  const drag = useRef<{ id: number; start: number; from: number; last: number } | null>(null)
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)))
  const write = (v: number) => document.body.style.setProperty(cssVar, `${v}px`)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, start: axis === 'x' ? e.clientX : e.clientY, from: value, last: value }
    document.body.classList.add('ws-resizing', axis === 'x' ? 'ws-resizing-x' : 'ws-resizing-y')
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const pos = axis === 'x' ? e.clientX : e.clientY
    const v = clamp(d.from + sign * (pos - d.start))
    if (v !== d.last) {
      d.last = v
      write(v)
    }
  }
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    document.body.classList.remove('ws-resizing', 'ws-resizing-x', 'ws-resizing-y')
    if (d.last !== d.from) onCommit(d.last)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = axis === 'x' ? (sign > 0 ? 'ArrowRight' : 'ArrowLeft') : sign > 0 ? 'ArrowDown' : 'ArrowUp'
    const shrink = axis === 'x' ? (sign > 0 ? 'ArrowLeft' : 'ArrowRight') : sign > 0 ? 'ArrowUp' : 'ArrowDown'
    let next: number | null = null
    if (e.key === grow) next = clamp(value + STEP)
    else if (e.key === shrink) next = clamp(value - STEP)
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    else if (e.key === 'Enter') next = clamp(defaultValue)
    if (next === null) return
    e.preventDefault()
    e.stopPropagation() // never let App's arrow-key nudge see this
    if (next !== value) {
      write(next)
      onCommit(next)
    }
  }

  return (
    <div
      className={`ws-resize ws-resize-${axis} ${className ?? ''}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => {
        const v = clamp(defaultValue)
        write(v)
        onCommit(v)
      }}
      onKeyDown={onKeyDown}
    >
      <span className="ws-resize-grip" aria-hidden="true" />
    </div>
  )
}
