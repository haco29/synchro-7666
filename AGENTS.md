<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Data & Auth architecture

Persistence is **Turso (libSQL) via Drizzle** ([ADR-0001](docs/decisions/0001-persistence-turso-drizzle.md));
auth is **Clerk with Organizations as tenants** ([ADR-0002](docs/decisions/0002-auth-clerk-org-multitenancy.md)).
Invariants — do not break these:

- **Tenancy: scope every domain query by `team_id`.** Derive `team_id` **only** from
  `currentTeam()` (`lib/auth.ts`), which reads the caller's active Clerk org server-side. Query
  functions in `lib/db/queries.ts` take `teamId` as a parameter. **Never** trust a `team_id`,
  `personId`, or `week` from client input.
- **Mutations live in Server Actions and must re-check authz** — call `requireAdmin()` (editors)
  or `requireMember()` (viewers). Server Actions are POST-reachable, so `proxy.ts` (the Clerk
  middleware) alone is **not** sufficient.
- **Route gating is `proxy.ts`** (Next 16 renamed `middleware` → `proxy`; Node runtime), not `middleware.ts`.
- **No `users` table** — Clerk owns identity. `people` are schedulable subjects, not app users.
- **Migrations are NOT automatic.** Vercel deploys code only. After any `lib/db/schema.ts` change:
  `pnpm db:generate` (commit the SQL), then `pnpm db:migrate` against **each** target DB
  (local `dev.db` and hosted Turso) separately.
- **Config is env-only** (`.env.local` locally, Vercel env in prod). No secrets in code. Local dev
  DB is `TURSO_DATABASE_URL=file:./data/dev.db`.
- Clerk is currently a **development** instance on `*.vercel.app` (see ADR-0002 for the caveats and
  the production-instance follow-up).
