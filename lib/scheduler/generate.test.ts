import { describe, expect, it } from "vitest";
import { generateWeek } from "./generate";
import { SLOT_CAPACITY, SLOT_TYPES } from "../shifts/types";
import type { Assignment, Constraint, GenerateInput, Person, PersonHistory } from "../shifts/types";
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
  // night ends 07:00 next day — that person must sleep, never kitchen next day
  const nightOn = new Set(
    assignments.filter((a) => a.slot === "night").map((a) => `${a.date}:${a.personId}`),
  );
  for (const a of assignments) {
    if (a.slot === "kitchen") {
      expect(
        nightOn.has(`${addDays(a.date, -1)}:${a.personId}`),
        `kitchen on ${a.date} right after a night shift`,
      ).toBe(false);
    }
    // night ends 07:00, morning starts 07:00 — no morning right after a night
    if (a.slot === "morning") {
      expect(
        nightOn.has(`${addDays(a.date, -1)}:${a.personId}`),
        `morning on ${a.date} right after a night shift`,
      ).toBe(false);
    }
    // night ends 07:00, backup starts 10:00 — no backup right after a night
    if (a.slot === "backup") {
      expect(
        nightOn.has(`${addDays(a.date, -1)}:${a.personId}`),
        `backup on ${a.date} right after a night shift`,
      ).toBe(false);
    }
  }
  // a person blocked from kitchen on a date never gets kitchen that day
  const kitchenBlocked = new Set(
    constraints.filter((c) => c.kind === "blocked_kitchen").map((c) => `${c.value}:${c.personId}`),
  );
  for (const a of assignments) {
    if (a.slot === "kitchen") {
      expect(
        kitchenBlocked.has(`${a.date}:${a.personId}`),
        `kitchen on ${a.date} for a kitchen-blocked person`,
      ).toBe(false);
    }
  }
  const wholeDayOff = new Set(
    constraints.filter((c) => c.kind === "unavailable_date").map((c) => `${c.value}:${c.personId}`),
  );
  const shiftOff = new Set(
    constraints
      .filter((c) => c.kind === "unavailable_shift")
      .map((c) => `${c.value}:${c.personId}`),
  );
  const anyShiftOff = new Set(
    constraints
      .filter((c) => c.kind === "unavailable_shift")
      .map((c) => `${c.value.split(":")[0]}:${c.personId}`),
  );
  // Backup (10:00–17:00) overlaps morning and the front of evening but not
  // night, so it is ruled out only by a morning or evening block that day.
  const morningOrEveningOff = new Set(
    constraints
      .filter(
        (c) =>
          c.kind === "unavailable_shift" &&
          (c.value.endsWith(":morning") || c.value.endsWith(":evening")),
      )
      .map((c) => `${c.value.split(":")[0]}:${c.personId}`),
  );
  for (const a of assignments) {
    // never assigned on a whole-day off
    expect(wholeDayOff.has(`${a.date}:${a.personId}`), `assigned while off all day`).toBe(false);
    if (a.slot === "kitchen") {
      // kitchen requires a full day free — no per-shift block that day
      expect(
        anyShiftOff.has(`${a.date}:${a.personId}`),
        `kitchen assigned despite a per-shift block`,
      ).toBe(false);
    } else if (a.slot === "backup") {
      // backup needs morning AND evening free — a night-only block is fine
      expect(
        morningOrEveningOff.has(`${a.date}:${a.personId}`),
        `backup assigned despite a morning/evening block`,
      ).toBe(false);
    } else {
      // never assigned to a blocked time-shift
      expect(
        shiftOff.has(`${a.date}:${a.slot}:${a.personId}`),
        `assigned to blocked ${a.slot}`,
      ).toBe(false);
    }
  }
}

