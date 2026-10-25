/**
 * Glossary of the inspector's technical terms (UX wave IN-9): what a
 * beginner sees as "PC", "週期", "BOOT0", "FT", "開汲極"… gets a dotted
 * underline + ⓘ (<Term id> in controls.tsx) whose Tier-S popover explains
 * it in one or two plain sentences.
 *
 * Data only: English sources (shown through t(); zh-TW in
 * src/i18n/zh-TW/ux-inspector.ts, and in ux-inspector-2.ts for the
 * instruments' terms and the register grid — QA clarity GLOSSARY-ENTRIES;
 * 'rise' and 'i2c-lane' in qa-instruments.ts, where the instruments first
 * registered them).
 * `title` is the full name shown at the top of the popover (a "|glossary"
 * context keeps a title apart from the same English word elsewhere); the
 * inline label is whatever the caller renders.
 */
import { t } from '../../i18n'

export type GlossaryId =
  | 'pc'
  | 'cycles'
  | 'hclk'
  | 'speed'
  | 'boot0'
  | 'ft'
  | 'push-pull'
  | 'open-drain'
  | 'af'
  | 'pull'
  | 'floating'
  | 'erc'
  | 'duty'
  // the instruments' jargon (QA clarity GLOSSARY-ENTRIES — for <Term> in the scope, the analyzer and 量測)
  | 'vpp'
  | 'avg'
  | 'rms'
  | 'period'
  | 'trigger'
  | 'holdoff'
  | 'vdiv'
  | 'tdiv'
  | 'baud'
  | '8n1'
  | 'edges'
  | 'burst'
  | 'ack'
  | 'dt'
  | 'rise'
  | 'i2c-lane'
  // the register grid (McuPanel RegisterRows)
  | 'sp'
  | 'lr'
  | 'xpsr'
  | 'ipsr'

export interface GlossaryEntry {
  /** full name (English source) */
  title: string
  /** one or two plain sentences (English source) */
  body: string
}

