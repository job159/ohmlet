/**
 * I²C decoder (SCL + SDA) — NXP UM10204 rev. 7.
 *
 * Bus conditions (§3.1.4): SDA falling while SCL is high = START (a START
 * inside a transfer = repeated START, Sr); SDA rising while SCL is high =
 * STOP. Data (§3.1.3): SDA is sampled on every SCL rising edge (clock
 * stretching is implicit — the bit waits for the edge); 8 bits MSB first
 * then the acknowledge bit (§3.1.6: SDA low = ACK, high = NACK).
 * The first byte after START / Sr is the address byte (§3.1.10): 7-bit
 * address + R/W̄. 1111 0XX is the 10-bit prefix (§3.1.11): with W the next
 * byte carries the address' 8 LSBs; with R (after Sr) it addresses the
 * device selected earlier — the decoder shows the prefix bits only
 * ("partial"). Address 0000 000 + W is the general call (§3.2.1).
 *
 * Simultaneous SCL and SDA edges (same timestamp) are processed SCL first
 * (a hold-time-zero data change after SCL falls is data, not a START).
 * Bits sampled at an undefined level and bytes cut short by START / STOP
 * are annotated as errors. Annotation cells run from the SCL falling edge
 * that opens a bit to the one that closes it, so a byte and its ACK tile
 * the timeline.
 */
import type { LogicTrace } from '../../sim/coordinator/api'
import { fmtHex, fmtHexShort, fmtWord } from '../format'
import { Signal, type Level } from '../signal'
import type { Annotation, DecodeResult, DecoderRow } from '../types'

export interface I2cOptions {
  /** show addresses as 7-bit (default) or as the 8-bit address byte */
  addressFormat?: '7bit' | '8bit'
}

export interface I2cTransaction {
  t0: number
  t1: number
  /** 7-bit or 10-bit address; null when the address byte was incomplete */
  address: number | null
  tenBit: boolean
  read: boolean
  /** acknowledge of the address byte (null: incomplete) */
  addressAck: boolean | null
  /** data bytes after the address (10-bit: after the second address byte) */
  bytes: number[]
  acks: boolean[]
  /** ended by STOP (false: by Sr or the end of the capture) */
  stopped: boolean
}

export interface I2cResult extends DecodeResult {
  transactions: I2cTransaction[]
}

export const I2C_ROWS: DecoderRow[] = [
  { id: 'frames', label: 'I²C', role: 'sda' },
  { id: 'transfers', label: 'I²C transfers', role: 'sda' },
]

interface Bit {
  v: Level
  /** SCL rising edge (sample point) */
  ts: number
  /** cell start: the SCL falling edge before the sample */
  c0: number
}

