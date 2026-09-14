"use server";

import { requireSession } from "@/lib/route-guard";
import { exportStatementCsvForUser } from "@/lib/statement";

export type ExportStatementErrorKey = "errorForbidden" | "errorGeneric";

function mapError(err: unknown): ExportStatementErrorKey {
  if (err instanceof Error && /forbidden/i.test(err.message)) return "errorForbidden";
  return "errorGeneric";
}

export type ExportStatementResult = { ok: true; csv: string } | { ok: false; errorKey: ExportStatementErrorKey };

/**
 * Exports the calling user's own full ledger history as CSV (SCRUM-118).
 * `exportStatementCsvForUser` itself re-verifies ownership (invariant #9) —
 * this action always passes the caller's own id as both actor and target,
 * so a self-export never depends on a client-supplied user id.
 */
export async function exportMyStatementAction(): Promise<ExportStatementResult> {
  try {
    const user = await requireSession(new Date());
    const csv = await exportStatementCsvForUser(user.id, user.id);
    return { ok: true, csv };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
