import { Fragment } from "react";
import { listAssignments } from "@/lib/db/queries";
import { groupByRotation } from "@/lib/shifts/rotation";
import type { Person, SlotType } from "@/lib/shifts/types";
import { SHIFT_TYPES } from "@/lib/shifts/types";

/**
 * Per-person load for the viewed week: number of shifts worked
 * (morning/evening/night) plus the kitchen and backup counts.
 */
export async function FairnessPanel({
  teamId,
  weekStart,
  people,
}: {
  teamId: number;
  weekStart: string;
  people: Person[];
}) {
  const week = await listAssignments(teamId, weekStart);
  const weekCount = (id: number, slot?: SlotType) =>
    week.filter((a) => a.personId === id && (slot ? a.slot === slot : true))
      .length;
  // "Shifts week": only the time-shifts (morning/evening/night) count as a
  // shift worked — kitchen and backup (rest/on-call) are broken out separately.
  const shiftTypes = new Set<SlotType>(SHIFT_TYPES);
  const shiftCount = (id: number) =>
    week.filter((a) => a.personId === id && shiftTypes.has(a.slot)).length;

  return (
    <section>
      <h2 className="mb-2 text-lg font-medium">Fairness</h2>
      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
              <th className="py-1.5 pr-4 font-medium">Person</th>
              <th className="px-3 py-1.5 text-center font-medium">
                Shifts (week)
              </th>
              <th className="px-3 py-1.5 text-center font-medium">
                Kitchen (week)
              </th>
              <th className="px-3 py-1.5 text-center font-medium">
                Backup (week)
              </th>
            </tr>
          </thead>
          <tbody>
            {groupByRotation(people).map((group) => (
              <Fragment key={group.label}>
                <tr className="bg-neutral-100 dark:bg-neutral-900">
                  <td
                    colSpan={4}
                    className="px-3 py-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase"
                  >
                    {group.label}
                  </td>
                </tr>
                {group.people.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-neutral-100 dark:border-neutral-900"
                  >
                    <td className="py-1.5 pr-4 font-medium">{p.name}</td>
                    <td className="px-3 py-1.5 text-center">
                      {shiftCount(p.id)}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {weekCount(p.id, "kitchen")}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {weekCount(p.id, "backup")}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
