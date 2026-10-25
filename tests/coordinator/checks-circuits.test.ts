/**
 * Firmware-contract bench phrasings for serial ICs and jumpers
 * (src/sim/coordinator/checks.ts checksLayout):
 *   'PB6, PB7: AT24C02 (A2-A0, WP to GND) + 4.7k pull-ups to 3V3'   (SCL, SDA)
 *   'PA5, PA7, PA4: 74HC595 (…), QA-QH: LED + 220 ohm to GND'      (SRCLK, SER, RCLK)
 *   'PA6 -> PA0: jumper wire'
 * and the four projects whose contracts need them (hal-i2c-eeprom,
 * hal-spi-595, hal-spi-loopback, hal-tim-capture), run from their
 * project.json `checks` against the committed firmware images — every rule
 * must pass on the REAL circuit (tests/firmware-checks.test.ts runs the
 * same contracts from dist/manifest.json, which every firmware build copies
 * from project.json — checked below to be in sync).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadFirmwareFile } from '../../src/mcu/loader'
import '../../src/mcu/all'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import { CHECK_BOARD_ID, checkBoardTap, checksLayout, formatReport, runChecks } from '../../src/sim/coordinator/checks'
import type { ManifestEntry } from '../../src/sim/coordinator/checks'
import { validateLayout } from '../../src/model/validate'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '../../firmware/dist')
const PROJECTS = join(HERE, '../../firmware/projects')

function image(name: string) {
  const res = loadFirmwareFile(`${name}.elf`, new Uint8Array(readFileSync(join(DIST, `${name}.elf`))))
  if (!res.ok) throw new Error(res.error)
  return res.image
}
const project = (name: string): ManifestEntry =>
  JSON.parse(readFileSync(join(PROJECTS, name, 'project.json'), 'utf8')) as ManifestEntry

describe('checksLayout: serial-IC and jumper phrasings', () => {
  it('AT24C02: SCL/SDA wired from the header, A2–A0 and WP to GND, VCC 3V3, two pull-ups', () => {
    const b = checksLayout({ circuit: ['PB6, PB7: AT24C02 (A2-A0, WP to GND) + 4.7k pull-ups to 3V3'] })
    expect(b.notes.some((n) => /not wired/i.test(n))).toBe(false)
    const ee = b.layout.components.find((c) => c.type === 'at24c02')
    expect(ee).toEqual({ id: 'U2', type: 'at24c02', at: 'f33' })
    const wires = b.layout.wires.map((w) => `${w.from}>${w.to}`)
    expect(wires).toContain(`a35>${checkBoardTap('PB6')}`) // SCL e35
    expect(wires).toContain(`a36>${checkBoardTap('PB7')}`) // SDA e36
    const pulls = b.layout.components.filter((c) => c.type === 'resistor')
    expect(pulls.map((r) => [r.holes?.[0], r.params?.resistance])).toEqual([
      ['b35', 4700],
      ['b36', 4700],
    ])
    expect(pulls.every((r) => r.holes?.[1]?.startsWith('top+'))).toBe(true)
    expect(validateLayout(b.layout).ok).toBe(true)
  })

  it('74HC595: SRCLK/SER/RCLK, SRCLR high, OE low, eight LEDs with their resistors', () => {
    const b = checksLayout({
      circuit: ['PA5, PA7, PA4: 74HC595 (SRCLK, SER, RCLK; SRCLR to 3V3, OE to GND), QA-QH: green LED + 330 ohm to GND'],
    })
    expect(b.notes.some((n) => /not wired/i.test(n))).toBe(false)
    expect(b.layout.components.filter((c) => c.type === '74hc595')).toHaveLength(1)
    const leds = b.layout.components.filter((c) => c.type === 'led')
    expect(leds).toHaveLength(8)
    expect(leds.every((d) => d.params?.color === 'green')).toBe(true)
    expect(b.layout.components.filter((c) => c.type === 'resistor').every((r) => r.params?.resistance === 330)).toBe(true)
    const wires = b.layout.wires.map((w) => `${w.from}>${w.to}`)
    expect(wires).toContain(`a38>${checkBoardTap('PA5')}`) // SRCLK e38
    expect(wires).toContain(`a35>${checkBoardTap('PA7')}`) // SER e35
    expect(wires).toContain(`a37>${checkBoardTap('PA4')}`) // RCLK e37
    expect(validateLayout(b.layout).ok).toBe(true)
  })

  it('jumper wire between two header strips; a header pin takes only one wire', () => {
    const b = checksLayout({ circuit: ['PA6 -> PA0: jumper wire'] })
    expect(b.layout.wires.map((w) => `${w.from}>${w.to}`)).toContain(`${checkBoardTap('PA6')}>${checkBoardTap('PA0')}`)
    expect(validateLayout(b.layout).ok).toBe(true)
    const twice = checksLayout({ circuit: ['PA6 -> PA0: jumper wire', 'PA6: LED + 220 ohm to GND'] })
    expect(twice.notes.some((n) => n.includes('PA6 is already wired by an earlier circuit line') && n.includes('not wired'))).toBe(true)
    const bad = checksLayout({ circuit: ['PB6: AT24C02 (A2-A0, WP to GND)'] })
    expect(bad.notes.some((n) => n.includes('names its SCL and SDA pins') && n.includes('not wired'))).toBe(true)
  })

  it('existing phrasings build exactly the same bench as before (no IC / jumper lines)', () => {
    const b = checksLayout({ circuit: ['PA5: LED + 220 ohm to GND', 'PB12: 10k ohm pull-up to 3V3'] })
    expect(b.layout.components.map((c) => [c.id, c.type, c.holes ?? c.at])).toEqual([
      ['PS1', 'power_supply', undefined],
      ['U1', 'stm32_bluepill', 'h10'],
      ['R1', 'resistor', ['a33', 'a35']],
      ['D1', 'led', ['b35', 'top-10']],
      ['R2', 'resistor', ['a36', 'top+11']],
    ])
  })
})

const CONTRACTS = ['hal-i2c-eeprom', 'hal-spi-595', 'hal-spi-loopback', 'hal-tim-capture'] as const
const available = CONTRACTS.every((n) => existsSync(join(DIST, `${n}.elf`)))

describe.skipIf(!available)('full contracts of the serial-bus / capture projects (project.json checks)', () => {
  it('dist/manifest.json carries exactly these checks (the firmware build copied them)', () => {
    const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8')) as Record<string, ManifestEntry>
    for (const name of CONTRACTS) expect(manifest[name]?.checks, name).toEqual(project(name).checks)
  })

  for (const name of CONTRACTS) {
    it(`${name} meets its checks on the real circuit`, { timeout: 600_000 }, () => {
      const entry = project(name)
      expect(entry.checks, `${name} has checks`).toBeDefined()
      // nothing in the circuit is left unmodeled any more
      for (const line of entry.checks?.circuit ?? []) expect(line).not.toMatch(/not connected on this bench|not modeled|cannot place/i)
      const rep = runChecks(entry, image(name), { name })
      expect(rep.failures, formatReport(rep, true)).toEqual([])
      expect(rep.ok).toBe(true)
      expect(rep.bench.some((n) => /not wired/i.test(n))).toBe(false)
      expect(rep.runs.map((r) => r.name)).toEqual(['baseline', ...(entry.checks?.scenarios ?? []).map((s) => s.name)])
    })
  }

  it('hal-spi-595 on the checks bench really chases the LEDs (QA … QH one at a time)', { timeout: 120_000 }, () => {
    const entry = project('hal-spi-595')
    const b = checksLayout(entry.checks ?? {}, 'hal-spi-595')
    const co = new SimulationCoordinator()
    co.load(b.layout, 1)
    co.setFirmware(CHECK_BOARD_ID, image('hal-spi-595'))
    const lit: number[] = []
    for (let k = 0; k < 4; k++) {
      co.advance(0.1)
      const tele = co.telemetry()
      const on = [1, 2, 3, 4, 5, 6, 7, 8].filter((i) => (tele.components[`D${i}`]?.ledBrightness ?? 0) > 0.3)
      expect(on.length, `step ${k}`).toBe(1)
      lit.push(on[0])
    }
    // consecutive outputs light in order (QA = D1 … QH = D8)
    for (let k = 1; k < lit.length; k++) expect(lit[k]).toBe((lit[k - 1] % 8) + 1)
    co.dispose()
  })
})
