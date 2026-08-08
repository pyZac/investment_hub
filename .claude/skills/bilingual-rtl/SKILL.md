---
name: bilingual-rtl
description: English/Arabic bilingual and RTL layout conventions for this project. Use whenever creating or editing any UI component, page, layout, form, chart, table, or admin screen, and whenever adding user-facing text of any kind. Also use when adding translation keys, working with next-intl, or reviewing whether a component renders correctly in Arabic.
---

# Bilingual (EN/AR) & RTL Conventions

Every screen in this app — user dashboard and admin panel alike — must work fully
in English and Arabic. Admin is a real user role, not exempt from i18n.

## 1. No hardcoded strings, from day one

Every user-facing string goes through a next-intl translation key, with both
`messages/en.json` and `messages/ar.json` populated in the same commit that adds
the component. Retrofitting translations after the UI is built is far more
expensive than building bilingual from the start.

```tsx
// WRONG
<Button>Withdraw</Button>

// RIGHT
const t = useTranslations('withdrawal');
<Button>{t('submit')}</Button>
```

Locale is route-based (`/en/dashboard`, `/ar/dashboard`), user-selectable, and
persisted per user (`users.locale`).

## 2. Financial terminology stays in English, even in Arabic UI

Do **not** translate: Wallet A / Wallet B / Wallet C / SAVING, Binary Commission,
Direct Commission, Ranking Commission, BV, MRV, Rank, rank names (Investor,
Partner, Executive, Director, President, Chairman, Visionary, OG), package names
(Starter, Bronze, Silver, Gold, Platinum, Diamond, Elite), Platform Reserve.

Do translate: general interface text, instructions, labels, navigation, buttons,
validation messages, empty states, tooltips.

This matches common practice on regional platforms and avoids ambiguity around
specialised terms with no single settled Arabic equivalent. Keep a glossary comment
block inside the translation catalog itself so this stays consistent as new UI is
added in later phases.

## 3. Numbers stay Western Arabic numerals in both locales

Display all monetary values, volumes, and counts as `0–9` — **never** Eastern
Arabic numerals (`٠١٢٣`), even in the Arabic UI. Amounts must remain unambiguous
for audit and support purposes. If a date library or `Intl` formatter defaults to
Eastern numerals under `ar`, force the numbering system explicitly (e.g. the
`ar-u-nu-latn` locale tag) rather than accepting the default.

Only labels and surrounding text translate; the digits do not change form.

## 4. RTL is a real layout mode, not mirrored text

`dir="rtl"` on the root plus Tailwind's `rtl:` / `ltr:` variants handle most
layout. But these do **not** auto-flip and need explicit RTL styling plus manual
visual testing:

- **Recharts** — axis position, legend alignment, tooltip anchoring, and the
  direction the profit curve reads.
- **react-d3-tree / D3** — the binary placement tree. Left leg and right leg must
  stay semantically correct while the visual layout mirrors. A user's LEFT leg is
  a data fact, not a screen position — never derive leg from render order.
- **Wallet cards**, progress bars, countdown rings — check icon/label ordering and
  any absolutely-positioned elements.
- Tables — column order, alignment of numeric columns.

Prefer logical CSS properties (`margin-inline-start`, `padding-inline-end`,
`text-align: start`) over physical ones (`ml-`, `pr-`, `text-left`) so layout flips
automatically.

## 5. Verification standard

A screen is not "done bilingual" because the strings are translated. Load it at
`/ar` and look at it. Charts, trees, and cards specifically. The exit test for any
UI phase includes an RTL walkthrough, not just a translation check.
