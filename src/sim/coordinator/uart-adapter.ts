/**
 * The UART terminal's virtual USB-TTL adapter (release close-out, the real
 * UART-RX path). Pure helpers; the adapter's state machine is the "TTL
 * adapter" block at the end of ./coordinator.ts.
 *
 * Typing in the UART terminal on an MCU port (U1 USART1 …) does NOT write
 * the bytes into the USART. The terminal is a USB-TTL adapter whose TXD is
 * jumpered to the USART's RX pin — USART1 → PA10, USART2 → PA3, USART3 →
 * PB11, or the remapped pin when AFIO_MAPR says so (USART1 → PB7 …,
 * `usartRxPin`) — and whose GND is jumpered to the board's GND:
 *   - its TXD shifts the bytes out as real UART frames, bit by bit in
 *     virtual time (`ttlFrameBits`: start bit, the M-bit word LSB first with
 *     the parity in its MSB, stop bits), at the line settings the firmware
 *     programmed (UartTap.config(): baud = f_PCLK / BRR, M, PCE/PS, STOP),
 *     latched when a line is sent — a PC terminal set to the board's
 *     settings. Firmware that changes its baud afterwards (or an adapter set
 *     to another baud, SimulationCoordinator.uartSend's `line`) gets framing
 *     errors exactly as on a bench. The USART receives through its normal
 *     pin sampling: RXNE, IDLE, FE / PE / NE / ORE, DMA requests;
 *   - electrically it is a 3.3 V CMOS push-pull output (TTL_VOH above the
 *     board's GND, TTL_ROUT) powered from USB: plugged in at the first send,
 *     it idles HIGH from then on, and the first start bit follows one
 *     character time of idle line. On a logic-resolvable net it is a
 *     DigitalNets slot (exact edges); on an analog net a Norton source
 *     (McuBoardChip.setSource) whose edges end analog steps exactly;
 *   - it never fights the circuit: when something else drives the RX net (a
 *     module's TXD, another MCU's output, a supply rail, a transistor, an
 *     IC output, a module behind a level shifter …) it stays unplugged (or
 *     lets go) and the MCU frame says who drives the net
 *     (McuFrameInfo.uartRx), so the terminal can say so and offer the
 *     module's own port.
 * The logic analyzer and its UART decoder see the frames on the RX pin like
 * any other signal.
 */
import type { CatalogEntry } from '../../model/catalog'
import type { UartLineConfig } from '../../mcu/mcu-api'
import type { AfioRemap } from '../../mcu/stm32f1/periph-api'
import { USART1_CONFIG, USART2_CONFIG, USART3_CONFIG } from '../../mcu/stm32f1/usart'
import type { UsartConfig } from '../../mcu/stm32f1/usart'

/** High level of the adapter's TXD above the board's GND (V): a 3.3 V USB-UART bridge (CH340 / CP2102 / FT232 class, 3.3 V I/O). */
export const TTL_VOH = 3.3
/**
 * Output resistance of the adapter's TXD (Ω). A USB-UART bridge's CMOS
 * output drops a few hundred mV at a few mA (≈ 100–200 Ω); 150 Ω is a
 * typical value, not one part's datasheet figure. Strong (≤ 1 kΩ, so a
 * fight with another output is contention, never silently won) yet finite.
 */
export const TTL_ROUT = 150
/** Bytes the adapter buffers (more are dropped and logged). */
export const TTL_QUEUE_MAX = 1 << 16

/** The line settings of one queued byte. */
export type TtlLine = Pick<UartLineConfig, 'baud' | 'dataBits' | 'parity' | 'stopBits'>

const USARTS: Readonly<Record<string, UsartConfig>> = {
  USART1: USART1_CONFIG,
  USART2: USART2_CONFIG,
  USART3: USART3_CONFIG,
}

/**
 * The remap fields the USART pin tables read, from AFIO_MAPR (RM0008
 * §9.4.2: USART1_REMAP bit 2, USART2_REMAP bit 3, USART3_REMAP bits 5:4 —
 * the reserved 10 reads as no remap, as afio.ts decodes it).
 */
function remapOf(mapr: number): AfioRemap {
  const u3 = (mapr >>> 4) & 3
  return {
    spi1: false,
    i2c1: false,
    usart1: ((mapr >>> 2) & 1) === 1,
    usart2: ((mapr >>> 3) & 1) === 1,
    usart3: u3 === 2 ? 0 : (u3 as 0 | 1 | 3),
    tim1: 0,
    tim2: 0,
    tim3: 0,
    tim4: false,
    swj: 0,
  }
}

/**
 * The RX pin of a USART for an AFIO_MAPR value (unknown / absent = reset
 * mapping): 'PA10' for USART1, 'PB7' with USART1_REMAP, 'PA3', 'PD6',
 * 'PB11', 'PC11', 'PD9'. Null for a port that is not a USART of the model.
 */
