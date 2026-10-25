/**
 * The STM32F103C8 peripheral list — every register block on the APB/AHB
 * buses that is not part of the SoC core (RCC, FLASH, PWR, GPIO, AFIO,
 * EXTI live in soc.ts). Adding a block = one new file implementing
 * `Stm32Peripheral` (periph-api.ts) + changing its line here from
 * `unsupported(...)` to `() => new MyBlock(...)`.
 *
 * Addresses: RM0008 §3.3 Table 3 / DS5319 Figure 11. RCC gates: §7.3.6–8.
 * DBGMCU freeze bits: §31.16.3.
 *
 * Support status honesty: `verified` needs a passing real-firmware
 * integration test (tests/mcu/stm32f1/firmware.test.ts). Those tests need
 * the Cortex-M3 core (src/mcu/core/cpu.ts); `FIRMWARE_VERIFIED` records
 * that they ran green. Only blocks with every documented function
 * implemented (`complete`) AND a passing firmware test become `verified`;
 * everything else stays `partial` with its gaps in the notes.
 */
import type { PeripheralSupport, SupportStatus } from '../mcu-api'
import { Adc, ADC1_CONFIG, ADC2_CONFIG, ADC_NOTES } from './adc'
import { AHB, APB1, APB2, type BlockSpec } from './block'
import { Bkp } from './bkp'
import { Crc } from './crc'
import { Dma1, DMA1_NOTES } from './dma'
import { I2C1_CONFIG, I2C2_CONFIG, I2C_NOTES, I2c } from './i2c'
import { Iwdg } from './iwdg'
import { SPI1_CONFIG, SPI2_CONFIG, SPI_NOTES, Spi } from './spi'
import { Tim, TIM1_CONFIG, TIM2_CONFIG, TIM3_CONFIG, TIM4_CONFIG, TIM_SUPPORT } from './tim'
import { unsupported } from './unsupported'
import { USART1_CONFIG, USART2_CONFIG, USART3_CONFIG, Usart } from './usart'
import { Wwdg } from './wwdg'

/**
 * true: tests/mcu/stm32f1/firmware.test.ts has passed against the real core
 * (src/mcu/core/cpu.ts). Set back to false if that suite stops passing.
 */
export const FIRMWARE_VERIFIED = true

const PENDING = ' Real-firmware verification pending (needs the Cortex-M3 core).'

const USART_NOTES =
  'Asynchronous mode: BRR baud from PCLK, 8/9-bit words, parity, 0.5/1/1.5/2 stop bits, bit-exact TX waveform on the AF pin (incl. the TE idle preamble and SBK breaks), RX from pin edges with 3-sample majority (NE), FE/PE/ORE/IDLE and the SR→DR clear sequences, TXE/TC/RXNE/IDLE/PE/error interrupts, DMA request lines, AFIO remaps (remaps onto pins the LQFP48 does not bond are reported). Not simulated (logged): synchronous/CK, LIN, IrDA, smartcard, half-duplex, RTS/CTS, mute mode.'

