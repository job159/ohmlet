/**
 * One judgement of a pin's alternate function everywhere (UX helper H10,
 * src/ui/embedded/instruments/pin-function.ts): the inspector's pin rows
 * (PartInfo.tsx PinoutGroup → pinFunctionChipState) and the problems check of
 * an advanced timer's outputs (problems.ts timerPwmPins) pass the board's
 * frame through pinFunctionContext() — the USARTs AND the AFIO_MAPR the
 * firmware programmed — exactly like the logic analyzer's channel picker. A
 * firmware that remaps USART1 to PB6 / PB7 gets 「USART1_TX（重映射）」 lit on
 * PB6 in the inspector, and PA9 (left to TIM1_CH2) counts as a TIM1 output.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setLangForTests, t } from '../src/i18n'
import { CATALOG } from '../src/model/catalog'
import type { ComponentTelemetry, SimTelemetry } from '../src/model/types'
import type { McuFrameInfo, SimLogEntry } from '../src/sim/coordinator/api'
import { runErc } from '../src/sim/erc'
import { useStore } from '../src/state/store'
import { useLab } from '../src/ui/embedded/lab'
import { pinFunctionChipState } from '../src/ui/embedded/PartInfo'
import { __resetProblemsForTests, deriveProblems, type ProblemsInput } from '../src/ui/embedded/problems'
import { activePinFunction, pinFunctionContext } from '../src/ui/embedded/instruments/pin-function'
import { channelPickerGroups } from '../src/ui/embedded/instruments/channel-picker'
import { pinModeLabel } from '../src/ui/embedded/text'
import { bluePill, valid } from './erc/helpers'

/** USART1 remapped to PB6 / PB7 (AFIO_MAPR bit 2). */
const MAPR_USART1 = 1 << 2
const UART1_ON = [{ name: 'USART1', config: { enabled: true, baud: 115200, dataBits: 8, parity: 'none', stopBits: 1 } }]

function frame(mapr?: number): McuFrameInfo {
  return {
    componentId: 'U1',
    state: 'running',
    firmware: 'remap.elf',
    pc: 0x08000100,
    hclkHz: 72e6,
    cycles: 1,
    realtime: 1,
    uarts: UART1_ON as unknown as McuFrameInfo['uarts'],
    ...(mapr === undefined ? {} : { mapr }),
  }
}

const MODES: Record<string, string> = { PB6: 'af', PB7: 'af-od', PA8: 'af', PA9: 'af' }
const tele = (): ComponentTelemetry => ({
  pinVoltages: {},
  mcu: { state: 'running', pc: 0x08000100, hclkHz: 72e6, cycles: 1, pinModes: MODES },
})

beforeEach(() => __setLangForTests('zh-TW'))
afterEach(() => {
  __resetProblemsForTests()
  useStore.setState({ running: false, simTime: 0 })
  useLab.setState({ firmware: {}, mcus: {} })
  __setLangForTests('en')
})

/** The inspector's function chips of one Blue Pill pin, composed exactly as PinoutGroup does with the board's frame. */
function chips(pin: string, f: McuFrameInfo): Record<string, string> {
  const fns = CATALOG.stm32_bluepill.pinInfo!.find((p) => p.pin === pin)!.functions!
  const mode = MODES[pin]
  const pfc = pinFunctionContext(f)
  const active = activePinFunction(fns, mode, pfc)
  const enabled = new Set((f.uarts ?? []).filter((u) => u.config.enabled).map((u) => u.name))
  return Object.fromEntries(fns.map((fn) => [fn, pinFunctionChipState(fn, mode, active, enabled, pfc.mapr)]))
}

describe('the catalog never lists one function both plain and remapped on a pin', () => {
  it('so a remap chip matches H10’s name without the tag', () => {
    for (const p of CATALOG.stm32_bluepill.pinInfo ?? []) {
      const base = (p.functions ?? []).map((f) => f.replace(/ (remap)$/, ''))
      expect(new Set(base).size, p.pin).toBe(base.length)
    }
  })
})

