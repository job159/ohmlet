/**
 * Communication & memory modules: USB-UART (CH340), Bluetooth (HC-05),
 * RS-485 (MAX485), SPI NOR flash (W25Q32), micro-SD (SPI), I²C I/O expander
 * (PCF8574), ESP-01 (AT subset, no Wi-Fi) and CAN transceiver (TJA1050).
 * Behavior: src/sim/models/comm.model.ts (+ comm-uart / comm-spi /
 * comm-flash / comm-sd helpers); meshes: src/three/meshes/ext/comm.mesh.ts.
 *
 * Placement on the breadboard model (rows a–e | channel | f–j):
 *  - single-row modules plug one header into ONE strip row, every pin in its
 *    own column: flat boards overhang the channel (or the board edge) away
 *    from the strips they use; right-angle modules (HC-05, ESP-01 adapter)
 *    stand upright over their row;
 *  - two-header modules straddle the channel with their headers in rows c
 *    and h like the Blue Pill (rows a/b and i/j stay free for wiring);
 *  - every one allows only 0° / 180°: a quarter turn would put several pins
 *    into one strip.
 * All sizes in mm from the common boards' outlines.
 */
import type { CatalogEntry } from '../catalog'

const ROT: CatalogEntry['allowedRotations'] = [0, 180]
/** pins along one strip row: dCol 0 … n-1 */
const row = (n: number, r: 'a' | 'c' | 'e' | 'h') => Array.from({ length: n }, (_, i) => ({ dCol: i, row: r }))

const UART_BAUDS = ['1200', '2400', '4800', '9600', '19200', '38400', '57600', '115200', '230400', '460800', '921600']

