/**
 * STM32F103C8 (Blue Pill) SoC: Cortex-M3 core + memories + RCC/FLASH/PWR/
 * GPIO/AFIO/EXTI/DBGMCU + the plug-in peripheral list (peripherals.ts),
 * implementing McuDevice (mcu-api.ts).
 *
 * Time (ARCHITECTURE_REVIEW §10.3): the core counts HCLK cycles; TimeBase
 * maps cycles ↔ seconds piecewise-exactly across clock switches. runUntil(t)
 * runs the core in slices that end at the target cycle, at a coordinator
 * sync request, at a breakpoint, or when the SoC itself must regain control
 * (HCLK changed → the target cycle moved; a reset was requested). Resets
 * requested from inside an instruction or event (SYSRESETREQ, IWDG, WWDG)
 * take effect at the next instruction boundary, never mid-instruction.
 * With no firmware, unpowered, held in reset, halted or locked up, the
 * clock still advances and scheduled peripheral events still run (a locked
 * up core is still reset by a running IWDG, like on silicon).
 *
 * The core comes from an injected factory (createCortexM3 in production,
 * a stub in unit tests): `new Stm32f103({ createCore })`.
 */
import type { CoreConfig, CoreHooks, CortexMCore, CreateCortexM3 } from '../core/cpu-api'
import { EventQueue } from '../core/scheduler'
import type { CycleClock, StopReason } from '../core/types'
import type { FirmwareImage, FirmwareSymbol } from '../firmware'
import type { McuDebugState, McuDevice, McuLogEvent, McuRunState, PeripheralSupport, UartTap } from '../mcu-api'
import type { RccGate, SocContext } from './periph-api'
import { type BlockSpec, hex8, type ResetCause, type SocBlock, type SocEnv } from './block'
import { Afio } from './afio'
import { ExtPpb } from './dbgmcu'
import { Exti } from './exti'
import { FlashInterface, requiredLatency } from './flash'
import { PinController } from './gpio'
import { SocLog } from './log'
import { type BusSlot, FLASH_BASE, FLASH_DATASHEET, FLASH_MAPPED, OPTB_BASE, OPTB_SIZE, SRAM_BASE, SRAM_SIZE, Stm32Bus, SYSMEM_BASE, SYSMEM_SIZE } from './memory'
import { PERIPHERALS, supportTable } from './peripherals'
import { Pwr } from './pwr'
import { HSI_HZ, Rcc } from './rcc'
import { TimeBase, TimedEvents } from './timebase'

/** Cortex-M3 r1p1 as integrated in the STM32F103: CPUID per PM0056 §4.4.1, 43 IRQ channels (RM0008 Table 63), 4 priority bits (PM0056 §4.3.7). */
export const STM32F103_CORE: CoreConfig = {
  cpuid: 0x411fc231,
  numIrq: 43,
  priorityBits: 4,
  systickCalib: 0x00002328,
}

export interface Stm32f103Options {
  createCore: CreateCortexM3
  /** HSE crystal frequency (Blue Pill: 8 MHz) */
  hseHz?: number
  /** replacement peripheral list (tests) */
  peripherals?: BlockSpec[]
}

interface Mounted {
  spec: BlockSpec
  block: SocBlock
  ctx: SocContext
  frozen: boolean
}

/** Optional block hooks for the analog environment (ADC: VDDA reference, die temperature). */
interface AnalogEnvSink {
  setVdda?(v: number): void
  setDieTemperature?(c: number): void
}

const GPIO_GATE_BIT = [2, 3, 4, 5, 6]

export class Stm32f103 implements McuDevice {
  readonly model = 'stm32f103c8'
  readonly clock: CycleClock = { cycles: 0 }
  readonly scheduler = new EventQueue()
  readonly bus = new Stm32Bus()
  readonly core: CortexMCore
  readonly rcc: Rcc
  readonly flashIf: FlashInterface
  readonly pins: PinController
  readonly afio: Afio
  readonly exti: Exti
  readonly pwr: Pwr
  readonly dbg: ExtPpb
  readonly uarts: readonly UartTap[]
  readonly support: readonly PeripheralSupport[]
  readonly blocks: readonly Mounted[]

  firmware: FirmwareImage | null = null

