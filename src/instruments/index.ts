/**
 * Instrument layer barrel: protocol decoders, measurements, triggers and
 * exporters — pure functions over LogicCapture / ScopeCapture data
 * (src/sim/coordinator/api.ts). The views live in src/ui/embedded.
 */
export * from './types'
export * from './format'
export { Signal, type Level } from './signal'
export * from './decoders'
export * from './measure'
export * from './trigger'
export * from './export'
export * from './autofit'
