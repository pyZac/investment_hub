"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchUsersAction } from "./actions";

type UserOption = { id: string; name: string; email: string };

export function UserPicker({
  value,
  onChange,
}: {
  value: UserOption | null;
  onChange: (user: UserOption | null) => void;
}) {
  const t = useTranslations("AdminCredits");
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
        if (result.ok) {
          setResults(result.users);
        }
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
        <Label>{t("userLabel")}</Label>
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
      <Label htmlFor="credit-user-search">{t("userLabel")}</Label>
      <Input
        id="credit-user-search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t("userSearchPlaceholder")}
        autoComplete="off"
      />
      {open && query.trim().length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-border/60 bg-popover shadow-md shadow-black/20">
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
