/**
 * Flash memory interface (FPEC) — RM0008 §3.3.3 and the flash programming
 * manual PM0075 (§2.3, §3). Base 0x4002_2000, always clocked (FLITFEN only
 * matters in Sleep mode).
 *
 *  - ACR: LATENCY / HLFCYA / PRFTBE (PRFTBS mirrors PRFTBE). Wait states
 *    are not timed (the core decides cycle counts); a LATENCY too low for
 *    SYSCLK (0 WS ≤ 24 MHz, 1 WS ≤ 48 MHz, 2 WS ≤ 72 MHz, PM0075 §3.1) is
 *    reported, because real silicon reads garbage then.
 *  - KEYR / OPTKEYR unlock sequences (KEY1 0x45670123, KEY2 0xCDEF89AB). A
 *    wrong key is a bus error and locks the FPEC until reset (PM0075 §2.3.1).
 *  - PG: half-word programming only (any other width → bus error, §2.3.3);
 *    programming a non-erased half-word sets PGERR and leaves it unchanged,
 *    except writing 0x0000 which always succeeds (§2.3.3 note).
 *  - PER (1 KiB page via AR) / MER (whole mapped array) + STRT.
 *  - SR: BSY for the datasheet duration (DS5319 Table 27: tprog 52.5 µs typ,
 *    tERASE / tME 20 ms — the table's minimum, no typical is given), then
 *    EOP. PGERR / WRPRTERR / EOP are write-1-to-clear.
 *  - Interrupt (IRQ 4): EOP & EOPIE, (PGERR | WRPRTERR) & ERRIE.
 * Not modelled: the CPU stall when it reads flash while BSY = 1 (code keeps
 * running; data is visible immediately — what a stalled read would return),
 * option-byte programming (OPTPG/OPTER are logged and ignored), write
 * protection (WRPR reads 0xFFFFFFFF: nothing protected).
 */
import { BusFault, type AccessSize } from '../core/types'
import { merge, RegisterBlock } from './block'
import { FLASH_BASE, FLASH_MAPPED, FLASH_PAGE, type FlashWriter, type Stm32Bus } from './memory'

export const FLASH_KEY1 = 0x45670123
export const FLASH_KEY2 = 0xcdef89ab
const TPROG_S = 52.5e-6
const TERASE_S = 20e-3
const TMASS_S = 20e-3

const CR_PG = 1 << 0
const CR_PER = 1 << 1
const CR_MER = 1 << 2
const CR_OPTPG = 1 << 4
const CR_OPTER = 1 << 5
const CR_STRT = 1 << 6
const CR_LOCK = 1 << 7
const CR_OPTWRE = 1 << 9
const CR_ERRIE = 1 << 10
const CR_EOPIE = 1 << 12
const SR_BSY = 1 << 0
const SR_PGERR = 1 << 2
const SR_WRPRTERR = 1 << 4
const SR_EOP = 1 << 5

export interface FlashHost {
  time(): number
  atTime(t: number, fn: () => void): number
  cancelTime(h: number): void
  setIrq(asserted: boolean): void
  log(level: 'info' | 'warning' | 'error', msg: string): void
  logOnce(key: string, level: 'info' | 'warning' | 'error', msg: string): void
  hsiOn(): boolean
  /** ACR changed (latency re-check) */
  latencyChanged(): void
}

/** Minimum wait states for a SYSCLK (PM0075 §3.1, FLASH_ACR.LATENCY). */
export function requiredLatency(sysclk: number): number {
  return sysclk <= 24e6 ? 0 : sysclk <= 48e6 ? 1 : 2
}

export class FlashInterface extends RegisterBlock implements FlashWriter {
  readonly name = 'FLASH'
  acr = 0x30
  private sr = 0
  private cr = CR_LOCK
  private ar = 0
  private keyState = 0 // 0 idle, 1 KEY1 seen
  private optKeyState = 0
  private lockedOut = false
  private busyUntil = -Infinity
  private ev = 0

  constructor(
    private bus: Stm32Bus,
    private host: FlashHost,
  ) {
    super()
  }

  get latency(): number {
    return this.acr & 7
  }

