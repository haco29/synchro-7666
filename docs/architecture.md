# Architecture

How `synchro` is built, and the invariants that keep it correct. For the reasoning behind these
choices (and the alternatives rejected), see the ADRs in [`docs/decisions/`](decisions/).

## Data & Auth

Persistence is **Turso (libSQL) accessed via Drizzle ORM**
([ADR-0001](decisions/0001-persistence-turso-drizzle.md)). Auth is **Clerk with Organizations as
tenants** — a Clerk Organization maps 1:1 to an internal `teams` row
([ADR-0002](decisions/0002-auth-clerk-org-multitenancy.md)).

- `lib/db/schema.ts` — Drizzle schema (source of truth). `lib/db/index.ts` — `getDb()` client.
  `lib/db/queries.ts` — async, team-scoped query functions.
- `lib/auth.ts` — `currentTeam()` (tenancy seam) + `requireAdmin()` / `requireMember()`, plus
  `requireLinkedMember()` / `currentPersonId()` (resolve the caller's own `people` row — see
  [ADR-0003](decisions/0003-member-self-availability.md)).
- `proxy.ts` — Clerk middleware (Next 16 `proxy` convention) that gates routes.

## Invariants — do not break these

- **Scope every domain query by `team_id`.** Derive `team_id` **only** from `currentTeam()`
  (`lib/auth.ts`), which reads the caller's active Clerk org server-side. Query functions take
  `teamId` as a parameter. **Never** trust a `team_id`, `personId`, or `week` from client input.
- **Mutations live in Server Actions and must re-check authz** — call `requireAdmin()` (editors)
  or `requireMember()` (viewers). Server Actions are POST-reachable, so `proxy.ts` alone is **not**
  sufficient. One exception to "viewers are read-only": a member may edit **their own**
  unavailability via `requireLinkedMember()`, which resolves the caller's `people` row server-side
  and rejects any other `personId` ([ADR-0003](decisions/0003-member-self-availability.md)).
- **Route gating is `proxy.ts`**, not `middleware.ts` (Next 16 renamed `middleware` → `proxy`;
  Node runtime).
- **No `users` table** — Clerk owns identity. `people` are schedulable subjects, not app users.
  A person *may* carry a `clerk_user_id` (admin-set link) so a member can self-serve their own
  availability, but this is a pointer, not an identity store — most people are unlinked
  ([ADR-0003](decisions/0003-member-self-availability.md)).
- **Migrations are NOT automatic.** Vercel deploys code only. After any `lib/db/schema.ts` change:
  `pnpm db:generate` (commit the SQL), then `pnpm db:migrate` against **each** target DB
  (local `dev.db` and hosted Turso) separately.
- **Config is env-only** (`.env.local` locally, Vercel env in prod). No secrets in code. The local
  dev DB is `TURSO_DATABASE_URL=file:./data/dev.db`.

## Known caveats

- Clerk is currently a **development** instance on `*.vercel.app`: it shows a "Development mode"
  badge, and a JS-less/SSR-first request (e.g. `curl`) to a protected route gets a 404 rewrite
  (`dev-browser-missing`) rather than a redirect — real browsers handshake fine. Promoting to a
  **production** Clerk instance requires a custom domain (see ADR-0002).

## Process

The database + auth work was built spec-first; the artifacts live in [`sdlc/db-init/`](../sdlc/db-init/)
(spec → plan → todo).
