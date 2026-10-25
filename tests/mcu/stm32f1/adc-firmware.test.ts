/**
 * Real firmware + real circuits for the ADC, through the SimulationCoordinator
 * (analog solver ↔ Cortex-M3 in lockstep): ST HAL v1.1.9 images from
 * firmware/dist run on the stm32f103c8 model of a Blue Pill whose header
 * pins are wired on the breadboard. Judged only by what leaves the chip
 * (USART1 text):
 *
 *  - hal-adc-pot: 10 kΩ potentiometer between the 3V3 rail and GND, wiper →
 *    PA0; the knob is turned with setRuntimeParam while the firmware runs.
 *    raw must be within ±2 LSB of V/VDD × 4095 = position × 4095 and mV
 *    within ±2 mV of position × 3300.
 *  - hal-adc-dma: continuous scan of PA0 (pot), PA1 (GND), PA2 (3V3), PA3
 *    (10 k / 10 k divider), the temperature sensor and VREFINT by DMA1
 *    channel 1 circular; the scan counter shows the modelled conversion
 *    rate (126 µs per 6-channel scan at ADCCLK 12 MHz, 239.5-cycle samples).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadFirmwareFile } from '../../../src/mcu/loader'
import { registeredMcus } from '../../../src/mcu/registry'
import { SimulationCoordinator } from '../../../src/sim/coordinator/coordinator'
import { bluePillWorld, part, tap, w } from '../../coordinator/worlds'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'firmware', 'dist')
const LONG = { timeout: 240_000 }

function start(name: string, layout: ReturnType<typeof bluePillWorld>) {
  const res = loadFirmwareFile(`${name}.elf`, new Uint8Array(readFileSync(join(DIST, `${name}.elf`))))
  if (!res.ok) throw new Error(res.error)
  const co = new SimulationCoordinator()
  co.load(layout, 1)
  co.setFirmware('U1', res.image)
  let text = ''
  const lines: { t: number; line: string }[] = []
  /** advance in `step` slices, collecting USART1 lines with the slice end time */
  const run = (seconds: number, step = 5e-3) => {
    const end = co.time + seconds
    while (co.time < end - 1e-12) {
      co.advance(Math.min(step, end - co.time))
      const f = co.frame()
      for (const u of f.uart) {
        if (u.componentId !== 'U1' || u.port !== 'USART1') continue
        for (const b of u.bytes) {
          text += String.fromCharCode(b)
          if (b === 10) {
            lines.push({ t: co.time, line: text })
            text = ''
          }
        }
      }
      for (const l of f.log) if (l.level !== 'info') warnings.push(`${l.source}: ${l.message}`)
    }
  }
  const warnings: string[] = []
  return { co, run, lines, warnings }
}

const available = registeredMcus().includes('stm32f103c8')

