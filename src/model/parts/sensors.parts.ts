/**
 * Sensors family (component library): environment, motion, distance, light,
 * position and current/voltage sensors as the breakout modules people really
 * buy, each converting an inspector-editable environment input (runtime
 * param) into its real register / protocol / electrical behavior.
 *
 * Behavior: src/sim/models/sensors.model.ts (+ sensors-*.ts helpers) —
 * logic-level DigitalDevices driven only by pin edges and virtual-time
 * events (I²C register maps, 1-Wire, the DHT single-wire frame, the
 * HC-SR04 echo, quadrature, NEC frames) and MNA devices for the analog
 * parts (joystick potentiometers, ACS712 Hall current sensor). Meshes:
 * src/three/meshes/ext/sensors.mesh.ts.
 *
 * Module placement convention: the single-row header plugs into ONE strip
 * row (row f at rotation 0, pins left → right) and the PCB lies over the
 * channel and the top block (the header strips keep their free holes in
 * rows g–j). Rotation 180 turns the module round (header in any row, board
 * over the other block); 90/270 would put every header pin into one strip
 * and are refused (allowedRotations).
 *
 * Board-level parts (regulators, pull-ups, power LEDs) are sub-circuits
 * exactly as on the common module; values from the module schematics.
 *
 * Only `import type` from '../catalog' (it imports this module).
 */
import type { CatalogEntry, ParamDef, PinInfo, SubcircuitElement } from '../catalog'

/** Single-row header in strip row f, pins 1..n left → right. */
function rowF(n: number): { dCol: number; row: 'f' }[] {
  return Array.from({ length: n }, (_, i) => ({ dCol: i, row: 'f' as const }))
}

/**
 * Torex XC6206P332MR ("662K") 3.3 V LDO used on GY-521 / GY-302 boards:
 * 6.0 V max input, ≈ 250 mV dropout at 100 mA, 200 mA class.
 */
function ldo662k(input: string, output: string, gnd: string): SubcircuitElement {
  return { id: 'REG', model: 'ldo', pins: [input, output, gnd], params: { vout: 3.3, dropout: 0.25, rout: 0.05, ilimit: 0.2, vinMax: 6 } }
}

/** Module power LED (SMD red) with its series resistor. */
function powerLed(plus: string, gnd: string, r: number): SubcircuitElement[] {
  return [
    { id: 'LED_PWR', model: 'led', pins: [plus, '@led_k'], params: { color: 'red' } },
    { id: 'R_LED', model: 'resistor', pins: ['@led_k', gnd], params: { resistance: r } },
  ]
}

function pull(id: string, pin: string, to: string, ohms: number): SubcircuitElement {
  return { id, model: 'resistor', pins: [pin, to], params: { resistance: ohms } }
}

const num = (
  key: string,
  label: string,
  def: number,
  min: number,
  max: number,
  step: number,
  unit?: string,
): ParamDef => ({ key, label, kind: 'number', default: def, min, max, step, unit, runtime: true })

const I2C_SLAVE_SIM =
  'I²C slave at the bit level: START / repeated START / STOP, 7-bit address with ACK on SDA (open drain), bits sampled on SCL rising edges, data out 0.3 µs after SCL falls'
const I2C_TIMING_LIMIT = 'bus timing (setup/hold, maximum SCL rate) is not checked: any rate the master produces works; no clock stretching'

/** Thresholds of a 3.3 V chip behind the module LDO, as fractions of the module VCC (see support.limits). */
const LDO_MODULE_VIL = 0.2
const LDO_MODULE_VIH = 0.46

const MPU_PIN_INFO: PinInfo[] = [
  { pin: 'VCC', kind: 'power', note: 'Module supply 3–5 V into the on-board 3.3 V regulator (XC6206 "662K").' },
  { pin: 'GND', kind: 'ground' },
  { pin: 'SCL', kind: 'input', functions: ['I2C_SCL'], note: 'I²C clock — 4.7 kΩ pull-up to the on-board 3.3 V.' },
  { pin: 'SDA', kind: 'io', functions: ['I2C_SDA'], note: 'I²C data, open drain — 4.7 kΩ pull-up to the on-board 3.3 V.' },
  { pin: 'XDA', kind: 'io', note: 'Auxiliary I²C data (for an external magnetometer): 4.7 kΩ pull-up only — the auxiliary master is not simulated.' },
  { pin: 'XCL', kind: 'io', note: 'Auxiliary I²C clock: 4.7 kΩ pull-up only — the auxiliary master is not simulated.' },
  { pin: 'AD0', kind: 'input', note: 'Address select: low / open = 0x68 (4.7 kΩ pull-down on the board), high = 0x69.' },
  { pin: 'INT', kind: 'output', note: 'Interrupt output, push-pull active high by default (INT_PIN_CFG): 50 µs data-ready pulse per sample, or latched.' },
]

const BMX_PIN_INFO = (chip: string): PinInfo[] => [
  { pin: 'VCC', kind: 'power', note: `${chip} supply, 1.71–3.6 V — this module has NO regulator: 3.3 V only.` },
  { pin: 'GND', kind: 'ground' },
  { pin: 'SCL', kind: 'input', functions: ['I2C_SCL'], note: 'I²C clock (SPI SCK) — 10 kΩ pull-up to VCC on the board.' },
  { pin: 'SDA', kind: 'io', functions: ['I2C_SDA'], note: 'I²C data (SPI SDI), open drain — 10 kΩ pull-up to VCC on the board.' },
  { pin: 'CSB', kind: 'input', note: 'Chip select: high (10 kΩ pull-up) selects I²C. Pulling it low selects SPI, which is not simulated.' },
  { pin: 'SDO', kind: 'input', note: 'I²C address bit 0: low (10 kΩ pull-down on the board) = 0x76, high = 0x77 (SPI SDO).' },
]

const BMX_SIM = (chip: string, humidity: boolean): string[] => [
  I2C_SLAVE_SIM,
  `register map: chip id (0x${chip === 'BME280' ? '60' : '58'}), reset (0xB6 → 0xE0), ${humidity ? 'ctrl_hum (latched by the next ctrl_meas write), ' : ''}status (measuring / im_update), ctrl_meas, config, burst-readable data registers, auto-increment reads and (address, data) pair writes`,
  'factory trimming parameters in NVM (0x88…0xA1' + (humidity ? ', 0xE1…0xE7' : '') + '); raw ADC values are produced by inverting the datasheet compensation, so the Bosch integer formulas recover the environment input within the selected resolution',
  'sleep / forced / normal mode; measurement time from the oversampling settings (datasheet typ. formula); standby times t_sb; data registers update after each conversion (never in the middle of a burst read)',
  'oversampling sets the resolution (16–20 bit, low bits zero); skipped channels read 0x80000' + (humidity ? ' / 0x8000' : '') + '; IIR filter (coefficient 2…16) on temperature and pressure',
]

const DHT_PIN_INFO = (part: string, vmin: string): PinInfo[] => [
  { pin: 'VCC', label: '+', kind: 'power', note: `${part} supply ${vmin}.` },
  { pin: 'DATA', label: 'OUT', kind: 'io', note: 'Single-wire data, open drain with a 10 kΩ pull-up to VCC on the module. Powered at 5 V the line idles at 5 V: use a 5 V-tolerant MCU pin.' },
  { pin: 'GND', label: '−', kind: 'ground' },
]

const DHT_SIM = (startMin: string, interval: string): string[] => [
  `host start signal: data line held low ≥ ${startMin} then released; the sensor answers 20–40 µs later with 80 µs low + 80 µs high`,
  '40 data bits, MSB first: 50 µs low then 26–28 µs high for 0 / 70 µs high for 1; checksum = sum of the four data bytes; 50 µs low end-of-frame, then the line is released',
  `the frame carries the PREVIOUS measurement (taken at the end of the last read, or at power-up): read twice after a long pause for a fresh value (datasheet note); a new start less than ${interval} after the previous one is ignored, and so is any start during the power-up settling time`,
  'temperature / humidity inputs rounded to the sensor resolution and clamped to its measuring range',
]

