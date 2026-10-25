/**
 * MoreSheet — settings / import / export / examples / issues, as iOS inset
 * grouped lists (snap 0.55/0.92).
 *
 * Groups: [Simulation] speed Segmented + Reset row · [Circuit] Import
 * (sub-view: file picker + paste-JSON with inline error list, ported from
 * the old ImportDialog), Export (download + clipboard copy + toast), Clear
 * board (destructive, ActionSheet confirm), Examples (the curated library
 * of src/ui/workspace/examples.ts, one group per category, opened through
 * lab.importProject with an ActionSheet confirm when the board is not
 * empty — ExampleGroups) · [Issues] live level-colored list (tap selects the
 * component and dismisses) · [Settings] shared ApiKeyRow + About.
 * [Graphics]: render-mode Segmented (Performance/Enhanced/Studio) with a
 * per-mode caption and a device-default badge, backed by the store's
 * renderMode contract.
 *
 * New chrome (UX wave SH-6 — everything except isLegacyChrome): the sheet
 * leads with what needs attention and where to go — [問題（n）] (the
 * problems store, contract K3; a tap on any of its buttons closes the sheet
 * so the board / properties can show) and [AI 電路助手 · 課程 · 鍵盤快速鍵
 * (desktop)]; the old [Issues] group at the bottom is the classic chrome's.
 * saveProjectFile() is shared with the Ctrl/Cmd+S shortcut. The problems header is the list's own: it
 * counts like the 更多 badge and the status pill (「問題（errors +
 * warnings）· 提示 n」 — UX fix SH-13 (4), ProblemsList problemsHeaderText).
 *
 * Release QA (new chrome only — the classic chrome keeps its list exactly):
 * the examples are no longer a long list under the destructive 「清空麵包板」
 * — one row 「範例 ›」 beside 「課程」 opens the one example library (the
 * host's onOpenExamples: the workspace's 範例 tab on a desktop, the 元件
 * sheet's 範例 segment on a phone — SH-F7 with scene's SC-F3); the speeds read 「0.1 倍」…「10 倍」 under
 * 「模擬速度（倍速）」 (SH-F10); 清空麵包板 brings the whole breadboard back
 * into view (SH-F4).
 *
 * Embedded lab: [Circuit] gains Open project / Save project — the
 * 'ohmlet-project' envelope (layout + embedded firmware + workspace +
 * instruments) through lab.importProject / lab.exportProject; the legacy
 * plain-layout JSON import/export stays. [Settings] gains the "Embedded
 * workspace" switch (lab.workspace.enabled; it shows on desktop windows
 * ≥ 1100 px with a fine pointer).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useStore } from '../../state/store'
import { WORKSPACE_MEDIA_QUERY, useLab } from '../embedded/lab'
import {
  boardHasContent,
  exampleCategoryName,
  exampleDifficultyName,
  exampleSummary,
  exampleTitle,
  firmwareWarnings,
  librarySections,
  openLibraryExample,
  type LibraryExample,
} from '../workspace/examples'
import { pushCapsuleDetail } from '../chrome/StatusBar'
import { useLegacyChrome } from '../chrome/legacy'
import { frameCircuit } from '../workspace/scene-bridge'
import { ProblemsList, useProblems } from '../embedded/problems'
import { BOARD_SIZES, boardOf, isBoardRows, MAX_BOARD_COUNT, MAX_BOARD_ROWS } from '../../model/types'
import type { BoardSizeId, CircuitLayout, SimIssue } from '../../model/types'
import {
  FULL_CAPS,
  RENDER_MODES,
  RENDER_MODE_IDS,
  defaultMode,
  type RenderModeId,
} from '../../three/render-modes/capability'
import {
  ActionSheet,
  BookIcon,
  CheckIcon,
  ChevronLeftIcon,
  ExportIcon,
  FolderIcon,
  ImportIcon,
  KeyboardIcon,
  ListGroup,
  ListRow,
  PressableButton,
  ResetIcon,
  Segmented,
  Sheet,
  SparklesIcon,
  Stepper,
  Switch,
  TrashIcon,
  showToast,
  tick,
  useCoarsePointer,
  useMediaQuery,
  type SegmentedOption,
} from '../kit'
import { ApiKeyRow } from './ApiKeyRow'
import { PerfDiagnosticsRow } from '../perf/PerfOverlay'
import { openLessons } from '../lessons/actions'
import { LANGS, lang, setLang, t, useLang, type Lang } from '../../i18n'
import { tMessage } from '../../i18n/messages'
import { tc } from '../format'
import pkg from '../../../package.json'
import './asm-sheets.css'

const SNAP_POINTS = [0.55, 0.92] as const

const SPEED_OPTIONS: readonly SegmentedOption<string>[] = [
  { value: '0.1', label: '0.1×' },
  { value: '0.5', label: '0.5×' },
  { value: '1', label: '1×' },
  { value: '5', label: '5×' },
  { value: '10', label: '10×' },
]

/**
 * The speed options in the capsule's unit (release QA SH-F10): 「n 倍速」
 * does not fit five times in a sheet ~340 px wide (each option wrapped to
 * 「0.1 倍／速」), so the row is titled 「模擬速度（倍速）」 and the options
 * read 「0.1 倍」…「10 倍」 — the setting's own value, as the capsule's
 * 「模擬跟不上設定的 5 倍速」 names it (H3 fmtSpeedFactor rounds a MEASURED
 * factor: 「1.0 倍速」). The classic chrome keeps 「Speed」 and 「0.1×」.
 */
