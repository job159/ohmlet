/**
 * Release QA, instruments area — the names and promises of the shipped
 * examples (IS-F1, IS-F2):
 *  - one designator table (store.ts ID_PREFIX): every example part of a type
 *    with an entry is named with that prefix, so a part placed from the
 *    library gets the name the examples and lessons use (數位萬用電表 → DMM1);
 *  - the blink example names its LED LED1 and its 試試看 promises what the
 *    simulator does: R1 = 33 Ω → about 18 mA through LED1, R1 replaced by a
 *    wire → the problem 「LED1 沒有限流電阻」;
 *  - every other 試試看 that promises an ERC finding gets it (adc-pot: 5 V
 *    on PA0; ws2812-strip: PS1 at 5 V → DIN logic level).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CircuitLayout } from '../src/model/types'
import { getEntry } from '../src/model/catalog'
import { loadFirmwareFile } from '../src/mcu/loader'
import '../src/mcu/all'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { runErc } from '../src/sim/erc'
import { parseProject, type ParsedProject } from '../src/state/project'
import { ID_PREFIX, __resetHistoryForTests, useStore } from '../src/state/store'
import { __setLangForTests } from '../src/i18n'
import { tMessage } from '../src/i18n/messages'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'examples/embedded')

function project(id: string): ParsedProject {
  const res = parseProject(readFileSync(join(DIR, `${id}.ohmlet.json`), 'utf8'))
  if (!res.ok) throw new Error(`${id}: ${res.errors.join('; ')}`)
  return res.project
}

const exampleIds = readdirSync(DIR)
  .filter((f) => f.endsWith('.ohmlet.json'))
  .map((f) => f.slice(0, -'.ohmlet.json'.length))
  .sort()

describe('IS-F1 one designator table', () => {
  it('every example part of a type with an entry starts with ID_PREFIX[type]', () => {
    const bad: string[] = []
    let checked = 0
    for (const id of exampleIds) {
      for (const c of project(id).layout.components) {
        const prefix = ID_PREFIX[c.type]
        if (!prefix) continue
        checked++
        // the prefix and then the number (OLED, not O + LED1; RF / RG are resistors R…)
        if (!c.id.startsWith(prefix)) bad.push(`${id}: ${c.id} (${c.type}) should start with ${prefix}`)
      }
    }
    expect(bad).toEqual([])
    expect(checked).toBeGreaterThan(100)
  })

  it('every embedded catalog type the examples place has its own entry (no X fallback)', () => {
    const missing = new Set<string>()
    for (const id of exampleIds) {
      for (const c of project(id).layout.components) {
        const entry = getEntry(c.type)
        // ICs and boards fall back to U (U1 = the Blue Pill, U2 = the EEPROM) — like a schematic
        if (entry?.category === 'ic' || entry?.category === 'mcu') continue
        if (!ID_PREFIX[c.type]) missing.add(c.type)
      }
    }
    expect([...missing]).toEqual([])
  })

  it('classic designators are unchanged', () => {
    expect(ID_PREFIX).toMatchObject({ led: 'LED', resistor: 'R', scope_probe: 'PRB', pushbutton: 'SW', power_supply: 'PS', function_generator: 'FG' })
  })

  describe('a part from the library gets the name the lessons use', () => {
    beforeEach(() => {
      __resetHistoryForTests()
      useStore.setState({ layout: { version: 1, components: [], wires: [] }, selection: [] })
    })
    afterEach(() => useStore.setState({ layout: { version: 1, components: [], wires: [] }, selection: [] }))

    it.each([
      ['multimeter', 'DMM1', {}],
      ['logic_probe', 'LP1', { holes: ['a10'] }],
      ['usb_uart_ch340', 'CH1', { at: 'a35' }],
      ['battery_9v', 'BAT1', {}],
      ['dc_motor', 'M1', {}],
      ['l298n_module', 'DRV1', {}],
    ] as const)('%s → %s', (type, want, opts) => {
      const before = useStore.getState().layout.components.length
      useStore.getState().addComponent(type, { ...opts } as Parameters<ReturnType<typeof useStore.getState>['addComponent']>[1])
      const comps = useStore.getState().layout.components
      expect(comps.length).toBe(before + 1)
      expect(comps[comps.length - 1].id).toBe(want)
    })
  })

  it('the shipped examples name LEDs LED<n> and scope probes PRB<n>', () => {
    for (const id of exampleIds) {
      for (const c of project(id).layout.components) {
        if (c.type === 'led') expect(c.id, id).toMatch(/^LED\d+$/)
        if (c.type === 'scope_probe') expect(c.id, id).toMatch(/^PRB\d+$/)
      }
    }
    expect(project('blink').layout.components.map((c) => c.id)).toContain('LED1')
    expect(project('pwm-fade').layout.components.map((c) => c.id)).toEqual(expect.arrayContaining(['LED1', 'PRB1']))
    expect(project('rc-lowpass').layout.components.map((c) => c.id)).toEqual(expect.arrayContaining(['PRB1', 'PRB2']))
  })
})

// ---------------------------------------------------------------------------
// IS-F2: the 試試看 of the examples promise what the simulator does
// ---------------------------------------------------------------------------

function withParam(layout: CircuitLayout, id: string, key: string, value: number): CircuitLayout {
  return { ...layout, components: layout.components.map((c) => (c.id === id ? { ...c, params: { ...c.params, [key]: value } } : c)) }
}

/** Run `layout` with the example's firmware; the LED's largest current over [0.2 s, `seconds`]. */
function peakCurrent(p: ParsedProject, layout: CircuitLayout, led: string, seconds: number): number {
  const co = new SimulationCoordinator()
  co.load(layout, 1)
  for (const fw of p.firmware) {
    const img = loadFirmwareFile(fw.name, fw.bytes)
    if (!img.ok) throw new Error(`${fw.name}: ${img.error}`)
    co.setFirmware(fw.componentId, img.image)
  }
  let peak = 0
  while (co.time < seconds) {
    co.advance(0.01)
    if (co.time < 0.2) continue
    const i = co.frame().telemetry.components[led]?.current
    if (typeof i === 'number' && Number.isFinite(i)) peak = Math.max(peak, Math.abs(i))
  }
  return peak
}

