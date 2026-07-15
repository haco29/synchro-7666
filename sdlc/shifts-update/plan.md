# Implementation Plan: Shifts model + availability update

## Overview

Four related changes on the `shifts-update` branch (see [`spec.md`](spec.md)): (1) reduce daily
staffing from 7 to 5 people — one each of morning/evening/night/kitchen/**backup**; (2) make backup
a zero-weight, fairly-rotated rest role with no roster-order bias; (3) express availability
per-time-shift (morning/evening/night) instead of per whole day, with kitchen/backup gated only by
a whole-day off; (4) run weeks Wednesday–Tuesday instead of Sunday–Saturday, plus a one-click
"block the whole week" availability action.

Work is sliced into four features. Each task is a complete vertical path (contract → persistence →
engine/UI → test) that leaves the app in a working, shippable state.

## Architecture Decisions

- **No schema migration.** `assignments.slot` and `constraints.kind`/`value` are free `TEXT`;
  `backup` and `unavailable_shift` are additive values. The Wednesday anchor is pure date math. All
  three avoid `db:generate`/`db:migrate` (re-confirmed: no CHECK/enum on `assignments.slot`).
- **Week anchor as a single constant** (`WEEK_START_DOW = 3`) in `lib/shifts/week.ts`, so the
  anchor is trivial to change or make per-team later. `sundayOf` becomes an anchor-based
  `weekStartOf` (keep call sites thin).
- **Two constraint kinds, both explicit.** `unavailable_date` = whole-day off (blocks every slot);
  `unavailable_shift` (value `YYYY-MM-DD:<shift>`) = one time-shift only. Blocking all three shifts
  individually does **not** auto-promote to whole-day off (Open Question #1 default).
- **Backup fairness is a separate balance term** (`backupHist`, lowest-rested wins) with **zero**
  contribution to the work-load total, so rest rotates evenly without making anyone "look busy".
- **Member self-service scope grows but stays self-only.** New per-shift and block-week actions
  reuse the ADR-0003 `requireLinkedMember()` own-person guard; the model change to ADR-0003 is
  recorded (Task 9).
- **Do the anchor change first.** It touches the shared date foundation used by every later slice;
  landing it early avoids re-touching the same call sites.

## Task List

Task descriptions only — no checkboxes. Live status lives in `todo.md`.

### Phase 1: Week anchor (Feature A)

- **Task 1 — Wednesday week anchor + propagation.** Introduce `WEEK_START_DOW = 3` and an
  anchor-based `weekStartOf(date)` in `lib/shifts/week.ts` (replacing `sundayOf`); update the module
  doc comment. Update every caller (`app/shifts/actions.ts` `requireWeekDate`/`clearSlotAction`,
  `app/shifts/week/[start]/page.tsx` canonicalize+redirect, `app/shifts/people/page.tsx` default
  week). Update `lib/shifts/week.test.ts`.
  - *Acceptance:* navigating to any date snaps to the containing Wednesday; prev/next span
    Wed→Tue; `weekDates` returns Wed…Tue; canonical redirect still yields one URL per week.
  - *Verification:* `pnpm test -- week` green; `pnpm typecheck`; manual — open `/shifts`, confirm
    the header reads "Week of Wed … – Tue …".
  - *Dependencies:* None. *Scope:* M (5 files).

### Checkpoint: Week anchor
Tests + typecheck green; app builds; week grid runs Wed→Tue everywhere (week view + people page).

### Phase 2: Staffing model + backup fairness (Feature B)

- **Task 2 — Role model + generator.** `lib/shifts/types.ts`: add `backup` to `SlotType`,
  `SLOT_TYPES`, `SLOT_LABELS`; set `SLOT_CAPACITY` to 1 for all five roles; add `backupCount` to
  `PersonHistory`. `lib/scheduler/generate.ts`: include backup in the fill loop with a dedicated
  `backupHist` balance term (lowest-rested wins) and **zero** `weekTotal` weight; backup marks the
  person busy for the day; keep the morning-after-night softener. `lib/db/queries.ts`:
  `historyBefore` also aggregates `backupCount`. Update `lib/scheduler/generate.test.ts` +
  `lib/db/queries.test.ts`.
  - *Acceptance:* a generated day (≥5 active people) has exactly 5 assignments, one per role incl.
    backup; night/kitchen/backup counts balance over multiple weeks; backup adds 0 to work load;
    fewer than 5 eligible → gaps.
  - *Verification:* `pnpm test -- generate queries` green; `pnpm typecheck`.
  - *Dependencies:* None (independent of Task 1). *Scope:* M (4 files).

- **Task 3 — No-bias distribution test.** Add a test that generates many weeks across varied seeds
  and shuffled roster orders and asserts per-person night/kitchen/backup counts stay within a small
  tolerance and do not correlate with roster index.
  - *Acceptance:* test fails if selection favors `candidates[0]`/roster order; passes for the fair
    engine.
  - *Verification:* `pnpm test -- generate` green; deliberately break the tiebreak locally to see it
    fail (sanity), then revert.
  - *Dependencies:* Task 2. *Scope:* S (1 test file).

- **Task 4 — Backup in the UI.** Add `SLOT_LABELS[backup]` rendering; add a backup/rest column to
  `app/shifts/_components/fairness-panel.tsx`; verify the week view (`week/[start]/page.tsx`) renders
  the backup column and seat editor via `SLOT_TYPES` with no layout break.
  - *Acceptance:* week grid shows 5 role columns incl. Backup; fairness panel shows a rest/backup
    count per person.
  - *Verification:* `pnpm build`; manual via preview — generate a week, confirm Backup column +
    fairness rest column render in light/dark.
  - *Dependencies:* Task 2. *Scope:* S–M (2 files + verify).

### Checkpoint: Staffing + fairness
5-role generation works end-to-end in the UI; distribution test proves no first-user bias; all
scheduler/query tests green.

### Phase 3: Per-shift availability (Feature C)

- **Task 5 — Per-shift constraint model + persistence.** `lib/shifts/types.ts`: extend
  `ConstraintKind` with `unavailable_shift`. `lib/db/queries.ts`: `listConstraintsForWeek` returns
  both kinds (widen the `kind` filter, keep the week-range filter); add a
  `setUnavailableShift(teamId, personId, date, shift, unavailable)` helper mirroring
  `setUnavailable`'s tenancy guard and value format `date:shift`. Update `lib/db/queries.test.ts`.
  - *Acceptance:* shift rows round-trip with value `YYYY-MM-DD:<shift>`; whole-day rows unaffected;
    tenancy guard rejects a person on another team.
  - *Verification:* `pnpm test -- queries` green; `pnpm typecheck`.
  - *Dependencies:* None strictly (types edit coordinates with Task 2's types edit — sequence to
    avoid a merge). *Scope:* M (3 files).

- **Task 6 — Shift-aware eligibility (engine).** `lib/scheduler/generate.ts`: a person is
  ineligible for morning/evening/night if that shift OR the whole day is blocked; ineligible for
  kitchen/backup only if the whole day is blocked. `lib/scheduler/violations.ts`: the "unavailable"
  warning is shift-aware with the same rule. Update `generate.test.ts` + `violations.test.ts`.
  - *Acceptance:* a person off `morning` on a date can still take evening/night/kitchen/backup that
    date; off whole day → nothing; violations flag only true conflicts.
  - *Verification:* `pnpm test -- generate violations` green.
  - *Dependencies:* Task 5 (constraint kind), Task 2 (backup slot). *Scope:* M (4 files).

- **Task 7 — Per-shift availability UI + actions.** `app/shifts/actions.ts`:
  `toggleShiftUnavailableAction` (admin) + `toggleMyShiftUnavailabilityAction` (member self, reusing
  the `requireLinkedMember` own-person + active guards). `app/shifts/people/page.tsx`: replace the
  single per-day toggle with per-shift toggles (morning/evening/night) plus the existing whole-day
  off, for both AdminView and MemberView. Update `app/shifts/actions.test.ts`.
  - *Acceptance:* admin toggles any person's per-shift availability; a member toggles only their own
    (spoofed `personId` rejected); the People grid reflects saved state per shift.
  - *Verification:* `pnpm test -- actions` green; `pnpm build`; manual via preview — toggle morning
    off, generate, confirm that person is never on morning but can appear elsewhere.
  - *Dependencies:* Task 5, Task 6. *Scope:* M (3 files).

### Checkpoint: Per-shift availability
Availability is per-shift end-to-end (UI → persistence → generator → violations); member self-serve
stays self-scoped; all tests green.

### Phase 4: One-click block-week (Feature D)

- **Task 8 — Block/clear whole week.** `lib/db/queries.ts`: `setWeekUnavailable(teamId, personId,
  weekStart, blocked)` writing/removing `unavailable_date` for all 7 dates of the week (via
  `weekDates`), with the tenancy guard. `app/shifts/actions.ts`: `blockWeekAction` (admin) +
  `blockMyWeekAction` (member self guard); both accept `blocked` to toggle. `app/shifts/people/
  page.tsx`: a "Block week / Clear week" control per person (admin) and for self (member). Update
  `app/shifts/actions.test.ts`.
  - *Acceptance:* one click marks a person off all 7 days of the viewed week; clear removes exactly
    those; member variant rejects a non-own `personId`; interacts correctly with per-shift rows
    (whole-day off wins).
  - *Verification:* `pnpm test -- actions queries` green; `pnpm build`; manual via preview — block a
    week, confirm all 7 days show off and the person gets no assignments on generate.
  - *Dependencies:* Task 1 (anchor `weekDates`), Task 5 (constraint listing). *Scope:* M (3 files).

### Phase 5: Docs

- **Task 9 — Record the availability-model change.** Amend/annotate
  [`docs/decisions/0003-member-self-availability.md`](../../docs/decisions/0003-member-self-availability.md)
  (member write scope now includes `unavailable_shift` and block-week) and update the availability
  wording in [`docs/architecture.md`](../../docs/architecture.md) if needed.
  - *Acceptance:* ADR reflects the widened (still self-scoped) member write surface and the two
    constraint kinds.
  - *Verification:* manual read-through; links resolve.
  - *Dependencies:* Tasks 5, 7, 8. *Scope:* XS (1–2 files).

### Checkpoint: Complete
All spec success criteria met; `pnpm test`, `typecheck`, `lint`, `build` pass; UI verified in
preview; ready for `/test` and `/review`.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Anchor rename ripples through many call sites | Med | Single constant + one helper; typecheck catches stragglers; do it first (Task 1). |
| Legacy Sunday-anchored weeks become unreachable by nav | Low | Accepted per spec (dev instance); Open Question #3. |
| "Fair, no first-user bias" is hard to assert | Med | Dedicated statistical distribution test with tolerance + roster shuffle (Task 3). |
| New member actions widen write surface | High (security) | Reuse `requireLinkedMember` own-person + active guards; test rejects spoofed `personId` (Tasks 7, 8). |
| `types.ts` edited by both Task 2 and Task 5 | Low | Sequence the two edits (B before C) to avoid conflict. |
| Broken intermediate (capacity changed but backup unfilled) | Low | Task 2 changes capacity and adds backup fill together. |

## Open Questions

Carried from the spec (all have working defaults; none block build):
1. All-three-shifts-blocked vs whole-day off — default: independent (kitchen/backup stay open).
2. Fairness panel: distinguish backup rest from a full day off on rosters >5 — default: show both, labelled.
3. Legacy Sunday weeks after the anchor switch — default: leave as legacy dev data.
4. 5-person team has no full day off, only backup rest — confirm acceptable.
5. ADR amendment scope (Task 9) — confirm an annotation to ADR-0003 suffices vs a new ADR.

## SDLC Command Coverage
- [x] /spec completed
- [x] /plan completed
- [x] /build completed
- [ ] /test completed
- [ ] /review completed
- [ ] /code-simplify completed
