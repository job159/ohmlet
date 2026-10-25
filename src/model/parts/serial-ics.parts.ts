/**
 * Serial-bus ICs (DIP packages, rendered by the generic DIP mesh with the
 * part code from `label`): the AT24C02 I²C EEPROM and the 74HC595 shift
 * register. Behaviour: src/sim/models/serial-ics.model.ts (logic-level
 * digital devices run by the Simulation Coordinator).
 */
import type { CatalogEntry } from '../catalog'

export const PARTS: CatalogEntry[] = [
  {
    type: 'at24c02',
    label: 'AT24C02 I²C EEPROM 2 Kbit',
    category: 'ic',
    placement: 'dip',
    // DIP-8, pin 1 … 8 (Microchip AT24C02C / Atmel AT24C02 pinout)
    pins: ['A0', 'A1', 'A2', 'GND', 'SDA', 'SCL', 'WP', 'VCC'],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto',
    digital: {
      model: 'at24c02',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 1.7,
      inputs: ['A0', 'A1', 'A2', 'SDA', 'SCL', 'WP'],
      // SDA is open drain ('low' / released); A0–A2 and WP carry the internal pull-downs
      outputs: ['SDA', 'A0', 'A1', 'A2', 'WP'],
      vilFrac: 0.3,
      vihFrac: 0.7,
      // V_OL 0.4 V at 3 mA (VCC 3 V) → ≤ 133 Ω open-drain sink
      rout: 100,
    },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 1.7, vddMax: 5.5, vPinMax: 6.25 },
    support: {
      level: 'partial',
      simulated: [
        'I²C slave at the bit level: START/STOP detection, address 1010·A2A1A0, ACK on SDA (open drain), bits sampled on SCL rising edges',
        'byte write and 8-byte page write with in-page address roll-over; 5 ms self-timed write cycle (t_WR max) during which the address is not acknowledged (ACK polling works)',
        'current-address, random and sequential reads (address rolls over 0xFF → 0x00); master NACK ends a read',
        'WP high: data acknowledged but not written; A0–A2 / WP internal pull-downs (floating = 0)',
        'non-volatile: contents survive power cycles and simulation resets for the session (erased parts read 0xFF)',
      ],
      limits: [
        'bus timing is not checked (setup/hold, maximum SCL frequency per VCC): any rate the master produces works',
        'SDA output changes a fixed 0.3 µs after SCL falls (t_AA); no output slew',
        'a power loss during the write cycle loses that page write (real parts may leave the page partially written)',
        'endurance (1 M cycles) and data retention are not modelled',
      ],
    },
    pinInfo: [
      { pin: 'A0', kind: 'input', note: 'Device address bit 0 (internal pull-down: floating = 0).' },
      { pin: 'A1', kind: 'input', note: 'Device address bit 1 (internal pull-down: floating = 0).' },
      { pin: 'A2', kind: 'input', note: 'Device address bit 2 (internal pull-down: floating = 0).' },
      { pin: 'GND', kind: 'ground' },
      { pin: 'SDA', kind: 'io', functions: ['I2C_SDA'], note: 'Open-drain data line: needs a pull-up (e.g. 4.7 kΩ to VCC).' },
      { pin: 'SCL', kind: 'input', functions: ['I2C_SCL'], note: 'Serial clock input (needs the bus pull-up).' },
      { pin: 'WP', kind: 'input', note: 'Write protect: high = whole array read-only; low/floating = writable.' },
      { pin: 'VCC', kind: 'power', note: '1.7 – 5.5 V.' },
    ],
    meta: {
      partNumber: 'AT24C02C-PUM',
      manufacturer: 'Microchip (Atmel)',
      sizeMm: [9.27, 6.35, 3.3],
      tags: ['eeprom', 'i2c', 'iic', 'twi', '24c02', 'at24c02', 'memory', 'serial'],
      specs: [
        '2 Kbit (256 × 8) serial EEPROM, I²C (100 kHz / 400 kHz / 1 MHz)',
        '8-byte page write, 5 ms max self-timed write cycle',
        'Address 0x50–0x57 (1010·A2A1A0), hardware write protect',
        '1.7 – 5.5 V, DIP-8',
      ],
    },
    doc: 'AT24C02 2-Kbit I²C EEPROM (DIP-8: A0 A1 A2 GND SDA SCL WP VCC). 7-bit address 0x50 + A2A1A0 (pins grounded or floating = 0x50). SDA and SCL need pull-up resistors (4.7 kΩ to VCC). Page writes of up to 8 bytes; after each write the chip is busy 5 ms and does not acknowledge (poll with HAL_I2C_IsDeviceReady). WP high blocks writes. Contents are kept across power cycles.',
  },
  {
    type: '74hc595',
    label: '74HC595 shift register',
    category: 'ic',
    placement: 'dip',
    // DIP-16, pin 1 … 16
    pins: ['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'GND', "QH'", 'SRCLR', 'SRCLK', 'RCLK', 'OE', 'SER', 'QA', 'VCC'],
    sim: { kind: 'chip', model: 'digital-device' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto',
    digital: {
      model: '74hc595',
      supplyPin: 'VCC',
      groundPin: 'GND',
      minVdd: 2,
      inputs: ['SER', 'SRCLK', 'RCLK', 'SRCLR', 'OE'],
      outputs: ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', "QH'"],
      vilFrac: 0.3,
      vihFrac: 0.7,
      rout: 50,
    },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 2, vddMax: 6, vPinMax: 7, iMax: 0.07 },
    support: {
      level: 'partial',
      simulated: [
        'SRCLK rising edge shifts SER through stages A…H; SRCLR (active low) clears the shift register asynchronously',
        'RCLK rising edge loads the storage register (one clock behind when SRCLK and RCLK are tied together)',
        'OE (active low): QA–QH push-pull outputs (50 Ω) or high impedance; QH\' serial output always driven',
        'outputs follow the clock edges after 20 ns, so daisy-chained 595s shift correctly',
      ],
      limits: [
        'propagation delay fixed at 20 ns (typ. at 4.5 V, not scaled with VCC); setup/hold times not checked',
        'power-up register contents are 0 (undefined on real parts)',
        'a floating control input keeps its last level (and is reported) instead of being undefined',
        'output current limits (±35 mA per pin, 70 mA total) are only checked by the ERC',
      ],
    },
    pinInfo: [
      { pin: 'QB', kind: 'output', note: 'Parallel output B (storage register bit 1).' },
      { pin: 'QC', kind: 'output', note: 'Parallel output C.' },
      { pin: 'QD', kind: 'output', note: 'Parallel output D.' },
      { pin: 'QE', kind: 'output', note: 'Parallel output E.' },
      { pin: 'QF', kind: 'output', note: 'Parallel output F.' },
      { pin: 'QG', kind: 'output', note: 'Parallel output G.' },
      { pin: 'QH', kind: 'output', note: 'Parallel output H (storage register bit 7).' },
      { pin: 'GND', kind: 'ground' },
      { pin: "QH'", kind: 'output', note: 'Serial output (shift stage H) — chain to the next 595\'s SER.' },
      { pin: 'SRCLR', kind: 'input', label: 'SRCLR', note: 'Shift register clear, active low: tie to VCC for normal use.' },
      { pin: 'SRCLK', kind: 'input', functions: ['SPI_SCK'], note: 'Shift clock: SER is shifted in on the rising edge (SPI mode 0/3).' },
      { pin: 'RCLK', kind: 'input', note: 'Storage (latch) clock: rising edge copies the shift register to QA–QH.' },
      { pin: 'OE', kind: 'input', label: 'OE', note: 'Output enable, active low: tie to GND to drive QA–QH.' },
      { pin: 'SER', kind: 'input', functions: ['SPI_MOSI'], note: 'Serial data input.' },
      { pin: 'QA', kind: 'output', note: 'Parallel output A (storage register bit 0, the last bit shifted in).' },
      { pin: 'VCC', kind: 'power', note: '2 – 6 V.' },
    ],
    meta: {
      partNumber: 'SN74HC595N',
      manufacturer: 'Texas Instruments / NXP / generic',
      sizeMm: [19.3, 6.35, 3.9],
      tags: ['74hc595', '595', 'shift register', 'spi', 'serial to parallel', 'latch', 'led driver', 'port expander'],
      specs: [
        '8-bit serial-in, parallel-out shift register with storage register',
        '3-state outputs (OE), serial output QH\' for cascading',
        '2 – 6 V, ±6 mA standard output drive (±35 mA abs. max per pin)',
        'DIP-16',
      ],
    },
    doc: '74HC595 8-bit shift register with output latch (DIP-16: QB QC QD QE QF QG QH GND QH\' SRCLR SRCLK RCLK OE SER QA VCC). Drive SER (data) and SRCLK (clock, SPI MOSI/SCK in mode 0), then pulse RCLK to show the byte on QA–QH (the last bit shifted in appears on QA). Tie SRCLR to VCC and OE to GND. Chain QH\' to the SER of a second 595 for 16 outputs. Each output can drive an LED through a resistor.',
  },
]
