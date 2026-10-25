/**
 * STM32F103C8 system bus: the memory map of RM0008 §3.3 (Figure 2) and
 * DS5319 §4 (Figure 11) as seen by the core and by DMA.
 *
 *   0x0000_0000  boot alias (RM0008 §3.4): main flash when BOOT0 = 0,
 *                system memory when BOOT0 = 1
 *   0x0800_0000  main flash. 128 KiB are mapped: DS5319 rates the C8 at
 *                64 KiB, but the die is the 128 KiB F103xB one and nearly
 *                every part has the upper half working — firmware larger
 *                than 64 KiB loads with a warning, like on a real Blue Pill.
 *   0x1FFF_F000  system memory (2 KiB): ST's bootloader is NOT emulated (the
 *                region holds a 3-word stub that parks the core in a loop);
 *                F_SIZE at 0x1FFF_F7E0 (RM0008 §30.1) and the 96-bit unique
 *                ID at 0x1FFF_F7E8 (§30.2) are real.
 *   0x1FFF_F800  option bytes (16 bytes, PM0075 §2.5), factory
 *                default: RDP = 0xA5 (no read protection), USER = 0xFF,
 *                data and WRP bytes erased.
 *   0x2000_0000  SRAM, 20 KiB. Beyond 0x2000_5000 → BusFault.
 *   0x4000_0000  peripherals, decoded in 1 KiB slots (BusSlot per block).
 *   0xE004_0000  external PPB (DBGMCU at 0xE004_2000).
 * Anything else → BusFault (precise; the core turns it into a BusFault or
 * HardFault exception). Bit-band aliases and the internal PPB never reach
 * this bus (cpu-api.ts).
 *
 * Sub-word and unaligned accesses: memory supports both (ARMv7-M ARM
 * §A3.2: unaligned LDR/STR/LDRH/STRH to Normal memory). Peripheral slots
 * receive (offset, size) and decide; an unaligned peripheral access is a
 * BusFault.
 */
import { BusFault, type AccessSize, type SystemBus } from '../core/types'

export const FLASH_BASE = 0x08000000
export const FLASH_MAPPED = 128 * 1024
export const FLASH_DATASHEET = 64 * 1024
export const FLASH_PAGE = 1024 // medium-density page (RM0008 §3.3.3, Table 5)
export const SRAM_BASE = 0x20000000
export const SRAM_SIZE = 20 * 1024
export const SYSMEM_BASE = 0x1ffff000
export const SYSMEM_SIZE = 0x800
export const OPTB_BASE = 0x1ffff800
export const OPTB_SIZE = 16
export const PERIPH_BASE = 0x40000000
export const PERIPH_SPAN = 0x24000 // up to the end of the CRC slot (0x4002_3FFF)
export const EXT_PPB_BASE = 0xe0040000
export const EXT_PPB_END = 0xe0100000

/** F_SIZE (RM0008 §30.1.1): flash size in KiB as programmed by ST for the C8 = 64. */
export const F_SIZE_KB = 0x0040
/**
 * 96-bit unique device ID (RM0008 §30.2). Real parts encode lot/wafer/X-Y;
 * the simulator uses one fixed value so runs are reproducible.
 */
export const UNIQUE_ID: readonly number[] = [0x0670ff48, 0x5150_3754, 0x87212043]

export interface BusSlot {
  read(offset: number, size: AccessSize): number
  write(offset: number, value: number, size: AccessSize): void
}

/** Flash writes are routed to the flash interface (FPEC) — see flash.ts. */
export interface FlashWriter {
  /** `addr` is the absolute main-flash address (alias already resolved). Throws BusFault to refuse. */
  program(addr: number, value: number, size: AccessSize): void
}

export class Stm32Bus implements SystemBus {
  codeVersion = 0
  /** last range modified by a code-version bump, [start, end) */
  readonly codeWriteRange = { start: 0, end: 0 }

  readonly flash = new Uint8Array(FLASH_MAPPED).fill(0xff)
  private readonly flash16 = new Uint16Array(this.flash.buffer)
  private readonly flash32 = new Uint32Array(this.flash.buffer)
  readonly sram = new Uint8Array(SRAM_SIZE)
  private readonly sram16 = new Uint16Array(this.sram.buffer)
  private readonly sram32 = new Uint32Array(this.sram.buffer)
  readonly sysmem = new Uint8Array(SYSMEM_SIZE + OPTB_SIZE)
  /** 1 KiB SRAM pages instruction-fetched at least once (writes there bump codeVersion) */
  private readonly sramCodePages = new Uint8Array(SRAM_SIZE >> 10)
  private sramHasCode = false

  /** BOOT0 = 1 maps system memory at 0 (sampled at reset by the SoC). */
  bootFromSystem = false

  private readonly slots: (BusSlot | null)[] = new Array(PERIPH_SPAN >> 10).fill(null)
  flashWriter: FlashWriter | null = null
  extPpb: BusSlot | null = null

  constructor() {
    this.initSystemMemory()
  }

  map(base: number, size: number, slot: BusSlot): void {
    for (let a = base; a < base + size; a += 0x400) this.slots[(a - PERIPH_BASE) >> 10] = slot
  }

