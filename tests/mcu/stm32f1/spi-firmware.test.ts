/**
 * REAL firmware on REAL circuits through the SimulationCoordinator:
 *  - firmware/dist/hal-spi-595.elf: SPI1 (PA5 SCK, PA7 MOSI) + PA4 RCLK
 *    into a 74HC595 DIP-16 whose QA…QH drive 8 red LEDs through 220 Ω to
 *    GND — the chaser must light the LEDs one after the other, 100 ms each
 *    (LED brightness from the analog solve);
 *  - firmware/dist/hal-spi-loopback.elf: SPI1 full duplex with a jumper
 *    from PA7 (MOSI) to PA6 (MISO) — four passes (modes 0/3, LSB first,
 *    16-bit, hardware CRC) must come back intact; without the jumper the
 *    first pass reports the mismatch.
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
import { componentPinHoles, formatHole } from '../../../src/model/breadboard'
import { CATALOG } from '../../../src/model/catalog'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../../../firmware/dist')

function image(name: string): FirmwareImage {
  const res = loadFirmwareFile(`${name}.elf`, new Uint8Array(readFileSync(join(DIST, `${name}.elf`))))
  if (!res.ok) throw new Error(res.error)
  return res.image
}

const BP: ComponentInstance = { id: 'U1', type: 'stm32_bluepill', at: 'h10' }
function tap(pin: string): string {
  const entry = CATALOG[BP.type]
  const h = componentPinHoles(BP, entry)?.[entry.pins.indexOf(pin)]
  if (!h || h.kind !== 'strip') throw new Error(pin)
  return formatHole({ ...h, row: h.row === 'c' ? 'a' : 'j' })
}

function bench(): { comps: ComponentInstance[]; wires: Wire[]; w: (a: string, b: string) => void } {
  let n = 0
  const wires: Wire[] = []
  const w = (from: string, to: string) => {
    wires.push({ id: `w${++n}`, from, to })
  }
  w('PS1:+', tap('5V'))
  w('PS1:-', 'top-0')
  w(tap('GND3'), 'top-1')
  w(tap('3V3_1'), 'top+0')
  w('top-2', 'bot-0') // ground on the bottom rail too
  return { comps: [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }, BP], wires, w }
}

const Q = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH']

/**
 * 74HC595 (U2) at f35 — DIP-16: QB f35 … QH f41, GND f42, QH' e42, SRCLR e41,
 * SRCLK e40, RCLK e39, OE e38, SER e37, QA e36, VCC e35. LED i (D1 = QA …
 * D8 = QH) via 220 Ω on its own strip in columns 46…53.
 */
function chaserWorld(): CircuitLayout {
  const { comps, wires, w } = bench()
  comps.push({ id: 'U2', type: '74hc595', at: 'f35' })
  w('a35', 'top+3') // VCC 3.3 V
  w('j42', 'bot-3') // GND
  w('a41', 'top+4') // SRCLR high
  w('a38', 'top-4') // OE low
  w('a40', tap('PA5')) // SRCLK ← SCK
  w('a37', tap('PA7')) // SER ← MOSI
  w('a39', tap('PA4')) // RCLK ← PA4
  // QA (col 36, upper strip)
  comps.push({ id: 'R1', type: 'resistor', holes: ['b36', 'b46'], params: { resistance: 220 } })
  comps.push({ id: 'D1', type: 'led', holes: ['c46', 'top-10'], params: { color: 'red' } })
  // QB…QH (cols 35…41, lower strip)
  for (let i = 1; i < 8; i++) {
    const col = 34 + i
    comps.push({ id: `R${i + 1}`, type: 'resistor', holes: [`j${col}`, `j${46 + i}`], params: { resistance: 220 } })
    comps.push({ id: `D${i + 1}`, type: 'led', holes: [`i${46 + i}`, `bot-${10 + i}`], params: { color: 'red' } })
  }
  return { version: 1, name: '595 chaser', components: comps, wires }
}

function readUart(co: SimulationCoordinator, sink: { text: string }): void {
  for (const u of co.frame().uart) if (u.port === 'USART1') sink.text += String.fromCharCode(...u.bytes)
}

