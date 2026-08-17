-- The previous migration's partial unique index (`interest_rate_config_one_active`,
-- UNIQUE btree on effective_to WHERE effective_to IS NULL) did NOT enforce
-- "at most one active row" as intended: Postgres treats every NULL as distinct
-- for uniqueness purposes, even inside a partial index, and effective_to is
-- NULL on every active row by definition. Indexing the nullable column itself
-- can never catch a second NULL — verified by inserting three concurrent
-- effective_to IS NULL rows without conflict. Same root cause as the
-- ledger_entries idempotency-key NULL-collision bug from Phase 2 (see
-- tasks/lessons.md), applied to a different column.
--
-- Fix: index a constant expression (TRUE) instead of the nullable column,
-- still filtered to only active rows. Now every indexed row has the same
-- non-null key (TRUE), so a second INSERT with effective_to IS NULL collides
-- as intended.
DROP INDEX IF EXISTS "interest_rate_config_one_active";

CREATE UNIQUE INDEX "interest_rate_config_one_active"
  ON "interest_rate_config" ((TRUE))
  WHERE "effective_to" IS NULL;
