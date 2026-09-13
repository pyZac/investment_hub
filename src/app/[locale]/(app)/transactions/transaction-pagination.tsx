"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TransactionPagination({ page, totalPages }: { page: number; totalPages: number }) {
  const t = useTranslations("Transactions");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  if (totalPages <= 1) {
    return null;
  }

  function goToPage(target: number) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", String(target));
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  }

  return (
    <div className="flex flex-row items-center justify-between gap-2 border-t border-border/60 pt-4">
      <Button
        variant="outline"
        size="sm"
        className="cursor-pointer"
        disabled={page <= 1}
        onClick={() => goToPage(page - 1)}
      >
        <span className="flex flex-row items-center gap-1.5">
          <ChevronLeft className="size-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
          <span>{t("paginationPrevious")}</span>
        </span>
      </Button>
      <span className="text-sm text-muted-foreground">{t("paginationSummary", { page, totalPages })}</span>
      <Button
        variant="outline"
        size="sm"
        className="cursor-pointer"
        disabled={page >= totalPages}
        onClick={() => goToPage(page + 1)}
      >
        <span className="flex flex-row items-center gap-1.5">
          <span>{t("paginationNext")}</span>
          <ChevronRight className="size-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
        </span>
      </Button>
    </div>
  );
}
