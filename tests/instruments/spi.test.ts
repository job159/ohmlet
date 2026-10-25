/**
 * SPI decoder on synthetic SCK/MOSI/MISO/CS waveforms in all four clock
 * modes (RM0008 §25.3.1, Figure 240, built in tests/instruments/synth.ts).
 */
import { describe, expect, it } from 'vitest'
import { decodeSpi } from '../../src/instruments/decoders/spi'
import { spiLines, type SpiWaveOptions } from './synth'

function run(mosi: number[], miso: number[], w: SpiWaveOptions, dec: Parameters<typeof decodeSpi>[1] = {}) {
  const l = spiLines(mosi, miso, w)
  return decodeSpi(
    { sck: l.sck.trace(0), mosi: l.mosi.trace(1), miso: l.miso.trace(2), cs: l.cs ? l.cs.trace(3) : undefined },
    { cpol: (w.mode >> 1) as 0 | 1, cpha: (w.mode & 1) as 0 | 1, ...dec },
    l.end,
  )
}

describe('SPI decoder', () => {
  it('decodes a CS-framed mode-0 transfer (JEDEC ID read)', () => {
    const r = run([0x9f, 0x00, 0x00, 0x00], [0xff, 0xef, 0x40, 0x18], { mode: 0 })
    expect(r.words.map((w) => [w.mosi, w.miso])).toEqual([
      [0x9f, 0xff],
      [0x00, 0xef],
      [0x00, 0x40],
      [0x00, 0x18],
    ])
    const rows = (id: string) => r.annotations.filter((a) => a.row === id).map((a) => a.text)
    expect(rows('mosi')).toEqual(['0x9F', '0x00 \\0', '0x00 \\0', '0x00 \\0'])
    expect(rows('miso')).toEqual(['0xFF', '0xEF', "0x40 '@'", '0x18'])
    expect(rows('transfers')).toEqual(['MOSI 9F 00 00 00 · MISO FF EF 40 18'])
    expect(r.rows.map((x) => x.id)).toEqual(['mosi', 'miso', 'transfers'])
  })

  it('decodes all four CPOL/CPHA modes', () => {
    for (const mode of [0, 1, 2, 3] as const) {
      const r = run([0xa5, 0x3c, 0x81], [0x5a, 0xc3, 0x7e], { mode })
      expect(r.words.map((w) => [w.mosi, w.miso]), `mode ${mode}`).toEqual([
        [0xa5, 0x5a],
        [0x3c, 0xc3],
        [0x81, 0x7e],
      ])
      expect(r.annotations.some((a) => a.kind === 'error'), `mode ${mode}`).toBe(false)
    }
  })

  it('decoding with the wrong clock phase is garbage, not success', () => {
    const l = spiLines([0xa5, 0x3c], [0, 0], { mode: 1 })
    const r = decodeSpi({ sck: l.sck.trace(0), mosi: l.mosi.trace(1), cs: l.cs!.trace(3) }, { cpol: 0, cpha: 0 }, l.end)
    expect(r.words.map((w) => w.mosi)).not.toEqual([0xa5, 0x3c])
  })

  it('supports LSB-first and 16-bit words', () => {
    const lsb = run([0x01, 0x80], [0x02, 0x40], { mode: 0, lsbFirst: true }, { bitOrder: 'lsb' })
    expect(lsb.words.map((w) => [w.mosi, w.miso])).toEqual([
      [0x01, 0x02],
      [0x80, 0x40],
    ])
    const w16 = run([0xbeef, 0x1234], [0xcafe, 0x0001], { mode: 3, bits: 16 }, { wordSize: 16 })
    expect(w16.words.map((w) => [w.mosi, w.miso])).toEqual([
      [0xbeef, 0xcafe],
      [0x1234, 0x0001],
    ])
    expect(w16.annotations.find((a) => a.row === 'mosi')?.text).toBe('0xBEEF')
    expect(w16.annotations.find((a) => a.row === 'mosi')?.short).toBe('BEEF')
  })

  it('decodes without CS and with an active-high CS', () => {
    const noCs = run([0x12, 0x34], [0x56, 0x78], { mode: 2, cs: null })
    expect(noCs.words.map((w) => [w.mosi, w.miso])).toEqual([
      [0x12, 0x56],
      [0x34, 0x78],
    ])
    expect(noCs.rows.map((x) => x.id)).toEqual(['mosi', 'miso'])
    const hi = run([0x55], [0xaa], { mode: 0, cs: 'high' }, { csActive: 'high' })
    expect(hi.words.map((w) => [w.mosi, w.miso])).toEqual([[0x55, 0xaa]])
    // decoding an active-high CS as active-low sees no transfer
    const wrong = run([0x55], [0xaa], { mode: 0, cs: 'high' }, { csActive: 'low' })
    expect(wrong.words).toEqual([])
  })

  it('reports a word cut short by CS release', () => {
    const r = run([0x9f, 0xab], [0, 0], { mode: 0, truncateLastTo: 5 })
    expect(r.words.map((w) => w.mosi)).toEqual([0x9f])
    expect(r.annotations.find((a) => a.kind === 'error')?.text).toBe('incomplete word (5 bits)')
  })

  it('flags an SCK idle level that contradicts CPOL at CS assertion', () => {
    const r = run([0x42], [0x24], { mode: 0, idleSck: 1 })
    const xfer = r.annotations.find((a) => a.row === 'transfers')
    expect(xfer?.kind).toBe('error')
    expect(xfer?.text).toMatch(/^SCK idle level ≠ CPOL 0/)
  })

  it('MOSI-only and MISO-only decoders; no data line is reported', () => {
    const l = spiLines([0x11], [0x22], { mode: 0 })
    const m = decodeSpi({ sck: l.sck.trace(0), mosi: l.mosi.trace(1), cs: l.cs!.trace(3) }, {}, l.end)
    expect(m.rows.map((x) => x.id)).toEqual(['mosi', 'transfers'])
    expect(m.words[0]).toMatchObject({ mosi: 0x11, miso: null })
    const none = decodeSpi({ sck: l.sck.trace(0) }, {}, l.end)
    expect(none.info).toEqual(['map MOSI and/or MISO'])
  })

  it('word annotations sit inside their CS frame and do not overlap', () => {
    const r = run([1, 2, 3, 4, 5], [5, 4, 3, 2, 1], { mode: 1 })
    const mosi = r.annotations.filter((a) => a.row === 'mosi')
    const xfer = r.annotations.find((a) => a.row === 'transfers')!
    for (let k = 0; k < mosi.length; k++) {
      expect(mosi[k].t1).toBeGreaterThan(mosi[k].t0)
      expect(mosi[k].t0).toBeGreaterThanOrEqual(xfer.t0)
      expect(mosi[k].t1).toBeLessThanOrEqual(xfer.t1 + 1e-15)
      if (k > 0) expect(mosi[k].t0).toBeGreaterThanOrEqual(mosi[k - 1].t1 - 1e-15)
    }
  })
})
