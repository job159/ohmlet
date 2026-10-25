/**
 * What an instrument prints for the timing of a digital signal (UX IS-11),
 * shared by the logic analyzer's footer / measurement column and the
 * oscilloscope's readout, so the same net never reads 「32.50 kHz」 in one
 * and 「38.40 kHz」 in the other:
 *
 *   a serial line (a USARTn_TX / RX pin of an enabled USART, or a channel
 *   a UART decoder reads)   鮑率 「115 200 Bd · 8N1（由 USART1 設定）」
 *   a periodic signal       頻率 「1.000 kHz」 (+ 工作週期)
 *   a clock in bursts       時脈 「99.25 kHz（突發）」 (I²C SCL, SPI SCK)
 *   anything else that moves 頻率 「—（非週期訊號）」 / 「—（非週期訊號：序列資料）」
 *
 * The judgement itself is src/instruments/measure.ts classifyPeriods
 * (EdgeMeasurements.periodicity); this module only finds the line settings
 * and words the result. Pure apart from t().
 */
import type { CircuitLayout, SimTelemetry } from '../../../model/types'
import { boardConfigOf } from '../../../model/types'
import { getEntry } from '../../../model/catalog'
import { componentPinHoles, formatHole } from '../../../model/breadboard'
import type { Netlist } from '../../../sim/netlist'
import type { LogicChannelConfig, McuFrameInfo } from '../../../sim/coordinator/api'
import type { UartLineConfig } from '../../../mcu/mcu-api'
import type { EdgeMeasurements, PeriodicityKind } from '../../../instruments/measure'
import { fmtBaud, fmtFreq, fmtPercent, fmtSimTimeAt } from '../../../instruments/format'
import { t } from '../../../i18n'
import { tc } from '../../format'
import type { DecoderRun, LogicDecoderConfig } from '../logic-decoders'
import { uartDecoderOptions } from './buses'
import { measuredBaudOf } from './la-config'

/** The line settings of a serial signal. */
export interface SerialLine {
  baud: number
  /** frame format "8N1" (null when unknown) */
  frame: string | null
  /** where the settings come from: the firmware's USART, the UART decoder's options, or its auto-baud measurement */
  by: { kind: 'usart'; name: string } | { kind: 'decoder' } | { kind: 'measured' }
}

type Uarts = readonly { name: string; config: UartLineConfig }[]

function frameOf(o: Record<string, string>): string | null {
  if (!o.dataBits) return null
  return `${o.dataBits}${o.parity === 'even' ? 'E' : o.parity === 'odd' ? 'O' : 'N'}${o.stopBits ?? '1'}`
}

/**
 * The USART line a pin carries per the firmware: its catalog functions name
 * USARTn_TX (the pin in an alternate-function mode) or USARTn_RX (an input
 * mode) of a USART the firmware enabled with a known baud rate. Remapped
 * functions never count (AFIO_MAPR is not reported — the same rule as H10).
 */
export function usartLineOfPin(functions: readonly string[], mode: string | undefined, uarts: Uarts | undefined): SerialLine | null {
  if (!mode || !uarts?.length) return null
  for (const f of functions) {
    const m = /^(USART\d)_(TX|RX)$/.exec(f.trim())
    if (!m) continue
    const u = uarts.find((x) => x.name === m[1])
    if (!u?.config.enabled) continue
    const tx = m[2] === 'TX'
    if (tx ? mode !== 'af' && mode !== 'af-od' : !mode.startsWith('in') && mode !== 'af') continue
    const o = uartDecoderOptions(u.config)
    if (!o.baud) continue
    return { baud: Number(o.baud), frame: frameOf(o), by: { kind: 'usart', name: m[1] } }
  }
  return null
}

/** Firmware context of the serial-line search. */
export interface LineContext {
  layout: CircuitLayout
  telemetry: SimTelemetry | null
  mcus: Readonly<Record<string, McuFrameInfo>>
}

