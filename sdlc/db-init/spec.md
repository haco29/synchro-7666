# Spec: Database & Auth Infrastructure — `synchro-7666`

- **Branch:** `db-init`
- **Date:** 2026-07-13
- **Status:** Approved — build in progress (revised after discovering existing code)
- **Author:** harel.coman@verbit.ai

---

## 1. Objective

Stand up **production database infrastructure and the authentication mechanism** for
`synchro-7666`, a weekly staff/volunteer scheduling (rota) app deployed on **Vercel**. This spec
covers **DB selection, the persistence layer, and auth/tenancy**, including the plumbing in
existing routes needed to enforce tenancy. It does **not** change the scheduling algorithm or the
UI design.

### Why this is needed now
> **Correction (post-exploration):** an earlier read of the repo wrongly concluded the app was
> boilerplate with an orphaned DB. It is **not**. The "shifts scheduling" feature is fully built,
> committed, and tested (see *Existing code being migrated* below). This spec has been revised to
> describe a **migration/rewrite of that working code**, not a greenfield build.

The app already persists data via a **synchronous `node:sqlite` layer** (`lib/db/client.ts` +
`lib/db/queries.ts`) reading `data/synchro.db`. Critically, **a local SQLite file cannot run on
Vercel** — serverless functions have an ephemeral, read-only filesystem, so the `.db` file is
wiped between invocations and writes never persist. The original author documented exactly this in
`client.ts` and recommended pointing the data layer at "a networked DB (e.g. Turso/libSQL or
Postgres)." This initiative does that **and** (per the user's decision) adds Clerk auth +
multi-tenancy, rewriting the single-tenant persistence layer to Drizzle + Turso.

### Existing code being migrated
- **`lib/db/client.ts`** — `node:sqlite` (`DatabaseSync`), inline `CREATE TABLE IF NOT EXISTS`
  schema, auto-seeded `share_token`. → replaced by a libSQL client + Drizzle (Tasks 2, 5).
- **`lib/db/queries.ts`** — 17 **synchronous** functions (`listPeople`, `addPerson`,
  `replaceWeekAssignments`, `swapSeat`, `getShareToken`, …). → rewritten to Drizzle, **async**,
  and **team-scoped** (Task 6). The async conversion forces all callers to `await`.
- **5 route/consumer files** import the DB layer: `app/shifts/actions.ts`,
  `app/shifts/week/[start]/page.tsx`, `app/shifts/people/page.tsx`,
  `app/shifts/_components/fairness-panel.tsx`, `app/s/[token]/page.tsx`. → updated for async +
  `currentTeam()` scoping + auth (Tasks 6, 7).
- **Pure, DB-agnostic logic stays as-is** — `lib/scheduler/*` and `lib/shifts/*` and their tests
  are a **regression guard**: they must stay green throughout.

### Selected stack (decided with the user)
Priority is **developer experience over robustness** — justified because the data is tiny,
cleanly relational, single-tenant today, and has no search/analytics/real-time needs.

| Concern | Decision | Rationale |
|---|---|---|
| **Database** | **Turso (libSQL / hosted SQLite)** | Existing SQLite schema ports over almost verbatim; excellent local DX (real SQLite file locally, syncs to cloud); Vercel-native via Marketplace; edge-friendly. Best fit for "DX over robust" + tiny relational data. |
| **Access layer** | **Drizzle ORM** (`drizzle-orm` + `drizzle-kit`) | Best-in-class TypeScript DX, SQL-like, minimal magic. Provider-agnostic (libSQL adapter today, Postgres later if we outgrow Turso) so it does not lock in the DB choice. |
| **Runtime access** | Next.js 16 Server Components (reads) + Server Functions/Actions `'use server'` (writes) | Matches this Next version's data model (`node_modules/next/dist/docs/01-app/01-getting-started/{06-fetching-data,07-mutating-data,08-caching}.md`). |
| **Auth** | **Clerk** (`@clerk/nextjs`) — everyone authenticates | Hosted auth with best-in-class DX and Vercel-native integration. Clerk **Organizations** map onto our `teams`; Clerk **roles** (`org:admin` vs member) distinguish editors from viewers. Clerk owns identity — we do not store passwords or a users table. |
| **Tenancy** | **Clerk Organization = team; one org per user** | User expects multiple teams eventually and chose one-team-per-user. A user's **active Clerk organization** determines `team_id` for every request. Our `teams` table stores `clerk_org_id` to map Clerk orgs to our rows. |

