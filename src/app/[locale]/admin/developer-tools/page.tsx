import { getTranslations, getLocale } from "next-intl/server";
import { requirePermissionOrRedirect } from "@/lib/page-guard";
import { listJobStatuses, getFridayBypassStatus } from "@/lib/developer-tools";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { JobTriggerList } from "./job-trigger-list";
import { FridayBypassToggle } from "./friday-bypass-toggle";

export default async function AdminDeveloperToolsPage() {
  const t = await getTranslations("AdminDeveloperTools");
  const locale = await getLocale();
  const actor = await requirePermissionOrRedirect("DEVELOPER_TOOLS", new Date());

  const [jobs, bypassStatus] = await Promise.all([
    listJobStatuses(actor.id),
    getFridayBypassStatus(actor.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <Card className="border-warning/40 bg-warning/5">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("bypassHeading")}</CardTitle>
          <CardDescription>{t("bypassDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FridayBypassToggle
            locale={locale}
            initialStatus={{
              enabled: bypassStatus.enabled,
              updatedAt: bypassStatus.updatedAt.toISOString(),
              updatedByAdminName: bypassStatus.updatedByAdminName,
            }}
          />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("jobsHeading")}</CardTitle>
          <CardDescription>{t("jobsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <JobTriggerList
            locale={locale}
            initialJobs={jobs.map((j) => ({
              jobType: j.jobType,
              currentStatus: j.currentStatus,
              lastCompletedPeriodKey: j.lastCompletedPeriodKey,
              lastCompletedAt: j.lastCompletedAt?.toISOString() ?? null,
              lastFailedPeriodKey: j.lastFailedPeriodKey,
              lastFailedAt: j.lastFailedAt?.toISOString() ?? null,
              lastFailedError: j.lastFailedError,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