export const speedOptions = (legacy: boolean): readonly SegmentedOption<string>[] =>
  legacy ? SPEED_OPTIONS : SPEED_OPTIONS.map((o) => ({ value: o.value, label: t('{x}×|speed option', { x: o.value }) }))

/** The speed row's title: 「模擬速度（倍速）」 (the classic chrome: 「Speed」). */
export const speedRowTitle = (legacy: boolean): string => (legacy ? t('Speed') : t('Simulation speed (× real time)'))

const BOARD_IDS: readonly BoardSizeId[] = ['half', 'standard', 'labxl']

/** Board size names / render-mode names are model data (English); the
 *  options are built per render so they follow the UI language. */
const boardOptions = (): readonly SegmentedOption<BoardSizeId>[] =>
  BOARD_IDS.map((id) => ({ value: id, label: t(BOARD_SIZES[id].label) }))

const graphicsOptions = (): readonly SegmentedOption<RenderModeId>[] =>
  RENDER_MODE_IDS.map((id) => ({ value: id, label: t(RENDER_MODES[id].label) }))

/** Language names are endonyms — each shown in its own language, so the
 *  switch stays findable whichever language is active. */
const LANG_OPTIONS: readonly SegmentedOption<Lang>[] = LANGS.map((l) => ({
  value: l,
  label:
    l === 'zh-TW' ? (
      <span lang="zh-Hant-TW">繁體中文</span>
    ) : (
      <span lang="en" translate="no">
        English
      </span>
    ),
}))

/** Tiny blue "device default" chip inside the graphics caption (module-level
 *  const — no per-render object; asm-sheets.css stays untouched). */
const DEFAULT_BADGE_STYLE: CSSProperties = {
  display: 'inline-block',
  margin: '0 7px 0 0',
  padding: '1px 7px 2px',
  borderRadius: 999,
  background: 'rgba(10, 132, 255, 0.16)',
  border: '0.5px solid rgba(10, 132, 255, 0.35)',
  color: 'var(--ios-blue)',
  font: '600 11px/14px var(--lg-font)',
  whiteSpace: 'nowrap',
  verticalAlign: '1px',
}
/** The same chip in Chinese: CJK text is never under 12 px (UX fix SH-16 — H9). */
const DEFAULT_BADGE_STYLE_CJK: CSSProperties = { ...DEFAULT_BADGE_STYLE, font: '600 12px/15px var(--lg-font)' }

/** Side-by-side wide/deep steppers inside the Boards row. */
const BOARDS_LINE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
}

/**
 * Contract bridge — fields the concurrent store work is landing on the
 * AppState contract (src/state/types.ts): `renderMode`/`setRenderMode`
 * (render-mode picker) and `setBoardRows` (2-D rigs). Read structurally and
 * guarded so this sheet compiles today and binds to the real store slice
 * the moment the contract lands.
 */
