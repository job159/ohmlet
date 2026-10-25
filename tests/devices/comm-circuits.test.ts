/**
 * Communication modules on REAL circuits through the SimulationCoordinator
 * (analog solve + logic layer + device models), without firmware: a Blue
 * Pill U1 at h10 is only the stimulus source — `setStimulus` puts the same
 * 50 Ω driver an STM32 output has on its header pins (never MCU registers).
 * Everything is wired with holes and wires like on the breadboard.
 *
 *  - TJA1050: two transceivers on one CAN bus — recessive / dominant levels
 *    from the analog solve (bias network, 2 × 120 Ω), wired-AND, RX of both
 *    nodes, the TXD dominant time-out, the 3.3 V TX-level note.
 *  - MAX485: driver levels into the two terminations, receiver output on
 *    the other node, bus contention, a one-ended termination.
 *  - ESP-01: CH_PD / RST / GPIO0 boot behavior and its power LED on 3.3 V.
 *  - CH340: USB power outputs and the logic-level jumper's TXD swing.
 */
import { describe, expect, it } from 'vitest'
import '../../src/mcu/all'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import { checkBoardTap as tap } from '../../src/sim/coordinator/checks'
import type { CircuitLayout, ComponentInstance, ParamValue, Wire } from '../../src/model/types'
import type { Esp01Module, Max485Module, Tja1050Module } from '../../src/sim/models/comm.model'
import { CAN_TDOM, ESP_BOOT_S } from '../../src/sim/models/comm.model'

let seq = 0
const w = (from: string, to: string): Wire => ({ id: `w${++seq}`, from, to })
const mod = (id: string, type: string, at: string, params?: Record<string, ParamValue>): ComponentInstance =>
  params ? { id, type, at, params } : { id, type, at }

/** Blue Pill U1 at h10 on a 5 V bench supply; top+ = 3.3 V (board regulator), bot+ = 5 V, both − rails GND. */
function bench(parts: ComponentInstance[], wires: Wire[]): CircuitLayout {
  return {
    version: 1,
    name: 'comm circuit bench',
    components: [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }, { id: 'U1', type: 'stm32_bluepill', at: 'h10' }, ...parts],
    wires: [
      w('PS1:+', tap('5V')),
      w('PS1:-', 'top-0'),
      w(tap('GND3'), 'top-1'),
      w(tap('3V3_1'), 'top+0'),
      w('i27', 'bot+0'), // the Blue Pill 5V strip
      w('top-2', 'bot-0'),
      ...wires,
    ],
  }
}

function world(layout: CircuitLayout): SimulationCoordinator {
  const co = new SimulationCoordinator()
  co.load(layout, 1)
  co.advance(0.02) // power-up settles
  return co
}

const volts = (co: SimulationCoordinator, id: string, pin: string) => co.telemetry().components[id].pinVoltages[pin]
const issues = (co: SimulationCoordinator, re: RegExp) => co.issues().filter((i) => re.test(i.message))

// ================================================================ TJA1050

