"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchUsersAction } from "./actions";
import { UserDetailPanel } from "./user-detail-panel";

type UserRow = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  suspendedAt: string | null;
  currentRank: string | null;
};

export function UserList({
  initialUsers,
  initialTotal,
  pageSize,
  locale,
}: {
  initialUsers: UserRow[];
  initialTotal: number;
  pageSize: number;
  locale: string;
}) {
  const t = useTranslations("AdminUsers");
  const format = useFormatter();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState(initialUsers);
  const [total, setTotal] = useState(initialTotal);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const handle = setTimeout(() => {
      startTransition(async () => {
        const result = await searchUsersAction(query, page);
        if (result.ok) {
          setUsers(result.users);
          setTotal(result.total);
        }
      });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function refresh() {
    startTransition(async () => {
      const result = await searchUsersAction(query, page);
      if (result.ok) {
        setUsers(result.users);
        setTotal(result.total);
      }
    });
  }

  return (
    <div className="space-y-4">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(1);
        }}
        placeholder={t("searchPlaceholder")}
        className="max-w-sm"
      />

      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("listEmpty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40">
                <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colName")}</th>
                <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colEmail")}</th>
                <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colStatus")}</th>
                <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colJoined")}</th>
                <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colRank")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => setSelectedUserId(u.id)}
                  className="cursor-pointer border-b border-border/40 last:border-0 hover:bg-muted/40"
                >
                  <td className="px-3 py-2 font-medium">{u.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                  <td className="px-3 py-2">
                    <Badge variant={u.suspendedAt === null ? "success" : "destructive"}>
                      {u.suspendedAt === null ? t("statusActive") : t("statusSuspended")}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                    {format.dateTime(new Date(u.createdAt), { dateStyle: "medium" })}
                  </td>
                  <td className="px-3 py-2" dir="ltr">
                    {u.currentRank ?? t("rankUnranked")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-row items-center justify-between gap-3">
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            disabled={page <= 1 || isPending}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t("previousPage")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t("pageIndicator", { page, totalPages })}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            disabled={page >= totalPages || isPending}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            {t("nextPage")}
          </Button>
        </div>
      )}

      {selectedUserId && (
        <UserDetailPanel
          userId={selectedUserId}
          locale={locale}
          onClose={() => setSelectedUserId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
