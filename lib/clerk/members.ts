import { auth, clerkClient } from "@clerk/nextjs/server";

/** A Clerk org member reduced to what the admin link dropdown needs. */
export interface OrgMember {
  /** Clerk user id — the value stored in `people.clerk_user_id`. */
  userId: string;
  /** Display label: full name if present, else the identifier (email/phone). */
  label: string;
}

/**
 * Fetch + shape one org's members from the Clerk Backend API. Exported for
 * testing; callers should use `listOrgMembers`, which caches this.
 */
export async function fetchOrgMembers(orgId: string): Promise<OrgMember[]> {
  const client = await clerkClient();
  const { data } = await client.organizations.getOrganizationMembershipList({
    organizationId: orgId,
    limit: 100,
  });

  return data
    .map((m) => m.publicUserData)
    .filter((u): u is NonNullable<typeof u> => u != null)
    .map((u) => ({
      userId: u.userId,
      label: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.identifier,
    }));
}

// Per-org, per-instance cache: the Clerk Backend call is a slow network
// round-trip that otherwise blocks every People-page render, yet org membership
// changes rarely. `unstable_cache` can't wrap it (Clerk reads `headers()`
// internally, disallowed in cached contexts), so a small in-memory TTL cache it
// is. A newly-added org member becomes linkable within TTL_MS.
const TTL_MS = 60_000;
// Cap the number of orgs held so a long-lived, multi-tenant instance can't grow
// this unbounded; evict the oldest (first-inserted) org when a new one overflows.
const MAX_ORGS = 100;
const membersByOrg = new Map<string, { at: number; members: OrgMember[] }>();

/**
 * The members of the caller's active Clerk organization, for the admin
 * person↔user linking UI. Server-only. Returns an empty list when there is no
 * active org.
 *
 * v1 fetches a single page of 100 (an org here has a handful of members). If a
 * team ever exceeds that, this silently caps — revisit with pagination then.
 */
export async function listOrgMembers(): Promise<OrgMember[]> {
  const { orgId } = await auth();
  if (!orgId) return [];

  const cached = membersByOrg.get(orgId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.members;

  const members = await fetchOrgMembers(orgId);
  // Evict the oldest entry before caching a *new* org over the cap. Refreshing
  // an already-cached org just updates it in place (no growth, no eviction).
  if (!membersByOrg.has(orgId) && membersByOrg.size >= MAX_ORGS) {
    const oldest = membersByOrg.keys().next().value;
    if (oldest !== undefined) membersByOrg.delete(oldest);
  }
  membersByOrg.set(orgId, { at: Date.now(), members });
  return members;
}
