import { getTranslations } from "next-intl/server";
import { Search, Target, LineChart, ShieldAlert, Layers } from "lucide-react";
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

export default async function HowWeInvestPage() {
  const t = await getTranslations("HowWeInvest");

  const steps = [
    { number: "01", icon: Search, titleKey: "step1Title", bodyKey: "step1Body" },
    { number: "02", icon: Target, titleKey: "step2Title", bodyKey: null },
    { number: "03", icon: LineChart, titleKey: "step3Title", bodyKey: "step3Body" },
    { number: "04", icon: ShieldAlert, titleKey: "step4Title", bodyKey: "step4Body" },
    { number: "05", icon: Layers, titleKey: "step5Title", bodyKey: "step5Body" },
  ] as const;

  return (
    <div>
      <PublicHero
        imageSrc="/images/investment_1.jpg"
        imageAlt={t("heroHeadline")}
        headline={t("heroHeadline")}
        subheadline={t("heroSubheadline")}
      />

      <div className="mx-auto max-w-6xl space-y-16 px-6 py-16 lg:px-8">
        <section className="space-y-6">
          <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{t("processHeading")}</h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map(({ number, icon: Icon, titleKey, bodyKey }) => (
              <Card key={titleKey} className="border-border/60 shadow-sm transition-shadow hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="mb-2 flex flex-row items-center justify-between">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </div>
                    <span className="font-heading text-2xl font-bold tabular-nums text-muted-foreground/40" dir="ltr">
                      {number}
                    </span>
                  </div>
                  <CardTitle className="text-base font-medium">{t(titleKey)}</CardTitle>
                </CardHeader>
                <CardContent>
                  {bodyKey === null ? (
                    <div className="space-y-1.5 text-sm text-muted-foreground">
                      <p>{t("step2Body1")}</p>
                      <p>{t("step2Body2")}</p>
                      <p>{t("step2Body3")}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t(bodyKey)}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Section heading={t("ecosystemHeading")}>
          <p>{t("ecosystemBody1")}</p>
          <p>{t("ecosystemBody2")}</p>
          <p className="font-medium text-foreground">{t("ecosystemBody3")}</p>
          <p>{t("ecosystemBody4")}</p>
          <p className="font-medium text-foreground">{t("ecosystemBody5")}</p>
          <p>{t("ecosystemBody6")}</p>
          <p className="font-medium text-foreground">{t("ecosystemBody7")}</p>
          <p>{t("ecosystemBody8")}</p>
          <p>{t("ecosystemBody9")}</p>
        </Section>

        <section className="space-y-4 rounded-2xl border border-border/60 bg-surface px-6 py-10 sm:px-10">
          <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{t("whyTouristHeading")}</h2>
          <div className="max-w-3xl space-y-3 text-base text-muted-foreground">
            <p className="font-medium text-foreground">{t("whyTouristBody1")}</p>
            <p>{t("whyTouristBody2")}</p>
            <p>{t("whyTouristBody3")}</p>
            <p>{t("whyTouristBody4")}</p>
            <p>{t("whyTouristBody5")}</p>
            <p>{t("whyTouristBody6")}</p>
            <p>{t("whyTouristBody7")}</p>
            <p>{t("whyTouristBody8")}</p>
          </div>
        </section>

        <Section heading={t("globalHeading")}>
          <p className="font-medium text-foreground">{t("globalBody1")}</p>
          <p>{t("globalBody2")}</p>
          <p>{t("globalBody3")}</p>
          <p>{t("globalBody4")}</p>
          <p>{t("globalBody5")}</p>
          <p>{t("globalBody6")}</p>
          <p>
            {t("globalBody7")} {t("globalBody8")} {t("globalBody9")}
          </p>
          <p className="font-medium text-foreground">{t("globalBody10")}</p>
        </Section>
      </div>
    </div>
  );
}
