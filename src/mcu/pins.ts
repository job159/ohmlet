/**
 * MCU pin ↔ circuit contract (pure TS).
 *
 * CONTRACT FILE. The SoC GPIO model reduces each pin's register state to an
 * electrical DRIVE (mode + level); the simulation coordinator turns that into
 * a Norton stamp for the analog solver and/or a logic drive on the digital
 * net layer, and pushes the resolved INPUT back (Schmitt-trigger level + the
 * analog voltage for the ADC).
 *
 * Modes are plain numbers (no const enum: the project builds with
 * isolatedModules).
 */

/** Analog mode: input buffer disconnected (IDR reads 0), no drive. ADC reads the voltage. */
export const PIN_ANALOG = 0
/** Floating input: no drive. */
export const PIN_IN_FLOAT = 1
/** Input with internal pull-up (weak drive to VDD). */
export const PIN_IN_PULLUP = 2
/** Input with internal pull-down (weak drive to 0 V). */
export const PIN_IN_PULLDOWN = 3
/** Push-pull output (GPIO or alternate function): strong drive to VDD / 0 V. */
export const PIN_OUT_PP = 4
/** Open-drain output: strong drive to 0 V when level=0, released (high-Z) when level=1. */
export const PIN_OUT_OD = 5

export type PinMode = 0 | 1 | 2 | 3 | 4 | 5

export const PIN_MODE_NAMES: Record<PinMode, string> = {
  0: 'analog',
  1: 'input (floating)',
  2: 'input (pull-up)',
  3: 'input (pull-down)',
  4: 'output (push-pull)',
  5: 'output (open-drain)',
}

/** Snapshot of one pin's electrical drive. */
export interface PinDriveState {
  mode: PinMode
  /** driven level for outputs (ignored for inputs) */
  level: 0 | 1
  /** output is controlled by an alternate-function peripheral (USART/TIM/SPI/I2C…) */
  af: boolean
}

/** Receives pin drive changes from the SoC, synchronously, mid-execution. */
export interface McuPinListener {
  /**
   * Pin `pin`'s drive (mode or level) changed at core cycle `cycle` (the
   * exact cycle of the register write or peripheral edge). The listener may
   * call `requestSync()` on the MCU to make `run()` return at the next
   * instruction boundary (used when the pin feeds the analog solver).
   */
  pinDriveChanged(pin: number, cycle: number): void
}

/** The pin side of an MCU model. Pin numbering: port*16 + bit (PA0=0, PB0=16, PC13=45…). */
export interface McuPinPort {
  readonly pinCount: number
  /** 'PA0' … ; '' for an unbonded index */
  pinName(pin: number): string
  /** inverse of pinName; -1 when unknown */
  pinIndex(name: string): number
  drive(pin: number): PinDriveState
  /**
   * Coordinator → MCU: the pin's resolved input. `level` is already the
   * Schmitt-trigger result (the coordinator applies the MCU's VIL/VIH with
   * hysteresis); `volts` is the analog voltage (ADC input; NaN if unknown).
   * Edge detection (EXTI, timer input capture, UART/I2C/SPI receive) happens
   * inside the SoC on level changes. Time = the MCU's current cycle.
   */
  setInput(pin: number, level: 0 | 1, volts: number): void
  listener: McuPinListener | null
}

/**
 * GPIO electrical characteristics used by the coordinator to stamp drives
 * and resolve inputs. Values for a given MCU come from its datasheet.
 */
export interface GpioElectrical {
  /** output impedance of a push-pull/open-drain driver (Ω) */
  routStrong: number
  /** internal pull-up / pull-down resistance (Ω) */
  rPull: number
  /** input LOW threshold at the given VDD (V): below → 0 */
  vil(vdd: number): number
  /** input HIGH threshold at the given VDD (V): above → 1 */
  vih(vdd: number): number
  /** absolute-max pin voltage for a standard (non 5 V tolerant) pin */
  vMaxStandard(vdd: number): number
  /** absolute-max pin voltage for a five-volt-tolerant (FT) pin */
  vMaxFt(vdd: number): number
  /** absolute-max injected/sourced current per pin (A) */
  iMaxPin: number
}

/**
 * STM32F103 (DS5319 Rev 20, §5.3.13/5.3.14): VIL ≤ 0.28·(VDD−2)+0.8,
 * VIH ≥ 0.41·(VDD−2)+1.3 (standard I/O), pull resistors 30–50 kΩ (typ 40),
 * VOL ≤ 0.4 V @ 8 mA (≈50 Ω), abs-max VIN = VDD+0.3 (standard) / 5.5 V (FT),
 * IIO ±25 mA.
 */
export const STM32F1_GPIO: GpioElectrical = {
  routStrong: 50,
  rPull: 40_000,
  vil: (vdd) => 0.28 * (vdd - 2) + 0.8,
  vih: (vdd) => 0.41 * (vdd - 2) + 1.3,
  vMaxStandard: (vdd) => vdd + 0.3,
  vMaxFt: () => 5.5,
  iMaxPin: 0.025,
}
