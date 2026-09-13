"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setInterestRateAction, type RateActionErrorKey } from "./actions";

function tomorrowDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function SetRateForm({ locale }: { locale: string }) {
  const t = useTranslations("AdminRateConfig");
  const [monthlyRate, setMonthlyRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<RateActionErrorKey | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const minDate = tomorrowDateString();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);
    setSuccess(false);

    if (effectiveFrom && effectiveFrom < minDate) {
      setFieldError(t("errorBackdated"));
      return;
    }
    setFieldError(null);

    startTransition(async () => {
      const result = await setInterestRateAction(monthlyRate, effectiveFrom, reason, locale);
      if (result.ok) {
        setSuccess(true);
        setMonthlyRate("");
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
          <Label htmlFor="rate-monthly">{t("monthlyRateLabel")}</Label>
          <Input
            id="rate-monthly"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={monthlyRate}
            onChange={(e) => setMonthlyRate(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rate-effective-from">{t("effectiveFromLabel")}</Label>
          <Input
            id="rate-effective-from"
            type="date"
            min={minDate}
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rate-reason">{t("reasonLabel")}</Label>
          <Input
            id="rate-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            required
          />
        </div>
      </div>

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
