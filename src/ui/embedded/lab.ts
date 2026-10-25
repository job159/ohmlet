/**
 * The UI's single binding to the embedded-lab store (contract:
 * src/state/lab-types.ts; implementation: src/state/lab.ts).
 *
 * Every workspace / embedded component imports `useLab` and `labBuffers`
 * from HERE, never from src/state/lab directly, so the UI depends on one
 * narrow seam: the LabState / LabBuffers contract types plus the two
 * runtime handles (and the workspace defaults the resize handles restore).
 */
import type { LabBuffers, LabState, WorkspacePrefs } from '../../state/lab-types'
import type { StoreApi, UseBoundStore } from 'zustand'
import {
  WORKSPACE_MEDIA_QUERY as LAB_WORKSPACE_QUERY,
  labBuffers as labBuffersImpl,
  logicSourcePresent as logicSourcePresentImpl,
  noteTrayToggledByUser as noteTrayToggledByUserImpl,
  useLab as useLabImpl,
  workspaceDefaults,
} from '../../state/lab'
import type { CircuitLayout } from '../../model/types'
import type { LogicChannelConfig } from '../../sim/coordinator/api'

/** The lab store hook (`useLab(selector)`, `useLab.getState()`). */
export const useLab: UseBoundStore<StoreApi<LabState>> = useLabImpl

/** High-rate ring buffers (UART bytes, log) — read on `*Version` bumps. */
export const labBuffers: LabBuffers = labBuffersImpl

/** Where the desktop workspace may show (≥ 1100 px, fine pointer). */
export const WORKSPACE_MEDIA_QUERY: string = LAB_WORKSPACE_QUERY

/** Panel sizes a double-click / Enter on a resize handle restores. */
export const DEFAULT_WORKSPACE: WorkspacePrefs = workspaceDefaults()

/** The logic channel's source part still exists in `layout` (UX IS-8 stale-channel chip). */
export const logicSourcePresent: (layout: CircuitLayout, ch: LogicChannelConfig) => boolean = logicSourcePresentImpl

/** The user toggled the instrument tray: automatic open / collapse stop for this session (UX IS-5). */
export const noteTrayToggledByUser: () => void = noteTrayToggledByUserImpl
