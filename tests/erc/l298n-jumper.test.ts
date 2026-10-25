/**
 * ERC power rules and the L298N's 5V-EN jumper (src/sim/erc/rules-power.ts
 * JUMPER_FED_REGULATORS / powerRails): with the jumper fitted (the default)
 * the module's 78M05 makes +5V from VS, so a module fed only on +12V is
 * powered — and its +5V terminal is a supply for whatever is wired to it
 * (a ULN2003 board, a Blue Pill's 5V pin). With the jumper removed +5V is a
 * logic-supply INPUT and an unfed +5V is an error. A VS too low for the
 * 78M05 (5 V in, 2 V dropout) is a supply-range risk.
 */
import { describe, expect, it } from 'vitest'
import { runErc } from '../../src/sim/erc'
import { buildCircuit } from '../../src/sim/erc/graph'
import { JUMPER_FED_REGULATORS, powerRails } from '../../src/sim/erc/rules-power'
import { CATALOG, paramOf } from '../../src/model/catalog'
import type { CircuitLayout, ComponentInstance, Wire } from '../../src/model/types'
import { __setLangForTests } from '../../src/i18n'
import { tMessage } from '../../src/i18n/messages'
import { BP, bluePill, layout, ofRule, ps, summary, tap, valid, w } from './helpers'

const l298n = (params?: ComponentInstance['params']): ComponentInstance =>
  params ? { id: 'D2', type: 'l298n_module', params } : { id: 'D2', type: 'l298n_module' }

/** The motors-l298n-running VR scene: PS1 7.5 V on +12V / GND only, IN1 tied to +5V, a DC motor on OUT1 / OUT2. */
function runningScene(params?: ComponentInstance['params'], extra: { comps?: ComponentInstance[]; wires?: Wire[] } = {}): CircuitLayout {
  return {
    version: 1,
    name: 'L298N + DC motor',
    components: [
      { id: 'PS1', type: 'power_supply', params: { voltage: 7.5 }, pos: { x: -16, z: 24.5 } },
      { id: 'M1', type: 'dc_motor', pos: { x: -6.5, z: 24.5 } },
      { ...l298n(params), pos: { x: 2, z: 24.5 } },
      ...(extra.comps ?? []),
    ],
    wires: [
      { id: 's1', from: 'PS1:+', to: 'D2:+12V', color: 'red' },
      { id: 's2', from: 'PS1:-', to: 'D2:GND', color: 'black' },
      { id: 's3', from: 'D2:IN1', to: 'D2:+5V', color: 'orange' },
      { id: 's4', from: 'D2:IN2', to: 'D2:GND', color: 'black' },
      { id: 's5', from: 'D2:OUT1', to: 'M1:M+', color: 'yellow' },
      { id: 's6', from: 'D2:OUT2', to: 'M1:M-', color: 'green' },
      ...(extra.wires ?? []),
    ],
  }
}

const unpoweredOf = (l: CircuitLayout, id: string) => ofRule(runErc(l), 'unpowered').filter((f) => f.componentIds[0] === id)

describe('the jumper table matches the catalog and the device model', () => {
  it('every entry names a real jumper param, a regulator behind a private input node and a supply terminal', () => {
    for (const [type, jf] of Object.entries(JUMPER_FED_REGULATORS)) {
      const e = CATALOG[type]
      expect(e, type).toBeDefined()
      const param = e.params?.find((p) => p.key === jf.jumper)
      expect(param?.kind, `${type} ${jf.jumper}`).toBe('boolean')
      expect(paramOf(undefined, e, jf.jumper), 'fitted by default').toBe(true)
      const el = e.subcircuit?.find((x) => x.id === jf.element)
      expect(el?.model, `${type} ${jf.element}`).toBe('ldo')
      expect(el!.pins[0].startsWith('@'), 'the regulator input is a private node the jumper feeds').toBe(true)
      expect(e.supplyPins?.plus, 'the jumper joins a supply terminal').toContain(jf.from)
      expect(e.supplyPins?.plus, 'the regulator output is a supply terminal').toContain(el!.pins[1])
    }
  })

  it('a circuit without such a module keeps graph.ts’s rails exactly (the same map)', () => {
    const c = buildCircuit(valid(bluePill()))
    expect(powerRails(c)).toBe(c.rails)
    // a removed jumper adds nothing either
    const off = buildCircuit(valid(runningScene({ jumper5v: false })))
    expect(powerRails(off)).toBe(off.rails)
  })
})

