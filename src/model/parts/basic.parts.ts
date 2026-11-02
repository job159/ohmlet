/**
 * Basic-parts family (component library, product spec §4.2): RGB LED,
 * P-MOSFET, logic-level power MOSFET, zener, linear regulators, batteries,
 * lab current source, relay, optocoupler, crystal, toggle switch, NTC
 * thermistor and the BSS138 bidirectional level shifter.
 *
 * Simulation models live in src/sim/models/basic.model.ts (or are
 * sub-circuits of existing device models); meshes in
 * src/three/meshes/ext/basic.mesh.ts. Support annotations state exactly what
 * those models compute — see tests/parts-basic*.test.ts.
 *
 * Only `import type` from '../catalog' (it imports this module).
 */
import type { CatalogEntry, PinInfo, SubcircuitElement } from '../catalog'

const SWITCH_CONTACT = 'contact = 20 S (50 mΩ) closed / 1 nS open'
const MOS_BODY = 'body diode: Shockley junction Is = 1 pA, n = 1.2 (≈ 0.86 V at 1 A)'
const MOS_LIMITS = [
  'no gate capacitance or gate charge (switches instantly)',
  'no subthreshold conduction, no breakdown, no thermal model',
]

/** BSS138 channel of the level shifter: gate at LV, source on LVn, drain on HVn, 10 kΩ pull-ups both sides. */
function shifterChannel(n: number): SubcircuitElement[] {
  return [
    {
      id: `Q${n}`,
      model: 'nmos_vth',
      pins: [`LV${n}`, 'LV', `HV${n}`],
      // BSS138: VGS(th) 0.8–1.5 V (1.3 V typ); k fitted to ≈ 2 Ω at VGS = 3.3 V
      params: { vth: 1.3, k: 0.25, lambda: 0.01, bodyDiode: true },
    },
    { id: `RL${n}`, model: 'resistor', pins: [`LV${n}`, 'LV'], params: { resistance: 10000 } },
    { id: `RH${n}`, model: 'resistor', pins: [`HV${n}`, 'HV'], params: { resistance: 10000 } },
  ]
}

const SHIFTER_PIN_INFO: PinInfo[] = [
  ...[1, 2].map((n): PinInfo => ({ pin: `LV${n}`, kind: 'io', note: `Low-voltage side of channel ${n} (10 kΩ pull-up to LV).` })),
  { pin: 'LV', kind: 'power', note: 'Low-side supply (e.g. 3.3 V). Also the gate voltage of the four BSS138s.' },
  { pin: 'GND', kind: 'ground', note: 'Common ground (joined to the HV-side GND on the board).' },
  ...[3, 4].map((n): PinInfo => ({ pin: `LV${n}`, kind: 'io', note: `Low-voltage side of channel ${n} (10 kΩ pull-up to LV).` })),
  ...[4, 3].map((n): PinInfo => ({ pin: `HV${n}`, kind: 'io', note: `High-voltage side of channel ${n} (10 kΩ pull-up to HV).` })),
  { pin: 'GND2', label: 'GND', kind: 'ground', note: 'Common ground (joined to the LV-side GND on the board).' },
  { pin: 'HV', kind: 'power', note: 'High-side supply (e.g. 5 V). Must be ≥ LV.' },
  ...[2, 1].map((n): PinInfo => ({ pin: `HV${n}`, kind: 'io', note: `High-voltage side of channel ${n} (10 kΩ pull-up to HV).` })),
]

