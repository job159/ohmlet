/**
 * UX fix wave — helper H3 (src/instruments/format.ts): the one unit
 * formatter. Pins the canonical strings of UX_VERIFY.md §5.4 「同一個量，同一種
 * 格式」 and the honest limits (0 V / 0 A / 0 W floors, never −0, "—" for a
 * value that cannot be trusted, "> 2 A（短路）").
 */
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import {
  approx,
  fmtCurrent,
  fmtFreq,
  fmtPercent,
  fmtPower,
  fmtSimClock,
  fmtSimTimeAt,
  fmtSpeedFactor,
  fmtVoltage,
  isShortCircuitCurrent,
  isTrustedVoltage,
} from '../src/instruments/format'

afterEach(() => __setLangForTests('zh-TW'))

describe('H3 fmtVoltage', () => {
  it('compact: 3 significant digits, V or mV, a space before the unit', () => {
    expect(fmtVoltage(3.3)).toBe('3.30 V')
    expect(fmtVoltage(3.0962)).toBe('3.10 V')
    expect(fmtVoltage(0.5)).toBe('500 mV')
    expect(fmtVoltage(0.0123)).toBe('12.3 mV')
    expect(fmtVoltage(12)).toBe('12.0 V')
    expect(fmtVoltage(230)).toBe('230 V')
    expect(fmtVoltage(-1.2)).toBe('−1.20 V')
  })
  it('reading: 4 significant digits', () => {
    expect(fmtVoltage(1.79841, { precision: 'reading' })).toBe('1.798 V')
    expect(fmtVoltage(5, { precision: 'reading' })).toBe('5.000 V')
    expect(fmtVoltage(0.8519, { precision: 'reading' })).toBe('851.9 mV')
  })
  it('rounding that carries moves up a prefix', () => {
    expect(fmtVoltage(0.9996)).toBe('1.00 V')
    expect(fmtVoltage(0.99996, { precision: 'reading' })).toBe('1.000 V')
    expect(fmtVoltage(9.996)).toBe('10.0 V')
  })
  it('limits: < 1 mV → 0 V (never −0); non-finite / > 1 kV → — (or the caller’s reason)', () => {
    expect(fmtVoltage(0.0004)).toBe('0 V')
    expect(fmtVoltage(-0.0004)).toBe('0 V')
    expect(fmtVoltage(-0)).toBe('0 V')
    expect(fmtVoltage(NaN)).toBe('—')
    expect(fmtVoltage(Infinity)).toBe('—')
    expect(fmtVoltage(null)).toBe('—')
    expect(fmtVoltage(undefined)).toBe('—')
    expect(fmtVoltage(-1261957.64)).toBe('—')
    expect(fmtVoltage(1500, { invalid: '—（求解器未收斂）' })).toBe('—（求解器未收斂）')
    expect(fmtVoltage(1000)).toBe('1.00 kV') // the limit itself is still a value
    expect(isTrustedVoltage(3.3)).toBe(true)
    expect(isTrustedVoltage(1e4)).toBe(false)
    expect(isTrustedVoltage(NaN)).toBe(false)
  })
})

describe('H3 fmtCurrent / fmtPower', () => {
  it('currents: A, mA, µA, nA with 3 significant digits', () => {
    expect(fmtCurrent(9.7e-3)).toBe('9.70 mA')
    expect(fmtCurrent(0.0041)).toBe('4.10 mA')
    expect(fmtCurrent(1.2e-4)).toBe('120 µA')
    expect(fmtCurrent(5e-9)).toBe('5.00 nA')
    expect(fmtCurrent(1.5)).toBe('1.50 A')
    expect(fmtCurrent(-0.0041)).toBe('−4.10 mA')
    expect(fmtCurrent(0.0097, { precision: 'reading' })).toBe('9.700 mA')
  })
  it('limits: < 1 nA → 0 A (a reversed LED reads 「0 A」); > 2 A → short circuit', () => {
    expect(fmtCurrent(7.6e-12)).toBe('0 A')
    expect(fmtCurrent(-3e-13)).toBe('0 A')
    expect(fmtCurrent(267)).toBe('> 2 A（短路）')
    expect(fmtCurrent(-2.5)).toBe('> 2 A（短路）')
    expect(fmtCurrent(267, { plain: true })).toBe('> 2 A (short circuit)')
    expect(fmtCurrent(NaN)).toBe('—')
    expect(isShortCircuitCurrent(2.01)).toBe(true)
    expect(isShortCircuitCurrent(2)).toBe(false)
    __setLangForTests('en')
    expect(fmtCurrent(3)).toBe('> 2 A (short circuit)')
  })
  it('power: W, mW, µW; < 1 µW → 0 W; the power of a short is not a number', () => {
    expect(fmtPower(0.031)).toBe('31.0 mW')
    expect(fmtPower(1.25)).toBe('1.25 W')
    expect(fmtPower(2.4e-6)).toBe('2.40 µW')
    expect(fmtPower(1e-9)).toBe('0 W')
    expect(fmtPower(622, { current: 267 })).toBe('—（短路）')
    expect(fmtPower(622, { current: 267, plain: true })).toBe('— (short circuit)')
    expect(fmtPower(NaN)).toBe('—')
  })
})

