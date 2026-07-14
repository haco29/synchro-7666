import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as schema from "./schema";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("./index", () => ({ getDb: () => holder.db }));

const q = await import("./queries");

async function makeTeam(db: LibSQLDatabase<typeof schema>, name: string): Promise<number> {
  const [team] = await db.insert(schema.teams).values({ name }).returning();
  return team.id;
}

let db: LibSQLDatabase<typeof schema>;
let teamA: number;
let teamB: number;

beforeEach(async () => {
  // A temp file (not :memory:) so db.transaction() shares one database across
  // connections — libSQL gives each connection its own :memory: db.
  const dir = mkdtempSync(path.join(tmpdir(), "synchro-q-"));
  const client = createClient({ url: `file:${path.join(dir, "test.db")}` });
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  holder.db = db;
  teamA = await makeTeam(db, "Team A");
  teamB = await makeTeam(db, "Team B");
});

describe("people", () => {
  it("creates and lists active people ordered by name", async () => {
    await q.addPerson(teamA, "Bob");
    await q.addPerson(teamA, "Alice");
    expect((await q.listPeople(teamA)).map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  it("re-adding a name reactivates rather than duplicating", async () => {
    await q.addPerson(teamA, "Alice");
    const alice = (await q.listPeople(teamA))[0];
    await q.setPersonActive(teamA, alice.id, false);
    expect(await q.listPeople(teamA)).toHaveLength(0);
    await q.addPerson(teamA, "Alice");
    expect((await q.listPeople(teamA)).map((p) => p.name)).toEqual(["Alice"]);
  });

  it("deactivates but keeps the person in the full listing", async () => {
    await q.addPerson(teamA, "Alice");
    await q.addPerson(teamA, "Bob");
    const bob = (await q.listPeople(teamA)).find((p) => p.name === "Bob")!;
    await q.setPersonActive(teamA, bob.id, false);
    expect((await q.listPeople(teamA)).map((p) => p.name)).toEqual(["Alice"]);
    expect((await q.listPeople(teamA, true)).map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  it("renames a person, ignoring a name collision", async () => {
    await q.addPerson(teamA, "Alice");
    await q.addPerson(teamA, "Bob");
    const bob = (await q.listPeople(teamA)).find((p) => p.name === "Bob")!;
    await q.renamePerson(teamA, bob.id, "Robert");
    expect((await q.listPeople(teamA)).map((p) => p.name)).toEqual(["Alice", "Robert"]);
    // Colliding with an existing name is a no-op, not an error.
    await q.renamePerson(teamA, bob.id, "Alice");
    expect((await q.listPeople(teamA)).map((p) => p.name)).toEqual(["Alice", "Robert"]);
  });

  it("scopes people to their team", async () => {
    await q.addPerson(teamA, "Alice");
    await q.addPerson(teamB, "BORG"); // same-name-across-teams also allowed
    await q.addPerson(teamB, "Alice");
    expect((await q.listPeople(teamA)).map((p) => p.name)).toEqual(["Alice"]);
    expect((await q.listPeople(teamB)).map((p) => p.name)).toEqual(["Alice", "BORG"].sort());
  });
});

describe("linking people to Clerk users", () => {
  it("links a person to a clerk user and surfaces it in the admin listing", async () => {
    await q.addPerson(teamA, "Alice");
    const alice = (await q.listPeople(teamA))[0];
    await q.linkPersonToUser(teamA, alice.id, "user_1");
    const linked = (await q.listPeopleWithUserLinks(teamA)).find((p) => p.id === alice.id)!;
    expect(linked.clerkUserId).toBe("user_1");
  });

  it("unlinks a person (clears the clerk user id)", async () => {
    await q.addPerson(teamA, "Alice");
    const alice = (await q.listPeople(teamA))[0];
    await q.linkPersonToUser(teamA, alice.id, "user_1");
    await q.unlinkPerson(teamA, alice.id);
    const p = (await q.listPeopleWithUserLinks(teamA)).find((x) => x.id === alice.id)!;
    expect(p.clerkUserId).toBeNull();
  });

  it("relinking a clerk user moves the link (last-write-wins)", async () => {
    await q.addPerson(teamA, "Alice");
    await q.addPerson(teamA, "Bob");
    const [alice, bob] = await q.listPeople(teamA, true);
    await q.linkPersonToUser(teamA, alice.id, "user_1");
    await q.linkPersonToUser(teamA, bob.id, "user_1");
    const people = await q.listPeopleWithUserLinks(teamA);
    expect(people.find((p) => p.id === alice.id)!.clerkUserId).toBeNull();
    expect(people.find((p) => p.id === bob.id)!.clerkUserId).toBe("user_1");
  });

  it("does not link a person from another team", async () => {
    await q.addPerson(teamB, "Bella");
    const bella = (await q.listPeople(teamB))[0];
    // teamA cannot link teamB's person — must be a no-op.
    await q.linkPersonToUser(teamA, bella.id, "user_1");
    const p = (await q.listPeopleWithUserLinks(teamB)).find((x) => x.id === bella.id)!;
    expect(p.clerkUserId).toBeNull();
  });

  it("resolves a clerk user to their linked person, scoped to the team", async () => {
    await q.addPerson(teamA, "Alice");
    const alice = (await q.listPeople(teamA))[0];
    await q.linkPersonToUser(teamA, alice.id, "user_1");

    expect(await q.personForUser(teamA, "user_1")).toBe(alice.id);
    // Unlinked user in the team → undefined.
    expect(await q.personForUser(teamA, "user_x")).toBeUndefined();
    // The link does not resolve under another team.
    expect(await q.personForUser(teamB, "user_1")).toBeUndefined();
  });
});

describe("constraints (unavailable dates)", () => {
  it("stores and clears unavailability within the week window", async () => {
    await q.addPerson(teamA, "Alice");
    const alice = (await q.listPeople(teamA))[0];
    await q.setUnavailable(teamA, alice.id, "2026-07-14", true);
    await q.setUnavailable(teamA, alice.id, "2026-07-20", true); // next week
    const week = await q.listConstraintsForWeek(teamA, "2026-07-12");
    expect(week).toHaveLength(1);
    expect(week[0]).toMatchObject({ personId: alice.id, value: "2026-07-14" });
    await q.setUnavailable(teamA, alice.id, "2026-07-14", false);
    expect(await q.listConstraintsForWeek(teamA, "2026-07-12")).toHaveLength(0);
  });

  it("does not leak another team's constraints", async () => {
    await q.addPerson(teamB, "Zoe");
    const zoe = (await q.listPeople(teamB))[0];
    await q.setUnavailable(teamB, zoe.id, "2026-07-14", true);
    expect(await q.listConstraintsForWeek(teamA, "2026-07-12")).toHaveLength(0);
    expect(await q.listConstraintsForWeek(teamB, "2026-07-12")).toHaveLength(1);
  });
});

describe("weeks", () => {
  it("tracks publishing per team independently", async () => {
    expect(await q.isWeekPublished(teamA, "2026-07-12")).toBe(false);
    await q.setWeekPublished(teamA, "2026-07-12", true);
    expect(await q.isWeekPublished(teamA, "2026-07-12")).toBe(true);
    expect(await q.listPublishedWeeks(teamA)).toContain("2026-07-12");
    // Same week_start in team B is unaffected.
    expect(await q.isWeekPublished(teamB, "2026-07-12")).toBe(false);
    expect(await q.listPublishedWeeks(teamB)).toHaveLength(0);
  });
});

describe("assignments", () => {
  it("replaces a week's assignments atomically and reads them back", async () => {
    await q.addPerson(teamA, "Alice");
    const alice = (await q.listPeople(teamA))[0];
    await q.replaceWeekAssignments(teamA, "2026-07-12", [
      { date: "2026-07-12", slot: "morning", personId: alice.id },
      { date: "2026-07-12", slot: "night", personId: alice.id },
    ]);
    expect(await q.listAssignments(teamA, "2026-07-12")).toHaveLength(2);
    await q.replaceWeekAssignments(teamA, "2026-07-12", [
      { date: "2026-07-13", slot: "kitchen", personId: alice.id },
    ]);
    expect(await q.listAssignments(teamA, "2026-07-12")).toHaveLength(1);
  });

  it("removes a single assignment", async () => {
    await q.addPerson(teamA, "Alice");
    const alice = (await q.listPeople(teamA))[0];
    await q.replaceWeekAssignments(teamA, "2026-07-12", [
      { date: "2026-07-12", slot: "morning", personId: alice.id },
    ]);
    await q.removeAssignment(teamA, "2026-07-12", {
      date: "2026-07-12",
      slot: "morning",
      personId: alice.id,
    });
    expect(await q.listAssignments(teamA, "2026-07-12")).toHaveLength(0);
  });

  it("keeps assignments isolated across teams", async () => {
    await q.addPerson(teamA, "Alice");
    await q.addPerson(teamB, "Bella");
    const alice = (await q.listPeople(teamA))[0];
    const bella = (await q.listPeople(teamB))[0];
    await q.replaceWeekAssignments(teamA, "2026-07-12", [
      { date: "2026-07-12", slot: "morning", personId: alice.id },
    ]);
    await q.replaceWeekAssignments(teamB, "2026-07-12", [
      { date: "2026-07-12", slot: "morning", personId: bella.id },
    ]);
    expect(await q.listAssignments(teamA, "2026-07-12")).toEqual([
      { date: "2026-07-12", slot: "morning", personId: alice.id },
    ]);
    expect(await q.listAssignments(teamB, "2026-07-12")).toEqual([
      { date: "2026-07-12", slot: "morning", personId: bella.id },
    ]);
  });
});

describe("swapSeat", () => {
  it("no-ops when the incoming person already holds a seat in the slot", async () => {
    await q.addPerson(teamA, "Alice");
    await q.addPerson(teamA, "Bob");
    const [alice, bob] = await q.listPeople(teamA, true);
    await q.replaceWeekAssignments(teamA, "2026-07-19", [
      { date: "2026-07-19", slot: "morning", personId: alice.id },
      { date: "2026-07-19", slot: "morning", personId: bob.id },
    ]);
    await q.swapSeat(teamA, "2026-07-19", "2026-07-19", "morning", alice.id, bob.id);
    const unchanged = await q.listAssignments(teamA, "2026-07-19");
    expect(new Set(unchanged.map((a) => a.personId))).toEqual(new Set([alice.id, bob.id]));
  });

  it("swaps a seat to a different person keeping the count", async () => {
    await q.addPerson(teamA, "Alice");
    await q.addPerson(teamA, "Bob");
    await q.addPerson(teamA, "Cara");
    const [alice, bob, cara] = await q.listPeople(teamA, true);
    await q.replaceWeekAssignments(teamA, "2026-07-19", [
      { date: "2026-07-19", slot: "morning", personId: alice.id },
      { date: "2026-07-19", slot: "morning", personId: bob.id },
    ]);
    await q.swapSeat(teamA, "2026-07-19", "2026-07-19", "morning", bob.id, cara.id);
    const after = await q.listAssignments(teamA, "2026-07-19");
    expect(after).toHaveLength(2);
    expect(new Set(after.map((a) => a.personId))).toEqual(new Set([alice.id, cara.id]));
  });

  it("aborts a swap with a stale previousPersonId instead of overfilling", async () => {
    await q.addPerson(teamA, "Alice");
    await q.addPerson(teamA, "Bob");
    await q.addPerson(teamA, "Dave");
    const [alice, bob, dave] = await q.listPeople(teamA, true);
    await q.replaceWeekAssignments(teamA, "2026-07-26", [
      { date: "2026-07-26", slot: "night", personId: alice.id },
    ]);
    // Bob was never in this seat — the insert must not run.
    await q.swapSeat(teamA, "2026-07-26", "2026-07-26", "night", bob.id, dave.id);
    const seats = await q.listAssignments(teamA, "2026-07-26");
    expect(seats).toHaveLength(1);
    expect(seats[0].personId).toBe(alice.id);
  });
});

describe("historyBefore", () => {
  it("aggregates night/kitchen/total from weeks before the given start", async () => {
    await q.addPerson(teamA, "Alice");
    const alice = (await q.listPeople(teamA))[0];
    await q.replaceWeekAssignments(teamA, "2026-07-05", [
      { date: "2026-07-05", slot: "night", personId: alice.id },
      { date: "2026-07-06", slot: "kitchen", personId: alice.id },
      { date: "2026-07-07", slot: "morning", personId: alice.id },
    ]);
    const h = (await q.historyBefore(teamA, "2026-07-12")).find((x) => x.personId === alice.id)!;
    expect(h).toMatchObject({ nightCount: 1, kitchenCount: 1, totalCount: 3 });
    expect(await q.historyBefore(teamA, "2026-07-05")).toHaveLength(0);
  });

  it("does not count another team's assignments", async () => {
    await q.addPerson(teamB, "Zoe");
    const zoe = (await q.listPeople(teamB))[0];
    await q.replaceWeekAssignments(teamB, "2026-07-05", [
      { date: "2026-07-05", slot: "night", personId: zoe.id },
    ]);
    expect(await q.historyBefore(teamA, "2026-07-12")).toHaveLength(0);
  });
});

describe("tenancy integrity — assignment writers reject foreign people", () => {
  it("swapSeat ignores a person that belongs to another team", async () => {
    await q.addPerson(teamA, "Alice");
    await q.addPerson(teamB, "Bella");
    const alice = (await q.listPeople(teamA))[0];
    const bella = (await q.listPeople(teamB))[0];

    // Team B's person must not be seatable into team A's week.
    await q.swapSeat(teamA, "2026-07-19", "2026-07-19", "morning", null, bella.id);
    expect(await q.listAssignments(teamA, "2026-07-19")).toHaveLength(0);

    // Team A's own person seats normally.
    await q.swapSeat(teamA, "2026-07-19", "2026-07-19", "morning", null, alice.id);
    const seats = await q.listAssignments(teamA, "2026-07-19");
    expect(seats).toEqual([{ date: "2026-07-19", slot: "morning", personId: alice.id }]);
  });

  it("replaceWeekAssignments drops rows for people from another team", async () => {
    await q.addPerson(teamA, "Alice");
    await q.addPerson(teamB, "Bella");
    const alice = (await q.listPeople(teamA))[0];
    const bella = (await q.listPeople(teamB))[0];

    await q.replaceWeekAssignments(teamA, "2026-07-19", [
      { date: "2026-07-19", slot: "morning", personId: alice.id },
      { date: "2026-07-19", slot: "night", personId: bella.id }, // foreign — must be dropped
    ]);
    const seats = await q.listAssignments(teamA, "2026-07-19");
    expect(seats).toEqual([{ date: "2026-07-19", slot: "morning", personId: alice.id }]);
  });
});
