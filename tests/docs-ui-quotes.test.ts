/**
 * The user guide quotes the interface word for word — so every quote is
 * rendered here from the code that shows it (the capsule's runCapsuleText,
 * the 更多 sheet's speed row, the status pill's strings, the wiring / undo /
 * delete feedback, the UART terminal's rxWireNote, the meters' unwired
 * reading, the lockup cause …) in zh-TW and looked up in the page that
 * quotes it. A re-worded UI string therefore fails here until the docs say
 * the same thing (release close-out: the docs describe what EXISTS).
 *
 * Also: wording the UI no longer has does not come back (「核心已停住 ·
 * 繼續」 without 執行, 「0.1×」 speed options, 「D1 沒有限流電阻」, the retired
 * 「直接送進 USART」 terminal note …), and every picture
 * scripts/docs-shots.mjs takes is a file in docs/images (and the other way
 * round), so a new shot cannot be forgotten in the docs.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import { getEntry } from '../src/model/catalog'
import type { CircuitLayout } from '../src/model/types'
import type { UartRxInfo } from '../src/sim/coordinator/api'
import { runCapsuleText } from '../src/ui/chrome/StatusBar'
import { deletedText, historyStepText } from '../src/ui/chrome/edit-feedback'
import { placementSpotRefusedHint, wireStartHint } from '../src/ui/chrome/hints'
import { meterReading, waveformLiveText } from '../src/ui/embedded/instruments/meter-readout'
import { rxWireNote } from '../src/ui/embedded/instruments/uart-sent'
import { speedOptions, speedRowTitle } from '../src/ui/sheets/MoreSheet'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

/** One section of the user guide (`## n. …` up to the next `## `). */
function section(n: number): string {
  const guide = read('docs/user-guide.md')
  const start = guide.indexOf(`\n## ${n}. `)
  expect(start, `user guide §${n}`).toBeGreaterThan(0)
  const end = guide.indexOf('\n## ', start + 1)
  return guide.slice(start, end < 0 ? undefined : end)
}

/** The capsule as a person reads it: 「執行中 · U1 沒有供電」 (word · time · extra). */
function capsule(c: { word: string; time: string | null; extra: string | null }): string {
  return [c.word, c.time, c.extra].filter((x): x is string => !!x).join(' · ')
}

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => __setLangForTests('zh-TW'))

describe('docs quote the capsule, the pill and the speed row', () => {
  it('§1 and §5 name the halted capsule 「核心已停住 · 繼續執行」', () => {
    const halted = capsule(runCapsuleText('halted', { time: 0, mcuId: 'U1' }))
    expect(halted).toBe('核心已停住 · 繼續執行')
    expect(section(1)).toContain(halted)
    expect(section(5)).toContain(halted)
  })

  it('§5 shows the blocked running states in their words', () => {
    const power = capsule(runCapsuleText('running', { time: 3.11, blocker: { kind: 'power', id: 'U1' } }))
    const fw = capsule(runCapsuleText('running', { time: 3.11, blocker: { kind: 'fw-missing', id: 'U1' } }))
    expect(power).toBe('執行中 · U1 沒有供電')
    expect(fw).toBe('執行中 · U1 還沒有韌體')
    for (const s of [power, fw]) expect(section(5)).toContain(`「${s}」`)
    // …and the README's five-minute tour says the same
    const readme = read('README.md')
    expect(readme).toContain(`「${power}」`)
    expect(readme).toContain(`「${fw}」`)
  })

  it('§5 and §22 name the speed row and its five options', () => {
    const title = speedRowTitle(false)
    const options = speedOptions(false).map((o) => o.label)
    expect(title).toBe('模擬速度（倍速）')
    expect(options).toEqual(['0.1 倍', '0.5 倍', '1 倍', '5 倍', '10 倍'])
    const list = options.join('、')
    expect(section(5)).toContain(`「更多 → 模擬 → ${title}」可選 ${list}`)
    expect(section(22)).toContain(`「${title}」——${list}`)
  })

  it('§6 quotes the ready pill and its button (desktop and touch)', () => {
    const s6 = section(6)
    expect(s6).toContain(`「${t('Circuit ready (Space)')}」，右邊就是〔${t('Run simulation')}〕按鈕`)
    expect(s6).toContain(`（觸控裝置寫「${t('Circuit ready')}」）`)
    expect(read('README.md')).toContain(`「${t('Circuit ready (Space)')}」，旁邊就是〔${t('Run simulation')}〕按鈕`)
  })

  it('§5 quotes the empty-board refusal of ▶', () => {
    expect(section(5)).toContain(`「${t('The breadboard is empty — open an example or place parts first')}」`)
  })

  it('§5 quotes the lockup line the capsule opens 執行狀態 from', () => {
    const line = t('{id} fault (lockup) — see why', { id: 'U1' })
    expect(line).toBe('U1 故障（鎖死）——查看原因')
    expect(section(5)).toContain(`「${line} ›」`)
  })
})

