/**
 * Motors & drivers family: DC motor, SG90 servo, 28BYJ-48 and NEMA 17
 * steppers, ULN2003 / L298N boards, TB6612FNG and DRV8833 breakouts and the
 * A4988 / DRV8825 / TMC2209 StepStick carriers. Behaviour:
 * src/sim/models/motors.model.ts (every part = chip 'motors_part' + its
 * electrical sub-circuit), meshes: src/three/meshes/ext/motors.mesh.ts.
 *
 * Placement: motors and the two large modules (L298N 43 × 43 mm with screw
 * terminals, ULN2003 board 35 × 32 mm) sit on the bench as off-board units
 * wired by their terminals ("ID:PIN"); the small driver carriers straddle
 * the channel like a DIP (two header rows, rotations 0 / 180 only).
 *
 * Sources: Allegro A4988 datasheet (4988-DS Rev. 8), TI DRV8825 (SLVSA73F),
 * TI DRV8833 (SLVSAR1E), Toshiba TB6612FNG, ST L298 (Rev. 5), TI ULN2003A
 * (SLRS027), Trinamic TMC2209 (rev 1.08), Pololu A4988 / DRV8825 carrier
 * pages, SparkFun TB6612FNG hookup guide, TowerPro SG90 and Kiatronics
 * 28BYJ-48 data sheets, 17HS4401 data sheet.
 */
import type { CatalogEntry, PinInfo, SubcircuitElement } from '../catalog'

const PART_CHIP = { kind: 'chip', model: 'motors_part' } as const

/** two header rows along the columns: `first` (pins 0..n−1) and `second` (pins n..2n−1), both left → right */
function twoRows(n: number, first: 'g' | 'h', second: 'c' | 'd'): { dCol: number; row: 'c' | 'd' | 'g' | 'h' }[] {
  return [
    ...Array.from({ length: n }, (_, i) => ({ dCol: i, row: first })),
    ...Array.from({ length: n }, (_, i) => ({ dCol: i, row: second })),
  ]
}

// --------------------------------------------------------------- ULN2003 board

/**
 * One ULN2003A channel as in the datasheet schematic: IN —2.7 kΩ— base of
 * the driver transistor (7.2 kΩ to the common emitter), its emitter drives
 * the output transistor's base (3 kΩ to the emitter), both collectors on
 * OUT, clamp diode OUT → COM (= the board's VCC). Board indicator: VCC —
 * 1 kΩ — LED — OUT (lit while the channel sinks).
 */
function ulnChannel(n: number, led: string): SubcircuitElement[] {
  return [
    { id: `R_IN${n}`, model: 'resistor', pins: [`IN${n}`, `@b1_${n}`], params: { resistance: 2700 } },
    { id: `R_BE${n}`, model: 'resistor', pins: [`@b1_${n}`, 'GND'], params: { resistance: 7200 } },
    { id: `QD${n}`, model: 'npn', pins: [`@b2_${n}`, `@b1_${n}`, `OUT${n}`] },
    { id: `R_B${n}`, model: 'resistor', pins: [`@b2_${n}`, 'GND'], params: { resistance: 3000 } },
    { id: `QO${n}`, model: 'npn', pins: ['GND', `@b2_${n}`, `OUT${n}`] },
    { id: `D${n}`, model: 'diode', pins: [`OUT${n}`, 'VCC'] },
    { id: `R_LED${n}`, model: 'resistor', pins: ['VCC', `@led_${n}`], params: { resistance: 1000 } },
    { id: `LED_${led}`, model: 'led', pins: [`@led_${n}`, `OUT${n}`], params: { color: 'red' } },
  ]
}

// ------------------------------------------------------------ StepStick pins

const STEP_DIR_INFO: PinInfo[] = [
  { pin: 'STEP', kind: 'input', note: 'Rising edge = one microstep.' },
  { pin: 'DIR', kind: 'input', note: 'Direction, sampled at the STEP rising edge.' },
]

