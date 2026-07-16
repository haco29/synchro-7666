import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { getDb } from "./index";
import { assignments, constraints, people, weeks } from "./schema";
import * as schema from "./schema";
import type {
  Assignment,
  Constraint,
  Person,
  PersonHistory,
  ShiftType,
  SlotType,
} from "../shifts/types";
import { addDays, weekDates } from "../shifts/week";

type Db = LibSQLDatabase<typeof schema>;

function isUniqueViolation(e: unknown): boolean {
  // Drizzle wraps the driver error, so the real message/code is down the cause chain.
  for (let cur: unknown = e; cur != null; cur = (cur as { cause?: unknown }).cause) {
    if (cur instanceof Error && /UNIQUE constraint failed/i.test(cur.message)) return true;
    const code = (cur as { code?: string }).code;
    if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT") return true;
  }
  return false;
}

/** Ids of the team's own people — used to reject foreign people from writes. */
async function teamPersonIds(db: Db, teamId: number): Promise<Set<number>> {
  const rows = await db.select({ id: people.id }).from(people).where(eq(people.teamId, teamId));
  return new Set(rows.map((r) => r.id));
}

/** The surrogate id of a team's week, or undefined if the week doesn't exist yet. */
async function findWeekId(db: Db, teamId: number, weekStart: string): Promise<number | undefined> {
  const row = (
    await db
      .select({ id: weeks.id })
      .from(weeks)
      .where(and(eq(weeks.teamId, teamId), eq(weeks.weekStart, weekStart)))
      .limit(1)
  )[0];
  return row?.id;
}

/**
 * Resolves (team, weekStart) to the surrogate week id, creating the week row if
 * absent. `weeks` is keyed by a surrogate id with UNIQUE(team_id, week_start).
 */
async function ensureWeekId(db: Db, teamId: number, weekStart: string): Promise<number> {
  const existing = await findWeekId(db, teamId, weekStart);
  if (existing !== undefined) return existing;

  const [created] = await db
    .insert(weeks)
    .values({ teamId, weekStart })
    .onConflictDoNothing()
    .returning();
  if (created) return created.id;

  // Lost an insert race — the row now exists, so re-read it.
  return (await findWeekId(db, teamId, weekStart))!;
}

// ---- people ----

export async function listPeople(teamId: number, includeInactive = false): Promise<Person[]> {
  const where = includeInactive
    ? eq(people.teamId, teamId)
    : and(eq(people.teamId, teamId), eq(people.active, true));
  // The select already projects exactly the `Person` shape (active is a boolean column).
  return getDb()
    .select({
      id: people.id,
      name: people.name,
      active: people.active,
      rotation: people.rotation,
    })
    .from(people)
    .where(where)
    .orderBy(
      sql`CASE WHEN ${people.rotation} IS NULL THEN 999 ELSE ${people.rotation} END`,
      asc(people.name),
    );
}

export async function addPerson(teamId: number, name: string): Promise<void> {
  // Re-adding an existing name reactivates them rather than silently doing
  // nothing — that's what an admin "bringing someone back" expects.
  await getDb()
    .insert(people)
    .values({ teamId, name: name.trim(), active: true })
    .onConflictDoUpdate({ target: [people.teamId, people.name], set: { active: true } });
}

export async function renamePerson(teamId: number, id: number, name: string): Promise<void> {
  try {
    await getDb()
      .update(people)
      .set({ name: name.trim() })
      .where(and(eq(people.id, id), eq(people.teamId, teamId)));
  } catch (e) {
    // OR IGNORE: renaming onto an existing name in the team is a no-op.
    if (!isUniqueViolation(e)) throw e;
  }
}

export async function setPersonActive(
  teamId: number,
  id: number,
  active: boolean,
): Promise<void> {
  await getDb()
    .update(people)
    .set({ active })
    .where(and(eq(people.id, id), eq(people.teamId, teamId)));
}

/** Set (or clear, with null) a team's person's rotation group. Team-scoped. */
export async function setPersonRotation(
  teamId: number,
  id: number,
  rotation: number | null,
): Promise<void> {
  await getDb()
    .update(people)
    .set({ rotation })
    .where(and(eq(people.id, id), eq(people.teamId, teamId)));
}

