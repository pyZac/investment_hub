"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { PackageOpen, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { purchasePackageAction } from "./actions";

type PackageDisplay = {
  id: string;
  name: string;
  amount: string;
};

export function PackageGrid({
  packages,
  walletBBalance,
}: {
  packages: PackageDisplay[];
  walletBBalance: string;
}) {
  const t = useTranslations("Packages");
  const locale = useLocale();
  const [selected, setSelected] = useState<PackageDisplay | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function openConfirm(pkg: PackageDisplay) {
    setSelected(pkg);
    setIdempotencyKey(crypto.randomUUID());
    setErrorKey(null);
    setSuccess(false);
  }

  function closeDialog(open: boolean) {
    if (!open && !isPending) {
      setSelected(null);
      setIdempotencyKey(null);
      setErrorKey(null);
      setSuccess(false);
    }
  }

  function confirmPurchase() {
    if (!selected || !idempotencyKey) return;
    setErrorKey(null);

    startTransition(async () => {
      const result = await purchasePackageAction(selected.id, idempotencyKey, locale);
      if (result.ok) {
        setSuccess(true);
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  if (packages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
        <PackageOpen className="size-10 text-muted-foreground/60" aria-hidden="true" />
        <p className="max-w-sm text-sm text-muted-foreground">{t("emptyState")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {packages.map((pkg) => (
          <Card
            key={pkg.id}
            className="flex flex-col justify-between border-border/60 shadow-sm transition-shadow hover:shadow-md"
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">{pkg.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex-1">
              <p className="text-2xl font-bold tabular-nums" dir="ltr">
                {pkg.amount}
              </p>
            </CardContent>
            <CardFooter>
              <Button className="w-full cursor-pointer" onClick={() => openConfirm(pkg)}>
                {t("purchase")}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <Dialog open={selected !== null} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader>
            {success ? (
              <DialogTitle className="flex flex-row items-center gap-2">
                <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-500" aria-hidden="true" />
                <span>{t("successTitle")}</span>
              </DialogTitle>
            ) : (
              <DialogTitle>{t("confirmTitle")}</DialogTitle>
            )}
            {!success && selected && (
              <DialogDescription>
                {t("confirmDescription", { amount: selected.amount })}
              </DialogDescription>
            )}
            {success && <DialogDescription>{t("successDescription")}</DialogDescription>}
          </DialogHeader>

          {!success && selected && (
            <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("confirmPackageLabel")}</span>
                <span className="font-medium">{selected.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("confirmAmountLabel")}</span>
                <span className="font-medium tabular-nums" dir="ltr">
                  {selected.amount}
                </span>
              </div>
              <div className="flex justify-between border-t border-border/60 pt-2">
                <span className="text-muted-foreground">{t("confirmYourBalance")}</span>
                <span className="font-medium tabular-nums" dir="ltr">
                  {walletBBalance}
                </span>
              </div>
            </div>
          )}

          {errorKey && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {t(errorKey as "errorInsufficientFunds" | "errorPackageUnavailable" | "errorGeneric")}
            </p>
          )}

          {!success && (
            <DialogFooter>
              <Button
                variant="outline"
                className="cursor-pointer"
                disabled={isPending}
                onClick={() => closeDialog(false)}
              >
                {t("confirmCancel")}
              </Button>
              <Button className="cursor-pointer" disabled={isPending} onClick={confirmPurchase}>
                {isPending ? t("purchasing") : t("confirmSubmit")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