describe('inspector pin rows use the board’s AFIO_MAPR (PartInfo pinFunctionChipState)', () => {
  it('USART1 remapped: PB6 lights USART1_TX (remap), the name the logic analyzer’s picker gives', () => {
    const f = frame(MAPR_USART1)
    expect(chips('PB6', f)).toEqual({ I2C1_SCL: 'dim', TIM4_CH1: 'dim', 'USART1_TX (remap)': 'active' })
    // PB7 in open-drain AF is the I²C pin H10 prefers; USART1_RX is an input (never "the" output function)
    expect(chips('PB7', f)['I2C1_SDA']).toBe('active')
    // PA9: USART1 moved away, so TIM1_CH2 is what it carries
    expect(chips('PA9', f)).toEqual({ USART1_TX: 'dim', TIM1_CH2: 'active' })
    const groups = channelPickerGroups({
      layout: valid(bluePill()),
      telemetry: { time: 1, netVoltages: {}, issues: [], components: { U1: tele() } },
      mcus: { U1: f },
      channels: [],
      tr: t,
      modeLabel: pinModeLabel,
    })
    const label = (pin: string) => groups.flatMap((g) => g.options).find((o) => o.value === `mcu|U1|${pin}`)?.label ?? ''
    expect(label('PB6')).toMatch(/USART1_TX/)
    expect(label('PA9')).toMatch(/TIM1_CH2/)
  })

  it('reset mapping (MAPR reported 0, or not reported): PB6 does not claim USART1, PA9 is USART1_TX', () => {
    for (const f of [frame(0), frame(undefined)]) {
      expect(chips('PB6', f)['USART1_TX (remap)']).toBe('dim')
      expect(chips('PA9', f)).toEqual({ USART1_TX: 'active', TIM1_CH2: 'dim' })
    }
  })
})

describe('the TIM1 outputs check uses the board’s AFIO_MAPR (problems.ts timerPwmPins)', () => {
  const log: SimLogEntry[] = [
    {
      time: 0.4,
      level: 'warning',
      source: 'U1/TIM1',
      message:
        'TIM1 is counting with CCxE/CCxNE set but BDTR.MOE = 0: an advanced-control timer keeps its outputs disabled until the main output enable is set (RM0008 §14.4.18). HAL_TIM_PWM_Start() sets it; register-level code needs TIM1->BDTR |= TIM_BDTR_MOE.',
    },
  ]
  const telemetry: SimTelemetry = { time: 1, netVoltages: {}, issues: [], components: { U1: tele() } }
  const FW = { componentId: 'U1', name: 'remap.elf', format: 'elf' as const, sha256: 'a'.repeat(64), size: 1, loadedAt: 0, warnings: [] }
  const moeTitle = (mapr?: number) => {
    const l = valid(bluePill())
    const input: ProblemsInput = {
      layout: l,
      findings: runErc(l),
      issues: [],
      firmware: { U1: FW },
      mcus: { U1: frame(mapr) },
      running: true,
      simTime: 1,
      log,
      telemetry,
    }
    return deriveProblems(input).filter((p) => p.fact === 'tim-moe:U1:TIM1').map((p) => p.title)
  }

  it('reset mapping: PA9 is the enabled USART1’s TX, so only PA8 lacks PWM', () => {
    expect(moeTitle(0)).toEqual(['TIM1 的輸出被關閉（MOE = 0）——PA8 沒有 PWM'])
  })

  it('USART1 remapped to PB6 / PB7: PA9 is TIM1_CH2 again, so PA8 and PA9 lack PWM', () => {
    const [title] = moeTitle(MAPR_USART1)
    expect(title).toMatch(/^TIM1 的輸出被關閉（MOE = 0）——PA8.*PA9 沒有 PWM$/)
  })
})
