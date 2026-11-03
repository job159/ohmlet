/**
 * zh-TW texts of the electrical rule checker (src/sim/erc): every finding
 * message of rules-power / rules-led / rules-live / rules-mcu, plus the rule
 * titles and level semantics of ERC_RULES (exact texts, shown through
 * tText / tMessage).
 *
 * Findings are assembled from fragments (graph.ts rail owners "PS1 +",
 * "U1 3.3 V regulator", endpoint descriptions "PS1 + (5 V)", edge labels
 * "DS1 segment A", listText() lists "A, B and C", catalog labels): the
 * helpers below translate those fragments so a finding reads as one Chinese
 * sentence. Ids, pin names, values with units and datasheet references stay.
 */
import type { MessagePattern } from '../messages'
import { CATALOG } from '../../model/catalog'
import { partTranslation, terminalLabel } from '../parts'
import { listZh, polishNotes, tpl, tr, translates } from './messages-core'

// ---------------------------------------------------------------------------
// fragments
// ---------------------------------------------------------------------------

let labelMap: Map<string, string> | null = null
/** English catalog label → zh-TW label (falls back to the English label). */
export function labelZh(s: string): string {
  if (!labelMap) {
    labelMap = new Map()
    for (const e of Object.values(CATALOG)) {
      const zh = partTranslation(e.type)?.label
      if (zh && !labelMap.has(e.label)) labelMap.set(e.label, zh)
    }
  }
  return labelMap.get(s) ?? s
}

/** graph.ts Rail.by: "PS1 +", "PS1 −", "FG1 gnd", "U1 3.3 V regulator", "U2 output", "FG1 out (peak)" */
export function railByZh(s: string): string {
  let m = /^(\S+) ([\d.]+) V regulator$/.exec(s)
  if (m) return `${m[1]} 的 ${m[2]} V 穩壓器`
  m = /^(\S+) output$/.exec(s)
  if (m) return `${m[1]} 輸出`
  // a supply terminal by its one name (UX helper H1 terminalLabel): "PS1 +" → 「PS1 正端」, "BT1 −" → 「BT1 負端」
  m = /^([A-Za-z]+\d+) ([+−-])$/.exec(s)
  if (m) return terminalLabel(`${m[1]}:${m[2] === '+' ? '+' : '-'}`)
  // the generator's terminals too: "FG1 out (peak)" → 「FG1 輸出端（峰值）」, "FG1 gnd" → 「FG1 接地端」
  m = /^(\S+) (out|gnd)( \(peak\))?$/.exec(s)
  if (m) return `${terminalLabel(`${m[1]}:${m[2]}`)}${m[3] ? '（峰值）' : ''}`
  if (s === 'ground') return '接地'
  return s
}

/** paths.ts / rules-mcu.ts endpoint descriptions */
export function whatZh(s: string): string {
  // the value is H3's (「5.00 V」, 「500 mV」, 「−1.20 V」, 「—」)
  let m = /^(.+) \(((?:[−-]?[\d.]+ [mµk]?V)|—)\)$/.exec(s)
  if (m) return `${railByZh(m[1])}（${m[2]}）`
  m = /^(\S+) (\S+) \(an output powered at (.+)\)$/.exec(s)
  if (m) return `${m[1]} ${m[2]}（以 ${m[3]} 供電的輸出）`
  return railByZh(s)
}

let subModel: Map<string, string> | null = null
/** Board sub-circuit element id ('REG', 'LED_PC13', 'R_USB_DP') → its device model, from the catalog. */
function subcircuitModel(el: string): string | undefined {
  if (!subModel) {
    subModel = new Map()
    for (const e of Object.values(CATALOG)) for (const x of e.subcircuit ?? []) if (!subModel.has(x.id)) subModel.set(x.id, x.model)
  }
  return subModel.get(el)
}

/** A board's own element "U1.REG" → 「U1 板載穩壓器」, "U1.LED_PC13" → 「U1 板載 LED（LED_PC13）」 (IN-20: never a raw "U1.REG"). */
function boardPartZh(id: string, el: string): string {
  const model = subcircuitModel(el)
  if (model === 'ldo') return `${id} 板載穩壓器`
  if (model === 'led') return `${id} 板載 LED（${el}）`
  if (model === 'resistor') return `${id} 板上電阻 ${el}`
  if (model === 'diode') return `${id} 板上二極體 ${el}`
  return `${id} 板上元件 ${el}`
}

/** graph.ts Edge.label: "R1", "U1.R_USB_DP", "DS1 segment A", "Q1 base", "SW1 switch 3" */
export function edgeZh(s: string): string {
  const board = /^([A-Za-z]+\d+)\.(\w+)$/.exec(s)
  if (board) return boardPartZh(board[1], board[2])
  let m = /^(\S+) segment (\S+)$/.exec(s)
  if (m) return `${m[1]} 段 ${m[2]}`
  m = /^(\S+) base$/.exec(s)
  if (m) return `${m[1]} 基極`
  m = /^(\S+) switch (\d+)$/.exec(s)
  if (m) return `${m[1]} 開關 ${m[2]}`
  return s
}

/** rules-power pathWords() items */
function pathItemZh(s: string): string {
  let m = /^(.+) \(closed now\)$/.exec(s)
  if (m) return `${edgeZh(m[1])}（目前閉合）`
  m = /^transistor (.+)$/.exec(s)
  if (m) return `電晶體 ${edgeZh(m[1])}`
  m = /^inductor (.+) \(≈ 0 Ω at DC\)$/.exec(s)
  if (m) return `電感 ${edgeZh(m[1])}（直流下約 0 Ω）`
  m = /^(.+) in A mode \(a 0\.1 Ω shunt\)$/.exec(s)
  if (m) return `A 檔的 ${edgeZh(m[1])}（0.1 Ω 分流電阻）`
  return edgeZh(s)
}

/** rules-power shortFix() */
function shortFixZh(s: string): string {
  if (!s) return ''
  const map: Record<string, string> = {
    'put a load (e.g. a resistor or the input you want to drive) in series with the switch': '在開關上串聯負載（例如電阻或你要驅動的輸入）',
    'put the load between the supply and the transistor': '把負載接在電源與電晶體之間',
    'measure current in series with a load, or switch the meter to V': '量測電流時請與負載串聯，或把電表切到 V 檔',
    'add series resistance — an inductor is a DC short': '加上串聯電阻——電感在直流下等於短路',
  }
  const body = s.replace(/\.$/, '')
  return `${body
    .split('; ')
    .map((x) => map[x] ?? x)
    .join('；')}。`
}

/** rules-led suggestion() */
function suggestionZh(s: string): string {
  if (s === 'Add a series resistor (typically 220 Ω–1 kΩ).') return '請加上串聯電阻（通常為 220 Ω–1 kΩ）。'
  const m = /^Add a series resistor of about (.+) \(≈ \((.+) − (.+)\) \/ (.+)\)\.$/.exec(s)
  if (m) return `請串聯約 ${m[1]} 的電阻（≈ (${m[2]} − ${m[3]}) / ${m[4]}）。`
  return s
}

/** rules-led conditionText(): "when SW1 is closed and with RV1 turned to its end (≈ 0.5 Ω)" */
function condZh(s: string): string {
  if (!s) return ''
  const parts: string[] = []
  const re = /when (.+?) (?:is|are) closed|when (.+?) conducts?|with (.+?) turned to its end \(≈ 0\.5 Ω\)/g
  for (const m of s.matchAll(re)) {
    if (m[1] !== undefined) parts.push(`當 ${listZh(m[1], edgeZh)} 閉合時`)
    else if (m[2] !== undefined) parts.push(`當 ${listZh(m[2], edgeZh)} 導通時`)
    else parts.push(`當 ${listZh(m[3], edgeZh)} 轉到端點時（約 0.5 Ω）`)
  }
  return parts.length ? parts.join('，且') : s
}

const WIRES = (s: string) => {
  const m = /^ through wires? (.+)$/.exec(s)
  return m ? `（經由導線 ${listZh(m[1])}）` : s
}

const FT_ADVICE_EN = 'Use a 5 V-tolerant pin (PA8–PA15, PB3, PB4, PB6–PB15), a level shifter, or a resistor divider (e.g. 10 kΩ / 20 kΩ).'
const FT_ADVICE_ZH = '請改用 5 V 耐受腳位（PA8–PA15、PB3、PB4、PB6–PB15）、電位轉換器，或電阻分壓（例如 10 kΩ / 20 kΩ）。'

/** rules-mcu ` through R1 (10 kΩ)` */
function throughZh(s: string): string {
  const m = /^ through (.+) \((.+)\)$/.exec(s)
  return m ? `（經由 ${edgeZh(m[1])}，${m[2]}）` : s
}

function dividedZh(s: string): string {
  const m = /^ \(the resistors on the pin divide it to ≈ (.+)\)$/.exec(s)
  return m ? `（腳位上的電阻把它分壓到約 ${m[1]}）` : s
}

