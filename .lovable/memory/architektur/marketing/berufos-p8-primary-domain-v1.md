---
name: BerufOS P8 Primary-Domain-Cutover v1
description: berufos.com ist einzige Plattform-Authority. Legacy-Domains nur 301-Shells. www → apex.
type: feature
---

# P8 — BerufOS.com als Primary Domain (Cutover 2026-05-25)

**SSOT:** `berufos.com` (Apex) ist die einzige Production-Authority der Plattform.

## Domain-Topologie (final)

| Host | Rolle | SEO |
|---|---|---|
| `berufos.com` | Primary Authority | indexable, canonical-Target |
| `www.berufos.com` | Authority-Alias | 301 → apex |
| `examfit.de` / `www.examfit.de` | Legacy-Shell | 301 → `berufos.com/examfit/*`, noindex |
| `examfitwork.de` / `www.examfitwork.de` | Legacy-Shell | 301 → `berufos.com/berufs-ki/*`, noindex |
| `berufski.de` / `www.berufski.de` | Legacy-Shell | 301 → `berufos.com/berufs-ki/*`, noindex |

## Code-Konsequenzen (P8-Cut)

- `BERUFOS.domains.authority = ["berufos.com", "www.berufos.com"]` — examfit.de NICHT mehr Authority.
- `BERUFOS.subBrands.*.domain = "https://berufos.com/<slug>"` — keine separaten Brand-Domains mehr.
- `index.html` Org-JSON-LD `sameAs: []` — keine examfit.de/examfitwork.de Entity-Bridge mehr (würde Authority splitten).
- `public/_redirects` ergänzt `www.berufos.com → berufos.com` (Apex-Konsolidierung).
- Pre-hydration noindex-Guard in `index.html` (P3) bleibt — fängt Legacy-Hosts auf SPA-Ebene ab, bis Vercel/Cloudflare _redirects greift.

## Nächste Phasen (in dieser Reihenfolge)

1. **P7 GSC**: neue Property `https://berufos.com`, Sitemap submit, alte Properties archivieren.
2. **P6 Email**: SPF/DKIM/DMARC auf berufos.com, hello/support/billing@berufos.com aktiv.
3. **P5 Stripe**: Checkout-Branding, Customer-Portal, Invoice-Branding auf BerufOS.
4. **P9 Memory-Refresh**: North-Star-Memory neu schreiben.

## Risk / Rollback

- examfit.de bleibt als Domain registriert + 301-Shell. Falls Domain-Cut zurückgerollt werden muss, `domains.authority` wieder erweitern.
- Lovable-Hosting ignoriert `public/_redirects` — die www/Legacy-301s greifen erst nach Vercel/Cloudflare-Migration. Bis dahin macht der `RouteNoindex`-Guard + canonical-Rewrite die SEO-Arbeit clientseitig.
