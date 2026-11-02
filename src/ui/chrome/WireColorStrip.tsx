/**
 * WireColorStrip — the glass strip floating above the dock while wire mode
 * is armed (DESIGN.md §2 Dock/Wire).
 *
 * Classic chrome: six glass-mounted colour swatches. Tapping a swatch
 * changes the colour of the wire being drawn (preserving an in-progress
 * first end) and keeps that choice for this wire session. Every swatch has a
 * ≥44px hit target via .lg-hit.
 *
 * Product chrome (operation simplification — contract C1, src/ui/wire-roles.ts):
 * no colour to pick. Every wire takes the colour of its net's role (supply
 * red, ground black, signals by function), so the strip shows what the
 * colours mean — 「紅＝電源正　黑＝地　其他顏色＝訊號」 — and its trailing
 * 「完成」 leaves wire mode (UX wave SH-5), so the way out stays visible.
 */
import type { CSSProperties } from 'react'
import { useStore } from '../../state/store'
import { WIRE_COLORS, wireColorHex, wireColorLabel } from '../wire-colors'
import { SIGNAL_PALETTE } from '../wire-roles'
import { tc } from '../format'
import { t, useLang } from '../../i18n'
import { pressProps, tick } from '../kit'
import { useLegacyChrome } from './legacy'
import { markWireColorPicked } from './wire-convention'
import './WireColorStrip.css'

/**
 * The legend's three entries: the colour dots and their words. `short` is
 * the phone form (review F8): the dot already shows the colour, so a phone
 * row reads 「● 電源正　● 地　●●● 訊號 │ 完成」 — one 50 px row that stays
 * below the raised undo pill (the full words stay for screen readers).
 */
export function wireLegendItems(): { key: string; colors: string[]; text: string; short: string }[] {
  return [
    { key: 'supply', colors: ['red'], text: t('Red = supply +|wire-legend'), short: t('supply +|wire-legend-short') },
    { key: 'ground', colors: ['black'], text: t('Black = ground|wire-legend'), short: t('ground|wire-legend-short') },
    // the plain-signal palette's own colours (one colour, one meaning: the
    // dots look like the signal wires a first circuit gets)
    { key: 'signal', colors: SIGNAL_PALETTE.slice(0, 3), text: t('Other colours = signals|wire-legend'), short: t('signals|wire-legend-short') },
  ]
}

export function WireColorStrip() {
  const mode = useStore((s) => s.mode)
  const legacy = useLegacyChrome()
  useLang()
  if (mode.kind !== 'wire') return null

  if (!legacy) {
    return (
      <div
        className="lg-surface lg-glass-clear app-wire-strip has-done is-legend"
        // the 3D hover chip keeps clear of it (scene CHIP_AVOID_SELECTOR)
        data-scene-avoid=""
        role="group"
        aria-label={t('Wire colours follow the circuit')}
      >
        <span className="app-wire-legend" title={t('Every wire takes the colour of what it carries — nothing to pick')}>
          {wireLegendItems().map((item) => (
            <span key={item.key} className={`app-wire-legend-item is-${item.key}`}>
              <span className="app-wire-legend-dots" aria-hidden="true">
                {item.colors.map((c) => (
                  <span key={c} className="app-wire-legend-dot" style={{ background: wireColorHex(c) }} />
                ))}
              </span>
              <span className="app-wire-legend-text">{item.text}</span>
              <span className="app-wire-legend-short" aria-hidden="true">
                {item.short}
              </span>
            </span>
          ))}
        </span>
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
      </div>
    )
  }

  return (
    // CLEAR-variant glass (HIG: media-rich backdrop + bold foreground —
    // the swatches): thinner material with its own dimming layer, still
    // no backdrop-filter (Tier S; the blur budget stays with dock+capsule)
    <div className="lg-surface lg-glass-clear app-wire-strip" role="radiogroup" aria-label={t('Wire color')}>
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
    </div>
  )
}
