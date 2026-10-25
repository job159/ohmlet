/**
 * ELF32 little-endian ARM executable loader (the format STM32CubeIDE, Keil
 * (.axf) and every GCC/clang toolchain emit).
 *
 * Load semantics follow a hardware programmer (ST-Link / CubeProgrammer):
 * each PT_LOAD segment contributes its first p_filesz bytes at its PHYSICAL
 * address p_paddr (the LMA). That is what puts initialised .data into flash
 * (VMA 0x2000xxxx, LMA 0x0800xxxx) for the startup code to copy. Bytes in
 * p_memsz beyond p_filesz are .bss / heap / stack reservations: zero-filled
 * by startup code at run time, never programmed. Sections are ignored for
 * loading (ELF spec, "Program Loading": the program header table is the
 * loader's view); section headers are only read for the symbol table.
 *
 * Reference: System V ABI ELF (gABI) ch. 4–5; ARM ELF (AAELF32) §5 for
 * e_flags (EF_ARM_EABIMASK, EF_ARM_ABI_FLOAT_SOFT/HARD).
 */
import type { FirmwareImage, FirmwareSymbol, LoadResult } from '../firmware'
import { sha256Hex } from './sha256'
import { type Chunk, hex8, mergeChunks } from './segments'

const EM_NAMES: Record<number, string> = {
  3: 'x86',
  8: 'MIPS',
  20: 'PowerPC',
  40: 'ARM',
  62: 'x86-64',
  83: 'AVR',
  94: 'Xtensa (ESP8266/ESP32)',
  183: 'AArch64',
  243: 'RISC-V',
}

const ET_NAMES: Record<number, string> = { 0: 'ET_NONE', 1: 'ET_REL', 2: 'ET_EXEC', 3: 'ET_DYN', 4: 'ET_CORE' }

const PT_LOAD = 1
const SHT_SYMTAB = 2
const STT_OBJECT = 1
const STT_FUNC = 2
const STT_SECTION = 3
const STT_FILE = 4
const SHN_UNDEF = 0

/** True when `bytes` starts with the ELF magic 7F 'E' 'L' 'F'. */
export function isElf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46
}

export function loadElf(bytes: Uint8Array, name: string): LoadResult {
  const fail = (error: string): LoadResult => ({ ok: false, error: `${name}: ${error}` })
  const n = bytes.length
  if (!isElf(bytes)) return fail('not an ELF file (missing 7F 45 4C 46 magic)')
  if (n < 16) return fail(`truncated ELF: ${n} bytes, the identification block alone is 16`)
  const cls = bytes[4]
  if (cls === 2) return fail('ELF64 file (EI_CLASS=2): STM32 firmware must be a 32-bit ARM ELF (ELF32)')
  if (cls !== 1) return fail(`invalid ELF class EI_CLASS=${cls} (expected 1 = ELF32)`)
  const endian = bytes[5]
  if (endian === 2) return fail('big-endian ELF (EI_DATA=2): Cortex-M3 firmware must be little-endian')
  if (endian !== 1) return fail(`invalid ELF data encoding EI_DATA=${endian} (expected 1 = little-endian)`)
  if (n < 52) return fail(`truncated ELF: ${n} bytes, the ELF32 header is 52`)

  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (o: number) => v.getUint16(o, true)
  const u32 = (o: number) => v.getUint32(o, true)

  const type = u16(16)
  const machine = u16(18)
  if (machine !== 40) {
    const m = EM_NAMES[machine] ?? `unknown machine ${machine}`
    return fail(`built for ${m} (e_machine=${machine}), not ARM (e_machine=40) — this is not STM32 firmware`)
  }
  if (type === 1) return fail('relocatable object file (ET_REL, a .o): link it into an executable first')
  if (type !== 2 && type !== 3) return fail(`unsupported ELF type ${ET_NAMES[type] ?? type} (expected ET_EXEC)`)
  const entry = u32(24)
  const phoff = u32(28)
  const shoff = u32(32)
  const flags = u32(36)
  const phentsize = u16(42)
  const phnum = u16(44)
  const shentsize = u16(46)
  const shnum = u16(48)

  const warnings: string[] = []
  if (type === 3) warnings.push('position-independent executable (ET_DYN): loaded at its link addresses, no relocation is applied')
  if (phnum === 0) return fail('no program headers: nothing to load (was the file linked?)')
  if (phentsize < 32) return fail(`invalid program header size e_phentsize=${phentsize} (ELF32 needs 32)`)
  if (phoff + phnum * phentsize > n) {
    return fail(`truncated ELF: program header table (${phnum}×${phentsize} bytes at offset ${phoff}) extends past the end of the file (${n} bytes)`)
  }

  const chunks: Chunk[] = []
  let loads = 0
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize
    if (u32(o) !== PT_LOAD) continue
    loads++
    const offset = u32(o + 4)
    const paddr = u32(o + 12)
    const filesz = u32(o + 16)
    const memsz = u32(o + 20)
    if (filesz === 0) continue // pure .bss / stack reservation
    if (offset + filesz > n) {
      return fail(`truncated ELF: segment ${i} (${filesz} bytes at file offset ${offset}) extends past the end of the file (${n} bytes)`)
    }
    if (memsz < filesz) warnings.push(`segment ${i}: p_memsz (${memsz}) < p_filesz (${filesz})`)
    chunks.push({ addr: paddr, data: bytes.slice(offset, offset + filesz), origin: `segment ${i} (LMA ${hex8(paddr)})` })
  }
  if (loads === 0) return fail('no PT_LOAD segments: nothing to program')
  const merged = mergeChunks(chunks, warnings)
  if (!merged.ok) return fail(merged.error)
  if (merged.segments.length === 0) return fail('every PT_LOAD segment is empty (p_filesz = 0): nothing to program')

  // ---- symbols (optional: stripped files have none)
  let symbols: FirmwareSymbol[] = []
  if (shoff === 0 || shnum === 0) {
    warnings.push('no section headers: symbol table unavailable (stripped ELF)')
  } else if (shentsize < 40 || shoff + shnum * shentsize > n) {
    warnings.push(`section header table out of bounds (offset ${shoff}, ${shnum}×${shentsize}): symbols skipped`)
  } else {
    const sym = readSymbols(v, n, shoff, shnum, shentsize, warnings)
    if (sym === null) warnings.push('no .symtab section: symbol table unavailable (stripped ELF)')
    else symbols = sym
  }

  // ---- description
  const eabi = flags >>> 24
  const fl: string[] = []
  if (eabi) fl.push(`EABI${eabi}`)
  if (flags & 0x400) fl.push('hard-float')
  else if (flags & 0x200) fl.push('soft-float')
  const thumb = (entry & 1) === 1
  if (flags & 0x400) warnings.push('built for the hard-float ABI (EF_ARM_ABI_FLOAT_HARD): the Cortex-M3 has no FPU — floating-point instructions will fault')
  if (!thumb) warnings.push(`entry point ${hex8(entry)} has the Thumb bit clear: Cortex-M only executes Thumb code`)
  const description = `ELF32 ARM${fl.length ? ', ' + fl.join(', ') : ''}, ${thumb ? 'Thumb entry' : 'entry'} ${hex8(entry)}`

  const image: FirmwareImage = {
    name,
    format: 'elf',
    segments: merged.segments,
    entry,
    symbols,
    sha256: sha256Hex(bytes),
    fileSize: n,
    warnings,
    description,
  }
  return { ok: true, image }
}

