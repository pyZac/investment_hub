"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Clock, CheckCircle2 } from "lucide-react";
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
import { submitWithdrawalRequestAction, type WithdrawalActionErrorKey } from "./actions";
import { toDisplayAmountPreview } from "@/lib/display";

const MIN_WITHDRAWAL = 50;

export function BExitForm({
  isFriday,
  daysUntilFriday,
  walletBBalance,
  locale,
}: {
  isFriday: boolean;
  daysUntilFriday: number;
  walletBBalance: string;
  locale: string;
}) {
  const t = useTranslations("Withdrawals");
  const [amount, setAmount] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorKey, setErrorKey] = useState<WithdrawalActionErrorKey | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function validate(): boolean {
    const parsed = Number(amount);
    if (!amount || Number.isNaN(parsed) || parsed <= 0) {
      setFieldError(t("errorAmountInvalid"));
      return false;
    }
    if (parsed < MIN_WITHDRAWAL) {
      setFieldError(t("errorBelowMinimum"));
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
      }
      setErrorKey(null);
      setSuccess(false);
    }
  }

  function confirmSubmit() {
    setErrorKey(null);
    startTransition(async () => {
      const result = await submitWithdrawalRequestAction(amount, locale);
      if (result.ok) {
        setSuccess(true);
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  const disabled = !isFriday;

  return (
    <>
      <Card className="border-border/60 shadow-sm transition-shadow hover:shadow-md hover:shadow-black/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">{t("bExitFormTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{t("walletBBalanceLabel")}</span>
            <span className="font-heading font-medium tabular-nums" dir="ltr">
              {walletBBalance}
            </span>
          </div>

          {disabled ? (
            <div className="flex flex-row items-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
              <Clock className="size-4 shrink-0" aria-hidden="true" />
              <span>{t("fridayOnlyCountdown", { days: daysUntilFriday })}</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="b-exit-amount">{t("amountLabel")}</Label>
              <Input
                id="b-exit-amount"
                type="number"
                inputMode="decimal"
                min={MIN_WITHDRAWAL}
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setFieldError(null);
                }}
                aria-invalid={fieldError !== null}
              />
              <p className="text-xs text-muted-foreground">{t("bExitMinimumHint", { minimum: MIN_WITHDRAWAL })}</p>
              {fieldError && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {fieldError}
                </p>
              )}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button className="w-full cursor-pointer" disabled={disabled} onClick={openConfirm}>
            {t("bExitSubmit")}
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader>
            {success ? (
              <DialogTitle className="flex flex-row items-center gap-2">
                <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" />
                <span>{t("bExitSuccessTitle")}</span>
              </DialogTitle>
            ) : (
              <DialogTitle>{t("bExitConfirmTitle")}</DialogTitle>
            )}
            {!success && (
              <DialogDescription>{t("bExitConfirmDescription", { amount: toDisplayAmountPreview(amount) })}</DialogDescription>
            )}
            {success && <DialogDescription>{t("bExitSuccessDescription")}</DialogDescription>}
          </DialogHeader>

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
                {isPending ? t("submitting") : t("bExitConfirmSubmit")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
