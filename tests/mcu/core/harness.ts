/**
 * Test harness for the Cortex-M3 core: a minimal SystemBus (flash at
 * 0x08000000 aliased at 0, 20 KiB SRAM, a scratch MMIO device, BusFault
 * everywhere else), the shared EventQueue/CycleClock, and a small ELF32
 * reader for the committed test binaries. Deliberately independent of the
 * production SoC bus and loader (src/mcu/stm32f1, src/mcu/loader).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCortexM3, type CortexM3 } from '../../../src/mcu/core/cpu'
import type { CoreConfig, CoreHooks } from '../../../src/mcu/core/cpu-api'
import { EventQueue } from '../../../src/mcu/core/scheduler'
import { BusFault, type CycleClock, type StopReason, type SystemBus } from '../../../src/mcu/core/types'

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/cpu')
export const FW_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../firmware/dist')

export const FLASH_BASE = 0x08000000
export const FLASH_SIZE = 128 * 1024
export const SRAM_BASE = 0x20000000
export const SRAM_SIZE = 20 * 1024
export const MMIO_BASE = 0x40000000
export const MMIO_SIZE = 0x400

/** STM32F103 core configuration (cpu-api.ts) */
export const STM32F103_CORE: CoreConfig = { cpuid: 0x411fc231, numIrq: 43, priorityBits: 4, systickCalib: 0x00002328 }

export interface MmioAccess {
  addr: number
  size: number
  write: boolean
  value: number
  cycle: number
}

/**
 * Scratch MMIO device at 0x40000000 (word registers):
 *  +0x00 DATA   read/write scratch register
 *  +0x04 LOG    writes are appended to `logWrites` (reads: number of writes)
 *  +0x08 IRQ    write (level << 8 | irq) → core.setIrqLine(irq, level)
 *  +0x0C PEND   write irq → core.pendIrq(irq)
 *  +0x10 TIMER  write N → after N cycles assert IRQ line `timerIrq` (+0x14)
 *  +0x14 TIRQ   IRQ number used by TIMER
 *  +0x18 CYC    read: clock.cycles (low 32 bits)
 *  +0x1C SYNC   write → core.requestSync()
 *  +0x20 NMI    write → core.pendNmi()
 *  +0x24 EVT    write → core.signalEvent()
 *  +0x28 DROP   write irq → core.setIrqLine(irq, false)
 * Every access is recorded in `accesses`.
 */
export class TestBus implements SystemBus {
  codeVersion = 0
  readonly codeWriteRange = { start: 0, end: 0 }
  readonly flash = new Uint8Array(FLASH_SIZE).fill(0xff)
  readonly sram = new Uint8Array(SRAM_SIZE)
  private readonly fetchedSram = new Uint8Array(SRAM_SIZE >> 10)
  readonly accesses: MmioAccess[] = []
  readonly logWrites: number[] = []
  data = 0
  timerIrq = 0
  core: CortexM3 | null = null

  constructor(
    readonly clock: CycleClock,
    readonly sched: EventQueue,
  ) {}

  /** test-side image load into flash (bumps codeVersion like a programmer would) */
  loadFlash(addr: number, bytes: Uint8Array): void {
    const o = addr - FLASH_BASE
    if (o < 0 || o + bytes.length > FLASH_SIZE) throw new Error(`image segment 0x${addr.toString(16)} outside flash`)
    this.flash.set(bytes, o)
    this.touch(addr, addr + bytes.length)
  }

  loadSram(addr: number, bytes: Uint8Array): void {
    this.sram.set(bytes, addr - SRAM_BASE)
    this.touch(addr, addr + bytes.length)
  }

  private touch(start: number, end: number): void {
    this.codeVersion++
    this.codeWriteRange.start = start
    this.codeWriteRange.end = end
  }

  private flashOff(a: number, n: number): number {
    let o = (a - FLASH_BASE) >>> 0
    if (o <= FLASH_SIZE - n) return o
    o = a >>> 0
    if (o <= FLASH_SIZE - n) return o // boot alias at 0x00000000
    return -1
  }

  private sramOff(a: number, n: number): number {
    const o = (a - SRAM_BASE) >>> 0
    return o <= SRAM_SIZE - n ? o : -1
  }

  private rd(a: number, n: 1 | 2 | 4, fetch: boolean): number {
    a = a >>> 0
    let o = this.sramOff(a, n)
    if (o >= 0) {
      if (fetch) this.fetchedSram[o >> 10] = 1
      return le(this.sram, o, n)
    }
    o = this.flashOff(a, n)
    if (o >= 0) return le(this.flash, o, n)
    if (!fetch && a >= MMIO_BASE && a < MMIO_BASE + MMIO_SIZE) return this.mmioRead(a - MMIO_BASE, n)
    throw new BusFault(a, false, `unmapped ${fetch ? 'fetch' : 'read'}`)
  }

