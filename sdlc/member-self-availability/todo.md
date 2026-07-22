# Tasks

> Feature: a Clerk **member** can toggle **their own** unavailability, gated by a new admin-set
> `people.clerk_user_id` link. Two vertical slices — admin linking, then member self-service —
> split by a checkpoint. TDD throughout; keep the existing 56-test suite green (regression guard).
> Spec: [spec.md](spec.md) · Plan: [plan.md](plan.md).

## Phase 0: De-risk

- [x] **Task 0 (S):** Verify the Clerk org-membership read is available and learn its shape in `@clerk/nextjs@7.5.17` — **PASS**.
  - `clerkClient()` (from `@clerk/nextjs/server`) → `Promise<ClerkClient>`. `client.organizations.getOrganizationMembershipList({ organizationId, limit?, offset? })` → `Promise<PaginatedResourceResponse<OrganizationMembership[]>>` i.e. `{ data, totalCount }`. Backend dep is `@clerk/backend@3.11.4`.
  - **Shape for the dropdown:** each `OrganizationMembership` has `.publicUserData` (nullable) = `{ userId, identifier, firstName, lastName, imageUrl, hasImage }`. Map → `{ userId: publicUserData.userId, label: [firstName,lastName].filter(Boolean).join(" ") || identifier }`. `identifier` is the email/phone fallback. **Filter out null `publicUserData`.**
  - **Note:** the org has ≤ a handful of members; `limit: 100` (max page) is enough — no pagination loop needed for v1. Log if a team ever exceeds 100 (spec "no silent caps" spirit).
  - **Acceptance:** ✅ spike (`clerkClient().organizations.getOrganizationMembershipList` → mapped `{userId,label}[]`) is `tsc`-clean under the project tsconfig (`moduleResolution: bundler`); fields documented above.
  - **Verify:** ✅ `npx tsc --noEmit -p tsconfig.json` with the spike present → exit 0. (Standalone `npx tsc <file>` falsely errors on `@clerk/shared/types` because it drops the project's `bundler` resolution — must run via `-p tsconfig.json`.) Spike file removed; no source committed.

## Phase 1: Schema (contract)

- [x] **Task 1 (S):** Add `people.clerk_user_id` (TEXT, unique, nullable) to [`lib/db/schema.ts`](../../lib/db/schema.ts) — **DONE**.
  - Column added with `.unique()` + doc comment (NULL = unlinked; SQLite treats NULLs as distinct so multiple unlinked people coexist). Migration `drizzle/0002_ambitious_bromley.sql` (`ALTER TABLE ADD clerk_user_id` + `CREATE UNIQUE INDEX`) applied to local `data/dev.db`.
  - TDD: 2 new tests in [`schema.test.ts`](../../lib/db/schema.test.ts) — (a) two unlinked (NULL) people coexist; (b) duplicate `clerkUserId` rejected — RED→GREEN.
  - **Acceptance:** ✅ migration generated + committed-ready; re-generate → "No schema changes" (no drift); new tests green; **full suite 57 green**; `tsc` clean.
  - **Verify:** ✅ `pnpm db:migrate` applied; `pnpm db:generate` no drift; `npx vitest run` 57/57; `npx tsc --noEmit -p tsconfig.json` exit 0.

## Checkpoint: Contract ready ✅

- [x] Column migrated locally; drift-free; full suite green (57).
- [ ] Hosted Turso migration deferred to Task 9 (deploy phase).

## Phase 2: Admin linking slice

- [x] **Task 2 (S):** Query functions in [`queries.ts`](../../lib/db/queries.ts) — **DONE**. Added `linkPersonToUser(teamId, personId, clerkUserId)` (team-scoped; transaction clears the id from any prior holder then sets it → relink = last-write-wins, satisfies global-unique), `unlinkPerson(teamId, personId)`, and a dedicated `listPeopleWithUserLinks(teamId)` returning `PersonWithLink = Person & { clerkUserId }`.
  - **Design note (deviation from plan):** kept the shared `Person` domain type auth-free (used by the scheduler); added a **separate** `listPeopleWithUserLinks` instead of extending `listPeople`'s projection. Cleaner boundary.
  - TDD: 4 tests in `queries.test.ts` (link surfaces in admin listing; unlink clears; relink moves link; foreign-team person is a no-op). **Verify:** ✅ 22 query tests; `tsc` clean.
- [x] **Task 3 (S):** `lib/clerk/members.ts` — **DONE**. `listOrgMembers()` reads active org from `auth()`, calls `clerkClient().organizations.getOrganizationMembershipList({ organizationId, limit: 100 })`, maps to `{ userId, label }[]` (name || identifier), filters null `publicUserData`, returns `[]` when no active org.
  - TDD: 5 tests (`members.test.ts`) with `auth`/`clerkClient` mocked — name label, identifier fallback, null-skip, no-org, correct params. **Verify:** ✅ 5 tests; `tsc` clean.
- [x] **Task 4 (S):** `linkPersonAction` / `unlinkPersonAction` in [`actions.ts`](../../app/shifts/actions.ts) — **DONE**. Both `requireAdmin()`; link validates `personId` (`requireId`) + `clerkUserId` (new `requireNonEmpty`); call Task 2 queries; `revalidatePath`.
  - TDD: new `app/shifts/actions.test.ts` (5 tests) — admin links/unlinks; **member rejected** on both; malformed input rejected. Added a temp-**file** DB (transaction gotcha) + `@/` alias to `vitest.config.ts` (Server Actions import via `@/lib/...`). **Verify:** ✅ full suite 71 green; `tsc` clean.
- [x] **Task 5 (M):** Admin People-page UI ([`people/page.tsx`](../../app/shifts/people/page.tsx)) — **DONE**. Added an admin-only "Linked account" column: per-person `<select>` of `listOrgMembers()` (defaulting to the current link) + "Link" (→ `linkPersonAction`), and an "Unlink" button when linked (→ `unlinkPersonAction`). A prior link to someone no longer in the org still shows ("… (not in org)"). Page now sources `listPeopleWithUserLinks(teamId)`; link UI gated on new `isAdmin()`.
  - **Added `isAdmin()` to [`lib/auth.ts`](../../lib/auth.ts)** (non-throwing role check for role-aware _rendering_; authz still `requireAdmin()` in the action) + 2 TDD tests in `auth.test.ts`.
  - **Acceptance:** ✅ admin sees the dropdown per person, can link/unlink, UI reflects current `clerk_user_id`; non-admins see no link column.
  - **Verify:** ✅ `pnpm build` compiles `/shifts/people` as `ƒ (Dynamic)`; `tsc` clean; suite 73 green. ⚠️ Interactive click-through deferred to human check — in-app browser blocks `localhost` and dev Clerk needs phone/email OTP (same limitation as db-init authed checks).

## Checkpoint: Admin linking works ✅ (build-verified; interactive = human check)

- [x] Admin can link/unlink a person ↔ Clerk member (queries + actions tested end-to-end; page build-verified); member cannot invoke link actions (`requireAdmin` — tested); isolation + relink covered by tests. **(Clean PR-A boundary.)**
- [ ] Human check: sign in as admin → /shifts/people → link a person to a member, reload persists, unlink clears.

## Phase 3: Member self-service slice

- [x] **Task 6 (S):** `personForUser` + auth resolvers — **DONE**. `personForUser(teamId, clerkUserId)` in [`queries.ts`](../../lib/db/queries.ts) (team-scoped, returns `id | undefined`). `currentPersonId(): number | null` (for rendering) and `requireLinkedMember(): { teamId, personId }` (throws if unlinked) in [`lib/auth.ts`](../../lib/auth.ts), both deriving the person server-side from `auth().userId` + `resolveTeamId`.
  - TDD: 1 query test (resolves / undefined for unlinked / not across teams) + 5 auth tests (currentPersonId linked→id, unlinked→null; requireLinkedMember linked→{team,person}, unlinked→throw, signed-out→throw). **Verify:** ✅ 79 suite green; `tsc` clean. (No import cycle: queries.ts doesn't import auth.ts.)
- [x] **Task 7 (S):** `toggleMyUnavailabilityAction` — **DONE** ([`actions.ts`](../../app/shifts/actions.ts)). `requireLinkedMember()` sources the caller's own `personId`; **rejects when the form `personId` ≠ the resolved own person**; then reuses `setUnavailable()`.
  - TDD (in `actions.test.ts`): linked member toggles own date ✅; **spoofed `personId` → rejected, no write** ✅; unlinked member → refused ✅; marking unavailable on an assigned date leaves the assignment intact and `computeViolations` warns (D4) ✅. **Verify:** ✅ full suite 83 green; `tsc` clean.
- [x] **Task 8 (M):** Role-aware People page — **DONE** ([`people/page.tsx`](../../app/shifts/people/page.tsx)). Restructured into `AdminView` (unchanged full grid + linking) and `MemberView` (own row only → `toggleMyUnavailabilityAction`; unlinked → "ask an admin to link you" notice, read-only). Extracted a shared `UnavailabilityToggle` (action injected) so admin and member reuse one control; inactive person keeps the disabled-toggle behavior (spec Q2).
  - **Acceptance:** ✅ member view scoped to own row; unlinked = read-only notice; admin unchanged. Other people's constraint data stays server-side (only the member's own cells render).
  - **Verify:** ✅ `pnpm build` compiles `/shifts/people` (`ƒ Dynamic`); `tsc` clean; suite 83 green. ⚠️ Interactive member/admin click-through = human check (localhost blocked in-app + dev Clerk OTP).

## Checkpoint: Member self-service works ✅ (build-verified; interactive = human check)

- [x] Linked member edits only their own availability; **spoofed `personId` rejected by the action** (tested); unlinked member read-only; admin unchanged; regression suite green (83). **(PR-B boundary.)**
- [ ] Human check: sign in as a linked member → /shifts/people → toggle own availability, see it in the week's violations; confirm no other rows editable.

## Phase 4: Docs + deploy

- [x] **Task 9 — docs (DONE):** Wrote [`0003-member-self-availability.md`](../../docs/decisions/0003-member-self-availability.md) (records the admin-set `people.clerk_user_id` link, the first `requireMember()` write, alternatives rejected: email-match / self-claim). Updated [`architecture.md`](../../docs/architecture.md) three nuances ("No `users` table" now notes the optional link; `requireMember()` read-only exception; `lib/auth.ts` gains `requireLinkedMember()`/`currentPersonId()`). Added an "amended in part by ADR-0003" pointer to [ADR-0002](../../docs/decisions/0002-auth-clerk-org-multitenancy.md).
- [~] **Task 9 — deploy (touches production):** hosted migration ✅ done; deploy ⛔ pending.
  - [x] **Hosted Turso migrated (2026-07-14):** pulled prod creds (`vercel env pull --environment=production`), applied `0002_ambitious_bromley.sql`; verified `people` has `clerk_user_id` + `people_clerk_user_id_unique` on the hosted DB. Pulled `.env.production.local` deleted after (no prod secrets left on disk).
  - [ ] **Deploy code to Vercel prod** — `vercel --prod` (or git push if git-connected). _Not yet done:_ the CLI deploy was blocked by the safety classifier in this session; user to run it (or explicitly authorize).
  - **Ordering:** migrate hosted Turso **first**, _then_ deploy the code. The column is additive/nullable so old code ignores it; deploying code first would leave a window where the app queries a column the DB lacks ("no such column"). Migrations are NOT automatic — Vercel deploys code only (see [architecture.md](../../docs/architecture.md), [ADR-0001](../../docs/decisions/0001-persistence-turso-drizzle.md)).
  - **Local `dev.db`:** already migrated during Task 1 (`pnpm db:migrate` → `drizzle/0002_ambitious_bromley.sql`).
  - **Hosted Turso — how:** `drizzle.config.ts` loads `.env.local` (local `file:` DB), so override the target inline for this one command (inline env wins; dotenv won't overwrite already-set vars):
    ```bash
    vercel env pull .env.production.local            # fetch TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
    TURSO_DATABASE_URL="libsql://<db>.turso.io" \
    TURSO_AUTH_TOKEN="<token>" \
    pnpm db:migrate
    ```
    Idempotent — drizzle tracks applied migrations in `__drizzle_migrations`, so re-running only applies what's new.
  - **Verify:** hosted migrate clean (optionally inspect via `pnpm db:studio` with the same inline env); then browser check as admin (link a member) then as that member (toggle own availability).

## Phase 5: Test hardening (/test)

- [x] **Hardening pass — DONE.** Added 2 Prove-It tests locking security/tenancy properties the acceptance criteria implied but didn't explicitly cover: (1) member toggle rejects a **missing/malformed `personId`** fail-closed; (2) `linkPersonAction` **cannot link a person from another team** (action-level tenancy no-op). Mutation-verified the own-person guard: removing it turns exactly the spoofed-`personId` + missing-`personId` tests red, then restored. Suite **85 green**; `tsc` clean.

## Phase 6: Review + fixes (/review, /code-simplify)

- [x] **/review** — 5-axis; 1 Important (I-1: cross-team write in `linkPersonToUser`), 3 suggestions, no critical.
- [x] **I-1 fixed** — team-scoped the relink clear + catch global-unique → crafted cross-team `clerkUserId` fails closed instead of clearing/stealing another team's link. Prove-It test added (RED→GREEN); within-team relink intact.
- [x] **/code-simplify** — extracted `callerTeamAndPerson()` in auth.ts; de-nested member-view `me` lookup. Behavior-preserving.

## Checkpoint: Complete (code + docs + tests + review done; deploy code + human checks pending)

- [x] Both flows implemented, tested (86 green, incl. mutation-verified guard + cross-team-link fix), build-verified; docs/ADR landed.
- [x] Hosted Turso migrated (see Task 9 deploy).
- [ ] Deploy: hosted Turso migrated + deployed (USER).
- [ ] Human checks: admin link flow; member self-toggle flow.
- [ ] Ready for /test and /review.