describe('TJA1050: two CAN transceivers on one bus (levels only — bxCAN is not emulated)', () => {
  // C1 at h40: TX h40, RX h41, VCC h42, GND h43, CANH c41, CANL c42
  // C2 at h50: TX h50, RX h51, VCC h52, GND h53, CANH c51, CANL c52
  const layout = () =>
    bench(
      [mod('C1', 'can_tja1050', 'h40'), mod('C2', 'can_tja1050', 'h50')],
      [
        w('j42', 'bot+42'),
        w('j43', 'bot-43'),
        w('j52', 'bot+51'),
        w('j53', 'bot-52'),
        w('a41', 'a51'), // CANH–CANH
        w('a42', 'a52'), // CANL–CANL
        // 5 V-tolerant pins only: the TJA1050 TXD pull-up and RXD swing to its 5 V VCC
        w('j40', tap('PA12')), // node 1 TXD ← CAN_TX
        w('j50', tap('PB10')), // node 2 TXD
        w('i41', tap('PA11')), // node 1 RXD → CAN_RX
      ],
    )

  it('recessive ≈ 2.5 V on both lines; TX low → dominant ≈ 2 V differential seen by both RX; wired-AND', () => {
    const co = world(layout())
    co.setStimulus('U1', 'PA12', 1)
    co.setStimulus('U1', 'PB10', 1)
    co.advance(1e-3)
    const ch = volts(co, 'C1', 'CANH')
    const cl = volts(co, 'C1', 'CANL')
    expect(Math.abs(ch - cl)).toBeLessThan(0.05)
    expect(ch).toBeGreaterThan(2.2)
    expect(ch).toBeLessThan(2.8)
    const c1 = co.digitalDevice('C1') as Tja1050Module
    const c2 = co.digitalDevice('C2') as Tja1050Module
    expect([c1.rxLevel, c2.rxLevel]).toEqual([1, 1])
    // node 1 dominant
    co.setStimulus('U1', 'PA12', 0)
    co.advance(50e-6)
    const vd = volts(co, 'C2', 'CANH') - volts(co, 'C2', 'CANL')
    expect(vd).toBeGreaterThan(1.5) // ISO 11898-2 dominant 1.5 … 3 V into 60 Ω
    expect(vd).toBeLessThan(3.0)
    expect([c1.rxLevel, c2.rxLevel]).toEqual([0, 0])
    // the analog RX voltage follows within one analog step
    co.advance(100e-6)
    expect(volts(co, 'C1', 'RX')).toBeLessThan(0.5)
    expect(volts(co, 'C2', 'RX')).toBeLessThan(0.5)
    // node 2 dominant too: still dominant (wired-AND); node 1 releases → node 2 keeps it
    co.setStimulus('U1', 'PB10', 0)
    co.advance(20e-6)
    co.setStimulus('U1', 'PA12', 1)
    co.advance(20e-6)
    expect(c1.rxLevel).toBe(0)
    co.setStimulus('U1', 'PB10', 1)
    co.advance(20e-6)
    expect([c1.rxLevel, c2.rxLevel]).toEqual([1, 1])
    expect(issues(co, /dominant longer/)).toEqual([])
    expect(issues(co, /exceeds|not 5 V tolerant/)).toEqual([])
  })

  it('TX held low past the dominant time-out releases the bus and says why; a 3.3 V TX high is noted', () => {
    const co = world(layout())
    co.setStimulus('U1', 'PA12', 1)
    co.setStimulus('U1', 'PB10', 1)
    co.advance(1e-3)
    co.setStimulus('U1', 'PA12', 0)
    co.advance(CAN_TDOM + 100e-6)
    const c1 = co.digitalDevice('C1') as Tja1050Module
    expect(c1.dominantDriven).toBe(false)
    expect(Math.abs(volts(co, 'C1', 'CANH') - volts(co, 'C1', 'CANL'))).toBeLessThan(0.05)
    expect(issues(co, /C1: CAN transceiver TXD held dominant longer than 450 µs/)).toHaveLength(1)
    // TX back high (3.3 V from the STM32): the module re-arms; the level note appears once
    co.setStimulus('U1', 'PA12', 1)
    co.advance(50e-6)
    expect(issues(co, /C1: TX high level 3\.\d\d V is below the TJA1050 minimum VIH/)).toHaveLength(1)
    co.setStimulus('U1', 'PA12', 0)
    co.advance(50e-6)
    expect(c1.dominantDriven).toBe(true)
  })
})

// ================================================================= MAX485

describe('MAX485: driver / receiver on a two-node bus', () => {
  // M1 at h34: RO h34, RE h35, DE h36, DI h37 / VCC c34, B c35, A c36, GND c37
  // M2 at h44: RO h44, RE h45, DE h46, DI h47 / VCC c44, B c45, A c46, GND c47
  const layout = (p2: Record<string, ParamValue> = {}) =>
    bench(
      [mod('M1', 'max485_module', 'h34'), mod('M2', 'max485_module', 'h44', p2)],
      [
        w('a34', 'top+34'), // 3.3 V would be out of range: VCC from the 5 V rail instead ↓
        w('a37', 'top-37'),
        w('a44', 'top+43'),
        w('a47', 'top-46'),
        w('b36', 'b46'), // A–A
        w('b35', 'b45'), // B–B
        w('i35', 'i36'), // M1 RE+DE
        w('i45', 'i46'), // M2 RE+DE
        w('j36', tap('PA8')), // M1 DE/RE
        w('j37', tap('PA9')), // M1 DI
        w('j46', tap('PB12')), // M2 DE/RE
        w('j47', tap('PB10')), // M2 DI
      ],
    )
  // the modules need 5 V: re-point their VCC wires at the 5 V rail
  const fiveVolt = (l: CircuitLayout): CircuitLayout => ({
    ...l,
    wires: l.wires.map((x) => (x.from === 'a34' ? { ...x, to: 'bot+30' } : x.from === 'a44' ? { ...x, to: 'bot+40' } : x)),
  })

  it('M1 drives, M2 receives: VOD ≈ 2.3 V into 60 Ω, RO follows DI; no issues', () => {
    const co = world(fiveVolt(layout()))
    co.setStimulus('U1', 'PB12', 0) // M2 receives
    co.setStimulus('U1', 'PA8', 1) // M1 drives
    for (const di of [1, 0, 1, 0, 1, 0] as const) {
      co.setStimulus('U1', 'PA9', di)
      co.advance(20e-6)
      const vod = volts(co, 'M2', 'A') - volts(co, 'M2', 'B')
      expect(Math.sign(vod), `DI ${di}`).toBe(di ? 1 : -1)
      expect(Math.abs(vod)).toBeGreaterThan(1.5)
      expect((co.digitalDevice('M2') as Max485Module).ro).toBe(di)
    }
    const m1 = co.digitalDevice('M1') as Max485Module
    expect(m1.loadOhms).toBeGreaterThan(50)
    expect(m1.loadOhms).toBeLessThan(70)
    expect(issues(co, /RS-485/)).toEqual([])
  })

  it('both drivers enabled with opposite data: bus contention is reported', () => {
    const co = world(fiveVolt(layout()))
    co.setStimulus('U1', 'PA8', 1)
    co.setStimulus('U1', 'PB12', 1)
    co.setStimulus('U1', 'PA9', 1)
    co.setStimulus('U1', 'PB10', 1)
    co.advance(20e-6)
    co.setStimulus('U1', 'PB10', 0)
    co.advance(20e-6)
    expect(issues(co, /RS-485 bus contention: another driver holds A\/B against this one/).length).toBeGreaterThan(0)
  })

  it('R7 removed on the far node: "terminated at one end only" after a burst of data', () => {
    const co = world(fiveVolt(layout({ termination: false })))
    co.setStimulus('U1', 'PB12', 0)
    co.setStimulus('U1', 'PA8', 1)
    for (let k = 0; k < 8; k++) {
      co.setStimulus('U1', 'PA9', (k & 1) as 0 | 1)
      co.advance(20e-6)
    }
    const m1 = co.digitalDevice('M1') as Max485Module
    expect(m1.loadOhms).toBeGreaterThan(100)
    expect(m1.loadOhms).toBeLessThan(140)
    expect(issues(co, /M1: RS-485 bus is terminated at one end only/)).toHaveLength(1)
  })
})

