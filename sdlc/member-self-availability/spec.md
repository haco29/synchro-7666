# Spec: Member self-service availability — `synchro-7666`

- **Branch:** `member-self-availability`
- **Date:** 2026-07-14
- **Status:** Draft — pending user approval
- **Author:** harel.coman@verbit.ai

---

## 1. Objective

Let a **member** (Clerk `org:member`) manage **their own unavailability** without giving them
admin powers. Today the authz model is binary: `org:admin` mutates everything, members are pure
read-only viewers (see [ADR-0002](../../docs/decisions/0002-auth-clerk-org-multitenancy.md) and
[`lib/auth.ts`](../../lib/auth.ts)). This spec introduces a **narrow, self-scoped write** for
members: toggling their own `unavailable_date` constraints — and nothing else.

The blocker this solves: a member signs in as a Clerk identity (`userId`) but the roster
([`people`](../../lib/db/schema.ts)) has **no link back to a Clerk user**, so the app cannot answer
"which person am I?". This spec adds that link and the minimal write path on top of it.

### Terms (resolved during grilling)

- **Linked member** — a `people` row whose new `clerk_user_id` matches a signed-in Clerk user. The
  only state in which a member has anything to write.
- **Unlinked member** — a signed-in Clerk member not matched to any `people` row. Read-only viewer,
  exactly as members are today.
- **Self-service availability** — the single write a member is granted: toggling _their own_
  `unavailable_date` constraints. No assignments, roster, or publish access.
- **Roster-only person** — a `people` row with no `clerk_user_id` (no Clerk account behind it).
  Scheduled normally by the admin; simply has no self-service until/unless linked.

### Decisions (locked)

| #   | Decision                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Member↔person link** is an explicit, admin-set `people.clerk_user_id` column (nullable, unique). Not email-matched, not self-claimed.                                                                                                                                     |
| D2  | **Member write scope** is _only_ their own `unavailable_date` constraints. No assignments, roster edits, activation, or publish.                                                                                                                                            |
| D3  | **Unlinked signed-in member** is a **read-only viewer** (sees schedule, edits nothing) until an admin links them. No new wall.                                                                                                                                              |
| D4  | **No time cutoff** — a member may toggle any date (past/future, published or not). Conflicts surface via the existing non-blocking amber warnings for the admin; adding a constraint never auto-removes an assignment.                                                      |
| D5  | **Admin links via a dropdown of real Clerk org members** (`clerkClient().organizations.getOrganizationMembershipList`). Roster-only people with no Clerk account stay unlinked; **no invite flow** in this scope.                                                           |
| D6  | **Member surface is the role-aware People page** — a member sees only their own linked row; an admin sees the full grid. A **new `requireMember()`-scoped Server Action** resolves the caller's linked person **server-side** and rejects any `personId` that isn't theirs. |

### Target users

- **Admin/editor** (`org:admin`) — unchanged powers; additionally can **link/unlink** a person to a
  Clerk org member.
- **Linked member** (`org:member` with `clerk_user_id` set) — can toggle **their own** unavailability.
- **Unlinked member** (`org:member`, no link) — read-only viewer (unchanged from today).

---

## 2. Commands

No new CLI commands. This is a schema change (one column) + auth/UI work, so the existing DB
workflow applies:

