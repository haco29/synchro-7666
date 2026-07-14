# Tasks

> **Revised:** repo already contains a working, tested single-tenant app (`node:sqlite` +
> `lib/db/queries.ts`, 17 fns, 5 consumers, 27 tests). User chose full rebuild → this is a
> **migration/rewrite** to Drizzle+Turso + Clerk + `team_id`. Query API + callers go sync→async.
> `lib/scheduler/*` and `lib/shifts/*` tests are the regression guard — keep them green.

## Phase 0: De-risk
- [x] Task 0: Verify `@clerk/nextjs` supports Next.js 16.2.10 — **PASS**. `@clerk/nextjs@7.5.17` peer deps cover Next `^16.1.0-0` (=16.2.10) + React `~19.2.3` (=19.2.4); installed with zero peer warnings; `tsc --noEmit` clean on `clerkMiddleware`/`createRouteMatcher`/`auth.protect()`.
  - **KEY FINDING for Task 4:** Next 16 renamed `middleware.ts` → **`proxy.ts`** (Node.js runtime only; edge not supported in proxy). `middleware.ts` still works but is deprecated. Wire Clerk's handler as `export const proxy = clerkMiddleware(...)` in `proxy.ts`.
  - **DEFERRED:** live "gated route → sign-in redirect" needs Clerk API keys (no keys yet); verify at start of Task 4 with a Clerk dev instance.

## Phase 1: Database foundation
- [x] Task 1: Install DB + test tooling; scaffold `drizzle.config.ts`, `package.json` scripts, `.env.example`, `.gitignore` — **DONE**. Added `drizzle-orm`, `@libsql/client`, `drizzle-kit`, `dotenv`, `vitest`; `db:*` + `test` scripts; `drizzle.config.ts` (turso, env-driven); `vitest.config.ts`; `.env.example`; `!.env.example` in `.gitignore`. `pnpm db:generate` runs (0 tables), `tsc` clean. NOTE: `vitest` install made the **pre-existing 27 tests runnable** (no runner was configured before).
- [ ] Task 2: `lib/db/schema.ts` (6 tables), `lib/db/index.ts` client singleton, initial migration applied to local libSQL
- [ ] Task 3: `scripts/seed.ts` — default team + idempotent import from `data/synchro.db`; seed test

## Checkpoint: Database foundation
- [ ] Local DB migrates + seeds; schema matches spec; `pnpm db:*` scripts work; tests green

## Phase 2: Auth foundation
- [ ] Task 4: Clerk provider + `clerkMiddleware()` in **`proxy.ts`** (Next 16 convention, Node runtime) gating + sign-in/up routes + env vars; first run the deferred live-redirect check with Clerk keys
- [ ] Task 5: `lib/auth.ts` — `currentTeam()` (Clerk org → internal team_id) + `requireAdmin()`/`requireMember()`; auth tests

## Checkpoint: Auth foundation
- [ ] Sign-in gating works; `currentTeam()` maps org→team; role guards enforce editor vs viewer

## Phase 3: Vertical proof slice
- [ ] Task 6: Rewrite `lib/db/queries.ts` (17 fns) → Drizzle, async, team-scoped; replace `lib/db/client.ts`; port `queries.test.ts` + isolation cases (L — split if needed)
- [ ] Task 7: Wire the 5 existing DB consumers (`app/shifts/actions.ts`, week/people pages, fairness-panel, `app/s/[token]`) to async + `currentTeam()` + auth (L — split if needed)

## Checkpoint: Vertical slice
- [ ] End-to-end locally via `/shifts`: sign in → view week → admin edits → persists; viewer blocked; `/s/[token]` renders; isolation holds
- [ ] Regression guard: `lib/scheduler/*` + `lib/shifts/*` tests still green

## Phase 4: Hosted provisioning + deploy
- [ ] Task 8: Provision hosted Turso, set Vercel env (prod+preview), seed + link real Clerk org, deploy, verify real read/write

## Checkpoint: Complete
- [ ] All spec §7 Success Criteria met
- [ ] Deployed app reads/writes hosted Turso under Clerk auth with tenancy + role enforcement
- [ ] Ready for /test and /review
