-- AlterTable
-- Cached per-node BV totals for each of the node's own two legs (not the
-- whole subtree). Avoids summing the subtree on every placement/rollup read
-- (see docs/phases/phase-07-placement-tree-bv.md). Populated at 0/0 here;
-- incremented by real purchase amounts only in the BV rollup work (SCRUM-71).
ALTER TABLE "binary_nodes" ADD COLUMN "left_bv" DECIMAL(24,8) NOT NULL DEFAULT 0;
ALTER TABLE "binary_nodes" ADD COLUMN "right_bv" DECIMAL(24,8) NOT NULL DEFAULT 0;
