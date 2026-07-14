import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";

/**
 * Applies the committed migrations to a fresh in-memory libSQL DB — the same
 * engine as production, so these assertions exercise the real DDL we ship.
 */
async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await client.execute("PRAGMA foreign_keys = ON");
  return { client, db };
}

describe("schema (initial migration)", () => {
  it("creates the six domain tables", async () => {
    const { client } = await freshDb();
    const rows = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
    );
    const tables = rows.rows.map((r) => r.name as string).sort();
    expect(tables).toEqual(
      ["assignments", "constraints", "people", "settings", "teams", "weeks"].sort(),
    );
  });

  it("enforces unique person name within a team", async () => {
    const { db } = await freshDb();
    const [team] = await db
      .insert(schema.teams)
      .values({ name: "Team A", shareToken: "tok-a" })
      .returning();

    await db.insert(schema.people).values({ teamId: team.id, name: "Dana" });

    await expect(
      db.insert(schema.people).values({ teamId: team.id, name: "Dana" }),
    ).rejects.toThrow();
  });

  it("allows the same person name across different teams", async () => {
    const { db } = await freshDb();
    const [a] = await db
      .insert(schema.teams)
      .values({ name: "Team A", shareToken: "tok-a" })
      .returning();
    const [b] = await db
      .insert(schema.teams)
      .values({ name: "Team B", shareToken: "tok-b" })
      .returning();

    await db.insert(schema.people).values({ teamId: a.id, name: "Dana" });
    await expect(
      db.insert(schema.people).values({ teamId: b.id, name: "Dana" }),
    ).resolves.not.toThrow();
  });

  it("enforces one week_start per team", async () => {
    const { db } = await freshDb();
    const [team] = await db
      .insert(schema.teams)
      .values({ name: "Team A", shareToken: "tok-a" })
      .returning();

    await db.insert(schema.weeks).values({ teamId: team.id, weekStart: "2026-07-19" });

    await expect(
      db.insert(schema.weeks).values({ teamId: team.id, weekStart: "2026-07-19" }),
    ).rejects.toThrow();
  });

  it("requires a unique share_token per team", async () => {
    const { db } = await freshDb();
    await db.insert(schema.teams).values({ name: "Team A", shareToken: "dup" });
    await expect(
      db.insert(schema.teams).values({ name: "Team B", shareToken: "dup" }),
    ).rejects.toThrow();
  });
});
