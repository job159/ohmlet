/**
 * Decoder catalog: each protocol decoder described for configuration UIs
 * (channel roles + parameters as select options) with a uniform `run`.
 * Parameter values are strings (select values); `run` parses them.
 */
import type { LogicTrace } from '../../sim/coordinator/api'
import type { DecodeResult } from '../types'
import { decodeI2c } from './i2c'
import { decodeOneWire } from './onewire'
import { decodeSpi } from './spi'
import { decodeUart, STANDARD_BAUDS, type UartParity } from './uart'

export { decodeUart, estimateBaud, STANDARD_BAUDS, type UartOptions, type UartFrame, type UartResult } from './uart'
export { decodeI2c, type I2cOptions, type I2cResult, type I2cTransaction } from './i2c'
export { decodeSpi, type SpiOptions, type SpiResult, type SpiWord } from './spi'
export { decodeOneWire, ONEWIRE_ROM_COMMANDS, type OneWireOptions, type OneWireResult, type OneWireEvent } from './onewire'

export interface DecoderRoleSpec {
  id: string
  label: string
  optional?: boolean
}

export interface DecoderParamSpec {
  key: string
  /** short name; UIs show "<label>: <option label>" (e.g. "Parity: even") */
  label: string
  options: { value: string; label: string }[]
  default: string
}

export interface DecoderSpec {
  id: string
  label: string
  /** one line for tooltips */
  description: string
  roles: DecoderRoleSpec[]
  params: DecoderParamSpec[]
  /**
   * Decode `traces` (by role; unmapped optional roles are undefined).
   * `t1` = end of the captured window (cut-off frames are not decoded).
   */
  run(traces: Record<string, LogicTrace | undefined>, params: Record<string, string>, t1: number): DecodeResult
}

const opt = (value: string, label = value) => ({ value, label })

const BAUD_OPTIONS = [opt('auto', 'auto'), ...[...STANDARD_BAUDS].filter((b) => b >= 300).map((b) => opt(String(b)))]

export const UART_DECODER: DecoderSpec = {
  id: 'uart',
  label: 'UART',
  description: 'Asynchronous serial: start bit, 5–9 data bits, parity, stop bits',
  roles: [{ id: 'data', label: 'Data' }],
  params: [
    { key: 'baud', label: 'Baud', options: BAUD_OPTIONS, default: 'auto' },
    { key: 'dataBits', label: 'Bits', options: ['5', '6', '7', '8', '9'].map((v) => opt(v)), default: '8' },
    {
      key: 'parity',
      label: 'Parity',
      options: [opt('none', 'none'), opt('even', 'even'), opt('odd', 'odd')],
      default: 'none',
    },
    { key: 'stopBits', label: 'Stop', options: ['1', '1.5', '2'].map((v) => opt(v)), default: '1' },
    {
      key: 'polarity',
      label: 'Idle',
      options: [opt('high', 'high'), opt('low', 'low (inverted)')],
      default: 'high',
    },
    { key: 'bitOrder', label: 'Order', options: [opt('lsb', 'LSB first'), opt('msb', 'MSB first')], default: 'lsb' },
  ],
  run(traces, p, t1) {
    const tr = traces.data
    const baud = p.baud === 'auto' || !p.baud ? 'auto' : Number(p.baud)
    if (!tr) return decodeUart({ initial: 2, times: new Float64Array(0), levels: new Uint8Array(0) }, { baud }, t1)
    return decodeUart(
      tr,
      {
        baud,
        dataBits: Number(p.dataBits ?? 8),
        parity: (p.parity ?? 'none') as UartParity,
        stopBits: Number(p.stopBits ?? 1),
        inverted: p.polarity === 'low',
        bitOrder: p.bitOrder === 'msb' ? 'msb' : 'lsb',
      },
      t1,
    )
  },
}

