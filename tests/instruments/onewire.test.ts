/**
 * 1-Wire decoder on synthetic waveforms with AN126 standard / overdrive
 * timing (tests/instruments/synth.ts).
 */
import { describe, expect, it } from 'vitest'
import { decodeOneWire } from '../../src/instruments/decoders/onewire'
import { oneWireLine, type OneWireOp } from './synth'

const run = (ops: OneWireOp[], overdrive = false) => {
  const { line, end } = oneWireLine(ops, overdrive)
  return decodeOneWire(line.trace(), { overdrive }, end)
}
const row = (r: ReturnType<typeof run>, id: string) => r.annotations.filter((a) => a.row === id).map((a) => a.text)

describe('1-Wire decoder', () => {
  it('decodes reset + presence and a DS18B20 "convert T" (Skip ROM, 0x44)', () => {
    const r = run([{ op: 'reset', presence: true }, { op: 'write', value: 0xcc }, { op: 'write', value: 0x44 }])
    expect(row(r, 'bytes')).toEqual(['Reset', '0xCC Skip ROM', '0x44'])
    expect(r.events.filter((e) => e.kind === 'reset')).toEqual([expect.objectContaining({ value: 1 })])
    expect(r.events.filter((e) => e.kind === 'byte').map((e) => e.value)).toEqual([0xcc, 0x44])
    const bits = row(r, 'bits')
    expect(bits[0]).toBe('Reset · presence')
    // 0xCC LSB first
    expect(bits.slice(1, 9).join('')).toBe('00110011')
    expect(r.annotations.some((a) => a.kind === 'error')).toBe(false)
  })

  it('reads bytes the slave drives (read slots stretched low for 0)', () => {
    const r = run([
      { op: 'reset', presence: true },
      { op: 'write', value: 0x33 }, // Read ROM
      { op: 'read', value: 0x28 }, // DS18B20 family code
      { op: 'read', value: 0xa5 },
    ])
    expect(row(r, 'bytes')).toEqual(['Reset', '0x33 Read ROM', '0x28', '0xA5'])
  })

  it('reports a reset without a presence pulse', () => {
    const r = run([{ op: 'reset', presence: false }, { op: 'write', value: 0xcc }])
    expect(r.annotations.find((a) => a.row === 'bits')).toMatchObject({ text: 'Reset · no presence', kind: 'error' })
    expect(row(r, 'bytes')).toEqual(['Reset (no device)', '0xCC Skip ROM'])
  })

  it('decodes overdrive timing only with the overdrive option', () => {
    const ops: OneWireOp[] = [{ op: 'reset', presence: true }, { op: 'write', value: 0x55 }]
    expect(row(run(ops, true), 'bytes')).toEqual(['Reset', '0x55 Match ROM'])
    // standard timing on an overdrive line: the 50 µs "reset" is a too-long slot, never a reset
    const { line, end } = oneWireLine(ops, true)
    const std = decodeOneWire(line.trace(), {}, end)
    expect(std.events.some((e) => e.kind === 'reset')).toBe(false)
  })

  it('flags a low pulse between the longest slot and the reset minimum', () => {
    const r = run([{ op: 'reset', presence: true }, { op: 'low', time: 250e-6 }])
    expect(r.annotations.find((a) => a.kind === 'error')?.text).toBe('invalid low pulse (250 µs)')
  })

  it('bit slots do not overlap and bytes span their 8 slots', () => {
    const r = run([{ op: 'reset', presence: true }, { op: 'write', value: 0xbe }])
    const bits = r.annotations.filter((a) => a.row === 'bits').slice(1)
    for (let k = 1; k < bits.length; k++) expect(bits[k].t0).toBeGreaterThanOrEqual(bits[k - 1].t1)
    const byte = r.annotations.filter((a) => a.row === 'bytes')[1]
    expect(byte.t0).toBe(bits[0].t0)
    expect(byte.t1).toBe(bits[7].t1)
  })
})
