/**
 * Motors & drivers with REAL firmware (firmware/projects/hal-dc-motor,
 * hal-tb6612, hal-sg90, hal-stepper-a4988, hal-stepper-uln2003; clang + ST
 * HAL) on the simulated Blue Pill through the SimulationCoordinator. Every
 * circuit is wired like a user would: the Blue Pill on the breadboard
 * powered from a 5 V bench supply, the driver module / carrier and the motor
 * connected with wires to its terminals or breadboard holes, motor supplies
 * from their own bench supply with a common ground. Assertions read the
 * firmware's UART log (the phase it is in) and the motor / driver telemetry
 * the electrical models produce:
 *  - L298N: speed rises with the ENA duty, at 100 % the motor runs at the
 *    speed of VS minus the Darlington drops, brake stops it fast, reverse
 *    reverses, coast decays slowly;
 *  - TB6612FNG: drive / short-brake PWM makes the speed linear in the duty;
 *  - SG90: the horn follows the 0.5–2.5 ms pulses at ≈ 0.1 s/60°;
 *  - A4988 + NEMA 17: the position after N pulses × microstep, the cruise speed;
 *  - ULN2003 + 28BYJ-48: one output quarter turn after 1024 half steps;
 * and the wrong-wiring symptoms (no servo signal, swapped stepper leads).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadFirmwareFile } from '../../src/mcu/loader'
import '../../src/mcu/all'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import type { CircuitLayout, ComponentInstance, ComponentTelemetry, Wire } from '../../src/model/types'
import { componentPinHoles, formatHole } from '../../src/model/breadboard'
import { CATALOG } from '../../src/model/catalog'
import { DC_MOTOR_130, dcSteadySpeed } from '../../src/sim/models/motors-mech'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../../firmware/dist')
const RPM = 60 / (2 * Math.PI)

function image(name: string) {
  const res = loadFirmwareFile(`${name}.elf`, new Uint8Array(readFileSync(join(DIST, `${name}.elf`))))
  if (!res.ok) throw new Error(res.error)
  return res.image
}

const BP: ComponentInstance = { id: 'U1', type: 'stm32_bluepill', at: 'h10' }

/** A free hole in the strip of Blue Pill pin `pin` (row a beside the c row, row j beside the h row). */
function tap(pin: string): string {
  const entry = CATALOG[BP.type]
  const h = componentPinHoles(BP, entry)?.[entry.pins.indexOf(pin)]
  if (!h || h.kind !== 'strip') throw new Error(pin)
  return formatHole({ ...h, row: h.row === 'c' ? 'a' : 'j' })
}

/**
 * The bench: PS1 (5 V) → Blue Pill 5V, ground on the top rail, the Blue
 * Pill's 3.3 V on the top + rail; `@PIN` in a wiring end means "the Blue
 * Pill pin's strip".
 */
function bench(extra: ComponentInstance[], wiring: [string, string][]): CircuitLayout {
  const wires: Wire[] = []
  let n = 0
  const w = (from: string, to: string) => wires.push({ id: `w${++n}`, from, to })
  w('PS1:+', tap('5V'))
  w('PS1:-', 'top-0')
  w(tap('GND3'), 'top-1')
  w(tap('3V3_1'), 'top+0')
  const end = (s: string) => (s.startsWith('@') ? tap(s.slice(1)) : s)
  for (const [a, b] of wiring) w(end(a), end(b))
  return { version: 1, name: 'motors firmware bench', components: [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }, BP, ...extra], wires }
}

interface Sample {
  t: number
  c: Record<string, ComponentTelemetry>
}

interface Run {
  /** completed UART lines with their arrival time */
  lines: { text: string; t: number }[]
  samples: Sample[]
  issues: string[]
  /** telemetry at (or just after) time t */
  at(t: number): Record<string, ComponentTelemetry>
  /** arrival time of the first line matching `re` (after `after`) */
  lineAt(re: RegExp, after?: number): number
}