const PULL_ZH: Record<string, string> = { 'pull-up': '上拉電阻', 'pull-down': '下拉電阻', up: '上拉', down: '下拉' }

// ---------------------------------------------------------------------------
// patterns
// ---------------------------------------------------------------------------

// The LED model's burn rule as every burn sentence states it (src/sim/erc/rules-led.ts
// LED_BURN_RULE / LED_BURN_RULE_WHEN — the junction-temperature model of
// src/sim/devices.ts: 150 °C, or 150 mA held for 1 ms), and in zh-TW.
const LED_BURN_RULE_EN = 'its junction passed about 150 °C, far over its rating for seconds, or more than 150 mA flowed for over 1 ms'
const LED_BURN_RULE_WHEN_EN = 'its junction passes about 150 °C, far over its rating for seconds, or more than 150 mA flows for over 1 ms'
const LED_BURN_RULE_ZH = '電流長時間遠超額定、接面溫度超過約 150 °C，或電流超過 150 mA 達 1 ms 以上'

export const MESSAGES_ZH: MessagePattern[] = [
  // ------------------------------------------------ sentences appended to LED findings
  tpl(
    `«m» The simulation’s LED model has already burned it out (${LED_BURN_RULE_EN}).`,
    (g) => `${tr(g.m)}模擬的 LED 模型已將它燒毀（${LED_BURN_RULE_ZH}）。`,
    (g) => translates(g.m),
  ),
  tpl(
    '«m» The simulation measures «i» through it right now«b?».',
    (g) => `${tr(g.m)}模擬目前量測到流經它的電流為 ${capZh(g.i)}${g.b ? g.b.replace(/^ \(brightness (\d+) %\)$/, '（亮度 $1 %）') : ''}。`,
    (g) => translates(g.m),
  ),

  // ---------------------------------------------------------- rule 1 supply short
  tpl(
    '«id»’s + and − terminals are connected together«via?» — a dead short across the supply («why=the bench supply has no current limit in this simulator|a battery drives its full short-circuit current»). Remove that connection so current must flow through the circuit.',
    (g) =>
      `${g.id} 的 + 與 − 端子連在一起${WIRES(g.via)}——電源被直接短路（${g.why.startsWith('a battery') ? '電池會輸出它全部的短路電流' : '此模擬器中的桌上型電源沒有限流'}）。請移除該連接，讓電流必須流經電路。`,
  ),
  tpl('«s»: nothing limits the current between its + and −. «fix?»', (g) => `${shortTextZh(g.s)}：它的 + 與 − 之間沒有任何限流。${shortFixZh(g.fix)}`),
  tpl(
    '«id»’s «p»–«m» supply is short-circuited right now through «via». «fix?»',
    (g) => `${shortTextZh(`${g.id}’s ${g.p}–${g.m} supply is short-circuited right now through ${g.via}`)}。${shortFixZh(g.fix)}`,
  ),
  tpl(
    '«id»’s «p»–«m» supply is short-circuited whenever «via» conducts. «fix?»',
    (g) => `${shortTextZh(`${g.id}’s ${g.p}–${g.m} supply is short-circuited whenever ${g.via} conducts`)}。${shortFixZh(g.fix)}`,
  ),
  tpl(
    '«id»’s supply pin«s?» «pins» «v!» on the same net as its «gnd» pin«w». Move the wire or lead that joins them (check that the two pins are not in the same breadboard strip).',
    (g) =>
      `${g.id} 的電源腳位 ${listZh(g.pins)} 與它的 ${g.gnd} 腳位位於同一個網路${g.w.includes('whatever') ? '——為它供電的電源已被短路' : '——一旦供電就會使電源短路'}。請移動連接它們的導線或接腳（確認這兩個腳位不在麵包板的同一排）。`,
  ),
  tpl(
    '«id» («v») and «by» are wired so that they force different voltages onto the same net («a» vs «b»): two voltage sources fight through almost 0 Ω. Disconnect one of them — sources may share only their ground.',
    (g) => `${g.id}（${g.v}）與 ${railByZh(g.by)} 的接法會在同一個網路上強加不同的電壓（${g.a} 對 ${g.b}）：兩個電壓源幾乎經由 0 Ω 互相對抗。請斷開其中一個——電源之間只能共用接地。`,
  ),

  // ---------------------------------------------------------- rule 6a supply range
  tpl(
    '«id»’s 3.3 V supply («pin») is at «v=\\S+(?: [mµk]?V)?»«from=(?: from .+?)?» — above the «max» maximum of its MCU. Feed 5 V into the 5V pin (the on-board regulator makes 3.3 V) or set the supply to 3.3 V.',
    (g) =>
      `${g.id} 的 3.3 V 電源（${g.pin}）為 ${g.v}${g.from ? `（來自 ${railByZh(g.from.replace(/^ from /, ''))}）` : ''}——超過其 MCU 的最大值 ${g.max}。請把 5 V 接到 5V 腳位（板載穩壓器會產生 3.3 V），或把電源設為 3.3 V。`,
  ),
  tpl(
    '«id»’s 3.3 V supply is only «v», below the «min» minimum of its MCU: it will not start reliably. Supply 3.3 V to a 3.3 pin or 5 V to the 5V pin.',
    (g) => `${g.id} 的 3.3 V 電源只有 ${g.v}，低於其 MCU 的最小值 ${g.min}：無法可靠地啟動。請供應 3.3 V 到 3.3 腳位，或 5 V 到 5V 腳位。`,
  ),
  tpl(
    '«id» («l») is powered at «v», above its rated «max» maximum supply«r?». Lower the supply or use a part rated for «v2».',
    (g) => `${g.id}（${labelZh(g.l)}）的供電為 ${g.v}，超過其額定最大電源 ${g.max}${ratedZh(g.r)}。請降低電源電壓，或改用額定 ${g.v2} 的元件。`,
  ),
  tpl(
    '«id» («l») is powered at only «v», below its rated «min» minimum«r?»: a real part may not work. Raise the supply to its rated range.',
    (g) => `${g.id}（${labelZh(g.l)}）的供電只有 ${g.v}，低於其額定最小值 ${g.min}${ratedZh(g.r)}：實際元件可能無法運作。請把電源提高到額定範圍內。`,
  ),
  tpl(
    '«id» («l») gets «v» but needs at least «min» to power up — it stays off. Power it from a higher rail.',
    (g) => `${g.id}（${labelZh(g.l)}）只得到 ${g.v}，但至少需要 ${g.min} 才能啟動——它會一直處於關閉狀態。請改由較高電壓的電源軌供電。`,
  ),
  tpl(
    '«w» gets «u» from «by», above the regulator’s «max» maximum input. Use a 5 V supply.',
    (g) => `${regWhatZh(g.w)}從 ${railByZh(g.by)} 得到 ${g.u}，超過穩壓器的最大輸入 ${g.max}。請使用 5 V 電源。`,
  ),
  tpl(
    '«w» gets only «u»: a «vo» regulator needs about «need» («vo2» + «d» dropout), so its output sags to ≈ «sag». «tail»',
    (g) => `${regWhatZh(g.w)}只得到 ${g.u}：${g.vo} 穩壓器需要約 ${g.need}（${g.vo2} + ${g.d} 壓降），因此輸出會降到約 ${g.sag}。${regTailZh(g.tail)}`,
  ),
  tpl(
    '«id»’s supply is reversed: «p» is «v» BELOW «m». Reverse polarity destroys most ICs — swap the two supply connections.',
    (g) => `${g.id} 的電源接反了：${g.p} 比 ${g.m}「低」${g.v}。反接會損壞大多數 IC——請對調兩條電源連線。`,
  ),

  // ---------------------------------------------- rule 8 ground reference / unpowered
  tpl(
    'There is no power source in the circuit, so «l» and «n#» more cannot work. Add a DC power supply (or battery) and wire its + and − terminals to the power rails.',
    (g) => `電路中沒有電源，因此 ${listZh(g.l)} 等 ${g.n} 個以上的元件無法運作。請加入直流電源供應器（或電池），並把它的 + 與 − 端子接到電源軌。`,
  ),
  tpl(
    'There is no power source in the circuit, so «l» cannot work. Add a DC power supply (or battery) and wire its + and − terminals to the power rails.',
    (g) => `電路中沒有電源，因此 ${listZh(g.l)} 無法運作。請加入直流電源供應器（或電池），並把它的 + 與 − 端子接到電源軌。`,
  ),
  tpl(
    '«id»’s − terminal is not connected to the circuit ground«gnd?»: its voltages float relative to the rest of the circuit. Wire «id2»:- to the ground rail (or to another source’s + to stack them).',
    (g) =>
      `${g.id} 的 − 端子沒有連接到電路接地${g.gnd ? g.gnd.replace(/^ \((.+)\)$/, (_x, by: string) => `（${railByZh(by)}）`) : ''}：它的電壓相對於電路其他部分是浮動的。請把 ${g.id2}:- 接到接地軌（或接到另一個電源的 + 以串接）。`,
  ),
  tpl(
    '«id»’s gnd terminal is not connected to the circuit ground: its output has no common reference. Wire «id2»:gnd to the ground rail.',
    (g) => `${g.id} 的接地端子沒有連接到電路接地：它的輸出沒有共同參考點。請把 ${g.id2}:gnd 接到接地軌。`,
  ),
  tpl(
    '«id»’s GND pins are not connected to the circuit ground«fed?»: the board has no return path and cannot run. Wire one of its G pins to the − rail.',
    (g) =>
      `${g.id} 的 GND 腳位沒有連接到電路接地${g.fed ? g.fed.replace(/^, although (.+) (?:is|are) supplied$/, (_x, l: string) => `，雖然 ${listZh(l)} 有供電`) : ''}：開發板沒有回流路徑，無法運作。請把它的其中一個 G 腳位接到 − 電源軌。`,
  ),
  tpl(
    '«id»’s «pin» pin is fed only through «e» from «r»: the board’s supply would collapse under load. Wire «pin2» straight to the supply rail.',
    (g) => `${g.id} 的 ${g.pin} 腳位只經由 ${edgeZh(g.e)} 從 ${railByZh(g.r)} 供電：一有負載，開發板的電源就會崩潰。請把 ${g.pin2} 直接接到電源軌。`,
  ),
  tpl(
    '«id» is not powered: neither its 5V pin nor a 3.3 pin reaches a supply. Wire 5 V to the 5V pin (the on-board regulator makes 3.3 V) or 3.3 V to a 3.3 pin.',
    (g) => `${g.id} 沒有供電：它的 5V 腳位與 3.3 腳位都沒有接到電源。請把 5 V 接到 5V 腳位（板載穩壓器會產生 3.3 V），或把 3.3 V 接到 3.3 腳位。`,
  ),
  tpl(
    '«id»’s «pins» pin«v=s are| is» not connected to the circuit ground (at «at»): the «l» has no return path and will not work. Wire «it» to the − (ground) rail.',
    (g) => `${g.id} 的 ${listZh(g.pins)} 腳位沒有連接到電路接地（位於 ${listZh(g.at)}）：${labelZh(g.l)}沒有回流路徑，無法運作。請把它${g.it === 'them' ? '們' : ''}接到 −（接地）電源軌。`,
  ),
  tpl(
    '«id»’s «pin» pin is fed only through «e» from «r»: the supply would sag as the «l» draws current. Wire «pin2» straight to the + rail.',
    (g) => `${g.id} 的 ${g.pin} 腳位只經由 ${edgeZh(g.e)} 從 ${railByZh(g.r)} 供電：${labelZh(g.l)}汲取電流時電源會下降。請把 ${g.pin2} 直接接到 + 電源軌。`,
  ),
  tpl(
    '«id»’s «pins» pin«v=s are| is» not connected to any supply (at «at»): the «l» is unpowered. Wire «it» to the + rail.',
    (g) => `${g.id} 的 ${listZh(g.pins)} 腳位沒有連接到任何電源（位於 ${listZh(g.at)}）：${labelZh(g.l)}沒有供電。請把它${g.it === 'them' ? '們' : ''}接到 + 電源軌。`,
  ),

  // ----------------------------------------------------------- rule 2 LED current
  tpl(
    '«names» «h!» both leads on the same net («net»), so «it» can never light: a breadboard strip connects its two leads together. Move one lead to a different strip.',
    (g) => `${listZh(g.names, edgeZh)} 的兩支接腳位於同一個網路（${g.net}），因此永遠不會亮：麵包板的同一排會把它的兩支接腳連在一起。請把其中一支接腳移到另一排。`,
  ),
  tpl(
    '«name» sits directly across «ab» with nothing to limit its current: once an LED conducts it has almost no resistance, so the current is limited only by the supply and it burns out. «sug»',
    (g) => `${edgeZh(g.name)} 直接跨接在 ${acrossZh(g.ab)} 之間，沒有任何東西限制電流：LED 一旦導通幾乎沒有電阻，電流只受電源限制，因此會燒毀。${suggestionZh(g.sug)}`,
  ),
  tpl(
    '«name» is driven by «pin» with no current-limiting resistor«c?»: only the pin’s output driver limits the current«est?», which can exceed the LED’s rating and the GPIO’s 25 mA limit. «sug»',
    (g) =>
      `${edgeZh(g.name)} 由 ${g.pin} 直接驅動，沒有限流電阻${g.c ? `（${condZh(g.c.replace(/^ \((.*)\)$/, '$1'))}）` : ''}：只有腳位的輸出驅動器在限制電流${estZh(g.est)}，可能超過 LED 的額定值與 GPIO 的 25 mA 上限。${suggestionZh(g.sug)}`,
  ),
  tpl(
    '«name» hangs on logic output «pin» with no current-limiting resistor«c?»: real logic outputs are not current sources and the LED would be over-driven. «sug»',
    (g) =>
      `${edgeZh(g.name)} 直接接在邏輯輸出 ${g.pin} 上，沒有限流電阻${g.c ? `（${condZh(g.c.replace(/^ \((.*)\)$/, '$1'))}）` : ''}：實際的邏輯輸出不是電流源，LED 會被過度驅動。${suggestionZh(g.sug)}`,
  ),
  tpl(
    '«name» is driven by «w» (peaks at «v») with no series resistor«c?»: only the generator’s 50 Ω output limits the current. «sug»',
    (g) =>
      `${edgeZh(g.name)} 由 ${whatZh(g.w)} 驅動（峰值 ${g.v}），沒有串聯電阻${g.c ? `（${condZh(g.c.replace(/^ \((.*)\)$/, '$1'))}）` : ''}：只有訊號產生器的 50 Ω 輸出在限制電流。${suggestionZh(g.sug)}`,
  ),
  tpl(
    '«name» is connected across «ab» with no current-limiting resistor«c?»: the LED current would only be limited by the supply. «sug»',
    (g) =>
      `${edgeZh(g.name)} 跨接在 ${acrossZh(g.ab)} 之間，沒有限流電阻${g.c ? `（${condZh(g.c.trim())}）` : ''}：LED 電流只會受電源限制。${suggestionZh(g.sug)}`,
  ),
  tpl(
    '«rs» «v!» up to ≈ «i» flow through «name» from «w»«rd=(?: \\(with the driver’s ≈ [^)]* Ω output resistance\\))?» — above its «max» rated continuous current. Use at least «r» in series.',
    (g) =>
      `${listZh(g.rs, resItemZh)} 會讓最多約 ${g.i} 的電流從 ${whatZh(g.w)} 流過 ${edgeZh(g.name)}${g.rd ? g.rd.replace(/^ \(with the driver’s ≈ (.+) Ω output resistance\)$/, '（含驅動器約 $1 Ω 的輸出電阻）') : ''}——超過它的額定連續電流 ${g.max}。請串聯至少 ${g.r} 的電阻。`,
  ),
  tpl(
    `«id» burned out in the simulation (${LED_BURN_RULE_EN}) — its series resistance is too small for the voltage driving it. Use a larger series resistor.`,
    (g) => `${g.id} 在模擬中燒毀（${LED_BURN_RULE_ZH}）——相對於驅動它的電壓，串聯電阻太小。請使用較大的串聯電阻。`,
  ),
  tpl(
    '«name» is wired in reverse: its cathode (−, the short lead / flat side) goes toward «hi» and its anode toward «lo», so it can never light. Swap its two leads.',
    (g) => `${edgeZh(g.name)} 接反了：它的陰極（−，短腳／平邊）朝向 ${whatZh(g.hi)}，陽極朝向 ${whatZh(g.lo)}，因此永遠不會亮。請對調它的兩支接腳。`,
  ),
  tpl(
    '«name» faces «w» the wrong way round: its cathode (−, the short lead / flat side) goes toward «hi» and its anode toward «lo», so it stays dark whenever «w2» drives high. Swap its two leads.',
    (g) =>
      `${edgeZh(g.name)} 的方向和 ${whatZh(g.w)} 相反：陰極（−，短腳／平邊）朝向 ${whatZh(g.hi)}，陽極朝向 ${whatZh(g.lo)}，所以 ${whatZh(g.w2)} 輸出高電位時它不會亮。請對調它的兩支接腳。`,
  ),
  tpl(
    '«id» may be reversed: the long lead (anode) is in «a» and the short lead (cathode) in «k»; the cathode is «v» above the anode, so it cannot light. Swap its two leads.',
    (g) => `${g.id} 可能接反了：長腳（陽極）在 ${g.a}、短腳（陰極）在 ${g.k}；陰極比陽極高 ${g.v}，所以不會亮。請把兩支腳對調。`,
  ),

  // ------------------------------------------------------------ live ratings
  tpl(
    `«id» burned out in the simulation (the LED model latches it as burned when ${LED_BURN_RULE_WHEN_EN}). Add or enlarge its series resistor; a circuit edit puts in a new one (in the workspace, “Replace” and a value change do too).`,
    (g) => `${g.id} 在模擬中燒毀（LED 模型在${LED_BURN_RULE_ZH}時鎖定為燒毀）。請加上或加大串聯電阻，再按〔換新〕；改好電路或數值時也會自動換新。`,
  ),
  tpl(
    '«id» («l») burned out in the simulation (its model latched an over-current). Limit the current through it; a circuit edit puts in a new one (in the workspace, “Replace” and a value change do too).',
    (g) => `${g.id}（${labelZh(g.l)}）在模擬中燒毀（其模型鎖定了過電流狀態）。請限制流經它的電流，再按〔換新〕；改好電路或數值時也會自動換新。`,
  ),
  tpl(
    '«id» («l») carries «i» forward current in the simulation, above its «max» rated continuous current: a real part ages quickly or fails. Increase its series resistor.',
    (g) => `${g.id}（${labelZh(g.l)}）在模擬中的順向電流為 ${capZh(g.i)}，超過其額定連續電流 ${g.max}：實際元件會快速老化或損壞。請加大串聯電阻。`,
  ),
  tpl(
    '«id» («l») dissipates «p» in the simulation, above its «max» rating: a real part would overheat. «fix»',
    (g) =>
      `${g.id}（${labelZh(g.l)}）在模擬中消耗 ${capZh(g.p)}，超過其額定 ${g.max}：實際元件會過熱。${
        g.fix === 'Use a larger resistance or a higher-wattage resistor.' ? '請使用較大的電阻值或較高瓦數的電阻。' : g.fix === 'Reduce the current through it.' ? '請減少流經它的電流。' : g.fix
      }`,
  ),
  tpl(
    '«id» («l») carries «i» in the simulation, above its «max» continuous rating. Reduce the load or use a stronger part.',
    (g) => `${g.id}（${labelZh(g.l)}）在模擬中的電流為 ${capZh(g.i)}，超過其連續額定值 ${g.max}。請減輕負載或改用規格更大的元件。`,
  ),
  tpl(
    `«id»’s on-board LED «el» burned out in the simulation (${LED_BURN_RULE_EN}): something drives its pin with too much current. Check what is wired to «pins».`,
    (g) => `${g.id} 的板載 LED ${g.el} 在模擬中燒毀（${LED_BURN_RULE_ZH}）：有東西以過大的電流驅動它的腳位。請檢查接到 ${g.pins} 的電路。`,
  ),
  tpl(
    '«id»’s on-board LED «el» carries «i» in the simulation, above a typical «max» LED rating.',
    (g) => `${g.id} 的板載 LED ${g.el} 在模擬中的電流為 ${capZh(g.i)}，超過一般 LED 的額定值 ${g.max}。`,
  ),
  tpl(
    '«id»’s «v» regulator is in current limit (≈ «i») in the simulation: the load on «pin» is too heavy or shorted, and the «v2» rail is sagging (now «now»). Remove the overload or power it from a separate supply.',
    (g) => `${g.id} 的 ${g.v} 穩壓器在模擬中進入限流（約 ${g.i}）：${g.pin} 上的負載過重或短路，${g.v2} 電源軌正在下降（目前 ${g.now}）。請移除過載，或改由獨立電源供電。`,
  ),
  tpl(
    '«id»’s «v» regulator is in dropout in the simulation: its input «pin» is at «vin», so the output is only «vout». Feed at least «need» into «pin2»«x=(?:, or .+ directly into a .+ pin)?».',
    (g) =>
      `${g.id} 的 ${g.v} 穩壓器在模擬中進入壓降區：輸入 ${g.pin} 只有 ${g.vin}，因此輸出只有 ${g.vout}。請在 ${g.pin2} 輸入至少 ${g.need}${g.x ? g.x.replace(/^, or (.+) directly into a (.+) pin$/, '，或直接把 $1 接到 $2 腳位') : ''}。`,
  ),
  tpl(
    'The simulation measured «b» «pin» «d=sourcing|sinking» «ma» mA, above the 25 mA per-pin limit: a short or a missing series resistor on «pin2». Add a resistor, or drive the load through a transistor.',
    (g) => `模擬量測到 ${g.b} ${g.pin} ${g.d === 'sourcing' ? '輸出' : '灌入'} ${g.ma} mA，超過每個腳位 25 mA 的上限：${g.pin2} 上短路或缺少串聯電阻。請加上電阻，或經由電晶體驅動負載。`,
  ),
  tpl(
    'The simulation measured more than 2 A from «id» — a short circuit or a very heavy load. Find the low-resistance path (see the supply-short findings) and break it.',
    (g) => `模擬量測到 ${g.id} 輸出超過 2 A——短路或負載過重。請找出低電阻路徑（參考電源短路的檢查結果）並將它斷開。`,
  ),

  // ------------------------------------------- rule 3 GPIO overvoltage / 6b logic level
  tpl(
    '«name» is connected to «w», which goes down to «v» — below the VSS − 0.3 V limit. Keep the signal between 0 V and «vdd» (offset it, or add a clamp / divider).',
    (g) => `${g.name} 接到 ${whatZh(g.w)}，其電壓會降到 ${g.v}——低於 VSS − 0.3 V 的下限。請讓訊號保持在 0 V 到 ${g.vdd} 之間（加上偏移，或加入箝位／分壓電路）。`,
  ),
  tpl(
    '«id» is not powered, yet «pin» is connected to «w» («v»): current flows into the pin and back-powers the chip through its protection structures. Power the board, or disconnect the signal while it is off.',
    (g) => `${g.id} 沒有供電，但 ${g.pin} 接到 ${whatZh(g.w)}（${g.v}）：電流會流入腳位，並經由保護結構反向供電給晶片。請為開發板供電，或在它關閉時斷開訊號。`,
  ),
  tpl(
    `«name» is not 5 V tolerant (limit VDD + 0.3 V = «lim») but is driven to «v» by «w»: its protection diode conducts and current is forced into the chip. «adv»`,
    (g) => `${g.name} 不耐受 5 V（上限 VDD + 0.3 V = ${g.lim}），卻被 ${whatZh(g.w)} 驅動到 ${g.v}：它的保護二極體會導通，電流被強制灌入晶片。${ftAdviceZh(g.adv)}`,
  ),
  tpl(
    `«name» is not 5 V tolerant (limit «lim») but is pulled toward «v» by «w»«th=(?: through .+? \\([^)]*\\))?»«dv=(?: \\(the resistors on the pin divide it to ≈ [^)]*\\))?»: ≈ «i» would be injected into the pin«inj». «adv»`,
    (g) =>
      `${g.name} 不耐受 5 V（上限 ${g.lim}），卻被 ${whatZh(g.w)}${throughZh(g.th)}拉向 ${g.v}${dividedZh(g.dv)}：會有約 ${g.i} 的電流注入腳位${
        g.inj === ', above the ±5 mA injection limit'
          ? '，超過 ±5 mA 的注入電流上限'
          : g.inj === ' (within the ±5 mA injection limit, but outside the operating range and it back-feeds VDD)'
            ? '（在 ±5 mA 注入電流上限內，但超出工作範圍，且會反灌 VDD）'
            : g.inj
      }。${ftAdviceZh(g.adv)}`,
  ),
  tpl(
    '«name» is 5 V tolerant but only up to «max»; «w»«th=(?: through .+? \\([^)]*\\))?» takes it to «v»«ft=(?: — FT pins cannot sink .+)?». Use a divider or level shifter.',
    (g) =>
      `${g.name} 雖可耐受 5 V，但上限只有 ${g.max}；${whatZh(g.w)}${throughZh(g.th)}把它拉到 ${g.v}${
        g.ft ? '——FT 腳位無法吸收正向注入電流，因此電阻無法保護它' : ''
      }。請使用分壓電路或電位轉換器。`,
  ),
  tpl(
    '«name» is 5 V tolerant, but the running firmware enabled its internal pull-«d!» while «w»«th=(?: through .+? \\([^)]*\\))?» takes it to «v»: to sustain more than VDD + 0.3 V the internal pull-up/pull-down must be disabled. Configure the pin with GPIO_NOPULL.',
    (g) =>
      `${g.name} 雖可耐受 5 V，但執行中的韌體啟用了內部${PULL_ZH[g.d] ?? g.d}，而 ${whatZh(g.w)}${throughZh(g.th)}把它拉到 ${g.v}：要承受超過 VDD + 0.3 V 的電壓，必須停用內部上拉／下拉。請以 GPIO_NOPULL 設定此腳位。`,
  ),
  tpl(
    '«name» is 5 V tolerant (FT), so «v» from «w»«th=(?: through .+? \\([^)]*\\))?» is allowed (≤ 5.5 V) — but keep its internal pull-up/pull-down disabled: a pin above VDD + 0.3 V needs GPIO_NOPULL.',
    (g) =>
      `${g.name} 可耐受 5 V（FT），因此來自 ${whatZh(g.w)}${throughZh(g.th)}的 ${g.v} 是允許的（≤ 5.5 V）——但請停用它的內部上拉／下拉：高於 VDD + 0.3 V 的腳位需要 GPIO_NOPULL。`,
  ),
  tpl(
    '«id» («l», powered at «vs») needs at least «vih» on «pin» to read a logic high, but «name» drives at most «vdd=\\S+(?: [mµk]?V)?»«fw=(?: \\(if the firmware uses it as an output\\))?». Use a level shifter (e.g. a 74HCT buffer) or power «id2» from 3.3 V.«b?»',
    (g) =>
      `${g.id}（${labelZh(g.l)}，以 ${g.vs} 供電）的 ${g.pin} 至少需要 ${g.vih} 才會讀為邏輯高電位，但 ${g.name} 最多只能輸出 ${g.vdd}${
        g.fw ? '（如果韌體把它當作輸出）' : ''
      }。請使用電位轉換器（例如 74HCT 緩衝器），或改用 3.3 V 為 ${g.id2} 供電。${g.b ? '（模擬器的行為模型晶片以 0.5·VCC 為切換點，因此在這裡可能看起來仍能運作。）' : ''}`,
  ),
  tpl(
    '«id» «pin» is driven to «v» by «by», above the «max» absolute-maximum input voltage of the «l». Keep its inputs within its supply (e.g. tie them to the part’s own VCC, or use a divider).',
    (g) => `${g.id} ${g.pin} 被 ${railByZh(g.by)} 驅動到 ${g.v}，超過${labelZh(g.l)}的絕對最大輸入電壓 ${g.max}。請讓它的輸入保持在電源範圍內（例如接到元件自己的 VCC，或使用分壓電路）。`,
  ),

  // ------------------------------------------------------------ rule 4 floating inputs
  tpl(
    '«sw» and «l» both connect «name» to «t», so pressing «sw2» changes nothing. Connect «l2» to «x» instead (a «p»).',
    (g) =>
      `${listZh(g.sw, edgeZh)} 與 ${listZh(g.l, edgeZh)} 都把 ${g.name} 接到${g.t === 'ground' ? '接地' : g.t === 'the high rail' ? '高電位電源軌' : g.t}，因此按下 ${listZh(g.sw2, edgeZh)} 不會有任何變化。請改把 ${listZh(g.l2, edgeZh)} 接到 ${g.x}（作為${PULL_ZH[g.p] ?? g.p}）。`,
  ),
  tpl(
    'The firmware enabled «name»’s internal pull-«d!», but «sw» also connects it to «t»: pressing «sw2» changes nothing. Wire «sw3» to «x» instead, or use «mode».',
    (g) =>
      `韌體啟用了 ${g.name} 的內部${PULL_ZH[g.d] ?? g.d}，但 ${listZh(g.sw, edgeZh)} 也把它接到 ${whatZh(g.t)}：按下 ${listZh(g.sw2, edgeZh)} 不會有任何變化。請改把 ${listZh(g.sw3, edgeZh)} 接到 ${g.x}，或使用 ${g.mode}。`,
  ),
  tpl(
    '«name» is a push-pull output in the running firmware, and «sw» connects it to «t»: closing «sw2» while the pin drives the opposite level short-circuits its driver (over the 25 mA pin limit). Configure «pin» as an input with a «p» («mode»), or add a 1 kΩ series resistor.',
    (g) =>
      `${g.name} 在執行中的韌體裡是推挽輸出，而 ${listZh(g.sw, edgeZh)} 把它接到 ${whatZh(g.t)}：腳位輸出相反準位時閉合 ${listZh(g.sw2, edgeZh)} 會使驅動器短路（超過腳位 25 mA 的上限）。請把 ${g.pin} 設為帶${PULL_ZH[g.p] ?? g.p}的輸入（${g.mode}），或串聯一顆 1 kΩ 電阻。`,
  ),
  tpl(
    '«name» is an open-drain output and «sw» connects it to «t»: closing «sw2» while the pin pulls low short-circuits it. Configure «pin» as an input with «mode».',
    (g) => `${g.name} 是開汲極輸出，而 ${listZh(g.sw, edgeZh)} 把它接到 ${whatZh(g.t)}：腳位拉低時閉合 ${listZh(g.sw2, edgeZh)} 會造成短路。請以 ${g.mode} 把 ${g.pin} 設為輸入。`,
  ),
  tpl(
    '«name» is an open-drain output with no pull-up: when it is released and «sw» is open the line floats. Add a pull-up (e.g. 10 kΩ to 3.3 V) or configure the pin with «mode».',
    (g) => `${g.name} 是沒有上拉電阻的開汲極輸出：當它釋放且 ${listZh(g.sw, edgeZh)} 斷開時，線路會浮接。請加上上拉電阻（例如 10 kΩ 接 3.3 V），或以 ${g.mode} 設定此腳位。`,
  ),
  tpl(
    'The running firmware configured «name» as a «k» input (GPIO_NOPULL) and only «sw» connects it to «t»: while «sw2» is open nothing sets its level, so it reads random values. Enable the internal «p» («mode») or add a 10 kΩ resistor from «pin» to «x».',
    (g) =>
      `執行中的韌體把 ${g.name} 設為${g.k === 'analog' ? '類比' : g.k === 'floating' ? '浮接' : g.k}輸入（GPIO_NOPULL），而只有 ${listZh(g.sw, edgeZh)} 把它接到 ${whatZh(g.t)}：${listZh(g.sw2, edgeZh)} 斷開時沒有任何東西決定它的準位，因此會讀到隨機值。請啟用內部${PULL_ZH[g.p] ?? g.p}（${g.mode}），或從 ${g.pin} 加一顆 10 kΩ 電阻到 ${g.x}。`,
  ),
  tpl(
    '«sw» connects «name» to «t», but nothing sets its level while «sw2» is open: unless the firmware enables an internal «p», the input floats and reads random values. Enable the internal «p2» («mode») or add a 10 kΩ resistor from «pin» to «x».',
    (g) =>
      `${listZh(g.sw, edgeZh)} 把 ${g.name} 接到 ${whatZh(g.t)}，但 ${listZh(g.sw2, edgeZh)} 斷開時沒有任何東西決定它的準位：除非韌體啟用內部${PULL_ZH[g.p] ?? g.p}，否則輸入會浮接並讀到隨機值。請啟用內部${PULL_ZH[g.p2] ?? g.p2}（${g.mode}），或從 ${g.pin} 加一顆 10 kΩ 電阻到 ${g.x}。`,
  ),
  tpl(
    '«id» «pin» is only connected to «by» through «sw»: while «sw2» is open the input floats. Add a 10 kΩ «p».',
    (g) =>
      `${g.id} ${g.pin} 只經由 ${listZh(g.sw, edgeZh)} 接到 ${railByZh(g.by)}：${listZh(g.sw2, edgeZh)} 斷開時輸入會浮接。請加一顆 10 kΩ ${g.p === 'pull-down to GND' ? '下拉電阻到 GND' : g.p === 'pull-up to the supply' ? '上拉電阻到電源' : g.p}。`,
  ),

  // ------------------------------------------------------------- rule 5 I²C pull-ups
  tpl(
    '«id» «pin» (I²C «sig») is wired to «name», whose I²C function is «fn»: SDA and SCL look swapped. Connect «sig2» to an MCU pin with an I2Cn_«sig3» function.',
    (g) => `${g.id} ${g.pin}（I²C ${g.sig}）接到 ${g.name}，但該腳位的 I²C 功能是 ${g.fn}：SDA 與 SCL 看起來接反了。請把 ${g.sig2} 接到具有 I2Cn_${g.sig3} 功能的 MCU 腳位。`,
  ),
  tpl(
    'The I²C «sig» line «ends» has no pull-up resistor: SDA and SCL are open-drain, so every device can only pull it low and nothing ever drives it high — the bus cannot work. «fix»',
    (g) =>
      `I²C ${g.sig} 線 ${listZh(g.ends)} 沒有上拉電阻：SDA 與 SCL 是開汲極，每個元件都只能把它拉低，沒有任何東西會把它拉高——匯流排無法運作。${i2cFixZh(g.fix)}`,
  ),
  tpl(
    '«ends» form an I²C «sig» line without a pull-up resistor. If the firmware uses I²C here (the MCU pin then becomes open-drain), nothing drives the line high and the bus cannot work. «fix»',
    (g) =>
      `${listZh(g.ends)} 組成一條沒有上拉電阻的 I²C ${g.sig} 線。如果韌體在此使用 I²C（MCU 腳位會變成開汲極），沒有任何東西會把線路拉高，匯流排無法運作。${i2cFixZh(g.fix)}`,
  ),

  // ------------------------------------------------- rule open-lead (UX wave IN-4)
  tpl(
    '«id»’s cathode («ref») is not connected to anything: the current has no path back to ground, so the LED cannot light. Wire «where» to the − rail«gnd?».',
    (g) => `${g.id} 的陰極（${g.ref}）沒有接到任何東西：電流沒有回到 GND 的路徑，所以 LED 不會亮。請用導線把${openWhereZh(g.where)}接到 − 電源軌${openGndZh(g.gnd)}。`,
  ),
  tpl(
    '«id»’s anode («ref») is not connected to anything: no current can flow into the LED, so it cannot light. Wire «where» to the pin or resistor that should drive it.',
    (g) => `${g.id} 的陽極（${g.ref}）沒有接到任何東西：沒有電流能流進 LED，所以它不會亮。請用導線把${openWhereZh(g.where)}接到要驅動它的腳位或電阻。`,
  ),
  tpl(
    '«id»’s «word» («ref=[^()\\s]+») is not connected to anything: no current flows through this «l». Wire «where» to the rest of the circuit.',
    (g) => `${g.id} 的${leadWordZh(g.word)}（${g.ref}）沒有接到任何東西：這個${labelZh(g.l)}沒有電流流過。請用導線把${openWhereZh(g.where)}接到電路的其他部分。`,
  ),
  tpl(
    '«id» («l») is not wired yet: neither of its leads («a», «b») connects to anything.',
    (g) => `${g.id}（${labelZh(g.l)}）還沒接線：兩支腳（${g.a}、${g.b}）都沒有接到任何東西。`,
  ),
  tpl(
    '«id»’s «word» («ref») goes to «rail», but no supply feeds that rail«src?», «back». «fix»',
    (g) =>
      `${g.id} 的${leadWordZh(g.word)}（${g.ref}）接到${openWhereZh(g.rail)}，但這條電源軌沒有接到電源${g.src ? `（${termZh(g.src.replace(/^ \((.+)\)$/, '$1'))}）` : ''}，${backZh(g.back)}。${railFixZh(g.fix)}`,
  ),
  tpl(
    '«R» carries «what», but no supply feeds it, so nothing on it gets «g=power|a ground». «fix»',
    (g) =>
      `${openWhereZh(g.R.replace(/^The /, 'the '))}接了 ${listZh(g.what, (x) => x.replace(/^wire (\S+)$/, '導線 $1'))}，但沒有接到任何電源，所以接在上面的東西都${g.g === 'power' ? '沒有電' : '沒有接地'}。${railFixZh(g.fix)}`,
  ),

  // ------------------------------------- UX wave IN-8: lone I²C pins, gpio-mode, regulator output short
  tpl(
    '«bus» «sig!» («pin») is open-drain, but its net has no pull-up resistor: add a 4.7 kΩ resistor from SCL and from SDA to 3.3 V.',
    (g) => `${g.bus} ${g.sig}（${g.pin}）設成開汲極，但網路上沒有上拉電阻：請在 SCL、SDA 各加一顆 4.7 kΩ 電阻到 3.3 V。`,
  ),
  tpl(
    '«id» hangs on «name», but the running firmware«fw?» leaves «pin» as «mode=a floating input|an input with pull-up|an input with pull-down|an analog input», so «what=the LED stays dark|nothing drives it». Check which pin the firmware drives — the Pins tab lists every pin’s mode.',
    (g) =>
      `${g.id} 接在 ${g.name}，但目前的韌體${g.fw ? g.fw.replace(/^ \((.+)\)$/, '（$1）') : ''}沒有把 ${g.pin} 設成輸出（現在是${modeWordZh(g.mode)}），所以${g.what === 'the LED stays dark' ? ' LED 不會亮' : '沒有東西驅動它'}。請確認韌體控制的是哪一支腳（「腳位」分頁列出每支腳的模式）。`,
  ),
  tpl(
    'Regulator output shorted: «id» «pin» reaches GND«via?». Remove that connection — a shorted output overheats the regulator and drags its input supply down.',
    (g) => `穩壓輸出短路：${g.id} 的 ${g.pin}${WIRES(g.via)}接到 GND。請移除這個連接——輸出短路會讓穩壓器過熱，並把它的輸入電源拉低。`,
  ),
  // references (ErcFinding.ref, shown under 「詳細」)
  tpl(
    'DS5319 Table 7 (25 mA per pin); the estimate uses the simulator’s «r#» Ω pin model',
    (g) => `DS5319 表 7（每支腳 25 mA）；估計值依模擬器的 ${g.r} Ω 腳位模型計算`,
  ),
  tpl('XC6206 ("662K") data sheet', () => 'XC6206（「662K」）資料手冊'),
  tpl('«ref=DS5319 Tables? [0-9][0-9 and]*(?: note \\d+)?|NXP UM10204 §[\\d.]+|RM0008 §[\\d.]+»', (g) => refZh(g.ref)),
  tpl('DS5319 Table 7 (25 mA per pin)', () => 'DS5319 表 7（每支腳 25 mA）'),
  tpl('«id» on «pin»: not an output', (g) => `${g.id} 接在 ${g.pin}，但 ${g.pin} 不是輸出`),
  tpl('«id» on «pin»: the firmware is not running', (g) => `${g.id} 接在 ${g.pin}，但韌體沒有在執行`),
  tpl(
    '«id» hangs on «name», but «b» runs its ROM bootloader (BOOT0 = 1), not your firmware, so nothing drives «pin». Set BOOT0 back to 0 and reset the MCU.',
    (g) => `${g.id} 接在 ${g.name}，但 ${g.b} 執行的是 ROM 開機程式（BOOT0 = 1），不是你的韌體，所以沒有東西驅動 ${g.pin}。請把 BOOT0 設回 0 再重置 MCU。`,
  ),
  tpl('«id» «pin» shorted to GND', (g) => `${g.id} 的 ${g.pin} 對地短路`),

  // ------------------------------------- short headlines (ErcFinding.short, IN-3)
  tpl('«id» on-board LED burned out', (g) => `${g.id} 的板載 LED 已燒毀`),
  tpl('«id» on-board LED current too high', (g) => `${g.id} 的板載 LED 電流過大`),
  tpl('«id» + and − shorted', (g) => `${g.id} 的 + 與 − 短路`),
  tpl('«id» may be shorted', (g) => `${g.id} 可能短路`),
  tpl('«id» supply pins tied to GND', (g) => `${g.id} 的電源腳接到 GND`),
  tpl('«id» supply shorted', (g) => `${g.id} 電源短路`),
  tpl('«id» supply may be shorted', (g) => `${g.id} 電源可能短路`),
  tpl('«a» and «b» fight over one net', (g) => `${g.a} 與 ${g.b} 在同一網路互相衝突`),
  tpl('«id» supply too low to start', (g) => `${g.id} 電壓不足，無法啟動`),
  tpl('«id» supply too high', (g) => `${g.id} 電源電壓過高`),
  tpl('«id» supply too low', (g) => `${g.id} 電源電壓太低`),
  tpl('«id» regulator input too high', (g) => `${g.id} 穩壓器輸入過高`),
  tpl('«id» regulator input too low', (g) => `${g.id} 穩壓器輸入太低`),
  tpl('«id» supply reversed', (g) => `${g.id} 電源接反了`),
  tpl('No power source', () => '電路中沒有電源'),
  tpl('«id» has no common ground', (g) => `${g.id} 沒有共地`),
  tpl('«id» GND not connected', (g) => `${g.id} 的 GND 沒接`),
  tpl('«id» fed through «e»', (g) => `${g.id} 只經由 ${edgeZh(g.e)} 供電`),
  tpl('«id» has no power', (g) => `${g.id} 沒有供電`),
  tpl('«n»: both leads in one strip', (g) => `${listZh(g.n, edgeZh)} 兩腳插在同一排`),
  tpl('«id» burned out', (g) => `${g.id} 已燒毀`),
  tpl('«n» has no series resistor', (g) => `${edgeZh(g.n)} 沒有限流電阻`),
  tpl('«n» series resistor too small', (g) => `${edgeZh(g.n)} 的限流電阻太小`),
  tpl('«n» is reversed', (g) => `${edgeZh(g.n)} 接反了`),
  tpl('«n» below 0 V', (g) => `${g.n} 低於 0 V`),
  tpl('«n» back-powers «id»', (g) => `${g.n} 反向供電給 ${g.id}`),
  tpl('«n» voltage too high', (g) => `${g.n} 電壓過高`),
  tpl('«n»: turn off the internal pull', (g) => `${g.n} 需關閉內部上下拉`),
  tpl('«n» gets 5 V (FT pin)', (g) => `${g.n} 接到 5 V（FT 腳）`),
  tpl('«n» needs a higher logic level', (g) => `${g.n} 需要更高的邏輯準位`),
  tpl('«n» above its maximum input', (g) => `${g.n} 超過最大輸入電壓`),
  tpl('«n»: the pull goes the wrong way', (g) => `${g.n} 的上下拉方向錯了`),
  tpl('«n»: the button can short the output', (g) => `${g.n}：按鈕會讓輸出短路`),
  tpl('«n»: open-drain without a pull', (g) => `${g.n} 開汲極卻沒有上拉`),
  tpl('«n» input is floating', (g) => `${g.n} 輸入浮接`),
  tpl('I²C SDA and SCL swapped', () => 'I²C 的 SDA 與 SCL 接反了'),
  tpl('«bus» «sig!» has no pull-up', (g) => `${g.bus} ${g.sig} 沒有上拉電阻`),
  tpl('«id» current above its rating', (g) => `${g.id} 電流超過額定`),
  tpl('«id» power above its rating', (g) => `${g.id} 功率超過額定`),
  tpl('«id» regulator in current limit', (g) => `${g.id} 穩壓器正在限流`),
  tpl('«id» regulator in dropout', (g) => `${g.id} 穩壓器壓降不足`),
  tpl('«n» over 25 mA', (g) => `${g.n} 超過 25 mA`),
  tpl('«id» supplies more than 2 A', (g) => `${g.id} 輸出超過 2 A`),
  tpl('«id» not wired yet', (g) => `${g.id} 還沒接線`),
  tpl('«id» may be reversed', (g) => `${g.id} 可能接反了`),
  tpl('«side=top|bottom» «pol=[+−]» rail has no supply', (g) => `${g.side === 'top' ? '上方' : '下方'} ${g.pol} 電源軌沒有接電源`),
  tpl('«g» has no clock: «pin» is not driven', (g) => `${g.g} 沒有開時脈——${g.pin} 沒有被驅動`),
  tpl(
    'The firmware writes to «g», but «g2»’s clock is off (RCC_APB2ENR.«bit» = 0), so the writes are ignored and «pin» stays a floating input. Call __HAL_RCC_«g3»_CLK_ENABLE() first.',
    (g) =>
      `韌體寫入 ${g.g} 時，${g.g2} 的時脈沒有打開（RCC_APB2ENR.${g.bit} = 0），寫入被忽略，所以 ${g.pin} 一直是浮接輸入。請先呼叫 __HAL_RCC_${g.g3}_CLK_ENABLE()。`,
  ),
  tpl('«id» «w=anode|cathode|lead \\d+» not connected', (g) => `${g.id} ${leadWordZh(g.w)}沒接`),
  tpl('«id» «w=anode|cathode|lead \\d+» on an unfed rail', (g) => `${g.id} ${leadWordZh(g.w)}的電源軌沒接電`),
]

