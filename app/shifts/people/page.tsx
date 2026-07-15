import {
  addPersonAction,
  linkPersonAction,
  setPersonActiveAction,
  toggleMyUnavailabilityAction,
  toggleUnavailableAction,
  unlinkPersonAction,
} from "../actions";
import { WeekNav } from "../_components/week-nav";
import { currentPersonId, currentTeam, isAdmin } from "@/lib/auth";
import { listOrgMembers, type OrgMember } from "@/lib/clerk/members";
import {
  listConstraintsForWeek,
  listPeopleWithUserLinks,
  type PersonWithLink,
} from "@/lib/db/queries";
import { addDays, dayLabel, isIsoDate, todayIso, weekDates, weekStartOf } from "@/lib/shifts/week";

export const metadata = { title: "People · Shifts" };

/**
 * One availability toggle for (person, date). The `action` is injected so the
 * same control serves an admin editing anyone (`toggleUnavailableAction`) and a
 * member editing only themselves (`toggleMyUnavailabilityAction`).
 */
function UnavailabilityToggle({
  action,
  personId,
  personName,
  date,
  isOff,
  active,
}: {
  action: (formData: FormData) => Promise<void>;
  personId: number;
  personName: string;
  date: string;
  isOff: boolean;
  active: boolean;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="unavailable" value={isOff ? "0" : "1"} />
      <button
        type="submit"
        disabled={!active}
        aria-pressed={isOff}
        aria-label={`${personName} ${isOff ? "unavailable" : "available"} on ${dayLabel(date)}`}
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
  );
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const weekStart =
    week && isIsoDate(week) ? weekStartOf(week) : addDays(weekStartOf(todayIso()), 7);
  const teamId = await currentTeam();
  const admin = await isAdmin();
  const constraints = await listConstraintsForWeek(teamId, weekStart);
  const unavailable = new Set(constraints.map((c) => `${c.value}:${c.personId}`));
  const dates = weekDates(weekStart);

  // Members manage only their own availability; unlinked members are read-only.
  if (!admin) {
    const myId = await currentPersonId();
    const roster = myId === null ? [] : await listPeopleWithUserLinks(teamId);
    const me = roster.find((p) => p.id === myId) ?? null;
    return (
      <MemberView
        weekStart={weekStart}
        dates={dates}
        me={me}
        unavailable={unavailable}
      />
    );
  }

  const people = await listPeopleWithUserLinks(teamId);
  const members = await listOrgMembers();
  return (
    <AdminView
      weekStart={weekStart}
      dates={dates}
      people={people}
      members={members}
      unavailable={unavailable}
    />
  );
}

/** A member's own availability — a single row, or a notice if unlinked. */
function MemberView({
  weekStart,
  dates,
  me,
  unavailable,
}: {
  weekStart: string;
  dates: string[];
  me: PersonWithLink | null;
  unavailable: Set<string>;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">My availability</h2>
        <WeekNav weekStart={weekStart} hrefFor={(w) => `/shifts/people?week=${w}`} />
      </div>

      {me === null ? (
        <p className="rounded border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
          Your account isn&apos;t linked to a person yet. Ask a team admin to link you before you
          can set your availability.
        </p>
      ) : (
        <>
          <p className="text-sm text-neutral-500">
            Mark the days you are <strong>unavailable</strong> this week.
          </p>
          <div className="flex flex-wrap gap-2">
            {dates.map((date) => {
              const isOff = unavailable.has(`${date}:${me.id}`);
              return (
                <div key={date} className="flex flex-col items-center gap-1">
                  <span className="text-xs text-neutral-500">{dayLabel(date)}</span>
                  <UnavailabilityToggle
                    action={toggleMyUnavailabilityAction}
                    personId={me.id}
                    personName={me.name}
                    date={date}
                    isOff={isOff}
                    active={me.active}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/** The full admin roster: add people, edit anyone's availability, manage links. */
function AdminView({
  weekStart,
  dates,
  people,
  members,
  unavailable,
}: {
  weekStart: string;
  dates: string[];
  people: PersonWithLink[];
  members: OrgMember[];
  unavailable: Set<string>;
}) {
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
                  <th className="py-2 pl-4 font-medium">Linked account</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-neutral-100 dark:border-neutral-900 ${p.active ? "" : "opacity-50"}`}
                  >
                    <td className="py-2 pr-4 font-medium">{p.name}</td>
                    {dates.map((date) => (
                      <td key={date} className="px-2 py-2 text-center">
                        <UnavailabilityToggle
                          action={toggleUnavailableAction}
                          personId={p.id}
                          personName={p.name}
                          date={date}
                          isOff={unavailable.has(`${date}:${p.id}`)}
                          active={p.active}
                        />
                      </td>
                    ))}
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
                    <td className="py-2 pl-4">
                      <div className="flex items-center gap-2">
                        <form action={linkPersonAction} className="flex items-center gap-1">
                          <input type="hidden" name="personId" value={p.id} />
                          <select
                            name="clerkUserId"
                            defaultValue={p.clerkUserId ?? ""}
                            aria-label={`Link ${p.name} to a member`}
                            className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                          >
                            <option value="" disabled>
                              — pick member —
                            </option>
                            {/* A prior link to someone no longer in the org still shows. */}
                            {p.clerkUserId &&
                              !members.some((m) => m.userId === p.clerkUserId) && (
                                <option value={p.clerkUserId}>{p.clerkUserId} (not in org)</option>
                              )}
                            {members.map((m) => (
                              <option key={m.userId} value={m.userId}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                          >
                            Link
                          </button>
                        </form>
                        {p.clerkUserId && (
                          <form action={unlinkPersonAction}>
                            <input type="hidden" name="personId" value={p.id} />
                            <button
                              type="submit"
                              className="text-xs text-neutral-500 underline-offset-4 hover:underline"
                            >
                              Unlink
                            </button>
                          </form>
                        )}
                      </div>
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
