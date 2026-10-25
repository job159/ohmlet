/**
 * Communication & memory modules with REAL firmware (firmware/dist/hal-*.elf,
 * ST HAL v1.1.9) on the simulated Blue Pill inside the SimulationCoordinator,
 * on circuits wired the way a user would wire them on the breadboard: Blue
 * Pill U1 at h10 powered from a 5 V bench supply, the module placed beside
 * it, every connection a wire between holes. Assertions read what the
 * firmware prints over its UART (coordinator UART listener — the exact
 * bytes the USART shifted out), the modules' virtual serial ports and the
 * device telemetry. Nothing is injected into MCU registers.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadFirmwareFile } from '../../src/mcu/loader'
import type { FirmwareImage } from '../../src/mcu/firmware'
import '../../src/mcu/all'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import { checkBoardTap as tap } from '../../src/sim/coordinator/checks'
import type { CircuitLayout, ComponentInstance, ParamValue, Wire } from '../../src/model/types'
import { eraseW25q, w25qContents } from '../../src/sim/models/comm-flash'
import { eraseSdImage } from '../../src/sim/models/comm-sd'
import { resetHc05 } from '../../src/sim/models/comm.model'
import type { Esp01Module, Hc05Module, Max485Module } from '../../src/sim/models/comm.model'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '../../firmware/dist')
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

// ------------------------------------------------------------------ bench

let seq = 0
const w = (from: string, to: string): Wire => ({ id: `w${++seq}`, from, to })
const mod = (id: string, type: string, at: string, params?: Record<string, ParamValue>): ComponentInstance =>
  params ? { id, type, at, params } : { id, type, at }
const leads = (id: string, type: string, holes: string[], params?: Record<string, ParamValue>): ComponentInstance =>
  params ? { id, type, holes, params } : { id, type, holes }

/**
 * Blue Pill U1 at h10 (headers in rows h and c), bench supply PS1 5 V into
 * its 5V pin, GND on the top− rail, the board's 3.3 V on the top+ rail, the
 * bottom rails as 5 V (bot+) and GND (bot−).
 */
function bench(parts: ComponentInstance[], wires: Wire[], opts: { bot3v3?: boolean } = {}): CircuitLayout {
  return {
    version: 1,
    name: 'comm firmware bench',
    components: [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }, { id: 'U1', type: 'stm32_bluepill', at: 'h10' }, ...parts],
    wires: [
      w('PS1:+', tap('5V')),
      w('PS1:-', 'top-0'),
      w(tap('GND3'), 'top-1'),
      w(tap('3V3_1'), 'top+0'),
      opts.bot3v3 ? w('top+2', 'bot+0') : w('i27', 'bot+0'), // i27: the Blue Pill 5V strip
      w('top-2', 'bot-0'),
      ...wires,
    ],
  }
}

/** Collects every UART byte (MCU USARTs and module ports) with its time. */
class Uarts {
  readonly bytes = new Map<string, { b: number; t: number }[]>()
  constructor(co: SimulationCoordinator) {
    co.addUartListener((id, port, byte, t) => {
      const k = `${id}/${port}`
      let a = this.bytes.get(k)
      if (!a) this.bytes.set(k, (a = []))
      a.push({ b: byte & 0xff, t })
    })
  }
  text(key: string): string {
    return String.fromCharCode(...(this.bytes.get(key) ?? []).map((x) => x.b))
  }
  clear(key: string): void {
    this.bytes.delete(key)
  }
}

/** Advance in slices until `done()` or `limit` seconds of simulated time. */
function runUntil(co: SimulationCoordinator, done: () => boolean, limit: number, slice = 5e-3): void {
  const end = co.time + limit
  while (!done() && co.time < end) co.advance(slice)
}

function world(layout: CircuitLayout, fw: string): { co: SimulationCoordinator; u: Uarts } {
  const co = new SimulationCoordinator()
  const u = new Uarts(co)
  co.load(layout, 1)
  co.setFirmware('U1', image(fw))
  return { co, u }
}

const overvoltage = (co: SimulationCoordinator) => co.issues().filter((i) => /exceeds|not 5 V tolerant/.test(i.message))
const errors = (co: SimulationCoordinator) => co.issues().filter((i) => i.level === 'error')

// ================================================================= CH340