### Target users (all authenticate via Clerk)
- **Admin/editor** (`org:admin` role) — builds and publishes weekly rotas, manages people and
  constraints for their team.
- **Viewer** (member role) — signs in and reads their team's published weeks. Per the user's
  decision, viewers authenticate too (no anonymous access).
- **`share_token` public link — superseded.** Since all viewers now log in, the password-free
  share link is no longer required. Retained in the schema but unused unless we deliberately keep
  it as an optional public read-only link (see Open Questions).

---

## 2. Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Run app locally (Next dev server) against the local libSQL file. |
| `pnpm db:generate` | `drizzle-kit generate` — generate SQL migration from schema changes. |
| `pnpm db:migrate` | `drizzle-kit migrate` — apply pending migrations to the target DB. |
| `pnpm db:push` | `drizzle-kit push` — push schema directly (local/dev iteration only). |
| `pnpm db:studio` | `drizzle-kit studio` — browse/edit data in Drizzle Studio. |
| `pnpm db:seed` | Run the seed script (default team + migrate existing `data/synchro.db` rows). |
| `turso db shell <db>` | Ad-hoc SQL against the hosted DB (via Turso CLI). |

> Package manager is **pnpm** (repo has `pnpm-lock.yaml` + `pnpm-workspace.yaml`). All new
> DB scripts are added under `package.json` `scripts`.

**Auth adds no new CLI commands** — Clerk is configured via env vars and its hosted dashboard
(create the Clerk app + organizations there). Local dev uses Clerk's development instance keys.

---

## 3. Project Structure

New/changed files (implementation phase — listed here for scope, not built in this spec):

```
synchro-7666/
├── proxy.ts                      # export const proxy = clerkMiddleware(...) — gates all routes
│                                 #   (Next 16 renamed `middleware`→`proxy`, Node runtime; see Risks)
├── drizzle.config.ts             # drizzle-kit config (dialect: turso, schema + migrations paths)
├── drizzle/                      # generated SQL migrations (committed to git)
│   └── 0000_init.sql
├── app/
│   └── layout.tsx                # wrap app in <ClerkProvider> (+ Clerk <OrganizationSwitcher>/UI)
├── lib/
│   ├── db/
│   │   ├── index.ts              # libSQL client + drizzle() instance (singleton); replaces client.ts
│   │   ├── schema.ts             # Drizzle table definitions (source of truth)
│   │   └── queries.ts            # rewritten from the existing sync file → Drizzle, async, team-scoped
│   └── auth.ts                   # currentTeam(): resolves team_id from Clerk active org;
│                                 #   requireAdmin()/requireMember() guards for Server Actions
├── scripts/
│   └── seed.ts                   # default team (+ clerk_org_id) + import from data/synchro.db
├── .env.local                    # DB + Clerk keys (gitignored)
├── .env.example                  # documents required env vars (committed)
└── data/synchro.db               # kept locally as dev DB / import source; stays gitignored
```

**Required env vars** (`.env.example`): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (+ Clerk sign-in/up URL vars as needed).
Set the same in Vercel project env (prod + preview).

### Schema (Drizzle `schema.ts` — target state)

Derived from the existing SQLite schema, with `teams` added and `team_id` threaded through.

- **`teams`** *(new)* — `id` (PK), `name`, `clerk_org_id` (TEXT, unique — maps to the Clerk
  Organization), `share_token` (unique, retained but superseded by auth). `clerk_org_id` is how
  every request resolves its `team_id` from the caller's active Clerk org.
- **No `users` table.** Clerk is the source of truth for identity and membership; we never store
  passwords or user credentials. Domain rows reference `person_id` (a schedulable subject, not an
  app user) as before — `people` and Clerk users are distinct concepts.
- **`people`** — `id` (PK), `team_id` (FK→teams), `name`, `active` (default true).
  Uniqueness of `name` becomes **`UNIQUE(team_id, name)`** (name unique *within a team*).
