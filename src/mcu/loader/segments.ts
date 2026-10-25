/**
 * Shared helpers for the firmware loaders: hex formatting and the
 * sort/merge step that turns raw chunks into FirmwareImage.segments
 * (sorted, non-overlapping, adjacent chunks coalesced — so an ELF, its
 * objcopy'd .bin and its .hex yield byte-identical segment lists).
 */
import type { FirmwareSegment } from '../firmware'

export const hex8 = (v: number): string => '0x' + (v >>> 0).toString(16).padStart(8, '0')
export const hex2 = (v: number): string => '0x' + (v & 0xff).toString(16).padStart(2, '0')

export interface Chunk {
  addr: number
  data: Uint8Array
  /** where it came from, for error messages ("segment 3", "line 12") */
  origin: string
}

/**
 * Sort chunks by address and coalesce touching ones. Overlaps holding the
 * same bytes are tolerated (reported as a warning); overlaps with different
 * bytes are an error — a programmer would write one over the other and the
 * result would depend on order.
 */
export function mergeChunks(chunks: Chunk[], warnings: string[]): { ok: true; segments: FirmwareSegment[] } | { ok: false; error: string } {
  const list = chunks.filter((c) => c.data.length > 0).sort((a, b) => a.addr - b.addr)
  const out: { addr: number; parts: Uint8Array[]; end: number }[] = []
  for (const c of list) {
    const last = out[out.length - 1]
    const end = c.addr + c.data.length
    if (end > 0x1_0000_0000) return { ok: false, error: `${c.origin}: data at ${hex8(c.addr)} runs past the 4 GiB address space` }
    if (last && c.addr < last.end) {
      // overlap: compare the shared bytes
      const flat = concat(last.parts)
      const from = c.addr - last.addr
      const shared = Math.min(last.end, end) - c.addr
      for (let i = 0; i < shared; i++) {
        if (flat[from + i] !== c.data[i]) {
          return { ok: false, error: `${c.origin}: overlaps earlier data at ${hex8(c.addr + i)} with different contents` }
        }
      }
      warnings.push(`${c.origin}: overlaps earlier data at ${hex8(c.addr)} (identical bytes, ignored)`)
      if (end > last.end) {
        last.parts = [flat, c.data.subarray(shared)]
        last.end = end
      } else {
        last.parts = [flat]
      }
    } else if (last && c.addr === last.end) {
      last.parts.push(c.data)
      last.end = end
    } else {
      out.push({ addr: c.addr, parts: [c.data], end })
    }
  }
  return { ok: true, segments: out.map((s) => ({ addr: s.addr, data: concat(s.parts) })) }
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Copy so an image never aliases the caller's (possibly reused) file buffer. */
export function copyBytes(src: Uint8Array): Uint8Array {
  return new Uint8Array(src)
}
