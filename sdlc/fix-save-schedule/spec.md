# Spec — Live-edit scheduling (auto-save seats, drop Publish)

Branch: `fix-save-schedule`
Status: Draft (spec-driven-development)
Date: 2026-07-15

## Objective

Make the week-grid schedule **live-edit**: a seat assignment saves the instant it changes, with no
submit step and no publish gate. Three coupled changes, plus one safety guard:

1. **Auto-save on change.** Selecting a person in a seat's dropdown immediately fires the existing
   `assignSlotAction` — no per-seat ✓ "Save" button.
2. **Clear via the dropdown.** The "— unfilled —" option becomes selectable; choosing it on a
   filled seat fires `clearSlotAction`. No separate ✗ "Clear" button.
3. **Remove Publish entirely.** Delete the Publish/Unpublish button, `setPublishedAction`, and the
   `isWeekPublished` guard in `generateWeekAction`. Every edit is live the moment it is saved.
4. **Confirm before Regenerate.** Because Publish no longer shields manual edits from being
   overwritten, "Regenerate schedule" gets an "Are you sure?" confirm. (First-time "Generate" —
   when the week has no assignments — needs no confirm.)

Target users: **admins** (`requireAdmin`) editing a team's week schedule in `/shifts/week/[start]`.
No change to member self-service or viewer surfaces.

### Why

Editing a seat today requires clicking a small ✓ to persist; it is easy to forget and silently lose
the change. Publish's only real effect today is blocking regenerate on a published week — it gates
**no** visibility anywhere (see Findings). Removing it and saving on change makes the grid behave
like the People-page availability toggles, which already save on click.

## Findings that shaped this (confirmed)

- **Publish gates nothing but regenerate.** `listPublishedWeeks` is referenced **only** in
  `lib/db/queries.test.ts`; no page, share link, or read-only view reads `published`. The sole
  runtime effect of `published = true` is `generateWeekAction` early-returning
  (`if (await isWeekPublished(...)) return;`) and the week page disabling the Regenerate button.
- **Only seat assignments need the ✓.** People-page availability toggles already save on click.
- **The seat editor is a server-rendered form.** Auto-submit-on-change and the regenerate confirm
  require a small **client** component (`"use client"`).

## Scope

### In scope

- `app/shifts/_components/seat-editor.tsx` — becomes (or delegates to) a client component:
  - `<select>` `onChange` → submit: pick a person → `assignSlotAction`; pick "— unfilled —" on a
    filled seat → `clearSlotAction`.
  - Make "— unfilled —" **selectable** (remove `disabled`); it is the value for an empty seat.
  - Remove the ✓ Save button and the ✗ Clear form/button.
- `app/shifts/week/[start]/page.tsx`:
  - Remove the Publish/Unpublish form and `setPublishedAction` import.
  - Remove the `isWeekPublished` read and the `disabled={published}` / title on the Generate button.
  - Add a client-side "Are you sure?" confirm to **Regenerate** only (not first Generate).
- `app/shifts/actions.ts`:
  - Delete `setPublishedAction`.
  - Remove the `if (await isWeekPublished(teamId, weekStart)) return;` guard from
    `generateWeekAction`.
  - Drop now-unused imports (`isWeekPublished`, `setWeekPublished`).
- Tests — update/remove tests touching Publish behavior; add coverage for clear-via-dropdown and
  the regenerate-confirm (see Testing strategy).

### Out of scope

- **Dropping the `weeks.published` column / any schema migration** (see Data & migration — leave it).
- Optimistic UI, debouncing, toasts, or spinners on save (the existing full-form-post +
  `revalidatePath` round-trip is kept; no new UX beyond removing the buttons).
- Undo / change history for overwrites.
- Any change to member self-service availability, viewer routes, `assignSlotAction` /
  `clearSlotAction` / `swapSeat` / `removeAssignment` **logic**, or auth/tenancy invariants.
- Reworking `generateWeek`'s fairness or determinism.

## Data & migration

- **No schema migration.** Per the user's lean, `weeks.published` is **left in place, unused**.
  Dropping it would require `pnpm db:generate` + `pnpm db:migrate` against **both** local `dev.db`
  and hosted Turso (Vercel does not run migrations) for no functional gain. Removing the column is
  deferred to a future cleanup (see Open Questions).
