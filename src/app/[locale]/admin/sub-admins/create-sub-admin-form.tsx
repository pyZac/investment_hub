"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { AdminPermission } from "@prisma/client";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { createSubAdminAction, type SubAdminActionErrorKey } from "./actions";

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
  "DEVELOPER_TOOLS",
];

export function CreateSubAdminForm({ locale }: { locale: string }) {
  const t = useTranslations("AdminSubAdmins");
  const tCommon = useTranslations("Common");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [permissions, setPermissions] = useState<Set<AdminPermission>>(new Set());
  const [errorKey, setErrorKey] = useState<SubAdminActionErrorKey | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

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
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await createSubAdminAction(
        { name, email, password, permissions: [...permissions], reason },
        locale,
      );
      if (result.ok) {
        setSuccess(true);
        setName("");
        setEmail("");
        setPassword("");
        setReason("");
        setPermissions(new Set());
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="subadmin-name">{t("nameLabel")}</Label>
          <Input id="subadmin-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="subadmin-email">{t("emailLabel")}</Label>
          <Input
            id="subadmin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="subadmin-password">{t("passwordLabel")}</Label>
          <PasswordInput
            id="subadmin-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            toggleLabel={{ show: tCommon("showPassword"), hide: tCommon("hidePassword") }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="subadmin-reason">{t("reasonLabel")}</Label>
          <Input
            id="subadmin-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("permissionsLabel")}</Label>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {PERMISSION_CATALOG.map((permission) => (
            <label
              key={permission}
              className="flex flex-row items-center gap-2.5 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-sm cursor-pointer hover:bg-muted/60"
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
