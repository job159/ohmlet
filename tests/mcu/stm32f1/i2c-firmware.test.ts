/**
 * REAL firmware on REAL circuits through the SimulationCoordinator:
 * firmware/dist/hal-i2c-scan.elf and hal-i2c-eeprom.elf (ST HAL v1.1.9) on
 * a Blue Pill whose I2C1 pins (PB6 SCL / PB7 SDA) are wired to an AT24C02
 * DIP-8 on the breadboard, with two 4.7 kΩ pull-ups to the 3V3 rail (the
 * nets are logic-resolvable: MCU pins + device pins + pull resistors to a
 * rail). Everything the firmware learns about the EEPROM travels over the
 * two nets bit by bit; without the pull-ups the lines never rise and HAL
 * reports the real symptom.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadFirmwareFile } from '../../../src/mcu/loader'
import type { FirmwareImage } from '../../../src/mcu/firmware'
import '../../../src/mcu/all'
import { SimulationCoordinator } from '../../../src/sim/coordinator/coordinator'
import type { CircuitLayout, ComponentInstance, Wire } from '../../../src/model/types'
import { at24c02Contents, eraseAt24c02 } from '../../../src/sim/models/serial-ics.model'
import { componentPinHoles, formatHole } from '../../../src/model/breadboard'
import { CATALOG } from '../../../src/model/catalog'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../../../firmware/dist')

function image(name: string): FirmwareImage {
  const res = loadFirmwareFile(`${name}.elf`, new Uint8Array(readFileSync(join(DIST, `${name}.elf`))))
  if (!res.ok) throw new Error(res.error)
  return res.image
}

const BP: ComponentInstance = { id: 'U1', type: 'stm32_bluepill', at: 'h10' }
/** the free hole on the strip of a Blue Pill header pin (row a / j) */
function tap(pin: string): string {
  const entry = CATALOG[BP.type]
  const h = componentPinHoles(BP, entry)?.[entry.pins.indexOf(pin)]
  if (!h || h.kind !== 'strip') throw new Error(pin)
  return formatHole({ ...h, row: h.row === 'c' ? 'a' : 'j' })
}

/**
 * PS1 5 V → 5V pin, GND → top− rail, board 3V3 → top+ rail.
 * AT24C02 (EE1) at f40: A0 f40, A1 f41, A2 f42, GND f43, SDA e43, SCL e42, WP e41, VCC e40.
 */
function eepromWorld(opts: { pullUps: boolean; eeprom?: boolean; id?: string }): CircuitLayout {
  let n = 0
  const wires: Wire[] = []
  const w = (from: string, to: string) => wires.push({ id: `w${++n}`, from, to })
  w('PS1:+', tap('5V'))
  w('PS1:-', 'top-0')
  w(tap('GND3'), 'top-1')
  w(tap('3V3_1'), 'top+0')
  const comps: ComponentInstance[] = [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }, BP]
  if (opts.eeprom !== false) {
    comps.push({ id: opts.id ?? 'EE1', type: 'at24c02', at: 'f40' })
    w('a40', 'top+5') // VCC
    w('j43', 'top-5') // GND
    w('j40', 'top-6') // A0
    w('j41', 'top-7') // A1
    w('j42', 'top-8') // A2
    w('a41', 'top-9') // WP low: writable
  }
  w('a42', tap('PB6')) // SCL
  w('a43', tap('PB7')) // SDA
  if (opts.pullUps) {
    comps.push({ id: 'R1', type: 'resistor', holes: ['b42', 'top+6'], params: { resistance: 4700 } })
    comps.push({ id: 'R2', type: 'resistor', holes: ['b43', 'top+7'], params: { resistance: 4700 } })
  }
  return { version: 1, name: 'i2c eeprom bench', components: comps, wires }
}

function run(layout: CircuitLayout, fw: string, until: (text: string) => boolean, limit = 1.5) {
  const co = new SimulationCoordinator()
  co.load(layout, 1)
  co.setFirmware('U1', image(fw))
  let text = ''
  while (co.time < limit && !until(text)) {
    co.advance(0.01)
    for (const u of co.frame().uart) if (u.port === 'USART1') text += String.fromCharCode(...u.bytes)
  }
  return { co, text }
}

