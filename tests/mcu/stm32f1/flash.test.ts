/**
 * Flash interface (FPEC, PM0075): unlock sequence, half-word programming,
 * PGERR, page / mass erase with BSY timing, EOP, interrupts, lock, the
 * code-version bump that invalidates the core's decode cache.
 */
import { describe, expect, it } from 'vitest'
import { BusFault } from '../../../src/mcu/core/types'
import { FLASH_KEY1, FLASH_KEY2 } from '../../../src/mcu/stm32f1/flash'
import { makeSoc, r32, runFor, w32 } from './helpers'

const KEYR = 0x40022004
const SR = 0x4002200c
const CR = 0x40022010
const AR = 0x40022014
const PG = 1
const PER = 2
const MER = 4
const STRT = 0x40
const LOCK = 0x80
const BSY = 1
const PGERR = 4
const EOP = 0x20

const faultReason = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    if (e instanceof BusFault) return e.reason
    throw e
  }
  return '(no fault)'
}

function unlocked() {
  const t = makeSoc()
  w32(t.soc, KEYR, FLASH_KEY1)
  w32(t.soc, KEYR, FLASH_KEY2)
  return t
}

describe('FPEC', () => {
  it('reset values and the unlock sequence', () => {
    const { soc } = makeSoc()
    expect(r32(soc, CR)).toBe(LOCK)
    expect(r32(soc, SR)).toBe(0)
    expect(r32(soc, 0x4002201c)).toBe(0x03fffffc) // OBR, factory option bytes
    expect(r32(soc, 0x40022020)).toBe(0xffffffff) // WRPR
    w32(soc, CR, PG)
    expect(r32(soc, CR)).toBe(LOCK) // locked: ignored
    w32(soc, KEYR, FLASH_KEY1)
    w32(soc, KEYR, FLASH_KEY2)
    expect(r32(soc, CR) & LOCK).toBe(0)
    w32(soc, CR, LOCK)
    expect(r32(soc, CR) & LOCK).toBe(LOCK)
  })

  it('a wrong key is a bus error and locks the FPEC until reset (PM0075 §2.3.1)', () => {
    const { soc } = makeSoc()
    w32(soc, KEYR, FLASH_KEY1)
    expect(() => w32(soc, KEYR, 0x12345678)).toThrow(BusFault)
    expect(() => w32(soc, KEYR, FLASH_KEY1)).toThrow(BusFault)
    expect(r32(soc, CR) & LOCK).toBe(LOCK)
    soc.reset('power-on')
    w32(soc, KEYR, FLASH_KEY1)
    w32(soc, KEYR, FLASH_KEY2)
    expect(r32(soc, CR) & LOCK).toBe(0)
  })

  it('half-word programming with BSY for 52.5 µs, then EOP; only half-words', () => {
    const { soc } = unlocked()
    w32(soc, CR, PG)
    const v0 = soc.bus.codeVersion
    soc.bus.write16(0x08000400, 0xbeef)
    expect(soc.bus.read16(0x08000400)).toBe(0xbeef)
    expect(soc.bus.codeVersion).toBe(v0 + 1)
    expect(soc.bus.codeWriteRange).toEqual({ start: 0x08000400, end: 0x08000402 })
    expect(r32(soc, SR) & BSY).toBe(BSY)
    runFor(soc, 50e-6)
    expect(r32(soc, SR) & BSY).toBe(BSY)
    runFor(soc, 3e-6)
    expect(r32(soc, SR)).toBe(EOP)
    w32(soc, SR, EOP)
    expect(r32(soc, SR)).toBe(0)
    expect(faultReason(() => soc.bus.write32(0x08000404, 0))).toMatch(/only half-words/)
    expect(() => soc.bus.write8(0x08000404, 0)).toThrow(BusFault)
    // the boot alias reaches the same flash
    soc.bus.write16(0x00000406, 0x1234)
    expect(soc.bus.read16(0x08000406)).toBe(0x1234)
  })

  it('programming a non-erased half-word sets PGERR (writing 0x0000 always works)', () => {
    const { soc, core } = unlocked()
    w32(soc, CR, PG | (1 << 10)) // ERRIE
    soc.bus.write16(0x08000800, 0x00ff)
    soc.bus.write16(0x08000800, 0x1111)
    expect(soc.bus.read16(0x08000800)).toBe(0x00ff)
    expect(r32(soc, SR) & PGERR).toBe(PGERR)
    expect(core.irqLines[4]).toBe(1)
    w32(soc, SR, PGERR)
    expect(core.irqLines[4]).toBe(0)
    soc.bus.write16(0x08000800, 0x0000)
    expect(soc.bus.read16(0x08000800)).toBe(0)
    expect(r32(soc, SR) & PGERR).toBe(0)
  })

  it('page erase: 1 KiB, BSY 20 ms, STRT until done; mass erase clears everything', () => {
    const { soc, core } = unlocked()
    w32(soc, CR, PG)
    soc.bus.write16(0x08000c00, 0x0001)
    soc.bus.write16(0x08001000, 0x0002)
    runFor(soc, 1e-3)
    w32(soc, CR, PER | (1 << 12)) // EOPIE
    w32(soc, AR, 0x08000c10) // any address inside the page
    w32(soc, CR, PER | STRT | (1 << 12))
    expect(soc.bus.read16(0x08000c00)).toBe(0xffff)
    expect(soc.bus.read16(0x08001000)).toBe(0x0002)
    expect(r32(soc, CR) & STRT).toBe(STRT)
    runFor(soc, 19.9e-3)
    expect(r32(soc, SR) & BSY).toBe(BSY)
    runFor(soc, 0.2e-3)
    expect(r32(soc, SR) & (BSY | EOP)).toBe(EOP)
    expect(r32(soc, CR) & STRT).toBe(0)
    expect(core.irqLines[4]).toBe(1)
    w32(soc, SR, EOP)
    w32(soc, CR, MER)
    w32(soc, CR, MER | STRT)
    expect(soc.bus.read16(0x08001000)).toBe(0xffff)
    runFor(soc, 21e-3)
    expect(r32(soc, SR) & BSY).toBe(0)
  })

  it('writing flash without PG is a bus error with a hint', () => {
    const { soc } = makeSoc()
    expect(faultReason(() => soc.bus.write16(0x08000000, 0))).toMatch(/without FLASH_CR.PG/)
    expect(soc.drainLog().some((e) => /HAL_FLASH_Unlock/.test(e.message))).toBe(true)
  })
})
