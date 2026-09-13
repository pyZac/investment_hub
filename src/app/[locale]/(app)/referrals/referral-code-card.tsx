"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button variant="outline" className="cursor-pointer shrink-0" onClick={handleCopy}>
      <span className="flex flex-row items-center gap-2">
        {copied ? (
          <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <Copy className="size-4 shrink-0" aria-hidden="true" />
        )}
        <span>{copied ? copiedLabel : label}</span>
      </span>
    </Button>
  );
}

export function ReferralCodeCard({
  code,
  link,
  qrCodeDataUrl,
}: {
  code: string;
  link: string;
  qrCodeDataUrl: string;
}) {
  const t = useTranslations("Referrals");

  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
      {/* eslint-disable-next-line @next/next/no-img-element -- server-generated data: URI, not an optimizable remote/static asset */}
      <img
        src={qrCodeDataUrl}
        alt={t("qrCodeAlt")}
        width={144}
        height={144}
        className="size-36 shrink-0 rounded-lg ring-1 ring-foreground/10"
      />
      <div className="flex-1 space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{t("referralLinkLabel")}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="flex-1 truncate rounded-lg bg-muted/60 px-3 py-2 font-mono text-sm">{link}</p>
            <CopyButton value={link} label={t("copyLink")} copiedLabel={t("copied")} />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{t("referralCodeLabel")}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="flex-1 truncate rounded-lg bg-muted/60 px-3 py-2 font-mono text-sm tabular-nums">
              {code}
            </p>
            <CopyButton value={code} label={t("copyCode")} copiedLabel={t("copied")} />
          </div>
        </div>
      </div>
    </div>
  );
}
