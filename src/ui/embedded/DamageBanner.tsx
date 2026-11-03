/**
 * Inspector damage banner (product chrome): what a part's OWN simulation
 * model latched or is going through, read from its telemetry only — never
 * guessed (no `damage` / `burned` → no banner). Styled like the burned-LED
 * banner (PropertiesSheet .prs-burned): a title that matches the Problems
 * row (「R2 燒斷了」, 「C1 反接爆開」, 「R1 功率超過額定」), then the cause, the
 * fix and how the simulated part comes back: 〔換新〕 replaces it in one
 * click (replace-part.ts — the banner's button on a destroyed part), and
 * fixing the circuit or a value replaces it by itself (an edit rebuilds the
 * model; a value change heals it — auto-heal.ts).
 *
 *  - LED burned (its junction-temperature model, or a gross overload) —
 *    error; LED overheating (junction above 100 °C) — warning;
 *  - RGB LED with a burned die — error, naming the die where the readings
 *    show it (a burned die keeps conducting but stays dark; the others
 *    still light), never "it no longer conducts or lights";
 *  - resistor burned open (thermal model, sustained gross overload) —
 *    error; resistor overheating (above its power rating) — warning, with
 *    「溫度（相對額定）」 in the live values;
 *  - polarized capacitor vented (reversed by more than 1 V) — error.
 *
 * The inspector states a title once: when its problem card above already
 * shows this part's own Problems row (the row's subject is this part), the
 * banner leaves its title out and reads as that row's state detail —
 * cause, fix, recovery — next to the live values (an overheating LED's row
 * is its cause, 「LED1 的限流電阻太小」; the banner's own 「LED1 正在過熱」
 * shows only while no such row is up). 〔換新〕 is offered once, too: a
 * destroyed part's banner carries the button unless that card row (its
 * burned / vented row, which has 〔換新〕) is showing; an overheating part
 * (a warning — not latched, it cools down) gets none.
 *
 * The English classic chrome keeps its single original LED sentence
 * (PropertiesSheet) and shows none of these.
 */
import type { CatalogEntry } from '../../model/catalog'
import type { ComponentTelemetry } from '../../model/types'
import { t, useLang } from '../../i18n'
import { fmtCurrent, fmtPower } from '../../instruments/format'
import { fmtRatedCurrent, LED_LIGHT_RATED_A } from '../../instruments/led-light'
import { ChipButton } from './controls'
import { useProblems } from './problems'
import { replaceDamagedWithFeedback, replaceTargetOf } from './replace-part'
import './damage-banner.css'

export interface DamageText {
  /** 'error' = destroyed (latched), 'warning' = overheating right now */
  tone: 'error' | 'warning'
  title: string
  body: string
}

/** A power rating as authored (「250 mW」, 「1 W」 — no zeros it never had). */
function fmtRatedPower(w: number): string {
  return fmtPower(w).replace(/\.0+(?=\s)/, '').replace(/(\.\d*?)0+(?=\s)/, '$1')
}

/** An RGB LED's dies (src/sim/models/basic.model.ts): telemetry leds / values keys and colour words. */
const RGB_DIES = [
  { ch: 'R', word: 'red|die' },
  { ch: 'G', word: 'green|die' },
  { ch: 'B', word: 'blue|die' },
] as const

type RgbDie = (typeof RGB_DIES)[number]['ch']

/**
 * The dies of an RGB LED its readings show burned: the model's own flag
 * (telemetry values burnedR / burnedG / burnedB = 1 — named even while the
 * die carries no current), else a die that carries forward current (values
 * iR / iG / iB) yet emits nothing (leds R / G / B = 0) — an intact die
 * lights at any forward current, a burned one keeps conducting but stays
 * dark. Without the flag, a burned die that carries no current cannot be
 * told from an unlit one: it is not named (never guessed).
 */
