/**
 * 效能診斷 view model (pure): a PerfSnapshot + the lab's board states →
 * the overlay's sections of label / value rows and its one-line summary.
 * The overlay (PerfOverlay.tsx) writes these strings into its DOM at 2 Hz;
 * tests pin them (tests/perf-overlay.test.ts).
 *
 * Same words, same units as the rest of the lab: 模擬速度 and 「n 倍速」
 * (fmtSpeedFactor — the run capsule's figure), percentages through
 * fmtPercent, times / frequencies through the SI formatter (fmtSi: 「28.0
 * ms」, 「54.2 MHz」), counts with thin grouping (fmtCount — the MCU panel's
 * cycle counter), board states through mcuStateLabel + stateColor (the MCU
 * panel's state name, STATE_TONE — the MCU badge's colour). Nothing is
 * estimated: a figure the browser or the simulation does not report reads
 * 「—」 with the reason in its title.
 */
import { t } from '../../i18n'
import { fmtPercent, fmtSi, fmtSpeedFactor } from '../../instruments/format'
import { fmtBytes, fmtCount, MCU_STATE_META, type McuUiState } from '../embedded/format'
import { mcuStateLabel } from '../embedded/McuPanel'
import { stateColor } from '../chrome/run-control'
import type { PerfSnapshot } from './collector'

export interface PerfRow {
  /** stable key (DOM slot) */
  key: string
  label: string
  value: string
  /** hover text: what the figure means / why it is missing */
  title?: string
  /** CSS colour of a leading state dot (board rows) */
  dot?: string
}

export interface PerfSection {
  key: 'render' | 'ui' | 'sim'
  title: string
  rows: PerfRow[]
}

/** One microcontroller board as the overlay lists it. */
export interface PerfBoard {
  id: string
  state: McuUiState
}

const DASH = '—'

/** A duration in ms through the shared SI formatter: 「28.0 ms」, 「146 ms」, 「850 µs」. */
export function fmtMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return DASH
  return fmtSi(ms / 1000, 's', 3)
}

/** Frames per second: 「每秒 60 張」, 「每秒 8.5 張」 (English: 60 fps). */
export function fmtFps(fps: number | null | undefined): string {
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) return DASH
  return t('{n} fps', { n: fps < 10 ? fps.toFixed(1) : String(Math.round(fps)) })
}

/** A typical / slowest-5 % pair: 「28.0 ms，最慢 146 ms」. */
function typicalSlow(p50: number | null, p95: number | null): string {
  if (p50 === null || !Number.isFinite(p50)) return DASH
  if (p95 === null || !Number.isFinite(p95)) return fmtMs(p50)
  return t('{typical}, slowest {slow}', { typical: fmtMs(p50), slow: fmtMs(p95) })
}

/** A per-second rate: 「每秒 19.6 次」. */
function perSecond(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return DASH
  return t('{n} per second', { n: n < 100 ? n.toFixed(1) : fmtCount(n) })
}

/** The simulation keeps up when it reaches this share of the speed it was asked for. */
const KEEPS_UP = 0.95
/** The simulation thread counts as fully loaded from this share of each second (%). */
const FULL_LOAD_PCT = 90
/** Fewer frames per second than this read as a stuttering picture. */
const SMOOTH_FPS = 30

/** The answer to 「為什麼慢？」 (QA clarity PERF-ORDER-VERDICT): the one line the card leads with. */
export interface PerfVerdict {
  /** 'sim' = the computer cannot compute faster; 'busy' = the main thread holds the simulation back; 'render' = the 3D view is heavy; 'ok' */
  kind: 'sim' | 'busy' | 'render' | 'ok'
  /** the sentence under the title */
  text: string
  /** its few words for the folded summary line */
  short: string
}

/**
 * Why it is slow, from the snapshot alone (QA clarity PERF-ORDER-VERDICT) —
 * the simulation first (a sim that falls behind with its thread fully
 * loaded: 「模擬 0.5 倍速：模擬執行緒已滿載（96 %）——是電腦算不夠快，不是畫面卡」),
 * then the picture (「畫面每秒不到 30 張：3D 太重…」), else 「一切正常」.
 * `target` = the speed the simulation was asked for (the 0.1× / 10× setting).
 */