describe('hal-spi-595.elf: 74HC595 + 8 LEDs', () => {
  it('lights QA → QB → … → QH → QA, one LED at a time, 100 ms per step; SCK at exactly 4.5 MHz', { timeout: 300_000 }, () => {
    const co = new SimulationCoordinator()
    co.load(chaserWorld(), 1)
    co.setFirmware('U1', image('hal-spi-595'))
    co.setLogicChannels([
      { index: 0, label: 'RCLK', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA4' } },
      { index: 1, label: 'SCK', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PA5' } },
    ])
    const out = { text: '' }
    // boot and the first latch
    const rclkRises = (): number[] => {
      const q = co.query({ kind: 'logic', t0: 0, t1: co.time })
      if (q.kind !== 'logic') throw new Error('query')
      const tr = q.capture.traces.find((t) => t.label === 'RCLK')!
      return Array.from(tr.times).filter((_, i) => tr.levels[i] === 1)
    }
    while (co.time < 1 && rclkRises().length === 0) {
      co.advance(0.005)
      readUart(co, out)
    }
    expect(out.text).toBe('74HC595 chaser 10 Hz\r\n')
    const first = rclkRises()[0]
    expect(first).toBeGreaterThan(0)
    // sample every step in its middle: exactly one LED lit, in QA…QH order
    for (let k = 0; k < 10; k++) {
      co.advance(first + k * 0.1 + 0.05 - co.time)
      const tele = co.telemetry()
      const b = Array.from({ length: 8 }, (_, i) => tele.components[`D${i + 1}`]?.ledBrightness ?? NaN)
      const lit = k % 8
      for (let i = 0; i < 8; i++) {
        if (i === lit) expect(b[i], `step ${k}: ${Q[i]} lit`).toBeGreaterThan(0.3)
        else expect(b[i], `step ${k}: ${Q[i]} dark`).toBeLessThan(0.01)
      }
      expect(tele.components.U2?.values?.latch).toBe(1 << lit)
    }
    // latches 100 ms apart from the second on (the first follows the banner at once; then the
    // deadline-based loop runs on HAL tick boundaries: same code path → same latency)
    const rises = rclkRises()
    expect(rises.length).toBeGreaterThanOrEqual(10)
    expect(rises[1] - rises[0]).toBeLessThanOrEqual(0.1)
    for (let i = 2; i < rises.length; i++) expect(Math.abs(rises[i] - rises[i - 1] - 0.1)).toBeLessThan(2e-6)
    // SCK: 8 pulses per transfer, half period = 8 PCLK2 cycles = 111.1 ns
    const q = co.query({ kind: 'logic', t0: rises[2] - 50e-6, t1: rises[2] })
    if (q.kind !== 'logic') throw new Error('query')
    const sck = q.capture.traces.find((t) => t.label === 'SCK')!
    const times = Array.from(sck.times)
    expect(times.length).toBe(16)
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(8 / 72e6, 12)
    expect(co.issues().filter((i) => i.level === 'error')).toEqual([])
  })
})

describe('hal-spi-loopback.elf', () => {
  function run(jumper: boolean) {
    const { comps, wires, w } = bench()
    if (jumper) w(tap('PA7'), tap('PA6'))
    const co = new SimulationCoordinator()
    co.load({ version: 1, name: 'spi loopback', components: comps, wires }, 1)
    co.setFirmware('U1', image('hal-spi-loopback'))
    const out = { text: '' }
    while (co.time < 1 && !/spi loopback ok|mismatch|HAL status/.test(out.text)) {
      co.advance(0.005)
      readUart(co, out)
    }
    co.advance(0.01)
    readUart(co, out)
    return out.text
  }

  it('with PA7 wired to PA6: every pass comes back intact (modes 0/3, LSB first, 16-bit, CRC)', { timeout: 120_000 }, () => {
    const text = run(true)
    expect(text).toMatch(
      /^SPI1 loopback \(PA7 MOSI -> PA6 MISO\)\r\nmode 0: 64 bytes ok\r\nmode 3 lsb: 64 bytes ok\r\n16-bit: 32 words ok\r\ncrc: 64 bytes ok, crc 0x[0-9A-F]{2}\r\nspi loopback ok\r\n$/,
    )
  })

  it('without the jumper MISO is not driven: the first pass reports a mismatch', { timeout: 120_000 }, () => {
    const text = run(false)
    expect(text).toMatch(/^SPI1 loopback \(PA7 MOSI -> PA6 MISO\)\r\nmode 0: mismatch at byte \d+: sent 0x[0-9A-F]{2} got 0x[0-9A-F]{2}\r\n$/)
  })
})