describe('IS-F2 blink: the 試試看 says what happens', () => {
  beforeEach(() => __setLangForTests('zh-TW'))

  it('the text names LED1 and the outcomes the simulator gives (no ERC promise for 33 Ω)', () => {
    const idx = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) as { examples?: { id: string; description: string }[] } | { id: string; description: string }[]
    const list = Array.isArray(idx) ? idx : idx.examples ?? []
    const blink = list.find((e) => e.id === 'blink')
    expect(blink?.description).toContain('把 R1 改成 33 Ω 後點 LED1，電流會升到約 18 mA')
    expect(blink?.description).toContain('問題面板就會出現「LED1 沒有限流電阻」')
    expect(blink?.description).not.toMatch(/ERC 會警告 LED 電流過大/)
    expect(blink?.description).not.toMatch(/\bD1\b/)
  })

  it('R1 = 33 Ω: about 18 mA through LED1 while PA5 is high (15–20 mA)', { timeout: 120_000 }, () => {
    const p = project('blink')
    const i = peakCurrent(p, withParam(p.layout, 'R1', 'resistance', 33), 'LED1', 1.2)
    expect(i).toBeGreaterThan(0.015)
    expect(i).toBeLessThan(0.02)
    // and no finding promises more: 18 mA is within the red LED's rating
    expect(runErc(withParam(p.layout, 'R1', 'resistance', 33)).filter((f) => f.rule === 'led-current')).toEqual([])
    // the shipped 330 Ω: a few mA
    expect(peakCurrent(p, p.layout, 'LED1', 1.2)).toBeLessThan(0.006)
  })

  it('R1 replaced by a wire: the problem 「LED1 沒有限流電阻」', () => {
    const p = project('blink')
    const r1 = p.layout.components.find((c) => c.id === 'R1')!
    const [a, b] = r1.holes!
    const layout: CircuitLayout = {
      ...p.layout,
      components: p.layout.components.filter((c) => c.id !== 'R1'),
      wires: [...p.layout.wires, { id: 'W9', from: a, to: b, color: 'yellow' }],
    }
    const f = runErc(layout).filter((x) => x.rule === 'led-current' && x.componentIds.includes('LED1'))
    expect(f).toHaveLength(1)
    expect(f[0].short).toBe('LED1 has no series resistor')
    expect(tMessage(f[0].short!)).toBe('LED1 沒有限流電阻')
  })
})

