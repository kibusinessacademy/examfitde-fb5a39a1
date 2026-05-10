---
name: Pricing-View package_id Frontend Wiring v1
description: Frontend pricing_view + cta_clicked + checkout_start auf Pricing-Detail-Pages emittieren jetzt package_id (Pflichtfeld für funnel-loss-detector). useResolvePackageContext liefert SSOT-Auflösung via certification_id ODER curriculum_id.
type: feature
---

## Problem (vor 2026-05-10)
- `v_funnel_event_loss.status` = CRIT: paid_orders_24h=4, checkout_complete_24h=0, pricing_view_24h=0.
- `pricing_view` wurde nur in `tracking_events` geschrieben (legacy timeline) — funnel-loss-detector liest aber `conversion_events`.
- `PruefungstrainingDetailPage` und `BundleDetailPage` hatten keinen Zugriff auf `package_id` und konnten die Pflichtfelder daher nicht setzen.

## Fix
1. **`src/hooks/useResolvePackageContext.ts`** — neuer Hook resolved published `course_packages` Row aus entweder `certification_id` oder `curriculum_id`. Liefert `{ package_id, curriculum_id, persona, certification_id }` für Tracking-Pflichtfelder.
2. **`src/pages/product/ProductPage.tsx`** — `pricing_view` (IntersectionObserver) zusätzlich via `trackFunnel` mit `product.packageId`. CTA-Click feuert `cta_clicked` + `checkout_start` mit `package_id` + `source_page`.
3. **`src/pages/seo/PruefungstrainingDetailPage.tsx`** — useResolvePackageContext({ certificationId: cert.id }). useEffect emittiert `pricing_view` sobald `pkgCtx.package_id` resolved. CTA im Pricing-Block feuert `add_to_cart` + `cta_clicked` + `checkout_start` mit allen Pflichtfeldern.
4. **`src/pages/seo/ProductDetailPage.tsx` (Bundle)** — useResolvePackageContext({ curriculumId: product.curriculum_id }). Analog: `pricing_view` + CTA-Pfad mit package_id durchverdrahtet.

## Server-Side bleibt SSOT
- `create-product-checkout` schreibt `checkout_started` server-seitig in `conversion_events` mit `package_id` (unverändert, SSOT-konform — siehe checkout-tracking-ssot-sprint1).
- `stripe-webhook` → `emitCheckoutCompleteEvent` schreibt `checkout_complete` mit `package_id` (unverändert).
- Frontend ergänzt jetzt nur die fehlenden **oberen Funnel-Stufen** (pricing_view, cta_clicked, checkout_start) mit Pflichtfeldern.

## Erwartetes Ergebnis
- Nach echtem Traffic auf einer Pricing-Detail-Page → `pricing_view` mit `package_id` in `conversion_events`.
- `v_funnel_event_loss.status` geht von CRIT → OK sobald paritäts-checkbare Events fließen.
- GTM-Layer bekommt automatisch alle Pflicht-Top-Level-Felder via `gtmEmitFunnel` (kein zusätzlicher Code).

## Smoke
- `scripts/funnel-tracking-smoke.mjs` (RPC + Edge enforcement) bleibt unverändert — der Server lehnt strict events ohne `package_id` weiterhin mit 22023 ab.
- Manueller Verify: `SELECT event_type, COUNT(*) FROM conversion_events WHERE package_id IS NOT NULL AND created_at > now() - interval '1 hour' GROUP BY 1;`