  private tb = new TimeBase(HSI_HZ)
  private timed: TimedEvents
  private logger: SocLog
  private _powered = true
  /** VDD was lost: the next reset release is a power-on reset (POR flag, SRAM and backup domain lost) */
  private porPending = false
  private nrst = false
  private started = false
  private boot0: 0 | 1 = 0
  private boot1: 0 | 1 = 0
  private syncReq = false
  private pendingReset: ResetCause | null = null
  private irqOwners = new Map<number, Set<string>>()
  private dmaOwners = new Map<number, Set<string>>()
  /** per DMA channel: peripherals that requested since the last served transfer (they get its dmaAck) */
  private dmaAckers = new Map<number, Set<string>>()
  /** internal trigger signals ('TIM3_TRGO' …) → subscribers (SocContext.onTrigger) */
  private triggerSubs = new Map<string, Set<(cycle: number) => void>>()
  /** analog supply / die temperature as reported by the board (setSupplyVoltage / setDieTemperature) */
  private vdd = 3.3
  private dieC = 25
  private clockSig = ''
  private funcs: FirmwareSymbol[] = []
  private itmLine = ''
  private lockupLogged = false
  /** resets after the construction-time POR — numbered in the log so repeated resets are never folded */
  private resetCount = -1
  /** inside runUntil / stepInstruction: resets are deferred to the next instruction boundary */
  private inRun = false
  /** the IWDG was started (KR = 0xCCCC forced the LSI on) since the last reset */
  private iwdgStarted = false
  /** inputs of the last clockedBlocks() list (NaN = never computed) */
  private readonly clockedKey = new Float64Array(7).fill(NaN)
  private clockedList: readonly string[] = []

  constructor(opts: Stm32f103Options) {
    this.logger = new SocLog(() => this.time())
    this.timed = new TimedEvents(this.scheduler, this.tb)
    const logOnce = (key: string, level: McuLogEvent['level'], source: string, msg: string) => this.logger.once(key, level, source, msg)

    this.rcc = new Rcc({
      time: () => this.time(),
      atTime: (t, fn) => this.timed.at(t, fn),
      cancelTime: (h) => this.timed.cancel(h),
      log: (level, msg) => this.logger.log(level, 'RCC', msg),
      logOnce: (key, level, msg) => logOnce(key, level, 'RCC', msg),
      setIrq: (a) => this.setIrq('RCC', 5, a),
      clocksChanged: () => this.clocksChanged(),
      gateChanged: (g, on) => this.gateChanged(g, on),
      resetLine: (g, a) => this.resetLine(g, a),
      backupWritable: () => this.pwr.dbp,
      backupDomainReset: () => this.backupDomainReset(),
      oscPinsChanged: () => this.pins.recomputeAll(),
    })
    if (opts.hseHz) this.rcc.hseHz = opts.hseHz
    this.flashIf = new FlashInterface(this.bus, {
      time: () => this.time(),
      atTime: (t, fn) => this.timed.at(t, fn),
      cancelTime: (h) => this.timed.cancel(h),
      setIrq: (a) => this.setIrq('FLASH', 4, a),
      log: (level, msg) => this.logger.log(level, 'FLASH', msg),
      logOnce: (key, level, msg) => logOnce(key, level, 'FLASH', msg),
      hsiOn: () => this.rcc.hsiOn,
      latencyChanged: () => this.checkLatency(),
    })
    this.bus.flashWriter = this.flashIf
    this.pins = new PinController({
      clock: this.clock,
      powered: () => this._powered,
      swj: () => this.afio.swj,
      pd01Remap: () => this.afio.pd01Remap,
      hseOn: () => this.rcc.hseOn,
      lseOn: () => this.rcc.lseOn,
      wkupEnabled: () => this.pwr.ewup,
      inputEdge: (pin, level) => this.exti.pinEdge(pin, level),
      logOnce,
    })
    this.afio = new Afio({
      remapChanged: () => this.remapChanged(),
      logOnce: (key, level, msg) => logOnce(key, level, 'AFIO', msg),
    })
    this.exti = new Exti({
      setIrq: (irq, a) => this.setIrq('EXTI', irq, a),
      signalEvent: () => this.core.signalEvent(),
      portOfLine: (line) => this.afio.exticr[line],
    })
    this.pwr = new Pwr({
      logOnce: (key, level, msg) => logOnce(key, level, 'PWR', msg),
      wkupChanged: () => this.pins.recomputeAll(),
    })
    this.dbg = new ExtPpb({
      freezeChanged: () => this.applyFreeze(),
      logOnce: (key, level, msg) => logOnce(key, level, 'DBGMCU', msg),
    })

    const hooks: CoreHooks = {
      systemResetRequest: () => this.requestReset('SFT'),
      // SysTick CLKSOURCE = 0 counts HCLK/8 on the STM32F1 (RM0008 Figure 8)
      systickRefDivider: () => 8,
      itmWrite: (port, value, size) => this.itm(port, value, size),
      sleepChanged: (sleeping, deep) => {
        if (sleeping && deep) this.pwr.deepSleep()
      },
      log: (level, msg) => this.logger.log(level, 'core', msg),
    }
    this.core = opts.createCore(this.bus, this.scheduler, this.clock, hooks, STM32F103_CORE)

    // ---- memory map: core blocks
    const map = (base: number, name: string, gate: RccGate | null, block: SocBlock, size = 0x400) =>
      this.bus.map(base, size, this.gated(name, gate, block))
    map(0x40007000, 'PWR', { bus: 'APB1', bit: 28 }, this.pwr)
    map(0x40010000, 'AFIO', { bus: 'APB2', bit: 0 }, this.afio)
    map(0x40010400, 'EXTI', null, this.exti)
    this.pins.ports.forEach((p, i) => map(0x40010800 + i * 0x400, p.name, { bus: 'APB2', bit: GPIO_GATE_BIT[i] }, p))
    map(0x40021000, 'RCC', null, this.rcc)
    map(0x40022000, 'FLASH', null, this.flashIf)
    this.bus.extPpb = this.dbg

    // ---- plug-in peripherals
    const specs = opts.peripherals ?? PERIPHERALS
    const mounted: Mounted[] = []
    for (const spec of specs) {
      const ctx = this.makeContext(spec.name)
      const env: SocEnv = {
        ctx,
        time: () => this.time(),
        systemReset: (cause) => this.requestReset(cause),
        forceLsi: () => {
          // only a started IWDG forces the LSI on (RM0008 §19.3.1)
          if (spec.name === 'IWDG') this.iwdgStarted = true
          this.rcc.forceLsi()
        },
        backupWritable: () => this.pwr.dbp,
        atTime: (t, fn) => this.timed.at(t, fn),
        cancelTime: (h) => this.timed.cancel(h),
      }
      const block = spec.make(env)
      mounted.push({ spec, block, ctx, frozen: false })
      this.bus.map(spec.base, spec.size ?? 0x400, this.gated(spec.name, spec.gate, block))
    }
    this.blocks = mounted
    for (const m of mounted) m.block.attach?.(m.ctx)
    this.uarts = mounted
      .map((m) => m.block)
      .filter((b): b is SocBlock & UartTap => typeof (b as Partial<UartTap>).send === 'function' && 'onTx' in b)
      .sort((a, b) => a.name.localeCompare(b.name))
    this.support = supportTable(specs)

    this.doReset('POR')
  }