export const PARTS: CatalogEntry[] = [
  // ------------------------------------------------------------- CH340G
  {
    type: 'usb_uart_ch340',
    label: 'USB-to-TTL adapter (CH340G)',
    category: 'module',
    placement: 'footprint',
    // 6-pin header at the board end opposite the USB-A plug
    pins: ['GND', '3V3', '5V', 'TXD', 'RXD', 'DTR'],
    footprintOffsets: row(6, 'a'),
    allowedRotations: ROT,
    // header in row a; the PCB and the USB plug overhang the board edge
    // beyond row a (over the top rails), so only the header row is covered
    bodyFootprint: { dCols: [0, 5], rows: ['a'] },
    // the logic-level shunt on its 1×3 header (12.6 mm above the breadboard)
    obstacleHeight: 5.0,
    params: [
      { key: 'logic', label: 'Logic level jumper', kind: 'select', default: '5V', options: ['5V', '3.3V'] },
      { key: 'baud', label: 'COM port baud', kind: 'select', default: '115200', options: UART_BAUDS, runtime: true },
      { key: 'parity', label: 'COM port parity', kind: 'select', default: 'none', options: ['none', 'even', 'odd'], runtime: true },
      { key: 'stopBits', label: 'COM port stop bits', kind: 'select', default: '1', options: ['1', '2'], runtime: true },
      { key: 'dtr', label: 'DTR asserted', kind: 'boolean', default: false, runtime: true },
    ],
    sim: { kind: 'chip', model: 'comm-module' },
    visual: { shape: 'comm_ch340' },
    digital: {
      model: 'comm-ch340',
      // the chip adapter points the I/O rail at 5V or 3V3 per the jumper
      supplyPin: '5V',
      groundPin: 'GND',
      minVdd: 2.7,
      inputs: ['RXD'],
      outputs: ['TXD', 'RXD', 'DTR'],
      vilFrac: 0.2,
      vihFrac: 0.45,
      rout: 50,
      // the logic jumper connects the CH340's VCC (= its I/O rail) to 5V or 3V3
      outputRail: { node: '5V', select: { param: 'logic', nodes: { '5V': '5V', '3.3V': '3V3' } } },
    },
    // powered from USB: 5V / 3V3 are OUTPUTS of the module, GND is its reference
    supplyPins: { plus: [], minus: ['GND'] },
    subcircuit: [
      { id: 'VBUS', model: 'battery', pins: ['5V', 'GND'], params: { voltage: 5.0, rint: 0.3 } },
      { id: 'REG', model: 'ldo', pins: ['5V', '3V3', 'GND'], params: { vout: 3.3, dropout: 0.3, rout: 0.1, ilimit: 0.1 } },
      { id: 'LED_PWR', model: 'led', pins: ['5V', '@pwr_k'], params: { color: 'red' } },
      { id: 'R_PWR', model: 'resistor', pins: ['@pwr_k', 'GND'], params: { resistance: 1000 } },
    ],
    support: {
      level: 'partial',
      simulated: [
        'bit-level UART on TXD / RXD at the COM port settings (baud, parity, stop bits — params): a mismatch with the MCU produces garbage and framing errors like a real adapter',
        'virtual COM port "COM" in the UART terminal: received bytes appear there, typed bytes are transmitted on TXD',
        'logic-level jumper: TXD / DTR swing to 5 V or 3.3 V; RXD thresholds scale with it',
        'USB power: 5 V (0.3 Ω source) on the 5V pin, 3.3 V regulator output (≤ 100 mA) on 3V3, power LED',
        'DTR output (active low) from the "DTR asserted" param',
      ],
      limits: [
        'USB itself is not simulated: the module is always plugged into the PC',
        'RTS / CTS and the other modem lines are not broken out on this module and not modeled',
        'TX / RX activity LEDs are shown from the line state (not stamped electrically)',
        'RXD thresholds are 0.2 / 0.45 × VIO (the CH340G datasheet gives TTL levels at 5 V)',
      ],
    },
    pinInfo: [
      { pin: 'GND', kind: 'ground', note: 'Ground — connect it to the MCU ground (UART needs a common reference).' },
      { pin: '3V3', kind: 'power', note: '3.3 V output from the module (≈ 100 mA max). Do not feed power in here.' },
      { pin: '5V', kind: 'power', note: 'USB 5 V output — can power a Blue Pill through its 5V pin.' },
      { pin: 'TXD', kind: 'output', functions: ['UART_TX'], note: 'Adapter transmit → wire to the MCU RX (e.g. PA10 / PA3).' },
      { pin: 'RXD', kind: 'input', functions: ['UART_RX'], note: 'Adapter receive ← wire to the MCU TX (e.g. PA9 / PA2).' },
      { pin: 'DTR', kind: 'output', note: 'Modem DTR (active low), used by auto-reset circuits.' },
    ],
    meta: {
      partNumber: 'CH340G USB-TTL module',
      manufacturer: 'WCH (chip) / generic module',
      sizeMm: [50, 17, 10],
      tags: ['usb', 'uart', 'serial', 'ttl', 'ch340', 'ch340g', 'com port', 'usb to ttl', 'adapter', 'terminal'],
      specs: [
        'CH340G USB 2.0 full-speed to UART bridge, 12 MHz crystal',
        '50 baud … 2 Mbaud, 5–8 data bits, parity, 1/2 stop bits',
        '3.3 V / 5 V logic-level jumper',
        'USB-A plug; 5 V and 3.3 V outputs',
      ],
    },
    doc: 'CH340G USB-to-TTL serial adapter (6-pin header GND 3V3 5V TXD RXD DTR in one row; `at` = GND in row a, the board and USB plug overhang the board edge; rotation 180 for row j). It is plugged into the PC: its TXD/RXD bridge to the virtual COM port "COM" in the UART terminal. Wire TXD → MCU RX, RXD ← MCU TX, GND ↔ GND. Set the COM port baud/parity to match the firmware. Jumper "logic" selects 5 V or 3.3 V signal levels — use 3.3V for non-5V-tolerant pins such as PA3. The 5V pin can power a Blue Pill.',
  },

  // -------------------------------------------------------------- HC-05
  {
    type: 'hc05_bt',
    label: 'Bluetooth module HC-05',
    category: 'module',
    placement: 'footprint',
    // ZS-040 board, right-angle header: the module stands upright on its row
    pins: ['STATE', 'RXD', 'TXD', 'GND', 'VCC', 'EN'],
    footprintOffsets: row(6, 'e'),
    allowedRotations: ROT,
    bodyFootprint: { dCols: [0, 5], rows: ['e'] },
    obstacleHeight: 15.6,
    params: [{ key: 'phone', label: 'Phone connected (Bluetooth link)', kind: 'boolean', default: true, runtime: true }],
    sim: { kind: 'chip', model: 'comm-module' },
    visual: { shape: 'comm_hc05' },
    digital: {
      model: 'comm-hc05',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 3.2,
      inputs: ['RXD', 'EN'],
      outputs: ['TXD', 'STATE', 'EN'],
      vilFrac: 0.16,
      vihFrac: 0.4,
      rout: 50,
      // the BC417 runs from the on-board 3.3 V regulator: TXD / STATE swing 0–3.3 V at any VCC
      outputRail: { node: '@v33' },
    },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    subcircuit: [
      { id: 'REG', model: 'ldo', pins: ['VCC', '@v33', 'GND'], params: { vout: 3.3, dropout: 0.25, rout: 0.1, ilimit: 0.2 } },
      { id: 'IQ', model: 'basic_iq', pins: ['@v33', 'GND'], params: { iq: 0.025 } },
      { id: 'R_TXD', model: 'resistor', pins: ['TXD', '@v33'], params: { resistance: 1000 } },
      { id: 'R_STATE', model: 'resistor', pins: ['STATE', '@v33'], params: { resistance: 1000 } },
    ],
    ratings: { vddMin: 3.6, vddMax: 6 },
    support: {
      level: 'partial',
      simulated: [
        'EN high at power-up → AT command mode at 38400 8N1; EN low / open → data mode at the stored UART setting',
        'AT, AT+RESET, AT+ORGL, AT+VERSION?, AT+NAME?/=, AT+UART?/=, AT+ROLE?/=, AT+PSWD?/=, AT+STATE? with OK / ERROR:(code) answers; settings kept in the module flash (non-volatile for the session)',
        'data mode bridged to the paired phone: virtual serial port "BT" in the UART terminal',
        'STATE high while a phone is connected; on-board LED patterns (AT slow blink, waiting fast blink, connected double flash)',
        '3.3 V regulator on board: TXD / STATE high level is 3.3 V at any VCC',
      ],
      limits: [
        'the Bluetooth radio is not simulated: pairing, inquiry and links are replaced by the "Phone connected" param',
        'AT commands about the radio (inquiry, pairing, link, address) are not implemented and answer ERROR:(0)',
        'start-up time 100 ms and immediate AT answers are estimates (not specified by the datasheet)',
        'TXD / STATE high side modeled as 1 kΩ to the module 3.3 V rail (the real outputs are push-pull)',
      ],
    },
    pinInfo: [
      { pin: 'STATE', kind: 'output', note: 'High while a phone is connected.' },
      { pin: 'RXD', kind: 'input', functions: ['UART_RX'], note: 'Module receive ← MCU TX. 3.3 V logic.' },
      { pin: 'TXD', kind: 'output', functions: ['UART_TX'], note: 'Module transmit → MCU RX (3.3 V level).' },
      { pin: 'GND', kind: 'ground' },
      { pin: 'VCC', kind: 'power', note: '3.6–6 V (on-board 3.3 V regulator).' },
      { pin: 'EN', kind: 'input', note: 'Key / EN: high at power-up = AT command mode (38400 baud). Open = data mode.' },
    ],
    meta: {
      partNumber: 'HC-05 (ZS-040 board)',
      manufacturer: 'Guangzhou HC / generic board',
      sizeMm: [37, 16, 2.5],
      tags: ['bluetooth', 'hc-05', 'hc05', 'bt', 'spp', 'serial', 'uart', 'wireless', 'at command', 'phone'],
      specs: [
        'Bluetooth 2.0 + EDR SPP module (CSR BC417), master / slave',
        'AT mode 38400 8N1 (EN high at power-up); data mode default 9600 8N1',
        'VCC 3.6–6 V, 3.3 V logic',
        'STATE output, status LED',
      ],
    },
    doc: 'HC-05 Bluetooth serial module (ZS-040 board, stands upright; header STATE RXD TXD GND VCC EN in one row, `at` = STATE in row e). Power VCC 3.6–6 V. Wire TXD → MCU RX, RXD ← MCU TX, GND. EN high at power-up (e.g. a 10 kΩ pull-up) starts AT command mode at 38400 baud (AT, AT+NAME?, AT+UART=9600,0,0 …, each ending in CR LF); EN low or open starts data mode at the stored baud (default 9600), bridged to the paired phone = port "BT" in the UART terminal. AT+RESET with EN low switches to data mode. STATE goes high when the phone is connected. The radio is not simulated.',
  },

  // ------------------------------------------------------------- MAX485
  {
    type: 'max485_module',
    label: 'RS-485 module (MAX485)',
    category: 'module',
    placement: 'footprint',
    // logic header (RO RE DE DI) in row h, bus header (VCC B A GND) in row c
    pins: ['RO', 'RE', 'DE', 'DI', 'VCC', 'B', 'A', 'GND'],
    footprintOffsets: [...row(4, 'h'), ...row(4, 'c')],
    allowedRotations: ROT,
    bodyFootprint: { dCols: [0, 3], rows: ['c', 'd', 'e', 'f', 'g', 'h'] },
    obstacleHeight: 2.4,
    params: [{ key: 'termination', label: '120 Ω termination (R7) fitted', kind: 'boolean', default: true }],
    sim: { kind: 'chip', model: 'comm-module' },
    visual: { shape: 'comm_max485' },
    digital: {
      model: 'comm-max485',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 3.0,
      inputs: ['DI', 'DE', 'RE', 'A', 'B'],
      outputs: ['RO', 'A', 'B'],
      vilFrac: 0.45,
      vihFrac: 0.55,
      rout: 35,
    },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    subcircuit: [
      { id: 'R1', model: 'resistor', pins: ['RO', 'VCC'], params: { resistance: 10000 } },
      { id: 'R2', model: 'resistor', pins: ['RE', 'VCC'], params: { resistance: 10000 } },
      { id: 'R3', model: 'resistor', pins: ['DE', 'VCC'], params: { resistance: 10000 } },
      { id: 'R4', model: 'resistor', pins: ['DI', 'VCC'], params: { resistance: 10000 } },
      { id: 'R5', model: 'resistor', pins: ['B', 'GND'], params: { resistance: 20000 } },
      { id: 'R6', model: 'resistor', pins: ['A', 'VCC'], params: { resistance: 20000 } },
      { id: 'R7', model: 'comm_jumper_r', pins: ['A', 'B'], params: { resistance: 120, param: 'termination' } },
      { id: 'LED_PWR', model: 'led', pins: ['VCC', '@pwr_k'], params: { color: 'red' } },
      { id: 'R8', model: 'resistor', pins: ['@pwr_k', 'GND'], params: { resistance: 1000 } },
    ],
    ratings: { vddMin: 4.75, vddMax: 5.25 },
    support: {
      level: 'partial',
      simulated: [
        'driver: DE high → A/B driven by DI through 35 Ω per output (VOD ≈ 2.3 V into two 120 Ω terminations); DE low → released',
        'receiver: RO high for VA − VB ≥ +200 mV, low for ≤ −200 mV, held in between; RE high → RO released (module pull-up)',
        'A and B are two analog nets: the module\'s 10 kΩ pull-ups (RO RE DE DI), 20 kΩ bias (A up, B down), power LED and the 120 Ω termination R7 (param) are in the solve',
        'bus contention (another driver against this one) and a missing / one-ended / excess termination are reported from the measured differential voltage',
      ],
      limits: [
        'driver / receiver delays (30–60 ns), slew and the 12 kΩ receiver input load are not modeled',
        'cable reflections are not simulated: an unterminated bus still works (it is only reported)',
        'inside ±200 mV the real output is undefined; the model holds the last level (an idle, terminated bus is NOT fail-safe on real hardware)',
        'logic inputs switch at 0.45 / 0.55 × VCC (datasheet TTL 0.8 / 2.0 V)',
      ],
    },
    pinInfo: [
      { pin: 'RO', kind: 'output', functions: ['UART_RX'], note: 'Receiver output → MCU RX (5 V level: use a 5 V-tolerant pin, e.g. PA10 / PB11). 10 kΩ pull-up.' },
      { pin: 'RE', kind: 'input', note: 'Receiver enable, active low (10 kΩ pull-up). Usually tied to DE.' },
      { pin: 'DE', kind: 'input', note: 'Driver enable, active high (10 kΩ pull-up). High while transmitting.' },
      { pin: 'DI', kind: 'input', functions: ['UART_TX'], note: 'Driver input ← MCU TX (10 kΩ pull-up).' },
      { pin: 'VCC', kind: 'power', note: '5 V (4.75–5.25 V).' },
      { pin: 'B', kind: 'io', note: 'Bus B (inverting). 20 kΩ pull-down; 120 Ω to A (R7).' },
      { pin: 'A', kind: 'io', note: 'Bus A (non-inverting). 20 kΩ pull-up.' },
      { pin: 'GND', kind: 'ground' },
    ],
    meta: {
      partNumber: 'MAX485 TTL-to-RS-485 module',
      manufacturer: 'Maxim / Analog Devices (chip) / generic module',
      sizeMm: [44, 14, 10],
      tags: ['rs485', 'rs-485', 'max485', 'modbus', 'differential', 'half duplex', 'transceiver', 'industrial', 'serial'],
      specs: [
        'MAX485 half-duplex RS-485 / RS-422 transceiver, up to 2.5 Mbps',
        '5 V supply, 32 unit loads',
        '120 Ω termination (R7), 20 kΩ A/B bias, 10 kΩ pull-ups on the logic pins',
        'logic header RO RE DE DI, bus header VCC B A GND',
      ],
    },
    doc: 'MAX485 RS-485 transceiver module straddling the channel: logic header RO RE DE DI in row h (`at` = RO), bus header VCC B A GND in row c (VCC above RO). Power 5 V. MCU TX → DI, RO → MCU RX (RO is 5 V: use a 5 V-tolerant pin like PA10 or PB11), DE and RE tied together to one GPIO (high = transmit, low = receive). Connect A to A and B to B of the other nodes. Each module has a 120 Ω termination (R7): keep it on the two end nodes only (param). Only one node may drive at a time — the simulator reports bus contention and termination problems. (The real board is 44 mm long with its headers at both ends and an A/B screw terminal; here a compact board straddles the channel.)',
  },

  // ------------------------------------------------------------- W25Q32
  {
    type: 'w25q32_flash',
    label: 'SPI flash W25Q32 (4 MB)',
    category: 'module',
    placement: 'footprint',
    pins: ['CS', 'DO', 'WP', 'GND', 'DI', 'CLK', 'HOLD', 'VCC'],
    footprintOffsets: row(8, 'e'),
    allowedRotations: ROT,
    // flat breakout: the PCB lies over the channel and rows f–j
    bodyFootprint: { dCols: [0, 7], rows: ['e', 'f', 'g', 'h', 'i', 'j'] },
    obstacleHeight: 2.6,
    sim: { kind: 'chip', model: 'comm-module' },
    visual: { shape: 'comm_w25q' },
    digital: {
      model: 'comm-w25q32',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 2.5,
      inputs: ['CS', 'CLK', 'DI', 'WP', 'HOLD'],
      outputs: ['DO'],
      vilFrac: 0.3,
      vihFrac: 0.7,
      rout: 50,
    },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 2.7, vddMax: 3.6, vPinMax: 4.0 },
    support: {
      level: 'partial',
      simulated: [
        'SPI mode 0 / 3 at any clock rate: JEDEC ID 9Fh (EF 40 16), 90h, ABh, read 03h, fast read 0Bh, write enable / disable, status registers 1–3 (BUSY / WEL polling), status write',
        'page program 02h (256-byte page, address wraps inside the page, can only clear bits), sector 20h / block 52h, D8h / chip erase C7h, 60h — executed only when CS rises on a byte boundary, BUSY for the typical datasheet times (tPP 0.4 ms, tSE 45 ms, tBE 120 / 150 ms, tCE 10 s)',
        'block protection (BP2–0, TB, SEC with CMP = 0), SRP + /WP status lock, /HOLD pause, power-down B9h / release ABh',
        'non-volatile for the session (erased = FFh)',
      ],
      limits: [
        'dual / quad I/O, security registers, unique ID, SFDP and suspend / resume are not modeled (logged and ignored)',
        'timings are the typical values (real parts may take up to the maximum, e.g. tSE 400 ms)',
        'a floating /WP or /HOLD reads high (tie both to VCC on real hardware); endurance is not modeled',
      ],
    },
    pinInfo: [
      { pin: 'CS', kind: 'input', functions: ['SPI_NSS'], note: 'Chip select, active low.' },
      { pin: 'DO', kind: 'output', functions: ['SPI_MISO'], note: 'Data out → MCU MISO (released while CS is high).' },
      { pin: 'WP', kind: 'input', note: '/WP, active low: with SRP = 1 locks the status register. Tie to VCC.' },
      { pin: 'GND', kind: 'ground' },
      { pin: 'DI', kind: 'input', functions: ['SPI_MOSI'], note: 'Data in ← MCU MOSI.' },
      { pin: 'CLK', kind: 'input', functions: ['SPI_SCK'], note: 'Serial clock (mode 0 or 3).' },
      { pin: 'HOLD', kind: 'input', note: '/HOLD, active low: pauses the interface. Tie to VCC.' },
      { pin: 'VCC', kind: 'power', note: '2.7–3.6 V — NOT 5 V.' },
    ],
    meta: {
      partNumber: 'W25Q32JVSSIQ breakout',
      manufacturer: 'Winbond (chip) / generic breakout',
      sizeMm: [22, 18, 4],
      tags: ['flash', 'spi', 'nor', 'w25q32', 'w25q', 'winbond', 'memory', 'storage', 'eeprom'],
      specs: [
        '32 Mbit (4 MiB) serial NOR flash, 256-byte pages, 4 KiB sectors',
        'SPI up to 133 MHz, modes 0 and 3',
        'JEDEC ID EF 40 16',
        '2.7–3.6 V, 100 000 program / erase cycles',
      ],
    },
    doc: 'W25Q32 4 MB SPI NOR flash breakout, 8 pins in one row CS DO WP GND DI CLK HOLD VCC (`at` = CS in row e; the board lies over the channel and rows f–j). Power 3.3 V (never 5 V). SPI mode 0: CLK ← SCK, DI ← MOSI, DO → MISO, CS ← a GPIO. Tie WP and HOLD to VCC. Send 06h (write enable) before every page program (02h) or erase (20h sector 4 KB); then poll status register 05h until BUSY (bit 0) clears — a sector erase takes about 45 ms. JEDEC ID 9Fh returns EF 40 16. Erased bytes read FFh; contents persist.',
  },

  // ------------------------------------------------------------ micro-SD
  {
    type: 'sd_card_spi',
    label: 'micro-SD card module (SPI)',
    category: 'module',
    placement: 'footprint',
    pins: ['GND', 'VCC', 'MISO', 'MOSI', 'SCK', 'CS'],
    footprintOffsets: row(6, 'e'),
    allowedRotations: ROT,
    // 24 mm wide board lying over the channel and the lower half
    bodyFootprint: { dCols: [-2, 7], rows: ['e', 'f', 'g', 'h', 'i', 'j'] },
    obstacleHeight: 2.9,
    params: [
      { key: 'card', label: 'Card', kind: 'select', default: 'sdhc', options: ['sdhc', 'sdsc'] },
    ],
    sim: { kind: 'chip', model: 'comm-module' },
    visual: { shape: 'comm_sdcard' },
    digital: {
      model: 'comm-sdcard',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 3.8,
      inputs: ['CS', 'SCK', 'MOSI'],
      outputs: ['MISO'],
      // 74LVC125A buffer at 3.3 V: VIL 0.8 V / VIH 2.0 V (5 V-tolerant inputs)
      vilFrac: 0.16,
      vihFrac: 0.4,
      rout: 25,
      // card and buffer run from the module's 3.3 V regulator: MISO high is 3.3 V
      outputRail: { node: '@v33' },
    },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    subcircuit: [
      { id: 'REG', model: 'ldo', pins: ['VCC', '@v33', 'GND'], params: { vout: 3.3, dropout: 1.1, rout: 0.05, ilimit: 0.8 } },
      { id: 'R_MISO', model: 'resistor', pins: ['MISO', '@v33'], params: { resistance: 1000 } },
    ],
    ratings: { vddMin: 4.5, vddMax: 5.5 },
    support: {
      level: 'partial',
      simulated: [
        'SD SPI mode: 74 power-up clocks, CMD0 (CRC 95h), CMD8, CMD55 + ACMD41 initialization (idle until ready), CMD58 OCR (CCS), CMD59 CRC on/off, CMD9 / CMD10 CSD / CID, CMD13, CMD16',
        'single and multiple block read / write (CMD17 / 18 + CMD12, CMD24 / 25) with data tokens, CRC16 and busy',
        'card image: SDHC 4 GB with an MBR and a FAT32 volume, or SDSC 128 MB with FAT16 (param), formatted by the simulator (label OHMLET SD, file HELLO.TXT); written blocks persist for the session',
        'module: AMS1117 3.3 V regulator and 3.3 V MISO level (1 kΩ to the 3.3 V rail for the high side)',
      ],
      limits: [
        'SD bus (4-bit) mode, erase / lock / switch-function commands and ACMDs other than ACMD41 are not supported (illegal command)',
        'only 512-byte blocks (CMD16 with another length → parameter error)',
        'timing: initialization 25 ms, read access 0.25 ms, write busy 1.5 ms (real cards vary widely)',
        'commands must start on byte boundaries; the card releases MISO immediately when CS goes high',
      ],
    },
    pinInfo: [
      { pin: 'GND', kind: 'ground' },
      { pin: 'VCC', kind: 'power', note: '4.5–5.5 V (on-board 3.3 V regulator for the card).' },
      { pin: 'MISO', kind: 'output', functions: ['SPI_MISO'], note: 'Card data out (3.3 V level).' },
      { pin: 'MOSI', kind: 'input', functions: ['SPI_MOSI'], note: 'Card data in (5 V-tolerant buffer).' },
      { pin: 'SCK', kind: 'input', functions: ['SPI_SCK'], note: 'SPI clock (≤ 400 kHz during initialization).' },
      { pin: 'CS', kind: 'input', functions: ['SPI_NSS'], note: 'Chip select, active low.' },
    ],
    meta: {
      partNumber: 'micro-SD card adapter (Catalex-style, AMS1117 + 74LVC125A)',
      manufacturer: 'generic module',
      sizeMm: [42, 24, 4.5],
      tags: ['sd', 'micro sd', 'microsd', 'sd card', 'tf card', 'spi', 'fat', 'fat32', 'storage', 'memory', 'datalogger'],
      specs: [
        'micro-SD socket, SPI mode',
        'AMS1117-3.3 regulator, 74LVC125A level shifter: 5 V supply and logic',
        'virtual card: SDHC 4 GB FAT32 or SDSC 128 MB FAT16',
      ],
    },
    doc: 'micro-SD card module (SPI), 6-pin header GND VCC MISO MOSI SCK CS in one row (`at` = GND in row e; the board lies over the channel). Power 5 V (on-board 3.3 V regulator). SPI mode 0, ≤ 400 kHz until initialized: send ≥ 74 clocks with CS high, CMD0 (CRC 0x95), CMD8 (0x1AA, CRC 0x87), then CMD55 + ACMD41 (HCS) until R1 = 0, CMD58 to read the OCR (CCS = SDHC block addressing). Read / write 512-byte blocks with CMD17 / CMD24. The simulated card holds an MBR + FAT32 volume "OHMLET SD" (SDHC 4 GB) or FAT16 (SDSC 128 MB).',
  },

  // ------------------------------------------------------------ PCF8574
  {
    type: 'pcf8574_module',
    label: 'I/O expander PCF8574 (I²C)',
    category: 'module',
    placement: 'footprint',
    // port header P0–P7 in row h, bus header GND VCC SDA SCL INT in row c
    pins: ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'GND', 'VCC', 'SDA', 'SCL', 'INT'],
    footprintOffsets: [...row(8, 'h'), ...[1, 2, 3, 4, 5].map((dCol) => ({ dCol, row: 'c' as const }))],
    allowedRotations: ROT,
    bodyFootprint: { dCols: [0, 7], rows: ['c', 'd', 'e', 'f', 'g', 'h'] },
    // A0–A2 shunts on their 1×3 headers (12.6 mm above the breadboard)
    obstacleHeight: 5.0,
    params: [
      {
        key: 'address',
        label: 'I²C address (A2–A0 jumpers)',
        kind: 'select',
        default: '0x20',
        options: ['0x20', '0x21', '0x22', '0x23', '0x24', '0x25', '0x26', '0x27'],
        runtime: true,
      },
    ],
    sim: { kind: 'chip', model: 'comm-module' },
    visual: { shape: 'comm_pcf8574' },
    digital: {
      model: 'comm-pcf8574',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 2.5,
      inputs: ['SCL', 'SDA', 'P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'],
      outputs: ['SDA', 'INT', 'P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'],
      vilFrac: 0.3,
      vihFrac: 0.7,
      // P-port sink: IOL 25 mA at VOL 1 V
      rout: 40,
      // quasi-bidirectional high: ≈ 100 µA weak pull-up
      rPull: 50000,
    },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    subcircuit: [
      { id: 'R_SDA', model: 'resistor', pins: ['SDA', 'VCC'], params: { resistance: 10000 } },
      { id: 'R_SCL', model: 'resistor', pins: ['SCL', 'VCC'], params: { resistance: 10000 } },
    ],
    ratings: { vddMin: 2.5, vddMax: 6, vPinMax: 6.5 },
    support: {
      level: 'partial',
      simulated: [
        'I²C slave at the bit level: address 0100·A2A1A0 (0x20–0x27, jumper param), ACK, write = port latch, read = port pin levels sampled at the acknowledge',
        'quasi-bidirectional P0–P7: latch 0 = strong low (40 Ω, 25 mA), latch 1 = weak pull-up (≈ 100 µA) so the pin works as an input',
        'INT open drain: low while an input differs from the last read / write, released by a port access or when the input returns',
        'module 10 kΩ pull-ups on SDA and SCL; power-on state: all ports high',
      ],
      limits: [
        'the brief strong pull-up after a write (accelerated rising edge) and t_pv / t_iv delays are not modeled; SDA changes 0.3 µs after SCL falls',
        'bus timing is not checked: any SCL rate the master produces works',
        'ports are not current-limited beyond the 40 Ω driver (the ERC checks ratings)',
      ],
    },
    pinInfo: [
      ...['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'].map((pin) => ({
        pin,
        kind: 'io' as const,
        note: 'Quasi-bidirectional: write 0 = sinks up to 25 mA (drive LEDs from VCC through a resistor), write 1 = weak high / input.',
      })),
      { pin: 'GND', kind: 'ground' as const },
      { pin: 'VCC', kind: 'power' as const, note: '2.5–6 V.' },
      { pin: 'SDA', kind: 'io' as const, functions: ['I2C_SDA'], note: 'I²C data (10 kΩ pull-up on the module).' },
      { pin: 'SCL', kind: 'input' as const, functions: ['I2C_SCL'], note: 'I²C clock (10 kΩ pull-up on the module).' },
      { pin: 'INT', kind: 'output' as const, note: 'Interrupt, open drain, active low: needs a pull-up.' },
    ],
    meta: {
      partNumber: 'PCF8574 I/O expansion module',
      manufacturer: 'NXP / TI (chip) / generic module',
      sizeMm: [23, 19, 6],
      tags: ['pcf8574', 'io expander', 'gpio expander', 'i2c', 'iic', 'port expander', '8 bit', 'quasi bidirectional'],
      specs: [
        '8-bit quasi-bidirectional I/O over I²C (100 kHz)',
        'address 0x20–0x27 (A2–A0 jumpers)',
        'ports sink 25 mA, source ≈ 100 µA',
        'open-drain interrupt output',
      ],
    },
    doc: 'PCF8574 I²C 8-bit I/O expander module straddling the channel: port header P0–P7 in row h (`at` = P0), bus header GND VCC SDA SCL INT in row c (GND above P1). Power 2.5–6 V; SDA/SCL have 10 kΩ pull-ups on the module. Address 0x20 + A2A1A0 (jumper param). Writing a byte sets the port latch: a 0 bit pulls the pin low hard (light an LED wired from VCC through 330 Ω to the pin), a 1 bit is a weak pull-up that also works as an input (a button from the pin to GND reads 0). INT goes low when an input changes.',
  },

  // -------------------------------------------------------------- ESP-01
  {
    type: 'esp01',
    label: 'Wi-Fi module ESP-01 (ESP8266)',
    category: 'module',
    placement: 'footprint',
    // the ESP-01's 2×4 header cannot plug into a breadboard: it sits in the
    // 2×4 socket of a 1×8 breadboard adapter (header in row e) and lies flat
    // 15 mm above the board, overhanging the channel and rows f–j
    pins: ['GND', 'GPIO2', 'GPIO0', 'RXD', 'TXD', 'CH_PD', 'RST', 'VCC'],
    footprintOffsets: row(8, 'e'),
    allowedRotations: ROT,
    bodyFootprint: { dCols: [0, 7], rows: ['e', 'f', 'g', 'h', 'i', 'j'] },
    obstacleHeight: 7.0,
    sim: { kind: 'chip', model: 'comm-module' },
    visual: { shape: 'comm_esp01' },
    digital: {
      model: 'comm-esp01',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 2.5,
      inputs: ['RXD', 'CH_PD', 'RST', 'GPIO0', 'GPIO2'],
      outputs: ['TXD', 'GPIO0', 'GPIO2'],
      vilFrac: 0.25,
      vihFrac: 0.75,
      rout: 50,
    },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    subcircuit: [
      { id: 'LED_PWR', model: 'led', pins: ['VCC', '@pwr_k'], params: { color: 'red' } },
      { id: 'R_PWR', model: 'resistor', pins: ['@pwr_k', 'GND'], params: { resistance: 1000 } },
    ],
    ratings: { vddMin: 3.0, vddMax: 3.6, vPinMax: 3.6 },
    support: {
      level: 'partial',
      simulated: [
        'power, CH_PD (enable) and RST: the chip runs only with CH_PD high and RST not low',
        'boot straps: GPIO0 low at reset → UART download mode, else the AT firmware; boot ROM banner at 74880 baud, then "ready" at 115200 8N1',
        'AT command subset with echo: AT, ATE0 / ATE1, AT+GMR, AT+RST, AT+CWMODE? / AT+CWMODE=',
      ],
      limits: [
        'NO Wi-Fi: there is no radio and no network — scan, join, TCP / UDP and every other network command answers ERROR',
        'the AT firmware version (AT 1.7.4) is fixed; AT+UART and the other configuration commands are not implemented',
        'boot time 0.25 s is an estimate; GPIO0 / GPIO2 are boot straps only (no user firmware runs)',
        'supply current peaks (up to 300 mA with the radio) are not drawn',
      ],
    },
    pinInfo: [
      { pin: 'GND', kind: 'ground' },
      { pin: 'GPIO2', kind: 'io', note: 'Boot strap (internal pull-up): must be high at reset.' },
      { pin: 'GPIO0', kind: 'io', note: 'Boot strap (internal pull-up): low at reset = flash download mode.' },
      { pin: 'RXD', kind: 'input', functions: ['UART_RX'], note: 'ESP receive ← MCU TX (3.3 V only).' },
      { pin: 'TXD', kind: 'output', functions: ['UART_TX'], note: 'ESP transmit → MCU RX.' },
      { pin: 'CH_PD', kind: 'input', note: 'Chip enable: must be pulled HIGH (no pull-up on the ESP-01).' },
      { pin: 'RST', kind: 'input', note: 'Reset, active low (internal pull-up).' },
      { pin: 'VCC', kind: 'power', note: '3.3 V only (3.0–3.6 V).' },
    ],
    meta: {
      partNumber: 'ESP-01 (ESP8266EX, 1 MB flash) on a 1×8 breadboard adapter',
      manufacturer: 'Espressif (chip) / AI-Thinker (module)',
      sizeMm: [24.8, 14.3, 17.5],
      tags: ['esp01', 'esp-01', 'esp8266', 'wifi', 'wi-fi', 'at command', 'uart', 'iot', 'wireless'],
      specs: [
        'ESP8266EX, 1 MB SPI flash, PCB antenna',
        'AT firmware, 115200 8N1 (boot ROM 74880)',
        '3.3 V only, not 5 V tolerant',
        'Wi-Fi NOT simulated in this lab',
      ],
    },
    doc: 'ESP-01 (ESP8266) Wi-Fi module on a 1×8 breadboard adapter, pins GND GPIO2 GPIO0 RXD TXD CH_PD RST VCC in one row (`at` = GND in row e); the module lies flat on the adapter socket, 15 mm above rows f–j. 3.3 V only: VCC and CH_PD to 3.3 V (CH_PD has no pull-up), GND, TXD → MCU RX, RXD ← MCU TX. After reset it prints its ROM banner at 74880 baud, then "ready" at 115200 baud and answers AT commands (AT, AT+GMR, AT+RST, AT+CWMODE?). Wi-Fi is NOT simulated: network commands answer ERROR.',
  },

  // ------------------------------------------------------------- TJA1050
  {
    type: 'can_tja1050',
    label: 'CAN transceiver module (TJA1050)',
    category: 'module',
    placement: 'footprint',
    // logic header TX RX VCC GND in row h, bus header CANH CANL in row c
    pins: ['TX', 'RX', 'VCC', 'GND', 'CANH', 'CANL'],
    footprintOffsets: [...row(4, 'h'), { dCol: 1, row: 'c' }, { dCol: 2, row: 'c' }],
    allowedRotations: ROT,
    bodyFootprint: { dCols: [0, 3], rows: ['c', 'd', 'e', 'f', 'g', 'h'] },
    obstacleHeight: 2.4,
    params: [{ key: 'termination', label: '120 Ω termination fitted', kind: 'boolean', default: true }],
    sim: { kind: 'chip', model: 'comm-module' },
    visual: { shape: 'comm_tja1050' },
    digital: {
      model: 'comm-tja1050',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 4.0,
      inputs: ['TX', 'CANH', 'CANL'],
      outputs: ['RX', 'TX', 'CANH', 'CANL'],
      vilFrac: 0.55,
      vihFrac: 0.6,
      rout: 45,
    },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    subcircuit: [
      // common-mode bias: ≈ 25 kΩ to 0.5·VCC on each bus line (Ri(cm) 15–35 kΩ)
      { id: 'RH1', model: 'resistor', pins: ['CANH', 'VCC'], params: { resistance: 50000 } },
      { id: 'RH2', model: 'resistor', pins: ['CANH', 'GND'], params: { resistance: 50000 } },
      { id: 'RL1', model: 'resistor', pins: ['CANL', 'VCC'], params: { resistance: 50000 } },
      { id: 'RL2', model: 'resistor', pins: ['CANL', 'GND'], params: { resistance: 50000 } },
      { id: 'RT', model: 'comm_jumper_r', pins: ['CANH', 'CANL'], params: { resistance: 120, param: 'termination' } },
    ],
    ratings: { vddMin: 4.75, vddMax: 5.25 },
    support: {
      level: 'partial',
      simulated: [
        'transceiver only: TX low → dominant (CANH ≈ 3.5 V, CANL ≈ 1.5 V into 60 Ω), TX high / open → recessive (both ≈ 2.5 V through the internal bias)',
        'RX low while VCANH − VCANL > 0.9 V, high below 0.5 V (hysteresis between); wired-AND bus: any dominant node wins',
        'TXD dominant time-out (450 µs) and a TX high level below 0.7·VCC are reported',
        '120 Ω termination on the module (param), bias network in the analog solve',
      ],
      limits: [
        'the STM32 bxCAN controller is NOT emulated: no CAN frames, bit timing, arbitration or error handling — the transceiver passes levels only',
        'propagation delays, slope control and the S (silent) pin are not modeled',
        'TX threshold modeled at 0.55–0.6·VCC (a 3.3 V MCU works here; the datasheet guarantees only ≥ 0.7·VCC)',
      ],
    },
    pinInfo: [
      { pin: 'TX', label: 'CTX', kind: 'input', functions: ['CAN_TX'], note: 'Transmit data ← CAN_TX (PA12): low = dominant. Internal pull-up.' },
      { pin: 'RX', label: 'CRX', kind: 'output', functions: ['CAN_RX'], note: 'Receive data → CAN_RX (PA11, 5 V tolerant): low = dominant. 5 V level.' },
      { pin: 'VCC', kind: 'power', note: '5 V (4.75–5.25 V).' },
      { pin: 'GND', kind: 'ground' },
      { pin: 'CANH', kind: 'io', note: 'CAN high bus line.' },
      { pin: 'CANL', kind: 'io', note: 'CAN low bus line (120 Ω to CANH on the module).' },
    ],
    meta: {
      partNumber: 'TJA1050 CAN bus module',
      manufacturer: 'NXP (chip) / generic module',
      sizeMm: [22, 11, 9],
      tags: ['can', 'can bus', 'tja1050', 'transceiver', 'automotive', 'canh', 'canl', 'bxcan'],
      specs: [
        'TJA1050 high-speed CAN transceiver, up to 1 Mbit/s',
        '5 V supply, 120 Ω termination on board',
        'TXD dominant time-out',
        'transceiver only — needs a CAN controller (bxCAN is not emulated)',
      ],
    },
    doc: 'TJA1050 CAN transceiver module straddling the channel: TX RX VCC GND in row h (`at` = TX), CANH CANL in row c (above RX and VCC). Power 5 V. Connect CANH to CANH and CANL to CANL of the other nodes; TX ← CAN_TX (PA12), RX → CAN_RX (PA11). The STM32 CAN controller (bxCAN) is NOT emulated, so only the bus levels work: TX low drives the bus dominant, RX follows the bus. Holding TX low longer than ~450 µs trips the dominant time-out.',
  },
]
