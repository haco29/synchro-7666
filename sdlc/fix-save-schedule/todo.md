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
- [x] `pnpm test` (121 pass, incl. new guard test), `tsc --noEmit`, `lint` (0 errors), `build` all pass
- [x] Ready for review

## Notes for review / commit
- `weeks.published` column, `isWeekPublished`/`setWeekPublished`/`listPublishedWeeks`, and their
  `queries.test.ts` coverage are intentionally **kept** (no migration). Only the app call sites were
  removed. Follow-up: a cleanup migration could drop them later.
- First client components in the app: `generate-schedule-button.tsx` and `seat-editor.tsx`.
- Seat editor calls the existing Server Actions directly from `onChange` (per-branch `FormData`) —
  `assignSlotAction`/`clearSlotAction` logic unchanged.
