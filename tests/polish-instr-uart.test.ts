/**
 * Release polish (instruments) — the UART terminal's bytes on the wire, in the
 * analysis panels:
 *  - TERMINAL-ORIGIN: 解碼結果 has no 「終端機 → U1 USART1 … 直接送入」 rows any
 *    more (nothing produces them: the terminal's USB-TTL adapter puts real
 *    frames on PA10). What was typed is an ordinary 「UART · PA10 RX」 row,
 *    before the firmware's 「UART · PA9 TX "echo: …"」 — checked on the real
 *    hal-uart-hello firmware; the instruments-clarity replay asserts the same
 *    in the browser;
 *  - REVEAL-SENT: 「在邏輯分析儀中檢視」 on a line the terminal sent (its local
 *    echo) centres the analyzer on its RX frames — on the pin the
 *    coordinator reports in McuFrameInfo.uartRx (AFIO-remap aware), marker A
 *    on the first start bit.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../src/mcu/all'
import { __setLangForTests } from '../src/i18n'
import { loadFirmwareFile } from '../src/mcu/loader'
import type { CircuitLayout } from '../src/model/types'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import type { LogicCapture, LogicChannelConfig, McuFrameInfo, UartRxInfo } from '../src/sim/coordinator/api'
import { decodeUart } from '../src/instruments/decoders/uart'
import { useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { decodedFrames, frameDisplayText, runDecoder, type DecodedFrame, type LogicDecoderConfig } from '../src/ui/embedded/logic-decoders'
import { ackedAddresses, frameFilter, statusText } from '../src/ui/embedded/instruments/DecodeResults'
import { charTime, lineWire, revealLineTitle, revealUartLine, sentLineWindow } from '../src/ui/embedded/instruments/uart-reveal'
import { useLogicReveal } from '../src/ui/embedded/probe-actions'
import { getToasts } from '../src/ui/kit/toasts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LONG = { timeout: 120_000 }
const LINE_8N1 = { enabled: true, baud: 115200, dataBits: 8 as const, parity: 'none' as const, stopBits: 1 as const }
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

interface Env {
  layout: CircuitLayout
  instruments: { logicChannels: LogicChannelConfig[]; logicView: { decoders: LogicDecoderConfig[] } }
}
const uartHello = (): Env => JSON.parse(readFileSync(join(ROOT, 'examples/embedded/uart-hello.ohmlet.json'), 'utf8')) as Env

/** hal-uart-hello on the example's circuit, with the example's PA9 TX / PA10 RX channels. */
function bench() {
  const env = uartHello()
  const fw = loadFirmwareFile('hal-uart-hello.elf', new Uint8Array(readFileSync(join(ROOT, 'firmware/dist/hal-uart-hello.elf'))))
  if (!fw.ok) throw new Error(fw.error)
  const co = new SimulationCoordinator()
  co.load(env.layout, 1)
  co.setFirmware('U1', fw.image)
  co.setLogicChannels(env.instruments.logicChannels)
  let text = ''
  co.addUartListener((_id, port, byte) => {
    if (port === 'USART1') text += String.fromCharCode(byte & 0xff)
  })
  const until = (cond: () => boolean, tMax: number) => {
    while (co.time < tMax && !cond()) co.advance(0.001)
    return cond()
  }
  const capture = (t0: number, t1: number): LogicCapture => {
    const r = co.query({ kind: 'logic', t0, t1 })
    if (r.kind !== 'logic') throw new Error('query')
    return r.capture
  }
  return { env, co, until, capture, text: () => text }
}

