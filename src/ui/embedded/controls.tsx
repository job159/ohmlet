/**
 * Small toolbar controls for the instrument views (terminal, logic
 * analyzer, log) — the same glass vocabulary as the kit: capsule chips
 * with the nested-glass slab (toggles go blue when on, like the Parts
 * sheet's category chips), a native <select> dressed as a recessed capsule
 * well (real keyboard / screen-reader semantics for free), and round icon
 * buttons with the gel press.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { pressProps, releaseAfterPointerClick, tick } from '../kit'
import { t, useLang } from '../../i18n'
import type { HighlightSpec } from '../../three/scene-api'
import { highlightSource } from '../workspace/scene-bridge'
import { glossaryText, type GlossaryId } from './glossary'
import './embedded.css'
import './inspector.css'
import './latch.css'

export function ToggleChip({
  pressed,
  onChange,
  children,
  title,
  disabled,
}: {
  pressed: boolean
  onChange: (next: boolean) => void
  children: ReactNode
  title?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="emb-chip lg-gel"
      aria-pressed={pressed}
      title={title}
      disabled={disabled}
      {...pressProps}
      onClick={() => {
        tick()
        onChange(!pressed)
      }}
    >
      {children}
    </button>
  )
}

/** The latch's padlock: closed while kept pressed, open otherwise (the 3D badge's glyph). */
function LatchLockIcon({ closed }: { closed: boolean }) {
  return (
    <svg className="latch-toggle-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={closed ? 'M5 7V5.2a3 3 0 0 1 6 0V7' : 'M5 7V5.2a3 3 0 0 1 5.8-1.1'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <rect x="3.2" y="7" width="9.6" height="7" rx="1.8" fill="currentColor" />
    </svg>
  )
}

/**
 * 「保持按下」 — the keep-pressed latch toggle beside the inspector's 按住
 * puck (src/ui/embedded/latch.ts): a capsule switch. On = filled blue with a
 * closed padlock (the part stays pressed until it is turned off — the 3D
 * lock badge's colour and glyph); off = glass with an open padlock.
 */
export function LatchToggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  useLang()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`latch-toggle lg-gel${on ? ' is-on' : ''}`}
      title={on ? t('Kept pressed — turn off to release|latch') : t('Keep it pressed until you turn this off|latch')}
      {...pressProps}
      onClick={(e) => {
        tick(on ? 8 : 16)
        onChange(!on)
        releaseAfterPointerClick(e)
      }}
    >
      <LatchLockIcon closed={on} />
      <span className="latch-toggle-text">{t('Keep pressed|latch')}</span>
    </button>
  )
}

