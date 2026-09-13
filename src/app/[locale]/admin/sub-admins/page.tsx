import { getTranslations, getLocale } from "next-intl/server";
import { requireMainAdminOrRedirect } from "@/lib/page-guard";
import { listSubAdmins } from "@/lib/admin-management";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CreateSubAdminForm } from "./create-sub-admin-form";
import { SubAdminList } from "./sub-admin-list";

export default async function SubAdminsPage() {
  const t = await getTranslations("AdminSubAdmins");
  const locale = await getLocale();
  const actor = await requireMainAdminOrRedirect(new Date());

  const subAdmins = await listSubAdmins(actor.id);

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
          <CreateSubAdminForm locale={locale} />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("listHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SubAdminList
            subAdmins={subAdmins.map((s) => ({
              id: s.id,
              email: s.email,
              name: s.name,
              createdAt: s.createdAt.toISOString(),
              suspendedAt: s.suspendedAt?.toISOString() ?? null,
              permissions: s.permissions,
            }))}
            locale={locale}
          />
        </CardContent>
      </Card>
    </div>
  );
}