  // ================================================================ McuDevice

  get powered(): boolean {
    return this._powered
  }

  time(): number {
    return this.tb.timeOf(this.clock.cycles)
  }

  timeOfCycle(cycle: number): number {
    return this.tb.timeOf(cycle)
  }

  /** core clock now (Hz) */
  get hclkHz(): number {
    return this.rcc.hclk()
  }

  loadFirmware(img: FirmwareImage): { ok: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = [...img.warnings]
    const parts: { off: number; data: Uint8Array }[] = []
    let top = 0
    for (const seg of img.segments) {
      let addr = seg.addr >>> 0
      const len = seg.data.length
      if (addr + len <= FLASH_MAPPED) {
        warnings.push(`segment at ${hex8(addr)} is linked at the boot alias 0x00000000: programmed at ${hex8(addr + FLASH_BASE)} (main flash)`)
        addr += FLASH_BASE
      }
      const off = addr - FLASH_BASE
      if (off >= 0 && off < FLASH_MAPPED) {
        if (off + len > FLASH_MAPPED) {
          errors.push(`segment at ${hex8(addr)} (${len} bytes) runs past the end of flash (${hex8(FLASH_BASE + FLASH_MAPPED)}): the image does not fit`)
          continue
        }
        parts.push({ off, data: seg.data })
        top = Math.max(top, off + len)
      } else if (addr >= SRAM_BASE && addr < SRAM_BASE + SRAM_SIZE) {
        warnings.push(`segment at ${hex8(addr)} (${len} bytes) is RAM-only — not programmed (startup code initialises RAM)`)
      } else if (addr >= OPTB_BASE && addr < OPTB_BASE + OPTB_SIZE) {
        warnings.push(`segment at ${hex8(addr)} targets the option bytes: not programmed, the factory option bytes are kept`)
      } else if (addr >= SYSMEM_BASE && addr < SYSMEM_BASE + SYSMEM_SIZE) {
        warnings.push(`segment at ${hex8(addr)} targets system memory (ROM): not programmed`)
      } else {
        warnings.push(`segment at ${hex8(addr)} (${len} bytes) is outside the STM32F103C8's non-volatile memory — not programmed`)
      }
    }
    if (parts.length === 0 && errors.length === 0) {
      errors.push(`no bytes fall inside main flash (${hex8(FLASH_BASE)}–${hex8(FLASH_BASE + FLASH_MAPPED - 1)}): nothing to program`)
    }
    if (errors.length) {
      this.logger.log('error', 'loader', `${img.name}: ${errors.join('; ')}`)
      return { ok: false, errors, warnings }
    }
    if (top > FLASH_DATASHEET) {
      warnings.push(`firmware uses ${(top / 1024).toFixed(1)} KiB of flash: exceeds the STM32F103C8 datasheet flash size (64 KiB); most parts have 128 KiB`)
    }
    // A programmer erases before writing; erase the whole array so no stale code survives.
    this.bus.flash.fill(0xff)
    for (const p of parts) this.bus.flash.set(p.data, p.off)
    this.bus.touchFlash(FLASH_BASE, FLASH_BASE + FLASH_MAPPED)

    const v = new DataView(this.bus.flash.buffer)
    const sp = v.getUint32(0, true)
    const pc = v.getUint32(4, true)
    if (sp === 0xffffffff && pc === 0xffffffff) {
      warnings.push('no vector table at 0x08000000 (erased): the core will fault right after reset')
    } else {
      if (!(sp > SRAM_BASE && sp <= SRAM_BASE + SRAM_SIZE)) warnings.push(`initial stack pointer ${hex8(sp)} is not inside the 20 KiB of SRAM (0x20000000–0x20005000)`)
      if ((pc & 1) === 0) warnings.push(`reset vector ${hex8(pc)} has the Thumb bit clear: the core will take a UsageFault (INVSTATE)`)
      if (((pc - FLASH_BASE) >>> 0) >= FLASH_MAPPED && pc >>> 0 >= FLASH_MAPPED) warnings.push(`reset vector ${hex8(pc)} does not point into flash`)
      if (img.entry !== null && img.entry >>> 0 !== pc >>> 0) {
        warnings.push(`ELF entry ${hex8(img.entry)} differs from the reset vector ${hex8(pc)}: the core starts at the reset vector, like the hardware`)
      }
    }
    this.firmware = img
    this.funcs = img.symbols.filter((s) => s.kind === 'func').sort((a, b) => a.addr - b.addr)
    this.started = false
    this.lockupLogged = false
    this.logger.resetOnce()
    this.logger.log('info', 'loader', `${img.name}: ${top} bytes programmed into flash (${img.description ?? img.format})`)
    for (const w of warnings) this.logger.log('warning', 'loader', w)
    return { ok: true, errors: [], warnings }
  }

