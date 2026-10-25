/**
 * SPI decoder (SCK + MOSI and/or MISO, optional chip select) — the four
 * clock modes of RM0008 §25.3.1 (Figure 240): CPOL is the SCK idle level,
 * CPHA = 0 samples data on the first (leading) clock transition after the
 * idle level, CPHA = 1 on the second (trailing) one; data changes on the
 * opposite edge. Words of 4–16 bits (the STM32 SPI: 8 or 16, DFF), MSB or
 * LSB first (LSBFIRST).
 *
 * With a chip-select channel only clock edges while CS is active count;
 * CS assertion restarts the word and CS release with a partial word is an
 * error (as is an SCK level other than CPOL at assertion — the wrong mode
 * is configured, or the master is mis-programmed). Without CS the bit
 * stream is cut into words from the first sampled edge in the window, so
 * a window that starts mid-word decodes shifted (as on any analyzer).
 * Edges at the same timestamp: a CS assertion before SCK, SCK before a CS
 * release; a data edge at the sampling edge's instant is NOT captured by
 * it (the level just before counts — a flip-flop's hold time).
 */
import type { LogicTrace } from '../../sim/coordinator/api'
import { fmtHexShort, fmtWord } from '../format'
import { Signal, type Level } from '../signal'
import type { Annotation, DecodeResult, DecoderRow } from '../types'

type TraceLike = Pick<LogicTrace, 'initial' | 'times' | 'levels'>

export interface SpiOptions {
  cpol?: 0 | 1
  cpha?: 0 | 1
  bitOrder?: 'msb' | 'lsb'
  /** 4–16 (default 8) */
  wordSize?: number
  /** chip-select polarity (default 'low': active low, like NSS) */
  csActive?: 'low' | 'high'
}

export interface SpiWord {
  t0: number
  t1: number
  mosi: number | null
  miso: number | null
}

export interface SpiResult extends DecodeResult {
  words: SpiWord[]
}

export function spiRows(has: { mosi: boolean; miso: boolean; cs: boolean }): DecoderRow[] {
  const rows: DecoderRow[] = []
  if (has.mosi) rows.push({ id: 'mosi', label: 'MOSI', role: 'mosi' })
  if (has.miso) rows.push({ id: 'miso', label: 'MISO', role: 'miso' })
  if (has.cs) rows.push({ id: 'transfers', label: 'SPI transfers', role: 'cs' })
  return rows
}

interface Bit {
  mosi: Level
  miso: Level
  ts: number
}

