# Implementation Plan: Database & Auth Infrastructure — `synchro-7666`

- **Branch:** `db-init`
- **Spec:** [spec.md](spec.md)
- **Date:** 2026-07-13
- **Status:** Approved — build in progress (Tasks 0–1 done; revised after discovering existing code)

## Overview

Wire up the persistence layer and auth for `synchro-7666`: a **Turso (libSQL)** database accessed
through **Drizzle ORM**, with **Clerk** authentication and Clerk-Organization-based multi-tenancy.

> **Revised after discovering existing code.** The app is **not** boilerplate — the "shifts
> scheduling" feature is fully built and tested against a synchronous `node:sqlite` layer
> (`lib/db/client.ts` + `lib/db/queries.ts`, 17 functions, 5 route consumers, 27 tests). Per the
> user's decision, this plan **migrates and rewrites** that single-tenant layer to Drizzle+Turso
> **and** adds Clerk auth + `team_id` multi-tenancy. Key consequence: the libSQL client is async,
> so the query API and every caller convert from sync to `async`. The pure `lib/scheduler/*` and
> `lib/shifts/*` logic (and their tests) are untouched and serve as a regression guard.

## Architecture Decisions

- **Drizzle schema is the single source of truth.** Migrations are generated from it and committed;
  the schema is written before any client or query code (it is the contract everything depends on).
- **Query functions take `teamId` as an explicit parameter.** Only `currentTeam()` (in `lib/auth.ts`)
  derives `teamId` from Clerk server-side. This keeps the query layer Clerk-free and unit-testable,
  and enforces tenancy in exactly one place. Callers never pass a client-supplied `teamId`.
- **Local dev uses a local libSQL file; prod uses hosted Turso.** Same Drizzle dialect, same
  migrations, so local and prod schemas are identical. Cloud accounts are only needed at deploy.
- **Auth is enforced in two layers:** `clerkMiddleware()` (in **`proxy.ts`** — Next 16 renamed the
  `middleware` convention to `proxy`, Node.js runtime) gates routes, and every Server Action /
  query re-checks via `lib/auth.ts`. The proxy alone is insufficient (Server Actions are POST-reachable).
- **Fail-fast on the Clerk × Next 16.2.10 risk.** A throwaway compatibility spike runs first
  (Phase 0) so we discover an incompatibility before building anything on Clerk.

## Dependency Graph

```text
Phase 0: Clerk×Next16 spike (fail-fast) ─────────────┐
                                                      │
Task 1: DB + test tooling / config                   │
   │                                                  │
Task 2: schema.ts + db client + initial migration     │  (contract — everything below needs it)
   │        │                                          │
   │        ├── Task 3: seed script (import synchro.db) │
   │        │                                          │
   │        └── Task 6: rewrite queries.ts → Drizzle/async/team-scoped
   │                         │                          │
Task 4: Clerk provider + proxy.ts (needs Phase 0) ────┘  │
   │                                                      │
Task 5: lib/auth.ts currentTeam()/requireAdmin ──────────┤ (needs schema.teams + Clerk)
   │                                                      │
Task 7: wire existing routes to auth + team scope (needs 5 + 6)
   │
Task 8: provision hosted Turso + Vercel env + deploy verification (needs all)
```

Parallelizable: Phase 0 spike runs alongside Tasks 1–2. Task 3 and Task 6 both depend only on
Task 2 and can proceed in parallel. Task 4 depends only on the Phase 0 spike and can proceed
alongside Tasks 2–3.

## Task List

Task descriptions only — live status lives in [todo.md](todo.md).

### Phase 0: De-risk

**Task 0 — Verify Clerk supports Next.js 16.2.10 (spike). ✅ DONE — PASS.**
Confirmed `@clerk/nextjs` works with this Next version before committing to it. **Key finding:**
Next 16 renamed the `middleware` convention to **`proxy.ts`** (Node.js runtime; edge unsupported);
`middleware.ts` still works but is deprecated. So Clerk's handler is wired as
`export const proxy = clerkMiddleware(...)` in `proxy.ts` (drives Tasks 4/5).
- *Result:* `@clerk/nextjs@7.5.17` peer deps cover Next `^16.1.0-0` (=16.2.10) + React `~19.2.3`
  (=19.2.4); installed with zero peer warnings; `tsc --noEmit` clean on a `clerkMiddleware` /
  `createRouteMatcher` / `auth.protect()` `proxy.ts` spike.