describe('L298N supply: the 5V-EN jumper fitted (default)', () => {
  it('only +12V wired: no false 「D2 沒有供電」 — the 78M05 feeds +5V (the motors-l298n-running scene)', () => {
    const l = valid(runningScene())
    const f = runErc(l)
    expect(unpoweredOf(l, 'D2'), summary(f)).toEqual([])
    expect(f.filter((x) => x.level === 'error'), summary(f)).toEqual([])
    expect(f.some((x) => x.fact === 'power:D2'), summary(f)).toBe(false)
    // +5V is a 5 V rail made by D2's regulator
    const c = buildCircuit(l)
    const d2 = c.byId.get('D2')!
    const rail = powerRails(c).get(d2.nets[CATALOG.l298n_module.pins.indexOf('+5V')]!)
    expect(rail).toEqual({ v: 5, by: 'D2 5 V regulator', compId: 'D2' })
  })

  it('its +5V terminal powers a ULN2003 board wired to it', () => {
    const uln: ComponentInstance = { id: 'D1', type: 'uln2003_board', pos: { x: 2, z: 36 } }
    const l = valid(runningScene(undefined, { comps: [uln], wires: [w('D2:+5V', 'D1:VCC'), w('D2:GND', 'D1:GND')] }))
    expect(unpoweredOf(l, 'D1'), summary(runErc(l))).toEqual([])
    expect(unpoweredOf(l, 'D2')).toEqual([])
  })

  it('its +5V on the + rail powers a Blue Pill through the board’s 5V pin (and its 3.3 V regulator)', () => {
    const l = valid(
      layout(
        [ps('PS1', 9), l298n(), BP],
        [
          w('PS1:+', 'D2:+12V'),
          w('PS1:-', 'D2:GND'),
          w('D2:GND', 'top-0'),
          w('D2:+5V', 'top+0'),
          w('top+1', tap('5V')),
          w(tap('GND3'), 'top-1'),
        ],
      ),
    )
    const f = runErc(l)
    expect(ofRule(f, 'unpowered'), summary(f)).toEqual([])
    const c = buildCircuit(l)
    const u1 = c.byId.get('U1')!
    expect(powerRails(c).get(u1.nets[CATALOG.stm32_bluepill.pins.indexOf('3V3_1')]!)?.v).toBeCloseTo(3.3, 9)
  })

  it('VS too low for the 78M05 (5 V in, 2 V dropout): a supply-range risk on +12V, in Chinese too', () => {
    const l = valid(
      layout([ps('PS1', 5), l298n()], [w('PS1:+', 'D2:+12V'), w('PS1:-', 'D2:GND')]),
    )
    const f = runErc(l)
    const drop = f.filter((x) => x.id === 'supply-range:D2:REG:dropout')
    expect(drop, summary(f)).toHaveLength(1)
    expect(drop[0].level).toBe('risk')
    expect(drop[0].message).toBe(
      'D2’s +12V pin (5.00 V regulator input) gets only 5.00 V: a 5.00 V regulator needs about 7.00 V (5.00 V + 2.00 V dropout), so its output sags to ≈ 3.00 V. Raise the input voltage.',
    )
    expect(drop[0].holes).toEqual(['D2:+12V'])
    // +5V sags but is fed: the module is not "unpowered"
    expect(unpoweredOf(l, 'D2')).toEqual([])
    __setLangForTests('zh-TW')
    try {
      expect(tMessage(drop[0].message)).toBe(
        'D2 的 +12V 腳位（5.00 V 穩壓器輸入）只得到 5.00 V：5.00 V 穩壓器需要約 7.00 V（5.00 V + 2.00 V 壓降），因此輸出會降到約 3.00 V。請提高輸入電壓。',
      )
    } finally {
      __setLangForTests('en')
    }
  })
})

