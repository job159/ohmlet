/**
 * Dynamic coverage of the runtime messages (zh-TW): representative circuits
 * and REAL firmware run in the SimulationCoordinator, and every message the
 * user can be shown is collected —
 *
 *   - SimIssue messages (engine + coordinator) and SimLogEntry messages
 *     (MCU core / SoC / peripherals / devices / simulator) of every frame;
 *   - ERC findings of each layout, statically and with the run's telemetry;
 *   - the live peripheral support table (McuDevice.support notes, composed
 *     from the *_NOTES / TIM_SUPPORT constants) — exact NOTES_ZH texts;
 *   - firmware loader errors / warnings / ELF descriptions;
 *   - layout-validator errors and warnings (shown when a file is imported)
 *     and project-file parse errors / warnings;
 *   - the firmware-contract bench notes (checksLayout);
 *
 * then each must translate COMPLETELY through tMessage(): a pattern (or an
 * exact note) exists and the Chinese text keeps no English words besides
 * technical tokens (zh-check.ts). Complements messages-static.test.ts (which
 * checks templates with probe values) with the composed texts real runs
 * produce: nested fragments, lists, joined sentences.
 *
 * Scenarios: the legacy example circuits (examples/*.json); a Blue Pill with
 * hal-blink + PA5 LED, hal-uart-hello (plus bytes sent to its RX),
 * hal-i2c-scan with pull-ups + AT24C02 and without pull-ups, hal-i2c-eeprom,
 * hal-spi-595, hal-adc-dma, hal-tim-pwm, hal-button-exti, soc-iwdg,
 * soc-clock; an unpowered board with firmware; a powered board without
 * firmware; a board fed 5 V into its 3.3 V pin; a raw binary that faults; a
 * shorted supply; an LED without resistor; the ERC rule fixtures of
 * tests/erc (5 V on standard and FT pins, directly / through resistors /
 * dividers, function generator, 5 V logic outputs, a 5 V CMOS input,
 * supply range, regulator dropout and current limit, over-rating).
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../../src/i18n'
import { hasMessageTranslation, tMessage } from '../../src/i18n/messages'
import '../../src/mcu/all'
import type { FirmwareImage } from '../../src/mcu/firmware'
import { loadFirmwareFile } from '../../src/mcu/loader'
import { createMcu } from '../../src/mcu/registry'
import type { CircuitLayout, ComponentInstance, Wire } from '../../src/model/types'
import { validateLayout } from '../../src/model/validate'
import { checksLayout } from '../../src/sim/coordinator/checks'
import type { FirmwareChecks, ManifestEntry } from '../../src/sim/coordinator/checks'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import { runErc } from '../../src/sim/erc'
import { parseProject } from '../../src/state/project'
import { bluePillWorld, part, tap, w } from '../coordinator/worlds'
import * as E from '../erc/helpers'
import { englishLeft } from './zh-check'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIST = path.join(ROOT, 'firmware/dist')
const MANIFEST = JSON.parse(readFileSync(path.join(DIST, 'manifest.json'), 'utf8')) as Record<string, ManifestEntry>

// ---------------------------------------------------------------- collection

interface Seen {
  /** the first scenario that produced the message */
  where: string
  /** user data quoted inside the message (a project's own circuit lines): not UI text */
  data?: string[]
}

const collected = new Map<string, Seen>()

function collect(where: string, msgs: Iterable<string | undefined>, data?: string[]): void {
  for (const m of msgs) if (m && !collected.has(m)) collected.set(m, data ? { where, data } : { where })
}

/** Messages that do not translate completely (pattern missing or English left). */
function untranslated(msgs: Iterable<[string, Seen]>): string[] {
  const bad: string[] = []
  for (const [msg, { where, data }] of msgs) {
    const zh = tMessage(msg)
    let text = zh
    for (const d of data ?? []) text = text.split(d).join(' ')
    const left = !hasMessageTranslation(msg) || zh === msg ? ['(untranslated)'] : englishLeft(text)
    if (left.length) bad.push(`[${where}] [${left.join(', ')}]\n    EN ${msg}\n    ZH ${zh}`)
  }
  return bad
}

// ---------------------------------------------------------------- firmware

