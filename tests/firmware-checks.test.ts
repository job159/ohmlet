/**
 * Firmware contracts: every project in firmware/dist/manifest.json that
 * states machine-checkable `checks` (firmware/README.md, "The expect
 * contract") runs as REAL firmware on the simulated Blue Pill and must pass
 * every rule (src/sim/coordinator/checks.ts). The manifest is iterated at
 * run time, so a project added with checks is verified without editing this
 * file; projects without checks are reported as skipped.
 *
 * Also here:
 *  - the test stimulus (src/sim/coordinator/stimulus.ts) acts on the NET:
 *    exact-time logic resolution, contention against an output, an RC on an
 *    analog net delaying the input like on a bench, persistence across a
 *    rebuild — never through MCU registers;
 *  - the runner rejects wrong behavior (shifted windows, wrong idle level,
 *    wrong pin role, unexpected edges / bytes, wrong firmware, a missing time
 *    origin) with expected-vs-measured messages;
 *  - regressions of simulator bugs the contracts exposed.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadFirmwareFile } from '../src/mcu/loader'
import type { FirmwareImage } from '../src/mcu/firmware'
import '../src/mcu/all'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { McuBoardChip } from '../src/sim/coordinator/mcu-board'
import { StimulusPlan, STIMULUS_ROUT } from '../src/sim/coordinator/stimulus'
import {
  CHECK_BOARD_ID,
  checkBoardTap,
  checksLayout,
  formatReport,
  runChecks,
} from '../src/sim/coordinator/checks'
import type { FirmwareChecks, ManifestEntry } from '../src/sim/coordinator/checks'
import { NET_CONTENTION, NET_DRIVEN } from '../src/sim/digital/nets'
import { PIN_OUT_PP } from '../src/mcu/pins'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '../firmware/dist')
const MANIFEST = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8')) as Record<string, ManifestEntry>

const images = new Map<string, FirmwareImage>()
function image(name: string): FirmwareImage {
  let img = images.get(name)
  if (!img) {
    const res = loadFirmwareFile(`${name}.elf`, new Uint8Array(readFileSync(join(DIST, `${name}.elf`))))
    if (!res.ok) throw new Error(`${name}.elf: ${res.error}`)
    img = res.image
    images.set(name, img)
  }
  return img
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/**
 * The contract of a manifest project: its project.json `checks` (the source
 * the manifest copies on every build — a checks-only correction is verified
 * before the next rebuild republishes it), else the manifest's copy.
 */
function contractOf(name: string): ManifestEntry {
  const entry = MANIFEST[name]
  try {
    const proj = JSON.parse(readFileSync(join(HERE, '../firmware/projects', name, 'project.json'), 'utf8')) as ManifestEntry
    if (proj.checks) return { ...entry, checks: proj.checks }
  } catch {
    /* no project directory: the manifest copy */
  }
  return entry
}

// ------------------------------------------------------------ the contracts

describe('firmware contracts (every firmware/dist/manifest.json project with checks)', () => {
  const names = Object.keys(MANIFEST)
  it('the manifest lists projects with checks', () => {
    expect(names.filter((n) => MANIFEST[n].checks).length).toBeGreaterThanOrEqual(7)
  })
  for (const name of names) {
    // the manifest decides WHICH projects carry a contract (their dist image was built with it)
    const entry = contractOf(name)
    it.skipIf(!MANIFEST[name].checks)(`${name} meets its checks`, { timeout: 900_000 }, () => {
      const rep = runChecks(entry, image(name), { name })
      expect(rep.runs.length).toBeGreaterThan(0)
      expect(rep.failures, formatReport(rep)).toEqual([])
      expect(rep.ok).toBe(true)
      // every scenario ran, plus the free-running baseline
      expect(rep.runs.map((r) => r.name)).toEqual(['baseline', ...(entry.checks?.scenarios ?? []).map((s) => s.name)])
      for (const r of rep.runs) expect(r.outcomes.length, `${r.name} evaluated nothing`).toBeGreaterThan(0)
    })
  }
})

// ---------------------------------------------------------------- stimulus

const BARE = MANIFEST['bare-button'].checks as FirmwareChecks

/** bare-button on a bench without loads (every header net logic-resolvable) unless `circuit` says otherwise. */
function bareWorld(extra?: (layout: ReturnType<typeof checksLayout>['layout']) => void): SimulationCoordinator {
  const bench = checksLayout({ circuit: [] })
  extra?.(bench.layout)
  const co = new SimulationCoordinator()
  co.load(bench.layout, 1)
  co.setFirmware(CHECK_BOARD_ID, image('bare-button'))
  co.setLogicChannels([
    { index: 0, label: 'PA0', source: { kind: 'mcu-pin', componentId: CHECK_BOARD_ID, pin: 'PA0' } },
    { index: 1, label: 'PA5', source: { kind: 'mcu-pin', componentId: CHECK_BOARD_ID, pin: 'PA5' } },
  ])
  return co
}

