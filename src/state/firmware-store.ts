/**
 * Firmware byte storage + content hashing for the embedded lab
 * (src/state/lab.ts) and project files (src/state/project.ts).
 *
 * Why the bytes do NOT live in localStorage: a firmware image is tens to
 * hundreds of KiB, localStorage holds ~5 MB of UTF-16 per origin (shared with
 * the layout autosave), and storing binary there means base64 (+33 %). So the
 * small per-component binding records stay in localStorage ('bb.firmware',
 * owned by lab.ts) and the BYTES go to IndexedDB — database 'ohmlet', object
 * store 'firmware', keyed by the lowercase hex SHA-256 of the original file
 * (ARCHITECTURE_REVIEW §10.6). Content addressing dedupes one image bound to
 * several boards and makes integrity checks a single hash comparison.
 *
 * Where IndexedDB is missing or refuses to open (node tests, some private
 * browsing modes) an in-memory store with the same interface takes over and
 * reports `persistent === false`, so callers can tell the user honestly that
 * a binding will not survive a reload.
 *
 * Also hosts the two pure codecs every persistence path needs: SHA-256
 * (FIPS 180-4, synchronous — WebCrypto's digest is async-only and is absent on
 * non-secure origins) and strict RFC 4648 base64.
 */

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4 §6.2)
// ---------------------------------------------------------------------------

/** First 32 bits of the fractional parts of the cube roots of the first 64 primes (FIPS 180-4 §4.2.2). */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** Lowercase hex SHA-256 digest of `data` (the FirmwareImage.sha256 convention). */
export function sha256Hex(data: Uint8Array): string {
  const len = data.length
  // padding (§5.1.1): 0x80, zeros, 64-bit big-endian bit length → multiple of 64 bytes
  const blocks = Math.floor((len + 8) / 64) + 1
  const buf = new Uint8Array(blocks * 64)
  buf.set(data)
  buf[len] = 0x80
  const view = new DataView(buf.buffer)
  // bit length = len·8 split into two 32-bit words without overflowing 2^53
  view.setUint32(buf.length - 8, Math.floor(len / 0x20000000))
  view.setUint32(buf.length - 4, (len * 8) >>> 0)

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19
  const w = new Uint32Array(64)
  for (let off = 0; off < buf.length; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(off + t * 4)
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15]
      const y = w[t - 2]
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + SHA256_K[t] + w[t]) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
    h5 = (h5 + f) | 0
    h6 = (h6 + g) | 0
    h7 = (h7 + h) | 0
  }
  let out = ''
  for (const v of [h0, h1, h2, h3, h4, h5, h6, h7]) out += (v >>> 0).toString(16).padStart(8, '0')
  return out
}

/** A well-formed lowercase SHA-256 hex digest. */
export function isSha256Hex(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)
}

// ---------------------------------------------------------------------------
// base64 (RFC 4648 §4, padded, no line breaks) — strict on decode
// ---------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1)
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i
  return t
})()

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  let chunk = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    chunk += B64[n >>> 18] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63]
    if (chunk.length >= 8192) {
      parts.push(chunk)
      chunk = ''
    }
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    chunk += B64[n >>> 18] + B64[(n >>> 12) & 63] + '=='
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    chunk += B64[n >>> 18] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + '='
  }
  parts.push(chunk)
  return parts.join('')
}

/**
 * Decode padded base64. Returns null on ANY malformation (bad length, a
 * character outside the alphabet, misplaced padding, non-zero pad bits) —
 * a project file is either intact or rejected, never half-decoded.
 */
export function base64ToBytes(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null
  let pad = 0
  if (text.endsWith('==')) pad = 2
  else if (text.endsWith('=')) pad = 1
  const out = new Uint8Array((text.length / 4) * 3 - pad)
  let o = 0
  for (let i = 0; i < text.length; i += 4) {
    const last = i + 4 === text.length
    const v: number[] = []
    for (let j = 0; j < 4; j++) {
      const code = text.charCodeAt(i + j)
      if (code === 61 /* '=' */ && last && j >= 4 - pad) {
        v.push(0)
        continue
      }
      const d = code < 128 ? B64_INDEX[code] : -1
      if (d < 0) return null
      v.push(d)
    }
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3]
    if (last && pad === 2 && (n & 0xffff) !== 0) return null // non-canonical trailing bits
    if (last && pad === 1 && (n & 0xff) !== 0) return null
    out[o++] = n >>> 16
    if (o < out.length) out[o++] = (n >>> 8) & 0xff
    if (o < out.length) out[o++] = n & 0xff
  }
  return out
}