/** "DS5319 Tables 7 and 9 note 3" → 「DS5319 表 7 與 9 註 3」; "NXP UM10204 §3.1.1" / "RM0008 §7.3.7" stay. */
function refZh(s: string): string {
  return s
    .replace(/ Tables? /, ' 表 ')
    .replace(/ and /g, ' 與 ')
    .replace(/ note (\d+)$/, ' 註 $1')
}

/** "PS1:-" → 「PS1 負端」 (UX helper H1 terminal wording). */
function termZh(s: string): string {
  return terminalLabel(s)
}

/** rules-open floating-rail consequence */
function backZh(s: string): string {
  if (s === 'so the current cannot get back') return '所以電流回不去'
  if (s === 'so no current can flow into the LED') return '所以沒有電流能流進 LED'
  const m = /^so no current flows through this (.+)$/.exec(s)
  return m ? `所以這個${labelZh(m[1])}沒有電流流過` : s
}

/** rules-open railFix(): "Wire the top − rail to the bottom − rail, or straight to PS1:-." */
function railFixZh(s: string): string {
  let m = /^Wire (the (?:top|bottom) [+−] rail) to (the (?:top|bottom) [+−] rail), or straight to (\S+)\.$/.exec(s)
  if (m) return `請用導線把${openWhereZh(m[1])}接到${openWhereZh(m[2])}，或直接接到 ${termZh(m[3])}。`
  m = /^Wire (the (?:top|bottom) [+−] rail) to (the (?:top|bottom) [+−] rail)\.$/.exec(s)
  if (m) return `請用導線把${openWhereZh(m[1])}接到${openWhereZh(m[2])}。`
  m = /^Wire (the (?:top|bottom) [+−] rail) straight to (\S+)\.$/.exec(s)
  if (m) return `請用導線把${openWhereZh(m[1])}直接接到 ${termZh(m[2])}。`
  m = /^Wire (the (?:top|bottom) [+−] rail) to a supply’s ([+−]) terminal\.$/.exec(s)
  if (m) return `請用導線把${openWhereZh(m[1])}接到電源的 ${m[2]} 端。`
  return s
}

