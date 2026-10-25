/**
 * Built-in firmware picker (UX wave IN-1): every firmware/dist project the
 * app ships (src/firmware-assets.ts bundledFirmwareNames) — so a student
 * with no .elf on disk can still follow a lesson ("載入內建韌體 hal-blink").
 *
 *   firmwareGroups(...)   pure model: three groups —
 *                           本課使用  the guided / open lesson's
 *                                     requires.firmware (its solution
 *                                     firmware first), error demos tagged
 *                           範例韌體  each example project's firmware, with
 *                                     the example's title and summary
 *                           其他      the remaining bundled projects
 *                         Error-demo firmware (a lesson's 常見錯誤 names it,
 *                         e.g. lesson-i1-noclk) carries the 錯誤示範 tag and
 *                         that mistake's symptom as its summary.
 *   filterGroups(...)     the search ("搜尋韌體或範例"): every term must occur
 *                         in the name, title or summary
 *   <BundledFirmwarePicker/>  desktop: a Tier-S popover anchored to the
 *                         button (no backdrop-filter); phone: a kit sheet.
 *                         A combobox + listbox: ↑/↓ move, Enter loads,
 *                         Esc closes; the chosen row shows 載入中… and the
 *                         picker closes once the board has the image (the
 *                         caller binds it through lab.loadFirmware — the
 *                         same real loader as a dropped file).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Sheet, useIsDesktop } from '../kit'
import { t, useLang } from '../../i18n'
import { bundledFirmwareNames } from '../../firmware-assets'
import { LESSONS, lessonById, type Lesson } from '../../lessons'
import { LIBRARY, exampleSummary, exampleTitle } from '../workspace/examples'
import { useLessonUi } from '../lessons/state'
import { lessonOnBoard } from '../lessons/actions'
import { useStore } from '../../state/store'
import { useWorkspaceActive } from '../workspace/state'
import { useLab } from './lab'
import { Popover } from './controls'
import './inspector.css'

// ---------------------------------------------------------------------------
// texts of the projects no example describes (English sources; zh-TW in
// src/i18n/zh-TW/ux-inspector.ts). Summaries follow firmware/dist/manifest.json.
// ---------------------------------------------------------------------------

export const FIRMWARE_TEXT: Record<string, { title: string; summary: string }> = {
  'bare-blink': {
    title: 'Register-level blink (no HAL)',
    summary: 'PA5 and PC13 toggle every 250 ms on the 8 MHz HSI clock, SysTick 1 ms.',
  },
  'bare-button': {
    title: 'Register-level button mirror',
    summary: 'While the PA0 button (internal pull-up) is pressed, PA5 and the PC13 LED turn on.',
  },
  'cpu-bench': {
    title: 'CPU benchmark',
    summary: 'Runs the self-test workload 60 times (about 41 M instructions), then stops on BKPT.',
  },
  'cpu-selftest': {
    title: 'CPU self-test',
    summary: 'CRC32, sorting, 64-bit math and recursion; the result stays in RAM, then BKPT.',
  },
  'cpu-selftest-O0': { title: 'CPU self-test (-O0)', summary: 'The same self-test, built without optimization.' },
  'cpu-selftest-Os': { title: 'CPU self-test (-Os)', summary: 'The same self-test, optimized for size.' },
  'hal-acs712': {
    title: 'ACS712 current sensor',
    summary: 'Averages the ADC on PA0 every 200 ms and prints the current in mA on USART1.',
  },
  'hal-adc-dma': {
    title: 'ADC scan with DMA',
    summary: 'DMA copies IN0–IN3, the temperature sensor and VREFINT to RAM; printed every 200 ms.',
  },
  'hal-bh1750': {
    title: 'BH1750 light sensor (I²C)',
    summary: 'Reads the light level over I2C1 (PB6 / PB7) every 200 ms and prints it on USART1.',
  },
  'hal-dma-m2m': {
    title: 'DMA memory-to-memory copy',
    summary: 'DMA1 copies 1 KiB, the result is checked and the cycle count printed every 500 ms.',
  },
  'hal-esp01': {
    title: 'ESP-01 AT commands',
    summary: 'Talks to an ESP8266 over USART2 at 115200; joining Wi-Fi fails (the lab has no Wi-Fi).',
  },
  'hal-gpio-modes': {
    title: 'GPIO modes demo',
    summary: 'PB6 / PB7 open-drain at 10 Hz; PA1 pull-up, PA2 pull-down, PA3 floating, reported on USART1.',
  },
  'hal-hall': {
    title: 'A3144 Hall switch',
    summary: 'A PB12 interrupt on every magnet change, mirrored on the PC13 LED.',
  },
  'hal-joystick': {
    title: 'KY-023 joystick',
    summary: 'ADC on PA0 / PA1 and the push switch on PB12, printed every 100 ms.',
  },
  'hal-lcd1602': {
    title: 'LCD1602 (4-bit parallel)',
    summary: 'HD44780 in 4-bit mode with busy-flag polling: text, custom characters and a counter.',
  },
  'hal-oled-spi': {
    title: 'SSD1306 OLED (SPI)',
    summary: 'Text, a frame counter and a progress bar redrawn over SPI1 every 200 ms.',
  },
  'hal-pcf8574': {
    title: 'PCF8574 I/O expander',
    summary: 'An LED chaser on P0–P6 and a button on P7, over I²C at 0x20.',
  },
  'hal-sdcard': {
    title: 'micro-SD card (SPI)',
    summary: 'SPI-mode start-up, then the card size and the FAT boot sector on USART1.',
  },
  'hal-servo': { title: 'Servo signal (TIM2 CH2)', summary: '50 Hz on PA1 with the pulse sweeping between 1.0 and 2.0 ms.' },
  'hal-spi-loopback': {
    title: 'SPI loopback test',
    summary: 'Wire PA7 MOSI to PA6 MISO: four SPI set-ups are checked, the result goes to USART1.',
  },
  'hal-systick-timing': {
    title: 'SysTick timing probe',
    summary: 'PB13 toggles in the SysTick handler (500 Hz), PB14 around HAL_Delay(100).',
  },
  'hal-tb6612': {
    title: 'TB6612FNG motor driver',
    summary: 'PWM on PA0 plus direction pins: forward, brake, reverse and standby.',
  },
  'hal-tim-capture': {
    title: 'Timer input capture (PWM input)',
    summary: 'PA6 makes a PWM signal and PA0 measures it (wire PA6 → PA0); prints frequency and duty.',
  },
  'hal-tim-encoder': {
    title: 'Quadrature encoder (TIM4)',
    summary: 'Encoder mode on PB6 / PB7; prints the count on every change.',
  },
  'hal-tim-irq': {
    title: 'Timer interrupt: 1 kHz time base',
    summary: 'The TIM4 update interrupt toggles PB12 every 1 ms; PC13 blinks at 1 Hz.',
  },
  'hal-tim-pwm': { title: 'PWM on three timers', summary: 'Three PWM outputs: PA0 1 kHz 25 %, PA6 20 kHz 50 %, PA8 2 kHz 75 %.' },
  'hal-uart-dma': {
    title: 'UART with DMA',
    summary: 'Sends and receives by DMA with idle-line detection; every received chunk is echoed.',
  },
  'lab-acceptance': {
    title: 'Lab demo: button modes',
    summary: 'The PB12 button steps the PA5 LED through 2 Hz, 5 Hz, on and off; the mode goes to USART1.',
  },
  'lesson-a2-oled': {
    title: 'Lesson a2: OLED frame buffer',
    summary: 'An I²C SSD1306 redrawn every 200 ms; PB12 low at reset leaves out the charge pump (the panel stays dark).',
  },
  'lesson-a3-uart-dma': {
    title: 'Lesson a3: UART reception by DMA',
    summary: 'Circular DMA and idle-line detection on USART1; wire PA2 → PA10.',
  },
  'lesson-a4-freertos': {
    title: 'Lesson a4: FreeRTOS tasks and queues',
    summary: 'Two tasks send to a queue and a logger task prints; the PB12 interrupt sends from its ISR.',
  },
  'lesson-a6-encoder': {
    title: 'Lesson a6: rotary encoder (TIM4)',
    summary: 'KY-040 on TIM4 encoder mode (PB6 / PB7), 4 counts per detent, pos=<n> on USART1; PB13 low at reset also prints the raw count.',
  },
  'lesson-a7-i2c-multi': {
    title: 'Lesson a7: three devices on one I²C bus',
    summary: 'AT24C02, MPU-6050 and BME280 on I2C1 (PB6 / PB7); scans every second and prints each reading; a bus without pull-ups is reported.',
  },
  'lesson-a8-nobusy': {
    title: 'Forgot to wait for BUSY',
    summary: 'The page program is sent during the sector erase; the flash ignores it and reads back FF.',
  },
  'lesson-b3-pull': {
    title: 'Lesson b3: pull-up and pull-down',
    summary: 'PA0 / PA1 are floating inputs with external pulls; the PC13 LED follows PA0, reported every 100 ms.',
  },
  'lesson-i1-noclk': {
    title: 'GPIOA clock never enabled',
    summary: 'PA5 never becomes an output; only PC13 blinks.',
  },
  'lesson-i1-od': {
    title: 'PA5 set to open-drain',
    summary: 'PA5 can only pull low, so an LED to GND stays dark.',
  },
  'lesson-i2-nonvic': {
    title: 'EXTI interrupt not enabled in the NVIC',
    summary: 'The EXTI line goes pending, but the interrupt never runs.',
  },
  'lesson-i3-offby1': {
    title: 'Timer off by one',
    summary: 'PSC 72 / ARR 1000 without the “− 1”: PB12 runs at 492.66 Hz instead of 500 Hz.',
  },
  'lesson-i4-nomoe': {
    title: 'TIM1 MOE never set',
    summary: 'PWM on PA0 and PA6 works, PA8 stays silent.',
  },
  'lesson-i7-i2c': {
    title: 'Lesson i7: I²C scan and EEPROM',
    summary: 'Scans I2C1, then writes and verifies a page of an AT24C02; the report goes to USART1.',
  },
  'lesson-i8-lsb': {
    title: 'SPI sends the LSB first',
    summary: 'The 74HC595 chaser runs backwards (QH … QA).',
  },
  'soc-clock': {
    title: 'Clock switching',
    summary: 'HSI 8 MHz → PLL 72 MHz → HSI, printing SystemCoreClock on USART1.',
  },
  'soc-exti': {
    title: 'EXTI with WFI sleep',
    summary: 'A PB12 falling edge toggles PA5; the core sleeps in WFI between interrupts.',
  },
  'soc-iwdg': {
    title: 'Independent watchdog reset',
    summary: 'Counts boots in a backup register: two watchdog resets, then done.',
  },
  'soc-uart': { title: 'UART echo (minimal)', summary: 'USART1 115200 8N1: prints a greeting, then echoes every byte.' },
}

// ---------------------------------------------------------------------------
// model (pure)
// ---------------------------------------------------------------------------

export type FirmwareGroupId = 'lesson' | 'example' | 'other'

export interface FirmwareOption {
  /** firmware/dist project name ('hal-blink') */
  name: string
  /** UI language */
  title: string
  summary: string
  /** a lesson's 常見錯誤 reproduces with it */
  mistake: boolean
}

