/**
 * Winbond W25Q32JV 32-Mbit (4 MiB) serial NOR flash, SPI modes 0 and 3 —
 * the logic-level model behind the `w25q32_flash` breakout
 * (datasheet W25Q32JV rev. F, §8 instructions, §9.6 AC characteristics).
 *
 *  - Instructions: 9Fh JEDEC ID (EF 40 16), 90h manufacturer/device ID
 *    (EF 15), ABh release power-down / device ID (15), B9h power-down,
 *    03h read, 0Bh fast read (one dummy byte), 06h/04h write enable /
 *    disable, 05h/35h/15h read status registers 1/2/3 (re-sent for as long
 *    as CS stays low, so BUSY can be polled in one transaction), 01h/31h/11h
 *    write status register (SR1[, SR2]), 02h page program, 20h 4 KiB sector,
 *    52h 32 KiB / D8h 64 KiB block and C7h/60h chip erase, 66h + 99h reset.
 *  - Program / erase / status writes need WEL (06h first) and execute only
 *    when CS rises on a byte boundary; then BUSY = 1 for the typical time of
 *    §9.6 (tPP 0.4 ms, tSE 45 ms, tBE1 120 ms, tBE2 150 ms, tCE 10 s,
 *    tW 10 ms); WEL clears when the operation completes. While BUSY only the
 *    status reads are accepted.
 *  - Page program writes the bytes into the 256-byte page buffer; the
 *    address wraps inside the page (more than 256 bytes overwrite the first
 *    ones); programming can only clear bits (new = old AND data).
 *  - Block protection (BP2..BP0, TB, SEC with CMP = 0, §7.1.10 table) is
 *    enforced for program / erase; SRP = 1 with /WP low locks the status
 *    register (hardware protection, §7.1.7). CMP = 1 is not modeled.
 *  - /HOLD low pauses the interface: CLK is ignored and DO is released.
 *  - Power-down (B9h): after tDP (3 µs) every instruction but ABh is
 *    ignored; ABh releases it after tRES1 (3 µs).
 *  - Contents are non-volatile for the session (kept per component id,
 *    erased = 0xFF), like the AT24C02 model.
 */
import type { DigitalDeviceCtx, LogicLevel } from '../digital/api'
import { SpiSlave } from './comm-spi'
import type { SpiSlaveHandler } from './comm-spi'

export const W25Q32_SIZE = 4 * 1024 * 1024
export const W25Q_PAGE = 256
export const W25Q_SECTOR = 4096
/** typical timings, W25Q32JV §9.6 (s) */
export const W25Q_T = {
  pp: 0.4e-3,
  se: 45e-3,
  be32: 120e-3,
  be64: 150e-3,
  ce: 10,
  w: 10e-3,
  dp: 3e-6,
  res1: 3e-6,
  rst: 30e-6,
} as const
export const W25Q_JEDEC = [0xef, 0x40, 0x16] as const
const DEVICE_ID = 0x15

const BUSY = 0x01
const WEL = 0x02

const STORE = new Map<string, Uint8Array>()

/** The persistent array of a W25Q32 component (created erased = 0xFF). */
export function w25qContents(componentId: string): Uint8Array {
  let m = STORE.get(componentId)
  if (!m) {
    m = new Uint8Array(W25Q32_SIZE).fill(0xff)
    STORE.set(componentId, m)
  }
  return m
}

/** Forget a component's contents (tests; a brand-new part). */
export function eraseW25q(componentId: string): void {
  STORE.delete(componentId)
}

type Phase =
  | { k: 'cmd' }
  | { k: 'addr'; cmd: number; n: number; addr: number; need: number }
  | { k: 'dummy'; cmd: number; left: number; addr: number }
  | { k: 'read'; addr: number }
  | { k: 'out'; bytes: number[]; i: number; loop: boolean }
  | { k: 'status'; reg: 1 | 2 | 3 }
  | { k: 'program'; addr: number; buf: Map<number, number> }
  | { k: 'wrsr'; vals: number[] }
  | { k: 'ignore' }

