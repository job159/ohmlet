import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 2000 },
  // ES-module workers (all workers are created with { type: 'module' }) so a
  // worker graph may code-split / use dynamic import(); IIFE workers cannot.
  worker: { format: 'es' },
})
