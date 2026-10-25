/**
 * MCU board controls shared by the phone Properties sheet and the desktop
 * inspector (one implementation, two hosts):
 *
 *   FirmwareGroup     — no firmware yet: 「這塊板子還沒有韌體」 with the
 *                       built-in picker (BundledFirmwarePicker — every
 *                       firmware/dist project, lesson firmware first) and
 *                       the file picker; .elf / .bin / .hex also drop onto
 *                       the card. A .bin asks for its load address first
 *                       (default 0x08000000, the STM32F1 main-flash base,
 *                       RM0008 §3.3.3). Loaded: name, format, size, short
 *                       SHA-256, entry, loader warnings (the parse warnings
 *                       plus this board's loader log since the binding);
 *                       built-in / replace / remove. Everything goes through
 *                       lab.loadFirmware — the real loader.
 *   McuRunGroup       — the honest state (IN-2): chip + a plain reason line
 *                       with the fix ("尚未執行", "已暫停 · 核心停在 …",
 *                       unpowered / BOOT0 / lockup explanations — a lockup
 *                       the bound image explains names its cause and offers
 *                       「改用 0x08000000 重新載入」, QA clarity LOCKUP-CAUSE), Run /
 *                       Pause — or ▶ 繼續執行 (runOrResume) when the
 *                       debugger halted the core — and Reset MCU, the live
 *                       readouts (PC + symbol, cycles, core clock, speed;
 *                       「—」 whenever they would not mean anything) and the
 *                       labelled 偵錯 row (停住核心 / 單步 / 繼續).
 *   FirmwareSetupGroup — 「韌體目前的設定」 (the 周邊 tab, QA clarity
 *                       PERIPH-LIVE-CONFIG): what the running firmware set up
 *                       — USART line settings + pins, I²C / SPI pins, PWM
 *                       channels, ADC inputs (mcu-setup.ts) — each with the
 *                       instrument that shows it.
 *   PeripheralsGroup  — the MCU model's per-peripheral honesty table
 *                       (lab.queryMcuSupport): verified / partial /
 *                       unsupported with notes; 「只看韌體用到的」 narrows it
 *                       to the blocks the firmware switched on
 *                       (McuFrameInfo.clocked — on by default once any is).
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { create } from 'zustand'
import {
  BookIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChipIcon,
  ImportIcon,
  ListGroup,
  ListRow,
  PauseIcon,
  PlayIcon,
  PressableButton,
  ResetIcon,
  Switch,
  TrashIcon,
  showToast,
  tick,
  useCoarsePointer,
} from '../kit'
import { useStore } from '../../state/store'
import { getEntry } from '../../model/catalog'
import { componentPinHoles, formatHole } from '../../model/breadboard'
import { boardConfigOf } from '../../model/types'
import type { McuDebugState, PeripheralSupport, SupportStatus, UartLineConfig } from '../../mcu/mcu-api'
import type { McuFrameInfo } from '../../sim/coordinator/api'
import { fmtBaud } from '../../instruments/format'
import type { FirmwareRecord } from '../../state/lab-types'
import { loadBundledFirmware } from '../../firmware-assets'
import { firmwareBlobStore, sha256Hex } from '../../state/firmware-store'
import { pushCapsuleDetail, type CapsuleDetailOptions } from '../chrome/StatusBar'
import { runOrResume, stateColor } from '../chrome/run-control'
import { withKey } from '../chrome/ShortcutsSheet'
import { isLegacyChrome } from '../chrome/legacy'
import { showInstrument } from '../chrome/instrument-sheet'
import { requestTerminalPort } from './UartTerminal'
import { focusInScene } from '../workspace/scene-bridge'
import {
  frameSinceReset,
  noteMcuReset,
  openSimulationLog,
  showExecutionState,
  showRegisters,
  trackMcuResets,
  useBoardBlocker,
  useFirmwarePickerRequest,
  useFrameSinceReset,
  type InspectorTab,
} from './problems'
import { t, useLang } from '../../i18n'
import { tMessage } from '../../i18n/messages'
import { labBuffers, useLab } from './lab'
import { ChipButton, Term } from './controls'
import type { GlossaryId } from './glossary'
import { BundledFirmwarePicker } from './BundledFirmwarePicker'
import { addBusFor, addLogicChannelFor, findLogicChannel, flashLogicChannel } from './probe-actions'
import { sanitizeDecoderConfigs } from './instruments/la-config'
import { firmwareSetup, uartFrameText, type SetupRow } from './mcu-setup'
import { firmwareDescriptionText, noTranslate, tc, tNodes } from './text'
import {
  DEFAULT_BIN_BASE,
  MCU_STATE_META,
  POWER_UP_GRACE_S,
  boundBinBase,
  decodeFaultBits,
  faultExceptionName,
  faultHandlerDetail,
  faultHandlerLabel,
  fmtAddr,
  fmtBytes,
  fmtCount,
  faultAddressValid,
  fmtFaultAddress,
  fmtIpsr,
  fmtMHz,
  fmtReadingVoltage,
  fmtSpeed,
  frameFaultOf,
  lockupCauseOf,
  lockupCauseText,
  mcuReadoutsHidden,
  mcuStateMeta,
  mcuStateTone,
  mcuUiStateOf,
  parseAddress,
  upperAddresses,
  xpsrFlags,
  type FaultRegisters,
  type LockupCause,
  type McuViewState,
} from './format'
import './embedded.css'
import './inspector.css'

/** The MCU inspector tab last chosen, per part type, for this session (IN-21): reselecting U1 returns to it. */
const lastTabByType = new Map<string, InspectorTab>()

/** The tab an MCU board of `type` opens on (the last one chosen for that type; 概況 at first). */
export function rememberedMcuTab(type: string): InspectorTab {
  return lastTabByType.get(type) ?? 'overview'
}

/** Remember the tab chosen for boards of `type`. */
export function rememberMcuTab(type: string, tab: InspectorTab): void {
  lastTabByType.set(type, tab)
}

/** The BIN load address field's first value: the STM32F1 main flash base (format.ts DEFAULT_BIN_BASE, RM0008 §3.3.3). */
const DEFAULT_BIN_TEXT = '0x08000000'
const ACCEPT = '.elf,.bin,.hex'
const DEBUG_POLL_MS = 500

// ---------------------------------------------------------------------------
// Live MCU status (SimFrame summary, telemetry fallback)
// ---------------------------------------------------------------------------

export interface McuLive {
  state: McuViewState
  pc: number | null
  cycles: number | null
  hclkHz: number | null
  realtime: number | undefined
  firmware: string | null
  /** the active exception (IPSR) the frame reports, null when it does not (QA IN-F7) */
  exception: number | null
  /** the fault status registers the frame reports */
  fault: FaultRegisters | null
}

export function useMcuLive(componentId: string): McuLive {
  trackMcuResets()
  const raw = useLab((s) => s.mcus[componentId])
  const hasFirmware = useLab((s) => s.firmware[componentId] != null)
  const tele = useStore((s) => s.telemetry?.components[componentId]?.mcu)
  const running = useStore((s) => s.running)
  // only "has the simulation run since the last reset" matters, not the clock value
  const started = useStore((s) => s.simTime > 0)
  // past the start-up frames: an 'unpowered' frame is then a reading (the problems list's own wait)
  const powerSettled = useStore((s) => s.simTime > POWER_UP_GRACE_S)
  // a frame from before the last re-flash / Reset MCU describes the old run: none yet
  const info = useFrameSinceReset(componentId, raw)
  const frame = info ?? (raw ? null : tele) ?? null
  // the exception the core is in (McuFrameInfo.exception / fault): 「在 HardFault 處理常式中」
  const { exception, fault } = frameFaultOf(frame)
  const state = mcuUiStateOf({
    hasFirmware,
    running,
    simTime: started ? 1 : 0,
    powerSettled,
    frame: frame ? { state: frame.state, pc: frame.pc, exception } : null,
  })
  if (!frame) return { state, pc: null, cycles: null, hclkHz: null, realtime: undefined, firmware: null, exception: null, fault: null }
  return {
    state,
    pc: frame.pc,
    cycles: frame.cycles,
    hclkHz: frame.hclkHz,
    realtime: frame.realtime,
    firmware: info ? info.firmware : (tele?.firmware ?? null),
    exception,
    fault,
  }
}

/**
 * Localized state name (MCU_STATE_META keeps the English source); a core in
 * its fault handler names the handler: 「在 HardFault 處理常式中」.
 */
export function mcuStateLabel(state: McuViewState, exception?: number | null): string {
  if (state === 'fault-handler') return faultHandlerLabel(exception)
  return tc(MCU_STATE_META[state].label, 'mcu-state')
}

/** The state's colour (UX helper H6 stateColor): a fault handler is red like a lockup. */
export function mcuStateColor(state: McuViewState): string {
  return stateColor(mcuStateTone(state))
}

