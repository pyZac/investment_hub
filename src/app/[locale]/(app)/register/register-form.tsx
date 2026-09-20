"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { registerAction, type RegisterActionErrorKey } from "./actions";

const QUESTION_COUNT = 3;

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

export function RegisterForm({ referralCode }: { referralCode: string }) {
  const t = useTranslations("Register");
  const tCommon = useTranslations("Common");
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isMarketer, setIsMarketer] = useState(false);
  const [questions, setQuestions] = useState(
    Array.from({ length: QUESTION_COUNT }, () => ({ question: "", answer: "" })),
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<RegisterActionErrorKey | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateQuestion(index: number, field: "question" | "answer", value: string) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, [field]: value } : q)));
  }

  function validate(): boolean {
    if (password.length < 8) {
      setFieldError(t("errorPasswordTooShort"));
      return false;
    }
    if (password !== confirmPassword) {
      setFieldError(t("errorPasswordMismatch"));
      return false;
    }
    if (questions.some((q) => !q.question.trim() || !q.answer.trim())) {
      setFieldError(t("errorSecurityQuestionsRequired"));
      return false;
    }
    setFieldError(null);
    return true;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorKey(null);
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const result = await registerAction({
        referralCode,
        name,
        email,
        password,
        confirmPassword,
        isMarketer,
        securityQuestions: questions,
      });

      if (!result.ok) {
        setErrorKey(result.errorKey);
        return;
      }

      router.push(`/login?registered=1`);
    } catch {
      setErrorKey("errorGeneric");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {fieldError && <ErrorBanner message={fieldError} />}
      {errorKey && <ErrorBanner message={t(errorKey)} />}

      <div className="space-y-2">
        <Label htmlFor="register-name">{t("nameLabel")}</Label>
        <Input
          id="register-name"
          name="name"
          autoComplete="name"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-11"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="register-email">{t("emailLabel")}</Label>
        <Input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="register-password">{t("passwordLabel")}</Label>
        <PasswordInput
          id="register-password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11"
          toggleLabel={{ show: tCommon("showPassword"), hide: tCommon("hidePassword") }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="register-confirm-password">{t("confirmPasswordLabel")}</Label>
        <PasswordInput
          id="register-confirm-password"
          name="confirmPassword"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="h-11"
          toggleLabel={{ show: tCommon("showPassword"), hide: tCommon("hidePassword") }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="register-referral-code">{t("referralCodeLabel")}</Label>
        <Input id="register-referral-code" value={referralCode} readOnly disabled className="h-11" dir="ltr" />
      </div>

      <label className="flex flex-row items-center gap-2.5 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-sm cursor-pointer hover:bg-muted/60">
        <input
          type="checkbox"
          checked={isMarketer}
          onChange={(e) => setIsMarketer(e.target.checked)}
          className="size-4 shrink-0 accent-brand"
        />
        <span className="text-foreground">{t("marketerAccountLabel")}</span>
      </label>

      <div className="space-y-4 border-t border-border/60 pt-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("securityQuestionsHeading")}</p>
          <p className="text-xs text-muted-foreground">{t("securityQuestionsDescription")}</p>
        </div>

        {questions.map((q, i) => (
          <div key={i} className="space-y-2">
            <div className="space-y-1.5">
              <Label htmlFor={`register-question-${i}`}>{t("questionLabel", { number: i + 1 })}</Label>
              <Input
                id={`register-question-${i}`}
                required
                value={q.question}
                onChange={(e) => updateQuestion(i, "question", e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`register-answer-${i}`}>{t("answerLabel", { number: i + 1 })}</Label>
              <Input
                id={`register-answer-${i}`}
                required
                value={q.answer}
                onChange={(e) => updateQuestion(i, "answer", e.target.value)}
                className="h-11"
              />
            </div>
          </div>
        ))}
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
