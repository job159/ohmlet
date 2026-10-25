/**
 * WWDG — window watchdog (RM0008 ch. 20). Base 0x4000_2C00, gated by
 * RCC_APB1ENR.WWDGEN, clocked by PCLK1 / 4096 / 2^WDGTB.
 *
 *  CR   T[6:0] (7-bit down-counter, reset 0x7F), WDGA (set-only, cleared
 *       by reset)
 *  CFR  W[6:0] window (reset 0x7F), WDGTB[1:0], EWI (set-only)
 *  SR   EWIF (rc_w0): set when the counter reaches 0x40, interrupt (IRQ 0)
 *       when EWI = 1
 * The counter is free-running (it counts even while WDGA = 0, wrapping
 * 0x00 → 0x7F). With WDGA = 1 the MCU resets (RCC_CSR.WWDGRSTF) when T6
 * clears (0x40 → 0x3F), when software writes T6 = 0, or when it reloads the
 * counter while T > W (outside the window, §20.3). Gated off (WWDGEN = 0)
 * the prescaler stops; DBG_WWDG_STOP freezes it while the core is halted.
 * The prescaler phase is restarted by every CR write (on silicon it is
 * free-running: up to one counter tick of difference).
 */
import { merge, RegisterBlock, type SocBlock, type SocEnv } from './block'

const EWI_IRQ = 0

export class Wwdg extends RegisterBlock implements SocBlock {
  readonly name = 'WWDG'
  private t0 = 0x7f // counter value at anchor
  private anchor = 0 // core cycle
  private wdga = false
  private w = 0x7f
  private wdgtb = 0
  private ewi = false
  private ewif = false
  private running = true // clock enabled and not frozen
  private evEwi = 0
  private evRst = 0
  private enabled = false

  constructor(private env: SocEnv) {
    super()
  }

  attach(): void {
    this.anchor = this.env.ctx.clock.cycles
  }

  reset(): void {
    this.cancel()
    this.t0 = 0x7f
    this.anchor = this.env.ctx.clock.cycles
    this.wdga = false
    this.w = 0x7f
    this.wdgtb = 0
    this.ewi = false
    this.ewif = false
    this.running = this.enabled
    this.env.ctx.setIrq(EWI_IRQ, false)
    this.arm()
  }

  private tickCycles(): number {
    return this.env.ctx.cyclesPerTick(this.env.ctx.clocks.pclk1()) * 4096 * (1 << this.wdgtb)
  }

  /** counter now (7 bits) */
  counter(): number {
    if (!this.running) return this.t0
    const ticks = Math.floor((this.env.ctx.clock.cycles - this.anchor) / this.tickCycles() + 1e-9)
    return (this.t0 - ticks) & 0x7f
  }

  read32(off: number): number {
    switch (off) {
      case 0x00:
        return this.counter() | (+this.wdga << 7)
      case 0x04:
        return this.w | (this.wdgtb << 7) | (+this.ewi << 9)
      case 0x08:
        return +this.ewif
      default:
        return 0
    }
  }

  write32(off: number, v: number, m: number): void {
    switch (off) {
      case 0x00: {
        if (!(m & 0x7f)) {
          if (m & 0x80 && v & 0x80) this.wdga = true
          return
        }
        const cur = this.counter()
        const t = v & 0x7f
        const activating = (v & m & 0x80) !== 0
        if (this.wdga && cur > this.w) {
          return this.fire(`counter reloaded outside the window (T = 0x${cur.toString(16)} > W = 0x${this.w.toString(16)})`)
        }
        if (activating) this.wdga = true
        if (this.wdga && (t & 0x40) === 0) return this.fire('T6 written as 0')
        this.t0 = t
        this.anchor = this.env.ctx.clock.cycles
        this.arm()
        return
      }
      case 0x04: {
        const cur = this.counter()
        const nv = merge(this.read32(4), v, m, 0x3ff)
        this.w = nv & 0x7f
        if (((nv >>> 7) & 3) !== this.wdgtb) {
          // re-anchor so the elapsed ticks stay counted at the old rate
          this.t0 = cur
          this.anchor = this.env.ctx.clock.cycles
          this.wdgtb = (nv >>> 7) & 3
        }
        if (nv & 0x200) this.ewi = true // EWI can only be set by software
        this.updateIrq()
        this.arm()
        return
      }
      case 0x08:
        if (m & 1 && !(v & 1)) this.ewif = false // rc_w0
        this.updateIrq()
        return
    }
  }

  clockEnabled(on: boolean): void {
    this.enabled = on
    this.setRunning(on)
  }

  clockChanged(): void {
    if (!this.running) return
    this.t0 = this.counter()
    this.anchor = this.env.ctx.clock.cycles
    this.arm()
  }

  debugHalt(halted: boolean): void {
    this.setRunning(this.enabled && !halted)
  }

  private setRunning(on: boolean): void {
    if (on === this.running) return
    if (!on) {
      this.t0 = this.counter()
      this.running = false
      this.cancel()
    } else {
      this.running = true
      this.anchor = this.env.ctx.clock.cycles
      this.arm()
    }
  }

  private cancel(): void {
    this.env.ctx.scheduler.cancel(this.evEwi)
    this.env.ctx.scheduler.cancel(this.evRst)
    this.evEwi = this.evRst = 0
  }

  /** schedule the next 0x40 crossing (EWIF) and, when active, the T6 → 0 reset */
  private arm(): void {
    this.cancel()
    if (!this.running) return
    const sch = this.env.ctx.scheduler
    const tick = this.tickCycles()
    const now = this.env.ctx.clock.cycles
    const elapsed = Math.floor((now - this.anchor) / tick + 1e-9)
    const cur = (this.t0 - elapsed) & 0x7f
    let toEwi = (cur - 0x40) & 0x7f
    if (toEwi === 0) toEwi = 128
    this.evEwi = sch.schedule(this.anchor + (elapsed + toEwi) * tick, () => {
      this.evEwi = 0
      this.ewif = true
      this.updateIrq()
      this.arm()
    })
    if (this.wdga) {
      const toRst = (cur - 0x3f) & 0x7f || 128
      this.evRst = sch.schedule(this.anchor + (elapsed + toRst) * tick, () => {
        this.evRst = 0
        this.fire('counter reached 0x3F (T6 cleared)')
      })
    }
  }

  private updateIrq(): void {
    this.env.ctx.setIrq(EWI_IRQ, this.ewif && this.ewi)
  }

  private fire(why: string): void {
    this.env.ctx.log('warning', 'WWDG', `window watchdog reset: ${why} (RCC_CSR.WWDGRSTF)`)
    this.env.systemReset('WWDG')
  }
}
