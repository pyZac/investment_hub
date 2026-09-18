"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { beginTotpReenrollmentAction, confirmTotpReenrollmentAction } from "./actions";

type Step =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "enrolling"; secret: string; otpauthUri: string }
  | { kind: "error" };

export function TotpReenrollPanel({ locale }: { locale: string }) {
  const t = useTranslations("AdminSettings");

  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function startReenrollment() {
    setError(null);
    setSuccess(false);
    setStep({ kind: "loading" });
    const result = await beginTotpReenrollmentAction();
    if (!result.ok) {
      setError(t(result.errorKey));
      setStep({ kind: "error" });
      return;
    }
    setStep({ kind: "enrolling", secret: result.secret, otpauthUri: result.otpauthUri });
  }

  async function handleConfirmSubmit(event: FormEvent) {
    event.preventDefault();
    if (step.kind !== "enrolling") return;
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await confirmTotpReenrollmentAction(step.secret, code, locale);
      if (!result.ok) {
        setError(t(result.errorKey));
        return;
      }
      setSuccess(true);
      setStep({ kind: "idle" });
      setCode("");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step.kind === "loading") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("totpLoading")}</p>
      </div>
    );
  }

  if (step.kind === "enrolling") {
    return (
      <form onSubmit={handleConfirmSubmit} className="max-w-sm space-y-5" noValidate>
        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <p className="text-sm text-muted-foreground">{t("totpScanInstruction")}</p>

        <EnrollQrCode otpauthUri={step.otpauthUri} />

        <div className="space-y-1.5 text-center">
          <p className="text-xs text-muted-foreground">{t("totpManualEntryLabel")}</p>
          <p dir="ltr" className="select-all break-all rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-center font-mono text-sm">
            {step.secret}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reenroll-code">{t("totpCodeLabel")}</Label>
          <Input
            id="reenroll-code"
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

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={isSubmitting || code.length !== 6}>
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
            onClick={() => {
              setStep({ kind: "idle" });
              setError(null);
              setCode("");
            }}
          >
            {t("totpCancel")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="max-w-sm space-y-4">
      {error && step.kind === "error" ? (
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
          <span>{t("totpSuccessMessage")}</span>
        </div>
      ) : null}

      <Button variant="outline" onClick={startReenrollment}>
        {t("totpReenrollButton")}
      </Button>
    </div>
  );
}

/**
 * Same client-side QR generation approach as login-form.tsx's EnrollQrCode —
 * the otpauth:// URI is only known at runtime (a fresh secret per
 * re-enrollment attempt, never persisted until confirmed).
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
