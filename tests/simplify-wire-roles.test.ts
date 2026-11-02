/**
 * Operation simplification — contract C1 (src/ui/wire-roles.ts): every wire's
 * colour follows the role of its net, so the product chrome never asks the
 * user to pick one.
 *
 *   supply (a source's +, a power pin, a + rail)        → red
 *   ground (a source's −, a ground pin, a − rail)       → black
 *   I²C SDA blue · SCL yellow · UART TX green · RX white · PWM orange
 *   other signal nets → the fixed palette in creation order (stable)
 *
 * Also: the colour follows the net (wiring a net to ground turns every wire
 * of it black), the reason names the meaning (「紅色：電源正極（5 V 網路）」),
 * the legend, and every curated example and lesson circuit gets a colour
 * for every wire with supply/ground never mixed up.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import type { CircuitLayout } from '../src/model/types'
import { LESSONS, lessonById } from '../src/lessons'
import {
  FUNCTION_COLOR,
  SIGNAL_PALETTE,
  wireRoleColors,
  wireRoleLegend,
  wireRoleMeaning,
  wireRoleOf,
} from '../src/ui/wire-roles'
import { wireColorHex, wireColorLabel } from '../src/ui/wire-colors'

afterEach(() => __setLangForTests('zh-TW'))

const ROOT = join(__dirname, '..')

/** PS1 beside the board, an LED + resistor on the strips. */
function ledCircuit(wires: { id: string; from: string; to: string; color?: string }[]): CircuitLayout {
  return {
    version: 1,
    name: 't',
    components: [
      { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
      { id: 'R1', type: 'resistor', holes: ['c10', 'c14'], params: { resistance: 330 } },
      { id: 'LED1', type: 'led', holes: ['d14', 'd18'] },
    ],
    wires,
  } as CircuitLayout
}

describe('C1 roles: supply red, ground black', () => {
  it('a source terminal decides; the rails by their marking', () => {
    const l = ledCircuit([
      { id: 'W1', from: 'PS1:+', to: 'top+0', color: 'yellow' },
      { id: 'W2', from: 'PS1:-', to: 'top-0', color: 'yellow' },
      { id: 'W3', from: 'top+5', to: 'a10' },
      { id: 'W4', from: 'a18', to: 'top-10' },
    ])
    const c = wireRoleColors(l)
    expect(c.get('W1')).toBe('red')
    expect(c.get('W2')).toBe('black')
    expect(c.get('W3')).toBe('red') // the + rail's net reaches R1's lead
    expect(c.get('W4')).toBe('black') // LED cathode → − rail
    expect(wireRoleOf(l, 'W1').role).toBe('supply')
    expect(wireRoleOf(l, 'W4').role).toBe('ground')
  })

  it('a rail marking alone (nothing powers it yet) still reads + red / − black', () => {
    const l = ledCircuit([
      { id: 'W1', from: 'bot+3', to: 'j10' },
      { id: 'W2', from: 'bot-3', to: 'j18' },
    ])
    expect(wireRoleColors(l).get('W1')).toBe('red')
    expect(wireRoleColors(l).get('W2')).toBe('black')
  })

  it('the colour follows the net: wiring a strip to ground turns its other wire black', () => {
    const before = ledCircuit([{ id: 'W1', from: 'a18', to: 'a30' }])
    expect(wireRoleOf(before, 'W1').role).toBe('signal')
    const after = ledCircuit([
      { id: 'W1', from: 'a18', to: 'a30' },
      { id: 'W2', from: 'b30', to: 'top-12' },
    ])
    expect(wireRoleColors(after).get('W1')).toBe('black')
    expect(wireRoleColors(after).get('W2')).toBe('black')
  })

  it('a power pin wins over the rail marking (a wrong rail shows as what it really is)', () => {
    const l: CircuitLayout = {
      version: 1,
      name: 't',
      components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }],
      // U1 GND3 sits on h28 (pin 19): wired to the + rail by mistake
      wires: [{ id: 'W1', from: 'j28', to: 'bot+20' }],
    } as CircuitLayout
    expect(wireRoleOf(l, 'W1').role).toBe('ground')
  })

  it('a multimeter wire is its test lead: red on IN, black on COM, whatever net it measures', () => {
    const l: CircuitLayout = {
      ...ledCircuit([
        { id: 'W1', from: 'PS1:-', to: 'top-0' },
        { id: 'W2', from: 'DMM1:IN', to: 'e14' },
        { id: 'W3', from: 'DMM1:COM', to: 'top-4' },
      ]),
    }
    l.components = [...l.components, { id: 'DMM1', type: 'multimeter', params: { mode: 'V' } }]
    const c = wireRoleColors(l)
    expect(c.get('W2')).toBe('red') // the LED anode net is a signal — the lead is still the red one
    expect(c.get('W3')).toBe('black')
    expect(wireRoleOf(l, 'W2').reason).toBe('紅色：電表表筆（DMM1 IN 端）') // 電表, the app's term (數位萬用電表)
  })

  it('the Blue Pill 3V3 / 5V / GND pins', () => {
    const l: CircuitLayout = {
      version: 1,
      name: 't',
      components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }],
      // pin 18 5V → h27, pin 20 3V3_2 → h29, pin 40 GND1 → c10
      wires: [
        { id: 'W1', from: 'j27', to: 'j40' },
        { id: 'W2', from: 'j29', to: 'j41' },
        { id: 'W3', from: 'a10', to: 'a40' },
      ],
    } as CircuitLayout
    const c = wireRoleColors(l)
    expect([c.get('W1'), c.get('W2'), c.get('W3')]).toEqual(['red', 'red', 'black'])
    expect(wireRoleMeaning(l, 'W1')).toBe('電源正極（5 V 網路）')
    expect(wireRoleMeaning(l, 'W2')).toBe('電源正極（3.3 V 網路）')
  })
})

