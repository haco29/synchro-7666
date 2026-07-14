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
- [x] Task 5: `lib/auth.ts` — `currentTeam()` (Clerk org → internal team_id) + `requireAdmin()`/`requireMember()`; auth tests — **DONE**. Pure `resolveTeamId(db, orgId)` (lookup → claim unlinked Default Team for first org → create for later orgs; idempotent, `clerk_org_id` unique). Thin `currentTeam()`/`requireMember()`/`requireAdmin()` wrappers read Clerk `auth()`; `AuthError` on unauth/no-org; `requireAdmin` needs `org:admin`. TDD: `lib/auth.test.ts` (11 tests: resolve/claim/create/isolation + guard matrix via stubbed `auth()` + in-memory db) RED→GREEN. Suite 47 green; `tsc` clean. (Dormant until routes wire it in Task 7.)

## Checkpoint: Auth foundation ✅
- [x] Sign-in gating works (Task 4); `currentTeam()` maps org→team; role guards enforce editor vs viewer

## Phase 3: Vertical proof slice
- [x] Task 6: Rewrite `lib/db/queries.ts` (17 fns) → Drizzle, async, team-scoped; replace `lib/db/client.ts`; port `queries.test.ts` + isolation cases — **DONE (tests green; tsc red until Task 7)**. All 17 fns now `async` + `teamId` first param; surrogate `week_id` resolved via `ensureWeekId`; transactions via `db.transaction`; `historyBefore` joins assignments→weeks; `getShareToken` reads `teams.share_token`. Behaviors preserved (reactivate-on-readd, OR-IGNORE rename via cause-chain unique check, atomic replace, swap no-op/stale-guard). Deleted `lib/db/client.ts` (node:sqlite). TDD: `queries.test.ts` rewritten to 17 async/two-team tests (+cross-team isolation) RED→GREEN. Suite **55 green** (scheduler/shifts regression guard intact). NOTE: queries.test uses a temp **file** DB (libSQL `:memory:` + `db.transaction` gotcha). **tsc RED on 5 consumers (66 errs) — Task 7 worklist**: week/[start] 19, actions.ts 16, s/[token] 15, fairness-panel 9, people 7.
- [x] Task 7: Wire the 5 existing DB consumers to async + `currentTeam()` + auth — **DONE**. Server Actions (`actions.ts`) → `requireAdmin()` + `await`; `clearSlot` derives `sundayOf(date)`. Pages (`week/[start]`, `people`) + `fairness-panel` → `currentTeam()` + `await`. `/s/[token]` → public: new `getTeamIdByShareToken()` resolves team by token (added + tested), pre-fetch per-week assignments; `proxy.ts` public routes now include `/s/(.*)`. `tsc` CLEAN; suite **56 green**. Runtime verified: `/s/<token>` 200 renders 11 imported people + published week (no console errors), `/s/<bad>` 404, `/shifts` 307→/sign-in.

## Checkpoint: Vertical slice ✅ (authed-edit = user's final check)
- [x] `/s/[token]` renders real data end-to-end; bad token 404; `/shifts` gated; cross-team isolation holds (unit-tested)
- [x] Regression guard: `lib/scheduler/*` + `lib/shifts/*` tests still green
- [ ] Human check: sign in → `/shifts` shows the 11 people → generate/edit/publish persists (couldn't self-verify — no browser session)

## Phase 4: Hosted provisioning + deploy
- [ ] Task 8: Provision hosted Turso, set Vercel env (prod+preview), seed + link real Clerk org, deploy, verify real read/write

## Checkpoint: Complete
- [ ] All spec §7 Success Criteria met
- [ ] Deployed app reads/writes hosted Turso under Clerk auth with tenancy + role enforcement
- [ ] Ready for /test and /review
