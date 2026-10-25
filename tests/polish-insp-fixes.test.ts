/**
 * Release polish, inspector + scene (polish-insp — closeout-result.json,
 * the close-ui / docs / close-sim contract requests):
 *
 *  - WIRE-NET      the wire inspector's 網路 card: the reading sits under its
 *                  「電壓」 label over the card's whole width and wraps only
 *                  between its parts (「PWM 1.000 kHz ·」 / 「72.5 %（平均 2.25 V）」)
 *                  — never cut at the panel's edge; a held net's history on
 *                  a line of its own; one member of 「接在這裡的」 stays whole
 *  - HALTED-ROWS   使用中的腳位 while the core is halted: 「目前 低（105 mV）」 in
 *                  the value slot, 「核心停住前：…」 on a line of its own (the
 *                  part inspector's 腳位 rows do the same while paused)
 *  - RX-ADAPTER    the RX pin the UART terminal's USB-TTL adapter drives says
 *                  so (McuFrameInfo.uartRx[].attached)
 *  - CHIP-CAMERA   a camera move that is not a pointer move (selection-follow
 *                  pan, F / frame tween, a reduced-motion jump, a view-inset or
 *                  canvas size change) hides the hover chip + ring, and a mouse
 *                  resting on the canvas re-aims once the camera lands
 *  - docs          the user guide names the generator's scope button
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import { getEntry } from '../src/model/catalog'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import type { LogicCapture, LogicTrace, UartRxInfo } from '../src/sim/coordinator/api'
import { parseProject } from '../src/state/project'
import { __resetHistoryForTests, useStore } from '../src/state/store'
import { BreadboardScene } from '../src/three/scene'
import { makeHoleLabel, makeHoverRing, makeScreenChip } from '../src/three/internal/hole-fx'
import { useLab } from '../src/ui/embedded/lab'
import { __resetNetActivityForTests, getNetLive, ingestCapture, netLiveText, netLiveTitle, resolveNet } from '../src/ui/embedded/instruments/net-activity'
import { PinoutGroup, WrapParts, adapterRxPins, heldParts } from '../src/ui/embedded/PartInfo'
import { __resetProblemsForTests, useInspectorFocus, useProblems } from '../src/ui/embedded/problems'
import { PropertiesBody } from '../src/ui/sheets/PropertiesSheet'
import { Line } from './instruments/synth'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const example = (id: string): CircuitLayout => {
  const res = parseProject(read(`examples/embedded/${id}.ohmlet.json`))
  if (!res.ok) throw new Error(res.errors.join('; '))
  return res.project.layout
}

/** A server render against the stores' live state (zustand's server snapshot is the initial state). */
function renderLive(el: ReturnType<typeof createElement>): string {
  const stores = [useStore, useLab, useProblems, useInspectorFocus] as unknown as { getState: () => object; getInitialState: () => object }[]
  const saved = stores.map((s) => {
    const init = s.getInitialState() as Record<string, unknown>
    const before = { ...init }
    Object.assign(init, s.getState())
    return [init, before] as const
  })
  try {
    return renderToStaticMarkup(el)
  } finally {
    for (const [init, before] of saved) {
      for (const k of Object.keys(init)) if (!(k in before)) delete init[k]
      Object.assign(init, before)
    }
  }
}

/** The text a person reads (tags stripped, entities decoded). */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')

/** The markup of the element with class `cls` that opens at the first match (up to its own closing tag, one level of nesting). */
function spanOf(html: string, cls: string): string | null {
  const open = new RegExp(`<span class="${cls}[^"]*"[^>]*>`).exec(html)
  if (!open) return null
  let depth = 1
  let i = open.index + open[0].length
  const tag = /<(\/?)span\b[^>]*>/g
  tag.lastIndex = i
  let m: RegExpExecArray | null
  while ((m = tag.exec(html))) {
    depth += m[1] ? -1 : 1
    if (depth === 0) return html.slice(open.index, m.index + m[0].length)
    i = tag.lastIndex
  }
  return null
}

/** A PWM from t0 to t1: rising every 1/f, high for duty/f. */
function pwm(f: number, duty: number, t0: number, t1: number, index = 0): LogicTrace {
  const l = new Line(0)
  for (let k = 0; t0 + k / f < t1; k++) {
    l.set(t0 + k / f, 1)
    l.set(t0 + (k + duty) / f, 0)
  }
  return l.trace(index)
}

