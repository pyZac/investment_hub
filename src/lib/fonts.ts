import { Inter, Space_Grotesk } from "next/font/google";

/**
 * Body/data face. Inter has true tabular figures and is battle-tested for
 * dense financial UI (this project has money in nearly every view) — see
 * /docs/design-system.md "Typography" for the full pairing rationale.
 */
export const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

/**
 * Heading face. Geometric grotesk with an angular character that echoes the
 * Investa "A" wordmark — used for page/section titles only, never body text
 * or numerals (Inter's tabular-nums stays the single source of truth for
 * anything monetary).
 */
export const fontHeading = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});
