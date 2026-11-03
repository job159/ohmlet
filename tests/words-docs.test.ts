/**
 * The user guide (docs/user-guide.md) quotes the interface word for word on
 * the owner's last requests (owner: words — the same rule as
 * tests/docs-ui-quotes.test.ts: every quote is rendered here from the code
 * that shows it, in zh-TW, and looked up in the section that quotes it):
 *
 *  §5  the honest cheer (1.2 s of simulated time, what it names, no 完成！
 *      for a pass with 載入完整答案), the damage looks with their Problems
 *      titles and the LED's thermal rules in plain words, the pre-Run
 *      「C1 電解電容接反了」 with 對調兩腳, every 保持按下 surface (pill
 *      「SW1 保持按下中」〔放開〕, the long-press sheet, KY-040 / joystick
 *      「按鈕（SW）」, the lesson hint), 顯示電流's honest hidden loops;
 *  §8  LED brightness = current ÷ the rated 20 mA, shown with the current;
 *  §15 a bench supply's reading leaves out a legacy chip's output current;
 *  §18 the over-rating rule's title;
 *  §22 the 音效 switch's own description.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import { tMessage } from '../src/i18n/messages'
import { partSupport, partTranslation } from '../src/i18n/parts'
import { CATALOG } from '../src/model/catalog'
import { LED_PEAK_CURRENT, LED_TJ_BURN_C, LED_TJ_MAX_C } from '../src/sim/devices'
import { ERC_RULES } from '../src/sim/erc'
import { fmtLedLight, fmtRatedCurrent, LED_LIGHT_RATED_A } from '../src/instruments/led-light'
import { latchedSummaryOf } from '../src/ui/embedded/latch'
import { CHEER_WINDOW_S } from '../src/ui/fx/success-watch'
import { flowConcealedNote } from '../src/ui/chrome/FlowToggle'

const ROOT = path.resolve(__dirname, '..')
const guide = () => readFileSync(path.join(ROOT, 'docs/user-guide.md'), 'utf8').replace(/\r\n/g, '\n')

/** One section of the user guide (`## n. …` up to the next `## `). */
function section(n: number): string {
  const g = guide()
  const start = g.indexOf(`\n## ${n}. `)
  expect(start, `user guide §${n}`).toBeGreaterThan(0)
  const end = g.indexOf('\n## ', start + 1)
  return g.slice(start, end < 0 ? undefined : end)
}

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => __setLangForTests('zh-TW'))

describe('§5 the cheer is described as it behaves', () => {
  it('「電路正常運作 ✓ · LED1 亮了」 after 1.2 s of simulated time; a loaded-answer pass gets no 完成！', () => {
    const s5 = section(5)
    expect(CHEER_WINDOW_S).toBe(1.2)
    expect(s5).toContain(`連續 ${CHEER_WINDOW_S} 秒（模擬時間）`)
    expect(s5).toContain(`「${t('Circuit working ✓')}」`)
    expect(s5).toContain(`「${t('Circuit working ✓')} · ${t('{id} lit', { id: 'LED1' })}」`)
    expect(s5).toContain('每次改動電路最多一次')
    expect(s5).toContain(`「${t('Done!')}」`)
    const viaSolution = t('All {n} acceptance checks pass, but with the loaded solution — build it yourself to complete the lesson.|cheer', { n: 6 })
    expect(s5).toContain(`「載入完整答案」通過時不會出現「${t('Done!')}」，只寫「${viaSolution}」`)
  })
})

describe('§5 damage: the looks, the Problems titles, the rules in plain words', () => {
  it('each damage names its Problems row; the reversed electrolytic is said before Run with 對調兩腳', () => {
    const s5 = section(5)
    for (const short of ['LED1 burned out', 'R2 burned open', 'C1 vented (reversed)', 'C1 electrolytic reversed']) {
      const z = tMessage(short)
      expect(z, short).not.toBe(short)
      expect(s5).toContain(`「${z}」`)
    }
    expect(s5).toContain('**還沒按執行**')
    expect(s5).toContain(`按「${t('Swap the leads')}」一鍵把兩支腳對調`)
  })

  it('the LED thermal rules use the model’s numbers', () => {
    const s5 = section(5)
    expect(s5).toContain(`接面超過 ${LED_TJ_MAX_C} °C，開始過熱冒煙，到約 ${LED_TJ_BURN_C} °C 就燒毀`)
    expect(s5).toContain(`電流超過 ${LED_PEAK_CURRENT * 1000} mA 達 1 ms`)
    expect(s5).toContain('5 V 串 100 Ω（約 31 mA）只會過亮，不會燒毀')
    expect(s5).not.toMatch(/30 mA 達 1 ms/)
  })
})

