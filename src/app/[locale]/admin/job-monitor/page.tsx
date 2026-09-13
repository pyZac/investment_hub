import { getTranslations, getLocale } from "next-intl/server";
import { requirePermissionOrRedirect } from "@/lib/page-guard";
import { listJobStatuses } from "@/lib/job-monitor";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { JobStatusList } from "./job-status-list";

export default async function AdminJobMonitorPage() {
  const t = await getTranslations("AdminJobMonitor");
  const locale = await getLocale();
  const actor = await requirePermissionOrRedirect("JOB_MONITOR", new Date());

  const jobs = await listJobStatuses(actor.id);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("listHeading")}</CardTitle>
          <CardDescription>{t("listDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <JobStatusList
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