describe('H3 frequency, percent, speed, clock, time, approx', () => {
  it('fmtFreq never prints mHz', () => {
    expect(fmtFreq(999.7)).toBe('999.7 Hz')
    expect(fmtFreq(0.998)).toBe('0.998 Hz')
    expect(fmtFreq(1000.4)).toBe('1.000 kHz')
  })
  it('fmtPercent: one decimal below 100 %, a space, never −0.0 %', () => {
    expect(fmtPercent(0.5)).toBe('50.0 %')
    expect(fmtPercent(0.034)).toBe('3.4 %')
    expect(fmtPercent(0.25)).toBe('25.0 %')
    expect(fmtPercent(1)).toBe('100 %')
    expect(fmtPercent(1.234)).toBe('123 %')
    expect(fmtPercent(-0.0001)).toBe('0.0 %')
    expect(fmtPercent(0.97, { digits: 0 })).toBe('97 %')
    expect(fmtPercent(NaN)).toBe('—')
  })
  it('fmtSpeedFactor: 「0.2 倍速」, never 「0 倍速」', () => {
    expect(fmtSpeedFactor(0.17)).toBe('0.2 倍速')
    expect(fmtSpeedFactor(0.07)).toBe('0.07 倍速')
    expect(fmtSpeedFactor(0.003)).toBe('< 0.01 倍速')
    expect(fmtSpeedFactor(0)).toBe('< 0.01 倍速')
    expect(fmtSpeedFactor(1)).toBe('1.0 倍速')
    expect(fmtSpeedFactor(12.3)).toBe('12 倍速')
    expect(fmtSpeedFactor(-1)).toBe('—')
    expect(fmtSpeedFactor(NaN)).toBe('—')
    __setLangForTests('en')
    expect(fmtSpeedFactor(0.17)).toBe('0.2× speed')
  })
  it('fmtSimClock: 「3.11 s」「187.8 s」「612 s（10:12）」, never 「3:07.8」', () => {
    expect(fmtSimClock(3.114)).toBe('3.11 s')
    expect(fmtSimClock(66.9)).toBe('66.90 s')
    expect(fmtSimClock(187.84)).toBe('187.8 s')
    expect(fmtSimClock(612.3)).toBe('612 s（10:12）')
    expect(fmtSimClock(3725)).toBe('3725 s（1:02:05）')
    expect(fmtSimClock(0)).toBe('0.00 s')
    expect(fmtSimClock(-1)).toBe('—')
    __setLangForTests('en')
    expect(fmtSimClock(612.3)).toBe('612 s (10:12)')
  })
  it('fmtSimTimeAt: decimals follow the resolution, grouped by three', () => {
    expect(fmtSimTimeAt(2.704391, 1e-6)).toBe('2.704 391 s')
    expect(fmtSimTimeAt(2.704391, 1e-3)).toBe('2.704 s')
    expect(fmtSimTimeAt(0.5, 0.01)).toBe('0.50 s')
    expect(fmtSimTimeAt(2.7043915, 1e-7)).toBe('2.704 391 5 s')
    expect(fmtSimTimeAt(12, 1)).toBe('12 s')
    expect(fmtSimTimeAt(1.5)).toBe('1.500 s')
    expect(fmtSimTimeAt(-0.0000001, 1e-3)).toBe('0.000 s')
    expect(fmtSimTimeAt(NaN, 1e-3)).toBe('—')
  })
  it('approx: 「≈ 851.9 mV」 with a space; 「—」 stays 「—」', () => {
    expect(approx('851.9 mV')).toBe('≈ 851.9 mV')
    expect(approx('≈ 1 V')).toBe('≈ 1 V')
    expect(approx('—')).toBe('—')
    expect(approx(fmtVoltage(NaN))).toBe('—')
  })
})

describe('H3 table: one value, one string (IS-17 (5) baseline)', () => {
  it.each([
    [() => fmtVoltage(3.3), '3.30 V'],
    [() => fmtVoltage(0.5), '500 mV'],
    [() => fmtCurrent(9.7e-3), '9.70 mA'],
    [() => fmtFreq(999.7), '999.7 Hz'],
    [() => fmtFreq(0.998), '0.998 Hz'],
    [() => fmtPercent(0.5), '50.0 %'],
  ])('%#', (f, want) => {
    expect(f()).toBe(want)
  })
})
