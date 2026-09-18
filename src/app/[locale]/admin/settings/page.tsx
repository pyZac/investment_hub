import { getTranslations, getLocale } from "next-intl/server";
import { requireMainAdminOrRedirect } from "@/lib/page-guard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/change-password-form";
import { ChangeEmailForm } from "./change-email-form";
import { TotpReenrollPanel } from "./totp-reenroll-panel";

export default async function AdminSettingsPage() {
  const t = await getTranslations("AdminSettings");
  const locale = await getLocale();
  const actor = await requireMainAdminOrRedirect(new Date());

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("emailHeading")}</CardTitle>
          <CardDescription>{t("emailDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangeEmailForm locale={locale} currentEmail={actor.email} />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("changePasswordHeading")}</CardTitle>
          <CardDescription>{t("changePasswordDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("totpHeading")}</CardTitle>
          <CardDescription>{t("totpDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <TotpReenrollPanel locale={locale} />
        </CardContent>
      </Card>
    </div>
  );
}
