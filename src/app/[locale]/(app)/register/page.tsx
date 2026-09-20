import { AlertCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { validateReferralCode } from "@/lib/users";
import { LogoFull } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RegisterForm } from "./register-form";

/**
 * Public self-registration, re-opened via a valid sponsor referral link
 * (`?ref=<sponsorUserId>` — see referrals/page.tsx's buildReferralLink,
 * which already generates exactly this shape). The ref is validated
 * server-side, here, before anything renders: an invalid or missing ref
 * shows a blocking message with no form at all, never a form that later
 * fails on submit. registerWithSponsor's own server action re-validates
 * again (defense in depth — this page's validation alone is not the real
 * enforcement boundary since a client could hit the action directly).
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const t = await getTranslations("Register");
  const tLogin = await getTranslations("Login");
  const { ref } = await searchParams;

  const validation = await validateReferralCode(ref);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-12">
      <div className="mb-8">
        <LogoFull taglineText={tLogin("logoTagline")} size="lg" />
      </div>

      <Card className="w-full max-w-sm border-border/60 shadow-lg">
        {validation.valid ? (
          <>
            <CardHeader className="space-y-1.5 text-center">
              <CardTitle className="font-heading text-2xl font-semibold">{t("pageTitle")}</CardTitle>
              <CardDescription>{t("invitedBy", { name: validation.sponsorName })}</CardDescription>
            </CardHeader>
            <CardContent>
              <RegisterForm referralCode={ref!} />
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader className="space-y-1.5 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertCircle className="size-6" aria-hidden="true" />
              </div>
              <CardTitle className="font-heading text-2xl font-semibold">{t("invalidRefTitle")}</CardTitle>
              <CardDescription>{t("invalidRefDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" nativeButton={false} render={<Link href="/login" />}>
                {t("backToLogin")}
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
