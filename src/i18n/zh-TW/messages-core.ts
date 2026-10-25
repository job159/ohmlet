/**
 * zh-TW runtime messages of the simulation core (see ../messages.ts):
 * the analog engine and netlist, device / digital models (relay, AT24C02,
 * 74HC595, device-chip adapter, logic nets), the Simulation Coordinator,
 * the MCU board adapter, the simulation worker host, the firmware-contract
 * runner (checks / stimulus), the embedded-lab store, project files, the
 * layout validator and the store's board-size errors.
 *
 * Also exports the small toolkit the other messages-*.ts files use:
 *   tpl(template, fmt, accept?)  anchored pattern from a template with
 *                                «name» placeholders («n#» number, «w!» one
 *                                token, «o?» optional text, «x=a|b» explicit
 *                                alternatives); `accept` makes the pattern
 *                                DECLINE a match (so a later pattern can try)
 *   tr(s)                        nested translation (tMessage)
 *   errZh(s)                     String(err) → translated message
 *   listZh(s)                    "A, B and C" → "A、B 與 C"
 *
 * Ids, pin names, numbers, units, hex values and register names are kept
 * verbatim; Chinese sentences use full-width punctuation.
 */
import { tMessage } from '../messages'
import type { MessagePattern } from '../messages'
import { partTranslation } from '../parts'

// ---------------------------------------------------------------------------
// toolkit
// ---------------------------------------------------------------------------

export type Groups = Record<string, string>

// The toolkit below is called at module-evaluation time by the other
// messages-*.ts files, which import this module while ../messages.ts (which
// this module imports) may still be initializing: it therefore uses only
// hoisted function declarations and literals — no module-level const/class
// (those would still be in their temporal dead zone in such an import cycle).

/**
 * A RegExp that declines a match unless `accept(m)` holds. String#match and
 * RegExp#test both go through exec(), so tMessage / hasMessageTranslation
 * simply move on to the next pattern.
 */
export function guarded(re: RegExp, accept: (m: RegExpExecArray) => boolean): RegExp {
  const g = new RegExp(re.source, re.flags)
  const exec = g.exec.bind(g)
  g.exec = (s: string): RegExpExecArray | null => {
    const m = exec(s)
    return m && accept(m) ? m : null
  }
  return g
}

