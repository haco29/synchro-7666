import {
  addPersonAction,
  blockMyWeekAction,
  blockWeekAction,
  linkPersonAction,
  setPersonActiveAction,
  toggleKitchenBlockAction,
  toggleMyShiftUnavailabilityAction,
  toggleMyUnavailabilityAction,
  toggleShiftUnavailableAction,
  toggleUnavailableAction,
  unlinkPersonAction,
} from "../actions";
import { Fragment } from "react";
import { WeekNav } from "../_components/week-nav";
import { RotationSelect } from "../_components/rotation-select";
import { currentPersonId, currentTeam, isAdmin } from "@/lib/auth";
import { listOrgMembers, type OrgMember } from "@/lib/clerk/members";
import {
  listConstraintsForWeek,
  listPeopleWithUserLinks,
  type PersonWithLink,
} from "@/lib/db/queries";
import { groupByRotation } from "@/lib/shifts/rotation";
import type { ShiftType } from "@/lib/shifts/types";
import { SHIFT_TYPES, SLOT_LABELS } from "@/lib/shifts/types";
import { dayLabel, isIsoDate, todayIso, weekDates, weekStartOf } from "@/lib/shifts/week";

/** Compact per-shift labels for the availability grid. */
const SHIFT_LETTER: Record<ShiftType, string> = {
  morning: "M",
  evening: "E",
  night: "N",
};

export const metadata = { title: "People · Shifts" };

const OFF_CLASSES =
  "border-red-300 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300";
const FREE_CLASSES =
  "border-neutral-200 bg-neutral-50 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800";

/**
 * Availability controls for one (person, date): a whole-day off toggle plus a
 * per-time-shift toggle for morning/evening/night. Kitchen and backup have no
 * separate control — they need a full day free, so any block (whole-day OR a
 * single shift) that day makes the person ineligible for them. The two actions
 * are injected so the same cell serves an admin editing anyone and a member
 * editing only themselves. A whole-day off subsumes the shifts, so the shift
 * buttons are disabled (and dimmed) while it's set.
 *
 * `kitchenAction` is optional and admin-only: when provided, an extra "K"
 * toggle blocks the person from KITCHEN duty that day while leaving their
 * time-shifts open. Members never receive it, so the control is hidden for them.
 */