  private wr(a: number, v: number, n: 1 | 2 | 4): void {
    a = a >>> 0
    const o = this.sramOff(a, n)
    if (o >= 0) {
      for (let i = 0; i < n; i++) this.sram[o + i] = (v >>> (8 * i)) & 0xff
      if (this.fetchedSram[o >> 10] || this.fetchedSram[(o + n - 1) >> 10]) this.touch(a, a + n)
      return
    }
    if (a >= MMIO_BASE && a < MMIO_BASE + MMIO_SIZE) return this.mmioWrite(a - MMIO_BASE, v >>> 0, n)
    throw new BusFault(a, true, this.flashOff(a, n) >= 0 ? 'flash is read-only' : 'unmapped write')
  }

  read8(a: number): number {
    return this.rd(a, 1, false)
  }
  read16(a: number): number {
    return this.rd(a, 2, false)
  }
  read32(a: number): number {
    return this.rd(a, 4, false)
  }
  write8(a: number, v: number): void {
    this.wr(a, v, 1)
  }
  write16(a: number, v: number): void {
    this.wr(a, v, 2)
  }
  write32(a: number, v: number): void {
    this.wr(a, v, 4)
  }
  fetch16(a: number): number {
    return this.rd(a, 2, true)
  }

  private mmioRead(off: number, n: number): number {
    const value = off === 0 ? this.data : off === 4 ? this.logWrites.length : off === 0x18 ? this.clock.cycles >>> 0 : off === 0x14 ? this.timerIrq : 0
    this.accesses.push({ addr: MMIO_BASE + off, size: n, write: false, value, cycle: this.clock.cycles })
    return value >>> 0
  }

  private mmioWrite(off: number, v: number, n: number): void {
    this.accesses.push({ addr: MMIO_BASE + off, size: n, write: true, value: v, cycle: this.clock.cycles })
    const core = this.core!
    switch (off) {
      case 0x00:
        this.data = v
        break
      case 0x04:
        this.logWrites.push(v)
        break
      case 0x08:
        core.setIrqLine(v & 0xff, ((v >> 8) & 1) === 1)
        break
      case 0x0c:
        core.pendIrq(v)
        break
      case 0x10: {
        const irq = this.timerIrq
        this.sched.schedule(this.clock.cycles + v, () => core.setIrqLine(irq, true))
        break
      }
      case 0x14:
        this.timerIrq = v
        break
      case 0x1c:
        core.requestSync()
        break
      case 0x20:
        core.pendNmi()
        break
      case 0x24:
        core.signalEvent()
        break
      case 0x28:
        core.setIrqLine(v & 0xff, false)
        break
    }
  }
}

function le(m: Uint8Array, o: number, n: number): number {
  if (n === 1) return m[o]
  if (n === 2) return m[o] | (m[o + 1] << 8)
  return (m[o] | (m[o + 1] << 8) | (m[o + 2] << 16) | (m[o + 3] << 24)) >>> 0
}

// ------------------------------------------------------------------ ELF

export interface ElfImage {
  entry: number
  /** loadable segments at their LOAD (physical) address */
  segments: { addr: number; data: Uint8Array }[]
  symbols: Map<string, number>
  /** section name → { addr, data } (SHT_PROGBITS only) */
  sections: Map<string, { addr: number; data: Uint8Array }>
}

/** Minimal ELF32 little-endian reader (program headers, sections, .symtab). */
export function readElf(bytes: Uint8Array): ElfImage {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, false) !== 0x7f454c46) throw new Error('not an ELF file')
  if (bytes[4] !== 1 || bytes[5] !== 1) throw new Error('only ELF32 little-endian is supported')
  const entry = dv.getUint32(24, true)
  const phoff = dv.getUint32(28, true)
  const shoff = dv.getUint32(32, true)
  const phentsize = dv.getUint16(42, true)
  const phnum = dv.getUint16(44, true)
  const shentsize = dv.getUint16(46, true)
  const shnum = dv.getUint16(48, true)
  const shstrndx = dv.getUint16(50, true)
  const segments: ElfImage['segments'] = []
  for (let i = 0; i < phnum; i++) {
    const b = phoff + i * phentsize
    if (dv.getUint32(b, true) !== 1) continue // PT_LOAD
    const off = dv.getUint32(b + 4, true)
    const paddr = dv.getUint32(b + 12, true)
    const filesz = dv.getUint32(b + 16, true)
    if (filesz > 0) segments.push({ addr: paddr, data: bytes.slice(off, off + filesz) })
  }
  const sh = (i: number) => {
    const b = shoff + i * shentsize
    return {
      name: dv.getUint32(b, true),
      type: dv.getUint32(b + 4, true),
      addr: dv.getUint32(b + 12, true),
      offset: dv.getUint32(b + 16, true),
      size: dv.getUint32(b + 20, true),
      link: dv.getUint32(b + 24, true),
      entsize: dv.getUint32(b + 36, true),
    }
  }
  const cstr = (off: number) => {
    let e = off
    while (bytes[e] !== 0) e++
    return new TextDecoder().decode(bytes.subarray(off, e))
  }
  const shstr = sh(shstrndx)
  const symbols = new Map<string, number>()
  const sections = new Map<string, { addr: number; data: Uint8Array }>()
  for (let i = 0; i < shnum; i++) {
    const s = sh(i)
    const name = cstr(shstr.offset + s.name)
    if (s.type === 1) sections.set(name, { addr: s.addr, data: bytes.slice(s.offset, s.offset + s.size) })
    if (s.type !== 2) continue // SHT_SYMTAB
    const strtab = sh(s.link)
    for (let o = s.offset; o < s.offset + s.size; o += s.entsize || 16) {
      const nm = cstr(strtab.offset + dv.getUint32(o, true))
      if (nm) symbols.set(nm, dv.getUint32(o + 4, true))
    }
  }
  return { entry, segments, symbols, sections }
}

