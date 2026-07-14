import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { generateWeekAction, setPublishedAction } from "../../actions";
import { FairnessPanel } from "../../_components/fairness-panel";
import { SeatEditor } from "../../_components/seat-editor";
import { WeekNav } from "../../_components/week-nav";
import { currentTeam } from "@/lib/auth";
import {
  getShareToken,
  isWeekPublished,
  listAssignments,
  listConstraintsForWeek,
  listPeople,
} from "@/lib/db/queries";
import { computeViolations } from "@/lib/scheduler/violations";
import type { Assignment, SlotType } from "@/lib/shifts/types";
import { SLOT_CAPACITY, SLOT_LABELS, SLOT_TYPES } from "@/lib/shifts/types";
import { dayLabel, isIsoDate, sundayOf, weekDates } from "@/lib/shifts/week";

export const metadata = { title: "Week · Shifts" };

export default async function WeekPage({
  params,
}: {
  params: Promise<{ start: string }>;
}) {
  const { start } = await params;
  if (!isIsoDate(start)) notFound();
  const weekStart = sundayOf(start);
  // Canonicalize so each week has exactly one URL.
  if (start !== weekStart) redirect(`/shifts/week/${weekStart}`);
  const teamId = await currentTeam();
  const allPeople = await listPeople(teamId, true);
  const people = allPeople.filter((p) => p.active);
  const assignments = await listAssignments(teamId, weekStart);
  const constraints = await listConstraintsForWeek(teamId, weekStart);
  const violations = computeViolations(assignments, constraints, allPeople);
  const published = await isWeekPublished(teamId, weekStart);
  const token = await getShareToken(teamId);
  const dates = weekDates(weekStart);
  const violationKeys = new Set(violations.map((v) => `${v.date}:${v.slot}:${v.personId}`));

  const seatFor = (date: string, slot: SlotType): (Assignment | null)[] => {
    const filled = assignments.filter((a) => a.date === date && a.slot === slot);
    return Array.from({ length: Math.max(SLOT_CAPACITY[slot], filled.length) }, (_, i) =>
      filled[i] ?? null,
    );
  };

  const unfilled = dates.reduce(
    (n, date) =>
      n +
      SLOT_TYPES.reduce(
        (m, slot) => m + seatFor(date, slot).filter((s) => s === null).length,
        0,
      ),
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WeekNav weekStart={weekStart} hrefFor={(w) => `/shifts/week/${w}`} />
        <div className="flex items-center gap-2">
          <form action={generateWeekAction}>
            <input type="hidden" name="weekStart" value={weekStart} />
            <button
              type="submit"
              disabled={published}
              title={published ? "Unpublish the week before regenerating" : undefined}
              className="rounded bg-neutral-900 px-4 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            >
              {assignments.length > 0 ? "Regenerate" : "Generate"} schedule
            </button>
          </form>
          <form action={setPublishedAction}>
            <input type="hidden" name="weekStart" value={weekStart} />
            <input type="hidden" name="published" value={published ? "0" : "1"} />
            <button
              type="submit"
              className={`rounded border px-4 py-1.5 text-sm ${
                published
                  ? "border-green-500 text-green-600 dark:text-green-400"
                  : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              }`}
            >
              {published ? "Published ✓ (click to unpublish)" : "Publish"}
            </button>
          </form>
        </div>
      </div>

      {published && (
        <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
          Live for your team at{" "}
          <a href={`/s/${token}`} className="font-mono underline">
            /s/{token}
          </a>
        </p>
      )}

      {people.length === 0 && (
        <p className="rounded border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
          Add people on the{" "}
          <Link href="/shifts/people" className="underline">
            People page
          </Link>{" "}
          before generating a schedule.
        </p>
      )}

      {violations.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">Warnings (not blocking):</p>
          <ul className="ml-5 list-disc">
            {[...new Set(violations.map((v) => v.message))].map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {unfilled > 0 && assignments.length > 0 && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {unfilled} seat{unfilled === 1 ? "" : "s"} could not be filled — adjust
          availability or assign manually below.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
              <th className="py-2 pr-3 font-medium">Day</th>
              {SLOT_TYPES.map((slot) => (
                <th key={slot} className="px-2 py-2 font-medium">
                  {SLOT_LABELS[slot]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => (
              <tr key={date} className="border-b border-neutral-100 align-top dark:border-neutral-900">
                <td className="py-2 pr-3 font-medium whitespace-nowrap">{dayLabel(date)}</td>
                {SLOT_TYPES.map((slot) => (
                  <td key={slot} className="px-2 py-2">
                    <div className="flex flex-col gap-1">
                      {seatFor(date, slot).map((seat, i) => (
                        <SeatEditor
                          key={seat ? `p${seat.personId}` : `empty${i}`}
                          weekStart={weekStart}
                          date={date}
                          slot={slot}
                          current={seat}
                          people={people}
                          allPeople={allPeople}
                          hasViolation={
                            seat !== null &&
                            violationKeys.has(`${date}:${slot}:${seat.personId}`)
                          }
                        />
                      ))}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {people.length > 0 && (
        <FairnessPanel teamId={teamId} weekStart={weekStart} people={people} />
      )}
    </div>
  );
}
