# Investa Design System

Reference doc for every Phase 10 (and later) UI screen. This is infrastructure,
not a page — read this before styling anything, the same way you'd read the
`frontend-design` skill. Tokens live in [`src/app/globals.css`](../src/app/globals.css);
this doc explains what they mean and how to use them correctly.

## Why dark mode only

No light variant exists, and none is planned. Three reasons:

1. **Positioning.** Deep teal + mint reads as premium fintech (Trading 212,
   Robinhood-adjacent apps skew dark for exactly this reason) — a light theme
   would dilute that, not complement it.
2. **The reference material is dark-first.** Retrofitting a light palette from a
   dark-first brand usually produces a worse light theme than designing one
   from scratch would — not worth the effort for a closed internal simulation
   with no light-mode requirement from any stakeholder.
3. **Correctness cost.** Every token, every chart color, every RTL check would
   need doubling and re-verifying in two themes. Phase 10 already carries a full
   bilingual/RTL pass (see the `bilingual-rtl` skill) — shipping one theme well
   beats shipping two themes adequately.

`:root` in `globals.css` **is** the dark theme — there is no `.dark` class to
toggle. `html { color-scheme: dark }` is set so native form controls, scrollbars,
etc. render dark too.

## Color tokens

Source palette (from the brand brief) and its usage split:

| Color | Hex | Share | Role |
|---|---|---|---|
| Deep Teal | `#06201F` | 60% | `--background` — page canvas |
| Dark Teal | `#0D2C2B` | 20% | `--card`, `--surface`, `--popover` — panels, cards, sections |
| Muted Mint | `#70C9AA` | 10% | `--primary` / `--brand` — CTAs, active states, highlights |
| Soft Sage | `#A8C9B8` | 5% | `--brand-muted`, secondary text/icon accents, chart-2 |
| Off White | `#F4F5F1` | 3% | `--foreground` — primary text, key numbers |
| Cool Gray | `#8D9B98` | 2% | `--muted-foreground` — secondary/muted text |

Semantic colors, chosen to sit naturally in the mint family rather than clash:

| Token | Hex | Use |
|---|---|---|
| `--success` | `#4ADE80` | Profit, approved, qualified — a brighter, more saturated green than brand mint so it reads as "positive event," not just "brand accent" |
| `--warning` | `#F0B429` | Pending, awaiting action — amber, verified readable against `#06201F` |
| `--destructive` | `#EF5A6F` | Rejection, suspension, burns, withdrawal-adjacent danger — a red with enough luminance to stay unambiguous on the deep teal background (do not darken this further) |

**Rules:**
- Never hardcode a hex value in a component. Always use the Tailwind utility
  (`bg-brand`, `text-success`, `border-destructive`, etc.) that resolves to the
  token, so a future palette tweak is a one-file change.
- Status color mapping is global and consistent: success = green, warning =
  amber, destructive = red, neutral/inactive = `muted-foreground` gray. A
  "locked" badge looks the same on the investments page as the withdrawal page.
  Don't invent a second meaning for any of these four.
- `--chart-1..5` are ordered mint-family-first (`brand`, `brand-muted`,
  `success`, `warning`, and a supporting blue `#5FB3D9` only for a 5th series)
  — use them in this order so the first two series in any chart always read as
  "on-brand," and reach for chart-4/5 only when a chart genuinely needs 4+
  series.

## Typography

**Space Grotesk** (headings) + **Inter** (body and all numeric/data), loaded via
`next/font/google` in [`src/lib/fonts.ts`](../src/lib/fonts.ts) and wired into
`--font-heading` / `--font-sans` in `globals.css`.

