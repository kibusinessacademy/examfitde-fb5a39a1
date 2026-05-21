# Cut: Shop-Coverage + Pillar Hub

## Befund

| Bereich | Stand | Lücke |
|---|---|---|
| Published Kurse | 244 | – |
| Sellable (Produkt+Preis+Lessons) | 191 | **53** |
| → davon ohne `products(active,public)` | – | **52** |
| → davon ohne aktiven Preis | – | 1 |
| → davon Lessons nicht ready | – | 1 |
| Pillar-Pages (`certification_seo_pages`) für Aufstieg/Meister/AEVO | 28 published | **3 Skeletons fehlen** |
| Duplikat-Slug `wirtschaftsfachwirt` (vs `wirtschaftsfachwirt-ihk`) | – | konsolidieren |

**Standard-Pricing aus Bestand:** 24,90 € EUR, one-time, 12 Monate Zugang (137 Kurse heute genau so) → übernehme ich für die 52 Lückenkurse.

---

## Cut A — Shop-Coverage schließen (52 IHK-Azubi-Kurse kaufbar machen)

### A.1 Stripe Bulk-Anlage
- Edge Function `bulk-create-stripe-products` (admin-gated, idempotent über `metadata.curriculum_id`).
- Pro Lückenkurs: `Stripe Product` (name=course.title, metadata={curriculum_id, course_id}) + `Stripe Price` (2490 EUR one-time).
- Outputs: `{course_id, stripe_product_id, stripe_price_id}` Liste.

### A.2 DB-Insert
- `products` row pro Kurs (`curriculum_id`, `status=active`, `visibility=public`, slug aus `slugify(title)`, `channel_policy_json` via `fn_default_channel_policy('EXAM_FIRST')`).
- `product_prices` row (`amount_cents=2490`, `currency='EUR'`, `billing_type='one_time'`, `access_months=12`, `active=true`, `stripe_price_id`).
- Audit: `fn_emit_audit('shop_coverage_backfill_v1', …)` pro Kurs.

### A.3 Verifikation
- `select count(*) from v_public_sellable_courses where is_sellable and has_stripe_price` muss **243** (191 + 52) sein.
- `pricing-integrity-guard` grün halten (Trigger blockt sonst).

---

## Cut B — Pillar-Skeletons schließen

3 fehlende `certification_seo_pages` (page_type=`landing`, `is_published=false` initial → SEO-Skeleton, kein dünner Live-Inhalt):

1. `industriekaufmann-ihk-pruefung`
2. `kaufmann-bueromanagement-ihk-pruefung`
3. `kaufmann-einzelhandel-ihk-pruefung`

Zusätzlich: `wirtschaftsfachwirt` (Duplikat-Catalog-Eintrag ohne Page) → `notes` markieren als `merged_into=wirtschaftsfachwirt-ihk`, kein Page-Insert.

Inserts via `supabase--insert` mit Templated `meta_title`, `meta_description`, `content_json` (Hero+FAQ-Skeleton, ≥80 Zeichen desc, kein dünnes HTML — `fn_seo_thin_content_guard` muss grün sein).

Status `is_published=false` bis Content-Wave die Pages auffüllt (existiert bereits in der Pipeline).

---

## Cut C — Erweiterte Produktseiten (SEO-Hub-Block)

Auf den bestehenden Produktseiten der **4 kaufbaren Aufstiegsfortbildungen** (AEVO, Betriebswirt IHK, Technischer Betriebswirt, Personalfachkaufmann) wird ein neuer Section-Block `<ProductPagePillarHub />` ergänzt:

- Verlinkt zur passenden `certification_seo_pages` (Pillar)
- Listet 3–6 Spoke-Themen (Lernfelder/Kompetenzen) aus dem Curriculum
- Verlinkt zurück zur Produktseite (cluster→pillar→cluster Loop)
- JSON-LD `BreadcrumbList` ergänzt (Pillar in Kette)

Keine neuen Routen, keine neuen Templates — Block fügt sich in bestehende `ProductPageSSOT`.

---

## Files / Migrationen / Edge Functions

```text
supabase/functions/bulk-create-stripe-products/index.ts   (NEU, admin-only)
supabase/migrations/<ts>_shop_coverage_backfill_audit.sql (audit_contract registrieren)
supabase/migrations/<ts>_pillar_skeleton_inserts.sql      (3 INSERTs via insert tool)
src/components/product/ProductPagePillarHub.tsx           (NEU)
src/pages/.../ProductPage.tsx                             (Slot einfügen)
```

Audit `action_type`s:
- `shop_coverage_backfill_v1` (1 row pro Kurs)
- `pillar_skeleton_inserted_v1` (3 rows)

## Vorher/Nachher

| KPI | Vorher | Nachher |
|---|---:|---:|
| sellable courses | 191 | **243** |
| missing public products | 52 | **0** |
| pillar landings published | 28 | 28 (+3 skeleton draft) |
| pillar-coverage Aufstieg/Meister/AEVO | 90% | **100%** |
| Produktseiten mit SEO-Hub | 0 | **4** |

## Risiken / Mitigation

- **Stripe-Live-Modus**: 52 echte Produkte erzeugen. Idempotenz via `metadata.curriculum_id` + Pre-Check `stripe.products.search`. Bei Fehler in Mitte: rerun ist no-op.
- **Pricing-Guard**: `trg_guard_publish_requires_pricing` triggert beim Publish — wir publishen kein neues Paket, sondern fügen nur Produkte zu schon-published Kursen → Trigger nicht relevant.
- **Lessons-Gap**: 1 Kurs hat lessons not-ready — bleibt vorerst draußen, wird in Wave-Repair geheilt.
