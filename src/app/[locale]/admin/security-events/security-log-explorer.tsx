"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { SecurityLogSource } from "@/lib/security-log";
import { useTranslations, useLocale } from "next-intl";
import { ShieldAlert, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { formatDate } from "@/lib/display";
import {
  searchUsersAction,
  querySecurityLogAction,
  type UserOption,
  type SecurityLogRowInput,
  type SecurityLogFiltersInput,
} from "./actions";

const SOURCES: SecurityLogSource[] = ["SECURITY_EVENT", "ADMIN_ACTION"];
const ALL = "__all__";
const PAGE_SIZE = 50;

function UserFilterPicker({ value, onChange }: { value: UserOption | null; onChange: (user: UserOption | null) => void }) {
  const t = useTranslations("AdminSecurityEvents");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserOption[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      searchUsersAction(query).then((result) => {
        if (result.ok) setResults(result.users);
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (value) {
    return (
      <div className="space-y-1.5">
        <Label>{t("filterUserLabel")}</Label>
        <div className="flex flex-row items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-sm">
          <span>
            {value.name} <span className="text-muted-foreground">({value.email})</span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("clearUser")}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative space-y-1.5">
      <Label htmlFor="security-log-user-search">{t("filterUserLabel")}</Label>
      <Input
        id="security-log-user-search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t("userSearchPlaceholder")}
        autoComplete="off"
        className="w-full sm:w-56"
      />
      {open && query.trim().length > 0 && (
        <div className="absolute z-10 mt-1 w-64 max-h-56 overflow-y-auto rounded-lg border border-border/60 bg-popover shadow-md shadow-black/20">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t("userNoResults")}</p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onChange(r);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-start text-sm hover:bg-muted cursor-pointer"
              >
                <span className="font-medium">{r.name}</span>
                <span className="text-xs text-muted-foreground">{r.email}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function sourceLabel(t: ReturnType<typeof useTranslations>, value: string): string {
  if (value === "SECURITY_EVENT") return t("sourceSecurityEvent");
  if (value === "ADMIN_ACTION") return t("sourceAdminAction");
  return t("filterSourceAll");
}

export function SecurityLogExplorer() {
  const t = useTranslations("AdminSecurityEvents");
  const locale = useLocale();
  const [, startTransition] = useTransition();

  const [user, setUser] = useState<UserOption | null>(null);
  const [source, setSource] = useState<SecurityLogSource | undefined>(undefined);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<SecurityLogRowInput[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  function currentFilters(): SecurityLogFiltersInput {
    return {
      userId: user?.id,
      source,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    };
  }

  useEffect(() => {
    setLoading(true);
    setErrorKey(null);
    querySecurityLogAction(currentFilters(), page).then((result) => {
      if (result.ok) {
        setRows(result.rows);
        setTotal(result.total);
      } else {
        setErrorKey(result.errorKey);
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, source, dateFrom, dateTo, page]);

  function resetToFirstPage() {
    startTransition(() => setPage(1));
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasAnyFilter = Boolean(user || source || dateFrom || dateTo);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <UserFilterPicker
          value={user}
          onChange={(u) => {
            setUser(u);
            resetToFirstPage();
          }}
        />

        <div className="space-y-1.5">
          <Label>{t("filterSourceLabel")}</Label>
          <Select
            value={source ?? ALL}
            onValueChange={(value) => {
              setSource(value === ALL ? undefined : (value as SecurityLogSource));
              resetToFirstPage();
            }}
          >
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue>{(value: string) => sourceLabel(t, value)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filterSourceAll")}</SelectItem>
              {SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {sourceLabel(t, s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="security-log-date-from">{t("filterDateFromLabel")}</Label>
          <Input
            id="security-log-date-from"
            type="date"
            className="w-full sm:w-40"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              resetToFirstPage();
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="security-log-date-to">{t("filterDateToLabel")}</Label>
          <Input
            id="security-log-date-to"
            type="date"
            className="w-full sm:w-40"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              resetToFirstPage();
            }}
          />
        </div>

        {hasAnyFilter && (
          <Button
            variant="ghost"
            className="cursor-pointer"
            onClick={() => {
              setUser(null);
              setSource(undefined);
              setDateFrom("");
              setDateTo("");
              resetToFirstPage();
            }}
          >
            <span className="flex flex-row items-center gap-2">
              <X className="size-4 shrink-0" aria-hidden="true" />
              <span>{t("filterClear")}</span>
            </span>
          </Button>
        )}
      </div>

      {errorKey && <p className="text-sm text-destructive">{t(errorKey as "errorGeneric")}</p>}

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
            <ShieldAlert className="size-6" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("emptyStateTitle")}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t("emptyStateDescription")}</p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/40 text-start text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t("colDate")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("colSource")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("colType")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("colUser")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("colDetail")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {formatDate(new Date(row.createdAt), locale)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={row.source === "SECURITY_EVENT" ? "destructive" : "outline"}>
                      {sourceLabel(t, row.source)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-medium" dir="ltr">
                    {row.typeLabel}
                  </td>
                  <td className="px-3 py-2">{row.userLabel}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.detail ?? t("detailNone")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-row items-center justify-between gap-2 border-t border-border/60 pt-4">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
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
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <span className="flex flex-row items-center gap-1.5">
              <span>{t("paginationNext")}</span>
              <ChevronRight className="size-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}
