import type { ReactNode } from "react";
import { PublicHeader } from "@/components/public/public-header";
import { PublicFooter } from "@/components/public/public-footer";

/**
 * Shared chrome for every public (pre-login) page: Home, About, How We
 * Invest, Sectors. A separate route group from `(app)` (the authenticated
 * dashboard) and `admin` — each owns its own header/footer and none of the
 * three ever leak into each other, same pattern `(app)/layout.tsx`'s own
 * comment documents for why it was split out from the root locale layout.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