  reset(kind: 'power-on' | 'pin'): void {
    if (!this._powered || this.nrst) return
    this.pendingReset = null
    this.doReset(kind === 'power-on' ? 'POR' : 'PIN')
  }

  setPowered(on: boolean): void {
    if (on === this._powered) return
    this._powered = on
    if (!on) {
      this.porPending = true
      this.holdInReset()
      this.logger.log('info', 'PWR', 'VDD below the POR/PDR threshold: MCU held in reset, all pins high-Z')
    } else if (this.nrst) {
      this.holdInReset()
    } else {
      this.doReset('POR')
    }
  }

  setResetPin(asserted: boolean): void {
    if (asserted === this.nrst) return
    this.nrst = asserted
    if (!this._powered) return
    if (asserted) this.holdInReset()
    else this.doReset('PIN')
  }

  /**
   * BOOT0 / BOOT1 (PB2) straps, sampled at the next reset (RM0008 §3.4,
   * Table 9). Blue Pill default: both jumpers at 0 → boot from flash.
   */
  setBootPins(boot0: 0 | 1, boot1: 0 | 1 = 0): void {
    this.boot0 = boot0
    this.boot1 = boot1
  }

  runUntil(t: number): StopReason {
    this.syncReq = false
    this.inRun = true
    try {
      return this.runLoop(t)
    } finally {
      this.inRun = false
    }
  }

  private runLoop(t: number): StopReason {
    for (;;) {
      if (this.pendingReset) {
        const c = this.pendingReset
        this.pendingReset = null
        this.doReset(c)
      }
      const target = this.tb.cycleAtOrAfter(t)
      if (this.clock.cycles >= target) return this.endReason()
      if (this.syncReq) return 'sync'
      if (!this.executing() || this.core.halted || this.core.lockedUp) {
        this.idleAdvance(target)
        continue
      }
      const r = this.core.run(target)
      if (r === 'breakpoint' && !this.pendingReset) {
        this.core.halted = true
        this.applyFreeze()
        return 'breakpoint'
      }
      if (r === 'lockup' && !this.lockupLogged) {
        this.lockupLogged = true
        const pc = this.core.registers().r[15]
        this.logger.log('error', 'core', `core locked up (fault during HardFault/NMI) at ${hex8(pc)}${this.symbolAt(pc) ? ' in ' + this.symbolAt(pc) : ''}: execution stopped; peripherals (and a running IWDG) keep going`)
      }
      // 'target' | 'sleep' | internal 'sync' (clock rebase, reset request) → recompute the target and continue
    }
  }

  requestSync(): void {
    this.syncReq = true
    this.core.requestSync()
  }

  drainLog(): McuLogEvent[] {
    return this.logger.drain()
  }

  debugState(): McuDebugState {
    const regs = this.core.registers()
    const pc = regs.r[15]
    const sym = this.symbolAt(pc)
    const lrSym = this.lrSymbol(regs.r[14])
    return {
      state: this.runState(),
      registers: regs,
      faults: this.core.faultInfo(),
      cycles: this.clock.cycles,
      instructions: this.core.instructions,
      hclkHz: this.rcc.hclk(),
      ipsr: regs.xpsr & 0x1ff,
      ...(sym ? { pcSymbol: sym } : {}),
      ...(lrSym ? { lrSymbol: lrSym } : {}),
      clocked: this.clockedBlocks(),
      afioMapr: this.afio.mapr >>> 0,
    }
  }

