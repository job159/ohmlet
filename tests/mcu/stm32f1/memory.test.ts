/**
 * STM32F103C8 memory map (RM0008 §3.3–3.4, §30): flash/SRAM/system memory/
 * option bytes, boot alias, BusFault on unmapped and reserved addresses,
 * firmware programming rules, and the registry barrel.
 */
import { describe, expect, it } from 'vitest'
import { BusFault } from '../../../src/mcu/core/types'
import { makeSoc, r32, tinyImage, w32 } from './helpers'

const fault = (fn: () => unknown): BusFault => {
  try {
    fn()
  } catch (e) {
    if (e instanceof BusFault) return e
    throw e
  }
  throw new Error('expected a BusFault')
}

describe('memory map', () => {
  it('SRAM is 20 KiB at 0x20000000, byte/half/word and unaligned accesses work, beyond is a BusFault', () => {
    const { soc } = makeSoc()
    const b = soc.bus
    b.write32(0x20000000, 0x11223344)
    expect(b.read8(0x20000000)).toBe(0x44)
    expect(b.read16(0x20000002)).toBe(0x1122)
    b.write32(0x20000101, 0xa1b2c3d4) // unaligned (ARMv7-M A3.2: allowed on Normal memory)
    expect(b.read32(0x20000101) >>> 0).toBe(0xa1b2c3d4)
    expect(b.read16(0x20000103)).toBe(0xa1b2)
    b.write8(0x20004fff, 0x5a)
    expect(b.read8(0x20004fff)).toBe(0x5a)
    expect(fault(() => b.read8(0x20005000)).reason).toMatch(/beyond the 20 KiB of SRAM/)
    expect(fault(() => b.write32(0x20004ffe, 0)).write).toBe(true)
  })

  it('flash: 128 KiB mapped (erased 0xFF), read-only on the bus without the FPEC', () => {
    const { soc } = makeSoc()
    expect(r32(soc, 0x08000000)).toBe(0xffffffff)
    expect(r32(soc, 0x0801fffc)).toBe(0xffffffff)
    expect(fault(() => soc.bus.read8(0x08020000)).reason).toMatch(/beyond the mapped 128 KiB/)
    expect(fault(() => soc.bus.write16(0x08000000, 0)).reason).toMatch(/without FLASH_CR.PG/)
  })

  it('boot alias: 0x00000000 mirrors flash (BOOT0 = 0) or system memory (BOOT0 = 1)', () => {
    const { soc, core } = makeSoc()
    soc.loadFirmware(tinyImage())
    soc.reset('power-on')
    expect(r32(soc, 0x00000000)).toBe(0x20005000)
    expect(r32(soc, 0x00000004)).toBe(0x08000009)
    expect(core.resetPc).toBe(0x08000009)
    expect(soc.bus.fetch16(0x00000008)).toBe(0xe7fe)

    soc.setBootPins(1)
    soc.reset('pin')
    // system-memory stub: SP = top of SRAM, reset → 0x1FFFF009 holding `b .`
    expect(core.resetSp).toBe(0x20005000)
    expect(core.resetPc).toBe(0x1ffff009)
    expect(soc.bus.fetch16(0x1ffff008)).toBe(0xe7fe)
    expect(soc.drainLog().some((e) => e.level === 'error' && /bootloader, which is not emulated/.test(e.message))).toBe(true)
  })

  it('F_SIZE = 64 KiB, a fixed 96-bit unique ID and factory option bytes', () => {
    const { soc } = makeSoc()
    expect(soc.bus.read16(0x1ffff7e0)).toBe(0x0040)
    const uid = [r32(soc, 0x1ffff7e8), r32(soc, 0x1ffff7ec), r32(soc, 0x1ffff7f0)]
    expect(uid).toEqual([0x0670ff48, 0x51503754, 0x87212043])
    // RDP = 0xA5 / nRDP = 0x5A, USER = 0xFF / nUSER = 0x00, data and WRP erased
    expect(soc.bus.read16(0x1ffff800)).toBe(0x5aa5)
    expect(soc.bus.read16(0x1ffff802)).toBe(0x00ff)
    expect(soc.bus.read16(0x1ffff80e)).toBe(0x00ff)
    expect(fault(() => soc.bus.write16(0x1ffff800, 0)).reason).toMatch(/read-only/)
  })

  it('unmapped / reserved / FSMC addresses are BusFaults; unaligned peripheral access too', () => {
    const { soc } = makeSoc()
    expect(fault(() => soc.bus.read32(0x40000c00)).reason).toMatch(/reserved peripheral address/) // TIM5 slot: absent on F103xB
    expect(fault(() => soc.bus.read32(0x40024000)).reason).toMatch(/reserved peripheral/)
    expect(fault(() => soc.bus.read32(0x60000000)).reason).toMatch(/FSMC/)
    expect(fault(() => soc.bus.read32(0x10000000)).reason).toMatch(/unmapped/)
    expect(fault(() => soc.bus.read32(0x40021002)).reason).toMatch(/unaligned 32-bit peripheral read/)
    expect(fault(() => soc.bus.fetch16(0x40010800)).reason).toMatch(/instruction fetch/)
  })

  it('peripheral sub-word accesses use byte lanes', () => {
    const { soc } = makeSoc()
    w32(soc, 0x40021018, 1 << 2) // IOPAEN
    // CRL reset 0x44444444; write one byte at offset 1 → only bits 15:8 change
    soc.bus.write8(0x40010801, 0x33)
    expect(r32(soc, 0x40010800)).toBe(0x44443344)
    expect(soc.bus.read16(0x40010802)).toBe(0x4444)
    expect(soc.bus.read8(0x40010801)).toBe(0x33)
  })

  it('SRAM code pages: writes to SRAM that code was fetched from bump codeVersion', () => {
    const { soc } = makeSoc()
    const v0 = soc.bus.codeVersion
    soc.bus.write32(0x20000400, 1)
    expect(soc.bus.codeVersion).toBe(v0)
    soc.bus.fetch16(0x20000400)
    soc.bus.write32(0x20000404, 2)
    expect(soc.bus.codeVersion).toBe(v0 + 1)
    expect(soc.bus.codeWriteRange).toEqual({ start: 0x20000404, end: 0x20000408 })
    soc.bus.write32(0x20001000, 3) // another, never-executed page
    expect(soc.bus.codeVersion).toBe(v0 + 1)
  })
})