/** rules-live fmtLiveA / fmtLiveW caps: '> 2 A (short circuit)' → '> 2 A（短路）' */
function capZh(s: string): string {
  const tail = ' (short circuit)'
  return s.endsWith(tail) ? `${s.slice(0, -tail.length)}（短路）` : s
}

/** rules-mcu UNDRIVEN_MODES (gpio-mode) */
function modeWordZh(s: string): string {
  const map: Record<string, string> = {
    'a floating input': '浮接輸入',
    'an input with pull-up': '上拉輸入',
    'an input with pull-down': '下拉輸入',
    'an analog input': '類比輸入',
  }
  return map[s] ?? s
}

/** rules-open whereWord(): "column 38 (the a–e strip)" / "the top − rail" */
function openWhereZh(s: string): string {
  let m = /^column (\d+) \(the (a–e|f–j) strip\)$/.exec(s)
  if (m) return `第 ${m[1]} 欄（${m[2]} 這一排）`
  m = /^the (top|bottom) ([+−]) rail$/.exec(s)
  if (m) return `${m[1] === 'top' ? '上方' : '下方'} ${m[2]} 電源軌`
  return s
}

/** rules-open cathode fix: " or the G pin of the Blue Pill (U1)" / " or a GND pin of U1" */
function openGndZh(s: string): string {
  if (!s) return ''
  let m = /^ or the G pin of the Blue Pill \((\S+)\)$/.exec(s)
  if (m) return `或 Blue Pill（${m[1]}）的 G 腳`
  m = /^ or a GND pin of (\S+)$/.exec(s)
  if (m) return `或 ${m[1]} 的 GND 腳`
  return s
}

