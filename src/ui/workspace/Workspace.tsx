/**
 * Desktop embedded workspace (ARCHITECTURE_REVIEW §10.7): a Library panel
 * on the left (beside the dock rail), the Inspector on the right and the
 * instrument Tray along the bottom of the centre column — all FLOATING over
 * the full-bleed 3D canvas (the canvas is never resized), sized so the
 * centre of the scene stays free at 1440×900.
 *
 * Material: the panels are persistent and large, and the desktop already
 * spends the whole glass budget (rail + capsule lenses + a right-hand
 * sheet panel; ≤ 4 backdrop-filters / ≤ 3 lenses, DESIGN.md §1) — so they
 * are Tier S: near-opaque dark glass with the bent-light rim and slab
 * insets (the UndoPill / SelectionPill / lg-card recipe), NO
 * backdrop-filter, no new lens tier.
 *
 * Geometry lives in three CSS custom properties on <body> (`--ws-left-w`,
 * `--ws-right-w`, `--ws-tray-h`) plus open/closed body classes; every
 * dependent surface — the tray's left/right edges, the re-flowed toasts,
 * undo/selection pills, wire strip and empty-state card (workspace.css) —
 * derives from them, so a resize drag is one style write per pointermove.
 * Sizes persist through lab.setWorkspace (`bb.workspace`).
 *
 * Keyboard: plain keys typed or pressed inside a panel never reach App's
 * global shortcuts (Space = run, R = rotate, Delete, arrow nudges) — the
 * panel roots stop their propagation; Escape / Tab and modified chords
 * (⌘Z …) pass through.
 */
import { useEffect, useLayoutEffect, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeftIcon, ChevronRightIcon } from '../kit'
import { useStore } from '../../state/store'
import { t, useLang } from '../../i18n'
import { useLab, DEFAULT_WORKSPACE } from '../embedded/lab'
import { FirmwareDropOverlay } from './FirmwareDrop'
import { Inspector } from './Inspector'
import { LibraryPanel } from './LibraryPanel'
import { ProbeMenuHost } from './ProbeMenu'
import { ResizeHandle } from './ResizeHandle'
import { Tray } from './Tray'
import { GAP, LIMITS, RAIL_EDGE, EDGE, computeGeometry } from './state'
import './workspace.css'

const BODY_CLASSES = ['ws-on', 'ws-left-closed', 'ws-right-closed', 'ws-tray-closed']
const BODY_VARS = ['--ws-left-w', '--ws-right-w', '--ws-tray-h']

