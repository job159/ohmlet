import { readFileSync } from 'node:fs'
/**
 * System blocks and SoC behaviour: IWDG (ch. 19), WWDG (ch. 20), CRC
 * (ch. 4), BKP + PWR_CR.DBP (ch. 5–6), DBGMCU (§31.16), unsupported
 * blocks, run-state machine (power, NRST, halt, breakpoints, sync), the
 * deduplicated log and the support table.
 */
import { describe, expect, it } from 'vitest'
import { crc32Word } from '../../../src/mcu/stm32f1/crc'
import { DBGMCU_IDCODE } from '../../../src/mcu/stm32f1/dbgmcu'
import { FIRMWARE_VERIFIED } from '../../../src/mcu/stm32f1/peripherals'
import type { Iwdg } from '../../../src/mcu/stm32f1/iwdg'
import { SocLog } from '../../../src/mcu/stm32f1/log'
import { BKP, CRC, IWDG, makeSoc, PWR, r32, RCC_AHBENR, RCC_APB1ENR, RCC_CSR, runFor, runToCycle, set32, w32, WWDG } from './helpers'

const IWDGRSTF = 1 << 29
const PINRSTF = 1 << 26
const WWDGRSTF = 1 << 30

describe('IWDG', () => {
  it('reset values; PR/RLR are write-protected until 0x5555', () => {
    const { soc } = makeSoc()
    expect(r32(soc, IWDG + 4)).toBe(0)
    expect(r32(soc, IWDG + 8)).toBe(0xfff)
    w32(soc, IWDG + 4, 3)
    expect(r32(soc, IWDG + 4)).toBe(0)
    w32(soc, IWDG, 0x5555)
    w32(soc, IWDG + 4, 3)
    expect(r32(soc, IWDG + 4)).toBe(3)
    expect(r32(soc, IWDG + 0xc) & 1).toBe(1) // PVU while the update crosses to the LSI domain
    runFor(soc, 130e-6)
    expect(r32(soc, IWDG + 0xc)).toBe(0)
  })

  it('started and never reloaded: resets after prescaler·(RL+1)/40 kHz with IWDGRSTF', () => {
    const { soc } = makeSoc({ firmware: true })
    w32(soc, RCC_CSR, 1 << 24) // clear flags
    w32(soc, IWDG, 0xcccc) // start: counter from 0xFFF at /4 → 409.6 ms
    expect(r32(soc, RCC_CSR) & 2).toBe(0) // LSI forced on, starting up
    runFor(soc, 100e-6)
    expect(r32(soc, RCC_CSR) & 2).toBe(2)
    w32(soc, IWDG, 0x5555)
    w32(soc, IWDG + 8, 99) // 4 · 100 / 40 kHz = 10 ms
    runFor(soc, 200e-6)
    const t0 = soc.time()
    w32(soc, IWDG, 0xaaaa)
    runFor(soc, 9.9e-3)
    expect(soc.resetFlags & IWDGRSTF).toBe(0)
    // keep it fed for a while
    for (let i = 0; i < 5; i++) {
      w32(soc, IWDG, 0xaaaa)
      runFor(soc, 8e-3)
    }
    expect(soc.resetFlags & IWDGRSTF).toBe(0)
    const tf = soc.time()
    runFor(soc, 2.1e-3)
    expect(soc.resetFlags >>> 0).toBe((IWDGRSTF | PINRSTF) >>> 0)
    expect(soc.time() - tf).toBeGreaterThanOrEqual(2e-3)
    expect(t0).toBeGreaterThan(0)
    // the reset stopped the watchdog (RM0008 §19.3: only a reset stops it)
    w32(soc, RCC_CSR, 1 << 24)
    runFor(soc, 0.5)
    expect(soc.resetFlags).toBe(0)
    expect(soc.drainLog().some((e) => /independent watchdog timeout/.test(e.message))).toBe(true)
  })

  it('DBG_IWDG_STOP freezes the counter while the core is halted', () => {
    const { soc } = makeSoc({ firmware: true })
    w32(soc, 0xe0042004, 1 << 8)
    w32(soc, IWDG, 0xcccc)
    runFor(soc, 0.2)
    const iwdg = soc.block('IWDG') as Iwdg
    const c = iwdg.counter()
    soc.halt()
    runFor(soc, 1) // would have expired twice over
    expect(iwdg.counter()).toBe(c)
    expect(soc.resetFlags & IWDGRSTF).toBe(0)
    soc.resume()
    runFor(soc, 0.25)
    expect(soc.resetFlags & IWDGRSTF).not.toBe(0)
  })
})

