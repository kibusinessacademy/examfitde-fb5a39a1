---
name: Masterbrand Migration M1+M2+M3
description: ExamFit→BerufOS Full-Migration Phase M1-M3. Brand-SSOT v2 mit domains/email/stripe/helpers, Modul-Slugs renamed (learning→examfit, workforce→berufs-ki, industry→industries) mit Legacy-Aliases, BerufOSPlatformBadge im examfit.de Footer, Org+subOrganization JSON-LD.
type: feature
---
# Masterbrand Migration M1+M2+M3 — 2026-05-25

**Strategie:** BerufOS = einzige Hauptmarke (Plattform). ExamFit + Berufs-KI = Produktmodule. examfit.de/examfitwork.de bleiben in M1-M3 unangetastet, werden in M5 zu Redirect-Domains.

## M1 — Brand-SSOT v2
- `src/lib/berufos/brand.ts`: + `domains.{primary,authority,legacy[]}`, `stripe.{masterBrand,subBrands}`, `email.{from,support,noreply,legacy}`, `subBrands.*.moduleSlug`. Helper: `isLegacyDomain`, `isBerufosPrimary`, `berufosCanonicalUrl`.
- `src/lib/berufos/modules.ts`: Slugs renamed → `examfit, berufs-ki, agents, documents, workflows, skills, career, recruit, industries, governance`. `BERUFOS_SLUG_ALIASES` + `resolveModuleSlug()` für Back-Compat (learning→examfit, workforce→berufs-ki, industry→industries). `getModule()` löst Aliases auf.

## M2 — Bridge & Cross-Brand
- `src/components/berufos/BerufOSPlatformBadge.tsx` (neu): zurückhaltendes Footer-Label "Teil von BerufOS · Das AI-Betriebssystem für Berufe" mit Link zum Hub.
- `MainLayout.tsx`: Badge eingebaut zwischen Footer-Nav und IHK-Disclaimer.
- Routes `/berufos/:slug` rendern automatisch neue Slugs (via existierende `BerufOSModulePage` + `getModule()` mit Alias-Resolution).

## M3 — Canonical Shift & Org-JSON-LD
- `index.html` JSON-LD: BerufOS `Organization` (@id `https://berufos.com/#organization`) als erster Eintrag im @graph — mit `subOrganization` auf ExamFit + ExamFit@work, `sameAs` auf legacy-Domains. ExamFit-EducationalOrganization bleibt vollständig erhalten (Authority schutz).

## Tests
- `src/test/berufos/module-registry.test.ts`: angepasst auf neue Slugs + neuer Test `Legacy-Slug-Aliase werden auf neue Slugs aufgelöst`.

## NICHT in diesem Cut (separate Runs)
- M4: Stripe-Branding-Migration, Email-Domain-Setup (hello@/support@berufos.com) — User-Interaktion nötig.
- M5: 301-Redirect-Schaltung examfit.de→berufos.com/examfit — Stakeholder-Go nötig.
- M6: GSC Change-of-Address, LLM-Visibility auf BerufOS-Queries.
- `useBerufosCanonical()` Helper für per-Route Canonicals — wartet auf M5-Lock.

## Rollback
Alle Änderungen additiv. Modul-Slug-Alias garantiert dass alte Bookmarks /berufos/learning weiterhin funktionieren. JSON-LD-Erweiterung verändert ExamFit-Org nicht. Badge entfernbar via revert in MainLayout.tsx Z.222.
