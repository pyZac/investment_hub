# Claude Code Session Prompts — one per phase

**One phase = one session.** Start a fresh Claude Code session for each phase and
paste the matching prompt below. Nothing else needs pasting: `CLAUDE.md` is loaded
automatically, and it points at the docs and lessons file.

Do not start a phase until the previous phase's Exit Test has been run, shown, and
confirmed in the operation-room chat.

---

## Phase 0 — Foundation

```
We are starting Phase 0 — Foundation. This is the first phase; there are no prerequisites.

Read /docs/phases/phase-00-foundation.md and /tasks/lessons.md before doing anything else.

Write /tasks/todo.md as this session's checklist first and show it to me before you start implementing.

Then build the phase deliverables. Exit test: `docker compose up` gives a running app plus a reachable DB, and /en and /ar both render with correct dir. Run the exit test and show me the output before marking anything complete.
```

---

## Phase 1 — Auth & Users

```
We are starting Phase 1 — Auth & Users. Phase 0 is complete and its exit test passed.

Read /docs/phases/phase-01-auth-users.md and /tasks/lessons.md first.

Write /tasks/todo.md as this session's checklist and show it to me before implementing.

Write tests first, then the implementation. Run the phase's exit test and show me the output before marking anything complete.
```

---

## Phase 2 — Ledger & Wallets ⭐

```
We are starting Phase 2 — Ledger & Wallets. Phases 0–1 are complete and their exit tests passed.

This is the most important phase in the project — every later phase calls into what you build here. Be paranoid.

Read /docs/phases/phase-02-ledger-wallets.md, /tasks/lessons.md, and the money-precision skill first. Also read Decision 1 and Decision 2 in /docs/build_plan.md in full.

Write /tasks/todo.md as this session's checklist and show it to me before implementing. I want to review the ledger schema and the postTransaction signature before you write the implementation.

Write tests first. Run the exit test and show me the output before marking anything complete.
```

---

## Phase 3 — Packages & Purchase

```
We are starting Phase 3 — Packages & Purchase. Phases 0–2 are complete and their exit tests passed.

Read /docs/phases/phase-03-packages-purchase.md and /tasks/lessons.md first.

Write /tasks/todo.md as this session's checklist and show it to me before implementing.

Write tests first, then implementation. Run the exit test and show me the output before marking anything complete.
```

---

## Phase 4 — Daily Interest Engine

```
We are starting Phase 4 — Daily Interest Engine. Phases 0–3 are complete and their exit tests passed.

Read /docs/phases/phase-04-daily-interest.md, /tasks/lessons.md, and the money-precision skill first.

Two things I will be checking closely: every engine function takes forDate as a parameter and never calls new Date() internally, and the ~4.3% effective monthly rate from skipped Fridays is left as-is, not "corrected".

Write /tasks/todo.md as this session's checklist and show it to me before implementing.

Write the 90-day fabricated-date test suite first, then the implementation. Run the exit test and show me the output.
```

---

## Phase 5 — Withdrawals

```
We are starting Phase 5 — Withdrawals. Phases 0–4 are complete and their exit tests passed.

Read /docs/phases/phase-05-withdrawals.md and /tasks/lessons.md first.

Note there are three distinct flows here that must not be conflated: self-service A→B and C→B transfers, the admin-approved Wallet B exit burn, and user-initiated capital release after the 6-month lock.

Write /tasks/todo.md as this session's checklist and show it to me before implementing.

Write tests first. Run the exit test and show me the output.
```

---

## Phase 6 — Sponsor Tree & Direct Commission

```
We are starting Phase 6 — Sponsor Tree & Direct Commission. Phases 0–5 are complete and their exit tests passed.

Read /docs/phases/phase-06-direct-commission.md, /tasks/lessons.md, and the money-precision skill first.

The trigger is the buyer's first-ever purchase only — reinvestments never re-trigger it. This is deliberately different from Rank MRV in Phase 9. Do not unify them.

Write /tasks/todo.md as this session's checklist and show it to me before implementing.

Write tests first. Run the exit test and show me the output.
```

---

## Phase 7 — Placement Tree & BV Rollup

