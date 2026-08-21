import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { registerAsRoot, registerWithSponsor } from "./users";
import { placeInBinaryTree } from "./binary-tree";

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
    email: `bintree-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: label,
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeReferral(sponsorId: string, label: string) {
  const user = await registerWithSponsor(sponsorId, {
    email: `bintree-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: label,
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

describe("placeInBinaryTree (via registerWithSponsor)", () => {
  it("places the first two referrals as the sponsor's direct LEFT then RIGHT children", async () => {
    const sponsor = await makeRoot("empty-sponsor");

    const first = await makeReferral(sponsor.id, "first-referral");
    const firstNode = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: first.id } });
    expect(firstNode.parentId).toBe(sponsor.id);
    expect(firstNode.position).toBe("LEFT");
    expect(firstNode.depth).toBe(1);
    expect(firstNode.path).toBe(`/${sponsor.id}/${first.id}/`);

    const second = await makeReferral(sponsor.id, "second-referral");
    const secondNode = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: second.id } });
    expect(secondNode.parentId).toBe(sponsor.id);
    expect(secondNode.position).toBe("RIGHT");
    expect(secondNode.depth).toBe(1);
  });

  it("spills a third referral to the first open slot via BFS, not as a third direct child", async () => {
    const sponsor = await makeRoot("spillover-sponsor");
    const left = await makeReferral(sponsor.id, "spillover-left");
    await makeReferral(sponsor.id, "spillover-right");

    const third = await makeReferral(sponsor.id, "spillover-third");
    const thirdNode = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: third.id } });

    // Both direct slots are full, both legs still tied at 0 BV -> LEFT chosen
    // at the sponsor -> BFS down the LEFT subtree finds `left`'s own LEFT
    // slot open (its first child).
    expect(thirdNode.parentId).toBe(left.id);
    expect(thirdNode.position).toBe("LEFT");
    expect(thirdNode.depth).toBe(2);
    expect(thirdNode.parentId).not.toBe(sponsor.id);
  });

  it("resolves an explicit BV tie deterministically to LEFT, repeatably", async () => {
    const sponsor = await makeRoot("tie-sponsor");
    // Fill both direct slots first so the next placement is genuine
    // BV-based spillover, not the open-direct-slot fast path.
    const left = await makeReferral(sponsor.id, "tie-left");
    await makeReferral(sponsor.id, "tie-right");
    await prisma.binaryNode.update({
      where: { userId: sponsor.id },
      data: { leftBv: "500", rightBv: "500" },
    });

    const first = await makeReferral(sponsor.id, "tie-first");
    const firstNode = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: first.id } });
    // Tie -> LEFT leg chosen -> BFS into `left`'s subtree -> its own open LEFT child.
    expect(firstNode.parentId).toBe(left.id);
    expect(firstNode.position).toBe("LEFT");

    // Re-assert the tie (placement itself doesn't touch BV) and confirm the
    // rule is stable across repeated calls, not just correct once.
    await prisma.binaryNode.update({
      where: { userId: sponsor.id },
      data: { leftBv: "500", rightBv: "500" },
    });
    const second = await makeReferral(sponsor.id, "tie-second");
    const secondNode = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: second.id } });
    // LEFT leg chosen again; `left`'s LEFT child slot is now taken by
    // `first`, so BFS finds `left`'s RIGHT slot open next.
    expect(secondNode.parentId).toBe(left.id);
    expect(secondNode.position).toBe("RIGHT");
  });

  it("targets only the given sponsor's own tree, never another sponsor's", async () => {
    const sponsorA = await makeRoot("isolated-a");
    const sponsorB = await makeRoot("isolated-b");

    const referralA = await makeReferral(sponsorA.id, "isolated-a-ref");
    const referralB = await makeReferral(sponsorB.id, "isolated-b-ref");

    const nodeA = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: referralA.id } });
    const nodeB = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: referralB.id } });

    expect(nodeA.parentId).toBe(sponsorA.id);
    expect(nodeB.parentId).toBe(sponsorB.id);
    expect(nodeA.path.startsWith(`/${sponsorA.id}/`)).toBe(true);
    expect(nodeB.path.startsWith(`/${sponsorB.id}/`)).toBe(true);

    // Sponsor A's node totals must be untouched by sponsor B's placement.
    const sponsorANode = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: sponsorA.id } });
    expect(sponsorANode.leftBv.equals(0)).toBe(true);
    expect(sponsorANode.rightBv.equals(0)).toBe(true);
  });

  it("lazily creates a root binary_nodes row for a sponsor who was never placed themselves", async () => {
    const sponsor = await makeRoot("lazy-root-sponsor");
    const existingBefore = await prisma.binaryNode.findUnique({ where: { userId: sponsor.id } });
    expect(existingBefore).toBeNull();

    const referral = await makeReferral(sponsor.id, "lazy-root-referral");

    const sponsorNode = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: sponsor.id } });
    expect(sponsorNode.parentId).toBeNull();
    expect(sponsorNode.position).toBeNull();
    expect(sponsorNode.depth).toBe(0);
    expect(sponsorNode.path).toBe(`/${sponsor.id}/`);

    const referralNode = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: referral.id } });
    expect(referralNode.parentId).toBe(sponsor.id);
  });

  it("throws when placing under a sponsor id with no user (misuse, not a normal path)", async () => {
    await expect(
      prisma.$transaction((tx) => placeInBinaryTree("nonexistent-sponsor-id", "irrelevant-new-id", tx)),
    ).rejects.toThrow();
  });
});
