/**
 * RCC — reset and clock control (RM0008 ch. 7, low/medium/high-density
 * register map §7.3.11; the connectivity-line registers of ch. 8 —
 * AHBRSTR, CFGR2 — do not exist on the F103 and decode as reserved).
 *
 * Oscillator timing (simulated time, independent of HCLK):
 *   HSI  ready 2 µs after HSION        DS5319 Table 25 tsu(HSI) ≤ 2 µs
 *   HSE  ready 1 ms after HSEON        8 MHz crystal of the Blue Pill. DS5319
 *        Table 22 quotes tsu(HSE) = 2 ms typ for a stabilised VDD; 1 ms is
 *        within the crystal spread and what the HSE stabilisation counter
 *        typically yields on real boards. Bypass (HSEBYP): 1 µs.
 *   PLL  locked 200 µs after PLLON AND a ready input (DS5319 Table 34 tLOCK)
 *   LSI  ready 85 µs after LSION       DS5319 Table 24 tsu(LSI) max
 *   LSE  ready 500 ms after LSEON      DS5319 Table 24 lists tsu(LSE) as
 *        crystal-dependent (order of a second); 500 ms keeps HAL's
 *        LSE_STARTUP_TIMEOUT (5 s) comfortable and the "slow LSE" visible.
 *        Bypass: 1 ms.
 * SYSCLK switching (§7.2.6): SWS follows SW only once the target is ready;
 * a switch to a not-yet-ready source happens when it becomes ready. HSION /
 * HSEON / PLLON cannot be cleared while that clock (directly or through the
 * PLL) is, or is selected to become, the system clock. PLL configuration
 * (PLLSRC, PLLXTPRE, PLLMUL) is writable only while PLLON = 0.
 *
 * Clock security system: CSSON is stored; the simulated crystal never
 * fails, so CSSF / the NMI never fire (stated in the support table).
 */
import type { RccGate, Stm32Clocks } from './periph-api'
import { merge, RegisterBlock, type ResetCause } from './block'

export const HSI_HZ = 8_000_000
export const LSI_HZ = 40_000
export const LSE_HZ = 32_768

const HSI_STARTUP_S = 2e-6
const HSE_STARTUP_S = 1e-3
const HSE_BYPASS_S = 1e-6
const PLL_LOCK_S = 200e-6
const LSI_STARTUP_S = 85e-6
const LSE_STARTUP_S = 0.5
const LSE_BYPASS_S = 1e-3

/** Bits that exist in each enable/reset register on a medium-density F103 (RM0008 §7.3.4–7.3.8). */
export const AHBENR_MASK = 0x55 // DMA1EN 0, SRAMEN 2, FLITFEN 4, CRCEN 6
export const APB2_MASK = 0x5e7d // AFIO 0, IOPA..E 2–6, ADC1 9, ADC2 10, TIM1 11, SPI1 12, USART1 14
export const APB1_MASK = 0x1ae64807 // TIM2..4, WWDG 11, SPI2 14, USART2/3, I2C1/2, USB 23, CAN 25, BKP 27, PWR 28

const CSR_FLAG: Record<ResetCause, number> = {
  PIN: 1 << 26,
  POR: 1 << 27,
  SFT: 1 << 28,
  IWDG: 1 << 29,
  WWDG: 1 << 30,
  LPWR: 1 << 31,
}

const AHB_DIV = [1, 1, 1, 1, 1, 1, 1, 1, 2, 4, 8, 16, 64, 128, 256, 512]
const APB_DIV = [1, 1, 1, 1, 2, 4, 8, 16]
const ADC_DIV = [2, 4, 6, 8]

export interface RccHost {
  time(): number
  atTime(t: number, fn: () => void): number
  cancelTime(h: number): void
  log(level: 'info' | 'warning' | 'error', msg: string): void
  logOnce(key: string, level: 'info' | 'warning' | 'error', msg: string): void
  /** RCC global interrupt, IRQ 5 */
  setIrq(asserted: boolean): void
  /** some derived frequency may have changed */
  clocksChanged(): void
  gateChanged(gate: RccGate, on: boolean): void
  resetLine(gate: RccGate, asserted: boolean): void
  backupWritable(): boolean
  /** RCC_BDCR.BDRST rising edge */
  backupDomainReset(): void
  /** HSEON / LSEON changed: PD0/PD1 and PC14/PC15 become oscillator pins or GPIOs again */
  oscPinsChanged(): void
}