describe('C1 signals: by function, else a stable palette', () => {
  it('generic signal nets take the palette in creation order — a new wire never recolours an older net', () => {
    const one = ledCircuit([{ id: 'W1', from: 'a14', to: 'a40' }])
    expect(wireRoleColors(one).get('W1')).toBe(SIGNAL_PALETTE[0])
    const two = ledCircuit([
      { id: 'W1', from: 'a14', to: 'a40' },
      { id: 'W2', from: 'a10', to: 'a45' },
    ])
    expect(wireRoleColors(two).get('W1')).toBe(SIGNAL_PALETTE[0])
    expect(wireRoleColors(two).get('W2')).toBe(SIGNAL_PALETTE[1])
    // a second wire on W1's net keeps the net's colour
    const three = ledCircuit([
      { id: 'W1', from: 'a14', to: 'a40' },
      { id: 'W2', from: 'a10', to: 'a45' },
      { id: 'W3', from: 'b40', to: 'b50' },
    ])
    expect(wireRoleColors(three).get('W3')).toBe(SIGNAL_PALETTE[0])
    expect(wireRoleColors(three).get('W2')).toBe(SIGNAL_PALETTE[1])
  })

  it('the palette never uses the role colours', () => {
    expect(SIGNAL_PALETTE).not.toContain('red')
    expect(SIGNAL_PALETTE).not.toContain('black')
  })

  it('…nor a function colour: one colour keeps one meaning on every board (verifier: yellow GPIO read as I²C SCL)', () => {
    for (const c of Object.values(FUNCTION_COLOR)) expect(SIGNAL_PALETTE, c).not.toContain(c)
    expect(new Set(SIGNAL_PALETTE).size).toBe(SIGNAL_PALETTE.length)
    expect(SIGNAL_PALETTE.length).toBeGreaterThanOrEqual(5)
    // the blink circuit's GPIO line: a plain-signal colour, not I²C SCL yellow
    const blink: CircuitLayout = JSON.parse(readFileSync(join(ROOT, 'examples/embedded/blink.ohmlet.json'), 'utf8')).layout
    const gpio = blink.wires.find((w) => /：訊號（U1 PA5）$/.test(wireRoleOf(blink, w.id).reason))!
    expect(gpio).toBeTruthy()
    expect(wireRoleOf(blink, gpio.id)).toMatchObject({ color: 'purple', reason: '紫色：訊號（U1 PA5）' })
  })

  it('I²C SDA blue / SCL yellow, UART TX green / RX white, PWM orange (the example circuits)', () => {
    const project = (name: string): CircuitLayout => JSON.parse(readFileSync(join(ROOT, 'examples/embedded', name), 'utf8')).layout
    const byFn = (l: CircuitLayout) => {
      const out: Record<string, string[]> = {}
      for (const w of l.wires) {
        const r = wireRoleOf(l, w.id)
        ;(out[r.color] ??= []).push(w.id)
      }
      return out
    }
    const i2c = project('i2c-scan.ohmlet.json')
    const colors = wireRoleColors(i2c)
    expect([...colors.values()]).toContain(FUNCTION_COLOR['i2c-sda'])
    expect([...colors.values()]).toContain(FUNCTION_COLOR['i2c-scl'])
    for (const w of i2c.wires) {
      const r = wireRoleOf(i2c, w.id)
      if (r.color === 'blue') expect(r.reason).toMatch(/^藍色：I²C 資料線 SDA/)
      if (r.color === 'yellow' && r.reason.includes('I²C')) expect(r.reason).toMatch(/^黃色：I²C 時脈線 SCL/)
    }
    const servo = project('servo-sg90.ohmlet.json')
    expect(Object.keys(byFn(servo))).toContain('orange')
    const hc05 = project('hc05-bluetooth.ohmlet.json')
    const uart = byFn(hc05)
    expect(Object.keys(uart)).toEqual(expect.arrayContaining(['green', 'white']))
    const tx = hc05.wires.filter((w) => wireRoleOf(hc05, w.id).color === 'green')
    expect(tx.length).toBeGreaterThan(0)
    // green means the MCU's UART TX here and nothing else: a function colour is kept for its function
    for (const w of tx) expect(wireRoleOf(hc05, w.id).reason).toMatch(/^綠色：UART 傳送線（U1 PA\d+ → BT1 RXD）$/)
    for (const w of hc05.wires.filter((x) => wireRoleOf(hc05, x.id).color === 'white')) {
      expect(wireRoleOf(hc05, w.id).reason).toMatch(/^白色：UART 接收線/)
    }
    // …and the PWM orange of the servo circuit is never a plain signal there
    for (const w of servo.wires.filter((x) => wireRoleOf(servo, x.id).color === 'orange')) {
      expect(wireRoleOf(servo, w.id).reason).toMatch(/^橘色：PWM 控制訊號/)
    }
  })
})

