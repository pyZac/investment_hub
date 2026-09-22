# Session: Public informative pages (pre-login marketing site)

Bilingual EN/AR, dark Deep-Teal-&-Mint design system (matches dashboard),
no backend changes. New route group `(public)` alongside existing `(app)`
and `admin` groups so the public header never leaks into dashboard/admin.

## Architecture decisions

- New route group `src/app/[locale]/(public)/` holding: `page.tsx` (home,
  replaces the placeholder currently at `(app)/page.tsx` — the root route
  moves from `(app)` to `(public)`), `about/page.tsx`,
  `how-we-invest/page.tsx`, `sectors/page.tsx`, plus its own
  `layout.tsx` for the public header + footer.
- `(app)/page.tsx` gets deleted (its content moves to `(public)/page.tsx`);
  `(app)/layout.tsx`'s unauthenticated branch (the bare
  LanguageSwitcher-only header) becomes dead code for `/` specifically
  once `/` moves out of that group, but review whether anything else in
  `(app)` is reachable while logged out (register, login are, and keep
  their current minimal header — not part of this ticket's scope, per
  "don't scope-creep").
- Real image filenames on disk use spaces (`city skylines_1.jpg`, not
  `city_skylines_1`) — using the actual files, not renaming them.
- Shared `PublicHeader`/`PublicFooter`/`PublicHero` components in
  `src/components/public/` (new dir) — one header used by all 4 pages via
  the `(public)/layout.tsx`, not duplicated per page.
- New translation namespace `Public` in en.json/ar.json for nav + footer +
  home page; `About`, `HowWeInvest`, `Sectors` namespaces for the other 3
  pages' body content (kept separate from `Public` so each page's content
  block stays easy to find/edit independently, matching this project's
  existing one-namespace-per-page-area convention).
- Financial/brand terms stay English in Arabic per bilingual-rtl skill:
  "INVESTA" wordmark, Wallet A/B/C (not used here), but plain marketing
  copy translates fully — this content is general marketing text, not
  financial terminology, so ALL of it (headings, body paragraphs) gets a
  real Arabic translation, not just labels.

## Build order

- [ ] `src/components/public/public-header.tsx` — logo, nav links (Home/
      About/How We Invest/Sectors), Login button, LanguageSwitcher,
      mobile hamburger via existing `MobileNavSheet`, sticky top.
- [ ] `src/components/public/public-footer.tsx` — copyright + Login link.
- [ ] `src/components/public/public-hero.tsx` — reusable full-width image
      hero (next/image fill + object-cover, dark gradient overlay for
      text legibility per design system's dark-only theme) taking
      image src, headline, subheadline, optional CTA.
- [ ] `src/app/[locale]/(public)/layout.tsx` — wraps children with
      PublicHeader + PublicFooter.
- [ ] `src/app/[locale]/(public)/page.tsx` — Home.
- [ ] `src/app/[locale]/(public)/about/page.tsx` — About.
- [ ] `src/app/[locale]/(public)/how-we-invest/page.tsx` — How We Invest.
- [ ] `src/app/[locale]/(public)/sectors/page.tsx` — Sectors.
- [ ] Delete `src/app/[locale]/(app)/page.tsx` (moved to (public)).
- [ ] `messages/en.json` + `messages/ar.json`: add `Public`, `About`,
      `HowWeInvest`, `Sectors` namespaces with the exact content given,
      full Arabic translation for ar.json (not machine-literal English
      terms left untranslated, except INVESTA and any genuinely
      untranslatable proper nouns like place names — Marbella, Dubai,
      etc. stay as-is/transliterated per normal Arabic convention).
- [ ] Remove/repurpose now-unused `HomePage` key if nothing else uses it.

## Verification
- [x] tsc --noEmit clean (required a `.next/types` cache clear + container
      restart after moving `page.tsx` between route groups — Next.js kept
      the deleted route registered in the dev server's in-memory route
      table until restarted, causing transient 404s on all 4 new pages)
- [x] security-headers.test.ts (checks "/") passes; full suite 605/606 (1
      pre-existing skip), 0 reconciliation drift
- [x] Confirmed via curl: /en, /ar, /about, /how-we-invest, /sectors all
      200, real Arabic text renders (not English fallback) under /ar with
      dir="rtl"/lang="ar" on <html>, no physical left-/right-/ml-/mr-/pl-/
      pr-/text-left/text-right classes anywhere in the new code
- [x] Confirmed /en/login still renders its OWN minimal header (no public
      nav links actually rendered — only present in the embedded i18n
      messages JSON blob, which is normal/expected)
- [x] Commit + push