/** rules-open leadWord(): anode / cathode / "cathode (banded end)" / "lead 2" */
function leadWordZh(s: string): string {
  if (s === 'anode') return '陽極'
  if (s === 'cathode') return '陰極'
  if (s === 'cathode (banded end)') return '陰極（色環端）'
  const m = /^lead (\d+)$/.exec(s)
  if (m) return `第 ${m[1]} 腳`
  return s
}

/** rules-power pathWords().text: "PS1 is short-circuited right now through SW1 (closed now)" */
function shortTextZh(s: string): string {
  const subj = (x: string) => x.replace(/^(\S+)’s (\S+)–(\S+) supply$/, '$1 的 $2–$3 電源')
  let m = /^(.+) is short-circuited right now through (.+)$/.exec(s)
  if (m) {
    const via = listZh(m[2], pathItemZh)
    return `${subj(m[1])} 目前經由 ${via}${via.endsWith('）') ? '' : ' '}被短路`
  }
  m = /^(.+) is short-circuited whenever (.+) conducts$/.exec(s)
  if (m) return `只要 ${listZh(m[2], pathItemZh)} 導通，${subj(m[1])} 就會被短路`
  return s
}

/** rules-led `${up.what} and ${down.what}` */
function acrossZh(s: string): string {
  const i = s.lastIndexOf(' and ')
  return i < 0 ? whatZh(s) : `${whatZh(s.slice(0, i))} 與 ${whatZh(s.slice(i + 5))}`
}

