import { historyBefore, listAssignments } from "@/lib/db/queries";
import type { Person, SlotType } from "@/lib/shifts/types";
import { addDays } from "@/lib/shifts/week";

/** Per-person load: this week's counts plus all-time nights/kitchens. */
export function FairnessPanel({
  weekStart,
  people,
}: {
  weekStart: string;
  people: Person[];
}) {
  const week = listAssignments(weekStart);
  const allTime = new Map(
    historyBefore(addDays(weekStart, 7)).map((h) => [h.personId, h]),
  );
  const weekCount = (id: number, slot?: SlotType) =>
    week.filter((a) => a.personId === id && (slot ? a.slot === slot : true)).length;

  return (
    <section>
      <h2 className="mb-2 text-lg font-medium">Fairness</h2>
      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
              <th className="py-1.5 pr-4 font-medium">Person</th>
              <th className="px-3 py-1.5 text-center font-medium">This week</th>
              <th className="px-3 py-1.5 text-center font-medium">Nights (week)</th>
              <th className="px-3 py-1.5 text-center font-medium">Nights (all-time)</th>
              <th className="px-3 py-1.5 text-center font-medium">Kitchen (all-time)</th>
              <th className="px-3 py-1.5 text-center font-medium">Total (all-time)</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1.5 pr-4 font-medium">{p.name}</td>
                <td className="px-3 py-1.5 text-center">{weekCount(p.id)}</td>
                <td className="px-3 py-1.5 text-center">{weekCount(p.id, "night")}</td>
                <td className="px-3 py-1.5 text-center">
                  {allTime.get(p.id)?.nightCount ?? 0}
                </td>
                <td className="px-3 py-1.5 text-center">
                  {allTime.get(p.id)?.kitchenCount ?? 0}
                </td>
                <td className="px-3 py-1.5 text-center">
                  {allTime.get(p.id)?.totalCount ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
