/**
 * Exporters: VCD (IEEE 1364 §18.2) and CSV (RFC 4180) formats.
 */
import { describe, expect, it } from 'vitest'
import { annotationsCsv, csvField, logicEdgesCsv, scopeCsv, toVcd, vcdId, vcdName } from '../../src/instruments/export'
import type { ScopeCapture } from '../../src/sim/coordinator/api'
import { capture, Line } from './synth'

describe('VCD export', () => {
  it('writes a complete IEEE 1364 dump with 1 ns timescale, relative times and x levels', () => {
    const cap = capture(1, 1.000005, [
      new Line(1).set(1.000001, 0).set(1.000002, 1).trace(0, 'PA9'),
      new Line(2).set(1.0000015, 0).set(1.0000025, 1).set(1.000003, 2).trace(3, 'SCL bus'),
    ])
    expect(toVcd(cap, { date: 'Fri Oct  9 2026' })).toBe(
      [
        '$date',
        '  Fri Oct  9 2026',
        '$end',
        '$version',
        '  ohmlet logic analyzer',
        '$end',
        '$comment',
        '  capture window 1.000000000 s .. 1.000005000 s (simulation time); #0 = window start',
        '$end',
        '$timescale 1 ns $end',
        '$scope module ohmlet $end',
        '$var wire 1 ! PA9 $end',
        '$var wire 1 " SCL_bus $end',
        '$upscope $end',
        '$enddefinitions $end',
        '#0',
        '$dumpvars',
        '1!',
        'x"',
        '$end',
        '#1000',
        '0!',
        '#1500',
        '0"',
        '#2000',
        '1!',
        '#2500',
        '1"',
        '#3000',
        'x"',
        '#5000',
        '',
      ].join('\n'),
    )
  })

  it('groups simultaneous edges, collapses sub-ns pulses and de-duplicates names', () => {
    const cap = capture(0, 1e-6, [
      new Line(0).set(100e-9, 1).set(100.2e-9, 0).set(100.4e-9, 1).set(500e-9, 0).trace(0, 'D'),
      new Line(0).set(500e-9, 1).trace(1, 'D'),
    ])
    const vcd = toVcd(cap)
    expect(vcd).not.toContain('$date')
    expect(vcd).toContain('$var wire 1 ! D $end\n$var wire 1 " D_D1 $end')
    const body = vcd.slice(vcd.indexOf('$enddefinitions'))
    expect(body).toBe(
      ['$enddefinitions $end', '#0', '$dumpvars', '0!', '0"', '$end', '#100', '1!', '#500', '0!', '1"', '#1000', ''].join('\n'),
    )
    expect(toVcd({ ...cap, overflow: true })).toContain('WARNING: the edge buffer wrapped')
  })

  it('identifier codes and names', () => {
    expect([0, 1, 93, 94, 95].map(vcdId)).toEqual(['!', '"', '~', '!!', '"!'])
    expect(new Set(Array.from({ length: 500 }, (_, i) => vcdId(i))).size).toBe(500)
    expect(vcdName(' U1 · PA9 ')).toBe('U1_PA9')
    expect(vcdName('')).toBe('ch')
  })
})

describe('CSV export', () => {
  it('quotes per RFC 4180', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField("0x2C ','")).toBe(`"0x2C ','"`)
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('a\nb')).toBe('"a\nb"')
    expect(csvField(NaN)).toBe('')
  })

  it('scope samples: union of sample times, empty cells where a channel has none', () => {
    const cap: ScopeCapture = {
      t0: 0,
      t1: 1,
      traces: [
        { index: 1, label: 'PRB2', t: Float64Array.from([0.1, 0.3]), v: Float32Array.from([2.5, 3.3]) },
        { index: 0, label: 'CH1', t: Float64Array.from([0.1, 0.2]), v: Float32Array.from([1, 0.25]) },
      ],
    }
    expect(scopeCsv(cap)).toBe(
      ['time_s,CH1 V,CH2 (PRB2) V', '0.100000000,1,2.5', '0.200000000,0.25,', '0.300000000,,3.3', ''].join('\r\n'),
    )
  })

  it('logic edges: initial levels, then edges in time order', () => {
    const cap = capture(0.5, 1, [new Line(1).set(0.7, 0).trace(0, 'TX'), new Line(2).set(0.6, 1).trace(2, 'a,b')])
    expect(logicEdgesCsv(cap)).toBe(
      [
        'time_s,channel,label,level',
        '0.500000000,D0,TX,1',
        '0.500000000,D2,"a,b",x',
        '0.600000000,D2,"a,b",1',
        '0.700000000,D0,TX,0',
        '',
      ].join('\r\n'),
    )
  })

  it('decoder annotations sorted by start with row labels', () => {
    const csv = annotationsCsv([
      {
        decoder: 'UART · PA9',
        rowLabels: { data: 'UART' },
        annotations: [{ t0: 2e-3, t1: 3e-3, row: 'data', text: "0x2C ','", kind: 'data' }],
      },
      { decoder: 'I2C', annotations: [{ t0: 1e-3, t1: 1.1e-3, row: 'frames', text: 'START', kind: 'ctrl' }] },
    ])
    expect(csv).toBe(
      [
        'start_s,end_s,decoder,row,kind,text',
        '0.001000000,0.001100000,I2C,frames,ctrl,START',
        `0.002000000,0.003000000,UART · PA9,UART,data,"0x2C ','"`,
        '',
      ].join('\r\n'),
    )
  })
})
