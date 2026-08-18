"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Clock, Lock, CheckCircle2, PiggyBank } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { releaseCapitalAction, type WithdrawalActionErrorKey } from "./actions";

type CapitalReleaseInvestment = {
  id: string;
  amount: string;
  capitalUnlocksAt: string;
};

export function CapitalReleasePanel({
  investments,
  now,
  isFriday,
  daysUntilFriday,
  locale,
}: {
  investments: CapitalReleaseInvestment[];
  now: string;
  isFriday: boolean;
  daysUntilFriday: number;
  locale: string;
}) {
  const t = useTranslations("Withdrawals");
  const [confirming, setConfirming] = useState<CapitalReleaseInvestment | null>(null);
  const [errorKey, setErrorKey] = useState<WithdrawalActionErrorKey | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const nowMs = new Date(now).getTime();

  function closeDialog(open: boolean) {
    if (!open && !isPending) {
      setConfirming(null);
      setErrorKey(null);
      setSuccess(false);
    }
  }

  function confirmRelease() {
    if (!confirming) return;
    setErrorKey(null);
    startTransition(async () => {
      const result = await releaseCapitalAction(confirming.id, locale);
      if (result.ok) {
        setSuccess(true);
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  if (investments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
        <PiggyBank className="size-10 text-muted-foreground/60" aria-hidden="true" />
        <p className="max-w-sm text-sm text-muted-foreground">{t("capitalReleaseEmptyState")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {investments.map((investment) => {
          const unlocked = new Date(investment.capitalUnlocksAt).getTime() <= nowMs;
          const disabled = !unlocked || !isFriday;

          return (
            <Card
              key={investment.id}
              className="flex flex-col justify-between border-border/60 shadow-sm transition-shadow hover:shadow-md"
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">{t("capitalReleaseCardTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 space-y-3">
                <p className="text-2xl font-bold tabular-nums">{investment.amount}</p>
                {!unlocked ? (
                  <div className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
                    <Lock className="size-4 shrink-0" aria-hidden="true" />
                    <span>{t("capitalStillLocked")}</span>
                  </div>
                ) : !isFriday ? (
                  <div className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="size-4 shrink-0" aria-hidden="true" />
                    <span>{t("fridayOnlyCountdown", { days: daysUntilFriday })}</span>
                  </div>
                ) : (
                  <div className="flex flex-row items-center gap-2 text-sm text-emerald-600 dark:text-emerald-500">
                    <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                    <span>{t("capitalUnlockedReady")}</span>
                  </div>
                )}
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full cursor-pointer"
                  disabled={disabled}
                  onClick={() => {
                    setErrorKey(null);
                    setSuccess(false);
                    setConfirming(investment);
                  }}
                >
                  {t("capitalReleaseSubmit")}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <Dialog open={confirming !== null} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader>
            {success ? (
              <DialogTitle className="flex flex-row items-center gap-2">
                <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-500" aria-hidden="true" />
                <span>{t("capitalReleaseSuccessTitle")}</span>
              </DialogTitle>
            ) : (
              <DialogTitle>{t("capitalReleaseConfirmTitle")}</DialogTitle>
            )}
            {!success && confirming && (
              <DialogDescription>{t("capitalReleaseConfirmDescription", { amount: confirming.amount })}</DialogDescription>
            )}
            {success && <DialogDescription>{t("capitalReleaseSuccessDescription")}</DialogDescription>}
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
              <Button className="cursor-pointer" disabled={isPending} onClick={confirmRelease}>
                {isPending ? t("releasingCapital") : t("capitalReleaseConfirmSubmit")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