interface PendingStorePowers {
  renderMode?: RenderModeId
  setRenderMode?: (mode: RenderModeId) => void
  setBoardRows?: (n: number) => { ok: boolean; error?: string }
}
const powersOf = (s: unknown): PendingStorePowers => s as PendingStorePowers

const EMPTY_ISSUES: SimIssue[] = []

/** File-name slug of the circuit name ("Blue Pill blink" → blue-pill-blink). */
function slugOf(name: string | undefined): string {
  return (
    (name ?? 'circuit')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'circuit'
  )
}

/** Trigger a browser download of `text` (best effort — may be blocked). */
function downloadText(text: string, fileName: string): void {
  try {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  } catch {
    /* download blocked — callers report what happened */
  }
}

/** Saving is single-flight (the sheet's row and Ctrl/Cmd+S share it). */
let saveInFlight: Promise<boolean> | null = null

/**
 * Save the project file (circuit + firmware + instruments + workspace) as
 * `<circuit-name>.ohmlet.json` through a browser download, with the toast
 * feedback of More → 儲存專案. Shared by the sheet row and Ctrl/Cmd+S.
 * Resolves true when the file was handed to the browser.
 */
export function saveProjectFile(): Promise<boolean> {
  if (saveInFlight) return saveInFlight
  saveInFlight = (async () => {
    try {
      const text = await useLab.getState().exportProject()
      const file = `${slugOf(useStore.getState().layout.name)}.ohmlet.json`
      downloadText(text, file)
      tick()
      showToast(t('Saved {file}', { file }))
      return true
    } catch (err) {
      showToast(t('Couldn’t save the project: {error}', { error: tMessage(err instanceof Error ? err.message : String(err)) }))
      return false
    } finally {
      saveInFlight = null
    }
  })()
  return saveInFlight
}

export interface MoreSheetProps {
  open: boolean
  onDismiss: () => void
  desktop?: boolean
  /** new chrome: the 「AI 電路助手」 row (the AI sheet left the dock) */
  onOpenAi?: () => void
  /** new chrome, desktop: the 「鍵盤快速鍵」 row */
  onOpenShortcuts?: () => void
  /**
   * new chrome: the 「範例 ›」 row (release QA SH-F7) — the host opens the
   * one example library (the workspace's 範例 tab, or the 元件 sheet's 範例
   * segment — scene SC-F3). Without it the row is not shown.
   */
  onOpenExamples?: () => void
}

