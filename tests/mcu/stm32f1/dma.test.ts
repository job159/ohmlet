/**
 * DMA1 (RM0008 ch. 13) driven through the system bus like firmware:
 * memory-to-memory copies with the modelled transfer timing, PSIZE/MSIZE
 * packing (Table 76) and APB lane replication (§13.3.5), priority
 * arbitration, peripheral request lines (level-driven, acknowledged through
 * the SoC), circular mode with HT/TC, transfer errors, register rules,
 * interrupts, clock gating, and the real USART1 / ADC1 models as requesters.
 *
 * Clocks: HSI 8 MHz, AHB/APB1/APB2 /1 → one transfer SRAM→SRAM = 2 + 2 + 2
 * = 6 cycles; APB ↔ SRAM = 2 + (2 + 1) + 2 = 7 cycles.
 */
import { describe, expect, it } from 'vitest'
import type { AccessSize } from '../../../src/mcu/core/types'
import type { CreateCortexM3 } from '../../../src/mcu/core/cpu-api'
import type { UartTap } from '../../../src/mcu/mcu-api'
import type { SocBlock } from '../../../src/mcu/stm32f1/block'
import type { Dma1 } from '../../../src/mcu/stm32f1/dma'
import type { SocContext } from '../../../src/mcu/stm32f1/periph-api'
import { PERIPHERALS } from '../../../src/mcu/stm32f1/peripherals'
import { Stm32f103 } from '../../../src/mcu/stm32f1/soc'
import { GPIOA, makeSoc, r32, RCC_AHBENR, RCC_APB2ENR, runToCycle, StubCore, USART1, w32 } from './helpers'

const DMA1 = 0x40020000
const ISR = DMA1 + 0x00
const IFCR = DMA1 + 0x04
const CCR = (n: number) => DMA1 + 0x08 + 20 * (n - 1)
const CNDTR = (n: number) => DMA1 + 0x0c + 20 * (n - 1)
const CPAR = (n: number) => DMA1 + 0x10 + 20 * (n - 1)
const CMAR = (n: number) => DMA1 + 0x14 + 20 * (n - 1)

const EN = 1
const TCIE = 2
const HTIE = 4
const TEIE = 8
const DIR = 16
const CIRC = 32
const PINC = 64
const MINC = 128
const PSIZE = (s: 8 | 16 | 32) => (s === 8 ? 0 : s === 16 ? 1 : 2) << 8
const MSIZE = (s: 8 | 16 | 32) => (s === 8 ? 0 : s === 16 ? 1 : 2) << 10
const PL = (p: number) => p << 12
const MEM2MEM = 1 << 14

const flag = (n: number, f: 'G' | 'TC' | 'HT' | 'TE') => ({ G: 1, TC: 2, HT: 4, TE: 8 })[f] << (4 * (n - 1))

const SRAM = 0x20000000
const M2M = 6
const APB = 7

const dmaOn = (soc: Stm32f103) => w32(soc, RCC_AHBENR, 0x15)
const fill32 = (soc: Stm32f103, a: number, words: number[]) => words.forEach((v, i) => soc.bus.write32(a + 4 * i, v))
const read32s = (soc: Stm32f103, a: number, n: number) => Array.from({ length: n }, (_, i) => soc.bus.read32(a + 4 * i) >>> 0)

