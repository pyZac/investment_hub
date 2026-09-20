import { getTranslations, getFormatter } from "next-intl/server";
import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/lib/job-monitor";

const JOB_TYPE_LABEL_KEYS: Record<string, string> = {
  daily_interest: "jobDailyInterest",
  binary_cycle: "jobBinaryCycle",
  rank_evaluation: "jobRankEvaluation",
  rank_payout: "jobRankPayout",
  reconciliation: "jobReconciliation",
};

function statusBadgeVariant(status: JobStatus["currentStatus"]): "success" | "destructive" | "warning" | "secondary" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED") return "destructive";
  if (status === "RUNNING") return "warning";
  return "secondary";
}

export async function JobHealthSection({ jobs }: { jobs: JobStatus[] }) {
  const t = await getTranslations("AdminOverview");
  const format = await getFormatter();

  return (
    <section className="space-y-4">
      <h2 className="font-heading text-xl font-semibold">{t("jobHealthHeading")}</h2>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex flex-row items-center gap-2 text-base font-medium">
            <Activity className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{t("jobHealthCardTitle")}</span>
          </CardTitle>
          <CardDescription>{t("jobHealthCardDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {jobs.map((job) => (
            <div
              key={job.jobType}
              className="flex flex-row flex-wrap items-center justify-between gap-2 rounded-lg border border-border/40 px-3 py-2.5"
            >
              <span className="font-medium" dir="ltr">
                {t(JOB_TYPE_LABEL_KEYS[job.jobType] ?? job.jobType)}
              </span>
              <div className="flex flex-row items-center gap-3">
                <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap" dir="ltr">
                  {job.lastCompletedAt
                    ? format.dateTime(job.lastCompletedAt, { dateStyle: "medium", timeStyle: "short" })
                    : t("neverSucceeded")}
                </span>
                <Badge variant={statusBadgeVariant(job.currentStatus)}>{t(`status_${job.currentStatus}`)}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
