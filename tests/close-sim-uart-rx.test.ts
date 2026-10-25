/**
 * Release close-out, the real UART-RX path (src/sim/coordinator/uart-adapter.ts
 * and the TTL adapter block of coordinator.ts): a byte typed in the UART
 * terminal for an MCU USART travels as a real UART frame on the USART's RX
 * pin, driven by the terminal's virtual USB-TTL adapter (3.3 V push-pull,
 * 150 Ω, idle high), and the USART receives it through its normal pin
 * sampling — never through UartTap.send.
 *
 *  - REAL firmware: hal-uart-hello echoes a typed line received through
 *    PA10; the logic analyzer's UART decoder reads the same bytes on PA10
 *    (exact edges, 115200 8N1, one character of idle line after the
 *    adapter is plugged in) and the reply on PA9;
 *  - the adapter at 9600 Bd against the firmware's 115200 Bd: the USART
 *    sets FE exactly where a 115200 Bd receiver sampling the same wire
 *    finds a low stop bit, and the firmware (which drops FE bytes) echoes
 *    nothing;
 *  - lesson a3 (DMA1 ch5 circular + IDLE): bytes typed into USART1 arrive
 *    by DMA and IDLE exactly like USART2's; with the lesson's PA2 → PA10
 *    wire the terminal does not drive PA10 (U1 PA2 drives it);
 *  - a module's TXD (CH340, an HC-05 behind a level shifter), a supply
 *    rail, the MCU's own output: the adapter stays off, the frame says who
 *    drives the net and the module's own port; nothing is overdriven (no
 *    contention issue); a plugged adapter lets go when a driver appears;
 *  - an analog RX net (a resistor + LED on PA10): frames still arrive;
 *  - the remap: AFIO_MAPR moves USART1's RX to PB7;
 *  - pure helpers: frame bits (8N1, 8E1 = M 9 + parity, 7O1), char time.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import '../src/mcu/all'
import { loadFirmwareFile } from '../src/mcu/loader'
import type { FirmwareImage } from '../src/mcu/firmware'
import type { CircuitLayout } from '../src/model/types'
import { decodeUart } from '../src/instruments/decoders/uart'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import type { LogicTrace, UartRxInfo } from '../src/sim/coordinator/api'
import { TTL_ROUT, TTL_VOH, ttlCharTime, ttlFrameBits, ttlLineOf, usartRxPin } from '../src/sim/coordinator/uart-adapter'
import { lessonById } from '../src/lessons'
import { PIN_OUT_PP } from '../src/mcu/pins'
import { FakeMcu } from './coordinator/fake-mcu'
import { bluePillWorld, part, tap, w } from './coordinator/worlds'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LONG = { timeout: 120_000 }

function firmware(name: string): FirmwareImage {
  const res = loadFirmwareFile(`${name}.elf`, new Uint8Array(readFileSync(join(ROOT, 'firmware/dist', `${name}.elf`))))
  if (!res.ok) throw new Error(res.error)
  return res.image
}

/** A coordinator running `fw` on `layout`, with logic channels on U1 pins and a UART transcript per port. */
function bench(layout: CircuitLayout, fw: string, pins: string[] = ['PA9', 'PA10']) {
  const co = new SimulationCoordinator()
  co.load(layout, 1)
  co.setFirmware('U1', firmware(fw))
  co.setLogicChannels(pins.map((pin, index) => ({ index, label: pin, source: { kind: 'mcu-pin', componentId: 'U1', pin } })))
  const text = new Map<string, string>()
  co.addUartListener((id, port, byte) => {
    const k = `${id}/${port}`
    text.set(k, (text.get(k) ?? '') + String.fromCharCode(byte & 0xff))
  })
  const uart = (port: string, id = 'U1') => text.get(`${id}/${port}`) ?? ''
  const until = (cond: () => boolean, tMax: number, step = 0.002): boolean => {
    while (co.time < tMax) {
      if (cond()) return true
      co.advance(step)
    }
    return cond()
  }
  const trace = (index: number, t0 = 0): LogicTrace => {
    const r = co.query({ kind: 'logic', t0, t1: co.time })
    if (r.kind !== 'logic') throw new Error('query')
    const tr = r.capture.traces.find((x) => x.index === index)
    if (!tr) throw new Error(`no trace ${index}`)
    return tr
  }
  // every frame drains the log: keep what each frame brought
  const logs: string[] = []
  const pull = () => {
    const f = co.frame()
    for (const e of f.log) logs.push(e.message)
    return f
  }
  const rx = (port: string): UartRxInfo | undefined => pull().mcus.find((m) => m.componentId === 'U1')?.uartRx?.find((u) => u.port === port)
  const messages = (): string[] => {
    pull()
    return logs
  }
  return { co, uart, until, trace, rx, messages }
}

