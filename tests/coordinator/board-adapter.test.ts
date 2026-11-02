/**
 * MCU board chip adapter (src/sim/coordinator/mcu-board.ts) in a real
 * coordinator world with a FAKE McuDevice whose pin drives the test sets:
 * GPIO stage drives through the board rails, Schmitt inputs, power
 * supervision (POR / brown-out), NRST, electrical warnings, telemetry, hot
 * rewire, UART taps, debugger halt.
 */
import { describe, expect, it } from 'vitest'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import type { CircuitLayout, SimIssue } from '../../src/model/types'
import {
  PIN_IN_FLOAT,
  PIN_IN_PULLUP,
  PIN_OUT_PP,
} from '../../src/mcu/pins'
import { FakeMcu } from './fake-mcu'
import { bluePillWorld, part, PA0, PA1, PA5, PB6, PC13, tap, w } from './worlds'
import { NET_DRIVEN } from '../../src/sim/digital/nets'
import type { WorldOptions } from './worlds'

function make(layout: CircuitLayout, setup: (f: FakeMcu) => void = () => {}, missingModel = false) {
  const fakes: FakeMcu[] = []
  const co = new SimulationCoordinator({
    createMcu: () => {
      if (missingModel) return null
      const f = new FakeMcu()
      setup(f)
      fakes.push(f)
      return f
    },
  })
  co.load(layout, 1)
  return { co, fake: () => fakes[fakes.length - 1], fakes }
}

const msgs = (issues: SimIssue[]) => issues.map((i) => i.message)

/** PA5 → 330 Ω → red LED → GND. */
function ledLayout(opts?: WorldOptions): CircuitLayout {
  return bluePillWorld(
    [
      part('R1', 'resistor', ['a45', 'a50'], { resistance: 330 }),
      part('D1', 'led', ['b50', 'top-5'], { color: 'red' }),
    ],
    [w(tap('PA5'), 'e45')],
    opts,
  )
}

/** pushbutton SW1 at f40: A side (col 40) wired to `pin`, B side (col 42) to GND. */
function buttonLayout(pin: string): CircuitLayout {
  return bluePillWorld([{ id: 'SW1', type: 'pushbutton', at: 'f40' }], [w(tap(pin), 'd40'), w('d42', 'top-6')])
}

describe('GPIO output stage', () => {
  it('push-pull high through 330 Ω lights a red LED with I ≈ (VDD − Vf)/(330 + 50)', () => {
    const { co } = make(ledLayout(), (f) => (f.pins.drives[PA5] = { mode: PIN_OUT_PP, level: 1, af: false }))
    // past the power-up: an LED's current is its mean over the eye window (devices.ts LED_EYE_S = 20 ms)
    co.advance(0.03)
    const t = co.telemetry()
    const led = t.components.D1
    const vf = led.pinVoltages.anode - led.pinVoltages.cathode
    const vdd = t.components.U1.pinVoltages['3V3_1'] - t.components.U1.pinVoltages.GND1
    const expected = (vdd - vf) / (330 + 50)
    expect(vdd).toBeCloseTo(3.3, 2)
    expect(led.current!).toBeGreaterThan(0.003)
    expect(Math.abs(led.current! - expected) / expected).toBeLessThan(0.01)
    expect(led.ledBrightness).toBeGreaterThan(0.3)
    // the GPIO current is drawn FROM the board's 3V3 net: the regulator supplies
    // the LED plus the power LED (KCL through the stage drive, not a ground Norton)
    const reg = t.components.U1.sub!.REG
    const pwr = t.components.U1.sub!.LED_PWR
    expect(reg.current!).toBeCloseTo(led.current! + pwr.current!, 5)
  })

  it('push-pull low and released (input) leave the LED dark', () => {
    const { co, fake } = make(ledLayout(), (f) => (f.pins.drives[PA5] = { mode: PIN_OUT_PP, level: 0, af: false }))
    co.advance(0.001)
    expect(co.telemetry().components.D1.ledBrightness).toBe(0)
    fake().setDrive(PA5, PIN_IN_FLOAT)
    co.advance(0.001)
    expect(co.telemetry().components.D1.ledBrightness).toBe(0)
    fake().setDrive(PA5, PIN_OUT_PP, 1)
    co.advance(0.001)
    expect(co.telemetry().components.D1.ledBrightness).toBeGreaterThan(0.3)
  })

  it('PC13 drives the on-board LED active-low through its 510 Ω (sub-circuit)', () => {
    const { co, fake } = make(bluePillWorld(), (f) => (f.pins.drives[PC13] = { mode: PIN_OUT_PP, level: 0, af: false }))
    co.advance(0.001)
    const sub = co.telemetry().components.U1.sub!
    expect(sub.LED_PC13.ledBrightness).toBeGreaterThan(0.1)
    expect(sub.LED_PWR.ledBrightness).toBeGreaterThan(0.1)
    fake().setDrive(PC13, PIN_OUT_PP, 1)
    co.advance(0.001)
    expect(co.telemetry().components.U1.sub!.LED_PC13.ledBrightness).toBeLessThan(1e-6)
  })

  it('a push-pull high pin shorted to GND reports driver overcurrent', () => {
    const layout = bluePillWorld([], [w(tap('PA5'), 'top-7')])
    const { co } = make(layout, (f) => (f.pins.drives[PA5] = { mode: PIN_OUT_PP, level: 1, af: false }))
    co.advance(0.001)
    const m = msgs(co.issues()).find((s) => s.includes('PA5') && s.includes('driver sources'))
    expect(m).toBeDefined()
    expect(m).toMatch(/6\d\.\d mA \(> 25 mA\)/) // ≈ 3.3 V / 50 Ω
  })
})