export function MoreSheet({
  open,
  onDismiss,
  desktop = false,
  onOpenAi,
  onOpenShortcuts,
  onOpenExamples,
}: MoreSheetProps) {
  const uiLang = useLang()
  const legacy = useLegacyChrome()
  const problemCount = useProblems((s) => s.problems.length)
  const simSpeed = useStore((s) => s.simSpeed)
  const setSimSpeed = useStore((s) => s.setSimSpeed)
  const resetSim = useStore((s) => s.resetSim)
  const clearBoard = useStore((s) => s.clearBoard)
  const exportJson = useStore((s) => s.exportJson)
  const select = useStore((s) => s.select)
  const layoutName = useStore((s) => s.layout.name)
  const board = useStore((s) => boardOf(s.layout))
  const setBoardSize = useStore((s) => s.setBoardSize)
  // primitive selector (not boardConfigOf — a fresh object per call would
  // re-render this sheet on every store update)
  const boardCount = useStore((s) => s.layout.boardCount ?? 1)
  const setBoardCount = useStore((s) => s.setBoardCount)
  // hardened primitive selector, same reasoning as boardCount above
  const boardRows = useStore((s) => (isBoardRows(s.layout.boardRows) ? s.layout.boardRows : 1))
  const setBoardRows = useStore((s) => powersOf(s).setBoardRows)
  // graphics: persisted store mode; until the contract lands, mirror the
  // device default the RenderModeManager would pick (phone → performance)
  const coarse = useCoarsePointer()
  const deviceDefault = defaultMode(coarse ? { ...FULL_CAPS, coarsePointer: true } : FULL_CAPS)
  const storedRenderMode = useStore((s) => powersOf(s).renderMode)
  const setRenderMode = useStore((s) => powersOf(s).setRenderMode)
  const renderMode = storedRenderMode ?? deviceDefault
  // only track live issues while the sheet is open (skip 10Hz re-renders when closed)
  const issues = useStore((s) => (open && legacy ? s.issues : EMPTY_ISSUES))
  // embedded lab: workspace switch + project files
  const workspaceEnabled = useLab((s) => s.workspace.enabled)
  const setWorkspace = useLab((s) => s.setWorkspace)
  const importProject = useLab((s) => s.importProject)
  const workspaceCapable = useMediaQuery(WORKSPACE_MEDIA_QUERY)
  const projectFileRef = useRef<HTMLInputElement>(null)
  const [projectBusy, setProjectBusy] = useState(false)

  const [view, setView] = useState<'root' | 'import'>('root')
  const [confirmClear, setConfirmClear] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [snap, setSnap] = useState(0)

  // every presentation starts back at the root list, at the half detent
  useEffect(() => {
    if (open) {
      setView('root')
      setConfirmClear(false)
      setSnap(0)
    }
  }, [open])

  const onSaveProject = async () => {
    if (projectBusy) return
    setProjectBusy(true)
    try {
      await saveProjectFile()
    } finally {
      setProjectBusy(false)
    }
  }

  const onOpenProject = async (file: File | undefined) => {
    if (!file || projectBusy) return
    setProjectBusy(true)
    try {
      const res = await importProject(await file.text())
      if (res.ok) {
        tick()
        const w = res.warnings.length
        showToast(
          w > 0
            ? t(w === 1 ? 'Opened {name} · {n} warning: {first}' : 'Opened {name} · {n} warnings: {first}', {
                name: file.name,
                n: w,
                first: tMessage(res.warnings[0]),
              })
            : t('Opened {name}', { name: file.name }),
          {
            duration: w > 0 ? 5200 : 2600,
          },
        )
        // the toast above already said it: the new chrome does not repeat it in the capsule (SH-13 (6))
        pushCapsuleDetail(t('Project {name} opened', { name: file.name }), { toasted: true })
        onDismiss()
      } else {
        showToast(
          t('Couldn’t open {name}: {error}', {
            name: file.name,
            error: res.errors[0] ? tMessage(res.errors[0]) : t('unknown error'),
          }),
          { duration: 5200 },
        )
      }
    } catch (err) {
      showToast(t('Couldn’t read {name}: {error}', { name: file.name, error: tMessage(err instanceof Error ? err.message : String(err)) }))
    } finally {
      setProjectBusy(false)
    }
  }

  const onExport = () => {
    const json = exportJson()
    const slug = slugOf(layoutName)
    downloadText(json, `${slug}.json`) // blocked downloads still get the clipboard copy
    const copied = navigator.clipboard?.writeText(json)
    if (copied) {
      copied.then(
        () => showToast(t('Exported {file} — copied to clipboard', { file: `${slug}.json` })),
        () => showToast(t('Exported {file}', { file: `${slug}.json` })),
      )
    } else {
      showToast(t('Exported {file}', { file: `${slug}.json` }))
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onDismiss={onDismiss}
        snapPoints={SNAP_POINTS}
        activeSnap={snap}
        onSnapChange={setSnap}
        desktop={desktop}
        anchor="right"
        ariaLabel={t('More')}
        className="asm-sheet"
      >
        {view === 'import' ? (
          <ImportView onBack={() => setView('root')} onDone={onDismiss} />
        ) : (
          <div className="asm-content asm-view">
            <div className="asm-sheet-head">
              <span className="lg-title">{t('More')}</span>
            </div>

            {!legacy && problemCount > 0 && (
              // any fix / 「在電路板上標示」 in the list closes the sheet so the
              // board (or the properties it opens) can show
              <div
                className="asm-problems"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button')) onDismiss()
                }}
              >
                {/* its header counts as the 更多 badge and the pill do (SH-13 (4)) */}
                <ProblemsList variant="panel" />
              </div>
            )}

            {!legacy && (
              <ListGroup>
                <ListRow
                  leading={<SparklesIcon size={20} />}
                  title={t('AI circuit assistant')}
                  subtitle={t('Describe a circuit and AI builds it on the board')}
                  chevron
                  onPress={() => onOpenAi?.()}
                />
                <ListRow
                  leading={<BookIcon size={20} />}
                  title={t('Lessons')}
                  subtitle={t('Guided builds, checked against the live simulation')}
                  chevron
                  onPress={() => {
                    onDismiss()
                    openLessons()
                  }}
                />
                {onOpenExamples && (
                  // SH-F7: one row next to 課程 opens the one example library
                  // (the workspace's 範例 tab / the 元件 sheet's 範例 segment) —
                  // never a long list under the destructive 「清空麵包板」; the
                  // empty state's 「開啟範例」 icon
                  <ListRow
                    leading={<FolderIcon size={20} />}
                    title={t('Examples')}
                    subtitle={t('Ready-made circuits to open and run')}
                    chevron
                    onPress={onOpenExamples}
                  />
                )}
                {desktop && (
                  <ListRow
                    leading={<KeyboardIcon size={20} />}
                    title={t('Keyboard shortcuts')}
                    trailing={<kbd className="lg-kbd">?</kbd>}
                    chevron
                    onPress={() => onOpenShortcuts?.()}
                  />
                )}
              </ListGroup>
            )}

            <ListGroup header={t('Simulation')}>
              <div className="lg-row asm-row-stack" role="listitem">
                <span className="asm-row-stack-label">{speedRowTitle(legacy)}</span>
                <Segmented
                  value={String(simSpeed)}
                  onChange={(v) => setSimSpeed(Number(v))}
                  options={speedOptions(legacy)}
                  aria-label={t('Simulation speed')}
                />
              </div>
              <ListRow
                leading={<ResetIcon size={20} />}
                title={t('Reset simulation')}
                haptic
                onPress={() => {
                  resetSim()
                  showToast(t('Simulation reset'))
                }}
              />
            </ListGroup>

            <ListGroup header={tc('Board', 'breadboard')}>
              <div className="lg-row asm-row-stack" role="listitem">
                <span className="asm-row-stack-label">{t('Size')}</span>
                <Segmented<BoardSizeId>
                  value={board}
                  onChange={(v) => {
                    const res = setBoardSize(v)
                    if (!res.ok) showToast(res.error ? tMessage(res.error) : t('Board size unchanged'))
                  }}
                  options={boardOptions()}
                  aria-label={t('Board size')}
                />
              </div>
              <div className="lg-row asm-row-stack" role="listitem">
                <span className="asm-row-stack-label">{tc('Boards', 'breadboard')}</span>
                <div style={BOARDS_LINE_STYLE}>
                  <Stepper
                    value={boardCount}
                    min={1}
                    max={MAX_BOARD_COUNT}
                    showValue
                    formatValue={(n) => t('{n} wide', { n })}
                    onChange={(n) => {
                      const res = setBoardCount(n)
                      if (!res.ok) showToast(res.error ? tMessage(res.error) : t('Board count unchanged'))
                    }}
                    aria-label={t('Number of boards')}
                  />
                  <Stepper
                    value={boardRows}
                    min={1}
                    max={MAX_BOARD_ROWS}
                    showValue
                    formatValue={(n) => t('{n} deep', { n })}
                    onChange={(n) => {
                      const res = setBoardRows?.(n)
                      if (res && !res.ok) showToast(res.error ? tMessage(res.error) : t('Board rows unchanged'))
                    }}
                    aria-label={t('Board rows deep')}
                  />
                </div>
              </div>
              <div className="lg-row" role="listitem">
                <span className="lg-caption">
                  {boardCount > 1 || boardRows > 1
                    ? `${t(BOARD_SIZES[board].label)} ×${boardCount}${
                        boardRows > 1 ? ` · ${t('{n} deep', { n: boardRows })}` : ''
                      } — `
                    : ''}
                  {t('{points} tie points · {cols} columns', {
                    points: (BOARD_SIZES[board].points * boardCount * boardRows).toLocaleString('en-US'),
                    cols: BOARD_SIZES[board].cols * boardCount,
                  })}
                </span>
              </div>
            </ListGroup>

            <ListGroup header={t('Graphics')}>
              <div className="lg-row asm-row-stack" role="listitem">
                <span className="asm-row-stack-label">{t('Render mode')}</span>
                <Segmented<RenderModeId>
                  value={renderMode}
                  onChange={(v) => setRenderMode?.(v)}
                  options={graphicsOptions()}
                  aria-label={t('Render mode')}
                />
              </div>
              <div className="lg-row" role="listitem">
                <span className="lg-caption">
                  {renderMode === deviceDefault && (
                    <span style={uiLang === 'en' ? DEFAULT_BADGE_STYLE : DEFAULT_BADGE_STYLE_CJK}>{t('device default')}</span>
                  )}
                  {t(RENDER_MODES[renderMode].description)}
                </span>
              </div>
            </ListGroup>

            <input
              ref={projectFileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = '' // picking the same file again must fire
                void onOpenProject(f)
              }}
            />
            <ListGroup
              header={t('Circuit')}
              footer={t("A project file carries the circuit plus each board's firmware, instrument setup and panel layout.")}
            >
              <ListRow
                leading={<FolderIcon size={20} />}
                title={t('Open project…')}
                subtitle={t('An .ohmlet.json project or a plain circuit .json')}
                disabled={projectBusy}
                onPress={() => projectFileRef.current?.click()}
              />
              <ListRow
                leading={<ExportIcon size={20} />}
                title={t('Save project')}
                subtitle={t('Circuit + firmware + instruments (.ohmlet.json)')}
                disabled={projectBusy}
                onPress={() => void onSaveProject()}
              />
              <ListRow
                leading={<ImportIcon size={20} />}
                title={t('Import circuit JSON')}
                subtitle={t('From a .json file or pasted JSON')}
                chevron
                onPress={() => {
                  setView('import')
                  setSnap(1) // full height: keeps the paste area above the keyboard
                }}
              />
              <ListRow
                leading={<ExportIcon size={20} />}
                title={t('Export circuit JSON')}
                subtitle={t('Download + copy the plain layout')}
                onPress={onExport}
              />
              <ListRow
                leading={<TrashIcon size={20} />}
                title={t('Clear board')}
                destructive
                onPress={() => setConfirmClear(true)}
              />
            </ListGroup>

            {legacy && (
              <ListGroup>
                <ListRow
                  leading={<BookIcon size={20} />}
                  title={t('Lessons')}
                  subtitle={t('Guided builds, checked against the live simulation')}
                  chevron
                  onPress={() => {
                    onDismiss()
                    openLessons()
                  }}
                />
              </ListGroup>
            )}

            {legacy && (
              <>
                <div className="asm-examples-anchor" />
                <ExampleGroups desktop={desktop} onOpened={onDismiss} />
              </>
            )}

            {legacy && (
              <ListGroup header={t('Issues')}>
              {issues.length === 0 ? (
                <ListRow
                  leading={
                    <span style={{ color: 'var(--ios-green)', display: 'flex' }}>
                      <CheckIcon size={18} />
                    </span>
                  }
                  title={t('No issues')}
                  subtitle={t('The simulator is happy')}
                />
              ) : (
                issues.map((iss, i) => (
                  <ListRow
                    key={`${i}:${iss.message}`}
                    className="asm-issue-row"
                    leading={
                      <span
                        className="asm-dot"
                        style={{
                          background: iss.level === 'error' ? 'var(--ios-red)' : 'var(--ios-orange)',
                        }}
                      />
                    }
                    title={tMessage(iss.message)}
                    chevron={!!iss.componentId}
                    onPress={
                      iss.componentId
                        ? () => {
                            select(iss.componentId!)
                            onDismiss()
                          }
                        : undefined
                    }
                  />
                ))
              )}
              </ListGroup>
            )}

            <ListGroup header={t('Settings')}>
              <div className="lg-row asm-row-stack" role="listitem">
                <span className="asm-row-stack-label">{t('Interface language')}</span>
                <Segmented<Lang>
                  value={uiLang}
                  onChange={(l) => setLang(l)}
                  options={LANG_OPTIONS}
                  aria-label={t('Interface language')}
                />
              </div>
              <ListRow
                title={t('Embedded workspace')}
                subtitle={
                  workspaceCapable
                    ? t('Library, inspector and instrument tray panels')
                    : t('Shows on desktop windows ≥ 1100 px with a mouse or trackpad')
                }
                trailing={
                  <Switch
                    checked={workspaceEnabled}
                    onChange={(enabled) => setWorkspace({ enabled })}
                    aria-label={t('Embedded workspace')}
                  />
                }
              />
              {!legacy && <PerfDiagnosticsRow />}
              <ApiKeyRow />
              <ListRow
                title={t('About ohmlet')}
                trailing={`v${pkg.version}`}
                chevron
                onPress={() => setAboutOpen((o) => !o)}
              />
              {aboutOpen && (
                <div className="asm-about" role="listitem">
                  <p>{t(ABOUT_1)}</p>
                  <p>{t(ABOUT_2)}</p>
                  <p>{t(ABOUT_3)}</p>
                  <p>{t('Designed and built with Claude.')}</p>
                </div>
              )}
            </ListGroup>
          </div>
        )}
      </Sheet>

      <ActionSheet
        open={confirmClear}
        onDismiss={() => setConfirmClear(false)}
        title={t('Clear the board?')}
        message={t('Removes every component and wire. Undo brings them back.')}
        desktop={desktop}
        anchor="right"
        actions={[
          {
            label: t('Clear board'),
            destructive: true,
            onSelect: () => {
              clearBoard()
              // new chrome: the camera comes back to the whole breadboard —
              // an empty board's content framing is the home view (SH-F4)
              if (!legacy) frameCircuit()
              showToast(t('Board cleared'))
            },
          },
        ]}
      />
    </>
  )
}