function useViewport(): { w: number; h: number } {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight })
  const [vp, setVp] = useState(read)
  useEffect(() => {
    const on = () => setVp(read())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return vp
}

/** Stop plain keys inside a panel from triggering App's global shortcuts. */
function guardKeys(e: KeyboardEvent<HTMLElement>): void {
  if (e.key === 'Escape' || e.key === 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return
  e.stopPropagation()
}

export function Workspace({ librarySearchRef }: { librarySearchRef?: RefObject<HTMLInputElement> }) {
  const ws = useLab((s) => s.workspace)
  const setWorkspace = useLab((s) => s.setWorkspace)
  useLang() // panel labels re-render on a language switch
  const { w, h } = useViewport()
  const geo = computeGeometry(ws, w, h)

  // body classes + size variables (chrome re-flow hooks)
  useLayoutEffect(() => {
    document.body.classList.add('ws-on')
    return () => {
      document.body.classList.remove(...BODY_CLASSES)
      for (const v of BODY_VARS) document.body.style.removeProperty(v)
    }
  }, [])
  useLayoutEffect(() => {
    const b = document.body
    b.style.setProperty('--ws-left-w', `${geo.leftW}px`)
    b.style.setProperty('--ws-right-w', `${geo.rightW}px`)
    b.style.setProperty('--ws-tray-h', `${geo.trayH}px`)
    b.classList.toggle('ws-left-closed', !ws.left.open)
    b.classList.toggle('ws-right-closed', !ws.right.open)
    b.classList.toggle('ws-tray-closed', !ws.tray.open)
  }, [geo.leftW, geo.rightW, geo.trayH, ws.left.open, ws.right.open, ws.tray.open])

  const get = () => useLab.getState().workspace
  const setLeft = (p: Partial<typeof ws.left>) => setWorkspace({ left: { ...get().left, ...p } })
  const setRight = (p: Partial<typeof ws.right>) => setWorkspace({ right: { ...get().right, ...p } })
  const setTray = (p: Partial<typeof ws.tray>) => setWorkspace({ tray: { ...get().tray, ...p } })

  // Properties auto-present on selection (DESIGN.md §2) — a collapsed
  // inspector springs back open when something NEW gets selected
  const hasSelection = useStore((s) => s.selection.length > 0)
  useEffect(() => {
    if (hasSelection && !get().right.open) setRight({ open: true })
    // only the empty → selected transition re-opens it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSelection])

  // a drag may not squeeze the centre column below what computeGeometry keeps
  const leftMax = Math.max(LIMITS.left.min, Math.min(LIMITS.left.max, w - RAIL_EDGE - EDGE - 2 * GAP - 420 - (ws.right.open ? geo.rightW : 22)))
  const rightMax = Math.max(LIMITS.right.min, Math.min(LIMITS.right.max, w - RAIL_EDGE - EDGE - 2 * GAP - 420 - (ws.left.open ? geo.leftW : 22)))
  const trayMax = Math.max(LIMITS.tray.min, Math.min(LIMITS.tray.max, Math.round(h * 0.6)))

  return createPortal(
    <>
      {ws.left.open ? (
        <aside className="ws-panel ws-left lg-rim" aria-label={t('Library')} onKeyDown={guardKeys}>
          <LibraryPanel onCollapse={() => setLeft({ open: false })} searchRef={librarySearchRef} />
          <ResizeHandle
            axis="x"
            sign={1}
            value={geo.leftW}
            min={LIMITS.left.min}
            max={leftMax}
            defaultValue={DEFAULT_WORKSPACE.left.width}
            cssVar="--ws-left-w"
            label={t('Resize library panel')}
            onCommit={(width) => setLeft({ width })}
          />
        </aside>
      ) : (
        <button
          type="button"
          className="ws-handle ws-handle-left lg-rim lg-pressable"
          aria-label={t('Show library panel')}
          title={t('Show library')}
          onClick={() => setLeft({ open: true })}
        >
          <ChevronRightIcon size={16} />
        </button>
      )}

      {ws.right.open ? (
        <aside className="ws-panel ws-right lg-rim" aria-label={t('Inspector')} onKeyDown={guardKeys}>
          <Inspector onCollapse={() => setRight({ open: false })} />
          <ResizeHandle
            axis="x"
            sign={-1}
            value={geo.rightW}
            min={LIMITS.right.min}
            max={rightMax}
            defaultValue={DEFAULT_WORKSPACE.right.width}
            cssVar="--ws-right-w"
            label={t('Resize inspector')}
            onCommit={(width) => setRight({ width })}
          />
        </aside>
      ) : (
        <button
          type="button"
          className="ws-handle ws-handle-right lg-rim lg-pressable"
          aria-label={t('Show inspector')}
          title={t('Show inspector')}
          onClick={() => setRight({ open: true })}
        >
          <ChevronLeftIcon size={16} />
        </button>
      )}

      <section
        className={`ws-panel ws-tray lg-rim ${ws.tray.open ? '' : 'is-collapsed'}`}
        aria-label={t('Instruments')}
        onKeyDown={guardKeys}
      >
        {ws.tray.open && (
          <ResizeHandle
            axis="y"
            sign={-1}
            value={geo.trayH}
            min={LIMITS.tray.min}
            max={trayMax}
            defaultValue={DEFAULT_WORKSPACE.tray.height}
            cssVar="--ws-tray-h"
            label={t('Resize instrument tray')}
            onCommit={(height) => setTray({ height })}
          />
        )}
        <Tray />
      </section>

      {/* 3D right-click probe menu (contract K6; the scene's onProbeRequest
          opens it — App wiring, SH-4). Desktop workspace only. */}
      <ProbeMenuHost />

      {/* a firmware file dragged over the window: drop it on the canvas (SC-15) */}
      <FirmwareDropOverlay />
    </>,
    document.body,
  )
}