  slotAt(addr: number): BusSlot | null {
    const o = (addr - PERIPH_BASE) >>> 0
    return o < PERIPH_SPAN ? this.slots[o >> 10] : null
  }

  /** Main flash modified (programming, erase, image load): invalidate decode caches. */
  touchFlash(start: number, end: number): void {
    this.codeVersion++
    this.codeWriteRange.start = start
    this.codeWriteRange.end = end
  }

  // ------------------------------------------------------------- reads

  read32(addr: number): number {
    const a = addr >>> 0
    let o = (a - SRAM_BASE) >>> 0
    if (o < SRAM_SIZE - 3) return (o & 3) === 0 ? this.sram32[o >> 2] : this.mem32(this.sram, o)
    o = (a - FLASH_BASE) >>> 0
    if (o < FLASH_MAPPED - 3) return (o & 3) === 0 ? this.flash32[o >> 2] : this.mem32(this.flash, o)
    return this.slow(a, 4)
  }

  read16(addr: number): number {
    const a = addr >>> 0
    let o = (a - SRAM_BASE) >>> 0
    if (o < SRAM_SIZE - 1) return (o & 1) === 0 ? this.sram16[o >> 1] : this.sram[o] | (this.sram[o + 1] << 8)
    o = (a - FLASH_BASE) >>> 0
    if (o < FLASH_MAPPED - 1) return (o & 1) === 0 ? this.flash16[o >> 1] : this.flash[o] | (this.flash[o + 1] << 8)
    return this.slow(a, 2)
  }

  read8(addr: number): number {
    const a = addr >>> 0
    let o = (a - SRAM_BASE) >>> 0
    if (o < SRAM_SIZE) return this.sram[o]
    o = (a - FLASH_BASE) >>> 0
    if (o < FLASH_MAPPED) return this.flash[o]
    return this.slow(a, 1)
  }

  fetch16(addr: number): number {
    const a = addr >>> 0
    let o = (a - FLASH_BASE) >>> 0
    if (o < FLASH_MAPPED - 1) return this.flash16[o >> 1]
    o = (a - SRAM_BASE) >>> 0
    if (o < SRAM_SIZE - 1) {
      const p = o >> 10
      if (this.sramCodePages[p] === 0) {
        this.sramCodePages[p] = 1
        this.sramHasCode = true
      }
      return this.sram16[o >> 1]
    }
    if (a < FLASH_MAPPED - 1) {
      if (!this.bootFromSystem) return this.flash16[a >> 1]
      if (a < SYSMEM_SIZE - 1) return this.sysmem[a] | (this.sysmem[a + 1] << 8)
    }
    o = (a - SYSMEM_BASE) >>> 0
    if (o < SYSMEM_SIZE - 1) return this.sysmem[o] | (this.sysmem[o + 1] << 8)
    throw new BusFault(a, false, `instruction fetch from ${regionName(a)}`)
  }

  // ------------------------------------------------------------- writes

  write32(addr: number, v: number): void {
    const a = addr >>> 0
    const o = (a - SRAM_BASE) >>> 0
    if (o < SRAM_SIZE - 3) {
      if ((o & 3) === 0) this.sram32[o >> 2] = v
      else this.memW(this.sram, o, v, 4)
      if (this.sramHasCode) this.sramWritten(o, 4)
      return
    }
    this.slowW(a, v >>> 0, 4)
  }

  write16(addr: number, v: number): void {
    const a = addr >>> 0
    const o = (a - SRAM_BASE) >>> 0
    if (o < SRAM_SIZE - 1) {
      if ((o & 1) === 0) this.sram16[o >> 1] = v
      else this.memW(this.sram, o, v, 2)
      if (this.sramHasCode) this.sramWritten(o, 2)
      return
    }
    this.slowW(a, v & 0xffff, 2)
  }

  write8(addr: number, v: number): void {
    const a = addr >>> 0
    const o = (a - SRAM_BASE) >>> 0
    if (o < SRAM_SIZE) {
      this.sram[o] = v
      if (this.sramHasCode) this.sramWritten(o, 1)
      return
    }
    this.slowW(a, v & 0xff, 1)
  }

