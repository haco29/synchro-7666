import { beforeEach, describe, expect, it, vi } from "vitest";

// Both the active-org read and the Backend client are stubbed per test.
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));

import { auth, clerkClient } from "@clerk/nextjs/server";
import { listOrgMembers } from "./members";

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

describe("listOrgMembers", () => {
  it("maps members to {userId, label}, preferring full name", async () => {
    authMock.mockResolvedValue({ orgId: "org_A" });
    stubMembership([
      { publicUserData: { userId: "user_1", firstName: "Dana", lastName: "Levi", identifier: "dana@x.com" } },
    ]);

    expect(await listOrgMembers()).toEqual([{ userId: "user_1", label: "Dana Levi" }]);
  });

  it("falls back to the identifier when there is no name", async () => {
    authMock.mockResolvedValue({ orgId: "org_A" });
    stubMembership([
      { publicUserData: { userId: "user_2", firstName: null, lastName: null, identifier: "roni@x.com" } },
    ]);

    expect(await listOrgMembers()).toEqual([{ userId: "user_2", label: "roni@x.com" }]);
  });

  it("skips memberships with no public user data", async () => {
    authMock.mockResolvedValue({ orgId: "org_A" });
    stubMembership([
      { publicUserData: null },
      { publicUserData: { userId: "user_3", firstName: "Ada", lastName: null, identifier: "ada@x.com" } },
    ]);

    expect(await listOrgMembers()).toEqual([{ userId: "user_3", label: "Ada" }]);
  });

  it("returns an empty list when there is no active org", async () => {
    authMock.mockResolvedValue({ orgId: null });
    const list = stubMembership([]);

    expect(await listOrgMembers()).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it("passes the active org id and a page limit to Clerk", async () => {
    authMock.mockResolvedValue({ orgId: "org_A" });
    const list = stubMembership([]);

    await listOrgMembers();

    expect(list).toHaveBeenCalledWith({ organizationId: "org_A", limit: 100 });
  });
});
