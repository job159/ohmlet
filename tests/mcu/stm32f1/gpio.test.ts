/**
 * GPIO (RM0008 §9.2) and the pin port: reset values, every MODE/CNF
 * combination → pin drive, BSRR/BRR/ODR, IDR from setInput, analog mode,
 * LCKR key sequence, JTAG/SWD pin ownership and release, RCC gating hint,
 * pinDriveChanged with exact cycles, bonding of the LQFP48.
 */
import { describe, expect, it } from 'vitest'
import { PIN_ANALOG, PIN_IN_FLOAT, PIN_IN_PULLDOWN, PIN_IN_PULLUP, PIN_OUT_OD, PIN_OUT_PP } from '../../../src/mcu/pins'
import { AFIO, GPIOA, GPIOB, GPIOC, makeSoc, r32, RCC_APB2ENR, recordPins, runToCycle, set32, w32 } from './helpers'

const CRL = 0x00
const CRH = 0x04
const IDR = 0x08
const ODR = 0x0c
const BSRR = 0x10
const BRR = 0x14
const LCKR = 0x18

function clocked() {
  const t = makeSoc()
  w32(t.soc, RCC_APB2ENR, 0x1d) // AFIO, IOPA, IOPB, IOPC
  return t
}

const cfg = (crl: number, bit: number, nibble: number) => (crl & ~(0xf << (bit * 4))) | (nibble << (bit * 4))

