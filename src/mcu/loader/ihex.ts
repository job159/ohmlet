/**
 * Intel HEX loader (Intel "Hexadecimal Object File Format Specification"
 * rev A, 1988; the I32HEX variant objcopy/CubeIDE emit).
 *
 * Record `:LLAAAATT<data>CC`, CC = two's complement of the byte sum.
 *   00 data · 01 end of file · 02 extended segment address (base = SBA·16,
 *   the 16-bit offset wraps inside the 64 KiB segment) · 03 start segment
 *   address (CS:IP) · 04 extended linear address (base = ULBA<<16) ·
 *   05 start linear address (EIP — ST's tools store the ELF entry here).
 * LF and CRLF line endings, blank lines and trailing whitespace are accepted.
 */
import type { LoadResult } from '../firmware'
import { sha256Hex } from './sha256'
import { type Chunk, hex2, hex8, mergeChunks } from './segments'

const HEX_DIGIT = /^[0-9A-Fa-f]*$/

/** Cheap sniff used by loadFirmwareFile: first non-blank char is ':' and the start looks like records. */
export function looksLikeHex(bytes: Uint8Array): boolean {
  let i = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3 // UTF-8 BOM
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0d || bytes[i] === 0x0a)) i++
  if (bytes[i] !== 0x3a) return false
  const end = Math.min(bytes.length, i + 64)
  for (let j = i; j < end; j++) {
    const c = bytes[j]
    const ok = c === 0x3a || c === 0x0d || c === 0x0a || c === 0x20 || c === 0x09 || (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66)
    if (!ok) return false
  }
  return true
}

export function loadHex(input: Uint8Array | string, name: string): LoadResult {
  const raw = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let text = typeof input === 'string' ? input : latin1(input)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  else if (text.startsWith('ï»¿')) text = text.slice(3)
  const fail = (error: string): LoadResult => ({ ok: false, error: `${name}: ${error}` })

  const lines = text.split('\n')
  const chunks: Chunk[] = []
  const warnings: string[] = []
  let base = 0
  let segmentMode = false // last extended-address record was type 02
  let entry: number | null = null
  let sawEof = false
  let records = 0

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim()
    const where = `line ${li + 1}`
    if (line === '') continue
    if (sawEof) {
      warnings.push(`${where}: data after the end-of-file record ignored`)
      break
    }
    if (line[0] !== ':') return fail(`${where}: expected a record starting with ':' (got ${JSON.stringify(line.slice(0, 12))})`)
    const body = line.slice(1)
    if (!HEX_DIGIT.test(body)) return fail(`${where}: invalid character in record (only hex digits allowed after ':')`)
    if (body.length % 2 !== 0) return fail(`${where}: odd number of hex digits — record truncated?`)
    if (body.length < 10) return fail(`${where}: record too short (${body.length / 2} bytes, minimum 5)`)
    const rec = new Uint8Array(body.length / 2)
    for (let i = 0; i < rec.length; i++) rec[i] = parseInt(body.substr(i * 2, 2), 16)
    const len = rec[0]
    if (rec.length !== len + 5) {
      return fail(`${where}: byte count field says ${len} data bytes but the record holds ${rec.length - 5} — record truncated or corrupted`)
    }
    let sum = 0
    for (let i = 0; i < rec.length - 1; i++) sum += rec[i]
    const expected = -sum & 0xff
    const found = rec[rec.length - 1]
    if (expected !== found) return fail(`${where}: checksum mismatch (expected ${hex2(expected)}, found ${hex2(found)})`)
    records++
    const offset = (rec[1] << 8) | rec[2]
    const type = rec[3]
    const data = rec.subarray(4, 4 + len)
    switch (type) {
      case 0x00: {
        if (segmentMode && offset + len > 0x10000) {
          // I16HEX: the offset wraps within the 64 KiB segment
          const first = 0x10000 - offset
          chunks.push({ addr: base + offset, data: data.slice(0, first), origin: where })
          chunks.push({ addr: base, data: data.slice(first), origin: where })
        } else {
          chunks.push({ addr: base + offset, data: data.slice(), origin: where })
        }
        break
      }
      case 0x01:
        if (len !== 0) return fail(`${where}: end-of-file record must have no data`)
        sawEof = true
        break
      case 0x02:
        if (len !== 2) return fail(`${where}: extended segment address record needs 2 data bytes`)
        base = ((data[0] << 8) | data[1]) * 16
        segmentMode = true
        break
      case 0x03:
        if (len !== 4) return fail(`${where}: start segment address record needs 4 data bytes`)
        entry = ((((data[0] << 8) | data[1]) << 4) + ((data[2] << 8) | data[3])) >>> 0
        break
      case 0x04:
        if (len !== 2) return fail(`${where}: extended linear address record needs 2 data bytes`)
        base = (((data[0] << 8) | data[1]) << 16) >>> 0
        segmentMode = false
        break
      case 0x05:
        if (len !== 4) return fail(`${where}: start linear address record needs 4 data bytes`)
        entry = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0
        break
      default:
        return fail(`${where}: unknown record type ${hex2(type)} (valid: 00–05)`)
    }
  }
  if (records === 0) return fail('no Intel HEX records found')
  if (!sawEof) return fail('missing end-of-file record (:00000001FF) — file truncated?')
  const merged = mergeChunks(chunks, warnings)
  if (!merged.ok) return fail(merged.error)
  if (merged.segments.length === 0) return fail('no data records: nothing to program')
  const total = merged.segments.reduce((a, s) => a + s.data.length, 0)
  return {
    ok: true,
    image: {
      name,
      format: 'hex',
      segments: merged.segments,
      entry,
      symbols: [],
      sha256: sha256Hex(raw),
      fileSize: raw.length,
      warnings,
      description: `Intel HEX, ${total} bytes in ${merged.segments.length} block${merged.segments.length === 1 ? '' : 's'}${entry !== null ? `, entry ${hex8(entry)}` : ''}`,
    },
  }
}

function latin1(b: Uint8Array): string {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + CH)))
  return s
}
