import { getTranslations, getFormatter } from "next-intl/server";
import { Layers, Lock, PiggyBank, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type PackageBreakdownRow = {
  packageId: string;
  packageName: string;
  investmentCount: number;
  totalValue: string;
};

type UpcomingReleaseRow = {
  investmentId: string;
  userName: string;
  packageName: string;
  amount: string;
  capitalUnlocksAt: string;
};

export async function InvestmentsOverviewSection({
  activeCount,
  activeTotalValue,
  totalLockedCapital,
  byPackage,
  upcomingReleases,
}: {
  activeCount: number;
  activeTotalValue: string;
  totalLockedCapital: string;
  byPackage: PackageBreakdownRow[];
  upcomingReleases: UpcomingReleaseRow[];
  locale: string;
}) {
  const t = await getTranslations("AdminOverview");
  const format = await getFormatter();

  return (
    <section className="space-y-4">
      <h2 className="font-heading text-xl font-semibold">{t("investmentsHeading")}</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-row items-center gap-2 text-sm font-medium text-muted-foreground">
              <Layers className="size-4 shrink-0" aria-hidden="true" />
              <span>{t("activeInvestmentsLabel")}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold tabular-nums" dir="ltr">
              {activeCount}
            </p>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums" dir="ltr">
              {activeTotalValue}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-row items-center gap-2 text-sm font-medium text-muted-foreground">
              <Lock className="size-4 shrink-0" aria-hidden="true" />
              <span>{t("lockedCapitalLabel")}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold tabular-nums" dir="ltr">
              {totalLockedCapital}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-row items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
              <span>{t("upcomingReleasesLabel")}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold tabular-nums" dir="ltr">
              {upcomingReleases.length}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t("upcomingReleasesWindow")}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex flex-row items-center gap-2 text-base font-medium">
            <PiggyBank className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{t("byPackageHeading")}</span>
          </CardTitle>
          <CardDescription>{t("byPackageDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {byPackage.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("byPackageEmpty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/40">
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colPackage")}</th>
                    <th className="px-3 py-2 text-end font-medium text-muted-foreground">{t("colCount")}</th>
                    <th className="px-3 py-2 text-end font-medium text-muted-foreground">{t("colTotalValue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {byPackage.map((row) => (
                    <tr key={row.packageId} className="border-b border-border/40 last:border-0">
                      <td className="px-3 py-2 font-medium">{row.packageName}</td>
                      <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                        {row.investmentCount}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                        {row.totalValue}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex flex-row items-center gap-2 text-base font-medium">
            <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{t("upcomingReleasesHeading")}</span>
          </CardTitle>
          <CardDescription>{t("upcomingReleasesDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {upcomingReleases.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("upcomingReleasesEmpty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/40">
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colUser")}</th>
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colPackage")}</th>
                    <th className="px-3 py-2 text-end font-medium text-muted-foreground">{t("colAmount")}</th>
                    <th className="px-3 py-2 text-end font-medium text-muted-foreground">{t("colReleaseDate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingReleases.map((row) => (
                    <tr key={row.investmentId} className="border-b border-border/40 last:border-0">
                      <td className="px-3 py-2 font-medium">{row.userName}</td>
                      <td className="px-3 py-2">{row.packageName}</td>
                      <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                        {row.amount}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums whitespace-nowrap" dir="ltr">
                        {format.dateTime(new Date(row.capitalUnlocksAt), { dateStyle: "medium" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