describe('DMA1 memory-to-memory', () => {
  it('copies words SRAM → SRAM at 6 cycles per transfer; HT at N/2, TC + GIF at the end, IRQ 11', () => {
    const { soc, core } = makeSoc()
    dmaOn(soc)
    const src = Array.from({ length: 16 }, (_, i) => (0x1234567 * (i + 1)) >>> 0)
    fill32(soc, SRAM, src)
    w32(soc, CPAR(1), SRAM)
    w32(soc, CMAR(1), SRAM + 0x1000)
    w32(soc, CNDTR(1), 16)
    const c = 100
    runToCycle(soc, c)
    w32(soc, CCR(1), MEM2MEM | PSIZE(32) | MSIZE(32) | PINC | MINC | TCIE | EN)
    runToCycle(soc, c + M2M - 1)
    expect(r32(soc, CNDTR(1))).toBe(16)
    runToCycle(soc, c + M2M)
    expect(r32(soc, CNDTR(1))).toBe(15)
    runToCycle(soc, c + 8 * M2M)
    expect(r32(soc, ISR)).toBe(flag(1, 'HT') | flag(1, 'G'))
    expect(core.irqLines[11]).toBe(0) // HTIE off
    runToCycle(soc, c + 16 * M2M - 1)
    expect(r32(soc, CNDTR(1))).toBe(1)
    runToCycle(soc, c + 16 * M2M)
    expect(r32(soc, CNDTR(1))).toBe(0)
    expect(r32(soc, ISR)).toBe(flag(1, 'HT') | flag(1, 'TC') | flag(1, 'G'))
    expect(core.irqLines[11]).toBe(1)
    expect(read32s(soc, SRAM + 0x1000, 16)).toEqual(src)
    expect(soc.bus.read32(SRAM + 0x1040)).toBe(0) // nothing beyond
    // IFCR: CTCIF clears TC only (GIF stays), CGIF clears everything
    w32(soc, IFCR, flag(1, 'TC'))
    expect(r32(soc, ISR)).toBe(flag(1, 'HT') | flag(1, 'G'))
    expect(core.irqLines[11]).toBe(0)
    w32(soc, IFCR, flag(1, 'G'))
    expect(r32(soc, ISR)).toBe(0)
    // the channel stays enabled but idle; CNDTR is only writable while disabled
    w32(soc, CNDTR(1), 5)
    expect(r32(soc, CNDTR(1))).toBe(0)
    expect(soc.drainLog().some((e) => /CNDTR1 written while channel 1 is enabled/.test(e.message))).toBe(true)
  })

  it('packing per Table 76: narrower source zero-extended, wider source truncated; unaligned addresses forced', () => {
    const { soc } = makeSoc()
    dmaOn(soc)
    // 8 → 32
    fill32(soc, SRAM, [0x44332211])
    w32(soc, CPAR(2), SRAM)
    w32(soc, CMAR(2), SRAM + 0x100)
    w32(soc, CNDTR(2), 4)
    w32(soc, CCR(2), MEM2MEM | PSIZE(8) | MSIZE(32) | PINC | MINC | EN)
    // 32 → 16 (CMAR bit 0 ignored)
    fill32(soc, SRAM + 0x200, [0xaabbccdd, 0x11223344])
    w32(soc, CPAR(3), SRAM + 0x200)
    w32(soc, CMAR(3), SRAM + 0x301)
    w32(soc, CNDTR(3), 2)
    w32(soc, CCR(3), MEM2MEM | PSIZE(32) | MSIZE(16) | PINC | MINC | EN)
    // 16 → 8, memory → "peripheral" direction (DIR = 1: CMAR is the source)
    fill32(soc, SRAM + 0x400, [0x56781234])
    w32(soc, CMAR(4), SRAM + 0x400)
    w32(soc, CPAR(4), SRAM + 0x500)
    w32(soc, CNDTR(4), 2)
    w32(soc, CCR(4), MEM2MEM | DIR | MSIZE(16) | PSIZE(8) | PINC | MINC | EN)
    runToCycle(soc, 500)
    expect(read32s(soc, SRAM + 0x100, 4)).toEqual([0x11, 0x22, 0x33, 0x44])
    expect(soc.bus.read32(SRAM + 0x300) >>> 0).toBe(0x3344ccdd)
    expect(soc.bus.read16(SRAM + 0x500)).toBe(0x7834)
  })

  it('arbitration: the higher PL wins, equal PL → the lower channel number; decided again after every transfer', () => {
    const { soc } = makeSoc()
    dmaOn(soc)
    for (const [ch, pl] of [[2, 0], [5, 3], [6, 1], [3, 1]] as const) {
      w32(soc, CPAR(ch), SRAM)
      w32(soc, CMAR(ch), SRAM + 0x100 * ch)
      w32(soc, CNDTR(ch), 4)
      w32(soc, CCR(ch), MEM2MEM | PL(pl) | PSIZE(32) | MSIZE(32) | MINC | EN)
    }
    // channel 2 grabbed the controller when it was enabled first: gate the clock
    // (its transfer in flight is dropped) and restart with all four ready at once
    w32(soc, RCC_AHBENR, 0x14)
    const c = 100
    runToCycle(soc, c)
    dmaOn(soc)
    const ndt = () => [2, 5, 6, 3].map((ch) => r32(soc, CNDTR(ch)))
    runToCycle(soc, c + 4 * M2M)
    expect(ndt()).toEqual([4, 0, 4, 4]) // ch5 (very high) first
    runToCycle(soc, c + 8 * M2M)
    expect(ndt()).toEqual([4, 0, 4, 0]) // then ch3 (medium, lower number than ch6)
    runToCycle(soc, c + 12 * M2M)
    expect(ndt()).toEqual([4, 0, 0, 0])
    runToCycle(soc, c + 16 * M2M)
    expect(ndt()).toEqual([0, 0, 0, 0])
    // a higher-priority channel enabled mid-stream waits only for the transfer in flight
    w32(soc, CCR(2), 0)
    w32(soc, CCR(5), 0)
    w32(soc, CNDTR(2), 4)
    w32(soc, CNDTR(5), 2)
    const d = c + 20 * M2M
    runToCycle(soc, d)
    w32(soc, CCR(2), MEM2MEM | PL(0) | PSIZE(32) | MSIZE(32) | MINC | EN)
    runToCycle(soc, d + 1)
    w32(soc, CCR(5), MEM2MEM | PL(3) | PSIZE(32) | MSIZE(32) | MINC | EN)
    runToCycle(soc, d + 3 * M2M)
    expect([r32(soc, CNDTR(2)), r32(soc, CNDTR(5))]).toEqual([3, 0])
  })

  it('a bus fault sets TEIF and clears EN (IRQ with TEIE)', () => {
    const { soc, core } = makeSoc()
    dmaOn(soc)
    w32(soc, CPAR(7), SRAM + 0x4ff8) // runs off the end of the 20 KiB SRAM
    w32(soc, CMAR(7), SRAM)
    w32(soc, CNDTR(7), 4)
    runToCycle(soc, 200)
    w32(soc, CCR(7), MEM2MEM | PSIZE(32) | MSIZE(32) | PINC | MINC | TEIE | EN)
    runToCycle(soc, 200 + 3 * M2M)
    expect(r32(soc, CNDTR(7))).toBe(2)
    expect(r32(soc, CCR(7)) & EN).toBe(0)
    expect(r32(soc, ISR)).toBe(flag(7, 'TE') | flag(7, 'HT') | flag(7, 'G')) // 2 of 4 done before the fault
    expect(core.irqLines[17]).toBe(1)
    expect(soc.drainLog().some((e) => /DMA1 channel 7 transfer error: read of 0x20005000/.test(e.message))).toBe(true)
    w32(soc, IFCR, flag(7, 'TE'))
    expect(core.irqLines[17]).toBe(0)
  })

  it('DMA1EN = 0 freezes the controller (the transfer in flight is dropped); registers are unreachable meanwhile', () => {
    const { soc } = makeSoc()
    dmaOn(soc)
    w32(soc, CPAR(1), SRAM)
    w32(soc, CMAR(1), SRAM + 0x100)
    w32(soc, CNDTR(1), 16)
    const c = 100
    runToCycle(soc, c)
    w32(soc, CCR(1), MEM2MEM | PSIZE(32) | MSIZE(32) | PINC | MINC | EN)
    runToCycle(soc, c + 3 * M2M + 2)
    w32(soc, RCC_AHBENR, 0x14) // the 4th transfer is in flight
    expect(soc.drainLog().some((e) => /channel 1 transfer: the transfer is dropped/.test(e.message))).toBe(true)
    expect(r32(soc, CNDTR(1))).toBe(0) // gated: reads 0
    const d = c + 500
    runToCycle(soc, d)
    dmaOn(soc)
    expect(r32(soc, CNDTR(1))).toBe(13)
    runToCycle(soc, d + M2M)
    expect(r32(soc, CNDTR(1))).toBe(12)
  })
})

