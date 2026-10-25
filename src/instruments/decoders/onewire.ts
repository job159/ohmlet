/**
 * 1-Wire link-layer decoder (one open-drain data line with pull-up) —
 * Maxim/Analog Devices AN126 "1-Wire Communication Through Software" and
 * the DS18B20 datasheet (19-7487 Rev. 6, "1-Wire Signaling", Figures
 * 15–16).
 *
 * Every transaction is a falling edge followed by a low pulse:
 *   - low ≥ 480 µs (overdrive ≥ 48 µs): RESET. The line is sampled 70 µs
 *     after the release (AN126 delay I; overdrive 8.5 µs): low = a device
 *     answered with its PRESENCE pulse; the presence pulse's own edges are
 *     not time slots.
 *   - shorter: a time slot. The bit is the line level 15 µs after the
 *     falling edge (overdrive 2 µs) — the master-read sample window (AN126
 *     delay E ≤ 15 µs, DS18B20 tRDV) and also where a write-0 slot is still
 *     low (≥ 60 µs) and a write-1 slot is already released (≤ 15 µs). The
 *     wire alone cannot tell master-written from slave-written bits, so a
 *     slot is just a bit.
 *   - a low pulse between the longest slot (120 µs; overdrive 16 µs) and
 *     the reset minimum is reported as an error.
 * Bits are grouped LSB first into bytes from each reset on; the first byte
 * after a reset is labelled with its ROM command (DS18B20 Table 6). The
 * network layer (ROM search triplets, function commands) is not decoded.
 */
import type { LogicTrace } from '../../sim/coordinator/api'
import { fmtHex, fmtHexShort } from '../format'
import { Signal } from '../signal'
import type { Annotation, DecodeResult, DecoderRow } from '../types'

export interface OneWireOptions {
  overdrive?: boolean
}

export interface OneWireEvent {
  kind: 'reset' | 'bit' | 'byte'
  t0: number
  t1: number
  /** bit value, byte value, or presence (1 = a device answered) */
  value: number
}

export interface OneWireResult extends DecodeResult {
  events: OneWireEvent[]
}

export const ONEWIRE_ROWS: DecoderRow[] = [
  { id: 'bits', label: '1-Wire bits', role: 'data' },
  { id: 'bytes', label: '1-Wire', role: 'data' },
]

/** ROM commands (DS18B20 datasheet, Table 6 / "ROM commands"). */
export const ONEWIRE_ROM_COMMANDS: Record<number, string> = {
  0x33: 'Read ROM',
  0x55: 'Match ROM',
  0xcc: 'Skip ROM',
  0xf0: 'Search ROM',
  0xec: 'Alarm search',
}

const TIMING = {
  normal: { reset: 480e-6, maxSlot: 120e-6, sample: 15e-6, presence: 70e-6, slot: 60e-6 },
  overdrive: { reset: 48e-6, maxSlot: 16e-6, sample: 2e-6, presence: 8.5e-6, slot: 6e-6 },
}

export function decodeOneWire(
  trace: Pick<LogicTrace, 'initial' | 'times' | 'levels'>,
  opts: OneWireOptions = {},
  t1?: number,
): OneWireResult {
  const tm = opts.overdrive ? TIMING.overdrive : TIMING.normal
  const sig = new Signal(trace)
  const annotations: Annotation[] = []
  const events: OneWireEvent[] = []
  const end = t1 ?? (sig.count ? sig.times[sig.count - 1] : 0)

  let bitsInByte: { v: number; t0: number; t1: number }[] = []
  let byteNo = -1 // −1: no reset seen yet (bytes are still grouped, unlabelled)
  /** edges up to this time belong to a presence pulse */
  let skipUntil = -Infinity

  const flushByte = () => {
    if (bitsInByte.length !== 8) return
    let v = 0
    for (let k = 0; k < 8; k++) v |= bitsInByte[k].v << k
    const t0 = bitsInByte[0].t0
    const t1b = bitsInByte[7].t1
    const rom = byteNo === 0 ? ONEWIRE_ROM_COMMANDS[v] : undefined
    annotations.push({
      t0,
      t1: t1b,
      row: 'bytes',
      text: rom ? `${fmtHex(v)} ${rom}` : fmtHex(v),
      short: fmtHexShort(v),
      kind: rom ? 'ctrl' : 'data',
      value: v,
    })
    events.push({ kind: 'byte', t0, t1: t1b, value: v })
    if (byteNo >= 0) byteNo++
    bitsInByte = []
  }

  for (let i = 0; i < sig.count; i++) {
    const tf = sig.times[i]
    if (sig.after(i) !== 0 || sig.before(i) !== 1) continue
    if (tf <= skipUntil) continue
    // the rising edge that ends this low pulse
    const r = i + 1 < sig.count ? i + 1 : -1
    const tr = r >= 0 ? sig.times[r] : Infinity
    if (r >= 0 && sig.after(r) === 2) {
      annotations.push({ t0: tf, t1: tr, row: 'bits', text: 'undefined level', short: '?', kind: 'error' })
      continue
    }
    const low = tr - tf
    if (low >= tm.reset) {
      if (!Number.isFinite(tr)) break // still low at the end of the capture
      const tSample = tr + tm.presence
      if (tSample > end) break
      const presence = sig.at(tSample) === 0
      // presence pulse: skip its falling/rising edges
      if (presence) {
        const k = sig.firstAfter(tr)
        let e = k
        while (e < sig.count && sig.times[e] <= tSample) e++
        // the presence pulse ends at the first rising edge after the sample point
        while (e < sig.count && sig.after(e) !== 1) e++
        skipUntil = e < sig.count ? sig.times[e] : end
      }
      bitsInByte = []
      byteNo = 0
      const t1r = presence ? skipUntil : tSample
      annotations.push({
        t0: tf,
        t1: t1r,
        row: 'bits',
        text: presence ? 'Reset · presence' : 'Reset · no presence',
        short: presence ? 'RP' : 'R',
        kind: presence ? 'ctrl' : 'error',
      })
      annotations.push({
        t0: tf,
        t1: t1r,
        row: 'bytes',
        text: presence ? 'Reset' : 'Reset (no device)',
        short: 'R',
        kind: presence ? 'ctrl' : 'error',
      })
      events.push({ kind: 'reset', t0: tf, t1: t1r, value: presence ? 1 : 0 })
      continue
    }
    if (low > tm.maxSlot) {
      annotations.push({
        t0: tf,
        t1: tr,
        row: 'bits',
        text: `invalid low pulse (${Math.round(low * 1e6)} µs)`,
        short: '!',
        kind: 'error',
      })
      bitsInByte = []
      continue
    }
    const tSample = tf + tm.sample
    if (tSample > end) break
    const l = sig.at(tSample)
    if (l === 2) {
      annotations.push({ t0: tf, t1: tf + tm.slot, row: 'bits', text: 'undefined level', short: '?', kind: 'error' })
      continue
    }
    // slot span: the nominal slot time, cut by the next slot's falling edge
    const nextFall = (() => {
      for (let k = r; k >= 0 && k < sig.count; k++) if (sig.after(k) === 0) return sig.times[k]
      return Infinity
    })()
    const ts1 = Math.min(tf + Math.max(tm.slot, low), nextFall)
    annotations.push({ t0: tf, t1: ts1, row: 'bits', text: String(l), short: String(l), kind: 'data', value: l })
    events.push({ kind: 'bit', t0: tf, t1: ts1, value: l })
    bitsInByte.push({ v: l, t0: tf, t1: ts1 })
    flushByte()
  }
  return { rows: ONEWIRE_ROWS, annotations, info: [], events }
}
