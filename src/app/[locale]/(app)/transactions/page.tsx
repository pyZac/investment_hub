import type { LedgerEntryType, Wallet } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { requireSessionOrRedirect } from "@/lib/page-guard";
import { listLedgerEntriesForUser, PAGE_SIZE } from "@/lib/transaction-history";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TransactionFilters } from "./transaction-filters";
import { TransactionList } from "./transaction-list";
import { TransactionPagination } from "./transaction-pagination";
import { ExportStatementButton } from "./export-statement-button";

const VALID_WALLETS: Wallet[] = ["A", "B", "C", "SAVING"];
const VALID_ENTRY_TYPES: LedgerEntryType[] = [
  "ADMIN_CREDIT",
  "PACKAGE_PURCHASE",
  "DAILY_INTEREST",
  "DIRECT_COMMISSION",
  "DIRECT_SAVING",
  "BINARY_COMMISSION",
  "RANK_REWARD",
  "WITHDRAWAL_OUT",
  "WITHDRAWAL_IN",
  "CAPITAL_RELEASE",
  "SAVING_UNLOCK",
  "ADMIN_ADJUSTMENT",
  "USER_TRANSFER_SENT",
  "USER_TRANSFER_RECEIVED",
];

function parseWallet(raw: string | undefined): Wallet | undefined {
  return raw && VALID_WALLETS.includes(raw as Wallet) ? (raw as Wallet) : undefined;
}

function parseEntryType(raw: string | undefined): LedgerEntryType | undefined {
  return raw && VALID_ENTRY_TYPES.includes(raw as LedgerEntryType) ? (raw as LedgerEntryType) : undefined;
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ wallet?: string; type?: string; from?: string; to?: string; page?: string }>;
}) {
  const t = await getTranslations("Transactions");
  const user = await requireSessionOrRedirect(new Date());
  const params = await searchParams;

  const filters = {
    wallet: parseWallet(params.wallet),
    entryType: parseEntryType(params.type),
    dateFrom: parseDate(params.from),
    dateTo: parseDate(params.to),
  };
  const page = Math.max(1, Number(params.page) || 1);

  const result = await listLedgerEntriesForUser(user.id, filters, page);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-border/60 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
        </div>
        <ExportStatementButton />
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("listHeading")}</CardTitle>
          <CardDescription>{t("listDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <TransactionFilters
            wallet={params.wallet}
            entryType={params.type}
            dateFrom={params.from}
            dateTo={params.to}
          />
          <TransactionList
            entries={result.entries.map((e) => ({
              id: e.id,
              wallet: e.wallet,
              direction: e.direction,
              amount: e.amount,
              entryType: e.entryType,
              description: e.description,
              createdAt: e.createdAt.toISOString(),
            }))}
          />
          <TransactionPagination page={page} totalPages={totalPages} />
        </CardContent>
      </Card>
    </div>
  );
}
