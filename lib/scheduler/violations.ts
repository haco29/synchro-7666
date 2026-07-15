import type { Assignment, Constraint, Person, Violation } from "../shifts/types";
import { dayLabel } from "../shifts/week";

/**
 * Hard-rule check for a week's assignments, used to warn (not block) after
 * manual overrides. Kitchen-while-on-shift is covered by the double-booking
 * rule, since both are same-day assignments.
 */
export function computeViolations(
  assignments: Assignment[],
  constraints: Constraint[],
  people: Person[],
): Violation[] {
  const names = new Map(people.map((p) => [p.id, p.name]));
  const nameOf = (id: number) => names.get(id) ?? `#${id}`;
  const violations: Violation[] = [];

  const byPersonDay = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const key = `${a.date}:${a.personId}`;
    const list = byPersonDay.get(key) ?? [];
    list.push(a);
    byPersonDay.set(key, list);
  }
  for (const list of byPersonDay.values()) {
    if (list.length > 1) {
      // One violation per involved assignment so every offending seat gets
      // highlighted, not just the "extra" ones.
      for (const a of list) {
        violations.push({
          kind: "double_booked",
          date: a.date,
          slot: a.slot,
          personId: a.personId,
          message: `${nameOf(a.personId)} has ${list.length} assignments on ${dayLabel(a.date)}`,
        });
      }
    }
  }

  // Whole-day off conflicts with any slot; a per-shift block only conflicts
  // with an assignment to that same time-shift.
  const wholeDayOff = new Set(
    constraints
      .filter((c) => c.kind === "unavailable_date")
      .map((c) => `${c.value}:${c.personId}`),
  );
  const shiftOff = new Set(
    constraints
      .filter((c) => c.kind === "unavailable_shift")
      .map((c) => `${c.value}:${c.personId}`),
  );
  for (const a of assignments) {
    if (
      wholeDayOff.has(`${a.date}:${a.personId}`) ||
      shiftOff.has(`${a.date}:${a.slot}:${a.personId}`)
    ) {
      violations.push({
        kind: "unavailable",
        date: a.date,
        slot: a.slot,
        personId: a.personId,
        message: `${nameOf(a.personId)} is marked unavailable for ${a.slot} on ${dayLabel(a.date)}`,
      });
    }
  }

  return violations;
}
