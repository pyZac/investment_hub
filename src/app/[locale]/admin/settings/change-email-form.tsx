"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { updateAdminEmailAction } from "./actions";

export function ChangeEmailForm({ locale, currentEmail }: { locale: string; currentEmail: string }) {
  const t = useTranslations("AdminSettings");
  const tCommon = useTranslations("Common");

  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    setIsSubmitting(true);
    try {
      const result = await updateAdminEmailAction(currentPassword, newEmail, locale);
      if (!result.ok) {
        setError(t(result.errorKey));
        return;
      }
      setSuccess(true);
      setNewEmail("");
      setCurrentPassword("");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-sm space-y-5" noValidate>
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {success ? (
        <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>{t("emailSuccessMessage")}</span>
        </div>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {currentEmail}
      </p>

      <div className="space-y-2">
        <Label htmlFor="new-email">{t("emailLabel")}</Label>
        <Input
          id="new-email"
          name="newEmail"
          type="email"
          autoComplete="email"
          required
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          className="h-11"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email-current-password">{t("emailCurrentPasswordLabel")}</Label>
        <PasswordInput
          id="email-current-password"
          name="currentPassword"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="h-11"
          toggleLabel={{ show: tCommon("showPassword"), hide: tCommon("hidePassword") }}
        />
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {t("emailSubmitting")}
          </>
        ) : (
          t("emailSubmit")
        )}
      </Button>
    </form>
  );
}
