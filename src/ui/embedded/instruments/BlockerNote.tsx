/**
 * Why an instrument shows nothing — the REAL reason first (UX IS-14, helper
 * H5 boardBlocker): when the board that drives the signals is unpowered,
 * has no firmware, is halted by the debugger, locked up or booting from
 * system memory, the logic analyzer's empty window, the UART terminal's
 * status line and the scope readout say THAT, with its one-click fix:
 *
 *   「U1 沒有供電，所以這些通道沒有訊號」〔在電路板上標示〕
 *   「U1 還沒有韌體」〔載入韌體…〕
 *   「U1 核心已停住（偵錯器）」〔繼續執行〕
 *
 * Generic hints (「按「自動」」, 「還沒有資料」) apply only without a blocker.
 * Tier-S inline note (no backdrop-filter); re-renders only when the
 * blocking problem row changes (≤ 1 Hz, problems' own rate).
 */
import type { CircuitLayout, ComponentInstance } from '../../../model/types'
import { boardConfigOf } from '../../../model/types'
import { getEntry } from '../../../model/catalog'
import { componentPinHoles, formatHole } from '../../../model/breadboard'
import type { Netlist } from '../../../sim/netlist'
import { t } from '../../../i18n'
import { tick } from '../../kit'
import { locateProblem, useBoardBlocker, type BoardBlocker, type BoardBlockerKind } from '../problems'
import { stateColor, type ToneState } from '../../chrome/run-control'
import './instruments.css'

/** One state, one colour (H6): the run-state each blocker is. */
const TONE: Record<BoardBlockerKind, ToneState> = {
  power: 'unpowered',
  'fw-missing': 'no-firmware',
  halt: 'halted',
  lockup: 'lockup',
  boot0: 'boot-sysmem',
}

/** What the instrument is missing, for the power sentence. */
export type BlockedThing = 'channels' | 'port' | 'probe'

/** The blocker as one sentence (the action is separate). */
export function blockerSentence(b: BoardBlocker, what: BlockedThing): string {
  const id = b.componentId
  switch (b.kind) {
    case 'power':
      return what === 'port'
        ? t('{id} has no power, so this port sends nothing', { id })
        : what === 'probe'
          ? t('{id} has no power, so the probed net has no signal', { id })
          : t('{id} has no power, so these channels have no signal', { id })
    case 'fw-missing':
      return t('{id} has no firmware yet', { id })
    case 'halt':
      return t('{id} core halted (debugger)', { id })
    default:
      // lockup / BOOT0: the problems list's own headline (the run-state vocabulary)
      return b.problem.title
  }
}

/** The fix: the problem's own action, else (power) show the place on the board. */
export function blockerAction(b: BoardBlocker): { label: string; run: () => void } {
  if (b.problem.action) return b.problem.action
  return { label: t('Show on the board'), run: () => void locateProblem(b.problem) }
}

/** The MCU board of the layout an instrument depends on: `preferred` when it is a board, else the only board. */
export function boardFor(layout: CircuitLayout, preferred?: readonly (string | null | undefined)[]): string | null {
  const boards = layout.components.filter((c) => getEntry(c.type)?.mcu)
  for (const id of preferred ?? []) if (id && boards.some((b) => b.id === id)) return id
  return boards.length === 1 ? boards[0].id : null
}

/** The MCU board with a pin on electrical net `net` (null: none). */
export function boardOnNet(layout: CircuitLayout, netlist: Netlist, net: string): string | null {
  const config = boardConfigOf(layout)
  for (const comp of layout.components as ComponentInstance[]) {
    const entry = getEntry(comp.type)
    if (!entry?.mcu) continue
    const holes = componentPinHoles(comp, entry, config) ?? []
    if (holes.some((h) => h && netlist.netOf(formatHole(h)) === net)) return comp.id
  }
  return null
}

/** The inline note: the sentence and its fix. */
export function BlockerNote({ blocker, what, className = '' }: { blocker: BoardBlocker; what: BlockedThing; className?: string }) {
  const action = blockerAction(blocker)
  return (
    <span className={`ins-blocker is-${blocker.kind} ${className}`} role="status">
      <span className="ins-blocker-dot" style={{ background: stateColor(TONE[blocker.kind]) }} aria-hidden="true" />
      <span className="ins-blocker-text">{blockerSentence(blocker, what)}</span>
      <button
        type="button"
        className="ins-blocker-btn"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          tick()
          action.run()
        }}
      >
        {action.label}
      </button>
    </span>
  )
}

/** useBoardBlocker for the board an instrument depends on (null id = no board). */
export function useInstrumentBlocker(boardId: string | null): BoardBlocker | null {
  return useBoardBlocker(boardId)
}
