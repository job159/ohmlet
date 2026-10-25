/**
 * Layout helpers for the example descriptors (examples/embedded/src/*.example.mjs).
 * Plain JavaScript on purpose: scripts/build-examples.mjs runs in bare node
 * without the TypeScript sources. Everything produced here is an ordinary
 * CircuitLayout (src/model/types.ts) — the test suite
 * (tests/examples-embedded.test.ts) re-validates every generated file with
 * validateLayout and runErc and checks BP_TAP below against the catalog
 * geometry (componentPinHoles), so a catalog change cannot silently move a
 * wire off its pin.
 *
 * The bench every Blue Pill example starts from:
 *   - U1 STM32F103C8T6 Blue Pill straddling the channel at h10 (header pins
 *     in rows h and c, columns 10–29; the PCB covers rows b–i, so every
 *     header pin keeps exactly ONE free hole: row j beside the h-row header,
 *     row a beside the c-row header — `tap(pin)`);
 *   - PS1 bench supply (default 5 V) on the BOTTOM rails: bot+ = 5 V,
 *     bot− = GND; the board's 5V pin (j27) on bot+, GND3 (j28) on bot−;
 *   - the board's own 3.3 V regulator output 3V3_1 (a12) on the TOP + rail,
 *     GND2 (a11) on the top − rail — 3.3 V parts and pull-ups use the top
 *     rails, 5 V modules the bottom rails, exactly like a real lab bench.
 */

/** Blue Pill header pin → its free breadboard hole when the board sits at h10. */
export const BP_TAP = (() => {
  const near = ['PB12', 'PB13', 'PB14', 'PB15', 'PA8', 'PA9', 'PA10', 'PA11', 'PA12', 'PA15',
    'PB3', 'PB4', 'PB5', 'PB6', 'PB7', 'PB8', 'PB9', '5V', 'GND3', '3V3_2']
  const far = ['VBAT', 'PC13', 'PC14', 'PC15', 'PA0', 'PA1', 'PA2', 'PA3', 'PA4', 'PA5',
    'PA6', 'PA7', 'PB0', 'PB1', 'PB10', 'PB11', 'NRST', '3V3_1', 'GND2', 'GND1']
  const map = {}
  near.forEach((p, i) => { map[p] = `j${10 + i}` })
  far.forEach((p, i) => { map[p] = `a${29 - i}` })
  return map
})()

/** Free hole beside Blue Pill header pin `pin`. */
export function tap(pin) {
  const h = BP_TAP[pin]
  if (!h) throw new Error(`not a Blue Pill header pin: ${pin}`)
  return h
}

/** Strip column of a hole ref ("j27" → 27). */
export function colOf(hole) {
  const m = /^[a-j](\d+)$/.exec(hole)
  if (!m) throw new Error(`not a strip hole: ${hole}`)
  return Number(m[1])
}

/**
 * Rail hole index whose x position is closest to strip column `col`
 * (rail hole i sits at x = 2.5 + i + floor(i / 5), src/model/breadboard.ts),
 * so a wire from a strip to its rail drops straight down instead of
 * crossing the board.
 */
export function railNear(col) {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < 50; i++) {
    const d = Math.abs(2.5 + i + Math.floor(i / 5) - col)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * A layout under construction. `rail(name, col)` hands out a free rail hole
 * near a column (each rail hole is used once).
 */
export class Bench {
  constructor() {
    this.components = []
    this.wires = []
    this.n = 0
    this.usedRail = new Set()
  }

  /** add a component, returns it */
  add(c) {
    if (this.components.some((x) => x.id === c.id)) throw new Error(`duplicate component id ${c.id}`)
    this.components.push(c)
    return c
  }

  /** a jumper wire */
  wire(from, to, color) {
    const w = { id: `W${++this.n}`, from, to }
    if (color) w.color = color
    this.wires.push(w)
    return this
  }

  /** a free hole on rail `rail` ('top+', 'top-', 'bot+', 'bot-') near column `col` */
  rail(rail, col) {
    const start = railNear(col)
    for (let k = 0; k < 50; k++) {
      for (const i of [start + k, start - k]) {
        if (i < 0 || i > 49) continue
        const ref = `${rail}${i}`
        if (!this.usedRail.has(ref)) {
          this.usedRail.add(ref)
          return ref
        }
      }
    }
    throw new Error(`rail ${rail} is full`)
  }

  /** wire strip hole `hole` straight down/up to rail `rail` */
  toRail(hole, rail, color) {
    const c = colOf(hole)
    return this.wire(hole, this.rail(rail, c), color ?? (rail.endsWith('-') ? 'black' : 'red'))
  }

  /** mark rail holes as taken (holes a part's own leads occupy) */
  takeRail(ref) {
    if (this.usedRail.has(ref)) throw new Error(`rail hole ${ref} used twice`)
    this.usedRail.add(ref)
    return ref
  }

  layout(meta) {
    const l = { version: 1, name: meta.title, description: meta.layoutDescription ?? meta.description }
    if (meta.board) l.board = meta.board
    l.components = this.components
    l.wires = this.wires
    return l
  }
}

/**
 * The standard Blue Pill bench (see the file header). Options:
 *   supply — bench supply voltage on bot+ (default 5 V; 4.5 V for 5 V
 *            modules whose VIH must stay below 3.3 V, documented per example)
 *   top    — what the top rails carry: '3v3' (default: the board's 3.3 V
 *            and GND2), 'supply' (PS1 + / − directly: two supply rails for
 *            5 V modules whose pins face the top), or 'none'
 */
export function bluePillBench({ supply = 5, top = '3v3' } = {}) {
  const b = new Bench()
  b.add({ id: 'PS1', type: 'power_supply', params: { voltage: supply } })
  b.add({ id: 'U1', type: 'stm32_bluepill', at: 'h10' })
  b.wire('PS1:+', b.takeRail('bot+0'), 'red')
  b.wire('PS1:-', b.takeRail('bot-0'), 'black')
  b.toRail(tap('5V'), 'bot+', 'red')
  b.toRail(tap('GND3'), 'bot-', 'black')
  if (top === '3v3') {
    b.toRail(tap('3V3_1'), 'top+', 'red')
    b.toRail(tap('GND2'), 'top-', 'black')
  } else if (top === 'supply') {
    b.wire('PS1:+', b.takeRail('top+0'), 'red')
    b.wire('PS1:-', b.takeRail('top-0'), 'black')
  }
  return b
}

/** Strip hole of pin index `i` of a part placed with `at` (helper for modules whose pins run along one row). */
export function rowHole(row, col) {
  return `${row}${col}`
}

/** A logic-analyzer channel on a Blue Pill pin (instruments.logicChannels entry). */
export function mcuChannel(index, pin, label = pin, componentId = 'U1') {
  return { index, label, source: { kind: 'mcu-pin', componentId, pin } }
}