function telemetry(time: number, volts: Record<string, number>, components: SimTelemetry['components'] = {}): SimTelemetry {
  return { time, netVoltages: volts, components, issues: [] }
}

/** What WrapParts renders for `text`: each part of 「a · b」 whole, a break only between them. */
const fitParts = (text: string) =>
  text
    .split(' · ')
    .map((p, k, all) => `<span class="insp-part-fit">${k < all.length - 1 ? `${p} ·` : p}</span>`)
    .join(' ')

beforeEach(() => {
  __setLangForTests('zh-TW')
  __resetNetActivityForTests()
  __resetProblemsForTests()
  useStore.getState().resetSim()
  __resetHistoryForTests()
  useLab.setState({ logicChannels: [], mcus: {} })
})
afterEach(() => {
  __setLangForTests('zh-TW')
  __resetNetActivityForTests()
  useStore.setState({ selection: [], running: false, simTime: 0, telemetry: null })
  useLab.setState({ logicChannels: [], mcus: {} })
})

// ---------------------------------------------------------------------------
// the shared pieces (PartInfo)
// ---------------------------------------------------------------------------

describe('WrapParts / heldParts / adapterRxPins', () => {
  it('WrapParts: a break only between the 「 · 」 parts; the default keeps the pin rows’ no-wrap markup', () => {
    const plain = renderToStaticMarkup(createElement(WrapParts, { text: '方波 100 Hz · 0–5.00 V' }))
    expect(plain).toBe('<span style="white-space:nowrap">方波 100 Hz ·</span> <span style="white-space:nowrap">0–5.00 V</span>')
    const fit = renderToStaticMarkup(createElement(WrapParts, { text: 'PWM 1.000 kHz · 72.5 %（平均 2.25 V）', fit: true }))
    expect(fit).toBe('<span class="insp-part-fit">PWM 1.000 kHz ·</span> <span class="insp-part-fit">72.5 %（平均 2.25 V）</span>')
    // one part: the text itself, no wrapper
    expect(renderToStaticMarkup(createElement(WrapParts, { text: '3.30 V', fit: true }))).toBe('3.30 V')
    // the CSS behind 「fit」: an inline block that stays whole, wrapping inside itself only when wider than the line
    const css = read('src/ui/embedded/inspector.css')
    expect(css).toMatch(/\.insp-part-fit \{\s*display: inline-block;\s*max-width: 100%;/)
  })

  it('heldParts: the level now and its history, from the helper’s own words (paused and halted, zh-TW and English)', () => {
    const paused = { kind: 'pwm', f: 0.998, duty: 0.5, vavg: null, source: 'gpio', held: { why: 'paused', v: 3.3 } } as const
    const halted = { kind: 'toggling', edges: 9, v: 0.105, source: 'gpio', held: { why: 'halted', v: 0.105 } } as const
    expect(heldParts(paused, netLiveText(paused))).toEqual({ now: '目前 高（3.30 V）', before: '暫停前：週期訊號 0.998 Hz · 50.0 %' })
    expect(heldParts(halted, netLiveText(halted))).toEqual({ now: '目前 低（105 mV）', before: '核心停住前：有訊號變化（非週期）' })
    expect(heldParts(halted, netLiveText(halted, { form: 'compact' }))?.now).toBe('目前 低（105 mV）')
    __setLangForTests('en')
    const en = heldParts(halted, netLiveText(halted))
    expect(en?.now).toMatch(/^Now low \(105 mV\)$/)
    expect(en?.before).toMatch(/^before the core halted: /)
    __setLangForTests('zh-TW')
    // anything that is not a held moving net keeps its one statement
    expect(heldParts({ kind: 'pwm', f: 1000, duty: 0.5, vavg: 1.6, source: 'timer' }, 'PWM 1.000 kHz · 50.0 %')).toBeNull()
    expect(heldParts({ kind: 'source', id: 'FG1', waveform: 'square', f: 100, lo: 0, hi: 5 }, '方波 100 Hz · 0–5.00 V')).toBeNull()
    expect(heldParts({ kind: 'dc', v: 3.3 }, '3.30 V')).toBeNull()
    expect(heldParts(null, '—')).toBeNull()
  })

  it('adapterRxPins: the RX pins the terminal’s adapter is plugged into, as one string (a selector re-renders on change only)', () => {
    const rx = (attached: boolean[]): UartRxInfo[] =>
      ['PA10', 'PA3', 'PB11'].map((pin, i) => ({ port: `USART${i + 1}`, pin, state: 'free', attached: attached[i], queued: 0 }))
    expect(adapterRxPins(undefined)).toBe('')
    expect(adapterRxPins(rx([false, false, false]))).toBe('')
    expect(adapterRxPins(rx([true, false, false]))).toBe('PA10')
    expect(adapterRxPins(rx([true, true, false]))).toBe('PA10\nPA3')
  })
})

// ---------------------------------------------------------------------------
// WIRE-NET — the wire inspector's 網路 card (pwm-fade W7: a19 → e40)
// ---------------------------------------------------------------------------

describe('WIRE-NET: the 網路 card shows its whole reading', () => {
  const LAY = example('pwm-fade')
  const net = resolveNet('a19', LAY)!
  const body = () => renderLive(createElement(PropertiesBody, { desktop: true, onDone: () => {} }))
  const cap: LogicCapture = { t0: 0.5, t1: 1, tNow: 1, overflow: false, traces: [{ ...pwm(1000, 0.725, 0.5, 1), since: 0 }] }
  beforeEach(() => {
    useStore.setState({ layout: LAY, selection: ['W7'], running: true, simTime: 1, telemetry: telemetry(1, { [net]: 3.1 }) })
    useLab.setState({ logicChannels: [{ index: 0, label: 'a19', source: { kind: 'net', ref: 'a19' } }] })
    ingestCapture(cap)
  })

  it('running: 「電壓」 is the label above, the reading wraps between its parts (no trailing slot to run past the edge)', () => {
    const reading = netLiveText(getNetLive({ net }))
    expect(reading).toMatch(/1\.000 kHz · 72\.5 %/)
    const html = body()
    const row = /<div class="lg-row insp-net-members insp-net-reading"[^>]*>([\s\S]*?)<\/div>/.exec(html)
    expect(row, html.slice(0, 600)).not.toBeNull()
    expect(row![1]).toMatch(/^<span class="insp-net-label">電壓<\/span>/)
    expect(spanOf(row![1], 'insp-net-v')).toContain(fitParts(reading))
    // the old ListRow put the reading in a no-shrink trailing slot beside the title: gone
    expect(html).not.toMatch(/lg-row-trailing"><span class="insp-net-v/)
    // running: no note under the reading
    expect(row![1]).not.toContain('insp-net-note')
    expect(row![1]).not.toContain('insp-net-history')
  })

  it('paused: the level now as the reading, what the signal did before under it, then 「已暫停（最後讀數）」', () => {
    expect(netLiveText(getNetLive({ net }))).not.toMatch(/^目前/) // seen running first
    useStore.setState({ running: false })
    const live = getNetLive({ net })
    const reading = netLiveText(live)
    const held = heldParts(live, reading)!
    expect(held.now).toBe('目前 高（3.10 V）')
    expect(held.before).toMatch(/^暫停前：/)
    const html = body()
    const v = spanOf(html, 'insp-net-v')!
    expect(textOf(v)).toBe('目前 高（3.10 V）')
    expect(v).toContain(`title="${netLiveTitle(live)}"`)
    const hist = spanOf(html, 'insp-net-history')!
    expect(hist).toContain(fitParts(held.before))
    expect(textOf(spanOf(html, 'insp-net-note')!)).toBe('已暫停（最後讀數）')
    // the whole statement is on the card, in order
    expect(textOf(html)).toContain(`電壓${held.now}${held.before}已暫停（最後讀數）`)
  })

  it('before any run: 「—」 and how to get a reading', () => {
    __resetNetActivityForTests()
    useStore.getState().resetSim()
    useStore.setState({ layout: LAY, selection: ['W7'], running: false, simTime: 0, telemetry: null })
    const html = body()
    expect(textOf(spanOf(html, 'insp-net-v')!)).toBe('—')
    expect(textOf(spanOf(html, 'insp-net-note')!)).toBe(t('Shown once you press “▶ Run simulation” above'))
  })

  it('「接在這裡的」: line breaks between the members only (「PRB1 探棒」 never splits)', () => {
    const html = body()
    const list = spanOf(html, 'insp-net-list')!
    const members = [...list.matchAll(/<span class="insp-net-member">([^<]*)<\/span>/g)].map((m) => m[1])
    expect(members).toEqual(['U1 PA6（板上 A6）、', 'R1 第 1 腳、', 'PRB1 探棒'])
    expect(textOf(list)).toBe('U1 PA6（板上 A6）、R1 第 1 腳、PRB1 探棒')
    expect(read('src/ui/embedded/inspector.css')).toMatch(/\.insp-net-member \{\s*display: inline-block;\s*max-width: 100%;/)
    // the zh separator 「、」 carries no space: the members sit side by side, a break only between them
    expect(list).toContain('<span class="insp-net-member">U1 PA6（板上 A6）、</span><span class="insp-net-member">R1 第 1 腳、</span>')
  })

  it('the part inspector’s 腳位 rows: a held pin’s history on its own line (R1 第 1 腳 on the PA6 net)', () => {
    expect(netLiveText(getNetLive({ net }))).not.toMatch(/^目前/)
    useStore.setState({
      running: false,
      selection: ['R1'],
      telemetry: telemetry(1, { [net]: 3.1 }, { R1: { current: 9e-3, power: 2.7e-2 } } as never),
    })
    const live = getNetLive({ componentId: 'R1', pin: getEntry('resistor')!.pins[0] })
    const held = heldParts(live, netLiveText(live, { form: 'compact' }))!
    expect(held).not.toBeNull()
    const html = body()
    expect(html).toContain('class="prs-pin has-history"')
    expect(textOf(spanOf(html, 'prs-pin-v')!)).toBe(held.now)
    expect(spanOf(html, 'insp-pin-history prs-pin-history')).toContain(fitParts(held.before))
    // the row's other pin is not held: no history line
    expect(html.match(/insp-pin-history/g)).toHaveLength(1)
    // a narrow panel: ⎍ ∿ wrap to the right of the pin's line, never under its name
    const css = read('src/ui/sheets/PropertiesSheet.css')
    expect(css).toMatch(/\.prs-pin\.has-history \{\s*flex-wrap: wrap;/)
    expect(css).toMatch(/\.prs-pin\.has-history \.insp-pin-acts \{\s*margin-left: auto;/)
    expect(css).toMatch(/\.prs-pin-history \{\s*box-sizing: border-box;\s*flex: 1 0 100%;/)
  })

  it('the classic chrome (English without the workspace) keeps its wire editor exactly', () => {
    __setLangForTests('en')
    const html = body()
    expect(html).not.toContain('insp-net-reading')
    expect(html).not.toContain('insp-net-member')
    expect(html).toContain('<span class="prs-mono">a19</span>')
    expect(html).toContain('<span class="prs-mono">e40</span>')
  })
})

// ---------------------------------------------------------------------------
// HALTED-ROWS + RX-ADAPTER — PartInfo PinoutGroup (U1's 使用中的腳位)
// ---------------------------------------------------------------------------

describe('HALTED-ROWS and RX-ADAPTER: U1’s 使用中的腳位', () => {
  const layout: CircuitLayout = { version: 1, components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }], wires: [] }
  const entry = getEntry('stm32_bluepill')!
  const pa5 = resolveNet('c20', layout)!
  const mcu = (state: string, uartRx?: UartRxInfo[]) => ({ componentId: 'U1', state, uarts: [], ...(uartRx ? { uartRx } : {}) })
  const tele = (pinModes: Record<string, string>) =>
    telemetry(1, { [pa5]: 0.105 }, { U1: { mcu: { state: 'halted', pc: 0, hclkHz: 72e6, cycles: 1, pinModes } } } as never)
  const rows = (variant: 'in-use' | 'full' = 'in-use') =>
    renderLive(
      createElement(PinoutGroup, { comp: layout.components[0], entry, tele: useStore.getState().telemetry!.components.U1, variant }),
    )
  const rowOf = (html: string, pin: string) => {
    const at = html.indexOf(`id="pin-U1-${pin}"`)
    if (at < 0) return null
    const next = html.indexOf('id="pin-U1-', at + 10)
    return html.slice(at, next < 0 ? undefined : next)
  }

  it('halted: 「目前 低（105 mV）」 beside the name, 「核心停住前：…」 on a line of its own, the whole statement as the title', () => {
    useStore.setState({ layout, selection: ['U1'], running: true, simTime: 1, telemetry: tele({ PA5: 'out' }) })
    useLab.setState({ logicChannels: [{ index: 0, label: 'PA5', source: { kind: 'net', ref: 'c20' } }] })
    ingestCapture({ t0: 0.5, t1: 1, tNow: 1, overflow: false, traces: [{ ...pwm(1000, 0.5, 0.5, 1), since: 0 }] })
    expect(netLiveText(getNetLive({ componentId: 'U1', pin: 'PA5' }))).not.toMatch(/^目前/)
    // the debugger halts the core: the whole world stops with it
    useStore.setState({ running: false })
    useLab.setState({ mcus: { U1: mcu('halted') } as never })
    const live = getNetLive({ componentId: 'U1', pin: 'PA5' })
    const full = netLiveText(live)
    expect(full).toBe('目前 低（105 mV） · 核心停住前：週期訊號 1.000 kHz · 50.0 %')
    const row = rowOf(rows(), 'PA5')!
    expect(row).not.toBeNull()
    const v = /<span class="emb-pin-v lg-tabular is-signal" title="([^"]*)">([^<]*)</.exec(row)
    expect(v, row.slice(0, 500)).not.toBeNull()
    expect(v![2]).toBe('目前 低（105 mV）')
    expect(v![1]).toBe(`${full} — ${netLiveTitle(live)}`)
    const hist = spanOf(row, 'insp-pin-history')!
    expect(hist).toContain(fitParts('核心停住前：週期訊號 1.000 kHz · 50.0 %'))
    expect(hist).toContain(`title="${full} — ${netLiveTitle(live)}"`)
    // the history line comes right under the name line, before the mode tag and the hole
    expect(row.indexOf('insp-pin-history')).toBeLessThan(row.indexOf('insp-pin-sub'))
    // the CSS: a block line in the secondary label colour, never below 12 px
    expect(read('src/ui/embedded/inspector.css')).toMatch(/\.insp-pin-history \{\s*display: block;\s*font: 400 12px\/16px var\(--lg-font\);\s*color: var\(--label-2\);/)
  })

  it('a row that is not held keeps its one value and no extra line', () => {
    useStore.setState({ layout, selection: ['U1'], running: true, simTime: 1, telemetry: tele({ PA5: 'out' }) })
    const html = rows()
    const row = rowOf(html, 'PA5')!
    expect(row).not.toContain('insp-pin-history')
    expect(html).not.toContain('insp-pin-history')
  })

  it('RX-ADAPTER: after a send, PA10 is in use and says the terminal’s USB-TTL adapter drives it', () => {
    const rx = (attached: boolean): UartRxInfo[] => [
      { port: 'USART1', pin: 'PA10', state: 'free', attached, queued: 0 },
      { port: 'USART2', pin: 'PA3', state: 'free', attached: false, queued: 0 },
    ]
    useStore.setState({ layout, selection: ['U1'], running: true, simTime: 1, telemetry: tele({ PA10: 'in↑' }) })
    // nothing sent yet: an unwired input pin is not 「in use」
    useLab.setState({ mcus: { U1: mcu('running', rx(false)) } as never })
    expect(rowOf(rows(), 'PA10')).toBeNull()
    expect(rowOf(rows('full'), 'PA10')).not.toContain('is-adapter')
    // the terminal sent: the adapter idles PA10 at 3.3 V
    useLab.setState({ mcus: { U1: mcu('running', rx(true)) } as never })
    const row = rowOf(rows(), 'PA10')!
    expect(row).not.toBeNull()
    expect(textOf(spanOf(row, 'insp-pin-history is-adapter')!)).toBe('由 UART 終端機的 USB 轉 TTL 轉接器驅動（3.3 V）')
    expect(rowOf(rows(), 'PA3')).toBeNull()
    // the same in the full pinout
    expect(rowOf(rows('full'), 'PA10')).toContain('由 UART 終端機的 USB 轉 TTL 轉接器驅動（3.3 V）')
    __setLangForTests('en')
    expect(textOf(rowOf(rows(), 'PA10')!)).toContain('Driven by the UART terminal’s USB-TTL adapter (3.3 V)')
  })

  it('the adapter set is read through a string selector (no re-render per frame)', () => {
    const src = read('src/ui/embedded/PartInfo.tsx')
    expect(src).toContain('const adapterKey = useLab((s) => adapterRxPins(s.mcus[comp.id]?.uartRx))')
  })
})

// ---------------------------------------------------------------------------
// CHIP-CAMERA — src/three/scene.ts
// ---------------------------------------------------------------------------

interface CamInternals {
  m: unknown
  dockedChrome: boolean | null
  chipKey: string
  chipLive: { kind: 'hole' | 'terminal'; ref: string } | null
  chipAfterCamera: boolean
  pointerInside: boolean
  pointerDirty: boolean
  lastPointerType: string
  labelPinnedUntil: number
  camTween: { t0: number } | null
  wireEndDrag: unknown
  activeTouchId: number | null
  flyCamera(m: unknown, pos: THREE.Vector3, tgt: THREE.Vector3): void
  updateCamTween(m: unknown): void
}

/** A headless scene whose hover chip shows c19's text, with a camera at (0, 20, 20) looking at the origin. */
function sceneWithChip(docked = true) {
  const scene = new BreadboardScene()
  const s = scene as unknown as CamInternals
  const chip = makeScreenChip()
  const ring = makeHoverRing()
  const camera = new THREE.PerspectiveCamera(45, 1.6, 0.1, 1000)
  camera.position.set(0, 20, 20)
  const target = new THREE.Vector3()
  camera.lookAt(target)
  const m = {
    container: { style: { cursor: '' }, clientWidth: 1440, clientHeight: 900 },
    camera,
    controls: { target, update: () => {} },
    renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }) } },
    holeLabel: makeHoleLabel(),
    screenChip: chip,
    hoverRing: ring,
    clock: new THREE.Clock(),
  }
  s.m = m
  s.dockedChrome = docked
  chip.show()
  ring.show(0)
  s.chipKey = 'h:c19:0:0'
  s.chipLive = { kind: 'hole', ref: 'c19' }
  return { s, m, chip, ring }
}

