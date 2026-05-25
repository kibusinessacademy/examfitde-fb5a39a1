# Hardcut auf BerufOS.com — Endgültige Konsolidierung

**Strategischer Kontext:** Keine bestehenden Rankings → seltene Chance, die Plattformarchitektur einmal richtig aufzusetzen. Kein Hybridbetrieb, kein Legacy-Schutz, keine Domain-Authority-Migration.

## Zielzustand (SSOT)

- **Master-Brand:** BerufOS
- **Primary Domain:** `berufos.com` (einzige kanonische Wahrheit)
- **Module unter `/`:** `/examfit`, `/berufs-ki`, `/agents`, `/documents`, `/workflows`, `/skills`, `/career`, `/recruit`, `/industries`, `/governance`
- **Legacy:** `examfit.de` + `examfitwork.de` → 301 auf `berufos.com/<modul>`
- **VibeOS:** vollständig entfernt
- **Stripe/Email:** alles auf BerufOS-Branding

## Phasen-Cut (in dieser Iteration: P1–P4)

### P1 — Brand-SSOT Hardcut
- `src/lib/berufos/brand.ts`: bleibt SSOT, `primary_domain` hart auf `berufos.com`. Neue Helper: `MASTER_BRAND`, `PRIMARY_DOMAIN`, `MODULE_SLUGS`.
- `src/lib/brand/ssot.ts` (ExamFit@work-SSOT): markiert als **deprecated** + Re-Export aus `berufos/brand.ts`. Konsumenten bekommen `BERUFOS.subBrands.berufsKi.*`.
- Authority-Host-Helper (`src/lib/seo/authorityHost.ts`): einzige Authority = `berufos.com` + `www.berufos.com`. `examfit.de` wird **non-authority** (noindex + canonical-rewrite auf berufos.com).

### P2 — Canonical & JSON-LD Cutover
- `index.html`: Title, Meta-Desc, og:*, canonical, robots — alles auf BerufOS. JSON-LD `@graph`:
  - `Organization` = BerufOS (Hauptentität)
  - `SoftwareApplication` × 3 (LearningOS=ExamFit, WorkforceOS=Berufs-KI, AgentOS)
  - ExamFit `EducationalOrganization` entfernt (keine Authority mehr zu schützen)
- `useBerufosCanonical()` Hook: für alle SPA-Routes berufos.com Canonicals.
- `RouteNoindex`-Guard: examfit.de + examfitwork.de + alle Preview-Hosts → noindex + canonical auf berufos.com.

### P3 — Routing & Hub-Promotion
- `src/routes/AppRoutes.tsx`: Root `/` rendert künftig `BerufOSHub` (statt aktueller ExamFit-Homepage). Aktuelle Homepage zieht um auf `/examfit`.
- Module-Routes ohne `/berufos`-Präfix: `/examfit`, `/berufs-ki`, `/agents`, `/documents`, `/workflows`, `/skills`, `/career`, `/recruit`, `/industries`, `/governance`.
- Legacy-Aliase: `/berufos/*` → 301 auf `/*` (kein Doppel-Hub).
- `BundleToPaketRedirect`-Muster wiederverwenden für Hash-Cut.

### P4 — SEO Foundation (Sitemap + Robots + Redirects)
- `public/sitemap.xml`: Static index entfernt, durch generator-basierten Single-Sitemap-Approach ersetzt — nur BerufOS-Hub + 10 Module + Pflicht-Pages.
- `public/robots.txt`: Sitemap-URL auf berufos.com.
- `public/_redirects` (Cloudflare/Vercel): examfit.de + examfitwork.de + berufski.de → berufos.com/<modul>. Wildcard-Catchall.
- Bridge-Komponente `BerufOSPlatformBadge` aus MainLayout entfernt (keine zwei Plattformen mehr).

## NICHT in diesem Cut (separate Runs nach User-Go)

- **P5 Stripe-Migration:** Neue Produkte mit `metadata.platform=berufos` + Checkout-Branding-Umstellung — braucht User-Bestätigung der Stripe-Operationen.
- **P6 Email-Domain-Setup:** `hello@berufos.com` / `support@berufos.com` — braucht DNS-Setup-Dialog mit dem User.
- **P7 GSC + Site-Verification:** Neue Property berufos.com anlegen, Meta-Tag injizieren, Verify-Call.
- **P8 Custom-Domain-Switch:** User muss berufos.com als Primary in Lovable-Project-Settings setzen + DNS-Records einpflegen.
- **P9 Stale Memory Cleanup:** Memory-Einträge mit examfit-Authority-Bezug refreshen.

## Risiken & Rollback

- **Bestehende Tests/E2E** prüfen oft auf `examfit.de` — werden in P2 hart auf berufos.com umgestellt. CI-Failures sind erwartbar in dieser Iteration und werden mitgefixt.
- **VibeOS-Theme-CSS** bleibt physisch als Fallback (Klassen heißen `.vibeos-*` → letzte Konsumenten erst nach Inventur entfernen).
- Rollback via Git-Revert pro Phase möglich; alle Änderungen sind file-scoped, keine DB-Migrationen.

## Bestätigung benötigt

Soll ich P1–P4 jetzt durchziehen (~12–15 Dateien edit, 2–3 neue Dateien, ~30 Min Build)?  
P5–P9 dann in Folge-Runs mit deinem expliziten Go pro Phase.
