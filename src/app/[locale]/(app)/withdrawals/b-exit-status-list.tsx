"use client";

import { useTranslations } from "next-intl";
import { History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/display";

type WithdrawalRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

type StatusListRequest = {
  id: string;
  amount: string;
  status: WithdrawalRequestStatus;
  requestedAt: string;
  decidedAt: string | null;
  adminComment: string | null;
};

function statusBadgeVariant(status: WithdrawalRequestStatus): "success" | "warning" | "destructive" {
  if (status === "APPROVED") return "success";
  if (status === "REJECTED") return "destructive";
  return "warning";
}

export function BExitStatusList({ requests, locale }: { requests: StatusListRequest[]; locale: string }) {
  const t = useTranslations("Withdrawals");

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
          <History className="size-6" aria-hidden="true" />
        </div>
        <p className="max-w-sm text-sm text-muted-foreground">{t("bExitEmptyState")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <Card key={request.id} className="border-border/60 shadow-sm">
          <CardContent className="space-y-2 py-4">
            <div className="flex flex-row items-center justify-between gap-2">
              <span className="font-heading text-lg font-semibold tabular-nums" dir="ltr">
                {request.amount}
              </span>
              <Badge variant={statusBadgeVariant(request.status)}>
                {request.status === "PENDING" && t("statusPending")}
                {request.status === "APPROVED" && t("statusApproved")}
                {request.status === "REJECTED" && t("statusRejected")}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("requestedOn")}: {formatDate(new Date(request.requestedAt), locale)}
            </p>
            {request.decidedAt && (
              <p className="text-xs text-muted-foreground">
                {t("decidedOn")}: {formatDate(new Date(request.decidedAt), locale)}
              </p>
            )}
            {request.status === "REJECTED" && request.adminComment && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{request.adminComment}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
