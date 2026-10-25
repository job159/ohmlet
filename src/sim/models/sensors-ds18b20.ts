/**
 * Maxim DS18B20 1-Wire digital thermometer (datasheet 19-7487 rev 6).
 *
 * Everything happens on DQ (open drain, external 4.7 kΩ pull-up), timed
 * from the edges the master makes:
 *   - reset: DQ low ≥ 480 µs (t_RSTL); after the rising edge the part waits
 *     t_PDHIGH = 30 µs (15–60) and pulls DQ low for t_PDLOW = 120 µs
 *     (60–240) — the presence pulse;
 *   - write slot: the master pulls DQ low; the part samples DQ 30 µs later
 *     (window 15–60 µs): released = 1, still low = 0;
 *   - read slot: the master pulls DQ low ≥ 1 µs; a 0-bit is answered by
 *     holding DQ low until 30 µs after the falling edge, a 1-bit by leaving
 *     it released; bytes go LSB first.
 * Commands: READ ROM 0x33, MATCH ROM 0x55, SKIP ROM 0xCC, SEARCH ROM 0xF0,
 * ALARM SEARCH 0xEC; CONVERT T 0x44 (93.75 … 750 ms by resolution, read
 * slots answer 0 while busy), WRITE SCRATCHPAD 0x4E (TH, TL, config), READ
 * SCRATCHPAD 0xBE (9 bytes, byte 8 = CRC8 of bytes 0–7), COPY SCRATCHPAD
 * 0x48 (10 ms), RECALL E² 0xB8, READ POWER SUPPLY 0xB4.
 * Without the pull-up DQ never rises after the master releases it: the part
 * sees no reset edge and never answers — the real failure.
 */
import type { DeviceTelemetry, DigitalDevice, DigitalDeviceCtx, LogicLevel } from '../digital/api'
import type { ComponentInstance, ParamValue } from '../../model/types'
import { numParam } from './sensors-i2c'

/** 1-Wire timing (s) */
export const OW_RESET_MIN = 480e-6
export const OW_PRESENCE_WAIT = 30e-6
export const OW_PRESENCE_LOW = 120e-6
export const OW_SAMPLE = 30e-6
export const OW_READ_HOLD = 30e-6
/** conversion time per resolution 9…12 bit (s) */
export const DS18B20_TCONV = [0.09375, 0.1875, 0.375, 0.75]
export const DS18B20_TWR = 10e-3

/** Dallas/Maxim CRC8 (x^8 + x^5 + x^4 + 1, LSB first, init 0). */
export function crc8(bytes: ArrayLike<number>, n = bytes.length): number {
  let crc = 0
  for (let i = 0; i < n; i++) {
    let b = bytes[i] & 0xff
    for (let k = 0; k < 8; k++) {
      const mix = (crc ^ b) & 1
      crc >>= 1
      if (mix) crc ^= 0x8c
      b >>= 1
    }
  }
  return crc
}

/** Fixed 64-bit ROM code of a component: family 0x28, 48-bit serial from its id, CRC8. */
export function ds18b20Rom(componentId: string): number[] {
  let h = 0x811c9dc5
  for (let i = 0; i < componentId.length; i++) h = Math.imul(h ^ componentId.charCodeAt(i), 0x01000193)
  let h2 = Math.imul(h ^ 0x5bd1e995, 0x01000193)
  const serial: number[] = []
  for (let i = 0; i < 6; i++) {
    serial.push((i < 4 ? h >>> (i * 8) : h2 >>> ((i - 4) * 8)) & 0xff)
    if (i === 3) h2 = Math.imul(h2 ^ h, 0x01000193)
  }
  const rom = [0x28, ...serial]
  return [...rom, crc8(rom)]
}

/** Raw temperature register for °C at `bits` resolution (two's complement, 1/16 °C, undefined low bits 0). */
export function ds18b20Raw(tempC: number, bits: number): number {
  const t = Math.min(125, Math.max(-55, tempC))
  let raw = Math.round(t * 16)
  const drop = 12 - bits
  raw = Math.floor(raw / (1 << drop)) * (1 << drop)
  return raw & 0xffff
}

