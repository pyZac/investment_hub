"use client";

import { useState, type ReactNode } from "react";
import { MenuIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Full-screen mobile nav overlay shared by the admin sidebar and the user
 * dashboard header. Reuses the existing Dialog primitive (already
 * RTL-correct via logical `end-*` positioning) instead of a new drawer
 * primitive. `title` is required by DialogTitle for a11y; visually hidden
 * pages can still pass a plain string like the app name.
 */
export function MobileNavSheet({
  title,
  triggerLabel,
  children,
}: {
  title: string;
  triggerLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={triggerLabel}
        onClick={() => setOpen(true)}
        className="min-h-11 min-w-11 lg:hidden"
      >
        <MenuIcon />
      </Button>
      <DialogContent
        showCloseButton
        className="inset-0 grid-rows-[auto_1fr] h-full max-h-full w-full max-w-full translate-x-0 translate-y-0 rounded-none sm:max-w-full"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div
          onClick={() => setOpen(false)}
          className="flex min-h-0 flex-col gap-1 overflow-y-auto"
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