  /**
   * The function LR returns into — none for an EXC_RETURN value (PM0056
   * §2.3.7: 0xFFFFFFF1 / F9 / FD) or the reset value 0xFFFFFFFF: no code
   * lives at 0xF0000000 and above (system region, XN).
   */
  private lrSymbol(lr: number | undefined): string | undefined {
    if (lr === undefined) return undefined
    const a = lr >>> 0
    if (a >= 0xf0000000) return undefined
    return this.symbolAt(a)
  }

  /**
   * debugState().clocked: support-table names of the blocks the firmware
   * switched on, in table order. Rebuilt only when an input changed (the
   * coordinator reads it every frame).
   */
  private clockedBlocks(): readonly string[] {
    const r = this.rcc
    const bdcr = r.read32(0x20)
    const k = this.clockedKey
    const changed =
      k[0] !== r.ahbenr ||
      k[1] !== r.apb2enr ||
      k[2] !== r.apb1enr ||
      k[3] !== (this.exti.imr | this.exti.emr) ||
      k[4] !== this.dbg.cr ||
      k[5] !== ((bdcr >>> 15) & 1) ||
      k[6] !== (this.iwdgStarted ? 1 : 0)
    if (!changed) return this.clockedList
    k[0] = r.ahbenr
    k[1] = r.apb2enr
    k[2] = r.apb1enr
    k[3] = this.exti.imr | this.exti.emr
    k[4] = this.dbg.cr
    k[5] = (bdcr >>> 15) & 1
    k[6] = this.iwdgStarted ? 1 : 0
    // the core every running firmware uses: its memories, RCC and the flash
    // interface (always clocked — RCC_AHBENR.FLITFEN only matters in Sleep, flash.ts)
    const on = new Set<string>(['Memory map', 'RCC', 'FLASH'])
    if (r.apb2enr & 0x7c) on.add('GPIO') // IOPAEN … IOPEEN
    if (r.apb2enr & 1) on.add('AFIO')
    if (r.apb1enr & (1 << 28)) on.add('PWR')
    if ((this.exti.imr | this.exti.emr) !== 0) on.add('EXTI') // no bus gate: in use once a line is unmasked
    if (this.dbg.cr !== 0) on.add('DBGMCU')
    for (const m of this.blocks) {
      if (m.spec.gate && r.isEnabled(m.spec.gate)) on.add(m.spec.name)
    }
    if ((bdcr >>> 15) & 1) on.add('RTC') // RCC_BDCR.RTCEN
    if (this.iwdgStarted) on.add('IWDG') // KR = 0xCCCC (LSI clock, no bus gate)
    if (on.has('USB') || on.has('CAN')) on.add('USB/CAN SRAM')
    this.clockedList = this.support.map((s) => s.name).filter((n) => on.has(n))
    return this.clockedList
  }

  halt(): void {
    this.core.halted = true
    this.applyFreeze()
  }

  resume(): void {
    if (!this.core.halted) return
    // (the core itself executes the instruction under a just-hit breakpoint once on resume)
    this.core.halted = false
    this.applyFreeze()
  }

  stepInstruction(): void {
    if (!this.core.halted || !this.executing()) return
    this.inRun = true
    try {
      this.core.stepInstruction()
    } finally {
      this.inRun = false
    }
    if (this.pendingReset) {
      const c = this.pendingReset
      this.pendingReset = null
      this.doReset(c)
    }
  }

  setBreakpoints(addrs: number[]): void {
    this.core.breakpoints.clear()
    for (const a of addrs) this.core.breakpoints.add((a & ~1) >>> 0)
  }

  readMemory(addr: number, length: number): Uint8Array {
    return this.bus.peek(addr >>> 0, length)
  }

  // ================================================================ extras

  uart(name: string): UartTap | undefined {
    return this.uarts.find((u) => u.name === name)
  }

  block(name: string): SocBlock | undefined {
    return this.blocks.find((m) => m.spec.name === name)?.block
  }

  /**
   * Board supply VDD (V) — on the Blue Pill VDDA = VDD, and the LQFP48 bonds
   * VREF+ to VDDA, so this is the ADC full-scale reference (RM0008 §11.1,
   * Table 65). Not part of McuDevice yet: the board adapter is expected to
   * report its solved VDD here; until it does, 3.3 V nominal is used.
   */
  setSupplyVoltage(vdd: number): void {
    if (!(Number.isFinite(vdd) && vdd > 0) || vdd === this.vdd) return
    this.vdd = vdd
    for (const m of this.blocks) (m.block as AnalogEnvSink).setVdda?.(vdd)
  }

  get supplyVoltage(): number {
    return this.vdd
  }

