import { getTranslations } from "next-intl/server";
import { Building2, Hotel, Home as HomeIcon, Car } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { PublicHero } from "@/components/public/public-hero";

export default async function HomePage() {
  const t = await getTranslations("Home");

  const focusAreas = [
    { icon: Building2, titleKey: "focusAreaApartmentsTitle", bodyKey: "focusAreaApartmentsBody" },
    { icon: Hotel, titleKey: "focusAreaHotelsTitle", bodyKey: "focusAreaHotelsBody" },
    { icon: HomeIcon, titleKey: "focusAreaHomesTitle", bodyKey: "focusAreaHomesBody" },
    { icon: Car, titleKey: "focusAreaMobilityTitle", bodyKey: "focusAreaMobilityBody" },
  ] as const;

  return (
    <div>
      <PublicHero
        imageSrc="/images/city skylines_1.jpg"
        imageAlt={t("heroHeadline")}
        headline={t("heroHeadline")}
        subheadline={t("heroSubheadline")}
        cta={
          <Button size="lg" nativeButton={false} render={<Link href="/about" />}>
            {t("heroCta")}
          </Button>
        }
      />

      <div className="mx-auto max-w-6xl space-y-16 px-6 py-16 lg:px-8">
        <section className="space-y-3">
          <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{t("whatWeDoHeading")}</h2>
          <p className="max-w-3xl text-base text-muted-foreground">{t("whatWeDoBody")}</p>
        </section>

        <section className="space-y-6">
          <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{t("focusAreasHeading")}</h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {focusAreas.map(({ icon: Icon, titleKey, bodyKey }) => (
              <Card key={titleKey} className="border-border/60 shadow-sm transition-shadow hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </div>
                  <CardTitle className="text-base font-medium">{t(titleKey)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{t(bodyKey)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-border/60 bg-surface px-6 py-10 text-center sm:px-10">
          <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{t("philosophyHeading")}</h2>
          <p className="mx-auto max-w-2xl text-base text-muted-foreground">{t("philosophyBody")}</p>
          <div className="pt-2">
            <Button variant="outline" nativeButton={false} render={<Link href="/about" />}>
              {t("philosophyCta")}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
