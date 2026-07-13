export type ShiftType = "morning" | "evening" | "night";
export type SlotType = ShiftType | "kitchen";

export const SHIFT_TYPES: ShiftType[] = ["morning", "evening", "night"];
export const SLOT_TYPES: SlotType[] = ["morning", "evening", "night", "kitchen"];

export const SLOT_LABELS: Record<SlotType, string> = {
  morning: "Morning 07:00–15:00",
  evening: "Evening 15:00–23:00",
  night: "Night 23:00–07:00",
  kitchen: "Kitchen duty",
};

/** People needed per slot type per day. */
export const SLOT_CAPACITY: Record<SlotType, number> = {
  morning: 2,
  evening: 2,
  night: 2,
  kitchen: 1,
};

export interface Person {
  id: number;
  name: string;
  active: boolean;
}

/**
 * Only unavailable dates exist in v1. The DB stores kind as free TEXT, so new
 * kinds (blocked shift types, max-per-week, …) are additive — extend this
 * union and wire them through the engine + violations when they land.
 */
export type ConstraintKind = "unavailable_date";

export interface Constraint {
  id: number;
  personId: number;
  kind: ConstraintKind;
  /** ISO date the person cannot work. */
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