- **`constraints`** — `id` (PK), `person_id` (FK→people, cascade), `kind`
  (default `'unavailable_date'`), `value`. `UNIQUE(person_id, kind, value)`.
- **`weeks`** — `id` (PK), `team_id` (FK→teams), `week_start` (ISO date),
  `published` (default false). `UNIQUE(team_id, week_start)`. *(PK moves from `week_start`
  to a surrogate `id` so `week_start` can repeat across teams.)*
- **`assignments`** — `id` (PK), `week_id` (FK→weeks, cascade), `date`, `slot`,
  `person_id` (FK→people). `UNIQUE(week_id, date, slot, person_id)`. Index on `week_id`.
- **`settings`** — retained as a generic key/value store for **global** (non-team) config only;
  `share_token` migrates out to `teams`.

> **Migration note:** The live `data/synchro.db` currently has 11 `people`, 1 `week`,
> 0 `assignments`, 0 `constraints`, and `settings.share_token`. The seed script imports these
> into a single default team, mapping the existing `share_token` onto that team.

---

## 4. Code Style

- **TypeScript strict**, matching existing `tsconfig.json`. No `any` in the DB layer.
- **Schema is the single source of truth.** Never hand-edit generated migrations except to
  resolve a documented conflict; regenerate instead.
- **One DB client instance** (module singleton in `lib/db/index.ts`) — do not construct a client
  per request. Read credentials from env only; never hardcode URLs/tokens.
- **Reads in Server Components**, **writes in Server Actions** (`'use server'`). Per Next 16 docs,
  Server Actions are reachable via direct POST — every mutation must **call `auth()` (Clerk),
  resolve `team_id` from the active org, check the role, and validate input inside the action**,
  never trusting the caller. After a mutation, invalidate cache with `revalidatePath`/`revalidateTag`.
- **Auth enforced in two layers:** `clerkMiddleware()` gates routes globally; every Server
  Action / data query independently re-checks via `lib/auth.ts` helpers (`currentTeam`,
  `requireAdmin`). The proxy alone is not sufficient for POST-reachable actions.
- **All queries team-scoped.** Every domain query filters by the `team_id` resolved from the
  caller's Clerk active org (via `currentTeam()`), so tenancy is enforced in one place. A query
  must never accept a `team_id` from client input.
- Keep raw SQL out of components — go through Drizzle or `lib/db/queries.ts`.

---

## 5. Testing Strategy

- **Migration round-trip test:** applying `drizzle/*.sql` to a fresh in-memory/local libSQL DB
  produces the expected schema; `drizzle-kit generate` reports no drift against `schema.ts`.
- **Seed test:** running the seed against an empty DB yields exactly one default team with the
  imported people and share_token; re-running is idempotent (no dupes).
