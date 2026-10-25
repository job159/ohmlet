/**
 * STM32F1 SoC ↔ peripheral plug-in contract. CONTRACT FILE.
 *
 * The SoC (soc.ts) owns the bus, the clock tree (RCC), GPIO/AFIO/EXTI and
 * the core. Every other peripheral block (USART, TIM, I2C, SPI, ADC, DMA, …)
 * is a `Stm32Peripheral` registered with the SoC, talking to the rest of the
 * chip ONLY through `SocContext`. That keeps each block unit-testable with a
 * fake context and lets blocks be added without editing soc.ts internals.
 *
 * Time: core cycles (HCLK). Peripheral clocks (PCLK1/PCLK2/TIMxCLK/ADCCLK)
 * come from `clocks`; convert with `cyclesPerTick(hz)`. Re-derive schedules
 * in `clockChanged()` (firmware switched clocks or prescalers).
 *
 * Pins: number = port*16 + bit (PA0 = 0, PB6 = 22, PC13 = 45).
 */
import type { AccessSize, CycleClock, Scheduler, SystemBus } from '../core/types'

/** RCC enable bit that gates a peripheral's clock (RM0008 §7.3.6–7.3.8). */
export interface RccGate {
  bus: 'AHB' | 'APB1' | 'APB2'
  bit: number
}

/** Frequencies (Hz) as currently configured by firmware. */
export interface Stm32Clocks {
  sysclk(): number
  hclk(): number
  pclk1(): number
  pclk2(): number
  /** TIM2..4 kernel clock: PCLK1, ×2 when the APB1 prescaler ≠ 1 */
  timclk1(): number
  /** TIM1 kernel clock: PCLK2, ×2 when the APB2 prescaler ≠ 1 */
  timclk2(): number
  adcclk(): number
  lsi(): number
  lse(): number
}

/** AFIO_MAPR remap fields relevant to pin routing (RM0008 §9.4.2). */
export interface AfioRemap {
  spi1: boolean
  i2c1: boolean
  usart1: boolean
  usart2: boolean
  usart3: 0 | 1 | 3
  tim1: 0 | 1 | 3
  tim2: 0 | 1 | 2 | 3
  tim3: 0 | 2 | 3
  tim4: boolean
  /** SWJ_CFG: 0 full JTAG, 1 JTAG w/o NJTRST, 2 SW-DP only (JTAG off), 4 all off */
  swj: 0 | 1 | 2 | 4
}

export interface SocContext {
  readonly clock: CycleClock
  readonly scheduler: Scheduler
  readonly clocks: Stm32Clocks
  /** core cycles per tick of a clock running at `hz` (may be fractional) */
  cyclesPerTick(hz: number): number
  /** simulation time (s) of a core cycle */
  timeOfCycle(cycle: number): number

  /** level-sensitive NVIC line (STM32 IRQ number 0..42) */
  setIrq(irq: number, asserted: boolean): void

  /**
   * Alternate-function output. A peripheral that owns `pin` in the current
   * remap drives its level here; `null` = this owner stops driving (pin falls
   * back to the GPIO AF default, low). The GPIO block only uses it while the
   * pin is configured as AF push-pull / AF open-drain. `cycle` = exact edge
   * time (defaults to now) so serial waveforms keep bit-accurate timestamps.
   *
   * `'z'` = the owner keeps the pin but switches its output buffer OFF (the
   * peripheral's output-enable signal, e.g. SPI BIDIMODE with BIDIOE = 0,
   * RM0008 §25.3.4 / §25.5.1): while every owner of the pin is at 'z' the
   * AF pin is high-impedance — no drive, the input path reads the circuit
   * (an owner still driving 0/1 wins over the others' 'z').
   */
  setAfOutput(owner: string, pin: number, level: 0 | 1 | 'z' | null, cycle?: number): void
  /** Current resolved input level of a pin (Schmitt output, any mode but analog). */
  pinLevel(pin: number): 0 | 1
  /** Analog voltage at a pin (ADC); NaN when unknown. */
  pinVoltage(pin: number): number
  /** Subscribe to input level changes of a pin; returns an unsubscribe. */
  onPinInput(pin: number, cb: (level: 0 | 1, cycle: number) => void): () => void
  /** Pin index for 'PA9' style names (-1 if unknown). */
  pin(name: string): number

