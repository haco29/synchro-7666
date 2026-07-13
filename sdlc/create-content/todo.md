# Tasks

## Phase 1: Foundation

- [x] Task 1: Domain layer + tooling (types, week math, vitest; used built-in `node:sqlite` instead of better-sqlite3)
- [x] Task 2: SQLite data layer (schema, queries, history aggregates)
- [x] Task 3: Scheduler engine (pure) + tests

## Checkpoint: Foundation

- [x] `pnpm test` green (21 tests)
- [x] `pnpm build` green

## Phase 2: Core feature slices

- [x] Task 4: Roster & unavailability page (`/shifts/people`)
- [x] Task 5: Week editor — generate & view (`/shifts`, `/shifts/week/[start]`)
- [x] Task 6: Manual overrides with warnings

## Checkpoint: Core flow

- [x] Roster → constraints → generate → tweak works end to end in browser
      (verified 2026-07-13: 8-person roster, unavailability toggles, generate,
      override with warning, revert)

## Phase 3: Publish & shell

- [x] Task 7: Publish + share link (`/s/[token]`)
- [x] Task 8: Site shell & fairness stats

## Checkpoint: Complete

- [x] All spec success criteria met (browser-verified: publish → share link
      renders read-only with per-person highlight; invalid token → 404)
- [x] `pnpm build` + `pnpm test` green (24 tests)
- [x] Ready for /test, /review, /code-simplify, /pr (all three stages run;
      review findings fixed and re-verified in browser)