describe('hal-ch340: USART2 echo through a CH340 USB-to-TTL adapter (virtual COM port)', () => {
  // CH340 at a35 (row a): GND a35, 3V3 a36, 5V a37, TXD a38, RXD a39, DTR a40
  const ch340 = (params: Record<string, ParamValue>) =>
    bench(
      [mod('CH1', 'usb_uart_ch340', 'a35', params)],
      [w('e35', 'top-35'), w('e38', tap('PA3')), w('e39', tap('PA2'))],
    )

  it('banner on the COM port, typed lines echoed back; 3.3 V jumper → no overvoltage on PA3', { timeout: 120_000 }, () => {
    const { co, u } = world(ch340({ logic: '3.3V', baud: '115200' }), 'hal-ch340')
    runUntil(co, () => u.text('CH1/COM').includes('\n'), 0.3)
    expect(u.text('CH1/COM')).toBe('CH340 echo on USART2 (115200 8N1)\r\n')
    // the MCU's own USART2 sent exactly those bytes; the adapter decoded them from the PA2 waveform
    expect(u.text('U1/USART2')).toBe(u.text('CH1/COM'))
    const tMcu = u.bytes.get('U1/USART2')!.at(-1)!.t
    const tCom = u.bytes.get('CH1/COM')!.at(-1)!.t
    // decoded at the middle of the stop bit, half a bit before the USART reports its stop bit done
    expect(tMcu - tCom).toBeGreaterThan(0)
    expect(tMcu - tCom).toBeLessThan(1 / 115200)
    u.clear('CH1/COM')
    co.uartSend('CH1', 'COM', new TextEncoder().encode('hello ohmlet\r'))
    runUntil(co, () => u.text('CH1/COM').endsWith('\n'), 0.05, 1e-3)
    expect(u.text('CH1/COM')).toBe('echo 1: hello ohmlet\r\n')
    co.uartSend('CH1', 'COM', new TextEncoder().encode('second\n'))
    runUntil(co, () => u.text('CH1/COM').endsWith('second\r\n'), 0.05, 1e-3)
    expect(u.text('CH1/COM')).toBe('echo 1: hello ohmlet\r\necho 2: second\r\n')
    const tele = co.telemetry().components.CH1
    expect(tele.values?.framingErrors).toBe(0)
    expect(tele.values?.rxBytes).toBeGreaterThan(50)
    // TXD at the jumper's 3.3 V: PA3 (not 5 V tolerant) stays within its rating
    expect(overvoltage(co)).toEqual([])
    expect(errors(co)).toEqual([])
    const frame = co.frame(true)
    expect(frame.serialPorts).toEqual([{ componentId: 'CH1', name: 'COM', config: expect.objectContaining({ baud: 115200 }) }])
  })

  it('a COM port opened at the wrong baud shows garbage; the 5 V jumper drives PA3 above its rating', { timeout: 120_000 }, () => {
    const { co, u } = world(ch340({ logic: '5V', baud: '9600' }), 'hal-ch340')
    co.advance(0.1)
    const got = u.text('CH1/COM')
    expect(got.length).toBeGreaterThan(0)
    expect(got).not.toContain('CH340 echo')
    expect(co.telemetry().components.CH1.values?.framingErrors).toBeGreaterThan(0)
    // the adapter's 5 V TXD on PA3: the board model flags it (a real STM32 pin would be overstressed)
    co.uartSend('CH1', 'COM', new TextEncoder().encode('x\r'))
    co.advance(0.01)
    expect(overvoltage(co).some((i) => /PA3/.test(i.message))).toBe(true)
  })
})

// ================================================================= HC-05

