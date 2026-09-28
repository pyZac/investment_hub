"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import {
  lookupInvestmentForSimulationAction,
  simulateDailyInterestAction,
  type SimulationInvestmentRow,
  type SimulateDailyInterestRow,
  type DeveloperToolsErrorKey,
} from "./actions";

const DEFAULT_DAYS = 7;
const MIN_DAYS = 1;
const MAX_DAYS = 30;

/**
 * "Simulate N days of Daily Interest" — deliberately scoped to ONE
 * admin-chosen investment, looked up and confirmed by name/owner before
 * the days input or the simulate button ever become interactive. Never
 * offers a "simulate for everyone" mode — see simulateDailyInterestDays'
 * own doc comment in developer-tools.ts for why a platform-wide sweep
 * with fabricated dates is a real financial-ledger hazard, not just a
 * UX choice.
 */
export function DailyInterestSimulator({ locale }: { locale: string }) {
  const t = useTranslations("AdminDeveloperTools");
  const [investmentIdInput, setInvestmentIdInput] = useState("");
  const [investment, setInvestment] = useState<SimulationInvestmentRow | null>(null);
  const [days, setDays] = useState(String(DEFAULT_DAYS));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState<SimulateDailyInterestRow | null>(null);
  const [errorKey, setErrorKey] = useState<DeveloperToolsErrorKey | null>(null);
  const [isLookingUp, startLookupTransition] = useTransition();
  const [isSimulating, startSimulateTransition] = useTransition();

  const parsedDays = Number(days);
  const daysValid = Number.isInteger(parsedDays) && parsedDays >= MIN_DAYS && parsedDays <= MAX_DAYS;

  function handleLookup() {
    setErrorKey(null);
    setSummary(null);
    setInvestment(null);
    startLookupTransition(async () => {
      const result = await lookupInvestmentForSimulationAction(investmentIdInput.trim());
      if (result.ok) {
        setInvestment(result.investment);
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  function handleSimulate() {
    if (!investment || !daysValid) return;
    setErrorKey(null);
    startSimulateTransition(async () => {
      const result = await simulateDailyInterestAction(investment.id, parsedDays, locale);
      setConfirmOpen(false);
      if (result.ok) {
        setSummary(result.summary);
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border/60 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("simulateHeading")}</p>
        <p className="text-sm text-muted-foreground">{t("simulateDescription")}</p>
      </div>

      <div className="flex flex-row flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="simulate-investment-id">{t("simulateInvestmentIdLabel")}</Label>
          <Input
            id="simulate-investment-id"
            value={investmentIdInput}
            onChange={(e) => {
              setInvestmentIdInput(e.target.value);
              setInvestment(null);
              setSummary(null);
            }}
            placeholder={t("simulateInvestmentIdPlaceholder")}
          />
        </div>
        <Button
          variant="outline"
          className="cursor-pointer"
          disabled={investmentIdInput.trim().length === 0 || isLookingUp}
          onClick={handleLookup}
        >
          <Search className="size-4" aria-hidden="true" />
          {isLookingUp ? t("simulateLookingUp") : t("simulateLookUp")}
        </Button>
      </div>

      {investment && (
        <div className="flex flex-row flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
          <div>
            <p className="font-medium">
              {investment.ownerName} <span className="text-muted-foreground">({investment.ownerEmail})</span>
            </p>
            <p className="text-xs text-muted-foreground" dir="ltr">
              {investment.packageName} — ${investment.amount}
            </p>
          </div>
          <Badge variant={investment.status === "ACTIVE" ? "success" : "secondary"}>
            {investment.status === "ACTIVE" ? t("simulateStatusActive") : t("simulateStatusCapitalReleased")}
          </Badge>
        </div>
      )}

      {investment && (
        <div className="flex flex-row flex-wrap items-end gap-2">
          <div className="w-28 space-y-1.5">
            <Label htmlFor="simulate-days">{t("simulateDaysLabel")}</Label>
            <Input
              id="simulate-days"
              type="number"
              inputMode="numeric"
              min={MIN_DAYS}
              max={MAX_DAYS}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              aria-invalid={!daysValid}
            />
          </div>
          <Button
            variant="destructive"
            className="cursor-pointer"
            disabled={!daysValid || isSimulating}
            onClick={() => setConfirmOpen(true)}
          >
            {t("simulateButton", { days: daysValid ? parsedDays : 0 })}
          </Button>
        </div>
      )}

      {!daysValid && investment && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t("simulateDaysInvalid", { min: MIN_DAYS, max: MAX_DAYS })}
        </p>
      )}

      {errorKey && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t(errorKey)}
        </p>
      )}

      {summary && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">{t("summaryDaysProcessed")}</p>
            <p className="font-heading text-lg font-semibold tabular-nums" dir="ltr">
              {summary.daysProcessed}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("summaryEntriesPosted")}</p>
            <p className="font-heading text-lg font-semibold tabular-nums" dir="ltr">
              {summary.entriesPosted}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("summaryTotalCredited")}</p>
            <p className="font-heading text-lg font-semibold tabular-nums" dir="ltr">
              ${summary.totalCredited}
            </p>
          </div>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={(open) => !isSimulating && setConfirmOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmSimulateTitle")}</DialogTitle>
            <DialogDescription>{t("confirmSimulateDescription", { days: parsedDays })}</DialogDescription>
          </DialogHeader>

          {investment && (
            <div className="flex flex-row items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                {t("confirmSimulateTarget", { name: investment.ownerName, package: investment.packageName })}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              className="cursor-pointer"
              disabled={isSimulating}
              onClick={() => setConfirmOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button variant="destructive" className="cursor-pointer" disabled={isSimulating} onClick={handleSimulate}>
              {isSimulating ? t("simulateSubmitting") : t("simulateButton", { days: parsedDays })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