function AvailabilityCell({
  dayAction,
  shiftAction,
  kitchenAction,
  personId,
  personName,
  date,
  dayOff,
  shiftOffOf,
  kitchenBlocked = false,
  active,
}: {
  dayAction: (formData: FormData) => Promise<void>;
  shiftAction: (formData: FormData) => Promise<void>;
  kitchenAction?: (formData: FormData) => Promise<void>;
  personId: number;
  personName: string;
  date: string;
  dayOff: boolean;
  shiftOffOf: (shift: ShiftType) => boolean;
  kitchenBlocked?: boolean;
  active: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <form action={dayAction}>
        <input type="hidden" name="personId" value={personId} />
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="unavailable" value={dayOff ? "0" : "1"} />
        <button
          type="submit"
          disabled={!active}
          aria-pressed={dayOff}
          aria-label={`${personName} ${dayOff ? "off all day" : "available all day"} on ${dayLabel(date)}`}
          title={dayOff ? "Off all day — click to clear" : "Click to mark off all day"}
          className={`h-6 w-16 rounded border text-[10px] disabled:opacity-40 ${dayOff ? OFF_CLASSES : FREE_CLASSES}`}
        >
          {dayOff ? "Day off" : "Day"}
        </button>
      </form>
      <div className="flex gap-0.5">
        {SHIFT_TYPES.map((shift) => {
          const off = shiftOffOf(shift);
          return (
            <form key={shift} action={shiftAction}>
              <input type="hidden" name="personId" value={personId} />
              <input type="hidden" name="date" value={date} />
              <input type="hidden" name="shift" value={shift} />
              <input type="hidden" name="unavailable" value={off ? "0" : "1"} />
              <button
                type="submit"
                disabled={!active || dayOff}
                aria-pressed={off}
                aria-label={`${personName} ${off ? "unavailable" : "available"} for ${SLOT_LABELS[shift]} on ${dayLabel(date)}`}
                title={`${SLOT_LABELS[shift]} — ${off ? "unavailable, click to clear" : "click to mark unavailable"}`}
                className={`h-6 w-6 rounded border text-[10px] disabled:opacity-40 ${off ? OFF_CLASSES : FREE_CLASSES}`}
              >
                {SHIFT_LETTER[shift]}
              </button>
            </form>
          );
        })}
        {kitchenAction && (
          <form action={kitchenAction}>
            <input type="hidden" name="personId" value={personId} />
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="blocked" value={kitchenBlocked ? "0" : "1"} />
            <button
              type="submit"
              disabled={!active || dayOff}
              aria-pressed={kitchenBlocked}
              aria-label={`${personName} ${kitchenBlocked ? "blocked from" : "available for"} ${SLOT_LABELS.kitchen} on ${dayLabel(date)}`}
              title={`${SLOT_LABELS.kitchen} — ${kitchenBlocked ? "blocked, click to clear" : "click to block"}`}
              className={`h-6 w-6 rounded border text-[10px] disabled:opacity-40 ${kitchenBlocked ? OFF_CLASSES : FREE_CLASSES}`}
            >
              K
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** One-click "off for the whole week" / "clear the week" for one person. */
function BlockWeekButton({
  action,
  personId,
  personName,
  weekStart,
  fullyOff,
  active,
}: {
  action: (formData: FormData) => Promise<void>;
  personId: number;
  personName: string;
  weekStart: string;
  fullyOff: boolean;
  active: boolean;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="weekStart" value={weekStart} />
      <input type="hidden" name="blocked" value={fullyOff ? "0" : "1"} />
      <button
        type="submit"
        disabled={!active}
        aria-label={
          fullyOff
            ? `Clear the whole-week block for ${personName}`
            : `Mark ${personName} off for the whole week`
        }
        title={fullyOff ? "Clear the whole-week block" : "Mark off for the whole week"}
        className={`rounded border px-2 py-1 text-xs whitespace-nowrap disabled:opacity-40 ${
          fullyOff
            ? "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
            : "border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        }`}
      >
        {fullyOff ? "Clear week" : "Block week"}
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
    week && isIsoDate(week) ? weekStartOf(week) : weekStartOf(todayIso());
  const teamId = await currentTeam();
  const admin = await isAdmin();
  const constraints = await listConstraintsForWeek(teamId, weekStart);
  // Whole-day off keyed `${date}:${personId}`; per-shift off keyed
  // `${date}:${shift}:${personId}` (the shift value is already `date:shift`).
  const dayOff = new Set<string>();
  const shiftOff = new Set<string>();
  // Per-day kitchen block, keyed `${date}:${personId}` (value is the date).
  const kitchenBlocked = new Set<string>();
  for (const c of constraints) {
    if (c.kind === "unavailable_date") dayOff.add(`${c.value}:${c.personId}`);
    else if (c.kind === "unavailable_shift") shiftOff.add(`${c.value}:${c.personId}`);
    else if (c.kind === "blocked_kitchen") kitchenBlocked.add(`${c.value}:${c.personId}`);
  }
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
        dayOff={dayOff}
        shiftOff={shiftOff}
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
      dayOff={dayOff}
      shiftOff={shiftOff}
      kitchenBlocked={kitchenBlocked}
    />
  );
}

/** A member's own availability — a single row, or a notice if unlinked. */
function MemberView({
  weekStart,
  dates,
  me,
  dayOff,
  shiftOff,
}: {
  weekStart: string;
  dates: string[];
  me: PersonWithLink | null;
  dayOff: Set<string>;
  shiftOff: Set<string>;
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
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-neutral-500">
              Mark when you are <strong>unavailable</strong> this week — a whole day, or a single
              shift (<strong>M</strong>orning / <strong>E</strong>vening / <strong>N</strong>ight).
            </p>
            <BlockWeekButton
              action={blockMyWeekAction}
              personId={me.id}
              personName={me.name}
              weekStart={weekStart}
              fullyOff={dates.every((date) => dayOff.has(`${date}:${me.id}`))}
              active={me.active}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            {dates.map((date) => (
              <div key={date} className="flex flex-col items-center gap-1">
                <span className="text-xs text-neutral-500">{dayLabel(date)}</span>
                <AvailabilityCell
                  dayAction={toggleMyUnavailabilityAction}
                  shiftAction={toggleMyShiftUnavailabilityAction}
                  personId={me.id}
                  personName={me.name}
                  date={date}
                  dayOff={dayOff.has(`${date}:${me.id}`)}
                  shiftOffOf={(shift) => shiftOff.has(`${date}:${shift}:${me.id}`)}
                  active={me.active}
                />
              </div>
            ))}
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
  dayOff,
  shiftOff,
  kitchenBlocked,
}: {
  weekStart: string;
  dates: string[];
  people: PersonWithLink[];
  members: OrgMember[];
  dayOff: Set<string>;
  shiftOff: Set<string>;
  kitchenBlocked: Set<string>;
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
          Mark when each person is <strong>unavailable</strong> this week — a whole day, or a
          single shift (<strong>M</strong>orning / <strong>E</strong>vening / <strong>N</strong>ight).
          Kitchen and backup need a full day free — any block, whole-day or a single shift, rules them out that day.
          The <strong>K</strong> toggle blocks only <strong>kitchen</strong> duty that day, leaving the person free for their normal shifts.
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
                  <th className="px-2 py-2 font-medium">Rotation</th>
                  {dates.map((d) => (
                    <th key={d} className="px-2 py-2 text-center font-medium">
                      {dayLabel(d)}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center font-medium">Whole week</th>
                  <th className="py-2 pl-4 font-medium">Status</th>
                  <th className="py-2 pl-4 font-medium">Linked account</th>
                </tr>
              </thead>
              <tbody>
                {groupByRotation(people).map((group) => (
                  <Fragment key={group.label}>
                    <tr className="bg-neutral-100 dark:bg-neutral-900">
                      <td
                        colSpan={dates.length + 5}
                        className="px-2 py-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase"
                      >
                        {group.label}
                      </td>
                    </tr>
                    {group.people.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-neutral-100 dark:border-neutral-900 ${p.active ? "" : "opacity-50"}`}
                  >
                    <td className="py-2 pr-4 font-medium">{p.name}</td>
                    <td className="px-2 py-2">
                      <RotationSelect personId={p.id} personName={p.name} rotation={p.rotation} />
                    </td>
                    {dates.map((date) => (
                      <td key={date} className="px-2 py-2 text-center">
                        <AvailabilityCell
                          dayAction={toggleUnavailableAction}
                          shiftAction={toggleShiftUnavailableAction}
                          kitchenAction={toggleKitchenBlockAction}
                          personId={p.id}
                          personName={p.name}
                          date={date}
                          dayOff={dayOff.has(`${date}:${p.id}`)}
                          shiftOffOf={(shift) => shiftOff.has(`${date}:${shift}:${p.id}`)}
                          kitchenBlocked={kitchenBlocked.has(`${date}:${p.id}`)}
                          active={p.active}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center">
                      <BlockWeekButton
                        action={blockWeekAction}
                        personId={p.id}
                        personName={p.name}
                        weekStart={weekStart}
                        fullyOff={dates.every((date) => dayOff.has(`${date}:${p.id}`))}
                        active={p.active}
                      />
                    </td>
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
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