Why this pairing:
- **Inter** has genuine tabular figures (`tabular-nums`) and is the de facto
  standard for dense financial UI — this project has a monetary value in
  nearly every view (invariant #1), so digit alignment in columns is not
  optional polish, it's correctness for scanability.
- **Space Grotesk** is a geometric grotesk with an angular, slightly
  unconventional character — it echoes the angular "A" in the Investa mark
  without competing with Inter for the same visual register. It's used for
  headings only; body text, labels, and every number stay in Inter.
- Both are real Google Fonts (not system-font fallback), which was an explicit
  requirement — "premium fintech," not default Helvetica/Arial.

| Level | Font | Classes |
|---|---|---|
| Page title | Space Grotesk | `font-heading text-3xl font-semibold tracking-tight` |
| Section heading | Space Grotesk | `font-heading text-xl font-semibold` |
| Card/item title | Space Grotesk | `font-heading text-base font-medium` (already default via `CardTitle`) |
| Body text | Inter | `text-sm text-muted-foreground` |
| Numeric/data emphasis | Inter | `font-heading text-2xl font-semibold tabular-nums` for hero numbers, `text-sm tabular-nums` inline |

`tabular-nums` is mandatory on every rendered monetary or percentage value,
full stop — see the `money-precision` skill for the underlying Decimal rules;
this doc only covers how it's *displayed*.

## Spacing & layout

Follow the `frontend-design` skill's page-structure rules (max-width container,
`px-6 py-10 lg:px-8`, `space-y-8`/`gap-8` between sections) — those are
skill-level, not restated here. This project adds one thing on top: card
internal spacing runs off the `--card-spacing` CSS var already defined in
`card.tsx` (`--spacing(4)` default, `--spacing(3)` for `size="sm"`) — don't
hardcode `p-4`/`p-6` inside a `Card`, use the `size` prop instead.

`--radius` is `0.75rem` (slightly more rounded than the shadcn default
`0.625rem`) — reads softer/friendlier, appropriate for a consumer-facing
dashboard rather than a dense admin tool. `radius-sm` through `radius-4xl`
scale off it automatically; don't override radius per-component.

## Cards & elevation

Cards are Dark Teal (`--card`, `#0D2C2B`) against the Deep Teal page background
— that contrast **is** the elevation cue in a dark UI; box-shadow alone barely
reads on dark backgrounds; do not lean on `shadow-lg` to create depth.
`card.tsx`'s existing `ring-1 ring-foreground/10` gives a soft edge on top of
that surface contrast. For an interactive/selectable card (packages, tree
nodes), add `hover:shadow-md hover:shadow-black/20` as the interactive cue —
see `hover:shadow-black/20` in the preview's `WalletCard`, not the default
`hover:shadow-md` alone, which is nearly invisible on dark backgrounds.

## Buttons & states

Variants already exist in `button.tsx` and map onto the token system with no
changes needed:

| Variant | Use |
|---|---|
| `default` (primary) | The one primary action per view — buy, submit, confirm |
| `secondary` | A real but non-primary action alongside a primary one |
| `outline` | Low-emphasis action, often paired with a `default` button |
| `ghost` | Toolbar/icon-only or tertiary actions |
| `destructive` | Withdrawal approval, suspension, burns — anything consequential and hard to reverse |
| `link` | Inline text-style action |
| `disabled` (via `disabled` prop) | Automatic `opacity-50` + `pointer-events-none`, already handled |

Never make a destructive action look like a routine one — always
`variant="destructive"`, never `default`/`secondary` with red text bolted on.

`Badge` now also has `success` and `warning` variants (added this task) for
inline status chips — qualified/approved use `success`, pending/awaiting use
`warning`, rejected/suspended use `destructive`, informational/locked use
`outline`.

## Logo

**Final.** The mark ships from the project owner's real delivered artwork —
`docs/brand/investa-logo-mark.svg` (icon alone) and
`docs/brand/investa-logo-full.svg` (full lockup with wordmark and tagline,
used as the layout reference; both are Illustrator exports at a 1080×1080
viewBox). Every component renders it through
[`src/components/logo.tsx`](../src/components/logo.tsx)'s `LogoMark`/`LogoFull`
exports — nobody else hand-codes the SVG path data — so any future revision
means editing `LogoMarkSvg` in that one file (plus regenerating the three
static duplicates below, which have no choice but to exist outside React). Do
not add a second place that draws the mark.

Static duplicates for non-React contexts: [`public/logo-mark.svg`](../public/logo-mark.svg)
(icon only), [`public/logo-full.svg`](../public/logo-full.svg) (mark +
wordmark + tagline), and `src/app/icon.svg` (favicon, a copy of
`logo-mark.svg`) — these three must be regenerated by hand from `logo.tsx`
whenever the mark changes, since favicon/email/print contexts can't run a
React component. The wordmark ("INVESTA") and tagline in `LogoFull` stay as
real text (Space Grotesk / Inter respectively) rather than vector letterforms
from the source file, so the tagline can keep going through next-intl
(`Login.logoTagline`) instead of being baked into a path — the source file's
own wordmark/tagline paths are a layout reference only, not something we
render directly.

