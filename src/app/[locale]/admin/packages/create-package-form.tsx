"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPackageAction, type PackageActionErrorKey } from "./actions";

export function CreatePackageForm({ locale }: { locale: string }) {
  const t = useTranslations("AdminPackages");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [errorKey, setErrorKey] = useState<PackageActionErrorKey | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await createPackageAction(name, amount, locale);
      if (result.ok) {
        setSuccess(true);
        setName("");
        setAmount("");
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="package-name">{t("nameLabel")}</Label>
          <Input id="package-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="package-amount">{t("amountLabel")}</Label>
          <Input
            id="package-amount"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
      </div>

      {errorKey && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t(errorKey)}
        </p>
      )}
      {success && (
        <p className="flex flex-row items-center gap-2 text-sm font-medium text-success">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          <span>{t("createSuccess")}</span>
        </p>
      )}

      <Button type="submit" disabled={isPending} className="cursor-pointer">
        {isPending ? t("creating") : t("createSubmit")}
      </Button>
    </form>
  );
}