export const PARTS: CatalogEntry[] = [
  // ------------------------------------------------------- semiconductors
  {
    type: 'rgb_led',
    label: 'RGB LED (5 mm)',
    category: 'semiconductor',
    placement: 'leads',
    // real lead order of a 5 mm 4-lead RGB LED, flat side left: R, common (longest), G, B
    pins: ['R', 'COM', 'G', 'B'],
    params: [
      { key: 'common', label: 'Common lead', kind: 'select', default: 'cathode', options: ['cathode', 'anode'] },
    ],
    sim: { kind: 'device', model: 'rgb_led' },
    visual: { shape: 'rgb_led' },
    // dome apex of the raised package (meshes/ext/basic.mesh.ts RGB_LED_TOP)
    obstacleHeight: 3.05,
    support: {
      level: 'full',
      simulated: [
        'three LED junctions (Shockley, n = 2) to the common lead, fitted to their forward voltage at 10 mA: red 1.95 V, green 3.1 V, blue 3.1 V (≈ 2.0 / 3.2 / 3.2 V at 20 mA)',
        'common cathode or common anode (param)',
        // the app's one brightness scale (src/instruments/led-light.ts): I / the rated 20 mA, like the 5 mm LED
        'brightness = each die’s current / the rated 20 mA (100 % at 20 mA; the inspector shows the brightest die); in 3D each die glows as the eye sees that brightness and the epoxy shows the mixed color',
        // src/sim/devices.ts LED_BURN_CURRENT / LED_BURN_TIME (= the 5 mm LED's gross-overload limit)
        'a die burns out when its current stays above 150 mA (its peak rating) for more than 1 ms (keeps conducting, stops emitting)',
      ],
      limits: [
        'no reverse breakdown',
        'no junction-temperature model (the 5 mm LED has one): a die over its 20 mA rating does not overheat, it only burns above 150 mA',
        'no per-color luminous efficiency: the same current looks equally bright in every color',
      ],
    },
    pinInfo: [
      { pin: 'R', kind: 'passive', note: 'Red die. Common cathode: anode of the red die. Common anode: its cathode.' },
      { pin: 'COM', label: 'COM', kind: 'passive', note: 'Common lead — the longest one. Cathode (−) or anode (+) depending on the variant.' },
      { pin: 'G', kind: 'passive', note: 'Green die (InGaN, ≈ 3.2 V at 20 mA).' },
      { pin: 'B', kind: 'passive', note: 'Blue die (InGaN, ≈ 3.2 V at 20 mA).' },
    ],
    ratings: { ifMax: 0.02 },
    meta: {
      partNumber: '5 mm RGB LED, diffused',
      sizeMm: [5, 5, 8.6],
      tags: ['rgb', 'led', 'color', 'common cathode', 'common anode', 'pwm', 'diffused'],
      specs: [
        'Vf ≈ 2.0 V (R) / 3.2 V (G) / 3.2 V (B) at 20 mA',
        '20 mA continuous per die — one series resistor per color',
        'lead order R · COM · G · B (COM longest)',
      ],
    },
    doc: 'Diffused 5 mm RGB LED, 4 leads in order R, COM, G, B (COM is the longest). Param "common" = cathode (COM to GND, drive R/G/B high) or anode (COM to +, pull R/G/B low). Use one resistor per color (≈150 Ω red, ≈100 Ω green/blue at 5 V); mix colors with PWM.',
  },
  {
    type: 'pmos',
    label: 'P-MOSFET (TO-92)',
    category: 'semiconductor',
    placement: 'leads',
    pins: ['source', 'gate', 'drain'],
    params: [
      { key: 'vth', label: 'Threshold voltage', kind: 'number', default: -2, min: -4, max: -0.5, step: 0.1, unit: 'V' },
    ],
    sim: { kind: 'device', model: 'pmos' },
    visual: { shape: 'to92_pmos' },
    obstacleHeight: 1.85,
    support: {
      level: 'full',
      simulated: [
        'square-law (SPICE level 1) P-MOSFET, the catalog N-MOSFET mirrored: Vth = −2 V (param), k = 0.1 A/V², λ = 0.01 /V',
        'symmetric conduction when drain and source swap',
        MOS_BODY,
      ],
      limits: MOS_LIMITS,
    },
    pinInfo: [
      { pin: 'source', label: 'S', kind: 'passive', note: 'Source — to the positive supply in a high-side switch.' },
      { pin: 'gate', label: 'G', kind: 'control', note: 'Gate: ON when pulled ≥ 2 V below the source. Add a pull-up to the source.' },
      { pin: 'drain', label: 'D', kind: 'passive', note: 'Drain — to the load.' },
    ],
    meta: {
      partNumber: 'generic P-channel MOSFET, TO-92',
      sizeMm: [4.8, 3.8, 4.8],
      tags: ['pmos', 'p-channel', 'mosfet', 'high-side switch', 'fet', 'transistor'],
      specs: ['Vth −2 V (adjustable)', 'S-G-D pin order like the catalog 2N7000 — real TO-92 P-FET pinouts vary'],
    },
    doc: 'Generic small P-channel MOSFET (TO-92), pins source/gate/drain like the N-MOSFET. High-side switch: source to +, drain to the load, gate pulled to the source by a resistor; the FET turns on when the gate is pulled ≥ 2 V below the source (Vth param, default −2 V).',
  },
  {
    type: 'irlz44n',
    label: 'Logic-level N-MOSFET (IRLZ44N)',
    category: 'semiconductor',
    placement: 'leads',
    // IRLZ44N TO-220AB, front view: 1 = gate, 2 = drain (tab), 3 = source
    pins: ['gate', 'drain', 'source'],
    params: [
      { key: 'vth', label: 'Threshold voltage', kind: 'number', default: 1.5, min: 1, max: 2, step: 0.05, unit: 'V' },
    ],
    sim: { kind: 'device', model: 'irlz44n' },
    visual: { shape: 'to220' },
    bodyFootprint: { dCols: [-1, 1], rows: ['f'] },
    obstacleHeight: 6.95, // tab top (TO220_TOP)
    support: {
      level: 'full',
      simulated: [
        'square-law N-MOSFET fitted to the IRLZ44N: Vth = 1.5 V (param, datasheet 1.0–2.0 V), k = 11.4 A/V² → RDS(on) 25 mΩ at VGS = 5 V, 35 mΩ at 4 V',
        MOS_BODY,
        'symmetric conduction when drain and source swap',
      ],
      limits: [...MOS_LIMITS, 'RDS(on) keeps falling above 5 V gate drive (the real part flattens at ≈ 22 mΩ)'],
    },
    pinInfo: [
      { pin: 'gate', label: 'G', kind: 'control', note: 'Gate — logic-level: fully on at 4–5 V. Add ~100 Ω series and a 10 kΩ pull-down.' },
      { pin: 'drain', label: 'D', kind: 'passive', note: 'Drain (also the metal tab) — to the load.' },
      { pin: 'source', label: 'S', kind: 'passive', note: 'Source — to ground (low-side switch).' },
    ],
    ratings: { iMax: 47, pMax: 2.4 },
    meta: {
      partNumber: 'IRLZ44N',
      manufacturer: 'Infineon (International Rectifier)',
      sizeMm: [10.2, 4.5, 15.9],
      tags: ['mosfet', 'n-channel', 'logic level', 'power', 'low-side switch', 'to-220', 'motor', 'led strip'],
      specs: [
        'VDSS 55 V, ID 47 A (TC = 25 °C)',
        'RDS(on) ≤ 25 mΩ at VGS = 5 V, ≤ 35 mΩ at 4 V',
        'VGS(th) 1.0–2.0 V; ≈ 2.4 W without heatsink (RθJA 62 °C/W)',
      ],
    },
    doc: 'IRLZ44N logic-level power N-MOSFET (TO-220), pins gate/drain/source (front view, left to right). Low-side switch for motors, LED strips, relays: source to GND, drain to the load, gate driven directly by a 3.3–5 V GPIO (with a pull-down). The wide body overhangs one column beside each outer lead.',
  },
  {
    type: 'zener',
    label: 'Zener diode (BZX55)',
    category: 'semiconductor',
    placement: 'leads',
    pins: ['anode', 'cathode'],
    params: [
      {
        key: 'vz',
        label: 'Zener voltage',
        kind: 'select',
        default: '5.1',
        options: ['2.7', '3.3', '3.9', '4.7', '5.1', '5.6', '6.2', '8.2', '9.1', '12', '15'],
        unit: 'V',
      },
    ],
    sim: { kind: 'device', model: 'zener' },
    visual: { shape: 'zener' },
    support: {
      level: 'full',
      simulated: [
        'forward: Shockley junction Is = 1 pA, n = 1.2 (like the catalog diode)',
        'reverse breakdown I = 5 mA·exp((Vr − Vz)/0.1 V): Vz at the 5 mA test current, dynamic resistance 0.1 V / I (20 Ω at 5 mA)',
        'Newton-safe: both junctions are limited between iterations (SPICE pnjlim)',
      ],
      limits: [
        'the same knee softness for every Vz (real low-voltage zeners are softer, high-voltage ones sharper)',
        'no temperature coefficient, no power limit (500 mW rated)',
        'no junction capacitance',
      ],
    },
    pinInfo: [
      { pin: 'anode', label: 'A', kind: 'passive' },
      { pin: 'cathode', label: 'K', kind: 'passive', note: 'Banded end. In a clamp/regulator the cathode goes to the positive side.' },
    ],
    ratings: { pMax: 0.5 },
    meta: {
      partNumber: 'BZX55C5V1',
      manufacturer: 'Vishay / generic',
      sizeMm: [3.5, 1.9, 1.9],
      tags: ['zener', 'diode', 'clamp', 'reference', 'shunt regulator', 'overvoltage'],
      specs: ['Vz 4.8–5.4 V at IZT = 5 mA (5V1)', '500 mW, DO-35 glass'],
    },
    doc: 'Zener diode (BZX55, DO-35), pins anode/cathode (banded end). Reverse-biased (cathode positive) it clamps at Vz (param, default 5.1 V at 5 mA); forward it conducts like a diode (~0.7 V). Always feed it through a series resistor: R = (Vin − Vz) / I.',
  },
  {
    type: 'pc817',
    label: 'Optocoupler (PC817)',
    category: 'semiconductor',
    placement: 'dip',
    pins: ['anode', 'cathode', 'emitter', 'collector'],
    params: [
      { key: 'ctr', label: 'Current transfer ratio', kind: 'number', default: 100, min: 50, max: 600, step: 10, unit: '%' },
    ],
    sim: { kind: 'device', model: 'pc817' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto',
    support: {
      level: 'full',
      simulated: [
        'IR LED: Shockley junction, n = 2, VF = 1.2 V at 20 mA',
        'phototransistor: IC = CTR · IF (param, default 100 %), current-controlled, with Ebers-Moll saturation (VCE(sat) ≈ 0.09 V at IF = 20 mA, IC = 1 mA)',
        'galvanic isolation: no conductance between the LED and transistor sides',
      ],
      limits: [
        'CTR independent of IF and temperature (real CTR peaks around IF = 5–10 mA)',
        'no switching delay (tr ≈ 4 µs, tf ≈ 3 µs) — evaluated per analog step',
        'no LED reverse breakdown (6 V rated)',
      ],
    },
    pinInfo: [
      { pin: 'anode', label: 'A', kind: 'passive', note: 'Pin 1 (dot). IR LED anode — drive through a resistor (5–20 mA).' },
      { pin: 'cathode', label: 'K', kind: 'passive', note: 'Pin 2. IR LED cathode.' },
      { pin: 'emitter', label: 'E', kind: 'passive', note: 'Pin 3. Phototransistor emitter (output-side ground).' },
      { pin: 'collector', label: 'C', kind: 'passive', note: 'Pin 4. Phototransistor collector (pull-up to the output supply).' },
    ],
    ratings: { ifMax: 0.05 },
    meta: {
      partNumber: 'PC817',
      manufacturer: 'Sharp / generic',
      sizeMm: [4.6, 6.5, 3.5],
      tags: ['optocoupler', 'opto', 'isolator', 'photocoupler', 'isolation', 'dip-4'],
      specs: ['CTR 50–600 % at IF = 5 mA (ranks A–D)', 'IF ≤ 50 mA, VCEO 35 V', '5 kV isolation'],
    },
    doc: 'PC817 optocoupler (DIP-4 straddling the channel; `at` = pin 1 anode in row f). LED side: anode/cathode through a resistor (5–20 mA). Transistor side: collector to a pull-up, emitter to that side\'s ground — the output pulls low when the LED is on. The two sides are electrically isolated.',
  },

  // -------------------------------------------------------- regulators
  {
    type: 'lm7805',
    label: '5 V regulator (LM7805)',
    category: 'power',
    placement: 'leads',
    // TO-220 front view: 1 = input, 2 = ground (tab), 3 = output
    pins: ['IN', 'GND', 'OUT'],
    sim: { kind: 'device', model: 'basic_subcircuit' },
    subcircuit: [
      { id: 'REG', model: 'ldo', pins: ['IN', 'OUT', 'GND'], params: { vout: 5, dropout: 2, rout: 0.01, ilimit: 1.5 } },
      { id: 'IQ', model: 'basic_iq', pins: ['IN', 'GND'], params: { iq: 0.005 } },
    ],
    visual: { shape: 'to220' },
    bodyFootprint: { dCols: [-1, 1], rows: ['f'] },
    obstacleHeight: 6.95, // tab top (TO220_TOP)
    supplyPins: { plus: ['IN'], minus: ['GND'] },
    support: {
      level: 'partial',
      simulated: [
        'regulated 5.00 V behind 10 mΩ (load regulation) while VIN − VOUT ≥ 2 V dropout; below that VOUT = VIN − 2 V',
        'current limit 1.5 A (quasi-static, settles within a few steps)',
        'quiescent current 5 mA from IN to GND',
        'the output only sources current (cannot sink)',
      ],
      limits: [
        'no thermal model: a 7805 dissipating several watts without a heatsink would shut down — here it keeps regulating',
        'no ripple rejection or transient response',
        'dropout is a fixed 2 V (real dropout grows with load current)',
      ],
    },
    pinInfo: [
      { pin: 'IN', kind: 'power', note: 'Input 7–35 V (≥ 2 V above the output). Add 0.33 µF to GND.' },
      { pin: 'GND', kind: 'ground', note: 'Ground — also the metal tab.' },
      { pin: 'OUT', kind: 'power', note: 'Regulated 5 V output, up to 1.5 A. Add 0.1 µF to GND.' },
    ],
    ratings: { vddMin: 7, vddMax: 35, iMax: 1.5 },
    meta: {
      partNumber: 'LM7805 / L7805',
      manufacturer: 'TI / ST / generic',
      sizeMm: [10.2, 4.5, 15.9],
      tags: ['regulator', '7805', 'linear', '5v', 'voltage regulator', 'to-220', 'power'],
      specs: ['5 V ± 4 %, 1.5 A', 'dropout 2 V, input ≤ 35 V', 'Iq ≈ 5 mA', 'P = (VIN − 5 V) · I — heatsink above ~1 W'],
    },
    doc: 'LM7805 fixed 5 V linear regulator (TO-220), pins IN/GND/OUT (front view, left to right). Feed 7–35 V into IN, ground GND, take 5 V from OUT (≤ 1.5 A). Needs ≥ 2 V headroom; it burns (VIN − 5 V)·I as heat. The wide body overhangs one column beside each outer lead.',
  },
  {
    type: 'ams1117_33',
    label: '3.3 V LDO module (AMS1117-3.3)',
    category: 'power',
    placement: 'leads',
    // breakout header order (the SOT-223 itself is 1 = GND, 2/tab = VOUT, 3 = VIN)
    pins: ['IN', 'GND', 'OUT'],
    sim: { kind: 'device', model: 'basic_subcircuit' },
    subcircuit: [
      { id: 'REG', model: 'ldo', pins: ['IN', 'OUT', 'GND'], params: { vout: 3.3, dropout: 1.1, rout: 0.01, ilimit: 1.1 } },
      { id: 'IQ', model: 'basic_iq', pins: ['IN', 'GND'], params: { iq: 0.005 } },
    ],
    visual: { shape: 'ams1117_module' },
    obstacleHeight: 4.8, // board top of the vertical module (AMS1117_TOP)
    supplyPins: { plus: ['IN'], minus: ['GND'] },
    support: {
      level: 'partial',
      simulated: [
        'regulated 3.30 V behind 10 mΩ while VIN − VOUT ≥ 1.1 V dropout; below that VOUT = VIN − 1.1 V',
        'current limit 1.1 A (quasi-static)',
        'quiescent current 5 mA from IN to GND',
        'the output only sources current (cannot sink)',
      ],
      limits: [
        'no thermal model (SOT-223 on a small board: ≈ 1 W before thermal shutdown — not simulated)',
        'dropout is a fixed 1.1 V (the datasheet value at 800 mA; lower at light load)',
        'output capacitor ESR stability is not modeled',
      ],
    },
    pinInfo: [
      { pin: 'IN', kind: 'power', note: 'Input 4.4–15 V (chip pin 3).' },
      { pin: 'GND', kind: 'ground', note: 'Ground (chip pin 1).' },
      { pin: 'OUT', kind: 'power', note: 'Regulated 3.3 V, up to ~1 A (chip pin 2 and tab).' },
    ],
    ratings: { vddMin: 4.4, vddMax: 15, iMax: 1 },
    meta: {
      partNumber: 'AMS1117-3.3',
      manufacturer: 'Advanced Monolithic Systems / generic module',
      sizeMm: [9.5, 2.5, 8.5],
      tags: ['regulator', 'ldo', 'ams1117', '3.3v', 'power', 'module', 'sot-223'],
      specs: ['3.3 V, 1 A', 'dropout 1.1 V at 800 mA', 'input ≤ 15 V', 'vertical 3-pin SIP breakout with 10 µF caps'],
    },
    doc: 'AMS1117-3.3 LDO on a small vertical breakout, header pins IN/GND/OUT in one row. Feed 4.5–15 V (e.g. the 5 V rail) into IN and take 3.3 V (≤ 1 A) from OUT — the usual way to power 3.3 V sensors or an STM32 from 5 V.',
  },

  // ----------------------------------------------------------- sources
  {
    type: 'battery_9v',
    label: '9 V battery',
    category: 'power',
    placement: 'offboard',
    pins: ['+', '-'],
    params: [
      { key: 'voltage', label: 'Open-circuit voltage', kind: 'number', default: 9, min: 0, max: 9.6, step: 0.1, unit: 'V' },
      { key: 'rint', label: 'Internal resistance', kind: 'number', default: 1.5, min: 0.05, max: 50, step: 0.05, unit: 'Ω' },
    ],
    sim: { kind: 'device', model: 'battery' },
    source: { plus: '+', minus: '-' },
    visual: { shape: 'battery_9v' },
    support: {
      level: 'partial',
      simulated: [
        'Thevenin cell: open-circuit voltage (param, 9 V) behind its internal resistance (param, 1.5 Ω) — the terminal voltage sags with load',
        'flags a current above 2 A that lasts 10 ms as a possible short (a capacitor’s start-up surge is not one); the warning clears once the current stays under 2 A for 10 ms',
      ],
      limits: [
        'no discharge: capacity, state of charge and the falling discharge curve are not modeled',
        'internal resistance is constant (real cells rise as they empty and in the cold)',
      ],
    },
    pinInfo: [
      { pin: '+', kind: 'power', note: 'Red snap lead.' },
      { pin: '-', label: '−', kind: 'ground', note: 'Black snap lead.' },
    ],
    meta: {
      partNumber: '6LR61 (PP3)',
      sizeMm: [48.5, 26.5, 17.5],
      tags: ['battery', '9v', 'pp3', 'power', 'portable', 'snap'],
      specs: ['9 V nominal, ≈ 1.5 Ω internal resistance (fresh alkaline)', '≈ 500 mAh — suited to small loads'],
    },
    doc: 'Off-board 9 V alkaline battery with a snap clip (terminals "ID:+" red, "ID:-" black). Terminal voltage = 9 V − I·1.5 Ω, so it sags under load. It powers a circuit on its own: its "-" terminal defines circuit ground.',
  },
  {
    type: 'battery_aa2',
    label: '2×AA battery holder (3 V)',
    category: 'power',
    placement: 'offboard',
    pins: ['+', '-'],
    params: [
      { key: 'voltage', label: 'Open-circuit voltage', kind: 'number', default: 3, min: 0, max: 3.3, step: 0.05, unit: 'V' },
      { key: 'rint', label: 'Internal resistance', kind: 'number', default: 0.3, min: 0.02, max: 10, step: 0.01, unit: 'Ω' },
    ],
    sim: { kind: 'device', model: 'battery' },
    source: { plus: '+', minus: '-' },
    visual: { shape: 'battery_aa2' },
    support: {
      level: 'partial',
      simulated: [
        'two cells in series as one Thevenin source: 3.0 V (param) behind 0.3 Ω (param, ≈ 0.15 Ω per alkaline cell)',
        'flags a current above 2 A that lasts 10 ms as a possible short (a capacitor’s start-up surge is not one); the warning clears once the current stays under 2 A for 10 ms',
      ],
      limits: [
        'no discharge: capacity, state of charge and the falling discharge curve are not modeled',
        'internal resistance is constant',
      ],
    },
    pinInfo: [
      { pin: '+', kind: 'power', note: 'Red lead.' },
      { pin: '-', label: '−', kind: 'ground', note: 'Black lead.' },
    ],
    meta: {
      partNumber: '2×AA holder (LR6 alkaline)',
      sizeMm: [58, 32, 16],
      tags: ['battery', 'aa', '3v', 'holder', 'power', 'portable'],
      specs: ['3.0 V nominal (2 × 1.5 V)', '≈ 0.3 Ω total internal resistance', '≈ 2500 mAh'],
    },
    doc: 'Off-board holder with two AA cells in series (terminals "ID:+" and "ID:-"): 3 V behind ≈ 0.3 Ω. Enough for an LED or a 3.3 V-tolerant circuit at reduced voltage. It powers a circuit on its own: its "-" terminal defines circuit ground.',
  },
  {
    type: 'current_source',
    label: 'Lab current source',
    category: 'power',
    placement: 'offboard',
    pins: ['+', '-'],
    params: [
      { key: 'current', label: 'Current', kind: 'number', default: 10, min: 0, max: 100, step: 0.1, unit: 'mA', runtime: true },
      { key: 'compliance', label: 'Compliance voltage', kind: 'number', default: 12, min: 0.5, max: 12, step: 0.1, unit: 'V', runtime: true },
    ],
    sim: { kind: 'device', model: 'current_source' },
    source: { plus: '+', minus: '-' },
    visual: { shape: 'current_source' },
    support: {
      level: 'full',
      simulated: [
        'constant current (0–100 mA, adjustable while running) out of "+" through the load back into "−", 1 MΩ output resistance',
        'compliance limit (≤ 12 V): when the load needs more voltage the output becomes a voltage source at the limit (CV), like a real SMU',
        'open output settles at the compliance voltage',
      ],
      limits: ['single quadrant: it sources only (a load driving the output negative is not limited)', 'no slew or settling dynamics'],
    },
    pinInfo: [
      { pin: '+', kind: 'power', note: 'Current leaves here (red post).' },
      { pin: '-', label: '−', kind: 'ground', note: 'Current returns here (black post).' },
    ],
    meta: {
      tags: ['current source', 'constant current', 'smu', 'lab', 'instrument', 'led test', 'compliance'],
      specs: ['0–100 mA', 'compliance 0.5–12 V', 'CC / CV indicator'],
    },
    doc: 'Off-board lab current source (terminals "ID:+" and "ID:-"): pushes the set current (0–100 mA, adjustable while running) through whatever is connected, up to the compliance voltage (≤ 12 V) — then it holds that voltage instead (CV). Ideal for measuring an LED or zener at an exact current.',
  },

  // ------------------------------------------------------------ switches
  {
    type: 'relay_5v',
    label: 'Relay 5 V (SRD-05VDC-SL-C)',
    category: 'switch',
    placement: 'footprint',
    pins: ['COIL1', 'COIL2', 'COM', 'NO', 'NC'],
    // bottom pin pattern approximated to the 0.1" grid, straddling the channel:
    // coil pins 12.7 mm apart (rows d/g), COM one column behind them, the
    // NO/NC pair 6 columns from COM (real: 12 mm / 1.95 mm / 14.15 mm)
    footprintOffsets: [
      { dCol: 0, row: 'd' }, // COIL1 (pin 1, anchor)
      { dCol: 0, row: 'g' }, // COIL2
      { dCol: -1, row: 'e' }, // COM
      { dCol: 5, row: 'g' }, // NO
      { dCol: 5, row: 'd' }, // NC
    ],
    // 19.0 × 15.5 mm body centered on the channel: columns at−1 … at+5, and
    // its 7.75 mm half-width just crosses the row c / h hole centers
    bodyFootprint: { dCols: [-1, 5], rows: ['c', 'd', 'e', 'f', 'g', 'h'] },
    obstacleHeight: 6.4, // case top 6.07 (RELAY_TOP)
    sim: { kind: 'chip', model: 'basic_relay_monitor' },
    subcircuit: [{ id: 'K', model: 'relay_srd05', pins: ['COIL1', 'COIL2', 'COM', 'NO', 'NC'] }],
    strictNewton: true,
    allowedRotations: [0, 180],
    visual: { shape: 'relay' },
    support: {
      level: 'full',
      simulated: [
        'coil: 70 Ω in series with 0.1 H (backward-Euler companion) — current rises with τ ≈ 1.4 ms, an interrupted coil kicks back L·di/dt',
        'armature with hysteresis on the coil current: pick-up at 53.6 mA (75 % of 5 V, datasheet max), drop-out at 7.1 mA (10 %, datasheet min)',
        'contacts transfer 4 ms after pick-up / 2 ms after drop-out (break-before-make, 0.5 ms gap) — total operate ≈ 6 ms at 5 V',
        `form-C contacts COM–NO / COM–NC, ${SWITCH_CONTACT}`,
        'warns when the coil is switched off without a flyback diode and the kick exceeds 30 V',
      ],
      limits: [
        'coil inductance is an estimate (not in the datasheet) and does not change with the armature position',
        'no contact bounce or arcing; no contact current/voltage rating enforcement',
        'the kick amplitude is set by the solver step (no transistor avalanche or winding capacitance)',
      ],
    },
    pinInfo: [
      { pin: 'COIL1', kind: 'control', note: 'Coil (70 Ω, 5 V / 71 mA). Not polarized — but a flyback diode is: cathode to the + side.' },
      { pin: 'COIL2', kind: 'control', note: 'Coil, other end. Drive through a transistor — a GPIO cannot supply 71 mA.' },
      { pin: 'COM', kind: 'passive', note: 'Common contact (10 A max).' },
      { pin: 'NO', kind: 'passive', note: 'Normally open: connected to COM while the coil is energized.' },
      { pin: 'NC', kind: 'passive', note: 'Normally closed: connected to COM while the coil is off.' },
    ],
    ratings: { iMax: 10 },
    meta: {
      partNumber: 'SRD-05VDC-SL-C',
      manufacturer: 'Songle / generic',
      sizeMm: [19, 15.5, 15.3],
      tags: ['relay', '5v', 'coil', 'flyback', 'spdt', 'contacts', 'switch', 'srd-05vdc'],
      specs: ['coil 5 V, 70 Ω (≈ 0.36 W)', 'contacts 10 A 250 VAC / 30 VDC, form C', 'operate ≤ 10 ms, release ≤ 5 ms'],
    },
    doc: 'SRD-05VDC-SL-C 5 V relay straddling the channel: `at` = COIL1 in row d; COIL2 = row g same column, COM = row e one column left, NO = row g and NC = row d five columns right. Drive the coil through an NPN/N-MOSFET (71 mA) and ALWAYS put a diode across the coil (cathode to +). COM connects to NC at rest, to NO while energized. The body covers columns at−1…at+5, rows c–h: wire from rows a/b and i/j.',
  },
  {
    type: 'toggle_switch',
    label: 'Toggle switch (SPDT)',
    category: 'switch',
    placement: 'leads',
    pins: ['a', 'common', 'b'],
    params: [
      { key: 'state', label: 'Position', kind: 'select', default: 'a', options: ['a', 'b'], runtime: true },
    ],
    sim: { kind: 'device', model: 'slide_switch' },
    visual: { shape: 'toggle' },
    obstacleHeight: 5.0, // bat lever tip (TOGGLE_TOP)
    support: {
      level: 'full',
      simulated: [`common ↔ a or b (the slide-switch model), ${SWITCH_CONTACT}`, 'position changeable while running'],
      limits: ['no contact bounce; the transition is instant (no break-before-make gap)'],
    },
    pinInfo: [
      { pin: 'a', kind: 'passive', note: 'Connected to common in position "a" (the lever then points toward b, like a real toggle).' },
      { pin: 'common', kind: 'passive', note: 'Middle pin.' },
      { pin: 'b', kind: 'passive', note: 'Connected to common in position "b".' },
    ],
    meta: {
      partNumber: 'sub-miniature SPDT toggle (2.54 mm pins)',
      sizeMm: [8, 4.5, 15],
      tags: ['toggle', 'switch', 'spdt', 'lever', 'on-on'],
      specs: ['ON-ON, SPDT', 'flip while the simulation runs'],
    },
    doc: 'Sub-miniature SPDT toggle switch, 3 leads a/common/b. Position "a" joins common to a, "b" joins common to b; the bat lever points AWAY from the connected terminal, like a real toggle. Flip it while the simulation runs.',
  },

  // ---------------------------------------------------- passives / timing
  {
    type: 'ntc_10k',
    label: 'NTC thermistor 10 kΩ',
    category: 'passive',
    placement: 'leads',
    pins: ['p1', 'p2'],
    params: [
      { key: 'temperature', label: 'Temperature', kind: 'number', default: 25, min: -40, max: 125, step: 0.5, unit: '°C', runtime: true },
    ],
    sim: { kind: 'device', model: 'ntc' },
    visual: { shape: 'ntc' },
    obstacleHeight: 2.0, // bead top (NTC_TOP)
    support: {
      level: 'full',
      simulated: [
        'R(T) = 10 kΩ · exp(3950 · (1/T − 1/298.15 K)) — 10 kΩ at 25 °C, B25/50 = 3950 K',
        'temperature adjustable while running (−40 … 125 °C)',
      ],
      limits: ['no self-heating (keep the sensing current ≲ 100 µA in reality)', 'instant thermal response (real beads take seconds)', 'the B equation drifts from the R–T table by a few % far from 25 °C'],
    },
    pinInfo: [
      { pin: 'p1', kind: 'passive' },
      { pin: 'p2', kind: 'passive' },
    ],
    meta: {
      partNumber: 'MF52-103 3950',
      sizeMm: [3, 3, 6],
      tags: ['ntc', 'thermistor', 'temperature', 'sensor', '10k', '3950', 'adc'],
      specs: ['10 kΩ ± 1 % at 25 °C', 'B = 3950 K', 'B equation: ≈ 33.6 kΩ at 0 °C, ≈ 3.6 kΩ at 50 °C'],
    },
    doc: 'NTC thermistor 10 kΩ at 25 °C (B = 3950), 2 leads; resistance falls as it warms (set the temperature while simulating). Put it in a divider with a 10 kΩ resistor into an ADC pin and convert with the B equation.',
  },
  {
    type: 'crystal_hc49',
    label: 'Crystal (HC-49)',
    category: 'passive',
    placement: 'leads',
    pins: ['p1', 'p2'],
    params: [
      { key: 'frequency', label: 'Frequency', kind: 'number', default: 8, min: 0.032768, max: 50, step: 0.001, unit: 'MHz' },
    ],
    sim: { kind: 'probe' },
    visual: { shape: 'hc49' },
    // 11 mm can over 4.9 mm lead spacing: overhangs one column past each lead
    bodyFootprint: { dCols: [-1, 1], rows: ['f'] },
    obstacleHeight: 1.75,
    support: {
      level: 'visual',
      simulated: ['placement, wiring and netlist only — both pins are open circuits'],
      limits: [
        'the analog solver does not simulate crystal oscillation (MHz resonance far above the 50 µs step)',
        'MCU clocks are modeled inside the MCU — a crystal on the board does not change them',
      ],
    },
    pinInfo: [
      { pin: 'p1', kind: 'passive', note: 'Not polarized.' },
      { pin: 'p2', kind: 'passive', note: 'Not polarized.' },
    ],
    meta: {
      partNumber: 'HC-49/S',
      sizeMm: [11.05, 4.65, 3.5],
      tags: ['crystal', 'xtal', 'oscillator', 'quartz', 'clock', 'hc-49'],
      specs: ['through-hole HC-49/S can, 4.88 mm lead spacing', 'typical 8–25 MHz, 18–20 pF load'],
    },
    doc: 'Quartz crystal in an HC-49/S can (2 leads, place them two holes apart). Visual only: the simulator does not oscillate crystals — MCU clocks are built into the MCU model.',
  },

  // ------------------------------------------------------------- modules
  {
    type: 'level_shifter_4ch',
    label: 'Level shifter 4-ch (BSS138)',
    category: 'module',
    placement: 'footprint',
    // headers 0.5" apart straddling the channel. Near header (row g) left →
    // right = pins 1..6, far header (row d) right → left = pins 7..12
    // (counter-clockwise like a DIP): LVn sits opposite HVn.
    pins: ['LV1', 'LV2', 'LV', 'GND', 'LV3', 'LV4', 'HV4', 'HV3', 'GND2', 'HV', 'HV2', 'HV1'],
    footprintOffsets: [
      ...Array.from({ length: 6 }, (_, i) => ({ dCol: i, row: 'g' as const })),
      ...Array.from({ length: 6 }, (_, i) => ({ dCol: 5 - i, row: 'd' as const })),
    ],
    internalBridges: [['GND', 'GND2']],
    allowedRotations: [0, 180],
    // 15.2 × 15 mm board: covers its 6 columns over rows d…g
    bodyFootprint: { dCols: [0, 5], rows: ['d', 'e', 'f', 'g'] },
    obstacleHeight: 2.2,
    sim: { kind: 'device', model: 'basic_subcircuit' },
    subcircuit: [...shifterChannel(1), ...shifterChannel(2), ...shifterChannel(3), ...shifterChannel(4)],
    visual: { shape: 'level_shifter' },
    supplyPins: { plus: ['HV', 'LV'], minus: ['GND'] },
    support: {
      level: 'full',
      simulated: [
        'per channel the real circuit: BSS138 N-MOSFET (gate = LV, source = LVn, drain = HVn; Vth 1.3 V, k 0.25 A/V², body diode) + 10 kΩ pull-ups to LV and HV',
        'bidirectional open-drain translation: pulling either side low pulls the other low (channel or body diode), released sides float up to their own supply',
      ],
      limits: [
        'no gate / drain capacitance: edges are as fast as the pull-ups and the analog step allow (real modules top out at a few hundred kHz)',
        'push-pull drivers work but fight the pull-ups exactly as on the real board',
      ],
    },
    pinInfo: SHIFTER_PIN_INFO,
    meta: {
      partNumber: 'BSS138 4-channel bi-directional logic level converter',
      manufacturer: 'generic (SparkFun BOB-12009 design)',
      sizeMm: [15.2, 15, 5.5],
      tags: ['level shifter', 'logic level converter', 'bss138', '3.3v', '5v', 'i2c', 'bidirectional', 'module'],
      specs: ['4 bidirectional channels', 'LV 1.8–5 V, HV ≥ LV up to 10 V', '10 kΩ pull-ups on both sides', 'I²C / UART / slow SPI'],
    },
    doc: 'BSS138 4-channel bidirectional level shifter breakout straddling the channel: `at` = LV1 in row g; row g holds LV1 LV2 LV GND LV3 LV4 (left→right), row d holds HV1 HV2 HV GND HV3 HV4 directly opposite. Power LV (e.g. 3.3 V), HV (e.g. 5 V) and GND; LVn ↔ HVn translate open-drain signals both ways (I²C, UART). The board covers rows d–g of its six columns.',
  },
]
