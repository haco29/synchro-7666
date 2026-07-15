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
    expect(violations.some((v) => v.kind === "double_booked" && v.personId === 1)).toBe(
      true,
    );
  });

  it("flags assignment on an unavailable day", () => {
    const constraints: Constraint[] = [
      { id: 1, personId: 2, kind: "unavailable_date", value: "2026-07-13" },
    ];
    const assignments: Assignment[] = [
      { date: "2026-07-13", slot: "night", personId: 2 },
    ];
    const violations = computeViolations(assignments, constraints, people);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: "unavailable", personId: 2 });
    expect(violations[0].message).toContain("Bob");
  });

  it("flags an assignment to a blocked time-shift but not to other roles that day", () => {
    const constraints: Constraint[] = [
      { id: 1, personId: 1, kind: "unavailable_shift", value: "2026-07-13:morning" },
    ];
    const conflicting: Assignment[] = [
      { date: "2026-07-13", slot: "morning", personId: 1 },
    ];
    const clean: Assignment[] = [
      { date: "2026-07-13", slot: "evening", personId: 1 }, // different shift, same day
      { date: "2026-07-13", slot: "kitchen", personId: 1 },
    ];
    expect(computeViolations(conflicting, constraints, people)).toHaveLength(1);
    expect(computeViolations(conflicting, constraints, people)[0]).toMatchObject({
      kind: "unavailable",
      slot: "morning",
      personId: 1,
    });
    // evening + kitchen aren't blocked by a morning-only constraint (kitchen has
    // its own double-book check via the same day, but no unavailable violation).
    expect(
      computeViolations(clean, constraints, people).filter((v) => v.kind === "unavailable"),
    ).toHaveLength(0);
  });
});
