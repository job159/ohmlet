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
 *
 * Round 5 (+ polish): the auto-run pause line, the short wire-mode hint, the
 * one-time drag tip, the long-press grip chips, the drag-to-wire redirect
 * words, the 「電路說明」 cathode row rendered by explainCircuit on a real
 * SimEngine run, 〔換新〕／〔全部換新〕, the new shortcut rows — and the
 * wording the polish round retired stays gone (ported from the docs
 * stream's scratch quotes-check).
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import { tidyCjkSpaces } from '../src/i18n/tidy'
import { getEntry } from '../src/model/catalog'
import type { CircuitLayout } from '../src/model/types'
import type { UartRxInfo } from '../src/sim/coordinator/api'
import { SimEngine } from '../src/sim/engine'
import { runErc } from '../src/sim/erc'
import '../src/sim/models'
import { SHORTCUTS } from '../src/ui/chrome/ShortcutsSheet'
import { explainCircuit, newExplainHistory, observeTelemetry, type ExplainInput } from '../src/ui/chrome/explain'
import { deriveProblems } from '../src/ui/embedded/problems'
import { runCapsuleText } from '../src/ui/chrome/StatusBar'
import { deletedText, historyStepText } from '../src/ui/chrome/edit-feedback'
import { arrowJoin, placementSpotRefusedHint, wireStartHint } from '../src/ui/chrome/hints'
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

// ------------------------------------------------------------- round 5 (+ polish)

/** §6.1 lives inside §6. */
const s61 = () => {
  const s = section(6)
  return s.slice(s.indexOf('### 6.1'))
}
/** CHANGELOG's round-5 entry (the top entry, up to the round-4 one). */
const r5log = () => read('CHANGELOG.md').split('## 操作簡化')[0]

describe('round 5: docs quote the auto-run, drag-to-wire and damage words', () => {
  it('the pause pill and its 〔繼續執行〕 (§6, README)', () => {
    const paused = t('Simulation paused — editing parts or wires resumes it|autosim')
    expect(paused).toBe('模擬已暫停——改動接線或元件就會自動繼續')
    expect(section(6)).toContain(`「${paused}」，右邊是〔${t('Resume running')}〕按鈕`)
    expect(read('README.md')).toContain(`「${paused}」並附〔${t('Resume running')}〕`)
  })

  it('§4: the short wire-mode hint (mouse and touch), the one-time tip and the grip chips; no retired hint tail', () => {
    expect(section(4)).toContain(`「${t('Wire mode: tap two holes or terminals in turn · Esc to finish')}」`)
    expect(section(4)).toContain(`「${t('Wire mode: tap two holes or terminals in turn · tap “Done” to finish')}」`)
    const tip = t('Tip: hold a hole and drag to another hole to draw a wire')
    expect(tip).toBe('小提示：按住孔位拖到另一個孔位，就能拉線')
    expect(section(4)).toContain(`「${tip}」`)
    expect(r5log()).toContain(`「${tip}」`)
    const grip = tidyCjkSpaces(t('{point} · lift: probe menu / drag: draw a wire', { point: 'a24' }))
    expect(section(4)).toContain(`「${grip}」`)
    expect(r5log()).toContain(`「${grip}」`)
    const gripEnd = t('{point} · lift: probe menu / drag: move this end', { point: '' }).replace(/^\s*·\s*/, '')
    expect(section(4)).toContain(`「${gripEnd}」`)
    for (const txt of [read('docs/user-guide.md'), r5log()]) {
      expect(txt).not.toMatch(/不必切到導線模式」/)
      expect(txt).not.toContain('也可以直接從孔位拖到另一個孔位')
    }
    expect(section(4)).not.toContain('觸控裝置上先選取導線')
  })

  it('§4: the redirect words of a drag that starts or lands on a part’s leg (polish)', () => {
    const chip = tidyCjkSpaces(t('{hole} is taken by {pin} → lands on {free} in the same row', { hole: 'c26', pin: 'R1 第 2 腳', free: 'b26' }))
    expect(chip).toBe('c26 被 R1 第 2 腳佔用 → 接到同一排的 b26')
    expect(section(4)).toContain(`「${chip}」`)
    const landed = t('{free} ({hole} is taken by {pin}, so it lands in the same row)', { free: 'b26', hole: 'c26', pin: 'R1 第 2 腳' })
    expect(section(4)).toContain(`「${tidyCjkSpaces(t('Connected {ends}', { ends: arrowJoin(['a19', landed]) }))}」`)
    const started = t('{free} ({hole} is taken by {pin}, so it starts in the same row)', { free: 'a21', hole: 'c21', pin: 'U1 PA4' })
    expect(section(4)).toContain(`「${tidyCjkSpaces(t('Connected {ends}', { ends: arrowJoin([started, 'e40']) }))}」`)
  })

  it('§5 / §7 / §8: 〔換新〕 on the selection pill, 〔全部換新〕 in the Problems header with its toast', () => {
    const renew = `〔${t('Replace|damaged')}〕`
    expect(section(5)).toContain(renew)
    expect(section(5)).toMatch(/〔換新〕（[^）]*選取膠囊/)
    expect(section(8)).toContain(`${renew}按鈕`)
    expect(section(7)).toContain(`〔${t('Replace all|damaged')}〕`)
    expect(section(7)).toContain(`「${t('Replaced {ids} with new ones|damage', { ids: ['LED1', 'LED2'].join(t(', |damage-list')) })}」`)
  })

  it('§23: the four new 編輯 rows and the footer of the shortcuts sheet', () => {
    for (const id of ['copy', 'cut', 'paste', 'duplicate'] as const) expect(section(23)).toContain(`| ${t(SHORTCUTS[id].label)} |`)
    expect(section(23)).toContain('複製、貼上在輸入框以外都能用；其他編輯用的按鍵要在 3D 畫面上使用')
  })

  it('§22 quotes the 音效 subtitle; §3 the 常用元件 and its fold; §6.1 is 電路說明', () => {
    const sound = t(
      'A chime when a lesson passes or a circuit works, a pop when a part burns, and the mechanical sounds of plugging in parts, wires, buttons, switches and relays',
    )
    expect(section(22)).toContain(`「${sound}」`)
    expect(section(3)).toContain('一聲輕輕的「咻」')
    expect(t('Common parts')).toBe('常用元件')
    expect(section(3)).toContain('「常用元件」')
    expect(t('Fold the common parts')).toBe('收合常用元件')
    expect(section(3)).toContain('可以收合')
    expect(t('Circuit explanation|explain')).toBe('電路說明')
    expect(section(6)).toContain('### 6.1 電路說明')
  })
})

describe('round 5: §6.1 quotes the 「電路說明」 the code renders', () => {
  it('the open-cathode row, from explainCircuit on a real run (PS1 / R1 top+3→a10 / LED1 b10→c20)', () => {
    const layout = {
      version: 1,
      components: [
        { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
        { id: 'R1', type: 'resistor', holes: ['top+3', 'a10'], params: { resistance: 330 } },
        { id: 'LED1', type: 'led', holes: ['b10', 'c20'], params: { color: 'red' } },
      ],
      wires: [
        { id: 'W1', from: 'PS1:+', to: 'top+0' },
        { id: 'W2', from: 'PS1:-', to: 'top-0' },
      ],
    } as unknown as CircuitLayout
    const engine = new SimEngine(layout)
    const history = newExplainHistory()
    for (let i = 0; i < 10; i++) {
      engine.advance(0.1, 1e-3)
      observeTelemetry(history, layout, engine.telemetry())
    }
    const tele = engine.telemetry()
    const findings = runErc(layout, { telemetry: tele, issues: tele.issues })
    const problems = deriveProblems({ layout, findings, issues: tele.issues, firmware: {}, mcus: {}, running: true, simTime: tele.time })
    const e = explainCircuit({ layout, telemetry: tele, phase: 'running', problems, findings, history } as unknown as ExplainInput)
    expect(s61()).toContain(`「${e.lines[0]}」「${e.lines[1]}」`)
  })

  it('the lit line and the lesson-secret line 「LED1 亮著」', () => {
    expect(s61()).toContain(`「${t('{id} is lit: brightness {value}|explain', { id: 'LED1', value: '49 %（9.70 mA）' })}」`)
    expect(s61()).toContain(`「${t('{id} is lit|explain', { id: 'LED1' })}」`)
  })
})

describe('round 5: wording the polish round retired stays gone', () => {
  it('explain refresh, lesson values, card height, search order, preview colour', () => {
    expect(read('docs/user-guide.md')).not.toContain('約 0.2 秒')
    expect(r5log()).not.toContain('約 0.2 秒')
    expect(r5log()).not.toContain('可能直接寫出要你量的數值')
    expect(read('DESIGN.md')).not.toMatch(/at a FIXED height/)
    expect(section(3)).not.toContain('搜尋結果也照這個順序')
    expect(section(3)).toContain('符合程度')
    expect(r5log()).not.toContain('搜尋結果同樣排序')
    expect(r5log()).not.toContain('不依符合程度')
    expect(r5log()).toContain('符合程度')
    expect(r5log()).not.toContain('拖曳預覽一律是黃色')
  })

  it('no stale Run / sound / damage / orbit / explain wording; every Alt gesture carries （Mac：Option）', () => {
    expect(read('README.md')).not.toMatch(/按 ▶ 執行模擬|\*\*3\. ▶ 執行模擬/)
    expect(read('docs/user-guide.md')).not.toMatch(
      /按膠囊的 \*\*▶ 執行模擬\*\*|按 ▶ 執行模擬即可|接線時的輕響|排除原因後修改電路或按「重置模擬」|左鍵拖曳空白處 \||陰極那一排|拉一條導線到/,
    )
    expect(read('docs/firmware-guide.md')).not.toContain('按膠囊的 **▶ 執行模擬**')
    for (const f of ['README.md', 'docs/user-guide.md', 'CHANGELOG.md']) {
      expect(read(f).split('## 操作簡化')[0].match(/Alt(?!（Mac：Option）)/g), f).toBeNull()
    }
  })
})