describe("generateWeek", () => {
  it("fills every slot with a big enough roster and respects capacities", () => {
    const { assignments, gaps } = generateWeek(input({ people: roster(10) }));
    expect(gaps).toHaveLength(0);
    expect(assignments).toHaveLength(35); // 7 days × 5 roles × 1 seat
    for (const date of weekDates(WEEK)) {
      for (const slot of SLOT_TYPES) {
        const filled = assignments.filter((a) => a.date === date && a.slot === slot);
        expect(filled).toHaveLength(SLOT_CAPACITY[slot]);
      }
    }
    assertHardRules(assignments, []);
  });

  it("staffs exactly one backup (rest) person per day", () => {
    const { assignments } = generateWeek(input({ people: roster(6) }));
    for (const date of weekDates(WEEK)) {
      const backups = assignments.filter((a) => a.date === date && a.slot === "backup");
      expect(backups, `one backup on ${date}`).toHaveLength(1);
    }
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

  it("staffs every work shift with a 5-person roster; only backup may gap", () => {
    // 5 people, 5 roles/day. The after-night rest rule bars the post-night
    // person from morning, kitchen AND backup, leaving them only night/evening
    // — so on a tight roster the greedy engine can strand them and leave the
    // lowest-priority backup (on-call) slot empty. The four work shifts are
    // always staffed and the hard rules always hold; any gap lands on backup.
    const { assignments, gaps } = generateWeek(input({ people: roster(5) }));
    assertHardRules(assignments, []);
    expect(gaps.every((g) => g.slot === "backup")).toBe(true);
    for (const date of weekDates(WEEK)) {
      for (const slot of ["morning", "evening", "night", "kitchen"] as const) {
        expect(
          assignments.some((a) => a.date === date && a.slot === slot),
          `${slot} on ${date} should be staffed`,
        ).toBe(true);
      }
    }
  });

  it("keeps cumulative night, kitchen and backup/rest fair across 4 consecutive weeks", () => {
    const people = roster(8);
    const nightTotals = new Map<number, number>(people.map((p) => [p.id, 0]));
    const kitchenTotals = new Map<number, number>(people.map((p) => [p.id, 0]));
    const backupTotals = new Map<number, number>(people.map((p) => [p.id, 0]));
    const totals = new Map<number, number>(people.map((p) => [p.id, 0]));

    let weekStart = WEEK;
    for (let w = 0; w < 4; w++) {
      const history: PersonHistory[] = people.map((p) => ({
        personId: p.id,
        nightCount: nightTotals.get(p.id)!,
        kitchenCount: kitchenTotals.get(p.id)!,
        backupCount: backupTotals.get(p.id)!,
        totalCount: totals.get(p.id)!,
      }));
      const { assignments, gaps } = generateWeek(input({ people, history, weekStart, seed: w }));
      expect(gaps).toHaveLength(0);
      for (const a of assignments) {
        totals.set(a.personId, totals.get(a.personId)! + 1);
        if (a.slot === "night") {
          nightTotals.set(a.personId, nightTotals.get(a.personId)! + 1);
        }
        if (a.slot === "kitchen") {
          kitchenTotals.set(a.personId, kitchenTotals.get(a.personId)! + 1);
        }
        if (a.slot === "backup") {
          backupTotals.set(a.personId, backupTotals.get(a.personId)! + 1);
        }
      }
      weekStart = addDays(weekStart, 7);
    }

    // 28 night slots over 8 people = 3.5 each; allow small slack
    const nights = [...nightTotals.values()];
    expect(Math.max(...nights) - Math.min(...nights)).toBeLessThanOrEqual(2);
    // kitchen: 28 duties over 8 people
    const kitchens = [...kitchenTotals.values()];
    expect(Math.max(...kitchens) - Math.min(...kitchens)).toBeLessThanOrEqual(2);
    // backup/rest: 28 rest days over 8 people — the perk must rotate evenly too
    const backups = [...backupTotals.values()];
    expect(Math.max(...backups) - Math.min(...backups)).toBeLessThanOrEqual(2);
  });

  it("never puts the kitchen person on a shift the same day", () => {
    for (let seed = 0; seed < 10; seed++) {
      const { assignments } = generateWeek(input({ people: roster(8), seed }));
      for (const a of assignments.filter((x) => x.slot === "kitchen")) {
        const sameDay = assignments.filter((x) => x.date === a.date && x.personId === a.personId);
        expect(sameDay).toHaveLength(1);
      }
    }
  });

  it("never assigns kitchen to the previous day's night person", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { assignments } = generateWeek(input({ people: roster(6), seed }));
      assertHardRules(assignments, []);
    }
  });

  it("keeps the prior week's last night person off kitchen on the first day", () => {
    // Per-shift blocks make persons 2 and 3 ineligible for day-0 kitchen
    // (kitchen needs a full day free) and person 1's heavy night history steers
    // day-0 night to the others — so day-0 kitchen can only be person 1.
    const people = roster(3);
    const constraints: Constraint[] = [
      { id: 1, personId: 2, kind: "unavailable_shift", value: `${WEEK}:morning` },
      { id: 2, personId: 3, kind: "unavailable_shift", value: `${WEEK}:evening` },
    ];
    const history: PersonHistory[] = [
      { personId: 1, nightCount: 100, kitchenCount: 0, backupCount: 0, totalCount: 0 },
    ];
    for (let seed = 0; seed < 10; seed++) {
      // Without the boundary input person 1 takes the day-0 kitchen seat…
      const without = generateWeek(input({ people, constraints, history, seed }));
      expect(
        without.assignments.some(
          (a) => a.date === WEEK && a.slot === "kitchen" && a.personId === 1,
        ),
      ).toBe(true);
      // …but a night shift the day before the week starts rules them out: gap.
      const withPrior = generateWeek(
        input({ people, constraints, history, seed, priorNightPersonIds: [1] }),
      );
      expect(
        withPrior.assignments.some(
          (a) => a.date === WEEK && a.slot === "kitchen" && a.personId === 1,
        ),
      ).toBe(false);
      expect(withPrior.gaps.some((g) => g.date === WEEK && g.slot === "kitchen")).toBe(true);
    }
  });

  it("never assigns morning to the previous day's night person", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { assignments } = generateWeek(input({ people: roster(6), seed }));
      assertHardRules(assignments, []);
    }
  });

  it("keeps the prior week's last night person off morning on the first day", () => {
    // Person 1's heavy night+kitchen history steers day-0 night and kitchen to
    // the other two, who are then busy — so day-0 morning can only be person 1.
    const people = roster(3);
    const history: PersonHistory[] = [
      { personId: 1, nightCount: 100, kitchenCount: 100, backupCount: 0, totalCount: 0 },
    ];
    for (let seed = 0; seed < 10; seed++) {
      // Without the boundary input person 1 takes the day-0 morning seat…
      const without = generateWeek(input({ people, history, seed }));
      expect(
        without.assignments.some(
          (a) => a.date === WEEK && a.slot === "morning" && a.personId === 1,
        ),
      ).toBe(true);
      // …but a night shift the day before the week starts rules them out: gap.
      const withPrior = generateWeek(input({ people, history, seed, priorNightPersonIds: [1] }));
      expect(
        withPrior.assignments.some(
          (a) => a.date === WEEK && a.slot === "morning" && a.personId === 1,
        ),
      ).toBe(false);
      expect(withPrior.gaps.some((g) => g.date === WEEK && g.slot === "morning")).toBe(true);
    }
  });

  it("never assigns kitchen to a person blocked from kitchen that day", () => {
    const people = roster(6);
    const D = addDays(WEEK, 2);
    const constraints: Constraint[] = [
      { id: 1, personId: 1, kind: "blocked_kitchen", value: D },
      { id: 2, personId: 3, kind: "blocked_kitchen", value: D },
    ];
    for (let seed = 0; seed < 20; seed++) {
      const { assignments } = generateWeek(input({ people, constraints, seed }));
      assertHardRules(assignments, constraints);
    }
  });

  it("gaps the kitchen seat when the only eligible person is blocked from kitchen", () => {
    // Persons 2 and 3 have a per-shift block on day 0, which also rules them out
    // of kitchen (kitchen needs a full day free) — so only person 1 can cover
    // day-0 kitchen. Blocking person 1 from kitchen then leaves it unfilled,
    // while person 1 still picks up a normal shift.
    const people = roster(3);
    const constraints: Constraint[] = [
      { id: 1, personId: 2, kind: "unavailable_shift", value: `${WEEK}:morning` },
      { id: 2, personId: 3, kind: "unavailable_shift", value: `${WEEK}:evening` },
    ];
    // Person 1's heavy night history steers day-0 night to the others, leaving
    // person 1 free for the day-0 kitchen seat (the only one they can cover).
    const history: PersonHistory[] = [
      { personId: 1, nightCount: 100, kitchenCount: 0, backupCount: 0, totalCount: 0 },
    ];
    for (let seed = 0; seed < 10; seed++) {
      // Without the kitchen block, person 1 takes the day-0 kitchen seat…
      const without = generateWeek(input({ people, constraints, history, seed }));
      expect(
        without.assignments.some(
          (a) => a.date === WEEK && a.slot === "kitchen" && a.personId === 1,
        ),
      ).toBe(true);
      // …but a kitchen block on person 1 rules them out: the seat gaps.
      const blocked: Constraint[] = [
        ...constraints,
        { id: 3, personId: 1, kind: "blocked_kitchen", value: WEEK },
      ];
      const withBlock = generateWeek(input({ people, constraints: blocked, history, seed }));
      expect(
        withBlock.assignments.some(
          (a) => a.date === WEEK && a.slot === "kitchen" && a.personId === 1,
        ),
      ).toBe(false);
      expect(withBlock.gaps.some((g) => g.date === WEEK && g.slot === "kitchen")).toBe(true);
      // Person 1 is still used that day — just not on kitchen.
      expect(withBlock.assignments.some((a) => a.date === WEEK && a.personId === 1)).toBe(true);
    }
  });

  it("reports gaps instead of failing when the roster is too small", () => {
    // 4 people can cover at most 4 of the 5 daily roles
    const { assignments, gaps } = generateWeek(input({ people: roster(4) }));
    expect(gaps.length).toBe(7); // 1 unfilled per day × 7 days
    expect(assignments).toHaveLength(28);
    assertHardRules(assignments, []);
  });

  it("prioritizes work shifts over backup when short-staffed — gaps land on backup, not work", () => {
    // 4 people, 5 roles/day. The rest role (backup) is the lowest priority, so
    // it is what goes unfilled — never a morning/evening/night/kitchen shift.
    const { assignments, gaps } = generateWeek(input({ people: roster(4) }));
    for (const date of weekDates(WEEK)) {
      for (const slot of ["morning", "evening", "night", "kitchen"] as const) {
        expect(
          assignments.some((a) => a.date === date && a.slot === slot),
          `${slot} on ${date} should be staffed`,
        ).toBe(true);
      }
      expect(assignments.some((a) => a.date === date && a.slot === "backup")).toBe(false);
    }
    expect(gaps.every((g) => g.slot === "backup")).toBe(true);
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
    expect(gaps.filter((g) => g.date === addDays(WEEK, 2))).toHaveLength(5);
    assertHardRules(assignments, constraints);
  });

  it("blocks a shift AND kitchen/backup that day, but keeps the other time-shifts open", () => {
    const people = roster(6);
    const D = addDays(WEEK, 2);
    const constraints: Constraint[] = [
      { id: 1, personId: 1, kind: "unavailable_shift", value: `${D}:morning` },
    ];
    const slotsSeen = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const { assignments } = generateWeek(input({ people, constraints, seed }));
      assertHardRules(assignments, constraints);
      for (const a of assignments.filter((a) => a.date === D && a.personId === 1)) {
        slotsSeen.add(a.slot);
      }
    }
    // Person 1 still gets used on D — but only for the other time-shifts.
    expect(slotsSeen.size).toBeGreaterThan(0);
    // The blocked morning is off-limits, and so are kitchen (needs a full day
    // free) and backup (needs morning free) that day.
    expect(slotsSeen.has("morning")).toBe(false);
    expect(slotsSeen.has("kitchen")).toBe(false);
    expect(slotsSeen.has("backup")).toBe(false);
  });

  it("makes a person blocked on morning ineligible for kitchen and backup too", () => {
    // Person 2 is off the whole day; person 1 is blocked for the morning shift.
    // Kitchen needs a full day free and backup needs morning free, so neither
    // person can cover them — those slots gap rather than being filled by P1.
    const people = roster(2);
    const D = addDays(WEEK, 1);
    const constraints: Constraint[] = [
      { id: 99, personId: 2, kind: "unavailable_date", value: D },
      { id: 1, personId: 1, kind: "unavailable_shift", value: `${D}:morning` },
    ];
    const { assignments, gaps } = generateWeek(input({ people, constraints, seed: 3 }));
    assertHardRules(assignments, constraints);
    // Person 1 is never placed on kitchen or backup on D.
    const p1FullDay = assignments.filter(
      (a) => a.date === D && a.personId === 1 && (a.slot === "kitchen" || a.slot === "backup"),
    );
    expect(p1FullDay).toHaveLength(0);
    // With no full-day-free person, kitchen and backup gap on D.
    expect(gaps.some((g) => g.date === D && g.slot === "kitchen")).toBe(true);
    expect(gaps.some((g) => g.date === D && g.slot === "backup")).toBe(true);
  });

  it("steers backup away from someone already far ahead on rest (history-seeded)", () => {
    // Backup is zero-weight for work load but balanced on its own history. A
    // person way ahead on backups must draw the rest role far less than others
    // — even though a naive weekTotal rule would pick them (their work total is
    // low). It isn't strictly zero only because the after-night rule can leave
    // them the sole eligible candidate on a tight day (better to fill than gap).
    const people = roster(6);
    const history: PersonHistory[] = people.map((p) => ({
      personId: p.id,
      nightCount: 0,
      kitchenCount: 0,
      backupCount: p.id === 1 ? 100 : 0,
      totalCount: 0,
    }));
    let p1Backups = 0;
    let othersBackups = 0;
    for (let seed = 0; seed < 10; seed++) {
      const { assignments } = generateWeek(input({ people, history, seed }));
      for (const a of assignments.filter((a) => a.slot === "backup")) {
        if (a.personId === 1) p1Backups++;
        else othersBackups++;
      }
    }
    // Person 1 draws the rest role well below even a single other person's
    // average share (othersBackups / 5), let alone their own fair share.
    expect(p1Backups).toBeLessThan(othersBackups / 5);
  });

  it("keeps a night-only-blocked person eligible for backup (no full day needed)", () => {
    // Backup (10:00–17:00) overlaps morning and evening but NOT night, so a
    // block on just the night shift must not disqualify backup. Person 1 is
    // blocked for night every day; everyone else gets a big backup-history head
    // start so the rest role is steered to person 1 whenever they're free.
    const people = roster(6);
    const constraints: Constraint[] = weekDates(WEEK).map((d, i) => ({
      id: i + 1,
      personId: 1,
      kind: "unavailable_shift" as const,
      value: `${d}:night`,
    }));
    const history: PersonHistory[] = people.map((p) => ({
      personId: p.id,
      nightCount: 0,
      kitchenCount: 0,
      backupCount: p.id === 1 ? 0 : 100,
      totalCount: 0,
    }));
    let p1Backups = 0;
    for (let seed = 0; seed < 10; seed++) {
      const { assignments } = generateWeek(input({ people, constraints, history, seed }));
      assertHardRules(assignments, constraints);
      p1Backups += assignments.filter((a) => a.slot === "backup" && a.personId === 1).length;
      // Never night (blocked) and never kitchen (a per-shift block removes the
      // full day kitchen still needs) — but backup stays open.
      expect(
        assignments.some((a) => a.personId === 1 && (a.slot === "night" || a.slot === "kitchen")),
      ).toBe(false);
    }
    expect(p1Backups).toBeGreaterThan(0);
  });

  it("bars backup for a person blocked on morning or evening that day", () => {
    const people = roster(6);
    const D = addDays(WEEK, 2);
    for (const shift of ["morning", "evening"] as const) {
      const constraints: Constraint[] = [
        { id: 1, personId: 1, kind: "unavailable_shift", value: `${D}:${shift}` },
      ];
      for (let seed = 0; seed < 15; seed++) {
        const { assignments } = generateWeek(input({ people, constraints, seed }));
        assertHardRules(assignments, constraints);
        expect(
          assignments.some((a) => a.date === D && a.slot === "backup" && a.personId === 1),
          `${shift}-blocked person must not get backup`,
        ).toBe(false);
      }
    }
  });

  it("keeps the prior week's last night person off backup on the first day", () => {
    // Night ends 07:00, backup starts 10:00 — no real sleep, same as the
    // morning/kitchen after-night rule. Everyone but person 1 has a big backup
    // head start, so without a prior night person 1 lands day-0 backup; a prior
    // night rules them out.
    const people = roster(6);
    const history: PersonHistory[] = people.map((p) => ({
      personId: p.id,
      nightCount: 0,
      kitchenCount: 0,
      backupCount: p.id === 1 ? 0 : 100,
      totalCount: 0,
    }));
    let withoutHits = 0;
    for (let seed = 0; seed < 15; seed++) {
      const without = generateWeek(input({ people, history, seed }));
      if (
        without.assignments.some((a) => a.date === WEEK && a.slot === "backup" && a.personId === 1)
      ) {
        withoutHits++;
      }
      const withPrior = generateWeek(input({ people, history, seed, priorNightPersonIds: [1] }));
      expect(
        withPrior.assignments.some(
          (a) => a.date === WEEK && a.slot === "backup" && a.personId === 1,
        ),
        "prior-night person must not get day-0 backup",
      ).toBe(false);
    }
    // Sanity: without the prior night person 1 does land day-0 backup, so the
    // absence above is the boundary rule at work, not chance.
    expect(withoutHits).toBeGreaterThan(0);
  });

  it("blocks a whole-day-off person from every role, including kitchen and backup", () => {
    const people = roster(6);
    const D = addDays(WEEK, 3);
    const constraints: Constraint[] = [{ id: 1, personId: 1, kind: "unavailable_date", value: D }];
    for (let seed = 0; seed < 10; seed++) {
      const { assignments } = generateWeek(input({ people, constraints, seed }));
      expect(assignments.some((a) => a.date === D && a.personId === 1)).toBe(false);
    }
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
    expect(gaps).toHaveLength(35); // 5 roles × 7 days
  });
});

