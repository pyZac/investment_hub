import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot, registerWithSponsor } from "./users";
import { purchasePackage } from "./investments";
import { adminCreditWalletB } from "./admin-credit";
import { getMySubtree } from "./binary-tree";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];
const createdInvestmentIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

afterAll(async () => {
  await prisma.mrvPeriod.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.savingLot.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.bvEntry.deleteMany({ where: { ancestorUserId: { in: createdUserIds } } });
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.binaryNode.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function makeRoot(label: string) {
  const user = await registerAsRoot({
    email: `subtree-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: label,
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeReferral(sponsorId: string, label: string) {
  const user = await registerWithSponsor(sponsorId, {
    email: `subtree-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: label,
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeAndFundPackage(amount: string) {
  const pkg = await prisma.package.create({
    data: { name: `SubtreeBvTest-${crypto.randomUUID()}`, amount, isActive: true },
  });
  createdPackageIds.push(pkg.id);
  return pkg;
}

async function fundWalletB(userId: string, amount: string) {
  const mainAdmin = await prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
  await adminCreditWalletB(mainAdmin.id, {
    userId,
    amount,
    reason: "Test funding for subtree personal BV.",
    idempotencyKey: `subtree-bv-fund:${userId}:${crypto.randomUUID()}`,
  });
}

async function buyPackage(userId: string, amount: string) {
  await fundWalletB(userId, amount);
  const pkg = await makeAndFundPackage(amount);
  const result = await purchasePackage(userId, {
    packageId: pkg.id,
    forDate: new Date("2026-08-24T10:00:00.000Z"), // a Monday
    idempotencyKey: `subtree-bv-purchase:${userId}:${crypto.randomUUID()}`,
  });
  createdInvestmentIds.push(result.investment.id);
  return result;
}

describe("getMySubtree", () => {
  it("returns null for a user with no binary_nodes row at all (never placed)", async () => {
    const user = await makeRoot("no-node");
    const subtree = await getMySubtree(user.id, 5);
    expect(subtree).toBeNull();
  });

  it("returns just the root with an empty children array for a user with no downline", async () => {
    const sponsor = await makeRoot("leaf-sponsor");
    // Sponsoring creates the sponsor's own lazy root node.
    await makeReferral(sponsor.id, "leaf-referral");

    const subtree = await getMySubtree(sponsor.id, 5);
    expect(subtree).not.toBeNull();
    // The referral has its own leaf subtree with no children of its own.
    const referralSubtree = await getMySubtree(
      subtree!.children[0].userId,
      5,
    );
    expect(referralSubtree!.children).toEqual([]);
  });

  it("returns the correct multi-level shape with correct LEFT/RIGHT positions", async () => {
    const root = await makeRoot("shape-root");
    const left = await makeReferral(root.id, "shape-left"); // root's LEFT
    const right = await makeReferral(root.id, "shape-right"); // root's RIGHT
    const leftLeft = await makeReferral(left.id, "shape-left-left"); // left's LEFT

    const subtree = await getMySubtree(root.id, 5);

    expect(subtree!.userId).toBe(root.id);
    expect(subtree!.name).toBe("shape-root");
    expect(subtree!.position).toBeNull(); // root's own position is not meaningful in its own subtree
    expect(subtree!.children).toHaveLength(2);

    const leftNode = subtree!.children.find((c) => c.userId === left.id)!;
    const rightNode = subtree!.children.find((c) => c.userId === right.id)!;
    expect(leftNode.position).toBe("LEFT");
    expect(rightNode.position).toBe("RIGHT");

    expect(leftNode.children).toHaveLength(1);
    expect(leftNode.children[0].userId).toBe(leftLeft.id);
    expect(leftNode.children[0].position).toBe("LEFT");
    expect(leftNode.children[0].name).toBe("shape-left-left");

    expect(rightNode.children).toHaveLength(0);
  });

  it("respects the depth cap — a deeper real branch does not appear beyond maxDepth", async () => {
    const root = await makeRoot("depth-root");
    const level1 = await makeReferral(root.id, "depth-1");
    const level2 = await makeReferral(level1.id, "depth-2");
    await makeReferral(level2.id, "depth-3");

    // maxDepth 2: root (depth 0) -> level1 (depth 1) -> level2 (depth 2), but
    // level2's own child (depth 3) should not appear.
    const subtree = await getMySubtree(root.id, 2);

    expect(subtree!.children).toHaveLength(1);
    const l1 = subtree!.children[0];
    expect(l1.userId).toBe(level1.id);
    expect(l1.children).toHaveLength(1);
    const l2 = l1.children[0];
    expect(l2.userId).toBe(level2.id);
    expect(l2.children).toEqual([]);
  });

  it("never includes another user's subtree (isolation)", async () => {
    const sponsorA = await makeRoot("isolated-subtree-a");
    const sponsorB = await makeRoot("isolated-subtree-b");
    const referralA = await makeReferral(sponsorA.id, "isolated-subtree-a-ref");
    await makeReferral(sponsorB.id, "isolated-subtree-b-ref");

    const subtreeA = await getMySubtree(sponsorA.id, 5);
    expect(subtreeA!.children).toHaveLength(1);
    expect(subtreeA!.children[0].userId).toBe(referralA.id);

    function collectIds(node: NonNullable<typeof subtreeA>): string[] {
      return [node.userId, ...node.children.flatMap(collectIds)];
    }
    const idsInA = collectIds(subtreeA!);
    expect(idsInA).not.toContain(sponsorB.id);
  });

  it("reports each node's own personal BV (sum of their own investments), zero for a node with no purchases", async () => {
    const root = await makeRoot("bv-root");
    const left = await makeReferral(root.id, "bv-left"); // root's LEFT
    const right = await makeReferral(root.id, "bv-right"); // root's RIGHT, never purchases

    await buyPackage(root.id, "1000");
    await buyPackage(left.id, "2500");

    const subtree = await getMySubtree(root.id, 5);

    expect(new Prisma.Decimal(subtree!.personalBv).eq("1000")).toBe(true);
    const leftNode = subtree!.children.find((c) => c.userId === left.id)!;
    const rightNode = subtree!.children.find((c) => c.userId === right.id)!;
    expect(new Prisma.Decimal(leftNode.personalBv).eq("2500")).toBe(true);
    expect(new Prisma.Decimal(rightNode.personalBv).eq("0")).toBe(true);
  });

  it("sums MULTIPLE purchases by the same node into one personalBv total", async () => {
    const root = await makeRoot("bv-multi-root");
    await makeReferral(root.id, "bv-multi-referral"); // gives root its own lazy binary_nodes row
    await buyPackage(root.id, "500");
    await buyPackage(root.id, "750");

    const subtree = await getMySubtree(root.id, 5);

    expect(new Prisma.Decimal(subtree!.personalBv).eq("1250")).toBe(true);
  });
});
