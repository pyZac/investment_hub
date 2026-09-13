import { ArrowDownRight, ArrowUpRight, TrendingUp, Wallet } from "lucide-react";

import { LogoFull, LogoMark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const SPARKLINE_POINTS = "0,32 12,29 24,30 36,22 48,24 60,15 72,17 84,9 96,11 108,3";

/**
 * SCRUM-90 design-system preview only — not a real dashboard screen.
 * Demonstrates the tokens/typography/logo from /docs/design-system.md against
 * representative components before they're used across Phase 10 screens.
 */
export default function DesignPreviewPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-12 px-6 py-10 lg:px-8">
      <header className="space-y-1">
        <p className="text-sm font-medium text-brand">Investa design system</p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          SCRUM-90 preview
        </h1>
        <p className="text-sm text-muted-foreground">
          Wallet card, button states, sparkline, and logo lockups rendered against the
          real Tailwind tokens — nothing here is a mock.
        </p>
      </header>

      {/* Logo lockups */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Logo</h2>
        <div className="flex flex-wrap items-center gap-8 rounded-2xl border border-border/60 bg-card p-6">
          <div className="flex flex-col items-start gap-2">
            <span className="text-xs text-muted-foreground">Nav-bar size (mark only)</span>
            <div className="flex h-10 items-center rounded-lg bg-background px-3">
              <LogoMark className="h-6 w-6" />
            </div>
          </div>
          <div className="flex flex-col items-start gap-2">
            <span className="text-xs text-muted-foreground">Favicon size (16 / 32px)</span>
            <div className="flex items-center gap-3 rounded-lg bg-background px-3 py-2">
              <LogoMark className="h-4 w-4" />
              <LogoMark className="h-8 w-8" />
            </div>
          </div>
          <div className="flex flex-col items-start gap-2">
            <span className="text-xs text-muted-foreground">Full lockup</span>
            <div className="flex items-center rounded-lg bg-background px-3 py-2">
              <LogoFull />
            </div>
          </div>
        </div>
      </section>

      {/* Wallet cards */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Wallet cards</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <WalletCard
            label="Wallet A"
            sublabel="Profit &amp; commissions"
            amount="4,218.36"
            deltaLabel="+42.10 today"
            deltaPositive
          />
          <WalletCard
            label="Wallet B"
            sublabel="Capital"
            amount="12,000.00"
            deltaLabel="Locked 4mo left"
            neutral
          />
          <WalletCard
            label="Wallet C"
            sublabel="Withdrawable"
            amount="1,340.90"
            deltaLabel="-250.00 pending"
            deltaPositive={false}
          />
          <WalletCard
            label="Saving"
            sublabel="Saving lots"
            amount="860.00"
            deltaLabel="+3.20 today"
            deltaPositive
          />
        </div>
      </section>

      {/* Chart snippet */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Profit accrual (snippet)</h2>
        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base font-medium">Daily accrual — 10 days</CardTitle>
              <p className="text-sm text-muted-foreground">Wallet A, last 10 business days</p>
            </div>
            <Badge variant="success" className="gap-1">
              <TrendingUp className="size-3" />
              +8.4%
            </Badge>
          </CardHeader>
          <CardContent>
            <svg viewBox="0 0 108 40" className="h-24 w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="sparklineFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polyline
                points={`${SPARKLINE_POINTS} 108,40 0,40`}
                fill="url(#sparklineFill)"
                stroke="none"
              />
              <polyline
                points={SPARKLINE_POINTS}
                fill="none"
                stroke="var(--color-brand)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </CardContent>
        </Card>
      </section>

      {/* Buttons */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Buttons &amp; states</h2>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-card p-6">
          <Button>Primary action</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Withdraw &amp; close</Button>
          <Button disabled>Disabled</Button>
          <Button variant="link">Link style</Button>
        </div>
      </section>
    </div>
  );
}

function WalletCard({
  label,
  sublabel,
  amount,
  deltaLabel,
  deltaPositive,
  neutral,
}: {
  label: string;
  sublabel: string;
  amount: string;
  deltaLabel: string;
  deltaPositive?: boolean;
  neutral?: boolean;
}) {
  const DeltaIcon = deltaPositive ? ArrowUpRight : ArrowDownRight;
  return (
    <Card className="flex flex-col justify-between border-border/60 shadow-sm transition-shadow hover:shadow-md hover:shadow-black/20">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-medium">{label}</CardTitle>
          <p className="text-xs text-muted-foreground">{sublabel}</p>
        </div>
        <div className="flex size-8 items-center justify-center rounded-full bg-brand/10 text-brand">
          <Wallet className="size-4" />
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <p className="font-heading text-2xl font-semibold tabular-nums">${amount}</p>
      </CardContent>
      <CardFooter>
        {neutral ? (
          <Badge variant="outline">{deltaLabel}</Badge>
        ) : (
          <Badge variant={deltaPositive ? "success" : "destructive"} className="gap-1">
            <DeltaIcon className="size-3" />
            {deltaLabel}
          </Badge>
        )}
      </CardFooter>
    </Card>
  );
}