/** Run firmware `fw` for `until` s, sampling every `dt` s. */
function run(layout: CircuitLayout, fw: string, until: number, dt = 0.005): Run {
  const co = new SimulationCoordinator()
  co.load(layout, 1)
  co.setFirmware('U1', image(fw))
  const lines: { text: string; t: number }[] = []
  const samples: Sample[] = []
  let buf = ''
  while (co.time < until) {
    co.advance(dt)
    for (const u of co.frame().uart) {
      if (u.port !== 'USART1') continue
      buf += String.fromCharCode(...u.bytes)
      let k: number
      while ((k = buf.indexOf('\r\n')) >= 0) {
        lines.push({ text: buf.slice(0, k), t: co.time })
        buf = buf.slice(k + 2)
      }
    }
    samples.push({ t: co.time, c: co.telemetry().components })
  }
  const issues = co.issues().map((i) => i.message)
  return {
    lines,
    samples,
    issues,
    at(t: number) {
      const s = samples.find((x) => x.t >= t - 1e-9) ?? samples[samples.length - 1]
      return s.c
    },
    lineAt(re: RegExp, after = 0) {
      const l = lines.find((x) => x.t > after && re.test(x.text))
      if (!l) throw new Error(`no UART line ${re} after ${after} s; got ${JSON.stringify(lines.map((x) => x.text))}`)
      return l.t
    },
  }
}

const vals = (c: Record<string, ComponentTelemetry>, id: string): Record<string, number> => c[id]?.values ?? {}

// ---------------------------------------------------------------------------

describe('hal-dc-motor: L298N + 130 motor, ENA PWM from TIM2', () => {
  const VS = 7.5
  const layout = bench(
    [
      { id: 'PS2', type: 'power_supply', params: { voltage: VS } },
      { id: 'D1', type: 'l298n_module', params: { jumperEnA: false } },
      { id: 'M1', type: 'dc_motor' },
    ],
    [
      ['PS2:+', 'D1:+12V'],
      ['PS2:-', 'top-2'],
      ['D1:GND', 'top-3'],
      ['D1:ENA', '@PA0'],
      ['D1:IN1', '@PB0'],
      ['D1:IN2', '@PB1'],
      ['D1:OUT1', 'M1:M+'],
      ['D1:OUT2', 'M1:M-'],
    ],
  )

  it('speed rises with the duty, 100 % = VS minus the drops, brake / reverse / coast as the L298 truth table says', { timeout: 120000 }, () => {
    const r = run(layout, 'hal-dc-motor', 3.45)
    expect(r.lines.map((l) => l.text).slice(0, 9)).toEqual([
      'L298N DC motor demo',
      'fwd 25%',
      'fwd 50%',
      'fwd 75%',
      'fwd 100%',
      'brake',
      'rev 50%',
      'rev 100%',
      'coast',
    ])
    const end = (re: RegExp) => r.at(r.lineAt(re) + 0.38)
    const rpm = [/^fwd 25%/, /^fwd 50%/, /^fwd 75%/, /^fwd 100%/].map((re) => vals(end(re), 'M1').rpm)
    for (let k = 1; k < 4; k++) expect(rpm[k], `duty step ${k}`).toBeGreaterThan(rpm[k - 1])
    expect(rpm[0]).toBeGreaterThan(1000)
    // 100 %: the motor sees VS minus ≈ 1.2–2 V of Darlington saturation at ≈ 0.13 A
    const full = vals(end(/^fwd 100%/), 'M1')
    expect(full.voltage).toBeGreaterThan(VS - 2.0)
    expect(full.voltage).toBeLessThan(VS - 1.0)
    expect(full.rpm / (dcSteadySpeed(DC_MOTOR_130, full.voltage) * RPM)).toBeCloseTo(1, 2)
    // brake: a lower Darlington + the GND→OUT flyback diode short the armature
    // while its back-EMF exceeds their ≈ 1.7 V (≈ 4 000 rpm), friction does the rest
    const tBrake = r.lineAt(/^brake/)
    expect(Math.abs(vals(r.at(tBrake + 0.1), 'M1').rpm)).toBeLessThan(0.25 * full.rpm)
    expect(Math.abs(vals(r.at(tBrake + 0.3), 'M1').rpm)).toBeLessThan(0.01 * full.rpm)
    // reverse at 100 % mirrors forward
    const rev = vals(end(/^rev 100%/), 'M1').rpm
    expect(rev).toBeLessThan(0)
    expect(-rev / full.rpm).toBeCloseTo(1, 1)
    // coast (EN low): only friction slows the rotor — far slower than the brake
    const tCoast = r.lineAt(/^coast/)
    expect(vals(r.at(tCoast + 0.1), 'M1').rpm).toBeLessThan(0.6 * rev)
    // no over-current: the start-up current stays inside the L298's 2 A rating at 7.5 V
    expect(r.issues.filter((m) => /D1: channel A carries/.test(m))).toEqual([])
  })
})