/** A person plus their Clerk link — for the admin roster/linking UI only. */
export type PersonWithLink = Person & { clerkUserId: string | null };

/** Full roster (incl. inactive) with each person's Clerk link, for admins. */
export async function listPeopleWithUserLinks(teamId: number): Promise<PersonWithLink[]> {
  return getDb()
    .select({
      id: people.id,
      name: people.name,
      active: people.active,
      rotation: people.rotation,
      clerkUserId: people.clerkUserId,
    })
    .from(people)
    .where(eq(people.teamId, teamId))
    .orderBy(
      sql`CASE WHEN ${people.rotation} IS NULL THEN 999 ELSE ${people.rotation} END`,
      asc(people.name),
    );
}

/**
 * Link a team's person to a Clerk user (admin-set). Team-scoped: a person from
 * another team is a no-op. Relinking within the team moves the link
 * (last-write-wins) — we clear the id from any prior holder *in this team* first.
 *
 * `clerk_user_id` is globally unique, so if the id is already linked in *another*
 * team the set hits the unique index; we treat that as a refusal (no-op) rather
 * than clearing a cross-tenant link — never trust a client-supplied id.
 */
export async function linkPersonToUser(
  teamId: number,
  personId: number,
  clerkUserId: string,
): Promise<void> {
  const db = getDb();
  const target = (
    await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, personId), eq(people.teamId, teamId)))
      .limit(1)
  )[0];
  if (!target) return;

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(people)
        .set({ clerkUserId: null })
        .where(and(eq(people.clerkUserId, clerkUserId), eq(people.teamId, teamId)));
      await tx.update(people).set({ clerkUserId }).where(eq(people.id, personId));
    });
  } catch (e) {
    // Id is already linked to a person in another team — refuse, don't steal it.
    if (!isUniqueViolation(e)) throw e;
  }
}

/** Clear a team's person's Clerk link. Team-scoped; foreign person is a no-op. */
export async function unlinkPerson(teamId: number, personId: number): Promise<void> {
  await getDb()
    .update(people)
    .set({ clerkUserId: null })
    .where(and(eq(people.id, personId), eq(people.teamId, teamId)));
}

/** Whether a team's person is active. False for an unknown/foreign person. */
export async function isPersonActive(teamId: number, personId: number): Promise<boolean> {
  const row = (
    await getDb()
      .select({ active: people.active })
      .from(people)
      .where(and(eq(people.id, personId), eq(people.teamId, teamId)))
      .limit(1)
  )[0];
  return row?.active ?? false;
}

/**
 * The team's person linked to a Clerk user, or undefined if none. Team-scoped:
 * a link resolves only within its own team. This is how a member's own person is
 * derived server-side (see lib/auth.ts) — never from client input.
 */
export async function personForUser(
  teamId: number,
  clerkUserId: string,
): Promise<number | undefined> {
  const row = (
    await getDb()
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.teamId, teamId), eq(people.clerkUserId, clerkUserId)))
      .limit(1)
  )[0];
  return row?.id;
}

// ---- constraints (unavailable dates) ----

export async function listConstraintsForWeek(
  teamId: number,
  weekStart: string,
): Promise<Constraint[]> {
  // Exclusive upper bound at the next week's start: both a plain date and a
  // `YYYY-MM-DD:<shift>` value for any day in [weekStart, weekStart+6] sort
  // below it, so last-day per-shift rows aren't dropped (an inclusive weekEnd
  // bound would, since "…-18:night" > "…-18").
  const nextWeekStart = addDays(weekStart, 7);
  const rows = await getDb()
    .select({
      id: constraints.id,
      personId: constraints.personId,
      kind: constraints.kind,
      value: constraints.value,
    })
    .from(constraints)
    .innerJoin(people, eq(constraints.personId, people.id))
    .where(
      and(
        eq(people.teamId, teamId),
        inArray(constraints.kind, ["unavailable_date", "unavailable_shift"]),
        gte(constraints.value, weekStart),
        lt(constraints.value, nextWeekStart),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    personId: r.personId,
    kind: r.kind as Constraint["kind"],
    value: r.value,
  }));
}

