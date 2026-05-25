---
name: BerufOS P7 GSC Consolidation v1
description: berufos.com = einzige GSC-Authority. Neuer META-Token, Sitemap-Submit. Legacy-Properties passiv.
type: feature
---

# P7 — Google Search Console Consolidation (2026-05-25)

## SSOT
- **Einzige Authority-Property:** `https://berufos.com/`
- **Sitemap:** `https://berufos.com/sitemap.xml`
- **Legacy passiv:** nur `examfit.de` (bleibt in GSC archiviert — Google muss 301-Redirects noch sehen — kein Sitemap-Submit, keine Crawl-Aktion). examfitwork.de / berufski.de existieren NICHT (niemals registriert).

## Verification
- Methode: META-Tag (DNS optional als zusätzliche Sicherung).
- Token (live in `index.html` Zeile 7): `HqpfF5KsxNB7Q1ZACZV2lYHexYG0D7O-8ThhX6NqlOY`
- Vorgänger-Token `6mdZbyRinkmrkctLsFMNKIOvd0VceQ2PJ6yCerVjErQ` (examfit.de) ersetzt.

## Runner
`scripts/seo/gsc-berufos-onboard.mjs` — post-publish ausführen:
1. `verify META` → siteVerification API
2. `PUT /webmasters/v3/sites/<encoded>` → Property hinzufügen
3. `PUT .../sitemaps/<encoded>` → Sitemap submitten

## Pre-Conditions
- Publish gemacht (neuer META-Token live auf https://berufos.com/).
- DNS für berufos.com zeigt auf Lovable/Vercel-Origin.
- `LOVABLE_API_KEY` + `GOOGLE_SEARCH_CONSOLE_API_KEY` gesetzt.

## Indexierungsphasen (Coverage-Monitoring)
- **Phase A:** `/`, `/examfit`, `/berufs-ki`
- **Phase B:** `/agents`, `/documents`, `/workflows`
- **Phase C:** `/skills`, `/recruit`, `/career`, `/industries`, `/governance`

## Stability-Pakt (30–60 Tage)
- Keine weiteren Canonical-/URL-/Brand-Wechsel.
- JSON-LD `@graph` (Organization=BerufOS + SoftwareApplication ×3) bleibt eingefroren.
- Robots: Legacy-Hosts client-seitig noindex via `RouteNoindex` (P3) + canonical-Rewrite via `authorityHost.ts`.

## Nächste Phasen
- **P6 Email:** SPF/DKIM/DMARC + hello/support/billing@berufos.com
- **P5 Stripe:** Checkout-/Portal-/Invoice-Branding
- **P9 Memory-Refresh** zuletzt
