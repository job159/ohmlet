/**
 * Interactive lessons contract. CONTRACT FILE.
 *
 * A lesson is data: text (Traditional Chinese — the interface language), a
 * starting circuit, a reference solution, guided steps and AUTOMATED
 * acceptance checks evaluated against the real simulation (netlist
 * connectivity, measurements from the coordinator, UART output, the
 * firmware 'checks' contracts, the electrical rule checker).
 *
 * Lessons live in src/lessons/<level>/<id>.lesson.ts, each exporting
 * `LESSON: Lesson`; src/lessons/index.ts collects them (import.meta.glob).
 * Firmware is referenced by firmware/dist project name and loaded through
 * src/firmware-assets.ts. Steps may carry one-click actions (LessonStepAction)
 * and mistakes a `match` (the "most likely cause" of a failed run).
 *
 * Honesty rule: a lesson whose required simulation features do not exist is
 * `runnable: 'not-yet'` with `runnableNote` saying exactly what is missing —
 * it is listed, readable, but never pretends to run.
 */
import type { CircuitLayout, ParamValue } from '../model/types'

export type LessonLevel = 'beginner' | 'intermediate' | 'advanced'

/**
 * A learner action a measuring check performs itself while it runs (final
 * round, request 2): at simulated time `at` — seconds after the power-on of
 * the simulated world the check runs in (a `fresh` measure powers up its
 * own; the shared session's power-on is the first check's start) — the
 * RUNTIME param `param` of part `component` is set to `value` through the
 * coordinator's runtime-param path, exactly what the inspector does while
 * the simulation runs (「位置」 of a KY-040, 「按下」 of a button). When the
 * shared session has already passed the first action (an earlier check ran
 * on), the check's whole script — and a uart-contains deadline — runs that
 * much later, keeping its spacing. A measure applies what falls inside its
 * window; a uart-contains counts only output sent after its first action
 * and performs every action up to `seconds` (a release after a press
 * happens even when the text came earlier). A stimulus the check did not
 * reach is dropped when it ends; what it applied stays (the shared session
 * goes on from there, like a knob the learner left turned). A param that
 * any check of the evaluation drives starts every simulated world at its
 * catalog default (the knob at 0, the button released), whatever the
 * learner left on the live board. Only params the catalog marks `runtime`
 * qualify — anything else is an authoring error the check reports.
 */
export interface LessonStimulus {
  at: number
  component: string
  param: string
  value: ParamValue
}

/** 'ready' = fully simulated; 'partial' = runs, some aspects not simulated (see runnableNote); 'not-yet' = cannot run */
export type LessonRunnable = 'ready' | 'partial' | 'not-yet'

/** A pin of a placed part, a breadboard hole, or an off-board terminal ("PS1:+"). */
export type PinRef = { component: string; pin: string } | { hole: string } | { terminal: string }

/** Automated checks. Every check returns pass/fail plus a measured-vs-expected explanation. */
export type LessonCheck =
  /** the layout contains at least `count` (default 1) parts of `type` */
  | { kind: 'has-part'; type: string; count?: number; label?: string }
  /**
   * `a` and `b` are electrically connected — directly (same net) or, with
   * `via`, through exactly one part of that type (e.g. a resistor in
   * [min, max] Ω, given by its params)
   */
  | {
      kind: 'connected'
      a: PinRef
      b: PinRef
      via?: { type: string; param?: string; min?: number; max?: number }
      label?: string
    }
  /** two pins must NOT share a net (e.g. no short) */
  | { kind: 'not-connected'; a: PinRef; b: PinRef; label?: string }
  /** an MCU board has firmware bound; optionally a specific firmware/dist project */
  | { kind: 'firmware-loaded'; component: string; project?: string; label?: string }
  /**
   * run the simulation for `seconds` (from the current state or a fresh
   * power-on when `fresh`) and measure a quantity on a net
   */
  | {
      kind: 'measure'
      at: PinRef
      quantity: 'voltage' | 'frequency' | 'duty' | 'current' | 'led-brightness'
      /** for 'current' / 'led-brightness': the part id */
      component?: string
      min: number
      max: number
      seconds?: number
      fresh?: boolean
      /** learner actions the check performs while it runs (LessonStimulus) */
      stimulus?: LessonStimulus[]
      label?: string
    }
  /**
   * the firmware's UART output contains `text` within `seconds` (after
   * power-on); `stimulus` = learner actions the check performs meanwhile
   */
  | {
      kind: 'uart-contains'
      component: string
      port: string
      text: string
      seconds?: number
      stimulus?: LessonStimulus[]
      label?: string
    }
  /** run the firmware/dist project's machine-checkable 'checks' contract (src/sim/coordinator/checks.ts) */
  | { kind: 'firmware-checks'; project: string; label?: string }
  /** the electrical rule checker reports no finding at or above `level` (default 'error') */
  | { kind: 'erc-clean'; level?: 'error' | 'risk'; label?: string }
  /** all sub-checks must pass */
  | { kind: 'all'; checks: LessonCheck[]; label?: string }

