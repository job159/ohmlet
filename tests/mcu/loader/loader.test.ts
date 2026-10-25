/**
 * Firmware loaders: ELF / BIN / Intel HEX → FirmwareImage, plus the pure-TS
 * SHA-256. The committed firmware/dist builds are the fixtures: the three
 * formats objcopy produced from one ELF must program identical bytes.
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findSymbol, type FirmwareImage, type LoadResult } from '../../../src/mcu/firmware'
import { detectFormat, loadBin, loadElf, loadFirmwareFile, loadHex, sha256Hex } from '../../../src/mcu/loader'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'firmware', 'dist')
const file = (n: string) => new Uint8Array(readFileSync(join(DIST, n)))
const nodeSha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const enc = (s: string) => new TextEncoder().encode(s)

function ok(r: LoadResult): FirmwareImage {
  if (!r.ok) throw new Error(r.error)
  return r.image
}
function err(r: LoadResult): string {
  if (r.ok) throw new Error('expected a load error')
  return r.error
}

/** programmed bytes as one address → byte map (flattened, comparable across formats) */
function flat(img: FirmwareImage): Map<number, number> {
  const m = new Map<number, number>()
  for (const s of img.segments) s.data.forEach((b, i) => m.set(s.addr + i, b))
  return m
}

describe('sha256 (FIPS 180-4 vectors)', () => {
  it('matches the published test vectors', () => {
    expect(sha256Hex(enc(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
    expect(
      sha256Hex(enc('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu')),
    ).toBe('cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1')
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
  })

  it('agrees with node:crypto at every padding boundary', () => {
    for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
      const b = new Uint8Array(n).map((_, i) => (i * 131 + 7) & 0xff)
      expect(sha256Hex(b), `length ${n}`).toBe(nodeSha(b))
    }
  })

  it('hashes a subarray view, not its whole buffer', () => {
    const big = new Uint8Array(200).map((_, i) => i)
    const view = big.subarray(10, 110)
    expect(sha256Hex(view)).toBe(nodeSha(view))
  })
})

describe.each(['hal-blink', 'bare-blink'])('%s: ELF / BIN / HEX', (name) => {
  const elfBytes = file(`${name}.elf`)
  const elf = ok(loadElf(elfBytes, `${name}.elf`))
  const bin = ok(loadBin(file(`${name}.bin`), `${name}.bin`))
  const hex = ok(loadHex(file(`${name}.hex`), `${name}.hex`))

  it('the three formats program identical bytes', () => {
    expect(elf.segments.length).toBeGreaterThan(0)
    const a = flat(elf)
    expect(flat(bin)).toEqual(a)
    expect(flat(hex)).toEqual(a)
    // merged + sorted: objcopy output is one contiguous block starting at flash base
    expect(elf.segments.map((s) => [s.addr, s.data.length])).toEqual(hex.segments.map((s) => [s.addr, s.data.length]))
    expect(elf.segments[0].addr).toBe(0x08000000)
  })

  it('programs .data by its LMA and never programs .bss', () => {
    for (const s of elf.segments) {
      expect(s.addr >= 0x08000000 && s.addr + s.data.length <= 0x08010000).toBe(true)
    }
  })

  it('reads entry, vector table, symbols and hash', () => {
    const reset = new DataView(elf.segments[0].data.buffer, elf.segments[0].data.byteOffset).getUint32(4, true)
    expect(elf.entry).toBe(reset) // ELF entry = Reset_Handler with the Thumb bit
    expect(elf.entry! & 1).toBe(1)
    expect(hex.entry).toBe(elf.entry) // objcopy writes it as a type-05 record
    expect(bin.entry).toBeNull()
    const main = findSymbol(elf, 'main')!
    expect(main.kind).toBe('func')
    expect(main.addr & 1).toBe(0)
    expect(main.size).toBeGreaterThan(0)
    const rh = findSymbol(elf, 'Reset_Handler')!
    expect(rh.addr).toBe(elf.entry! & ~1)
    expect(elf.symbols.some((s) => s.name.startsWith('$'))).toBe(false)
    expect(elf.sha256).toBe(nodeSha(elfBytes))
    expect(elf.fileSize).toBe(elfBytes.length)
    expect(hex.sha256).toBe(nodeSha(file(`${name}.hex`)))
    expect(elf.description).toMatch(/^ELF32 ARM, EABI5, soft-float, Thumb entry 0x080[0-9a-f]{5}$/)
    expect(elf.format).toBe('elf')
    expect(bin.format).toBe('bin')
    expect(hex.format).toBe('hex')
  })
})

describe('ELF specifics', () => {
  const hal = file('hal-blink.elf')

  it('hal-blink: .data comes from its LMA, SystemCoreClock is an object symbol', () => {
    const img = ok(loadElf(hal, 'hal-blink.elf'))
    const scc = findSymbol(img, 'SystemCoreClock')!
    expect(scc.kind).toBe('object')
    // VMA in RAM (llvm-nm: 20000008 D SystemCoreClock); its initial value lives at the LMA in flash
    expect(scc.addr).toBe(0x20000008)
    expect(scc.size).toBe(4)
    expect(findSymbol(img, 'HAL_RCC_OscConfig')?.kind).toBe('func')
    expect(img.warnings).toEqual([])
  })

  const patch = (at: number, bytes: number[]) => {
    const b = hal.slice()
    bytes.forEach((v, i) => (b[at + i] = v))
    return b
  }

  it('rejects wrong class, endianness, machine and type with precise messages', () => {
    expect(err(loadElf(enc('hello world'), 'x.elf'))).toMatch(/not an ELF file/)
    expect(err(loadElf(patch(4, [2]), 'x.elf'))).toMatch(/ELF64.*32-bit/)
    expect(err(loadElf(patch(5, [2]), 'x.elf'))).toMatch(/big-endian/)
    expect(err(loadElf(patch(18, [62, 0]), 'x.elf'))).toMatch(/x86-64.*not ARM/)
    expect(err(loadElf(patch(18, [243, 0]), 'x.elf'))).toMatch(/RISC-V/)
    expect(err(loadElf(patch(16, [1, 0]), 'x.elf'))).toMatch(/relocatable object/)
  })

  it('detects truncation of the header, program headers and segments', () => {
    expect(err(loadElf(hal.slice(0, 40), 'x.elf'))).toMatch(/truncated ELF: 40 bytes.*52/)
    expect(err(loadElf(hal.slice(0, 100), 'x.elf'))).toMatch(/truncated ELF: program header table/)
    expect(err(loadElf(hal.slice(0, 0x10200), 'x.elf'))).toMatch(/truncated ELF: segment 1 .*extends past the end/)
  })

  it('a stripped ELF (no section headers) still loads, with a warning', () => {
    const b = patch(32, [0, 0, 0, 0]) // e_shoff = 0
    b[48] = 0 // e_shnum
    b[49] = 0
    const img = ok(loadElf(b, 'stripped.elf'))
    expect(img.symbols).toEqual([])
    expect(img.warnings.join()).toMatch(/stripped/)
  })
})

describe('Intel HEX specifics', () => {
  const text = new TextDecoder().decode(file('hal-blink.hex'))

  it('accepts LF and CRLF identically', () => {
    const lf = ok(loadHex(text.replace(/\r\n/g, '\n'), 'lf.hex'))
    const crlf = ok(loadHex(text.replace(/\r?\n/g, '\r\n'), 'crlf.hex'))
    expect(flat(crlf)).toEqual(flat(lf))
    expect(crlf.entry).toBe(lf.entry)
  })

  it('validates checksums, record syntax and EOF', () => {
    const lines = text.split(/\r?\n/)
    const corrupt = [...lines]
    corrupt[1] = corrupt[1].slice(0, -2) + (corrupt[1].endsWith('00') ? '01' : '00')
    expect(err(loadHex(corrupt.join('\n'), 'c.hex'))).toMatch(/line 2: checksum mismatch \(expected 0x[0-9a-f]{2}, found 0x[0-9a-f]{2}\)/)
    expect(err(loadHex(lines.filter((l) => !l.startsWith(':00000001')).join('\n'), 't.hex'))).toMatch(/missing end-of-file record/)
    expect(err(loadHex(':10000000\n:00000001FF\n', 's.hex'))).toMatch(/line 1: record too short/)
    expect(err(loadHex(':1000000000\n', 'o.hex'))).toMatch(/line 1: byte count field says 16/)
    expect(err(loadHex(':0100000000F\n', 'odd.hex'))).toMatch(/odd number of hex digits/)
    expect(err(loadHex('hello\n', 'h.hex'))).toMatch(/expected a record starting with ':'/)
    expect(err(loadHex(':00000006FA\n:00000001FF\n', 'u.hex'))).toMatch(/unknown record type 0x06/)
    expect(err(loadHex(':0000000Z00\n', 'z.hex'))).toMatch(/invalid character/)
  })

  it('handles segment addressing (02), start segment (03) and linear start (05)', () => {
    // 02: segment 0x1000 → base 0x10000; data at offset 0xFFFF wraps inside the segment
    const s = ':020000021000EC\n:02FFFF00AABB9B\n:0400000300120034B3\n:00000001FF\n'
    const img = ok(loadHex(s, 'seg.hex'))
    expect(flat(img).get(0x1ffff)).toBe(0xaa)
    expect(flat(img).get(0x10000)).toBe(0xbb)
    expect(img.entry).toBe(0x120 + 0x34)
    const lin = ok(loadHex(':020000040800F2\n:0400000508000B459F\n:0100000042BD\n:00000001FF\n', 'lin.hex'))
    expect(lin.entry).toBe(0x08000b45)
    expect(lin.segments).toEqual([{ addr: 0x08000000, data: new Uint8Array([0x42]) }])
  })

  it('rejects overlapping records with different contents', () => {
    expect(err(loadHex(':0100000011EE\n:0100000022DD\n:00000001FF\n', 'ov.hex'))).toMatch(/overlaps earlier data at 0x00000000/)
    const same = ok(loadHex(':0100000011EE\n:0100000011EE\n:00000001FF\n', 'same.hex'))
    expect(same.warnings.join()).toMatch(/identical/)
  })
})

describe('BIN and format dispatch', () => {
  it('BIN: base address, empty file', () => {
    const img = ok(loadBin(new Uint8Array([1, 2, 3]), 'a.bin', 0x08004000))
    expect(img.segments).toEqual([{ addr: 0x08004000, data: new Uint8Array([1, 2, 3]) }])
    expect(err(loadBin(new Uint8Array(0), 'e.bin'))).toMatch(/empty/)
  })

  it('dispatches by magic first, then extension', () => {
    const elf = file('bare-blink.elf')
    expect(ok(loadFirmwareFile('renamed.bin', elf)).format).toBe('elf')
    expect(ok(loadFirmwareFile('firmware.txt', file('bare-blink.hex'))).format).toBe('hex')
    expect(ok(loadFirmwareFile('fw.bin', file('bare-blink.bin'))).format).toBe('bin')
    expect(ok(loadFirmwareFile('fw', elf)).format).toBe('elf')
    expect(err(loadFirmwareFile('fw.dat', new Uint8Array([1, 2, 3])))).toMatch(/unrecognised firmware format/)
    expect(err(loadFirmwareFile('fw.elf', file('bare-blink.bin')))).toMatch(/ELF extension but does not start with the ELF magic/)
    expect(err(loadFirmwareFile('fw.hex', file('bare-blink.bin')))).toMatch(/Intel HEX extension but is not Intel HEX/)
    expect(ok(loadFirmwareFile('fw.dat', file('bare-blink.bin'), { format: 'bin', binBase: 0x08001000 })).segments[0].addr).toBe(0x08001000)
    expect(detectFormat('x.axf', new Uint8Array([0]))).toBe('elf')
  })
})
