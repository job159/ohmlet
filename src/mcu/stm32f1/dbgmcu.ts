/**
 * DBGMCU (RM0008 §31.16) at 0xE004_2000 on the external PPB, plus the rest
 * of the external PPB (TPIU 0xE004_0000, ETM 0xE004_1000, ROM table
 * 0xE00F_F000), which reads as zero with a one-time note.
 *
 *  IDCODE  0x2003_6410: DEV_ID 0x410 (medium-density), REV_ID 0x2003
 *          (revision Y/1/2/X, RM0008 §31.6.1). Errata ES096: on silicon this register (and CR)
 *          read 0 unless a debugger is connected; the simulator behaves as
 *          if one were attached (it is the debugger).
 *  CR      DBG_SLEEP/STOP/STANDBY, TRACE_IOEN/MODE (stored, trace not
 *          simulated), DBG_xxx_STOP freeze bits (8..16) honoured while the
 *          core is halted. Reset by power-on only.
 */
import { merge, RegisterBlock } from './block'

export const DBGMCU_IDCODE = 0x20036410

export interface DbgHost {
  /** freeze bits changed (re-evaluate frozen peripherals while halted) */
  freezeChanged(): void
  logOnce(key: string, level: 'info' | 'warning' | 'error', msg: string): void
}

export class ExtPpb extends RegisterBlock {
  readonly name = 'DBGMCU'
  cr = 0

  constructor(private host: DbgHost) {
    super()
  }

  /** power-on only */
  reset(): void {
    this.cr = 0
  }

  read32(off: number): number {
    if (off === 0x2000) return DBGMCU_IDCODE
    if (off === 0x2004) return this.cr
    this.note(off)
    return 0
  }

  write32(off: number, v: number, m: number): void {
    if (off === 0x2004) {
      const old = this.cr
      this.cr = merge(this.cr, v, m, 0x3fffe7)
      if (this.cr & 0x20) this.host.logOnce('dbg-trace', 'warning', 'DBGMCU_CR.TRACE_IOEN: trace output (TRACESWO / TRACEDATA) is not simulated')
      if ((old ^ this.cr) & 0x3fff00) this.host.freezeChanged()
      return
    }
    if (off !== 0x2000) this.note(off)
  }

  private note(off: number): void {
    const a = 0xe0040000 + off
    const what = a < 0xe0041000 ? 'TPIU' : a < 0xe0042000 ? 'ETM' : a >= 0xe00ff000 ? 'ROM table' : 'external PPB'
    this.host.logOnce(`ppb-${what}`, 'warning', `${what} access at 0x${a.toString(16)}: debug component not simulated (reads 0, writes ignored)`)
  }
}
