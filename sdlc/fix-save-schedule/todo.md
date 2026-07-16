# Tasks

## Phase 1: Remove the Publish gate

- [x] Task 1: Remove Publish entirely; generate always runs
  - [x] TDD: failing test in `actions.test.ts` — `generateWeekAction` replaces assignments even when the week is marked published
  - [x] `actions.ts`: delete `setPublishedAction`
  - [x] `actions.ts`: remove `isWeekPublished` guard from `generateWeekAction`
  - [x] `actions.ts`: drop now-unused `isWeekPublished` / `setWeekPublished` imports
  - [x] `page.tsx`: remove Publish `<form>` + `setPublishedAction` import
  - [x] `page.tsx`: remove `isWeekPublished` import, the `published` read, and `disabled={published}` / title on Generate
  - [x] Test passes
- [x] Task 2: Confirm before Regenerate
  - [x] New `"use client"` confirm-on-submit wrapper (`_components/generate-schedule-button.tsx`)
  - [x] Wire into `page.tsx` generate form; confirm fires only when assignments exist (Regenerate)
  - [x] First-time Generate (empty week) submits with no confirm

## Checkpoint: Publish removed, regenerate guarded
- [x] `pnpm test`, `tsc --noEmit`, `lint`, `build` green
- [x] Browser: no Publish button
- [x] Browser: Regenerate shows confirm; cancel leaves assignments unchanged
- [x] Browser: empty-week Generate shows no confirm

## Phase 2: Live-edit seats

- [x] Task 3: Auto-save on change; clear via dropdown
  - [x] `seat-editor.tsx` → `"use client"`; `<select>` `onChange` submits the change
  - [x] Choosing a person → `assignSlotAction`; choosing "— unfilled —" on a filled seat → `clearSlotAction`
  - [x] Make "— unfilled —" `<option>` selectable (remove `disabled`)
  - [x] Remove ✓ Save button and ✗ Clear form/button
  - [x] Preserve action inputs + violation/inactive-holder styling

## Checkpoint: Complete
- [x] Browser: picking a person saves (no ✓) — verified: assigned דור, persisted after reload
- [x] Browser: picking "— unfilled —" clears (no ✗) — verified: cleared seat, persisted after reload
- [x] Browser: no Publish button; Regenerate confirms (cancel aborts, accept regenerates), Generate doesn't
- [x] `pnpm test` (126 pass), `tsc --noEmit`, `lint` (0 errors), `build` all pass
- [x] Ready for review

## Addendum — week anchor Wednesday → Thursday (added to this branch on request)
- Out of the original spec scope; user opted to bundle it here. `WEEK_START_DOW` 3 → 4 in
  `lib/shifts/week.ts` (+ comments); weeks now run **Thursday–Wednesday**.
- Updated hardcoded-date tests: `lib/shifts/week.test.ts` (weekStartOf/weekDates), `actions.ts`
  comments, and `actions.test.ts` (blockWeek/blockMyWeek success cases, the assign/clear/guard
  tests, and the "(non-Thursday)" label). All anchor math flows from the single constant.
- Data: existing Wednesday-anchored `weeks` rows are left as-is (dev data) — they don't align with
  the new Thursday week URLs, so weeks are regenerated under the new anchor as needed. No migration.
- Verified: `pnpm test` (126), `tsc` clean; live app shows the week running חמישי (Thu) → רביעי (Wed).

## Addendum — default to the current week (added on request)
- Schedule landing (`app/shifts/page.tsx`) and the People page default (`app/shifts/people/page.tsx`)
  now open `weekStartOf(todayIso())` — the week containing today — instead of the upcoming week
  (`addDays(..., 7)`). Dropped the now-unused `addDays` import in both; updated the `ShiftsNav`
  fallback comment. Verified: `/shifts` and `/shifts/people` both land on the current week.

## Addendum — preserve current week across Schedule ↔ People nav (added on request)
- Extracted the header nav into a `"use client"` `ShiftsNav` (`app/shifts/_components/shifts-nav.tsx`)
  that reads the current week from the URL (`/shifts/week/<start>` path or `?week=<start>` query)
  and threads it into both links; falls back to defaults when no week is in the URL.
- `useSearchParams()` requires a Suspense boundary during prerender, so the layout wraps
  `<ShiftsNav>` in `<Suspense>` with a `NavLinks` default-href fallback (identical markup).
- Verified in the browser: from a week page, People keeps the week (`?week=`), and Schedule returns
  to the same `/shifts/week/<start>`; round-trip stays on the same week. `tsc`/`lint`/`build` green.

## /review — applied fix
- Made the seat `<select>` **controlled** and added `persist()` — on a rejected save it logs,
  reverts the optimistic pick, and `router.refresh()`es. Fixes both review `Consider`s: the
  swallowed rejection (was `void action(...)`) and the UI/DB desync on a no-op/failed save.
- Success paths (assign persists, clear persists) re-verified in the browser; console clean.
  Failure-revert handler verified by inspection (can't force a live server rejection).
- `pnpm test` (126), `tsc`, `lint` (0 errors), `build` all green after the fix.

## /test — added coverage
- `generateWeekAction`: generates even when the week is flagged published (guard-gone; RED→GREEN in /build).
- `assignSlotAction`: assigns to an empty seat; swaps holder with `previousPersonId`; rejects non-admin.
- `clearSlotAction`: empties a filled seat; rejects non-admin (seat stays filled).
- Publish query tests (`isWeekPublished`/`setWeekPublished`/`listPublishedWeeks`) intentionally kept.
- Client components (`seat-editor`, `generate-schedule-button`) have no unit env (node-only vitest,
  no jsdom) — their behavior is browser-verified (assign/clear persist; confirm cancel/accept;
  Generate no-confirm).

## Notes for review / commit
- `weeks.published` column, `isWeekPublished`/`setWeekPublished`/`listPublishedWeeks`, and their
  `queries.test.ts` coverage are intentionally **kept** (no migration). Only the app call sites were
  removed. Follow-up: a cleanup migration could drop them later.
- First client components in the app: `generate-schedule-button.tsx` and `seat-editor.tsx`.
- Seat editor calls the existing Server Actions directly from `onChange` (per-branch `FormData`) —
  `assignSlotAction`/`clearSlotAction` logic unchanged.
