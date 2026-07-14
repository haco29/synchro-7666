import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// Load local secrets for `db:migrate` / `db:push` / `db:studio`.
// `db:generate` reads only the schema and needs no connection.
config({ path: '.env.local' })

export default defineConfig({
  dialect: 'turso',
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    // Prod: a libsql:// Turso URL from env. Local dev: a plain file: URL.
    // `TURSO_DATABASE_URL` is env-driven; the file fallback is a non-secret
    // local default so `db:*` works out of the box (see .env.example).
    url: process.env.TURSO_DATABASE_URL ?? 'file:./data/dev.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
})
