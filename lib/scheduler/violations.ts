import type { Assignment, Constraint, Person, Violation } from "../shifts/types";
import { addDays, dayLabel } from "../shifts/week";

/**
 * Hard-rule check for a week's assignments, used to warn (not block) after
 * manual overrides. Kitchen-while-on-shift is covered by the double-booking
 * rule, since both are same-day assignments. `priorDayNights` carries the
 * previous week's last-day night assignments so the kitchen-after-night rule
 * can be checked across the week boundary too.
 */
export function computeViolations(
  assignments: Assignment[],
  constraints: Constraint[],
  people: Person[],
  priorDayNights: Assignment[] = [],
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

  // Whole-day off conflicts with any slot. A per-shift block conflicts with an
  // assignment to that same time-shift, and — because kitchen/backup require
  // full-day availability — with any kitchen/backup assignment that day.
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
  const anyShiftOff = new Set(
    constraints
      .filter((c) => c.kind === "unavailable_shift")
      .map((c) => `${c.value.split(":")[0]}:${c.personId}`),
  );
  // Per-day kitchen block: keyed `date:personId`, consulted only for kitchen.
  const kitchenBlocked = new Set(
    constraints
      .filter((c) => c.kind === "blocked_kitchen")
      .map((c) => `${c.value}:${c.personId}`),
  );
  for (const a of assignments) {
    const fullDaySlot = a.slot === "kitchen" || a.slot === "backup";
    if (
      wholeDayOff.has(`${a.date}:${a.personId}`) ||
      shiftOff.has(`${a.date}:${a.slot}:${a.personId}`) ||
      (fullDaySlot && anyShiftOff.has(`${a.date}:${a.personId}`))
    ) {
      violations.push({
        kind: "unavailable",
        date: a.date,
        slot: a.slot,
        personId: a.personId,
        message: `${nameOf(a.personId)} is marked unavailable for ${a.slot} on ${dayLabel(a.date)}`,
      });
    }
    if (a.slot === "kitchen" && kitchenBlocked.has(`${a.date}:${a.personId}`)) {
      violations.push({
        kind: "kitchen_blocked",
        date: a.date,
        slot: a.slot,
        personId: a.personId,
        message: `${nameOf(a.personId)} is blocked from kitchen duty on ${dayLabel(a.date)}`,
      });
    }
  }

  // Night ends 07:00 the next morning. A full day of kitchen duty right after
  // leaves no time to sleep, and a morning shift (starting 07:00) would run
  // straight off the night as a ~16-hour stretch — both pairings are flagged.
  const nightOn = new Set(
    [...assignments, ...priorDayNights]
      .filter((a) => a.slot === "night")
      .map((a) => `${a.date}:${a.personId}`),
  );
  for (const a of assignments) {
    const afterNight = nightOn.has(`${addDays(a.date, -1)}:${a.personId}`);
    if (a.slot === "kitchen" && afterNight) {
      violations.push({
        kind: "kitchen_after_night",
        date: a.date,
        slot: a.slot,
        personId: a.personId,
        message: `${nameOf(a.personId)} has kitchen duty on ${dayLabel(a.date)} right after a night shift`,
      });
    }
    if (a.slot === "morning" && afterNight) {
      violations.push({
        kind: "morning_after_night",
        date: a.date,
        slot: a.slot,
        personId: a.personId,
        message: `${nameOf(a.personId)} has a morning shift on ${dayLabel(a.date)} right after a night shift`,
      });
    }
  }

  return violations;
}
