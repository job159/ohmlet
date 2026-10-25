/**
 * Release QA SIM-F2 (AN-07a): every MCU frame says which exception the core
 * is in and which fault is latched — the inspector learns that firmware sits
 * in a fault handler while it runs, without a manual halt.
 *
 *   McuFrameInfo.exception = McuDebugState.ipsr (0 = thread mode)
 *   McuFrameInfo.fault     = { cfsr, hfsr, bfar?, mmfar? } only while CFSR
 *                            or HFSR is non-zero; BFAR / MMFAR only when
 *                            CFSR.BFARVALID / MMARVALID say they hold the
 *                            faulting address.
 *
 * fault-handler.bin (the analyst's 96-byte image): Reset_Handler loads from
 * 0x30000000 (no memory there → precise BusFault; BusFault is disabled in
 * SHCSR, so it escalates to HardFault) and the HardFault handler is `b .` —
 * the core spins in exception 3 with CFSR = BFARVALID | PRECISERR (0x8200),
 * HFSR = FORCED, BFAR = 0x30000000.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadFirmwareFile } from '../../src/mcu/loader'
import '../../src/mcu/all'
import { SimulationCoordinator } from '../../src/sim/coordinator/coordinator'
import { CFSR_BFARVALID, CFSR_MMARVALID, frameFault } from '../../src/sim/coordinator/api'
import type { McuFrameInfo } from '../../src/sim/coordinator/api'
import type { FirmwareImage } from '../../src/mcu/firmware'
import { bluePillWorld } from './worlds'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The analyst's fault-handler.bin, byte for byte (vector table + two Thumb routines). */
function faultHandlerBin(hardFaultVector = 0x08000051): Uint8Array {
  const b = new Uint8Array(96)
  const dv = new DataView(b.buffer)
  dv.setUint32(0x00, 0x20005000, true) // initial MSP
  dv.setUint32(0x04, 0x08000041, true) // Reset_Handler (Thumb)
  dv.setUint32(0x08, 0x08000051, true) // NMI
  dv.setUint32(0x0c, hardFaultVector, true) // HardFault
  for (let v = 0x10; v < 0x40; v += 4) dv.setUint32(v, 0x08000051, true)
  // Reset_Handler: ldr r0, [pc, #4] ; ldr r1, [r0] ; b . ; nop ; .word 0x30000000
  dv.setUint16(0x40, 0x4801, true)
  dv.setUint16(0x42, 0x6801, true)
  dv.setUint16(0x44, 0xe7fe, true)
  dv.setUint16(0x46, 0xbf00, true)
  dv.setUint32(0x48, 0x30000000, true)
  // handlers: b . ; nop
  dv.setUint16(0x50, 0xe7fe, true)
  dv.setUint16(0x52, 0xbf00, true)
  return b
}

function image(name: string, bytes: Uint8Array): FirmwareImage {
  const res = loadFirmwareFile(name, bytes)
  if (!res.ok) throw new Error(res.error)
  return res.image
}

function u1(co: SimulationCoordinator): McuFrameInfo {
  const info = co.frame(true).mcus.find((m) => m.componentId === 'U1')
  if (!info) throw new Error('no U1 frame')
  return info
}

describe('McuFrameInfo.exception / fault (SIM-F2)', () => {
  it('fault-handler.bin: the running frame says HardFault (3) with CFSR 0x8200, HFSR FORCED, BFAR 0x30000000', () => {
    const co = new SimulationCoordinator()
    co.load(bluePillWorld(), 1)
    co.setFirmware('U1', image('fault-handler.bin', faultHandlerBin()))
    co.advance(0.01)
    const info = u1(co)
    expect(info.state).toBe('running') // spinning in the handler: no halt, no lockup
    expect(info.exception).toBe(3)
    expect(info.fault).toEqual({ cfsr: 0x8200, hfsr: 0x40000000, bfar: 0x30000000 })
    expect(info.fault?.mmfar).toBeUndefined() // MMARVALID clear: MMFAR is no address
    // the same facts a manual halt shows (McuDebugState), now without one
    const ds = co.mcu('U1')!.debugState()
    expect(info.exception).toBe(ds.ipsr)
    expect(info.fault?.cfsr).toBe(ds.faults.cfsr)
    // every later frame keeps reporting it (the bits are sticky)
    co.advance(0.05)
    expect(u1(co)).toMatchObject({ exception: 3, fault: { cfsr: 0x8200, bfar: 0x30000000 } })
  })

  it('a power-on reset clears it: thread mode, no fault', () => {
    const co = new SimulationCoordinator()
    co.load(bluePillWorld(), 1)
    co.setFirmware('U1', image('fault-handler.bin', faultHandlerBin()))
    co.advance(0.01)
    expect(u1(co).fault).toBeDefined()
    co.reset()
    const info = u1(co)
    expect(info.fault).toBeUndefined()
    expect(info.exception ?? 0).toBe(0)
  })

  it('hal-blink: exception 0 (thread mode) and no fault in every frame', { timeout: 60_000 }, () => {
    const bytes = new Uint8Array(readFileSync(join(HERE, '../../firmware/dist/hal-blink.elf')))
    const co = new SimulationCoordinator()
    co.load(bluePillWorld(), 1)
    co.setFirmware('U1', image('hal-blink.elf', bytes))
    for (const t of [0.02, 0.25, 0.25, 0.25]) {
      co.advance(t)
      const info = u1(co)
      expect(info.state).toBe('running')
      expect(info.exception).toBe(0)
      expect(info.fault).toBeUndefined()
      expect('fault' in info).toBe(false)
    }
  })

  it('a board without firmware reports thread mode and no fault', () => {
    const co = new SimulationCoordinator()
    co.load(bluePillWorld(), 1)
    co.advance(0.001)
    const info = u1(co)
    expect(info.state).toBe('no-firmware')
    expect(info.fault).toBeUndefined()
  })

  it('frameFault: absent while CFSR and HFSR are zero; fault addresses only behind their VALID bits', () => {
    expect(frameFault(undefined)).toBeUndefined()
    expect(frameFault({ cfsr: 0, hfsr: 0, bfar: 0x30000000, mmfar: 0xe000ed34 })).toBeUndefined()
    expect(frameFault({ cfsr: 0, hfsr: 0x40000000, bfar: 0, mmfar: 0 })).toEqual({ cfsr: 0, hfsr: 0x40000000 })
    // imprecise BusFault: BFAR holds no address
    expect(frameFault({ cfsr: 0x0400, hfsr: 0x40000000, bfar: 0x1234, mmfar: 0 })).toEqual({ cfsr: 0x0400, hfsr: 0x40000000 })
    expect(frameFault({ cfsr: CFSR_BFARVALID | 0x0200, hfsr: 0, bfar: 0x30000000, mmfar: 7 })).toEqual({ cfsr: 0x8200, hfsr: 0, bfar: 0x30000000 })
    expect(frameFault({ cfsr: CFSR_MMARVALID | 0x02, hfsr: 0, bfar: 1, mmfar: 0x20005000 })).toEqual({ cfsr: 0x82, hfsr: 0, mmfar: 0x20005000 })
    // unsigned 32-bit even when a model hands over a negative int
    expect(frameFault({ cfsr: 0x8200, hfsr: 0x80000000 | 0, bfar: 0xffffffff | 0, mmfar: 0 })).toEqual({ cfsr: 0x8200, hfsr: 0x80000000, bfar: 0xffffffff })
  })
})