describe('GPIO inputs', () => {
  it('input pull-up + button to GND: released → 1 (≈VDD), pressed → 0', () => {
    const { co, fake } = make(buttonLayout('PA0'), (f) => (f.pins.drives[PA0] = { mode: PIN_IN_PULLUP, level: 0, af: false }))
    co.advance(0.001)
    expect(fake().pins.lastInput[PA0]).toBe(1)
    expect(fake().pins.lastVolts[PA0]).toBeCloseTo(3.3, 2)
    co.setRuntimeParam('SW1', 'pressed', true)
    co.advance(0.0002)
    expect(fake().pins.lastInput[PA0]).toBe(0)
    expect(fake().pins.lastVolts[PA0]).toBeLessThan(0.01)
    co.setRuntimeParam('SW1', 'pressed', false)
    co.advance(0.0002)
    expect(fake().pins.lastInput[PA0]).toBe(1)
    // no floating-input warning: the pull-up drives the net
    co.advance(0.2)
    expect(msgs(co.issues()).some((s) => s.includes('floating input'))).toBe(false)
  })

  it('logic-net inputs reach the MCU after power-up without any edge (PA12 on-board pull-up)', () => {
    const { co, fake } = make(bluePillWorld())
    co.advance(0.001)
    expect(fake().pins.lastInput[12]).toBe(1)
    expect(fake().pins.lastVolts[12]).toBeCloseTo(3.3, 2)
  })

  it('a pull-up configured before power-up (model sends no edge) still reaches the logic layer', () => {
    const { co, fake } = make(bluePillWorld(), (f) => (f.pins.drives[PB6] = { mode: PIN_IN_PULLUP, level: 0, af: false }))
    co.advance(0.001)
    const node = co.engine!.nodeOf(tap('PB6'))
    expect(co.logicNets!.state(node)).toBe(NET_DRIVEN)
    expect(co.logicNets!.voltage(node)).toBeCloseTo(3.3, 2)
    expect(fake().pins.lastInput[PB6]).toBe(1)
  })

  it('applies VIL/VIH hysteresis (DS5319: 0.28·(VDD−2)+0.8 / 0.41·(VDD−2)+1.3)', () => {
    // PA0 driven by a DC source through 1 kΩ (function generator, amplitude 0)
    const layout = bluePillWorld(
      [
        { id: 'FG1', type: 'function_generator', params: { waveform: 'square', frequency: 1, amplitude: 0, offset: 0 } },
        part('R1', 'resistor', ['a45', 'a50'], { resistance: 1000 }),
      ],
      [w('FG1:out', 'b45'), w('FG1:gnd', 'top-8'), w(tap('PA0'), 'b50')],
    )
    const { co, fake } = make(layout, (f) => (f.pins.drives[PA0] = { mode: PIN_IN_FLOAT, level: 0, af: false }))
    const set = (v: number) => {
      co.setRuntimeParam('FG1', 'offset', v)
      co.advance(0.0002)
      return fake().pins.lastInput[PA0]
    }
    // VDD ≈ 3.3 V → VIL ≈ 1.164 V, VIH ≈ 1.833 V
    expect(set(0)).toBe(0)
    expect(set(1.5)).toBe(0) // inside the hysteresis band: stays low
    expect(set(1.9)).toBe(1)
    expect(set(1.5)).toBe(1) // stays high
    expect(set(1.1)).toBe(0)
    expect(fake().pins.lastVolts[PA0]).toBeCloseTo(1.1, 3)
  })

  it('reports a connected floating input (button without pull) after 100 ms of running', () => {
    const { co } = make(buttonLayout('PA1'), (f) => (f.pins.drives[PA1] = { mode: PIN_IN_FLOAT, level: 0, af: false }))
    co.advance(0.05)
    expect(msgs(co.issues()).some((s) => s.includes('PA1') && s.includes('floating input'))).toBe(false)
    co.advance(0.1)
    expect(msgs(co.issues()).some((s) => s.includes('U1 PA1: floating input'))).toBe(true)
    // unconnected pins (every GPIO is a floating input out of reset) never warn
    expect(msgs(co.issues()).filter((s) => s.includes('floating input')).length).toBe(1)
  })

  it('no floating-input warning while the button holds the net at GND', () => {
    const { co } = make(buttonLayout('PA1'), (f) => (f.pins.drives[PA1] = { mode: PIN_IN_FLOAT, level: 0, af: false }))
    co.setRuntimeParam('SW1', 'pressed', true)
    co.advance(0.3)
    expect(msgs(co.issues()).some((s) => s.includes('floating input'))).toBe(false)
  })
})