export function loadElfFile(file: string): ElfImage {
  return readElf(new Uint8Array(readFileSync(file)))
}

// ------------------------------------------------------------- machine

export interface LogLine {
  level: string
  message: string
}

export interface Machine {
  core: CortexM3
  bus: TestBus
  sched: EventQueue
  clock: CycleClock
  logs: LogLine[]
  itm: { port: number; value: number; size: number }[]
  resets: number[]
  sleepEvents: boolean[]
  elf: ElfImage | null
  /** run until a stop reason other than 'target'/'sleep' or until `maxCycles` more cycles */
  runToStop(maxCycles?: number): StopReason
  sym(name: string): number
  r32(addr: number): number
  w32(addr: number, v: number): void
}

export interface MachineOptions {
  config?: Partial<CoreConfig>
  refDivider?: number
  hooks?: Partial<CoreHooks>
}

export function makeMachine(elf: ElfImage | null, opts: MachineOptions = {}): Machine {
  const clock: CycleClock = { cycles: 0 }
  const sched = new EventQueue()
  const bus = new TestBus(clock, sched)
  const logs: LogLine[] = []
  const itm: Machine['itm'] = []
  const resets: number[] = []
  const sleepEvents: boolean[] = []
  if (elf) {
    for (const s of elf.segments) {
      if (s.addr >= FLASH_BASE && s.addr < FLASH_BASE + FLASH_SIZE) bus.loadFlash(s.addr, s.data)
      else if (s.addr >= SRAM_BASE && s.addr < SRAM_BASE + SRAM_SIZE) bus.loadSram(s.addr, s.data)
      else throw new Error(`segment at 0x${s.addr.toString(16)} not loadable`)
    }
  }
  const hooks: CoreHooks = {
    systemResetRequest: () => resets.push(clock.cycles),
    systickRefDivider: () => opts.refDivider ?? 8,
    itmWrite: (port, value, size) => itm.push({ port, value, size }),
    sleepChanged: (s) => sleepEvents.push(s),
    log: (level, message) => logs.push({ level, message }),
    ...opts.hooks,
  }
  const core = createCortexM3(bus, sched, clock, hooks, { ...STM32F103_CORE, ...opts.config }) as CortexM3
  bus.core = core
  core.reset()
  const m: Machine = {
    core,
    bus,
    sched,
    clock,
    logs,
    itm,
    resets,
    sleepEvents,
    elf,
    runToStop(maxCycles = 50_000_000) {
      const end = clock.cycles + maxCycles
      for (;;) {
        const why = core.run(end)
        if (why === 'sync') continue
        if (why === 'sleep' && clock.cycles < end) continue
        return why
      }
    },
    sym(name) {
      const v = elf?.symbols.get(name)
      if (v === undefined) throw new Error(`symbol ${name} not found`)
      return v
    },
    r32(addr) {
      return bus.read32(addr) >>> 0
    },
    w32(addr, v) {
      bus.write32(addr, v)
    },
  }
  return m
}

/** load a committed CPU fixture (tests/fixtures/cpu/<name>.elf) */
export function fixture(name: string, opts?: MachineOptions): Machine {
  return makeMachine(loadElfFile(path.join(FIXTURES, `${name}.elf`)), opts)
}

/** words of a memory range */
export function words(m: Machine, addr: number, count: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(m.r32(addr + 4 * i))
  return out
}

export const hex = (v: number): string => '0x' + (v >>> 0).toString(16).padStart(8, '0')