export function decodeSpi(
  lines: { sck: TraceLike; mosi?: TraceLike; miso?: TraceLike; cs?: TraceLike },
  opts: SpiOptions = {},
  t1?: number,
): SpiResult {
  const cpol = opts.cpol === 1 ? 1 : 0
  const cpha = opts.cpha === 1 ? 1 : 0
  const lsb = opts.bitOrder === 'lsb'
  const size = Math.min(16, Math.max(4, Math.round(opts.wordSize ?? 8)))
  const sck = new Signal(lines.sck)
  const mosi = lines.mosi ? new Signal(lines.mosi) : null
  const miso = lines.miso ? new Signal(lines.miso) : null
  // normalize CS to active = 1
  const cs = lines.cs ? new Signal(lines.cs, (opts.csActive ?? 'low') === 'low') : null
  const rows = spiRows({ mosi: !!mosi, miso: !!miso, cs: !!cs })
  const annotations: Annotation[] = []
  const words: SpiWord[] = []
  const info: string[] = []
  if (!mosi && !miso) {
    info.push('map MOSI and/or MISO')
    return { rows, annotations, info, words }
  }
  const errRow = rows[0].id
  const sampleLevel: Level = cpol === cpha ? 1 : 0 // sample on rising when CPOL = CPHA
  const lastEdge = Math.max(sck.count ? sck.times[sck.count - 1] : 0, cs && cs.count ? cs.times[cs.count - 1] : 0)
  const end = t1 ?? lastEdge

  let sckL: Level = sck.initial
  let active = cs ? cs.initial === 1 : true
  /** CS assertion time (−∞: asserted before the window / no CS) */
  let tAssert = -Infinity
  /** the shift edge (or CS assertion) that opened the current word's first bit */
  let lastShiftBeforeWord = -Infinity
  let modeError = false
  let bits: Bit[] = []
  let open: Annotation[] = []
  let xferStart = -Infinity
  const xferMosi: number[] = []
  const xferMiso: number[] = []

  const emitWord = () => {
    const first = bits[0].ts
    const last = bits[bits.length - 1].ts
    const half = bits.length > 1 ? (last - first) / (bits.length - 1) / 2 : 0
    const c0 = Math.max(lastShiftBeforeWord, tAssert, first - half)
    const c1 = last + half
    const val = (pick: (b: Bit) => Level) => {
      let v = 0
      for (let k = 0; k < bits.length; k++) {
        const b = pick(bits[k])
        if (b === 2) return -1
        if (lsb) v |= b << k
        else v = (v << 1) | b
      }
      return v
    }
    const w: SpiWord = { t0: c0, t1: c1, mosi: null, miso: null }
    for (const [row, sigOf] of [
      ['mosi', mosi],
      ['miso', miso],
    ] as const) {
      if (!sigOf) continue
      const v = val((b) => (row === 'mosi' ? b.mosi : b.miso))
      const a: Annotation =
        v < 0
          ? { t0: c0, t1: c1, row, text: 'undefined level', short: '?', kind: 'error' }
          : { t0: c0, t1: c1, row, text: fmtWord(v, size), short: fmtHexShort(v, size), kind: 'data', value: v }
      annotations.push(a)
      open.push(a)
      if (v >= 0) {
        w[row] = v
        ;(row === 'mosi' ? xferMosi : xferMiso).push(v)
      }
    }
    words.push(w)
    bits = []
  }

  const closeOpen = (t: number) => {
    for (const a of open) a.t1 = Math.min(a.t1, t)
    open = []
  }

  const endTransfer = (t: number) => {
    if (bits.length > 0) {
      const t0 = Math.max(lastShiftBeforeWord, tAssert, bits[0].ts)
      annotations.push({
        t0,
        t1: t,
        row: errRow,
        text: `incomplete word (${bits.length} bit${bits.length === 1 ? '' : 's'})`,
        short: '!',
        kind: 'error',
      })
      bits = []
    }
    closeOpen(t)
    if (cs) {
      const parts: string[] = []
      if (mosi) parts.push(`MOSI ${xferMosi.map((v) => fmtHexShort(v, size)).join(' ') || '—'}`)
      if (miso) parts.push(`MISO ${xferMiso.map((v) => fmtHexShort(v, size)).join(' ') || '—'}`)
      const transfer: NonNullable<Annotation['transfer']> = { bits: size }
      if (mosi) transfer.mosi = [...xferMosi]
      if (miso) transfer.miso = [...xferMiso]
      if (modeError) transfer.modeError = { cpol: cpol as 0 | 1 }
      annotations.push({
        t0: xferStart,
        t1: t,
        row: 'transfers',
        text: modeError ? `SCK idle level ≠ CPOL ${cpol} · ${parts.join(' · ')}` : parts.join(' · '),
        short: modeError ? '!' : `${Math.max(xferMosi.length, xferMiso.length)}×`,
        kind: modeError ? 'error' : 'data',
        transfer,
      })
    }
    xferMosi.length = 0
    xferMiso.length = 0
  }

  let i = 0
  let j = 0
  const csCount = cs ? cs.count : 0
  // CS already asserted when the window opens: the transfer started earlier
  if (cs && active) xferStart = Math.min(sck.count ? sck.times[0] : end, cs.count ? cs.times[0] : end)
  while (i < sck.count || j < csCount) {
    const tS = i < sck.count ? sck.times[i] : Infinity
    const tC = j < csCount ? cs!.times[j] : Infinity
    const csNext = j < csCount ? cs!.after(j) : 2
    const takeCs = tC < tS || (tC === tS && csNext === 1)
    if (takeCs) {
      const t = tC
      j++
      const now = csNext === 1
      if (now === active) continue
      if (now) {
        active = true
        tAssert = t
        xferStart = t
        lastShiftBeforeWord = t
        bits = []
        modeError = sckL !== cpol
      } else {
        endTransfer(t)
        active = false
      }
      continue
    }
    const t = tS
    const next = sck.after(i++)
    if (next === sckL) continue
    sckL = next
    if (next === 2 || !active) continue
    if (next === sampleLevel) {
      // data changing at the very sampling edge misses it (hold time)
      bits.push({ mosi: mosi ? mosi.justBefore(t) : 0, miso: miso ? miso.justBefore(t) : 0, ts: t })
      if (bits.length === size) emitWord()
    } else {
      // shift edge: closes the previous word's cell, opens the next bit
      closeOpen(t)
      if (bits.length === 0) lastShiftBeforeWord = t
    }
  }
  // a transfer still running at the end of the capture: its partial word
  // stays undecoded (the window cut it, not the bus)
  closeOpen(Math.max(end, lastEdge))
  annotations.sort((a, b) => a.t0 - b.t0 || (a.row < b.row ? -1 : a.row > b.row ? 1 : 0))
  return { rows, annotations, info, words }
}
