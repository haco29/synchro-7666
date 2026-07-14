import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Real DB tests arrive in later tasks (seed, queries, auth).
    // Keep the runner green until then.
    passWithNoTests: true,
    environment: 'node',
  },
})
