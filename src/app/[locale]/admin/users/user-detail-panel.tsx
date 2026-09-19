"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations, useFormatter } from "next-intl";
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
  getUserDetailAction,
  suspendUserAction,
  reinstateUserAction,
  toggleMarketerStatusAction,
} from "./actions";

type Detail = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  suspendedAt: string | null;
  sponsorId: string | null;
  wallets: { A: string; B: string; C: string; SAVING: string };
  activeInvestmentCount: number;
  referralCount: number;
  currentRank: string | null;
  isMarketer: boolean;
};

export function UserDetailPanel({
  userId,
  locale,
  onClose,
  onChanged,
}: {
  userId: string;
  locale: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("AdminUsers");
  const format = useFormatter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [confirmAction, setConfirmAction] = useState<"suspend" | "reinstate" | null>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [error, setError] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getUserDetailAction(userId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDetail(result.detail);
      } else {
        setError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  function submitConfirm() {
    if (!confirmAction || !confirmReason.trim()) return;
    startTransition(async () => {
      const result =
        confirmAction === "suspend"
          ? await suspendUserAction(userId, confirmReason, locale)
          : await reinstateUserAction(userId, confirmReason, locale);
      if (result.ok) {
        setConfirmAction(null);
        setConfirmReason("");
        const refreshed = await getUserDetailAction(userId);
        if (refreshed.ok) {
          setDetail(refreshed.detail);
        }
        onChanged();
      }
    });
  }

  function toggleMarketer() {
    startTransition(async () => {
      const result = await toggleMarketerStatusAction(userId, locale);
      if (result.ok) {
        const refreshed = await getUserDetailAction(userId);
        if (refreshed.ok) {
          setDetail(refreshed.detail);
        }
        onChanged();
      }
    });
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("detailTitle")}</DialogTitle>
          </DialogHeader>

          {error && <p className="text-sm text-destructive">{t("errorGeneric")}</p>}

          {!detail && !error && <p className="text-sm text-muted-foreground">{t("loading")}</p>}

          {detail && (
            <div className="space-y-5">
              <div className="space-y-1">
                <div className="flex flex-row flex-wrap items-center gap-2">
                  <span className="font-heading text-base font-medium">{detail.name}</span>
                  <Badge variant={detail.suspendedAt === null ? "success" : "destructive"}>
                    {detail.suspendedAt === null ? t("statusActive") : t("statusSuspended")}
                  </Badge>
                  {detail.isMarketer ? <Badge variant="outline">{t("marketerBadge")}</Badge> : null}
                </div>
                <p className="text-sm text-muted-foreground">{detail.email}</p>
                <p className="text-xs text-muted-foreground">
                  {t("colJoined")}: {format.dateTime(new Date(detail.createdAt), { dateStyle: "medium" })}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(["A", "B", "C", "SAVING"] as const).map((w) => (
                  <div key={w} className="rounded-lg bg-muted/40 px-3 py-2.5">
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      Wallet {w}
                    </p>
                    <p className="font-heading text-base font-semibold tabular-nums" dir="ltr">
                      {detail.wallets[w]}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-muted/40 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">{t("activeInvestmentsLabel")}</p>
                  <p className="font-heading text-base font-semibold tabular-nums">
                    {detail.activeInvestmentCount}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/40 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">{t("referralsLabel")}</p>
                  <p className="font-heading text-base font-semibold tabular-nums">{detail.referralCount}</p>
                </div>
                <div className="rounded-lg bg-muted/40 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">{t("colRank")}</p>
                  <p className="font-heading text-base font-semibold" dir="ltr">
                    {detail.currentRank ?? t("rankUnranked")}
                  </p>
                </div>
              </div>

              <div className="flex flex-row flex-wrap gap-2">
                <Button
                  variant={detail.suspendedAt === null ? "destructive" : "secondary"}
                  className="cursor-pointer"
                  onClick={() => setConfirmAction(detail.suspendedAt === null ? "suspend" : "reinstate")}
                >
                  {detail.suspendedAt === null ? t("suspend") : t("reinstate")}
                </Button>
                <Button
                  variant="outline"
                  className="cursor-pointer"
                  disabled={isPending}
                  onClick={toggleMarketer}
                >
                  {detail.isMarketer ? t("disableMarketing") : t("enableMarketing")}
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={onClose}>
              {t("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "suspend" ? t("confirmSuspendTitle") : t("confirmReinstateTitle")}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === "suspend" ? t("confirmSuspendDescription") : t("confirmReinstateDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="user-confirm-reason">{t("reasonLabel")}</Label>
            <Input
              id="user-confirm-reason"
              value={confirmReason}
              onChange={(e) => setConfirmReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setConfirmAction(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant={confirmAction === "suspend" ? "destructive" : "default"}
              className="cursor-pointer"
              disabled={!confirmReason.trim() || isPending}
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