/** The USART line on electrical net `net`: any MCU board pin on it that usartLineOfPin recognises. */
export function usartLineOnNet(net: string, netlist: Netlist, ctx: LineContext): SerialLine | null {
  const config = boardConfigOf(ctx.layout)
  for (const comp of ctx.layout.components) {
    const entry = getEntry(comp.type)
    const mcu = entry?.mcu
    if (!entry || !mcu) continue
    const modes = ctx.telemetry?.components[comp.id]?.mcu?.pinModes
    const uarts = ctx.mcus[comp.id]?.uarts
    if (!modes || !uarts?.length) continue
    const holes = componentPinHoles(comp, entry, config)
    for (let i = 0; i < entry.pins.length; i++) {
      const pin = entry.pins[i]
      if (!mcu.pinMap[pin]) continue
      const h = holes?.[i]
      if (!h || netlist.netOf(formatHole(h)) !== net) continue
      const line = usartLineOfPin(entry.pinInfo?.find((p) => p.pin === pin)?.functions ?? [], modes[pin], uarts)
      if (line) return line
    }
  }
  return null
}

/** The line a UART decoder reading channel `index` decodes (its baud option, or its auto-baud measurement). */
export function decoderLineOf(index: number, decoders: readonly LogicDecoderConfig[], runs?: readonly DecoderRun[]): SerialLine | null {
  for (const cfg of decoders) {
    if (cfg.decoder !== 'uart' || cfg.channels.data !== index) continue
    const o = Object.fromEntries(Object.entries(cfg.options ?? {}).map(([k, v]) => [k, String(v)]))
    const frame = frameOf({ dataBits: o.dataBits ?? '8', parity: o.parity ?? 'none', stopBits: o.stopBits ?? '1' })
    const baud = Number(o.baud)
    if (o.baud && o.baud !== 'auto' && baud > 0) return { baud, frame, by: { kind: 'decoder' } }
    const run = runs?.find((r) => (r.config.id ?? r.config.decoder) === (cfg.id ?? cfg.decoder))
    const measured = measuredBaudOf(run?.info)
    if (measured) return { baud: measured, frame, by: { kind: 'measured' } }
  }
  return null
}

/** A decoder role that is a bus CLOCK (I²C SCL, SPI SCK) — QA clarity MEASURE-COHERENCE. */
export function isClockChannel(index: number, decoders: readonly LogicDecoderConfig[]): boolean {
  return decoders.some((cfg) => Object.entries(cfg.channels).some(([role, ch]) => ch === index && /^(scl|sck|clk)$/.test(role)))
}

/** A decoder role that carries data, not a clock (UART data, SDA, MOSI / MISO, 1-Wire DQ). */
export function isDataChannel(index: number, decoders: readonly LogicDecoderConfig[]): boolean {
  return decoders.some((cfg) => Object.entries(cfg.channels).some(([role, ch]) => ch === index && /^(data|sda|mosi|miso|dq)$/.test(role)))
}

/**
 * The serial line of logic channel `ch`: the firmware's USART on its pin /
 * net first (「由 USART1 設定」), else a UART decoder reading it.
 */
export function serialLineOfChannel(
  ch: LogicChannelConfig,
  ctx: LineContext & { netOf: (ch: LogicChannelConfig) => string | null; netlist: Netlist | null },
  decoders: readonly LogicDecoderConfig[],
  runs?: readonly DecoderRun[],
): SerialLine | null {
  const net = ctx.netlist ? ctx.netOf(ch) : null
  const fw = net && ctx.netlist ? usartLineOnNet(net, ctx.netlist, ctx) : null
  return fw ?? decoderLineOf(ch.index, decoders, runs)
}

/** 「115 200 Bd · 8N1（由 USART1 設定）」 */
export function serialLineText(l: SerialLine): string {
  const what = l.frame ? `${fmtBaud(l.baud)} · ${l.frame}` : fmtBaud(l.baud)
  switch (l.by.kind) {
    case 'usart':
      return t('{line} (set by {usart})', { line: what, usart: l.by.name })
    case 'decoder':
      return t('{line} (UART decoder setting)', { line: what })
    case 'measured':
      return t('{line} (measured by the UART decoder)', { line: what })
  }
}

/** One timing cell: its label, its value, a tooltip, and whether a duty belongs next to it. */
export interface TimingCell {
  kind: 'line' | 'freq' | 'burst' | 'stopped' | 'aperiodic' | 'none'
  /** translated label: 鮑率 / 頻率 / 時脈 */
  label: string
  value: string
  /** short value for a narrow column ("115 200 Bd", "99.25 kHz") */
  short: string
  title: string
  /** the duty belongs next to this value (periodic signals only) */
  periodic: boolean
}