describe('hal-hc05: AT dialogue, AT+RESET into data mode, the paired phone on the BT port', () => {
  beforeEach(() => resetHc05('BT1'))

  // HC-05 standing in row e at col 40: STATE e40, RXD e41, TXD e42, GND e43, VCC e44, EN e45
  const layout = (phone: boolean) =>
    bench(
      [mod('BT1', 'hc05_bt', 'e40', { phone }), leads('R1', 'resistor', ['c45', 'top+45'], { resistance: 10000 })],
      [
        w('d43', 'top-43'), // GND
        w('a44', 'i27'), // VCC from the Blue Pill 5V strip
        w('d41', tap('PA2')), // MCU TX → module RXD
        w('d42', tap('PA3')), // module TXD → MCU RX
        w('d45', tap('PB0')), // EN (10 kΩ pull-up R1 to 3.3 V)
        w('d40', tap('PB1')), // STATE
      ],
    )

  it('AT answers at 38400, name / UART stored, phone link at 9600 in both directions', { timeout: 120_000 }, () => {
    const { co, u } = world(layout(true), 'hal-hc05')
    runUntil(co, () => /phone connected .* ms\)\r\n/.test(u.text('U1/USART1')), 1.0)
    const rep = u.text('U1/USART1')
    expect(rep).toContain('HC-05 test\r\nAT ok (try 1)\r\n')
    expect(rep).toContain('AT+VERSION? -> +VERSION:2.0-20100601 OK\r\n')
    expect(rep).toContain('AT+NAME=OHMLET -> OK\r\n')
    expect(rep).toContain('AT+NAME? -> +NAME:OHMLET OK\r\n')
    expect(rep).toContain('AT+UART=9600,0,0 -> OK\r\n')
    expect(rep).toContain('AT+UART? -> +UART:9600,0,0 OK\r\n')
    expect(rep).toContain('AT+ROLE? -> +ROLE:0 OK\r\n')
    expect(rep).toContain('AT+PSWD? -> +PSWD:1234 OK\r\n')
    expect(rep).toContain('AT+RESET -> OK\r\n')
    expect(rep).toMatch(/phone connected \(STATE high after (9\d|10\d) ms\)\r\n/)
    const bt = co.digitalDevice('BT1') as Hc05Module
    expect(bt.mode).toBe('data')
    expect(bt.settings.name).toBe('OHMLET')
    runUntil(co, () => u.text('BT1/BT').includes('\n'), 0.1)
    expect(u.text('BT1/BT')).toBe('hello phone\r\n')
    // the phone (terminal on the BT port) talks back
    co.uartSend('BT1', 'BT', new TextEncoder().encode('ping\r\n'))
    runUntil(co, () => u.text('BT1/BT').includes('you said'), 0.1, 1e-3)
    co.advance(0.02)
    expect(u.text('BT1/BT')).toBe('hello phone\r\nyou said: ping\r\n')
    expect(u.text('U1/USART1').endsWith('phone: ping\r\n')).toBe(true)
    // TXD high level comes from the module's 3.3 V rail, so PA3 is not overstressed
    expect(overvoltage(co)).toEqual([])
    expect(errors(co)).toEqual([])
    expect(co.telemetry().components.BT1.values?.connected).toBe(1)
  })

  it('without a phone link STATE stays low and the firmware says so', { timeout: 120_000 }, () => {
    const { co, u } = world(layout(false), 'hal-hc05')
    runUntil(co, () => /(no phone \(STATE low\)|phone connected .* ms\))\r\n/.test(u.text('U1/USART1')), 1.6)
    expect(u.text('U1/USART1')).toContain('no phone (STATE low)\r\n')
  })
})

// =============================================================== RS-485

