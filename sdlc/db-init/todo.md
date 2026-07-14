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
- [x] Task 2: `lib/db/schema.ts` (6 tables), `lib/db/index.ts` client singleton, initial migration applied to local libSQL — **DONE**. Drizzle schema: teams (`clerk_org_id`+`share_token` unique), people (`UNIQUE(team_id,name)`), constraints (`UNIQUE(person_id,kind,value)`), weeks (surrogate id, `UNIQUE(team_id,week_start)`), assignments (`UNIQUE(week_id,date,slot,person_id)` + `idx_assignments_week`), settings. `lib/db/index.ts` = lazy libSQL/Drizzle `getDb()`. Migration `drizzle/0000_purple_storm.sql` applied to `data/dev.db`; re-generate = no drift. TDD: `lib/db/schema.test.ts` (5 tests) RED→GREEN; full suite 32 green; `tsc` clean.
- [x] Task 3: `scripts/seed.ts` — default team + idempotent import from `data/synchro.db`; seed test — **DONE**. `readSourceDb()` (node:sqlite reader) + idempotent `seed()` (team by name, people via `UNIQUE(team_id,name)`, weeks via `UNIQUE(team_id,week_start)`). `pnpm db:seed` ×2 → 1 team / 11 people / 1 week, share_token `2ea7…` preserved. Standalone script (own libSQL client, not index.ts) so `node scripts/seed.ts` runs. Added `allowImportingTsExtensions` to tsconfig (Node needs `.ts` ext) + `.env.local` (gitignored, `file:./data/dev.db`). Constraints/assignments not imported (source has none). TDD: `scripts/seed.test.ts` (4 tests) RED→GREEN; suite 36 green; `tsc` clean.

## Checkpoint: Database foundation ✅
- [x] Local DB migrates + seeds; schema matches spec; `pnpm db:*` scripts work; tests green (36)

## Phase 2: Auth foundation
- [x] Task 4: Clerk provider + `clerkMiddleware()` in `proxy.ts` gating + sign-in/up routes + env vars — **DONE** (via `clerk init`, app `app_3GU33O8SbW1WgIoTDgw0W3TcvEQ`). CLI scaffolded `proxy.ts` (Next 16 ✓, added `/__clerk/:path*` to matcher), `<ClerkProvider>` in `layout.tsx`, `app/sign-in|sign-up` catch-all routes; keys written to gitignored `.env.local`. Added global auth header (`<Show when=…>` + `UserButton`/`SignInButton`/`SignUpButton` — this Clerk 7.5 uses `Show`, not `SignedIn/Out`). `clerk doctor` green; `tsc` clean; 36 tests green. **Live-redirect check PASSED** (deferred from Task 0): unauth `/` → 307 `/sign-in`, `/sign-in` → 200, sign-in page renders, no console errors. NOTE: Clerk app uses phone-number sign-in.
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
