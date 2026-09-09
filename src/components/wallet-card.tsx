import type { ReactNode } from "react";
import { Wallet } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CountUp } from "@/components/count-up";

/**
 * A wallet's balance renders as a static formatted string — only the
 * `footer` slot (used for Wallet A's "today's profit" figure) uses the
 * animated `CountUp`. Animating every balance on every page load would be
 * noisy; the count-up is specifically meant to make the daily interest
 * engine's "money growing" effect visible, not to decorate every number.
 */
export function WalletCard({
  label,
  subLabel,
  amount,
  footer,
}: {
  label: string;
  subLabel: string;
  amount: string;
  footer?: ReactNode;
}) {
  return (
    <Card className="flex flex-col justify-between border-border/60 shadow-sm transition-shadow hover:shadow-md hover:shadow-black/20">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-medium">{label}</CardTitle>
          <p className="text-xs text-muted-foreground">{subLabel}</p>
        </div>
        <div className="flex size-8 items-center justify-center rounded-full bg-brand/10 text-brand">
          <Wallet className="size-4" />
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <p className="font-heading text-2xl font-semibold tabular-nums">${amount}</p>
      </CardContent>
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  );
}

export function TodayProfitFooter({
  amount,
  locale,
  label,
  noneLabel,
}: {
  amount: string;
  locale: string;
  label: string;
  noneLabel: string;
}) {
  const isZero = Number(amount) === 0;
  return (
    <div className="flex w-full items-baseline justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      {isZero ? (
        <span className="text-xs text-muted-foreground">{noneLabel}</span>
      ) : (
        <span dir="ltr" className="text-sm font-semibold tabular-nums text-success">
          +$<CountUp value={amount} locale={locale} />
        </span>
      )}
    </div>
  );
}