/**
 * A one-click helper a step offers next to 「檢查此步驟」 (UX LS-1, LS-11):
 *  - 'load-firmware' binds a bundled firmware/dist project to an MCU board
 *    (the inspector's own firmware path — the simulation stays real);
 *  - 'run' starts (or resumes) the simulation;
 *  - 'arm-part' arms the library's placement mode for a catalog type (the
 *    first part placed is selected and its properties open);
 *  - 'wire' enters wire mode on the first of these wires (from → to: hole
 *    refs or terminal refs) the board does not hold yet, marking where to
 *    click (「開始接線（a16 → top-13）」);
 *  - 'add-logic' puts pins of a part on the logic analyzer and shows it
 *    (「把 PA5、PC13 加到邏輯分析儀」); with `view` (release QA LS-F4) the
 *    analyzer then jumps to what the step talks about: the latest complete
 *    burst of edges on pin `burstOn` (edges < 1 ms apart) lasting at least
 *    `minBurst` s, shown in a `span`-second window with marker A on its first
 *    edge — 「跳到最近一筆 40 B 訊息」 (`label` names the burst in the
 *    lesson's words);
 *  - 'reset' (final round, request 3): 「重置 MCU」 (scope 'mcu' — the
 *    inspector's Reset MCU on `component`, default the lesson's MCU board:
 *    the firmware restarts, the rest of the circuit keeps its state) or
 *    「重置模擬」 (scope 'circuit' — the More sheet's Reset simulation: the
 *    whole circuit powers up again; a running simulation runs on), for the
 *    experiments whose jumpers the firmware reads only at reset;
 *  - 'unwire' (release QA LS-F7): 「拆掉 j11 → bot-7 這條線」 removes the
 *    wire(s) joining those endpoints in one undo step — the end of a jumper
 *    experiment; offered only while such a wire is on the board.
 */
export type LessonStepAction =
  | { kind: 'load-firmware'; component: string; project: string }
  | { kind: 'run' }
  | { kind: 'arm-part'; type: string }
  | { kind: 'wire'; wires: [string, string][] }
  | { kind: 'add-logic'; component: string; pins: string[]; view?: LogicBurstView }
  | { kind: 'reset'; scope: 'mcu' | 'circuit'; component?: string }
  | { kind: 'unwire'; wires: [string, string][] }

/** Where an 'add-logic' action points the logic analyzer (LessonStepAction). */
export interface LogicBurstView {
  /** window span (s) */
  span: number
  /** the pin (of the action's part) whose latest burst of edges is shown */
  burstOn?: string
  /** the shortest burst that counts (s) */
  minBurst?: number
  /** the burst in the lesson's words (「40 B 訊息」) */
  label?: string
}

export interface LessonStep {
  id: string
  /** 步驟標題 */
  title: string
  /** body text: paragraphs separated by blank lines; **bold**, `code`, and "- " bullet lists are rendered */
  body: string
  /**
   * point at holes / parts in the 3D scene while this step is active.
   * `watch`: parts an observe step's camera keeps in view besides its LEDs
   * and the parts in series (UX LS-12) — an MCU board whose own LED the
   * step asks the learner to watch (i1: the Blue Pill's PC13 LED).
   */
  highlight?: { holes?: string[]; components?: string[]; watch?: string[] }
  /** optional automatic check that completes the step */
  check?: LessonCheck
  /**
   * one-click helpers (src/lessons/step-actions.ts). Absent = derived from
   * the check (firmware-loaded → load-firmware, measure / UART / contract →
   * run, a part the solution adds → arm-part); [] = none.
   */
  action?: LessonStepAction | LessonStepAction[]
}

/**
 * When a common mistake is the likely cause of a failed acceptance run
 * (UX LS-5): every listed acceptance check index fails, every `passes` index
 * passes, and — when given — an ERC finding of one of `ercRules` is present
 * ('led-current', or 'led-current:reversed' for findings whose id ends with
 * ':reversed') and the failures involve one of `components`.
 */
export interface LessonMistakeMatch {
  /** acceptance check indices that must fail */
  checks?: number[]
  /** acceptance check indices that must pass (narrows the diagnosis) */
  passes?: number[]
  /** ERC rule ids ('rule' or 'rule:id-suffix'); one must be found */
  ercRules?: string[]
  /** part ids; a failing check or ERC finding must involve one */
  components?: string[]
}

export interface LessonMistake {
  /** 現象 */
  symptom: string
  /** 原因 */
  cause: string
  /** 解法 */
  fix: string
  /** when this mistake is the likely cause of a failed check run */
  match?: LessonMistakeMatch
}

export interface LessonCircuit {
  layout: CircuitLayout
  /** MCU component id → firmware/dist project name */
  firmware?: Record<string, string>
}

export interface Lesson {
  /** stable id, e.g. 'b1-led-resistor' */
  id: string
  level: LessonLevel
  /** sort order inside the level */
  order: number
  title: string
  summary: string
  /** 學習目標 */
  objectives: string[]
  /** 接線說明 */
  wiring: string
  /** 電氣原理 */
  theory: string
  /** starting circuit (may contain only the board / power) */
  start: LessonCircuit
  /** complete reference circuit ("顯示解答") */
  solution: LessonCircuit
  /** 預期量測結果 */
  expected: string[]
  /** 常見錯誤 */
  mistakes: LessonMistake[]
  /** 驗收條件 — all must pass for the lesson to count as completed */
  acceptance: LessonCheck[]
  steps: LessonStep[]
  runnable: LessonRunnable
  runnableNote?: string
  /**
   * catalog types / firmware projects the lesson needs (validated by tests);
   * `instrument` = the tray tab its starting circuit opens on (UX LS-11;
   * default: the logic analyzer when a step measures a frequency or duty)
   */
  requires?: { parts?: string[]; firmware?: string[]; instrument?: 'logic' | 'scope' | 'uart' }
  /** estimated minutes */
  durationMin?: number
}

export interface CheckResult {
  pass: boolean
  /** human-readable zh-TW explanation (measured vs expected) */
  detail: string
}