/** TH / TL / configuration EEPROM per component (session lifetime, like a real part). */
const EEPROM = new Map<string, [number, number, number]>()

export function eraseDs18b20(componentId: string): void {
  EEPROM.delete(componentId)
}

type OwState =
  | 'idle' // wait for reset
  | 'rom' // receiving the ROM command
  | 'match' // receiving 64 ROM bits
  | 'search' // SEARCH ROM / ALARM SEARCH
  | 'func' // receiving the function command
  | 'wscratch' // receiving TH, TL, config
  | 'tx' // sending bytes (scratchpad / ROM)
  | 'busy' // answering 0 while busy, then 1

export class Ds18b20 implements DigitalDevice {
  private ctx!: DigitalDeviceCtx
  readonly rom: number[]
  private powered = false
  private state: OwState = 'idle'
  private fallAt = NaN
  private selfLow = false
  /** after a reset: the presence-detect window, other parts' presence pulses are not slots */
  private quietUntil = 0
  private holdHandle = 0
  private sampleHandle = 0
  private presenceHandles: number[] = []
  // receive shifter
  private rxBits = 0
  private rxByte = 0
  private rxBytes: number[] = []
  // transmit
  private txBits: number[] = []
  // search
  private searchBit = 0
  private searchPhase = 0
  private alarmOnly = false
  private busyUntil = 0
  // scratchpad: temp LSB, MSB, TH, TL, config
  private temp = 0x0550
  private th = 0x4b
  private tl = 0x46
  private config = 0x7f
  private conversions = 0
  private presences = 0
  private tempC: number
  private readonly logged = new Set<string>()

  constructor(
    readonly componentId: string,
    comp?: ComponentInstance,
  ) {
    this.rom = ds18b20Rom(componentId)
    this.tempC = numParam(comp?.params?.temperature, 25)
    const e = EEPROM.get(componentId)
    if (e) [this.th, this.tl, this.config] = e
  }

  init(ctx: DigitalDeviceCtx): void {
    this.ctx = ctx
    ctx.drive('DQ', 'z')
    // parasite-power wiring (VDD to GND, DQ pulled up) is not simulated: say so
    ctx.schedule(1e-3, () => {
      if (!this.powered && ctx.supply() < 0.5 && ctx.voltage('DQ') > 2) {
        ctx.issue('warning', 'DS18B20: VDD is at GND (parasite-power mode), which is not simulated — power VDD from 3.3–5 V')
      }
    })
  }

  powerChanged(on: boolean): void {
    this.powered = on
    this.cancelAll()
    this.state = 'idle'
    this.fallAt = NaN
    if (on) {
      // power-up: temperature register 85 °C, TH/TL/config recalled from EEPROM
      this.temp = 0x0550
      const e = EEPROM.get(this.componentId)
      if (e) [this.th, this.tl, this.config] = e
      else [this.th, this.tl, this.config] = [0x4b, 0x46, 0x7f]
      this.busyUntil = 0
    }
  }

  setParam(key: string, value: ParamValue): void {
    if (key === 'temperature') this.tempC = numParam(value, this.tempC)
  }

  telemetry(): DeviceTelemetry {
    const t = this.temp >= 0x8000 ? this.temp - 0x10000 : this.temp
    return {
      values: {
        temperature: t / 16,
        resolution: this.resolution(),
        conversions: this.conversions,
        presences: this.presences,
        converting: this.ctx && this.ctx.now() < this.busyUntil ? 1 : 0,
      },
    }
  }

  /** The 9 scratchpad bytes as read by READ SCRATCHPAD. */
  scratchpad(): number[] {
    const b = [this.temp & 0xff, (this.temp >> 8) & 0xff, this.th, this.tl, this.config, 0xff, 0x0c, 0x10]
    return [...b, crc8(b)]
  }

  private resolution(): number {
    return 9 + ((this.config >> 5) & 3)
  }

  // --------------------------------------------------------------- edges

