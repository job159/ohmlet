/**
 * IWDG — independent watchdog (RM0008 ch. 19). Base 0x4000_3000, no RCC
 * enable bit: it runs from the LSI (40 kHz nominal, DS5319 Table 24), so
 * its timing is independent of the core clock and is scheduled in absolute
 * time.
 *
 *  KR   0xCCCC start (forces the LSI on; the counter starts at 0xFFF),
 *       0xAAAA reload from RLR (and re-protects PR/RLR),
 *       0x5555 unlock PR/RLR; any other value re-protects them
 *  PR   /4 … /256 (PR = 0..6; 7 = /256)          RLR  12-bit reload, 0xFFF
 *  SR   PVU / RVU: an update takes up to 5 LSI periods (§19.4.4) — the new
 *       value applies when the flag clears
 * Timeout = prescaler · (counter + 1) / f_LSI (Table 96: /4, RL = 0 → 0.1 ms;
 * /256, RL = 0xFFF → 26.2 s). Reaching zero resets the MCU with
 * RCC_CSR.IWDGRSTF. Once started it can only be stopped by a reset.
 * DBGMCU_CR.DBG_IWDG_STOP freezes the counter while the core is halted.
 * The hardware-watchdog option (WDG_SW = 0) does not apply: the option
 * bytes keep their factory value (software watchdog).
 */
import { RegisterBlock, type SocBlock, type SocEnv } from './block'

const PRESC = [4, 8, 16, 32, 64, 128, 256, 256]
const UPDATE_S = 5 / 40_000

export class Iwdg extends RegisterBlock implements SocBlock {
  readonly name = 'IWDG'
  private pr = 0
  private rlr = 0xfff
  private pvu = false
  private rvu = false
  private access = false
  private running = false
  /** counter value at `anchor` (seconds) */
  private cnt0 = 0xfff
  private anchor = 0
  private presc = 4 // prescaler the counter currently runs with
  private ev = 0
  private evPvu = 0
  private evRvu = 0
  private frozenAt: number | null = null

  constructor(private env: SocEnv) {
    super()
  }

  reset(): void {
    for (const h of [this.ev, this.evPvu, this.evRvu]) this.env.cancelTime(h)
    this.ev = this.evPvu = this.evRvu = 0
    this.pr = 0
    this.rlr = 0xfff
    this.pvu = this.rvu = false
    this.access = false
    this.running = false
    this.frozenAt = null
  }

  /** current down-counter value (debug / tests) */
  counter(): number {
    if (!this.running) return this.rlr
    const t = this.frozenAt ?? this.env.time()
    const ticks = Math.floor(((t - this.anchor) * this.env.ctx.clocks.lsi()) / this.presc + 1e-9)
    return Math.max(0, this.cnt0 - ticks)
  }

  read32(off: number): number {
    switch (off) {
      case 0x04:
        return this.pr
      case 0x08:
        return this.rlr
      case 0x0c:
        return +this.pvu | (+this.rvu << 1)
      default:
        return 0 // KR is write-only
    }
  }

  write32(off: number, v: number, m: number): void {
    switch (off) {
      case 0x00: {
        if ((m & 0xffff) !== 0xffff) return // the key must be written as a whole half-word
        const key = v & 0xffff
        if (key === 0x5555) {
          this.access = true
          return
        }
        this.access = false
        if (key === 0xcccc) {
          if (!this.running) {
            this.running = true
            this.env.forceLsi()
            this.load(0xfff)
            this.env.ctx.log('info', 'IWDG', `independent watchdog started (timeout ${(this.timeout(0xfff) * 1e3).toFixed(1)} ms until the first reload)`)
          }
        } else if (key === 0xaaaa) {
          if (this.running) this.load(this.rlr)
        }
        return
      }
      case 0x04:
        if (!this.access) return
        if (m & 7) {
          this.pr = v & 7
          this.pvu = true
          this.env.cancelTime(this.evPvu)
          this.evPvu = this.env.atTime(this.env.time() + UPDATE_S, () => {
            this.evPvu = 0
            this.pvu = false
            // the running counter continues at the new prescaler rate
            if (this.running && this.frozenAt === null) this.reanchor()
          })
        }
        return
      case 0x08:
        if (!this.access) return
        this.rlr = (this.rlr & ~(m & 0xfff)) | (v & m & 0xfff)
        this.rvu = true
        this.env.cancelTime(this.evRvu)
        this.evRvu = this.env.atTime(this.env.time() + UPDATE_S, () => {
          this.evRvu = 0
          this.rvu = false
        })
        return
    }
  }

  debugHalt(halted: boolean): void {
    if (!this.running) return
    if (halted && this.frozenAt === null) {
      this.frozenAt = this.env.time()
      this.env.cancelTime(this.ev)
      this.ev = 0
    } else if (!halted && this.frozenAt !== null) {
      const frozenFor = this.env.time() - this.frozenAt
      this.anchor += frozenFor
      this.frozenAt = null
      this.arm()
    }
  }

  private timeout(count: number): number {
    return (PRESC[this.pr] * (count + 1)) / this.env.ctx.clocks.lsi()
  }

  private load(count: number): void {
    this.cnt0 = count
    this.anchor = this.frozenAt ?? this.env.time()
    this.presc = PRESC[this.pr]
    if (this.frozenAt === null) this.arm()
  }

  private reanchor(): void {
    const c = this.counter()
    this.cnt0 = c
    this.anchor = this.env.time()
    this.presc = PRESC[this.pr]
    this.arm()
  }

  private arm(): void {
    this.env.cancelTime(this.ev)
    const expiry = this.anchor + (this.presc * (this.cnt0 + 1)) / this.env.ctx.clocks.lsi()
    this.ev = this.env.atTime(expiry, () => {
      this.ev = 0
      this.env.ctx.log('warning', 'IWDG', 'independent watchdog timeout: MCU reset (RCC_CSR.IWDGRSTF)')
      this.env.systemReset('IWDG')
    })
  }
}
