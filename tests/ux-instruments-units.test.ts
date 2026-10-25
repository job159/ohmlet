/**
 * UX fix wave — instruments IS-17 (5): ONE value, ONE string, on every
 * surface that prints it (helper H3, docs/ux/UX_VERIFY.md §5.4 「同一個量，
 * 同一種格式」). The audit found 0.5 V printed four ways (0.50 V / 500 mV /
 * 500.0 mV / 0.5 V) and 97% vs 97 %. Each consumer's own formatter must
 * print the H3 string for 3.3 V, 0.5 V, 9.7 mA, 999.7 Hz, 0.998 Hz and a
 * 0.5 duty:
 *   chip / pin rows / wire panel   net-activity netLiveText (H4)
 *   inspector                      ui/embedded/format.ts fmtReadingVoltage / fmtReadingCurrent
 *   lessons                        lessons/engine/format.ts fmtQuantity
 *   instruments                    signal-readout timingCell / dutyText, H3 itself
 *   ERC messages                   sim/erc/graph.ts fmtV / fmtA (English, translated later)
 * Every consumer delegates to H3 now (the ERC re-export landed with IN-14),
 * so every row is enforced.
 */
import { describe, expect, it } from 'vitest'
import { fmtCurrent, fmtFreq, fmtPercent, fmtVoltage } from '../src/instruments/format'
import { setLang } from '../src/i18n'
import { netLiveText } from '../src/ui/embedded/instruments/net-activity'
import { dutyText, timingCell } from '../src/ui/embedded/instruments/signal-readout'
import { fmtReadingCurrent, fmtReadingVoltage } from '../src/ui/embedded/format'
import { fmtQuantity } from '../src/lessons/engine/format'
import { fmtA, fmtV } from '../src/sim/erc/graph'

const WANT = {
  v33: '3.30 V',
  v05: '500 mV',
  i97: '9.70 mA',
  f9997: '999.7 Hz',
  f0998: '0.998 Hz',
  duty: '50.0 %',
}

describe('IS-17 one value, one string (H3)', () => {
  setLang('zh-TW')
  it('H3 itself', () => {
    expect([fmtVoltage(3.3), fmtVoltage(0.5), fmtCurrent(9.7e-3), fmtFreq(999.7), fmtFreq(0.998), fmtPercent(0.5)]).toEqual(Object.values(WANT))
  })
  it('the hover chip, pin rows and wire panel (H4 netLiveText)', () => {
    expect(netLiveText({ kind: 'dc', v: 3.3 })).toBe(WANT.v33)
    expect(netLiveText({ kind: 'dc', v: 0.5 })).toBe(WANT.v05)
    expect(netLiveText({ kind: 'pwm', f: 999.7, duty: 0.5, vavg: null })).toBe(`PWM ${WANT.f9997} · ${WANT.duty}`)
  })
  it('the instruments (logic analyzer footer, scope readout)', () => {
    const f = (hz: number) => timingCell({ frequency: hz, periodicity: 'periodic', burstClock: null, skipped: false }, null)
    expect(f(999.7).value).toBe(WANT.f9997)
    expect(f(0.998).value).toBe(WANT.f0998)
    expect(dutyText({ duty: 0.5 }, f(999.7))).toBe(WANT.duty)
  })
  it('the inspector', () => {
    expect(fmtReadingVoltage(3.3)).toBe(WANT.v33)
    expect(fmtReadingVoltage(0.5)).toBe(WANT.v05)
    expect(fmtReadingCurrent(9.7e-3)).toBe(WANT.i97)
  })
  it('the lessons', () => {
    expect(fmtQuantity('voltage', 3.3)).toBe(WANT.v33)
    expect(fmtQuantity('voltage', 0.5)).toBe(WANT.v05)
    expect(fmtQuantity('current', 9.7e-3)).toBe(WANT.i97)
    expect(fmtQuantity('frequency', 999.7)).toBe(WANT.f9997)
    expect(fmtQuantity('frequency', 0.998)).toBe(WANT.f0998)
    expect(fmtQuantity('duty', 0.5)).toBe(WANT.duty)
  })
  // the ERC formatters print English for tMessage, through H3 with plain: true (IN-14)
  it('the ERC messages', () => {
    expect(fmtV(0.5)).toBe(fmtVoltage(0.5, { plain: true }))
    expect(fmtA(9.7e-3)).toBe(fmtCurrent(9.7e-3, { plain: true }))
    expect(fmtV(3.3)).toBe(WANT.v33)
    expect(fmtV(0.5)).toBe(WANT.v05)
    expect(fmtA(9.7e-3)).toBe(WANT.i97)
  })
})
