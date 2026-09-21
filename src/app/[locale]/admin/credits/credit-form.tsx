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
import { creditWalletBAction, type CreditActionErrorKey } from "./actions";
import { UserPicker } from "./user-picker";
import { toDisplayWithCurrency } from "@/lib/display";

type UserOption = { id: string; name: string; email: string };

export function CreditForm({ locale }: { locale: string }) {
  const t = useTranslations("AdminCredits");
  const [user, setUser] = useState<UserOption | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorKey, setErrorKey] = useState<CreditActionErrorKey | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function validate(): boolean {
    if (!user) {
      setFieldError(t("errorUserRequired"));
      return false;
    }
    const parsed = Number(amount);
    if (!amount || Number.isNaN(parsed) || parsed <= 0) {
      setFieldError(t("errorAmountInvalid"));
      return false;
    }
    if (!reason.trim()) {
      setFieldError(t("errorReasonRequired"));
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
        setUser(null);
        setAmount("");
        setReason("");
      }
      setErrorKey(null);
      setSuccess(false);
    }
  }

  function confirmSubmit() {
    if (!user) return;
    setErrorKey(null);
    startTransition(async () => {
      const result = await creditWalletBAction(user.id, amount, reason, locale);
      if (result.ok) {
        setSuccess(true);
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  return (
    <>
      <div className="space-y-6">
        <UserPicker value={user} onChange={setUser} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="credit-amount">{t("amountLabel")}</Label>
            <Input
              id="credit-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setFieldError(null);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="credit-reason">{t("reasonLabel")}</Label>
            <Input
              id="credit-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setFieldError(null);
              }}
              placeholder={t("reasonPlaceholder")}
            />
          </div>
        </div>

        {fieldError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {fieldError}
          </p>
        )}

        <Button className="cursor-pointer" onClick={openConfirm}>
          {t("creditSubmit")}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader>
            {success ? (
              <DialogTitle className="flex flex-row items-center gap-2">
                <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" />
                <span>{t("creditSuccessTitle")}</span>
              </DialogTitle>
            ) : (
              <DialogTitle>{t("confirmCreditTitle")}</DialogTitle>
            )}
            {!success && <DialogDescription>{t("confirmCreditDescription")}</DialogDescription>}
            {success && <DialogDescription>{t("creditSuccessDescription")}</DialogDescription>}
          </DialogHeader>

          {!success && user && (
            <div className="space-y-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
              <div className="flex flex-row items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("userLabel")}</span>
                <span className="font-medium">
                  {user.name} ({user.email})
                </span>
              </div>
              <div className="flex flex-row items-center justify-between gap-2">
                <span className="text-muted-foreground" dir="ltr">
                  Wallet B
                </span>
                <span className="font-heading font-semibold tabular-nums" dir="ltr">
                  {toDisplayWithCurrency(amount)}
                </span>
              </div>
              <div className="flex flex-row items-start justify-between gap-2">
                <span className="text-muted-foreground">{t("reasonLabel")}</span>
                <span className="max-w-[70%] text-end">{reason}</span>
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
              <Button className="cursor-pointer" disabled={isPending} onClick={confirmSubmit}>
                {isPending ? t("submitting") : t("confirm")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
