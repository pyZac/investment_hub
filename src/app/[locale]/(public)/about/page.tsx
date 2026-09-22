import { getTranslations } from "next-intl/server";
import { Building2, Hotel, Home as HomeIcon, Car } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PublicHero } from "@/components/public/public-hero";

function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</h2>
      <div className="max-w-3xl space-y-3 text-base text-muted-foreground">{children}</div>
    </section>
  );
}

export default async function AboutPage() {
  const t = await getTranslations("About");

  const sectorCards = [
    { icon: Building2, headingKey: "apartmentsHeading", body1Key: "apartmentsBody1", body2Key: "apartmentsBody2" },
    { icon: Hotel, headingKey: "hotelsHeading", body1Key: "hotelsBody1", body2Key: "hotelsBody2" },
    { icon: HomeIcon, headingKey: "homesHeading", body1Key: "homesBody1", body2Key: "homesBody2" },
  ] as const;

  return (
    <div>
      <PublicHero
        imageSrc="/images/city skylines_2.jpg"
        imageAlt={t("heroHeadline")}
        headline={t("heroHeadline")}
        subheadline={t("heroSubheadline")}
      />

      <div className="mx-auto max-w-6xl space-y-16 px-6 py-16 lg:px-8">
        <Section heading={t("introHeading")}>
          <p>{t("introBody1")}</p>
          <p>{t("introBody2")}</p>
          <p>{t("introBody3")}</p>
        </Section>

        <Section heading={t("visionHeading")}>
          <p>{t("visionBody1")}</p>
          <p>{t("visionBody2")}</p>
          <p className="font-heading text-lg font-medium text-foreground">{t("visionBody3")}</p>
          <p>{t("visionBody4")}</p>
          <p className="font-medium text-foreground">{t("visionBody5")}</p>
          <p>{t("visionBody6")}</p>
          <p>{t("visionBody7")}</p>
          <p className="font-medium text-foreground">{t("visionBody8")}</p>
        </Section>

        <Section heading={t("investmentsHeading")}>
          <p>{t("investmentsBody1")}</p>
          <p>{t("investmentsBody2")}</p>
          <p className="font-medium text-foreground">{t("investmentsBody3")}</p>
        </Section>

        <section className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {sectorCards.map(({ icon: Icon, headingKey, body1Key, body2Key }) => (
              <Card key={headingKey} className="border-border/60 shadow-sm transition-shadow hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </div>
                  <CardTitle className="text-base font-medium">{t(headingKey)}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-muted-foreground">{t(body1Key)}</p>
                  <p className="text-sm text-muted-foreground">{t(body2Key)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Section heading={t("mobilityHeading")}>
          <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Car className="size-5" aria-hidden="true" />
          </div>
          <p>{t("mobilityBody1")}</p>
          <p>{t("mobilityBody2")}</p>
          <p>{t("mobilityBody3")}</p>
          <p className="font-medium text-foreground">{t("mobilityBody4")}</p>
        </Section>

        <Section heading={t("oneSectorHeading")}>
          <p>{t("oneSectorBody1")}</p>
          <p>{t("oneSectorBody2")}</p>
          <p>{t("oneSectorBody3")}</p>
          <p>{t("oneSectorBody4")}</p>
          <p>{t("oneSectorBody5")}</p>
          <p className="font-medium text-foreground">{t("oneSectorBody6")}</p>
          <p>{t("oneSectorBody7")}</p>
          <p>{t("oneSectorBody8")}</p>
          <p>{t("oneSectorBody9")}</p>
        </Section>

        <section className="space-y-4 rounded-2xl border border-border/60 bg-surface px-6 py-10 sm:px-10">
          <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{t("philosophyHeading")}</h2>
          <div className="max-w-3xl space-y-1.5 text-base text-muted-foreground">
            <p>{t("philosophyBody1")}</p>
            <p>{t("philosophyBody2")}</p>
            <p>{t("philosophyBody3")}</p>
            <p>{t("philosophyBody4")}</p>
            <p>{t("philosophyBody5")}</p>
          </div>
          <div className="max-w-3xl space-y-1.5 pt-2 text-base font-medium text-foreground">
            <p>{t("philosophyBody6")}</p>
            <p>{t("philosophyBody7")}</p>
          </div>
        </section>

        <Section heading={t("buildingHeading")}>
          <p>{t("buildingBody1")}</p>
          <p>{t("buildingBody2")}</p>
          <p>{t("buildingBody3")}</p>
          <p>{t("buildingBody4")}</p>
        </Section>

        <Section heading={t("futureHeading")}>
          <p>{t("futureBody1")}</p>
          <p>{t("futureBody2")}</p>
          <p>{t("futureBody3")}</p>
          <p>{t("futureBody4")}</p>
          <p className="font-medium text-foreground">{t("futureBody5")}</p>
          <p>{t("futureBody6")}</p>
          <p>{t("futureBody7")}</p>
          <p>{t("futureBody8")}</p>
          <p>{t("futureBody9")}</p>
        </Section>

        <Section heading={t("missionHeading")}>
          <p>{t("missionBody1")}</p>
          <p>{t("missionBody2")}</p>
          <p>{t("missionBody3")}</p>
          <p>{t("missionBody4")}</p>
          <p>{t("missionBody5")}</p>
          <p>{t("missionBody6")}</p>
          <p>{t("missionBody7")}</p>
          <p className="font-heading text-lg font-semibold tracking-wide text-brand" dir="ltr">
            {t("missionFormula")}
          </p>
          <p>{t("missionBody8")}</p>
        </Section>

        <section className="space-y-2 rounded-2xl border border-border/60 bg-surface px-6 py-12 text-center sm:px-10">
          <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{t("closingHeadline")}</h2>
          <p className="text-lg text-muted-foreground">{t("closingBody")}</p>
        </section>
      </div>
    </div>
  );
}
