/**
 * Workspace RIGHT panel: the inspector for the current selection.
 *
 * Renders PropertiesBody — the very same editors the phone Properties sheet
 * shows (parameters, pinout, electrical readouts, simulation status and,
 * for MCU boards, firmware + execution + peripherals) — inside a Tier-S
 * panel. With nothing selected, the problems panel (ErcPanel, anchor
 * #ws-problems — "what is wrong / what to do next") comes FIRST, then the
 * hint and a live preview line for the part under the pointer
 * (SceneCallbacks.onObjectHover). With a selection, the part's own problems
 * sit under its header (PropertiesBody) and the full panel stays at the
 * bottom.
 */
import { useStore } from '../../state/store'
import { getEntry } from '../../model/catalog'
import { SidebarRightIcon } from '../kit'
import { PropertiesBody } from '../sheets/PropertiesSheet'
import { IconButton } from '../embedded/controls'
import { ErcPanel } from '../embedded/ErcPanel'
import { useHoveredObject } from './state'
import { t, useLang } from '../../i18n'
import { partLabel } from '../../i18n/parts'

export function Inspector({ onCollapse }: { onCollapse: () => void }) {
  const select = useStore((s) => s.select)
  const nothingSelected = useStore((s) => (Array.isArray(s.selection) ? s.selection.length === 0 : !s.selection))
  // the one selected MCU board: its 執行狀態 card states its board-state facts, so the
  // problems list below leaves those rows out — one sentence in one place (QA IN-F3)
  const selectedBoard = useStore((s) => {
    const sel = s.selection
    if (sel.length !== 1) return undefined
    const comp = s.layout.components.find((c) => c.id === sel[0])
    return comp && getEntry(comp.type)?.mcu ? comp.id : undefined
  })
  useLang()

  return (
    <>
      <div className="ws-head">
        <span className="ws-head-title lg-headline">{t('Inspector')}</span>
        <IconButton aria-label={t('Hide inspector')} onClick={onCollapse}>
          <SidebarRightIcon size={20} />
        </IconButton>
      </div>
      <div className="ws-scroll">
        {nothingSelected && <ErcPanel />}
        <PropertiesBody desktop onDone={() => select(null)} empty={<InspectorEmpty />} />
        {!nothingSelected && <ErcPanel boardState={selectedBoard} />}
      </div>
    </>
  )
}

function InspectorEmpty() {
  const hovered = useHoveredObject()
  const comp = useStore((s) => (hovered ? s.layout.components.find((c) => c.id === hovered) : undefined))
  const wire = useStore((s) => (hovered && !comp ? s.layout.wires.find((w) => w.id === hovered) : undefined))
  const entry = comp ? getEntry(comp.type) : undefined
  return (
    <div className="ws-empty">
      <span className="lg-headline">{t('Nothing selected')}</span>
      <span className="lg-caption">
        {t('Click a part or wire on the board to inspect it. Hover a pin to see its name.')}
      </span>
      {(comp || wire) && (
        <span className="ws-hover-chip" aria-live="polite">
          <span className="emb-mono">{comp?.id ?? wire?.id}</span>
          {entry ? ` · ${partLabel(entry)}` : wire ? ` · ${t('Wire')}` : ''}
        </span>
      )}
    </div>
  )
}