- *Deferred:* the live "gated route → sign-in redirect" needs Clerk API keys (none yet) — verify at
  the start of Task 4 with a Clerk dev instance. Fallbacks if it ever regresses: Auth.js / per-team passcode.
- *Dependencies:* None. *Files:* throwaway spike (removed); `@clerk/nextjs` dependency retained. *Scope:* S.

### Phase 1: Database foundation

**Task 1 — Install DB + test tooling and scaffold config.**
Add `drizzle-orm`, `@libsql/client`, and dev deps `drizzle-kit`, `dotenv`, and a test runner
(`vitest`). Create `drizzle.config.ts` (dialect `turso`, schema + migrations paths), add
`db:generate|migrate|push|studio|seed` and `test` scripts to `package.json`, create `.env.example`,
and confirm `.gitignore` covers `.env*` and `data/*.db*`.
- *Acceptance:* deps install; `pnpm db:generate` runs (even with empty schema); `.env.example` lists
  all required vars; no secrets or `.env.local` tracked by git.
- *Verification:* `pnpm install` clean; `pnpm exec drizzle-kit --version` works; `git status` shows
  no `.env.local`/`.db` staged.
- *Dependencies:* None. *Files:* `package.json`, `drizzle.config.ts`, `.env.example`, `.gitignore`. *Scope:* S.

**Task 2 — Drizzle schema, DB client singleton, and initial migration.**
Write `lib/db/schema.ts` with `teams` (+ `clerk_org_id` unique, `share_token` unique), `people`
(`UNIQUE(team_id, name)`), `constraints`, `weeks` (surrogate `id`, `UNIQUE(team_id, week_start)`),
`assignments` (`UNIQUE(week_id, date, slot, person_id)`, index on `week_id`), and `settings`.
Add `lib/db/index.ts` (single libSQL client + `drizzle()` instance from env). Generate the initial
migration and apply it to a local libSQL file.
- *Acceptance:* schema compiles under strict TS; `pnpm db:generate` produces `drizzle/0000_*.sql`
  matching the spec's tables/constraints; `pnpm db:migrate` applies cleanly to a fresh local file;
  re-running `db:generate` reports no drift.
- *Verification:* migration file exists and is committed; `sqlite3 <localfile> .schema` shows all
  six tables with the specified uniqueness constraints and the `assignments` index.
- *Dependencies:* Task 1. *Files:* `lib/db/schema.ts`, `lib/db/index.ts`, `drizzle/0000_*.sql`. *Scope:* M.

**Task 3 — Seed script: default team + import from `data/synchro.db`.**
Write `scripts/seed.ts` (run via `pnpm db:seed`) that creates one default team (placeholder
`clerk_org_id`, to be linked in Task 8), imports the 11 existing `people` and the `share_token`
from `data/synchro.db`, and is idempotent (safe to re-run). Add a seed test.
- *Acceptance:* against an empty DB the seed creates exactly one team + 11 people + the share_token;
  a second run adds no duplicates; test passes.
- *Verification:* `pnpm db:seed` twice, then a count query shows 1 team / 11 people; `pnpm test`
  covers the idempotency case.
- *Dependencies:* Task 2. *Files:* `scripts/seed.ts`, `scripts/seed.test.ts`. *Scope:* M.

### Checkpoint: Database foundation
Local libSQL DB migrates and seeds; schema matches spec; `pnpm db:*` scripts work; tests green.
Review with human before wiring auth.

### Phase 2: Auth foundation

