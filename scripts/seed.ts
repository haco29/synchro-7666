import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
// Standalone migration script — builds its own client rather than importing the
// app's lib/db/index.ts singleton (keeps this runnable via `node scripts/seed.ts`).
import * as schema from "../lib/db/schema.ts";
import { isIsoDate } from "../lib/shifts/week.ts";

export const DEFAULT_TEAM_NAME = "Default Team";

export interface SeedSource {
  shareToken: string | null;
  people: { name: string; active: boolean }[];
  weeks: { weekStart: string; published: boolean }[];
}

type Db = LibSQLDatabase<typeof schema>;

/**
 * Reads the legacy single-tenant `node:sqlite` database (`data/synchro.db`)
 * into a plain SeedSource. Read-only: issues SELECTs, never writes.
 */
export function readSourceDb(dbPath: string): SeedSource {
  const src = new DatabaseSync(dbPath);
  try {
    const people = (
      src.prepare("SELECT name, active FROM people ORDER BY id").all() as {
        name: string;
        active: number;
      }[]
    ).map((r) => ({ name: r.name, active: !!r.active }));

    const tokenRow = src
      .prepare("SELECT value FROM settings WHERE key = 'share_token'")
      .get() as { value: string } | undefined;

    const weeks = (
      src.prepare("SELECT week_start, published FROM weeks ORDER BY week_start").all() as {
        week_start: string;
        published: number;
      }[]
    )
      // Skip legacy garbage rows (e.g. week_start "1.0") that would crash date
      // formatting downstream. The current app validates dates on write, but
      // the pre-migration node:sqlite data may contain bad values.
      .filter((r) => isIsoDate(r.week_start))
      .map((r) => ({ weekStart: r.week_start, published: !!r.published }));

    return { shareToken: tokenRow?.value ?? null, people, weeks };
  } finally {
    src.close();
  }
}

/**
 * Idempotently imports a SeedSource into a single "Default Team". Safe to
 * re-run: the team is keyed by name, people by UNIQUE(team_id, name), and
 * weeks by UNIQUE(team_id, week_start).
 *
 * NOTE: constraints & assignments are intentionally not imported — the source
 * has none, and importing them would require remapping legacy person/week ids
 * to the new surrogate ids. Add that here if a populated source ever needs it.
 */
export async function seed(db: Db, source: SeedSource): Promise<{ teamId: number }> {
  let team = (
    await db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.name, DEFAULT_TEAM_NAME))
      .limit(1)
  )[0];

  if (!team) {
    const shareToken = source.shareToken ?? randomBytes(16).toString("hex");
    [team] = await db
      .insert(schema.teams)
      .values({ name: DEFAULT_TEAM_NAME, shareToken, clerkOrgId: null })
      .returning();
  }

  for (const p of source.people) {
    await db
      .insert(schema.people)
      .values({ teamId: team.id, name: p.name, active: p.active })
      .onConflictDoNothing();
  }

  for (const w of source.weeks) {
    await db
      .insert(schema.weeks)
      .values({ teamId: team.id, weekStart: w.weekStart, published: w.published })
      .onConflictDoNothing();
  }

  return { teamId: team.id };
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not set — see .env.example (local: file:./data/dev.db).",
    );
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const db = drizzle(client, { schema });
  // Ensure the target schema exists (idempotent — applied migrations are skipped).
  await migrate(db, { migrationsFolder: "./drizzle" });

  const dir = process.env.SYNCHRO_DATA_DIR ?? path.join(process.cwd(), "data");
  const source = readSourceDb(path.join(dir, "synchro.db"));
  const { teamId } = await seed(db, source);

  console.log(
    `Seeded "${DEFAULT_TEAM_NAME}" (#${teamId}): ${source.people.length} people, ${source.weeks.length} week(s)` +
      `${source.shareToken ? "" : " (generated a new share_token)"}.`,
  );
}

// Run only when executed directly (`node scripts/seed.ts`), not when imported by tests.
if (process.argv[1] && path.basename(process.argv[1]) === "seed.ts") {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