function ftAdviceZh(s: string): string {
  return s === FT_ADVICE_EN ? FT_ADVICE_ZH : s
}

/** rules-mcu I²C `fix` */
function i2cFixZh(s: string): string {
  const m = /^Add a pull-up resistor \(typically 4\.7 kΩ\) from this (\S+) line to 3\.3 V — one on SDA and one on SCL\.$/.exec(s)
  return m ? `請從這條 ${m[1]} 線加一顆上拉電阻（通常 4.7 kΩ）到 3.3 V——SDA 與 SCL 各一顆。` : s
}

function ratedZh(s: string): string {
  const m = /^ \(rated (.+)–(.+)\)$/.exec(s)
  return m ? `（額定 ${m[1]}–${m[2]}）` : s
}

/** rules-power regulator subject: "U1’s 5V pin (3.3 V regulator input)" / "U2’s input" */
function regWhatZh(s: string): string {
  let m = /^(\S+)’s (\S+) pin \((.+) regulator input\)$/.exec(s)
  if (m) return `${m[1]} 的 ${m[2]} 腳位（${m[3]} 穩壓器輸入）`
  m = /^(\S+)’s input$/.exec(s)
  if (m) return `${m[1]} 的輸入`
  return s
}

function regTailZh(s: string): string {
  if (s === 'Raise the input voltage.') return '請提高輸入電壓。'
  const m = /^Feed (.+) straight into a (.+) pin instead, or 5 V into (.+)\.$/.exec(s)
  if (m) return `請改把 ${m[1]} 直接接到 ${m[2]} 腳位，或把 5 V 接到${m[3] === 'the input' ? '輸入' : ` ${m[3]}`}。`
  return s
}

