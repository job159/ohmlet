/**
 * Synchronous SHA-256 (FIPS 180-4) in pure TypeScript.
 *
 * Firmware images are identified by the hash of the ORIGINAL file bytes
 * (FirmwareImage.sha256, the project-file firmware blob key). WebCrypto's
 * `subtle.digest` is async and absent in some Worker/test contexts, so the
 * loaders hash synchronously here. Throughput is ~100+ MB/s in V8 — firmware
 * files are at most a few hundred KiB.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** Lowercase hex SHA-256 digest of `data`. */
export function sha256Hex(data: Uint8Array): string {
  const d = sha256(data)
  let s = ''
  for (let i = 0; i < d.length; i++) s += d[i].toString(16).padStart(2, '0')
  return s
}

/** 32-byte SHA-256 digest of `data`. */
export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)
  const n = data.length
  // Padding: 0x80, zeros, then the 64-bit big-endian BIT length (§5.1.1).
  const total = (((n + 9 + 63) / 64) | 0) * 64
  const tail = new Uint8Array(total - (n & ~63))
  tail.set(data.subarray(n & ~63))
  tail[n & 63] = 0x80
  const bits = n * 8
  const tv = new DataView(tail.buffer)
  tv.setUint32(tail.length - 8, Math.floor(bits / 0x100000000))
  tv.setUint32(tail.length - 4, bits >>> 0)

  const full = n & ~63
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let off = 0; off < full; off += 64) block(h, w, dv, off)
  for (let off = 0; off < tail.length; off += 64) block(h, w, tv, off)

  const out = new Uint8Array(32)
  const ov = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i])
  return out
}

function block(h: Uint32Array, w: Uint32Array, v: DataView, off: number): void {
  for (let i = 0; i < 16; i++) w[i] = v.getUint32(off + i * 4)
  for (let i = 16; i < 64; i++) {
    const a = w[i - 15]
    const b = w[i - 2]
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
  }
  let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7]
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
    const ch = (e & f) ^ (~e & g)
    const t1 = (hh + S1 + ch + K[i] + w[i]) | 0
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
    const maj = (a & b) ^ (a & c) ^ (b & c)
    const t2 = (S0 + maj) | 0
    hh = g
    g = f
    f = e
    e = (d + t1) | 0
    d = c
    c = b
    b = a
    a = (t1 + t2) | 0
  }
  h[0] += a
  h[1] += b
  h[2] += c
  h[3] += d
  h[4] += e
  h[5] += f
  h[6] += g
  h[7] += hh
}
