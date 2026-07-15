import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
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
      .values({ name: "Team A" })
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
      .values({ name: "Team A" })
      .returning();
    const [b] = await db
      .insert(schema.teams)
      .values({ name: "Team B" })
      .returning();

    await db.insert(schema.people).values({ teamId: a.id, name: "Dana" });
    await expect(
      db.insert(schema.people).values({ teamId: b.id, name: "Dana" }),
    ).resolves.not.toThrow();
  });

  it("allows people with no clerk_user_id (unlinked/roster-only)", async () => {
    const { db } = await freshDb();
    const [team] = await db.insert(schema.teams).values({ name: "Team A" }).returning();

    // Two unlinked people (NULL clerk_user_id) must coexist — the unique index
    // must not treat NULLs as colliding.
    await db.insert(schema.people).values({ teamId: team.id, name: "Dana" });
    await expect(
      db.insert(schema.people).values({ teamId: team.id, name: "Roni" }),
    ).resolves.not.toThrow();
  });

  it("enforces a unique clerk_user_id (one person per Clerk user)", async () => {
    const { db } = await freshDb();
    const [team] = await db.insert(schema.teams).values({ name: "Team A" }).returning();

    await db
      .insert(schema.people)
      .values({ teamId: team.id, name: "Dana", clerkUserId: "user_1" });

    await expect(
      db
        .insert(schema.people)
        .values({ teamId: team.id, name: "Roni", clerkUserId: "user_1" }),
    ).rejects.toThrow();
  });

  it("enforces one week_start per team", async () => {
    const { db } = await freshDb();
    const [team] = await db
      .insert(schema.teams)
      .values({ name: "Team A" })
      .returning();

    await db.insert(schema.weeks).values({ teamId: team.id, weekStart: "2026-07-19" });

    await expect(
      db.insert(schema.weeks).values({ teamId: team.id, weekStart: "2026-07-19" }),
    ).rejects.toThrow();
  });

  it("cascades deletes from team → people → constraints, and team → weeks → assignments", async () => {
    const { db, client } = await freshDb();
    const [team] = await db
      .insert(schema.teams)
      .values({ name: "Team A" })
      .returning();
    const [person] = await db
      .insert(schema.people)
      .values({ teamId: team.id, name: "Dana" })
      .returning();
    await db
      .insert(schema.constraints)
      .values({ personId: person.id, value: "2026-07-14" });
    const [week] = await db
      .insert(schema.weeks)
      .values({ teamId: team.id, weekStart: "2026-07-19" })
      .returning();
    await db
      .insert(schema.assignments)
      .values({ weekId: week.id, date: "2026-07-19", slot: "night", personId: person.id });

    await db.delete(schema.teams).where(eq(schema.teams.id, team.id));

    for (const t of ["people", "constraints", "weeks", "assignments"]) {
      const r = await client.execute(`SELECT COUNT(*) AS n FROM ${t}`);
      expect(r.rows[0].n).toBe(0);
    }
  });
});