describe('C1 words', () => {
  it('the reason is 「<colour>：<meaning>」 in the colour the board shows', () => {
    const l = ledCircuit([
      { id: 'W1', from: 'PS1:+', to: 'top+0' },
      { id: 'W2', from: 'PS1:-', to: 'top-0' },
      { id: 'W3', from: 'a14', to: 'a40' },
    ])
    expect(wireRoleOf(l, 'W1').reason).toBe('紅色：電源正極（5 V 網路）')
    expect(wireRoleOf(l, 'W2').reason).toBe('黑色：接地（PS1 負端）')
    expect(wireRoleOf(l, 'W3').reason).toBe(`${wireColorLabel(SIGNAL_PALETTE[0])}：訊號（R1 第 2 腳）`)
    __setLangForTests('en')
    expect(wireRoleOf(l, 'W1').reason).toBe('red: supply positive (5 V net)')
  })

  it('the legend', () => {
    expect(wireRoleLegend()).toBe('紅＝電源正　黑＝地　其他顏色＝訊號')
  })

  it('every colour a role can take has a UI tone and a zh-TW name (swatch = the wire on the board)', () => {
    for (const c of ['red', 'black', ...Object.values(FUNCTION_COLOR), ...SIGNAL_PALETTE]) {
      expect(wireColorHex(c), c).toMatch(/^#[0-9a-f]{6}$/)
      expect(wireColorLabel(c), c).toMatch(/色$/)
    }
  })
})

describe('C1 over every curated circuit', () => {
  const circuits: [string, CircuitLayout][] = []
  for (const f of readdirSync(join(ROOT, 'examples/embedded')).filter((n) => n.endsWith('.ohmlet.json'))) {
    circuits.push([f, JSON.parse(readFileSync(join(ROOT, 'examples/embedded', f), 'utf8')).layout])
  }
  for (const f of readdirSync(join(ROOT, 'examples')).filter((n) => n.endsWith('.json'))) {
    circuits.push([f, JSON.parse(readFileSync(join(ROOT, 'examples', f), 'utf8'))])
  }
  for (const lesson of LESSONS) {
    circuits.push([`${lesson.id}/start`, lesson.start.layout], [`${lesson.id}/solution`, lesson.solution.layout])
  }

  it('every wire gets a colour; the source terminals are never mixed up', () => {
    expect(circuits.length).toBeGreaterThan(60)
    for (const [name, l] of circuits) {
      const colors = wireRoleColors(l)
      for (const w of l.wires) {
        expect(colors.get(w.id), `${name} ${w.id}`).toBeTruthy()
        for (const end of [w.from, w.to]) {
          // a wire on a bench supply's / battery's terminal is that terminal's role
          if (/^(PS|BAT)\d+:\+$/.test(end)) expect(colors.get(w.id), `${name} ${w.id}`).toBe('red')
          if (/^(PS|BAT)\d+:-$/.test(end)) expect(colors.get(w.id), `${name} ${w.id}`).toBe('black')
        }
      }
    }
  })

  it('one colour, one meaning over every curated circuit (the user guide’s colour table holds on every board)', () => {
    const FN_WORDS: Record<keyof typeof FUNCTION_COLOR, RegExp> = {
      'i2c-sda': /^藍色：I²C 資料線 SDA/,
      'i2c-scl': /^黃色：I²C 時脈線 SCL/,
      'uart-tx': /^綠色：UART 傳送線/,
      'uart-rx': /^白色：UART 接收線/,
      pwm: /^橘色：PWM 控制訊號/,
    }
    const wrong: string[] = []
    let plain = 0
    for (const [name, l] of circuits) {
      for (const w of l.wires) {
        const r = wireRoleOf(l, w.id)
        const where = `${name} ${w.id} 「${r.reason}」`
        const fn = (Object.keys(FUNCTION_COLOR) as (keyof typeof FUNCTION_COLOR)[]).find((k) => FUNCTION_COLOR[k] === r.color)
        if (fn && !FN_WORDS[fn].test(r.reason)) wrong.push(`${where}: ${r.color} is kept for ${fn}`)
        if (/：訊號(（|$)/.test(r.reason)) {
          plain++
          if (!SIGNAL_PALETTE.includes(r.color)) wrong.push(`${where}: a plain signal outside the palette`)
        }
        if (r.color === 'red' && !/^紅色：(電源正極|電表表筆)/.test(r.reason)) wrong.push(`${where}: red means supply + (or a meter's IN lead)`)
        if (r.color === 'black' && !/^黑色：(接地|電表表筆)/.test(r.reason)) wrong.push(`${where}: black means ground (or a meter's COM lead)`)
      }
    }
    expect(plain).toBeGreaterThan(50)
    expect(wrong, wrong.join(' | ')).toEqual([])
  })

  it('the hand-picked colours of the curated circuits agree on supply / ground', () => {
    // where the authors coloured a wire red or black, the role agrees (a measure that the rules read
    // circuits the way people wire them); report the disagreements for review
    let agree = 0
    const disagree: string[] = []
    for (const [name, l] of circuits) {
      for (const w of l.wires) {
        if (w.color !== 'red' && w.color !== 'black') continue
        const got = wireRoleColors(l).get(w.id)
        if (got === w.color) agree++
        else disagree.push(`${name} ${w.id} ${w.from}→${w.to}: authored ${w.color}, role ${got} (${wireRoleOf(l, w.id).reason})`)
      }
    }
    expect(agree).toBeGreaterThan(100)
    expect(disagree.length / (agree + disagree.length), disagree.join('\n')).toBeLessThan(0.1)
  })
})

describe('F16: a line takes its function from the MCU pin, and keeps it across a level shifter', () => {
  const project = (name: string): CircuitLayout => JSON.parse(readFileSync(join(ROOT, 'examples/embedded', name), 'utf8')).layout
  /** U1 at h10: PA9 h15 (free j15), PA10 h16 (j16), PB7 h24 (j24), PB10 c15 (a15), PA8 h14 (j14), PA2 c23 (a23), PA3 c22 (a22). */
  const bp = (wires: CircuitLayout['wires'], extra: CircuitLayout['components'] = []): CircuitLayout =>
    ({ version: 1, name: 't', components: [{ id: 'U1', type: 'stm32_bluepill', at: 'h10' }, ...extra], wires }) as CircuitLayout

  it('hc05: the RX line is one white line on both sides of LS1 (it was orange on the MCU side)', () => {
    const l = project('hc05-bluetooth.ohmlet.json')
    // W11 BT1 TXD → LS1 HV2, W13 LS1 LV2 → U1 PA3 (USART2_RX)
    const mod = wireRoleOf(l, 'W11')
    const mcu = wireRoleOf(l, 'W13')
    expect(mcu.color).toBe(FUNCTION_COLOR['uart-rx'])
    expect(mod.color).toBe(mcu.color)
    expect(mcu.reason).toBe('白色：UART 接收線（BT1 TXD → U1 PA3，經 LS1 準位轉換）')
    expect(mod.reason).toBe(mcu.reason)
    // the STATE line through channel 1 is one line too: one colour, one reason
    expect(wireRoleOf(l, 'W10').color).toBe(wireRoleOf(l, 'W12').color)
    expect(wireRoleOf(l, 'W10').reason).toBe(wireRoleOf(l, 'W12').reason)
    expect(wireRoleOf(l, 'W12').reason).toMatch(/經 LS1 準位轉換）$/)
    __setLangForTests('en')
    expect(wireRoleOf(l, 'W13').reason).toBe('white: UART line the MCU receives on (BT1 TXD → U1 PA3, via LS1)')
  })

  it('without a module peer: the MCU pin’s only bus function names the line', () => {
    const l = bp([
      { id: 'W1', from: 'j15', to: 'j40' }, // PA9 = USART1_TX
      { id: 'W2', from: 'j16', to: 'j45' }, // PA10 = USART1_RX
      { id: 'W3', from: 'j24', to: 'j50' }, // PB7 = I2C1_SDA (USART1_RX is a remap)
    ])
    expect(wireRoleOf(l, 'W1')).toMatchObject({ color: 'green', reason: '綠色：UART 傳送線（U1 PA9）' })
    expect(wireRoleOf(l, 'W2')).toMatchObject({ color: 'white', reason: '白色：UART 接收線（U1 PA10）' })
    expect(wireRoleOf(l, 'W3')).toMatchObject({ color: 'blue', reason: '藍色：I²C 資料線 SDA（U1 PB7）' })
  })

  it('…but never a guess: two bus functions (PB10 I2C2_SCL / USART3_TX) or a timer channel (PA8) stay plain signals', () => {
    const l = bp([
      { id: 'W1', from: 'a15', to: 'a40' }, // PB10
      { id: 'W2', from: 'j14', to: 'j45' }, // PA8 = TIM1_CH1: a timer channel is not a configured PWM
    ])
    expect(wireRoleOf(l, 'W1').reason).toBe(`${wireColorLabel(SIGNAL_PALETTE[0])}：訊號（U1 PB10）`)
    expect(wireRoleOf(l, 'W2').color).not.toBe(FUNCTION_COLOR.pwm)
    expect(wireRoleOf(l, 'W2').reason).toMatch(/：訊號（U1 PA8）$/)
  })

  it('…and never when something else is on the line: an LED’s resistor on PA2 is a GPIO line', () => {
    const traffic = project('traffic-light.ohmlet.json')
    for (const w of traffic.wires) expect(wireRoleOf(traffic, w.id).reason, w.id).not.toMatch(/UART|I²C/)
    const l = bp([{ id: 'W1', from: 'a23', to: 'a40' }], [{ id: 'R1', type: 'resistor', holes: ['b40', 'b44'], params: { resistance: 330 } }])
    expect(wireRoleOf(l, 'W1').reason).toMatch(/：訊號（U1 PA2）$/)
  })

  it('an instrument only observes: a logic probe on a UART line keeps its colour', () => {
    const wires = [{ id: 'W1', from: 'j15', to: 'j40' }]
    const bare = bp(wires)
    const probed = bp(wires, [{ id: 'LA1', type: 'logic_probe', holes: ['f40'] }])
    expect(wireRoleOf(probed, 'W1')).toEqual(wireRoleOf(bare, 'W1'))
    expect(wireRoleOf(probed, 'W1').color).toBe('green')
  })

  it('a UART pin that does not name its direction (MAX485 DI / RO) reads it from the MCU pin', () => {
    const l = project('rs485-link.ohmlet.json')
    const byFn = (id: string) => wireRoleOf(l, id)
    expect(byFn('W10')).toMatchObject({ color: 'green', reason: '綠色：UART 傳送線（U1 PA9 → M1 DI）' })
    expect(byFn('W7')).toMatchObject({ color: 'white', reason: '白色：UART 接收線（M1 RO → U1 PA10）' })
    // PB10 / PB11 carry I²C2 too — the MAX485 on the line makes them UART3
    expect(byFn('W16').reason).toBe('綠色：UART 傳送線（U1 PB10 → M2 DI）')
    expect(byFn('W13').reason).toBe('白色：UART 接收線（M2 RO → U1 PB11）')
  })

  it('a loopback between two USARTs is the TX pin’s line (a3)', () => {
    const l = lessonById('a3-uart-dma')!.solution.layout
    expect(wireRoleOf(l, 'W7')).toMatchObject({ color: 'green', reason: '綠色：UART 傳送線（U1 PA2 → U1 PA10）' })
  })

  it('a channel never carries a supply or a ground across: only two signal nets become one line', () => {
    // LS1 at g40: LV1 g40 ↔ HV1 d40. LV1's strip goes to the − rail (ground), HV1's to U1 PA9
    const l = bp(
      [
        { id: 'W1', from: 'j40', to: 'bot-30' },
        { id: 'W2', from: 'a40', to: 'j15' },
      ],
      [{ id: 'LS1', type: 'level_shifter_4ch', at: 'g40' }],
    )
    expect(wireRoleOf(l, 'W1').color).toBe('black')
    expect(wireRoleOf(l, 'W2')).toMatchObject({ color: 'green', reason: '綠色：UART 傳送線（U1 PA9）' })
  })
})
