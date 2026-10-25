/**
 * Display-module family (embedded component library): I²C / SPI OLEDs
 * (SSD1306, SH1106), HD44780 character LCDs (16×2, 20×4, 16×2 + PCF8574
 * I²C backpack), SPI TFTs (ST7735S 1.8", ILI9341 2.4"), the MAX7219 8×8
 * LED matrix, an 8-LED WS2812B strip and the TM1637 4-digit display.
 *
 * Behaviour: src/sim/models/displays.model.ts (logic-level devices run by
 * the Simulation Coordinator); meshes: src/three/meshes/ext/displays.mesh.ts.
 *
 * Placement: every module plugs in with ONE straight header row (a
 * 'footprint' on one strip row). The header sits along the module's top
 * edge, so at rotation 0 the pins go into row j and the module lies over
 * the front edge of the board (bottom power rails) with its picture
 * upright for a viewer in front; rotation 180 (anchor in row a) lays it
 * behind the board. The MAX7219 module's input header is at its BOTTOM
 * edge, so its rotation-0 anchor is row a with the matrix behind the board.
 * A 90°/270° turn would put several pins into one strip: allowedRotations
 * [0, 180]. `bodyFootprint` covers the strip holes under the PCB (row j /
 * row a beside the pins); the PCB also covers the power-rail holes beyond
 * it, which the docs ask to keep free.
 *
 * Only `import type` from '../catalog' (it imports this module).
 */
import type { CatalogEntry, PinInfo, SubcircuitElement } from '../catalog'

/** Torex XC6206P332MR ("662K") 3.3 V LDO on the OLED / TFT modules: 200 mA, ≈ 50 mV dropout at the module's tens of mA, 6 V max input. */
const LDO_662K: SubcircuitElement = {
  id: 'REG',
  model: 'ldo',
  pins: ['VCC', '@3v3', 'GND'],
  params: { vout: 3.3, dropout: 0.05, rout: 0.05, ilimit: 0.2, vinMax: 6 },
}

/** OLED I²C modules: 4.7 kΩ ("472") pull-ups from SCL / SDA to the regulated 3.3 V. */
const OLED_I2C_SUB: SubcircuitElement[] = [
  LDO_662K,
  { id: 'R_SCL', model: 'resistor', pins: ['SCL', '@3v3'], params: { resistance: 4700 } },
  { id: 'R_SDA', model: 'resistor', pins: ['SDA', '@3v3'], params: { resistance: 4700 } },
]

/**
 * HD44780 character-LCD module analog parts: the LCD bias divider between
 * VDD and V0 (≈ 10 kΩ end to end — an open V0 floats up to VDD and the
 * characters vanish), and the backlight: the module's 100 Ω series
 * resistor (R8) + white LED string (A → K).
 */
const LCD_ANALOG: SubcircuitElement[] = [
  { id: 'R_BIAS', model: 'resistor', pins: ['VDD', 'V0'], params: { resistance: 10000 } },
  { id: 'R_BL', model: 'resistor', pins: ['A', '@bl'], params: { resistance: 100 } },
  { id: 'LED_BL', model: 'led', pins: ['@bl', 'K'], params: { color: 'white' } },
]

/** pins along one strip row, left → right */
const row = (n: number, r: 'a' | 'j') => Array.from({ length: n }, (_, i) => ({ dCol: i, row: r }))

const OLED_SSD1306_SIM = [
  'SSD1306 command set: display on/off, contrast, normal/inverse, entire display on, multiplex ratio, display offset, start line, segment remap, COM scan direction, COM pins configuration (sequential / alternative, L/R remap), clock divide / precharge / VCOMH (stored)',
  'GDDRAM 128 × 64 with horizontal, vertical and page addressing, column / page windows and page-mode column nibbles',
  'charge pump (8Dh): without 8Dh 14h the panel stays dark even with the image in RAM (no external VCC on the module)',
  'continuous horizontal scroll (26h/27h) and vertical+horizontal scroll (29h/2Ah) timed from the D5h/D9h/A8h frame rate; the scroll rotates GDDRAM like the real chip',
  'power-up GDDRAM is random (seeded per part), registers at their reset values; the glass image is derived from RAM + registers',
]
const OLED_LIMITS = [
  'read transfers (status / data reads) are not acknowledged',
  'fade-out / zoom (23h, D6h) are accepted but not modeled; the A3h vertical scroll area is not used (the vertical offset moves the whole panel)',
  'frame rate uses a linear approximation of the oscillator setting (D5h); precharge / VCOMH do not change the image brightness',
  'no supply current is drawn by the panel (only the regulator and pull-ups are electrical)',
  'bus timing (setup / hold, maximum clock rate) is not checked',
]
const OLED_THRESHOLDS =
  'input thresholds are fractions of VCC fitted to the 3.3 V regulator output at VCC = 5 V (VIL 0.66 V, VIH 2.64 V); at VCC = 3.3 V the modeled VIH (1.74 V) is lower than the real 2.6 V'

const lcdParallelPinInfo = (): PinInfo[] => [
  { pin: 'VSS', kind: 'ground', note: 'Ground.' },
  { pin: 'VDD', kind: 'power', note: '5 V supply (4.5–5.5 V for the 5 V LCD glass).' },
  { pin: 'V0', kind: 'analog', note: 'Contrast: LCD drive = VDD − V0 (≈ 10 kΩ bias divider to VDD inside). Wiper of a 10 kΩ pot between VDD and GND, about 0.3–1 V; unconnected = invisible characters.' },
  { pin: 'RS', kind: 'input', note: 'Register select: 0 = instruction, 1 = data. Internal pull-up.' },
  { pin: 'RW', kind: 'input', note: 'Read / write: 0 = write. Tie to GND for write-only use — left open it floats HIGH (internal pull-up) and the LCD never accepts a write.' },
  { pin: 'E', kind: 'input', note: 'Enable: data are latched on the falling edge (pulse ≥ 230 ns).' },
  ...[0, 1, 2, 3].map((i): PinInfo => ({ pin: `D${i}`, kind: 'io', note: `Data bit ${i} (8-bit mode only; leave open in 4-bit mode). Internal pull-up.` })),
  ...[4, 5, 6, 7].map((i): PinInfo => ({ pin: `D${i}`, kind: 'io', note: `Data bit ${i} (also used in 4-bit mode${i === 7 ? '; busy flag on reads' : ''}). Internal pull-up.` })),
  { pin: 'A', kind: 'power', note: 'Backlight anode (through the module’s 100 Ω resistor): 5 V.' },
  { pin: 'K', kind: 'ground', note: 'Backlight cathode: GND.' },
]

