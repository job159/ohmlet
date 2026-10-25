/**
 * Decoders on REAL firmware traces: the ST-HAL images of firmware/dist run
 * on the stm32f103c8 model inside the SimulationCoordinator (Blue Pill fed
 * 5 V on its 5V pin), the logic analyzer records MCU pins, and the decoder
 * output must equal what the peripheral itself reported:
 *
 *   - hal-uart-hello.elf (USART1 115200 8N1 on PA9): the UART decoder over
 *     the PA9 edge list — at the configured baud AND auto-detected — yields
 *     exactly the bytes UartTap delivered (banner + "tick 1"), with frame
 *     times on the 115200 Bd bit grid;
 *   - hal-i2c-scan.elf (I2C1 on PB6/PB7, AT24C02 + 4.7 kΩ pull-ups): the
 *     I²C decoder over the SCL/SDA edge lists sees the 112-address scan,
 *     one START / address+W / STOP each, ACK only where the firmware
 *     reported a device;
 *   - hal-i2c-eeprom.elf: the decoded page writes carry exactly the bytes
 *     the AT24C02 model stored, the decoded read-backs return them.
 * (The I²C parts skip while those images are missing.)
 *
 * Skipped unless the MCU barrel registers 'stm32f103c8' and the firmware
 * loader is present (loaded through globs like tests/coordinator/firmware-e2e).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { registeredMcus } from '../../src/mcu/registry'
import type { LoadResult } from '../../src/mcu/firmware'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import type { LogicCapture } from '../../src/sim/coordinator/api'
import { decodeI2c, decodeUart } from '../../src/instruments/decoders'
import { toVcd } from '../../src/instruments/export'
import { measureEdges } from '../../src/instruments/measure'
import { at24c02Contents, eraseAt24c02 } from '../../src/sim/models/serial-ics.model'
import type { CircuitLayout, ComponentInstance, Wire } from '../../src/model/types'
import { BP, bluePillWorld, tap } from '../coordinator/worlds'

import.meta.glob('../../src/mcu/all.ts', { eager: true })
const loaderMods = import.meta.glob('../../src/mcu/loader/index.ts', { eager: true }) as Record<
  string,
  { loadFirmwareFile?: (name: string, bytes: Uint8Array) => LoadResult }
>
const loadFirmwareFile = Object.values(loaderMods)[0]?.loadFirmwareFile
const available = registeredMcus().includes('stm32f103c8') && typeof loadFirmwareFile === 'function'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '../../firmware/dist')
const UART_ELF = join(DIST, 'hal-uart-hello.elf')
const I2C_SCAN_ELF = join(DIST, 'hal-i2c-scan.elf')
const I2C_EEPROM_ELF = join(DIST, 'hal-i2c-eeprom.elf')

function load(file: string) {
  const res = loadFirmwareFile!(file.split(/[\\/]/).pop()!, new Uint8Array(readFileSync(file)))
  if (!res.ok) throw new Error(res.error)
  return res.image
}

function logic(co: SimulationCoordinator): LogicCapture {
  const r = co.query({ kind: 'logic', t0: 0, t1: co.time })
  if (r.kind !== 'logic') throw new Error('logic query')
  return r.capture
}

describe.skipIf(!available || !existsSync(UART_ELF))('real firmware: UART decoder on hal-uart-hello PA9', () => {
  it('decodes exactly the bytes UartTap delivered (configured and auto baud)', { timeout: 180_000 }, () => {
    const co = new SimulationCoordinator()
    co.load(bluePillWorld(), 1)
    co.setFirmware('U1', load(UART_ELF))
    co.setLogicChannels([{ index: 0, label: 'PA9', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA9' } }])

    // banner at boot, "tick 1" ~1 s later
    const tapped: number[] = []
    for (let k = 0; k < 12; k++) {
      co.advance(0.1)
      for (const u of co.frame().uart) if (u.componentId === 'U1' && u.port === 'USART1') tapped.push(...u.bytes)
    }
    const text = String.fromCharCode(...tapped)
    expect(text.startsWith('Hello from STM32F103!\r\n')).toBe(true)
    expect(text).toContain('tick 1\r\n')

    const cap = logic(co)
    const tr = cap.traces.find((t) => t.index === 0)!
    expect(tr.exact).toBe(true)
    expect(cap.overflow).toBe(false)

    const fixed = decodeUart(tr, { baud: 115200 }, cap.t1)
    expect(fixed.frames.map((f) => f.value)).toEqual(tapped)
    expect(fixed.annotations.filter((a) => a.kind !== 'data')).toEqual([])
    expect(fixed.annotations[0].text).toBe("0x48 'H'")

    const auto = decodeUart(tr, { baud: 'auto' }, cap.t1)
    expect(auto.baud).toBe(115200)
    expect(auto.frames.map((f) => f.value)).toEqual(tapped)

    // every edge of a frame sits on the 115200 Bd bit grid of its start bit
    // (BRR 0x271 at 72 MHz = exactly 625 PCLK2 cycles per bit)
    const T = 1 / 115200
    for (const f of fixed.frames.slice(0, 23)) {
      for (let i = 0; i < tr.times.length; i++) {
        const t = tr.times[i]
        if (t <= f.t0 || t >= f.t1) continue
        const bits = (t - f.t0) / T
        expect(Math.abs(bits - Math.round(bits)), `edge at ${t}`).toBeLessThan(1e-6)
      }
    }
    // frames never overlap: each one starts after the previous stop bit
    for (let k = 1; k < fixed.frames.length; k++) {
      expect(fixed.frames[k].t1 - fixed.frames[k].t0).toBeCloseTo(10 * T, 12)
      expect(fixed.frames[k].t0).toBeGreaterThanOrEqual(fixed.frames[k - 1].t1 - 1e-12)
    }

    // the measured shortest pulse is one bit
    const m = measureEdges(tr)
    expect(m.high!.min).toBeCloseTo(T, 9)

    // the VCD of this capture carries every edge
    const vcd = toVcd(cap)
    expect(vcd.split('\n').filter((l) => /^[01x]!$/.test(l)).length).toBe(tr.times.length + 1)
  })
})

/**
 * PS1 5 V → 5V pin, GND → top− rail, board 3V3 → top+ rail; AT24C02 at
 * f40 (A0 f40, A1 f41, A2 f42, GND f43 / SDA e43, SCL e42, WP e41, VCC
 * e40) with A0..A2 and WP tied low; PB6 → SCL, PB7 → SDA, 4.7 kΩ pull-ups
 * to 3V3 (the circuit of tests/mcu/stm32f1/i2c-firmware.test.ts).
 */
