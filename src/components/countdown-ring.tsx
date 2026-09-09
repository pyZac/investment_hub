/**
 * A circular progress indicator for a time-bound lock period (e.g. the 7-day
 * profit-start delay, the 6-month capital-unlock date). Pure SVG
 * (`stroke-dasharray`/`stroke-dashoffset`), colored via a Tailwind text-color
 * utility + `stroke="currentColor"` — never a hardcoded hex — per
 * design-system.md's color rule. `variant` follows the doc's existing
 * semantic mapping (never invent a second meaning for these):
 * - "active": still counting down — brand mint, the primary accent.
 * - "complete": the lock period has ended — success green.
 *
 * Presentational only — the caller computes `progress` (0–1) and the label;
 * this component has no knowledge of dates or business rules.
 */
export function CountdownRing({
  progress,
  label,
  sublabel,
  srDescription,
  variant,
  size = 88,
  strokeWidth = 7,
}: {
  /** 0 = just started, 1 = complete. Clamped internally. */
  progress: number;
  /** Short value shown in the ring's center, e.g. "4d" or "Live". */
  label: string;
  /** Small caption shown beneath the ring, e.g. "Profit start". */
  sublabel: string;
  /** Full sentence for screen readers — an arc's fill level isn't perceivable non-visually. */
  srDescription: string;
  variant: "active" | "complete";
  size?: number;
  strokeWidth?: number;
}) {
  const clamped = Math.min(1, Math.max(0, progress));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - clamped);
  const colorClass = variant === "complete" ? "text-success" : "text-brand";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted/60"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            className={colorClass}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-heading text-sm font-semibold tabular-nums ${colorClass}`}>
            {label}
          </span>
        </div>
        <span className="sr-only">{srDescription}</span>
      </div>
      <span className="text-xs text-muted-foreground">{sublabel}</span>
    </div>
  );
}
