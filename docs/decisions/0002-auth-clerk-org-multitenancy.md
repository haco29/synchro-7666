# ADR-0002: Clerk auth with Organization-based multi-tenancy

## Status
Accepted

## Date
2026-07-14

## Context
The app previously had no authentication — only a POC public share link guarded by a random
`share_token`. Requirements at decision time:
- **Everyone authenticates** (members, not just admins).
- **Multi-tenant**: multiple teams, each seeing only its own roster/schedule.
- Deployed on **Vercel**; priority **developer experience over robustness**.
- No desire to store passwords / own an identity system.

## Decision
Use **Clerk** (`@clerk/nextjs`), with Clerk **Organizations as tenants**.
- A Clerk Organization maps 1:1 to an internal `teams` row via `teams.clerk_org_id`.
- **`currentTeam()` (`lib/auth.ts`) is the single tenancy seam**: it reads the caller's active
  Clerk org server-side and resolves it to the internal `team_id`. Nothing else derives tenancy.
- **`requireAdmin()` / `requireMember()`** guard mutations vs. reads, mapping to Clerk roles
  `org:admin` (editor) and member (viewer).
- Route gating is `clerkMiddleware()` in **`proxy.ts`** (Next 16 renamed the `middleware`
  convention to `proxy`; Node runtime).
- **No `users` table** — Clerk owns identity and membership. `people` are schedulable subjects,
  a separate concept from Clerk users.

## Alternatives Considered

### Auth.js (NextAuth)
- Pros: free, self-hosted, no vendor.
- Cons: no built-in Organizations — we'd build the team↔user model and org UI ourselves.
- Rejected: Clerk's built-in Organizations give us multi-tenancy for free; better DX.

### Per-team passcode (a shared secret, like the old `share_token`)
- Rejected: no real identity, weak, doesn't support per-user roles.

### Build our own auth
- Rejected: owning credentials/sessions is exactly what we wanted to avoid.

## Consequences
- **Tenancy is only as safe as `currentTeam()` usage.** Every query must be scoped by a `team_id`
  derived from `currentTeam()`; a `team_id` (or `personId`) must **never** be trusted from client
  input. Server Actions are POST-reachable, so each **re-checks authz** (the proxy alone is not enough).
- `resolveTeamId()` links the first org to the seeded "Default Team" (so the migrated roster carries
  over) and creates fresh teams for later orgs; the claim is an **atomic** conditional update.
- **Currently a Clerk _development_ instance.** It works on `*.vercel.app` but shows a
  "Development mode" badge, and its dev-browser handshake means a JS-less/SSR-first request (e.g.
  `curl`) to a protected route gets a 404 rewrite (`dev-browser-missing`) rather than a redirect —
  real browsers handshake and reach sign-in normally.
- **Promoting to a Clerk _production_ instance requires a custom domain** (DNS records); it is not
  possible on a Vercel-owned `*.vercel.app` subdomain. Tracked as a follow-up.
- Sign-in identifier is **email** (Clerk dev SMS doesn't support all countries, incl. Israel).