describe('GPIO registers', () => {
  it('reset values: CRL/CRH = 0x44444444 (floating inputs), ODR = 0', () => {
    const { soc } = clocked()
    expect(r32(soc, GPIOA + CRL)).toBe(0x44444444)
    expect(r32(soc, GPIOA + CRH)).toBe(0x44444444)
    expect(r32(soc, GPIOA + ODR)).toBe(0)
    expect(r32(soc, GPIOA + BSRR)).toBe(0)
    expect(soc.pins.drive(soc.pins.pinIndex('PA5')).mode).toBe(PIN_IN_FLOAT)
  })

  it('MODE/CNF → drive (RM0008 Table 20)', () => {
    const { soc } = clocked()
    const pa = (n: number) => soc.pins.drive(n)
    let crl = 0
    crl = cfg(crl, 0, 0x0) // analog
    crl = cfg(crl, 1, 0x4) // floating
    crl = cfg(crl, 2, 0x8) // pull (ODR=1 → up)
    crl = cfg(crl, 3, 0x8) // pull (ODR=0 → down)
    crl = cfg(crl, 4, 0x2) // GP push-pull 2 MHz
    crl = cfg(crl, 5, 0x7) // GP open-drain 50 MHz
    crl = cfg(crl, 6, 0xb) // AF push-pull
    crl = cfg(crl, 7, 0xf) // AF open-drain
    w32(soc, GPIOA + ODR, (1 << 2) | (1 << 4) | (1 << 5))
    w32(soc, GPIOA + CRL, crl)
    expect(pa(0).mode).toBe(PIN_ANALOG)
    expect(pa(1).mode).toBe(PIN_IN_FLOAT)
    expect(pa(2).mode).toBe(PIN_IN_PULLUP)
    expect(pa(3).mode).toBe(PIN_IN_PULLDOWN)
    expect(pa(4)).toEqual({ mode: PIN_OUT_PP, level: 1, af: false })
    expect(pa(5)).toEqual({ mode: PIN_OUT_OD, level: 1, af: false })
    expect(pa(6)).toEqual({ mode: PIN_OUT_PP, level: 0, af: true }) // no peripheral drives it: AF idles low
    expect(pa(7)).toEqual({ mode: PIN_OUT_OD, level: 0, af: true })
  })

  it('BSRR sets/resets (set wins), BRR resets, ODR read-modify-write', () => {
    const { soc } = clocked()
    w32(soc, GPIOA + BSRR, 0x00000021)
    expect(r32(soc, GPIOA + ODR)).toBe(0x21)
    w32(soc, GPIOA + BSRR, 0x00210000 | 0x0001) // reset bits 0 and 5, set bit 0 → set wins on bit 0
    expect(r32(soc, GPIOA + ODR)).toBe(0x01)
    w32(soc, GPIOA + BRR, 0x0001)
    expect(r32(soc, GPIOA + ODR)).toBe(0)
    w32(soc, GPIOA + ODR, 0xffffffff)
    expect(r32(soc, GPIOA + ODR)).toBe(0xffff)
  })

  it('IDR follows setInput; outputs read back their own level; analog reads 0', () => {
    const { soc } = clocked()
    const pa1 = soc.pins.pinIndex('PA1')
    soc.pins.setInput(pa1, 1, 3.3)
    // PA13 / PA15 read 1 through the JTAG pull-ups that are active after reset
    expect(r32(soc, GPIOA + IDR)).toBe((1 << 1) | (1 << 13) | (1 << 15))
    w32(soc, GPIOA + CRL, cfg(0x44444444, 2, 0x2)) // PA2 output PP
    w32(soc, GPIOA + BSRR, 1 << 2)
    expect(r32(soc, GPIOA + IDR) & 0xff).toBe((1 << 1) | (1 << 2))
    w32(soc, GPIOA + CRL, cfg(cfg(0x44444444, 2, 0x2), 1, 0x0)) // PA1 analog
    expect(r32(soc, GPIOA + IDR) & 0xff).toBe(1 << 2)
    expect(soc.pins.voltage(pa1)).toBe(3.3)
    // pull-up input with nothing attached reads 1
    w32(soc, GPIOA + CRL, cfg(0x44444444, 3, 0x8))
    w32(soc, GPIOA + BSRR, 1 << 3)
    expect(r32(soc, GPIOA + IDR) & (1 << 3)).toBe(1 << 3)
  })

  it('reports drive changes with the exact cycle of the register write', () => {
    const { soc } = clocked()
    const ev = recordPins(soc)
    runToCycle(soc, 1000)
    w32(soc, GPIOA + CRL, cfg(0x44444444, 5, 0x2))
    runToCycle(soc, 1234)
    w32(soc, GPIOA + BSRR, 1 << 5)
    w32(soc, GPIOA + BSRR, 1 << 5) // no change → no event
    runToCycle(soc, 2000)
    w32(soc, GPIOA + BRR, 1 << 5)
    expect(ev).toEqual([
      { pin: 5, cycle: 1000, mode: PIN_OUT_PP, level: 0 },
      { pin: 5, cycle: 1234, mode: PIN_OUT_PP, level: 1 },
      { pin: 5, cycle: 2000, mode: PIN_OUT_PP, level: 0 },
    ])
    expect(soc.timeOfCycle(1234)).toBeCloseTo(1234 / 8e6, 15)
  })

  it('writes to an unclocked port are ignored, with a one-time beginner hint', () => {
    const { soc } = makeSoc()
    w32(soc, GPIOC + CRH, cfg(0x44444444, 5, 0x2))
    w32(soc, GPIOC + BSRR, 1 << 13)
    expect(soc.pins.drive(45).mode).toBe(PIN_IN_FLOAT)
    const hints = soc.drainLog().filter((e) => e.source === 'GPIOC')
    expect(hints.length).toBe(1)
    expect(hints[0].message).toMatch(/RCC_APB2ENR.IOPCEN = 0.*__HAL_RCC_GPIOC_CLK_ENABLE\(\)/)
    set32(soc, RCC_APB2ENR, 1 << 4)
    w32(soc, GPIOC + CRH, cfg(0x44444444, 5, 0x2))
    expect(soc.pins.drive(45).mode).toBe(PIN_OUT_PP)
  })

  it('LQFP48 bonding: PC0–12 and PD2+ have no pin', () => {
    const { soc } = clocked()
    expect(soc.pins.pinName(45)).toBe('PC13')
    expect(soc.pins.pinName(32)).toBe('') // PC0
    expect(soc.pins.pinIndex('PC0')).toBe(-1)
    expect(soc.pins.pinIndex('PD1')).toBe(49)
    expect(soc.pins.pinIndex('PD2')).toBe(-1)
    expect(soc.pins.pinIndex('pa15')).toBe(15)
    w32(soc, GPIOC + CRL, 0x22222222) // outputs on unbonded PC0..7
    expect(soc.drainLog().some((e) => /PC0 is configured as an output but is not bonded/.test(e.message))).toBe(true)
  })
})

