import { getTranslations } from "next-intl/server";
import { Building2, Hotel, Home as HomeIcon, Car } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PublicHero } from "@/components/public/public-hero";

export default async function SectorsPage() {
  const t = await getTranslations("Sectors");

  const sectors = [
    {
      icon: Building2,
      titleKey: "apartmentsTitle",
      body1Key: "apartmentsBody1",
      body2Key: "apartmentsBody2",
    },
    {
      icon: Hotel,
      titleKey: "hotelsTitle",
      body1Key: "hotelsBody1",
      body2Key: "hotelsBody2",
    },
    {
      icon: HomeIcon,
      titleKey: "homesTitle",
      body1Key: "homesBody1",
      body2Key: "homesBody2",
    },
    {
      icon: Car,
      titleKey: "mobilityTitle",
      body1Key: "mobilityBody1",
      body2Key: "mobilityBody2",
    },
  ] as const;

  return (
    <div>
      <PublicHero
        imageSrc="/images/chart_1.jpg"
        imageAlt={t("heroHeadline")}
        headline={t("heroHeadline")}
        subheadline={t("heroSubheadline")}
      />

      <div className="mx-auto max-w-6xl space-y-16 px-6 py-16 lg:px-8">
        <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {sectors.map(({ icon: Icon, titleKey, body1Key, body2Key }) => (
            <Card key={titleKey} className="border-border/60 shadow-sm transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <div className="mb-2 flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-6" aria-hidden="true" />
                </div>
                <CardTitle className="text-lg font-semibold">{t(titleKey)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">{t(body1Key)}</p>
                <p className="text-sm text-muted-foreground">{t(body2Key)}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="space-y-4 rounded-2xl border border-border/60 bg-surface px-6 py-10 sm:px-10">
          <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{t("oneSectorHeading")}</h2>
          <div className="max-w-3xl space-y-3 text-base text-muted-foreground">
            <p>{t("oneSectorBody1")}</p>
            <p>{t("oneSectorBody2")}</p>
            <p>{t("oneSectorBody3")}</p>
            <p>{t("oneSectorBody4")}</p>
            <p>{t("oneSectorBody5")}</p>
            <p className="font-medium text-foreground">{t("oneSectorBody6")}</p>
            <p>{t("oneSectorBody7")}</p>
            <p>{t("oneSectorBody8")}</p>
            <p>{t("oneSectorBody9")}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
