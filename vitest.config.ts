import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// The suite mixes CPU-heavy firmware/emulator tests with two wall-clock
// performance assertions (tests/wire-router.test.ts). Capping the fork pool
// keeps those timings meaningful on hybrid desktop CPUs instead of letting 11
// forks starve each other (ARCHITECTURE_REVIEW §1). Tests themselves are
// unchanged.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      poolOptions: { forks: { maxForks: 6, minForks: 1 } },
    },
  }),
)
