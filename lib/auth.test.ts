import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import * as schema from "./db/schema";

// getDb() is replaced with the in-memory test db; auth() is stubbed per test.
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("./db/index", () => ({ getDb: () => holder.db }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));

import { auth } from "@clerk/nextjs/server";
import { AuthError, currentTeam, requireAdmin, requireMember, resolveTeamId } from "./auth";

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

function stubAuth(value: Record<string, unknown>) {
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(value);
}

async function seedDefaultTeam(db: LibSQLDatabase<typeof schema>) {
  await db
    .insert(schema.teams)
    .values({ name: "Default Team", shareToken: "seed-token", clerkOrgId: null })
    .returning();
}

let db: LibSQLDatabase<typeof schema>;

beforeEach(async () => {
  vi.clearAllMocks();
  db = await freshDb();
  holder.db = db;
});

describe("resolveTeamId", () => {
  it("claims the unlinked Default Team for the first org", async () => {
    await seedDefaultTeam(db);

    const teamId = await resolveTeamId(db, "org_A");

    const rows = await db.select().from(schema.teams);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(teamId);
    expect(rows[0].clerkOrgId).toBe("org_A");
  });

  it("returns the existing team for an already-linked org (idempotent)", async () => {
    await seedDefaultTeam(db);
    const first = await resolveTeamId(db, "org_A");
    const second = await resolveTeamId(db, "org_A");

    expect(second).toBe(first);
    expect(await db.select().from(schema.teams)).toHaveLength(1);
  });

  it("creates a new team for a second org once the default is claimed", async () => {
    await seedDefaultTeam(db);
    const teamA = await resolveTeamId(db, "org_A");
    const teamB = await resolveTeamId(db, "org_B");

    expect(teamB).not.toBe(teamA);
    const rows = await db.select().from(schema.teams);
    expect(rows).toHaveLength(2);
    const bRow = rows.find((r) => r.clerkOrgId === "org_B");
    expect(bRow?.id).toBe(teamB);
  });

  it("creates a team when there is no default to claim", async () => {
    const teamId = await resolveTeamId(db, "org_A");
    const rows = await db.select().from(schema.teams).where(eq(schema.teams.id, teamId));
    expect(rows[0].clerkOrgId).toBe("org_A");
  });
});

describe("currentTeam", () => {
  it("throws when signed out", async () => {
    stubAuth({ userId: null, orgId: null });
    await expect(currentTeam()).rejects.toBeInstanceOf(AuthError);
  });

  it("throws when signed in but no active organization", async () => {
    stubAuth({ userId: "user_1", orgId: null });
    await expect(currentTeam()).rejects.toBeInstanceOf(AuthError);
  });

  it("resolves the team id for the active org", async () => {
    await seedDefaultTeam(db);
    stubAuth({ userId: "user_1", orgId: "org_A" });

    const teamId = await currentTeam();

    const rows = await db.select().from(schema.teams).where(eq(schema.teams.clerkOrgId, "org_A"));
    expect(rows[0].id).toBe(teamId);
  });
});

describe("role guards", () => {
  it("requireAdmin rejects a member", async () => {
    await seedDefaultTeam(db);
    stubAuth({ userId: "user_1", orgId: "org_A", orgRole: "org:member" });
    await expect(requireAdmin()).rejects.toBeInstanceOf(AuthError);
  });

  it("requireAdmin passes for org:admin and returns the team id", async () => {
    await seedDefaultTeam(db);
    stubAuth({ userId: "user_1", orgId: "org_A", orgRole: "org:admin" });
    await expect(requireAdmin()).resolves.toEqual({ teamId: expect.any(Number) });
  });

  it("requireMember passes for any signed-in org member", async () => {
    await seedDefaultTeam(db);
    stubAuth({ userId: "user_1", orgId: "org_A", orgRole: "org:member" });
    await expect(requireMember()).resolves.toEqual({ teamId: expect.any(Number) });
  });

  it("requireMember throws when signed out", async () => {
    stubAuth({ userId: null, orgId: null });
    await expect(requireMember()).rejects.toBeInstanceOf(AuthError);
  });
});
