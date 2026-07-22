<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project docs

Before working on data or auth, read these — they carry invariants that are easy to break:

- [`docs/architecture.md`](docs/architecture.md) — data & auth architecture and the invariants
  (team-scope every query via `currentTeam()`, re-check authz in Server Actions, migrations aren't
  automatic, `proxy.ts` not `middleware.ts`).
- [`docs/decisions/`](docs/decisions/) — ADRs (the _why_: Turso+Drizzle, Clerk org-based tenancy).
- [`sdlc/`](sdlc/) — per-branch spec → plan → todo for in-flight work.
