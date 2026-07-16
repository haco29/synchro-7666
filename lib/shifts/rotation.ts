// Rotation groups are an ordering/labelling concept on people, not a scheduling
// input: 1 and 2 are the two rotations; null = "no rotation" (e.g. קצין). This is
// the single source of truth for the labels and the grouping order, shared by the
// admin rotation picker, the availability table, and the fairness table.

export type Rotation = 1 | 2 | null;

/** The pickable rotations, in display order — no-rotation last. */
export const ROTATION_OPTIONS: Rotation[] = [1, 2, null];

/** Normalize any stored value to a valid rotation (1, 2, or null). */
export function toRotation(value: number | null | undefined): Rotation {
  return value === 1 || value === 2 ? value : null;
}

export function rotationLabel(value: number | null | undefined): string {
  const r = toRotation(value);
  return r === null ? "No rotation" : `Rotation ${r}`;
}

/**
 * Split people into rotation groups in display order (1, then 2, then no-rotation),
 * dropping empty groups. Order *within* each group is preserved from the input, so
 * callers should pass people already sorted by name (as the DB queries do).
 */
export function groupByRotation<T extends { rotation?: number | null }>(
  people: T[],
): { rotation: Rotation; label: string; people: T[] }[] {
  return ROTATION_OPTIONS.map((rotation) => ({
    rotation,
    label: rotationLabel(rotation),
    people: people.filter((p) => toRotation(p.rotation) === rotation),
  })).filter((g) => g.people.length > 0);
}
