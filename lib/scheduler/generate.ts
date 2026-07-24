import type { Assignment, Gap, GenerateInput, GenerateResult, SlotType } from "../shifts/types";
import { restHoursBetween, SLOT_CAPACITY } from "../shifts/types";
import { addDays, weekDates } from "../shifts/week";

/**
 * Fill order within each day. Full work roles come first — night (scarcest
 * fairness budget) and kitchen ahead of morning/evening — so they always take
 * priority over backup. Backup (10:00–17:00) is a lighter mid-day on-call
 * shift: filled LAST from whoever remains, scored by its own history so the
 * perk still rotates fairly; when a day is short-staffed it is backup that
 * gaps, never a full work shift.
 */
const FILL_ORDER: SlotType[] = ["night", "kitchen", "morning", "evening", "backup"];

/** Scoring weights: lower score wins the slot. */
const W_WEEK_TOTAL = 1;
// Kitchen is the heaviest slot — demanding full-day duty — so it rotates most
// protectively: its balance weight sits above night's.
const W_KITCHEN_BALANCE = 4;
const W_NIGHT_BALANCE = 3;
const W_BACKUP_BALANCE = 3;
const W_TIEBREAK = 0.01;

// Soft rest-gap penalty. A person handed two shifts less than MIN_REST_HOURS
// apart (e.g. an 8h "clopening": evening then next-day morning, or night then
// next-day evening) is scored worse — the shorter the gap, the bigger the hit —
// so the scheduler minimizes short turnarounds without ever forbidding them: if
// the penalized person is still the best fit they are chosen and no slot gaps.
// The penalty scales by how heavy the shift being recovered FROM was, so coming
// off kitchen costs more rest than coming off a night (kitchen > night).
const MIN_REST_HOURS = 11;
const W_REST_GAP = 0.6;
const RECOVERY_WEIGHT: Partial<Record<SlotType, number>> = { kitchen: 2, night: 1.5 };

/**
 * Score penalty for working `next` the day after `prev`. Zero once the rest gap
 * reaches MIN_REST_HOURS; below that it grows as the gap shrinks and is scaled
 * by how heavy `prev` was to recover from — so at an equal gap, coming off
 * kitchen costs more than off a night, which costs more than a plain shift.
 */
export function restGapPenalty(prev: SlotType, next: SlotType): number {
  const rest = restHoursBetween(prev, next);
  if (rest >= MIN_REST_HOURS) return 0;
  return (MIN_REST_HOURS - rest) * W_REST_GAP * (RECOVERY_WEIGHT[prev] ?? 1);
}

/** Deterministic PRNG (mulberry32) so a given seed always yields one schedule. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Greedy fair scheduler. For every slot position, assigns the eligible person
 * with the lowest fairness score. Hard rules are structural: one slot per
 * person per day, unavailable people are never eligible, and the previous
 * night's person never gets kitchen OR a morning shift the next day (they need
 * to sleep). On top of the hard rules, a soft rest-gap penalty discourages
 * short turnarounds between a person's consecutive-day shifts (weighted most
 * heavily coming off kitchen, then night). Unfillable positions are returned as
 * gaps, never silently dropped.
 */
