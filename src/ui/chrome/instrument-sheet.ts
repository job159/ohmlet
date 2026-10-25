/**
 * Show an instrument where the instruments live (UX continuity — a link from
 * a problem, the probe menu or a lesson must LAND on the instrument, on a
 * phone too):
 *
 *   - the desktop workspace: the tray, opened on that tab (as before);
 *   - the rest of the new chrome (phones, narrow desktop windows): the
 *     「儀器」 sheet, presented on that view — the shell (App.tsx) listens to
 *     useInstrumentRequest and opens the sheet; ScopeSheet presents on
 *     lab.workspace.tray.tab, which is set first;
 *   - the classic chrome: nothing (false) — it never had these links.
 *
 *   showInstrument('log')   // 「在模擬日誌中檢視」 (problems.openSimulationLog)
 *   showInstrument('logic') // the probe menu's 「在邏輯分析儀中檢視」
 *
 * Event-driven, no React work unless a request is made.
 */
import { create } from 'zustand'
import type { TrayTab } from '../../state/lab-types'
import { useLab } from '../embedded/lab'
import { isLegacyChrome, isWorkspaceShowing } from './legacy'

export interface InstrumentRequest {
  view: TrayTab
  /** increases with every request (a repeat of the same view still opens the sheet) */
  seq: number
}

/** The latest request to present the instruments sheet (null: none yet). */
export const useInstrumentRequest = create<{ request: InstrumentRequest | null }>(() => ({ request: null }))

/**
 * Bring `view` up: the workspace tray, or the instruments sheet. Returns
 * false where there is no such surface (the classic chrome).
 */
export function showInstrument(view: TrayTab): boolean {
  if (isLegacyChrome()) return false
  const lab = useLab.getState()
  if (isWorkspaceShowing()) {
    lab.setWorkspace({ tray: { ...lab.workspace.tray, open: true, tab: view } })
    return true
  }
  // the sheet presents on the tray tab; the desktop tray's open / closed
  // preference stays as the user left it
  if (lab.workspace.tray.tab !== view) lab.setWorkspace({ tray: { ...lab.workspace.tray, tab: view } })
  const prev = useInstrumentRequest.getState().request
  useInstrumentRequest.setState({ request: { view, seq: (prev?.seq ?? 0) + 1 } })
  return true
}
