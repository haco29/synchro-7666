# ADR-0003: Member self-service availability via an admin-set person↔user link

## Status

Accepted

## Date

2026-07-14

## Context

[ADR-0002](0002-auth-clerk-org-multitenancy.md) established two deliberate positions:

- **No `users` table** — Clerk owns identity; `people` are schedulable _subjects_, a separate
  concept from Clerk users, with no link between them.
- **Roles are binary** — `org:admin` mutates everything; a member (`org:member`) is a read-only
  viewer.

A new requirement breaks the second position and forces a crack in the first: a **member should be
able to manage their own unavailability** (and only their own) without any other admin power. To do
that, the app must answer a question it previously couldn't — _which `people` row is this
logged-in member?_ — because a member authenticates as a Clerk `userId` while the roster is just
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
  _authorization_ differs from the admin path. _(Widened 2026-07-15 to per-shift and whole-week
  availability — see the Amendment below. The scope is still "own availability only".)_
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

## Amendment (2026-07-15): per-shift availability + whole-week block

The `shifts-update` branch widened availability from a single whole-day concept to two constraint
kinds, and grew the member self-service surface accordingly. The core decision above is unchanged —
identity is still resolved server-side and a member may still edit **only their own** availability.

- **Two constraint kinds** (`constraints.kind`, free TEXT — no migration):
  - `unavailable_date`, value `YYYY-MM-DD` — off the **whole day** (ineligible for every slot,
    including kitchen and backup). Unchanged; existing rows keep this meaning.
  - `unavailable_shift`, value `YYYY-MM-DD:<shift>` — off **one time-shift** (morning/evening/night)
    only; the person stays eligible for the other shifts, kitchen, and backup.
- **Member write scope is now three self-only mutations**, all guarded exactly as the original
  `toggleMyUnavailabilityAction` (resolve own person via `requireLinkedMember()`, reject a
  mismatched `personId`, refuse inactive members):
  - `toggleMyUnavailabilityAction` → `setUnavailable()` (whole day, as before),
  - `toggleMyShiftUnavailabilityAction` → `setUnavailableShift()` (one time-shift),
  - `blockMyWeekAction` → `setWeekUnavailable()` (whole-day off across all 7 days of the week — a
    one-click "vacation week"; clearing removes only the whole-day rows, leaving per-shift blocks).
- **No new capability class.** These are still "own availability" writes — no assignments, roster,
  activation, or publish — so the ADR-0002 role model and the proxy-plus-recheck rule are intact.
  The admin equivalents (`toggleShiftUnavailableAction`, `blockWeekAction`) sit behind
  `requireAdmin()` like the rest of the admin surface.

## Amendment (2026-07-23): backup becomes a mid-day 10:00–17:00 on-call shift

Backup was a whole-day "rest / on-call" designation; it is now a lighter mid-day on-call shift,
**10:00–17:00**, overlapping the morning shift and the front of the evening shift. It still does not
count toward weekly workload, still balances on its own history, and still fills last (so it is what
gaps when a day is short-staffed). Only two limitations change how availability gates it. This also
supersedes the earlier note that a per-shift block leaves a person eligible for kitchen/backup:

- **Availability gate.** Kitchen still needs the **whole day** free (any per-shift block disqualifies
  it). Backup, because it spans only morning and evening, is ruled out **only** by a morning or
  evening block — a **night-only** block leaves a person eligible for backup. A whole-day off still
  blocks everything.
- **After a night shift.** Whoever worked the previous night (ends 07:00) is now barred from backup
  (starts 10:00) too, alongside the existing morning/kitchen bars — three hours is no real rest. In a
  tight roster this can strand the post-night person and leave the (lowest-priority) backup slot
  empty; that is accepted — the four work shifts are always staffed first.

Both rules live in `lib/scheduler/generate.ts` (generation) and `lib/scheduler/violations.ts` (the
post-edit warning check, which gains a `backup_after_night` violation kind).
