"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { UserPicker } from "./user-picker";
import { EntryPicker } from "./entry-picker";
import { ReversalConfirmDialog } from "./reversal-confirm-dialog";
import { findLedgerTransactionAction, type UserOption, type LedgerEntryRow, type TransactionRow } from "./actions";

export function AdjustmentFlow({ locale }: { locale: string }) {
  const t = useTranslations("AdminManualAdjustment");
  const [user, setUser] = useState<UserOption | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<LedgerEntryRow | null>(null);
  const [transaction, setTransaction] = useState<TransactionRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function handleSelectEntry(entry: LedgerEntryRow) {
    setSelectedEntry(entry);
    setLoadError(false);
    const result = await findLedgerTransactionAction(entry.id);
    if (result.ok) {
      setTransaction(result.transaction);
    } else {
      setLoadError(true);
    }
  }

  function closeConfirm() {
    setTransaction(null);
    setSelectedEntry(null);
  }

  function handleUserChange(next: UserOption | null) {
    setUser(next);
    setSelectedEntry(null);
    setTransaction(null);
    setLoadError(false);
  }

  return (
    <div className="space-y-6">
      <UserPicker value={user} onChange={handleUserChange} />

      {user && !selectedEntry && <EntryPicker userId={user.id} onSelect={handleSelectEntry} />}

      {loadError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t("errorGeneric")}
        </p>
      )}

      {transaction && selectedEntry && (
        <ReversalConfirmDialog
          transaction={transaction}
          idempotencyKey={selectedEntry.idempotencyKey}
          locale={locale}
          onClose={closeConfirm}
          onReversed={() => {
            setUser(null);
          }}
        />
      )}
    </div>
  );
}