describe('WWDG', () => {
  function on() {
    const t = makeSoc({ firmware: true })
    set32(t.soc, RCC_APB1ENR, 1 << 11)
    return t
  }
  it('reset values and free-running counter at PCLK1/4096', () => {
    const { soc } = on()
    expect(r32(soc, WWDG)).toBe(0x7f)
    expect(r32(soc, WWDG + 4)).toBe(0x7f)
    expect(r32(soc, WWDG + 8)).toBe(0)
    runToCycle(soc, soc.clock.cycles + 4096 * 3)
    expect(r32(soc, WWDG) & 0x7f).toBe(0x7c)
  })

  it('EWIF at 0x40 (IRQ 0 with EWI), reset when T6 clears with WWDGRSTF', () => {
    const { soc, core } = on()
    w32(soc, WWDG + 4, (1 << 9) | 0x7f) // EWI
    w32(soc, WWDG, 0x80 | 0x42) // WDGA, T = 0x42
    const c0 = soc.clock.cycles
    runToCycle(soc, c0 + 2 * 4096)
    expect(r32(soc, WWDG + 8)).toBe(1)
    expect(core.irqLines[0]).toBe(1)
    w32(soc, WWDG + 8, 0)
    expect(core.irqLines[0]).toBe(0)
    w32(soc, RCC_CSR, 1 << 24)
    runToCycle(soc, c0 + 3 * 4096 + 1)
    expect(soc.resetFlags >>> 0).toBe((WWDGRSTF | PINRSTF) >>> 0)
  })

  it('reloading outside the window resets; writing T6 = 0 resets immediately', () => {
    const { soc } = on()
    w32(soc, WWDG + 4, 0x50) // W = 0x50
    w32(soc, WWDG, 0x80 | 0x7f)
    w32(soc, RCC_CSR, 1 << 24)
    w32(soc, WWDG, 0x80 | 0x7f) // counter 0x7F > W → reset
    expect(soc.resetFlags & WWDGRSTF).not.toBe(0)
    const b = on().soc
    w32(b, WWDG, 0x80 | 0x7f)
    w32(b, RCC_CSR, 1 << 24)
    w32(b, WWDG, 0x80 | 0x3f)
    expect(b.resetFlags & WWDGRSTF).not.toBe(0)
  })
})

describe('CRC', () => {
  it('CRC-32/MPEG-2 style word processing, reset to 0xFFFFFFFF', () => {
    const { soc } = makeSoc()
    w32(soc, RCC_AHBENR, 0x14 | (1 << 6))
    expect(r32(soc, CRC)).toBe(0xffffffff)
    w32(soc, CRC, 0x12345678)
    // reference: bitwise MSB-first CRC with poly 0x04C11DB7
    let c = 0xffffffff ^ 0x12345678
    for (let i = 0; i < 32; i++) c = c & 0x80000000 ? ((c << 1) ^ 0x04c11db7) >>> 0 : (c << 1) >>> 0
    expect(r32(soc, CRC)).toBe(c >>> 0)
    expect(crc32Word(0xffffffff, 0x12345678)).toBe(c >>> 0)
    // known vector (STM32 CRC of the single word 0x00000000 from reset)
    w32(soc, CRC + 8, 1)
    w32(soc, CRC, 0)
    expect(r32(soc, CRC)).toBe(0xc704dd7b)
    w32(soc, CRC + 4, 0xab)
    w32(soc, CRC + 8, 1)
    expect(r32(soc, CRC)).toBe(0xffffffff)
    expect(r32(soc, CRC + 4)).toBe(0xab) // IDR survives CR.RESET
  })
})

