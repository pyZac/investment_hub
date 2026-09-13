"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
import { editPackageAction, type PackageActionErrorKey } from "./actions";

type PackageRow = { id: string; name: string; amount: string; investmentCount: number };

export function EditPackageDialog({
  pkg,
  locale,
  onClose,
  onSaved,
}: {
  pkg: PackageRow;
  locale: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("AdminPackages");
  const [name, setName] = useState(pkg.name);
  const [amount, setAmount] = useState(pkg.amount);
  const [errorKey, setErrorKey] = useState<PackageActionErrorKey | null>(null);
  const [isPending, startTransition] = useTransition();

  const locked = pkg.investmentCount > 0;

  function submit() {
    setErrorKey(null);
    startTransition(async () => {
      const result = await editPackageAction(pkg.id, name, amount, locale);
      if (result.ok) {
        onSaved();
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editTitle")}</DialogTitle>
          <DialogDescription>{t("editDescription")}</DialogDescription>
        </DialogHeader>

        {locked && (
          <p role="alert" className="text-sm font-medium text-warning">
            {t("editLockedNotice", { count: pkg.investmentCount })}
          </p>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-package-name">{t("nameLabel")}</Label>
            <Input
              id="edit-package-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={locked}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-package-amount">{t("amountLabel")}</Label>
            <Input
              id="edit-package-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={locked}
            />
          </div>
        </div>

        {errorKey && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {t(errorKey)}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button className="cursor-pointer" disabled={locked || isPending} onClick={submit}>
            {isPending ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