  onPinChange(pin: string, level: LogicLevel): void {
    if (pin !== 'DQ' || !this.powered || level === null) return
    const now = this.ctx.now()
    if (level === 0) {
      if (this.selfLow) return // our own presence / 0-bit drive
      this.fallAt = now
      if (now < this.quietUntil) return // another device's presence pulse
      this.slotStart()
      return
    }
    // rising edge: a long low was a reset pulse
    const low = now - this.fallAt
    this.fallAt = NaN
    if (low >= OW_RESET_MIN) this.reset()
  }

  private reset(): void {
    this.cancelSlot()
    this.state = 'rom'
    this.rxBits = 0
    this.rxByte = 0
    this.rxBytes = []
    this.txBits = []
    for (const h of this.presenceHandles) this.ctx.cancel(h)
    this.quietUntil = this.ctx.now() + OW_PRESENCE_WAIT + OW_PRESENCE_LOW
    this.presenceHandles = [
      this.ctx.schedule(OW_PRESENCE_WAIT, () => this.driveLow(true)),
      this.ctx.schedule(OW_PRESENCE_WAIT + OW_PRESENCE_LOW, () => {
        this.presences++
        this.driveLow(false)
        this.presenceHandles = []
      }),
    ]
  }

  private driveLow(on: boolean): void {
    this.selfLow = on
    this.ctx.drive('DQ', on ? 'low' : 'z')
    if (!on) this.selfLow = false
  }

  /** A time slot begins (master pulled DQ low). */
  private slotStart(): void {
    switch (this.state) {
      case 'tx':
      case 'busy':
        this.answer(this.nextTxBit())
        return
      case 'search':
        if (this.searchPhase < 2) {
          const bit = this.romBit(this.searchBit)
          this.answer(this.searchPhase === 0 ? bit : bit ^ 1)
          this.searchPhase++
        } else {
          this.sampleLater((b) => this.searchDirection(b))
        }
        return
      case 'rom':
      case 'match':
      case 'func':
      case 'wscratch':
        this.sampleLater((b) => this.receiveBit(b))
        return
      default:
        return
    }
  }

  /** Read slot: hold DQ low for a 0-bit. */
  private answer(bit: number): void {
    if (bit) return
    this.driveLow(true)
    this.holdHandle = this.ctx.schedule(OW_READ_HOLD, () => {
      this.holdHandle = 0
      this.driveLow(false)
    })
  }

  /** Write slot: sample DQ 30 µs after the falling edge. */
  private sampleLater(fn: (bit: number) => void): void {
    if (this.sampleHandle) this.ctx.cancel(this.sampleHandle)
    this.sampleHandle = this.ctx.schedule(OW_SAMPLE, () => {
      this.sampleHandle = 0
      fn(this.ctx.read('DQ') === 0 ? 0 : 1)
    })
  }

  private cancelSlot(): void {
    if (this.sampleHandle) this.ctx.cancel(this.sampleHandle)
    this.sampleHandle = 0
    if (this.holdHandle) this.ctx.cancel(this.holdHandle)
    this.holdHandle = 0
    if (this.selfLow) this.driveLow(false)
  }

  private cancelAll(): void {
    if (!this.ctx) return
    this.cancelSlot()
    for (const h of this.presenceHandles) this.ctx.cancel(h)
    this.quietUntil = this.ctx.now() + OW_PRESENCE_WAIT + OW_PRESENCE_LOW
    this.presenceHandles = []
    this.ctx.drive('DQ', 'z')
    this.selfLow = false
  }

  private romBit(i: number): number {
    return (this.rom[i >> 3] >> (i & 7)) & 1
  }

  private nextTxBit(): number {
    if (this.state === 'busy') return this.ctx.now() < this.busyUntil ? 0 : 1
    const b = this.txBits.shift()
    if (b === undefined) {
      this.state = 'idle' // done: further read slots read 1 (bus idle)
      return 1
    }
    if (this.txBits.length === 0) this.state = 'idle'
    return b
  }

  private send(bytes: number[]): void {
    this.txBits = []
    for (const byte of bytes) for (let i = 0; i < 8; i++) this.txBits.push((byte >> i) & 1)
    this.state = 'tx'
  }