  /** Debugger/UI read without bus faults (unmapped bytes read 0). MMIO reads may have side effects. */
  peek(addr: number, length: number): Uint8Array {
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
      try {
        out[i] = this.read8((addr + i) >>> 0)
      } catch (e) {
        if (!(e instanceof BusFault)) throw e
      }
    }
    return out
  }

  /** Power-on: SRAM content is lost. The simulator zero-fills it so runs are reproducible. */
  clearSram(): void {
    this.sram.fill(0)
    this.sramCodePages.fill(0)
    this.sramHasCode = false
  }

  // ------------------------------------------------------------- internals

  private sramWritten(o: number, n: number): void {
    const p0 = o >> 10
    const p1 = (o + n - 1) >> 10
    if (this.sramCodePages[p0] || this.sramCodePages[p1]) {
      this.codeVersion++
      this.codeWriteRange.start = SRAM_BASE + o
      this.codeWriteRange.end = SRAM_BASE + o + n
    }
  }

  private mem32(m: Uint8Array, o: number): number {
    return (m[o] | (m[o + 1] << 8) | (m[o + 2] << 16) | (m[o + 3] << 24)) >>> 0
  }

  private memW(m: Uint8Array, o: number, v: number, n: number): void {
    for (let i = 0; i < n; i++) m[o + i] = (v >>> (8 * i)) & 0xff
  }

  private memR(m: Uint8Array, o: number, n: number): number {
    return n === 4 ? this.mem32(m, o) : n === 2 ? m[o] | (m[o + 1] << 8) : m[o]
  }

  private slow(a: number, n: AccessSize): number {
    // boot alias
    if (a <= FLASH_MAPPED - n) {
      if (!this.bootFromSystem) return this.memR(this.flash, a, n)
      if (a <= SYSMEM_SIZE + OPTB_SIZE - n) return this.memR(this.sysmem, a, n)
      throw new BusFault(a, false, 'boot alias beyond system memory (BOOT0 = 1)')
    }
    const so = (a - SYSMEM_BASE) >>> 0
    if (so <= SYSMEM_SIZE + OPTB_SIZE - n) return this.memR(this.sysmem, so, n)
    const slot = this.slotAt(a)
    if (slot) {
      if (a & (n - 1)) throw new BusFault(a, false, `unaligned ${n * 8}-bit peripheral read`)
      return slot.read(a & 0x3ff, n) >>> 0
    }
    if (a >= EXT_PPB_BASE && a < EXT_PPB_END && this.extPpb) return this.extPpb.read(a - EXT_PPB_BASE, n) >>> 0
    throw new BusFault(a, false, `read from ${regionName(a)}`)
  }

  private slowW(a: number, v: number, n: AccessSize): void {
    const slot = this.slotAt(a)
    if (slot) {
      if (a & (n - 1)) throw new BusFault(a, true, `unaligned ${n * 8}-bit peripheral write`)
      slot.write(a & 0x3ff, v, n)
      return
    }
    const fo = (a - FLASH_BASE) >>> 0
    if (fo <= FLASH_MAPPED - n || (a <= FLASH_MAPPED - n && !this.bootFromSystem)) {
      const abs = fo <= FLASH_MAPPED - n ? a : a + FLASH_BASE
      if (!this.flashWriter) throw new BusFault(a, true, 'flash is not writable')
      this.flashWriter.program(abs, v, n)
      return
    }
    if (a >= EXT_PPB_BASE && a < EXT_PPB_END && this.extPpb) {
      this.extPpb.write(a - EXT_PPB_BASE, v, n)
      return
    }
    const so = (a - SYSMEM_BASE) >>> 0
    if (so < SYSMEM_SIZE + OPTB_SIZE) throw new BusFault(a, true, 'system memory / option bytes are read-only on the bus')
    throw new BusFault(a, true, `write to ${regionName(a)}`)
  }

  private initSystemMemory(): void {
    const s = this.sysmem
    s.fill(0xff)
    const w32 = (o: number, v: number) => {
      for (let i = 0; i < 4; i++) s[o + i] = (v >>> (8 * i)) & 0xff
    }
    // Bootloader stub (BOOT0 = 1): initial SP = top of SRAM, reset vector →
    // offset 8 (Thumb), which holds `b .` (0xE7FE). The real ST bootloader is
    // not reproduced; the SoC logs that it is not emulated.
    w32(0, SRAM_BASE + SRAM_SIZE)
    w32(4, SYSMEM_BASE + 8 + 1)
    s[8] = 0xfe
    s[9] = 0xe7
    // F_SIZE (halfword) and the unique ID
    s[0x7e0] = F_SIZE_KB & 0xff
    s[0x7e1] = F_SIZE_KB >> 8
    s[0x7e2] = 0xff
    s[0x7e3] = 0xff
    w32(0x7e8, UNIQUE_ID[0])
    w32(0x7ec, UNIQUE_ID[1])
    w32(0x7f0, UNIQUE_ID[2])
    // Option bytes: each byte followed by its complement (PM0075 §2.5).
    const ob = [0xa5, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] // RDP, USER, Data0, Data1, WRP0..3
    ob.forEach((b, i) => {
      s[SYSMEM_SIZE + 2 * i] = b
      s[SYSMEM_SIZE + 2 * i + 1] = ~b & 0xff
    })
  }
}

export function regionName(a: number): string {
  const h = '0x' + (a >>> 0).toString(16).padStart(8, '0')
  if (a >= SRAM_BASE + SRAM_SIZE && a < 0x20100000) return `${h} (beyond the 20 KiB of SRAM)`
  if (a >= FLASH_BASE + FLASH_MAPPED && a < 0x08100000) return `${h} (beyond the mapped 128 KiB of flash)`
  if (a >= PERIPH_BASE && a < 0x60000000) return `${h} (reserved peripheral address)`
  if (a >= 0x60000000 && a < 0xa0001000) return `${h} (FSMC region: no external memory controller on the STM32F103C8)`
  return `${h} (unmapped)`
}
