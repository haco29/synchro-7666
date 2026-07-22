# ADR-0001: Hosted Turso (libSQL) + Drizzle for persistence

## Status

Accepted

## Date

2026-07-14

## Context

`synchro` began as a single-tenant "shifts scheduling" app persisting to a local
`node:sqlite` file (`data/synchro.db`). It deploys on **Vercel**, whose serverless
functions have an **ephemeral, read-only filesystem** — a local `.db` file is wiped
between invocations and writes never persist. So a hosted database is required.

Constraints/priorities at decision time:

- Data is small and cleanly relational (people, weeks, assignments), no search/analytics/real-time.
- Stated priority: **developer experience over robustness**.
- Must be **multi-tenant-ready** (a `team_id` on every domain row; see [ADR-0002](0002-auth-clerk-org-multitenancy.md)).
- An existing SQLite schema already modeled the domain.

## Decision

Use **Turso (libSQL)** as the hosted database, accessed through **Drizzle ORM**.

- `lib/db/schema.ts` is the single source of truth; migrations are generated with
  `drizzle-kit` and **committed** under `drizzle/`.
- `lib/db/index.ts` exposes a lazy `getDb()` libSQL/Drizzle client singleton (env-driven).
- `lib/db/queries.ts` holds all query functions — **async** and **team-scoped** (each takes a
  `teamId`). Raw SQL stays out of components.
- Turso is provisioned via the **Vercel Marketplace** integration, which injects
  `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` into the Vercel project env.

## Alternatives Considered

### Keep local `node:sqlite`

- Rejected: cannot persist on Vercel's ephemeral filesystem (the whole reason for this work).

### Neon / Vercel Postgres

- Pros: the "standard" serverless-Postgres path, largest ecosystem, better if we outgrow single-DB scale.
- Cons: heavier setup than libSQL; the existing SQLite schema ports to libSQL almost verbatim.
- Rejected (for now): DX + schema-fit favored Turso. Drizzle keeps the dialect swappable if this changes.

### Prisma instead of Drizzle

- Cons: heavier client, historically weaker on serverless/edge cold starts.
- Rejected: Drizzle gives type-safe, SQL-like queries + `drizzle-kit` migrations with less weight.

### Raw `@libsql/client` (no ORM)

- Rejected: we'd hand-roll types and migrations; Drizzle provides both.

## Consequences

- **The schema is the source of truth**; regenerate migrations from it, don't hand-edit.
- **Migrations do NOT run on Vercel deploy.** A deploy ships code only. After any schema change,
  run `pnpm db:generate` (commit) then `pnpm db:migrate` against each target DB (local `dev.db`
  and hosted Turso) **separately**. Forgetting this is the most likely operational footgun.
- The query layer is **async** (converted from the original sync `node:sqlite`), which rippled into
  every caller (`await`).
- Local dev uses a plain `file:` URL (`file:./data/dev.db`) — no cloud account needed to run locally.
- Provider is swappable via Drizzle's dialect if we later move to Postgres.
