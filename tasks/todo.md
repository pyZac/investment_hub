# Session: Binary tree page display improvements

Both improvements are display-only, no backend/business-logic changes to
paid amounts, ledger writes, or the cycle-close job. Bilingual EN/AR.

## Improvement 1 — personal BV on each tree node

- [ ] `src/lib/binary-tree.ts`: extend `SubtreeNode` with `personalBv: string`
      (a Decimal-as-string, "personal BV" = sum of that user's own
      `Investment.amount` — the amount that rolls up to ancestors per
      `rollupBvForPurchase`/mlm_rules_log.md Section 5's BV definition, not
      leftBv/rightBv which are subtree totals, not personal). Batch-fetch via
      one `groupBy` over all node userIds per depth level rather than N+1
      queries.
- [ ] `binary-tree-view.tsx`: thread `personalBv` through `toRawNodeDatum`'s
      `NodeAttributes`, render "BV: $X" under the name in `CustomNode`
      (format with `toDisplayWithCurrency`, `dir="ltr"` like the rest of the
      node's numeric bits). Root node included too — it has personal BV like
      any other node.
- [ ] Add/extend `messages/en.json` + `messages/ar.json`: a `nodeBvLabel` key
      ("BV" — stays English per financial-terminology rule, but the key
      itself still goes through next-intl for consistency/future-proofing).

## Improvement 2 — live leg volumes + estimated commission pre-close

- [ ] `src/lib/binary-cycle.ts`: export `activeCommissionConfigAt` (currently
      module-private) and add a new read-only
      `getMyCurrentLegVolumes(userId, now)`:
      - current week = `saturdayWeekStart(now)`
      - carry-in from the most recently closed cycle (prior week), same
        expiry logic as `closeBinaryCycleForUser` (reuse `applyExpiry`)
      - this week's BV via `bvEntry.groupBy` for `cycleWeekStart: currentWeekStart`
      - left/right = survivingCarry + thisWeek's BV (mirrors closeBinaryCycleForUser
        exactly, but never writes anything — no transaction, no postTransaction,
        no binaryCycle row)
      - estimated commission = min(left,right) * activeCommissionConfigAt(now).binaryRate / 100
      - weak leg = whichever of left/right is lower (tie -> LEFT, matching
        weakerLeg's existing tie rule in binary-tree.ts)
      - returns { leftVolume, rightVolume, weakLeg, estimatedCommission } as
        Decimal-as-strings
- [ ] `page.tsx`: fetch this alongside the existing latestCycle fetch, pass to
      `BinaryPanel` as a new `currentLegVolumes` prop, unconditionally
      (CONFIRMED with user: always show the live this-week-so-far section,
      for every user regardless of whether they have closed-cycle history).
- [ ] `binary-panel.tsx`: add a new section — always rendered, both in the
      `cycle === null` branch and alongside the existing closed-cycle summary
      — showing LEFT/RIGHT volume bars (reuse `VolumeBar`), weak-leg label,
      and the estimated commission, clearly marked as an estimate, not a
      guarantee (wording: "if the cycle closed right now").
- [ ] New translation keys: `currentLegVolumesHeading`, `weakLegLabel`,
      `estimatedCommissionLabel`, `estimatedCommissionNote` (disclaimer),
      `en.json` + `ar.json`.

## Verification
- [x] tsc --noEmit clean
- [x] New tests added: personalBv (binary-tree-subtree.test.ts, 2 new cases)
      and getMyCurrentLegVolumes (binary-cycle-close.test.ts, 3 new cases,
      including a direct cross-check against closeBinaryCycleForUser's real
      output for the same data)
- [x] Full suite: 605/606 passed (1 pre-existing skip), 0 reconciliation drift
- [ ] Manual browser check /en and /ar binary-tree page — BLOCKED: no
      marketer-flagged non-test user with tree data exists in dev, and both
      credential-materialization workarounds (setting a known password,
      minting a session token) were correctly denied by the sandbox as
      Secret-Store Writes / Credential Materialization. Verified instead via
      a read-only scratch script confirming getMySubtree/getMyCurrentLegVolumes
      return correct, expected values against real dev data (demo-user).
- [x] Commit + push