export const PERIPHERALS: BlockSpec[] = [
  // ---- APB1
  { name: 'TIM2', base: TIM2_CONFIG.base, gate: TIM2_CONFIG.gate, dbgFreezeBit: 11, make: () => new Tim(TIM2_CONFIG), status: 'partial', ...TIM_SUPPORT.TIM2 },
  { name: 'TIM3', base: TIM3_CONFIG.base, gate: TIM3_CONFIG.gate, dbgFreezeBit: 12, make: () => new Tim(TIM3_CONFIG), status: 'partial', ...TIM_SUPPORT.TIM3 },
  { name: 'TIM4', base: TIM4_CONFIG.base, gate: TIM4_CONFIG.gate, dbgFreezeBit: 13, make: () => new Tim(TIM4_CONFIG), status: 'partial', ...TIM_SUPPORT.TIM4 },
  { name: 'RTC', base: 0x40002800, gate: null, make: unsupported('RTC', 'The RTC'), status: 'unsupported', notes: 'Not implemented: registers read 0, writes ignored. RCC_BDCR (LSE, RTCSEL, RTCEN) itself works.' },
  {
    name: 'WWDG',
    base: 0x40002c00,
    gate: APB1(11),
    dbgFreezeBit: 9,
    make: (env) => new Wwdg(env),
    status: 'partial',
    complete: true,
    notes: 'Full register model: free-running 7-bit counter at PCLK1/4096/2^WDGTB, window check, T6 reset, early-wakeup interrupt (IRQ 0), WWDGRSTF, DBG_WWDG_STOP freeze. The prescaler phase restarts on each CR write (≤ 1 tick difference from silicon). Unit-tested only.',
  },
  {
    name: 'IWDG',
    base: 0x40003000,
    gate: null,
    dbgFreezeBit: 8,
    make: (env) => new Iwdg(env),
    status: 'partial',
    complete: true,
    notes: 'Full register model: KR keys, PR/RLR write protection, PVU/RVU update delay, LSI 40 kHz timing, reset with IWDGRSTF (+PINRSTF), DBG_IWDG_STOP freeze. Hardware-watchdog option byte not modelled (factory default = software watchdog).',
    verifiedBy: ['soc-iwdg'],
  },
  { name: 'SPI2', base: SPI2_CONFIG.base, gate: SPI2_CONFIG.gate, make: () => new Spi(SPI2_CONFIG), status: 'partial', notes: SPI_NOTES + ' Same model as SPI1; slave mode unit-tested on SPI2.' },
  // USART2 / USART3: real HAL firmware with the communication modules (tests/devices/comm-firmware.test.ts)
  {
    name: 'USART2',
    base: USART2_CONFIG.base,
    gate: USART2_CONFIG.gate,
    make: () => new Usart(USART2_CONFIG),
    status: 'partial',
    notes:
      USART_NOTES +
      ' Same model as USART1; real HAL firmware runs on USART2 too (hal-ch340, hal-hc05, hal-esp01: echo and AT dialogues with the module in both directions; hal-rs485: its report output).',
    verifiedBy: ['hal-ch340', 'hal-hc05', 'hal-esp01', 'hal-rs485'],
  },
  {
    name: 'USART3',
    base: USART3_CONFIG.base,
    gate: USART3_CONFIG.gate,
    make: () => new Usart(USART3_CONFIG),
    status: 'partial',
    notes: USART_NOTES + ' Same model as USART1; real HAL firmware runs on USART3 too (hal-rs485: the RS-485 ping-pong with USART1, both directions).',
    verifiedBy: ['hal-rs485'],
  },
  { name: 'I2C1', base: I2C1_CONFIG.base, gate: I2C1_CONFIG.gate, dbgFreezeBit: 15, make: () => new I2c(I2C1_CONFIG), status: 'partial', notes: I2C_NOTES, verifiedBy: ['hal-i2c-scan', 'hal-i2c-eeprom'] },
  { name: 'I2C2', base: I2C2_CONFIG.base, gate: I2C2_CONFIG.gate, dbgFreezeBit: 16, make: () => new I2c(I2C2_CONFIG), status: 'partial', notes: I2C_NOTES + ' Same model as I2C1; slave mode unit-tested on I2C2.' },
  { name: 'USB', base: 0x40005c00, gate: APB1(23), make: unsupported('USB', 'The USB full-speed device'), status: 'unsupported', notes: 'Not implemented: registers read 0, writes ignored.' },
  { name: 'USB/CAN SRAM', base: 0x40006000, gate: null, make: unsupported('USB/CAN SRAM', 'The shared USB/CAN packet SRAM'), status: 'unsupported', notes: 'Not implemented: reads 0, writes ignored.' },
  { name: 'CAN', base: 0x40006400, gate: APB1(25), dbgFreezeBit: 14, make: unsupported('CAN', 'bxCAN'), status: 'unsupported', notes: 'Not implemented: registers read 0, writes ignored.' },
  {
    name: 'BKP',
    base: 0x40006c00,
    gate: APB1(27),
    make: (env) => new Bkp(env),
    status: 'partial',
    notes: 'DR1–DR10 with PWR_CR.DBP write protection, kept across system resets, cleared by power-on / BDRST; tamper detection on PC13 (TEF/TIF, IRQ 2). RTC calibration/alarm outputs (RTCCR CCO/ASOE) need the RTC (unsupported).',
    verifiedBy: ['soc-iwdg'],
  },
  // ---- APB2
  { name: 'ADC1', base: ADC1_CONFIG.base, gate: ADC1_CONFIG.gate, make: () => new Adc(ADC1_CONFIG), status: 'partial', notes: ADC_NOTES, verifiedBy: ['hal-adc-pot', 'hal-adc-dma'] },
  { name: 'ADC2', base: ADC2_CONFIG.base, gate: ADC2_CONFIG.gate, make: () => new Adc(ADC2_CONFIG), status: 'partial', notes: ADC_NOTES + ' Same model as ADC1 (unit-tested through ADC1): IN16/IN17 are VSS, no DMA request.' },
  { name: 'TIM1', base: TIM1_CONFIG.base, gate: TIM1_CONFIG.gate, dbgFreezeBit: 10, make: () => new Tim(TIM1_CONFIG), status: 'partial', ...TIM_SUPPORT.TIM1 },
  { name: 'SPI1', base: SPI1_CONFIG.base, gate: SPI1_CONFIG.gate, make: () => new Spi(SPI1_CONFIG), status: 'partial', notes: SPI_NOTES, verifiedBy: ['hal-spi-595', 'hal-spi-loopback'] },
  { name: 'USART1', base: USART1_CONFIG.base, gate: USART1_CONFIG.gate, make: () => new Usart(USART1_CONFIG), status: 'partial', notes: USART_NOTES, verifiedBy: ['soc-uart', 'soc-clock', 'soc-iwdg'] },
  // ---- AHB
  { name: 'DMA1', base: 0x40020000, gate: AHB(0), make: () => new Dma1(), status: 'partial', notes: DMA1_NOTES, verifiedBy: ['hal-dma-m2m', 'hal-adc-dma', 'hal-uart-dma'] },
  {
    name: 'CRC',
    base: 0x40023000,
    gate: AHB(6),
    make: () => new Crc(),
    status: 'partial',
    complete: true,
    notes: 'Full: CRC-32/0x04C11DB7 on 32-bit words, IDR, CR.RESET. The 4-cycle computation latency is not timed (reads see the result at once, as a stalled read would). Unit-tested only.',
  },
]