describe('hal-rs485: two MAX485 modules on one bus, USART1 ↔ USART3 ping-pong', () => {
  // M1 (node A) at h34: RO h34, RE h35, DE h36, DI h37 / VCC c34, B c35, A c36, GND c37
  // M2 (node B) at h40: RO h40, RE h41, DE h42, DI h43 / VCC c40, B c41, A c42, GND c43
  const layout = (p1: Record<string, ParamValue> = {}, p2: Record<string, ParamValue> = {}) =>
    bench(
      [mod('M1', 'max485_module', 'h34', p1), mod('M2', 'max485_module', 'h40', p2)],
      [
        // node A
        w('j34', tap('PA10')),
        w('i35', 'i36'),
        w('j36', tap('PA8')),
        w('j37', tap('PA9')),
        w('a34', 'bot+34'),
        w('a37', 'top-37'),
        // node B
        w('j40', tap('PB11')),
        w('i41', 'i42'),
        w('j42', tap('PB12')),
        w('j43', tap('PB10')),
        w('a40', 'bot+40'),
        w('a43', 'top-43'),
        // the bus: A–A, B–B
        w('b36', 'b42'),
        w('b35', 'b41'),
      ],
    )

  it('three PING / PONG rounds; no contention, the two R7 terminate the bus', { timeout: 180_000 }, () => {
    const { co, u } = world(layout(), 'hal-rs485')
    runUntil(co, () => /rs485 (ok|FAILED)/.test(u.text('U1/USART2')), 0.5)
    const rep = u.text('U1/USART2')
    expect(rep).toBe(
      'RS-485 ping-pong: A=USART1 (DE PA8) <-> B=USART3 (DE PB12), 115200 8N1\r\n' +
        "round 1: B got 'PING 1', A got 'PONG 1'\r\n" +
        "round 2: B got 'PING 2', A got 'PONG 2'\r\n" +
        "round 3: B got 'PING 3', A got 'PONG 3'\r\n" +
        'rs485 ok\r\n',
    )
    const m1 = co.digitalDevice('M1') as Max485Module
    // the driver saw both terminations in parallel: ≈ 60 Ω between A and B
    expect(m1.loadOhms).toBeGreaterThan(50)
    expect(m1.loadOhms).toBeLessThan(70)
    expect(Math.abs(m1.lastVod)).toBeGreaterThan(1.5) // RS-485 VOD ≥ 1.5 V into 54 Ω
    expect(co.issues().filter((i) => /RS-485/.test(i.message))).toEqual([])
    // RO is a 5 V output into the 5 V-tolerant PA10 / PB11: no overvoltage
    expect(overvoltage(co)).toEqual([])
  })

  it('both R7 removed: still works on the breadboard but the bus is reported unterminated', { timeout: 180_000 }, () => {
    const { co, u } = world(layout({ termination: false }, { termination: false }), 'hal-rs485')
    runUntil(co, () => /rs485 (ok|FAILED)/.test(u.text('U1/USART2')), 0.5)
    expect(u.text('U1/USART2')).toContain('rs485 ok\r\n')
    expect(co.issues().some((i) => /RS-485 bus is not terminated/.test(i.message))).toBe(true)
  })
})

// ================================================================ W25Q32

describe('hal-w25q: JEDEC ID, sector erase, page program and read back on a W25Q32', () => {
  beforeEach(() => eraseW25q('F1'))

  // W25Q32 at e40: CS e40, DO e41, WP e42, GND e43, DI e44, CLK e45, HOLD e46, VCC e47
  const layout = () =>
    bench(
      [mod('F1', 'w25q32_flash', 'e40')],
      [
        w('d40', tap('PA4')),
        w('d41', tap('PA6')),
        w('d42', 'top+42'),
        w('d43', 'top-43'),
        w('d44', tap('PA7')),
        w('d45', tap('PA5')),
        w('d46', 'top+46'),
        w('d47', 'top+47'),
      ],
    )

  it('prints the datasheet ID, a ≈ 45 ms sector erase and "w25q ok"; the array holds the pattern', { timeout: 180_000 }, () => {
    w25qContents('F1').fill(0x00, 0x1000, 0x1010) // old data in the test sector
    const { co, u } = world(layout(), 'hal-w25q')
    runUntil(co, () => /w25q (ok|FAILED)/.test(u.text('U1/USART1')), 0.5)
    const rep = u.text('U1/USART1')
    expect(rep).toContain('W25Q32 test (SPI1 9 MHz mode 0, CS PA4)\r\nJEDEC ID EF 40 16\r\nSR1 0x00\r\n')
    expect(rep).toContain('before: 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00\r\n')
    const erase = /sector erase: busy (\d+) ms/.exec(rep)
    expect(erase).not.toBeNull()
    expect(Number(erase![1])).toBeGreaterThanOrEqual(45)
    expect(Number(erase![1])).toBeLessThanOrEqual(47)
    expect(rep).toMatch(/page program 64 bytes: busy for \d+ status reads\r\n/)
    expect(rep).toContain('read back ok\r\nw25q ok\r\n')
    const mem = w25qContents('F1')
    expect(Array.from(mem.subarray(0x1000, 0x1004))).toEqual([1, 4, 7, 10])
    expect(mem[0x1040]).toBe(0xff) // erased, not programmed
    expect(overvoltage(co)).toEqual([])
    expect(errors(co)).toEqual([])
  })
})

// ============================================================== micro-SD

