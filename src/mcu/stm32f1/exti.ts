/**
 * EXTI — external interrupt/event controller (RM0008 ch. 10). Base
 * 0x4001_0400, no RCC enable bit (always clocked). 19 lines on the F103:
 * 0–15 GPIO (port chosen per line by AFIO_EXTICRx), 16 PVD, 17 RTC alarm,
 * 18 USB wake-up.
 *
 * Edge path (Figure 21): the selected edge (RTSR/FTSR) or a SWIER 0→1 write
 *   · AND IMR → PR (pending, rc_w1) → NVIC line (level = any PR & IMR in the
 *     group): EXTI0..4 → IRQ 6..10, EXTI9_5 → 23, EXTI15_10 → 40, PVD → 1,
 *     RTCAlarm → 41, USBWakeUp → 42 (Table 63);
 *   · AND EMR → event pulse → the core's event input (wakes WFE).
 * Edges are detected on the Schmitt output at the exact core cycle the
 * level changed (pin setInput, or the pin's own output toggling — the input
 * buffer stays active in output modes). Line 16 never fires because the PVD
 * output is constant (VDD is not resolved below the POR threshold); lines 17
 * and 18 belong to unimplemented blocks (RTC, USB).
 */
import { merge, RegisterBlock } from './block'

const MASK = 0x7ffff

/** NVIC IRQ number of an EXTI line. */
export function extiIrq(line: number): number {
  if (line <= 4) return 6 + line
  if (line <= 9) return 23
  if (line <= 15) return 40
  return line === 16 ? 1 : line === 17 ? 41 : 42
}

const GROUPS: { irq: number; mask: number }[] = [
  { irq: 6, mask: 1 << 0 },
  { irq: 7, mask: 1 << 1 },
  { irq: 8, mask: 1 << 2 },
  { irq: 9, mask: 1 << 3 },
  { irq: 10, mask: 1 << 4 },
  { irq: 23, mask: 0x3e0 },
  { irq: 40, mask: 0xfc00 },
  { irq: 1, mask: 1 << 16 },
  { irq: 41, mask: 1 << 17 },
  { irq: 42, mask: 1 << 18 },
]

export interface ExtiHost {
  setIrq(irq: number, asserted: boolean): void
  signalEvent(): void
  /** AFIO_EXTICR port for a GPIO line */
  portOfLine(line: number): number
}

export class Exti extends RegisterBlock {
  readonly name = 'EXTI'
  imr = 0
  emr = 0
  rtsr = 0
  ftsr = 0
  swier = 0
  pr = 0
  private irqState = new Uint8Array(GROUPS.length)

  constructor(private host: ExtiHost) {
    super()
  }

  reset(): void {
    this.imr = this.emr = this.rtsr = this.ftsr = this.swier = this.pr = 0
    this.update()
  }

  /** Schmitt output of GPIO `pin` changed to `level`. */
  pinEdge(pin: number, level: 0 | 1): void {
    const line = pin & 15
    if (this.host.portOfLine(line) !== pin >> 4) return
    const bit = 1 << line
    if (level ? this.rtsr & bit : this.ftsr & bit) this.trigger(bit)
  }

  /** A non-GPIO line (16..18) fired. */
  lineEvent(line: number): void {
    const bit = 1 << line
    this.trigger(bit)
  }

  private trigger(bit: number): void {
    if (this.imr & bit) {
      this.pr |= bit
      this.update()
    }
    if (this.emr & bit) this.host.signalEvent()
  }

  read32(off: number): number {
    switch (off) {
      case 0x00:
        return this.imr
      case 0x04:
        return this.emr
      case 0x08:
        return this.rtsr
      case 0x0c:
        return this.ftsr
      case 0x10:
        return this.swier
      case 0x14:
        return this.pr
      default:
        return 0
    }
  }

  write32(off: number, v: number, m: number): void {
    switch (off) {
      case 0x00:
        this.imr = merge(this.imr, v, m, MASK)
        return this.update()
      case 0x04:
        this.emr = merge(this.emr, v, m, MASK)
        return
      case 0x08:
        this.rtsr = merge(this.rtsr, v, m, MASK)
        return
      case 0x0c:
        this.ftsr = merge(this.ftsr, v, m, MASK)
        return
      case 0x10: {
        const nv = merge(this.swier, v, m, MASK)
        const rise = nv & ~this.swier
        this.swier = nv
        for (let l = 0; l < 19; l++) if ((rise >>> l) & 1) this.trigger(1 << l)
        return
      }
      case 0x14: {
        const clr = v & m & MASK
        this.pr &= ~clr
        this.swier &= ~clr // SWIERx is cleared by clearing PRx (§10.3.5)
        return this.update()
      }
    }
  }

  private update(): void {
    const act = this.pr & this.imr
    for (let i = 0; i < GROUPS.length; i++) {
      const on = (act & GROUPS[i].mask) !== 0 ? 1 : 0
      if (on !== this.irqState[i]) {
        this.irqState[i] = on
        this.host.setIrq(GROUPS[i].irq, on === 1)
      }
    }
  }
}
