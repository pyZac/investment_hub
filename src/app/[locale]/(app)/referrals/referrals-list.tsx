"use client";

import { useTranslations } from "next-intl";
import { Users } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/display";

type ReferralRow = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  suspendedAt: string | null;
  hasPurchased: boolean;
};

function statusBadgeVariant(referral: ReferralRow): "success" | "outline" | "destructive" {
  if (referral.suspendedAt) return "destructive";
  if (referral.hasPurchased) return "success";
  return "outline";
}

export function ReferralsList({ referrals, locale }: { referrals: ReferralRow[]; locale: string }) {
  const t = useTranslations("Referrals");

  if (referrals.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
          <Users className="size-6" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("referralsEmptyStateTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("referralsEmptyStateDescription")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {referrals.map((referral) => (
        <Card
          key={referral.id}
          className="flex flex-col justify-between border-border/60 shadow-sm transition-shadow hover:shadow-md hover:shadow-black/20"
        >
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base font-medium">{referral.name}</CardTitle>
            <Badge variant={statusBadgeVariant(referral)}>
              {referral.suspendedAt
                ? t("statusSuspended")
                : referral.hasPurchased
                  ? t("statusActive")
                  : t("statusNoPurchaseYet")}
            </Badge>
          </CardHeader>
          <CardContent className="flex-1 space-y-1">
            <p className="truncate text-sm text-muted-foreground">{referral.email}</p>
            <p className="text-xs text-muted-foreground">
              {t("joinedOn")}: {formatDate(new Date(referral.createdAt), locale)}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
