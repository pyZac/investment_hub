"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A password `<Input>` with a show/hide toggle. Every password field in the
 * app should use this instead of a raw `<Input type="password">` — see
 * CLAUDE.md's mobile-first/shared-component convention note.
 *
 * The toggle button uses logical `end-*` positioning (not `right-*`), same
 * rule as the Dialog close button — mirrors correctly under `dir="rtl"` with
 * no extra code (see lessons.md's RTL absolutely-positioned-corner-element
 * entry).
 */
export function PasswordInput({
  className,
  toggleLabel,
  ...props
}: React.ComponentProps<typeof Input> & {
  /** aria-label for the show/hide button — must be translated by the caller. */
  toggleLabel: { show: string; hide: string };
}) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        className={cn("pe-10", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? toggleLabel.hide : toggleLabel.show}
        className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
