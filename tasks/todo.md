# Session: Direct Commission rule change — pay on EVERY purchase, not just first

Explicit business-rule change requested by project owner (not a bug fix —
confirmed the "first purchase only" behavior was working exactly as
designed; investigated the reported zero-commission case and found no
matching data in dev DB, likely a production-only scenario, and the user
decided to change the rule going forward rather than chase the original
report further).

## Scope, exactly as instructed
1. Remove/bypass the first-purchase-only gate in direct-commission.ts so
   commission fires on every investment purchase.
2. Update mlm_rules_log.md Section 4 to state the new rule.
3. tsc --noEmit, commit, push.
4. Explicitly do NOT retroactively pay commission for past purchases —
   only purchases from this point forward trigger it. No backfill script,
   no historical ledger writes.

## Design decision: keep isDirectCommissionTriggerPurchase or remove it?

`isDirectCommissionTriggerPurchase` is only consumed by
`payDirectCommissionInTx` (confirmed via grep — binary-tree.ts/rank.ts
only reference it in comments, no functional dependency). Removing the
gate means every purchase becomes a "trigger" by definition, so the
function itself becomes dead code once its one call site no longer calls
it displaying its old "is this the first" question.

Decision: DELETE `isDirectCommissionTriggerPurchase` entirely rather than
leaving an unused function around — matches project convention (no dead
code) and the ticket's own wording ("remove or bypass that gate"). Its
own tests (describe block "isDirectCommissionTriggerPurchase") get
deleted too, since they test behavior that will no longer exist as a
question the system asks.

## Files to touch
- [ ] `src/lib/direct-commission.ts`: delete `isDirectCommissionTriggerPurchase`,
      remove its call + early-return in `payDirectCommissionInTx`, update
      the function's own docstring (currently says "first purchase only",
      "no-op... the purchase isn't the buyer's first") and the module-level
      framing.
- [ ] `src/lib/direct-commission.test.ts`:
      - Delete the `describe("isDirectCommissionTriggerPurchase", ...)` block
        (4 tests) — tests a function that no longer exists.
      - Delete/rewrite `"does nothing for a non-first purchase, regardless
        of amount"` — this now asserts the OPPOSITE (a second purchase DOES
        pay commission). Rename and flip assertions.
      - Other tests (suspended sponsor/buyer, idempotency, no-sponsor,
        purchasePackage wiring, listDirectCommissionHistoryForUser) are
        unaffected — they all use a single first purchase already.
      - Add a new test: two consecutive purchases by the same sponsored
        user BOTH pay commission (the actual new behavior), confirming
        amounts and saving_lot count for each.
- [ ] `docs/mlm_rules_log.md` Section 4: replace "Trigger: a directly
      -sponsored user's first-ever package purchase only. Subsequent
      purchases... do NOT generate Direct Commission again." with the new
      rule: commission is paid on every purchase.
- [ ] Check other docs referencing "first purchase" for Direct Commission
      specifically (not MRV, which already has no such gate) — grep before
      assuming only mlm_rules_log.md needs updating.

## Non-goals (explicitly out of scope per instruction)
- No retroactive/backfill commission for past purchases.
- No change to MRV logic (already pays on every purchase — untouched).
- No change to Binary Commission, interest, or any other engine.
- No production data changes.

## Verification
- [x] tsc --noEmit clean
- [x] direct-commission.test.ts full pass (11/11) with rewritten tests,
      including new "second purchase pays commission" case
- [x] Full suite: 601/602 (1 pre-existing skip), 1 flaky security-headers
      timeout confirmed unrelated (passed clean in isolated re-run)
- [x] Also updated messages/en.json + ar.json's commissionHistoryDescription
      (Referrals page UI copy) — confirmed with user, was describing the
      old "first purchase" behavior and would have misled users
- [x] Commit + push