export function generateWeek(input: GenerateInput): GenerateResult {
  const rng = makeRng(input.seed ?? 1);
  const dates = weekDates(input.weekStart);

  // Whole-day off blocks every slot. A per-shift block blocks that one
  // time-shift AND, because kitchen and backup require full-day availability,
  // it also makes the person ineligible for kitchen/backup that day.
  // Keys: wholeDayOff `${date}:${personId}`, shiftOff `${date}:${shift}:${personId}`
  // (the shift value is already `date:shift`), anyShiftOff `${date}:${personId}`.
  const wholeDayOff = new Set(
    input.constraints
      .filter((c) => c.kind === "unavailable_date")
      .map((c) => `${c.value}:${c.personId}`),
  );
  const shiftOff = new Set(
    input.constraints
      .filter((c) => c.kind === "unavailable_shift")
      .map((c) => `${c.value}:${c.personId}`),
  );
  const anyShiftOff = new Set(
    input.constraints
      .filter((c) => c.kind === "unavailable_shift")
      .map((c) => `${c.value.split(":")[0]}:${c.personId}`),
  );
  // Per-day kitchen block: value is the date, so key `date:personId`. Only the
  // kitchen slot consults this — every other slot stays open to the person.
  const kitchenBlocked = new Set(
    input.constraints
      .filter((c) => c.kind === "blocked_kitchen")
      .map((c) => `${c.value}:${c.personId}`),
  );

  const nightHist = new Map<number, number>();
  const kitchenHist = new Map<number, number>();
  const backupHist = new Map<number, number>();
  for (const h of input.history) {
    nightHist.set(h.personId, h.nightCount);
    kitchenHist.set(h.personId, h.kitchenCount);
    backupHist.set(h.personId, h.backupCount);
  }

  const weekTotal = new Map<number, number>();
  const busyOn = new Map<string, Set<number>>(); // date -> personIds assigned
  const nightOn = new Map<string, Set<number>>(); // date -> personIds on night
  const dayShift = new Map<string, SlotType>(); // `${personId}:${date}` -> slot
  // Seed with the prior week's last night so the after-night rules (no kitchen,
  // no morning) hold across the week boundary, not just within the week.
  if (input.priorNightPersonIds?.length) {
    nightOn.set(addDays(input.weekStart, -1), new Set(input.priorNightPersonIds));
  }
  // Seed each person's prior-day slot so the rest-gap penalty catches a short
  // turnaround off the previous week's last day (e.g. its evening into a 07:00
  // morning on day one), the same way nightOn is seeded above.
  if (input.priorDayAssignments?.length) {
    const priorDate = addDays(input.weekStart, -1);
    for (const a of input.priorDayAssignments) {
      dayShift.set(`${a.personId}:${priorDate}`, a.slot);
    }
  }

  const assignments: Assignment[] = [];
  const gaps: Gap[] = [];

  for (const date of dates) {
    for (const slot of FILL_ORDER) {
      // Availability by slot: a time-shift is blocked only by a matching
      // per-shift block. Kitchen is a full-day duty, so any per-shift block
      // that day disqualifies it. Backup (10:00–17:00) overlaps morning and
      // the front of evening but NOT night, so it only needs those two shifts
      // free — a night-only block leaves the person eligible for backup.
      // Kitchen, morning AND backup additionally exclude whoever worked the
      // previous night — night ends 07:00, so kitchen duty, a 07:00 morning,
      // and a 10:00 backup all leave no real time to sleep. (FILL_ORDER puts
      // night first, so the previous day's night is always known.)
      const isTimeShift = slot !== "kitchen" && slot !== "backup";
      const availableForSlot = (id: number) =>
        isTimeShift
          ? !shiftOff.has(`${date}:${slot}:${id}`)
          : slot === "kitchen"
            ? !anyShiftOff.has(`${date}:${id}`)
            : !shiftOff.has(`${date}:morning:${id}`) && !shiftOff.has(`${date}:evening:${id}`);
      const sleptOff =
        slot === "kitchen" || slot === "morning" || slot === "backup"
          ? nightOn.get(addDays(date, -1))
          : undefined;
      for (let seat = 0; seat < SLOT_CAPACITY[slot]; seat++) {
        const candidates = input.people.filter(
          (p) =>
            p.active &&
            !wholeDayOff.has(`${date}:${p.id}`) &&
            availableForSlot(p.id) &&
            !(slot === "kitchen" && kitchenBlocked.has(`${date}:${p.id}`)) &&
            !sleptOff?.has(p.id) &&
            !busyOn.get(date)?.has(p.id),
        );
        if (candidates.length === 0) {
          gaps.push({ date, slot });
          continue;
        }

        const isBackup = slot === "backup";
        let best = candidates[0];
        let bestScore = Infinity;
        for (const p of candidates) {
          // Backup is a lighter on-call shift: it never adds to the work-load
          // total, so being on backup doesn't make a person "look busy". It
          // balances on its own history instead, so the perk rotates evenly.
          let score = isBackup
            ? (backupHist.get(p.id) ?? 0) * W_BACKUP_BALANCE
            : (weekTotal.get(p.id) ?? 0) * W_WEEK_TOTAL;
          if (slot === "night") {
            score += (nightHist.get(p.id) ?? 0) * W_NIGHT_BALANCE;
          }
          if (slot === "kitchen") {
            score += (kitchenHist.get(p.id) ?? 0) * W_KITCHEN_BALANCE;
          }
          // Discourage a short turnaround off yesterday's shift (see restGapPenalty).
          const prevSlot = dayShift.get(`${p.id}:${addDays(date, -1)}`);
          if (prevSlot) score += restGapPenalty(prevSlot, slot);
          score += rng() * W_TIEBREAK;
          if (score < bestScore) {
            bestScore = score;
            best = p;
          }
        }

        assignments.push({ date, slot, personId: best.id });
        if (!busyOn.has(date)) busyOn.set(date, new Set());
        busyOn.get(date)!.add(best.id);
        dayShift.set(`${best.id}:${date}`, slot);
        if (isBackup) {
          backupHist.set(best.id, (backupHist.get(best.id) ?? 0) + 1);
        } else {
          weekTotal.set(best.id, (weekTotal.get(best.id) ?? 0) + 1);
        }
        if (slot === "night") {
          if (!nightOn.has(date)) nightOn.set(date, new Set());
          nightOn.get(date)!.add(best.id);
          nightHist.set(best.id, (nightHist.get(best.id) ?? 0) + 1);
        }
        if (slot === "kitchen") {
          kitchenHist.set(best.id, (kitchenHist.get(best.id) ?? 0) + 1);
        }
      }
    }
  }

  return { assignments, gaps };
}
