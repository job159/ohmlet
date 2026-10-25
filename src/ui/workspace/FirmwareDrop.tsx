/**
 * Firmware drop on the 3D canvas (UX fix wave SC-15, desktop workspace).
 *
 * While a drag that carries files moves anywhere over the window, a Tier-S
 * card covers the canvas area the docked panels leave free: 「放開以載入到 U1
 * （hal-i2c-scan.elf）」 (the file name when the browser lets a page read it
 * during the drag — most only reveal it on drop). With several boards it lists
 * one drop chip per board (「U1」「U2」); without one it says what is missing.
 * The panels' own drop zones (the inspector's firmware card) keep working —
 * the card covers the canvas only.
 *
 * A drop goes through the firmware card's own path (UX helper H11
 * acceptFirmwareFile — McuPanel): the same toasts, the same UART separator
 * 「── t · U1 載入 hal-i2c-scan.elf（…）· 重置 ──」, a .bin brings the card up
 * for its load address; any other file: 「只接受 .elf、.bin 或 .hex 韌體檔」.
 *
 * Near-opaque card, NO backdrop-filter (glass budget). Window listeners only
 * while mounted; no per-frame work (the card hides 400 ms after the last
 * dragover, or at once on drop / dragend).
 */
import { useEffect, useState, type DragEvent } from 'react'
import { getEntry } from '../../model/catalog'
import { useStore } from '../../state/store'
import { acceptFirmwareFile, isFirmwareFileName } from '../embedded/McuPanel'
import { focusInspector } from '../embedded/problems'
import { showToast } from '../kit'
import { t, useLang } from '../../i18n'

/** The card hides this long after the last dragover (the drag left the window / was cancelled). */
const HIDE_AFTER_MS = 400

/** Ids of the MCU boards in the circuit, in layout order. */
function mcuIds(): string[] {
  return useStore
    .getState()
    .layout.components.filter((c) => !!getEntry(c.type)?.mcu)
    .map((c) => c.id)
}

const carriesFiles = (e: { dataTransfer: DataTransfer | null }): boolean =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')

/**
 * Load a dropped file into board `id` (null: decide from the circuit — the
 * only board). Exported for tests.
 */
export function dropFirmwareFile(file: File, id: string | null): void {
  if (!isFirmwareFileName(file.name)) {
    showToast(t('Only .elf, .bin or .hex firmware files are accepted'), { duration: 3600 })
    return
  }
  const boards = mcuIds()
  const target = id ?? (boards.length === 1 ? boards[0] : null)
  if (!target) {
    showToast(
      boards.length === 0
        ? t('No microcontroller in the circuit — place a Blue Pill first')
        : t('Drop it on the board that should run it: {ids}', { ids: boards.join(t(', ')) }),
      { duration: 3600 },
    )
    return
  }
  const r = acceptFirmwareFile(target, file)
  // a .bin asks for its load address on the firmware card; a refusal is said there too
  if (r === 'needs-address' || r === 'refused') focusInspector(target, { tab: 'firmware' })
}

export function FirmwareDropOverlay() {
  useLang()
  const [drag, setDrag] = useState<{ name: string | null } | null>(null)
  const [hot, setHot] = useState<string | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const hide = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      setDrag(null)
      setHot(null)
    }
    const show = (e: globalThis.DragEvent) => {
      if (!carriesFiles(e)) return
      // the name is readable during the drag only where the browser allows it
      const name = e.dataTransfer?.files?.[0]?.name ?? null
      setDrag((prev) => (prev && prev.name === name ? prev : { name }))
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(hide, HIDE_AFTER_MS)
    }
    window.addEventListener('dragenter', show)
    window.addEventListener('dragover', show)
    window.addEventListener('drop', hide)
    window.addEventListener('dragend', hide)
    return () => {
      if (timer !== null) clearTimeout(timer)
      window.removeEventListener('dragenter', show)
      window.removeEventListener('dragover', show)
      window.removeEventListener('drop', hide)
      window.removeEventListener('dragend', hide)
    }
  }, [])

  if (!drag || typeof window === 'undefined') return null
  const boards = mcuIds()
  const allow = (e: DragEvent<HTMLElement>) => {
    if (!carriesFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const drop = (id: string | null) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDrag(null)
    setHot(null)
    const file = e.dataTransfer.files?.[0]
    if (file) dropFirmwareFile(file, id)
  }
  const named = drag.name && isFirmwareFileName(drag.name) ? drag.name : null
  let headline: string
  if (drag.name && !named) headline = t('Only .elf, .bin or .hex firmware files are accepted')
  else if (boards.length === 0) headline = t('No microcontroller in the circuit — place a Blue Pill first')
  else if (boards.length === 1)
    headline = named ? t('Release to load it into {id} ({name})', { id: boards[0], name: named }) : t('Release to load it into {id}', { id: boards[0] })
  else headline = named ? t('Drop {name} on the board that should run it', { name: named }) : t('Drop it on the board that should run it')

  return (
    <div
      className="ws-fw-drop"
      onDragOver={allow}
      onDragEnter={allow}
      onDrop={drop(null)}
    >
      <div className="ws-fw-drop-card lg-rim" role="status" aria-live="polite">
        <span className="ws-fw-drop-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 28 28">
            <rect x="7" y="7" width="14" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            {[10, 14, 18].map((v) => (
              <g key={v} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <line x1={v} y1="3" x2={v} y2="7" />
                <line x1={v} y1="21" x2={v} y2="25" />
                <line x1="3" y1={v} x2="7" y2={v} />
                <line x1="21" y1={v} x2="25" y2={v} />
              </g>
            ))}
          </svg>
        </span>
        <span className="ws-fw-drop-text">{headline}</span>
        {boards.length > 1 && (
          <span className="ws-fw-drop-chips">
            {boards.map((id) => (
              <span
                key={id}
                className={`ws-fw-drop-chip${hot === id ? ' is-hot' : ''}`}
                onDragOver={(e) => {
                  allow(e)
                  if (hot !== id) setHot(id)
                }}
                onDragLeave={() => setHot((h) => (h === id ? null : h))}
                onDrop={drop(id)}
              >
                {id}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}
