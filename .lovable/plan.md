# Pfad A — Bundle → Complete Naming-Cleanup

**Invariante (Guard):** Ein Beruf = ein kanonisches Komplettpaket. Keine Änderung an Pricing, Fulfillment, Entitlements, `process_order_paid_fulfillment`, `grant_learner_course_access`, `channel_policy_json`, `store_products.product_key='bundle'` Datensätzen oder Tracking-Semantik.

## Scope (5 atomare Sub-Schritte)

### A1 — Routes umstellen (Quelle der Wahrheit)
- Neue Routes `/paket` und `/paket/:slug` registrieren → rendern dieselben `BundleListPage`/`BundleDetailPage`-Komponenten (intern noch so benannt, Umbenennung in A3).
- `/bundle` und `/bundle/:slug` bleiben als **Redirect-Routes** (client-seitig via `LegacyProductRedirect`-Muster: Helmet canonical → `/paket/...`, `<Navigate replace>`).
- `public/_redirects` ergänzen `/bundle/* /paket/:splat 301` (auch wenn Lovable es ignoriert — Cloudflare/Vercel-ready; vgl. Memory `seo/hosting-spa-fallback-blocks-prerender-v1`).
- **Sitemap/SEO**: `generate-sitemap` + `generate-sitemap-index` schreiben `/paket/...`; alte `/bundle/...` Einträge entfernen.
- **Canonical-Drift-Audit:** alle `SITE_URL + '/bundle/'`-Vorkommen → `/paket/`.

### A2 — Interne Links umstellen
Alle React-Code `to="/bundle/..."` / `href="/bundle/..."` → `/paket/...`. Betroffen u.a.: HomePage, ProductListPage, ProductDetailPage, BerufDetailPage, QuizResultPage, LeadQuizRunner, ResultCtaBlock, ProductCards, Paywall, ShopPage, PreisePage, HandbookLandingPage, alle SEO-Seiten mit `/bundle/`-Links. Keine Logikänderung — reines String-Replace pro Datei.

### A3 — UI-Komponenten umbenennen (`Bundle*` → `Complete*`)
- `src/components/landing/bundle/` → `src/components/landing/complete/`
  - `BundleHero.tsx` → `CompleteHero.tsx`
  - `BundleStickyCta.tsx` → `CompleteStickyCta.tsx`
  - `BundleModulesBlock.tsx` → `CompleteModulesBlock.tsx`
  - `BundleComparisonBlock.tsx` → `CompleteComparisonBlock.tsx`
  - `BundleOutcomesBlock.tsx` → `CompleteOutcomesBlock.tsx`
- `src/pages/seo/BundleListPage.tsx` → `CompletePackageListPage.tsx`
- `src/pages/seo/BundleDetailPage.tsx` → `CompletePackageDetailPage.tsx`
- Sichtbare Headlines/Badges bleiben sprachlich **"Komplettpaket"** (bereits heutige Copy, vgl. `BundleHero` "Komplett-Bundle"). Wir vereinheitlichen auf **"Komplettpaket"**.
- `data-cta-location`: `bundle_hero_primary` → `complete_hero_primary`, `bundle_sticky_cta` → `complete_sticky_cta`. **Tracking-Folge:** GTM-Mapping + `cta_winner_decisions` werden in einer **separaten Migration A3b** mit alias-Map versorgt (alte Werte 90 Tage akzeptiert für CTA-Auto-Promote-Historie).

### A4 — Dead-Code entfernen
- `src/pages/work/WorkBundleBuyPage.tsx` löschen + Route in `AppRoutes.tsx` raus.
- Edge-Functions löschen (via deploy-Drift-Check abgesegnet):
  - `supabase/functions/berufski-bundle-publish/`
  - `supabase/functions/validate-standalone-bundle-secure/`
  - `supabase/functions/build-standalone-bundle/` (Legacy-Snapshot)
  - `supabase/functions/build-standalone-snapshot/` (nur falls nicht von aktivem Pfad referenziert — vorher grep)
- `src/components/marketing/BundlesTab.tsx` + `course_bundles`-Query → wenn Tab nirgends gemountet: löschen; sonst hide-only + Memory-Note. (Recon vor Delete.)
- `E2EBundleCheckCard` umbenennen zu `E2ECompletePackageCheckCard` (nur Component-Name + Import).

### A5 — Bewusst NICHT angefasst (Allowlist)
- `lesson-generate-competency-bundle` (interner Content-Begriff: Lesson-Kompetenz-Set).
- `quizBundleMap.ts` (interne Quiz-Persona-Map, kein Commerce-Bundle).
- `b2c-ssot-smoke mode=bundle` — **bleibt** (wird in Pfad C migriert/umbenannt).
- `store_products.product_key='bundle'` Daten — bleiben (Fulfillment-Key).
- `berufski-bundle-checkout` Edge-Function — bleibt (aktiver Checkout-Pfad B2C-Single-Beruf).
- `BerufsKIBundleBuyPage` — bleibt (separater BerufsKI-Funnel, andere Produkt-Linie).

## Migration / Audit
- Eine SQL-Migration: `cta_winner_decisions` + `conversion_events` View `v_cta_location_aliases` (alias-Map `bundle_hero_primary`→`complete_hero_primary` etc.), damit Historie konsistent bleibt.
- `fn_emit_audit` action_type `naming_migration_route_redirect` registriert + einmaliger Audit-Log-Eintrag mit Counts (alte vs neue Routes/Components).
- Kein DB-Tabellen-Rename, keine Spaltenänderungen.

## Verifikation
1. Build green (typecheck/eslint).
2. Manuell: `/bundle/<slug>` → Redirect → `/paket/<slug>` rendert identisch.
3. `rg "/bundle/" src/` → nur noch in `LegacyProductRedirect` + `_redirects` + Sitemap-Legacy-Block.
4. `rg "BundleHero|BundleStickyCta|BundleModulesBlock" src/` → 0 Treffer.
5. Sitemap-XML enthält `/paket/...`, nicht `/bundle/...`.
6. CTA-Tracking: emittierter `cta_location` = neuer Wert; View liefert alten Wert weiterhin in Historie.

## Reihenfolge der Commits (separate Migrations/Diffs)
1. **A1** Routes + Redirects (klein, isoliert)
2. **A2** Link-Updates (groß, aber mechanisch)
3. **A3** Component-Rename + CTA-Location-Update
4. **A3b** SQL-Migration CTA-Alias-View + Audit-Registry
5. **A4** Dead-Code-Delete (nach Recon)

Pfad C (`b2c-ssot-smoke mode=bundle`→`mode=complete`) und das Verschieben des Smoke auf die Factories aus Pfad B kommen separat.

---

**Bestätigung benötigt:**
- (1) Sichtbare Copy auf "Komplettpaket" vereinheitlichen — ok?
- (2) `build-standalone-bundle` + `build-standalone-snapshot` löschen, sofern Recon zeigt: nicht referenziert — ok?
- (3) `BundlesTab.tsx`/`course_bundles` löschen statt verstecken, falls nicht gemountet — ok?
