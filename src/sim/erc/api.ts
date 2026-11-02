/**
 * Electrical rule check (ERC) — public types.
 *
 * The ERC is a PURE static checker: `runErc(layout, { telemetry, issues })`
 * reads the netlist (src/sim/netlist.ts), the catalog (pins, supplyPins,
 * digital specs, MCU pin maps, pinInfo.ft, ratings) and — when given — one
 * telemetry snapshot of a running simulation (currents, voltages, MCU pin
 * modes) and returns findings. It never runs the solver itself and never
 * invents values: a check whose inputs are unknown (no rating, no voltage,
 * no telemetry) is simply not made.
 *
 * Levels:
 *  'error' — certain from the circuit graph (and the stated ratings) alone:
 *            the wiring is wrong regardless of firmware or knob positions.
 *  'risk'  — a likely problem, or one that depends on firmware, switch
 *            positions or component values (e.g. a floating input that the
 *            firmware may or may not pull up).
 *  'info'  — legal but worth knowing (e.g. 5 V on a 5 V-tolerant pin).
 */

export type ErcLevel = 'error' | 'risk' | 'info'

export type ErcRuleId =
  | 'supply-short'
  | 'led-current'
  | 'gpio-overvoltage'
  | 'floating-input'
  | 'i2c-pullup'
  | 'supply-range'
  | 'logic-level'
  | 'over-rating'
  | 'ground-reference'
  | 'unpowered'
  | 'open-lead'
  | 'gpio-mode'
  | 'rail-unpowered'

export interface ErcFinding {
  /** stable id (rule + subject) — React key, dedupe */
  id: string
  rule: ErcRuleId
  level: ErcLevel
  /** plain-language problem + the fix */
  message: string
  /**
   * short English headline ("LED1 has no series resistor") — the problems
   * list title; translated through the runtime-message tables like `message`
   */
  short?: string
  /** datasheet / model reference behind the finding ("DS5319 Table 7") — shown under 「詳細」 */
  ref?: string
  /**
   * findings with one common cause share a group key (the same short, the
   * same wires): the panel shows them as 「1 個原因 · 影響 n 處」
   */
  group?: string
  /** components involved (select them on the board) */
  componentIds: string[]
  /** resolved net ids involved (netlist ids, e.g. "S12T", "R:top+", "PIN:PS1:+") */
  nets: string[]
  /** hole / terminal refs of the pins involved ("a12", "top+3", "PS1:+") */
  holes: string[]
  /** wires on the offending path (direct supply shorts), when known */
  wireIds?: string[]
  /**
   * The one fact this finding states, when another source (the simulator,
   * the MCU state) can state the same one — the problems list keeps one row
   * per fact (UX helper H5): 'power:U1', 'power:*', 'burned:LED1',
   * 'overcurrent:U1:PA5', 'overcurrent-supply:PS1', 'reversed:LED1'.
   */
  fact?: string
  /**
   * Raw catalog pin names the message mentions ('3V3_1', 'GND1', 'PA5'),
   * with their part — the display layer swaps them for the pin's readable
   * name (「3V3（板上 3.3）」) instead of showing a catalog key (IN-20).
   */
  pins?: { id: string; pin: string }[]
  /**
   * Where the fix goes, when the message names a place (the nearest − rail
   * hole for an LED cathode that connects to nothing, the powered rail a
   * floating rail should be wired to): 「在電路板上標示」 keeps these holes
   * inside the camera frame without marking them (UX helper H7 includeHoles).
   */
  fixHoles?: string[]
}

export interface ErcOptions {
  /** latest simulation telemetry (null/absent = static checks only) */
  telemetry?: import('../../model/types').SimTelemetry | null
  /** latest simulation issues (corroborating evidence, MCU pin over-current) */
  issues?: readonly import('../../model/types').SimIssue[]
  /**
   * Simulation time (s) of each MCU board's last reset or firmware load
   * (board id → t). Pin modes count as the firmware's choice only once the
   * board itself has run MODE_SETTLE_S since then — a Reset MCU or a
   * re-flash while paused puts every pin back to input (IN-15).
   */
  mcuResetAt?: Record<string, number>
  /**
   * The PC each board starts from after a reset (its firmware's entry point),
   * when known: a board still at that address has not run its firmware yet.
   */
  mcuResetPc?: Record<string, number>
  /**
   * GPIO ports whose writes the MCU ignored because their RCC clock was off
   * (board id → ['GPIOA']), from the simulation log: a pin the firmware
   * meant to drive then stays an input — the gpio-mode finding names the
   * missing clock instead of the pin choice (IN-15).
   */
  unclockedPorts?: Record<string, readonly string[]>
}

export interface ErcRuleInfo {
  id: ErcRuleId
  title: string
  /** what each level means for this rule (documentation + panel tooltips) */
  levels: Partial<Record<ErcLevel, string>>
}

