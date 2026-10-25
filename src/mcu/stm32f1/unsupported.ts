/**
 * Placeholder for a register block that exists on the STM32F103 die but is
 * not modelled (yet): registers read as zero, writes are ignored, and the
 * first access logs ONE warning naming the block — firmware that relies on
 * it visibly does not work instead of silently half-working.
 */
import type { AccessSize } from '../core/types'
import type { SocBlock, SocEnv } from './block'

export class UnsupportedBlock implements SocBlock {
  private warned = false

  constructor(
    readonly name: string,
    private env: SocEnv,
    private what: string,
  ) {}

  read(offset: number, size: AccessSize): number {
    this.warn(offset, false)
    return 0
  }

  write(offset: number, value: number, size: AccessSize): void {
    this.warn(offset, true)
  }

  reset(): void {}

  private warn(offset: number, write: boolean): void {
    if (this.warned) return
    this.warned = true
    this.env.ctx.log(
      'warning',
      this.name,
      `${this.what} is not simulated: firmware ${write ? 'wrote' : 'read'} offset 0x${offset.toString(16)} — registers read as 0 and writes are ignored (unsupported)`,
    )
  }
}

/** One-line factory for the peripheral list. */
export const unsupported =
  (name: string, what: string) =>
  (env: SocEnv): SocBlock =>
    new UnsupportedBlock(name, env, what)