// ================================================================= ESP-01

describe('ESP-01 on 3.3 V: CH_PD, RST and the GPIO0 boot strap', () => {
  // E1 at e40: GND e40, GPIO2 e41, GPIO0 e42, RXD e43, TXD e44, CH_PD e45, RST e46, VCC e47
  const layout = (extra: Wire[]) =>
    bench([mod('E1', 'esp01', 'e40')], [w('d40', 'top-40'), w('d47', 'top+45'), w('d45', tap('PB0')), w('d46', tap('PB1')), ...extra])

  it('CH_PD low: off; CH_PD high: ROM boot, then the AT firmware at 115200; power LED lit; RST low restarts', () => {
    const co = world(layout([]))
    const e = co.digitalDevice('E1') as Esp01Module
    co.setStimulus('U1', 'PB1', 1)
    co.setStimulus('U1', 'PB0', 0)
    co.advance(0.05)
    expect(e.mode).toBe('off')
    expect(co.telemetry().components.E1.sub?.LED_PWR?.ledBrightness ?? 0).toBeGreaterThan(0.05)
    co.setStimulus('U1', 'PB0', 1)
    co.advance(0.01)
    expect(e.mode).toBe('rom')
    co.advance(ESP_BOOT_S)
    expect(e.mode).toBe('at')
    expect(co.telemetry().components.E1.values?.baud).toBe(115200)
    // TXD idles high at the 3.3 V supply
    expect(volts(co, 'E1', 'TXD')).toBeGreaterThan(3.1)
    co.setStimulus('U1', 'PB1', 0)
    co.advance(1e-3)
    expect(e.mode).toBe('off')
    co.setStimulus('U1', 'PB1', 1)
    co.advance(1e-3)
    expect(e.mode).toBe('rom')
  })

  it('GPIO0 tied to GND at reset: UART download mode (logged), the AT firmware never starts', () => {
    const co = world(layout([w('d42', 'top-42')]))
    const e = co.digitalDevice('E1') as Esp01Module
    co.setStimulus('U1', 'PB1', 1)
    co.setStimulus('U1', 'PB0', 1)
    co.advance(0.4)
    expect(e.mode).toBe('download')
    expect(co.frame(false).log.some((l) => /ESP-01: GPIO0 low at reset — UART download mode/.test(l.message))).toBe(true)
  })
})

// ================================================================== CH340

describe('CH340 adapter: USB power outputs and the logic-level jumper', () => {
  // CH1 at a35: GND a35, 3V3 a36, 5V a37, TXD a38, RXD a39, DTR a40
  const layout = (logic: string) => bench([mod('CH1', 'usb_uart_ch340', 'a35', { logic })], [w('e35', 'top-35')])

  it('5V ≈ 5 V and 3V3 ≈ 3.3 V from USB, power LED lit; TXD idles at the jumper rail', () => {
    for (const [logic, vio] of [
      ['5V', 5.0],
      ['3.3V', 3.3],
    ] as const) {
      const co = world(layout(logic))
      expect(volts(co, 'CH1', '5V')).toBeGreaterThan(4.9)
      expect(volts(co, 'CH1', '3V3')).toBeGreaterThan(3.2)
      expect(volts(co, 'CH1', '3V3')).toBeLessThan(3.4)
      expect(co.telemetry().components.CH1.sub?.LED_PWR?.ledBrightness ?? 0).toBeGreaterThan(0.1)
      expect(volts(co, 'CH1', 'TXD'), logic).toBeGreaterThan(vio - 0.15)
      expect(volts(co, 'CH1', 'TXD'), logic).toBeLessThan(vio + 0.05)
      // DTR (not asserted) idles high at the same rail
      expect(volts(co, 'CH1', 'DTR'), logic).toBeGreaterThan(vio - 0.15)
    }
  })
})
