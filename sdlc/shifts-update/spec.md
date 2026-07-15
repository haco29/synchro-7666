# Spec — Shifts model + availability update

Branch: `shifts-update`
Status: Draft (spec-driven-development)
Date: 2026-07-15

## Objective

Four related changes to the scheduling model, its fairness, and how availability is expressed:

1. **Daily staffing model** — from 7 people/day to **5 people/day**, one per role: morning,
   evening, night, kitchen, **backup**.
2. **Backup = rotating rest / on-call** with a fair, unbiased rotation.
3. **Per-shift availability** — availability is expressed per time-shift
   (morning/evening/night), not per whole day, plus a whole-day "off" and a one-click "block the
   whole week".
4. **Week starts Wednesday** instead of Sunday.

---

## 1 & 2 — Staffing model + backup fairness

**Today:** each day is staffed by **7 people** — morning ×2, evening ×2, night ×2, kitchen ×1.
Cross-week fairness balances night and kitchen counts; the generator is seeded by `Date.now()`.

**Target:** each day is staffed by **5 people**, exactly one per role:

| Role     | Count | Nature                                                            |
| -------- | ----- | ---------------------------------------------------------------- |
| morning  | 1     | working shift                                                    |
| evening  | 1     | working shift                                                    |
| night    | 1     | working shift                                                    |
| kitchen  | 1     | working duty                                                     |
| backup   | 1     | **rotating rest / on-call** — mostly idle; the person's rest day |

The team is small (**~5–6 people**), so on most days nearly everyone holds one of the five roles
and **backup is effectively each person's rotating rest day**. Larger rosters give surplus people a
full day off (no role); smaller-than-five rosters produce gaps (as today).

The generator must be **fair and free of roster-order bias** — no person (in particular the first
in the roster) may be systematically favored or burdened. Over time it actively balances:

1. **Night shifts** — equal night burden.
2. **Kitchen duty** — equal kitchen burden.
3. **Backup / rest days** — the rest perk rotates evenly.

Backup carries **zero workload weight** (never makes a person "look busy"); its rotation is balanced
only on its own count (dimension 3). On a small team, equal total working load falls out of the
rest rotation, so it is not a separate objective.

### Resolved decisions (staffing/fairness)

- Daily capacity: morning 1, evening 1, night 1, kitchen 1, backup 1 — exact.
- Backup = rotating rest/on-call; not a full shift, not a pure "off" marker. A person on backup is
  **busy that day** (cannot also hold another role).
- Backup workload weight = **zero**; balanced only on its own rotation count.
- Fairness dimensions: night, kitchen, backup/rest. Total-real-shift balance is not separately
  tracked.
- No roster-order bias — hard success criterion, verified by a distribution test.

---

## 3 — Per-shift availability, whole-day off, block-week

**Today:** one constraint kind, `unavailable_date` (value = ISO date) = person off the **whole
day**. `setUnavailable()` toggles it; members self-serve their own via
`toggleMyUnavailabilityAction` ([ADR-0003](../../docs/decisions/0003-member-self-availability.md)).

**Target:** availability is expressed at **shift granularity for the three time-shifts**
(morning/evening/night), plus a whole-day off and a one-click week block.

### Resolved decisions (availability)

- **Per-shift toggles exist only for morning / evening / night.** Kitchen and backup have **no
  separate availability** — a person is eligible for kitchen/backup unless they are marked off the
  **whole day**.
- **"Make unavailable weekly in one click" = block the whole current week** — one action marks the
  person off (whole-day) for all 7 days of the currently-viewed week (a vacation). It is **not** a
  recurring rule. A matching "clear the week" un-blocks it.

### Data model

`constraints.kind` / `value` are free `TEXT` — additive, **no schema migration**. Add a second
kind alongside the existing one:

| Kind                 | Value             | Meaning                                                    |
| -------------------- | ----------------- | ---------------------------------------------------------- |
| `unavailable_date`   | `YYYY-MM-DD`      | Off the **whole day** — ineligible for *every* slot incl. kitchen & backup. (Unchanged; existing rows keep this meaning.) |
| `unavailable_shift`  | `YYYY-MM-DD:<shift>` | Off **one time-shift** (`morning`/`evening`/`night`) — ineligible only for that shift; still eligible for the other shifts, kitchen, and backup. |

`ConstraintKind` union → `"unavailable_date" | "unavailable_shift"`. The value format for
`unavailable_shift` is `date:shift`; the existing unique index
`constraints_person_kind_value_unq(person_id, kind, value)` keeps both kinds distinct.