describe('electrical limits', () => {
  it('5 V on a non-FT pin warns; 5 V on an FT pin does not', () => {
    const layout = bluePillWorld([], [w('PS1:+', 'top+0'), w(tap('PA0'), 'top+1'), w(tap('PA9'), 'top+2')])
    const { co } = make(layout)
    co.advance(0.001)
    const m = msgs(co.issues())
    expect(m).toContain('U1 PA0: 5.00 V exceeds VDD + 0.3 V (3.60 V) — PA0 is not 5 V tolerant')
    expect(m.some((s) => s.includes('PA9'))).toBe(false)
  })

  it('works without an MCU model too (overvoltage is board electrics)', () => {
    const layout = bluePillWorld([], [w('PS1:+', 'top+0'), w(tap('PA1'), 'top+1')])
    const { co } = make(layout, undefined, true)
    co.advance(0.001)
    expect(msgs(co.issues())).toContain('U1 PA1: 5.00 V exceeds VDD + 0.3 V (3.60 V) — PA1 is not 5 V tolerant')
  })
})

describe('power supervision', () => {
  it('on-board LDO: 5 V in → 3.30 V out; supply into 3V3 directly also works', () => {
    const { co } = make(bluePillWorld())
    co.advance(0.001)
    const u1 = co.telemetry().components.U1
    expect(u1.pinVoltages['3V3_1']).toBeCloseTo(3.3, 3)
    expect(u1.sub!.REG.values!.vout).toBeCloseTo(3.3, 3)
    const { co: co2, fake } = make(bluePillWorld([], [], { via3v3: true, supply: 3.3 }))
    co2.advance(0.001)
    expect(co2.telemetry().components.U1.pinVoltages['3V3_1']).toBeCloseTo(3.3, 2)
    expect(fake().powered).toBe(true)
  })

  it('powers the MCU at POR, holds it through brown-out, re-powers on recovery', () => {
    const { co, fake } = make(ledLayout(), (f) => (f.pins.drives[PA5] = { mode: PIN_OUT_PP, level: 1, af: false }))
    co.advance(0.001)
    expect(fake().powered).toBe(true)
    expect(fake().powerOnCount).toBe(1)
    expect(co.telemetry().components.D1.ledBrightness).toBeGreaterThan(0.3)
    // 2.0 V in → LDO dropout → ≈ 1.75 V < 1.8 V PDR
    co.setRuntimeParam('PS1', 'voltage', 2.0)
    co.advance(0.001)
    const u1 = co.telemetry().components.U1
    expect(u1.pinVoltages['3V3_1']).toBeLessThan(1.8)
    expect(fake().powered).toBe(false)
    expect(u1.mcu!.state).toBe('unpowered')
    expect(co.telemetry().components.D1.ledBrightness).toBe(0) // pins released
    // 2.2 V in → ≈ 1.95 V: inside the POR/PDR hysteresis, still off
    co.setRuntimeParam('PS1', 'voltage', 2.2)
    co.advance(0.001)
    expect(fake().powered).toBe(false)
    co.setRuntimeParam('PS1', 'voltage', 5)
    co.advance(0.001)
    expect(fake().powered).toBe(true)
    expect(fake().powerOnCount).toBe(2)
    expect(co.telemetry().components.D1.ledBrightness).toBeGreaterThan(0.3)
    const log = co.frame().log.map((e) => e.message)
    expect(log.some((m) => m.includes('brown-out'))).toBe(true)
    expect(log.filter((m) => m.includes('power-on reset')).length).toBe(2)
  })

  it('reports an unpowered MCU (no supply on the board)', () => {
    const layout: CircuitLayout = bluePillWorld()
    layout.wires = layout.wires.filter((x) => x.from !== 'PS1:+')
    const { co, fake } = make(layout)
    co.advance(0.001)
    expect(fake().powered).toBe(false)
    expect(msgs(co.issues()).some((s) => s.startsWith('U1: MCU unpowered'))).toBe(true)
  })

  it('NRST: internal pull-up keeps it released; a button to GND holds the MCU in reset', () => {
    const { co, fake } = make(buttonLayout('NRST'))
    co.advance(0.001)
    expect(fake().resetHeld).toBe(false)
    expect(co.telemetry().components.U1.pinVoltages.NRST).toBeCloseTo(3.3, 2)
    co.setRuntimeParam('SW1', 'pressed', true)
    co.advance(0.0002)
    expect(fake().resetHeld).toBe(true)
    expect(co.telemetry().components.U1.mcu!.state).toBe('reset')
    co.setRuntimeParam('SW1', 'pressed', false)
    co.advance(0.0002)
    expect(fake().resetHeld).toBe(false)
  })

  it('BOOT0 = 1 on a model without boot straps holds the MCU in reset, explicitly', () => {
    const layout = bluePillWorld()
    layout.components[1] = { ...layout.components[1], params: { boot0: '1' } }
    const { co, fake } = make(layout)
    co.advance(0.001)
    expect(fake().resetHeld).toBe(true)
    expect(msgs(co.issues()).some((s) => s.includes('BOOT0 = 1') && s.includes('not emulated'))).toBe(true)
  })
})