describe('hal-tb6612: TB6612FNG breakout + 130 motor, PWMA from TIM2', () => {
  // TB6612 at h40: row h VM VCC GND AO1 AO2 BO2 BO1 GND (j40..j47), row c PWMA AIN2 AIN1 STBY … (a40..a47)
  const VM = 6
  const layout = bench(
    [
      { id: 'PS2', type: 'power_supply', params: { voltage: VM } },
      { id: 'D1', type: 'tb6612fng_module', at: 'h40' },
      { id: 'M1', type: 'dc_motor' },
    ],
    [
      ['PS2:+', 'j40'],
      ['PS2:-', 'top-2'],
      ['top+1', 'j41'],
      ['j42', 'top-3'],
      ['j43', 'M1:M+'],
      ['j44', 'M1:M-'],
      ['a40', '@PA0'],
      ['a41', '@PB1'],
      ['a42', '@PB0'],
      ['a43', '@PB12'],
    ],
  )

  it('drive / short-brake PWM: speed linear in the duty; brake, stop and standby as in the truth table', { timeout: 120000 }, () => {
    const r = run(layout, 'hal-tb6612', 3.75)
    expect(r.lines.map((l) => l.text).slice(0, 10)).toEqual([
      'TB6612 DC motor demo',
      'cw 25%',
      'cw 50%',
      'cw 75%',
      'cw 100%',
      'short brake',
      'ccw 50%',
      'ccw 100%',
      'stop',
      'standby',
    ])
    const end = (re: RegExp) => vals(r.at(r.lineAt(re) + 0.38), 'M1').rpm
    const duty = [0.25, 0.5, 0.75, 1]
    const rpm = [/^cw 25%/, /^cw 50%/, /^cw 75%/, /^cw 100%/].map(end)
    // slow-decay PWM averages the bridge voltage: ω ∝ duty·VM − R·I_friction
    const vf = DC_MOTOR_130.r * (DC_MOTOR_130.tc / DC_MOTOR_130.kt)
    duty.forEach((d, k) => {
      expect(rpm[k] / (rpm[3] * ((d * VM - vf) / (VM - vf))), `cw ${d * 100}%`).toBeGreaterThan(0.93)
      expect(rpm[k] / (rpm[3] * ((d * VM - vf) / (VM - vf))), `cw ${d * 100}%`).toBeLessThan(1.07)
    })
    expect(rpm[3] / (dcSteadySpeed(DC_MOTOR_130, VM) * RPM)).toBeGreaterThan(0.97)
    const tBrake = r.lineAt(/^short brake/)
    expect(Math.abs(vals(r.at(tBrake + 0.08), 'M1').rpm)).toBeLessThan(0.03 * rpm[3])
    expect(end(/^ccw 50%/) / -rpm[1]).toBeCloseTo(1, 1)
    expect(end(/^ccw 100%/) / -rpm[3]).toBeCloseTo(1, 1)
    // stop = outputs off: the rotor coasts down slowly
    const tStop = r.lineAt(/^stop/)
    expect(vals(r.at(tStop + 0.08), 'M1').rpm).toBeLessThan(-0.4 * rpm[3])
    expect(vals(r.at(r.lineAt(/^standby/) + 0.3), 'D1').standby).toBe(1)
  })
})

