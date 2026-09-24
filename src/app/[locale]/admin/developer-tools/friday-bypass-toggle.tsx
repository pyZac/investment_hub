"use client";

import { useState, useTransition } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { getFridayBypassStatusAction, setFridayBypassAction, type DeveloperToolsErrorKey } from "./actions";

export type FridayBypassStatusRow = {
  enabled: boolean;
  updatedAt: string;
  updatedByAdminName: string | null;
};

export function FridayBypassToggle({
  initialStatus,
  locale,
}: {
  initialStatus: FridayBypassStatusRow;
  locale: string;
}) {
  const t = useTranslations("AdminDeveloperTools");
  const format = useFormatter();
  const [status, setStatus] = useState(initialStatus);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<DeveloperToolsErrorKey | null>(null);

  function refresh() {
    startTransition(async () => {
      const result = await getFridayBypassStatusAction();
      if (result.ok) {
        setStatus(result.status);
      }
    });
  }

  function handleConfirm() {
    setErrorKey(null);
    startTransition(async () => {
      const result = await setFridayBypassAction(!status.enabled, locale);
      setConfirmOpen(false);
      if (result.ok) {
        refresh();
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-row flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
        <div className="flex flex-row items-start gap-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-warning">{t("bypassWarningLabel")}</p>
            <p className="text-sm text-muted-foreground">{t("bypassWarningBody")}</p>
          </div>
        </div>
        <div className="flex flex-row items-center gap-3">
          <Badge variant={status.enabled ? "warning" : "secondary"}>
            {status.enabled ? t("bypassStatusOn") : t("bypassStatusOff")}
          </Badge>
          <Button
            size="sm"
            variant={status.enabled ? "destructive" : "outline"}
            className="cursor-pointer"
            disabled={isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {status.enabled ? t("bypassTurnOff") : t("bypassTurnOn")}
          </Button>
        </div>
      </div>

      {errorKey && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t(errorKey)}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        {status.updatedByAdminName
          ? t("bypassLastChangedBy", {
              name: status.updatedByAdminName,
              date: format.dateTime(new Date(status.updatedAt), { dateStyle: "medium", timeStyle: "short" }),
            })
          : t("bypassNeverChanged")}
      </p>

      <Dialog open={confirmOpen} onOpenChange={(open) => !isPending && setConfirmOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{status.enabled ? t("confirmTurnOffTitle") : t("confirmTurnOnTitle")}</DialogTitle>
            <DialogDescription>
              {status.enabled ? t("confirmTurnOffDescription") : t("confirmTurnOnDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="cursor-pointer"
              disabled={isPending}
              onClick={() => setConfirmOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant={status.enabled ? "outline" : "destructive"}
              className="cursor-pointer"
              disabled={isPending}
              onClick={handleConfirm}
            >
              {isPending ? t("bypassSubmitting") : status.enabled ? t("bypassTurnOff") : t("bypassTurnOn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
