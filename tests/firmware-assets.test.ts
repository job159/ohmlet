import { describe, expect, it } from 'vitest'
import { bundledFirmwareNames, hasBundledFirmware, loadBundledFirmware } from '../src/firmware-assets'
import { loadFirmwareFile } from '../src/mcu/loader'

describe('bundled firmware assets', () => {
  it('lists every firmware/dist ELF and loads one as a valid image', async () => {
    const names = bundledFirmwareNames()
    expect(names).toContain('hal-blink')
    expect(names.length).toBeGreaterThan(40)
    expect(hasBundledFirmware('hal-blink')).toBe(true)
    expect(hasBundledFirmware('nope')).toBe(false)
    const { name, bytes } = await loadBundledFirmware('hal-blink')
    expect(name).toBe('hal-blink.elf')
    const r = loadFirmwareFile(name, bytes)
    expect(r.ok).toBe(true)
  })
  it('rejects unknown names', async () => {
    await expect(loadBundledFirmware('does-not-exist')).rejects.toThrow(/unknown bundled firmware/)
  })
})