describe('§5 保持按下 on every surface', () => {
  it('the pill, its 〔放開〕, the sheet, the KY-040 / joystick row and the lesson hint', () => {
    const s5 = section(5)
    expect(s5).toContain(`「${latchedSummaryOf(['SW1'])}」，旁邊的〔${t('Release|latch')}〕一按就放開`)
    expect(latchedSummaryOf(['SW1'])).toBe('SW1 保持按下中')
    expect(s5).toContain(`長按按鈕打開的動作選單也有「${t('Keep pressed|latch')}」`)
    const sw = partTranslation('ky040_encoder')?.params?.pressed
    expect(sw).toBe(partTranslation('joystick_xy')?.params?.pressed)
    expect(s5).toContain(`「${sw}」列也是同一個「${t('Keep pressed|latch')}」開關`)
    const hint = t('{ids} is kept pressed — this step checks the circuit as it is now|latch', { ids: 'SW1' })
    expect(s5).toContain(`「${hint}」並附〔${t('Release|latch')}〕`)
    expect(s5).toContain('課程的驗收在放開所有按鈕的情況下檢查')
    expect(s5).toContain('接線或元件的錯誤不會出現這個提示')
    // the pushbutton's library card uses the same words
    expect(partSupport(CATALOG.pushbutton).simulated?.[1]).toBe(`執行中可按住，或雙擊／打開「${t('Keep pressed|latch')}」讓它一直按著`)
  })

  it('顯示電流 never draws a loop it cannot close, and says so once (FlowToggle’s own note)', () => {
    const s5 = section(5)
    expect(s5).toContain('寧可不畫光點，也不畫出流到一半就消失的電流')
    expect(s5).toContain(`「${flowConcealedNote(['U1'])}」`)
  })
})

describe('§8, §15, §18, §22', () => {
  it('§8: LED brightness = current ÷ the rated 20 mA, always with the current, the same number on every surface', () => {
    const s8 = section(8)
    expect(s8).toContain(`**亮度＝電流 ÷ 額定 ${fmtRatedCurrent(LED_LIGHT_RATED_A)}**`)
    expect(s8).toContain(`「${fmtLedLight(0.485, 0.0097)}」`)
    expect(s8).toContain(`「${t('above the rated {rated}|led', { rated: fmtRatedCurrent(LED_LIGHT_RATED_A) })}」`)
    expect(s8).toContain(`「${fmtLedLight(0, 0, { burned: true })}」`)
  })

  it('§15: a bench supply’s reading leaves out the legacy chips’ output current (as their library cards say)', () => {
    const s15 = section(15)
    expect(s15).toContain('555、74xx、CD40xx、LM358')
    expect(s15).toContain('所以電源供應器讀到的電流也不含它')
    expect(partSupport(CATALOG.ne555).limits?.some((l) => l.startsWith('電源供應器自己的電流讀數不含這些輸出驅動的電流'))).toBe(true)
  })

  it('§18 names the over-rating rule by its title', () => {
    const title = t(ERC_RULES.find((r) => r.id === 'over-rating')!.title)
    expect(title).toBe('超出額定')
    expect(section(18)).toContain(`${title}、共地參考`)
    expect(guide()).not.toContain('超出額定（即時）')
  })

  it('§22 quotes the 音效 switch’s own description', () => {
    const desc = t('A chime when a lesson passes or a circuit works, a pop when a part burns, and the mechanical sounds of plugging in parts, wires, buttons, switches and relays')
    expect(desc).toBe('課程通過或電路正常運作時的提示音、元件燒毀的爆裂聲，以及插拔元件、接線、按鈕、開關與繼電器的機械聲')
    expect(section(22)).toContain(`**${t('Sound')}**開關（「${desc}」`)
  })
})
