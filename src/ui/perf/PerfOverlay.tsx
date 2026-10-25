/**
 * 效能診斷 (performance diagnostics) overlay + its More-sheet switch row.
 *
 *   <PerfOverlay sceneRef={sceneRef} />   App.tsx (one line; renders nothing while off)
 *   <PerfDiagnosticsRow />                 More sheet → 設定 (new chrome only)
 *
 * Off by default (usePerfDiag — localStorage 'bb.perfDiag', or ?perf). While
 * on, it starts the page-wide collector (collector.ts: frame rate / frame
 * time, the scene probe's CPU ms per frame, draw calls, triangles, GPU
 * resources, React commits, long tasks, JS memory, and from the simulation
 * frames the speed, analog steps, simulation-thread load and per-board
 * MIPS) and shows it in a small Tier-S card in a corner of the free scene
 * area — never over the board centre. The scene frames the circuit in the
 * centre of the free area (the workspace insets / the phone chrome), so the
 * card never crosses that area's horizontal centre line: on desktop it
 * hangs from the top-right corner (beside the run capsule, or below it and
 * the status pill when the column is too narrow) and its height is capped
 * above the centre line; on phones it grows upward from above the undo pill
 * and stays below the centre line (and starts folded to its one-line
 * summary). When the cap leaves too little room for the figures, the card
 * stays folded and its expand button says why ("cramped").
 *
 * Cost discipline (no per-frame React work): React renders the card's
 * frame once; every 500 ms one interval reads collector.snapshot() and
 * writes the changed strings straight into the DOM (view.ts builds them).
 * The collector ignores the card's own DOM writes, and stop() on unmount
 * removes every hook, so turning it off returns the page to zero cost.
 *
 * Material: Tier S (near-opaque over-scene tint + lg-rim + slab inset
 * shadows, NO backdrop-filter — DESIGN.md §1 budget). zh-TW through t()
 * (src/i18n/zh-TW/perf.ts). `data-scene-avoid`: the 3D hover chip keeps
 * clear of it. The profiling rig (scripts/perf-win.mjs, ?perfrig) reads the
 * same snapshot through window.__perfRig.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { t, useLang } from '../../i18n'
import { peekSimHost, useStore } from '../../state/store'
import { getEntry } from '../../model/catalog'
import { useLab } from '../embedded/lab'
import { mcuUiStateOf } from '../embedded/format'
import { CloseIcon, ChevronDownIcon, ChevronUpIcon, ListRow, Switch, pressProps } from '../kit'
import { perfCollector, type PerfSceneLike } from './collector'
import { usePerfDiag } from './state'
import { perfSections, perfSummary, perfVerdict, type PerfBoard, type PerfSection } from './view'
import './perf.css'

/** ms between overlay refreshes (rates are over the collector's trailing 2 s window) */
const REFRESH_MS = 500
const LS_FOLDED = 'bb.perfDiag.folded'

function loadFolded(): boolean {
  try {
    const v = window.localStorage.getItem(LS_FOLDED)
    if (v === '1') return true
    if (v === '0') return false
    // no choice yet: phones start folded (the card would cover too much of a small canvas)
    return window.matchMedia?.('(max-width: 599px)').matches ?? false
  } catch {
    return false
  }
}

function saveFolded(folded: boolean): void {
  try {
    window.localStorage.setItem(LS_FOLDED, folded ? '1' : '0')
  } catch {
    /* storage unavailable: the fold still works for this page */
  }
}

/** The MCU boards of the current layout with their honest UI state (the MCU panel's rule). */
function boardsNow(): PerfBoard[] {
  const st = useStore.getState()
  const lab = useLab.getState()
  const out: PerfBoard[] = []
  for (const c of st.layout.components) {
    if (!getEntry(c.type)?.mcu) continue
    const f = lab.mcus[c.id]
    out.push({
      id: c.id,
      state: mcuUiStateOf({
        hasFirmware: lab.firmware[c.id] != null,
        running: st.running,
        simTime: st.simTime > 0 ? 1 : 0,
        frame: f ? { state: f.state, pc: f.pc } : null,
      }),
    })
  }
  return out
}

interface RowSlot {
  row: HTMLElement
  value: HTMLElement
  label: HTMLElement
  dot: HTMLElement | null
}

/** Imperative body: builds the rows once per shape, then only rewrites changed text. */
class BodyWriter {
  private shape = ''
  private readonly slots = new Map<string, RowSlot>()
  constructor(private readonly host: HTMLElement) {}

  write(sections: PerfSection[]): void {
    const shape = sections.map((s) => `${s.key}:${s.title}:${s.rows.map((r) => r.key).join(',')}`).join('|')
    if (shape !== this.shape) this.build(sections, shape)
    for (const s of sections) {
      for (const r of s.rows) {
        const slot = this.slots.get(r.key)
        if (!slot) continue
        if (slot.label.textContent !== r.label) slot.label.textContent = r.label
        if (slot.value.textContent !== r.value) slot.value.textContent = r.value
        const title = r.title ?? ''
        if (slot.row.title !== title) slot.row.title = title
        if (slot.dot && r.dot && slot.dot.style.background !== r.dot) slot.dot.style.background = r.dot
      }
    }
  }

