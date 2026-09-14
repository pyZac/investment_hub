"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportMyStatementAction } from "./actions";

function triggerCsvDownload(csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `statement-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ExportStatementButton() {
  const t = useTranslations("Transactions");
  const [exporting, setExporting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    setErrorKey(null);
    const result = await exportMyStatementAction();
    setExporting(false);
    if (result.ok) {
      triggerCsvDownload(result.csv);
    } else {
      setErrorKey(result.errorKey);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button variant="outline" className="cursor-pointer" disabled={exporting} onClick={handleExport}>
        <span className="flex flex-row items-center gap-2">
          <Download className="size-4 shrink-0" aria-hidden="true" />
          <span>{exporting ? t("exportPending") : t("exportStatement")}</span>
        </span>
      </Button>
      {errorKey && <p className="text-sm text-destructive">{t(errorKey as "errorForbidden" | "errorGeneric")}</p>}
    </div>
  );
}