| Command            | Purpose                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:generate` | Generate the migration for the new `people.clerk_user_id` column.                                                                                                                  |
| `pnpm db:migrate`  | Apply the migration to **each** target DB (local `dev.db` **and** hosted Turso) separately — migrations are **not** automatic (per [architecture.md](../../docs/architecture.md)). |
| `pnpm dev`         | Run locally to exercise both admin-link and member-toggle flows.                                                                                                                   |
| `pnpm test`        | Run the auth + query unit tests (see §5).                                                                                                                                          |

---

## 3. Project Structure

Changed/added files (scope, not built in this spec):

```
synchro-7666/
├── lib/
│   ├── db/
│   │   ├── schema.ts        # + people.clerk_user_id (TEXT, unique, nullable)
│   │   └── queries.ts       # + linkPersonToUser(), personForUser(); constraint writes stay team-scoped
│   └── auth.ts              # + currentPersonId()/requireLinkedMember(): resolve caller's linked person server-side
├── app/shifts/
│   ├── actions.ts           # + toggleMyUnavailabilityAction (requireMember + own-person check);
│   │                        #   + linkPersonAction / unlinkPersonAction (requireAdmin)
│   └── people/page.tsx      # role-aware: member sees only own row; admin sees full grid + link dropdown
├── lib/clerk/
│   └── members.ts           # (new) server-only helper wrapping getOrganizationMembershipList
├── drizzle/
│   └── 000N_*.sql           # generated migration (committed)
└── docs/decisions/
    └── 0003-member-self-availability.md   # ADR amending 0002 (see §8)
