import { getDb } from "./client";
import type {
  Assignment,
  Constraint,
  ConstraintKind,
  Person,
  PersonHistory,
  SlotType,
} from "../shifts/types";
import { addDays } from "../shifts/week";

// ---- people ----

export function listPeople(includeInactive = false): Person[] {
  const rows = getDb()
    .prepare(
      includeInactive
        ? "SELECT id, name, active FROM people ORDER BY name"
        : "SELECT id, name, active FROM people WHERE active = 1 ORDER BY name",
    )
    .all() as { id: number; name: string; active: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, active: r.active === 1 }));
}

export function addPerson(name: string): void {
  // Re-adding an existing name reactivates them rather than silently doing
  // nothing — that's what an admin "bringing someone back" expects.
  getDb()
    .prepare(
      "INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET active = 1",
    )
    .run(name.trim());
}

export function renamePerson(id: number, name: string): void {
  getDb()
    .prepare("UPDATE OR IGNORE people SET name = ? WHERE id = ?")
    .run(name.trim(), id);
}

export function setPersonActive(id: number, active: boolean): void {
  getDb().prepare("UPDATE people SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
}

// ---- constraints (unavailable dates) ----

export function listConstraintsForWeek(weekStart: string): Constraint[] {
  const weekEnd = addDays(weekStart, 6);
  const rows = getDb()
    .prepare(
      `SELECT id, person_id, kind, value FROM constraints
       WHERE kind = 'unavailable_date' AND value BETWEEN ? AND ?`,
    )
    .all(weekStart, weekEnd) as {
    id: number;
    person_id: number;
    kind: ConstraintKind;
    value: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    kind: r.kind,
    value: r.value,
  }));
}

export function setUnavailable(personId: number, date: string, unavailable: boolean): void {
  const db = getDb();
  if (unavailable) {
    db.prepare(
      `INSERT OR IGNORE INTO constraints (person_id, kind, value)
       VALUES (?, 'unavailable_date', ?)`,
    ).run(personId, date);
  } else {
    db.prepare(
      `DELETE FROM constraints
       WHERE person_id = ? AND kind = 'unavailable_date' AND value = ?`,
    ).run(personId, date);
  }
}

// ---- weeks ----

export function ensureWeek(weekStart: string): void {
  getDb().prepare("INSERT OR IGNORE INTO weeks (week_start) VALUES (?)").run(weekStart);
}

export function isWeekPublished(weekStart: string): boolean {
  const row = getDb()
    .prepare("SELECT published FROM weeks WHERE week_start = ?")
    .get(weekStart) as { published: number } | undefined;
  return row?.published === 1;
}

export function setWeekPublished(weekStart: string, published: boolean): void {
  ensureWeek(weekStart);
  getDb()
    .prepare("UPDATE weeks SET published = ? WHERE week_start = ?")
    .run(published ? 1 : 0, weekStart);
}

export function listPublishedWeeks(): string[] {
  const rows = getDb()
    .prepare("SELECT week_start FROM weeks WHERE published = 1 ORDER BY week_start DESC")
    .all() as { week_start: string }[];
  return rows.map((r) => r.week_start);
}

// ---- assignments ----

export function listAssignments(weekStart: string): Assignment[] {
  const rows = getDb()
    .prepare("SELECT date, slot, person_id FROM assignments WHERE week_start = ?")
    .all(weekStart) as { date: string; slot: SlotType; person_id: number }[];
  return rows.map((r) => ({ date: r.date, slot: r.slot, personId: r.person_id }));
}

export function replaceWeekAssignments(weekStart: string, assignments: Assignment[]): void {
  const db = getDb();
  ensureWeek(weekStart);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM assignments WHERE week_start = ?").run(weekStart);
    const insert = db.prepare(
      "INSERT INTO assignments (week_start, date, slot, person_id) VALUES (?, ?, ?, ?)",
    );
    for (const a of assignments) {
      insert.run(weekStart, a.date, a.slot, a.personId);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Replace one seat of a slot with a different person, atomically. If the new
 * person already holds a seat in the same slot, the whole swap is a no-op —
 * otherwise removing the previous person first would silently shrink the slot.
 */
export function swapSeat(
  weekStart: string,
  date: string,
  slot: SlotType,
  previousPersonId: number | null,
  newPersonId: number,
): void {
  const db = getDb();
  ensureWeek(weekStart);
  db.exec("BEGIN");
  try {
    const alreadySeated = db
      .prepare("SELECT 1 FROM assignments WHERE date = ? AND slot = ? AND person_id = ?")
      .get(date, slot, newPersonId);
    if (!alreadySeated) {
      let proceed = true;
      if (previousPersonId !== null) {
        const { changes } = db
          .prepare("DELETE FROM assignments WHERE date = ? AND slot = ? AND person_id = ?")
          .run(date, slot, previousPersonId);
        // Stale previousPersonId — the seat was already changed elsewhere.
        // Abort rather than insert, which would push the slot over capacity.
        if (Number(changes) === 0) proceed = false;
      }
      if (proceed) {
        db.prepare(
          "INSERT INTO assignments (week_start, date, slot, person_id) VALUES (?, ?, ?, ?)",
        ).run(weekStart, date, slot, newPersonId);
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function removeAssignment(a: Assignment): void {
  getDb()
    .prepare("DELETE FROM assignments WHERE date = ? AND slot = ? AND person_id = ?")
    .run(a.date, a.slot, a.personId);
}

// ---- history (cross-week fairness) ----

/** Cumulative counts per person from all weeks before `weekStart`. */
export function historyBefore(weekStart: string): PersonHistory[] {
  const rows = getDb()
    .prepare(
      `SELECT person_id,
              SUM(CASE WHEN slot = 'night' THEN 1 ELSE 0 END) AS nights,
              SUM(CASE WHEN slot = 'kitchen' THEN 1 ELSE 0 END) AS kitchens,
              COUNT(*) AS total
       FROM assignments WHERE week_start < ?
       GROUP BY person_id`,
    )
    .all(weekStart) as {
    person_id: number;
    nights: number;
    kitchens: number;
    total: number;
  }[];
  return rows.map((r) => ({
    personId: r.person_id,
    nightCount: r.nights,
    kitchenCount: r.kitchens,
    totalCount: r.total,
  }));
}

// ---- settings ----

export function getShareToken(): string {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = 'share_token'")
    .get() as { value: string };
  return row.value;
}
