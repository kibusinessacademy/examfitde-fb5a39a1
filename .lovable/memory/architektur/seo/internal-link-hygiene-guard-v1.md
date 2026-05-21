---
name: Internal Link Hygiene Guard v1
description: Static guard against internal Links/hrefs to redirected/dead routes (P6 Cut 2)
type: feature
---

# P6 Cut 2 — Internal Link Hygiene

## Problem
Crawler folgen internen Links auch nach 301 — saubere Quell-Hrefs sind die einzige
dauerhafte Lösung gegen wiederkehrende GSC 404/Soft-404 Cluster.

## Guard
`scripts/guards/internal-link-hygiene-guard.mjs` + Workflow
`internal-link-hygiene-guard.yml`. Scannt `src/**/*.{ts,tsx,js,jsx}` nach
`(to|href)="/<dead>"` Patterns für: `/products`, `/product/<slug>`,
`/category/<slug>`, `/learning/*`, `/checkout`, `/search`, `/legal/*`.

## Allowlist
- `src/routes/AppRoutes.tsx` (Redirect-Deklarationen)
- `src/components/seo/RouteNoindex.tsx` (noindex-Patterns)
- `src/components/seo/LegacyParamRedirect.tsx` (Doku)
- `__tests__/` + `src/test/`

## Baseline 2026-05-21
1326 Files gescannt, **0 Violations**. Cut 1 (RouteNoindex+robots+301-Redirects)
hatte die Symptome abgefangen — Quell-Hrefs sind bereits sauber. Guard friert den
Zustand ein.

## Anti-patterns
- ❌ Neuer `<Link to="/products">` / `<a href="/checkout/...">` etc. → CI fail
- ❌ Allowlist erweitern, statt Link auf Zielroute (/paket, /agb, /wissen) zu repointen
