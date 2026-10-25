/**
 * CRC calculation unit (RM0008 ch. 4). Base 0x4002_3000, gated by
 * RCC_AHBENR.CRCEN.
 *
 * CRC-32 (Ethernet polynomial 0x04C11DB7), 32-bit words fed MSB first, no
 * input/output reflection, no final XOR: DR = CRC(DR, written word). DR
 * resets to 0xFFFFFFFF (also via CR.RESET); IDR is an 8-bit scratch
 * register untouched by CR.RESET. The 4-AHB-cycle computation time is not
 * modelled (a DR read right after a write already sees the result — on
 * silicon the read stalls until it is ready, so software observes the same).
 * The unit only processes whole words; a byte/half-word write to DR is
 * processed as a zero-extended word and logged.
 */
import type { AccessSize } from '../core/types'
import type { RccGate, SocContext, Stm32Peripheral } from './periph-api'
import { AHB, RegisterBlock } from './block'

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i << 24
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1
    t[i] = c >>> 0
  }
  return t
})()

/** STM32 CRC-32 step: one 32-bit word, MSB first. */
export function crc32Word(crc: number, word: number): number {
  let c = (crc ^ word) >>> 0
  for (let i = 0; i < 4; i++) c = ((c << 8) ^ TABLE[c >>> 24]) >>> 0
  return c
}

export class Crc extends RegisterBlock implements Stm32Peripheral {
  readonly name = 'CRC'
  readonly base = 0x40023000
  readonly size = 0x400
  readonly gate: RccGate = AHB(6)
  private dr = 0xffffffff
  private idr = 0
  private ctx: SocContext | null = null

  attach(ctx: SocContext): void {
    this.ctx = ctx
  }

  reset(): void {
    this.dr = 0xffffffff
    this.idr = 0
  }

  override write(offset: number, value: number, size: AccessSize): void {
    if ((offset & ~3) === 0 && size !== 4) {
      this.ctx?.log('warning', 'CRC', `${size * 8}-bit write to CRC_DR: the STM32F1 CRC unit only processes 32-bit words (processed as a zero-extended word)`)
      this.dr = crc32Word(this.dr, value & (size === 2 ? 0xffff : 0xff))
      return
    }
    super.write(offset, value, size)
  }

  read32(off: number): number {
    if (off === 0) return this.dr
    if (off === 4) return this.idr
    return 0
  }

  write32(off: number, v: number, m: number): void {
    if (off === 0) this.dr = crc32Word(this.dr, v)
    else if (off === 4) {
      if (m & 0xff) this.idr = v & 0xff
    } else if (off === 8) {
      if (v & m & 1) this.dr = 0xffffffff
    }
  }
}
