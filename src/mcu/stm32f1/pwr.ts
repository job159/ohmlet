/**
 * PWR — power control (RM0008 ch. 5). Base 0x4000_7000, gated by
 * RCC_APB1ENR.PWREN.
 *
 *  CR   LPDS, PDDS, CWUF / CSBF (write 1 clears WUF / SBF, read 0), PVDE,
 *       PLS[2:0], DBP (backup-domain write access: RCC_BDCR, BKP, RTC)
 *  CSR  WUF, SBF, PVDO (read-only), EWUP (WKUP pin PA0 → input pull-down)
 *
 * Low-power modes: WFI/WFE with SCB_SCR.SLEEPDEEP = 1 selects Stop
 * (PDDS = 0) or Standby (PDDS = 1). Both are approximated as Sleep — the
 * clocks keep running, SRAM and registers are kept and no wake-up reset
 * happens — and the approximation is logged once. PVD: the simulator does
 * not resolve VDD below the POR threshold, so VDD is taken as nominal and
 * PVDO stays 0 (VDD above every PLS threshold, 2.2–2.9 V).
 */
import { merge, RegisterBlock } from './block'

export interface PwrHost {
  logOnce(key: string, level: 'info' | 'warning' | 'error', msg: string): void
  /** EWUP changed: PA0 pull-down forcing */
  wkupChanged(): void
}

export class Pwr extends RegisterBlock {
  readonly name = 'PWR'
  cr = 0
  private wuf = false
  private sbf = false
  ewup = false

  constructor(private host: PwrHost) {
    super()
  }

  get dbp(): boolean {
    return ((this.cr >>> 8) & 1) === 1
  }

  reset(): void {
    const ew = this.ewup
    this.cr = 0
    this.wuf = this.sbf = false
    this.ewup = false
    if (ew) this.host.wkupChanged()
  }

  /** The core entered a deep-sleep (SLEEPDEEP) WFI/WFE. */
  deepSleep(): void {
    const standby = (this.cr & 2) !== 0
    this.host.logOnce(
      standby ? 'pwr-standby' : 'pwr-stop',
      'warning',
      standby
        ? 'Standby mode (SLEEPDEEP + PDDS) is approximated as Sleep: clocks keep running, SRAM is kept and wake-up does not reset the MCU'
        : 'Stop mode (SLEEPDEEP, PDDS = 0) is approximated as Sleep: HSE/PLL keep running and the wake-up does not switch SYSCLK back to the HSI',
    )
  }

  read32(off: number): number {
    if (off === 0) return this.cr & 0x1f3 // CWUF / CSBF read as 0
    if (off === 4) return (+this.wuf | (+this.sbf << 1) | (+this.ewup << 8)) >>> 0
    return 0
  }

  write32(off: number, v: number, m: number): void {
    if (off === 0) {
      const w = merge(this.cr, v, m, 0x1ff)
      if (w & 4) this.wuf = false
      if (w & 8) this.sbf = false
      this.cr = w & 0x1f3
      if (this.cr & 0x10) this.host.logOnce('pwr-pvd', 'info', 'PVD enabled: VDD is taken as nominal (3.3 V), so PVDO stays 0 and EXTI line 16 never fires')
    } else if (off === 4) {
      const ew = (((v & m) >>> 8) & 1) === 1 || (!(m & 0x100) && this.ewup)
      if (ew !== this.ewup) {
        this.ewup = ew
        this.host.wkupChanged()
      }
    }
  }
}