interface CoreSupport {
  name: string
  /** every documented function implemented (only then can it become 'verified') */
  complete: boolean
  notes: string
  verifiedBy?: string[]
}

/** Support entries for the blocks soc.ts implements itself. */
const CORE_SUPPORT: CoreSupport[] = [
  {
    name: 'Memory map',
    complete: false,
    notes: '128 KiB flash at 0x08000000 (C8 datasheet: 64 KiB — larger images load with a warning), boot alias by BOOT0, 20 KiB SRAM, F_SIZE = 64, fixed 96-bit UID, factory option bytes, BusFault on unmapped / reserved addresses. The ST system-memory bootloader (BOOT0 = 1) is not emulated: the core parks in a stub loop and an error is logged.',
    verifiedBy: ['hal-blink', 'bare-blink'],
  },
  {
    name: 'RCC',
    complete: false, // MCO output and a failing-HSE / CSS scenario are not simulated
    notes: 'All F103 registers. HSI ready at reset; HSE 8 MHz ready 1 ms after HSEON; PLL lock 200 µs; LSI 85 µs; LSE 500 ms. SW → SWS only to ready sources; protected HSION/HSEON/PLLON; PLL config only while PLLON = 0; full clock tree (PLLSRC/PLLXTPRE/PLLMUL, HPRE, PPRE1/2, ADCPRE, TIMxCLK ×2) with datasheet-limit warnings; exact cycle↔time rebase on every HCLK change; APBxRSTR resets; CSR reset flags (POR/PIN/SFT/IWDG/WWDG/LPWR); ready interrupts. CSS never triggers (the simulated crystal cannot fail); MCO is not output.',
    verifiedBy: ['hal-blink', 'soc-clock', 'soc-iwdg'],
  },
  {
    name: 'FLASH',
    complete: false,
    notes: 'ACR (latency-too-low warning), KEYR unlock (wrong key = bus error + lock-out), half-word programming with PGERR, page / mass erase, BSY timing (52.5 µs / 20 ms), EOP and interrupts. Not modelled: the CPU stall while BSY, option-byte programming, write protection.',
    verifiedBy: ['hal-blink'],
  },
  {
    name: 'GPIO',
    complete: true,
    notes: 'GPIOA–D on the LQFP48 bonding (PA0–15, PB0–15, PC13–15, PD0–1): CRL/CRH/IDR/ODR/BSRR/BRR/LCKR incl. the lock key sequence; all MODE × CNF combinations; pull-up/down via ODR; RCC gating (writes with IOPxEN = 0 are ignored, with a hint); JTAG/SWD pins owned by the debug port until SWJ_CFG releases them; oscillator pins. Port E registers exist but have no pins.',
    verifiedBy: ['hal-blink', 'bare-blink', 'soc-exti'],
  },
  {
    name: 'AFIO',
    complete: false,
    notes: 'MAPR remaps (USART/SPI/I2C/TIM/CAN fields, PD01), SWJ_CFG write-only semantics, EXTICR1–4, MAPR2 (no effect on this device). EVCR EVENTOUT is stored but not driven onto a pin.',
    verifiedBy: ['hal-blink', 'soc-exti'],
  },
  {
    name: 'EXTI',
    complete: true,
    notes: 'All registers; rising/falling edges at the exact cycle (pin inputs and own outputs), SWIER, PR write-1-to-clear, IRQ lines 6–10/23/40, events (EMR) to the core. Lines 16–18 (PVD, RTC alarm, USB wake-up) have no source.',
    verifiedBy: ['soc-exti'],
  },
  {
    name: 'PWR',
    complete: false,
    notes: 'CR/CSR incl. DBP backup-domain protection and EWUP (PA0 pull-down). Stop / Standby are approximated as Sleep (logged); PVD output constant (VDD nominal).',
    verifiedBy: ['soc-iwdg'],
  },
  {
    name: 'DBGMCU',
    complete: false,
    notes: 'IDCODE 0x20036410 (readable as if a debugger were attached — silicon reads 0 otherwise, errata ES096), CR freeze bits applied to IWDG, WWDG and TIM1–TIM4 while the core is halted (a frozen TIM1 also disables its outputs); the I2C SMBus-timeout and CAN bits have no effect (SMBus and bxCAN are not simulated). Trace output not simulated.',
  },
]

function entry(name: string, base: SupportStatus, complete: boolean, notes: string, verifiedBy?: string[]): PeripheralSupport {
  if (base === 'unsupported') return { name, status: 'unsupported', notes }
  const verified = complete && FIRMWARE_VERIFIED && !!verifiedBy?.length
  const pending = !FIRMWARE_VERIFIED && !!verifiedBy?.length
  return { name, status: verified ? 'verified' : 'partial', notes: notes + (pending ? PENDING : ''), ...(verifiedBy ? { verifiedBy } : {}) }
}

/** The honest per-block table exposed as McuDevice.support. */
export function supportTable(specs: readonly BlockSpec[] = PERIPHERALS): PeripheralSupport[] {
  return [
    ...CORE_SUPPORT.map((c) => entry(c.name, 'partial', c.complete, c.notes, c.verifiedBy)),
    ...specs.map((s) => entry(s.name, s.status, s.complete === true, s.notes, s.verifiedBy)),
  ]
}
