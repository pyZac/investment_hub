import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { registerAsRoot, registerWithSponsor } from "./users";
import { getMySubtree } from "./binary-tree";

const createdUserIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

afterAll(async () => {
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
});