const LCD_SIM = [
  'HD44780U instruction set: clear, home, entry mode (I/D, S), display / cursor / blink, cursor and display shift, function set (DL, N, F), CGRAM and DDRAM addresses, data write and read, busy flag + address read',
  '8-bit and 4-bit interfaces (upper nibble first), writes latched on E falling, reads driven while E is high; internal pull-ups on RS, R/W and DB0–DB7',
  'execution times 37 µs / 1.52 ms (clear, home) and 10 ms power-up busy: writes while BF = 1 are ignored and reported',
  '8 CGRAM custom characters, DDRAM line addressing with display shift; the internal power-up reset (8-bit, 1-line, display off)',
  'contrast from V_LCD = VDD − V0 with the ≈ 10 kΩ bias divider from VDD to V0 (an open V0 floats to VDD: invisible): characters fade out below ≈ 3 V; 1-line mode (uninitialized) shows the row of dark boxes',
  'backlight = the module LED (A/K + 100 Ω) as an electrical sub-circuit; cursor and blink (379 ms at 270 kHz) shown',
]
const LCD_LIMITS = [
  'bus setup / hold times are not checked (a too-short E pulse is only reported)',
  'the 5×10 font (F = 1) is drawn as 5×8; the character ROM is code page A00 (ASCII + Japanese)',
  'the bias divider is one 10 kΩ resistor (the real ladder taps are not modeled); contrast vs V_LCD is a fitted curve for a 5 V STN module',
  'input thresholds are the 5 V values (VIH 2.2 V, VIL 0.6 V) as fractions of VDD',
]

