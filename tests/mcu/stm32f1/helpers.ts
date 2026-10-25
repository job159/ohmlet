/**
 * Test scaffolding for the STM32F103 SoC unit tests: a stub Cortex-M core
 * (no instruction execution — it advances the cycle counter through the
 * scheduler exactly like the real core does while idle) and register helpers
 * that access peripherals through the system bus, as firmware would.
 */
import type { CoreConfig, CoreHooks, CoreRegisters, CortexMCore, CreateCortexM3 } from '../../../src/mcu/core/cpu-api'
import type { CycleClock, Scheduler, StopReason, SystemBus } from '../../../src/mcu/core/types'
import type { FirmwareImage } from '../../../src/mcu/firmware'
import { Stm32f103 } from '../../../src/mcu/stm32f1/soc'

export class StubCore implements CortexMCore {
  readonly breakpoints = new Set<number>()
  halted = false
  sleeping = false
  lockedUp = false
  instructions = 0
  resets = 0
  resetSp = 0
  resetPc = 0
  events = 0
  readonly irqLines = new Uint8Array(64)
  readonly irqLog: { irq: number; on: boolean; cycle: number }[] = []
  /** requestSync() pending: the next run() returns 'sync' once due events have run */
  private syncFlag = false

  constructor(
    readonly bus: SystemBus,
    readonly scheduler: Scheduler,
    readonly clock: CycleClock,
    readonly hooks: CoreHooks,
    readonly config: CoreConfig,
  ) {}

  reset(): void {
    this.resets++
    this.resetSp = this.bus.read32(0)
    this.resetPc = this.bus.read32(4)
  }

  run(until: number): StopReason {
    if (this.halted) return 'halted'
    if (this.lockedUp) return 'lockup'
    for (;;) {
      const n = this.scheduler.nextAt()
      if (n <= this.clock.cycles) {
        this.scheduler.runDue(this.clock.cycles)
        continue
      }
      if (this.syncFlag) {
        this.syncFlag = false
        return 'sync'
      }
      if (this.clock.cycles >= until) return 'target'
      this.clock.cycles = Math.min(Math.ceil(n), until)
    }
  }

  requestSync(): void {
    this.syncFlag = true
  }
  setIrqLine(irq: number, asserted: boolean): void {
    this.irqLines[irq] = asserted ? 1 : 0
    this.irqLog.push({ irq, on: asserted, cycle: this.clock.cycles })
  }
  pendIrq(): void {}
  pendNmi(): void {}
  signalEvent(): void {
    this.events++
  }
  stepInstruction(): void {
    this.clock.cycles += 1
    this.instructions++
  }
  registers(): CoreRegisters {
    const r = new Array<number>(16).fill(0)
    r[13] = this.resetSp
    r[15] = this.resetPc & ~1
    return { r, xpsr: 0x01000000, msp: this.resetSp, psp: 0, primask: 0, basemask: 0, faultmask: 0, control: 0 }
  }
  setRegister(): void {}
  faultInfo() {
    return { cfsr: 0, hfsr: 0, mmfar: 0, bfar: 0 }
  }
}

export interface TestSoc {
  soc: Stm32f103
  core: StubCore
}

export function makeSoc(opts: { firmware?: boolean } = {}): TestSoc {
  let core: StubCore | null = null
  const createCore: CreateCortexM3 = (bus, sched, clock, hooks, config) => (core = new StubCore(bus, sched, clock, hooks, config))
  const soc = new Stm32f103({ createCore })
  if (opts.firmware) {
    const r = soc.loadFirmware(tinyImage())
    if (!r.ok) throw new Error(r.errors.join('; '))
    soc.reset('power-on')
  }
  return { soc, core: core as unknown as StubCore }
}