```
We are starting Phase 7 — Placement Tree & BV Rollup. Phases 0–6 are complete and their exit tests passed.

Read /docs/phases/phase-07-placement-tree-bv.md and /tasks/lessons.md first.

The placement tree is separate from the sponsor tree. A user sponsored by X may be placed under Y via spillover — that is intentional. Weaker leg is measured by BV, not member count.

Write /tasks/todo.md as this session's checklist and show it to me before implementing.

Write tests first. Run the exit test and show me the output.
```

---

## Phase 8 — Binary Cycle Engine

```
We are starting Phase 8 — Binary Cycle Engine. Phases 0–7 are complete and their exit tests passed.

Read /docs/phases/phase-08-binary-cycle.md, /tasks/lessons.md, and the money-precision skill first.

The hardest part here is that leg activity is a live, dynamic status — a capital release or an admin suspension can flip a leg back to inactive. It needs its own recheck path, not just an on-write check.

Write /tasks/todo.md as this session's checklist and show it to me before implementing.

Write tests first, including the spec's worked example (Left 15,000 / Right 7,000 → 560 paid, next cycle opens 8,000 / 0) and the carry-forward expiry case. Run the exit test and show me the output.
```

---

## Phase 9 — MRV & Ranking Engine

```
We are starting Phase 9 — MRV & Ranking Engine. Phases 0–8 are complete and their exit tests passed.

Read /docs/phases/phase-09-mrv-ranking.md, /tasks/lessons.md, and the money-precision skill first.

Before you implement anything, raise the open question flagged in the phase brief about the OG rank threshold, and wait for my answer.

Note that MRV counts every purchase at depth 1 — deliberately different from both Direct Commission (first purchase only) and Binary (unlimited rollup). Three different triggers on purpose.

Write /tasks/todo.md as this session's checklist and show it to me before implementing.

Write tests first. Run the exit test and show me the output.
```

---

## Phase 10 — User Dashboard

```
We are starting Phase 10 — User Dashboard. Phases 0–9 are complete and their exit tests passed.

Read /docs/phases/phase-10-user-dashboard.md, /tasks/lessons.md, and the bilingual-rtl skill first. Also load the frontend-design skill for this phase.

Write /tasks/todo.md as this session's checklist and show it to me before implementing.

The exit test includes an actual RTL walkthrough — the tree visualization, charts, and wallet cards specifically. Translated strings alone do not count as done.
```

---

## Phase 11 — Admin Panel

```
We are starting Phase 11 — Admin Panel. Phases 0–9 are complete and their exit tests passed.

Read /docs/phases/phase-11-admin-panel.md, /tasks/lessons.md, and the bilingual-rtl skill first. Also load the frontend-design skill.

Every section is gated by its specific permission, enforced server-side per route. Hiding a button is not enforcement — the exit test calls the API directly to verify rejection.

Write /tasks/todo.md as this session's checklist and show it to me before implementing.

Run the exit test and show me the output.
```

---

## Phase 12 — Audit, Reconciliation & Security Hardening

```
We are starting Phase 12 — Audit, Reconciliation & Security Hardening. Phases 0–11 are complete and their exit tests passed.

Read /docs/phases/phase-12-audit-security.md and /tasks/lessons.md first.

Auth-layer security was built in Phase 1 — verify it, don't rebuild it. This phase covers what only becomes checkable across the whole system.

Write /tasks/todo.md as this session's checklist and show it to me before implementing.

Run the exit test — including the deliberately-introduced-drift case — and show me the output.
```

---

## Phase 13 — Deployment

```
We are starting Phase 13 — Deployment. Phases 0–12 are complete and their exit tests passed.

Read /docs/phases/phase-13-deployment.md and /tasks/lessons.md first.

Write /tasks/todo.md as this session's checklist and show it to me before implementing.

The exit test includes rehearsing a restore from backup and confirming the worker auto-restarts with catch-up working. Run it and show me the output.
```

---

## Mid-phase recovery prompt

If a session goes long or Claude Code loses the thread, paste this rather than
starting over:

```
Stop. Re-read /docs/phases/phase-NN-*.md, /tasks/todo.md, and /tasks/lessons.md.

Tell me: which checklist items are actually done and verified, which are in progress, and what is left. Do not write any code until I confirm the state.
```
