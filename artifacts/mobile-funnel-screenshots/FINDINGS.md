# Mobile Funnel Screenshot Visual Audit — 2026-05-08

Target: `https://examfitde.lovable.app` (preview), viewports 390×844 + 430×932,
states `pending` (cookie banner visible) and `accepted` (banner suppressed).

Heuristic auto-checks (hScroll, banner-overlap, headline-clip) all pass.
Findings below come from visual inspection of every screenshot.

## Priority Findings

### P0 — blocks conversion / orientation

| # | Route | Issue | Evidence |
|---|---|---|---|
| 1 | `/pruefungsreife-check` | **No site header / brand / back-nav.** Page rendered outside `MainLayout`. User loses trust + escape hatch mid-funnel. | `06-quiz-start-*`, `09-quiz-start-beruf-*` |
| 2 | `/berufe/bankkaufmann` | Preview deploy serves "Beruf nicht gefunden" empty state. Hero placeholder reserves ~50% viewport before message → looks broken. Likely catalog data not on this preview build (production may be fine). | `03-beruf-hero-*` |
| 3 | `/bundle/bankkaufmann` | Same pattern — "Produkt nicht gefunden" with large empty hero placeholder above the empty-state. | `10-bundle-hero-*`, `11/12-bundle-*` |

### P1 — strong conversion impact

| # | Route | Issue | Evidence |
|---|---|---|---|
| 4 | `/` Hero | Inline highlighted word **"passenden"** breaks reading flow — looks like a separate badge mid-headline. Consider styling as accent color only or moving to subtitle. | `01-home-hero-*` |
| 5 | All routes (pending) | Cookie banner consumes ~30% of viewport and covers the social-proof / trust strip directly under the primary CTA. Primary CTA stays tappable, but secondary trust signals are hidden until consent. | `01/02/03/06/10-*-pending` |
| 6 | `/pruefungsreife-check` | Preview build still auto-jumps to "Frage 1 von 5" instead of showing the StartScreen — `data-testid="quiz-start"` was not found by Playwright. New testid + start-screen flow not yet on preview deploy. | Playwright finding `quiz-start testid not found` |

### P2 — polish

| # | Route | Issue |
|---|---|---|
| 7 | `/pruefungsreife-check` quiz card | Top whitespace too generous on small phones (`py-16` at `sm:`); on bare 390 the card sits roughly centered, leaving ~120px of empty space above. Reduce `py-8` further or anchor card to top. |
| 8 | Beruf / Bundle empty-state | "Alle Berufe ansehen" CTA is the only escape — add a second secondary "Zur Startseite" link. |
| 9 | `/admin/growth` mobile | Auth-gated, captured login redirect. Consider mobile-friendly admin layout (out of funnel scope). |

## Code fixes shipped this sprint

- **P0 #1 — Header on quiz route**
  `src/routes/AppRoutes.tsx`: moved `/pruefungsreife-check` into the
  `MainLayout` block so the marketing header (brand + nav) renders on the
  whole funnel.

## Findings deferred (no code change here)

- **P0 #2/#3 (Beruf/Bundle "not found")** — preview-deploy data gap, not a
  code regression. Re-run audit after the next preview build to confirm; if
  it persists in production, audit `useHomepageCatalog` / `bundle/:slug`
  resolver for `bankkaufmann` slug seeding.
- **P1 #4 ("passenden" inline highlight)** — copy/design decision; needs
  product input before re-styling the hero headline token.
- **P1 #6 (quiz testid)** — new testid + start-screen split is in source but
  needs a fresh preview deploy.

## Recommended next sprint

1. Re-run `mobile-screenshots` against the next preview deploy and verify
   that #1, #2, #3, #6 are resolved.
2. Decide on the hero-headline highlight pattern (#4) and roll a single
   reusable `HeroAccent` token across landing pages.
3. Move the cookie banner to a slim top bar variant on mobile so it never
   competes with the hero CTA's social-proof strip below the fold (#5).

## Heuristic table (auto)

See the auto-generated table appended by the Playwright spec below.
