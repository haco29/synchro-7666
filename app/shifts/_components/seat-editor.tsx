import { assignSlotAction, clearSlotAction } from "../actions";
import type { Assignment, Person, SlotType } from "@/lib/shifts/types";
import { SLOT_LABELS } from "@/lib/shifts/types";
import { dayLabel } from "@/lib/shifts/week";

/** One editable seat of a slot: person picker + save, and clear when filled. */
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
  return (
    <div
      className={`flex items-center gap-1 rounded px-1 py-0.5 ${
        hasViolation ? "bg-amber-100 dark:bg-amber-950" : ""
      }`}
    >
      <form action={assignSlotAction} className="flex items-center gap-1">
        <input type="hidden" name="weekStart" value={weekStart} />
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="slot" value={slot} />
        {current && (
          <input type="hidden" name="previousPersonId" value={current.personId} />
        )}
        <select
          name="personId"
          defaultValue={current?.personId ?? ""}
          aria-label={`${SLOT_LABELS[slot]} on ${dayLabel(date)}`}
          className={`w-28 rounded border bg-transparent px-1 py-0.5 text-xs dark:bg-neutral-900 ${
            current
              ? "border-neutral-200 dark:border-neutral-800"
              : "border-dashed border-red-400 text-red-500 dark:border-red-700"
          }`}
        >
          <option value="" disabled>
            — unfilled —
          </option>
          {inactiveHolder && (
            <option value={inactiveHolder.id}>{inactiveHolder.name} (inactive)</option>
          )}
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          title="Save"
          className="rounded border border-neutral-200 px-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800"
        >
          ✓
        </button>
      </form>
      {current && (
        <form action={clearSlotAction}>
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="slot" value={slot} />
          <input type="hidden" name="personId" value={current.personId} />
          <button
            type="submit"
            title="Clear seat"
            aria-label="Clear seat"
            className="rounded px-1 text-xs text-neutral-400 hover:text-red-500"
          >
            ✕
          </button>
        </form>
      )}
    </div>
  );
}
