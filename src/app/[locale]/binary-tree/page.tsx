import { getTranslations, getLocale } from "next-intl/server";
import { requireSession } from "@/lib/route-guard";
import { getMySubtree } from "@/lib/binary-tree";
import { BinaryTreeView } from "./binary-tree-view";

const MAX_DEPTH = 5;

export default async function BinaryTreePage() {
  const t = await getTranslations("BinaryTree");
  const locale = await getLocale();
  const user = await requireSession(new Date());

  const subtree = await getMySubtree(user.id, MAX_DEPTH);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8">
      <div className="space-y-10">
        <div className="space-y-1.5 border-b border-border/60 pb-6">
          <h1 className="text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
        </div>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">{t("treeHeading")}</h2>
            <p className="text-sm text-muted-foreground">{t("treeDescription")}</p>
          </div>
          <BinaryTreeView subtree={subtree} locale={locale} />
        </section>
      </div>
    </div>
  );
}