/** A register block in the TIM2 slot (APB1) that requests DMA channel 2 while it holds data. */
class Probe implements SocBlock {
  readonly name = 'PROBE'
  ctx!: SocContext
  queue: number[] = []
  writes: { off: number; value: number; size: AccessSize }[] = []
  acks = 0
  /** DMA1_CNDTR2 as seen from dmaAck (the acknowledge comes after the transfer is counted) */
  ackNdt: number[] = []
  attach(ctx: SocContext): void {
    this.ctx = ctx
  }
  push(...v: number[]): void {
    this.queue.push(...v)
    this.ctx.dmaRequest(2, this.queue.length > 0)
  }
  read(off: number): number {
    if (off !== 0) return 0
    const v = this.queue.shift() ?? 0
    this.ctx.dmaRequest(2, this.queue.length > 0)
    return v
  }
  write(off: number, value: number, size: AccessSize): void {
    this.writes.push({ off, value: value >>> 0, size })
  }
  dmaAck(): void {
    this.acks++
    this.ackNdt.push(this.ctx.bus.read32(CNDTR(2)) & 0xffff)
  }
  reset(): void {}
}

function socWithProbe() {
  const probe = new Probe()
  let core: StubCore | null = null
  const specs = PERIPHERALS.filter((p) => p.name !== 'TIM2')
  specs.push({ name: 'PROBE', base: 0x40000000, gate: null, make: () => probe, status: 'unsupported', notes: '' })
  const createCore: CreateCortexM3 = (bus, sched, clock, hooks, config) => (core = new StubCore(bus, sched, clock, hooks, config))
  const soc = new Stm32f103({ createCore, peripherals: specs })
  dmaOn(soc)
  return { soc, probe, core: core as unknown as StubCore }
}

