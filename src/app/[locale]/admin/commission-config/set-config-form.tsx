"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setCommissionConfigAction, type CommissionActionErrorKey } from "./actions";

function tomorrowDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function SetConfigForm({ locale }: { locale: string }) {
  const t = useTranslations("AdminCommissionConfig");
  const [directRate, setDirectRate] = useState("");
  const [directCommissionSplit, setDirectCommissionSplit] = useState("");
  const [directSavingSplit, setDirectSavingSplit] = useState("");
  const [binaryRate, setBinaryRate] = useState("");
  const [carryForwardMonths, setCarryForwardMonths] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<CommissionActionErrorKey | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const minDate = tomorrowDateString();
  const splitSum = Number(directCommissionSplit) + Number(directSavingSplit);
  const splitSumInvalid =
    directCommissionSplit !== "" && directSavingSplit !== "" && Math.round(splitSum * 100) !== 10000;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);
    setSuccess(false);

    if (effectiveFrom && effectiveFrom < minDate) {
      setFieldError(t("errorBackdated"));
      return;
    }
    if (splitSumInvalid) {
      setFieldError(t("errorSplitMismatch"));
      return;
    }
    setFieldError(null);

    startTransition(async () => {
      const result = await setCommissionConfigAction(
        directRate,
        directCommissionSplit,
        directSavingSplit,
        binaryRate,
        carryForwardMonths,
        effectiveFrom,
        reason,
        locale,
      );
      if (result.ok) {
        setSuccess(true);
        setDirectRate("");
        setDirectCommissionSplit("");
        setDirectSavingSplit("");
        setBinaryRate("");
        setCarryForwardMonths("");
        setEffectiveFrom("");
        setReason("");
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="commission-direct-rate">{t("directRateInputLabel")}</Label>
          <Input
            id="commission-direct-rate"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={directRate}
            onChange={(e) => setDirectRate(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="commission-direct-split">{t("directCommissionSplitLabel")}</Label>
          <Input
            id="commission-direct-split"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.01"
            value={directCommissionSplit}
            onChange={(e) => setDirectCommissionSplit(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="commission-saving-split">{t("directSavingSplitLabel")}</Label>
          <Input
            id="commission-saving-split"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.01"
            value={directSavingSplit}
            onChange={(e) => setDirectSavingSplit(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="commission-binary-rate">{t("binaryRateInputLabel")}</Label>
          <Input
            id="commission-binary-rate"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={binaryRate}
            onChange={(e) => setBinaryRate(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="commission-carry-forward-months">{t("carryForwardExpiryInputLabel")}</Label>
          <Input
            id="commission-carry-forward-months"
            type="number"
            inputMode="numeric"
            min={1}
            step="1"
            value={carryForwardMonths}
            onChange={(e) => setCarryForwardMonths(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="commission-effective-from">{t("effectiveFromLabel")}</Label>
          <Input
            id="commission-effective-from"
            type="date"
            min={minDate}
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="commission-reason">{t("reasonLabel")}</Label>
          <Input
            id="commission-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            required
          />
        </div>
      </div>

      {splitSumInvalid && !fieldError && (
        <p className="text-sm text-muted-foreground">{t("splitSumHint", { sum: splitSum })}</p>
      )}

      {fieldError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {fieldError}
        </p>
      )}
      {errorKey && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t(errorKey)}
        </p>
      )}
      {success && (
        <p className="flex flex-row items-center gap-2 text-sm font-medium text-success">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          <span>{t("setSuccess")}</span>
        </p>
      )}

      <Button type="submit" disabled={isPending} className="cursor-pointer">
        {isPending ? t("setting") : t("setSubmit")}
      </Button>
    </form>
  );
}