/**
 * The timing readout of edge measurements `m` (null = no data): the serial
 * line when there is one, else frequency / burst clock / 「—（非週期訊號）」.
 * `data`: the channel carries bus data (a decoder's data role) — the
 * aperiodic text then says so, and a data line is never a 「時脈（突發）」
 * nor a stopped clock (UX QA IS-F9). A regular train that STOPPED reads
 * 「—（已停在低電位，最後一個邊緣 35.57 s）」, its time at `timeRes` (the
 * view's time resolution, H3 fmtSimTimeAt; default 1 ms).
 */
export function timingCell(
  m:
    | (Pick<EdgeMeasurements, 'frequency' | 'periodicity' | 'burstClock' | 'skipped'> &
        Partial<Pick<EdgeMeasurements, 'stoppedAt' | 'stoppedLevel' | 'stoppedPeriod'>>)
    | null,
  line: SerialLine | null,
  data = false,
  timeRes = 1e-3,
  /** the channel is a decoder's clock role (SCL / SCK): a train that stopped is one bus transaction — a burst */
  clock = false,
): TimingCell {
  const f = tc('f', 'meas')
  if (line) {
    const value = serialLineText(line)
    return { kind: 'line', label: tc('baud', 'meas'), value, short: fmtBaud(line.baud), title: t('A serial line has no frequency — this is its baud rate.') + ' ' + value, periodic: false }
  }
  const kind: PeriodicityKind = m?.periodicity ?? 'unknown'
  if (m && kind === 'periodic' && m.frequency !== null) {
    const v = fmtFreq(m.frequency)
    return {
      kind: 'freq',
      label: f,
      value: v,
      short: v,
      title: m.skipped ? t('Some periods had no pulse (0 % or 100 % duty) — the frequency is that of the periods that had one.') : '',
      periodic: true,
    }
  }
  if (m && kind === 'stopped' && clock && !data && m.stoppedPeriod != null && m.stoppedPeriod > 0) {
    const v = fmtFreq(1 / m.stoppedPeriod)
    return {
      kind: 'burst',
      label: tc('clock', 'meas'),
      value: t('{f} (burst)', { f: v }),
      short: v,
      title: t('A clock in bursts: the median period inside the bursts. The gaps between them are not periods.'),
      periodic: false,
    }
  }
  if (m && kind === 'stopped' && !data && m.stoppedAt != null) {
    const at = fmtSimTimeAt(m.stoppedAt, timeRes)
    const value =
      m.stoppedLevel === 1
        ? t('— (stopped high, last edge {time})', { time: at })
        : m.stoppedLevel === 0
          ? t('— (stopped low, last edge {time})', { time: at })
          : t('— (stopped, floating after the last edge {time})', { time: at })
    return { kind: 'stopped', label: f, value, short: '—', title: t('The signal repeated, then stopped: no frequency since.'), periodic: false }
  }
  if (m && kind === 'burst' && m.burstClock !== null && !data) {
    const v = fmtFreq(m.burstClock)
    return {
      kind: 'burst',
      label: tc('clock', 'meas'),
      value: t('{f} (burst)', { f: v }),
      short: v,
      title: t('A clock in bursts: the median period inside the bursts. The gaps between them are not periods.'),
      periodic: false,
    }
  }
  if (m && (kind === 'aperiodic' || kind === 'burst' || kind === 'stopped')) {
    const value = data ? t('— (not periodic: serial data)') : t('— (not periodic)')
    return { kind: 'aperiodic', label: f, value, short: '—', title: t('The edges do not repeat, so there is no frequency or duty to measure.'), periodic: false }
  }
  return { kind: 'none', label: f, value: '—', short: '—', title: '', periodic: false }
}

/** The duty next to a timing cell: only for a periodic signal. */
export function dutyText(m: Pick<EdgeMeasurements, 'duty'> | null, cell: TimingCell): string {
  return cell.periodic && m?.duty != null ? fmtPercent(m.duty) : '—'
}
