/**
 * Regression guard for spurious core diagnostics on real compiler output
 * (e.g. the former "UNPREDICTABLE ... shift (register) with SP/PC operand"
 * for `lsl.w r4, lr, r4` in hal-blink — LR is an ordinary register; only
 * r13/r15 are BadReg): every firmware/dist image boots on the STM32F103 SoC
 * with the real core and runs 100 ms of simulated time (clock set-up, HAL
 * init, the first main-loop iterations) without the core reporting an
 * UNPREDICTABLE encoding, an undefined instruction or a fault.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCortexM3 } from '../../../src/mcu/core/cpu'
import { loadElf } from '../../../src/mcu/loader'
import { Stm32f103 } from '../../../src/mcu/stm32f1/soc'
import { FW_DIST } from './harness'

describe('real firmware runs without core diagnostics', () => {
  const elfs = readdirSync(FW_DIST).filter((f) => f.endsWith('.elf'))
  it('firmware/dist has images to check', () => {
    expect(elfs).toContain('hal-blink.elf')
  })
  for (const f of elfs) {
    it(f, { timeout: 60_000 }, () => {
      const parsed = loadElf(new Uint8Array(readFileSync(path.join(FW_DIST, f))), f)
      if (!parsed.ok) throw new Error(parsed.error)
      const mcu = new Stm32f103({ createCore: createCortexM3 })
      expect(mcu.loadFirmware(parsed.image).ok).toBe(true)
      mcu.reset('power-on')
      while (mcu.time() < 0.1) {
        const r = mcu.runUntil(mcu.time() + 0.01)
        if (r === 'breakpoint' || r === 'lockup') break
      }
      const core = mcu.drainLog().filter((l) => l.source === 'core' && /UNPREDICTABLE|UsageFault|BusFault|HardFault|MemManage|LOCKUP|INVSTATE|not readable/i.test(l.message))
      expect(core.map((l) => l.message)).toEqual([])
    })
  }
})