```

### Schema change

- **`people`** — add `clerk_user_id` (TEXT, **unique**, nullable). Null = roster-only / unlinked.
  Unique so a Clerk user maps to at most one person **per team** (the column lives on a team-scoped
  row; enforce per-team uniqueness — see Open Question Q1).

No other tables change. `constraints` continues to key unavailability by `person_id` + `value`
(date), exactly as today.

---

## 4. Code Style

Follows the existing invariants in [architecture.md](../../docs/architecture.md) — this feature is
a direct test of them:

- **Never trust `personId` from client input.** The member toggle action derives the caller's
  person **server-side** from their Clerk `userId` (`currentPersonId()`), and rejects a mismatch —
  the form's `personId` is a convenience/optimistic value, never the trust source.
- **Team-scope every query.** The member↔person lookup is scoped by `currentTeam()`; a member can
  only ever resolve to a person in their own team.
- **Re-check authz inside every Server Action.** `toggleMyUnavailabilityAction` calls
  `requireMember()`; `linkPersonAction`/`unlinkPersonAction` call `requireAdmin()`. The proxy alone
  is insufficient (POST-reachable).
- **Reuse, don't fork, the write path.** Member toggle reuses `setUnavailable()` after the
  own-person check — the difference is _authorization_, not the mutation.
- **Clerk member list is server-only.** `getOrganizationMembershipList` runs in a server context;
  no membership data reaches the client bundle beyond what the link dropdown renders.

---

## 5. Testing Strategy

- **Own-person enforcement (core):** a linked member toggling their _own_ date succeeds; the same
  member submitting a **different** `personId` is rejected — even though the form field says
  otherwise (stubbed Clerk `auth()` → known `userId`).
- **Unlinked member:** a signed-in member with no `clerk_user_id` gets read-only behavior — the
  toggle action refuses; the People page renders no editable row for them.
- **Admin unchanged:** `org:admin` can still toggle any person and can link/unlink.
- **Link resolution:** `personForUser(teamId, userId)` returns the correct person and is
  team-scoped — a `userId` linked in team A never resolves in team B (cross-tenant isolation).
- **Link mutation:** `linkPersonToUser` sets the column; re-linking a user already linked to another
  person is handled per the uniqueness rule (Q1); unlink clears it.
- **No auto-removal (D4):** adding unavailability on a date the member is assigned to leaves the
  assignment intact and produces the existing amber violation — assert `computeViolations` picks it
  up, assignment row unchanged.
- **Migration round-trip:** the new column applies cleanly to a fresh libSQL DB; `db:generate`
  reports no drift.

---

## 6. Boundaries

### Always

- Derive the caller's person from Clerk **server-side**; reject a `personId` that isn't the
  caller's own in the member action.
- Team-scope the member↔person lookup via `currentTeam()`.
- Commit the generated migration; run `db:migrate` against local **and** hosted Turso separately.
- Keep member write scope to `unavailable_date` constraints only.

### Ask first

- Widening member write scope beyond their own unavailability (e.g. self-rename, self-deactivate).
- Adding an **invite** flow (roster-only person → Clerk invitation) — explicitly out of scope now.
- Any per-team-uniqueness resolution for `clerk_user_id` that needs a composite index / destructive
  migration (Q1).
- Changing the linking mechanism away from admin-set explicit link (D1).

### Never

- Trust a `personId`, `team_id`, or role from client input.
- Let a member mutate anyone's data but their own unavailability.
- Let an unlinked member write anything.
- Expose Clerk member PII beyond the admin link dropdown, or leak it to the client bundle
  unnecessarily.
- Auto-remove an assignment when a member marks unavailable (D4 — warnings only).

### Risks / assumptions

- **`getOrganizationMembershipList` is a new Clerk Backend API dependency.** The app has only ever
  read the _current caller's_ session until now. Assumes `clerkClient()` server usage is available
  in `@clerk/nextjs@7.5.17`; verify against `node_modules/@clerk/nextjs` before building.
- **Column uniqueness scope.** `clerk_user_id` unique _globally_ vs _per team_ differs if the app
  ever allows one Clerk user in multiple orgs. Current model is one-org-per-user (ADR-0002), so
  global-unique is safe today; Q1 tracks the per-team refinement.

---

## 7. Success Criteria

1. `people.clerk_user_id` exists (nullable, unique), migrated on local **and** hosted Turso.
2. An admin can **link** a person to a real Clerk org member via a dropdown, and **unlink** them.
3. A **linked member** can toggle their **own** unavailability from the People page and see it
   reflected in the schedule/violations.
4. A member submitting a `personId` that isn't their own is **rejected** by the Server Action
   (verified by test, not just UI).
5. An **unlinked** signed-in member has full read-only behavior — no editable availability, no
   accidental write path.
6. Admin capabilities are **unchanged** (still edit/publish/manage everyone).
7. No `personId`/`team_id`/role is ever trusted from client input; all derived server-side.
8. Adding unavailability never silently removes an assignment (D4).

---

## 8. Open Questions

1. **`clerk_user_id` uniqueness scope.** Global-unique column vs `UNIQUE(team_id, clerk_user_id)`.
   Global is simplest and safe under one-org-per-user (ADR-0002); flag if multi-org-per-user ever
   lands. **Recommend:** global-unique now, revisit with multi-org.
2. **Inactive linked member (`active: false`).** Can they still edit their own future
   unavailability, or is their row locked like the admin grid locks inactive people today
   ([people/page.tsx](../../app/shifts/people/page.tsx) disables toggles when `!p.active`)?
   **Leaning:** mirror existing behavior — locked when inactive.
3. **Unlink UI.** Does clearing `clerk_user_id` need a visible control now, or is set-only enough for
   v1 with unlink deferred? **Leaning:** include a simple unlink in the same dropdown.
4. **Duplicate/relink.** If an admin links a Clerk user already linked to another person, do we move
   the link (relink) or block? Tied to Q1. **Leaning:** move (last-write-wins) with the unique
   column reassigned.

## 9. Related docs

- Amends [ADR-0002: Clerk auth with Organization-based multi-tenancy](../../docs/decisions/0002-auth-clerk-org-multitenancy.md).
- Proposed **ADR-0003: Member self-service availability** — records the first identity↔subject link
  (`people.clerk_user_id`) and the first real write capability for `requireMember()`. Passed the ADR
  test during grilling (hard to reverse: schema + authz model; surprising vs ADR-0002's "no users
  table / members are viewers"; real alternatives — email-match, self-claim — rejected).
- Invariant nuances to update in [architecture.md](../../docs/architecture.md) once built: the
  "No `users` table" line (people now carry a Clerk link but are still not app users) and the
  `requireMember()` line (viewers can now self-service their own availability).
