/**
 * The performance reference circuit ("heavy scene"): a realistic, dense
 * embedded bench used by the profiling rig (scripts/perf-win.mjs) and the
 * simulation-throughput benchmark (tests/perf-sim.test.ts).
 *
 * Lab XL board, one Blue Pill (U1 at h10) and, wired as a student would:
 *  - I²C1 bus (PB6 SCL / PB7 SDA) shared by an SSD1306 OLED (0x3C), a GY-521
 *    MPU-6050 (0x68) and an LCD1602 with PCF8574 backpack (0x27);
 *  - SPI1 (PA5 SCK / PA7 MOSI) + PA4 RCLK into a 74HC595 whose eight outputs
 *    drive eight LEDs through 220 Ω resistors;
 *  - a TB6612FNG motor driver (PWMA PA0, AIN1 PB0, AIN2 PB1, STBY PB12)
 *    driving a DC motor from the 5 V rail.
 * Every peripheral matches the pins of a bundled firmware project, so any of
 * HEAVY_SCENE_FIRMWARE runs on it unchanged (the default, hal-oled-ssd1306,
 * keeps the I²C bus busy at 400 kHz and redraws the OLED every 200 ms).
 *
 * Rails: bot+ = 5 V (PS1 → Blue Pill 5V pin), top+ = 3.3 V (Blue Pill
 * 3V3), top− and bot− = GND.
 */
import type { CircuitLayout, ComponentInstance, Wire } from '../../model/types'

/** Bundled firmware projects whose pinout matches the heavy scene. */
export const HEAVY_SCENE_FIRMWARE = [
  'hal-oled-ssd1306',
  'hal-mpu6050',
  'hal-lcd1602-i2c',
  'hal-spi-595',
  'hal-tb6612',
] as const

export type HeavySceneFirmware = (typeof HEAVY_SCENE_FIRMWARE)[number]

/** Blue Pill header pin → its free strip hole beside the PCB (U1 at h10). */
const TAP: Record<string, string> = {
  PB12: 'j10',
  PB6: 'j23',
  PB7: 'j24',
  '5V': 'j27',
  GND3: 'j28',
  '3V3_1': 'a12',
  PA0: 'a25',
  PA4: 'a21',
  PA5: 'a20',
  PA7: 'a18',
  PB0: 'a17',
  PB1: 'a16',
}

/** The heavy reference circuit (fresh object per call). */
export function heavyScene(): CircuitLayout {
  const components: ComponentInstance[] = [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'OLED1', type: 'ssd1306_i2c', at: 'j36' },
    { id: 'IMU1', type: 'mpu6050_gy521', at: 'f46' },
    { id: 'U2', type: '74hc595', at: 'f60' },
    { id: 'LCD1', type: 'lcd1602_i2c', at: 'j92' },
    { id: 'DRV1', type: 'tb6612fng_module', at: 'h1' },
    { id: 'M1', type: 'dc_motor' },
  ]
  const wires: Wire[] = []
  let n = 0
  const w = (from: string, to: string, color?: string): void => {
    n += 1
    wires.push(color ? { id: `w${n}`, from, to, color } : { id: `w${n}`, from, to })
  }

  // ---- power: PS1 → 5 V rail → Blue Pill 5V; 3V3 out → top+; grounds tied
  w('PS1:+', 'bot+0', 'red')
  w('PS1:-', 'top-0', 'black')
  w('top-2', 'bot-2', 'black')
  w('bot+1', TAP['5V'], 'red')
  w(TAP.GND3, 'bot-3', 'black')
  w(TAP['3V3_1'], 'top+1', 'orange')

  // ---- I²C bus: OLED (pins j36..j39: GND VCC SCL SDA)
  w('f36', 'bot-30', 'black')
  w('f37', 'bot+31', 'red')
  w('g38', TAP.PB6, 'yellow')
  w('g39', TAP.PB7, 'green')
  // MPU-6050 GY-521 (pins f46..f53: VCC GND SCL SDA XDA XCL AD0 INT)
  w('g46', 'bot+37', 'red')
  w('g47', 'bot-38', 'black')
  w('g48', 'h38', 'yellow')
  w('g49', 'h39', 'green')
  // LCD1602 + PCF8574 backpack (pins j92..j95: GND VCC SDA SCL)
  w('f92', 'bot-74', 'black')
  w('f93', 'bot+75', 'red')
  w('g94', 'i39', 'green')
  w('g95', 'i38', 'yellow')

  // ---- 74HC595 (f60..f67 = QB..QH GND, e67..e60 = QH' SRCLR SRCLK RCLK OE SER QA VCC)
  w('a60', 'top+48', 'orange') // VCC 3.3 V
  w('j67', 'bot-54', 'black') // GND
  w('a66', 'top+53', 'orange') // SRCLR high
  w('a63', 'top-51', 'black') // OE low
  w('a65', TAP.PA5, 'blue') // SRCLK
  w('a64', TAP.PA4, 'white') // RCLK
  w('a62', TAP.PA7, 'purple') // SER
  // eight LEDs: output → jumper → 220 Ω across the channel → LED → GND
  const outputs = ['b61', 'j60', 'j61', 'j62', 'j63', 'j64', 'j65', 'j66'] // QA..QH
  outputs.forEach((out, k) => {
    const col = 72 + 2 * k
    w(out, `a${col}`, k === 0 ? 'blue' : 'white')
    components.push({ id: `R${k + 1}`, type: 'resistor', holes: [`e${col}`, `f${col}`], params: { resistance: 220 } })
    components.push({
      id: `D${k + 1}`,
      type: 'led',
      holes: [`g${col}`, `bot-${58 + 2 * k}`],
      params: { color: k < 3 ? 'green' : k < 6 ? 'yellow' : 'red' },
    })
  })

  // ---- TB6612FNG (h1..h8 = VM VCC GND AO1 AO2 BO2 BO1 GND2; c1..c8 = PWMA AIN2 AIN1 STBY BIN1 BIN2 PWMB GND3)
  w('j1', 'bot+5', 'red') // VM 5 V
  w('j2', 'top+4', 'orange') // VCC 3.3 V logic
  w('j3', 'bot-6', 'black')
  w('j8', 'bot-8', 'black')
  w('a8', 'top-7', 'black')
  w('j4', 'M1:M+', 'red')
  w('j5', 'M1:M-', 'black')
  w('a1', TAP.PA0, 'blue') // PWMA
  w('a3', TAP.PB0, 'white') // AIN1
  w('a2', TAP.PB1, 'purple') // AIN2
  w('b4', TAP.PB12, 'green') // STBY

  return { version: 1, name: '效能基準電路', board: 'labxl', components, wires }
}
