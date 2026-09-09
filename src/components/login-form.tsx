"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LoginResponse =
  | { status: "authenticated"; user: { id: string; email: string; name: string; role: string } }
  | { status: "totp_required"; pendingToken: string }
  | { status: "totp_enrollment_required"; pendingToken: string }
  | { error: string };

type TotpVerifyResponse = { user: { id: string; email: string; name: string; role: string } } | { error: string };

type Step =
  | { kind: "credentials" }
  | { kind: "totp"; pendingToken: string }
  | { kind: "enrollment_required" };

/**
 * A wrong TOTP code kills the pendingToken server-side (single-use, no
 * reissue on failure — see pending-auth.ts) — there is no "retry the code"
 * path, only "log in again from the start." The `totp` step's error state
 * reflects this: it doesn't offer a retry, it sends the user back to
 * `credentials`.
 */
export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const t = useTranslations("Login");
  const router = useRouter();

  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCredentialsSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data: LoginResponse = await res.json();

      if (!res.ok || "error" in data) {
        setError(
          "error" in data
            ? res.status === 429
              ? data.error
              : t("errorInvalidCredentials")
            : t("errorGeneric"),
        );
        return;
      }

      if (data.status === "authenticated") {
        router.push(redirectTo);
        router.refresh();
        return;
      }

      if (data.status === "totp_required") {
        setStep({ kind: "totp", pendingToken: data.pendingToken });
        return;
      }

      // totp_enrollment_required
      setStep({ kind: "enrollment_required" });
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTotpSubmit(event: FormEvent) {
    event.preventDefault();
    if (step.kind !== "totp") return;
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/totp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken: step.pendingToken, code }),
      });
      const data: TotpVerifyResponse = await res.json();

      if (!res.ok || "error" in data) {
        // The pendingToken is now dead regardless of why this failed — no
        // point letting the user retry the code, send them back to start.
        setError(t("totpErrorInvalidCode"));
        setStep({ kind: "credentials" });
        setPassword("");
        setCode("");
        return;
      }

      router.push(redirectTo);
      router.refresh();
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step.kind === "enrollment_required") {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
          <AlertCircle className="size-6" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold">{t("enrollmentRequiredTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("enrollmentRequiredDescription")}</p>
        </div>
        <Button variant="outline" className="w-full" onClick={() => setStep({ kind: "credentials" })}>
          {t("enrollmentRequiredBack")}
        </Button>
      </div>
    );
  }

  if (step.kind === "totp") {
    return (
      <form onSubmit={handleTotpSubmit} className="space-y-5" noValidate>
        <div className="space-y-1.5 text-center">
          <h2 className="text-lg font-semibold">{t("totpTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("totpDescription")}</p>
        </div>

        {error ? <ErrorBanner message={error} /> : null}

        <div className="space-y-2">
          <Label htmlFor="totp-code">{t("totpCodeLabel")}</Label>
          <Input
            id="totp-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={t("totpCodePlaceholder")}
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="h-11 text-center text-lg tracking-[0.5em] tabular-nums"
          />
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting || code.length !== 6}>
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t("totpSubmitting")}
            </>
          ) : (
            t("totpSubmit")
          )}
        </Button>

        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => {
            setStep({ kind: "credentials" });
            setError(null);
            setCode("");
          }}
        >
          {t("totpBack")}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleCredentialsSubmit} className="space-y-5" noValidate>
      {error ? <ErrorBanner message={error} /> : null}

      <div className="space-y-2">
        <Label htmlFor="login-email">{t("emailLabel")}</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="login-password">{t("passwordLabel")}</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder={t("passwordPlaceholder")}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11"
        />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
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

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
