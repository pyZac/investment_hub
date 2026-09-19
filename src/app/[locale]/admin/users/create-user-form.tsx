"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { createUserAction, type UserManagementActionErrorKey } from "./actions";
import { SponsorPicker } from "./sponsor-picker";

export function CreateUserForm({ locale }: { locale: string }) {
  const t = useTranslations("AdminUsers");
  const tCommon = useTranslations("Common");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [isMarketer, setIsMarketer] = useState(false);
  const [sponsor, setSponsor] = useState<{ id: string; name: string; email: string } | null>(null);
  const [errorKey, setErrorKey] = useState<UserManagementActionErrorKey | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await createUserAction(
        { name, email, password, sponsorId: sponsor?.id, reason, isMarketer },
        locale,
      );
      if (result.ok) {
        setSuccess(true);
        setName("");
        setEmail("");
        setPassword("");
        setReason("");
        setIsMarketer(false);
        setSponsor(null);
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="user-name">{t("nameLabel")}</Label>
          <Input id="user-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="user-email">{t("emailLabel")}</Label>
          <Input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="user-password">{t("passwordLabel")}</Label>
          <PasswordInput
            id="user-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            toggleLabel={{ show: tCommon("showPassword"), hide: tCommon("hidePassword") }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="user-reason">{t("reasonLabel")}</Label>
          <Input
            id="user-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            required
          />
        </div>
      </div>

      <label className="flex flex-row items-center gap-2.5 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-sm cursor-pointer hover:bg-muted/60 sm:max-w-xs">
        <input
          type="checkbox"
          checked={isMarketer}
          onChange={(e) => setIsMarketer(e.target.checked)}
          className="size-4 shrink-0 accent-brand"
        />
        <span className="text-foreground">{t("marketerAccountLabel")}</span>
      </label>

      <SponsorPicker value={sponsor} onChange={setSponsor} />

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
