import { getTranslations, getLocale } from "next-intl/server";
import { requirePermissionOrRedirect } from "@/lib/page-guard";
import { searchUsers } from "@/lib/user-management";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CreateUserForm } from "./create-user-form";
import { UserList } from "./user-list";

export default async function AdminUsersPage() {
  const t = await getTranslations("AdminUsers");
  const locale = await getLocale();
  const actor = await requirePermissionOrRedirect("USER_MANAGEMENT", new Date());

  const initialResults = await searchUsers(actor.id, { page: 1 });

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
          <CreateUserForm locale={locale} />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("listHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <UserList
            initialUsers={initialResults.users.map((u) => ({
              id: u.id,
              name: u.name,
              email: u.email,
              createdAt: u.createdAt.toISOString(),
              suspendedAt: u.suspendedAt?.toISOString() ?? null,
              currentRank: u.currentRank,
            }))}
            initialTotal={initialResults.total}
            pageSize={initialResults.pageSize}
            locale={locale}
          />
        </CardContent>
      </Card>
    </div>
  );
}
