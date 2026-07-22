import { beforeEach, describe, expect, it, vi } from "vitest";

// Both the active-org read and the Backend client are stubbed per test.
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));

import { auth, clerkClient } from "@clerk/nextjs/server";
import { fetchOrgMembers, listOrgMembers } from "./members";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const clerkClientMock = clerkClient as unknown as ReturnType<typeof vi.fn>;

function stubMembership(data: unknown[]) {
  const getOrganizationMembershipList = vi.fn().mockResolvedValue({ data });
  clerkClientMock.mockResolvedValue({
    organizations: { getOrganizationMembershipList },
  });
  return getOrganizationMembershipList;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// The fetch/map logic is exercised through the uncached `fetchOrgMembers` so
// the per-org TTL cache in `listOrgMembers` can't leak state between cases.
describe("fetchOrgMembers", () => {
  it("maps members to {userId, label}, preferring full name", async () => {
    stubMembership([
      {
        publicUserData: {
          userId: "user_1",
          firstName: "Dana",
          lastName: "Levi",
          identifier: "dana@x.com",
        },
      },
    ]);

    expect(await fetchOrgMembers("org_A")).toEqual([{ userId: "user_1", label: "Dana Levi" }]);
  });

  it("falls back to the identifier when there is no name", async () => {
    stubMembership([
      {
        publicUserData: {
          userId: "user_2",
          firstName: null,
          lastName: null,
          identifier: "roni@x.com",
        },
      },
    ]);

    expect(await fetchOrgMembers("org_A")).toEqual([{ userId: "user_2", label: "roni@x.com" }]);
  });

  it("skips memberships with no public user data", async () => {
    stubMembership([
      { publicUserData: null },
      {
        publicUserData: {
          userId: "user_3",
          firstName: "Ada",
          lastName: null,
          identifier: "ada@x.com",
        },
      },
    ]);

    expect(await fetchOrgMembers("org_A")).toEqual([{ userId: "user_3", label: "Ada" }]);
  });

  it("passes the org id and a page limit to Clerk", async () => {
    const list = stubMembership([]);

    await fetchOrgMembers("org_A");

    expect(list).toHaveBeenCalledWith({ organizationId: "org_A", limit: 100 });
  });
});

describe("listOrgMembers", () => {
  it("returns an empty list when there is no active org", async () => {
    authMock.mockResolvedValue({ orgId: null });
    const list = stubMembership([]);

    expect(await listOrgMembers()).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it("caches per org and serves a warm org without re-hitting Clerk", async () => {
    authMock.mockResolvedValue({ orgId: "org_warm" });
    const list = stubMembership([]);

    await listOrgMembers();
    await listOrgMembers();

    expect(list).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it("evicts the oldest org once the cache is over capacity", async () => {
    const list = stubMembership([]);

    // Cache an org, then insert a full cap's worth (100) of fresh orgs — enough
    // to fill the cache entirely and push the earlier org out (FIFO).
    authMock.mockResolvedValue({ orgId: "org_oldest" });
    await listOrgMembers();
    for (let i = 0; i < 100; i++) {
      authMock.mockResolvedValue({ orgId: `org_fill_${i}` });
      await listOrgMembers();
    }

    const callsAfterFill = list.mock.calls.length;

    // The most-recent fill org is still warm → no refetch.
    authMock.mockResolvedValue({ orgId: "org_fill_99" });
    await listOrgMembers();
    expect(list.mock.calls.length).toBe(callsAfterFill);

    // org_oldest was evicted → refetch.
    authMock.mockResolvedValue({ orgId: "org_oldest" });
    await listOrgMembers();
    expect(list.mock.calls.length).toBe(callsAfterFill + 1);
  });
});