describe('hal-sdcard: SPI-mode init, CSD, MBR and FAT boot sector of the simulated card', () => {
  beforeEach(() => eraseSdImage('SD1'))

  // SD module at e40: GND e40, VCC e41, MISO e42, MOSI e43, SCK e44, CS e45 (5 V supply)
  const layout = (card: string) =>
    bench(
      [mod('SD1', 'sd_card_spi', 'e40', { card })],
      [
        w('d40', 'top-40'),
        w('a41', 'i27'),
        w('d42', tap('PA6')),
        w('d43', tap('PA7')),
        w('d44', tap('PA5')),
        w('d45', tap('PA4')),
      ],
    )

  it('SDHC 4 GB: v2, ACMD41, OCR CCS, 4096 MiB, MBR partition and the FAT32 volume', { timeout: 180_000 }, () => {
    const { co, u } = world(layout('sdhc'), 'hal-sdcard')
    runUntil(co, () => /sd (ok|FAILED)/.test(u.text('U1/USART1')), 0.6)
    const rep = u.text('U1/USART1')
    expect(rep).toContain('SD card SPI test (SPI1, CS PA4)\r\nCMD0: idle (R1 0x01)\r\nCMD8: v2 card, echo 0x1AA\r\n')
    const tries = /ACMD41: ready after (\d+) tries/.exec(rep)
    expect(tries).not.toBeNull()
    expect(Number(tries![1])).toBeGreaterThan(10) // the card needs 25 ms
    expect(rep).toContain('OCR 0xC0FF8000: SDHC (block addresses)\r\n')
    expect(rep).toContain('CSD v2: 4096 MiB\r\n')
    expect(rep).toContain('MBR: partition 1 type 0x0C at LBA 8192, 8380416 sectors\r\n')
    expect(rep).toContain('FAT32 volume "OHMLET SD": 512 B/sector, 64 sectors/cluster, 32 reserved, 2 FATs x 1023 sectors, root cluster 2\r\n')
    expect(rep.endsWith('sd ok\r\n')).toBe(true)
    const tele = co.telemetry().components.SD1.values
    expect(tele?.ready).toBe(1)
    expect(tele?.blocksRead).toBe(2)
    // MISO swings to the module's 3.3 V rail: PA6 (not 5 V tolerant) is fine on a 5 V module
    expect(overvoltage(co)).toEqual([])
    expect(errors(co)).toEqual([])
  })

  it('SDSC 128 MB: byte addressing, CSD v1 and a FAT16 volume', { timeout: 180_000 }, () => {
    const { co, u } = world(layout('sdsc'), 'hal-sdcard')
    runUntil(co, () => /sd (ok|FAILED)/.test(u.text('U1/USART1')), 0.6)
    const rep = u.text('U1/USART1')
    expect(rep).toContain('OCR 0x80FF8000: SDSC (byte addresses)\r\n')
    expect(rep).toContain('CSD v1: 128 MiB\r\n')
    expect(rep).toContain('MBR: partition 1 type 0x06 at LBA 2048, 260096 sectors\r\n')
    expect(rep).toMatch(/FAT16 volume "OHMLET SD": 512 B\/sector, 8 sectors\/cluster, 1 reserved, 2 FATs x \d+ sectors, root entries 512\r\n/)
    expect(rep.endsWith('sd ok\r\n')).toBe(true)
  })
})

// ============================================================== PCF8574

