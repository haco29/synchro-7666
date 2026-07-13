import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Point the DB at a throwaway dir before the client module opens it.
process.env.SYNCHRO_DATA_DIR = mkdtempSync(path.join(tmpdir(), "synchro-test-"));

const q = await import("./queries");

describe("db layer", () => {
  beforeAll(() => {
    q.addPerson("Alice");
    q.addPerson("Bob");
  });

  it("creates and lists people", () => {
    const people = q.listPeople();
    expect(people.map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  it("deactivates a person but keeps them in full listing", () => {
    const bob = q.listPeople().find((p) => p.name === "Bob")!;
    q.setPersonActive(bob.id, false);
    expect(q.listPeople().map((p) => p.name)).toEqual(["Alice"]);
    expect(q.listPeople(true).map((p) => p.name)).toEqual(["Alice", "Bob"]);
    q.setPersonActive(bob.id, true);
  });

  it("stores and clears unavailability, scoped to a week", () => {
    const alice = q.listPeople().find((p) => p.name === "Alice")!;
    q.setUnavailable(alice.id, "2026-07-14", true);
    q.setUnavailable(alice.id, "2026-07-20", true); // next week
    const week = q.listConstraintsForWeek("2026-07-12");
    expect(week).toHaveLength(1);
    expect(week[0]).toMatchObject({ personId: alice.id, value: "2026-07-14" });
    q.setUnavailable(alice.id, "2026-07-14", false);
    expect(q.listConstraintsForWeek("2026-07-12")).toHaveLength(0);
  });

  it("replaces week assignments atomically and reads them back", () => {
    const [alice] = q.listPeople();
    q.replaceWeekAssignments("2026-07-12", [
      { date: "2026-07-12", slot: "morning", personId: alice.id },
      { date: "2026-07-12", slot: "night", personId: alice.id },
    ]);
    expect(q.listAssignments("2026-07-12")).toHaveLength(2);
    q.replaceWeekAssignments("2026-07-12", [
      { date: "2026-07-13", slot: "kitchen", personId: alice.id },
    ]);
    expect(q.listAssignments("2026-07-12")).toHaveLength(1);
  });

  it("aggregates history from weeks before a given start", () => {
    const [alice] = q.listPeople();
    q.replaceWeekAssignments("2026-07-05", [
      { date: "2026-07-05", slot: "night", personId: alice.id },
      { date: "2026-07-06", slot: "kitchen", personId: alice.id },
      { date: "2026-07-07", slot: "morning", personId: alice.id },
    ]);
    const history = q.historyBefore("2026-07-12");
    const h = history.find((x) => x.personId === alice.id)!;
    expect(h.nightCount).toBe(1);
    expect(h.kitchenCount).toBe(1);
    expect(h.totalCount).toBe(3);
    // nothing before the earliest week
    expect(q.historyBefore("2026-07-05")).toHaveLength(0);
  });

  it("swaps a seat atomically and no-ops when the person already holds one", () => {
    const [alice, bob] = q.listPeople(true);
    q.replaceWeekAssignments("2026-07-19", [
      { date: "2026-07-19", slot: "morning", personId: alice.id },
      { date: "2026-07-19", slot: "morning", personId: bob.id },
    ]);
    // Replacing Alice's seat with Bob would shrink the slot — must be a no-op.
    q.swapSeat("2026-07-19", "2026-07-19", "morning", alice.id, bob.id);
    const unchanged = q.listAssignments("2026-07-19");
    expect(unchanged).toHaveLength(2);
    expect(new Set(unchanged.map((a) => a.personId))).toEqual(
      new Set([alice.id, bob.id]),
    );
    // A genuine swap to a third person replaces the seat and keeps the count.
    q.addPerson("Cara");
    const cara = q.listPeople(true).find((p) => p.name === "Cara")!;
    q.swapSeat("2026-07-19", "2026-07-19", "morning", bob.id, cara.id);
    const after = q.listAssignments("2026-07-19");
    expect(after).toHaveLength(2);
    expect(new Set(after.map((a) => a.personId))).toEqual(
      new Set([alice.id, cara.id]),
    );
  });

  it("tracks week publishing", () => {
    expect(q.isWeekPublished("2026-07-12")).toBe(false);
    q.setWeekPublished("2026-07-12", true);
    expect(q.isWeekPublished("2026-07-12")).toBe(true);
    expect(q.listPublishedWeeks()).toContain("2026-07-12");
  });

  it("has a stable share token", () => {
    const token = q.getShareToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(q.getShareToken()).toBe(token);
  });
});