/** a minimal valid image: vector table (SP = top of SRAM, reset → 0x08000009) + `b .` */
export function tinyImage(extra: { addr: number; data: Uint8Array }[] = []): FirmwareImage {
  const v = new Uint8Array(12)
  const dv = new DataView(v.buffer)
  dv.setUint32(0, 0x20005000, true)
  dv.setUint32(4, 0x08000009, true)
  dv.setUint16(8, 0xe7fe, true)
  return {
    name: 'tiny.bin',
    format: 'bin',
    segments: [{ addr: 0x08000000, data: v }, ...extra],
    entry: null,
    symbols: [{ name: 'Reset_Handler', addr: 0x08000008, size: 2, kind: 'func' }],
    sha256: '0'.repeat(64),
    fileSize: 12,
    warnings: [],
  }
}

// ---- register access through the bus (as firmware does)
export const r32 = (s: Stm32f103, a: number) => s.bus.read32(a) >>> 0
export const w32 = (s: Stm32f103, a: number, v: number) => s.bus.write32(a, v >>> 0)
export const set32 = (s: Stm32f103, a: number, bits: number) => w32(s, a, r32(s, a) | bits)
export const clr32 = (s: Stm32f103, a: number, bits: number) => w32(s, a, r32(s, a) & ~bits)

export const RCC = 0x40021000
export const RCC_CR = RCC + 0x00
export const RCC_CFGR = RCC + 0x04
export const RCC_CIR = RCC + 0x08
export const RCC_APB2RSTR = RCC + 0x0c
export const RCC_APB1RSTR = RCC + 0x10
export const RCC_AHBENR = RCC + 0x14
export const RCC_APB2ENR = RCC + 0x18
export const RCC_APB1ENR = RCC + 0x1c
export const RCC_BDCR = RCC + 0x20
export const RCC_CSR = RCC + 0x24
export const FLASH_ACR = 0x40022000
export const GPIOA = 0x40010800
export const GPIOB = 0x40010c00
export const GPIOC = 0x40011000
export const AFIO = 0x40010000
export const EXTI = 0x40010400
export const PWR = 0x40007000
export const BKP = 0x40006c00
export const USART1 = 0x40013800
export const USART2 = 0x40004400
export const IWDG = 0x40003000
export const WWDG = 0x40002c00
export const CRC = 0x40023000

/** Advance the SoC to an exact core cycle (the stub core stops exactly there). */
export function runToCycle(s: Stm32f103, cycle: number): void {
  s.runUntil(s.timeOfCycle(cycle))
  if (s.clock.cycles !== cycle) throw new Error(`runToCycle: at ${s.clock.cycles}, wanted ${cycle}`)
}

/** Advance by `dt` seconds. */
export function runFor(s: Stm32f103, dt: number): void {
  s.runUntil(s.time() + dt)
}

/** Record pinDriveChanged events (pin, cycle, mode, level). */
export function recordPins(s: Stm32f103): { pin: number; cycle: number; mode: number; level: number }[] {
  const out: { pin: number; cycle: number; mode: number; level: number }[] = []
  s.pins.listener = {
    pinDriveChanged(pin, cycle) {
      const d = s.pins.drive(pin)
      out.push({ pin, cycle, mode: d.mode, level: d.level })
    },
  }
  return out
}

/**
 * The HAL "SystemClock_Config" of hal-blink at register level: HSE 8 MHz ×
 * PLL9 = 72 MHz, AHB /1, APB1 /2, APB2 /1, 2 wait states. Waits by running
 * simulated time, like firmware polling the ready flags.
 */
export function clock72(s: Stm32f103): void {
  set32(s, RCC_CR, 1 << 16) // HSEON
  while (!(r32(s, RCC_CR) & (1 << 17))) runFor(s, 50e-6)
  w32(s, RCC_CFGR, (r32(s, RCC_CFGR) & ~(0x3f << 16)) | (1 << 16) | (7 << 18)) // PLLSRC = HSE, PLLMUL = ×9
  set32(s, RCC_CR, 1 << 24) // PLLON
  while (!(r32(s, RCC_CR) & (1 << 25))) runFor(s, 10e-6)
  w32(s, FLASH_ACR, (r32(s, FLASH_ACR) & ~7) | 2)
  w32(s, RCC_CFGR, (r32(s, RCC_CFGR) & ~0x3ff3) | (4 << 8) | 2) // PPRE1 = /2, SW = PLL
}