describe.skipIf(!available)('real firmware on the coordinator: ADC with real circuits', () => {
  it('hal-adc-pot: potentiometer on PA0 at 0.25 / 0.5 / 0.75 → raw ±2 LSB of position × 4095, mV ±2 mV', LONG, () => {
    const layout = bluePillWorld(
      [part('RV1', 'potentiometer', ['top-12', 'a45', 'top+12'], { resistance: 10000, position: 0.25 })],
      [w(tap('PA0'), 'e45')],
      { rail3v3: true },
    )
    const { co, run, lines, warnings } = start('hal-adc-pot', layout)
    run(0.05)
    expect(co.telemetry().components.U1.mcu?.state).toBe('running')
    for (const pos of [0.25, 0.5, 0.75]) {
      co.setRuntimeParam('RV1', 'position', pos)
      const n0 = lines.length
      run(0.35)
      const fresh = lines.slice(n0 + 1) // the first line may predate the knob turn
      expect(fresh.length, `pos ${pos}`).toBeGreaterThanOrEqual(2)
      for (const { line } of fresh) {
        const m = /^adc=(\d+) mv=(\d+)\r\n$/.exec(line)
        expect(m, JSON.stringify(line)).not.toBeNull()
        const raw = Number(m![1])
        const mv = Number(m![2])
        expect(Math.abs(raw - pos * 4095), `pos ${pos}: raw ${raw}`).toBeLessThanOrEqual(2)
        expect(Math.abs(mv - pos * 3300), `pos ${pos}: mV ${mv}`).toBeLessThanOrEqual(2)
      }
    }
    // one reading every 100 ms
    const all = lines.filter((l) => l.t > 0.06)
    const span = all[all.length - 1].t - all[0].t
    expect(all.length - 1).toBe(Math.round(span / 0.1))
    expect(co.telemetry().components.U1.mcu?.hclkHz).toBe(72_000_000)
    expect(warnings.filter((m) => /ADC|DMA/.test(m))).toEqual([])
    expect(co.issues().filter((i) => i.level === 'error')).toEqual([])
  })

  it('hal-adc-dma: scan of pot / GND / 3V3 / divider + temperature + VREFINT via circular DMA every 126 µs', LONG, () => {
    const layout = bluePillWorld(
      [
        part('RV1', 'potentiometer', ['top-12', 'a45', 'top+12'], { resistance: 10000, position: 0.5 }),
        part('R1', 'resistor', ['top+20', 'b55'], { resistance: 10000 }),
        part('R2', 'resistor', ['c55', 'top-20'], { resistance: 10000 }),
      ],
      [w(tap('PA0'), 'e45'), w(tap('PA1'), 'top-16'), w(tap('PA2'), 'top+16'), w(tap('PA3'), 'e55')],
      { rail3v3: true },
    )
    const { co, run, lines, warnings } = start('hal-adc-dma', layout)
    run(0.85, 10e-3)
    expect(lines.length).toBeGreaterThanOrEqual(4)
    let prevSeq = -1
    let prevT = 0
    for (const { t, line } of lines) {
      const m = /^in0=(\d+) in1=(\d+) in2=(\d+) in3=(\d+) ts=(\d+) vref=(\d+) vdda=(\d+) temp=(-?\d+)\.(\d) seq=(\d+)\r\n$/.exec(line)
      expect(m, JSON.stringify(line)).not.toBeNull()
      const [in0, in1, in2, in3, ts, vref, vdda] = m!.slice(1, 8).map(Number)
      const temp = Number(`${m![8]}.${m![9]}`)
      const seq = Number(m![10])
      expect(Math.abs(in0 - 0.5 * 4095)).toBeLessThanOrEqual(2)
      expect(in1).toBeLessThanOrEqual(2)
      expect(in2).toBeGreaterThanOrEqual(4093)
      expect(Math.abs(in3 - 0.5 * 4095)).toBeLessThanOrEqual(2)
      expect(Math.abs(ts - (1.43 / 3.3) * 4095)).toBeLessThanOrEqual(1.5) // V25 at 25 °C
      expect(Math.abs(vref - (1.2 / 3.3) * 4095)).toBeLessThanOrEqual(1.5)
      expect(Math.abs(vdda - 3300)).toBeLessThanOrEqual(3)
      expect(Math.abs(temp - 25)).toBeLessThanOrEqual(0.3)
      if (prevSeq >= 0) {
        // 200 ms between reports / 126 µs per scan = 1587.3 scans
        expect(Math.abs(seq - prevSeq - 0.2 / 126e-6), `seq ${prevSeq} → ${seq}`).toBeLessThanOrEqual(1.5)
        expect(Math.abs(t - prevT - 0.2)).toBeLessThanOrEqual(0.0101)
      }
      prevSeq = seq
      prevT = t
    }
    expect(warnings.filter((m) => /ADC|DMA/.test(m))).toEqual([])
    expect(co.issues().filter((i) => i.level === 'error')).toEqual([])
  })
})