const ENC_PIN_INFO: PinInfo[] = [
  { pin: 'CLK', kind: 'output', note: 'Encoder contact A (to GND when closed), 10 kΩ pull-up to + on the module.' },
  { pin: 'DT', kind: 'output', note: 'Encoder contact B (to GND when closed), 10 kΩ pull-up to + on the module. Lags CLK when turned clockwise.' },
  { pin: 'SW', kind: 'output', note: 'Push switch to GND when the shaft is pressed. No pull-up on the module: enable the MCU pull-up.' },
  { pin: 'VCC', label: '+', kind: 'power', note: 'Pull-up supply (3.3 V for an STM32).' },
  { pin: 'GND', kind: 'ground', note: 'Common contact of the encoder and the switch.' },
]

export const PARTS: CatalogEntry[] = [
  // ------------------------------------------------------------ MPU-6050
  {
    type: 'mpu6050_gy521',
    label: 'MPU-6050 accelerometer + gyroscope (GY-521)',
    category: 'sensor',
    placement: 'footprint',
    pins: ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'],
    footprintOffsets: rowF(8),
    allowedRotations: [0, 180],
    // 21.2 × 16.4 mm board, header 1.4 mm from its edge: covers its eight
    // columns from row f (the header edge) back to row b
    bodyFootprint: { dCols: [0, 7], rows: ['b', 'c', 'd', 'e', 'f'] },
    obstacleHeight: 2.2, // 2.5 mm header plastic + 1.6 mm PCB + 1.4 mm header post tips = 5.5 mm
    params: [
      num('accelX', 'Acceleration X', 0, -16, 16, 0.01, 'g'),
      num('accelY', 'Acceleration Y', 0, -16, 16, 0.01, 'g'),
      num('accelZ', 'Acceleration Z', 1, -16, 16, 0.01, 'g'),
      num('gyroX', 'Rotation rate X', 0, -2000, 2000, 0.5, '°/s'),
      num('gyroY', 'Rotation rate Y', 0, -2000, 2000, 0.5, '°/s'),
      num('gyroZ', 'Rotation rate Z', 0, -2000, 2000, 0.5, '°/s'),
      num('temperature', 'Temperature', 25, -40, 85, 0.1, '°C'),
    ],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'gy521' },
    digital: {
      model: 'mpu6050',
      supplyPin: 'VCC',
      groundPin: 'GND',
      // MPU-6050 VDD ≥ 2.375 V behind the LDO
      minVdd: 2.5,
      inputs: ['SCL', 'SDA', 'AD0'],
      outputs: ['SDA', 'INT'],
      vilFrac: LDO_MODULE_VIL,
      vihFrac: LDO_MODULE_VIH,
      // VOL ≤ 0.1·VDD at 3 mA (SDA), VOH ≥ 0.9·VDD at 3 mA (INT)
      rout: 100,
      // VDD = the module's 3.3 V LDO: INT high is 3.3 V even at VCC = 5 V
      outputRail: { node: '@3v3' },
    },
    subcircuit: [
      ldo662k('VCC', '@3v3', 'GND'),
      pull('R_SCL', 'SCL', '@3v3', 4700),
      pull('R_SDA', 'SDA', '@3v3', 4700),
      pull('R_XCL', 'XCL', '@3v3', 4700),
      pull('R_XDA', 'XDA', '@3v3', 4700),
      pull('R_AD0', 'AD0', 'GND', 4700),
      // gyro + accelerometer normal-mode supply current 3.9 mA (datasheet §6.4) from the 3.3 V rail
      { id: 'IDD', model: 'resistor', pins: ['@3v3', 'GND'], params: { resistance: 850 } },
      ...powerLed('@3v3', 'GND', 1000),
    ],
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    // module input 3–5 V (regulator max 6 V); I/O abs. max VDD + 0.5 V
    ratings: { vddMin: 3.0, vddMax: 6.0, vPinMax: 3.8 },
    support: {
      level: 'partial',
      simulated: [
        I2C_SLAVE_SIM + '; address 0x68 / 0x69 from the AD0 pin',
        'register map (RM-MPU-6000A rev 4.2): WHO_AM_I = 0x68, PWR_MGMT_1 resets to 0x40 (SLEEP set — data registers stay 0 until it is cleared), DEVICE_RESET, CLKSEL 7 stops sampling, TEMP_DIS, PWR_MGMT_2 standby axes, CYCLE mode (accelerometer-only wake-ups at LP_WAKE_CTRL rate)',
        'sample rate = gyro output rate (8 kHz with DLPF_CFG 0/7, else 1 kHz) / (1 + SMPLRT_DIV); GYRO_CONFIG / ACCEL_CONFIG full-scale ranges set the scale factors (131 … 16.4 LSB/(°/s), 16384 … 2048 LSB/g); outputs saturate at ±32767',
        'big-endian ACCEL / TEMP / GYRO output registers, temperature = TEMP_OUT / 340 + 36.53 °C; the registers update only while the bus is idle, so a burst read returns one sampling instant',
        'INT pin: data-ready (and FIFO overflow) interrupt at the sample rate, INT_PIN_CFG active level / open drain / 50 µs pulse or latched / clear on any read; INT_STATUS cleared by reading it',
        'FIFO: FIFO_EN selects accel / temp / gyro words pushed at the sample rate (register order), FIFO_COUNT, FIFO_R_W pops (last byte repeated when empty), 1024-byte buffer with overflow (oldest data lost), FIFO_RESET',
      ],
      limits: [
        I2C_TIMING_LIMIT,
        'the DLPF only sets the output rate: its filtering and group delay are not applied to the (static) environment inputs — a changed input appears at the next sample',
        'DMP (motion processing firmware), self-test responses, the auxiliary I²C master / bypass on XDA / XCL, FSYNC and the external-sensor FIFO words are not simulated (logged on use)',
        'no sensor noise, offset, cross-axis sensitivity or start-up transients',
        'input thresholds are fractions of the module VCC pin fitted to the 3.3 V chip at VCC = 5 V (at VCC = 3.3 V they are lower than the real chip\'s); the INT / SDA outputs switch to the 3.3 V regulator output at any VCC',
        'the 3.9 mA supply current is a fixed load (sleep / cycle-mode currents are not modeled)',
      ],
    },
    pinInfo: MPU_PIN_INFO,
    meta: {
      partNumber: 'GY-521 (InvenSense MPU-6050)',
      manufacturer: 'InvenSense (TDK) / generic module',
      sizeMm: [21.2, 16.4, 4.4],
      tags: ['mpu6050', 'mpu-6050', 'gy-521', 'imu', 'accelerometer', 'gyroscope', 'gyro', 'i2c', 'motion', 'tilt', '6dof', 'sensor'],
      specs: [
        '3-axis accelerometer ±2 / 4 / 8 / 16 g, 3-axis gyroscope ±250 / 500 / 1000 / 2000 °/s, 16-bit',
        'I²C 400 kHz, address 0x68 (AD0 low) / 0x69',
        'on-board 3.3 V LDO and 4.7 kΩ SDA / SCL pull-ups: module VCC 3–5 V',
        'temperature sensor, 1024-byte FIFO, data-ready interrupt',
      ],
    },
    doc: 'GY-521 MPU-6050 accelerometer + gyroscope module, one 8-pin header VCC GND SCL SDA XDA XCL AD0 INT (`at` = VCC in row f; the board lies over rows b–f, wire from rows g–j). Power 3.3 V (or 5 V: on-board 3.3 V regulator); SDA/SCL already have 4.7 kΩ pull-ups to 3.3 V. I²C address 0x68 (AD0 open/low) or 0x69. The chip powers up ASLEEP: write 0x00 to PWR_MGMT_1 (0x6B) first. WHO_AM_I (0x75) = 0x68; read 14 bytes from 0x3B (ACCEL_XOUT_H … GYRO_ZOUT_L, big-endian): ±2 g = 16384 LSB/g, ±250 °/s = 131 LSB/(°/s), T = raw/340 + 36.53 °C. Acceleration, rotation rate and temperature are set in the inspector while simulating.',
  },

  // ------------------------------------------------------------ BMP280 / BME280
  {
    type: 'bmp280',
    label: 'BMP280 pressure + temperature (GY-BMP280)',
    category: 'sensor',
    placement: 'footprint',
    pins: ['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO'],
    footprintOffsets: rowF(6),
    allowedRotations: [0, 180],
    // 15.0 × 11.5 mm board over rows d–f of its six columns
    bodyFootprint: { dCols: [0, 5], rows: ['d', 'e', 'f'] },
    obstacleHeight: 2.2, // header post tips 5.5 mm above the breadboard
    params: [
      num('temperature', 'Temperature', 25, -40, 85, 0.01, '°C'),
      num('pressure', 'Pressure', 1013.25, 300, 1100, 0.01, 'hPa'),
    ],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'gy_bmx280' },
    digital: {
      model: 'bmp280',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 1.71,
      inputs: ['SCL', 'SDA', 'CSB', 'SDO'],
      outputs: ['SDA'],
      // VIL 0.2·VDDIO, VIH 0.8·VDDIO (datasheet §5.2 / Table 31)
      vilFrac: 0.2,
      vihFrac: 0.8,
      rout: 100,
    },
    subcircuit: [
      pull('R_SCL', 'SCL', 'VCC', 10000),
      pull('R_SDA', 'SDA', 'VCC', 10000),
      pull('R_CSB', 'CSB', 'VCC', 10000),
      pull('R_SDO', 'SDO', 'GND', 10000),
    ],
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 1.71, vddMax: 3.6, vPinMax: 3.9 },
    support: {
      level: 'partial',
      simulated: [...BMX_SIM('BMP280', false), 'address 0x76 / 0x77 from the SDO pin'],
      limits: [
        I2C_TIMING_LIMIT,
        'SPI (CSB low) and the 3-wire SPI mode are not simulated (logged)',
        'no sensor noise, drift or self-heating; the measurement time is the datasheet typical value',
        'the IIR filter memory starts from the first conversion after reset',
      ],
    },
    pinInfo: BMX_PIN_INFO('BMP280'),
    meta: {
      partNumber: 'GY-BMP280-3.3 (Bosch BMP280)',
      manufacturer: 'Bosch Sensortec / generic module',
      sizeMm: [15, 11.5, 4.2],
      tags: ['bmp280', 'barometer', 'pressure', 'altitude', 'temperature', 'i2c', 'bosch', 'gy-bmp280', 'sensor'],
      specs: [
        'pressure 300–1100 hPa (±1 hPa abs.), temperature −40…85 °C',
        '16–20 bit with oversampling, IIR filter, forced / normal mode',
        'I²C address 0x76 (SDO low) / 0x77, chip id 0x58',
        '3.3 V module (no regulator), 10 kΩ pull-ups on SDA / SCL / CSB',
      ],
    },
    doc: 'GY-BMP280 barometric pressure / temperature module, 6-pin header VCC GND SCL SDA CSB SDO (`at` = VCC in row f, board over rows d–f). 3.3 V ONLY (no regulator). I²C address 0x76 (SDO pulled low on the board; tie SDO to VCC for 0x77); SDA/SCL have 10 kΩ pull-ups. Chip id register 0xD0 = 0x58. Read the trimming parameters from 0x88, set ctrl_meas (0xF4), read 0xF7–0xFC and convert with the datasheet compensation formulas. Temperature and pressure are set in the inspector.',
  },
  {
    type: 'bme280',
    label: 'BME280 humidity + pressure + temperature (GY-BME280)',
    category: 'sensor',
    placement: 'footprint',
    pins: ['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO'],
    footprintOffsets: rowF(6),
    allowedRotations: [0, 180],
    bodyFootprint: { dCols: [0, 5], rows: ['d', 'e', 'f'] },
    obstacleHeight: 2.2, // header post tips 5.5 mm above the breadboard
    params: [
      num('temperature', 'Temperature', 25, -40, 85, 0.01, '°C'),
      num('pressure', 'Pressure', 1013.25, 300, 1100, 0.01, 'hPa'),
      num('humidity', 'Relative humidity', 50, 0, 100, 0.1, '%RH'),
    ],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'gy_bmx280' },
    digital: {
      model: 'bme280',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 1.71,
      inputs: ['SCL', 'SDA', 'CSB', 'SDO'],
      outputs: ['SDA'],
      vilFrac: 0.2,
      vihFrac: 0.8,
      rout: 100,
    },
    subcircuit: [
      pull('R_SCL', 'SCL', 'VCC', 10000),
      pull('R_SDA', 'SDA', 'VCC', 10000),
      pull('R_CSB', 'CSB', 'VCC', 10000),
      pull('R_SDO', 'SDO', 'GND', 10000),
    ],
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 1.71, vddMax: 3.6, vPinMax: 3.9 },
    support: {
      level: 'partial',
      simulated: [...BMX_SIM('BME280', true), 'address 0x76 / 0x77 from the SDO pin'],
      limits: [
        I2C_TIMING_LIMIT,
        'SPI (CSB low) and the 3-wire SPI mode are not simulated (logged)',
        'no sensor noise, drift, humidity hysteresis or response time; the measurement time is the datasheet typical value',
        'the IIR filter memory starts from the first conversion after reset',
      ],
    },
    pinInfo: BMX_PIN_INFO('BME280'),
    meta: {
      partNumber: 'GY-BME280-3.3 (Bosch BME280)',
      manufacturer: 'Bosch Sensortec / generic module',
      sizeMm: [15, 11.5, 4.2],
      tags: ['bme280', 'humidity', 'hygrometer', 'barometer', 'pressure', 'temperature', 'i2c', 'bosch', 'weather', 'sensor'],
      specs: [
        'humidity 0–100 %RH (±3 %), pressure 300–1100 hPa, temperature −40…85 °C',
        'oversampling ×1…×16, IIR filter, forced / normal mode',
        'I²C address 0x76 (SDO low) / 0x77, chip id 0x60',
        '3.3 V module (no regulator), 10 kΩ pull-ups on SDA / SCL / CSB',
      ],
    },
    doc: 'GY-BME280 humidity / pressure / temperature module, 6-pin header VCC GND SCL SDA CSB SDO (`at` = VCC in row f, board over rows d–f). 3.3 V ONLY. I²C address 0x76 (SDO pulled low on the board; 0x77 with SDO high); SDA/SCL have 10 kΩ pull-ups. Chip id (0xD0) = 0x60. Write ctrl_hum (0xF2) BEFORE ctrl_meas (0xF4); read 0xF7–0xFE and convert with the Bosch compensation (trimming at 0x88–0xA1 and 0xE1–0xE7). Temperature, pressure and humidity are set in the inspector.',
  },

  // ------------------------------------------------------------ BH1750
  {
    type: 'bh1750',
    label: 'BH1750 ambient light sensor (GY-302)',
    category: 'sensor',
    placement: 'footprint',
    pins: ['VCC', 'GND', 'SCL', 'SDA', 'ADDR'],
    footprintOffsets: rowF(5),
    allowedRotations: [0, 180],
    // 13.9 × 18.5 mm board, header on a short edge: rows a–f of its columns
    bodyFootprint: { dCols: [0, 4], rows: ['a', 'b', 'c', 'd', 'e', 'f'] },
    obstacleHeight: 2.2, // header post tips 5.5 mm above the breadboard
    params: [num('illuminance', 'Illuminance', 300, 0, 100000, 1, 'lx')],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'gy302' },
    digital: {
      model: 'bh1750',
      supplyPin: 'VCC',
      groundPin: 'GND',
      // BH1750FVI VCC ≥ 2.4 V behind the LDO
      minVdd: 2.6,
      inputs: ['SCL', 'SDA', 'ADDR'],
      outputs: ['SDA'],
      vilFrac: LDO_MODULE_VIL,
      vihFrac: LDO_MODULE_VIH,
      rout: 100,
      // the BH1750 runs from the module's 3.3 V LDO
      outputRail: { node: '@3v3' },
    },
    subcircuit: [
      ldo662k('VCC', '@3v3', 'GND'),
      pull('R_SCL', 'SCL', '@3v3', 4700),
      pull('R_SDA', 'SDA', '@3v3', 4700),
      pull('R_ADDR', 'ADDR', 'GND', 10000),
    ],
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 3.0, vddMax: 6.0, vPinMax: 4.5 },
    support: {
      level: 'partial',
      simulated: [
        I2C_SLAVE_SIM + '; address 0x23 (ADDR low) / 0x5C (ADDR high)',
        'instruction set: power down / power on / reset (clears the data register), continuous and one-time H / H2 / L resolution modes (one-time modes power down after the measurement), MTreg change (31…254)',
        'measurement time 120 ms (H, H2) / 16 ms (L) typical, scaled by MTreg / 69; the result register updates at the end of each measurement',
        'count = illuminance × 1.2 × MTreg / 69 (× 2 in H2 mode), saturating at 65535; two-byte big-endian read',
      ],
      limits: [
        I2C_TIMING_LIMIT,
        'the L-resolution result is quantised to 4-count steps (the datasheet gives 4 lx resolution, not the exact L-mode quantisation)',
        'no spectral response, noise or dark-current offset; logic levels referenced to the module VCC (see the GY-521 note)',
      ],
    },
    pinInfo: [
      { pin: 'VCC', kind: 'power', note: 'Module supply 3–5 V (on-board 3.3 V regulator).' },
      { pin: 'GND', kind: 'ground' },
      { pin: 'SCL', kind: 'input', functions: ['I2C_SCL'], note: 'I²C clock — 4.7 kΩ pull-up to the on-board 3.3 V.' },
      { pin: 'SDA', kind: 'io', functions: ['I2C_SDA'], note: 'I²C data, open drain — 4.7 kΩ pull-up to the on-board 3.3 V.' },
      { pin: 'ADDR', kind: 'input', note: 'Address select: low / open = 0x23 (pulled down on the board), high = 0x5C.' },
    ],
    meta: {
      partNumber: 'GY-302 (ROHM BH1750FVI)',
      manufacturer: 'ROHM / generic module',
      sizeMm: [13.9, 18.5, 4.4],
      tags: ['bh1750', 'gy-302', 'light', 'lux', 'ambient light', 'illuminance', 'i2c', 'photometer', 'sensor'],
      specs: ['1–65535 lx, 1 lx (H) / 0.5 lx (H2) / 4 lx (L) resolution', 'measurement 120 ms (H) / 16 ms (L)', 'I²C 0x23 / 0x5C', '3–5 V module with 3.3 V regulator'],
    },
    doc: 'GY-302 BH1750 ambient light sensor, 5-pin header VCC GND SCL SDA ADDR (`at` = VCC in row f; the board covers rows a–f of its columns). 3–5 V (on-board 3.3 V regulator and SDA/SCL pull-ups). I²C address 0x23 (ADDR open) or 0x5C (ADDR high). Send one opcode byte: 0x01 power on, 0x10 continuous high-resolution mode (1 lx, 120 ms per measurement); then read 2 bytes: lux = ((high << 8) | low) / 1.2. Illuminance is set in the inspector.',
  },

  // ------------------------------------------------------------ DHT11 / DHT22
  {
    type: 'dht11',
    label: 'DHT11 temperature + humidity module',
    category: 'sensor',
    placement: 'footprint',
    pins: ['VCC', 'DATA', 'GND'],
    footprintOffsets: rowF(3),
    allowedRotations: [0, 180],
    // 23.4 × 14 mm board with the sensor lying on it, header on a short edge;
    // the far end reaches over the top − rail (rails cannot be declared)
    bodyFootprint: { dCols: [-1, 3], rows: ['a', 'b', 'c', 'd', 'e', 'f'] },
    obstacleHeight: 3.8, // 2.5 + 1.6 + 5.5 mm sensor body = 9.6 mm
    params: [
      num('temperature', 'Temperature', 25, -20, 60, 0.1, '°C'),
      num('humidity', 'Relative humidity', 50, 0, 100, 0.1, '%RH'),
    ],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'dht_module' },
    digital: {
      model: 'dht11',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 3.0,
      inputs: ['DATA'],
      outputs: ['DATA'],
      vilFrac: 0.3,
      vihFrac: 0.6,
      rout: 100,
    },
    subcircuit: [pull('R_PULL', 'DATA', 'VCC', 10000), ...powerLed('VCC', 'GND', 1000)],
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 3.3, vddMax: 5.5, vPinMax: 5.8 },
    support: {
      level: 'partial',
      simulated: [...DHT_SIM('18 ms', '1 s'), 'DHT11 frame: integer humidity and temperature (decimal bytes 0), 0…50 °C, 20…90 %RH, 1 °C / 1 %RH resolution'],
      limits: [
        'timing is fixed at the datasheet typical values (no part-to-part spread)',
        'no sensor accuracy error (±2 °C / ±5 %RH), response time or hysteresis',
        'a start pulse longer than the datasheet maximum is still accepted',
      ],
    },
    pinInfo: DHT_PIN_INFO('DHT11', '3.3–5.5 V'),
    meta: {
      partNumber: 'DHT11 module (Aosong DHT11)',
      manufacturer: 'Aosong / generic module',
      sizeMm: [23.4, 14, 9.6],
      tags: ['dht11', 'dht', 'humidity', 'temperature', 'single wire', 'one wire', 'hygrometer', 'sensor'],
      specs: ['0–50 °C ±2 °C, 20–90 %RH ±5 %', 'single-wire 40-bit frame, ≥ 1 s between reads', '3.3–5.5 V, 10 kΩ pull-up and power LED on the module'],
    },
    doc: 'DHT11 temperature / humidity module, 3 pins + OUT − (VCC DATA GND; `at` = VCC in row f, the board covers rows a–f). The module has the 10 kΩ data pull-up. Protocol: drive DATA low ≥ 18 ms, release, then time the sensor\'s pulses (80 µs low/high answer, 40 bits: ~27 µs high = 0, ~70 µs high = 1) with a µs timer; byte 0 = humidity %, byte 2 = °C, byte 4 = checksum. Read at most once per second; the frame holds the previous measurement. Set temperature and humidity in the inspector.',
  },
  {
    type: 'dht22',
    label: 'DHT22 / AM2302 temperature + humidity module',
    category: 'sensor',
    placement: 'footprint',
    pins: ['VCC', 'DATA', 'GND'],
    footprintOffsets: rowF(3),
    allowedRotations: [0, 180],
    // 30.3 × 18 mm board, the white sensor lying on it (reaching past the
    // top rails, which cannot be declared)
    bodyFootprint: { dCols: [-2, 4], rows: ['a', 'b', 'c', 'd', 'e', 'f'] },
    obstacleHeight: 4.7, // 2.5 + 1.6 + 7.7 mm sensor body = 11.8 mm
    params: [
      num('temperature', 'Temperature', 25, -40, 80, 0.1, '°C'),
      num('humidity', 'Relative humidity', 50, 0, 100, 0.1, '%RH'),
    ],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'dht_module' },
    digital: {
      model: 'dht22',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 3.0,
      inputs: ['DATA'],
      outputs: ['DATA'],
      vilFrac: 0.3,
      vihFrac: 0.6,
      rout: 100,
    },
    subcircuit: [pull('R_PULL', 'DATA', 'VCC', 10000)],
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 3.3, vddMax: 6.0, vPinMax: 6.3 },
    support: {
      level: 'partial',
      simulated: [...DHT_SIM('0.8 ms (datasheet T_be min, typ. 1 ms)', '2 s'), 'DHT22 frame: humidity × 10 and temperature × 10 as 16-bit values (sign bit 15 for negative temperatures), −40…80 °C, 0…100 %RH, 0.1 resolution'],
      limits: [
        'timing is fixed at the datasheet typical values (no part-to-part spread)',
        'no sensor accuracy error (±0.5 °C / ±2 %RH), response time or hysteresis',
        'a start pulse longer than the datasheet maximum (20 ms) is still accepted',
      ],
    },
    pinInfo: DHT_PIN_INFO('AM2302', '3.3–6 V'),
    meta: {
      partNumber: 'DHT22 / AM2302 module',
      manufacturer: 'Aosong / generic module',
      sizeMm: [30.3, 18, 11.8],
      tags: ['dht22', 'am2302', 'dht', 'humidity', 'temperature', 'single wire', 'hygrometer', 'sensor'],
      specs: ['−40…80 °C ±0.5 °C, 0–100 %RH ±2 %', 'single-wire 40-bit frame, 0.1 resolution, ≥ 2 s between reads', '3.3–6 V, 10 kΩ pull-up on the module'],
    },
    doc: 'DHT22 (AM2302) temperature / humidity module, 3 pins + OUT − (VCC DATA GND; `at` = VCC in row f, the board covers rows a–f). The module has the 10 kΩ data pull-up. Protocol: drive DATA low ≥ 1 ms, release, then time the answer (80 µs low/high) and 40 bits (~27 µs high = 0, ~70 µs high = 1) with a µs timer (TIM2 or DWT->CYCCNT): humidity = (b0 << 8 | b1) / 10 %, temperature = (b2 & 0x7F) << 8 | b3) / 10 °C (bit 7 of b2 = negative), b4 = checksum. Read at most every 2 s; the frame holds the previous measurement.',
  },

  // ------------------------------------------------------------ DS18B20
  {
    type: 'ds18b20',
    label: 'Temperature sensor 1-Wire (DS18B20)',
    category: 'sensor',
    placement: 'leads',
    // TO-92, flat face toward you, leads left → right
    pins: ['GND', 'DQ', 'VDD'],
    params: [num('temperature', 'Temperature', 25, -55, 125, 0.01, '°C')],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'to92' },
    digital: {
      model: 'ds18b20',
      supplyPin: 'VDD',
      groundPin: 'GND',
      minVdd: 3.0,
      inputs: ['DQ'],
      outputs: ['DQ'],
      // VIL ≤ 0.8 V, VIH ≥ 2.2 V (TTL-compatible input)
      vilFrac: 0.2,
      vihFrac: 0.5,
      // VOL 0.4 V at 4 mA
      rout: 100,
    },
    supplyPins: { plus: ['VDD'], minus: ['GND'] },
    ratings: { vddMin: 3.0, vddMax: 5.5, vPinMax: 6.0 },
    support: {
      level: 'partial',
      simulated: [
        '1-Wire slave on DQ (open drain): reset ≥ 480 µs → presence pulse (15–60 µs wait, 60–240 µs low); write slots sampled 30 µs after the falling edge; read slots answered by holding DQ low for 0-bits; LSB first',
        'ROM commands READ ROM (0x33), MATCH ROM (0x55), SKIP ROM (0xCC), SEARCH ROM (0xF0) and ALARM SEARCH (0xEC) with a fixed 64-bit ROM code (family 0x28, CRC8)',
        'CONVERT T (0x44): 93.75 / 187.5 / 375 / 750 ms for 9–12 bit; read slots return 0 while converting, 1 when done; power-up temperature register 85 °C',
        'READ SCRATCHPAD (0xBE, 9 bytes with Dallas CRC8), WRITE SCRATCHPAD (0x4E: TH, TL, configuration), COPY SCRATCHPAD (0x48, 10 ms EEPROM write), RECALL E² (0xB8), READ POWER SUPPLY (0xB4)',
        'temperature input quantised to the configured resolution (two\'s complement, 1/16 °C per LSB, undefined low bits 0) and clamped to −55…125 °C; alarm flag from TH / TL',
      ],
      limits: [
        'parasite power (VDD to GND, powered from DQ) is not simulated: the part stays silent and the condition is logged',
        'timing fixed at datasheet typical values; overdrive and slot-timing violations are not detected',
        'no conversion error (±0.5 °C) or self-heating; the TH / TL / configuration EEPROM is kept per component for the session',
      ],
    },
    pinInfo: [
      { pin: 'GND', kind: 'ground', note: 'Ground (left lead, flat face toward you).' },
      { pin: 'DQ', kind: 'io', note: 'Data in/out, open drain: needs an external 4.7 kΩ pull-up to VDD.' },
      { pin: 'VDD', kind: 'power', note: '3.0–5.5 V (external power mode).' },
    ],
    meta: {
      partNumber: 'DS18B20',
      manufacturer: 'Maxim Integrated (Analog Devices)',
      sizeMm: [4.8, 3.8, 4.8],
      tags: ['ds18b20', '18b20', '1-wire', 'onewire', 'dallas', 'temperature', 'thermometer', 'to-92', 'sensor'],
      specs: ['−55…125 °C, ±0.5 °C (−10…85 °C)', '9–12 bit, 750 ms conversion at 12 bit', '1-Wire, unique 64-bit ROM code', '3.0–5.5 V, 4.7 kΩ pull-up on DQ'],
    },
    doc: 'DS18B20 1-Wire digital thermometer, TO-92 with 3 leads GND DQ VDD (flat face toward you, left → right). Power VDD (3.3 V or 5 V) and put a 4.7 kΩ pull-up from DQ to VDD — without it the bus never rises and the sensor stays silent. Bit-bang 1-Wire on an open-drain GPIO with µs delays (DWT->CYCCNT or a timer): reset 480 µs + presence, SKIP ROM 0xCC, CONVERT T 0x44, wait 750 ms (12 bit), reset, 0xCC, READ SCRATCHPAD 0xBE, 9 bytes: T = (int16)(b1 << 8 | b0) / 16 °C, b8 = CRC8. Temperature is set in the inspector.',
  },

  // ------------------------------------------------------------ HC-SR04
  {
    type: 'hcsr04',
    label: 'HC-SR04 ultrasonic distance sensor',
    category: 'sensor',
    placement: 'footprint',
    pins: ['VCC', 'TRIG', 'ECHO', 'GND'],
    // The module stands on its header with the two Ø16 mm transducers facing
    // BACK over rows c–e (facing front they would cover rows g–j, the only
    // free holes of the header strips). Seen from the transducer side the
    // silkscreen reads Vcc Trig Echo Gnd left → right, so from the front of
    // the breadboard (component side) the order is GND ECHO TRIG VCC: VCC is
    // the anchor and the other pins run to its LEFT.
    footprintOffsets: [
      { dCol: 0, row: 'f' },
      { dCol: -1, row: 'f' },
      { dCol: -2, row: 'f' },
      { dCol: -3, row: 'f' },
    ],
    allowedRotations: [0, 180],
    // 45 × 20 mm board centred on the header (dCol −1.5)
    bodyFootprint: { dCols: [-10, 7], rows: ['c', 'd', 'e', 'f'] },
    obstacleHeight: 9.2, // 2.5 mm header block + 20 mm board = 22.5 mm
    params: [
      num('distance', 'Distance to obstacle', 100, 1, 500, 0.1, 'cm'),
      num('temperature', 'Air temperature', 20, -20, 60, 0.5, '°C'),
    ],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'hcsr04' },
    digital: {
      model: 'hcsr04',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 4.5,
      inputs: ['TRIG'],
      outputs: ['ECHO'],
      // TTL-compatible trigger input (3.3 V logic triggers it)
      vilFrac: 0.2,
      vihFrac: 0.5,
      rout: 100,
    },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 4.5, vddMax: 5.5, vPinMax: 5.5 },
    support: {
      level: 'partial',
      simulated: [
        'TRIG high ≥ 10 µs starts a measurement on its falling edge (triggers while busy are ignored)',
        'ECHO (push-pull, VCC level) rises 0.45 ms after the trigger (8-cycle 40 kHz burst + start-up) and stays high for the round trip 2·d / c, c = 331.3·√(1 + T/273.15) m/s (343.2 m/s at 20 °C)',
        'range 2–400 cm: beyond 400 cm no echo returns and ECHO times out after 38 ms; closer than 2 cm the echo is reported at 2 cm',
        '5 V part: ECHO drives VCC (5 V) into the MCU pin — the ERC and the run-time pin checks flag a non-5 V-tolerant pin',
      ],
      limits: [
        'single flat obstacle straight ahead: no beam angle (15°), multipath, soft surfaces or missed echoes',
        'the 0.45 ms burst delay is a typical measured value (not in the datasheet)',
        'below 4.5 V the module stays off (the real one becomes unreliable)',
      ],
    },
    pinInfo: [
      { pin: 'VCC', kind: 'power', note: '5 V supply (4.5–5.5 V; does not work from 3.3 V).' },
      { pin: 'TRIG', kind: 'input', note: 'Trigger: a ≥ 10 µs high pulse starts a measurement (3.3 V logic is enough).' },
      { pin: 'ECHO', kind: 'output', note: 'Echo pulse, 5 V high for 58 µs per cm. Use a 5 V-tolerant pin (STM32 PA8–PA15, PB3, PB4, PB6–PB15) or a divider.' },
      { pin: 'GND', kind: 'ground' },
    ],
    meta: {
      partNumber: 'HC-SR04',
      manufacturer: 'generic module',
      sizeMm: [45, 20, 15],
      tags: ['hc-sr04', 'hcsr04', 'ultrasonic', 'sonar', 'distance', 'range', 'echo', 'sensor'],
      specs: ['2–400 cm, 3 mm resolution, 15° beam', '40 kHz, 10 µs trigger, echo 58 µs/cm', '5 V, 15 mA', 'echo timeout ≈ 38 ms without an obstacle'],
    },
    doc: 'HC-SR04 ultrasonic distance sensor standing on its 4-pin header (`at` = VCC in row f; TRIG, ECHO and GND follow in the next three columns to the LEFT — you see the component side, the transducers face back over rows c–e). Needs 5 V. Pulse TRIG high for ≥ 10 µs, then measure the ECHO high time (µs): distance cm = t × 0.0343 / 2 (≈ t / 58). ECHO is a 5 V signal: connect it to a 5 V-tolerant STM32 pin (e.g. PB6 = TIM4_CH1 for input capture). No echo (beyond 4 m) = 38 ms pulse. Distance and air temperature are set in the inspector.',
  },

  // ------------------------------------------------------------ KY-040
  {
    type: 'ky040_encoder',
    label: 'Rotary encoder module (KY-040)',
    category: 'sensor',
    placement: 'footprint',
    pins: ['CLK', 'DT', 'SW', 'VCC', 'GND'],
    footprintOffsets: rowF(5),
    allowedRotations: [0, 180],
    // 19 × 26 mm board, header on a short edge
    bodyFootprint: { dCols: [-1, 5], rows: ['a', 'b', 'c', 'd', 'e', 'f'] },
    obstacleHeight: 11.5, // 2.5 + 1.6 + 6.5 mm encoder + 18.4 mm shaft = 29.0 mm
    params: [
      { key: 'position', label: 'Position', kind: 'number', default: 0, min: -1000, max: 1000, step: 1, unit: 'detents', runtime: true },
      { key: 'pressed', label: 'Pressed', kind: 'boolean', default: false, runtime: true },
      num('turnRate', 'Turning speed', 10, 1, 100, 1, 'detents/s'),
    ],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'ky040' },
    digital: {
      model: 'ky040',
      supplyPin: 'VCC',
      groundPin: 'GND',
      // mechanical contacts: no supply needed
      minVdd: 0,
      inputs: [],
      outputs: ['CLK', 'DT', 'SW'],
      // closed contact ≈ 1 Ω
      rout: 1,
    },
    subcircuit: [pull('R_CLK', 'CLK', 'VCC', 10000), pull('R_DT', 'DT', 'VCC', 10000)],
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMax: 5.5 },
    support: {
      level: 'partial',
      simulated: [
        'EC11-type incremental encoder, 20 detents per turn: contacts A (CLK) and B (DT) close to GND; at every detent both are open (high through the 10 kΩ module pull-ups)',
        'each detent step is one full quadrature cycle — clockwise: CLK falls, DT falls, CLK rises, DT rises (CLK leads by 90°); counter-clockwise the reverse',
        'changing the position param turns the shaft at the set speed: every detent\'s four edges are spread over its time slot, steps queue up when the position changes again',
        'push switch SW closes to GND while pressed (no pull-up on the module)',
      ],
      limits: [
        'no contact bounce (real EC11 contacts bounce for up to a few ms — firmware must still debounce for real hardware)',
        'the shaft turns at a constant speed (no acceleration)',
      ],
    },
    pinInfo: ENC_PIN_INFO,
    meta: {
      partNumber: 'KY-040 (EC11 encoder)',
      manufacturer: 'generic module',
      sizeMm: [19, 26, 29],
      tags: ['ky-040', 'ky040', 'encoder', 'rotary encoder', 'quadrature', 'knob', 'ec11', 'input', 'sensor'],
      specs: ['20 detents / 20 pulses per turn, push switch', 'quadrature A/B with 10 kΩ pull-ups', 'module supply (pull-ups) 3.3–5 V'],
    },
    doc: 'KY-040 rotary encoder module, 5-pin header CLK DT SW + GND (`at` = CLK in row f; the board covers rows a–f). Power + from 3.3 V (pull-ups for CLK and DT are on the board). Each detent is one full quadrature cycle on CLK/DT (clockwise: CLK falls first) — use an STM32 timer in encoder mode (TI12 counts 4 per detent) or EXTI on CLK and read DT. SW shorts to GND when pressed: enable the MCU pull-up. Turn it by changing Position (detents) in the inspector; Pressed holds the button.',
  },

  // ------------------------------------------------------------ KY-023 joystick
  {
    type: 'joystick_xy',
    label: 'Analog joystick (KY-023)',
    category: 'sensor',
    placement: 'footprint',
    pins: ['GND', 'VCC', 'VRX', 'VRY', 'SW'],
    footprintOffsets: rowF(5),
    allowedRotations: [0, 180],
    // 26 × 34 mm board, header on a short edge
    bodyFootprint: { dCols: [-3, 7], rows: ['a', 'b', 'c', 'd', 'e', 'f'] },
    obstacleHeight: 13.0,
    params: [
      { key: 'x', label: 'Stick X', kind: 'number', default: 0, min: -100, max: 100, step: 1, unit: '%', runtime: true },
      { key: 'y', label: 'Stick Y', kind: 'number', default: 0, min: -100, max: 100, step: 1, unit: '%', runtime: true },
      { key: 'pressed', label: 'Pressed', kind: 'boolean', default: false, runtime: true },
    ],
    sim: { kind: 'device', model: 'sensors_joystick' },
    visual: { shape: 'ky023' },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    support: {
      level: 'partial',
      simulated: [
        'two 10 kΩ linear potentiometers between +5V and GND: VRX / VRY are their wipers (half the supply at rest, the full range at the stops)',
        'push switch SW closes to GND while pressed, contact = 20 S closed / 1 nS open',
        'stick position and button adjustable while running',
      ],
      limits: [
        'no mechanical dead zone, centring error or spring dynamics; ideal linear taper',
        'no pull-up on SW (as on the module): enable the MCU pull-up',
      ],
    },
    pinInfo: [
      { pin: 'GND', kind: 'ground' },
      { pin: 'VCC', label: '+5V', kind: 'power', note: 'Potentiometer supply. With an STM32 use 3.3 V so VRX / VRY stay within the ADC range.' },
      { pin: 'VRX', label: 'VRx', kind: 'analog', note: 'X potentiometer wiper (analog).' },
      { pin: 'VRY', label: 'VRy', kind: 'analog', note: 'Y potentiometer wiper (analog).' },
      { pin: 'SW', kind: 'output', note: 'Push switch to GND (press the stick). No pull-up on the module.' },
    ],
    meta: {
      partNumber: 'KY-023 (PS2-style thumb joystick)',
      manufacturer: 'generic module',
      sizeMm: [26, 34, 32],
      tags: ['joystick', 'ky-023', 'thumbstick', 'analog stick', 'potentiometer', 'adc', 'xy', 'input', 'sensor'],
      specs: ['two 10 kΩ potentiometers (X, Y) + push switch', 'analog outputs 0…VCC', '3.3–5 V'],
    },
    doc: 'KY-023 analog joystick module, 5-pin header GND +5V VRx VRy SW (`at` = GND in row f; the board covers rows a–f). VRX / VRY are potentiometer wipers between +5V and GND — feed +5V from 3.3 V for an STM32 and read them with two ADC channels (≈ 2048 at rest). SW shorts to GND when the stick is pressed: use the MCU pull-up. Stick X/Y (−100…100 %) and Pressed are set in the inspector.',
  },

  // ------------------------------------------------------------ A3144 Hall switch
  {
    type: 'hall_a3144',
    label: 'Hall effect switch (A3144)',
    category: 'sensor',
    placement: 'leads',
    // "UA" SIP-3, branded face toward you: 1 VCC, 2 GND, 3 OUT
    pins: ['VCC', 'GND', 'OUT'],
    params: [num('field', 'Magnetic field', 0, -100, 100, 0.5, 'mT')],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'hall_ua' },
    digital: {
      model: 'a3144',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 4.5,
      inputs: [],
      outputs: ['OUT'],
      // VOUT(SAT) 175 mV typ. at 20 mA
      rout: 9,
    },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 4.5, vddMax: 24, vPinMax: 24, iMax: 0.025 },
    support: {
      level: 'partial',
      simulated: [
        'unipolar Hall switch: output transistor ON (OUT pulled low, open collector) when the south-pole field on the branded face exceeds B_OP = 15 mT, OFF below B_RP = 9.5 mT (hysteresis 5.5 mT); a north pole never switches it on',
        'open-collector output: needs a pull-up (external resistor or the MCU pull-up); 9 Ω saturation resistance',
        'supply 4.5–24 V: below 4.5 V the output stays off',
      ],
      limits: [
        'operate / release points fixed inside the datasheet range (B_OP 7–35 mT, B_RP 5–33 mT): no temperature drift or part spread',
        'switching is instantaneous (real: 2 µs rise / fall); no output current limit',
      ],
    },
    pinInfo: [
      { pin: 'VCC', kind: 'power', note: '4.5–24 V (5 V from the Blue Pill 5V pin).' },
      { pin: 'GND', kind: 'ground' },
      { pin: 'OUT', kind: 'output', note: 'Open collector: low while a magnet\'s south pole faces the branded side. Needs a pull-up (MCU pull-up to 3.3 V is fine).' },
    ],
    meta: {
      partNumber: 'A3144EUA',
      manufacturer: 'Allegro MicroSystems (and second sources)',
      sizeMm: [4.06, 1.52, 3.05],
      tags: ['a3144', 'hall', 'hall effect', 'magnet', 'magnetic', 'switch', 'unipolar', 'sensor'],
      specs: ['unipolar switch, B_OP 7–35 mT, B_RP 5–33 mT', 'open collector, 25 mA', '4.5–24 V'],
    },
    doc: 'A3144 Hall effect switch, 3 leads VCC GND OUT (branded face toward you, left → right). Power 4.5–24 V (use 5 V); OUT is open collector: pull it up (e.g. the STM32 input pull-up to 3.3 V) — it goes LOW while a magnet\'s south pole is near the branded face (> 15 mT) and releases below 9.5 mT. Set the magnetic field (mT) in the inspector.',
  },

  // ------------------------------------------------------------ ACS712
  {
    type: 'acs712_5a',
    label: 'ACS712 ±5 A current sensor module',
    category: 'sensor',
    placement: 'footprint',
    // header VCC OUT GND (left → right) + the two load wires screwed into
    // the terminal block, plugged in beside the board
    pins: ['VCC', 'OUT', 'GND', 'IP+', 'IP-'],
    footprintOffsets: [
      { dCol: 0, row: 'f' },
      { dCol: 1, row: 'f' },
      { dCol: 2, row: 'f' },
      { dCol: -2, row: 'f' },
      { dCol: 4, row: 'f' },
    ],
    allowedRotations: [0, 180],
    // 31 × 13 mm board from the header back over rows a–f (and past the edge)
    bodyFootprint: { dCols: [-1, 3], rows: ['a', 'b', 'c', 'd', 'e', 'f'] },
    obstacleHeight: 5.8, // 2.5 + 1.6 + 10 mm terminal block + clamp screw heads = 14.5 mm
    sim: { kind: 'device', model: 'sensors_acs712' },
    visual: { shape: 'acs712' },
    subcircuit: [...powerLed('VCC', 'GND', 1000)],
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 4.5, vddMax: 5.5, iMax: 5 },
    support: {
      level: 'partial',
      simulated: [
        'primary conductor IP+ → IP−: 1.2 mΩ in the load path; the sensor measures the current through it',
        'OUT = VCC/2 + 185 mV/A × I × (VCC / 5 V) (ratiometric ACS712ELCTR-05B), driven through 1 Ω, clamped to the supply rails',
        'supply current 10 mA; module power LED',
        'warns while VCC is outside 4.5–5.5 V or |I| exceeds the ±5 A range',
      ],
      limits: [
        'no output noise (21 mV p-p typ.), offset or sensitivity error, no temperature drift',
        'bandwidth not modeled (the analog step limits it); no magnetic hysteresis',
        'the load current really flows through the two breadboard strips of IP+ / IP−: a breadboard contact is rated about 1 A',
      ],
    },
    pinInfo: [
      { pin: 'VCC', kind: 'power', note: '5 V supply (4.5–5.5 V).' },
      { pin: 'OUT', kind: 'analog', note: 'Analog output: 2.5 V at 0 A, +185 mV per ampere (at VCC = 5 V). Above +4.3 A it exceeds 3.3 V.' },
      { pin: 'GND', kind: 'ground' },
      { pin: 'IP+', kind: 'passive', note: 'Current input (load wire from the terminal block, left screw). Current IP+ → IP− reads positive.' },
      { pin: 'IP-', label: 'IP−', kind: 'passive', note: 'Current output (load wire from the terminal block, right screw).' },
    ],
    meta: {
      partNumber: 'ACS712ELCTR-05B module',
      manufacturer: 'Allegro MicroSystems / generic module',
      sizeMm: [31, 13, 14.5],
      tags: ['acs712', 'current sensor', 'hall', 'ammeter', 'current', 'analog', 'adc', 'isolated', 'sensor'],
      specs: ['±5 A, 185 mV/A, zero = VCC/2', '1.2 mΩ primary, 2.1 kV isolation', '5 V supply, 80 kHz bandwidth'],
    },
    doc: 'ACS712 ±5 A Hall current sensor module: 3-pin header VCC OUT GND (`at` = VCC in row f, the board lies over rows a–f) plus the two load wires from its screw terminal, plugged in two columns left (IP+) and two columns right of the header (IP−) in row f. Put it IN SERIES with the load (current IP+ → IP−). Power 5 V; OUT = 2.5 V + 0.185 V/A — read it with an ADC (it exceeds 3.3 V above +4.3 A). Breadboard strips carry about 1 A.',
  },

  // ------------------------------------------------------------ voltage sensor
  {
    type: 'voltage_sensor',
    label: 'Voltage sensor module 0–25 V (divider)',
    category: 'sensor',
    placement: 'footprint',
    // header S + − (left → right) + the two input wires from the terminal block
    pins: ['S', 'NC', 'GND', 'VIN', 'GND_IN'],
    footprintOffsets: [
      { dCol: 0, row: 'f' },
      { dCol: 1, row: 'f' },
      { dCol: 2, row: 'f' },
      { dCol: -2, row: 'f' },
      { dCol: 4, row: 'f' },
    ],
    allowedRotations: [0, 180],
    internalBridges: [['GND', 'GND_IN']],
    bodyFootprint: { dCols: [-1, 3], rows: ['a', 'b', 'c', 'd', 'e', 'f'] },
    obstacleHeight: 5.8, // the same terminal block as the ACS712 module
    sim: { kind: 'device', model: 'sensors_passive' },
    visual: { shape: 'voltage_sensor' },
    subcircuit: [
      { id: 'R1', model: 'resistor', pins: ['VIN', 'S'], params: { resistance: 30000 } },
      { id: 'R2', model: 'resistor', pins: ['S', 'GND'], params: { resistance: 7500 } },
    ],
    support: {
      level: 'full',
      simulated: ['30 kΩ / 7.5 kΩ divider: S = VIN / 5 (unloaded), output resistance 6 kΩ', 'the "+" header pin is not connected, "−" is the input ground'],
      limits: ['resistor tolerance (1 %) and power rating not modeled', 'no input protection: a 3.3 V ADC reads at most 16.5 V input'],
    },
    pinInfo: [
      { pin: 'S', kind: 'analog', note: 'Divided output: VIN / 5 (to an ADC pin).' },
      { pin: 'NC', label: '+', kind: 'nc', note: 'Not connected on the module.' },
      { pin: 'GND', label: '−', kind: 'ground', note: 'Ground (joined to the input GND).' },
      { pin: 'VIN', label: 'VCC', kind: 'passive', note: 'Measured voltage + (wire from the terminal block), 0–25 V.' },
      { pin: 'GND_IN', label: 'GND', kind: 'ground', note: 'Measured voltage − (wire from the terminal block).' },
    ],
    meta: {
      partNumber: 'voltage detection module (30 kΩ / 7.5 kΩ)',
      manufacturer: 'generic module',
      sizeMm: [26, 14, 14.5],
      tags: ['voltage sensor', 'voltage divider', 'divider', 'battery monitor', 'adc', 'analog', 'sensor'],
      specs: ['divides by 5 (30 kΩ / 7.5 kΩ)', '0–25 V for a 5 V ADC, 0–16.5 V for 3.3 V', 'terminal block input + 3-pin header'],
    },
    doc: 'Voltage sensor module (resistor divider 30 kΩ / 7.5 kΩ): header S + − (`at` = S in row f; the board covers rows a–f) plus the input wires from its terminal block, plugged two columns left (VIN, "VCC") and two right (input GND) of the header in row f. S = VIN / 5: read it with an ADC (≤ 16.5 V input for a 3.3 V ADC). "+" is not connected; "−" is GND.',
  },

  // ------------------------------------------------------------ VS1838B
  {
    type: 'ir_receiver_vs1838b',
    label: 'IR receiver 38 kHz (VS1838B)',
    category: 'sensor',
    placement: 'leads',
    // lens toward you, leads left → right
    pins: ['OUT', 'GND', 'VCC'],
    params: [
      {
        key: 'remoteButton',
        label: 'Remote key',
        kind: 'select',
        default: 'none',
        options: ['none', 'CH-', 'CH', 'CH+', 'PREV', 'NEXT', 'PLAY', 'VOL-', 'VOL+', 'EQ', '0', '100+', '200+', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        runtime: true,
      },
      { key: 'hold', label: 'Hold key (repeat codes)', kind: 'boolean', default: false, runtime: true },
      { key: 'address', label: 'Remote address', kind: 'number', default: 0, min: 0, max: 255, step: 1, runtime: true },
    ],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'vs1838b' },
    digital: {
      model: 'vs1838b',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 2.7,
      inputs: [],
      outputs: ['OUT'],
      rout: 100,
      // internal output pull-up (TSOP-style block diagram)
      rPull: 30000,
    },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 2.7, vddMax: 5.5, vPinMax: 6 },
    support: {
      level: 'partial',
      simulated: [
        'demodulated output: idle high (≈ 30 kΩ internal pull-up), low while a 38 kHz burst is received',
        'virtual "Car MP3" remote (NEC protocol): selecting a key sends its frame — 9 ms burst, 4.5 ms space, 8-bit address, inverted address, command, inverted command (LSB first; 562.5 µs burst + 562.5 µs space = 0, + 1687.5 µs space = 1), final 562.5 µs burst',
        'Hold key: NEC repeat codes (9 ms burst, 2.25 ms space, 562.5 µs burst) every 108 ms while held',
      ],
      limits: [
        'ideal reception: no pulse-width distortion (real outputs stretch bursts by ~0.1 ms), no AGC, range, angle or ambient-light effects',
        'only the NEC protocol of the built-in remote; the 38 kHz carrier itself is not on the output (it is demodulated)',
      ],
    },
    pinInfo: [
      { pin: 'OUT', kind: 'output', note: 'Demodulated output, active low (idle high through the internal pull-up).' },
      { pin: 'GND', kind: 'ground' },
      { pin: 'VCC', kind: 'power', note: '2.7–5.5 V (3.3 V keeps OUT at MCU level).' },
    ],
    meta: {
      partNumber: 'VS1838B',
      manufacturer: 'generic (Vishay TSOP-compatible)',
      sizeMm: [6.6, 5.4, 7.6],
      tags: ['ir', 'infrared', 'vs1838b', 'tsop', 'remote', 'nec', '38khz', 'receiver', 'sensor'],
      specs: ['38 kHz carrier, demodulated active-low output', '2.7–5.5 V', 'NEC remote frames (address, command)'],
    },
    doc: 'VS1838B 38 kHz IR receiver, 3 leads OUT GND VCC (lens toward you, left → right). Power 3.3 V; OUT idles high and goes LOW during each received IR burst. A virtual NEC remote is built in: choose a key in the inspector to send its frame (9 ms low, 4.5 ms high, 32 bits LSB first: 0 = 562 µs low + 562 µs high, 1 = 562 µs low + 1687 µs high: address, ~address, command, ~command); "Hold" sends repeat codes every 108 ms. Decode with EXTI on both edges + a 1 µs timer.',
  },
]