export function perfVerdict(s: PerfSnapshot, target = 1): PerfVerdict {
  const sim = s.sim?.running ? s.sim : null
  const goal = target > 0 && Number.isFinite(target) ? target : 1
  const behind = !!sim && sim.realtime < KEEPS_UP * goal
  if (sim && behind && sim.busyPct >= FULL_LOAD_PCT) {
    return {
      kind: 'sim',
      text: t('Simulation at {speed}: the simulation thread is fully loaded ({load}) — the computer cannot compute faster; the picture is not what is slow', {
        speed: fmtSpeedFactor(sim.realtime),
        load: fmtPercent(Math.min(100, sim.busyPct) / 100),
      }),
      short: t('the computer cannot compute faster'),
    }
  }
  if (s.fps !== null && Number.isFinite(s.fps) && s.fps < SMOOTH_FPS) {
    return {
      kind: 'render',
      text: t('Fewer than 30 frames a second: the 3D view is heavy — choose “Performance” under More → Settings → Render mode'),
      short: t('the 3D view is heavy'),
    }
  }
  if (sim && behind) {
    return {
      kind: 'busy',
      text: t('Simulation at {speed} while its thread is not fully loaded ({load}): the page’s main thread holds it back — see Rendering and Interface below', {
        speed: fmtSpeedFactor(sim.realtime),
        load: fmtPercent(Math.max(0, sim.busyPct) / 100),
      }),
      short: t('the main thread is busy'),
    }
  }
  return sim
    ? { kind: 'ok', text: t('All fine: the simulation keeps up with real time'), short: t('all fine') }
    : { kind: 'ok', text: t('All fine: the picture is smooth (the simulation is not running)'), short: t('all fine') }
}

/** The header line: 「每秒 23 張 · 1.0 倍速 · 一切正常」 (frame rate, the run's speed while it runs, the verdict). */
export function perfSummary(s: PerfSnapshot, target = 1): string {
  const parts = [fmtFps(s.fps)]
  if (s.sim?.running) parts.push(fmtSpeedFactor(s.sim.realtime))
  parts.push(perfVerdict(s, target).short)
  return parts.join(' · ')
}

/**
 * The overlay's three sections, the simulation FIRST (QA clarity
 * PERF-ORDER-VERDICT: the card's height cap cuts graphics detail, never the
 * speed, the thread load and the boards' MIPS — the figures that answer
 * 「為什麼慢？」). `boards`: the MCU boards in the layout, in layout order.
 * `host`: where the simulation runs — 'inline' (the browser could not start
 * the worker) puts its load on the main thread, and the row says so.
 */