describe('DMA1 peripheral requests', () => {
  it('serves a level request per transfer (7 cycles APB → SRAM), acknowledges it, circular reload with HT/TC each lap', () => {
    const { soc, probe, core } = socWithProbe()
    w32(soc, CPAR(2), 0x40000000)
    w32(soc, CMAR(2), SRAM)
    w32(soc, CNDTR(2), 4)
    w32(soc, CCR(2), PSIZE(16) | MSIZE(16) | MINC | CIRC | HTIE | TCIE | EN)
    runToCycle(soc, 100)
    expect(r32(soc, CNDTR(2))).toBe(4) // no request yet
    probe.push(0x1111, 0x2222, 0x3333)
    runToCycle(soc, 100 + APB - 1)
    expect(r32(soc, CNDTR(2))).toBe(4)
    runToCycle(soc, 100 + 3 * APB)
    expect(r32(soc, CNDTR(2))).toBe(1)
    expect(probe.acks).toBe(3) // the last read dropped the request, the requester is still acknowledged
    expect(probe.ackNdt).toEqual([3, 2, 1])
    expect(r32(soc, ISR) & flag(2, 'HT')).toBe(flag(2, 'HT'))
    expect(core.irqLines[12]).toBe(1)
    w32(soc, IFCR, flag(2, 'G'))
    runToCycle(soc, 200)
    expect(r32(soc, CNDTR(2))).toBe(1) // request dropped by the last read: idle
    probe.push(0x4444, 0x5555)
    runToCycle(soc, 200 + 2 * APB)
    expect(r32(soc, CNDTR(2))).toBe(3) // lap complete: reloaded, then one more item
    expect(r32(soc, ISR) & flag(2, 'TC')).toBe(flag(2, 'TC'))
    expect([0, 1, 2, 3].map((i) => soc.bus.read16(SRAM + 2 * i))).toEqual([0x5555, 0x2222, 0x3333, 0x4444])
    expect(probe.acks).toBe(5)
  })

  it('byte / half-word writes to an APB register are replicated on all lanes (§13.3.5)', () => {
    const { soc, probe } = socWithProbe()
    fill32(soc, SRAM, [0x0000c3b0])
    w32(soc, CMAR(1), SRAM)
    w32(soc, CPAR(1), 0x40000004)
    w32(soc, CNDTR(1), 2)
    w32(soc, CCR(1), MEM2MEM | DIR | MSIZE(8) | PSIZE(8) | MINC | EN)
    w32(soc, CMAR(3), SRAM)
    w32(soc, CPAR(3), 0x40000008)
    w32(soc, CNDTR(3), 1)
    w32(soc, CCR(3), MEM2MEM | DIR | MSIZE(16) | PSIZE(16) | EN)
    runToCycle(soc, 100)
    expect(probe.writes).toEqual([
      { off: 4, value: 0xb0b0b0b0, size: 4 },
      { off: 4, value: 0xc3c3c3c3, size: 4 },
      { off: 8, value: 0xc3b0c3b0, size: 4 },
    ])
  })
})

