import { getTranslations } from "next-intl/server";
import { LogoFull } from "@/components/logo";
import { LoginForm } from "@/components/login-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

/**
 * A redirect target is only ever taken from the same-origin, locale-scoped
 * path space this app serves — never trust an arbitrary `?redirect=` value
 * as a full URL (that would be an open-redirect vector). Anything that
 * doesn't look like an internal path falls back to the default.
 */
function safeRedirectTarget(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/dashboard";
  }
  return raw;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const t = await getTranslations("Login");
  const { redirect } = await searchParams;
  const redirectTo = safeRedirectTarget(redirect);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-12">
      <div className="mb-8">
        <LogoFull taglineText={t("logoTagline")} size="lg" />
      </div>

      <Card className="w-full max-w-sm border-border/60 shadow-lg">
        <CardHeader className="space-y-1.5 text-center">
          <CardTitle className="font-heading text-2xl font-semibold">{t("pageTitle")}</CardTitle>
          <CardDescription>{t("pageDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm redirectTo={redirectTo} />
        </CardContent>
      </Card>
    </div>
  );
}