describe('BKP / PWR', () => {
  it('backup registers need PWR_CR.DBP, survive a system reset, are cleared by power-on', () => {
    const { soc } = makeSoc({ firmware: true })
    set32(soc, RCC_APB1ENR, (1 << 27) | (1 << 28))
    w32(soc, BKP + 4, 0x1234)
    expect(r32(soc, BKP + 4)).toBe(0)
    set32(soc, PWR, 1 << 8)
    w32(soc, BKP + 4, 0x1234)
    w32(soc, BKP + 0x28, 0xffffffff)
    expect(r32(soc, BKP + 4)).toBe(0x1234)
    expect(r32(soc, BKP + 0x28)).toBe(0xffff)
    soc.reset('pin')
    set32(soc, RCC_APB1ENR, 1 << 27)
    expect(r32(soc, BKP + 4)).toBe(0x1234)
    set32(soc, RCC_APB1ENR, 1 << 28)
    expect(r32(soc, PWR) & (1 << 8)).toBe(0) // DBP itself is cleared by the system reset
    soc.reset('power-on')
    set32(soc, RCC_APB1ENR, 1 << 27)
    expect(r32(soc, BKP + 4)).toBe(0)
  })

  it('tamper on PC13 clears the backup registers and raises TIF', () => {
    const { soc, core } = makeSoc()
    set32(soc, RCC_APB1ENR, (1 << 27) | (1 << 28))
    set32(soc, PWR, 1 << 8)
    w32(soc, BKP + 8, 0x77)
    w32(soc, BKP + 0x34, 4) // TPIE
    w32(soc, BKP + 0x30, 1) // TPE, active high
    soc.pins.setInput(45, 1, 3.3)
    expect(r32(soc, BKP + 8)).toBe(0)
    expect(r32(soc, BKP + 0x34) & 0x300).toBe(0x300) // TEF | TIF
    expect(core.irqLines[2]).toBe(1)
    w32(soc, BKP + 0x34, 4 | 2 | 1)
    expect(core.irqLines[2]).toBe(0)
  })

  it('EWUP forces PA0 to a pull-down; deep sleep is reported as approximated', () => {
    const { soc, core } = makeSoc()
    set32(soc, RCC_APB1ENR, 1 << 28)
    w32(soc, PWR + 4, 1 << 8)
    expect(soc.pins.drive(0).mode).toBe(3)
    core.hooks.sleepChanged?.(true, true)
    expect(soc.drainLog().some((e) => /Stop mode .* is approximated as Sleep/.test(e.message))).toBe(true)
  })
})

describe('DBGMCU and unsupported blocks', () => {
  it('IDCODE and CR', () => {
    const { soc } = makeSoc()
    expect(r32(soc, 0xe0042000)).toBe(DBGMCU_IDCODE)
    expect(DBGMCU_IDCODE).toBe(0x20036410)
    w32(soc, 0xe0042004, 0xffffffff)
    expect(r32(soc, 0xe0042004)).toBe(0x3fffe7)
    expect(r32(soc, 0xe00ff000)).toBe(0) // ROM table: not simulated, reads 0
  })

  it('an unsupported block reads 0, ignores writes and warns once', () => {
    // bxCAN (RM0008 §24) stays an explicit placeholder; TIM2 used to be one
    // before the timer model landed.
    const { soc } = makeSoc()
    set32(soc, RCC_APB1ENR, 1 << 25) // CANEN
    w32(soc, 0x40006400, 0x81)
    expect(r32(soc, 0x40006400)).toBe(0)
    r32(soc, 0x40006404)
    const w = soc.drainLog().filter((e) => e.source === 'CAN')
    expect(w.length).toBe(1)
    expect(w[0].message).toMatch(/bxCAN is not simulated.*unsupported/)
  })
})

