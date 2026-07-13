# Implementation Plan: Shifts Scheduling (Synchro v1)

## Overview

Build the shifts feature per `sdlc/create-content/spec.md`: roster + weekly
unavailability management, a pure scheduling engine that fills 7 slots/day
(2×morning, 2×evening, 2×night, 1×kitchen) fairly under hard rules, a week
editor with generate + manual override, and a published read-only share link.
Fresh Next.js 16.2 repo — everything is greenfield.

## Architecture Decisions

- **Next.js 16.2 idioms (from bundled docs, NOT 14/15 habits):** `params` is a
  `Promise` and must be awaited; Server Actions in `'use server'` files with
  `revalidatePath(...)` / `updateTag(tag)` after mutations (`revalidateTag`
  needs a second arg now); no `next lint` — run `eslint` directly; Turbopack is
  default (no flag); Tailwind v4 via `@import "tailwindcss"` (no config file).
- **SQLite via built-in `node:sqlite`** (chosen over better-sqlite3 during
  build: Node 24 ships it, avoiding a native dep and pnpm build-script
  approval) at `data/synchro.db` (gitignored); schema
  auto-created on first open. All access behind `lib/db/` query functions —
  never raw SQL in components/actions. No Cache Components (`cacheComponents`
  stays off), so sync DB reads in server components are fine.
- **Pure scheduler** in `lib/scheduler/`: `generateWeek(input) → schedule`
  with zero I/O, seeded randomness for tie-breaking (deterministic tests).
  Greedy slot-fill ordered by most-constrained-first, scored by fairness
  (week totals + cumulative night/kitchen history), then local swap
  improvement. Gaps (unfillable slots) returned explicitly.
- **Dates as `YYYY-MM-DD` strings** end to end; week keyed by its Sunday.
- **Constraints stored as typed rows** (`kind = 'unavailable_date' |
  'unavailable_weekday'`) so future kinds (blocked shift types, max/week) are
  additive.
- **Share link**: single persistent random token in a `settings` table;
  `/s/[token]` renders only weeks with `published = 1`.
- **Vitest** for unit tests of `lib/` (scheduler, week math). UI verified in
  browser.

## Task List

Task descriptions only — no checkboxes. Live task status lives in `todo.md`.

### Phase 1: Foundation

- **Task 1: Domain layer + tooling.** Add `vitest` dep and `test` script
  (SQLite uses the built-in `node:sqlite`, so no DB dependency is added). Create `lib/shifts/types.ts` (Person, ShiftType, Assignment,
  WeekSchedule, Constraint, GenerateInput/Result) and `lib/shifts/week.ts`
  (Sunday-of-week, week date list, date formatting). Unit tests for week math.
  *Acceptance:* types compile; `pnpm test` green; `pnpm build` passes.
  *Verification:* `pnpm test`, `pnpm build`. *Deps:* none. *Size:* S.

- **Task 2: SQLite data layer.** `lib/db/client.ts` (open + migrate schema:
  `people`, `constraints`, `weeks`, `assignments`, `settings` incl. share
  token), `lib/db/queries.ts` (people CRUD, constraints per week, week
  get-or-create, assignment upsert/clear, publish flag, history aggregates:
  cumulative night/kitchen counts per person). Gitignore `data/`.
  *Acceptance:* queries callable from a scratch script; schema idempotent.
  *Verification:* `pnpm build`; smoke script inserts/reads.
  *Deps:* Task 1. *Size:* M.

- **Task 3: Scheduler engine (pure) + tests.** `lib/scheduler/generate.ts`:
  hard rules (≤1 slot/person/day, respect unavailability, kitchen ≠ on-shift),
  soft optimization (even week totals, cumulative night fairness, cumulative
  kitchen fairness, avoid morning-after-night), explicit gap reporting,
  seeded determinism. Tests: hard-rule compliance on random rosters,
  night-fairness over 4 simulated weeks (max−min ≤ 1 with stable roster),
  gap behavior when infeasible, determinism per seed.
  *Acceptance:* all spec hard rules enforced; fairness test passes.
  *Verification:* `pnpm test`. *Deps:* Task 1 (parallel with Task 2). *Size:* M.