- **Query-layer unit tests** against a local libSQL file (a real SQLite file, so tests exercise
  the same engine as prod): CRUD for people/constraints/weeks/assignments, uniqueness constraints
  enforced, cascade deletes behave, and **cross-team isolation** (team A's queries never return
  team B's rows).
- **Connection smoke test:** app boots and executes one trivial query against the hosted Turso DB
  using env credentials (run in CI / manually against a preview DB).
- Test DB is a local libSQL file or Turso dev DB — **never the production database**.
- **Auth tests:** unauthenticated requests to gated routes/actions are rejected (proxy +
  in-action check); a member (viewer) role cannot invoke admin/editor mutations; `currentTeam()`
  resolves the correct `team_id` from the active Clerk org and a user in org A can never read or
  write org B's rows (cross-tenant isolation, enforced via mocked/stubbed Clerk `auth()`).

---

## 6. Boundaries

### Always
- Keep `.env.local` / real credentials out of git; commit `.env.example` only.
- Commit generated migrations in `drizzle/` to version control.
- Scope every domain query by the `team_id` resolved from Clerk (`currentTeam()`).
- Re-check auth + role **inside** every Server Action, not just in the proxy.
- Use env-based configuration (Vercel env vars in prod, `.env.local` in dev) for DB and Clerk keys.
- Consult `node_modules/next/dist/docs/` before writing Next-integrated code — this Next
  version has breaking changes vs. prior knowledge (per `AGENTS.md`). Notably `middleware`→`proxy`.
  `@clerk/nextjs@7.5.17` compatibility with Next 16.2.10 is **confirmed** (Task 0); wire Clerk in
  `proxy.ts`, not `middleware.ts`.

### Ask first
- Switching the provider away from Turso (e.g. to Neon Postgres) — changes the Drizzle dialect.
- Switching the auth provider away from Clerk — changes the tenancy/identity model.
- Any schema change that requires a destructive migration against data with real rows.
- Introducing a second datastore (cache, queue, blob) beyond the primary DB.
- Removing the `share_token` column/flow entirely (superseded but retained — see Open Questions).

### Never
- Ship a local SQLite file as the Vercel production database.
- Hardcode connection strings, DB tokens, or Clerk secret keys in source.
- Store user passwords or auth credentials in our DB — Clerk owns identity.
- Trust a `team_id` (or role) supplied by the client; always derive it from Clerk server-side.
- Write to the production DB from tests or seed scripts run in CI.
- Expose `share_token` values, DB credentials, or `CLERK_SECRET_KEY` to the client bundle.

### Risks / assumptions
- **Clerk × Next 16.2.10 compatibility — VERIFIED (Task 0).** `@clerk/nextjs@7.5.17` peer deps
  cover Next `^16.1.0-0` (=16.2.10) + React `~19.2.3` (=19.2.4); installed clean; `tsc` passes on a
  `clerkMiddleware`/`createRouteMatcher`/`auth.protect()` spike. **Consequence:** Next 16 renamed
  `middleware`→`proxy`, so wire Clerk as `export const proxy = clerkMiddleware(...)` in `proxy.ts`
  (Node runtime). The live redirect check (needs Clerk keys) is deferred to Task 4. If it ever
  regresses, fallbacks are Auth.js or a per-team passcode.

---

## 7. Success Criteria

1. A hosted **Turso** database exists and is reachable from the deployed Vercel app via env vars.
2. **Drizzle schema** (`lib/db/schema.ts`) models teams, people, constraints, weeks, assignments,
   settings — multi-tenant-ready with `team_id` on all domain rows.
3. **Migrations** generate cleanly, apply to the hosted DB, and are committed.
4. A **seed script** creates the default team and imports the existing `data/synchro.db` rows
   (11 people + share_token) idempotently.
5. The app performs at least one **real read (Server Component)** and one **real write
   (Server Action)** against Turso, replacing the existing local `node:sqlite` file.
6. Local dev works against a local libSQL file with the identical schema; `pnpm db:*` scripts run.
7. No credentials in git; `.env.example` documents required vars.
8. **Clerk auth is live:** all routes require sign-in; unauthenticated access is rejected.
9. **Tenancy is enforced by auth:** `team_id` is derived from the caller's active Clerk
   organization on every read/write; a user in one org cannot access another org's data.
10. **Roles are enforced:** `org:admin` users can edit/publish; member (viewer) users can only read.
11. Seeded default team is linked to a real Clerk organization via `clerk_org_id`.

---

## 8. Open Questions

1. **`share_token` now redundant — keep or drop?** Since all viewers authenticate via Clerk, the
   password-free share link no longer serves its original purpose. Options: (a) drop it entirely;
   (b) keep it as an optional *unauthenticated* public read-only link for published weeks (nice for
   sharing outside the org). Retained in schema for now; needs your call. *(Resolves old Q1/Q3.)*
2. **How are Clerk orgs created?** Self-serve (a user creates their org/team on first sign-in) or
   admin-provisioned only? Affects onboarding and whether the app calls Clerk's org APIs.
3. **Role mapping.** Confirm the two roles are Clerk's `org:admin` (editor) and default member
   (viewer). Any need for a third role (e.g. super-admin across teams)?
4. **Environments.** Separate Turso DBs *and* Clerk instances for dev / Vercel preview / production?
   (Recommend: prod + dev for both; Clerk has separate dev/prod instances by default.)
5. **Keep `data/synchro.db`?** After import, is the local file retained as the dev DB, or removed
   once Turso is authoritative?
6. **Slot vocabulary.** `assignments.slot` is free-text today. Should slots be a defined per-team
   set (a `slots` table) or remain free-form strings? (Out of scope here; flag for schema v2.)