function edges(co: SimulationCoordinator, label: string): { t: number; l: number }[] {
  const q = co.query({ kind: 'logic', t0: 0, t1: co.time })
  if (q.kind !== 'logic') throw new Error('query')
  const tr = q.capture.traces.find((x) => x.label === label)
  if (!tr) throw new Error(`no trace ${label}`)
  return Array.from(tr.times, (t, i) => ({ t, l: tr.levels[i] }))
}

function pinNode(co: SimulationCoordinator, pin: string): number {
  const nodes = co.engine?.pinNodesOf(CHECK_BOARD_ID)
  const chip = co.engine?.chipOf(CHECK_BOARD_ID) as McuBoardChip
  return nodes ? nodes[chip.entry?.pins.indexOf(pin) ?? -1] : -2
}

describe('test stimulus: an external 50 Ω driver on the net', () => {
  it('resolves on a logic net at the exact virtual time and reaches the MCU only through its input', () => {
    const co = bareWorld()
    co.advance(2e-3)
    const nets = co.logicNets
    if (!nets) throw new Error('no logic layer')
    const node = pinNode(co, 'PA0')
    expect(nets.isLogic(node)).toBe(true)
    expect(nets.voltage(node)).toBeCloseTo(3.3, 1) // internal pull-up only
    const plan = new StimulusPlan(co)
    const tPress = 2.5e-3
    plan.schedule([{ at: tPress, componentId: CHECK_BOARD_ID, pin: 'PA0', level: 0 }])
    co.advance(1e-3)
    expect(plan.applied).toEqual([{ action: expect.objectContaining({ pin: 'PA0', level: 0 }), t: tPress, ok: true }])
    // 50 Ω to VSS against the 40 kΩ pull-up (DS5319 §5.3.13): a divider, not a forced 0
    const vdd = co.engine?.voltageOfNode(pinNode(co, '3V3_1')) ?? NaN
    expect(nets.voltage(node)).toBeCloseTo((vdd * STIMULUS_ROUT) / (STIMULUS_ROUT + 40_000), 4)
    const pa0 = edges(co, 'PA0')
    expect(pa0[pa0.length - 1]).toEqual({ t: tPress, l: 0 }) // the Schmitt input fell at the stimulus instant
    const pa5 = edges(co, 'PA5').filter((e) => e.t > 2e-3)
    expect(pa5.length).toBe(1)
    expect(pa5[0].l).toBe(1)
    expect(pa5[0].t - tPress).toBeGreaterThan(0) // firmware polling latency, not an instantaneous copy
    expect(pa5[0].t - tPress).toBeLessThan(5e-6)
    // released: only the pull-up holds the net again
    expect(co.setStimulus(CHECK_BOARD_ID, 'PA0', 'open')).toBe(true)
    expect(co.stimulusOf(CHECK_BOARD_ID, 'PA0')).toBe('open')
    expect(nets.voltage(node)).toBeCloseTo(vdd, 3)
    co.advance(1e-3)
    expect(edges(co, 'PA5').at(-1)?.l).toBe(0)
  })

  it('fighting a push-pull output is contention (level undefined, issue reported), not an override', () => {
    const co = bareWorld()
    co.advance(2e-3)
    const mcu = co.mcu(CHECK_BOARD_ID)
    const pa5 = mcu?.pins.drive(mcu.pins.pinIndex('PA5'))
    expect(pa5).toEqual({ mode: PIN_OUT_PP, level: 0, af: false })
    expect(co.setStimulus(CHECK_BOARD_ID, 'PA5', 1)).toBe(true)
    co.advance(0.2e-3)
    const nets = co.logicNets
    const node = pinNode(co, 'PA5')
    expect(nets?.state(node)).toBe(NET_CONTENTION)
    expect(co.issues().some((i) => /logic contention: .*PA5/.test(i.message))).toBe(true)
    // the analog solve sees the same two 50 Ω stages: mid-rail and > 25 mA through the MCU driver
    expect(co.engine?.voltageOfNode(node)).toBeCloseTo(1.65, 1)
    expect(co.issues().some((i) => /PA5: driver sinks \d+\.\d mA/.test(i.message))).toBe(true)
    // the firmware still drives PA5 low: its register state is untouched
    expect(mcu?.pins.drive(mcu.pins.pinIndex('PA5')).level).toBe(0)
  })

  it('on an ANALOG net (100 nF to GND) the release follows the RC charge through the 40 kΩ pull-up', () => {
    const co = bareWorld((layout) => {
      layout.wires.push({ id: 'WC', from: checkBoardTap('PA0'), to: 'e45' })
      layout.components.push({ id: 'C1', type: 'capacitor', holes: ['a45', 'top-30'], params: { capacitance: 100e-9 } })
    })
    co.advance(20e-3) // the cap charges through the pull-up first (τ = 4 ms)
    expect(co.logicNets?.isLogic(pinNode(co, 'PA0'))).toBe(false)
    expect(edges(co, 'PA5').filter((e) => e.t > 15e-3)).toEqual([])
    const plan = new StimulusPlan(co)
    plan.schedule([
      { at: 21e-3, componentId: CHECK_BOARD_ID, pin: 'PA0', level: 0 },
      { at: 31e-3, componentId: CHECK_BOARD_ID, pin: 'PA0', level: 'open' },
    ])
    co.advance(20e-3)
    const pa5 = edges(co, 'PA5').filter((e) => e.t > 20e-3)
    expect(pa5.map((e) => e.l)).toEqual([1, 0])
    // press: 50 Ω × 100 nF = 5 µs discharges below VIL; seen at the next analog solve (≤ one 50 µs step)
    expect(pa5[0].t - 21e-3).toBeGreaterThan(0)
    expect(pa5[0].t - 21e-3).toBeLessThan(60e-6)
    // release: 40 kΩ × 100 nF = 4 ms; VIH(3.3 V) = 0.41·1.3 + 1.3 = 1.833 V (DS5319 §5.3.13)
    // is crossed at τ·ln(3.3 / (3.3 − 1.833)) ≈ 3.24 ms
    const tRelease = pa5[1].t - 31e-3
    expect(tRelease).toBeGreaterThan(3.0e-3)
    expect(tRelease).toBeLessThan(3.5e-3)
  })

  it('stays wired across a rebuild (load) and reports unknown pins', () => {
    const co = bareWorld()
    co.advance(2e-3)
    expect(co.setStimulus(CHECK_BOARD_ID, 'PA0', 0)).toBe(true)
    co.advance(0.1e-3)
    const bench = checksLayout({ circuit: [] })
    co.load(bench.layout, 2) // hot rewire: same firmware, MCU keeps running
    co.advance(0.5e-3)
    expect(co.stimulusOf(CHECK_BOARD_ID, 'PA0')).toBe(0)
    const nets = co.logicNets
    expect(nets?.state(pinNode(co, 'PA0'))).toBe(NET_DRIVEN)
    expect(nets?.voltage(pinNode(co, 'PA0'))).toBeLessThan(0.1)
    expect(edges(co, 'PA5').at(-1)?.l).toBe(1)
    expect(co.setStimulus(CHECK_BOARD_ID, 'PZ9', 0)).toBe(false)
    expect(co.setStimulus('nope', 'PA0', 0)).toBe(false)
  })
})

