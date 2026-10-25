/**
 * The classic chrome's inspector groups, exactly as before the UX wave
 * (commit 6d01968 — IN-18). English without the desktop workspace
 * (isLegacyChrome) must look AND behave as it did then: the legacy visual
 * scenes pin it ('phone-properties-mcu'). The UX-wave groups (McuPanel,
 * PartInfo) changed the layout, the copy, the state colours and the
 * behaviour; these are their pre-wave bodies, kept apart so neither side
 * has to branch inside every row:
 *
 *   LegacyFirmwareGroup    drop zone + file picker + BIN load address
 *   LegacyMcuRunGroup      state badge, Run / Pause, Reset MCU, Halt / Step,
 *                          PC / cycles / clock / real time, registers
 *   LegacyPeripheralsGroup the support table, notes always visible
 *   LegacySimulationGroup  support level + this part's simulator issues
 *   LegacyPinoutGroup      pin table with the filter (no probe buttons)
 *   LegacySubcircuitGroup  on-board parts
 *
 * Only PropertiesSheet's classic branch renders them. Do not "improve"
 * these: the zh-TW / workspace inspector is where the UX work goes.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChipIcon,
  HaltIcon,
  ImportIcon,
  ListGroup,
  ListRow,
  PauseIcon,
  PlayIcon,
  PressableButton,
  ResetIcon,
  ResumeIcon,
  StepIcon,
  TrashIcon,
  showToast,
  tick,
  useCoarsePointer,
} from '../kit'
import { useStore } from '../../state/store'
import type { McuDebugState, McuRunState, PeripheralSupport, SupportStatus } from '../../mcu/mcu-api'
import { type CatalogEntry, type PinInfo } from '../../model/catalog'
import { componentPinHoles, formatHole } from '../../model/breadboard'
import { boardConfigOf } from '../../model/types'
import type { ComponentInstance, ComponentTelemetry, SimIssue } from '../../model/types'
import { pushCapsuleDetail } from '../chrome/StatusBar'
import { t, useLang } from '../../i18n'
import { tMessage } from '../../i18n/messages'
import { partSupport } from '../../i18n/parts'
import { fmtEng, fmtVolts } from '../format'
import { useLab } from './lab'
import { firmwareDescriptionText, noTranslate, pinFunctionText, pinModeLabel, pinNameText, tc, tNodes, tText } from './text'
import { fmtAddr, fmtBytes, fmtCount, fmtMHz, fmtRealtime, parseAddress, type McuStateMeta } from './format'
import { SupportBadge } from './PartInfo'
import './embedded.css'

/** STM32F1 main flash base — the default load address of a raw .bin (RM0008 §3.3.3). */
const DEFAULT_BIN_BASE = '0x08000000'
const ACCEPT = '.elf,.bin,.hex'
const DEBUG_POLL_MS = 500

// ---------------------------------------------------------------------------
// MCU state (the pre-wave states and colours)
// ---------------------------------------------------------------------------

/** UI-level MCU status before the wave: the model's run states + "no frame received yet". */
type LegacyMcuState = McuRunState | 'no-data'

const LEGACY_STATE_META: Record<LegacyMcuState, McuStateMeta> = {
  running: { label: 'Running', color: 'var(--ios-green)', hint: 'Executing firmware' },
  sleeping: {
    label: 'Sleeping',
    color: 'var(--ios-teal)',
    hint: 'Core stopped in WFI/WFE until a wake-up event (ARMv7-M ARM, power management)',
  },
  halted: { label: 'Halted', color: 'var(--ios-orange)', hint: 'Stopped by the debugger' },
  reset: { label: 'In reset', color: 'var(--ios-yellow)', hint: 'NRST held low' },
  lockup: {
    label: 'Fault',
    color: 'var(--ios-red)',
    hint: 'Lockup: a fault occurred while handling a fault (ARMv7-M ARM, unrecoverable exceptions)',
  },
  unpowered: {
    label: 'Unpowered',
    color: 'var(--ios-purple)',
    hint: 'VDD below the POR/PDR threshold — held in reset (DS5319 §5.3.3)',
  },
  'no-firmware': { label: 'No firmware', color: 'var(--label-3)', hint: 'Load an ELF, BIN or HEX image' },
  'no-data': {
    label: 'No data yet',
    color: 'var(--label-3)',
    hint: 'No simulation frame has reported this MCU yet',
  },
}

