/**
 * Release close-out UART-RX, the surfaces: what the terminal and the logic
 * analyzer say now that typed bytes are real frames on the RX wire.
 *
 *  - rxWireNote (src/ui/embedded/instruments/uart-sent.ts), the one line
 *    under the terminal's send box, in zh-TW: the bytes go out on PA10 as
 *    frames at the firmware's settings; 「PA3 已由 CH1 的 TXD 驅動，終端機不
 *    另外送出」 with 「改用 CH1 的 COM 埠」; a module behind a level shifter;
 *    the board's own PA2; a rail; the MCU's own output; a pin the board
 *    lacks; no baud yet; bytes still on their way — canSend follows;
 *  - the REAL coordinator's frame feeds it: ch340-bridge's U1 USART2 reads
 *    exactly the PO's sentence, hal-uart-hello's USART1 the free sentence;
 *  - the old 「直接送入」 note layer is gone from the producers (the
 *    analyzer no longer turns sends into frames or hatched notes, the
 *    terminal no longer says 「直接送進」) — source checks;
 *  - every runtime log line of the adapter translates completely
 *    (messages-close-sim.ts) and the new strings keep no English words.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import { hasMessageTranslation, tMessage } from '../src/i18n/messages'
import '../src/mcu/all'
import { loadFirmwareFile } from '../src/mcu/loader'
import type { CircuitLayout } from '../src/model/types'
import type { UartRxInfo } from '../src/sim/coordinator/api'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { rxPinOf, rxWireNote, USART_RX } from '../src/ui/embedded/instruments/uart-sent'
import zhCloseSim from '../src/i18n/zh-TW/close-sim'
import { bluePillWorld } from './coordinator/worlds'
import { englishLeft } from './i18n/zh-check'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARTS = [
  { id: 'U1', type: 'stm32_bluepill' },
  { id: 'CH1', type: 'usb_uart_ch340' },
  { id: 'BT1', type: 'hc05_bt' },
  { id: 'LS1', type: 'level_shifter_4ch' },
  { id: 'PS1', type: 'power_supply' },
]
const LINE = '115 200 Bd · 8N1'
const info = (p: Partial<UartRxInfo>): UartRxInfo => ({ port: 'USART1', pin: 'PA10', state: 'free', attached: false, queued: 0, ...p })

beforeAll(() => __setLangForTests('zh-TW'))
afterAll(() => __setLangForTests('en'))

describe('the line under the terminal’s send box (rxWireNote)', () => {
  it('a free RX net: the bytes go out on PA10 as UART frames at the firmware’s settings', () => {
    expect(rxWireNote('U1', 'USART1', info({}), LINE, PARTS)).toEqual({
      kind: 'free',
      text: '輸入的文字會經 USB 轉 TTL 轉接器（3.3 V），以 UART 訊框送上 PA10（115 200 Bd · 8N1）',
      canSend: true,
      tone: 'info',
    })
    expect(rxWireNote('U1', 'USART1', info({ attached: true, queued: 12 }), LINE, PARTS)?.text).toBe('正在送上 PA10……還有 12 個位元組（115 200 Bd · 8N1）')
    // nothing known yet (no frame from a running world): no line at all
    expect(rxWireNote('U1', 'USART1', undefined, LINE, PARTS)).toBeNull()
  })

  it('a module’s TXD drives the net: the PO’s sentence, sending off, the module’s own port offered', () => {
    const n = rxWireNote('U1', 'USART2', info({ port: 'USART2', pin: 'PA3', state: 'driven', by: { componentId: 'CH1', pin: 'TXD', port: 'COM' } }), LINE, PARTS)
    expect(n).toEqual({
      kind: 'driven',
      text: 'PA3 已由 CH1 的 TXD 驅動，終端機不另外送出',
      canSend: false,
      tone: 'warn',
      offer: { componentId: 'CH1', port: 'COM', label: '改用 CH1 的 COM 埠' },
    })
    const via = rxWireNote('U1', 'USART2', info({ port: 'USART2', pin: 'PA3', state: 'driven', by: { componentId: 'BT1', pin: 'TXD', via: 'LS1', port: 'BT' } }), LINE, PARTS)
    expect(via?.text).toBe('PA3 已由 BT1 的 TXD（經 LS1）驅動，終端機不另外送出')
    expect(via?.offer?.label).toBe('改用 BT1 的 BT 埠')
    // the board's own USART2 TX on PA10 (lesson a3): nothing to offer
    const own = rxWireNote('U1', 'USART1', info({ state: 'driven', by: { componentId: 'U1', pin: 'PA2' } }), LINE, PARTS)
    expect(own).toEqual({ kind: 'driven', text: 'PA10 已由 U1 的 PA2 驅動，終端機不另外送出', canSend: false, tone: 'warn' })
    // a supply terminal reads as a person reads it (H1 pin names, no raw ref)
    expect(rxWireNote('U1', 'USART1', info({ state: 'driven', by: { componentId: 'PS1', pin: '+' } }), LINE, PARTS)?.text).toBe('PA10 已由 PS1 的正端驅動，終端機不另外送出')
  })

  it('rail, the MCU’s own output, a pin the board lacks, no baud yet: the reason, and no sending', () => {
    expect(rxWireNote('U1', 'USART1', info({ state: 'rail' }), LINE, PARTS)).toEqual({ kind: 'rail', text: 'PA10 直接接在電源或 GND 上，終端機不另外送出', canSend: false, tone: 'warn' })
    expect(rxWireNote('U1', 'USART1', info({ state: 'output' }), LINE, PARTS)?.text).toBe('PA10 目前是 U1 的輸出腳（韌體沒有把它當成 USART1 的 RX），終端機不另外送出')
    expect(rxWireNote('U1', 'USART2', info({ port: 'USART2', pin: 'PD6', state: 'absent' }), LINE, PARTS)?.text).toBe('USART2 的 RX 在 PD6，這塊板子沒有引出這支腳，終端機無法送出')
    expect(rxWireNote('U1', 'USART1', info({ state: 'absent' }), LINE, PARTS)?.text).toBe('PA10 沒有接到任何地方，終端機無法送出')
    const noBaud = rxWireNote('U1', 'USART1', info({}), null, PARTS)
    expect(noBaud).toEqual({ kind: 'no-baud', text: 'U1 還沒有設定 USART1 的鮑率，終端機不知道要用多快的速度送出', canSend: false, tone: 'warn' })
  })

  it('English stays readable (the sources)', () => {
    __setLangForTests('en')
    try {
      expect(rxWireNote('U1', 'USART2', info({ port: 'USART2', pin: 'PA3', state: 'driven', by: { componentId: 'CH1', pin: 'TXD', port: 'COM' } }), LINE, PARTS)?.text).toBe(
        'PA3 is driven by CH1’s TXD — the terminal does not send on it',
      )
    } finally {
      __setLangForTests('zh-TW')
    }
  })

  it('the RX pin: the coordinator’s remap-aware report first, else the reset mapping', () => {
    expect(USART_RX).toEqual({ USART1: 'PA10', USART2: 'PA3', USART3: 'PB11' })
    expect(rxPinOf('USART1', undefined)).toBe('PA10')
    expect(rxPinOf('USART1', [info({ pin: 'PB7' })])).toBe('PB7')
  })
})

describe('the real coordinator’s frame says the same thing', () => {
  const fw = (name: string) => {
    const r = loadFirmwareFile(`${name}.elf`, new Uint8Array(readFileSync(join(ROOT, 'firmware/dist', `${name}.elf`))))
    if (!r.ok) throw new Error(r.error)
    return r.image
  }
  const run = (layout: CircuitLayout, name: string, seconds: number) => {
    const co = new SimulationCoordinator()
    co.load(layout, 1)
    co.setFirmware('U1', fw(name))
    for (let k = 0; k < seconds / 0.005; k++) co.advance(0.005)
    return co
  }

  it('ch340-bridge U1 USART2: 「PA3 已由 CH1 的 TXD 驅動，終端機不另外送出」 + 「改用 CH1 的 COM 埠」', { timeout: 60_000 }, () => {
    const layout = JSON.parse(readFileSync(join(ROOT, 'examples/embedded/ch340-bridge.ohmlet.json'), 'utf8')).layout as CircuitLayout
    const co = run(layout, 'hal-ch340', 0.05)
    const m = co.frame().mcus.find((x) => x.componentId === 'U1')!
    const cfg = m.uarts.find((u) => u.name === 'USART2')!.config
    expect(cfg.baud).toBeGreaterThan(0)
    const n = rxWireNote('U1', 'USART2', m.uartRx?.find((u) => u.port === 'USART2'), LINE, layout.components)
    expect(n?.text).toBe('PA3 已由 CH1 的 TXD 驅動，終端機不另外送出')
    expect(n?.offer).toEqual({ componentId: 'CH1', port: 'COM', label: '改用 CH1 的 COM 埠' })
    co.dispose()
  })

  it('hal-uart-hello U1 USART1: the free sentence; after a send the bytes are counted down', { timeout: 60_000 }, () => {
    const layout = bluePillWorld()
    const co = run(layout, 'hal-uart-hello', 0.05)
    const rx = () => co.frame().mcus[0].uartRx?.find((u) => u.port === 'USART1')
    expect(rxWireNote('U1', 'USART1', rx(), LINE, layout.components)?.canSend).toBe(true)
    co.uartSend('U1', 'USART1', new TextEncoder().encode('hello\r'))
    expect(rxWireNote('U1', 'USART1', rx(), LINE, layout.components)?.text).toBe('正在送上 PA10……還有 6 個位元組（115 200 Bd · 8N1）')
    co.advance(0.002)
    expect(rxWireNote('U1', 'USART1', rx(), LINE, layout.components)?.text).toBe('輸入的文字會經 USB 轉 TTL 轉接器（3.3 V），以 UART 訊框送上 PA10（115 200 Bd · 8N1）')
    co.dispose()
  })
})

describe('the 「直接送入」 note layer is retired from its producers', () => {
  const src = (p: string) => readFileSync(join(ROOT, p), 'utf8')
  it('the analyzer no longer turns terminal sends into frames or hatched lane notes; the terminal no longer says 「直接送進」', () => {
    const la = src('src/ui/embedded/LogicAnalyzer.tsx')
    expect(la).not.toContain('useUartSends')
    expect(la).not.toContain('sent straight in, not over')
    expect(la).not.toContain('goes straight into {port}')
    const term = src('src/ui/embedded/UartTerminal.tsx')
    expect(term).not.toContain('Sent straight into')
    expect(term).toContain('rxWireNote(')
  })
})

describe('zh-TW: the adapter’s log lines and the new strings', () => {
  const LOGS = [
    'U1 USART1: the terminal did not send 5 byte(s) — PA10 is driven by U1 PA2',
    'U1 USART2: the terminal did not send 6 byte(s) — PA3 is driven by CH1 TXD',
    'U1 USART2: the terminal did not send 6 byte(s) — PA3 is driven by BT1 TXD through LS1',
    'U1 USART1: the terminal did not send 1 byte(s) — PA10 is wired to a supply rail or ground',
    'U1 USART1: the terminal did not send 1 byte(s) — PA10 is an output of U1 right now, not the USART1 RX',
    'U1 USART1: the terminal did not send 1 byte(s) — PA10 is not connected to anything',
    "U1 USART2: the terminal did not send 2 byte(s) — its RX pin PD6 is not on the board's headers",
    'U1 USART1: the terminal did not send 1 byte(s) — the firmware has not set the USART1 baud rate (BRR) yet',
    'U1 USART1: the terminal did not send 1 byte(s) — PA10 is driven by another output',
    "U1 USART1: the terminal's USB-TTL adapter let go of PA10 — PA10 is driven by CH1 TXD",
    "U1 USART1: the terminal's adapter buffer is full — 12 byte(s) dropped",
  ]
  it('every log line translates completely', () => {
    for (const m of LOGS) {
      expect(hasMessageTranslation(m), m).toBe(true)
      const zh = tMessage(m)
      expect(zh, m).not.toBe(m)
      expect(englishLeft(zh), `${m} → ${zh}`).toEqual([])
    }
    expect(tMessage(LOGS[1])).toBe('U1 USART2：終端機沒有送出這 6 個位元組——PA3 已由 CH1 的 TXD 驅動')
    expect(tMessage(LOGS[9])).toBe('U1 USART1：終端機的 USB 轉 TTL 轉接器已放開 PA10——PA10 已由 CH1 的 TXD 驅動')
  })
  it('every new UI string has a zh-TW text with no English words left', () => {
    for (const [en, zh] of Object.entries(zhCloseSim)) {
      expect(t(en), en).toBe(zh)
      expect(englishLeft(zh.replace(/\{\w+\}/g, ' ')), `${en} → ${zh}`).toEqual([])
    }
  })
})
