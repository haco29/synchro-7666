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
  // assignment to that same time-shift; with any kitchen assignment that day
  // (kitchen needs a full day free); and — because backup (10:00–17:00) spans
  // morning and the front of evening — with a backup assignment when the block
  // is on morning or evening (a night-only block does not conflict with backup).
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
  // Per-day kitchen block: keyed `date:personId`, consulted only for kitchen.
  const kitchenBlocked = new Set(
    constraints.filter((c) => c.kind === "blocked_kitchen").map((c) => `${c.value}:${c.personId}`),
  );
  for (const a of assignments) {
    const backupBlocked =
      a.slot === "backup" &&
      (shiftOff.has(`${a.date}:morning:${a.personId}`) ||
        shiftOff.has(`${a.date}:evening:${a.personId}`));
    if (
      wholeDayOff.has(`${a.date}:${a.personId}`) ||
      shiftOff.has(`${a.date}:${a.slot}:${a.personId}`) ||
      (a.slot === "kitchen" && anyShiftOff.has(`${a.date}:${a.personId}`)) ||
      backupBlocked
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

  // Night ends 07:00 the next morning. Kitchen duty, a morning shift (07:00),
  // and a backup shift (10:00) all right after leave no real time to sleep —
  // all three pairings are flagged.
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
    if (a.slot === "backup" && afterNight) {
      violations.push({
        kind: "backup_after_night",
        date: a.date,
        slot: a.slot,
        personId: a.personId,
        message: `${nameOf(a.personId)} has a backup shift on ${dayLabel(a.date)} right after a night shift`,
      });
    }
  }

  return violations;
}