export function usartRxPin(port: string, mapr?: number): string | null {
  const cfg = USARTS[port]
  if (!cfg) return null
  return cfg.pins(remapOf(typeof mapr === 'number' && Number.isFinite(mapr) ? mapr >>> 0 : 0)).rx
}

/** A usable line config for the adapter: a positive baud, the rest as programmed. */
export function ttlLineOf(c: Partial<TtlLine> | undefined): TtlLine | null {
  const baud = c?.baud
  if (typeof baud !== 'number' || !(baud > 0) || !Number.isFinite(baud)) return null
  const dataBits = c?.dataBits === 9 ? 9 : 8
  const parity = c?.parity === 'even' || c?.parity === 'odd' ? c.parity : 'none'
  const stopBits = c?.stopBits === 0.5 || c?.stopBits === 1.5 || c?.stopBits === 2 ? c.stopBits : 1
  return { baud, dataBits, parity, stopBits }
}

/** One character on the wire: start + M word bits + stop bits (s). */
export function ttlCharTime(line: TtlLine): number {
  return (1 + line.dataBits + line.stopBits) / line.baud
}

/**
 * The level of every bit cell of one frame of `byte`, start bit first — the
 * frame the STM32 transmitter puts on its TX pin (RM0008 §27.3.2, usart.ts
 * loadShift): 0, then the M-bit word LSB first; with parity (PCE) the
 * word's MSB carries the parity of the M − 1 data bits (even: the 1-count
 * including the parity bit is even; odd: odd). A 9-bit word without parity
 * sends bit 8 of `byte` (0 for a typed character). The stop bit(s) follow
 * at the idle (high) level and are not listed.
 */
export function ttlFrameBits(byte: number, line: TtlLine): (0 | 1)[] {
  const n = line.dataBits
  let word = byte & ((1 << n) - 1)
  if (line.parity !== 'none') {
    const dataBits = n - 1
    word &= (1 << dataBits) - 1
    let ones = 0
    for (let i = 0; i < dataBits; i++) ones += (word >>> i) & 1
    const p = (ones & 1) ^ (line.parity === 'odd' ? 1 : 0)
    word |= p << dataBits
  }
  const out: (0 | 1)[] = [0]
  for (let i = 0; i < n; i++) out.push(((word >>> i) & 1) as 0 | 1)
  return out
}

// ------------------------------------------------------------ net roles

/** Device models that SOURCE a voltage or current into whatever they touch. */
const SOURCE_MODELS: ReadonlySet<string> = new Set(['power_supply', 'battery', 'function_generator', 'current_source', 'ldo'])
/** Discrete active parts: their output terminals can drive a net. */
const ACTIVE_MODELS: ReadonlySet<string> = new Set(['npn', 'pnp', 'nmos', 'pmos', 'irlz44n', 'pc817'])
/** The control side of an active part (base, gate, an optocoupler's LED): never a driver. */
const CONTROL_PINS: ReadonlySet<string> = new Set(['b', 'base', 'g', 'gate', 'anode', 'cathode'])
/** Sub-circuit element models that pass a signal from one of their terminals to another. */
export const PASS_ELEMENTS: ReadonlySet<string> = new Set(['npn', 'pnp', 'nmos', 'pmos', 'nmos_vth', 'irlz44n', 'pc817'])

/**
 * What a part's catalog pin can do to a net it touches, from the part's
 * KIND (never its present drive): 'source' (a supply, battery, function
 * generator, regulator output), 'driver' (a transistor's output terminal,
 * an IC output or a pin of unknown direction), or null (passive, a probe,
 * an instrument, a control input). A digital device's pure OUTPUT (listed in
 * `outputs`, not in `inputs`: a module's TXD, STATE, RO …) is a driver even
 * while it is released (a module still booting will drive it). MCU board
 * pins and bidirectional device pins return null: the coordinator asks
 * their PRESENT drive (DigitalNets slot strength / the stage history), and
 * their power pins make rail nets. Sub-circuit parts (basic_subcircuit:
 * level shifters …) return null here; their elements decide (PASS_ELEMENTS).
 */
export function staticRole(entry: CatalogEntry, pin: string): 'driver' | 'source' | null {
  if (entry.mcu) return null
  if (entry.digital) return entry.digital.outputs.includes(pin) && !entry.digital.inputs.includes(pin) ? 'driver' : null
  const sim = entry.sim
  if (sim.kind === 'device') {
    if (SOURCE_MODELS.has(sim.model)) return 'source'
    if (ACTIVE_MODELS.has(sim.model)) return CONTROL_PINS.has(pin.toLowerCase()) ? null : 'driver'
    return null
  }
  if (sim.kind === 'chip') {
    const info = entry.pinInfo?.find((p) => p.pin === pin)
    // an IC pin of unknown direction may be an output: never drive against it
    if (!info) return 'driver'
    return info.kind === 'output' || info.kind === 'io' ? 'driver' : null
  }
  return null
}
