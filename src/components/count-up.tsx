"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animates a numeric display from 0 up to `value` over `durationMs`, then
 * locks to the exact formatted string. The animation only drives the
 * cosmetic in-between frames — every frame is produced by re-formatting a
 * plain JS number for display, never by doing arithmetic on the underlying
 * Decimal (which stays server-side as a string prop). The final frame always
 * renders `value` verbatim, so the animation can never leave a stale/rounded
 * digit behind once it settles.
 *
 * `value` must already be a 2dp display string (see `toDisplay`) — this
 * component only animates the reveal, it doesn't do money rounding.
 */
export function CountUp({
  value,
  locale,
  durationMs = 1200,
}: {
  value: string;
  locale: string;
  durationMs?: number;
}) {
  const target = Number(value);
  const [display, setDisplay] = useState(() => formatAmount(0, locale));
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setDisplay(value);
      return;
    }

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      setDisplay(formatAmount(target, locale));
      return;
    }

    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / durationMs, 1);
      // Ease-out cubic: fast start, settles gently rather than stopping abruptly.
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = target * eased;

      if (progress >= 1) {
        setDisplay(formatAmount(target, locale));
        return;
      }

      setDisplay(formatAmount(current, locale));
      frameRef.current = requestAnimationFrame(tick);
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the target value itself changes
  }, [value, locale, durationMs]);

  return <span className="tabular-nums">{display}</span>;
}

function formatAmount(value: number, locale: string): string {
  // -u-nu-latn forces Western Arabic numerals even under the "ar" locale
  // (see bilingual-rtl skill / display.ts's formatDate) — amounts must stay
  // unambiguous for audit and support in both locales.
  const numeralSafeLocale = locale === "ar" ? "ar-u-nu-latn" : locale;
  return new Intl.NumberFormat(numeralSafeLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