const images = new Map<string, FirmwareImage>()
function image(name: string): FirmwareImage {
  let img = images.get(name)
  if (!img) {
    const res = loadFirmwareFile(`${name}.elf`, new Uint8Array(readFileSync(path.join(DIST, `${name}.elf`))))
    if (!res.ok) throw new Error(`${name}.elf: ${res.error}`)
    img = res.image
    images.set(name, img)
    collect(`load ${name}.elf`, [...img.warnings, img.description])
  }
  return img
}

interface RunOptions {
  firmware?: string | FirmwareImage
  /** simulated seconds (default 0.4) */
  seconds?: number
  /** bytes sent to USART1 RX at 1/2 of the run */
  uartRx?: string
}

/** Run a layout, collecting frame logs / issues and the ERC findings (static + live). */
function run(name: string, layout: CircuitLayout, o: RunOptions = {}): SimulationCoordinator {
  collect(`${name} (validator)`, [...validateLayout(layout).errors, ...validateLayout(layout).warnings])
  collect(`${name} (ERC)`, runErc(layout).map((f) => f.message))
  const co = new SimulationCoordinator()
  co.load(layout, 1)
  if (o.firmware) co.setFirmware('U1', typeof o.firmware === 'string' ? image(o.firmware) : o.firmware)
  const total = o.seconds ?? 0.4
  const dt = 0.05
  let sent = false
  for (let t = 0; t < total - 1e-9; t += dt) {
    co.advance(dt)
    if (o.uartRx && !sent && t >= total / 2) {
      co.uartSend('U1', 'USART1', new TextEncoder().encode(o.uartRx))
      sent = true
    }
    const f = co.frame(true)
    collect(name, f.log.map((e) => e.message))
    collect(name, f.issues.map((i) => i.message))
  }
  const tele = co.telemetry()
  collect(`${name} (live ERC)`, runErc(layout, { telemetry: tele, issues: tele.issues }).map((f) => f.message))
  return co
}

/** The firmware-contract bench of a project (its checks.circuit, or `circuit` instead). */
function bench(project: string, circuit?: string[]): CircuitLayout {
  const checks = MANIFEST[project]?.checks
  if (!checks) throw new Error(`${project}: no checks in the manifest`)
  const c: FirmwareChecks = circuit ? { ...checks, circuit } : checks
  const b = checksLayout(c, project)
  // the project's own circuit lines are quoted verbatim (project.json content, English)
  collect(`${project} bench`, b.notes, c.circuit ?? [])
  return b.layout
}

const example = (f: string) => JSON.parse(readFileSync(path.join(ROOT, 'examples', f), 'utf8')) as CircuitLayout

const PS = (v = 5): ComponentInstance => ({ id: 'PS1', type: 'power_supply', params: { voltage: v } })
const RAILS: Wire[] = [
  { id: 'r1', from: 'PS1:+', to: 'top+0' },
  { id: 'r2', from: 'PS1:-', to: 'top-0' },
]

/**
 * A raw binary that faults at once: SP = 0x20005000, reset → 0x08000009
 * (Thumb), whose first halfword is UDF #0 (0xDE00) — UsageFault escalated to
 * HardFault, whose vector (0) is not executable either → lockup.
 */
function faultingBin(): Uint8Array {
  const b = new Uint8Array(16)
  const dv = new DataView(b.buffer)
  dv.setUint32(0, 0x20005000, true)
  dv.setUint32(4, 0x08000009, true)
  dv.setUint16(8, 0xde00, true)
  dv.setUint16(10, 0xe7fe, true) // b .
  return b
}

// ---------------------------------------------------------------- tests

