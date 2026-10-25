/**
 * Raw binary loader (`objcopy -O binary` output, what most "drag the .bin
 * onto the ST-Link drive" flows use). A .bin carries no addresses, no entry
 * point and no symbols: the whole file is programmed at `baseAddr`
 * (default: the start of STM32 main flash, 0x08000000 — RM0008 §3.3.3).
 */
import type { LoadResult } from '../firmware'
import { sha256Hex } from './sha256'
import { copyBytes, hex8 } from './segments'

export const STM32_FLASH_BASE = 0x08000000

export function loadBin(bytes: Uint8Array, name: string, baseAddr: number = STM32_FLASH_BASE): LoadResult {
  if (bytes.length === 0) return { ok: false, error: `${name}: empty file — nothing to program` }
  if (!Number.isInteger(baseAddr) || baseAddr < 0 || baseAddr + bytes.length > 0x1_0000_0000) {
    return { ok: false, error: `${name}: invalid load address ${baseAddr}` }
  }
  const warnings: string[] = []
  // An ELF renamed to .bin would otherwise be "programmed" as garbage.
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    warnings.push('file starts with the ELF magic: this looks like an ELF, not a raw binary')
  }
  return {
    ok: true,
    image: {
      name,
      format: 'bin',
      segments: [{ addr: baseAddr >>> 0, data: copyBytes(bytes) }],
      entry: null,
      symbols: [],
      sha256: sha256Hex(bytes),
      fileSize: bytes.length,
      warnings,
      description: `raw binary, ${bytes.length} bytes at ${hex8(baseAddr)}`,
    },
  }
}