describe("no roster-order bias", () => {
  // With identical candidates and no prior history, the only thing that can
  // decide a tie is the seeded RNG — never a person's position in the roster.
  // So across many seeds every roster INDEX must win a fair share of each
  // role. A biased engine (e.g. ties falling to candidates[0]) would pile the
  // scarce/rest roles onto the first person; this is the direct guard for the
  // "not biased to the first user" requirement.
  function tally(seeds: number) {
    const people = roster(8);
    const zero = () => new Map<number, number>(people.map((p) => [p.id, 0]));
    const totals = zero();
    const nights = zero();
    const kitchens = zero();
    const backups = zero();
    for (let seed = 0; seed < seeds; seed++) {
      const { assignments } = generateWeek(input({ people, seed }));
      for (const a of assignments) {
        totals.set(a.personId, totals.get(a.personId)! + 1);
        if (a.slot === "night") nights.set(a.personId, nights.get(a.personId)! + 1);
        if (a.slot === "kitchen") kitchens.set(a.personId, kitchens.get(a.personId)! + 1);
        if (a.slot === "backup") backups.set(a.personId, backups.get(a.personId)! + 1);
      }
    }
    return { totals, nights, kitchens, backups };
  }

  const spreadRatio = (m: Map<number, number>) => {
    const v = [...m.values()];
    return Math.max(...v) / Math.min(...v);
  };

  it("spreads night, kitchen, backup and total evenly across roster positions", () => {
    // Fully deterministic: fixed seeds 0..239, no wall-clock/randomness. The
    // fair engine lands every ratio near 1.07; a roster-order-biased engine
    // would pile roles on the first indices and blow past this bound.
    const { totals, nights, kitchens, backups } = tally(240);
    expect(spreadRatio(totals)).toBeLessThan(1.25);
    expect(spreadRatio(nights)).toBeLessThan(1.25);
    expect(spreadRatio(kitchens)).toBeLessThan(1.25);
    expect(spreadRatio(backups)).toBeLessThan(1.25);
  });

  it("does not favor the first roster position for the scarce/rest roles", () => {
    // Sharpest single check: over many seeds the first person must not collect
    // materially more nights or backups than the last — the "first user" trap.
    const { nights, backups } = tally(240);
    const ids = [...nights.keys()];
    const first = ids[0];
    const last = ids[ids.length - 1];
    expect(nights.get(first)! / nights.get(last)!).toBeLessThan(1.25);
    expect(backups.get(first)! / backups.get(last)!).toBeLessThan(1.25);
  });
});
