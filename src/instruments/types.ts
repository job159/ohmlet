/**
 * Shared types of the instrument layer (protocol decoders, measurements,
 * exporters). Everything in src/instruments is PURE: it works on the raw
 * captures the simulation host returns (LogicTrace edge lists, ScopeTrace
 * sample arrays — src/sim/coordinator/api.ts) and never sees peripheral or
 * device state. A decoder therefore reads the wire exactly like a bench
 * logic analyzer: a mis-wired bus or a wrong baud rate decodes as garbage
 * (with error annotations), never as success.
 */

/** Semantic class of an annotation; views map it to a palette color. */
export type AnnotationKind = 'data' | 'addr' | 'ctrl' | 'error'

/** One decoded span on the time axis (a byte, a START, an ACK …). */
export interface Annotation {
  /** span start / end, simulation seconds */
  t0: number
  t1: number
  /** id of the decoder row this annotation belongs to (DecoderRow.id) */
  row: string
  /** full label, stable format: "0x48 'H'", "START", "Addr 0x3C W" */
  text: string
  kind: AnnotationKind
  /** compact label for narrow spans: "48", "S", "A" */
  short?: string
  /** decoded numeric value (data word, address) when there is one */
  value?: number
  /** acknowledge bits (I²C) — a view hint on top of kind 'ctrl' */
  tone?: 'ack' | 'nack'
  /**
   * Structured content of a transaction, so a view can word it in the UI
   * language and format its numbers (UX IS-14) — `text` stays the stable
   * English wire format of exports and tests. SPI transfers: the words of
   * each line and their width, and the SCK idle level that contradicted CPOL
   * at CS assertion (`modeError`).
   */
  transfer?: { mosi?: number[]; miso?: number[]; bits: number; modeError?: { cpol: 0 | 1 } }
}

/** One annotation lane of a decoder (e.g. SPI has a MOSI and a MISO row). */
export interface DecoderRow {
  id: string
  label: string
  /** the channel role the row is drawn under (e.g. 'mosi', 'sda') */
  role: string
}

export interface DecodeResult {
  rows: DecoderRow[]
  annotations: Annotation[]
  /** decoder notes for the UI, e.g. "auto: 115200 Bd (measured 115 207 Bd)" */
  info: string[]
}

/** Decoder parameter values as configured in the UI / tests. */
export type ParamValues = Record<string, string | number | boolean>