// -------------------------------------------------------- the runner itself

describe('contract runner rejects wrong behavior', () => {
  /** failures of `checks` run on firmware `img`; with `scenarios`, only those (no baseline) */
  const fails = (checks: FirmwareChecks, img = 'bare-button', scenarios?: string[]): string[] =>
    runChecks({ checks }, image(img), { name: 'mutated', scenarios, skipBaseline: scenarios !== undefined }).failures

  it('a shifted edge window fails with the measured edge time', () => {
    const c = clone(BARE)
    const sc = c.scenarios?.[0]
    if (!sc?.expect) throw new Error('fixture')
    sc.expect[0].at = [2, 2.005]
    const f = fails(c, 'bare-button', [sc.name])
    expect(f.join('\n')).toMatch(/PA5 rising edge expected within 2\.000 ms–2\.005 ms; nearest rising edge at 1\.00\d ms/)
    // …and the edge it would have matched is now unexpected
    expect(f.join('\n')).toMatch(/quiet PA5: 1 unexpected edge\(s\) on PA5: ↑ 1\.00\d ms/)
  })

  it('a wrong idle level, pin role and clock fail in the baseline', () => {
    const c = clone(BARE)
    c.idle = { ...c.idle, PA5: 1 }
    c.pins = { ...c.pins, PA0: 'input-pulldown' }
    c.hclkHz = 72_000_000
    c.scenarios = []
    const f = fails(c).join('\n')
    expect(f).toMatch(/baseline: idle PA5: expected 1 from settle \(0\.000 ms\), measured 0/)
    expect(f).toMatch(/baseline: pins PA0: expected input-pulldown, measured input-pullup at settle/)
    expect(f).toMatch(/baseline: hclkHz: expected 72000000 Hz, measured 8000000 Hz/)
  })

  it('a relation that does not hold is reported with the violating interval', () => {
    const c = clone(BARE)
    c.signals = [{ pin: 'PA5', sameAs: 'PA0', skewUs: 5, always: true }]
    const f = fails(c, 'bare-button', ['press and release are mirrored']).join('\n')
    expect(f).toMatch(/PA5 = PA0: \d+ violation\(s\) .*PA5=0 while PA0=1 from 0\.000 ms/)
  })

  it('the wrong firmware fails its neighbour\'s contract', () => {
    // bare-blink toggles PA5/PC13 and never configures PA0
    const f = fails(BARE, 'bare-blink').join('\n')
    expect(f).toMatch(/baseline: pins PA0: expected input-pullup, measured input-floating/)
    expect(f).toMatch(/baseline: idle PA5: expected 0 from settle/)
    expect(f).toMatch(/press and release are mirrored: expect\[0\] PA5 ↑/)
  })

  it('UART: a wrong boot text, a missing echo and unexpected bytes are reported', () => {
    const scName = 'CR-terminated line'
    const c1 = clone(MANIFEST['hal-uart-hello'].checks as FirmwareChecks)
    c1.boot = { USART1: 'Hello from STM32F104!\r\n' }
    expect(fails(c1, 'hal-uart-hello', [scName]).join('\n')).toMatch(
      /boot USART1: expected the first bytes "Hello from STM32F104!\\r\\n", got "Hello from STM32F103!\\r\\n"/,
    )
    const c = clone(MANIFEST['hal-uart-hello'].checks as FirmwareChecks)
    const sc = c.scenarios?.find((s) => s.name === scName)
    if (!sc?.expect) throw new Error('fixture')
    sc.expect[0].uart = 'echo: abd\r\n'
    const f = fails(c, 'hal-uart-hello', [scName]).join('\n')
    expect(f).not.toMatch(/boot USART1/)
    expect(f).toMatch(/USART1 "echo: abd\\r\\n" expected with its first byte within 10\.250 ms–10\.700 ms; USART1 sent "echo: abc\\r\\n" at 10\.\d+ ms around the window/)
    expect(f).toMatch(/quiet USART1: 11 unexpected byte\(s\), first "echo: abc\\r\\n"/)
  })

  it('a time origin that never comes fails the run instead of hanging', () => {
    const c = clone(BARE)
    c.t0 = 'uart:USART1'
    c.scenarios = []
    const rep = runChecks({ checks: c }, image('bare-button'), { name: 'no-uart' })
    expect(rep.ok).toBe(false)
    expect(rep.failures.join('\n')).toMatch(/baseline: t0: USART1 transmitted nothing within 2001 ms of reset/)
  })

  it('a project without checks is reported, not passed', () => {
    const rep = runChecks({ description: 'x' }, image('bare-button'), { name: 'none' })
    expect(rep.ok).toBe(false)
  })
})

