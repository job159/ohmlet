/**
 * micro-SD card in SPI mode — the card behind the `sd_card_spi` module —
 * after the SD Physical Layer Simplified Specification v9.10 (§6.4.1
 * power-up, §7 SPI mode: §7.2.1 mode selection, §7.2.2 CRC, §7.3.1.3
 * command set, §7.3.2 responses, §7.3.3 data tokens, §7.3.4 CRC16), plus a
 * sparse in-memory card image FORMATTED BY THIS FILE (MBR + one FAT32 /
 * FAT16 partition, Microsoft FAT specification "fatgen103" sizing).
 *
 * Card behavior (all from bytes on SCK/MOSI with CS — ./comm-spi.ts):
 *  - power-up: the card is in SD bus mode and needs ≥ 74 SCK cycles (with
 *    CS high here, like every SPI-mode driver sends) before CMD0. CMD0 with
 *    CS low and a valid CRC (95h) switches it to SPI mode → R1 = 01h (idle).
 *  - SPI mode starts with CRC checking OFF except CMD0 / CMD8 (§7.2.2);
 *    CMD59 turns command and data CRC checking on / off. A bad CRC → R1
 *    with the COM CRC bit (08h), the command is not executed.
 *  - CMD8 (R7, echo of VHS + check pattern), CMD55 + ACMD41 (HCS bit 30):
 *    initialization starts at the first ACMD41 and completes `SD_INIT_S`
 *    later — ACMD41 answers 01h (idle) until then, 00h after. An SDHC card
 *    never leaves idle when HCS = 0 (§4.2.3.1). CMD1 is accepted like
 *    ACMD41 without HCS.
 *  - CMD58 (R3: OCR — busy bit 31 set when initialized, CCS bit 30 = SDHC),
 *    CMD9 / CMD10 (CSD v2.0 / v1.0, CID: 16-byte data blocks), CMD13 (R2),
 *    CMD16 (512 only), CMD17 / CMD18 + CMD12 (single / multiple block read:
 *    FEh token, 512 bytes, CRC16, the token appears `SD_READ_ACCESS_S` after
 *    the response — Nac), CMD24 / CMD25 (single / multiple block write: FEh /
 *    FCh tokens, FDh stop tran, data response 05h accepted / 0Bh CRC error,
 *    then DO held low (busy) for `SD_PROGRAM_S`).
 *  - Addressing: SDHC (CCS = 1) takes block numbers, SDSC byte addresses
 *    (must be 512-aligned here).
 *  - In idle state every command but CMD0/1/8/55/58/59 and ACMD41 is an
 *    illegal command (R1 05h).
 *  - Commands are recognized on byte boundaries (01xxxxxx start byte).
 *  - DO is driven only while selected; 1-bits leave it to the module's
 *    pull-up (the module buffer — see comm.model.ts).
 */
import type { DigitalDeviceCtx } from '../digital/api'
import type { SpiSlaveHandler } from './comm-spi'

export type SdKind = 'sdhc' | 'sdsc'

/** ACMD41 initialization time after the first ACMD41 (s) — real cards take 10 … 500 ms. */
export const SD_INIT_S = 25e-3
/** Read access time: data token this long after the read command (s, Nac ≤ 100 ms). */
export const SD_READ_ACCESS_S = 0.25e-3
/** Programming time after a written block (s): DO low (busy) — real cards 0.5 … 250 ms. */
export const SD_PROGRAM_S = 1.5e-3
/** Initialization clocks required after power-up (§6.4.1.1). */
export const SD_INIT_CLOCKS = 74

// ------------------------------------------------------------------ CRCs

/** CRC7 (x⁷ + x³ + 1) of SD commands / CSD / CID. */
export function crc7(bytes: ArrayLike<number>, len = bytes.length): number {
  let crc = 0
  for (let k = 0; k < len; k++) {
    let d = bytes[k] & 0xff
    for (let i = 0; i < 8; i++) {
      crc <<= 1
      if ((d & 0x80) ^ (crc & 0x80)) crc ^= 0x09
      d <<= 1
    }
  }
  return crc & 0x7f
}