**The mark's actual construction**: a single folded ribbon runs from
bottom-left up to the apex, creases at the peak, then continues down to
bottom-right as the second leg — both legs are narrow, flat-cut ribbons with a
top-to-bottom gradient (`#96F2C9` → `#6AD5AE` → `#289B88`) giving them
dimensional shading. The crossbar is **not** a bar joining the two legs — it's
a third, fully detached rounded ribbon piece floating in the gap, with a
stepped notch cut into its lower-left edge, plus a soft radial fade overlay
matching the source artwork's shading. That detachment plus the notch is what
gives the mark its layered, non-generic silhouette; collapsing it back into a
plain triangle+bar "A" loses the thing that makes it recognizable as this
brand's mark specifically.

- `LogoMark` — nav-bar icon, favicon, loading states. Symbol only, no wordmark
  or tagline, per the original brand plan. At true 16px favicon size the
  crossbar's notch detail fills in and it reads as a solid triangle — expected
  and acceptable (the 32px favicon and nav-bar sizes both hold the full
  fold/crossbar structure clearly; only the smallest favicon simplifies).
- `LogoFull` — sidebar header, login page, anywhere the full identity should
  read at a glance. Lockup is mark + "INVESTA" (Space Grotesk semibold,
  wide-tracked, brand mint) + the tagline "SMART INVESTMENTS • REAL WEALTH"
  (Inter medium, smaller, wide-tracked, `--brand-muted`) stacked beneath the
  wordmark — matching the reference's two-line lockup. Pass `tagline={false}`
  for a mark+wordmark-only variant in cramped headers; the full lockup with
  tagline is the default.
- `src/app/icon.svg` is the Next.js auto-favicon (copy of `logo-mark.svg`) — if
  the mark is ever revised, update `public/logo-mark.svg`,
  `public/logo-full.svg`, and `src/app/icon.svg` together, alongside
  `logo.tsx`.

## Countdown rings

Introduced in SCRUM-93 (`src/components/countdown-ring.tsx`) for time-bound
lock periods — the investments panel's 7-day profit-start delay and 6-month
capital-unlock date. Pure SVG (`stroke-dasharray`/`stroke-dashoffset`), not a
canvas or a third-party gauge library.

- Color follows the doc's existing semantic mapping exactly, no new meanings:
  **brand mint** (`text-brand`, i.e. `--chart-1`) while a lock period is still
  counting down, **success green** (`text-success`) once it completes. Never
  use warning/destructive for a ring — those stay reserved for pending
  -admin-action and rejection/suspension states elsewhere in the app.
- The unfilled track uses `text-muted/60` — consistent with the app's general
  "muted = inactive/background" convention.
- Every ring ships an `sr-only` text alternative describing the real
  countdown in words (e.g. "Profit starts in 4 days") — an SVG arc's fill
  percentage has no accessible representation on its own.
- Rings don't need RTL mirroring the way linear layouts do (per the
  bilingual-rtl skill) — a circular sweep has no inherent reading direction,
  only the *card* containing it needs RTL-correct flex ordering. Verified
  visually: the panel's card order and each card's two-ring order both mirror
  correctly under `dir="rtl"` because they're normal flex children; the
  ring's own SVG geometry does not need a directional variant.

## Applying this system

- Reference this doc from every subsequent Phase 10 ticket instead of
  re-deriving colors/spacing/type choices per screen.
- If a screen seems to need a color, spacing value, or component variant not
  covered here, extend this doc and `globals.css` first — don't invent a
  one-off value inline in a page component.
- The `/en/preview` route (`src/app/[locale]/preview/page.tsx`) is the living
  proof-of-system for this ticket (SCRUM-90) — a wallet card, button set, chart
  snippet, and logo at nav size, all built from these tokens. It's scaffolding
  for review, not a real screen; remove or repurpose it once SCRUM-91+ ship
  real dashboard panels using the same tokens.
