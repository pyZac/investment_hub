"use server";

import { requirePermission } from "@/lib/route-guard";
import { searchUsers } from "@/lib/user-management";
import { querySecurityLog, type SecurityLogFilters, type SecurityLogSource } from "@/lib/security-log";

export type SecurityLogErrorKey = "errorForbidden" | "errorGeneric";

function mapError(err: unknown): SecurityLogErrorKey {
  if (err instanceof Error && /forbidden/i.test(err.message)) return "errorForbidden";
  return "errorGeneric";
}

export type UserOption = { id: string; name: string; email: string };
export type SearchUsersResult = { ok: true; users: UserOption[] } | { ok: false; errorKey: SecurityLogErrorKey };

/**
 * Backs the security log's user filter picker — same pattern as the admin
 * ledger explorer's identical picker (searchUsers itself accepts any of
 * several admin permissions; this route's own requirePermission call below
 * is the real SECURITY_VIEW enforcement point, per invariant #8).
 */
export async function searchUsersAction(query: string): Promise<SearchUsersResult> {
  try {
    const actor = await requirePermission("SECURITY_VIEW", new Date());
    const result = await searchUsers(actor.id, { query });
    return { ok: true, users: result.users.map((u) => ({ id: u.id, name: u.name, email: u.email })) };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type SecurityLogRowInput = {
  id: string;
  source: SecurityLogSource;
  createdAt: string;
  typeLabel: string;
  userLabel: string;
  actorLabel: string | null;
  detail: string | null;
};

export type SecurityLogFiltersInput = {
  source?: SecurityLogSource;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
};

function toFilters(input: SecurityLogFiltersInput): SecurityLogFilters {
  return {
    source: input.source || undefined,
    userId: input.userId || undefined,
    dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
    dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
  };
}

export type QuerySecurityLogResult =
  | { ok: true; rows: SecurityLogRowInput[]; total: number }
  | { ok: false; errorKey: SecurityLogErrorKey };

export async function querySecurityLogAction(
  filters: SecurityLogFiltersInput,
  page: number,
): Promise<QuerySecurityLogResult> {
  try {
    const actor = await requirePermission("SECURITY_VIEW", new Date());
    const result = await querySecurityLog(actor.id, toFilters(filters), page);
    return {
      ok: true,
      total: result.total,
      rows: result.rows.map((r) => ({
        id: r.id,
        source: r.source,
        createdAt: r.createdAt.toISOString(),
        typeLabel: r.typeLabel,
        userLabel: r.userLabel,
        actorLabel: r.actorLabel,
        detail: r.detail,
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
