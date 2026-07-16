# Implementation Plan: Live-edit scheduling (auto-save seats, drop Publish)

Branch: `fix-save-schedule`
Spec: [`spec.md`](spec.md)
Date: 2026-07-15

## Overview

Make the week-grid schedule live-edit: seat assignments save the instant the dropdown changes,
"— unfilled —" clears a seat, the Publish gate is removed entirely, and Regenerate gains an
"Are you sure?" confirm to replace the protection Publish used to give. Small, tightly-scoped
change across three files (`actions.ts`, `week/[start]/page.tsx`, `seat-editor.tsx`) plus one new
client component and one action-layer test.

## Architecture Decisions

- **Keep the existing persistence path unchanged.** Auto-save reuses `assignSlotAction` /
  `clearSlotAction` + `revalidatePath("/shifts", "layout")`. No optimistic UI, debounce, or toasts
  (spec: "no new UX beyond removing buttons"). The client component only calls
  `form.requestSubmit()` on change.
- **`window.confirm()` for the Regenerate guard** (decided) — zero-dep, keyboard-accessible;
  a11y/styling revisited later if needed. Confirm fires only when assignments already exist
  (Regenerate), never on first-time Generate.
- **Leave `weeks.published` in place, unused** (decided) — no schema migration. Remove only the
  application call sites. The `isWeekPublished`/`setWeekPublished`/`listPublishedWeeks` query
  functions and their `queries.test.ts` coverage stay (regression cover for still-defined code).
- **UI behavior is browser-verified, action logic is unit-tested.** The vitest env is `node`-only
  (no jsdom/testing-library), so seat-editor and the confirm are verified in the running app; the
  removed publish guard is proven with an action-layer test using the existing temp-DB harness.
- **Two client components stay minimal.** A `"use client"` seat editor (onChange → submit) and a
  `"use client"` confirm-on-submit wrapper for the generate form. The week page stays a Server
  Component; it renders the client pieces.

## Dependency Graph

```text
Existing Server Actions (assignSlotAction, clearSlotAction, generateWeekAction) — already exist
    │
    ├── Task 1: Remove Publish            (actions.ts: drop setPublishedAction + guard;
    │       │                              page.tsx: drop Publish button + published read;
    │       │                              actions.test.ts: guard-gone test)
    │       │
    │       └── Task 2: Regenerate confirm (new client wrapper; page.tsx generate form)
    │
    └── Task 3: Auto-save seat editor      (seat-editor.tsx → client component)   [parallel with 1&2]
```

Task 3 depends only on the existing actions and can proceed in parallel with Tasks 1–2. Task 2
depends on Task 1 (both touch the generate-button area of `page.tsx`; Task 2 builds on the
cleaned-up markup).

## Task List

Task descriptions only — live status lives in [`todo.md`](todo.md).

### Phase 1: Remove the Publish gate

- **Task 1: Remove Publish entirely; generate always runs.**
  Delete `setPublishedAction` from `actions.ts` and the
  `if (await isWeekPublished(teamId, weekStart)) return;` guard in `generateWeekAction`; drop the
  now-unused `isWeekPublished` / `setWeekPublished` imports. In `page.tsx`, remove the
  Publish/Unpublish `<form>`, the `setPublishedAction` import, the `isWeekPublished` import + read,
  and the `disabled={published}` / `title` on the Generate button. **TDD:** first add a failing
  test in `actions.test.ts` asserting `generateWeekAction` replaces assignments even when the week
  is marked published (`q.setWeekPublished(teamId, weekStart, true)` beforehand), then make it pass
  by removing the guard.

- **Task 2: Confirm before Regenerate.**
  Add a minimal `"use client"` component (e.g. `_components/confirm-submit.tsx`) that wraps the
  generate `<form>` and, via `onSubmit`, calls `window.confirm("...")` and `preventDefault()` on
  cancel — but only when assignments already exist (Regenerate), not on first Generate. Wire it into
  `page.tsx` (pass whether the week has assignments). First-time Generate submits with no prompt.

### Checkpoint: Publish removed, regenerate guarded

Tests + typecheck + lint + build green. In the browser: no Publish button; Regenerate shows a
confirm and cancelling leaves assignments unchanged; an empty week's "Generate" shows no confirm.

### Phase 2: Live-edit seats

- **Task 3: Auto-save on change; clear via dropdown.**
  Convert `seat-editor.tsx` to a `"use client"` component (or extract the interactive `<form>` into
  one). The person `<select>` gets an `onChange` that submits its form: choosing a person routes to
  `assignSlotAction`; choosing "— unfilled —" on a filled seat routes to `clearSlotAction`. Make the
  "— unfilled —" `<option>` selectable (remove `disabled`). Remove the ✓ Save button and the entire
  ✗ Clear `<form>`. Preserve the hidden fields each action needs (`weekStart`/`date`/`slot`/
  `previousPersonId` for assign; `date`/`slot`/`personId` for clear) and the violation/inactive-
  holder styling. Since assign and clear are two different Server Actions, submit to the correct one
  based on the selected value (e.g. swap the form `action`, or use two forms / a small handler).

### Checkpoint: Complete

All four behaviors verified in the browser against the live baseline: (1) picking a person saves
with no ✓; (2) picking "— unfilled —" clears with no ✗; (3) no Publish button; (4) Regenerate
confirms, Generate doesn't. `pnpm test`, `tsc --noEmit`, `lint`, `build` all pass.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Routing one `<select>` to two different Server Actions (assign vs clear) is awkward | Med | Decide the wiring in Task 3: set the form's `action` based on selected value before `requestSubmit()`, or keep two hidden forms and submit the matching one. Browser-verify both paths. |
| `revalidatePath` round-trip makes silent save feel laggy | Low | Out of scope per spec; note in review whether a pending indicator is a needed follow-up. |
| Removing the guard lets Regenerate silently overwrite manual edits | Med | That is the intent; the Task 2 confirm is the compensating control. Verify cancel truly aborts. |
| Selecting the current value fires a no-op submit (onChange only fires on real change) | Low | `onChange` doesn't fire when the value is unchanged; acceptable. Verify no spurious writes. |
| `weeks.published` column left unused could confuse future readers | Low | Documented in spec Open Questions as a follow-up cleanup migration. |

## Open Questions

- None blocking. Deferred follow-ups (from spec): a cleanup migration to drop `weeks.published` +
  its query functions/tests; whether silent-save needs a subtle pending indicator.

## SDLC Command Coverage
- [x] /spec completed
- [x] /plan completed
- [x] /build completed
- [x] /test completed
- [x] /review completed
- [x] /code-simplify completed
