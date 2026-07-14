import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { getDb } from "./index";
import { assignments, constraints, people, teams, weeks } from "./schema";
import * as schema from "./schema";
import type { Assignment, Constraint, Person, PersonHistory, SlotType } from "../shifts/types";
import { addDays } from "../shifts/week";

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

/**
 * Resolves (team, weekStart) to the surrogate week id, creating the week row if
 * absent. `weeks` is keyed by a surrogate id with UNIQUE(team_id, week_start).
 */
async function ensureWeekId(db: Db, teamId: number, weekStart: string): Promise<number> {
  const existing = (
    await db
      .select({ id: weeks.id })
      .from(weeks)
      .where(and(eq(weeks.teamId, teamId), eq(weeks.weekStart, weekStart)))
      .limit(1)
  )[0];
  if (existing) return existing.id;

  const [created] = await db
    .insert(weeks)
    .values({ teamId, weekStart })
    .onConflictDoNothing()
    .returning();
  if (created) return created.id;

  // Lost an insert race — re-read.
  return (
    await db
      .select({ id: weeks.id })
      .from(weeks)
      .where(and(eq(weeks.teamId, teamId), eq(weeks.weekStart, weekStart)))
      .limit(1)
  )[0].id;
}

// ---- people ----

export async function listPeople(teamId: number, includeInactive = false): Promise<Person[]> {
  const where = includeInactive
    ? eq(people.teamId, teamId)
    : and(eq(people.teamId, teamId), eq(people.active, true));
  const rows = await getDb()
    .select({ id: people.id, name: people.name, active: people.active })
    .from(people)
    .where(where)
    .orderBy(asc(people.name));
  return rows.map((r) => ({ id: r.id, name: r.name, active: r.active }));
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

// ---- constraints (unavailable dates) ----

export async function listConstraintsForWeek(
  teamId: number,
  weekStart: string,
): Promise<Constraint[]> {
  const weekEnd = addDays(weekStart, 6);
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
        eq(constraints.kind, "unavailable_date"),
        gte(constraints.value, weekStart),
        lte(constraints.value, weekEnd),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    personId: r.personId,
    kind: r.kind as Constraint["kind"],
    value: r.value,
  }));
}

export async function setUnavailable(
  teamId: number,
  personId: number,
  date: string,
  unavailable: boolean,
): Promise<void> {
  const db = getDb();
  // Tenancy guard: only touch constraints for a person on this team.
  const person = (
    await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, personId), eq(people.teamId, teamId)))
      .limit(1)
  )[0];
  if (!person) return;

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
  const week = (
    await db
      .select({ id: weeks.id })
      .from(weeks)
      .where(and(eq(weeks.teamId, teamId), eq(weeks.weekStart, weekStart)))
      .limit(1)
  )[0];
  if (!week) return [];
  const rows = await db
    .select({ date: assignments.date, slot: assignments.slot, personId: assignments.personId })
    .from(assignments)
    .where(eq(assignments.weekId, week.id));
  return rows.map((r) => ({ date: r.date, slot: r.slot as SlotType, personId: r.personId }));
}

export async function replaceWeekAssignments(
  teamId: number,
  weekStart: string,
  list: Assignment[],
): Promise<void> {
  const db = getDb();
  const weekId = await ensureWeekId(db, teamId, weekStart);
  await db.transaction(async (tx) => {
    await tx.delete(assignments).where(eq(assignments.weekId, weekId));
    if (list.length > 0) {
      await tx
        .insert(assignments)
        .values(list.map((a) => ({ weekId, date: a.date, slot: a.slot, personId: a.personId })));
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
  const week = (
    await db
      .select({ id: weeks.id })
      .from(weeks)
      .where(and(eq(weeks.teamId, teamId), eq(weeks.weekStart, weekStart)))
      .limit(1)
  )[0];
  if (!week) return;
  await db
    .delete(assignments)
    .where(
      and(
        eq(assignments.weekId, week.id),
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
    totalCount: Number(r.total),
  }));
}

// ---- settings ----

/** The team's share token (per-team public link; superseded by auth). */
export async function getShareToken(teamId: number): Promise<string> {
  const row = (
    await getDb()
      .select({ shareToken: teams.shareToken })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)
  )[0];
  return row.shareToken;
}

/** Resolve a team by its public share token — for the unauthenticated /s/[token] route. */
export async function getTeamIdByShareToken(token: string): Promise<number | null> {
  if (!token) return null;
  const row = (
    await getDb().select({ id: teams.id }).from(teams).where(eq(teams.shareToken, token)).limit(1)
  )[0];
  return row?.id ?? null;
}