describe('GPIO lock (LCKR)', () => {
  it('the key sequence freezes the configuration of the locked pins until reset', () => {
    const { soc } = clocked()
    const lock = 1 << 5
    w32(soc, GPIOA + LCKR, (1 << 16) | lock)
    w32(soc, GPIOA + LCKR, lock)
    w32(soc, GPIOA + LCKR, (1 << 16) | lock)
    expect(r32(soc, GPIOA + LCKR)).toBe(lock) // read 0 (LCKK) completes the sequence
    expect(r32(soc, GPIOA + LCKR)).toBe((1 << 16) | lock) // read 1: locked
    w32(soc, GPIOA + CRL, 0x22222222)
    expect(r32(soc, GPIOA + CRL)).toBe(0x22422222) // PA5 kept its floating-input nibble
    w32(soc, GPIOA + LCKR, 0) // LCKR itself is frozen
    expect(r32(soc, GPIOA + LCKR)).toBe((1 << 16) | lock)
    w32(soc, GPIOA + ODR, 1 << 5) // ODR is not locked
    expect(r32(soc, GPIOA + ODR)).toBe(1 << 5)
    soc.reset('pin')
    set32(soc, RCC_APB2ENR, 1 << 2)
    expect(r32(soc, GPIOA + LCKR)).toBe(0)
  })

  it('a wrong sequence (changed LCK, or a write instead of the read) aborts', () => {
    const { soc } = clocked()
    w32(soc, GPIOB + LCKR, (1 << 16) | 1)
    w32(soc, GPIOB + LCKR, 3) // LCK changed
    w32(soc, GPIOB + LCKR, (1 << 16) | 3)
    r32(soc, GPIOB + LCKR)
    expect(r32(soc, GPIOB + LCKR) & (1 << 16)).toBe(0)
    w32(soc, GPIOB + LCKR, (1 << 16) | 1)
    w32(soc, GPIOB + LCKR, 1)
    w32(soc, GPIOB + LCKR, (1 << 16) | 1)
    w32(soc, GPIOB + LCKR, 1) // write instead of the read
    expect(r32(soc, GPIOB + LCKR) & (1 << 16)).toBe(0)
    w32(soc, GPIOB + CRL, 0x22222222)
    expect(r32(soc, GPIOB + CRL)).toBe(0x22222222)
  })
})

describe('debug port pins (SWJ_CFG)', () => {
  it('after reset PA13/PA14/PA15/PB4 carry the JTAG pulls and ignore GPIO writes until released', () => {
    const { soc } = clocked()
    const PA13 = 13
    const PA14 = 14
    const PA15 = 15
    const PB3 = 19
    const PB4 = 20
    expect(soc.pins.drive(PA13).mode).toBe(PIN_IN_PULLUP)
    expect(soc.pins.drive(PA14).mode).toBe(PIN_IN_PULLDOWN)
    expect(soc.pins.drive(PA15).mode).toBe(PIN_IN_PULLUP)
    expect(soc.pins.drive(PB3).mode).toBe(PIN_IN_FLOAT)
    expect(soc.pins.drive(PB4).mode).toBe(PIN_IN_PULLUP)
    w32(soc, GPIOA + CRH, 0x22222222)
    w32(soc, GPIOB + CRL, 0x22222222)
    w32(soc, GPIOA + BSRR, 0xffff)
    expect(r32(soc, GPIOA + CRH)).toBe(0x22222222) // stored…
    expect(soc.pins.drive(PA15).mode).toBe(PIN_IN_PULLUP) // …but not on the pin
    // SWJ_CFG = 001: NJTRST released
    w32(soc, AFIO + 4, 1 << 24)
    expect(soc.pins.drive(PB4).mode).toBe(PIN_OUT_PP)
    expect(soc.pins.drive(PA15).mode).toBe(PIN_IN_PULLUP)
    // 010 (HAL __HAL_AFIO_REMAP_SWJ_NOJTAG): PA15/PB3/PB4 free, SWD stays
    w32(soc, AFIO + 4, 2 << 24)
    expect(soc.pins.drive(PA15)).toEqual({ mode: PIN_OUT_PP, level: 1, af: false })
    expect(soc.pins.drive(PB3).mode).toBe(PIN_OUT_PP)
    expect(soc.pins.drive(PA13).mode).toBe(PIN_IN_PULLUP)
    // SWJ_CFG reads 0 and 111 ("other combinations") has no effect — as HAL's AFIO_REMAP_ENABLE writes it
    expect(r32(soc, AFIO + 4)).toBe(0)
    w32(soc, AFIO + 4, (7 << 24) | (1 << 2))
    expect(soc.pins.drive(PA13).mode).toBe(PIN_IN_PULLUP)
    expect(soc.afio.swj).toBe(2)
    // 100: everything released
    w32(soc, AFIO + 4, 4 << 24)
    expect(soc.pins.drive(PA13).mode).toBe(PIN_OUT_PP)
    expect(soc.pins.drive(PA14).mode).toBe(PIN_OUT_PP)
  })

  it('oscillator pins: PD0/PD1 need PD01_REMAP and HSE off; PC14/PC15 belong to the LSE while it runs', () => {
    const { soc } = makeSoc()
    w32(soc, RCC_APB2ENR, 0x21) // AFIO + IOPD
    w32(soc, 0x40011400 + CRL, 0x44444422)
    expect(soc.pins.drive(48).mode).toBe(PIN_IN_FLOAT) // OSC_IN without remap
    w32(soc, AFIO + 4, 1 << 15)
    expect(soc.pins.drive(48).mode).toBe(PIN_OUT_PP)
    set32(soc, 0x40021000, 1 << 16) // HSEON
    expect(soc.pins.drive(48).mode).toBe(PIN_IN_FLOAT)
  })

  it('unpowered: every pin is high-Z', () => {
    const { soc } = clocked()
    w32(soc, GPIOA + CRL, 0x22222222)
    expect(soc.pins.drive(0).mode).toBe(PIN_OUT_PP)
    const ev = recordPins(soc)
    soc.setPowered(false)
    expect(soc.pins.drive(0).mode).toBe(PIN_IN_FLOAT)
    expect(soc.pins.drive(13).mode).toBe(PIN_IN_FLOAT)
    expect(ev.some((e) => e.pin === 0)).toBe(true)
  })
})

