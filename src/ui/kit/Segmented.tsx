/**
 * Segmented — iOS segmented control. Glass track, sliding selection thumb.
 * The thumb is measured from the selected segment (offsetLeft/offsetWidth)
 * and animated purely via transform; widths are committed without animation.
 * Generic over the string values it selects between.
 *
 * Accessible: role="radiogroup"; Left/Right arrows move the selection and,
 * when a segment has the focus, the focus with it (roving focus — the ring
 * never stays on the old, unselected segment; Enter never re-selects it).
 *
 * Usage:
 *   <Segmented value={speed} onChange={setSpeed} options={[
 *     { value: '0.1x', label: '0.1×' },
 *     { value: '1x', label: '1×' },
 *     { value: '10x', label: '10×' },
 *   ]} aria-label="Sim speed" />
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { tick } from './haptics'
import { releaseAfterPointerClick } from './focus'
import { useLang } from '../../i18n'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Haptic tick on selection change (default true). */
  haptic?: boolean
  'aria-label'?: string
  className?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  haptic = true,
  className,
  ...aria
}: SegmentedProps<T>) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const firstPaintRef = useRef(true)
  // the segment an arrow just selected: it takes the focus once it shows as selected
  const focusNextRef = useRef<T | null>(null)
  // segment labels change width with the language: re-measure the thumb
  const lang = useLang()

  useLayoutEffect(() => {
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!track || !thumb) return
    const measure = () => {
      const selected = track.querySelector<HTMLElement>('[aria-checked="true"]')
      if (!selected) {
        thumb.style.opacity = '0'
        return
      }
      thumb.style.opacity = '1'
      thumb.style.width = `${selected.offsetWidth}px`
      const t = `translate3d(${selected.offsetLeft}px, 0, 0)`
      if (firstPaintRef.current) {
        // land instantly on mount — no slide-in from x=0
        const prev = thumb.style.transition
        thumb.style.transition = 'none'
        thumb.style.transform = t
        void thumb.offsetWidth // flush so the next change animates
        thumb.style.transition = prev
        firstPaintRef.current = false
      } else {
        thumb.style.transform = t
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(track)
    return () => ro.disconnect()
  }, [value, options.length, lang])

  const select = (v: T) => {
    if (v !== value) {
      if (haptic) tick()
      onChange(v)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const enabled = options.filter((o) => !o.disabled)
    const idx = enabled.findIndex((o) => o.value === value)
    if (idx < 0) return
    const next = enabled[idx + (e.key === 'ArrowRight' ? 1 : -1)]
    if (!next) return
    // roving focus: only when the focus is on a segment (an arrow on the group itself stays there)
    const active = typeof document !== 'undefined' ? document.activeElement : null
    if (active && active !== trackRef.current && trackRef.current?.contains(active)) focusNextRef.current = next.value
    select(next.value)
  }

  // …the segment the arrow selected takes the focus once it is the selected one
  // (a parent that refuses the change leaves the focus where it was)
  useLayoutEffect(() => {
    const want = focusNextRef.current
    focusNextRef.current = null
    if (want === null || want !== value) return
    const i = options.findIndex((o) => o.value === value)
    trackRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[i]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={aria['aria-label']}
      className={`lg-seg ${className ?? ''}`}
      onKeyDown={onKeyDown}
    >
      <div ref={thumbRef} className="lg-seg-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          className="lg-seg-item lg-hit"
          tabIndex={o.value === value ? 0 : -1}
          onPointerDown={(e) => {
            e.currentTarget.dataset.pressed = 'true'
          }}
          onPointerUp={(e) => {
            delete e.currentTarget.dataset.pressed
          }}
          onPointerCancel={(e) => {
            delete e.currentTarget.dataset.pressed
          }}
          onPointerLeave={(e) => {
            delete e.currentTarget.dataset.pressed
          }}
          onClick={(e) => {
            select(o.value)
            releaseAfterPointerClick(e) // a clicked radio keeps its focus (focus.ts); Space still runs / pauses (keys.ts)
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
