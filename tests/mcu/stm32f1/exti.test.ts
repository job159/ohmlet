/**
 * EXTI (RM0008 ch. 10) + AFIO_EXTICR: rising/falling edge detection at the
 * exact cycle, pending register (rc_w1), NVIC line mapping, software
 * interrupts, event mask → core event, AFIO clock gating of EXTICR.
 */
import { describe, expect, it } from 'vitest'
import { extiIrq } from '../../../src/mcu/stm32f1/exti'
import { AFIO, EXTI, GPIOA, GPIOB, makeSoc, r32, RCC_APB2ENR, runToCycle, w32 } from './helpers'

const IMR = EXTI + 0x00
const EMR = EXTI + 0x04
const RTSR = EXTI + 0x08
const FTSR = EXTI + 0x0c
const SWIER = EXTI + 0x10
const PR = EXTI + 0x14

function setup() {
  const t = makeSoc()
  w32(t.soc, RCC_APB2ENR, 0x0d) // AFIO, IOPA, IOPB
  return t
}

describe('EXTI', () => {
  it('maps lines to IRQs (Table 63)', () => {
    expect([0, 1, 2, 3, 4].map(extiIrq)).toEqual([6, 7, 8, 9, 10])
    expect([5, 9].map(extiIrq)).toEqual([23, 23])
    expect([10, 15].map(extiIrq)).toEqual([40, 40])
    expect([16, 17, 18].map(extiIrq)).toEqual([1, 41, 42])
  })

  it('falling edge on PB12 (EXTICR4) pends line 12 and asserts EXTI15_10 (IRQ 40) at that cycle', () => {
    const { soc, core } = setup()
    const PB12 = soc.pins.pinIndex('PB12')
    w32(soc, AFIO + 0x14, 0x1) // EXTICR4: line 12 → port B
    w32(soc, GPIOB + 0x04, 0x44484444) // PB12 (CRH nibble 4) input with pull
    w32(soc, GPIOB + 0x10, 1 << 12) // pull-up
    w32(soc, FTSR, 1 << 12)
    w32(soc, IMR, 1 << 12)
    expect(r32(soc, PR)).toBe(0)
    runToCycle(soc, 5000)
    soc.pins.setInput(PB12, 0, 0)
    expect(r32(soc, PR)).toBe(1 << 12)
    expect(core.irqLines[40]).toBe(1)
    expect(core.irqLog.at(-1)).toEqual({ irq: 40, on: true, cycle: 5000 })
    // rising edge is not selected
    w32(soc, PR, 1 << 12)
    expect(core.irqLines[40]).toBe(0)
    soc.pins.setInput(PB12, 1, 3.3)
    expect(r32(soc, PR)).toBe(0)
    w32(soc, RTSR, 1 << 12)
    soc.pins.setInput(PB12, 0, 0)
    soc.pins.setInput(PB12, 1, 3.3)
    expect(r32(soc, PR)).toBe(1 << 12)
  })

  it('a line only sees the port EXTICR selects; masked lines do not pend', () => {
    const { soc, core } = setup()
    w32(soc, RTSR, 1 << 3)
    w32(soc, IMR, 1 << 3)
    soc.pins.setInput(soc.pins.pinIndex('PB3'), 1, 3.3) // EXTICR1 line 3 still = port A
    expect(r32(soc, PR)).toBe(0)
    soc.pins.setInput(soc.pins.pinIndex('PA3'), 1, 3.3)
    expect(r32(soc, PR)).toBe(1 << 3)
    expect(core.irqLines[9]).toBe(1)
    w32(soc, PR, 1 << 3)
    w32(soc, IMR, 0)
    soc.pins.setInput(soc.pins.pinIndex('PA3'), 0, 0)
    soc.pins.setInput(soc.pins.pinIndex('PA3'), 1, 3.3)
    expect(r32(soc, PR)).toBe(0)
  })

  it('an output pin toggling itself triggers its EXTI line (input buffer stays on)', () => {
    const { soc } = setup()
    w32(soc, GPIOA + 0x00, 0x44444442) // PA0 output
    w32(soc, RTSR, 1)
    w32(soc, IMR, 1)
    w32(soc, GPIOA + 0x10, 1)
    expect(r32(soc, PR)).toBe(1)
  })

  it('SWIER pends on a 0→1 write; clearing PR clears SWIER; EMR signals a core event', () => {
    const { soc, core } = setup()
    w32(soc, IMR, 1 << 7)
    w32(soc, SWIER, 1 << 7)
    expect(r32(soc, PR)).toBe(1 << 7)
    expect(r32(soc, SWIER)).toBe(1 << 7)
    expect(core.irqLines[23]).toBe(1)
    w32(soc, PR, 1 << 7)
    expect(r32(soc, SWIER)).toBe(0)
    expect(core.irqLines[23]).toBe(0)
    w32(soc, EMR, 1 << 1)
    w32(soc, FTSR, 1 << 1)
    soc.pins.setInput(1, 1, 3.3)
    soc.pins.setInput(1, 0, 0)
    expect(core.events).toBe(1)
    expect(r32(soc, PR) & 2).toBe(0) // IMR not set: event only
  })

  it('EXTICR writes are lost while the AFIO clock is off (classic beginner bug)', () => {
    const { soc } = makeSoc()
    w32(soc, RCC_APB2ENR, 1 << 3)
    w32(soc, AFIO + 0x14, 0x1)
    expect(soc.afio.exticr[12]).toBe(0)
    expect(soc.drainLog().some((e) => /RCC_APB2ENR.AFIOEN = 0/.test(e.message))).toBe(true)
  })

  it('registers mask to 19 lines', () => {
    const { soc } = setup()
    for (const r of [IMR, EMR, RTSR, FTSR]) {
      w32(soc, r, 0xffffffff)
      expect(r32(soc, r)).toBe(0x7ffff)
    }
  })
})
