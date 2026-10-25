/**
 * RCC (RM0008 ch. 7): reset values, oscillator ready timing, SYSCLK
 * switching rules, the clock tree for the HAL 72 MHz configuration, limit
 * warnings, exact cycle↔time rebasing, peripheral clock gating and resets,
 * CSR reset flags, ready interrupts, backup-domain protection.
 */
import { describe, expect, it } from 'vitest'
import type { Stm32Peripheral } from '../../../src/mcu/stm32f1/periph-api'
import { PERIPHERALS } from '../../../src/mcu/stm32f1/peripherals'
import { Stm32f103 } from '../../../src/mcu/stm32f1/soc'
import {
  clock72,
  FLASH_ACR,
  GPIOA,
  makeSoc,
  PWR,
  r32,
  RCC_AHBENR,
  RCC_APB1ENR,
  RCC_APB2ENR,
  RCC_APB2RSTR,
  RCC_BDCR,
  RCC_CFGR,
  RCC_CIR,
  RCC_CR,
  RCC_CSR,
  runFor,
  set32,
  StubCore,
  w32,
} from './helpers'

const HSERDY = 1 << 17
const PLLRDY = 1 << 25

describe('RCC reset state', () => {
  it('matches RM0008 §7.3 reset values', () => {
    const { soc } = makeSoc()
    expect(r32(soc, RCC_CR) & 0xffff00ff).toBe(0x00000083) // HSION | HSIRDY | HSITRIM = 16
    expect(r32(soc, RCC_CFGR)).toBe(0)
    expect(r32(soc, RCC_CIR)).toBe(0)
    expect(r32(soc, RCC_AHBENR)).toBe(0x14) // SRAMEN | FLITFEN
    expect(r32(soc, RCC_APB2ENR)).toBe(0)
    expect(r32(soc, RCC_APB1ENR)).toBe(0)
    expect(r32(soc, RCC_BDCR)).toBe(0)
    expect(r32(soc, RCC_CSR)).toBe(0x0c000000) // PORRSTF | PINRSTF after power-on
    expect(soc.rcc.sysclk()).toBe(8e6)
    expect(soc.hclkHz).toBe(8e6)
  })

  it('only implemented enable bits stick (medium-density F103)', () => {
    const { soc } = makeSoc()
    w32(soc, RCC_APB2ENR, 0xffffffff)
    expect(r32(soc, RCC_APB2ENR)).toBe(0x5e7d)
    w32(soc, RCC_APB1ENR, 0xffffffff)
    expect(r32(soc, RCC_APB1ENR)).toBe(0x1ae64807)
    w32(soc, RCC_AHBENR, 0xffffffff)
    expect(r32(soc, RCC_AHBENR)).toBe(0x55)
  })
})