const enc = (s: string) => new TextEncoder().encode(s)
const text = (frames: { value: number }[]) => frames.map((f) => String.fromCharCode(f.value)).join('')

describe('the terminal’s USB-TTL adapter drives the RX pin with real UART frames', () => {
  it('hal-uart-hello: a typed line arrives through PA10 and is echoed; the decoder reads it on PA10', LONG, () => {
    const b = bench(bluePillWorld(), 'hal-uart-hello')
    expect(b.until(() => b.uart('USART1').includes('Hello from STM32F103!\r\n'), 0.3)).toBe(true)
    // before the first send the adapter is not plugged in: PA10 is free, nothing drives it
    expect(b.rx('USART1')).toEqual({ port: 'USART1', pin: 'PA10', state: 'free', attached: false, queued: 0 })
    const tap1 = b.co.mcu('U1')!.uarts.find((u) => u.name === 'USART1')!
    const viaTap = vi.spyOn(tap1, 'send')
    const tSend = b.co.time
    b.co.uartSend('U1', 'USART1', enc('ohmlet\r'))
    expect(b.rx('USART1')).toMatchObject({ pin: 'PA10', state: 'free', attached: true, queued: 7 })
    expect(b.until(() => b.uart('USART1').includes('echo: ohmlet\r\n'), tSend + 0.1, 0.0005)).toBe(true)
    expect(viaTap).not.toHaveBeenCalled()
    expect(b.rx('USART1')).toMatchObject({ attached: true, queued: 0 })

    // the RX wire: exact edges; the adapter is plugged in at the send and idles one character, then 7 frames
    const rxTrace = b.trace(1, tSend - 1e-3)
    expect(rxTrace.exact).toBe(true)
    const times = Array.from(rxTrace.times)
    const levels = Array.from(rxTrace.levels)
    // (the floating input already read high: the plug-in rise may not be an edge of the MCU's view)
    const firstFall = times[levels.indexOf(0)]
    const charT = 10 / 115200
    expect(firstFall - tSend).toBeCloseTo(charT, 9)
    const dec = decodeUart(rxTrace, { baud: 115200 }, b.co.time)
    expect(text(dec.frames)).toBe('ohmlet\r')
    expect(dec.frames.every((f) => f.framingOk)).toBe(true)
    expect(dec.frames[0].t0).toBeCloseTo(firstFall, 9)
    // back-to-back: each frame starts exactly one character after the previous one
    for (let k = 1; k < dec.frames.length; k++) expect(dec.frames[k].t0 - dec.frames[k - 1].t0).toBeCloseTo(charT, 9)
    // and the echo on PA9 follows the received line
    const txTrace = b.trace(0, tSend)
    expect(text(decodeUart(txTrace, { baud: 115200 }, b.co.time).frames)).toContain('echo: ohmlet\r\n')
    // the line sits at the adapter's 3.3 V between frames (a logic net: resolved exactly)
    const node = b.co.engine!.nodeOf(tap('PA10'))
    expect(b.co.logicNets!.isLogic(node)).toBe(true)
    expect(b.co.logicNets!.voltage(node)).toBeCloseTo(TTL_VOH, 6)
    expect(b.co.issues().filter((i) => /contention/.test(i.message))).toEqual([])
  })

  it('a wrong baud on one side: framing errors exactly where a 115200 Bd receiver finds a low stop bit; nothing is echoed', LONG, () => {
    const b = bench(bluePillWorld(), 'hal-uart-hello')
    expect(b.until(() => b.uart('USART1').includes('Hello from STM32F103!\r\n'), 0.3)).toBe(true)
    // spy on the USART's receive shift register (what its pin sampling decided per frame)
    const usart = (b.co.mcu('U1') as unknown as { block(n: string): unknown }).block('USART1') as {
      deliver(word: number, fe: boolean, noise: boolean, end: number): void
    }
    const got: { word: number; fe: boolean }[] = []
    const deliver = usart.deliver.bind(usart)
    usart.deliver = (word, fe, noise, end) => {
      got.push({ word: word & 0xff, fe })
      deliver(word, fe, noise, end)
    }
    const tSend = b.co.time
    // the terminal side left at 9600 Bd while the firmware listens at 115200 Bd
    b.co.uartSend('U1', 'USART1', enc('hi\r'), { baud: 9600 })
    const char9600 = ttlCharTime({ baud: 9600, dataBits: 8, parity: 'none', stopBits: 1 })
    b.until(() => false, tSend + 4 * char9600 + 0.002, 0.0005)
    expect(got.length).toBeGreaterThan(0)
    expect(got.some((g) => g.fe)).toBe(true)
    // the analyzer's decoder is a second 115200 Bd receiver on the same wire: it agrees frame by frame
    const dec = decodeUart(b.trace(1, tSend), { baud: 115200 }, b.co.time)
    expect(got).toEqual(dec.frames.map((f) => ({ word: f.value, fe: !f.framingOk })))
    // the line itself is clean 9600 Bd: a 9600 Bd decoder reads the typed text
    expect(text(decodeUart(b.trace(1, tSend), { baud: 9600 }, b.co.time).frames)).toBe('hi\r')
    // hal-uart-hello drops bytes received with FE: no echo
    b.until(() => false, b.co.time + 0.01)
    expect(b.uart('USART1')).not.toContain('echo: hi')
  })

  it('line settings: a usable config needs a baud (an unprogrammed BRR gives the adapter nothing to send at)', () => {
    expect(ttlLineOf({ baud: 115200, dataBits: 8, parity: 'none', stopBits: 1 })).toEqual({ baud: 115200, dataBits: 8, parity: 'none', stopBits: 1 })
    expect(ttlLineOf({ baud: 9600, dataBits: 9, parity: 'even', stopBits: 2 })).toEqual({ baud: 9600, dataBits: 9, parity: 'even', stopBits: 2 })
    expect(ttlLineOf({ baud: 0, dataBits: 8, parity: 'none', stopBits: 1 })).toBeNull()
    expect(ttlLineOf(undefined)).toBeNull()
  })

  it('lesson a3: bytes typed into USART1 arrive by DMA1 ch5 + IDLE through PA10; with the PA2 → PA10 wire the terminal does not drive PA10', LONG, () => {
    const l = lessonById('a3-uart-dma')!
    // the start circuit: nothing on PA10 — the terminal plays the external device
    const t = bench(l.start.layout, 'lesson-a3-uart-dma', ['PA10', 'PB0'])
    expect(t.until(() => t.uart('USART1').includes('RX: DMA1 ch5 circular, 32 B ring + IDLE line detection\r\n'), 0.2)).toBe(true)
    t.co.uartSend('U1', 'USART1', enc('hello'))
    expect(t.until(() => /msg #1: .*\r\n/.test(t.uart('USART1')), t.co.time + 0.05, 0.0005)).toBe(true)
    expect(t.uart('USART1')).toMatch(/msg #1: 5 B \[idle\] irq=1 isr=\d+\.\d us: hello\r\n/)
    t.co.uartSend('U1', 'USART1', enc('0123456789abcdefghijklmnopqrstuvwxyzABCD'))
    expect(t.until(() => /msg #2: .*\r\n/.test(t.uart('USART1')), t.co.time + 0.05, 0.0005)).toBe(true)
    // ring position 5 → 45: HT at 16, TC at 32 (the wrap), IDLE at 13
    expect(t.uart('USART1')).toMatch(/msg #2: 40 B \[ht tc idle\] irq=3 isr=\d+\.\d us: 0123456789abcdefghijklmnopqrstuvwxyzABCD\r\n/)
    expect(text(decodeUart(t.trace(0), { baud: 115200 }, t.co.time).frames)).toBe('hello0123456789abcdefghijklmnopqrstuvwxyzABCD')

    // the solution circuit: U1 PA2 (USART2_TX) drives PA10 — the adapter stays off, the lesson runs as before
    const s = bench(l.solution.layout, 'lesson-a3-uart-dma', ['PA10'])
    expect(s.until(() => s.uart('USART1').includes('msg #1: 5 B [idle] irq=1'), 0.2)).toBe(true)
    expect(s.rx('USART1')).toEqual({ port: 'USART1', pin: 'PA10', state: 'driven', by: { componentId: 'U1', pin: 'PA2' }, attached: false, queued: 0 })
    s.co.uartSend('U1', 'USART1', enc('hello'))
    expect(s.messages()).toContain('U1 USART1: the terminal did not send 5 byte(s) — PA10 is driven by U1 PA2')
    expect(s.until(() => s.uart('USART1').includes('msg #3: 40 B [tc ht tc idle] irq=4'), 0.6)).toBe(true)
    expect(s.co.issues().filter((i) => /contention/.test(i.message))).toEqual([])
  })
})

describe('the adapter never fights the circuit', () => {
  const example = (name: string): CircuitLayout =>
    JSON.parse(readFileSync(join(ROOT, 'examples/embedded', `${name}.ohmlet.json`), 'utf8')).layout as CircuitLayout

  it('ch340-bridge: PA3 is driven by CH1 TXD — USART2 is refused (no contention) and CH1’s COM port is offered; COM still works', LONG, () => {
    const b = bench(example('ch340-bridge'), 'hal-ch340', ['PA3'])
    b.until(() => false, 0.05)
    expect(b.rx('USART2')).toEqual({
      port: 'USART2',
      pin: 'PA3',
      state: 'driven',
      by: { componentId: 'CH1', pin: 'TXD', port: 'COM' },
      attached: false,
      queued: 0,
    })
    b.co.uartSend('U1', 'USART2', enc('hello\r'))
    expect(b.messages()).toContain('U1 USART2: the terminal did not send 6 byte(s) — PA3 is driven by CH1 TXD')
    const tRefused = b.co.time
    b.until(() => false, tRefused + 0.005)
    // nothing but CH1 drove PA3 after the refusal: no frame, no contention
    expect(Array.from(b.trace(0, tRefused).times).filter((x) => x >= tRefused)).toEqual([])
    expect(b.co.issues().filter((i) => /contention/.test(i.message))).toEqual([])
    // the module's own port carries the line, as before
    b.co.uartSend('CH1', 'COM', enc('hello ohmlet\r'))
    expect(b.until(() => b.uart('COM', 'CH1').endsWith('echo 1: hello ohmlet\r\n'), b.co.time + 0.1, 0.001)).toBe(true)
  })

  it('hc05-bluetooth: PA3 is driven by BT1 TXD through the level shifter LS1 — refused, BT1’s BT port offered', LONG, () => {
    const b = bench(example('hc05-bluetooth'), 'hal-hc05', ['PA3'])
    b.until(() => false, 0.05)
    expect(b.rx('USART2')).toMatchObject({ pin: 'PA3', state: 'driven', by: { componentId: 'BT1', pin: 'TXD', via: 'LS1', port: 'BT' }, attached: false })
    b.co.uartSend('U1', 'USART2', enc('ping\r\n'))
    expect(b.messages()).toContain('U1 USART2: the terminal did not send 6 byte(s) — PA3 is driven by BT1 TXD through LS1')
  })

  it('a supply rail or an unprogrammed baud: refused with the reason; the frame says the same', LONG, () => {
    // PA10 straight to the top − rail (GND)
    const g = bench(bluePillWorld([], [w(tap('PA10'), 'top-12')]), 'hal-uart-hello')
    g.until(() => g.uart('USART1').includes('Hello'), 0.3)
    expect(g.rx('USART1')).toMatchObject({ pin: 'PA10', state: 'rail', attached: false })
    g.co.uartSend('U1', 'USART1', enc('x'))
    expect(g.messages()).toContain('U1 USART1: the terminal did not send 1 byte(s) — PA10 is wired to a supply rail or ground')
    // hal-blink never sets up USART1: no baud to send at
    const n = bench(bluePillWorld(), 'hal-blink')
    n.until(() => false, 0.05)
    n.co.uartSend('U1', 'USART1', enc('x'))
    expect(n.messages()).toContain('U1 USART1: the terminal did not send 1 byte(s) — the firmware has not set the USART1 baud rate (BRR) yet')
    expect(n.rx('USART1')).toMatchObject({ state: 'free', attached: false })
  })

  it('scripted MCU: the edges reach the RX input at their exact cycles; the MCU’s own output on PA10 is never driven against', () => {
    const HZ = 72e6
    const fakes: FakeMcu[] = []
    const co = new SimulationCoordinator({
      createMcu: () => {
        const f = new FakeMcu(HZ)
        fakes.push(f)
        return f
      },
    })
    co.load(bluePillWorld(), 1)
    co.advance(0.01) // power-up
    const f = fakes[fakes.length - 1]
    expect(f.powered).toBe(true)
    const PA10 = 10
    const tSend = co.time
    co.uartSend('U1', 'USART1', Uint8Array.of(0x55)) // 0x55: every bit cell is an edge
    co.advance(0.001)
    // never through the peripheral
    expect(f.uarts[0].received).toEqual([])
    const T = 1 / 115200
    const t0 = tSend + 10 * T // one character of idle line, then the start bit
    const want = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1].map((level, k) => ({ level, cycle: Math.ceil((t0 + k * T) * HZ - 1e-6) }))
    const got = f.pins.inputs.filter((e) => e.pin === PA10 && e.cycle >= Math.floor(t0 * HZ) - 1)
    const edges = got.filter((e, k) => k === 0 || e.level !== got[k - 1].level).map((e) => ({ level: e.level, cycle: e.cycle }))
    expect(edges.slice(0, 10)).toEqual(want)

    // the firmware turns PA10 into a push-pull output: the adapter lets go at once (no contention)…
    f.setDrive(PA10, PIN_OUT_PP, 0)
    co.advance(0.0001)
    const fr = co.frame()
    expect(fr.mcus[0].uartRx?.find((u) => u.port === 'USART1')).toMatchObject({ pin: 'PA10', state: 'output', attached: false })
    expect(fr.log.map((e) => e.message)).toContain("U1 USART1: the terminal's USB-TTL adapter let go of PA10 — PA10 is an output of U1 right now, not the USART1 RX")
    // …and refuses new bytes while it stays one
    co.uartSend('U1', 'USART1', Uint8Array.of(0x41))
    expect(co.frame().log.map((e) => e.message)).toContain('U1 USART1: the terminal did not send 1 byte(s) — PA10 is an output of U1 right now, not the USART1 RX')
    expect(co.issues().filter((i) => /contention/.test(i.message))).toEqual([])
  })

  it('a plugged adapter lets go when a module’s TXD is wired onto its pin (rebuild) — never contention', LONG, () => {
    const base = bluePillWorld()
    const b = bench(base, 'hal-uart-hello')
    b.until(() => b.uart('USART1').includes('Hello'), 0.3)
    b.co.uartSend('U1', 'USART1', enc('a\r'))
    b.until(() => false, b.co.time + 0.002)
    expect(b.rx('USART1')).toMatchObject({ state: 'free', attached: true })
    // a CH340 at a35: its TXD (e38) wired to PA10 — a real adapter on the same pin
    const withCh: CircuitLayout = {
      ...base,
      components: [...base.components, { id: 'CH1', type: 'usb_uart_ch340', at: 'a35', params: { logic: '3.3V', baud: '115200' } }],
      wires: [...base.wires, w('e35', 'top-27'), w('e38', tap('PA10'))],
    }
    b.co.load(withCh, 2)
    b.until(() => false, b.co.time + 0.005)
    expect(b.rx('USART1')).toMatchObject({ state: 'driven', by: { componentId: 'CH1', pin: 'TXD', port: 'COM' }, attached: false })
    expect(b.messages()).toContain("U1 USART1: the terminal's USB-TTL adapter let go of PA10 — PA10 is driven by CH1 TXD")
    expect(b.co.issues().filter((i) => /contention/.test(i.message))).toEqual([])
    // and CH1's COM port now reaches USART1 through the wire
    b.co.uartSend('CH1', 'COM', enc('via com\r'))
    expect(b.until(() => b.uart('USART1').includes('echo: via com\r\n'), b.co.time + 0.1, 0.001)).toBe(true)
  })

  it('an analog RX net (1 kΩ + LED from PA10 to GND): the frames still arrive, the edges end analog steps', LONG, () => {
    const layout = bluePillWorld(
      [part('R1', 'resistor', ['a45', 'a50'], { resistance: 1000 }), part('D1', 'led', ['b50', 'top-5'], { color: 'red' })],
      [w(tap('PA10'), 'e45')],
    )
    const b = bench(layout, 'hal-uart-hello')
    b.until(() => b.uart('USART1').includes('Hello'), 0.3)
    const node = b.co.engine!.nodeOf(tap('PA10'))
    expect(b.co.logicNets!.isLogic(node)).toBe(false)
    const tSend = b.co.time
    b.co.uartSend('U1', 'USART1', enc('led\r'))
    expect(b.until(() => b.uart('USART1').includes('echo: led\r\n'), tSend + 0.1, 0.0005)).toBe(true)
    expect(text(decodeUart(b.trace(1, tSend), { baud: 115200 }, b.co.time).frames)).toBe('led\r')
    // idle high through the LED load: 3.3 V behind 150 Ω, minus the LED current's drop
    const v = b.co.engine!.voltageOfNode(node)
    expect(v).toBeGreaterThan(3.0)
    expect(v).toBeLessThan(TTL_VOH)
  })
})

describe('pure helpers', () => {
  it('the RX pin of each USART, honouring AFIO_MAPR', () => {
    expect(usartRxPin('USART1')).toBe('PA10')
    expect(usartRxPin('USART2')).toBe('PA3')
    expect(usartRxPin('USART3')).toBe('PB11')
    expect(usartRxPin('USART1', 1 << 2)).toBe('PB7')
    expect(usartRxPin('USART2', 1 << 3)).toBe('PD6')
    expect(usartRxPin('USART3', 1 << 4)).toBe('PC11')
    expect(usartRxPin('USART3', 3 << 4)).toBe('PD9')
    expect(usartRxPin('USART3', 2 << 4)).toBe('PB11') // reserved = no remap
    expect(usartRxPin('UART4')).toBeNull()
  })

  it('frame bits: 8N1, 8E1 (M = 9 with the parity in bit 8), 7O1 (M = 8), char time', () => {
    const l8n1 = { baud: 115200, dataBits: 8 as const, parity: 'none' as const, stopBits: 1 as const }
    expect(ttlFrameBits(0x41, l8n1)).toEqual([0, 1, 0, 0, 0, 0, 0, 1, 0])
    expect(ttlCharTime(l8n1)).toBeCloseTo(10 / 115200, 15)
    // 'A' = 0x41 has two 1s: even parity bit 0, odd parity bit 1
    expect(ttlFrameBits(0x41, { ...l8n1, dataBits: 9, parity: 'even' })).toEqual([0, 1, 0, 0, 0, 0, 0, 1, 0, 0])
    expect(ttlFrameBits(0x41, { ...l8n1, dataBits: 8, parity: 'odd' })).toEqual([0, 1, 0, 0, 0, 0, 0, 1, 1])
    expect(ttlCharTime({ ...l8n1, dataBits: 9, stopBits: 2 })).toBeCloseTo(12 / 115200, 15)
    expect(TTL_ROUT).toBeGreaterThan(50)
    expect(TTL_ROUT).toBeLessThanOrEqual(1000)
  })
})