describe('DMA1 with the real USART1 and ADC1', () => {
  /** USART1 at 8 MHz PCLK2, BRR = 80 (100 kBd: 800 cycles per 8N1 frame), PA9 AF push-pull */
  function usart() {
    const { soc, core } = makeSoc()
    dmaOn(soc)
    w32(soc, RCC_APB2ENR, (1 << 2) | (1 << 14) | 1)
    w32(soc, GPIOA + 0x04, (0x44444444 & ~0xf0) | 0xb0)
    w32(soc, USART1 + 0x08, 80)
    const tap = soc.uart('USART1') as UartTap
    const tx: { byte: number; cycle: number }[] = []
    tap.onTx = (byte, cycle) => tx.push({ byte, cycle })
    return { soc, core, tap, tx }
  }

  it('USART1 TX by DMA channel 4: TXE requests feed DR back-to-back, TC after the last byte', () => {
    const { soc, tx } = usart()
    const text = 'DMA!'
    for (let i = 0; i < text.length; i++) soc.bus.write8(SRAM + i, text.charCodeAt(i))
    w32(soc, USART1 + 0x0c, (1 << 13) | (1 << 3)) // UE | TE: idle preamble (800 cycles)
    w32(soc, CPAR(4), USART1 + 0x04)
    w32(soc, CMAR(4), SRAM)
    w32(soc, CNDTR(4), text.length)
    w32(soc, CCR(4), DIR | MINC | PSIZE(8) | MSIZE(8) | TCIE | EN)
    w32(soc, USART1 + 0x00, 0) // clear TC
    const c = soc.clock.cycles
    w32(soc, USART1 + 0x14, 1 << 7) // DMAT
    runToCycle(soc, c + 5 * 800 + 100)
    expect(String.fromCharCode(...tx.map((x) => x.byte))).toBe(text)
    // frames follow each other without gaps after the preamble
    for (let i = 1; i < tx.length; i++) expect(tx[i].cycle - tx[i - 1].cycle).toBe(800)
    expect(r32(soc, CNDTR(4))).toBe(0)
    expect(r32(soc, ISR) & flag(4, 'TC')).toBe(flag(4, 'TC'))
    expect(r32(soc, USART1 + 0x00) & 0x40).toBe(0x40) // USART TC
  })

  it('USART1 RX by DMA channel 5 (circular): bytes from UartTap.send land in SRAM, RXNE cleared by the DMA read', () => {
    const { soc, tap } = usart()
    w32(soc, USART1 + 0x0c, (1 << 13) | (1 << 2)) // UE | RE
    w32(soc, CPAR(5), USART1 + 0x04)
    w32(soc, CMAR(5), SRAM + 0x100)
    w32(soc, CNDTR(5), 4)
    w32(soc, CCR(5), MINC | CIRC | PSIZE(8) | MSIZE(8) | EN)
    w32(soc, USART1 + 0x14, 1 << 6) // DMAR
    tap.send(new TextEncoder().encode('abcdef'))
    runToCycle(soc, soc.clock.cycles + 7 * 800)
    expect(Array.from(soc.bus.peek(SRAM + 0x100, 4), (b) => String.fromCharCode(b)).join('')).toBe('efcd')
    expect(r32(soc, CNDTR(5))).toBe(2)
    expect(r32(soc, USART1 + 0x00) & (0x20 | 0x08)).toBe(0) // no RXNE, no overrun
  })

  it('ADC1 continuous scan + DMA channel 1 circular: results land in SRAM in rank order', () => {
    const { soc } = makeSoc()
    dmaOn(soc)
    w32(soc, RCC_APB2ENR, (1 << 2) | (1 << 9) | 1)
    w32(soc, GPIOA, 0)
    const volts = [0.3, 1.1, 2.9]
    volts.forEach((v, i) => soc.pins.setInput(i + 4, 0, v))
    const ADC1 = 0x40012400
    w32(soc, ADC1 + 0x34, 6 | (5 << 5) | (4 << 10)) // SQ1..3 = IN6, IN5, IN4
    w32(soc, ADC1 + 0x2c, 2 << 20)
    w32(soc, ADC1 + 0x04, 1 << 8) // SCAN
    w32(soc, CPAR(1), ADC1 + 0x4c)
    w32(soc, CMAR(1), SRAM + 0x200)
    w32(soc, CNDTR(1), 3)
    w32(soc, CCR(1), PSIZE(16) | MSIZE(16) | MINC | CIRC | EN)
    w32(soc, ADC1 + 0x08, 1) // ADON
    runToCycle(soc, soc.clock.cycles + 20)
    w32(soc, ADC1 + 0x08, 1 | 2 | (1 << 8)) // CONT | DMA
    w32(soc, ADC1 + 0x08, 1 | 2 | (1 << 8)) // start
    runToCycle(soc, soc.clock.cycles + 4 + 3 * 28 + 10)
    const code = (v: number) => Math.round((v / 3.3) * 4095)
    expect([0, 1, 2].map((i) => soc.bus.read16(SRAM + 0x200 + 2 * i))).toEqual([code(2.9), code(1.1), code(0.3)])
    expect(r32(soc, CNDTR(1))).toBe(3) // circular: reloaded
    const dma = soc.block('DMA1') as unknown as Dma1
    runToCycle(soc, soc.clock.cycles + 100 * 28)
    expect(dma.transfers).toBeGreaterThanOrEqual(100)
    expect(r32(soc, 0x40012400) & 2).toBe(0) // EOC always consumed by the DMA's DR reads
  })
})