describe('hal-pcf8574: LED chaser on P0–P6 and a button on P7 through the I/O expander', () => {
  // PCF8574 at h40: P0..P7 h40..h47; GND c41, VCC c42, SDA c43, SCL c44, INT c45
  // LEDs: 3.3 V (bot+) → LED → strip 50+i → 330 Ω → Pi strip; P7 → push-button → GND
  const layout = () => {
    const parts: ComponentInstance[] = [mod('X1', 'pcf8574_module', 'h40')]
    const wires: Wire[] = [w('a41', 'top-41'), w('a42', 'top+42'), w('a43', tap('PB7')), w('a44', tap('PB6'))]
    for (let i = 0; i < 7; i++) {
      parts.push(leads(`D${i}`, 'led', [`bot+${20 + i}`, `j${50 + i}`], { color: 'red' }))
      parts.push(leads(`R${i}`, 'resistor', [`i${50 + i}`, `i${40 + i}`], { resistance: 330 }))
    }
    parts.push({ id: 'SW1', type: 'pushbutton', at: 'f58', params: { pressed: false } })
    wires.push(w('j47', 'j58'), w('j60', 'bot-40'))
    return bench(parts, wires, { bot3v3: true })
  }
  const lit = (co: SimulationCoordinator) =>
    [0, 1, 2, 3, 4, 5, 6].filter((i) => (co.telemetry().components[`D${i}`].ledBrightness ?? 0) > 0.1)

  it('one LED at a time, advancing every 100 ms; the button on P7 is read back', { timeout: 180_000 }, () => {
    const { co, u } = world(layout(), 'hal-pcf8574')
    runUntil(co, () => u.text('U1/USART1').includes('released'), 0.3)
    expect(u.text('U1/USART1')).toBe('PCF8574 chaser P0-P6, button P7 (I2C1 0x20)\r\nP7 button released (port 0xFE)\r\n')
    // sample in the middle of the next steps: exactly one LED, P0 → P1 → P2 …
    co.advance(0.05)
    const seen: number[][] = []
    for (let k = 0; k < 8; k++) {
      seen.push(lit(co))
      co.advance(0.1)
    }
    for (const s of seen) expect(s.length).toBe(1)
    const order = seen.map((s) => s[0])
    for (let k = 1; k < order.length; k++) expect(order[k]).toBe((order[k - 1] + 1) % 7)
    // press: the next read shows P7 low
    co.setRuntimeParam('SW1', 'pressed', true)
    runUntil(co, () => u.text('U1/USART1').includes('pressed'), 0.3)
    expect(u.text('U1/USART1')).toMatch(/P7 button pressed \(port 0x[0-7][0-9A-F]\)\r\n$/)
    co.setRuntimeParam('SW1', 'pressed', false)
    runUntil(co, () => (u.text('U1/USART1').match(/released/g) ?? []).length >= 2, 0.3)
    expect(u.text('U1/USART1')).not.toContain('mismatch')
    expect(errors(co)).toEqual([])
  })
})

// ================================================================= ESP-01

describe('hal-esp01: CH_PD enable, ROM banner skipped, AT subset — and no Wi-Fi', () => {
  // ESP-01 at e40 on 3.3 V: GND e40, GPIO2 e41, GPIO0 e42, RXD e43, TXD e44, CH_PD e45, RST e46, VCC e47
  const layout = () =>
    bench(
      [mod('E1', 'esp01', 'e40')],
      [
        w('d40', 'top-40'),
        w('d47', 'top+47'), // VCC from the Blue Pill 3.3 V rail
        w('d43', tap('PA2')), // MCU TX → ESP RXD
        w('d44', tap('PA3')), // ESP TXD → MCU RX
        w('d45', tap('PB0')), // CH_PD
      ],
    )

  it('ready after the module boot, AT / AT+GMR / AT+CWMODE? answered, joining a network fails', { timeout: 180_000 }, () => {
    const { co, u } = world(layout(), 'hal-esp01')
    runUntil(co, () => /esp01 (ok|FAILED)\r\n/.test(u.text('U1/USART1')), 1.0)
    const rep = u.text('U1/USART1')
    expect(rep.startsWith('ESP-01 test (USART2 115200 8N1, CH_PD on PB0)\r\nready after ')).toBe(true)
    const ready = /ready after (\d+) ms/.exec(rep)
    // ROM banner at 74880 baud first, then "ready" ESP_BOOT_S after CH_PD rose
    expect(Number(ready![1])).toBeGreaterThanOrEqual(250)
    expect(Number(ready![1])).toBeLessThan(270)
    expect(rep).toContain(
      'ATE0 -> OK\r\nAT -> OK\r\nAT+GMR -> AT version:1.7.4.0(May 11 2020 19:13:04)\r\nAT+CWMODE? -> +CWMODE:1 OK\r\nAT+CWJAP -> ERROR\r\nesp01 ok\r\n',
    )
    // the module's TX line carried the 74880-baud banner before "ready" (garbage at 115200, read by USART2)
    expect((u.bytes.get('U1/USART2') ?? []).length).toBeGreaterThan(20)
    const esp = co.digitalDevice('E1') as Esp01Module
    expect(esp.mode).toBe('at')
    expect(co.frame(false).log.some((l) => /ESP-01: Wi-Fi is not simulated/.test(l.message))).toBe(true)
    expect(overvoltage(co)).toEqual([])
    expect(errors(co)).toEqual([])
  })
})