describe('CHIP-CAMERA: the hover chip and a camera move that is not a pointer move', () => {
  let reduced = false
  beforeEach(() => {
    reduced = false
    vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) })
  })
  afterEach(() => vi.unstubAllGlobals())
  const away = () => [new THREE.Vector3(6, 20, 20), new THREE.Vector3(6, 0, 0)] as const

  it('a glide (selection-follow pan, F, a focus): the chip and ring go at once; the resting mouse re-aims when it lands', () => {
    const { s, m, chip, ring } = sceneWithChip()
    s.pointerInside = true
    s.lastPointerType = 'mouse'
    s.pointerDirty = true // select() had asked for a pass: it must not re-show the chip on the first tween frame
    s.labelPinnedUntil = performance.now() + 1000
    s.flyCamera(m, ...away())
    expect(s.camTween).not.toBeNull()
    expect(chip.visible).toBe(false)
    ring.tick(10)
    expect(ring.object.visible).toBe(false)
    expect(s.chipKey).toBe('')
    expect(s.chipLive).toBeNull()
    expect(s.labelPinnedUntil).toBe(0)
    expect(s.pointerDirty).toBe(false)
    // mid-glide: still nothing to re-aim
    s.updateCamTween(m)
    expect(s.camTween).not.toBeNull()
    expect(s.pointerDirty).toBe(false)
    // the camera lands: ONE hover pass on the next frame (pointerDirty — the event-driven gate, never per frame)
    s.camTween!.t0 = performance.now() - 1000
    s.updateCamTween(m)
    expect(s.camTween).toBeNull()
    expect(s.pointerDirty).toBe(true)
    expect(s.chipAfterCamera).toBe(false)
    // …and the next landing without a hidden chip asks nothing more
    s.pointerDirty = false
    s.updateCamTween(m)
    expect(s.pointerDirty).toBe(false)
  })

  it('a reduced-motion jump: hidden and re-aimed in the same call', () => {
    reduced = true
    const { s, m, chip } = sceneWithChip()
    s.pointerInside = true
    s.lastPointerType = 'mouse'
    s.flyCamera(m, ...away())
    expect(s.camTween).toBeNull()
    expect(chip.visible).toBe(false)
    expect(s.pointerDirty).toBe(true)
  })

  it('a finger rests nowhere: the chip goes and stays gone until the next touch', () => {
    const { s, m, chip } = sceneWithChip()
    s.pointerInside = false
    s.lastPointerType = 'touch'
    s.chipKey = '!pin'
    s.flyCamera(m, ...away())
    expect(chip.visible).toBe(false)
    s.camTween!.t0 = performance.now() - 1000
    s.updateCamTween(m)
    expect(s.pointerDirty).toBe(false)
    expect(chip.visible).toBe(false)
  })

  it('a fly to where the camera already is (F on a framed circuit) moves nothing: the chip stays', () => {
    const { s, m, chip } = sceneWithChip()
    s.pointerInside = true
    s.lastPointerType = 'mouse'
    const cam = (m as { camera: THREE.PerspectiveCamera }).camera
    s.flyCamera(m, cam.position.clone(), new THREE.Vector3())
    expect(chip.visible).toBe(true)
    expect(s.chipKey).toBe('h:c19:0:0')
  })

  it('the classic chrome keeps its chip as before; an editing drag or a finger aiming keeps its own', () => {
    const a = sceneWithChip(false)
    a.s.pointerInside = true
    a.s.lastPointerType = 'mouse'
    a.s.flyCamera(a.m, ...away())
    expect(a.chip.visible).toBe(true)
    expect(a.s.chipKey).toBe('h:c19:0:0')
    a.s.camTween!.t0 = performance.now() - 1000
    a.s.pointerDirty = false
    a.s.updateCamTween(a.m)
    expect(a.s.pointerDirty).toBe(false)
    const b = sceneWithChip()
    b.s.wireEndDrag = { armed: true, started: true }
    b.s.flyCamera(b.m, ...away())
    expect(b.chip.visible).toBe(true)
    const c = sceneWithChip()
    c.s.activeTouchId = 7
    c.s.flyCamera(c.m, ...away())
    expect(c.chip.visible).toBe(true)
  })

  it('wired into the camera-change paths only — flyCamera, the tween’s landing, setViewInsets, handleResize — never the frame loop', () => {
    const src = read('src/three/scene.ts')
    const body = (sig: string) => {
      const at = src.indexOf(sig)
      expect(at, sig).toBeGreaterThan(0)
      return src.slice(at, src.indexOf('\n  }\n', at))
    }
    expect(body('  private flyCamera(m: Mounted')).toContain('this.hideChipForCameraMove(m)')
    expect(body('  private updateCamTween(m: Mounted')).toContain('this.rearmChipAfterCamera()')
    for (const sig of ['  setViewInsets(insets: ViewInsets): void {', '  private handleResize(): void {']) {
      const b = body(sig)
      expect(b).toContain('this.hideChipForCameraMove(m)')
      expect(b).toContain('if (!this.camTween) this.rearmChipAfterCamera()')
    }
    // followSelection / reframeCamera / frameTargets all glide through flyCamera
    expect(body('  private followSelection(m: Mounted)')).toMatch(/this\.flyCamera\(|this\.flyToBox\(/)
    expect(body('  private flyToBox(')).toContain('this.flyCamera(m, f.pos, f.tgt)')
    expect(body('  private reframeCamera(): void {')).toContain('this.flyCamera(')
    // the frame loop never hides / re-arms (it only follows the anchor of a chip that shows)
    const tick = src.slice(src.indexOf('    const animate = () => {'), src.indexOf('    const animate = () => {') + 4000)
    expect(tick).not.toContain('hideChipForCameraMove')
    expect(tick).not.toContain('rearmChipAfterCamera')
  })
})

