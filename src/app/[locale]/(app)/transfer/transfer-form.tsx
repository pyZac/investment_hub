"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Send } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
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
import { RecipientPicker } from "./recipient-picker";
import { transferToUserAction, type TransferActionErrorKey, type RecipientOption } from "./actions";

export function TransferForm({
  walletBBalance,
  minimumTransfer,
  locale,
}: {
  walletBBalance: string;
  minimumTransfer: number;
  locale: string;
}) {
  const t = useTranslations("Transfer");
  const [recipient, setRecipient] = useState<RecipientOption | null>(null);
  const [amount, setAmount] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorKey, setErrorKey] = useState<TransferActionErrorKey | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const walletBNumber = Number(walletBBalance);

  function validate(): boolean {
    if (!recipient) {
      setFieldError(t("errorRecipientRequired"));
      return false;
    }
    const parsed = Number(amount);
    if (!amount || Number.isNaN(parsed) || parsed <= 0) {
      setFieldError(t("errorAmountInvalid"));
      return false;
    }
    if (parsed < minimumTransfer) {
      setFieldError(t("errorBelowMinimum", { minimum: minimumTransfer }));
      return false;
    }
    if (parsed > walletBNumber) {
      setFieldError(t("errorInsufficientBalance"));
      return false;
    }
    setFieldError(null);
    return true;
  }

  function openConfirm() {
    if (!validate()) return;
    setErrorKey(null);
    setSuccess(false);
    setConfirmOpen(true);
  }

  function closeDialog(open: boolean) {
    if (!open && !isPending) {
      setConfirmOpen(false);
      if (success) {
        setAmount("");
        setRecipient(null);
      }
      setErrorKey(null);
      setSuccess(false);
    }
  }

  function confirmTransfer() {
    if (!recipient) return;
    setErrorKey(null);
    startTransition(async () => {
      const result = await transferToUserAction(recipient.id, amount, locale);
      if (result.ok) {
        setSuccess(true);
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  return (
    <>
      <Card className="flex flex-col justify-between border-border/60 shadow-sm transition-shadow hover:shadow-md hover:shadow-black/20">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-row items-center gap-2 text-base font-medium">
            <Send className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{t("formTitle")}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 space-y-4">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{t("yourBalanceLabel")}</span>
            <span dir="ltr" className="font-heading font-medium tabular-nums">
              {walletBBalance}
            </span>
          </div>

          <RecipientPicker value={recipient} onChange={setRecipient} />

          <div className="space-y-1.5">
            <Label htmlFor="transfer-amount">{t("amountLabel")}</Label>
            <Input
              id="transfer-amount"
              type="number"
              inputMode="decimal"
              min={minimumTransfer}
              step="0.01"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setFieldError(null);
              }}
              aria-invalid={fieldError !== null}
            />
            <p className="text-xs text-muted-foreground">{t("minimumHint", { minimum: minimumTransfer })}</p>
            {fieldError && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {fieldError}
              </p>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Button className="w-full cursor-pointer" onClick={openConfirm}>
            {t("submit")}
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader>
            {success ? (
              <DialogTitle className="flex flex-row items-center gap-2">
                <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" />
                <span>{t("successTitle")}</span>
              </DialogTitle>
            ) : (
              <DialogTitle>{t("confirmTitle")}</DialogTitle>
            )}
            {!success && recipient && (
              <DialogDescription>
                {t("confirmDescription", { recipientName: recipient.name, amount })}
              </DialogDescription>
            )}
            {success && recipient && (
              <DialogDescription>{t("successDescription", { recipientName: recipient.name })}</DialogDescription>
            )}
          </DialogHeader>

          {!success && recipient && (
            <div className="space-y-2 rounded-lg bg-muted/40 px-4 py-3 text-sm">
              <div className="flex flex-row items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("summaryRecipient")}</span>
                <span className="font-medium">
                  {recipient.name} <span className="text-muted-foreground">({recipient.email})</span>
                </span>
              </div>
              <div className="flex flex-row items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("summaryAmount")}</span>
                <span dir="ltr" className="font-heading font-semibold tabular-nums">
                  {amount}
                </span>
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
              <Button variant="outline" className="cursor-pointer" disabled={isPending} onClick={() => closeDialog(false)}>
                {t("cancel")}
              </Button>
              <Button className="cursor-pointer" disabled={isPending} onClick={confirmTransfer}>
                {isPending ? t("transferring") : t("confirmSubmit")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