  private receiveBit(bit: number): void {
    if (this.state === 'match') {
      if (bit !== this.romBit(this.rxBits)) {
        this.state = 'idle' // not us: wait for the next reset
        return
      }
      this.rxBits++
      if (this.rxBits === 64) {
        this.state = 'func'
        this.rxBits = 0
        this.rxByte = 0
      }
      return
    }
    this.rxByte |= bit << this.rxBits
    this.rxBits++
    if (this.rxBits < 8) return
    const byte = this.rxByte
    this.rxBits = 0
    this.rxByte = 0
    if (this.state === 'rom') this.romCommand(byte)
    else if (this.state === 'func') this.functionCommand(byte)
    else if (this.state === 'wscratch') {
      this.rxBytes.push(byte)
      if (this.rxBytes.length === 3) {
        ;[this.th, this.tl] = [this.rxBytes[0], this.rxBytes[1]]
        this.config = (this.rxBytes[2] & 0x60) | 0x1f
        this.state = 'idle'
      }
    }
  }

  private romCommand(cmd: number): void {
    switch (cmd) {
      case 0x33: // READ ROM
        this.send(this.rom)
        return
      case 0x55: // MATCH ROM
        this.state = 'match'
        this.rxBits = 0
        return
      case 0xcc: // SKIP ROM
        this.state = 'func'
        return
      case 0xf0: // SEARCH ROM
      case 0xec: // ALARM SEARCH
        this.alarmOnly = cmd === 0xec
        if (this.alarmOnly && !this.alarm()) {
          this.state = 'idle'
          return
        }
        this.state = 'search'
        this.searchBit = 0
        this.searchPhase = 0
        return
      default:
        this.logOnce(`rom:${cmd}`, `DS18B20: unknown ROM command 0x${cmd.toString(16).toUpperCase().padStart(2, '0')} ignored`)
        this.state = 'idle'
    }
  }

  private searchDirection(bit: number): void {
    if (bit !== this.romBit(this.searchBit)) {
      this.state = 'idle' // deselected
      return
    }
    this.searchBit++
    this.searchPhase = 0
    if (this.searchBit === 64) this.state = 'func'
  }

  private functionCommand(cmd: number): void {
    const now = this.ctx.now()
    switch (cmd) {
      case 0x44: {
        // CONVERT T
        const tconv = DS18B20_TCONV[this.resolution() - 9]
        this.busyUntil = now + tconv
        this.state = 'busy'
        this.ctx.schedule(tconv, () => {
          this.conversions++
          this.temp = ds18b20Raw(this.tempC, this.resolution())
        })
        return
      }
      case 0xbe: // READ SCRATCHPAD
        this.send(this.scratchpad())
        return
      case 0x4e: // WRITE SCRATCHPAD
        this.state = 'wscratch'
        this.rxBytes = []
        return
      case 0x48: // COPY SCRATCHPAD
        this.busyUntil = now + DS18B20_TWR
        this.state = 'busy'
        this.ctx.schedule(DS18B20_TWR, () => EEPROM.set(this.componentId, [this.th, this.tl, this.config]))
        return
      case 0xb8: {
        // RECALL E²
        const e = EEPROM.get(this.componentId)
        if (e) [this.th, this.tl, this.config] = e
        this.busyUntil = now
        this.state = 'busy'
        return
      }
      case 0xb4: // READ POWER SUPPLY: externally powered → read slots stay high
        this.busyUntil = now
        this.state = 'busy'
        return
      default:
        this.logOnce(`fn:${cmd}`, `DS18B20: unknown function command 0x${cmd.toString(16).toUpperCase().padStart(2, '0')} ignored`)
        this.state = 'idle'
    }
  }

  /** Alarm flag of the last conversion: T ≥ TH or T ≤ TL (integer part, bits 11–4). */
  private alarm(): boolean {
    const t = this.temp >= 0x8000 ? this.temp - 0x10000 : this.temp
    const whole = Math.floor(t / 16)
    const s8 = (v: number) => (v >= 0x80 ? v - 0x100 : v)
    return whole >= s8(this.th) || whole <= s8(this.tl)
  }

  private logOnce(key: string, message: string): void {
    if (this.logged.has(key)) return
    this.logged.add(key)
    this.ctx.log(message)
  }
}
