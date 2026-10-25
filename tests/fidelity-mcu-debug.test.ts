/**
 * MCU debug facts the inspector and the instruments asked for (UX round):
 *
 *  - McuDebugState.lrSymbol — the function LR returns into; none for an
 *    EXC_RETURN value (0xFFFFFFF1 / F9 / FD) or the reset value; shown next
 *    to LR in the register rows (RegisterRows);
 *  - McuDebugState.clocked → McuFrameInfo.clocked — the blocks the firmware
 *    switched on (RCC AHBENR / APB2ENR / APB1ENR, plus EXTI / IWDG / RTC /
 *    DBGMCU once enabled), in support-table order; the 周邊 tab's
 *    「只看韌體用到的」 filter (usedPeripheralFilter) is on by default once
 *    anything beyond the reset set is on;
 *  - McuDebugState.afioMapr → McuFrameInfo.mapr — AFIO_MAPR (SWJ_CFG reads 0),
 *    which pinFunctionContext / activePinFunction (H10) and the logic
 *    analyzer's channel picker use to name remapped USART / I²C / SPI / TIM
 *    functions.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { __setLangForTests, hasTranslation, t } from '../src/i18n'
import fidelity from '../src/i18n/zh-TW/fidelity'
import { getEntry } from '../src/model/catalog'
import type { CircuitLayout, SimTelemetry } from '../src/model/types'
import type { McuDebugState } from '../src/mcu/mcu-api'
import type { FirmwareImage } from '../src/mcu/firmware'
import { loadFirmwareFile } from '../src/mcu/loader'
import type { Stm32f103 } from '../src/mcu/stm32f1/soc'
import '../src/mcu/all'
import { SimulationCoordinator } from '../src/sim/coordinator/coordinator'
import { checkBoardTap as tap } from '../src/sim/coordinator/checks'
import type { McuFrameInfo } from '../src/sim/coordinator/api'
import { RegisterRows, usedPeripheralFilter } from '../src/ui/embedded/McuPanel'
import { activePinFunction, pinFunctionContext } from '../src/ui/embedded/instruments/pin-function'
import { channelPickerGroups } from '../src/ui/embedded/instruments/channel-picker'
import { AFIO, EXTI, IWDG, RCC_APB1ENR, RCC_APB2ENR, makeSoc, w32 } from './mcu/stm32f1/helpers'
import { MAINLAND_TERMS, englishLeft } from './i18n/zh-check'

beforeAll(() => __setLangForTests('zh-TW'))
afterAll(() => __setLangForTests('zh-TW'))

const HERE = dirname(fileURLToPath(import.meta.url))

/** Firmware image with two functions: main (0x08000100, 64 B) and delay (0x08000140, 32 B). */
function symbolImage(): FirmwareImage {
  const v = new Uint8Array(0x200)
  const dv = new DataView(v.buffer)
  dv.setUint32(0, 0x20005000, true)
  dv.setUint32(4, 0x08000101, true)
  dv.setUint16(0x100, 0xe7fe, true)
  return {
    name: 'symbols.bin',
    format: 'bin',
    segments: [{ addr: 0x08000000, data: v }],
    entry: null,
    symbols: [
      { name: 'main', addr: 0x08000100, size: 0x40, kind: 'func' },
      { name: 'delay', addr: 0x08000140, size: 0x20, kind: 'func' },
    ],
    sha256: '0'.repeat(64),
    fileSize: v.length,
    warnings: [],
  }
}

/** A SoC with symbols whose stub core reports LR = `lr`. */
function socWithLr(lr: number): Stm32f103 {
  const { soc, core } = makeSoc()
  const r = soc.loadFirmware(symbolImage())
  if (!r.ok) throw new Error(r.errors.join('; '))
  soc.reset('power-on')
  const base = core.registers.bind(core)
  core.registers = () => {
    const regs = base()
    regs.r[14] = lr >>> 0
    regs.r[15] = 0x08000150 // inside delay()
    return regs
  }
  return soc
}

// ---------------------------------------------------------------------------
// LR symbol
// ---------------------------------------------------------------------------

describe('McuDebugState.lrSymbol', () => {
  it('names the function LR returns into (Thumb bit ignored)', () => {
    const ds = socWithLr(0x08000111).debugState()
    expect(ds.pcSymbol).toBe('delay')
    expect(ds.lrSymbol).toBe('main')
  })

  it('is absent for EXC_RETURN values, the reset value and addresses outside every function', () => {
    for (const lr of [0xfffffff1, 0xfffffff9, 0xfffffffd, 0xffffffff, 0x08001001]) {
      expect(socWithLr(lr).debugState().lrSymbol, lr.toString(16)).toBeUndefined()
    }
  })

  it('the register rows show it next to LR (and 例外返回 for an EXC_RETURN value)', () => {
    const dbg = (lr: number): McuDebugState => socWithLr(lr).debugState()
    const html = renderToStaticMarkup(createElement(RegisterRows, { dbg: dbg(0x08000111) }))
    expect(html).toContain('0x08000111')
    expect(html).toMatch(/<span class="emb-pc-sym"[^>]*translate="no"[^>]*>main<\/span>/)
    expect(html).toContain('返回位址（LR）位於 main')
    const exc = renderToStaticMarkup(createElement(RegisterRows, { dbg: dbg(0xfffffff9) }))
    expect(exc).toContain('例外返回')
    expect(exc).toContain('EXC_RETURN：核心正在例外處理常式中')
    // no symbol and no EXC_RETURN: the plain cell, as before
    const plain = renderToStaticMarkup(createElement(RegisterRows, { dbg: dbg(0xffffffff) }))
    expect(plain).not.toContain('emb-pc-sym')
  })
})

