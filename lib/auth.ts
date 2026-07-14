import { randomBytes } from "node:crypto";
import { asc, eq, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "./db/index";
import * as schema from "./db/schema";

/** Thrown when a request is not authorized. Callers/route handlers surface a 401/403. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

type Db = LibSQLDatabase<typeof schema>;

/**
 * Maps a Clerk organization id to our internal team id — the single place
 * tenancy is derived. Pure over (db, orgId) so it is unit-testable without Clerk.
 *
 * First org claims the seeded, still-unlinked "Default Team" (so its imported
 * roster carries over); later orgs get a fresh team. `teams.clerk_org_id` is
 * unique, so a given org always maps to exactly one team.
 */
export async function resolveTeamId(db: Db, orgId: string): Promise<number> {
  const existing = (
    await db.select().from(schema.teams).where(eq(schema.teams.clerkOrgId, orgId)).limit(1)
  )[0];
  if (existing) return existing.id;

  const unlinked = (
    await db
      .select()
      .from(schema.teams)
      .where(isNull(schema.teams.clerkOrgId))
      .orderBy(asc(schema.teams.id))
      .limit(1)
  )[0];
  if (unlinked) {
    await db.update(schema.teams).set({ clerkOrgId: orgId }).where(eq(schema.teams.id, unlinked.id));
    return unlinked.id;
  }

  const [created] = await db
    .insert(schema.teams)
    .values({
      name: `Team ${orgId}`,
      clerkOrgId: orgId,
      shareToken: randomBytes(16).toString("hex"),
    })
    .returning();
  return created.id;
}

/** The Clerk session context needed to authorize a request. */
async function requireOrg(): Promise<{ userId: string; orgId: string; orgRole?: string }> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) throw new AuthError("Not signed in");
  if (!orgId) throw new AuthError("No active organization");
  return { userId, orgId, orgRole: orgRole ?? undefined };
}

/**
 * The internal team id for the caller's active Clerk organization. Use in
 * Server Components and Server Actions to scope every query. Throws AuthError
 * when unauthenticated or without an active org.
 */
export async function currentTeam(): Promise<number> {
  const { orgId } = await requireOrg();
  return resolveTeamId(getDb(), orgId);
}

/** Any signed-in member of an org (viewer or admin). Returns their team id. */
export async function requireMember(): Promise<{ teamId: number }> {
  const { orgId } = await requireOrg();
  return { teamId: await resolveTeamId(getDb(), orgId) };
}

/** Editors only (`org:admin`). Rejects members. Returns their team id. */
export async function requireAdmin(): Promise<{ teamId: number }> {
  const { orgId, orgRole } = await requireOrg();
  if (orgRole !== "org:admin") throw new AuthError("Requires admin role");
  return { teamId: await resolveTeamId(getDb(), orgId) };
}
