import { listAssignments } from "@/lib/db/queries";
import type { Person, SlotType } from "@/lib/shifts/types";

/** Per-person load for the viewed week: total plus nights/kitchen/backup counts. */
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
              <th className="px-3 py-1.5 text-center font-medium">Kitchen (week)</th>
              <th className="px-3 py-1.5 text-center font-medium">Backup (week)</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1.5 pr-4 font-medium">{p.name}</td>
                <td className="px-3 py-1.5 text-center">{weekCount(p.id)}</td>
                <td className="px-3 py-1.5 text-center">{weekCount(p.id, "kitchen")}</td>
                <td className="px-3 py-1.5 text-center">{weekCount(p.id, "backup")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