/** Tenancy guard for constraint writers: true only if `personId` is on `teamId`. */
async function personOnTeam(db: Db, teamId: number, personId: number): Promise<boolean> {
  const row = (
    await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, personId), eq(people.teamId, teamId)))
      .limit(1)
  )[0];
  return row !== undefined;
}

export async function setUnavailable(
  teamId: number,
  personId: number,
  date: string,
  unavailable: boolean,
): Promise<void> {
  const db = getDb();
  if (!(await personOnTeam(db, teamId, personId))) return;

  if (unavailable) {
    await db
      .insert(constraints)
      .values({ personId, kind: "unavailable_date", value: date })
      .onConflictDoNothing();
  } else {
    await db
      .delete(constraints)
      .where(
        and(
          eq(constraints.personId, personId),
          eq(constraints.kind, "unavailable_date"),
          eq(constraints.value, date),
        ),
      );
  }
}

/**
 * Toggle a person's unavailability for a single time-shift on one date. Unlike
 * `setUnavailable` (whole day), this blocks only the given shift — the person
 * stays eligible for the other shifts, kitchen, and backup. Value is stored as
 * `YYYY-MM-DD:<shift>`.
 */
export async function setUnavailableShift(
  teamId: number,
  personId: number,
  date: string,
  shift: ShiftType,
  unavailable: boolean,
): Promise<void> {
  const db = getDb();
  if (!(await personOnTeam(db, teamId, personId))) return;

  const value = `${date}:${shift}`;
  if (unavailable) {
    await db
      .insert(constraints)
      .values({ personId, kind: "unavailable_shift", value })
      .onConflictDoNothing();
  } else {
    await db
      .delete(constraints)
      .where(
        and(
          eq(constraints.personId, personId),
          eq(constraints.kind, "unavailable_shift"),
          eq(constraints.value, value),
        ),
      );
  }
}

/**
 * Block or clear a person's whole week in one call: writes (or removes)
 * `unavailable_date` for all 7 days of the week — the "vacation week" action.
 * Clearing only removes whole-day rows, so any per-shift blocks in the week
 * survive.
 */
export async function setWeekUnavailable(
  teamId: number,
  personId: number,
  weekStart: string,
  blocked: boolean,
): Promise<void> {
  const db = getDb();
  if (!(await personOnTeam(db, teamId, personId))) return;

  const dates = weekDates(weekStart);
  if (blocked) {
    await db
      .insert(constraints)
      .values(dates.map((value) => ({ personId, kind: "unavailable_date" as const, value })))
      .onConflictDoNothing();
  } else {
    await db
      .delete(constraints)
      .where(
        and(
          eq(constraints.personId, personId),
          eq(constraints.kind, "unavailable_date"),
          inArray(constraints.value, dates),
        ),
      );
  }
}

// ---- weeks ----

export async function ensureWeek(teamId: number, weekStart: string): Promise<void> {
  await ensureWeekId(getDb(), teamId, weekStart);
}

export async function isWeekPublished(teamId: number, weekStart: string): Promise<boolean> {
  const row = (
    await getDb()
      .select({ published: weeks.published })
      .from(weeks)
      .where(and(eq(weeks.teamId, teamId), eq(weeks.weekStart, weekStart)))
      .limit(1)
  )[0];
  return row?.published ?? false;
}

export async function setWeekPublished(
  teamId: number,
  weekStart: string,
  published: boolean,
): Promise<void> {
  const db = getDb();
  await ensureWeekId(db, teamId, weekStart);
  await db
    .update(weeks)
    .set({ published })
    .where(and(eq(weeks.teamId, teamId), eq(weeks.weekStart, weekStart)));
}

export async function listPublishedWeeks(teamId: number): Promise<string[]> {
  const rows = await getDb()
    .select({ weekStart: weeks.weekStart })
    .from(weeks)
    .where(and(eq(weeks.teamId, teamId), eq(weeks.published, true)))
    .orderBy(desc(weeks.weekStart));
  return rows.map((r) => r.weekStart);
}

// ---- assignments ----

export async function listAssignments(teamId: number, weekStart: string): Promise<Assignment[]> {
  const db = getDb();
  const weekId = await findWeekId(db, teamId, weekStart);
  if (weekId === undefined) return [];
  const rows = await db
    .select({ date: assignments.date, slot: assignments.slot, personId: assignments.personId })
    .from(assignments)
    .where(eq(assignments.weekId, weekId));
  return rows.map((r) => ({ date: r.date, slot: r.slot as SlotType, personId: r.personId }));
}