describe('oscillators and SYSCLK switching', () => {
  it('HSE becomes ready 1 ms after HSEON, PLL locks 200 µs after PLLON', () => {
    const { soc } = makeSoc()
    set32(soc, RCC_CR, 1 << 16)
    const t0 = soc.time()
    runFor(soc, 0.99e-3)
    expect(r32(soc, RCC_CR) & HSERDY).toBe(0)
    runFor(soc, 0.02e-3)
    expect(r32(soc, RCC_CR) & HSERDY).toBe(HSERDY)
    expect(soc.time() - t0).toBeGreaterThanOrEqual(1e-3)
    w32(soc, RCC_CFGR, (1 << 16) | (7 << 18))
    set32(soc, RCC_CR, 1 << 24)
    runFor(soc, 199e-6)
    expect(r32(soc, RCC_CR) & PLLRDY).toBe(0)
    runFor(soc, 2e-6)
    expect(r32(soc, RCC_CR) & PLLRDY).toBe(PLLRDY)
  })

  it('the PLL waits for its input oscillator before locking', () => {
    const { soc } = makeSoc()
    w32(soc, RCC_CFGR, 1 << 16) // PLLSRC = HSE (not running)
    set32(soc, RCC_CR, 1 << 24)
    runFor(soc, 0.5e-3)
    expect(r32(soc, RCC_CR) & PLLRDY).toBe(0)
    set32(soc, RCC_CR, 1 << 16)
    runFor(soc, 1.1e-3)
    expect(r32(soc, RCC_CR) & PLLRDY).toBe(0) // HSE ready at 1 ms, lock needs 200 µs more
    runFor(soc, 0.15e-3)
    expect(r32(soc, RCC_CR) & PLLRDY).toBe(PLLRDY)
  })

  it('SW to a source that is not ready is deferred until it is ready (§7.2.6)', () => {
    const { soc } = makeSoc()
    w32(soc, RCC_CFGR, 1) // SW = HSE while HSE is off
    expect((r32(soc, RCC_CFGR) >> 2) & 3).toBe(0)
    set32(soc, RCC_CR, 1 << 16)
    runFor(soc, 1.01e-3)
    expect((r32(soc, RCC_CFGR) >> 2) & 3).toBe(1)
    expect(soc.rcc.sysclk()).toBe(8e6) // HSE 8 MHz
  })

  it('HSION / HSEON / PLLON cannot be cleared while in use; PLL config is frozen while PLLON = 1', () => {
    const { soc } = makeSoc()
    w32(soc, RCC_CR, 0) // try to stop the HSI that clocks the CPU
    expect(r32(soc, RCC_CR) & 3).toBe(3)
    clock72(soc)
    w32(soc, RCC_CR, r32(soc, RCC_CR) & ~(1 << 24)) // PLLON off while PLL is SYSCLK
    expect(r32(soc, RCC_CR) & (1 << 24)).not.toBe(0)
    w32(soc, RCC_CR, r32(soc, RCC_CR) & ~(1 << 16)) // HSEON off while it feeds the PLL
    expect(r32(soc, RCC_CR) & (1 << 16)).not.toBe(0)
    w32(soc, RCC_CFGR, (r32(soc, RCC_CFGR) & ~(0xf << 18)) | (4 << 18)) // PLLMUL ×6 while on
    expect((r32(soc, RCC_CFGR) >> 18) & 0xf).toBe(7)
    const log = soc.drainLog().map((e) => e.message).join('\n')
    expect(log).toMatch(/HSION cannot be cleared/)
    expect(log).toMatch(/PLLON cannot be cleared/)
    expect(log).toMatch(/PLL configuration can only be changed while PLLON = 0/)
    // HSI may now be turned off (the PLL runs from the HSE)
    w32(soc, RCC_CR, r32(soc, RCC_CR) & ~1)
    expect(r32(soc, RCC_CR) & 3).toBe(0)
  })

  it('LSI ready after 85 µs; LSE needs PWR_CR.DBP and is ready after 500 ms', () => {
    const { soc } = makeSoc()
    w32(soc, RCC_CSR, 1)
    runFor(soc, 80e-6)
    expect(r32(soc, RCC_CSR) & 2).toBe(0)
    runFor(soc, 10e-6)
    expect(r32(soc, RCC_CSR) & 2).toBe(2)
    w32(soc, RCC_BDCR, 1)
    expect(r32(soc, RCC_BDCR)).toBe(0) // write-protected
    expect(soc.drainLog().some((e) => /RCC_BDCR write ignored.*PWR_CR.DBP/.test(e.message))).toBe(true)
    set32(soc, RCC_APB1ENR, 1 << 28)
    set32(soc, PWR, 1 << 8) // DBP
    w32(soc, RCC_BDCR, 1)
    runFor(soc, 0.49)
    expect(r32(soc, RCC_BDCR) & 2).toBe(0)
    runFor(soc, 0.02)
    expect(r32(soc, RCC_BDCR) & 3).toBe(3)
  })

  it('ready interrupts: flags only with the IE bit, IRQ 5, write-1-to-clear', () => {
    const { soc, core } = makeSoc()
    w32(soc, RCC_CIR, 1 << 11) // HSERDYIE
    set32(soc, RCC_CR, 1 << 16)
    runFor(soc, 1.1e-3)
    expect(r32(soc, RCC_CIR) & 0x1f).toBe(1 << 3)
    expect(core.irqLines[5]).toBe(1)
    w32(soc, RCC_CIR, (1 << 11) | (1 << 19))
    expect(r32(soc, RCC_CIR) & 0x1f).toBe(0)
    expect(core.irqLines[5]).toBe(0)
  })
})

