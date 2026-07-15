# Tasks

## Phase 1: Week anchor (Feature A)
- [x] Task 1: Wednesday week anchor (`WEEK_START_DOW`, `weekStartOf`) + propagate to actions, week page, landing page, people page; update week.test

## Checkpoint: Week anchor
- [x] Tests + typecheck green; app builds; week grid runs Wed→Tue everywhere (browser-confirmed: "Week of Wed, Jul 22 – Tue, Jul 28")

## Phase 2: Staffing model + backup fairness (Feature B)
- [x] Task 2: Role model + generator — types (backup, capacities→1, backupCount), generate.ts (backup fill, zero-weight, backupHist balance), historyBefore backupCount; update generate/queries tests (browser-confirmed: 5 roles/day, backup rotates across distinct people)
- [x] Task 3: No-bias distribution test (240 seeds; spread-ratio < 1.25 for night/kitchen/backup/total + first-vs-last scarce-role check; proven by breaking the tiebreak → Infinity)
- [x] Task 4: Backup in the UI — SLOT_LABELS (Task 2), fairness-panel Backup (week)+(all-time) columns; week grid verified (browser-confirmed)

## Checkpoint: Staffing + fairness
- [x] 5-role generation works end-to-end in the UI; distribution test proves no first-user bias; scheduler/query tests green

## Phase 3: Per-shift availability (Feature C)
- [x] Task 5: Per-shift constraint model + persistence — ConstraintKind `unavailable_shift`, listConstraintsForWeek both kinds (exclusive upper bound fixes last-day boundary), setUnavailableShift; queries test +4
- [x] Task 6: Shift-aware eligibility — generate.ts + violations.ts (morning/evening/night gated per-shift or whole-day; kitchen/backup gated whole-day only); generate +3, violations +1 (browser check deferred to Task 7 — no UI to set per-shift constraints yet)
- [x] Task 7: Per-shift availability UI + actions — toggleShiftUnavailableAction + toggleMyShiftUnavailabilityAction; People page AvailabilityCell (Day + M/E/N toggles) for admin & member; actions test +5 (browser-confirmed: blocked shift honored on regenerate, person still placed elsewhere)

## Checkpoint: Per-shift availability
- [x] Availability is per-shift end-to-end (UI → persistence → generator → violations); member self-serve stays self-scoped; tests green

## Phase 4: One-click block-week (Feature D)
- [x] Task 8: Block/clear whole week — setWeekUnavailable query, blockWeekAction + blockMyWeekAction, People page BlockWeekButton (admin column + member); queries +4, actions +4 (browser-confirmed: block week → 7 days off → 0 assignments on regenerate)

## Phase 5: Docs
- [x] Task 9: Amended ADR-0003 (2026-07-15 amendment: two constraint kinds + three self-only member writes) and architecture.md availability wording

## Checkpoint: Complete
- [x] All spec success criteria met
- [x] `pnpm test` (112), `typecheck`, `lint`, `build` pass; UI verified in preview (week anchor, backup rotation, per-shift availability, block-week)
- [ ] Ready for review (pending human commit of the tasks)