  private build(sections: PerfSection[], shape: string): void {
    this.shape = shape
    this.slots.clear()
    const frag = document.createDocumentFragment()
    for (const s of sections) {
      const sec = document.createElement('section')
      sec.className = 'perf-ov-sec'
      const h = document.createElement('h3')
      h.className = 'perf-ov-h'
      h.textContent = s.title
      sec.appendChild(h)
      const dl = document.createElement('dl')
      dl.className = 'perf-ov-rows'
      for (const r of s.rows) {
        const row = document.createElement('div')
        row.className = 'perf-ov-row'
        const dt = document.createElement('dt')
        let dot: HTMLElement | null = null
        if (r.dot) {
          dot = document.createElement('span')
          dot.className = 'perf-ov-dot'
          dot.setAttribute('aria-hidden', 'true')
          dt.appendChild(dot)
        }
        const label = document.createElement('span')
        dt.appendChild(label)
        const dd = document.createElement('dd')
        dd.setAttribute('translate', 'no') // figures + units: data, not prose
        row.append(dt, dd)
        dl.appendChild(row)
        this.slots.set(r.key, { row, value: dd, label, dot })
      }
      sec.appendChild(dl)
      frag.appendChild(sec)
    }
    this.host.replaceChildren(frag)
  }
}

/** The card (mounted only while diagnostics are on). */
function PerfPanel({ sceneRef }: { sceneRef: RefObject<PerfSceneLike | null> }) {
  useLang() // static labels follow a language switch; values follow on the next refresh
  const rootRef = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const sumRef = useRef<HTMLSpanElement | null>(null)
  /** the diagnosis line under the title (QA clarity PERF-ORDER-VERDICT) */
  const verdictRef = useRef<HTMLParagraphElement | null>(null)
  const [folded, setFolded] = useState(loadFolded)
  const foldedRef = useRef(folded)
  foldedRef.current = folded
  const refreshRef = useRef<(() => void) | null>(null)
  // too little room beside the circuit for the figures: the card stays folded
  const [cramped, setCramped] = useState(false)
  const crampedRef = useRef(false)
  const shownFolded = folded || cramped
  const foldLabel = cramped
    ? t('Not enough room beside the circuit — enlarge the window or close a side panel to see the figures')
    : folded
      ? t('Show the figures')
      : t('Fold to the summary line')

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // the free scene area (workspace insets; the viewport without the workspace)
    const free = document.createElement('div')
    free.className = 'perf-ov-free'
    free.setAttribute('aria-hidden', 'true')
    document.body.appendChild(free)
    perfCollector.start()
    const unignore = perfCollector.ignoreMutationsIn(root)
    const unignoreFree = perfCollector.ignoreMutationsIn(free)
    const rig = new URLSearchParams(window.location.search).has('perfrig')
    const g = window as unknown as Record<string, unknown>
    if (rig) g.__perfRig = { snapshot: () => perfCollector.snapshot() }
    const body = bodyRef.current ? new BodyWriter(bodyRef.current) : null
    // a capped card scrolls: fade its lower edge while more rows are below
    const bodyEl = bodyRef.current
    const markMore = () => {
      if (!bodyEl) return
      const more = bodyEl.scrollTop + bodyEl.clientHeight < bodyEl.scrollHeight - 1
      if (bodyEl.classList.contains('has-more') !== more) bodyEl.classList.toggle('has-more', more)
    }
    const refresh = () => {
      perfCollector.setScene(sceneRef.current)
      const snap = perfCollector.snapshot()
      const target = useStore.getState().simSpeed
      const sum = perfSummary(snap, target)
      if (sumRef.current && sumRef.current.textContent !== sum) sumRef.current.textContent = sum
      // the answer to 「為什麼慢？」 first, then the figures
      const verdict = perfVerdict(snap, target)
      const vEl = verdictRef.current
      if (vEl) {
        if (vEl.textContent !== verdict.text) vEl.textContent = verdict.text
        if (vEl.dataset.kind !== verdict.kind) vEl.dataset.kind = verdict.kind
      }
      if (body && !foldedRef.current && !crampedRef.current) body.write(perfSections(snap, boardsNow(), peekSimHost()?.kind ?? null))
      const cramped = placeCard(root, free, !foldedRef.current)
      if (cramped !== crampedRef.current) {
        crampedRef.current = cramped
        setCramped(cramped)
      }
      markMore()
    }
    bodyEl?.addEventListener('scroll', markMore, { passive: true })
    refreshRef.current = refresh
    refresh()
    const id = window.setInterval(refresh, REFRESH_MS)
    const onResize = () => refreshRef.current?.()
    window.addEventListener('resize', onResize)
    return () => {
      refreshRef.current = null
      window.clearInterval(id)
      window.removeEventListener('resize', onResize)
      bodyEl?.removeEventListener('scroll', markMore)
      unignore()
      unignoreFree()
      free.remove()
      if (rig) delete g.__perfRig
      perfCollector.stop()
    }
    // sceneRef is a stable ref object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // unfolding shows current figures at once (not the last ones from before the fold)
  useEffect(() => {
    if (!shownFolded) refreshRef.current?.()
  }, [shownFolded])

  const toggleFold = () => {
    setFolded((f) => {
      saveFolded(!f)
      return !f
    })
  }

  return (
    <section
      ref={rootRef}
      className={`perf-ov lg-rim${shownFolded ? ' is-folded' : ''}`}
      aria-label={t('Performance diagnostics')}
      data-scene-avoid=""
    >
      <header className="perf-ov-head">
        <button
          type="button"
          className="perf-ov-title"
          tabIndex={-1 /* a large pointer target; the chevron is the keyboard control */}
          aria-expanded={!shownFolded}
          title={foldLabel}
          aria-disabled={cramped || undefined}
          onClick={cramped ? undefined : toggleFold}
        >
          <span className="perf-ov-name">{t('Performance diagnostics')}</span>
          <span className="perf-ov-sum" ref={sumRef} translate="no" />
        </button>
        <button
          type="button"
          className="perf-ov-btn lg-pressable"
          aria-label={foldLabel}
          title={foldLabel}
          aria-expanded={!shownFolded}
          aria-disabled={cramped || undefined}
          {...pressProps}
          onClick={cramped ? undefined : toggleFold}
        >
          {shownFolded ? <ChevronDownIcon size={16} /> : <ChevronUpIcon size={16} />}
        </button>
        <button
          type="button"
          className="perf-ov-btn lg-pressable"
          aria-label={t('Turn off performance diagnostics')}
          title={t('Turn off performance diagnostics')}
          {...pressProps}
          onClick={() => usePerfDiag.getState().setEnabled(false)}
        >
          <CloseIcon size={14} />
        </button>
      </header>
      <p className="perf-ov-verdict" ref={verdictRef} hidden={shownFolded} role="status" />
      <div className="perf-ov-body" ref={bodyRef} hidden={shownFolded} />
      {!shownFolded && <p className="perf-ov-foot">{t('Averages over the last 2 s, refreshed twice a second')}</p>}
    </section>
  )
}

