/**
 * Which alternate function an STM32F103 pin carries right now (UX helper
 * H10 — IS-10). ONE judgement for the logic analyzer's channel picker and
 * the inspector's pin rows (IN-20), so 「PB6 · I2C1_SCL」 in one place is
 * never 「PB6 · USART1_TX」 in the other.
 *
 *   activePinFunction(functions, mode, { uarts, mapr? })  'I2C1_SCL' | null
 *   remapActive(fn, mapr)                                  is `fn` on its remapped pins?
 *   pinFunctionContext(frame)                             { uarts, mapr } of a board's McuFrameInfo
 *
 * The simulation reports AFIO_MAPR in every MCU frame (McuFrameInfo.mapr,
 * from the SoC's AFIO block), so a firmware that remaps USART1 to PB6 / PB7
 * or I2C1 to PB8 / PB9 gets its remapped functions named — pass the board's
 * frame through pinFunctionContext() so every view uses the same facts.
 *
 * Rules (never a guess — ambiguous → null):
 *  - only alternate-function modes ('af' push-pull, 'af-od' open-drain)
 *    carry a function;
 *  - a function the catalog tags '(remap)' counts only when AFIO_MAPR is
 *    KNOWN (`mapr`) and its remap bits select it; a default-mapped function
 *    whose peripheral the known MAPR moved elsewhere does not count;
 *    without `mapr` the reset mapping (no remap) is assumed;
 *  - 'af-od' prefers I²C (SCL / SDA) — open-drain AF is how I²C pins are set;
 *  - an enabled USART's TX / RX (McuFrameInfo.uarts) wins in 'af';
 *  - otherwise the single remaining output-capable function, else null.
 *
 * AFIO_MAPR bits (RM0008 §9.4.2): SPI1 0, I2C1 1, USART1 2, USART2 3,
 * USART3 5:4, TIM1 7:6, TIM2 9:8, TIM3 11:10, TIM4 12, CAN 14:13. Pure.
 */

/** Options of activePinFunction. */
export interface PinFunctionContext {
  /** the board's USARTs as the firmware programmed them (McuFrameInfo.uarts) */
  uarts?: readonly { name: string; config: { enabled: boolean } }[]
  /** AFIO_MAPR without SWJ_CFG, when the simulation reports it (McuFrameInfo.mapr; unknown = undefined) */
  mapr?: number
  /**
   * The peripherals the firmware switched on (McuFrameInfo.clocked, support-table
   * names 'TIM3', 'SPI1' …), when known: a function of a remappable / timer /
   * serial peripheral that is NOT clocked cannot drive the pin, so it is not a
   * candidate (pwm-fade PA6 in 'af': TIM3 on, SPI1 off → TIM3_CH1 — UX QA IS-F8).
   * Absent or empty = unknown (no function is ruled out). Optional: callers
   * that pass only { uarts, mapr } keep today's answers.
   */
  clocked?: readonly string[]
}

/** The peripheral a function name belongs to ('TIM3_CH1' → 'TIM3'), for the clocked filter; null = not filtered. */
function peripheralOf(name: string): string | null {
  const m = /^(TIM\d+|SPI\d+|USART\d+|UART\d+|I2C\d+|CAN\d*|USB)_/.exec(name)
  return m ? m[1] : null
}

/**
 * The activePinFunction context of a board from its MCU frame: the USARTs
 * and AFIO_MAPR as the firmware programmed them (no frame → the reset facts:
 * no USART enabled, MAPR unknown).
 */
export function pinFunctionContext(
  frame: { uarts?: PinFunctionContext['uarts']; mapr?: number } | null | undefined,
): PinFunctionContext {
  const mapr = frame?.mapr
  const ctx: PinFunctionContext = { uarts: frame?.uarts }
  if (typeof mapr === 'number' && Number.isFinite(mapr)) ctx.mapr = mapr >>> 0
  return ctx
}

/** A catalog function name ('USART1_TX (remap)') → its name and whether it is the remapped pin. */
function parseFunction(f: string): { name: string; remap: boolean } {
  const m = /^(.*?)\s*\((remap)\)\s*$/i.exec(f)
  return m ? { name: m[1], remap: true } : { name: f.replace(/\s*\(.*\)$/, ''), remap: false }
}

const bits = (mapr: number, lo: number, n: number): number => (mapr >>> lo) & ((1 << n) - 1)

/**
 * Does the known AFIO_MAPR put function `fn` (e.g. 'USART1_TX', 'TIM2_CH3')
 * on its REMAPPED pins (the catalog's '(remap)' entries)? For the STM32F103
 * medium-density pins the Blue Pill brings out. Unknown peripherals → false.
 */
