import { prisma } from "./prisma";
import { toRow, EXPORT_ROW_LIMIT, type LedgerExplorerRow } from "./ledger-explorer";
import { toDisplay } from "./display";

/**
 * Ownership/permission gate for a per-user statement export (SCRUM-118):
 * a user may always export their own statement; an admin may export any
 * user's, gated by the same LEDGER_VIEW permission as the admin ledger
 * explorer (invariant #8 — main admin bypasses, sub-admins need the grant).
 * Never trusts `targetUserId` alone (invariant #9) — self-access is an
 * identity check, not a permission check, so a plain user with no admin
 * role at all can still export their own statement.
 */
async function assertCanExportStatement(actingUserId: string, targetUserId: string): Promise<void> {
  if (actingUserId === targetUserId) {
    return;
  }

  const actor = await prisma.user.findUnique({ where: { id: actingUserId } });
  if (!actor || actor.role !== "ADMIN") {
    throw new Error("Forbidden: cannot export another user's statement.");
  }
  if (actor.isMainAdmin) {
    return;
  }
  const grant = await prisma.adminPermissionGrant.findUnique({
    where: { adminUserId_permission: { adminUserId: actingUserId, permission: "LEDGER_VIEW" } },
  });
  if (!grant) {
    throw new Error("Forbidden: missing LEDGER_VIEW permission.");
  }
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const CSV_HEADER = ["Date", "User", "Wallet", "Entry Type", "Direction", "Amount", "Comment"];

/**
 * Renders a statement's rows as CSV, formatting amounts at 2 decimal places
 * (round-half-up via `toDisplay`) rather than the ledger's full 8dp storage
 * precision — a user-facing statement is a display artifact, per CLAUDE.md's
 * display-precision convention, unlike the admin ledger explorer's own CSV
 * export (`rowsToCsv` in ledger-explorer.ts), which intentionally keeps raw
 * ledger precision for audit purposes and is left unchanged by this ticket.
 * Amounts are already plain ASCII digits (`toDisplay` uses `toFixed`), so
 * Western Arabic numerals hold with no extra formatting needed.
 */
function rowsToStatementCsv(rows: LedgerExplorerRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.createdAt.toISOString(),
        row.userLabel,
        row.walletLabel,
        row.entryTypeLabel,
        row.direction,
        toDisplay(row.amount),
        row.comment ?? "",
      ]
        .map((v) => csvEscape(String(v)))
        .join(","),
    );
  }
  return lines.join("\n");
}

/**
 * Exports a user's full ledger history as CSV text (SCRUM-118). Reuses the
 * same row-shaping (`toRow`) the admin ledger explorer uses internally, so
 * "user label"/"wallet label"/"entry type label" never drift between the
 * two screens — only the CSV amount formatting differs (2dp here vs. raw
 * 8dp there). Always scoped to `userId = targetUserId`, so the paired
 * SYSTEM_EXTERNAL row of any transaction (userId null) is structurally
 * excluded — a user's own statement never surfaces the platform-reserve
 * counterparty side.
 */
export async function exportStatementCsvForUser(actingUserId: string, targetUserId: string): Promise<string> {
  await assertCanExportStatement(actingUserId, targetUserId);

  const entries = await prisma.ledgerEntry.findMany({
    where: { userId: targetUserId },
    orderBy: { createdAt: "desc" },
    take: EXPORT_ROW_LIMIT,
    include: { user: { select: { name: true } } },
  });

  return rowsToStatementCsv(entries.map(toRow));
}
