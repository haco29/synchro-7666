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
- [ ] Task 6: Shift-aware eligibility — generate.ts + violations.ts (morning/evening/night gated per-shift or whole-day; kitchen/backup gated whole-day only); update generate/violations tests
- [ ] Task 7: Per-shift availability UI + actions — toggleShiftUnavailableAction + member self variant; People page per-shift toggles; update actions test

## Checkpoint: Per-shift availability
- [ ] Availability is per-shift end-to-end (UI → persistence → generator → violations); member self-serve stays self-scoped; tests green

## Phase 4: One-click block-week (Feature D)
- [ ] Task 8: Block/clear whole week — setWeekUnavailable query, blockWeekAction + member self variant, People page block/clear-week control; update actions test

## Phase 5: Docs
- [ ] Task 9: Amend ADR-0003 (member write scope now includes unavailable_shift + block-week) and architecture.md availability wording

## Checkpoint: Complete
- [ ] All spec success criteria met
- [ ] `pnpm test`, `typecheck`, `lint`, `build` pass; UI verified in preview
- [ ] Ready for review