export function remapActive(fn: string, mapr: number): boolean {
  const name = parseFunction(fn).name
  if (/^SPI1_/.test(name)) return bits(mapr, 0, 1) === 1
  if (/^I2C1_/.test(name)) return bits(mapr, 1, 1) === 1
  if (/^USART1_/.test(name)) return bits(mapr, 2, 1) === 1
  if (/^USART2_/.test(name)) return bits(mapr, 3, 1) === 1
  if (/^USART3_/.test(name)) return bits(mapr, 4, 2) !== 0 && bits(mapr, 4, 2) !== 2
  if (/^TIM1_(BKIN|CH\dN)$/.test(name)) return bits(mapr, 6, 2) === 1 || bits(mapr, 6, 2) === 3
  if (/^TIM1_/.test(name)) return bits(mapr, 6, 2) === 3
  if (/^TIM2_(CH1_ETR|CH1|ETR|CH2)$/.test(name)) return (bits(mapr, 8, 2) & 1) === 1
  if (/^TIM2_(CH3|CH4)$/.test(name)) return (bits(mapr, 8, 2) & 2) === 2
  // TIM3 partial remap (10) puts CH1/CH2 on PB4/PB5 — the only TIM3 remap pins on the Blue Pill
  if (/^TIM3_(CH1|CH2)$/.test(name)) return bits(mapr, 10, 2) === 2
  if (/^TIM3_/.test(name)) return bits(mapr, 10, 2) === 3
  if (/^TIM4_/.test(name)) return bits(mapr, 12, 1) === 1
  if (/^CAN_/.test(name)) return bits(mapr, 13, 2) === 2
  return false
}

/** Default-mapped functions a known MAPR moved away from this pin. */
function movedAway(name: string, mapr: number): boolean {
  // TIM3: partial remap (10) moves CH1/CH2 (PA6/PA7 → PB4/PB5) only; full (11) moves all four
  if (/^TIM3_(CH1|CH2)$/.test(name)) return bits(mapr, 10, 2) === 2 || bits(mapr, 10, 2) === 3
  if (/^TIM3_/.test(name)) return bits(mapr, 10, 2) === 3
  if (/^CAN_/.test(name)) return bits(mapr, 13, 2) !== 0
  return remapActive(name, mapr)
}

/**
 * Functions that are inputs / analog / debug / clock — never "the" output
 * function of a pin (JTAG JTDI / JTDO / JTMS / JTCK and NJTRST: a firmware
 * that puts PB4 in AF mode means its TIM3 / SPI1 remap, which needs MAPR).
 */
const NOT_OUTPUT = /^(ADC|WKUP|OSC|JT|NJTRST|SWD|SWCLK|SWDIO|TRACE|BOOT|TAMPER|USBD[MP]$)/

/**
 * The alternate function `functions` (the catalog's pinInfo.functions of
 * one pin) carries in `mode` (the firmware-programmed pin mode tag) — only
 * when unambiguous (see the module rules). null otherwise.
 */
export function activePinFunction(
  functions: readonly string[],
  mode: string | undefined,
  ctx: PinFunctionContext = {},
): string | null {
  if (mode !== 'af' && mode !== 'af-od') return null
  const known = typeof ctx.mapr === 'number' && Number.isFinite(ctx.mapr)
  const mapr = known ? (ctx.mapr as number) >>> 0 : 0
  const candidates: string[] = []
  for (const f of functions) {
    const { name, remap } = parseFunction(f)
    if (remap) {
      if (known && remapActive(name, mapr)) candidates.push(name)
    } else if (!known || !movedAway(name, mapr)) {
      candidates.push(name)
    }
  }
  const clocked = ctx.clocked && ctx.clocked.length > 0 ? new Set(ctx.clocked) : null
  const unique = [...new Set(candidates)].filter((f) => {
    const per = clocked ? peripheralOf(f) : null
    return per === null || clocked!.has(per)
  })
  if (mode === 'af-od') {
    const i2c = unique.filter((f) => /^I2C\d_(SCL|SDA)$/.test(f))
    if (i2c.length === 1) return i2c[0]
  }
  const usart = unique.filter(
    (f) => /^USART\d_(TX|RX)$/.test(f) && ctx.uarts?.some((u) => u.name === f.split('_')[0] && u.config.enabled),
  )
  if (usart.length === 1) return usart[0]
  const rest = unique.filter((f) => !NOT_OUTPUT.test(f))
  return rest.length === 1 ? rest[0] : null
}
