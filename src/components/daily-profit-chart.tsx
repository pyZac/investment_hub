"use client";

import { useLocale } from "next-intl";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Curve,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type CurveProps,
} from "recharts";
import type { DailyProfitPoint } from "@/lib/daily-profit-series";

/**
 * Recharts' default `Area` shape (`AreaRevealShape`) wraps the curve in a
 * left-to-right entrance-animation clip-path even when `isAnimationActive`
 * is false — confirmed by reading Recharts 3.10's source
 * (`cartesian/AreaRevealShape.js`): with a `null`-gapped, multi-segment
 * series (exactly this chart's Friday gaps), its clip-rect width is computed
 * from only the first rendered segment's point range, silently clipping
 * every later segment to nothing. This chart doesn't want an entrance
 * animation regardless (the count-up in SCRUM-91 is the one deliberate
 * animation on this dashboard), so bypassing the reveal shape entirely with
 * a plain static curve sidesteps the bug rather than fighting it.
 */
function StaticAreaShape(props: CurveProps & { stroke?: string; fill?: string }) {
  const { stroke, fill, ...rest } = props;
  return (
    <>
      <Curve {...rest} stroke="none" fill={fill} className="recharts-area-area" />
      {stroke && stroke !== "none" ? (
        <Curve {...rest} stroke={stroke} fill="none" className="recharts-area-curve" />
      ) : null}
    </>
  );
}

/**
 * Resolved hex values for the design-system tokens this chart uses, not
 * `var(--color-*)` references. SVG presentation attributes (`stroke`,
 * `stop-color`, etc. passed as plain props, as Recharts does) do not
 * reliably resolve CSS custom properties the way an element's `style`
 * property does — confirmed empirically: the chart's path data rendered
 * correctly but was fully invisible because `stop-color="var(--color-chart-1)"`
 * never resolved. Keep these in sync with `globals.css`'s `--chart-1`,
 * `--border`, `--muted-foreground`, `--background` if the palette changes.
 */
const CHART_MINT = "#70c9aa";
const CHART_BORDER = "#203b37";
const CHART_MUTED_FOREGROUND = "#8d9b98";
const CHART_BACKGROUND = "#06201f";

/**
 * Recharts does not auto-mirror for RTL (see bilingual-rtl skill) — under
 * `dir="rtl"` the x-axis is explicitly reversed so the timeline still reads
 * in the page's natural reading direction (newest date nearest the trailing
 * edge, oldest nearest the leading edge, matching how every other
 * left-to-right-in-content-order list on this dashboard mirrors under RTL).
 */
export function DailyProfitChart({
  data,
  fridayLabel,
  todayLabel,
}: {
  data: DailyProfitPoint[];
  fridayLabel: string;
  todayLabel: string;
}) {
  const locale = useLocale();
  const isRtl = locale === "ar";
  const numeralSafeLocale = isRtl ? "ar-u-nu-latn" : locale;

  // `hitAmount` is a second, invisible series identical to `amount` except it
  // substitutes 0 for Fridays' null. Recharts' <Tooltip> only ever considers
  // itself to "have a payload" (and only then sets the wrapper's
  // `visibility: visible` — see TooltipBoundingBox.js) when at least one
  // series has a non-null value at the hovered x-position; with
  // `connectNulls={false}` a Friday's real `amount` point is always null, so
  // without this second series the tooltip would be permanently
  // undiscoverable on every Friday. `ProfitTooltip` below always reads the
  // real `amount`/`isFriday` fields for what it displays — `hitAmount` exists
  // purely to make Recharts consider the point hoverable, never to render
  // anything visible on its own.
  const chartData = data.map((point) => ({
    ...point,
    dayLabel: formatDayLabel(point.date, numeralSafeLocale),
    hitAmount: point.amount ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="dailyProfitFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_MINT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={CHART_MINT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={CHART_BORDER} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="dayLabel"
          reversed={isRtl}
          orientation={isRtl ? "top" : "bottom"}
          stroke={CHART_MUTED_FOREGROUND}
          tick={{ fill: CHART_MUTED_FOREGROUND, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          orientation={isRtl ? "right" : "left"}
          stroke={CHART_MUTED_FOREGROUND}
          tick={{ fill: CHART_MUTED_FOREGROUND, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(value: number) => formatAmount(value, numeralSafeLocale)}
        />
        <Tooltip
          content={
            <ProfitTooltip
              chartData={chartData}
              fridayLabel={fridayLabel}
              todayLabel={todayLabel}
              numeralSafeLocale={numeralSafeLocale}
              isRtl={isRtl}
            />
          }
        />
        {/* Invisible hit-testing series — see the `hitAmount` comment above. */}
        <Area
          type="monotone"
          dataKey="hitAmount"
          stroke="none"
          fill="none"
          isAnimationActive={false}
          dot={false}
          activeDot={false}
          legendType="none"
          tooltipType="none"
        />
        <Area
          type="monotone"
          dataKey="amount"
          stroke={CHART_MINT}
          strokeWidth={2}
          fill="url(#dailyProfitFill)"
          connectNulls={false}
          isAnimationActive={false}
          shape={StaticAreaShape}
          dot={false}
          activeDot={{ r: 4, fill: CHART_MINT, stroke: CHART_BACKGROUND, strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

type ChartDatum = DailyProfitPoint & { dayLabel: string; hitAmount: number };

function ProfitTooltip({
  active,
  label,
  payload,
  chartData,
  fridayLabel,
  todayLabel,
  numeralSafeLocale,
  isRtl,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ payload: ChartDatum }>;
  chartData: ChartDatum[];
  fridayLabel: string;
  todayLabel: string;
  numeralSafeLocale: string;
  isRtl: boolean;
}) {
  // Recharts omits a null-valued point (a Friday) from `payload` under
  // `connectNulls={false}` even while `active` is true and `label` still
  // identifies which x-axis category is being hovered — so the Friday
  // tooltip case is only reachable by falling back to a lookup against the
  // chart's own full dataset by `dayLabel`, not by trusting `payload` alone.
  const point = payload?.[0]?.payload ?? chartData.find((p) => p.dayLabel === label);
  if (!active || !point) {
    return null;
  }
  const isToday = point.date === new Date().toISOString().slice(0, 10);

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-md"
    >
      <p className="font-medium text-foreground">
        {point.dayLabel}
        {isToday ? ` · ${todayLabel}` : ""}
      </p>
      {point.isFriday ? (
        <p className="mt-0.5 text-muted-foreground">{fridayLabel}</p>
      ) : (
        <p dir="ltr" className="mt-0.5 font-semibold tabular-nums text-success">
          +${formatAmount(point.amount ?? 0, numeralSafeLocale)}
        </p>
      )}
    </div>
  );
}

function formatDayLabel(dateKey: string, numeralSafeLocale: string): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  return new Intl.DateTimeFormat(numeralSafeLocale, {
    timeZone: "Asia/Dubai",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatAmount(value: number, numeralSafeLocale: string): string {
  return new Intl.NumberFormat(numeralSafeLocale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}
