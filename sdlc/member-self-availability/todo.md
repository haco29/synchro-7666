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
- [ ] **Task 5 (M):** Admin People-page UI ([`people/page.tsx`](../../app/shifts/people/page.tsx)): per-person link control — dropdown of Task 3 members (showing current link), submitting Task 4 actions; "linked as …" indicator + unlink.
  - **Acceptance:** admin sees the member dropdown per person, can link and unlink, UI reflects the current `clerk_user_id`.
  - **Verify:** `pnpm dev` + browser — as admin, link a person to a Clerk member, reload, confirm persisted; unlink clears it. Screenshot.

## Checkpoint: Admin linking works ✅
- [ ] Admin can link/unlink a person ↔ Clerk member end-to-end; member cannot invoke link actions; isolation + relink covered by tests. **(Clean PR-A boundary.)**

## Phase 3: Member self-service slice
- [ ] **Task 6 (S):** `personForUser(teamId, clerkUserId)` query + `currentPersonId()` / `requireLinkedMember()` in [`lib/auth.ts`](../../lib/auth.ts) (resolve caller's linked `people.id` from `auth().userId` + `currentTeam()`). TDD in `auth.test.ts` + `queries.test.ts`.
  - Tests: resolves the linked person; returns none/throws for an unlinked member; team-scoped (a `userId` linked in team A never resolves in team B).
  - **Verify:** `pnpm test`, `tsc --noEmit`.
- [ ] **Task 7 (S):** `toggleMyUnavailabilityAction` in [`actions.ts`](../../app/shifts/actions.ts) — `requireMember()`, resolve own person via `currentPersonId()`, **reject if the form `personId` ≠ resolved own person**, then reuse `setUnavailable()`. TDD.
  - Tests: linked member toggles own date (success); same member submitting a **different** `personId` is **rejected**; unlinked member is refused; adding unavailability on an assigned date leaves the assignment intact (D4 — assert `computeViolations` warns, row unchanged).
  - **Verify:** `pnpm test`, `tsc --noEmit`.
- [ ] **Task 8 (M):** Role-aware People page ([`people/page.tsx`](../../app/shifts/people/page.tsx)): a **member** sees only their own linked row with unavailability toggles wired to Task 7; **unlinked** member sees read-only (no editable row); **admin** sees the full grid unchanged. Inactive linked member follows existing disabled-toggle behavior (spec Q2 leaning).
  - **Acceptance:** member view scoped to own row; unlinked = read-only; admin unchanged.
  - **Verify:** `pnpm dev` + browser — sign in as a linked member, toggle own availability, confirm it appears in the week's violations; confirm no other rows are editable. Screenshot both member and admin views.

## Checkpoint: Member self-service works ✅
- [ ] Linked member edits only their own availability (spoofed `personId` rejected by the action); unlinked member read-only; admin unchanged; regression suite green. **(PR-B boundary.)**

## Phase 4: Docs + deploy
- [ ] **Task 9 (S):** Write [`docs/decisions/0003-member-self-availability.md`](../../docs/decisions/0003-member-self-availability.md) (amends ADR-0002 — first identity↔subject link + first `requireMember()` write). Update [`architecture.md`](../../docs/architecture.md) invariant nuances ("No `users` table" + `requireMember()` lines). Apply the Task 1 migration to **hosted Turso** (`pnpm db:migrate`); deploy; verify link + member-toggle on the deployed app.
  - **Acceptance:** ADR + doc updates committed; hosted DB migrated; deployed app exercises both flows.
  - **Verify:** hosted `db:migrate` clean; browser check on `synchro-7666.vercel.app`.

## Checkpoint: Complete
- [ ] Both flows work on the deployed app under Clerk auth; docs/ADR landed; full suite green.
- [ ] Ready for /test and /review.
