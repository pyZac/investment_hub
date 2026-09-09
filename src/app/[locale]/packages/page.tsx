import { getTranslations } from "next-intl/server";
import { requireSessionOrRedirect } from "@/lib/page-guard";
import { listPurchasablePackages } from "@/lib/packages";
import { getWalletBalance } from "@/lib/wallets";
import { toDisplay } from "@/lib/display";
import { PackageGrid } from "./package-grid";

export default async function PackagesPage() {
  const t = await getTranslations("Packages");
  const user = await requireSessionOrRedirect(new Date());

  const [packages, walletB] = await Promise.all([
    listPurchasablePackages(),
    getWalletBalance(user.id, "B"),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8">
      <div className="space-y-8">
        <div className="space-y-4 border-b border-border/60 pb-6">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
          </div>
          <div className="inline-flex items-baseline gap-2 rounded-lg bg-muted/60 px-4 py-2.5">
            <span className="text-sm text-muted-foreground">{t("walletBBalance")}</span>
            <span className="text-lg font-semibold tabular-nums">{toDisplay(walletB)}</span>
          </div>
        </div>

        <PackageGrid
          packages={packages.map((p) => ({ id: p.id, name: p.name, amount: toDisplay(p.amount) }))}
          walletBBalance={toDisplay(walletB)}
        />
      </div>
    </div>
  );
}