// ---------------------------------------------------------------------------
// docs — the generator's 即時讀數 names its scope button
// ---------------------------------------------------------------------------

describe('docs: the user guide says what the inspector offers', () => {
  const section = (n: number) => {
    const guide = read('docs/user-guide.md')
    const start = guide.indexOf(`\n## ${n}. `)
    const end = guide.indexOf('\n## ', start + 1)
    return guide.slice(start, end < 0 ? undefined : end)
  }
  it('§8: a function generator’s 即時讀數 says 交流 and offers 在示波器中檢視 (or the probe that brings it)', () => {
    const show = t('Show in the oscilloscope (CH{n})', { n: 1 })
    const place = t('Place a scope probe (CH{n})', { n: 1 })
    expect(show).toBe('在示波器中檢視（CH1）')
    expect(place).toBe('放示波器探棒（CH1）')
    const s8 = section(8)
    expect(s8).toContain('交流（瞬時值會跳動）——請用示波器看')
    expect(s8).toContain(`「${show}」`)
    expect(s8).toContain(`「${place}」`)
  })
  it('§5: tapping the capsule while 「U1 故障（鎖死）——查看原因 ›」 shows opens the 執行狀態 card', () => {
    const s5 = section(5)
    expect(s5).toContain(`「${t('{id} fault (lockup) — see why', { id: 'U1' })} ›」`)
    expect(s5).toMatch(/這一行顯示時點膠囊，會打開開發板的「概況」分頁並捲到「執行狀態」卡片/)
  })
})