  reset(): void {
    this.host.cancelTime(this.ev)
    this.ev = 0
    this.acr = 0x30
    this.sr = 0
    this.cr = CR_LOCK
    this.ar = 0
    this.keyState = this.optKeyState = 0
    this.lockedOut = false
    this.busyUntil = -Infinity
    this.host.setIrq(false)
  }

  read32(off: number): number {
    switch (off) {
      case 0x00:
        return this.acr
      case 0x0c:
        return this.sr
      case 0x10:
        return this.cr
      case 0x14:
        return this.ar
      case 0x1c:
        // OBR with factory option bytes: RDPRT = 0, WDG_SW = nRST_STOP = nRST_STDBY = 1, Data0/1 = 0xFF
        return 0x03fffffc
      case 0x20:
        return 0xffffffff // WRPR: no page write-protected
      default:
        return 0 // KEYR / OPTKEYR are write-only
    }
  }

  write32(off: number, v: number, m: number): void {
    switch (off) {
      case 0x00: {
        const old = this.acr
        // PRFTBS (bit 5) follows PRFTBE (bit 4)
        const w = merge(old, v, m, 0x1f)
        this.acr = (w & 0x1f) | ((w & 0x10) << 1)
        if (old !== this.acr) this.host.latencyChanged()
        return
      }
      case 0x04:
        return this.key((v & m) >>> 0, false)
      case 0x08:
        return this.key((v & m) >>> 0, true)
      case 0x0c: {
        this.sr &= ~(v & m & (SR_PGERR | SR_WRPRTERR | SR_EOP))
        this.updateIrq()
        return
      }
      case 0x10:
        return this.writeCr(merge(this.cr, v, m, 0x16f7))
      case 0x14:
        if (this.sr & SR_BSY) return // PM0075 §3.5: AR is write-blocked while busy
        this.ar = merge(this.ar, v, m, 0xffffffff)
        return
    }
  }

  private key(v: number, opt: boolean): void {
    if (this.lockedOut) {
      throw new BusFault(0x40022000 + (opt ? 8 : 4), true, 'FPEC locked until reset after a wrong key sequence')
    }
    if (!opt) {
      if (!(this.cr & CR_LOCK)) return // already unlocked
      if (this.keyState === 0 && v === FLASH_KEY1) {
        this.keyState = 1
        return
      }
      if (this.keyState === 1 && v === FLASH_KEY2) {
        this.keyState = 0
        this.cr &= ~CR_LOCK
        return
      }
    } else {
      if (this.cr & CR_LOCK) return // option keys are only accepted with FLASH_CR unlocked
      if (this.optKeyState === 0 && v === FLASH_KEY1) {
        this.optKeyState = 1
        return
      }
      if (this.optKeyState === 1 && v === FLASH_KEY2) {
        this.optKeyState = 0
        this.cr |= CR_OPTWRE
        return
      }
    }
    // PM0075 §2.3.1: a wrong sequence locks FPEC + FLASH_CR until reset and is reported as a bus error.
    this.lockedOut = true
    this.cr |= CR_LOCK
    this.host.log('error', `wrong ${opt ? 'OPTKEYR' : 'KEYR'} key 0x${(v >>> 0).toString(16)}: the flash interface is locked until the next reset (bus error)`)
    throw new BusFault(0x40022000 + (opt ? 8 : 4), true, 'wrong flash key sequence')
  }

