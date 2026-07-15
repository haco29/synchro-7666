"use client";

import { assignSlotAction, clearSlotAction } from "../actions";
import type { Assignment, Person, SlotType } from "@/lib/shifts/types";
import { SLOT_LABELS } from "@/lib/shifts/types";
import { dayLabel } from "@/lib/shifts/week";

/**
 * One editable seat of a slot: a person picker that saves the moment it changes
 * — no explicit submit. Picking a person assigns (or swaps) the seat; picking
 * "— unfilled —" on a filled seat clears it. The page keys each seat by its
 * holder, so a successful save remounts this control with the fresh value.
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

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.currentTarget.value;
    if (value === "") {
      // "— unfilled —" chosen on a filled seat → clear it.
      if (!current) return;
      const data = new FormData();
      data.set("date", date);
      data.set("slot", slot);
      data.set("personId", String(current.personId));
      void clearSlotAction(data);
      return;
    }
    // A person chosen → assign (or swap out whoever held the seat).
    const data = new FormData();
    data.set("weekStart", weekStart);
    data.set("date", date);
    data.set("slot", slot);
    if (current) data.set("previousPersonId", String(current.personId));
    data.set("personId", value);
    void assignSlotAction(data);
  }

  return (
    <div
      className={`flex items-center gap-1 rounded px-1 py-0.5 ${
        hasViolation ? "bg-amber-100 dark:bg-amber-950" : ""
      }`}
    >
      <select
        name="personId"
        defaultValue={current?.personId ?? ""}
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