export class Rcc extends RegisterBlock implements Stm32Clocks {
  readonly name = 'RCC'
  /** HSE crystal / external clock frequency (Blue Pill: 8 MHz) */
  hseHz = 8_000_000

  // CR
  private hsion = true
  private hsirdy = true
  private hsitrim = 16
  private readonly hsical = 0x5e // factory calibration byte (fixed for reproducibility)
  private hseon = false
  private hserdy = false
  private hsebyp = false
  private csson = false
  private pllon = false
  private pllrdy = false
  // CFGR
  private sw = 0
  private sws = 0
  private hpre = 0
  private ppre1 = 0
  private ppre2 = 0
  private adcpre = 0
  private pllsrc = 0
  private pllxtpre = 0
  private pllmul = 0
  private usbpre = 0
  private mco = 0
  // CIR
  private cirIe = 0 // bits 12:8
  private cirFlags = 0 // bits 4:0 (+7 CSSF)
  // resets / enables
  apb2rstr = 0
  apb1rstr = 0
  ahbenr = 0x14
  apb2enr = 0
  apb1enr = 0
  // BDCR (backup domain)
  private lseon = false
  private lserdy = false
  private lsebyp = false
  private rtcsel = 0
  private rtcen = false
  private bdrst = false
  // CSR
  private lsion = false
  private lsiForced = false
  private lsirdy = false
  private csrFlags = 0

  private evHsi = 0
  private evHse = 0
  private evPll = 0
  private evLsi = 0
  private evLse = 0
  private pllLockPending = false

  // derived (cached; read on hot paths)
  private _sysclk = HSI_HZ
  private _hclk = HSI_HZ
  private _pclk1 = HSI_HZ
  private _pclk2 = HSI_HZ

  constructor(private host: RccHost) {
    super()
  }

  // ---------------------------------------------------------- Stm32Clocks
  hsiHz(): number {
    // HSITRIM default 16 → 8 MHz; ~40 kHz per step (RM0008 §7.3.1)
    return HSI_HZ + (this.hsitrim - 16) * 40_000
  }
  pllInHz(): number {
    return this.pllsrc ? this.hseHz / (this.pllxtpre ? 2 : 1) : this.hsiHz() / 2
  }
  pllMul(): number {
    return this.pllmul >= 14 ? 16 : this.pllmul + 2
  }
  pllHz(): number {
    return this.pllInHz() * this.pllMul()
  }
  sysclk(): number {
    return this._sysclk
  }
  hclk(): number {
    return this._hclk
  }
  pclk1(): number {
    return this._pclk1
  }
  pclk2(): number {
    return this._pclk2
  }
  timclk1(): number {
    return APB_DIV[this.ppre1] === 1 ? this._pclk1 : this._pclk1 * 2
  }
  timclk2(): number {
    return APB_DIV[this.ppre2] === 1 ? this._pclk2 : this._pclk2 * 2
  }
  adcclk(): number {
    return this._pclk2 / ADC_DIV[this.adcpre]
  }
  lsi(): number {
    return LSI_HZ
  }
  lse(): number {
    return LSE_HZ
  }
  usbclk(): number {
    return this.pllHz() / (this.usbpre ? 1 : 1.5)
  }
  /** SYSCLK source actually in use: 0 HSI, 1 HSE, 2 PLL */
  get sysclkSource(): number {
    return this.sws
  }
  get hseOn(): boolean {
    return this.hseon
  }
  get lseOn(): boolean {
    return this.lseon
  }
  get hsiOn(): boolean {
    return this.hsion
  }
  get lsiRunning(): boolean {
    return this.lsirdy
  }

  isEnabled(gate: RccGate): boolean {
    const r = gate.bus === 'APB2' ? this.apb2enr : gate.bus === 'APB1' ? this.apb1enr : this.ahbenr
    return ((r >>> gate.bit) & 1) === 1
  }
  inReset(gate: RccGate): boolean {
    if (gate.bus === 'AHB') return false // no AHBRSTR on non-connectivity parts
    const r = gate.bus === 'APB2' ? this.apb2rstr : this.apb1rstr
    return ((r >>> gate.bit) & 1) === 1
  }

  // ---------------------------------------------------------- reset