describe('L298N supply: the 5V-EN jumper removed', () => {
  it('only +12V wired: +5V (the logic supply input) is not fed — an error naming that pin and both fixes', () => {
    const l = valid(runningScene({ jumper5v: false }))
    const f = unpoweredOf(l, 'D2')
    expect(f, summary(runErc(l))).toHaveLength(1)
    expect(f[0].level).toBe('error')
    expect(f[0].pins).toEqual([{ id: 'D2', pin: '+5V' }])
    expect(f[0].fact).toBe('power:D2')
    expect(f[0].message).toBe(
      'D2’s +5V pin is not connected to any supply (at D2:+5V): with the 5V-EN regulator jumper removed, the L298N dual H-bridge module needs its own 5.00 V there. ' +
        'Wire +5V to a 5.00 V supply, or fit the jumper so the on-board regulator makes it from +12V.',
    )
    __setLangForTests('zh-TW')
    try {
      expect(tMessage(f[0].message)).toBe(
        'D2 的 +5V 腳位沒有連接到任何電源：拔掉 5V-EN 穩壓器跳線帽後，L298N 雙 H 橋模組需要在這裡另外接 5.00 V。請把 +5V 接到 5.00 V 的電源，或插上跳線帽，讓板載穩壓器從 +12V 產生。',
      )
    } finally {
      __setLangForTests('en')
    }
  })

  it('+12V not wired either: the generic message lists both supply pins', () => {
    const l = valid(layout([ps('PS1', 7.5), l298n({ jumper5v: false })], [w('PS1:-', 'D2:GND')]))
    const f = unpoweredOf(l, 'D2')
    expect(f.map((x) => x.pins)).toEqual([[{ id: 'D2', pin: '+12V' }, { id: 'D2', pin: '+5V' }]])
    expect(f[0].message).toMatch(/^D2’s \+12V and \+5V pins are not connected to any supply/)
  })

  it('+5V fed from its own 5 V supply: powered', () => {
    const l = valid(
      runningScene({ jumper5v: false }, { comps: [{ ...ps('PS2', 5), pos: { x: -16, z: 34 } }], wires: [w('PS2:+', 'D2:+5V'), w('PS2:-', 'D2:GND')] }),
    )
    expect(unpoweredOf(l, 'D2'), summary(runErc(l))).toEqual([])
  })

  it('a ULN2003 on the unfed +5V is unpowered too', () => {
    const uln: ComponentInstance = { id: 'D1', type: 'uln2003_board', pos: { x: 2, z: 36 } }
    const l = valid(runningScene({ jumper5v: false }, { comps: [uln], wires: [w('D2:+5V', 'D1:VCC'), w('D2:GND', 'D1:GND')] }))
    expect(unpoweredOf(l, 'D1').map((x) => x.level)).toEqual(['error'])
  })

  it('no dropout finding: the regulator input is not connected without the jumper', () => {
    const l = valid(layout([ps('PS1', 5), l298n({ jumper5v: false }), ps('PS2', 5)], [w('PS1:+', 'D2:+12V'), w('PS1:-', 'D2:GND'), w('PS2:+', 'D2:+5V'), w('PS2:-', 'D2:GND')]))
    const f = runErc(l)
    expect(f.filter((x) => x.id.startsWith('supply-range:D2')), summary(f)).toEqual([])
    expect(unpoweredOf(l, 'D2')).toEqual([])
  })
})
