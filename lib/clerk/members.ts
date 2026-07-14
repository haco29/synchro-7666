import { auth, clerkClient } from "@clerk/nextjs/server";

/** A Clerk org member reduced to what the admin link dropdown needs. */
export interface OrgMember {
  /** Clerk user id — the value stored in `people.clerk_user_id`. */
  userId: string;
  /** Display label: full name if present, else the identifier (email/phone). */
  label: string;
}

/**
 * The members of the caller's active Clerk organization, for the admin
 * person↔user linking UI. Server-only: reads the Clerk Backend API. Returns an
 * empty list when there is no active org.
 *
 * v1 fetches a single page of 100 (an org here has a handful of members). If a
 * team ever exceeds that, this silently caps — revisit with pagination then.
 */
export async function listOrgMembers(): Promise<OrgMember[]> {
  const { orgId } = await auth();
  if (!orgId) return [];

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
