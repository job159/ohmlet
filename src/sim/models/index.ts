/**
 * Simulation-model plug-ins for part families: every
 * `src/sim/models/<family>.model.ts` registers its analog devices
 * (registerDevice), behavioral chips (registerChip) and/or logic-level
 * devices (registerDigitalDevice) as an import side effect. Collected
 * eagerly at build time (Vite import.meta.glob), imported by engine.ts, so
 * every SimEngine / coordinator / worker sees every model.
 */
import.meta.glob('./*.model.ts', { eager: true })

export {}
