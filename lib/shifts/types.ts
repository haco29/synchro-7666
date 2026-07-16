export type ShiftType = "morning" | "evening" | "night";
export type SlotType = ShiftType | "kitchen" | "backup";

export const SHIFT_TYPES: ShiftType[] = ["morning", "evening", "night"];
export const SLOT_TYPES: SlotType[] = ["morning", "evening", "night", "kitchen", "backup"];

export const SLOT_LABELS: Record<SlotType, string> = {
  morning: "Morning 07:00–15:00",
  evening: "Evening 15:00–23:00",
  night: "Night 23:00–07:00",
  kitchen: "Kitchen duty",
  backup: "Backup (rest / on-call)",
};

/** People needed per slot type per day — one per role. */
export const SLOT_CAPACITY: Record<SlotType, number> = {
  morning: 1,
  evening: 1,
  night: 1,
  kitchen: 1,
  backup: 1,
};

export interface Person {
  id: number;
  name: string;
  active: boolean;
  /** Rotation group: 1 or 2, or null/undefined for "no rotation". Ordering/labelling only. */
  rotation?: number | null;
}

/**
 * Availability constraints. The DB stores kind as free TEXT, so new kinds are
 * additive — extend this union and wire them through the engine + violations.
 * - `unavailable_date`: value is an ISO date; the person is off the WHOLE day
 *   (ineligible for every slot, incl. kitchen and backup).
 * - `unavailable_shift`: value is `YYYY-MM-DD:<shift>`; the person is off that
 *   one time-shift (morning/evening/night) — still eligible for the OTHER
 *   time-shifts, but NOT for kitchen or backup, which require full-day
 *   availability, so any per-shift block that day rules them out.
 */
export type ConstraintKind = "unavailable_date" | "unavailable_shift";

export interface Constraint {
  id: number;
  personId: number;
  kind: ConstraintKind;
  /** ISO date (`unavailable_date`) or `YYYY-MM-DD:<shift>` (`unavailable_shift`). */
  value: string;
}

/** One filled slot position: on `date`, `personId` covers `slot`. */
export interface Assignment {
  date: string; // YYYY-MM-DD
  slot: SlotType;
  personId: number;
}

/** An unfillable slot position the engine could not staff. */
export interface Gap {
  date: string;
  slot: SlotType;
}

/** Cumulative per-person history used for cross-week fairness. */
export interface PersonHistory {
  personId: number;
  nightCount: number;
  kitchenCount: number;
  /** Times this person has been the backup (rest) — balanced so rest rotates evenly. */
  backupCount: number;
  totalCount: number;
}

export interface GenerateInput {
  weekStart: string; // Sunday, YYYY-MM-DD
  people: Person[];
  constraints: Constraint[];
  history: PersonHistory[];
  seed?: number;
}

export interface GenerateResult {
  assignments: Assignment[];
  gaps: Gap[];
}

export type ViolationKind = "double_booked" | "unavailable";

export interface Violation {
  kind: ViolationKind;
  date: string;
  slot: SlotType;
  personId: number;
  message: string;
}
