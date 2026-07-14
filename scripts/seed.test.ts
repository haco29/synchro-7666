import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as schema from "../lib/db/schema.ts";
import { DEFAULT_TEAM_NAME, readSourceDb, seed, type SeedSource } from "./seed.ts";

async function freshTarget() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

const SOURCE: SeedSource = {
  shareToken: "tok-123",
  people: [
    { name: "Dana", active: true },
    { name: "Noa", active: false },
  ],
  weeks: [{ weekStart: "2026-07-19", published: true }],
};

describe("seed", () => {
  it("creates one default team with people, a week, and the source share_token", async () => {
    const db = await freshTarget();
    await seed(db, SOURCE);

    const teams = await db.select().from(schema.teams);
    expect(teams).toHaveLength(1);
    expect(teams[0].name).toBe(DEFAULT_TEAM_NAME);
    expect(teams[0].shareToken).toBe("tok-123");

    expect(await db.select().from(schema.people)).toHaveLength(2);
    expect(await db.select().from(schema.weeks)).toHaveLength(1);
  });

  it("is idempotent — a second run adds no duplicates", async () => {
    const db = await freshTarget();
    await seed(db, SOURCE);
    await seed(db, SOURCE);

    expect(await db.select().from(schema.teams)).toHaveLength(1);
    expect(await db.select().from(schema.people)).toHaveLength(2);
    expect(await db.select().from(schema.weeks)).toHaveLength(1);
  });

  it("generates a share_token when the source has none", async () => {
    const db = await freshTarget();
    await seed(db, { shareToken: null, people: [], weeks: [] });

    const teams = await db.select().from(schema.teams);
    expect(teams[0].shareToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it("readSourceDb reads people, share_token, and weeks from a legacy node:sqlite DB", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "synchro-seed-"));
    const dbPath = path.join(dir, "synchro.db");
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, active INTEGER);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE weeks (week_start TEXT PRIMARY KEY, published INTEGER);
    `);
    legacy.prepare("INSERT INTO people (name, active) VALUES (?, ?)").run("Dana", 1);
    legacy.prepare("INSERT INTO people (name, active) VALUES (?, ?)").run("Noa", 0);
    legacy.prepare("INSERT INTO settings VALUES ('share_token', 'abc')").run();
    legacy.prepare("INSERT INTO weeks VALUES ('2026-07-19', 1)").run();
    legacy.prepare("INSERT INTO weeks VALUES ('1.0', 1)").run(); // legacy garbage
    legacy.close();

    const source = readSourceDb(dbPath);
    rmSync(dir, { recursive: true, force: true });

    expect(source.shareToken).toBe("abc");
    expect(source.people).toEqual([
      { name: "Dana", active: true },
      { name: "Noa", active: false },
    ]);
    // The bogus "1.0" week is skipped; only the valid ISO week survives.
    expect(source.weeks).toEqual([{ weekStart: "2026-07-19", published: true }]);
  });
});