describe('hal-sg90: SG90 on TIM2 CH1 (PA0), 50 Hz', () => {
  const servo = (sigWired: boolean) =>
    bench([{ id: 'S1', type: 'sg90_servo' }], [['S1:VCC', 'PS1:+'], ['S1:GND', 'top-2'], ...(sigWired ? ([['S1:SIG', '@PA0']] as [string, string][]) : [])])

  it('the horn follows the pulse width (0.5 ms = 0°, 2.5 ms = 180°) at ≈ 0.1 s/60°', { timeout: 120000 }, () => {
    const r = run(servo(true), 'hal-sg90', 3.35, 0.0025)
    expect(r.lines[0].text).toBe('SG90 sweep 0-180 deg')
    for (const [deg, us] of [
      [0, 500],
      [30, 833],
      [60, 1167],
      [90, 1500],
      [120, 1833],
      [150, 2167],
      [180, 2500],
    ] as const) {
      const t = r.lineAt(new RegExp(`^servo ${deg} deg \\(${us} us\\)`))
      const v = vals(r.at(t + 0.4), 'S1')
      expect(v.pulseUs, `${deg}°`).toBeCloseTo(us, -1)
      expect(v.angle, `${deg}°`).toBeGreaterThan(deg - 1.5)
      expect(v.angle, `${deg}°`).toBeLessThan(deg + 1.5)
    }
    // the 30° step 60 → 90: at 5 V ≈ 0.1 s/60° · 4.8/5 → ≈ 50 ms (+ the next pulse's latency)
    const t90 = r.lineAt(/^servo 90 deg/)
    const moving = r.samples.filter((s) => s.t > t90 && s.t < t90 + 0.2)
    const start = moving.find((s) => vals(s.c, 'S1').angle > 61)!.t
    const arrive = moving.find((s) => vals(s.c, 'S1').angle > 89)!.t
    expect(arrive - start).toBeGreaterThan(0.035)
    expect(arrive - start).toBeLessThan(0.075)
  })

  it('wrong wiring — SIG not connected: no pulse is ever measured, the horn stays where it was (90°)', { timeout: 120000 }, () => {
    const r = run(servo(false), 'hal-sg90', 0.8)
    const v = vals(r.at(0.8), 'S1')
    expect(v.target).toBe(-1)
    expect(v.angle).toBeCloseTo(90, 6)
  })
})

describe('hal-stepper-a4988: NEMA 17 on an A4988, TIM2 STEP pulses with acceleration', () => {
  // A4988 at g40: row g EN MS1 MS2 MS3 RST SLP STEP DIR (j40..j47), row d VMOT GND 2B 2A 1A 1B VDD GND (a40..a47)
  const layout = bench(
    [
      { id: 'PS2', type: 'power_supply', params: { voltage: 12 } },
      { id: 'D1', type: 'a4988_driver', at: 'g40' },
      { id: 'M1', type: 'nema17_stepper' },
    ],
    [
      ['PS2:+', 'a40'],
      ['PS2:-', 'top-2'],
      ['a41', 'top-3'],
      ['a46', 'top+1'],
      ['a47', 'top-4'],
      ['a44', 'M1:A+'],
      ['a45', 'M1:A-'],
      ['a43', 'M1:B+'],
      ['a42', 'M1:B-'],
      ['j40', '@PB15'],
      ['j41', '@PB12'],
      ['j42', '@PB13'],
      ['j43', '@PB14'],
      ['j44', 'j45'],
      ['j46', '@PA0'],
      ['j47', '@PB0'],
    ],
  )

  it('position after N pulses × microstep: +1600 @ 1/8, −100 full, −800 @ 1/8; the rotor follows; 2 rev/s cruise', { timeout: 120000 }, () => {
    const r = run(layout, 'hal-stepper-a4988', 3.0)
    expect(r.lines.map((l) => l.text).slice(0, 7)).toEqual([
      'A4988 stepper demo',
      'move +1600 steps 1/8 (1 rev)',
      'done, position 1600/8 full steps',
      'move -100 steps full (1/2 rev)',
      'done, position 800/8 full steps',
      'move -800 steps 1/8 (1/2 rev)',
      'done, position 0/8 full steps',
    ])
    for (const [re, pos] of [
      [/^done, position 1600\/8/, 200],
      [/^done, position 800\/8/, 100],
      [/^done, position 0\/8/, 0],
    ] as const) {
      const c = r.at(r.lineAt(re) + 0.05)
      expect(vals(c, 'D1').position, `${re}`).toBe(pos)
      // the rotor sits on the commanded microstep (home 45° electrical = ½ full step)
      expect(vals(c, 'M1').position - pos, `${re}`).toBeGreaterThan(0.4)
      expect(vals(c, 'M1').position - pos, `${re}`).toBeLessThan(0.6)
    }
    expect(vals(r.at(r.lineAt(/^done, position 1600/) + 0.05), 'D1').microstep).toBe(8)
    expect(vals(r.at(r.lineAt(/^done, position 800/) + 0.05), 'D1').microstep).toBe(1)
    // cruise of the first move: 3200 pulses/s at 1/8 = 400 full steps/s = 2 rev/s
    // (from the rotor position: the instantaneous speed ripples at the
    // full-step rate — detent + the lightly damped rotor resonance)
    const t0 = r.lineAt(/^move \+1600/)
    const a = r.samples.find((s) => s.t >= t0 + 0.32)!
    const b = r.samples.find((s) => s.t >= t0 + 0.47)!
    const stepsPerS = (vals(b.c, 'M1').position - vals(a.c, 'M1').position) / (b.t - a.t)
    expect(stepsPerS).toBeGreaterThan(392)
    expect(stepsPerS).toBeLessThan(408)
    expect(r.issues.filter((m) => /D1:/.test(m))).toEqual([])
  })
})

