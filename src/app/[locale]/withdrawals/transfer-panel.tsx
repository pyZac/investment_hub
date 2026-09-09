"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Clock, CheckCircle2, ArrowRightLeft } from "lucide-react";
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
import { transferAtoBAction, transferCtoBAction, type WithdrawalActionErrorKey } from "./actions";

type TransferDirection = "A" | "C";

function TransferCard({
  direction,
  withdrawable,
  isFriday,
  daysUntilFriday,
  locale,
}: {
  direction: TransferDirection;
  withdrawable: string;
  isFriday: boolean;
  daysUntilFriday: number;
  locale: string;
}) {
  const t = useTranslations("Withdrawals");
  const [amount, setAmount] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorKey, setErrorKey] = useState<WithdrawalActionErrorKey | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const withdrawableNumber = Number(withdrawable);

  function validate(): boolean {
    const parsed = Number(amount);
    if (!amount || Number.isNaN(parsed) || parsed <= 0) {
      setFieldError(t("errorAmountInvalid"));
      return false;
    }
    if (parsed > withdrawableNumber) {
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
      }
      setErrorKey(null);
      setSuccess(false);
    }
  }

  function confirmTransfer() {
    setErrorKey(null);
    startTransition(async () => {
      const action = direction === "A" ? transferAtoBAction : transferCtoBAction;
      const result = await action(amount, locale);
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
      <Card className="flex flex-col justify-between border-border/60 shadow-sm transition-shadow hover:shadow-md hover:shadow-black/20">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-row items-center gap-2 text-base font-medium">
            <ArrowRightLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{direction === "A" ? t("transferATitle") : t("transferCTitle")}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 space-y-4">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{t("availableLabel")}</span>
            <span className="font-heading font-medium tabular-nums">{withdrawable}</span>
          </div>

          {disabled ? (
            <div className="flex flex-row items-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
              <Clock className="size-4 shrink-0" aria-hidden="true" />
              <span>{t("fridayOnlyCountdown", { days: daysUntilFriday })}</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor={`amount-${direction}`}>{t("amountLabel")}</Label>
              <Input
                id={`amount-${direction}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setFieldError(null);
                }}
                aria-invalid={fieldError !== null}
              />
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
            {t("transferSubmit")}
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader>
            {success ? (
              <DialogTitle className="flex flex-row items-center gap-2">
                <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" />
                <span>{t("transferSuccessTitle")}</span>
              </DialogTitle>
            ) : (
              <DialogTitle>{t("transferConfirmTitle")}</DialogTitle>
            )}
            {!success && (
              <DialogDescription>
                {direction === "A"
                  ? t("transferConfirmDescriptionA", { amount })
                  : t("transferConfirmDescriptionC", { amount })}
              </DialogDescription>
            )}
            {success && <DialogDescription>{t("transferSuccessDescription")}</DialogDescription>}
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
              <Button className="cursor-pointer" disabled={isPending} onClick={confirmTransfer}>
                {isPending ? t("transferring") : t("transferConfirmSubmit")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TransferPanel({
  isFriday,
  daysUntilFriday,
  withdrawableA,
  withdrawableC,
  locale,
}: {
  isFriday: boolean;
  daysUntilFriday: number;
  withdrawableA: string;
  withdrawableC: string;
  locale: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      <TransferCard direction="A" withdrawable={withdrawableA} isFriday={isFriday} daysUntilFriday={daysUntilFriday} locale={locale} />
      <TransferCard direction="C" withdrawable={withdrawableC} isFriday={isFriday} daysUntilFriday={daysUntilFriday} locale={locale} />
    </div>
  );
}