/**
 * [Examples] — the curated example library (src/ui/workspace/examples.ts),
 * one inset group per category: difficulty + summary per row; opening goes
 * through lab.importProject (firmware bound, instrument setup applied), with
 * an ActionSheet confirmation when the board is not empty.
 */
function ExampleGroups({ desktop, onOpened }: { desktop: boolean; onOpened: () => void }) {
  const importProject = useLab((s) => s.importProject)
  const [confirm, setConfirm] = useState<LibraryExample | null>(null)
  const [busy, setBusy] = useState(false)
  useLang()

  const open = async (ex: LibraryExample) => {
    if (busy) return
    setBusy(true)
    const res = await openLibraryExample(ex, importProject)
    setBusy(false)
    const title = exampleTitle(ex, t)
    if (!res.ok) {
      showToast(t('Couldn’t open example: {error}', { error: res.errors[0] ? tMessage(res.errors[0]) : t('unknown error') }))
      return
    }
    tick()
    const fw = firmwareWarnings(res.warnings)
    showToast(fw.length > 0 ? t('Opened “{title}” — firmware not loaded: {error}', { title, error: tMessage(fw[0]) }) : t('Opened “{title}”', { title }))
    onOpened()
  }
  const request = (ex: LibraryExample) => {
    if (boardHasContent(useStore.getState().layout)) setConfirm(ex)
    else void open(ex)
  }

  const sections = librarySections()
  return (
    <>
      {sections.map((sec, i) => (
        <ListGroup
          key={sec.category}
          header={i === 0 ? `${t('Examples')} · ${exampleCategoryName(sec.category)}` : exampleCategoryName(sec.category)}
          footer={i === sections.length - 1 ? t('Loading an example replaces the current circuit.') : undefined}
        >
          {sec.examples.map((ex) => (
            <ListRow
              key={ex.key}
              title={exampleTitle(ex, t)}
              subtitle={t('{difficulty} · {summary}', { difficulty: exampleDifficultyName(ex.difficulty), summary: exampleSummary(ex, t) })}
              chevron
              disabled={busy}
              onPress={() => request(ex)}
            />
          ))}
        </ListGroup>
      ))}
      <ActionSheet
        open={confirm !== null}
        onDismiss={() => setConfirm(null)}
        title={t('Replace the current circuit?')}
        message={
          confirm
            ? t('“{title}” replaces the circuit on the board (undo brings it back) and the loaded firmware.', {
                title: exampleTitle(confirm, t),
              })
            : undefined
        }
        desktop={desktop}
        anchor="right"
        actions={[
          {
            label: t('Open example'),
            destructive: true,
            onSelect: () => {
              if (confirm) void open(confirm)
            },
          },
        ]}
      />
    </>
  )
}