export function perfSections(
  s: PerfSnapshot,
  boards: readonly PerfBoard[],
  host: 'worker' | 'inline' | null = 'worker',
): PerfSection[] {
  const render: PerfRow[] = [
    {
      key: 'fps',
      label: t('Frame rate'),
      value: fmtFps(s.fps),
      title: t('How often the browser shows a new frame of the 3D view'),
    },
    {
      key: 'frame',
      label: t('Frame time'),
      value: typicalSlow(s.frameP50, s.frameP95),
      title: t('Time between two frames: the typical one and the slowest 5 %'),
    },
    {
      key: 'cpu',
      label: t('3D CPU time per frame'),
      value: typicalSlow(s.cpuP50, s.cpuP95),
      title: t('Main-thread time the 3D view spends preparing one frame (camera, effects, draw submission)'),
    },
    {
      key: 'draw',
      label: t('Draw calls per frame'),
      value:
        s.calls === null
          ? DASH
          : t('{calls} calls · {tris} triangles', { calls: fmtCount(s.calls), tris: fmtCount(s.triangles ?? 0) }),
      title: t('Draw calls and triangles of the newest frame, every render pass included'),
    },
    {
      key: 'gpu',
      label: t('GPU resources'),
      value:
        s.geometries === null
          ? DASH
          : t('{geo} geometries · {tex} textures', { geo: fmtCount(s.geometries), tex: fmtCount(s.textures ?? 0) }),
      title: t('Geometries and textures the renderer currently holds on the graphics card'),
    },
  ]
  if (s.gpu.software) {
    render.push({
      key: 'soft',
      label: t('Graphics'),
      value: t('Software rendering (no graphics card)'),
      title: t('WebGL runs on the CPU here ({renderer}): frame figures do not represent a computer with a graphics card', {
        renderer: s.gpu.renderer ?? '',
      }),
    })
  }

  const ui: PerfRow[] = [
    s.commitSource === 'react'
      ? {
          key: 'commits',
          label: t('React updates'),
          value: perSecond(s.commitsPerSec),
          title: t('React commits per second (every interface re-render that reached the page)'),
        }
      : {
          key: 'commits',
          label: t('Interface updates'),
          value: perSecond(s.commitsPerSec),
          title: t('Page change batches per second — counted from DOM changes because this browser gives React no commit hook'),
        },
    {
      key: 'longtask',
      label: t('Main-thread long tasks'),
      value: s.longTaskShare === null ? DASH : fmtPercent(s.longTaskShare),
      title:
        s.longTaskShare === null
          ? t('This browser does not report long tasks')
          : t('Share of time the main thread was stuck in tasks of 50 ms or more — lower is smoother'),
    },
    {
      key: 'heap',
      label: t('JS memory'),
      value: s.heapMB === null ? DASH : fmtBytes(s.heapMB * 1024 * 1024),
      title: s.heapMB === null ? t('This browser does not report memory use') : t('JavaScript memory in use on this page'),
    },
  ]

  const sim: PerfRow[] = []
  const live = s.sim
  if (!live || !live.running) {
    sim.push({ key: 'idle', label: t('Real time'), value: DASH, title: t('Start the simulation to see its figures') })
  } else {
    sim.push(
      {
        key: 'rt',
        label: t('Real time'),
        value: fmtSpeedFactor(live.realtime),
        title: t('Simulated time per wall-clock second over the last second'),
      },
      {
        key: 'busy',
        label: host === 'inline' ? t('Simulation load (main thread)') : t('Simulation thread load'),
        value: fmtPercent(Math.max(0, live.busyPct) / 100),
        title:
          host === 'inline'
            ? t('This browser could not start the simulation thread: the simulation shares the main thread with the interface')
            : t('Share of each second the simulation thread spends computing (100 % = it cannot go faster)'),
      },
    )
  }
  // the boards' state and speed right after the thread load (the figures a slow run is judged by)
  const perf = new Map(s.mcus.map((m) => [m.componentId, m]))
  for (const b of boards) {
    const m = perf.get(b.id)
    const meta = MCU_STATE_META[b.state]
    const executing = b.state === 'running' || b.state === 'sleeping'
    const speed =
      executing && m && m.mips !== null
        ? t('{mips} MIPS · {mhz}', { mips: m.mips.toFixed(1), mhz: m.mhz === null ? DASH : fmtSi(m.mhz * 1e6, 'Hz', 3) })
        : null
    sim.push({
      key: `mcu:${b.id}`,
      label: b.id,
      value: speed ? `${mcuStateLabel(b.state)} · ${speed}` : mcuStateLabel(b.state),
      title: speed
        ? t('Instructions this board executes per wall-clock second (million), and the simulated core cycles per second')
        : t(meta.hint),
      dot: stateColor(b.state),
    })
  }
  if (live && live.running) {
    sim.push(
      {
        key: 'steps',
        label: t('Analog steps'),
        value: t('{n} steps per second', { n: fmtCount(live.stepsPerSecond) }),
        title: t('Circuit-solver time steps per wall-clock second'),
      },
      {
        key: 'frames',
        label: t('Simulation data'),
        value:
          live.framesPerSec === null
            ? DASH
            : live.handleMs === null
              ? perSecond(live.framesPerSec)
              : t('{rate} · {ms} each', { rate: perSecond(live.framesPerSec), ms: fmtMs(live.handleMs) }),
        title: t('Results the simulation sends to the page per second, and the main-thread time to show each one'),
      },
    )
    if (s.partsAppliedPerPush !== null) {
      sim.push({
        key: 'parts',
        label: t('3D part refresh'),
        value: t('{applied} refreshed · {skipped} unchanged · {ms}', {
          applied: (s.partsAppliedPerPush ?? 0).toFixed(1),
          skipped: (s.partsSkippedPerPush ?? 0).toFixed(1),
          ms: fmtMs(s.telemetryMsPerPush),
        }),
        title: t('Per simulation result: parts whose look changed and were redrawn, parts skipped as unchanged, and the time it took'),
      })
    }
  }

  return [
    { key: 'sim', title: t('Simulation'), rows: sim },
    { key: 'render', title: t('Rendering'), rows: render },
    { key: 'ui', title: t('Interface'), rows: ui },
  ]
}