**Task 4 — Clerk provider, `proxy.ts`, and sign-in/up routes.**
Wrap the app in `<ClerkProvider>` (`app/layout.tsx`), add `clerkMiddleware()` as
`export const proxy = clerkMiddleware(...)` in **`proxy.ts`** (Next 16 convention, Node runtime —
per the Task 0 finding) gating all non-public routes, add sign-in/up pages, and document Clerk env
vars in `.env.example`. First, run the deferred live-redirect check from Task 0 with a Clerk dev
instance. Choose self-serve org creation as the default (Open Question #2) unless told otherwise.
- *Acceptance:* unauthenticated access to app routes redirects to sign-in; a signed-in user with an
  active org can reach the app; Clerk keys read from env only.
- *Verification:* with no session, a protected route redirects (browser/curl); after sign-in it
  renders; no Clerk keys in source.
- *Dependencies:* Task 0. *Files:* `proxy.ts`, `app/layout.tsx`, `app/sign-in/[[...]]/page.tsx`,
  `app/sign-up/[[...]]/page.tsx`, `.env.example`. *Scope:* M.

**Task 5 — `lib/auth.ts`: team resolution and role guards.**
Implement `currentTeam()` (reads Clerk `auth()` active org id, looks up `teams.clerk_org_id`, returns
the internal `team_id`; errors if none) plus `requireAdmin()` / `requireMember()` guards mapping to
Clerk roles (`org:admin` = editor, member = viewer). Auto-provision a `teams` row on first request
for a new Clerk org (links `clerk_org_id`).
- *Acceptance:* `currentTeam()` returns the correct internal `team_id` for a signed-in user's active
  org and throws when unauthenticated / no org; `requireAdmin()` rejects members; a brand-new Clerk
  org gets a `teams` row created once.
- *Verification:* unit tests with a mocked/stubbed Clerk `auth()` cover: no session → throws;
  member → `requireAdmin` throws; admin → passes; new org → team row created idempotently.
- *Dependencies:* Task 2, Task 4. *Files:* `lib/auth.ts`, `lib/auth.test.ts`. *Scope:* M.

### Checkpoint: Auth foundation
Sign-in gating works end-to-end; `currentTeam()` maps Clerk org → internal team; role guards
enforce editor vs viewer. Review with human before the vertical slice.

### Phase 3: Vertical proof slice

**Task 6 — Rewrite `lib/db/queries.ts` to Drizzle, async, and team-scoped.**
Rewrite the existing 17 sync functions to Drizzle queries that each take an explicit `teamId`
param and are `async` (`listPeople`, `addPerson`, `renamePerson`, `setPersonActive`,
`listConstraintsForWeek`, `setUnavailable`, `ensureWeek`, `isWeekPublished`, `setWeekPublished`,
`listPublishedWeeks`, `listAssignments`, `replaceWeekAssignments`, `swapSeat`, `removeAssignment`,
`historyBefore`, `getShareToken`, plus any helper). Replace `lib/db/client.ts` (`node:sqlite`)
with the libSQL/Drizzle instance. Port `lib/db/queries.test.ts` to the new async, two-team API
and add **cross-team isolation** cases. Keep `swapSeat`'s stale-guard and atomic-replace semantics.
- *Acceptance:* every query filters by `teamId` and is async; existing behaviors (atomic week
  replace, swap stale-guard, history aggregation, share token) preserved; `UNIQUE(team_id, name)`
  + cascade behave; a two-team fixture proves isolation; no query trusts a client-supplied `teamId`.
- *Verification:* `pnpm test` — rewritten `queries.test.ts` green AND `lib/scheduler/*` +
  `lib/shifts/*` tests still green (regression guard).
- *Dependencies:* Task 2. *Files:* `lib/db/queries.ts`, `lib/db/client.ts`, `lib/db/queries.test.ts`. *Scope:* L (split if needed).

**Task 7 — Wire existing routes to auth + team scope (vertical proof).**
Update the 5 DB consumers to `await` the now-async, team-scoped queries and resolve `teamId` via
`currentTeam()`: `app/shifts/actions.ts` (Server Actions call `requireAdmin()` + `revalidatePath`),
`app/shifts/week/[start]/page.tsx`, `app/shifts/people/page.tsx`,
`app/shifts/_components/fairness-panel.tsx`, and `app/s/[token]/page.tsx` (public token route —
resolve team by `share_token`, no Clerk; see Open Question #1). This proves the end-to-end slice
against the *real* app, not a throwaway page.
- *Acceptance:* signed-in user sees only their team's data; admin edits/publishes; a member (viewer)
  is blocked from mutations; unauthenticated redirected; `/s/[token]` still renders the published
  week for the matching team. Real reads + writes hit Turso (Success Criteria #5).
- *Verification:* manual browser flow through `/shifts` (sign in → view week → edit as admin →
  persists; viewer blocked); `/s/[token]` loads; Server Actions re-check auth (not just proxy).
- *Dependencies:* Task 5, Task 6. *Files:* the 5 consumer files above + `app/shifts/actions.ts`. *Scope:* L (split if needed).

### Checkpoint: Vertical slice
End-to-end locally via `/shifts`: sign in → view a week → admin edits/publishes → persists; viewer
blocked from mutations; `/s/[token]` renders; cross-team isolation holds; `lib/scheduler/*` +
`lib/shifts/*` tests still green. Review with human before touching cloud infra.

### Phase 4: Hosted provisioning + deploy

**Task 8 — Provision hosted Turso, wire Vercel env, deploy and verify.**
(Human-in-the-loop: needs the user's Turso, Clerk, and Vercel accounts.) Provision a hosted Turso
DB (Vercel Marketplace or Turso CLI), apply migrations to it, set `TURSO_*` and `CLERK_*` env vars
in the Vercel project (prod + preview), seed the default team and link its `clerk_org_id` to a real
Clerk organization, deploy, and verify a real read/write against hosted Turso through the deployed app.
- *Acceptance:* deployed app on Vercel authenticates via Clerk and performs the Task 7 read+write
  against hosted Turso; env vars set in prod + preview; default team linked to a real Clerk org
  (Success Criteria #1, #3, #4, #11).
- *Verification:* on the deployed URL, sign in → open `/shifts` → admin edits a week → persists
  (confirm the row in Turso via `turso db shell`); no credentials in the client bundle or git.
- *Dependencies:* Tasks 3, 5, 7. *Files:* `.env.example` (docs only), Vercel/Turso/Clerk dashboards
  (external). *Scope:* M.

### Checkpoint: Complete
All Success Criteria (spec §7) met; deployed app reads/writes hosted Turso under Clerk auth with
tenancy + role enforcement. Ready for `/test` and `/review`.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `@clerk/nextjs` incompatible with Next 16.2.10 | High | Phase 0 spike fails fast; fallbacks are Auth.js or per-team passcode (weighed in spec). |
| Task 8 blocked on missing cloud accounts/credentials | Med | All of Phases 0–3 run locally with no cloud; Task 8 isolates every human-in-loop step. |
| Multi-tenancy bug leaks cross-team data | High | `teamId` derived only in `currentTeam()`; explicit cross-team isolation tests (Task 6). |
| Server Action bypasses the proxy (direct POST) | Med | Every action re-checks `requireAdmin()`/`currentTeam()` (Task 7); not relying on the proxy alone. |
| Drizzle libSQL→Postgres migration later | Low | Drizzle keeps dialect swappable; not exercised now. |
| Rewriting working, tested code (queries.ts + routes) introduces regressions | High | Port `queries.test.ts` behavior-for-behavior; keep `lib/scheduler/*` + `lib/shifts/*` tests green as a guard; Tasks 6/7 are L — split into smaller increments if needed. |
| Sync→async query conversion breaks callers silently | Med | TypeScript surfaces missing `await` at compile; `tsc --noEmit` gate after Tasks 6/7. |

## Open Questions

Carried from spec §8 — none block Phases 0–3; items 1–2 affect Phase 4 polish:
1. **`share_token` keep or drop?** Kept in schema (Task 2); no runtime use built. Decide before any public-link feature.
2. **Clerk org creation** — plan assumes **self-serve** (Task 4/5). Confirm or switch to admin-provisioned.
3. **Role mapping** — plan assumes `org:admin` (editor) + member (viewer). Confirm no third role.
4. **Environments** — Task 8 assumes separate dev vs prod Turso + Clerk instances.
5. **Keep `data/synchro.db`?** Used as the seed source (Task 3); retained locally as dev DB unless removed.
6. **Slot vocabulary** — free-text `slot` for now; `slots` table deferred to schema v2 (out of scope).

## SDLC Command Coverage
- [x] /spec completed
- [x] /plan completed
- [x] /build completed (Tasks 0–8; deployed to production)
- [x] /test completed (Prove-It on review findings: tenancy write-guard + resolveTeamId race + cascade test; 59 green)
- [x] /review completed (5-axis, incl. independent reviewer; approve with follow-ups — see review notes)
- [x] /code-simplify completed (extracted findWeekId + findTeamByOrg helpers; dropped a redundant identity map; behavior-preserving, 55 green)