/** About-box paragraphs (English sources; t() at render). */
const ABOUT_1 =
  'A 3D breadboard lab: place real parts on an 830-point board, wire them up, and watch them run on a live analog + digital simulator (custom MNA solver with behavioral ICs — 555s, counters, decoders, op-amps and friends).'
const ABOUT_2 =
  'Microcontroller boards run REAL firmware: load an ELF, BIN or HEX built for the STM32F103 “Blue Pill” and its Cortex-M3 code executes instruction by instruction, in lockstep with the circuit. Every part and peripheral states honestly how much of it is simulated — anything not modeled is flagged, never faked.'
const ABOUT_3 =
  'Projects save as one file with the circuit and its firmware; plain layouts still import and export as JSON, and the AI Circuit Builder drafts a whole circuit from a one-line description.'

/**
 * A JSON.parse failure for display. English shows the engine's message as
 * before; zh-TW reports the position the engine names (the engine's own
 * English wording varies by browser and cannot be translated reliably).
 */
function jsonErrorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (lang() === 'en') return t('Invalid JSON: {error}', { error: msg })
  const lc = msg.match(/line (\d+) column (\d+)/)
  if (lc) return t('Invalid JSON (line {line}, character {col})', { line: lc[1], col: lc[2] })
  const pos = msg.match(/position (\d+)/)
  if (pos) return t('Invalid JSON (character {pos})', { pos: Number(pos[1]) + 1 })
  if (/unexpected end/i.test(msg)) return t('Invalid JSON: the text ends too early')
  return t('Invalid JSON')
}

