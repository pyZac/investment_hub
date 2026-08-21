"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function ReferralCodeCard({ code }: { code: string }) {
  const t = useTranslations("Referrals");
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 space-y-1">
          <p className="text-sm text-muted-foreground">{t("referralCodeLabel")}</p>
          <p className="break-all font-mono text-sm font-medium tabular-nums">{code}</p>
        </div>
        <Button variant="outline" className="cursor-pointer shrink-0" onClick={handleCopy}>
          <span className="flex flex-row items-center gap-2">
            {copied ? (
              <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500" aria-hidden="true" />
            ) : (
              <Copy className="size-4 shrink-0" aria-hidden="true" />
            )}
            <span>{copied ? t("copied") : t("copyCode")}</span>
          </span>
        </Button>
      </CardContent>
    </Card>
  );
}