export function burnedRgbDies(tele: ComponentTelemetry): RgbDie[] {
  const out: RgbDie[] = []
  for (const { ch } of RGB_DIES) {
    const i = tele.values?.[`i${ch}`]
    const b = tele.leds?.[ch]
    if (tele.values?.[`burned${ch}`] === 1 || (typeof i === 'number' && typeof b === 'number' && i > 1e-6 && b === 0)) out.push(ch)
  }
  return out
}

/** 「紅色」, 「紅色與綠色」, 「紅色、綠色與藍色」 */
function dieList(dies: readonly RgbDie[]): string {
  const words = RGB_DIES.filter((d) => dies.includes(d.ch)).map((d) => t(d.word))
  if (words.length <= 1) return words[0] ?? ''
  return t('{a} and {b}|die-list', { a: words.slice(0, -1).join(t(', |die-list')), b: words[words.length - 1] })
}

/** The banner of part `id` from its telemetry; null when nothing is damaged. */
export function damageText(id: string, entry: CatalogEntry | undefined, tele: ComponentTelemetry | undefined): DamageText | null {
  if (!tele) return null
  const model = entry?.sim.kind === 'device' ? entry.sim.model : ''
  const d = tele.damage
  if (model === 'rgb_led') {
    // a burned die keeps conducting and the other dies still light (the RGB model): never 「不導電也不會亮」
    if (tele.burned !== true && d?.kind !== 'burned') return null
    const ifMax = entry?.ratings?.ifMax
    const rated = fmtRatedCurrent(typeof ifMax === 'number' && ifMax > 0 ? ifMax : LED_LIGHT_RATED_A)
    const dies = burnedRgbDies(tele)
    const vars = { dies: dieList(dies), rated }
    return {
      tone: 'error',
      title: t('{id} burned out|banner', { id }), // = the Problems row 「D1 已燒毀」
      body:
        dies.length > 0
          ? t(
              'Its {dies} die burned out from too much current: a burned die still conducts but no longer lights; the other dies still work. Give each die its own series resistor that keeps its current under {rated}. Press “Replace” for a new one; fixing the circuit or a value also replaces it automatically.',
              vars,
            )
          : t(
              'One of its dies burned out from too much current: a burned die still conducts but no longer lights; the other dies still work. Give each die its own series resistor that keeps its current under {rated}. Press “Replace” for a new one; fixing the circuit or a value also replaces it automatically.',
              vars,
            ),
    }
  }
  if (model === 'led' || tele.burned === true) {
    const ifMax = entry?.ratings?.ifMax
    const rated = fmtRatedCurrent(typeof ifMax === 'number' && ifMax > 0 ? ifMax : LED_LIGHT_RATED_A)
    if (tele.burned === true || d?.kind === 'burned') {
      return {
        tone: 'error',
        title: t('{id} burned out|banner', { id }),
        body: t(
          'Too much current overheated its junction and burned it open: it no longer conducts or lights. Add a series resistor that keeps the current under {rated}. Press “Replace” for a new one; fixing the circuit or a value also replaces it automatically.',
          { rated },
        ),
      }
    }
    if (d?.kind === 'overheating') {
      const i = typeof tele.current === 'number' ? fmtCurrent(Math.abs(tele.current)) : '—'
      return {
        tone: 'warning',
        title: t('{id} is overheating|banner', { id }),
        body: t(
          '{current} is far above its rated {rated}: its junction is hotter than 100 °C, and at about 150 °C it burns out. Use a larger series resistor.',
          { current: i, rated },
        ),
      }
    }
    return null
  }
  if (model === 'resistor') {
    const pMax = entry?.ratings?.pMax
    const max = typeof pMax === 'number' && pMax > 0 ? fmtRatedPower(pMax) : t('rated|power')
    if (d?.kind === 'burned') {
      return {
        tone: 'error',
        title: t('{id} burned open|banner', { id }),
        body: t(
          'It dissipated many times its {max} rating until its film overheated and burned through: it no longer conducts. Use a larger resistance or a higher-wattage resistor. Press “Replace” for a new one; fixing the circuit or a value also replaces it automatically.',
          { max },
        ),
      }
    }
    if (d?.kind === 'overheating') {
      return {
        tone: 'warning',
        title: t('{id} power above its rating|banner', { id }),
        body: t(
          'It dissipates {p}, above its {max} rating, and keeps heating up — it smokes; a sustained gross overload burns it open. Use a larger resistance or a higher-wattage resistor.',
          { p: fmtPower(Math.abs(tele.power ?? NaN), { current: tele.current }), max },
        ),
      }
    }
    return null
  }
  if (model === 'capacitor' && d?.kind === 'vented') {
    return {
      tone: 'error',
      title: t('{id} vented (reversed)|banner', { id }),
      body: t(
        'Its + lead sat more than 1 V below its − lead, and a reversed electrolytic capacitor heats up until its pressure vent opens. A real one is ruined (it loses capacitance and may short); the simulation keeps its value. Turn it around so + goes to the higher voltage. Press “Replace” for a new one; fixing the circuit or a value also replaces it automatically.',
      ),
    }
  }
  return null
}