describe('TERMINAL-ORIGIN: the terminal’s bytes are ordinary RX rows', () => {
  it('hal-uart-hello: 「UART · PA10 RX "hi ohmlet\\n" OK」 comes before 「UART · PA9 TX "echo: hi ohmlet\\r\\n" OK」', LONG, () => {
    const b = bench()
    expect(b.until(() => b.text().includes('Hello from STM32F103!'), 0.4)).toBe(true)
    const tSend = b.co.time
    b.co.uartSend('U1', 'USART1', new Uint8Array(ascii('hi ohmlet\n')))
    expect(b.until(() => b.text().includes('echo: hi ohmlet\r\n'), tSend + 0.1)).toBe(true)
    const cap = b.capture(Math.max(0, tSend - 0.01), b.co.time)
    const runs = b.env.instruments.logicView.decoders.map((c) => runDecoder(cap, c)).filter((r) => r !== null)
    const frames = decodedFrames(runs)
    const rx = frames.find((f) => f.channel === 1 && frameDisplayText(f).includes('hi ohmlet'))
    const echo = frames.find((f) => f.channel === 0 && frameDisplayText(f).includes('echo: hi ohmlet'))
    expect(rx && frameDisplayText(rx)).toBe('"hi ohmlet\\n"')
    expect(echo && frameDisplayText(echo)).toBe('"echo: hi ohmlet\\r\\n"')
    expect(rx!.t0).toBeLessThan(echo!.t0)
    // the status reads like any decoded row (DecodedFrame has no terminal origin any more)
    __setLangForTests('zh-TW')
    expect(statusText(rx!)).toBe('OK')
    expect(frameFilter(rx!, 'all') && !frameFilter(rx!, 'error') && !frameFilter(rx!, 'ack')).toBe(true)
  })

  it('the 解碼結果 table has no terminal-origin branch left (rows, summary, status, filters)', () => {
    const src = readFileSync(join(ROOT, 'src/ui/embedded/instruments/DecodeResults.tsx'), 'utf8')
    for (const gone of ['.origin', 'sent straight in', 'is-sent', "tc('Terminal', 'results')", "tc('Sent', 'terminal')", 'sent from the terminal', 'Terminal → {id} {port}']) {
      expect(src, gone).not.toContain(gone)
    }
    // an I²C NACK is still an error row and an ACK'd address is still listed
    const i2c = (t0: number, text: string, status: DecodedFrame['status']): DecodedFrame => ({ id: `i@${t0}`, instance: 'i2c', decoder: 'I²C', channel: 0, t0, t1: t0, text, status })
    expect(frameFilter(i2c(1, 'Addr 0x08 W', 'nack'), 'error')).toBe(true)
    expect(ackedAddresses([i2c(1, 'Addr 0x3C W', 'ok'), i2c(2, 'Addr 0x08 W', 'nack')])).toEqual(['0x3C'])
  })

  it('the instruments-clarity replay asserts the adapter hint and the real PA10 RX row, never the retired texts', () => {
    const e2e = readFileSync(join(ROOT, 'scripts/ux-e2e/instruments-clarity.mjs'), 'utf8')
    expect(e2e).toContain('輸入的文字會經 USB 轉 TTL 轉接器（3.3 V），以 UART 訊框送上 PA10（115 200 Bd · 8N1）')
    expect(e2e).toContain('UART · PA10 RX')
    expect(e2e).toContain('revealUartLine(')
    expect(e2e).not.toContain('直接送進 U1 USART1（不經 PA10 導線）')
    expect(e2e).not.toMatch(/hasText: '直接送入'/)
  })
})

