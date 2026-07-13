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
 * Fill order within each day. Night first (scarcest fairness budget), then
 * kitchen, so the most contested slots pick from the widest candidate pool.
 */
const FILL_ORDER: SlotType[] = ["night", "kitchen", "morning", "evening"];

/** Scoring weights: lower score wins the slot. */
const W_WEEK_TOTAL = 1;
const W_NIGHT_BALANCE = 3;
const W_KITCHEN_BALANCE = 2;
const W_MORNING_AFTER_NIGHT = 0.75;
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
 * person per day, unavailable people are never eligible. Unfillable positions
 * are returned as gaps, never silently dropped.
 */
export function generateWeek(input: GenerateInput): GenerateResult {
  const rng = makeRng(input.seed ?? 1);
  const dates = weekDates(input.weekStart);

  const unavailable = new Set(
    input.constraints
      .filter((c) => c.kind === "unavailable_date")
      .map((c) => `${c.value}:${c.personId}`),
  );

  const nightHist = new Map<number, number>();
  const kitchenHist = new Map<number, number>();
  for (const h of input.history) {
    nightHist.set(h.personId, h.nightCount);
    kitchenHist.set(h.personId, h.kitchenCount);
  }

  const weekTotal = new Map<number, number>();
  const busyOn = new Map<string, Set<number>>(); // date -> personIds assigned
  const nightOn = new Map<string, Set<number>>(); // date -> personIds on night

  const assignments: Assignment[] = [];
  const gaps: Gap[] = [];

  for (const date of dates) {
    for (const slot of FILL_ORDER) {
      for (let seat = 0; seat < SLOT_CAPACITY[slot]; seat++) {
        const candidates = input.people.filter(
          (p) =>
            p.active &&
            !unavailable.has(`${date}:${p.id}`) &&
            !busyOn.get(date)?.has(p.id),
        );
        if (candidates.length === 0) {
          gaps.push({ date, slot });
          continue;
        }

        let best = candidates[0];
        let bestScore = Infinity;
        for (const p of candidates) {
          let score = (weekTotal.get(p.id) ?? 0) * W_WEEK_TOTAL;
          if (slot === "night") {
            score += (nightHist.get(p.id) ?? 0) * W_NIGHT_BALANCE;
          }
          if (slot === "kitchen") {
            score += (kitchenHist.get(p.id) ?? 0) * W_KITCHEN_BALANCE;
          }
          if (slot === "morning" && nightOn.get(addDays(date, -1))?.has(p.id)) {
            score += W_MORNING_AFTER_NIGHT;
          }
          score += rng() * W_TIEBREAK;
          if (score < bestScore) {
            bestScore = score;
            best = p;
          }
        }

        assignments.push({ date, slot, personId: best.id });
        weekTotal.set(best.id, (weekTotal.get(best.id) ?? 0) + 1);
        if (!busyOn.has(date)) busyOn.set(date, new Set());
        busyOn.get(date)!.add(best.id);
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
