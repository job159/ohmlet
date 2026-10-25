/**
 * Layout builders for the ERC tests. Every layout built here is a REAL
 * breadboard layout (holes, wires, off-board terminals) and the tests assert
 * it passes validateLayout, so the ERC is exercised on circuits a user can
 * actually build.
 *
 * Blue Pill world: board U1 straddling the channel at h10 (header pins in
 * rows h and c, columns 10..29). Each header pin's strip has exactly one
 * free hole beside the PCB (row a for the c-row header, row j for the
 * h-row header) — `tap(pin)` returns it.
 */
import { expect } from 'vitest'
import type { CircuitLayout, ComponentInstance, ParamValue, SimTelemetry, Wire } from '../../src/model/types'
import { componentPinHoles, formatHole } from '../../src/model/breadboard'
import { CATALOG } from '../../src/model/catalog'
import type { CatalogEntry } from '../../src/model/catalog'
import { validateLayout } from '../../src/model/validate'
import type { ErcFinding, ErcRuleId } from '../../src/sim/erc'

let seq = 0
export function w(from: string, to: string): Wire {
  seq += 1
  return { id: `w${seq}`, from, to }
}

export function part(id: string, type: string, holes: string[], params?: Record<string, ParamValue>): ComponentInstance {
  return params ? { id, type, holes, params } : { id, type, holes }
}

export function ps(id = 'PS1', voltage = 5): ComponentInstance {
  return { id, type: 'power_supply', params: { voltage } }
}

export function layout(components: ComponentInstance[], wires: Wire[] = []): CircuitLayout {
  return { version: 1, name: 'erc test', components, wires }
}

/** Assert the layout is a valid, buildable layout and return it. */
export function valid(l: CircuitLayout): CircuitLayout {
  const res = validateLayout(l)
  expect(res.errors, res.errors.join('\n')).toEqual([])
  return l
}

/** PS1 (default 5 V) on the TOP rails: PS1:+ → top+0, PS1:- → top-0. */
export function railsWorld(parts: ComponentInstance[], wires: Wire[] = [], v = 5): CircuitLayout {
  return layout([ps('PS1', v), ...parts], [w('PS1:+', 'top+0'), w('PS1:-', 'top-0'), ...wires])
}

export const BP: ComponentInstance = { id: 'U1', type: 'stm32_bluepill', at: 'h10' }

/** The free hole on the strip of a Blue Pill header pin. */
export function tap(pin: string, board: ComponentInstance = BP): string {
  const entry = CATALOG[board.type]
  const idx = entry.pins.indexOf(pin)
  if (idx < 0) throw new Error(`no pin ${pin}`)
  const h = componentPinHoles(board, entry)?.[idx]
  if (!h || h.kind !== 'strip') throw new Error(`no hole for ${pin}`)
  return formatHole({ ...h, row: h.row === 'c' ? 'a' : 'j' })
}

export interface BpOptions {
  /** bench supply voltage (default 5) */
  supply?: number
  /** feed the supply into a 3.3 pin instead of the 5V pin */
  via3v3?: boolean
  /** skip the board ground wire */
  noGround?: boolean
  /** board 3.3 V on the BOTTOM + rail (for pull-ups to 3.3 V) */
  rail3v3?: boolean
}

/**
 * PS1 on the top rails (top+ = supply, top- = ground), board 5V (or 3V3_2)
 * from top+, board GND3 to top-; optionally board 3V3_1 on bot+ and bot- to
 * ground.
 */
export function bluePill(parts: ComponentInstance[] = [], wires: Wire[] = [], o: BpOptions = {}): CircuitLayout {
  const base: Wire[] = [
    w('PS1:+', 'top+0'),
    w('PS1:-', 'top-0'),
    w('top+1', o.via3v3 ? tap('3V3_2') : tap('5V')),
  ]
  if (!o.noGround) base.push(w(tap('GND3'), 'top-1'))
  if (o.rail3v3) base.push(w(tap('3V3_1'), 'bot+0'), w('top-2', 'bot-0'))
  return layout([ps('PS1', o.supply ?? 5), BP, ...parts], [...base, ...wires])
}

export function ofRule(f: readonly ErcFinding[], rule: ErcRuleId): ErcFinding[] {
  return f.filter((x) => x.rule === rule)
}

export function summary(f: readonly ErcFinding[]): string {
  return f.map((x) => `[${x.level}] ${x.id}: ${x.message}`).join('\n')
}

/** Minimal telemetry snapshot carrying MCU pin modes of a running firmware. */
export function modesTelemetry(modes: Record<string, string>, boardId = 'U1'): SimTelemetry {
  return {
    time: 0.1,
    netVoltages: {},
    issues: [],
    components: {
      [boardId]: {
        pinVoltages: {},
        mcu: { state: 'running', pc: 0x08000100, hclkHz: 72_000_000, cycles: 7_200_000, pinModes: modes },
      },
    },
  }
}

/**
 * TEST-ONLY catalog entry: a generic I²C logic device (VCC, GND, SCL, SDA)
 * described by a DigitalSpec, as any part family's sensor would be. Test
 * files insert it into CATALOG in beforeAll and remove it in afterAll
 * (vitest isolates module state per test file).
 */
export const I2C_DEV: CatalogEntry = {
  type: 'erc_test_i2c',
  label: 'Test I2C sensor',
  category: 'sensor',
  placement: 'leads',
  pins: ['VCC', 'GND', 'SCL', 'SDA'],
  sim: { kind: 'chip', model: 'digital-device' },
  digital: {
    model: 'erc-test-i2c',
    supplyPin: 'VCC',
    groundPin: 'GND',
    minVdd: 1.8,
    inputs: ['SCL', 'SDA'],
    outputs: ['SDA'],
  },
  doc: 'ERC test fixture only.',
}

/** Sensor at a{col}..a{col+3} (VCC, GND, SCL, SDA). */
export function sensor(id = 'U2', col = 40): ComponentInstance {
  return part(id, I2C_DEV.type, [`a${col}`, `a${col + 1}`, `a${col + 2}`, `a${col + 3}`])
}

/** Sensor VCC → bot+, GND → bot- (the board 3.3 V / ground with `rail3v3`). */
export function sensorPower(col = 40): Wire[] {
  return [w(`b${col}`, `bot+${col - 30}`), w(`b${col + 1}`, `bot-${col - 30}`)]
}