export function McuStateBadge({ state, exception }: { state: McuViewState; exception?: number | null }) {
  useLang()
  const meta = mcuStateMeta(state)
  const label = mcuStateLabel(state, exception)
  return (
    <span
      className={`emb-state ${state === 'running' ? 'is-live' : ''}`}
      // the app's one colour per state (UX helper H6): 沒有供電 is red here as on the pill
      style={{ ['--emb-state' as string]: mcuStateColor(state) }}
      title={t(meta.hint)}
      role="status"
      aria-label={t('MCU state: {state}', { state: label })}
    >
      <span className="emb-state-dot" aria-hidden="true" />
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Firmware
// ---------------------------------------------------------------------------

/**
 * Bind `file` to the board through the lab's real loader, with the usual
 * feedback (haptic, toast with the warning count, capsule detail). Returns
 * the localized error text, or null when the board has the image.
 */
export async function bindFirmwareFile(
  componentId: string,
  file: { name: string; bytes: Uint8Array },
  binBase?: number,
): Promise<string | null> {
  try {
    const res = await useLab.getState().loadFirmware(componentId, file, binBase !== undefined ? { binBase } : undefined)
    if (!res.ok) return res.error ? tMessage(res.error) : t('The firmware could not be loaded')
    // a raw .bin: this session keeps its bytes for 「改用 0x08000000 重新載入」 (the firmware store has them too)
    if (binBase !== undefined) binBytes.set(componentId, file.bytes)
    else binBytes.delete(componentId)
    tick()
    const w = res.warnings?.length ?? 0
    showToast(
      t('{file} loaded into {id}', { file: file.name, id: componentId }) +
        (w > 0 ? t(w === 1 ? ' · {n} warning' : ' · {n} warnings', { n: w }) : ''),
    )
    // the toast above already said it: the new chrome's capsule stays quiet (SH-13 (6)); classic flashes it as before
    pushCapsuleDetail(t('{id}: firmware {file} loaded — MCU reset', { id: componentId, file: file.name }), { toasted: true })
    return null
  } catch (err) {
    return tMessage(err instanceof Error ? err.message : String(err))
  }
}

/** The bytes of the .bin each board was last given in this session (reloadBinAtDefault). */
const binBytes = new Map<string, Uint8Array>()

/**
 * 「改用 0x08000000 重新載入」 (QA clarity LOCKUP-CAUSE): the bound .bin once
 * more, from its own bytes (this session's copy, else the firmware store by
 * its SHA-256 — checked), through lab.loadFirmware at the default base, with
 * the usual feedback (bindFirmwareFile). Returns the localized error (also
 * left in the firmware card's error slot), or null when it was reloaded.
 */
export async function reloadBinAtDefault(componentId: string): Promise<string | null> {
  const rec = useLab.getState().firmware[componentId]
  if (!rec || rec.format !== 'bin') return null
  setFirmwareUi(componentId, { busy: true, error: null })
  try {
    const own = binBytes.get(componentId)
    let bytes = own && sha256Hex(own) === rec.sha256 ? own : null
    if (!bytes) {
      const stored = await firmwareBlobStore()
        .get(rec.sha256)
        .catch(() => null)
      bytes = stored && sha256Hex(stored) === rec.sha256 ? stored : null
    }
    const err = bytes
      ? await bindFirmwareFile(componentId, { name: rec.name, bytes }, DEFAULT_BIN_BASE)
      : t('The bytes of {file} are no longer available — choose the file again and load it at 0x08000000.', { file: rec.name })
    if (err) setFirmwareUi(componentId, { error: err })
    return err
  } finally {
    setFirmwareUi(componentId, { busy: false })
  }
}

/** A built-in firmware/dist project → the board (the picker's onPick). */
export async function bindBundledFirmware(componentId: string, name: string): Promise<string | null> {
  try {
    return await bindFirmwareFile(componentId, await loadBundledFirmware(name))
  } catch (err) {
    return tMessage(err instanceof Error ? err.message : String(err))
  }
}

/**
 * This board's loader findings since its binding (IN-11): the soc logs its
 * programming warnings ("no vector table at 0x08000000 …") under
 * `<id>/loader` right after "… bytes programmed into flash"; read back to
 * that line only. Re-reads when the log grows (≤ 10 Hz, a short backward scan).
 */
function useLoaderWarnings(componentId: string, record: FirmwareRecord | undefined): string[] {
  const logVersion = useLab((s) => s.logVersion)
  const [out, setOut] = useState<string[]>([])
  useEffect(() => {
    if (!record) {
      setOut((o) => (o.length ? [] : o))
      return
    }
    const source = `${componentId}/loader`
    const log = labBuffers.log()
    const found: string[] = []
    for (let i = log.length - 1; i >= 0 && log.length - i < 400; i--) {
      const e = log[i]
      if (e.source !== source) continue
      if (e.level === 'info' && / bytes programmed into flash /.test(e.message)) break
      if (e.level !== 'info') found.unshift(e.message)
    }
    const fresh = found.filter((m) => !record.warnings.includes(m))
    setOut((o) => (o.length === fresh.length && o.every((m, i) => m === fresh[i]) ? o : fresh))
  }, [componentId, record, logVersion])
  return out
}

/** A loader warning as a sentence: Chinese text ends with 「。」 so the next sentence follows cleanly. */
function sentence(text: string): string {
  return /[一-鿿）」]$/.test(text) ? `${text}。` : text
}

/** The File System Access API picker (Chromium / Edge; feature-detected — other browsers use the file input). */
type ShowOpenFilePicker = (opts: {
  multiple?: boolean
  types?: { description: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandle[]>

/**
 * showOpenFilePicker when the browser has it — except in an automated
 * browser (navigator.webdriver): test drivers can only answer an
 * <input type=file>, and Chromium aborts the FSA picker they intercept.
 */
function fsaPicker(): ShowOpenFilePicker | null {
  if (typeof window === 'undefined' || (typeof navigator !== 'undefined' && navigator.webdriver)) return null
  const p = (window as unknown as { showOpenFilePicker?: ShowOpenFilePicker }).showOpenFilePicker
  return typeof p === 'function' ? p : null
}

/** Files picked through showOpenFilePicker, per board, for this session (⟳ 重新載入 / watching). */
const fileHandles = new Map<string, { handle: FileSystemFileHandle; lastModified: number; name: string }>()
/** Boards whose file is re-read on change. */
const autoReloadOn = new Set<string>()

/**
 * The firmware file flow of one board, shared by the full firmware card and
 * the status card's summary row (either can pick or take a dropped file):
 * a .bin waiting for its load address, the busy flag, the last error, and a
 * counter that bumps when a re-readable file handle was stored.
 */
interface FirmwareUi {
  pending: File | null
  busy: boolean
  error: string | null
  handles: number
}
const NO_FW_UI: FirmwareUi = { pending: null, busy: false, error: null, handles: 0 }
const useFirmwareUi = create<Record<string, FirmwareUi>>(() => ({}))

function firmwareUi(componentId: string): FirmwareUi {
  return useFirmwareUi.getState()[componentId] ?? NO_FW_UI
}
function setFirmwareUi(componentId: string, patch: Partial<FirmwareUi>): void {
  useFirmwareUi.setState((s) => ({ [componentId]: { ...(s[componentId] ?? NO_FW_UI), ...patch } }))
}
function useFirmwareUiOf(componentId: string): FirmwareUi {
  return useFirmwareUi((s) => s[componentId] ?? NO_FW_UI)
}

/** Read `file` and bind it through the real loader; a failure stays in the board's error slot. */
async function loadFirmwareFile(componentId: string, file: File, at?: number): Promise<void> {
  setFirmwareUi(componentId, { busy: true, error: null })
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const err = await bindFirmwareFile(componentId, { name: file.name, bytes }, at)
    setFirmwareUi(componentId, err ? { error: err } : { pending: null })
  } catch (err) {
    setFirmwareUi(componentId, { error: tMessage(err instanceof Error ? err.message : String(err)) })
  } finally {
    setFirmwareUi(componentId, { busy: false })
  }
}

/** What a firmware file led to (acceptFirmwareFile). */
export type FirmwareFileOutcome = 'loading' | 'needs-address' | 'refused'

/** Does `name` look like a firmware image the loader takes (.elf / .bin / .hex)? */
export function isFirmwareFileName(name: string): boolean {
  return /\.(elf|bin|hex)$/i.test(name)
}

/**
 * A chosen / dropped file: ELF and HEX load at once; a .bin waits for its
 * load address (the firmware card asks); anything else is refused. Returns
 * what happened so a host without the address field can bring the card up.
 *
 * Exported for the 3D canvas drop (UX helper H11 — SC-15): the same toasts,
 * the same UART 「── … 載入 … · 重置 ──」 separator and the same error slot as
 * the firmware card. On 'needs-address' the caller brings the card up
 * (focusInspector(id, { tab: 'firmware' })); on 'refused' the card's error
 * slot holds the reason and the caller says 「只接受 .elf、.bin 或 .hex 韌體檔」.
 */
export function acceptFirmwareFile(componentId: string, file: File): FirmwareFileOutcome {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (!isFirmwareFileName(file.name)) {
    const current = useLab.getState().firmware[componentId]?.name
    setFirmwareUi(componentId, {
      error: current
        ? t('{name} was not loaded ({id} keeps {current}): it needs an .elf, .bin or .hex file', { name: file.name, id: componentId, current })
        : t('{name} was not loaded: it needs an .elf, .bin or .hex file', { name: file.name }),
    })
    return 'refused'
  }
  if (ext === 'bin') {
    setFirmwareUi(componentId, { pending: file, error: null })
    return 'needs-address'
  }
  setFirmwareUi(componentId, { error: null })
  void loadFirmwareFile(componentId, file)
  return 'loading'
}

/**
 * The hidden file input + "pick a file": the FSA picker (its handle is kept
 * for ⟳ 重新載入) or the input. `onAccepted` hears what the file led to.
 */
function useFirmwarePicker(componentId: string, onAccepted?: (r: ReturnType<typeof acceptFirmwareFile>) => void) {
  const fileRef = useRef<HTMLInputElement>(null)
  const take = (file: File) => {
    const r = acceptFirmwareFile(componentId, file)
    onAccepted?.(r)
  }
  /** call straight from the click handler: the input path must open inside the user gesture */
  const pick = async () => {
    const picker = fsaPicker()
    if (!picker) {
      fileRef.current?.click()
      return
    }
    try {
      const [handle] = await picker({
        multiple: false,
        types: [{ description: t('Firmware image'), accept: { 'application/octet-stream': ['.elf', '.bin', '.hex'] } }],
      })
      if (!handle) return
      const file = await handle.getFile()
      fileHandles.set(componentId, { handle, lastModified: file.lastModified, name: file.name })
      setFirmwareUi(componentId, { handles: firmwareUi(componentId).handles + 1 })
      take(file)
    } catch (err) {
      // the user closed the dialog: nothing to do; anything else: the classic input still works
      if (err instanceof DOMException && err.name === 'AbortError') return
      fileRef.current?.click()
    }
  }
  const input = (
    <input
      ref={fileRef}
      type="file"
      accept={ACCEPT}
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = '' // re-picking the same file must fire again
        if (f) take(f)
      }}
    />
  )
  return { input, pick, take }
}

/** Drag-and-drop of one file onto a host element (fine pointers; the highlight follows enter / leave). */
function useFileDrop(onFile: (file: File) => void) {
  const [depth, setDepth] = useState(0)
  const dragProps = {
    onDragEnter: (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setDepth((d) => d + 1)
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: () => setDepth((d) => Math.max(0, d - 1)),
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      setDepth(0)
      const file = e.dataTransfer.files?.[0]
      if (file) onFile(file)
    },
  }
  return { over: depth > 0, dragProps }
}

export function FirmwareGroup({ componentId }: { componentId: string }) {
  const record = useLab((s) => s.firmware[componentId])
  const clearFirmware = useLab((s) => s.clearFirmware)
  const { pending: pendingBin, busy, error } = useFirmwareUiOf(componentId)
  const [binBase, setBinBase] = useState(DEFAULT_BIN_TEXT)
  const [picker, setPicker] = useState<HTMLElement | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const pickBtnRef = useRef<HTMLButtonElement>(null)
  const coarse = useCoarsePointer() // touch devices pick files; there is nothing to drag
  const base = parseAddress(binBase)
  const loaderWarnings = useLoaderWarnings(componentId, record)
  const { input, pick, take } = useFirmwarePicker(componentId)
  const { over, dragProps } = useFileDrop(take)
  useLang()

  const loadPendingBin = () => {
    if (!pendingBin) return
    if (base === null) {
      setFirmwareUi(componentId, { error: t('Enter a valid BIN load address (e.g. 0x08000000)') })
      return
    }
    void loadFirmwareFile(componentId, pendingBin, base)
  }

  const watched = fileHandles.get(componentId)
  const canReload = !!record && !!watched && watched.name === record.name
  /** re-read the same file from disk through the normal loader (a .bin keeps its load address) */
  const reload = async (silentIfUnchanged = false): Promise<void> => {
    const w = fileHandles.get(componentId)
    if (!w || firmwareUi(componentId).busy) return
    try {
      const file = await w.handle.getFile()
      if (silentIfUnchanged && file.lastModified === w.lastModified) return
      w.lastModified = file.lastModified
      const rec = useLab.getState().firmware[componentId]
      const at = rec?.format === 'bin' ? (boundBinBase(rec) ?? undefined) : undefined
      await loadFirmwareFile(componentId, file, at)
    } catch (err) {
      setFirmwareUi(componentId, { error: tMessage(err instanceof Error ? err.message : String(err)) })
    }
  }
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  const [autoReload, setAutoReload] = useState(() => autoReloadOn.has(componentId))
  useEffect(() => {
    if (!autoReload || !canReload) return
    // poll the file's lastModified once a second while this tab is visible (a real re-read on change)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reloadRef.current(true)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [autoReload, canReload])
  const openPicker = (anchor: HTMLElement | null) => {
    setPicker(anchor ?? cardRef.current)
    setPickerOpen(true)
  }
  const boundBase = record?.format === 'bin' ? boundBinBase(record) : null
  const nonDefault = (n: number | null) => n !== null && n !== 0x08000000

  return (
    <div ref={cardRef} id={`fw-${componentId}`} className={`emb-fw ${over ? 'is-dragover' : ''}`} {...dragProps}>
      {input}
      <ListGroup
        header={t('Firmware')}
        footer={
          record
            ? coarse
              ? undefined
              : t('Drop another image anywhere on this card to replace it.')
            : tNodes(
                'Real Cortex-M3 machine code runs in the simulator — build with STM32CubeIDE, {pio} or the repo {dir} toolchain.',
                { pio: noTranslate('PlatformIO'), dir: noTranslate('firmware/') },
              )
        }
      >
        {record ? (
          <>
            <ListRow
              leading={<ChipIcon size={20} />}
              title={<span className="emb-mono emb-fw-name">{record.name}</span>}
              subtitle={
                <>
                  {`${record.format.toUpperCase()} · ${fmtBytes(record.size)} · `}
                  {noTranslate(`SHA-256 ${record.sha256.slice(0, 12)}`)}
                </>
              }
            />
            {record.description && (
              <div className="lg-row emb-fw-desc" role="listitem">
                {/* addresses in the inspector's one form (fmtAddr): 「Thumb 進入點 0x08000B45」 beside 「PC 0x0800074A」 */}
                <span className="emb-mono">{upperAddresses(firmwareDescriptionText(record.description))}</span>
              </div>
            )}
            {[...record.warnings, ...loaderWarnings].map((w, i) => (
              <div key={`${i}:${w}`} className="lg-row emb-issue insp-fw-warn" role="listitem">
                <span className="emb-dot" aria-label={t('warning')} />
                <span className="emb-issue-text">
                  {sentence(tMessage(w))}
                  {record.format === 'bin' && /no vector table at 0x08000000/.test(w) && (
                    <>
                      {/[。！？]$/.test(sentence(tMessage(w))) ? '' : ' '}
                      <b>{t('Load the .bin at 0x08000000, or use the ELF file.')}</b>
                    </>
                  )}
                </span>
              </div>
            ))}
            {boundBase !== null && (
              <div className="lg-row emb-fw-base" role="listitem">
                <span className="emb-fw-base-label">{t('BIN load address')}</span>
                <span className="emb-mono lg-tabular">{fmtAddr(boundBase)}</span>
              </div>
            )}
            {boundBase !== null && nonDefault(boundBase) && (
              <div className="lg-row insp-fw-binbase-fix" role="listitem">
                <span className="insp-fw-binbase-note">{t('Not the default address: the vector table must be at 0x08000000.')}</span>
                {/* the fix in one click, the same button as the 執行狀態 card's (QA clarity LOCKUP-CAUSE) */}
                <ChipButton accent disabled={busy} onClick={() => void reloadBinAtDefault(componentId)}>
                  {busy ? t('Loading…') : t('Reload at 0x08000000')}
                </ChipButton>
              </div>
            )}
            {!pendingBin && canReload && (
              <>
                <ListRow
                  leading={<ResetIcon size={20} />}
                  title={busy ? t('Loading…') : t('Reload {file} from disk', { file: record.name })}
                  disabled={busy}
                  onPress={() => void reload()}
                />
                <ListRow
                  title={t('Reload when the file changes')}
                  subtitle={t('Checks the file once a second while this window is visible')}
                  trailing={
                    <Switch
                      checked={autoReload}
                      onChange={(on) => {
                        if (on) autoReloadOn.add(componentId)
                        else autoReloadOn.delete(componentId)
                        setAutoReload(on)
                      }}
                      aria-label={t('Reload when the file changes')}
                    />
                  }
                />
              </>
            )}
            {!pendingBin && (
              <>
                <ListRow
                  leading={<BookIcon size={20} />}
                  title={t('Use built-in firmware…')}
                  disabled={busy}
                  onPress={() => openPicker(document.activeElement instanceof HTMLElement ? document.activeElement : null)}
                />
                <ListRow
                  leading={<ImportIcon size={20} />}
                  title={busy ? t('Loading…') : t('Replace firmware…')}
                  disabled={busy}
                  onPress={() => void pick()}
                />
                <ListRow
                  leading={<TrashIcon size={20} />}
                  title={t('Remove firmware')}
                  destructive
                  disabled={busy}
                  onPress={() => {
                    clearFirmware(componentId)
                    tick(16)
                    showToast(t('Firmware removed from {id}', { id: componentId }))
                  }}
                />
              </>
            )}
          </>
        ) : (
          !pendingBin && (
            <div className="lg-row insp-fw-empty" role="listitem" aria-busy={busy}>
              <span className="insp-fw-empty-title">
                <ChipIcon size={20} />
                {busy ? t('Loading…') : t('{id} has no firmware yet — pick a built-in firmware or load one from your computer', { id: componentId })}
              </span>
              <span className="insp-fw-btns">
                <PressableButton
                  ref={pickBtnRef}
                  size="md"
                  variant="filled"
                  icon={<BookIcon size={18} />}
                  disabled={busy}
                  aria-haspopup="dialog"
                  aria-expanded={pickerOpen}
                  onClick={() => openPicker(pickBtnRef.current)}
                >
                  {t('Choose built-in firmware')}
                </PressableButton>
                <PressableButton size="md" variant="tinted" icon={<ImportIcon size={18} />} disabled={busy} onClick={() => void pick()}>
                  {t('Choose a file on this computer…')}
                </PressableButton>
              </span>
              {!coarse && <span className="insp-fw-hint">{t('You can also drop an .elf / .bin / .hex onto this card.')}</span>}
            </div>
          )
        )}
        {pendingBin && (
          <>
            <ListRow leading={<ImportIcon size={20} />} title={<span className="emb-mono emb-fw-name">{pendingBin.name}</span>} subtitle={t('Raw binary: choose where it goes in flash')} />
            <div className="lg-row emb-fw-base" role="listitem">
              <label className="emb-fw-base-label" htmlFor={`binbase-${componentId}`}>
                {t('BIN load address')}
              </label>
              <input
                id={`binbase-${componentId}`}
                className={`emb-field emb-mono emb-fw-base-input ${base === null ? 'is-invalid' : ''}`}
                value={binBase}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="none"
                inputMode="text"
                aria-invalid={base === null}
                aria-describedby={`binbase-hint-${componentId}`}
                onChange={(e) => setBinBase(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadPendingBin()
                }}
              />
              <span id={`binbase-hint-${componentId}`} className="emb-visually-hidden">
                {t('Used only for raw .bin images; ELF and Intel HEX carry their own addresses.')}
              </span>
            </div>
            {nonDefault(base) && (
              <div className="lg-row" role="listitem">
                <span className="insp-fw-binbase-note">{t('Not the default address: the vector table must be at 0x08000000.')}</span>
              </div>
            )}
            <div className="lg-row emb-run-ctl" role="listitem">
              <PressableButton
                size="sm"
                variant="filled"
                className="emb-btn-flex"
                disabled={busy || base === null}
                title={t('Load {file}', { file: pendingBin.name })}
                onClick={loadPendingBin}
              >
                {busy ? t('Loading…') : t('Load|bin')}
              </PressableButton>
              <PressableButton
                size="sm"
                variant="tinted"
                className="emb-btn-flex"
                disabled={busy}
                onClick={() => setFirmwareUi(componentId, { pending: null, error: null })}
              >
                {t('Cancel')}
              </PressableButton>
            </div>
          </>
        )}
      </ListGroup>
      {error && (
        <div className="asm-error emb-fw-error" role="alert">
          <div className="asm-error-title">{t('Firmware not loaded')}</div>
          <div className="asm-error-msg">{error}</div>
        </div>
      )}
      {pickerOpen && (
        <BundledFirmwarePicker
          componentId={componentId}
          anchor={picker}
          current={record?.name ?? null}
          onClose={() => setPickerOpen(false)}
          onPick={(name) => bindBundledFirmware(componentId, name)}
        />
      )}
    </div>
  )
}

/** The last firmware-picker request (useFirmwarePickerRequest) a status card opened: each opens once. */
let consumedPickSeq = 0

/**
 * The firmware summary row of the MCU status card (IN-6): 「hal-blink.elf ·
 * ELF · 212 KiB」 + 「韌體詳情」 (the 韌體 tab), or 「這塊板子還沒有韌體」 with
 * 「選擇內建韌體」 (the picker, anchored right here — two clicks from selecting
 * the board to a running image) and 「從電腦選擇檔案…」. A file dropped on
 * the row loads too; a .bin, a refused file or a loader error brings up the
 * 韌體 tab, where the address field and the error live (`onDetails`).
 */
export function FirmwareSummary({ componentId, onDetails }: { componentId: string; onDetails: () => void }) {
  const record = useLab((s) => s.firmware[componentId])
  const { busy, error } = useFirmwareUiOf(componentId)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  // 「載入韌體…」 (the pill, a problem row, a lesson): open the picker right here, once per request,
  // anchored to the button that asked when it is still on screen
  const pickRequest = useFirmwarePickerRequest((s) => s.request)
  useEffect(() => {
    if (!pickRequest || pickRequest.componentId !== componentId || pickRequest.seq <= consumedPickSeq) return
    consumedPickSeq = pickRequest.seq
    const a = pickRequest.anchor
    setAnchor(a && a.isConnected && a.getClientRects().length > 0 ? a : (btnRef.current ?? rowRef.current))
    setOpen(true)
  }, [pickRequest, componentId])
  const coarse = useCoarsePointer()
  const details = useRef(onDetails)
  details.current = onDetails
  const { input, pick, take } = useFirmwarePicker(componentId, (r) => {
    if (r !== 'loading') details.current()
  })
  const { over, dragProps } = useFileDrop(take)
  // a load that failed after it started: its error is on the firmware card
  // (only a NEW error — reopening the board must not jump to an old one)
  const lastError = useRef(error)
  useEffect(() => {
    if (error && error !== lastError.current) details.current()
    lastError.current = error
  }, [error])
  useLang()
  return (
    <div
      ref={rowRef}
      className={`lg-row insp-fw-summary ${record ? '' : 'is-empty'} ${over ? 'is-dragover' : ''}`}
      role="listitem"
      aria-busy={busy}
      {...(coarse ? {} : dragProps)}
    >
      {/* the same hidden file input as the firmware card (scripts set files on `.emb-fw input`) */}
      <span className="emb-fw" hidden>
        {input}
      </span>
      <span className="insp-fw-summary-line">
        <span className="insp-fw-summary-icon" aria-hidden="true">
          <ChipIcon size={18} />
        </span>
        {record ? (
          <span className="insp-fw-summary-text" title={record.name}>
            <span className="emb-mono emb-fw-name" translate="no">
              {record.name}
            </span>
            <span className="insp-fw-summary-meta">{`${record.format.toUpperCase()} · ${fmtBytes(record.size)}`}</span>
          </span>
        ) : (
          <span className="insp-fw-summary-text is-missing">
            {busy ? t('Loading…') : t('{id} has no firmware yet — pick a built-in firmware or load one from your computer', { id: componentId })}
          </span>
        )}
        {record && <ChipButton onClick={onDetails}>{t('Firmware details')}</ChipButton>}
      </span>
      {!record && (
        <span className="insp-fw-summary-btns">
          <PressableButton
            ref={btnRef}
            size="sm"
            variant="filled"
            icon={<BookIcon size={16} />}
            disabled={busy}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => {
              setAnchor(btnRef.current)
              setOpen(true)
            }}
          >
            {t('Choose built-in firmware')}
          </PressableButton>
          <PressableButton size="sm" variant="tinted" icon={<ImportIcon size={16} />} disabled={busy} onClick={() => void pick()}>
            {t('Choose a file on this computer…')}
          </PressableButton>
        </span>
      )}
      {open && (
        <BundledFirmwarePicker
          componentId={componentId}
          anchor={anchor}
          current={record?.name ?? null}
          onClose={() => setOpen(false)}
          onPick={(name) => bindBundledFirmware(componentId, name)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Execution / debugger
// ---------------------------------------------------------------------------

/**
 * Poll the debugger snapshot (PC symbol, registers) while the core exists.
 * A null answer (host gone / query failed — the lab logs why) stops the
 * polling until the run state changes, so a failing host is never spammed.
 */
function useMcuDebug(
  componentId: string,
  enabled: boolean,
  state: McuViewState,
  /** changes when a stopped core moved (e.g. cycles after a single-step) */
  refreshKey: number,
): McuDebugState | null {
  const queryMcuDebug = useLab((s) => s.queryMcuDebug)
  const [dbg, setDbg] = useState<McuDebugState | null>(null)
  useEffect(() => {
    if (!enabled) {
      setDbg(null)
      return
    }
    let alive = true
    let inflight = false
    let timer = 0
    const poll = () => {
      if (inflight) return
      inflight = true
      queryMcuDebug(componentId)
        .then((d) => {
          if (!alive) return
          setDbg(d)
          if (d === null) window.clearInterval(timer)
        })
        .catch(() => {
          if (!alive) return
          setDbg(null)
          window.clearInterval(timer)
        })
        .finally(() => {
          inflight = false
        })
    }
    poll()
    // a halted / locked-up / paused core does not change on its own: one read is enough
    if (state === 'running' || state === 'sleeping' || state === 'boot-sysmem' || state === 'fault-handler') timer = window.setInterval(poll, DEBUG_POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [componentId, enabled, state, refreshKey, queryMcuDebug])
  return dbg
}

/** Holes of the board's 5V / 3V3 / GND header pins (the 「在電路板上標示電源腳」 link). */
function powerPinHoles(componentId: string): string[] {
  const s = useStore.getState()
  const comp = s.layout.components.find((c) => c.id === componentId)
  const entry = comp ? getEntry(comp.type) : undefined
  if (!comp || !entry) return []
  const holes = componentPinHoles(comp, entry, boardConfigOf(s.layout))
  if (!holes) return []
  const out: string[] = []
  entry.pins.forEach((pin, i) => {
    const kind = entry.pinInfo?.find((p) => p.pin === pin)?.kind
    const supply = /^(5V|3V3|GND)/.test(pin) || ((kind === 'power' || kind === 'ground') && pin !== 'VBAT')
    const h = holes[i]
    if (supply && h) out.push(formatHole(h))
  })
  return out
}

/**
 * Reason + fix under the state chip (null = nothing to explain) — THE place
 * in the inspector where a board-state fact of this board (H5 blockerKindOf:
 * power / firmware / lockup / halt / BOOT0) is explained, once (QA IN-F3):
 * the problem card above shows only its title and 「見下方執行狀態」, the
 * inspector's problems list leaves the row out. The words are the problem
 * row's own (an ERC power finding's explanation, the MCU rows' sentences).
 */
function StateReason({
  componentId,
  state,
  pc,
  symbol,
  exception,
  fault,
}: {
  componentId: string
  state: McuViewState
  pc: number | null
  symbol: string | undefined
  exception: number | null
  fault: FaultRegisters | null
}) {
  const vdd = useStore((s) => {
    const comp = s.layout.components.find((c) => c.id === componentId)
    const pin = comp ? getEntry(comp.type)?.mcu?.vddPin : undefined
    return pin ? s.telemetry?.components[componentId]?.pinVoltages?.[pin] : undefined
  })
  const coarse = useCoarsePointer() // phones have no Space bar
  // why the core locked up, when the bound image says so (QA clarity LOCKUP-CAUSE)
  const cause = useLockupCause(componentId, state === 'lockup')
  const { busy } = useFirmwareUiOf(componentId)
  // a power problem the problems list states for this board (ERC: no GND, no supply …) — the
  // reason here is that problem's own explanation, never a second wording; whatever the chip
  // says (尚未執行 before the first run, 還沒有韌體 …): without power nothing else can happen
  const blocker = useBoardBlocker(componentId)
  const powerDetail = blocker?.kind === 'power' && blocker.problem.source !== 'mcu' ? blocker.problem.detail : null
  const showPowerPins = (
    <ChipButton onClick={() => focusInScene({ holes: powerPinHoles(componentId) }, { kind: 'problem', level: 'error' })}>
      {t('Show on the board')}
    </ChipButton>
  )
  // a core in its fault handler (QA IN-F7) — also once halted there (「查看暫存器」 halts it)
  const inFault = (state === 'fault-handler' || state === 'halted') && faultExceptionName(exception) !== null
  let text: ReactNode = null
  let actions: ReactNode = null
  if (powerDetail !== null) {
    text = powerDetail
    actions = showPowerPins
  } else if (inFault) {
    text = faultHandlerDetail(exception, fault)
    actions = (
      <>
        {state !== 'halted' && <ChipButton onClick={() => showRegisters(componentId)}>{t('See the registers')}</ChipButton>}
        <ChipButton onClick={() => openSimulationLog()}>{t('Show in the simulation log')}</ChipButton>
      </>
    )
  } else switch (state) {
    case 'idle':
      text = coarse ? t('Press “▶ Run” to start the simulation.') : t('Press “▶ Run” or the Space bar to start the simulation.')
      break
    case 'no-data':
      text = t('Waiting for the first report from the simulation…')
      break
    case 'no-firmware':
      // the words of the 「U1 還沒有韌體」 problem row; the buttons are the firmware row below
      text = t('This board has no program to run. Pick a built-in firmware (for example hal-blink) or load an .elf / .bin / .hex file from your computer.')
      break
    case 'paused':
      // the simulation waits — not a debugger halt; the address and the function are identifiers (never translated)
      text = tNodes('Simulation paused (PC {pc})', { pc: noTranslate(pc !== null ? `${fmtAddr(pc)}${symbol ? ` ${symbol}` : ''}` : '—') })
      break
    case 'unpowered':
      text =
        vdd !== undefined
          ? t('VDD {v}: the MCU is held in reset. Connect the 5V or 3V3 pin to a supply and the G pin to the − rail.', {
              v: fmtReadingVoltage(vdd),
            })
          : t('No supply voltage: the MCU is held in reset. Connect the 5V or 3V3 pin to a supply and the G pin to the − rail.')
      actions = showPowerPins
      break
    case 'reset':
      // a board without a ground reference also reads NRST low: the power problem (above) is the cause
      text = t('NRST is held low, so the MCU stays in reset. Make sure the R pin is not wired to GND.')
      break
    case 'boot-sysmem':
      text = t(
        'BOOT0 = 1: the MCU starts the built-in bootloader, which is not simulated. Set the BOOT0 jumper back to 0, then press Reset MCU.',
      )
      break
    case 'lockup':
      // the cause the app knows (a .bin at another base, a bad vector table) — the problem row's own words —
      // else the common causes; one label for one action: 「在模擬日誌中檢視」 as on the problem rows
      text = cause
        ? lockupCauseText(cause)
        : t('The core hit a fault while handling a fault and stopped. Common causes: no vector table at 0x08000000, or a bad stack pointer.')
      actions = (
        <>
          {cause?.kind === 'bin-base' && (
            <ChipButton accent disabled={busy} onClick={() => void reloadBinAtDefault(componentId)}>
              {busy ? t('Loading…') : t('Reload at 0x08000000')}
            </ChipButton>
          )}
          <ChipButton onClick={() => openSimulationLog()}>{t('Show in the simulation log')}</ChipButton>
        </>
      )
      break
    case 'halted':
      text = t('The debugger stopped the core, so the whole simulation is frozen. Resume to keep running.')
      break
    case 'sleeping':
      text = t('The core waits in WFI / WFE for an interrupt — normal for low-power firmware.')
      break
    default:
      return null
  }
  return (
    <>
      <span className="insp-reason">{text}</span>
      {actions && <span className="insp-reason-actions">{actions}</span>}
    </>
  )
}

/**
 * The known cause of this board's lockup (QA clarity LOCKUP-CAUSE): the bound
 * image's facts and the loader's warnings since its binding. Reads nothing
 * while `active` is false (the log scan runs only for a locked-up board).
 */
function useLockupCause(componentId: string, active: boolean): LockupCause | null {
  const record = useLab((s) => s.firmware[componentId])
  const loaderWarnings = useLoaderWarnings(componentId, active ? record : undefined)
  return active ? lockupCauseOf(record, loaderWarnings) : null
}

/** Everything the MCU views read about one board, polled once per host (status card + stats). */
export interface McuView {
  live: McuLive
  dbg: McuDebugState | null
  /** PC to show (null = 「—」) and its function */
  pc: number | null
  symbol: string | undefined
  /** a core exists (firmware bound, powered, run since the reset) */
  hasCore: boolean
  halted: boolean
  /** halted or locked up */
  stopped: boolean
  /** PC / cycles / clock / speed mean nothing in this state */
  hide: boolean
}

export function useMcuView(componentId: string): McuView {
  const live = useMcuLive(componentId)
  const state = live.state
  const hasCore = !['no-data', 'no-firmware', 'unpowered', 'idle'].includes(state)
  const halted = state === 'halted'
  const stopped = halted || state === 'lockup'
  const hide = mcuReadoutsHidden(state)
  const dbg = useMcuDebug(componentId, hasCore, state, stopped ? (live.cycles ?? 0) : 0)
  // the debugger snapshot's PC matches its symbol; frames are the fallback
  const pc = hide ? null : dbg ? (dbg.registers.r[15] ?? live.pc) : live.pc
  const symbol = hide ? undefined : dbg?.pcSymbol
  return { live, dbg, pc, symbol, hasCore, halted, stopped, hide }
}

/**
 * The capsule line a lockup flashes once (QA clarity LOCKUP-CAUSE): the
 * pill's words 「U1 故障（鎖死）——查看原因」, and — the line names its target
 * — a tap on the capsule opens what the pill's 查看原因 opens: the 概況 tab,
 * scrolled to the board's 執行狀態 card (release close-out). The classic
 * chrome keeps its own line and its tap (run / pause).
 */
export function lockupCapsuleLine(componentId: string): { text: string; opts: CapsuleDetailOptions } {
  return {
    text: isLegacyChrome()
      ? t('{id}: core LOCKUP — see the Simulation log', { id: componentId })
      : t('{id} fault (lockup) — see why', { id: componentId }),
    opts: isLegacyChrome() ? {} : { action: () => showExecutionState(componentId) },
  }
}

/**
 * The board's status card (always on top of the MCU inspector, IN-2 / IN-6):
 * state chip + reason line, ▶ Run / ❚❚ Pause — or ▶ 繼續執行 after a
 * debugger halt — and Reset MCU, plus (optionally) the firmware summary row.
 */
export function McuStatusGroup({
  componentId,
  view,
  firmwareRow,
}: {
  componentId: string
  view: McuView
  /** the firmware summary row (the MCU inspector's tabs put the full card elsewhere) */
  firmwareRow?: ReactNode
}) {
  const running = useStore((s) => s.running)
  const startSim = useStore((s) => s.startSim)
  const stopSim = useStore((s) => s.stopSim)
  const hasFirmware = useLab((s) => s.firmware[componentId] != null)
  const mcuReset = useLab((s) => s.mcuReset)
  useLang()
  const state = view.live.state

  // a fault is worth interrupting for: flash it in the capsule once per entry — in the pill's words,
  // which name the same target (「查看原因」 opens this card — QA clarity LOCKUP-CAUSE)
  const prevState = useRef(state)
  useEffect(() => {
    if (state === 'lockup' && prevState.current !== 'lockup') {
      const line = lockupCapsuleLine(componentId)
      pushCapsuleDetail(line.text, line.opts)
    }
    prevState.current = state
  }, [state, componentId])

  return (
    <ListGroup header={tc('Execution', 'section')}>
      {/* #exec-{id}: 「見下方執行狀態」 on the part's problem card scrolls here (QA IN-F3) */}
      <div id={`exec-${componentId}`} className="lg-row insp-state-row" role="listitem" tabIndex={-1}>
        <span className="insp-state-line">
          <McuStateBadge state={state} exception={view.live.exception} />
        </span>
        <StateReason
          componentId={componentId}
          state={state}
          pc={view.pc}
          symbol={view.symbol}
          exception={view.live.exception}
          fault={view.live.fault}
        />
      </div>
      <div className="lg-row emb-run-ctl" role="listitem">
        {view.halted ? (
          <PressableButton
            size="sm"
            variant="filled"
            className="emb-btn-run emb-btn-flex"
            icon={<PlayIcon size={16} />}
            haptic
            {...keyProps(withKey(t('Resume the halted core and the simulation'), 'halt-resume'))}
            onClick={() => runOrResume()}
          >
            {t('Resume running')}
          </PressableButton>
        ) : (
          <PressableButton
            size="sm"
            variant={running ? 'tinted' : 'filled'}
            className={running ? 'emb-btn-flex' : 'emb-btn-run emb-btn-flex'}
            icon={running ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
            haptic
            aria-label={running ? t('Pause simulation') : t('Run simulation')}
            {...keyProps(withKey(running ? t('Pause simulation') : t('Run simulation'), 'run'))}
            onClick={() => (running ? stopSim() : startSim())}
          >
            {running ? t('Pause simulation') : t('Run simulation')}
          </PressableButton>
        )}
        <PressableButton
          size="sm"
          variant="tinted"
          className="emb-btn-flex"
          icon={<ResetIcon size={16} />}
          disabled={!hasFirmware}
          {...keyProps(withKey(t('Reset MCU'), 'reset-mcu'))}
          onClick={() => {
            noteMcuReset(componentId)
            mcuReset(componentId)
            tick()
            showToast(t('{id} reset', { id: componentId }))
          }}
        >
          {t('Reset MCU')}
        </PressableButton>
      </div>
      {firmwareRow}
    </ListGroup>
  )
}

/** Core readouts (PC, cycles, clock, speed — 「—」 when meaningless), the 偵錯 row and, when stopped, the registers. */
export function McuStatsGroup({ componentId, view, header }: { componentId: string; view: McuView; header?: ReactNode }) {
  const running = useStore((s) => s.running)
  const hasFirmware = useLab((s) => s.firmware[componentId] != null)
  const mcuHalt = useLab((s) => s.mcuHalt)
  const mcuResume = useLab((s) => s.mcuResume)
  const mcuStep = useLab((s) => s.mcuStep)
  useLang()
  const { live, pc, symbol, hide, hasCore, halted, stopped, dbg } = view
  return (
    <ListGroup header={header}>
      <div className="lg-row emb-stats" role="listitem">
        <Stat label={<Term id="pc">PC</Term>} wide>
          {pc !== null ? fmtAddr(pc) : '—'}
          {symbol && (
            <span className="emb-pc-sym" translate="no">
              {symbol}
            </span>
          )}
        </Stat>
        <Stat label={<Term id="cycles">{t('Cycles')}</Term>}>{!hide && live.cycles !== null ? fmtCount(live.cycles) : '—'}</Stat>
        <Stat label={<Term id="hclk">{t('Core clock')}</Term>}>{!hide && live.hclkHz !== null ? fmtMHz(live.hclkHz) : '—'}</Stat>
        <Stat label={<Term id="speed">{t('Real time')}</Term>}>{hide || !running ? '—' : fmtSpeed(live.realtime)}</Stat>
      </div>
      {hasFirmware && (
        <div className="lg-row insp-dbg" role="listitem">
          <span className="insp-dbg-label" id={`dbg-${componentId}`}>
            {t('Debug|section')}
          </span>
          <span className="insp-dbg-btns" role="group" aria-labelledby={`dbg-${componentId}`}>
            <ChipButton
              disabled={!hasCore || stopped}
              {...keyProps(withKey(t('Stop the core where it is'), 'halt-resume'))}
              onClick={() => mcuHalt(componentId)}
            >
              {t('■ Halt core')}
            </ChipButton>
            <ChipButton
              disabled={!halted}
              {...keyProps(halted ? withKey(t('Step one instruction'), 'step') : withKey(t('Halt the core to single-step'), 'step'))}
              onClick={() => mcuStep(componentId)}
            >
              {t('Step')}
            </ChipButton>
            {/* one verb for one action (QA IN-F3): 「繼續執行」 as on the status card and the pill */}
            <ChipButton disabled={!halted} {...keyProps(withKey(t('Resume core'), 'halt-resume'))} onClick={() => mcuResume(componentId)}>
              {t('Resume running')}
            </ChipButton>
          </span>
        </div>
      )}
      {/* #regs-{id}: 「查看暫存器」 scrolls here once the halted core was read (QA IN-F7) */}
      {dbg && (halted || live.state === 'lockup') && <RegisterRows dbg={dbg} id={`regs-${componentId}`} />}
    </ListGroup>
  )
}

/** Status card + core readouts in one stack (hosts without the MCU tabs). */
export function McuRunGroup({ componentId }: { componentId: string }) {
  const view = useMcuView(componentId)
  return (
    <>
      <McuStatusGroup componentId={componentId} view={view} />
      <McuStatsGroup componentId={componentId} view={view} />
    </>
  )
}

/** withKey() as button props: the title with its key, and aria-keyshortcuts. */
function keyProps(k: { title: string; ariaKeyshortcuts?: string }): { title: string; 'aria-keyshortcuts'?: string } {
  return k.ariaKeyshortcuts ? { title: k.title, 'aria-keyshortcuts': k.ariaKeyshortcuts } : { title: k.title }
}

/** One labelled readout cell of the execution stats grid. */
function Stat({ label, wide, children }: { label: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <span className={`emb-stat ${wide ? 'is-wide' : ''}`}>
      <span className="emb-stat-label">{label}</span>
      <span className="emb-stat-value emb-mono lg-tabular">{children}</span>
    </span>
  )
}

const REG_NAMES = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'sp', 'lr', 'pc']

/** Registers whose name carries a glossary entry (QA clarity GLOSSARY-ENTRIES): pc's is the readout's. */
const REG_TERMS: Readonly<Record<string, GlossaryId>> = { sp: 'sp', lr: 'lr', pc: 'pc', xpsr: 'xpsr', ipsr: 'ipsr' }

/** A register's name cell: plain, or the glossary term (dotted underline + ⓘ) for sp / lr / pc / xpsr / ipsr. */
function RegName({ name }: { name: string }) {
  const term = REG_TERMS[name]
  return term ? (
    <span className="emb-reg-name insp-reg-term">
      <Term id={term}>{name}</Term>
    </span>
  ) : (
    <span className="emb-reg-name">{name}</span>
  )
}

/** The LR cell spans two grid columns when it carries the return function (or the EXC_RETURN tag). */
const LR_WIDE = { gridColumn: 'span 2', display: 'flex', alignItems: 'baseline', minWidth: 0 } as const
const LR_SYM = { fontSize: 'inherit', marginLeft: 8 } as const

/** LR holds an EXC_RETURN value (PM0056 §2.3.7: 0xFFFFFFF1 / F9 / FD): the core is in an exception handler. */
function isExcReturn(lr: number | undefined): boolean {
  const a = (lr ?? 0) >>> 0
  return a === 0xfffffff1 || a === 0xfffffff9 || a === 0xfffffffd
}

/** Core registers (halted / locked-up only — a running core moves too fast to read). */
export function RegisterRows({ dbg, id }: { dbg: McuDebugState; id?: string }) {
  const { registers: r, faults } = dbg
  const flags = xpsrFlags(r.xpsr)
  // a fault leaves its causes in CFSR / HFSR even when the core runs on (a handled fault)
  const bits = decodeFaultBits(faults.cfsr, faults.hfsr)
  // what LR means: the function the current one returns into, or an exception return
  const lrSym = dbg.lrSymbol
  const lrExc = !lrSym && isExcReturn(r.r[14])
  return (
    <div id={id} className="lg-row emb-regs" role="listitem" aria-label={t('Core registers')}>
      <div className="emb-regs-grid insp-regs-grid emb-mono lg-tabular">
        {REG_NAMES.map((name, i) =>
          name === 'lr' && (lrSym || lrExc) ? (
            <span
              key={name}
              className="emb-reg"
              style={LR_WIDE}
              title={lrSym ? t('Return address (LR) is in {fn}', { fn: lrSym }) : t('EXC_RETURN: the core is in an exception handler; returning loads this value into PC and unstacks the registers')}
            >
              <RegName name={name} />
              {fmtAddr(r.r[i] ?? NaN)}
              <span className="emb-pc-sym" style={LR_SYM} translate={lrSym ? 'no' : undefined}>
                {lrSym ?? t('exception return')}
              </span>
            </span>
          ) : (
            <span key={name} className="emb-reg">
              <RegName name={name} />
              {fmtAddr(r.r[i] ?? NaN)}
            </span>
          ),
        )}
        <span className="emb-reg">
          <RegName name="xpsr" />
          {fmtAddr(r.xpsr)}
        </span>
        {/* the exception number in words: 「3（HardFault）」, 「0（一般程式）」 */}
        <span className="emb-reg insp-reg-ipsr">
          <RegName name="ipsr" />
          {fmtIpsr(dbg.ipsr)}
        </span>
      </div>
      <div className="insp-flags" aria-label={t('Condition flags (xPSR)')}>
        <span className="insp-flags-label">{t('Flags')}</span>
        {(['N', 'Z', 'C', 'V'] as const).map((f) => (
          <span key={f} className={`insp-flag ${flags[f] ? 'is-on' : ''}`} title={t(FLAG_TEXT[f])}>
            {f}
          </span>
        ))}
      </div>
      {(dbg.state === 'lockup' || bits.length > 0) && (
        <>
          {bits.length > 0 && (
            <div className="insp-fault-bits" aria-label={t('Fault causes')}>
              {bits.map((b) => (
                <span key={`${b.reg}:${b.name}`} className="insp-fault-bit" title={`${b.reg}.${b.name}`}>
                  <span className="emb-mono">{b.name}</span> {t(b.text)}
                </span>
              ))}
            </div>
          )}
          {/* SCB fault status registers (ARMv7-M ARM B3.2.15 CFSR / B3.2.16 HFSR) */}
          <div className="emb-regs-grid insp-regs-grid emb-mono lg-tabular emb-regs-fault">
            <span className="emb-reg">
              <span className="emb-reg-name">cfsr</span>
              {fmtAddr(faults.cfsr)}
            </span>
            <span className="emb-reg">
              <span className="emb-reg-name">hfsr</span>
              {fmtAddr(faults.hfsr)}
            </span>
            {/* an address register means something only while its VALID bit says so (CFSR bit 7 / bit 15) */}
            <span
              className={`emb-reg ${faultAddressValid(faults.cfsr, 'mmfar') ? '' : 'insp-reg-invalid'}`}
              title={faultAddressValid(faults.cfsr, 'mmfar') ? undefined : t('Not valid: CFSR.MMARVALID (bit 7) is 0, so MMFAR holds no fault address')}
            >
              <span className="emb-reg-name">mmfar</span>
              {fmtFaultAddress(faults.mmfar, faults.cfsr, 'mmfar')}
            </span>
            <span
              className={`emb-reg ${faultAddressValid(faults.cfsr, 'bfar') ? '' : 'insp-reg-invalid'}`}
              title={faultAddressValid(faults.cfsr, 'bfar') ? undefined : t('Not valid: CFSR.BFARVALID (bit 15) is 0, so BFAR holds no fault address')}
            >
              <span className="emb-reg-name">bfar</span>
              {fmtFaultAddress(faults.bfar, faults.cfsr, 'bfar')}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

/** What each APSR flag means (English sources). */
const FLAG_TEXT: Record<'N' | 'Z' | 'C' | 'V', string> = {
  N: 'N — the last result was negative',
  Z: 'Z — the last result was zero',
  C: 'C — carry / no borrow',
  V: 'V — signed overflow',
}

// ---------------------------------------------------------------------------
// 韌體目前的設定 — what the firmware set up (QA clarity PERIPH-LIVE-CONFIG)
// ---------------------------------------------------------------------------

/**
 * The facts of one frame that 「韌體目前的設定」 reads, as one string: the
 * group re-renders when the firmware changes its set-up, not on every frame.
 * null = no frame since the board's last reset.
 */
function setupFrameKey(frame: McuFrameInfo | undefined): string | null {
  if (!frame) return null
  return JSON.stringify([frame.clocked ?? null, frame.uarts.map((u) => [u.name, u.config]), frame.mapr ?? null])
}

/** The alternate-function / analog pin modes as one string (telemetry arrives every frame; they rarely change). */
function setupModesKey(modes: Readonly<Record<string, string>> | undefined): string {
  if (!modes) return ''
  let out = ''
  for (const pin of Object.keys(modes)) {
    const m = modes[pin]
    if (m === 'af' || m === 'af-od' || m === 'an') out += `${pin}=${m};`
  }
  return out
}

/** 「TX PA9／RX PA10」 — the signals of a row and their pins. */
function signalsText(row: SetupRow): string {
  switch (row.kind) {
    case 'timer':
      return row.signals.map((s) => t('{ch} → {pin} (PWM)', { ch: s.name, pin: s.pin })).join(t(', '))
    case 'adc':
      return row.signals.map((s) => t('{ch} ← {pin}', { ch: s.name, pin: s.pin })).join(t(', '))
    default:
      // 「TX PA9」 never breaks inside (a no-break space); the line breaks between signals
      return row.signals.map((s) => `${s.name}\u00a0${s.pin}`).join(t(' / |pins'))
  }
}

/**
 * The logic-analyzer channels of a row's pins when ALL of them are on the
 * analyzer (and, for a bus, its decoder reads them) — then the row's action
 * shows them instead of adding them again, like the probe menu (SC-14).
 */
function rowOnAnalyzer(componentId: string, row: SetupRow): number[] | null {
  const layout = useStore.getState().layout
  const found = row.signals.map((s) => findLogicChannel({ kind: 'mcu-pin', componentId, pin: s.boardPin }, layout))
  if (found.length === 0 || found.some((c) => c === null)) return null
  const indices = found.map((c) => c!.index)
  if (row.kind === 'i2c' || row.kind === 'spi') {
    const decoders = sanitizeDecoderConfigs(useLab.getState().logicView.decoders)
    if (!decoders.some((d) => d.decoder === row.kind && Object.values(d.channels).some((ch) => indices.includes(ch)))) return null
  }
  return indices
}

/**
 * The instrument that shows a 「韌體目前的設定」 row (null = none): a USART →
 * 「開啟 UART 終端機」; an I²C / SPI bus → 「加入邏輯分析儀（含解碼器）」 (its
 * pins + the decoder, probe-actions addBusFor); a timer driving pins →
 * 「加入邏輯分析儀」 (a channel per pin). Already on the analyzer: 「在邏輯分析儀中檢視」
 * (the analyzer brought up, the first row flashed).
 */
export function setupAction(componentId: string, row: SetupRow): { label: string; run: () => void } | null {
  if (row.kind === 'uart') {
    // that USART of this board, not whichever port has data (a USART2 / USART3 firmware)
    return {
      label: t('Open the UART terminal'),
      run: () => {
        requestTerminalPort(componentId, row.block)
        showInstrument('uart')
      },
    }
  }
  const onLogic = row.kind === 'i2c' || row.kind === 'spi' || row.kind === 'timer' ? rowOnAnalyzer(componentId, row) : null
  if (onLogic) {
    return {
      label: t('Show in logic analyzer'),
      run: () => {
        showInstrument('logic')
        flashLogicChannel(onLogic[0])
      },
    }
  }
  if ((row.kind === 'i2c' || row.kind === 'spi') && row.busKey) {
    const key = row.busKey
    return { label: t('Add to logic analyzer (with decoder)'), run: () => void addBusFor(componentId, key) }
  }
  if (row.kind === 'timer' && row.signals.length > 0) {
    return {
      label: t('Add to logic analyzer'),
      run: () => row.signals.forEach((s) => void addLogicChannelFor({ kind: 'mcu-pin', componentId, pin: s.boardPin })),
    }
  }
  return null
}

/** One block of 「韌體目前的設定」: its name, what the firmware set, the instrument that shows it. */
function SetupRowView({ componentId, row }: { componentId: string; row: SetupRow }) {
  const pins = signalsText(row)
  const remapNote = row.remap ? (row.signals.length > 0 ? t(' (remapped)') : t('remapped to pins this board does not bring out')) : ''
  const act = setupAction(componentId, row)
  let detail: ReactNode
  if (row.kind === 'uart') {
    const c = row.uart
    const frameText = c ? uartFrameText(c) : ''
    detail = (
      <>
        {c && c.baud > 0 ? (
          <>
            <Term id="baud">{fmtBaud(c.baud)}</Term>
            {' · '}
            {frameText === '8N1' ? <Term id="8n1">8N1</Term> : frameText}
          </>
        ) : (
          t('clock on, not enabled yet')
        )}
        {pins && ` · ${pins}`}
        {remapNote}
      </>
    )
  } else if (row.kind === 'i2c' || row.kind === 'spi') {
    detail = (
      <>
        {pins}
        {remapNote}
      </>
    )
  } else if (row.kind === 'timer') {
    detail = row.signals.length > 0 ? pins : t('no channel drives a pin (it only counts or keeps time)')
  } else {
    detail = row.signals.length > 0 ? pins : t('no analog input pin set up yet')
  }
  return (
    <div className="lg-row insp-setup-row" role="listitem">
      <span className="insp-setup-line">
        <span className="insp-setup-block emb-mono" translate="no">
          {row.block}
        </span>
        <span className="insp-setup-detail">{detail}</span>
      </span>
      {act && (
        <span className="insp-setup-acts">
          <ChipButton onClick={act.run}>{act.label}</ChipButton>
        </span>
      )}
    </div>
  )
}

/**
 * 「韌體目前的設定」 (the 周邊 tab, before the support table): one row per
 * pin-using block the firmware switched on — USART line settings and pins,
 * I²C / SPI pins, timer channels (PWM), ADC inputs (mcu-setup.ts
 * firmwareSetup, from the frame's clocked / uarts / mapr and the pin modes) —
 * each with the instrument that shows it: 「開啟 UART 終端機」, 「加入邏輯分析儀
 * （含解碼器）」, 「加入邏輯分析儀」. The empty states say the next step.
 */
export function FirmwareSetupGroup({ componentId, onShowPins }: { componentId: string; onShowPins?: () => void }) {
  useLang()
  trackMcuResets()
  const type = useStore((s) => s.layout.components.find((c) => c.id === componentId)?.type)
  const entry = type ? getEntry(type) : undefined
  const hasFirmware = useLab((s) => s.firmware[componentId] != null)
  // a frame from before the last re-flash / Reset MCU describes the old run (frameSinceReset)
  const frameKey = useLab((s) => setupFrameKey(frameSinceReset(componentId, s.mcus[componentId])))
  const modesKey = useStore((s) => setupModesKey(s.telemetry?.components[componentId]?.mcu?.pinModes))
  // a row's action flips to 「在邏輯分析儀中檢視」 once its pins are on the analyzer (both change rarely)
  useLab((s) => s.logicChannels)
  useLab((s) => s.logicView.decoders)
  useStore((s) => s.layout)
  const setup = useMemo(() => {
    if (frameKey === null || !entry) return null
    const [clocked, uarts, mapr] = JSON.parse(frameKey) as [string[] | null, [string, UartLineConfig][], number | null]
    const pinModes: Record<string, string> = {}
    for (const part of modesKey.split(';')) {
      const i = part.indexOf('=')
      if (i > 0) pinModes[part.slice(0, i)] = part.slice(i + 1)
    }
    return firmwareSetup({
      pinInfo: entry.pinInfo,
      pinMap: entry.mcu?.pinMap,
      clocked,
      uarts: uarts.map(([name, config]) => ({ name, config })),
      mapr: mapr ?? undefined,
      pinModes,
    })
  }, [frameKey, modesKey, entry])

  let empty: ReactNode = null
  if (!hasFirmware) empty = t('Load a firmware and run it: its serial ports, buses, PWM outputs and analog inputs are listed here.')
  else if (!setup) empty = t('Press “▶ Run simulation”: the serial ports, buses, PWM outputs and analog inputs the firmware sets up are listed here.')
  else if (setup.rows.length === 0)
    empty = (
      <>
        {t('The firmware uses no peripheral with pins of its own — every pin it uses is a plain GPIO.')}
        {onShowPins && (
          <span className="insp-setup-acts">
            <ChipButton onClick={onShowPins}>{t('See the pins')}</ChipButton>
          </span>
        )}
      </>
    )
  return (
    <ListGroup
      header={t('What the firmware set up')}
      footer={
        setup && setup.others.length > 0
          ? t('Also switched on: {list}', { list: setup.others.map((n) => tc(n, 'periph-name')).join(t(', ')) })
          : undefined
      }
    >
      {empty !== null ? (
        <div className="lg-row insp-setup-empty" role="listitem">
          <span className="insp-setup-empty-text">{empty}</span>
        </div>
      ) : (
        setup!.rows.map((row) => <SetupRowView key={row.block} componentId={componentId} row={row} />)
      )}
    </ListGroup>
  )
}

// ---------------------------------------------------------------------------
// Peripheral support table
// ---------------------------------------------------------------------------

/** English sources, shown through tc(…, 'peripheral') ("Partial" is 部分 here, 部分模擬 as a part support level). */
const STATUS_LABEL: Record<SupportStatus, string> = {
  verified: 'Verified',
  partial: 'Partial',
  unsupported: 'Unsupported',
}

/**
 * Peripheral families (IN-6), in display order; a block goes to the first
 * family whose pattern matches its name (English sources through tc(…, 'periph-group')).
 */
const PERIPH_FAMILIES: readonly { title: string; test: RegExp }[] = [
  { title: 'Clock and power', test: /^(RCC|PWR|BKP|FLASH)\b/ },
  { title: 'GPIO', test: /^(GPIO|AFIO|EXTI)\b/ },
  { title: 'Timers', test: /^(TIM\d+|SysTick|RTC|IWDG|WWDG)\b/ },
  { title: 'Communication', test: /^(USART|UART|SPI|I2C|CAN|USB)/ },
  { title: 'Analog', test: /^(ADC|DAC)/ },
  { title: 'Other', test: /./ },
]

/** The support table grouped by family (empty families dropped, table order kept inside). */
export function peripheralFamilies(support: readonly PeripheralSupport[]): { title: string; items: PeripheralSupport[] }[] {
  const out = PERIPH_FAMILIES.map((f) => ({ title: f.title, items: [] as PeripheralSupport[] }))
  for (const p of support) {
    const i = PERIPH_FAMILIES.findIndex((f) => f.test.test(p.name))
    out[i < 0 ? out.length - 1 : i].items.push(p)
  }
  return out.filter((g) => g.items.length > 0)
}

/** The first sentence of a (localized) note — the collapsed row's one line. */
export function firstSentence(text: string): string {
  const m = /^(.+?(?:。|[.!?](?=\s|$)))/s.exec(text.trim())
  return m ? m[1] : text.trim()
}

/**
 * Blocks every firmware has on from reset (the model lists them in
 * McuFrameInfo.clocked too): the core memory map, RCC and the flash
 * interface (always clocked). Anything else in the list is
 * something the firmware switched on.
 */
const ON_FROM_RESET = new Set(['Memory map', 'RCC', 'FLASH'])

/** 「只看韌體用到的」 as the user last set it, per board, for this session (null = the default). */
const usedOnlyChoice = new Map<string, boolean>()

/**
 * The 周邊 tab filter (IN-6 follow-up): the support rows of the blocks the
 * firmware switched on (McuFrameInfo.clocked — RCC enable bits and the
 * self-clocked blocks it started). On by default once the firmware enabled
 * anything beyond the reset set; the whole table otherwise.
 */
export function usedPeripheralFilter(
  clocked: readonly string[] | null | undefined,
  choice: boolean | null | undefined,
): { available: boolean; on: boolean; names: ReadonlySet<string> } {
  const names = new Set(clocked ?? [])
  const enabled = [...names].some((n) => !ON_FROM_RESET.has(n))
  const available = clocked != null && enabled
  return { available, on: available && (choice ?? true), names }
}

export function PeripheralsGroup({ componentId }: { componentId: string }) {
  const queryMcuSupport = useLab((s) => s.queryMcuSupport)
  const hasFrame = useLab((s) => s.mcus[componentId] != null)
  // a string key: the lab pushes a new frame object ≤ 10×/s, the list rarely changes
  const clockedKey = useLab((s) => s.mcus[componentId]?.clocked?.join('\n') ?? null)
  const [support, setSupport] = useState<PeripheralSupport[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  // re-render on a toggle; the choice itself lives per board for the session
  const [, bumpChoice] = useState(0)
  const choice = usedOnlyChoice.get(componentId) ?? null
  useLang()
  const filter = usedPeripheralFilter(clockedKey === null ? null : clockedKey.split('\n'), choice)
  const shown = support && filter.on ? support.filter((p) => filter.names.has(p.name)) : support

  useEffect(() => {
    let alive = true
    queryMcuSupport(componentId)
      .then((s) => {
        if (alive) setSupport(s)
      })
      .catch(() => {
        if (alive) setSupport([])
      })
    return () => {
      alive = false
    }
    // re-query once the host reports this MCU (the model exists from then on)
  }, [componentId, queryMcuSupport, hasFrame])

  return (
    <ListGroup
      header={t('Peripherals')}
      footer={t(
        'Verified = exercised by a real-firmware integration test. Unsupported blocks read 0, ignore writes and log every access.',
      )}
    >
      {support !== null && support.length > 0 && filter.available && (
        <ListRow
          title={t('Only what the firmware uses')}
          subtitle={t('{n} of {total} — clock enabled in RCC, or started by the firmware', {
            n: support.filter((p) => filter.names.has(p.name)).length,
            total: support.length,
          })}
          trailing={
            <Switch
              checked={filter.on}
              onChange={(on) => {
                usedOnlyChoice.set(componentId, on)
                bumpChoice((n) => n + 1)
              }}
              aria-label={t('Only what the firmware uses')}
            />
          }
        />
      )}
      {shown === null || shown.length === 0 ? (
        <div className="lg-row" role="listitem">
          <span className="lg-caption">
            {shown === null
              ? t('Querying the MCU model…')
              : t('No data yet — the MCU model reports its table once the simulation host has built it.')}
          </span>
        </div>
      ) : (
        peripheralFamilies(shown).flatMap((fam) => [
          <div key={`f:${fam.title}`} className="lg-row insp-periph-family" role="listitem">
            {tc(fam.title, 'periph-group')}
            <span className="insp-periph-count">{fam.items.length}</span>
          </div>,
          ...fam.items.map((p) => {
            const open = expanded === p.name
            const notes = tMessage(p.notes)
            const first = firstSentence(notes)
            return (
              <button
                key={p.name}
                type="button"
                role="listitem"
                className="lg-row emb-periph insp-periph"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : p.name)}
              >
                <span className="emb-periph-line">
                  <span className="emb-periph-name emb-mono">{tc(p.name, 'periph-name')}</span>
                  <span className={`emb-tag is-${p.status}`}>{tc(STATUS_LABEL[p.status], 'peripheral')}</span>
                  {!open && <span className="insp-periph-first">{first}</span>}
                  <span className="insp-periph-chev" aria-hidden="true">
                    {open ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                  </span>
                </span>
                {open && <span className="emb-periph-notes is-open">{notes}</span>}
                {open && p.verifiedBy && p.verifiedBy.length > 0 && (
                  <span className="emb-periph-tests emb-mono">
                    {tNodes('tests: {list}', { list: noTranslate(p.verifiedBy.join(', ')) })}
                  </span>
                )}
              </button>
            )
          }),
        ])
      )}
    </ListGroup>
  )
}

/** The full MCU stack in reading order (firmware → execution). */
export function McuSections({ componentId }: { componentId: string }) {
  return (
    <>
      <FirmwareGroup componentId={componentId} />
      <McuRunGroup componentId={componentId} />
    </>
  )
}