export const PARTS: CatalogEntry[] = [
  // ======================================================== DC motor
  {
    type: 'dc_motor',
    label: 'DC motor (130-size, 3–6 V)',
    category: 'motor',
    placement: 'offboard',
    // legacy 2.5 pitch; terminal 0 at 2.5 so the leads curling off the solder tabs stay inside the rect
    offboard: { terminalOffset: { x: 2.5, z: 2 }, rect: { w: 7, d: 4.5 } },
    pins: ['M+', 'M-'],
    params: [
      { key: 'loadTorque', label: 'Load torque', kind: 'number', default: 0, min: 0, max: 20, step: 0.1, unit: 'mN·m', runtime: true },
    ],
    sim: PART_CHIP,
    subcircuit: [{ id: 'M', model: 'motor_dc', pins: ['M+', 'M-'] }],
    visual: { shape: 'motor_dc' },
    strictNewton: true,
    support: {
      level: 'full',
      simulated: [
        'armature R 3 Ω + L 0.2 mH + back-EMF Ke·ω (Ke = Kt = 4 mV·s/rad)',
        'rotor J·dω/dt = Kt·i − b·ω − friction − load, solved together with the armature each analog step',
        'brush/bearing friction 0.4 mN·m (≈ 0.1 A no-load) and a runtime load torque that also holds the shaft at standstill',
        'stall: the full V/R current flows (2.0 A at 6 V) and a warning is logged after 0.2 s',
        'direction follows the current: + on M+ turns the shaft clockwise (seen from the shaft)',
      ],
      limits: [
        'one generic motor (no-load ≈ 13 400 rpm at 6 V); no brush arcing, commutation ripple or electrical noise',
        'no heating: a stalled motor never burns out',
      ],
    },
    pinInfo: [
      { pin: 'M+', label: '+', kind: 'passive', note: 'Red-dot terminal: positive here turns the shaft clockwise.' },
      { pin: 'M-', label: '−', kind: 'passive' },
    ],
    meta: {
      partNumber: 'R130 / FA-130 class',
      manufacturer: 'generic',
      sizeMm: [25, 20, 15],
      tags: ['dc motor', 'motor', 'brushed', '130', 'r130', 'fa-130', 'toy motor', 'pwm', 'h-bridge'],
      specs: [
        '3–6 V brushed permanent-magnet motor',
        'no-load ≈ 6 400 rpm @ 3 V / 13 400 rpm @ 6 V, ≈ 0.1 A',
        'stall 2.0 A / 8 mN·m @ 6 V',
        'mechanical time constant ≈ 22 ms',
      ],
    },
    doc: 'Small brushed DC motor (130-size, 3–6 V), off-board with terminals "ID:M+" and "ID:M-". Never drive it from an MCU pin: use an H-bridge (L298N, TB6612FNG, DRV8833) or a transistor with a flyback diode. Reversing the voltage reverses the rotation; speed ≈ (V − I·3 Ω)/4 mV·s/rad (≈ 13 400 rpm at 6 V); stall current V/3 Ω. Runtime param loadTorque (mN·m) brakes the shaft.',
  },

  // ======================================================== SG90 servo
  {
    type: 'sg90_servo',
    label: 'SG90 micro servo',
    category: 'motor',
    placement: 'offboard',
    // three-lead ribbon: terminals 1 apart (the legacy 2.5 pitch put SIG outside the 6.5 rect)
    offboard: { terminalPitch: 1 },
    // lead colors brown / red / orange, the JR plug order
    pins: ['GND', 'VCC', 'SIG'],
    params: [
      { key: 'loadTorque', label: 'Load torque', kind: 'number', default: 0, min: 0, max: 2, step: 0.05, unit: 'N·cm', runtime: true },
    ],
    sim: PART_CHIP,
    subcircuit: [{ id: 'S', model: 'motor_sg90', pins: ['GND', 'VCC', 'SIG'] }],
    visual: { shape: 'servo_sg90' },
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 4.8, vddMax: 6.0 },
    support: {
      level: 'partial',
      simulated: [
        'SIG pulse width measured from the pin (0.8 V / 2.0 V thresholds): 0.5 ms → 0°, 2.5 ms → 180°, pulses of 0.3–3 ms accepted',
        'position loop: proportional drive (full outside ±6°, 0.45° dead band) of a motor + gear train model — 0.1 s/60° at 4.8 V, speed and torque scale with VCC',
        'VCC draws 6 mA plus the motor current (≈ 0.7 A when stalled at 4.8 V): a moving servo loads the 5 V rail',
        'mechanical end stops at −3° / 183°; runtime load torque at the horn',
      ],
      limits: [
        'without pulses the last position is held (actively, like a servo receiving a steady signal) — a real SG90 stops driving and only gear friction holds it',
        'the control loop is idealized (no pulse-to-pulse jitter, no overshoot from the real IC)',
        'no thermal model; supply below 3 V switches the electronics off',
      ],
    },
    pinInfo: [
      { pin: 'GND', label: 'brown', kind: 'ground' },
      { pin: 'VCC', label: 'red', kind: 'power', note: '4.8–6 V; up to ≈ 0.7 A while stalled — not from the Blue Pill 3.3 V pin.' },
      { pin: 'SIG', label: 'orange', kind: 'input', functions: ['PWM'], note: 'Pulse 0.5–2.5 ms every ≈ 20 ms (50 Hz); 3.3 V logic is fine.' },
    ],
    meta: {
      partNumber: 'SG90',
      manufacturer: 'TowerPro',
      sizeMm: [22.2, 11.8, 31],
      tags: ['servo', 'sg90', 'micro servo', 'rc servo', 'pwm', '9g', 'hobby servo'],
      specs: [
        '4.8–6 V, 0.1 s/60° at 4.8 V',
        'stall torque 1.8 kgf·cm (≈ 0.18 N·m)',
        '0–180° for 0.5–2.5 ms pulses at 50 Hz',
        'dead band 5 µs, 9 g',
      ],
    },
    doc: 'TowerPro SG90 micro servo, off-board, terminals "ID:GND" (brown), "ID:VCC" (red, 4.8–6 V from the 5 V supply — it draws up to ~0.7 A), "ID:SIG" (orange). Send a 0.5–2.5 ms HIGH pulse every ~20 ms (e.g. timer PWM at 50 Hz): 0.5 ms = 0°, 1.5 ms = 90°, 2.5 ms = 180°. Share GND between the servo supply and the MCU.',
  },

  // ======================================================== 28BYJ-48
  {
    type: 'stepper_28byj48',
    label: '28BYJ-48 stepper motor (5 V)',
    category: 'motor',
    placement: 'offboard',
    // five leads 1 apart under the can; the rect reaches back over the output shaft boss
    offboard: { terminalPitch: 1, rect: { w: 6.5, d: 5.75 } },
    pins: ['ORANGE', 'YELLOW', 'PINK', 'BLUE', 'RED'],
    params: [
      { key: 'loadTorque', label: 'Load torque', kind: 'number', default: 0, min: 0, max: 5, step: 0.1, unit: 'N·cm', runtime: true },
    ],
    sim: PART_CHIP,
    subcircuit: [{ id: 'M', model: 'motor_28byj48', pins: ['RED', 'ORANGE', 'YELLOW', 'PINK', 'BLUE'] }],
    visual: { shape: 'stepper_28byj48' },
    support: {
      level: 'full',
      simulated: [
        'four half-windings (50 Ω, 25 mH) from RED to each lead, each with its back-EMF',
        'permanent-magnet rotor, 32 full steps per motor turn, torque from the pole currents (ORANGE−PINK, YELLOW−BLUE) + detent',
        '64:1 gear train: 2048 full steps (4096 half steps) per output turn; load torque at the output shaft',
        'a wrong energizing sequence makes the rotor jitter back and forth or stand still, too fast stepping loses steps',
      ],
      limits: [
        'the two halves of a pole are not magnetically coupled in the model',
        'gear ratio exactly 64:1 (the real train is ≈ 63.68:1), no gear backlash',
      ],
    },
    pinInfo: [
      { pin: 'ORANGE', label: 'orange', kind: 'passive', note: 'Pole A (+).' },
      { pin: 'YELLOW', label: 'yellow', kind: 'passive', note: 'Pole B (+).' },
      { pin: 'PINK', label: 'pink', kind: 'passive', note: 'Pole A (−).' },
      { pin: 'BLUE', label: 'blue', kind: 'passive', note: 'Pole B (−).' },
      { pin: 'RED', label: 'red', kind: 'power', note: 'Common of all four half-windings: +5 V.' },
    ],
    meta: {
      partNumber: '28BYJ-48 (5 V)',
      manufacturer: 'Kiatronics / generic',
      sizeMm: [42, 28, 19],
      tags: ['stepper', 'stepper motor', '28byj-48', '28byj48', 'unipolar', 'geared', 'uln2003'],
      specs: [
        '5 V unipolar, 4 phases, 50 Ω per phase',
        '5.625°/64 stride angle: 4096 half steps per output turn',
        '64:1 reduction, pull-in torque ≥ 34.3 mN·m',
        'drive with a ULN2003 board',
      ],
    },
    doc: '28BYJ-48 5 V geared unipolar stepper, off-board, leads "ID:ORANGE", "ID:YELLOW", "ID:PINK", "ID:BLUE" and the common "ID:RED" (+5 V). Drive the four leads with low-side switches (ULN2003 board OUT1–OUT4 = ORANGE, YELLOW, PINK, BLUE). Clockwise sequence: ORANGE, YELLOW, PINK, BLUE (half step: O, O+Y, Y, Y+P, P, P+B, B, B+O); 4096 half steps per output turn; ≈ 1–2 ms per half step.',
  },

  // ======================================================== NEMA 17
  {
    type: 'nema17_stepper',
    label: 'NEMA 17 stepper motor (1.7 A)',
    category: 'motor',
    placement: 'offboard',
    // four leads 1.25 apart in front of the motor; the rect covers the whole can
    offboard: { terminalPitch: 1.25, rect: { w: 6.5, d: 5 } },
    // 17HS4401 lead colors: black A+, green A−, red B+, blue B−
    pins: ['A+', 'A-', 'B+', 'B-'],
    params: [
      { key: 'loadTorque', label: 'Load torque', kind: 'number', default: 0, min: 0, max: 50, step: 0.5, unit: 'N·cm', runtime: true },
    ],
    sim: PART_CHIP,
    subcircuit: [{ id: 'M', model: 'motor_nema17', pins: ['A+', 'A-', 'B+', 'B-'] }],
    visual: { shape: 'stepper_nema17' },
    ratings: { iMax: 1.7 },
    support: {
      level: 'full',
      simulated: [
        'two windings 1.5 Ω / 2.8 mH with back-EMF (Ke = Kt = 0.166 V·s/rad)',
        'hybrid rotor with 50 teeth (200 full steps per turn): torque from both phase currents + 0.022 N·m detent, 54 g·cm² inertia, friction and runtime load',
        'microstepping follows the driver currents; too fast stepping, resonance or too little current lose steps',
      ],
      limits: ['no magnetic saturation (torque stays linear in current above the rating)', 'no thermal model'],
    },
    pinInfo: [
      { pin: 'A+', label: 'black', kind: 'passive', note: 'Coil A.' },
      { pin: 'A-', label: 'green', kind: 'passive', note: 'Coil A.' },
      { pin: 'B+', label: 'red', kind: 'passive', note: 'Coil B.' },
      { pin: 'B-', label: 'blue', kind: 'passive', note: 'Coil B.' },
    ],
    meta: {
      partNumber: '17HS4401',
      manufacturer: 'generic NEMA 17',
      sizeMm: [42.3, 42.3, 40],
      tags: ['stepper', 'stepper motor', 'nema17', 'nema 17', 'bipolar', '17hs4401', '1.8 degree', 'a4988', 'drv8825', 'tmc2209'],
      specs: ['bipolar, 1.8°/step (200 steps/turn)', '1.7 A, 1.5 Ω, 2.8 mH per phase', 'holding torque 0.40 N·m', 'drive with A4988 / DRV8825 / TMC2209 / L298N'],
    },
    doc: 'NEMA 17 bipolar stepper (1.8°, 1.7 A, 1.5 Ω), off-board terminals "ID:A+", "ID:A-" (coil A) and "ID:B+", "ID:B-" (coil B). Connect coil A to 1A/1B (A4988), A1/A2 (DRV8825), M1A/M1B (TMC2209) or OUT1/OUT2 (L298N), coil B to the other pair. 200 full steps per turn; set the driver current limit (Vref) to the motor rating or below.',
  },

  // ======================================================== ULN2003 board
  {
    type: 'uln2003_board',
    label: 'ULN2003 stepper driver board',
    category: 'motor',
    placement: 'offboard',
    // ten Dupont tips 0.6 apart in front of the board (IN1–IN4, −, +, OUT1–OUT4);
    // the rect holds the board, its leads and the tip row, 7 deep (1.5 default-shelf slots)
    offboard: { terminalPitch: 0.6, rect: { w: 8, d: 7 } },
    pins: ['IN1', 'IN2', 'IN3', 'IN4', 'GND', 'VCC', 'OUT1', 'OUT2', 'OUT3', 'OUT4'],
    sim: PART_CHIP,
    subcircuit: [...ulnChannel(1, 'A'), ...ulnChannel(2, 'B'), ...ulnChannel(3, 'C'), ...ulnChannel(4, 'D')],
    visual: { shape: 'uln2003_board' },
    strictNewton: true,
    supplyPins: { plus: ['VCC'], minus: ['GND'] },
    ratings: { vddMin: 5, vddMax: 12, iMax: 0.5 },
    support: {
      level: 'full',
      simulated: [
        'each channel is the ULN2003A Darlington pair from the datasheet schematic (2.7 kΩ input, 7.2 kΩ / 3 kΩ base resistors, two Ebers-Moll transistors) — ≈ 0.9–1 V saturation at 100–200 mA; works from 3.3 V inputs',
        'clamp diodes from every output to VCC (the motor common) absorb the winding kick',
        'indicator LEDs A–D (1 kΩ from VCC to each output) light while the channel sinks',
      ],
      limits: [
        'the transistors use the generic small-signal model (no 500 mA current limit, no thermal limit — the ERC flags > 0.5 A)',
        'clamp diodes modeled as ordinary silicon diodes (≈ 0.8 V; the ULN2003A specifies 1.7 V at 350 mA)',
        'the power jumper is always fitted; the motor connector is the four OUT terminals plus VCC',
      ],
    },
    pinInfo: [
      { pin: 'IN1', kind: 'input', note: 'Channel 1 (LED A): high = OUT1 sinks.' },
      { pin: 'IN2', kind: 'input', note: 'Channel 2 (LED B).' },
      { pin: 'IN3', kind: 'input', note: 'Channel 3 (LED C).' },
      { pin: 'IN4', kind: 'input', note: 'Channel 4 (LED D).' },
      { pin: 'GND', label: '−', kind: 'ground' },
      { pin: 'VCC', label: '+', kind: 'power', note: '5–12 V motor supply; also the motor common (RED) and the clamp-diode COM.' },
      { pin: 'OUT1', kind: 'output', note: 'Open collector, to the motor ORANGE lead.' },
      { pin: 'OUT2', kind: 'output', note: 'To YELLOW.' },
      { pin: 'OUT3', kind: 'output', note: 'To PINK.' },
      { pin: 'OUT4', kind: 'output', note: 'To BLUE.' },
    ],
    meta: {
      partNumber: 'ULN2003A board',
      manufacturer: 'generic',
      sizeMm: [35, 32, 15],
      tags: ['uln2003', 'uln2003a', 'darlington', 'stepper driver', '28byj-48', 'relay driver', 'low side'],
      specs: ['ULN2003A: 7 Darlington sinks, 500 mA each, 50 V', '4 channels used, LEDs A–D', '5–12 V supply', '3.3 V / 5 V logic inputs'],
    },
    doc: 'ULN2003 stepper driver board (off-board): inputs "ID:IN1".."ID:IN4" from MCU pins, power "ID:VCC" (+5 V for the 28BYJ-48) and "ID:GND" (common with the MCU). Outputs "ID:OUT1".."ID:OUT4" sink current when the matching input is high — wire them to the 28BYJ-48 ORANGE, YELLOW, PINK, BLUE leads and the motor RED to VCC. LEDs A–D show the active channels.',
  },

  // ======================================================== L298N module
  {
    type: 'l298n_module',
    label: 'L298N dual H-bridge module',
    category: 'motor',
    placement: 'offboard',
    // thirteen tips 0.6 apart along the front; terminal 0 at 2.5 so the OUT1/OUT2
    // leads leaving the left screw terminal stay inside the rect (7 deep: 1.5 default-shelf slots)
    offboard: { terminalPitch: 0.6, terminalOffset: { x: 2.5, z: 2 }, rect: { w: 10.25, d: 7 } },
    pins: ['OUT1', 'OUT2', '+12V', 'GND', '+5V', 'ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB', 'OUT3', 'OUT4'],
    params: [
      { key: 'jumper5v', label: '5V-EN regulator jumper', kind: 'boolean', default: true, runtime: true },
      { key: 'jumperEnA', label: 'ENA jumper (to +5V)', kind: 'boolean', default: true, runtime: true },
      { key: 'jumperEnB', label: 'ENB jumper (to +5V)', kind: 'boolean', default: true, runtime: true },
    ],
    sim: PART_CHIP,
    subcircuit: [
      {
        id: 'U1',
        model: 'drv_l298n',
        pins: ['OUT1', 'OUT2', '+12V', 'GND', '+5V', 'ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB', 'OUT3', 'OUT4', '@reg_in'],
      },
      // eight 1N4007 ("M7") flyback diodes: each output to +12V and from GND
      { id: 'D1', model: 'diode', pins: ['OUT1', '+12V'] },
      { id: 'D2', model: 'diode', pins: ['GND', 'OUT1'] },
      { id: 'D3', model: 'diode', pins: ['OUT2', '+12V'] },
      { id: 'D4', model: 'diode', pins: ['GND', 'OUT2'] },
      { id: 'D5', model: 'diode', pins: ['OUT3', '+12V'] },
      { id: 'D6', model: 'diode', pins: ['GND', 'OUT3'] },
      { id: 'D7', model: 'diode', pins: ['OUT4', '+12V'] },
      { id: 'D8', model: 'diode', pins: ['GND', 'OUT4'] },
      // 78M05 behind the 5V-EN jumper (dropout ≈ 2 V, 500 mA)
      { id: 'REG', model: 'ldo', pins: ['@reg_in', '+5V', 'GND'], params: { vout: 5, dropout: 2, rout: 0.1, ilimit: 0.5 } },
      { id: 'LED_PWR', model: 'led', pins: ['+5V', '@led_k'], params: { color: 'red' } },
      { id: 'R_LED', model: 'resistor', pins: ['@led_k', 'GND'], params: { resistance: 1000 } },
    ],
    visual: { shape: 'l298n_module' },
    strictNewton: true,
    supplyPins: { plus: ['+12V', '+5V'], minus: ['GND'] },
    ratings: { iMax: 2 },
    support: {
      level: 'full',
      simulated: [
        'L298 bridges as Darlington switches with the datasheet saturation voltages (≈ 2 V total drop at 0.5 A, 2.55 V at 1 A): the motor gets VS minus the drop',
        'ENx & INx truth table read from the pins (VIL 1.5 V / VIH 2.3 V: 3.3 V logic works); EN low = both outputs off, the current freewheels through the eight flyback diodes (fast decay)',
        '5V-EN jumper → on-board 78M05 regulator (needs VS ≥ 7 V) feeding the logic and the +5V terminal; ENA / ENB jumpers tie the enables to +5V (remove them for PWM)',
        'power LED, quiescent currents; warnings: no logic supply, VS > 12 V with the regulator jumper, > 2 A per channel, an EN pin driven against its jumper',
      ],
      limits: [
        'no thermal model (the L298 has no over-current protection — it would overheat)',
        'switching delays (≈ 1–2 µs) are not modeled; the two 220 µF bulk capacitors are not modeled',
      ],
    },
    pinInfo: [
      { pin: 'OUT1', kind: 'output', note: 'Motor A terminal (screw terminal, left).' },
      { pin: 'OUT2', kind: 'output', note: 'Motor A terminal.' },
      { pin: '+12V', label: '12V', kind: 'power', note: 'Motor supply VS, 5–35 V (≤ 12 V with the 5V-EN jumper fitted).' },
      { pin: 'GND', kind: 'ground', note: 'Common ground with the MCU.' },
      { pin: '+5V', label: '5V', kind: 'power', note: 'Regulator output with the 5V-EN jumper; logic supply input without it.' },
      { pin: 'ENA', kind: 'input', functions: ['PWM'], note: 'Enable bridge A (jumper to +5V fitted by default — remove it to PWM).' },
      { pin: 'IN1', kind: 'input', note: 'Bridge A, OUT1 high/low.' },
      { pin: 'IN2', kind: 'input', note: 'Bridge A, OUT2 high/low.' },
      { pin: 'IN3', kind: 'input', note: 'Bridge B, OUT3 high/low.' },
      { pin: 'IN4', kind: 'input', note: 'Bridge B, OUT4 high/low.' },
      { pin: 'ENB', kind: 'input', functions: ['PWM'], note: 'Enable bridge B (jumper to +5V fitted by default).' },
      { pin: 'OUT3', kind: 'output', note: 'Motor B terminal (screw terminal, right).' },
      { pin: 'OUT4', kind: 'output', note: 'Motor B terminal.' },
    ],
    meta: {
      partNumber: 'L298N module (HW-095)',
      manufacturer: 'STMicroelectronics (L298) / generic board',
      sizeMm: [43, 43, 27],
      tags: ['l298n', 'l298', 'h-bridge', 'motor driver', 'dual motor', 'dc motor', 'stepper', 'hw-095'],
      specs: ['dual full bridge, 2 A per channel, VS up to 35 V (L298: 46 V)', 'bipolar Darlington outputs: ≈ 2–3 V drop', 'on-board 78M05 5 V regulator (jumper), 8 flyback diodes', 'logic inputs 3.3 V / 5 V compatible'],
    },
    doc: 'L298N dual H-bridge module (off-board, 13 terminals). Power: "ID:+12V" = motor supply (7–12 V keeps the 5V-EN regulator jumper usable), "ID:GND" common with the MCU, "ID:+5V" = 5 V out (jumper fitted) or logic supply in. Motor A on OUT1/OUT2, motor B on OUT3/OUT4. Bridge A: ENA high enables, IN1/IN2 = 1/0 forward, 0/1 reverse, equal = brake; ENA low = coast. The ENA/ENB jumpers tie the enables to +5V — set param jumperEnA=false to drive ENA with PWM for speed control. Expect ≈ 2 V less than VS at the motor.',
  },

  // ======================================================== TB6612FNG
  {
    type: 'tb6612fng_module',
    label: 'TB6612FNG dual motor driver',
    category: 'motor',
    placement: 'footprint',
    // SparkFun TB6612FNG breakout: one header VM VCC GND AO1 AO2 BO2 BO1 GND,
    // the other PWMA AIN2 AIN1 STBY BIN1 BIN2 PWMB GND
    pins: ['VM', 'VCC', 'GND', 'AO1', 'AO2', 'BO2', 'BO1', 'GND2', 'PWMA', 'AIN2', 'AIN1', 'STBY', 'BIN1', 'BIN2', 'PWMB', 'GND3'],
    footprintOffsets: twoRows(8, 'h', 'c'),
    internalBridges: [
      ['GND', 'GND2'],
      ['GND2', 'GND3'],
    ],
    bodyFootprint: { dCols: [0, 7], rows: ['c', 'd', 'e', 'f', 'g', 'h'] },
    allowedRotations: [0, 180],
    // 2.5 mm header plastic + 1.6 mm PCB + the 1.5 mm SSOP-24
    obstacleHeight: 2.3,
    sim: PART_CHIP,
    subcircuit: [
      {
        id: 'U1',
        model: 'drv_tb6612',
        pins: ['VM', 'VCC', 'GND', 'AO1', 'AO2', 'BO1', 'BO2', 'PWMA', 'AIN1', 'AIN2', 'STBY', 'BIN1', 'BIN2', 'PWMB'],
      },
    ],
    visual: { shape: 'tb6612_module' },
    strictNewton: true,
    supplyPins: { plus: ['VM', 'VCC'], minus: ['GND'] },
    ratings: { iMax: 1.2 },
    support: {
      level: 'full',
      simulated: [
        'MOSFET bridges, 0.5 Ω upper + lower on-resistance, body diodes',
        'truth table per channel: IN1/IN2/PWM → CW, CCW, short brake, stop; STBY low = standby (all off); inputs 0.3/0.7·VCC with 200 kΩ pull-downs',
        'PWM on PWMx alternates drive and short brake (slow decay): motor voltage ≈ duty · VM',
        'warnings: VM > 15 V, VCC > 6 V, VM without VCC, > 3.2 A per channel',
      ],
      limits: ['no thermal shutdown or under-voltage hysteresis details', 'switching delays and dead time not modeled'],
    },
    pinInfo: [
      { pin: 'VM', kind: 'power', note: 'Motor supply 2.5–13.5 V (15 V max).' },
      { pin: 'VCC', kind: 'power', note: 'Logic supply 2.7–5.5 V.' },
      { pin: 'GND', kind: 'ground' },
      { pin: 'AO1', label: 'A01', kind: 'output', note: 'Motor A.' },
      { pin: 'AO2', label: 'A02', kind: 'output', note: 'Motor A.' },
      { pin: 'BO2', label: 'B02', kind: 'output', note: 'Motor B.' },
      { pin: 'BO1', label: 'B01', kind: 'output', note: 'Motor B.' },
      { pin: 'GND2', label: 'GND', kind: 'ground' },
      { pin: 'PWMA', kind: 'input', functions: ['PWM'], note: 'Speed of motor A (high = drive, low = short brake).' },
      { pin: 'AIN2', kind: 'input' },
      { pin: 'AIN1', kind: 'input' },
      { pin: 'STBY', kind: 'input', note: 'High = run, low = standby (internal pull-down: must be driven high).' },
      { pin: 'BIN1', kind: 'input' },
      { pin: 'BIN2', kind: 'input' },
      { pin: 'PWMB', kind: 'input', functions: ['PWM'] },
      { pin: 'GND3', label: 'GND', kind: 'ground' },
    ],
    meta: {
      partNumber: 'TB6612FNG (SparkFun ROB-14451 breakout)',
      manufacturer: 'Toshiba / SparkFun',
      sizeMm: [20.3, 20.3, 4],
      tags: ['tb6612', 'tb6612fng', 'h-bridge', 'motor driver', 'dual motor', 'mosfet', 'dc motor'],
      specs: ['dual MOSFET H-bridge, 1.2 A avg / 3.2 A peak per channel', 'VM 2.5–13.5 V, VCC 2.7–5.5 V', 'CW / CCW / short brake / stop, standby', 'PWM up to 100 kHz'],
    },
    doc: 'TB6612FNG dual motor driver breakout straddling the channel (rows h and c, `at` = VM in row h; rotations 0/180). Row h: VM VCC GND AO1 AO2 BO2 BO1 GND; row c: PWMA AIN2 AIN1 STBY BIN1 BIN2 PWMB GND. VM = motor supply, VCC = 3.3 V logic, STBY must be high. Motor A on AO1/AO2: AIN1=1 AIN2=0 → CW, 0/1 → CCW, PWMA = speed (PWM, low = brake).',
  },

  // ======================================================== DRV8833
  {
    type: 'drv8833_module',
    label: 'DRV8833 dual motor driver',
    category: 'motor',
    placement: 'footprint',
    pins: ['SLP', 'AIN1', 'AIN2', 'BIN1', 'BIN2', 'FLT', 'VM', 'GND', 'AOUT1', 'AOUT2', 'BOUT2', 'BOUT1'],
    footprintOffsets: twoRows(6, 'g', 'd'),
    bodyFootprint: { dCols: [0, 5], rows: ['d', 'e', 'f', 'g'] },
    allowedRotations: [0, 180],
    obstacleHeight: 2.2,
    sim: PART_CHIP,
    subcircuit: [
      { id: 'U1', model: 'drv_drv8833', pins: ['SLP', 'AIN1', 'AIN2', 'BIN1', 'BIN2', 'FLT', 'VM', 'GND', 'AOUT1', 'AOUT2', 'BOUT2', 'BOUT1'] },
    ],
    visual: { shape: 'drv8833_module' },
    strictNewton: true,
    supplyPins: { plus: ['VM'], minus: ['GND'] },
    ratings: { vddMin: 2.7, vddMax: 10.8, iMax: 1.5 },
    support: {
      level: 'full',
      simulated: [
        'MOSFET bridges (200 mΩ high + 160 mΩ low side) with body diodes',
        'xIN1/xIN2: 00 coast (fast decay through the body diodes), 10 forward, 01 reverse, 11 brake (slow decay) — PWM one input for fast decay, PWM the other high for slow decay',
        'SLP (nSLEEP) low = sleep, 1 ms start-up after it rises; VM undervoltage lockout 2.6 V; inputs VIL 0.7 V / VIH 2 V with pull-downs',
        'over-current protection: > 3.3 A for 4 µs disables the bridge and pulls FLT low for 1.35 ms, then retries',
      ],
      limits: ['xISEN tied to GND on this board: no current regulation', 'no thermal shutdown'],
    },
    pinInfo: [
      { pin: 'SLP', label: 'SLP', kind: 'input', note: 'nSLEEP: must be high to run (500 kΩ internal pull-down).' },
      { pin: 'AIN1', kind: 'input', functions: ['PWM'] },
      { pin: 'AIN2', kind: 'input', functions: ['PWM'] },
      { pin: 'BIN1', kind: 'input', functions: ['PWM'] },
      { pin: 'BIN2', kind: 'input', functions: ['PWM'] },
      { pin: 'FLT', kind: 'output', note: 'nFAULT, open drain: add a pull-up to read it.' },
      { pin: 'VM', kind: 'power', note: '2.7–10.8 V motor supply (also powers the logic).' },
      { pin: 'GND', kind: 'ground' },
      { pin: 'AOUT1', kind: 'output' },
      { pin: 'AOUT2', kind: 'output' },
      { pin: 'BOUT2', kind: 'output' },
      { pin: 'BOUT1', kind: 'output' },
    ],
    meta: {
      partNumber: 'DRV8833 breakout',
      manufacturer: 'Texas Instruments / generic board',
      sizeMm: [15.2, 12.7, 4],
      tags: ['drv8833', 'h-bridge', 'motor driver', 'dual motor', 'mosfet', 'low voltage', 'dc motor', 'stepper'],
      specs: ['dual MOSFET H-bridge, 1.5 A RMS / 2 A peak per bridge', 'VM 2.7–10.8 V, no separate logic supply', 'coast / brake, fast or slow decay PWM', 'sleep, UVLO, over-current protection'],
    },
    doc: 'DRV8833 dual H-bridge breakout straddling the channel (rows g and d, `at` = SLP in row g; rotations 0/180). Row g: SLP AIN1 AIN2 BIN1 BIN2 FLT; row d: VM GND AOUT1 AOUT2 BOUT2 BOUT1 (breakouts from other vendors order their headers differently — follow the labels). VM 2.7–10.8 V. SLP must be high. Motor A on AOUT1/AOUT2: AIN1=1 AIN2=0 forward, 0/1 reverse, 1/1 brake, 0/0 coast.',
  },

  // ======================================================== A4988
  {
    type: 'a4988_driver',
    label: 'A4988 stepper driver (StepStick)',
    category: 'motor',
    placement: 'footprint',
    pins: ['EN', 'MS1', 'MS2', 'MS3', 'RST', 'SLP', 'STEP', 'DIR', 'VMOT', 'GND_MOT', '2B', '2A', '1A', '1B', 'VDD', 'GND'],
    footprintOffsets: twoRows(8, 'g', 'd'),
    internalBridges: [['GND_MOT', 'GND']],
    bodyFootprint: { dCols: [0, 7], rows: ['d', 'e', 'f', 'g'] },
    allowedRotations: [0, 180],
    obstacleHeight: 2.3,
    params: [{ key: 'vref', label: 'Current limit Vref', kind: 'number', default: 0.5, min: 0, max: 2, step: 0.01, unit: 'V', runtime: true }],
    sim: PART_CHIP,
    subcircuit: [
      { id: 'U1', model: 'drv_a4988', pins: ['EN', 'MS1', 'MS2', 'MS3', 'RST', 'SLP', 'STEP', 'DIR', 'VMOT', 'GND', '2B', '2A', '1A', '1B', 'VDD'] },
      // carrier pull-up on SLEEP (RESET floats — tie it to SLP)
      { id: 'R_SLP', model: 'resistor', pins: ['SLP', 'VDD'], params: { resistance: 10000 } },
    ],
    visual: { shape: 'stepstick', color: 'a4988' },
    strictNewton: true,
    supplyPins: { plus: ['VMOT', 'VDD'], minus: ['GND'] },
    ratings: { iMax: 2 },
    support: {
      level: 'full',
      simulated: [
        'translator: STEP rising edge advances one microstep in the DIR direction; MS1–MS3 full / ½ / ¼ / ⅛ / 1/16 (datasheet Table 1), sampled at the edge, home at 45°',
        'winding currents follow the datasheet sine table, full scale I = Vref / (8 × 0.068 Ω)',
        'current chopper cycle-averaged: the winding current follows the target while the bridge (0.64 Ω path, body diodes) has the voltage — at high step rates L, R and back-EMF limit it; slow decay (+VMOT/31 from the 1 µs minimum on-time) on rising steps, mixed decay (31.25 % fast of the 30 µs off-time) on falling steps',
        'ENABLE (outputs off, translator keeps counting), RESET (home, outputs off), SLEEP (1 ms wake-up), VDD 2.8 V and VMOT 8 V undervoltage lockout',
        'inputs 0.3 / 0.7·VDD (a 3.3 V MCU needs VDD = 3.3 V); MS1/MS3 100 kΩ, MS2 50 kΩ pull-downs, 10 kΩ SLEEP pull-up on the carrier; warnings for short STEP pulses, DIR setup and an undefined STEP level',
      ],
      limits: [
        'the ≈ 30 kHz chopping is averaged: no current ripple, the outputs show the average voltage (centred on VMOT/2) instead of PWM edges',
        'over-current / short-to-ground protection and the thermal shutdown are not modeled',
        'RESET has no pull resistor: left open it reads low and holds the driver in reset (as on the real carrier — tie RST to SLP)',
      ],
    },
    pinInfo: [
      { pin: 'EN', kind: 'input', note: 'ENABLE, active low (open = enabled).' },
      { pin: 'MS1', kind: 'input', note: 'Microstep select (100 kΩ pull-down).' },
      { pin: 'MS2', kind: 'input', note: 'Microstep select (50 kΩ pull-down).' },
      { pin: 'MS3', kind: 'input', note: 'Microstep select (100 kΩ pull-down).' },
      { pin: 'RST', kind: 'input', note: 'RESET, active low, floating: tie to SLP.' },
      { pin: 'SLP', kind: 'input', note: 'SLEEP, active low (10 kΩ pull-up to VDD on the carrier).' },
      ...STEP_DIR_INFO,
      { pin: 'VMOT', kind: 'power', note: 'Motor supply 8–35 V (add a 100 µF capacitor).' },
      { pin: 'GND_MOT', label: 'GND', kind: 'ground' },
      { pin: '2B', kind: 'output', note: 'Coil 2.' },
      { pin: '2A', kind: 'output', note: 'Coil 2.' },
      { pin: '1A', kind: 'output', note: 'Coil 1.' },
      { pin: '1B', kind: 'output', note: 'Coil 1.' },
      { pin: 'VDD', kind: 'power', note: 'Logic supply 3–5.5 V — use 3.3 V with a 3.3 V MCU.' },
      { pin: 'GND', kind: 'ground' },
    ],
    meta: {
      partNumber: 'A4988 (Pololu #1182-style carrier)',
      manufacturer: 'Allegro / Pololu / generic',
      sizeMm: [20.3, 15.2, 4],
      tags: ['a4988', 'stepper driver', 'stepstick', 'pololu', 'step dir', 'microstepping', 'nema17', '3d printer'],
      specs: ['bipolar stepper driver, up to 2 A per coil (≈ 1 A without cooling)', 'VMOT 8–35 V, VDD 3–5.5 V', 'full to 1/16 microstepping', 'current limit I = Vref / 0.544 Ω (RS = 0.068 Ω)'],
    },
    doc: 'A4988 StepStick carrier straddling the channel (rows g and d, `at` = EN in row g; rotations 0/180). Row g: EN MS1 MS2 MS3 RST SLP STEP DIR; row d: VMOT GND 2B 2A 1A 1B VDD GND. VMOT 8–35 V, VDD = 3.3 V from the MCU board, tie RST to SLP (RESET floats). STEP rising edge = one microstep (≥ 1 µs high), DIR = direction, MS1–MS3 = full/½/¼/⅛/1/16. Motor coil 1 on 1A/1B, coil 2 on 2A/2B. Current limit = Vref/0.544 Ω (runtime param vref).',
  },

  // ======================================================== DRV8825
  {
    type: 'drv8825_driver',
    label: 'DRV8825 stepper driver (StepStick)',
    category: 'motor',
    placement: 'footprint',
    pins: ['EN', 'M0', 'M1', 'M2', 'RST', 'SLP', 'STEP', 'DIR', 'VMOT', 'GND_MOT', 'B2', 'B1', 'A1', 'A2', 'FAULT', 'GND'],
    footprintOffsets: twoRows(8, 'g', 'd'),
    internalBridges: [['GND_MOT', 'GND']],
    bodyFootprint: { dCols: [0, 7], rows: ['d', 'e', 'f', 'g'] },
    allowedRotations: [0, 180],
    obstacleHeight: 2.3,
    params: [{ key: 'vref', label: 'Current limit Vref', kind: 'number', default: 0.5, min: 0, max: 1.6, step: 0.01, unit: 'V', runtime: true }],
    sim: PART_CHIP,
    subcircuit: [
      { id: 'U1', model: 'drv_drv8825', pins: ['EN', 'M0', 'M1', 'M2', 'RST', 'SLP', 'STEP', 'DIR', 'VMOT', 'GND', 'B2', 'B1', 'A1', 'A2', '@nfault'] },
      // carrier: header FAULT —1.5 kΩ— nFAULT —10 kΩ— SLEEP
      { id: 'R_FLT', model: 'resistor', pins: ['FAULT', '@nfault'], params: { resistance: 1500 } },
      { id: 'R_SLP', model: 'resistor', pins: ['@nfault', 'SLP'], params: { resistance: 10000 } },
    ],
    visual: { shape: 'stepstick', color: 'drv8825' },
    strictNewton: true,
    supplyPins: { plus: ['VMOT'], minus: ['GND'] },
    ratings: { iMax: 2.5 },
    support: {
      level: 'full',
      simulated: [
        'indexer: STEP rising edge = one microstep, M0–M2 full … 1/32 (datasheet Table 1), currents from Table 2 in whole percent (full step 71 %), home 45°',
        'full-scale current I = Vref / (5 × 0.1 Ω) = 2·Vref; 30 kHz chopper cycle-averaged (0.5 Ω path, body diodes): slow decay (+0.11·VMOT from the 3.75 µs blanking) on rising steps, mixed decay (fast until 75 % of the cycle) on falling steps',
        'nENBL / nRESET / nSLEEP (≈ 1 ms wake-up) with the datasheet pull-downs; logic powered from VMOT (UVLO 7.8 V); inputs VIL 0.7 V / VIH 2.2 V; carrier FAULT → SLEEP resistors',
      ],
      limits: [
        'the chopping is averaged: no current ripple, the outputs show the average voltage instead of PWM edges',
        'the DECAY pin is not broken out: mixed decay is fixed',
        'over-current protection (nFAULT) and the thermal shutdown are not modeled: FAULT stays released',
      ],
    },
    pinInfo: [
      { pin: 'EN', kind: 'input', note: 'nENBL, active low (100 kΩ pull-down: enabled when open).' },
      { pin: 'M0', kind: 'input', note: 'Mode 0 (100 kΩ pull-down).' },
      { pin: 'M1', kind: 'input', note: 'Mode 1.' },
      { pin: 'M2', kind: 'input', note: 'Mode 2.' },
      { pin: 'RST', kind: 'input', note: 'nRESET (100 kΩ pull-down!): drive or tie high.' },
      { pin: 'SLP', kind: 'input', note: 'nSLEEP (1 MΩ pull-down): drive high, or tie FAULT to 3.3 V to pull it up.' },
      ...STEP_DIR_INFO,
      { pin: 'VMOT', kind: 'power', note: 'Motor supply 8.2–45 V (also powers the logic).' },
      { pin: 'GND_MOT', label: 'GND', kind: 'ground' },
      { pin: 'B2', kind: 'output', note: 'Coil B.' },
      { pin: 'B1', kind: 'output', note: 'Coil B.' },
      { pin: 'A1', kind: 'output', note: 'Coil A.' },
      { pin: 'A2', kind: 'output', note: 'Coil A.' },
      { pin: 'FAULT', kind: 'output', note: 'nFAULT through 1.5 kΩ (10 kΩ on to SLEEP).' },
      { pin: 'GND', kind: 'ground' },
    ],
    meta: {
      partNumber: 'DRV8825 (Pololu #2133-style carrier)',
      manufacturer: 'Texas Instruments / Pololu / generic',
      sizeMm: [20.3, 15.2, 4],
      tags: ['drv8825', 'stepper driver', 'stepstick', 'pololu', 'step dir', 'microstepping', '1/32', 'nema17'],
      specs: ['bipolar stepper driver, 2.2 A per coil with cooling', 'VMOT 8.2–45 V, 3.3 / 5 V logic, no VDD pin', 'full to 1/32 microstepping', 'current limit I = 2·Vref (RS = 0.1 Ω)'],
    },
    doc: 'DRV8825 StepStick carrier straddling the channel (rows g and d, `at` = EN in row g; rotations 0/180). Row g: EN M0 M1 M2 RST SLP STEP DIR; row d: VMOT GND B2 B1 A1 A2 FAULT GND. Drive RST and SLP high (both have pull-downs). STEP rising edge = one microstep (≥ 1.9 µs high), M0–M2 = full…1/32. Coil A on A1/A2, coil B on B1/B2. Current limit = 2·Vref (param vref).',
  },

  // ======================================================== TMC2209
  {
    type: 'tmc2209_driver',
    label: 'TMC2209 stepper driver (StepStick)',
    category: 'motor',
    placement: 'footprint',
    pins: ['EN', 'MS1', 'MS2', 'SPREAD', 'UART', 'PDN', 'STEP', 'DIR', 'VM', 'GND_MOT', 'M2B', 'M2A', 'M1A', 'M1B', 'VIO', 'GND'],
    footprintOffsets: twoRows(8, 'g', 'd'),
    internalBridges: [['GND_MOT', 'GND']],
    bodyFootprint: { dCols: [0, 7], rows: ['d', 'e', 'f', 'g'] },
    allowedRotations: [0, 180],
    obstacleHeight: 3.2,
    params: [{ key: 'vref', label: 'Current limit Vref', kind: 'number', default: 1.0, min: 0, max: 2.5, step: 0.01, unit: 'V', runtime: true }],
    sim: PART_CHIP,
    subcircuit: [
      {
        id: 'U1',
        model: 'drv_tmc2209',
        pins: ['EN', 'MS1', 'MS2', 'SPREAD', 'UART', 'PDN', 'STEP', 'DIR', 'VM', 'GND', 'M2B', 'M2A', 'M1A', 'M1B', 'VIO'],
      },
      { id: 'R_UART', model: 'resistor', pins: ['UART', 'PDN'], params: { resistance: 1000 } },
    ],
    visual: { shape: 'stepstick', color: 'tmc2209' },
    strictNewton: true,
    supplyPins: { plus: ['VM', 'VIO'], minus: ['GND'] },
    ratings: { iMax: 2 },
    support: {
      level: 'partial',
      simulated: [
        'standalone STEP/DIR: MS2/MS1 = 00 → 1/8, 01 → 1/32, 10 → 1/64, 11 → 1/16, each step interpolated to 1/256 over the last step period (MicroPlyer)',
        'peak current = (Vref / 2.5 V) · 0.325 V / (0.11 Ω + 20 mΩ), sine table, cycle-averaged current regulation (0.45 Ω path, body diodes); EN active low',
        'VIO / VM undervoltage reset',
      ],
      limits: [
        'the UART register interface (PDN_UART) is NOT simulated — activity is logged once; the driver stays in standalone mode',
        'StealthChop (voltage-mode PWM) and SpreadCycle are both modeled as the same current chopper: no StealthChop silence or autotuning, no StallGuard / CoolStep',
        'no automatic standstill current reduction, no short / over-temperature protection, no DIAG / INDEX outputs (not on the header)',
      ],
    },
    pinInfo: [
      { pin: 'EN', kind: 'input', note: 'Enable, active low (GND = on).' },
      { pin: 'MS1', kind: 'input', note: 'Microstep select / UART address bit 0 (pull-down).' },
      { pin: 'MS2', kind: 'input', note: 'Microstep select / UART address bit 1 (pull-down).' },
      { pin: 'SPREAD', kind: 'input', note: 'Low = StealthChop, high = SpreadCycle (pull-down).' },
      { pin: 'UART', kind: 'io', functions: ['UART'], note: 'PDN_UART through 1 kΩ (UART not simulated).' },
      { pin: 'PDN', kind: 'io', note: 'PDN_UART (pull-down).' },
      ...STEP_DIR_INFO,
      { pin: 'VM', kind: 'power', note: 'Motor supply 5.5–28 V.' },
      { pin: 'GND_MOT', label: 'GND', kind: 'ground' },
      { pin: 'M2B', kind: 'output', note: 'Coil 2 (B).' },
      { pin: 'M2A', kind: 'output', note: 'Coil 2 (B).' },
      { pin: 'M1A', kind: 'output', note: 'Coil 1 (A).' },
      { pin: 'M1B', kind: 'output', note: 'Coil 1 (A).' },
      { pin: 'VIO', kind: 'power', note: 'Logic supply 3.3–5 V.' },
      { pin: 'GND', kind: 'ground' },
    ],
    meta: {
      partNumber: 'TMC2209 StepStick (SilentStepStick-compatible)',
      manufacturer: 'Trinamic (ADI) / generic module',
      sizeMm: [20.3, 15.2, 11],
      tags: ['tmc2209', 'stepper driver', 'stepstick', 'silentstepstick', 'trinamic', 'stealthchop', 'step dir', 'uart', '1/256'],
      specs: ['bipolar stepper driver, 2 A RMS (2.8 A peak)', 'VM 4.75–28 V, VIO 3–5 V', '1/8–1/64 steps, interpolated to 1/256', 'StealthChop2 / SpreadCycle, UART configuration'],
    },
    doc: 'TMC2209 StepStick module straddling the channel (rows g and d, `at` = EN in row g; rotations 0/180). Row g: EN MS1 MS2 SPREAD UART PDN STEP DIR; row d: VM GND M2B M2A M1A M1B VIO GND. Standalone mode: EN low enables, MS2/MS1 = 00 1/8, 01 1/32, 10 1/64, 11 1/16 (interpolated to 1/256). Coil A on M1A/M1B, coil B on M2A/M2B. VIO = 3.3 V. The UART configuration is not simulated.',
  },
]