describe('status, telemetry, hot rewire', () => {
  it('no firmware: board works electrically and says so', () => {
    const { co } = make(ledLayout(), (f) => (f.firmware = null))
    co.advance(0.001)
    const u1 = co.telemetry().components.U1
    expect(u1.mcu!.state).toBe('no-firmware')
    expect(u1.sub!.LED_PWR.ledBrightness).toBeGreaterThan(0.1)
    expect(msgs(co.issues()).some((s) => s.startsWith('U1: no firmware loaded'))).toBe(true)
  })

  it('no MCU model registered: regulator + LEDs still work, pure-analog stepping', () => {
    const { co } = make(ledLayout(), undefined, true)
    co.advance(0.001)
    const u1 = co.telemetry().components.U1
    expect(co.mcu('U1')).toBeNull()
    expect(u1.mcu!.state).toBe('no-firmware')
    expect(u1.pinVoltages['3V3_1']).toBeCloseTo(3.3, 3)
    expect(u1.sub!.LED_PWR.ledBrightness).toBeGreaterThan(0.1)
    expect(msgs(co.issues())).toContain(
      'U1: MCU model "stm32f103c8" is not available in this build — board simulated electrically only',
    )
    expect(co.stepCount).toBe(20) // fixed DEFAULT_DT steps
  })

  it('publishes McuTelemetry with a mode tag for every catalog pin', () => {
    const { co } = make(ledLayout(), (f) => {
      f.pins.drives[PA5] = { mode: PIN_OUT_PP, level: 1, af: false }
      f.pins.drives[PA0] = { mode: PIN_IN_PULLUP, level: 0, af: false }
    })
    co.advance(0.001)
    const mcu = co.telemetry().components.U1.mcu!
    expect(mcu.state).toBe('running')
    expect(mcu.hclkHz).toBe(8e6)
    expect(mcu.cycles).toBe(8000)
    const modes = mcu.pinModes!
    expect(Object.keys(modes).length).toBe(40)
    expect(modes.PA5).toBe('out')
    expect(modes.PA0).toBe('in↑')
    expect(modes.PB6).toBe('in')
    expect(modes['5V']).toBe('pwr')
    expect(modes.GND1).toBe('gnd')
    expect(modes.NRST).toBe('rst')
  })

  it('hot rewire keeps the running MCU; a firmware change resets only that MCU', () => {
    const { co, fakes } = make(ledLayout(), (f) => (f.pins.drives[PA5] = { mode: PIN_OUT_PP, level: 1, af: false }))
    co.advance(0.002)
    const m1 = co.mcu('U1')
    const layout2 = ledLayout()
    layout2.components.push(part('R9', 'resistor', ['a55', 'a58'], { resistance: 1000 }))
    co.load(layout2, 2)
    expect(co.mcu('U1')).toBe(m1)
    co.advance(0.001)
    expect(fakes.length).toBe(1)
    expect(fakes[0].powerOnCount).toBe(1) // no power cycle
    expect(fakes[0].cycles).toBe(24000) // its clock kept running
    expect(co.telemetry().components.D1.ledBrightness).toBeGreaterThan(0.3)
    co.setFirmware('U1', { ...fakes[0].firmware!, name: 'other.elf', sha256: '1'.repeat(64) })
    expect(co.mcu('U1')).toBe(m1)
    expect(fakes[0].resets).toEqual(['power-on'])
    // removing the board retires the MCU; adding it back starts a fresh one
    co.load({ ...layout2, components: layout2.components.filter((c) => c.id !== 'U1') }, 3)
    expect(co.mcu('U1')).toBeNull()
    co.load(layout2, 4)
    expect(co.mcu('U1')).not.toBe(m1)
    expect(fakes.length).toBe(2)
    // a fresh MCU joining a running world starts at the current time
    expect(fakes[1].time()).toBeGreaterThanOrEqual(co.time - 1 / 8e6)
  })

  it('routes UART taps both ways and forwards MCU log events', () => {
    const { co, fake } = make(bluePillWorld(), (f) => {
      f.uartScript.push([4000, 0x48], [4100, 0x69])
    })
    co.advance(0.001)
    const f = co.frame()
    expect(f.uart).toEqual([{ componentId: 'U1', port: 'USART1', bytes: [0x48, 0x69] }])
    expect(f.mcus[0].uarts[0].name).toBe('USART1')
    expect(co.frame().uart).toEqual([]) // drained
    // host → MCU (close-out UART-RX): the terminal's USB-TTL adapter puts the bytes on the
    // USART1 RX pin PA10 as UART frames — never into the tap (tests/close-sim-uart-rx.test.ts)
    co.uartSend('U1', 'USART1', new Uint8Array([1, 2, 3]))
    co.advance(0.001)
    expect(fake().uarts[0].received).toEqual([])
    expect(fake().pins.inputs.filter((e) => e.pin === 10 && e.level === 0).length).toBeGreaterThanOrEqual(3)
    fake().pushLog('hello')
    const log = co.frame().log
    expect(log.some((e) => e.source === 'U1/fake' && e.message === 'hello' && e.componentId === 'U1')).toBe(true)
  })

  it('a debugger halt pauses the whole world until resume', () => {
    const { co } = make(bluePillWorld())
    co.advance(0.001)
    co.mcuHalt('U1')
    expect(co.halted).toBe('U1')
    const t = co.time
    co.advance(0.001)
    expect(co.time).toBe(t)
    co.mcuResume('U1')
    co.advance(0.001)
    expect(co.time).toBeCloseTo(t + 0.001, 12)
  })
})