describe('run-state machine', () => {
  it('time advances without firmware, unpowered and in reset', () => {
    const { soc } = makeSoc()
    expect(soc.debugState().state).toBe('no-firmware')
    expect(soc.runUntil(0.01)).toBe('target')
    expect(soc.time()).toBeGreaterThanOrEqual(0.01)
    soc.setPowered(false)
    expect(soc.runUntil(0.02)).toBe('target')
    expect(soc.time()).toBeGreaterThanOrEqual(0.02)
    expect(soc.powered).toBe(false)
  })

  it('runUntil returns exactly at the target cycle; requestSync from a pin listener stops early', () => {
    const { soc } = makeSoc({ firmware: true })
    expect(soc.runUntil(1e-3)).toBe('target')
    expect(soc.clock.cycles).toBe(8000)
    expect(soc.time()).toBe(1e-3)
    set32(soc, 0x40021018, 1 << 2)
    w32(soc, 0x40010800, 0x44444442)
    soc.pins.listener = { pinDriveChanged: () => soc.requestSync() }
    soc.scheduler.schedule(10_000, () => w32(soc, 0x40010810, 1))
    expect(soc.runUntil(2e-3)).toBe('sync')
    expect(soc.clock.cycles).toBe(10_000)
    expect(soc.runUntil(2e-3)).toBe('target')
  })

  it('halt keeps time running (peripherals continue); breakpoints stop and halt the core', () => {
    const { soc, core } = makeSoc({ firmware: true })
    soc.halt()
    expect(soc.runUntil(1e-3)).toBe('halted')
    expect(soc.time()).toBeGreaterThanOrEqual(1e-3)
    expect(soc.debugState().state).toBe('halted')
    soc.resume()
    expect(soc.debugState().state).toBe('running')
    soc.setBreakpoints([0x08000009])
    expect([...core.breakpoints]).toEqual([0x08000008])
  })

  it('a reset requested by a peripheral event inside a run applies at the next boundary', () => {
    const { soc, core } = makeSoc({ firmware: true })
    const resets = core.resets
    w32(soc, IWDG, 0xcccc)
    soc.runUntil(0.5)
    expect(core.resets).toBe(resets + 1)
    expect(soc.time()).toBeGreaterThanOrEqual(0.5)
  })
})

describe('log', () => {
  it('folds repeats within a second and rate-limits', () => {
    let t = 0
    const log = new SocLog(() => t)
    for (let i = 0; i < 100; i++) log.log('warning', 'X', 'same')
    expect(log.drain().length).toBe(1)
    t = 1.5
    log.log('warning', 'X', 'same')
    expect(log.drain()[0].message).toBe('same (repeated 99× since the last report)')
    for (let i = 0; i < 500; i++) log.log('info', 'Y', `m${i}`)
    expect(log.drain().length).toBe(199)
    t = 3
    log.log('info', 'Y', 'after')
    const d = log.drain()
    expect(d[0].message).toMatch(/301 log messages suppressed/)
    expect(d[1].message).toBe('after')
  })
})

describe('support table', () => {
  it('lists every block honestly', () => {
    const { soc } = makeSoc()
    const by = Object.fromEntries(soc.support.map((s) => [s.name, s]))
    // verified = complete AND covered by a passing real-firmware test (firmware.test.ts)
    const verified = FIRMWARE_VERIFIED ? ['GPIO', 'EXTI', 'IWDG'] : []
    for (const n of verified) {
      expect(by[n]?.status, n).toBe('verified')
      expect(by[n]?.verifiedBy?.length, n).toBeGreaterThan(0)
    }
    for (const n of ['Memory map', 'RCC', 'GPIO', 'AFIO', 'EXTI', 'FLASH', 'PWR', 'BKP', 'CRC', 'IWDG', 'WWDG', 'DBGMCU', 'USART1', 'USART2', 'USART3']) {
      if (!verified.includes(n)) expect(by[n]?.status, n).toBe('partial')
    }
    // implemented blocks: never 'unsupported', and their notes state the gaps
    for (const n of ['TIM1', 'TIM2', 'TIM3', 'TIM4', 'I2C1', 'I2C2', 'SPI1', 'SPI2', 'ADC1', 'ADC2', 'DMA1']) {
      expect(['partial', 'verified'], n).toContain(by[n]?.status)
      expect(by[n]?.notes.length, n).toBeGreaterThan(40)
    }
    for (const n of ['RTC', 'USB', 'CAN', 'USB/CAN SRAM']) {
      expect(by[n]?.status, n).toBe('unsupported')
    }
    // a block can only be verified by a firmware image that exists
    const fw = new Set(Object.keys(JSON.parse(readFileSync(new URL('../../../firmware/dist/manifest.json', import.meta.url), 'utf8'))))
    for (const s of soc.support) for (const v of s.verifiedBy ?? []) expect(fw.has(v), `${s.name}: ${v}`).toBe(true)
    expect(soc.support.length).toBe(8 + 22)
  })
})
