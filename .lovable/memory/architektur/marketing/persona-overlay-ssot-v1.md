---
name: Persona-Overlay SSOT v1
description: product_persona_overlays als Persona-Wording-Overlay über v_product_page_ssot. Keine Truth-Daten. 49 published × 3 Personas = 147 Rows scaffolded. L8 in v_data_holes_ssot.
type: feature
---

# Persona-Overlay SSOT v1 (Path D)

## Architektur-Regel
- `product_persona_overlays(package_id, persona_type)` = NUR persona-spezifisches Wording (Hero, CTA, USP, Pain, Trust, SEO).
- **Niemals** Truth-Daten dort speichern — Preis/Curriculum/Capabilities/Module bleiben in `v_product_page_published_ssot`.
- Reader: `useProductPersonaOverlay(packageId, persona)`. Soft-Fail → Fallback auf SSOT-Defaults im Caller.
- RLS: public read auf `active=true`, write nur admin.

## Deprecated
- `product_landing_profiles` (cert-basiert, kein Reader, totes Schema). Comment markiert. Drop nach 60-Tage Cooldown.

## Bulk-Scaffold
- RPC: `admin_scaffold_persona_overlays(p_dry_run boolean)` — idempotent via UNIQUE(package_id, persona_type) + ON CONFLICT DO NOTHING.
- Personas: `azubi`, `betrieb`, `umschulung` (enum `product_persona`).
- Initial 2026-05-02: 147 Rows (49 × 3), L8 = 0.

## SSOT-Loch
- `v_data_holes_ssot` L8 `L8_published_pkg_no_persona_overlay` (severity LOW) — published packages ohne mind. 1 active overlay.

## Helper
- `v_persona_overlay_coverage` (service_role only) — pro Paket: count + persona-array.

## Frontend-Integration
- `ProductPersonaPage` ruft `useProductPersonaOverlay()` und überschreibt Hero/CTA/SEO im Template, fällt auf SSOT zurück, wenn Overlay fehlt.
- Tracking bleibt unverändert: `package_id` + `persona` aus SSOT-Truth, nicht aus Overlay.