/**
 * 「溫度（相對額定）」 value: the part's modelled temperature rise / the rise at
 * its rating (telemetry `heat`, published from 0.5): 「1.6 倍」.
 */
export function fmtHeat(heat: number): string {
  return t('{x}× rated|heat', { x: heat < 9.95 ? heat.toFixed(1) : heat.toFixed(0) })
}

/**
 * Does the inspector's problem card (ProblemsList compact: the first of the
 * rows that involve the part) show a row whose subject is part `id`? Then
 * the banner does not repeat a title (see the module doc).
 */
export function cardShowsOwnRow(problems: readonly { componentIds: readonly string[] }[], id: string): boolean {
  return problems.find((p) => p.componentIds.includes(id))?.componentIds[0] === id
}

/**
 * Does that card show part `id`'s own damage row — burned / vented, the row
 * problems.ts gives 〔換新〕? Then the banner leaves its button out: one
 * 〔換新〕 in the inspector.
 */
export function cardShowsOwnDamageRow(problems: readonly { componentIds: readonly string[]; fact?: string }[], id: string): boolean {
  const p = problems.find((x) => x.componentIds.includes(id))
  return p !== undefined && p.componentIds[0] === id && replaceTargetOf(p.fact) === id
}

/** The banner (product chrome); nothing when the part is intact. */
export function DamageBanner({ id, entry, tele }: { id: string; entry: CatalogEntry | undefined; tele: ComponentTelemetry | undefined }) {
  useLang()
  // booleans: re-render only when the card above starts / stops showing this part's own row (≤ 1 / s)
  const titled = !useProblems((s) => cardShowsOwnRow(s.problems, id))
  const cardReplaces = useProblems((s) => cardShowsOwnDamageRow(s.problems, id))
  const d = damageText(id, entry, tele)
  if (!d) return null
  // a destroyed part (latched): 〔換新〕 — once (see cardShowsOwnDamageRow); a hot one cools by itself
  const replace = d.tone === 'error' && !cardReplaces
  return (
    <div
      className={`prs-burned dmg-banner${d.tone === 'warning' ? ' is-warn' : ''}${titled ? '' : ' is-untitled'}`}
      role={d.tone === 'error' ? 'alert' : 'status'}
    >
      {titled && <strong className="dmg-banner-title">{d.title}</strong>}
      <span className="dmg-banner-body">{d.body}</span>
      {replace && (
        <span className="dmg-banner-actions">
          <ChipButton accent aria-label={t('Replace {id} with a new one', { id })} onClick={() => void replaceDamagedWithFeedback(id)}>
            {t('Replace|damaged')}
          </ChipButton>
        </span>
      )}
    </div>
  )
}