  /** System reset: everything but CSR reset flags and the backup domain (RM0008 §7.1.2). */
  reset(): void {
    for (const h of [this.evHsi, this.evHse, this.evPll, this.evLsi]) this.host.cancelTime(h)
    this.evHsi = this.evHse = this.evPll = this.evLsi = 0
    this.hsion = true
    this.hsirdy = true
    this.hsitrim = 16
    this.hseon = this.hserdy = this.hsebyp = this.csson = false
    this.pllon = this.pllrdy = false
    this.pllLockPending = false
    this.sw = this.sws = 0
    this.hpre = this.ppre1 = this.ppre2 = this.adcpre = 0
    this.pllsrc = this.pllxtpre = this.pllmul = this.usbpre = this.mco = 0
    this.cirIe = this.cirFlags = 0
    this.apb2rstr = this.apb1rstr = 0
    this.ahbenr = 0x14
    this.apb2enr = this.apb1enr = 0
    this.lsion = false
    this.lsiForced = false
    this.lsirdy = false
    this.recompute()
    this.host.setIrq(false)
  }

  /** Power-on / BDRST: the backup-domain part of RCC (BDCR). */
  backupReset(): void {
    this.host.cancelTime(this.evLse)
    this.evLse = 0
    this.lseon = this.lserdy = this.lsebyp = this.rtcen = false
    this.rtcsel = 0
  }

  /** Record a reset cause. POR clears every other flag first (flags survive system resets only). */
  noteReset(cause: ResetCause): void {
    if (cause === 'POR') this.csrFlags = CSR_FLAG.POR | CSR_FLAG.PIN
    // Every internal reset source also pulses NRST through the reset pulse
    // generator (RM0008 §7.1.2, Figure 4), so PINRSTF accompanies it.
    else this.csrFlags |= CSR_FLAG[cause] | CSR_FLAG.PIN
  }

  get resetFlags(): number {
    return this.csrFlags
  }

  /** IWDG start: LSI forced on until reset (RM0008 §7.2.5 / §19.3.1). */
  forceLsi(): void {
    if (this.lsiForced) return
    this.lsiForced = true
    this.updateLsi()
  }

  // ---------------------------------------------------------- registers

  read32(off: number): number {
    switch (off) {
      case 0x00:
        return (
          (+this.hsion | (+this.hsirdy << 1) | (this.hsitrim << 3) | (this.hsical << 8) | (+this.hseon << 16) | (+this.hserdy << 17) |
            (+this.hsebyp << 18) | (+this.csson << 19) | (+this.pllon << 24) | (+this.pllrdy << 25)) >>>
          0
        )
      case 0x04:
        return (
          (this.sw | (this.sws << 2) | (this.hpre << 4) | (this.ppre1 << 8) | (this.ppre2 << 11) | (this.adcpre << 14) | (this.pllsrc << 16) |
            (this.pllxtpre << 17) | (this.pllmul << 18) | (this.usbpre << 22) | (this.mco << 24)) >>>
          0
        )
      case 0x08:
        return (this.cirFlags | (this.cirIe << 8)) >>> 0
      case 0x0c:
        return this.apb2rstr
      case 0x10:
        return this.apb1rstr
      case 0x14:
        return this.ahbenr
      case 0x18:
        return this.apb2enr
      case 0x1c:
        return this.apb1enr
      case 0x20:
        return (+this.lseon | (+this.lserdy << 1) | (+this.lsebyp << 2) | (this.rtcsel << 8) | (+this.rtcen << 15) | (+this.bdrst << 16)) >>> 0
      case 0x24:
        return (+this.lsion | (+this.lsirdy << 1) | this.csrFlags) >>> 0
      default:
        return 0
    }
  }

  write32(off: number, v: number, m: number): void {
    switch (off) {
      case 0x00:
        return this.writeCr(merge(this.read32(0), v, m, 0x010d00f9))
      case 0x04:
        return this.writeCfgr(merge(this.read32(4), v, m, 0x077ffff3))
      case 0x08:
        return this.writeCir(v & m)
      case 0x0c: {
        const old = this.apb2rstr
        this.apb2rstr = merge(old, v, m, APB2_MASK)
        return this.diff(old, this.apb2rstr, 'APB2', (g, on) => this.host.resetLine(g, on))
      }
      case 0x10: {
        const old = this.apb1rstr
        this.apb1rstr = merge(old, v, m, APB1_MASK)
        return this.diff(old, this.apb1rstr, 'APB1', (g, on) => this.host.resetLine(g, on))
      }
      case 0x14: {
        const old = this.ahbenr
        this.ahbenr = merge(old, v, m, AHBENR_MASK)
        return this.diff(old, this.ahbenr, 'AHB', (g, on) => this.host.gateChanged(g, on))
      }
      case 0x18: {
        const old = this.apb2enr
        this.apb2enr = merge(old, v, m, APB2_MASK)
        this.diff(old, this.apb2enr, 'APB2', (g, on) => this.host.gateChanged(g, on))
        if ((this.apb2enr & ~old & 0x600) !== 0) this.checkLimits()
        return
      }
      case 0x1c: {
        const old = this.apb1enr
        this.apb1enr = merge(old, v, m, APB1_MASK)
        this.diff(old, this.apb1enr, 'APB1', (g, on) => this.host.gateChanged(g, on))
        if ((this.apb1enr & ~old & (1 << 23)) !== 0) this.checkLimits()
        return
      }
      case 0x20:
        return this.writeBdcr(merge(this.read32(0x20), v, m, 0x18305))
      case 0x24:
        return this.writeCsr(v, m)
    }
  }