/**
 * Import sub-view — file picker + paste-JSON with the old ImportDialog's
 * validation flow: parse → shape check → store.loadLayout, surfacing the
 * returned errors as an inline list.
 */
function ImportView({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const loadLayout = useStore((s) => s.loadLayout)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    setErrors([])
    file
      .text()
      .then((t) => setText(t))
      .catch((err: unknown) => setErrors([t('Could not read file: {error}', { error: String(err) })]))
  }

  const onImport = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      setErrors([jsonErrorText(err)])
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setErrors([t('Invalid layout: expected a JSON object with "components" and "wires".')])
      return
    }
    const res = loadLayout(parsed as CircuitLayout)
    if (res.ok) {
      tick()
      showToast(t('Circuit imported'))
      onDone()
    } else {
      setErrors(res.errors.length > 0 ? res.errors.map(tMessage) : [t('Import failed (no details returned).')])
    }
  }

  return (
    <div className="asm-content asm-view">
      <div className="asm-back-row">
        <PressableButton size="sm" variant="plain" icon={<ChevronLeftIcon size={18} />} onClick={onBack}>
          {t('More')}
        </PressableButton>
      </div>

      <div className="asm-sheet-head">
        <span className="lg-title">{t('Import circuit')}</span>
      </div>

      <div className="asm-import-filerow">
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <PressableButton icon={<ImportIcon size={18} />} onClick={() => fileRef.current?.click()}>
          {t('Choose .json file…')}
        </PressableButton>
        {fileName && <span className="asm-import-filename asm-mono">{fileName}</span>}
      </div>

      <div className="asm-import-or lg-caption">{t('or paste layout JSON')}</div>

      <textarea
        className="asm-import-text"
        // pasted / placeholder JSON is data, not UI copy
        translate="no"
        rows={8}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        placeholder='{ "version": 1, "components": [ … ], "wires": [ … ] }'
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (errors.length > 0) setErrors([])
        }}
      />

      {errors.length > 0 && (
        <div className="asm-error" role="alert">
          <div className="asm-error-title">
            {errors.length === 1
              ? t('Import failed — {n} problem', { n: errors.length })
              : t('Import failed — {n} problems', { n: errors.length })}
          </div>
          <ul className="asm-error-msg">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <PressableButton
        variant="filled"
        size="lg"
        className="asm-block"
        disabled={text.trim().length === 0}
        onClick={onImport}
      >
        {t('Import')}
      </PressableButton>
    </div>
  )
}
