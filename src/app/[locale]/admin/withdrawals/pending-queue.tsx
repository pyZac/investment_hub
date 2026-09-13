"use client";

import { useState, useTransition } from "react";
import { useTranslations, useFormatter } from "next-intl";
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
  approveWithdrawalRequestAction,
  rejectWithdrawalRequestAction,
  listPendingWithdrawalRequestsAction,
  type WithdrawalActionErrorKey,
} from "./actions";

type PendingRow = {
  id: string;
  userName: string;
  userEmail: string;
  amount: string;
  requestedAt: string;
  walletBBalance: string;
};

export function PendingQueue({ initialRequests, locale }: { initialRequests: PendingRow[]; locale: string }) {
  const t = useTranslations("AdminWithdrawals");
  const format = useFormatter();
  const [requests, setRequests] = useState(initialRequests);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const [reason, setReason] = useState("");
  const [errorKey, setErrorKey] = useState<WithdrawalActionErrorKey | null>(null);
  const [isPending, startTransition] = useTransition();

  function openConfirm(id: string, action: "approve" | "reject") {
    setConfirmTarget({ id, action });
    setReason("");
    setErrorKey(null);
  }

  function refresh() {
    startTransition(async () => {
      const result = await listPendingWithdrawalRequestsAction();
      if (result.ok) {
        setRequests(result.requests);
      }
    });
  }

  function submitConfirm() {
    if (!confirmTarget) return;
    if (!reason.trim()) {
      setErrorKey("errorReasonRequired");
      return;
    }
    startTransition(async () => {
      const result =
        confirmTarget.action === "approve"
          ? await approveWithdrawalRequestAction(confirmTarget.id, reason, locale)
          : await rejectWithdrawalRequestAction(confirmTarget.id, reason, locale);
      if (result.ok) {
        setConfirmTarget(null);
        setReason("");
        refresh();
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  if (requests.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("queueEmpty")}</p>;
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/40">
              <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colUser")}</th>
              <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colAmount")}</th>
              <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colRequested")}</th>
              <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colWalletBBalance")}</th>
              <th className="px-3 py-2 text-end font-medium text-muted-foreground">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.userName}</div>
                  <div className="text-xs text-muted-foreground">{r.userEmail}</div>
                </td>
                <td className="px-3 py-2 font-heading font-semibold tabular-nums" dir="ltr">
                  {r.amount}
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                  {format.dateTime(new Date(r.requestedAt), { dateStyle: "medium", timeStyle: "short" })}
                </td>
                <td className="px-3 py-2 tabular-nums" dir="ltr">
                  {r.walletBBalance}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-row justify-end gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="cursor-pointer"
                      onClick={() => openConfirm(r.id, "reject")}
                    >
                      {t("reject")}
                    </Button>
                    <Button size="sm" className="cursor-pointer" onClick={() => openConfirm(r.id, "approve")}>
                      {t("approve")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={confirmTarget !== null} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmTarget?.action === "approve" ? t("confirmApproveTitle") : t("confirmRejectTitle")}
            </DialogTitle>
            <DialogDescription>
              {confirmTarget?.action === "approve" ? t("confirmApproveDescription") : t("confirmRejectDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="withdrawal-reason">{t("reasonLabel")}</Label>
            <Input
              id="withdrawal-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
            />
          </div>
          {errorKey && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {t(errorKey)}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setConfirmTarget(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant={confirmTarget?.action === "reject" ? "destructive" : "default"}
              className="cursor-pointer"
              disabled={!reason.trim() || isPending}
              onClick={submitConfirm}
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
