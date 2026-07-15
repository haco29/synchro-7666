# Implementation Plan: Member self-service availability — `synchro-7666`

- **Branch:** `member-self-availability`
- **Spec:** [spec.md](spec.md)
- **Date:** 2026-07-14
- **Status:** Draft — pending user approval

## Overview

Give a Clerk **member** a single narrow write — toggling **their own** `unavailable_date`
constraints — without any other admin power. Built on a new admin-set link
(`people.clerk_user_id`) that, for the first time, ties a Clerk identity to a schedulable `people`
row (see [spec.md](spec.md) D1–D6).

The work splits into two independently valuable vertical slices with a checkpoint between them:

1. **Admin linking** (Phase 2) — an admin can link/unlink a person to a real Clerk org member.
   Delivers a complete path (schema → query → Clerk member list → action → UI) and establishes the
   links the next slice needs.
2. **Member self-service** (Phase 3) — a linked member can toggle their own availability; unlinked
   members stay read-only.

## Architecture Decisions

- **The link is an explicit column, admin-set.** `people.clerk_user_id` (TEXT, unique, nullable).
  Null = roster-only/unlinked. No email-matching, no self-claim (spec D1).
- **The caller's person is derived server-side, never trusted from the form.** A new
  `currentPersonId()` in [`lib/auth.ts`](../../lib/auth.ts) resolves `auth().userId` +
  `currentTeam()` → the linked `people.id`. The member action rejects any `personId` that isn't the
  resolved one — mirroring the existing "never trust `team_id` from client" invariant.
- **Authorization changes, the mutation does not.** The member toggle reuses the existing
  `setUnavailable()` query after the own-person check. The difference from the admin path is *who is
  allowed*, not *what is written*.
- **The query layer stays Clerk-free and unit-testable.** Query functions take `teamId`/`personId`
  as parameters (as today); only `lib/auth.ts` touches Clerk. The Clerk **member-list** read is
  isolated in a new server-only `lib/clerk/members.ts` so the admin UI has one seam to mock/test.
- **De-risk the new Clerk Backend dependency first.** The app has only ever read the *current
  caller's* session. `clerkClient().organizations.getOrganizationMembershipList` is new surface —
  Phase 0 verifies its availability and shape before anything is built on it (fail-fast, mirroring
  db-init's Clerk×Next spike).

## Dependency Graph

```text
Phase 0: verify clerkClient org-membership API (fail-fast) ──┐
                                                             │
Phase 1 / Task 1: schema.ts + people.clerk_user_id migration │  (contract — all below need it)
   │                                                         │
   ├── Phase 2 (Admin linking slice)                         │
   │     Task 2: queries linkPersonToUser/unlinkPerson (+tests)
   │     Task 3: lib/clerk/members.ts (needs Phase 0) ───────┘
   │     Task 4: link/unlink Server Actions (requireAdmin) — needs 2
   │     Task 5: admin People-page dropdown UI — needs 3 + 4
   │        │
   │   ── CHECKPOINT: admin can link/unlink ──
   │        │
   └── Phase 3 (Member self-service slice) — needs Task 1; links from Phase 2 to demo
         Task 6: personForUser query + currentPersonId()/requireLinkedMember (+tests)
         Task 7: toggleMyUnavailabilityAction (requireMember + own-person) (+tests) — needs 6
         Task 8: role-aware People page (member = own row; unlinked = read-only) — needs 7
            │
        ── CHECKPOINT: member self-service works ──
            │
Phase 4 / Task 9: ADR-0003 + architecture.md invariant updates; hosted migrate + deploy verify
```

Parallelizable: Phase 0 runs alongside Task 1. Within Phase 2, Task 2 and Task 3 are independent
(different files) and can proceed in parallel; both feed Task 4/5.

## Testing Strategy (per task)

Every logic task is TDD (RED→GREEN) against the in-memory libSQL + stubbed Clerk `auth()` pattern
already established in [`lib/auth.test.ts`](../../lib/auth.test.ts) and
[`queries.test.ts`](../../lib/db/queries.test.ts). The Clerk **member-list** helper is mocked at its
module seam. The pre-existing suite (56 green) is the regression guard and must stay green.

## PR strategy

Reviewable as **one PR**, but the Phase 2/3 checkpoint is a clean split if you'd prefer two smaller
PRs: **PR-A = admin linking** (Phases 0–2), **PR-B = member self-service** (Phase 3), with docs/
deploy (Phase 4) folded into whichever lands last. Recommend one PR unless review size is a concern.

## Risks

- **Clerk member-list API shape** — resolved by Phase 0; if unavailable in `@clerk/nextjs@7.5.17`,
  fall back to admin pasting a Clerk user id (spec Q via boundary "ask first") — stop and confirm.
- **`clerk_user_id` uniqueness scope** — global-unique now (safe under one-org-per-user); flagged as
  spec Open Question Q1. A move to `UNIQUE(team_id, clerk_user_id)` later is a follow-up migration.
- **Relink/duplicate** (spec Q4) — leaning last-write-wins; confirmed in Task 4 acceptance criteria.

## SDLC Command Coverage
- [x] /spec completed
- [x] /plan completed
- [x] /build completed (Tasks 0–8 + Task 9 docs; **hosted Turso migrated ✅**; code deploy happens on PR merge to main — Vercel git integration)
- [x] /test completed (2 Prove-It hardening tests: fail-closed member toggle + action-level link tenancy; own-person guard mutation-verified; 85 green)
- [x] /review completed (5-axis; 1 Important: cross-team write in linkPersonToUser [queries.ts:146] — clear-prior-holder not team-scoped; 3 suggestions. No critical.)
  - **I-1 FIXED** (Prove-It): team-scoped the clear + catch global-unique so a crafted cross-team `clerkUserId` fails closed (no steal). New query test "does not clear or steal a link held in another team"; within-team relink regression intact; 86 green. S-1/S-3 left as accepted; S-2 partially eased in /code-simplify.
- [x] /code-simplify completed (extracted `callerTeamAndPerson()` in auth.ts to de-dup the currentPersonId/requireLinkedMember preamble; de-nested the member-view `me` lookup in people/page.tsx; behavior-preserving, 85 green. Did NOT touch I-1 — that's a behavior fix, still open.)
- [x] /pr opened — [PR #3](https://github.com/haco29/synchro-7666/pull/3) (via GitHub as `haco29`).
- [x] CodeRabbit review addressed: **①** inactive-member enforced server-side (`isPersonActive` guard + test); **②** `linkPersonAction` validates `clerkUserId` is an org member (+ test); **⑤** actions.test teardown (close client + rm temp dir); **⑥** these records reconciled. **③/④** (composite `(team_id, clerk_user_id)` unique) = spec **Q1**, deliberately deferred (documented in ADR-0003). Suite **88 green**.

## Current state
Feature complete; all gates green (88 tests, tsc/build clean). Hosted DB migrated. Remaining: merge PR #3 (→ auto-deploy) + two human click-throughs (admin links a member → member self-toggles).
