/**
 * Visual-regression harness, scene option `firmware` (scripts/visual-regression.mjs):
 * the records + blob rows it seeds before boot are exactly what the lab
 * persists itself, so the lab's REAL boot restore (re-hash, re-parse with the
 * real loader, bind) accepts them — a baseline can show live firmware content.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CircuitLayout } from '../src/model/types'
import {
  FIRMWARE_DB_NAME,
  FIRMWARE_DB_STORE,
  __setFirmwareBlobStoreForTests,
  createMemoryBlobStore,
  type FirmwareBlobStore,
} from '../src/state/firmware-store'
import * as L from '../src/state/lab'
import * as S from '../src/state/store'
// @ts-expect-error — plain .mjs script without type declarations
import { FIRMWARE_DB, LS_FIRMWARE, firmwareSeed } from '../scripts/visual-regression.mjs'

interface SeedRow {
  sha256: string
  name: string
  base64: string
}
interface Seed {
  records: Record<string, { componentId: string; name: string; format: string; sha256: string; size: number }>
  rows: SeedRow[]
}
const seed = firmwareSeed as (map: Record<string, string>) => Seed

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

class MemoryStorage {
  private m = new Map<string, string>()
  get length(): number {
    return this.m.size
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
  clear(): void {
    this.m.clear()
  }
}

const LAYOUT: CircuitLayout = {
  version: 1,
  name: 'two boards',
  components: [
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'U2', type: 'stm32_bluepill', at: 'h35' },
  ],
  wires: [],
}

describe('VR scene firmware seed', () => {
  it('matches the lab storage contract (database, object store, records key)', () => {
    expect(FIRMWARE_DB).toEqual({ name: FIRMWARE_DB_NAME, version: 1, store: FIRMWARE_DB_STORE })
    expect(LS_FIRMWARE).toBe(L.LS_FIRMWARE)
  })

  it('builds records + one blob row per distinct image from firmware/dist', () => {
    const s = seed({ U1: 'hal-oled-ssd1306', U2: 'hal-oled-ssd1306.elf', U3: 'bare-blink.hex' })
    const elf = new Uint8Array(readFileSync('firmware/dist/hal-oled-ssd1306.elf'))
    expect(s.records.U1).toMatchObject({ componentId: 'U1', name: 'hal-oled-ssd1306.elf', format: 'elf', sha256: sha(elf), size: elf.length })
    expect(s.records.U2.sha256).toBe(s.records.U1.sha256)
    expect(s.records.U3).toMatchObject({ name: 'bare-blink.hex', format: 'hex' })
    expect(s.rows.map((r) => r.name)).toEqual(['hal-oled-ssd1306.elf', 'bare-blink.hex'])
    expect(sha(new Uint8Array(Buffer.from(s.rows[0].base64, 'base64')))).toBe(sha(elf))
  })

  it('fails loudly on an unknown image', () => {
    expect(() => seed({ U1: 'no-such-firmware' })).toThrow(/no-such-firmware\.elf not found/)
  })

  describe('the lab boot restore binds the seeded firmware', () => {
    let storage: MemoryStorage
    let blobs: FirmwareBlobStore

    beforeEach(() => {
      storage = new MemoryStorage()
      vi.stubGlobal('window', { localStorage: storage, matchMedia: (q: string) => ({ matches: false, media: q }) })
      blobs = { ...createMemoryBlobStore(), persistent: true }
      __setFirmwareBlobStoreForTests(blobs)
      S.useStore.getState().resetSim()
      S.__resetHistoryForTests()
      S.useStore.setState({ layout: LAYOUT, selection: [], mode: { kind: 'select' }, canUndo: false, canRedo: false })
    })

    afterEach(() => {
      __setFirmwareBlobStoreForTests(null)
      vi.unstubAllGlobals()
    })

    it('records from localStorage + bytes from the blob store → bound, re-hashed, re-parsed', async () => {
      const s = seed({ U1: 'hal-oled-ssd1306', U2: 'hal-blink' })
      // what the harness's init script and IndexedDB seeding write
      storage.setItem(LS_FIRMWARE, JSON.stringify(s.records))
      for (const r of s.rows) await blobs.put(r.sha256, new Uint8Array(Buffer.from(r.base64, 'base64')), r.name)
      await L.__rebootLabForTests()
      const fw = L.useLab.getState().firmware
      expect(Object.keys(fw).sort()).toEqual(['U1', 'U2'])
      expect(fw.U1).toMatchObject({ name: 'hal-oled-ssd1306.elf', format: 'elf', sha256: s.records.U1.sha256 })
      expect(fw.U2).toMatchObject({ name: 'hal-blink.elf', sha256: s.records.U2.sha256 })
      // nothing was dropped on the way (a rejected record would log why)
      expect(L.labBuffers.log().filter((e) => /not restored/.test(e.message))).toEqual([])
      // the project export carries the same bytes (the binding is complete)
      const proj = await L.useLab.getState().exportProject()
      expect(JSON.parse(proj).firmware.U1.sha256).toBe(s.records.U1.sha256)
    })
  })
})
