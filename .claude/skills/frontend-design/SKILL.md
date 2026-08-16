---
name: frontend-design
description: Visual and layout design standards for this project's UI. Use whenever building or editing any page, component, form, card, table, dashboard, or admin screen. This is not optional polish — every UI task in this project must follow these standards rather than default/unstyled component output.
---

# Frontend Design Standards

This project's UI must look deliberately designed, not like raw unstyled shadcn/ui
defaults dropped onto a page. A screen that "works" but is visually flat, cramped,
or generic is not an acceptable deliverable — treat these standards as required,
the same way the money-precision rules are required for financial code.

## 1. Page structure — every page needs breathing room

- Every page gets a max-width content container, centered, with real horizontal
  padding — never content flush against the browser edge.
  ```tsx
  <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8">
  ```
- Vertical rhythm between sections: use consistent spacing (e.g. `space-y-8` or
  `gap-8` between major blocks), not ad-hoc margins per element.
- A page needs a clear header zone: title, one-line description, and any global
  context (like a balance) visually separated from the content below it — not
  three lines of plain text stacked with no distinction.

## 2. Typography hierarchy — every screen needs visible levels

Never let a page title, a card title, and body text render at visually similar
weight/size. Establish clear levels and use them consistently:

| Level | Use | Example classes |
|---|---|---|
| Page title | One per page | `text-3xl font-semibold tracking-tight` |
| Section heading | Groups of content | `text-xl font-semibold` |
| Card/item title | Inside a card | `text-base font-medium` |
| Body text | Descriptions, labels | `text-sm text-muted-foreground` |
| Numeric/data emphasis | Prices, balances, amounts | `text-2xl font-bold tabular-nums` or `text-lg font-semibold tabular-nums` |

Monetary values always use `tabular-nums` so digits align in columns — this
matters for a project with financial data throughout.

## 3. Cards need actual depth and structure, not just a border

Bare `<Card>` with no elevation reads as a wireframe, not a product. Every card
representing a real, selectable, or purchasable item needs:

```tsx
<Card className="flex flex-col justify-between border-border/60 shadow-sm transition-shadow hover:shadow-md">
  <CardHeader className="pb-2">
    <CardTitle className="text-base font-medium">{name}</CardTitle>
  </CardHeader>
  <CardContent className="flex-1">
    <p className="text-2xl font-bold tabular-nums">{formattedAmount}</p>
  </CardContent>
  <CardFooter>
    <Button className="w-full">{ctaLabel}</Button>
  </CardFooter>
</Card>
```

- `shadow-sm` at rest, `hover:shadow-md` — cards should feel tactile, not flat.
- A grid of cards uses a real responsive grid, never a naive flex-wrap:
  ```tsx
  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
  ```
- Consistent card heights within a grid — use `flex flex-col justify-between` so
  footers (buttons) align across a row regardless of content length.

## 4. Color is intentional, not just black-and-white defaults

- Primary actions (buy, submit, confirm) use the theme's primary color, not the
  unstyled default black button. Configure a real primary color in
  `tailwind.config` / shadcn's theme rather than leaving it at the scaffold default.
  A blue, green, or brand-appropriate accent reads as designed; pure black-on-white
  buttons everywhere reads as unfinished.
- Secondary/destructive actions get `variant="secondary"` / `variant="destructive"`
  — never make every button look identical regardless of its consequence.
  Withdrawal approval, account suspension, and similar consequential actions must
  visually signal weight (e.g. destructive red, or a confirmation step) — never
  render identically to a routine action like "View."
- Status and state get color meaning, consistently across the whole app: success
  green, warning amber, error/destructive red, neutral gray for inactive/disabled.
  Once a mapping is chosen, reuse it everywhere — a "locked" badge should look the
  same on the investments page as it does on the withdrawal page.

## 5. Empty, loading, and error states are designed, not afterthoughts

Every list or data-driven page needs explicit handling for:
- **Empty** — not a blank page. A short message plus, where relevant, a CTA
  ("You have no active investments yet — browse packages to get started").
- **Loading** — skeleton components (`<Skeleton>`) matching the shape of the real
  content, not a bare spinner or a flash of blank page.
- **Error** — a readable message in context, not a raw stack trace or default
  Next.js error boundary shown to an end user (that's fine for you, the developer,
  in dev — never acceptable in a screen meant to represent the real product).

## 6. Forms and confirmations

- Every destructive or financial action (purchase, withdrawal, admin credit) shows
  a confirmation step with the concrete details of what's about to happen — amount,
  resulting balance, target — before committing. Never a bare button with no
  preview of consequence.
- Disabled/pending states on submit buttons during an in-flight action — never let
  a user double-click into a duplicate submission by accident, even though the
  idempotency layer would already catch it server-side; the UI should also make it
  obviously *feel* like it registered the click.
- Validation errors appear inline, next to the relevant field, in the destructive
  color — not as a generic toast with no context on which field is wrong.

## 7. Test/dummy data is never left visible

A screen shown for review must contain realistic, correctly-named data — not raw
UUIDs, "Test-xxxx" strings, or lorem ipsum. If seed/test data has placeholder
names, either fix the seed data or clearly note in the handoff that what's being
reviewed is placeholder content, so it isn't mistaken for a real design flaw.

## 8. RTL is not automatic — see the bilingual-rtl skill

This skill governs layout and visual quality; the `bilingual-rtl` skill governs
translation and RTL-specific mirroring rules. Both apply to every UI task —
read both before building a screen.

## 9. Self-check before calling a UI task done

Before showing a screen for review, verify:
- [ ] Page has real margin/padding, not edge-to-edge content
- [ ] At least 3 distinct visual weights are present (title / subtitle / body)
- [ ] Cards or list items have shadow/elevation, not just a flat border
- [ ] Primary action buttons are visually distinct from secondary ones
- [ ] Grid/list is responsive, not a single fixed layout
- [ ] Empty and loading states exist, not just the "happy path" with data
- [ ] No raw test UUIDs or placeholder junk visible in the reviewed screen
- [ ] Checked in both `/en` and `/ar`, RTL layout intentional not just mirrored text