export const PARTS: CatalogEntry[] = [
  // ----------------------------------------------------------- OLEDs
  {
    type: 'ssd1306_i2c',
    label: 'OLED 0.96" 128×64 I²C (SSD1306)',
    category: 'display',
    placement: 'footprint',
    pins: ['GND', 'VCC', 'SCL', 'SDA'],
    footprintOffsets: row(4, 'j'),
    allowedRotations: [0, 180],
    // 27.3 × 27.8 mm PCB, header centred on its top edge: covers cols at−3 … at+6 of row j
    bodyFootprint: { dCols: [-3, 6], rows: ['j'] },
    obstacleHeight: 2.3,
    params: [
      { key: 'address', label: 'I²C address (module jumper)', kind: 'select', default: '0x3C', options: ['0x3C', '0x3D'] },
      { key: 'color', label: 'OLED colour', kind: 'select', default: 'white', options: ['white', 'blue', 'yellow-blue'] },
    ],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'oled096_i2c' },
    digital: {
      model: 'ssd1306_i2c',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 2.8,
      inputs: ['SCL', 'SDA'],
      outputs: ['SDA'],
      vilFrac: 0.132,
      vihFrac: 0.528,
      rout: 100,
      // the controller's VDD is the module's 3.3 V LDO
      outputRail: { node: '@3v3' },
    },
    subcircuit: OLED_I2C_SUB,
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    // module: 3.3–5 V (XC6206 input ≤ 6 V); SSD1306 inputs ≤ VDD + 0.3 V (3.6 V)
    ratings: { vddMin: 3.0, vddMax: 5.5, vPinMax: 3.6 },
    support: {
      level: 'partial',
      simulated: [
        'I²C target at the bit level: START/STOP, 7-bit address 0x3C (or 0x3D by the module jumper), ACK, control byte Co / D/C# streams',
        ...OLED_SSD1306_SIM,
        'module: 662K 3.3 V regulator and 4.7 kΩ SCL/SDA pull-ups as electrical sub-circuit',
      ],
      limits: [...OLED_LIMITS, OLED_THRESHOLDS],
    },
    pinInfo: [
      { pin: 'GND', kind: 'ground' },
      { pin: 'VCC', kind: 'power', note: '3.3–5 V (on-board 3.3 V regulator).' },
      { pin: 'SCL', kind: 'input', functions: ['I2C_SCL'], note: 'I²C clock (4.7 kΩ pull-up on the module).' },
      { pin: 'SDA', kind: 'io', functions: ['I2C_SDA'], note: 'I²C data, open drain (4.7 kΩ pull-up on the module).' },
    ],
    meta: {
      partNumber: 'SSD1306 0.96" OLED module (I²C)',
      manufacturer: 'Solomon Systech (controller) / generic module',
      sizeMm: [27.3, 27.8, 3.7],
      tags: ['oled', 'ssd1306', 'display', 'i2c', 'iic', '128x64', '0.96', 'screen', 'graphic'],
      specs: [
        '128 × 64 monochrome OLED, 0.96" (21.7 × 10.9 mm active area)',
        'SSD1306 controller, I²C address 0x3C (0x3D with the address jumper)',
        'VCC 3.3–5 V (on-board 3.3 V LDO), on-board 4.7 kΩ pull-ups',
        'needs the charge pump enabled (8Dh 14h) to light',
      ],
    },
    doc: 'SSD1306 0.96" 128×64 OLED module, I²C, header GND VCC SCL SDA (4 pins, `at` = GND in row j; the module lies over the front edge of the board — keep the bottom-rail holes under it free; rotation 180 with the anchor in row a puts it behind the board). I²C address 0x3C (param address 0x3D = the other jumper). Pull-ups and a 3.3 V regulator are on the module: power VCC from 3.3 V or 5 V, wire SCL/SDA straight to I2C1 (PB6/PB7). Init like the common libraries: AEh, D5h 80h, A8h 3Fh, D3h 00h, 40h, 8Dh 14h (charge pump — without it the screen stays dark), 20h 00h, A1h, C8h, DAh 12h, 81h CFh, D9h F1h, DBh 40h, A4h, A6h, AFh; then send GDDRAM with control byte 40h.',
  },
  {
    type: 'ssd1306_spi',
    label: 'OLED 0.96" 128×64 SPI (SSD1306, 7-pin)',
    category: 'display',
    placement: 'footprint',
    pins: ['GND', 'VCC', 'D0', 'D1', 'RES', 'DC', 'CS'],
    footprintOffsets: row(7, 'j'),
    allowedRotations: [0, 180],
    bodyFootprint: { dCols: [-2, 8], rows: ['j'] },
    obstacleHeight: 2.3,
    params: [{ key: 'color', label: 'OLED colour', kind: 'select', default: 'white', options: ['white', 'blue', 'yellow-blue'] }],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'oled096_spi' },
    digital: {
      model: 'ssd1306_spi',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 2.8,
      inputs: ['D0', 'D1', 'RES', 'DC', 'CS'],
      outputs: [],
      vilFrac: 0.132,
      vihFrac: 0.528,
    },
    subcircuit: [LDO_662K],
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 3.0, vddMax: 5.5, vPinMax: 3.6 },
    support: {
      level: 'partial',
      simulated: [
        '4-wire SPI: SDIN sampled on SCLK rising edges while CS# is low, D/C# sampled with the 8th bit, CS# high resets the bit counter; RES# low resets the registers',
        ...OLED_SSD1306_SIM,
        'module: 662K 3.3 V regulator as electrical sub-circuit',
      ],
      limits: [
        ...OLED_LIMITS,
        'the maximum SCLK rate (10 MHz) is not enforced',
        'registers also reset at power-up without a RES# pulse',
        OLED_THRESHOLDS,
      ],
    },
    pinInfo: [
      { pin: 'GND', kind: 'ground' },
      { pin: 'VCC', kind: 'power', note: '3.3–5 V (on-board 3.3 V regulator).' },
      { pin: 'D0', kind: 'input', functions: ['SPI_SCK'], note: 'SPI clock (SCLK).' },
      { pin: 'D1', kind: 'input', functions: ['SPI_MOSI'], note: 'SPI data in (SDIN / MOSI).' },
      { pin: 'RES', kind: 'input', note: 'Reset, active low: pulse low after power-up or tie to VCC.' },
      { pin: 'DC', kind: 'input', note: 'Data / command: 0 = command, 1 = GDDRAM data (sampled with the 8th bit).' },
      { pin: 'CS', kind: 'input', functions: ['SPI_NSS'], note: 'Chip select, active low.' },
    ],
    meta: {
      partNumber: 'SSD1306 0.96" OLED module (SPI, 7-pin)',
      manufacturer: 'Solomon Systech (controller) / generic module',
      sizeMm: [27.3, 27.8, 3.7],
      tags: ['oled', 'ssd1306', 'display', 'spi', '128x64', '0.96', 'screen', 'graphic'],
      specs: [
        '128 × 64 monochrome OLED, 0.96"',
        'SSD1306 controller, 4-wire SPI up to 10 MHz (mode 0 or 3)',
        'VCC 3.3–5 V (on-board 3.3 V LDO); 3.3 V logic',
      ],
    },
    doc: 'SSD1306 0.96" 128×64 OLED module, 4-wire SPI, header GND VCC D0 D1 RES DC CS (`at` = GND in row j, module over the front edge; rotation 180 = behind the board). D0 = SCK, D1 = MOSI (SPI1: PA5 / PA7, mode 0), DC = data/command GPIO, CS = chip select GPIO (active low), RES = reset GPIO (pulse low ≥ 3 µs, then high). Same command set as the I²C module (send commands with DC low, GDDRAM with DC high); 8Dh 14h enables the charge pump.',
  },
  {
    type: 'sh1106_i2c',
    label: 'OLED 1.3" 128×64 I²C (SH1106)',
    category: 'display',
    placement: 'footprint',
    pins: ['VCC', 'GND', 'SCL', 'SDA'],
    footprintOffsets: row(4, 'j'),
    allowedRotations: [0, 180],
    // 35.4 × 33.5 mm PCB, header centred on the top edge
    bodyFootprint: { dCols: [-5, 8], rows: ['j'] },
    obstacleHeight: 2.3,
    params: [
      { key: 'address', label: 'I²C address (module jumper)', kind: 'select', default: '0x3C', options: ['0x3C', '0x3D'] },
      { key: 'color', label: 'OLED colour', kind: 'select', default: 'white', options: ['white', 'blue'] },
    ],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'oled13_i2c' },
    digital: {
      model: 'sh1106_i2c',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 2.8,
      inputs: ['SCL', 'SDA'],
      outputs: ['SDA'],
      vilFrac: 0.132,
      vihFrac: 0.528,
      rout: 100,
      // the controller's VDD is the module's 3.3 V LDO
      outputRail: { node: '@3v3' },
    },
    subcircuit: OLED_I2C_SUB,
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 3.0, vddMax: 5.5, vPinMax: 3.6 },
    support: {
      level: 'partial',
      simulated: [
        'I²C target at the bit level: START/STOP, 7-bit address 0x3C (0x3D jumper), ACK, control byte Co / D/C#',
        'SH1106 command set: page addressing over 132 columns (the glass shows columns 2–129), contrast, display on/off, inverse, entire on, segment remap, COM scan, multiplex, offset, start line, COM pins, DC-DC (ADh, on after reset)',
        'unknown bytes are ignored as on the real chip, so SSD1306-only commands (20h, 21h, 22h, 8Dh) turn their parameters into stray commands — the shifted / garbled picture of an SSD1306 driver on an SH1106',
        'power-up GDDRAM is random (seeded per part)',
        'module: 662K 3.3 V regulator and 4.7 kΩ SCL/SDA pull-ups as electrical sub-circuit',
      ],
      limits: [
        'read transfers and read-modify-write (E0h/EEh) are not modeled',
        'the column address wraps from 131 to 0',
        ...OLED_LIMITS.slice(2),
        OLED_THRESHOLDS,
      ],
    },
    pinInfo: [
      { pin: 'VCC', kind: 'power', note: '3.3–5 V (on-board regulator). Note: VCC is the FIRST pin on 1.3" modules (GND first on 0.96").' },
      { pin: 'GND', kind: 'ground' },
      { pin: 'SCL', kind: 'input', functions: ['I2C_SCL'], note: 'I²C clock (4.7 kΩ pull-up on the module).' },
      { pin: 'SDA', kind: 'io', functions: ['I2C_SDA'], note: 'I²C data, open drain (4.7 kΩ pull-up on the module).' },
    ],
    meta: {
      partNumber: 'SH1106 1.3" OLED module (I²C)',
      manufacturer: 'Sino Wealth (controller) / generic module',
      sizeMm: [35.4, 33.5, 3.9],
      tags: ['oled', 'sh1106', 'sh1106g', 'display', 'i2c', '128x64', '1.3', 'screen', 'graphic'],
      specs: [
        '128 × 64 monochrome OLED, 1.3" (29.4 × 14.7 mm active area)',
        'SH1106 controller: 132 × 64 RAM, page addressing only, glass at columns 2–129',
        'I²C address 0x3C, VCC 3.3–5 V (on-board LDO and pull-ups)',
      ],
    },
    doc: 'SH1106 1.3" 128×64 OLED module, I²C, header VCC GND SCL SDA (VCC first! `at` = VCC in row j, module over the front edge; rotation 180 = behind the board). Address 0x3C. The SH1106 has 132-column RAM and page addressing only: write each page with B0h+page, column 02h/10h (the glass starts at column 2), then 128 data bytes. An SSD1306 driver using horizontal mode (20h) shows a shifted, garbled image. The DC-DC is on after reset (no 8Dh needed).',
  },

  // ------------------------------------------------------ character LCDs
  {
    type: 'lcd1602',
    label: 'LCD1602 16×2 character LCD (HD44780)',
    category: 'display',
    placement: 'footprint',
    pins: ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K'],
    footprintOffsets: row(16, 'j'),
    allowedRotations: [0, 180],
    // 80 × 36 mm PCB, pin 1 8 mm from its left edge
    bodyFootprint: { dCols: [-3, 28], rows: ['j'] },
    obstacleHeight: 4.6,
    params: [{ key: 'panel', label: 'Panel colour', kind: 'select', default: 'blue', options: ['blue', 'yellow-green'] }],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'lcd1602' },
    digital: {
      model: 'hd44780_1602',
      supplyPin: 'VDD',
      groundPin: 'VSS',
      minVdd: 2.7,
      inputs: ['RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'],
      outputs: ['RS', 'RW', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'],
      // HD44780U at VCC 4.5–5.5 V: VIL1 0.6 V, VIH1 2.2 V
      vilFrac: 0.12,
      vihFrac: 0.44,
      rout: 300,
      rPull: 50000,
    },
    subcircuit: LCD_ANALOG,
    supplyPins: { plus: ['VDD'], minus: ['VSS'] },
    ratings: { vddMin: 4.5, vddMax: 5.5 },
    support: { level: 'partial', simulated: LCD_SIM, limits: LCD_LIMITS },
    pinInfo: lcdParallelPinInfo(),
    meta: {
      partNumber: 'LCD1602A (HD44780 / KS0066 / ST7066U)',
      manufacturer: 'generic module',
      sizeMm: [80, 36, 13.2],
      tags: ['lcd', 'lcd1602', '1602', 'hd44780', 'character', 'text', 'display', '16x2', 'liquidcrystal'],
      specs: [
        '16 × 2 characters, 5 × 8 dots, STN with LED backlight',
        'HD44780-compatible controller, 8-bit or 4-bit parallel bus',
        '5 V module: VDD 4.5–5.5 V, contrast pot on V0',
        '8 user-defined characters (CGRAM)',
      ],
    },
    doc: 'LCD1602 16×2 character LCD (HD44780), 16-pin header VSS VDD V0 RS RW E D0–D7 A K (`at` = VSS in row j; the module lies over the front edge of the board, keep the bottom-rail holes under it free). Power VSS→GND, VDD→5 V, A→5 V (100 Ω on board) and K→GND for the backlight, V0 to the wiper of a 10 kΩ pot between 5 V and GND (or ≈1 kΩ to GND). 4-bit mode: RS, E and D4–D7 to GPIOs (FT pins such as PB10–PB15 if you read the busy flag), RW to GND (or a GPIO), D0–D3 open. Init: wait 50 ms, nibble 3h ×3 (≥ 4.1 ms, 100 µs), 2h, then 28h, 08h, 01h (1.52 ms), 06h, 0Ch. A row of dark boxes on line 1 means it is not initialized.',
  },
  {
    type: 'lcd2004',
    label: 'LCD2004 20×4 character LCD (HD44780)',
    category: 'display',
    placement: 'footprint',
    pins: ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K'],
    footprintOffsets: row(16, 'j'),
    allowedRotations: [0, 180],
    // 98 × 60 mm PCB, pin 1 10 mm from its left edge
    bodyFootprint: { dCols: [-3, 34], rows: ['j'] },
    obstacleHeight: 4.6,
    params: [{ key: 'panel', label: 'Panel colour', kind: 'select', default: 'blue', options: ['blue', 'yellow-green'] }],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'lcd2004' },
    digital: {
      model: 'hd44780_2004',
      supplyPin: 'VDD',
      groundPin: 'VSS',
      minVdd: 2.7,
      inputs: ['RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'],
      outputs: ['RS', 'RW', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'],
      vilFrac: 0.12,
      vihFrac: 0.44,
      rout: 300,
      rPull: 50000,
    },
    subcircuit: LCD_ANALOG,
    supplyPins: { plus: ['VDD'], minus: ['VSS'] },
    ratings: { vddMin: 4.5, vddMax: 5.5 },
    support: {
      level: 'partial',
      simulated: [...LCD_SIM, '20 × 4 layout: rows 0/2 show DDRAM 00h–13h / 14h–27h, rows 1/3 show 40h–53h / 54h–67h'],
      limits: LCD_LIMITS,
    },
    pinInfo: lcdParallelPinInfo(),
    meta: {
      partNumber: 'LCD2004A (HD44780 / KS0066 / ST7066U)',
      manufacturer: 'generic module',
      sizeMm: [98, 60, 13.6],
      tags: ['lcd', 'lcd2004', '2004', 'hd44780', 'character', 'text', 'display', '20x4', 'liquidcrystal'],
      specs: [
        '20 × 4 characters, 5 × 8 dots, STN with LED backlight',
        'HD44780-compatible controller, 8-bit or 4-bit parallel bus',
        'row start addresses 00h, 40h, 14h, 54h',
        '5 V module: VDD 4.5–5.5 V, contrast pot on V0',
      ],
    },
    doc: 'LCD2004 20×4 character LCD (HD44780), same 16-pin header and wiring as the LCD1602 (VSS VDD V0 RS RW E D0–D7 A K, `at` = VSS in row j, module over the front edge). Row start DDRAM addresses: row 0 = 00h, row 1 = 40h, row 2 = 14h, row 3 = 54h (set DDRAM address 80h | addr). Same init sequence as the LCD1602 (function set 28h for 2 "lines").',
  },
  {
    type: 'lcd1602_i2c',
    label: 'LCD1602 + PCF8574 I²C backpack',
    category: 'display',
    placement: 'footprint',
    pins: ['GND', 'VCC', 'SDA', 'SCL'],
    footprintOffsets: row(4, 'j'),
    allowedRotations: [0, 180],
    // the I²C header sits under the LCD's top-left corner (backpack end): LCD 80 × 36 mm
    bodyFootprint: { dCols: [-1, 29], rows: ['j'] },
    obstacleHeight: 8.2,
    params: [
      { key: 'address', label: 'I²C address', kind: 'select', default: '0x27', options: ['0x27', '0x3F'] },
      { key: 'contrast', label: 'Contrast trimmer', kind: 'number', default: 0.85, min: 0, max: 1, step: 0.01, runtime: true },
      { key: 'panel', label: 'Panel colour', kind: 'select', default: 'blue', options: ['blue', 'yellow-green'] },
    ],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'lcd1602_i2c' },
    digital: {
      model: 'lcd1602_pcf8574',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 2.7,
      inputs: ['SDA', 'SCL'],
      outputs: ['SDA'],
      vilFrac: 0.3,
      vihFrac: 0.7,
      rout: 100,
    },
    // backpack: 4.7 kΩ pull-ups on SDA / SCL to VCC
    subcircuit: [
      { id: 'R_SCL', model: 'resistor', pins: ['SCL', 'VCC'], params: { resistance: 4700 } },
      { id: 'R_SDA', model: 'resistor', pins: ['SDA', 'VCC'], params: { resistance: 4700 } },
    ],
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 4.5, vddMax: 5.5 },
    support: {
      level: 'partial',
      simulated: [
        'PCF8574 I²C target at the bit level: address 0x27 (PCF8574T) or 0x3F (PCF8574AT), port write latched after the ACK clock, port read of the quasi-bidirectional pins',
        'backpack wiring P0 = RS, P1 = R/W, P2 = E, P3 = backlight, P4–P7 = D4–D7 (4-bit mode only), power-up port FFh',
        ...LCD_SIM.slice(0, 5),
        'backlight on / off from P3; contrast from the backpack trimmer (runtime parameter: V_LCD = position × VCC)',
        'backpack 4.7 kΩ SDA / SCL pull-ups to VCC as electrical sub-circuit',
      ],
      limits: [
        'the 100 kHz maximum SCL rate of the PCF8574 is not enforced',
        'the backlight LED and the LCD draw no supply current; reading P3 back returns its latch bit',
        ...LCD_LIMITS.slice(0, 3),
        'shown flat: the backpack under the LCD, its I²C header pointing straight down into the breadboard',
      ],
    },
    pinInfo: [
      { pin: 'GND', kind: 'ground' },
      { pin: 'VCC', kind: 'power', note: '5 V (the LCD glass needs 5 V; at 3.3 V the text is barely visible).' },
      { pin: 'SDA', kind: 'io', functions: ['I2C_SDA'], note: 'I²C data, 4.7 kΩ pull-up to VCC on the backpack (5 V: use 5 V tolerant MCU pins such as PB7).' },
      { pin: 'SCL', kind: 'input', functions: ['I2C_SCL'], note: 'I²C clock, 4.7 kΩ pull-up to VCC on the backpack (100 kHz max).' },
    ],
    meta: {
      partNumber: 'LCD1602 + PCF8574T I²C backpack',
      manufacturer: 'NXP / TI (PCF8574) / generic module',
      sizeMm: [80, 36, 20],
      tags: ['lcd', 'lcd1602', 'i2c', 'iic', 'pcf8574', 'backpack', 'hd44780', 'character', 'display', '16x2', 'liquidcrystal_i2c'],
      specs: [
        '16 × 2 character LCD driven through a PCF8574 8-bit I/O expander',
        'I²C address 0x27 (PCF8574T) / 0x3F (PCF8574AT), 100 kHz',
        'backlight switched by P3, contrast trimmer on the backpack',
        '5 V module with 4.7 kΩ pull-ups',
      ],
    },
    doc: 'LCD1602 with a PCF8574 I²C backpack: header GND VCC SDA SCL (`at` = GND in row j; the LCD lies over the front edge of the board). Power 5 V; SDA/SCL to I2C1 PB7/PB6 (5 V tolerant), 100 kHz; the backpack has its own pull-ups. Address 0x27 (0x3F for PCF8574A boards). Each PCF8574 byte sets P0 = RS, P1 = RW, P2 = E, P3 = backlight, P4–P7 = D4–D7: send every nibble twice (E high, then E low) with the backlight bit set (e.g. 0x08). 4-bit init like a parallel HD44780. Turn the contrast trimmer (runtime param) if the text is invisible.',
  },

  // ------------------------------------------------------------- TFTs
  {
    type: 'st7735',
    label: 'TFT 1.8" 128×160 SPI (ST7735S)',
    category: 'display',
    placement: 'footprint',
    pins: ['GND', 'VCC', 'SCL', 'SDA', 'RES', 'DC', 'CS', 'BL'],
    footprintOffsets: row(8, 'j'),
    allowedRotations: [0, 180],
    // 34 × 56 mm PCB, header centred on its top edge
    bodyFootprint: { dCols: [-3, 10], rows: ['j'] },
    // panel top 6.6 mm above the board (2.5 mm header plastic + 1.6 mm PCB + 2.5 mm panel)
    obstacleHeight: 2.7,
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'tft_st7735' },
    digital: {
      model: 'st7735',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 2.8,
      inputs: ['SCL', 'SDA', 'RES', 'DC', 'CS', 'BL'],
      outputs: [],
      // ST7735S VIL 0.3·VDDI / VIH 0.7·VDDI of the 3.3 V regulator, as fractions of VCC = 5 V
      vilFrac: 0.198,
      vihFrac: 0.462,
    },
    subcircuit: [LDO_662K],
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 3.0, vddMax: 5.5, vPinMax: 3.6 },
    support: {
      level: 'partial',
      simulated: [
        '4-line SPI (SDA sampled on SCL rising edges while CS is low, D/C sampled with the 8th bit), RES hardware reset, SWRESET; commands within 5 ms of a reset are ignored',
        'SLPIN/SLPOUT, DISPON/DISPOFF, INVON/INVOFF, NORON, IDMON/IDMOFF, CASET, RASET, RAMWR, MADCTL (MY MX MV RGB/BGR), COLMOD 12/16/18-bit (18-bit after reset), vertical scrolling (33h/37h)',
        '128 × 160 frame memory (black-tab module, GM = 00); the glass is RGB and mounted for MADCTL C0h = upright portrait',
        'backlight brightness = duty cycle of the BL input (PWM dimming works)',
        'power-up frame memory is random; an off / sleeping panel shows the white backlight',
      ],
      limits: [
        'no MISO on this module: no reads',
        'power / gamma / frame-rate registers (B1h–C5h, E0h/E1h…) are accepted but do not change the image; partial mode is not modeled',
        '18-bit colours are stored as RGB565',
        'the 15 MHz write-clock limit and SPI timing are not enforced; the 120 ms SLPOUT wait is not enforced',
        'thresholds are fractions of VCC fitted to the 3.3 V logic at VCC = 5 V',
        'the SD-card socket on the back is not connected',
      ],
    },
    pinInfo: [
      { pin: 'GND', kind: 'ground' },
      { pin: 'VCC', kind: 'power', note: '3.3–5 V (on-board 3.3 V regulator). Logic pins are 3.3 V.' },
      { pin: 'SCL', kind: 'input', functions: ['SPI_SCK'], note: 'SPI clock.' },
      { pin: 'SDA', kind: 'input', functions: ['SPI_MOSI'], note: 'SPI data in (MOSI).' },
      { pin: 'RES', kind: 'input', note: 'Reset, active low (wait 120 ms after releasing it).' },
      { pin: 'DC', kind: 'input', note: 'Data / command (A0): 0 = command, 1 = data.' },
      { pin: 'CS', kind: 'input', functions: ['SPI_NSS'], note: 'Chip select, active low.' },
      { pin: 'BL', kind: 'input', note: 'Backlight on/off (high = on, PWM dims). Open = dark.' },
    ],
    meta: {
      partNumber: 'ST7735S 1.8" TFT module (128×160)',
      manufacturer: 'Sitronix (controller) / generic module',
      sizeMm: [34, 56, 4.1],
      tags: ['tft', 'lcd', 'st7735', 'st7735s', 'display', 'spi', 'color', 'colour', '128x160', '1.8'],
      specs: [
        '1.8" TFT, 128 × 160 RGB, 65k / 262k colours',
        'ST7735S controller, 4-line SPI (write-only on this module)',
        'VCC 3.3–5 V (LDO), 3.3 V logic, backlight input BL',
      ],
    },
    doc: 'ST7735S 1.8" 128×160 colour TFT, SPI, header GND VCC SCL SDA RES DC CS BL (`at` = GND in row j; the module lies over the front edge). SCL/SDA = SPI1 SCK/MOSI (PA5/PA7, mode 0, ≤ 15 MHz), RES, DC, CS = GPIOs, BL high (or PWM) for the backlight. Init: RES pulse, SWRESET (01h, wait 150 ms), SLPOUT (11h, wait 120 ms), COLMOD 05h (16-bit), MADCTL C0h (upright, RGB), DISPON (29h); then CASET/RASET a window and RAMWR (2Ch) RGB565 pixels big-endian.',
  },
  {
    type: 'ili9341',
    label: 'TFT 2.4" 240×320 SPI (ILI9341)',
    category: 'display',
    placement: 'footprint',
    pins: ['VCC', 'GND', 'CS', 'RESET', 'DC', 'SDI', 'SCK', 'LED', 'SDO', 'T_CLK', 'T_CS', 'T_DIN', 'T_DO', 'T_IRQ'],
    footprintOffsets: row(14, 'j'),
    allowedRotations: [0, 180],
    // 42.7 × 77 mm PCB, 14-pin header along its top edge
    bodyFootprint: { dCols: [-1, 14], rows: ['j'] },
    // touch panel top 7.6 mm above the board (2.5 + 1.6 + 3.5 mm panel with the resistive touch layer)
    obstacleHeight: 3.1,
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'tft_ili9341' },
    digital: {
      model: 'ili9341',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 2.8,
      inputs: ['CS', 'RESET', 'DC', 'SDI', 'SCK', 'LED'],
      outputs: ['SDO'],
      vilFrac: 0.198,
      vihFrac: 0.462,
      rout: 150,
      // the ILI9341 runs from the module's 3.3 V LDO: SDO high is 3.3 V at VCC = 5 V
      outputRail: { node: '@3v3' },
    },
    subcircuit: [LDO_662K],
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 3.0, vddMax: 5.5, vPinMax: 3.6 },
    support: {
      level: 'partial',
      simulated: [
        '4-line SPI (SDI sampled on SCK rising edges while CS is low, D/C sampled with the 8th bit), RESET hardware reset, SWRESET; commands within 5 ms of a reset are ignored',
        'SLPIN/SLPOUT, DISPON/DISPOFF, INVON/INVOFF, NORON, IDMON/IDMOFF, CASET, PASET, RAMWR, MADCTL (MY MX MV BGR), COLMOD 16/18-bit (18-bit after reset), vertical scrolling (VSCRDEF 33h / VSCRSADD 37h)',
        'SDO reads: RDDPM (0Ah), RDDMADCTL (0Bh), RDDCOLMOD (0Ch) and RDID4 (D3h → 00h 93h 41h) after a dummy byte',
        '240 × 320 frame memory; the glass is BGR and mounted for MADCTL 48h = upright portrait',
        'backlight brightness = duty cycle of the LED input (PWM dimming works); an off / sleeping panel shows the white backlight',
      ],
      limits: [
        'the XPT2046 touch controller is not modeled: T_CLK T_CS T_DIN T_DO T_IRQ are open',
        'power / gamma / timing registers are accepted but do not change the image; partial mode and RAMRD are not modeled',
        '18-bit colours are stored as RGB565',
        'SPI timing limits and the 120 ms SLPOUT wait are not enforced',
        'thresholds are fractions of VCC fitted to the 3.3 V logic at VCC = 5 V',
      ],
    },
    pinInfo: [
      { pin: 'VCC', kind: 'power', note: '3.3–5 V (on-board 3.3 V regulator). Logic pins are 3.3 V only.' },
      { pin: 'GND', kind: 'ground' },
      { pin: 'CS', kind: 'input', functions: ['SPI_NSS'], note: 'Chip select, active low.' },
      { pin: 'RESET', kind: 'input', note: 'Reset, active low.' },
      { pin: 'DC', kind: 'input', note: 'Data / command: 0 = command, 1 = data.' },
      { pin: 'SDI', kind: 'input', functions: ['SPI_MOSI'], note: 'SPI data in (MOSI).' },
      { pin: 'SCK', kind: 'input', functions: ['SPI_SCK'], note: 'SPI clock.' },
      { pin: 'LED', kind: 'input', note: 'Backlight control (transistor on the module): high = on, PWM dims.' },
      { pin: 'SDO', kind: 'output', functions: ['SPI_MISO'], note: 'SPI data out (MISO) for register reads; high impedance otherwise.' },
      { pin: 'T_CLK', kind: 'nc', note: 'Touch controller clock (XPT2046) — not modeled.' },
      { pin: 'T_CS', kind: 'nc', note: 'Touch controller chip select — not modeled.' },
      { pin: 'T_DIN', kind: 'nc', note: 'Touch controller data in — not modeled.' },
      { pin: 'T_DO', kind: 'nc', note: 'Touch controller data out — not modeled.' },
      { pin: 'T_IRQ', kind: 'nc', note: 'Touch interrupt — not modeled.' },
    ],
    meta: {
      partNumber: 'ILI9341 2.4" TFT module (240×320)',
      manufacturer: 'ILITEK (controller) / generic module',
      sizeMm: [42.7, 77, 4.3],
      tags: ['tft', 'lcd', 'ili9341', 'display', 'spi', 'color', 'colour', '240x320', '2.4', 'touch'],
      specs: [
        '2.4" TFT, 240 × 320 RGB, 65k / 262k colours',
        'ILI9341 controller, 4-line SPI with SDO read-back',
        'VCC 3.3–5 V (LDO), 3.3 V logic, backlight input LED',
        'touch header present (XPT2046 not modeled)',
      ],
    },
    doc: 'ILI9341 2.4" 240×320 colour TFT, SPI, 14-pin header VCC GND CS RESET DC SDI SCK LED SDO T_CLK T_CS T_DIN T_DO T_IRQ (`at` = VCC in row j; the module lies over the front edge). SCK/SDI/SDO = SPI1 PA5/PA7/PA6, CS/DC/RESET = GPIOs, LED high for the backlight. Logic is 3.3 V only. Init: hardware reset, SWRESET, SLPOUT (120 ms), COLMOD 55h (16-bit), MADCTL 48h (upright, BGR), DISPON; CASET (2Ah) / PASET (2Bh) window, RAMWR (2Ch) RGB565 big-endian. RDID4 (D3h) reads 00 93 41 after a dummy byte. Touch pins are not modeled.',
  },

  // ----------------------------------------------------------- LED displays
  {
    type: 'max7219_8x8',
    label: 'MAX7219 8×8 LED matrix module',
    category: 'display',
    placement: 'footprint',
    pins: ['VCC', 'GND', 'DIN', 'CS', 'CLK'],
    footprintOffsets: row(5, 'a'),
    allowedRotations: [0, 180],
    // 32 mm wide PCB, input header centred on its bottom edge
    bodyFootprint: { dCols: [-4, 8], rows: ['a'] },
    obstacleHeight: 8.0,
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'max7219_matrix' },
    digital: {
      model: 'max7219',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 4.0,
      inputs: ['DIN', 'CS', 'CLK'],
      outputs: [],
      // MAX7219: VIL 0.8 V, VIH 3.5 V at V+ = 5 V
      vilFrac: 0.16,
      vihFrac: 0.7,
    },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 4.0, vddMax: 5.5 },
    support: {
      level: 'partial',
      simulated: [
        '16-bit shift register clocked on CLK rising edges, latched by the LOAD (CS) rising edge; address D11–D8, data D7–D0',
        'digit registers, decode mode (Code B), intensity (PWM (2n+1)/32), scan limit (fewer digits = brighter, unscanned rows dark), shutdown, display test (overrides everything)',
        'power-up: shutdown, no decode, minimum intensity, scan limit 0; digit registers random',
        'datasheet input thresholds (VIH 3.5 V at 5 V): 3.3 V logic needs the module at ≤ 4.7 V or a level shifter',
      ],
      limits: [
        'no DOUT: the module’s output header (cascading) is off the breadboard',
        'brightness is a relative LED level (no segment-current / ISET model); no supply current is drawn',
        'SPI timing (10 MHz max, setup / hold) is not checked',
      ],
    },
    pinInfo: [
      { pin: 'VCC', kind: 'power', note: '4.0–5.5 V. With 3.3 V logic, power it from ≤ 4.7 V (VIH = 0.7·V+) or use a level shifter.' },
      { pin: 'GND', kind: 'ground' },
      { pin: 'DIN', kind: 'input', functions: ['SPI_MOSI'], note: 'Serial data in (shifted on CLK rising edges, MSB first).' },
      { pin: 'CS', kind: 'input', functions: ['SPI_NSS'], note: 'LOAD: the last 16 bits are latched on its rising edge.' },
      { pin: 'CLK', kind: 'input', functions: ['SPI_SCK'], note: 'Serial clock (≤ 10 MHz).' },
    ],
    meta: {
      partNumber: 'MAX7219 + 1088AS 8×8 matrix module',
      manufacturer: 'Maxim (Analog Devices) / generic module',
      sizeMm: [32, 50, 15],
      tags: ['max7219', 'led', 'matrix', '8x8', 'dot matrix', 'display', 'spi', '1088as'],
      specs: [
        '8 × 8 red LED matrix (32 × 32 mm) driven by a MAX7219',
        'SPI-style 16-bit frames: address + data, latched on LOAD',
        'intensity 16 steps, scan limit, shutdown, display test',
        'V+ 4.0–5.5 V; logic high ≥ 3.5 V at 5 V',
      ],
    },
    doc: 'MAX7219 8×8 red LED matrix module, input header VCC GND DIN CS CLK (`at` = VCC in row a; the module extends BEHIND the board, keep the top-rail holes under it free). Send 16-bit frames MSB first (SPI1 mode 0, DFF 16-bit, ≤ 10 MHz) with CS low, CS rising latches: address 0x0C01 normal operation, 0x0B07 scan all 8 rows, 0x0900 no decode, 0x0Axx intensity, 0x0F00 test off, then 0x01dd…0x08dd = rows 0–7 (bit 7 = left column). VIH is 3.5 V at 5 V: from a 3.3 V MCU power the module at 4.5 V or level-shift.',
  },
  {
    type: 'ws2812b_strip8',
    label: 'WS2812B RGB LED strip (8 LEDs)',
    category: 'display',
    placement: 'footprint',
    pins: ['5V', 'GND', 'DIN', 'DOUT'],
    // input end 5V GND DIN, output end DOUT
    footprintOffsets: [
      { dCol: 0, row: 'j' },
      { dCol: 1, row: 'j' },
      { dCol: 2, row: 'j' },
      { dCol: 23, row: 'j' },
    ],
    allowedRotations: [0, 180],
    // 61 × 10 mm strip carrier centred on row j
    bodyFootprint: { dCols: [0, 23], rows: ['i', 'j'] },
    obstacleHeight: 2.3,
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'ws2812_strip' },
    digital: {
      model: 'ws2812b_strip',
      supplyPin: '5V',
      groundPin: 'GND',
      minVdd: 3.5,
      inputs: ['DIN'],
      outputs: ['DOUT'],
      vilFrac: 0.3,
      vihFrac: 0.7,
      rout: 50,
    },
    supplyPins: { plus: ['5V'], minus: ['GND'] },
    ratings: { vddMin: 3.5, vddMax: 5.3 },
    support: {
      level: 'partial',
      simulated: [
        'single-wire protocol decoded from DIN edges in virtual time: each bit sampled 0.6 µs after its rising edge, 24 bits per LED in G-R-B order, MSB first',
        'reset / latch after DIN stays low ≥ 280 µs; LEDs keep their colour until the next latch',
        'bits after the 8th LED are regenerated on DOUT (T0H 0.4 µs / T1H 0.8 µs) for a following strip',
        'out-of-spec high times, pauses and partial frames are read exactly as the sampling point dictates and reported once in the log',
        'datasheet input threshold VIH = 0.7·VDD (3.5 V at 5 V): from 3.3 V logic power the strip at ≤ 4.7 V or level-shift DIN',
      ],
      limits: [
        'no supply current (60 mA per LED at full white is not drawn from the rails)',
        'PWM is not simulated: the colour is the latched 8-bit value per channel',
        'the internal per-LED propagation delay is not modeled',
      ],
    },
    pinInfo: [
      { pin: '5V', kind: 'power', note: '3.5–5.3 V. With 3.3 V data, power the strip at ≤ 4.7 V (VIH = 0.7·VDD) or level-shift DIN.' },
      { pin: 'GND', kind: 'ground' },
      { pin: 'DIN', kind: 'input', note: 'Data in: 800 kHz NRZ (T0H 0.4 µs, T1H 0.8 µs, period 1.25 µs), reset ≥ 280 µs low.' },
      { pin: 'DOUT', kind: 'output', note: 'Data out to the next strip (regenerated).' },
    ],
    meta: {
      partNumber: 'WS2812B 5050 RGB LED strip, 8 LEDs',
      manufacturer: 'Worldsemi (LED) / generic strip',
      sizeMm: [61, 10, 3.2],
      tags: ['ws2812', 'ws2812b', 'neopixel', 'rgb', 'led', 'strip', 'addressable', 'smart led', '5050'],
      specs: [
        '8 × WS2812B 5050 RGB LEDs with integrated driver',
        '800 kHz single-wire data, 24-bit G-R-B colour per LED',
        'reset / latch ≥ 280 µs low',
        'VDD 3.5–5.3 V, VIH 0.7·VDD',
      ],
    },
    doc: 'WS2812B strip of 8 RGB LEDs: input pins 5V GND DIN at its left end (`at` = 5V in row j), DOUT 23 columns to the right (cascade to another strip). Data: 24 bits per LED, G-R-B, MSB first; "0" = 0.4 µs high + 0.85 µs low, "1" = 0.8 µs high + 0.45 µs low; ≥ 280 µs low latches. Robust STM32 method: SPI1 MOSI (PA7) at 2.25 MHz (72 MHz / 32) with DMA, 3 SPI bits per WS bit (100 = 0, 110 = 1). DIN needs ≥ 0.7·VDD: with a 3.3 V MCU power the strip at 4.5 V or use a level shifter.',
  },
  {
    type: 'tm1637_4digit',
    label: 'TM1637 4-digit 7-segment display',
    category: 'display',
    placement: 'footprint',
    pins: ['CLK', 'DIO', 'VCC', 'GND'],
    footprintOffsets: row(4, 'j'),
    allowedRotations: [0, 180],
    // 42 × 24 mm PCB, header centred on its top edge
    bodyFootprint: { dCols: [-6, 9], rows: ['j'] },
    obstacleHeight: 4.6,
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'tm1637_display' },
    digital: {
      model: 'tm1637',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 3.0,
      inputs: ['CLK', 'DIO'],
      outputs: ['DIO'],
      vilFrac: 0.3,
      vihFrac: 0.7,
      rout: 100,
    },
    // module: 10 kΩ pull-ups on CLK / DIO to VCC
    subcircuit: [
      { id: 'R_CLK', model: 'resistor', pins: ['CLK', 'VCC'], params: { resistance: 10000 } },
      { id: 'R_DIO', model: 'resistor', pins: ['DIO', 'VCC'], params: { resistance: 10000 } },
    ],
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 4.5, vddMax: 5.5 },
    support: {
      level: 'partial',
      simulated: [
        'TM1637 two-wire protocol: START/STOP, LSB-first bytes read on CLK rising edges, ACK (DIO pulled low from the 8th to the 9th falling edge)',
        'data command (auto-increment / fixed address, key read), address command C0h–C5h, display control (on/off, 8 pulse widths)',
        'four digits + colon (bit 7 of digit 2); key read returns FFh (no keys on the module)',
        'module 10 kΩ CLK / DIO pull-ups as electrical sub-circuit; power-up display data random, display off',
      ],
      limits: [
        'the 100 pF filter capacitors on CLK / DIO of common modules are not modeled',
        'the maximum clock rate (≈ 250 kHz) is not checked',
        'no supply current is drawn; decimal points are not wired on this module',
      ],
    },
    pinInfo: [
      { pin: 'CLK', kind: 'input', note: 'Clock (10 kΩ pull-up on the module). Drive open-drain, ≤ 250 kHz.' },
      { pin: 'DIO', kind: 'io', note: 'Data I/O, open drain (10 kΩ pull-up on the module); the TM1637 pulls it low to ACK.' },
      { pin: 'VCC', kind: 'power', note: '5 V (4.5–5.5 V; works dimmer at 3.3 V).' },
      { pin: 'GND', kind: 'ground' },
    ],
    meta: {
      partNumber: 'TM1637 0.36" 4-digit display module',
      manufacturer: 'Titan Micro (driver) / generic module',
      sizeMm: [42, 24, 12],
      tags: ['tm1637', '7-segment', 'seven segment', 'digit', 'clock', 'display', 'led', '4-digit'],
      specs: [
        '4-digit red 7-segment display with clock colon, 0.36"',
        'TM1637 driver: 2-wire serial (CLK, DIO), LSB first, ACK per byte',
        '8 brightness steps, display on/off',
        '10 kΩ pull-ups on CLK / DIO',
      ],
    },
    doc: 'TM1637 4-digit 7-segment module, header CLK DIO VCC GND (`at` = CLK in row j; the module lies over the front edge). Power 5 V. Bit-bang CLK and DIO as open-drain GPIOs (e.g. PB6/PB7, 5 V tolerant; the module has 10 kΩ pull-ups) at ≤ 250 kHz: START (DIO falls while CLK high), bytes LSB first (DIO changes while CLK low), the TM1637 ACKs each byte on the 9th clock, STOP. Sequence: 40h (auto-increment) / C0h + 4 segment bytes (a = bit 0 … g = bit 6, bit 7 of digit 2 = colon) / 88h–8Fh (display on + brightness).',
  },
]