describe('loadFirmware', () => {
  it('programs flash, skips RAM-only segments, bumps codeVersion, needs a reset to start', () => {
    const { soc, core } = makeSoc()
    const v0 = soc.bus.codeVersion
    const img = tinyImage([{ addr: 0x20000000, data: new Uint8Array(16) }])
    const r = soc.loadFirmware(img)
    expect(r.ok).toBe(true)
    expect(r.warnings.join()).toMatch(/0x20000000 \(16 bytes\) is RAM-only — not programmed/)
    expect(soc.bus.codeVersion).toBeGreaterThan(v0)
    expect(soc.debugState().state).toBe('reset')
    const resets = core.resets
    soc.reset('power-on')
    expect(core.resets).toBe(resets + 1)
    expect(soc.debugState().state).toBe('running')
    expect(soc.debugState().pcSymbol).toBe('Reset_Handler')
  })

  it('warns above the 64 KiB datasheet size and rejects images beyond 128 KiB', () => {
    const { soc } = makeSoc()
    const big = tinyImage([{ addr: 0x08010000, data: new Uint8Array(4096) }])
    const r = soc.loadFirmware(big)
    expect(r.ok).toBe(true)
    expect(r.warnings.join()).toMatch(/exceeds the STM32F103C8 datasheet flash size \(64 KiB\); most parts have 128 KiB/)
    expect(r32(soc, 0x08010000)).toBe(0)
    const huge = tinyImage([{ addr: 0x0801ff00, data: new Uint8Array(0x200) }])
    const h = soc.loadFirmware(huge)
    expect(h.ok).toBe(false)
    expect(h.errors.join()).toMatch(/runs past the end of flash/)
    const none = soc.loadFirmware({ ...tinyImage(), segments: [{ addr: 0x20000000, data: new Uint8Array(4) }] })
    expect(none.ok).toBe(false)
    expect(none.errors.join()).toMatch(/nothing to program/)
  })

  it('erases old content and checks the vector table', () => {
    const { soc } = makeSoc()
    soc.loadFirmware(tinyImage([{ addr: 0x08000100, data: new Uint8Array([1, 2, 3, 4]) }]))
    expect(r32(soc, 0x08000100)).toBe(0x04030201)
    const bad = tinyImage()
    const d = new Uint8Array(bad.segments[0].data)
    new DataView(d.buffer).setUint32(4, 0x08000008, true) // Thumb bit clear
    const r = soc.loadFirmware({ ...bad, segments: [{ addr: 0x08000000, data: d }] })
    expect(r.warnings.join()).toMatch(/Thumb bit clear/)
    expect(r32(soc, 0x08000100)).toBe(0xffffffff) // erased by the new load
  })

  it('the registry barrel registers stm32f103c8', async () => {
    const { createMcu, registeredMcus } = await import('../../../src/mcu/registry')
    await import('../../../src/mcu/all')
    expect(registeredMcus()).toContain('stm32f103c8')
    const mcu = createMcu('stm32f103c8')!
    expect(mcu.model).toBe('stm32f103c8')
    expect(mcu.pins.pinIndex('PC13')).toBe(45)
    expect(mcu.uarts.map((u) => u.name)).toEqual(['USART1', 'USART2', 'USART3'])
  })
})