describe('clock tree', () => {
  it('HAL 72 MHz configuration: HSE ×9, AHB /1, APB1 /2, APB2 /1', () => {
    const { soc } = makeSoc()
    clock72(soc)
    const c = soc.rcc
    expect((r32(soc, RCC_CFGR) >> 2) & 3).toBe(2) // SWS = PLL
    expect(c.sysclk()).toBe(72e6)
    expect(c.hclk()).toBe(72e6)
    expect(c.pclk1()).toBe(36e6)
    expect(c.pclk2()).toBe(72e6)
    expect(c.timclk1()).toBe(72e6) // APB1 prescaler ≠ 1 → ×2
    expect(c.timclk2()).toBe(72e6)
    expect(c.adcclk()).toBe(36e6) // ADCPRE /2 (limit only checked when an ADC is clocked)
    expect(c.usbclk()).toBe(48e6)
    expect(soc.drainLog().filter((e) => e.level !== 'info')).toEqual([])
  })

  it('prescaler and PLL arithmetic (PLLMUL ×2…×16, PLLXTPRE, HPRE, ADCPRE)', () => {
    const { soc } = makeSoc()
    // HSI/2 × 16 = 64 MHz, AHB /2 = 32, APB1 /4 = 8, APB2 /8 = 4, ADC /8 = 0.5
    w32(soc, RCC_CFGR, (0xf << 18) | (3 << 14) | (6 << 11) | (5 << 8) | (8 << 4))
    set32(soc, RCC_CR, 1 << 24)
    runFor(soc, 250e-6)
    w32(soc, RCC_CFGR, r32(soc, RCC_CFGR) | 2)
    const c = soc.rcc
    expect(c.sysclk()).toBe(64e6)
    expect(c.hclk()).toBe(32e6)
    expect(c.pclk1()).toBe(8e6)
    expect(c.pclk2()).toBe(4e6)
    expect(c.timclk1()).toBe(16e6)
    expect(c.timclk2()).toBe(8e6)
    expect(c.adcclk()).toBe(0.5e6)
    // PLLXTPRE: HSE/2 × 2 = 8 MHz
    const b = makeSoc().soc
    set32(b, RCC_CR, 1 << 16)
    runFor(b, 1.1e-3)
    w32(b, RCC_CFGR, (1 << 16) | (1 << 17) | (0 << 18))
    expect(b.rcc.pllHz()).toBe(8e6)
  })

  it('warns about datasheet limits (SYSCLK, PCLK1, ADCCLK, flash latency)', () => {
    const { soc } = makeSoc()
    set32(soc, RCC_CR, 1 << 16)
    runFor(soc, 1.1e-3)
    w32(soc, RCC_CFGR, (1 << 16) | (14 << 18)) // 8 MHz × 16 = 128 MHz
    set32(soc, RCC_CR, 1 << 24)
    runFor(soc, 250e-6)
    w32(soc, RCC_CFGR, r32(soc, RCC_CFGR) | 2)
    set32(soc, RCC_APB2ENR, 1 << 9) // ADC1 clocked: ADCCLK = 64 MHz
    const log = soc.drainLog().map((e) => e.message).join('\n')
    expect(log).toMatch(/PLL output 128 MHz is outside 16–72 MHz/)
    expect(log).toMatch(/SYSCLK 128 MHz exceeds the 72 MHz maximum/)
    expect(log).toMatch(/PCLK1 128 MHz exceeds the 36 MHz APB1 maximum/)
    expect(log).toMatch(/ADCCLK 64 MHz exceeds the 14 MHz maximum/)
    expect(log).toMatch(/FLASH_ACR.LATENCY = 0 is too low for SYSCLK 128 MHz/)
  })

  it('rebases the cycle↔time mapping exactly at the switch and notifies peripherals', () => {
    let calls = 0
    const probe: Stm32Peripheral = {
      name: 'PROBE',
      base: 0x40000000,
      size: 0x400,
      gate: { bus: 'APB1', bit: 0 },
      attach() {},
      read: () => 0,
      write() {},
      reset() {},
      clockChanged: () => void calls++,
    }
    let core: StubCore | null = null
    const soc = new Stm32f103({
      createCore: (bus, s, clock, hooks, cfg) => (core = new StubCore(bus, s, clock, hooks, cfg)),
      peripherals: [{ name: 'PROBE', base: 0x40000000, gate: { bus: 'APB1', bit: 0 }, make: () => probe, status: 'unsupported', notes: '' }],
    })
    expect(core).not.toBeNull()
    calls = 0
    clock72(soc)
    expect(calls).toBeGreaterThan(0)
    const c = soc.clock.cycles
    const t = soc.time()
    expect(soc.timeOfCycle(c + 72e6)).toBeCloseTo(t + 1, 12)
    // cycles before the switch still map with 8 MHz
    expect(soc.timeOfCycle(c - 8000)).toBeCloseTo(t - 1e-3, 12)
    soc.runUntil(t + 0.5)
    expect(soc.clock.cycles).toBe(c + 36e6)
  })
})