export const GLOSSARY: Record<GlossaryId, GlossaryEntry> = {
  pc: {
    title: 'PC (program counter)',
    body: 'The address of the instruction the core runs next. The name after it is the function it is in.',
  },
  cycles: {
    title: 'Cycles (CPU clock cycles)',
    body: 'Core clock cycles since the last reset. It climbs while firmware runs and stands still while the core is halted or held in reset.',
  },
  hclk: {
    title: 'Core clock (HCLK)',
    body: 'The clock the firmware set up for the core: 8 MHz after reset, usually 72 MHz once the HAL clock setup has run.',
  },
  speed: {
    title: 'Simulation speed',
    body: '1× means the simulation keeps up with real time; 0.5× means one simulated second takes two real seconds.',
  },
  boot0: {
    title: 'BOOT0',
    body: 'Chooses what starts after a reset: 0 = your program in flash (normal); 1 = the ROM bootloader in system memory, which is not simulated. A change takes effect at the next reset.',
  },
  ft: {
    title: 'FT (5 V tolerant pin)',
    body: 'This pin’s input survives up to 5 V. Pins without FT take at most 3.6 V — feeding them 5 V can damage the chip.',
  },
  'push-pull': {
    title: 'Push-pull output',
    body: 'The pin actively drives both levels: 3.3 V for 1 and 0 V for 0. The usual mode for driving an LED.',
  },
  'open-drain': {
    title: 'Open-drain output',
    body: 'The pin can only pull the line low; for 1 it lets go. A pull-up resistor has to make the high level — I²C works this way.',
  },
  af: {
    title: 'Alternate function (AF)',
    body: 'A peripheral (USART, SPI, a timer…) drives this pin instead of your code writing it directly.',
  },
  pull: {
    title: 'Pull-up / pull-down',
    body: 'A resistor that holds an input at a known level (high or low) while nothing drives it. The STM32 has internal ones of about 40 kΩ.',
  },
  floating: {
    title: 'Floating input',
    body: 'An input connected to nothing: it picks up noise and reads random levels. Add a pull-up or pull-down resistor.',
  },
  duty: {
    // the alias in the title lets either word lead here (IN-20): 工作週期 is the term, 佔空比 the other name
    title: 'Duty cycle (also called duty ratio)',
    body: 'The share of each period the signal is high: 25 % means high for a quarter of the period. PWM sets an LED’s brightness or a motor’s speed this way.',
  },
  erc: {
    title: 'Electrical rule check (ERC)',
    body: 'Automatic checks of the wiring and the parts’ ratings — and, while the simulation runs, of the live readings. It points out likely mistakes; it cannot prove the circuit is right.',
  },

  // ---- the instruments (QA clarity GLOSSARY-ENTRIES; zh-TW in ux-inspector-2.ts) ----
  vpp: {
    title: 'Peak-to-peak voltage (Vpp)',
    body: 'The voltage between the highest and the lowest point of the waveform.',
  },
  avg: {
    title: 'Average voltage|glossary',
    body: 'The voltage averaged over time. For PWM the average ≈ duty cycle × the high-level voltage — what a multimeter’s DC range reads.',
  },
  rms: {
    title: 'RMS (root mean square)',
    body: 'The equivalent DC value, used to work out power; for a sine wave ≈ peak × 0.707.',
  },
  period: {
    title: 'Period|glossary',
    body: 'The time the signal takes to repeat once = 1 ÷ frequency.',
  },
  trigger: {
    title: 'Trigger|glossary',
    body: 'Makes every sweep start at the same place: the moment the signal crosses the trigger level going up (↑) or down (↓) is time 0.',
  },
  holdoff: {
    title: 'Trigger holdoff|glossary',
    body: 'After one trigger the scope waits this long before it accepts the next, so a complex waveform does not jump around.',
  },
  vdiv: {
    title: 'Volts per division (V/div)',
    body: 'How many volts one grid square stands for vertically; squares × V/div = the voltage difference.',
  },
  tdiv: {
    title: 'Time per division (time/div)',
    body: 'How much time one grid square stands for horizontally; the screen is 10 squares wide, so 10 × time/div is the time it shows.',
  },
  baud: {
    title: 'Baud rate (Bd)',
    body: 'How many bits are sent per second; at 115 200 Bd one bit lasts about 8.68 µs. Both ends must use the same rate.',
  },
  '8n1': {
    title: '8N1 (frame format)',
    body: '8 data bits, no parity, 1 stop bit.',
  },
  edges: {
    title: 'Edges|glossary',
    body: 'How many times the signal switched between low and high in the window; with too few edges no frequency can be measured.',
  },
  burst: {
    title: 'Burst|glossary',
    body: 'A clock that appears only while data is sent (I²C, SPI).',
  },
  ack: {
    title: 'ACK / NACK',
    body: 'ACK = the receiver pulls SDA low to say it got the byte; NACK = nobody answered. When scanning I²C, a NACK from most addresses is normal.',
  },
  dt: {
    title: 'Δt (time between the markers)',
    body: 'The time between markers A and B; 1/Δt is the frequency if that stretch is one period.',
  },
  // the scope's 上升時間 and the analyzer's I²C lane letters (release close-out: adopted from
  // InstrumentTerm.tsx INSTRUMENT_TERMS, word for word — zh-TW in qa-instruments.ts)
  rise: {
    title: 'Rise time (10–90 %)',
    body: 'How long the signal takes to climb from 10 % to 90 % of its swing. For an RC circuit it is about 2.2 × R × C.',
  },
  'i2c-lane': {
    title: 'I²C lane letters',
    body: 'S = start, Sr = repeated start, P = stop, A = ACK (answered), N = NACK (no answer).',
  },

  // ---- the register grid (McuPanel RegisterRows) ----
  sp: {
    title: 'SP (stack pointer)',
    body: 'The address of the top of the stack. Function calls and interrupts push data onto the stack and SP moves down; at reset it is loaded from the first word of the vector table.',
  },
  lr: {
    title: 'LR (return address)',
    body: 'Where the current function returns to. Inside an exception handler it holds an EXC_RETURN value (0xFFFFFFF9 …) instead.',
  },
  xpsr: {
    title: 'xPSR (program status)',
    body: 'The program status register: the top 4 bits are the condition flags N, Z, C and V, the lowest bits the current exception number (IPSR); bit 24 (T) must be 1.',
  },
  ipsr: {
    title: 'IPSR (current exception number)',
    body: '0 = the normal program; 3 = HardFault; 15 = SysTick; 16 and up are peripheral interrupts (IRQ number = IPSR − 16).',
  },
}

/** A glossary entry in the UI language. */
export function glossaryText(id: GlossaryId): { title: string; body: string } {
  const e = GLOSSARY[id]
  return { title: t(e.title), body: t(e.body) }
}

/** The glossary term behind a firmware pin-mode tag (pinModes: out, od, af, af-od, in, in↑, in↓, an). */
export function pinModeTerm(mode: string): GlossaryId | null {
  switch (mode) {
    case 'out':
      return 'push-pull'
    case 'od':
    case 'af-od':
      return 'open-drain'
    case 'af':
      return 'af'
    case 'in↑':
    case 'in↓':
      return 'pull'
    case 'in':
      return 'floating'
    default:
      return null
  }
}