describe('IS-F2 every ERC promise of a 試試看 holds', () => {
  it('adc-pot: the pot’s clockwise end on the 5 V rail, the knob turned to the end → 「U1 PA0 電壓過高」 (error)', { timeout: 120_000 }, () => {
    __setLangForTests('zh-TW')
    const p = project('adc-pot')
    expect(runErc(p.layout).filter((f) => f.level === 'error')).toEqual([])
    const d = readFileSync(join(DIR, 'src/adc-pot.example.mjs'), 'utf8')
    expect(d).toContain('把順時針那一端改接 5 V（下方 + 電源軌），再把旋鈕順時針轉到底，PA0 會被拉到 5 V，問題面板就會出現「U1 PA0 電壓過高」')
    const cw = p.layout.wires.find((w) => w.from === 'a42' || w.to === 'a42')!
    const rail = (cw.from === 'a42' ? cw.to : cw.from) as string
    expect(rail).toMatch(/^top\+/)
    const to5 = rail.replace('top+', 'bot+')
    const used = new Set(p.layout.wires.flatMap((w) => [w.from, w.to]))
    expect(used.has(to5)).toBe(false)
    const layout = withParam(
      { ...p.layout, wires: p.layout.wires.map((w) => (w === cw ? { ...w, from: 'a42', to: to5 } : w)) },
      'RV1',
      'position',
      1,
    )
    // the live check (the problems panel runs the ERC with the running circuit's telemetry)
    const co = new SimulationCoordinator()
    co.load(layout, 1)
    for (const fw of p.firmware) {
      const img = loadFirmwareFile(fw.name, fw.bytes)
      if (img.ok) co.setFirmware(fw.componentId, img.image)
    }
    co.advance(0.3)
    const f = runErc(layout, { telemetry: co.frame().telemetry, issues: co.issues() }).filter(
      (x) => x.rule === 'gpio-overvoltage' && x.level === 'error',
    )
    expect(f).toHaveLength(1)
    expect(tMessage(f[0].short!)).toBe('U1 PA0 電壓過高')
    expect(f[0].message).toMatch(/PA0/)
  })

  it('ws2812-strip: PS1 at 5 V → the logic-level risk on DIN', () => {
    const p = project('ws2812-strip')
    const before = runErc(p.layout).filter((x) => x.rule === 'logic-level' && x.componentIds.includes('LED1'))
    expect(before).toEqual([])
    const f = runErc(withParam(p.layout, 'PS1', 'voltage', 5)).filter((x) => x.rule === 'logic-level' && x.componentIds.includes('LED1'))
    expect(f.length).toBeGreaterThan(0)
    expect(f.some((x) => /DIN/.test(x.message))).toBe(true)
  })

  it('no other 試試看 promises an ERC / problem-panel outcome', () => {
    // the texts that name ERC or the problems panel are exactly the ones tested above
    const src = join(DIR, 'src')
    const promising = readdirSync(src)
      .filter((f) => f.endsWith('.example.mjs'))
      .filter((f) => {
        const s = readFileSync(join(src, f), 'utf8')
        const tryIt = /試試看：([^'\n]*)/.exec(s)?.[1] ?? ''
        return /ERC|問題面板|電氣規則檢查/.test(tryIt)
      })
      .map((f) => f.replace('.example.mjs', ''))
      .sort()
    expect(promising).toEqual(['adc-pot', 'blink', 'ws2812-strip'])
  })
})