export function ChipButton({
  onClick,
  children,
  title,
  disabled,
  destructive,
  accent,
  'aria-label': ariaLabel,
  'aria-keyshortcuts': ariaKeyshortcuts,
}: {
  onClick: () => void
  children: ReactNode
  title?: string
  disabled?: boolean
  destructive?: boolean
  /** the primary action of a row (blue tint) */
  accent?: boolean
  'aria-label'?: string
  /** the key that does the same (UX helper H6 withKey) */
  'aria-keyshortcuts'?: string
}) {
  return (
    <button
      type="button"
      className={`emb-chip lg-gel ${destructive ? 'is-destructive' : ''} ${accent ? 'is-accent' : ''}`}
      title={title}
      aria-label={ariaLabel}
      aria-keyshortcuts={ariaKeyshortcuts}
      disabled={disabled}
      {...pressProps}
      onClick={(e) => {
        onClick()
        // a clicked chip keeps no focus ring and no claim on Space (SH-9; the host enables it in the new chrome)
        releaseAfterPointerClick(e)
      }}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Hover → the board (UX helper H7 highlightSource)
// ---------------------------------------------------------------------------

/** Did a hover below put the neutral source marker up (and so owns clearing it)? */
let sourceHoverOn = false

/**
 * Pointer props for a row or chip that names a place on the board (a pin
 * row, a problem's 「U1 PA5」 chip): while a MOUSE rests on it, the scene
 * marks `spec` with its calm hover marker — never a camera move, no per-frame
 * work (one call on enter, one on leave). Touch ignores it (no hover there).
 */
export function sourceHoverProps(spec: HighlightSpec | null): {
  onPointerEnter?: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerLeave?: (e: ReactPointerEvent<HTMLElement>) => void
} {
  if (!spec || ((spec.holes?.length ?? 0) === 0 && (spec.components?.length ?? 0) === 0)) return {}
  return {
    onPointerEnter: (e) => {
      if (e.pointerType !== 'mouse') return
      sourceHoverOn = highlightSource(spec)
    },
    onPointerLeave: () => releaseSourceHover(),
  }
}

/** Clear the hover marker a sourceHoverProps row put up (its row left, or unmounted under the pointer). */
export function releaseSourceHover(): void {
  if (!sourceHoverOn) return
  sourceHoverOn = false
  highlightSource(null)
}

/** For a list of hover rows: clear their marker when the list unmounts while the pointer rests on a row. */
export function useSourceHoverRelease(): void {
  useEffect(() => () => releaseSourceHover(), [])
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectGroup {
  label: string
  options: SelectOption[]
}

export function SelectField({
  value,
  onChange,
  options,
  groups,
  'aria-label': ariaLabel,
  className,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  options?: SelectOption[]
  groups?: SelectGroup[]
  'aria-label': string
  className?: string
  disabled?: boolean
}) {
  return (
    <span className={`emb-select ${className ?? ''}`}>
      <select
        value={value}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(e) => {
          tick()
          onChange(e.target.value)
        }}
      >
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {groups?.map((g) =>
          g.options.length > 0 ? (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
      </select>
      <svg
        className="emb-select-chev"
        width="12"
        height="12"
        viewBox="0 0 13 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3.5 5 6.5 2l3 3M3.5 8l3 3 3-3" />
      </svg>
    </span>
  )
}

export function IconButton({
  onClick,
  children,
  'aria-label': ariaLabel,
  title,
  disabled,
  pressed,
  'aria-expanded': expanded,
}: {
  onClick: () => void
  children: ReactNode
  'aria-label': string
  title?: string
  disabled?: boolean
  pressed?: boolean
  'aria-expanded'?: boolean
}) {
  return (
    <button
      type="button"
      className="emb-icon-btn lg-pressable"
      aria-label={ariaLabel}
      aria-pressed={pressed}
      aria-expanded={expanded}
      title={title ?? ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Tier-S popover (UX wave: glossary terms, the ERC "what is this?" note, the
// built-in firmware picker). Portalled to <body>, positioned at its anchor
// and clamped to the viewport before paint; the UndoPill / probe-menu
// recipe — near-opaque gradient + inset slab shadows, NO backdrop-filter
// (the dock, capsule and panels hold the ≤ 4 filter / ≤ 3 lens budget).
// ---------------------------------------------------------------------------

export interface PopoverProps {
  anchor: HTMLElement | null
  onClose: () => void
  children: ReactNode
  className?: string
  id?: string
  role?: 'dialog' | 'tooltip'
  'aria-label'?: string
  /** align the popover's start or end edge with the anchor's (default start) */
  align?: 'start' | 'end'
  /** hover popovers: keep them open while the pointer is over them */
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

interface PopoverPos {
  top: number
  left: number
  maxHeight: number
  below: boolean
}

const POP_MARGIN = 8

export function Popover({
  anchor,
  onClose,
  children,
  className,
  id,
  role = 'dialog',
  'aria-label': ariaLabel,
  align = 'start',
  onPointerEnter,
  onPointerLeave,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<PopoverPos | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // place below the anchor (above when there is clearly more room there),
  // start- or end-aligned, clamped to the viewport; re-placed on scroll /
  // resize so it follows a scrolling inspector
  useLayoutEffect(() => {
    if (!anchor) return
    let raf = 0
    const place = () => {
      raf = 0
      const el = ref.current
      if (!el || !anchor.isConnected) return
      const a = anchor.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const w = el.offsetWidth
      const h = el.scrollHeight
      const roomBelow = vh - a.bottom - POP_MARGIN - 6
      const roomAbove = a.top - POP_MARGIN - 6
      const below = roomBelow >= Math.min(h, 260) || roomBelow >= roomAbove
      const maxHeight = Math.max(120, below ? roomBelow : roomAbove)
      const height = Math.min(h, maxHeight)
      const top = below ? a.bottom + 6 : a.top - 6 - height
      const raw = align === 'end' ? a.right - w : a.left
      const left = Math.min(Math.max(POP_MARGIN, raw), Math.max(POP_MARGIN, vw - POP_MARGIN - w))
      setPos((p) =>
        p && p.top === top && p.left === left && p.maxHeight === maxHeight && p.below === below
          ? p
          : { top, left, maxHeight, below },
      )
    }
    place()
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(place)
    }
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    if (ro && ref.current) ro.observe(ref.current)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      ro?.disconnect()
    }
  }, [anchor, align])

  // outside press / Escape close (Escape never also clears the selection)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (ref.current?.contains(target) || anchor?.contains(target)) return
      closeRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      closeRef.current()
      anchor?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [anchor])

  if (typeof document === 'undefined') return null
  const style: CSSProperties = pos
    ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight }
    : { top: -10000, left: -10000, visibility: 'hidden' }
  return createPortal(
    <div
      ref={ref}
      id={id}
      role={role}
      aria-label={ariaLabel}
      className={`insp-pop ${pos && !pos.below ? 'is-above' : ''} ${className ?? ''}`}
      style={style}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      // arrows / Space / Delete inside never reach the app's global shortcuts
      onKeyDown={(e: ReactKeyboardEvent) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  )
}

/**
 * A technical term with a plain-language explanation (IN-9): dotted
 * underline + ⓘ; hover (fine pointer, after a short delay) or click / tap /
 * Enter shows a Tier-S popover with the full name and 1–2 sentences.
 */
export function Term({ id, children, className }: { id: GlossaryId; children: ReactNode; className?: string }) {
  useLang()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pinned = useRef(false)
  const popId = useId()
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clear, [])
  const hoverOpen = () => {
    clear()
    timer.current = setTimeout(() => setOpen(true), 380)
  }
  const hoverClose = () => {
    clear()
    if (pinned.current) return
    timer.current = setTimeout(() => setOpen(false), 160)
  }
  const g = glossaryText(id)
  return (
    <>
      <button
        type="button"
        ref={setAnchor}
        className={`insp-term ${className ?? ''}`}
        aria-expanded={open}
        aria-describedby={open ? popId : undefined}
        onClick={(e) => {
          e.stopPropagation()
          clear()
          pinned.current = !open
          setOpen(!open)
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') hoverOpen()
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') hoverClose()
        }}
      >
        {children}
        <span className="insp-term-i" aria-hidden="true">
          ⓘ
        </span>
      </button>
      {open && (
        <Popover
          anchor={anchor}
          id={popId}
          role="tooltip"
          className="insp-term-pop"
          onClose={() => {
            pinned.current = false
            setOpen(false)
          }}
          onPointerEnter={clear}
          onPointerLeave={hoverClose}
        >
          <span className="insp-term-title">{g.title}</span>
          <span className="insp-term-body">{g.body}</span>
        </Popover>
      )}
    </>
  )
}

/** Centered empty/placeholder text for an instrument body. */
export function EmptyNote({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="emb-empty" role="note">
      <span className="emb-empty-title">{title}</span>
      {children && <span className="emb-empty-body">{children}</span>}
    </div>
  )
}