// ---------------------------------------------------------------------------
// clock-enabled peripherals
// ---------------------------------------------------------------------------

describe('McuDebugState.clocked (the blocks the firmware switched on)', () => {
  it('reset: only the core every firmware uses; then RCC enable bits, EXTI, IWDG in table order', () => {
    const { soc } = makeSoc({ firmware: true })
    const names = soc.support.map((s) => s.name)
    expect(soc.debugState().clocked).toEqual(['Memory map', 'RCC', 'FLASH'])
    // GPIOA + AFIO + USART1 (APB2), TIM2 (APB1)
    w32(soc, RCC_APB2ENR, (1 << 2) | (1 << 0) | (1 << 14))
    w32(soc, RCC_APB1ENR, 1 << 0)
    w32(soc, EXTI + 0x00, 1 << 0) // EXTI_IMR line 0
    w32(soc, IWDG + 0x00, 0xcccc) // IWDG_KR: start
    const on = soc.debugState().clocked!
    for (const n of ['Memory map', 'RCC', 'FLASH', 'GPIO', 'AFIO', 'USART1', 'TIM2', 'EXTI', 'IWDG']) expect(on, n).toContain(n)
    for (const n of ['USART2', 'I2C1', 'SPI1', 'ADC1', 'DMA1', 'RTC', 'CAN', 'PWR']) expect(on, n).not.toContain(n)
    // support-table order, no duplicates
    expect([...on]).toEqual(names.filter((n) => on.includes(n)))
    // unchanged inputs → the same (cached) list
    expect(soc.debugState().clocked).toBe(on)
    // a reset turns every gate (and the watchdog) off again
    soc.reset('pin')
    expect(soc.debugState().clocked).toEqual(['Memory map', 'RCC', 'FLASH'])
  })

  it('the 周邊 filter: offered and on by default once firmware enabled something, the user choice wins', () => {
    expect(usedPeripheralFilter(null, null)).toMatchObject({ available: false, on: false })
    expect(usedPeripheralFilter(['Memory map', 'RCC', 'FLASH'], null)).toMatchObject({ available: false, on: false })
    const used = usedPeripheralFilter(['Memory map', 'RCC', 'FLASH', 'GPIO', 'USART1'], null)
    expect(used.available).toBe(true)
    expect(used.on).toBe(true)
    expect([...used.names]).toEqual(['Memory map', 'RCC', 'FLASH', 'GPIO', 'USART1'])
    expect(usedPeripheralFilter(['Memory map', 'RCC', 'GPIO'], false).on).toBe(false)
    expect(usedPeripheralFilter(['Memory map', 'RCC', 'GPIO'], true).on).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AFIO_MAPR
// ---------------------------------------------------------------------------

describe('McuDebugState.afioMapr → McuFrameInfo.mapr → H10 / channel picker', () => {
  it('the SoC reports AFIO_MAPR without SWJ_CFG', () => {
    const { soc } = makeSoc({ firmware: true })
    expect(soc.debugState().afioMapr).toBe(0)
    w32(soc, RCC_APB2ENR, 1) // AFIOEN
    w32(soc, AFIO + 0x04, (2 << 24) | (1 << 2) | (1 << 1)) // SWJ_NOJTAG + USART1 + I2C1 remap
    expect(soc.debugState().afioMapr).toBe((1 << 2) | (1 << 1))
  })

  it('the coordinator publishes clocked + mapr of real firmware in every MCU frame', { timeout: 60_000 }, () => {
    const res = loadFirmwareFile('hal-blink.elf', new Uint8Array(readFileSync(join(HERE, '../firmware/dist/hal-blink.elf'))))
    if (!res.ok) throw new Error(res.error)
    let seq = 0
    const w = (from: string, to: string) => ({ id: `w${++seq}`, from, to })
    const layout: CircuitLayout = {
      version: 1,
      name: 'blink',
      components: [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }, { id: 'U1', type: 'stm32_bluepill', at: 'h10' }],
      wires: [w('PS1:+', tap('5V')), w('PS1:-', 'top-0'), w(tap('GND3'), 'top-1')],
    }
    const co = new SimulationCoordinator()
    co.load(layout, 1)
    co.setFirmware('U1', res.image)
    co.advance(0.02)
    let info = co.frame(true).mcus.find((m) => m.componentId === 'U1')!
    expect(info.state).toBe('running')
    // HAL_Init + the GPIO clocks of hal-blink (its MSP also enables AFIO for SWJ_NOJTAG)
    expect(info.clocked).toEqual(expect.arrayContaining(['Memory map', 'RCC', 'FLASH', 'GPIO', 'AFIO']))
    expect(info.clocked).not.toContain('USART1')
    expect(info.mapr).toBe(0) // __HAL_AFIO_REMAP_SWJ_NOJTAG touches SWJ_CFG only (reads 0)
    // a remap the firmware would program (USART1 → PB6 / PB7) reaches the frame
    const mcu = co.mcu('U1') as Stm32f103
    mcu.bus.write32(AFIO + 0x04, 1 << 2)
    info = co.frame(true).mcus.find((m) => m.componentId === 'U1')!
    expect(info.mapr).toBe(1 << 2)
    expect(pinFunctionContext(info).mapr).toBe(1 << 2)
  })

  it('pinFunctionContext: a frame\'s USARTs and MAPR, never a guessed MAPR', () => {
    expect(pinFunctionContext(undefined)).toEqual({ uarts: undefined })
    expect(pinFunctionContext({ uarts: [], mapr: Number.NaN })).toEqual({ uarts: [] })
    const usart1 = [{ name: 'USART1', config: { enabled: true } }]
    const fns = (pin: string) => getEntry('stm32_bluepill')!.pinInfo!.find((p) => p.pin === pin)!.functions ?? []
    expect(activePinFunction(fns('PB6'), 'af', pinFunctionContext({ uarts: usart1, mapr: 1 << 2 }))).toBe('USART1_TX')
    expect(activePinFunction(fns('PB8'), 'af-od', pinFunctionContext({ uarts: [], mapr: 1 << 1 }))).toBe('I2C1_SCL')
    expect(activePinFunction(fns('PB4'), 'af', pinFunctionContext({ mapr: 1 }))).toBe('SPI1_MISO')
    expect(activePinFunction(fns('PB6'), 'af-od', pinFunctionContext({ uarts: usart1, mapr: 0 }))).toBe('I2C1_SCL')
  })

  it('the channel picker offers the remapped bus (and not the abandoned default pins) once MAPR is known', () => {
    const layout: CircuitLayout = {
      version: 1,
      name: 'remap',
      components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }],
      wires: [],
    }
    const telemetry: SimTelemetry = {
      time: 1,
      netVoltages: {},
      issues: [],
      components: { U1: { pinVoltages: {}, mcu: { state: 'running', pc: 0, hclkHz: 72e6, cycles: 0, pinModes: { PB6: 'af', PB7: 'in' } } } },
    }
    const frame = (mapr?: number): McuFrameInfo => ({
      componentId: 'U1',
      state: 'running',
      firmware: 'x.elf',
      pc: 0,
      hclkHz: 72e6,
      cycles: 0,
      realtime: 1,
      uarts: [{ name: 'USART1', config: { enabled: true, baud: 115200, dataBits: 8, parity: 'none', stopBits: 1 } }],
      ...(mapr !== undefined ? { mapr } : {}),
    })
    const groups = (mapr?: number) =>
      channelPickerGroups({ layout, telemetry, mcus: { U1: frame(mapr) }, channels: [], tr: t, modeLabel: (m) => m })
    const values = (mapr?: number) => groups(mapr).flatMap((g) => g.options.map((o) => o.value))
    const labels = (mapr?: number) => groups(mapr).flatMap((g) => g.options.map((o) => o.label))
    // MAPR known with the USART1 remap: PB6/PB7 offered, PA9/PA10 not
    expect(values(1 << 2)).toContain('bus|U1|USART1-remap')
    expect(values(1 << 2)).not.toContain('bus|U1|USART1')
    expect(labels(1 << 2).some((l) => /PB6.*USART1_TX/.test(l))).toBe(true)
    // MAPR known without remaps, or unknown: PB6 in AF is I2C1's pin (the default mapping), never USART1
    for (const m of [0, undefined]) {
      expect(values(m)).toContain('bus|U1|I2C1')
      expect(values(m)).not.toContain('bus|U1|USART1-remap')
      expect(labels(m).some((l) => /PB6.*USART1_TX/.test(l))).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// zh-TW
// ---------------------------------------------------------------------------

describe('the fidelity dictionary', () => {
  it('every entry is translated, Taiwan usage, no English left', () => {
    for (const [src, zh] of Object.entries(fidelity)) {
      expect(hasTranslation(src), src).toBe(true)
      // {placeholders} are filled with numbers / names at run time
      expect(englishLeft(zh.replace(/\{\w+\}/g, ' ')), `${src} → ${zh}`).toEqual([])
      for (const term of MAINLAND_TERMS) expect(zh.includes(term), `${zh} contains ${term}`).toBe(false)
    }
  })
})
