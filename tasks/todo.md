# Phase 7 — Placement Tree & BV Rollup

## SCRUM-69: binary_nodes table — DONE

- [x] Added `BinaryNode` model (`binary_nodes`, migration
      `20260821130000_add_binary_nodes`, applied via `migrate deploy` per the
      standing hand-edited-migration rule) — `userId` is the primary key
      itself (1:1 with users, not a separate `id` + unique constraint),
      `parentId` self-references `binary_nodes.user_id` (nullable for root),
      `position` enum LEFT/RIGHT (nullable — only the root has none), `path`
      materialized (cuid segments, e.g. `/cuid1/cuid2/cuid3/` — the doc's
      `/1/4/9/` example is illustrative, this project uses cuids not
      sequential ints), `depth` int. Both FKs `ON DELETE RESTRICT` (matches
      invariant #7, no hard delete on users). Indexed on `parentId` and
      `path`.
- [x] Confirmed via `\d binary_nodes` and `prisma migrate status` /
      `tsc --noEmit` clean.

## SCRUM-70: placement algorithm (BFS, weaker-BV leg) — DONE

Confirmed with user before implementing:
- Cached per-node BV total needs a schema addition now (leftBv/rightBv on
  binary_nodes) rather than summing subtrees on every registration — the
  phase brief explicitly suggests this. SCRUM-71 (BV rollup) will be what
  actually increments these to nonzero values; this task adds the columns
  and reads/writes them (always 0 delta at registration time, since a
  brand-new node contributes no BV of its own).
- Tie-break rule (equal or zero BV on both legs): always prefer LEFT,
  deterministic and simplest, matches the phase brief's own suggested
  default. The "first two referrals become direct LEFT then RIGHT children"
  behavior falls out of this rule naturally (LEFT fills on referral 1,
  becomes occupied, so referral 2's LEFT-preference finds LEFT taken at the
  sponsor and takes RIGHT) — not a special-cased "first two children" rule.

Plan:
- [ ] Migration: add `leftBv`/`rightBv` `Decimal(24,8)` columns to
      `binary_nodes`, default 0. Hand-written migration +
      `migrate deploy` (standing rule).
- [ ] `src/lib/binary-tree.ts` (new file): `placeInBinaryTree(sponsorId,
      newUserId, tx)`:
      1. Load the sponsor's `binary_nodes` row. If the sponsor has none yet
         (e.g. a root user who was never placed as anyone's referral),
         create it as a tree root: `parentId: null`, `position: null`,
         `path: "/{sponsorId}/"`, `depth: 0`, `leftBv/rightBv: 0` — a
         sponsor must have a placement node before their own referral can
         be placed relative to it.
      2. Pick target leg at the sponsor: `leftBv <= rightBv ? LEFT : RIGHT`
         (covers both the tie and the empty case, per the LEFT-preference
         rule).
      3. BFS from the sponsor's direct child on that leg (if empty, the
         slot is the sponsor's own direct child — done immediately). BFS
         queue explores nodes leg-subtree-wide; at each dequeued node,
         check LEFT then RIGHT for an open child slot (checked via
         `parentId` absence at that position, not a separate "has children"
         field) — first open slot found (LEFT-checked-before-RIGHT at each
         node, standard BFS/queue order) wins.
      4. Create the new `binary_nodes` row: `parentId` = the found node's
         userId, `position` = the found open slot's side, `path` = parent's
         path + newUserId + '/', `depth` = parent's depth + 1, `leftBv`/
         `rightBv` = 0.
      5. Takes `tx: Prisma.TransactionClient` (required, not optional) —
         called from the registration flow inside the same transaction as
         user creation, matching `isDirectCommissionTriggerPurchase`'s
         reasoning: two concurrent registrations under the same sponsor
         must not both read the same "first open slot" and collide:
         relies on the FK + this being invoked inside the caller's write
         transaction for consistency, no separate advisory lock added
         (matches this codebase's existing pattern of leaning on tx
         atomicity rather than explicit locking elsewhere).
- [ ] Wire into `src/lib/users.ts`: both `registerWithSponsor` and
      `adminCreateUser` (when a sponsorId is given) call
      `placeInBinaryTree(sponsorId, user.id, tx)` inside their existing
      transaction, right after `tx.user.create(...)`. `registerAsRoot`
      does NOT call it — a root user gets no placement node until/unless
      they later sponsor someone (lazily created at that point, per step 1
      above) or an admin explicitly wants every root pre-placed (out of
      scope here per the ticket's own framing: this ticket is about the
      placement algorithm itself, not about backfilling roots).
- [ ] Tests first (`binary-tree.test.ts`):
      - sponsor with an empty tree: first referral placed as sponsor's
        direct LEFT child (position, parentId, path, depth all correct);
        second referral placed as sponsor's direct RIGHT child (both legs
        at 0 BV, LEFT already taken -> RIGHT chosen)
      - third referral (spillover): with both direct slots full, BFS finds
        the first open slot down the weaker leg (construct a case where
        it's unambiguous which leg is weaker via manually-seeded
        leftBv/rightBv, then confirm placement lands under the correct
        existing node via BFS order, not as some other structure)
      - tie resolution: explicit equal nonzero leftBv/rightBv at the
        sponsor deterministically picks LEFT every time (call multiple
        times / assert repeatably, not just once)
      - placement targets the sponsor's tree specifically: two independent
        sponsors' trees don't interfere — placing under sponsor A never
        touches or reads sponsor B's nodes/BV
      - a sponsor with no existing binary_nodes row (root never previously
        placed) gets lazily created as a tree root before their referral
        is placed under them
- [x] Migration `20260821140000_add_binary_nodes_bv_cache`: added
      `leftBv`/`rightBv` Decimal(24,8) columns to `binary_nodes`, default 0.
      Applied via `migrate deploy` + `prisma generate`.
- [x] `src/lib/binary-tree.ts`: `placeInBinaryTree(sponsorId, newUserId,
      tx)`. Real algorithm bug found and fixed during testing (not caught
      by design review): the first draft picked a weak leg once at the
      sponsor (tie -> LEFT) and then BFS'd only within that leg's subtree —
      so on a 0/0 tie, the second referral spilled deeper into LEFT
      (since LEFT's direct slot was already taken) instead of landing in
      the sponsor's still-empty RIGHT slot, breaking the "first two
      referrals become direct LEFT/RIGHT children" requirement. Confirmed
      fix with user: an open direct slot at the sponsor always wins over
      spilling deeper, regardless of BV — the BV-weak-leg-then-BFS logic
      only kicks in once BOTH of the sponsor's direct slots are already
      taken. `getOrCreateRootNode` lazily creates a binary_nodes row for a
      sponsor who has none yet (a root user who's never been placed
      themselves, since only sponsored placements are wired in, not
      registerAsRoot).
- [x] Wired into `src/lib/users.ts`: `registerWithSponsor` always calls
      `placeInBinaryTree`; `adminCreateUser` calls it only when a
      `sponsorId` was given. `registerAsRoot` does not call it (no
      placement to make relative to since there's no sponsor) — a root
      user's own node is created lazily, on demand, the first time they
      sponsor someone.
- [x] `src/lib/binary-tree.test.ts`: 6 tests, all passing — first two
      referrals land as direct LEFT then RIGHT children; a third referral
      spills via BFS to the correct existing node's open slot (not a third
      direct child); an explicit BV tie at the sponsor resolves to LEFT
      deterministically across two consecutive calls; two independent
      sponsors' trees never interfere (including BV totals staying
      untouched); a sponsor with no pre-existing binary_nodes row gets one
      lazily created as a tree root before their referral is placed;
      placing under a nonexistent sponsor id throws (FK violation, not a
      silently wrong placement).
- [x] Found and fixed a real gap surfaced only by running the FULL suite
      (not just the new file): `users.test.ts` and `direct-commission.test
      .ts` both predate binary_nodes and clean up in the order
      securityQuestion -> walletAccount -> user, which now fails on
      `binary_nodes_user_id_fkey` (RESTRICT) since those files' sponsor
      -chain tests now create binary_nodes rows as a side effect of calling
      `registerWithSponsor`. Fixed by adding `binaryNode.deleteMany` before
      `user.deleteMany` in both files' `afterAll`.
- [x] The first full-suite run (before that fix) left 28 orphaned
      binary_nodes-linked test users behind from its failed cleanup.
      Investigated before deleting anything: queried exactly which users
      binary_nodes referenced (all matched the `direct-commission-*`/
      `sponsor-*`/`referred-*`/`list-*` naming from those two files' own
      test runs, none were the main admin), then found 31 MORE unrelated
      `test.local` leftover users (`pkg-admin-*`/`pkg-user-*`, dated back to
      2026-08-15 — pre-existing leftover data from Phase 3, not from this
      session) while scoping the cleanup query. Removed all 59 as one
      cleanup pass (all clearly test-pattern emails, zero real users, zero
      main admin) via a scratch script using `cleanupLedgerEntriesForUsers`
      + a leaf-first repeated-delete loop for binary_nodes (self-FK
      RESTRICT means children must go before parents) — not a plain
      `deleteMany`, which would fail the same way the test cleanup did.
      Verified `reconciliation.test.ts` clean after, then ran the full
      suite fresh as final proof: 33 files, 228/228 passing. Scratch
      scripts deleted; `git status` confirms no trace.
- [x] Full suite: 33 files, 228/228 passing, including
      `reconciliation.test.ts` clean. `tsc --noEmit` clean.

## SCRUM-71: bv_entries table + BV rollup on purchase — DONE

Confirmed with user: `bv_entries.cycle_week_start` needs a real Saturday
-start weekly-cycle boundary (Asia/Dubai), not just the raw purchase
timestamp — adding a small `saturdayWeekStart(forDate): Date` helper as
part of this task (the actual weekly binary-commission cycle/payout logic
itself is out of scope here, this is only for correctly stamping the
column).

Plan:
- [ ] Migration: `bv_entries` table — id, ancestorUserId (FK ->
      binary_nodes.user_id, since every ancestor already has a node by
      construction), sourceInvestmentId (FK -> investments.id), leg
      (LEFT|RIGHT), amount Decimal(24,8), cycleWeekStart, createdAt.
      `UNIQUE(ancestor_user_id, source_investment_id)` — prevents an
      ancestor from ever double-counting the same purchase (also acts as
      the replay guard, no separate idempotency key needed since this
      isn't a ledger write).
- [ ] `src/lib/binary-cycle.ts` (new, small): `saturdayWeekStart(forDate:
      Date): Date` — walks back to the most recent Saturday 00:00 in
      Asia/Dubai, mirrors `isFriday`'s Intl.DateTimeFormat pattern from
      interest-rate.ts. Small test file alongside.
- [ ] `src/lib/binary-tree.ts`: add `rollupBvForPurchase(investmentId,
      buyerId, amount, forDate, tx)`:
      1. Load the buyer's binary_nodes row (path, e.g.
         `/root/.../grandparent/parent/buyer/`).
      2. Parse `path` into its ordered list of ancestor user ids
         (everyone strictly above the buyer — the buyer's own trailing
         segment excluded).
      3. For each ancestor, walking from the buyer's direct parent up to
         the root: the "leg" is which of the ancestor's two direct
         children the chain passes through next — read directly off the
         next path segment's own binary_nodes.position (LEFT/RIGHT), not
         re-derived some other way.
      4. For each (ancestor, leg): skip if a bv_entries row already
         exists for (ancestorUserId, sourceInvestmentId) — replay guard.
         Otherwise: create the bv_entries row, and atomically increment
         that ancestor's binary_nodes.leftBv or rightBv by `amount`
         (`{ increment: amount }`, not a read-then-write, to stay correct
         under concurrent purchases in different transactions).
      5. cycleWeekStart = `saturdayWeekStart(forDate)`.
      Takes `tx: Prisma.TransactionClient` (required) — must run inside
      the same transaction as the purchase/investment write, matching
      payDirectCommissionInTx's reasoning.
- [ ] Wire into `src/lib/investments.ts`: `purchasePackage` calls
      `rollupBvForPurchase(investment.id, userId, pkg.amount, data.forDate,
      tx)` right after `payDirectCommissionInTx`, only on the
      newly-created path. Package purchases ONLY — never called from
      daily-interest, direct-commission, saving-lots, capital-release, or
      admin-credit code paths (per the BV definition: purchases only,
      never profits/commissions/rank rewards/transfers).
- [ ] Tests first (`binary-tree.test.ts`, extending the existing
      describe blocks, or a new `bv-rollup.test.ts` — decide at build
      time based on file size):
      - a purchase at the bottom of a real multi-level tree (built via
        real registerWithSponsor/spillover placements, not hand-crafted
        binary_nodes rows) creates a bv_entries row for EVERY ancestor up
        to the root, each with the correct leg (cross-check against each
        ancestor's actual position relative to the buyer) and the correct
        amount; cached leftBv/rightBv on every ancestor's binary_nodes
        row matches the sum of bv_entries for that ancestor exactly.
      - a DAILY_INTEREST credit and a DIRECT_COMMISSION credit each
        create zero bv_entries rows and leave every ancestor's
        leftBv/rightBv unchanged (call the real accrual/commission
        functions, not a simulated ledger write).
      - replaying rollupBvForPurchase for the same investmentId a second
        time creates no duplicate bv_entries rows and does not
        double-increment any ancestor's cached BV.
      - end-to-end via purchasePackage itself (not just the internal
        rollup function directly): one purchase call results in correct
        bv_entries + cached totals for the whole ancestor chain in one
        step.
- [x] Migration `20260822090000_add_bv_entries`: `bv_entries` table — id,
      ancestorUserId (FK -> binary_nodes.user_id, RESTRICT), sourceInvestmentId
      (FK -> investments.id, RESTRICT), leg, amount Decimal(24,8),
      cycleWeekStart, createdAt. UNIQUE(ancestor_user_id,
      source_investment_id). Applied via `migrate deploy` + `prisma generate`.
- [x] `src/lib/binary-cycle.ts`: `saturdayWeekStart(forDate): Date` — walks
      back to the most recent Saturday 00:00 Asia/Dubai, mirrors
      interest-rate.ts's isFriday Intl.DateTimeFormat pattern. 4 tests in
      `binary-cycle.test.ts`, all passing (same-Saturday input, mid-week
      walk-back, Friday-closes-the-week case, UTC/Dubai boundary case).
- [x] Found and fixed a real, previously-latent environment gap while
      building this file: `config.ts`'s env validation silently depended
      on something ELSE in the module graph importing `./prisma` first,
      because `@prisma/client`'s runtime bundles `dotenv` and loads `.env`
      as a side effect of `new PrismaClient()` — `config.ts` itself never
      loaded `.env`. Every existing test file happened to import
      `./prisma` transitively, so this never surfaced until
      `binary-cycle.ts` (a pure function needing only `config.TIMEZONE`,
      no DB access) didn't. Confirmed with user and fixed: added
      `import "dotenv/config"` at the top of `config.ts` itself, so any
      module reading `config.*` is self-sufficient. Verified via
      `binary-cycle.test.ts` run in complete isolation (no other file),
      which failed with `DATABASE_URL`/`SEED_ADMIN_*` validation errors
      before the fix and passes cleanly after.
- [x] `src/lib/binary-tree.ts`: added `rollupBvForPurchase(investmentId,
      buyerId, amount, forDate, tx)`. Parses the buyer's binary_nodes
      `path` into ordered ancestor ids, walks from the buyer's direct
      parent up to the root; at each ancestor, the leg is read directly
      off the next path segment's own `position` (LEFT/RIGHT) — not
      re-derived any other way. Skips (no-op) any ancestor that already
      has a bv_entries row for this investmentId (replay guard, backed by
      the UNIQUE constraint). Increments leftBv/rightBv via Prisma's
      `{ increment: amount }`, not read-then-write, so it stays correct
      under concurrent purchases. No-ops entirely if the buyer has no
      binary_nodes row at all (a root user who's never sponsored anyone —
      no ancestors possible either way).
- [x] Wired into `src/lib/investments.ts`: `purchasePackage` calls
      `rollupBvForPurchase` right after `payDirectCommissionInTx`, inside
      the same transaction, only on the newly-created path — matches the
      existing Direct Commission wiring pattern exactly.
- [x] Tests first, `src/lib/bv-rollup.test.ts` (new file, 3 tests, all
      passing): a purchase at the bottom of a real 4-level tree (built via
      real registerWithSponsor/spillover, not hand-crafted binary_nodes
      rows) creates a correctly-legged bv_entries row for every ancestor
      up to the root, with cached leftBv/rightBv matching exactly, and
      zero entry for the buyer themselves; a DAILY_INTEREST credit (via
      the real `accrueDailyInterestForInvestment`) and the purchase's own
      DIRECT_COMMISSION side effect together still produce exactly one
      bv_entries row per ancestor (the purchase's own), proving interest
      accrual specifically adds none; replaying the same investment's BV
      rollup both end-to-end (via a duplicate `purchasePackage` call,
      same idempotencyKey) and by directly re-invoking
      `rollupBvForPurchase` for the same investmentId creates no
      duplicate bv_entries and does not double-increment any ancestor's
      cached BV.
- [x] Audited existing test files per the SCRUM-70 RESTRICT-FK lesson
      before declaring done: `direct-commission.test.ts` and
      `users.test.ts` both create investments via sponsored purchases
      (which now generate bv_entries rows) and both called
      `investment.deleteMany` in their cleanup — added
      `bvEntry.deleteMany({ where: { sourceInvestmentId: { in:
      createdInvestmentIds } } })` before `investment.deleteMany` in both.
      Confirmed `investments.test.ts` needed no change (uses
      `registerAsRoot` only, no sponsor, so `rollupBvForPurchase` always
      no-ops there — zero bv_entries ever created for that file).
- [x] Full suite: 35 files, 235/235 passing (228 prior + 4 binary-cycle +
      3 bv-rollup new), including `reconciliation.test.ts` clean. `tsc
      --noEmit` clean. Verified zero leftover bv_entries/binary_nodes/
      test.local users after cleanup.

## SCRUM-73: tree visualization UI (react-d3-tree, RTL) — DONE

Confirmed with user before building:
- Fetch depth capped at a fixed depth (5-6 levels) from the logged-in
  user's own node, not the whole unbounded subtree — reasonable first
  version, avoids a slow query/cluttered render for a user with a large
  downline.
- RTL mirroring: keep the tree DATA exactly as-is in both locales (LEFT
  child always first, RIGHT always second, position field never touched)
  and mirror the rendered SVG visually via `scaleX(-1)` on the container
  in `/ar`, with a second `scaleX(-1)` on each node's text label group so
  text reads correctly (double-flip). This keeps LEFT/RIGHT strictly a
  data fact read from `binary_nodes.position`, never derived from render
  order or screen side — matches the phase brief's explicit warning.

Plan:
- [ ] `npm install react-d3-tree` — first graph/chart library in the
      project (no recharts/d3 precedent to follow). Confirm no peer-dep
      conflict with React 19.1.0 at install time.
- [ ] `src/lib/binary-tree.ts`: add `getMySubtree(userId, maxDepth)` — no
      target-user param (invariant #9, matches every other page's
      pattern). Loads the user's own binary_nodes row, then recursively
      (or via repeated `findMany({ where: { parentId: { in: [...] } } })`
      breadth-by-breadth, bounded by maxDepth) loads descendants down to
      the depth cap. Returns a plain nested structure: `{ userId, name,
      position, children: [...] }` — needs each node's `name` (join
      against `users.name`) for display, not just the raw userId.
- [ ] Tests first (`binary-tree.test.ts` or new
      `binary-tree-subtree.test.ts`): a user with no downline gets an
      empty children array (not an error); a multi-level real tree
      (built via registerWithSponsor/spillover) returns the correct
      shape with correct LEFT/RIGHT positions at each level; depth cap is
      respected (a deeper real branch doesn't appear beyond maxDepth);
      never includes another user's subtree (ownership/isolation, mirrors
      the SCRUM-70 cross-sponsor isolation test).
- [ ] `src/app/[locale]/binary-tree/page.tsx` (server component,
      `requireSession`-protected, matches referrals/page.tsx structure):
      loads translations + locale, `requireSession(new Date())`, calls
      `getMySubtree(user.id, depthCap)`, renders header + a client tree
      component. Empty/leaf state (no downline at all) handled inside the
      client component, not a separate page branch.
- [ ] `binary-tree-view.tsx` (client component, `"use client"`):
      - Converts the plain subtree shape into react-d3-tree's expected
        `{ name, attributes, children }` node format. `attributes` carries
        the position (LEFT/RIGHT) as a data attribute rendered in a
        custom node label — read directly from the fetched data, never
        derived from the node's rendered x/y position or tree traversal
        order.
      - RTL: wraps the react-d3-tree container in a div with
        `style={{ transform: locale === "ar" ? "scaleX(-1)" : undefined
        }}`, and applies the counter `scaleX(-1)` on each custom node's
        text-rendering group so labels read correctly. Tested explicitly
        in `/ar` per the phase brief and bilingual-rtl skill — not just a
        translation-key check.
      - Custom `renderCustomNodeElement` (not the library's default
        circle) matching this project's card-based visual language:
        rounded rect, name, LEFT/RIGHT badge (English word, never
        translated — matches the glossary rule for MLM structural terms),
        BV or purchase indicator if easily available.
      - Empty/leaf state: the logged-in user's own node renders alone
        with no children, plus a short empty-state message/CTA
        (translated) below or beside the tree, not just a bare single
        node with no explanation.
      - Zoom/pan enabled (react-d3-tree default `zoomable`/`draggable`),
        since even a depth-capped tree can be wide.
- [ ] `loading.tsx` skeleton matching the page's shape (header +
      placeholder tree-shaped skeleton block).
- [ ] i18n: new `BinaryTree` namespace in both messages/en.json and
      messages/ar.json in this commit. "LEFT"/"RIGHT" (or however the
      leg is surfaced) stay English per the glossary (matches Wallet
      A/B/C, BV, etc. — these are MLM structural terms, not general UI
      text) — confirm this reading of the glossary rule against the
      bilingual-rtl skill before finalizing the label text.
- [ ] RTL pass per lessons.md's recurring category: grep new files for
      physical left-*/right-*/ml-*/mr-*/pl-*/pr-*/text-left/text-right;
      explicit `flex flex-row items-center gap-2` for any icon+text pair
      outside the SVG itself.
- [ ] Manual verification in the running dev container: a user with zero
      downline (empty/leaf state) and a user with a real multi-level
      downline (built via the real placement algorithm, not fabricated
      tree JSON), in both `/en/binary-tree` and `/ar/binary-tree` —
      specifically confirm the SAME node's LEFT/RIGHT label and BV/position
      data are identical in both locales while the visual left-right
      screen position mirrors, proving the render is a pixel-level flip
      and not a data reordering.
- [x] `npm install react-d3-tree` (v3.6.6) — first graph/chart library in
      the project. No peer-dep conflict with React 19.1.0 (its
      peerDependencies range explicitly covers 16.x-19.x).
- [x] `src/lib/binary-tree.ts`: added `getMySubtree(userId, maxDepth)` +
      exported `SubtreeNode` type. No target-user param (invariant #9).
      Breadth-by-breadth fetch (one query per depth level via
      `findMany({ where: { parentId: { in: [...] } } })`), not a single
      deep nested Prisma `include` chain or an unbounded recursive query.
      Returns `null` if the user has no binary_nodes row at all (never
      placed) — the UI's empty-state trigger. `position` is copied
      verbatim from `binary_nodes.position` for every node (root's own
      position is always null in its own subtree — not meaningful there).
      5 tests in `binary-tree-subtree.test.ts`, all passing: null for an
      unplaced user; leaf state (empty children) for a user with a
      downline of their own that has no further downline; correct
      multi-level shape with correct LEFT/RIGHT at each level; depth cap
      respected against a real deeper branch; cross-sponsor isolation.
- [x] `src/app/[locale]/binary-tree/{page.tsx, binary-tree-view.tsx,
      loading.tsx}` — server component matches referrals/page.tsx's
      structure exactly (`requireSession(new Date())`, no target-user
      param). Depth capped at 5. Client component converts the plain
      subtree into react-d3-tree's `RawNodeDatum` shape, copying
      `position` straight from the fetched data into each node's
      `attributes` — never derived from array order or recursion order.
- [x] RTL mirroring: data (child order, position field) is IDENTICAL in
      both locales. Only the rendered SVG container gets
      `transform: scaleX(-1)` in `/ar` (via a locale check, not a CSS
      media query, since it must track next-intl's locale not the OS/
      browser direction), with a second counter `scale(-1, 1)` on each
      node's text-label `<g>` so labels render un-mirrored (readable)
      while the tree layout itself flips. `translate.x` for react-d3-tree
      is also flipped (`dimensions.width - 40` in RTL vs `40` in LTR) so
      the root anchors to the correct starting edge post-mirror.
      LEFT/RIGHT badge text stays the literal English word in both
      locales (MLM structural term, not translated, per the bilingual-rtl
      glossary rule — same treatment as Wallet A/B/C).
- [x] i18n: new `BinaryTree` namespace added to both messages/en.json and
      messages/ar.json in this commit. Validated both files as parseable
      JSON. Grepped the new route's files for physical
      left-*/right-*/ml-*/mr-*/pl-*/pr-*/text-left/text-right — zero
      matches.
- [x] `tsc --noEmit` clean throughout.
- [x] Manual verification: no headless-browser/screenshot tool is
      available in this environment, so code-level checks were done
      first (route compiles, serves 200 for both locales, correct data
      reaches the client bundle, no server-side runtime errors in
      container logs) and flagged explicitly to the user as an
      incomplete substitute for an actual visual check, rather than
      claiming full verification. Set up two real verification users via
      a scratch script (a 3-level real tree built through
      registerWithSponsor/spillover — Root -> Left Child/Right Child ->
      Left Grandchild/Right Grandchild — plus a separate user with zero
      downline for the empty state) and gave the user login credentials
      to check in their own browser after their first session cookie
      expired mid-verification.
      User confirmed: tree renders correctly in both `/en` and `/ar`,
      RTL mirroring looks right, LEFT/RIGHT badges are consistent between
      locales for the same node. One data point flagged for explicit
      confirmation: "Right Grandchild" (under Right Child) shows a LEFT
      badge — verified directly against real binary_nodes rows via a
      scratch query and confirmed correct, not a bug: `position` is
      relative to a node's own DIRECT parent's two legs, never the
      overall tree side. Right Grandchild is Right Child's first-ever
      registered referral, so per SCRUM-70's placement algorithm (open
      direct slot always wins, LEFT before RIGHT) it fills Right Child's
      own LEFT slot — a node several levels down the "right side" of the
      tree can correctly carry a LEFT position of its own. This is
      exactly what `getMySubtree`'s docstring and the phase brief's core
      rule require (position is a data fact tied to direct placement, not
      "which half of the screen the node visually falls on").
- [x] Full suite: 36 files, 240/240 passing (235 prior + 5 new
      binary-tree-subtree tests), including `reconciliation.test.ts`
      clean. `tsc --noEmit` clean.
- [x] Cleaned up all 6 manually-created verification users (root, 4
      descendants, empty-state user) via `cleanupLedgerEntriesForUsers` +
      explicit session/securityQuestion/walletAccount/binaryNode cleanup
      before user deletion, confirmed via the cleanup script's own
      "Deleted users: 6" output. Scratch scripts deleted after use;
      `git status` shows no trace.

## SCRUM-74: Phase 7 exit test — RUN AND PASSED

Ran a real scratch script (`.scratch_exit_test_phase7.ts`, deleted after —
matches the Phase 3/5/6 exit-test convention) directly against the dev
database, using real lib functions (`registerAsRoot`/`registerWithSponsor`,
`adminCreditWalletB`, `purchasePackage`, `accrueDailyInterestForInvestment`),
not a re-run of the permanent unit suite. Migration state verified clean
first (`prisma migrate status`).

### Results (24/24 assertions passed)

**Scenario 1 — 4-level tree, bottom purchase rolls up BV on every
ancestor's correct leg:**
Built root -> a (root's LEFT; a sibling fills root's RIGHT so this isn't
just a default) -> b (a's LEFT) -> buyer (b's LEFT), then an $8,000
purchase by buyer.
- bv_entries rows exist for b, a, and root — all three, not just the
  direct parent
- All three entries: leg == LEFT (matches the buyer's real descent path,
  not assumed), amount == exactly 8000
- No bv_entries row for the buyer's own userId as an "ancestor" of itself
- Cached leftBv/rightBv on b/a/root all match the bv_entries sum exactly
  (leftBv == 8000, rightBv == 0 for every ancestor — the RIGHT sides
  those ancestors' siblings occupy are correctly unaffected)

**Scenario 2 — commission credit and interest accrual create zero
bv_entries:**
- Direct Commission fired automatically as part of the scenario-1
  purchase (buyer's sponsor b received it) — confirmed paid, then
  confirmed it added zero additional bv_entries rows beyond the
  purchase's own 3
- Daily interest accrued on the same investment (past profitStartsAt) —
  confirmed it actually credited interest, then confirmed zero additional
  bv_entries rows
- b's cached leftBv stayed exactly 8000 after both — no noise leaked into
  the cached BV totals from non-purchase money movement

**Scenario 3 — new registration placed on the lower-BV side of a
DELIBERATELY IMBALANCED tree (not a fresh all-zero tree):**
- Built a sponsor with both direct slots already filled (LEFT/RIGHT
  children), then manually set leftBv=50000, rightBv=1000 — RIGHT
  deliberately the weaker leg
- A new referral correctly spilled into the RIGHT child's own subtree
  (landed on RIGHT child's open LEFT slot), NOT under the stronger LEFT
  leg
- Re-imbalanced the same sponsor the other way (leftBv=500,
  rightBv=90000 — now LEFT is weaker) and registered again: the very
  next referral correctly spilled into LEFT instead — proves the
  placement algorithm genuinely reads the live BV comparison each time,
  not a fixed default that happened to look right once

### Cleanup and regression check
- Script's own cleanup used `cleanupLedgerEntriesForUsers`
  (idempotencyKey-scoped, SYSTEM_EXTERNAL-safe) per the standing
  structural rule, plus explicit `bvEntry`/`binaryNode` cleanup ordered
  before `investment`/`user` deletion (RESTRICT FKs, per the SCRUM-70/71
  lessons) — reported "Cleaned up 10 users, 1 packages, 1 investments."
- Verified zero leftover `phase7exit` users and zero leftover
  `bv_entries` rows in the DB after the script's own cleanup ran, via a
  separate scratch check, before even getting to the full-suite pass.
- Scratch scripts deleted; `git status` confirms no trace.
- Full suite: 36 files, 240/240 passing. `tsc --noEmit` clean.
- `reconciliation.test.ts` (the whole-database solvency check) explicitly
  re-run standalone as the final step, per the standing rule — 3/3
  passing on its own, not just bundled into the full-run count.

**PHASE 7 EXIT TEST: ALL 3 SCENARIOS / 24 ASSERTIONS PASSED. Full suite
clean, including standalone whole-database reconciliation.**

Phase 7 is complete pending user confirmation in the operation-room chat
per CLAUDE.md's build-order rule.

# Phase 6 — Sponsor Tree & Direct Commission

## SCRUM-63: commission_config table — DONE

- [x] Added `CommissionConfig` model (`commission_config`, migration
      `20260821120000_add_commission_config`, applied via `migrate deploy`
      per the standing hand-edited-migration rule) — directRate,
      directCommissionSplit, directSavingSplit, binaryRate,
      binaryCarryForwardExpiryMonths (default 6), effectiveFrom, effectiveTo.
      Rates stored as whole percentages (8.0, not 0.08), matching
      InterestRateConfig's existing monthlyRate convention.
- [x] "At most one active row" enforced via a partial unique index on a
      constant expression `((TRUE)) WHERE effective_to IS NULL`, same
      corrected pattern as `interest_rate_config` (indexing the nullable
      column itself doesn't work — verified live by inserting a real
      second active row and confirming it's rejected, not just trusting
      `\d` output).
- [x] Seeded: direct 8% (5/3 split), binary 8%, 6-month carry-forward
      expiry, effective_from = now, effective_to = NULL.
- [x] `prisma migrate status` clean, `tsc --noEmit` clean.

## SCRUM-64: first-purchase detection function — DONE

- [x] `src/lib/direct-commission.ts`: `isDirectCommissionTriggerPurchase
      (investmentId, tx: Prisma.TransactionClient)`. Deliberately not named
      `isFirstPurchase` — verbose/scoped name so Phase 9's MRV logic (every
      purchase counts, not just first, per docs/mlm_rules_log.md Section 6)
      can never be tempted to reuse or unify with it. `tx` is required (not
      optional like postTransaction's pattern) since correctness depends on
      running inside the same DB transaction as the eventual commission
      payout — a bare-prisma default would reintroduce the exact
      same-instant race the task called out.
      Order: `purchasedAt ASC, createdAt ASC, id ASC` — three-level
      deterministic tiebreak so two investments sharing the same
      `purchasedAt` (fabricated/backfilled dates, or same-millisecond
      concurrent inserts) still resolve to exactly one "first", never both
      or neither, and never flip-flop across repeated calls.
- [x] `src/lib/direct-commission.test.ts`: 4 tests — a user's only purchase
      is the trigger; a second purchase (different amount, separately
      funded) is not, while the first stays true; two purchases sharing
      the exact same instant resolve to exactly one trigger and stay
      stable across repeated re-checks; a nonexistent investment id throws
      rather than resolving ambiguously.
- [x] Explicitly out of scope for this task (per the ticket's own framing):
      wiring this into `purchasePackage` or triggering the actual
      commission payout — that's the next ticket.
- [x] Found and fixed an unrelated pre-existing issue while running the
      full suite: `daily-interest-job.test.ts`'s "true first-ever run"
      test failed (expected 0 prior `job_runs` rows, found 226) —
      confirmed via `git stash` that this reproduces identically with
      SCRUM-64's changes fully removed, so it's leftover data, not a
      regression. Root cause matched the exact SCRUM-51/52 pattern already
      logged in lessons.md: 226 `job_runs` rows from a prior interrupted
      manual/test run (`started_at` all clustered at one timestamp,
      `period_key` spanning 2026-01-01 through 2026-08-14), left behind in
      the shared dev DB. Deleted those 226 rows (`DELETE FROM job_runs
      WHERE job_type = 'daily_interest'`), re-ran the previously-failing
      test file alone (clean), then the full suite once more.
- [x] Also hit an infrastructure blip mid-verification: Docker Desktop
      became unresponsive partway through a full-suite run, which failed
      94 tests with `ECONNREFUSED`/"database server not running" — not a
      code issue. Confirmed via `docker compose ps` (failed to reach the
      Docker API), waited for the user to restart Docker Desktop, then
      confirmed all 3 containers healthy again before re-running.
- [x] Full suite (post Docker restart + job_runs cleanup): 32 files,
      207/207 passing, including `daily-interest-job.test.ts` and
      `reconciliation.test.ts` clean. `tsc --noEmit` clean. Verified zero
      leftover `direct-commission-*` test users and no orphaned
      investments after cleanup.

Plan:
- [ ] New file `src/lib/direct-commission.ts` (doesn't exist yet — this is
      the first Phase 6 lib file).
- [ ] Function named `isDirectCommissionTriggerPurchase` — deliberately
      verbose/scoped name, NOT `isFirstPurchase`, so it can never be
      reached for by Phase 9's MRV logic (which counts every purchase,
      not just the first — a different trigger for a different purpose,
      per the phase brief's explicit warning not to unify these).
      Signature: `isDirectCommissionTriggerPurchase(investmentId: string,
      tx: Prisma.TransactionClient): Promise<boolean>` — `tx` is REQUIRED,
      not optional (unlike postTransaction's pattern), because correctness
      here depends on running inside the same DB transaction as the
      commission payout that will follow it; a caller silently defaulting
      to a non-transactional read would reintroduce the exact race the
      task calls out.
      Logic: load the target investment (userId, purchasedAt, id, createdAt).
      Query that user's investments ordered by `purchasedAt ASC, createdAt
      ASC, id ASC` (three-level deterministic tiebreak — purchasedAt ties
      are possible with fabricated/backfilled dates, createdAt ties are
      possible at sub-millisecond granularity in rare concurrent-insert
      cases, id is the final deterministic tiebreak since cuids are unique).
      Take the first row's id; return whether it equals the target
      investment's id.
- [ ] Tests first (`direct-commission.test.ts`):
      - a user's very first (only) purchase is identified as the trigger
      - a second purchase by the same user (any amount, any funding
        source — simulate by funding B via commission-style credit
        rather than admin credit) is correctly identified as NOT the
        trigger, while the first one still is
      - two purchases sharing the exact same `purchasedAt` instant
        (fabricated identical date) resolve deterministically: exactly
        one is the trigger, never both, never neither, and re-running the
        check multiple times gives the same answer every time (no
        flip-flopping from query-plan nondeterminism)
      - a user with zero investments (edge case, shouldn't be called in
        practice but must not crash ambiguously) — decide behavior: throw,
        since calling this before the investment row exists is a misuse
- [ ] Full suite + `tsc --noEmit` after.
- [ ] Explicitly NOT doing in this task (scope): wiring this into
      `purchasePackage` or triggering the actual commission payout — that's
      the next task. This ticket is the detection function alone, per the
      task description.

## SCRUM-65: Direct Commission payout logic — DONE

- [x] `src/lib/direct-commission.ts`: added `payDirectCommission(investmentId,
      forDate)`. Uses `isDirectCommissionTriggerPurchase` as the sole gate
      (never re-derives first-purchase logic itself). No-ops (not throws)
      for: not-first purchase, no sponsor, suspended buyer, suspended
      sponsor — these are ordinary outcomes, not error conditions.
      Commission math reads the active `commission_config` row's
      `directCommissionSplit`/`directSavingSplit` fields directly (5.0/3.0),
      not derived from `directRate`.
- [x] Real bug caught by the tests (not by review): a single
      `postTransaction` call with all 4 entries under one shared
      `direct:{investmentId}` key fails — the ledger's idempotency
      uniqueness is `(key, coalesced_user, wallet, direction)`, and both
      splits' SYSTEM_EXTERNAL sides are `userId: null` /
      `wallet: SYSTEM_EXTERNAL` / `direction: DEBIT`, so under one shared
      key they collide with *each other*, not just with a genuine replay.
      Fixed by splitting into two `postTransaction` calls with distinct
      deterministic keys (`direct:{investmentId}:c` and
      `direct:{investmentId}:saving`), both inside the same outer
      transaction so the whole operation stays atomic; the `saving_lot`
      creation is guarded by its own `findFirst` check
      (`sourceInvestmentId`) rather than either call's `alreadyProcessed`
      flag alone, so a partial-retry scenario (one split's key already
      used, the other not) still can't double-create the lot.
      Money-materializing pattern matches `adminCreditWalletB`: CREDIT
      sponsor / DEBIT SYSTEM_EXTERNAL — Direct Commission is new money
      entering for the sponsor, not a transfer out of the buyer's balance
      (buyer already paid full price via purchasePackage's own B->A
      entries).
- [x] `src/lib/direct-commission.test.ts` (extended, `payDirectCommission`
      describe block): 6 new tests, all passing — exact 5%/3% split on a
      $10,000 purchase (sponsor C +500, SAVING +300, matching saving_lot
      with correct amount/sourceInvestmentId/unlocksAt = purchase date + 3
      months); no-sponsor buyer triggers nothing; a second (non-first)
      purchase triggers nothing regardless of amount while the first
      purchase's payout stays correctly in place; suspended sponsor blocks
      it; suspended buyer blocks it; replaying the same investmentId
      creates no duplicate ledger entries and no duplicate saving_lot.
- [x] Full suite: 32 files, 213/213 passing (207 prior + 6 new), including
      `reconciliation.test.ts` clean. `tsc --noEmit` clean. Verified zero
      leftover `direct-commission-*` test users and zero leftover
      `saving_lots` rows after cleanup.
- [x] Explicitly out of scope, per the ticket (not attempted): wiring
      `payDirectCommission` as an automatic call inside `purchasePackage`
      itself — this ticket built the payout function; whether/where it's
      invoked from the purchase flow is presumably the next ticket.

Plan:
- [ ] `src/lib/direct-commission.ts`: add `payDirectCommission(investmentId:
      string, forDate: Date): Promise<...>` (opens its own
      `prisma.$transaction`, matching `purchasePackage`'s pattern — this is
      called as a follow-up step after `purchasePackage` resolves, not
      threaded through its transaction, since `purchasePackage` doesn't
      expose its `tx` to callers today; not this ticket's scope to change
      that).
      Logic:
      1. Load the investment (userId = buyer, amount).
      2. `isDirectCommissionTriggerPurchase(investmentId, tx)` — if false,
         return a no-op result. Not-first purchases never reach the payout
         logic at all, regardless of amount (matches the exit test's
         "any amount" framing for the non-triggering case).
      3. Load the buyer; if buyer.sponsorId is null, no-op (no sponsor to
         pay). Load the sponsor by sponsorId.
      4. Skip (no-op, not an error) if either buyer or sponsor is
         suspended (`suspendedAt !== null`) — matches the Phase 5
         suspension-skip pattern used elsewhere (daily interest, binary
         legs), not a thrown error.
      5. Read the currently active `commission_config` row
         (`effective_to: null`).
      6. `commissionAmount = investment.amount * directCommissionSplit /
         100`, `savingAmount = investment.amount * directSavingSplit /
         100` — both computed from the config's split fields directly
         (5.0 and 3.0 today), not derived from directRate, since the
         splits are the actual payout percentages and directRate is
         effectively documentation that they sum to it.
      7. One `postTransaction` call with 4 entries (CREDIT sponsor's C +
         DEBIT SYSTEM_EXTERNAL for commissionAmount, CREDIT sponsor's
         SAVING + DEBIT SYSTEM_EXTERNAL for savingAmount), matching the
         `adminCreditWalletB`/SYSTEM_EXTERNAL pattern — Direct Commission
         is new money materializing for the sponsor, not a transfer out of
         the buyer's own balance (the buyer already paid full price via
         purchasePackage's separate B->A entries). All 4 entries share ONE
         idempotencyKey `direct:{investmentId}` in a single
         postTransaction call (not two separate calls) so the replay guard
         covers both splits atomically — two separate calls would let one
         split's idempotency succeed while the other independently
         replays.
         entryType DIRECT_COMMISSION for the C-side pair, DIRECT_SAVING
         for the SAVING-side pair (both enums already exist in schema).
         referenceType "investment", referenceId = investmentId on all 4.
      8. In the same transaction, create a `saving_lot` row: userId =
         sponsor.id, amount = savingAmount, sourceInvestmentId =
         investmentId (the field Phase 5 pre-added exactly for this),
         unlocksAt = forDate + 3 months, createdAt = default now.
      9. Skip/no-op cases (no sponsor, suspended party, not-first-purchase)
         must NOT create a saving_lot or ledger entries, and must NOT
         throw — a normal purchase by a root user or a second purchase is
         an expected, common case, not an error condition.
- [ ] Tests first (`direct-commission.test.ts`, extending the existing
      file): a qualifying first purchase with an active, unsuspended
      sponsor splits and credits correctly (sponsor C +5% exact amount,
      sponsor SAVING +3% exact amount, one matching saving_lot with
      correct amount/sourceInvestmentId/unlocksAt = purchase date + 3
      months); a buyer with no sponsor triggers nothing (zero ledger
      entries, zero saving_lots, no error); a second (non-first) purchase
      by an already-triggered buyer triggers nothing regardless of amount,
      even though that same buyer's sponsor exists and is eligible;
      suspended sponsor blocks the commission (buyer active, sponsor
      suspended -> no-op); suspended buyer blocks the commission (mirror
      case); replaying the same investmentId a second time creates no
      duplicate ledger entries and no duplicate saving_lot.
- [ ] `cleanupLedgerEntriesForUsers` for both buyer and sponsor ids in
      test cleanup (SYSTEM_EXTERNAL-safe pattern, mandatory per
      lessons.md). Explicit `savingLot.deleteMany` cleanup for
      sponsor-created lots (new table this task writes to, not covered by
      the existing investments.test.ts-style cleanup list).
- [ ] Full suite + `tsc --noEmit` after. Re-check `job_runs`/leftover-data
      state is still clean (per the SCRUM-64 cleanup) before declaring
      done, not just this file's own tests green.

## SCRUM-67: referral/commission UI — DONE

Confirmed with user: no `/register` UI route exists yet (Phase 10 work per
build_plan.md), so the referral "link" is displayed as the sponsor's raw
user id (a copyable code), not a fabricated full URL to a page that would
currently 404.

Also confirmed by survey: there is no app-wide nav/sidebar anywhere yet
(layout.tsx only has a language switcher) — matches the existing
packages/investments/withdrawals precedent of direct-URL-only pages, so no
nav link is added here either.

Plan:
- [ ] `src/lib/users.ts`: add `listReferralsForUser(sponsorId: string)` —
      `prisma.user.findMany({ where: { sponsorId }, orderBy: { createdAt:
      "desc" } })`, ownership enforced by construction (matches
      `listInvestmentsForUser`'s pattern exactly). Needs each referral's
      `suspendedAt` (for status) and whether they've made a purchase yet
      (join/include a minimal investments existence check) — decide at
      build time whether that's a separate query or an `_count` include.
- [ ] `src/lib/direct-commission.ts`: add
      `listDirectCommissionHistoryForUser(userId: string)` — reads
      `ledgerEntry.findMany({ where: { userId, entryType: {in:
      [DIRECT_COMMISSION, DIRECT_SAVING]}, direction: "CREDIT" },
      orderBy: { createdAt: "desc" } })` (sponsor-side CREDIT rows only,
      not the SYSTEM_EXTERNAL DEBIT side) — this is a new read function,
      not reusing anything existing verbatim.
- [ ] New route `src/app/[locale]/referrals/page.tsx` (server component,
      `requireSession`-protected, matches withdrawals/page.tsx structure):
      loads translations + locale, `requireSession(new Date())`,
      `Promise.all` for referrals list + commission history, renders:
      - referral code section (the user's own id, copy button)
      - direct referrals list (name/email masked appropriately, status
        badge: active/purchased vs suspended vs no purchase yet)
      - commission history list (amount, wallet C vs SAVING, date,
        referencing which referral triggered it if easily joinable)
      Each section has its own empty state.
- [ ] `referral-code-card.tsx` (client component, for the copy-to
      -clipboard interaction only — no server action needed, this page has
      no destructive/financial action, purely read + client-side copy).
- [ ] `referrals-list.tsx`: card grid or list matching
      investment-list.tsx's card pattern, status badge function
      (`default`/`secondary`/`destructive`) extended for this page's own
      referral-status semantics — not reusing withdrawal's status badge
      function directly (different status vocabulary).
- [ ] `commission-history-list.tsx`: matches b-exit-status-list.tsx's list
      pattern (amount, date, wallet destination badge).
- [ ] `loading.tsx` skeleton matching the page's shape.
- [ ] i18n: new `Referrals` namespace in both messages/en.json and
      messages/ar.json in this commit. Wallet C/SAVING/"Direct Commission"
      stay English per glossary; everything else translated.
- [ ] RTL pass per lessons.md's recurring category: every icon+text pair
      gets explicit `flex flex-row items-center gap-2`; grep new files for
      physical left-*/right-*/ml-*/mr-*/pl-*/pr-*/text-left/text-right
      before considering done.
- [ ] Manual verification in the running dev container: a sponsor with 0
      referrals (empty states), a sponsor with >=1 referral who has
      purchased (commission history populated) and >=1 who hasn't yet (no
      purchase), in both `/en/referrals` and `/ar/referrals`.
- [x] `src/lib/users.ts`: added `listReferralsForUser(sponsorId)` —
      `prisma.user.findMany({ where: { sponsorId } })`, newest first,
      returns `hasPurchased` derived from `_count.investments` (nothing to
      keep in sync — fully derivable). 4 new tests in `users.test.ts`:
      correct scoping (excludes an unrelated root user), empty array for
      no referrals, `hasPurchased` true/false correctly split across a
      real buyer vs non-buyer, suspended referral's `suspendedAt` reflected.
- [x] `src/lib/direct-commission.ts`: added
      `listDirectCommissionHistoryForUser(userId)` — CREDIT-only
      DIRECT_COMMISSION/DIRECT_SAVING entries, newest first; explicitly
      excludes the paired SYSTEM_EXTERNAL DEBIT side (same double-entry
      convention as every other ledger query in this codebase). 3 new
      tests: both C and SAVING sides returned correctly with matching
      investmentId, empty array with no history, never leaks another
      user's entries.
- [x] Built the full page: `src/app/[locale]/referrals/{page.tsx,
      referral-code-card.tsx, referrals-list.tsx,
      commission-history-list.tsx, loading.tsx}`. Confirmed with user: no
      `/register` route exists yet (Phase 10), so the referral code is
      displayed as the sponsor's raw user id with a copy button, not a
      fabricated URL. Confirmed by survey: no app-wide nav exists anywhere
      yet, so no nav link added — matches the existing direct-URL-only
      precedent from packages/investments/withdrawals.
- [x] Full `Referrals` i18n namespace added to both messages/en.json and
      messages/ar.json in this commit. "Direct Commission"/"Wallet
      C"/"SAVING" kept English per glossary in both locales (verified live
      in the Arabic render, not just in the JSON).
- [x] RTL pass: grepped all new files for physical
      left-*/right-*/ml-*/mr-*/pl-*/pr-*/text-left/text-right — zero
      matches. Icon+text pairs (copy button, empty-state icons) use
      explicit `flex flex-row items-center gap-2`.
- [x] Full suite: 32 files, 222/222 passing (215 prior + 7 new). `tsc
      --noEmit` clean.
- [x] Manual verification against the real running dev container (not
      just unit tests), as `browser-test@test.local`:
      - Empty-state pass (0 referrals, 0 commission history): both
        `/en/referrals` (200) and `/ar/referrals` (200, `dir="rtl"`)
        correctly show both empty states, referral code (own user id)
        displayed correctly in both locales.
      - Populated-data pass: created one non-buying referral and one
        buying referral (purchased via the real `purchasePackage`
        function inside the container, so `payDirectCommissionInTx`
        actually ran) under `browser-test@test.local`. Both `/en` and
        `/ar` correctly showed both referral cards with correct
        status badges ("No purchase yet" / "لا يوجد شراء بعد" for the
        non-buyer), and the commission history showed the real 500.00/
        300.00 C/SAVING credits with "Wallet C"/"SAVING" badges staying
        English in the Arabic render. Confirmed zero rendered empty
        -state containers in the populated HTML (a `border-dashed` grep
        returned 0) — an initial false alarm from matching the harmless
        embedded next-intl translation-catalog JSON, not an actual double
        -render bug.
      - Found and fixed the known dev-container quirks along the way (not
        new issues, matches standing lessons.md entries): a fresh route
        directory needed `docker compose restart app` before it stopped
        404ing (SCRUM-61's exact quirk), and the container's generated
        `@prisma/client` was missing `commissionConfig` until `docker
        compose exec app npx prisma generate` was re-run (Phase 3's exact
        host/container node_modules drift quirk) — both already-known
        classes of issue, not re-investigated from scratch.
      - Cleaned up all manually-created verification data afterward: test
        users/investments deleted, the sponsor's two real commission
        ledger entries from the manual purchase deleted by idempotencyKey
        (not userId-only, per the standing rule), sponsor's cached C/A/B/
        SAVING balances recomputed from source, verified via the real
        `runReconciliation()` function returning `clean: true` with zero
        mismatches before considering the manual pass done. Session token
        also deleted. Final full-suite re-run after cleanup: still
        32/32 files, 222/222 tests passing.

## SCRUM-66: wire payDirectCommission into the purchase flow — DONE

- [x] `src/lib/direct-commission.ts`: extracted `payDirectCommissionInTx
      (investmentId, forDate, tx)` — the real transactional body.
      `payDirectCommission` is now a thin wrapper
      (`prisma.$transaction((tx) => payDirectCommissionInTx(...))`), kept
      for SCRUM-65's existing direct-call API/tests, not removed.
- [x] `src/lib/investments.ts`: `purchasePackage` calls
      `payDirectCommissionInTx(investment.id, data.forDate, tx)` right
      after `tx.investment.create(...)`, inside the same transaction —
      only on the newly-created path, not the already-processed replay
      path. Any error inside it propagates through purchasePackage's
      transaction callback and Prisma auto-rolls-back the whole thing; no
      separate try/catch needed.
- [x] Real test-ordering bug found while wiring this in (not a bug in the
      new code): SCRUM-65's "blocks the commission when the buyer is
      suspended" test suspended the buyer *after* calling `makePurchase`
      — harmless before this ticket (nothing auto-triggered commission at
      purchase time), but now that `purchasePackage` pays the commission
      internally, that test's own purchase call paid it while the buyer
      was still active, then suspended the buyer too late. Fixed by
      moving `suspend(buyer.id)` before `makePurchase` and removing the
      now-redundant explicit `payDirectCommission` call — the purchase
      call itself is now the thing under test for that no-op path.
- [x] Two new tests in `direct-commission.test.ts`, new describe block
      `"purchasePackage + payDirectCommission wiring (SCRUM-66)"`:
      - a single `purchasePackage` call (no separate `payDirectCommission`
        call in the test) results in both the investment existing AND the
        sponsor's C/SAVING correctly credited AND a matching saving_lot —
        proving the wiring end-to-end through the real entry point, not
        just through direct-commission's own internal API.
      - forced mid-commission failure: temporarily closes out the active
        `commission_config` row (`effectiveTo` backdated) so
        `payDirectCommissionInTx`'s own config lookup throws partway
        through `purchasePackage`'s transaction; restored in a `finally`
        block regardless of pass/fail (verified directly in the DB
        afterward — never left broken for other tests in this shared dev
        DB). Asserts the whole transaction rolled back atomically: zero
        investment rows, zero purchase ledger entries (the B debit/A
        credit that would otherwise have posted), Wallet B still holds
        its full pre-purchase balance, sponsor's C still zero, zero
        saving_lots — not a half-completed state with the investment
        created but commission silently missing.
- [x] Confirmed Phase 3's existing `investments.test.ts` suite (10 tests)
      passes completely unmodified — those test users are all
      `registerAsRoot` (no sponsor), so `payDirectCommissionInTx`
      correctly no-ops for every one of them, preserving pre-SCRUM-66
      purchase behavior exactly.
- [x] Full suite: 32 files, 215/215 passing (213 prior + 2 new), including
      `reconciliation.test.ts` clean. `tsc --noEmit` clean. Verified zero
      leftover `direct-commission-*` users, zero leftover saving_lots, and
      `commission_config`'s single active row correctly restored
      (`effective_to` null) after the forced-failure test.

Plan:
- [ ] `src/lib/direct-commission.ts`: extract `payDirectCommissionInTx
      (investmentId, forDate, tx: Prisma.TransactionClient)` — the existing
      `payDirectCommission` transactional body, now callable with a
      caller-supplied `tx`. `payDirectCommission` itself becomes a thin
      wrapper: `prisma.$transaction((tx) => payDirectCommissionInTx(...))`
      — kept for SCRUM-65's existing direct-call tests/API, not removed.
- [ ] `src/lib/investments.ts`: `purchasePackage` calls
      `payDirectCommissionInTx(investment.id, data.forDate, tx)` right
      after `tx.investment.create(...)`, inside the same transaction — NOT
      as a separate follow-up call after the transaction commits. Only on
      the newly-created path, not the already-processed replay path (a
      replay's commission was already resolved on the original call).
      Any error thrown inside payDirectCommissionInTx propagates up
      through purchasePackage's transaction callback, which Prisma
      auto-rolls-back — no separate try/catch needed, this is the same
      atomicity mechanism postTransaction itself already relies on.
- [ ] Tests first, extending `direct-commission.test.ts` (not
      investments.test.ts — this is direct-commission's own integration
      surface):
      - a sponsored buyer's first purchase, verified via ONE
        `purchasePackage` call: investment created AND sponsor's C/SAVING
        credited AND saving_lot created, all confirmed after that single
        call returns (no separate payDirectCommission call in the test).
      - a forced failure partway through the commission step (achieved by
        pre-inserting a ledger_entries row that collides with one of
        payDirectCommissionInTx's own idempotency keys, so its internal
        postTransaction call throws on the DB unique constraint) leaves
        NO investment row, NO purchase ledger entries (B debit/A credit),
        and NO commission ledger entries — proving the whole transaction
        rolled back atomically rather than leaving the investment
        half-committed with a missing commission.
- [ ] Confirm Phase 3's existing purchase tests
      (`investments.test.ts`) still pass unmodified — a purchase by a
      root user (no sponsor) must behave identically to before this
      change (this is exactly the "no sponsor -> no-op" path, already
      proven safe by SCRUM-65, but must be re-verified end-to-end through
      purchasePackage itself now that it's wired in).
- [ ] Full suite + `tsc --noEmit` after; re-verify no leftover data.

## SCRUM-68: Phase 6 exit test — RUN AND PASSED

Ran a real scratch script (`.scratch_exit_test_phase6.ts`, deleted after —
matches the Phase 3/5 exit-test convention) directly against the dev
database, using real lib functions (`registerAsRoot`/`registerWithSponsor`,
`adminCreditWalletB`, `purchasePackage`, `payDirectCommission`), not a re-run
of the permanent unit suite. Migration state verified clean first (`prisma
migrate status`). Built a 3-level sponsor chain (grandparent -> sponsor ->
referral) specifically to prove the "one level only" clause for real, not
just infer it from unit tests that never chained three real sponsor levels
together in one scenario.

### Results (18/18 assertions passed)

**Scenario 1 — referral's first $10,000 purchase:**
- Sponsor Wallet C == 500, SAVING == 300 (exact)
- A matching saving_lot exists: amount 300, unlocksAt == purchase date + 3
  months exactly (2026-08-01 -> 2026-11-01)

**Scenario 2 — referral's second purchase ($777, any amount/funding source)
generates no Direct Commission:**
- Zero DIRECT_COMMISSION/DIRECT_SAVING ledger entries reference the second
  investment
- Sponsor's C/SAVING balances unchanged at 500/300
- Still exactly 1 saving_lot for the sponsor (not 2)

**Scenario 3 — the sponsor's own sponsor (grandparent) receives nothing,
one level only:**
- Grandparent Wallet C == 0, SAVING == 0
- Grandparent has zero DIRECT_COMMISSION/DIRECT_SAVING ledger entries at all

**Scenario 4 — replaying with the same idempotency key creates no
duplicate:**
- Direct `payDirectCommission` replay on the same investment: ledger entry
  count unchanged (4 before, 4 after), still exactly 1 saving_lot, sponsor
  balances still exactly 500/300
- End-to-end replay via `purchasePackage` itself with the same
  idempotencyKey: returns the same investment id (not a new one), referral
  still has exactly 2 investments total (not 3)

### Cleanup and regression check
- Script's own cleanup used `cleanupLedgerEntriesForUsers` (idempotencyKey
  -scoped, SYSTEM_EXTERNAL-safe) per the standing structural rule — not
  hand-rolled `userId`-only deletion.
- Verified zero leftover `phase6-exit-*` users in the DB after the script's
  own cleanup ran, before even getting to the full-suite check.
- Scratch script deleted; `git status` confirms no trace.
- Full suite: 32 files, 222/222 passing, including `reconciliation.test.ts`
  (3/3, the whole-database solvency check) explicitly re-run and confirmed
  clean on its own as final proof, not just bundled into the full-run count.

**PHASE 6 EXIT TEST: ALL 4 SCENARIOS / 18 ASSERTIONS PASSED. Full suite
clean, including whole-database reconciliation.**

Phase 6 is complete pending user confirmation in the operation-room chat per
CLAUDE.md's build-order rule.

# Phase 5 — Withdrawals

## SCRUM-55: Friday-only guard (server-side, Asia/Dubai) — DONE

- [x] `src/lib/withdrawal-guard.ts`: `NotFridayError` + `assertFriday(forDate: Date): void`,
      reusing the existing `isFriday` from `src/lib/interest-rate.ts` (already
      timezone-correct and tested) rather than duplicating the Intl.DateTimeFormat
      logic. Takes `forDate` as a param — invariant #4, no `new Date()` inside.
- [x] `src/lib/withdrawal-guard.test.ts`: 5 tests — plain Friday/Thursday, plus
      two UTC/Asia-Dubai boundary-straddling instants (UTC-Thursday-but-
      Dubai-Friday, and UTC-Friday-but-Dubai-Saturday) prove the guard reads
      the business timezone, not server UTC. All pass.
- [x] No new config table / schema change needed — timezone is `config.TIMEZONE`
      deployment config already, not a business rule (invariant #6 n/a here).
- [x] Convention set for reuse: every future self-service/capital-release action
      in this phase calls `assertFriday(new Date())` once at the action boundary
      (the one place `new Date()` is allowed), then threads that same `forDate`
      down. B-exit *submission* uses the guard; B-exit admin approve/reject does
      not (per phase brief — admin can decide any day).
- [x] Found unrelated pre-existing environment issue while verifying: host
      `@prisma/client` was stale (missing `interestRateConfig`/`jobRun`
      models), causing 11 failures across `interest-rate.test.ts` and
      `phase-4-exit-test.test.ts` — same class of issue as the Phase 3 lesson
      (container vs host `node_modules` drift). Fixed with `npx prisma
      generate` on host (and in the `app` container). Not caused by this
      task's change; verified via `tsc --noEmit` that no such error touched
      `withdrawal-guard.ts` before the fix.
- [x] Full suite after fix: 25 files, 159/159 tests passing. `tsc --noEmit`
      clean except 3 pre-existing unrelated errors in `daily-interest.test.ts`
      (a Phase 4 type-narrowing issue on `AccrualResult`, not touched by this
      task).

## SCRUM-56: A->B and C->B self-service transfers — DONE

Confirmed with user: SAVING deduction for C->B uses the real (currently
always-zero) `WalletAccount` SAVING balance now, not a hardcoded zero —
correct today, automatically correct once SCRUM-58 populates it, no
follow-up code change needed.

Plan:
- [ ] Add `WalletTransfer` model to schema.prisma (`wallet_transfers` per
      build_plan.md's data model: id, userId, fromWallet (A|C), amount,
      requestedAt, processedAt, idempotencyKey) + migration. This is a new
      table, doesn't exist yet.
- [ ] `src/lib/withdrawable.ts`:
      - `withdrawableProfitA(userId)`: walletA.balance minus SUM(amount) of
        that user's investments where status = ACTIVE (still-locked
        principal). Never touches capital itself — released investments
        don't count against the deduction since their capital already left
        via a separate CAPITAL_RELEASE flow (SCRUM-57, not this task).
      - `withdrawableC(userId)`: walletC.balance - walletSaving.balance.
      Both recompute from source (wallets + investments tables) every call,
      per lessons.md's "recompute from source, never estimate" cached-balance
      principle — no new cached/derived column.
- [ ] `src/lib/transfers.ts`: `transferAtoB(userId, amount, forDate)` and
      `transferCtoB(userId, amount, forDate)`:
      - `assertFriday(forDate)` first (SCRUM-55 guard)
      - ownership: userId comes from the authenticated session only, never a
        client-supplied target (invariant #9) — enforced by construction,
        no separate check needed since there's no "on behalf of" param
      - suspension check: reject if `user.suspendedAt !== null`
      - validate amount > 0 and amount <= withdrawable (reject otherwise,
        clear error)
      - idempotencyKey: `transfer:{fromWallet}:{userId}:{crypto.randomUUID()}`,
        generated server-side inside transferAtoB/transferCtoB each call
        (confirmed with user). A transfer has no natural dedup key from its
        inputs (unlike interest/purchase) since legitimate repeat withdrawals
        of the same amount are valid — a per-call UUID guarantees every real
        transfer succeeds. This protects the ledger's invariant (every write
        has a unique key + the DB constraint backstop) but is not
        double-click/network-retry safe at the UI layer; note that as a
        follow-up concern for the withdrawal UI task (SCRUM-59-ish), not this
        task's scope.
      - `postTransaction`: DEBIT user's A (or C) / CREDIT user's B, both
        entryType WITHDRAWAL_OUT / WITHDRAWAL_IN as appropriate (reuse
        existing enum values, no new entryType)
      - write a `wallet_transfers` row (requestedAt, processedAt) inside the
        same DB transaction as the ledger post
- [ ] Tests first (`transfers.test.ts`):
      - non-Friday attempt rejected (NotFridayError), no ledger/wallet_transfer
        row written
      - A->B withdraws only the profit portion when capital is still locked
        (seed an ACTIVE investment + accrued interest, assert withdrawable
        excludes principal)
      - amount exceeding withdrawable (non-capital) balance rejected
      - replay with the same idempotency key doesn't double-transfer (balance
        unchanged on 2nd call, wallet_transfers not duplicated)
      - C->B basic case (no SAVING yet, so full C balance withdrawable)
      - suspended user blocked
- [x] Added `WalletTransfer` model (`wallet_transfers`, migration
      `20260817160443_add_wallet_transfers`, applied via `migrate deploy` per
      the standing hand-edited-migration rule) — id, userId, fromWallet
      (A|C), amount, requestedAt, processedAt, unique idempotencyKey.
- [x] `src/lib/withdrawable.ts`: `withdrawableProfitA` (A balance minus
      SUM(amount) of ACTIVE investments) and `withdrawableC` (C balance minus
      live SAVING balance, currently always 0 pre-SCRUM-58 but will
      auto-correct once that lands). Both recompute from source every call,
      never cached.
- [x] `src/lib/transfers.ts`: `transferAtoB`/`transferCtoB`, both:
      `assertFriday(forDate)` -> suspension check -> amount > 0 and <=
      withdrawable -> `postTransaction` (DEBIT source wallet / CREDIT B,
      entryType WITHDRAWAL_OUT/WITHDRAWAL_IN) -> `wallet_transfers` audit
      row, all inside one DB transaction. Idempotency key is a server
      -generated `transfer:{wallet}:{userId}:{uuid}` per call (confirmed with
      user — legitimate repeat withdrawals of the same amount must both
      succeed; double-click/network-retry protection is a UI-layer concern
      for a later task, not this one).
- [x] `src/lib/transfers.test.ts`: 10 tests, all passing — non-Friday
      rejection (both directions), profit-only withdrawal while capital
      locked (withdraws exactly the 200 profit, leaves exactly the 1000
      locked capital untouched), amount-exceeds-withdrawable rejection (both
      directions), CAPITAL_RELEASED investments no longer count as locked,
      suspended-user block, C->B basic case, and two replay-safety tests
      (postTransaction-level: same key twice doesn't double-apply; and
      transferAtoB-level: two distinct legitimate calls each move funds,
      proving they're not being incorrectly deduped against each other).
- [x] Full suite: 26 files, 169/169 passing (159 prior + 10 new). `tsc
      --noEmit`: no new errors. (The 3 pre-existing `daily-interest.test.ts`
      narrowing errors mentioned here were subsequently fixed — see
      lessons.md 2026-08-17 entry — `tsc --noEmit` is now fully clean.)

## SCRUM-57: Wallet B exit ("burn") request + admin approval — DONE

Plan:
- [ ] Add `WithdrawalRequest` model to schema.prisma (`withdrawal_requests`
      per build_plan.md: id, userId, amount, status (PENDING|APPROVED|
      REJECTED), requestedAt, decidedAt, decidedByAdminId, adminComment) +
      migration via `migrate dev --create-only` + `migrate deploy` (standing
      rule, hand-edited migration exists in history).
- [ ] `src/lib/withdrawal-requests.ts`:
      - `submitWithdrawalRequest(userId, amount, forDate)`: assertFriday,
        suspension check, `amount >= config.MIN_WITHDRAWAL` ($50, read from
        existing env config — not hardcoded, matches invariant #6's spirit
        since this is deployment config, same as TIMEZONE), creates a
        PENDING row. No ledger entry yet — money doesn't move at submission.
      - `approveWithdrawalRequest(actingAdminId, requestId)`: permission
        check following the exact `requirePackageManagement`/admin-credit.ts
        pattern (main admin bypasses, else require WITHDRAWAL_APPROVAL
        grant) — no shared generic helper, matches this codebase's existing
        per-module convention. Loads the request, rejects if not PENDING
        (no re-deciding). On approval: `postTransaction` DEBIT user's B /
        CREDIT SYSTEM_EXTERNAL (entryType likely needs a WITHDRAWAL-out type
        — reuse WITHDRAWAL_OUT, tagged referenceType "withdrawal_request"),
        update status -> APPROVED, decidedAt, decidedByAdminId, all in one
        DB transaction. No Friday restriction on admin decision (per brief).
      - `rejectWithdrawalRequest(actingAdminId, requestId, comment)`: same
        permission check. Requires non-empty comment. Updates status ->
        REJECTED, decidedAt, decidedByAdminId, adminComment. No ledger entry,
        Wallet B untouched.
      - Ownership: submit only ever acts on the calling userId (invariant
        #9); approve/reject take a requestId but must load it and act on
        whatever userId is stored on that row — never accept a client
        -supplied userId for the money movement.
      - Idempotency: approve/reject are guarded by the PENDING-only check
        (a second approve call on an already-APPROVED row is rejected, not
        silently reprocessed) rather than a separate idempotency key — no
        replay-of-money-movement risk since the ledger write only happens
        once per request by construction (status transition is the guard).
- [ ] Tests first (`withdrawal-requests.test.ts`):
      - $49 request rejected at submission (no row created)
      - $50 exactly succeeds (boundary, minimum is inclusive per docs)
      - valid request sits PENDING
      - non-Friday submission rejected (NotFridayError)
      - approval by a permitted admin (main admin, and separately a grantee)
        moves the money (B decreases, SYSTEM_EXTERNAL side posted) and sets
        status APPROVED + decidedByAdminId + decidedAt
      - approval by an admin without the grant is rejected, no state change
      - rejection leaves Wallet B untouched, sets status REJECTED +
        adminComment, no ledger entries written
      - rejection without a comment is rejected
      - approving/rejecting an already-decided request is rejected
- [x] Added `WithdrawalRequest` model (`withdrawal_requests`, migration
      `20260817164244_add_withdrawal_requests`, applied via `migrate deploy`
      per the standing hand-edited-migration rule) — status enum
      PENDING/APPROVED/REJECTED, decidedByAdminId FK, adminComment.
- [x] `src/lib/withdrawal-requests.ts`: `submitWithdrawalRequest` (Friday
      guard, suspension check, $50 minimum from `config.MIN_WITHDRAWAL`,
      inclusive — creates PENDING row, no ledger write yet).
      `approveWithdrawalRequest` (permission check matching the codebase's
      existing per-module pattern from admin-credit.ts/packages.ts — no
      Friday restriction, PENDING-only guard, `postTransaction` DEBIT B /
      CREDIT SYSTEM_EXTERNAL tagged to the request, status -> APPROVED).
      `rejectWithdrawalRequest` (same permission check, requires non-empty
      comment, PENDING-only guard, no ledger write, status -> REJECTED).
- [x] `src/lib/withdrawal-requests.test.ts`: 12 tests, all passing — $49
      rejected at submission, $50 exact boundary succeeds, non-Friday
      submission rejected, suspended-user block, approval by main admin
      moves money + updates status, approval by a WITHDRAWAL_APPROVAL
      grantee also works, approval without the grant rejected with no state
      change, admin decision explicitly proven to work on a non-Friday,
      re-approving an already-decided request rejected (no double-burn),
      rejection leaves B untouched + records reason + no ledger entry,
      empty-comment rejection blocked, rejection without the grant blocked.
- [x] Full suite: 27 files, 181/181 passing (169 prior + 12 new). `tsc
      --noEmit`: fully clean, zero errors. No leftover test data (checked
      withdrawal_requests/wallet_transfers counts post-run: 0).

## SCRUM-58: SAVING unlock job — DONE

Confirmed with user: add `source_investment_id` (nullable FK to Investment)
now, matching build_plan.md's documented `saving_lots` schema exactly, even
though nothing populates it until Phase 6 — avoids a second migration later.

Plan:
- [ ] Add `SavingLot` model to schema.prisma (`saving_lots`): id, userId,
      amount, sourceInvestmentId (nullable FK), createdAt, unlocksAt,
      releasedAt (nullable) + migration via `migrate dev --create-only` +
      `migrate deploy`.
- [ ] `src/lib/saving-lots.ts`: `releaseDueSavingLots(asOfDate: Date)` —
      finds every `saving_lots` row where `releasedAt IS NULL AND unlocksAt
      <= asOfDate`, and for each: `postTransaction` DEBIT user's SAVING /
      CREDIT user's C (entryType SAVING_UNLOCK, referenceType "saving_lot",
      referenceId = lot.id), then set `releasedAt = asOfDate`. Idempotency
      key: `saving_unlock:{lot.id}` — one lot can only ever be released
      once, the key doesn't need a date component (unlike daily interest,
      which repeats per day; a lot's release is a one-time event per lot).
      No job_runs wrapper needed — this isn't a periodic "catch up on missed
      calendar days" job like daily interest; it's "find whatever's currently
      due and hasn't been processed", which is naturally idempotent per-row
      via the releasedAt check + the ledger idempotency key as backstop.
      Takes `asOfDate` as a parameter, never calls `new Date()` internally
      (invariant #4).
- [ ] Tests first (`saving-lots.test.ts`):
      - a lot with unlocksAt in the past releases: SAVING decreases, C
        increases by the same amount, releasedAt gets set, ledger entries
        correct and balanced
      - a lot with unlocksAt in the future is left untouched (releasedAt
        stays null, no ledger entries, no balance change)
      - an already-released lot (releasedAt already set) is not reprocessed
        even if called again for a later asOfDate
      - multiple due lots for the same user all release, each with its own
        ledger entries, summing correctly into C
- [x] Added `SavingLot` model (`saving_lots`, migration
      `20260817165508_add_saving_lots`, applied via `migrate deploy`) — id,
      userId, amount, sourceInvestmentId (nullable, unpopulated until Phase
      6), createdAt, unlocksAt, releasedAt (nullable), indexed on
      `(releasedAt, unlocksAt)` for the due-lot query.
- [x] `src/lib/saving-lots.ts`: `releaseDueSavingLots(asOfDate)` — queries
      `releasedAt IS NULL AND unlocksAt <= asOfDate`, for each due lot posts
      `postTransaction` DEBIT SAVING / CREDIT C (entryType SAVING_UNLOCK,
      tagged to the lot) then sets `releasedAt`, all in one DB transaction
      per lot. Idempotency key `saving_unlock:{lotId}` — one-time per lot,
      no job_runs/period wrapper needed (this isn't a "catch up on missed
      calendar days" job like daily interest; a lot is either due-and
      -unreleased or it isn't).
- [x] `src/lib/saving-lots.test.ts`: 4 tests, all passing — a due lot
      releases correctly (SAVING to 0, C credited, releasedAt set, 2 balanced
      ledger entries), a not-yet-due lot is completely untouched, an
      already-released lot is not reprocessed on a later call (proven by C's
      balance staying at its pre-set value, not doubling), multiple due lots
      for the same user each release independently and sum correctly into C
      while a still-future lot in the same batch is left alone.
- [x] Full suite: 28 files, 185/185 passing (181 prior + 4 new). `tsc
      --noEmit`: fully clean. No leftover test data.

## SCRUM-59: Capital release (A->B, principal only) — DONE

Investigated the "stops earning" requirement before implementing: the
catch-up job (`daily-interest-job.ts` line 99-100) already queries only
`status: "ACTIVE"` investments, so a CAPITAL_RELEASED investment is
correctly excluded from the daily batch in production today. BUT
`accrueDailyInterestForInvestment` itself (`daily-interest.ts`) has no
status check inside it — it only checks profitStartsAt/isFriday/suspendedAt.
It's safe today only because its one caller pre-filters by status; the
function doesn't independently enforce the invariant. Fixing this as part of
this task (adding an explicit skip reason inside the accrual function
itself), not treating the job-level filter as sufficient — this is exactly
the kind of thing the task asked to confirm rather than assume.

Plan:
- [ ] `src/lib/daily-interest.ts`: add `"capital_released"` to
      `AccrualSkipReason`, add a check `if (investment.status ===
      "CAPITAL_RELEASED") return { skipped: true, reason:
      "capital_released" }` early in `accrueDailyInterestForInvestment` —
      makes the function itself correct regardless of caller, not reliant on
      the job's pre-filter alone.
- [ ] `src/lib/capital-release.ts`: `releaseCapital(userId, investmentId,
      forDate)`:
      - ownership: load the investment by id, verify `investment.userId ===
        userId` (invariant #9 — reject if it belongs to someone else, don't
        just trust the caller)
      - `assertFriday(forDate)`
      - suspension check
      - reject if `investment.status !== "ACTIVE"` (already released)
      - reject if `forDate < investment.capitalUnlocksAt` (lock not yet
        expired) — inclusive at exactly capitalUnlocksAt, per "release
        exactly at/after the unlock date succeeds"
      - `postTransaction`: DEBIT user's A / CREDIT user's B, amount =
        `investment.amount` (principal only — never touches accrued profit
        sitting in the same A balance), entryType CAPITAL_RELEASE,
        referenceType "investment", referenceId = investment.id.
        Idempotency key: `capital_release:{investmentId}` — one-time per
        investment, same reasoning as saving-lot release (not a repeating
        per-day event).
      - Update investment: status -> CAPITAL_RELEASED, capitalReleasedAt =
        forDate, in the same DB transaction as the ledger post.
- [ ] Tests first (`capital-release.test.ts`):
      - release attempted before capitalUnlocksAt is rejected, investment
        untouched
      - release exactly at capitalUnlocksAt succeeds
      - release moves only the principal, not accrued profit sitting in the
        same A balance (fund A with principal + profit via a real accrual
        call or direct credit, assert only principal amount moves, exact
        profit remainder stays in A)
      - status -> CAPITAL_RELEASED and capitalReleasedAt set correctly
      - a released investment no longer accrues interest on the next
        accrueDailyInterestForInvestment call (call it directly post
        -release, assert skipped/reason capital_released, no ledger entries)
      - non-Friday release attempt rejected
      - re-releasing an already-released investment rejected
      - ownership: releasing another user's investment rejected
- [x] Fixed the confirmed gap: added `"capital_released"` to
      `AccrualSkipReason` and an explicit `investment.status ===
      "CAPITAL_RELEASED"` check at the top of
      `accrueDailyInterestForInvestment` itself (`daily-interest.ts`) — the
      function now independently enforces "stops earning" rather than
      relying solely on the daily catch-up job's `status: "ACTIVE"`
      pre-filter (which was already correct, but was the only thing
      enforcing the invariant before this fix).
- [x] `src/lib/capital-release.ts`: `releaseCapital(userId, investmentId,
      forDate)` — ownership check (`InvestmentNotOwnedError`), Friday guard,
      suspension check, already-released check (`CapitalAlreadyReleasedError`),
      lock-not-expired check (`CapitalStillLockedError`, inclusive at exactly
      `capitalUnlocksAt`), `postTransaction` DEBIT A / CREDIT B for
      `investment.amount` only (entryType CAPITAL_RELEASE), status ->
      CAPITAL_RELEASED + capitalReleasedAt set, all atomic. Idempotency key
      `capital_release:{investmentId}` (one-time per investment); a genuine
      replay is actually blocked earlier by the already-released check, so
      the key is a backstop, not the primary guard.
- [x] `src/lib/capital-release.test.ts`: 7 tests, all passing — rejected
      before lock expiry (investment/wallets untouched), succeeds exactly at
      the unlock instant, succeeds after it, principal-only proven directly
      (funded A with 1000 principal + 150 profit in the same balance,
      release moves exactly 1000 leaving 150 in A), a released investment's
      next `accrueDailyInterestForInvestment` call returns
      `skipped/capital_released` with zero new ledger entries, non-Friday
      rejected, re-release of an already-released investment rejected (no
      double-move, still exactly 2 CAPITAL_RELEASE entries), releasing
      another user's investment rejected.
- [x] Full suite: 29 files, 192/192 passing (185 prior + 7 new
      capital-release tests; the 6 pre-existing daily-interest.test.ts tests
      also re-verified green with the new status check added). `tsc
      --noEmit`: fully clean. No leftover test data.

## SCRUM-61: Withdrawal UI — DONE

Added shadcn `input`, `label`, `tabs` components (none existed yet — every
prior form in the app so far was buttons-only, this is the first page
needing a text input).

Reviewed existing Phase 3 patterns before building (packages/investments
pages) to reuse rather than reinvent:
- Server component reads data fresh per render; server action calls
  `revalidatePath` on success so the already-mounted client re-renders with
  fresh props (no manual reload) — same pattern for every mutation here.
- Confirmation dialog pattern from `package-grid.tsx` (open -> confirm ->
  success/error states, `isPending` disables buttons during the transition).
- `flex flex-row items-center gap-2` for every icon+text pairing; no
  physical `left-*`/`right-*` classes anywhere (lessons.md RTL entries).
- Card grid pattern (`shadow-sm hover:shadow-md`, `flex flex-col
  justify-between`) from investment-list.tsx for the capital-release-per
  -investment cards.
- Empty state pattern (icon + title + description, dashed border) reused
  for "no B-exit requests yet".

Plan:
- [ ] `src/lib/next-friday.ts`: `daysUntilNextFriday(now: Date): number` —
      pure function, explicit `now` param (invariant #4 discipline even for
      display code, matches `daysUntil` in investments.ts). Returns 0 if
      `now` is already Friday (Asia/Dubai), otherwise days remaining. Small
      unit test alongside (`next-friday.test.ts`) covering a few weekdays
      and the Friday-itself case, plus the UTC/Dubai boundary case from the
      withdrawal-guard tests (reused dates).
- [ ] `src/lib/withdrawal-requests.ts`: add
      `listWithdrawalRequestsForUser(userId)` — user's own requests, newest
      first, ownership enforced by construction (same pattern as
      `listInvestmentsForUser`). Needed for the status list; doesn't exist
      yet.
- [ ] New route `src/app/[locale]/withdrawals/page.tsx` (server component,
      `requireSession`-protected):
      - reads: wallet A/B/C/SAVING balances, withdrawableProfitA,
        withdrawableC, user's investments (for capital-release cards, only
        ACTIVE ones with capitalUnlocksAt info), user's withdrawal requests
        (listWithdrawalRequestsForUser), `daysUntilNextFriday(new Date())`,
        `isFriday(new Date())`
      - passes all as props to client components below
- [ ] `withdrawal-actions.ts` ("use server"): thin action wrappers mirroring
      `packages/actions.ts`'s pattern exactly —
      `transferAtoBAction`/`transferCtoBAction`/`releaseCapitalAction`/
      `submitWithdrawalRequestAction`, each: `requireSession` for the
      userId (never client-supplied), call the corresponding lib function
      with `new Date()`, `revalidatePath` on success, map thrown error
      classes to translated error keys (NotFridayError,
      InsufficientWithdrawableBalanceError, AccountSuspendedError,
      BelowMinimumWithdrawalError, CapitalStillLockedError,
      CapitalAlreadyReleasedError, generic fallback).
- [ ] `transfer-panel.tsx` (client component): A->B and C->B as two cards
      (or tabs — deciding at build time based on how it reads) each showing
      withdrawable amount, an amount input (client-side validation: numeric,
      > 0, <= withdrawable shown inline, $ handled via toDisplay), submit
      button. Disabled with a countdown message when non-Friday
      (`daysUntilNextFriday`), matching the "disabled state with countdown"
      requirement literally — not just a disabled button with no
      explanation. Confirmation dialog before submit (frontend-design rule
      6: every financial action needs a confirm step with concrete amount
      shown) — reuses the Dialog primitive and success/error state pattern
      from package-grid.tsx.
- [ ] `capital-release-panel.tsx` (client component): one card per ACTIVE
      investment showing package name, principal amount, capital-unlock
      countdown/status (reusing the exact display logic already in
      investment-list.tsx), and a release button — disabled if either not
      yet unlocked OR non-Friday, with the specific reason shown (two
      different disabled reasons, must be visually distinguishable, not a
      single generic "unavailable"). Confirmation dialog before release.
- [ ] `b-exit-form.tsx` (client component): amount input with $50 minimum
      enforced client-side (inline validation message, matching
      frontend-design rule 6 — server-side via BelowMinimumWithdrawalError
      is the real guard per the task's own framing), Friday-disabled state
      with countdown, confirmation dialog, submits via
      submitWithdrawalRequestAction.
- [ ] `b-exit-status-list.tsx`: past requests, newest first, status badge
      (PENDING=amber/warning, APPROVED=success green, REJECTED=destructive
      red — new 3-way status color mapping, consistent with the existing
      Active/Capital-released 2-way mapping's spirit but its own set since
      these are different semantics). Shows amount, requestedAt
      (formatDate), and for decided ones: decidedAt + adminComment if
      rejected. Empty state if no requests yet.
- [ ] `loading.tsx` skeleton matching the page's card/list shapes.
- [ ] i18n: new `Withdrawals` namespace in both messages/en.json and
      messages/ar.json in this commit. Wallet A/B/C/SAVING stay English
      (glossary rule); everything else translated, including correct
      Arabic ICU plural categories for day-count strings (matches the
      Investments namespace's existing pattern).
- [ ] RTL-specific pass per lessons.md's two dedicated entries: every
      icon+text pair gets explicit `flex flex-row items-center gap-2`; grep
      new files for physical `left-*`/`right-*`/`ml-*`/`mr-*`/`pl-*`/`pr-*`/
      `text-left`/`text-right` before considering done; any
      absolutely-positioned corner element (if any) uses logical
      `start-*`/`end-*`.
- [ ] Manual verification in the running dev container: exercise A->B,
      C->B, capital release, and B-exit submission against a real test user
      on both a fabricated-Friday and non-Friday state if feasible (or at
      minimum verify the disabled/countdown states render correctly on
      today's real weekday), in both `/en/withdrawals` and `/ar/withdrawals`
      — check RTL layout specifically on the status badges and confirmation
      dialogs per the recurring lesson category.
- [x] Built everything per the plan: `src/lib/next-friday.ts`
      (`daysUntilNextFriday`, 6 tests incl. UTC/Dubai boundary cases),
      `listWithdrawalRequestsForUser` added to withdrawal-requests.ts,
      `src/app/[locale]/withdrawals/{page.tsx, actions.ts, transfer-panel.tsx,
      capital-release-panel.tsx, b-exit-form.tsx, b-exit-status-list.tsx,
      loading.tsx}`. Full `Withdrawals` i18n namespace added to both
      messages/en.json and messages/ar.json (Wallet A/B/C/SAVING kept
      English per glossary; Arabic Friday-countdown string uses full ICU
      plural categories zero/one/two/few/many/other, matching the
      Investments namespace's existing pattern).
- [x] A->B/C->B built as two side-by-side cards (confirmed with user, not
      tabs) inside one grid.
- [x] `tsc --noEmit`: fully clean. Full suite: 30 files, 198/198 passing
      (192 prior + 6 new next-friday tests).
- [x] Manual verification against the real running dev container (not just
      unit tests) as `browser-test@test.local`:
      - `/en/withdrawals`: 200, correct wallet balances (A 6300.00, B
        500.00, C 6500.00 — real data, no placeholder/test junk visible),
        Friday countdown correctly reads "4 days remaining" (today is a
        real Monday in Asia/Dubai, confirmed via `TZ=Asia/Dubai date`
        against the running container's actual clock — 4 days to Friday is
        exactly right), capital-release cards correctly show "still within
        the 6-month lock" for both real investments (unlocksAt Feb 2027),
        B-exit empty state renders correctly (no requests yet for this
        user), all buttons correctly disabled server-side via `isFriday:
        false` prop (confirmed in the RSC payload, not just visually).
      - `/ar/withdrawals`: 200, `dir="rtl"` present, every string correctly
        translated, Wallet A/B/C stayed English per the glossary rule,
        Friday countdown correctly rendered "4 أيام متبقية" (the Arabic
        "few" plural category for 4 — proves the ICU categories are wired
        correctly, not just present in the JSON), numerals stayed Western
        (0.00/100.00/etc, never Eastern Arabic digits).
      - No runtime errors/warnings in the app container logs across either
        request.
      - Root cause of an initial 404: the dev container's file watcher
        hadn't picked up the newly-created route directory; `docker compose
        restart app` resolved it (consistent with this project's known
        Windows-bind-mount dev quirks, not a code defect — confirmed by the
        page working immediately post-restart with zero code changes).
- [x] RTL pass: grepped all new files for physical
      left-*/right-*/ml-*/mr-*/pl-*/pr-*/text-left/text-right — zero
      matches. Every icon+text pairing (Friday-countdown clock icon, lock
      icon, success checkmark, empty-state icons) uses explicit `flex
      flex-row items-center gap-2`, matching the two dedicated lessons.md
      RTL entries from Phase 3.
- [x] Reused established patterns throughout rather than reinventing:
      confirm-dialog open/success/error state machine and `revalidatePath`
      -on-success from packages/actions.ts + package-grid.tsx; card grid and
      empty-state visuals from investment-list.tsx; `formatDate`/`toDisplay`
      from display.ts unchanged.
- [x] Added shadcn `input`, `label`, `tabs` components (first form input in
      the app; `tabs` pulled in but unused after choosing the two-card
      layout — left in place since it's a standard shadcn primitive other
      future screens will likely need, not dead app code).

## SCRUM-62: Phase 5 exit test — RUN AND PASSED

Ran a real scratch script (`.scratch_exit_test_phase5.ts`, deleted after —
matches the Phase 3 exit-test convention) directly against the dev database,
using real lib functions (`transferAtoB`/`transferCtoB`, `submitWithdrawalRequest`/
`approveWithdrawalRequest`/`rejectWithdrawalRequest`, `releaseCapital`,
`accrueDailyInterestForInvestment`), not a re-run of the permanent unit
suite. Migration state verified clean first (`prisma migrate status`).

One exit-test clause — "their leg's active status flips to inactive for
their upline" — depends on `binary_nodes`/leg-active-status tracking, which
is Phase 8 work and does not exist in the schema or codebase yet (confirmed
via grep before running). Marked N/A per the user's direction, not silently
dropped or fabricated.

### Results (29/29 testable assertions passed, 1 clause correctly N/A)

**Scenario 1 — A->B and C->B, Friday vs non-Friday:**
- Both rejected on a real Thursday (`NotFridayError`), Wallet A untouched
- Both succeed instantly on a real Friday with no approval step
- Wallet A left with exactly the locked capital (1000) after the 200 profit
  moved out; Wallet C fully drained; Wallet B received both (350 total)

**Scenario 2 — $200 B-exit request, PENDING -> admin approval:**
- Sits PENDING after submission, Wallet B untouched while pending, no
  SYSTEM_EXTERNAL entry exists yet
- Main admin approval (on a non-Friday Monday, confirming admin decisions
  aren't Friday-restricted) flips status to APPROVED, Wallet B decreases by
  exactly 200, SYSTEM_EXTERNAL reflects the burned amount

**Scenario 3 — rejected B-exit request:**
- Status REJECTED, reason recorded, Wallet B completely untouched, zero
  ledger entries written

**Scenario 4 — $49 B-exit request:**
- Rejected at submission (`BelowMinimumWithdrawalError`), no request row
  created at all

**Scenario 5 — capital release, month 5 vs month 6:**
- Constructed a real Friday attempt genuinely before a 6-month unlock
  (purchased 2026-03-21, unlocks 2026-09-21, attempted 2026-08-21 — a real
  Friday, isolating the capital-lock check from the Friday guard) —
  correctly blocked with `CapitalStillLockedError`
- A second investment constructed so its exact 6-month unlock date IS a
  real Friday (purchased 2026-02-21 -> unlocks 2026-08-21) — release
  allowed exactly at that instant, status -> CAPITAL_RELEASED,
  capitalReleasedAt recorded correctly
- Caught and fixed one bug in the test itself before this passed: the first
  draft's month-5 date math accidentally substituted a later date whenever
  the naive month-5 mark fell before the fabricated Friday, silently testing
  "well past unlock" instead of "still locked" — caught because the
  assertion still failed, not silently passed; rewritten with an explicit
  test-setup assertion (`FRIDAY < capitalUnlocksAtMonth5Case`) proving the
  scenario actually tests what it claims to before checking the real
  assertion.

**Scenario 6 — suspended user, zero interest the day after suspension:**
- Investment purchased 2026-08-01, user suspended 2026-08-15, accrual
  attempted 2026-08-16 (a non-Friday) — skipped with reason
  `owner_suspended`, zero DAILY_INTEREST ledger entries, Wallet A balance
  stayed at its unfunded 0 (never funded, so zero credited is unambiguous)

**Scenario 7 — leg-active-status for upline: N/A, Phase 8 not built yet.**

### Cleanup and regression check
- Verified zero orphaned rows in the tables directly scoped by `userId`
  (test users, packages, investments all counted 0 by their distinguishing
  markers) — this check alone was **not sufficient**, see below.
- Scratch script deleted; `git status` confirms no trace.
- First full-suite run after the exit test caught a real bug: my own exit
  -test script's cleanup deleted ledger rows via `where: { userId: { in:
  createdUserIds } } }`, which misses the paired `SYSTEM_EXTERNAL` row
  (`userId: null`) from every `postTransaction` call — the exact mistake
  already flagged twice in lessons.md's Phase 2 entries, now a third time.
  `reconciliation.test.ts` failed with a real -8700 global-solvency drift.
  Diagnosed by finding every SYSTEM_EXTERNAL ledger row with no surviving
  idempotencyKey-sibling (16 orphans, all traced to this session's own
  `phase5-exit-fund:*`/`withdrawal_request_approval:*` calls — confirmed
  self-inflicted, not pre-existing). Repaired via the standard
  recompute-from-source principle: deleted exactly those 16 orphaned rows
  (found by idempotencyKey lookup, not guessed), re-verified via the real
  `runReconciliation()` function, then re-ran the full suite as final
  proof — see lessons.md's new entry for the full writeup and standing rule.
- Second (post-fix) full suite: 30 files, 198/198 passing, including
  `reconciliation.test.ts` clean. No regressions from this session's other
  work (config.ts lazy-Proxy rewrite, session.ts Secure-flag fix,
  daily-interest.ts capital_released check, all of SCRUM-56/57/58/59/61).

**PHASE 5 EXIT TEST: ALL TESTABLE CRITERIA PASSED (29/29); ONE CLAUSE
CORRECTLY N/A PENDING PHASE 8. Full suite clean, including whole-database
reconciliation, after fixing a real cleanup bug the exit test's own
assertions did not catch.**

Phase 5 is complete pending user confirmation in the operation-room chat per
CLAUDE.md's build-order rule.

## Post-SCRUM-62 follow-up: shared test-cleanup helper (structural fix)

User asked, after the third occurrence of the SYSTEM_EXTERNAL orphan
mistake, whether it could be made structurally harder to get wrong rather
than relying on remembering the rule each time — requested before closing
Phase 5, since Phase 6+ keeps writing tests that touch SYSTEM_EXTERNAL.

- [x] Investigated existing cleanup patterns across all 30 test files first.
      Found every file already *tried* to be correct via a hand-maintained
      `createdEntryIds` array pushed after each transaction call — the
      3 real incidents all happened at a call site that skipped this
      manual step, not because the pattern was unknown.
- [x] Designed `cleanupLedgerEntriesForUsers(userIds: string[])` in new
      `src/lib/test-helpers.ts` — takes only the user-id array every test
      already reliably tracks (that part has never failed), looks up every
      ledger entry belonging to those users, collects the distinct
      idempotencyKeys, deletes every row sharing those keys (any userId,
      including null) in one call. Structurally includes SYSTEM_EXTERNAL
      siblings by construction — no per-call-site array-pushing discipline
      required at all, unlike the old pattern.
      Considered and rejected an idempotencyKey-array version instead
      (confirmed with user): several production functions
      (`transferAtoB`, etc.) generate their key internally via
      `randomUUID()`, so a test can't always capture it in advance — same
      discipline gap as the bug being fixed.
- [x] `src/lib/test-helpers.test.ts`: 5 tests — deletes both sides of a
      pair including SYSTEM_EXTERNAL, leaves other users' entries
      untouched, handles a >2-entry transaction (not just a simple pair),
      no-op for an empty list, no-op for a user with no entries.
- [x] Migrated every test file with the risky `userId`-only ledger-cleanup
      pattern to the new helper, removing the manual `createdEntryIds`
      tracking entirely: `admin-credit.test.ts`, `transfers.test.ts`,
      `withdrawal-requests.test.ts`, `capital-release.test.ts`,
      `saving-lots.test.ts`, `reconciliation.test.ts`,
      `ledger-transaction.test.ts`, `investments.test.ts`. Deliberately
      did NOT touch `daily-interest.test.ts`/`daily-interest-job.test.ts`
      — those already scope cleanup by `referenceType`/`referenceId`
      (investment id), a different but equally correct strategy for
      DAILY_INTEREST's specific pairing, not the bug class being fixed;
      migrating them would be unnecessary churn on already-correct code.
- [x] `tsc --noEmit` clean after every migration (confirms no dead
      `createdEntryIds` variables or now-unused `entries`/`rows` bindings
      left behind).
- [x] Full suite: 31 files, 203/203 passing (198 prior + 5 new
      `test-helpers.test.ts`), including `reconciliation.test.ts` — the
      exact whole-database check that caught the original bug — still
      clean. Re-verified drift is 0 via a direct DB query as final proof.
- [x] Logged in lessons.md as an addendum to the SCRUM-62 entry: this is
      now the standing pattern for any future test/script touching
      ledger_entries, not just a fix for the three past incidents.
