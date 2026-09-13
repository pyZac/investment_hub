"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createRankConfigAction, type RankActionErrorKey } from "./actions";

export function AddRankForm({ locale }: { locale: string }) {
  const t = useTranslations("AdminRankConfig");
  const [rankName, setRankName] = useState("");
  const [mrvRequired, setMrvRequired] = useState("");
  const [directReferralsRequired, setDirectReferralsRequired] = useState("");
  const [rewardAmount, setRewardAmount] = useState("");
  const [rewardType, setRewardType] = useState<"CASH" | "CASH_OR_TRIP">("CASH");
  const [errorKey, setErrorKey] = useState<RankActionErrorKey | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);
    setSuccess(false);

    startTransition(async () => {
      const result = await createRankConfigAction(
        rankName,
        mrvRequired,
        directReferralsRequired,
        rewardAmount,
        rewardType,
        locale,
      );
      if (result.ok) {
        setSuccess(true);
        setRankName("");
        setMrvRequired("");
        setDirectReferralsRequired("");
        setRewardAmount("");
        setRewardType("CASH");
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("addAboveTopNotice")}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="add-rank-name">{t("rankNameLabel")}</Label>
          <Input id="add-rank-name" value={rankName} onChange={(e) => setRankName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-rank-mrv">{t("mrvRequiredLabel")}</Label>
          <Input
            id="add-rank-mrv"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={mrvRequired}
            onChange={(e) => setMrvRequired(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-rank-referrals">{t("referralsRequiredLabel")}</Label>
          <Input
            id="add-rank-referrals"
            type="number"
            inputMode="numeric"
            min={1}
            step="1"
            value={directReferralsRequired}
            onChange={(e) => setDirectReferralsRequired(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-rank-reward">{t("rewardAmountLabel")}</Label>
          <Input
            id="add-rank-reward"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={rewardAmount}
            onChange={(e) => setRewardAmount(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-rank-reward-type">{t("rewardTypeLabel")}</Label>
          <Select value={rewardType} onValueChange={(v) => setRewardType(v as "CASH" | "CASH_OR_TRIP")}>
            <SelectTrigger id="add-rank-reward-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CASH">{t("rewardTypeCash")}</SelectItem>
              <SelectItem value="CASH_OR_TRIP">{t("rewardTypeCashOrTrip")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {errorKey && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t(errorKey)}
        </p>
      )}
      {success && (
        <p className="flex flex-row items-center gap-2 text-sm font-medium text-success">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          <span>{t("addSuccess")}</span>
        </p>
      )}

      <Button type="submit" disabled={isPending} className="cursor-pointer">
        {isPending ? t("adding") : t("addSubmit")}
      </Button>
    </form>
  );
}