  /** AFIO remap state (re-read in `remapChanged`). */
  remap(): AfioRemap

  /** DMA1 request line `channel` (1..7) active/inactive (RM0008 Table 78). */
  dmaRequest(channel: number, active: boolean): void
  /**
   * DMA block only: tell the peripheral that raised the request on
   * `channel` that one transfer was served (calls its `dmaAck`).
   * `remaining` = the channel's CNDTR right after that transfer, before a
   * circular reload (forwarded to `dmaAck` by SoCs that support it).
   *
   * End-of-transfer signals (RM0008 §26.3.7 "DMA requests ... EOT / EOT_1"):
   * after every peripheral-requested transfer the DMA block also emits, through
   * `emitTrigger`, the hardware signals
   *   'DMA1_CH<n>_EOT_1'  — the transfer that left CNDTR = 1 (number of data − 1)
   *   'DMA1_CH<n>_EOT'    — the transfer that left CNDTR = 0 (end of transfer)
   * at the transfer's cycle, BEFORE the acknowledge, so a peripheral (I2C
   * LAST) learns them from the controller without reading CNDTR over the bus.
   */
  dmaServed?(channel: number, remaining?: number): void

  /**
   * Internal trigger signals between peripherals (RM0008 §11.12.9 ADC
   * external triggers, §15.3.15 timer synchronisation): a timer emits e.g.
   * 'TIM3_TRGO', 'TIM1_CC1', 'TIM2_CC2' at the exact cycle; the ADC (or a
   * slave timer via ITRx, e.g. 'TIM2_TRGO') subscribes. Unknown signals are
   * simply never emitted. Optional until the SoC implements routing.
   */
  emitTrigger?(signal: string, cycle?: number): void
  onTrigger?(signal: string, cb: (cycle: number) => void): () => void

  /** Bus-master access (DMA) — goes through the same routing as the CPU. */
  readonly bus: SystemBus

  /** Simulation log (deduplicated by the SoC). */
  log(level: 'info' | 'warning' | 'error', source: string, message: string): void

  /** Ask the core to stop at the next instruction boundary (rare). */
  requestSync(): void
}

export interface Stm32Peripheral {
  /** 'USART1', 'TIM2', 'I2C1' … (also the log source) */
  readonly name: string
  readonly base: number
  /** register block size in bytes (STM32F1 blocks are 0x400) */
  readonly size: number
  /** RCC clock gate; null for blocks without an enable bit (IWDG, RTC, EXTI). */
  readonly gate: RccGate | null
  /** Called once by the SoC before use. */
  attach(ctx: SocContext): void
  /** Register access (offset relative to base). The SoC only calls these while the RCC gate is open. */
  read(offset: number, size: AccessSize): number
  write(offset: number, value: number, size: AccessSize): void
  /** Power-on / system / RCC-xxxRST reset: registers to reset values, cancel scheduled events, release pins and IRQs. */
  reset(): void
  /** RCC gate opened/closed (a gated-off peripheral freezes: no events). */
  clockEnabled?(on: boolean): void
  /** Some clock frequency changed: recompute bit times / counter rates. */
  clockChanged?(): void
  /** AFIO_MAPR changed: re-claim AF pins. */
  remapChanged?(): void
  /**
   * DMA served one request of this peripheral (bookkeeping, optional).
   * `remaining` = the channel's CNDTR after that transfer when the SoC
   * forwards it (see SocContext.dmaServed; may be absent). End-of-transfer
   * conditions are best taken from the 'DMA1_CH<n>_EOT' / '_EOT_1' signals
   * (SocContext.onTrigger), which every DMA transfer emits.
   */
  dmaAck?(channel: number, remaining?: number): void
  /**
   * DMA block only: the OR of every peripheral's request on `channel`
   * changed (the SoC routes ctx.dmaRequest here).
   */
  dmaRequestChanged?(channel: number, active: boolean): void
  /**
   * Debugger halted/resumed the core. The SoC calls this only when the
   * block's DBGMCU_CR freeze bit is set (a peripheral cannot read DBGMCU).
   */
  debugHalt?(halted: boolean): void
}