export class W25qFlash implements SpiSlaveHandler {
  readonly mem: Uint8Array
  private spi: SpiSlave
  sr1 = 0
  sr2 = 0
  sr3 = 0
  private phase: Phase = { k: 'cmd' }
  private cmd = -1
  private busyUntil = -1
  private busyHandle = 0
  private powerDown = false
  private pdHandle = 0
  private resetEnabled = false
  private hold = false
  /** statistics (telemetry) */
  programs = 0
  erases = 0
  lastOp = ''

  constructor(
    readonly componentId: string,
    private readonly ctx: DigitalDeviceCtx,
    private readonly driveDo: (d: 'high' | 'low' | 'z') => void,
  ) {
    this.mem = w25qContents(componentId)
    this.spi = new SpiSlave(ctx, { cs: 'CS', sck: 'CLK', mosi: 'DI', miso: 'DO' }, this, (b) => {
      if (this.hold) this.driveDo('z')
      else this.driveDo(b === null ? 'z' : b ? 'high' : 'low')
    })
  }

  // --------------------------------------------------------------- pins

  /** Power-up (VCC above the operating minimum): volatile state reset. */
  powerUp(): void {
    this.cancelBusy()
    if (this.pdHandle) this.ctx.cancel(this.pdHandle)
    this.pdHandle = 0
    this.sr1 &= ~(BUSY | WEL)
    this.powerDown = false
    this.resetEnabled = false
    this.phase = { k: 'cmd' }
    this.hold = this.ctx.read('HOLD') === 0
    this.spi.sync()
  }

  powerOff(): void {
    if (this.busy()) this.ctx.issue('warning', 'power lost while the flash was busy (program / erase): that operation is incomplete')
    this.cancelBusy()
    this.driveDo('z')
  }

  onPin(pin: string, level: LogicLevel): void {
    if (pin === 'HOLD') {
      // /HOLD low pauses the interface (only while CS is low, §6.1.4); DO floats
      this.hold = level === 0
      if (this.hold) this.driveDo('z')
      return
    }
    if (pin === 'CLK' && this.hold && this.spi.isSelected) return
    this.spi.onPin(pin, level)
  }

  // ----------------------------------------------------------- handler

  busy(): boolean {
    return this.busyUntil >= 0 && this.ctx.now() < this.busyUntil
  }

  status1(): number {
    return (this.sr1 & ~BUSY) | (this.busy() ? BUSY : 0)
  }

  select(): void {
    this.phase = { k: 'cmd' }
    this.cmd = -1
  }

  byte(rx: number): void {
    const p = this.phase
    switch (p.k) {
      case 'cmd':
        this.command(rx)
        return
      case 'addr':
        p.addr = ((p.addr << 8) | rx) >>> 0
        if (++p.n === p.need) this.addressDone(p.cmd, p.addr & (W25Q32_SIZE - 1))
        return
      case 'dummy':
        if (--p.left === 0) this.phase = { k: 'read', addr: p.addr }
        return
      case 'program': {
        // address wraps inside the 256-byte page
        p.buf.set(p.addr, rx)
        p.addr = (p.addr & ~(W25Q_PAGE - 1)) | ((p.addr + 1) & (W25Q_PAGE - 1))
        return
      }
      case 'wrsr':
        if (p.vals.length < 2) p.vals.push(rx)
        return
      default:
        return
    }
  }

  next(): number | null {
    const p = this.phase
    switch (p.k) {
      case 'read': {
        const v = this.mem[p.addr]
        p.addr = (p.addr + 1) & (W25Q32_SIZE - 1)
        return v
      }
      case 'status':
        return p.reg === 1 ? this.status1() : p.reg === 2 ? this.sr2 : this.sr3
      case 'out': {
        if (p.i >= p.bytes.length) {
          if (!p.loop) return null
          p.i = 0
        }
        return p.bytes[p.i++]
      }
      default:
        return null
    }
  }

  deselect(partialBits: number): void {
    const p = this.phase
    const whole = partialBits === 0
    this.phase = { k: 'cmd' }
    if (!whole) return
    if (this.cmd === 0xab) {
      this.executeAddressed(0xab, 0)
      return
    }
    if (p.k === 'program') this.executeProgram(p.addr, p.buf)
    else if (p.k === 'wrsr' && p.vals.length > 0) this.executeWrsr(p.vals)
    else if (p.k === 'addr' && p.n === p.need) this.executeAddressed(p.cmd, p.addr & (W25Q32_SIZE - 1))
    // one-byte instructions execute only when CS rises right after their 8th bit
    else if (p.k === 'ignore' && this.cmd >= 0 && this.spi.bytes === 1) this.executeSimple(this.cmd)
  }

