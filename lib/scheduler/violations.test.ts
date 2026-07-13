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
});