export function decodeI2c(
  sclTrace: Pick<LogicTrace, 'initial' | 'times' | 'levels'>,
  sdaTrace: Pick<LogicTrace, 'initial' | 'times' | 'levels'>,
  opts: I2cOptions = {},
  t1?: number,
): I2cResult {
  const scl = new Signal(sclTrace)
  const sda = new Signal(sdaTrace)
  const show8 = opts.addressFormat === '8bit'
  const annotations: Annotation[] = []
  const transactions: I2cTransaction[] = []
  const lastEdge = Math.max(scl.count ? scl.times[scl.count - 1] : 0, sda.count ? sda.times[sda.count - 1] : 0)
  const end = t1 ?? lastEdge

  let sclL: Level = scl.initial
  let sdaL: Level = sda.initial
  let lastFall = -Infinity
  let active = false
  let bits: Bit[] = []
  /** byte index within the transfer (0 = address byte) */
  let byteNo = 0
  let tenBitPending = false
  /** last complete 10-bit address (a 10-bit read after Sr re-selects it) */
  let lastTenBit: number | null = null
  let tx: I2cTransaction | null = null
  /** annotations whose t1 closes at the next SCL falling edge */
  let openCells: Annotation[] = []

  const closeCells = (t: number) => {
    for (const a of openCells) a.t1 = t
    openCells = []
  }

  const finishTransfer = (t: number, stopped: boolean) => {
    if (!tx) return
    tx.t1 = t
    tx.stopped = stopped
    transactions.push(tx)
    const dir = tx.read ? 'R' : 'W'
    const addr =
      tx.address === null ? '?' : tx.tenBit ? fmtHex(tx.address, 10) : fmtHex(show8 ? (tx.address << 1) | (tx.read ? 1 : 0) : tx.address)
    const data = tx.bytes.map((b) => fmtHexShort(b)).join(' ')
    const nack = tx.addressAck === false ? ' NACK' : ''
    annotations.push({
      t0: tx.t0,
      t1: t,
      row: 'transfers',
      text: `${dir} ${addr}${nack}${data ? `: ${data}` : ''}`,
      short: `${dir} ${addr.replace(/^0x/, '')}`,
      kind: tx.addressAck === false ? 'ctrl' : 'addr',
    })
    tx = null
  }

  /**
   * START / STOP inside a byte. The SCL rising edge of the condition itself
   * was recorded as one bit (a STOP or Sr always looks like the first bit
   * of a new byte until SDA moves), so only MORE bits are a cut-short byte.
   */
  const partialByte = () => {
    const n = bits.length - 1
    if (n >= 1) {
      annotations.push({
        t0: bits[0].c0,
        t1: bits[n].c0,
        row: 'frames',
        text: `incomplete byte (${n} bit${n === 1 ? '' : 's'})`,
        short: '!',
        kind: 'error',
      })
    }
    bits = []
  }

  const onByte = () => {
    const c0 = bits[0].c0
    const cAck = bits[8].c0
    if (bits.some((b) => b.v === 2)) {
      annotations.push({ t0: c0, t1: cAck, row: 'frames', text: 'undefined level', short: '?', kind: 'error' })
      bits = []
      byteNo++
      return
    }
    let value = 0
    for (let i = 0; i < 8; i++) value = (value << 1) | bits[i].v
    const ack = bits[8].v === 0
    const ackAnn: Annotation = {
      t0: cAck,
      t1: bits[8].ts,
      row: 'frames',
      text: ack ? 'ACK' : 'NACK',
      short: ack ? 'A' : 'N',
      kind: 'ctrl',
      tone: ack ? 'ack' : 'nack',
    }
    let ann: Annotation
    if (byteNo === 0) {
      const read = (value & 1) === 1
      const dir = read ? 'R' : 'W'
      if ((value & 0xf8) === 0xf0) {
        const hi = (value >> 1) & 3
        tenBitPending = !read
        ann = {
          t0: c0,
          t1: cAck,
          row: 'frames',
          text: `10-bit addr A9:8=${hi} ${dir}`,
          short: `${hi}xx ${dir}`,
          kind: 'addr',
          value: hi,
        }
        if (tx) {
          tx.tenBit = true
          tx.read = read
          tx.address = read ? (lastTenBit !== null && lastTenBit >> 8 === hi ? lastTenBit : null) : hi << 8
          tx.addressAck = ack
        }
      } else {
        const a7 = value >> 1
        const shown = show8 ? value : a7
        const general = a7 === 0 && !read
        ann = {
          t0: c0,
          t1: cAck,
          row: 'frames',
          text: general ? 'General call' : `Addr ${fmtHex(shown)} ${dir}`,
          short: general ? 'GC' : `${fmtHexShort(shown)} ${dir}`,
          kind: 'addr',
          value: a7,
        }
        if (tx) {
          tx.address = a7
          tx.read = read
          tx.addressAck = ack
        }
      }
    } else if (byteNo === 1 && tenBitPending) {
      tenBitPending = false
      const full = ((tx?.address ?? 0) & 0x300) | value
      ann = {
        t0: c0,
        t1: cAck,
        row: 'frames',
        text: `Addr ${fmtHex(full, 10)} (10-bit) W`,
        short: `${fmtHexShort(full, 10)} W`,
        kind: 'addr',
        value: full,
      }
      lastTenBit = full
      if (tx) {
        tx.address = full
        tx.addressAck = ack
      }
    } else {
      ann = {
        t0: c0,
        t1: cAck,
        row: 'frames',
        text: fmtWord(value),
        short: fmtHexShort(value),
        kind: 'data',
        value,
      }
      if (tx) {
        tx.bytes.push(value)
        tx.acks.push(ack)
      }
    }
    annotations.push(ann, ackAnn)
    openCells.push(ackAnn)
    bits = []
    byteNo++
  }

  // merge both edge lists in time order (ties: SCL first)
  let i = 0
  let j = 0
  while (i < scl.count || j < sda.count) {
    const tScl = i < scl.count ? scl.times[i] : Infinity
    const tSda = j < sda.count ? sda.times[j] : Infinity
    if (tScl <= tSda) {
      const t = tScl
      const next = scl.after(i++)
      if (next === sclL) continue
      sclL = next
      if (next === 1) {
        if (active) {
          bits.push({ v: sdaL, ts: t, c0: lastFall })
          if (bits.length === 9) onByte()
        }
      } else if (next === 0) {
        lastFall = t
        closeCells(t)
      }
    } else {
      const t = tSda
      const next = sda.after(j++)
      const prev = sdaL
      sdaL = next
      if (sclL !== 1 || next === prev) continue
      if (prev === 1 && next === 0) {
        // START or repeated START
        const repeated = active
        // a repeated START's cell opens at the SCL falling edge before it
        const c0 = repeated ? lastFall : t
        if (active) {
          partialByte()
          closeCells(t)
          finishTransfer(c0, false)
        }
        active = true
        byteNo = 0
        tenBitPending = false
        bits = []
        const ann: Annotation = {
          t0: c0,
          t1: t,
          row: 'frames',
          text: repeated ? 'Repeated START' : 'START',
          short: repeated ? 'Sr' : 'S',
          kind: 'ctrl',
        }
        annotations.push(ann)
        openCells.push(ann)
        tx = { t0: c0, t1: t, address: null, tenBit: false, read: false, addressAck: null, bytes: [], acks: [], stopped: false }
      } else if (prev === 0 && next === 1 && active) {
        // STOP: its cell opens at the SCL falling edge before the condition
        partialByte()
        closeCells(lastFall)
        annotations.push({ t0: lastFall, t1: t, row: 'frames', text: 'STOP', short: 'P', kind: 'ctrl' })
        finishTransfer(t, true)
        active = false
      }
    }
  }
  // cells still open at the end of the capture close there
  closeCells(Math.max(end, lastEdge))
  if (active) finishTransfer(Math.max(end, lastEdge), false)
  annotations.sort((a, b) => a.t0 - b.t0 || (a.row < b.row ? -1 : a.row > b.row ? 1 : 0))
  return { rows: I2C_ROWS, annotations, info: [], transactions }
}
