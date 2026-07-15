import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as schema from "@/lib/db/schema";

// getDb() → in-memory test db; Clerk auth() stubbed per test; revalidatePath is a no-op.
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/index", () => ({ getDb: () => holder.db }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The Clerk org member list is stubbed; linkPersonAction validates against it.
vi.mock("@/lib/clerk/members", () => ({ listOrgMembers: vi.fn() }));

import { auth } from "@clerk/nextjs/server";
import * as q from "@/lib/db/queries";
import { listOrgMembers } from "@/lib/clerk/members";
import { computeViolations } from "@/lib/scheduler/violations";
import {
  blockMyWeekAction,
  blockWeekAction,
  linkPersonAction,
  toggleMyShiftUnavailabilityAction,
  toggleMyUnavailabilityAction,
  toggleShiftUnavailableAction,
  unlinkPersonAction,
} from "./actions";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const listOrgMembersMock = listOrgMembers as unknown as ReturnType<typeof vi.fn>;

function stubAuth(value: Record<string, unknown>) {
  authMock.mockResolvedValue(value);
}

/** Stub the caller's org member list (userId → itself as label). */
function stubMembers(userIds: string[]) {
  listOrgMembersMock.mockResolvedValue(userIds.map((userId) => ({ userId, label: userId })));
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

let db: LibSQLDatabase<typeof schema>;
let client: Client;
let dir: string;
let teamId: number;
let personId: number;

beforeEach(async () => {
  vi.clearAllMocks();
  // A temp file (not :memory:) so db.transaction() — used by linkPersonToUser —
  // shares one database across connections (see queries.test.ts).
  dir = mkdtempSync(path.join(tmpdir(), "synchro-a-"));
  client = createClient({ url: `file:${path.join(dir, "test.db")}` });
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  holder.db = db;
  const [team] = await db
    .insert(schema.teams)
    .values({ name: "Team A", clerkOrgId: "org_A" })
    .returning();
  teamId = team.id;
  const [person] = await db
    .insert(schema.people)
    .values({ teamId, name: "Dana" })
    .returning();
  personId = person.id;
});

afterEach(() => {
  // Release the on-disk handle and drop the temp DB so tests don't accumulate files.
  client.close();
  rmSync(dir, { recursive: true, force: true });
});

async function clerkUserIdOf(id: number): Promise<string | null> {
  const row = (await db.select().from(schema.people).where(eq(schema.people.id, id)))[0];
  return row.clerkUserId;
}

describe("linkPersonAction", () => {
  it("links a person to a clerk user when the caller is an admin", async () => {
    stubAuth({ userId: "admin_1", orgId: "org_A", orgRole: "org:admin" });
    stubMembers(["user_1"]);
    await linkPersonAction(form({ personId: String(personId), clerkUserId: "user_1" }));
    expect(await clerkUserIdOf(personId)).toBe("user_1");
  });

  it("rejects a clerkUserId that is not a member of the caller's org", async () => {
    stubAuth({ userId: "admin_1", orgId: "org_A", orgRole: "org:admin" });
    stubMembers(["user_1"]); // the org's real members — "user_ghost" is not among them
    await expect(
      linkPersonAction(form({ personId: String(personId), clerkUserId: "user_ghost" })),
    ).rejects.toThrow();
    expect(await clerkUserIdOf(personId)).toBeNull();
  });

  it("rejects a member (non-admin)", async () => {
    stubAuth({ userId: "member_1", orgId: "org_A", orgRole: "org:member" });
    await expect(
      linkPersonAction(form({ personId: String(personId), clerkUserId: "user_1" })),
    ).rejects.toThrow();
    expect(await clerkUserIdOf(personId)).toBeNull();
  });

  it("rejects malformed input (missing clerkUserId)", async () => {
    stubAuth({ userId: "admin_1", orgId: "org_A", orgRole: "org:admin" });
    await expect(linkPersonAction(form({ personId: String(personId) }))).rejects.toThrow();
    expect(await clerkUserIdOf(personId)).toBeNull();
  });

  it("cannot link a person that belongs to another team (tenancy at the action)", async () => {
    // A person in a different team; the admin of org_A must not be able to link them.
    const [teamB] = await db
      .insert(schema.teams)
      .values({ name: "Team B", clerkOrgId: "org_B" })
      .returning();
    const [foreign] = await db
      .insert(schema.people)
      .values({ teamId: teamB.id, name: "Bella" })
      .returning();

    stubAuth({ userId: "admin_1", orgId: "org_A", orgRole: "org:admin" });
    stubMembers(["user_9"]); // valid org member, so we exercise the team-scoping, not the membership check
    await linkPersonAction(form({ personId: String(foreign.id), clerkUserId: "user_9" }));

    // The foreign person is untouched (team-scoped no-op, no cross-tenant write).
    expect(await clerkUserIdOf(foreign.id)).toBeNull();
  });
});

describe("unlinkPersonAction", () => {
  it("clears the link when the caller is an admin", async () => {
    await db
      .update(schema.people)
      .set({ clerkUserId: "user_1" })
      .where(eq(schema.people.id, personId));
    stubAuth({ userId: "admin_1", orgId: "org_A", orgRole: "org:admin" });
    await unlinkPersonAction(form({ personId: String(personId) }));
    expect(await clerkUserIdOf(personId)).toBeNull();
  });

  it("rejects a member (non-admin)", async () => {
    await db
      .update(schema.people)
      .set({ clerkUserId: "user_1" })
      .where(eq(schema.people.id, personId));
    stubAuth({ userId: "member_1", orgId: "org_A", orgRole: "org:member" });
    await expect(unlinkPersonAction(form({ personId: String(personId) }))).rejects.toThrow();
    expect(await clerkUserIdOf(personId)).toBe("user_1");
  });
});

describe("toggleMyUnavailabilityAction", () => {
  async function linkDana() {
    await db
      .update(schema.people)
      .set({ clerkUserId: "user_1" })
      .where(eq(schema.people.id, personId));
  }

  it("lets a linked member mark their own date unavailable", async () => {
    await linkDana();
    stubAuth({ userId: "user_1", orgId: "org_A", orgRole: "org:member" });

    await toggleMyUnavailabilityAction(
      form({ personId: String(personId), date: "2026-07-14", unavailable: "1" }),
    );

    const cons = await q.listConstraintsForWeek(teamId, "2026-07-12");
    expect(cons).toHaveLength(1);
    expect(cons[0]).toMatchObject({ personId, value: "2026-07-14" });
  });

  it("rejects editing another person's availability (spoofed personId)", async () => {
    await linkDana();
    const [roni] = await db
      .insert(schema.people)
      .values({ teamId, name: "Roni" })
      .returning();
    stubAuth({ userId: "user_1", orgId: "org_A", orgRole: "org:member" });

    // The form claims Roni, but the caller is linked to Dana → must be rejected.
    await expect(
      toggleMyUnavailabilityAction(
        form({ personId: String(roni.id), date: "2026-07-14", unavailable: "1" }),
      ),
    ).rejects.toThrow();
    expect(await q.listConstraintsForWeek(teamId, "2026-07-12")).toHaveLength(0);
  });

  it("rejects a missing personId fail-closed (linked member)", async () => {
    await linkDana();
    stubAuth({ userId: "user_1", orgId: "org_A", orgRole: "org:member" });
    // No personId in the form — must throw, not fall through to a write.
    await expect(
      toggleMyUnavailabilityAction(form({ date: "2026-07-14", unavailable: "1" })),
    ).rejects.toThrow();
    expect(await q.listConstraintsForWeek(teamId, "2026-07-12")).toHaveLength(0);
  });

  it("refuses an inactive linked member (server-side, not just UI)", async () => {
    await linkDana();
    await db.update(schema.people).set({ active: false }).where(eq(schema.people.id, personId));
    stubAuth({ userId: "user_1", orgId: "org_A", orgRole: "org:member" });
    await expect(
      toggleMyUnavailabilityAction(
        form({ personId: String(personId), date: "2026-07-14", unavailable: "1" }),
      ),
    ).rejects.toThrow();
    expect(await q.listConstraintsForWeek(teamId, "2026-07-12")).toHaveLength(0);
  });

  it("refuses an unlinked member", async () => {
    // Dana is NOT linked; the member has no own person.
    stubAuth({ userId: "user_1", orgId: "org_A", orgRole: "org:member" });
    await expect(
      toggleMyUnavailabilityAction(
        form({ personId: String(personId), date: "2026-07-14", unavailable: "1" }),
      ),
    ).rejects.toThrow();
    expect(await q.listConstraintsForWeek(teamId, "2026-07-12")).toHaveLength(0);
  });

  it("does not remove an existing assignment when marking unavailable (D4)", async () => {
    await linkDana();
    await q.replaceWeekAssignments(teamId, "2026-07-12", [
      { date: "2026-07-14", slot: "night", personId },
    ]);
    stubAuth({ userId: "user_1", orgId: "org_A", orgRole: "org:member" });

    await toggleMyUnavailabilityAction(
      form({ personId: String(personId), date: "2026-07-14", unavailable: "1" }),
    );

    // The assignment stays put — only a (non-blocking) violation appears.
    const assignments = await q.listAssignments(teamId, "2026-07-12");
    expect(assignments).toHaveLength(1);
    const violations = computeViolations(
      assignments,
      await q.listConstraintsForWeek(teamId, "2026-07-12"),
      await q.listPeople(teamId, true),
    );
    expect(violations.some((v) => v.personId === personId && v.date === "2026-07-14")).toBe(true);
  });
});

describe("toggleShiftUnavailableAction (admin)", () => {
  it("marks a single time-shift unavailable for any person", async () => {
    stubAuth({ userId: "admin_1", orgId: "org_A", orgRole: "org:admin" });
    await toggleShiftUnavailableAction(
      form({ personId: String(personId), date: "2026-07-14", shift: "morning", unavailable: "1" }),
    );
    const cons = await q.listConstraintsForWeek(teamId, "2026-07-12");
    expect(cons).toHaveLength(1);
    expect(cons[0]).toMatchObject({
      personId,
      kind: "unavailable_shift",
      value: "2026-07-14:morning",
    });
  });

  it("rejects a member (non-admin)", async () => {
    stubAuth({ userId: "member_1", orgId: "org_A", orgRole: "org:member" });
    await expect(
      toggleShiftUnavailableAction(
        form({ personId: String(personId), date: "2026-07-14", shift: "morning", unavailable: "1" }),
      ),
    ).rejects.toThrow();
    expect(await q.listConstraintsForWeek(teamId, "2026-07-12")).toHaveLength(0);
  });

  it("rejects a non-time-shift value (e.g. kitchen)", async () => {
    stubAuth({ userId: "admin_1", orgId: "org_A", orgRole: "org:admin" });
    await expect(
      toggleShiftUnavailableAction(
        form({ personId: String(personId), date: "2026-07-14", shift: "kitchen", unavailable: "1" }),
      ),
    ).rejects.toThrow();
    expect(await q.listConstraintsForWeek(teamId, "2026-07-12")).toHaveLength(0);
  });
});

describe("toggleMyShiftUnavailabilityAction (member self)", () => {
  async function linkDana() {
    await db
      .update(schema.people)
      .set({ clerkUserId: "user_1" })
      .where(eq(schema.people.id, personId));
  }

  it("lets a linked member block their own time-shift", async () => {
    await linkDana();
    stubAuth({ userId: "user_1", orgId: "org_A", orgRole: "org:member" });
    await toggleMyShiftUnavailabilityAction(
      form({ personId: String(personId), date: "2026-07-14", shift: "night", unavailable: "1" }),
    );
    const cons = await q.listConstraintsForWeek(teamId, "2026-07-12");
    expect(cons).toHaveLength(1);
    expect(cons[0]).toMatchObject({ personId, kind: "unavailable_shift", value: "2026-07-14:night" });
  });

  it("rejects editing another person's shift (spoofed personId)", async () => {
    await linkDana();
    const [roni] = await db
      .insert(schema.people)
      .values({ teamId, name: "Roni" })
      .returning();
    stubAuth({ userId: "user_1", orgId: "org_A", orgRole: "org:member" });
    await expect(
      toggleMyShiftUnavailabilityAction(
        form({ personId: String(roni.id), date: "2026-07-14", shift: "night", unavailable: "1" }),
      ),
    ).rejects.toThrow();
    expect(await q.listConstraintsForWeek(teamId, "2026-07-12")).toHaveLength(0);
  });
});

describe("blockWeekAction (admin)", () => {
  it("blocks all 7 days of a week for a person, then clears them", async () => {
    stubAuth({ userId: "admin_1", orgId: "org_A", orgRole: "org:admin" });
    await blockWeekAction(form({ personId: String(personId), weekStart: "2026-07-12", blocked: "1" }));
    expect(await q.listConstraintsForWeek(teamId, "2026-07-12")).toHaveLength(7);
    await blockWeekAction(form({ personId: String(personId), weekStart: "2026-07-12", blocked: "0" }));
    expect(await q.listConstraintsForWeek(teamId, "2026-07-12")).toHaveLength(0);
  });

  it("rejects a member (non-admin)", async () => {
    stubAuth({ userId: "member_1", orgId: "org_A", orgRole: "org:member" });
    await expect(
      blockWeekAction(form({ personId: String(personId), weekStart: "2026-07-12", blocked: "1" })),
    ).rejects.toThrow();
    expect(await q.listConstraintsForWeek(teamId, "2026-07-12")).toHaveLength(0);
  });
});

describe("blockMyWeekAction (member self)", () => {
  async function linkDana() {
    await db
      .update(schema.people)
      .set({ clerkUserId: "user_1" })
      .where(eq(schema.people.id, personId));
  }

  it("lets a linked member block their own week", async () => {
    await linkDana();
    stubAuth({ userId: "user_1", orgId: "org_A", orgRole: "org:member" });
    await blockMyWeekAction(form({ personId: String(personId), weekStart: "2026-07-12", blocked: "1" }));
    expect(await q.listConstraintsForWeek(teamId, "2026-07-12")).toHaveLength(7);
  });

  it("rejects blocking another person's week (spoofed personId)", async () => {
    await linkDana();
    const [roni] = await db
      .insert(schema.people)
      .values({ teamId, name: "Roni" })
      .returning();
    stubAuth({ userId: "user_1", orgId: "org_A", orgRole: "org:member" });
    await expect(
      blockMyWeekAction(form({ personId: String(roni.id), weekStart: "2026-07-12", blocked: "1" })),
    ).rejects.toThrow();
    expect(await q.listConstraintsForWeek(teamId, "2026-07-12")).toHaveLength(0);
  });
});
