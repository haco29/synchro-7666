# Spec: Shifts Scheduling (first feature of the Synchro site)

## Objective

A web app ("Synchro") that starts as a shift-scheduling tool and will grow into a
multi-feature coordination site. The shifts feature lets a single organizer:

1. Maintain a roster of people that changes week to week.
2. Record each person's limitations (days/dates they are unavailable).
3. Auto-generate a fair weekly schedule that respects those limitations.
4. Manually tweak the generated schedule (with validation warnings).
5. Publish the week and share a read-only link so people can see their shifts.

### Target users

- **Organizer** (the app owner): edits roster, constraints, and schedules weekly.
- **Participants**: open a shared link, view the week's schedule read-only. No accounts.

## Domain model & rules

### Shifts

Each day has exactly these assignment slots:

| Slot    | Time                 | People needed |
| ------- | -------------------- | ------------- |
| Morning | 07:00–15:00          | 2             |
| Evening | 15:00–23:00          | 2             |
| Night   | 23:00–07:00 (+1 day) | 2             |
| Kitchen | daily duty           | 1             |

- 7 slots/day, 49 assignments per week.
- Week runs **Sunday–Saturday** (see Open Questions).

### Hard rules (never violated by auto-generation; manual overrides warn)

1. A person is assigned **at most one slot per day** (shift or kitchen, not both).
2. A person is never assigned on a day they are marked unavailable.
3. Kitchen duty goes to someone **not on a shift that day**.

### Soft rules (auto-generation optimizes; violations allowed but discouraged)

1. **Fairness within the week**: total assignments per person as even as possible.
2. **Night-shift fairness across weeks**: cumulative night-shift counts per person
   (persisted history) kept as even as possible — no one accumulates
   disproportionately many nights over time.
3. **Kitchen fairness**: kitchen duties balanced across people over time.
4. Avoid a morning shift the day after a night shift (rest preference).

### Constraints (v1)

- **Unavailable days/dates** only: per person, a set of specific dates and/or
  recurring weekdays for the week being planned. Updated weekly by the organizer.
- Model constraint types extensibly (typed records) so blocked-shift-types,
  max-per-week, and rest rules can be added later without schema rewrite.

### Roster

- People have a name (unique display name) and active/inactive status.
- Deactivating a person removes them from future scheduling but preserves their
  history (for cumulative fairness stats).

### Weekly flow

1. Organizer opens the upcoming week → updates roster + unavailability.
2. Clicks **Generate** → engine produces a full week honoring hard rules,
   optimizing soft rules. Regeneration allowed.
3. Organizer manually swaps/edits any assignment; UI flags hard-rule violations
   and fairness regressions but does not block.
4. Clicks **Publish** → week becomes visible at the share link.
5. Share link (`/s/<token>`) shows the published schedule read-only; a single
   stable token per site (all published weeks visible at that link).

## Tech stack & architecture

- **Next.js 16.2 (App Router)** — already in repo. Conventions must follow the
  bundled docs in `node_modules/next/dist/docs/` (breaking changes vs 14/15).
- **Tailwind CSS v4** — already in repo.
- **SQLite via built-in `node:sqlite`** — single-file DB at `data/synchro.db`
  (gitignored). Data access isolated in `lib/db/` so storage can be swapped.
- **Server Actions** for all mutations; server components for reads.
- **Scheduler engine as pure functions** in `lib/scheduler/` — no I/O, fully
  unit-testable: `(roster, constraints, history, weekStart) → schedule`.
- Site is multi-feature from day one: home page lists features; shifts lives
  under `/shifts`. New features get sibling route groups + `lib/` modules.

## Project structure

```text
app/
  layout.tsx            # site shell + nav
  page.tsx              # home: feature cards (Shifts, …future)
  shifts/
    page.tsx            # week dashboard (current/upcoming week)
    people/page.tsx     # roster + unavailability editor
    week/[start]/page.tsx  # schedule editor for a given week
  s/[token]/page.tsx    # public read-only schedule view
lib/
  db/                   # sqlite client, schema, queries
  scheduler/            # pure scheduling engine + fairness scoring
  shifts/               # domain types, week math, constants
data/                   # sqlite file (gitignored)
sdlc/create-content/    # SDLC artifacts
```

## Commands

- `pnpm dev` — dev server
- `pnpm build` — production build
- `pnpm lint` — eslint
- `pnpm test` — unit tests (vitest, to be added)

## Code style

- TypeScript strict; domain types in `lib/shifts/types.ts` shared everywhere.
- Pure logic (scheduler, week math) has zero framework imports.
- Follow existing repo eslint config; Tailwind utility classes, no CSS modules.
- Dates handled as ISO `YYYY-MM-DD` strings in the domain layer (no TZ bugs).

## Testing strategy

- **Unit (vitest)**: scheduler engine is the risk center — hard-rule compliance,
  fairness distribution, night-shift history balancing, infeasible-input
  behavior (too few available people), determinism given a seed.
- **Unit**: week math (week start, date ranges).
- **Manual/browser**: CRUD flows, generate→edit→publish, share link renders.

## Boundaries

- **Always**: keep scheduler pure; keep hard rules enforced in the engine, not
  just the UI; preserve history when people are removed.
- **Ask first**: adding auth; adding external services (hosted DB, email);
  changing shift times/staffing model.
- **Never**: expose editing capability through the share link; block manual
  overrides outright (warn instead); delete assignment history silently.

## Success criteria

1. Organizer can create a week, mark unavailability, and generate a schedule
   with zero hard-rule violations in one click.
2. Over 4 consecutive generated weeks with a stable roster, max−min cumulative
   night shifts per person ≤ 1 (when feasible).
3. Manual edit of any slot works; violations surface as visible warnings.
4. Published week is visible at the share link without login; unpublished
   changes are not.
5. `pnpm build` passes; scheduler test suite green.

## Resolved decisions (confirmed with organizer)

1. **Week start day** — Sunday (Sunday–Saturday week).
2. **Admin protection** — no auth in v1; organizer keeps the admin URL private.
   Share link is read-only regardless.
3. **Infeasible weeks** — engine fills what it can and clearly marks unfilled
   slots (gaps) for the organizer to resolve manually.

## Out of scope (v1)

- Notifications (email/WhatsApp push) — people open the share link themselves.
- Constraint types beyond unavailable days/dates (schema stays extensible).
- Multi-organizer/roles, per-person logins.
