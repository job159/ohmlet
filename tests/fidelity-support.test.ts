/**
 * The STM32F103 'honest support' table (McuDevice.support, peripherals.ts)
 * re-checked against the peripheral code and the firmware the tests run:
 *
 *  - every `verifiedBy` id is a firmware project that a test actually runs;
 *  - USART2 / USART3 are driven by real HAL firmware (no longer "unit-tested
 *    through USART1") and name those projects;
 *  - DBGMCU's freeze bits reach exactly the blocks that implement a debug
 *    freeze (IWDG, WWDG, TIM1–TIM4 — no longer "future timers");
 *  - every "unit-tested only" claim still holds: no bundled firmware project
 *    uses that feature (a new project that does must update the note).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Stm32f103 } from '../src/mcu/stm32f1/soc'
import { createCortexM3 } from '../src/mcu/core/cpu'
import { PERIPHERALS, supportTable } from '../src/mcu/stm32f1/peripherals'

const ROOT = join(__dirname, '..')
const PROJECTS = join(ROOT, 'firmware/projects')

/** Every *.ts under tests/ (the suites that may run a firmware). */
function testSources(): string {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith('.ts') && !name.startsWith('fidelity-support')) out.push(readFileSync(p, 'utf8'))
    }
  }
  walk(join(ROOT, 'tests'))
  return out.join('\n')
}

/** C sources of every bundled firmware project (main.c + MSP). */
function firmwareSources(): { project: string; text: string }[] {
  return readdirSync(PROJECTS)
    .filter((p) => statSync(join(PROJECTS, p)).isDirectory())
    .map((project) => ({
      project,
      text: readdirSync(join(PROJECTS, project))
        .filter((f) => f.endsWith('.c'))
        .map((f) => readFileSync(join(PROJECTS, project, f), 'utf8'))
        .join('\n'),
    }))
}

describe('McuDevice.support (STM32F103) matches the code', () => {
  const support = supportTable()
  const byName = new Map(support.map((s) => [s.name, s]))

  it('every verifiedBy id is a firmware project some test runs', () => {
    const tests = testSources()
    const bad: string[] = []
    for (const s of support) {
      for (const id of s.verifiedBy ?? []) {
        if (!existsSync(join(PROJECTS, id))) bad.push(`${s.name}: no firmware/projects/${id}`)
        else if (!tests.includes(`'${id}'`) && !tests.includes(`${id}.elf`)) bad.push(`${s.name}: no test runs ${id}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('USART2 / USART3: real HAL firmware, named — and those projects really use the instance', () => {
    for (const [name, ids] of [
      ['USART2', ['hal-ch340', 'hal-hc05', 'hal-esp01', 'hal-rs485']],
      ['USART3', ['hal-rs485']],
    ] as const) {
      const s = byName.get(name)!
      expect(s.notes).not.toMatch(/unit-tested through USART1/)
      expect(s.verifiedBy).toEqual(ids)
      for (const id of ids) expect(readFileSync(join(PROJECTS, id, 'main.c'), 'utf8'), `${id} uses ${name}`).toMatch(new RegExp(`\\b${name}\\b`))
    }
  })

  it('DBGMCU freezes exactly the blocks that implement it (IWDG, WWDG, TIM1–TIM4)', () => {
    const soc = new Stm32f103({ createCore: createCortexM3 })
    const frozenCapable = soc.blocks
      .filter((m) => m.spec.dbgFreezeBit !== undefined && typeof m.block.debugHalt === 'function')
      .map((m) => m.spec.name)
      .sort()
    expect(frozenCapable).toEqual(['IWDG', 'TIM1', 'TIM2', 'TIM3', 'TIM4', 'WWDG'])
    const note = byName.get('DBGMCU')!.notes
    expect(note).toMatch(/IWDG, WWDG and TIM1–TIM4/)
    expect(note).not.toMatch(/future timers/)
    // the remaining freeze bits belong to blocks without a frozen behaviour (SMBus timeout, bxCAN)
    const others = PERIPHERALS.filter((p) => p.dbgFreezeBit !== undefined && !frozenCapable.includes(p.name)).map((p) => p.name)
    expect(others.sort()).toEqual(['CAN', 'I2C1', 'I2C2'])
    expect(note).toMatch(/SMBus-timeout and CAN bits have no effect/)
  })

  it('every "unit-tested only" claim still holds: no bundled firmware uses the feature', () => {
    const fw = firmwareSources()
    // block → [claim the note makes, pattern a firmware using it would contain]
    const claims: [string, RegExp, RegExp][] = [
      ['WWDG', /Unit-tested only/, /HAL_WWDG_|\bWWDG->/],
      ['CRC', /Unit-tested only/, /HAL_CRC_|\bCRC->/],
      // the SPI2 / I2C2 notes only claim their SLAVE mode is unit-tested only
      ['SPI2', /slave mode unit-tested on SPI2/, /SPI_MODE_SLAVE/],
      ['I2C2', /slave mode unit-tested on I2C2/, /HAL_I2C_Slave_|HAL_I2C_EnableListen_IT/],
      ['ADC2', /unit-tested through ADC1/, /\bADC2\b/],
      ['ADC1', /injected group, discontinuous mode, the analog watchdog and timer triggers are unit-tested only/, /InjectedConv|HAL_ADCEx_Injected|DiscontinuousConvMode\s*=\s*ENABLE|AnalogWDG|ExternalTrigConv\s*=\s*ADC_EXTERNALTRIGCONV/],
      ['TIM2', /Unit-tested only \(no firmware yet\): center-aligned and down-counting, one-pulse, gated\/trigger\/external-clock slave modes, ITR chaining, ETR, Hall-sensor/, /COUNTERMODE_DOWN|CENTERALIGNED|TIM_OPMODE_SINGLE|SLAVEMODE_(GATED|TRIGGER|EXTERNAL1)|TIM_TS_ITR|ETRMODE|HallSensor|HAL_TIM_\w+_Start_DMA/],
      ['TIM1', /Unit-tested only: repetition counter, dead time, break, AOE, COM, LOCK/, /PWMN_Start|RepetitionCounter\s*=\s*[1-9]|DeadTime\s*=\s*[1-9]|BREAK_ENABLE|AUTOMATICOUTPUT_ENABLE|LOCKLEVEL_[123]/],
    ]
    const bad: string[] = []
    for (const [name, claim, use] of claims) {
      const s = byName.get(name)
      if (!s) {
        bad.push(`${name}: not in the table`)
        continue
      }
      if (!claim.test(s.notes)) bad.push(`${name}: the note no longer makes the claim this test guards (update the test)`)
      for (const f of fw) if (use.test(f.text)) bad.push(`${name}: firmware ${f.project} uses it — the note's "unit-tested only" is stale`)
    }
    expect(bad).toEqual([])
  })
})
