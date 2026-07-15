import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    // Mirror tsconfig `@/*` → project root, so Server Actions (which import via
    // `@/lib/...`) are testable under vitest.
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    // Real DB tests arrive in later tasks (seed, queries, auth).
    // Keep the runner green until then.
    passWithNoTests: true,
    environment: 'node',
  },
})