// ---------------------------------------------------------------------------
// Blob stores
// ---------------------------------------------------------------------------

/** Content-addressed firmware byte store (key = lowercase hex SHA-256 of the bytes). */
export interface FirmwareBlobStore {
  /** false = bytes live only in this page session (no IndexedDB) */
  readonly persistent: boolean
  get(sha256: string): Promise<Uint8Array | null>
  put(sha256: string, bytes: Uint8Array, name: string): Promise<void>
  delete(sha256: string): Promise<void>
  keys(): Promise<string[]>
}

export function createMemoryBlobStore(): FirmwareBlobStore {
  const map = new Map<string, Uint8Array>()
  return {
    persistent: false,
    async get(sha) {
      const b = map.get(sha)
      return b ? b.slice() : null
    },
    async put(sha, bytes) {
      map.set(sha, bytes.slice())
    },
    async delete(sha) {
      map.delete(sha)
    },
    async keys() {
      return [...map.keys()]
    },
  }
}

export const FIRMWARE_DB_NAME = 'ohmlet'
export const FIRMWARE_DB_STORE = 'firmware'
const FIRMWARE_DB_VERSION = 1

/** One IndexedDB row. */
interface FirmwareRow {
  sha256: string
  name: string
  bytes: Uint8Array
  storedAt: number
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

/**
 * IndexedDB-backed store. The database opens lazily on first use; if opening
 * fails (blocked, quota, private mode) every call transparently falls back to
 * an in-memory store and `persistent` flips to false.
 */
export function createIdbBlobStore(idb: IDBFactory): FirmwareBlobStore {
  let fallback: FirmwareBlobStore | null = null
  let dbPromise: Promise<IDBDatabase | null> | null = null

  const open = (): Promise<IDBDatabase | null> => {
    if (dbPromise) return dbPromise
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      let req: IDBOpenDBRequest
      try {
        req = idb.open(FIRMWARE_DB_NAME, FIRMWARE_DB_VERSION)
      } catch {
        resolve(null)
        return
      }
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(FIRMWARE_DB_STORE)) {
          db.createObjectStore(FIRMWARE_DB_STORE, { keyPath: 'sha256' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    }).then((db) => {
      if (!db) fallback = createMemoryBlobStore()
      return db
    })
    return dbPromise
  }

  const tx = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | undefined> => {
    const db = await open()
    if (!db) return undefined
    const t = db.transaction(FIRMWARE_DB_STORE, mode)
    const result = await promisify(run(t.objectStore(FIRMWARE_DB_STORE)))
    if (mode === 'readwrite') {
      // a write is durable only once the transaction commits, not when the request succeeds
      await new Promise<void>((resolve, reject) => {
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'))
        t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'))
      })
    }
    return result
  }

  return {
    get persistent() {
      return fallback === null
    },
    async get(sha) {
      const row = (await tx('readonly', (s) => s.get(sha) as IDBRequest<FirmwareRow | undefined>)) as
        | FirmwareRow
        | undefined
      if (fallback) return fallback.get(sha)
      if (!row) return null
      const b: unknown = row.bytes
      if (b instanceof Uint8Array) return b
      if (b instanceof ArrayBuffer) return new Uint8Array(b)
      return null
    },
    async put(sha, bytes, name) {
      const row: FirmwareRow = { sha256: sha, name, bytes: bytes.slice(), storedAt: Date.now() }
      await tx('readwrite', (s) => s.put(row))
      if (fallback) await fallback.put(sha, bytes, name)
    },
    async delete(sha) {
      await tx('readwrite', (s) => s.delete(sha))
      if (fallback) await fallback.delete(sha)
    },
    async keys() {
      const keys = await tx('readonly', (s) => s.getAllKeys())
      if (fallback) return fallback.keys()
      return (keys ?? []).filter((k): k is string => typeof k === 'string')
    },
  }
}

let defaultStore: FirmwareBlobStore | null = null

/** The process-wide store: IndexedDB when the platform has it, memory otherwise. */
export function firmwareBlobStore(): FirmwareBlobStore {
  if (!defaultStore) {
    const idb: IDBFactory | undefined =
      typeof indexedDB !== 'undefined' ? (indexedDB as IDBFactory) : undefined
    defaultStore = idb ? createIdbBlobStore(idb) : createMemoryBlobStore()
  }
  return defaultStore
}

/** TEST-ONLY: swap the process-wide store (null = re-detect on next use). */
export function __setFirmwareBlobStoreForTests(store: FirmwareBlobStore | null): void {
  defaultStore = store
}