describe('peripheral clock gating and resets', () => {
  it('a gated block reads 0 and ignores writes; APBxRSTR resets it', () => {
    const { soc } = makeSoc()
    w32(soc, GPIOA + 0x0c, 0x1234)
    expect(r32(soc, GPIOA + 0x0c)).toBe(0)
    set32(soc, RCC_APB2ENR, 1 << 2)
    expect(r32(soc, GPIOA)).toBe(0x44444444)
    w32(soc, GPIOA + 0x0c, 0x1234)
    expect(r32(soc, GPIOA + 0x0c)).toBe(0x1234)
    w32(soc, RCC_APB2RSTR, 1 << 2)
    w32(soc, GPIOA + 0x0c, 0x5678) // held in reset: ignored
    w32(soc, RCC_APB2RSTR, 0)
    expect(r32(soc, GPIOA + 0x0c)).toBe(0)
    // the gate is closed again: registers are retained but invisible
    w32(soc, GPIOA + 0x0c, 0x00ff)
    w32(soc, RCC_APB2ENR, 0)
    expect(r32(soc, GPIOA + 0x0c)).toBe(0)
    w32(soc, RCC_APB2ENR, 1 << 2)
    expect(r32(soc, GPIOA + 0x0c)).toBe(0x00ff)
  })

  it('flash latency register is read back (HAL checks it) and warns when too low', () => {
    const { soc } = makeSoc()
    expect(r32(soc, FLASH_ACR)).toBe(0x30)
    w32(soc, FLASH_ACR, 0x32)
    expect(r32(soc, FLASH_ACR) & 7).toBe(2)
  })
})

describe('reset flags (RCC_CSR)', () => {
  it('POR sets PORRSTF|PINRSTF; software reset adds SFTRSTF; RMVF clears; NRST sets PINRSTF', () => {
    const { soc, core } = makeSoc({ firmware: true })
    expect(soc.resetFlags >>> 0).toBe(0x0c000000)
    w32(soc, RCC_CSR, 1 << 24)
    expect(soc.resetFlags).toBe(0)
    core.hooks.systemResetRequest() // as AIRCR.SYSRESETREQ would (outside execution → immediate)
    expect(soc.resetFlags >>> 0).toBe(0x14000000) // SFTRSTF | PINRSTF
    w32(soc, RCC_CSR, 1 << 24)
    soc.setResetPin(true)
    expect(soc.debugState().state).toBe('reset')
    soc.setResetPin(false)
    expect(soc.resetFlags >>> 0).toBe(0x04000000)
    expect(soc.debugState().state).toBe('running')
  })

  it('a system reset keeps SRAM and the backup domain; power-on clears them', () => {
    const { soc } = makeSoc({ firmware: true })
    soc.bus.write32(0x20000010, 0xcafe)
    soc.reset('pin')
    expect(soc.bus.read32(0x20000010)).toBe(0xcafe)
    soc.setPowered(false)
    expect(soc.debugState().state).toBe('unpowered')
    soc.setPowered(true)
    expect(soc.bus.read32(0x20000010)).toBe(0)
    expect(soc.resetFlags >>> 0).toBe(0x0c000000)
    // VDD returning while NRST is held: releasing NRST is still a power-on reset
    soc.bus.write32(0x20000010, 0xcafe)
    soc.setResetPin(true)
    soc.setPowered(false)
    soc.setPowered(true)
    expect(soc.debugState().state).toBe('reset')
    soc.setResetPin(false)
    expect(soc.resetFlags >>> 0).toBe(0x0c000000)
    expect(soc.bus.read32(0x20000010)).toBe(0)
  })
})

describe('peripheral list', () => {
  it('every block sits in its own 1 KiB slot with the RCC gate of RM0008 §7.3', () => {
    const bases = new Set(PERIPHERALS.map((p) => p.base))
    expect(bases.size).toBe(PERIPHERALS.length)
    const byName = Object.fromEntries(PERIPHERALS.map((p) => [p.name, p]))
    expect(byName.USART1.gate).toEqual({ bus: 'APB2', bit: 14 })
    expect(byName.USART2.gate).toEqual({ bus: 'APB1', bit: 17 })
    expect(byName.CRC.gate).toEqual({ bus: 'AHB', bit: 6 })
    expect(byName.IWDG.gate).toBeNull()
  })
})
