/**
 * Logic-analyzer view configuration: the decoder registry adapter
 * (logic-decoders.ts → rows under the channel of each role), decoder
 * instance auto-mapping, persisted-config sanitizing.
 */
import { describe, expect, it } from 'vitest'
import type { LogicChannelConfig } from '../../src/sim/coordinator/api'
import { decoders, runDecoder, runDecoders } from '../../src/ui/embedded/logic-decoders'
import {
  newDecoderConfig,
  sanitizeDecoderConfigs,
  sanitizeTrigger,
  TRIGGER_DEFAULTS,
} from '../../src/ui/embedded/instruments/la-config'
import { ascii, capture, i2cLines, uartLine } from './synth'

const ch = (index: number, label: string): LogicChannelConfig => ({
  index,
  label,
  source: { kind: 'mcu-pin', componentId: 'U1', pin: label },
})

describe('decoder registry adapter', () => {
  it('registers UART, I2C, SPI and 1-Wire', () => {
    expect(decoders().map((d) => d.id)).toEqual(['uart', 'i2c', 'spi', 'onewire'])
    expect(decoders().find((d) => d.id === 'i2c')?.required).toEqual(['scl', 'sda'])
    expect(decoders().find((d) => d.id === 'spi')?.required).toEqual(['sck'])
  })

  it('UART rows sit under the data channel, with tones and short labels', () => {
    const { line, end } = uartLine(ascii('ok'), { baud: 9600 })
    const cap = capture(0, end, [line.trace(3, 'PA9')])
    const run = runDecoder(cap, { id: 'u1', decoder: 'uart', channels: { data: 3 }, options: { baud: 'auto' } })!
    expect(run.missing).toEqual([])
    expect(run.info).toEqual(['auto: 9600 Bd'])
    expect(run.rows).toHaveLength(1)
    expect(run.rows[0]).toMatchObject({ id: 'u1:data', label: 'UART', channel: 3 })
    expect(run.rows[0].items.map((a) => [a.text, a.short, a.tone])).toEqual([
      ["0x6F 'o'", '6F', 'data'],
      ["0x6B 'k'", '6B', 'data'],
    ])
    expect(run.annotations).toHaveLength(2)
    expect(runDecoders(cap, [{ decoder: 'uart', channels: { data: 3 }, options: { baud: '9600' } }])[0].items).toHaveLength(2)
  })

  it('I2C rows go under SDA; ACK/NACK keep their tone; missing roles decode nothing', () => {
    const { scl, sda, end } = i2cLines([{ op: 'start' }, { op: 'byte', value: 0xa0, ack: false }, { op: 'stop' }])
    const cap = capture(0, end, [scl.trace(0, 'SCL'), sda.trace(1, 'SDA')])
    const run = runDecoder(cap, { decoder: 'i2c', channels: { scl: 0, sda: 1 } })!
    expect(run.rows.map((r) => [r.id, r.channel])).toEqual([
      ['i2c:frames', 1],
      ['i2c:transfers', 1],
    ])
    expect(run.rows[0].items.map((a) => a.tone)).toEqual(['control', 'addr', 'nack', 'control'])
    const missing = runDecoder(cap, { decoder: 'i2c', channels: { scl: 0 } })!
    expect(missing.missing).toEqual(['sda'])
    expect(missing.rows).toEqual([])
    expect(runDecoder(cap, { decoder: 'nope', channels: {} })).toBeNull()
  })
})

describe('decoder instances', () => {
  const channels = [ch(0, 'PA9'), ch(1, 'PB6'), ch(2, 'PB7'), ch(3, 'PA5'), ch(4, 'PA7'), ch(5, 'PA4')]

  it('auto-maps roles by channel names / default STM32 pins', () => {
    expect(newDecoderConfig('uart', channels, [])).toEqual({ id: 'uart1', decoder: 'uart', channels: { data: 0 }, options: {} })
    expect(newDecoderConfig('i2c', channels, [])?.channels).toEqual({ scl: 1, sda: 2 })
    expect(newDecoderConfig('spi', channels, [])?.channels).toEqual({ sck: 3, mosi: 4, cs: 5 })
    // ids stay unique; required roles fall back to free channels
    expect(newDecoderConfig('uart', channels, [{ id: 'uart1', decoder: 'uart', channels: {} }])?.id).toBe('uart2')
    expect(newDecoderConfig('i2c', [ch(0, 'D0'), ch(1, 'D1')], [])?.channels).toEqual({ scl: 0, sda: 1 })
    expect(newDecoderConfig('bogus', channels, [])).toBeNull()
  })

  it('sanitizes stored decoder configs', () => {
    expect(sanitizeDecoderConfigs(null)).toEqual([])
    expect(
      sanitizeDecoderConfigs([
        { id: 'a', decoder: 'uart', channels: { data: 2, bad: 99, worse: 'x' }, options: { baud: 9600, x: {} } },
        { id: 'a', decoder: 'i2c', channels: { scl: 0, sda: 1 } },
        { decoder: 'nope', channels: {} },
        'junk',
      ]),
    ).toEqual([
      { id: 'a', decoder: 'uart', channels: { data: 2 }, options: { baud: '9600' } },
      { id: 'i2c1', decoder: 'i2c', channels: { scl: 0, sda: 1 }, options: {} },
    ])
  })

  it('sanitizes stored trigger settings', () => {
    expect(sanitizeTrigger(undefined)).toEqual(TRIGGER_DEFAULTS)
    expect(sanitizeTrigger({ kind: 'pattern', channel: 3, slope: 'any', pattern: { 1: 0, 2: 1, 3: 7, 40: 1 }, pre: 0.5 })).toEqual({
      kind: 'pattern',
      channel: 3,
      slope: 'any',
      pattern: { 1: 0, 2: 1 },
      pre: 0.5,
    })
    expect(sanitizeTrigger({ kind: 'x', channel: 99, pre: 0.3 })).toEqual(TRIGGER_DEFAULTS)
  })
})