describe('docs quote the wiring and editing feedback', () => {
  const layout: CircuitLayout = { version: 1, components: [], wires: [] }

  it('§4: a wire start on an occupied pin hole moves to a free hole and says so', () => {
    const redirect = wireStartHint({ kind: 'redirect', hole: 'c21', pin: 'U1 PA4', from: 'a21', rail: false }, layout)
    expect(redirect).toBe('c21 被 U1 PA4 佔用，已改從同一排的 a21 拉線')
    expect(section(4)).toContain(`「${redirect}」`)
  })

  it('§3: a refused spot of a leads part names the reason', () => {
    const refused = placementSpotRefusedHint(t('{hole} already holds {what}', { hole: 'j27', what: '導線 W3' }))
    expect(section(3)).toContain(`「${refused}」`)
  })

  it('§3 and §24: the delete and undo / redo toasts', () => {
    const s3 = section(3)
    expect(s3).toContain(`「${deletedText(['PS1'], false)}」`)
    expect(s3).toContain(`「${deletedText(['PS1'], true)}」`)
    const step = t('Delete {names}|history', { names: 'PS1' })
    expect(s3).toContain(`「${historyStepText('undo', step)}」`)
    expect(s3).toContain(`「${historyStepText('redo', step)}」`)
    expect(section(24)).toContain('「點 ↶ 可復原」')
  })
})

describe('§12 quotes the UART terminal’s line under the send box (rxWireNote)', () => {
  const parts = [
    { id: 'U1', type: 'stm32_bluepill' },
    { id: 'CH1', type: 'usb_uart_ch340' },
  ]
  const wire = (port: string, pin: string, state: UartRxInfo['state'], extra: Partial<UartRxInfo> = {}): UartRxInfo => ({
    port,
    pin,
    state,
    attached: false,
    queued: 0,
    ...extra,
  })
  const line = '115 200 Bd · 8N1'

  it('the free, sending and not-set-up cases', () => {
    const s12 = section(12)
    const free = rxWireNote('U1', 'USART1', wire('USART1', 'PA10', 'free'), line, parts)
    expect(free?.canSend).toBe(true)
    expect(s12).toContain(`「${free!.text}」`)
    const sending = rxWireNote('U1', 'USART1', wire('USART1', 'PA10', 'free', { attached: true, queued: 12 }), line, parts)
    expect(sending?.kind).toBe('sending')
    expect(s12).toContain(`「${sending!.text}」`)
    const noBaud = rxWireNote('U1', 'USART1', wire('USART1', 'PA10', 'free'), null, parts)
    expect(noBaud?.canSend).toBe(false)
    expect(s12).toContain(`「${noBaud!.text}」`)
  })

  it('a module-driven RX net: the terminal does not send and offers the module’s port', () => {
    const s12 = section(12)
    const driven = rxWireNote('U1', 'USART2', wire('USART2', 'PA3', 'driven', { by: { componentId: 'CH1', pin: 'TXD', port: 'COM' } }), line, parts)
    expect(driven?.text).toBe('PA3 已由 CH1 的 TXD 驅動，終端機不另外送出')
    expect(driven?.canSend).toBe(false)
    expect(driven?.offer?.label).toBe('改用 CH1 的 COM 埠')
    expect(s12).toContain(`「${driven!.text}」`)
    expect(s12).toContain(`「**${driven!.offer!.label}**」`)
    // the README and the firmware guide tell the same story
    expect(read('README.md')).toContain(`「${driven!.offer!.label}」`)
    expect(read('docs/firmware-guide.md')).toContain(`「${driven!.text}」`)
  })

  it('a rail, an output pin', () => {
    const s12 = section(12)
    const rail = rxWireNote('U1', 'USART1', wire('USART1', 'PA10', 'rail'), line, parts)
    const output = rxWireNote('U1', 'USART1', wire('USART1', 'PA10', 'output'), line, parts)
    for (const n of [rail, output]) {
      expect(n?.canSend).toBe(false)
      expect(s12).toContain(`「${n!.text}」`)
    }
  })

  it('the logic analyzer’s quiet RX lane', () => {
    const note = t('No frames on {pin} yet — send text from the UART terminal: its USB-TTL adapter puts it on this wire as UART frames', { pin: 'PA10' })
    expect(section(12)).toContain(`「${note}」`)
  })

  it('no trace of the retired 「直接送進 USART」 note', () => {
    for (const file of ['README.md', 'docs/user-guide.md', 'docs/firmware-guide.md', 'docs/developer-guide.md']) {
      const text = read(file)
      expect(text, file).not.toContain('直接送進')
      expect(text, file).not.toContain('直接寫進 USART')
      expect(text, file).not.toContain('未經 PA10')
    }
  })
})