  private command(c: number): void {
    this.cmd = c
    if (this.powerDown) {
      // only "release power-down" is decoded (§8.2.30)
      if (c === 0xab) this.phase = { k: 'addr', cmd: c, n: 0, addr: 0, need: 3 }
      else this.phase = { k: 'ignore' }
      if (c !== 0xab) this.cmd = -1
      return
    }
    if (this.busy() && c !== 0x05 && c !== 0x35 && c !== 0x15) {
      this.phase = { k: 'ignore' }
      this.cmd = -1
      return
    }
    switch (c) {
      case 0x9f:
        this.phase = { k: 'out', bytes: [...W25Q_JEDEC], i: 0, loop: true }
        return
      case 0x90:
      case 0xab:
      case 0x03:
      case 0x02:
      case 0x20:
      case 0x52:
      case 0xd8:
        this.phase = { k: 'addr', cmd: c, n: 0, addr: 0, need: 3 }
        return
      case 0x0b:
        this.phase = { k: 'addr', cmd: c, n: 0, addr: 0, need: 3 }
        return
      case 0x05:
        this.phase = { k: 'status', reg: 1 }
        return
      case 0x35:
        this.phase = { k: 'status', reg: 2 }
        return
      case 0x15:
        this.phase = { k: 'status', reg: 3 }
        return
      case 0x01:
        this.phase = { k: 'wrsr', vals: [] }
        return
      case 0x31:
      case 0x11:
        this.phase = { k: 'wrsr', vals: [] }
        return
      case 0x06:
      case 0x04:
      case 0xc7:
      case 0x60:
      case 0xb9:
      case 0x66:
      case 0x99:
        this.phase = { k: 'ignore' } // executes at CS high (byte boundary)
        return
      default:
        this.phase = { k: 'ignore' }
        this.cmd = -1
        this.ctx.log(`W25Q32: instruction 0x${c.toString(16).padStart(2, '0').toUpperCase()} is not modeled — ignored`)
        return
    }
  }

  private addressDone(cmd: number, addr: number): void {
    switch (cmd) {
      case 0x03:
        this.phase = { k: 'read', addr }
        return
      case 0x0b:
        this.phase = { k: 'dummy', cmd, left: 1, addr }
        return
      case 0x90: {
        // address 000000h: manufacturer first; 000001h: device ID first
        const b = (addr & 1) === 0 ? [0xef, DEVICE_ID] : [DEVICE_ID, 0xef]
        this.phase = { k: 'out', bytes: b, i: 0, loop: true }
        return
      }
      case 0xab:
        this.phase = { k: 'out', bytes: [DEVICE_ID], i: 0, loop: true }
        return
      case 0x02:
        if ((this.sr1 & WEL) === 0) {
          this.phase = { k: 'ignore' }
          this.cmd = -1
          return
        }
        this.phase = { k: 'program', addr, buf: new Map() }
        return
      default:
        // erase commands keep the complete address phase until CS rises
        this.phase = { k: 'addr', cmd, n: 3, addr, need: 3 }
        return
    }
  }

  // --------------------------------------------------------- execution

  private executeSimple(c: number): void {
    switch (c) {
      case 0x06:
        this.sr1 |= WEL
        return
      case 0x04:
        this.sr1 &= ~WEL
        return
      case 0xc7:
      case 0x60:
        if (!this.wel()) return
        if (this.protectedRange(0, W25Q32_SIZE)) {
          this.ctx.log('W25Q32: chip erase ignored — part of the array is block-protected')
          return
        }
        this.startBusy(W25Q_T.ce, 'chip erase', () => this.mem.fill(0xff))
        this.erases++
        return
      case 0xb9:
        this.pdHandle = this.ctx.schedule(W25Q_T.dp, () => {
          this.pdHandle = 0
          this.powerDown = true
        })
        return
      case 0x66:
        this.resetEnabled = true
        return
      case 0x99:
        if (!this.resetEnabled) return
        this.resetEnabled = false
        this.cancelBusy()
        this.sr1 &= ~WEL
        this.lastOp = 'reset'
        return
      default:
        return
    }
  }

