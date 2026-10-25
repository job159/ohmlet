/**
 * Point the instruments at a tab from anywhere (UX requests round — the
 * phone half of IS-14 (3)): a probe action, a lesson step, a problem row.
 *
 *   revealInstrument(tab)                 the instruments' current tab, no sheet popped up
 *   revealInstrument(tab, { open: true }) and bring them up now (the shell's
 *                                         showInstrument: the 儀器 sheet on a phone)
 *
 * One state for both chromes: lab.workspace.tray.tab is THE current
 * instrument. The desktop workspace opens its tray on it; the phone 「儀器」
 * sheet (ScopeSheet) opens on it and follows it while open — so a channel
 * added from the probe sheet is what 儀器 shows next, without covering the
 * board now. `open: true` delegates to the shell's request store
 * (src/ui/chrome/instrument-sheet.ts — App opens the sheet), never a second
 * one. The classic chrome is untouched (false). No React; nothing per frame.
 */
import type { TrayTab } from '../../../state/lab-types'
import { isLegacyChrome, isWorkspaceShowing } from '../../chrome/legacy'
import { showInstrument } from '../../chrome/instrument-sheet'
import { useLab } from '../lab'

export function revealInstrument(tab: TrayTab, opts: { open?: boolean } = {}): boolean {
  if (isLegacyChrome()) return false
  if (opts.open) return showInstrument(tab)
  const lab = useLab.getState()
  const tray = lab.workspace.tray
  if (isWorkspaceShowing()) {
    if (!tray.open || tray.tab !== tab) lab.setWorkspace({ tray: { ...tray, open: true, tab } })
  } else if (tray.tab !== tab) {
    // a phone / narrow window: the sheet opens here next; the desktop tray's
    // open / closed preference stays as the user left it
    lab.setWorkspace({ tray: { ...tray, tab } })
  }
  return true
}