describe('docs quote the meters, the generator and the lockup cause', () => {
  it('§8 and §15: an unwired multimeter says what is missing and the next step', () => {
    const entry = getEntry('multimeter')!
    const comp = { id: 'DMM1', type: 'multimeter', params: { mode: 'V' } }
    const r = meterReading(comp, entry, undefined, { version: 1, components: [comp], wires: [] })
    expect(r.value).toBeNull()
    expect(r.unwired).toBe(true)
    expect(r.sub).toBe('探棒未接（DMM1 兩支探棒都還沒接線）——把 COM 接到 GND、IN 接到要量的點')
    expect(section(8)).toContain(`「${r.sub}」`)
    expect(section(15)).toContain(`「${r.sub}」`)
  })

  it('§8: a function generator’s current and power', () => {
    expect(section(8)).toContain(`「${waveformLiveText()}」`)
  })

  it('§9 and §11: the lockup cause names the address and the one-click reload', () => {
    const cause = t('{file} is loaded at {addr}, so there is no vector table at 0x08000000 and the core faults as soon as it starts.', {
      file: 'bare-blink.bin',
      addr: '0x08001000',
    })
    const reload = t('Reload at 0x08000000')
    for (const n of [9, 11]) {
      expect(section(n)).toContain(`「${cause}」`)
      expect(section(n)).toContain(`「**${reload}**」`)
    }
  })

  it('§16: the probe menu’s 「在…中檢視」 for a point already measured', () => {
    const s16 = section(16)
    expect(s16).toContain(`「${t('Show in the logic analyzer ({name})', { name: 'PA6 PWM' })}」`)
    expect(s16).toContain(`「${t('Show in the oscilloscope (CH{n})', { n: 1 })}」`)
  })
})

describe('docs: wording the interface no longer has', () => {
  const STALE: readonly [RegExp, string][] = [
    [/核心已停住 · 繼續(?!執行)/, 'the halted capsule reads 「核心已停住 · 繼續執行」'],
    [/0\.1×|0\.5×、1×|10×）/, 'the speed options read 「0.1 倍 … 10 倍」'],
    [/更多 → 模擬 → 速度」/, 'the speed row is 「模擬速度（倍速）」'],
    [/電路已就緒——按/, 'the pill reads 「電路已就緒（空白鍵）」 with an 〔執行模擬〕 button'],
    [/(?<![A-Z])D1 沒有限流電阻|（「D1」/, 'the shipped examples name the LED LED1'],
    [/（手機：「更多 → 範例」）/, 'on a phone the examples are 「元件 → 範例」'],
    [/在邏輯分析儀中顯示|在示波器中顯示/, 'the probe menu says 「在…中檢視」'],
    [/CH1 · P1 · /, 'scope probes are PRB<n>'],
    [/MCU 核心本身的耗電（IDD/, 'the Blue Pill limit reads 「晶片本身的耗電」'],
  ]
  it.each(['README.md', 'docs/user-guide.md', 'docs/firmware-guide.md'])('%s', (file) => {
    const text = read(file)
    const hits = STALE.filter(([re]) => re.test(text)).map(([, why]) => why)
    expect(hits, `${file}: ${hits.join('; ')}`).toEqual([])
  })

  it('the rules catch the old wording (and leave the new one alone)', () => {
    const old = [
      '「核心已停住 · 繼續」',
      '可選 0.1×、0.5×、1×、5×、10×。',
      '「更多 → 模擬 → 速度」可選',
      '「電路已就緒——按 ▶ 執行模擬（空白鍵）」',
      '標題（例如「D1 沒有限流電阻」）',
      '位置：左側面板的「範例」分頁（手機：「更多 → 範例」）。',
      '「在邏輯分析儀中顯示（PA6 PWM）」',
      '「CH1 · P1 · U1 PA6 網路」',
      'MCU 核心本身的耗電（IDD，72 MHz 時約 20–36 mA）未模擬',
    ]
    old.forEach((s, i) => expect(STALE[i][0].test(s), s).toBe(true))
    const now = '「核心已停住 · 繼續執行」「LED1 沒有限流電阻」「0.1 倍」「模擬速度（倍速）」「在邏輯分析儀中檢視（PA6 PWM）」「CH1 · PRB1 · U1 PA6 網路」2×AA'
    expect(STALE.filter(([re]) => re.test(now)).map(([, why]) => why)).toEqual([])
  })
})

describe('scripts/docs-shots.mjs and docs/images agree', () => {
  it('every picture the script takes is in docs/images, and every image there is one of its pictures', () => {
    const script = read('scripts/docs-shots.mjs')
    const shots = new Set<string>()
    for (const m of script.matchAll(/save\(page, '([a-z0-9-]+)'\)/g)) shots.add(`${m[1]}.jpg`)
    for (const m of script.matchAll(/'([a-z0-9-]+)\.jpg'/g)) shots.add(`${m[1]}.jpg`)
    const images = readdirSync(path.join(ROOT, 'docs/images')).filter((f) => /\.(jpe?g|png)$/i.test(f))
    expect([...shots].sort()).toEqual([...images].sort())
  })

  it('the phone examples picture is shown with §24', () => {
    expect(section(24)).toContain('](images/phone-examples.jpg)')
  })
})
