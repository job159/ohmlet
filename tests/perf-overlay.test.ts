/**
 * 效能診斷 overlay (src/ui/perf): the view model's strings (same words, same
 * units, same state colours as the rest of the lab), its honesty about
 * figures a browser does not report, and the zh-TW dictionary
 * (src/i18n/zh-TW/perf.ts): every key the perf UI hands to t() is
 * translated, no key silently overrides another area's translation, and the
 * text is Taiwan-usage Chinese without English words.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests, hasTranslation, t } from '../src/i18n'
import perfDict from '../src/i18n/zh-TW/perf'
import { stateColor } from '../src/ui/chrome/run-control'
import { fmtSpeedFactor } from '../src/instruments/format'
import { fmtCount } from '../src/ui/embedded/format'
import { PerfCollector, glRendererOf, type PerfSnapshot } from '../src/ui/perf/collector'
import { fmtFps, fmtMs, perfSections, perfSummary, type PerfBoard } from '../src/ui/perf/view'
import { englishLeft, halfWidthPunctuation, MAINLAND_TERMS } from './i18n/zh-check'

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => __setLangForTests('zh-TW'))

const ROOT = path.resolve(__dirname, '..')

function snapshot(over: Partial<PerfSnapshot> = {}): PerfSnapshot {
  return {
    windowMs: 2000,
    fps: 23.2,
    frameP50: 28.04,
    frameP95: 145.7,
    cpuP50: 5.6,
    cpuP95: 8.9,
    calls: 218,
    triangles: 239455,
    geometries: 99,
    textures: 47,
    programs: 53,
    commitsPerSec: 20.5,
    commitSource: 'react',
    telemetryPushesPerSec: 37.9,
    telemetryMsPerPush: 0.043,
    partsAppliedPerPush: 0.09,
    partsSkippedPerPush: 3.91,
    sim: { running: true, realtime: 1.03, stepsPerSecond: 20402.4, busyPct: 87.9, framesPerSec: 37.9, handleMs: 0.47 },
    mcus: [{ componentId: 'U1', state: 'running', mips: 39.04, mhz: 69.7 }],
    heapMB: 91.2,
    longTaskShare: 0,
    gpu: { renderer: 'ANGLE (Intel, Intel(R) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', software: false },
    ...over,
  }
}

const RUNNING: PerfBoard[] = [{ id: 'U1', state: 'running' }]

function row(sections: ReturnType<typeof perfSections>, key: string) {
  for (const s of sections) for (const r of s.rows) if (r.key === key) return r
  return undefined
}

describe('perf view model (zh-TW)', () => {
  it('formats with the shared units: fps, ms through the SI formatter, 倍速, %, grouped counts', () => {
    const s = perfSections(snapshot(), RUNNING)
    // the simulation first: the card's height cap cuts graphics detail, never the speed (QA clarity PERF-ORDER-VERDICT)
    expect(s.map((x) => x.title)).toEqual(['模擬', '畫面', '介面'])
    expect(row(s, 'fps')?.value).toBe('每秒 23 張')
    expect(row(s, 'frame')?.value).toBe('28.0 ms，最慢 146 ms')
    expect(row(s, 'cpu')?.value).toBe('5.60 ms，最慢 8.90 ms')
    // counts use the MCU panel's thin-space grouping (fmtCount)
    expect(row(s, 'draw')?.value).toBe(`218 次 · 三角形 ${fmtCount(239455)} 個`)
    expect(row(s, 'gpu')?.value).toBe('幾何體 99 個 · 貼圖 47 張')
    expect(row(s, 'commits')?.label).toBe('介面重繪')
    expect(row(s, 'commits')?.value).toBe('每秒 20.5 次')
    expect(row(s, 'longtask')?.value).toBe('0.0 %')
    expect(row(s, 'heap')?.value).toBe('91.2 MiB')
    // the run capsule's speed figure, under the MCU panel's word for it
    expect(row(s, 'rt')?.label).toBe(t('Real time'))
    expect(row(s, 'rt')?.label).toBe('模擬速度')
    expect(row(s, 'rt')?.value).toBe(fmtSpeedFactor(1.03))
    expect(row(s, 'rt')?.value).toBe('1.0 倍速')
    expect(row(s, 'steps')?.value).toBe(`每秒 ${fmtCount(20402)} 步`)
    expect(row(s, 'busy')?.value).toBe('87.9 %')
    expect(row(s, 'frames')?.value).toBe('每秒 37.9 次 · 每次 470 µs')
    expect(row(s, 'parts')?.value).toBe('更新 0.1 個 · 略過 3.9 個 · 43.0 µs')
    // the folded line ends with the verdict (23 frames a second: the 3D view is heavy)
    expect(perfSummary(snapshot())).toBe('每秒 23 張 · 1.0 倍速 · 3D 太重')
  })

  it('lists each board with the MCU panel state name, the STATE_TONE colour and its MIPS', () => {
    const s = perfSections(snapshot(), RUNNING)
    const u1 = row(s, 'mcu:U1')
    expect(u1?.label).toBe('U1')
    expect(u1?.value).toBe('執行中 · 39.0 MIPS · 69.7 MHz')
    expect(u1?.dot).toBe(stateColor('running'))
    // a halted board shows its state only (no rate for a core that is not executing)
    const halted = row(perfSections(snapshot(), [{ id: 'U1', state: 'halted' }]), 'mcu:U1')
    expect(halted?.value).not.toMatch(/MIPS/)
    expect(halted?.dot).toBe(stateColor('halted'))
    // no firmware: orange, and the panel's own words
    const none = row(perfSections(snapshot({ mcus: [] }), [{ id: 'U2', state: 'no-firmware' }]), 'mcu:U2')
    expect(none?.dot).toBe(stateColor('no-firmware'))
    expect(none?.value).toBe('還沒有韌體')
  })

  it('is honest about figures that are not measured', () => {
    const s = perfSections(
      snapshot({ longTaskShare: null, heapMB: null, calls: null, geometries: null, fps: null, frameP50: null, frameP95: null }),
      RUNNING,
    )
    expect(row(s, 'longtask')?.value).toBe('—')
    expect(row(s, 'longtask')?.title).toBe('這個瀏覽器不提供長任務資訊')
    expect(row(s, 'heap')?.value).toBe('—')
    expect(row(s, 'heap')?.title).toBe('這個瀏覽器不提供記憶體用量')
    expect(row(s, 'draw')?.value).toBe('—')
    expect(row(s, 'fps')?.value).toBe('—')
    expect(row(s, 'frame')?.value).toBe('—')
    // no React commit hook: the figure says what it counts
    const dom = perfSections(snapshot({ commitSource: 'dom' }), RUNNING)
    expect(row(dom, 'commits')?.label).toBe('頁面更新')
    // simulation stopped: no stale speed, a hint where to start it
    const idle = perfSections(snapshot({ sim: null }), [])
    expect(row(idle, 'idle')?.value).toBe('—')
    expect(row(idle, 'idle')?.title).toBe('按「執行模擬」後顯示模擬的數字')
    expect(row(idle, 'rt')).toBeUndefined()
    expect(perfSummary(snapshot({ sim: null }))).toBe('每秒 23 張 · 3D 太重')
    // an inline host (no worker): the load is the main thread's, and the row says so
    expect(row(perfSections(snapshot(), RUNNING, 'worker'), 'busy')?.label).toBe('模擬背景執行緒負載')
    expect(row(perfSections(snapshot(), RUNNING, 'inline'), 'busy')?.label).toBe('模擬負載（主執行緒）')
    // software WebGL is called out (frame figures would mislead)
    const soft = perfSections(snapshot({ gpu: { renderer: 'Google SwiftShader', software: true } }), RUNNING)
    expect(row(soft, 'soft')?.value).toBe('軟體繪圖（沒有使用顯示卡）')
    expect(row(perfSections(snapshot(), RUNNING), 'soft')).toBeUndefined()
  })

  it('formats durations and frame rates', () => {
    expect(fmtMs(16.67)).toBe('16.7 ms')
    expect(fmtMs(0.85)).toBe('850 µs')
    expect(fmtMs(146.2)).toBe('146 ms')
    expect(fmtMs(NaN)).toBe('—')
    expect(fmtMs(null)).toBe('—')
    expect(fmtFps(59.6)).toBe('每秒 60 張')
    expect(fmtFps(8.46)).toBe('每秒 8.5 張')
    expect(fmtFps(0)).toBe('—')
  })

  it('reads in English with the English sources', () => {
    __setLangForTests('en')
    const s = perfSections(snapshot(), RUNNING)
    expect(row(s, 'fps')?.value).toBe('23 fps')
    expect(row(s, 'frame')?.value).toBe('28.0 ms, slowest 146 ms')
    expect(row(s, 'mcu:U1')?.value).toBe('Running · 39.0 MIPS · 69.7 MHz')
  })
})

describe('perf collector (node: no DOM, no long-task API)', () => {
  it('snapshots without a page: nulls, never invented figures', () => {
    const c = new PerfCollector()
    const s = c.snapshot()
    expect(s.fps).toBeNull()
    expect(s.calls).toBeNull()
    expect(s.sim).toBeNull()
    expect(s.mcus).toEqual([])
    expect(s.longTaskShare).toBeNull()
    expect(s.gpu).toEqual({ renderer: null, software: false })
    expect(c.active).toBe(false)
  })

  it('recognises software WebGL renderers', () => {
    const fake = (renderer: string) =>
      ({
        getContext: () => ({
          getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }),
          getParameter: () => renderer,
        }),
      }) as unknown as HTMLCanvasElement
    expect(glRendererOf(fake('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).software).toBe(true)
    expect(glRendererOf(fake('llvmpipe (LLVM 15.0.7, 256 bits)')).software).toBe(true)
    expect(glRendererOf(fake('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)')).software).toBe(true)
    expect(glRendererOf(fake('ANGLE (Intel, Intel(R) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).software).toBe(false)
    expect(glRendererOf(null)).toEqual({ renderer: null, software: false })
  })
})

describe('perf zh-TW dictionary', () => {
  const sources = readdirSync(path.join(ROOT, 'src/ui/perf'))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => readFileSync(path.join(ROOT, 'src/ui/perf', f), 'utf8'))
  const keys = new Set<string>()
  for (const src of sources) {
    for (const m of src.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) keys.add(m[2].replace(/\\(['"\\])/g, '$1'))
  }

  it('translates every key the perf UI hands to t()', () => {
    expect(keys.size).toBeGreaterThan(30)
    const missing = [...keys].filter((k) => !hasTranslation(k))
    expect(missing).toEqual([])
  })

  it('never overrides another area’s translation of the same English key', () => {
    const dir = path.join(ROOT, 'src/i18n/zh-TW')
    const others = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'perf.ts' && !/^(parts|messages)-/.test(f))
    const clashes: string[] = []
    for (const f of others) {
      const src = readFileSync(path.join(dir, f), 'utf8')
      for (const k of Object.keys(perfDict)) {
        const quoted = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (new RegExp(`^\\s*(['"])${quoted}\\1\\s*:`, 'm').test(src) || new RegExp(`^\\s*${quoted}\\s*:`, 'm').test(src)) {
          clashes.push(`${k} (${f})`)
        }
      }
    }
    expect(clashes).toEqual([])
  })

  it('is Taiwan-usage Chinese: no mainland terms, full-width punctuation, no English words', () => {
    for (const [k, zh] of Object.entries(perfDict)) {
      for (const term of MAINLAND_TERMS) expect(zh.includes(term), `${k}: ${term}`).toBe(false)
      expect(halfWidthPunctuation(zh), k).toEqual([])
      // technical tokens stay (MIPS, WebGL, JavaScript, CPU, JS, 3D) — no English prose
      expect(englishLeft(zh.replace(/\{\w+\}/g, ' ')).filter((w) => !['MIPS', 'WebGL', 'JavaScript'].includes(w)), k).toEqual([])
    }
  })
})