- `isWeekPublished` / `setWeekPublished` / `listPublishedWeeks` query functions and the `published`
  column stay defined; only their **application call sites** (actions + page) are removed. **Their
  unit tests in `queries.test.ts` stay** (decided) — still-valid, low-cost regression cover for the
  still-defined functions until a future cleanup migration removes them.

## Commands

- `pnpm test` (vitest), `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`.
- `pnpm dev` (already on `http://localhost:3001`) + preview tools to verify: change a seat → saves;
  select "— unfilled —" → clears; Regenerate prompts and, on cancel, leaves edits intact; no
  Publish button; first-time Generate has no confirm.
- **No** `pnpm db:generate` / `db:migrate` (no schema change).

## Code style

Match existing code: TypeScript with explicit prop types; comment-the-why density as in the current
`seat-editor.tsx` and `actions.ts`; Tailwind classes consistent with the current grid; keep the
Server Action + `revalidatePath("/shifts", "layout")` persistence path unchanged; no new
dependencies. The client component stays minimal — a thin `"use client"` wrapper around the form
that calls `form.requestSubmit()` on change and `window.confirm()` on regenerate (decided —
simplest, zero-dep, keyboard-accessible; a11y/styling can be revisited later).

## Testing strategy

Use TDD. Prioritize logic that changed; UI wiring is verified in the browser.

1. **`generateWeekAction` no longer gates on publish.** After removing the guard, generating a week
   that would previously have been "published" now replaces assignments. (Update/remove the existing
   test asserting the guard; add one asserting regenerate overwrites regardless.)
2. **Clear via dropdown.** Selecting the empty value on a filled seat routes to `clearSlotAction`
   with the correct `date`/`slot`/`personId` (component/action-level test as feasible; otherwise
   browser-verified).
3. **Assign via dropdown** still calls `assignSlotAction` with `previousPersonId` when replacing.
4. **No `setPublishedAction`.** Assert it is gone / not exported (or simply that the module compiles
   without it and no caller references it).
5. **Regenerate confirm** — browser-verified: Regenerate shows a confirm; cancel makes no request
   (assignments unchanged); first-time Generate shows none.
6. Full suite + typecheck + lint + build green.

## Boundaries

- **Always:** team-scope via `currentTeam()`; re-check authz in Server Actions (`requireAdmin`);
  validate every `FormData` field server-side (the client form is not a trust boundary); keep
  `revalidatePath` so the grid reflects saved state.
- **Ask first:** dropping `weeks.published` / any schema or migration change; adding optimistic UI,
  debouncing, or new dependencies; touching member self-service or viewer surfaces; changing
  `assignSlotAction`/`clearSlotAction` semantics.
- **Never:** trust client `team_id`/`personId`/`week`/`slot`; let a viewer/member mutate seats;
  hard-delete data; commit secrets; run migrations against Turso without explicit go-ahead.

## Success criteria

- [ ] Selecting a person in a seat's dropdown saves immediately (no ✓ click); the ✓ Save button is
      gone.
- [ ] Selecting "— unfilled —" on a filled seat clears it (fires `clearSlotAction`); the ✗ Clear
      button is gone.
- [ ] The Publish/Unpublish button, `setPublishedAction`, and the `isWeekPublished` guard in
      `generateWeekAction` are all removed; every edit is live.
- [ ] "Regenerate schedule" shows an "Are you sure?" confirm; cancelling leaves manual edits intact.
      First-time "Generate" (empty week) shows no confirm.
- [ ] No schema migration; `weeks.published` column left intact and unused.
- [ ] `pnpm test`, `tsc --noEmit`, `lint`, `build` all pass; browser verification confirms the four
      behaviors above.

## Open questions

1. **`weeks.published` fate (deferred, not blocking).** Leave the unused column now (decided) vs a
   later cleanup migration that drops it and removes `isWeekPublished`/`setWeekPublished`/
   `listPublishedWeeks` + their tests. Recommend: file as a follow-up.
2. **Save feedback.** Decision is "no new UX beyond removing buttons" — the page revalidates on
   save. Confirm in review that the round-trip is fast enough that silent save isn't confusing; if
   not, a follow-up can add a subtle pending indicator.

**Resolved during spec:**

- **Confirm mechanism** → `window.confirm()` (simplest, zero-dep, keyboard-accessible; revisit a11y
  later if needed).
- **Publish query tests** → keep in `queries.test.ts` as regression cover for the still-defined
  functions.
