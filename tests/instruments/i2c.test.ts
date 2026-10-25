/**
 * I²C decoder on synthetic SCL/SDA waveforms (UM10204 bit timing built in
 * tests/instruments/synth.ts).
 */
import { describe, expect, it } from 'vitest'
import { decodeI2c } from '../../src/instruments/decoders/i2c'
import { i2cLines, type I2cOp } from './synth'

const run = (ops: I2cOp[], opts = {}) => {
  const { scl, sda, end } = i2cLines(ops)
  return decodeI2c(scl.trace(0, 'SCL'), sda.trace(1, 'SDA'), opts, end)
}
const frames = (r: ReturnType<typeof run>) => r.annotations.filter((a) => a.row === 'frames').map((a) => a.text)
const transfers = (r: ReturnType<typeof run>) => r.annotations.filter((a) => a.row === 'transfers').map((a) => a.text)

describe('I2C decoder', () => {
  it('decodes a write: START, address + W, ACKs, data bytes, STOP', () => {
    const r = run([
      { op: 'start' },
      { op: 'byte', value: 0x3c << 1, ack: true },
      { op: 'byte', value: 0x00, ack: true },
      { op: 'byte', value: 0x41, ack: true },
      { op: 'stop' },
    ])
    expect(frames(r)).toEqual(['START', 'Addr 0x3C W', 'ACK', '0x00 \\0', 'ACK', "0x41 'A'", 'ACK', 'STOP'])
    expect(r.annotations.find((a) => a.text === 'Addr 0x3C W')).toMatchObject({ kind: 'addr', short: '3C W', value: 0x3c })
    expect(r.annotations.filter((a) => a.text === 'ACK').every((a) => a.tone === 'ack' && a.kind === 'ctrl')).toBe(true)
    expect(transfers(r)).toEqual(['W 0x3C: 00 41'])
    expect(r.transactions).toEqual([
      expect.objectContaining({ address: 0x3c, read: false, addressAck: true, bytes: [0x00, 0x41], acks: [true, true], stopped: true, tenBit: false }),
    ])
  })

  it('decodes a register read with a repeated START and a final NACK', () => {
    const r = run([
      { op: 'start' },
      { op: 'byte', value: 0x68 << 1, ack: true },
      { op: 'byte', value: 0x75, ack: true },
      { op: 'start' },
      { op: 'byte', value: (0x68 << 1) | 1, ack: true },
      { op: 'byte', value: 0x68, ack: false },
      { op: 'stop' },
    ])
    expect(frames(r)).toEqual([
      'START',
      'Addr 0x68 W',
      'ACK',
      "0x75 'u'",
      'ACK',
      'Repeated START',
      'Addr 0x68 R',
      'ACK',
      "0x68 'h'",
      'NACK',
      'STOP',
    ])
    expect(r.annotations.find((a) => a.text === 'NACK')?.tone).toBe('nack')
    expect(transfers(r)).toEqual(['W 0x68: 75', 'R 0x68: 68'])
    expect(r.transactions.map((t) => t.stopped)).toEqual([false, true])
  })

  it('shows an unanswered address (bus scan) as NACK', () => {
    const r = run([{ op: 'start' }, { op: 'byte', value: 0x50 << 1, ack: false }, { op: 'stop' }])
    expect(frames(r)).toEqual(['START', 'Addr 0x50 W', 'NACK', 'STOP'])
    expect(transfers(r)).toEqual(['W 0x50 NACK'])
    expect(r.transactions[0].addressAck).toBe(false)
  })

  it('decodes 10-bit addressing (write, then read after Sr)', () => {
    const hi = 0b11110_10 // A9:8 = 2
    const r = run([
      { op: 'start' },
      { op: 'byte', value: hi << 1, ack: true },
      { op: 'byte', value: 0x34, ack: true },
      { op: 'byte', value: 0x99, ack: true },
      { op: 'start' },
      { op: 'byte', value: (hi << 1) | 1, ack: true },
      { op: 'byte', value: 0x12, ack: false },
      { op: 'stop' },
    ])
    expect(frames(r)).toEqual([
      'START',
      '10-bit addr A9:8=2 W',
      'ACK',
      'Addr 0x234 (10-bit) W',
      'ACK',
      '0x99',
      'ACK',
      'Repeated START',
      '10-bit addr A9:8=2 R',
      'ACK',
      '0x12',
      'NACK',
      'STOP',
    ])
    expect(r.transactions[0]).toMatchObject({ address: 0x234, tenBit: true, read: false, bytes: [0x99] })
    // the read after Sr re-selects the device addressed before (UM10204 §3.1.11)
    expect(r.transactions[1]).toMatchObject({ address: 0x234, tenBit: true, read: true, bytes: [0x12] })
  })

  it('labels the general call and can show 8-bit address bytes', () => {
    const gc = run([{ op: 'start' }, { op: 'byte', value: 0x00, ack: true }, { op: 'byte', value: 0x06, ack: true }, { op: 'stop' }])
    expect(frames(gc)[1]).toBe('General call')
    const r8 = run([{ op: 'start' }, { op: 'byte', value: (0x3c << 1) | 1, ack: true }, { op: 'stop' }], { addressFormat: '8bit' })
    expect(frames(r8)[1]).toBe('Addr 0x79 R')
    expect(transfers(r8)).toEqual(['R 0x79'])
  })

  it('reports a byte cut short by STOP as an error', () => {
    const r = run([{ op: 'start' }, { op: 'byte', value: 0xa0, ack: true }, { op: 'bits', values: [1, 0, 1, 1] }, { op: 'stop' }])
    const err = r.annotations.find((a) => a.kind === 'error')
    expect(err?.text).toBe('incomplete byte (4 bits)')
    expect(frames(r).slice(-2)).toEqual(['incomplete byte (4 bits)', 'STOP'])
  })

  it('follows clock stretching (bits are sampled on SCL rising edges)', () => {
    const r = run([
      { op: 'start' },
      { op: 'byte', value: 0x20 << 1, ack: true },
      { op: 'stretch', time: 200e-6 },
      { op: 'byte', value: 0xc3, ack: true },
      { op: 'stop' },
    ])
    expect(frames(r)).toEqual(['START', 'Addr 0x20 W', 'ACK', '0xC3', 'ACK', 'STOP'])
  })

  it('tiles the timeline: START → byte → ACK → … → STOP cells touch', () => {
    const r = run([{ op: 'start' }, { op: 'byte', value: 0x3c << 1, ack: true }, { op: 'byte', value: 0x7e, ack: true }, { op: 'stop' }])
    const f = r.annotations.filter((a) => a.row === 'frames')
    for (let k = 1; k < f.length; k++) expect(f[k].t0, `${f[k - 1].text} → ${f[k].text}`).toBeCloseTo(f[k - 1].t1, 12)
    expect(f.every((a) => a.t1 > a.t0)).toBe(true)
  })

  it('ignores SDA activity while the bus is idle and reports undefined bits', () => {
    const { scl, sda, end } = i2cLines([{ op: 'start' }, { op: 'byte', value: 0x10, ack: true }, { op: 'stop' }])
    // corrupt one data bit to the undefined level (floating line): SDA
    // edge 1 is bit 4 of 0x10 going high
    const sdaTr = sda.trace(1)
    sdaTr.levels[1] = 2
    const r = decodeI2c(scl.trace(0), sdaTr, {}, end)
    expect(r.annotations.some((a) => a.kind === 'error' && a.text === 'undefined level')).toBe(true)
  })
})