### Eligibility rules (generator + violations)

For a given `(date, slot, person)`:

- slot ∈ {morning, evening, night}: **ineligible** if `unavailable_shift(date, slot)` **or**
  `unavailable_date(date)` exists for the person.
- slot ∈ {kitchen, backup}: **ineligible** only if `unavailable_date(date)` exists.

Whole-day off is **explicit** (`unavailable_date`); blocking all three shifts individually does
**not** auto-promote to whole-day off (see Open Questions). "Block the whole week" writes
`unavailable_date` for each of the 7 dates.

### Member self-service (ADR-0003)

The member write surface stays "**their own unavailability**", now including per-shift toggles and
block/clear-week. The same server-side own-person guard (`requireLinkedMember()` /
`currentPersonId()`) applies to every new action; a form `personId` that isn't the resolved own
person is rejected, exactly as today. No new role, no widened scope.

---

## 4 — Week starts Wednesday

**Today:** weeks run **Sunday–Saturday**; arbitrary dates snap to the week via `sundayOf()`
(`lib/shifts/week.ts`), and the module comment states "Weeks run Sunday–Saturday".

**Target:** weeks run **Wednesday–Tuesday**. Replace the Sunday anchor with a Wednesday anchor,
expressed as a single named constant (`WEEK_START_DOW = 3`) so the anchor is easy to change or make
configurable later. `weekDates` still returns 7 days from the anchor; `dayLabel`, `historyBefore`
(string `<` compare on `week_start`), and `listConstraintsForWeek` (weekStart..+6) are anchor-
agnostic and need no logic change.

### Resolved decision (week anchor)

- Fixed Wednesday anchor (not per-team configurable in this change).
- Existing Sunday-anchored `weeks` rows are **legacy dev data**: after the switch, week navigation
  is Wednesday-based and won't line up with old Sunday weeks. Acceptable for the current dev
  instance; see Open Questions for whether to migrate or discard them.

---

## Scope

### In scope

- `lib/shifts/types.ts` — add `backup` to `SlotType`; `SLOT_TYPES`, `SLOT_LABELS`, `SLOT_CAPACITY`
  (five roles → 1); add `backupCount` to `PersonHistory`; extend `ConstraintKind` with
  `unavailable_shift`; keep `SHIFT_TYPES` = the three real shifts.
- `lib/shifts/week.ts` — Wednesday anchor (`WEEK_START_DOW`), rename/replace `sundayOf`.
- `lib/scheduler/generate.ts` — per-slot capacity 1; backup fill with dedicated `backupHist`
  balance and **zero** `weekTotal` weight; shift-aware eligibility; keep morning-after-night
  softener; backup marks the person busy for the day.
- `lib/scheduler/violations.ts` — shift-aware unavailable check; backup still occupies the day
  (double-booking rule unchanged).
- `lib/db/queries.ts` — `historyBefore` aggregates `backupCount`; `listConstraintsForWeek` also
  returns `unavailable_shift`; add shift-level and block-week set/clear helpers (extend or
  complement `setUnavailable`).
- `app/shifts/actions.ts` — server actions for per-shift toggle and block/clear-week, admin and
  member (self) variants, each with the ADR-0003 own-person guard.
- UI — availability toggles per shift + a "block/clear whole week" control; `SLOT_LABELS[backup]`;
  fairness panel gains a backup/rest column; components enumerating `SLOT_TYPES` pick up backup —
  verify week view and seat-editor render correctly.
- Tests — scheduler, queries, violations, actions updated; new **no-bias distribution test** and
  per-shift eligibility tests.

### Out of scope

- **Recurring** availability rules (the "weekly one click" is a whole-week block, not recurrence).
- New constraint kinds beyond `unavailable_shift` (e.g. max-nights-per-week, "cannot be backup").
- Per-team configurable week start (anchor is a constant this round).
- Adjacency rules beyond the existing morning-after-night softener.
- Schema column changes / migrations (both `constraints` and `assignments` use free `TEXT`;
  backup + `unavailable_shift` are additive values). Auth/tenancy invariants untouched.

## Data & migration

- **No schema migration required** for backup, `unavailable_shift`, or the Wednesday anchor.
  Confirm during build that no CHECK/enum blocks the new `slot`/`kind` values (verified: none on
  `assignments.slot`).
- Old 7-person weeks and Sunday-anchored weeks remain valid rows; `historyBefore` reports
  `backupCount = 0` for pre-change weeks. Regenerating an old week applies the new model.

## Commands

- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- `pnpm dev` + preview tools to eyeball the week view, availability toggles, and fairness panel.
- **No** `pnpm db:generate` / `db:migrate` expected (no schema change) — re-confirm.

## Code style

Match existing code: TypeScript with explicit exported types; comment-the-why density as in
`generate.ts`/`types.ts`; UTC date-string math via `lib/shifts/week.ts`; server-side tenancy and
own-person guards on every mutation; no new dependencies.

## Testing strategy

1. **Capacity:** each generated day has exactly 5 assignments — one each morning/evening/night/
   kitchen/backup (given ≥5 active people).
2. **One role/day:** no person holds two roles on a date (backup counts as a role).
3. **Backup zero-weight:** backup assignments don't suppress a person's eligibility for real shifts
   on other days relative to peers.
4. **Rest rotation:** over several weeks, backup counts are balanced across people.
5. **Night/kitchen balance** holds under the 1-per-slot model.
6. **No-bias distribution test (new):** many weeks over varied seeds and/or shuffled roster orders
   → per-person night/kitchen/backup counts stay within a small delta and don't correlate with
   roster index (the "not biased to the first user" requirement).
7. **Gaps:** fewer than 5 eligible people on a day → unfillable roles returned as gaps.
8. **`historyBefore`:** correct `backupCount`; pre-change weeks yield `backupCount = 0`.
9. **Per-shift eligibility:** a person off `morning` on a date can still be assigned evening/night/
   kitchen/backup that date; off whole day → assigned nothing.
10. **Block-week:** the action writes whole-day off for all 7 days of the viewed week; clear-week
    removes exactly those; member variant rejects a non-own `personId`.
11. **Week anchor:** `weekStart` snapping lands on Wednesday; `weekDates` spans Wed→Tue; existing
    date/history/constraint queries still behave.

## Boundaries

- **Always:** team-scope via `currentTeam()`; re-check authz in Server Actions
  (`requireAdmin`/`requireMember`, `requireLinkedMember` for self); deterministic-per-seed
  generator; explicit gaps.
- **Ask first:** any schema/migration change; recurring-availability rules; per-team week-start
  config; changing published-week behavior; auth changes.
- **Never:** trust client `team_id`/`personId`/`week`/shift; let a member edit another person's
  availability; hard-delete data; introduce roster-order bias; secrets in code.

## Success criteria

- [ ] Days staffed morning/evening/night/kitchen/backup ×1 (5 total) when the roster allows.
- [ ] Backup is a zero-weight rotating rest role with a balanced rotation.
- [ ] Night, kitchen, and backup burdens balanced over multiple weeks; distribution test proves no
      first-user bias.
- [ ] Availability is per-shift for morning/evening/night; kitchen/backup gated only by whole-day
      off.
- [ ] One-click block/clear of the whole current week works for admin and (own) member.
- [ ] Weeks run Wednesday–Tuesday.
- [ ] No schema migration; old weeks remain valid.
- [ ] `pnpm test`, `typecheck`, `lint`, `build` pass; UI renders backup + per-shift availability.

## Open questions

1. **All-three-shifts vs whole-day.** If a person blocks morning+evening+night individually (but
   not the whole day), should they still be eligible for kitchen/backup? Default: **yes**
   (independent), matching "kitchen/backup gated only by whole-day off". Confirm during build.
2. **Fairness panel:** distinguish **backup (on-call rest)** from a **full day off** (surplus,
   unassigned) when the roster exceeds five? Default: show both, labelled.
3. **Legacy weeks after the anchor switch:** leave old Sunday-anchored weeks as unreachable-by-nav
   dev data, or migrate/discard them? Default: leave as legacy.
4. **5-person team:** with exactly 5 people, everyone is assigned daily and one is always backup
   (no full day off) — confirm acceptable (implied by ~5–6 answer).
5. **ADR:** the availability-granularity change extends ADR-0003's model — worth a short ADR or an
   amendment note during the plan/build phase.

## Known limitations

- **Greedy assignment is not an optimal matching.** The scheduler fills roles greedily (work slots
  first, backup last), so on a short-staffed day with per-shift constraints it can *strand* a
  person: e.g. someone blocked from `evening` is left as the last candidate for `evening` (→ a gap)
  when a different assignment would have placed them in an earlier role and filled every work slot.
  Accepted for now — the team is small (~5–6), gaps are surfaced and manually fixable, and the fix
  (min-cost bipartite matching) is a substantial scheduler rewrite entangled with the fairness
  scoring. Revisit if avoidable gaps become common in practice. (Raised in PR #4 review.)