  private executeAddressed(cmd: number, addr: number): void {
    if (cmd === 0xab) {
      // release from power-down (tRES1); the device ID output is optional
      if (this.pdHandle) this.ctx.cancel(this.pdHandle)
      this.pdHandle = this.ctx.schedule(W25Q_T.res1, () => {
        this.pdHandle = 0
        this.powerDown = false
      })
      return
    }
    if (this.powerDown) return
    const span = cmd === 0x20 ? W25Q_SECTOR : cmd === 0x52 ? 32768 : cmd === 0xd8 ? 65536 : 0
    if (span === 0 || !this.wel()) return
    const base = addr & ~(span - 1)
    if (this.protectedRange(base, span)) {
      this.ctx.log(`W25Q32: erase at 0x${base.toString(16).toUpperCase().padStart(6, '0')} ignored — block-protected (BP bits)`)
      return
    }
    const t = cmd === 0x20 ? W25Q_T.se : cmd === 0x52 ? W25Q_T.be32 : W25Q_T.be64
    const name = cmd === 0x20 ? 'sector erase' : cmd === 0x52 ? 'block erase 32K' : 'block erase 64K'
    this.erases++
    this.startBusy(t, name, () => this.mem.fill(0xff, base, base + span))
  }

  private executeProgram(addr: number, buf: Map<number, number>): void {
    if (!this.wel() || buf.size === 0) return
    const page = addr & ~(W25Q_PAGE - 1)
    if (this.protectedRange(page, W25Q_PAGE)) {
      this.ctx.log(`W25Q32: page program at 0x${page.toString(16).toUpperCase().padStart(6, '0')} ignored — block-protected (BP bits)`)
      return
    }
    const data = new Map(buf)
    this.programs++
    this.startBusy(W25Q_T.pp, 'page program', () => {
      for (const [a, v] of data) this.mem[a] &= v // NOR flash: programming only clears bits
    })
  }

  private executeWrsr(vals: number[]): void {
    if (!this.wel()) return
    // SRP = 1 and /WP low: status register hardware-protected (§7.1.7)
    if ((this.sr1 & 0x80) !== 0 && this.ctx.read('WP') === 0) {
      this.ctx.log('W25Q32: status register write ignored — SRP = 1 and /WP is low (hardware protected)')
      this.sr1 &= ~WEL
      return
    }
    const c = this.cmd
    this.startBusy(W25Q_T.w, 'write status register', () => {
      if (c === 0x01) {
        this.sr1 = (this.sr1 & (BUSY | WEL)) | (vals[0] & 0xfc)
        if (vals.length > 1) this.sr2 = vals[1] & 0x7b
      } else if (c === 0x31) this.sr2 = vals[0] & 0x7b
      else if (c === 0x11) this.sr3 = vals[0] & 0x64
    })
  }

  private wel(): boolean {
    return (this.sr1 & WEL) !== 0
  }

  private startBusy(seconds: number, name: string, done: () => void): void {
    this.cancelBusy()
    this.lastOp = name
    this.busyUntil = this.ctx.now() + seconds
    this.busyHandle = this.ctx.schedule(seconds, () => {
      this.busyHandle = 0
      this.busyUntil = -1
      done()
      this.sr1 &= ~WEL
    })
  }

  private cancelBusy(): void {
    if (this.busyHandle) this.ctx.cancel(this.busyHandle)
    this.busyHandle = 0
    this.busyUntil = -1
  }

  /**
   * Is any byte of [addr, addr+len) protected by BP2..BP0 / TB / SEC
   * (CMP = 0 table, W25Q32JV §7.1.10)?
   */
  protectedRange(addr: number, len: number): boolean {
    const bp = (this.sr1 >>> 2) & 7
    if (bp === 0) return false
    const tb = (this.sr1 >>> 5) & 1
    const sec = (this.sr1 >>> 6) & 1
    let size: number
    if (bp === 7) size = W25Q32_SIZE
    else if (sec) size = Math.min(4096 << (bp - 1), 32768)
    else size = 65536 << (bp - 1)
    size = Math.min(size, W25Q32_SIZE)
    const lo = tb ? 0 : W25Q32_SIZE - size
    const hi = lo + size
    return addr < hi && addr + len > lo
  }
}
