/**
 * AFIO — alternate-function I/O and debug configuration (RM0008 §9.4).
 * Base 0x4001_0000, gated by RCC_APB2ENR.AFIOEN (the classic beginner bug:
 * EXTICR writes with the AFIO clock off are silently lost, like on silicon).
 *
 *  EVCR   PIN/PORT/EVOE — Cortex EVENTOUT on a pin (stored; the SEV pulse
 *         is not routed, logged as unsupported when EVOE is set)
 *  MAPR   peripheral remaps + SWJ_CFG. SWJ_CFG is write-only (reads 0) and
 *         only the values 000/001/010/100 act: "other combinations: no
 *         effect" (§9.4.2) — which HAL relies on: AFIO_REMAP_ENABLE() writes
 *         SWJ_CFG = 111 together with every remap bit.
 *  EXTICR1–4  EXTI line → port selection
 *  MAPR2  medium-density parts have no MAPR2 remaps (the bits are for XL /
 *         value-line devices): stored, with a warning when set.
 */
import type { AfioRemap } from './periph-api'
import { merge, RegisterBlock } from './block'

export interface AfioHost {
  remapChanged(): void
  logOnce(key: string, level: 'info' | 'warning' | 'error', msg: string): void
}

export class Afio extends RegisterBlock {
  readonly name = 'AFIO'
  evcr = 0
  /** MAPR without SWJ_CFG */
  mapr = 0
  swj: 0 | 1 | 2 | 4 = 0
  readonly exticr = new Uint8Array(16) // port index per EXTI line 0..15
  mapr2 = 0

  constructor(private host: AfioHost) {
    super()
  }

  reset(): void {
    const changed = this.mapr !== 0 || this.swj !== 0
    this.evcr = 0
    this.mapr = 0
    this.swj = 0
    this.exticr.fill(0)
    this.mapr2 = 0
    if (changed) this.host.remapChanged()
  }

  get pd01Remap(): boolean {
    return ((this.mapr >>> 15) & 1) === 1
  }

  remap(): AfioRemap {
    const m = this.mapr
    const u3 = (m >>> 4) & 3
    const t1 = (m >>> 6) & 3
    const t3 = (m >>> 10) & 3
    return {
      spi1: (m & 1) === 1,
      i2c1: ((m >>> 1) & 1) === 1,
      usart1: ((m >>> 2) & 1) === 1,
      usart2: ((m >>> 3) & 1) === 1,
      usart3: u3 === 2 ? 0 : (u3 as 0 | 1 | 3), // 10 = "not used"
      tim1: t1 === 2 ? 0 : (t1 as 0 | 1 | 3),
      tim2: ((m >>> 8) & 3) as 0 | 1 | 2 | 3,
      tim3: t3 === 1 ? 0 : (t3 as 0 | 2 | 3),
      tim4: ((m >>> 12) & 1) === 1,
      swj: this.swj,
    }
  }

  read32(off: number): number {
    switch (off) {
      case 0x00:
        return this.evcr
      case 0x04:
        return this.mapr // SWJ_CFG reads as 0
      case 0x08:
      case 0x0c:
      case 0x10:
      case 0x14: {
        const base = ((off - 8) >> 2) * 4
        let v = 0
        for (let i = 0; i < 4; i++) v |= this.exticr[base + i] << (i * 4)
        return v
      }
      case 0x1c:
        return this.mapr2
      default:
        return 0
    }
  }

  write32(off: number, v: number, m: number): void {
    switch (off) {
      case 0x00:
        this.evcr = merge(this.evcr, v, m, 0xff)
        if (this.evcr & 0x80) this.host.logOnce('afio-evoe', 'warning', 'AFIO_EVCR.EVOE: the Cortex EVENTOUT pin output is not simulated (unsupported)')
        return
      case 0x04: {
        const old = this.mapr
        const oldSwj = this.swj
        // MAPR bits 20:0 (remaps, PD01, ADC triggers); SWJ_CFG handled separately
        this.mapr = merge(this.mapr, v, m, 0x001fffff)
        if (m & 0x07000000) {
          const s = (v >>> 24) & 7
          if (s === 0 || s === 1 || s === 2 || s === 4) this.swj = s
        }
        if (this.mapr & (3 << 13)) this.host.logOnce('afio-can', 'warning', 'CAN remap set: bxCAN is not implemented (unsupported)')
        if (old !== this.mapr || oldSwj !== this.swj) this.host.remapChanged()
        return
      }
      case 0x08:
      case 0x0c:
      case 0x10:
      case 0x14: {
        const base = ((off - 8) >> 2) * 4
        const w = merge(this.read32(off), v, m, 0xffff)
        for (let i = 0; i < 4; i++) {
          let port = (w >>> (i * 4)) & 0xf
          if (port > 4) {
            this.host.logOnce(`exticr-${base + i}`, 'warning', `EXTICR selects port ${port} for EXTI${base + i}: only ports A–E exist (values 0–4)`)
            port = 7 // no port: the line sees no GPIO
          }
          this.exticr[base + i] = port
        }
        return
      }
      case 0x1c:
        this.mapr2 = merge(this.mapr2, v, m, 0x07e0)
        if (this.mapr2) this.host.logOnce('afio-mapr2', 'warning', 'AFIO_MAPR2 remaps exist only on XL-density / value-line devices: no effect on the STM32F103C8')
        return
    }
  }
}