function eepromWorld(eepromId: string): CircuitLayout {
  let n = 0
  const wires: Wire[] = []
  const wire = (from: string, to: string) => wires.push({ id: `w${++n}`, from, to })
  wire('PS1:+', tap('5V'))
  wire('PS1:-', 'top-0')
  wire(tap('GND3'), 'top-1')
  wire(tap('3V3_1'), 'top+0')
  wire('a40', 'top+5') // VCC
  wire('j43', 'top-5') // GND
  wire('j40', 'top-6') // A0
  wire('j41', 'top-7') // A1
  wire('j42', 'top-8') // A2
  wire('a41', 'top-9') // WP low: writable
  wire('a42', tap('PB6')) // SCL
  wire('a43', tap('PB7')) // SDA
  const comps: ComponentInstance[] = [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    BP,
    { id: eepromId, type: 'at24c02', at: 'f40' },
    { id: 'R1', type: 'resistor', holes: ['b42', 'top+6'], params: { resistance: 4700 } },
    { id: 'R2', type: 'resistor', holes: ['b43', 'top+7'], params: { resistance: 4700 } },
  ]
  return { version: 1, name: 'i2c decoder bench', components: comps, wires }
}

/** Run `elf` until the UART report satisfies `done`; logic channels on PB6 / PB7. */
function runI2c(elf: string, eepromId: string, done: (text: string) => boolean, limit: number) {
  const co = new SimulationCoordinator()
  co.load(eepromWorld(eepromId), 1)
  co.setFirmware('U1', load(elf))
  co.setLogicChannels([
    { index: 0, label: 'SCL', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PB6' } },
    { index: 1, label: 'SDA', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PB7' } },
  ])
  let text = ''
  while (co.time < limit && !done(text)) {
    co.advance(0.01)
    for (const u of co.frame().uart) if (u.port === 'USART1') text += String.fromCharCode(...u.bytes)
  }
  const cap = logic(co)
  expect(cap.overflow).toBe(false)
  const scl = cap.traces.find((t) => t.index === 0)!
  const sda = cap.traces.find((t) => t.index === 1)!
  return { text, cap, r: decodeI2c(scl, sda, {}, cap.t1) }
}

describe.skipIf(!available || !existsSync(I2C_SCAN_ELF))('real firmware: I2C decoder on hal-i2c-scan PB6/PB7', () => {
  it('decodes the 112-address scan: every address once, W, STOP; only 0x50 ACKs (= the UART report)', { timeout: 180_000 }, () => {
    eraseAt24c02('EEDEC1')
    const { text, r } = runI2c(I2C_SCAN_ELF, 'EEDEC1', (t) => t.includes('scan done'), 1.5)
    expect(text).toBe('I2C1 scan 0x08-0x77\r\nfound 0x50\r\nscan done 1\r\n')
    expect(r.annotations.filter((a) => a.kind === 'error')).toEqual([])
    expect(r.transactions.map((t) => t.address)).toEqual(Array.from({ length: 0x78 - 0x08 }, (_, i) => 0x08 + i))
    expect(r.transactions.every((t) => !t.read && t.stopped && t.bytes.length === 0 && !t.tenBit)).toBe(true)
    // the decoder's ACK view equals what the firmware reported
    const acked = r.transactions.filter((t) => t.addressAck).map((t) => t.address)
    const reported = [...text.matchAll(/found 0x([0-9A-F]{2})/g)].map((m) => parseInt(m[1], 16))
    expect(acked).toEqual(reported)
    expect(r.annotations.filter((a) => a.row === 'transfers')[0].text).toBe('W 0x08 NACK')
  })
})

describe.skipIf(!available || !existsSync(I2C_EEPROM_ELF))('real firmware: I2C decoder on hal-i2c-eeprom PB6/PB7', () => {
  it('decoded page writes and the read-back carry exactly the bytes stored in the AT24C02', { timeout: 180_000 }, () => {
    eraseAt24c02('EEDEC2')
    const { text, r } = runI2c(I2C_EEPROM_ELF, 'EEDEC2', (t) => /eeprom ok|mismatch|error|not found/.test(t), 2)
    expect(text).toContain('eeprom ok')
    expect(r.annotations.filter((a) => a.kind === 'error')).toEqual([])
    const mem = at24c02Contents('EEDEC2')
    const atEeprom = r.transactions.filter((t) => t.address === 0x50 && t.addressAck)
    // page writes: word address + payload, as stored
    const writes = atEeprom.filter((t) => !t.read && t.bytes.length > 1)
    expect(writes.map((t) => t.bytes[0])).toEqual([0x1c, 0x20, 0x28])
    for (const t of writes) {
      expect(t.acks.every(Boolean)).toBe(true)
      expect(t.bytes.slice(1)).toEqual(Array.from(mem.slice(t.bytes[0], t.bytes[0] + t.bytes.length - 1)))
    }
    // 16-byte reads: the erased "before" dump, then the read-backs (blocking
    // and interrupt-driven) = A0..AF; the master NACKs the last byte
    const full = atEeprom.filter((t) => t.read && t.bytes.length === 16)
    expect(full.length).toBeGreaterThanOrEqual(3)
    expect(full[0].bytes).toEqual(Array(16).fill(0xff))
    for (const t of full.slice(1)) expect(t.bytes).toEqual(Array.from({ length: 16 }, (_, i) => 0xa0 + i))
    for (const t of full) {
      expect(t.acks.slice(0, 15).every(Boolean)).toBe(true)
      expect(t.acks[15]).toBe(false)
    }
    // ACK polling while the EEPROM writes its page: address-only transfers NACKed
    expect(atEeprom.length).toBeLessThan(r.transactions.filter((t) => t.address === 0x50).length)
  })
})
