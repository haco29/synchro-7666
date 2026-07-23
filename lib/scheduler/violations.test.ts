import { describe, expect, it } from "vitest";
import { computeViolations } from "./violations";
import type { Assignment, Constraint } from "../shifts/types";

const people = [
  { id: 1, name: "Alice", active: true },
  { id: 2, name: "Bob", active: true },
];

describe("computeViolations", () => {
  it("returns nothing for a clean schedule", () => {
    const assignments: Assignment[] = [
      { date: "2026-07-12", slot: "morning", personId: 1 },
      { date: "2026-07-12", slot: "evening", personId: 2 },
    ];
    expect(computeViolations(assignments, [], people)).toEqual([]);
  });

  it("flags a person assigned twice on the same day", () => {
    const assignments: Assignment[] = [
      { date: "2026-07-12", slot: "morning", personId: 1 },
      { date: "2026-07-12", slot: "kitchen", personId: 1 },
    ];
    const violations = computeViolations(assignments, [], people);
    expect(violations.some((v) => v.kind === "double_booked" && v.personId === 1)).toBe(true);
  });

  it("flags assignment on an unavailable day", () => {
    const constraints: Constraint[] = [
      { id: 1, personId: 2, kind: "unavailable_date", value: "2026-07-13" },
    ];
    const assignments: Assignment[] = [{ date: "2026-07-13", slot: "night", personId: 2 }];
    const violations = computeViolations(assignments, constraints, people);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: "unavailable", personId: 2 });
    expect(violations[0].message).toContain("Bob");
  });

  it("flags kitchen duty the day after a night shift", () => {
    const assignments: Assignment[] = [
      { date: "2026-07-13", slot: "night", personId: 1 },
      { date: "2026-07-14", slot: "kitchen", personId: 1 },
    ];
    const violations = computeViolations(assignments, [], people);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      kind: "kitchen_after_night",
      date: "2026-07-14",
      slot: "kitchen",
      personId: 1,
    });
    expect(violations[0].message).toContain("Alice");
  });

  it("does not flag kitchen when the previous night was someone else's", () => {
    const assignments: Assignment[] = [
      { date: "2026-07-13", slot: "night", personId: 2 },
      { date: "2026-07-14", slot: "kitchen", personId: 1 },
    ];
    expect(computeViolations(assignments, [], people)).toEqual([]);
  });

  it("flags first-day kitchen after a night shift from the prior week", () => {
    const priorDayNights: Assignment[] = [{ date: "2026-07-11", slot: "night", personId: 1 }];
    const assignments: Assignment[] = [{ date: "2026-07-12", slot: "kitchen", personId: 1 }];
    const violations = computeViolations(assignments, [], people, priorDayNights);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      kind: "kitchen_after_night",
      date: "2026-07-12",
      personId: 1,
    });
    // Without the prior-week context the same schedule is clean.
    expect(computeViolations(assignments, [], people)).toEqual([]);
  });

  it("flags a morning shift the day after a night shift", () => {
    const assignments: Assignment[] = [
      { date: "2026-07-13", slot: "night", personId: 1 },
      { date: "2026-07-14", slot: "morning", personId: 1 },
    ];
    const violations = computeViolations(assignments, [], people);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      kind: "morning_after_night",
      date: "2026-07-14",
      slot: "morning",
      personId: 1,
    });
    expect(violations[0].message).toContain("Alice");
  });

  it("does not flag morning when the previous night was someone else's", () => {
    const assignments: Assignment[] = [
      { date: "2026-07-13", slot: "night", personId: 2 },
      { date: "2026-07-14", slot: "morning", personId: 1 },
    ];
    expect(computeViolations(assignments, [], people)).toEqual([]);
  });

  it("flags first-day morning after a night shift from the prior week", () => {
    const priorDayNights: Assignment[] = [{ date: "2026-07-11", slot: "night", personId: 1 }];
    const assignments: Assignment[] = [{ date: "2026-07-12", slot: "morning", personId: 1 }];
    const violations = computeViolations(assignments, [], people, priorDayNights);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      kind: "morning_after_night",
      date: "2026-07-12",
      personId: 1,
    });
    // Without the prior-week context the same schedule is clean.
    expect(computeViolations(assignments, [], people)).toEqual([]);
  });

  it("flags a kitchen assignment on a day the person is blocked from kitchen", () => {
    const constraints: Constraint[] = [
      { id: 1, personId: 1, kind: "blocked_kitchen", value: "2026-07-14" },
    ];
    const assignments: Assignment[] = [{ date: "2026-07-14", slot: "kitchen", personId: 1 }];
    const violations = computeViolations(assignments, constraints, people);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      kind: "kitchen_blocked",
      date: "2026-07-14",
      slot: "kitchen",
      personId: 1,
    });
    expect(violations[0].message).toContain("Alice");
  });

  it("does not flag the kitchen block on a different date or a different person", () => {
    const constraints: Constraint[] = [
      { id: 1, personId: 1, kind: "blocked_kitchen", value: "2026-07-14" },
    ];
    const assignments: Assignment[] = [
      // Same person, kitchen on a day they are NOT blocked.
      { date: "2026-07-15", slot: "kitchen", personId: 1 },
      // Someone else's kitchen on the blocked date.
      { date: "2026-07-14", slot: "kitchen", personId: 2 },
    ];
    expect(computeViolations(assignments, constraints, people)).toEqual([]);
  });

  it("does not flag the blocked person's other shifts on the blocked day", () => {
    const constraints: Constraint[] = [
      { id: 1, personId: 1, kind: "blocked_kitchen", value: "2026-07-14" },
    ];
    const assignments: Assignment[] = [
      { date: "2026-07-14", slot: "morning", personId: 1 },
      { date: "2026-07-14", slot: "night", personId: 1 },
    ];
    // The block is kitchen-only; morning/evening/night that day are fine.
    // (Two assignments the same day is a separate double_booked concern.)
    expect(
      computeViolations(assignments, constraints, people).filter(
        (v) => v.kind === "kitchen_blocked",
      ),
    ).toEqual([]);
  });

  it("flags a blocked time-shift, plus kitchen and backup per their availability rules", () => {
    const constraints: Constraint[] = [
      { id: 1, personId: 1, kind: "unavailable_shift", value: "2026-07-13:morning" },
    ];
    const conflicting: Assignment[] = [{ date: "2026-07-13", slot: "morning", personId: 1 }];
    expect(computeViolations(conflicting, constraints, people)).toHaveLength(1);
    expect(computeViolations(conflicting, constraints, people)[0]).toMatchObject({
      kind: "unavailable",
      slot: "morning",
      personId: 1,
    });
    // A different time-shift that day is fine — the block is shift-scoped there.
    const otherShift: Assignment[] = [{ date: "2026-07-13", slot: "evening", personId: 1 }];
    expect(
      computeViolations(otherShift, constraints, people).filter((v) => v.kind === "unavailable"),
    ).toHaveLength(0);
    // Kitchen needs a full day free, and backup needs morning free, so a morning
    // block makes either of them an unavailable violation that day.
    for (const slot of ["kitchen", "backup"] as const) {
      const fullDay: Assignment[] = [{ date: "2026-07-13", slot, personId: 1 }];
      const v = computeViolations(fullDay, constraints, people).filter(
        (x) => x.kind === "unavailable",
      );
      expect(v, `${slot} should be flagged`).toHaveLength(1);
      expect(v[0]).toMatchObject({ kind: "unavailable", slot, personId: 1 });
    }
  });

  it("does not flag backup when only the night shift is blocked (backup skips night)", () => {
    // Backup (10:00–17:00) overlaps morning and evening but not night, so a
    // night-only block leaves backup clean — while kitchen (full day) is flagged.
    const constraints: Constraint[] = [
      { id: 1, personId: 1, kind: "unavailable_shift", value: "2026-07-13:night" },
    ];
    const backup: Assignment[] = [{ date: "2026-07-13", slot: "backup", personId: 1 }];
    expect(
      computeViolations(backup, constraints, people).filter((v) => v.kind === "unavailable"),
    ).toHaveLength(0);
    const kitchen: Assignment[] = [{ date: "2026-07-13", slot: "kitchen", personId: 1 }];
    expect(
      computeViolations(kitchen, constraints, people).filter((v) => v.kind === "unavailable"),
    ).toHaveLength(1);
  });

  it("flags a backup shift the day after a night shift", () => {
    const assignments: Assignment[] = [
      { date: "2026-07-13", slot: "night", personId: 1 },
      { date: "2026-07-14", slot: "backup", personId: 1 },
    ];
    const violations = computeViolations(assignments, [], people);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      kind: "backup_after_night",
      date: "2026-07-14",
      slot: "backup",
      personId: 1,
    });
    expect(violations[0].message).toContain("Alice");
  });

  it("does not flag backup when the previous night was someone else's", () => {
    const assignments: Assignment[] = [
      { date: "2026-07-13", slot: "night", personId: 2 },
      { date: "2026-07-14", slot: "backup", personId: 1 },
    ];
    expect(computeViolations(assignments, [], people)).toEqual([]);
  });

  it("flags first-day backup after a night shift from the prior week", () => {
    const priorDayNights: Assignment[] = [{ date: "2026-07-11", slot: "night", personId: 1 }];
    const assignments: Assignment[] = [{ date: "2026-07-12", slot: "backup", personId: 1 }];
    const violations = computeViolations(assignments, [], people, priorDayNights);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      kind: "backup_after_night",
      date: "2026-07-12",
      personId: 1,
    });
    // Without the prior-week context the same schedule is clean.
    expect(computeViolations(assignments, [], people)).toEqual([]);
  });
});
