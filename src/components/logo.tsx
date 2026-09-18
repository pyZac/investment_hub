import { cn } from "@/lib/utils";

/**
 * Final logo mark, traced from the designer-delivered source files at
 * `docs/brand/investa-logo-mark.svg` (icon alone) and
 * `docs/brand/investa-logo-full.svg` (full lockup, used as the reference for
 * this mark's proportions within the lockup). Every component in the app
 * renders the logo through `LogoMark`/`LogoFull` exported from this file —
 * nobody else hand-codes the SVG path data. If the mark is ever revised
 * again, update this file plus the three static duplicates it has no choice
 * but to keep in sync for non-React contexts: `public/logo-mark.svg`,
 * `public/logo-full.svg`, `src/app/icon.svg`.
 */

/**
 * Cropped tight to the mark's actual glyph bounding box (traced via
 * `getBBox()` against the raw path data — full box was x:337.75 y:360.74
 * w:404.51 h:358.57 inside the original 0 0 1080 1080 canvas — plus ~6%
 * padding), not the full 1080x1080 artboard. The original viewBox left the
 * glyph occupying only ~37% of the box width, which read as tiny/unclear at
 * favicon and small nav-icon sizes. `src/app/icon.svg` and
 * `public/logo-mark.svg` use this same cropped viewBox — keep them in sync.
 */
const MARK_VIEWBOX = "313.48 336.47 453.06 407.11";

function LogoMarkSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Investa"
    >
      <defs>
        <linearGradient
          id="investaLegGradient"
          x1="635.22"
          y1="739.67"
          x2="503.38"
          y2="602.55"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#96F2C9" />
          <stop offset="0.28" stopColor="#6AD5AE" />
          <stop offset="1" stopColor="#289B88" />
        </linearGradient>
        <linearGradient
          id="investaLegGradientRight"
          x1="506.92"
          y1="391.95"
          x2="768.49"
          y2="722.08"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#96F2C9" />
          <stop offset="0.28" stopColor="#6AD5AE" />
          <stop offset="1" stopColor="#289B88" />
        </linearGradient>
        <linearGradient
          id="investaCrossbarGradient"
          x1="496.43"
          y1="420.34"
          x2="381.47"
          y2="751.53"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#96F2C9" />
          <stop offset="0.28" stopColor="#6AD5AE" />
          <stop offset="1" stopColor="#289B88" />
        </linearGradient>
        <linearGradient
          id="investaCrossbarFadeGradient"
          x1="429.28"
          y1="556.87"
          x2="562.18"
          y2="473.55"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#96F2C9" stopOpacity="0" />
          <stop offset="1" stopColor="#289B88" />
        </linearGradient>
      </defs>

      {/* Left leg: a folded ribbon running from bottom-left to the peak */}
      <path
        d="M632.72,719.3H571a19.09,19.09,0,0,1-17.23-10.85L533,665a16.78,16.78,0,0,0-15.13-9.53H476.31L502.39,601v0l4.33-9a20,20,0,0,1,18-11.36h22.83a29.77,29.77,0,0,1,26.86,16.93l27.74,58Z"
        fill="url(#investaLegGradient)"
      />
      {/* Right leg */}
      <path
        d="M734.08,719.3H685.16a18.77,18.77,0,0,1-16.95-10.67l-25.43-53.14-35.84-74.88-47.39-99L544.43,450s0,0,0-.06L540,440.74l-35.9-75a20.55,20.55,0,0,1,13.48-5h44.8A20.65,20.65,0,0,1,581,372.45q7.68,16.07,15.37,32.13,42.12,88,84.25,176l35.84,74.88,25,52.1A8.19,8.19,0,0,1,734.08,719.3Z"
        fill="url(#investaLegGradientRight)"
      />
      {/* Crossbar: a detached rounded ribbon piece with a stepped notch, not a plain bar */}
      <path
        d="M544.39,449.92a4.9,4.9,0,0,0-8.8.06L519.7,483.17l-36.86,77-9.78,20.45-35.84,74.88-25.43,53.14a18.77,18.77,0,0,1-17,10.67H345.92a8.19,8.19,0,0,1-7.37-11.71l25-52.1,35.84-74.88L446,483.15l36.86-77q8.07-16.85,16.13-33.71c0-.09.09-.15.13-.24a19.94,19.94,0,0,1,5-6.48l35.9,75Z"
        fill="url(#investaCrossbarGradient)"
      />
      {/* Soft fade overlay on the crossbar, matching the source artwork's shading */}
      <path
        d="M544.39,449.92a4.9,4.9,0,0,0-8.8.06L519.7,483.17l-36.86,77-9.78,20.45-35.84,74.88-25.43,53.14a18.77,18.77,0,0,1-17,10.67H345.92a8.19,8.19,0,0,1-7.37-11.71l25-52.1,35.84-74.88L446,483.15l36.86-77q8.07-16.85,16.13-33.71c0-.09.09-.15.13-.24a19.94,19.94,0,0,1,5-6.48l35.9,75Z"
        fill="url(#investaCrossbarFadeGradient)"
      />
    </svg>
  );
}

/** The "A" mark alone — nav-bar icon, favicon, loading spinner. No wordmark or tagline. */
export function LogoMark({ className }: { className?: string }) {
  return <LogoMarkSvg className={cn("h-8 w-8", className)} />;
}

/**
 * Mark + wordmark + tagline lockup — sidebar header, login page, email/print
 * contexts. Pass `tagline={false}` for a shorter mark+wordmark-only variant
 * (e.g. a cramped header); the full lockup with tagline is the default.
 *
 * The tagline text itself is caller-supplied (`taglineText`), not hardcoded
 * here — "SMART INVESTMENTS • REAL WEALTH" is marketing copy, not a brand
 * name like "INVESTA", so it must go through next-intl at the call site.
 * This component stays a plain Server Component with no i18n dependency of
 * its own; passing no `taglineText` while `tagline` is true simply renders
 * no tagline line (used by non-localized scaffolding contexts).
 */
const LOGO_FULL_MARK_SIZE = {
  default: "h-16 w-16",
  lg: "h-24 w-24",
} as const;

const LOGO_FULL_WORDMARK_SIZE = {
  default: "text-xl",
  lg: "text-3xl",
} as const;

export function LogoFull({
  className,
  tagline = true,
  taglineText,
  size = "default",
}: {
  className?: string;
  tagline?: boolean;
  taglineText?: string;
  /** `"lg"` weights the mark to sit properly beside the wordmark on standalone
   * full-lockup contexts like the login page; `"default"` suits cramped
   * headers/sidebars where the lockup sits alongside other UI. */
  size?: keyof typeof LOGO_FULL_MARK_SIZE;
}) {
  return (
    <div dir="ltr" className={cn("flex items-center gap-3", className)}>
      <LogoMarkSvg className={cn(LOGO_FULL_MARK_SIZE[size], "shrink-0")} />
      <div className="flex flex-col justify-center">
        <span
          className={cn(
            "font-heading leading-none font-semibold tracking-[0.15em] text-brand",
            LOGO_FULL_WORDMARK_SIZE[size],
          )}
        >
          INVESTA
        </span>
        {tagline && taglineText ? (
          <span className="mt-1.5 text-[10px] leading-none font-medium tracking-[0.18em] text-brand-muted">
            {taglineText}
          </span>
        ) : null}
      </div>
    </div>
  );
}