/** CRC16-CCITT (x¹⁶ + x¹² + x⁵ + 1, initial 0) of SD data blocks. */
export function crc16(bytes: ArrayLike<number>, len = bytes.length): number {
  let crc = 0
  for (let k = 0; k < len; k++) {
    crc ^= (bytes[k] & 0xff) << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

// ---------------------------------------------------------- card image

export interface SdGeometry {
  kind: SdKind
  /** total 512-byte blocks */
  blocks: number
  partStart: number
  partSize: number
  fat: 'FAT32' | 'FAT16'
  partType: number
  secPerClus: number
  rsvd: number
  numFats: number
  fatSz: number
  rootEntCnt: number
  rootDirSectors: number
  /** absolute LBA of the first FAT */
  fatStart: number
  /** absolute LBA of the FAT16 root directory (FAT32: of cluster 2) */
  rootStart: number
  /** absolute LBA of cluster 2 */
  dataStart: number
  clusters: number
  volId: number
  label: string
}

/** FNV-1a of a string (stable serials / volume ids per component). */
function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export const SD_LABEL = 'OHMLET SD'
export const SD_HELLO_NAME = 'HELLO.TXT'
export const SD_HELLO_TEXT = 'Hello from the ohmlet virtual SD card.\r\n'

/**
 * Layout of a fresh card: SDHC 4 GiB with FAT32 (64 sectors per cluster,
 * partition at 4 MiB as the SD Association formatter aligns it) or SDSC
 * 128 MiB with FAT16 (8 sectors per cluster, 512 root entries, partition at
 * 1 MiB). FAT sizes per fatgen103.
 */
export function sdGeometry(kind: SdKind, componentId: string): SdGeometry {
  const volId = hash32(`vol:${componentId}`)
  if (kind === 'sdhc') {
    const blocks = 8 * 1024 * 1024 // 4 GiB
    const partStart = 8192
    const partSize = blocks - partStart
    const secPerClus = 64
    const rsvd = 32
    const numFats = 2
    const fatSz = Math.ceil((partSize - rsvd) / ((256 * secPerClus + numFats) / 2))
    const fatStart = partStart + rsvd
    const dataStart = fatStart + numFats * fatSz
    const clusters = Math.floor((partSize - (dataStart - partStart)) / secPerClus)
    return {
      kind,
      blocks,
      partStart,
      partSize,
      fat: 'FAT32',
      partType: 0x0c,
      secPerClus,
      rsvd,
      numFats,
      fatSz,
      rootEntCnt: 0,
      rootDirSectors: 0,
      fatStart,
      rootStart: dataStart,
      dataStart,
      clusters,
      volId,
      label: SD_LABEL,
    }
  }
  const blocks = 128 * 2048 // 128 MiB
  const partStart = 2048
  const partSize = blocks - partStart
  const secPerClus = 8
  const rsvd = 1
  const numFats = 2
  const rootEntCnt = 512
  const rootDirSectors = (rootEntCnt * 32) / 512
  const fatSz = Math.ceil((partSize - (rsvd + rootDirSectors)) / (256 * secPerClus + numFats))
  const fatStart = partStart + rsvd
  const rootStart = fatStart + numFats * fatSz
  const dataStart = rootStart + rootDirSectors
  const clusters = Math.floor((partSize - (dataStart - partStart)) / secPerClus)
  return {
    kind,
    blocks,
    partStart,
    partSize,
    fat: 'FAT16',
    partType: 0x06,
    secPerClus,
    rsvd,
    numFats,
    fatSz,
    rootEntCnt,
    rootDirSectors,
    fatStart,
    rootStart,
    dataStart,
    clusters,
    volId,
    label: SD_LABEL,
  }
}

const le16 = (b: Uint8Array, o: number, v: number) => {
  b[o] = v & 0xff
  b[o + 1] = (v >>> 8) & 0xff
}
const le32 = (b: Uint8Array, o: number, v: number) => {
  b[o] = v & 0xff
  b[o + 1] = (v >>> 8) & 0xff
  b[o + 2] = (v >>> 16) & 0xff
  b[o + 3] = (v >>> 24) & 0xff
}
const ascii = (b: Uint8Array, o: number, s: string, len: number) => {
  for (let i = 0; i < len; i++) b[o + i] = i < s.length ? s.charCodeAt(i) & 0x7f : 0x20
}

/** CHS triple of an LBA for 255 heads × 63 sectors (clamped to 1023/254/63). */
function chs(lba: number): [number, number, number] {
  const c = Math.floor(lba / (255 * 63))
  if (c > 1023) return [0xfe, 0xff, 0xff]
  const h = Math.floor(lba / 63) % 255
  const s = (lba % 63) + 1
  return [h, (s & 0x3f) | ((c >>> 2) & 0xc0), c & 0xff]
}

/** FAT date / time of the files on a fresh card: 2026-01-01 12:00:00. */
const FAT_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1
const FAT_TIME = 12 << 11

/** The content of block `lba` of a freshly formatted card (null = all zeros). */
export function formattedBlock(g: SdGeometry, lba: number): Uint8Array | null {
  if (lba === 0) {
    // MBR: one primary partition, disk signature, 55AA
    const b = new Uint8Array(512)
    le32(b, 440, hash32(`disk:${g.volId}`))
    const e = 446
    b[e] = 0x00
    b.set(chs(g.partStart), e + 1)
    b[e + 4] = g.partType
    b.set(chs(g.partStart + g.partSize - 1), e + 5)
    le32(b, e + 8, g.partStart)
    le32(b, e + 12, g.partSize)
    b[510] = 0x55
    b[511] = 0xaa
    return b
  }
  const rel = lba - g.partStart
  const fat32 = g.fat === 'FAT32'
  if (rel === 0 || (fat32 && rel === 6)) return bootSector(g)
  if (fat32 && (rel === 1 || rel === 7)) {
    const b = new Uint8Array(512)
    le32(b, 0, 0x41615252)
    le32(b, 484, 0x61417272)
    le32(b, 488, g.clusters - 2) // root directory + HELLO.TXT in use
    le32(b, 492, 4)
    le32(b, 508, 0xaa550000)
    return b
  }
  // first sector of each FAT copy
  for (let f = 0; f < g.numFats; f++) {
    if (lba === g.fatStart + f * g.fatSz) {
      const b = new Uint8Array(512)
      if (fat32) {
        le32(b, 0, 0x0ffffff8)
        le32(b, 4, 0x0fffffff)
        le32(b, 8, 0x0fffffff) // cluster 2: root directory (one cluster)
        le32(b, 12, 0x0fffffff) // cluster 3: HELLO.TXT
      } else {
        le16(b, 0, 0xfff8)
        le16(b, 2, 0xffff)
        le16(b, 4, 0xffff) // cluster 2: HELLO.TXT
      }
      return b
    }
  }
  const fileCluster = fat32 ? 3 : 2
  if (lba === g.rootStart) {
    const b = new Uint8Array(512)
    // volume label entry
    ascii(b, 0, g.label, 11)
    b[11] = 0x08
    le16(b, 22, FAT_TIME)
    le16(b, 24, FAT_DATE)
    // HELLO.TXT
    ascii(b, 32, 'HELLO', 8)
    ascii(b, 40, 'TXT', 3)
    b[43] = 0x20
    le16(b, 46, FAT_TIME)
    le16(b, 48, FAT_DATE)
    le16(b, 50, FAT_DATE)
    le16(b, 52, (fileCluster >>> 16) & 0xffff)
    le16(b, 54, FAT_TIME)
    le16(b, 56, FAT_DATE)
    le16(b, 58, fileCluster & 0xffff)
    le32(b, 60, SD_HELLO_TEXT.length)
    return b
  }
  if (lba === g.dataStart + (fileCluster - 2) * g.secPerClus) {
    const b = new Uint8Array(512)
    ascii(b, 0, SD_HELLO_TEXT, SD_HELLO_TEXT.length)
    return b
  }
  return null
}

function bootSector(g: SdGeometry): Uint8Array {
  const b = new Uint8Array(512)
  const fat32 = g.fat === 'FAT32'
  b[0] = 0xeb
  b[1] = fat32 ? 0x58 : 0x3c
  b[2] = 0x90
  ascii(b, 3, 'MSWIN4.1', 8)
  le16(b, 11, 512)
  b[13] = g.secPerClus
  le16(b, 14, g.rsvd)
  b[16] = g.numFats
  le16(b, 17, g.rootEntCnt)
  le16(b, 19, 0)
  b[21] = 0xf8
  le16(b, 22, fat32 ? 0 : g.fatSz)
  le16(b, 24, 63)
  le16(b, 26, 255)
  le32(b, 28, g.partStart)
  le32(b, 32, g.partSize)
  if (fat32) {
    le32(b, 36, g.fatSz)
    le16(b, 40, 0)
    le16(b, 42, 0)
    le32(b, 44, 2)
    le16(b, 48, 1)
    le16(b, 50, 6)
    b[64] = 0x80
    b[66] = 0x29
    le32(b, 67, g.volId)
    ascii(b, 71, g.label, 11)
    ascii(b, 82, 'FAT32', 8)
  } else {
    b[36] = 0x80
    b[38] = 0x29
    le32(b, 39, g.volId)
    ascii(b, 43, g.label, 11)
    ascii(b, 54, 'FAT16', 8)
  }
  b[510] = 0x55
  b[511] = 0xaa
  return b
}

/** Sparse image: written blocks over the generated fresh format. */
export class SdImage {
  readonly written = new Map<number, Uint8Array>()
  constructor(readonly geo: SdGeometry) {}

  read(lba: number): Uint8Array {
    const w = this.written.get(lba)
    if (w) return w.slice()
    return formattedBlock(this.geo, lba) ?? new Uint8Array(512)
  }

  write(lba: number, data: ArrayLike<number>): void {
    const b = new Uint8Array(512)
    for (let i = 0; i < 512; i++) b[i] = data[i] & 0xff
    this.written.set(lba, b)
  }
}

const IMAGES = new Map<string, SdImage>()

/** The persistent card image of a component (one per card kind). */
export function sdImage(componentId: string, kind: SdKind): SdImage {
  const key = `${componentId}\u0000${kind}`
  let img = IMAGES.get(key)
  if (!img) {
    img = new SdImage(sdGeometry(kind, componentId))
    IMAGES.set(key, img)
  }
  return img
}

/** Forget a component's card images (tests; a fresh card). */
export function eraseSdImage(componentId: string): void {
  for (const k of [...IMAGES.keys()]) if (k.startsWith(`${componentId}\u0000`)) IMAGES.delete(k)
}

// ---------------------------------------------------------- registers

/** CSD register (16 bytes incl. CRC7) — v2.0 for SDHC, v1.0 for SDSC. */
export function csdOf(g: SdGeometry): Uint8Array {
  const b = new Uint8Array(16)
  if (g.kind === 'sdhc') {
    const cSize = g.blocks / 1024 - 1 // capacity = (C_SIZE + 1) × 512 KiB
    b.set([0x40, 0x0e, 0x00, 0x32, 0x5b, 0x59, 0x00, (cSize >>> 16) & 0x3f, (cSize >>> 8) & 0xff, cSize & 0xff, 0x7f, 0x80, 0x0a, 0x40, 0x00])
  } else {
    // capacity = (C_SIZE + 1) × 2^(C_SIZE_MULT + 2) × 2^READ_BL_LEN, READ_BL_LEN = 9, C_SIZE_MULT = 7
    const cSize = g.blocks / 512 - 1
    b.set([
      0x00,
      0x26,
      0x00,
      0x32,
      0x5b,
      0x59,
      0x80 | ((cSize >>> 10) & 0x03),
      (cSize >>> 2) & 0xff,
      ((cSize & 0x03) << 6) | (6 << 3) | 6,
      (6 << 5) | (6 << 2) | (7 >>> 1),
      ((7 & 1) << 7) | 0x40 | 0x3f,
      0x80,
      0x0a,
      0x40,
      0x00,
    ])
  }
  b[15] = (crc7(b, 15) << 1) | 1
  return b
}

/** CID register of the simulated card (a virtual card: OID "OH", product "OHMLT"). */
export function cidOf(componentId: string): Uint8Array {
  const b = new Uint8Array(16)
  b[0] = 0x00 // MID: not an SD-3C assigned manufacturer (virtual card)
  b[1] = 0x4f // 'O'
  b[2] = 0x48 // 'H'
  ascii(b, 3, 'OHMLT', 5)
  b[8] = 0x10 // PRV 1.0
  le32be(b, 9, hash32(`psn:${componentId}`))
  const year = 2026 - 2000
  b[13] = (year >>> 4) & 0x0f
  b[14] = ((year & 0x0f) << 4) | 10
  b[15] = (crc7(b, 15) << 1) | 1
  return b
}

function le32be(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 0xff
  b[o + 1] = (v >>> 16) & 0xff
  b[o + 2] = (v >>> 8) & 0xff
  b[o + 3] = v & 0xff
}

// ------------------------------------------------------------- the card

type WriteState = { lba: number; multi: boolean; phase: 'token' | 'data'; buf: Uint8Array; n: number } | null

export class SdCardSpi implements SpiSlaveHandler {
  readonly img: SdImage
  /** 'sd' = SD bus mode after power-up, 'spi' after CMD0 */
  mode: 'sd' | 'spi' = 'sd'
  /** SPI-mode initialization state */
  state: 'idle' | 'ready' = 'idle'
  crcOn = false
  private appCmd = false
  private initStart = -1
  private clocks = 0
  private cmd: number[] = []
  private out: number[] = []
  private read: { lba: number; readyAt: number; multi: boolean } | null = null
  private write: WriteState = null
  private busyUntil = -1
  private warnedClocks = false
  /** statistics (telemetry) */
  blocksRead = 0
  blocksWritten = 0
  lastCmd = -1

  constructor(
    readonly componentId: string,
    readonly kind: SdKind,
    private readonly ctx: DigitalDeviceCtx,
  ) {
    this.img = sdImage(componentId, kind)
  }

  /** Card power cycle: back to SD bus mode, CRC off, init clocks needed again. */
  powerUp(): void {
    this.mode = 'sd'
    this.state = 'idle'
    this.crcOn = false
    this.appCmd = false
    this.initStart = -1
    this.clocks = 0
    this.cmd = []
    this.out = []
    this.read = null
    this.write = null
    this.busyUntil = -1
  }

  /** An SCK rising edge while the card is deselected (power-up clocks). */
  clockDeselected(): void {
    if (this.clocks < 1 << 20) this.clocks++
  }

  get initClocks(): number {
    return this.clocks
  }

  private busy(): boolean {
    return this.busyUntil >= 0 && this.ctx.now() < this.busyUntil
  }

  // ------------------------------------------------------- SPI handler

  select(): void {
    this.cmd = []
  }

  deselect(): void {
    // a deselect aborts a command being received and any transfer in progress
    this.cmd = []
    this.out = []
    if (this.read) this.read = null
    if (this.write) this.write = null
  }

  byte(rx: number): void {
    if (this.write) {
      this.writeByte(rx)
      return
    }
    if (this.cmd.length > 0 || (rx & 0xc0) === 0x40) {
      this.cmd.push(rx)
      if (this.cmd.length === 6) {
        const c = this.cmd
        this.cmd = []
        this.command(c)
      }
    }
  }

  next(): number | null {
    if (this.mode === 'sd') return null
    if (this.out.length > 0) return this.out.shift() as number
    const r = this.read
    if (r) {
      if (this.ctx.now() < r.readyAt) return 0xff
      this.queueBlock(this.img.read(r.lba))
      this.blocksRead++
      if (r.multi) {
        r.lba++
        r.readyAt = this.ctx.now() + SD_READ_ACCESS_S
        if (r.lba >= this.img.geo.blocks) this.read = null
      } else this.read = null
      return this.out.shift() as number
    }
    if (this.busy()) return 0x00
    return 0xff
  }

  private queueBlock(data: Uint8Array): void {
    const c = crc16(data)
    this.out.push(0xfe)
    for (let i = 0; i < data.length; i++) this.out.push(data[i])
    this.out.push(c >>> 8, c & 0xff)
  }

  // ----------------------------------------------------------- commands

  private respond(...bytes: number[]): void {
    // Ncr: one fill byte before the response (§7.5.1, Ncr = 1 … 8 bytes)
    this.out = [0xff, ...bytes]
  }

  private command(c: number[]): void {
    const index = c[0] & 0x3f
    const arg = ((c[1] << 24) | (c[2] << 16) | (c[3] << 8) | c[4]) >>> 0
    const crcOk = crc7(c, 5) === c[5] >>> 1
    this.lastCmd = index
    if (this.busy()) return // a card programming a block ignores commands (the host must poll DO)
    if (this.mode === 'sd') {
      if (index !== 0) return // SD bus mode: no SPI responses
      if (this.clocks < SD_INIT_CLOCKS) {
        if (!this.warnedClocks) {
          this.warnedClocks = true
          this.ctx.issue(
            'warning',
            `SD card: CMD0 after only ${this.clocks} clock cycles — send at least 74 clocks with CS high after power-up (SD spec §6.4.1.1); the card does not answer`,
          )
        }
        return
      }
      if (!crcOk) return // in SD mode the CRC is mandatory: no response
      this.mode = 'spi'
      this.state = 'idle'
      this.respond(0x01)
      return
    }
    const app = this.appCmd
    this.appCmd = false
    const checkCrc = this.crcOn || index === 0 || index === 8
    const idle = this.state === 'idle'
    const r1 = idle ? 0x01 : 0x00
    if (checkCrc && !crcOk) {
      this.respond(r1 | 0x08)
      return
    }
    if (app) {
      if (index === 41) this.opCond((arg & 0x40000000) !== 0)
      else this.respond(r1 | 0x04)
      return
    }
    if (idle && ![0, 1, 8, 55, 58, 59].includes(index)) {
      this.respond(0x05)
      return
    }
    const sdhc = this.kind === 'sdhc'
    switch (index) {
      case 0:
        this.state = 'idle'
        this.initStart = -1
        this.read = null
        this.respond(0x01)
        return
      case 1:
        this.opCond(false)
        return
      case 8: {
        const vhs = (arg >>> 8) & 0x0f
        if (vhs !== 0x01) return // voltage not supported: the card does not respond (§4.3.13)
        this.respond(r1, 0x00, 0x00, vhs, arg & 0xff)
        return
      }
      case 9:
      case 10: {
        const reg = index === 9 ? csdOf(this.img.geo) : cidOf(this.componentId)
        const crc = crc16(reg)
        this.respond(r1, 0xff, 0xfe, ...reg, crc >>> 8, crc & 0xff)
        return
      }
      case 12:
        this.read = null
        // a stuff byte follows CMD12, then R1b (§7.3.1.3)
        this.out = [0xff, 0xff, r1]
        return
      case 13:
        this.respond(r1, 0x00)
        return
      case 16:
        this.respond(sdhc || arg === 512 ? r1 : r1 | 0x40)
        return
      case 17:
      case 18: {
        const lba = this.lbaOf(arg)
        if (lba < 0) return
        this.read = { lba, readyAt: this.ctx.now() + SD_READ_ACCESS_S, multi: index === 18 }
        this.respond(r1)
        return
      }
      case 24:
      case 25: {
        const lba = this.lbaOf(arg)
        if (lba < 0) return
        this.respond(r1)
        this.write = { lba, multi: index === 25, phase: 'token', buf: new Uint8Array(514), n: 0 }
        return
      }
      case 55:
        this.appCmd = true
        this.respond(r1)
        return
      case 58: {
        const ready = this.state === 'ready'
        const ocr = (0x00ff8000 | (ready ? 0x80000000 : 0) | (ready && sdhc ? 0x40000000 : 0)) >>> 0
        this.respond(r1, (ocr >>> 24) & 0xff, (ocr >>> 16) & 0xff, (ocr >>> 8) & 0xff, ocr & 0xff)
        return
      }
      case 59:
        this.crcOn = (arg & 1) === 1
        this.respond(r1)
        return
      default:
        this.respond(r1 | 0x04)
        return
    }
  }

  /** Block address of a read / write argument; responds with an error and returns −1 when invalid. */
  private lbaOf(arg: number): number {
    let lba: number
    if (this.kind === 'sdhc') lba = arg
    else {
      if (arg % 512 !== 0) {
        this.respond(0x20) // address error: misaligned for the 512-byte block length
        return -1
      }
      lba = arg / 512
    }
    if (lba >= this.img.geo.blocks) {
      this.respond(0x40) // parameter error: argument out of range
      return -1
    }
    return lba
  }

  private opCond(hcs: boolean): void {
    if (this.state === 'ready') {
      this.respond(0x00)
      return
    }
    // an SDHC card stays busy (idle) for a host that does not support high capacity
    if (this.kind === 'sdhc' && !hcs) {
      this.respond(0x01)
      return
    }
    const now = this.ctx.now()
    if (this.initStart < 0) this.initStart = now
    if (now - this.initStart >= SD_INIT_S) {
      this.state = 'ready'
      this.respond(0x00)
    } else this.respond(0x01)
  }

  private writeByte(rx: number): void {
    const w = this.write
    if (!w) return
    if (w.phase === 'token') {
      if (rx === 0xff) return
      if (!w.multi && rx === 0xfe) {
        w.phase = 'data'
        w.n = 0
        return
      }
      if (w.multi && rx === 0xfc) {
        w.phase = 'data'
        w.n = 0
        return
      }
      if (w.multi && rx === 0xfd) {
        // stop tran token: one byte, then busy for the last programming
        this.write = null
        this.out = [0xff]
        return
      }
      return
    }
    w.buf[w.n++] = rx
    if (w.n < 514) return
    const data = w.buf.subarray(0, 512)
    const crcRx = (w.buf[512] << 8) | w.buf[513]
    if (this.crcOn && crc16(data) !== crcRx) {
      this.out = [0x0b] // data response: CRC error
      this.write = null
      return
    }
    this.img.write(w.lba, data)
    this.blocksWritten++
    this.out = [0x05] // data accepted
    this.busyUntil = this.ctx.now() + SD_PROGRAM_S
    if (w.multi && w.lba + 1 < this.img.geo.blocks) {
      w.lba++
      w.phase = 'token'
      w.n = 0
    } else this.write = null
  }
}