  private diff(old: number, now: number, bus: RccGate['bus'], fn: (g: RccGate, on: boolean) => void): void {
    let ch = (old ^ now) >>> 0
    while (ch) {
      const bit = 31 - Math.clz32(ch)
      ch &= ~(1 << bit)
      fn({ bus, bit }, ((now >>> bit) & 1) === 1)
    }
  }

  private hsiInUse(): boolean {
    return this.sws === 0 || this.sw === 0 || ((this.sws === 2 || this.sw === 2) && this.pllsrc === 0)
  }
  private hseInUse(): boolean {
    return this.sws === 1 || this.sw === 1 || ((this.sws === 2 || this.sw === 2) && this.pllsrc === 1)
  }
  private pllInUse(): boolean {
    return this.sws === 2 || this.sw === 2
  }

  private writeCr(v: number): void {
    const oldTrim = this.hsitrim
    this.hsitrim = (v >>> 3) & 0x1f
    // HSEBYP can only change while the HSE is off (RM0008 §7.3.1)
    if (!this.hseon) this.hsebyp = ((v >>> 18) & 1) === 1
    else if (((v >>> 18) & 1) !== +this.hsebyp) this.host.log('warning', 'HSEBYP ignored: it can only be changed while HSEON = 0')
    this.csson = ((v >>> 19) & 1) === 1
    if (this.csson) this.host.logOnce('rcc-css', 'info', 'clock security system enabled (CSSON): the simulated HSE never fails, so CSS never triggers')

    let hsion = (v & 1) === 1
    if (!hsion && this.hsion && this.hsiInUse()) {
      hsion = true
      this.host.log('warning', 'HSION cannot be cleared while the HSI is (or is selected to be) the system clock or the PLL input')
    }
    let hseon = ((v >>> 16) & 1) === 1
    if (!hseon && this.hseon && this.hseInUse()) {
      hseon = true
      this.host.log('warning', 'HSEON cannot be cleared while the HSE is (or is selected to be) the system clock or the PLL input')
    }
    let pllon = ((v >>> 24) & 1) === 1
    if (!pllon && this.pllon && this.pllInUse()) {
      pllon = true
      this.host.log('warning', 'PLLON cannot be cleared while the PLL is (or is selected to be) the system clock')
    }

    if (hsion !== this.hsion) {
      this.hsion = hsion
      this.host.cancelTime(this.evHsi)
      if (hsion) this.evHsi = this.host.atTime(this.host.time() + HSI_STARTUP_S, () => this.ready('hsi'))
      else this.hsirdy = false
    }
    if (hseon !== this.hseon) {
      this.hseon = hseon
      this.host.oscPinsChanged()
      this.host.cancelTime(this.evHse)
      if (hseon) this.evHse = this.host.atTime(this.host.time() + (this.hsebyp ? HSE_BYPASS_S : HSE_STARTUP_S), () => this.ready('hse'))
      else {
        this.hserdy = false
        if (this.pllon && this.pllsrc === 1) this.dropPll()
      }
    }
    if (pllon !== this.pllon) {
      this.pllon = pllon
      if (pllon) this.startPllLock()
      else this.dropPll()
    }
    if (!this.hsion && this.pllon && this.pllsrc === 0 && this.pllrdy) this.dropPll()
    if (oldTrim !== this.hsitrim) this.recompute() // HSITRIM moves the HSI (and an HSI-fed PLL)
  }

  private dropPll(): void {
    this.host.cancelTime(this.evPll)
    this.evPll = 0
    this.pllLockPending = false
    this.pllrdy = false
  }