export async function replaceWeekAssignments(
  teamId: number,
  weekStart: string,
  list: Assignment[],
): Promise<void> {
  const db = getDb();
  // Tenancy guard: only seat the team's own people, never a foreign person_id.
  const memberIds = await teamPersonIds(db, teamId);
  const valid = list.filter((a) => memberIds.has(a.personId));
  const weekId = await ensureWeekId(db, teamId, weekStart);
  await db.transaction(async (tx) => {
    await tx.delete(assignments).where(eq(assignments.weekId, weekId));
    if (valid.length > 0) {
      await tx
        .insert(assignments)
        .values(valid.map((a) => ({ weekId, date: a.date, slot: a.slot, personId: a.personId })));
    }
  });
}

/**
 * Replace one seat of a slot with a different person, atomically. If the new
 * person already holds a seat in the same slot, the whole swap is a no-op —
 * otherwise removing the previous person first would silently shrink the slot.
 */
export async function swapSeat(
  teamId: number,
  weekStart: string,
  date: string,
  slot: SlotType,
  previousPersonId: number | null,
  newPersonId: number,
): Promise<void> {
  const db = getDb();
  // Tenancy guard: the incoming person must belong to this team.
  if (!(await teamPersonIds(db, teamId)).has(newPersonId)) return;
  const weekId = await ensureWeekId(db, teamId, weekStart);
  await db.transaction(async (tx) => {
    const alreadySeated = (
      await tx
        .select({ id: assignments.id })
        .from(assignments)
        .where(
          and(
            eq(assignments.weekId, weekId),
            eq(assignments.date, date),
            eq(assignments.slot, slot),
            eq(assignments.personId, newPersonId),
          ),
        )
        .limit(1)
    )[0];
    if (alreadySeated) return;

    let proceed = true;
    if (previousPersonId !== null) {
      const del = await tx
        .delete(assignments)
        .where(
          and(
            eq(assignments.weekId, weekId),
            eq(assignments.date, date),
            eq(assignments.slot, slot),
            eq(assignments.personId, previousPersonId),
          ),
        );
      // Stale previousPersonId — the seat changed elsewhere. Abort rather than
      // insert, which would push the slot over capacity.
      if (del.rowsAffected === 0) proceed = false;
    }
    if (proceed) {
      await tx.insert(assignments).values({ weekId, date, slot, personId: newPersonId });
    }
  });
}

export async function removeAssignment(
  teamId: number,
  weekStart: string,
  a: Assignment,
): Promise<void> {
  const db = getDb();
  const weekId = await findWeekId(db, teamId, weekStart);
  if (weekId === undefined) return;
  await db
    .delete(assignments)
    .where(
      and(
        eq(assignments.weekId, weekId),
        eq(assignments.date, a.date),
        eq(assignments.slot, a.slot),
        eq(assignments.personId, a.personId),
      ),
    );
}

// ---- history (cross-week fairness) ----

/** Cumulative counts per person from all of the team's weeks before `weekStart`. */
export async function historyBefore(
  teamId: number,
  weekStart: string,
): Promise<PersonHistory[]> {
  const rows = await getDb()
    .select({
      personId: assignments.personId,
      nights: sql<number>`SUM(CASE WHEN ${assignments.slot} = 'night' THEN 1 ELSE 0 END)`,
      kitchens: sql<number>`SUM(CASE WHEN ${assignments.slot} = 'kitchen' THEN 1 ELSE 0 END)`,
      backups: sql<number>`SUM(CASE WHEN ${assignments.slot} = 'backup' THEN 1 ELSE 0 END)`,
      total: sql<number>`COUNT(*)`,
    })
    .from(assignments)
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .where(and(eq(weeks.teamId, teamId), lt(weeks.weekStart, weekStart)))
    .groupBy(assignments.personId);
  return rows.map((r) => ({
    personId: r.personId,
    nightCount: Number(r.nights),
    kitchenCount: Number(r.kitchens),
    backupCount: Number(r.backups),
    totalCount: Number(r.total),
  }));
}
