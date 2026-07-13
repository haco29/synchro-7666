import { describe, expect, it } from "vitest";
import { generateWeek } from "./generate";
import { SLOT_CAPACITY, SLOT_TYPES } from "../shifts/types";
import type {
  Assignment,
  Constraint,
  GenerateInput,
  Person,
  PersonHistory,
} from "../shifts/types";
import { addDays, weekDates } from "../shifts/week";

const WEEK = "2026-07-12"; // a Sunday

function roster(n: number): Person[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `P${i + 1}`,
    active: true,
  }));
}

function input(partial: Partial<GenerateInput> & { people: Person[] }): GenerateInput {
  return { weekStart: WEEK, constraints: [], history: [], seed: 42, ...partial };
}

function assertHardRules(assignments: Assignment[], constraints: Constraint[]) {
  // at most one slot per person per day
  const perDay = new Map<string, number>();
  for (const a of assignments) {
    const key = `${a.date}:${a.personId}`;
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  for (const [key, count] of perDay) {
    expect(count, `person double-booked on ${key}`).toBe(1);
  }
  // never assigned on an unavailable date
  const unavailable = new Set(
    constraints.map((c) => `${c.value}:${c.personId}`),
  );
  for (const a of assignments) {
    expect(unavailable.has(`${a.date}:${a.personId}`), `assigned while unavailable`).toBe(
      false,
    );
  }
}

describe("generateWeek", () => {
  it("fills every slot with a big enough roster and respects capacities", () => {
    const { assignments, gaps } = generateWeek(input({ people: roster(10) }));
    expect(gaps).toHaveLength(0);
    expect(assignments).toHaveLength(49); // 7 days × (2+2+2+1)
    for (const date of weekDates(WEEK)) {
      for (const slot of SLOT_TYPES) {
        const filled = assignments.filter((a) => a.date === date && a.slot === slot);
        expect(filled).toHaveLength(SLOT_CAPACITY[slot]);
      }
    }
    assertHardRules(assignments, []);
  });

  it("never double-books or uses unavailable people (fuzz across seeds)", () => {
    const people = roster(9);
    const constraints: Constraint[] = [
      { id: 1, personId: 1, kind: "unavailable_date", value: WEEK },
      { id: 2, personId: 1, kind: "unavailable_date", value: addDays(WEEK, 1) },
      { id: 3, personId: 2, kind: "unavailable_date", value: addDays(WEEK, 3) },
      { id: 4, personId: 3, kind: "unavailable_date", value: addDays(WEEK, 6) },
    ];
    for (let seed = 0; seed < 20; seed++) {
      const { assignments } = generateWeek(input({ people, constraints, seed }));
      assertHardRules(assignments, constraints);
    }
  });

  it("balances totals evenly within a week when the roster divides evenly", () => {
    // 7 people × 7 days = 49 slots → everyone should get exactly 7
    const { assignments, gaps } = generateWeek(input({ people: roster(7) }));
    expect(gaps).toHaveLength(0);
    const totals = new Map<number, number>();
    for (const a of assignments) {
      totals.set(a.personId, (totals.get(a.personId) ?? 0) + 1);
    }
    const counts = [...totals.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("keeps cumulative night shifts fair across 4 consecutive weeks", () => {
    const people = roster(8);
    const nightTotals = new Map<number, number>(people.map((p) => [p.id, 0]));
    const kitchenTotals = new Map<number, number>(people.map((p) => [p.id, 0]));
    const totals = new Map<number, number>(people.map((p) => [p.id, 0]));

    let weekStart = WEEK;
    for (let w = 0; w < 4; w++) {
      const history: PersonHistory[] = people.map((p) => ({
        personId: p.id,
        nightCount: nightTotals.get(p.id)!,
        kitchenCount: kitchenTotals.get(p.id)!,
        totalCount: totals.get(p.id)!,
      }));
      const { assignments, gaps } = generateWeek(
        input({ people, history, weekStart, seed: w }),
      );
      expect(gaps).toHaveLength(0);
      for (const a of assignments) {
        totals.set(a.personId, totals.get(a.personId)! + 1);
        if (a.slot === "night") {
          nightTotals.set(a.personId, nightTotals.get(a.personId)! + 1);
        }
        if (a.slot === "kitchen") {
          kitchenTotals.set(a.personId, kitchenTotals.get(a.personId)! + 1);
        }
      }
      weekStart = addDays(weekStart, 7);
    }

    // 56 night slots over 8 people = 7 each; allow ±1 slack
    const nights = [...nightTotals.values()];
    expect(Math.max(...nights) - Math.min(...nights)).toBeLessThanOrEqual(1);
    // kitchen: 28 duties over 8 people; allow small slack
    const kitchens = [...kitchenTotals.values()];
    expect(Math.max(...kitchens) - Math.min(...kitchens)).toBeLessThanOrEqual(2);
  });

  it("never puts the kitchen person on a shift the same day", () => {
    for (let seed = 0; seed < 10; seed++) {
      const { assignments } = generateWeek(input({ people: roster(8), seed }));
      for (const a of assignments.filter((x) => x.slot === "kitchen")) {
        const sameDay = assignments.filter(
          (x) => x.date === a.date && x.personId === a.personId,
        );
        expect(sameDay).toHaveLength(1);
      }
    }
  });

  it("reports gaps instead of failing when the roster is too small", () => {
    // 4 people can cover at most 4 of 7 daily slots
    const { assignments, gaps } = generateWeek(input({ people: roster(4) }));
    expect(gaps.length).toBe(21); // 3 unfilled per day × 7 days
    expect(assignments).toHaveLength(28);
    assertHardRules(assignments, []);
  });

  it("reports full-day gaps when everyone is unavailable", () => {
    const people = roster(8);
    const constraints: Constraint[] = people.map((p, i) => ({
      id: i + 1,
      personId: p.id,
      kind: "unavailable_date",
      value: addDays(WEEK, 2),
    }));
    const { assignments, gaps } = generateWeek(input({ people, constraints }));
    expect(gaps.filter((g) => g.date === addDays(WEEK, 2))).toHaveLength(7);
    assertHardRules(assignments, constraints);
  });

  it("is deterministic for the same seed and varies across seeds", () => {
    const people = roster(9);
    const a = generateWeek(input({ people, seed: 7 }));
    const b = generateWeek(input({ people, seed: 7 }));
    expect(a).toEqual(b);
    const c = generateWeek(input({ people, seed: 8 }));
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it("handles an empty roster", () => {
    const { assignments, gaps } = generateWeek(input({ people: [] }));
    expect(assignments).toHaveLength(0);
    expect(gaps).toHaveLength(49);
  });
});