  private pllInputReady(): boolean {
    return this.pllsrc ? this.hserdy : this.hsirdy
  }

  private startPllLock(): void {
    this.host.cancelTime(this.evPll)
    this.pllrdy = false
    if (!this.pllInputReady()) {
      this.pllLockPending = true // locks once its input oscillator is stable
      return
    }
    this.pllLockPending = false
    this.evPll = this.host.atTime(this.host.time() + PLL_LOCK_S, () => this.ready('pll'))
    this.checkPllRange()
  }

  private ready(which: 'hsi' | 'hse' | 'pll' | 'lsi' | 'lse'): void {
    const flag = { lsi: 0, lse: 1, hsi: 2, hse: 3, pll: 4 }[which]
    switch (which) {
      case 'hsi':
        this.evHsi = 0
        this.hsirdy = true
        break
      case 'hse':
        this.evHse = 0
        this.hserdy = true
        break
      case 'pll':
        this.evPll = 0
        this.pllrdy = true
        break
      case 'lsi':
        this.evLsi = 0
        this.lsirdy = true
        break
      case 'lse':
        this.evLse = 0
        this.lserdy = true
        break
    }
    // xxxRDYF is set only when the matching xxxRDYIE is set (RM0008 §7.3.3)
    if ((this.cirIe >>> flag) & 1) {
      this.cirFlags |= 1 << flag
      this.updateIrq()
    }
    if (this.pllon && this.pllLockPending && this.pllInputReady()) this.startPllLock()
    this.trySwitch()
  }

  private writeCfgr(v: number): void {
    const pllFields = (v >>> 16) & 0x3f // PLLSRC, PLLXTPRE, PLLMUL
    const cur = this.pllsrc | (this.pllxtpre << 1) | (this.pllmul << 2)
    if (pllFields !== cur) {
      if (this.pllon) {
        this.host.log('warning', 'PLLSRC/PLLXTPRE/PLLMUL write ignored: the PLL configuration can only be changed while PLLON = 0')
      } else {
        this.pllsrc = pllFields & 1
        this.pllxtpre = (pllFields >>> 1) & 1
        this.pllmul = (pllFields >>> 2) & 0xf
      }
    }
    this.hpre = (v >>> 4) & 0xf
    this.ppre1 = (v >>> 8) & 7
    this.ppre2 = (v >>> 11) & 7
    this.adcpre = (v >>> 14) & 3
    this.usbpre = (v >>> 22) & 1
    const mco = (v >>> 24) & 7
    if (mco !== this.mco) {
      this.mco = mco
      if (mco >= 4) {
        this.host.logOnce('rcc-mco', 'warning', 'MCO clock output on PA8 is not simulated (a MHz-rate square wave cannot be represented on the circuit time step): PA8 stays at its AF default')
      }
    }
    const sw = v & 3
    if (sw === 3) this.host.log('warning', 'SW = 11 is "not allowed" (RM0008 §7.3.2): ignored')
    else this.sw = sw
    this.recompute()
    this.trySwitch()
  }

  private trySwitch(): void {
    if (this.sw === this.sws) return
    const ok = this.sw === 0 ? this.hsirdy : this.sw === 1 ? this.hserdy : this.pllrdy
    if (!ok) return // switch completes when the source becomes ready (§7.2.6)
    this.sws = this.sw
    this.recompute()
  }

  private writeCir(w: number): void {
    this.cirIe = (w >>> 8) & 0x1f
    // write-1-to-clear: bits 20:16 clear the ready flags, bit 23 CSSF
    this.cirFlags &= ~((w >>> 16) & 0x1f)
    if (w & (1 << 23)) this.cirFlags &= ~0x80
    this.updateIrq()
  }

  private updateIrq(): void {
    this.host.setIrq((this.cirFlags & this.cirIe & 0x1f) !== 0)
  }

