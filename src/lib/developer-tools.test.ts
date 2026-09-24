import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { getFridayBypassStatus, setFridayBypass } from "./developer-tools";
import { DEVELOPER_TOOLS_SETTINGS_ID } from "./developer-tools-constants";

const createdUserIds: string[] = [];

async function getMainAdmin() {
  return prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
}

async function makeSubAdmin() {
  const admin = await prisma.user.create({
    data: {
      email: `dev-tools-subadmin-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test Sub-Admin",
      role: "ADMIN",
    },
  });
  createdUserIds.push(admin.id);
  return admin;
}

afterEach(async () => {
  // Restore the real shared singleton row to its default (off, unattributed)
  // after every test — other test files assume the Friday gate is genuinely
  // active unless they turn the bypass on themselves.
  await prisma.developerToolsSetting.update({
    where: { id: DEVELOPER_TOOLS_SETTINGS_ID },
    data: { bypassFridayGate: false, updatedByAdminId: null },
  });
});

afterAll(async () => {
  await prisma.adminAction.deleteMany({ where: { adminId: { in: createdUserIds } } });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("getFridayBypassStatus / setFridayBypass", () => {
  it("rejects a sub-admin without DEVELOPER_TOOLS", async () => {
    const subAdmin = await makeSubAdmin();
    await expect(getFridayBypassStatus(subAdmin.id)).rejects.toThrow(/forbidden/i);
    await expect(setFridayBypass(subAdmin.id, true)).rejects.toThrow(/forbidden/i);
  });

  it("allows a sub-admin with DEVELOPER_TOOLS", async () => {
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "DEVELOPER_TOOLS" },
    });

    await expect(setFridayBypass(subAdmin.id, true)).resolves.not.toThrow();
  });

  it("the main admin reaches it with zero explicit grants", async () => {
    const mainAdmin = await getMainAdmin();
    await expect(getFridayBypassStatus(mainAdmin.id)).resolves.not.toThrow();
  });

  it("defaults to disabled with no attribution", async () => {
    const mainAdmin = await getMainAdmin();
    const status = await getFridayBypassStatus(mainAdmin.id);
    expect(status.enabled).toBe(false);
  });

  it("turning it on is reflected immediately in getFridayBypassStatus, with the acting admin attributed", async () => {
    const mainAdmin = await getMainAdmin();

    await setFridayBypass(mainAdmin.id, true);

    const status = await getFridayBypassStatus(mainAdmin.id);
    expect(status.enabled).toBe(true);
    expect(status.updatedByAdminName).toBe(mainAdmin.name);
  });

  it("turning it back off is reflected immediately", async () => {
    const mainAdmin = await getMainAdmin();

    await setFridayBypass(mainAdmin.id, true);
    await setFridayBypass(mainAdmin.id, false);

    const status = await getFridayBypassStatus(mainAdmin.id);
    expect(status.enabled).toBe(false);
  });

  it("logs FRIDAY_GATE_BYPASS_TOGGLED to admin_actions, attributable to the acting admin", async () => {
    const mainAdmin = await getMainAdmin();

    await setFridayBypass(mainAdmin.id, true);

    const action = await prisma.adminAction.findFirst({
      where: { adminId: mainAdmin.id, actionType: "FRIDAY_GATE_BYPASS_TOGGLED" },
      orderBy: { createdAt: "desc" },
    });
    expect(action).not.toBeNull();
    expect(action!.reason).toMatch(/ON/);
  });

  it("attributes a second toggle to a different admin correctly (updatedByAdminId is the LAST admin to touch it, not the first)", async () => {
    const mainAdmin = await getMainAdmin();
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "DEVELOPER_TOOLS" },
    });

    await setFridayBypass(mainAdmin.id, true);
    await setFridayBypass(subAdmin.id, false);

    const status = await getFridayBypassStatus(mainAdmin.id);
    expect(status.updatedByAdminName).toBe(subAdmin.name);
  });
});