  /** Die temperature (°C) seen by the internal temperature sensor (ADC1 IN16); default 25 °C. */
  setDieTemperature(celsius: number): void {
    if (!Number.isFinite(celsius)) return
    this.dieC = celsius
    for (const m of this.blocks) (m.block as AnalogEnvSink).setDieTemperature?.(celsius)
  }

  get dieTemperature(): number {
    return this.dieC
  }

  /** RCC_CSR reset flags (bits 31:26) — debug UI / tests */
  get resetFlags(): number {
    return this.rcc.resetFlags
  }

  symbolAt(pc: number): string | undefined {
    const f = this.funcs
    const a = (pc & ~1) >>> 0
    let lo = 0
    let hi = f.length - 1
    let best = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (f[mid].addr <= a) {
        best = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    if (best < 0) return undefined
    const s = f[best]
    if (s.size > 0 && a >= s.addr + s.size) return undefined
    return s.name
  }

  // ================================================================ internals

  private executing(): boolean {
    return this._powered && !this.nrst && this.started && this.firmware !== null
  }

  private runState(): McuRunState {
    if (!this._powered) return 'unpowered'
    if (this.nrst) return 'reset'
    if (!this.firmware) return 'no-firmware'
    if (!this.started) return 'reset'
    if (this.core.lockedUp) return 'lockup'
    if (this.core.halted) return 'halted'
    if (this.core.sleeping) return 'sleeping'
    return 'running'
  }

  private endReason(): StopReason {
    if (this.executing()) {
      if (this.core.lockedUp) return 'lockup'
      if (this.core.halted) return 'halted'
    }
    return 'target'
  }

  /** Advance time without executing: run due events, jump to the next one or the target. */
  private idleAdvance(target: number): void {
    const next = Math.min(this.scheduler.nextAt(), target)
    if (next > this.clock.cycles) this.clock.cycles = Math.ceil(next)
    this.scheduler.runDue(this.clock.cycles)
  }

  private requestReset(cause: ResetCause): void {
    if (!this.inRun) {
      // outside execution (debugger / coordinator access): no instruction to finish first
      if (this._powered && !this.nrst) this.doReset(cause)
      return
    }
    if (this.pendingReset) return
    this.pendingReset = cause
    this.core.requestSync()
  }

  private doReset(cause: ResetCause): void {
    if (this.porPending) cause = 'POR'
    this.porPending = false
    const por = cause === 'POR'
    this.scheduler.clear()
    this.timed.clear()
    this.rcc.noteReset(cause)
    this.rcc.reset()
    this.iwdgStarted = false // every reset stops the IWDG (RCC_CSR keeps only its flag)
    if (por) {
      this.rcc.backupReset()
      this.dbg.reset()
      this.bus.clearSram()
    }
    this.flashIf.reset()
    this.pwr.reset()
    this.afio.reset()
    this.exti.reset()
    for (const p of this.pins.ports) p.reset()
    this.pins.clearAf()
    for (const m of this.blocks) {
      m.frozen = false
      m.block.reset()
      if (por) m.block.backupReset?.()
      if (m.spec.gate) m.block.clockEnabled?.(this.rcc.isEnabled(m.spec.gate))
    }
    // every IRQ / DMA line is released by its owner's reset; drop stale bookkeeping
    for (const [irq, owners] of this.irqOwners) if (owners.size) this.core.setIrqLine(irq, false)
    this.irqOwners.clear()
    this.dmaOwners.clear()
    this.dmaAckers.clear()
    this.clockSig = ''
    this.clocksChanged()
    this.pins.recomputeAll()
    this.lockupLogged = false
    this.bus.bootFromSystem = this.boot0 === 1
    this.resetCount++
    if (cause !== 'POR' || this.firmware) {
      const what = cause === 'POR' ? 'power-on' : cause === 'PIN' ? 'NRST' : cause === 'SFT' ? 'software (SYSRESETREQ)' : cause
      this.logger.log('info', 'RCC', `${what} reset #${this.resetCount} (RCC_CSR = ${hex8(this.rcc.read32(0x24))})`)
    }
    if (this.firmware) {
      if (this.boot0 === 1) {
        this.logger.log(
          'error',
          'core',
          this.boot1 === 0
            ? 'BOOT0 = 1: the MCU boots the ST system-memory bootloader, which is not emulated — the core idles in a stub loop. Move the BOOT0 jumper to 0 to run the firmware in flash.'
            : 'BOOT0 = 1, BOOT1 = 1: boot from SRAM is not emulated — the core idles in a stub loop.',
        )
        this.bus.bootFromSystem = true // SRAM boot: same stub
      }
      this.core.reset()
      this.started = true
    } else {
      this.started = false
    }
  }

  /** NRST held / VDD lost: every block in reset, nothing scheduled, pins at reset (or high-Z). */
  private holdInReset(): void {
    this.pendingReset = null
    this.scheduler.clear()
    this.timed.clear()
    this.rcc.reset()
    this.flashIf.reset()
    this.pwr.reset()
    this.afio.reset()
    this.exti.reset()
    for (const p of this.pins.ports) p.reset()
    this.pins.clearAf()
    for (const m of this.blocks) {
      m.block.reset()
      if (m.spec.gate) m.block.clockEnabled?.(false)
    }
    if (!this._powered) {
      this.rcc.backupReset()
      for (const m of this.blocks) m.block.backupReset?.()
    }
    for (const [irq, owners] of this.irqOwners) if (owners.size) this.core.setIrqLine(irq, false)
    this.irqOwners.clear()
    this.dmaOwners.clear()
    this.dmaAckers.clear()
    this.clockSig = ''
    this.clocksChanged()
    this.pins.recomputeAll()
    this.started = false
  }

  private backupDomainReset(): void {
    this.rcc.backupReset()
    for (const m of this.blocks) m.block.backupReset?.()
    this.pins.recomputeAll()
    this.logger.log('info', 'RCC', 'backup domain reset (RCC_BDCR.BDRST)')
  }

  private clocksChanged(): void {
    const r = this.rcc
    const sig = `${r.sysclk()},${r.hclk()},${r.pclk1()},${r.pclk2()},${r.adcclk()},${r.timclk1()},${r.timclk2()}`
    if (sig === this.clockSig) return
    this.clockSig = sig
    if (this.tb.rebase(this.clock.cycles, r.hclk())) {
      this.timed.rebaseAll()
      // the cycle that corresponds to the runUntil target moved: let runUntil recompute it
      this.core?.requestSync()
    }
    this.checkLatency()
    if (this.blocks) for (const m of this.blocks) m.block.clockChanged?.()
  }

  private checkLatency(): void {
    if (!this.flashIf) return
    const need = requiredLatency(this.rcc.sysclk())
    const lat = this.flashIf.latency
    if (lat < need) {
      this.logger.log(
        'warning',
        'FLASH',
        `FLASH_ACR.LATENCY = ${lat} is too low for SYSCLK ${this.rcc.sysclk() / 1e6} MHz (needs ${need} wait state${need > 1 ? 's' : ''}, PM0075 §3.1): real silicon would fetch corrupted instructions`,
      )
    }
  }

  private gateChanged(g: RccGate, on: boolean): void {
    for (const m of this.blocks) {
      const s = m.spec.gate
      if (s && s.bus === g.bus && s.bit === g.bit) m.block.clockEnabled?.(on)
    }
  }

  private resetLine(g: RccGate, asserted: boolean): void {
    if (!asserted) return
    const same = (x: RccGate | null) => x !== null && x.bus === g.bus && x.bit === g.bit
    if (g.bus === 'APB2' && g.bit === 0) this.afio.reset()
    if (g.bus === 'APB2' && g.bit >= 2 && g.bit <= 6) {
      this.pins.ports[g.bit - 2].reset()
      this.pins.recomputeAll()
    }
    if (g.bus === 'APB1' && g.bit === 28) this.pwr.reset()
    for (const m of this.blocks) if (same(m.spec.gate)) m.block.reset()
  }

  private remapChanged(): void {
    this.pins?.recomputeAll()
    if (this.blocks) for (const m of this.blocks) m.block.remapChanged?.()
  }

  private applyFreeze(): void {
    const halted = this.core.halted
    for (const m of this.blocks) {
      const bit = m.spec.dbgFreezeBit
      if (bit === undefined) continue
      const frozen = halted && ((this.dbg.cr >>> bit) & 1) === 1
      if (frozen !== m.frozen) {
        m.frozen = frozen
        m.block.debugHalt?.(frozen)
      }
    }
  }

  private setIrq(owner: string, irq: number, asserted: boolean): void {
    let s = this.irqOwners.get(irq)
    const before = !!s && s.size > 0
    if (asserted) {
      if (!s) this.irqOwners.set(irq, (s = new Set()))
      s.add(owner)
    } else s?.delete(owner)
    const after = !!s && s.size > 0
    if (before !== after) this.core.setIrqLine(irq, after)
  }

  private dmaRequest(owner: string, channel: number, active: boolean): void {
    let s = this.dmaOwners.get(channel)
    const before = !!s && s.size > 0
    if (active) {
      if (!s) this.dmaOwners.set(channel, (s = new Set()))
      s.add(owner)
      let a = this.dmaAckers.get(channel)
      if (!a) this.dmaAckers.set(channel, (a = new Set()))
      a.add(owner)
    } else s?.delete(owner)
    const after = !!s && s.size > 0
    if (before === after) return
    const dma = this.blocks.find((m) => m.block.dmaRequestChanged)
    if (dma) dma.block.dmaRequestChanged?.(channel, after)
    else if (after) {
      this.logger.once(`dma-${owner}-${channel}`, 'warning', owner, `${owner} raised DMA1 channel ${channel} request, but DMA1 is not implemented: the transfer will not happen`)
    }
  }

  /**
   * DMA served one transfer on `channel` (called after it, CNDTR already
   * decremented): acknowledge the peripheral(s) that raised the request
   * (RM0008 §13.3.1) — also one whose request already dropped through the
   * transfer's own register access (reading a DR clears RXNE).
   */
  private dmaServed(channel: number): void {
    const ackers = this.dmaAckers.get(channel)
    if (!ackers || ackers.size === 0) return
    const list = [...ackers]
    ackers.clear()
    for (const owner of list) this.blocks.find((m) => m.spec.name === owner)?.block.dmaAck?.(channel)
    // still requesting: candidates for the next transfer
    const owners = this.dmaOwners.get(channel)
    if (owners) for (const o of owners) ackers.add(o)
  }

  /** Internal trigger signal (timer TRGO / CCx event → ADC, slave timers), delivered synchronously. */
  private emitTrigger(signal: string, cycle: number): void {
    const subs = this.triggerSubs.get(signal)
    if (!subs || subs.size === 0) return
    for (const cb of [...subs]) cb(cycle)
  }

  private onTrigger(signal: string, cb: (cycle: number) => void): () => void {
    let subs = this.triggerSubs.get(signal)
    if (!subs) this.triggerSubs.set(signal, (subs = new Set()))
    subs.add(cb)
    return () => {
      subs.delete(cb)
    }
  }

  private makeContext(owner: string): SocContext {
    return {
      clock: this.clock,
      scheduler: this.scheduler,
      clocks: this.rcc,
      cyclesPerTick: (hz) => this.rcc.hclk() / hz,
      timeOfCycle: (c) => this.tb.timeOf(c),
      setIrq: (irq, a) => this.setIrq(owner, irq, a),
      setAfOutput: (o, pin, level, cycle) => this.pins.setAf(o, pin, level, cycle ?? this.clock.cycles),
      pinLevel: (pin) => this.pins.level(pin),
      pinVoltage: (pin) => this.pins.voltage(pin),
      onPinInput: (pin, cb) => this.pins.subscribe(pin, cb),
      pin: (name) => this.pins.pinIndex(name),
      remap: () => this.afio.remap(),
      dmaRequest: (ch, a) => this.dmaRequest(owner, ch, a),
      dmaServed: (ch) => this.dmaServed(ch),
      emitTrigger: (signal, cycle) => this.emitTrigger(signal, cycle ?? this.clock.cycles),
      onTrigger: (signal, cb) => this.onTrigger(signal, cb),
      bus: this.bus,
      log: (level, source, msg) => this.logger.log(level, source, msg),
      requestSync: () => this.requestSync(),
    }
  }

  /** Bus slot wrapper: RCC clock gating (RM0008 §7.3.6–8: a gated block reads 0 and ignores writes) and xxxRST hold. */
  private gated(name: string, gate: RccGate | null, block: SocBlock): BusSlot {
    if (!gate) return block
    const rcc = this.rcc
    const isGpio = name.startsWith('GPIO')
    const hint = () => {
      const reg = gate.bus === 'AHB' ? 'RCC_AHBENR' : gate.bus === 'APB1' ? 'RCC_APB1ENR' : 'RCC_APB2ENR'
      const bit = isGpio ? `IOP${name[4]}EN` : `${name}EN`
      const hal = `__HAL_RCC_${name}_CLK_ENABLE()`
      return `${reg}.${bit} = 0: ${name} is not clocked, so the access was ignored (reads return 0) — exactly what silicon does. Enable its clock first: ${hal} or ${reg} |= ${reg}_${bit}.`
    }
    return {
      read: (off, size) => {
        if (!rcc.isEnabled(gate)) {
          this.logger.once(`gated-r-${name}`, 'warning', name, `read of ${name} returned 0: ${hint()}`)
          return 0
        }
        return block.read(off, size)
      },
      write: (off, v, size) => {
        if (!rcc.isEnabled(gate)) {
          this.logger.once(`gated-w-${name}`, 'warning', name, `write to ${name} ignored: ${hint()}`)
          return
        }
        if (rcc.inReset(gate)) return // held in reset by RCC_APBxRSTR
        block.write(off, v, size)
      },
    }
  }

  /** ITM stimulus port 0 (ITM_SendChar / SWO printf) is reported to the log line by line. */
  private itm(port: number, value: number, size: number): void {
    if (port !== 0) return
    for (let i = 0; i < size; i++) {
      const ch = (value >>> (8 * i)) & 0xff
      if (ch === 10) {
        this.logger.log('info', 'ITM', this.itmLine)
        this.itmLine = ''
      } else if (ch !== 13) {
        this.itmLine += String.fromCharCode(ch)
        if (this.itmLine.length > 200) {
          this.logger.log('info', 'ITM', this.itmLine)
          this.itmLine = ''
        }
      }
    }
  }
}
