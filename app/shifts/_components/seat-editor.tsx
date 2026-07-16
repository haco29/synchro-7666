"use client";

import { startTransition, useOptimistic } from "react";
import { assignSlotAction, clearSlotAction } from "../actions";
import type { Assignment, Person, SlotType } from "@/lib/shifts/types";
import { SLOT_LABELS } from "@/lib/shifts/types";
import { dayLabel } from "@/lib/shifts/week";

/**
 * One editable seat of a slot: a person picker that saves the moment it changes
 * — no explicit submit. Picking a person assigns (or swaps) the seat; picking
 * "— unfilled —" on a filled seat clears it. The picker is optimistic via
 * `useOptimistic` derived from the server-persisted value: a successful save
 * revalidates and the new value sticks, while a failed save (or any other
 * server-side change to this seat) reverts to the true state automatically.
 */
export function SeatEditor({
  weekStart,
  date,
  slot,
  current,
  people,
  allPeople,
  hasViolation,
}: {
  weekStart: string;
  date: string;
  slot: SlotType;
  current: Assignment | null;
  people: Person[];
  allPeople: Person[];
  hasViolation: boolean;
}) {
  // A seat can be held by someone deactivated after scheduling; keep them
  // visible instead of letting the select fall back to "unfilled".
  const inactiveHolder =
    current && !people.some((p) => p.id === current.personId)
      ? allPeople.find((p) => p.id === current.personId)
      : undefined;

  const persistedValue = current ? String(current.personId) : "";
  const [value, setOptimisticValue] = useOptimistic(
    persistedValue,
    (_current, next: string) => next,
  );

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.currentTarget.value;
    startTransition(async () => {
      setOptimisticValue(next);
      const data = new FormData();
      data.set("date", date);
      data.set("slot", slot);
      try {
        if (next === "") {
          // "— unfilled —" chosen on a filled seat → clear it.
          if (!current) return;
          data.set("personId", String(current.personId));
          await clearSlotAction(data);
          return;
        }
        // A person chosen → assign (or swap out whoever held the seat).
        data.set("weekStart", weekStart);
        if (current) data.set("previousPersonId", String(current.personId));
        data.set("personId", next);
        await assignSlotAction(data);
      } catch (error) {
        // The optimistic pick reverts automatically when the transition ends;
        // surface the failure rather than swallowing it.
        console.error("Failed to save seat assignment", error);
      }
    });
  }

  return (
    <div
      className={`flex items-center gap-1 rounded px-1 py-0.5 ${
        hasViolation ? "bg-amber-100 dark:bg-amber-950" : ""
      }`}
    >
      <select
        name="personId"
        value={value}
        onChange={onChange}
        aria-label={`${SLOT_LABELS[slot]} on ${dayLabel(date)}`}
        className={`w-28 rounded border bg-transparent px-1 py-0.5 text-xs dark:bg-neutral-900 ${
          current
            ? "border-neutral-200 dark:border-neutral-800"
            : "border-dashed border-red-400 text-red-500 dark:border-red-700"
        }`}
      >
        <option value="">— unfilled —</option>
        {inactiveHolder && (
          <option value={inactiveHolder.id}>{inactiveHolder.name} (inactive)</option>
        )}
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
