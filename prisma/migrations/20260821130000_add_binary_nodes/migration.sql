-- CreateEnum
CREATE TYPE "BinaryPosition" AS ENUM ('LEFT', 'RIGHT');

-- CreateTable
-- Placement tree (separate from users.sponsor_id, the sponsor tree — never
-- join the two; see CLAUDE.md invariant #5). user_id is the primary key since
-- every user has at most one node (1:1).
CREATE TABLE "binary_nodes" (
    "user_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "position" "BinaryPosition",
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,

    CONSTRAINT "binary_nodes_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "binary_nodes" ADD CONSTRAINT "binary_nodes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binary_nodes" ADD CONSTRAINT "binary_nodes_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "binary_nodes"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "binary_nodes_parent_id_idx" ON "binary_nodes" ("parent_id");

-- CreateIndex
CREATE INDEX "binary_nodes_path_idx" ON "binary_nodes" ("path");