export const I2C_DECODER: DecoderSpec = {
  id: 'i2c',
  label: 'I²C',
  description: 'START / repeated START / STOP, 7- and 10-bit addresses, ACK/NACK, data bytes',
  roles: [
    { id: 'scl', label: 'SCL' },
    { id: 'sda', label: 'SDA' },
  ],
  params: [
    {
      key: 'addressFormat',
      label: 'Address',
      options: [opt('7bit', '7-bit'), opt('8bit', '8-bit (with R/W)')],
      default: '7bit',
    },
  ],
  run(traces, p, t1) {
    const empty = { initial: 2 as const, times: new Float64Array(0), levels: new Uint8Array(0) }
    return decodeI2c(traces.scl ?? empty, traces.sda ?? empty, { addressFormat: p.addressFormat === '8bit' ? '8bit' : '7bit' }, t1)
  },
}

export const SPI_DECODER: DecoderSpec = {
  id: 'spi',
  label: 'SPI',
  description: 'SCK + MOSI/MISO (+ CS): CPOL/CPHA modes 0–3, MSB/LSB first, 8/16-bit words',
  roles: [
    { id: 'sck', label: 'SCK' },
    { id: 'mosi', label: 'MOSI', optional: true },
    { id: 'miso', label: 'MISO', optional: true },
    { id: 'cs', label: 'CS', optional: true },
  ],
  params: [
    {
      key: 'mode',
      label: 'Mode',
      options: [
        opt('0', 'Mode 0 (CPOL 0, CPHA 0)'),
        opt('1', 'Mode 1 (CPOL 0, CPHA 1)'),
        opt('2', 'Mode 2 (CPOL 1, CPHA 0)'),
        opt('3', 'Mode 3 (CPOL 1, CPHA 1)'),
      ],
      default: '0',
    },
    { key: 'bitOrder', label: 'Order', options: [opt('msb', 'MSB first'), opt('lsb', 'LSB first')], default: 'msb' },
    { key: 'wordSize', label: 'Word', options: [opt('8', '8-bit'), opt('16', '16-bit')], default: '8' },
    { key: 'csActive', label: 'CS active', options: [opt('low', 'low'), opt('high', 'high')], default: 'low' },
  ],
  run(traces, p, t1) {
    const mode = Number(p.mode ?? 0) & 3
    const empty = { initial: 2 as const, times: new Float64Array(0), levels: new Uint8Array(0) }
    return decodeSpi(
      { sck: traces.sck ?? empty, mosi: traces.mosi, miso: traces.miso, cs: traces.cs },
      {
        cpol: (mode >> 1) as 0 | 1,
        cpha: (mode & 1) as 0 | 1,
        bitOrder: p.bitOrder === 'lsb' ? 'lsb' : 'msb',
        wordSize: Number(p.wordSize ?? 8),
        csActive: p.csActive === 'high' ? 'high' : 'low',
      },
      t1,
    )
  },
}

export const ONEWIRE_DECODER: DecoderSpec = {
  id: 'onewire',
  label: '1-Wire',
  description: 'Reset / presence, time slots, bytes (LSB first), ROM commands',
  roles: [{ id: 'data', label: 'DQ' }],
  params: [
    {
      key: 'speed',
      label: 'Speed',
      options: [opt('standard', 'standard'), opt('overdrive', 'overdrive')],
      default: 'standard',
    },
  ],
  run(traces, p, t1) {
    const empty = { initial: 2 as const, times: new Float64Array(0), levels: new Uint8Array(0) }
    return decodeOneWire(traces.data ?? empty, { overdrive: p.speed === 'overdrive' }, t1)
  },
}

export const DECODERS: readonly DecoderSpec[] = [UART_DECODER, I2C_DECODER, SPI_DECODER, ONEWIRE_DECODER]

export function decoderSpec(id: string): DecoderSpec | undefined {
  return DECODERS.find((d) => d.id === id)
}

export function defaultParams(spec: DecoderSpec): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of spec.params) out[p.key] = p.default
  return out
}
