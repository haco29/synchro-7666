import type {
  Assignment,
  Gap,
  GenerateInput,
  GenerateResult,
  SlotType,
} from "../shifts/types";
import { SLOT_CAPACITY } from "../shifts/types";
import { addDays, weekDates } from "../shifts/week";

/**
 * Fill order within each day. Work roles come first — night (scarcest fairness
 * budget) and kitchen ahead of morning/evening — so real shifts always take
 * priority over the rest day. Backup is filled LAST from whoever remains,
 * scored by rest history so the rest perk still rotates fairly; when a day is
 * short-staffed it is backup that gaps, never a work shift.
 */
const FILL_ORDER: SlotType[] = ["night", "kitchen", "morning", "evening", "backup"];

/** Scoring weights: lower score wins the slot. */
const W_WEEK_TOTAL = 1;
const W_NIGHT_BALANCE = 3;
const W_KITCHEN_BALANCE = 2;
const W_BACKUP_BALANCE = 3;
const W_TIEBREAK = 0.01;

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
 * to sleep). Unfillable positions are returned as gaps, never silently dropped.
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
  // Seed with the prior week's last night so the after-night rules (no kitchen,
  // no morning) hold across the week boundary, not just within the week.
  if (input.priorNightPersonIds?.length) {
    nightOn.set(addDays(input.weekStart, -1), new Set(input.priorNightPersonIds));
  }

  const assignments: Assignment[] = [];
  const gaps: Gap[] = [];

  for (const date of dates) {
    for (const slot of FILL_ORDER) {
      // Kitchen and backup demand a full day free: any per-shift block that
      // day disqualifies them. Time-shifts are blocked only by a matching
      // per-shift block for that specific shift. Both kitchen and morning
      // additionally exclude whoever worked the previous night — night ends
      // 07:00, so kitchen duty would leave no time to sleep and a morning
      // (starting 07:00) would be a ~16-hour back-to-back stretch. (FILL_ORDER
      // puts night before both, so the previous day's night is always known.)
      const isTimeShift = slot !== "kitchen" && slot !== "backup";
      const sleptOff =
        slot === "kitchen" || slot === "morning"
          ? nightOn.get(addDays(date, -1))
          : undefined;
      for (let seat = 0; seat < SLOT_CAPACITY[slot]; seat++) {
        const candidates = input.people.filter(
          (p) =>
            p.active &&
            !wholeDayOff.has(`${date}:${p.id}`) &&
            (isTimeShift
              ? !shiftOff.has(`${date}:${slot}:${p.id}`)
              : !anyShiftOff.has(`${date}:${p.id}`)) &&
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
          // Backup is a rest day: it never adds to the work-load total, so being
          // on backup doesn't make a person "look busy". It balances on its own
          // rest history instead, so the rest perk rotates evenly.
          let score = isBackup
            ? (backupHist.get(p.id) ?? 0) * W_BACKUP_BALANCE
            : (weekTotal.get(p.id) ?? 0) * W_WEEK_TOTAL;
          if (slot === "night") {
            score += (nightHist.get(p.id) ?? 0) * W_NIGHT_BALANCE;
          }
          if (slot === "kitchen") {
            score += (kitchenHist.get(p.id) ?? 0) * W_KITCHEN_BALANCE;
          }
          score += rng() * W_TIEBREAK;
          if (score < bestScore) {
            bestScore = score;
            best = p;
          }
        }

        assignments.push({ date, slot, personId: best.id });
        if (!busyOn.has(date)) busyOn.set(date, new Set());
        busyOn.get(date)!.add(best.id);
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
