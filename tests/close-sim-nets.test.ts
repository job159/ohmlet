/**
 * Release close-out UART-RX, the logic layer (src/sim/digital/nets.ts) the
 * terminal's USB-TTL adapter rides on:
 *  - a slot's high level can be a fixed offset above a reference rail
 *    (addSlot upOffset): the adapter's 3.3 V above the board's GND, whatever
 *    the board's own VDD does;
 *  - strongDriver: who drives a net strongly right now (excluded slots aside);
 *  - a YIELDING slot (setYield) is released — before the net resolves, so no
 *    contention is ever reported — the moment another strong driver shares
 *    its net, and is told who; weak drives (a pull-up) do not make it yield;
 *    its own changes resolve as usual.
 */
import { describe, expect, it } from 'vitest'
import { DigitalNets, NET_LOGIC, NET_RAIL } from '../src/sim/digital/nets'
import type { NetClassification } from '../src/sim/digital/nets'

/** One logic net (node 0); rail node 1 = the board's VDD, ground = node −1. */
function world(vdd: number) {
  const kind = new Uint8Array(3)
  kind[0] = NET_RAIL // ground
  kind[1] = NET_LOGIC
  kind[2] = NET_RAIL
  const cls: NetClassification = { nodeCount: 2, kind, attachments: new Uint16Array(3), pulls: [] }
  const rails: Record<number, number> = { 1: vdd }
  const issues: string[] = []
  const nets = new DigitalNets(cls, (n) => (n === -1 ? 0 : rails[n] ?? NaN), (_k, _l, m) => issues.push(m))
  return { nets, rails, issues }
}

const G = 1 / 150 // the adapter's stage
const GS = 1 / 50 // an STM32 / module push-pull stage
const GP = 1 / 40_000 // an internal pull-up

describe('DigitalNets for the terminal’s USB-TTL adapter', () => {
  it('upOffset: the adapter idles at 3.3 V above GND even when the board’s VDD sags', () => {
    const { nets, rails } = world(2.5)
    const mcu = nets.addSlot(0, 1, -1, 'U1.PA10') // the MCU's input: no drive
    const ttl = nets.addSlot(0, -1, -1, 'USB-TTL U1.PA10', 3.3)
    nets.initDrive(mcu, 0, 0)
    nets.initDrive(ttl, G, 0)
    nets.resolveAll()
    expect(nets.voltage(0)).toBeCloseTo(3.3, 12)
    rails[1] = 3.3
    nets.refreshRails()
    expect(nets.voltage(0)).toBeCloseTo(3.3, 12)
    // against the MCU's own 40 kΩ pull-down the divider is exact
    nets.setDrive(mcu, 0, GP)
    expect(nets.voltage(0)).toBeCloseTo((3.3 * G) / (G + GP), 12)
  })

  it('strongDriver names a push-pull or open-drain-low slot, never a pull or an excluded slot', () => {
    const { nets } = world(3.3)
    const a = nets.addSlot(0, 1, -1, 'U1.PA10')
    const b = nets.addSlot(0, 1, -1, 'CH1.TXD')
    nets.initDrive(a, GP, 0)
    nets.initDrive(b, 0, 0)
    nets.resolveAll()
    expect(nets.strongDriver(0)).toBeNull()
    nets.setDrive(b, GS, 0)
    expect(nets.strongDriver(0)).toBe('CH1.TXD')
    expect(nets.strongDriver(0, [b])).toBeNull()
    nets.setDrive(b, 0, GS)
    expect(nets.strongDriver(0)).toBe('CH1.TXD')
  })

  it('a yielding slot lets go before the net resolves when another output drives it — no contention', () => {
    const { nets, issues } = world(3.3)
    const ttl = nets.addSlot(0, -1, -1, 'USB-TTL U1.PA10', 3.3)
    const mod = nets.addSlot(0, 1, -1, 'CH1.TXD')
    const pull = nets.addSlot(0, 1, -1, 'U1.PA10')
    nets.initDrive(ttl, G, 0)
    nets.initDrive(mod, 0, 0)
    nets.initDrive(pull, GP, 0)
    const told: string[] = []
    nets.setYield(ttl, (by) => told.push(by))
    nets.resolveAll()
    // the adapter's own edges resolve as usual; a pull-up never makes it yield
    nets.setDrive(ttl, 0, G)
    expect(nets.voltage(0)).toBeCloseTo((3.3 * GP) / (G + GP), 12)
    expect(told).toEqual([])
    // the module drives LOW against the adapter's low: still a strong driver — the adapter yields
    nets.setDrive(mod, 0, GS)
    expect(told).toEqual(['CH1.TXD'])
    expect(nets.strongDriver(0)).toBe('CH1.TXD')
    // the module drives high now: the net follows it alone, no contention was ever reported
    nets.setDrive(mod, GS, 0)
    expect(nets.voltage(0)).toBeCloseTo(3.3, 6)
    expect(issues.filter((m) => /contention/.test(m))).toEqual([])
  })

  it('without setYield the same fight is contention (the real-bench case the adapter avoids)', () => {
    const { nets, issues } = world(3.3)
    const ttl = nets.addSlot(0, -1, -1, 'USB-TTL U1.PA10', 3.3)
    const mod = nets.addSlot(0, 1, -1, 'CH1.TXD')
    nets.initDrive(ttl, G, 0)
    nets.initDrive(mod, 0, 0)
    nets.resolveAll()
    nets.setDrive(mod, 0, GS)
    expect(issues.some((m) => /contention/.test(m))).toBe(true)
  })
})