export interface FirmwareGroup {
  id: FirmwareGroupId
  options: FirmwareOption[]
}

/** project names a lesson's mistakes cite (`lesson-i1-noclk`) → the mistake's symptom */
function mistakeIndex(lessons: readonly Lesson[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const l of lessons) {
    for (const m of l.mistakes) {
      for (const hit of `${m.cause} ${m.fix}`.matchAll(/`([a-z][a-z0-9]*(?:-[a-zA-Z0-9]+)+)`/g)) {
        if (!out.has(hit[1])) out.set(hit[1], m.symptom)
      }
    }
  }
  return out
}

/**
 * The picker's groups for `names` (bundled projects). `lesson` = the lesson
 * the learner is on (its requires.firmware lead, solution first).
 */
export function firmwareGroups(
  names: readonly string[],
  lesson: Lesson | null | undefined,
  lessons: readonly Lesson[] = LESSONS,
): FirmwareGroup[] {
  const have = new Set(names)
  const mistakes = mistakeIndex(lessons)
  const used = new Set<string>()
  const exampleText = new Map<string, { title: string; summary: string }>()
  for (const ex of LIBRARY) {
    const p = ex.firmware?.project
    if (p && have.has(p) && !exampleText.has(p)) exampleText.set(p, { title: exampleTitle(ex, t), summary: exampleSummary(ex, t) })
  }
  const option = (name: string): FirmwareOption => {
    const ex = exampleText.get(name)
    const own = FIRMWARE_TEXT[name]
    const symptom = mistakes.get(name)
    return {
      name,
      title: ex?.title ?? (own ? t(own.title) : name),
      summary: symptom ?? ex?.summary ?? (own ? t(own.summary) : t('Built-in firmware')),
      mistake: symptom !== undefined,
    }
  }
  const take = (list: readonly string[]): FirmwareOption[] => {
    const out: FirmwareOption[] = []
    for (const n of list) {
      if (!have.has(n) || used.has(n)) continue
      used.add(n)
      out.push(option(n))
    }
    return out
  }

  const groups: FirmwareGroup[] = []
  if (lesson) {
    const main = Object.values(lesson.solution.firmware ?? {})
    const req = lesson.requires?.firmware ?? []
    // the lesson's own firmware first, then its error demos
    const ordered = [...main, ...req.filter((n) => !mistakes.has(n)), ...req.filter((n) => mistakes.has(n))]
    const opts = take(ordered)
    if (opts.length > 0) groups.push({ id: 'lesson', options: opts })
  }
  const examples = take([...exampleText.keys()])
  if (examples.length > 0) groups.push({ id: 'example', options: examples })
  const rest = take([...names].sort())
  if (rest.length > 0) groups.push({ id: 'other', options: rest })
  return groups
}

