/**
 * Workspace BOTTOM tray: UART Terminal · Logic Analyzer · Oscilloscope ·
 * Simulation Log · 量測 (the meters' readings, UX IS-19) — the same view
 * components the phone Scope sheet swaps between. Only the visible tab is
 * `active` (its pull loop / rAF run); a collapsed tray keeps just the tab
 * strip as a slim bar, where picking a tab re-opens it.
 *
 * The tray follows the circuit (UX IS-5, src/state/lab.ts trayTabFor):
 * collapsed on an empty board, opened when logic channels, a probe, a
 * multimeter or a USART the firmware enabled give it something to show — until the
 * user opens or collapses it here, which stops the automatic changes for the
 * session. 「分析版面」 (Shift+A, UX IS-9) folds both side panels away and
 * raises the tray to about 55 % of the window; pressing it again puts the
 * previous arrangement back.
 */
import { useEffect, useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon, LogIcon, LogicIcon, PanelBottomIcon, Segmented, TargetIcon, TerminalIcon, WaveformIcon, tick } from '../kit'
import { ScopeView } from '../sheets/ScopeSheet'
import { IconButton } from '../embedded/controls'
import { LogicAnalyzer } from '../embedded/LogicAnalyzer'
import { SimLog } from '../embedded/SimLog'
import { UartTerminal } from '../embedded/UartTerminal'
import { MeasureView } from '../embedded/instruments/MeasureView'
import { noteTrayToggledByUser, useLab } from '../embedded/lab'
import type { TrayTab, WorkspacePrefs } from '../../state/lab-types'
import { t, useLang } from '../../i18n'
import { tc } from '../format'

/** Built per render: the tab names follow the UI language. */
function tabOptions(): { value: TrayTab; label: React.ReactNode }[] {
  return [
    // English uses short tab names (five tabs fit the tray without 「Logic Analy…」); the full name is the tooltip
    { value: 'uart', label: <TabLabel icon={<TerminalIcon size={16} />} text={tc('UART', 'tray-tab')} title={t('UART Terminal')} /> },
    { value: 'logic', label: <TabLabel icon={<LogicIcon size={16} />} text={tc('Logic', 'tray-tab')} title={t('Logic Analyzer')} /> },
    { value: 'scope', label: <TabLabel icon={<WaveformIcon size={16} />} text={tc('Scope', 'tray-tab')} title={t('Oscilloscope')} /> },
    { value: 'log', label: <TabLabel icon={<LogIcon size={16} />} text={tc('Log', 'tray-tab')} title={t('Simulation Log')} /> },
    // the meters' readings, always in view (UX IS-19)
    { value: 'measure', label: <TabLabel icon={<TargetIcon size={16} />} text={tc('Readings', 'tray')} /> },
  ]
}

function TabLabel({ icon, text, title }: { icon: React.ReactNode; text: string; title?: string }) {
  return (
    <span className="ws-tab-label" title={title !== text ? title : undefined}>
      {icon}
      <span className="ws-tab-text">{text}</span>
    </span>
  )
}

/** the arrangement 「分析版面」 replaced (null = not in the analysis layout) */
let beforeAnalysis: Pick<WorkspacePrefs, 'left' | 'right' | 'tray'> | null = null

/** Toggle the analysis layout (side panels folded, tray ≈ 55 % of the window). */
export function toggleAnalysisLayout(): void {
  const lab = useLab.getState()
  const ws = lab.workspace
  if (beforeAnalysis) {
    const b = beforeAnalysis
    beforeAnalysis = null
    lab.setWorkspace({ left: { ...ws.left, open: b.left.open }, right: { ...ws.right, open: b.right.open }, tray: { ...ws.tray, open: true, height: b.tray.height } })
    return
  }
  beforeAnalysis = { left: ws.left, right: ws.right, tray: ws.tray }
  noteTrayToggledByUser()
  const h = typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.55) : 480
  lab.setWorkspace({ left: { ...ws.left, open: false }, right: { ...ws.right, open: false }, tray: { ...ws.tray, open: true, height: h } })
}

export function Tray() {
  const tray = useLab((s) => s.workspace.tray)
  const setWorkspace = useLab((s) => s.setWorkspace)
  const [analysis, setAnalysis] = useState(beforeAnalysis !== null)
  useLang()
  const set = (p: Partial<typeof tray>) => setWorkspace({ tray: { ...useLab.getState().workspace.tray, ...p } })
  const toggleAnalysis = () => {
    tick()
    toggleAnalysisLayout()
    setAnalysis(beforeAnalysis !== null)
  }

  // Shift+A — not while typing, not under a modal. Capture phase: the
  // workspace panels keep plain keys from bubbling to window-level shortcuts
  // (Workspace guardKeys), and a focused instrument plot must not also read
  // it as its own "A" key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'A' && e.key !== 'a')) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (document.querySelector('[aria-modal="true"]')) return
      e.preventDefault()
      e.stopPropagation()
      toggleAnalysis()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <div className="ws-head ws-tray-head">
        <Segmented<TrayTab>
          className="ws-tabs ws-tray-tabs"
          value={tray.tab}
          onChange={(tab) => {
            if (!tray.open) noteTrayToggledByUser()
            set({ tab, open: true })
          }}
          options={tabOptions()}
          aria-label={t('Instruments')}
        />
        {/* the shortcut is announced (aria-keyshortcuts) and listed with the app's
            keys, not spelled into the Chinese label */}
        <button
          type="button"
          className="emb-icon-btn lg-pressable"
          aria-label={analysis ? t('Restore the layout') : t('Analysis layout: a big instrument tray, side panels folded')}
          title={analysis ? t('Restore the layout') : t('Analysis layout: a big instrument tray, side panels folded')}
          aria-pressed={analysis}
          aria-keyshortcuts="Shift+A"
          onClick={toggleAnalysis}
        >
          <PanelBottomIcon size={18} />
        </button>
        <IconButton
          aria-label={tray.open ? t('Collapse instrument tray') : t('Expand instrument tray')}
          aria-expanded={tray.open}
          onClick={() => {
            noteTrayToggledByUser()
            set({ open: !tray.open })
          }}
        >
          {tray.open ? <ChevronDownIcon size={20} /> : <ChevronUpIcon size={20} />}
        </IconButton>
      </div>
      {tray.open && (
        <div className="ws-tray-body">
          {tray.tab === 'uart' && <UartTerminal active />}
          {tray.tab === 'logic' && <LogicAnalyzer active />}
          {tray.tab === 'scope' && (
            <div className="ws-scope">
              <ScopeView active />
            </div>
          )}
          {tray.tab === 'log' && <SimLog active />}
          {tray.tab === 'measure' && <MeasureView active />}
        </div>
      )}
    </>
  )
}
