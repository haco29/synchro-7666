import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

/**
 * The libSQL/Drizzle client for the app runtime. Replaces the old node:sqlite
 * `client.ts` — the local file cannot run on Vercel (ephemeral FS), so this
 * points at Turso (or a local file: URL in dev) via env.
 *
 * Lazily constructed so importing this module (e.g. at build time) does not
 * require credentials — only the first real query does.
 */
let client: Client | null = null;
let dbInstance: LibSQLDatabase<typeof schema> | null = null;

export function getDb(): LibSQLDatabase<typeof schema> {
  if (dbInstance) return dbInstance;

  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not set — see .env.example (local: file:./data/dev.db).",
    );
  }

  client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  dbInstance = drizzle(client, { schema });
  return dbInstance;
}

export { schema };