/** Search: every whitespace-separated term occurs in the name, title or summary (case-insensitive). */
export function filterGroups(groups: readonly FirmwareGroup[], query: string): FirmwareGroup[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return groups.map((g) => ({ ...g, options: [...g.options] }))
  return groups
    .map((g) => ({
      ...g,
      options: g.options.filter((o) => {
        const hay = `${o.name}\n${o.title}\n${o.summary}`.toLowerCase()
        return terms.every((term) => hay.includes(term))
      }),
    }))
    .filter((g) => g.options.length > 0)
}

const GROUP_TITLE: Record<FirmwareGroupId, string> = {
  lesson: 'Used in this lesson',
  example: 'Example firmware',
  other: 'Other firmware',
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export interface BundledFirmwarePickerProps {
  componentId: string
  /** the button the desktop popover hangs from */
  anchor: HTMLElement | null
  onClose: () => void
  /** bind `name` to the board; resolves to an error text (null = loaded) */
  onPick: (name: string) => Promise<string | null>
  /** file name of the firmware bound now ('hal-blink.elf'), for the ✓ */
  current?: string | null
}

/**
 * The lesson the learner is on (QA IN-F1): the one the coach is guiding;
 * else the one open in the lesson browser — only while that browser is on
 * screen (the workspace Library panel on its 課程 tab, or the phone lessons
 * sheet) AND its circuit is on the board. A lesson viewed earlier in a hidden
 * tab, over a board that was cleared since, recommends nothing.
 */
export function activeLessonId(s: {
  coachId: string | null
  viewId: string | null
  /** the lesson browser is on screen */
  browserShown: boolean
  /** the lesson's circuit is on the board */
  onBoard: (lesson: Lesson) => boolean
}): string | null {
  if (s.coachId) return s.coachId
  if (!s.viewId || !s.browserShown) return null
  const lesson = lessonById(s.viewId)
  return lesson && s.onBoard(lesson) ? s.viewId : null
}

function useActiveLesson(): Lesson | null {
  const coachId = useLessonUi((s) => s.coachId)
  const viewId = useLessonUi((s) => s.viewId)
  const sheetOpen = useLessonUi((s) => s.sheetOpen)
  const workspaceOn = useWorkspaceActive()
  const libraryOnLessons = useLab((s) => s.workspace.left.open && s.workspace.left.tab === 'lessons')
  const layout = useStore((s) => s.layout)
  const id = activeLessonId({
    coachId,
    viewId,
    browserShown: (workspaceOn && libraryOnLessons) || sheetOpen,
    // the lessons' own test (LS-F1): the board descends from this lesson's load, or holds its circuit
    onBoard: (l) => lessonOnBoard(l, layout),
  })
  return id ? (lessonById(id) ?? null) : null
}

export function BundledFirmwarePicker({ componentId, anchor, onClose, onPick, current }: BundledFirmwarePickerProps) {
  const lang = useLang()
  const desktop = useIsDesktop()
  const lesson = useActiveLesson()
  const groups = useMemo(() => firmwareGroups(bundledFirmwareNames(), lesson), [lesson, lang])
  const [query, setQuery] = useState('')
  const shown = useMemo(() => filterGroups(groups, query), [groups, query])
  const flat = useMemo(() => shown.flatMap((g) => g.options), [shown])
  // a lesson's firmware is a recommendation: its row starts highlighted; without one no row
  // is (−1) until an arrow key or a search picks one — Enter loads nothing by surprise (QA IN-F1)
  const recommended = groups[0]?.id === 'lesson'
  const [active, setActive] = useState(() => (recommended ? 0 : -1))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const optId = (i: number) => `${listId}-o${i}`

  const firstQuery = useRef(true)
  useEffect(() => {
    if (firstQuery.current) {
      firstQuery.current = false
      return
    }
    setActive(query.trim() !== '' || recommended ? 0 : -1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])
  useEffect(() => {
    // desktop: type to search right away (phones would pop the keyboard over
    // the list). The popover is placed (made visible) after its first
    // layout pass — focus once it can take focus, two frames later.
    if (!desktop) return
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    })
    return () => cancelAnimationFrame(raf)
  }, [desktop])
  useEffect(() => {
    document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const pick = async (name: string) => {
    if (busy) return
    setBusy(name)
    setError(null)
    const err = await onPick(name)
    setBusy(null)
    if (err) setError(err)
    else onClose()
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (flat.length === 0) return
      setActive((a) => (a < 0 ? 0 : e.key === 'ArrowDown' ? Math.min(flat.length - 1, a + 1) : Math.max(0, a - 1)))
    } else if (e.key === 'Home' && e.target !== inputRef.current) {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End' && e.target !== inputRef.current) {
      e.preventDefault()
      setActive(Math.max(0, flat.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = flat[active]
      if (o) void pick(o.name)
    }
  }

  let index = -1
  const body = (
    <>
      <div className="insp-fwp-head">
        <span className="insp-fwp-title">{t('Built-in firmware for {id}', { id: componentId })}</span>
        <input
          ref={inputRef}
          className="emb-field insp-fwp-search"
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={flat.length > 0 && active >= 0 ? optId(active) : undefined}
          aria-autocomplete="list"
          placeholder={t('Search firmware or examples')}
          aria-label={t('Search firmware or examples')}
          value={query}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {error && (
        <div className="insp-fwp-error" role="alert">
          {error}
        </div>
      )}
      <div
        ref={listRef}
        id={listId}
        className="insp-fwp-list"
        role="listbox"
        aria-label={t('Built-in firmware')}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {flat.length === 0 && <div className="insp-fwp-empty">{t('No built-in firmware matches “{q}”', { q: query.trim() })}</div>}
        {shown.map((g) => (
          <div key={g.id} role="group" aria-label={t(GROUP_TITLE[g.id])}>
            <div className="insp-fwp-group" aria-hidden="true">
              {t(GROUP_TITLE[g.id])}
            </div>
            {g.options.map((o) => {
              index++
              const i = index
              const isCurrent = current === `${o.name}.elf`
              return (
                <div
                  key={o.name}
                  id={optId(i)}
                  role="option"
                  aria-selected={i === active}
                  aria-busy={busy === o.name}
                  className={`insp-fwp-row ${i === active ? 'is-active' : ''} ${isCurrent ? 'is-current' : ''}`}
                  onPointerMove={() => {
                    if (i !== active) setActive(i)
                  }}
                  onClick={() => void pick(o.name)}
                >
                  <span className="insp-fwp-line">
                    <span className="insp-fwp-title-zh">{busy === o.name ? t('Loading…') : o.title}</span>
                    {o.mistake && <span className="insp-fwp-tag is-mistake">{t('Mistake demo')}</span>}
                  </span>
                  <span className="insp-fwp-line">
                    <span className="insp-fwp-name" translate="no">
                      {o.name}
                    </span>
                    <span className="insp-fwp-sum" title={o.summary}>
                      {o.summary}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )

  if (!desktop) {
    return (
      <Sheet open modal snapPoints={[0.86]} onDismiss={onClose} ariaLabel={t('Built-in firmware')} className="insp-fwp-sheet">
        {body}
      </Sheet>
    )
  }
  return (
    <Popover anchor={anchor} onClose={onClose} align="end" className="insp-fwp" aria-label={t('Built-in firmware')}>
      {body}
    </Popover>
  )
}
