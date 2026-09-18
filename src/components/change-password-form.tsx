"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";

type ChangePasswordResponse = { ok: true } | { error: string };

export function ChangePasswordForm() {
  const t = useTranslations("Profile");
  const tCommon = useTranslations("Common");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 8) {
      setError(t("errorPasswordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("errorPasswordMismatch"));
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data: ChangePasswordResponse = await res.json();

      if (!res.ok || "error" in data) {
        setError(
          "error" in data && /current password is incorrect/i.test(data.error)
            ? t("errorCurrentPasswordIncorrect")
            : t("errorGeneric"),
        );
        return;
      }

      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError(t("errorGeneric"));
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
          <span>{t("successMessage")}</span>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="current-password">{t("currentPasswordLabel")}</Label>
        <PasswordInput
          id="current-password"
          name="currentPassword"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="h-11"
          toggleLabel={{ show: tCommon("showPassword"), hide: tCommon("hidePassword") }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="new-password">{t("newPasswordLabel")}</Label>
        <PasswordInput
          id="new-password"
          name="newPassword"
          autoComplete="new-password"
          required
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="h-11"
          toggleLabel={{ show: tCommon("showPassword"), hide: tCommon("hidePassword") }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-password">{t("confirmPasswordLabel")}</Label>
        <PasswordInput
          id="confirm-password"
          name="confirmPassword"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="h-11"
          toggleLabel={{ show: tCommon("showPassword"), hide: tCommon("hidePassword") }}
        />
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {t("submitting")}
          </>
        ) : (
          t("submit")
        )}
      </Button>
    </form>
  );
}
