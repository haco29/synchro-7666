// Drizzle schema — the single source of truth for the database.
//
// Multi-tenant: every domain row is scoped to a `team_id`. A Clerk Organization
// maps to one `teams` row via `clerk_org_id` (see lib/auth.ts, Task 5). The
// query layer (lib/db/queries.ts, Task 6) always filters by team_id.
import { integer, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // Maps this team to its Clerk Organization. Nullable until linked (Task 5/8).
  clerkOrgId: text("clerk_org_id").unique(),
  // Retained from the original single-tenant design; superseded by auth but
  // kept as an optional public read-only link (spec Open Question #1).
  shareToken: text("share_token").notNull().unique(),
});

export const people = sqliteTable(
  "people",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [uniqueIndex("people_team_name_unq").on(t.teamId, t.name)],
);

export const constraints = sqliteTable(
  "constraints",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("unavailable_date"),
    value: text("value").notNull(),
  },
  (t) => [uniqueIndex("constraints_person_kind_value_unq").on(t.personId, t.kind, t.value)],
);

export const weeks = sqliteTable(
  "weeks",
  {
    // Surrogate PK so the same week_start can exist across teams.
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    weekStart: text("week_start").notNull(),
    published: integer("published", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("weeks_team_start_unq").on(t.teamId, t.weekStart)],
);

export const assignments = sqliteTable(
  "assignments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    weekId: integer("week_id")
      .notNull()
      .references(() => weeks.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    slot: text("slot").notNull(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id),
  },
  (t) => [
    uniqueIndex("assignments_week_date_slot_person_unq").on(
      t.weekId,
      t.date,
      t.slot,
      t.personId,
    ),
    index("idx_assignments_week").on(t.weekId),
  ],
);

// Generic key/value store for global (non-team) config only.
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
