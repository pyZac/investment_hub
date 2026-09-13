"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { editRankConfigAction, type RankActionErrorKey } from "./actions";
import type { RankRow } from "./rank-list";

export function EditRankDialog({
  rank,
  locale,
  onClose,
  onSaved,
}: {
  rank: RankRow;
  locale: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("AdminRankConfig");
  const [mrvRequired, setMrvRequired] = useState(rank.mrvRequired);
  const [directReferralsRequired, setDirectReferralsRequired] = useState(String(rank.directReferralsRequired));
  const [rewardAmount, setRewardAmount] = useState(rank.rewardAmount);
  const [errorKey, setErrorKey] = useState<RankActionErrorKey | null>(null);
  const [isPending, startTransition] = useTransition();

  const locked = rank.achievedByAnyUser;

  function submit() {
    setErrorKey(null);
    startTransition(async () => {
      const result = await editRankConfigAction(rank.rankName, mrvRequired, directReferralsRequired, rewardAmount, locale);
      if (result.ok) {
        onSaved();
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editTitle", { rankName: rank.rankName })}</DialogTitle>
          <DialogDescription>{t("editDescription")}</DialogDescription>
        </DialogHeader>

        {locked && (
          <p role="alert" className="text-sm font-medium text-warning">
            {t("editLockedNotice")}
          </p>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-rank-mrv">{t("mrvRequiredLabel")}</Label>
            <Input
              id="edit-rank-mrv"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={mrvRequired}
              onChange={(e) => setMrvRequired(e.target.value)}
              disabled={locked}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-rank-referrals">{t("referralsRequiredLabel")}</Label>
            <Input
              id="edit-rank-referrals"
              type="number"
              inputMode="numeric"
              min={1}
              step="1"
              value={directReferralsRequired}
              onChange={(e) => setDirectReferralsRequired(e.target.value)}
              disabled={locked}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-rank-reward">{t("rewardAmountLabel")}</Label>
            <Input
              id="edit-rank-reward"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={rewardAmount}
              onChange={(e) => setRewardAmount(e.target.value)}
              disabled={locked}
            />
          </div>
        </div>

        {errorKey && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {t(errorKey)}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button className="cursor-pointer" disabled={locked || isPending} onClick={submit}>
            {isPending ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
