-- DropIndex
DROP INDEX "ledger_entries_idempotency_key_key";

-- CreateIndex
-- All rows written by one postTransaction() call share the same idempotency_key
-- (one key per logical transaction, not per row). The composite scopes uniqueness
-- to (key, user, wallet, direction) so a call's debit and credit rows can coexist,
-- and a call crediting the same wallet type for two different users in one
-- transaction (e.g. a binary commission split) doesn't collide either — while a
-- replay of the exact same call still hits this constraint per row.
--
-- user_id is coalesced to a sentinel because Postgres treats every NULL in a
-- unique index as distinct from every other NULL — without this, two
-- SYSTEM_EXTERNAL rows (user_id IS NULL) sharing a key/wallet/direction would
-- NOT collide, silently defeating the UNIQUE guarantee for exactly the rows
-- that represent money entering/leaving the simulation.
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_user_id_wallet_direction_key"
  ON "ledger_entries"("idempotency_key", (COALESCE("user_id", 'SYSTEM_EXTERNAL')), "wallet", "direction");
