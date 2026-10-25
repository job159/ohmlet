/**
 * Side-effect barrel: registers every MCU model with the registry
 * (registry.ts), the same pattern as src/sim/chips/all.ts. Import this once
 * before calling createMcu().
 */
import { createCortexM3 } from './core/cpu'
import { registerMcu } from './registry'
import { Stm32f103 } from './stm32f1/soc'

registerMcu('stm32f103c8', () => new Stm32f103({ createCore: createCortexM3 }))
