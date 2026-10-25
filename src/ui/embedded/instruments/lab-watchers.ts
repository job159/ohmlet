/**
 * Event-driven instrument housekeeping (no per-frame work), installed once
 * when the instrument views' module graph loads (ScopeSheet imports this):
 *
 *   - a scope probe placed from the library says which channel it got
 *     ("PRB2 → CH2", UX IS-4) — the store already gave it the lowest free
 *     channel; when all four are taken it says that the probe shares one;
 *   - the first protocol decoder raises a short desktop tray once to
 *     min(360 px, the tray maximum) so the decoded lanes do not squeeze the
 *     waveform; removing the last decoder puts the old height back, unless
 *     the user resized the tray meanwhile (UX IS-5);
 *   - the new chrome places a new off-board unit (a multimeter from the
 *     library) clear of the leads already on the bench (UX QA IS-F15 —
 *     store.setOffboardPlacementPolicy); the classic chrome keeps the shelf.
 */
import { setOffboardPlacementPolicy, useStore } from '../../../state/store'
import { isLegacyChrome } from '../../chrome/legacy'
import { showToast } from '../../kit'
import { t } from '../../../i18n'
import { useLab } from '../lab'
import { LIMITS } from '../../workspace/state'

/** raised tray height (px) */
export const DECODER_TRAY_HEIGHT = 360

let installed = false

export function installLabWatchers(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  // ---- a new off-board unit avoids the bench's leads (new chrome only)
  setOffboardPlacementPolicy(() => !isLegacyChrome())

  // ---- scope probe placement → "PRB2 → CH2"
  useStore.subscribe((s, prev) => {
    if (s.layout === prev.layout) return
    const mode = s.mode
    if (mode.kind !== 'place' || mode.type !== 'scope_probe') return
    const before = new Set(prev.layout.components.map((c) => c.id))
    const added = s.layout.components.filter((c) => c.type === 'scope_probe' && !before.has(c.id))
    if (added.length !== 1) return
    const p = added[0]
    const ch = Number(p.params?.channel ?? 1)
    const other = s.layout.components.find((c) => c !== p && c.type === 'scope_probe' && Number(c.params?.channel ?? 1) === ch)
    showToast(
      other
        ? t('{id} → CH{n} — all four channels are in use, so it shares CH{n} with {other}', { id: p.id, n: ch, other: other.id })
        : t('{id} → CH{n}', { id: p.id, n: ch }),
      { duration: other ? 4200 : 2400 },
    )
  })

  // ---- first decoder → a tray tall enough for the decoded lanes
  let had = useLab.getState().logicView.decoders.length > 0
  useLab.subscribe((s, prev) => {
    // a height change we did not make = the user resized the tray
    if (s.workspace.tray.height !== prev.workspace.tray.height && s.workspace.tray.height !== ourHeight) userResized = true
    if (s.logicView === prev.logicView) return
    const has = s.logicView.decoders.length > 0
    if (has === had) return
    had = has
    const tray = s.workspace.tray
    if (has) {
      const to = Math.min(DECODER_TRAY_HEIGHT, trayMax())
      if (tray.height >= to) return
      raised = { from: tray.height, to }
      setTrayHeight(to)
    } else if (raised) {
      const r = raised
      raised = null
      // only when the height is still ours (the user did not resize meanwhile)
      if (tray.height === r.to) setTrayHeight(r.from)
    }
  })
}

/** the tray height we set last (to tell our changes from the user's resizes) */
let ourHeight = -1
let userResized = false
let raised: { from: number; to: number } | null = null

/** The workspace's own tray limits (src/ui/workspace/state.ts computeGeometry). */
function trayMax(): number {
  return Math.max(LIMITS.tray.min, Math.min(LIMITS.tray.max, Math.round(window.innerHeight * 0.6)))
}

function setTrayHeight(h: number): void {
  const s = useLab.getState()
  ourHeight = h
  s.setWorkspace({ tray: { ...s.workspace.tray, height: h } })
}

/**
 * The logic analyzer's plot is shorter than it needs (its toolbar or footer
 * wrapped in a narrow tray): grow the desktop tray by `deficit` px, up to
 * 360 px / the tray maximum, and never after the user resized the tray
 * (UX IS-5: the waveform keeps ≥ 120 px). Growth only — it cannot oscillate.
 */
export function giveLogicPlotRoom(deficit: number): void {
  if (userResized || !(deficit > 0)) return
  const s = useLab.getState()
  if (!s.workspace.enabled || !s.workspace.tray.open) return
  const cur = s.workspace.tray.height
  const to = Math.min(Math.max(DECODER_TRAY_HEIGHT, cur), trayMax(), cur + Math.ceil(deficit))
  if (to <= cur) return
  raised = null // the room stays (a decoder removed later does not shrink it back)
  setTrayHeight(to)
}

installLabWatchers()
