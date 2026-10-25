/**
 * Project files (src/state/project.ts) and their codecs
 * (src/state/firmware-store.ts): the SHA-256 / base64 implementations against
 * node's reference ones, the envelope round trip (layout + byte-exact
 * firmware + workspace + logic channels), legacy bare-layout import through
 * the migration table, and rejection of corrupted JSON, newer format
 * versions, SHA-256 / size / base64 corruption.
 */
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CircuitLayout } from '../src/model/types'
import { validateLayout } from '../src/model/validate'
import {
  base64ToBytes,
  bytesToBase64,
  createMemoryBlobStore,
  isSha256Hex,
  sha256Hex,
} from '../src/state/firmware-store'
import {
  APP_VERSION,
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  parseProject,
  sanitizeLogicChannels,
  serializeProject,
} from '../src/state/project'
import type { WorkspacePrefs } from '../src/state/lab-types'

const nodeSha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

/** byte-exact equality without a per-element deep-equal walk (firmware images are 100s of KiB) */
const sameBytes = (a: Uint8Array | null | undefined, b: Uint8Array): boolean =>
  !!a && a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.length).equals(Buffer.from(b.buffer, b.byteOffset, b.length))

/** A Blue Pill (anchor h10 → pins h10..h29 + c29..c10) plus an LED circuit on its PC13 side. */
const LAB_LAYOUT: CircuitLayout = {
  version: 1,
  name: 'blue pill lab',
  components: [
    { id: 'PS1', type: 'power_supply', params: { voltage: 5 } },
    { id: 'U1', type: 'stm32_bluepill', at: 'h10' },
    { id: 'R1', type: 'resistor', holes: ['a40', 'a44'], params: { resistance: 330 } },
  ],
  wires: [
    { id: 'W1', from: 'PS1:+', to: 'top+3', color: 'red' },
    { id: 'W2', from: 'PS1:-', to: 'top-3', color: 'black' },
  ],
}

const WORKSPACE: WorkspacePrefs = {
  v: 1,
  enabled: true,
  left: { open: false, width: 280, tab: 'examples' },
  right: { open: true, width: 360 },
  tray: { open: true, height: 300, tab: 'logic' },
}

const FIXED_DATE = new Date('2026-10-09T12:00:00.000Z')

// ---------------------------------------------------------------------------