### Checkpoint: Foundation

`pnpm test` and `pnpm build` green; engine provably respects hard rules.

### Phase 2: Core feature slices

- **Task 4: Roster & unavailability page (`/shifts/people`).** Server
  component + Server Actions: add/rename/deactivate person; per-person
  unavailability editor for a selected week (weekday toggles + specific
  dates). *Acceptance:* full CRUD works in browser; data persists.
  *Verification:* manual browser flow. *Deps:* Task 2. *Size:* M.

- **Task 5: Week editor — generate & view (`/shifts` + `/shifts/week/[start]`).**
  Week dashboard redirecting to upcoming week; week grid (7 days × 4 slot
  groups) showing assignments and gaps; **Generate** action wiring engine +
  history + constraints; regenerate replaces unpublished assignments.
  *Acceptance:* one click yields full valid week; gaps visibly marked.
  *Verification:* manual browser flow; engine tests still green.
  *Deps:* Tasks 2, 3. *Size:* M.

- **Task 6: Manual overrides with warnings.** Edit any slot via person picker;
  saving recomputes violations (hard-rule breaches, fairness deltas) and shows
  non-blocking warnings; clear-slot supported.
  *Acceptance:* can swap people; violation warnings render; nothing blocks.
  *Verification:* manual browser flow. *Deps:* Task 5. *Size:* M.

### Checkpoint: Core flow

Roster → constraints → generate → tweak works end to end locally.

### Phase 3: Publish & shell

- **Task 7: Publish + share link (`/s/[token]`).** Publish/unpublish action on
  week editor; public read-only page listing published weeks (per-person view
  highlight); invalid token → `notFound()`.
  *Acceptance:* published week visible without cookies/login; unpublished
  invisible; edit UI absent on share page.
  *Verification:* manual browser flow (incognito). *Deps:* Task 5. *Size:* S.

- **Task 8: Site shell & fairness stats.** Home page with feature cards
  (Shifts now, placeholders later); nav in root layout; fairness sidebar on
  week editor (per-person totals: shifts, nights, kitchens — week + all-time).
  *Acceptance:* navigation coherent; stats match DB aggregates.
  *Verification:* manual browser check. *Deps:* Tasks 5–7. *Size:* S.

### Checkpoint: Complete

All spec success criteria met; `pnpm build` + `pnpm test` green; ready for
`/test`, `/review`, `/code-simplify`, `/pr`.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Next 16 API drift from habit (async params, revalidateTag signature) | Med | Conventions pinned in this plan from bundled docs; consult `node_modules/next/dist/docs/` when unsure |
| Scheduler fairness quality (greedy gets stuck) | Med | Swap-improvement pass + fairness unit tests with thresholds; gaps reported not hidden |
| SQLite driver availability | Low | Uses the built-in `node:sqlite` (Node ≥ 20.9, required by Next 16 anyway) — no native dependency to build |
| No auth on admin (accepted for v1) | Low | Documented in spec; share token separate |

## Open Questions

None — spec decisions resolved with organizer on 2026-07-13.

## SDLC Command Coverage

- [x] /spec completed
- [x] /plan completed
- [x] /build completed
- [x] /test completed (27/27 tests green across 4 files; production build compiles; browser flow verified during build)
- [x] /review completed (code-reviewer agent: 0 critical, 6 important — all fixed: slot validation, atomic seat swap, duplicate-name handling, inactive-holder display, published-week regenerate guard, removed half-wired weekday constraint kind; suggestions applied: canonical week URLs, timing-safe token compare, capped share history, next/link nav, full double-booking highlights)
- [x] /code-simplify completed (extracted SeatEditor + FairnessPanel from the week page into _components/, removed duplicate per-cell computation on the share page; build + lint green after each step)
- [x] PR review (CodeRabbit) addressed: share-page revalidation on rename/deactivate, stale-previousPersonId swap guard, add-person reactivation, kitchen-per-week fairness column, DB durability doc, artifact test-count/dependency sync (27/27 tests green)
