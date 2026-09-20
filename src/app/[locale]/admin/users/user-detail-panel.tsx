"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
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
  adminResetPasswordAction,
  type UserManagementActionErrorKey,
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
  isMainAdmin: boolean;
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
  const tCommon = useTranslations("Common");
  const format = useFormatter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [confirmAction, setConfirmAction] = useState<"suspend" | "reinstate" | null>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [error, setError] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [resetStep, setResetStep] = useState<"form" | "confirm" | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [resetFieldError, setResetFieldError] = useState<string | null>(null);
  const [resetErrorKey, setResetErrorKey] = useState<UserManagementActionErrorKey | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);

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

  function openResetPassword() {
    setNewPassword("");
    setConfirmPassword("");
    setResetReason("");
    setResetFieldError(null);
    setResetErrorKey(null);
    setResetSuccess(false);
    setResetStep("form");
  }

  function validateResetForm(): boolean {
    if (newPassword.length < 8) {
      setResetFieldError(t("errorPasswordTooShort"));
      return false;
    }
    if (newPassword !== confirmPassword) {
      setResetFieldError(t("errorPasswordMismatch"));
      return false;
    }
    if (!resetReason.trim()) {
      setResetFieldError(t("errorReasonRequired"));
      return false;
    }
    setResetFieldError(null);
    return true;
  }

  function proceedToResetConfirm() {
    if (!validateResetForm()) return;
    setResetErrorKey(null);
    setResetStep("confirm");
  }

  function closeResetDialog(open: boolean) {
    if (!open && !isPending) {
      setResetStep(null);
      setResetErrorKey(null);
      setResetSuccess(false);
    }
  }

  function submitResetPassword() {
    setResetErrorKey(null);
    startTransition(async () => {
      const result = await adminResetPasswordAction(userId, newPassword, confirmPassword, resetReason, locale);
      if (result.ok) {
        setResetSuccess(true);
      } else {
        setResetErrorKey(result.errorKey);
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
                {!detail.isMainAdmin && (
                  <Button variant="outline" className="cursor-pointer" onClick={openResetPassword}>
                    {t("resetPassword")}
                  </Button>
                )}
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

      <Dialog open={resetStep !== null} onOpenChange={closeResetDialog}>
        <DialogContent>
          <DialogHeader>
            {resetSuccess ? (
              <DialogTitle>{t("resetPasswordSuccessTitle")}</DialogTitle>
            ) : resetStep === "confirm" ? (
              <DialogTitle>{t("resetPasswordConfirmTitle")}</DialogTitle>
            ) : (
              <DialogTitle>{t("resetPasswordTitle")}</DialogTitle>
            )}
            {!resetSuccess && resetStep === "confirm" && detail && (
              <DialogDescription>
                {t("resetPasswordConfirmDescription", { name: detail.name })}
              </DialogDescription>
            )}
            {resetSuccess && detail && (
              <DialogDescription>{t("resetPasswordSuccessDescription", { name: detail.name })}</DialogDescription>
            )}
          </DialogHeader>

          {!resetSuccess && resetStep === "form" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-new-password">{t("newPasswordLabel")}</Label>
                <PasswordInput
                  id="reset-new-password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setResetFieldError(null);
                  }}
                  toggleLabel={{ show: tCommon("showPassword"), hide: tCommon("hidePassword") }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reset-confirm-password">{t("confirmPasswordLabel")}</Label>
                <PasswordInput
                  id="reset-confirm-password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setResetFieldError(null);
                  }}
                  toggleLabel={{ show: tCommon("showPassword"), hide: tCommon("hidePassword") }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reset-reason">{t("reasonLabel")}</Label>
                <Input
                  id="reset-reason"
                  value={resetReason}
                  onChange={(e) => {
                    setResetReason(e.target.value);
                    setResetFieldError(null);
                  }}
                  placeholder={t("resetPasswordReasonPlaceholder")}
                />
              </div>
              {resetFieldError && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {resetFieldError}
                </p>
              )}
            </div>
          )}

          {!resetSuccess && resetStep === "confirm" && (
            <div className="space-y-2 rounded-lg bg-muted/40 px-4 py-3 text-sm">
              <div className="flex flex-row items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("reasonLabel")}</span>
                <span className="font-medium">{resetReason}</span>
              </div>
            </div>
          )}

          {resetErrorKey && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {t(resetErrorKey)}
            </p>
          )}

          {!resetSuccess && (
            <DialogFooter>
              <Button
                variant="outline"
                className="cursor-pointer"
                disabled={isPending}
                onClick={() => closeResetDialog(false)}
              >
                {t("cancel")}
              </Button>
              {resetStep === "form" ? (
                <Button className="cursor-pointer" onClick={proceedToResetConfirm}>
                  {t("continue")}
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  className="cursor-pointer"
                  disabled={isPending}
                  onClick={submitResetPassword}
                >
                  {isPending ? t("resettingPassword") : t("resetPasswordConfirmSubmit")}
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
