import type { BinaryPosition, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { saturdayWeekStart } from "./binary-cycle";

/**
 * Placement tree only (binary_nodes) — completely independent from the
 * sponsor tree (users.sponsor_id). Never join or conflate the two (invariant
 * #5): a user's sponsor and their placement position are frequently
 * different people, by design (spillover).
 */

/**
 * Loads the sponsor's own binary_nodes row, lazily creating it as a fresh
 * tree root if it doesn't exist yet. A user must have a placement node
 * before anyone can be placed relative to them — this covers the case of a
 * root user (registerAsRoot) who was never anyone's referral, and is
 * therefore sponsoring their own first referral without ever having gone
 * through placement themselves.
 */
async function getOrCreateRootNode(userId: string, tx: Prisma.TransactionClient) {
  const existing = await tx.binaryNode.findUnique({ where: { userId } });
  if (existing) {
    return existing;
  }

  return tx.binaryNode.create({
    data: {
      userId,
      parentId: null,
      position: null,
      path: `/${userId}/`,
      depth: 0,
      leftBv: 0,
      rightBv: 0,
    },
  });
}

/**
 * Picks which of a node's two legs a new placement should spill into:
 * whichever has less accumulated BV. Ties (including the common
 * both-empty-at-registration case, since BV starts at 0 for everyone) always
 * resolve to LEFT — simplest deterministic rule, confirmed with the project
 * owner rather than assumed. This is also why a sponsor's first two direct
 * referrals land LEFT then RIGHT: referral 1 sees a 0/0 tie -> LEFT (now
 * occupied); referral 2 sees the same 0/0 sponsor-level BV comparison but
 * finds LEFT taken during the BFS scan, so RIGHT is the first open slot.
 */
function weakerLeg(leftBv: Prisma.Decimal, rightBv: Prisma.Decimal): BinaryPosition {
  return leftBv.lte(rightBv) ? "LEFT" : "RIGHT";
}

/**
 * BFS, starting at `rootUserId`'s own node, for the first node (in that
 * subtree only) with an open LEFT or RIGHT child slot — LEFT checked before
 * RIGHT at each dequeued node. This is the "search down from the referrer"
 * placement rule (docs/mlm_rules_log.md Section 5): once a leg is chosen at
 * the sponsor, the open slot can be anywhere down that leg's subtree, not
 * necessarily a direct child.
 */
async function findFirstOpenSlot(
  rootUserId: string,
  tx: Prisma.TransactionClient,
): Promise<{ parentId: string; position: BinaryPosition }> {
  const queue: string[] = [rootUserId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = await tx.binaryNode.findMany({
      where: { parentId: currentId },
      select: { userId: true, position: true },
    });

    const hasLeft = children.some((c) => c.position === "LEFT");
    if (!hasLeft) {
      return { parentId: currentId, position: "LEFT" };
    }
    const hasRight = children.some((c) => c.position === "RIGHT");
    if (!hasRight) {
      return { parentId: currentId, position: "RIGHT" };
    }

    for (const child of children) {
      queue.push(child.userId);
    }
  }

  // Unreachable: a subtree always has an open slot somewhere (BFS only
  // advances past a node once both its slots are confirmed full).
  throw new Error("No open placement slot found — this should be unreachable.");
}

/**
 * Places `newUserId` into `sponsorId`'s binary (placement) tree: BFS from
 * the sponsor's own node, spilling into whichever leg has less accumulated
 * BV (weakerLeg), then finding the first open slot down that leg specifically.
 *
 * `tx` is required, not optional (matches isDirectCommissionTriggerPurchase's
 * reasoning): this must run inside the same transaction as the new user's
 * creation, both so a crash leaves no orphaned half-registered user and so
 * two concurrent registrations under the same sponsor read/write consistent
 * tree state rather than racing on "first open slot" independently.
 */
export async function placeInBinaryTree(
  sponsorId: string,
  newUserId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const sponsorNode = await getOrCreateRootNode(sponsorId, tx);

  const directChildren = await tx.binaryNode.findMany({
    where: { parentId: sponsorId },
    select: { position: true },
  });
  const hasLeftChild = directChildren.some((c) => c.position === "LEFT");
  const hasRightChild = directChildren.some((c) => c.position === "RIGHT");

  // An open direct slot always wins over spilling deeper, regardless of BV
  // (BV-based weak-leg comparison only matters once both direct slots are
  // taken and real spillover is needed) — this is what makes the sponsor's
  // first two referrals land as direct LEFT then RIGHT children.
  let parentId: string;
  let position: BinaryPosition;
  if (!hasLeftChild) {
    parentId = sponsorId;
    position = "LEFT";
  } else if (!hasRightChild) {
    parentId = sponsorId;
    position = "RIGHT";
  } else {
    const leg = weakerLeg(sponsorNode.leftBv, sponsorNode.rightBv);
    const legRootId = (
      await tx.binaryNode.findFirstOrThrow({ where: { parentId: sponsorId, position: leg } })
    ).userId;
    ({ parentId, position } = await findFirstOpenSlot(legRootId, tx));
  }

  const parentNode = await tx.binaryNode.findUniqueOrThrow({ where: { userId: parentId } });

  await tx.binaryNode.create({
    data: {
      userId: newUserId,
      parentId,
      position,
      path: `${parentNode.path}${newUserId}/`,
      depth: parentNode.depth + 1,
      leftBv: 0,
      rightBv: 0,
    },
  });
}

/**
 * Splits a materialized path (e.g. "/root/mid/parent/buyer/") into its
 * ordered user-id segments, root first.
 */
function pathSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

/**
 * Rolls up BV for a package purchase: walks from the buyer up to the root
 * via the placement tree's materialized path, and for every ancestor,
 * inserts a bv_entries row on the leg the buyer sits under and increments
 * that ancestor's cached leftBv/rightBv by `amount`.
 *
 * Only real package purchases (including reinvestment) generate BV — never
 * profits, commissions, rank rewards, or transfers
 * (docs/mlm_rules_log.md Section 5). Callers must only invoke this from a
 * purchase flow, never from daily-interest/direct-commission/saving-lots/
 * capital-release/admin-credit code paths.
 *
 * Idempotent per ancestor via bv_entries' UNIQUE(ancestor_user_id,
 * source_investment_id) — an ancestor already rolled up for this
 * investmentId is skipped rather than double-inserted/double-incremented,
 * so replaying this call for the same investment is safe.
 *
 * `tx` is required, not optional (matches payDirectCommissionInTx's
 * reasoning): must run inside the same transaction as the purchase/
 * investment write, so a crash never leaves BV rolled up for an investment
 * that didn't actually get created, or vice versa.
 */
export async function rollupBvForPurchase(
  investmentId: string,
  buyerId: string,
  amount: Prisma.Decimal | string,
  forDate: Date,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const buyerNode = await tx.binaryNode.findUnique({ where: { userId: buyerId } });
  if (!buyerNode) {
    // The buyer has never been placed in any tree (e.g. a root user who has
    // never sponsored anyone, so no lazy root node exists yet) — no
    // ancestors are possible either way.
    return;
  }
  const segments = pathSegments(buyerNode.path);
  // Ancestors are every segment strictly above the buyer, i.e. everything
  // except the buyer's own trailing segment.
  const ancestorIds = segments.slice(0, -1);

  if (ancestorIds.length === 0) {
    // The buyer is the tree root — no ancestor to roll up to.
    return;
  }

  const cycleWeekStart = saturdayWeekStart(forDate);

  // Walk from the buyer's direct parent (closest ancestor, last in the
  // path) up to the root: the leg at each ancestor is whichever of its two
  // direct children the chain passes through next — the next segment
  // "below" that ancestor on the path toward the buyer.
  for (let i = ancestorIds.length - 1; i >= 0; i--) {
    const ancestorId = ancestorIds[i];
    const childOnPathId = i === ancestorIds.length - 1 ? buyerId : ancestorIds[i + 1];

    const existing = await tx.bvEntry.findUnique({
      where: { ancestorUserId_sourceInvestmentId: { ancestorUserId: ancestorId, sourceInvestmentId: investmentId } },
    });
    if (existing) {
      continue;
    }

    const childOnPathNode = await tx.binaryNode.findUniqueOrThrow({ where: { userId: childOnPathId } });
    const leg = childOnPathNode.position;
    if (!leg) {
      throw new Error(
        `Ancestor chain corruption: node ${childOnPathId} on the path to ${buyerId} has no position.`,
      );
    }

    await tx.bvEntry.create({
      data: {
        ancestorUserId: ancestorId,
        sourceInvestmentId: investmentId,
        leg,
        amount,
        cycleWeekStart,
      },
    });

    await tx.binaryNode.update({
      where: { userId: ancestorId },
      data: leg === "LEFT" ? { leftBv: { increment: amount } } : { rightBv: { increment: amount } },
    });
  }
}

export type SubtreeNode = {
  userId: string;
  name: string;
  position: BinaryPosition | null;
  children: SubtreeNode[];
};

/**
 * The logged-in user's own placement (binary) tree, rooted at their own
 * node, down to `maxDepth` levels of descendants. No target-user param —
 * ownership is enforced by construction (invariant #9): only ever call this
 * with the session's own userId, never a client-supplied id.
 *
 * Depth-capped rather than fetching the whole unbounded subtree (a user's
 * downline can be arbitrarily large per docs/build_plan.md's "Unlimited"
 * depth note) — deeper branches simply don't render in this first version
 * of the tree visualization.
 *
 * `position` is read directly off `binary_nodes.position` for every node,
 * including the root (always null for the viewer's own node, since a
 * user's own placement position is relative to THEIR parent, not
 * meaningful in a subtree rooted at themselves) — never inferred from
 * traversal order, array index, or anything else. Callers (the tree UI)
 * must do the same: LEFT/RIGHT is a data fact from this field, never
 * derived from render position.
 *
 * Returns null if the user has no binary_nodes row at all (never placed —
 * e.g. a root user who has never sponsored anyone), which the UI renders
 * as the empty/leaf state.
 */
export async function getMySubtree(userId: string, maxDepth: number): Promise<SubtreeNode | null> {
  const rootNode = await prisma.binaryNode.findUnique({
    where: { userId },
    include: { user: { select: { name: true } } },
  });
  if (!rootNode) {
    return null;
  }

  // Breadth-by-breadth fetch, one query per depth level, rather than a
  // single deep Prisma `include` chain (which would need maxDepth levels of
  // nested `include` written out) or an unbounded recursive query.
  const nodesByParent = new Map<string, SubtreeNode[]>();
  let currentLevelParentIds = [userId];

  for (let depth = 0; depth < maxDepth && currentLevelParentIds.length > 0; depth++) {
    const children = await prisma.binaryNode.findMany({
      where: { parentId: { in: currentLevelParentIds } },
      include: { user: { select: { name: true } } },
    });

    for (const child of children) {
      const node: SubtreeNode = {
        userId: child.userId,
        name: child.user.name,
        position: child.position,
        children: [],
      };
      const siblings = nodesByParent.get(child.parentId!) ?? [];
      siblings.push(node);
      nodesByParent.set(child.parentId!, siblings);
    }

    currentLevelParentIds = children.map((c) => c.userId);
  }

  function attachChildren(node: SubtreeNode): SubtreeNode {
    const children = nodesByParent.get(node.userId) ?? [];
    return { ...node, children: children.map(attachChildren) };
  }

  return attachChildren({
    userId: rootNode.userId,
    name: rootNode.user.name,
    position: rootNode.position,
    children: [],
  });
}
