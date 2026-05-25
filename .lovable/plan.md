# Full Masterbrand Migration — ExamFit → BerufOS

**Strategische Entscheidung (locked):** BerufOS = Plattform-Hauptmarke. ExamFit = LearningOS-Modul. Berufs-KI = WorkforceOS-Modul. examfit.de + examfitwork.de werden langfristig 301-Redirect-Domains auf berufos.com/<modul>. Kein Hybrid-Chaos — eine Wahrheit: BerufOS.

**Bestehende Foundation (nicht doppelt bauen):**
- ✅ `src/lib/berufos/brand.ts` + `modules.ts` + `deno-ssot.ts` (Masterbrand-SSOT existiert)
- ✅ `/berufos` Hub + `/berufos/:slug` Module-Landings (10 Module live)
- ✅ `BerufOSHeader/Footer/ModuleLandingShell` + `berufos-theme.css`
- ✅ `berufos-waitlist` Edge Function + Memory `mem://design/berufos-masterbrand-v1`
- ✅ Custom-Domain `berufos.com` zeigt bereits hierher
- ✅ ExamFit-Brand-SSOT (`src/lib/brand/ssot.ts`) + Stripe-Brand `ExamFit@work` existieren separat
- ✅ Sitemap-Index (6 Sub-Sitemaps via Edge Function)

**Was wir migrieren — und was bewusst NICHT:**
- ✅ Masterbrand-Identität, Org-JSON-LD, Canonicals, Stripe-Branding, Email-From, Module-Routen
- ❌ ExamFit-Produktnamen in Funnels (bleibt LearningOS-Modulname)
- ❌ examfit.de DNS sofort umlegen (erst nach M4-Lock)
- ❌ Datenbank-Renaming (Tabellen/RPCs bleiben — Brand ist Präsentations-Layer)

---

## PHASE M1 — Brand-SSOT Hardening & Modul-Registry erweitern
*Foundation für alle weiteren Phasen.*

1. **Brand-SSOT v2** (`src/lib/berufos/brand.ts` erweitern):
   - `BERUFOS.domains.primary` + `BERUFOS.domains.legacy[]` (examfit.de, examfitwork.de, berufski.de)
   - `BERUFOS.modules[]` Pointer-Bridge auf `BERUFOS_MODULES`
   - `BERUFOS.stripe.brandName` + `BERUFOS.email.{from,support,noreply}`
   - Helper `isLegacyDomain(host)`, `canonicalUrlFor(path, currentHost)`
2. **examfit-Modul aktivieren** (`src/lib/berufos/modules.ts`):
   - Slug `examfit` von `href: 'https://examfit.de'` → interne Route `/berufos/examfit` (status bleibt `live`, aber unter BerufOS-Roof)
   - `berufs-ki` analog auf `/berufos/berufs-ki`
3. **Memory-Update** `mem://architektur/marketing/masterbrand-migration-m1-v1.md` mit Phase-Status, Decision-Log, Rollback-Pfad.

## PHASE M2 — Produkt-Module physisch unter /berufos einhängen
*Parallelbetrieb — keine Redirects, keine SEO-Verluste.*

1. **Bridge-Routes** in `AppRoutes.tsx`:
   - `/berufos/examfit` → rendert ExamFit-Homepage-Komponente (Re-Use, nicht doppelt bauen)
   - `/berufos/berufs-ki` → rendert Berufs-KI-Landingpage
2. **Cross-Brand-Footer-Bridge**: Auf examfit.de Homepage Footer-Hinweis "Teil von BerufOS — der AI-Plattform für Berufe" (Komponente `BerufOSPlatformBadge`).
3. **Sitemap-Erweiterung**: `generate-sitemap` Edge Function um `type=berufos` (Hub + 10 Modul-Landings) erweitern + im Sitemap-Index registrieren.

## PHASE M3 — Canonical Shift & JSON-LD Org
*SEO-Authority graduell auf BerufOS umlenken.*