function readSymbols(v: DataView, n: number, shoff: number, shnum: number, shentsize: number, warnings: string[]): FirmwareSymbol[] | null {
  const u8 = (o: number) => v.getUint8(o)
  const u16 = (o: number) => v.getUint16(o, true)
  const u32 = (o: number) => v.getUint32(o, true)
  for (let i = 0; i < shnum; i++) {
    const sh = shoff + i * shentsize
    if (u32(sh + 4) !== SHT_SYMTAB) continue
    const off = u32(sh + 16)
    const size = u32(sh + 20)
    const link = u32(sh + 24)
    const entsize = u32(sh + 36) || 16
    if (off + size > n || link >= shnum) {
      warnings.push('.symtab out of bounds: symbols skipped')
      return []
    }
    const strSh = shoff + link * shentsize
    const strOff = u32(strSh + 16)
    const strSize = u32(strSh + 20)
    if (strOff + strSize > n) {
      warnings.push('.strtab out of bounds: symbols skipped')
      return []
    }
    const out: FirmwareSymbol[] = []
    for (let s = off + entsize; s + 16 <= off + size; s += entsize) {
      const nameOff = u32(s)
      const value = u32(s + 4)
      const ssize = u32(s + 8)
      const info = u8(s + 12)
      const shndx = u16(s + 14)
      const stt = info & 0xf
      if (nameOff === 0 || shndx === SHN_UNDEF || stt === STT_SECTION || stt === STT_FILE) continue
      const name = cstr(v, strOff + nameOff, strOff + strSize)
      // ARM mapping symbols ($t, $a, $d, $t.123 — AAELF32 §5.5.5) mark code/data runs, not names
      if (name === '' || name[0] === '$') continue
      if (stt === STT_FUNC) out.push({ name, addr: (value & ~1) >>> 0, size: ssize, kind: 'func' })
      else out.push({ name, addr: value >>> 0, size: ssize, kind: stt === STT_OBJECT ? 'object' : 'other' })
    }
    out.sort((a, b) => a.addr - b.addr || a.name.localeCompare(b.name))
    return out
  }
  return null
}

function cstr(v: DataView, start: number, limit: number): string {
  let s = ''
  for (let o = start; o < limit; o++) {
    const c = v.getUint8(o)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}