describe('AFIO registers (RM0008 §9.4)', () => {
  it('reset values, MAPR remap decoding, EXTICR read-back, MAPR2 and EVCR reporting', () => {
    const { soc } = clocked()
    for (const off of [0x00, 0x04, 0x08, 0x0c, 0x10, 0x14, 0x1c]) expect(r32(soc, AFIO + off)).toBe(0)
    expect(soc.afio.remap()).toEqual({ spi1: false, i2c1: false, usart1: false, usart2: false, usart3: 0, tim1: 0, tim2: 0, tim3: 0, tim4: false, swj: 0 })
    // SPI1, USART1, USART3 full, TIM1 partial, TIM2 full, TIM3 partial (10), TIM4, PD01
    w32(soc, AFIO + 4, 1 | (1 << 2) | (3 << 4) | (1 << 6) | (3 << 8) | (2 << 10) | (1 << 12) | (1 << 15))
    expect(soc.afio.remap()).toEqual({ spi1: true, i2c1: false, usart1: true, usart2: false, usart3: 3, tim1: 1, tim2: 3, tim3: 2, tim4: true, swj: 0 })
    expect(r32(soc, AFIO + 4)).toBe(0x9b75)
    w32(soc, AFIO + 0x08, 0x2101) // EXTI0 → B, EXTI2 → B, EXTI3 → C
    expect(r32(soc, AFIO + 0x08)).toBe(0x2101)
    expect([...soc.afio.exticr.slice(0, 4)]).toEqual([1, 0, 1, 2])
    w32(soc, AFIO + 0x1c, 1 << 5)
    w32(soc, AFIO + 0x00, 0x80)
    const msgs = soc.drainLog().map((e) => e.message).join('\n')
    expect(msgs).toMatch(/AFIO_MAPR2 remaps exist only on XL-density/)
    expect(msgs).toMatch(/EVENTOUT pin output is not simulated/)
  })

  it('remap notifications reach the peripherals (USART3 full remap → unbonded PD8)', () => {
    const { soc } = clocked()
    w32(soc, 0x4002101c, 1 << 18) // USART3EN
    w32(soc, 0x40004808, 100)
    w32(soc, AFIO + 4, 3 << 4)
    w32(soc, 0x4000480c, (1 << 13) | (1 << 3))
    expect(soc.drainLog().some((e) => /USART3 TX is mapped to PD8, which is not bonded out/.test(e.message))).toBe(true)
  })
})
