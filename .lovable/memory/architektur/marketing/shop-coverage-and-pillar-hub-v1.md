---
name: Shop Coverage + Pillar Hub Cut v1
description: 52 IHK-Azubi Stripe-Produkte (24,90 EUR/12mo) angelegt, 3 Pillar-Skeletons (industriekaufmann/büromanagement/einzelhandel), ProductPagePillarHub für 4 Aufstiegs-Produktseiten, Audit-Param-Fix _payload statt _meta.
type: feature
---

## Kontext (2026-05-21)
- 244 published courses, vorher nur 191 mit public product. 52 IHK-Azubi-Lückenkurse hatten weder products noch product_prices noch stripe_price_id.
- Pillar-Pages: 28 published, 3 fehlten (Industriekaufmann/Büromanagement/Einzelhandel). 1 Duplikat-Catalog `wirtschaftsfachwirt` ohne Page.

## Cut A — Shop-Coverage
- Edge `bulk-create-stripe-products` (admin-gated + EDGE_INTERNAL_SHARED_SECRET-Bypass für Ops). 3 Batches × 20/20/12 = **52/52 created, 0 errors**.
- Stripe-Produkte mit `metadata.curriculum_id` (idempotent via search). Preise: 2490 EUR one-time, 12 Monate Zugang.
- DB: products(active,public) + product_prices(active,stripe_price_id) per Kurs.
- Audit: `shop_coverage_backfill_v1` (52 rows).
- **Param-Bug**: erste Edge-Function-Variante schickte `_meta` an `fn_emit_audit` (Erwartet `_payload`). Audit-Drops still gegangen, durch SQL-Backfill auto repariert + Edge-Code gefixt + redeployed.
- Status nachher: `unsellable_no_product=0`, `courses_with_stripe_price=245` (191+52+2 Aliase).
- **Hinweis**: `is_sellable=true` bleibt für die 52 vorerst false — Lessons-Gap (lessons_ready=0) ist separater Repair-Track (Lessons-Gap Policy v1).

## Cut B — Pillar-Skeletons
- 3 Inserts in `certification_seo_pages` mit page_type='landing', is_published=false (Skeleton — Content-Wave füllt nach):
  - industriekaufmann-ihk-pruefung
  - kaufmann-bueromanagement-ihk-pruefung
  - kaufmann-einzelhandel-ihk-pruefung
- Catalog-Duplikat `wirtschaftsfachwirt` mit notes-Tag `merged_into=wirtschaftsfachwirt-ihk` markiert (kein Page-Insert).
- Audit: `pillar_skeleton_inserted_v1` (3 rows).

## Cut C — ProductPagePillarHub
- `src/components/product/ProductPagePillarHub.tsx` — titel-basierter Pillar-Resolver für 4 Aufstiegs-Produkte (AEVO, Betriebswirt IHK, Tech. Betriebswirt, Personalfachkaufmann). Renderless wenn kein Match (no-op auf allen anderen Produkten).
- Slot in `ProductPageTemplate` zwischen FAQ und FinalCTA.
- Verlinkt zur passenden `certification_seo_pages` (Pillar) + 4–6 Spoke-Themen (statisch, IHK-Rahmenplan-konform).

## Audit-Contracts (registriert)
- `shop_coverage_backfill_v1` (required: course_id, curriculum_id, product_id, price_id, stripe_product_id, stripe_price_id, amount_cents, currency)
- `pillar_skeleton_inserted_v1` (required: certification_catalog_id, slug, page_type, source)

## Files
- `supabase/functions/bulk-create-stripe-products/index.ts` (NEU)
- `supabase/migrations/20260521*_audit_contracts.sql` (Audit-Contracts)
- `src/components/product/ProductPagePillarHub.tsx` (NEU)
- `src/components/product/ProductPageTemplate.tsx` (Slot)

## Open Items
- Lessons-Gap-Repair für die 52 neuen sellable-Kandidaten (Wave-Repair läuft separat).
- Pillar-Content-Generation für die 3 Skeleton-Pages über bestehende SEO-Wave-Pipeline.