describe('REVEAL-SENT: 「在邏輯分析儀中檢視」 on a sent line reads the RX wire', () => {
  const rx = (pin: string, port = 'USART1'): UartRxInfo => ({ port, pin, state: 'free', attached: true, queued: 0 })

  const queryLogic = useLab.getState().queryLogic
  beforeEach(() => __setLangForTests('zh-TW'))
  afterEach(() => {
    useLab.setState({ logicChannels: [], mcus: {}, queryLogic })
    useStore.setState({ simTime: 0 })
  })

  it('the wire of a line: received → TX, sent → RX (the coordinator’s pin, remap-aware; TX follows the remap)', () => {
    expect(lineWire('USART1', false)).toEqual({ pin: 'PA9', dir: 'TX' })
    expect(lineWire('USART1', true)).toEqual({ pin: 'PA10', dir: 'RX' })
    expect(lineWire('USART2', true)).toEqual({ pin: 'PA3', dir: 'RX' })
    expect(lineWire('USART3', false)).toEqual({ pin: 'PB10', dir: 'TX' })
    // AFIO_MAPR USART1_REMAP: the coordinator reports PB7 — RX there, TX on PB6
    expect(lineWire('USART1', true, [rx('PB7')])).toEqual({ pin: 'PB7', dir: 'RX' })
    expect(lineWire('USART1', false, [rx('PB7')])).toEqual({ pin: 'PB6', dir: 'TX' })
    expect(lineWire('USART3', true, [rx('PC11', 'USART3')])).toEqual({ pin: 'PC11', dir: 'RX' })
    expect(lineWire('UART4', true)).toBeNull()
  })

  it('the tooltip names the wire; the search window starts at the send', () => {
    expect(revealLineTitle(true, 'PA10')).toBe('把邏輯分析儀對準這一行送上 PA10（RX）的訊框，A 標記放在第一個起始位元')
    expect(revealLineTitle(false)).toBe('把邏輯分析儀對準這一行在 TX 線上的波形，A 標記放在第一個起始位元')
    expect(charTime(LINE_8N1)).toBeCloseTo(10 / 115200, 12)
    const w = sentLineWindow(1.5, 2, 1.5001, LINE_8N1)
    expect(w.from).toBeCloseTo(1.498, 9)
    expect(w.to).toBeCloseTo(1.5001, 9)
    expect(w.ready).toBe(false)
    expect(sentLineWindow(1.5, 2, 2, LINE_8N1)).toMatchObject({ to: 2, ready: true })
    expect(sentLineWindow(1.5, 2, 30, LINE_8N1).to).toBe(11.5)
  })

  it('hal-uart-hello: the sent 「hi ohmlet」 is revealed on PA10 with marker A on its first start bit', LONG, async () => {
    const b = bench()
    expect(b.until(() => b.text().includes('Hello from STM32F103!'), 0.4)).toBe(true)
    const tSend = b.co.time
    b.co.uartSend('U1', 'USART1', new Uint8Array(ascii('hi ohmlet\n')))
    expect(b.until(() => b.text().includes('echo: hi ohmlet\r\n'), tSend + 0.1)).toBe(true)
    // the frames as the analyzer's decoder reads them on PA10
    const pa10 = b.capture(tSend - 0.001, b.co.time).traces.find((x) => x.index === 1)!
    const first = decodeUart(pa10, { baud: 115200 }, b.co.time).frames[0]
    expect(first.value).toBe(0x68)
    // the app's state around the analyzer: the example's circuit and channels, the board's frame info
    const mcu = b.co.frame().mcus.find((m) => m.componentId === 'U1') as McuFrameInfo
    expect(mcu.uartRx?.find((u) => u.port === 'USART1')?.pin).toBe('PA10')
    useStore.setState({ layout: b.env.layout, simTime: b.co.time })
    useLab.setState({ logicChannels: b.env.instruments.logicChannels, mcus: { U1: mcu }, queryLogic: async (t0: number, t1: number) => b.capture(t0, t1) })
    useLab.getState().setLogicView({ decoders: b.env.instruments.logicView.decoders as unknown as Record<string, unknown>[] })
    const before = useLogicReveal.getState().request?.seq ?? 0
    await revealUartLine({ t0: tSend, t1: tSend, bytes: ascii('hi ohmlet'), echo: true }, { componentId: 'U1', port: 'USART1', config: LINE_8N1 })
    const req = useLogicReveal.getState().request!
    expect(req.seq).toBe(before + 1)
    expect(req.marker).toBeCloseTo(first.t0, 9)
    // the window holds the whole line (9 characters + the line feed)
    expect(req.t - req.span / 2).toBeLessThan(first.t0)
    expect(req.t + req.span / 2).toBeGreaterThan(first.t0 + 9 * (10 / 115200))
  })

  it('a sent line whose frames are not on the wire yet says so (and shows the send instant)', LONG, async () => {
    const b = bench()
    expect(b.until(() => b.text().includes('Hello from STM32F103!'), 0.4)).toBe(true)
    const tSend = b.co.time
    const mcu = b.co.frame().mcus.find((m) => m.componentId === 'U1') as McuFrameInfo
    useStore.setState({ layout: b.env.layout, simTime: tSend })
    useLab.setState({ logicChannels: b.env.instruments.logicChannels, mcus: { U1: mcu }, queryLogic: async (t0: number, t1: number) => b.capture(t0, t1) })
    await revealUartLine({ t0: tSend, t1: tSend, bytes: ascii('hello'), echo: true }, { componentId: 'U1', port: 'USART1', config: LINE_8N1 })
    expect(getToasts().at(-1)?.text).toBe('這一行還沒有送上 PA10——讓模擬再跑一下，然後再試一次')
    expect(useLogicReveal.getState().request?.marker).toBeCloseTo(tSend, 9)
  })
})
