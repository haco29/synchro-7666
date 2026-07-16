"use client";

import { startTransition, useOptimistic } from "react";
import { setPersonRotationAction } from "../actions";
import { ROTATION_OPTIONS, rotationLabel, toRotation } from "@/lib/shifts/rotation";

/**
 * Admin picker for a person's rotation group. Saves the moment it changes — no
 * explicit submit — mirroring {@link SeatEditor}. Optimistic via `useOptimistic`
 * derived from the persisted value, so a failed save reverts automatically.
 */
export function RotationSelect({
  personId,
  personName,
  rotation,
}: {
  personId: number;
  personName: string;
  rotation?: number | null;
}) {
  const persistedValue = toRotation(rotation) === null ? "" : String(toRotation(rotation));
  const [value, setOptimisticValue] = useOptimistic(
    persistedValue,
    (_current, next: string) => next,
  );

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.currentTarget.value;
    startTransition(async () => {
      setOptimisticValue(next);
      const data = new FormData();
      data.set("personId", String(personId));
      data.set("rotation", next);
      try {
        await setPersonRotationAction(data);
      } catch (error) {
        console.error("Failed to save rotation", error);
      }
    });
  }

  return (
    <select
      value={value}
      onChange={onChange}
      aria-label={`Rotation for ${personName}`}
      className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
    >
      {ROTATION_OPTIONS.map((r) => (
        <option key={r ?? "none"} value={r ?? ""}>
          {rotationLabel(r)}
        </option>
      ))}
    </select>
  );
}
