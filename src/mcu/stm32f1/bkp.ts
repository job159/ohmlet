/**
 * BKP — backup registers (RM0008 ch. 6). Base 0x4000_6C00, gated by
 * RCC_APB1ENR.BKPEN; writes additionally need PWR_CR.DBP (§6.1, §5.4.1).
 * Medium-density: DR1–DR10 (16 bits each, at 0x04…0x28), RTCCR, CR, CSR.
 *
 * The data registers and RTCCR live in the backup domain: a system reset
 * keeps them, a power-on reset (VBAT is tied to VDD on the Blue Pill) or
 * RCC_BDCR.BDRST clears them.
 *
 * Tamper (§6.3.3): with CR.TPE = 1 an active edge on PC13 (TPAL = 0: rising,
 * 1: falling) sets CSR.TEF, resets every DRx (held in reset while TEF = 1)
 * and, with TPIE, raises TIF / the TAMPER interrupt (IRQ 2). Setting TPE
 * while the pin already sits at the active level counts as an event.
 * RTCCR's calibration-clock / alarm outputs on PC13 belong to the RTC
 * (unsupported) and are logged.
 */
import { merge, RegisterBlock, type SocBlock, type SocEnv } from './block'

const TAMPER_IRQ = 2

export class Bkp extends RegisterBlock implements SocBlock {
  readonly name = 'BKP'
  private dr = new Uint16Array(10)
  private rtccr = 0
  private tpe = false
  private tpal = false
  private tpie = false
  private tef = false
  private tif = false
  private unsub: (() => void) | null = null

  constructor(private env: SocEnv) {
    super()
  }

  attach(): void {
    const ctx = this.env.ctx
    const pc13 = ctx.pin('PC13')
    this.unsub = ctx.onPinInput(pc13, (level) => {
      if (this.tpe && level === (this.tpal ? 0 : 1)) this.tamper()
    })
  }

  /** System reset: interrupt enable cleared (TIF / TPIE: §6.4.5), backup data kept. */
  reset(): void {
    this.tpie = false
    this.tif = false
    this.env.ctx.setIrq(TAMPER_IRQ, false)
  }

  backupReset(): void {
    this.dr.fill(0)
    this.rtccr = 0
    this.tpe = this.tpal = this.tpie = this.tef = this.tif = false
    this.env.ctx.setIrq(TAMPER_IRQ, false)
  }

  read32(off: number): number {
    if (off >= 0x04 && off <= 0x28) return this.dr[(off - 4) >> 2]
    switch (off) {
      case 0x2c:
        return this.rtccr
      case 0x30:
        return +this.tpe | (+this.tpal << 1)
      case 0x34:
        return (+this.tpie << 2) | (+this.tef << 8) | (+this.tif << 9)
      default:
        return 0
    }
  }

  write32(off: number, v: number, m: number): void {
    if (!this.env.backupWritable()) {
      this.env.ctx.log('warning', 'BKP', 'backup register write ignored: the backup domain is write-protected — set PWR_CR.DBP first (HAL_PWR_EnableBkUpAccess())')
      return
    }
    if (off >= 0x04 && off <= 0x28) {
      if (this.tef) return // held in reset while TEF = 1
      const i = (off - 4) >> 2
      this.dr[i] = merge(this.dr[i], v, m, 0xffff)
      return
    }
    switch (off) {
      case 0x2c:
        this.rtccr = merge(this.rtccr, v, m, 0x3ff)
        if (this.rtccr & 0x380) this.env.ctx.log('warning', 'BKP', 'BKP_RTCCR CCO/ASOE outputs on PC13 need the RTC, which is not implemented (unsupported)')
        return
      case 0x30: {
        const w = merge(this.read32(0x30), v, m, 3)
        const enable = (w & 1) === 1 && !this.tpe
        this.tpe = (w & 1) === 1
        this.tpal = (w & 2) === 2
        if (enable && this.env.ctx.pinLevel(this.env.ctx.pin('PC13')) === (this.tpal ? 0 : 1)) this.tamper()
        return
      }
      case 0x34: {
        const w = v & m
        if (m & 4) this.tpie = (w & 4) === 4
        if (w & 1) this.tef = false // CTE
        if (w & 2) this.tif = false // CTI
        this.env.ctx.setIrq(TAMPER_IRQ, this.tif && this.tpie)
        return
      }
    }
  }

  private tamper(): void {
    this.tef = true
    this.dr.fill(0)
    if (this.tpie) this.tif = true
    this.env.ctx.log('info', 'BKP', 'tamper event on PC13: backup data registers cleared')
    this.env.ctx.setIrq(TAMPER_IRQ, this.tif && this.tpie)
  }

  detach(): void {
    this.unsub?.()
  }
}
