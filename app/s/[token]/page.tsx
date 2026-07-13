import { timingSafeEqual } from "node:crypto";
import { notFound } from "next/navigation";
import {
  getShareToken,
  listAssignments,
  listPeople,
  listPublishedWeeks,
} from "@/lib/db/queries";
import type { SlotType } from "@/lib/shifts/types";
import { SLOT_LABELS, SLOT_TYPES } from "@/lib/shifts/types";
import { dayLabel, weekDates } from "@/lib/shifts/week";

export const metadata = { title: "Schedule · Synchro" };

// The share page must always reflect the latest published data.
export const dynamic = "force-dynamic";

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ me?: string }>;
}) {
  const { token } = await params;
  const expected = Buffer.from(getShareToken());
  const given = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    notFound();
  }
  const { me } = await searchParams;
  const meId = Number(me) || null;

  // Most recent published weeks only, so the page doesn't grow forever.
  const weeks = listPublishedWeeks().slice(0, 6);
  const people = listPeople(true);
  const nameOf = (id: number) => people.find((p) => p.id === id)?.name ?? `#${id}`;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">Shift schedule</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Read-only view. Click your name to highlight your shifts.
      </p>

      {weeks.length === 0 && (
        <p className="rounded border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No schedule has been published yet.
        </p>
      )}

      {weeks.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2 text-sm">
          {people
            .filter((p) => p.active)
            .map((p) => (
              <a
                key={p.id}
                href={meId === p.id ? `/s/${token}` : `/s/${token}?me=${p.id}`}
                className={`rounded-full border px-3 py-1 ${
                  meId === p.id
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                    : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                }`}
              >
                {p.name}
              </a>
            ))}
        </div>
      )}

      <div className="space-y-10">
        {weeks.map((weekStart) => {
          const assignments = listAssignments(weekStart);
          const forSeat = (date: string, slot: SlotType) =>
            assignments.filter((a) => a.date === date && a.slot === slot);
          return (
            <section key={weekStart}>
              <h2 className="mb-3 text-lg font-medium">
                Week of {dayLabel(weekStart)}
              </h2>
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
                    {weekDates(weekStart).map((date) => (
                      <tr
                        key={date}
                        className="border-b border-neutral-100 align-top dark:border-neutral-900"
                      >
                        <td className="py-2 pr-3 font-medium whitespace-nowrap">
                          {dayLabel(date)}
                        </td>
                        {SLOT_TYPES.map((slot) => {
                          const seats = forSeat(date, slot);
                          return (
                            <td key={slot} className="px-2 py-2">
                              <div className="flex flex-col gap-1">
                                {seats.map((a) => (
                                  <span
                                    key={a.personId}
                                    className={`rounded px-1.5 py-0.5 ${
                                      meId === a.personId
                                        ? "bg-blue-100 font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                                        : ""
                                    }`}
                                  >
                                    {nameOf(a.personId)}
                                  </span>
                                ))}
                                {seats.length === 0 && (
                                  <span className="text-neutral-400">—</span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
