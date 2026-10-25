/**
 * UX fix wave — helpers H6 (STATE_TONE, SHORTCUTS / withKey), H7 (scene
 * bridge: 'info' level, includeHoles, minElevationDeg, frameTargets,
 * highlightSource — safe no-ops until the scene implements them), H10
 * (activePinFunction — never relabels an I²C pin as USART) and H11
 * (acceptFirmwareFile exported for the canvas drop).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../src/i18n'
import { STATE_TONE, TONE_COLOR, stateColor, type ToneState } from '../src/ui/chrome/run-control'
import { SHORTCUTS, SHORTCUT_GROUPS, ariaKeyshortcutsOf, shortcutKeysText, withKey } from '../src/ui/chrome/ShortcutsSheet'
import { MCU_STATE_META, type McuUiState } from '../src/ui/embedded/format'
import {
  activeProblemFocus,
  activeSourceHighlight,
  focusInScene,
  frameTargets,
  highlightSource,
  problemLevelSupported,
  registerScene,
} from '../src/ui/workspace/scene-bridge'
import { activePinFunction, remapActive } from '../src/ui/embedded/instruments/pin-function'
import { acceptFirmwareFile, isFirmwareFileName } from '../src/ui/embedded/McuPanel'
import { getEntry } from '../src/model/catalog'

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => {
  registerScene(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  __setLangForTests('zh-TW')
})

describe('H6 STATE_TONE', () => {
  it('one colour per state, as UX_VERIFY §5.4 / SH-14 list them', () => {
    expect(STATE_TONE.idle).toBe('neutral')
    expect(STATE_TONE.running).toBe('green')
    expect(STATE_TONE.paused).toBe('blue')
    expect(STATE_TONE.halted).toBe('orange')
    expect(STATE_TONE.fault).toBe('red')
    expect(STATE_TONE.lockup).toBe('red')
    expect(STATE_TONE.unpowered).toBe('red')
    expect(STATE_TONE['boot-sysmem']).toBe('orange')
    expect(STATE_TONE['no-firmware']).toBe('orange')
    expect(stateColor('unpowered')).toBe('var(--ios-red)')
    expect(stateColor('paused')).toBe('var(--ios-blue)')
    expect(TONE_COLOR.neutral).toBe('var(--label-2)')
  })
  it('covers every MCU UI state (the badge can read it for each)', () => {
    for (const s of Object.keys(MCU_STATE_META) as McuUiState[]) expect(STATE_TONE[s as ToneState], s).toBeDefined()
  })
})

describe('H6 SHORTCUTS / withKey', () => {
  it('the sheet groups are built from the one table', () => {
    const rows = SHORTCUT_GROUPS.flatMap((g) => g.rows)
    expect(rows).toContain(SHORTCUTS.step)
    expect(rows).toContain(SHORTCUTS.run)
    expect(shortcutKeysText('step')).toBe('F10')
    expect(shortcutKeysText('reset-mcu')).toBe('Shift+F5')
    expect(shortcutKeysText('run')).toBe('空白鍵')
    expect(shortcutKeysText('analysis-layout')).toBe('Shift+A')
    expect(ariaKeyshortcutsOf('reset-mcu')).toBe('Shift+F5')
    expect(ariaKeyshortcutsOf('run')).toBe('Space')
    expect(ariaKeyshortcutsOf('cancel')).toBe('Escape')
  })
  it('withKey: 「單步（F10）」 + aria-keyshortcuts; a bare label in classic chrome', () => {
    expect(withKey('單步', 'step')).toEqual({ title: '單步（F10）', ariaKeyshortcuts: 'F10' })
    expect(withKey('重置 MCU', 'reset-mcu')).toEqual({ title: '重置 MCU（Shift+F5）', ariaKeyshortcuts: 'Shift+F5' })
    expect(withKey('繼續執行核心', 'halt-resume').title).toBe('繼續執行核心（F5）')
    __setLangForTests('en') // English without the workspace = classic chrome: the keys are not routed there
    expect(withKey('Step', 'step')).toEqual({ title: 'Step' })
  })
})

describe('H7 scene bridge additions', () => {
  it("'info' marks only on a scene that draws it; otherwise it frames like 'guide'", () => {
    const old = { frameTargets: vi.fn(), setProblemHighlights: vi.fn(), frameContent: vi.fn() }
    registerScene(old)
    expect(problemLevelSupported('error')).toBe(true)
    expect(problemLevelSupported('info')).toBe(false)
    expect(focusInScene({ holes: ['a40'] }, { kind: 'problem', level: 'info' })).toBe(true)
    expect(old.frameTargets).toHaveBeenCalledTimes(1)
    expect(old.setProblemHighlights).not.toHaveBeenCalled()
    expect(activeProblemFocus()).toBeNull()

    const fresh = { ...old, setProblemHighlights: vi.fn(), problemHighlightLevels: ['error', 'risk', 'info'] as const }
    registerScene(fresh)
    focusInScene({ holes: ['a40'], components: ['LED1'] }, { kind: 'problem', level: 'info' })
    expect(fresh.setProblemHighlights).toHaveBeenLastCalledWith({ holes: ['a40'], components: ['LED1'], level: 'info' })
  })

  it('includeHoles are framed but not marked; minElevationDeg is forwarded', () => {
    const scene = { frameTargets: vi.fn(), setProblemHighlights: vi.fn(), frameContent: vi.fn() }
    registerScene(scene)
    focusInScene({ holes: ['b40'], components: ['LED1'] }, { kind: 'problem', level: 'error', includeHoles: ['top-40', 'b40'], minElevationDeg: 60 })
    expect(scene.frameTargets).toHaveBeenLastCalledWith({ holes: ['b40', 'top-40'], components: ['LED1'] }, { minElevationDeg: 60 })
    expect(scene.setProblemHighlights).toHaveBeenLastCalledWith({ holes: ['b40'], components: ['LED1'], level: 'error' })
    // frameTargets: frame only, never the problem layer
    expect(frameTargets({ holes: ['a16', 'top-13'] }, { minElevationDeg: 60 })).toBe(true)
    expect(scene.frameTargets).toHaveBeenLastCalledWith({ holes: ['a16', 'top-13'], components: [] }, { minElevationDeg: 60 })
    expect(scene.setProblemHighlights).toHaveBeenCalledTimes(1)
    expect(frameTargets({ holes: [] })).toBe(false)
  })

  it('highlightSource: no camera move, null clears; a safe no-op without setSourceHighlight', () => {
    const plain = { frameTargets: vi.fn(), setProblemHighlights: vi.fn(), frameContent: vi.fn() }
    registerScene(plain)
    expect(highlightSource({ holes: ['c19'] })).toBe(false)
    const scene = { ...plain, setSourceHighlight: vi.fn() }
    registerScene(scene)
    expect(highlightSource({ holes: ['c19', 'c19'], components: ['U1'] })).toBe(true)
    expect(scene.setSourceHighlight).toHaveBeenLastCalledWith({ holes: ['c19'], components: ['U1'] })
    expect(activeSourceHighlight()).toEqual({ holes: ['c19'], components: ['U1'] })
    expect(highlightSource(null)).toBe(true)
    expect(scene.setSourceHighlight).toHaveBeenLastCalledWith(null)
    expect(highlightSource(null)).toBe(true) // already clear: no second call
    expect(scene.setSourceHighlight).toHaveBeenCalledTimes(2)
    expect(plain.frameTargets).not.toHaveBeenCalled()
    registerScene(null)
    expect(activeSourceHighlight()).toBeNull()
  })
})

describe('H10 activePinFunction', () => {
  const fns = (pin: string) => getEntry('stm32_bluepill')!.pinInfo!.find((p) => p.pin === pin)!.functions ?? []
  const usart1On = [{ name: 'USART1', config: { enabled: true } }]

  it('i2c-scan: PB6 / PB7 in open-drain AF are I2C1, never USART1 (the remap is unknown)', () => {
    expect(activePinFunction(fns('PB6'), 'af-od', { uarts: usart1On })).toBe('I2C1_SCL')
    expect(activePinFunction(fns('PB7'), 'af-od', { uarts: usart1On })).toBe('I2C1_SDA')
    expect(activePinFunction(fns('PB6'), 'af', { uarts: usart1On })).toBeNull() // I2C1_SCL or TIM4_CH1: ambiguous
  })
  it('uart-hello: PA9 is still USART1_TX', () => {
    expect(activePinFunction(fns('PA9'), 'af', { uarts: usart1On })).toBe('USART1_TX')
    expect(activePinFunction(fns('PA9'), 'af', { uarts: [] })).toBeNull()
  })
  it('a known AFIO_MAPR selects remapped functions and drops the moved defaults', () => {
    const USART1_REMAP = 1 << 2
    expect(activePinFunction(fns('PB6'), 'af', { uarts: usart1On, mapr: USART1_REMAP })).toBe('USART1_TX')
    expect(activePinFunction(fns('PA9'), 'af', { uarts: usart1On, mapr: USART1_REMAP })).toBe('TIM1_CH2')
    const I2C1_REMAP = 1 << 1
    expect(activePinFunction(fns('PB8'), 'af-od', { mapr: I2C1_REMAP })).toBe('I2C1_SCL')
    // I²C1 moved to PB8/PB9 and USART1 not remapped: the only AF left on PB6 is TIM4_CH1
    expect(activePinFunction(fns('PB6'), 'af-od', { mapr: I2C1_REMAP })).toBe('TIM4_CH1')
    expect(remapActive('TIM3_CH1 (remap)', 2 << 10)).toBe(true)
    expect(remapActive('TIM3_CH1', 3 << 10)).toBe(false) // full remap goes to PC6, not PB4
    expect(remapActive('TIM2_CH3', 2 << 8)).toBe(true)
    expect(remapActive('TIM2_CH1_ETR', 2 << 8)).toBe(false)
  })
  it('only AF modes carry a function', () => {
    expect(activePinFunction(fns('PA9'), 'out', { uarts: usart1On })).toBeNull()
    expect(activePinFunction(fns('PA9'), undefined, { uarts: usart1On })).toBeNull()
  })
  it('a JTAG pin in AF mode is never "NJTRST" / "JTDO": without MAPR its remap is unknown', () => {
    expect(activePinFunction(fns('PB4'), 'af', {})).toBeNull()
    expect(activePinFunction(fns('PB3'), 'af', {})).toBeNull()
    expect(activePinFunction(fns('PB4'), 'af', { mapr: 2 << 10 })).toBe('TIM3_CH1') // TIM3 partial remap
    expect(activePinFunction(fns('PB4'), 'af', { mapr: 1 })).toBe('SPI1_MISO') // SPI1 remap
  })
})

describe('H11 acceptFirmwareFile', () => {
  it('is exported with the file-name check the canvas drop uses', () => {
    expect(typeof acceptFirmwareFile).toBe('function')
    expect(isFirmwareFileName('hal-i2c-scan.elf')).toBe(true)
    expect(isFirmwareFileName('BLINK.HEX')).toBe(true)
    expect(isFirmwareFileName('fw.bin')).toBe(true)
    expect(isFirmwareFileName('notes.txt')).toBe(false)
    expect(isFirmwareFileName('elf')).toBe(false) // no extension
    // a refused file never reaches the loader
    expect(acceptFirmwareFile('U1', { name: 'notes.txt' } as File)).toBe('refused')
    expect(acceptFirmwareFile('U1', { name: 'raw.bin' } as File)).toBe('needs-address')
  })
})