describe('hal-stepper-uln2003: 28BYJ-48 on a ULN2003 board, half steps every 2 ms', () => {
  const layout = (swap: boolean) =>
    bench(
      [
        { id: 'D1', type: 'uln2003_board' },
        { id: 'M1', type: 'stepper_28byj48' },
      ],
      [
        ['D1:VCC', 'PS1:+'],
        ['D1:GND', 'top-2'],
        ['D1:IN1', '@PB12'],
        ['D1:IN2', '@PB13'],
        ['D1:IN3', '@PB14'],
        ['D1:IN4', '@PB15'],
        ['D1:OUT1', 'M1:ORANGE'],
        // the classic mistake: YELLOW and PINK swapped
        ['D1:OUT2', swap ? 'M1:PINK' : 'M1:YELLOW'],
        ['D1:OUT3', swap ? 'M1:YELLOW' : 'M1:PINK'],
        ['D1:OUT4', 'M1:BLUE'],
        ['M1:RED', 'D1:VCC'],
      ],
    )

  it('1024 half steps turn the output a quarter turn clockwise; LEDs A–D follow the inputs', { timeout: 120000 }, () => {
    const r = run(layout(false), 'hal-stepper-uln2003', 2.25, 0.01)
    expect(r.lines[0].text).toBe('28BYJ-48 half-step 1 rev each way')
    const t = r.lineAt(/^cw 1024\/4096/)
    const m = vals(r.at(t), 'M1')
    // 1024 half steps of 4096 per output turn = 90° (± a fraction of a half step of lag)
    expect(m.angle).toBeGreaterThan(89)
    expect(m.angle).toBeLessThan(90.6)
    expect(m.rpm).toBeGreaterThan(0)
    // two adjacent LEDs lit at a time (half-step pairs) or one
    const leds = r.at(t).D1.leds!
    const lit = Object.values(leds).filter((b) => b > 0.1).length
    expect(lit).toBeGreaterThanOrEqual(1)
    expect(lit).toBeLessThanOrEqual(2)
  })

  it('wrong wiring — YELLOW and PINK swapped: the rotor only jitters around its start', { timeout: 120000 }, () => {
    const r = run(layout(true), 'hal-stepper-uln2003', 1.5, 0.01)
    const turns = r.samples.map((s) => vals(s.c, 'M1').turns)
    expect(Math.max(...turns.map(Math.abs))).toBeLessThan(0.01)
    // it does move (back and forth), it is not simply unpowered
    const angles = r.samples.map((s) => vals(s.c, 'M1').rotorAngle)
    expect(new Set(angles.map((a) => Math.round(a))).size).toBeGreaterThan(3)
  })
})
