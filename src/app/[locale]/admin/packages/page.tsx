import { getTranslations, getLocale } from "next-intl/server";
import { requirePermissionOrRedirect } from "@/lib/page-guard";
import { listAllPackages } from "@/lib/packages";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CreatePackageForm } from "./create-package-form";
import { PackageList } from "./package-list";

export default async function AdminPackagesPage() {
  const t = await getTranslations("AdminPackages");
  const locale = await getLocale();
  await requirePermissionOrRedirect("PACKAGE_MANAGEMENT", new Date());

  const packages = await listAllPackages();

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("createHeading")}</CardTitle>
          <CardDescription>{t("createDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CreatePackageForm locale={locale} />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("listHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PackageList
            initialPackages={packages.map((p) => ({
              id: p.id,
              name: p.name,
              amount: p.amount.toString(),
              isActive: p.isActive,
              investmentCount: p.investmentCount,
            }))}
            locale={locale}
          />
        </CardContent>
      </Card>
    </div>
  );
}
