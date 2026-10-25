/**
 * Per-instance wiring of the STM32F103C8 timers (tim.ts): bus base, RCC
 * gate, kernel clock, NVIC lines, DMA1 request channels, internal-trigger
 * (ITRx) masters and the pins of every AFIO remap on the LQFP48.
 *
 *  - bases / gates: RM0008 §3.3 Table 3, §7.3.7–7.3.8 (TIM1EN = APB2ENR
 *    bit 11, TIM2/3/4EN = APB1ENR bits 0/1/2);
 *  - IRQs: RM0008 Table 63 (TIM1_BRK 24, TIM1_UP 25, TIM1_TRG_COM 26,
 *    TIM1_CC 27, TIM2 28, TIM3 29, TIM4 30);
 *  - DMA1 channels: RM0008 §13.3.7 Table 78 / Figure 50;
 *  - ITRx: Table 82 (TIM1) and Table 86 (TIM2–4); TIM5 and TIM8 do not
 *    exist on the medium-density F103, so those triggers stay unconnected;
 *  - pins: §9.3.7 Tables 44–47 (TIM1/2/3/4 remaps), DS5319 Table 5. Pins
 *    the LQFP48 does not bond (port E, PC6–PC9, PD2, PD12–PD15) are kept
 *    by name and resolve to -1 (SocContext.pin), so a remap onto them is
 *    reported instead of silently driving nothing.
 */
import type { AfioRemap, RccGate } from './periph-api'
import { APB1, APB2 } from './block'

export type TimName = 'TIM1' | 'TIM2' | 'TIM3' | 'TIM4'

export interface TimPins {
  /** CH1..CH4 (also the TI1..TI4 inputs) */
  ch: [string, string, string, string]
  /** CH1N..CH3N (TIM1 only) */
  chn: [string, string, string] | null
  etr: string
  /** TIM1_BKIN */
  bkin: string | null
}

export interface TimConfig {
  name: TimName
  base: number
  gate: RccGate
  /** advanced-control timer (TIM1): RCR, BDTR, complementary outputs, COM, break */
  advanced: boolean
  /** kernel clock: TIMXCLK of APB1 (TIM2–4) or APB2 (TIM1) */
  apb: 1 | 2
  irq: { brk: number; up: number; trgCom: number; cc: number }
  /** DMA1 channel per request (0 = no request line), Table 78 */
  dma: { up: number; cc: [number, number, number, number]; trig: number; com: number }
  /** master timer of ITR0..ITR3 (null = not present on this device) */
  itr: [TimName | null, TimName | null, TimName | null, TimName | null]
  pins(r: AfioRemap): TimPins
}

export const TIM1_CONFIG: TimConfig = {
  name: 'TIM1',
  base: 0x40012c00,
  gate: APB2(11),
  advanced: true,
  apb: 2,
  irq: { brk: 24, up: 25, trgCom: 26, cc: 27 },
  dma: { up: 5, cc: [2, 3, 6, 4], trig: 4, com: 4 },
  itr: [null, 'TIM2', 'TIM3', 'TIM4'],
  pins: (r) =>
    r.tim1 === 3
      ? { ch: ['PE9', 'PE11', 'PE13', 'PE14'], chn: ['PE8', 'PE10', 'PE12'], etr: 'PE7', bkin: 'PE15' }
      : r.tim1 === 1
        ? { ch: ['PA8', 'PA9', 'PA10', 'PA11'], chn: ['PA7', 'PB0', 'PB1'], etr: 'PA12', bkin: 'PA6' }
        : { ch: ['PA8', 'PA9', 'PA10', 'PA11'], chn: ['PB13', 'PB14', 'PB15'], etr: 'PA12', bkin: 'PB12' },
}

export const TIM2_CONFIG: TimConfig = {
  name: 'TIM2',
  base: 0x40000000,
  gate: APB1(0),
  advanced: false,
  apb: 1,
  irq: { brk: 28, up: 28, trgCom: 28, cc: 28 },
  dma: { up: 2, cc: [5, 7, 1, 7], trig: 0, com: 0 },
  itr: ['TIM1', null, 'TIM3', 'TIM4'],
  pins: (r) => {
    const lo = r.tim2 & 1 ? ['PA15', 'PB3'] : ['PA0', 'PA1']
    const hi = r.tim2 & 2 ? ['PB10', 'PB11'] : ['PA2', 'PA3']
    return { ch: [lo[0], lo[1], hi[0], hi[1]], chn: null, etr: lo[0], bkin: null }
  },
}

export const TIM3_CONFIG: TimConfig = {
  name: 'TIM3',
  base: 0x40000400,
  gate: APB1(1),
  advanced: false,
  apb: 1,
  irq: { brk: 29, up: 29, trgCom: 29, cc: 29 },
  dma: { up: 3, cc: [6, 0, 2, 3], trig: 6, com: 0 },
  itr: ['TIM1', 'TIM2', null, 'TIM4'],
  pins: (r) => ({
    ch: r.tim3 === 3 ? ['PC6', 'PC7', 'PC8', 'PC9'] : r.tim3 === 2 ? ['PB4', 'PB5', 'PB0', 'PB1'] : ['PA6', 'PA7', 'PB0', 'PB1'],
    chn: null,
    etr: 'PD2',
    bkin: null,
  }),
}

export const TIM4_CONFIG: TimConfig = {
  name: 'TIM4',
  base: 0x40000800,
  gate: APB1(2),
  advanced: false,
  apb: 1,
  irq: { brk: 30, up: 30, trgCom: 30, cc: 30 },
  dma: { up: 7, cc: [1, 4, 5, 0], trig: 0, com: 0 },
  itr: ['TIM1', 'TIM2', 'TIM3', null],
  pins: (r) => ({
    ch: r.tim4 ? ['PD12', 'PD13', 'PD14', 'PD15'] : ['PB6', 'PB7', 'PB8', 'PB9'],
    chn: null,
    etr: 'PE0',
    bkin: null,
  }),
}
