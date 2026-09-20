import { getTranslations } from "next-intl/server";
import { Users, Megaphone, ShieldOff, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function UserActivitySection({
  totalUsers,
  totalMarketers,
  totalSuspended,
  newThisMonth,
}: {
  totalUsers: number;
  totalMarketers: number;
  totalSuspended: number;
  newThisMonth: number;
}) {
  const t = await getTranslations("AdminOverview");

  const stats = [
    { key: "totalUsersLabel", value: totalUsers, icon: Users },
    { key: "totalMarketersLabel", value: totalMarketers, icon: Megaphone },
    { key: "totalSuspendedLabel", value: totalSuspended, icon: ShieldOff },
    { key: "newThisMonthLabel", value: newThisMonth, icon: UserPlus },
  ] as const;

  return (
    <section className="space-y-4">
      <h2 className="font-heading text-xl font-semibold">{t("userActivityHeading")}</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ key, value, icon: Icon }) => (
          <Card key={key} className="border-border/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-row items-center gap-2 text-sm font-medium text-muted-foreground">
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span>{t(key)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-heading text-3xl font-semibold tabular-nums" dir="ltr">
                {value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
