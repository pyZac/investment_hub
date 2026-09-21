"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { reverseLedgerTransactionAction, type AdjustmentActionErrorKey, type TransactionRow } from "./actions";
import { toDisplayWithCurrency } from "@/lib/display";

function opposite(direction: "CREDIT" | "DEBIT"): "CREDIT" | "DEBIT" {
  return direction === "CREDIT" ? "DEBIT" : "CREDIT";
}

export function ReversalConfirmDialog({
  transaction,
  idempotencyKey,
  locale,
  onClose,
  onReversed,
}: {
  transaction: TransactionRow[];
  idempotencyKey: string;
  locale: string;
  onClose: () => void;
  onReversed: () => void;
}) {
  const t = useTranslations("AdminManualAdjustment");
  const [reason, setReason] = useState("");
  const [errorKey, setErrorKey] = useState<AdjustmentActionErrorKey | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!reason.trim()) {
      setErrorKey("errorReasonRequired");
      return;
    }
    setErrorKey(null);
    startTransition(async () => {
      const result = await reverseLedgerTransactionAction(idempotencyKey, reason, locale);
      if (result.ok) {
        setSuccess(true);
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  function handleOpenChange(open: boolean) {
    if (!open && !isPending) {
      onClose();
      if (success) {
        onReversed();
      }
    }
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          {success ? (
            <DialogTitle className="flex flex-row items-center gap-2">
              <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" />
              <span>{t("reversalSuccessTitle")}</span>
            </DialogTitle>
          ) : (
            <DialogTitle>{t("confirmReversalTitle")}</DialogTitle>
          )}
          <DialogDescription>{success ? t("reversalSuccessDescription") : t("confirmReversalDescription")}</DialogDescription>
        </DialogHeader>

        {!success && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">{t("willPostLabel")}</p>
            <div className="space-y-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
              {transaction.map((row) => (
                <div key={row.id} className="flex flex-row items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-muted-foreground" dir="ltr">
                    {row.userEmail ?? "Platform Reserve"} — Wallet {row.wallet}
                  </span>
                  <span className="shrink-0 font-heading font-semibold tabular-nums" dir="ltr">
                    {opposite(row.direction) === "CREDIT" ? "+" : "−"}
                    {toDisplayWithCurrency(row.amount)}
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reversal-reason">{t("reasonLabel")}</Label>
              <Input
                id="reversal-reason"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setErrorKey(null);
                }}
                placeholder={t("reasonPlaceholder")}
              />
            </div>
          </div>
        )}

        {errorKey && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {t(errorKey)}
          </p>
        )}

        {!success && (
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" disabled={isPending} onClick={() => handleOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button className="cursor-pointer" disabled={isPending} onClick={submit}>
              {isPending ? t("submitting") : t("confirmReversalSubmit")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
