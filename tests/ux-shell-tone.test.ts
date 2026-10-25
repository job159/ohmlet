/**
 * UX fix SH-14 — one state colour, one time and speed format in the capsule:
 *   - the capsule's clock and speed are the H3 strings (「187.8 s」,
 *     「612 s（10:12）」 — never 「3:07.8」; 「0.2 倍速」, 「< 0.01 倍速」 —
 *     never 「0 倍速」), so the capsule and the MCU panel print the same text;
 *   - the status pill's dot is the H6 state colour of what it is about
 *     (「未供電」 red, as on the MCU badge; no firmware / halted orange; the
 *     ready line idle-neutral).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { fmtSimClock, fmtSpeedFactor } from '../src/instruments/format'
import { formatSimTime, formatSpeedFactor, runCapsuleText } from '../src/ui/chrome/StatusBar'
import { problemDotColor, statusPillModel } from '../src/ui/chrome/StatusPill'
import { STATE_TONE, TONE_COLOR, stateColor } from '../src/ui/chrome/run-control'
import type { Problem } from '../src/ui/embedded/problems'

afterEach(() => __setLangForTests('zh-TW'))

const problem = (over: Partial<Problem>): Problem => ({
  id: 'p',
  level: 'warning',
  source: 'mcu',
  title: 'T',
  detail: 'D',
  componentIds: [],
  holes: [],
  ...over,
})

describe('SH-14 the capsule speaks H3', () => {
  it('formatSimTime / formatSpeedFactor ARE the H3 formatters', () => {
    expect(formatSimTime).toBe(fmtSimClock)
    expect(formatSpeedFactor).toBe(fmtSpeedFactor)
  })

  it('clock: 3.11 s · 187.8 s · 612 s（10:12）, never m:ss.s', () => {
    __setLangForTests('zh-TW')
    expect(runCapsuleText('paused', { time: 3.111 }).time).toBe('3.11 s')
    expect(runCapsuleText('running', { time: 187.84 }).time).toBe('187.8 s')
    expect(runCapsuleText('running', { time: 612.3 }).time).toBe('612 s（10:12）')
    expect(runCapsuleText('fault', { time: 66.9, mcuId: 'U1' }).time).not.toMatch(/^\d+:\d/)
  })

  it('speed: the factor as the MCU panel prints it, never 「0 倍速」', () => {
    __setLangForTests('zh-TW')
    for (const rf of [0.17, 0.07, 0.003, 0.0004]) {
      const extra = runCapsuleText('running', { time: 1, slow: rf, speed: 1 }).extra
      expect(extra).toBe(fmtSpeedFactor(rf))
      expect(extra).not.toBe('0 倍速')
    }
    expect(runCapsuleText('running', { time: 1, slow: 0.17, speed: 1 }).extra).toBe('0.2 倍速')
    expect(runCapsuleText('running', { time: 1, slow: 0.0004, speed: 1 }).extra).toBe('< 0.01 倍速')
  })
})

describe('SH-14 one state colour (H6)', () => {
  it('the table: unpowered red, paused blue, halted / no firmware / boot0 orange', () => {
    expect(STATE_TONE.unpowered).toBe('red')
    expect(STATE_TONE.paused).toBe('blue')
    expect([STATE_TONE.halted, STATE_TONE['no-firmware'], STATE_TONE['boot-sysmem']]).toEqual(['orange', 'orange', 'orange'])
  })

  it('the pill dot follows the board state a row is about', () => {
    expect(problemDotColor(problem({ fact: 'power:U1', level: 'warning' }))).toBe(stateColor('unpowered'))
    expect(problemDotColor(problem({ fact: 'power:U1' }))).toBe(TONE_COLOR.red)
    expect(problemDotColor(problem({ fact: 'fw-missing:U1' }))).toBe(stateColor('no-firmware'))
    expect(problemDotColor(problem({ fact: 'halt:U1' }))).toBe(stateColor('halted'))
    expect(problemDotColor(problem({ fact: 'lockup:U1' }))).toBe(stateColor('lockup'))
    expect(problemDotColor(problem({ fact: 'boot0:U1' }))).toBe(stateColor('boot-sysmem'))
    expect(problemDotColor(problem({ source: 'erc', level: 'error' }))).toBe(TONE_COLOR.red)
    expect(problemDotColor(problem({ source: 'erc', level: 'warning' }))).toBe(TONE_COLOR.orange)
  })

  it('the ready line is idle (neutral); a halt the store has not reported is orange', () => {
    __setLangForTests('zh-TW')
    const c = { error: 0, warning: 0, info: 0 }
    const ready = statusPillModel({ problems: [], counts: c, phase: 'idle', haltedId: null, boardEmpty: false })!
    expect(ready.dot).toBe(stateColor('idle'))
    const halted = statusPillModel({ problems: [], counts: c, phase: 'halted', haltedId: 'U1', boardEmpty: false })!
    expect(halted.dot).toBe(stateColor('halted'))
  })
})
