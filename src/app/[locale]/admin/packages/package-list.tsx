"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  listPackagesAction,
  deactivatePackageAction,
  reactivatePackageAction,
  type PackageActionErrorKey,
} from "./actions";
import { EditPackageDialog } from "./edit-package-dialog";

type PackageRow = {
  id: string;
  name: string;
  amount: string;
  isActive: boolean;
  investmentCount: number;
};

export function PackageList({ initialPackages, locale }: { initialPackages: PackageRow[]; locale: string }) {
  const t = useTranslations("AdminPackages");
  const [packages, setPackages] = useState(initialPackages);
  const [editTarget, setEditTarget] = useState<PackageRow | null>(null);
  const [errorKey, setErrorKey] = useState<PackageActionErrorKey | null>(null);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      const result = await listPackagesAction();
      if (result.ok) {
        setPackages(result.packages);
      }
    });
  }

  function handleToggle(pkg: PackageRow) {
    setErrorKey(null);
    startTransition(async () => {
      const result = pkg.isActive
        ? await deactivatePackageAction(pkg.id, locale)
        : await reactivatePackageAction(pkg.id, locale);
      if (result.ok) {
        refresh();
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  if (packages.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("listEmpty")}</p>;
  }

  return (
    <>
      {errorKey && (
        <p role="alert" className="mb-3 text-sm font-medium text-destructive">
          {t(errorKey)}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/40">
              <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colName")}</th>
              <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colAmount")}</th>
              <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colStatus")}</th>
              <th className="px-3 py-2 text-end font-medium text-muted-foreground">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((pkg) => (
              <tr key={pkg.id} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">{pkg.name}</div>
                  {pkg.investmentCount > 0 && (
                    <div className="mt-0.5 flex flex-row items-center gap-1.5 text-xs text-muted-foreground">
                      <Lock className="size-3 shrink-0" aria-hidden="true" />
                      <span>{t("editLockedNotice", { count: pkg.investmentCount })}</span>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 font-heading font-semibold tabular-nums" dir="ltr">
                  {pkg.amount}
                </td>
                <td className="px-3 py-2">
                  <Badge variant={pkg.isActive ? "success" : "destructive"}>
                    {pkg.isActive ? t("statusActive") : t("statusInactive")}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-row justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="cursor-pointer"
                      disabled={pkg.investmentCount > 0}
                      onClick={() => setEditTarget(pkg)}
                    >
                      {t("edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant={pkg.isActive ? "destructive" : "secondary"}
                      className="cursor-pointer"
                      disabled={isPending}
                      onClick={() => handleToggle(pkg)}
                    >
                      {pkg.isActive ? t("deactivate") : t("reactivate")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editTarget && (
        <EditPackageDialog
          pkg={editTarget}
          locale={locale}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
