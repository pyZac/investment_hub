import type { Wallet } from "@prisma/client";

/**
 * SYSTEM_EXTERNAL is the internal/database name for the "outside the
 * simulation" counterparty account (Decision 1). It must never be shown to
 * admins under its raw name — always under this label.
 */
const WALLET_DISPLAY_LABELS: Record<Wallet, string> = {
  A: "A",
  B: "B",
  C: "C",
  SAVING: "SAVING",
  SYSTEM_EXTERNAL: "Platform Reserve",
};

export function walletDisplayLabel(wallet: Wallet): string {
  return WALLET_DISPLAY_LABELS[wallet];
}
