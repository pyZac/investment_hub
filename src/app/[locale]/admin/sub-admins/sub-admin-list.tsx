"use client";

import { useState, useTransition } from "react";
import { useTranslations, useFormatter } from "next-intl";
import type { AdminPermission } from "@prisma/client";
import { ChevronDown, ChevronUp } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateSubAdminPermissionsAction,
  deactivateSubAdminAction,
  reactivateSubAdminAction,
  type SubAdminActionErrorKey,
} from "./actions";
import { SubAdminActionLog } from "./sub-admin-action-log";

const PERMISSION_CATALOG: AdminPermission[] = [
  "CREDIT_ISSUANCE",
  "WITHDRAWAL_APPROVAL",
  "USER_MANAGEMENT",
  "PACKAGE_MANAGEMENT",
  "RATE_CONFIG",
  "COMMISSION_CONFIG",
  "RANK_CONFIG",
  "LEDGER_VIEW",
  "MANUAL_ADJUSTMENT",
  "JOB_MONITOR",
  "SOLVENCY_VIEW",
];

type SubAdminRow = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  suspendedAt: string | null;
  permissions: AdminPermission[];
};

export function SubAdminList({ subAdmins, locale }: { subAdmins: SubAdminRow[]; locale: string }) {
  const t = useTranslations("AdminSubAdmins");

  if (subAdmins.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("listEmpty")}</p>;
  }

  return (
    <div className="space-y-4">
      {subAdmins.map((subAdmin) => (
        <SubAdminRowCard key={subAdmin.id} subAdmin={subAdmin} locale={locale} />
      ))}
    </div>
  );
}

function SubAdminRowCard({ subAdmin, locale }: { subAdmin: SubAdminRow; locale: string }) {
  const t = useTranslations("AdminSubAdmins");
  const format = useFormatter();
  const [permissions, setPermissions] = useState<Set<AdminPermission>>(new Set(subAdmin.permissions));
  const [errorKey, setErrorKey] = useState<SubAdminActionErrorKey | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"deactivate" | "reactivate" | null>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isActive = subAdmin.suspendedAt === null;
  const dirty =
    permissions.size !== subAdmin.permissions.length ||
    subAdmin.permissions.some((p) => !permissions.has(p));

  function togglePermission(permission: AdminPermission) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) {
        next.delete(permission);
      } else {
        next.add(permission);
      }
      return next;
    });
    setSaved(false);
  }

  function savePermissions() {
    setErrorKey(null);
    startTransition(async () => {
      const result = await updateSubAdminPermissionsAction(
        subAdmin.id,
        [...permissions],
        `Updated via sub-admin management panel.`,
        locale,
      );
      if (result.ok) {
        setSaved(true);
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  function submitConfirm() {
    if (!confirmAction || !confirmReason.trim()) return;
    setErrorKey(null);
    startTransition(async () => {
      const result =
        confirmAction === "deactivate"
          ? await deactivateSubAdminAction(subAdmin.id, confirmReason, locale)
          : await reactivateSubAdminAction(subAdmin.id, confirmReason, locale);
      if (result.ok) {
        setConfirmAction(null);
        setConfirmReason("");
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-row items-center gap-2">
            <span className="font-heading text-base font-medium">{subAdmin.name}</span>
            <Badge variant={isActive ? "success" : "destructive"}>
              {isActive ? t("statusActive") : t("statusDeactivated")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{subAdmin.email}</p>
          <p className="text-xs text-muted-foreground">
            {t("createdAtLabel")}: {format.dateTime(new Date(subAdmin.createdAt), { dateStyle: "medium" })}
          </p>
        </div>

        <Button
          variant={isActive ? "destructive" : "secondary"}
          className="cursor-pointer"
          onClick={() => setConfirmAction(isActive ? "deactivate" : "reactivate")}
        >
          {isActive ? t("deactivate") : t("reactivate")}
        </Button>
      </div>

      <div className="space-y-2">
        <Label>{t("permissionsLabel")}</Label>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {PERMISSION_CATALOG.map((permission) => (
            <label
              key={permission}
              className="flex flex-row items-center gap-2.5 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5 text-sm cursor-pointer hover:bg-background/60"
            >
              <input
                type="checkbox"
                checked={permissions.has(permission)}
                onChange={() => togglePermission(permission)}
                className="size-4 shrink-0 accent-brand"
              />
              <span dir="ltr" className="text-foreground">
                {t(`permission_${permission}`)}
              </span>
            </label>
          ))}
        </div>
        <div className="flex flex-row items-center gap-3 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            disabled={!dirty || isPending}
            onClick={savePermissions}
          >
            {isPending ? t("saving") : t("savePermissions")}
          </Button>
          {saved && <span className="text-sm font-medium text-success">{t("permissionsUpdated")}</span>}
        </div>
      </div>

      {errorKey && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t(errorKey)}
        </p>
      )}

      <div>
        <Button
          size="sm"
          variant="ghost"
          className="cursor-pointer flex flex-row items-center gap-1.5"
          onClick={() => setHistoryOpen((v) => !v)}
        >
          {historyOpen ? (
            <ChevronUp className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          )}
          <span>{historyOpen ? t("hideHistory") : t("viewHistory")}</span>
        </Button>
        {historyOpen && <SubAdminActionLog subAdminId={subAdmin.id} />}
      </div>

      <Dialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "deactivate" ? t("confirmDeactivateTitle") : t("confirmReactivateTitle")}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === "deactivate"
                ? t("confirmDeactivateDescription")
                : t("confirmReactivateDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-reason">{t("reasonLabel")}</Label>
            <Input
              id="confirm-reason"
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
              variant={confirmAction === "deactivate" ? "destructive" : "default"}
              className="cursor-pointer"
              disabled={!confirmReason.trim() || isPending}
              onClick={submitConfirm}
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