describe('sha256Hex (FIPS 180-4)', () => {
  it('matches the published test vectors', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('agrees with node:crypto across every padding boundary and a large buffer', () => {
    for (const n of [1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4096]) {
      const b = new Uint8Array(randomBytes(n))
      expect(sha256Hex(b), `length ${n}`).toBe(nodeSha(b))
    }
    const big = new Uint8Array(randomBytes(300_000))
    expect(sha256Hex(big)).toBe(nodeSha(big))
  })

  it('hashes a real firmware image like the toolchain manifest tools do', () => {
    const elf = new Uint8Array(readFileSync('firmware/dist/hal-blink.elf'))
    expect(sha256Hex(elf)).toBe(nodeSha(elf))
    expect(isSha256Hex(sha256Hex(elf))).toBe(true)
  })
})

describe('base64 (RFC 4648)', () => {
  it('round-trips and matches Buffer for every remainder length', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 100, 8191, 8192, 8193, 70_000]) {
      const b = new Uint8Array(randomBytes(n))
      const text = bytesToBase64(b)
      expect(text, `length ${n}`).toBe(Buffer.from(b).toString('base64'))
      expect(sameBytes(base64ToBytes(text), b), `decode ${n}`).toBe(true)
    }
  })

  it('rejects malformed input instead of half-decoding it', () => {
    expect(base64ToBytes('QUJD')).toEqual(enc('ABC'))
    expect(base64ToBytes('QQ==')).toEqual(enc('A'))
    for (const bad of ['QUJ', 'QU=D', 'Q===', '@@@@', 'QR==', 'QUI=QUJD', 'QUJD\n', 'ÀÀÀÀ']) {
      expect(base64ToBytes(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('memory blob store', () => {
  it('stores copies by sha and reports itself non-persistent', async () => {
    const s = createMemoryBlobStore()
    const bytes = enc('firmware')
    const sha = sha256Hex(bytes)
    await s.put(sha, bytes, 'fw.bin')
    bytes[0] = 0 // caller mutation must not reach the stored copy
    expect(await s.get(sha)).toEqual(enc('firmware'))
    expect(await s.keys()).toEqual([sha])
    await s.delete(sha)
    expect(await s.get(sha)).toBeNull()
    expect(s.persistent).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('project envelope v1', () => {
  it('the lab layout used below is valid', () => {
    const res = validateLayout(LAB_LAYOUT)
    expect(res.errors).toEqual([])
    expect(res.ok).toBe(true)
  })

  it('round-trips layout, byte-exact firmware, workspace and logic channels', () => {
    const elf = new Uint8Array(readFileSync('firmware/dist/hal-blink.elf'))
    const text = serializeProject(
      {
        layout: LAB_LAYOUT,
        firmware: { U1: { name: 'hal-blink.elf', format: 'elf', bytes: elf } },
        workspace: WORKSPACE,
        instruments: {
          logicChannels: [
            { index: 0, label: 'LED', source: { kind: 'mcu-pin', componentId: 'U1', pin: 'PC13' } },
            { index: 3, label: 'net', source: { kind: 'net', ref: 'a40' } },
          ],
        },
      },
      { savedAt: FIXED_DATE },
    )
    const env = JSON.parse(text)
    expect(env.format).toBe(PROJECT_FORMAT)
    expect(env.formatVersion).toBe(PROJECT_FORMAT_VERSION)
    expect(env.app).toEqual({ name: 'ohmlet', version: APP_VERSION })
    expect(env.savedAt).toBe('2026-10-09T12:00:00.000Z')
    expect(env.firmware.U1.sha256).toBe(nodeSha(elf))
    expect(env.firmware.U1.size).toBe(elf.length)

    const res = parseProject(text)
    if (!res.ok) throw new Error(res.errors.join('; '))
    expect(res.warnings).toEqual([])
    const p = res.project
    expect(p.sourceFormatVersion).toBe(1)
    expect(p.app).toEqual({ name: 'ohmlet', version: APP_VERSION })
    expect(p.layout).toEqual(validateLayout(LAB_LAYOUT).layout)
    expect(p.firmware).toHaveLength(1)
    expect(p.firmware[0].componentId).toBe('U1')
    expect(p.firmware[0].format).toBe('elf')
    expect(p.firmware[0].name).toBe('hal-blink.elf')
    expect(sameBytes(p.firmware[0].bytes, elf)).toBe(true)
    expect(p.workspace).toEqual(WORKSPACE)
    expect(p.instruments?.logicChannels.map((c) => c.index)).toEqual([0, 3])
    expect(p.instruments?.logicChannels[0].source).toEqual({ kind: 'mcu-pin', componentId: 'U1', pin: 'PC13' })
  })

  it('serializes deterministically (same contents → same text)', () => {
    const bin = new Uint8Array(readFileSync('firmware/dist/bare-blink.bin'))
    const c = { layout: LAB_LAYOUT, firmware: { U1: { name: 'b.bin', format: 'bin' as const, bytes: bin } } }
    expect(serializeProject(c, { savedAt: FIXED_DATE })).toBe(serializeProject(c, { savedAt: FIXED_DATE }))
  })

  it('keeps a BIN image\'s chosen load address', () => {
    const bin = new Uint8Array(readFileSync('firmware/dist/bare-blink.bin'))
    const text = serializeProject({
      layout: LAB_LAYOUT,
      firmware: { U1: { name: 'b.bin', format: 'bin', bytes: bin, binBase: 0x08004000 } },
    })
    const res = parseProject(text)
    if (!res.ok) throw new Error(res.errors.join('; '))
    expect(res.project.firmware[0].binBase).toBe(0x08004000)
    expect(sameBytes(res.project.firmware[0].bytes, bin)).toBe(true)
  })

  it('ignores (with a warning) firmware for a component that is not an MCU board', () => {
    const text = serializeProject({
      layout: LAB_LAYOUT,
      firmware: {
        R1: { name: 'x.bin', format: 'bin', bytes: enc('nope') },
        U1: { name: 'y.bin', format: 'bin', bytes: enc('yes') },
      },
    })
    const res = parseProject(text)
    if (!res.ok) throw new Error(res.errors.join('; '))
    expect(res.project.firmware.map((f) => f.componentId)).toEqual(['U1'])
    expect(res.warnings.join('\n')).toMatch(/"R1"/)
  })
})

describe('legacy import (bare CircuitLayout = format v0)', () => {
  it('accepts every bundled example layout through the 0 → 1 migration', () => {
    for (const file of ['blinky-555.json', 'counter.json', 'date-display.json', 'night-light.json']) {
      const text = readFileSync(`examples/${file}`, 'utf8')
      const res = parseProject(text)
      if (!res.ok) throw new Error(`${file}: ${res.errors.join('; ')}`)
      expect(res.project.sourceFormatVersion, file).toBe(0)
      expect(res.project.app).toBeNull()
      expect(res.project.firmware).toEqual([])
      expect(res.project.workspace).toBeNull()
      // UX IS-18: the load-time id normalisation writes lower-case wire ids 'w<n>' as 'W<n>'
      const want = validateLayout(JSON.parse(text)).layout!
      expect(res.project.layout).toEqual({ ...want, wires: want.wires.map((w) => ({ ...w, id: w.id.replace(/^w(\d+)$/, 'W$1') })) })
    }
  })

  it('accepts what AppState.exportJson writes (a bare layout)', () => {
    const res = parseProject(JSON.stringify(LAB_LAYOUT, null, 2))
    expect(res.ok).toBe(true)
  })

  it('reports validator errors of a bad legacy layout, prefixed', () => {
    const res = parseProject(JSON.stringify({ version: 2, components: [], wires: [] }))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors[0]).toMatch(/^layout: "version"/)
  })
})

describe('rejection', () => {
  const valid = (): Record<string, unknown> =>
    JSON.parse(
      serializeProject({
        layout: LAB_LAYOUT,
        firmware: { U1: { name: 'fw.bin', format: 'bin', bytes: new Uint8Array(randomBytes(300)) } },
      }),
    )

  it('corrupted JSON', () => {
    const res = parseProject('{"format":"ohmlet-project","formatVersion":1,')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors[0]).toMatch(/not valid JSON/)
    expect(parseProject('42').ok).toBe(false)
    expect(parseProject('{"hello":1}').ok).toBe(false)
  })

  it('a newer formatVersion, with a clear message naming both versions', () => {
    const env = valid()
    env.formatVersion = PROJECT_FORMAT_VERSION + 1
    env.app = { name: 'ohmlet', version: '9.9.9' }
    const res = parseProject(JSON.stringify(env))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors[0]).toMatch(/newer/)
    expect(res.errors[0]).toMatch(/9\.9\.9/)
    expect(res.errors[0]).toMatch(new RegExp(`v${PROJECT_FORMAT_VERSION + 1}`))
    expect(res.errors[0]).toMatch(/update ohmlet/)
  })

  it('an unknown format tag or a malformed formatVersion', () => {
    const env = valid()
    expect(parseProject(JSON.stringify({ ...env, format: 'other-app' })).ok).toBe(false)
    expect(parseProject(JSON.stringify({ ...env, formatVersion: '1' })).ok).toBe(false)
    expect(parseProject(JSON.stringify({ ...env, formatVersion: 0 })).ok).toBe(false)
  })

  it('a SHA-256 mismatch (one flipped bit in the embedded firmware)', () => {
    const env = valid() as { firmware: { U1: { data: string } } }
    const bytes = base64ToBytes(env.firmware.U1.data)!
    bytes[17] ^= 0x01
    env.firmware.U1.data = bytesToBase64(bytes)
    const res = parseProject(JSON.stringify(env))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.join('\n')).toMatch(/SHA-256 mismatch/)
  })

  it('a size mismatch, invalid base64, or a malformed entry', () => {
    const sized = valid() as { firmware: { U1: { size: number } } }
    sized.firmware.U1.size += 1
    expect(parseProject(JSON.stringify(sized)).ok).toBe(false)

    const b64 = valid() as { firmware: { U1: { data: string } } }
    b64.firmware.U1.data = b64.firmware.U1.data.slice(1)
    const r2 = parseProject(JSON.stringify(b64))
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.errors.join('\n')).toMatch(/base64/)

    const fmt = valid() as { firmware: { U1: { format: string } } }
    fmt.firmware.U1.format = 'exe'
    expect(parseProject(JSON.stringify(fmt)).ok).toBe(false)
  })

  it('an invalid layout inside the envelope', () => {
    const env = valid() as { layout: { components: unknown[] } }
    env.layout.components.push({ id: 'X1', type: 'flux_capacitor', holes: ['a1', 'a2'] })
    const res = parseProject(JSON.stringify(env))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.every((e) => e.startsWith('layout: '))).toBe(true)
  })
})

describe('sanitizeLogicChannels', () => {
  it('keeps well-formed channels sorted by index and reports the rest', () => {
    const { channels, warnings } = sanitizeLogicChannels([
      { index: 2, label: 'B', source: { kind: 'net', ref: 'a1' } },
      { index: 0, label: 'A', source: { kind: 'probe', componentId: 'P1' } },
      { index: 2, label: 'dup', source: { kind: 'net', ref: 'a2' } },
      { index: 16, label: 'too high', source: { kind: 'net', ref: 'a3' } },
      { index: 4, label: 'bad src', source: { kind: 'mcu-pin', componentId: 'U1' } },
      'garbage',
    ])
    expect(channels.map((c) => [c.index, c.label])).toEqual([
      [0, 'A'],
      [2, 'B'],
    ])
    expect(warnings).toHaveLength(4)
    expect(sanitizeLogicChannels('nope').channels).toEqual([])
  })
})