function estZh(s: string): string {
  let m = /^ \(≈ (.+) with the simulator’s (\d+) Ω pin model\)$/.exec(s)
  if (m) return `（以模擬器的 ${m[2]} Ω 腳位模型計算約 ${m[1]}）`
  m = /^ \(≈ (.+)\)$/.exec(s)
  return m ? `（約 ${m[1]}）` : s
}

/** "R1 (220 Ω)" */
function resItemZh(s: string): string {
  const m = /^(.+) \((.+)\)$/.exec(s)
  return m ? `${edgeZh(m[1])}（${m[2]}）` : edgeZh(s)
}

// ---------------------------------------------------------------------------
// exact texts: ERC_RULES titles and level semantics
// ---------------------------------------------------------------------------

export const NOTES_ZH: Record<string, string> = polishNotes({
  'Supply short': '電源短路',
  'a source’s + and − (or a board’s 3V3/5V and GND) share a net, or two sources of different voltage drive one net':
    '電源的 + 與 −（或開發板的 3V3/5V 與 GND）位於同一個網路，或兩個不同電壓的電源驅動同一個網路',
  'they are joined only through a switch, button, transistor, inductor or an A-mode meter (a short whenever it conducts)':
    '兩者只經由開關、按鈕、電晶體、電感或 A 檔電表相連（一導通就短路）',
  'LED current limit': 'LED 限流',
  'an LED sits directly across a supply with nothing limiting its current, its leads are shorted together, the simulation burned it out, or the running simulation shows its cathode above its anode with no current (reversed)':
    'LED 直接跨接在電源上而沒有任何限流、兩支接腳被短路、在模擬中已燒毀，或執行中的模擬顯示陰極比陽極高且沒有電流（接反了）',
  'an LED is driven by a GPIO / logic output / generator, or through a switch, transistor or potentiometer, with no fixed resistor; the series resistor is too small; or an LED is wired in reverse between two rails and can never light':
    'LED 由 GPIO／邏輯輸出／訊號產生器驅動，或經由開關、電晶體、可變電阻驅動，而沒有固定電阻；串聯電阻太小；或 LED 反接在兩條電源軌之間，永遠不會亮',
  'an LED faces a GPIO pin the wrong way round (confirmed once the simulation shows the pin driving it)':
    'LED 朝向 GPIO 腳位的方向接反了（模擬顯示腳位驅動它時即確認）',
  'GPIO overvoltage': 'GPIO 過電壓',
  'a non-5 V-tolerant MCU pin is tied to a rail above VDD + 0.3 V (or pulled there through a resistor injecting more than 5 mA), an FT pin goes above 5.5 V, or any pin below VSS − 0.3 V (DS5319 Tables 7 and 9)':
    '不耐受 5 V 的 MCU 腳位接到高於 VDD + 0.3 V 的電源軌（或經由電阻被拉過去且注入超過 5 mA）、FT 腳位超過 5.5 V，或任何腳位低於 VSS − 0.3 V（DS5319 Table 7 與 9）',
  'the high voltage reaches the pin through a resistor within the 5 mA injection limit, an FT pin above VDD + 0.3 V has its internal pull enabled by the firmware, or the MCU is unpowered while a pin is driven':
    '高電壓經由電阻到達腳位但注入電流在 5 mA 上限內、韌體啟用了高於 VDD + 0.3 V 之 FT 腳位的內部上拉／下拉，或 MCU 未供電時腳位被驅動',
  '5 V on a 5 V-tolerant (FT) pin: allowed, but the internal pull-up/down must stay disabled (DS5319 Table 9 note 3)':
    '5 V 耐受（FT）腳位上的 5 V：允許，但內部上拉／下拉必須保持停用（DS5319 Table 9 註 3）',
  'Floating input': '浮接輸入',
  'a button/switch connects an input to a rail and nothing pulls it the other way while open (cleared when the running firmware enables the matching internal pull); also a pull in the same direction as the switch, or a switch on a push-pull output':
    '按鈕／開關把輸入接到電源軌，而斷開時沒有任何東西把它拉往另一個方向（執行中的韌體啟用對應的內部上拉／下拉後即解除）；另外包括與開關同方向的上拉／下拉，或接在推挽輸出上的開關',
  'I²C pull-ups': 'I²C 上拉電阻',
  'an I²C SDA/SCL net with only open-drain ends and no pull-up resistor to a rail': 'I²C SDA/SCL 網路只有開汲極端點，且沒有接到電源軌的上拉電阻',
  'an I²C device pin on an MCU pin with no pull-up when the firmware is unknown, or SDA/SCL look swapped': '在韌體未知的情況下，I²C 元件腳位接到沒有上拉電阻的 MCU 腳位，或 SDA/SCL 看起來接反了',
  'Supply range': '電源範圍',
  'a part’s supply is above its rated maximum or reversed, a regulator input is above its rated maximum, or a logic device gets less than its model needs to power up':
    '元件的電源超過額定最大值或接反、穩壓器輸入超過額定最大值，或邏輯元件得到的電壓低於其模型啟動所需',
  'a part’s supply is below its rated minimum, or a regulator input is too low to regulate': '元件的電源低於額定最小值，或穩壓器輸入太低而無法穩壓',
  'Logic levels': '邏輯準位',
  'a 5 V output drives a non-5 V-tolerant 3.3 V MCU pin, or a chip input is driven above its absolute-maximum input voltage':
    '5 V 輸出驅動不耐受 5 V 的 3.3 V MCU 腳位，或晶片輸入被驅動到超過其絕對最大輸入電壓',
  'the same through a resistor, or a 3.3 V output drives a 5 V CMOS input whose VIH is above 3.3 V': '同上但經由電阻，或 3.3 V 輸出驅動 VIH 高於 3.3 V 的 5 V CMOS 輸入',
  'a 5 V output drives a 5 V-tolerant (FT) pin': '5 V 輸出驅動 5 V 耐受（FT）腳位',
  // (the t() texts are in words.ts; the same wording here for tMessage)
  'Over rating': '超出額定',
  'the simulation’s own model reports the part destroyed (an LED or RGB die burned out, a resistor burned open, an electrolytic capacitor vented); or, before Run, a polarized capacitor sits reversed by more than 1 V between two rails, so it will vent once powered':
    '模擬模型回報元件已損毀（LED 或 RGB LED 的晶粒燒毀、電阻燒斷、電解電容爆開）；或在執行前就看得出：有極性（電解）電容反接在兩條電源軌之間超過 1 V，一通電就會爆開',
  'measured power/current above the part’s rating, a regulator in current limit or dropout, or a GPIO driver above 25 mA':
    '量測到的功率／電流超過元件額定值、穩壓器進入限流或壓降區，或 GPIO 驅動器超過 25 mA',
  'Ground reference': '接地參考',
  'a chip’s or board’s GND pin is not connected to the circuit ground': '晶片或開發板的 GND 腳位沒有連接到電路接地',
  'a second source or the function generator has no common ground with the circuit': '第二個電源或函數產生器與電路沒有共同接地',
  Unpowered: '未供電',
  'there is no power source, or a chip’s / board’s supply pin reaches no source': '沒有電源，或晶片／開發板的電源腳位沒有接到任何電源',
  'a supply pin is fed only through a resistor or other element': '電源腳位只經由電阻或其他元件供電',
  // UX wave rules (rules-open.ts IN-4, rules-mcu.ts gpio-mode IN-8)
  'Unconnected lead': '腳沒接',
  'one lead of a two-terminal part connects to nothing while the other is wired, or only to a power rail that no supply feeds (risk while the simulation runs)':
    '兩腳元件的一支腳沒有接到任何東西（或只接到沒有電源的電源軌），另一支卻有接線（模擬執行中為風險）',
  'the same before running, or a part placed but not wired yet': '執行前的同一情況，或元件已放上但還沒接線',
  'Pin not driven (live)': '腳位沒有被驅動（即時）',
  'Unpowered rail': '電源軌沒有接電源',
  'a power rail carries parts or wires, but no supply feeds it': '電源軌上接了元件或導線，卻沒有任何電源供電',
  'an LED, buzzer or transistor base hangs only on an MCU pin that the running firmware left as an input':
    'LED、蜂鳴器或電晶體基極只接在一支 MCU 腳位上，而執行中的韌體把這支腳設成輸入',
})
