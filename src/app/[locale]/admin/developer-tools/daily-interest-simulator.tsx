"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { AlertTriangle, X } from "lucide-react";
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
  searchUsersForSimulationAction,
  listActiveInvestmentsForSimulationAction,
  lookupInvestmentForSimulationAction,
  simulateDailyInterestAction,
  type SimulationUserOption,
  type SimulationInvestmentListRow,
  type SimulationInvestmentRow,
  type SimulateDailyInterestRow,
  type DeveloperToolsErrorKey,
} from "./actions";

const DEFAULT_DAYS = 7;
const MIN_DAYS = 1;
const MAX_DAYS = 30;

/**
 * "Simulate N days of Daily Interest" — deliberately scoped to ONE
 * admin-chosen investment, picked via a name/email search rather than a
 * raw investment id (an id is never shown or typed anywhere in this
 * flow), and confirmed by owner/package before the days input or the
 * simulate button ever become interactive. Never offers a "simulate for
 * everyone" mode — see simulateDailyInterestDays' own doc comment in
 * developer-tools.ts for why a platform-wide sweep with fabricated dates
 * is a real financial-ledger hazard, not just a UX choice.
 */
export function DailyInterestSimulator({ locale }: { locale: string }) {
  const t = useTranslations("AdminDeveloperTools");
  const format = useFormatter();

  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<SimulationUserOption[]>([]);
  const [userResultsOpen, setUserResultsOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SimulationUserOption | null>(null);
  const userSearchRef = useRef<HTMLDivElement>(null);

  const [investmentOptions, setInvestmentOptions] = useState<SimulationInvestmentListRow[] | null>(null);
  const [investment, setInvestment] = useState<SimulationInvestmentRow | null>(null);

  const [days, setDays] = useState(String(DEFAULT_DAYS));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState<SimulateDailyInterestRow | null>(null);
  const [errorKey, setErrorKey] = useState<DeveloperToolsErrorKey | null>(null);

  const [isSearchingUsers, startUserSearchTransition] = useTransition();
  const [isLoadingInvestments, startInvestmentsTransition] = useTransition();
  const [isPickingInvestment, startPickInvestmentTransition] = useTransition();
  const [isSimulating, startSimulateTransition] = useTransition();

  const parsedDays = Number(days);
  const daysValid = Number.isInteger(parsedDays) && parsedDays >= MIN_DAYS && parsedDays <= MAX_DAYS;

  // Debounced user search, same 300ms pattern as the credits page's own
  // user-picker.
  useEffect(() => {
    if (userQuery.trim().length === 0) {
      setUserResults([]);
      return;
    }
    const handle = setTimeout(() => {
      startUserSearchTransition(async () => {
        const result = await searchUsersForSimulationAction(userQuery);
        if (result.ok) {
          setUserResults(result.users);
        }
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [userQuery]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userSearchRef.current && !userSearchRef.current.contains(e.target as Node)) {
        setUserResultsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelectUser(user: SimulationUserOption) {
    setErrorKey(null);
    setSelectedUser(user);
    setUserQuery("");
    setUserResultsOpen(false);
    setInvestmentOptions(null);
    setInvestment(null);
    setSummary(null);

    startInvestmentsTransition(async () => {
      const result = await listActiveInvestmentsForSimulationAction(user.id);
      if (result.ok) {
        setInvestmentOptions(result.investments);
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  function handleChangeUser() {
    setSelectedUser(null);
    setInvestmentOptions(null);
    setInvestment(null);
    setSummary(null);
    setErrorKey(null);
  }

  function handleSelectInvestment(row: SimulationInvestmentListRow) {
    setErrorKey(null);
    setSummary(null);
    startPickInvestmentTransition(async () => {
      const result = await lookupInvestmentForSimulationAction(row.id);
      if (result.ok) {
        setInvestment(result.investment);
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  function handleChangeInvestment() {
    setInvestment(null);
    setSummary(null);
    setErrorKey(null);
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

      {!selectedUser && (
        <div ref={userSearchRef} className="relative space-y-1.5">
          <Label htmlFor="simulate-user-search">{t("simulateUserSearchLabel")}</Label>
          <Input
            id="simulate-user-search"
            value={userQuery}
            onChange={(e) => {
              setUserQuery(e.target.value);
              setUserResultsOpen(true);
            }}
            onFocus={() => setUserResultsOpen(true)}
            placeholder={t("simulateUserSearchPlaceholder")}
            autoComplete="off"
          />
          {userResultsOpen && userQuery.trim().length > 0 && (
            <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-border/60 bg-popover shadow-md shadow-black/20">
              {isSearchingUsers ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">{t("simulateSearchingUsers")}</p>
              ) : userResults.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">{t("simulateNoUsersFound")}</p>
              ) : (
                userResults.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => handleSelectUser(u)}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-start text-sm hover:bg-muted cursor-pointer"
                  >
                    <span className="font-medium">{u.name}</span>
                    <span className="text-xs text-muted-foreground">{u.email}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {selectedUser && (
        <div className="space-y-1.5">
          <Label>{t("simulateUserSearchLabel")}</Label>
          <div className="flex flex-row items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-sm">
            <span>
              {selectedUser.name} <span className="text-muted-foreground">({selectedUser.email})</span>
            </span>
            <button
              type="button"
              onClick={handleChangeUser}
              className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("simulateChangeUser")}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {selectedUser && !investment && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t("simulateSelectInvestmentLabel")}</p>
          {isLoadingInvestments || investmentOptions === null ? (
            <p className="text-sm text-muted-foreground">{t("simulateInvestmentsLoading")}</p>
          ) : investmentOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("simulateNoActiveInvestments")}</p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60">
              {investmentOptions.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  disabled={isPickingInvestment}
                  onClick={() => handleSelectInvestment(row)}
                  className="flex w-full flex-row items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5 text-start text-sm last:border-0 hover:bg-muted cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{row.packageName}</span>
                    <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                      {format.dateTime(new Date(row.purchasedAt), { dateStyle: "medium" })}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-heading font-semibold tabular-nums" dir="ltr">
                      ${row.amount}
                    </span>
                    <Badge variant="success">{t("simulateStatusActive")}</Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {investment && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t("simulateSelectInvestmentLabel")}</p>
          <div className="flex flex-row flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
            <div>
              <p className="font-medium">
                {investment.ownerName} <span className="text-muted-foreground">({investment.ownerEmail})</span>
              </p>
              <p className="text-xs text-muted-foreground" dir="ltr">
                {investment.packageName} — ${investment.amount}
              </p>
            </div>
            <div className="flex flex-row items-center gap-2">
              <Badge variant={investment.status === "ACTIVE" ? "success" : "secondary"}>
                {investment.status === "ACTIVE" ? t("simulateStatusActive") : t("simulateStatusCapitalReleased")}
              </Badge>
              <button
                type="button"
                onClick={handleChangeInvestment}
                className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("simulateChangeInvestment")}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
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
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
          <div>
            <p className="text-xs text-muted-foreground">{t("summarySimulatedRange")}</p>
            <p className="font-heading text-lg font-semibold tabular-nums" dir="ltr">
              {summary.simulatedFrom} – {summary.simulatedTo}
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