describe('hal-i2c-scan.elf on a Blue Pill + AT24C02', () => {
  it('with 4.7 kΩ pull-ups: finds the EEPROM at 0x50 and nothing else', { timeout: 120_000 }, () => {
    const { co, text } = run(eepromWorld({ pullUps: true, id: 'EESCAN' }), 'hal-i2c-scan', (t) => t.includes('scan done'))
    expect(text).toBe('I2C1 scan 0x08-0x77\r\nfound 0x50\r\nscan done 1\r\n')
    expect(co.issues().filter((i) => i.level === 'error')).toEqual([])
    // the I2C nets are logic-resolvable (exact-time resolution, no analog stepping)
    expect(co.logicNets).not.toBeNull()
  })

  it('pull-ups but no EEPROM: every address NACKed → "scan done 0"', { timeout: 120_000 }, () => {
    const { text } = run(eepromWorld({ pullUps: true, eeprom: false }), 'hal-i2c-scan', (t) => t.includes('scan done'))
    expect(text).toBe('I2C1 scan 0x08-0x77\r\nscan done 0\r\n')
  })

  it('WITHOUT pull-ups: SDA/SCL never rise → BUSY stays set → HAL_BUSY on the first address, nothing found', { timeout: 120_000 }, () => {
    const { co, text } = run(eepromWorld({ pullUps: false, id: 'EESCAN2' }), 'hal-i2c-scan', (t) => t.includes('scan done'))
    expect(text).toBe('I2C1 scan 0x08-0x77\r\nbus busy at 0x08: SDA/SCL stuck low (pull-ups?)\r\nscan done 0\r\n')
    const mcu = co.mcu('U1')!
    expect(mcu.readMemory(0x40005418, 4)[0] & 2).toBe(2) // I2C1_SR2.BUSY
  })
})

describe('hal-i2c-eeprom.elf on a Blue Pill + AT24C02', () => {
  it('writes 16 bytes across two page boundaries with ACK polling, reads them back (N = 16 / 1 / 2, interrupt mode): "eeprom ok"', { timeout: 180_000 }, () => {
    eraseAt24c02('EE1')
    const { co, text } = run(eepromWorld({ pullUps: true }), 'hal-i2c-eeprom', (t) => /eeprom ok|mismatch|error|not found/.test(t), 2)
    expect(text).toMatch(/^AT24C02 test\r\nbefore: (FF ){15}FF\r\n/)
    // three page-aligned writes, each followed by ~5 ms of ACK polling (≈ 112 µs per poll)
    const polls = [...text.matchAll(/wrote (\d+) bytes at 0x([0-9A-F]{2}), ready after (\d+) polls\r\n/g)]
    expect(polls.map((m) => [m[1], m[2]])).toEqual([
      ['4', '1C'],
      ['8', '20'],
      ['4', '28'],
    ])
    for (const m of polls) {
      expect(Number(m[3])).toBeGreaterThanOrEqual(35)
      expect(Number(m[3])).toBeLessThanOrEqual(50)
    }
    expect(text).toContain('read 16 ok\r\nread 1 ok\r\nread 2 ok\r\nread 16 (IT) ok\r\neeprom ok\r\n')
    const mem = at24c02Contents('EE1')
    expect(Array.from(mem.slice(0x1c, 0x2c))).toEqual(Array.from({ length: 16 }, (_, i) => 0xa0 + i))
    expect(mem[0x1b]).toBe(0xff)
    expect(mem[0x2c]).toBe(0xff)
    expect(co.issues().filter((i) => i.level === 'error')).toEqual([])
  })

  it('the EEPROM is non-volatile: after a power cycle the firmware reads the previous contents', { timeout: 180_000 }, () => {
    eraseAt24c02('EE1')
    const first = run(eepromWorld({ pullUps: true }), 'hal-i2c-eeprom', (t) => t.includes('eeprom ok'), 2)
    expect(first.text).toContain('eeprom ok')
    first.co.reset() // full power cycle of the world
    let text = ''
    while (first.co.time < 2 && !text.includes('eeprom ok')) {
      first.co.advance(0.01)
      for (const u of first.co.frame().uart) if (u.port === 'USART1') text += String.fromCharCode(...u.bytes)
    }
    expect(text).toContain('before: A0 A1 A2 A3 A4 A5 A6 A7 A8 A9 AA AB AC AD AE AF\r\n')
    expect(text).toContain('eeprom ok')
  })

  it('no EEPROM on the bus: "eeprom not found at 0x50"', { timeout: 120_000 }, () => {
    const { text } = run(eepromWorld({ pullUps: true, eeprom: false }), 'hal-i2c-eeprom', (t) => t.includes('not found'))
    expect(text).toBe('AT24C02 test\r\neeprom not found at 0x50\r\n')
  })
})