interface LegacyMcuLive {
  state: LegacyMcuState
  pc: number | null
  cycles: number | null
  hclkHz: number | null
  realtime: number | undefined
  firmware: string | null
}

function useLegacyMcuLive(componentId: string): LegacyMcuLive {
  const info = useLab((s) => s.mcus[componentId])
  const tele = useStore((s) => s.telemetry?.components[componentId]?.mcu)
  if (info) {
    return {
      state: info.state,
      pc: info.pc,
      cycles: info.cycles,
      hclkHz: info.hclkHz,
      realtime: info.realtime,
      firmware: info.firmware,
    }
  }
  if (tele) {
    return {
      state: tele.state,
      pc: tele.pc,
      cycles: tele.cycles,
      hclkHz: tele.hclkHz,
      realtime: tele.realtime,
      firmware: tele.firmware ?? null,
    }
  }
  return { state: 'no-data', pc: null, cycles: null, hclkHz: null, realtime: undefined, firmware: null }
}

function LegacyMcuStateBadge({ state }: { state: LegacyMcuState }) {
  useLang()
  const meta = LEGACY_STATE_META[state]
  const label = tc(meta.label, 'mcu-state')
  return (
    <span
      className={`emb-state ${state === 'running' ? 'is-live' : ''}`}
      style={{ ['--emb-state' as string]: meta.color }}
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

export function LegacyFirmwareGroup({ componentId }: { componentId: string }) {
  const record = useLab((s) => s.firmware[componentId])
  const loadFirmware = useLab((s) => s.loadFirmware)
  const clearFirmware = useLab((s) => s.clearFirmware)
  const [binBase, setBinBase] = useState(DEFAULT_BIN_BASE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragDepth, setDragDepth] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const coarse = useCoarsePointer() // touch devices pick files; there is nothing to drag
  const base = parseAddress(binBase)
  useLang()

  const load = async (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop() ?? ''
    if (!['elf', 'bin', 'hex'].includes(ext)) {
      setError(t('{name}: expected an .elf, .bin or .hex firmware image', { name: file.name }))
      return
    }
    if (ext === 'bin' && base === null) {
      setError(t('Enter a valid BIN load address (e.g. 0x08000000)'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const res = await loadFirmware(
        componentId,
        { name: file.name, bytes },
        ext === 'bin' && base !== null ? { binBase: base } : undefined,
      )
      if (res.ok) {
        tick()
        const w = res.warnings?.length ?? 0
        showToast(
          t('{file} loaded into {id}', { file: file.name, id: componentId }) +
            (w > 0 ? t(w === 1 ? ' · {n} warning' : ' · {n} warnings', { n: w }) : ''),
        )
        pushCapsuleDetail(t('{id}: firmware {file} loaded — MCU reset', { id: componentId, file: file.name }))
      } else {
        setError(res.error ? tMessage(res.error) : t('The firmware could not be loaded'))
      }
    } catch (err) {
      setError(tMessage(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault()
    setDragDepth(0)
    const file = e.dataTransfer.files?.[0]
    if (file) void load(file)
  }
  const dragProps = {
    onDragEnter: (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setDragDepth((d) => d + 1)
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: () => setDragDepth((d) => Math.max(0, d - 1)),
    onDrop,
  }

  const pick = () => fileRef.current?.click()

  return (
    <div className={`emb-fw ${dragDepth > 0 ? 'is-dragover' : ''}`} {...dragProps}>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = '' // re-picking the same file must fire again
          if (f) void load(f)
        }}
      />
      <ListGroup
        header={t('Firmware')}
        footer={
          record
            ? t('Drop another image anywhere on this card to replace it.')
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
                <span className="emb-mono">{firmwareDescriptionText(record.description)}</span>
              </div>
            )}
            {record.warnings.map((w, i) => (
              <div key={`${i}:${w}`} className="lg-row emb-issue" role="listitem">
                <span className="emb-dot" style={{ background: 'var(--ios-orange)' }} aria-label={t('warning')} />
                <span className="emb-issue-text">{tMessage(w)}</span>
              </div>
            ))}
            <ListRow
              leading={<ImportIcon size={20} />}
              title={busy ? t('Loading…') : t('Replace firmware…')}
              disabled={busy}
              onPress={pick}
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
        ) : (
          <div className="lg-row emb-drop-row" role="listitem">
            <div className="emb-drop" aria-busy={busy}>
              <span className="emb-drop-icon" aria-hidden="true">
                <ImportIcon size={26} />
              </span>
              <span className="emb-drop-title">
                {busy ? t('Loading…') : coarse ? t('Load firmware') : t('Drop firmware here')}
              </span>
              <span className="emb-drop-sub">.elf · .bin · .hex</span>
              <PressableButton size="sm" variant="tinted" disabled={busy} onClick={pick}>
                {t('Choose file…')}
              </PressableButton>
            </div>
          </div>
        )}
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
          />
          <span id={`binbase-hint-${componentId}`} className="emb-visually-hidden">
            {t('Used only for raw .bin images; ELF and Intel HEX carry their own addresses.')}
          </span>
        </div>
      </ListGroup>
      {error && (
        <div className="asm-error emb-fw-error" role="alert">
          <div className="asm-error-title">{t('Firmware not loaded')}</div>
          <div className="asm-error-msg">{error}</div>
        </div>
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
function useLegacyMcuDebug(
  componentId: string,
  enabled: boolean,
  state: LegacyMcuState,
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
    // a halted / locked-up core does not change on its own: one read is enough
    if (state === 'running' || state === 'sleeping') timer = window.setInterval(poll, DEBUG_POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [componentId, enabled, state, refreshKey, queryMcuDebug])
  return dbg
}

export function LegacyMcuRunGroup({ componentId }: { componentId: string }) {
  const live = useLegacyMcuLive(componentId)
  const running = useStore((s) => s.running)
  const startSim = useStore((s) => s.startSim)
  const stopSim = useStore((s) => s.stopSim)
  const mcuReset = useLab((s) => s.mcuReset)
  const mcuHalt = useLab((s) => s.mcuHalt)
  const mcuResume = useLab((s) => s.mcuResume)
  const mcuStep = useLab((s) => s.mcuStep)
  useLang()

  const hasCore = live.state !== 'no-data' && live.state !== 'no-firmware' && live.state !== 'unpowered'
  const halted = live.state === 'halted'
  const stopped = live.state === 'halted' || live.state === 'lockup'
  const dbg = useLegacyMcuDebug(componentId, hasCore, live.state, stopped ? (live.cycles ?? 0) : 0)
  // the debugger snapshot's PC matches its symbol; frames are the fallback
  const pc = dbg ? (dbg.registers.r[15] ?? live.pc) : live.pc
  const symbol = dbg?.pcSymbol

  // a fault is worth interrupting for: flash it in the capsule once per entry
  const prevState = useRef(live.state)
  useEffect(() => {
    if (live.state === 'lockup' && prevState.current !== 'lockup') {
      pushCapsuleDetail(t('{id}: core LOCKUP — see the Simulation log', { id: componentId }))
    }
    prevState.current = live.state
  }, [live.state, componentId])

  return (
    <ListGroup header={tc('Execution', 'section')}>
      <div className="lg-row emb-run-head" role="listitem">
        <LegacyMcuStateBadge state={live.state} />
        {/* the core's own state is unchanged by a paused simulation clock */}
        {!running && live.state !== 'no-data' && <span className="emb-run-note">{t('sim paused')}</span>}
        <span className="emb-run-dbg" role="group" aria-label={t('Debugger')}>
          {halted ? (
            <button
              type="button"
              className="emb-icon-btn lg-pressable"
              aria-label={t('Resume core')}
              title={t('Resume')}
              onClick={() => mcuResume(componentId)}
            >
              <ResumeIcon size={22} />
            </button>
          ) : (
            <button
              type="button"
              className="emb-icon-btn lg-pressable"
              aria-label={t('Halt core')}
              title={t('Halt the core (debugger)')}
              disabled={!hasCore}
              onClick={() => mcuHalt(componentId)}
            >
              <HaltIcon size={22} />
            </button>
          )}
          <button
            type="button"
            className="emb-icon-btn lg-pressable"
            aria-label={t('Step one instruction')}
            title={halted ? t('Step one instruction') : t('Halt the core to single-step')}
            disabled={!halted}
            onClick={() => mcuStep(componentId)}
          >
            <StepIcon size={22} />
          </button>
        </span>
      </div>
      <div className="lg-row emb-run-ctl" role="listitem">
        <PressableButton
          size="sm"
          variant={running ? 'tinted' : 'filled'}
          className={running ? 'emb-btn-flex' : 'emb-btn-run emb-btn-flex'}
          icon={running ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          haptic
          aria-label={running ? t('Pause simulation') : t('Run simulation')}
          onClick={() => (running ? stopSim() : startSim())}
        >
          {running ? t('Pause') : t('Run')}
        </PressableButton>
        <PressableButton
          size="sm"
          variant="tinted"
          className="emb-btn-flex"
          icon={<ResetIcon size={16} />}
          disabled={live.state === 'no-data'}
          onClick={() => {
            mcuReset(componentId)
            tick()
            showToast(t('{id} reset', { id: componentId }))
          }}
        >
          {t('Reset MCU')}
        </PressableButton>
      </div>
      <div className="lg-row emb-stats" role="listitem">
        <Stat label="PC" wide>
          {pc !== null ? fmtAddr(pc) : '—'}
          {symbol && (
            <span className="emb-pc-sym" translate="no">
              {symbol}
            </span>
          )}
        </Stat>
        <Stat label={t('Cycles')}>{live.cycles !== null ? fmtCount(live.cycles) : '—'}</Stat>
        <Stat label={t('Core clock')}>{live.hclkHz !== null ? fmtMHz(live.hclkHz) : '—'}</Stat>
        <Stat label={t('Real time')}>{fmtRealtime(live.realtime)}</Stat>
      </div>
      {dbg && (halted || live.state === 'lockup') && <RegisterRows dbg={dbg} />}
    </ListGroup>
  )
}

/** One labelled readout cell of the execution stats grid. */
function Stat({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <span className={`emb-stat ${wide ? 'is-wide' : ''}`}>
      <span className="emb-stat-label">{label}</span>
      <span className="emb-stat-value emb-mono lg-tabular">{children}</span>
    </span>
  )
}

const REG_NAMES = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'sp', 'lr', 'pc']

/** Core registers (halted / locked-up only — a running core moves too fast to read). */
function RegisterRows({ dbg }: { dbg: McuDebugState }) {
  const { registers: r, faults } = dbg
  return (
    <div className="lg-row emb-regs" role="listitem" aria-label={t('Core registers')}>
      <div className="emb-regs-grid emb-mono lg-tabular">
        {REG_NAMES.map((name, i) => (
          <span key={name} className="emb-reg">
            <span className="emb-reg-name">{name}</span>
            {fmtAddr(r.r[i] ?? NaN)}
          </span>
        ))}
        <span className="emb-reg">
          <span className="emb-reg-name">xpsr</span>
          {fmtAddr(r.xpsr)}
        </span>
        <span className="emb-reg">
          <span className="emb-reg-name">ipsr</span>
          {dbg.ipsr}
        </span>
      </div>
      {dbg.state === 'lockup' && (
        // SCB fault status registers (ARMv7-M ARM B3.2.15 CFSR / B3.2.16 HFSR)
        <div className="emb-regs-grid emb-mono lg-tabular emb-regs-fault">
          <span className="emb-reg">
            <span className="emb-reg-name">cfsr</span>
            {fmtAddr(faults.cfsr)}
          </span>
          <span className="emb-reg">
            <span className="emb-reg-name">hfsr</span>
            {fmtAddr(faults.hfsr)}
          </span>
          <span className="emb-reg">
            <span className="emb-reg-name">mmfar</span>
            {fmtAddr(faults.mmfar)}
          </span>
          <span className="emb-reg">
            <span className="emb-reg-name">bfar</span>
            {fmtAddr(faults.bfar)}
          </span>
        </div>
      )}
    </div>
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

export function LegacyPeripheralsGroup({ componentId }: { componentId: string }) {
  const queryMcuSupport = useLab((s) => s.queryMcuSupport)
  const hasFrame = useLab((s) => s.mcus[componentId] != null)
  const [support, setSupport] = useState<PeripheralSupport[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  useLang()

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
      {support === null || support.length === 0 ? (
        <div className="lg-row" role="listitem">
          <span className="lg-caption">
            {support === null
              ? t('Querying the MCU model…')
              : t('No data yet — the MCU model reports its table once the simulation host has built it.')}
          </span>
        </div>
      ) : (
        support.map((p) => {
          const open = expanded === p.name
          return (
            <button
              key={p.name}
              type="button"
              role="listitem"
              className="lg-row emb-periph"
              aria-expanded={open}
              onClick={() => setExpanded(open ? null : p.name)}
            >
              <span className="emb-periph-line">
                <span className="emb-periph-name emb-mono">{tc(p.name, 'periph-name')}</span>
                <span className={`emb-tag is-${p.status}`}>{tc(STATUS_LABEL[p.status], 'peripheral')}</span>
              </span>
              <span className={`emb-periph-notes ${open ? 'is-open' : ''}`}>{tMessage(p.notes)}</span>
              {open && p.verifiedBy && p.verifiedBy.length > 0 && (
                <span className="emb-periph-tests emb-mono">
                  {tNodes('tests: {list}', { list: noTranslate(p.verifiedBy.join(', ')) })}
                </span>
              )}
            </button>
          )
        })
      )}
    </ListGroup>
  )
}

// ---------------------------------------------------------------------------
// Simulation status + part issues
// ---------------------------------------------------------------------------

const NO_ISSUES: SimIssue[] = []

export function LegacySimulationGroup({ entry, componentId }: { entry: CatalogEntry; componentId: string }) {
  useLang()
  const support = partSupport(entry)
  const issues = useStore((s) => s.issues)
  const mine = useMemo(
    () => (issues.length === 0 ? NO_ISSUES : issues.filter((i) => i.componentId === componentId)),
    [issues, componentId],
  )
  const [open, setOpen] = useState(false)
  const hasDetail = (support.simulated?.length ?? 0) + (support.limits?.length ?? 0) > 0
  const clean = mine.length === 0

  return (
    <ListGroup header={tc('Simulation', 'section')}>
      <ListRow
        title={tc('Support', 'section')}
        trailing={
          <span className="emb-row-trail">
            <SupportBadge level={support.level} />
            {hasDetail && (
              <span className="emb-disclose" aria-hidden="true">
                {open ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
              </span>
            )}
          </span>
        }
        onPress={hasDetail ? () => setOpen((o) => !o) : undefined}
      />
      {open && hasDetail && (
        <div className="lg-row emb-support-detail" role="listitem">
          {support.simulated && support.simulated.length > 0 && (
            <div className="emb-support-col">
              <span className="emb-mini-head">{t('Simulated')}</span>
              <ul>
                {support.simulated.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {support.limits && support.limits.length > 0 && (
            <div className="emb-support-col">
              <span className="emb-mini-head">{t('Not modeled')}</span>
              <ul>
                {support.limits.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {clean ? (
        <ListRow
          leading={
            <span className="emb-ok" aria-hidden="true">
              <CheckIcon size={18} />
            </span>
          }
          title={t('No issues')}
          subtitle={t('Nothing reported for this part')}
        />
      ) : (
        <>
          {mine.map((iss, i) => (
            <div key={`i${i}:${iss.message}`} className="lg-row emb-issue" role="listitem">
              <span
                className="emb-dot"
                style={{ background: iss.level === 'error' ? 'var(--ios-red)' : 'var(--ios-orange)' }}
                aria-label={iss.level === 'error' ? t('error') : t('warning')}
              />
              <span className="emb-issue-text">{tMessage(iss.message)}</span>
            </div>
          ))}
        </>
      )}
    </ListGroup>
  )
}

// ---------------------------------------------------------------------------
// Pinout table
// ---------------------------------------------------------------------------

/** Colors by pin kind: supply rails stand out, grounds recede. */
const KIND_CLASS: Record<PinInfo['kind'], string> = {
  power: 'is-power',
  ground: 'is-ground',
  control: 'is-control',
  io: '',
  analog: '',
  input: '',
  output: '',
  passive: '',
  nc: 'is-nc',
}

export function LegacyPinoutGroup({
  comp,
  entry,
  tele,
}: {
  comp: ComponentInstance
  entry: CatalogEntry
  tele: ComponentTelemetry | undefined
}) {
  // board-aware (module-2+ / board-row-2+ parts must still resolve)
  const board = useStore((s) => s.layout.board)
  const boardCount = useStore((s) => s.layout.boardCount)
  const boardRows = useStore((s) => s.layout.boardRows)
  const hoverHole = useStore((s) => s.hoverHole)
  const [filter, setFilter] = useState('')
  useLang()

  const holes = useMemo(
    () => componentPinHoles(comp, entry, boardConfigOf({ board, boardCount, boardRows })),
    [comp, entry, board, boardCount, boardRows],
  )
  const infoByPin = useMemo(() => {
    const m = new Map<string, PinInfo>()
    for (const p of entry.pinInfo ?? []) m.set(p.pin, p)
    return m
  }, [entry])

  const pinModes = tele?.mcu?.pinModes
  const q = filter.trim().toLowerCase()
  const showNum = entry.placement === 'dip' || entry.placement === 'footprint'

  const rows = entry.pins
    .map((pin, i) => {
      const info = infoByPin.get(pin)
      const hole = holes?.[i] ?? null
      const where =
        entry.placement === 'offboard' ? `${comp.id}:${pin}` : hole ? formatHole(hole) : '—'
      return { pin, i, info, where }
    })
    .filter(({ pin, info, where }) => {
      if (q === '') return true
      if (pin.toLowerCase().includes(q) || where.toLowerCase() === q) return true
      if (info?.label?.toLowerCase().includes(q)) return true
      if (pinNameText(info?.label ?? pin).toLowerCase().includes(q)) return true
      return info?.functions?.some((f) => f.toLowerCase().includes(q)) ?? false
    })

  return (
    <ListGroup
      header={t('Pinout')}
      footer={
        pinModes
          ? t('Mode = the pin configuration programmed by firmware (GPIOx_CRL/CRH, RM0008 §9.2).')
          : holes === null && entry.placement !== 'offboard'
            ? t('Placement is incomplete or invalid for this part.')
            : undefined
      }
    >
      {entry.pins.length > 8 && (
        <div className="lg-row emb-pin-filter" role="listitem">
          <input
            className="emb-field"
            type="search"
            placeholder={t('Filter pins — A5, USART1, SPI…')}
            aria-label={t('Filter pins')}
            value={filter}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="none"
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}
      {rows.length === 0 && (
        <div className="lg-row" role="listitem">
          <span className="lg-caption">{t('No pin matches “{q}”', { q: filter.trim() })}</span>
        </div>
      )}
      {rows.map(({ pin, i, info, where }) => {
        const v = tele?.pinVoltages?.[pin]
        const mode = pinModes?.[pin]
        const label = info?.label ?? pin
        const hot = hoverHole != null && where === hoverHole
        return (
          <div
            key={pin}
            className={`emb-pin ${hot ? 'is-hot' : ''}`}
            role="listitem"
            title={info?.note ? tText(info.note) : undefined}
          >
            {showNum && <span className="emb-pin-num lg-tabular">{i + 1}</span>}
            <span className="emb-pin-main">
              <span className="emb-pin-line">
                <span className={`emb-pin-label emb-mono ${info ? KIND_CLASS[info.kind] : ''}`}>
                  {pinNameText(label)}
                </span>
                {label !== pin && <span className="emb-pin-name emb-mono">{pinNameText(pin)}</span>}
                {info?.ft && (
                  <span className="emb-tag is-ft" title={t('Five-volt tolerant input (DS5319 Table 5, FT)')}>
                    FT
                  </span>
                )}
                {mode && (
                  <span
                    className="emb-tag is-mode"
                    title={t('Pin mode programmed by firmware: {mode}', { mode: tc(mode, 'pin-mode-long') })}
                  >
                    {pinModeLabel(mode)}
                  </span>
                )}
                <span className="emb-pin-hole emb-mono">{where}</span>
              </span>
              {info?.functions && info.functions.length > 0 && (
                <span className="emb-pin-fns">
                  {info.functions.map((f) => (
                    <span key={f} className="emb-fn">
                      {pinFunctionText(f)}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="emb-pin-v lg-tabular">{v !== undefined ? fmtVolts(v) : ''}</span>
          </div>
        )
      })}
    </ListGroup>
  )
}

// ---------------------------------------------------------------------------
// Board-level sub-circuit telemetry (on-board LEDs, regulator, pull-ups)
// ---------------------------------------------------------------------------

export function LegacySubcircuitGroup({ entry, tele }: { entry: CatalogEntry; tele: ComponentTelemetry | undefined }) {
  useLang()
  const elements = entry.subcircuit ?? []
  if (elements.length === 0) return null
  const supply = entry.supplyPins?.plus ?? []
  return (
    <ListGroup header={t('On-board')} footer={tele ? undefined : t('Run the simulation to see live values.')}>
      {supply.map((pin) => (
        <ListRow
          key={`v:${pin}`}
          title={t('{pin} pin', { pin })}
          trailing={<span className="emb-mono lg-tabular">{fmtVolts(tele?.pinVoltages?.[pin])}</span>}
        />
      ))}
      {elements.map((el) => {
        const st = tele?.sub?.[el.id]
        let value = '—'
        if (st) {
          if (st.ledBrightness !== undefined) {
            value = `${Math.round(Math.max(0, Math.min(1, st.ledBrightness)) * 100)} %`
          } else if (st.current !== undefined) {
            value = fmtEng(st.current, 'A')
            if (st.power !== undefined) value += ` · ${fmtEng(st.power, 'W')}`
          }
        }
        return (
          <ListRow
            key={el.id}
            title={
              <span className="emb-mono" translate="no">
                {el.id}
              </span>
            }
            subtitle={tc(el.model, 'model')}
            trailing={<span className="emb-mono lg-tabular">{value}</span>}
          />
        )
      })}
    </ListGroup>
  )
}