/** Expanded card height below which the figures are not worth showing (px). */
const MIN_OPEN_PX = 150
/** Air between the card and the free area's centre line (px). */
const CENTRE_GAP_PX = 12

/**
 * Place the card (2 Hz and on resize; a few rect reads): beside the run
 * capsule + status pill when there is room, else below them (`.is-low`,
 * desktop); then cap its height so it never crosses the horizontal centre
 * line of the free scene area (`free`: the workspace insets, or the
 * viewport). Returns true when the cap leaves less than MIN_OPEN_PX — the
 * card then stays folded ("cramped"). `wantOpen`: the user has it unfolded.
 */
function placeCard(root: HTMLElement, free: HTMLElement, wantOpen: boolean): boolean {
  let r = root.getBoundingClientRect()
  let low = false
  for (const el of document.querySelectorAll('.app-run-capsule, .app-status-pill.is-in')) {
    const c = el.getBoundingClientRect()
    if (c.width > 0 && r.left < c.right + 8 && r.right > c.left - 8) {
      low = true
      break
    }
  }
  if (root.classList.contains('is-low') !== low) {
    root.classList.toggle('is-low', low)
    r = root.getBoundingClientRect()
  }
  const f = free.getBoundingClientRect()
  const centreY = f.top + f.height / 2
  // phones: anchored at the bottom, growing upward; desktop: hanging from the top
  const fromBottom = window.matchMedia?.('(max-width: 599px)').matches ?? false
  const room = fromBottom ? r.bottom - (centreY + CENTRE_GAP_PX) : centreY - CENTRE_GAP_PX - r.top
  const cramped = room < MIN_OPEN_PX
  // the cap only shapes an open card (a folded one is a single header line)
  const cap = wantOpen && !cramped ? `${Math.floor(room)}px` : ''
  if (root.style.maxHeight !== cap) root.style.maxHeight = cap
  return cramped
}

/** App.tsx mounts this once; it renders nothing while diagnostics are off. */
export function PerfOverlay({ sceneRef }: { sceneRef: RefObject<PerfSceneLike | null> }) {
  const enabled = usePerfDiag((s) => s.enabled)
  return enabled ? <PerfPanel sceneRef={sceneRef} /> : null
}

/** More sheet → 設定: the 「效能診斷」 switch. */
export function PerfDiagnosticsRow() {
  const enabled = usePerfDiag((s) => s.enabled)
  return (
    <ListRow
      title={t('Performance diagnostics')}
      subtitle={t('Frame rate, simulation speed and each board’s MIPS in a corner of the 3D view')}
      trailing={
        <Switch
          checked={enabled}
          onChange={(on) => usePerfDiag.getState().setEnabled(on)}
          aria-label={t('Performance diagnostics')}
        />
      }
    />
  )
}