describe('runtime messages: dynamic coverage (zh-TW)', () => {
  beforeAll(() => __setLangForTests('zh-TW'))
  afterAll(() => __setLangForTests('zh-TW'))

  it('legacy example circuits', { timeout: 120_000 }, () => {
    const files = readdirSync(path.join(ROOT, 'examples')).filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(4)
    for (const f of files) run(`examples/${f}`, example(f), { seconds: 0.5 }).dispose()
  })

  it('broken analog circuits: shorted supply, LED without resistor', { timeout: 60_000 }, () => {
    run('shorted supply', {
      version: 1,
      name: 'short',
      components: [PS()],
      wires: [...RAILS, { id: 'w1', from: 'top+5', to: 'top-5' }],
    }).dispose()
    run('LED without resistor', {
      version: 1,
      name: 'led',
      components: [PS(), part('D1', 'led', ['a10', 'a11'], { color: 'red' })],
      wires: [...RAILS, { id: 'w1', from: 'top+5', to: 'b10' }, { id: 'w2', from: 'b11', to: 'top-5' }],
    }).dispose()
    const all = [...collected.keys()]
    expect(all.some((m) => /burn|short/i.test(m))).toBe(true)
  })

  it('Blue Pill boards: unpowered, no firmware, 5 V into 3V3', { timeout: 120_000 }, () => {
    run('unpowered board', { version: 1, name: 'bp', components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }], wires: [] }, {
      firmware: 'hal-blink',
      seconds: 0.2,
    }).dispose()
    run('no firmware', bluePillWorld(), { seconds: 0.2 }).dispose()
    run('5 V into 3V3', bluePillWorld([], [], { via3v3: true, supply: 5 }), { firmware: 'hal-blink', seconds: 0.2 }).dispose()
    expect([...collected.keys()].some((m) => /no firmware loaded/.test(m))).toBe(true)
  })

  it('real firmware: blink, UART, I²C with and without pull-ups, SPI, ADC + DMA, timers, EXTI, IWDG, clocks', { timeout: 300_000 }, () => {
    run(
      'hal-blink',
      bluePillWorld([part('R1', 'resistor', ['a45', 'a50'], { resistance: 330 }), part('D1', 'led', ['b50', 'top-5'], { color: 'red' })], [w(tap('PA5'), 'e45')]),
      { firmware: 'hal-blink', seconds: 0.6 },
    ).dispose()
    run('hal-uart-hello', bluePillWorld(), { firmware: 'hal-uart-hello', seconds: 1.2, uartRx: 'hi\r\n' }).dispose()
    run('hal-i2c-scan + AT24C02', bench('hal-i2c-scan', ['PB6, PB7: AT24C02 (A2-A0, WP to GND) + 4.7k pull-ups to 3V3', 'USART1: virtual terminal on PA9 (TX) / PA10 (RX)']), {
      firmware: 'hal-i2c-scan',
      seconds: 0.3,
    }).dispose()
    run('hal-i2c-scan without pull-ups', bench('hal-i2c-scan', ['USART1: virtual terminal on PA9 (TX) / PA10 (RX)']), {
      firmware: 'hal-i2c-scan',
      seconds: 0.3,
    }).dispose()
    for (const fw of ['hal-i2c-eeprom', 'hal-spi-595', 'hal-adc-dma', 'hal-tim-pwm', 'hal-button-exti']) {
      run(fw, bench(fw), { firmware: fw, seconds: 0.3 }).dispose()
    }
    for (const fw of ['soc-iwdg', 'soc-clock']) run(fw, bluePillWorld(), { firmware: fw, seconds: 0.6 }).dispose()

    const res = loadFirmwareFile('fault.bin', faultingBin())
    if (!res.ok) throw new Error(res.error)
    collect('load fault.bin', [...res.image.warnings, res.image.description])
    run('faulting binary', bluePillWorld(), { firmware: res.image, seconds: 0.05 }).dispose()

    const all = [...collected.keys()]
    expect(all.length).toBeGreaterThan(30)
  })

  it('ERC rule fixtures: GPIO overvoltage, logic levels, supply range, live ratings', { timeout: 120_000 }, () => {
    // the layouts of tests/erc (composed findings: "<source> through <R> (<Ω>)", dividers, FT notes…)
    const INV: ComponentInstance = { id: 'U2', type: 'sn7404', at: 'f40' }
    const INV_POWER = [E.w('a40', 'top+6'), E.w('j46', 'top-6')]
    const erc = (name: string, l: CircuitLayout, live = false) => {
      collect(`ERC ${name}`, runErc(E.valid(l)).map((f) => f.message))
      collect(`ERC ${name} (pull-up firmware)`, runErc(l, { telemetry: E.modesTelemetry({ PA0: 'in↑', PA9: 'in↑', PB6: 'in↑' }) }).map((f) => f.message))
      if (live) run(`ERC ${name} (live)`, l, { seconds: 0.02 }).dispose()
    }
    erc('5 V on PA0', E.bluePill([], [E.w(E.tap('PA0'), 'top+5')]))
    erc('5 V on FT PA9', E.bluePill([], [E.w(E.tap('PA9'), 'top+5')]))
    erc('9 V on FT PA9', E.bluePill([E.ps('PS2', 9)], [E.w('PS2:+', 'bot+0'), E.w('PS2:-', 'top-5'), E.w(E.tap('PA9'), 'bot+3')]))
    for (const r of [220, 10_000]) {
      erc(`${r} Ω to 5 V on PA0`, E.bluePill([E.part('R1', 'resistor', ['a40', 'top+5'], { resistance: r })], [E.w(E.tap('PA0'), 'b40')]))
    }
    erc(
      '10 k / 100 k divider on PA0',
      E.bluePill(
        [E.part('R1', 'resistor', ['a40', 'top+5'], { resistance: 10_000 }), E.part('R2', 'resistor', ['b40', 'top-5'], { resistance: 100_000 })],
        [E.w(E.tap('PA0'), 'c40')],
      ),
    )
    for (const params of [undefined, { offset: 0, amplitude: 2 }]) {
      erc(
        'function generator on PA0',
        E.bluePill([params ? { id: 'FG1', type: 'function_generator', params } : { id: 'FG1', type: 'function_generator' }], [E.w('FG1:out', E.tap('PA0')), E.w('FG1:gnd', 'top-5')]),
      )
    }
    erc('unpowered board, PA0 on 5 V', E.layout([E.ps(), E.BP], [E.w('PS1:+', 'top+0'), E.w('PS1:-', 'top-0'), E.w(E.tap('GND3'), 'top-1'), E.w(E.tap('PA0'), 'top+2')]))
    erc('7404 output on PA0', E.bluePill([INV], [...INV_POWER, E.w('j41', E.tap('PA0'))]))
    erc('7404 output on FT PA9', E.bluePill([INV], [...INV_POWER, E.w('j41', E.tap('PA9'))]))
    erc('7404 output via 1 kΩ on PA0', E.bluePill([INV, E.part('R1', 'resistor', ['g41', 'g50'], { resistance: 1000 })], [...INV_POWER, E.w('j50', E.tap('PA0'))]))
    erc('PA0 into a 5 V CD4017 clock', E.bluePill([{ id: 'U3', type: 'cd4017', at: 'f50' }], [E.w('a50', 'top+7'), E.w('j57', 'top-7'), E.w('a52', E.tap('PA0'))]))
    erc('5 V into a 3.3 V pin', E.bluePill([], [], { via3v3: true }), true)
    erc('3.3 V into the 5V pin', E.bluePill([], [], { supply: 3.3 }), true)
    erc('3.3 V rail overloaded by 5 Ω', E.bluePill([E.part('R1', 'resistor', [E.tap('3V3_1'), 'top-9'], { resistance: 5 })]), true)
    erc(
      'board fed through 2.2 kΩ',
      E.layout(
        [E.ps(), E.BP, E.part('R1', 'resistor', ['a40', 'a45'], { resistance: 2200 })],
        [E.w('PS1:+', 'top+0'), E.w('PS1:-', 'top-0'), E.w(E.tap('GND3'), 'top-1'), E.w('top+2', 'b40'), E.w('b45', E.tap('5V'))],
      ),
      true,
    )
    erc('pull-ups to 5 V on PB6/PB7', E.bluePill(
      [E.part('R1', 'resistor', ['a40', 'top+5'], { resistance: 4700 }), E.part('R2', 'resistor', ['a41', 'top+6'], { resistance: 4700 })],
      [E.w(E.tap('PB6'), 'b40'), E.w(E.tap('PB7'), 'b41')],
    ))
    erc('10 Ω across 5 V', E.railsWorld([E.part('R1', 'resistor', ['top+5', 'top-5'], { resistance: 10 })]), true)
    expect([...collected.values()].filter((s) => s.where.startsWith('ERC ')).length).toBeGreaterThan(10)
    // the composed shapes are really produced (their fragments are what the patterns must split)
    const msgs = [...collected.keys()]
    for (const re of [
      / through R1 \(10 kΩ\) \(the resistors on the pin divide it to ≈ [\d.]+ [mµ]?V\): /,
      /by U2 1Y \(an output powered at 5\.00 V\) through R1 \(1 kΩ\)/,
      /is at 5\.00 V from PS1 \+ — above/,
      /regulator is in dropout/,
      /driven to 5\.00 V by FG1 out/,
    ]) {
      expect(msgs.some((m) => re.test(m)), String(re)).toBe(true)
    }
  })

  it('firmware loader errors and warnings', () => {
    const elf = new Uint8Array(readFileSync(path.join(DIST, 'hal-blink.elf')))
    const hex = readFileSync(path.join(DIST, 'hal-blink.hex'), 'utf8')
    const enc = (s: string) => new TextEncoder().encode(s)
    const cases: [string, Uint8Array][] = [
      ['empty.elf', new Uint8Array(0)],
      ['fake.elf', enc('not an elf')],
      ['fake.hex', enc('hello')],
      ['notes.txt', enc('hello')],
      ['short.elf', elf.slice(0, 60)],
      ['cut.elf', elf.slice(0, 2000)],
      ['bad-sum.hex', enc(hex.replace(/^(:[0-9A-F]{8}[0-9A-F]+)([0-9A-F]{2})(\r?\n)/, (_m, a: string, _s: string, nl: string) => `${a}00${nl}`))],
      ['cut.hex', enc(hex.split('\n').slice(0, 5).join('\n'))],
      ['big.bin', new Uint8Array(200 * 1024)],
      ['tiny.bin', new Uint8Array(4)],
    ]
    for (const [name, bytes] of cases) {
      const r = loadFirmwareFile(name, bytes)
      collect(`loader ${name}`, r.ok ? [...r.image.warnings, r.image.description] : [r.error])
    }
    expect([...collected.values()].some((s) => s.where.startsWith('loader '))).toBe(true)
  })

  it('layout validator and project files', () => {
    const bad: unknown[] = [
      null,
      { version: 2, components: [], wires: [] },
      { version: 1, components: 'x', wires: [] },
      {
        version: 1,
        components: [
          { id: 'R1', type: 'resistor', holes: ['a10', 'a10'] },
          { id: 'R1', type: 'nope', holes: ['a1', 'a2'] },
          { id: '9x', type: 'led', holes: ['z99', 'a3'], params: { color: 'pink' } },
          { id: 'U1', type: 'stm32_bluepill', at: 'a1' },
          { id: 'PS1', type: 'power_supply', params: { voltage: 99 } },
        ],
        wires: [
          { id: 'w1', from: 'PS1:x', to: 'a5' },
          { id: 'w1', from: 'Q9:+', to: 'top+99' },
          { id: 'w3', from: 'a5', to: 'a5' },
        ],
      },
    ]
    for (const b of bad) {
      const r = validateLayout(b)
      collect('validator', [...r.errors, ...r.warnings])
    }
    for (const text of [
      'not json',
      '{}',
      '{"format":"ohmlet-project","formatVersion":9}',
      '{"format":"ohmlet-project","formatVersion":1,"app":{"name":"ohmlet"},"circuit":{"version":1,"components":[],"wires":[]},"firmware":[{"componentId":"U1","name":"x.elf","sha256":"00","data":"!!"}]}',
    ]) {
      const r = parseProject(text)
      collect('project file', r.ok ? r.warnings : [...r.errors, ...r.warnings])
    }
    expect([...collected.values()].some((s) => s.where === 'validator')).toBe(true)
  })

  it('every collected message translates completely', () => {
    expect(collected.size).toBeGreaterThan(60)
    const bad = untranslated(collected)
    expect(bad, `${bad.length} of ${collected.size} runtime messages are not (fully) translated:\n${bad.join('\n')}`).toEqual([])
  })

  it('the live peripheral support table: every note has its exact zh-TW text', () => {
    const mcu = createMcu('stm32f103c8')
    expect(mcu).not.toBeNull()
    const support = mcu!.support
    expect(support.length).toBeGreaterThan(25)
    const notes = new Map<string, Seen>()
    for (const s of support) if (s.notes) notes.set(s.notes, { where: `support ${s.name}` })
    const bad = untranslated(notes)
    expect(bad, `${bad.length} support notes are not (fully) translated:\n${bad.join('\n')}`).toEqual([])
  })
})