/** Template with «name» placeholders → anchored regex with named groups. */
export function compileTemplate(template: string): RegExp {
  const special = /[.*+?^${}()|[\]\\]/g
  const num = String.raw`[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?`
  let src = '^'
  let last = 0
  for (const m of template.matchAll(/«(\w+)(?:([#!?*])|=([^»]+))?»/g)) {
    src += template.slice(last, m.index).replace(special, '\\$&')
    const [, name, kind, alt] = m
    const body = alt ?? (kind === '#' ? num : kind === '!' ? String.raw`\S+` : kind === '?' ? '.*?' : kind === '*' ? '.*' : '.+?')
    src += `(?<${name}>${body})`
    last = (m.index ?? 0) + m[0].length
  }
  src += template.slice(last).replace(special, '\\$&') + '$'
  return new RegExp(src, 's')
}

export function tpl(template: string, fmt: (g: Groups) => string, accept?: (g: Groups) => boolean): MessagePattern {
  const re = compileTemplate(template)
  return [accept ? guarded(re, (m) => accept(m.groups ?? {})) : re, (m) => polishZh(fmt(m.groups ?? {}))]
}

/**
 * Final touch on every Chinese output: datasheet table citations read
 * '表 9' ('DS5319 Table 9' → 'DS5319 表 9', 'Tables 7 and 9' → '表 7 與 9');
 * a board label ending in Latin letters keeps a space before 麵包板.
 */
export function polishZh(s: string): string {
  return s
    .replace(/\bTables (\d+) and (\d+)\b/g, '表 $1 與 $2')
    .replace(/\bTable (\d+)\b/g, '表 $1')
    .replace(/(XL(?: ×\d+)?)麵包板/g, '$1 麵包板')
}

/** polishZh over an exact-text table. */
export function polishNotes(notes: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(notes)) out[k] = polishZh(v)
  return out
}

/** Nested translation of an embedded message fragment. */
export function tr(s: string): string {
  return s ? tMessage(s) : s
}

/** Whether a fragment has a translation (guards for wrapper patterns). */
export function translates(s: string): boolean {
  return !!s && tMessage(s) !== s
}

/**
 * A measured current in mA inside a message (UX wave STU-14): thin-space
 * thousands grouping, and a solver value beyond 2 A — a burned-out part's
 * 267 295 mA — reads as what it means, 「> 2 A（短路）」.
 */
export function maZh(n: string): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return `${n} mA`
  if (Math.abs(v) > 2000) return '> 2 A（短路）'
  return `${String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009')} mA`
}

/** `String(err)` → translated message ("Error: " / "RangeError: " prefixes dropped). */
export function errZh(s: string): string {
  const m = /^(?:[A-Z]\w*Error|BusFault): ([\s\S]*)$/.exec(s)
  return tr(m ? m[1] : s)
}

/**
 * JSON.parse SyntaxError text → zh (V8 — Chromium / Edge / Node — in detail;
 * SpiderMonkey and JavaScriptCore by line / column). The quoted input
 * snippet V8 adds is file content, not UI, and is dropped.
 */
export function jsonErrZh(s: string): string {
  const at = (x: string): string => {
    const m = /at position (\d+)(?: \(line (\d+) column (\d+)\))?/.exec(x)
    return m ? (m[2] ? `，位於第 ${m[2]} 行第 ${m[3]} 欄` : `，位於位置 ${m[1]}`) : ''
  }
  let m = /^Unexpected token '(.+?)', .* is not valid JSON$/s.exec(s)
  if (m) return `非預期的字元 '${m[1]}'`
  if (s === 'Unexpected end of JSON input') return 'JSON 內容意外結束'
  const table: [RegExp, string][] = [
    [/^Expected property name or '\}'/, "應為屬性名稱或 '}'"],
    [/^Expected double-quoted property name/, '屬性名稱必須以雙引號括住'],
    [/^Expected ',' or '\}' after property value/, "屬性值之後應為 ',' 或 '}'"],
    [/^Expected ',' or '\]' after array element/, "陣列元素之後應為 ',' 或 ']'"],
    [/^Expected ':' after property name/, "屬性名稱之後應為 ':'"],
    [/^Unexpected non-whitespace character after JSON/, 'JSON 結束之後還有多餘的字元'],
    [/^Unterminated string in JSON/, '字串沒有結束'],
    [/^Bad control character in string literal/, '字串中有不合法的控制字元'],
    [/^Bad escaped character/, '不合法的跳脫字元'],
    [/^Bad Unicode escape/, '不合法的 Unicode 跳脫序列'],
    [/^Exponent part is missing a number/, '指數部分缺少數字'],
    [/^Unterminated fractional number/, '小數部分缺少數字'],
    [/^No number after minus sign/, '負號之後沒有數字'],
    [/^Unexpected token/, '非預期的字元'],
  ]
  for (const [re, zh] of table) if (re.test(s)) return zh + at(s)
  m = /^JSON\.parse: .* at line (\d+) column (\d+) of the JSON data$/.exec(s)
  if (m) return `JSON 語法錯誤，位於第 ${m[1]} 行第 ${m[2]} 欄`
  if (/^JSON Parse error|is not valid JSON$/.test(s)) return 'JSON 語法錯誤'
  return translates(s) ? tr(s) : `JSON 語法錯誤${at(s)}`
}

/** A catalog type id ("resistor") → its zh-TW part label (電阻); unknown ids stay. */
export function typeZh(t: string): string {
  return partTranslation(t)?.label ?? t
}

/** Logic-net driver labels: "U1.PA5", "stimulus U1.PA5" (test stimulus). */
function slotZh(s: string): string {
  const m = /^stimulus (\S+)$/.exec(s)
  return m ? `激勵 ${m[1]}` : s
}

/** listText() output ("A", "A and B", "A, B and C") → "A、B 與 C" (items translated by `item`). */
export function listZh(s: string, item: (x: string) => string = (x) => x): string {
  const m = /^(.*) and ([^,]*)$/s.exec(s)
  const items = m ? [...m[1].split(', '), m[2]] : [s]
  const zh = items.map((x) => item(x.trim()))
  return zh.length <= 1 ? zh[0] ?? '' : `${zh.slice(0, -1).join('、')} 與 ${zh[zh.length - 1]}`
}

const BOARD_LABEL_ZH: Record<string, string> = { Half: '半尺寸', Standard: '標準', 'Lab XL': '加大 XL' }
/** Board size label ('Standard', 'Lab XL ×2') → zh. */
export function boardLabelZh(s: string): string {
  const m = /^(Half|Standard|Lab XL)(?: ×(\d+))?$/.exec(s)
  if (!m) return s
  return `${BOARD_LABEL_ZH[m[1]]}${m[2] ? ` ×${m[2]}` : ''}`
}

const END_ZH: Record<string, string> = { from: '起點', to: '終點' }
const endZh = (s: string) => END_ZH[s] ?? s

const STOP_REASON_ZH: Record<string, string> = {
  target: '已到達目標時間',
  sync: '同步要求',
  breakpoint: '中斷點',
  halted: '已停止',
  lockup: '核心鎖死',
  sleep: '睡眠',
}

const QUERY_ZH: Record<string, string> = {
  logic: '邏輯分析儀',
  scope: '示波器',
  'scope-trigger': '示波器觸發',
  'mcu-debug': 'MCU 除錯',
  'mcu-memory': 'MCU 記憶體',
  'mcu-support': 'MCU 支援資訊',
}

/** describeParamKind(): 'a number' / 'a boolean' / 'a string' / 'one of "x", "y"' */
function paramKindZh(s: string): string {
  if (s === 'a number') return '數字'
  if (s === 'a boolean') return '布林值'
  if (s === 'a string') return '字串'
  const m = /^one of (.*)$/.exec(s)
  if (m) return m[1] === 'its options' ? '其選項之一' : `${m[1].replace(/, /g, '、')} 其中之一`
  return s
}

/** rotationList(): '0 or 180', '0, 90 or 180', 'no rotation' */
function rotationsZh(s: string): string {
  if (s === 'no rotation') return '不可旋轉'
  return s.replace(/ or /, ' 或 ').replace(/, /g, '、')
}

/** holeRangeHint() */
function holeRangeZh(s: string): string {
  const m = /^use "a1".."j(\d+)" or "top\+0".."bot-(\d+)"(?:; holes on board-rows behind the front row take a 0-indexed "row:" prefix, "1:".."(\d+):" \(e\.g\. "1:a12", "\d+:top\+5"\))?$/.exec(s)
  if (!m) return tr(s)
  const base = `請使用 "a1".."j${m[1]}" 或 "top+0".."bot-${m[2]}"`
  return m[3] !== undefined
    ? `${base}；前排之後各排板列上的孔位要加上從 0 起算的「列:」前綴，"1:".."${m[3]}:"（例如 "1:a12"、"${m[3]}:top+5"）`
    : base
}

/** offBoardError(): '"a80" is off the Standard board (63 columns) — use the Lab XL board or move it' */
function offBoardZh(s: string): string {
  let m = /^(.+?) is off the (.+?) board \((?:(\d+) columns|rail holes 0\.\.(\d+))\) — (.+)$/.exec(s)
  if (m) {
    const extent = m[3] !== undefined ? `${m[3]} 欄` : `電源軌孔位 0..${m[4]}`
    return `${m[1]} 超出${boardLabelZh(m[2])}麵包板（${extent}）——${offBoardFixZh(m[5])}`
  }
  m = /^(.+?) is on board-row (\d+), but the rig has (.+?) — (.+)$/.exec(s)
  if (m) {
    const have =
      m[3] === 'only the front board-row (bare refs like "a12", no row prefix)'
        ? '只有前排板列（不加前綴的孔位，如 "a12"）'
        : m[3].replace(
            /^board-rows 0\.\.(\d+) \(front row bare, deeper rows prefixed "1:"\.\."(\d+):"\)$/,
            '板列 0..$1（前排不加前綴，後面各排加上 "1:".."$2:" 前綴）',
          )
    return `${m[1]} 位於板列 ${m[2]}，但目前的組合${have.startsWith('只有') ? '' : '有'}${have}——${offBoardFixZh(m[4])}`
  }
  return tr(s)
}

function offBoardFixZh(s: string): string {
  if (s === 'add another board or move it') return '請再加一塊麵包板或移動它'
  if (s === 'move it onto the board') return '請把它移到麵包板上'
  if (s === 'move it to an existing board-row') return '請把它移到現有的板列'
  if (s === 'move it left') return '請把它往左移'
  let m = /^use the (.+?) board or move it(?: left)?$/.exec(s)
  if (m) return `請改用${boardLabelZh(m[1])}麵包板或${s.endsWith('left') ? '把它往左移' : '移動它'}`
  m = /^set "boardRows" to at least (\d+) \(max (\d+)\) or move it to an existing board-row$/.exec(s)
  if (m) return `請把 "boardRows" 設為至少 ${m[1]}（最多 ${m[2]}），或把它移到現有的板列`
  return s
}

/** validate.ts claimHole() descriptions: 'pin p1 of "R1"', 'the "from" end of wire "w1"' */
function occupantZh(s: string): string {
  let m = /^pin (\S+) of "(.+)"$/.exec(s)
  if (m) return `"${m[2]}" 的腳位 ${m[1]}`
  m = /^the "(from|to)" end of wire "(.+)"$/.exec(s)
  if (m) return `導線 "${m[2]}" 的${endZh(m[1])}`
  return s
}

const ONE_LEAD_RULE =
  'a breadboard hole takes exactly one lead. All 5 holes of a strip column-half are the same net ' +
  '(e.g. a12–e12 are one net, f12–j12 another), so use a different free hole in the same strip instead'
const ONE_LEAD_RULE_ZH =
  '一個麵包板孔位只能插一支接腳。同一欄半邊的 5 個孔位屬於同一個網路（例如 a12–e12 是一個網路，f12–j12 是另一個），請改用同一排中其他空著的孔位'

// ---------------------------------------------------------------------------
// patterns (first match wins; the suffix wrapper must stay first)
// ---------------------------------------------------------------------------

export const MESSAGES_ZH: MessagePattern[] = [
  // SocLog dedup suffix (src/mcu/stm32f1/log.ts) on any message
  tpl('«m» (repeated «n#»× since the last report)', (g) => `${tr(g.m)}（自上次回報後重複 ${g.n} 次）`),

  // ---------------------------------------------------------------- engine
  tpl('component «id» has unknown type "«t»" — excluded from simulation', (g) => `元件 ${g.id} 的類型「${g.t}」未知——已排除於模擬之外`),
  tpl('component «id» is malformed (bad holes or anchor) — excluded from simulation', (g) => `元件 ${g.id} 格式錯誤（孔位或定位點有誤）——已排除於模擬之外`),
  tpl('component «id»: unknown device model "«m»" — excluded from simulation', (g) => `元件 ${g.id}：未知的元件模型「${g.m}」——已排除於模擬之外`),
  tpl('component «id»: chip model "«m»" is not registered — excluded from simulation', (g) => `元件 ${g.id}：晶片模型「${g.m}」未註冊——已排除於模擬之外`),
  tpl('component «id» failed to initialize: «e»', (g) => `元件 ${g.id} 初始化失敗：${errZh(g.e)}`),
  tpl('chip «id» model error: «e»', (g) => `晶片 ${g.id} 模型錯誤：${errZh(g.e)}`),
  tpl('component «id»: malformed sub-circuit element — excluded', (g) => `元件 ${g.id}：子電路元素格式錯誤——已排除`),
  tpl(
    'component «id»: sub-circuit element «el» pin "«p»" is not connected to a node — element excluded',
    (g) => `元件 ${g.id}：子電路元素 ${g.el} 的腳位「${g.p}」未連接到任何節點——已排除該元素`,
  ),
  tpl(
    'component «id»: sub-circuit element «el» has unknown device model "«m»" — element excluded',
    (g) => `元件 ${g.id}：子電路元素 ${g.el} 的元件模型「${g.m}」未知——已排除該元素`,
  ),
  tpl('LED «id» burned out (current «n#»mA — add a series resistor)', (g) => `LED ${g.id} 已燒毀：電流 ${maZh(g.n)}。請串聯限流電阻。`),
  tpl('supply «id» current > 2A (possible short circuit)', (g) => `電源 ${g.id} 電流 > 2 A（可能短路）`),
  tpl('component «id» model error: «e»', (g) => `元件 ${g.id} 模型錯誤：${errZh(g.e)}`),
  tpl('chip «id» «pin» pin not connected to a powered net', (g) => `晶片 ${g.id} 的 ${g.pin} 腳位未連接到有電的網路`),

  // --------------------------------------------------------------- netlist
  tpl('wire «id»: invalid endpoint "«e»"', (g) => `導線 ${g.id}：端點「${g.e}」無效`),

  // ------------------------------------------------- device / digital models
  tpl(
    'relay «id»: coil switched off without a flyback diode — inductive kick of «v#» V across the coil (add a diode across COIL1/COIL2, cathode to the + side)',
    (g) => `繼電器 ${g.id}：線圈在沒有飛輪二極體的情況下斷電——線圈兩端產生 ${g.v} V 的感應反衝電壓（請在 COIL1/COIL2 兩端並聯二極體，陰極接 + 側）`,
  ),
  tpl('74HC595 input «pin» is floating (CMOS inputs must be driven): it keeps its last level', (g) => `74HC595 輸入 ${g.pin} 浮接（CMOS 輸入必須被驅動）：保持上一個準位`),
  tpl('«id»: catalog entry «t» has no digital spec', (g) => `${g.id}：元件庫項目 ${g.t} 沒有數位規格`),
  tpl('«id»: device model error in init: «e»', (g) => `${g.id}：元件模型初始化錯誤：${errZh(g.e)}`),
  tpl('«id»: device model error: «e»', (g) => `${g.id}：元件模型錯誤：${errZh(g.e)}`),
  tpl('unknown pin "«p»"', (g) => `未知的腳位「${g.p}」`),
  tpl('model drives pin «p», which the catalog does not list as an output — ignored', (g) => `模型驅動腳位 ${g.p}，但元件庫未將其列為輸出——已忽略`),
  tpl(
    'logic contention: «a» drives high while «b» drives low (level undefined)',
    (g) => `邏輯衝突：${slotZh(g.a)} 驅動為高電位，同時 ${slotZh(g.b)} 驅動為低電位（準位不確定）`,
  ),

  // ----------------------------------------------------------- coordinator
  tpl('simulation failed to start: «e»', (g) => `模擬無法啟動：${errZh(g.e)}`),
  tpl('«id»: device model failed to start: «e»', (g) => `${g.id}：元件模型無法啟動：${errZh(g.e)}`),
  tpl('«id»: digital model "«m»" is not available — part simulated as open pins', (g) => `${g.id}：無法使用數位模型「${g.m}」——此元件的腳位以開路模擬`),
  tpl('«id»: no UART "«p»" to send to', (g) => `${g.id}：沒有可傳送的 UART「${g.p}」`),
  tpl('«id=[A-Za-z][\\w.]*»: reset', (g) => `${g.id}：重置`),
  tpl('«id»: MCU model error: «e»', (g) => `${g.id}：MCU 模型錯誤：${errZh(g.e)}`),
  tpl(
    'MCU stopped advancing («r=[a-z]+») — pins frozen until reset',
    (g) => `MCU 停止前進（${STOP_REASON_ZH[g.r] ?? g.r}）——腳位凍結直到重置`,
  ),
  tpl('«id»: MCU model "«m»" failed to start: «e»', (g) => `${g.id}：MCU 模型「${g.m}」無法啟動：${errZh(g.e)}`),
  tpl('firmware «name» programmed (sha256 «h»…)', (g) => `韌體 ${g.name} 已燒錄（sha256 ${g.h}…）`),
  tpl('«id»: firmware «name» could not be programmed', (g) => `${g.id}：韌體 ${g.name} 無法燒錄`),
  tpl('«n#» log entries dropped (log rate too high)', (g) => `已捨棄 ${g.n} 筆日誌（日誌速率過高）`),
  tpl('breakpoint hit at PC 0x«a»', (g) => `命中中斷點，PC 0x${g.a}`),
  tpl('halted at PC 0x«a»', (g) => `已停止，PC 0x${g.a}`),

  // ------------------------------------------------------- MCU board adapter
  tpl('«id»: MCU board needs the SimEngine chip context — excluded', (g) => `${g.id}：MCU 開發板需要 SimEngine 晶片環境——已排除`),
  tpl('«id»: VDD «v#» V — power-on reset', (g) => `${g.id}：VDD ${g.v} V——上電重置`),
  tpl('«id»: VDD fell to «v#» V — brown-out, MCU held in reset', (g) => `${g.id}：VDD 降至 ${g.v} V——欠壓，MCU 保持在重置狀態`),
  tpl(
    '«id»: BOOT0 = 1 selects the system-memory bootloader, which is not emulated — MCU held in reset (set BOOT0 = 0 and reset)',
    (g) => `${g.id}：BOOT0 = 1 會選擇系統記憶體開機載入程式，但此程式未模擬——MCU 保持在重置狀態（請把 BOOT0 設為 0 並重置）`,
  ),
  tpl(
    '«id»: MCU model "«m»" is not available in this build — board simulated electrically only',
    (g) => `${g.id}：此版本沒有 MCU 模型「${g.m}」——開發板僅以電氣方式模擬`,
  ),
  tpl('«id»: no firmware loaded — board simulated electrically only', (g) => `${g.id} 還沒有韌體——開發板只以電氣方式模擬`),
  tpl(
    '«id»: no firmware loaded — load an ELF/BIN/HEX; the board is simulated electrically only',
    (g) => `${g.id} 還沒有韌體——請載入 ELF/BIN/HEX 檔；在那之前，開發板只以電氣方式模擬`,
  ),
  tpl(
    '«id»: MCU unpowered (VDD «v#» V) — feed 5V (on-board regulator) or 3V3, and connect GND',
    (g) => `${g.id}：MCU 未供電（VDD ${g.v} V）——請供應 5V（板載穩壓器）或 3V3，並連接 GND`,
  ),
  tpl('«id» «pin»: «v#» V exceeds the 5.5 V limit of a 5 V-tolerant pin', (g) => `${g.id} ${g.pin}：${g.v} V 超過 5 V 耐受腳位的 5.5 V 上限`),
  tpl(
    '«id» «pin»: «v#» V exceeds VDD + 0.3 V («m#» V) — «p» is not 5 V tolerant',
    (g) => `${g.id} ${g.pin}：${g.v} V 超過 VDD + 0.3 V（${g.m} V）——${g.p} 不耐受 5 V`,
  ),
  tpl('«id» «pin»: «v#» V is below VSS − 0.3 V', (g) => `${g.id} ${g.pin}：${g.v} V 低於 VSS − 0.3 V`),
  tpl(
    '«id» «pin»: driver «d=sources|sinks» «a#» mA (> «m#» mA) — short circuit or missing series resistor',
    (g) => `${g.id} ${g.pin}：驅動器${g.d === 'sources' ? '輸出' : '灌入'} ${g.a} mA（> ${g.m} mA）——短路或缺少串聯電阻`,
  ),
  tpl(
    '«id» «pin»: floating input — nothing drives its net and no pull-up/down is enabled; reads are undefined',
    (g) => `${g.id} ${g.pin}：浮接輸入——沒有任何東西驅動它的網路，也未啟用上拉／下拉；讀值不確定`,
  ),
  tpl('«id»: BOOT0 = «b#» — sampled at the next reset', (g) => `${g.id}：BOOT0 = ${g.b}——將在下次重置時取樣`),

  // ------------------------------------------------------------ worker host
  tpl('simulation worker crashed: «e»', (g) => `模擬背景執行緒當機：${errZh(g.e)}`),

  // ----------------------------------------------------------- lab store
  tpl('could not send firmware to «id»: «e»', (g) => `無法將韌體傳送到 ${g.id}：${errZh(g.e)}`),
  tpl('firmware "«n»" for «id» was not restored: «e»', (g) => `${g.id} 的韌體「${g.n}」未還原：${errZh(g.e)}`),
  tpl(
    '«k!» query failed: «e»',
    (g) => `${QUERY_ZH[g.k] ?? g.k}查詢失敗：${errZh(g.e)}`,
  ),
  tpl('logic analyzer setup failed: «e»', (g) => `邏輯分析儀設定失敗：${errZh(g.e)}`),
  // hostCall(run, what): '<what> failed: <err>' — a one-word / known / translatable subject only
  tpl('«w» failed: «e»', (g) => `${tr(g.w)}失敗：${errZh(g.e)}`, (g) => !/\s/.test(g.w) || translates(g.w)),
  tpl('«n#» byte(s) for «id» «port» not sent: the simulation is not loaded', (g) => `${g.n} 個位元組未傳送到 ${g.id} ${g.port}：模擬尚未載入`),
  tpl('sending to «id» «port» failed: «e»', (g) => `傳送到 ${g.id} ${g.port} 失敗：${errZh(g.e)}`),
  tpl('logic analyzer: «w»', (g) => `邏輯分析儀：${tr(g.w)}`),
  tpl(
    'firmware "«n»" for «id» is not in the exported project: its bytes are unavailable',
    (g) => `${g.id} 的韌體「${g.n}」不在匯出的專案中：無法取得其內容`,
  ),
  tpl(
    'firmware "«n»" for «id» was not loaded: the loader\'s SHA-256 disagrees with the file',
    (g) => `${g.id} 的韌體「${g.n}」未載入：載入器算出的 SHA-256 與檔案不符`,
  ),
  tpl('firmware "«n»" for «id» was not loaded: «e»', (g) => `${g.id} 的韌體「${g.n}」未載入：${errZh(g.e)}`),
  tpl('firmware loader failed: «e»', (g) => `韌體載入器失敗：${errZh(g.e)}`),
  tpl('"«id»" is not a microcontroller board in this circuit', (g) => `「${g.id}」不是此電路中的微控制器開發板`),
  tpl('«f»: the file is empty', (g) => `${g.f}：檔案是空的`),
  tpl(
    '«f»: the loader reported SHA-256 "«a»" but the file hashes to «b»',
    (g) => `${g.f}：載入器回報的 SHA-256 為「${g.a}」，但檔案的雜湊值為 ${g.b}`,
  ),
  tpl('"«id»" was removed while its firmware was loading', (g) => `「${g.id}」在韌體載入期間被移除`),

  // ---------------------------------------------------------- project files
  tpl('layout: «w»', (g) => `電路配置：${tr(g.w)}`),
  tpl('instruments: «w»', (g) => `儀器：${tr(g.w)}`),
  tpl(
    'firmware "«n»" for "«id»" ignored — the circuit has no microcontroller board "«id2»"',
    (g) => `「${g.id}」的韌體「${g.n}」已忽略——電路中沒有微控制器開發板「${g.id2}」`,
  ),
  tpl('«id»: entry must be an object', (g) => `${whereZh(g.id)}：項目必須是物件`),
  tpl('«id»: "name" must be a non-empty string', (g) => `${whereZh(g.id)}："name" 必須是非空字串`),
  tpl('«id»: "format" must be one of «l»', (g) => `${whereZh(g.id)}："format" 必須是 ${g.l.split(', ').map((f) => `"${f}"`).join('、')} 其中之一`),
  tpl('«id»: "sha256" must be 64 hex digits', (g) => `${whereZh(g.id)}："sha256" 必須是 64 位十六進位數字`),
  tpl('«id»: "size" must be a non-negative integer', (g) => `${whereZh(g.id)}："size" 必須是非負整數`),
  tpl('«id»: "data" must be a base64 string', (g) => `${whereZh(g.id)}："data" 必須是 base64 字串`),
  tpl('«id» («n»): "data" is not valid base64 — the file is corrupted', (g) => `${whereZh(g.id)}（${g.n}）："data" 不是有效的 base64——檔案已損毀`),
  tpl(
    '«id» («n»): decoded «a» bytes but the project records «b» — the file is corrupted',
    (g) => `${whereZh(g.id)}（${g.n}）：解碼出 ${g.a} 個位元組，但專案記錄為 ${g.b}——檔案已損毀`,
  ),
  tpl(
    '«id» («n»): SHA-256 mismatch (recorded «a»…, data hashes to «b»…) — the embedded firmware is corrupted',
    (g) => `${whereZh(g.id)}（${g.n}）：SHA-256 不符（記錄為 ${g.a}…，資料的雜湊值為 ${g.b}…）——內嵌的韌體已損毀`,
  ),
  tpl('«id» («n»): "binBase" must be a 32-bit address', (g) => `${whereZh(g.id)}（${g.n}）："binBase" 必須是 32 位元位址`),
  tpl('«id» («n»): "binBase" only applies to .bin images — ignored', (g) => `${whereZh(g.id)}（${g.n}）："binBase" 只適用於 .bin 映像檔——已忽略`),
  tpl('logic channel #«i»: "index" must be an integer 0..«n#» — dropped', (g) => `邏輯通道 #${g.i}："index" 必須是 0..${g.n} 的整數——已捨棄`),
  tpl('logic channel #«i»: duplicate index «n» — dropped', (g) => `邏輯通道 #${g.i}：索引 ${g.n} 重複——已捨棄`),
  tpl('logic channel #«i» is not an object — dropped', (g) => `邏輯通道 #${g.i} 不是物件——已捨棄`),
  tpl('logic channel «i»: malformed "source" — dropped', (g) => `邏輯通道 ${g.i}："source" 格式錯誤——已捨棄`),
  tpl('unknown file format «f» (expected "«e»")', (g) => `未知的檔案格式 ${g.f}（應為 "${g.e}"）`),
  tpl('"formatVersion" must be a positive integer (got «v»)', (g) => `"formatVersion" 必須是正整數（目前為 ${g.v}）`),
  tpl(
    'this project was saved«by?» in project format v«v», which is newer than this version of ohmlet supports (format v«m» and older) — update ohmlet to open it',
    (g) =>
      `此專案${byOhmletZh(g.by)}以專案格式 v${g.v} 儲存，比這個版本的 ohmlet 支援的格式（v${g.m} 以前）更新——請更新 ohmlet 後再開啟`,
  ),
  tpl('the file is not valid JSON («e»)', (g) => `檔案不是有效的 JSON（${jsonErrZh(g.e)}）`),
  tpl('no migration from project format v«v»', (g) => `沒有從專案格式 v${g.v} 轉換的方法`),

  // ------------------------------------------------- store (board size, AI)
  tpl('no component "«id»"', (g) => `沒有元件「${g.id}」`),
  tpl('"«id»" sits on the board — only instruments take a bench position', (g) => `「${g.id}」位於麵包板上——只有儀器可以設定桌面位置`),
  tpl('«n» «noun» would fall off the «r»-row grid', (g) => `${g.n} 個元件會超出 ${g.r} 排的板列`),
  tpl('«n» «noun» would fall off the «rig»', (g) => `${g.n} 個元件會超出${rigZh(g.rig)}`),
  tpl('Board count must be a whole number from 1 to «n#»', (g) => `麵包板數量必須是 1 到 ${g.n} 的整數`),
  tpl('Board rows must be a whole number from 1 to «n#»', (g) => `板列數必須是 1 到 ${g.n} 的整數`),
  tpl('The rig is already «n#» modules wide', (g) => `組合已經是 ${g.n} 塊麵包板寬`),
  tpl('The grid is already «n#» board-rows deep', (g) => `已經有 ${g.n} 排板列`),
  tpl('growing the grid failed validation: «e»', (g) => `擴充板列後驗證失敗：${tr(g.e)}`),
  tpl('Generated circuit failed validation: «e»', (g) => `產生的電路未通過驗證：${g.e.split('; ').map(tr).join('；')}`),

  // ------------------------------------------------------------- validator
  tpl('"version" must be the number 1 (got «v»)', (g) => `"version" 必須是數字 1（目前為 ${g.v}）`),
  tpl('"board" must be one of «l» (got «v») — or omit it for the standard board', (g) => `"board" 必須是 ${g.l.replace(/, /g, '、')} 其中之一（目前為 ${g.v}）——或省略以使用標準麵包板`),
  tpl(
    '"boardCount" must be an integer from 1 to «n#» (got «v») — or omit it for a single board',
    (g) => `"boardCount" 必須是 1 到 ${g.n} 的整數（目前為 ${g.v}）——或省略以使用單塊麵包板`,
  ),
  tpl(
    '"boardRows" must be an integer from 1 to «n#» (got «v») — or omit it for a single row of boards',
    (g) => `"boardRows" 必須是 1 到 ${g.n} 的整數（目前為 ${g.v}）——或省略以使用單排麵包板`,
  ),
  tpl('hole "«h»" is used by both «a» and «b» — «rule»', (g) => `孔位「${g.h}」同時被 ${occupantZh(g.a)} 與 ${occupantZh(g.b)} 使用——${g.rule === ONE_LEAD_RULE ? ONE_LEAD_RULE_ZH : tr(g.rule)}`),
  tpl('components[«i»] must be an object', (g) => `components[${g.i}] 必須是物件`),
  tpl('components[«i»] is missing a string "id"', (g) => `components[${g.i}] 缺少字串 "id"`),
  tpl(
    'component id "«id»" is invalid — ids must start with a letter and contain only letters, digits and underscores',
    (g) => `元件 id「${g.id}」無效——id 必須以英文字母開頭，且只能包含英文字母、數字與底線`,
  ),
  tpl('duplicate component id "«id»" — every component needs a unique id', (g) => `元件 id「${g.id}」重複——每個元件都需要唯一的 id`),
  tpl('component "«id»" is missing a string "type"', (g) => `元件「${g.id}」缺少字串 "type"`),
  tpl('component "«id»" has unknown type "«t»" — use only catalog types', (g) => `元件「${g.id}」的類型「${g.t}」未知——只能使用元件庫中的類型`),
  tpl('component "«id»": "params" must be an object of key → value', (g) => `元件「${g.id}」："params" 必須是「鍵 → 值」的物件`),
  tpl(
    'component "«id»" («t») has unknown param "«k»" — valid params: «l»',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）沒有參數 "${g.k}"——有效參數：${g.l.split(', ').map((k) => `"${k}"`).join('、')}`,
  ),
  tpl('component "«id»" («t») has unknown param "«k»" — this type has no params', (g) => `元件「${g.id}」（${typeZh(g.t)}）沒有參數 "${g.k}"——此類型沒有任何參數`),
  tpl('component "«id»" param "«k»" must be «w» (got «v»)', (g) => {
    const k = paramKindZh(g.w)
    return `元件「${g.id}」的參數 "${g.k}" 必須是${k.startsWith('"') ? ' ' : ''}${k}（目前為 ${g.v}）`
  }),
  tpl(
    'component "«id»" («t») does not take "rotation" — only dip and footprint packages rotate; leaded parts orient by their hole placement and off-board instruments have no orientation. Remove the field',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）不接受 "rotation"——只有 DIP 與固定腳位封裝可以旋轉；有接腳的元件依孔位決定方向，麵包板外的儀器沒有方向。請移除此欄位`,
  ),
  tpl(
    'component "«id»" "rotation" must be 0, 90, 180 or 270 (got «v») — or omit it for no rotation',
    (g) => `元件「${g.id}」的 "rotation" 必須是 0、90、180 或 270（目前為 ${g.v}）——或省略表示不旋轉`,
  ),
  tpl(
    'component "«id»" («t») cannot use rotation «r» — rotating a DIP 90 would put every pin in one strip column, shorting them; use 0 or 180 (180 spins the package in place: same holes, pin 1 moves to the row-e right end)',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）不能使用旋轉 ${g.r}——把 DIP 旋轉 90 會讓所有腳位落在同一欄而全部短路；請使用 0 或 180（180 為原地轉向：孔位相同，第 1 腳移到 e 列右端）`,
  ),
  tpl(
    'component "«id»" («t») cannot use rotation «r» — this part only fits the breadboard at rotation «l» (other orientations put its pins on the wrong strips); use one of those or omit the field',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）不能使用旋轉 ${g.r}——此元件只能以旋轉 ${rotationsZh(g.l)} 放在麵包板上（其他方向會讓腳位落在錯誤的排）；請改用其中之一或省略此欄位`,
  ),
  tpl(
    'component "«id»" («t») needs "rotation" — this part only fits the breadboard at rotation «l»',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）需要 "rotation"——此元件只能以旋轉 ${rotationsZh(g.l)} 放在麵包板上`,
  ),
  tpl(
    'component "«id»" («t») sits ON the board — "pos" is only for off-board instruments (power supply, function generator); place it with «a» instead',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）位於麵包板「上」——"pos" 只用於麵包板外的儀器（電源供應器、函數產生器）；請改用 ${g.a} 擺放`,
  ),
  tpl(
    'component "«id»" («t») is an off-board instrument — it has no "holes" or "at"; wire its terminals like "«term»" instead',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）是麵包板外的儀器——沒有 "holes" 或 "at"；請改為以導線連接它的端子，例如「${g.term}」`,
  ),
  tpl(
    'component "«id»" («t») "pos" must be an object {"x": <number>, "z": <number>} in plan units (got «v») — or omit it for the default instrument shelf left of the board',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）的 "pos" 必須是以平面單位表示的物件 {"x": <數字>, "z": <數字>}（目前為 ${g.v}）——或省略以放在麵包板左側的預設儀器架`,
  ),
  tpl(
    'component "«id»" "pos" («x», «z») is off the placement grid — instrument positions snap to 0.5 plan units (and |x|, |z| ≤ «n#»)',
    (g) => `元件「${g.id}」的 "pos"（${g.x}, ${g.z}）不在擺放格點上——儀器位置以 0.5 平面單位對齊（且 |x|、|z| ≤ ${g.n}）`,
  ),
  tpl(
    'instrument "«id»" body («r1») overlaps the «rig» board («r2») — move its "pos" clear of the board (the default shelf to the left is always free)',
    (g) => `儀器「${g.id}」的本體（${g.r1}）與${boardLabelZh(g.rig)}麵包板（${g.r2}）重疊——請把它的 "pos" 移離麵包板（左側的預設儀器架永遠是空的）`,
  ),
  tpl(
    'instrument "«id»" body («r1») overlaps instrument "«id2»" («r2») — instrument boxes need clear bench space; move one of them',
    (g) => `儀器「${g.id}」的本體（${g.r1}）與儀器「${g.id2}」（${g.r2}）重疊——儀器需要淨空的桌面空間；請移動其中一台`,
  ),
  tpl(
    'component "«id»" («t») needs "holes": an array of «n#» hole ref«s?» (one per pin: «p»)',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）需要 "holes"：由 ${g.n} 個孔位組成的陣列（每個腳位一個：${g.p.replace(/, /g, '、')}）`,
  ),
  tpl(
    'component "«id»" («t») has «a#» holes but needs exactly «b#» (pin order: «p»)',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）有 ${g.a} 個孔位，但需要恰好 ${g.b} 個（腳位順序：${g.p.replace(/, /g, '、')}）`,
  ),
  tpl('component "«id»" holes[«j»] («h») is not a valid hole ref — «hint»', (g) => `元件「${g.id}」的 holes[${g.j}]（${g.h}）不是有效的孔位——${holeRangeZh(g.hint)}`),
  tpl('component "«id»" holes[«j»]: «e»', (g) => `元件「${g.id}」的 holes[${g.j}]：${offBoardZh(g.e)}`),
  tpl('component "«id»" («t») needs "at": the hole of pin 1 (must be in row "f")', (g) => `元件「${g.id}」（${typeZh(g.t)}）需要 "at"：第 1 腳的孔位（必須在 f 列）`),
  tpl('component "«id»" («t») needs "at": the hole of pin 1', (g) => `元件「${g.id}」（${typeZh(g.t)}）需要 "at"：第 1 腳的孔位`),
  tpl('component "«id»" "at" («h») is not a valid hole ref — «hint»', (g) => `元件「${g.id}」的 "at"（${g.h}）不是有效的孔位——${holeRangeZh(g.hint)}`),
  tpl(
    'component "«id»" («t») DIP anchor "«a»" is invalid — even at rotation 180 "at" names the row-f hole at the LEFT end of the package (a DIP at 180 occupies the same holes; only the pin walk reverses, putting pin 1 at the row-e right end)',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）的 DIP 定位點「${g.a}」無效——即使旋轉 180，"at" 仍是指封裝「左端」位於 f 列的孔位（旋轉 180 的 DIP 佔用相同孔位，只是腳位順序反轉，第 1 腳移到 e 列右端）`,
  ),
  tpl(
    'component "«id»" («t») DIP anchor "«a»" is invalid — pin 1 must sit in row "f" (pins 1..«n#» run along row f, the rest back along row e)',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）的 DIP 定位點「${g.a}」無效——第 1 腳必須位於 f 列（第 1..${g.n} 腳沿 f 列排列，其餘沿 e 列折返）`,
  ),
  tpl('component "«id»" («t») "at": «e»', (g) => `元件「${g.id}」（${typeZh(g.t)}）的 "at"：${offBoardZh(g.e)}`),
  tpl(
    'component "«id»" («t») footprint rotated «r» does not fit with pin 1 at "«a»" — the rotated pin offsets run off the board (rows a..j, «n#» columns); choose another rotation or move the anchor',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）旋轉 ${g.r} 後，第 1 腳放在「${g.a}」時放不下——旋轉後的腳位超出麵包板（a..j 列、${g.n} 欄）；請選擇其他旋轉角度或移動定位點`,
  ),
  tpl(
    'component "«id»" («t») at "«a»" runs off the «rig» board — a «n#»-pin DIP needs columns «c1#»..«c2#», but the «rig2» board only has «m#» columns — «fix»',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）放在「${g.a}」會超出${boardLabelZh(g.rig)}麵包板——${g.n} 腳 DIP 需要第 ${g.c1}..${g.c2} 欄，但${boardLabelZh(g.rig2)}麵包板只有 ${g.m} 欄——${offBoardFixZh(g.fix)}`,
  ),
  tpl(
    'component "«id»" («t») footprint does not fit with pin 1 at "«a»" — the package would run off the «rig» board («m#» columns) — «fix»',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）第 1 腳放在「${g.a}」時放不下——封裝會超出${boardLabelZh(g.rig)}麵包板（${g.m} 欄）——${offBoardFixZh(g.fix)}`,
  ),
  tpl(
    'component "«id»" («t») at "«a»" has pins on more than one board-row — board-rows sit «n#» hole-pitches apart, so a rigid package must sit entirely on ONE board-row; anchor every pin on the same row',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）放在「${g.a}」時腳位分散在多個板列——板列之間相隔 ${g.n} 個孔距，硬質封裝必須完全位於「同一個」板列；請讓所有腳位落在同一列`,
  ),
  tpl(
    'component "«id»" («t») at "«a»" crosses the seam between board «b1#» and board «b2#» — a rigid package cannot straddle the gap between modules; shift it left or right',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）放在「${g.a}」會跨過第 ${g.b1} 與第 ${g.b2} 塊麵包板之間的接縫——硬質封裝不能跨越模組間的間隙；請左移或右移`,
  ),
  tpl(
    'component "«id»" («t») at "«a»"«rot?» puts pins «p1» and «p2» into one breadboard strip («h1» and «h2» are the same net) — the strip shorts them together; choose a rotation or anchor that gives every pin its own strip (straddle the center channel)',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）放在「${g.a}」${rotZh(g.rot)}會把腳位 ${g.p1} 與 ${g.p2} 放進同一排（${g.h1} 與 ${g.h2} 是同一個網路）——該排會讓它們短路；請選擇讓每個腳位各有一排的旋轉或定位點（跨在中央溝槽上）`,
  ),
  tpl(
    'component "«id»" («t») at "«a»"«rot?» puts pins «p1» and «p2» into one breadboard strip («h1» and «h2» are the same net) — the strip connects them permanently, so that part of the circuit is bypassed',
    (g) => `元件「${g.id}」（${typeZh(g.t)}）放在「${g.a}」${rotZh(g.rot)}會把腳位 ${g.p1} 與 ${g.p2} 放進同一排（${g.h1} 與 ${g.h2} 是同一個網路）——該排會把它們永久連接，使那部分電路被旁路`,
  ),
  tpl('wires[«i»] must be an object', (g) => `wires[${g.i}] 必須是物件`),
  tpl('wires[«i»] is missing a string "id"', (g) => `wires[${g.i}] 缺少字串 "id"`),
  tpl(
    'wire id "«id»" is invalid — ids must start with a letter and contain only letters, digits and underscores',
    (g) => `導線 id「${g.id}」無效——id 必須以英文字母開頭，且只能包含英文字母、數字與底線`,
  ),
  tpl('duplicate wire id "«id»" — every wire needs a unique id', (g) => `導線 id「${g.id}」重複——每條導線都需要唯一的 id`),
  tpl('wire "«id»" is missing a string "«e!»" endpoint', (g) => `導線「${g.id}」缺少字串的${endZh(g.e)}（"${g.e}"）`),
  tpl(
    'wire "«id»" «e!» («v») is neither a hole ref (like "c12" or "top+3") nor an off-board terminal (like "PS1:+")',
    (g) => `導線「${g.id}」的${endZh(g.e)}（${g.v}）既不是孔位（如 "c12" 或 "top+3"），也不是麵包板外儀器的端子（如 "PS1:+"）`,
  ),
  tpl('wire "«id»" «e!» ("«v»") references unknown component "«c»"', (g) => `導線「${g.id}」的${endZh(g.e)}（"${g.v}"）參照了不存在的元件「${g.c}」`),
  tpl(
    'wire "«id»" «e!» ("«v»") targets "«c»" which sits ON the board — only off-board instruments have "ID:PIN" terminals; connect the wire to a free hole in the same strip column as that pin instead',
    (g) => `導線「${g.id}」的${endZh(g.e)}（"${g.v}"）指向位於麵包板「上」的「${g.c}」——只有麵包板外的儀器才有 "ID:PIN" 端子；請改把導線接到與該腳位同一排的空孔位`,
  ),
  tpl(
    'wire "«id»" «e!» ("«v»"): "«c»" («t») has no terminal "«p»" — terminals: «l»',
    (g) => `導線「${g.id}」的${endZh(g.e)}（"${g.v}"）：「${g.c}」（${typeZh(g.t)}）沒有端子「${g.p}」——可用端子：${g.l.replace(/, /g, '、')}`,
  ),
  tpl('wire "«id»" «e!»: «m»', (g) => `導線「${g.id}」的${endZh(g.e)}：${offBoardZh(g.m)}`),
  tpl('hole "«h»" («v») is covered by «c»\'s body — pick a hole clear of the overhang', (g) => `孔位「${g.h}」（${occupantZh(g.v)}）被 ${g.c} 的本體蓋住——請選擇不在本體下方的孔位`),
  tpl(
    'chip "«id»" («t») supply pin «p» (hole «h») is not connected to any power supply "+" — wire its strip to the + rail',
    (g) => `晶片「${g.id}」（${typeZh(g.t)}）的電源腳位 ${g.p}（孔位 ${g.h}）沒有連接到任何電源供應器的 "+"——請把它所在的排接到 + 電源軌`,
  ),
  tpl(
    'chip "«id»" («t») supply pin «p» (hole «h») is not connected to any power supply "-" — wire its strip to the - (ground) rail',
    (g) => `晶片「${g.id}」（${typeZh(g.t)}）的電源腳位 ${g.p}（孔位 ${g.h}）沒有連接到任何電源供應器的 "-"——請把它所在的排接到 -（接地）電源軌`,
  ),

  // ------------------------------------------- firmware-contract runner
  tpl('no header hole for «p»', (g) => `${g.p} 沒有排針孔位`),
  tpl('circuit "«l»": «p» is not a Blue Pill header pin — not wired', (g) => `電路「${g.l}」：${g.p} 不是 Blue Pill 的排針腳位——未接線`),
  tpl('circuit "«l»": no free breadboard space left for «p» — not wired', (g) => `電路「${g.l}」：麵包板上沒有空間可放 ${g.p.replace(/^the /, '')}——未接線`),
  tpl('circuit "«l»": not understood by the runner — NOT wired', (g) => `電路「${g.l}」：執行器無法理解——「未」接線`),
  tpl(
    'circuit "«l»": «p» is already wired by an earlier circuit line (one free hole per header pin) — not wired',
    (g) => `電路「${g.l}」：${g.p} 已被前面的電路行接線（每個排針腳位只有一個空孔位）——未接線`,
  ),
  tpl(
    'circuit "«l»": a jumper line names two header pins ("PA6 -> PA0: jumper wire") — not wired',
    (g) => `電路「${g.l}」：跳線行必須指定兩個排針腳位（"PA6 -> PA0: jumper wire"）——未接線`,
  ),
  tpl('«a» → «b»: jumper wire «h1» – «h2»', (g) => `${g.a} → ${g.b}：跳線 ${g.h1} – ${g.h2}`),
  tpl(
    'circuit "«l»": an AT24C02 line names its SCL and SDA pins, in that order ("PB6, PB7: AT24C02 …") — not wired',
    (g) => `電路「${g.l}」：AT24C02 行必須依序指定 SCL 與 SDA 腳位（"PB6, PB7: AT24C02 …"）——未接線`,
  ),
  tpl(
    'circuit "«l»": a 74HC595 line names its SRCLK, SER and RCLK pins, in that order ("PA5, PA7, PA4: 74HC595 …") — not wired',
    (g) => `電路「${g.l}」：74HC595 行必須依序指定 SRCLK、SER 與 RCLK 腳位（"PA5, PA7, PA4: 74HC595 …"）——未接線`,
  ),
  tpl('circuit "«l»": no free breadboard space left for the «c=AT24C02|74HC595» — not wired', (g) => `電路「${g.l}」：麵包板上沒有空間可放 ${g.c}——未接線`),
  tpl(
    '«a» (SCL), «b» (SDA): «id» AT24C02 at «at», A2–A0 GND, WP «wp», VCC 3V3«pu?»',
    (g) => `${g.a}（SCL）、${g.b}（SDA）：${g.id} AT24C02 位於 ${g.at}，A2–A0 接 GND，WP 接 ${g.wp}，VCC 接 3V3${g.pu.replace(/^ \+ (.+) Ω pull-ups to 3V3$/, '，並以 $1 Ω 上拉到 3V3')}`,
  ),
  tpl(
    '«a» (SRCLK), «b» (SER), «c» (RCLK): «id» 74HC595 at «at», SRCLR 3V3, OE GND, VCC 3V3«led?»',
    (g) =>
      `${g.a}（SRCLK）、${g.b}（SER）、${g.c}（RCLK）：${g.id} 74HC595 位於 ${g.at}，SRCLR 接 3V3，OE 接 GND，VCC 接 3V3${g.led.replace(
        /^, QA–QH: (.+) Ω \+ (\S+) LED to GND each \((.+)\)$/,
        (_x, o: string, c: string, d: string) => `，QA–QH 各經 ${o} Ω 接一顆${LED_COLOR_ZH[c] ?? c} LED 到 GND（${d}）`,
      )}`,
  ),
  tpl('«p»: «r» «o» Ω + «c» LED «d» to GND', (g) => `${g.p}：${g.r} ${g.o} Ω + ${LED_COLOR_ZH[g.c] ?? g.c} LED ${g.d} 接 GND`),
  tpl('«p»: «r» «o#» Ω pull-«d=up to 3V3|down to GND»', (g) => `${g.p}：${g.r} ${g.o} Ω ${g.d === 'up to 3V3' ? '上拉到 3V3' : '下拉到 GND'}`),
  tpl(
    '«p»: button modeled by the scenario stimulus (50 Ω to GND while pressed, released = open)',
    (g) => `${g.p}：按鈕以情境激勵模擬（按下時經 50 Ω 接 GND，放開 = 開路）`,
  ),
  tpl('"«l»": nothing to place (on-board part, UART tap, recorder or open pin)', (g) => `「${g.l}」：不需擺放元件（板載元件、UART 監聽、記錄器或空腳位）`),
  tpl('stimulus (50 Ω to VSS / VDD or open) on «p»', (g) => `激勵（經 50 Ω 接 VSS／VDD 或開路）位於 ${g.p}`),
  tpl('«p» was not recorded (not a Blue Pill header pin?)', (g) => `${g.p} 沒有被記錄（不是 Blue Pill 的排針腳位？）`),
  tpl(
    '«n#» violation(s) (allowed skew «s» after a «p» edge): «l»',
    (g) => `${g.n} 處違規（${g.p} 邊緣後容許的偏移為 ${g.s}）：${g.l}`,
  ),
  tpl('max lag «s» exceeded: «l»', (g) => `超過最大延遲 ${g.s}：${g.l}`),
  tpl('no «p» edge in «a»–«b» to check', (g) => `${g.a}–${g.b} 之間沒有可檢查的 ${g.p} 邊緣`),
  tpl(
    'expected silence until stimulated«w?», but «p» sent "«t»" from «at»',
    (g) => `預期在受到激勵前保持靜默${checkWhenZh(g.w)}，但 ${g.p} 從 ${g.at} 起送出「${g.t}」`,
  ),
  tpl('expected the first bytes "«a»", got "«b»"«x?»', (g) => `預期最先送出的位元組為「${g.a}」，實際為「${g.b}」${checkOnlyZh(g.x)}`),
  tpl('invalid regex «r»: «e»', (g) => `無效的正規表示式 ${g.r}：${errZh(g.e)}`),
  tpl('no leading line(s) match /«r»/; first bytes: "«b»"', (g) => `開頭沒有任何一行符合 /${g.r}/；最先送出的位元組：「${g.b}」`),
  tpl('«n#» pins to observe, the logic recorder has «m#» channels', (g) => `需觀察 ${g.n} 個腳位，但邏輯記錄器只有 ${g.m} 個通道`),
  tpl('unknown time origin "«t»"', (g) => `未知的時間原點「${g.t}」`),
  tpl('signal not understood: «s»', (g) => `無法理解的訊號：${g.s}`),
  tpl('drive «p»@«t»', (g) => `驅動 ${g.p}@${g.t}`),
  tpl('level must be 0, 1 or "open", got «v»', (g) => `準位必須是 0、1 或 "open"，目前為 ${g.v}`),
  tpl('the MCU never powered up (VDD stayed below the POR level for «n#» ms)', (g) => `MCU 從未上電（VDD 在 ${g.n} ms 內一直低於 POR 準位）`),
  tpl('«p» transmitted nothing within «n#» ms of reset — the time origin was never reached', (g) => `${g.p} 在重置後 ${g.n} ms 內沒有送出任何資料——始終未到達時間原點`),
  tpl('runner error: «e»', (g) => `執行器錯誤：${errZh(g.e)}`),
  tpl('drive «p»', (g) => `驅動 ${g.p}`),
  tpl(
    'stimulus on «p» could not be applied at «t» (no such board header pin / not connected)',
    (g) => `無法在 ${g.t} 對 ${g.p} 施加激勵（沒有此排針腳位／未連接）`,
  ),
  tpl('expected «f» Hz, measured «m» Hz «x»', (g) => `預期 ${g.f} Hz，量測為 ${g.m} Hz（${checkWhenAtZh(g.x)}）`),
  tpl('pins «p»', (g) => `腳位 ${g.p}`),
  tpl('expected «a», measured «b» «x»', (g) => `預期 ${g.a}，量測為 ${g.b === 'unknown' ? '未知' : g.b}（${checkWhenAtZh(g.x)}）`),
  tpl('the MCU has no «x»', (g) => `MCU 沒有 ${g.x}`),
  tpl('MCU is «s» at the end (PC 0x«pc»«x?»)', (g) => `結束時 MCU 處於 ${g.s} 狀態（PC 0x${g.pc}${g.x}）`),
  tpl('expected «a» from settle («b»), measured «c»', (g) => `預期穩定後（${g.b}）為 ${g.a}，量測為 ${g.c}`),
  tpl('left «a»: edge to «b» at «c»«x?»', (g) => `離開 ${g.a}：在 ${g.c} 出現轉為 ${g.b} 的邊緣${g.x.replace(/^ \(\+(\d+) more\)$/, '（另有 $1 個）')}`),
  tpl('line(s) outside the periodic signal(s): «l»', (g) => `週期訊號以外的行：${g.l}`),
  tpl('"from": "«f»" names no earlier expectation', (g) => `"from": "${g.f}" 沒有對應到前面的預期項目`),
  tpl('not evaluated: it is relative to "«f»", which failed', (g) => `未評估：它相對於「${g.f}」，而該項目已失敗`),
  tpl('«p» «e» edge expected within «a»–«b»«x?»; «r»', (g) => `預期 ${g.p} 的${g.e === 'rising' ? '正緣' : g.e === 'falling' ? '負緣' : g.e}邊緣出現在 ${g.a}–${g.b}${g.x} 之間；${g.r}`),
  tpl(
    '«p» expected «l» throughout «a»–«b»«x?», but it changed to «v» at «t»',
    (g) => `預期 ${g.p} 在 ${g.a}–${g.b}${g.x} 期間保持 ${g.l}，但它在 ${g.t} 變為 ${g.v}`,
  ),
  tpl(
    '«p» expected «l» throughout «a»–«b»«x?», but it is «v» at «t»',
    (g) => `預期 ${g.p} 在 ${g.a}–${g.b}${g.x} 期間保持 ${g.l}，但它在 ${g.t} 為 ${g.v}`,
  ),
  tpl('«n» edges every «m» ms expected in «a»–«b»«x?»: «r»', (g) => `預期在 ${g.a}–${g.b}${g.x} 之間每 ${g.m} ms 出現 ${g.n} 個邊緣：${g.r}`),
  tpl('expectation not understood: «e»', (g) => `無法理解的預期項目：${g.e}`),
  tpl('«n#» unexpected byte(s), first "«b»" from «t»', (g) => `${g.n} 個非預期的位元組，第一個「${g.b}」從 ${g.t} 開始`),
  tpl('«n#» unexpected edge(s) on «p»: «l»', (g) => `${g.p} 上有 ${g.n} 個非預期的邊緣：${g.l}`),
  tpl(
    '«p» "«t»" expected with its first byte within «a»–«b»«x?»; «r»',
    (g) => `預期 ${g.p}「${g.t}」的第一個位元組出現在 ${g.a}–${g.b}${g.x} 之間；${g.r}`,
  ),
  tpl('«p»: the manifest entry has no checks', (g) => `${g.p}：清單項目沒有任何檢查`),
]

const LED_COLOR_ZH: Record<string, string> = { red: '紅色', green: '綠色', yellow: '黃色', blue: '藍色', white: '白色' }

function whereZh(s: string): string {
  const m = /^firmware "(.+)"$/.exec(s)
  return m ? `韌體「${m[1]}」` : s
}

/** store.ts rigName(): 'Standard board', 'Lab XL ×2 rig' */
function rigZh(s: string): string {
  const m = /^(.+) (board|rig)$/.exec(s)
  return m ? `${boardLabelZh(m[1])}${m[2] === 'rig' ? '組合' : '麵包板'}` : s
}

/** checks.ts `when`: 'at settle (12 ms after reset)' / 'at the end (…)' */
function checkWhenAtZh(s: string): string {
  const m = /^at (settle|the end) \((.+) after reset\)$/.exec(s)
  return m ? `${m[1] === 'settle' ? '穩定時' : '結束時'}，重置後 ${m[2]}` : s
}

function byOhmletZh(s: string): string {
  const m = /^ by ohmlet (.+)$/.exec(s)
  return m ? `由 ohmlet ${m[1]} ` : ''
}

function rotZh(s: string): string {
  const m = /^ rotation (\d+)$/.exec(s)
  return m ? `（旋轉 ${m[1]}）` : s
}

function checkWhenZh(s: string): string {
  if (!s) return ''
  if (s === ' (the baseline is never stimulated)') return '（基準情境從不施加激勵）'
  const m = /^ \(first drive at (.+)\)$/.exec(s)
  return m ? `（第一次驅動於 ${m[1]}）` : s
}

function checkOnlyZh(s: string): string {
  const m = /^ \(only (\d+) byte\(s\) sent\)$/.exec(s)
  return m ? `（只送出 ${m[1]} 個位元組）` : s
}

// ---------------------------------------------------------------------------
// exact texts: fixed messages, catalog pin notes, manufacturers, on-board notes
// ---------------------------------------------------------------------------

export const NOTES_ZH: Record<string, string> = polishNotes({
  // engine / netlist / digital / coordinator / worker
  'no power supply': '沒有電源供應器',
  // firmware-contract bench (checksLayout notes)
  'U1 stm32_bluepill at h10, PS1 5 V → 5V pin, GND → top− rail, 3V3 → top+ rail':
    'U1（STM32F103C8T6 Blue Pill 開發板）位於 h10，PS1 5 V → 5V 腳位，GND → top− 電源軌，3V3 → top+ 電源軌',
  'circuit matrix is singular — check connections': '電路矩陣奇異（無法求解）——請檢查連接',
  'solver failed to converge — results may be inaccurate': '求解器未收斂——結果可能不準確',
  'numerical error in solver — voltages were reset': '求解器發生數值錯誤——電壓已重置',
  'no ground': '沒有接地',
  'component with missing id/type — excluded from simulation': '缺少 id／類型的元件——已排除於模擬之外',
  'power lost during the EEPROM write cycle (t_WR): that page write is lost': 'EEPROM 寫入週期（t_WR）中斷電：該次頁寫入已遺失',
  'logic nets did not settle (devices keep re-driving each other) — notifications dropped': '邏輯網路無法穩定（元件持續互相重新驅動）——已捨棄通知',
  'power cycle — simulation reset to t = 0': '電源重新啟動——模擬重置到 t = 0',
  'simulation made no progress (MCU keeps stopping) — advance aborted': '模擬沒有進展（MCU 持續停止）——已中止推進',
  'simulation worker crashed': '模擬背景執行緒當機',
  'simulation worker sent an unreadable message': '模擬背景執行緒傳回無法讀取的訊息',
  'query failed': '查詢失敗',
  'simulation host disposed': '模擬主機已釋放',
  'superseded by a newer firmware load or clear for this board': '此開發板已有較新的韌體載入或清除操作，本次已取代',
  'catalog has no stm32_bluepill': '元件庫沒有 stm32_bluepill',
  'the logic recorder overflowed (edges were dropped)': '邏輯記錄器溢位（部分邊緣已遺失）',
  'the settle instant was never reached': '始終未到達穩定時刻',
  'mcu state': 'MCU 狀態',
  'no MCU model for the Blue Pill (stm32f103c8 not registered)': 'Blue Pill 沒有 MCU 模型（stm32f103c8 未註冊）',
  'no UART port to observe (checks.uart / boot / t0 name none)': '沒有要觀察的 UART 埠（"checks.uart"／"boot"／"t0" 都未指定）',
  // project files / validator / store
  '"app" is malformed — ignored': '"app" 格式錯誤——已忽略',
  '"firmware" must be an object keyed by component id': '"firmware" 必須是以元件 id 為鍵的物件',
  '"workspace" is not an object — ignored': '"workspace" 不是物件——已忽略',
  '"instruments" is not an object — ignored': '"instruments" 不是物件——已忽略',
  '"logicChannels" must be an array — ignored': '"logicChannels" 必須是陣列——已忽略',
  'not an ohmlet project or circuit layout (no "format" and no "components")': '不是 ohmlet 專案或電路配置檔（沒有 "format" 也沒有 "components"）',
  'a project file must contain a JSON object': '專案檔必須包含一個 JSON 物件',
  'the project has no "layout" object': '專案沒有 "layout" 物件',
  '"components" must be an array': '"components" 必須是陣列',
  '"wires" must be an array': '"wires" 必須是陣列',
  'layout must be a JSON object with "version", "components" and "wires"': '電路配置必須是包含 "version"、"components" 與 "wires" 的 JSON 物件',
  'no power_supply in the layout — add one and wire its "+" and "-" terminals to the power rails':
    '電路配置中沒有 power_supply（直流電源供應器）——請加入一台，並把它的 "+" 與 "-" 端子接到電源軌',

  // ---- MCU on-board notes (mcu.onBoard). Pin notes and manufacturers live in
  // catalog-text.ts (UI dictionary, shown through tText).
  'LED_PC13 (active low, via 510 Ω to 3.3 V)': 'LED_PC13（低態有效，經 510 Ω 接 3.3 V）',
  '10 kΩ USB D+ pull-up (R10)': '10 kΩ USB D+ 上拉（R10）',
})

/** Wrapper patterns (after the specific ones above). */
MESSAGES_ZH.push(
  // `${componentId}: ${message}` (device-chip.ts) around any translatable model message —
  // guarded: declines unless the inner message translates, so specific patterns elsewhere still win
  tpl('«id=[A-Za-z][A-Za-z0-9_]*»: «m»', (g) => `${g.id}：${tr(g.m)}`, (g) => translates(g.m)),
)