/** Rule table: titles and level semantics (shown in the ERC panel). */
export const ERC_RULES: readonly ErcRuleInfo[] = [
  {
    id: 'supply-short',
    title: 'Supply short',
    levels: {
      error: 'a source’s + and − (or a board’s 3V3/5V and GND) share a net, or two sources of different voltage drive one net',
      risk: 'they are joined only through a switch, button, transistor, inductor or an A-mode meter (a short whenever it conducts)',
    },
  },
  {
    id: 'led-current',
    title: 'LED current limit',
    levels: {
      error:
        'an LED sits directly across a supply with nothing limiting its current, its leads are shorted together, the simulation burned it out, or the running simulation shows its cathode above its anode with no current (reversed)',
      risk: 'an LED is driven by a GPIO / logic output / generator, or through a switch, transistor or potentiometer, with no fixed resistor; the series resistor is too small; or an LED is wired in reverse between two rails and can never light',
      info: 'an LED faces a GPIO pin the wrong way round (confirmed once the simulation shows the pin driving it)',
    },
  },
  {
    id: 'gpio-overvoltage',
    title: 'GPIO overvoltage',
    levels: {
      error:
        'a non-5 V-tolerant MCU pin is tied to a rail above VDD + 0.3 V (or pulled there through a resistor injecting more than 5 mA), an FT pin goes above 5.5 V, or any pin below VSS − 0.3 V (DS5319 Tables 7 and 9)',
      risk: 'the high voltage reaches the pin through a resistor within the 5 mA injection limit, an FT pin above VDD + 0.3 V has its internal pull enabled by the firmware, or the MCU is unpowered while a pin is driven',
      info: '5 V on a 5 V-tolerant (FT) pin: allowed, but the internal pull-up/down must stay disabled (DS5319 Table 9 note 3)',
    },
  },
  {
    id: 'floating-input',
    title: 'Floating input',
    levels: {
      risk: 'a button/switch connects an input to a rail and nothing pulls it the other way while open (cleared when the running firmware enables the matching internal pull); also a pull in the same direction as the switch, or a switch on a push-pull output',
    },
  },
  {
    id: 'i2c-pullup',
    title: 'I²C pull-ups',
    levels: {
      error: 'an I²C SDA/SCL net with only open-drain ends and no pull-up resistor to a rail',
      risk: 'an I²C device pin on an MCU pin with no pull-up when the firmware is unknown, or SDA/SCL look swapped',
    },
  },
  {
    id: 'supply-range',
    title: 'Supply range',
    levels: {
      error: 'a part’s supply is above its rated maximum or reversed, a regulator input is above its rated maximum, or a logic device gets less than its model needs to power up',
      risk: 'a part’s supply is below its rated minimum, or a regulator input is too low to regulate',
    },
  },
  {
    id: 'logic-level',
    title: 'Logic levels',
    levels: {
      error: 'a 5 V output drives a non-5 V-tolerant 3.3 V MCU pin, or a chip input is driven above its absolute-maximum input voltage',
      risk: 'the same through a resistor, or a 3.3 V output drives a 5 V CMOS input whose VIH is above 3.3 V',
      info: 'a 5 V output drives a 5 V-tolerant (FT) pin',
    },
  },
  {
    id: 'over-rating',
    // not "(live)" any more: a reversed electrolytic across two rails is a
    // static error, said before Run (rules-damage.ts, fact 'reversed:<id>')
    title: 'Over rating',
    levels: {
      error:
        'the simulation’s own model reports the part destroyed (an LED or RGB die burned out, a resistor burned open, an electrolytic capacitor vented); or, before Run, a polarized capacitor sits reversed by more than 1 V between two rails, so it will vent once powered',
      risk: 'measured power/current above the part’s rating, a regulator in current limit or dropout, or a GPIO driver above 25 mA',
    },
  },
  {
    id: 'ground-reference',
    title: 'Ground reference',
    levels: {
      error: 'a chip’s or board’s GND pin is not connected to the circuit ground',
      risk: 'a second source or the function generator has no common ground with the circuit',
    },
  },
  {
    id: 'open-lead',
    title: 'Unconnected lead',
    levels: {
      risk: 'one lead of a two-terminal part connects to nothing while the other is wired, or only to a power rail that no supply feeds (risk while the simulation runs)',
      info: 'the same before running, or a part placed but not wired yet',
    },
  },
  {
    id: 'rail-unpowered',
    title: 'Unpowered rail',
    levels: {
      info: 'a power rail carries parts or wires, but no supply feeds it',
    },
  },
  {
    id: 'unpowered',
    title: 'Unpowered',
    levels: {
      error: 'there is no power source, or a chip’s / board’s supply pin reaches no source',
      risk: 'a supply pin is fed only through a resistor or other element',
    },
  },
  {
    id: 'gpio-mode',
    title: 'Pin not driven (live)',
    levels: {
      risk: 'an LED, buzzer or transistor base hangs only on an MCU pin that the running firmware left as an input',
    },
  },
]

export const ERC_LEVEL_ORDER: Record<ErcLevel, number> = { error: 0, risk: 1, info: 2 }
