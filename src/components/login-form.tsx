"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
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

type EnrollResponse = { secret: string; otpauthUri: string; pendingToken: string } | { error: string };

type ConfirmResponse = { user: { id: string; email: string; name: string; role: string } } | { error: string };

type Step =
  | { kind: "credentials" }
  | { kind: "totp"; pendingToken: string }
  | { kind: "enrolling_loading"; pendingToken: string }
  | { kind: "enrolling"; pendingToken: string; secret: string; otpauthUri: string }
  | { kind: "enrollment_error" };

/**
 * Every admin/sub-admin account is `role: "ADMIN"` — `admin_permission_grants`
 * rows only ever attach to an ADMIN-role user (created by
 * createSubAdmin, main-admin-only), so there is no "USER with admin
 * permissions" case to also check. `role === "ADMIN"` alone is exactly
 * "is_main_admin or has any admin permissions."
 */
function postLoginDestination(role: string, redirectTo: string): string {
  if (redirectTo === "/dashboard" && role === "ADMIN") {
    return "/admin/users";
  }
  return redirectTo;
}

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
        router.push(postLoginDestination(data.user.role, redirectTo));
        router.refresh();
        return;
      }

      if (data.status === "totp_required") {
        setStep({ kind: "totp", pendingToken: data.pendingToken });
        return;
      }

      // totp_enrollment_required
      setStep({ kind: "enrolling_loading", pendingToken: data.pendingToken });
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setIsSubmitting(false);
    }
  }

  // Fires once when entering enrolling_loading: fetches a freshly generated
  // secret + otpauth URI from the server (never persisted until confirmed),
  // then renders the QR/manual-entry step.
  useEffect(() => {
    if (step.kind !== "enrolling_loading") return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/auth/totp/enroll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pendingToken: step.pendingToken }),
        });
        const data: EnrollResponse = await res.json();
        if (cancelled) return;

        if (!res.ok || "error" in data) {
          setError(t("errorGeneric"));
          setStep({ kind: "enrollment_error" });
          return;
        }

        setStep({
          kind: "enrolling",
          pendingToken: data.pendingToken,
          secret: data.secret,
          otpauthUri: data.otpauthUri,
        });
      } catch {
        if (!cancelled) {
          setError(t("errorGeneric"));
          setStep({ kind: "enrollment_error" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.kind === "enrolling_loading" ? step.pendingToken : null]);

  async function handleEnrollConfirmSubmit(event: FormEvent) {
    event.preventDefault();
    if (step.kind !== "enrolling") return;
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken: step.pendingToken, secret: step.secret, code }),
      });
      const data: ConfirmResponse = await res.json();

      if (!res.ok || "error" in data) {
        // Same single-use pendingToken shape as TOTP verification — a
        // failed confirm attempt kills it server-side, so send back to
        // credentials rather than offering a retry on a dead token.
        setError(t("totpErrorInvalidCode"));
        setStep({ kind: "credentials" });
        setPassword("");
        setCode("");
        return;
      }

      router.push(postLoginDestination(data.user.role, redirectTo));
      router.refresh();
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

      router.push(postLoginDestination(data.user.role, redirectTo));
      router.refresh();
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step.kind === "enrolling_loading") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("enrollLoading")}</p>
      </div>
    );
  }

  if (step.kind === "enrollment_error") {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="size-6" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold">{t("enrollErrorTitle")}</h2>
          <p className="text-sm text-muted-foreground">{error ?? t("errorGeneric")}</p>
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            setStep({ kind: "credentials" });
            setError(null);
          }}
        >
          {t("totpBack")}
        </Button>
      </div>
    );
  }

  if (step.kind === "enrolling") {
    return (
      <form onSubmit={handleEnrollConfirmSubmit} className="space-y-5" noValidate>
        <div className="space-y-1.5 text-center">
          <h2 className="text-lg font-semibold">{t("enrollTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("enrollDescription")}</p>
        </div>

        {error ? <ErrorBanner message={error} /> : null}

        <EnrollQrCode otpauthUri={step.otpauthUri} />

        <div className="space-y-1.5 text-center">
          <p className="text-xs text-muted-foreground">{t("enrollManualEntryLabel")}</p>
          <p dir="ltr" className="select-all break-all rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-center font-mono text-sm">
            {step.secret}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="enroll-code">{t("totpCodeLabel")}</Label>
          <Input
            id="enroll-code"
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
            t("enrollSubmit")
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

/**
 * The otpauth:// URI is only known at runtime (a fresh secret per enrollment
 * attempt, never persisted until confirmed) — unlike referrals/page.tsx's
 * server-side QRCode.toDataURL call, this has to run client-side.
 */
function EnrollQrCode({ otpauthUri }: { otpauthUri: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(otpauthUri, { margin: 1, color: { dark: "#06201f", light: "#f4f5f1" } }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [otpauthUri]);

  if (!dataUrl) {
    return <div className="mx-auto flex size-40 items-center justify-center rounded-lg bg-muted/40" />;
  }

  // eslint-disable-next-line @next/next/no-img-element -- a data: URL has no benefit from next/image's optimization pipeline
  return <img src={dataUrl} alt="" className="mx-auto size-40 rounded-lg border border-border/60" />;
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