1. **`index.html` JSON-LD**: `Organization` = BerufOS, `subOrganization[]` = ExamFit + ExamFit@work + 8 Module. `sameAs` = legacy-Domains.
2. **Canonical-Policy**: Neue Helper `useBerufosCanonical(path)` — auf berufos.com gehostete Routes bekommen `https://berufos.com/...`, examfit.de-Routes bleiben self-canonical (kein Cross-Domain-Canonical-Risk vor M5).
3. **robots.txt** auf berufos.com Branch: Sitemap-URL ergänzen.
4. **CI-Guard** `scripts/guards/berufos-brand-ssot-guard.mjs` von warn→fail nach Bridge-Migration (Phase 2).

## PHASE M4 — Stripe & Email Brand-Migration
*Behutsam — bestehende Customer dürfen nicht confused werden.*

1. **Stripe Brand-SSOT** (`src/lib/brand/ssot.ts` erweitern):
   - Neue `BERUFOS_STRIPE_BRAND = "BerufOS"` Constant
   - ExamFit + ExamFit@work bleiben als `statement_descriptor_suffix` für Produkt-Kontext
2. **Neue Stripe-Products**: Nicht jetzt — erst nach M5-Lock. Stattdessen: bei nächster Product-Creation `metadata.platform = "berufos"` + `metadata.module = "examfit|berufs-ki"`.
3. **Email-Setup**: `hello@berufos.com` + `support@berufos.com` + `noreply@berufos.com` über Email-Domain-Setup (separater Run — User-Interaktion nötig).
4. **Tracking-Events**: `conversion_events.metadata.platform_brand = "berufos"` als optionales Feld (kein Schema-Change, generated column reicht).

## PHASE M5 — 301 Redirect Phase (READY-Cut, nicht jetzt schalten)
*Vorbereitung — Schaltung erst nach Stakeholder-Go.*

1. **Redirect-Map SSOT** (`src/lib/berufos/redirect-map.ts`):
   - `examfit.de/*` → `berufos.com/examfit/*` (Mappings für /shop, /blog, /kurs/* etc.)
   - `examfitwork.de/*` → `berufos.com/berufs-ki/*`
2. **Cloudflare/Vercel-Config** vorbereiten (kommentiert, nicht aktiv): `public/_redirects` Block mit `# READY_M5 — NOT ACTIVE`.
3. **Vercel-Migration-Runbook** erweitern (`docs/runbooks/vercel-migration.md`) um BerufOS-Cutover-Sektion.

## PHASE M6 — SEO Consolidation Monitoring
*Post-Cutover. Erst nach M5-Schaltung relevant.*

1. **GSC-Property** berufos.com einrichten + Change-of-Address für examfit.de.
2. **LLM-Visibility Cron** (existiert: `LlmVisibilityCard`) auf BerufOS-Brand-Queries erweitern.
3. **7d/30d Stability-Reports** (existiert: `seo-stability-7d-report.yml`) um berufos.com Domain.

---

## Cut für diesen Run: **M1 + M2 + M3 (read-safe)**

Konkret in diesem Build:
1. `src/lib/berufos/brand.ts` erweitern um domains/modules/stripe/email + Helper
2. `src/lib/berufos/modules.ts` examfit + berufs-ki Module auf interne Routes umstellen
3. `/berufos/examfit` + `/berufos/berufs-ki` Bridge-Pages (re-use existing components — keine Duplikation)
4. `BerufOSPlatformBadge` Komponente für examfit.de Footer-Bridge
5. `index.html` JSON-LD auf Org=BerufOS + subOrganization[]
6. Memory `mem://architektur/marketing/masterbrand-migration-m1-v1.md`
7. Memory-Index Update

**Nicht in diesem Cut (separate Runs nach Approval):**
- M4 Stripe/Email-Branding (braucht User-Interaktion für neue Email-Domain)
- M5 Redirects schalten (Stakeholder-Go nötig)
- M6 GSC-Setup (manuelles External-Tool)

**Rollback:** Alle Änderungen sind additiv. Bridge-Routes können entfernt werden, examfit.de/examfitwork.de bleiben unangetastet. SSOT-Erweiterungen sind backward-compatible.

**Geschätzter Aufwand:** ~6 Files Edit, 3 Files Create, ~30min Build.
