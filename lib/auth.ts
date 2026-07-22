import { and, asc, eq, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "./db/index";
import { personForUser } from "./db/queries";
import * as schema from "./db/schema";

/** Thrown when a request is not authorized. Callers/route handlers surface a 401/403. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

type Db = LibSQLDatabase<typeof schema>;

/** The internal team id linked to a Clerk org, or undefined if none is linked yet. */
async function findTeamByOrg(db: Db, orgId: string): Promise<number | undefined> {
  const row = (
    await db
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(eq(schema.teams.clerkOrgId, orgId))
      .limit(1)
  )[0];
  return row?.id;
}

/**
 * Maps a Clerk organization id to our internal team id — the single place
 * tenancy is derived. Pure over (db, orgId) so it is unit-testable without Clerk.
 *
 * First org claims the seeded, still-unlinked "Default Team" (so its imported
 * roster carries over); later orgs get a fresh team. `teams.clerk_org_id` is
 * unique, so a given org always maps to exactly one team.
 */
export async function resolveTeamId(db: Db, orgId: string): Promise<number> {
  const existing = await findTeamByOrg(db, orgId);
  if (existing !== undefined) return existing;

  // First org to migrate claims the seeded, still-unlinked "Default Team" so its
  // roster carries over. The conditional update (WHERE clerk_org_id IS NULL) makes
  // the claim atomic: a concurrent claim yields no rows and we fall through.
  const unlinked = (
    await db
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(isNull(schema.teams.clerkOrgId))
      .orderBy(asc(schema.teams.id))
      .limit(1)
  )[0];
  if (unlinked) {
    const claimed = await db
      .update(schema.teams)
      .set({ clerkOrgId: orgId })
      .where(and(eq(schema.teams.id, unlinked.id), isNull(schema.teams.clerkOrgId)))
      .returning({ id: schema.teams.id });
    if (claimed.length > 0) return claimed[0].id;
    // Lost the claim race — see if this org got linked meanwhile.
    const linked = await findTeamByOrg(db, orgId);
    if (linked !== undefined) return linked;
    // else fall through and create a fresh team.
  }

  // Create a fresh team; tolerate a concurrent insert for the same org
  // (clerk_org_id is UNIQUE) by reading the winner.
  const created = await db
    .insert(schema.teams)
    .values({ name: `Team ${orgId}`, clerkOrgId: orgId })
    .onConflictDoNothing({ target: schema.teams.clerkOrgId })
    .returning({ id: schema.teams.id });
  if (created.length > 0) return created[0].id;
  return (await findTeamByOrg(db, orgId))!;
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

/**
 * Whether the caller is an org admin (editor). For role-aware *rendering* in
 * Server Components — it does not authorize a mutation (that stays
 * `requireAdmin()` inside the action). Throws only when unauthenticated / no org,
 * consistent with `currentTeam()`.
 */
export async function isAdmin(): Promise<boolean> {
  const { orgRole } = await requireOrg();
  return orgRole === "org:admin";
}

/** The caller's team and their linked person id (undefined if unlinked). */
async function callerTeamAndPerson(): Promise<{ teamId: number; personId?: number }> {
  const { userId, orgId } = await requireOrg();
  const teamId = await resolveTeamId(getDb(), orgId);
  return { teamId, personId: await personForUser(teamId, userId) };
}

/**
 * The `people.id` linked to the caller's Clerk user in their active team, or
 * null if this member isn't linked to a person yet. For role-aware *rendering*
 * (an unlinked member is read-only). Derives the person server-side — the client
 * never supplies it.
 */
export async function currentPersonId(): Promise<number | null> {
  const { personId } = await callerTeamAndPerson();
  return personId ?? null;
}

/**
 * A signed-in member who is linked to a person. Returns their team + own person
 * id. Throws AuthError if unauthenticated, without an org, or not yet linked.
 * Use in the self-service availability action to authorize *and* to source the
 * caller's own `personId` — never trust a `personId` from the form.
 */
export async function requireLinkedMember(): Promise<{ teamId: number; personId: number }> {
  const { teamId, personId } = await callerTeamAndPerson();
  if (personId === undefined) throw new AuthError("No linked person for this member");
  return { teamId, personId };
}
