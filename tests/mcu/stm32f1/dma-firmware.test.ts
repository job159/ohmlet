/**
 * Real firmware for DMA1, through the SimulationCoordinator (Blue Pill on
 * the breadboard, bench supply on 5V): ST HAL v1.1.9 images from
 * firmware/dist, judged only by the USART1 bytes (UartTap):
 *
 *  - hal-uart-dma: USART1 TX by DMA1 channel 4, RX by DMA1 channel 5 in
 *    circular mode with HAL_UARTEx_ReceiveToIdle_DMA. Bytes typed into the
 *    terminal (coordinator.uartSend → UartTap.send) come back as
 *    "<idle|ht|tc> <n>: <bytes>" — IDLE detection, the DMA half-transfer and
 *    transfer-complete events of the 32-byte ring and its wrap-around.
 *  - hal-dma-m2m: DMA1 channel 1 memory-to-memory copy of 1 KiB, verified by
 *    the firmware and timed with DWT->CYCCNT ("m2m ok <cycles>").
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadFirmwareFile } from '../../../src/mcu/loader'
import { registeredMcus } from '../../../src/mcu/registry'
import { SimulationCoordinator } from '../../../src/sim/coordinator/coordinator'
import { bluePillWorld } from '../../coordinator/worlds'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'firmware', 'dist')
const LONG = { timeout: 240_000 }
/** one 8N1 frame at 115200 Bd (BRR 0x271 at 72 MHz) */
const FRAME = 10 / 115200

function start(name: string) {
  const res = loadFirmwareFile(`${name}.elf`, new Uint8Array(readFileSync(join(DIST, `${name}.elf`))))
  if (!res.ok) throw new Error(res.error)
  const co = new SimulationCoordinator()
  co.load(bluePillWorld(), 1)
  co.setFirmware('U1', res.image)
  const rx: { t: number; byte: number }[] = []
  const warnings: string[] = []
  /** advance in `step` slices; every received byte is stamped with its slice end */
  const run = (seconds: number, step = 0.1e-3) => {
    const end = co.time + seconds
    while (co.time < end - 1e-12) {
      co.advance(Math.min(step, end - co.time))
      const f = co.frame()
      for (const u of f.uart) if (u.componentId === 'U1' && u.port === 'USART1') for (const b of u.bytes) rx.push({ t: co.time, byte: b })
      for (const l of f.log) if (l.level !== 'info') warnings.push(`${l.source}: ${l.message}`)
    }
  }
  const text = (from = 0) => String.fromCharCode(...rx.slice(from).map((x) => x.byte))
  return { co, run, rx, text, warnings }
}

const available = registeredMcus().includes('stm32f103c8')

describe.skipIf(!available)('real firmware on the coordinator: DMA1', () => {
  it('hal-uart-dma: TX by DMA, circular RX with IDLE / HT / TC events, every chunk echoed', LONG, () => {
    const { co, run, rx, text, warnings } = start('hal-uart-dma')
    run(0.02, 1e-3)
    expect(text()).toBe('uart-dma ready\r\n')
    expect(co.telemetry().components.U1.mcu?.hclkHz).toBe(72_000_000)

    // 5 bytes then silence: one IDLE event
    let n0 = rx.length
    const t1 = co.time
    co.uartSend('U1', 'USART1', new TextEncoder().encode('hello'))
    run(5e-3)
    expect(text(n0)).toBe('idle 5: hello\r\n')
    // the echo starts once the line has been idle for one frame after the 5th byte
    const firstEcho = rx[n0].t - FRAME // start of its first frame (± the 0.1 ms slice)
    expect(firstEcho).toBeGreaterThan(t1 + 6 * FRAME - 0.1e-3)
    expect(firstEcho).toBeLessThan(t1 + 6 * FRAME + 0.3e-3)

    // 40 bytes from ring position 5: HT at 16, TC at 32 (wrap), IDLE after the last 13
    n0 = rx.length
    co.uartSend('U1', 'USART1', new TextEncoder().encode('0123456789abcdefghijklmnopqrstuvwxyzABCD'))
    run(15e-3)
    expect(text(n0)).toBe('ht 11: 0123456789a\r\ntc 16: bcdefghijklmnopq\r\nidle 13: rstuvwxyzABCD\r\n')

    // second lap: 30 more bytes from ring position 13 → HT at 16 (3), TC at 32 (16), IDLE (11)
    n0 = rx.length
    co.uartSend('U1', 'USART1', new TextEncoder().encode('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123'))
    run(15e-3)
    expect(text(n0)).toBe('ht 3: ABC\r\ntc 16: DEFGHIJKLMNOPQRS\r\nidle 11: TUVWXYZ0123\r\n')
    expect(warnings.filter((m) => /USART|DMA/.test(m))).toEqual([])
    expect(co.issues().filter((i) => i.level === 'error')).toEqual([])
  })

  it('hal-dma-m2m: 1 KiB copied by DMA1 channel 1 (mem2mem), verified, ≥ 256 × 6 cycles, repeated every 500 ms', LONG, () => {
    const { run, text, warnings } = start('hal-dma-m2m')
    run(1.05, 5e-3)
    const lines = text().split('\r\n').filter(Boolean)
    expect(lines.length).toBe(3)
    const cycles = lines.map((l) => {
      const m = /^m2m ok (\d+)$/.exec(l)
      expect(m, l).not.toBeNull()
      return Number(m![1])
    })
    // 256 word transfers × (2 arbitration + 2 SRAM read + 2 SRAM write) + HAL_DMA_Start / poll overhead
    for (const c of cycles) {
      expect(c).toBeGreaterThanOrEqual(256 * 6)
      expect(c).toBeLessThan(256 * 6 + 400)
    }
    expect(new Set(cycles).size).toBe(1) // deterministic
    expect(warnings.filter((m) => /DMA/.test(m))).toEqual([])
  })
})
