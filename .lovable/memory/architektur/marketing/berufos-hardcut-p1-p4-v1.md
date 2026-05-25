---
name: BerufOS Hardcut P1-P4
description: 2026-05-25 Hardcut auf BerufOS.com als einzige SSOT-Domain. Authority-Host, Title/Meta/JSON-LD, Robots, Sitemap, _redirects auf berufos.com. Root-Route / rendert BerufOSHub; ExamFit-Homepage zieht auf /examfit. Module-Slugs unter Root (/agents, /documents, /workflows, /skills, /career, /recruit, /industries, /governance). /berufos und /berufos/:slug bleiben als Legacy-Alias. Legacy-Domains examfit.de/examfitwork.de/berufski.de werden via _redirects 301 auf berufos.com/<modul>.
type: feature
---
# BerufOS Hardcut P1-P4 — 2026-05-25

**Strategie:** Keine Rankings → seltene Chance auf saubere Plattformarchitektur. ExamFit.de wird Legacy-Redirect-Domain, BerufOS.com einzige SSOT.

## P1 Brand-SSOT
- `src/lib/seo/authorityHost.ts`: `SEO_AUTHORITY_HOSTS = ['berufos.com', 'www.berufos.com']`, `SEO_CANONICAL_ORIGIN = 'https://berufos.com'`. examfit.de fällt auf noindex+canonical-Rewrite.
- `src/lib/berufos/brand.ts`: bleibt SSOT, `subBrands.examfit.moduleSlug = "examfit"` href intern.

## P2 Canonical & JSON-LD
- `index.html`: Title/Meta/OG/Twitter auf BerufOS. Pre-Hydration Authority-Guard berufos.com. Google-Site-Verification-Token entfernt (TODO P7 neuer Token nach GSC-Property-Anlage). JSON-LD `@graph` neu: Organization(BerufOS) + WebSite(BerufOS) + 3× SoftwareApplication (ExamFit, Berufs-KI, AgentOS). ExamFit `EducationalOrganization` entfernt — keine Authority mehr zu schützen.

## P3 Routing
- `AuthHomeRoute.tsx`: `/` rendert für Unauth jetzt `BerufOSHub` (statt HomePageV2).
- `AppRoutes.tsx`: 8 neue Root-Module-Routes (/agents, /documents, /workflows, /skills, /career, /recruit, /industries, /governance) → `BerufOSModulePage slug="..."`. `/examfit` → `HomePageV1Legacy`. `/berufos` → 301 auf `/`. `/berufos/:slug` bleibt als Alias.
- `BerufOSModulePage.tsx`: akzeptiert optional `slug`-Prop für root-level Routes.
- `modules.ts`: examfit.href = "/examfit" (intern statt https://examfit.de).

## P4 SEO Foundation
- `public/robots.txt`: `Host: berufos.com`, Sitemap → berufos.com/sitemap.xml.
- `public/sitemap.xml`: Title-Kommentar auf BerufOS.
- `public/_redirects`: Legacy-Domain-Redirects examfit.de/examfitwork.de/berufski.de → berufos.com/<modul> 301 (Cloudflare/Vercel — Lovable-Hosting ignoriert).

## NICHT in diesem Cut
- **P5 Stripe-Migration** (User-Approval nötig)
- **P6 Email-Domain berufos.com** (DNS-Setup-Dialog)
- **P7 GSC Property + Site-Verification** (neuer Token in index.html)
- **P8 Custom-Domain berufos.com als Primary** (Lovable Project Settings)
- **P9 Memory-Cleanup** (alte authority=examfit.de Einträge refreshen)

## Rollback
Git-revert pro File. Keine DB-Migrationen. Module-Routes additiv. examfit.de funktioniert weiter (rendert via Authority-Guard mit noindex + canonical auf berufos.com).
