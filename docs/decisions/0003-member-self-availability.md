# ADR-0003: Member self-service availability via an admin-set person↔user link

## Status
Accepted

## Date
2026-07-14

## Context
[ADR-0002](0002-auth-clerk-org-multitenancy.md) established two deliberate positions:
- **No `users` table** — Clerk owns identity; `people` are schedulable *subjects*, a separate
  concept from Clerk users, with no link between them.
- **Roles are binary** — `org:admin` mutates everything; a member (`org:member`) is a read-only
  viewer.

A new requirement breaks the second position and forces a crack in the first: a **member should be
able to manage their own unavailability** (and only their own) without any other admin power. To do
that, the app must answer a question it previously couldn't — *which `people` row is this
logged-in member?* — because a member authenticates as a Clerk `userId` while the roster is just
names.

## Decision
Add an **explicit, admin-set link** from a person to a Clerk user, and a single narrow member write
on top of it.

- **`people.clerk_user_id`** (TEXT, unique, nullable). NULL = unlinked / roster-only. Globally
  unique; SQLite treats NULLs as distinct, so multiple unlinked people coexist. An admin sets the
  link from a dropdown of the org's real Clerk members
  (`clerkClient().organizations.getOrganizationMembershipList`, wrapped server-only in
  `lib/clerk/members.ts`).
- **The caller's person is derived server-side, never from the client.** `currentPersonId()` /
  `requireLinkedMember()` (`lib/auth.ts`) resolve `auth().userId` + `currentTeam()` →
  `people.clerk_user_id`. The self-service action (`toggleMyUnavailabilityAction`) **rejects** a
  form `personId` that isn't the resolved own person — the same "never trust client input" rule
  that already governs `team_id`.
- **Member write scope is exactly one thing:** toggling their own `unavailable_date` constraints.
  No assignments, roster, activation, or publish. The mutation reuses `setUnavailable()`; only the
  *authorization* differs from the admin path.
- **Unlinked members stay read-only** (unchanged from ADR-0002). Relinking a Clerk user moves the
  link (last-write-wins). No time cutoff: a member may edit any date; conflicts with an existing
  assignment surface as the existing non-blocking violation warnings and never auto-remove a seat.

## Alternatives Considered

### Match member → person by email
- Pro: no admin step, no new column semantics.
- Rejected: couples identity to a mutable attribute, breaks if a person's roster name/email drift,
  and makes the link implicit and hard to audit. An explicit column is auditable and stable.

### Self-claim (member picks their own name on first login)
- Pro: no admin work.
- Rejected: lets a member assert who they are — the opposite of the "derive identity server-side,
  never trust the client" invariant. Admin-set keeps the mapping authoritative.

### Widen member writes generally / add a third role
- Rejected as scope creep. The requirement is precisely "own unavailability"; a minimal capability
  is easier to reason about and to keep safe.

## Consequences
- **`people` now carries a Clerk link — but is still not a `users` table.** Identity and membership
  remain Clerk's; `clerk_user_id` is only a pointer for the one member-write path. Most `people`
  rows are unlinked and scheduled normally.
- **`requireMember()` viewers now have one real (self-scoped) write** via `requireLinkedMember()`.
  The proxy-plus-in-action-recheck rule is unchanged and is what keeps it safe: the action resolves
  the person server-side and refuses a mismatch.
- **New Clerk Backend dependency.** Reading the org member list is the first use of
  `clerkClient()` beyond the current caller's session. Isolated in `lib/clerk/members.ts`; caps at
  one page of 100 members for now (logged as a known limit).
- **`clerk_user_id` is globally unique.** Safe under ADR-0002's one-org-per-user model. If a user
  ever belongs to multiple orgs, this must become `UNIQUE(team_id, clerk_user_id)` — a follow-up
  migration. Tracked in the branch spec's Open Questions.
- **Migrations are not automatic** (per ADR-0001 / architecture.md): the `clerk_user_id` migration
  must be applied to hosted Turso separately at deploy.
