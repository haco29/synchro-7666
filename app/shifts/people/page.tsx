import {
  addPersonAction,
  setPersonActiveAction,
  toggleUnavailableAction,
} from "../actions";
import { WeekNav } from "../_components/week-nav";
import { currentTeam } from "@/lib/auth";
import { listConstraintsForWeek, listPeople } from "@/lib/db/queries";
import { addDays, dayLabel, isIsoDate, sundayOf, todayIso, weekDates } from "@/lib/shifts/week";

export const metadata = { title: "People · Shifts" };

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const weekStart =
    week && isIsoDate(week) ? sundayOf(week) : addDays(sundayOf(todayIso()), 7);
  const teamId = await currentTeam();
  const people = await listPeople(teamId, true);
  const constraints = await listConstraintsForWeek(teamId, weekStart);
  const unavailable = new Set(constraints.map((c) => `${c.value}:${c.personId}`));
  const dates = weekDates(weekStart);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-medium">Add a person</h2>
        <form action={addPersonAction} className="flex gap-2">
          <input
            name="name"
            required
            placeholder="Name"
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="submit"
            className="rounded bg-neutral-900 px-4 py-1.5 text-sm text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            Add
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Availability</h2>
          <WeekNav weekStart={weekStart} hrefFor={(w) => `/shifts/people?week=${w}`} />
        </div>
        <p className="text-sm text-neutral-500">
          Check the days each person is <strong>unavailable</strong> during this week.
        </p>

        {people.length === 0 ? (
          <p className="rounded border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
            No people yet — add your roster above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
                  <th className="py-2 pr-4 font-medium">Person</th>
                  {dates.map((d) => (
                    <th key={d} className="px-2 py-2 text-center font-medium">
                      {dayLabel(d)}
                    </th>
                  ))}
                  <th className="py-2 pl-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-neutral-100 dark:border-neutral-900 ${p.active ? "" : "opacity-50"}`}
                  >
                    <td className="py-2 pr-4 font-medium">{p.name}</td>
                    {dates.map((date) => {
                      const isOff = unavailable.has(`${date}:${p.id}`);
                      return (
                        <td key={date} className="px-2 py-2 text-center">
                          <form action={toggleUnavailableAction}>
                            <input type="hidden" name="personId" value={p.id} />
                            <input type="hidden" name="date" value={date} />
                            <input
                              type="hidden"
                              name="unavailable"
                              value={isOff ? "0" : "1"}
                            />
                            <button
                              type="submit"
                              disabled={!p.active}
                              aria-pressed={isOff}
                              aria-label={`${p.name} ${isOff ? "unavailable" : "available"} on ${dayLabel(date)}`}
                              title={isOff ? "Unavailable — click to clear" : "Available — click to mark unavailable"}
                              className={`h-7 w-7 rounded border text-xs ${
                                isOff
                                  ? "border-red-300 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
                                  : "border-neutral-200 bg-neutral-50 text-neutral-400 hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                              }`}
                            >
                              {isOff ? "✕" : ""}
                            </button>
                          </form>
                        </td>
                      );
                    })}
                    <td className="py-2 pl-4">
                      <form action={setPersonActiveAction}>
                        <input type="hidden" name="personId" value={p.id} />
                        <input type="hidden" name="active" value={p.active ? "0" : "1"} />
                        <button
                          type="submit"
                          className="text-xs text-neutral-500 underline-offset-4 hover:underline"
                        >
                          {p.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