  private writeCr(v: number): void {
    if (this.cr & CR_LOCK) {
      this.host.logOnce('flash-cr-locked', 'warning', 'FLASH_CR write ignored: the flash interface is locked (HAL_FLASH_Unlock() first)')
      return
    }
    const strtRise = (v & CR_STRT) !== 0 && (this.cr & CR_STRT) === 0
    // LOCK can only be set by software; OPTWRE can only be cleared; STRT is kept while BSY
    let cr = (v & ~(CR_LOCK | CR_OPTWRE | CR_STRT)) | (this.cr & CR_STRT)
    if (v & CR_LOCK) cr |= CR_LOCK
    if (this.cr & CR_OPTWRE && v & CR_OPTWRE) cr |= CR_OPTWRE
    this.cr = cr
    if (v & CR_LOCK) {
      this.keyState = this.optKeyState = 0
    }
    if ((v & (CR_OPTPG | CR_OPTER)) !== 0) {
      this.host.logOnce('flash-opt', 'warning', 'option-byte programming/erase (OPTPG/OPTER) is not supported: ignored, the option bytes keep their factory values')
    }
    if (strtRise && !(cr & CR_LOCK)) {
      if (cr & CR_MER) this.erase(FLASH_BASE, FLASH_MAPPED, TMASS_S, 'mass erase')
      else if (cr & CR_PER) {
        const off = (this.ar - FLASH_BASE) >>> 0
        if (off >= FLASH_MAPPED) {
          this.host.log('warning', `page erase of ${hex(this.ar)}: FLASH_AR is not a main-flash address — nothing erased`)
          return
        }
        const page = off - (off % FLASH_PAGE)
        this.erase(FLASH_BASE + page, FLASH_PAGE, TERASE_S, `page erase ${hex(FLASH_BASE + page)}`)
      }
    }
    this.updateIrq()
  }

  /** FlashWriter: a CPU/DMA write landing in main flash. */
  program(addr: number, value: number, size: AccessSize): void {
    if (!(this.cr & CR_PG) || this.cr & CR_LOCK) {
      this.host.logOnce('flash-write-nopg', 'error', `write to flash ${hex(addr)} without FLASH_CR.PG: bus error (unlock with HAL_FLASH_Unlock(), then program through the FPEC)`)
      throw new BusFault(addr, true, 'flash write without FLASH_CR.PG')
    }
    if (size !== 2) {
      // PM0075 §2.3.3: anything but a half-word is a bus error from the FPEC
      throw new BusFault(addr, true, `${size * 8}-bit flash programming (only half-words can be programmed)`)
    }
    if (!this.host.hsiOn()) this.host.logOnce('flash-hsi', 'warning', 'flash programmed with the HSI off: PM0075 §2.3 requires the HSI for program/erase')
    const off = addr - FLASH_BASE
    const f = this.bus.flash
    const old = f[off] | (f[off + 1] << 8)
    this.ar = addr
    if (old !== 0xffff && value !== 0) {
      this.sr |= SR_PGERR
      this.updateIrq()
      return
    }
    f[off] = value & 0xff
    f[off + 1] = (value >>> 8) & 0xff
    this.bus.touchFlash(addr, addr + 2)
    this.busy(TPROG_S)
  }

  private erase(start: number, len: number, seconds: number, what: string): void {
    if (!this.host.hsiOn()) this.host.logOnce('flash-hsi', 'warning', 'flash erased with the HSI off: PM0075 §2.3 requires the HSI for program/erase')
    this.bus.flash.fill(0xff, start - FLASH_BASE, start - FLASH_BASE + len)
    this.bus.touchFlash(start, start + len)
    this.host.log('info', `${what} started (BSY for ${seconds * 1e3} ms)`)
    this.busy(seconds)
  }

  private busy(seconds: number): void {
    if (seconds !== TPROG_S) this.cr |= CR_STRT // STRT stays set until the erase completes
    const now = this.host.time()
    const start = Math.max(now, this.busyUntil) // a new request waits for the running one (bus stall)
    this.busyUntil = start + seconds
    this.sr |= SR_BSY
    this.host.cancelTime(this.ev)
    this.ev = this.host.atTime(this.busyUntil, () => {
      this.ev = 0
      this.sr = (this.sr & ~SR_BSY) | SR_EOP
      this.cr &= ~CR_STRT
      this.updateIrq()
    })
  }

  private updateIrq(): void {
    const eop = (this.sr & SR_EOP) !== 0 && (this.cr & CR_EOPIE) !== 0
    const err = (this.sr & (SR_PGERR | SR_WRPRTERR)) !== 0 && (this.cr & CR_ERRIE) !== 0
    this.host.setIrq(eop || err)
  }
}

const hex = (v: number) => '0x' + (v >>> 0).toString(16).padStart(8, '0')