// ------------------------------------------------ simulator regressions

describe('simulator regressions exposed by the contracts', () => {
  it('a net pulled up to the 3V3 rail by an external resistor reads high right after power-up', () => {
    // Found by hal-gpio-modes (PB6/PB7 open-drain with 4.7 kΩ pull-ups read 0
    // until their first low): at power-up the board re-publishes its pin
    // drives, which resolved SOME logic nets against the new 3.3 V rail and
    // recorded that rail as up to date — DigitalNets.refreshRails then left
    // every other logic net at the 0 V of the build. The coordinator now
    // refreshes the rails before the board observes the solve.
    const bench = checksLayout({ circuit: ['PB6: 4.7 kohm pull-up to 3V3', 'PB7: 10 kohm pull-down to GND'] })
    const co = new SimulationCoordinator()
    co.load(bench.layout, 1) // no firmware: every GPIO is a floating input after reset
    co.setLogicChannels([
      { index: 0, label: 'PB6', source: { kind: 'mcu-pin', componentId: CHECK_BOARD_ID, pin: 'PB6' } },
      { index: 1, label: 'PB7', source: { kind: 'mcu-pin', componentId: CHECK_BOARD_ID, pin: 'PB7' } },
    ])
    co.advance(0.2e-3)
    expect(co.mcu(CHECK_BOARD_ID)?.powered).toBe(true)
    const node = pinNode(co, 'PB6')
    expect(co.logicNets?.isLogic(node)).toBe(true)
    expect(co.logicNets?.voltage(node)).toBeCloseTo(co.engine?.voltageOfNode(node) ?? NaN, 3)
    expect(co.logicNets?.voltage(node)).toBeGreaterThan(3.2)
    const chip = co.engine?.chipOf(CHECK_BOARD_ID) as McuBoardChip
    expect(chip.pinLevel(chip.entry?.pins.indexOf('PB6') ?? -1)).toBe(1)
    expect(chip.pinLevel(chip.entry?.pins.indexOf('PB7') ?? -1)).toBe(0)
    const q = co.query({ kind: 'logic', t0: 0, t1: co.time })
    if (q.kind !== 'logic') throw new Error('query')
    expect(q.capture.traces[0].levels[q.capture.traces[0].levels.length - 1]).toBe(1)
  })

  it('logic-net voltages and the ADC reference follow the solved 3V3 rail to well below one ADC LSB', () => {
    // Found by hal-adc-pot ("PA0 tied to 3V3 reads full scale" read 4094):
    // DigitalNets re-resolves only when a rail moves by > 1 mV (1.2 LSB of a
    // 12-bit ADC at 3.3 V), so the voltage the ADC converted was the rail of
    // an earlier load state, and the ADC used a nominal 3.3 V VDDA. Now the
    // coordinator re-resolves at 10 µV and the board reports its solved VDD
    // (Blue Pill: VDDA = VDD = VREF+, RM0008 §11.1).
    const co = bareWorld((layout) => {
      layout.wires.push({ id: 'WL', from: checkBoardTap('PA5'), to: 'e45' })
      layout.components.push({ id: 'RL', type: 'resistor', holes: ['a45', 'a47'], params: { resistance: 330 } })
      layout.components.push({ id: 'DL', type: 'led', holes: ['b47', 'top-30'], params: { color: 'red' } })
      layout.wires.push({ id: 'WP', from: checkBoardTap('PB6'), to: 'e50' })
      layout.components.push({ id: 'RP', type: 'resistor', holes: ['a50', 'top+30'], params: { resistance: 4700 } })
    })
    co.advance(2e-3)
    const eng = co.engine
    const nets = co.logicNets
    if (!eng || !nets) throw new Error('world')
    const v3 = (): number => eng.voltageOfNode(pinNode(co, '3V3_1'))
    const before = v3()
    co.setStimulus(CHECK_BOARD_ID, 'PA0', 0) // PA5 high: the LED loads the 3V3 regulator
    co.advance(1e-3)
    expect(edges(co, 'PA5').at(-1)?.l).toBe(1)
    expect(before - v3()).toBeGreaterThan(50e-6) // the rail really moved (LDO 0.05 Ω × LED current)
    expect(Math.abs(nets.voltage(pinNode(co, 'PB6')) - v3())).toBeLessThan(10e-6)
    const soc = co.mcu(CHECK_BOARD_ID) as unknown as { supplyVoltage?: number }
    if (soc.supplyVoltage !== undefined) expect(Math.abs(soc.supplyVoltage - v3())).toBeLessThan(25e-6)
  })

  it('a hot rewire (load of an unchanged circuit) puts no phantom pulse on a pulled-up input', () => {
    // Found while testing the stimulus across rebuilds: load() resolved the
    // logic nets of the new engine against its all-zero solution (0 V rails)
    // and the fresh board adapter (Schmitt state 0) pushed that to the MCU —
    // bare-button mirrored a 2.6 µs low pulse of PA0 onto PA5 on every edit.
    const co = bareWorld()
    co.advance(5e-3)
    const before = { pa0: edges(co, 'PA0').length, pa5: edges(co, 'PA5').length }
    expect(edges(co, 'PA0').at(-1)?.l).toBe(1)
    co.load(checksLayout({ circuit: [] }).layout, 2)
    co.advance(1e-3)
    co.load(checksLayout({ circuit: [] }).layout, 3)
    co.advance(1e-3)
    expect(edges(co, 'PA0').length).toBe(before.pa0)
    expect(edges(co, 'PA5').length).toBe(before.pa5)
    // and the rebuilt world still reacts: a press right after a rebuild is mirrored
    co.load(checksLayout({ circuit: [] }).layout, 4)
    expect(co.setStimulus(CHECK_BOARD_ID, 'PA0', 0)).toBe(true)
    co.advance(0.1e-3)
    expect(edges(co, 'PA5').at(-1)?.l).toBe(1)
  })
})