  private writeBdcr(v: number): void {
    if (!this.host.backupWritable()) {
      this.host.logOnce('rcc-bdcr-dbp', 'warning', 'RCC_BDCR write ignored: the backup domain is write-protected — set PWR_CR.DBP first (HAL_PWR_EnableBkUpAccess())')
      return
    }
    const bdrst = ((v >>> 16) & 1) === 1
    if (bdrst && !this.bdrst) {
      this.bdrst = true
      this.host.backupDomainReset()
      return
    }
    this.bdrst = bdrst
    if (this.bdrst) return
    if (!this.lseon) this.lsebyp = ((v >>> 2) & 1) === 1
    const rtcsel = (v >>> 8) & 3
    if (this.rtcsel === 0) this.rtcsel = rtcsel
    else if (rtcsel !== this.rtcsel) this.host.log('warning', 'RTCSEL is fixed until a backup-domain reset (RCC_BDCR.BDRST)')
    this.rtcen = ((v >>> 15) & 1) === 1
    if (this.rtcen) this.host.logOnce('rcc-rtcen', 'warning', 'RTCEN set: the RTC is not implemented (unsupported)')
    const lseon = (v & 1) === 1
    if (lseon !== this.lseon) {
      this.lseon = lseon
      this.host.oscPinsChanged()
      this.host.cancelTime(this.evLse)
      if (lseon) this.evLse = this.host.atTime(this.host.time() + (this.lsebyp ? LSE_BYPASS_S : LSE_STARTUP_S), () => this.ready('lse'))
      else this.lserdy = false
    }
  }

  private writeCsr(v: number, m: number): void {
    if (m & 1) {
      this.lsion = (v & 1) === 1
      this.updateLsi()
    }
    if (v & m & (1 << 24)) this.csrFlags = 0 // RMVF
  }

  private updateLsi(): void {
    const on = this.lsion || this.lsiForced
    if (on && !this.lsirdy && !this.evLsi) {
      this.evLsi = this.host.atTime(this.host.time() + LSI_STARTUP_S, () => this.ready('lsi'))
    } else if (!on) {
      this.host.cancelTime(this.evLsi)
      this.evLsi = 0
      this.lsirdy = false
    }
  }

  // ---------------------------------------------------------- clock tree

  private recompute(): void {
    const sys = this.sws === 0 ? this.hsiHz() : this.sws === 1 ? this.hseHz : this.pllHz()
    const hclk = sys / AHB_DIV[this.hpre]
    const p1 = hclk / APB_DIV[this.ppre1]
    const p2 = hclk / APB_DIV[this.ppre2]
    this._sysclk = sys
    this._hclk = hclk
    this._pclk1 = p1
    this._pclk2 = p2
    this.checkLimits()
    // the host compares the derived frequencies and only rebases / notifies on a real change
    this.host.clocksChanged()
  }

  private checkPllRange(): void {
    const fin = this.pllInHz()
    const fout = this.pllHz()
    if (this.pllsrc === 1 && (fin < 1e6 || fin > 25e6)) {
      this.host.log('warning', `PLL input ${mhz(fin)} is outside 1–25 MHz (DS5319 Table 34)`)
    }
    if (fout < 16e6 || fout > 72e6) this.host.log('warning', `PLL output ${mhz(fout)} is outside 16–72 MHz (DS5319 Table 34, fPLL_OUT)`)
  }

  /** Datasheet limits (DS5319 §5.3.1, Table 9 / RM0008 §7.2): warn, never clamp — real silicon would misbehave. */
  checkLimits(): void {
    if (this._sysclk > 72e6) this.host.log('warning', `SYSCLK ${mhz(this._sysclk)} exceeds the 72 MHz maximum (DS5319 §5.3.1)`)
    if (this._hclk > 72e6) this.host.log('warning', `HCLK ${mhz(this._hclk)} exceeds the 72 MHz maximum`)
    if (this._pclk1 > 36e6) this.host.log('warning', `PCLK1 ${mhz(this._pclk1)} exceeds the 36 MHz APB1 maximum — set PPRE1 (HAL: APB1CLKDivider = RCC_HCLK_DIV2)`)
    if (this._pclk2 > 72e6) this.host.log('warning', `PCLK2 ${mhz(this._pclk2)} exceeds the 72 MHz APB2 maximum`)
    if ((this.apb2enr & 0x600) !== 0 && this.adcclk() > 14e6) {
      this.host.log('warning', `ADCCLK ${mhz(this.adcclk())} exceeds the 14 MHz maximum (DS5319 Table 46) — raise ADCPRE (RCC_PCLK2_DIV6 at 72 MHz)`)
    }
    if ((this.apb1enr & (1 << 23)) !== 0 && Math.abs(this.usbclk() - 48e6) > 1) {
      this.host.log('warning', `USB clock ${mhz(this.usbclk())} is not 48 MHz (RM0008 §7.2.3: PLL must be 72 MHz with USBPRE=0 or 48 MHz with USBPRE=1)`)
    }
  }
}

function mhz(hz: number): string {
  return `${+(hz / 1e6).toFixed(3)} MHz`
}
