/**
 * WireColorStrip — six glass-mounted color swatches floating above the dock
 * while wire mode is armed (DESIGN.md §2 Dock/Wire). Tapping a swatch changes
 * the color of the wire being drawn (preserving an in-progress first end) and
 * keeps that choice for this wire session (otherwise the colour follows the
 * convention — wire-convention.ts, SH-8). Every swatch has a ≥44px hit
 * target via .lg-hit.
 *
 * New chrome (UX wave SH-5): a trailing 「完成」 text button leaves wire
 * mode, so the way out is visible, not only Esc / a second dock tap.
 */
import type { CSSProperties } from 'react'
import { useStore } from '../../state/store'
import { WIRE_COLORS, wireColorLabel } from '../wire-colors'
import { tc } from '../format'
import { t, useLang } from '../../i18n'
import { pressProps, tick } from '../kit'
import { useLegacyChrome } from './legacy'
import { markWireColorPicked } from './wire-convention'
import './WireColorStrip.css'

export function WireColorStrip() {
  const mode = useStore((s) => s.mode)
  const legacy = useLegacyChrome()
  useLang()
  if (mode.kind !== 'wire') return null

  return (
    // CLEAR-variant glass (HIG: media-rich backdrop + bold foreground —
    // the swatches): thinner material with its own dimming layer, still
    // no backdrop-filter (Tier S; the blur budget stays with dock+capsule)
    <div
      className={`lg-surface lg-glass-clear app-wire-strip${legacy ? '' : ' has-done'}`}
      // new chrome: the 3D hover chip keeps clear of it (scene CHIP_AVOID_SELECTOR)
      data-scene-avoid={legacy ? undefined : ''}
      role="radiogroup"
      aria-label={t('Wire color')}
    >
      {WIRE_COLORS.map((c) => {
        const active = mode.color === c.name
        return (
          <button
            key={c.name}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={t('{color} wire', { color: wireColorLabel(c.name) })}
            className={`app-swatch lg-pressable lg-hit lg-gel ${active ? 'is-active' : ''}`}
            style={{ '--swatch': c.hex } as CSSProperties}
            {...pressProps}
            onClick={() => {
              tick()
              const st = useStore.getState()
              if (st.mode.kind !== 'wire') return
              markWireColorPicked()
              st.setMode({ kind: 'wire', from: st.mode.from, color: c.name })
            }}
          />
        )
      })}
      {!legacy && (
        <button
          type="button"
          className="app-wire-done lg-pressable"
          title={t('Leave wire mode')}
          aria-keyshortcuts="Escape"
          {...pressProps}
          onClick={() => {
            tick()
            useStore.getState().setMode({ kind: 'select' })
          }}
        >
          {tc('Done', 'wire')}
        </button>
      )}
    </div>
  )
}
