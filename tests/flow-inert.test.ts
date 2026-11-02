/**
 * 顯示電流 costs no per-part work: ComponentTelemetry.pinCurrents (window
 * means that change every frame while tracking) is visually inert for the
 * part meshes — only the flow layer reads it, from the whole snapshot — so a
 * part whose other telemetry is unchanged skips its updater and its matrix
 * recomposition (src/three/component-meshes.ts VISUALLY_INERT_TELEMETRY_KEYS).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sameVisualTelemetry, VISUALLY_INERT_TELEMETRY_KEYS } from '../src/three/component-meshes'
import type { ComponentTelemetry } from '../src/model/types'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...filesUnder(p))
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('pinCurrents is visually inert for part meshes', () => {
  it('is listed, and no mesh updater reads it', () => {
    expect(VISUALLY_INERT_TELEMETRY_KEYS.has('pinCurrents')).toBe(true)
    const readers = filesUnder(join(ROOT, 'src/three/meshes')).filter((f) => readFileSync(f, 'utf8').includes('pinCurrents'))
    expect(readers).toEqual([])
    // component-meshes itself only names it in the inert set
    const cm = readFileSync(join(ROOT, 'src/three/component-meshes.ts'), 'utf8')
    expect(cm.match(/pinCurrents/g)?.length ?? 0).toBeLessThanOrEqual(2)
  })

  it('two snapshots that differ only in pin currents are the same visual input', () => {
    const a: ComponentTelemetry = { pinVoltages: { anode: 2, cathode: 0 }, ledBrightness: 0.4, pinCurrents: { anode: 0.004, cathode: -0.004 } }
    const b: ComponentTelemetry = { pinVoltages: { anode: 2, cathode: 0 }, ledBrightness: 0.4, pinCurrents: { anode: 0.0041, cathode: -0.0041 } }
    expect(sameVisualTelemetry(a, b)).toBe(true)
    const c: ComponentTelemetry = { ...b, ledBrightness: 0.5 }
    expect(sameVisualTelemetry(a, c)).toBe(false) // a real visual change still refreshes the part
  })
})
